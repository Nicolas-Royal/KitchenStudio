# Lógica pura, sin SketchUp:  ruby tests/test_catalogo.rb
$LOAD_PATH.unshift File.expand_path("../src/royal_kitchens_studio", __dir__)
require "catalogo"

def assert(cond, msg)
  raise "FALLA: #{msg}" unless cond
  puts "ok - #{msg}"
end

C   = RoyalKitchens::Studio::Catalogo
OP  = C.cargar
CFG = OP["familias"]["gabinete"]

def falla(eleccion, valores = {})
  C.cambios_receta(CFG, eleccion, OP, valores)
  nil
rescue ArgumentError => e
  e.message
end

c = C.cambios_receta(CFG, { "manija_puerta" => "9", "manija_cajon" => "11" }, OP)
assert c.values_at("d16_z1_tirador_tipo", "d36_z2_tirador_tipo", "e01_tirador_tipo") == %w[9 9 11],
       "manija de puertas en d16/d36 y de cajones en e01"
assert !c.key?("d17_z1_tirador_posicion"), "posición: la de la receta salvo regla"

c = C.cambios_receta(CFG, { "manija_puerta" => "7", "manija_cajon" => "7" }, OP)
assert c.values_at("d17_z1_tirador_posicion", "d37_z2_tirador_posicion") == %w[5 5], "Lateral negra en puertas: Centro-Centro"
assert !c.key?("e02_tirador_posicion"), "Lateral negra en cajones: posición de la receta"

assert falla("manija_puerta" => "15") =~ /Concha dorada no se usa en puertas/, "concha no va en puertas"
assert falla("manija_cajon" => "15").nil?, "concha sí va en cajones"

assert falla("frente" => "3", "manija_cajon" => "21") =~ /Berlín solo con frente Lisa/, "Berlín solo con Lisa"
assert falla("frente" => "1", "manija_puerta" => "21").nil?, "Berlín con Lisa"
assert falla({ "manija_cajon" => "21" }, { "l01_linea_frente" => "6" }) =~ /Berlín/, "Berlín revisa el frente de la receta"

c = C.cambios_receta(CFG, { "manija_puerta" => "15" }, OP, { "b01_gola_o_tirador" => "2" })
assert !c.key?("d16_z1_tirador_tipo"), "con gola no se escribe manija (ni se valida)"

mdf = OP["materiales"].find { |m| m["familia"] == "MDF" }
assert falla("frente" => "3", "material" => mdf["id"]) =~ /MDF/, "MDF solo en Lisa"
