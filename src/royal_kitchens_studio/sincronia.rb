require "json"
require "fileutils"

module RoyalKitchens
  module Studio
    # Copia de trabajo local <-> almacén. Nunca se edita el .skp del almacén:
    # se descarga a %LOCALAPPDATA%\RoyalKitchensStudio\trabajo\<FOLIO>\, se
    # guarda ahí (siempre funciona, aun sin conexión) y cada guardado sube una
    # versión. Sin almacén queda «pendiente» y se reintenta solo.
    #
    #   trabajo/<FOLIO>/modelo.skp, miniatura.png, estado.json
    #   estado.json: { version_base, pendiente, notas[], diseno_global,
    #                  conflicto, ultimo_sync, subido_mtime }
    #   consulta/<FOLIO>_vNNNN.skp   copias de solo lectura (nunca se suben)
    module Sincronia
      module_function

      ATRIBUTO  = "folio".freeze   # en el diccionario Proyecto::DICT
      LATIDO    = 5 * 60

      @abierto = nil   # folio con candado tomado en esta PC
      @latido  = nil

      # ---- Rutas y estado local ------------------------------------------

      def trabajo_dir(folio)
        File.join(Registro.local_dir, "trabajo", Registro.carpeta_de(folio))
      end

      def trabajo_skp(folio)
        File.join(trabajo_dir(folio), "modelo.skp")
      end

      def consulta_dir
        File.join(Registro.local_dir, "consulta")
      end

      def estado_local(folio)
        e = Registro.leer_json(File.join(trabajo_dir(folio), "estado.json"))
        { "version_base" => 0, "pendiente" => false, "notas" => [] }.merge(e.is_a?(Hash) ? e : {})
      end

      def guardar_estado(folio, est)
        FileUtils.mkdir_p(trabajo_dir(folio))
        Registro.escribir_json(File.join(trabajo_dir(folio), "estado.json"), est.merge("folio" => folio))
      end

      def folio_de(model)
        model && model.get_attribute(Proyecto::DICT, ATRIBUTO)
      end

      def misma_ruta?(a, b)
        File.expand_path(a.to_s).casecmp?(File.expand_path(b.to_s))
      end

      # ¿Este modelo es la copia de trabajo de su proyecto?
      def modo(model)
        folio = folio_de(model)
        return "fuera" unless folio
        return "edicion" if !model.path.empty? && misma_ruta?(model.path, trabajo_skp(folio))
        "consulta"
      end

      # Resumen para la interfaz: proyecto ligado al modelo abierto.
      def actual(model = Sketchup.active_model)
        folio = folio_de(model)
        return { "folio" => nil } unless folio
        est = estado_local(folio)
        disp = Registro.disponible?
        reg = disp ? Registro.leer(folio) : nil
        sincronia =
          if est["conflicto"] then "conflicto"
          elsif est["pendiente"] then disp ? "pendiente" : "sin_conexion"
          elsif !disp then "sin_conexion"
          else "ok"
          end
        { "folio" => folio, "modo" => modo(model), "sincronia" => sincronia,
          "version_base" => est["version_base"], "conflicto" => est["conflicto"],
          "registro" => reg && Registro.resumen(reg) }
      end

      # ---- Crear ---------------------------------------------------------

      # Registra el proyecto, liga el modelo (el abierto o uno nuevo) y lo
      # guarda como copia de trabajo; ese primer guardado sube la versión 1.
      def crear(datos, usar_modelo_actual)
        u = Usuario.actual
        raise "Primero escribe tu nombre en Ajustes." unless Usuario.configurado?
        raise "No hay conexión con la carpeta de proyectos: no se puede crear." unless Registro.disponible?
        reg = Registro.crear(datos, Usuario.firma(u))
        folio = reg["folio"]

        soltar_candado
        # El modelo abierto se guarda como copia de trabajo del proyecto nuevo;
        # su archivo original (si lo tenía) no se toca.
        unless usar_modelo_actual
          guardar_antes_de_cambiar
          Sketchup.file_new
        end
        model = Sketchup.active_model
        model.set_attribute(Proyecto::DICT, ATRIBUTO, folio)
        Proyecto.guardar(Proyecto.leer(model), model)

        FileUtils.mkdir_p(trabajo_dir(folio))
        guardar_estado(folio, { "version_base" => 0, "pendiente" => false, "notas" => ["Proyecto creado"] })
        tomar_candado(folio)
        model.save(trabajo_skp(folio))   # -> al_guardar -> subir
        { "ok" => true, "folio" => folio }
      end

      # ---- Abrir ---------------------------------------------------------

      # opts: solo_lectura, version (número), forzar (ignorar candado ajeno).
      def abrir(folio, opts = {})
        disp = Registro.disponible?
        reg = disp ? Registro.leer(folio) : nil
        raise "No se encontró el proyecto «#{folio}»." if disp && !reg

        if opts["solo_lectura"] || opts["version"]
          raise "Sin conexión: la consulta necesita la carpeta de proyectos." unless disp
          return abrir_consulta(reg, opts["version"])
        end

        u = Usuario.actual
        cand = disp ? Registro.candado(folio) : nil
        if !opts["forzar"] && Registro.candado_ajeno?(cand, u["usuario"], Time.now)
          return { "ok" => false, "candado" => cand, "folio" => folio }
        end

        local = trabajo_skp(folio)
        est = estado_local(folio)
        if (est["pendiente"] || est["conflicto"]) && File.exist?(local)
          # Hay cambios sin subir (o un conflicto sin resolver): se abre lo
          # local; al subir se detecta si alguien más avanzó mientras tanto.
        elsif disp && (!File.exist?(local) || Registro.conflicto?(est["version_base"], reg["version_actual"]))
          remoto = Registro.archivo(folio, "modelo.skp")
          raise "El proyecto aún no tiene modelo guardado." unless File.exist?(remoto)
          cerrar_si_abierto(local)
          FileUtils.mkdir_p(trabajo_dir(folio))
          Registro.copiar_seguro(remoto, local)
          est.merge!("version_base" => reg["version_actual"], "pendiente" => false, "conflicto" => nil,
                     "subido_mtime" => File.mtime(local).to_i)
          guardar_estado(folio, est)
        elsif !File.exist?(local)
          raise "Sin conexión y sin copia local de «#{folio}»."
        end

        soltar_candado
        tomar_candado(folio) if disp
        unless misma_ruta?(Sketchup.active_model.path, local)
          guardar_antes_de_cambiar
        end
        unless misma_ruta?(Sketchup.active_model.path, local) || Sketchup.open_file(local)
          soltar_candado
          return { "ok" => false, "cancelado" => true }
        end
        { "ok" => true, "folio" => folio }
      end

      # Antes de abrir otro modelo: si el abierto es la copia de trabajo de un
      # proyecto y tiene cambios, se guarda (y por lo tanto se sube) en vez de
      # que SketchUp pregunte «¿Guardar cambios?». Un modelo ajeno sí pregunta.
      def guardar_antes_de_cambiar
        model = Sketchup.active_model
        model.save if model && model.modified? && modo(model) == "edicion"
      end

      # Antes de reemplazar la copia de trabajo hay que cerrarla si es el
      # modelo abierto; con cambios sin guardar no se toca.
      def cerrar_si_abierto(local)
        model = Sketchup.active_model
        return unless model && !model.path.empty? && misma_ruta?(model.path, local)
        raise "Guarda o descarta los cambios del modelo antes de continuar." if model.modified?
        model.close(true)
      end

      def abrir_consulta(reg, version)
        folio = reg["folio"]
        if version
          h = reg["historial"].find { |x| x["v"].to_i == version.to_i }
          raise "Esa versión ya no existe." unless h
          origen = Registro.archivo(folio, h["archivo"])
          v = h["v"].to_i
        else
          origen = Registro.archivo(folio, "modelo.skp")
          v = reg["version_actual"]
        end
        raise "No se encontró el archivo de esa versión." unless File.exist?(origen)
        FileUtils.mkdir_p(consulta_dir)
        destino = File.join(consulta_dir, format("%s_v%04d.skp", Registro.carpeta_de(folio), v))
        cerrar_si_abierto(destino)
        FileUtils.cp(origen, destino)
        guardar_antes_de_cambiar
        soltar_candado
        return { "ok" => false, "cancelado" => true } unless Sketchup.open_file(destino)
        { "ok" => true, "folio" => folio, "consulta" => true, "version" => v }
      end

      # ---- Guardar / subir -----------------------------------------------

      # ModelObserver#onPostSaveModel. Solo la copia de trabajo sube.
      def al_guardar(model, nota = nil)
        folio = folio_de(model)
        return nil unless folio
        case modo(model)
        when "consulta"
          return { "ok" => false, "aviso" => "Esta es una copia de consulta: los cambios no se suben al proyecto." }
        when "fuera" then return nil
        end
        local = trabajo_skp(folio)
        est = estado_local(folio)
        # El guardado automático de SketchUp no reescribe este archivo: si no
        # cambió desde la última subida no hay versión nueva.
        return nil if est["subido_mtime"].to_i == File.mtime(local).to_i && !est["pendiente"]

        escribir_miniatura(model, folio)
        est["pendiente"] = true
        est["notas"] = (est["notas"] || []) + [nota].compact.reject { |n| n.to_s.strip.empty? }
        est["diseno_global"] = Proyecto.leer(model)["global"]
        guardar_estado(folio, est)
        subir(folio)
      end

      def escribir_miniatura(model, folio)
        model.active_view.write_image(filename: File.join(trabajo_dir(folio), "miniatura.png"),
                                      width: 480, height: 360, antialias: true)
      rescue StandardError
        nil
      end

      # Sube la copia de trabajo como versión nueva. Trabaja solo con archivos
      # (no con el modelo abierto), así sirve también para reintentar después.
      def subir(folio)
        est = estado_local(folio)
        return { "ok" => true, "nada" => true } unless est["pendiente"]
        return { "ok" => true, "pendiente" => true } unless Registro.disponible?
        reg = Registro.leer(folio)
        return { "ok" => false, "error" => "El proyecto «#{folio}» ya no está en la carpeta de proyectos." } unless reg

        local = trabajo_skp(folio)
        ahora = Time.now
        u = Usuario.actual
        firma = Usuario.firma(u)
        conflicto = Registro.conflicto?(est["version_base"], reg["version_actual"])
        v = Registro.siguiente_version(reg)
        rel = File.join("versiones", Registro.nombre_version(v, ahora, u["usuario"], conflicto)).tr("\\", "/")
        dir = Registro.dir_de(folio)
        FileUtils.mkdir_p(File.join(dir, "versiones"))
        Registro.copiar_seguro(local, File.join(dir, rel))
        nota = (est["notas"] || []).join(" · ")

        unless conflicto
          Registro.copiar_seguro(local, File.join(dir, "modelo.skp"))
          mini = File.join(trabajo_dir(folio), "miniatura.png")
          Registro.copiar_seguro(mini, File.join(dir, "miniatura.png")) if File.exist?(mini)
          reg["diseno_global"] = est["diseno_global"] if est["diseno_global"]
        end
        Registro.registrar_version(reg, v, rel, firma, ahora, nota, conflicto: conflicto)
        Registro.podar(reg).each { |a| FileUtils.rm_f(File.join(dir, a)) }
        Registro.escribir(reg)

        est.merge!("pendiente" => false, "notas" => [], "ultimo_sync" => Registro.hora(ahora),
                   "subido_mtime" => File.mtime(local).to_i)
        if conflicto
          est["conflicto"] = { "v" => v, "remota" => reg["version_actual"], "por" => reg["actualizado"]["nombre"] }
        else
          est["version_base"] = v
          est["conflicto"] = nil
        end
        guardar_estado(folio, est)
        { "ok" => true, "version" => v, "conflicto" => conflicto }
      end

      # Tras un conflicto: «mia» vuelve vigente la copia local; «servidor»
      # descarta lo local y baja la versión vigente.
      def resolver(folio, usar)
        raise "Sin conexión con la carpeta de proyectos." unless Registro.disponible?
        reg = Registro.leer(folio)
        est = estado_local(folio)
        if usar == "mia"
          est.merge!("version_base" => reg["version_actual"], "conflicto" => nil, "pendiente" => true,
                     "notas" => ["Se conservó la versión de #{Usuario.firma(Usuario.actual)['nombre']} tras un conflicto"])
          guardar_estado(folio, est)
          subir(folio)
        else
          est.merge!("version_base" => -1, "conflicto" => nil, "pendiente" => false, "notas" => [])
          guardar_estado(folio, est)
          abrir(folio, "forzar" => true)
        end
      end

      # ---- Reintentos y candado ------------------------------------------

      # Cada minuto: sube lo pendiente de cualquier proyecto y renueva el
      # latido del candado.
      def tick
        return unless Registro.disponible?
        subidos = pendientes.map { |folio| subir(folio) }.select { |r| r["version"] }
        if @abierto && (@latido.nil? || Time.now - @latido >= LATIDO)
          tomar_candado(@abierto)
        end
        subidos
      rescue StandardError => e
        warn "[Royal Kitchens Studio] sincronía: #{e.message}"
        []
      end

      def pendientes
        base = File.join(Registro.local_dir, "trabajo")
        return [] unless File.directory?(base)
        Dir.children(base).filter_map do |c|
          e = Registro.leer_json(File.join(base, c, "estado.json"))
          e && e["pendiente"] ? (e["folio"] || c) : nil
        end
      end

      def tomar_candado(folio)
        return unless Registro.disponible? && File.directory?(Registro.dir_de(folio))
        u = Usuario.firma(Usuario.actual)
        previo = Registro.candado(folio)
        desde = previo && previo["usuario"] == u["usuario"] ? previo["desde"] : Registro.hora(Time.now)
        Registro.escribir_json(Registro.archivo(folio, "abierto_por.json"),
                               u.merge("desde" => desde, "latido" => Registro.hora(Time.now)))
        @abierto = folio
        @latido = Time.now
      rescue SystemCallError
        nil
      end

      # Solo se borra si el candado es nuestro.
      def soltar_candado
        folio = @abierto
        @abierto = nil
        return unless folio && Registro.disponible?
        c = Registro.candado(folio)
        FileUtils.rm_f(Registro.archivo(folio, "abierto_por.json")) if c && c["usuario"] == Usuario.actual["usuario"]
      rescue SystemCallError
        nil
      end

      # Otro modelo activo: si no es la copia de trabajo del proyecto con
      # candado, el candado se suelta.
      def modelo_cambio(model)
        folio = folio_de(model)
        if @abierto && !(folio == @abierto && modo(model) == "edicion")
          soltar_candado
        end
        tomar_candado(folio) if folio && @abierto.nil? && modo(model) == "edicion"
      end
    end
  end
end
