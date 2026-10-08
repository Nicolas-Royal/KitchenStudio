require "sketchup.rb"

require_relative "puente"
require_relative "proyecto"
require_relative "dialogo"

module RoyalKitchens
  module Studio
    unless defined?(@cargado)
      @cargado = true

      UI.menu("Extensions").add_item(PLUGIN_NAME) { Dialogo.mostrar }

      barra = UI::Toolbar.new(PLUGIN_NAME)
      cmd = UI::Command.new(PLUGIN_NAME) { Dialogo.mostrar }
      cmd.tooltip         = PLUGIN_NAME
      cmd.status_bar_text = "Diseñar la cocina con el catálogo de módulos de Royal Kitchens"
      icono = File.join(__dir__, "ui", "icon.svg")
      if File.exist?(icono)
        cmd.small_icon = icono
        cmd.large_icon = icono
      end
      barra.add_item(cmd)
      barra.restore

      # La configuración del proyecto vive en cada .skp: al abrir o crear otro
      # modelo, el diálogo vuelve a leerla.
      Sketchup.add_observer(Dialogo::ObservadorApp.new)
    end
  end
end
