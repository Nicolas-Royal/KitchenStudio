require "json"

module RoyalKitchens
  module Studio
    # Preferencias de Studio en esta PC (Sketchup.read/write_default).
    #
    # OJO: en SketchUp 2022 write_default no guarda bien un texto con comillas
    # (un JSON vuelve como nil) y las barras invertidas de una ruta de Windows
    # tampoco son confiables. Por eso el texto se guarda en base64 con el
    # prefijo "b64:"; un valor viejo sin prefijo se lee tal cual.
    module Preferencias
      module_function

      SECCION = "RoyalKitchensStudio".freeze
      PREFIJO = "b64:".freeze

      # ---- Lógica pura -----------------------------------------------------

      def codificar(texto)
        PREFIJO + [texto.to_s.dup.force_encoding("UTF-8")].pack("m0")
      end

      def decodificar(valor)
        return valor unless valor.is_a?(String) && valor.start_with?(PREFIJO)
        valor[PREFIJO.size..-1].unpack("m0").first.force_encoding("UTF-8")
      rescue ArgumentError
        nil
      end

      # ---- SketchUp ----------------------------------------------------------

      def leer(clave, defecto = nil)
        v = decodificar(Sketchup.read_default(SECCION, clave, nil))
        v.nil? ? defecto : v
      end

      def escribir(clave, texto)
        Sketchup.write_default(SECCION, clave, codificar(texto))
      end

      def leer_json(clave, defecto)
        t = leer(clave, "").to_s
        t.empty? ? defecto : JSON.parse(t)
      rescue JSON::ParserError
        defecto
      end

      def escribir_json(clave, data)
        escribir(clave, JSON.generate(data))
      end
    end
  end
end
