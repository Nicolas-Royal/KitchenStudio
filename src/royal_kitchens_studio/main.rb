require "sketchup.rb"

require_relative "preferencias"
require_relative "biblioteca"
require_relative "proyecto"
require_relative "catalogo"
require_relative "familias"
require_relative "generador"
require_relative "usuario"
require_relative "registro"
require_relative "sincronia"
require_relative "acabado"
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
      icono = File.join(__dir__, "ui", "icon.png")
      if File.exist?(icono)
        cmd.small_icon = icono
        cmd.large_icon = icono
      end
      barra.add_item(cmd)
      barra.restore

      # La configuración del proyecto vive en cada .skp: al abrir o crear otro
      # modelo, el diálogo vuelve a leerla.
      Sketchup.add_observer(Dialogo::ObservadorApp.new)
      Dialogo.vigilar(Sketchup.active_model)
      Sincronia.modelo_cambio(Sketchup.active_model)

      # Cada minuto: sube lo que quedó pendiente (sin conexión) y renueva el
      # candado del proyecto abierto.
      @conectado = Registro.disponible?
      UI.start_timer(60, true) do
        next if Dialogo.trabajando? # p. ej. con un «¿Guardar cambios?» abierto
        conectado = Registro.disponible?
        subidos = Sincronia.tick
        Dialogo.refrescar if subidos.any? || conectado != @conectado
        @conectado = conectado
      end
    end
  end
end
