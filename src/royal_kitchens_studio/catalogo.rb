require "json"

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
      def para_ui
        data = cargar
        GRUPOS.each do |g|
          data[g] = Array(data[g]).map { |o| o.merge("foto_abs" => foto_abs(o["foto"])) }
        end
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

      # Regla de la guía RK: MDF laminado solo existe en puerta Lisa.
      def error_material(opciones, material, frente)
        mat = buscar(opciones, "materiales", material)
        fr  = buscar(opciones, "frentes", frente)
        return nil unless mat && fr && mat["familia"] == "MDF" && fr["solo_madera"]
        "#{mat['nombre']} es MDF: solo se fabrica en puerta Lisa (no #{fr['nombre']})"
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
        fa = cfg.dig("frente", "attr")
        cambios[fa] = eleccion["frente"].to_s if fa && !eleccion["frente"].to_s.empty?
        frente = cambios.fetch(fa, valores[fa]).to_s
        USOS.each do |uso, clave|
          h = cfg[clave]
          id = eleccion[clave].to_s
          next if h.nil? || id.empty?
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
          (m["extra"] || {}).each { |k, v| cambios[k] = v.to_s }
        end
        cambios
      end

      def numero(v)
        Float(v.to_s.tr(",", "."))
      rescue ArgumentError
        0.0
      end
    end
  end
end
