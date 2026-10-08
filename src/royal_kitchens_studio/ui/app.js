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

// Categoría del catálogo -> familia de KitchenCreator (para «Avanzado»).
const FAMILIA_DE_CATEGORIA = { Gabinetes: "gabinete", Alacenas: "alacena", Esquineros: "esquinero" };
const SPEC_LABELS = { sku: "SKU", ancho_mm: "Ancho", alto_mm: "Alto", fondo_mm: "Fondo" };

const S = {
  deps: {}, carpetas: {}, version: "",
  // Igual a Proyecto::DEFAULT en Ruby; se reemplaza con lo que llegue de onEstado.
  proyecto: { global: { frente: "1", manija: "9", material: "", tarja: false,
    medidas: { igualar: false, alto: 770, fondo: 578 } }, modulos: {} },
  listo: false,
  modulos: [], categorias: [],
  opciones: { medidas: {}, frentes: [], tiradores: [], materiales: [], familias: {} },
  manifiestos: {}, rcc: null,
  sec: "proyecto", lista: "catalogo", q: "", cat: null,
  mod: null, tab: "diseno", av: {},
  csv: null,
};

// ==== Datos desde Ruby =======================================================
window.RKS = {
  onEstado(d) {
    S.deps = d.dependencias || {};
    S.carpetas = d.carpetas || {};
    S.version = d.version || "";
    S.proyecto = d.proyecto || S.proyecto;
    S.modulos = d.modulos || [];
    S.categorias = d.categorias || [];
    S.opciones = Object.assign(S.opciones, d.opciones || {});
    S.manifiestos = d.manifiestos || {};
    if (d.rcc_core && !S.rcc) S.rcc = cargarRcc(d.rcc_core);
    S.listo = true;
    $("#ver").textContent = "v" + S.version;
    pintarDeps();
    contadores();
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
    if (r.publicado) partes.push("guardado en Creaciones");
    if (!r.publicado || $("#av-escena").checked) partes.push("insertado");
    aviso(`${r.nombre}: ${partes.join(" y ")}`);
    if (r.publicado) bridge("recargar");
  },
  onImportado(r) {
    $("#csv-importar").disabled = false;
    if (!r || r.cancelado) return;
    if (!r.ok) return aviso("Error: " + (r.error || "no se pudo leer el archivo"));
    if (!S.rcc) return aviso("Error: falta Royal Catalog Creator 1.2+");
    const imp = S.rcc.construirImportacion(r);
    S.csv = { imp, sel: new Set(imp.filas.map((f, i) => (f.estado !== "error" ? i : -1)).filter((i) => i >= 0)), hechos: {} };
    pintarCsv();
  },
  onPlantilla(r) {
    $("#csv-plantilla").disabled = false;
    if (r && r.ok) aviso("Plantilla descargada: " + r.ruta);
    else aviso("Error: " + ((r && r.error) || "no se pudo descargar"));
  },
  onError(r) {
    ocupado(false);
    if (S.csv) S.csv.cola = null;
    aviso("Error: " + (r && r.error));
  },
};

/* Código del formulario de Royal Catalog Creator evaluado aparte, con un
   documento de mentira (su init() espera DOMContentLoaded y nunca corre). Da
   window.RCC_CORE: validación, aplanado e importación idénticos al creador. */
function cargarRcc(src) {
  const w = {};
  const doc = {
    readyState: "loading", addEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, createElement() { return {}; },
  };
  try {
    new Function("window", "document", "console", src)(w, doc, console);
    return w.RCC_CORE || null;
  } catch (e) {
    console.error("RCC_CORE", e);
    return null;
  }
}

// ==== Navegación =============================================================
function irA(sec) {
  if (sec === "catalogo" || sec === "creaciones") { S.lista = sec; S.sec = "lista"; S.cat = null; }
  else S.sec = sec;
  if (sec !== "modulo") S.mod = null;
  pintarSeccion();
}

function pintarSeccion() {
  if (!S.listo) return;
  const navSel = S.sec === "lista" || S.sec === "modulo" ? (S.mod && S.mod._source === "csv" ? "csv" : S.lista) : S.sec;
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.sec === navSel));
  ["proyecto", "lista", "modulo", "csv", "ajustes"].forEach((s) => { $("#sec-" + s).hidden = S.sec !== s; });
  if (S.sec === "proyecto") pintarProyecto();
  if (S.sec === "lista") pintarLista();
  if (S.sec === "modulo") pintarModulo();
  if (S.sec === "csv") pintarCsv();
  if (S.sec === "ajustes") pintarAjustes();
}

function contadores() {
  $("#n-catalogo").textContent = S.modulos.filter((m) => m._source !== "creaciones").length;
  $("#n-creaciones").textContent = S.modulos.filter((m) => m._source === "creaciones").length;
}

function pintarDeps() {
  const html = Object.values(S.deps).map((d) =>
    `<div class="dep ${d.ok ? "ok" : "bad"}" title="${esc(d.ok ? "Listo" : `Requiere ${d.minimo}+`)}"><i class="led"></i><span>${esc(d.nombre)}</span><b>${esc(d.version || "—")}</b></div>`).join("");
  $("#deps").innerHTML = html;
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
  ["alto", "fondo"].forEach((k) => md.appendChild(filaMedida(k, g.medidas[k], (v) => {
    g.medidas[k] = v; guardarProyecto(); pintarPreviewProyecto();
  }, !g.medidas.igualar)));
  pintarPreviewProyecto();
  pintarPersonalizados();
}

function pintarPreviewProyecto() {
  const g = S.proyecto.global;
  const alto = g.medidas.igualar ? g.medidas.alto : 770;
  const lay = RKVista.desdeValores({ d01_cantidad_zonas: "2", d11_z1_contenido: "1", d15_z1_cant_puertas: "3",
    d31_z2_contenido: "2", d32_z2_cant_cajones: "3", b01_gola_o_tirador: "1", a02_alto_zoclo: "100mm" }, { ancho: 600, alto });
  $("#pr-preview").innerHTML = RKVista.svg(lay, disenoSvg(g, false));
  $("#pr-preview-note").textContent = "Ejemplo: gabinete de 600 mm con puerta doble y 3 cajones.";
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
const PICKERS = [
  { key: "frente", titulo: "Tipo de frente", lista: () => S.opciones.frentes },
  { key: "manija", titulo: "Manija", lista: () => S.opciones.tiradores },
  { key: "material", titulo: "Material de frentes", lista: () => S.opciones.materiales, buscar: true, sinCambio: true },
];

function opcion(key, id) {
  const p = PICKERS.find((x) => x.key === key);
  return (p.lista() || []).find((o) => String(o.id) === String(id)) || null;
}

function fotoDe(key, o) {
  if (o && o.foto_abs) return fileURL(o.foto_abs);
  if (key === "material") return o ? muestra(o.color, o.veta) : placeholder("Como el módulo", "#ece8e1");
  if (key === "manija" && o && o.id === "1") return placeholder("Sin manija");
  return placeholder(o ? o.nombre : "—");
}

/* Diseño -> lo que necesita RKVista.svg. */
function disenoSvg(d, gola) {
  const man = opcion("manija", d.manija);
  const mat = opcion("material", d.material);
  return {
    frente: d.frente,
    manija: gola ? null : (man && man.vista) || null,
    material: mat ? { color: mat.color, foto: mat.foto_abs ? fileURL(mat.foto_abs) : null, veta: mat.veta } : null,
    gola,
  };
}

// MDF laminado solo existe en puerta Lisa (guía RK).
function bloqueo(key, o, d) {
  const mat = opcion("material", d.material);
  const fr = opcion("frente", d.frente);
  if (key === "frente" && o.solo_madera && mat && mat.familia === "MDF") return `${mat.nombre} es MDF: solo puerta Lisa`;
  if (key === "material" && o.familia === "MDF" && fr && fr.solo_madera) return `MDF solo en puerta Lisa (frente: ${fr.nombre})`;
  return "";
}

/* Tiles de los tres selectores sobre el objeto +d+ (global o del módulo). */
function pintarPickers(box, d, editable, onCambio, extra) {
  box.innerHTML = "";
  PICKERS.forEach((p) => {
    const sinManija = p.key === "manija" && extra.gola;
    const o = opcion(p.key, d[p.key]);
    const t = document.createElement("button");
    t.type = "button";
    t.className = "pick-tile" + (editable && !sinManija ? "" : " off");
    t.disabled = !editable || sinManija;
    const nombre = sinManija ? "Con gola: sin manija" : (o ? o.nombre : (p.sinCambio ? "Como el módulo" : "—"));
    t.innerHTML = `<div class="pick-photo"><img alt=""></div><div class="pick-text"><span class="stamp">${p.titulo}</span>` +
      `<strong>${esc(nombre)}</strong><span class="pick-sub">${esc(o && o.grupo ? o.grupo : "")}</span>` +
      (editable && !sinManija ? "<span class='pick-change'>Cambiar…</span>" : "") + "</div>";
    setImg($("img", t), sinManija ? placeholder("Gola") : fotoDe(p.key, o));
    if (editable && !sinManija) t.onclick = () => abrirPicker(p, d, onCambio);
    box.appendChild(t);
  });
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

// ==== Catálogo / Creaciones ====================================================
function enLista(m) {
  return S.lista === "creaciones" ? m._source === "creaciones" : m._source !== "creaciones";
}

function pintarLista() {
  const cre = S.lista === "creaciones";
  $("#ls-stamp").textContent = cre ? "Piezas únicas" : "Catálogo";
  $("#ls-title").textContent = cre ? "Creaciones personalizadas" : "Catálogo de módulos";
  const acc = $("#ls-actions");
  acc.innerHTML = "";
  if (cre) {
    acc.innerHTML = `<button class="key" data-nuevo="gabinete">+ Gabinete</button><button class="key" data-nuevo="alacena">+ Alacena</button>` +
      `<button class="key" data-nuevo="esquinero">+ Esquinero</button><button class="use" id="ls-csv">Crear desde CSV</button>`;
    $$("[data-nuevo]", acc).forEach((b) => (b.onclick = () => nuevoModulo(b.dataset.nuevo)));
    $("#ls-csv", acc).onclick = () => irA("csv");
  }
  const enPanel = S.modulos.filter(enLista);
  const cats = (cre ? [...new Set(enPanel.map((m) => m.category))] : S.categorias).filter(Boolean);
  const chips = $("#chips");
  chips.innerHTML = "";
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
    grid.innerHTML = `<p class="empty">${cre && !q ? "Aún no hay creaciones · genera desde CSV o con + Gabinete" : "Sin resultados"}</p>`;
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
    `<div class="screen"><img loading="lazy" alt=""></div><div class="body"><div class="name">${esc(m.name)}</div>` +
    `<div class="meta">${esc(m.category)}${sku ? " · " + esc(sku) : ""}</div>` +
    `<div class="card-actions"><button class="use sm">Configurar</button><button class="key sm" title="Insertar como está">Usar</button></div></div>`;
  setImg($("img", c), thumbURL(m));
  const [conf, usar] = $$("button", c);
  conf.onclick = (e) => { e.stopPropagation(); abrirModulo(m); };
  usar.onclick = (e) => { e.stopPropagation(); insertar(m, null); };
  c.onclick = () => abrirModulo(m);
  c.onkeydown = (e) => { if (e.target === c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); abrirModulo(m); } };
  return c;
}

function thumbURL(m) {
  if (m._abs) return fileURL(m.thumb_path);
  if (!S.carpetas.catalogo) return THUMB_FALLBACK;
  const rel = m.thumb_path || `modules/${m._dir || m.id}/${m.thumbnail || "thumb.png"}`;
  return fileURL(S.carpetas.catalogo).replace(/\/$/, "") + "/" + rel;
}

// ==== Página del módulo =========================================================
function familiaDe(m) {
  return m.receta_familia || m.familia || FAMILIA_DE_CATEGORIA[m.category] || null;
}
function tieneReceta(m) {
  return m._source === "creaciones" && !!(S.deps.creador && S.deps.creador.ok);
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
   (con las medidas propias del módulo, salvo «igualar» en gabinetes). */
function disenoDe(m) {
  const g = S.proyecto.global;
  const o = S.proyecto.modulos[m.id];
  const s = m.specs || {};
  const base = { ancho: s.ancho_mm || 600, alto: s.alto_mm || 770, fondo: s.fondo_mm || 578 };
  if (o && o.personalizado) return Object.assign({ modo: "personal" }, base, o, o.medidas || {});
  const d = Object.assign({ modo: "global" }, base, { frente: g.frente, manija: g.manija, material: g.material, tarja: g.tarja });
  if (g.medidas.igualar && tieneReceta(m) && familiaDe(m) === "gabinete") { d.alto = g.medidas.alto; d.fondo = g.medidas.fondo; }
  return d;
}

function abrirModulo(m, tab) {
  S.mod = m;
  S.tab = tab || "diseno";
  S.sec = "modulo";
  pintarSeccion();
}

function nuevoModulo(fam) {
  const man = S.manifiestos[fam];
  if (!man) return aviso("Error: falta el manifiesto de " + fam + " (Royal Catalog Creator)");
  const cat = Object.keys(FAMILIA_DE_CATEGORIA).find((k) => FAMILIA_DE_CATEGORIA[k] === fam);
  abrirModulo({ id: "nuevo-" + fam, name: "Nuevo " + man.titulo.toLowerCase(), category: cat, familia: fam,
    _source: "nuevo", _virtual: true, specs: {}, features: {} }, "avanzado");
}

function pintarModulo() {
  const m = S.mod;
  if (!m) return irA(S.lista);
  const d = disenoDe(m);
  const real = tieneReceta(m);
  $("#md-stamp").textContent = { creaciones: "Creación personalizada", csv: "Fila del CSV", nuevo: "Módulo nuevo" }[m._source] || "Catálogo";
  $("#md-name").textContent = m.name;
  $("#md-tags").innerHTML = Object.values(m.features || {}).flat().map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  setImg($("#md-thumb"), m._virtual ? placeholder("Se genera al terminar") : thumbURL(m));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === S.tab));
  $("#tab-diseno").hidden = S.tab !== "diseno";
  $("#tab-avanzado").hidden = S.tab !== "avanzado";
  $$(".tab")[0].disabled = !!m._virtual;

  const specs = $("#md-specs");
  specs.innerHTML = "";
  Object.entries(m.specs || {}).forEach(([k, v]) => specs.insertAdjacentHTML("beforeend", `<div>${esc(SPEC_LABELS[k] || k)}</div><div>${esc(v)}${k.endsWith("_mm") ? " mm" : ""}</div>`));

  if (S.tab === "diseno") pintarDiseno(m, d, real);
  else pintarAvanzado(m);
}

function pintarDiseno(m, d, real) {
  const personal = d.modo === "personal";
  const fc = cfgFamilia(m);
  const gola = esGola(m);
  pintarSeg($("#md-modo"), [["global", "Configuración del proyecto"], ["personal", "Personalizar este módulo"]], d.modo, (v) => {
    if (v === "personal") {
      const g = disenoDe(m);
      S.proyecto.modulos[m.id] = { personalizado: true, frente: g.frente, manija: g.manija, material: g.material, tarja: g.tarja,
        medidas: { ancho: g.ancho, alto: g.alto, fondo: g.fondo } };
    } else delete S.proyecto.modulos[m.id];
    guardarProyecto();
    pintarModulo();
  });
  $("#md-modo-note").textContent = personal
    ? "Este módulo tiene su propio diseño; el resto del proyecto no cambia."
    : "Sigue el diseño del proyecto (sección Proyecto). Para cambiar solo este, elige «Personalizar este módulo».";

  const o = S.proyecto.modulos[m.id];
  const set = (k, v) => { o.medidas = o.medidas || {}; o.medidas[k] = v; guardarProyecto(); pintarPreviewModulo(m); };
  const md = $("#md-medidas");
  md.innerHTML = "";
  const totales = !real;
  ["ancho", "alto", "fondo"].forEach((k) => md.appendChild(filaMedida(k, d[k], (v) => set(k, v), !personal,
    totales && k !== "ancho" ? (k === "alto" ? "Alto total" : "Fondo total") : null)));

  // Tarja solo donde se puede aplicar de verdad (creación con receta).
  $("#md-tarja-wrap").hidden = !(fc && fc.tarja && real);
  pintarSeg($("#md-tarja"), [["0", "No"], ["1", "Sí · refuerzos para fregadero"]], d.tarja ? "1" : "0", (v) => {
    o.tarja = v === "1"; guardarProyecto(); pintarModulo();
  }, !personal || !real);

  pintarPickers($("#md-pickers"), personal ? o : d, personal, () => { guardarProyecto(); pintarModulo(); }, { gola });
  $("#md-error").hidden = true;
  $("#md-insert").textContent = real ? "Insertar con este diseño" : "Insertar con estas medidas";
  $("#md-insert").onclick = () => insertar(m, d);
  $("#md-asis").onclick = () => insertar(m, null);
  pintarPreviewModulo(m);
}

function pintarPreviewModulo(m) {
  const d = disenoDe(m);
  const gola = esGola(m);
  let lay;
  if (S.tab === "avanzado" && S.av[m.id] && familiaDe(m) === "gabinete") {
    const v = S.av[m.id].reg.valores;
    lay = RKVista.desdeValores(v, { ancho: RKVista.num(v.LenX, 600), alto: RKVista.num(v.LenZ, 770) });
    $("#md-preview").innerHTML = RKVista.svg(lay, disenoSvg({ frente: v.l01_linea_frente, manija: v.d16_z1_tirador_tipo || v.e01_tirador_tipo,
      material: S.av[m.id].material }, v.b01_gola_o_tirador === "2"));
    $("#md-preview-note").textContent = "Vista según las variables de «Avanzado».";
    return;
  }
  if (m.receta && familiaDe(m) === "gabinete") lay = RKVista.desdeValores(m.receta.valores, { ancho: d.ancho, alto: d.alto });
  else {
    lay = RKVista.desdeEtiquetas(Object.assign({}, m, { specs: Object.assign({}, m.specs, { ancho_mm: d.ancho, alto_mm: d.alto }) }));
  }
  $("#md-preview").innerHTML = RKVista.svg(lay, disenoSvg(d, gola));
  $("#md-preview-note").textContent = tieneReceta(m)
    ? "Así quedará: al insertar se regenera la pieza con este diseño."
    : "Vista previa del diseño. Este módulo del catálogo se inserta con su diseño original (solo cambian las medidas); para fabricarlo con este diseño usa «Avanzado».";
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
    nota = "Valores de la receta de esta creación, con el diseño elegido en «Diseño».";
  } else {
    valores = S.rcc.defaultValores(man);
    if (!m._virtual && fam === "gabinete") equivalenteGabinete(man, valores, m);
    nota = m._virtual ? "Valores por defecto del manifiesto." :
      "Este módulo del catálogo viene del componente anterior: aquí se arma uno equivalente con el componente actual (su ancho, y gola, tarja, puertas o cajones según sus etiquetas). Revisa y genera.";
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
      const req = fc.manija && fc.manija.requiere;
      const conTirador = !req || String(valores[req.attr]) === String(req.valor);
      if (fc.manija && d.manija && conTirador) fc.manija.attrs.forEach((a) => RKAvanzado.poner(man, valores, a, d.manija, S.rcc));
    }
  }
  const sku = m.specs && m.specs.sku;
  reg.nombre_salida = m._source === "csv" ? m.name : (sku ? sku + "-P" : S.rcc.autoNombre(man, valores));
  S.av[m.id] = { man, reg, nota, material: m._source === "csv" ? "" : d.material || "", nombreManual: m._source === "csv" || !!sku };
  return S.av[m.id];
}

/* Módulo viejo del catálogo -> punto de partida en el gabinete por zonas,
   leyendo sus etiquetas (gola, tarja, cajones, puertas, lado). */
function equivalenteGabinete(man, v, m) {
  const t = Object.values(m.features || {}).flat().join(" ").toLowerCase();
  const p = (attr, val) => RKAvanzado.poner(man, v, attr, val, S.rcc);
  if (/gola/.test(t)) p("b01_gola_o_tirador", "2");
  if (/tarja/.test(t)) p("i06_trasera", "1");
  const caj = t.match(/(\d+)\s*cajon/);
  if (caj) { p("d01_cantidad_zonas", "1"); p("d11_z1_contenido", "2"); p("d12_z1_cant_cajones", caj[1]); }
  else if (/2 puertas/.test(t)) { p("d01_cantidad_zonas", "1"); p("d11_z1_contenido", "1"); p("d15_z1_cant_puertas", "3"); }
  else if (/1 puerta/.test(t)) { p("d01_cantidad_zonas", "1"); p("d11_z1_contenido", "1"); p("d15_z1_cant_puertas", /derecha/.test(t) ? "2" : "1"); }
}

function pintarAvanzado(m) {
  const st = estadoAvanzado(m);
  const form = $("#av-form");
  if (!st) {
    form.innerHTML = `<p class="empty">${S.rcc ? "Esta familia no tiene manifiesto en Royal Catalog Creator" : "Falta Royal Catalog Creator 1.2+"}</p>`;
    $("#av-generar").disabled = true;
    return;
  }
  $("#av-note").textContent = st.nota + (st.material ? ` Material de frentes: ${(opcion("material", st.material) || {}).nombre || st.material}.` : "");
  const nombre = $("#av-nombre");
  nombre.value = st.reg.nombre_salida;
  nombre.oninput = () => { st.reg.nombre_salida = nombre.value; st.nombreManual = nombre.value.trim() !== ""; };
  $("#av-publicar").checked = m._source === "csv" || m._source === "nuevo";
  $("#av-reset").onclick = () => { delete S.av[m.id]; pintarModulo(); };
  RKAvanzado.montar(form, st.man, st.reg, S.rcc, (errores) => {
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
  if (!insertarEsc && !publicar) return aviso("Error: elige insertar en la escena, guardar en Creaciones, o ambos");
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
      if (fc.manija && d.manija && !esGola(m)) eleccion.manija = d.manija;
      if (fc.material && d.material) eleccion.material = d.material;
      const mat = opcion("material", d.material), fr = opcion("frente", d.frente);
      if (mat && fr && mat.familia === "MDF" && fr.solo_madera) {
        const e = $("#md-error");
        e.textContent = `${mat.nombre} es MDF: solo se fabrica en puerta Lisa.`;
        e.hidden = false;
        return;
      }
    }
  }
  ocupado(true, `Insertando ${m.name}…`);
  bridge("insertar", JSON.stringify({ id: m.id, eleccion }));
}

// ==== CSV ============================================================================
function pintarCsv() {
  const c = S.csv;
  $("#csv-vacio").hidden = !!c;
  $("#csv-tabla-wrap").hidden = !c;
  if (!c) return;
  const imp = c.imp;
  const ok = imp.filas.filter((f) => f.estado !== "error").length;
  $("#csv-resumen").textContent = `${imp.filas.length} filas · ${ok} listas · ${imp.filas.length - ok} con error · ${c.sel.size} seleccionadas`;
  $("#csv-generar").disabled = !c.sel.size || !!c.cola;
  const t = $("#csv-tabla");
  t.innerHTML = "<thead><tr><th></th><th>Nombre</th><th>Familia</th><th>Estado</th><th>Detalle</th><th></th></tr></thead>";
  const tb = document.createElement("tbody");
  imp.filas.forEach((f, i) => {
    const man = S.manifiestos[f.familia];
    const msgs = [f.error].concat(Object.values(f.errores || {})).filter(Boolean);
    const hecho = c.hechos[i];
    const estado = hecho ? hecho.estado : f.estado;
    const tr = document.createElement("tr");
    tr.className = "st-" + estado;
    tr.innerHTML = `<td><input type="checkbox" ${c.sel.has(i) ? "checked" : ""} ${f.estado === "error" ? "disabled" : ""}></td>` +
      `<td><b>${esc(f.nombre || "—")}</b></td><td>${esc(man ? man.titulo : f.familia || "—")}</td>` +
      `<td><span class="pill">${esc({ ok: "Lista", aviso: "Con avisos", error: "Error", generado: "Generada", fallo: "Falló" }[estado] || estado)}</span></td>` +
      `<td class="msgs">${esc(hecho && hecho.msg ? hecho.msg : msgs.concat(f.avisos || []).slice(0, 3).join(" · "))}</td>` +
      `<td><button class="key sm" ${f.valores ? "" : "disabled"}>Editar</button></td>`;
    $("input", tr).onchange = (e) => { e.target.checked ? c.sel.add(i) : c.sel.delete(i); pintarCsv(); };
    $("button", tr).onclick = () => abrirModulo({ id: "csv-" + i, name: f.nombre, category: man && man.titulo, familia: f.familia,
      _source: "csv", _virtual: true, valores: f.valores, specs: {}, features: {} }, "avanzado");
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
    aviso(`CSV: ${n} módulos generados en Creaciones`);
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

// ==== Ajustes ===================================================================
function pintarAjustes() {
  const filas = [
    ["catalogo", "Carpeta del catálogo", "Módulos del catálogo, fotos y opciones (referencias/)."],
    ["creaciones", "Creaciones personalizadas", "Donde se guardan las piezas únicas (.skp + receta)."],
    ["creador", "Proyecto de Royal Catalog Creator", "Debe contener «Main Components» con los componentes base."],
  ];
  $("#aj-carpetas").innerHTML = "";
  filas.forEach(([k, t, d]) => {
    const row = document.createElement("div");
    row.className = "aj-row";
    const malo = k === "creador" && S.carpetas.creador_valido === false;
    row.innerHTML = `<div class="grow"><strong>${esc(t)}</strong><span class="hint">${esc(d)}</span>` +
      `<code class="${malo ? "bad" : ""}">${esc(S.carpetas[k] || "—")}</code></div>` +
      `<button class="key sm">Abrir</button><button class="key sm">Cambiar…</button>`;
    const [abrir, cambiar] = $$("button", row);
    abrir.onclick = () => bridge("abrir_carpeta", k);
    cambiar.onclick = () => bridge("cambiar_carpeta", k);
    $("#aj-carpetas").appendChild(row);
  });
  $("#aj-deps").innerHTML = "";
  Object.entries(S.deps).forEach(([k, d]) => {
    const row = document.createElement("div");
    row.className = "aj-row";
    row.innerHTML = `<div class="dep ${d.ok ? "ok" : "bad"}"><i class="led"></i></div><div class="grow"><strong>${esc(d.nombre)}</strong>` +
      `<span class="hint">${d.cargado ? `Versión ${esc(d.version)} · requiere ${esc(d.minimo)}+` : "No está instalado o no cargó"}</span></div>` +
      `<button class="key sm" ${d.cargado ? "" : "disabled"}>Abrir su ventana</button>`;
    $("button", row).onclick = () => bridge("abrir_plugin", k);
    $("#aj-deps").appendChild(row);
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

$$(".nav-btn").forEach((b) => (b.onclick = () => irA(b.dataset.sec)));
$$(".tab").forEach((t) => (t.onclick = () => { S.tab = t.dataset.tab; pintarModulo(); }));
$("#md-back").onclick = () => irA(S.mod && S.mod._source === "csv" ? "csv" : S.lista);
$("#q").addEventListener("input", (e) => { S.q = e.target.value; pintarLista(); });
$("#pk-close").onclick = () => ($("#picker").hidden = true);
$("#pk-q").addEventListener("input", pintarPicker);
$("#picker").addEventListener("click", (e) => { if (e.target.id === "picker") $("#picker").hidden = true; });
$("#csv-importar").onclick = () => { $("#csv-importar").disabled = true; bridge("importar_csv"); };
$("#csv-plantilla").onclick = () => { $("#csv-plantilla").disabled = true; bridge("plantilla"); };
$("#csv-generar").onclick = csvGenerar;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#picker").hidden = true; });

irA("proyecto");
bridge("listo");
