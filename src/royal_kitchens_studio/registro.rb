require "json"
require "time"
require "fileutils"

module RoyalKitchens
  module Studio
    # Registro de proyectos: una carpeta por proyecto dentro del «almacén»
    # (hoy una carpeta local; mañana la del servidor u OneDrive, sin cambiar
    # código). Cada carpeta tiene su proyecto.json: no hay índice compartido
    # que dos personas escriban a la vez.
    #
    #   <almacén>/<FOLIO>/proyecto.json, modelo.skp, miniatura.png,
    #                     versiones/vNNNN_….skp, abierto_por.json
    module Registro
      module_function

      VERSION_DATOS = 1
      MANTENER      = 10           # versiones normales que se conservan
      CANDADO_VENCE = 30 * 60      # s sin latido = el candado ya no cuenta

      ESTADOS = [
        %w[diseno En\ diseño],
        %w[revision Revisión\ con\ cliente],
        %w[aprobado Aprobado],
        %w[planeacion Enviado\ a\ planeación],
        %w[fabricacion En\ fabricación],
        %w[entregado Entregado]
      ].freeze
      IDS_ESTADO = ESTADOS.map(&:first).freeze
      # Diseño mueve el proyecto hasta entregarlo a planeación; desde ahí es de
      # Planeación, que puede avanzarlo o devolverlo a diseño con una nota.
      DE_DISENO      = %w[diseno revision aprobado].freeze
      DE_PLANEACION  = %w[planeacion fabricacion entregado].freeze
      CONGELA        = "planeacion".freeze

      CAMPOS = %w[cliente telefono fecha_compromiso notas].freeze
      RESERVADOS = %w[CON PRN AUX NUL COM1 COM2 COM3 COM4 COM5 COM6 COM7 COM8 COM9
                      LPT1 LPT2 LPT3 LPT4 LPT5 LPT6 LPT7 LPT8 LPT9].freeze

      # ---- Lógica pura -----------------------------------------------------

      def hora(t)
        t.utc.iso8601
      end

      def tiempo(iso)
        Time.iso8601(iso.to_s)
      rescue ArgumentError
        nil
      end

      def folio_limpio(folio)
        folio.to_s.strip.gsub(/\s+/, " ")
      end

      # Nombre de carpeta seguro en Windows para el folio.
      def carpeta_de(folio)
        folio_limpio(folio).gsub(%r{[<>:"/\\|?*\x00-\x1f]}, "-").sub(/[. ]+\z/, "")
      end

      # nil si sirve; si no, el motivo. +existentes+: carpetas ya registradas.
      def error_folio(folio, existentes)
        f = folio_limpio(folio)
        return "Escribe el folio del proyecto." if f.empty?
        return "El folio es demasiado largo (máx. 60 caracteres)." if f.length > 60
        c = carpeta_de(f)
        return "Ese folio no sirve como nombre de carpeta." if c.empty? || RESERVADOS.include?(c.upcase)
        return "Ya existe un proyecto con el folio «#{f}»." if existentes.any? { |e| e.to_s.casecmp?(c) }
        nil
      end

      def nuevo(datos, firma, ahora)
        datos = {} unless datos.is_a?(Hash)
        f = folio_limpio(datos["folio"])
        marca = firma.merge("fecha" => hora(ahora))
        normalizar(
          CAMPOS.to_h { |k| [k, datos[k].to_s.strip] }.merge(
            "folio" => f, "carpeta" => carpeta_de(f), "estado" => "diseno",
            "disenadora" => firma, "creado" => marca, "actualizado" => marca.merge("nota" => "Proyecto creado"),
            "eventos" => [{ "fecha" => hora(ahora), "por" => firma["nombre"], "tipo" => "creado" }]
          )
        )
      end

      def normalizar(data)
        data = {} unless data.is_a?(Hash)
        r = CAMPOS.to_h { |k| [k, data[k].to_s] }
        r["folio"]   = folio_limpio(data["folio"])
        r["carpeta"] = data["carpeta"].to_s.empty? ? carpeta_de(r["folio"]) : data["carpeta"].to_s
        r["estado"]  = IDS_ESTADO.include?(data["estado"]) ? data["estado"] : "diseno"
        %w[disenadora creado actualizado].each { |k| r[k] = data[k].is_a?(Hash) ? data[k] : {} }
        r["version_actual"]    = data["version_actual"].to_i
        r["version_congelada"] = data["version_congelada"] ? data["version_congelada"].to_i : nil
        r["diseno_global"]     = data["diseno_global"].is_a?(Hash) ? data["diseno_global"] : nil
        r["historial"] = (data["historial"].is_a?(Array) ? data["historial"] : []).select { |h| h.is_a?(Hash) && h["v"] }
        r["eventos"]   = (data["eventos"].is_a?(Array) ? data["eventos"] : []).select { |h| h.is_a?(Hash) }
        r["version_datos"] = VERSION_DATOS
        r
      end

      def transicion_permitida?(de, a, rol)
        return false if de == a || !IDS_ESTADO.include?(a)
        origen = rol == "planeacion" ? DE_PLANEACION : DE_DISENO
        destinos = rol == "planeacion" ? DE_PLANEACION + ["diseno"] : DE_DISENO + [CONGELA]
        origen.include?(de) && destinos.include?(a)
      end

      # { "diseno" => { "diseno" => [...], ... }, "planeacion" => {...} } para la UI.
      def transiciones
        %w[diseno planeacion].to_h do |rol|
          [rol, IDS_ESTADO.to_h { |de| [de, IDS_ESTADO.select { |a| transicion_permitida?(de, a, rol) }] }]
        end
      end

      # Los números de versión no se repiten nunca (las copias de conflicto
      # también ocupan número).
      def siguiente_version(reg)
        ([reg["version_actual"].to_i] + reg["historial"].map { |h| h["v"].to_i }).max + 1
      end

      def nombre_version(v, ahora, usuario, conflicto = false)
        u = usuario.to_s.gsub(/[^\w-]/, "")
        format("v%04d_%s_%s%s.skp", v, ahora.localtime.strftime("%Y-%m-%d_%H%M"), u, conflicto ? "_conflicto" : "")
      end

      # Hay que guardar como conflicto si otra persona subió una versión
      # después de la que se descargó.
      def conflicto?(version_base, version_actual)
        version_actual.to_i > version_base.to_i
      end

      # Agrega la versión al historial. Una copia de conflicto no se vuelve la
      # vigente: queda en el historial para revisarla.
      def registrar_version(reg, v, archivo, firma, ahora, nota, conflicto: false)
        reg["historial"] << { "v" => v, "fecha" => hora(ahora), "por" => firma["nombre"], "usuario" => firma["usuario"],
                              "nota" => nota.to_s, "archivo" => archivo, "congelada" => false, "conflicto" => conflicto }
        unless conflicto
          reg["version_actual"] = v
          reg["actualizado"] = firma.merge("fecha" => hora(ahora), "nota" => nota.to_s)
        end
        reg
      end

      # Archivos de versiones que sobran: se conservan las últimas MANTENER
      # normales, todas las congeladas y las de conflicto (hasta resolverlas).
      def podar(reg, mantener = MANTENER)
        normales = reg["historial"].reject { |h| h["congelada"] || h["conflicto"] }.sort_by { |h| -h["v"].to_i }
        sobran = normales.drop(mantener)
        reg["historial"] -= sobran
        sobran.map { |h| h["archivo"] }
      end

      def cambiar_estado(reg, a, firma, ahora, nota)
        de = reg["estado"]
        reg["estado"] = a
        ev = { "fecha" => hora(ahora), "por" => firma["nombre"], "tipo" => "estado", "de" => de, "a" => a, "nota" => nota.to_s }
        if a == CONGELA && reg["version_actual"] > 0
          reg["version_congelada"] = reg["version_actual"]
          h = reg["historial"].find { |x| x["v"] == reg["version_actual"] }
          h["congelada"] = true if h
          ev["version"] = reg["version_actual"]
        end
        reg["eventos"] << ev
        reg
      end

      def cambios_despues_de_congelar?(reg)
        reg["version_congelada"] ? reg["version_actual"].to_i > reg["version_congelada"].to_i : false
      end

      def candado_vigente?(candado, ahora)
        return false unless candado.is_a?(Hash)
        t = tiempo(candado["latido"])
        t ? (ahora - t) < CANDADO_VENCE : false
      end

      def candado_ajeno?(candado, usuario, ahora)
        candado_vigente?(candado, ahora) && candado["usuario"] != usuario
      end

      # ---- Archivos ----------------------------------------------------------

      def leer_json(path)
        File.exist?(path) ? JSON.parse(File.read(path, encoding: "utf-8")) : nil
      rescue JSON::ParserError, SystemCallError
        nil
      end

      # Escribe en un temporal y renombra: si se corta la conexión a media
      # escritura, el archivo anterior queda intacto.
      def escribir_json(path, data)
        tmp = "#{path}.#{Process.pid}.tmp"
        File.write(tmp, JSON.pretty_generate(data), encoding: "utf-8")
        File.rename(tmp, path)
      ensure
        FileUtils.rm_f(tmp) if tmp && File.exist?(tmp)
      end

      def copiar_seguro(origen, destino)
        tmp = "#{destino}.#{Process.pid}.tmp"
        FileUtils.cp(origen, tmp)
        File.rename(tmp, destino)
      ensure
        FileUtils.rm_f(tmp) if tmp && File.exist?(tmp)
      end

      # ---- Almacén y carpeta local ----------------------------------------

      def raiz_por_defecto
        File.join(Dir.home, "Documents", "Royal Kitchens", "Proyectos")
      end

      def raiz
        r = Preferencias.leer("carpeta_proyectos", "").to_s
        r.empty? ? raiz_por_defecto : r
      end

      def raiz=(dir)
        Preferencias.escribir("carpeta_proyectos", dir.to_s)
      end

      # La carpeta por defecto se crea sola; una configurada (servidor) no:
      # si no está, es que no hay conexión.
      def disponible?
        r = raiz
        FileUtils.mkdir_p(r) if r == raiz_por_defecto && !File.directory?(r)
        File.directory?(r)
      rescue SystemCallError
        false
      end

      def local_dir
        File.join(ENV["LOCALAPPDATA"] || Dir.home, "RoyalKitchensStudio")
      end

      def dir_de(folio)
        File.join(raiz, carpeta_de(folio))
      end

      def archivo(folio, nombre)
        File.join(dir_de(folio), nombre)
      end

      def leer(folio)
        d = leer_json(archivo(folio, "proyecto.json"))
        d ? normalizar(d) : nil
      end

      def escribir(reg)
        escribir_json(archivo(reg["folio"], "proyecto.json"), reg)
      end

      def candado(folio)
        leer_json(archivo(folio, "abierto_por.json"))
      end

      def carpetas_existentes
        return [] unless disponible?
        Dir.children(raiz).select { |c| File.directory?(File.join(raiz, c)) }
      end

      def crear(datos, firma, ahora = Time.now)
        err = error_folio(datos && datos["folio"], carpetas_existentes)
        raise err if err
        reg = nuevo(datos, firma, ahora)
        FileUtils.mkdir_p(File.join(dir_de(reg["folio"]), "versiones"))
        escribir(reg)
        reg
      end

      # Lista para la interfaz. Sin almacén se usa la última lista vista
      # (indice.json local) para que la diseñadora pueda seguir trabajando.
      def listar
        cache = File.join(local_dir, "indice.json")
        unless disponible?
          return { "disponible" => false, "proyectos" => (leer_json(cache) || []) }
        end
        lista = carpetas_existentes.filter_map do |c|
          d = leer_json(File.join(raiz, c, "proyecto.json"))
          next unless d
          reg = normalizar(d)
          mini = File.join(raiz, c, "miniatura.png")
          resumen(reg).merge("candado" => leer_json(File.join(raiz, c, "abierto_por.json")),
                             "miniatura" => File.exist?(mini) ? mini : nil)
        end
        FileUtils.mkdir_p(local_dir)
        escribir_json(cache, lista)
        { "disponible" => true, "proyectos" => lista }
      end

      # Lo que la lista necesita (sin historial completo).
      def resumen(reg)
        reg.reject { |k, _| %w[historial eventos].include?(k) }
           .merge("cambios_tras_congelar" => cambios_despues_de_congelar?(reg))
      end
    end
  end
end
