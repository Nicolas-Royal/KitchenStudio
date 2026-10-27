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

# Material: todo el mueble (frentes, estructura y fondo) con el elegido.
c = C.cambios_receta(CFG, { "material" => "ENCINO_COLOR_NUEVO" }, OP)
assert c.values_at("c16_material_puerta", "c15_material_estructura", "c17_material_fondo", "c21matestrde", "c23matfondode").uniq == ["ENCINO_COLOR_NUEVO"] &&
       c["c22matpuertade"] == "=c16_material_puerta", "el material va a frentes, estructura y fondo"
assert OP["materiales"].first["id"] == "SIN_MATERIAL" && OP["materiales"].first["color"] == "#ffffff", "«Sin material» (blanco) encabeza la lista"

# Espesor y canto de los frentes según el tipo de material.
mad = OP["materiales"].find { |m| m["familia"] == "Madera" }
assert C.cambios_receta(CFG, { "material" => mdf["id"] }, OP)["c02_espesor_puerta"] == "18mm", "MDF: puertas de 18 mm"
assert C.cambios_receta(CFG, { "material" => mad["id"] }, OP)["c02_espesor_puerta"] == "22mm", "madera (también Lisa): puertas de 22 mm"
assert !C.cambios_receta(CFG, { "material" => "SIN_MATERIAL" }, OP).key?("c02_espesor_puerta"), "sin material: el espesor del mueble"
assert C.canto_frente?(OP, mdf["id"]) && !C.canto_frente?(OP, mad["id"]) && C.canto_frente?(OP, "SIN_MATERIAL"),
       "canto rojo en los frentes: MDF sí, madera no"

# OpenCutList: los materiales del catálogo son «Tablero» (si no, no deja ponerles canto).
class MatFalso
  attr_reader :name, :attrs
  def initialize(name, attrs = {}); @name, @attrs = name, attrs; end
  def get_attribute(_d, k); @attrs[k]; end
  def set_attribute(_d, k, v); @attrs[k] = v; end
end
t = MatFalso.new(mdf["id"])
assert C.marcar_tablero(t, OP) && t.attrs["type"] == 2 && t.attrs["std_thicknesses"] == "18mm", "MDF: tablero de 18 mm en OpenCutList"
t = MatFalso.new(mad["id"])
assert C.marcar_tablero(t, OP) && t.attrs["std_thicknesses"] == "18mm;22mm" && t.attrs["grained"] == true, "madera: tablero de 18 y 22 mm con veta"
t = MatFalso.new(mad["id"], "type" => 1)
assert !C.marcar_tablero(t, OP) && t.attrs["type"] == 1, "un tipo puesto a mano no se toca"
assert !C.marcar_tablero(MatFalso.new("CANTO EXTERIOR"), OP), "lo que no es del catálogo no se toca"

# El esquinero no lleva Lateral negra (va en el canto de la esquina y las de
# las dos hojas chocan): el proyecto no la pone y el mueble conserva la suya.
ESQ = OP["familias"]["esquinero"]
c = C.cambios_receta(ESQ, { "manija_puerta" => "7" }, OP, { "b01_gola_o_tirador" => "1", "d16_tirador_tipo" => "9" })
assert !c.key?("d16_tirador_tipo"), "esquinero: Lateral negra del proyecto no se aplica"
c = C.cambios_receta(ESQ, { "manija_puerta" => "21" }, OP, { "b01_gola_o_tirador" => "1" })
assert c["d16_tirador_tipo"] == "21", "esquinero: otra manija sí"
assert C.excluida?(ESQ, "manija_puerta", 7) && !C.excluida?(CFG, "manija_puerta", "7"), "solo el esquinero la excluye"

# «Sin frente» (solo en un mueble): zonas abiertas, sin manijas ni gola.
c = C.cambios_receta(CFG, { "frente" => C::FRENTE_SIN, "manija_puerta" => "21", "gola" => "aluminio_oscuro" }, OP,
                     { "b01_gola_o_tirador" => "1", "l01_linea_frente" => "1" })
assert c.values_at("d11_z1_contenido", "d31_z2_contenido", "b01_gola_o_tirador") == %w[3 3 1], "gabinete sin frente: zonas abiertas y sin gola"
assert !c.key?("l01_linea_frente") && !c.key?("d16_z1_tirador_tipo"), "sin frente: ni línea de frente ni manijas"
c = C.cambios_receta(ESQ, { "frente" => C::FRENTE_SIN }, OP, { "b01_gola_o_tirador" => "1" })
assert c["c25tipopuerta"] == "0", "esquinero sin frente: sin puerta"
