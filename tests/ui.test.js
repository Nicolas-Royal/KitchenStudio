/* Pruebas de la UI sin navegador:  node tests/ui.test.js
   Todo sale de este repo: ui/*.js, familias/*.json y catalogo/. */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const FAM = path.join(__dirname, "..", "src", "royal_kitchens_studio", "familias");
const UI = path.join(__dirname, "..", "src", "royal_kitchens_studio", "ui");

const doc = { readyState: "loading", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return {}; } };
const w = {};
new Function("window", fs.readFileSync(path.join(UI, "receta.js"), "utf8"))(w);
const rcc = w.RCC_CORE;
new Function("window", fs.readFileSync(path.join(UI, "vista.js"), "utf8"))(w);
new Function("window", "document", "RKVista", fs.readFileSync(path.join(UI, "avanzado.js"), "utf8"))(w, doc, w.RKVista);
new Function("window", fs.readFileSync(path.join(UI, "entrepanos.js"), "utf8"))(w);
const { RKVista, RKAvanzado, RKEntrepanos } = w;

let n = 0;
function prueba(nombre, fn) { fn(); n++; console.log("ok - " + nombre); }

const man = {};
["gabinete", "alacena", "esquinero"].forEach((f) => { man[f] = JSON.parse(fs.readFileSync(path.join(FAM, f + ".json"), "utf8")); });

prueba("receta.js expone lo que usa Studio", () => {
  ["defaultValores", "erroresConfig", "flatten", "nombresDivisores", "fieldVisible", "fieldEnabled", "groupEnabled",
   "valorForzado", "aplicarForzados", "effectiveValue", "construirImportacion", "autoNombre", "presupuestoCajones"]
    .forEach((k) => assert.strictEqual(typeof rcc[k], "function", k));
});

Object.keys(man).forEach((fam) => {
  prueba(`${fam}: receta -> formulario -> fila plana es idéntica`, () => {
    const reg = { familia: fam, valores: rcc.defaultValores(man[fam]) };
    const fila = rcc.flatten(man[fam], reg);
    const vuelta = { familia: fam, valores: RKAvanzado.valoresDesdeFila(man[fam], fila, rcc) };
    assert.deepStrictEqual(rcc.flatten(man[fam], vuelta), fila);
  });
});

prueba("gabinete: la suma (zoclo, puerta) no se duplica al reabrir", () => {
  const reg = { familia: "gabinete", valores: rcc.defaultValores(man.gabinete) };
  reg.valores.LenZ = "720"; reg.valores.a02_alto_zoclo = "120";
  const fila = rcc.flatten(man.gabinete, reg);
  assert.strictEqual(fila.LenZ, "840mm");
  const v = RKAvanzado.valoresDesdeFila(man.gabinete, fila, rcc);
  assert.strictEqual(v.LenZ, "720");
});

prueba("poner() escribe por attr y respeta forzados", () => {
  const v = rcc.defaultValores(man.gabinete);
  assert.ok(RKAvanzado.poner(man.gabinete, v, "l01_linea_frente", "3", rcc));
  assert.strictEqual(v.l01_linea_frente, "3");
  assert.ok(!RKAvanzado.poner(man.gabinete, v, "no_existe", "1", rcc));
});

prueba("vista: distribución desde la receta", () => {
  const lay = RKVista.desdeValores({ d01_cantidad_zonas: "2", d11_z1_contenido: "1", d15_z1_cant_puertas: "3",
    d31_z2_contenido: "2", d32_z2_cant_cajones: "3", a02_alto_zoclo: "100mm", b01_gola_o_tirador: "2" }, { ancho: 600, alto: 770 });
  assert.strictEqual(lay.zonas.length, 2);
  assert.deepStrictEqual([lay.zonas[0].tipo, lay.zonas[0].n, lay.zonas[1].tipo, lay.zonas[1].n], ["puerta", 2, "cajones", 3]);
  assert.strictEqual(lay.zonas[0].h + lay.zonas[1].h, 770);
  assert.ok(lay.gola);
});

prueba("vista: SVG con material, frente y manija", () => {
  const lay = RKVista.desdeValores({}, { ancho: 450, alto: 700 });
  const a = RKVista.svg(lay, { frente: "3", manijaPuerta: { forma: "barra", color: "#111111" },
    manijaCajon: { forma: "barra", color: "#111111" }, material: { color: "#3b2a20", veta: true } });
  const b = RKVista.svg(lay, { frente: "1", manijaPuerta: null, manijaCajon: null, material: null });
  assert.ok(/<svg/.test(a) && /#3b2a20/.test(a) && /#111111/.test(a));
  assert.notStrictEqual(a.match(/id="(rk-mat-\d+)"/)[1], b.match(/id="(rk-mat-\d+)"/)[1], "ids de patrón únicos");
});

prueba("vista: módulo viejo por etiquetas", () => {
  const lay = RKVista.desdeEtiquetas({ category: "Gabinetes", specs: { ancho_mm: 800, alto_mm: 753 }, features: { configuracion: ["2 cajones"] } });
  assert.deepStrictEqual([lay.ancho, lay.zonas[0].tipo, lay.zonas[0].n], [800, "cajones", 2]);
});

const CAT = path.join(__dirname, "..", "src", "royal_kitchens_studio", "catalogo");
const op = JSON.parse(fs.readFileSync(path.join(CAT, "opciones.json"), "utf8"));
prueba("opciones.json: cada material tiene tono y cada manija (salvo «sin») su forma", () => {
  op.materiales.forEach((m) => assert.ok(/^#[0-9a-f]{6}$/i.test(m.color), m.id));
  op.tiradores.filter((t) => t.id !== "1").forEach((t) => assert.ok(t.vista && t.vista.forma, t.id));
});

prueba("catálogo propio: cada frente y manija (salvo «sin») tiene su foto en catalogo/", () => {
  op.frentes.concat(op.tiradores.filter((t) => t.id !== "1")).forEach((o) => {
    assert.ok(o.foto && fs.existsSync(path.join(CAT, o.foto)), `${o.nombre}: ${o.foto}`);
    assert.strictEqual(parseInt(path.basename(o.foto), 10), Number(o.id), `la foto de ${o.nombre} lleva su id`);
  });
});

prueba("vista: manija distinta en puertas y en cajones", () => {
  const lay = RKVista.desdeValores({ d01_cantidad_zonas: "2", d11_z1_contenido: "1", d15_z1_cant_puertas: "3",
    d31_z2_contenido: "2", d32_z2_cant_cajones: "3" }, { ancho: 600, alto: 770 });
  const s = RKVista.svg(lay, { frente: "1", manijaPuerta: { forma: "lateral", color: "#101010" },
    manijaCajon: { forma: "concha", color: "#d4b04c" }, material: null });
  assert.strictEqual((s.match(/#101010/g) || []).length, 2, "una lateral por hoja de la puerta doble");
  assert.strictEqual((s.match(/fill="#d4b04c"/g) || []).length, 3, "una concha por cajón");
});

new Function("window", fs.readFileSync(path.join(UI, "reglas.js"), "utf8"))(w);
const R = w.RKReglas;
new Function("window", fs.readFileSync(path.join(UI, "muebles.js"), "utf8"))(w);
const MU = w.RKMuebles;
prueba("reglas: concha solo en cajones, Berlín solo con Lisa, Lateral negra al centro en puertas", () => {
  assert.ok(/no se usa en puertas/.test(R.manija(op, "puerta", "15", "1")));
  assert.strictEqual(R.manija(op, "cajon", "15", "1"), "");
  assert.ok(/solo con frente Lisa/.test(R.manija(op, "cajon", "21", "3")));
  assert.strictEqual(R.manija(op, "puerta", "21", "1"), "");
  assert.strictEqual(R.posicion(op, "puerta", "7"), "5");
  assert.strictEqual(R.posicion(op, "cajon", "7"), null);
  assert.ok(/Concha/.test(R.diseno(op, { frente: "1", manija_puerta: "15", manija_cajon: "9" }, false)));
  assert.strictEqual(R.diseno(op, { frente: "1", manija_puerta: "15" }, true), "", "con gola no hay manija");
  const mdf = op.materiales.find((m) => m.familia === "MDF");
  assert.ok(/MDF/.test(R.diseno(op, { frente: "3", material: mdf.id }, false)));
});

prueba("reglas en «Avanzado»: concha en puertas y Lateral negra fuera del centro", () => {
  const fam = op.familias.gabinete;
  const v = rcc.flatten(man.gabinete, { familia: "gabinete", valores: rcc.defaultValores(man.gabinete) });
  assert.deepStrictEqual(R.receta(op, fam, v), [], "la receta por defecto se puede fabricar");
  const msgs = R.receta(op, fam, Object.assign({}, v, { d16_z1_tirador_tipo: "15", d36_z2_tirador_tipo: "7",
    d37_z2_tirador_posicion: "2", e01_tirador_tipo: "15" })).map((e) => e.msg);
  assert.ok(msgs.some((m) => /Concha dorada no se usa en puertas/.test(m)));
  assert.ok(msgs.some((m) => /Lateral negra en puertas va en posición Centro - Centro/.test(m)));
  assert.strictEqual(msgs.length, 2, "concha en cajones sí se puede");
  assert.deepStrictEqual(R.receta(op, fam, Object.assign({}, v, { b01_gola_o_tirador: "2", d16_z1_tirador_tipo: "15" })), [], "con gola no aplica");
});

new Function("window", fs.readFileSync(path.join(UI, "proyectos.js"), "utf8"))(w);
const P = w.RKProyectos;
const ahora = new Date("2026-10-09T18:00:00Z");
const lista = [
  { folio: "P-100", cliente: "Familia Pérez", estado: "diseno", disenadora: { usuario: "ana", nombre: "Ana" }, actualizado: { fecha: "2026-10-08T10:00:00Z" } },
  { folio: "P-101", cliente: "Ramírez", estado: "planeacion", disenadora: { usuario: "luz", nombre: "Luz" }, actualizado: { fecha: "2026-10-09T17:30:00Z", nombre: "Luz" } },
];

prueba("proyectos: filtrar por mías, estado y texto sin acentos", () => {
  assert.deepStrictEqual(P.filtrar(lista, { alcance: "mios", usuario: "ana" }).map((p) => p.folio), ["P-100"]);
  assert.deepStrictEqual(P.filtrar(lista, { alcance: "todos", estado: "planeacion" }).map((p) => p.folio), ["P-101"]);
  assert.deepStrictEqual(P.filtrar(lista, { alcance: "todos", q: "perez" }).map((p) => p.folio), ["P-100"]);
  assert.deepStrictEqual(P.filtrar(lista, { alcance: "todos", q: "luz" }).map((p) => p.folio), ["P-101"]);
});

prueba("proyectos: lo último actualizado primero", () => {
  assert.deepStrictEqual(P.ordenar(lista).map((p) => p.folio), ["P-101", "P-100"]);
});

prueba("proyectos: hace cuánto y fecha compromiso", () => {
  assert.strictEqual(P.haceCuanto("2026-10-09T17:30:00Z", ahora), "hace 30 min");
  assert.strictEqual(P.haceCuanto("2026-10-09T15:00:00Z", ahora), "hace 3 h");
  assert.strictEqual(P.haceCuanto("2026-10-08T12:00:00Z", ahora), "ayer");
  assert.deepStrictEqual(P.compromiso("2026-10-01", ahora), { texto: "01/10/2026", vencida: true });
  assert.strictEqual(P.compromiso("", ahora), null);
});

prueba("proyectos: candado vigente, propio y vencido", () => {
  const c = { usuario: "ana", nombre: "Ana", desde: "2026-10-09T17:00:00Z", latido: "2026-10-09T17:50:00Z" };
  assert.ok(!P.candado(c, "luz", ahora).propio);
  assert.ok(/Ana/.test(P.candado(c, "luz", ahora).texto));
  assert.ok(P.candado(c, "ana", ahora).propio);
  assert.strictEqual(P.candado(Object.assign({}, c, { latido: "2026-10-09T17:00:00Z" }), "luz", ahora), null);
});

prueba("proyectos: etiqueta de sincronía", () => {
  assert.strictEqual(P.sincronia({ folio: null }), null);
  assert.strictEqual(P.sincronia({ folio: "x", modo: "consulta", sincronia: "ok" }).texto, "Solo lectura");
  assert.strictEqual(P.sincronia({ folio: "x", modo: "edicion", sincronia: "conflicto" }).clase, "bad");
});

prueba("entrepaños: arrastrar una repisa mueve solo sus dos espacios y respeta el mínimo", () => {
  assert.deepStrictEqual(RKEntrepanos.arrastreAlto([200, 200, 300], 0, 50), [250, 150, 300]);
  assert.deepStrictEqual(RKEntrepanos.arrastreAlto([200, 200, 300], 1, -500), [200, 10, 490]);
  assert.deepStrictEqual(RKEntrepanos.arrastreAlto([200, 200, 300], 0, 500), [390, 10, 300]);
  assert.strictEqual(RKEntrepanos.arrastreRetiro(-20, 560), 0);
  assert.strictEqual(RKEntrepanos.arrastreRetiro(900, 560), 510);
});

prueba("entrepaños: lo que escribe el gráfico lo lee la geometría y la fila", () => {
  const m = man.gabinete, V = m.grupos.find((g) => g.visual).visual;
  const reg = { familia: "gabinete", valores: rcc.defaultValores(m) };
  const id = (attr) => rcc.fieldByAttr(m, attr).id;
  reg.valores[id("h01_entrepano")] = "0";
  reg.valores[id(V.cantidad)] = "2";
  const G0 = rcc.geomEntrepanos(m, reg.valores, V);
  const e = RKEntrepanos.arrastreAlto(G0.espacios, 0, 40);
  reg.valores[id(V.modo)] = V.modo_personalizado;
  reg.valores[id(V.espacios[0])] = String(Math.round(e[0]));
  reg.valores[id(V.espacios[1])] = String(Math.round(e[1]));
  reg.valores[id(V.retiros[1])] = "0mm";
  const G = rcc.geomEntrepanos(m, reg.valores, V);
  assert.ok(G.personal && G.n === 2);
  assert.strictEqual(G.espacios[0], Math.round(e[0]));
  assert.ok(Math.abs(G.espacios.reduce((a, b) => a + b, 0) + 2 * G.esp - G.alto) < 0.01);
  assert.ok(!G.repisas[0].divisor && G.repisas[1].divisor);
  assert.strictEqual(rcc.flatten(m, reg)[V.espacios[0]], Math.round(e[0]) + "mm");
});

prueba("muebles: origen y de dónde sale el diseño en el proyecto", () => {
  const cat = { id: "a", clase: "catalogo" }, usr = { id: "b", clase: "usuario", creado_por: { usuario: "ana", nombre: "Ana" } };
  assert.strictEqual(MU.clase({}), "catalogo");
  assert.strictEqual(MU.clase({ clase: "personalizado" }), "usuario");
  assert.strictEqual(MU.etiqueta(cat), "Catálogo");
  assert.strictEqual(MU.etiqueta(usr), "Creado por Ana");
  assert.strictEqual(MU.etiqueta({ clase: "usuario" }), "Creado por usuario");
  // Todos parten del diseño del proyecto; el catálogo nunca va con el original.
  assert.strictEqual(MU.modo(cat, undefined), "global");
  assert.strictEqual(MU.modo(cat, undefined, "original"), "global");
  assert.strictEqual(MU.modo(cat, { original: true }), "global");
  assert.strictEqual(MU.modo(cat, { personalizado: true }), "personal");
  assert.strictEqual(MU.modo(usr, undefined), "global");
  assert.strictEqual(MU.modo(usr, { original: true }), "original");
  // «Ver con: Original» del filtro vale para los que no tienen elección propia.
  assert.strictEqual(MU.modo(usr, undefined, "original"), "original");
  assert.strictEqual(MU.modo(usr, { personalizado: true }, "original"), "personal");
  assert.deepStrictEqual(MU.modos(cat).map((x) => x[0]), ["global", "personal"]);
  assert.deepStrictEqual(MU.modos(usr).map((x) => x[0]), ["global", "original", "personal"]);
});

prueba("muebles: diseño original desde la receta y alcance del diseño del proyecto", () => {
  const fc = JSON.parse(fs.readFileSync(path.join(UI, "..", "catalogo", "opciones.json"), "utf8")).familias.gabinete;
  const d = MU.disenoOriginal(fc, { l01_linea_frente: "3", d16_z1_tirador_tipo: "11", e01_tirador_tipo: "15", c16_material_puerta: "MDF_X", i06_trasera: "1" });
  assert.deepStrictEqual(d, { frente: "3", manija_puerta: "11", manija_cajon: "15", material: "MDF_X", tarja: true });
  assert.deepStrictEqual(MU.disenoOriginal(fc, {}), { frente: "", manija_puerta: "", manija_cajon: "", material: "", tarja: false });
  const a = MU.alcance(fc, false, false);
  assert.ok(a.cambia.includes("manijas") && a.cambia.includes("frente") && a.fijo.includes("medidas"));
  const g = MU.alcance(fc, true, true);
  assert.ok(!g.cambia.includes("manijas") && g.cambia.includes("ancho, alto y fondo") && g.fijo.some((x) => /gola/.test(x)));
});

prueba("muebles: filtros por clase, tipo y texto, con conteos", () => {
  const l = [{ id: "1", name: "Gab A", category: "Gabinetes" }, { id: "2", name: "Gab B", category: "Gabinetes", clase: "usuario", creado_por: { nombre: "Ana" } },
    { id: "3", name: "Ala C", category: "Alacenas", features: { tipo: ["Avento"] } }];
  assert.deepStrictEqual(MU.filtrar(l, {}).map((m) => m.id), ["1", "2", "3"]);
  assert.deepStrictEqual(MU.filtrar(l, { clase: "catalogo", cat: "Gabinetes" }).map((m) => m.id), ["1"]);
  assert.deepStrictEqual(MU.filtrar(l, { clase: "usuario" }).map((m) => m.id), ["2"]);
  assert.deepStrictEqual(MU.filtrar(l, { q: "ana" }).map((m) => m.id), ["2"]);
  assert.deepStrictEqual(MU.filtrar(l, { q: "avento" }).map((m) => m.id), ["3"]);
  assert.deepStrictEqual(MU.conteos(l), { clase: { catalogo: 2, usuario: 1 }, cat: { Gabinetes: 2, Alacenas: 1 } });
});

prueba("muebles: características de la barra lateral, sin entrepaños", () => {
  const mk = (id, tipo, conf, ancho) => ({ id, name: id, category: "Gabinetes", features: { tipo, configuracion: conf, puerta: ["Lisa"] }, specs: { ancho_mm: ancho } });
  const l = [mk("a", ["Tirador", "Entrepaño"], ["2 zonas"], 600), mk("b", ["Gola", "Tarja"], ["2 zonas"], 900), mk("c", ["Gola"], ["1 zona"], 600)];
  const f = MU.facetas(l, {});
  assert.deepStrictEqual(f.map((g) => g.id), ["tipo", "configuracion", "puerta", "ancho"]);
  assert.deepStrictEqual(f[0].opciones.map((o) => [o.valor, o.n]), [["Gola", 2], ["Tarja", 1], ["Tirador", 1]]);
  assert.deepStrictEqual(f[3].opciones.map((o) => o.valor), ["600 mm", "900 mm"]);
  // Dentro de un grupo suma; entre grupos se cumplen todos.
  assert.deepStrictEqual(MU.filtrar(l, { car: { ancho: ["600 mm", "900 mm"], tipo: ["Gola"] } }).map((m) => m.id), ["b", "c"]);
  assert.deepStrictEqual(MU.filtrar(l, { car: { tipo: ["Gola"], configuracion: ["1 zona"] } }).map((m) => m.id), ["c"]);
  assert.deepStrictEqual(MU.filtrar(l, { car: { tipo: [] } }).length, 3);
  // Los conteos de un grupo no se restringen por su propia elección, sí por la de los demás.
  const g = MU.facetas(l, { tipo: ["Gola"] });
  assert.deepStrictEqual(g[0].opciones.map((o) => [o.valor, o.n, o.activo]), [["Gola", 2, true], ["Tarja", 1, false], ["Tirador", 1, false]]);
  assert.deepStrictEqual(g[3].opciones.map((o) => [o.valor, o.n]), [["600 mm", 1], ["900 mm", 1]]);
});

console.log(`${n}/${n} pruebas OK`);
