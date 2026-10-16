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

pta = { "b01_gola_o_tirador" => "1", "d11_z1_contenido" => "1", "d16_z1_tirador_tipo" => "9", "d15_z1_cant_puertas" => "2" }
f = G.aplicar_forzados(MAN, pta)
assert f["d17_z1_tirador_posicion"] == "3" && f["d18_z1_tirador_orientacion"] == "2",
       "manija de puerta: aunque la fila no la traiga, arriba del lado que abre y vertical"
assert G.aplicar_forzados(MAN, pta.merge("d17_z1_tirador_posicion" => "9"))["d17_z1_tirador_posicion"] == "3", "y pisa lo que traiga"
assert !G.aplicar_forzados(MAN, pta.merge("b01_gola_o_tirador" => "2")).key?("d17_z1_tirador_posicion"), "con gola no se agrega"

assert G.validar_medidas(MAN, { "LenX" => "600mm" }).nil?, "medida válida"
assert G.validar_medidas(MAN, { "LenX" => "seiscientos" }) =~ /No son medidas válidas: LenX/, "texto en una medida"
assert G.validar_medidas(MAN, { "LenX" => "-5mm" }) =~ /negativos/, "medida negativa"

# El alto del gabinete lleva sumado el zoclo; al cambiarlo se vuelve a sumar.
fila = { "LenZ" => "840mm", "a02_alto_zoclo" => "120mm", "LenX" => "600mm" }
v = G.aplicar_cambios(MAN, fila, { "LenZ" => "700mm" })
assert G.medida_in(v, "LenZ") * 25.4 - 820 < 0.01 && v["LenX"] == "600mm", "alto capturado + zoclo"
assert G.capturado_mm(MAN, fila, "LenZ") == 720, "medida capturada sin zoclo para la ficha"

# Tirador -> gola: la receta no traía los márgenes de gola (estaban apagados).
tir = { "b01_gola_o_tirador" => "1", "k06_margen_sup_tirador" => "13mm", "k11_sep_cajones" => "3mm", "LenX" => "600mm" }
v = G.aplicar_cambios(MAN, tir, { "b01_gola_o_tirador" => "2", "g01_perfil_tipo" => "2" })
assert v["k05_margen_sup_gola"] == "40mm" && v["k12_sep_cajones_gola"] == "40mm", "al pasar a gola se ponen sus márgenes por defecto"
assert v["g02_perfil_posicion"] == "4" && v["g01_perfil_tipo"] == "2", "y lo demás del grupo Gola que falte, sin pisar lo elegido"
assert v["LenX"] == "600mm", "lo que ya traía no cambia"
assert !v.key?("k06_margen_sup_tirador") && !v.key?("k11_sep_cajones"), "los márgenes de tirador se apagan y salen de la fila"
ber = tir.merge("d11_z1_contenido" => "1", "d16_z1_tirador_tipo" => "21", "d17_z1_tirador_posicion" => "6", "d19_z1_tirador_largo" => "300mm")
v = G.aplicar_cambios(MAN, ber, { "b01_gola_o_tirador" => "2", "g01_perfil_tipo" => "2" })
assert !v.key?("d16_z1_tirador_tipo") && !v.key?("d17_z1_tirador_posicion") && !v.key?("d19_z1_tirador_largo"),
       "tirador Berlín pasado a gola: la manija de perfil no se inyecta (acortaba la puerta)"
v = G.aplicar_cambios(MAN, ber, { "LenX" => "700mm" })
assert v["d16_z1_tirador_tipo"] == "21", "sin apagar nada la manija se queda"
v = G.aplicar_cambios(MAN, tir.merge("k05_margen_sup_gola" => "35mm"), { "b01_gola_o_tirador" => "2" })
assert v["k05_margen_sup_gola"] == "35mm", "un margen de gola que la receta sí trae se respeta"
v = G.aplicar_cambios(MAN, tir, { "LenX" => "700mm" })
assert !v.key?("k05_margen_sup_gola"), "sin encender nada no se agrega nada"
gol = { "b01_gola_o_tirador" => "2", "k05_margen_sup_gola" => "40mm", "k12_sep_cajones_gola" => "40mm" }
v = G.aplicar_cambios(MAN, gol, { "b01_gola_o_tirador" => "1" })
assert v["k06_margen_sup_tirador"] == "13mm" && v["k11_sep_cajones"] == "3mm", "gola -> tirador: también se ponen los de tirador"

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

# Con gola solo puerta Lisa, aunque la fila no haya pasado por la UI (CSV).
v = G.aplicar_forzados(MAN, { "b01_gola_o_tirador" => "2", "l01_linea_frente" => "3", "a02_alto_zoclo" => "100mm" })
assert v["l01_linea_frente"] == "1", "con gola el frente se fija en Lisa"
assert v["a02_alto_zoclo"] == "100mm", "las medidas forzadas no se tocan en Ruby"
v = G.aplicar_forzados(MAN, { "b01_gola_o_tirador" => "1", "l01_linea_frente" => "3" })
assert v["l01_linea_frente"] == "3", "sin gola, el frente elegido"

# Gola de melamina del medio: sin la pieza de arriba (Perfil L), para meter los
# dedos; lo fija el manifiesto en cada generación y no viaja en la receta.
vc = G.valores_componente(MAN)
assert vc["g46_melamina_tipo_perfil_c"] == "1", "gola de melamina del medio sin pieza de arriba"
assert !vc.key?("_doc"), "la nota del manifiesto no se inyecta"
assert vc["g13_margen_tapa_perfil_c"].to_s.include?("(g12_alto_perfil_c-k12_sep_cajones_gola+") && vc["g13_margen_tapa_perfil_c"].start_with?("=IF(AND(g01_perfil_tipo=2"),
       "perfil del medio (solo melamina): el espacio para los dedos se reparte igual arriba y abajo"
