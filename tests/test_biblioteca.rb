# Lógica pura, sin SketchUp:  ruby tests/test_biblioteca.rb
require "tmpdir"
require "json"
load File.expand_path("../src/royal_kitchens_studio/biblioteca.rb", __dir__)

def assert(cond, msg)
  raise "FALLA: #{msg}" unless cond
  puts "ok - #{msg}"
end

B = RoyalKitchens::Studio::Biblioteca

ficha = { "nombre" => "GAB-600", "familia" => "gabinete", "categoria" => "Gabinetes",
          "caracteristicas" => { "puerta" => ["Lisa"], "otra" => ["x"] },
          "medidas_mm" => { "ancho" => 600, "alto" => 770 }, "receta" => { "valores" => { "LenX" => "600mm" } } }
c = B.card(ficha, "C:/cat/GAB-600.json")
assert c["id"] == "cr-gab-600" && !c.key?("skp"), "id desde el nombre del archivo; sin .skp (se genera desde el base)"
assert c["specs"] == { "sku" => "GAB-600", "ancho_mm" => 600, "alto_mm" => 770 }, "medidas de la ficha"
assert c["features"] == { "tipo" => [], "puerta" => ["Lisa"], "configuracion" => [] }, "solo los grupos conocidos"
assert c["receta_familia"] == "gabinete" && c["_source"] == "creaciones", "familia de la receta"
assert B.card(ficha.merge("receta" => nil), "x.json").nil?, "sin receta no es mueble del catálogo"
assert c["clase"] == "catalogo", "sin clase en la ficha: es de catálogo"
u = B.card(ficha.merge("clase" => "usuario", "creado_por" => { "usuario" => "ana", "nombre" => "Ana" }), "x.json")
assert u["clase"] == "usuario" && u["creado_por"]["nombre"] == "Ana", "creado por usuario"
assert B.card(ficha.merge("clase" => "personalizado"), "x.json")["clase"] == "usuario", "«personalizado» de las primeras fichas es de usuario"
assert c["creado_por"].nil?, "el de catálogo no tiene autor"
assert B.card(ficha.merge("clase" => "otra"), "x.json")["clase"] == "catalogo", "clase desconocida: catálogo"
assert B.card({}, "x.json").nil?, "ficha vacía"

assert B.categorias([{ "category" => "Zapateras" }, { "category" => "Gabinetes" }]).last == "Zapateras",
       "categorías fijas primero y luego las nuevas"

Dir.mktmpdir do |dir|
  File.write(File.join(dir, "B.json"), JSON.generate(ficha.merge("nombre" => "B")))
  File.write(File.join(dir, "A.json"), JSON.generate(ficha.merge("nombre" => "A")))
  File.write(File.join(dir, "roto.json"), "{no es json")
  File.write(File.join(dir, "sin_receta.json"), JSON.generate("nombre" => "x"))
  assert B.modulos(dir).map { |m| m["name"] } == %w[A B], "lee la carpeta, ordena y salta lo roto"
  assert B.buscar(dir, "cr-a")["name"] == "A", "buscar por id"
  assert B.existente(dir, "a") == "A" && B.existente(dir, " A ") == "A", "existente: mismo id aunque cambien mayúsculas o espacios"
  assert B.existente(dir, "C").nil? && B.existente(nil, "A").nil?, "existente: nombre libre"
  File.write(File.join(dir, "GAB 600.json"), JSON.generate(ficha.merge("nombre" => "con espacio")))
  File.write(File.join(dir, "GAB-600.json"), JSON.generate(ficha.merge("nombre" => "con guion")))
  File.write(File.join(dir, "suelto.skp"), "")
  ids = B.modulos(dir).map { |m| m["id"] }
  assert ids.uniq.size == ids.size && ids.include?("cr-gab-600") && ids.include?("cr-gab-600-2"), "dos archivos con el mismo id no se tapan"
  assert B.buscar(dir, "cr-gab-600-2")["name"] == "con guion", "el segundo se puede abrir"
  assert B.existente(dir, "gab_600") == "GAB 600" && B.existente(dir, "SUELTO") == "suelto", "existente: también un .skp sin ficha"
  err = (B.buscar(dir, "cr-zzz") rescue $!.message)
  assert err =~ /No encontré/, "buscar algo que no está"
end
assert B.modulos(nil) == [] && B.modulos("C:/no/existe") == [], "sin carpeta: catálogo vacío"

mods = [{ "id" => "cr-a", "specs" => { "sku" => "A" } }, { "id" => "cr-b", "specs" => { "sku" => "B" } },
        { "id" => "cr-b2", "specs" => { "sku" => "B" } }]
pr = { "modulos" => { "cr-x" => { "personalizado" => true } } }
assert B.sigue_proyecto({ "modulo" => "cr-x", "modo" => "global" }, "A", mods, pr) == "cr-x",
       "marcado con el diseño del proyecto: se aplica aunque hoy tenga ajuste"
assert B.sigue_proyecto({ "modulo" => "cr-a", "modo" => "personal" }, "A", mods, pr).nil? &&
       B.sigue_proyecto({ "modulo" => "cr-a", "modo" => "original" }, "A", mods, pr).nil?, "ajustado u original: no cambia"
assert B.sigue_proyecto({}, "A", mods, pr) == "cr-a", "sin marca: por el sku"
assert B.sigue_proyecto({}, "B", mods, pr).nil? && B.sigue_proyecto({}, "", mods, pr).nil? &&
       B.sigue_proyecto({}, "Z", mods, pr).nil?, "sin marca: sku repetido, vacío o ajeno no se toca"
assert B.sigue_proyecto({}, "A", mods, { "modulos" => { "cr-a" => { "original" => true } } }).nil?,
       "sin marca y con elección propia en el proyecto: no se toca"
