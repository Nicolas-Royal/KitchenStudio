"use strict";

/* Vista previa del diseño: alzado frontal del módulo en SVG con el estilo de
   frente, la manija y el material elegidos. Es solo para ver cómo quedará;
   no lee geometría de SketchUp. Las medidas van en mm (1 unidad = 1 mm). */
window.RKVista = (function () {
  const GAP = 3;           // separación entre frentes
  const GOLA = 40;         // canal de gola sobre cada zona
  const MADERA_BASE = "#d6bf9b";
  let serie = 0;      // ids únicos: varias vistas conviven en la página

  function num(v, def) {
    if (v == null || v === "") return def;
    const m = String(v).trim().match(/^(-?[\d.,]+)\s*(mm|cm|m)?$/i);
    if (!m) return def;
    const n = parseFloat(m[1].replace(",", "."));
    const u = (m[2] || "mm").toLowerCase();
    return u === "cm" ? n * 10 : u === "m" ? n * 1000 : n;
  }

  // Código de cantidad de puertas del gabinete por zonas: 1 = simple IZQ,
  // 2 = simple DER, 3 = doble, 4… = 3… puertas.
  function puertas(code) {
    const c = parseInt(code, 10) || 3;
    if (c === 1) return { n: 1, lado: "izq" };
    if (c === 2) return { n: 1, lado: "der" };
    return { n: c - 1, lado: "doble" };
  }

  function zona(contenido, codPuertas, cajones) {
    const c = String(contenido || "1");
    if (c === "2") return { tipo: "cajones", n: Math.max(1, parseInt(cajones, 10) || 1) };
    if (c === "3") return { tipo: "abierto" };
    return Object.assign({ tipo: "puerta" }, puertas(codPuertas));
  }

  /* Distribución a partir de los atributos del gabinete (fila plana o
     valores del formulario, ambos indexados por attr). +medidas+ trae ancho y
     alto del CUERPO en mm. */
  function desdeValores(v, medidas) {
    const ancho = medidas.ancho || num(v.LenX, 600);
    const alto = medidas.alto || 770;
    // Sin zoclo el gabinete va apoyado en el piso: no hay nada que lo eleve.
    const conZoclo = String(v.j02_zoclo_activo || "1") !== "2";
    const zoclo = conZoclo ? num(v.a02_alto_zoclo, 100) : 0;
    const dos = String(v.d01_cantidad_zonas) === "2";
    const zonas = [zona(v.d11_z1_contenido, v.d15_z1_cant_puertas, v.d12_z1_cant_cajones)];
    let sup = alto;
    if (dos) {
      const fija = num(v.d02_alto_zona_superior, 0);
      sup = fija > 0 ? fija : alto / 2;
      zonas.push(zona(v.d31_z2_contenido, v.d35_z2_cant_puertas, v.d32_z2_cant_cajones));
    }
    zonas[0].h = sup;
    if (dos) zonas[1].h = alto - sup;
    return {
      ancho, alto, zoclo,
      zocloVisible: conZoclo,
      gola: String(v.b01_gola_o_tirador) === "2",
      zonas,
    };
  }

  /* Sin receta (módulos del catálogo): se adivina por sus etiquetas. */
  function desdeEtiquetas(mod) {
    const s = mod.specs || {};
    const f = [].concat(...Object.values(mod.features || {})).join(" ").toLowerCase();
    const ancho = s.ancho_mm || 600;
    const altoTotal = s.alto_mm || 870;
    const esGab = /gabinete/i.test(mod.category || "");
    const zoclo = esGab ? 100 : 0;
    const caj = f.match(/(\d+)\s*cajon/);
    let z;
    if (caj) z = { tipo: "cajones", n: parseInt(caj[1], 10) };
    else if (/2 puertas/.test(f)) z = { tipo: "puerta", n: 2, lado: "doble" };
    else if (/divisor|abierto/.test(f)) z = { tipo: "abierto" };
    else z = { tipo: "puerta", n: 1, lado: /derecha/.test(f) ? "der" : "izq" };
    z.h = altoTotal - zoclo;
    return { ancho, alto: altoTotal - zoclo, zoclo, zocloVisible: esGab, gola: /gola/.test(f), zonas: [z] };
  }

  // ---- Dibujo -------------------------------------------------------------
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function rect(x, y, w, h, attrs) {
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" ${attrs || ""}/>`;
  }

  function shade(hex, k) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))));
    return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  function patronMaterial(id, mat) {
    if (mat && mat.foto) {
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="600" height="600">` +
        `<image href="${esc(mat.foto)}" width="600" height="600" preserveAspectRatio="xMidYMid slice"/></pattern>`;
    }
    const base = (mat && mat.color) || MADERA_BASE;
    const veta = !mat || mat.veta;
    let lineas = "";
    if (veta) {
      // Vetas deterministas: mismo dibujo siempre para el mismo material.
      for (let i = 0; i < 14; i++) {
        const x = (i * 37 + (i % 3) * 11) % 240;
        const w = 0.6 + (i % 4) * 0.5;
        lineas += `<path d="M${x} 0 C ${x + 6} 120, ${x - 5} 260, ${x + 3} 400" stroke="${shade(base, -0.18)}" stroke-width="${w}" fill="none" opacity="${0.25 + (i % 3) * 0.12}"/>`;
      }
    }
    return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="240" height="400">` +
      `<rect width="240" height="400" fill="${base}"/>${lineas}</pattern>`;
  }

  /* Estilo de frente sobre una hoja (x, y, w, h). Ids = l01_linea_frente. */
  function estiloFrente(f, x, y, w, h) {
    const d = 'fill="none" stroke="rgba(0,0,0,.30)" stroke-width="2"';
    const l = 'fill="none" stroke="rgba(255,255,255,.38)" stroke-width="1.5"';
    const s = Math.min(62, w * 0.18, h * 0.18);
    const marco = (k) => rect(x + k, y + k, w - 2 * k, h - 2 * k, d) + rect(x + k + 1.5, y + k + 1.5, w - 2 * k - 3, h - 2 * k - 3, l);
    const ingletes = (k) =>
      `<path d="M${x} ${y}L${x + k} ${y + k}M${x + w} ${y}L${x + w - k} ${y + k}M${x} ${y + h}L${x + k} ${y + h - k}M${x + w} ${y + h}L${x + w - k} ${y + h - k}" stroke="rgba(0,0,0,.28)" stroke-width="1.6"/>`;
    const largueros = (k) =>
      `<path d="M${x + k} ${y}V${y + h}M${x + w - k} ${y}V${y + h}M${x + k} ${y + k}H${x + w - k}M${x + k} ${y + h - k}H${x + w - k}" stroke="rgba(0,0,0,.28)" stroke-width="1.6"/>`;
    switch (String(f)) {
      case "2": return marco(s);                                            // Italiana
      case "3": return marco(s) + ingletes(s);                              // Mitered
      case "4": return marco(s) + ingletes(s) + marco(s + 10);              // Mitered Flat Panel
      case "5": return largueros(s);                                        // Rectangular Flat Panel
      case "6": return largueros(s) + marco(s + 14) + ingletes2(x + s, y + s, w - 2 * s, h - 2 * s, 14); // Raised
      case "7": return marco(s * 0.55) + marco(s * 0.55 + 9);               // Clásico Europeo
      case "8": return marco(s * 0.6);                                      // Clásico Europeo Flat Panel
      case "9": return rect(x, y, w, Math.min(22, h * 0.08), 'fill="rgba(0,0,0,.30)"'); // estiradera integrada
      case "10": return largueros(s) + marco(s + 6);                        // Inglesa
      default: return "";                                                   // Lisa
    }
  }
  function ingletes2(x, y, w, h, k) {
    return `<path d="M${x} ${y}L${x + k} ${y + k}M${x + w} ${y}L${x + w - k} ${y + k}M${x} ${y + h}L${x + k} ${y + h - k}M${x + w} ${y + h}L${x + w - k} ${y + h - k}" stroke="rgba(0,0,0,.22)" stroke-width="1.2"/>`;
  }

  /* Manija según su forma (opciones.json tiradores[].vista). */
  function manija(v, x, y, w, h, tipo, lado) {
    if (!v) return "";
    const c = v.color || "#aaa";
    const borde = `stroke="${shade(c, -0.35)}" stroke-width="1"`;
    const brillo = (bx, by, bw, bh) => rect(bx, by, bw, bh, `fill="${shade(c, 0.45)}" opacity=".7"`);
    const cajon = tipo === "cajon";
    // Puerta: del lado que abre (bisagra del otro lado), arriba; cajón: centrado.
    let cx = x + w / 2, cy = cajon ? y + Math.min(h * 0.32, 70) : y + Math.min(h * 0.2, 150);
    if (!cajon) cx = lado === "izq" ? x + w - 42 : x + 42;
    switch (v.forma) {
      case "barra": {
        const L = Math.min(cajon ? 160 : 180, (cajon ? w : h) * 0.55);
        return cajon
          ? rect(cx - L / 2, cy - 5, L, 10, `rx="5" fill="${c}" ${borde}`) + brillo(cx - L / 2 + 4, cy - 3.5, L - 8, 2.5)
          : rect(cx - 5, cy, 10, L, `rx="5" fill="${c}" ${borde}`) + brillo(cx - 3.5, cy + 4, 2.5, L - 8);
      }
      case "boton":
        return `<circle cx="${cx}" cy="${cy}" r="13" fill="${c}" ${borde}/><circle cx="${cx - 4}" cy="${cy - 4}" r="4" fill="${shade(c, 0.5)}" opacity=".8"/>`;
      case "cristal":
        return `<circle cx="${cx}" cy="${cy}" r="15" fill="${c}" stroke="#8fa6b8" stroke-width="1.5"/>` +
          `<path d="M${cx - 15} ${cy}H${cx + 15}M${cx} ${cy - 15}V${cy + 15}M${cx - 10} ${cy - 10}L${cx + 10} ${cy + 10}M${cx + 10} ${cy - 10}L${cx - 10} ${cy + 10}" stroke="#a9bccb" stroke-width=".8"/>`;
      case "concha":
        return `<path d="M${cx - 46} ${cy - 8} H${cx + 46} A46 30 0 0 1 ${cx - 46} ${cy - 8}Z" fill="${c}" ${borde}/>` + brillo(cx - 40, cy - 6, 80, 2.5);
      case "lateral": {
        // Cajón: en el canto de arriba, al centro. Puerta: siempre Centro-Centro,
        // en el canto del lado que abre; en doble, escalonadas para no chocar.
        const L = Math.min(110, (cajon ? w : h) * 0.5);
        if (cajon) return rect(cx - L / 2, y - 4, L, 16, `rx="2" fill="${c}" ${borde}`);
        const ly = lado === "izq" ? y + h / 2 - L : y + h / 2;
        return rect(lado === "izq" ? x + w - 4 : x - 12, ly, 16, L, `rx="2" fill="${c}" ${borde}`);
      }
      case "perfil":
        return rect(x, y - 2, w, 14, `fill="${c}" ${borde}`) + brillo(x, y - 1, w, 2);
      default: return "";
    }
  }

  function hoja(x, y, w, h, d, tipo, lado) {
    const fill = `url(#${d._pat})`;
    const sinManija = d.gola || String(d.frente) === "9";
    return rect(x, y, w, h, `fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width="1.2"`) +
      rect(x + 1.5, y + 1.5, w - 3, h - 3, 'fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1"') +
      estiloFrente(d.frente, x, y, w, h) +
      (sinManija ? "" : manija(tipo === "cajon" ? d.manijaCajon : d.manijaPuerta, x, y, w, h, tipo, lado));
  }

  /* layout: de desdeValores/desdeEtiquetas. d: { frente, manijaPuerta, manijaCajon:
     {forma,color}|null, material: {color, foto, veta}|null, gola }. */
  function svg(layout, d) {
    d = Object.assign({ gola: layout.gola }, d, { _pat: "rk-mat-" + (++serie) });
    const W = layout.ancho, H = layout.alto, Z = layout.zoclo;
    const M = 40;
    let out = "";
    // Cuerpo (costados y techo asoman alrededor de los frentes).
    out += rect(0, 0, W, H, 'fill="#ece8e1" stroke="rgba(0,0,0,.35)" stroke-width="1.5"');
    // El zoclo lleva el material de los frentes, pero metido: más angosto,
    // oscurecido y con la sombra del cuerpo encima. Sin zoclo, el cuerpo va al piso.
    if (Z > 0 && layout.zocloVisible) {
      out += rect(30, H, W - 60, Z, `fill="url(#${d._pat})"`) +
        rect(30, H, W - 60, Z, `fill="url(#${d._pat}-hueco)" stroke="rgba(0,0,0,.3)" stroke-width="1"`);
    }
    let y = 0;
    layout.zonas.forEach((z) => {
      let zy = y + GAP, zh = z.h - 2 * GAP;
      if (d.gola) {
        out += rect(GAP, y + GAP, W - 2 * GAP, GOLA - GAP, 'fill="#2f3436"') +
          rect(GAP, y + GAP + GOLA - 8, W - 2 * GAP, 3, 'fill="#8d9396"');
        zy += GOLA; zh -= GOLA;
      }
      if (z.tipo === "puerta") {
        const n = z.n || 1;
        const w = (W - GAP * (n + 1)) / n;
        for (let i = 0; i < n; i++) {
          const lado = n === 1 ? z.lado : (i < n / 2 ? "izq" : "der");
          // En doble, la manija va hacia el centro: la hoja izquierda abre a la derecha.
          out += hoja(GAP + i * (w + GAP), zy, w, zh, d, "puerta", lado);
        }
      } else if (z.tipo === "cajones") {
        const n = z.n || 1;
        const h = (zh - GAP * (n - 1)) / n;
        for (let i = 0; i < n; i++) out += hoja(GAP, zy + i * (h + GAP), W - 2 * GAP, h, d, "cajon");
      } else {
        out += rect(GAP + 18, zy, W - 2 * GAP - 36, zh, 'fill="#c9c4bb" stroke="rgba(0,0,0,.25)"') +
          rect(GAP + 18, zy + zh / 2, W - 2 * GAP - 36, 18, 'fill="#e6e1d8"');
      }
      y += z.h;
    });
    const vb = `${-M} ${-M} ${W + 2 * M} ${H + Z + 2 * M}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Vista previa del frente">` +
      `<defs>${patronMaterial(d._pat, d.material)}` +
      `<linearGradient id="${d._pat}-hueco" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".35" stop-color="#000" stop-opacity=".3"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></defs>` +
      `<ellipse cx="${W / 2}" cy="${H + Z + 6}" rx="${W * 0.6}" ry="10" fill="rgba(0,0,0,.12)"/>` +
      out +
      `<text x="${W / 2}" y="${H + Z + 30}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="20" fill="#4a5568">${Math.round(W)} × ${Math.round(H)} mm</text>` +
      `</svg>`;
  }

  return { desdeValores, desdeEtiquetas, svg, num };
})();
