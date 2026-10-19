module RoyalKitchens
  module Studio
    # Cómo se ve el mueble en el modelo según la fase del proyecto.
    #
    # Cantos: el componente base pinta cara por cara los cantos con materiales
    # de cubrecanto de OpenCutList (tipo 4: «SinCanto» amarillo, «CANTO
    # EXTERIOR» rojo). Sirven al despiece, no al diseño: hasta «Enviado a
    # planeación» esas caras van sin material propio (toman el de su pieza,
    # que está en la instancia) y el canto se guarda en la cara para
    # devolverlo cuando el proyecto llega a planeación.
    #
    # Veta: los materiales de madera del catálogo no tienen foto; se les pone
    # la textura de TEKA ARTICO-VESTO1 (veta recta) teñida con su color. La
    # vista previa de la UI tiñe la misma imagen con la misma fórmula.
    module Acabado
      module_function

      DICT        = "RK_Canto".freeze
      OCL         = "ladb_opencutlist".freeze
      OCL_CANTO   = 4 # tipo «edge» de OpenCutList
      # Estados en los que el modelo es de Planeación y se ven los cantos.
      CON_CANTOS  = %w[planeacion fabricacion entregado].freeze

      # ---- Lógica pura -----------------------------------------------------

      # "diseno" (cantos con el material de su pieza) o "planeacion" (cantos
      # de OpenCutList a la vista). Sin proyecto: diseño.
      def modo_para(estado)
        CON_CANTOS.include?(estado.to_s) ? "planeacion" : "diseno"
      end

      # Luminancia (0-255) de un pixel; la misma fórmula del filtro de la vista
      # previa (RKVista, feColorMatrix).
      LUMA = [0.299, 0.587, 0.114].freeze

      # Tiñe la textura base de veta (bytes BGR o BGRA de +bpp+ bits) con
      # +hex+: cada pixel = color × su luminancia / +media+ (la luminancia
      # media de la textura). El promedio queda en el color y la veta se
      # conserva. Cada fila de +ancho+ pixeles trae +relleno+ bytes al final
      # (ImageRep alinea las filas a 4 bytes). Devuelve [BGR de 24 bits con su
      # propio relleno a 4 bytes, ese relleno].
      def tenir(datos, bpp, hex, media, ancho, relleno = 0)
        r, g, b = hex.to_s.delete("#").scan(/../).map { |c| c.to_i(16) }
        raise ArgumentError, "color inválido: #{hex}" unless r && g && b && hex.to_s.delete("#").size == 6
        # Tabla por luminancia entera: un lookup por pixel en vez de 3 multiplicaciones.
        tabla = Array.new(256) { |l| [b, g, r].map { |c| (c * l / media).round.clamp(0, 255) }.pack("C3") }
        paso = bpp / 8
        fila_in = ancho * paso + relleno
        relleno_out = (4 - (ancho * 3) % 4) % 4
        cola = "\0".b * relleno_out
        filas = datos.bytesize / fila_in
        out = String.new(capacity: filas * (ancho * 3 + relleno_out), encoding: Encoding::BINARY)
        filas.times do |y|
          i = y * fila_in
          fin = i + ancho * paso
          while i < fin
            # BGR: el byte i es azul, i + 2 es rojo.
            l = (LUMA[0] * datos.getbyte(i + 2) + LUMA[1] * datos.getbyte(i + 1) + LUMA[2] * datos.getbyte(i)).round
            out << tabla[l]
            i += paso
          end
          out << cola
        end
        [out, relleno_out]
      end

      # ---- SketchUp ----------------------------------------------------------

      def canto?(material)
        return false unless material
        material.get_attribute(OCL, "type").to_i == OCL_CANTO
      end

      # Caras de +defs+ (definiciones; por omisión todas las del modelo) y de
      # la raíz del modelo.
      def caras(model, defs = nil)
        listas = (defs || model.definitions.to_a).reject(&:image?).map(&:entities)
        listas << model.entities if defs.nil?
        listas.flat_map { |ents| ents.grep(Sketchup::Face) }
      end

      # Pone el modelo (o solo +defs+) en el modo de +estado+. Devuelve
      # cuántas caras cambió.
      def aplicar(model, estado, defs = nil)
        modo_para(estado) == "planeacion" ? mostrar_cantos(model, defs) : ocultar_cantos(model, defs)
      end

      def ocultar_cantos(model, defs = nil)
        objetivo = caras(model, defs).select { |f| canto?(f.material) || canto?(f.back_material) }
        return 0 if objetivo.empty?
        model.start_operation("Cantos para diseño", true, false, true)
        objetivo.each do |f|
          if canto?(f.material)
            f.set_attribute(DICT, "material", f.material.name)
            f.material = nil
          end
          if canto?(f.back_material)
            f.set_attribute(DICT, "atras", f.back_material.name)
            f.back_material = nil
          end
        end
        model.commit_operation
        objetivo.size
      end

      def mostrar_cantos(model, defs = nil)
        objetivo = caras(model, defs).select { |f| f.get_attribute(DICT, "material") || f.get_attribute(DICT, "atras") }
        return 0 if objetivo.empty?
        model.start_operation("Cantos para planeación", true, false, true)
        objetivo.each do |f|
          if (n = f.get_attribute(DICT, "material")) && (mat = model.materials[n])
            f.material = mat
            f.delete_attribute(DICT, "material")
          end
          if (n = f.get_attribute(DICT, "atras")) && (mat = model.materials[n])
            f.back_material = mat
            f.delete_attribute(DICT, "atras")
          end
        end
        model.commit_operation
        objetivo.size
      end

      # Definiciones de una instancia recién generada (ella y todo lo de adentro).
      def arbol(inst)
        vistos = {}
        pila = [inst.definition]
        until pila.empty?
          d = pila.pop
          next if vistos[d]
          vistos[d] = true
          d.entities.each { |e| pila << e.definition if e.respond_to?(:definition) }
        end
        vistos.keys
      end

      # ---- Canto de los frentes según el material ---------------------------
      #
      # El componente base trae «CANTO EXTERIOR» en los 4 cantos de las puertas
      # y tapas de cajón lisas (en el DC, piezas dentro de «Puerta» o «Tapa»).
      # Así va el MDF (Lisa de 18 mm). La madera es de 22 mm y no lleva chapa:
      # esos cantos pasan a «SinCanto». Solo los frentes; la estructura no
      # cambia. Cada mueble generado tiene sus propias definiciones.
      FRENTES     = %w[Puerta Tapa].freeze
      CANTO_ROJO  = "CANTO EXTERIOR".freeze
      SIN_CANTO   = "SinCanto".freeze
      DC          = "dynamic_attributes".freeze

      def nombre_dc(e)
        e.get_attribute(DC, "_name") || e.definition.get_attribute(DC, "_name")
      end

      # Material (id del catálogo) de un mueble generado, o nil.
      def material_de(inst, attr)
        inst.get_attribute(DC, attr) || inst.definition.get_attribute(DC, attr)
      end

      # Caras de las puertas y tapas de +inst+.
      def caras_frente(inst)
        caras = []
        vistos = {}
        pila = [[inst.definition, false]]
        until pila.empty?
          d, en_frente = pila.pop
          next if vistos[[d, en_frente]]
          vistos[[d, en_frente]] = true
          caras.concat(d.entities.grep(Sketchup::Face)) if en_frente
          d.entities.each do |e|
            pila << [e.definition, en_frente || FRENTES.include?(nombre_dc(e))] if e.respond_to?(:definition)
          end
        end
        caras.uniq
      end

      # Pasa a SinCanto el canto rojo de los frentes de +inst+, a la vista o
      # guardado para planeación. Devuelve cuántos cantos cambió.
      def frentes_sin_canto(model, inst)
        sin = model.materials[SIN_CANTO]
        objetivo = caras_frente(inst).select do |f|
          [f.material, f.back_material].any? { |m| m && m.name == CANTO_ROJO } ||
            [f.get_attribute(DICT, "material"), f.get_attribute(DICT, "atras")].include?(CANTO_ROJO)
        end
        return 0 if objetivo.empty?
        model.start_operation("Frentes sin canto", true, false, true)
        objetivo.each do |f|
          f.material = sin if f.material && f.material.name == CANTO_ROJO
          f.back_material = sin if f.back_material && f.back_material.name == CANTO_ROJO
          %w[material atras].each do |k|
            next unless f.get_attribute(DICT, k) == CANTO_ROJO
            sin ? f.set_attribute(DICT, k, SIN_CANTO) : f.delete_attribute(DICT, k)
          end
        end
        model.commit_operation
        objetivo.size
      end

      # Los muebles de +ents+ (dentro de grupos también) con su material de
      # frente (opciones.json → familias.<f>.material.attr).
      def muebles(ents, attr, out = [])
        ents.each do |e|
          next unless e.is_a?(Sketchup::ComponentInstance) || e.is_a?(Sketchup::Group)
          if e.is_a?(Sketchup::ComponentInstance) && material_de(e, attr)
            out << e
          elsif e.is_a?(Sketchup::Group)
            muebles(e.entities, attr, out)
          end
        end
        out
      end

      # Aplica la regla a +insts+ (por omisión, todos los muebles del modelo).
      def frentes_segun_material(model, insts = nil)
        op = Catalogo.cargar
        attrs = (op["familias"] || {}).values.map { |f| f.dig("material", "attr") }.compact.uniq
        attrs.each do |attr|
          (insts || muebles(model.entities, attr)).each do |inst|
            next unless inst.valid?
            mat = material_de(inst, attr)
            frentes_sin_canto(model, inst) if mat && !Catalogo.canto_frente?(op, mat)
          end
        end
      rescue StandardError => e
        puts "[RK Studio] cantos de frentes: #{e.message}"
      end

      # Estado del proyecto ligado a +model+ (nil sin proyecto o sin conexión).
      def estado_de(model)
        folio = Sincronia.folio_de(model)
        return nil unless folio && Registro.disponible?
        reg = Registro.leer(folio)
        reg && reg["estado"]
      rescue StandardError
        nil
      end

      # Al abrir o activar un modelo, y al cambiar de estado. Sin conexión no
      # se sabe la fase: el modelo se queda como está.
      def sincronizar(model)
        return unless model
        Catalogo.marcar_tableros(model)
        frentes_segun_material(model)
        folio = Sincronia.folio_de(model)
        estado = estado_de(model)
        return if folio && estado.nil?
        aplicar(model, estado)
      end

      # Después de generar o colocar un mueble: solo sus definiciones.
      def mueble_nuevo(model, inst)
        return unless inst && inst.valid?
        frentes_segun_material(model, [inst])
        folio = Sincronia.folio_de(model)
        estado = estado_de(model)
        return if folio && estado.nil?
        aplicar(model, estado, arbol(inst))
      end

      # Sube si cambia cómo se genera la veta: los materiales que Studio ya
      # generó se vuelven a generar.
      VETA_VERSION = 3

      def marca_veta(hex)
        "#{hex}|#{VETA_VERSION}"
      end

      # ¿Hay que (re)generar la veta? Sin textura, o con una veta de Studio
      # de otra versión. Una textura puesta a mano no se toca.
      def falta_veta?(material, hex)
        return true if material.texture.nil?
        marca = material.get_attribute("RK_Studio", "veta")
        !marca.nil? && marca != marca_veta(hex)
      end

      # Material de madera sin foto: la textura base de veta (opciones.json →
      # textura_veta: la de TEKA ARTICO-VESTO1, veta recta) teñida con su
      # color, del mismo tamaño en mm que la original. +base+ = { "ruta",
      # "ancho_mm", "alto_mm", "luminancia" }.
      def poner_veta(material, hex, base)
        @veta_base = nil unless @veta_base && @veta_base[:ruta] == base["ruta"]
        @veta_base ||= begin
          rep = Sketchup::ImageRep.new(base["ruta"])
          { ruta: base["ruta"], ancho: rep.width, alto: rep.height, bpp: rep.bits_per_pixel,
            relleno: rep.row_padding, datos: rep.data }
        end
        vb = @veta_base
        datos, relleno = tenir(vb[:datos], vb[:bpp], hex, base["luminancia"].to_f, vb[:ancho], vb[:relleno])
        rep = Sketchup::ImageRep.new
        rep.set_data(vb[:ancho], vb[:alto], 24, relleno, datos)
        material.texture = rep
        material.texture.size = [base["ancho_mm"].to_f.mm, base["alto_mm"].to_f.mm]
        material.set_attribute("RK_Studio", "veta", marca_veta(hex))
      end
    end
  end
end
