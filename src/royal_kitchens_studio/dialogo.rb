require "json"
require "fileutils"

module RoyalKitchens
  module Studio
    # Ventana única de Studio: proyectos, diseño, catálogo de muebles
    # (Biblioteca), generar (Generador) y CSV.
    #
    # Respuestas a la UI: window.RKS.<fn>(obj).
    module Dialogo
      module_function

      @dlg = nil

      def mostrar
        if @dlg && @dlg.visible?
          @dlg.bring_to_front
          return
        end
        @dlg = construir
        @dlg.show
      end

      def visible?
        @dlg && @dlg.visible?
      end

      def construir
        dlg = UI::HtmlDialog.new(
          dialog_title:    PLUGIN_NAME,
          preferences_key: "com.royalkitchens.studio",
          scrollable:      false,
          resizable:       true,
          width:           1240,
          height:          800,
          min_width:       760,
          min_height:      520,
          style:           UI::HtmlDialog::STYLE_DIALOG
        )
        dlg.set_file(File.join(__dir__, "ui", "index.html"))

        cb(dlg, "listo")             { |_| enviar_estado(dlg) }
        cb(dlg, "recargar")          { |_| enviar_estado(dlg) }
        cb(dlg, "guardar_proyecto")  { |json| Proyecto.guardar(JSON.parse(json)); nil }
        cb(dlg, "insertar")          { |json| en_segundo_plano(dlg, "onInsertado") { insertar(JSON.parse(json)) } }
        cb(dlg, "insertados")        { |_| responder(dlg, "onInsertados", insertados) }
        cb(dlg, "aplicar_diseno")    { |json| en_segundo_plano(dlg, "onAplicado") { aplicar_diseno(JSON.parse(json)) } }
        cb(dlg, "generar")           { |json| en_segundo_plano(dlg, "onGenerado") { generar(JSON.parse(json)) } }
        cb(dlg, "importar_csv")      { |_| responder(dlg, "onImportado", Generador.importar_archivo) }
        cb(dlg, "plantilla")         { |_| responder(dlg, "onPlantilla", Generador.exportar_plantilla) }
        cb(dlg, "borrar_creacion")   { |id| borrar_creacion(dlg, id) }
        cb(dlg, "abrir_carpeta")     { |cual| abrir_carpeta(cual) }
        cb(dlg, "cambiar_carpeta")   { |cual| cambiar_carpeta(cual); enviar_estado(dlg) }
        # Registro de proyectos
        cb(dlg, "proyectos_listar")  { |_| responder(dlg, "onProyectos", Registro.listar) }
        cb(dlg, "proyecto_detalle")  { |folio| responder(dlg, "onProyectoDetalle", detalle(folio)) }
        cb(dlg, "proyecto_crear")    { |json| en_segundo_plano(dlg, "onProyectoAbierto") { crear_proyecto(JSON.parse(json)) } }
        cb(dlg, "proyecto_abrir")    { |json| en_segundo_plano(dlg, "onProyectoAbierto") { abrir_proyecto(JSON.parse(json)) } }
        cb(dlg, "proyecto_datos")    { |json| responder(dlg, "onProyectoDetalle", guardar_datos(JSON.parse(json))) }
        cb(dlg, "proyecto_estado")   { |json| responder(dlg, "onProyectoDetalle", cambiar_estado(JSON.parse(json))) }
        cb(dlg, "proyecto_cambio")   { |json| responder(dlg, "onProyectoDetalle", enviar_cambio(JSON.parse(json))) }
        cb(dlg, "proyecto_recibido") { |json| responder(dlg, "onProyectoDetalle", recibir_cambio(JSON.parse(json))) }
        cb(dlg, "proyecto_subir")    { |nota| subir_con_nota(nota) }
        cb(dlg, "proyecto_resolver") { |json| en_segundo_plano(dlg, "onProyectoAbierto") { resolver(JSON.parse(json)) } }
        cb(dlg, "usuario_guardar")   { |json| Usuario.guardar(JSON.parse(json)); enviar_estado(dlg) }
        # Sesión (prototipo: cualquier correo y contraseña)
        cb(dlg, "sesion_iniciar")    { |json| iniciar_sesion(dlg, JSON.parse(json)) }
        cb(dlg, "sesion_cerrar")     { |_| Usuario.cerrar_sesion; enviar_estado(dlg) }
        dlg
      end

      # Callback con manejo de errores común: un fallo en Ruby se ve como aviso
      # en la interfaz, no como una ventana que se queda esperando.
      def cb(dlg, nombre, &accion)
        dlg.add_action_callback(nombre) do |_ctx, arg|
          begin
            accion.call(arg)
          rescue => e
            responder(dlg, "onError", { "accion" => nombre, "error" => e.message })
          end
          nil
        end
      end

      def responder(dlg, fn, obj)
        dlg.execute_script("window.RKS && window.RKS.#{fn}(#{JSON.generate(obj)});")
      end

      # Corre +bloque+ una sola vez dentro de +segundos+.
      #
      # OJO: en SketchUp un UI.start_timer que no se repite SÍ se vuelve a
      # disparar mientras su bloque tiene abierta una ventana modal (el
      # «¿Guardar cambios?» de open_file/file_new, un messagebox…): cada disparo
      # abría otro archivo y otro aviso, cientos, y SketchUp se trababa. Por eso
      # el temporizador se detiene al entrar y lleva una bandera.
      # Abriendo/creando/generando: el temporizador de sincronía espera.
      def trabajando?
        @trabajando ? true : false
      end

      def despues(segundos, &bloque)
        hecho = false
        id = nil
        id = UI.start_timer(segundos, false) do
          UI.stop_timer(id) if id
          next if hecho
          hecho = true
          bloque.call
        end
      end

      # Generar tarda varios segundos. Se suelta el callback para que la
      # interfaz alcance a pintar el «trabajando…» y el trabajo corre después.
      def en_segundo_plano(dlg, fn, &trabajo)
        despues(0.05) do
          @trabajando = true
          res = begin
            trabajo.call
          rescue => e
            { "ok" => false, "error" => e.message }
          ensure
            @trabajando = false
          end
          responder(dlg, fn, res) if dlg.visible?
        end
      end

      # ---- Estado completo para la UI ----------------------------------------

      def enviar_estado(dlg)
        responder(dlg, "onEstado", estado)
      end

      def refrescar
        enviar_estado(@dlg) if visible?
      end

      def estado
        modulos = Biblioteca.modulos(Generador.creaciones_dir)
        { "proyecto" => Proyecto.leer, "version" => VERSION,
          "usuario" => Usuario.actual, "sesion" => Usuario.sesion?, "actual" => Sincronia.actual,
          "estados" => Registro::ESTADOS, "pasos" => Registro::PASOS,
          "opciones" => Catalogo.para_ui, "manifiestos" => Familias.manifiestos,
          "modulos" => modulos, "categorias" => Biblioteca.categorias(modulos),
          "carpetas" => { "proyectos" => Registro.raiz, "creaciones" => Generador.creaciones_dir } }
      end

      def iniciar_sesion(dlg, req)
        r = Usuario.iniciar(req["correo"], req["password"], req["rol"])
        return responder(dlg, "onLogin", r) unless r["ok"]
        enviar_estado(dlg)
      end

      # ---- Insertar un mueble del catálogo ------------------------------------
      #
      # { id, eleccion }. Sin elección (mueble «como se hizo»): su receta tal cual. Con
      # elección: se regenera desde la receta con los cambios que calcula
      # Catalogo.cambios_receta (medidas, frente, manija por uso, material y sus
      # reglas) más los entrepaños ajustados en el proyecto (eleccion["interior"]).
      def insertar(req)
        m   = Biblioteca.buscar(Generador.creaciones_dir, req["id"])
        res = instanciar(m, req["eleccion"])
        raise res["error"].to_s unless res["ok"]
        Biblioteca.marcar(res["instancia"], m["id"], req["modo"] || "global")
        { "ok" => true, "id" => m["id"], "avisos" => res["avisos"] }
      end

      def instanciar(m, el, transformation: nil)
        return Biblioteca.insertar_tal_cual(m, transformation: transformation) unless el.is_a?(Hash) && !el.empty?
        op  = Catalogo.cargar
        cfg = (op["familias"] || {})[m["receta_familia"]] || {}
        cambios = Catalogo.cambios_receta(cfg, el, op, m["receta"]["valores"] || {})
        asegurar_material(el["material"]) if cambios.key?(cfg.dig("material", "attr"))
        cambios.merge!(Generador.cambios_interior(Familias.manifiesto(m["receta_familia"]), el["interior"]))
        Generador.instanciar_receta(m["receta_familia"], m["receta"], cambios, nombre: m["specs"]["sku"],
                                    divisores: el["divisores"], transformation: transformation)
      end

      # ---- Aplicar el diseño del proyecto a lo ya insertado -------------------
      #
      # Paso 1 (insertados): qué muebles de la escena siguen el diseño del
      # proyecto, { muebles: [{ id, n }] }. La UI arma la elección de cada uno
      # (la misma que al insertar) y pide confirmación.
      # Paso 2 (aplicar_diseno): [{ id, eleccion }] -> cada instancia se vuelve
      # a generar con su posición, etiqueta y contenedor, y se borra la vieja.
      def insertados
        { "ok" => true, "muebles" => escena.map { |id, insts| { "id" => id, "n" => insts.size } } }
      end

      def escena
        model = Sketchup.active_model
        Biblioteca.en_escena(model, Biblioteca.modulos(Generador.creaciones_dir), Proyecto.leer(model))
      end

      # El primero de cada mueble se genera; los demás iguales reutilizan esa
      # definición (Generador.generada), y uno que ya tenía este diseño se deja
      # como está.
      def aplicar_diseno(lista)
        model = Sketchup.active_model
        por_id = escena
        antes = Generador.sueltas(model)
        hechos = 0
        errores = []
        Array(lista).each do |t|
          m = Biblioteca.buscar(Generador.creaciones_dir, t["id"])
          por_id[t["id"]].each do |viejo|
            next unless viejo.valid?
            res = instanciar(m, t["eleccion"], transformation: viejo.transformation)
            next errores << "#{m['name']}: #{res['error']}" unless res["ok"] && res["instancia"]
            nuevo = res["instancia"]
            if nuevo.definition == viejo.definition
              quitar_copia(nuevo)
            else
              reemplazar(viejo, nuevo, m["id"])
            end
            hechos += 1
          end
        end
        # Lo que los muebles viejos dejaron fuera de la escena.
        Generador.quitar_definiciones_nuevas(model, antes)
        { "ok" => true, "hechos" => hechos, "errores" => errores }
      end

      def quitar_copia(inst)
        model = inst.model
        model.start_operation("Aplicar diseño", true, false, true)
        inst.erase!
        model.commit_operation
      end

      # El nuevo nace en la raíz con la transformación del viejo; si el viejo
      # estaba dentro de un grupo, se pasa ahí.
      def reemplazar(viejo, nuevo, id)
        model = viejo.model
        model.start_operation("Aplicar diseño", true, false, true)
        padre = viejo.parent
        unless padre.is_a?(Sketchup::Model)
          movido = padre.entities.add_instance(nuevo.definition, viejo.transformation)
          movido.name = nuevo.name
          # Los atributos dinámicos van también en la instancia.
          (nuevo.attribute_dictionaries || []).each do |dic|
            dic.each_pair { |k, v| movido.set_attribute(dic.name, k, v) }
          end
          nuevo.erase!
          nuevo = movido
        end
        nuevo.layer = viejo.layer
        viejo.erase!
        model.commit_operation
        Biblioteca.marcar(nuevo, id, "global")
      end

      # ---- Generar desde «Avanzado» o desde una fila del CSV -------------------
      #
      #   { familia, nombre, valores (fila plana), divisores, material,
      #     insertar: bool, publicar: bool, clase, ref }
      #
      # Una sola generación (Generador.generar): queda en la escena y/o se
      # guarda en Creaciones personalizadas.
      def generar(req)
        nombre   = req["nombre"].to_s.strip
        nombre   = "modulo" if nombre.empty?
        valores  = (req["valores"] || {}).dup
        material = req["material"].to_s
        unless material.empty?
          asegurar_material(material)
          valores["c16_material_puerta"] = material
          valores["c22matpuertade"]      = "=c16_material_puerta"
        end
        r = Generador.generar(req["familia"].to_s, nombre, valores, divisores: req["divisores"],
                              insertar: !!req["insertar"], publicar: !!req["publicar"], clase: req["clase"],
                              creado_por: Usuario.actual.slice("usuario", "nombre"))
        { "ok" => r["ok"], "error" => r["error"], "ref" => req["ref"], "nombre" => nombre,
          "avisos" => r["avisos"], "publicado" => r["publicado"] ? true : false }
      end

      def asegurar_material(id)
        Catalogo.asegurar_material(Sketchup.active_model, id)
      end

      # ---- Creaciones y carpetas -------------------------------------

      def borrar_creacion(dlg, id)
        mod = Biblioteca.buscar(Generador.creaciones_dir, id)
        ok = UI.messagebox("¿Eliminar la creación «#{mod['name']}»?\nSe borra su receta.", MB_YESNO)
        return unless ok == IDYES
        base = mod["_file"].sub(/\.json\z/i, "")
        %w[.json .skp .png].each { |ext| FileUtils.rm_f(base + ext) }
        # Sus ajustes en el proyecto abierto se van con él: otro mueble con el
        # mismo nombre no debe heredarlos.
        proyecto = Proyecto.leer
        Proyecto.guardar(proyecto) if proyecto["modulos"].delete(mod["id"])
        enviar_estado(dlg)
      end

      # ---- Registro de proyectos ------------------------------------------

      def detalle(folio)
        reg = Registro.leer(folio.to_s) or raise "No se encontró el proyecto «#{folio}»."
        mini = Registro.archivo(reg["folio"], "miniatura.png")
        reg.merge("candado" => Registro.candado(reg["folio"]),
                  "miniatura" => File.exist?(mini) ? mini : nil,
                  "cambios_tras_congelar" => Registro.cambios_despues_de_congelar?(reg),
                  "local" => Sincronia.estado_local(reg["folio"]).slice("version_base", "pendiente", "conflicto"))
      end

      def crear_proyecto(req)
        r = Sincronia.crear(req["datos"] || {}, req["usar_modelo_actual"] == true)
        refrescar
        r
      end

      def abrir_proyecto(req)
        Sincronia.abrir(req["folio"].to_s, req)
      end

      def resolver(req)
        Sincronia.resolver(req["folio"].to_s, req["usar"].to_s).merge("folio" => req["folio"])
      ensure
        refrescar
      end

      def necesita_almacen!
        raise "Sin conexión con la carpeta de proyectos." unless Registro.disponible?
      end

      def guardar_datos(req)
        necesita_almacen!
        reg = Registro.leer(req["folio"].to_s) or raise "No se encontró el proyecto."
        Registro::CAMPOS.each { |k| reg[k] = req[k].to_s.strip if req.key?(k) }
        Registro.escribir(reg)
        detalle(reg["folio"])
      end

      def cambiar_estado(req)
        necesita_almacen!
        reg = Registro.leer(req["folio"].to_s) or raise "No se encontró el proyecto."
        a = req["a"].to_s
        u = Usuario.actual
        err = Registro.error_paso(reg, a, u["rol"], req["nota"])
        raise err if err
        todo_subido!(reg) if a == Registro::CONGELA
        Registro.cambiar_estado(reg, a, Usuario.firma(u), Time.now, req["nota"])
        Registro.escribir(reg)
        refrescar
        detalle(reg["folio"])
      end

      # Proyecto en planeación/fabricación: la versión vigente se vuelve la
      # congelada sin mover el estado.
      def enviar_cambio(req)
        necesita_almacen!
        reg = Registro.leer(req["folio"].to_s) or raise "No se encontró el proyecto."
        todo_subido!(reg)
        err = Registro.error_cambio(reg, req["nota"])
        raise err if err
        u = Usuario.actual
        Registro.enviar_cambio(reg, Usuario.firma(u), Time.now, req["nota"], revisado: u["rol"] == "planeacion")
        Registro.escribir(reg)
        refrescar
        detalle(reg["folio"])
      end

      def recibir_cambio(req)
        necesita_almacen!
        reg = Registro.leer(req["folio"].to_s) or raise "No se encontró el proyecto."
        raise "Solo Planeación confirma que recibió un cambio." unless Usuario.actual["rol"] == "planeacion"
        raise "No hay cambios por confirmar." unless reg["cambio_sin_revisar"]
        Registro.recibir_cambio(reg, Usuario.firma(Usuario.actual), Time.now)
        Registro.escribir(reg)
        refrescar
        detalle(reg["folio"])
      end

      # Lo que se congela es la versión del almacén: no debe quedar nada local
      # sin subir.
      def todo_subido!(reg)
        model = Sketchup.active_model
        if Sincronia.folio_de(model) == reg["folio"] && Sincronia.modo(model) == "edicion" && model.modified?
          raise "Guarda el modelo antes de enviarlo a planeación."
        end
        raise "Hay cambios sin subir: espera a que se sincronicen." if Sincronia.estado_local(reg["folio"])["pendiente"]
      end

      # «Guardar versión con nota»: un guardado normal con nota adjunta.
      def subir_con_nota(nota)
        model = Sketchup.active_model
        raise "Este modelo no es la copia de trabajo de un proyecto." unless Sincronia.modo(model) == "edicion"
        @nota_siguiente = nota.to_s.strip
        model.save
      end

      def tomar_nota
        n = @nota_siguiente
        @nota_siguiente = nil
        n
      end

      # Después de cada guardado (diferido para no copiar archivos dentro del
      # observador de SketchUp).
      def al_guardar(model)
        nota = tomar_nota
        despues(0.1) do
          r = begin
            Sincronia.al_guardar(model, nota)
          rescue => e
            { "ok" => false, "error" => e.message }
          end
          if visible?
            responder(@dlg, "onSubida", r) if r
            enviar_estado(@dlg)
          end
        end
      end

      def carpeta(cual)
        case cual
        when "proyectos"  then Registro.raiz
        when "creaciones" then Generador.creaciones_dir
        end
      end

      def abrir_carpeta(cual)
        dir = carpeta(cual.to_s)
        return unless dir
        FileUtils.mkdir_p(dir) if cual.to_s == "creaciones"
        return if cual.to_s == "proyectos" && !Registro.disponible?
        UI.openURL("file:///#{dir.tr('\\', '/')}")
      end

      def cambiar_carpeta(cual)
        case cual.to_s
        when "proyectos"
          dir = UI.select_directory(title: "Carpeta de proyectos (local, servidor u OneDrive)",
                                    directory: (Registro.raiz if File.directory?(Registro.raiz)))
          if dir
            Sincronia.soltar_candado
            Registro.raiz = dir
          end
        when "creaciones"
          dir = UI.select_directory(title: "Carpeta de creaciones personalizadas", directory: carpeta("creaciones"))
          Generador.creaciones_dir = dir if dir
        end
      end

      # Cada guardado de la copia de trabajo sube una versión al almacén.
      class ObservadorModelo < Sketchup::ModelObserver
        def onPostSaveModel(model)
          Dialogo.al_guardar(model)
        end
      end
      OBSERVADOR_MODELO = ObservadorModelo.new

      def vigilar(model)
        return unless model
        model.remove_observer(OBSERVADOR_MODELO)
        model.add_observer(OBSERVADOR_MODELO)
      end

      # Otro modelo = otro proyecto: se relee su configuración y se mueve el
      # candado al proyecto que quedó abierto.
      class ObservadorApp < Sketchup::AppObserver
        def onNewModel(model);      cambio(model); end
        def onOpenModel(model);     cambio(model); end
        def onActivateModel(model); cambio(model); end
        def onQuit;                 Sincronia.soltar_candado; end

        def cambio(model)
          Dialogo.vigilar(model)
          Sincronia.modelo_cambio(model)
          Dialogo.refrescar
        rescue => e
          warn "[Royal Kitchens Studio] #{e.message}"
        end
      end
    end
  end
end
