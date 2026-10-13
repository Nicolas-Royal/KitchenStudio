require "json"

module RoyalKitchens
  module Studio
    # Catálogo de muebles de Studio: las recetas guardadas en la carpeta de
    # creaciones (<nombre>.json con la receta + <nombre>.skp ya generado).
    # Se llena con lo que se genera desde «Avanzado» o desde un CSV.
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
        dir     = File.dirname(json_path)
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
          "skp"            => File.join(dir, "#{stem}.skp"),
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
        Dir.glob(File.join(dir, "*.json")).sort.map { |j| card(leer_ficha(j), j) }.compact
      end

      def buscar(dir, id)
        modulos(dir).find { |m| m["id"] == id.to_s } or raise "No encontré «#{id}» en el catálogo."
      end

      # ---- SketchUp ----------------------------------------------------------

      # «Usar»: el .skp ya generado, tal cual (sin los 15 s de generar). Si no
      # está, se vuelve a generar desde la receta.
      def insertar_tal_cual(m)
        model = Sketchup.active_model
        unless File.exist?(m["skp"].to_s)
          return Generador.instanciar_receta(m["receta_familia"], m["receta"], {}, nombre: m["specs"]["sku"])
        end
        model.start_operation("Insertar #{m['name']}", true)
        defn = model.definitions.load(m["skp"])
        inst = model.active_entities.add_instance(defn, Generador.siguiente_x(model))
        inst.name = m["specs"]["sku"].to_s
        model.commit_operation
        { "ok" => true, "avisos" => [] }
      rescue => e
        model&.abort_operation
        raise e
      end
    end
  end
end
