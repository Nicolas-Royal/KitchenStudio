# CLAUDE.md

Royal Kitchens Studio: el plugin único de Royal Kitchens para diseñar cocinas
en SketchUp. Leer `docs/ARQUITECTURA.md` antes de cambiar algo.

- Studio es independiente: todo vive y se edita en este repo. KitchenCatalog
  y KitchenCreator (`../`) son solo el origen de lo que se migra; no se
  agrega nada nuevo allá ni se depende de ellos para algo nuevo. La tabla
  «Migración» de `docs/ARQUITECTURA.md` dice qué falta traer.
- Al tocar `src/`, regenerar `dist/royal_kitchens_studio.rbz` con
  `powershell -ExecutionPolicy Bypass -File tools\build.ps1` (el `.rbz` no se versiona).
- Pruebas: `node tests/ui.test.js`, `node tests/reglas.test.js`; `tests/test_proyecto.rb` y
  `tests/test_registro.rb`, `tests/test_catalogo.rb` (sin Ruby en el PATH se corren con `load` desde SketchUp).
- La UI corre en el CEF de SketchUp: verificar ahí al final. Fuera de
  SketchUp, `window.sketchup` no existe y el puente solo registra llamadas.
