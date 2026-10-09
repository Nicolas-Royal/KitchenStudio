require "json"
require "fileutils"

module RoyalKitchens
  module Studio
    # Ventana única de Studio. Todo lo que toca catálogo o generación se
    # delega a KitchenCatalog y RoyalKitchen::CatalogCreator (ver Puente).
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
        cb(dlg, "generar")           { |json| en_segundo_plano(dlg, "onGenerado") { generar(JSON.parse(json)) } }
        cb(dlg, "importar_csv")      { |_| responder(dlg, "onImportado", importar_csv) }
        cb(dlg, "plantilla")         { |_| responder(dlg, "onPlantilla", RoyalKitchen::CatalogCreator.exportar_plantilla) }
        cb(dlg, "borrar_creacion")   { |id| borrar_creacion(dlg, id) }
        cb(dlg, "abrir_carpeta")     { |cual| abrir_carpeta(cual) }
        cb(dlg, "cambiar_carpeta")   { |cual| cambiar_carpeta(cual); enviar_estado(dlg) }
        cb(dlg, "abrir_plugin")      { |cual| abrir_plugin(cual) }
        # Registro de proyectos
        cb(dlg, "proyectos_listar")  { |_| responder(dlg, "onProyectos", Registro.listar) }
        cb(dlg, "proyecto_detalle")  { |folio| responder(dlg, "onProyectoDetalle", detalle(folio)) }
        cb(dlg, "proyecto_crear")    { |json| en_segundo_plano(dlg, "onProyectoAbierto") { crear_proyecto(JSON.parse(json)) } }
        cb(dlg, "proyecto_abrir")    { |json| en_segundo_plano(dlg, "onProyectoAbierto") { abrir_proyecto(JSON.parse(json)) } }
        cb(dlg, "proyecto_datos")    { |json| responder(dlg, "onProyectoDetalle", guardar_datos(JSON.parse(json))) }
        cb(dlg, "proyecto_estado")   { |json| responder(dlg, "onProyectoDetalle", cambiar_estado(JSON.parse(json))) }
        cb(dlg, "proyecto_subir")    { |nota| subir_con_nota(nota) }
        cb(dlg, "proyecto_resolver") { |json| en_segundo_plano(dlg, "onProyectoAbierto") { resolver(JSON.parse(json)) } }
        cb(dlg, "usuario_guardar")   { |json| Usuario.guardar(JSON.parse(json)); enviar_estado(dlg) }
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

      # Generar tarda varios segundos. Se suelta el callback para que la
      # interfaz alcance a pintar el «trabajando…» y el trabajo corre después.
      def en_segundo_plano(dlg, fn, &trabajo)
        UI.start_timer(0.05, false) do
          res = begin
            trabajo.call
          rescue => e
            { "ok" => false, "error" => e.message }
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
        deps = Puente.estado
        data = { "dependencias" => deps, "proyecto" => Proyecto.leer, "version" => VERSION,
                 "usuario" => Usuario.actual, "actual" => Sincronia.actual,
                 "estados" => Registro::ESTADOS, "transiciones" => Registro.transiciones,
                 "opciones" => Catalogo.para_ui, "manifiestos" => Familias.manifiestos,
                 "carpetas" => { "proyectos" => Registro.raiz } }
        return data unless Puente.catalogo?

        root = KitchenCatalog::Config.catalog_root!
        cr   = KitchenCatalog::Config.creaciones_dir
        KitchenCatalog::Thumbnails.ensure_instancias(root) if root
        catalogo = root ? KitchenCatalog::Dialog.load_manifest(root, false) : { "modules" => [] }
        catalogo = KitchenCatalog::Catalog.merge_instancias(catalogo, root, cr) if root
        data.merge!(
          "modulos"    => catalogo["modules"] || [],
          "categorias" => (catalogo["facets"] || {})["categories"] || [],
          "carpetas"   => data["carpetas"].merge("catalogo" => root, "creaciones" => cr)
        )
        if Puente.creador?
          cc = RoyalKitchen::CatalogCreator
          data["carpetas"]["creador"]       = cc.project_root
          data["carpetas"]["creador_valido"] = cc.project_root_valido?
        end
        data
      end

      # ---- Insertar (módulo tal cual o con diseño) ----------------------------
      #
      # { id, eleccion }. Con eleccion, una creación se regenera desde su receta
      # con los cambios que calcula Studio (Catalogo.cambios_receta: manija de
      # puertas y de cajones, reglas); un módulo del catálogo solo ajusta
      # medidas (KitchenCatalog::Inserter.place, su diseño ya viene armado).
      def insertar(req)
        raise "Falta el Catálogo de Módulos 0.3 o superior." unless Puente.catalogo?
        id = req["id"].to_s
        el = req["eleccion"]
        if el.is_a?(Hash) && !el.empty? && Puente.creador?
          r = insertar_receta(id, el)
          return r if r
        end
        KitchenCatalog::Inserter.place(id, {}, el)
        { "ok" => true, "id" => id }
      end

      # nil si +id+ no es una creación con receta (se inserta como siempre).
      def insertar_receta(id, eleccion)
        meta = KitchenCatalog::Inserter.load_meta(KitchenCatalog::Config.catalog_root!, id)
        return nil unless meta["_source"] == "creaciones" && meta["receta"].is_a?(Hash)
        model = Sketchup.active_model
        op    = Catalogo.cargar
        cfg   = (op["familias"] || {})[meta["receta_familia"]] || {}
        cambios = Catalogo.cambios_receta(cfg, eleccion, op, meta["receta"]["valores"] || {})
        asegurar_material(eleccion["material"]) if cambios.key?(cfg.dig("material", "attr"))
        res = RoyalKitchen::CatalogCreator.instanciar_receta(
          meta["receta_familia"], meta["receta"], cambios,
          nombre: (meta["specs"] || {})["sku"], transformation: KitchenCatalog::Inserter.siguiente_x(model)
        )
        raise res["error"].to_s unless res["ok"]
        { "ok" => true, "id" => id }
      end

      # ---- Generar desde «Avanzado» o desde una fila del CSV -------------------
      #
      #   { familia, nombre, valores (fila plana), divisores, material,
      #     insertar: bool, publicar: bool, ref }
      #
      # insertar -> CatalogCreator.instanciar_receta (en la escena, sin .skp)
      # publicar -> CatalogCreator.generar con publicar (Creaciones personalizadas)
      def generar(req)
        raise "Falta Royal Catalog Creator 1.2 o superior." unless Puente.creador?
        cc       = RoyalKitchen::CatalogCreator
        familia  = req["familia"].to_s
        nombre   = req["nombre"].to_s.strip
        nombre   = "modulo" if nombre.empty?
        valores  = (req["valores"] || {}).dup
        div      = req["divisores"]
        material = req["material"].to_s
        res      = { "ok" => true, "ref" => req["ref"], "nombre" => nombre, "avisos" => [] }

        unless material.empty?
          asegurar_material(material)
          valores["c16_material_puerta"] = material
          valores["c22matpuertade"]      = "=c16_material_puerta"
        end

        if req["insertar"]
          tr = KitchenCatalog::Inserter.siguiente_x(Sketchup.active_model)
          r = cc.instanciar_receta(familia, { "valores" => valores, "divisores" => div }, {},
                                   nombre: nombre, transformation: tr)
          return res.merge("ok" => false, "error" => r["error"]) unless r["ok"]
          res["avisos"].concat(r["warnings"] || [])
        end

        if req["publicar"]
          payload = { "registro_id" => req["ref"], "familia" => familia, "nombre_salida" => nombre,
                      "valores" => valores, "insertar_en_escena" => false, "limpiar_ocultos" => true,
                      "publicar" => true, "purgar" => false }
          payload["divisores"] = div if div
          r = cc.generar(JSON.generate(payload))
          return res.merge("ok" => false, "error" => r["error"]) unless r["ok"]
          res["avisos"].concat(r["warnings"] || [])
          res["publicado"] = true
        end
        res
      end

      def asegurar_material(id)
        return unless Puente.catalogo?
        root = KitchenCatalog::Config.catalog_root!
        op   = KitchenCatalog::Configurador.cargar(root, KitchenCatalog::Config::BUNDLED_SEED)
        KitchenCatalog::Inserter.asegurar_material(Sketchup.active_model, root, id, op)
      end

      # ---- CSV / plantilla ------------------------------------------------------

      def importar_csv
        raise "Falta Royal Catalog Creator 1.2 o superior." unless Puente.creador?
        RoyalKitchen::CatalogCreator.importar_archivo
      end

      # ---- Creaciones, carpetas, plugins -------------------------------------

      def borrar_creacion(dlg, id)
        mod = KitchenCatalog::Catalog.scan_creaciones(KitchenCatalog::Config.creaciones_dir).find { |m| m["id"] == id.to_s }
        raise "Creación no encontrada." unless mod
        ok = UI.messagebox("¿Eliminar la creación «#{mod['name']}»?\nSe borran su receta, su .skp y su foto.", MB_YESNO)
        return unless ok == IDYES
        base = mod["_file"].sub(/\.json\z/i, "")
        %w[.json .skp .png].each { |ext| FileUtils.rm_f(base + ext) }
        enviar_estado(dlg)
      end

      # ---- Registro de proyectos ------------------------------------------

      def detalle(folio)
        reg = Registro.leer(folio.to_s) or raise "No se encontró el proyecto «#{folio}»."
        reg.merge("candado" => Registro.candado(reg["folio"]),
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
        unless Registro.transicion_permitida?(reg["estado"], a, u["rol"])
          raise "Con el rol actual no se puede pasar de «#{nombre_estado(reg['estado'])}» a «#{nombre_estado(a)}»."
        end
        if a == Registro::CONGELA
          # Lo que se congela es la versión del almacén: no debe quedar nada
          # local sin subir.
          model = Sketchup.active_model
          if Sincronia.folio_de(model) == reg["folio"] && Sincronia.modo(model) == "edicion" && model.modified?
            raise "Guarda el modelo antes de enviarlo a planeación."
          end
          raise "Hay cambios sin subir: espera a que se sincronicen." if Sincronia.estado_local(reg["folio"])["pendiente"]
          raise "El proyecto aún no tiene ninguna versión guardada." if reg["version_actual"] < 1
        end
        Registro.cambiar_estado(reg, a, Usuario.firma(u), Time.now, req["nota"])
        Registro.escribir(reg)
        refrescar
        detalle(reg["folio"])
      end

      def nombre_estado(id)
        (Registro::ESTADOS.find { |e| e[0] == id } || [id, id])[1]
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
        UI.start_timer(0.1, false) do
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
        when "catalogo"   then KitchenCatalog::Config.catalog_root!
        when "creaciones" then KitchenCatalog::Config.creaciones_dir
        when "creador"    then RoyalKitchen::CatalogCreator.project_root
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
        when "catalogo" then KitchenCatalog::Config.prompt_for_root
        when "creador"  then RoyalKitchen::CatalogCreator.configurar_project_root
        when "creaciones"
          dir = UI.select_directory(title: "Carpeta de creaciones personalizadas", directory: carpeta("creaciones"))
          KitchenCatalog::Config.creaciones_dir = dir if dir
        end
      end

      def abrir_plugin(cual)
        case cual.to_s
        when "catalogo" then KitchenCatalog::Dialog.show if Puente.catalogo?
        when "creador"  then RoyalKitchen::CatalogCreator.mostrar_dialogo if Puente.creador?
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
