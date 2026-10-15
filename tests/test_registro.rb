# Registro de proyectos, lógica pura + archivos en una carpeta temporal.
#   ruby tests/test_registro.rb   (o con `load` desde la consola de SketchUp)
require "tmpdir"
$LOAD_PATH.unshift File.expand_path("../src/royal_kitchens_studio", __dir__)
require "registro"

def assert(cond, msg)
  raise "FALLA: #{msg}" unless cond
  puts "ok - #{msg}"
end

R = RoyalKitchens::Studio::Registro
ahora = Time.utc(2026, 10, 9, 18, 0, 0)
ana = { "usuario" => "ana", "nombre" => "Ana", "sede" => "Polanco" }

# ---- Folio --------------------------------------------------------------------
assert R.carpeta_de(' P-12/7: "A" ') == "P-12-7- -A-", "folio saneado para carpeta"
assert R.error_folio("", []) =~ /folio/, "folio vacío"
assert R.error_folio("con", []) =~ /carpeta/, "nombre reservado de Windows"
assert R.error_folio("P-100", ["p-100"]) =~ /Ya existe/, "folio repetido (sin distinguir mayúsculas)"
assert R.error_folio("P-101", ["P-100"]).nil?, "folio nuevo válido"

# ---- Registro nuevo y normalizar ------------------------------------------------
reg = R.nuevo({ "folio" => " P-100 ", "cliente" => "Familia Pérez", "basura" => 1 }, ana, ahora)
assert reg["folio"] == "P-100" && reg["estado"] == "diseno", "nuevo: folio limpio y en diseño"
assert reg["disenadora"]["nombre"] == "Ana" && reg["version_actual"] == 0, "nuevo: diseñadora y sin versiones"
assert !reg.key?("basura"), "nuevo: descarta campos desconocidos"
assert R.normalizar("estado" => "inventado")["estado"] == "diseno", "estado desconocido -> diseño"

# ---- Estados por rol ------------------------------------------------------------
assert R.transicion_permitida?("aprobado", "planeacion", "diseno"), "diseño envía a planeación lo aprobado"
assert !R.transicion_permitida?("diseno", "planeacion", "diseno"), "no se salta revisión ni aprobación"
assert !R.transicion_permitida?("diseno", "aprobado", "diseno"), "no se aprueba sin presentar"
assert !R.transicion_permitida?("aprobado", "diseno", "diseno"), "lo aprobado no regresa a mano (regresa al cambiarlo)"
assert !R.transicion_permitida?("planeacion", "diseno", "diseno"), "diseño no recupera lo que tiene planeación"
assert R.transicion_permitida?("planeacion", "diseno", "planeacion"), "planeación devuelve a diseño"
assert R.transicion_permitida?("planeacion", "fabricacion", "planeacion"), "planeación pasa a fabricación"
assert !R.transicion_permitida?("entregado", "planeacion", "planeacion"), "lo entregado no se reabre"
assert !R.transicion_permitida?("diseno", "fabricacion", "planeacion"), "planeación no toma lo que sigue en diseño"
R::IDS_ESTADO.each do |e|
  n = R::PASOS.count { |p| p["de"] == e && !p["atras"] }
  assert n <= 1, "«#{e}»: a lo más un paso adelante"
end

flujo = R.nuevo({ "folio" => "P-200" }, ana, ahora)
assert R.error_paso(flujo, "revision", "diseno", "") =~ /ninguna versión/, "no se presenta sin versión"
R.registrar_version(flujo, 1, "versiones/v1.skp", ana, ahora, "")
assert R.error_paso(flujo, "revision", "diseno", "").nil?, "con versión se presenta"
R.cambiar_estado(flujo, "revision", ana, ahora, "")
assert R.error_paso(flujo, "diseno", "diseno", " ") =~ /nota/, "regresar pide nota"
R.cambiar_estado(flujo, "aprobado", ana, ahora, "")
assert flujo["version_aprobada"] == 1, "aprobar registra la versión aprobada"
R.registrar_version(flujo, 2, "versiones/v2.skp", ana, ahora, "otra tarja")
assert flujo["estado"] == "revision" && flujo["eventos"].last["auto"], "cambiar lo aprobado lo regresa a revisión"
R.cambiar_estado(flujo, "aprobado", ana, ahora, "")
assert R.error_paso(flujo, "planeacion", "diseno", "").nil?, "aprobado al día se envía"
R.cambiar_estado(flujo, "planeacion", ana, ahora, "")
assert flujo["version_congelada"] == 2, "enviar congela la aprobada"

# ---- Cambio con el proyecto en fabricación --------------------------------------
luz = { "usuario" => "luz", "nombre" => "Luz" }
R.cambiar_estado(flujo, "fabricacion", luz, ahora, "")
assert R.error_cambio(flujo, "x") =~ /No hay cambios/, "sin versión nueva no hay cambio que enviar"
R.registrar_version(flujo, 3, "versiones/v3.skp", ana, ahora, "jaladera")
assert flujo["estado"] == "fabricacion", "guardar en fabricación no mueve el estado"
assert R.error_cambio(flujo, "") =~ /nota/, "el cambio pide nota"
R.enviar_cambio(flujo, ana, ahora, "cliente cambió jaladera")
assert flujo["version_congelada"] == 3 && flujo["cambio_sin_revisar"], "el cambio congela v3 y espera a Planeación"
assert flujo["historial"].select { |h| h["congelada"] }.map { |h| h["v"] } == [2, 3], "la congelada anterior se conserva"
assert R.error_paso(flujo, "entregado", "planeacion", "") =~ /recibiste/, "no se entrega con un cambio sin confirmar"
R.recibir_cambio(flujo, luz, ahora)
assert !flujo["cambio_sin_revisar"] && flujo["eventos"].last["tipo"] == "recibido", "Planeación confirma el cambio"
R.cambiar_estado(flujo, "entregado", luz, ahora, "")
R.registrar_version(flujo, 4, "versiones/v4.skp", ana, ahora, "")
assert R.error_cambio(flujo, "x") =~ /planeación o en fabricación/, "lo entregado ya no recibe cambios"
assert R.normalizar("estado" => "aprobado", "version_actual" => 5)["version_aprobada"] == 5, "registro viejo aprobado: aprobada = vigente"

# ---- Versiones, congelado y poda ------------------------------------------------
12.times do |i|
  v = R.siguiente_version(reg)
  R.registrar_version(reg, v, "versiones/v#{v}.skp", ana, ahora + i, "cambio #{v}")
  R.cambiar_estado(reg, "planeacion", ana, ahora, "") if v == 3
  reg["estado"] = "diseno" if v == 3
end
assert reg["version_actual"] == 12 && reg["version_congelada"] == 3, "12 versiones, congelada la 3"
assert R.cambios_despues_de_congelar?(reg), "hay cambios después de congelar"
borrar = R.podar(reg)
quedan = reg["historial"].map { |h| h["v"] }
assert borrar == ["versiones/v1.skp"], "poda borra solo la más vieja"
assert quedan.include?(3) && quedan.size == 11, "conserva 10 normales + la congelada"

R.registrar_version(reg, 13, "versiones/v13_conflicto.skp", ana, ahora, "", conflicto: true)
assert reg["version_actual"] == 12, "un conflicto no se vuelve la vigente"
assert R.siguiente_version(reg) == 14, "los números no se repiten tras un conflicto"
assert R.conflicto?(10, 12) && !R.conflicto?(12, 12), "detecta que otra persona subió después"
assert R.nombre_version(7, ahora, "a.na!", true) =~ /\Av0007_\d{4}-\d{2}-\d{2}_\d{4}_ana_conflicto\.skp\z/, "nombre de archivo de versión"

# ---- Candado ------------------------------------------------------------------------
c = { "usuario" => "ana", "latido" => R.hora(ahora - 10 * 60) }
assert R.candado_ajeno?(c, "luz", ahora), "candado de otra persona vigente"
assert !R.candado_ajeno?(c, "ana", ahora), "el propio candado no estorba"
assert !R.candado_vigente?(c.merge("latido" => R.hora(ahora - 31 * 60)), ahora), "candado sin latido vence"

# ---- Archivos ----------------------------------------------------------------------
Dir.mktmpdir do |dir|
  p = File.join(dir, "x.json")
  R.escribir_json(p, { "a" => 1 })
  R.escribir_json(p, { "a" => 2 })
  assert R.leer_json(p) == { "a" => 2 } && Dir.children(dir) == ["x.json"], "escritura atómica sin temporales"
  File.write(p, "{roto")
  assert R.leer_json(p).nil?, "JSON roto -> nil"
end
