# Lógica pura, sin SketchUp:  ruby tests/test_proyecto.rb
$LOAD_PATH.unshift File.expand_path("../src/royal_kitchens_studio", __dir__)
require "proyecto"

def assert(cond, msg)
  raise "FALLA: #{msg}" unless cond
  puts "ok - #{msg}"
end

P = RoyalKitchens::Studio::Proyecto

d = P.normalizar(nil)
assert d["global"]["frente"] == "1" && d["global"]["manija"] == "9", "sin datos: diseño por defecto"
assert d["global"]["medidas"] == { "igualar" => false, "alto" => 770, "fondo" => 578 }, "medidas por defecto"
assert d["modulos"] == {}, "sin personalizaciones"

d = P.normalizar("global" => { "frente" => "3", "medidas" => { "igualar" => true }, "basura" => 1 },
                 "modulos" => { "gab-1" => { "personalizado" => true, "frente" => "2" }, "x" => "no es hash" })
assert d["global"]["frente"] == "3", "conserva lo elegido"
assert d["global"]["medidas"]["igualar"] == true && d["global"]["medidas"]["alto"] == 770, "completa medidas faltantes"
assert !d["global"].key?("basura"), "descarta claves desconocidas"
assert d["modulos"].keys == ["gab-1"], "descarta personalizaciones mal formadas"
assert d["global"]["tarja"] == false, "tarja siempre booleana"

assert P.parse("{roto")["global"]["frente"] == "1", "JSON roto -> por defecto"
assert P.parse("")["modulos"] == {}, "vacío -> por defecto"
