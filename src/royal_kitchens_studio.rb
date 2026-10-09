require "sketchup.rb"
require "extensions.rb"

# Royal Kitchens Studio: una sola ventana para diseñar con el Catálogo de
# Módulos (KitchenCatalog) y Royal Catalog Creator (KitchenCreator). No
# reemplaza a ninguno: los usa como motores (catálogo, fotos e inserción de
# uno; manifiestos, validación y generación del otro).
module RoyalKitchens
  module Studio
    PLUGIN_ID   = "royal_kitchens_studio".freeze
    PLUGIN_NAME = "Royal Kitchens Studio".freeze
    VERSION     = "0.3.1".freeze

    unless defined?(@registrado)
      @registrado = true
      ext = SketchupExtension.new(PLUGIN_NAME, File.join(__dir__, PLUGIN_ID, "main.rb"))
      ext.version     = VERSION
      ext.creator     = "Royal Kitchens"
      ext.copyright   = "© 2026 Royal Kitchens"
      ext.description = "Proyecto, catálogo, creaciones y generación de módulos de cocina en una sola " \
                        "interfaz. Requiere Catálogo de Módulos 0.3+ y Royal Catalog Creator 1.2+."
      Sketchup.register_extension(ext, true)
    end
  end
end
