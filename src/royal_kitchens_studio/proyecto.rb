require "json"

module RoyalKitchens
  module Studio
    # Configuración del proyecto de cocina: el diseño global (frente, manija,
    # material, medidas comunes) y lo que cada módulo personaliza.
    #
    # Se guarda en el propio .skp (viaja con el proyecto) y además como
    # «última usada», que es el punto de partida de un modelo nuevo.
    module Proyecto
      module_function

      DICT     = "RK_Proyecto".freeze
      CLAVE    = "config".freeze
      VERSION_DATOS = 1

      DEFAULT = {
        "version" => VERSION_DATOS,
        "global"  => {
          "frente"   => "1",   # Lisa
          # La manija se elige aparte para puertas y para cajones.
          "manija_puerta" => "9",   # Andrea
          "manija_cajon"  => "9",
          "material" => "SIN_MATERIAL", # blanco: el diseñador entra y elige uno
          # Gola (opciones.json golas[].id): "" = la del módulo; "tirador" = sin
          # gola; melamina / aluminio claro / oscuro. Con gola, L-C ("1") o L-L ("2").
          "gola" => "",
          "gola_combinacion" => "1",
          # Medidas comunes: si «igualar» está activo, los gabinetes toman este
          # alto y fondo de cuerpo. El ancho y la tarja son siempre de cada mueble.
          "medidas"  => { "igualar" => false, "alto" => 770, "fondo" => 600 }
        },
        # id del módulo => { "personalizado" => true, "frente" =>…, "medidas" => {…} }
        "modulos" => {}
      }.freeze

      # ---- Lógica pura -----------------------------------------------------

      # Completa lo que falte con los valores por defecto y descarta basura,
      # para que la interfaz siempre reciba la misma forma.
      def normalizar(data)
        data = {} unless data.is_a?(Hash)
        g = data["global"].is_a?(Hash) ? manijas(data["global"]) : {}
        base = DEFAULT["global"]
        # Solo las claves vigentes: un proyecto viejo puede traer «ancho» o «tarja» globales.
        medidas = base["medidas"].merge((g["medidas"].is_a?(Hash) ? g["medidas"] : {}).slice(*base["medidas"].keys))
        global = base.merge(g.slice(*base.keys)).merge("medidas" => medidas)
        global["material"] = sin_vacio(global["material"])
        modulos = (data["modulos"].is_a?(Hash) ? data["modulos"] : {}).select { |k, v| k.is_a?(String) && v.is_a?(Hash) }
        modulos = modulos.transform_values { |v| m = manijas(v); m.key?("material") ? m.merge("material" => sin_vacio(m["material"])) : m }
        { "version" => VERSION_DATOS, "global" => global, "modulos" => modulos }
      end

      # Ya no hay «Como el módulo» (material ""): un proyecto viejo pasa a
      # «Sin material» (blanco), que es el default.
      def sin_vacio(material)
        material.to_s.empty? ? DEFAULT["global"]["material"] : material.to_s
      end

      # Antes de 0.3.1 había una sola "manija" para puertas y cajones.
      def manijas(d)
        return d unless d.key?("manija")
        d = d.dup
        m = d.delete("manija")
        d["manija_puerta"] = m unless d.key?("manija_puerta")
        d["manija_cajon"]  = m unless d.key?("manija_cajon")
        d
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
        parse(Preferencias.leer("ultimo_proyecto", ""))
      end

      # Sin start_operation: es metadato del proyecto, no geometría, y no
      # debe aparecer en el historial de deshacer de la diseñadora.
      def guardar(data, model = Sketchup.active_model)
        limpio = normalizar(data)
        json = JSON.generate(limpio)
        model.set_attribute(DICT, CLAVE, json) if model
        # La última usada solo lleva el diseño global: las personalizaciones
        # son de los módulos de ESE proyecto.
        Preferencias.escribir_json("ultimo_proyecto", limpio.merge("modulos" => {}))
        limpio
      end
    end
  end
end
