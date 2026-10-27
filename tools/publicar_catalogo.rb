# =============================================================================
#  publicar_catalogo.rb — Publica el catálogo base en Creaciones personalizadas
# -----------------------------------------------------------------------------
#  Antes: node tools/catalogo_base.js  (arma dist/catalogo_base.json desde
#  tools/catalogo_base.json con el motor de «Avanzado»).
#  Uso (consola Ruby de SketchUp, con Studio cargado):
#     load "<repo>/tools/publicar_catalogo.rb"
#     RoyalKitchens::PublicarCatalogo.apartar_pruebas   # una vez: lo que no es del catálogo base
#     RoyalKitchens::PublicarCatalogo.apartar_anterior  # al rehacerlo: todo a _anterior/
#     RoyalKitchens::PublicarCatalogo.todo
#
#  - Cada mueble se guarda solo como receta (<nombre>.json, sin geometría) con
#    clase «catalogo», por Generador.generar: misma validación y misma ficha
#    que al guardar desde Studio. Uno que ya existe no se toca.
#  - apartar_pruebas mueve a <carpeta>/_pruebas todo lo que no está en la
#    lista (Studio solo lee los archivos sueltos de la carpeta): se puede
#    regresar a mano.
# =============================================================================
require "json"
require "fileutils"

module RoyalKitchens
  module PublicarCatalogo
    module_function

    LISTA = File.expand_path("../dist/catalogo_base.json", __dir__)

    def recetas
      raise "Falta #{LISTA}: corre antes «node tools/catalogo_base.js»" unless File.exist?(LISTA)
      JSON.parse(File.read(LISTA, encoding: "UTF-8"))
    end

    def carpeta
      Studio::Generador.creaciones_dir
    end

    def apartar_pruebas
      base = recetas.map { |r| r["nombre"] }
      destino = File.join(carpeta, "_pruebas")
      movidos = Dir.glob(File.join(carpeta, "*.{json,skp,png}")).reject { |f| base.include?(File.basename(f, ".*")) }
      FileUtils.mkdir_p(destino) unless movidos.empty?
      movidos.each { |f| FileUtils.mv(f, File.join(destino, File.basename(f))) }
      "#{movidos.size} archivos a #{destino}"
    end

    # Para rehacer el catálogo: mueve a <carpeta>/_anterior todas las recetas
    # sueltas (con el mismo nombre, `todo` no las tocaría).
    def apartar_anterior
      destino = File.join(carpeta, "_anterior")
      movidos = Dir.glob(File.join(carpeta, "*.{json,skp,png}"))
      FileUtils.mkdir_p(destino) unless movidos.empty?
      movidos.each { |f| FileUtils.mv(f, File.join(destino, File.basename(f)), force: true) }
      "#{movidos.size} archivos a #{destino}"
    end

    def todo
      hechos, ya, errores = [], [], []
      recetas.each do |r|
        if Studio::Biblioteca.existente(carpeta, r["nombre"])
          ya << r["nombre"]
          next
        end
        out = Studio::Generador.generar(r["familia"], r["nombre"], r["valores"], divisores: r["divisores"],
                                        insertar: false, publicar: true, clase: "catalogo")
        out["ok"] ? hechos << r["nombre"] : errores << "#{r['nombre']}: #{out['error']}"
      end
      "Publicados #{hechos.size}, ya estaban #{ya.size}, con error #{errores.size}" +
        (errores.empty? ? "" : "\n" + errores.join("\n"))
    end
  end
end
