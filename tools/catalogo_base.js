/* =============================================================================
   catalogo_base.js — Recetas del catálogo base desde tools/catalogo_base.json
   -----------------------------------------------------------------------------
   Uso:
     node tools/catalogo_base.js            (revisa y escribe dist/catalogo_base.json)
     node tools/catalogo_base.js --todos    (incluye los grupos con activo: false)

   Arma cada mueble como «Avanzado»: defaults del manifiesto + comunes + cambios
   + medidas, con ui/receta.js (forzados, `suma` de puerta y zoclo, nombre
   automático y nombres de divisores). Se detiene si una configuración tiene
   errores o si dos dan el mismo nombre. Después, en SketchUp:
     load "<repo>/tools/publicar_catalogo.rb"
     RoyalKitchens::PublicarCatalogo.todo
   ============================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const SRC = path.join(RAIZ, "src", "royal_kitchens_studio");
const w = {};
new Function("window", fs.readFileSync(path.join(SRC, "ui", "receta.js"), "utf8"))(w);
const T = w.RCC_CORE;

const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "catalogo_base.json"), "utf8"));
const todos = process.argv.includes("--todos");
const man = {};
const manifiesto = (f) => man[f] || (man[f] = JSON.parse(fs.readFileSync(path.join(SRC, "familias", f + ".json"), "utf8")));

// Medidas de cada mueble del grupo: ancho (LenX) o, en el esquinero, los dos anchos.
const medidas = (g) => g.medidas ? g.medidas.map(([x, y]) => ({ LenX: String(x), LenY: String(y) }))
                                 : g.anchos.map((a) => ({ LenX: String(a) }));

// Únicos frentes de cajón de Royal Kitchens (con tirador): Grande y CH. Dos CH
// y su separación (190 + 3 + 190) miden lo mismo que un Grande.
const ALTOS_CAJON = { 383: "G", 190: "CH" };

const recetas = [], problemas = [];
spec.grupos.filter((g) => todos || g.activo !== false).forEach((g) => {
  const m = manifiesto(g.familia);
  medidas(g).forEach((med) => {
    const valores = Object.assign(T.defaultValores(m), spec.comunes[g.familia] || {}, g.cambios || {}, med);
    const reg = { id: "base", familia: g.familia, titulo: g.nombre, valores, nombre_salida: "" };
    const errores = T.erroresConfig(m, valores);
    const nombre = T.autoNombre(m, valores);
    if (errores.length) problemas.push(`${g.nombre} ${med.LenX}: ${errores.map((e) => e.msg).join(" · ")}`);
    const cajones = m.reglas_cajones ? T.presupuestosCajones(m, valores).map((p) => p.altos.map((a) => Math.round(a * 100) / 100)) : [];
    cajones.flat().filter((a) => !ALTOS_CAJON[a]).forEach((a) =>
      problemas.push(`${g.nombre} ${med.LenX}: frente de cajón de ${a} mm (solo ${Object.keys(ALTOS_CAJON).join(" o ")})`));
    recetas.push({ grupo: g.nombre, familia: g.familia, nombre, cajones: cajones.flat().map((a) => ALTOS_CAJON[a] || a).join("+"),
                   valores: T.flatten(m, reg), divisores: T.nombresDivisores(m, reg) });
  });
});

const vistos = {};
recetas.forEach((r) => { (vistos[r.nombre] = vistos[r.nombre] || []).push(r.grupo); });
Object.entries(vistos).filter(([, gs]) => gs.length > 1).forEach(([n, gs]) => problemas.push(`Nombre repetido ${n}: ${gs.join(" / ")}`));

recetas.forEach((r) => console.log(`${r.nombre.padEnd(28)} ${(r.cajones || "").padEnd(10)} ${r.grupo}`));
console.log(`\n${recetas.length} muebles`);
if (problemas.length) {
  console.error("\nProblemas:\n  " + problemas.join("\n  "));
  process.exit(1);
}
const salida = path.join(RAIZ, "dist", "catalogo_base.json");
fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, JSON.stringify(recetas, null, 2));
console.log("Escrito: " + salida);
