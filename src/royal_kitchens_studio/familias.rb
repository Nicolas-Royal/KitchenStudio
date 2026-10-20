require "json"

module RoyalKitchens
  module Studio
    # Manifiestos de las familias de muebles (familias/*.json): campos del
    # formulario, reglas y mapeo a las variables del componente. Los lee la
    # interfaz (ui/receta.js) para «Avanzado» y la importación de CSV.
    #
    # Origen: KitchenCreator/plugin/royal_catalog_creator/manifest. Desde
    # Studio 0.4 viven aquí y se editan aquí.
    module Familias
      module_function

      DIR = File.join(__dir__, "familias").freeze
      # Orden de la plantilla de importación. La interfaz trabaja gabinete y
      # alacena (FAMILIAS_ACTIVAS en app.js); el esquinero viene después.
      IDS = %w[gabinete alacena esquinero].freeze

      def ruta(familia)
        File.join(DIR, "#{familia.to_s.gsub(/[^a-z0-9_]/i, '')}.json")
      end

      def manifiesto(familia)
        r = ruta(familia)
        raise "No hay manifiesto para «#{familia}»." unless File.exist?(r)
        JSON.parse(File.read(r, encoding: "bom|utf-8"))
      end

      def manifiestos
        IDS.to_h { |f| [f, manifiesto(f)] }
      end
    end
  end
end
