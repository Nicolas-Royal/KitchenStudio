# CLAUDE.md

Royal Kitchens Studio: interfaz única sobre KitchenCatalog y KitchenCreator
(repos hermanos en `../`). Leer `../ECOSISTEMA.md` y `docs/ARQUITECTURA.md`
antes de cambiar algo.

- No reescribir reglas de los motores: si falta algo, exponerlo en
  KitchenCatalog o en `RCC_CORE` de KitchenCreator y consumirlo aquí.
- Al tocar `src/`, regenerar `dist/royal_kitchens_studio.rbz` con
  `powershell -ExecutionPolicy Bypass -File tools\build.ps1` (el `.rbz` no se versiona).
- Pruebas: `node tests/ui.test.js`; `tests/test_proyecto.rb` y
  `tests/test_registro.rb`, `tests/test_catalogo.rb` (sin Ruby en el PATH se corren con `load` desde SketchUp).
- La UI corre en el CEF de SketchUp: verificar ahí al final. Fuera de
  SketchUp, `window.sketchup` no existe y el puente solo registra llamadas.
