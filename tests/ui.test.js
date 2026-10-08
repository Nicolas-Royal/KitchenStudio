/* Pruebas de la UI sin navegador:  node tests/ui.test.js
   Necesita el repo hermano KitchenCreator (manifiestos + RCC_CORE). */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const RAIZ = path.join(__dirname, "..", "..");
const KC = path.join(RAIZ, "KitchenCreator", "plugin", "royal_catalog_creator");
const UI = path.join(__dirname, "..", "src", "royal_kitchens_studio", "ui");

const doc = { readyState: "loading", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return {}; } };
const w = {};
new Function("window", "document", "console", fs.readFileSync(path.join(KC, "html", "js", "app.js"), "utf8"))(w, doc, console);
const rcc = w.RCC_CORE;
new Function("window", fs.readFileSync(path.join(UI, "vista.js"), "utf8"))(w);
new Function("window", "document", "RKVista", fs.readFileSync(path.join(UI, "avanzado.js"), "utf8"))(w, doc, w.RKVista);
const { RKVista, RKAvanzado } = w;

let n = 0;
function prueba(nombre, fn) { fn(); n++; console.log("ok - " + nombre); }

const man = {};
["gabinete", "alacena", "esquinero"].forEach((f) => { man[f] = JSON.parse(fs.readFileSync(path.join(KC, "manifest", f + ".json"), "utf8")); });

prueba("RCC_CORE expone lo que usa Studio", () => {
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
  const a = RKVista.svg(lay, { frente: "3", manija: { forma: "barra", color: "#111111" }, material: { color: "#3b2a20", veta: true } });
  const b = RKVista.svg(lay, { frente: "1", manija: null, material: null });
  assert.ok(/<svg/.test(a) && /#3b2a20/.test(a) && /#111111/.test(a));
  assert.notStrictEqual(a.match(/id="(rk-mat-\d+)"/)[1], b.match(/id="(rk-mat-\d+)"/)[1], "ids de patrón únicos");
});

prueba("vista: módulo viejo por etiquetas", () => {
  const lay = RKVista.desdeEtiquetas({ category: "Gabinetes", specs: { ancho_mm: 800, alto_mm: 753 }, features: { configuracion: ["2 cajones"] } });
  assert.deepStrictEqual([lay.ancho, lay.zonas[0].tipo, lay.zonas[0].n], [800, "cajones", 2]);
});

const op = JSON.parse(fs.readFileSync(path.join(RAIZ, "KitchenCatalog", "catalog", "referencias", "opciones.json"), "utf8"));
prueba("opciones.json: cada material tiene tono y cada manija (salvo «sin») su forma", () => {
  op.materiales.forEach((m) => assert.ok(/^#[0-9a-f]{6}$/i.test(m.color), m.id));
  op.tiradores.filter((t) => t.id !== "1").forEach((t) => assert.ok(t.vista && t.vista.forma, t.id));
});

console.log(`${n}/${n} pruebas OK`);
