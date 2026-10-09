# Lógica pura, sin SketchUp:  ruby tests/test_usuario.rb
load File.expand_path("../src/royal_kitchens_studio/usuario.rb", __dir__)

def assert(cond, msg)
  raise "FALLA: #{msg}" unless cond
  puts "ok - #{msg}"
end

U = RoyalKitchens::Studio::Usuario

assert U.error_login("", "x") =~ /correo/, "login: falta correo"
assert U.error_login("ana", "x") =~ /no parece válido/, "login: correo sin dominio"
assert U.error_login("ana@rk.mx", "") =~ /contraseña/, "login: falta contraseña"
assert U.error_login(" Ana@RK.mx ", "lo-que-sea").nil?, "prototipo: cualquier correo y contraseña"

assert U.nombre_de_correo("ana.lopez@rk.mx") == "Ana Lopez", "nombre a partir del correo"
assert U.nombre_de_correo("nsalinas@rk.mx") == "Nsalinas", "correo de una sola palabra"

u = U.normalizar({ "correo" => "Ana.Lopez@RK.mx", "nombre" => "Ana", "rol" => "planeacion" }, "nicol")
assert u["usuario"] == "ana.lopez" && u["correo"] == "ana.lopez@rk.mx", "el usuario sale del correo"
assert u["rol"] == "planeacion", "rol válido se conserva"
assert U.normalizar({ "rol" => "jefe" }, "nicol").values_at("usuario", "rol") == %w[nicol diseno], "sin correo: usuario de Windows; rol inventado -> diseño"

previo = { "correo" => "ana@rk.mx", "nombre" => "Ana María", "sede" => "Monterrey", "rol" => "diseno" }
s = U.para_sesion(previo, "ANA@rk.mx", "planeacion")
assert s.values_at("nombre", "sede", "rol") == ["Ana María", "Monterrey", "planeacion"], "mismo correo: conserva nombre y sede"
s = U.para_sesion(previo, "luz.perez@rk.mx", "diseno")
assert s.values_at("nombre", "sede") == ["Luz Perez", ""], "otro correo: empieza de nuevo"
assert !U.firma(u).key?("correo") && U.firma(u)["nombre"] == "Ana", "la firma del registro no cambia de forma"

# Preferencias: SketchUp 2022 pierde el texto con comillas en write_default.
load File.expand_path("../src/royal_kitchens_studio/preferencias.rb", __dir__)
PR = RoyalKitchens::Studio::Preferencias
texto = %q({"nombre":"Ana María","carpeta":"C:\Users\ana\Proyectos"})
cod = PR.codificar(texto)
assert cod.start_with?("b64:") && !cod.include?('"') && !cod.include?("\\"), "se guarda sin comillas ni barras"
assert PR.decodificar(cod) == texto && PR.decodificar(cod).encoding == Encoding::UTF_8, "vuelve igual, con acentos"
assert PR.decodificar("C:/viejo/sin/prefijo") == "C:/viejo/sin/prefijo", "valor viejo sin prefijo se lee tal cual"
