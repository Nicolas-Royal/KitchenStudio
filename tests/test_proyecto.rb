# Lógica pura, sin SketchUp:  ruby tests/test_proyecto.rb
$LOAD_PATH.unshift File.expand_path("../src/royal_kitchens_studio", __dir__)
require "proyecto"

def assert(cond, msg)
  raise "FALLA: #{msg}" unless cond
  puts "ok - #{msg}"
end

P = RoyalKitchens::Studio::Proyecto

d = P.normalizar(nil)
assert d["global"]["frente"] == "1" && d["global"]["manija_puerta"] == "9" && d["global"]["manija_cajon"] == "9",
       "sin datos: diseño por defecto"
assert d["global"]["medidas"] == { "igualar" => false, "ancho" => 600, "alto" => 770, "fondo" => 600 }, "medidas por defecto"
assert d["modulos"] == {}, "sin personalizaciones"

d = P.normalizar("global" => { "frente" => "3", "medidas" => { "igualar" => true }, "basura" => 1 },
                 "modulos" => { "gab-1" => { "personalizado" => true, "frente" => "2" }, "x" => "no es hash" })
assert d["global"]["frente"] == "3", "conserva lo elegido"
assert d["global"]["medidas"]["igualar"] == true && d["global"]["medidas"]["alto"] == 770, "completa medidas faltantes"
assert !d["global"].key?("basura"), "descarta claves desconocidas"
assert d["modulos"].keys == ["gab-1"], "descarta personalizaciones mal formadas"
assert d["global"]["tarja"] == false, "tarja siempre booleana"

d = P.normalizar("global" => { "manija" => "11" }, "modulos" => { "g" => { "manija" => "7", "manija_cajon" => "15" } })
assert d["global"].values_at("manija_puerta", "manija_cajon") == %w[11 11] && !d["global"].key?("manija"),
       "manija única de antes -> puertas y cajones"
assert d["modulos"]["g"].values_at("manija_puerta", "manija_cajon") == %w[7 15], "migra módulos sin pisar lo nuevo"

assert P.parse("{roto")["global"]["frente"] == "1", "JSON roto -> por defecto"
assert P.parse("")["modulos"] == {}, "vacío -> por defecto"
