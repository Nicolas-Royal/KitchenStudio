module RoyalKitchens
  module Studio
    # Lo único que Studio todavía toma de otro plugin: KitchenCatalog (lista de
    # módulos y creaciones, insertar un módulo del catálogo, crear el material).
    # Se borra al terminar la migración (fase 2c, docs/ARQUITECTURA.md).
    module Puente
      module_function

      MINIMO = "0.3.0".freeze

      def catalogo?
        defined?(KitchenCatalog::Catalog) && defined?(KitchenCatalog::Configurador) &&
          KitchenCatalog::Catalog.respond_to?(:scan_creaciones) ? true : false
      end

      def version_catalogo
        defined?(KitchenCatalog::VERSION) ? KitchenCatalog::VERSION : nil
      end

      def estado
        { "catalogo" => dep("Catálogo de Módulos", version_catalogo, MINIMO, catalogo?) }
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
    end
  end
end
