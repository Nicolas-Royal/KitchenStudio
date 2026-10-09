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
const { RKVista, RKAvanzado } = w;

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

console.log(`${n}/${n} pruebas OK`);
