require "json"

module RoyalKitchens
  module Studio
    # Quién usa Studio: lo que se escribe en el registro como «actualizado por».
    #
    # PROTOTIPO: el login acepta cualquier correo y contraseña (la contraseña
    # no se guarda ni se revisa). El plan es entrar con la cuenta de Microsoft
    # 365 de la empresa; la seguridad real la darán los permisos de la carpeta
    # compartida de proyectos.
    module Usuario
      module_function

      SECCION = "RoyalKitchensStudio".freeze
      ROLES   = %w[diseno planeacion].freeze
      CORREO  = /\A[^@\s]+@[^@\s]+\.[^@\s]+\z/.freeze

      # ---- Lógica pura -----------------------------------------------------

      # +usuario+ (la clave con la que se filtran «mis proyectos» y los
      # candados) sale del correo; sin correo, del usuario de Windows.
      def normalizar(data, usuario_windows)
        data = {} unless data.is_a?(Hash)
        rol = ROLES.include?(data["rol"]) ? data["rol"] : "diseno"
        correo = data["correo"].to_s.strip.downcase
        usuario = correo.empty? ? usuario_windows.to_s.strip : correo.split("@").first
        {
          "usuario" => usuario.empty? ? "usuario" : usuario,
          "correo"  => correo,
          "nombre"  => data["nombre"].to_s.strip,
          "sede"    => data["sede"].to_s.strip,
          "rol"     => rol
        }
      end

      # Lo que se guarda en el registro como autor.
      def firma(u)
        { "usuario" => u["usuario"], "nombre" => u["nombre"].empty? ? u["usuario"] : u["nombre"], "sede" => u["sede"] }
      end

      def error_login(correo, password)
        return "Escribe tu correo." if correo.to_s.strip.empty?
        return "Ese correo no parece válido." unless correo.to_s.strip =~ CORREO
        return "Escribe tu contraseña." if password.to_s.empty?
        nil
      end

      # «ana.lopez@…» -> «Ana Lopez»: nombre de arranque hasta que lo cambie.
      def nombre_de_correo(correo)
        correo.to_s.split("@").first.to_s.split(/[._\-]+/).reject(&:empty?).map(&:capitalize).join(" ")
      end

      # Datos de la sesión nueva: si es el mismo correo de antes se conservan
      # nombre y sede; si es otro, se empieza con el nombre del correo.
      def para_sesion(previo, correo, rol)
        correo = correo.to_s.strip.downcase
        mismo = previo["correo"].to_s == correo
        {
          "correo" => correo,
          "nombre" => mismo && !previo["nombre"].to_s.empty? ? previo["nombre"] : nombre_de_correo(correo),
          "sede"   => mismo ? previo["sede"].to_s : "",
          "rol"    => ROLES.include?(rol) ? rol : "diseno"
        }
      end

      # ---- SketchUp ----------------------------------------------------------

      def usuario_windows
        ENV["USERNAME"] || ENV["USER"] || "usuario"
      end

      def guardado
        d = Preferencias.leer_json("usuario", {})
        d.is_a?(Hash) ? d : {}
      end

      def actual
        normalizar(guardado, usuario_windows)
      end

      def guardar(data)
        u = normalizar(guardado.merge(data.reject { |k, _| k == "correo" }), usuario_windows)
        Preferencias.escribir_json("usuario", u.reject { |k, _| k == "usuario" })
        u
      end

      def sesion?
        Sketchup.read_default(SECCION, "sesion", false) == true
      end

      # Devuelve { "ok" } o { "ok" => false, "error" }.
      def iniciar(correo, password, rol)
        err = error_login(correo, password)
        return { "ok" => false, "error" => err } if err
        u = normalizar(para_sesion(guardado, correo, rol), usuario_windows)
        Preferencias.escribir_json("usuario", u.reject { |k, _| k == "usuario" })
        Sketchup.write_default(SECCION, "sesion", true)
        { "ok" => true }
      end

      def cerrar_sesion
        Sketchup.write_default(SECCION, "sesion", false)
      end

      def configurado?
        !actual["nombre"].empty?
      end

      def planeacion?
        actual["rol"] == "planeacion"
      end
    end
  end
end
