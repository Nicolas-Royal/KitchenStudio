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
const THUMB_FALLBACK = placeholder("sin imagen", "#ccc");
function setImg(img, url, fallback) {
  img.src = url || fallback || THUMB_FALLBACK;
  img.onerror = () => { img.onerror = null; img.src = fallback || THUMB_FALLBACK; };
}

// Categoría del catálogo -> familia del manifiesto (para «Avanzado»).
const FAMILIA_DE_CATEGORIA = { Gabinetes: "gabinete", Alacenas: "alacena", Esquineros: "esquinero" };
// Por ahora Studio solo trabaja con gabinetes; alacena y esquinero vienen después.
const FAMILIAS_ACTIVAS = ["gabinete"];
const SPEC_LABELS = { sku: "SKU", ancho_mm: "Ancho", alto_mm: "Alto", fondo_mm: "Fondo" };

const S = {
  carpetas: {}, version: "",
  // Igual a Proyecto::DEFAULT en Ruby; se reemplaza con lo que llegue de onEstado.
  proyecto: { global: { frente: "1", manija_puerta: "9", manija_cajon: "9", material: "", tarja: false,
    medidas: { igualar: false, ancho: 600, alto: 770, fondo: 600 } }, modulos: {} },
  listo: false,
  modulos: [], categorias: [],
  opciones: { medidas: {}, frentes: [], tiradores: [], materiales: [], familias: {} },
  manifiestos: {}, rcc: window.RCC_CORE || null, // ui/receta.js
  sec: "proyecto", lista: "catalogo", q: "", cat: null,
  mod: null, avAbierto: false, av: {},
  csv: null,
  // Registro de proyectos
  usuario: { usuario: "", nombre: "", sede: "", rol: "diseno" },
  actual: { folio: null }, estados: [], transiciones: {},
  pj: { lista: [], disponible: true, q: "", alcance: null, estado: null, detalle: null },
  iniciado: false,
  sesion: false, loginRol: null,
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
    S.transiciones = d.transiciones || {};
    S.listo = true;
    $("#ver").textContent = $("#login-ver").textContent = "v" + S.version;
    contadores();
    // 1. Sin sesión: solo el login.
    if (!S.sesion) { S.iniciado = false; return mostrarLogin(); }
    $("#login").hidden = true;
    $("#app").hidden = false;
    // 2/3. Al entrar o al cambiar de modelo: con proyecto abierto se va
    // adentro del proyecto; sin proyecto, a la lista.
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
  onGenerado(r) {
    if (S.csv && S.csv.cola) return csvSiguiente(r);
    ocupado(false);
    if (!r || !r.ok) return aviso("Error: " + ((r && r.error) || "no se pudo generar"));
    const partes = [];
    if (r.publicado) partes.push("guardado en el catálogo");
    if (!r.publicado || $("#av-escena").checked) partes.push("insertado");
    aviso(`${r.nombre}: ${partes.join(" y ")}`);
    if (r.publicado) bridge("recargar");
  },
  onImportado(r) {
    $("#csv-importar").disabled = false;
    if (!r || r.cancelado) return;
    if (!r.ok) return aviso("Error: " + (r.error || "no se pudo leer el archivo"));
    if (!S.rcc) return aviso("Error: no cargó ui/receta.js");
    const imp = S.rcc.construirImportacion(r);
    S.csv = { imp, sel: new Set(imp.filas.map((f, i) => (csvUsable(f) ? i : -1)).filter((i) => i >= 0)), hechos: {} };
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
// abierto en SketchUp.
const SECS_PROYECTO = ["proyecto", "lista", "modulo", "csv"];
const dentro = () => SECS_PROYECTO.includes(S.sec);

function irA(sec) {
  if (SECS_PROYECTO.includes(sec === "catalogo" ? "lista" : sec) && !S.actual.folio) sec = "proyectos";
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
  $("#avanzado").hidden = !S.avAbierto;
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
  pintarPickers($("#pr-pickers"), g, true, () => { guardarProyecto(); pintarProyecto(); }, {});
  pintarSeg($("#pr-tarja"), [["0", "No"], ["1", "Sí · refuerzos para fregadero"]], g.tarja ? "1" : "0", (v) => {
    g.tarja = v === "1"; guardarProyecto(); pintarProyecto();
  });
  $("#pr-igualar").checked = !!g.medidas.igualar;
  $("#pr-igualar").onchange = (e) => { g.medidas.igualar = e.target.checked; guardarProyecto(); pintarProyecto(); };
  const md = $("#pr-medidas");
  md.innerHTML = "";
  md.classList.toggle("is-off", !g.medidas.igualar);
  ["ancho", "alto", "fondo"].forEach((k) => md.appendChild(filaMedida(k, g.medidas[k], (v) => {
    g.medidas[k] = v; guardarProyecto(); pintarPreviewProyecto();
  }, !g.medidas.igualar)));
  pintarPreviewProyecto();
  pintarPersonalizados();
}

function pintarPreviewProyecto() {
  const g = S.proyecto.global;
  const alto = g.medidas.igualar ? g.medidas.alto : 770;
  const ancho = (g.medidas.igualar && g.medidas.ancho) || 600;
  const lay = RKVista.desdeValores({ d01_cantidad_zonas: "2", d11_z1_contenido: "1", d15_z1_cant_puertas: "3",
    d31_z2_contenido: "2", d32_z2_cant_cajones: "3", b01_gola_o_tirador: "1", a02_alto_zoclo: "100mm" }, { ancho, alto });
  visor("#pr-preview").mostrar(RKVista.svg(lay, disenoSvg(g, false)), "proyecto");
  $("#pr-preview-note").textContent = `Ejemplo: gabinete de ${ancho} mm con puerta doble y 3 cajones.`;
}

function pintarPersonalizados() {
  const box = $("#pr-personalizados");
  const ids = Object.keys(S.proyecto.modulos).filter((id) => S.proyecto.modulos[id].personalizado);
  if (!ids.length) { box.innerHTML = "<p class='hint'>Ninguno: todos siguen la configuración del proyecto.</p>"; return; }
  box.innerHTML = "";
  ids.forEach((id) => {
    const m = S.modulos.find((x) => x.id === id);
    const row = document.createElement("div");
    row.className = "mini-row";
    row.innerHTML = `<span>${esc(m ? m.name : id)}</span><button class="key sm">Abrir</button><button class="key sm">Usar global</button>`;
    const [abrir, quitar] = $$("button", row);
    abrir.disabled = !m;
    abrir.onclick = () => abrirModulo(m);
    quitar.onclick = () => { delete S.proyecto.modulos[id]; guardarProyecto(); pintarProyecto(); };
    box.appendChild(row);
  });
}

// ==== Selectores con foto (frente / manija / material) =======================
// Manija aparte para puertas y para cajones (reglas en reglas.js / opciones.json).
const PICKERS = [
  { key: "frente", titulo: "Tipo de frente", lista: () => S.opciones.frentes },
  { key: "manija_puerta", titulo: "Manija de puertas", uso: "puerta", lista: () => S.opciones.tiradores },
  { key: "manija_cajon", titulo: "Manija de cajones", uso: "cajon", lista: () => S.opciones.tiradores },
  { key: "material", titulo: "Material de frentes", lista: () => S.opciones.materiales, buscar: true, sinCambio: true },
];
const esManija = (key) => key === "manija_puerta" || key === "manija_cajon";

function opcion(key, id) {
  const p = PICKERS.find((x) => x.key === key);
  return (p.lista() || []).find((o) => String(o.id) === String(id)) || null;
}

function fotoDe(key, o) {
  if (o && o.foto_abs) return fileURL(o.foto_abs);
  if (key === "material") return o ? muestra(o.color, o.veta) : placeholder("Como el módulo", "#ece8e1");
  if (esManija(key) && o && o.id === "1") return placeholder("Sin manija");
  return placeholder(o ? o.nombre : "—");
}

/* Diseño -> lo que necesita RKVista.svg. */
function disenoSvg(d, gola) {
  const vista = (key) => { const t = opcion(key, d[key]); return gola ? null : (t && t.vista) || null; };
  const mat = opcion("material", d.material);
  return {
    frente: d.frente,
    manijaPuerta: vista("manija_puerta"),
    manijaCajon: vista("manija_cajon"),
    material: mat ? { color: mat.color, foto: mat.foto_abs ? fileURL(mat.foto_abs) : null, veta: mat.veta } : null,
    gola,
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
  const error = RKReglas.diseno(S.opciones, d, !!extra.gola);
  PICKERS.forEach((p) => {
    const sinManija = esManija(p.key) && extra.gola;
    const o = opcion(p.key, d[p.key]);
    const t = document.createElement("button");
    t.type = "button";
    t.className = "pick-tile" + (editable && !sinManija ? "" : " off");
    t.disabled = !editable || sinManija;
    const nombre = sinManija ? "Con gola: sin manija" : (o ? o.nombre : (p.sinCambio ? "Como el módulo" : "—"));
    t.innerHTML = `<div class="pick-photo"><img alt=""></div><div class="pick-text"><span class="stamp">${p.titulo}</span>` +
      `<strong>${esc(nombre)}</strong><span class="pick-sub">${esc(o && o.grupo ? o.grupo : notaManija(p, o))}</span>` +
      (editable && !sinManija ? "<span class='pick-change'>Cambiar…</span>" : "") + "</div>";
    setImg($("img", t), sinManija ? placeholder("Gola") : fotoDe(p.key, o));
    if (editable && !sinManija) t.onclick = () => abrirPicker(p, d, onCambio);
    box.appendChild(t);
  });
  // Diseños guardados antes de una regla (p. ej. concha en puertas).
  if (error) box.insertAdjacentHTML("beforeend", `<p class="cf-error pick-error">${esc(error)}: cámbialo antes de insertar.</p>`);
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
      b.title = motivo || (o && o.color && !o.foto_abs ? "Tono aproximado: falta la foto" : "");
      b.innerHTML = `<div class="pk-photo"><img alt="" loading="lazy"></div><span class="pk-name">${esc(o ? o.nombre : "Como el módulo")}</span>` +
        (motivo ? `<span class="pk-why">${esc(motivo)}</span>` : "");
      setImg($("img", b), fotoDe(p.key, o));
      b.onclick = () => { d[p.key] = id; $("#picker").hidden = true; pk.onCambio(); };
      wrap.appendChild(b);
    });
    grid.appendChild(wrap);
  });
  if (!lista.length) grid.innerHTML = "<p class='empty'>Sin resultados</p>";
}

function pintarSeg(box, opciones, actual, onCambio, deshabilitado) {
  box.innerHTML = "";
  opciones.forEach(([v, txt]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (String(actual) === v ? " active" : "");
    b.textContent = txt;
    b.disabled = !!deshabilitado;
    b.onclick = () => onCambio(v);
    box.appendChild(b);
  });
}

/* Fila de medida: chips con presets + campo libre en mm. */
function filaMedida(k, valor, onCambio, deshabilitado, etiqueta) {
  const d = Object.assign({ label: k, presets: [] }, (S.opciones.medidas || {})[k]);
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
  const cats = [...new Set(enPanel.map((m) => m.category))].filter(Boolean);
  const chips = $("#chips");
  chips.innerHTML = "";
  chips.hidden = cats.length < 2;
  [["", "Todas"]].concat(cats.map((c) => [c, c])).forEach(([v, t]) => {
    const b = document.createElement("button");
    b.className = "chip" + ((S.cat || "") === v ? " active" : "");
    b.textContent = t;
    b.onclick = () => { S.cat = v || null; pintarLista(); };
    chips.appendChild(b);
  });
  const q = S.q.trim().toLowerCase();
  const lista = enPanel.filter((m) => (!S.cat || m.category === S.cat) &&
    (!q || [m.name, m.id, m.specs && m.specs.sku, m.ubicacion, ...Object.values(m.features || {}).flat()].join(" ").toLowerCase().includes(q)));
  const grid = $("#grid");
  grid.innerHTML = "";
  if (!lista.length) {
    grid.innerHTML = `<p class="empty">${!q ? "Aún no hay muebles · crea uno con + Gabinete o desde CSV y guárdalo en el catálogo" : "Sin resultados"}</p>`;
    return;
  }
  lista.forEach((m) => grid.appendChild(tarjeta(m)));
}

function tarjeta(m) {
  const c = document.createElement("div");
  c.className = "card";
  c.tabIndex = 0;
  const per = personalizado(m);
  const sku = (m.specs && m.specs.sku) || "";
  c.innerHTML = `<div class="vents" aria-hidden="true"><i></i><i></i><i></i></div>` +
    (per ? `<span class="badge">Personalizado</span>` : "") +
    `<div class="screen preview-mini" aria-hidden="true">${svgModulo(m)}</div><div class="body"><div class="name">${esc(m.name)}</div>` +
    `<div class="meta">${esc(m.category)}${sku ? " · " + esc(sku) : ""}</div>` +
    `<div class="card-actions"><button class="use sm">Configurar</button><button class="key sm" title="Insertar como está">Usar</button></div></div>`;
  const [conf, usar] = $$("button", c);
  conf.onclick = (e) => { e.stopPropagation(); abrirModulo(m); };
  usar.onclick = (e) => { e.stopPropagation(); insertar(m, null); };
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
function personalizado(m) {
  const o = S.proyecto.modulos[m.id];
  return !!(o && o.personalizado);
}

/* Diseño efectivo del módulo: el suyo si está personalizado, si no el global
   (con las medidas propias del módulo, salvo «igualar» en gabinetes, que
   pone el ancho, alto y fondo comunes). */
function disenoDe(m) {
  const g = S.proyecto.global;
  const o = S.proyecto.modulos[m.id];
  const s = m.specs || {};
  const base = { ancho: s.ancho_mm || 600, alto: s.alto_mm || 770, fondo: s.fondo_mm || 578 };
  if (o && o.personalizado) return Object.assign({ modo: "personal" }, base, o, o.medidas || {});
  const d = Object.assign({ modo: "global" }, base, { frente: g.frente, manija_puerta: g.manija_puerta, manija_cajon: g.manija_cajon, material: g.material, tarja: g.tarja });
  if (g.medidas.igualar && tieneReceta(m) && familiaDe(m) === "gabinete") { d.ancho = g.medidas.ancho || d.ancho; d.alto = g.medidas.alto; d.fondo = g.medidas.fondo; }
  return d;
}

function abrirModulo(m, avanzado) {
  S.mod = m;
  S.avAbierto = !!avanzado;
  S.sec = "modulo";
  pintarSeccion();
}

function abrirAvanzado(on) {
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
  abrirModulo({ id: "nuevo-" + fam, name: "Nuevo " + man.titulo.toLowerCase(), category: cat, familia: fam,
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
  const gola = esGola(m);
  pintarSeg($("#md-modo"), [["global", "Del proyecto"], ["personal", "Personalizado"]], d.modo, (v) => {
    if (v === "personal") {
      const g = disenoDe(m);
      S.proyecto.modulos[m.id] = { personalizado: true, frente: g.frente, manija_puerta: g.manija_puerta, manija_cajon: g.manija_cajon, material: g.material, tarja: g.tarja,
        medidas: { ancho: g.ancho, alto: g.alto, fondo: g.fondo } };
    } else delete S.proyecto.modulos[m.id];
    cambioDiseno(m);
    pintarModulo();
  });
  $("#md-modo-note").textContent = personal
    ? "Este módulo tiene su propio diseño; el resto del proyecto no cambia."
    : "Sigue el diseño del proyecto (sección Proyecto). Para cambiar solo este, elige «Personalizado».";

  const o = S.proyecto.modulos[m.id];
  const set = (k, v) => { o.medidas = o.medidas || {}; o.medidas[k] = v; cambioDiseno(m); pintarPreviewModulo(m); };
  const md = $("#md-medidas");
  md.innerHTML = "";
  const totales = !real;
  ["ancho", "alto", "fondo"].forEach((k) => md.appendChild(filaMedida(k, d[k], (v) => set(k, v), !personal,
    totales && k !== "ancho" ? (k === "alto" ? "Alto total" : "Fondo total") : null)));

  // Tarja solo donde se puede aplicar de verdad (creación con receta).
  $("#md-tarja-wrap").hidden = !(fc && fc.tarja && real);
  pintarSeg($("#md-tarja"), [["0", "No"], ["1", "Sí · refuerzos para fregadero"]], d.tarja ? "1" : "0", (v) => {
    o.tarja = v === "1"; cambioDiseno(m); pintarModulo();
  }, !personal || !real);

  pintarPickers($("#md-pickers"), personal ? o : d, personal, () => { cambioDiseno(m); pintarModulo(); }, { gola });
  $("#md-error").hidden = true;
  $("#md-insert").textContent = real ? "Insertar con este diseño" : "Insertar con estas medidas";
  $("#md-insert").onclick = () => insertar(m, d);
  $("#md-asis").onclick = () => insertar(m, null);
}

/* Alzado SVG del módulo: con su diseño efectivo, o con las variables de
   «Avanzado» (+avanzado+, solo gabinete). */
function svgModulo(m, avanzado) {
  if (avanzado && S.av[m.id] && familiaDe(m) === "gabinete") {
    const st = S.av[m.id];
    const v = st.reg.valores;
    const lay = RKVista.desdeValores(v, { ancho: RKVista.num(v.LenX, 600), alto: RKVista.num(v.LenZ, 770) });
    return RKVista.svg(lay, disenoSvg({ frente: v.l01_linea_frente, manija_puerta: v.d16_z1_tirador_tipo, manija_cajon: v.e01_tirador_tipo,
      material: st.material }, v.b01_gola_o_tirador === "2"));
  }
  const d = disenoDe(m);
  const lay = m.receta && familiaDe(m) === "gabinete"
    ? RKVista.desdeValores(m.receta.valores, { ancho: d.ancho, alto: d.alto })
    : RKVista.desdeEtiquetas(Object.assign({}, m, { specs: Object.assign({}, m.specs, { ancho_mm: d.ancho, alto_mm: d.alto }) }));
  return RKVista.svg(lay, disenoSvg(d, esGola(m)));
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
    valores = RKAvanzado.valoresDesdeFila(man, m.receta.valores || {}, S.rcc);
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
  const sku = m.specs && m.specs.sku;
  reg.nombre_salida = m._source === "csv" ? m.name : (sku ? sku + "-P" : S.rcc.autoNombre(man, valores));
  S.av[m.id] = { man, reg, nota, material: m._source === "csv" ? "" : d.material || "", nombreManual: m._source === "csv" || !!sku };
  return S.av[m.id];
}

function pintarAvanzado(m) {
  const st = estadoAvanzado(m);
  const form = $("#av-form");
  $("#av-title").textContent = m.name;
  if (!st) {
    form.innerHTML = `<p class="empty">${S.rcc ? "Esta familia todavía no tiene manifiesto en Studio" : "No cargó ui/receta.js"}</p>`;
    $("#av-generar").disabled = true;
    return;
  }
  $("#av-note").textContent = st.nota + (st.material ? ` Material de frentes: ${(opcion("material", st.material) || {}).nombre || st.material}.` : "");
  const nombre = $("#av-nombre");
  nombre.value = st.reg.nombre_salida;
  nombre.oninput = () => { st.reg.nombre_salida = nombre.value; st.nombreManual = nombre.value.trim() !== ""; };
  $("#av-publicar").checked = m._source === "csv" || m._source === "nuevo";
  $("#av-reset").onclick = () => { delete S.av[m.id]; pintarModulo(); };
  RKAvanzado.montar(form, st.man, st.reg, S.rcc, (errMotor) => {
    // Las del motor + las de fabricación de Studio (manijas por uso, MDF).
    const errores = errMotor.concat(RKReglas.receta(S.opciones, (S.opciones.familias || {})[st.reg.familia], st.reg.valores));
    if (!st.nombreManual) { st.reg.nombre_salida = S.rcc.autoNombre(st.man, st.reg.valores); nombre.value = st.reg.nombre_salida; }
    const box = $("#av-errores");
    box.hidden = !errores.length;
    box.innerHTML = errores.map((e) => `<div>• ${esc(e.label ? e.label + ": " : "")}${esc(e.msg)}</div>`).join("");
    $("#av-generar").disabled = errores.length > 0;
    pintarPreviewModulo(m);
  });
  $("#av-generar").onclick = () => generarAvanzado(m, st);
}

function payloadGenerar(st, ref, insertar, publicar) {
  const reg = st.reg;
  const nombre = (reg.nombre_salida || "").trim();
  if (!nombre || /[\\/:*?"<>|]/.test(nombre)) return { error: "Escribe un nombre válido (sin \\ / : * ? \" < > |)." };
  return {
    ref, familia: reg.familia, nombre,
    valores: S.rcc.flatten(st.man, reg),
    divisores: S.rcc.nombresDivisores(st.man, reg),
    material: st.material || "",
    insertar, publicar,
  };
}

function generarAvanzado(m, st) {
  const insertarEsc = $("#av-escena").checked;
  const publicar = $("#av-publicar").checked;
  if (!insertarEsc && !publicar) return aviso("Error: elige insertar en la escena, guardar en el catálogo, o ambos");
  const p = payloadGenerar(st, m.id, insertarEsc, publicar);
  if (p.error) return aviso("Error: " + p.error);
  ocupado(true, `Generando ${p.nombre}… (puede tardar unos segundos)`);
  bridge("generar", JSON.stringify(p));
}

// ---- Insertar desde «Diseño» -----------------------------------------------------
function insertar(m, d) {
  let eleccion = null;
  if (d) {
    eleccion = { ancho: d.ancho, alto: d.alto, fondo: d.fondo };
    if (tieneReceta(m)) {
      const fc = cfgFamilia(m) || {};
      if (fc.tarja) eleccion.tarja = !!d.tarja;
      if (fc.frente && d.frente) eleccion.frente = d.frente;
      const gola = esGola(m);
      Object.values(RKReglas.USOS).forEach((k) => { if (fc[k] && d[k] && !gola) eleccion[k] = d[k]; });
      if (fc.material && d.material) eleccion.material = d.material;
      const error = RKReglas.diseno(S.opciones, d, gola);
      if (error) {
        const e = $("#md-error");
        e.textContent = error + ".";
        e.hidden = false;
        return;
      }
    }
  }
  ocupado(true, `Insertando ${m.name}…`);
  bridge("insertar", JSON.stringify({ id: m.id, eleccion }));
}

// Por ahora solo se generan las filas de familias activas (gabinete).
function csvUsable(f) {
  return f.estado !== "error" && FAMILIAS_ACTIVAS.includes(f.familia);
}

// ==== CSV ============================================================================
function pintarCsv() {
  const c = S.csv;
  $("#csv-vacio").hidden = !!c;
  $("#csv-tabla-wrap").hidden = !c;
  if (!c) return;
  const imp = c.imp;
  const ok = imp.filas.filter(csvUsable).length;
  $("#csv-resumen").textContent = `${imp.filas.length} filas · ${ok} listas · ${imp.filas.length - ok} con error · ${c.sel.size} seleccionadas`;
  $("#csv-generar").disabled = !c.sel.size || !!c.cola;
  const t = $("#csv-tabla");
  t.innerHTML = "<thead><tr><th></th><th>Nombre</th><th>Familia</th><th>Estado</th><th>Detalle</th><th></th></tr></thead>";
  const tb = document.createElement("tbody");
  imp.filas.forEach((f, i) => {
    const man = S.manifiestos[f.familia];
    const msgs = [f.error].concat(Object.values(f.errores || {})).filter(Boolean);
    const hecho = c.hechos[i];
    const estado = hecho ? hecho.estado : (FAMILIAS_ACTIVAS.includes(f.familia) ? f.estado : "pendiente");
    const tr = document.createElement("tr");
    tr.className = "st-" + estado;
    tr.innerHTML = `<td><input type="checkbox" ${c.sel.has(i) ? "checked" : ""} ${csvUsable(f) ? "" : "disabled"}></td>` +
      `<td><b>${esc(f.nombre || "—")}</b></td><td>${esc(man ? man.titulo : f.familia || "—")}</td>` +
      `<td><span class="pill">${esc({ ok: "Lista", aviso: "Con avisos", error: "Error", generado: "Generada", fallo: "Falló", pendiente: "Solo gabinete" }[estado] || estado)}</span></td>` +
      `<td class="msgs">${esc(estado === "pendiente" ? "Por ahora Studio solo genera gabinetes" : hecho && hecho.msg ? hecho.msg : msgs.concat(f.avisos || []).slice(0, 3).join(" · "))}</td>` +
      `<td><button class="key sm" ${f.valores && estado !== "pendiente" ? "" : "disabled"}>Editar</button></td>`;
    $("input", tr).onchange = (e) => { e.target.checked ? c.sel.add(i) : c.sel.delete(i); pintarCsv(); };
    $("button", tr).onclick = () => abrirModulo({ id: "csv-" + i, name: f.nombre, category: man && man.titulo, familia: f.familia,
      _source: "csv", _virtual: true, valores: f.valores, specs: {}, features: {} }, true);
    tb.appendChild(tr);
  });
  t.appendChild(tb);
}

function csvGenerar() {
  const c = S.csv;
  if (!c || !c.sel.size || !S.rcc) return;
  c.cola = [...c.sel].sort((a, b) => a - b);
  c.total = c.cola.length;
  c.escena = $("#csv-escena").checked;
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
    aviso(`CSV: ${n} muebles guardados en el catálogo`);
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
  const st = { man: S.manifiestos[f.familia], reg: { familia: f.familia, valores: f.valores, nombre_salida: f.nombre }, material: "" };
  const p = payloadGenerar(st, "csv-" + i, c.escena, true);
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
  // Planeación revisa todo; diseño empieza con lo suyo.
  if (!S.pj.alcance) S.pj.alcance = esPlaneacion() ? "todos" : "mios";
  pintarSeg($("#pj-alcance"), [["mios", "Mis proyectos"], ["todos", "Todos"]], S.pj.alcance, (v) => {
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
        (p.cambios_tras_congelar && cerrado ? `<span class="pill aviso">Cambios después de congelar</span>` : "") + "</div></td>" +
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

/* Barra superior: en el inicio, el título; dentro de un proyecto, volver a la
   lista + folio, cliente, estado y sincronía. Siempre: quién entró. */
function pintarBarra() {
  const a = S.actual, en = dentro() && a.folio;
  $("#tb-tabs").hidden = !en;
  const ctx = $("#tb-ctx");
  if (en) {
    const reg = a.registro || {}, s = P.sincronia(a);
    ctx.innerHTML = `<button class="key sm" id="tb-volver">← Proyectos</button>` +
      `<div class="tb-pj"><strong>${esc(a.folio)}</strong><span class="hint">${esc(reg.cliente || "Sin cliente")}</span></div>` +
      (reg.estado ? pillEstado(reg.estado) : "") + (s ? `<span class="pill ${s.clase}">${esc(s.texto)}</span>` : "");
    $("#tb-volver").onclick = () => irA("proyectos");
  } else if (S.sec === "ajustes") {
    ctx.innerHTML = `<button class="key sm" id="tb-volver">← Proyectos</button><span class="tb-titulo">Ajustes</span>`;
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
  ["cliente", "Cliente", "text"], ["telefono", "Teléfono", "tel"],
  ["fecha_compromiso", "Fecha compromiso", "date"], ["notas", "Notas / áreas (cocina, closet, baño…)", "textarea"],
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

  const cand = P.candado(r.candado, S.usuario.usuario, ahora);
  const avisos = [];
  if (cand && !cand.propio) avisos.push(cand.texto + ".");
  if (r.cambios_tras_congelar) avisos.push(`Hay cambios después de la versión congelada (v${r.version_congelada}); fábrica trabaja con la congelada.`);
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

  // Estados permitidos para el rol de esta PC (las reglas vienen de Ruby).
  const destinos = ((S.transiciones[S.usuario.rol] || {})[r.estado]) || [];
  const box = $("#pf-transiciones");
  box.innerHTML = "";
  if (!destinos.length) box.innerHTML = `<p class="hint">${esPlaneacion() ? "Diseño todavía no lo envía a planeación." : "Lo tiene Planeación: solo ellos pueden cambiar el estado."}</p>`;
  destinos.forEach((a) => {
    const b = document.createElement("button");
    b.className = a === "planeacion" ? "use sm" : "chip";
    const devolver = esPlaneacion() && a === "diseno";
    b.textContent = devolver ? "Devolver a diseño" : (a === "planeacion" ? "Enviar a planeación (congela v" + r.version_actual + ")" : nombreEstado(a));
    b.onclick = () => {
      const nota = $("#pf-nota-estado").value.trim();
      if (devolver && !nota) return aviso("Error: escribe en la nota qué hay que cambiar");
      ocupado(true, "Cambiando estado…");
      bridge("proyecto_estado", JSON.stringify({ folio: r.folio, a, nota }));
      $("#pf-nota-estado").value = "";
    };
    b.disabled = !editable;
    box.appendChild(b);
  });
  $("#pf-nota-estado").hidden = !destinos.length;

  const ev = $("#pf-eventos");
  ev.innerHTML = "";
  (r.eventos || []).slice().reverse().forEach((e) => {
    const row = document.createElement("div");
    row.className = "mini-row";
    const que = e.tipo === "creado" ? "Creó el proyecto"
      : `${nombreEstado(e.de)} → ${nombreEstado(e.a)}${e.version ? ` (congeló v${e.version})` : ""}`;
    row.innerHTML = `<div class="pf-ev"><b>${esc(que)}</b><span class="hint">${esc(e.por || "")} · ${esc(P.fecha(e.fecha))}${e.nota ? " · " + esc(e.nota) : ""}</span></div>`;
    ev.appendChild(row);
  });

  const vt = $("#pf-versiones");
  const hist = (r.historial || []).slice().sort((x, y) => y.v - x.v);
  vt.innerHTML = "<thead><tr><th>Versión</th><th>Quién · cuándo</th><th>Nota</th><th></th></tr></thead>";
  const tb = document.createElement("tbody");
  hist.forEach((h) => {
    const tr = document.createElement("tr");
    const marcas = [h.v === r.version_actual ? "<span class='pill ok'>Vigente</span>" : "",
      h.congelada ? "<span class='pill info'>Congelada</span>" : "",
      h.conflicto ? "<span class='pill bad'>Conflicto</span>" : ""].join(" ");
    tr.innerHTML = `<td><span class="pj-folio">v${esc(h.v)}</span> ${marcas}</td>` +
      `<td>${esc(h.por || "")}<span class="pj-sub">${esc(P.fecha(h.fecha))}</span></td>` +
      `<td class="msgs">${esc(h.nota || "")}</td><td><button class="key sm">Abrir</button></td>`;
    $("button", tr).onclick = () => abrirProyecto(r.folio, true, { version: h.v });
    $("button", tr).disabled = !editable;
    tb.appendChild(tr);
  });
  if (!hist.length) tb.innerHTML = "<tr><td colspan='4' class='hint'>Aún no hay versiones.</td></tr>";
  vt.appendChild(tb);

  $("#pf-pie").textContent = `Actualizado por ${(r.actualizado || {}).nombre || "—"} · ${P.fecha((r.actualizado || {}).fecha)}`;
  $("#pf-abrir").disabled = !r.version_actual && !(r.local || {}).pendiente;
  $("#pf-abrir").onclick = () => abrirProyecto(r.folio, false);
  $("#pf-consulta").disabled = !editable || !r.version_actual;
  $("#pf-consulta").textContent = r.version_congelada && esPlaneacion() ? `Abrir congelada v${r.version_congelada}` : "Abrir solo lectura";
  $("#pf-consulta").onclick = () => abrirProyecto(r.folio, true, r.version_congelada && esPlaneacion() ? { version: r.version_congelada } : {});
}

// ---- Nuevo proyecto ------------------------------------------------------------------
let usarModeloActual = "1";
function abrirCrear() {
  if (!S.usuario.nombre) return aviso("Error: primero escribe tu nombre");
  formCampos($("#pc-form"), [["folio", "Folio / número de pedido", "text"]].concat(CAMPOS_PROYECTO), {}, true);
  pintarSeg($("#pc-modelo"), [["1", "Usar el modelo abierto"], ["0", "Empezar con un modelo vacío"]], usarModeloActual, (v) => {
    usarModeloActual = v; abrirCrear();
  });
  $("#pc-error").hidden = true;
  $("#pj-crear").hidden = false;
  $("[data-k=folio]", $("#pc-form")).focus();
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
    ["creaciones", "Catálogo de muebles", "Recetas guardadas (.json + .skp). Para compartirlo entre sedes, apunta aquí a una carpeta del servidor u OneDrive."],
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
$("#pj-q").addEventListener("input", (e) => { S.pj.q = e.target.value; pintarTablaProyectos(); });
$("#pj-recargar").onclick = () => bridge("recargar");
$("#pj-nuevo").onclick = abrirCrear;
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
