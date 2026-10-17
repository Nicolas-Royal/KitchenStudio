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

## Pantallas (0.6.0)

Una cosa a la vez:

1. **Login** (`#login`): correo, contraseña y rol. Prototipo: acepta todo.
   Al salir el botón «Entrar» vuelve a estar activo (`mostrarLogin`).
2. **Inicio** (barra superior sin pestañas): **Proyectos** (lista, filtros
   —«Todos» primero y por defecto, luego «Mis proyectos»—, nuevo, ficha) y
   **Ajustes** (perfil y carpetas). Si hay un proyecto abierto en SketchUp,
   arriba de la lista sale «Entrar al proyecto →».
3. **Dentro de un proyecto** (barra con «← Proyectos», folio, cliente, estado,
   sincronía y «Guardar versión…»): pestañas **Diseño** (global), **Muebles**
   (catálogo y página de cada mueble) y **Desde CSV**. Sin proyecto abierto no
   se entra (`irA` manda a la lista); al abrir o crear uno se entra solo.
4. **Solo la escena** (`#pj-libre`, `S.libre`): las mismas pestañas sobre el
   modelo abierto, sin proyecto ni registro. El diseño se guarda en el modelo
   como siempre; «Guardar como proyecto…» (Diseño) abre «Nuevo proyecto» con el
   modelo abierto. «← Proyectos» sale del modo.

## Catálogo de muebles: origen y diseño

Dos cosas separadas. La regla: **«Usar» inserta lo que muestra la tarjeta.**

**Origen** (`ficha["clase"]`, `Biblioteca::CLASES`; lo pone Studio al guardar
y solo sirve de etiqueta y filtro):

| Clase | Cómo nace | Etiqueta |
|---|---|---|
| `catalogo` | Lo agrega el equipo de desarrollo (fichas sin clase en Creaciones) | «Catálogo» |
| `usuario` | Se genera desde Studio: «Avanzado» (nuevo o alterando otro) o un CSV | «Creado por <nombre>» (`ficha["creado_por"]`) |

Desde CSV (10/2026) cada fila se **inserta siempre en la escena**; «Guardar
también en el catálogo» la guarda además como receta, con clase `usuario`.

**Diseño** en un proyecto (`proyecto.modulos[id]`, `RKMuebles.modo`). Todos
parten de «Este proyecto»:

| Modo | Guardado | Quién | Al insertar |
|---|---|---|---|
| Este proyecto | nada | todos | se regenera con el diseño del proyecto |
| Original | `{ "original": true }` | solo `usuario` | se genera la receta tal cual |
| Ajustar este mueble | `{ "personalizado": true, … }` | todos | se regenera con el ajuste |

- En la lista todo se ve con el diseño del proyecto. Solo en el filtro
  «Creados por usuario» aparece «Ver con: Original / Este proyecto» (entra en
  Original): vale para las tarjetas de ese filtro y su «Usar», salvo los
  muebles con elección propia. El catálogo nunca va con el original.
- **El catálogo son solo recetas** (0.6.3): `<nombre>.json` en la carpeta de
  Creaciones, sin `.skp`. Todo se genera desde el componente base al insertar
  (le llegan los arreglos del base y el diseño del proyecto); guardar desde CSV
  no genera geometría. Un `.skp` viejo en la carpeta se ignora.
- El diseño del proyecto pone gola (si se elige), frente, manijas (no con gola), material y, con
  «Igualar», el alto y el fondo; ancho, tarja, zonas, puertas, cajones y
  entrepaños son del mueble y no cambian
  (`RKMuebles.alcance`).
- «Ajustar este mueble» incluye sus entrepaños y divisores (el mismo gráfico
  de «Avanzado», compacto): se guardan en `modulos[id].interior` como valores
  de fila `{ attr: valor }` del grupo con `visual`, y al insertar viajan en
  `eleccion.interior` → `Generador.cambios_interior` (solo deja pasar los
  campos de ese grupo). «Avanzado» parte también de ese interior.
- **Un mueble nunca pisa a otro.** El id sale del nombre del archivo
  (`Biblioteca.slug` = `RKMuebles.idDe`), así que «GAB 600» y «GAB-600» son
  el mismo. Guardar con un nombre ocupado se rechaza: en «Avanzado» y en las
  filas del CSV (`RKMuebles.choque`, `csvChoque`) y, como última barrera, en
  `Generador.generar` (`Biblioteca.existente`). Dos archivos que ya den el
  mismo id reciben sufijo (`Biblioteca.unicos`) para que ninguno tape al otro.
  Al borrar un mueble se quitan sus ajustes del proyecto abierto.
- **Aplicar el diseño a lo ya insertado** (pestaña Diseño). Cada mueble
  insertado lleva en la instancia `RK_Studio_Mueble` = `{ modulo: id, modo }`
  (`Biblioteca.marcar`), con el modo con que entró. El botón pide a Ruby los
  que entraron con «Este proyecto» (`Biblioteca.en_escena`: raíz y dentro de
  grupos; los insertados antes de la marca se reconocen por el sku si el
  mueble no tiene elección propia, `Biblioteca.sigue_proyecto`), la UI arma
  la elección de cada uno con el diseño de hoy (`eleccionDe(m, disenoGlobal(m))`,
  la misma que al insertar) y, tras confirmar, `Dialogo.aplicar_diseno` los
  regenera en su lugar (posición, etiqueta y grupo) y borra los viejos.
  Ajustados y originales no cambian.
- **Reutilizar lo ya generado** (`Generador.generada`). Generar un gabinete
  tarda ~45 s (medido: copiar el árbol del base ~14 s, limpiar definiciones
  ~15 s, redibujado del DC ~8 s, cargar el base ~5 s). Cada definición
  generada lleva `RK_Studio_Generado` = `{ clave, huella }`: la clave es la
  receta completa + divisores + archivo base (nombre y fecha) + versión; la
  huella, piezas y medidas al generarse (sin grupos vacíos). Misma clave y
  misma huella → se coloca otra instancia de esa definición (~0.1 s). Si
  alguien lo editó por dentro la huella cambia y se genera de nuevo. En
  «Aplicar el diseño» el primero de cada mueble se genera, los iguales
  reutilizan y el que ya tenía el diseño se queda.
- Probado y descartado (10/2026): dejar el base cargado entre generaciones
  (obliga a copiar todo el árbol para no ensuciarlo: 26 s de copia y 21 s de
  redibujado, peor que cargarlo), copiar solo el camino a las piezas que se
  tocan (el DC deja 4 «Tap.Tirador» de más) y limpiar con `purge_unused`
  protegido (~2.5 s menos sobre ~3700 definiciones, no compensa).
- Nombre de un mueble nuevo (`RKMuebles.nombreNuevo`): `GAB-600-2P-3C-014` =
  familia, ancho, frentes de arriba abajo y un consecutivo (el siguiente al
  mayor del catálogo), para que no se repita. Las filas de CSV conservan su
  nombre; un nombre escrito a mano se respeta.
- Tarjeta: nombre, frentes (`RKMuebles.resumenFrentes`), medidas, rasgos y, al
  pie, de dónde sale el diseño y los botones, siempre a la misma altura.
- Barra lateral de características (`RKMuebles.facetas`): tipo, configuración,
  frente original (de `ficha["caracteristicas"]`) y ancho. Dentro de un grupo
  suma, entre grupos se cumplen todos. Los entrepaños no se filtran: se
  ajustan después, dentro del mueble.
- Filtros de la lista: origen (Todos / Catálogo / Creados por usuario) y tipo
  (categorías fijas de `Biblioteca::CATEGORIAS`, aunque estén vacías).

## Estilo: qué se escribe y qué se lee (0.6.2)

- **Hundido** (`--shadow-recessed`) = se escribe o se opera: campos, buscadores,
  interruptores. También las ventanas de imagen (vista previa, fotos).
- **Apenas levantado** (`--shadow-raised`) = solo se lee: datos y medidas,
  tablas, barra del proyecto abierto, listas, rutas de Ajustes, grupos de
  «Avanzado» y cualquier campo deshabilitado.
- Un campo que no se puede editar no se muestra como caja deshabilitada sino
  como dato con candado (`.dato-val.bloq`, `formCampos` sin `editable`).

Se eligió entre seis opciones (artifact «Campos y datos en Studio», opción F).

## Archivos

```
src/royal_kitchens_studio.rb          registrar (SketchupExtension)
src/royal_kitchens_studio/
  main.rb       menú, barra, AppObserver (otro modelo = otro proyecto), temporizador de sincronía
  usuario.rb    sesión (login de prototipo) y perfil: correo, nombre, sede, rol
  preferencias.rb preferencias de la PC (texto en base64: write_default de SU 2022
                pierde las comillas)
  registro.rb   registro de proyectos en el almacén
  sincronia.rb  copia de trabajo local <-> almacén
  biblioteca.rb catálogo de muebles: recetas guardadas (.json), «Usar» las genera desde el base
  catalogo.rb   opciones (frente, manija, material) + reglas de fabricación
  acabado.rb    cantos según la fase (diseño: del material de su pieza; desde
                planeación: los de OpenCutList) y veta generada para la madera
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
  ui/muebles.js RKMuebles: origen del mueble, de dónde sale su diseño, filtros de la lista; puro
  ui/avanzado.js RKAvanzado: formulario de manifiesto + receta ↔ formulario
  ui/entrepanos.js RKEntrepanos: gráfico interactivo de entrepaños y divisores dentro de
                su grupo en «Avanzado» (alzado + corte lateral; arrastrar y clic). Sin estado
                propio: escribe los campos del formulario; la geometría sale de receta.js
  ui/style.css  tokens, teclas y layout
```

## Datos del proyecto

Atributo del modelo `RK_Proyecto/config` (JSON) y preferencia
`RoyalKitchensStudio/ultimo_proyecto` (solo el diseño global, punto de
partida de un modelo nuevo):

```json
{
  "version": 1,
  "global": { "frente": "1", "manija_puerta": "9", "manija_cajon": "15", "material": "SIN_MATERIAL",
              "medidas": { "igualar": false, "alto": 770, "fondo": 600 } },
  "modulos": { "<id>": { "personalizado": true, "frente": "3", "manija_puerta": "11", "manija_cajon": "11",
                         "material": "MDF_LONDON_BLUE", "tarja": true,
                         "medidas": { "ancho": 600, "alto": 770, "fondo": 578 },
                         "interior": { "h01_entrepano": "0", "h02_cantidad": "2" } },
               "<id creado por usuario>": { "original": true } }
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

Posición, orientación y largo de la manija no se eligen (10/2026): los campos
`d17/d18/d19` (zona 1), `d37/d38/d39` (zona 2) y `e02/e03/e04` (cajones) son
`oculto` en el manifiesto (no salen en «Avanzado» ni en la plantilla CSV, sí se
inyectan) y los fija su `forzar`, en JS (`aplicarForzados`) y en Ruby
(`Generador.aplicar_forzados`, que los pone aunque la fila no los traiga):

| Dónde | Posición | Orientación |
|---|---|---|
| Puertas | 3 Arriba-Derecha = arriba del lado que abre | vertical |
| Lateral negra en puertas | 5 Centro-Centro | vertical |
| Berlín (puerta o cajón) | 2 Arriba-Centro | horizontal |
| Cajones | 5 Centro-Centro | horizontal |

- Probado en el componente: «Puerta simple - IZQ» = bisagra a la izquierda;
  el componente **refleja** la posición en la hoja con bisagra a la derecha
  (simple DER con «Arriba-Izquierda» la puso junto a la bisagra) y en la
  puerta doble cada hoja la lleva al centro. Por eso es 3 en todos los casos.
- Berlín: el componente lo pone en el canto de arriba a todo el ancho (38 mm)
  y acorta la hoja; la posición no cambia eso.
- El largo queda en el default (300/120/140 mm): las manijas se compran de una
  medida y el modelo de cada una ya la trae (Andrea mide 170 aunque diga 300).
- Solo 1 o 2 puertas por zona (`d15/d35`: simple IZQ, simple DER, doble).
- Todas las entradas de `forzar` llevan `b01 = tirador` y «tipo ≠ Sin
  tirador»: con gola o sin manija no se inyecta nada.

Acabado (`acabado.rb`, 10/2026):

- **Cantos.** El componente base pinta cara por cara los cantos con
  materiales de cubrecanto de OpenCutList (`ladb_opencutlist.type = 4`:
  «SinCanto» amarillo, «CANTO EXTERIOR» rojo). Mientras el proyecto está en
  diseño, revisión o aprobado esas caras van **sin material** (toman el de su
  pieza, que va en la instancia) y el canto se guarda en la cara
  (`RK_Canto.material` / `atras`). Desde «Enviado a planeación»
  (`Acabado::CON_CANTOS`) se devuelven. Se aplica al generar o colocar un
  mueble (solo sus definiciones), al abrir/activar un modelo y al cambiar de
  estado. Sin proyecto = diseño; sin conexión con el almacén no se toca.
- **Veta.** Los materiales de madera del catálogo no traen foto: al crearlos
  (`Catalogo.asegurar_material`) se les pone la textura de TEKA ARTICO-VESTO1
  (`catalogo/texturas/veta_teka_artico.png`, veta recta; `opciones.json →
  textura_veta`: 1800 × 400 mm, luminancia media 215.2) **teñida** con su
  color: pixel = color × luminancia / media (`Acabado.tenir`, BGR para
  `ImageRep`, respeta el relleno de fila). El promedio queda en su color. La
  vista previa tiñe la misma imagen con la misma fórmula (`feColorMatrix` en
  `RKVista`); la veta de la imagen es horizontal: cajones así, puertas con el
  patrón girado (en SketchUp el componente ya gira las piezas). `VETA_VERSION`
  regenera las que Studio ya hizo; una textura puesta a mano no se toca.

Gola elegida en el diseño (`golas[]`: sin gola, melamina, aluminio claro,
aluminio oscuro; `proyecto.global.gola` / `modulos[id].gola`, "" = la del
mueble) con su combinación L-C / L-L (`gola_combinacion` → `g03_combinacion`)
en el mismo selector. `RKReglas.cambiosGola` / `Catalogo.cambios_gola` la
ponen en la receta antes de frente y manijas; con gola van máximo 2 cajones por
zona (`erroresConGola` avisa antes de insertar). En la vista la gola lleva su
tono (`golas[].color`, `colores_gola_aluminio` por c23) con degradado más
oscuro hacia adentro (`RKVista`).

Gola (`familias.gabinete.gola` = cuándo lleva gola; `frentes[].con_gola`):
no lleva manija y **solo puerta Lisa**. El diseño del proyecto no le pone otro
frente (`disenoDe` y `Catalogo.cambios_receta` lo vuelven Lisa) y en la página
del mueble el frente queda fijo («Con gola: Lisa»). En «Avanzado» lo fija el
manifiesto (`forzar` de `l01_linea_frente`), y `Generador.aplicar_forzados`
hace lo mismo con las filas que no pasaron por la UI (CSV, recetas viejas).

Valores forzados (`forzar` del manifiesto, `RCC_CORE.aplicarForzados`): al
dejar de aplicar, el campo regresa a lo que tenía; si tenía el valor forzado
(una creación guardada así), al default. Así «Zoclo: Sí» vuelve a poner su
alto aunque el mueble se haya creado sin zoclo.

## Registro de proyectos (0.3.0)

Fuera de los motores: solo Studio. Tres módulos, la lógica pura separada de los archivos.

| Archivo | Qué hace |
|---|---|
| `usuario.rb` | Sesión y perfil: correo (de ahí sale `usuario`, la clave de «mis proyectos» y candados), nombre, sede y rol (`diseno`/`planeacion`). Prototipo: el login acepta cualquier correo y contraseña; la contraseña no se guarda. Plan: Microsoft 365. |
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
fabricación → entregado. Flujo lineal: cada estado tiene **un** paso adelante y, donde
tiene sentido, uno atrás que pide nota (`Registro::PASOS`, que llega a la UI en
`estado.pasos`; `Registro.error_paso` valida rol, nota y condiciones). En la ficha se ven
como línea de pasos + botón principal, y cada paso se confirma en una pregunta.

| Paso | Rol | Condición |
|---|---|---|
| Presentar al cliente (diseño → revisión) | Diseño | al menos una versión |
| Cliente aprobó (revisión → aprobado) | Diseño | guarda `version_aprobada` |
| Cliente pidió cambios (revisión → diseño) | Diseño | nota obligatoria |
| Enviar a planeación (aprobado → planeación) | Diseño | vigente = aprobada, nada sin subir; **congela** (no se poda) |
| Iniciar fabricación / Marcar entregado | Planeación | sin cambio por confirmar |
| Devolver a diseño (planeación → diseño) | Planeación | nota obligatoria |

Guardar una versión nueva con el proyecto «aprobado» lo regresa solo a revisión (evento
`auto`): a planeación solo llega lo que vio el cliente.

**Cambios en planeación/fabricación**: el estado no regresa. Guardar crea versiones
normales («cambio sin enviar»); «Enviar cambio a planeación» (nota obligatoria, cualquier
rol) congela la vigente sin soltar la congelada anterior (`Registro.enviar_cambio`). Si lo
envía Diseño queda `cambio_sin_revisar` hasta que Planeación da «Recibí el cambio»; mientras
tanto Planeación no puede avanzar el estado. Entregado no acepta cambios.

## Flujos

- **Insertar (catálogo)** → `insertar {id, eleccion}`. Sin elección (mueble
  de usuario con su diseño original):
  `Biblioteca.insertar_tal_cual` (la receta tal cual, ~15 s). Con elección:
  `Catalogo.cambios_receta` (reglas incluidas) + `Generador.instanciar_receta`
  (receta + cambios, ~15 s).
- **Generar (Avanzado / fila CSV)** → `RCC_CORE.flatten` + `nombresDivisores`
  → `generar {familia, nombre, valores, divisores, material, insertar, publicar}`
  → `Generador.generar`. Desde «Avanzado» siempre se inserta en la escena;
  «Guardar en el catálogo» es lo único opcional (el CSV solo guarda).
  `manifest.formulas_piezas` reescribe fórmulas de piezas internas antes del
  redibujado (`Engine.formulas_piezas`, independizando el camino): la holgura
  lateral h33/h34 solo va en los entrepaños; los divisores (retiro 0) quedan
  pegados a las laterales. `manifest.piezas_unicas` deja un contenedor como UNA
  pieza para OpenCutList sin fusionar la geometría (`Engine.piezas_unicas`: las
  piezas internas con «cortar abertura», como los frentes con marco): la
  lateral con gola (cuerpo + dos tiras al frente) sale como «Lateral» con la
  medida total; las dos iguales, en un renglón.
  `manifest.valores_componente` se inyecta además en cada generación (variables
  del componente base que no son elecciones; no van en la receta):
  `g46_melamina_tipo_perfil_c = 1` deja la gola de melamina del medio sin la
  pieza de arriba en L-C (espacio para los dedos, mismo alto de gola), y
  `g13_margen_tapa_perfil_c = (g12 − k12 + espesor) / 2` (solo melamina) reparte
  el espacio para los dedos por igual abajo del canto del frente de abajo y
  arriba del canto del frente de arriba (16 y 16 mm con perfil 90, hueco 40,
  espesor 18; centrado daba 7 y 25) y no toca las correderas de un cajón arriba. En L-L la ajustan las fórmulas del
  componente; el aluminio sigue centrado. El DC no tiene `MAX`: usar `IF`.
  El material va a **todo el mueble** (opciones.json → familias.gabinete.material):
  `c16_material_puerta` + `c22matpuertade = "=c16_material_puerta"` (frentes) y
  `c15_material_estructura`, `c17_material_fondo`, `c21matestrde`,
  `c23matfondode` = el material (`{material}` en `extra`). `c21`/`c23` van directos:
  su fórmula vive solo en la definición y el DC no la recalcula en la raíz, así
  que la estructura se quedaba en TEKA ARTICO-VESTO1. Los hijos (Estructura,
  Zoclo, cajones) leen `parent!c21matestrde`. Herrajes, manijas y gola de
  aluminio conservan el suyo. Así viaja en la receta publicada.
- **Sin material** (`SIN_MATERIAL`, blanco liso) es el default del proyecto y de
  «Avanzado»: el diseñador entra y elige uno. Reemplaza a «Como el módulo»
  (material ""); un proyecto viejo con "" pasa a `SIN_MATERIAL`
  (`Proyecto.sin_vacio`).
- **CSV**: todo se genera desde la tabla (frentes, medidas, diseño, estado y
  avisos de cada fila). «Editar» abre «Avanzado» sobre una copia de la fila
  (`editarFilaCsv`, `S.avCsv`), sin pasar por la página del mueble: ahí solo se
  guarda (`guardarFilaCsv`, con la configuración sin errores) o se descarta al
  cerrar. El material del mueble se elige en «Avanzado» (`st.material`; en una
  fila, `f.material`) y viaja en `generar.material`.
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
