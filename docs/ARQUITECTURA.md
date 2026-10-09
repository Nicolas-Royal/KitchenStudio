# Arquitectura — Royal Kitchens Studio

## Principio

Studio es el **único plugin**: proyectos, catálogo de opciones, reglas de
fabricación, manifiestos, motor de generación, componente base y catálogo
de muebles viven y se editan aquí. No necesita KitchenCatalog ni
KitchenCreator (fueron los motores de 0.1–0.3).

## Migración (terminada en 0.5.0)

| Necesidad | En Studio | Paso |
|---|---|---|
| Opciones de frente/manija/material, fotos, reglas | `catalogo.rb` + `catalogo/` | 0.3.1 |
| Manifiestos de familia | `familias.rb` + `familias/*.json` | 2a |
| Formulario: visibilidad, validación, aplanado, importación | `ui/receta.js` (`window.RCC_CORE`) | 2a |
| Generar en la escena / guardar en el catálogo | `generador.rb` + `motor/` | 2b |
| Componente base | `componentes/GABINETE.skp` (alacena y esquinero: al activar esas familias) | 2b |
| CSV/Excel y plantilla | `Generador.importar_archivo`, `exportar_plantilla` | 2b |
| Catálogo de muebles, insertar, material en el modelo | `biblioteca.rb`, `Catalogo.asegurar_material` | 2c |

El catálogo viejo de KitchenCatalog (27 .skp del componente anterior) se
dejó de usar por decisión: el catálogo de Studio son las recetas que se
guardan desde «Avanzado» o un CSV (carpeta de Ajustes, por defecto
`Documentos/Royal Kitchens/Creaciones personalizadas`).

## Archivos

```
src/royal_kitchens_studio.rb          registrar (SketchupExtension)
src/royal_kitchens_studio/
  main.rb       menú, barra, AppObserver (otro modelo = otro proyecto), temporizador de sincronía
  usuario.rb    usuario de esta PC (nombre, sede, rol)
  registro.rb   registro de proyectos en el almacén
  sincronia.rb  copia de trabajo local <-> almacén
  biblioteca.rb catálogo de muebles: recetas guardadas (.json + .skp), «Usar» tal cual
  catalogo.rb   opciones (frente, manija, material) + reglas de fabricación
  familias.rb   manifiestos de familia (familias/*.json)
  generador.rb  generar desde una receta: validación de respaldo, una sola pasada
                para insertar y/o guardar en Creaciones, limpieza de definiciones
  motor/        inyección de atributos (engine), Mitered, CSV/xlsx y plantilla
  componentes/  componentes base de cada familia (.skp)
  proyecto.rb   configuración del proyecto (pura + lectura/escritura en el .skp)
  dialogo.rb    HtmlDialog y callbacks (respuestas: window.RKS.<fn>)
  ui/index.html secciones: proyectos, proyecto, catálogo, módulo, csv, ajustes
  ui/proyectos.js RKProyectos: filtrar/ordenar la lista, fechas, candado, sincronía; puro
  ui/app.js     controlador
  ui/vista.js   RKVista: alzado SVG («Así se verá»); puro, se prueba en node
  ui/visor.js   RKVisor: marco con zoom/desplazamiento sobre el viewBox del SVG
  ui/receta.js  RCC_CORE: reglas de las recetas (validar, aplanar, nombre, importar); puro
  ui/reglas.js  RKReglas: manija por uso, Berlín/Lisa, MDF; puro
  ui/avanzado.js RKAvanzado: formulario de manifiesto + receta ↔ formulario
  ui/style.css  tokens, teclas y layout
```

## Datos del proyecto

Atributo del modelo `RK_Proyecto/config` (JSON) y preferencia
`RoyalKitchensStudio/ultimo_proyecto` (solo el diseño global, punto de
partida de un modelo nuevo):

```json
{
  "version": 1,
  "global": { "frente": "1", "manija_puerta": "9", "manija_cajon": "15", "material": "", "tarja": false,
              "medidas": { "igualar": false, "alto": 770, "fondo": 578 } },
  "modulos": { "<id>": { "personalizado": true, "frente": "3", "manija_puerta": "11", "manija_cajon": "11",
                         "material": "MDF_LONDON_BLUE", "tarja": true,
                         "medidas": { "ancho": 600, "alto": 770, "fondo": 578 } } }
}
```

Los `id` de frente y manija son los valores de `l01_linea_frente` y
`d16/d36_*_tirador_tipo` (puertas) y `e01_tirador_tipo` (cajones); el de material es el nombre del material en
SketchUp (ids de `materiales_RK.md`). Un diseño viejo con una sola `"manija"`
se migra a las dos al leerlo (`Proyecto.manijas`).

Reglas de manija (`opciones.json` → `tiradores[]`, aplicadas en `Catalogo` y
`ui/reglas.js`; Studio calcula los cambios de la receta al insertar):

- `usos`: dónde se puede usar. Concha dorada solo en cajones.
- `solo_frentes`: Berlín solo con frente Lisa.
- `posicion.<uso>`: posición forzada. Lateral negra en puertas = 5
  (Centro-Centro: en los cantos del medio, escalonadas para no chocar;
  otras posiciones la mandan al canto de arriba).

## Registro de proyectos (0.3.0)

Fuera de los motores: solo Studio. Tres módulos, la lógica pura separada de los archivos.

| Archivo | Qué hace |
|---|---|
| `usuario.rb` | Quién usa la PC: usuario de Windows + nombre, sede y rol (`diseno`/`planeacion`), en `Sketchup.read_default`. |
| `registro.rb` | Almacén de proyectos: folio, estados y transiciones por rol, versiones, poda (10 + congeladas + conflictos), candado, lista. |
| `sincronia.rb` | Copia de trabajo local ↔ almacén: crear, abrir (edición o consulta), subir al guardar, reintento sin conexión, conflictos, candado. |

**Almacén** = carpeta configurable en Ajustes (por defecto `Documentos\Royal Kitchens\Proyectos`;
para varias sedes, la del servidor u OneDrive). Una carpeta por folio:

```
<almacén>/<FOLIO>/proyecto.json   registro (datos, estado, historial, eventos, diseno_global)
                  modelo.skp      versión vigente
                  miniatura.png
                  versiones/v0007_2026-10-09_1530_<usuario>[_conflicto].skp
                  abierto_por.json   candado {usuario, nombre, sede, desde, latido}
```

Un `proyecto.json` por proyecto (escritura atómica tmp + rename); no hay un índice
compartido. La lista se cachea en `%LOCALAPPDATA%\RoyalKitchensStudio\indice.json`.

**Nunca se edita el `.skp` del almacén.** Se descarga a
`%LOCALAPPDATA%\RoyalKitchensStudio\trabajo\<FOLIO>\modelo.skp` (+ `estado.json`:
`version_base`, `pendiente`, `notas`, `conflicto`, `subido_mtime`). Cada guardado de esa copia
(`ModelObserver#onPostSaveModel`, diferido con `UI.start_timer`) sube `versiones/vNNNN` y
reemplaza `modelo.skp`. Sin almacén queda `pendiente`, y un temporizador lo reintenta cada
60 s (también renueva el latido del candado cada 5 min; sin latido 30 min, el candado vence).
Si al subir otra persona ya subió una versión posterior a `version_base`, la copia se guarda
como `_conflicto` y **no** reemplaza la vigente. La interfaz ofrece «usar la mía» o
«quedarme con la del proyecto».

El modelo se liga con el atributo `RK_Proyecto/folio`. Las copias de consulta
(`…\consulta\<FOLIO>_vNNNN.skp`, para Planeación o para versiones viejas) nunca se suben.

**Estados**: diseño → revisión con cliente → aprobado → enviado a planeación → en
fabricación → entregado. Diseño mueve el proyecto hasta «enviado a planeación», lo que
**congela** la versión vigente (no se poda). Desde ahí solo Planeación cambia el estado y
puede devolverlo a diseño con una nota. Las reglas viven en `Registro.transicion_permitida?`
y llegan a la UI en `estado.transiciones`.

## Flujos

- **Insertar (catálogo)** → `insertar {id, eleccion}`. Sin elección («Usar»):
  `Biblioteca.insertar_tal_cual` (el .skp guardado, ~1 s). Con elección:
  `Catalogo.cambios_receta` (reglas incluidas) + `Generador.instanciar_receta`
  (receta + cambios, ~15 s).
- **Generar (Avanzado / fila CSV)** → `RCC_CORE.flatten` + `nombresDivisores`
  → `generar {familia, nombre, valores, divisores, material, insertar, publicar}`
  → `Generador.generar`.
  El material se escribe como `c16_material_puerta` + `c22matpuertade =
  "=c16_material_puerta"` en la fila, así viaja en la receta publicada.
- **Receta → formulario** (`RKAvanzado.valoresDesdeFila`): quita unidades y
  la `suma` (zoclo, puerta) y resuelve presets por fórmula/valor. Probado:
  formulario → fila → formulario → fila da la misma fila.
- **Módulo viejo del catálogo → Avanzado**: valores por defecto del
  gabinete actual + su ancho + gola/tarja/cajones/puertas según etiquetas.

## Trabajo largo

Generar tarda ~15 s por pieza (insertar y guardar en Creaciones van en la
misma pasada). `dialogo.rb`
suelta el callback (`UI.start_timer`) para que la interfaz pinte «Trabajando…»
antes; SketchUp puede mostrar su aviso «la operación está tardando».

## Límites conocidos

- Por ahora solo **gabinete** (`FAMILIAS_ACTIVAS` en `ui/app.js`): las listas,
  «+ nuevo» y el CSV filtran el resto.

- Tarja, frente, manija y material se aplican de verdad solo en **gabinete**
  (única familia con mapeo en `opciones.json`). Alacena y esquinero: medidas y
  «Avanzado».
- Materiales sin foto: se ven y se crean con un tono aproximado.
