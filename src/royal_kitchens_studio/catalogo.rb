require "json"
require_relative "acabado"

module RoyalKitchens
  module Studio
    # Opciones de diseño (frentes, manijas, materiales, medidas) con sus fotos.
    # Fuente propia de Studio: catalogo/opciones.json + catalogo/frentes/ y
    # catalogo/manijas/ (fotos tomadas del gabinete base con
    # tools/fotos_catalogo.rb). Ya no se leen de KitchenCatalog.
    #
    # La manija se elige aparte para puertas y para cajones. Reglas por tirador
    # en opciones.json: usos (dónde se puede), solo_frentes y posicion.<uso>
    # (la UI aplica las mismas en ui/reglas.js).
    module Catalogo
      module_function

      DIR = File.join(__dir__, "catalogo").freeze
      GRUPOS = %w[frentes tiradores materiales].freeze
      USOS = { "puerta" => "manija_puerta", "cajon" => "manija_cajon" }.freeze
      # Tipo de frente «Sin frente» de un mueble (igual a RKReglas.FRENTE_SIN).
      FRENTE_SIN = "sin".freeze
      NOMBRE_USO = { "puerta" => "puertas", "cajon" => "cajones" }.freeze

      def cargar
        JSON.parse(File.read(File.join(DIR, "opciones.json"), encoding: "utf-8"))
      end

      def foto_abs(rel)
        return nil if rel.to_s.empty?
        ruta = File.join(DIR, rel)
        File.exist?(ruta) ? ruta : nil
      end

      # opciones.json + ruta absoluta de cada foto ("foto_abs"), listo para la UI.
      # La "muestra" de un material (su foto de la Guía RK) solo se ve en los
      # selectores: el material en SketchUp sigue saliendo de "foto" o de la veta.
      def para_ui
        data = cargar
        GRUPOS.each do |g|
          data[g] = Array(data[g]).map do |o|
            o.merge("foto_abs" => foto_abs(o["foto"]), "muestra_abs" => foto_abs(o["muestra"]))
          end
        end
        data["textura_veta"] = textura_veta(data)
        data
      end

      # ---- Reglas (lógica pura) ------------------------------------------------

      def buscar(opciones, grupo, id)
        Array(opciones[grupo]).find { |o| o["id"].to_s == id.to_s }
      end

      # Por qué la manija +id+ no se puede usar en +uso+ ("puerta"|"cajon") con
      # el frente +frente+, o nil si se puede.
      def error_manija(opciones, uso, id, frente)
        t = buscar(opciones, "tiradores", id)
        return nil unless t
        usos = Array(t["usos"])
        return "#{t['nombre']} no se usa en #{NOMBRE_USO[uso]}" if usos.any? && !usos.include?(uso)
        solo = Array(t["solo_frentes"]).map(&:to_s)
        if solo.any? && !frente.to_s.empty? && !solo.include?(frente.to_s)
          nombres = solo.map { |f| (buscar(opciones, "frentes", f) || {})["nombre"] || f }
          return "#{t['nombre']} solo con frente #{nombres.join(' o ')}"
        end
        nil
      end

      # ¿La familia (+cfg+ = opciones.familias.<f>) deja fuera la opción +id+
      # de +clave+? (el esquinero no lleva Lateral negra: va en el canto de la
      # esquina y las de las dos hojas chocan). Igual a RKReglas.excluida.
      def excluida?(cfg, clave, id)
        h = cfg && cfg[clave]
        !!h && Array(h["excluir"]).map(&:to_s).include?(id.to_s)
      end

      # Regla de la guía RK: MDF laminado solo existe en puerta Lisa.
      def error_material(opciones, material, frente)
        mat = buscar(opciones, "materiales", material)
        fr  = buscar(opciones, "frentes", frente)
        return nil unless mat && fr && mat["familia"] == "MDF" && fr["solo_madera"]
        "#{mat['nombre']} es MDF: solo se fabrica en puerta Lisa (no #{fr['nombre']})"
      end

      # Lo que depende de si el material es MDF o madera (opciones.json →
      # tipos_material): espesor de puertas y canto de los frentes lisos. {}
      # si no es de un tipo conocido (Sin material).
      def tipo_material(opciones, material)
        mat = buscar(opciones, "materiales", material)
        (mat && (opciones["tipos_material"] || {})[mat["familia"]]) || {}
      end

      # Espesor de puertas y tapas para +material+: la madera (también su Lisa)
      # es de 22 mm y el MDF de 18. {} sin regla.
      def cambios_espesor(cfg, opciones, material)
        attr = cfg.dig("espesor_puerta", "attr")
        mm = tipo_material(opciones, material)["espesor_puerta"]
        attr && mm ? { attr => "#{mm}mm" } : {}
      end

      # ¿Las puertas y tapas lisas de +material+ llevan cubrecanto en
      # planeación? Solo la madera no (es de 22 mm, sin chapa).
      def canto_frente?(opciones, material)
        tipo_material(opciones, material)["canto_frente"] != false
      end

      # Con gola solo se fabrica el frente marcado con_gola (Lisa).
      def frente_gola(opciones)
        f = Array(opciones["frentes"]).find { |o| o["con_gola"] }
        f && f["id"].to_s
      end

      def error_gola(opciones, frente)
        fr = buscar(opciones, "frentes", frente)
        return nil if fr.nil? || fr["con_gola"]
        ok = Array(opciones["frentes"]).select { |o| o["con_gola"] }.map { |o| o["nombre"] }
        "Con gola solo se fabrica puerta #{ok.join(' o ')} (no #{fr['nombre']})"
      end

      # Cambios de la receta para la gola +id+ (golas[].id; vacío = la del
      # mueble), con la combinación L-C/L-L si lleva gola. Igual a
      # RKReglas.cambiosGola.
      def cambios_gola(cfg, opciones, id, combinacion)
        o = id.to_s.empty? ? nil : buscar(opciones, "golas", id)
        g = cfg["gola"]
        return {} unless o && g
        out = (o["valores"] || {}).transform_values(&:to_s)
        lleva = out[g["attr"]].to_s == g["valor"].to_s
        out[g["combinacion"]] = combinacion.to_s if lleva && g["combinacion"] && !combinacion.to_s.empty?
        out
      end

      # ¿La receta (con los cambios encima) lleva gola? (familias.<f>.gola)
      def gola?(cfg, cambios, valores)
        g = cfg["gola"]
        return false unless g
        cambios.fetch(g["attr"], valores[g["attr"]]).to_s == g["valor"].to_s
      end

      # Elección de la UI -> cambios de la receta (campos del manifiesto).
      #
      #   eleccion: { "ancho"=>600, "alto"=>770, "fondo"=>578, "tarja"=>true, "frente"=>"1",
      #               "manija_puerta"=>"7", "manija_cajon"=>"15", "material"=>"ENCINO_WENGUE" }
      #
      # +valores+ = los de la receta (para «requiere»: con gola no hay manija).
      # Solo se devuelve lo que viene en la elección. Lanza ArgumentError si la
      # elección rompe una regla.
      def cambios_receta(cfg, eleccion, opciones, valores = {})
        cambios = {}
        (cfg["medidas"] || {}).each do |clave, attr|
          mm = numero(eleccion[clave])
          cambios[attr] = "#{mm == mm.round ? mm.round : mm}mm" if mm > 0
        end
        if (t = cfg["tarja"]) && eleccion.key?("tarja")
          cambios[t["attr"]] = [true, "1", "true"].include?(eleccion["tarja"]) ? t["si"].to_s : t["no"].to_s
        end
        # Gola elegida en el diseño (antes que frente y manijas: decide si llevan).
        cambios.merge!(cambios_gola(cfg, opciones, eleccion["gola"], eleccion["gola_combinacion"]))
        fa = cfg.dig("frente", "attr")
        # «Sin frente» (solo en un mueble): abierto, sin puertas ni cajones; no
        # lleva manijas ni gola (cfg["sin_frente"]["valores"]).
        sin = eleccion["frente"].to_s == FRENTE_SIN && cfg["sin_frente"].is_a?(Hash)
        if sin
          (cfg["sin_frente"]["valores"] || {}).each { |a, v| cambios[a] = v.to_s }
        else
          cambios[fa] = eleccion["frente"].to_s if fa && !eleccion["frente"].to_s.empty?
          # Con gola el frente es siempre Lisa: el del proyecto no se aplica.
          if fa && gola?(cfg, cambios, valores) && error_gola(opciones, cambios.fetch(fa, valores[fa]))
            cambios[fa] = frente_gola(opciones).to_s
          end
        end
        frente = cambios.fetch(fa, valores[fa]).to_s
        USOS.each do |uso, clave|
          h = cfg[clave]
          id = eleccion[clave].to_s
          next if sin || h.nil? || id.empty? || excluida?(cfg, clave, id)
          req = h["requiere"]
          actual = req && cambios.fetch(req["attr"], valores[req["attr"]])
          next if req && !actual.nil? && actual.to_s != req["valor"].to_s
          err = error_manija(opciones, uso, id, frente)
          raise ArgumentError, err if err
          Array(h["attrs"]).each { |a| cambios[a] = id }
          pos = (buscar(opciones, "tiradores", id) || {}).dig("posicion", uso)
          Array(h["posicion"]).each { |a| cambios[a] = pos.to_s } if pos
        end
        if (m = cfg["material"]) && !eleccion["material"].to_s.empty?
          err = error_material(opciones, eleccion["material"], frente)
          raise ArgumentError, err if err
          cambios[m["attr"]] = eleccion["material"].to_s
          # {material} = el elegido. Todo el mueble: estructura y fondo además de
          # frentes. c21matestrde/c23matfondode van directos porque el DC no
          # recalcula su fórmula en la raíz (la tienen solo en la definición) y
          # la estructura se quedaba con la madera del componente.
          (m["extra"] || {}).each { |k, v| cambios[k] = v.to_s.gsub("{material}", eleccion["material"].to_s) }
          cambios.merge!(cambios_espesor(cfg, opciones, eleccion["material"]))
        end
        cambios
      end

      # ---- SketchUp ----------------------------------------------------------

      TEXTURA_MM    = 600
      COLOR_FAMILIA = { "MDF" => [205, 205, 200], "Madera" => [176, 132, 92] }.freeze

      # El componente aplica el material por NOMBRE (c22matpuertade =
      # c16_material_puerta), así que tiene que existir antes del redibujado.
      # Orden: ya está en el modelo > foto del catálogo como textura > madera:
      # textura de veta (TEKA ARTICO-VESTO1) teñida con su tono (Acabado) >
      # tono liso de opciones.json (el mismo de la vista previa). Una madera
      # que Studio creó antes lisa, o con una veta de otra versión, se completa.
      def asegurar_material(model, id)
        id = id.to_s
        return if id.empty?
        op  = cargar
        o   = buscar(op, "materiales", id) || {}
        foto = foto_abs(o["foto"])
        base = textura_veta(op)
        con_veta = !foto && base && o["veta"] && o["color"]
        if (mat = model.materials[id])
          Acabado.poner_veta(mat, o["color"], base) if con_veta && Acabado.falta_veta?(mat, o["color"])
          marcar_tablero(mat, op)
          return
        end
        mat = model.materials.add(id)
        if foto
          mat.texture = foto
          mat.texture.size = TEXTURA_MM.mm
        elsif con_veta
          Acabado.poner_veta(mat, o["color"], base)
        else
          mat.color = o["color"] ? Sketchup::Color.new(o["color"]) : Sketchup::Color.new(*(COLOR_FAMILIA[o["familia"]] || [200, 200, 200]))
        end
        marcar_tablero(mat, op)
      end

      OCL         = "ladb_opencutlist".freeze
      OCL_TABLERO = 2 # tipo «Tablero» (sheet good) de OpenCutList

      # OpenCutList solo pone cubrecanto (CANTO EXTERIOR, SinCanto) en piezas
      # cuyo material es «Tablero»; con un material sin tipo avisa «La pieza
      # seleccionada debe ser del tipo 'Tablero'» y el despiece no lleva canto.
      # Los del catálogo lo son, con sus espesores estándar y veta según
      # opciones.json. Un material que ya tiene tipo (puesto a mano) no se toca.
      def marcar_tablero(mat, op = cargar)
        return false unless mat.get_attribute(OCL, "type").to_i.zero?
        o = buscar(op, "materiales", mat.name)
        return false unless o
        mat.set_attribute(OCL, "type", OCL_TABLERO)
        mat.set_attribute(OCL, "grained", !!o["veta"])
        grosores = tipo_material(op, o["id"])["grosores"]
        mat.set_attribute(OCL, "std_thicknesses", grosores) if grosores
        true
      end

      # Los materiales del catálogo que ya están en +model+ (proyectos de
      # antes). Devuelve cuántos marcó.
      def marcar_tableros(model)
        op = cargar
        mats = model.materials.select { |m| m.get_attribute(OCL, "type").to_i.zero? && buscar(op, "materiales", m.name) }
        return 0 if mats.empty?
        model.start_operation("Materiales como tablero", true, false, true)
        n = mats.count { |m| marcar_tablero(m, op) }
        model.commit_operation
        n
      end

      # opciones.json → textura_veta con su ruta absoluta, o nil si falta la imagen.
      def textura_veta(op = cargar)
        t = op["textura_veta"]
        ruta = t && foto_abs(t["foto"])
        ruta && t.merge("ruta" => ruta)
      end

      def numero(v)
        Float(v.to_s.tr(",", "."))
      rescue ArgumentError
        0.0
      end
    end
  end
end
