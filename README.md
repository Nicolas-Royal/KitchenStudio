# Royal Kitchens Studio

Plugin de SketchUp que junta en **una sola ventana** el Catálogo de Módulos
(KitchenCatalog) y Royal Catalog Creator (KitchenCreator). Studio no copia su
lógica: los usa como motores.

| Sección | Qué hace | Motor |
|---|---|---|
| **Proyecto** | Diseño global de la cocina: tipo de frente, manija y material (con foto), tarja por defecto y medidas comunes de gabinetes. Vista previa en vivo. Se guarda en el `.skp`. | — |
| **Catálogo** | Los módulos de siempre. Cada uno abre su página con **Diseño** y **Avanzado**. | KitchenCatalog |
| **Creaciones** | Piezas únicas (generadas desde CSV, formulario o «Avanzado»). Botones «+ Gabinete/Alacena/Esquinero» para crear desde cero. | KitchenCatalog + KitchenCreator |
| **Crear desde CSV** | Importa `.csv`/`.xlsx` (plantilla de Royal Catalog Creator), valida con sus reglas, permite editar cada fila y genera en lote a Creaciones. | KitchenCreator |
| **Ajustes** | Carpetas (catálogo, creaciones, proyecto del creador) y estado de los plugins. | — |

## Página de un módulo

- **Diseño**
  - «Configuración del proyecto»: el módulo sigue el diseño global.
  - «Personalizar este módulo»: medidas con presets, tarja, frente, manija y
    material propios. Solo ese módulo cambia; se guarda en el proyecto.
  - Vista previa «Así se verá» (alzado SVG con estilo de frente, manija y
    material).
  - **Insertar con este diseño** / **Insertar tal cual**.
  - Creaciones: el diseño se aplica de verdad (se regenera desde su receta).
    Módulos del catálogo: se aplican las medidas; el diseño es vista previa
    (para fabricarlo con ese diseño, «Avanzado»).
- **Avanzado**: todas las variables del manifiesto de Royal Catalog Creator
  para la familia del módulo, con sus mismas reglas (visibilidad, valores
  fijados, presupuesto de cajones, errores). **Generar** inserta en la escena
  y/o guarda en Creaciones.

## Requisitos

- SketchUp 2021+.
- Catálogo de Módulos **0.3.0+** y Royal Catalog Creator **1.2.0+** instalados.
  Si falta uno, Studio lo marca en rojo (pie del riel y Ajustes).

## Instalar

1. `powershell -ExecutionPolicy Bypass -File tools\build.ps1` → `dist/royal_kitchens_studio.rbz`.
2. *Extensiones → Administrador de extensiones → Instalar extensión* (también
   los `.rbz` de KitchenCatalog y KitchenCreator).
3. *Extensiones → Royal Kitchens Studio* o su botón.

## Desarrollo

- `node tests/ui.test.js` — vista previa, receta ↔ formulario (necesita el repo hermano `KitchenCreator`).
- `ruby tests/test_proyecto.rb` — configuración del proyecto (lógica pura).
- Arquitectura: `docs/ARQUITECTURA.md`.
