"use strict";

/* Catálogo de muebles: origen de cada mueble, de dónde sale su diseño y
   filtros de la lista. Puro (sin DOM): se prueba en node.

   Origen (ficha.clase, lo pone Studio al guardar; no cambia cómo se comporta):
     · catalogo — entró por CSV: el catálogo de la empresa. Siempre toma el
                  diseño del proyecto.
     · usuario  — lo creó o alteró alguien desde «Avanzado» (ficha.creado_por).
                  Puede ir con el diseño del proyecto o con el original.

   Diseño en un proyecto (proyecto.modulos[id]): nada = «Este proyecto»;
   { original: true } = como se creó (solo usuario); { personalizado: true, … }
   = ajustado solo para este mueble. */
window.RKMuebles = (function () {
  const CLASES = [["catalogo", "Catálogo"], ["usuario", "Creados por usuario"]];

  // «personalizado» fue el nombre de la clase usuario en las primeras fichas.
  const clase = (m) => (m && (m.clase === "usuario" || m.clase === "personalizado") ? "usuario" : "catalogo");

  function etiqueta(m) {
    if (clase(m) === "catalogo") return "Catálogo";
    const por = m.creado_por || {};
    return "Creado por " + (por.nombre || por.usuario || "usuario");
  }

  /* De dónde sale el diseño de +m+ (+o+ = proyecto.modulos[m.id]): "global"
     (este proyecto), "original" (como se creó) o "personal" (ajustado aquí).
     +vista+ = "original" cuando la lista de creados por usuario se está viendo
     con su diseño original: vale para los que no tienen elección propia. */
  function modo(m, o, vista) {
    if (o && o.personalizado) return "personal";
    if (clase(m) !== "usuario") return "global";
    if (o && o.original) return "original";
    return !o && vista === "original" ? "original" : "global";
  }

  /* Opciones del selector de diseño dentro de un mueble. */
  function modos(m) {
    const out = [["global", "Este proyecto"]];
    if (clase(m) === "usuario") out.push(["original", "Original"]);
    out.push(["personal", "Ajustar este mueble"]);
    return out;
  }

  /* Diseño con que se guardó el mueble, leído de su receta. +fc+ = mapeo de la
     familia en opciones.json (frente, manijas, material, tarja). */
  function disenoOriginal(fc, valores) {
    const v = valores || {}, f = fc || {};
    const leer = (attr) => (attr && v[attr] != null ? String(v[attr]) : "");
    return {
      frente: leer(f.frente && f.frente.attr),
      manija_puerta: leer(f.manija_puerta && (f.manija_puerta.attrs || [])[0]),
      manija_cajon: leer(f.manija_cajon && (f.manija_cajon.attrs || [])[0]),
      material: leer(f.material && f.material.attr),
      tarja: !!f.tarja && leer(f.tarja.attr) === String(f.tarja.si),
    };
  }

  /* Qué pone el diseño del proyecto en un mueble y qué se queda como está. */
  function alcance(fc, gola, igualar) {
    const f = fc || {};
    const cambia = [], fijo = ["zonas, puertas y cajones", "entrepaños"];
    if (f.frente) cambia.push("frente");
    if (f.manija_puerta || f.manija_cajon) (gola ? fijo : cambia).push(gola ? "gola (no lleva manijas)" : "manijas");
    if (f.material) cambia.push("material");
    if (f.tarja) cambia.push("tarja");
    (igualar ? cambia : fijo).push(igualar ? "ancho, alto y fondo" : "medidas");
    return { cambia, fijo };
  }

  function texto(m) {
    return [m.name, m.id, m.specs && m.specs.sku, m.ubicacion, m.category, etiqueta(m)]
      .concat(Object.values(m.features || {}).reduce((a, x) => a.concat(x), [])).join(" ").toLowerCase();
  }

  // ---- Características (barra lateral de la lista) ----------------------------
  /* Grupos por los que se filtra: los de la ficha (caracteristicas) más el
     ancho. Los entrepaños no entran: se ajustan después, dentro del mueble. */
  const GRUPOS = [["tipo", "Tipo"], ["configuracion", "Configuración"], ["puerta", "Frente original"], ["ancho", "Ancho"]];
  const FUERA = /entrepa/i;

  /* Valores de +m+ en un grupo. */
  function valores(m, grupo) {
    if (grupo === "ancho") return m.specs && m.specs.ancho_mm ? [m.specs.ancho_mm + " mm"] : [];
    return ((m.features || {})[grupo] || []).filter((v) => !FUERA.test(v));
  }

  /* +car+ = { grupo: [valores elegidos] }. Dentro de un grupo basta con uno
     (600 o 900 mm); entre grupos se cumplen todos (Gola y 600 mm). */
  function cumple(m, car, menos) {
    return Object.keys(car || {}).every((g) => g === menos || !car[g].length || valores(m, g).some((v) => car[g].includes(v)));
  }

  /* f = { q, clase, cat, car }: lo vacío no filtra. */
  function filtrar(lista, f) {
    const q = String((f && f.q) || "").trim().toLowerCase();
    return lista.filter((m) => (!f.clase || clase(m) === f.clase) && (!f.cat || m.category === f.cat) &&
      cumple(m, f.car) && (!q || texto(m).includes(q)));
  }

  /* Grupos con sus opciones para la barra: [{ id, titulo, opciones: [{ valor, n, activo }] }].
     n = cuántos quedarían al elegir esa opción con el resto de los filtros puestos
     (+lista+ ya viene filtrada por origen, tipo de mueble y texto). */
  function facetas(lista, car) {
    return GRUPOS.map(([id, titulo]) => {
      const cuenta = {};
      lista.forEach((m) => valores(m, id).forEach((v) => { cuenta[v] = 0; }));
      lista.filter((m) => cumple(m, car, id)).forEach((m) => valores(m, id).forEach((v) => { cuenta[v]++; }));
      const elegidos = (car && car[id]) || [];
      const orden = id === "ancho" ? (a, b) => parseFloat(a) - parseFloat(b) : (a, b) => a.localeCompare(b, "es");
      const opciones = Object.keys(cuenta).sort(orden).map((valor) => ({ valor, n: cuenta[valor], activo: elegidos.includes(valor) }));
      return { id, titulo, opciones };
    }).filter((g) => g.opciones.length);
  }

  /* Cuántos hay de cada origen y de cada categoría (para las etiquetas de los filtros). */
  function conteos(lista) {
    const out = { clase: { catalogo: 0, usuario: 0 }, cat: {} };
    lista.forEach((m) => { out.clase[clase(m)]++; out.cat[m.category] = (out.cat[m.category] || 0) + 1; });
    return out;
  }

  return { CLASES, clase, etiqueta, modo, modos, disenoOriginal, alcance, filtrar, conteos, facetas };
})();
