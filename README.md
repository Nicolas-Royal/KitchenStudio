# Royal Kitchens Studio

Plugin de SketchUp de Royal Kitchens para diseñar cocinas. Todo en **una
sola ventana** y sin depender de otros plugins: proyectos compartidos,
diseño global, catálogo de muebles por receta y generación desde el
componente base.

| Sección | Qué hace |
|---|---|
| **Proyectos** | Registro compartido: crear con folio, quién actualizó y cuándo, estados (diseño → planeación → fabricación), versiones, trabajo sin conexión. |
| **Diseño global** | Frente, manija de puertas, manija de cajones y material (con foto), tarja y medidas comunes. Vista previa en vivo. Se guarda en el `.skp`. |
| **Catálogo** | Los muebles guardados (recetas). «Usar» los inserta tal cual; su página permite cambiar medidas y diseño. «+ Gabinete» crea uno desde cero. |
| **Crear desde CSV** | Importa `.csv`/`.xlsx` (plantilla de Studio), valida, permite editar cada fila y genera en lote al catálogo. |
| **Ajustes** | Usuario de la PC y carpetas (proyectos, catálogo de muebles). |

> Por ahora Studio trabaja **solo con gabinetes** (`FAMILIAS_ACTIVAS` en
> `ui/app.js`); alacena y esquinero se habilitarán después.

## Reglas de fabricación

- MDF laminado solo en puerta Lisa.
- Concha dorada solo en cajones.
- Berlín solo con frente Lisa.
- Lateral negra en puertas siempre en Centro-Centro (cantos del medio).

Viven en `src/royal_kitchens_studio/catalogo/opciones.json` y se aplican en
los selectores, al insertar y en «Avanzado».

## Página de un mueble

Vista previa al centro (rueda = zoom, arrastrar = moverse, doble clic =
ajustar) y el diseño en una barra a la derecha.

- **Diseño**: sigue el diseño global o se personaliza (medidas, tarja, frente,
  manijas, material). **Insertar con este diseño** regenera desde la receta
  (~15 s); **Insertar tal cual** usa el `.skp` guardado (~1 s).
- **Avanzado…**: todas las variables del manifiesto de la familia, con sus
  reglas (visibilidad, valores fijados, presupuesto de cajones, errores).
  **Generar** inserta en la escena y/o guarda en el catálogo.

## Requisitos

- SketchUp 2021+ (probado en 2022).

## Instalar

1. `powershell -ExecutionPolicy Bypass -File tools\build.ps1` → `dist/royal_kitchens_studio.rbz`.
2. *Extensiones → Administrador de extensiones → Instalar extensión*.
3. *Extensiones → Royal Kitchens Studio* o su botón.

## Desarrollo

- `node tests/ui.test.js` y `node tests/reglas.test.js` — interfaz y reglas de recetas.
- `tests/test_*.rb` — Ruby (con `load` desde la consola de SketchUp si no hay
  Ruby en el PATH; `test_generador.rb` solo ahí).
- Arquitectura: `docs/ARQUITECTURA.md`.
