module RoyalKitchens
  module Studio
    # Comprobación de los dos plugins que Studio usa como motores. Studio no
    # copia su lógica: si falta uno, lo dice en la interfaz en vez de fallar.
    module Puente
      module_function

      MINIMOS = { "catalogo" => "0.3.0", "creador" => "1.2.0" }.freeze

      def catalogo?
        defined?(KitchenCatalog::Catalog) && defined?(KitchenCatalog::Configurador) &&
          KitchenCatalog::Catalog.respond_to?(:scan_creaciones) ? true : false
      end

      def creador?
        defined?(RoyalKitchen::CatalogCreator) &&
          RoyalKitchen::CatalogCreator.respond_to?(:instanciar_receta) ? true : false
      end

      def version_catalogo
        defined?(KitchenCatalog::VERSION) ? KitchenCatalog::VERSION : nil
      end

      def version_creador
        defined?(RoyalKitchen::CatalogCreator::VERSION) ? RoyalKitchen::CatalogCreator::VERSION : nil
      end

      def estado
        {
          "catalogo" => dep("Catálogo de Módulos", version_catalogo, MINIMOS["catalogo"], catalogo?),
          "creador"  => dep("Royal Catalog Creator", version_creador, MINIMOS["creador"], creador?)
        }
      end

      def dep(nombre, version, minimo, cargado)
        ok = cargado && version && version_ok?(version, minimo)
        { "nombre" => nombre, "version" => version, "minimo" => minimo, "cargado" => cargado, "ok" => ok ? true : false }
      end

      def version_ok?(version, minimo)
        Gem::Version.new(version.to_s) >= Gem::Version.new(minimo.to_s)
      rescue ArgumentError
        false
      end

      # Código del formulario de KitchenCreator (validación, aplanado,
      # importación). La interfaz lo evalúa aparte y usa window.RCC_CORE: una
      # sola implementación de las reglas, no un tercer espejo.
      def rcc_core_js
        return nil unless creador?
        path = File.join(RoyalKitchen::CatalogCreator::HTML_DIR, "js", "app.js")
        File.exist?(path) ? File.read(path, encoding: "utf-8") : nil
      end
    end
  end
end
