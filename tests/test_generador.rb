# Generador sin tocar el modelo. Necesita SketchUp (el motor carga sketchup.rb):
#   load "<repo>/tests/test_generador.rb"   (consola Ruby o MCP eval_ruby)
load File.expand_path("../src/royal_kitchens_studio/generador.rb", __dir__)

def assert(cond, msg)
  raise "FALLA: #{msg}" unless cond
  puts "ok - #{msg}"
end

G   = RoyalKitchens::Studio::Generador
MAN = RoyalKitchens::Studio::Familias.manifiesto("gabinete")

assert File.exist?(G.componente(MAN)), "el componente base del gabinete viene con Studio"

assert G.condicion_cumple?({ "a" => "1" }, { "attr" => "a", "valor" => "1" }), "condición igual"
assert !G.condicion_cumple?({ "a" => "1" }, { "attr" => "a", "excepto" => ["1"] }), "condición excepto"
assert G.condicion_cumple?({ "a" => "2", "b" => "x" },
                           { "todas" => [{ "attr" => "a", "valores" => %w[1 2] }, { "attr" => "b", "valor" => "x" }] }),
       "condición todas"

assert G.validar_medidas(MAN, { "LenX" => "600mm" }).nil?, "medida válida"
assert G.validar_medidas(MAN, { "LenX" => "seiscientos" }) =~ /No son medidas válidas: LenX/, "texto en una medida"
assert G.validar_medidas(MAN, { "LenX" => "-5mm" }) =~ /negativos/, "medida negativa"

# El alto del gabinete lleva sumado el zoclo; al cambiarlo se vuelve a sumar.
fila = { "LenZ" => "840mm", "a02_alto_zoclo" => "120mm", "LenX" => "600mm" }
v = G.aplicar_cambios(MAN, fila, { "LenZ" => "700mm" })
assert G.medida_in(v, "LenZ") * 25.4 - 820 < 0.01 && v["LenX"] == "600mm", "alto capturado + zoclo"
assert G.capturado_mm(MAN, fila, "LenZ") == 720, "medida capturada sin zoclo para la ficha"

f = G.ficha_creacion("gabinete", MAN, "GAB-PRUEBA", { "valores" => fila }, Time.at(0))
assert f["tipo"] == "creacion" && f["medidas_mm"]["ancho"] == 600 && f["receta"]["valores"] == fila, "ficha de la creación"
assert f["clase"] == "catalogo", "una creación nace de catálogo si no se dice otra cosa"
fu = G.ficha_creacion("gabinete", MAN, "X", { "valores" => fila }, Time.at(0), clase: "usuario", creado_por: { "usuario" => "ana", "nombre" => "Ana" })
assert fu["clase"] == "usuario" && fu["creado_por"]["nombre"] == "Ana", "ficha creada por usuario"
assert G.ficha_creacion("gabinete", MAN, "X", { "valores" => fila }, Time.at(0), creado_por: { "usuario" => "ana" })["creado_por"].nil?, "el catálogo no lleva autor"

int = G.cambios_interior(MAN, { "h02_cantidad" => 2, "h11_espacio1_alto" => "343mm", "LenX" => "9000mm", "h21_entrepano1_retiro_fondo" => ["x"] })
assert int == { "h02_cantidad" => "2", "h11_espacio1_alto" => "343mm" }, "interior: solo campos del grupo de entrepaños, como texto"
assert G.cambios_interior(MAN, nil) == {}, "interior vacío"

modelo = RoyalKitchens::Studio::Plantilla.modelo(RoyalKitchens::Studio::Familias.manifiestos.to_a)
assert modelo.is_a?(Hash) || modelo.is_a?(Array), "modelo de columnas de la plantilla"
