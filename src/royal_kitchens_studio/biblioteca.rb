require "json"

module RoyalKitchens
  module Studio
    # Catálogo de muebles de Studio: las recetas guardadas en la carpeta de
    # creaciones (<nombre>.json). Se llena con lo que se guarda desde
    # «Avanzado» o desde un CSV. Desde 0.6.3 no se guarda .skp: todo se
    # vuelve a generar desde el componente base (un .skp viejo se ignora).
    #
    # Origen del formato: KitchenCatalog::Catalog.scan_creaciones (las fichas
    # que ya existan siguen sirviendo). Desde Studio 0.5.0 no hay catálogo
    # aparte: el de KitchenCatalog se dejó de usar.
    module Biblioteca
      module_function

      CATEGORIAS     = %w[Gabinetes Alacenas Esquineros Torres Decoraciones].freeze
      SIN_CLASIFICAR = "Sin clasificar".freeze
      GRUPOS         = %w[tipo puerta configuracion].freeze
      # Origen del mueble (ficha["clase"]): «catalogo» entró por CSV (el catálogo
      # de la empresa); «usuario» lo creó o alteró alguien desde «Avanzado»
      # (ficha["creado_por"]). Las fichas sin clase son de catálogo.
      CLASES         = %w[catalogo usuario].freeze

      # ---- Lógica pura -----------------------------------------------------

      def slug(str)
        str.to_s.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/\A-+|-+\z/, "")
      end

      def clase(valor)
        valor = "usuario" if valor.to_s == "personalizado" # nombre de las primeras fichas
        CLASES.include?(valor.to_s) ? valor.to_s : CLASES.first
      end

      # Ficha (<stem>.json) -> card para la UI, o nil si no trae receta.
      def card(info, json_path)
        return nil unless info.is_a?(Hash) && info["receta"].is_a?(Hash)
        stem    = File.basename(json_path, ".json")
        feats   = info["caracteristicas"].is_a?(Hash) ? info["caracteristicas"] : {}
        medidas = info["medidas_mm"].is_a?(Hash) ? info["medidas_mm"] : {}
        specs = { "sku" => stem }
        %w[ancho alto fondo].each { |k| specs["#{k}_mm"] = medidas[k] if medidas[k] }
        {
          "id"             => "cr-#{slug(stem)}",
          "name"           => info["nombre"] || stem,
          "category"       => info["categoria"] || SIN_CLASIFICAR,
          "clase"          => clase(info["clase"]),
          "creado_por"     => (info["creado_por"] if info["creado_por"].is_a?(Hash)),
          "features"       => GRUPOS.each_with_object({}) { |g, h| h[g] = Array(feats[g]) },
          "ubicacion"      => info["ubicacion"],
          "specs"          => specs,
          "receta_familia" => info["familia"],
          "receta"         => info["receta"],
          "creado"         => info["creado"],
          "_file"          => json_path,
          "_source"        => "creaciones"
        }
      end

      # Categorías fijas primero (aunque estén vacías) y luego las demás.
      def categorias(modulos)
        CATEGORIAS + (modulos.map { |m| m["category"] }.compact.uniq - CATEGORIAS).sort
      end

      # ---- Disco -----------------------------------------------------------

      def leer_ficha(path)
        data = JSON.parse(File.read(path, encoding: "bom|utf-8"))
        data.is_a?(Hash) ? data : {}
      rescue JSON::ParserError, SystemCallError
        {}
      end

      def modulos(dir)
        return [] if dir.to_s.empty? || !File.directory?(dir)
        unicos(Dir.glob(File.join(dir, "*.json")).sort.map { |j| card(leer_ficha(j), j) }.compact)
      end

      # Dos archivos pueden dar el mismo id («GAB 600» y «GAB-600»): el segundo
      # recibe un sufijo para que los dos se puedan abrir y ninguno tape al otro.
      def unicos(cards)
        vistos = Hash.new(0)
        cards.each do |c|
          n = (vistos[c["id"]] += 1)
          c["id"] = "#{c['id']}-#{n}" if n > 1
        end
        cards
      end

      # Mueble (nombre) que ya ocupa +nombre+ en la carpeta, o nil: mismo id en
      # una ficha o en un .skp suelto. Guardar encima lo reemplazaría.
      def existente(dir, nombre)
        return nil if dir.to_s.empty? || !File.directory?(dir)
        s = slug(nombre)
        Dir.glob(File.join(dir, "*.{json,skp}")).map { |f| File.basename(f, ".*") }.find { |stem| slug(stem) == s }
      end

      def buscar(dir, id)
        modulos(dir).find { |m| m["id"] == id.to_s } or raise "No encontré «#{id}» en el catálogo."
      end

      # ---- SketchUp ----------------------------------------------------------

      # «Usar» con su diseño original: la receta tal cual, generada desde el
      # componente base (sin .skp guardado).
      def insertar_tal_cual(m, transformation: nil)
        Generador.instanciar_receta(m["receta_familia"], m["receta"], {}, nombre: m["specs"]["sku"],
                                    transformation: transformation)
      end

      # ---- Muebles en la escena ----------------------------------------------
      #
      # Cada mueble insertado recuerda de qué mueble del catálogo salió y con
      # qué diseño entró: «global» (el del proyecto), «personal» (ajustado) u
      # «original». «Aplicar el diseño» regenera solo los «global».

      DICT_ESCENA = "RK_Studio_Mueble".freeze

      def marcar(inst, id, modo)
        return unless inst && inst.valid?
        model = inst.model
        model.start_operation("Marcar mueble", true, false, true)
        inst.set_attribute(DICT_ESCENA, "modulo", id.to_s)
        inst.set_attribute(DICT_ESCENA, "modo", modo.to_s)
        model.commit_operation
      end

      # Id del mueble del catálogo que sigue el diseño del proyecto, o nil.
      # Con marca: si entró con el del proyecto. Sin marca (insertado antes de
      # 0.7): por el nombre de la instancia (el sku), si es de un solo mueble
      # y ese mueble no tiene elección propia en el proyecto.
      def sigue_proyecto(marca, nombre, modulos, proyecto)
        if marca["modulo"]
          return marca["modo"].to_s == "global" ? marca["modulo"].to_s : nil
        end
        return nil if nombre.to_s.empty?
        cands = modulos.select { |m| (m["specs"] || {})["sku"].to_s == nombre.to_s }
        return nil unless cands.size == 1
        id = cands.first["id"]
        (proyecto["modulos"] || {})[id] ? nil : id
      end

      # Muebles de la escena que siguen el diseño del proyecto: id => [instancias].
      # Busca en la raíz y dentro de grupos, no dentro de otros componentes.
      def en_escena(model, modulos, proyecto)
        out = Hash.new { |h, k| h[k] = [] }
        pila = [model.entities]
        until pila.empty?
          pila.pop.each do |e|
            if e.is_a?(Sketchup::Group)
              pila << e.entities
            elsif e.is_a?(Sketchup::ComponentInstance)
              d = e.attribute_dictionary(DICT_ESCENA)
              marca = d ? { "modulo" => d["modulo"], "modo" => d["modo"] } : {}
              id = sigue_proyecto(marca, e.name, modulos, proyecto)
              out[id] << e if id
            end
          end
        end
        out
      end
    end
  end
end
