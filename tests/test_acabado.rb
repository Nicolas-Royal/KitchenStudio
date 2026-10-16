# Lógica pura de Acabado:  ruby tests/test_acabado.rb  (o load desde SketchUp)
load File.expand_path("../src/royal_kitchens_studio/acabado.rb", __dir__)

def assert(cond, msg)
  raise "FALLA: #{msg}" unless cond
  puts "ok - #{msg}"
end

A = RoyalKitchens::Studio::Acabado

assert %w[diseno revision aprobado].all? { |e| A.modo_para(e) == "diseno" }, "diseño, revisión y aprobado: cantos con el material de su pieza"
assert %w[planeacion fabricacion entregado].all? { |e| A.modo_para(e) == "planeacion" }, "desde planeación: cantos de OpenCutList"
assert A.modo_para(nil) == "diseno", "sin proyecto: diseño"

# Textura base de 3 x 2 pixeles BGR con 2 bytes de relleno por fila: un gris
# claro y uno oscuro alternados (luminancia media 150).
base = [200, 200, 200, 100, 100, 100, 200, 200, 200, 0, 0].pack("C*") * 2
datos, relleno = A.tenir(base, 24, "#c9a26e", 150.0, 3, 2)
assert relleno == 3 && datos.bytesize == 2 * (3 * 3 + 3), "respeta el relleno de entrada y alinea la salida a 4 bytes"
claro = datos.byteslice(0, 3).unpack("C3")
oscuro = datos.byteslice(3, 3).unpack("C3")
assert claro == [(0x6e * 200 / 150.0).round, (0xa2 * 200 / 150.0).round, [(0xc9 * 200 / 150.0).round, 255].min], "pixel claro: color × luminancia / media, en BGR: #{claro}"
assert oscuro == [(0x6e * 100 / 150.0).round, (0xa2 * 100 / 150.0).round, (0xc9 * 100 / 150.0).round], "pixel oscuro conserva la veta: #{oscuro}"
err = (A.tenir(base, 24, "rojo", 150.0, 3, 2) rescue $!.message)
assert err =~ /color inválido/, "color inválido"
