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

prueba("vista: alacena sin zoclo, con su puerta o Avento y la manija abajo", () => {
  const med = { ancho: 800, alto: 700 };
  const p = RKVista.desdeAlacena({ c25tipopuerta: "1", d15_cant_puertas: "3" }, med);
  assert.deepStrictEqual([p.zoclo, p.abajo, p.zonas[0].tipo, p.zonas[0].n, p.zonas[0].h], [0, true, "puerta", 2, 700]);
  const s = RKVista.desdeAlacena({ c25tipopuerta: "6", d21_avento_cant_puertas: "2" }, med);
  assert.deepStrictEqual([s.zonas[0].tipo, s.zonas[0].n, s.zonas[0].filas], ["avento", 2, 1]);
  const d = RKVista.desdeAlacena({ c25tipopuerta: "10", d23_avento_d_tipo: "3" }, med);
  assert.deepStrictEqual([d.zonas[0].filas, d.zonas[0].unidas], [2, true]);
  assert.strictEqual(RKVista.desdeAlacena({ c25tipopuerta: "0" }, med).zonas[0].tipo, "abierto");
  // La barra de la puerta va en la mitad de abajo; en el Avento D unido solo la hoja de abajo lleva manija.
  const barra = { forma: "barra", color: "#123456" };
  const yBarras = (svg) => [...svg.matchAll(/<rect x="[\d.-]+" y="([\d.-]+)"[^>]*fill="#123456"/g)].map((x) => parseFloat(x[1]));
  assert.ok(yBarras(RKVista.svg(p, { frente: "1", manijaPuerta: barra })).every((y) => y > 350), "abatible: abajo");
  const ys = yBarras(RKVista.svg(d, { frente: "1", manijaPuerta: barra }));
  assert.ok(ys.length === 1 && ys[0] > 600, "Avento D unido: una manija, abajo");
});

prueba("vista: esquinero en isométrica desde la esquina, una manija en cada hoja junto a ella", () => {
  const v = { c25tipopuerta: "1", a0101profizq: "578", a0102profder: "578", a02zocalo: "100" };
  const lay = RKVista.desdeEsquinero(v, { ancho: 1000, alto: 770, fondo: 900 });
  assert.deepStrictEqual([lay.esquinero, lay.izq, lay.der, lay.profIzq, lay.profDer, lay.alto, lay.zoclo, lay.abierto],
    [true, 1000, 900, 578, 578, 770, 100, false]);
  assert.strictEqual(RKVista.desdeEsquinero({ c25tipopuerta: "0" }, { ancho: 1000, alto: 770, fondo: 1000 }).zonas[0].tipo, "abierto");
  // Una profundidad mayor que el ala de enfrente no deja la hoja en negativo.
  assert.strictEqual(RKVista.desdeEsquinero({ a0101profizq: "950" }, { ancho: 1000, alto: 770, fondo: 900 }).profIzq, 800);
  // Cuatro caras inclinadas (dos costados y dos frentes), cada frente con su manija junto a la esquina.
  // Las tablas de arriba van en el plano de la tapa (su matriz lleva -0.7071 en el tercer término).
  const TAPA = "0.7071 0.2988 -0.7071";
  const grupos = (svg) => svg.split('<g transform="matrix(').slice(1);
  // Los cantos de los refuerzos también van en una matriz: son las caras de 18 mm de alto.
  const esCanto = (c) => /^[^>]*><rect x="0\.0" y="0\.0" width="[\d.]+" height="18\.0"/.test(c);
  const caras = (svg) => grupos(svg).filter((c) => !c.startsWith(TAPA) && !esCanto(c));
  const barra = { forma: "barra", color: "#123456" };
  const s = caras(RKVista.svg(lay, { frente: "1", manijaPuerta: barra }));
  assert.strictEqual(s.length, 4);
  const conManija = s.filter((c) => c.includes('fill="#123456"'));
  assert.strictEqual(conManija.length, 2, "una manija en cada hoja");
  // Junto a la esquina: en la hoja derecha (la cara empieza en la esquina) al inicio, en la izquierda al final.
  const xDe = (c) => parseFloat(/<rect x="([\d.-]+)"[^>]*fill="#123456"/.exec(c)[1]);
  const der = conManija.find((c) => c.startsWith("0.7071 0.2988")), izq = conManija.find((c) => c.startsWith("0.7071 -0.2988"));
  // Eje a 70 mm del canto de la esquina (barra de 10 mm de ancho; la hoja empieza 3 mm adentro), como en ESQUINERO.skp.
  assert.strictEqual(xDe(der), 3 + 70 - 5, "derecha a 70 mm de la esquina");
  assert.strictEqual(xDe(izq), (1000 - 578) - 3 - 70 - 5, "izquierda a 70 mm de la esquina");
  // Berlín va en las dos hojas.
  const perfil = { forma: "perfil", color: "#123456" };
  assert.strictEqual([...RKVista.svg(lay, { frente: "1", manijaPuerta: perfil }).matchAll(/<rect [^>]*fill="#123456"/g)].length, 2);
  assert.ok(RKVista.svg(lay, { frente: "1" }).includes("1000 × 900 · alto 770 mm"));
  // Arriba va abierto: el interior con su degradado oscuro y, encima, 4 cantos y 4 refuerzos acostados en la tapa.
  const arriba = RKVista.svg(lay, { frente: "1" });
  assert.ok(/fill="url\(#rk-mat-\d+-interior\)"/.test(arriba), "interior oscuro");
  assert.strictEqual((arriba.match(/<polygon /g) || []).length, 6, "sombra, interior y los dos costados (cuerpo y sombra)");
  // El fondo es una capa de abajo: va antes que los frentes y que las tablas, y un grosor más abajo.
  const iInt = arriba.indexOf("-interior)"), iFrente = arriba.indexOf('<g transform="matrix(0.7071 -0.2988'), iTabla = arriba.indexOf(TAPA);
  assert.ok(iInt < iFrente && iInt < iTabla, "interior antes que frentes y tablas");
  assert.strictEqual(grupos(arriba).filter((c) => c.startsWith(TAPA)).length, 10, "4 cantos de pared, 4 refuerzos y el canto de las 2 puertas");
  // Los refuerzos se ven como tablones: el canto que mira al interior (los dos traseros y el delantero
  // izquierdo donde cruza el ala derecha); del frente no se ve (da a la puerta).
  assert.strictEqual(grupos(arriba).filter(esCanto).length, 5, "cara interior de los 2 respaldos y 3 cantos de refuerzo hacia el interior");
  // La veta corre a lo largo de cada tabla: las largas en y llevan el patrón girado (-v), las largas en x el base.
  const conVeta = { color: "#8b5a3c", veta: true, textura: { url: "veta.png", ancho: 1800, alto: 400, luminancia: 215 } };
  const tablas = grupos(RKVista.svg(lay, { frente: "1", material: conVeta })).filter((c) => c.startsWith(TAPA)).map((c) => {
    const [, w, h, pat] = /width="([\d.]+)" height="([\d.]+)" fill="url\(#rk-mat-\d+(-v)?\)"/.exec(c) || [];
    return parseFloat(w) >= parseFloat(h) ? !pat : pat === "-v";
  });
  assert.ok(tablas.length === 10 && tablas.every(Boolean), "veta a lo largo: " + tablas);
  // Con gola, los delanteros se recorren lo que mide la gola (27 aluminio, 45 melamina).
  assert.strictEqual(RKVista.desdeEsquinero({ b01_gola_o_tirador: "2", g01_perfil_tipo: "2" }, { ancho: 1000, alto: 770, fondo: 900 }).golaProf, 45);
  // El estilo de frente (Mitered: ingletes) se dibuja en las dos hojas.
  assert.strictEqual(caras(RKVista.svg(lay, { frente: "3" })).filter((c) => /<path d="M[\d.]+ [\d.]+L/.test(c)).length, 2);
  // Con gola: el canal arriba de las dos hojas y sin manija.
  const g = RKVista.desdeEsquinero(Object.assign({}, v, { b01_gola_o_tirador: "2" }), { ancho: 1000, alto: 770, fondo: 900 });
  assert.strictEqual(g.gola, true);
  assert.strictEqual([...RKVista.svg(g, { frente: "1", manijaPuerta: barra }).matchAll(/<rect [^>]*fill="#123456"/g)].length, 0);
  // El canal va metido, en L: arriba del frente no se pinta nada (la puerta baja 40 mm) y cada costado lleva su muesca.
  const gsvg = RKVista.svg(g, { frente: "1" });
  const frentes = caras(gsvg).filter((c) => /^0\.7071 (-?)0\.2988 0 0\.9063 [\d.-]+ [\d.-]+\)"><rect x="0\.0" y="40\.0"/.test(c));
  assert.strictEqual(frentes.length, 2, "los dos frentes empiezan 40 mm abajo");
  assert.strictEqual(caras(gsvg).filter((c) => /<polygon points="(?:[\d.-]+,[\d.-]+ ){5}[\d.-]+,[\d.-]+"/.test(c)).length, 2, "costados con muesca");
  // Según su tipo: aluminio con el color del perfil (piso del canal y labio); melamina con el material del mueble.
  assert.strictEqual(g.golaTipo, "1");
  const alu = RKVista.svg(g, { frente: "1", golaColor: "#2a2c2e", material: conVeta });
  assert.ok(/<polygon [^>]*fill="#2a2c2e"/.test(alu), "piso del canal de aluminio");
  assert.strictEqual(grupos(alu).filter((c) => c.startsWith(TAPA) && c.includes('fill="#2a2c2e"')).length, 2, "labio del perfil en las dos alas");
  const m = RKVista.desdeEsquinero(Object.assign({}, v, { b01_gola_o_tirador: "2", g01_perfil_tipo: "2" }), { ancho: 1000, alto: 770, fondo: 900 });
  const mel = RKVista.svg(m, { frente: "1", golaColor: "#e2dccf", material: conVeta });
  assert.ok(!mel.includes('fill="#e2dccf"'), "la melamina va del material del mueble");
  assert.ok(/<polygon [^>]*fill="url\(#rk-mat-\d+\)"/.test(mel), "piso del canal de melamina");
  assert.strictEqual(RKVista.desdeEsquinero(Object.assign({}, v, { b01_gola_o_tirador: "2", c25tipopuerta: "0" }), { ancho: 1000, alto: 770, fondo: 900 }).gola, false);
});

prueba("vista: gabinete y alacena en axonométrica desde el frente, como el esquinero", () => {
  // 30° en planta: frente (avanza en x) y costado derecho (avanza en -y); tablas acostadas en la tapa.
  const FRENTE = "0.8660 0.2113 0 0.9063", COSTADO = "0.5000 -0.3660 0 0.9063", TAPA = "0.8660 0.2113 -0.5000 0.3660";
  const grupos = (svg) => svg.split('<g transform="matrix(').slice(1);
  const de = (svg, m) => grupos(svg).filter((c) => c.startsWith(m));
  const gab = RKVista.desdeValores({ d01_cantidad_zonas: "2", d11_z1_contenido: "1", d15_z1_cant_puertas: "3",
    d31_z2_contenido: "2", d32_z2_cant_cajones: "3", LenY: "580" }, { ancho: 600, alto: 770 });
  assert.deepStrictEqual([gab.fondo, gab.esp, gab.espPuerta, gab.techo], [580, 18, 18, "4"]);
  const barra = { forma: "barra", color: "#123456" };
  const s = RKVista.svg(gab, { frente: "1", manijaPuerta: barra, manijaCajon: barra });
  // El frente lleva las 2 hojas y los 3 cajones con su manija; el costado, en sombra, ninguna.
  const frente = de(s, FRENTE).find((c) => c.includes('fill="#123456"'));
  assert.strictEqual((frente.match(/fill="#123456"/g) || []).length, 5);
  assert.strictEqual(de(s, COSTADO).filter((c) => c.includes("<polygon")).length, 1, "un costado");
  // Arriba abierto: interior oscuro debajo de todo; canto de la puerta, 2 laterales, respaldo y 2 refuerzos.
  assert.ok(s.indexOf("-interior)") < s.indexOf(FRENTE + " "), "el interior va antes que el frente");
  assert.strictEqual(de(s, TAPA).length, 6);
  const sinTrasero = RKVista.svg(RKVista.desdeValores({ i03_tipo_techo: "2" }, { ancho: 600, alto: 770 }), { frente: "1" });
  assert.strictEqual(de(sinTrasero, TAPA).length, 5, "amarre frontal: un solo refuerzo");
  const techo = RKVista.svg(RKVista.desdeValores({ i03_tipo_techo: "5" }, { ancho: 600, alto: 770 }), { frente: "1" });
  assert.ok(!techo.includes("-interior)") && de(techo, TAPA).length === 2, "techo completo: cerrado");
  // Con gola: el frente empieza 40 mm abajo, el costado lleva la muesca y el canal va metido con el tono del perfil.
  const g = RKVista.desdeValores({ b01_gola_o_tirador: "2", g01_perfil_tipo: "2" }, { ancho: 600, alto: 770 });
  assert.deepStrictEqual([g.golaTipo, g.golaProf], ["2", 45]);
  const gs = RKVista.svg(Object.assign({}, g, { golaTipo: "1", golaProf: 27 }), { frente: "1", golaColor: "#2a2c2e" });
  assert.ok(de(gs, FRENTE).some((c) => /^[^>]*><rect x="0\.0" y="40\.0"/.test(c)), "frente 40 mm abajo");
  assert.ok(/<polygon points="(?:[\d.-]+,[\d.-]+ ){5}[\d.-]+,[\d.-]+"/.test(de(gs, COSTADO).join("")), "costado con muesca");
  assert.ok(/<polygon [^>]*fill="#2a2c2e"/.test(gs) && de(gs, TAPA).some((c) => c.includes('fill="#2a2c2e"')), "piso y labio del perfil");
  // Alacena: cerrada con su techo, sin zoclo ni interior; la manija abajo.
  const al = RKVista.desdeAlacena({ c25tipopuerta: "1", d15_cant_puertas: "3" }, { ancho: 800, alto: 700, fondo: 330 });
  assert.deepStrictEqual([al.fondo, al.techo], [330, "5"]);
  const as = RKVista.svg(al, { frente: "1" });
  assert.ok(!as.includes("-interior)") && de(as, TAPA).length === 2, "techo y canto de las puertas");
  assert.ok(as.includes("800 × 700 · fondo 330 mm"));
});

prueba("vista: zona sin frente = hueco oscuro, con los entrepaños y divisores que se ven por él", () => {
  const TAPA = "0.8660 0.2113 -0.5000 0.3660";
  const grupos = (svg) => svg.split('<g transform="matrix(').slice(1);
  // Hueco para horno arriba (600) y un cajón abajo; sin repisas: solo el interior oscuro, sin recorte.
  const horno = RKVista.desdeValores({ d01_cantidad_zonas: "2", d02_alto_zona_superior: "600", d11_z1_contenido: "3",
    d31_z2_contenido: "2", d32_z2_cant_cajones: "1" }, { ancho: 600, alto: 770 });
  const s = RKVista.svg(horno, { frente: "1" });
  assert.ok(!s.includes('fill="#c9c4bb"'), "ya no es el hueco gris");
  assert.ok((s.match(/fill="url\(#rk-mat-\d+-interior\)"/g) || []).length >= 2, "arriba y en el hueco, el interior oscuro");
  assert.ok(!s.includes("<clipPath"), "sin repisas no hay nada que recortar");
  // Con un entrepaño (retiro 50) a media zona y un divisor al ras: se dibujan recortados a la boca del hueco.
  const conRep = Object.assign({}, horno, { repisas: [{ z: 450, retiro: 50, divisor: false }, { z: 300, retiro: 0, divisor: true }] });
  const r = RKVista.svg(conRep, { frente: "1" });
  const recorte = r.slice(r.indexOf("<clipPath"));
  assert.ok(/<clipPath id="rk-mat-\d+-vano"><polygon points=/.test(r) && r.includes('clip-path="url(#'), "recortadas al hueco");
  assert.strictEqual(grupos(recorte).filter((c) => c.startsWith(TAPA)).length >= 2, true, "una cara de arriba por repisa");
  // El divisor llega al frente del cuerpo; el entrepaño se queda 50 mm atrás (su canto en y = fondo − puerta − retiro).
  const cantos = grupos(recorte).filter((c) => c.startsWith("0.8660 0.2113 0 0.9063"));
  assert.strictEqual(cantos.length, 2, "el canto de cada una");
  // Detrás de una puerta no se dibujan: sin hueco, no hay recorte aunque haya repisas.
  const puertas = Object.assign(RKVista.desdeValores({ d01_cantidad_zonas: "1", d11_z1_contenido: "1" }, { ancho: 600, alto: 770 }),
    { repisas: [{ z: 380, retiro: 50 }] });
  assert.ok(!RKVista.svg(puertas, { frente: "1" }).includes("<clipPath"));
  // Alacena de microondas: hueco abajo, con el interior oscuro.
  const micro = RKVista.desdeAlacena({ LenZ: "900", d01_cantidad_zonas: "2", d02_alto_zona_superior: "500", c25tipopuerta: "1",
    d15_cant_puertas: "3", d31_z2_contenido: "0" }, { ancho: 600, alto: 900 });
  assert.ok(/fill="url\(#rk-mat-\d+-interior\)"/.test(RKVista.svg(micro, { frente: "1" })));
  // Esquinero sin puerta: dos huecos y sus entrepaños en L repartidos iguales.
  const esq = RKVista.desdeEsquinero({ c25tipopuerta: "0", c24entrepano: "0", f01cantdiv: "2", a0101profizq: "578", a0102profder: "578" },
    { ancho: 1000, alto: 770, fondo: 1000 });
  assert.deepStrictEqual(esq.repisas.map((x) => Math.round(x.z)), [251, 501], "2 entrepaños: 3 espacios iguales (como geomEntrepanos)");
  const se = RKVista.svg(esq, { frente: "1" });
  assert.ok(/<clipPath id="rk-mat-\d+-vano">(?:<polygon [^>]*\/>){2}<\/clipPath>/.test(se), "recortadas a los dos huecos");
  assert.strictEqual(RKVista.desdeEsquinero({ c24entrepano: "1" }, { ancho: 1000, alto: 770, fondo: 1000 }).repisas.length, 0);
});

prueba("vista: mientras se editan los entrepaños, sin frentes (huecos, contorno punteado y aviso)", () => {
  const lay = Object.assign(RKVista.desdeValores({ d01_cantidad_zonas: "2", d11_z1_contenido: "2", d12_z1_cant_cajones: "1",
    d31_z2_contenido: "1", d35_z2_cant_puertas: "3" }, { ancho: 600, alto: 770 }), { repisas: [{ z: 300, retiro: 26 }] });
  const barra = { forma: "barra", color: "#123456" };
  const normal = RKVista.svg(lay, { frente: "1", manijaPuerta: barra, manijaCajon: barra });
  assert.ok(!normal.includes("stroke-dasharray") && !normal.includes("<clipPath") && normal.includes('fill="#123456"'));
  const s = RKVista.svg(Object.assign({}, lay, { verInterior: true }), { frente: "1", manijaPuerta: barra, manijaCajon: barra });
  assert.strictEqual((s.match(/stroke-dasharray="12 8"/g) || []).length, 3, "cajón y las 2 hojas, solo en contorno");
  assert.ok(!s.includes('fill="#123456"'), "sin manijas");
  assert.ok(/<clipPath id="rk-mat-\d+-vano">(?:<polygon [^>]*\/>){2}<\/clipPath>/.test(s), "las dos zonas son hueco y se ve el entrepaño");
  assert.ok(s.includes("Sin frentes mientras editas entrepaños"), "aviso de que es temporal");
  const esq = Object.assign(RKVista.desdeEsquinero({ c25tipopuerta: "1", c24entrepano: "0", a0101profizq: "578", a0102profder: "578" },
    { ancho: 1000, alto: 770, fondo: 1000 }), { verInterior: true });
  const se = RKVista.svg(esq, { frente: "1" });
  assert.ok((se.match(/stroke-dasharray/g) || []).length === 2 && se.includes("<clipPath"), "esquinero: las dos hojas en contorno y el entrepaño en L");
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

prueba("esquinero sin Lateral negra: ni se elige ni la pone el proyecto", () => {
  const f = op.familias;
  assert.strictEqual(R.excluida(f.esquinero, "manija_puerta", "7"), true);
  assert.strictEqual(R.excluida(f.esquinero, "manija_puerta", 7), true, "el id como número también");
  assert.strictEqual(R.excluida(f.esquinero, "manija_puerta", "9"), false);
  assert.strictEqual(R.excluida(f.gabinete, "manija_puerta", "7"), false, "el gabinete sí la lleva");
  assert.strictEqual(R.excluida(f.esquinero, "manija_cajon", "7"), false, "sin mapeo de cajón no excluye");
  assert.strictEqual(R.excluida(null, "manija_puerta", "7"), false);
});

prueba("reglas: «Sin frente» solo en familias que lo mapean, sin manijas que revisar", () => {
  const f = op.familias;
  ["gabinete", "alacena", "esquinero"].forEach((k) => assert.ok(f[k].sin_frente && f[k].sin_frente.valores, k));
  assert.strictEqual(R.sinFrente(f.gabinete, R.FRENTE_SIN), true);
  assert.strictEqual(R.sinFrente(null, R.FRENTE_SIN), false, "el diseño del proyecto no lo ofrece");
  assert.strictEqual(R.sinFrente(f.gabinete, "1"), false);
  assert.strictEqual(R.diseno(op, { frente: R.FRENTE_SIN, manija_puerta: "21", manija_cajon: "15" }, false), "", "Berlín o concha no importan sin frente");
  assert.ok(!op.frentes.some((x) => String(x.id) === R.FRENTE_SIN), "no es un frente del catálogo");
});

prueba("espesor de puertas según el material: madera 22, MDF 18, sin material sin regla", () => {
  const mdf = op.materiales.find((m) => m.familia === "MDF"), mad = op.materiales.find((m) => m.familia === "Madera");
  assert.strictEqual(R.espesorPuerta(op, mdf.id), 18);
  assert.strictEqual(R.espesorPuerta(op, mad.id), 22);
  assert.strictEqual(R.espesorPuerta(op, "SIN_MATERIAL"), null);
  assert.strictEqual(op.familias.gabinete.espesor_puerta.attr, "c02_espesor_puerta");
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

prueba("gola: solo puerta Lisa (reglas, alcance y «Avanzado» la fija)", () => {
  const fam = op.familias.gabinete;
  assert.strictEqual(R.frenteGola(op), "1");
  assert.ok(/Con gola solo se fabrica puerta Lisa \(no Italiana\)/.test(R.diseno(op, { frente: "2" }, true)));
  assert.strictEqual(R.diseno(op, { frente: "1" }, true), "");
  assert.strictEqual(R.diseno(op, { frente: "2" }, false), "", "sin gola cualquier frente");
  const v = rcc.flatten(man.gabinete, { familia: "gabinete", valores: rcc.defaultValores(man.gabinete) });
  const msgs = R.receta(op, fam, Object.assign({}, v, { b01_gola_o_tirador: "2", l01_linea_frente: "3" })).map((e) => e.msg);
  assert.ok(msgs.some((m) => /Con gola solo se fabrica puerta Lisa/.test(m)), "una fila de CSV con gola y Mitered no pasa");
  assert.ok(MU.alcance(fam, true, false).fijo.some((x) => /frente Lisa/.test(x)));
  assert.ok(!MU.alcance(fam, true, false).cambia.includes("frente"));
  // En «Avanzado»: con gola el frente se fija en Lisa; al quitarla regresa el que tenía.
  const reg = { familia: "gabinete", valores: rcc.defaultValores(man.gabinete) };
  const f = rcc.fieldByAttr(man.gabinete, "l01_linea_frente");
  reg.valores.l01_linea_frente = "3";
  reg.valores.b01_gola_o_tirador = "2";
  rcc.aplicarForzados(man.gabinete, reg.valores);
  assert.strictEqual(reg.valores.l01_linea_frente, "1");
  assert.strictEqual(rcc.fieldEnabled(f, man.gabinete, reg.valores), false);
  assert.ok(/Con gola/.test(rcc.mensajeForzado(f, man.gabinete, reg.valores)));
  assert.strictEqual(rcc.flatten(man.gabinete, reg).l01_linea_frente, "1");
  reg.valores.b01_gola_o_tirador = "1";
  rcc.aplicarForzados(man.gabinete, reg.valores);
  assert.strictEqual(reg.valores.l01_linea_frente, "3");
});

prueba("gola en el diseño: selector único (sin gola, melamina, aluminio claro/oscuro) y L-C / L-L", () => {
  const fam = op.familias.gabinete;
  assert.deepStrictEqual(op.golas.map((g) => g.id), ["tirador", "melamina", "aluminio_claro", "aluminio_oscuro"]);
  assert.strictEqual(R.conGola(op, fam, "", true), true, "sin elección: la del mueble");
  assert.strictEqual(R.conGola(op, fam, "tirador", true), false);
  assert.strictEqual(R.conGola(op, fam, "melamina", false), true);
  assert.deepStrictEqual(R.cambiosGola(op, fam, "aluminio_oscuro", "2"),
    { b01_gola_o_tirador: "2", g01_perfil_tipo: "1", c23_material_gola_aluminio: "Negro mate", g03_combinacion: "2" });
  assert.deepStrictEqual(R.cambiosGola(op, fam, "tirador", "2"), { b01_gola_o_tirador: "1" }, "sin gola no hay combinación");
  assert.deepStrictEqual(R.cambiosGola(op, fam, "", "2"), {});
  // Color en la vista: la opción elegida, o el de la receta.
  assert.strictEqual(R.colorGola(op, fam, "aluminio_claro"), "#c4c8cc");
  assert.strictEqual(R.colorGola(op, fam, "", { g01_perfil_tipo: "2" }), op.golas[1].color);
  assert.strictEqual(R.colorGola(op, fam, "", { g01_perfil_tipo: "1", c23_material_gola_aluminio: "Champagne mate" }), "#cdb991");
  // La gola de arriba va metida en L con el tono elegido; la de entre zonas, el canal con su degradado.
  const lay = RKVista.desdeValores({ b01_gola_o_tirador: "2" }, { ancho: 600, alto: 770 });
  const svg = RKVista.svg(lay, { golaColor: "#2a2c2e" });
  assert.ok(/<polygon [^>]*fill="#2a2c2e"/.test(svg) && !svg.includes("-gola)\""), "arriba: canal en L del tono elegido");
  const dos = RKVista.desdeValores({ b01_gola_o_tirador: "2", d01_cantidad_zonas: "2", d31_z2_contenido: "2" }, { ancho: 600, alto: 770 });
  const svg2 = RKVista.svg(dos, { golaColor: "#2a2c2e" });
  assert.ok(svg2.includes("-gola)\"") && svg2.includes(`stop-color="#131415"`), "entre zonas: canal con degradado del tono elegido");
  assert.ok(MU.alcance(fam, true, false, true).cambia.includes("gola"), "la gola del proyecto se aplica");
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

const PASOS = [
  { de: "diseno", a: "revision", rol: "diseno", etiqueta: "Presentar al cliente" },
  { de: "revision", a: "aprobado", rol: "diseno", etiqueta: "Cliente aprobó", confirmar: "x" },
  { de: "revision", a: "diseno", rol: "diseno", etiqueta: "Cliente pidió cambios", atras: true, nota: true },
  { de: "aprobado", a: "planeacion", rol: "diseno", etiqueta: "Enviar a planeación", confirmar: "x" },
  { de: "planeacion", a: "diseno", rol: "planeacion", etiqueta: "Devolver a diseño", atras: true, nota: true },
  { de: "planeacion", a: "fabricacion", rol: "planeacion", etiqueta: "Iniciar fabricación" },
  { de: "fabricacion", a: "entregado", rol: "planeacion", etiqueta: "Marcar entregado", confirmar: "x" },
];

prueba("proyectos: un paso adelante como principal y el regreso después", () => {
  const acc = P.acciones({ estado: "revision", version_actual: 4 }, PASOS, "diseno");
  assert.deepStrictEqual(acc.map((x) => [x.a, x.principal, x.atras]), [["aprobado", true, false], ["diseno", false, true]]);
  assert.ok(acc[1].nota, "regresar pide nota");
  assert.strictEqual(P.acciones({ estado: "aprobado", version_actual: 4 }, PASOS, "diseno")[0].etiqueta, "Enviar a planeación (congela v4)");
  assert.deepStrictEqual(P.acciones({ estado: "fabricacion" }, PASOS, "diseno"), [], "diseño no mueve lo de planeación");
});

prueba("proyectos: cambio en fabricación y confirmación de Planeación", () => {
  const reg = { estado: "fabricacion", version_actual: 15, version_congelada: 12, cambios_tras_congelar: true };
  const d = P.acciones(reg, PASOS, "diseno");
  assert.deepStrictEqual(d.map((x) => [x.tipo, x.principal]), [["cambio", true]]);
  assert.ok(/v12 → v15/.test(d[0].etiqueta) && d[0].nota);
  const pl = P.acciones({ estado: "fabricacion", version_congelada: 15, cambio_sin_revisar: true }, PASOS, "planeacion");
  assert.deepStrictEqual(pl.map((x) => [x.tipo, x.principal, !!x.bloqueado]), [["recibido", true, false], ["estado", false, true]]);
  assert.deepStrictEqual(P.acciones({ estado: "entregado", cambios_tras_congelar: true }, PASOS, "diseno"), [], "entregado: nada");
});

prueba("proyectos: texto de los movimientos", () => {
  const est = [["aprobado", "Aprobado"], ["revision", "Revisión con cliente"]];
  assert.strictEqual(P.movimiento({ tipo: "estado", de: "revision", a: "aprobado", version: 4 }, est), "Revisión con cliente → Aprobado (aprobó v4)");
  assert.strictEqual(P.movimiento({ tipo: "cambio", de_version: 12, version: 15 }, est), "Cambio en v12 → v15");
  assert.strictEqual(P.movimiento({ tipo: "recibido", version: 15 }, est), "Planeación recibió el cambio (v15)");
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
  // El ancho y la tarja son siempre del mueble: el proyecto no los pone.
  assert.ok(a.fijo.includes("tarja") && !a.cambia.includes("tarja"));
  const g = MU.alcance(fc, true, true);
  assert.ok(!g.cambia.includes("manijas") && g.cambia.includes("alto y fondo") && g.fijo.includes("ancho") && g.fijo.some((x) => /gola/.test(x)));
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

prueba("muebles: resumen de frentes y nombre nuevo que no se repite", () => {
  const m = man.gabinete, V = m.grupos.find((g) => g.visual).visual;
  const v = rcc.defaultValores(m);
  const r = MU.resumenFrentes(rcc.geomFrentes(m, v, V));
  assert.ok(/^\d+[PC](-\d+[PC])?$/.test(r.codigo), r.codigo);
  assert.ok(/puerta|caj/.test(r.texto), r.texto);
  const F = { zonas: [{ contenido: "puerta", frentes: [1, 2] }, { contenido: "cajones", frentes: [1, 2, 3] }] };
  assert.deepStrictEqual(MU.resumenFrentes(F), { texto: "2 puertas + 3 cajones", codigo: "2P-3C" });
  assert.deepStrictEqual(MU.resumenFrentes({ zonas: [{ contenido: "cajones", frentes: [1] }, { contenido: "nada", frentes: [] }] }),
    { texto: "1 cajón + abierto", codigo: "1C-A" });
  assert.strictEqual(MU.nombreNuevo("GAB", 600, "2P-3C", []), "GAB-600-2P-3C-001");
  // El consecutivo sigue al mayor del catálogo, sea del mueble que sea; los nombres viejos no cuentan.
  assert.strictEqual(MU.nombreNuevo("GAB", 900, "3C", ["GAB-600-2P-3C-007", "GAB-600-T-Z1P2-Z2C3", "JIJE", "ALA-800-2P-012"]), "GAB-900-3C-013");
  // El ancho de un nombre viejo («GAB-600») no es un consecutivo.
  assert.strictEqual(MU.nombreNuevo("GAB", 600, "2P-3C", ["GAB-600", "GAB-900-T", "X-999"]), "GAB-600-2P-3C-001");
  assert.strictEqual(MU.nombreNuevo("gab", 0, "", ["GAB-001"]), "GAB-002");
  // Nunca devuelve un nombre cuyo id ya esté ocupado (aunque se escriba distinto).
  assert.strictEqual(MU.nombreNuevo("GAB", 600, "2P", ["gab 600 2p 001", "GAB_600_2P_002"]), "GAB-600-2P-003");
  assert.strictEqual(MU.nombreNuevo("GAB", 600, "2P", ["X-2P-001", "GAB 600 2P 002"]), "GAB-600-2P-003");
});

prueba("muebles: frentes de la alacena y su nombre nuevo", () => {
  assert.deepStrictEqual(MU.frentesAlacena({ c25tipopuerta: "1", d15_cant_puertas: "1" }), { texto: "1 puerta", codigo: "1P" });
  assert.deepStrictEqual(MU.frentesAlacena({ c25tipopuerta: "1", d15_cant_puertas: "3" }), { texto: "2 puertas", codigo: "2P" });
  assert.deepStrictEqual(MU.frentesAlacena({ c25tipopuerta: "6", d21_avento_cant_puertas: "2" }), { texto: "2 Avento S", codigo: "2AS" });
  assert.deepStrictEqual(MU.frentesAlacena({ c25tipopuerta: "10" }), { texto: "1 Avento D", codigo: "1AD" });
  assert.deepStrictEqual(MU.frentesAlacena({ c25tipopuerta: "0" }), { texto: "abierta", codigo: "A" });
  // Dos zonas, de arriba abajo.
  assert.deepStrictEqual(MU.frentesAlacena({ d01_cantidad_zonas: "2", c25tipopuerta: "6", d31_z2_contenido: "1", d35_z2_cant_puertas: "3" }),
    { texto: "1 Avento S + 2 puertas", codigo: "1AS-2P" });
  const z = RKVista.desdeAlacena({ d01_cantidad_zonas: "2", d02_alto_zona_superior: "300mm", c25tipopuerta: "6", d31_z2_contenido: "1" }, { ancho: 800, alto: 900 });
  assert.deepStrictEqual(z.zonas.map((x) => [x.tipo, x.h]), [["avento", 300], ["puerta", 600]]);
  assert.deepStrictEqual(RKVista.desdeAlacena({ d01_cantidad_zonas: "2" }, { ancho: 800, alto: 900 }).zonas.map((x) => x.h), [450, 450], "0 = la mitad");
  // Un Avento también cuenta para el consecutivo.
  assert.strictEqual(MU.nombreNuevo("ALA", 800, "1AS", ["ALA-800-2AS-004"]), "ALA-800-1AS-005");
  // Esquinero: puerta en L (PL) o abierto; el código sin número también cuenta.
  assert.deepStrictEqual(MU.frentesEsquinero({ c25tipopuerta: "1" }), { texto: "puerta en L", codigo: "PL" });
  assert.deepStrictEqual(MU.frentesEsquinero({ c25tipopuerta: "0" }), { texto: "abierto", codigo: "A" });
  assert.strictEqual(MU.nombreNuevo("ESQ", 1000, "PL", ["ESQ-1000-PL-002", "ALA-800-A-003"]), "ESQ-1000-PL-004");
  // Sin cajones lo fijo son las puertas.
  assert.strictEqual(MU.alcance(op.familias.alacena, false, false, false).fijo[0], "puertas");
});

prueba("muebles: dos nombres que dan el mismo id son el mismo mueble", () => {
  assert.strictEqual(MU.idDe("GAB 600"), "cr-gab-600");
  assert.strictEqual(MU.idDe("  gab_600. "), "cr-gab-600");
  assert.strictEqual(MU.idDe("Cajón"), MU.idDe("Caj-n"));
  const cat = [{ id: "cr-gab-600", name: "GAB-600", specs: { sku: "GAB-600" } }, { id: "cr-jije", name: "Jije", specs: {} }];
  assert.strictEqual(MU.choque("gab 600", cat).name, "GAB-600");
  assert.strictEqual(MU.choque("JIJE", cat).name, "Jije");
  assert.strictEqual(MU.choque("GAB-601", cat), null);
  assert.strictEqual(MU.choque("", cat), null);
});

prueba("gabinete: sin zoclo va al piso (alto 0, sin sumarlo al cuerpo) y no hay pieza frontal que quitar", () => {
  const m = man.gabinete;
  assert.strictEqual(rcc.fieldByAttr(m, "j01_pieza_frontal"), null);
  const reg = { familia: "gabinete", valores: rcc.defaultValores(m) };
  assert.strictEqual(rcc.flatten(m, reg).LenZ, "870mm");
  reg.valores.j02_zoclo_activo = "2";
  rcc.aplicarForzados(m, reg.valores);
  const fila = rcc.flatten(m, reg);
  assert.strictEqual(fila.a02_alto_zoclo, "0mm");
  assert.strictEqual(fila.LenZ, "770mm");
  const lay = RKVista.desdeValores(fila, { ancho: 600, alto: 770 });
  assert.strictEqual(lay.zoclo, 0);
  // Una receta vieja «sin zoclo» que aún trae su alto también se dibuja al piso.
  assert.strictEqual(RKVista.desdeValores({ j02_zoclo_activo: "2", a02_alto_zoclo: "100mm" }, { ancho: 600, alto: 770 }).zoclo, 0);
  assert.strictEqual(RKVista.desdeValores({ a02_alto_zoclo: "100mm" }, { ancho: 600, alto: 770 }).zoclo, 100);
});

prueba("gabinete: el zoclo se puede volver a poner (regresa su alto, no se queda en 0)", () => {
  const m = man.gabinete;
  const reg = { familia: "gabinete", valores: rcc.defaultValores(m) };
  reg.valores.a02_alto_zoclo = "120";
  reg.valores.j02_zoclo_activo = "2";
  rcc.aplicarForzados(m, reg.valores);
  assert.strictEqual(reg.valores.a02_alto_zoclo, "0");
  assert.ok(!("__antesForzado" in JSON.parse(JSON.stringify(reg.valores))));
  reg.valores.j02_zoclo_activo = "1";
  rcc.aplicarForzados(m, reg.valores);
  assert.strictEqual(reg.valores.a02_alto_zoclo, "120");
  assert.strictEqual(RKVista.desdeValores(rcc.flatten(m, reg), { ancho: 600, alto: 770 }).zoclo, 120);
  // Una creación guardada sin zoclo (alto 0) al reabrirla en «Avanzado»: va el default.
  const fila = rcc.flatten(m, { familia: "gabinete", valores: Object.assign(rcc.defaultValores(m), { j02_zoclo_activo: "2" }) });
  const vuelta = { familia: "gabinete", valores: RKAvanzado.valoresDesdeFila(m, fila, rcc) };
  rcc.aplicarForzados(m, vuelta.valores);
  vuelta.valores.j02_zoclo_activo = "1";
  rcc.aplicarForzados(m, vuelta.valores);
  const otra = rcc.flatten(m, vuelta);
  assert.strictEqual(otra.a02_alto_zoclo, "100mm");
  assert.strictEqual(otra.LenZ, "870mm");
  assert.strictEqual(RKVista.desdeValores(otra, { ancho: 600, alto: 770 }).zoclo, 100);
});

console.log(`${n}/${n} pruebas OK`);
