require "json"

module RoyalKitchens
  module Studio
    # Quién usa esta PC: lo que se escribe en el registro como «actualizado por».
    # Sin contraseña: la seguridad real la dan los permisos de la carpeta de
    # proyectos (hoy local, mañana el servidor).
    module Usuario
      module_function

      SECCION = "RoyalKitchensStudio".freeze
      ROLES   = %w[diseno planeacion].freeze

      # ---- Lógica pura -----------------------------------------------------

      def normalizar(data, usuario_windows)
        data = {} unless data.is_a?(Hash)
        rol = ROLES.include?(data["rol"]) ? data["rol"] : "diseno"
        {
          "usuario" => usuario_windows.to_s.strip.empty? ? "usuario" : usuario_windows.to_s.strip,
          "nombre"  => data["nombre"].to_s.strip,
          "sede"    => data["sede"].to_s.strip,
          "rol"     => rol
        }
      end

      # Lo que se guarda en el registro como autor.
      def firma(u)
        { "usuario" => u["usuario"], "nombre" => u["nombre"].empty? ? u["usuario"] : u["nombre"], "sede" => u["sede"] }
      end

      # ---- SketchUp ----------------------------------------------------------

      def usuario_windows
        ENV["USERNAME"] || ENV["USER"] || "usuario"
      end

      def actual
        guardado = begin
          JSON.parse(Sketchup.read_default(SECCION, "usuario", "{}").to_s)
        rescue JSON::ParserError
          {}
        end
        normalizar(guardado, usuario_windows)
      end

      def guardar(data)
        u = normalizar(data, usuario_windows)
        Sketchup.write_default(SECCION, "usuario", JSON.generate(u.reject { |k, _| k == "usuario" }))
        u
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
