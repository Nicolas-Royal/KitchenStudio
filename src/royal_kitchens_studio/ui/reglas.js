"use strict";

/* RKReglas: qué combinación de frente, manija y material se puede fabricar.
   Las mismas reglas que Catalogo (catalogo.rb), leídas de opciones.json:
   tiradores[].usos (dónde se puede usar), solo_frentes y posicion.<uso>;
   materiales MDF solo en puerta Lisa. Sin DOM: se prueba en node. */
window.RKReglas = (function () {
  const USOS = { puerta: "manija_puerta", cajon: "manija_cajon" };
  const NOMBRE_USO = { puerta: "puertas", cajon: "cajones" };

  const buscar = (lista, id) => (lista || []).find((o) => String(o.id) === String(id)) || null;

  /* Por qué la manija +id+ no va en +uso+ con el frente +frente+, o "". */
  function manija(op, uso, id, frente) {
    const t = buscar(op.tiradores, id);
    if (!t) return "";
    const usos = t.usos || [];
    if (usos.length && !usos.includes(uso)) return `${t.nombre} no se usa en ${NOMBRE_USO[uso]}`;
    const solo = (t.solo_frentes || []).map(String);
    if (solo.length && frente != null && frente !== "" && !solo.includes(String(frente))) {
      const nombres = solo.map((f) => (buscar(op.frentes, f) || {}).nombre || f);
      return `${t.nombre} solo con frente ${nombres.join(" o ")}`;
    }
    return "";
  }

  function material(op, mat, frente) {
    const m = buscar(op.materiales, mat), f = buscar(op.frentes, frente);
    return m && f && m.familia === "MDF" && f.solo_madera ? `${m.nombre} es MDF: solo se fabrica en puerta Lisa` : "";
  }

  /* Primer problema del diseño +d+ ({frente, manija_puerta, manija_cajon, material}), o "". */
  function diseno(op, d, gola) {
    if (!gola) {
      for (const uso of Object.keys(USOS)) {
        const e = d[USOS[uso]] ? manija(op, uso, d[USOS[uso]], d.frente) : "";
        if (e) return e;
      }
    }
    return material(op, d.material, d.frente);
  }

  /* Posición forzada de la manija en ese uso (Lateral negra en puertas: "5"). */
  function posicion(op, uso, id) {
    const t = buscar(op.tiradores, id);
    return (t && t.posicion && t.posicion[uso]) || null;
  }

  /* Problemas de una receta del gabinete (variables de «Avanzado», +v+) según
     el mapeo de +fam+ (opciones.familias.gabinete): manija por uso y zona, su
     posición forzada y el material. [{ label, msg }] como erroresConfig. */
  function receta(op, fam, v) {
    const out = [];
    Object.entries(USOS).forEach(([uso, clave]) => {
      const h = fam && fam[clave];
      if (!h || (h.requiere && String(v[h.requiere.attr]) !== String(h.requiere.valor))) return;
      h.attrs.forEach((a, i) => {
        const id = v[a];
        if (id == null || id === "") return;
        const e = manija(op, uso, id, v[fam.frente && fam.frente.attr]);
        if (e) out.push({ label: "Manija", msg: e });
        const pos = posicion(op, uso, id), pa = (h.posicion || [])[i];
        if (pos && pa && v[pa] != null && String(v[pa]) !== pos) {
          out.push({ label: "Manija", msg: `${buscar(op.tiradores, id).nombre} en ${NOMBRE_USO[uso]} va en posición Centro - Centro` });
        }
      });
    });
    const m = fam && fam.material && material(op, v[fam.material.attr], v[fam.frente && fam.frente.attr]);
    if (m) out.push({ label: "Material", msg: m });
    return out.filter((e, i) => out.findIndex((x) => x.msg === e.msg) === i);
  }

  return { USOS, manija, material, diseno, posicion, receta };
})();
