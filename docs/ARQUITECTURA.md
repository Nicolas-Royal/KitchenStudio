# Arquitectura — Royal Kitchens Studio

## Principio

Studio es la **interfaz**; KitchenCatalog y KitchenCreator son los **motores**.
Ninguna regla de negocio se reescribe aquí:

| Necesidad | Se toma de |
|---|---|
| Módulos del catálogo, creaciones, miniaturas | `KitchenCatalog::Catalog`, `Thumbnails`, `Config` |
| Fotos y opciones de frente/manija/material, mapeo a variables | `KitchenCatalog::Configurador.para_ui` (`catalog/referencias/opciones.json`) |
| Insertar (tal cual, o creación con diseño) | `KitchenCatalog::Inserter.place` |
| Material en el modelo (`.skm` → foto → tono aproximado) | `KitchenCatalog::Inserter.asegurar_material` |
| Manifiestos de familia | `RoyalKitchen::CatalogCreator.manifiestos_activos` |
| Formulario: visibilidad, forzados, validación, aplanado, importación | `window.RCC_CORE` = el `app.js` de KitchenCreator evaluado aparte |
| Generar en la escena | `CatalogCreator.instanciar_receta` |
| Guardar en Creaciones | `CatalogCreator.generar` con `publicar: true, purgar: false` |
| Leer CSV/Excel, plantilla | `CatalogCreator.importar_archivo`, `exportar_plantilla` |

`puente.rb` comprueba versiones mínimas (catálogo 0.3.0, creador 1.2.0) y
entrega el código de `RCC_CORE`.

## Archivos

```
src/royal_kitchens_studio.rb          registrar (SketchupExtension)
src/royal_kitchens_studio/
  main.rb       menú, barra, AppObserver (otro modelo = otro proyecto)
  puente.rb     dependencias + RCC_CORE
  proyecto.rb   configuración del proyecto (pura + lectura/escritura en el .skp)
  dialogo.rb    HtmlDialog y callbacks (respuestas: window.RKS.<fn>)
  ui/index.html secciones: proyecto, lista (catálogo/creaciones), módulo, csv, ajustes
  ui/app.js     controlador
  ui/vista.js   RKVista: alzado SVG («Así se verá»); puro, se prueba en node
  ui/visor.js   RKVisor: marco con zoom/desplazamiento sobre el viewBox del SVG
  ui/avanzado.js RKAvanzado: formulario de manifiesto + receta ↔ formulario
  ui/style.css  tokens y teclas de KitchenCatalog + layout de Studio
```

## Datos del proyecto

Atributo del modelo `RK_Proyecto/config` (JSON) y preferencia
`RoyalKitchensStudio/ultimo_proyecto` (solo el diseño global, punto de
partida de un modelo nuevo):

```json
{
  "version": 1,
  "global": { "frente": "1", "manija": "9", "material": "", "tarja": false,
              "medidas": { "igualar": false, "alto": 770, "fondo": 578 } },
  "modulos": { "<id>": { "personalizado": true, "frente": "3", "manija": "11",
                         "material": "MDF_LONDON_BLUE", "tarja": true,
                         "medidas": { "ancho": 600, "alto": 770, "fondo": 578 } } }
}
```

Los `id` de frente y manija son los valores de `l01_linea_frente` y
`d16/d36/e01_*_tirador_tipo`; el de material es el nombre del material en
SketchUp (ids de `materiales_RK.md`).

## Flujos

- **Insertar con diseño (Diseño)** → `insertar {id, eleccion}` →
  `Inserter.place`. Creación: `Configurador.cambios_receta` +
  `instanciar_receta` (receta + cambios). Catálogo: solo medidas totales.
- **Generar (Avanzado / fila CSV)** → `RCC_CORE.flatten` + `nombresDivisores`
  → `generar {familia, nombre, valores, divisores, material, insertar, publicar}`.
  El material se escribe como `c16_material_puerta` + `c22matpuertade =
  "=c16_material_puerta"` en la fila, así viaja en la receta publicada.
- **Receta → formulario** (`RKAvanzado.valoresDesdeFila`): quita unidades y
  la `suma` (zoclo, puerta) y resuelve presets por fórmula/valor. Probado:
  formulario → fila → formulario → fila da la misma fila.
- **Módulo viejo del catálogo → Avanzado**: valores por defecto del
  gabinete actual + su ancho + gola/tarja/cajones/puertas según etiquetas.

## Trabajo largo

Generar tarda ~10–15 s por pieza (30 s si además se publica). `dialogo.rb`
suelta el callback (`UI.start_timer`) para que la interfaz pinte «Trabajando…»
antes; SketchUp puede mostrar su aviso «la operación está tardando».

## Límites conocidos

- Por ahora solo **gabinete** (`FAMILIAS_ACTIVAS` en `ui/app.js`): las listas,
  «+ nuevo» y el CSV filtran el resto.

- Tarja, frente, manija y material se aplican de verdad solo en **gabinete**
  (única familia con mapeo en `opciones.json`). Alacena y esquinero: medidas y
  «Avanzado».
- Módulos de `instancias/` (componente anterior): el diseño es vista previa.
- Materiales sin foto: se ven y se crean con un tono aproximado.
