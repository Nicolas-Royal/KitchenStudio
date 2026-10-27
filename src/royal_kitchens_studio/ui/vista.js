"use strict";

/* Vista previa del diseño: el módulo en axonométrica (SVG) con el estilo de
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
    return Object.assign({
      ancho, alto, zoclo,
      fondo: medidas.fondo || num(v.LenY, 600),
      zocloVisible: conZoclo,
      gola: String(v.b01_gola_o_tirador) === "2",
      esp: num(v.c01_espesor_estructura, 18), espPuerta: num(v.c02_espesor_puerta, 18),
      // Arriba: 1 nada, 2 refuerzo delantero, 3 trasero, 4 los dos, 5 techo completo.
      techo: String(v.i03_tipo_techo || "4"),
      zonas,
    }, tipoGola(v));
  }

  /* Tipo de gola (g01: 1 aluminio, 2 melamina) y su hondo (los refuerzos
     delanteros van detrás): aluminio 27, melamina 45. */
  function tipoGola(v) {
    return String(v.g01_perfil_tipo) === "2" ? { golaTipo: "2", golaProf: 45 } : { golaTipo: "1", golaProf: 27 };
  }

  /* Distribución de la alacena (tipo de puerta por zona: 0 abierta, 1
     abatible, 6 Avento S, 10 Avento D). Va colgada: sin zoclo, y la manija va
     abajo (+abajo+). Con dos zonas, la de arriba mide d02 (0 = la mitad). */
  function desdeAlacena(v, medidas) {
    const ancho = medidas.ancho || num(v.LenX, 800);
    const alto = medidas.alto || num(v.LenZ, 700);
    const zona = (tipo, cantPuertas, cantAvento) => {
      const t = String(tipo == null ? "1" : tipo);
      if (t === "0") return { tipo: "abierto" };
      if (t === "6" || t === "10") {
        // Avento D: dos hojas (independientes o unidas) salvo «Una puerta».
        const hojas = String(v.d23_avento_d_tipo || "3");
        const dos = t === "10" && hojas !== "1";
        return { tipo: "avento", n: parseInt(cantAvento, 10) || 1, filas: dos ? 2 : 1,
                 unidas: hojas === "3", altoSup: dos ? num(v.d24_avento_d_alto_sup, 0) : 0 };
      }
      return Object.assign({ tipo: "puerta" }, puertas(cantPuertas || "1"));
    };
    const zonas = [zona(v.c25tipopuerta, v.d15_cant_puertas, v.d21_avento_cant_puertas)];
    if (String(v.d01_cantidad_zonas) === "2") {
      const sup = num(v.d02_alto_zona_superior, 0);
      zonas[0].h = sup > 0 && sup < alto ? sup : alto / 2;
      zonas.push(zona(v.d31_z2_contenido, v.d35_z2_cant_puertas, v.d41_z2_avento_cant_puertas));
      zonas[1].h = alto - zonas[0].h;
    } else zonas[0].h = alto;
    return { ancho, alto, zoclo: 0, zocloVisible: false, gola: false, abajo: true, zonas,
             fondo: medidas.fondo || num(v.LenY, 350), esp: num(v.c01espestr, 18), espPuerta: num(v.c02esppuerta, 18),
             techo: "5" };
  }

  /* Esquinero en L, en isométrica vista desde la esquina (svgEsquinero).
     +medidas+: ancho (izquierdo), alto del cuerpo y fondo (= ancho derecho);
     las profundidades de cada ala salen de la receta. Cada hoja mide su ancho
     menos la profundidad del ala de enfrente. Sin puerta (c25 = 0), abierto. */
  function desdeEsquinero(v, medidas) {
    const izq = medidas.ancho || num(v.LenX, 1000);
    const der = medidas.fondo || num(v.LenY, 1000);
    const alto = medidas.alto || num(v.LenZ, 770);
    const profIzq = Math.min(num(v.a0101profizq, 578), der - 100);
    const profDer = Math.min(num(v.a0102profder, 578), izq - 100);
    const abierto = String(v.c25tipopuerta == null ? "1" : v.c25tipopuerta) === "0";
    // Gola: solo la L de arriba, a lo largo de las dos hojas.
    const gola = !abierto && String(v.b01_gola_o_tirador) === "2";
    // Entrepaños en L (c24 = 0 «Sí», f01 = cuántos), con separaciones iguales
    // como los reparte el componente; z = canto de abajo desde el piso del cuerpo.
    const esp = num(v.c01espestr, 18);
    const n = String(v.c24entrepano) === "0" ? Math.max(0, parseInt(v.f01cantdiv || v["divisor>f01cantdiv"], 10) || 1) : 0;
    const hueco = (alto - 2 * esp - n * esp) / (n + 1);
    const repisas = Array.from({ length: n }, (_, i) => ({ z: esp + (i + 1) * hueco + i * esp, retiro: 20, divisor: false }));
    return Object.assign({ esquinero: true, izq, der, profIzq, profDer, alto, abierto, gola, esp, repisas,
             espPuerta: abierto ? 0 : num(v.c02esppuerta, 18),
             ancho: izq, zoclo: num(v.a02zocalo, 100), zocloVisible: true,
             zonas: [{ tipo: abierto ? "abierto" : "esquina", h: alto }],
             etiqueta: `${Math.round(izq)} × ${Math.round(der)} · alto ${Math.round(alto)} mm` }, tipoGola(v));
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
    return { ancho, alto: altoTotal - zoclo, zoclo, zocloVisible: esGab, gola: /gola/.test(f), zonas: [z],
             fondo: s.fondo_mm || (esGab ? 600 : 350), techo: esGab ? "4" : "5", abajo: !esGab && /alacena/i.test(mod.category || "") };
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

  /* Madera sin foto con la textura base de veta (la de TEKA ARTICO-VESTO1):
     la imagen teñida con el color del material, con la misma fórmula que usa
     Studio en SketchUp (Acabado.tenir): pixel = color × luminancia / media.
     Es lineal, así que va como feColorMatrix. La veta de la imagen es
     horizontal (cajones); +id+-v la gira para las puertas, como en SketchUp. */
  /* <filter> que tiñe la textura de veta con +color+ (la misma fórmula que
     Acabado.tenir). También lo usan las miniaturas del selector de material. */
  function filtroVeta(id, color, luminancia) {
    const m = (luminancia || 215) / 255;
    const rgb = (/^#?([0-9a-f]{6})$/i.exec(color || MADERA_BASE) || [0, "c9a26e"])[1];
    const k = [0, 2, 4].map((i) => parseInt(rgb.substr(i, 2), 16) / 255 / m);
    const fila = (c) => `${(c * 0.299).toFixed(4)} ${(c * 0.587).toFixed(4)} ${(c * 0.114).toFixed(4)} 0 0`;
    return `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${fila(k[0])} ${fila(k[1])} ${fila(k[2])} 0 0 0 1 0"/></filter>`;
  }

  function patronVeta(id, mat) {
    const t = mat.textura;
    const filtro = filtroVeta(`${id}-tinte`, mat.color, t.luminancia);
    const img = `<image href="${esc(t.url)}" width="${t.ancho}" height="${t.alto}" preserveAspectRatio="none" filter="url(#${id}-tinte)"/>`;
    return filtro +
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${t.ancho}" height="${t.alto}">${img}</pattern>` +
      `<pattern id="${id}-v" patternUnits="userSpaceOnUse" width="${t.ancho}" height="${t.alto}" patternTransform="rotate(90)">${img}</pattern>`;
  }

  function patronMaterial(id, mat) {
    if (mat && !mat.foto && mat.veta && mat.textura) return patronVeta(id, mat);
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

  /* Manija según su forma (opciones.json tiradores[].vista). +abajo+: la de la
     alacena (va colgada, se abre desde abajo). +canto+: distancia del eje al
     canto que abre (25 mm; el esquinero, 70 para que las dos de la esquina
     no choquen). */
  function manija(v, x, y, w, h, tipo, lado, abajo, canto) {
    if (!v) return "";
    const c = v.color || "#aaa";
    const borde = `stroke="${shade(c, -0.35)}" stroke-width="1"`;
    const brillo = (bx, by, bw, bh) => rect(bx, by, bw, bh, `fill="${shade(c, 0.45)}" opacity=".7"`);
    const cajon = tipo === "cajon", avento = tipo === "avento";
    // Las mismas reglas que fija el manifiesto (forzar de d17/d18 y e02/e03),
    // con las medidas del componente (Andrea en un gabinete de 600):
    //   puerta: arriba del lado que abre (bisagra del otro lado), vertical, la
    //           barra empieza 30 mm abajo del canto y su eje a 25 mm del canto;
    //           en la alacena, abajo del lado que abre;
    //   cajón:  al centro del frente, horizontal;
    //   Avento: abajo al centro, horizontal.
    const TOPE = 30, CANTO = canto || 25;
    const cx = cajon || avento ? x + w / 2 : (lado === "izq" ? x + w - CANTO : x + CANTO);
    // Altura de la pieza (+alto+) en la puerta o el Avento: a TOPE del canto de arriba o del de abajo.
    const yPieza = (alto) => (abajo || avento ? y + h - TOPE - alto : y + TOPE);
    switch (v.forma) {
      case "barra": {
        // Las manijas se compran de una medida: barra de 170 mm (menos si no cabe).
        const L = Math.min(170, (cajon || avento ? w : h) * 0.6);
        if (avento) return rect(cx - L / 2, yPieza(10), L, 10, `rx="5" fill="${c}" ${borde}`) + brillo(cx - L / 2 + 4, yPieza(10) + 1.5, L - 8, 2.5);
        return cajon
          ? rect(cx - L / 2, y + h / 2 - 5, L, 10, `rx="5" fill="${c}" ${borde}`) + brillo(cx - L / 2 + 4, y + h / 2 - 3.5, L - 8, 2.5)
          : rect(cx - 5, yPieza(L), 10, L, `rx="5" fill="${c}" ${borde}`) + brillo(cx - 3.5, yPieza(L) + 4, 2.5, L - 8);
      }
      case "boton": {
        const cy = cajon ? y + h / 2 : yPieza(26) + 13;
        return `<circle cx="${cx}" cy="${cy}" r="13" fill="${c}" ${borde}/><circle cx="${cx - 4}" cy="${cy - 4}" r="4" fill="${shade(c, 0.5)}" opacity=".8"/>`;
      }
      case "cristal": {
        const cy = cajon ? y + h / 2 : yPieza(30) + 15;
        return `<circle cx="${cx}" cy="${cy}" r="15" fill="${c}" stroke="#8fa6b8" stroke-width="1.5"/>` +
          `<path d="M${cx - 15} ${cy}H${cx + 15}M${cx} ${cy - 15}V${cy + 15}M${cx - 10} ${cy - 10}L${cx + 10} ${cy + 10}M${cx + 10} ${cy - 10}L${cx - 10} ${cy + 10}" stroke="#a9bccb" stroke-width=".8"/>`;
      }
      case "concha": {
        // Concha: el hueco hacia abajo (se jala desde abajo): canto recto abajo
        // y la panza arriba, centrada en el frente.
        const cy = y + h / 2 + 15;
        return `<path d="M${cx - 46} ${cy} H${cx + 46} A46 30 0 0 0 ${cx - 46} ${cy}Z" fill="${c}" ${borde}/>` + brillo(cx - 40, cy - 4.5, 80, 2.5);
      }
      case "lateral": {
        // Cajón: en el canto de arriba, al centro. Puerta: siempre Centro-Centro,
        // en el canto del lado que abre; en doble, escalonadas para no chocar.
        // Avento: en el canto de abajo, al centro.
        const L = Math.min(110, (cajon || avento ? w : h) * 0.5);
        if (cajon) return rect(cx - L / 2, y - 4, L, 16, `rx="2" fill="${c}" ${borde}`);
        if (avento) return rect(cx - L / 2, y + h - 12, L, 16, `rx="2" fill="${c}" ${borde}`);
        const ly = lado === "izq" ? y + h / 2 - L : y + h / 2;
        return rect(lado === "izq" ? x + w - 4 : x - 12, ly, 16, L, `rx="2" fill="${c}" ${borde}`);
      }
      case "perfil": {
        // Berlín: perfil de 38 mm a todo el ancho (el componente acorta la
        // hoja para dejarle lugar): en el canto de arriba, o en el de abajo
        // en la alacena.
        const P = Math.min(38, h * 0.3), py = abajo || avento ? y + h - P : y;
        return rect(x, py, w, P, `fill="${c}" ${borde}`) + brillo(x, py + 2, w, 2);
      }
      default: return "";
    }
  }

  /* +conManija+ = false: la hoja de arriba de un Avento D unido (se jala de la de abajo). */
  function hoja(x, y, w, h, d, tipo, lado, conManija) {
    // Mientras se editan los entrepaños el frente se quita: queda su contorno.
    if (d._fantasma) return rect(x, y, w, h, 'fill="none" stroke="rgba(255,255,255,.8)" stroke-width="2.5" stroke-dasharray="12 8"');
    // Con la textura de veta, la puerta la lleva vertical (patrón girado).
    const conVeta = d.material && !d.material.foto && d.material.veta && d.material.textura;
    const fill = `url(#${d._pat}${conVeta && tipo !== "cajon" ? "-v" : ""})`;
    const sinManija = d.gola || String(d.frente) === "9" || conManija === false;
    return rect(x, y, w, h, `fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width="1.2"`) +
      rect(x + 1.5, y + 1.5, w - 3, h - 3, 'fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1"') +
      estiloFrente(d.frente, x, y, w, h) +
      (sinManija ? "" : manija(tipo === "cajon" ? d.manijaCajon : d.manijaPuerta, x, y, w, h, tipo, lado, d.abajo, d.cantoManija));
  }

  /* Hueco sin frente: el mismo interior oscuro de arriba, más oscuro hacia
     el fondo de arriba, con el canto de alrededor en sombra. */
  function hueco(d, x, y, w, h) {
    return rect(x, y, w, h, `fill="url(#${d._pat}-interior)" stroke="rgba(0,0,0,.45)" stroke-width="1.5"`);
  }

  /* "#rrggbb" mezclado con negro: f = 0 igual, 1 negro. */
  function oscurecer(hex, f) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((x) => Math.round(x * (1 - f)));
    return "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  /* Canal de la gola con su tono (melamina, aluminio claro u oscuro): más
     oscuro arriba, que es lo hondo, y el canto de abajo con brillo. */
  function gradienteGola(id, color) {
    const c = color || "#2f3436";
    return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${oscurecer(c, 0.55)}"/><stop offset=".45" stop-color="${oscurecer(c, 0.3)}"/>` +
      `<stop offset="1" stop-color="${oscurecer(c, 0.08)}"/></linearGradient>`;
  }

  /* layout: de desdeValores/desdeAlacena/desdeEsquinero/desdeEtiquetas. d:
     { frente, manijaPuerta, manijaCajon: {forma,color}|null, material:
     {color, foto, veta}|null, gola, golaColor }. Todos en axonométrica: el
     esquinero desde la esquina, gabinete y alacena desde el frente (svgCaja). */
  function svg(layout, d) {
    d = Object.assign({ gola: layout.gola }, d, { abajo: !!layout.abajo, _pat: "rk-mat-" + (++serie) });
    return layout.esquinero ? svgEsquinero(layout, d) : svgCaja(layout, d);
  }

  /* Zonas del frente de ancho +W+, planas (u a lo ancho, v hacia abajo desde
     el canto de arriba del cuerpo): puertas, Avento, cajones o hueco. Con
     gola, el canal sobre cada zona; el de la de arriba lo dibuja la vista en
     3D (+golaArriba+), metido en L, y aquí solo se deja el lugar. Una zona
     sin frente es un hueco oscuro entre laterales, techo y piso (o la
     división entre zonas); cada hueco se anota en +vanos+ ({ x0, x1, y0, y1 })
     para que la vista dibuje adentro los entrepaños que se ven por él. Con
     `layout.verInterior` (mientras se editan los entrepaños) todas las zonas
     son hueco y sus frentes quedan solo como contorno punteado. */
  function zonasFrente(layout, d, W, golaArriba, vanos) {
    let out = "", y = 0;
    const E = layout.esp || 18, ultima = layout.zonas.length - 1;
    layout.zonas.forEach((z, i) => {
      let zy = y + GAP, zh = z.h - 2 * GAP;
      if (d.gola) {
        if (!(i === 0 && golaArriba)) {
          out += rect(GAP, y + GAP, W - 2 * GAP, GOLA - GAP, `fill="url(#${d._pat}-gola)"`) +
            rect(GAP, y + GAP + GOLA - 8, W - 2 * GAP, 3, 'fill="rgba(255,255,255,.35)"');
        }
        zy += GOLA; zh -= GOLA;
      }
      // Frentes de esta zona: los de siempre o, con verInterior, su contorno.
      const dz = layout.verInterior ? Object.assign({}, d, { _fantasma: true }) : d;
      if (layout.verInterior || z.tipo === "abierto") {
        const v = { x0: E, x1: W - E, y0: d.gola ? zy : y + (i === 0 ? E : E / 2), y1: y + z.h - (i === ultima ? E : E / 2) };
        out += hueco(d, v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
        if (vanos) vanos.push(v);
      }
      if (z.tipo === "puerta") {
        const n = z.n || 1;
        const w = (W - GAP * (n + 1)) / n;
        for (let i = 0; i < n; i++) {
          const lado = n === 1 ? z.lado : (i < n / 2 ? "izq" : "der");
          // En doble, la manija va hacia el centro: la hoja izquierda abre a la derecha.
          out += hoja(GAP + i * (w + GAP), zy, w, zh, dz, "puerta", lado);
        }
      } else if (z.tipo === "avento") {
        // Columnas a lo ancho; en el Avento D, dos hojas por columna.
        const n = z.n || 1, filas = z.filas || 1;
        const w = (W - GAP * (n + 1)) / n;
        const hSup = filas === 2 ? (z.altoSup > 0 ? Math.min(z.altoSup, zh - 60) : (zh - GAP) / 2) : zh;
        for (let i = 0; i < n; i++) {
          const x = GAP + i * (w + GAP);
          if (filas === 2) {
            out += hoja(x, zy, w, hSup, dz, "avento", "centro", !z.unidas) +
              hoja(x, zy + hSup + GAP, w, zh - hSup - GAP, dz, "avento", "centro");
          } else out += hoja(x, zy, w, zh, dz, "avento", "centro");
        }
      } else if (z.tipo === "cajones") {
        const n = z.n || 1;
        const h = (zh - GAP * (n - 1)) / n;
        for (let i = 0; i < n; i++) out += hoja(GAP, zy + i * (h + GAP), W - 2 * GAP, h, dz, "cajon");
      }
      y += z.h;
    });
    return out;
  }

  /* Material, gola y sombra del zoclo: lo que comparten las dos vistas. */
  function defs(d) {
    return `<defs>${patronMaterial(d._pat, d.material)}${gradienteGola(d._pat + "-gola", d.golaColor)}` +
      `<linearGradient id="${d._pat}-hueco" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".35" stop-color="#000" stop-opacity=".3"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>` +
      `<linearGradient id="${d._pat}-interior" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#1f1c19"/><stop offset=".6" stop-color="#3a352f"/><stop offset="1" stop-color="#5e5850"/></linearGradient></defs>`;
  }

  // ---- Axonometría ------------------------------------------------------------
  /* La cámara a unos 25° de altura (más baja que una isométrica, para que la
     tapa no pese más que las puertas) y girada +grados+ en planta: el
     esquinero se ve desde la esquina (45°); gabinete y alacena desde el
     frente, un poco de lado (30°: el frente manda y se ve el costado). Planta
     en mm: x a lo ancho, y hacia el frente, z hacia arriba. Cada cara se
     dibuja plana con lo mismo de siempre (hoja, estilo de frente, veta,
     manija, gola, zoclo) y una matriz la inclina: la veta y los marcos se ven
     en perspectiva sin dibujarlos aparte. */
  const ALTURA = 25 * Math.PI / 180;
  function proyeccion(grados) {
    const r = grados * Math.PI / 180, sE = Math.sin(ALTURA), KZ = Math.cos(ALTURA);
    const ax = [Math.cos(r), Math.sin(r) * sE], ay = [-Math.sin(r), Math.cos(r) * sE];
    const f4 = (n) => n.toFixed(4);
    const iso = (x, y, z) => [x * ax[0] + y * ay[0], x * ax[1] + y * ay[1] - z * KZ];
    /* Grupo que lleva el plano (u a lo ancho, v hacia abajo) a la cara que
       empieza arriba en +o+ y avanza en x (dir 1) o en -y (dir -1). */
    const cara = (o, dir, contenido) => {
      const [e, f] = iso(o[0], o[1], o[2]), a = dir === 1 ? ax : [-ay[0], -ay[1]];
      return `<g transform="matrix(${f4(a[0])} ${f4(a[1])} 0 ${f4(KZ)} ${e.toFixed(1)} ${f.toFixed(1)})">${contenido}</g>`;
    };
    // Plano acostado a la altura +z+ (u = x, v = y).
    const plano = (z) => {
      const [e, f] = iso(0, 0, z);
      return `matrix(${f4(ax[0])} ${f4(ax[1])} ${f4(ay[0])} ${f4(ay[1])} ${e.toFixed(1)} ${f.toFixed(1)})`;
    };
    return { iso, cara, plano };
  }
  const DESDE_ESQUINA = proyeccion(45), DESDE_FRENTE = proyeccion(30);

  /* Lo que comparten las vistas en 3D, para un cuerpo de alto +H+ sobre un
     zoclo +Z+ y la gola que baja +GZ+ la puerta. */
  function piezas(d, pr, H, Z, GZ) {
    const top = Z + H;
    const conVeta = d.material && !d.material.foto && d.material.veta && d.material.textura;
    const cuerpo = d.material ? `fill="url(#${d._pat}${conVeta ? "-v" : ""})"` : 'fill="#ece8e1"';
    const madera = d.material ? `url(#${d._pat})` : "#ece8e1";
    const poli = (pts, attrs) => `<polygon points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")}" ${attrs}/>`;
    const enZ = (z) => (pts, attrs) => poli(pts.map(([x, y]) => pr.iso(x, y, z)), attrs);
    // Zoclo: tira bajo el cuerpo, con el material y la sombra de los frentes.
    const zoclo = (x, w) => Z > 0
      ? rect(x, H, w, Z, `fill="url(#${d._pat})"`) + rect(x, H, w, Z, `fill="url(#${d._pat}-hueco)" stroke="rgba(0,0,0,.3)" stroke-width="1"`) : "";
    // Costado del extremo, con su zoclo, en sombra para que las puertas
    // manden; con gola, con la muesca arriba al frente (+muesca+ = [desde,
    // hasta] a lo ancho de la cara).
    const costado = (w, muesca) => {
      const pts = muesca && GZ
        ? (muesca[0] > 0 ? [[0, 0], [muesca[0], 0], [muesca[0], GZ], [w, GZ], [w, H], [0, H]]
                         : [[0, GZ], [muesca[1], GZ], [muesca[1], 0], [w, 0], [w, H], [0, H]])
        : [[0, 0], [w, 0], [w, H], [0, H]];
      return poli(pts, `${cuerpo} stroke="rgba(0,0,0,.35)" stroke-width="1.5"`) + poli(pts, 'fill="rgba(0,0,0,.2)"') +
        zoclo(0, w) + rect(0, H, w, Z, 'fill="rgba(0,0,0,.2)"');
    };
    // Tablas acostadas a la altura +z+ (la tapa, o la puerta bajada con gola):
    // cada una en su plano y una matriz la acuesta, así la veta corre a lo
    // largo de la pieza y sigue la perspectiva. El patrón base tiene la veta
    // en x; el «-v», en y.
    const tabla = (x0, y0, x1, y1, color, z) => {
      const largoEnX = x1 - x0 >= y1 - y0;
      const fill = color || (d.material ? `url(#${d._pat}${conVeta && !largoEnX ? "-v" : ""})` : "#ece8e1");
      return `<g transform="${pr.plano(z == null ? top : z)}">` + rect(x0, y0, x1 - x0, y1 - y0, `fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width="1.5"`) +
        rect(x0, y0, x1 - x0, y1 - y0, 'fill="rgba(255,255,255,.25)"') + "</g>";
    };
    // Cara vertical de +w+ × +h+ (mm) con un material y su sombra.
    const panel = (w, h, fill, luz) => rect(0, 0, w, h, `fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width="1"`) +
      rect(0, 0, w, h, `fill="rgba(0,0,0,${luz})"`);
    // Encuadre de los puntos +ps+ ([x, y, z]) con lugar abajo para el texto.
    // +sinFrentes+: arriba, el aviso de que los frentes se quitaron mientras
    // se editan los entrepaños (regresan al salir de esa sección).
    const svgDe = (ps, out, etiqueta, aria, sinFrentes) => {
      const q = ps.map((p) => pr.iso(...p)), xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
      // El aviso va a escala del dibujo (se lee igual en un mueble chico o en uno grande).
      const AVISO = "Sin frentes mientras editas entrepaños";
      const ancho = Math.max(...xs) - Math.min(...xs) + 100, fs = Math.max(20, ancho / 34), hA = fs * 2;
      const M = 50, x0 = Math.min(...xs) - M, x1 = Math.max(...xs) + M, y0 = Math.min(...ys) - (sinFrentes ? M + hA + 20 : M), y1 = Math.max(...ys) + 70;
      const wA = AVISO.length * fs * 0.62 + 2 * fs, cx = (x0 + x1) / 2;
      const aviso = sinFrentes
        ? rect(cx - wA / 2, y0 + 14, wA, hA, `rx="${(hA / 2).toFixed(1)}" fill="#1f2a2a" opacity=".85"`) +
          `<text x="${cx.toFixed(0)}" y="${(y0 + 14 + hA * 0.66).toFixed(0)}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="${fs.toFixed(0)}" fill="#fff">${esc(AVISO)}</text>`
        : "";
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0.toFixed(0)} ${y0.toFixed(0)} ${(x1 - x0).toFixed(0)} ${(y1 - y0).toFixed(0)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${aria}">` +
        defs(d) + out + aviso +
        `<text x="${((x0 + x1) / 2).toFixed(0)}" y="${(y1 - 22).toFixed(0)}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="20" fill="#4a5568">${esc(etiqueta)}</text>` +
        `</svg>`;
    };
    // Lo que se ve por los huecos sin frente: +contenido+ recortado a la boca
    // de cada uno (+bocas+: las 4 esquinas [x, y, z] de cada una).
    const porHueco = (id, bocas, contenido) => {
      if (!bocas.length || !contenido) return "";
      const pol = bocas.map((b) => `<polygon points="${b.map((p) => pr.iso(...p).map((n) => n.toFixed(1)).join(",")).join(" ")}"/>`).join("");
      return `<clipPath id="${id}">${pol}</clipPath><g clip-path="url(#${id})">${contenido}</g>`;
    };
    // Repisa acostada a la altura +z+ (su cara de arriba), en la sombra del hueco.
    const repisa = (x0, y0, x1, y1, z) => tabla(x0, y0, x1, y1, null, z) +
      poli([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => pr.iso(x, y, z)), 'fill="rgba(0,0,0,.28)"');
    return { top, conVeta, cuerpo, madera, poli, enZ, zoclo, costado, tabla, panel, svgDe, porHueco, repisa };
  }

  /* Gola: aluminio con el tono del perfil; melamina, forrada con el material
     del mueble (el frente de la gola es un tablero de 18 mm, el aluminio un
     perfil delgado). K = grosor de la pared del fondo del canal. */
  function golaDe(L, d, E) {
    const melamina = L.golaTipo === "2";
    const color = d.golaColor || "#8a8e92";
    return { melamina, color, K: melamina ? E : 4, fill: melamina && d.material ? `url(#${d._pat})` : color };
  }

  // ---- Esquinero -------------------------------------------------------------
  /* Vista desde la esquina. Planta: el ala izquierda corre a lo largo de y
     (frente en x = profIzq) y la derecha a lo largo de x (frente en y =
     profDer); la esquina interior queda al centro. */
  const MANIJA_ESQUINA = 70; // mm del eje de la manija al canto de la esquina

  function svgEsquinero(L, d) {
    const { izq: LX, der: LY, profIzq: pI, profDer: pD, alto: H, zoclo: Z } = L;
    const { iso, cara } = DESDE_ESQUINA;
    // Las manijas van a 70 mm del canto de la esquina, como en ESQUINERO.skp
    // (f12_tirador_margen_izq_der): a 25 chocaban las de las dos hojas.
    d = Object.assign({}, d, { cantoManija: MANIJA_ESQUINA });
    // Medidas de arriba: estructura, refuerzo, hondo de la gola, espesor de
    // puerta y cara de los refuerzos delanteros (detrás de la puerta y de la
    // gola). Con gola la puerta baja GOLA (40 mm) y deja el canal en L.
    const E = L.esp || 18, RF = 90, eP = L.espPuerta || 0;
    const conGola = !!d.gola && !L.abierto, GZ = conGola ? GOLA : 0, G = conGola ? (L.golaProf || 27) : 0;
    const fI = pI - (eP || 18) - G, fD = pD - (eP || 18) - G;
    const { top, cuerpo, madera, enZ, zoclo, costado, tabla, panel, svgDe, porHueco, repisa } = piezas(d, DESDE_ESQUINA, H, Z, GZ);
    const { melamina, color: golaColor, K, fill: golaFill } = golaDe(L, d, E);
    // Un frente: el canto del cuerpo y la hoja o, sin puerta, el hueco oscuro
    // entre piso, techo y costado (+boca+ = [desde, hasta] a lo ancho). Con
    // gola la parte de arriba queda vacía: por ahí se ve el canal.
    const frente = (w, lado, luz, boca) => {
      let s = rect(0, GZ, w, H - GZ, `${cuerpo} stroke="rgba(0,0,0,.35)" stroke-width="1.5"`) + zoclo(0, w);
      const zy = GZ + GAP, zh = H - GZ - 2 * GAP;
      // Mientras se editan los entrepaños, hueco y la puerta solo en contorno.
      if (L.abierto || L.verInterior) s += hueco(d, boca[0], E, boca[1] - boca[0], H - 2 * E);
      if (!L.abierto) s += hoja(GAP, zy, w - 2 * GAP, zh, L.verInterior ? Object.assign({}, d, { _fantasma: true }) : d, "puerta", lado);
      return s + (luz ? rect(0, GZ, w, top - GZ, `fill="rgba(0,0,0,${luz})"`) : "");
    };
    const wIzq = LX - pD, wDer = LY - pI;
    let out = "";
    // Sombra en el piso: la planta en L, un poco corrida hacia el frente.
    out += enZ(0)([[20, 20], [LY + 20, 20], [LY + 20, pD + 20], [pI + 20, pD + 20], [pI + 20, LX + 20], [20, LX + 20]], 'fill="rgba(0,0,0,.12)"');
    // --- Capa de fondo: todo lo que queda por dentro. Va antes que costados,
    // frentes y tablas, que lo tapan donde corresponde y se ven sobresalir.
    // El interior un grosor más abajo, más oscuro hacia atrás, con la cara de
    // los respaldos hasta él (sin ella quedaba una raya sin pintar).
    out += enZ(top - E)([[0, 0], [LY, 0], [LY, pD], [pI, pD], [pI, LX], [0, LX]], `fill="url(#${d._pat}-interior)"`);
    out += cara([E, LX - E, top], -1, panel(LX - 2 * E, E, madera, 0.55)) + cara([E, E, top], 1, panel(LY - 2 * E, E, madera, 0.6));
    // Cantos de los refuerzos que miran al interior: los traseros y el
    // delantero izquierdo donde cruza el ala derecha. El que da a la puerta
    // queda tapado.
    out += cara([E + RF, LX - E, top], -1, panel(LX - 2 * E, E, madera, 0.28));
    out += cara([fI, E + RF, top], 1, panel(LY - E - fI, E, madera, 0.16));
    if (fD - RF > E + RF) out += cara([fI, fD - RF, top], -1, panel(fD - RF - E - RF, E, madera, 0.28));
    // Canal de la gola, en L y metido: la pared del fondo (el perfil o el
    // frente de la gola) y el piso a la altura de la puerta bajada. Corre por
    // fuera de los laterales, hasta el costado.
    if (conGola) {
      out += enZ(top - GZ)([[fI + K, fD + K], [LY, fD + K], [LY, pD - eP], [pI - eP, pD - eP], [pI - eP, LX], [fI + K, LX]], `fill="${golaFill}"`) +
        enZ(top - GZ)([[fI + K, fD + K], [LY, fD + K], [LY, pD - eP], [pI - eP, pD - eP], [pI - eP, LX], [fI + K, LX]], `fill="rgba(0,0,0,${melamina ? 0.45 : 0.4})"`);
      out += cara([fI + K, LX, top], -1, panel(LX - fD - K, GZ, golaFill, melamina ? 0.2 : 0.12)) +
        cara([fI + K, fD + K, top], 1, panel(LY - fI - K, GZ, golaFill, melamina ? 0.3 : 0.22));
      // Puntas de la pared del fondo, que se ven por la muesca de cada costado.
      out += cara([fI, LX, top], 1, panel(K, GZ, golaFill, 0.3)) + cara([LY, fD + K, top], -1, panel(K, GZ, golaFill, 0.35));
    }
    // --- Cuerpo: costados (con su muesca si hay gola) y frentes.
    out += cara([0, LX, top], 1, costado(pI, [fI, pI]));
    out += cara([LY, pD, top], -1, costado(pD, [0, pD - fD]));
    out += cara([pI, LX, top], -1, frente(wIzq, "izq", 0, [E, wIzq]));
    out += cara([pI, pD, top], 1, frente(wDer, "der", 0.07, [0, wDer - E]));
    // Sin puerta, los entrepaños en L que se ven por los dos huecos: a su
    // altura, del respaldo a su retiro del frente.
    if ((L.abierto || L.verInterior) && (L.repisas || []).length) {
      let s = "";
      L.repisas.slice().sort((a, b) => a.z - b.z).forEach((r) => {
        const zt = Z + r.z + E, xf = pI - eP - (r.retiro || 0), yf = pD - eP - (r.retiro || 0);
        s += repisa(E, E, xf, LX - E, zt) + repisa(xf, E, LY - E, yf, zt) +
          cara([xf, LX - E, zt], -1, panel(LX - E - yf, E, madera, 0.15)) + cara([xf, yf, zt], 1, panel(LY - E - xf, E, madera, 0.22));
      });
      const z1 = top - E, z0 = Z + E;
      out += porHueco(`${d._pat}-vano`, [[[pI, LX - E, z1], [pI, pD, z1], [pI, pD, z0], [pI, LX - E, z0]],
                                         [[pI, pD, z1], [LY - E, pD, z1], [LY - E, pD, z0], [pI, pD, z0]]], s);
    }
    // Esquina interior: la arista donde se juntan los dos frentes.
    const [a1, a2] = [iso(pI, pD, Z), iso(pI, pD, top - GZ)];
    out += `<line x1="${a1[0].toFixed(1)}" y1="${a1[1].toFixed(1)}" x2="${a2[0].toFixed(1)}" y2="${a2[1].toFixed(1)}" stroke="rgba(0,0,0,.5)" stroke-width="1.5"/>`;
    // Canto de arriba de las puertas, de costado a costado (la puerta tapa el
    // canto de los laterales): al ras de la tapa o, con gola, abajo.
    if (eP && !L.abierto && !L.verInterior) out += tabla(pI - eP, pD - eP, pI, LX, null, top - GZ) + tabla(pI, pD - eP, LY, pD, null, top - GZ);
    // --- Arriba (va la cubierta): los cantos de respaldos y costados y los
    // cuatro refuerzos, como los arma el componente: los de cada ala a lo
    // largo de ella, los delanteros detrás de la puerta y de la gola, y los
    // del ala derecha hasta la cara del delantero izquierdo.
    out += tabla(0, 0, E, LX) + tabla(E, 0, LY, E) + tabla(E, LX - E, conGola ? fI : pI, LX) + tabla(LY - E, E, LY, conGola ? fD : pD);
    out += tabla(E, E, E + RF, LX - E) + tabla(fI, E, LY - E, E + RF);
    out += tabla(fI - RF, E, fI, LX - E) + tabla(fI, fD - RF, LY - E, fD);
    // Labio del canal: el canto del frente de la gola de melamina o el borde
    // del perfil de aluminio, hasta el costado.
    if (conGola) out += tabla(fI, fD, fI + K, LX, melamina ? null : golaColor) + tabla(fI, fD, LY, fD + K, melamina ? null : golaColor);
    // Encuadre: lo que ocupan las esquinas del mueble, con lugar para el texto.
    const ps = [[0, LX, 0], [0, LX, top], [pI, LX, 0], [LY, 0, 0], [LY, 0, top], [LY, pD, 0], [0, 0, top], [pI, pD, 0]];
    return svgDe(ps, out, L.etiqueta, "Vista previa del esquinero", L.verInterior);
  }

  // ---- Gabinete y alacena ----------------------------------------------------
  /* Caja recta vista desde el frente y un poco de la derecha: frente en
     y = fondo, costado derecho en x = ancho. El gabinete va abierto arriba
     (lleva la cubierta) con los refuerzos que diga su tipo de techo, el
     interior oscuro y, con gola, el canal en L metido como el esquinero; la
     alacena (y el gabinete con techo completo) va cerrada con su techo. */
  function svgCaja(L, d) {
    const { ancho: W, alto: H, zoclo: Z } = L;
    const P = L.fondo || 580;
    const { cara } = DESDE_FRENTE;
    const E = L.esp || 18, RF = 90, eP = L.espPuerta == null ? 18 : L.espPuerta;
    const conGola = !!d.gola, GZ = conGola ? GOLA : 0, G = conGola ? (L.golaProf || 27) : 0;
    // Cara de los refuerzos delanteros: detrás de la puerta y de la gola.
    const f = P - eP - G;
    const { top, cuerpo, madera, enZ, zoclo, costado, tabla, panel, svgDe, porHueco, repisa } = piezas(d, DESDE_FRENTE, H, Z, GZ);
    const { melamina, color: golaColor, K, fill: golaFill } = golaDe(L, d, E);
    const techo = L.techo || "4";
    const cerrado = techo === "5";
    let out = "";
    // Sombra en el piso, un poco corrida hacia el frente (la alacena va
    // colgada: sin sombra).
    if (Z > 0 || !L.abajo) out += enZ(0)([[20, 20], [W + 20, 20], [W + 20, P + 20], [20, P + 20]], 'fill="rgba(0,0,0,.12)"');
    // --- Capa de fondo (abierto): el interior un grosor más abajo, la cara
    // del respaldo y de la lateral izquierda hasta él y el canto del refuerzo
    // trasero; el del delantero da a la puerta y no se ve. El interior llega
    // solo hasta el refuerzo delantero: más adelante asomaba por la punta
    // abierta del canal de la gola.
    if (!cerrado) {
      out += enZ(top - E)([[0, 0], [W, 0], [W, f], [0, f]], `fill="url(#${d._pat}-interior)"`);
      out += cara([E, E, top], 1, panel(W - 2 * E, E, madera, 0.6)) + cara([E, f, top], -1, panel(f - E, E, madera, 0.55));
      if (techo === "3" || techo === "4") out += cara([E, E + RF, top], 1, panel(W - 2 * E, E, madera, 0.28));
    }
    // Canal de la gola: el piso a la altura de la puerta bajada, la pared del
    // fondo y su punta en el costado; corre de costado a costado.
    if (conGola) {
      const piso = [[0, f + K], [W, f + K], [W, P - eP], [0, P - eP]];
      out += enZ(top - GZ)(piso, `fill="${golaFill}"`) + enZ(top - GZ)(piso, `fill="rgba(0,0,0,${melamina ? 0.45 : 0.4})"`);
      out += cara([0, f + K, top], 1, panel(W, GZ, golaFill, melamina ? 0.3 : 0.22));
      out += cara([W, f + K, top], -1, panel(K, GZ, golaFill, 0.35));
    }
    // --- Cuerpo: el costado derecho (con su muesca si hay gola) y el frente:
    // el canto del cuerpo, el zoclo y las zonas.
    out += cara([W, P, top], -1, costado(P, [0, P - f]));
    const vanos = [];
    out += cara([0, P, top], 1, rect(0, GZ, W, H - GZ, `${cuerpo} stroke="rgba(0,0,0,.35)" stroke-width="1.5"`) + zoclo(0, W) +
      zonasFrente(L, d, W, conGola, vanos));
    // Entrepaños y divisores que se ven por los huecos sin frente: a su altura,
    // del respaldo a su retiro del frente del cuerpo (el divisor, al ras), de
    // abajo hacia arriba (la de arriba tapa a la de abajo). Detrás de una
    // puerta o un cajón no se dibujan.
    if (vanos.length && (L.repisas || []).length) {
      const yF = P - eP;
      let s = "";
      L.repisas.slice().sort((a, b) => a.z - b.z).forEach((r) => {
        const zt = Z + r.z + E, yf = yF - (r.retiro || 0);
        s += repisa(E, E, W - E, yf, zt) + cara([E, yf, zt], 1, panel(W - 2 * E, E, madera, r.divisor ? 0.05 : 0.15));
      });
      out += porHueco(`${d._pat}-vano`, vanos.map((v) => [[v.x0, P, top - v.y0], [v.x1, P, top - v.y0], [v.x1, P, top - v.y1], [v.x0, P, top - v.y1]]), s);
    }
    // Canto de arriba de las puertas, de costado a costado: al ras de la tapa
    // o, con gola, abajo.
    if (eP && !L.verInterior) out += tabla(0, P - eP, W, P, null, top - GZ);
    // --- Arriba: el techo entero, o los cantos de laterales y respaldo y los
    // refuerzos (delantero detrás de la puerta y de la gola, trasero junto al
    // respaldo).
    const fin = conGola ? f : P - eP;
    if (cerrado) out += tabla(0, 0, W, fin);
    else {
      out += tabla(0, 0, E, fin) + tabla(W - E, 0, W, fin) + tabla(E, 0, W - E, E);
      if (techo === "3" || techo === "4") out += tabla(E, E, W - E, E + RF);
      if (techo === "2" || techo === "4") out += tabla(E, f - RF, W - E, f);
    }
    // Labio del canal: el canto del frente de la gola o el borde del perfil.
    if (conGola) out += tabla(0, f, W, f + K, melamina ? null : golaColor);
    const ps = [[0, 0, top], [W, 0, top], [W, 0, 0], [W, P, 0], [0, P, 0], [0, P, top], [W, P, top]];
    return svgDe(ps, out, L.etiqueta || `${Math.round(W)} × ${Math.round(H)} · fondo ${Math.round(P)} mm`, "Vista previa del mueble", L.verInterior);
  }

  return { desdeValores, desdeAlacena, desdeEsquinero, desdeEtiquetas, svg, num, filtroVeta };
})();
