require "json"
require "fileutils"
require_relative "familias"
require_relative "biblioteca"
require_relative "motor/engine"
require_relative "motor/plantilla"
require_relative "motor/importer"
require_relative "motor/rk_mitered"

module RoyalKitchens
  module Studio
    # Generar muebles desde una receta (fila plana del manifiesto) con el
    # componente base de la familia (componentes/*.skp) y el motor (motor/).
    #
    # Origen: RoyalKitchen::CatalogCreator (main.rb de KitchenCreator, commit
    # 4f6e3fb): validaciones de respaldo, generar, instanciar_receta,
    # publicar como creación, plantilla e importación. Desde Studio 0.4.0 vive
    # aquí. La UI valida primero con ui/receta.js; lo de aquí atrapa lo que no
    # pasó por ella (mismas reglas, espejo en Ruby).
    module Generador
      module_function

      TOL_IN  = 1.0 / 25.4 # 1 mm, en pulgadas
      ESPACIO_MM = 300     # aire entre un mueble insertado y el siguiente

      # ---- Carpetas -------------------------------------------------------------

      def componente(manifest)
        File.join(__dir__, manifest["componente_base"].to_s)
      end

      # Creaciones personalizadas: .skp + receta .json de cada mueble guardado.
      # Si Studio no tiene una, se hereda la que usaba KitchenCatalog.
      def creaciones_dir
        r = Preferencias.leer("creaciones_dir", "").to_s
        return r unless r.empty?
        viejo = Sketchup.read_default("KitchenCatalog", "creaciones_dir", "").to_s
        return viejo unless viejo.empty?
        File.join(Dir.home, "Documents", "Royal Kitchens", "Creaciones personalizadas")
      end

      def creaciones_dir=(dir)
        Preferencias.escribir("creaciones_dir", dir.to_s)
      end

      # A la derecha de todo lo que ya hay en el modelo.
      def siguiente_x(model)
        b = model.bounds
        return Geom::Transformation.new if b.empty?
        Geom::Transformation.new([b.max.x + ESPACIO_MM.mm, 0, 0])
      end

      # ---- Validación de respaldo (lógica pura) --------------------------------

      def medida_in(valores, attr)
        return nil unless valores.key?(attr)
        v = Engine.interpret(valores[attr])
        v.is_a?(Numeric) ? v.to_f : nil
      end

      def a_mm(pulgadas)
        (pulgadas * 25.4).round(1)
      end

      # { attr, valor } / { attr, valores } / { attr, excepto } / { todas } /
      # { alguna }. Un attr que no viene en la fila no cumple ningún «igual a».
      def condicion_cumple?(valores, cond)
        return cond["todas"].all? { |c| condicion_cumple?(valores, c) } if cond["todas"]
        return cond["alguna"].any? { |c| condicion_cumple?(valores, c) } if cond["alguna"]
        actual = valores[cond["attr"]].to_s
        return Array(cond["excepto"]).none? { |v| v.to_s == actual } if cond["excepto"]
        Array(cond["valores"] || [cond["valor"]]).any? { |v| v.to_s == actual }
      end

      def todas?(valores, conds)
        Array(conds).all? { |c| condicion_cumple?(valores, c) }
      end

      def medida_segun(valores, lista)
        hit = Array(lista).find { |e| todas?(valores, e["si"]) }
        (hit && medida_in(valores, hit["attr"])) || 0.0
      end

      # Alto de la zona 1 o 2 (fórmulas del componente: s01altofachada,
      # zn11altozona1, zn21altozona2).
      def alto_zona(reglas, valores, zona)
        fach = reglas["fachada"] || {}
        alto = medida_in(valores, fach["attr_alto"])
        return nil if alto.nil?
        Array(fach["restar"]).each { |a| v = medida_in(valores, a); alto -= v if v }
        alto -= medida_segun(valores, reglas["margen_superior"])

        z = reglas["zonas"] || {}
        return alto unless valores[z["attr_cantidad"]].to_s == "2"
        sep = medida_segun(valores, reglas["separacion"])
        sup = medida_in(valores, z["attr_alto_superior"])
        z1  = [1.0 / 25.4, sup && sup > 0 ? sup : (alto - sep) / 2.0].max
        zona == 1 ? z1 : [1.0 / 25.4, alto - sep - z1].max
      end

      def validar_pila(reglas, pila, valores)
        return nil unless todas?(valores, pila["si"])
        n = valores[pila["attr_cantidad"]].to_i
        return nil if n < 1

        tope = Array(pila["max"]).find { |e| todas?(valores, e["si"]) }
        return tope["mensaje"] || "Máximo #{tope['n']} cajones en esta zona." if tope && n > tope["n"].to_i

        zona = alto_zona(reglas, valores, pila["zona"].to_i)
        return nil if zona.nil?
        sep      = medida_segun(valores, reglas["separacion"])
        minimo   = reglas["alto_min_mm"]
        alto_min = minimo.to_f / 25.4
        disp     = zona - sep * (n - 1)
        return "La zona quedó en #{a_mm(zona)} mm. Revisa alto, zoclo, márgenes y alto de zonas." if disp <= 0

        igual    = disp / n
        personal = valores[pila["attr_modo"]].to_s == pila["valor_personalizado"].to_s
        unless personal
          return nil if igual >= alto_min - TOL_IN
          return "#{n} cajones iguales = #{a_mm(igual)} mm cada uno, por debajo del mínimo de #{minimo} mm."
        end

        altos = Array(pila["attrs_alto"]).first(n - 1).map do |attr|
          v = medida_in(valores, attr)
          v && v > 0 ? v : igual
        end
        bajo = altos.find { |v| v < alto_min - TOL_IN }
        return "El alto de un cajón (#{a_mm(bajo)} mm) es menor al mínimo de #{minimo} mm." if bajo
        ultimo = disp - altos.inject(0.0) { |s, v| s + v }
        if ultimo < alto_min - TOL_IN
          return "Al último cajón (el que toma el resto) le quedan #{a_mm(ultimo)} mm, " \
                 "por debajo del mínimo de #{minimo} mm."
        end
        nil
      end

      def validar_cajones(manifest, valores)
        reglas = manifest["reglas_cajones"]
        return nil unless reglas
        Array(reglas["pilas"]).each do |pila|
          err = validar_pila(reglas, pila, valores)
          return "#{pila['titulo'] || pila['id']}: #{err}" if err
        end
        nil
      end

      # Attrs de medida (campos `numero` y `preset`; un select puede llevar texto).
      def attrs_medida(manifest)
        campos(manifest).select { |c| %w[numero preset].include?(c["tipo"] || "numero") }.map { |c| c["attr"] }
      end

      def validar_medidas(manifest, valores)
        medidas = valores.select { |k, _v| attrs_medida(manifest).include?(k) }
        # "=formula" es la fórmula nativa del componente reinyectada a propósito.
        malos = medidas.select { |_k, v| (i = Engine.interpret(v)).is_a?(String) && !i.start_with?("=") }.keys
        return "No son medidas válidas: #{malos.join(', ')}." unless malos.empty?
        negativos = medidas.select { |_k, v| (n = Engine.interpret(v)).is_a?(Numeric) && n < 0 }.keys
        return "No pueden ser negativos: #{negativos.join(', ')}." unless negativos.empty?
        nil
      end

      def validar(manifest, valores)
        err = validar_medidas(manifest, valores)
        return err if err
        err = validar_cajones(manifest, valores)
        err && "Los cajones no caben. #{err}"
      end

      def campos(manifest)
        Array(manifest["grupos"]).flat_map { |g| Array(g["campos"]) }
      end

      def campo_por_attr(manifest, attr)
        campos(manifest).find { |c| c["attr"] == attr }
      end

      # Pulgadas que el manifiesto suma a un campo (`suma`, p. ej. zoclo en LenZ).
      def suma_in(manifest, campo, valores)
        Array(campo && campo["suma"]).inject(0.0) do |tot, s|
          next tot unless todas?(valores, s["si"])
          v = medida_in(valores, s["attr"])
          v ? tot + v : tot
        end
      end

      def capturado_mm(manifest, valores, attr)
        v = medida_in(valores, attr)
        return nil unless v
        a_mm(v - suma_in(manifest, campo_por_attr(manifest, attr), valores)).round
      end

      # Receta + cambios (campos del manifiesto, medida CAPTURADA) -> fila plana.
      # La `suma` se recalcula con los cambios puestos y solo en lo que se tocó.
      def aplicar_cambios(manifest, valores, cambios)
        valores = valores.dup
        (cambios || {}).each { |attr, v| valores[attr] = v.to_s }
        (cambios || {}).each_key do |attr|
          campo = campo_por_attr(manifest, attr)
          next unless campo && campo["suma"]
          base = medida_in(valores, attr)
          next unless base
          valores[attr] = "#{a_mm(base + suma_in(manifest, campo, valores))}mm"
        end
        valores
      end

      # Entrepaños y divisores ajustados en un proyecto ({ attr => valor de fila },
      # los escribe la UI): solo pasan los campos de los grupos con gráfico
      # (`visual`) del manifiesto; lo demás se descarta.
      def cambios_interior(manifest, interior)
        return {} unless interior.is_a?(Hash)
        permitidos = Array(manifest["grupos"]).select { |g| g["visual"] }
                                              .flat_map { |g| Array(g["campos"]).map { |c| c["attr"] } }
        interior.select { |attr, v| permitidos.include?(attr) && (v.is_a?(String) || v.is_a?(Numeric)) }
                .transform_values(&:to_s)
      end

      # ---- Creaciones -----------------------------------------------------------

      def etiqueta(manifest, attr, valor)
        c = campo_por_attr(manifest, attr)
        o = Array(c && c["opciones"]).find { |op| op["valor"].to_s == valor.to_s }
        o && o["label"]
      end

      # manifest.catalogo.caracteristicas: { grupo => [ { attr, valores?, prefijo? } ] }.
      def caracteristicas(manifest, valores)
        spec = (manifest["catalogo"] || {})["caracteristicas"] || {}
        spec.each_with_object({}) do |(grupo, lista), h|
          h[grupo] = Array(lista).map do |e|
            next unless valores.key?(e["attr"])
            v = valores[e["attr"]].to_s
            txt = e["valores"] ? e["valores"][v] : etiqueta(manifest, e["attr"], v)
            txt && "#{e['prefijo']}#{txt}"
          end.compact
        end
      end

      # Ficha de la creación (<nombre>.json junto a su .skp). La receta es lo que
      # permite volver a generarla con otras medidas o diseño.
      def ficha_creacion(familia, manifest, nombre, receta, ahora = Time.now, clase: nil, creado_por: nil)
        cat = manifest["catalogo"] || {}
        valores = receta["valores"]
        {
          "tipo"            => "creacion",
          "version"         => 1,
          "categoria"       => cat["categoria"] || manifest["titulo"],
          "clase"           => Biblioteca.clase(clase),
          "creado_por"      => (creado_por if Biblioteca.clase(clase) == "usuario"),
          "nombre"          => nombre,
          "familia"         => familia,
          "caracteristicas" => caracteristicas(manifest, valores),
          "ubicacion"       => cat["ubicacion"],
          "medidas_mm"      => {
            "ancho" => capturado_mm(manifest, valores, "LenX"),
            "alto"  => capturado_mm(manifest, valores, "LenZ"),
            "fondo" => capturado_mm(manifest, valores, "LenY")
          },
          "receta"          => receta,
          "creado"          => ahora.strftime("%Y-%m-%dT%H:%M:%S"),
          "origen"          => "#{PLUGIN_NAME} #{VERSION}"
        }
      end

      # ---- SketchUp -------------------------------------------------------------

      def divisores_opts(div)
        return nil unless div.is_a?(Hash) && div["nombres"].is_a?(Array) && !div["nombres"].empty?
        { prefijo: div["prefijo"].to_s, nombres: div["nombres"].map(&:to_s) }
      end

      def union_opts(manifest)
        uni = manifest["reglas_union"]
        return nil unless uni.is_a?(Hash) && uni["grupo"] && uni["nombre"] && uni["piezas"].is_a?(Array)
        { grupo: uni["grupo"].to_s, piezas: uni["piezas"].map(&:to_s), nombre: uni["nombre"].to_s }
      end

      # manifest.reglas_herrajes: [ { pieza, nombre, attr_tipo, multiplo_cm } ].
      # «{tipo}» se resuelve aquí con la etiqueta de la opción elegida (o la de
      # su default); «{cm}» lo pone el motor, que es quien mide la pieza.
      def herrajes_opts(manifest, valores)
        lista = Array(manifest["reglas_herrajes"]).map do |h|
          next unless h.is_a?(Hash) && h["pieza"] && h["nombre"]
          campo = campo_por_attr(manifest, h["attr_tipo"])
          valor = valores[h["attr_tipo"]] || (campo && campo["default"])
          tipo  = etiqueta(manifest, h["attr_tipo"], valor).to_s
          { pieza: h["pieza"].to_s, nombre: h["nombre"].to_s.sub("{tipo}", tipo).squeeze(" "),
            multiplo_cm: (h["multiplo_cm"] || 1).to_i }
        end.compact
        lista.empty? ? nil : lista
      end

      # manifest.reglas_frentes: { nombre, attr_linea, piezas }. «{linea}» se
      # resuelve aquí con la etiqueta de la línea de frente; «{pieza}» lo pone
      # el motor. Sin regla, los frentes se unifican sin renombrar.
      def frentes_opts(manifest, valores)
        r = manifest["reglas_frentes"]
        return true unless r.is_a?(Hash) && r["nombre"]
        campo = campo_por_attr(manifest, r["attr_linea"])
        valor = valores[r["attr_linea"]] || (campo && campo["default"])
        linea = etiqueta(manifest, r["attr_linea"], valor).to_s
        { nombre: r["nombre"].to_s.sub("{linea}", linea), piezas: r["piezas"] || {} }
      end

      # Genera un mueble desde la fila plana +valores+.
      #   insertar: queda en la escena (a la derecha de lo que hay)
      #   publicar: se guarda en Creaciones (.skp + receta), con su origen:
      #             +clase+ («catalogo» o «usuario», ver Biblioteca::CLASES) y,
      #             si es de usuario, +creado_por+ { "usuario", "nombre" }
      # Una sola generación para las dos cosas. Devuelve
      # { "ok", "error", "avisos", "publicado" }.
      def generar(familia, nombre, valores, divisores: nil, insertar: true, publicar: false, transformation: nil, clase: nil, creado_por: nil)
        manifest = Familias.manifiesto(familia)
        err = validar(manifest, valores)
        return { "ok" => false, "error" => err } if err
        base_path = componente(manifest)
        return { "ok" => false, "error" => "No está el componente base de #{manifest['titulo']}:\n#{base_path}" } unless File.exist?(base_path)

        RK::Mitered.instalar_hook
        model = Sketchup.active_model
        antes = sueltas(model)
        base_def = model.definitions.load(base_path)
        opts = {
          insertar_en_escena: insertar,
          limpiar_ocultos:    true,
          unificar_frentes:   frentes_opts(manifest, valores),
          herrajes:           herrajes_opts(manifest, valores),
          purgar:             false, # purge_unused borraría definiciones de la diseñadora
          transformation:     transformation || siguiente_x(model),
          output_dir:         publicar ? creaciones_dir : nil,
          divisores:          divisores_opts(divisores),
          union:              union_opts(manifest)
        }.compact
        res = Engine.generar_unidad(base_def, nombre, valores, opts)
        quitar_definiciones_nuevas(model, antes)
        out = { "ok" => res[:ok], "error" => res[:error], "avisos" => res[:warnings] || [] }
        if publicar && res[:ok]
          receta = { "valores" => valores }
          receta["divisores"] = divisores if opts[:divisores]
          File.write(File.join(creaciones_dir, "#{nombre}.json"),
                     JSON.pretty_generate(ficha_creacion(familia, manifest, nombre, receta, clase: clase, creado_por: creado_por)))
          # Una foto vieja con el mismo nombre ya no corresponde.
          FileUtils.rm_f(File.join(creaciones_dir, "#{nombre}.png"))
          out["publicado"] = true
        end
        out
      end

      # Una creación con otros cambios (medidas, frente, manija, material…).
      # +divisores+: nombres de las divisiones si los cambios mueven su cantidad
      # o tipo (los resuelve la UI); si no, valen los de la receta.
      def instanciar_receta(familia, receta, cambios, nombre: nil, transformation: nil, divisores: nil)
        manifest = Familias.manifiesto(familia)
        valores = aplicar_cambios(manifest, receta["valores"] || {}, cambios)
        generar(familia, nombre || "modulo", valores, divisores: divisores || receta["divisores"],
                transformation: transformation)
      end

      # Definiciones que se alcanzan desde la escena (instancias y grupos,
      # recursivo). persistent_id => true.
      def alcanzables(model)
        vistos = {}
        pila = model.entities.select { |e| e.respond_to?(:definition) }.map(&:definition)
        until pila.empty?
          d = pila.pop
          next if vistos[d.persistent_id]
          vistos[d.persistent_id] = true
          d.entities.each { |e| pila << e.definition if e.respond_to?(:definition) }
        end
        vistos
      end

      # Lo que ya estaba fuera de la escena antes de generar (componentes que la
      # diseñadora guarda sin usar): eso no se toca.
      def sueltas(model)
        vivas = alcanzables(model)
        model.definitions.each_with_object({}) { |d, h| h[d.persistent_id] = true unless vivas[d.persistent_id] }
      end

      # Retira lo que esta generación dejó fuera de la escena (no purge_unused).
      # No basta con «nuevas y sin instancias»: al cargar el componente base,
      # SketchUp reutiliza las definiciones anidadas que ya están en el modelo
      # (las de un gabinete insertado antes) y las copias nuevas quedan
      # colgando de ellas, con instancias pero fuera de la escena.
      def quitar_definiciones_nuevas(model, sueltas_antes)
        vivas = alcanzables(model)
        basura = model.definitions.to_a.reject do |d|
          vivas[d.persistent_id] || sueltas_antes[d.persistent_id] || d.image?
        end
        return if basura.empty?
        model.start_operation("Limpiar componente base", true, false, true)
        basura.each { |d| model.definitions.remove(d) if d.valid? }
        model.commit_operation
      rescue => e
        model.abort_operation
        warn "[#{PLUGIN_NAME}] limpieza de definiciones: #{e.message}"
      end

      # ---- Plantilla e importación ---------------------------------------------

      PLANTILLA_BASE = "plantilla_importacion_royal_kitchens".freeze

      # Descarga la plantilla .xlsx (sin selector de ruta: DEV-28 de KitchenCreator,
      # el diálogo de guardado se confundía con el de importar).
      def exportar_plantilla
        ruta = ruta_libre(carpeta_descargas, PLANTILLA_BASE, ".xlsx")
        Plantilla.exportar(ruta, Familias.manifiestos.to_a)
        { "ok" => true, "ruta" => ruta, "carpeta" => File.dirname(ruta) }
      rescue => e
        { "ok" => false, "error" => e.message }
      end

      # Tabla en crudo + modelo de columnas + manifiestos; ui/receta.js valida.
      def importar_archivo
        ruta = UI.openpanel("Elegir archivo a importar", carpeta_descargas, "Plantilla|*.xlsx;*.csv;*.txt||")
        return { "ok" => false, "cancelado" => true } unless ruta
        res = Importer.leer(ruta)
        return res unless res["ok"]
        mans = Familias.manifiestos
        res.merge("ruta" => ruta, "modelo" => Plantilla.modelo(mans.to_a), "manifiestos" => mans)
      rescue => e
        { "ok" => false, "error" => e.message }
      end

      # Downloads/Descargas del usuario (o la redirigida por OneDrive).
      def carpeta_descargas
        home = Dir.home.tr("\\", "/")
        raices = [home]
        one = ENV["OneDrive"] || ENV["OneDriveConsumer"]
        raices << one.tr("\\", "/") if one && !one.empty?
        raices.product(%w[Downloads Descargas]).map { |r, n| File.join(r, n) }.find { |d| File.directory?(d) } || home
      end

      # Nunca pisa un archivo: numera como el navegador.
      def ruta_libre(dir, base, ext)
        ruta = File.join(dir, base + ext)
        n = 1
        while File.exist?(ruta)
          ruta = File.join(dir, "#{base} (#{n})#{ext}")
          n += 1
        end
        ruta
      end
    end
  end
end
