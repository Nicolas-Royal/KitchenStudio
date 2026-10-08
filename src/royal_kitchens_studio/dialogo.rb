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
        data = { "dependencias" => deps, "proyecto" => Proyecto.leer, "version" => VERSION }
        return data unless Puente.catalogo?

        root = KitchenCatalog::Config.catalog_root!
        cr   = KitchenCatalog::Config.creaciones_dir
        KitchenCatalog::Thumbnails.ensure_instancias(root) if root
        catalogo = root ? KitchenCatalog::Dialog.load_manifest(root, false) : { "modules" => [] }
        catalogo = KitchenCatalog::Catalog.merge_instancias(catalogo, root, cr) if root
        data.merge!(
          "modulos"    => catalogo["modules"] || [],
          "categorias" => (catalogo["facets"] || {})["categories"] || [],
          "opciones"   => KitchenCatalog::Configurador.para_ui(root, KitchenCatalog::Config::BUNDLED_SEED),
          "carpetas"   => { "catalogo" => root, "creaciones" => cr }
        )
        if Puente.creador?
          cc = RoyalKitchen::CatalogCreator
          data["carpetas"]["creador"]       = cc.project_root
          data["carpetas"]["creador_valido"] = cc.project_root_valido?
          data["manifiestos"] = cc.manifiestos_activos.to_h
          data["rcc_core"]    = Puente.rcc_core_js
        end
        data
      end

      # ---- Insertar (módulo tal cual o con diseño) ----------------------------
      #
      # { id, eleccion } -> KitchenCatalog::Inserter.place. Con eleccion, una
      # creación se regenera desde su receta; un módulo del catálogo solo
      # ajusta medidas (su diseño ya viene armado).
      def insertar(req)
        raise "Falta el Catálogo de Módulos 0.3 o superior." unless Puente.catalogo?
        KitchenCatalog::Inserter.place(req["id"].to_s, {}, req["eleccion"])
        { "ok" => true, "id" => req["id"] }
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

      def carpeta(cual)
        case cual
        when "catalogo"   then KitchenCatalog::Config.catalog_root!
        when "creaciones" then KitchenCatalog::Config.creaciones_dir
        when "creador"    then RoyalKitchen::CatalogCreator.project_root
        end
      end

      def abrir_carpeta(cual)
        dir = carpeta(cual.to_s)
        return unless dir
        FileUtils.mkdir_p(dir) if cual.to_s == "creaciones"
        UI.openURL("file:///#{dir.tr('\\', '/')}")
      end

      def cambiar_carpeta(cual)
        case cual.to_s
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

      # Otro modelo = otro proyecto: se relee su configuración.
      class ObservadorApp < Sketchup::AppObserver
        def onNewModel(_model);  Dialogo.refrescar; end
        def onOpenModel(_model); Dialogo.refrescar; end
      end
    end
  end
end
