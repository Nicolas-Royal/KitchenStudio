require "json"

module RoyalKitchens
  module Studio
    # Configuración del proyecto de cocina: el diseño global (frente, manija,
    # material, tarja, medidas comunes) y lo que cada módulo personaliza.
    #
    # Se guarda en el propio .skp (viaja con el proyecto) y además como
    # «última usada», que es el punto de partida de un modelo nuevo.
    module Proyecto
      module_function

      DICT     = "RK_Proyecto".freeze
      CLAVE    = "config".freeze
      SECCION  = "RoyalKitchensStudio".freeze
      VERSION_DATOS = 1

      DEFAULT = {
        "version" => VERSION_DATOS,
        "global"  => {
          "frente"   => "1",   # Lisa
          "manija"   => "9",   # Andrea
          "material" => "",    # "" = el de la receta / el del módulo
          "tarja"    => false,
          # Medidas comunes: si «igualar» está activo, los gabinetes toman este
          # alto y fondo de cuerpo; el ancho siempre es de cada módulo.
          "medidas"  => { "igualar" => false, "alto" => 770, "fondo" => 578 }
        },
        # id del módulo => { "personalizado" => true, "frente" =>…, "medidas" => {…} }
        "modulos" => {}
      }.freeze

      # ---- Lógica pura -----------------------------------------------------

      # Completa lo que falte con los valores por defecto y descarta basura,
      # para que la interfaz siempre reciba la misma forma.
      def normalizar(data)
        data = {} unless data.is_a?(Hash)
        g = data["global"].is_a?(Hash) ? data["global"] : {}
        base = DEFAULT["global"]
        medidas = base["medidas"].merge(g["medidas"].is_a?(Hash) ? g["medidas"] : {})
        global = base.merge(g.slice(*base.keys)).merge("medidas" => medidas)
        global["tarja"] = global["tarja"] == true
        modulos = (data["modulos"].is_a?(Hash) ? data["modulos"] : {}).select { |k, v| k.is_a?(String) && v.is_a?(Hash) }
        { "version" => VERSION_DATOS, "global" => global, "modulos" => modulos }
      end

      def parse(json)
        normalizar(json.to_s.empty? ? {} : JSON.parse(json))
      rescue JSON::ParserError
        normalizar({})
      end

      # ---- SketchUp ----------------------------------------------------------

      def leer(model = Sketchup.active_model)
        guardado = model && model.get_attribute(DICT, CLAVE)
        return parse(guardado) if guardado
        parse(Sketchup.read_default(SECCION, "ultimo_proyecto", ""))
      end

      # Sin start_operation: es metadato del proyecto, no geometría, y no
      # debe aparecer en el historial de deshacer de la diseñadora.
      def guardar(data, model = Sketchup.active_model)
        limpio = normalizar(data)
        json = JSON.generate(limpio)
        model.set_attribute(DICT, CLAVE, json) if model
        # La última usada solo lleva el diseño global: las personalizaciones
        # son de los módulos de ESE proyecto.
        Sketchup.write_default(SECCION, "ultimo_proyecto", JSON.generate(limpio.merge("modulos" => {})))
        limpio
      end
    end
  end
end
