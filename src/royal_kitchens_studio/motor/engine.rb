# encoding: UTF-8
# =============================================================================
#  Royal Kitchens Studio — Motor de inyección de atributos
#  (Origen: KitchenCreator/plugin/royal_catalog_creator, commit 4f6e3fb.
#  Desde Studio 0.4.0 se edita aquí.)
# =============================================================================
#  Refactor del motor validado en script.rb (gm_interpret, buscar_componentes_hijos
#  y el bucle de inyección) a un módulo reutilizable. La UI del plugin aplana el
#  formulario a una "fila plana" { "prefijo>attr" => "800mm" } equivalente a una
#  fila del CSV, y este motor la inyecta en una copia del componente base.
# =============================================================================

require 'sketchup.rb'
require 'fileutils'

module RoyalKitchens
  module Studio
    module Engine

      DICT = 'dynamic_attributes'.freeze

      # Variables estándar de tamaño: se fijan como cadena nominal (bloqueo estructural).
      STANDARD_KEYS = %w[lenx leny lenz x y z].freeze

      module_function

      # ---------------------------------------------------------------------
      # Convierte un valor crudo del formulario/CSV a un valor listo para el
      # atributo dinámico. mm/cm/m/in -> pulgadas (unidad nativa de SketchUp).
      #   nil -> celda vacía (ignorar)
      #
      # La convención heredada de escribir «no» para omitir una variable se
      # retiró (DEV-21, R-24): era inalcanzable desde el formulario, donde el
      # campo concatena su unidad y producía "nomm".
      # ---------------------------------------------------------------------
      def interpret(raw)
        s = raw.to_s.strip
        return nil if s.empty?

        m = s.match(/\A(-?[\d.,]+)\s*(mm|cm|cms|m|in|"|pulg)?\z/i)
        if m
          num_str = m[1].tr(',', '.')
          num     = num_str.to_f
          unit    = (m[2] || '').downcase

          if unit.empty?
            return (num_str =~ /\A-?\d+\z/) ? num.to_i : num
          end

          inches = case unit
                   when 'mm'               then num / 25.4
                   when 'cm', 'cms'        then num / 2.54
                   when 'm'                then num * 39.3700787
                   when 'in', '"', 'pulg'  then num
                   end

          return inches.to_f
        end

        s
      end

      # ---------------------------------------------------------------------
      # Busca recursivamente instancias/grupos hijos cuyo nombre (instancia o
      # definición) contenga el prefijo buscado (puerta/estructura/divisor/cajon).
      # ---------------------------------------------------------------------
      def buscar_componentes_hijos(entidad, nombre_buscado, resultados = [])
        buscado = nombre_buscado.downcase.strip

        nombre_instancia  = entidad.name.to_s.downcase
        nombre_definicion = entidad.definition.name.to_s.downcase

        if nombre_instancia.include?(buscado) || nombre_definicion.include?(buscado)
          resultados << entidad
        end

        entidad.definition.entities.each do |hijo|
          if hijo.is_a?(Sketchup::ComponentInstance) || hijo.is_a?(Sketchup::Group)
            buscar_componentes_hijos(hijo, buscado, resultados)
          end
        end

        resultados
      end

      # ---------------------------------------------------------------------
      # Inyecta un atributo (col => valor) en una instancia raíz. Maneja el
      # split por '>' para atributos de piezas hijas. Devuelve un warning
      # (string) si la pieza hija no se encontró, o nil si todo bien.
      # ---------------------------------------------------------------------
      def inyectar_atributo(inst, col, valor_raw)
        valor_math = interpret(valor_raw)
        return nil if valor_math.nil?

        if col.include?('>')
          partes          = col.split('>')
          nombre_objetivo = partes[0]
          key             = partes[1].strip.downcase
          objetivos       = buscar_componentes_hijos(inst, nombre_objetivo)
          return "Pieza no encontrada: '#{nombre_objetivo}' para #{key}." if objetivos.empty?
        else
          key       = col.strip.downcase
          objetivos = [inst]
        end

        is_standard = STANDARD_KEYS.include?(key)

        # Un valor "=formula" (p.ej. el preset «Entrepaño» de un margen frontal)
        # no es una medida: es la fórmula nativa del componente, reinyectada a
        # propósito para no depender de que el .skp base la conserve intacta.
        es_formula = valor_math.is_a?(String) && valor_math.start_with?('=')

        objetivos.each do |target_inst|
          [target_inst, target_inst.definition].each do |ent|
            if es_formula
              ent.set_attribute(DICT, "_#{key}_formula", valor_math[1..-1])
              next
            end

            ent.delete_attribute(DICT, "_#{key}_formula") rescue nil
            ent.set_attribute(DICT, key, valor_math)

            if is_standard
              # Bloqueo estructural: fija la pulgada matemática como cadena nominal.
              ent.set_attribute(DICT, "_#{key}_nominal", valor_math.to_s)
            else
              # Variables secundarias: conservan el texto para la interfaz.
              ent.set_attribute(DICT, "_#{key}_nominal", valor_raw.to_s)
            end
          end
        end

        nil
      end

      # ---------------------------------------------------------------------
      # Borra las piezas que el componente dinámico dejó ocultas.
      #
      # El componente trae todas las variantes de puerta y cajón dentro y oculta
      # (hidden = 1) las que no aplican a la configuración; el .skp de salida se
      # llevaría decenas de componentes muertos. Aquí se eliminan.
      #
      # OJO con lo compartido: inst.make_unique solo independiza la definición
      # raíz. Las definiciones anidadas siguen siendo las mismas del componente
      # base y de las unidades ya insertadas en la escena, así que borrar dentro
      # de ellas las corrompería. Por eso cada hijo se hace único ANTES de tocar
      # su contenido.
      #
      # Devuelve la cantidad de piezas borradas.
      # ---------------------------------------------------------------------
      def eliminar_ocultos(inst)
        borradas = 0
        pila     = [inst.definition]

        until pila.empty?
          defn = pila.shift
          next unless defn.valid?

          # Se clasifica ANTES de borrar: después de erase_entities las
          # referencias a lo borrado (y a lo que arrastre) quedan inválidas.
          ocultos, contenedores = [], []
          # Solo piezas (instancias y grupos). Las aristas ocultas NO son
          # variantes: son las uniones que los frentes con marco (Mitered,
          # Clásico Europeo, Raised Panel) esconden para leerse como una sola
          # pieza, y borrar una arista se lleva las caras que delimita.
          defn.entities.to_a.each do |e|
            next unless e.is_a?(Sketchup::ComponentInstance) || e.is_a?(Sketchup::Group)
            if oculto?(e)
              ocultos << e
            else
              contenedores << e
            end
          end

          unless ocultos.empty?
            borradas += ocultos.size
            defn.entities.erase_entities(ocultos)
          end

          contenedores.each do |hijo|
            next unless hijo.valid?
            # Si la definición está compartida hay que independizarla antes de
            # entrar: si no, borrar aquí mutilaría el componente base y las
            # unidades ya insertadas en la escena.
            hijo.make_unique if hijo.definition.instances.size > 1
            pila << hijo.definition
          end
        end

        borradas
      end

      # ---------------------------------------------------------------------
      # Pone a cada división el nombre que ya resolvió la UI (Divisor/Entrepaño
      # según el modo elegido en su margen frontal). Aquí no se infiere nada: el
      # motor recibe la lista hecha y solo la aplica, en orden 1..n.
      #
      # Estructura confirmada por diagnóstico sobre GABINETE.skp (2026-07-29):
      #
      #   <unidad> > "DIA01 - ESPACIO 1 - DivisorHorizontal" > PanelXY#nn > Panel#nnn
      #
      #   - Cada división es una ComponentInstance hija directa del contenedor;
      #     la caja de referencia que vive ahí también es un Group, y por eso el
      #     filtro es por tipo y no por nombre.
      #   - Cada copia trae definición propia (instances.size == 1): el DC ya las
      #     independizó, así que no hace falta make_unique para nombrarlas por
      #     separado.
      #   - Salen ordenadas de abajo hacia arriba por z, que es justo el orden de
      #     los índices 1..n de g01margenf{i} (verificado cruzando el margen
      #     inyectado contra el desplazamiento en y de cada pieza).
      #
      # Se escribe SOLO el nombre de instancia: las definiciones se comparten con
      # el componente base y renombrarlas contaminaría otras unidades.
      #
      # Devuelve la lista de warnings (vacía si todo salió bien).
      # ---------------------------------------------------------------------
      def nombrar_divisores(inst, spec)
        nombres = Array(spec[:nombres])
        return [] if nombres.empty?

        contenedor = buscar_componentes_hijos(inst, spec[:prefijo].to_s)
                     .reject { |e| e == inst }   # la raíz puede matchear por su propio nombre
                     .first
        return ["Divisores: no se encontró la pieza '#{spec[:prefijo]}'."] if contenedor.nil?

        copias = contenedor.definition.entities
                           .grep(Sketchup::ComponentInstance)
                           .sort_by { |e| e.transformation.origin.z }

        warnings = []
        if copias.size != nombres.size
          warnings << "Divisores: se esperaban #{nombres.size} piezas y se encontraron #{copias.size}."
        end

        copias.each_with_index do |copia, i|
          break if i >= nombres.size
          hoja_de(copia).name = nombres[i]
        end

        warnings
      end

      # Baja al último objeto real de la copia, que es donde debe verse el nombre
      # en el Outliner. Solo se desciende mientras haya exactamente una instancia
      # hija: así se ignoran los grupos auxiliares (la caja de escalado que el
      # componente cuelga de cada pieza) y se para en cuanto hay ambigüedad.
      def hoja_de(ent)
        actual = ent
        10.times do            # tope de seguridad: el árbol real tiene 1 nivel
          hijos = actual.definition.entities.grep(Sketchup::ComponentInstance)
          break unless hijos.size == 1
          actual = hijos.first
        end
        actual
      end

      # ---------------------------------------------------------------------
      # Une las dos medias piezas de cada entrepaño en una sola.
      #
      # El esquinero modela cada repisa en L como dos prismas independientes, así
      # que el .skp de salida entregaba dos tableros donde debe haber una pieza.
      #
      # Estructura confirmada por diagnóstico sobre ESQUINERO.skp (2026-07-30):
      #
      #   <unidad> > Estructura > DIVISORES > PanelXY#nn > "ENTREPAÑO #n"
      #            > P01-ESQ#n + P02-ESQ#n + 4 grupos auxiliares sin caras
      #
      #   - No hace falta localizar el contenedor de repisas: el nodo "ENTREPAÑO"
      #     de cada copia ya agrupa las dos mitades, y buscarlo por prefijo los
      #     devuelve todos.
      #   - Cada mitad es un prisma cerrado (6 caras, 12 aristas) pero NO es
      #     `manifold?`: trae colgando un grupo «SPanel» de una cara, y SketchUp
      #     solo considera sólido lo que contiene únicamente caras y aristas. Por
      #     eso no se unen las piezas originales sino copias limpias de ellas.
      #   - El diagnóstico mostró instances.size == 1 en todo el camino, pero eso
      #     no basta para tocar la geometría: ver buscar_para_modificar.
      #
      # Devuelve la lista de warnings (vacía si todo salió bien).
      # ---------------------------------------------------------------------
      def unir_piezas(inst, spec)
        piezas = Array(spec[:piezas]).map(&:to_s)
        return [] if piezas.size < 2

        # Las Solid Tools son exclusivas de Pro. No es un error de generación:
        # el mueble sale bien, solo con las mitades sin fusionar.
        unless Sketchup.is_pro?
          return ['Unión de entrepaños: requiere SketchUp Pro (Solid Tools). Las mitades quedaron separadas.']
        end

        grupos = buscar_para_modificar(inst, spec[:grupo].to_s).reject { |e| e == inst }
        return ["Unión de entrepaños: no se encontró la pieza '#{spec[:grupo]}'."] if grupos.empty?

        warnings = []
        grupos.each_with_index do |grupo, i|
          next if oculto?(grupo)
          begin
            aviso = unir_mitades(grupo, piezas, spec[:nombre].to_s)
            warnings << "Entrepaño #{i + 1}: #{aviso}" if aviso
          rescue => e
            warnings << "Entrepaño #{i + 1}: #{e.message}"
          end
        end
        warnings
      end

      # Igual que buscar_componentes_hijos, pero independiza cada contenedor por
      # el que pasa. Es obligatorio cuando lo hallado se va a MODIFICAR: que una
      # definición tenga una sola instancia no prueba que sea exclusiva de esta
      # unidad — si alguna definición del camino está compartida con el
      # componente base, esa única instancia se dibuja también dentro del base y
      # de las unidades ya insertadas, y borrar ahí las mutila (mismo cuidado que
      # documenta eliminar_ocultos).
      #
      # No desciende debajo de lo que ya matcheó: lo de adentro se busca aparte,
      # y para entonces el contenedor ya es exclusivo.
      def buscar_para_modificar(entidad, nombre_buscado, resultados = [])
        buscado = nombre_buscado.downcase.strip

        if entidad.name.to_s.downcase.include?(buscado) ||
           entidad.definition.name.to_s.downcase.include?(buscado)
          resultados << entidad
          return resultados
        end

        entidad.definition.entities.to_a.each do |hijo|
          next unless hijo.is_a?(Sketchup::ComponentInstance) || hijo.is_a?(Sketchup::Group)
          independizar(hijo)
          buscar_para_modificar(hijo, buscado, resultados)
        end

        resultados
      end

      # Une las mitades dentro de UN contenedor, que buscar_para_modificar ya
      # dejó independizado. Devuelve un warning o nil.
      def unir_mitades(grupo, piezas, nombre)
        mitades = piezas.map do |pref|
          buscar_componentes_hijos(grupo, pref).reject { |e| e == grupo || oculto?(e) }.first
        end
        # Sin ninguna mitad no es una repisa, no hay nada que unir ni que avisar.
        return nil if mitades.all?(&:nil?)
        return "no se encontró alguna de las mitades (#{piezas.join(', ')})." if mitades.any?(&:nil?)

        destino = grupo.definition.entities
        copias  = mitades.map { |m| copia_solida(m, destino) }

        aviso = nil
        if copias.any? { |c| !c.manifold? }
          aviso = 'alguna mitad no quedó como sólido cerrado; se dejaron separadas.'
        else
          union = copias[0].union(copias[1])
          if union.nil?
            aviso = 'la unión de las dos mitades falló; se dejaron separadas.'
          elsif union.parent != grupo.definition
            # Si el resultado no cae dentro del contenedor quedaría geometría
            # suelta en la escena. Se descarta: la unión consumió las copias, no
            # los originales, así que la repisa sigue completa.
            union.erase! if union.valid?
            aviso = 'la unión salió fuera del contenedor; se descartó y las mitades siguen separadas.'
          else
            union.name = nombre
            # Refuerzo del material: además de las caras, el grupo resultante
            # lleva el material a nivel de instancia como lo tenían las mitades,
            # para que repintarlo después se comporte igual que antes de unir.
            union.material = mitades[0].material if mitades[0].material
            mitades.each { |m| m.erase! if m.valid? }
          end
        end

        # Las copias sobreviven solo si la unión no llegó a consumirlas.
        copias.each { |c| c.erase! if c.valid? } if aviso
        aviso
      end

      # Copia de una pieza con solo su geometría cruda, que es lo que las Solid
      # Tools aceptan como sólido. Se re-inserta la definición ya transformada y
      # se explota dentro de un grupo nuevo; los contenedores anidados que trae
      # el panel (el grupo «SPanel») se borran de la copia, no del original.
      def copia_solida(pieza, destino)
        g   = destino.add_group
        tmp = g.entities.add_instance(pieza.definition, pieza.transformation)

        # El material de estos paneles vive en la INSTANCIA, no en las caras: una
        # instancia nueva de la misma definición nace sin él y la pieza fusionada
        # saldría en blanco. Al explotar, SketchUp lo baja a las caras que usan el
        # material por defecto, y la unión conserva materiales por cara.
        tmp.material = pieza.material if pieza.material
        tmp.explode

        g.entities.to_a.each do |e|
          next unless e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
          e.erase! if e.valid?
        end
        g
      end

      # ---------------------------------------------------------------------
      # Deja cada frente compuesto como UNA pieza para OpenCutList.
      #
      # Los frentes con marco (Italiana, Mitered, Clásico Europeo, Raised
      # Panel…) están armados con largueros, travesaños, esquinas y tablero,
      # cada uno un componente con caras; OpenCutList lista una pieza por cada
      # componente con caras y el frente salía despiezado.
      #
      # OpenCutList trata como simple grupo a todo componente cuya definición
      # tiene «cortar abertura» (cutlist_generate_worker.rb,
      # _fetch_useful_instance_infos; verificado en OCL 7.1.0): sus caras, sus
      # medidas y su material cuentan para el componente que lo contiene. Aquí
      # se marca así cada pieza interna del frente, y el frente sale como una
      # sola pieza con su ancho, alto y grosor totales. No se toca geometría ni
      # atributos: el componente dinámico sigue redibujándose igual, y como las
      # piezas no están pegadas a ninguna cara, la marca no corta nada.
      #
      # Estructura (GABINETE.skp, 2026-10-12):
      #
      #   PanelZX (lleva u05estilo) > "CE Puerta" [PU.ClasicoEuropeo] > piezas
      #
      # El frente es cada hijo visible del PanelZX con dos o más componentes con
      # caras; el frente liso (una sola tabla) no se toca.
      #
      # Devuelve la cantidad de frentes unificados.
      # ---------------------------------------------------------------------
      ATTR_ESTILO_FRENTE = 'u05estilo'.freeze

      #
      # spec (opcional) pone nombre a la pieza de cada frente, liso incluido:
      #   { nombre: "{pieza} Italiana", piezas: { "Tapa_cajon" => "Tapa de cajón" } }
      # «{pieza}» es el e1nombre del PanelZX («Puerta», «Tapa_cajon»). Va en el
      # nombre de la definición, que es el que lista OpenCutList.
      def unificar_frentes(inst, spec = nil)
        n = 0
        nombrados = {}
        pila = [inst]
        until pila.empty?
          ent = pila.shift
          es_frente = ent.get_attribute(DICT, ATTR_ESTILO_FRENTE) ||
                      ent.definition.get_attribute(DICT, ATTR_ESTILO_FRENTE)
          ent.definition.entities.to_a.each do |hijo|
            next unless hijo.is_a?(Sketchup::ComponentInstance) || hijo.is_a?(Sketchup::Group)
            next if oculto?(hijo)
            # Mismo cuidado que eliminar_ocultos: nada compartido con el base.
            independizar(hijo)
            unless es_frente && hijo.is_a?(Sketchup::ComponentInstance)
              pila << hijo
              next
            end

            hojas = piezas_con_caras(hijo.definition)
            next if hojas < 1
            pieza = hijo
            if hojas >= 2
              piezas_como_grupo(hijo.definition)
              n += 1
            else
              pieza = unica_pieza(hijo)
            end
            nombrar_frente(pieza, ent, spec, nombrados) if spec && pieza
          end
        end
        n
      end

      # La única pieza con caras de un frente liso (la tabla), independizando
      # el camino hasta ella porque se le va a cambiar el nombre.
      def unica_pieza(ent)
        ent.definition.entities.to_a.each do |e|
          next unless e.is_a?(Sketchup::ComponentInstance) || e.is_a?(Sketchup::Group)
          next if oculto?(e)
          independizar(e)
          return e if e.is_a?(Sketchup::ComponentInstance) && e.definition.entities.grep(Sketchup::Face).any?
          hallada = unica_pieza(e)
          return hallada if hallada
        end
        nil
      end

      # Huella de una pieza: medidas, caras, materiales y la posición de cada
      # parte, en toda la rama. Dos definiciones con la misma huella se dibujan
      # igual (una puerta izquierda y su derecha solo si de verdad son iguales).
      def firma_pieza(defn)
        bb    = defn.bounds
        caras = defn.entities.grep(Sketchup::Face)
        hijos = defn.entities.select { |e| e.is_a?(Sketchup::ComponentInstance) || e.is_a?(Sketchup::Group) }
                    .reject { |e| oculto?(e) }
        [
          [bb.min, bb.max].map { |p| p.to_a.map { |v| v.to_mm.round(1) } },
          caras.size,
          caras.inject(0.0) { |s, f| s + f.area }.round(2),
          caras.map { |f| f.material ? f.material.name : '' }.uniq.sort,
          hijos.map { |e| [e.transformation.to_a.map { |v| v.round(3) }, e.material ? e.material.name : '', firma_pieza(e.definition)].inspect }.sort
        ]
      end

      def nombrar_frente(pieza, panel, spec, nombrados)
        clave = (panel.get_attribute(DICT, 'e1nombre') || panel.definition.get_attribute(DICT, 'e1nombre')).to_s
        tipo  = (spec[:piezas] || {})[clave] || clave.tr('_', ' ')
        nombre = spec[:nombre].to_s.sub('{pieza}', tipo).squeeze(' ').strip
        return if nombre.empty?
        # Los frentes idénticos de este mueble comparten definición para salir
        # en un renglón con su cantidad (mismo motivo que unificar_herrajes).
        # Solo entre los de esta generación: los de otro mueble pueden llevar
        # otro material pintado dentro de la definición.
        firma  = firma_pieza(pieza.definition)
        gemela = (nombrados[nombre] ||= []).find { |d, f| d.valid? && f == firma }
        if gemela
          pieza.definition = gemela[0]
        else
          pieza.definition.name = nombre
          pieza.definition.set_attribute(DICT_STUDIO, 'compartida', true)
          nombrados[nombre] << [pieza.definition, firma]
        end
        # Para quien tenga OpenCutList leyendo el nombre del atributo dinámico.
        [pieza, pieza.definition].each { |e| e.set_attribute(DICT, 'name', nombre) }
      end

      # ---------------------------------------------------------------------
      # Deja cada contenedor como UNA pieza para OpenCutList, con su medida
      # total, sin tocar la geometría:  [{ grupo:, nombre: }]
      #
      # Caso: la lateral con gola (PanelYZ_CEGolaLat), que el componente arma
      # con el cuerpo y dos tiras al frente (PInt1) alrededor de la muesca; en
      # el despiece salían 3 piezas. Se corta como un tablero completo
      # (770 × 600) y luego se le hace la muesca de la gola. Mismo método que
      # unificar_frentes: las piezas internas quedan con «cortar abertura» y
      # OpenCutList cuenta sus caras para el contenedor, que lleva el nombre.
      # Las iguales del mueble comparten definición (un renglón con cantidad).
      #
      # Devuelve la cantidad de contenedores unificados.
      # ---------------------------------------------------------------------
      def piezas_unicas(inst, lista)
        n = 0
        nombrados = {}
        Array(lista).each do |r|
          buscar_para_modificar(inst, r[:grupo].to_s).reject { |e| e == inst || oculto?(e) }.each do |grupo|
            next if piezas_con_caras(grupo.definition) < 2
            piezas_como_grupo(grupo.definition)
            nombrar_unica(grupo, r[:nombre].to_s, nombrados) unless r[:nombre].to_s.empty?
            n += 1
          end
        end
        n
      end

      def nombrar_unica(grupo, nombre, nombrados)
        firma  = firma_pieza(grupo.definition)
        gemela = (nombrados[nombre] ||= []).find { |d, f| d.valid? && f == firma }
        if gemela
          grupo.definition = gemela[0]
        else
          grupo.definition.name = nombre
          grupo.definition.set_attribute(DICT_STUDIO, 'compartida', true)
          nombrados[nombre] << [grupo.definition, firma]
        end
        [grupo, grupo.definition].each { |e| e.set_attribute(DICT, 'name', nombre) }
      end

      # ---------------------------------------------------------------------
      # Nombra cada pieza para el despiece. El nombre va en la definición y en
      # el atributo dinámico «name»: OpenCutList lee uno u otro según su
      # opción, y en la definición SketchUp agrega «#1» si se repite.
      #
      # reglas: [{ ruta:, nombre:, unidad:, segun: }]
      #   ruta   -> los últimos niveles del camino a la pieza, p. ej.
      #             ["LateralL", "Panel"]. Cada nivel se compara (con comodines
      #             de File.fnmatch) contra el _name del DC, el nombre de la
      #             instancia y el de la definición sin «#n».
      #   unidad -> lo de adentro cuenta como parte de la pieza (manijas,
      #             bisagras, golas de aluminio): un renglón por unidad.
      #   segun  -> { attr:, valores: { "0" => "DIVISOR" } }: el nombre depende
      #             de un atributo del camino, el mueble incluido (el divisor es
      #             la repisa de retiro 0; el piso del cajón Antaro, b02 = 2).
      #   dentro -> la pieza tiene que estar dentro de un nivel así (cualquiera
      #             del camino): «PuertaIZQ» para PUERTA IZQ.
      #   numerar-> «{n}» en el nombre: las que coinciden se numeran de arriba
      #             abajo (FRENTE CAJÓN 1 es el de más arriba).
      # La primera regla que coincide nombra la pieza y ya no se baja en ella.
      # Las iguales del mueble comparten definición (un renglón con cantidad).
      # Devuelve cuántas piezas nombró.
      # ---------------------------------------------------------------------
      def nombrar_piezas(inst, reglas)
        n = 0
        nombrados = {}
        por_numerar = []
        recorrer = lambda do |ent, camino, tr|
          ent.definition.entities.to_a.each do |hijo|
            next unless hijo.is_a?(Sketchup::ComponentInstance) && hijo.valid?
            next if oculto?(hijo)
            c = camino + [hijo]
            regla = reglas.find { |r| ruta_coincide?(c, r[:ruta]) && dentro?(camino, r[:dentro]) }
            unless regla
              recorrer.call(hijo, c, tr * hijo.transformation)
              next
            end
            # Los frentes llegan compartidos (unificar_frentes): cada uno se
            # separa para tomar su propio nombre; los iguales se vuelven a juntar.
            hijo.make_unique if hijo.definition.instances.size > 1
            piezas_como_grupo(hijo.definition) if regla[:unidad]
            if regla[:numerar]
              por_numerar << [hijo, nombre_segun(regla, c), (tr * hijo.bounds.center).z]
            else
              nombrar_unica(hijo, nombre_segun(regla, c), nombrados)
            end
            n += 1
          end
        end
        recorrer.call(inst, [inst], Geom::Transformation.new)
        por_numerar.sort_by { |_, _, z| -z }.each_with_index do |(hijo, nombre, _), i|
          nombrar_unica(hijo, nombre.gsub('{n}', (i + 1).to_s), nombrados)
        end
        n
      end

      def dentro?(camino, patron)
        return true if patron.to_s.empty?
        camino.any? { |e| etiquetas_pieza(e).any? { |t| File.fnmatch(patron.to_s, t) } }
      end

      def etiquetas_pieza(ent)
        [ent.get_attribute(DICT, '_name'), ent.definition.get_attribute(DICT, '_name'),
         ent.name, ent.definition.name.sub(/#\d+\z/, '')].map(&:to_s).reject(&:empty?)
      end

      def ruta_coincide?(camino, ruta)
        ruta = Array(ruta)
        return false if ruta.empty? || ruta.size > camino.size
        camino.last(ruta.size).zip(ruta).all? do |ent, patron|
          etiquetas_pieza(ent).any? { |t| File.fnmatch(patron.to_s, t) }
        end
      end

      def nombre_segun(regla, camino)
        s = regla[:segun]
        return regla[:nombre] unless s
        attr = s[:attr].to_s
        fuente = camino.reverse.find { |e| !(e.get_attribute(DICT, attr) || e.definition.get_attribute(DICT, attr)).nil? }
        v = fuente && (fuente.get_attribute(DICT, attr) || fuente.definition.get_attribute(DICT, attr))
        # El DC guarda los números como texto («0», «2.6») o como número.
        num = Float(v.to_s) rescue nil
        clave = num && num == num.round ? num.round.to_s : v.to_s
        (s[:valores] || {})[clave] || regla[:nombre]
      end

      # Componentes con caras propias debajo de una definición (lo que
      # OpenCutList contaría como piezas).
      def piezas_con_caras(defn)
        defn.entities.inject(0) do |tot, e|
          next tot unless e.is_a?(Sketchup::ComponentInstance) || e.is_a?(Sketchup::Group)
          next tot if oculto?(e)
          propias = e.is_a?(Sketchup::ComponentInstance) && e.definition.entities.grep(Sketchup::Face).any? ? 1 : 0
          tot + propias + piezas_con_caras(e.definition)
        end
      end

      # Marca toda la rama, contenedores incluidos: uno sin marcar que reciba
      # caras de sus hijos saldría él mismo como pieza.
      def piezas_como_grupo(defn)
        defn.entities.to_a.each do |e|
          next unless e.is_a?(Sketchup::ComponentInstance) || e.is_a?(Sketchup::Group)
          independizar(e)
          e.definition.behavior.cuts_opening = true if e.is_a?(Sketchup::ComponentInstance)
          piezas_como_grupo(e.definition)
        end
      end

      # ---------------------------------------------------------------------
      # Deja cada herraje compuesto (el juego de correderas de un cajón) como
      # UNA pieza para OpenCutList, con nombre de compra: «Corredera Tandem 50cm».
      #
      # Estructura (GABINETE.skp, 2026-10-12):
      #
      #   Cajon n > "Acc.CorrederaOculta - CD001" > Corr.OcultaIzq + Corr.OcultaDer
      #           > PartFija (grupo) + PartMovil… (componente) + BaseOCL
      #   (la telescópica es igual, bajo "Acc.CorrederaTelescopica - CD001")
      #
      #   - El contenedor es el juego (izquierda + derecha); su `leny` es el
      #     largo de la corredera: 51.0 cm para la que se vende como de 50.
      #   - OpenCutList nombra la pieza con el nombre de la DEFINICIÓN, y dos
      #     definiciones no pueden llamarse igual (la segunda sale con «#1»).
      #     Por eso los juegos idénticos comparten una sola definición: así
      #     salen en un renglón con su cantidad. Si después el componente
      #     dinámico redibuja uno, SketchUp lo vuelve a independizar.
      #
      # spec: { pieza:, nombre: (con «{cm}»), multiplo_cm: }
      # Devuelve la cantidad de herrajes unificados.
      # ---------------------------------------------------------------------
      def unificar_herrajes(inst, spec)
        multiplo = spec[:multiplo_cm].to_i
        multiplo = 1 if multiplo < 1
        n = 0
        buscar_para_modificar(inst, spec[:pieza].to_s).each do |pieza|
          next if pieza == inst || oculto?(pieza) || !pieza.is_a?(Sketchup::ComponentInstance)
          largo = pieza.get_attribute(DICT, 'leny') || pieza.definition.get_attribute(DICT, 'leny')
          next unless largo.is_a?(Numeric)
          # El largo nominal es el real hacia abajo: 51.0 cm -> 50.
          cm     = ((largo * 2.54 + 0.01) / multiplo).floor * multiplo
          nombre = spec[:nombre].to_s.sub('{cm}', cm.to_s)

          piezas_como_grupo(pieza.definition)
          gemela = pieza.model.definitions.find { |d| d != pieza.definition && mismo_herraje?(d, pieza.definition, nombre) }
          if gemela
            pieza.definition = gemela
          else
            pieza.definition.name = nombre
            pieza.definition.set_attribute(DICT_STUDIO, 'compartida', true)
          end
          # Para quien tenga OpenCutList leyendo el nombre del atributo dinámico.
          [pieza, pieza.definition].each { |e| e.set_attribute(DICT, 'name', nombre) }
          n += 1
        end
        n
      end

      # ¿+candidata+ es otra copia del mismo herraje ya nombrado? Mismo nombre
      # (o su «#n») y mismas medidas al décimo de milímetro.
      def mismo_herraje?(candidata, defn, nombre)
        return false unless candidata.valid? && !candidata.group? && !candidata.image?
        return false unless candidata.name == nombre || candidata.name =~ /\A#{Regexp.escape(nombre)}#\d+\z/
        a, b = candidata.bounds, defn.bounds
        [[a.width, b.width], [a.height, b.height], [a.depth, b.depth]].all? { |x, y| (x - y).abs < 0.1.mm }
      end

      # make_unique para lo que se va a modificar, salvo las piezas que este
      # motor dejó compartidas a propósito (frentes y herrajes idénticos):
      # separarlas les devolvería el «#1» al nombre.
      DICT_STUDIO = 'rk_studio'.freeze

      def independizar(ent)
        return if ent.definition.get_attribute(DICT_STUDIO, 'compartida')
        ent.make_unique if ent.definition.instances.size > 1
      end

      # ---------------------------------------------------------------------
      # Reescribe fórmulas de piezas internas del componente:
      #   [{ pieza:, hijos: (opcional), formulas: { "x" => "...", "lenx" => "..." } }]
      # +pieza+ se busca por nombre (instancia o definición) e independizando el
      # camino, para no tocar el componente base ni otras unidades. Con +hijos+
      # las fórmulas van a las instancias directas de la pieza cuya definición
      # contiene ese texto (todas las copias). Va antes del redibujado.
      # x/y/z se escriben también como _inst__x_formula en la definición, que
      # es de donde el DC las toma al volver a crear las copias.
      # Devuelve la lista de warnings.
      # ---------------------------------------------------------------------
      def formulas_piezas(inst, lista)
        warnings = []
        Array(lista).each do |r|
          piezas = buscar_para_modificar(inst, r[:pieza].to_s).reject { |e| e == inst }
          if piezas.empty?
            warnings << "Fórmulas: no se encontró la pieza '#{r[:pieza]}'."
            next
          end
          piezas.each do |pieza|
            independizar(pieza)
            blancos = if r[:hijos]
                        pieza.definition.entities.grep(Sketchup::ComponentInstance)
                             .select { |h| h.definition.name.include?(r[:hijos].to_s) }
                             .each { |h| independizar(h) }
                      else
                        [pieza]
                      end
            warnings << "Fórmulas: '#{r[:pieza]}' no tiene piezas '#{r[:hijos]}'." if blancos.empty?
            blancos.each { |b| escribir_formulas(b, r[:formulas]) }
          end
        end
        warnings
      end

      def escribir_formulas(ent, formulas)
        (formulas || {}).each do |key, formula|
          key = key.to_s.downcase
          ent.set_attribute(DICT, "_#{key}_formula", formula.to_s)
          ent.definition.set_attribute(DICT, "_#{key}_formula", formula.to_s)
          ent.definition.set_attribute(DICT, "_inst__#{key}_formula", formula.to_s) if %w[x y z].include?(key)
        end
      end

      # Oculto = la bandera de SketchUp o el atributo dinámico `hidden` en 1.
      # Se revisa el atributo porque el redibujado del DC no siempre alcanza a
      # propagar la bandera a las piezas más anidadas.
      def oculto?(ent)
        return true if ent.hidden?
        v = ent.get_attribute(DICT, 'hidden')
        return false if v.nil?
        v.to_s.strip.downcase =~ /\A(1|1\.0|true|yes)\z/ ? true : false
      end

      # ---------------------------------------------------------------------
      # Genera una unidad a partir de una fila plana { col => valor_raw }.
      #
      #   base_def       : Sketchup::ComponentDefinition ya cargada (definitions.load)
      #   nombre_salida  : nombre del archivo .skp / de la instancia
      #   fila_plana     : Hash de { "prefijo>attr" => "800mm", ... }
      #   opts:
      #     :output_dir          -> carpeta destino del .skp (obligatorio para guardar)
      #     :insertar_en_escena  -> true conserva la instancia en el modelo (SCOPE §3.1)
      #     :transformation      -> Geom::Transformation para colocarla (auto-tiling)
      #     :limpiar_ocultos     -> borra las variantes ocultas (default true)
      #     :divisores           -> { prefijo:, nombres: } para nombrar las divisiones
      #     :union               -> { grupo:, piezas:, nombre: } para fusionar mitades
      #     :unificar_frentes    -> cada frente compuesto queda como una pieza (OpenCutList);
      #                             true, o { nombre:, piezas: } para además nombrarla
      #     :herrajes            -> [{ pieza:, nombre:, multiplo_cm: }] herrajes como una pieza con nombre
      #     :purgar              -> purge_unused al final si se limpió (default true)
      #     :formulas_piezas     -> [{ pieza:, hijos:, formulas: {} }] antes del redibujado
      #     :piezas_unicas       -> [{ grupo:, nombre: }] contenedores que OpenCutList lista como una pieza
      #     :nombres_piezas      -> [{ ruta:, nombre:, unidad:, segun: }] nombre de cada pieza (nombrar_piezas)
      #
      # Devuelve { ok:, ruta:, instancia:, warnings: [] }.
      # ---------------------------------------------------------------------
      def generar_unidad(base_def, nombre_salida, fila_plana, opts = {})
        model    = Sketchup.active_model
        warnings = []
        nombre   = nombre_salida.to_s.strip
        nombre   = 'modulo' if nombre.empty?

        model.start_operation("Generar #{nombre}", true)

        begin
          tr   = opts[:transformation] || Geom::Transformation.new
          inst = model.entities.add_instance(base_def, tr)
          inst.make_unique
          inst.name = nombre

          fila_plana.each do |col, valor_raw|
            w = inyectar_atributo(inst, col, valor_raw)
            warnings << w if w
          end

          # Antes del redibujado: fórmulas de piezas internas que Studio
          # corrige (p. ej. la holgura de repisas, que no va en los divisores).
          if opts[:formulas_piezas]
            begin
              warnings.concat(formulas_piezas(inst, opts[:formulas_piezas]))
            rescue => e
              warnings << "Fórmulas de piezas: #{e.message}"
            end
          end

          # Fuerza el redibujado del componente dinámico.
          begin
            $dc_observers.get_latest_class.redraw_with_undo(inst)
          rescue => e
            warnings << "Renderizado: #{e.message}"
          end

          # Después del redibujado, porque antes las copias no existen, y antes
          # de la limpieza y el guardado para que los nombres lleguen al .skp.
          if opts[:divisores]
            begin
              warnings.concat(nombrar_divisores(inst, opts[:divisores]))
            rescue => e
              warnings << "Nombrado de divisores: #{e.message}"
            end
          end

          # Después del nombrado y antes de la limpieza: la unión destruye la
          # estructura dinámica del entrepaño, así que va al final de todo lo que
          # depende del componente dinámico, y antes del guardado para que las
          # piezas fusionadas lleguen al .skp.
          if opts[:union]
            begin
              warnings.concat(unir_piezas(inst, opts[:union]))
            rescue => e
              warnings << "Unión de entrepaños: #{e.message}"
            end
          end


          # Después del redibujado (ya se sabe qué quedó oculto) y antes de
          # guardar. Deja el .skp como pieza final: el DC ya no puede volver a
          # mostrar lo borrado, por eso la UI lo expone como interruptor.
          limpiar = opts.key?(:limpiar_ocultos) ? opts[:limpiar_ocultos] : true
          if limpiar
            begin
              borradas = eliminar_ocultos(inst)
              warnings << "Se eliminaron #{borradas} piezas ocultas." if borradas > 0
            rescue => e
              warnings << "Limpieza de ocultos: #{e.message}"
            end
          end

          # Después de la limpieza, para no contar ni marcar variantes ocultas.
          if opts[:unificar_frentes]
            begin
              spec = opts[:unificar_frentes]
              unificar_frentes(inst, spec.is_a?(Hash) ? spec : nil)
            rescue => e
              warnings << "Unificación de frentes: #{e.message}"
            end
          end

          # Contenedores que OpenCutList lista como UNA pieza (laterales con gola).
          if opts[:piezas_unicas]
            begin
              piezas_unicas(inst, opts[:piezas_unicas])
            rescue => e
              warnings << "Piezas para el despiece: #{e.message}"
            end
          end

          Array(opts[:herrajes]).each do |spec|
            begin
              unificar_herrajes(inst, spec)
            rescue => e
              warnings << "Unificación de herrajes: #{e.message}"
            end
          end

          # Al final: nombres del despiece para lo que quedó.
          if opts[:nombres_piezas]
            begin
              nombrar_piezas(inst, opts[:nombres_piezas])
            rescue => e
              warnings << "Nombres de piezas: #{e.message}"
            end
          end

          ruta = nil
          if opts[:output_dir]
            FileUtils.mkdir_p(opts[:output_dir])
            ruta = File.join(opts[:output_dir], "#{nombre}.skp")
            inst.definition.save_as(ruta)
          end

          # Salida doble (SCOPE §3.1): si no se inserta en escena, se borra la instancia.
          inst.erase! unless opts[:insertar_en_escena]

          # Al final: recoge tanto las definiciones que quedaron huérfanas por la
          # limpieza como las del árbol independizado si la instancia se borró.
          # `purgar: false` lo pide quien inserta en un proyecto ajeno (el
          # catálogo): purge_unused se llevaría definiciones de la diseñadora.
          model.definitions.purge_unused if limpiar && opts.fetch(:purgar, true)

          model.commit_operation
          { ok: true, ruta: ruta, instancia: (opts[:insertar_en_escena] ? inst : nil), warnings: warnings }
        rescue => e
          model.abort_operation
          { ok: false, error: e.message, warnings: warnings }
        end
      end

    end
  end
end
