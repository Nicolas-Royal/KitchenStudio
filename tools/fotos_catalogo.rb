# =============================================================================
#  fotos_catalogo.rb — Fotos de frentes y manijas desde el gabinete base
# -----------------------------------------------------------------------------
#  Uso (consola Ruby de SketchUp, con el gabinete base como único componente
#  de la escena):
#     load "<repo>/tools/fotos_catalogo.rb"
#     RoyalKitchens::FotosCatalogo.todo
#
#  - Frentes: pone cada l01_linea_frente sin manijas, redibuja el DC y toma la
#    vista frontal encuadrando solo las zonas de frente (Z1_*, Z2_*), sin la
#    estructura ni el zoclo. Oculta los símbolos de apertura (SimbFachada*) y
#    la etiqueta MP_LineasPuertas.
#  - Manijas: copia cada «Tirador …» de la tapa del primer cajón (con su
#    posición y material reales) a un grupo temporal aparte y lo fotografía a
#    45° (y 25° de elevación) con el gabinete oculto.
#  - Al final regresa el gabinete a sus valores originales.
#
#  Salida: src/royal_kitchens_studio/catalogo/frentes/<id>_<Nombre>.jpg y
#  catalogo/manijas/<id>_<Nombre>.png; catalogo/opciones.json apunta a esos
#  nombres (si cambia un nombre, actualizar ahí también).
#  Un redibujado del DC tarda ~10–18 s por frente.
# =============================================================================
require "fileutils"

module RoyalKitchens
  module FotosCatalogo
    module_function

    SALIDA = File.expand_path("../src/royal_kitchens_studio/catalogo", __dir__)
    DA = "dynamic_attributes".freeze
    TIRADORES = %w[e01_tirador_tipo d16_z1_tirador_tipo d36_z2_tirador_tipo].freeze

    def gabinete
      Sketchup.active_model.entities.grep(Sketchup::ComponentInstance).first or raise "No hay gabinete en la escena."
    end

    def slug(s)
      s.to_s.unicode_normalize(:nfd).gsub(/[̀-ͯ]/, "").gsub(/[^A-Za-z0-9]+/, "_").gsub(/\A_|_\z/, "")
    end

    # Opciones de una variable LIST del DC: [[valor, nombre], …]. Vienen
    # codificadas en Latin-1 (%F3 = ó).
    def opciones(attr)
      gabinete.definition.get_attribute(DA, "_#{attr}_options").to_s.split("&").reject(&:empty?).map do |par|
        k, v = par.split("=")
        [v, k.gsub(/%([0-9A-Fa-f]{2})/) { Regexp.last_match(1).hex.chr }.force_encoding("ISO-8859-1").encode("UTF-8")]
      end
    end

    def redibujar
      $dc_observers.get_latest_class.redraw_with_undo(gabinete)
    end

    def simbolos(ocultar)
      vistos = {}
      rec = lambda do |ents|
        ents.each do |e|
          next unless e.respond_to?(:definition)
          if e.definition.name =~ /\ASimbFachada/ then e.hidden = ocultar
          elsif !vistos[e.definition] then vistos[e.definition] = true; rec.call(e.definition.entities)
          end
        end
      end
      rec.call(gabinete.definition.entities)
      Sketchup.active_model.layers["MP_LineasPuertas"]&.visible = !ocultar
    end

    # Cámara en perspectiva cerrada (fov 10–12°): una vista frontal exacta en
    # paralela deja ver cantos de canto que en foto no se ven.
    def foto(bb, ruta, dir, w, h, margen, fov = 12.0)
      m = Sketchup.active_model; v = m.active_view; ro = m.rendering_options
      c0 = v.camera
      cam0 = Sketchup::Camera.new(c0.eye, c0.target, c0.up, c0.perspective?, c0.fov)
      bg0 = ro["BackgroundColor"]
      ro["BackgroundColor"] = Sketchup::Color.new(255, 255, 255)
      c = bb.center
      dirv = dir.clone.normalize
      up = dirv.parallel?(Z_AXIS) ? Y_AXIS : Z_AXIS
      tmp = Sketchup::Camera.new(c.offset(dirv.reverse, 1), c, up)
      pts = (0..7).map { |k| bb.corner(k) }
      ext = ->(eje) { a, b = pts.map { |p| (p - c).dot(eje) }.minmax; b - a }
      medio = [ext.call(tmp.yaxis), ext.call(tmp.xaxis) * h.to_f / w].max * (1 + margen) / 2
      prof = pts.map { |p| (p - c).dot(dirv) }.max
      dist = medio / Math.tan(fov / 2 * Math::PI / 180) + prof
      v.camera = Sketchup::Camera.new(c.offset(dirv.reverse, dist), c, up, true, fov)
      v.write_image(filename: ruta, width: w, height: h, antialias: true, compression: 0.85)
    ensure
      ro["BackgroundColor"] = bg0 if bg0
      v.camera = cam0 if cam0
    end

    def bb_frentes
      g = gabinete
      bb = Geom::BoundingBox.new
      g.definition.entities.each do |e|
        next unless e.respond_to?(:definition) && e.visible? && e.name =~ /\AZ\d_/
        (0..7).each { |k| bb.add(e.bounds.corner(k).transform(g.transformation)) }
      end
      bb
    end

    def frentes
      FileUtils.mkdir_p(File.join(SALIDA, "frentes"))
      d = gabinete.definition
      TIRADORES.each { |k| d.set_attribute(DA, k, "1") }
      opciones("l01_linea_frente").map do |id, nombre|
        gabinete.definition.set_attribute(DA, "l01_linea_frente", id)
        redibujar
        simbolos(true)
        bb = bb_frentes
        ruta = File.join(SALIDA, "frentes", format("%02d_%s.jpg", id.to_i, slug(nombre)))
        foto(bb, ruta, Geom::Vector3d.new(0, 1, 0), 700, (700 * bb.depth / bb.width).round, 0, 10.0)
        ruta
      end
    end

    def tapa_y_transformacion
      g = gabinete
      zona = g.definition.entities.find { |e| e.respond_to?(:definition) && e.visible? && e.name =~ /CAJONES\z/ } or
        raise "El gabinete necesita una zona de cajones visible para tomar las manijas."
      caj = zona.definition.entities.find { |e| e.respond_to?(:name) && e.name == "Cajon 1" }
      tapa = caj.definition.entities.find { |e| e.respond_to?(:definition) && e.definition.name =~ /BTapaCaj/ }
      [tapa, g.transformation * zona.transformation * caj.transformation * tapa.transformation]
    end

    def piezas(tapa, id, nombre)
      hijos = tapa.definition.entities.select { |e| e.respond_to?(:definition) }
      case id
      when "7"  then hijos.select { |e| e.definition.name =~ /\A(Tap\.Tirador|TirCLE)/ }   # Lateral negra
      when "21" then hijos.select { |e| e.definition.name =~ /PerfilTirador Berlin/ }
      else hijos.select { |e| slug(e.definition.name.sub(/\ATirador /, "").sub(/#\d+\z/, "")).casecmp?(slug(nombre)) }
      end
    end

    def manijas
      FileUtils.mkdir_p(File.join(SALIDA, "manijas"))
      m = Sketchup.active_model
      tapa, t = tapa_y_transformacion
      az = 45 * Math::PI / 180; el = 25 * Math::PI / 180
      dir = Geom::Vector3d.new(-Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), -Math.sin(el))
      opciones("e01_tirador_tipo").reject { |id, _| id == "1" }.map do |id, nombre|
        ps = piezas(tapa, id, nombre)
        raise "No encontré la pieza de la manija «#{nombre}»." if ps.empty?
        grp = m.entities.add_group
        lejos = Geom::Transformation.translation([4000.mm, 0, 0])
        ps.each do |p|
          ni = grp.entities.add_instance(p.definition, lejos * t * p.transformation)
          ni.material = p.material if p.material
        end
        gabinete.hidden = true
        ruta = File.join(SALIDA, "manijas", format("%02d_%s.png", id.to_i, slug(nombre)))
        begin
          foto(grp.bounds, ruta, dir, 600, 450, 0.25)
        ensure
          grp.erase!
          gabinete.hidden = false
        end
        ruta
      end
    end

    def todo
      d = gabinete.definition
      claves = %w[l01_linea_frente] + TIRADORES
      orig = claves.to_h { |k| [k, d.get_attribute(DA, k)] }
      tomadas = frentes + manijas
      tomadas
    ensure
      if orig
        orig.each { |k, v| gabinete.definition.set_attribute(DA, k, v) unless v.nil? }
        redibujar
        simbolos(false)
      end
    end
  end
end
