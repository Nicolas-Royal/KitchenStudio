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
assert c["id"] == "cr-gab-600" && c["skp"] == "C:/cat/GAB-600.skp", "id y .skp desde el nombre del archivo"
assert c["specs"] == { "sku" => "GAB-600", "ancho_mm" => 600, "alto_mm" => 770 }, "medidas de la ficha"
assert c["features"] == { "tipo" => [], "puerta" => ["Lisa"], "configuracion" => [] }, "solo los grupos conocidos"
assert c["receta_familia"] == "gabinete" && c["_source"] == "creaciones", "familia de la receta"
assert B.card(ficha.merge("receta" => nil), "x.json").nil?, "sin receta no es mueble del catálogo"
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
  err = (B.buscar(dir, "cr-zzz") rescue $!.message)
  assert err =~ /No encontré/, "buscar algo que no está"
end
assert B.modulos(nil) == [] && B.modulos("C:/no/existe") == [], "sin carpeta: catálogo vacío"
