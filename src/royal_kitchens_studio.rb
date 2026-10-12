require "sketchup.rb"
require "extensions.rb"

# Royal Kitchens Studio: el plugin de Royal Kitchens para diseñar cocinas en
# SketchUp. Proyectos compartidos, diseño global (frente, manija, material),
# catálogo de muebles por receta y generación desde el componente base. No
# necesita otros plugins.
module RoyalKitchens
  module Studio
    PLUGIN_ID   = "royal_kitchens_studio".freeze
    PLUGIN_NAME = "Royal Kitchens Studio".freeze
    VERSION     = "0.6.2".freeze

    unless defined?(@registrado)
      @registrado = true
      ext = SketchupExtension.new(PLUGIN_NAME, File.join(__dir__, PLUGIN_ID, "main.rb"))
      ext.version     = VERSION
      ext.creator     = "Royal Kitchens"
      ext.copyright   = "© 2026 Royal Kitchens"
      ext.description = "Proyectos, diseño, catálogo y generación de muebles de cocina en una sola ventana."
      Sketchup.register_extension(ext, true)
    end
  end
end
