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
  function alcance(fc, gola, igualar, golaProyecto) {
    const f = fc || {};
    const cambia = [], fijo = ["zonas, puertas y cajones", "entrepaños"];
    if (f.gola && golaProyecto) cambia.push("gola");
    if (f.frente) (gola ? fijo : cambia).push(gola ? "frente Lisa (con gola)" : "frente");
    if (f.manija_puerta || f.manija_cajon) (gola ? fijo : cambia).push(gola ? "sin manijas (gola)" : "manijas");
    if (f.material) cambia.push("material");
    if (f.tarja) fijo.push("tarja");
    if (igualar) { cambia.push("alto y fondo"); fijo.push("ancho"); } else fijo.push("medidas");
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

  // ---- Resumen y nombre -------------------------------------------------------
  /* Frentes del mueble de arriba abajo, desde RCC_CORE.geomFrentes:
     { texto: "2 puertas + 3 cajones", codigo: "2P-3C" }. Zona sin frente = abierta. */
  function resumenFrentes(F) {
    const zonas = ((F && F.zonas) || []).map((z) => {
      const n = z.frentes.length;
      if (!n) return { texto: "abierto", codigo: "A" };
      const puerta = z.contenido === "puerta";
      return { texto: n + " " + (puerta ? "puerta" : "cajón").replace("ón", n === 1 ? "ón" : "on") + (n === 1 ? "" : puerta ? "s" : "es"), codigo: n + (puerta ? "P" : "C") };
    });
    return { texto: zonas.map((z) => z.texto).join(" + "), codigo: zonas.map((z) => z.codigo).join("-") };
  }

  // ---- Identidad: que dos muebles no se pisen ----------------------------------
  /* Id de un mueble a partir de su nombre, igual que Biblioteca.slug en Ruby:
     «GAB 600», «GAB-600» y «gab_600» son el MISMO mueble (cr-gab-600). */
  function idDe(nombre) {
    return "cr-" + String(nombre == null ? "" : nombre).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  /* El mueble de +modulos+ que quedaría pisado al guardar otro como +nombre+, o null. */
  function choque(nombre, modulos) {
    const id = idDe(nombre);
    if (id === "cr-") return null;
    return (modulos || []).find((m) => idDe((m.specs && m.specs.sku) || m.name) === id || m.id === id) || null;
  }

  /* Nombre de un mueble nuevo: fácil de leer y que no se repite.
       GAB-600-2P-3C-014 = familia, ancho en mm, frentes de arriba abajo y un
     consecutivo de tres cifras: el siguiente al mayor que haya en +usados+
     (los nombres del catálogo), así dos muebles iguales no se pisan. */
  function nombreNuevo(prefijo, ancho, codigo, usados) {
    let mayor = 0;
    const ids = {};
    (usados || []).forEach((n) => {
      ids[idDe(n)] = true;
      // Solo cuentan los nombres con este formato (frentes y luego el consecutivo):
      // en «GAB-600» el 600 es el ancho, no un consecutivo.
      const m = /-(?:\d+[PC]|A)-(\d{3,})$/.exec(String(n || ""));
      if (m) mayor = Math.max(mayor, parseInt(m[1], 10));
    });
    const base = [String(prefijo || "MUE").toUpperCase(), ancho > 0 ? String(Math.round(ancho)) : "", codigo || ""].filter(Boolean).join("-");
    let n = mayor + 1, nombre;
    do { nombre = base + "-" + String(n++).padStart(3, "0"); } while (ids[idDe(nombre)]);
    return nombre;
  }

  return { idDe, choque, CLASES, clase, etiqueta, modo, modos, disenoOriginal, alcance, filtrar, conteos, facetas, resumenFrentes, nombreNuevo };
})();
