"use strict";

// Puente Ruby <-> JS. Fuera de SketchUp (navegador) las llamadas solo se registran.
const bridge = (name, arg) => {
  if (window.sketchup && window.sketchup[name]) window.sketchup[name](arg === undefined ? "" : arg);
  else console.log("bridge", name, arg);
};

const $ = (s, c) => (c || document).querySelector(s);
const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fileURL(abs) {
  if (!abs) return "";
  if (/^https?:|^data:/.test(abs)) return abs;
  return "file:///" + String(abs).replace(/\\/g, "/").replace(/^\/+/, "");
}
function placeholder(text, bg) {
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='150'><rect width='100%' height='100%' fill='${bg || "#e4e7e7"}'/>` +
    `<text x='50%' y='52%' fill='#555' font-family='sans-serif' font-size='13' text-anchor='middle'>${esc(text)}</text></svg>`);
}
// Muestra de un material sin foto: su tono aproximado (con veta si es madera).
function muestra(color, veta) {
  let vetas = "";
  if (veta) for (let i = 0; i < 9; i++) {
    const x = (i * 23 + (i % 3) * 7) % 200;
    vetas += `<path d='M${x} 0 C ${x + 5} 50, ${x - 4} 100, ${x + 2} 150' stroke='rgba(0,0,0,.18)' stroke-width='${1 + (i % 3)}' fill='none'/>`;
  }
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='150'><rect width='100%' height='100%' fill='${color || "#ccc"}'/>${vetas}</svg>`);
}
// Muestra de una gola: el canal con su tono, más oscuro hacia adentro.
function muestraGola(color) {
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='150'><rect y='0' width='200' height='55' fill='#c9b79a'/>` +
    `<rect y='55' width='200' height='40' fill='${color}'/>` +
    `<rect y='55' width='200' height='16' fill='rgba(0,0,0,.35)'/><rect y='71' width='200' height='10' fill='rgba(0,0,0,.18)'/>` +
    `<rect y='91' width='200' height='4' fill='rgba(255,255,255,.35)'/><rect y='95' width='200' height='55' fill='#c9b79a'/></svg>`);
}
const THUMB_FALLBACK = placeholder("sin imagen", "#ccc");
function setImg(img, url, fallback) {
  img.src = url || fallback || THUMB_FALLBACK;
  img.onerror = () => { img.onerror = null; img.src = fallback || THUMB_FALLBACK; };
}

// Categoría del catálogo -> familia del manifiesto (para «Avanzado»).
const FAMILIA_DE_CATEGORIA = { Gabinetes: "gabinete", Alacenas: "alacena", Esquineros: "esquinero" };
// Familias que Studio genera.
const FAMILIAS_ACTIVAS = ["gabinete", "alacena", "esquinero"];
// Biblioteca::CATEGORIAS en Ruby: las primeras de S.categorias, siempre visibles en el filtro.
const CATEGORIAS_FIJAS = 5;
const M = window.RKMuebles; // ui/muebles.js
const SPEC_LABELS = { sku: "SKU", ancho_mm: "Ancho", alto_mm: "Alto", fondo_mm: "Fondo" };

const S = {
  carpetas: {}, version: "",
  // Igual a Proyecto::DEFAULT en Ruby; se reemplaza con lo que llegue de onEstado.
  proyecto: { global: { frente: "1", manija_puerta: "9", manija_cajon: "9", material: "SIN_MATERIAL",
    medidas: { igualar: false, alto: 770, fondo: 600 } }, modulos: {} },
  listo: false,
  modulos: [], categorias: [],
  opciones: { medidas: {}, frentes: [], tiradores: [], materiales: [], familias: {} },
  manifiestos: {}, rcc: window.RCC_CORE || null, // ui/receta.js
  sec: "proyecto", lista: "catalogo", q: "", cat: null, clase: null,
  car: {}, // características elegidas en la barra lateral: { grupo: [valores] }
  vista: "original", // cómo se ven los creados por usuario en su filtro: "original" o "global"
  mod: null, avAbierto: false, av: {},
  csv: null,
  avCsv: null, // fila del CSV que se está editando en «Avanzado»: { i, m }
  // Registro de proyectos
  usuario: { usuario: "", nombre: "", sede: "", rol: "diseno" },
  actual: { folio: null }, estados: [], pasos: [],
  pj: { lista: [], disponible: true, q: "", alcance: null, estado: null, detalle: null },
  iniciado: false,
  sesion: false, loginRol: null,
  // «Solo la escena»: dentro de Diseño / Muebles / CSV sin proyecto abierto.
  libre: false,
};

// ==== Datos desde Ruby =======================================================
window.RKS = {
  onEstado(d) {
    S.carpetas = d.carpetas || {};
    S.version = d.version || "";
    S.proyecto = d.proyecto || S.proyecto;
    S.modulos = d.modulos || [];
    S.categorias = d.categorias || [];
    S.opciones = Object.assign(S.opciones, d.opciones || {});
    S.manifiestos = d.manifiestos || {};
    S.usuario = d.usuario || S.usuario;
    S.sesion = !!d.sesion;
    const folioAntes = S.actual.folio;
    S.actual = d.actual || { folio: null };
    S.estados = d.estados || [];
    S.pasos = d.pasos || [];
    S.listo = true;
    $("#ver").textContent = $("#login-ver").textContent = "v" + S.version;
    contadores();
    // 1. Sin sesión: solo el login.
    if (!S.sesion) { S.iniciado = false; S.libre = false; return mostrarLogin(); }
    $("#login").hidden = true;
    $("#app").hidden = false;
    // 2/3. Al entrar o al cambiar de modelo: con proyecto abierto se va
    // adentro del proyecto; sin proyecto, a la lista.
    if (S.actual.folio) S.libre = false;
    if (!S.iniciado || folioAntes !== S.actual.folio) {
      const primera = !S.iniciado;
      S.iniciado = true;
      if (S.actual.folio) return irA("proyecto");
      if (primera || dentro()) return irA("proyectos");
    }
    if (S.sec === "proyectos") bridge("proyectos_listar");
    if (S.mod && !S.mod._virtual) {
      S.mod = S.modulos.find((m) => m.id === S.mod.id) || null;
      if (!S.mod) irA(S.lista);
    }
    pintarSeccion();
  },
  onInsertado(r) {
    ocupado(false);
    if (r && r.ok === false) return aviso("Error: " + r.error);
    aviso("Módulo insertado en la escena");
  },
  onInsertados(r) { aplicarDiseno(r); },
  onAplicado(r) {
    ocupado(false);
    if (!r || r.ok === false) return aviso("Error: " + ((r && r.error) || "no se pudo aplicar"));
    const errores = r.errores || [];
    if (errores.length) return preguntar("Aplicar el diseño", `${r.hechos} actualizados. No se pudieron generar: ${errores.join(" · ")}`, [["use", "Entendido", null]]);
    aviso(`Diseño aplicado a ${r.hechos} ${r.hechos === 1 ? "mueble" : "muebles"}`);
  },
  onGenerado(r) {
    if (S.csv && S.csv.cola) return csvSiguiente(r);
    ocupado(false);
    if (!r || !r.ok) return aviso("Error: " + ((r && r.error) || "no se pudo generar"));
    aviso(`${r.nombre}: insertado${r.publicado ? " y guardado en el catálogo" : ""}`);
    if (r.publicado) bridge("recargar");
  },
  onImportado(r) {
    $("#csv-importar").disabled = false;
    if (!r || r.cancelado) return;
    if (!r.ok) return aviso("Error: " + (r.error || "no se pudo leer el archivo"));
    if (!S.rcc) return aviso("Error: no cargó ui/receta.js");
    const imp = S.rcc.construirImportacion(r);
    S.csv = { imp, sel: new Set(), hechos: {} };
    imp.filas.forEach((f, i) => { if (csvUsable(f, i)) S.csv.sel.add(i); });
    pintarCsv();
  },
  onPlantilla(r) {
    $("#csv-plantilla").disabled = false;
    if (r && r.ok) aviso("Plantilla descargada: " + r.ruta);
    else aviso("Error: " + ((r && r.error) || "no se pudo descargar"));
  },
  onProyectos(r) {
    S.pj.lista = (r && r.proyectos) || [];
    S.pj.disponible = !r || r.disponible !== false;
    if (S.sec === "proyectos") pintarProyectos();
  },
  onProyectoDetalle(reg) {
    ocupado(false);
    S.pj.detalle = reg;
    pintarFicha();
    bridge("proyectos_listar");
  },
  onProyectoAbierto(r) {
    ocupado(false);
    if (!r || r.cancelado) return;
    if (r.ok === false && r.candado) return preguntarCandado(r);
    if (r.ok === false) return aviso("Error: " + (r.error || "no se pudo abrir"));
    cerrarHojas();
    if (r.version !== undefined && r.conflicto === false) aviso(`Versión ${r.version} es ahora la vigente`);
    else if (r.consulta) aviso(`${r.folio}: copia de consulta de la versión ${r.version}`);
    else if (r.folio) aviso(`Proyecto ${r.folio} abierto`);
    bridge("recargar");
  },
  onSubida(r) {
    if (!r) return;
    if (r.aviso) return aviso(r.aviso);
    if (r.ok === false) return aviso("Error: " + r.error);
    if (r.conflicto) aviso(`Conflicto: tu versión quedó como v${r.version}. Revisa el proyecto.`);
    else if (r.pendiente) aviso("Guardado en esta PC · se subirá al volver la conexión");
    else if (r.version) aviso(`Versión ${r.version} subida al proyecto`);
  },
  onLogin(r) {
    $("#login-entrar").disabled = false;
    errorLogin(r && r.error);
  },
  onError(r) {
    ocupado(false);
    if (S.csv) S.csv.cola = null;
    aviso("Error: " + (r && r.error));
  },
};

// ==== Navegación =============================================================
// Tres pantallas: login → inicio (proyectos, ajustes) → dentro de un proyecto
// (diseño, muebles, CSV, página de un mueble). Lo de adentro pide un proyecto
// abierto en SketchUp, o «Solo la escena» (S.libre): las mismas herramientas
// sobre el modelo abierto, sin registro; guardarlo como proyecto es opcional.
const SECS_PROYECTO = ["proyecto", "lista", "modulo", "csv"];
const dentro = () => SECS_PROYECTO.includes(S.sec);

function irA(sec) {
  if (sec === "proyectos") S.libre = false;
  if (SECS_PROYECTO.includes(sec === "catalogo" ? "lista" : sec) && !S.actual.folio && !S.libre) sec = "proyectos";
  if (sec === "catalogo") { S.sec = "lista"; S.cat = null; }
  else S.sec = sec;
  if (sec !== "modulo") S.mod = null;
  if (sec === "proyectos") bridge("proyectos_listar");
  pintarSeccion();
}

function pintarSeccion() {
  if (!S.listo) return;
  const navSel = S.sec === "lista" || S.sec === "modulo" ? (S.mod && S.mod._source === "csv" ? "csv" : S.lista) : S.sec;
  $$("#tb-tabs .tab").forEach((b) => b.classList.toggle("active", b.dataset.sec === navSel));
  pintarBarra();
  ["proyectos", "proyecto", "lista", "modulo", "csv", "ajustes"].forEach((s) => { $("#sec-" + s).hidden = S.sec !== s; });
  if (S.sec !== "modulo") S.avAbierto = false;
  if (S.sec !== "csv") S.avCsv = null;
  $("#avanzado").hidden = !(S.avAbierto || S.avCsv);
  if (S.sec === "proyectos") pintarProyectos();
  if (S.sec === "proyecto") pintarProyecto();
  if (S.sec === "lista") pintarLista();
  if (S.sec === "modulo") pintarModulo();
  if (S.sec === "csv") pintarCsv();
  if (S.sec === "ajustes") pintarAjustes();
}

function contadores() {
  const activos = S.modulos.filter(activo);
  $("#n-catalogo").textContent = activos.length;
}

// ==== Proyecto: configuración global ========================================
let guardarTimer;
function guardarProyecto() {
  clearTimeout(guardarTimer);
  guardarTimer = setTimeout(() => bridge("guardar_proyecto", JSON.stringify(S.proyecto)), 300);
}

function pintarProyecto() {
  const g = S.proyecto.global;
  pintarPickers($("#pr-pickers"), g, true, () => { guardarProyecto(); pintarProyecto(); }, { gola: RKReglas.conGola(S.opciones, golaFam(), g.gola) });
  $("#pr-igualar").checked = !!g.medidas.igualar;
  $("#pr-igualar").onchange = (e) => { g.medidas.igualar = e.target.checked; guardarProyecto(); pintarProyecto(); };
  const md = $("#pr-medidas");
  md.innerHTML = "";
  md.classList.toggle("is-off", !g.medidas.igualar);
  ["alto", "fondo"].forEach((k) => md.appendChild(filaMedida(k, g.medidas[k], (v) => {
    g.medidas[k] = v; guardarProyecto(); pintarPreviewProyecto();
  }, !g.medidas.igualar)));
  pintarPreviewProyecto();
  $("#pr-aplicar").onclick = () => { ocupado(true, "Buscando los muebles insertados…"); bridge("insertados"); };
}

/* Muebles de ejemplo de «Así se verá». */
const EJEMPLOS = [["gabinete", "Gabinete"], ["alacena", "Alacena"], ["esquinero", "Esquinero"]];

function pintarPreviewProyecto() {
  const g = S.proyecto.global;
  const ejemplo = S.ejemplo || "gabinete";
  pintarSeg($("#pr-ejemplo"), EJEMPLOS, ejemplo, (v) => { S.ejemplo = v; pintarPreviewProyecto(); });
  if (ejemplo === "alacena") {
    // Las dos clases de frente de la alacena con la manija del proyecto; sin gola.
    const lay = RKVista.desdeAlacena({ d01_cantidad_zonas: "2", c25tipopuerta: "6", d31_z2_contenido: "1", d35_z2_cant_puertas: "3" }, { ancho: 800, alto: 900 });
    visor("#pr-preview").mostrar(RKVista.svg(lay, disenoSvg(g, false)), "proyecto-alacena");
    $("#pr-preview-note").textContent = "Ejemplo: alacena de 800 mm con Avento S arriba y puerta doble abajo (las alacenas no llevan gola).";
    return;
  }
  if (ejemplo === "esquinero") {
    // Con la gola del proyecto (solo L arriba, según su tipo) y, con gola, frente Lisa.
    const fam = (S.opciones.familias || {}).esquinero || null;
    const conGola = RKReglas.conGola(S.opciones, fam, g.gola);
    const lay = RKVista.desdeEsquinero({ c25tipopuerta: "1", b01_gola_o_tirador: conGola ? "2" : "1" }, { ancho: 1000, alto: 770, fondo: 1000 });
    if (conGola) Object.assign(lay, golaEsquinero(g.gola));
    const d = conGola ? Object.assign({}, g, { frente: RKReglas.frenteGola(S.opciones) }) : g;
    visor("#pr-preview").mostrar(RKVista.svg(lay, disenoSvg(d, conGola, RKReglas.colorGola(S.opciones, fam, g.gola))), "proyecto-esquinero");
    const tipo = conGola ? (lay.golaTipo === "2" ? " y gola de melamina" : " y gola de aluminio") : "";
    $("#pr-preview-note").textContent = `Ejemplo: esquinero de 1000 × 1000 mm con puerta en L${tipo}, visto desde la esquina.`;
    return;
  }
  const alto = g.medidas.igualar ? g.medidas.alto : 770;
  const conGola = RKReglas.conGola(S.opciones, golaFam(), g.gola);
  const lay = RKVista.desdeValores({ d01_cantidad_zonas: "2", d11_z1_contenido: "1", d15_z1_cant_puertas: "3",
    d31_z2_contenido: "2", d32_z2_cant_cajones: conGola ? "2" : "3", b01_gola_o_tirador: conGola ? "2" : "1", a02_alto_zoclo: "100mm" }, { ancho: 700, alto });
  // Con gola el frente es Lisa, como lo va a insertar.
  const d = conGola ? Object.assign({}, g, { frente: RKReglas.frenteGola(S.opciones) }) : g;
  visor("#pr-preview").mostrar(RKVista.svg(lay, disenoSvg(d, conGola, RKReglas.colorGola(S.opciones, golaFam(), g.gola))), "proyecto");
  $("#pr-preview-note").textContent = `Ejemplo: gabinete de 700 mm con puerta doble y ${conGola ? "2 cajones, con gola" : "3 cajones"}.`;
}

/* «Aplicar el diseño a los muebles insertados»: Ruby dice qué muebles de la
   escena se insertaron con el diseño del proyecto ({ id, n } por mueble del
   catálogo); aquí se arma la elección de cada uno con el diseño de hoy y, tras
   confirmar, Ruby los vuelve a generar en su lugar. */
function aplicarDiseno(r) {
  ocupado(false);
  if (!r || r.ok === false) return aviso("Error: " + ((r && r.error) || "no se pudo leer la escena"));
  const trabajos = [], fallas = [];
  let total = 0;
  (r.muebles || []).forEach(({ id, n }) => {
    const m = S.modulos.find((x) => x.id === id);
    if (!m) return fallas.push(`${id}: ya no está en el catálogo`);
    const e = eleccionDe(m, disenoGlobal(m));
    if (e.aviso) return fallas.push(e.aviso);
    trabajos.push({ id, eleccion: e.eleccion });
    total += n;
  });
  const sin = fallas.length ? `\n\nNo se pueden cambiar: ${fallas.join(" · ")}` : "";
  if (!total) return preguntar("Aplicar el diseño", "No hay muebles en la escena que se hayan insertado con el diseño del proyecto." + sin, [["use", "Entendido", null]]);
  preguntar("Aplicar el diseño",
    `Se volverán a generar ${total} ${total === 1 ? "mueble" : "muebles"} en su mismo lugar con el diseño del proyecto. ` +
    "Los insertados ajustados o con su diseño original no cambian. Se puede deshacer con Ctrl+Z." + sin, [
      ["key", "Cancelar", null],
      ["use", "Aplicar", () => {
        ocupado(true, `Aplicando el diseño a ${total} ${total === 1 ? "mueble" : "muebles"}… (puede tardar)`);
        bridge("aplicar_diseno", JSON.stringify(trabajos));
      }],
    ]);
}

// ==== Selectores con foto (frente / manija / material) =======================
// Manija aparte para puertas y para cajones (reglas en reglas.js / opciones.json).
const PICKERS = [
  { key: "gola", titulo: "Gola", lista: () => S.opciones.golas, sinCambio: true },
  { key: "frente", titulo: "Tipo de frente", lista: () => S.opciones.frentes },
  { key: "manija_puerta", titulo: "Manija de puertas", uso: "puerta", lista: () => S.opciones.tiradores },
  { key: "manija_cajon", titulo: "Manija de cajones", uso: "cajon", lista: () => S.opciones.tiradores },
  { key: "material", titulo: "Material del mueble", lista: () => S.opciones.materiales, buscar: true },
];
// Material por defecto: todo el mueble blanco, para que el diseñador elija uno.
const SIN_MATERIAL = "SIN_MATERIAL";
const esManija = (key) => key === "manija_puerta" || key === "manija_cajon";

function opcion(key, id) {
  const p = PICKERS.find((x) => x.key === key);
  return (p.lista() || []).find((o) => String(o.id) === String(id)) || null;
}

function fotoDe(key, o) {
  if (o && o.foto_abs) return fileURL(o.foto_abs);
  if (key === "material") return o ? muestra(o.color, o.veta) : placeholder("Sin material", "#ffffff");
  if (key === "gola") return o && o.color ? muestraGola(o.color) : placeholder(o ? "Con tirador" : "Como el módulo", "#ece8e1");
  if (esManija(key) && o && o.id === "1") return placeholder("Sin manija");
  return placeholder(o ? o.nombre : "—");
}

/* Foto de una opción en +img+. La madera sin foto se ve con la textura de
   veta teñida de su color (la misma que en SketchUp y en «Así se verá»): la
   imagen base con un filtro SVG del documento (RKVista.filtroVeta). */
function fotoEn(img, key, o) {
  const t = key === "material" && o && !o.foto_abs && o.veta ? texturaVeta() : null;
  img.classList.toggle("veta", !!t);
  img.style.filter = t ? `url(#${filtroMaterial(o, t)})` : "";
  setImg(img, t ? t.url : fotoDe(key, o));
}

/* Id del <filter> de +o+ en un <svg> oculto del documento (se crea una vez). */
function filtroMaterial(o, t) {
  const id = "rk-tinte-" + String(o.id).replace(/[^\w-]/g, "_");
  if (document.getElementById(id)) return id;
  let defs = document.getElementById("rk-filtros");
  if (!defs) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    svg.innerHTML = '<defs id="rk-filtros"></defs>';
    document.body.appendChild(svg);
    defs = document.getElementById("rk-filtros");
  }
  defs.insertAdjacentHTML("beforeend", RKVista.filtroVeta(id, o.color, t.luminancia));
  return id;
}

/* Textura base de la madera sin foto (opciones.json → textura_veta), la misma
   que Studio tiñe en SketchUp (Acabado.tenir), o null. */
function texturaVeta() {
  const t = S.opciones.textura_veta;
  return t && t.ruta ? { url: fileURL(t.ruta), ancho: t.ancho_mm, alto: t.alto_mm, luminancia: t.luminancia } : null;
}

/* Diseño -> lo que necesita RKVista.svg. */
function disenoSvg(d, gola, golaColor) {
  const vista = (key) => { const t = opcion(key, d[key]); return gola ? null : (t && t.vista) || null; };
  const mat = opcion("material", d.material);
  return {
    frente: d.frente,
    manijaPuerta: vista("manija_puerta"),
    manijaCajon: vista("manija_cajon"),
    material: mat ? { color: mat.color, foto: mat.foto_abs ? fileURL(mat.foto_abs) : null, veta: mat.veta, textura: texturaVeta() } : null,
    gola,
    golaColor: golaColor || null,
  };
}

/* Por qué la opción +o+ no se puede elegir con el resto del diseño +d+, o "".
   Cada lado de una regla se bloquea: elegir Berlín con frente Mitered no se
   puede, y con Berlín elegido tampoco se puede pasar a Mitered. */
function bloqueo(key, o, d) {
  const op = S.opciones;
  const p = PICKERS.find((x) => x.key === key);
  if (p.uso) return RKReglas.manija(op, p.uso, o.id, d.frente);
  if (key === "material") return RKReglas.material(op, o.id, d.frente);
  if (key === "frente") {
    // Solo lo que este frente rompería (no un problema que el diseño ya traía).
    const e = RKReglas.diseno(op, Object.assign({}, d, { frente: o.id }), false);
    return e && e !== RKReglas.diseno(op, d, false) ? e : "";
  }
  return "";
}

/* Nota de la manija en ese uso (Lateral negra en puertas va al centro). */
function notaManija(p, o) {
  return p.uso && o && RKReglas.posicion(S.opciones, p.uso, o.id) === "5" ? "Al centro, en los cantos" : "";
}

/* Tiles de los selectores sobre el objeto +d+ (global o del módulo). */
function pintarPickers(box, d, editable, onCambio, extra) {
  box.innerHTML = "";
  // Con gola el frente no se elige (va Lisa): un ajuste viejo con otro no es error.
  const error = RKReglas.diseno(S.opciones, extra.gola ? Object.assign({}, d, { frente: RKReglas.frenteGola(S.opciones) }) : d, !!extra.gola);
  PICKERS.forEach((p) => {
    // En un mueble (+extra.fc+, su mapeo de opciones.json) solo lo que su
    // familia usa: la alacena no lleva gola ni manija de cajón.
    if (extra.fc && !extra.fc[p.key]) return;
    // Con gola no hay manija y el frente es siempre Lisa: no se eligen.
    const sinManija = esManija(p.key) && extra.gola;
    const frenteGola = p.key === "frente" && extra.gola;
    const fijo = sinManija || frenteGola;
    const o = opcion(p.key, frenteGola ? RKReglas.frenteGola(S.opciones) : d[p.key]);
    const t = document.createElement("button");
    t.type = "button";
    t.className = "pick-tile" + (editable && !fijo ? "" : " off");
    t.disabled = !editable || fijo;
    const nombre = sinManija ? "Con gola: sin manija" : frenteGola ? `Con gola: ${o ? o.nombre : "Lisa"}`
      : (o ? o.nombre : (p.sinCambio ? "Como el módulo" : "—"));
    t.innerHTML = `<div class="pick-photo"><img alt=""></div><div class="pick-text"><span class="stamp">${p.titulo}</span>` +
      `<strong>${esc(nombre)}</strong><span class="pick-sub">${esc(o && o.grupo ? o.grupo : notaManija(p, o))}</span>` +
      (editable && !fijo ? "<span class='pick-change'>Cambiar…</span>" : "") + "</div>";
    if (sinManija) setImg($("img", t), placeholder("Gola")); else fotoEn($("img", t), p.key, o);
    if (editable && !fijo) t.onclick = () => abrirPicker(p, d, onCambio);
    // Con una gola elegida, en la misma tarjeta: L-C o L-L (si la familia la
    // combina: el esquinero lleva solo la L de arriba).
    const famGola = extra.fc || golaFam();
    if (p.key === "gola" && o && RKReglas.conGola(S.opciones, famGola, o.id) && famGola.gola.combinacion) {
      const caja = document.createElement("div");
      caja.className = "pick-con-seg";
      const seg = document.createElement("div");
      seg.className = "seg pick-seg";
      seg.title = "L - L cierra el hueco entre zonas";
      caja.append(t, seg);
      box.appendChild(caja);
      pintarSeg(seg, [["1", "L - C"], ["2", "L - L"]], d.gola_combinacion || "1", (v) => {
        d.gola_combinacion = v; onCambio();
      }, !editable);
    } else box.appendChild(t);
  });
  // Diseños guardados antes de una regla (p. ej. concha en puertas).
  if (error) box.insertAdjacentHTML("beforeend", `<p class="cf-error pick-error">${esc(error)}: cámbialo antes de insertar.</p>`);
}

/* Un solo selector con foto sobre +d+ (el material en «Avanzado»). */
function pintarTile(box, p, d, onCambio) {
  const o = opcion(p.key, d[p.key]);
  box.innerHTML = `<button type="button" class="pick-tile"><div class="pick-photo"><img alt=""></div><div class="pick-text">` +
    `<span class="stamp">${p.titulo}</span><strong>${esc(o ? o.nombre : "Sin material")}</strong>` +
    `<span class="pick-sub">${esc(o && o.grupo ? o.grupo : "")}</span><span class="pick-change">Cambiar…</span></div></button>`;
  fotoEn($("img", box), p.key, o);
  $("button", box).onclick = () => abrirPicker(p, d, onCambio);
}

let pk = null;
function abrirPicker(p, d, onCambio) {
  pk = { p, d, onCambio };
  $("#pk-title").textContent = p.titulo;
  $("#pk-search-wrap").hidden = !p.buscar;
  $("#pk-q").value = "";
  pintarPicker();
  $("#picker").hidden = false;
  if (p.buscar) $("#pk-q").focus();
}

function pintarPicker() {
  const { p, d } = pk;
  const grid = $("#pk-grid");
  const q = $("#pk-q").value.trim().toLowerCase();
  const lista = (p.lista() || []).filter((o) => !q || `${o.nombre} ${o.id} ${o.grupo || ""}`.toLowerCase().includes(q));
  const grupos = new Map();
  if (p.sinCambio && !q) grupos.set("", [null]);
  lista.forEach((o) => {
    const g = o.grupo || "";
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(o);
  });
  grid.innerHTML = "";
  grupos.forEach((items, g) => {
    if (g) grid.insertAdjacentHTML("beforeend", `<h3 class="stamp pk-group">${esc(g)}</h3>`);
    const wrap = document.createElement("div");
    wrap.className = "pk-items";
    items.forEach((o) => {
      const id = o ? String(o.id) : "";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pk-item" + (String(d[p.key] || "") === id ? " active" : "");
      const motivo = o ? bloqueo(p.key, o, d) : "";
      b.disabled = !!motivo;
      b.title = motivo || (o && o.color && !o.foto_abs && !(p.key === "material" && o.veta && texturaVeta()) ? "Tono aproximado: falta la foto" : "");
      b.innerHTML = `<div class="pk-photo"><img alt="" loading="lazy"></div><span class="pk-name">${esc(o ? o.nombre : "Como el módulo")}</span>` +
        (motivo ? `<span class="pk-why">${esc(motivo)}</span>` : "");
      fotoEn($("img", b), p.key, o);
      b.onclick = () => { d[p.key] = id; $("#picker").hidden = true; pk.onCambio(); };
      wrap.appendChild(b);
    });
    grid.appendChild(wrap);
  });
  if (!lista.length) grid.innerHTML = "<p class='empty'>Sin resultados</p>";
}

/* +opciones+ = [[valor, texto, apagada?]]: una opción apagada se ve pero no se elige. */
function pintarSeg(box, opciones, actual, onCambio, deshabilitado) {
  box.innerHTML = "";
  opciones.forEach(([v, txt, apagada]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (String(actual) === v ? " active" : "");
    b.textContent = txt;
    b.disabled = !!deshabilitado || !!apagada;
    b.onclick = () => onCambio(v);
    box.appendChild(b);
  });
}

/* Fila de medida: chips con presets + campo libre en mm. +propia+: etiqueta y
   presets de la familia (opciones.json → familias.<f>.medidas_ui). */
function filaMedida(k, valor, onCambio, deshabilitado, etiqueta, propia) {
  const d = Object.assign({ label: k, presets: [] }, (S.opciones.medidas || {})[k], propia);
  const row = document.createElement("div");
  row.className = "dim-row";
  row.innerHTML = `<span class="dim-label">${esc(etiqueta || d.label)}</span><div class="dim-presets"></div>` +
    `<label class="dim-custom"><input type="number" min="1" step="1" aria-label="${esc(d.label)} en mm"><span>mm</span></label>`;
  const presets = $(".dim-presets", row);
  const inp = $("input", row);
  let actual = Number(valor) || "";
  const pintar = () => {
    $$(".chip", presets).forEach((b) => b.classList.toggle("active", Number(b.dataset.v) === Number(actual)));
    inp.value = actual;
  };
  [...new Set([...(d.presets || []), Number(valor)].filter((v) => v > 0))].sort((a, b) => a - b).forEach((v) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = v;
    b.dataset.v = v;
    b.disabled = !!deshabilitado;
    b.onclick = () => { actual = v; pintar(); onCambio(v); };
    presets.appendChild(b);
  });
  inp.disabled = !!deshabilitado;
  inp.oninput = () => { actual = inp.value === "" ? "" : Number(inp.value); pintar(); if (actual > 0) onCambio(actual); };
  pintar();
  return row;
}

// ==== Catálogo de muebles ======================================================
function activo(m) {
  return FAMILIAS_ACTIVAS.includes(familiaDe(m));
}
// El catálogo son las recetas guardadas (Biblioteca en Ruby).
function enLista(m) {
  return activo(m);
}

function pintarLista() {
  $("#ls-stamp").textContent = "Recetas";
  $("#ls-title").textContent = "Catálogo de muebles";
  const acc = $("#ls-actions");
  acc.innerHTML = FAMILIAS_ACTIVAS.map((f) => `<button class="key" data-nuevo="${f}">+ ${esc((S.manifiestos[f] || {}).titulo || f)}</button>`).join("") +
    `<button class="use" id="ls-csv">Crear desde CSV</button>`;
  $$("[data-nuevo]", acc).forEach((b) => (b.onclick = () => nuevoModulo(b.dataset.nuevo)));
  $("#ls-csv", acc).onclick = () => irA("csv");
  const enPanel = S.modulos.filter(enLista);
  // Dos selectores: de qué origen (catálogo / creado por usuario) y de qué tipo de
  // mueble. Cada etiqueta lleva cuántos hay con el otro filtro puesto.
  const nClase = M.conteos(M.filtrar(enPanel, { cat: S.cat })).clase;
  pintarSeg($("#ls-clase"), [["", `Todos · ${nClase.catalogo + nClase.usuario}`]]
    .concat(M.CLASES.map(([v, t]) => [v, `${t} · ${nClase[v]}`])), S.clase || "", (v) => {
      // Al entrar a los creados por usuario se ven como se crearon.
      if (v === "usuario" && S.clase !== "usuario") S.vista = "original";
      S.clase = v || null; pintarLista();
    });
  // «Ver con» solo aplica a los creados por usuario: el catálogo siempre va con el proyecto.
  const conVista = S.clase === "usuario";
  $("#ls-vista-wrap").hidden = !conVista;
  if (conVista) pintarSeg($("#ls-vista"), [["original", "Original"], ["global", "Este proyecto"]], S.vista, (v) => { S.vista = v; pintarLista(); });
  const deClase = M.filtrar(enPanel, { clase: S.clase });
  const nCat = M.conteos(deClase).cat;
  // Las categorías fijas salen siempre (aunque estén vacías) y luego las que existan.
  const cats = S.categorias.filter((c, i) => nCat[c] || i < CATEGORIAS_FIJAS);
  const chips = $("#chips");
  chips.innerHTML = "";
  [["", `Todos · ${deClase.length}`]].concat(cats.map((c) => [c, `${c} · ${nCat[c] || 0}`])).forEach(([v, t]) => {
    const b = document.createElement("button");
    b.className = "chip" + ((S.cat || "") === v ? " active" : "") + (v && !nCat[v] ? " is-vacio" : "");
    b.textContent = t;
    b.onclick = () => { S.cat = v || null; pintarLista(); };
    chips.appendChild(b);
  });
  $("#ls-nota").textContent = conVista
    ? (S.vista === "original"
      ? "Creados por usuario, con su diseño original. «Usar» los inserta como se crearon; cambia «Ver con» para aplicarles el diseño del proyecto."
      : "Creados por usuario, con el diseño del proyecto (frente, manijas, material). «Usar» los inserta así.")
    : "Todo se muestra e inserta con el diseño del proyecto. Los creados por usuario también pueden ir con su diseño original: fíltralos o entra al mueble.";
  const q = S.q.trim();
  pintarFacetas(M.filtrar(enPanel, { q, clase: S.clase, cat: S.cat }));
  const lista = M.filtrar(enPanel, { q, clase: S.clase, cat: S.cat, car: S.car });
  const grid = $("#grid");
  grid.innerHTML = "";
  if (!lista.length) {
    const vacio = q ? "Sin resultados"
      : Object.values(S.car).some((v) => v.length) && enPanel.length ? "Ningún mueble tiene esas características · quita alguna de la barra"
      : !enPanel.length ? "Aún no hay muebles · crea uno con + Gabinete, + Alacena, + Esquinero o desde CSV y guárdalo en el catálogo"
      : S.cat && !FAMILIAS_ACTIVAS.includes(FAMILIA_DE_CATEGORIA[S.cat] || "gabinete") ? `${S.cat}: todavía no disponible en Studio`
      : `No hay ${S.clase === "usuario" ? "muebles creados por usuario" : S.clase === "catalogo" ? "muebles de catálogo" : "muebles"}${S.cat ? " en " + S.cat : ""}`;
    grid.innerHTML = `<p class="empty">${esc(vacio)}</p>`;
    return;
  }
  lista.forEach((m) => grid.appendChild(tarjeta(m)));
}

/* Barra lateral: características de los muebles de +base+ (lo que ya dejan
   pasar el origen, el tipo y el texto). Los entrepaños no se filtran aquí. */
function pintarFacetas(base) {
  const box = $("#ls-facetas");
  const grupos = M.facetas(base, S.car);
  const elegidas = Object.values(S.car).reduce((n, v) => n + v.length, 0);
  box.hidden = !grupos.length && !elegidas;
  box.parentNode.classList.toggle("sin-facetas", box.hidden);
  box.innerHTML = `<div class="facetas-head"><span class="stamp">Características</span>` +
    `<button class="key sm" ${elegidas ? "" : "hidden"}>Limpiar</button></div>`;
  $("button", box).onclick = () => { S.car = {}; pintarLista(); };
  grupos.forEach((g) => {
    const h = document.createElement("h3");
    h.className = "stamp";
    h.textContent = g.titulo;
    box.appendChild(h);
    g.opciones.forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "faceta" + (o.activo ? " active" : "");
      b.setAttribute("aria-pressed", o.activo ? "true" : "false");
      b.disabled = !o.n && !o.activo;
      b.innerHTML = `<i></i><span>${esc(o.valor)}</span><b>${o.n}</b>`;
      b.onclick = () => {
        const sel = S.car[g.id] || [];
        S.car[g.id] = o.activo ? sel.filter((v) => v !== o.valor) : sel.concat(o.valor);
        pintarLista();
      };
      box.appendChild(b);
    });
  });
}

/* Lo que la tarjeta dice del mueble: medidas, frentes (de su receta) y rasgos. */
const INFO = new Map();
function infoMueble(m) {
  const clave = m.id + "|" + (m.creado || "");
  if (INFO.has(clave)) return INFO.get(clave);
  const s = m.specs || {};
  const info = { medidas: [s.ancho_mm, s.alto_mm, s.fondo_mm].filter(Boolean).join(" × "), frentes: "", rasgos: [] };
  const man = S.manifiestos[familiaDe(m)];
  if (man && S.rcc && m.receta) {
    const valores = RKAvanzado.valoresDesdeFila(man, m.receta.valores || {}, S.rcc);
    info.frentes = frentesDe(man, valores).texto;
  }
  const f = m.features || {};
  // Tirador o gola, tarja, entrepaño y el tipo de cajón: lo que distingue a dos muebles con los mismos frentes.
  info.rasgos = (f.tipo || []).concat((f.configuracion || []).filter((t) => /^Cajón /.test(t)).map((t) => t.replace(/^Cajón /, "")));
  INFO.set(clave, info);
  return info;
}

function tarjeta(m) {
  const c = document.createElement("div");
  c.className = "card";
  c.tabIndex = 0;
  const sku = (m.specs && m.specs.sku) || "";
  const modo = modoDe(m, true);
  const info = infoMueble(m);
  c.innerHTML = `<div class="vents" aria-hidden="true"><i></i><i></i><i></i></div>` +
    `<span class="badge ${M.clase(m)}">${esc(M.etiqueta(m))}</span>` +
    `<div class="screen preview-mini" aria-hidden="true">${svgModulo(m, false, true)}</div><div class="body">` +
    `<div class="name" title="${esc(m.name)}">${esc(m.name)}</div>` +
    (sku && sku !== m.name ? `<div class="meta">${esc(sku)}</div>` : "") +
    (info.frentes ? `<div class="card-frentes">${esc(info.frentes)}</div>` : "") +
    (info.medidas ? `<div class="meta">${esc(info.medidas)} mm</div>` : "") +
    (info.rasgos.length ? `<div class="card-rasgos">${info.rasgos.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : "") +
    // El pie (de dónde sale el diseño + botones) va siempre abajo, a la misma altura en toda la fila.
    `<div class="card-pie"><div class="card-nota${modo === "global" ? "" : " ajuste"}">${NOTA_MODO[modo]}</div>` +
    `<div class="card-actions"><button class="use sm">Configurar</button><button class="key sm" title="${TITULO_USAR[modo]}">Usar</button></div></div></div>`;
  const [conf, usar] = $$("button", c);
  conf.onclick = (e) => { e.stopPropagation(); abrirModulo(m); };
  usar.onclick = (e) => { e.stopPropagation(); usarModulo(m, true); };
  c.onclick = () => abrirModulo(m);
  c.onkeydown = (e) => { if (e.target === c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); abrirModulo(m); } };
  return c;
}


// ==== Página del módulo =========================================================
function familiaDe(m) {
  return m.receta_familia || m.familia || FAMILIA_DE_CATEGORIA[m.category] || null;
}
function tieneReceta(m) {
  return m._source === "creaciones" && !!m.receta;
}
function cfgFamilia(m) {
  return (S.opciones.familias || {})[familiaDe(m)] || null;
}
function recetaValor(m, attr) {
  const v = m.receta && m.receta.valores && m.receta.valores[attr];
  return v == null ? "" : String(v);
}
function esGola(m) {
  if (m.receta) return recetaValor(m, "b01_gola_o_tirador") === "2";
  return Object.values(m.features || {}).flat().some((t) => /gola/i.test(t));
}
// La gola elegida en el diseño manda; sin elección, la del mueble.
const golaFam = () => (S.opciones.familias || {}).gabinete || null;
function golaDe(m, d) {
  return RKReglas.conGola(S.opciones, cfgFamilia(m) || golaFam(), d && d.gola, esGola(m));
}
function colorGolaDe(m, d) {
  return RKReglas.colorGola(S.opciones, cfgFamilia(m) || golaFam(), d && d.gola, m.receta && m.receta.valores);
}
/* De dónde sale el diseño del mueble en este proyecto (ui/muebles.js):
   "global", "original" (como se creó) o "personal" (ajustado aquí). +enLista+:
   la tarjeta también obedece a «Ver con» del filtro de creados por usuario. */
function modoDe(m, enLista) {
  return M.modo(m, S.proyecto.modulos[m.id], enLista && S.clase === "usuario" ? S.vista : null);
}
const NOTA_MODO = { global: "Diseño del proyecto", personal: "Ajustado en este proyecto", original: "Diseño original" };
const TITULO_USAR = { global: "Insertar con el diseño del proyecto", personal: "Insertar con el ajuste de este proyecto", original: "Insertar como se creó" };

/* Diseño efectivo del módulo: el original de su receta (creados por usuario), el
   ajustado en este proyecto, o el global (con las medidas propias del módulo,
   salvo «igualar» en gabinetes, que pone el alto y fondo comunes). El ancho y
   la tarja son siempre del mueble: no hay un valor de proyecto para ellos. */
function disenoDe(m, enLista) {
  const o = S.proyecto.modulos[m.id];
  const modo = modoDe(m, enLista);
  if (modo === "global") return disenoGlobal(m);
  const d = modo === "original"
    ? Object.assign({ modo }, medidasBase(m), M.disenoOriginal(cfgFamilia(m), m.receta && m.receta.valores))
    : Object.assign({ modo: "personal" }, medidasBase(m), o, o.medidas || {});
  return frenteConGola(m, d);
}

/* El diseño del proyecto sobre +m+, tenga o no elección propia (es el que
   reciben los muebles insertados con «Aplicar el diseño»). */
function disenoGlobal(m) {
  const g = S.proyecto.global;
  const tarja = M.disenoOriginal(cfgFamilia(m), m.receta && m.receta.valores).tarja;
  const d = Object.assign({ modo: "global" }, medidasBase(m), { frente: g.frente, manija_puerta: g.manija_puerta, manija_cajon: g.manija_cajon, material: g.material, tarja,
    gola: g.gola || "", gola_combinacion: g.gola_combinacion || "1" });
  if (g.medidas.igualar && tieneReceta(m) && familiaDe(m) === "gabinete") { d.alto = g.medidas.alto; d.fondo = g.medidas.fondo; }
  return frenteConGola(m, d);
}

function medidasBase(m) {
  const s = m.specs || {};
  return { ancho: s.ancho_mm || 700, alto: s.alto_mm || 770, fondo: s.fondo_mm || 600 };
}

// Con gola el frente es siempre Lisa: ni el proyecto ni un ajuste lo cambian.
function frenteConGola(m, d) {
  if (golaDe(m, d) && RKReglas.gola(S.opciones, d.frente)) d.frente = RKReglas.frenteGola(S.opciones);
  return d;
}

function abrirModulo(m, avanzado) {
  S.mod = m;
  S.avAbierto = !!avanzado;
  S.sec = "modulo";
  pintarSeccion();
}

function abrirAvanzado(on) {
  // Editando una fila del CSV, cerrar descarta lo que no se guardó.
  if (S.avCsv) { delete S.av[S.avCsv.m.id]; S.avCsv = null; $("#avanzado").hidden = true; return; }
  S.avAbierto = on;
  $("#avanzado").hidden = !on;
  if (on) pintarAvanzado(S.mod);
  else pintarPreviewModulo(S.mod);
}

/* El diseño cambió en la barra: «Avanzado» se vuelve a armar desde él. */
function cambioDiseno(m) {
  delete S.av[m.id];
  guardarProyecto();
}

function nuevoModulo(fam) {
  const man = S.manifiestos[fam];
  if (!man) return aviso("Error: falta el manifiesto de " + fam);
  const cat = Object.keys(FAMILIA_DE_CATEGORIA).find((k) => FAMILIA_DE_CATEGORIA[k] === fam);
  const titulo = man.titulo.toLowerCase();
  // «Nueva alacena», «Nuevo gabinete».
  abrirModulo({ id: "nuevo-" + fam, name: (/a$/.test(titulo) ? "Nueva " : "Nuevo ") + titulo, category: cat, familia: fam,
    _source: "nuevo", _virtual: true, specs: {}, features: {} }, true);
}

function pintarModulo() {
  const m = S.mod;
  if (!m) return irA(S.lista);
  const d = disenoDe(m);
  const real = tieneReceta(m);
  $("#md-stamp").textContent = { csv: "Fila del CSV", nuevo: "Mueble nuevo" }[m._source] || "Catálogo";
  $("#md-name").textContent = m.name;
  $("#md-tags").innerHTML = Object.values(m.features || {}).flat().map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  // Módulo nuevo o fila del CSV: no hay diseño que heredar, todo se define en «Avanzado».
  $("#tab-diseno").hidden = !!m._virtual;
  $(".mod-body").classList.toggle("solo-vista", !!m._virtual);

  const specs = $("#md-specs");
  specs.innerHTML = "";
  Object.entries(m.specs || {}).forEach(([k, v]) => specs.insertAdjacentHTML("beforeend", `<div>${esc(SPEC_LABELS[k] || k)}</div><div>${esc(v)}${k.endsWith("_mm") ? " mm" : ""}</div>`));

  if (!m._virtual) pintarDiseno(m, d, real);
  pintarPreviewModulo(m);
  if (S.avAbierto) pintarAvanzado(m);
}

function pintarDiseno(m, d, real) {
  const personal = d.modo === "personal";
  const fc = cfgFamilia(m);
  const gola = golaDe(m, d);
  const esUsuario = M.clase(m) === "usuario";
  // Todos parten del diseño del proyecto. Los creados por usuario pueden ir
  // también con su diseño original; cualquiera se puede ajustar aquí.
  pintarSeg($("#md-modo"), M.modos(m), d.modo, (v) => {
    if (v === "personal") {
      const g = disenoDe(m);
      S.proyecto.modulos[m.id] = { personalizado: true, frente: g.frente, manija_puerta: g.manija_puerta, manija_cajon: g.manija_cajon, material: g.material, tarja: g.tarja,
        gola: g.gola || "", gola_combinacion: g.gola_combinacion || "1", medidas: { ancho: g.ancho, alto: g.alto, fondo: g.fondo } };
    } else if (v === "original") S.proyecto.modulos[m.id] = { original: true };
    else delete S.proyecto.modulos[m.id];
    cambioDiseno(m);
    pintarModulo();
  });
  $("#md-modo-note").textContent = {
    original: "Va con el frente, manijas y material con que se creó, sin tomar los del proyecto.",
    personal: "Ajuste solo de este mueble en este proyecto; el resto del proyecto y el catálogo no cambian.",
    global: esUsuario ? "Toma el diseño del proyecto (sección Diseño). «Original» lo deja como se creó; «Ajustar este mueble» cambia solo este."
      : "Mueble de catálogo: toma el diseño del proyecto (sección Diseño). Para cambiar solo este, elige «Ajustar este mueble».",
  }[d.modo];
  const al = M.alcance(fc, gola, !!S.proyecto.global.medidas.igualar && familiaDe(m) === "gabinete", !!S.proyecto.global.gola);
  $("#md-alcance").hidden = d.modo !== "global";
  $("#md-alcance").innerHTML = `<b>Del proyecto:</b> ${esc(al.cambia.join(", ") || "nada")}. <b>Se queda como está:</b> ${esc(al.fijo.join(", "))}.`;
  $("#md-origen").textContent = M.etiqueta(m);
  $("#md-origen").className = "badge-linea " + M.clase(m);

  const o = S.proyecto.modulos[m.id];
  const set = (k, v) => { o.medidas = o.medidas || {}; o.medidas[k] = v; cambioDiseno(m); pintarPreviewModulo(m); };
  const md = $("#md-medidas");
  md.innerHTML = "";
  const totales = !real;
  // La familia puede renombrar sus medidas (esquinero: «fondo» es el ancho derecho).
  const ui = (fc && fc.medidas_ui) || {};
  ["ancho", "alto", "fondo"].forEach((k) => md.appendChild(filaMedida(k, d[k], (v) => set(k, v), !personal,
    ui[k] ? null : totales && k !== "ancho" ? (k === "alto" ? "Alto total" : "Fondo total") : null, ui[k])));

  // Tarja solo donde se puede aplicar de verdad (creación con receta).
  $("#md-tarja-wrap").hidden = !(fc && fc.tarja && real);
  pintarSeg($("#md-tarja"), [["0", "No"], ["1", "Sí · refuerzos para fregadero"]], d.tarja ? "1" : "0", (v) => {
    o.tarja = v === "1"; cambioDiseno(m); pintarModulo();
  }, !personal || !real);

  pintarPickers($("#md-pickers"), personal ? o : d, personal, () => { cambioDiseno(m); pintarModulo(); }, { gola, fc });
  pintarInterior(m, d, personal && real);
  $("#md-error").hidden = true;
  $("#md-insert").textContent = d.modo === "original" ? "Insertar como se creó" : real ? "Insertar con este diseño" : "Insertar con estas medidas";
  $("#md-insert").onclick = () => usarModulo(m);
}

// ---- Entrepaños y divisores en «Ajustar este mueble» ---------------------------
/* Fila de la receta con los entrepaños ajustados en este proyecto encima
   (modulos[id].interior = { attr: valor de fila }). */
function filaConInterior(m) {
  const o = S.proyecto.modulos[m.id];
  const fila = (m.receta && m.receta.valores) || {};
  return o && o.personalizado && o.interior ? Object.assign({}, fila, o.interior) : fila;
}

function grupoInterior(man) {
  return man && man.grupos.find((g) => g.visual && g.visual.tipo === "entrepanos");
}

/* Frentes de arriba abajo ({ texto, codigo }): del gráfico de entrepaños
   (gabinete) o, en la alacena y el esquinero, de su tipo de puerta. */
function frentesDe(man, valores) {
  if (man && man.familia === "alacena") return M.frentesAlacena(valores);
  if (man && man.familia === "esquinero") return M.frentesEsquinero(valores);
  const g = grupoInterior(man);
  if (g) return M.resumenFrentes(S.rcc.geomFrentes(man, valores, g.visual));
  return { texto: "", codigo: "" };
}

/* Formulario (solo en memoria) del mueble con su diseño y medidas de este
   proyecto: de ahí salen el gráfico, sus errores y lo que se guarda. */
function regInterior(m, d) {
  const man = S.manifiestos[familiaDe(m)];
  const fc = cfgFamilia(m);
  const valores = RKAvanzado.valoresDesdeFila(man, filaConInterior(m), S.rcc);
  [["LenX", d.ancho], ["LenZ", d.alto], ["LenY", d.fondo]].forEach(([a, v]) => RKAvanzado.poner(man, valores, a, v, S.rcc));
  if (fc && fc.tarja) RKAvanzado.poner(man, valores, fc.tarja.attr, d.tarja ? fc.tarja.si : fc.tarja.no, S.rcc);
  return { familia: familiaDe(m), valores };
}

/* Errores del grupo de entrepaños (choques con cajones, espacios que no caben). */
function erroresInterior(man, g, reg) {
  const ids = g.campos.map((f) => f.id);
  return S.rcc.erroresConfig(man, reg.valores).filter((e) => (e.ids || []).some((id) => ids.includes(id)));
}

function pintarInterior(m, d, editable) {
  const man = S.manifiestos[familiaDe(m)];
  const g = S.rcc && grupoInterior(man);
  const wrap = $("#md-interior-wrap");
  wrap.hidden = !(editable && g && window.RKEntrepanos);
  if (wrap.hidden) return;
  const o = S.proyecto.modulos[m.id];
  const V = g.visual;
  const reg = regInterior(m, d);
  const box = $("#md-interior"), nota = $("#md-interior-note");
  const activo = S.rcc.fieldByAttr(man, V.activo.attr);
  const si = String(V.activo.valor);
  const no = String((activo.opciones.find((x) => String(x.valor) !== si) || {}).valor);
  box.innerHTML = "";
  nota.classList.remove("bad");
  $("#md-interior-reset").hidden = !o.interior;
  $("#md-interior-reset").onclick = () => { delete o.interior; cambioDiseno(m); pintarModulo(); };
  const sw = $("#md-entrepano");
  sw.disabled = !S.rcc.groupEnabled(g, man, reg.valores);
  if (sw.disabled) {
    sw.checked = false;
    nota.textContent = "Este mueble no lleva puertas: no hay entrepaños que acomodar.";
    return;
  }
  let gr = null;
  const refrescar = () => {
    const on = String(reg.valores[activo.id]) === si;
    sw.checked = on;
    // Sin entrepaños no hay nada que acomodar: el gráfico se guarda.
    gr.nodo.hidden = !on;
    if (on) gr.pintar();
    $("#md-interior-reset").hidden = !o.interior;
    const errs = erroresInterior(man, g, reg);
    nota.textContent = errs.length ? errs.map((e) => e.msg).join(" ")
      : on ? "Arrastra una repisa para moverla; clic para cambiar entre entrepaño y divisor. Solo cambia este mueble en este proyecto." : "";
    nota.classList.toggle("bad", errs.length > 0);
  };
  // Se guarda solo lo del grupo, ya como valores de fila: es lo que Ruby aplica a la receta.
  const guardar = () => {
    S.rcc.aplicarForzados(man, reg.valores);
    const fila = S.rcc.flatten(man, reg);
    o.interior = {};
    g.campos.forEach((f) => { if (Object.prototype.hasOwnProperty.call(fila, f.attr)) o.interior[f.attr] = fila[f.attr]; });
    cambioDiseno(m);
    refrescar();
  };
  sw.onchange = () => { reg.valores[activo.id] = sw.checked ? si : no; guardar(); };
  gr = RKEntrepanos.crear(V, man, reg, S.rcc, guardar, null, { alto: 200 });
  box.appendChild(gr.nodo);
  refrescar();
}

/* Distribución de la vista desde las variables de la familia (gabinete,
   alacena o esquinero), o null si la familia no tiene dibujo propio. */
function layoutDe(fam, v, medidas) {
  if (fam === "gabinete") return RKVista.desdeValores(v, medidas);
  if (fam === "alacena") return RKVista.desdeAlacena(v, medidas);
  if (fam === "esquinero") return RKVista.desdeEsquinero(v, medidas);
  return null;
}

// Medidas de la vista en «Avanzado» cuando el campo está vacío.
const MEDIDAS_VISTA = { gabinete: [600, 770], alacena: [800, 700], esquinero: [1000, 770] };

/* Alzado SVG del módulo: con su diseño efectivo, o con las variables de
   «Avanzado» (+avanzado+, familias activas). */
function svgModulo(m, avanzado, enLista) {
  const fam = familiaDe(m);
  if (avanzado && S.av[m.id] && FAMILIAS_ACTIVAS.includes(fam)) {
    const st = S.av[m.id];
    const v = st.reg.valores;
    const [ancho, alto] = MEDIDAS_VISTA[fam];
    const lay = layoutDe(fam, v, { ancho: RKVista.num(v.LenX, ancho), alto: RKVista.num(v.LenZ, alto) });
    // La manija de puertas es el primer attr que mapea su familia (d16_z1… en el gabinete).
    const mp = (((S.opciones.familias || {})[fam] || {}).manija_puerta || {}).attrs || [];
    return RKVista.svg(lay, disenoSvg({ frente: v.l01_linea_frente, manija_puerta: v[mp[0]],
      manija_cajon: v.e01_tirador_tipo, material: st.material }, v.b01_gola_o_tirador === "2", RKReglas.colorGola(S.opciones, golaFam(), "", v)));
  }
  const d = disenoDe(m, enLista);
  const lay = (m.receta && layoutDe(fam, m.receta.valores, { ancho: d.ancho, alto: d.alto, fondo: d.fondo })) ||
    RKVista.desdeEtiquetas(Object.assign({}, m, { specs: Object.assign({}, m.specs, { ancho_mm: d.ancho, alto_mm: d.alto }) }));
  // La gola elegida en el diseño cambia el dibujo aunque la receta no la traiga.
  const gola = golaDe(m, d);
  lay.gola = gola;
  // El esquinero dibuja la gola según su tipo (aluminio o melamina).
  if (lay.esquinero && gola) Object.assign(lay, golaEsquinero(d.gola, m.receta && m.receta.valores));
  return RKVista.svg(lay, disenoSvg(d, gola, colorGolaDe(m, d)));
}

/* Tipo de gola del esquinero para la vista: el de la gola elegida en el
   diseño (golas[].valores) o, sin elección, el de la receta. */
function golaEsquinero(id, valores) {
  const o = RKReglas.golaOpcion(S.opciones, id);
  const tipo = String((o && o.valores && o.valores.g01_perfil_tipo) || (valores && valores.g01_perfil_tipo) || "1");
  return tipo === "2" ? { golaTipo: "2", golaProf: 45 } : { golaTipo: "1", golaProf: 27 };
}

function pintarPreviewModulo(m) {
  if (!m) return;
  // Módulo nuevo / fila CSV: la vista sigue a «Avanzado» (no tiene otro diseño).
  const porAvanzado = !!m._virtual && !!estadoAvanzado(m);
  visor("#md-preview").mostrar(svgModulo(m, porAvanzado), m.id);
  if (S.avAbierto && S.av[m.id]) visor("#av-preview").mostrar(svgModulo(m, true), m.id);
  $("#md-preview-note").textContent = porAvanzado ? "Vista según las variables de «Avanzado»."
    : tieneReceta(m) ? "Así quedará: al insertar se regenera la pieza con este diseño."
    : "Vista previa del diseño. Este módulo del catálogo se inserta con su diseño original (solo cambian las medidas); para fabricarlo con este diseño usa «Avanzado».";
}

// Un visor (zoom + desplazamiento) por contenedor de vista previa.
function visor(sel) {
  return RKVisor.crear($(sel));
}

// ---- Avanzado ------------------------------------------------------------------
function estadoAvanzado(m) {
  if (S.av[m.id]) return S.av[m.id];
  const fam = familiaDe(m);
  const man = S.manifiestos[fam];
  if (!man || !S.rcc) return null;
  let valores, nota;
  if (m.valores) {
    valores = JSON.parse(JSON.stringify(m.valores));
    nota = "Valores de la fila del CSV.";
  } else if (m.receta) {
    valores = RKAvanzado.valoresDesdeFila(man, filaConInterior(m), S.rcc);
    nota = "Valores de la receta de este mueble, con el diseño elegido en «Diseño».";
  } else {
    valores = S.rcc.defaultValores(man);
    nota = "Valores por defecto del manifiesto.";
  }
  const d = disenoDe(m);
  const reg = { familia: fam, titulo: man.titulo, valores, nombre_salida: "" };
  const fc = (S.opciones.familias || {})[fam];
  if (!m._virtual && m._source !== "csv") {
    RKAvanzado.poner(man, valores, "LenX", d.ancho, S.rcc);
    if (m.receta) { RKAvanzado.poner(man, valores, "LenZ", d.alto, S.rcc); RKAvanzado.poner(man, valores, "LenY", d.fondo, S.rcc); }
    if (fc) {
      // La gola elegida (antes que frente y manijas: decide si llevan).
      Object.entries(RKReglas.cambiosGola(S.opciones, fc, d.gola, d.gola_combinacion || "1"))
        .forEach(([a, v]) => RKAvanzado.poner(man, valores, a, v, S.rcc));
      if (fc.frente && d.frente) RKAvanzado.poner(man, valores, fc.frente.attr, d.frente, S.rcc);
      if (fc.tarja && m.receta) RKAvanzado.poner(man, valores, fc.tarja.attr, d.tarja ? fc.tarja.si : fc.tarja.no, S.rcc);
      // Manija de puertas y de cajones, con su posición forzada si la tiene.
      Object.entries(RKReglas.USOS).forEach(([uso, clave]) => {
        const h = fc[clave], id = d[clave];
        const req = h && h.requiere;
        if (!h || !id || (req && String(valores[req.attr]) !== String(req.valor))) return;
        h.attrs.forEach((a) => RKAvanzado.poner(man, valores, a, id, S.rcc));
        const pos = RKReglas.posicion(S.opciones, uso, id);
        if (pos) (h.posicion || []).forEach((a) => RKAvanzado.poner(man, valores, a, pos, S.rcc));
      });
    }
  }
  // Una fila del CSV trae su nombre; lo demás se nombra solo (y se renombra al cambiar la configuración).
  reg.nombre_salida = m._source === "csv" ? m.name : nombreNuevo(man, valores);
  S.av[m.id] = { man, reg, nota, material: m._source === "csv" ? "" : d.material || "", nombreManual: m._source === "csv", csv: m._source === "csv" };
  return S.av[m.id];
}

/* Nombre automático de un mueble nuevo (RKMuebles.nombreNuevo): familia, ancho,
   frentes y un consecutivo que no existe en el catálogo. */
function nombreNuevo(man, valores) {
  const codigo = frentesDe(man, valores).codigo;
  const prefijo = (/^[A-Z]+/.exec(man.nombre_patron || "") || [man.titulo.slice(0, 3)])[0];
  return M.nombreNuevo(prefijo, RKVista.num(valores.LenX, 0), codigo, S.modulos.map((x) => (x.specs && x.specs.sku) || x.name));
}

function pintarAvanzado(m) {
  const st = estadoAvanzado(m);
  const form = $("#av-form");
  // Fila del CSV: aquí solo se edita y se guarda; se genera desde la tabla.
  const csv = S.avCsv && S.avCsv.m === m ? S.avCsv : null;
  $("#av-title").textContent = m.name;
  $("#av-stamp").textContent = csv ? "Editar fila del archivo" : "Configuración avanzada";
  $("#av-publicar").closest("label").hidden = !!csv;
  $("#av-generar").textContent = csv ? "Guardar" : "Generar";
  $("#av-material").hidden = !st;
  if (!st) {
    form.innerHTML = `<p class="empty">${S.rcc ? "Esta familia todavía no tiene manifiesto en Studio" : "No cargó ui/receta.js"}</p>`;
    $("#av-generar").disabled = true;
    return;
  }
  $("#av-note").textContent = st.nota;
  const nombre = $("#av-nombre");
  nombre.value = st.reg.nombre_salida;
  nombre.oninput = () => { st.reg.nombre_salida = nombre.value; st.nombreManual = nombre.value.trim() !== ""; };
  $("#av-publicar").checked = m._source === "csv" || m._source === "nuevo";
  $("#av-reset").onclick = () => { delete S.av[m.id]; if (csv) editarFilaCsv(csv.i); else pintarModulo(); };
  const fc = (S.opciones.familias || {})[st.reg.familia];
  const frenteDe = () => (fc && fc.frente ? st.reg.valores[fc.frente.attr] : "");
  const vista = RKAvanzado.montar(form, st.man, st.reg, S.rcc, (errMotor) => {
    // Las del motor + las de fabricación de Studio (manijas por uso, MDF).
    const errores = errMotor.concat(RKReglas.receta(S.opciones, fc, st.reg.valores));
    const errMat = st.material && RKReglas.material(S.opciones, st.material, frenteDe());
    if (errMat) errores.push({ label: "Material", msg: errMat });
    if (!st.nombreManual) { st.reg.nombre_salida = nombreNuevo(st.man, st.reg.valores); nombre.value = st.reg.nombre_salida; }
    const box = $("#av-errores");
    box.hidden = !errores.length;
    box.innerHTML = errores.map((e) => `<div>• ${esc(e.label ? e.label + ": " : "")}${esc(e.msg)}</div>`).join("");
    $("#av-generar").disabled = errores.length > 0;
    if (csv) visor("#av-preview").mostrar(svgModulo(m, true), m.id);
    else pintarPreviewModulo(m);
  });
  // Material del mueble: no es un campo del manifiesto (lo aplica Studio al
  // generar, a todo el mueble). Sin elegir, «Sin material» (blanco).
  // El espesor de puertas sigue al material (MDF 18, madera 22), como en Ruby.
  const ponerEspesor = () => {
    const mm = fc && fc.espesor_puerta ? RKReglas.espesorPuerta(S.opciones, st.material || SIN_MATERIAL) : null;
    if (mm != null) RKAvanzado.poner(st.man, st.reg.valores, fc.espesor_puerta.attr, mm, S.rcc);
  };
  const pintarMaterial = () => {
    const d = { material: st.material || SIN_MATERIAL, frente: frenteDe() };
    pintarTile($("#av-material"), PICKERS.find((p) => p.key === "material"), d, () => {
      st.material = d.material; ponerEspesor(); pintarMaterial(); vista.refrescar();
    });
  };
  ponerEspesor();
  vista.refrescar();
  pintarMaterial();
  $("#av-generar").onclick = () => (csv ? guardarFilaCsv(csv.i, st) : generarAvanzado(m, st));
}

function payloadGenerar(st, ref, insertar, publicar) {
  const reg = st.reg;
  const nombre = (reg.nombre_salida || "").trim();
  if (!nombre || /[\\/:*?"<>|]/.test(nombre)) return { error: "Escribe un nombre válido (sin \\ / : * ? \" < > |)." };
  return {
    ref, familia: reg.familia, nombre,
    valores: S.rcc.flatten(st.man, reg),
    divisores: S.rcc.nombresDivisores(st.man, reg),
    material: st.material || SIN_MATERIAL,
    // Origen: todo lo que se genera desde Studio (Avanzado o CSV) es del usuario.
    // «Catálogo» es solo lo que agrega el equipo de desarrollo (fichas sin clase).
    clase: "usuario",
    insertar, publicar,
  };
}

/* Lo generado desde «Avanzado» siempre queda en la escena; guardarlo en el
   catálogo es opcional. */
function generarAvanzado(m, st) {
  const publicar = $("#av-publicar").checked;
  const p = payloadGenerar(st, m.id, true, publicar);
  if (p.error) return aviso("Error: " + p.error);
  // Guardar nunca reemplaza un mueble que ya está en el catálogo.
  const existe = publicar && M.choque(p.nombre, S.modulos);
  if (existe) return aviso(`Error: ya existe «${existe.name}» en el catálogo · usa otro nombre para no reemplazarlo`);
  ocupado(true, `Generando ${p.nombre}… (puede tardar unos segundos)`);
  bridge("generar", JSON.stringify(p));
}

// ---- Insertar ------------------------------------------------------------------
/* «Usar»: lo que muestra la tarjeta. Siempre se genera desde el componente
   base: el diseño original es la receta tal cual; con el del proyecto o
   ajustado, la receta con esos cambios. */
function usarModulo(m, enLista) {
  const d = disenoDe(m, enLista);
  insertar(m, d.modo === "original" ? null : d);
}

/* La receta del mueble con la gola elegida, contra las reglas del manifiesto
   (con gola van máximo 2 cajones por zona). Primer error, o "". */
function erroresConGola(m, d) {
  const man = S.manifiestos[familiaDe(m)];
  if (!man || !S.rcc || !m.receta) return "";
  const valores = RKAvanzado.valoresDesdeFila(man, m.receta.valores, S.rcc);
  Object.entries(RKReglas.cambiosGola(S.opciones, cfgFamilia(m), d.gola, d.gola_combinacion || "1"))
    .forEach(([a, v]) => RKAvanzado.poner(man, valores, a, v, S.rcc));
  const e = S.rcc.erroresConfig(man, valores)[0];
  return e ? `${e.label ? e.label + ": " : ""}${e.msg}` : "";
}

/* Lo que se manda a Ruby para generar +m+ con el diseño +d+: { eleccion }, o
   si el diseño no le cabe { aviso } (para la barra de avisos) y, cuando se
   corrige en la página del mueble, { error } (para mostrarlo ahí). */
function eleccionDe(m, d) {
  const eleccion = { ancho: d.ancho, alto: d.alto, fondo: d.fondo };
  if (!tieneReceta(m)) return { eleccion };
  const fc = cfgFamilia(m) || {};
  if (fc.tarja) eleccion.tarja = !!d.tarja;
  if (fc.frente && d.frente) eleccion.frente = d.frente;
  if (fc.gola && d.gola) { eleccion.gola = d.gola; eleccion.gola_combinacion = d.gola_combinacion || "1"; }
  const gola = golaDe(m, d);
  // Con gola: máximo 2 cajones por zona (y lo demás del manifiesto).
  const errGola = d.gola ? erroresConGola(m, d) : "";
  if (errGola) return { aviso: `${m.name}: ${errGola}`, error: errGola };
  Object.values(RKReglas.USOS).forEach((k) => { if (fc[k] && d[k] && !gola) eleccion[k] = d[k]; });
  if (fc.material && d.material) eleccion.material = d.material;
  if (d.modo === "personal" && d.interior) {
    const man = S.manifiestos[familiaDe(m)], g = grupoInterior(man);
    const reg = g && regInterior(m, d);
    const errs = g ? erroresInterior(man, g, reg) : [];
    if (errs.length) return { aviso: "entrepaños de " + m.name + ": " + errs.map((e) => e.msg).join(" ") };
    eleccion.interior = d.interior;
    const div = reg && S.rcc.nombresDivisores(man, reg);
    if (div) eleccion.divisores = div;
  }
  const error = RKReglas.diseno(S.opciones, d, gola);
  if (error) return { aviso: `${m.name}: ${error}. Revísalo en «Configurar».`, error: error + "." };
  return { eleccion };
}

/* +d+ = null: la receta tal cual (diseño original). La escena recuerda con
   qué diseño entró cada mueble (+modo+) para «Aplicar el diseño». */
function insertar(m, d) {
  let eleccion = null;
  if (d) {
    const r = eleccionDe(m, d);
    if (r.error && S.sec === "modulo") {
      const e = $("#md-error");
      e.textContent = r.error;
      e.hidden = false;
      return;
    }
    if (r.aviso) return aviso("Error: " + r.aviso);
    eleccion = r.eleccion;
  }
  ocupado(true, eleccion && tieneReceta(m) ? `Insertando ${m.name} con su diseño… (puede tardar unos segundos)` : `Insertando ${m.name}…`);
  bridge("insertar", JSON.stringify({ id: m.id, eleccion, modo: d ? d.modo : "original" }));
}

/* Por qué el nombre de la fila +i+ pisaría a otro mueble, o "": uno del
   catálogo, o una fila anterior del mismo archivo (se comparan como ids:
   «GAB 600» y «GAB-600» son el mismo). Una fila ya generada no cuenta. */
function csvChoque(i) {
  const c = S.csv, f = c.imp.filas[i];
  if (!f.nombre || (c.hechos[i] && c.hechos[i].estado === "generado")) return "";
  const id = M.idDe(f.nombre);
  const otra = c.imp.filas.findIndex((x, j) => j < i && x.nombre && M.idDe(x.nombre) === id);
  if (otra >= 0) return `Mismo nombre que la fila ${otra + 1} (${c.imp.filas[otra].nombre}): cámbialo en «Editar»`;
  const m = M.choque(f.nombre, S.modulos);
  return m ? `Ya existe «${m.name}» en el catálogo: cámbiale el nombre en «Editar» para no reemplazarlo` : "";
}

// Solo se generan las filas de familias activas (gabinete, alacena y esquinero), sin
// errores, cuyo nombre no pise a otro mueble y que no se hayan generado ya.
function csvUsable(f, i) {
  const hecho = S.csv.hechos[i];
  return f.estado !== "error" && FAMILIAS_ACTIVAS.includes(f.familia) && !(hecho && hecho.estado === "generado") && !csvChoque(i);
}

// ==== CSV ============================================================================
function pintarCsv() {
  const c = S.csv;
  $("#csv-vacio").hidden = !!c;
  $("#csv-tabla-wrap").hidden = !c;
  if (!c) return;
  const imp = c.imp;
  // Una fila que dejó de ser usable (ya se generó, o su nombre ya está en el catálogo) no se queda seleccionada.
  imp.filas.forEach((f, i) => { if (!csvUsable(f, i)) c.sel.delete(i); });
  const ok = imp.filas.filter(csvUsable).length;
  $("#csv-resumen").textContent = `${imp.filas.length} filas · ${ok} por generar · ${Object.values(c.hechos).filter((h) => h.estado === "generado").length} generadas · ${c.sel.size} seleccionadas`;
  $("#csv-generar").disabled = !c.sel.size || !!c.cola;
  $("#csv-quitar").disabled = !!c.cola;
  const t = $("#csv-tabla");
  t.innerHTML = "<thead><tr><th></th><th>Nombre</th><th>Mueble</th><th>Medidas (mm)</th><th>Diseño</th><th>Estado</th><th>Avisos y errores</th><th></th></tr></thead>";
  const tb = document.createElement("tbody");
  imp.filas.forEach((f, i) => {
    const man = S.manifiestos[f.familia];
    const msgs = [f.error].concat(Object.values(f.errores || {})).filter(Boolean);
    const hecho = c.hechos[i];
    const choque = csvChoque(i);
    const estado = hecho ? hecho.estado : !FAMILIAS_ACTIVAS.includes(f.familia) ? "pendiente" : choque ? "error" : f.estado;
    const det = detalleFila(f, man);
    const notas = estado === "pendiente" ? ["Esta familia todavía no se genera en Studio"] : hecho && hecho.msg ? [hecho.msg] : [choque].concat(msgs, f.avisos || []).filter(Boolean);
    const tr = document.createElement("tr");
    tr.className = "st-" + estado;
    tr.innerHTML = `<td><input type="checkbox" ${c.sel.has(i) ? "checked" : ""} ${csvUsable(f, i) ? "" : "disabled"}></td>` +
      `<td><b>${esc(f.nombre || "—")}</b>${f.editada ? `<span class="pj-sub">Editada aquí</span>` : ""}</td>` +
      `<td>${esc(man ? man.titulo : f.familia || "—")}<span class="pj-sub">${esc(det.frentes)}</span></td>` +
      `<td class="mono">${esc(det.medidas || "—")}</td>` +
      `<td>${esc(det.diseno || "—")}<span class="pj-sub">${esc(det.material)}</span></td>` +
      `<td><span class="pill">${esc({ ok: "Lista", aviso: "Con avisos", error: "Error", generado: "Generada", fallo: "Falló", pendiente: "No disponible" }[estado] || estado)}</span></td>` +
      `<td class="msgs" title="${esc(notas.join("\n"))}">${esc(notas.slice(0, 2).join(" · ") || "—")}${notas.length > 2 ? ` <b>+${notas.length - 2}</b>` : ""}</td>` +
      `<td><button class="key sm" ${f.valores && estado !== "pendiente" && !c.cola ? "" : "disabled"}>Editar</button></td>`;
    $("input", tr).onchange = (e) => { e.target.checked ? c.sel.add(i) : c.sel.delete(i); pintarCsv(); };
    $("button", tr).onclick = () => editarFilaCsv(i);
    tb.appendChild(tr);
  });
  t.appendChild(tb);
}

/* Lo más relevante de una fila para la tabla: frentes, medidas y diseño. */
function detalleFila(f, man) {
  const out = { frentes: "", medidas: "", diseno: "", material: "" };
  const v = f.valores;
  if (!man || !v || !S.rcc) return out;
  const etiqueta = (attr) => {
    const campo = S.rcc.fieldByAttr(man, attr);
    const o = campo && (campo.opciones || []).find((x) => String(x.valor) === String(v[campo.id]));
    return o ? o.label : "";
  };
  out.frentes = frentesDe(man, v).texto;
  out.medidas = ["LenX", "LenZ", "LenY"].map((a) => RKVista.num(v[a], 0)).filter((n) => n > 0).join(" × ");
  const fc = (S.opciones.familias || {})[f.familia] || {};
  // Tirador o gola, con el nombre corto del catálogo (manifest.catalogo.caracteristicas.tipo).
  const tipo = (((man.catalogo || {}).caracteristicas || {}).tipo || [])[0];
  const campoTipo = tipo && S.rcc.fieldByAttr(man, tipo.attr);
  const apertura = campoTipo && tipo.valores ? tipo.valores[String(v[campoTipo.id])] || "" : "";
  out.diseno = [apertura, fc.frente ? etiqueta(fc.frente.attr) : ""].filter(Boolean).join(" · ");
  out.material = f.material ? (opcion("material", f.material) || {}).nombre || f.material : "";
  return out;
}

/* «Editar» una fila: abre «Avanzado» sobre una copia de sus valores. Ahí solo se
   guarda (vuelve a la tabla); generar es siempre desde la tabla. */
function editarFilaCsv(i) {
  const f = S.csv.imp.filas[i];
  const man = S.manifiestos[f.familia];
  if (!man || !f.valores) return;
  const m = { id: "csv-" + i, name: f.nombre, category: man.titulo, familia: f.familia, _source: "csv", _virtual: true, specs: {}, features: {} };
  S.av[m.id] = { man, csv: true, nombreManual: true, material: f.material || "",
    nota: `Fila ${i + 1} del archivo. Los cambios se guardan en la tabla; el mueble se genera desde ahí.`,
    reg: { familia: f.familia, titulo: man.titulo, valores: JSON.parse(JSON.stringify(f.valores)), nombre_salida: f.nombre } };
  S.avCsv = { i, m };
  $("#avanzado").hidden = false;
  pintarAvanzado(m);
}

function guardarFilaCsv(i, st) {
  const c = S.csv, f = c.imp.filas[i];
  const nombre = (st.reg.nombre_salida || "").trim();
  if (!nombre || /[\\/:*?"<>|]/.test(nombre)) return aviso("Error: escribe un nombre válido (sin \\ / : * ? \" < > |)");
  const otra = c.imp.filas.find((x, j) => j !== i && x.nombre && M.idDe(x.nombre) === M.idDe(nombre));
  if (otra) return aviso(`Error: la fila «${otra.nombre}» ya usa ese nombre`);
  const existe = M.choque(nombre, S.modulos);
  if (existe) return aviso(`Error: ya existe «${existe.name}» en el catálogo · usa otro nombre para no reemplazarlo`);
  // «Guardar» solo se deja con la configuración sin errores: la fila queda lista.
  f.nombre = nombre;
  f.valores = st.reg.valores;
  f.material = st.material || "";
  f.error = null;
  f.errores = {};
  f.avisos = S.rcc.avisosConfig(st.man, f.valores);
  f.estado = f.avisos.length ? "aviso" : "ok";
  f.editada = true;
  delete c.hechos[i];
  c.sel.add(i);
  delete S.av[S.avCsv.m.id];
  S.avCsv = null;
  $("#avanzado").hidden = true;
  aviso(`${nombre}: fila guardada · genérala desde la tabla`);
  pintarCsv();
}

/* «Quitar archivo»: la sección vuelve a como estaba antes de importar. Lo ya
   generado sigue en el catálogo; lo editado aquí y no generado se pierde, así
   que eso se pregunta antes. */
function csvQuitar() {
  const c = S.csv;
  if (!c || c.cola) return;
  const quitar = () => {
    if (S.avCsv) { delete S.av[S.avCsv.m.id]; S.avCsv = null; $("#avanzado").hidden = true; }
    S.csv = null;
    $("#csv-progreso").hidden = true;
    pintarCsv();
  };
  const pendientes = c.imp.filas.filter((f, i) => f.editada && !(c.hechos[i] && c.hechos[i].estado === "generado")).length;
  if (!pendientes) return quitar();
  preguntar("Quitar el archivo",
    `${pendientes === 1 ? "Hay 1 fila editada" : `Hay ${pendientes} filas editadas`} aquí que no se ${pendientes === 1 ? "ha" : "han"} generado. Al quitar el archivo esos cambios se pierden; el archivo original no se toca.`, [
      ["key", "Cancelar", null],
      ["use", "Quitar archivo", quitar],
    ]);
}

function csvGenerar() {
  const c = S.csv;
  if (!c || !c.sel.size || !S.rcc) return;
  c.cola = [...c.sel].sort((a, b) => a - b);
  c.total = c.cola.length;
  c.guardar = $("#csv-guardar").checked;
  csvSiguiente(null);
}

function csvSiguiente(res) {
  const c = S.csv;
  if (res && c.actual != null) {
    c.hechos[c.actual] = res.ok ? { estado: "generado", msg: (res.avisos || []).slice(0, 2).join(" · ") } : { estado: "fallo", msg: res.error };
  }
  const pr = $("#csv-progreso");
  if (!c.cola.length) {
    c.cola = null; c.actual = null;
    pr.hidden = true;
    ocupado(false);
    const n = Object.values(c.hechos).filter((h) => h.estado === "generado").length;
    aviso(`CSV: ${n} ${n === 1 ? "mueble insertado" : "muebles insertados"} en la escena${c.guardar ? " y guardados en el catálogo" : ""}`);
    bridge("recargar");
    pintarCsv();
    return;
  }
  const i = c.cola.shift();
  c.actual = i;
  const f = c.imp.filas[i];
  const hechos = c.total - c.cola.length - 1;
  pr.hidden = false;
  $("i", pr).style.width = `${Math.round((hechos / c.total) * 100)}%`;
  $("span", pr).textContent = `${hechos + 1} de ${c.total} · ${f.nombre}`;
  const st = { man: S.manifiestos[f.familia], reg: { familia: f.familia, valores: f.valores, nombre_salida: f.nombre }, material: f.material || "", csv: true };
  // Siempre a la escena; al catálogo solo si se pidió (como creado por el usuario).
  const p = payloadGenerar(st, "csv-" + i, true, !!c.guardar);
  if (p.error) return csvSiguiente({ ok: false, error: p.error });
  ocupado(true, `Generando ${hechos + 1} de ${c.total}: ${f.nombre}`);
  pintarCsv();
  bridge("generar", JSON.stringify(p));
}

// ==== Proyectos: registro ========================================================
const P = window.RKProyectos;
const esPlaneacion = () => S.usuario.rol === "planeacion";
const nombreEstado = (id) => P.nombreEstado(S.estados, id);
const pillEstado = (id) => `<span class="pill e-${esc(id)}">${esc(nombreEstado(id))}</span>`;

function pintarProyectos() {
  pintarActual();
  $("#pj-stamp").textContent = esPlaneacion() ? "Registro · Planeación" : "Registro · Diseño";
  // Todos ven primero todos los proyectos; «Mis proyectos» filtra los propios.
  if (!S.pj.alcance) S.pj.alcance = "todos";
  pintarSeg($("#pj-alcance"), [["todos", "Todos"], ["mios", "Mis proyectos"]], S.pj.alcance, (v) => {
    S.pj.alcance = v; pintarProyectos();
  });
  const chips = $("#pj-estados");
  chips.innerHTML = "";
  [[null, "Todos los estados"]].concat(S.estados).forEach(([id, txt]) => {
    const b = document.createElement("button");
    b.className = "chip" + (S.pj.estado === id ? " active" : "");
    b.textContent = txt;
    b.onclick = () => { S.pj.estado = id; pintarProyectos(); };
    chips.appendChild(b);
  });
  $("#pj-offline").hidden = S.pj.disponible;
  $("#pj-nuevo").disabled = !S.pj.disponible || esPlaneacion();
  pintarTablaProyectos();
}

function pintarTablaProyectos() {
  const ahora = new Date();
  const lista = P.ordenar(P.filtrar(S.pj.lista, { q: S.pj.q, alcance: S.pj.alcance, usuario: S.usuario.usuario, estado: S.pj.estado }));
  const t = $("#pj-tabla");
  if (!lista.length) {
    const vacio = S.pj.lista.length ? "Ningún proyecto coincide con el filtro" :
      (esPlaneacion() ? "Todavía no hay proyectos registrados" : "Crea tu primer proyecto con «+ Nuevo proyecto»");
    t.innerHTML = `<tbody><tr><td><p class="empty">${esc(vacio)}</p></td></tr></tbody>`;
    return;
  }
  t.innerHTML = "<thead><tr><th>Vista previa</th><th>Folio · cliente</th><th>Diseñadora</th><th>Estado</th><th>Última actualización</th><th>Versión</th><th></th></tr></thead>";
  const tb = document.createElement("tbody");
  lista.forEach((p) => {
    const tr = document.createElement("tr");
    const d = p.disenadora || {}, a = p.actualizado || {};
    const cand = P.candado(p.candado, S.usuario.usuario, ahora);
    const comp = P.compromiso(p.fecha_compromiso, ahora);
    const cerrado = ["planeacion", "fabricacion", "entregado"].includes(p.estado);
    tr.className = p.folio === S.actual.folio ? "is-actual" : "";
    tr.innerHTML =
      `<td><img class="pj-mini" alt=""></td>` +
      `<td><span class="pj-folio">${esc(p.folio)}</span><span class="pj-sub">${esc(p.cliente || "Sin cliente")}</span>` +
        (comp ? `<span class="pj-sub ${comp.vencida && p.estado !== "entregado" ? "bad" : ""}">Compromiso ${esc(comp.texto)}</span>` : "") + "</td>" +
      `<td>${esc(d.nombre || d.usuario || "—")}<span class="pj-sub">${esc(d.sede || "")}</span></td>` +
      `<td><div class="pj-flags">${pillEstado(p.estado)}` +
        (p.cambio_sin_revisar ? `<span class="pill bad">Cambio sin revisar</span>` : "") +
        (p.cambios_tras_congelar && cerrado ? `<span class="pill aviso">Cambio sin enviar</span>` : "") + "</div></td>" +
      `<td>${esc(a.nombre || "—")}<span class="pj-sub" title="${esc(P.fecha(a.fecha))}">${esc(P.haceCuanto(a.fecha, ahora))}` +
        `${a.nota ? " · " + esc(a.nota) : ""}</span></td>` +
      `<td><span class="pj-folio">v${esc(p.version_actual)}</span>` +
        (p.version_congelada ? `<span class="pj-sub">Congelada v${esc(p.version_congelada)}</span>` : "") + "</td>" +
      `<td><div class="pj-flags">${cand ? `<span class="pill ${cand.propio ? "ok" : "aviso"}">${esc(cand.texto)}</span>` : ""}` +
        `<button class="use sm">${esPlaneacion() ? "Ver" : "Abrir"}</button></div></td>`;
    setImg($("img", tr), p.miniatura ? fileURL(p.miniatura) + "?v=" + p.version_actual : "", placeholder("sin vista", "#e4e7e7"));
    tr.onclick = () => abrirFicha(p.folio);
    $("button", tr).onclick = (e) => { e.stopPropagation(); abrirProyecto(p.folio, esPlaneacion()); };
    tb.appendChild(tr);
  });
  t.appendChild(tb);
}

// Barra del proyecto abierto (arriba de la lista).
function pintarActual() {
  const box = $("#pj-actual");
  const a = S.actual;
  box.className = "";
  box.innerHTML = "";
  if (!a.folio) return;
  const s = P.sincronia(a);
  const reg = a.registro || {};
  box.className = "pj-actual" + (a.sincronia === "conflicto" ? " bad" : "");
  let txt = `${reg.cliente ? esc(reg.cliente) + " · " : ""}versión ${esc(a.version_base)}`;
  if (a.modo === "consulta") txt = "Copia de consulta: los cambios no se suben al proyecto.";
  if (a.sincronia === "conflicto" && a.conflicto) {
    txt = `${esc(a.conflicto.por || "Otra persona")} subió la versión ${esc(a.conflicto.remota)} mientras trabajabas. ` +
      `Tu trabajo quedó guardado como v${esc(a.conflicto.v)} (conflicto). ¿Con cuál sigues?`;
  }
  box.innerHTML = `<div class="grow"><span class="stamp">Proyecto abierto</span><strong>${esc(a.folio)}</strong><span class="hint">${txt}</span></div>` +
    `<span class="pill ${s.clase}">${esc(s.texto)}</span>`;
  const boton = (cls, texto, fn) => {
    const b = document.createElement("button");
    b.className = cls; b.textContent = texto; b.onclick = fn;
    box.appendChild(b);
  };
  if (a.sincronia === "conflicto") {
    boton("key sm", "Quedarme con la del proyecto", () => resolverConflicto("servidor"));
    boton("use sm", "Usar la mía", () => resolverConflicto("mia"));
  }
  boton("key sm", "Ficha", () => abrirFicha(a.folio));
  if (a.sincronia !== "conflicto") boton("use sm", "Entrar al proyecto →", () => irA("proyecto"));
}

/* Volver a la lista de proyectos: flecha y texto, que se lea como navegación. */
const BOTON_VOLVER = '<button class="tb-volver" id="tb-volver" title="Volver a la lista de proyectos">' +
  '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>' +
  '<span><small>Volver a</small>Proyectos</span></button>';

/* Barra superior: en el inicio, el título; dentro de un proyecto, volver a la
   lista + folio, cliente, estado y sincronía. Siempre: quién entró. */
function pintarBarra() {
  const a = S.actual, en = dentro() && a.folio;
  const libre = dentro() && !a.folio && S.libre;
  $("#tb-tabs").hidden = !(en || libre);
  const ctx = $("#tb-ctx");
  if (libre) {
    ctx.innerHTML = `${BOTON_VOLVER}` +
      `<div class="tb-pj"><strong>Solo la escena</strong><span class="hint">Sin proyecto: nada se registra</span></div>` +
      (esPlaneacion() ? "" : `<button class="key sm" id="tb-como-proyecto">Guardar como proyecto…</button>`);
    $("#tb-volver").onclick = () => irA("proyectos");
    if (!esPlaneacion()) $("#tb-como-proyecto").onclick = () => { usarModeloActual = "1"; abrirCrear(); };
  } else if (en) {
    const reg = a.registro || {}, s = P.sincronia(a);
    ctx.innerHTML = `${BOTON_VOLVER}` +
      `<div class="tb-pj"><strong>${esc(a.folio)}</strong><span class="hint">${esc(reg.cliente || "Sin cliente")}</span></div>` +
      (reg.estado ? pillEstado(reg.estado) : "") + (s ? `<span class="pill ${s.clase}">${esc(s.texto)}</span>` : "");
    $("#tb-volver").onclick = () => irA("proyectos");
  } else if (S.sec === "ajustes") {
    ctx.innerHTML = `${BOTON_VOLVER}<span class="tb-titulo">Ajustes</span>`;
    $("#tb-volver").onclick = () => irA("proyectos");
  } else {
    ctx.innerHTML = ""; // inicio: la sección ya dice «Proyectos»
  }
  $("#tb-guardar").hidden = !(en && a.modo === "edicion" && a.sincronia !== "conflicto");
  const u = S.usuario;
  $("#tb-quien").innerHTML = `<strong>${esc(u.nombre || u.usuario)}</strong>` +
    `<span>${esPlaneacion() ? "Planeación" : "Diseño"}${u.sede ? " · " + esc(u.sede) : ""}</span>`;
}

// ---- Login (prototipo: cualquier correo y contraseña) --------------------------
function mostrarLogin() {
  cerrarHojas();
  ["#avanzado", "#picker"].forEach((s) => { $(s).hidden = true; });
  $("#app").hidden = true;
  $("#login").hidden = false;
  // Al entrar bien Ruby no responde onLogin (manda el estado): sin esto,
  // después de «Salir» el botón seguiría apagado.
  $("#login-entrar").disabled = false;
  if (!S.loginRol) S.loginRol = S.usuario.rol || "diseno";
  pintarSeg($("#login-rol"), [["diseno", "Diseño"], ["planeacion", "Planeación"]], S.loginRol, (v) => {
    S.loginRol = v; mostrarLogin();
  });
  const c = $("#login-correo");
  if (!c.value && S.usuario.correo) c.value = S.usuario.correo;
  (c.value ? $("#login-password") : c).focus();
}

function errorLogin(msg) {
  $("#login-error").hidden = !msg;
  $("#login-error").textContent = msg || "";
}

$("#login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const correo = $("#login-correo").value.trim(), password = $("#login-password").value;
  const err = !correo ? "Escribe tu correo." : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo) ? "Ese correo no parece válido."
    : !password ? "Escribe tu contraseña." : "";
  errorLogin(err);
  if (err) return;
  $("#login-entrar").disabled = true;
  $("#login-password").value = "";
  S.pj.alcance = null;
  bridge("sesion_iniciar", JSON.stringify({ correo, password, rol: S.loginRol }));
});

function guardarConNota() {
  preguntar("Guardar versión", "Describe el cambio para que Planeación sepa qué se movió (opcional).", [
    ["key", "Cancelar", null],
    ["use", "Guardar y subir", (nota) => bridge("proyecto_subir", nota)],
  ], "Ej. cambié la tarja a la isla");
}

function resolverConflicto(usar) {
  const txt = usar === "mia"
    ? "Tu versión se vuelve la vigente. La que subió la otra persona queda en el historial."
    : "Se descarta lo que tienes en esta PC y se abre la versión vigente. Tu trabajo sigue en el historial como copia de conflicto.";
  preguntar(usar === "mia" ? "Usar mi versión" : "Usar la del proyecto", txt, [
    ["key", "Cancelar", null],
    ["use", "Continuar", () => { ocupado(true, "Sincronizando…"); bridge("proyecto_resolver", JSON.stringify({ folio: S.actual.folio, usar })); }],
  ]);
}

function abrirProyecto(folio, soloLectura, extra) {
  if (folio === S.actual.folio && !extra && (S.actual.modo === "edicion") === !soloLectura) { cerrarHojas(); return irA("proyecto"); }
  if (soloLectura) ocupado(true, "Descargando copia de consulta…");
  else ocupado(true, "Abriendo proyecto…");
  bridge("proyecto_abrir", JSON.stringify(Object.assign({ folio, solo_lectura: !!soloLectura }, extra || {})));
}

function preguntarCandado(r) {
  const c = r.candado || {};
  preguntar("Proyecto en uso",
    `${c.nombre || c.usuario} lo tiene abierto desde ${P.fecha(c.desde)}. Si lo editan los dos, una de las versiones quedará como conflicto.`, [
      ["key", "Cancelar", null],
      ["key", "Abrir de todos modos", () => abrirProyecto(r.folio, false, { forzar: true })],
      ["use", "Abrir solo lectura", () => abrirProyecto(r.folio, true)],
    ]);
}

// ---- Ficha del proyecto ----------------------------------------------------------
const CAMPOS_PROYECTO = [
  ["cliente", "Cliente", "text"], ["fecha_compromiso", "Fecha compromiso", "date"], ["notas", "Notas / áreas (cocina, closet, baño…)", "textarea"],
];

const CANDADO = '<svg class="candado" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

/* Sin +editable+ los campos se muestran como datos (placa levantada con
   candado), no como cajas para escribir deshabilitadas. */
function formCampos(box, campos, valores, editable) {
  box.innerHTML = "";
  if (!editable) {
    campos.forEach(([k, label, tipo, opciones]) => {
      const v = valores[k] == null ? "" : String(valores[k]);
      const op = tipo === "select" && opciones.find(([o]) => o === v);
      const texto = op ? op[1] : (tipo === "date" && v ? P.compromiso(v, new Date()).texto : v);
      const d = document.createElement("div");
      d.className = "field" + (tipo === "textarea" ? " full" : "");
      d.innerHTML = `<span class="field-label">${esc(label)}</span><span class="dato-val bloq" title="Solo lectura">${CANDADO}${esc(texto || "—")}</span>`;
      box.appendChild(d);
    });
    return;
  }
  campos.forEach(([k, label, tipo, opciones]) => {
    const l = document.createElement("label");
    l.className = "field" + (tipo === "textarea" ? " full" : "");
    let ctl;
    if (tipo === "textarea") ctl = `<textarea data-k="${k}"></textarea>`;
    else if (tipo === "select") ctl = `<select data-k="${k}">${opciones.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("")}</select>`;
    else ctl = `<input data-k="${k}" type="${tipo}" autocomplete="off">`;
    l.innerHTML = `<span class="field-label">${esc(label)}</span>${ctl}`;
    const el = $("[data-k]", l);
    el.value = valores[k] == null ? "" : valores[k];
    el.disabled = !editable;
    box.appendChild(l);
  });
}

function leerCampos(box) {
  const out = {};
  $$("[data-k]", box).forEach((el) => { out[el.dataset.k] = el.value; });
  return out;
}

function abrirFicha(folio) {
  S.pj.detalle = null;
  $("#pf-title").textContent = folio;
  $("#pj-ficha").hidden = false;
  ocupado(true, "Leyendo proyecto…");
  bridge("proyecto_detalle", folio);
}

function pintarFicha() {
  const r = S.pj.detalle;
  if (!r || $("#pj-ficha").hidden) return;
  const ahora = new Date();
  $("#pf-title").textContent = `${r.folio}${r.cliente ? " · " + r.cliente : ""}`;
  $("#pf-stamp").textContent = `Diseñó ${(r.disenadora || {}).nombre || "—"}${(r.disenadora || {}).sede ? " · " + r.disenadora.sede : ""}`;
  $("#pf-estado").className = "pill e-" + r.estado;
  $("#pf-estado").textContent = nombreEstado(r.estado);
  // La misma imagen que la lista (la de la lista sirve si el detalle no la trae).
  const enLista = S.pj.lista.find((p) => p.folio === r.folio) || {};
  const mini = r.miniatura || enLista.miniatura;
  setImg($("#pf-mini"), mini ? fileURL(mini) + "?v=" + r.version_actual : "", placeholder("sin vista", "#e4e7e7"));

  const cand = P.candado(r.candado, S.usuario.usuario, ahora);
  const avisos = [];
  if (cand && !cand.propio) avisos.push(cand.texto + ".");
  if (r.cambio_sin_revisar) avisos.push(`Cambio enviado (v${r.version_congelada}) sin confirmar por Planeación.`);
  if (r.cambios_tras_congelar) avisos.push(`Hay cambios después de la versión congelada (v${r.version_congelada}); fábrica trabaja con la congelada hasta que se envíe el cambio.`);
  if ((r.local || {}).pendiente) avisos.push("Esta PC tiene cambios sin subir de este proyecto.");
  $("#pf-aviso").hidden = !avisos.length;
  $("#pf-aviso").textContent = avisos.join(" ");

  const editable = S.pj.disponible;
  formCampos($("#pf-datos"), CAMPOS_PROYECTO, r, editable);
  $("#pf-guardar-datos").disabled = !editable;
  $("#pf-guardar-datos").onclick = () => {
    ocupado(true, "Guardando…");
    bridge("proyecto_datos", JSON.stringify(Object.assign({ folio: r.folio }, leerCampos($("#pf-datos")))));
  };

  // Línea de pasos: dónde va el proyecto.
  const iActual = S.estados.findIndex(([id]) => id === r.estado);
  $("#pf-pasos").innerHTML = S.estados.map(([id, txt], i) =>
    `<li class="${i < iActual ? "hecho" : i === iActual ? "actual" : ""}"><span>${esc(txt)}</span></li>`).join("");

  // Un paso adelante (botón principal) y, si aplica, uno atrás; las reglas
  // vienen de Ruby y Ruby las vuelve a validar.
  const acc = P.acciones(r, S.pasos, S.usuario.rol);
  const box = $("#pf-acciones");
  box.innerHTML = "";
  acc.forEach((x) => {
    const b = document.createElement("button");
    b.className = (x.principal ? "use" : "key") + " sm";
    b.textContent = x.etiqueta;
    b.disabled = !editable || !!x.bloqueado;
    if (x.bloqueado) b.title = "Primero confirma que recibiste el cambio";
    b.onclick = () => darPaso(r, x);
    box.appendChild(b);
  });
  $("#pf-estado-hint").textContent = acc.length ? "" : r.estado === "entregado" ? "Proyecto entregado: ya no se envían cambios."
    : esPlaneacion() ? "Diseño todavía no lo envía a planeación."
    : "Lo tiene Planeación. Si el cliente pide un cambio: ábrelo, haz el cambio y guarda; aquí aparecerá «Enviar cambio a planeación».";
  $("#pf-estado-hint").hidden = !!acc.length;

  const ev = $("#pf-eventos");
  ev.innerHTML = "";
  (r.eventos || []).slice().reverse().forEach((e) => {
    const row = document.createElement("div");
    row.className = "mini-row";
    const que = P.movimiento(e, S.estados);
    row.innerHTML = `<div class="pf-ev"><b>${esc(que)}</b><span class="hint">${esc(e.por || "")} · ${esc(P.fecha(e.fecha))}${e.nota ? " · " + esc(e.nota) : ""}</span></div>`;
    ev.appendChild(row);
  });

  if (!ev.children.length) ev.innerHTML = "<p class='hint'>Sin movimientos.</p>";

  // Versiones: una tarjeta por registro, igual que los movimientos.
  const vt = $("#pf-versiones");
  const hist = (r.historial || []).slice().sort((x, y) => y.v - x.v);
  vt.innerHTML = "";
  hist.forEach((h) => {
    const row = document.createElement("div");
    row.className = "mini-row";
    const marcas = [h.v === r.version_actual ? "<span class='pill ok'>Vigente</span>" : "",
      h.v === r.version_aprobada ? "<span class='pill e-aprobado'>Aprobada</span>" : "",
      h.congelada ? "<span class='pill info'>Congelada</span>" : "",
      h.conflicto ? "<span class='pill bad'>Conflicto</span>" : ""].join(" ");
    row.innerHTML = `<div class="pf-ev"><b><span class="pj-folio">v${esc(h.v)}</span> ${marcas}</b>` +
      `<span class="hint">${esc(h.por || "")} · ${esc(P.fecha(h.fecha))}${h.nota ? " · " + esc(h.nota) : ""}</span></div>` +
      `<button class="key sm">Abrir</button>`;
    $("button", row).onclick = () => abrirProyecto(r.folio, true, { version: h.v });
    $("button", row).disabled = !editable;
    vt.appendChild(row);
  });
  if (!hist.length) vt.innerHTML = "<p class='hint'>Aún no hay versiones.</p>";
  [ev, vt].forEach(marcarDesborde);

  $("#pf-pie").textContent = `Actualizado por ${(r.actualizado || {}).nombre || "—"} · ${P.fecha((r.actualizado || {}).fecha)}`;
  $("#pf-abrir").disabled = !r.version_actual && !(r.local || {}).pendiente;
  $("#pf-abrir").onclick = () => abrirProyecto(r.folio, false);
  $("#pf-consulta").disabled = !editable || !r.version_actual;
  $("#pf-consulta").textContent = r.version_congelada && esPlaneacion() ? `Abrir congelada v${r.version_congelada}` : "Abrir solo lectura";
  $("#pf-consulta").onclick = () => abrirProyecto(r.folio, true, r.version_congelada && esPlaneacion() ? { version: r.version_congelada } : {});
}

/* Marco con desplazamiento: «arriba»/«abajo» encienden el desvanecido de ese
   borde para que se note que hay más registros sin que se vean cortados. */
function marcarDesborde(s) {
  const m = s.parentElement;
  m.classList.toggle("arriba", s.scrollTop > 2);
  m.classList.toggle("abajo", s.scrollTop + s.clientHeight < s.scrollHeight - 2);
}
$$(".pf-scroll").forEach((s) => s.addEventListener("scroll", () => marcarDesborde(s), { passive: true }));
window.addEventListener("resize", () => $$(".pf-scroll").forEach(marcarDesborde));

/* Cada paso se confirma en una pregunta con nota (obligatoria al regresar o
   al enviar un cambio): un clic suelto ya no mueve el proyecto. */
function darPaso(r, x, notaPrevia) {
  if (x.tipo === "recibido") {
    ocupado(true, "Guardando…");
    return bridge("proyecto_recibido", JSON.stringify({ folio: r.folio }));
  }
  const texto = x.confirmar || (x.atras ? "Explica en la nota qué hay que cambiar." : `El proyecto pasa a «${nombreEstado(x.a)}».`);
  preguntar(x.etiqueta, texto, [
    ["key", "Cancelar", null],
    [x.atras ? "key" : "use", x.atras ? x.etiqueta : "Confirmar", (nota) => {
      if (x.nota && !nota) {
        aviso(x.tipo === "cambio" ? "Error: escribe qué cambió y por qué" : "Error: escribe en la nota qué hay que cambiar");
        return darPaso(r, x);
      }
      ocupado(true, x.tipo === "cambio" ? "Enviando cambio…" : "Cambiando estado…");
      if (x.tipo === "cambio") bridge("proyecto_cambio", JSON.stringify({ folio: r.folio, nota }));
      else bridge("proyecto_estado", JSON.stringify({ folio: r.folio, a: x.a, nota }));
    }],
  ], x.nota ? (x.tipo === "cambio" ? "Qué cambió y por qué (obligatorio)" : "Qué hay que cambiar (obligatorio)") : "Nota (opcional)");
}

// ---- Nuevo proyecto ------------------------------------------------------------------
let usarModeloActual = "1";
function abrirCrear() {
  if (!S.usuario.nombre) return aviso("Error: primero escribe tu nombre");
  formCampos($("#pc-form"), [["folio", "Folio / número de pedido", "text"]].concat(CAMPOS_PROYECTO), {}, true);
  pintarModeloCrear();
  $("#pc-error").hidden = true;
  $("#pj-crear").hidden = false;
  $("[data-k=folio]", $("#pc-form")).focus();
}
// Cambiar de modelo solo repinta la elección: lo ya escrito se queda.
function pintarModeloCrear() {
  pintarSeg($("#pc-modelo"), [["1", "Usar el modelo abierto"], ["0", "Empezar con un modelo vacío"]], usarModeloActual, (v) => {
    usarModeloActual = v; pintarModeloCrear();
  });
}

$("#pc-crear").onclick = () => {
  const datos = leerCampos($("#pc-form"));
  const folio = datos.folio.trim();
  const err = !folio ? "Escribe el folio del proyecto."
    : S.pj.lista.some((p) => String(p.folio).toLowerCase() === folio.toLowerCase()) ? `Ya existe un proyecto con el folio «${folio}».` : "";
  $("#pc-error").hidden = !err;
  $("#pc-error").textContent = err;
  if (err) return;
  ocupado(true, "Creando proyecto y subiendo la primera versión…");
  bridge("proyecto_crear", JSON.stringify({ datos, usar_modelo_actual: usarModeloActual === "1" }));
};

// ---- Usuario de esta PC ------------------------------------------------------------
function pintarFormUsuario() {
  $$("[data-form=usuario]").forEach((box) => {
    formCampos(box, [["nombre", "Tu nombre", "text"], ["sede", "Sede / sucursal", "text"],
      ["rol", "Rol", "select", [["diseno", "Diseño"], ["planeacion", "Planeación"]]]], S.usuario, true);
  });
}
$$("[data-guardar-usuario]").forEach((b) => {
  b.onclick = () => {
    const box = $("[data-form=usuario]", b.closest(".plate"));
    const u = leerCampos(box);
    if (!u.nombre.trim()) return aviso("Error: escribe tu nombre");
    S.pj.alcance = null;
    bridge("usuario_guardar", JSON.stringify(u));
    aviso("Usuario guardado");
  };
});

// ---- Pregunta genérica ---------------------------------------------------------------
/* botones: [[clase, texto, fn(valorInput) | null]] */
function preguntar(titulo, texto, botones, placeholderInput) {
  $("#pq-title").textContent = titulo;
  $("#pq-texto").textContent = texto;
  const inp = $("#pq-input");
  inp.hidden = placeholderInput === undefined;
  inp.value = "";
  inp.placeholder = placeholderInput || "";
  const pie = $("#pq-botones");
  pie.innerHTML = "";
  botones.forEach(([cls, txt, fn]) => {
    const b = document.createElement("button");
    b.className = cls; b.textContent = txt;
    b.onclick = () => { $("#pregunta").hidden = true; if (fn) fn(inp.value.trim()); };
    pie.appendChild(b);
  });
  $("#pregunta").hidden = false;
  if (!inp.hidden) inp.focus();
}

function cerrarHojas() {
  ["#pj-ficha", "#pj-crear", "#pregunta"].forEach((s) => { $(s).hidden = true; });
}

// ==== Ajustes ===================================================================
function pintarAjustes() {
  pintarFormUsuario();
  const filas = [
    ["proyectos", "Carpeta de proyectos", "Registro compartido. Hoy local; para trabajar entre sedes, apunta aquí a la carpeta del servidor u OneDrive."],
    ["creaciones", "Catálogo de muebles", "Recetas guardadas (.json); cada mueble se genera desde el componente base. Para compartirlo entre sedes, apunta aquí a una carpeta del servidor u OneDrive."],
  ];
  $("#aj-carpetas").innerHTML = "";
  filas.forEach(([k, t, d]) => {
    const row = document.createElement("div");
    row.className = "aj-row";
    row.innerHTML = `<div class="grow"><strong>${esc(t)}</strong><span class="hint">${esc(d)}</span>` +
      `<code>${esc(S.carpetas[k] || "—")}</code></div>` +
      `<button class="key sm">Abrir</button><button class="key sm">Cambiar…</button>`;
    const [abrir, cambiar] = $$("button", row);
    abrir.onclick = () => bridge("abrir_carpeta", k);
    cambiar.onclick = () => bridge("cambiar_carpeta", k);
    $("#aj-carpetas").appendChild(row);
  });
}

// ==== Misc =========================================================================
function ocupado(on, txt) {
  $("#busy").hidden = !on;
  if (txt) $("#busy-text").textContent = txt;
}

let avisoTimer;
function aviso(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("error", /^Error:/.test(msg));
  t.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (t.hidden = true), 3500);
}

$$("#tb-tabs .tab").forEach((b) => (b.onclick = () => irA(b.dataset.sec)));
$("#tb-ajustes").onclick = () => irA("ajustes");
$("#tb-guardar").onclick = guardarConNota;
$("#tb-salir").onclick = () => {
  const abierto = S.actual.folio && S.actual.modo === "edicion";
  preguntar("Cerrar sesión", abierto
    ? `El proyecto ${S.actual.folio} sigue abierto en SketchUp: guarda (Ctrl+S) para subir tus cambios.` : "¿Salir de Studio?", [
    ["key", "Cancelar", null],
    ["use", "Salir", () => { S.loginRol = null; bridge("sesion_cerrar"); }],
  ]);
};
$("#md-avanzado").onclick = () => abrirAvanzado(true);
$("#av-close").onclick = () => abrirAvanzado(false);
$("#md-back").onclick = () => irA(S.mod && S.mod._source === "csv" ? "csv" : S.lista);
$("#q").addEventListener("input", (e) => { S.q = e.target.value; pintarLista(); });
$("#pk-close").onclick = () => ($("#picker").hidden = true);
$("#pk-q").addEventListener("input", pintarPicker);
$("#picker").addEventListener("click", (e) => { if (e.target.id === "picker") $("#picker").hidden = true; });
$("#csv-importar").onclick = () => { $("#csv-importar").disabled = true; bridge("importar_csv"); };
$("#csv-plantilla").onclick = () => { $("#csv-plantilla").disabled = true; bridge("plantilla"); };
$("#csv-generar").onclick = csvGenerar;
$("#csv-quitar").onclick = csvQuitar;
$("#pj-q").addEventListener("input", (e) => { S.pj.q = e.target.value; pintarTablaProyectos(); });
$("#pj-recargar").onclick = () => bridge("recargar");
$("#pj-nuevo").onclick = abrirCrear;
$("#pj-libre").onclick = () => { S.libre = true; irA("proyecto"); };
$$("[data-cerrar]").forEach((b) => { b.onclick = () => { b.closest(".overlay").hidden = true; }; });
["#pj-ficha", "#pj-crear"].forEach((s) => $(s).addEventListener("click", (e) => { if (e.target === $(s)) $(s).hidden = true; }));
$("#pq-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#pq-botones .use").click(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#pregunta").hidden) $("#pregunta").hidden = true;
  else if (!$("#picker").hidden) $("#picker").hidden = true;
  else if (!$("#pj-crear").hidden) $("#pj-crear").hidden = true;
  else if (!$("#pj-ficha").hidden) $("#pj-ficha").hidden = true;
  else if (S.avAbierto) abrirAvanzado(false);
});

// ==== Clic: sin contorno, con un tic ========================================
// El contorno de foco es solo para quien navega con Tab; el ratón lo apaga.
const CLICABLE = "button, select, label, summary, .card, .pk-item, .pj-tabla tbody tr";
let audio = null;
// Envolvente común: sube a `vol` en `ataque` s y cae a silencio en `dur` s.
function envolvente(t, vol, ataque, dur) {
  const g = audio.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + ataque);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(audio.destination);
  return g;
}
// Soplo de ruido por un pasabanda: la parte «táctil» del clic.
function ruido(t, freq, q, dur, vol, ataque) {
  const n = Math.ceil(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = audio.createBufferSource(), fil = audio.createBiquadFilter();
  src.buffer = buf;
  fil.type = "bandpass"; fil.frequency.value = freq; fil.Q.value = q;
  src.connect(fil); fil.connect(envolvente(t, vol, ataque, dur));
  src.start(t);
}
// Tic «madera + susurro», sintetizado (sin archivos de sonido): dos
// resonancias de madera, un roce de aire y un cuerpo grave muy breve.
function tic() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const t = audio.currentTime;
    ruido(t, 5200, 0.8, 0.012, 0.016, 0.0015);
    ruido(t, 1250, 5, 0.026, 0.075, 0.001);
    ruido(t, 2300, 6, 0.016, 0.035, 0.001);
    const osc = audio.createOscillator();
    osc.frequency.setValueAtTime(290, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.028);
    osc.connect(envolvente(t, 0.022, 0.002, 0.028));
    osc.start(t); osc.stop(t + 0.04);
  } catch (e) { /* sin audio no pasa nada */ }
}
document.addEventListener("pointerdown", (e) => {
  document.documentElement.classList.remove("teclado");
  const el = e.target.closest && e.target.closest(CLICABLE);
  if (el && !el.disabled) tic();
}, true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Tab") document.documentElement.classList.add("teclado");
}, true);

bridge("listo");
