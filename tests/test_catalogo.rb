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

# Con gola solo puerta Lisa: el frente del proyecto no se aplica.
assert C.frente_gola(OP) == "1", "el frente con gola es Lisa"
assert C.error_gola(OP, "3") =~ /Con gola solo se fabrica puerta Lisa \(no Mitered\)/, "Mitered no va con gola"
assert C.error_gola(OP, "1").nil?, "Lisa va con gola"
c = C.cambios_receta(CFG, { "frente" => "3" }, OP, { "b01_gola_o_tirador" => "2" })
assert c["l01_linea_frente"] == "1", "con gola, el frente del proyecto se vuelve Lisa"
assert falla({ "frente" => "3", "material" => mdf["id"] }, { "b01_gola_o_tirador" => "2" }).nil?, "con gola el MDF se revisa contra Lisa"
c = C.cambios_receta(CFG, { "frente" => "3" }, OP, { "b01_gola_o_tirador" => "1" })
assert c["l01_linea_frente"] == "3", "sin gola, el frente del proyecto"
c = C.cambios_receta(CFG, { "ancho" => 600 }, OP, { "b01_gola_o_tirador" => "2", "l01_linea_frente" => "7" })
assert c["l01_linea_frente"] == "1", "una receta con gola y otro frente se corrige al insertar"

# Gola elegida en el diseño: sin gola, melamina, aluminio claro/oscuro, L-C/L-L.
c = C.cambios_receta(CFG, { "gola" => "aluminio_oscuro", "gola_combinacion" => "2", "frente" => "3", "manija_puerta" => "9" }, OP, { "b01_gola_o_tirador" => "1" })
assert c.values_at("b01_gola_o_tirador", "g01_perfil_tipo", "c23_material_gola_aluminio", "g03_combinacion") == ["2", "1", "Negro mate", "2"], "gola aluminio oscuro L-L"
assert c["l01_linea_frente"] == "1" && !c.key?("d16_z1_tirador_tipo"), "con la gola elegida: frente Lisa y sin manija"
c = C.cambios_receta(CFG, { "gola" => "tirador", "manija_puerta" => "9" }, OP, { "b01_gola_o_tirador" => "2" })
assert c["b01_gola_o_tirador"] == "1" && c["d16_z1_tirador_tipo"] == "9" && !c.key?("g03_combinacion"), "sin gola: vuelve el tirador"
c = C.cambios_receta(CFG, { "gola" => "melamina", "gola_combinacion" => "1" }, OP, {})
assert c.values_at("b01_gola_o_tirador", "g01_perfil_tipo", "g03_combinacion") == %w[2 2 1], "gola melamina L-C"
assert !C.cambios_receta(CFG, { "gola" => "" }, OP, {}).key?("b01_gola_o_tirador"), "sin elección: la gola del mueble"
