# CLAUDE.md

Royal Kitchens Studio: el plugin único de Royal Kitchens para diseñar cocinas
en SketchUp. Leer `docs/ARQUITECTURA.md` antes de cambiar algo.

- Studio es independiente (desde 0.5.0 no usa otros plugins): todo vive y se
  edita en este repo. KitchenCatalog y KitchenCreator (`../`) quedan solo como
  historia; no se agrega nada allá ni se vuelve a depender de ellos.
- Al tocar `src/`, regenerar `dist/royal_kitchens_studio.rbz` con
  `powershell -ExecutionPolicy Bypass -File tools\build.ps1` y subirlo junto con el cambio
  (`dist/` se versiona para bajar el plugin desde GitHub).
- Pruebas: `node tests/ui.test.js`, `node tests/reglas.test.js`; `tests/test_proyecto.rb` y
  `tests/test_registro.rb`, `tests/test_catalogo.rb`, `tests/test_biblioteca.rb`, `tests/test_usuario.rb`, `tests/test_generador.rb` (este último solo en SketchUp), `tests/test_acabado.rb` (sin Ruby en el PATH se corren con `load` desde SketchUp).
- La UI corre en el CEF de SketchUp: verificar ahí al final. Fuera de
  SketchUp, `window.sketchup` no existe y el puente solo registra llamadas.
