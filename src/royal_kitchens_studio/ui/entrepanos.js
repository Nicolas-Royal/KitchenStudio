"use strict";

/* Gráfico interactivo de entrepaños y divisores (grupo con `visual.tipo =
   "entrepanos"` del manifiesto), a medida real del cuerpo.
     · Alzado (de frente): cuerpo, interior, frentes (punteado) y cajas de
       cajón. Arrastrar una repisa arriba/abajo cambia los altos de los
       espacios (pasa a «Personalizado»); clic alterna Entrepaño ↔ Divisor.
     · Corte lateral: frentes con su espesor, cajas con su largo, reserva del
       fondo y repisas. Arrastrar el canto de una repisa cambia su retiro; en 0
       se vuelve «Divisor».
   No guarda estado propio: lee y escribe los mismos campos del formulario de
   «Avanzado», así que formulario, receta y CSV dicen lo mismo. La geometría
   sale de window.RCC_CORE (ui/receta.js). */
window.RKEntrepanos = (function () {
  const NS = "http://www.w3.org/2000/svg";
  const MIN_ESPACIO = 10; // mm

  const fmt = (mm) => String(Math.round(mm * 10) / 10);

  /* Mover la repisa +i+ +deltaMm+ hacia arriba: crece el espacio de abajo y
     se encoge el de arriba; ninguno baja de +min+. Devuelve los espacios nuevos. */
  function arrastreAlto(espacios, i, deltaMm, min) {
    const e = espacios.slice();
    const m = min == null ? MIN_ESPACIO : min;
    let abajo = Math.round(e[i] + deltaMm), arriba = e[i] + e[i + 1] - abajo;
    if (abajo < m) { arriba -= m - abajo; abajo = m; }
    if (arriba < m) { abajo -= m - arriba; arriba = m; }
    e[i] = abajo; e[i + 1] = arriba;
    return e;
  }

  /* Retiro (mm desde el frente) acotado: 0 = divisor; deja al menos 50 mm de repisa. */
  function arrastreRetiro(mm, prof) {
    return Math.max(0, Math.min(Math.round(prof - 50), Math.round(mm)));
  }

  function el(tag, cls, txt) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function svg(tag, attrs, txt) {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    if (txt != null) n.textContent = txt;
    return n;
  }
  function rect(x, y, w, h, cls, extra) {
    return svg("rect", Object.assign({ class: cls, x, y, width: Math.max(0, w), height: Math.max(0, h) }, extra || {}));
  }

  /* +V+ = group.visual; +reg+ = { valores } del formulario (se modifica en
     sitio); cambio() avisa al formulario, que revalida y llama a pintar();
     filaDe(id) devuelve el .field de un campo (para sus pistas, opcional);
     opts.alto = alto de dibujo del cuerpo en px (280 si no se dice). */
  function crear(V, manifest, reg, rcc, cambio, filaDe, opts) {
    const ESC_ALTO = (opts && opts.alto) || 280;
    const wrap = el("div", "visual");
    const barra = el("div", "visual-barra");
    const vistas = el("div", "visual-vistas");
    const pie = el("p", "hint visual-pie");
    wrap.append(barra, vistas, pie);

    let drag = null, geom = null, cuadro = 0;
    const campo = (attr) => rcc.fieldByAttr(manifest, attr);
    const setValor = (attr, valor) => { const f = campo(attr); if (f) reg.valores[f.id] = String(valor); };
    /* Retiro de una repisa: null = «Entrepaño» (fórmula), 0 = «Divisor», o mm. */
    function setRetiro(i, mm) {
      const f = campo(V.retiros[i]);
      if (!f) return;
      if (mm === null) { reg.valores[f.id] = ""; reg.valores[f.id + "::custom"] = ""; }
      else if (mm <= 0) { reg.valores[f.id] = "0mm"; reg.valores[f.id + "::custom"] = ""; }
      else { reg.valores[f.id] = "__custom__"; reg.valores[f.id + "::custom"] = String(Math.round(mm)); }
    }
    function boton(txt, title, fn) {
      const b = el("button", "key sm", txt);
      b.type = "button"; b.title = title; b.onclick = fn;
      return b;
    }
    const cantidad = () => parseInt(reg.valores[campo(V.cantidad).id], 10) || 1;

    // ---- barra: cantidad, modo y leyenda ----------------------------------
    const lblN = el("span", "visual-n");
    const bMenos = boton("−", "Quitar repisa", () => { setValor(V.cantidad, cantidad() - 1); cambio(); });
    const bMas = boton("+", "Agregar repisa", () => { setValor(V.cantidad, cantidad() + 1); cambio(); });
    const bIguales = boton("Repartir iguales", "Vuelve a separaciones iguales", () => {
      const iguales = (campo(V.modo).opciones || []).find((o) => o.valor !== V.modo_personalizado);
      if (!iguales) return;
      setValor(V.modo, iguales.valor);
      V.espacios.forEach((a) => setValor(a, ""));   // en «Iguales» no significan nada
      cambio();
    });
    const ley = el("span", "visual-leyenda");
    ley.innerHTML = '<i class="sw sw-ent"></i>Entrepaño<i class="sw sw-div"></i>Divisor' +
      '<i class="sw sw-caj"></i>Cajón<i class="sw sw-fre"></i>Frente';
    barra.append(bMenos, lblN, bMas, bIguales, ley);

    // ---- pistas en los campos numéricos (valores recalculados) --------------
    function pistas(G) {
      if (!filaDe) return;
      V.espacios.forEach((a, j) => {
        const f = campo(a), w = f && filaDe(f.id), inp = w && w.querySelector("input");
        if (!inp) return;
        inp.placeholder = j < G.espacios.length ? "auto · " + fmt(G.espacios[j]) : "";
        // El de más arriba no está «bajo» ninguna repisa: se dice en pantalla
        // (la etiqueta del manifiesto, que es el encabezado del CSV, no cambia).
        const lbl = w.querySelector(".field-label");
        if (lbl) lbl.textContent = G.on && j === G.n ? "Espacio " + (j + 1) + " · arriba de todo" : f.label;
      });
      V.retiros.forEach((a) => {
        const f = campo(a), w = f && filaDe(f.id), sel = w && w.querySelector("select");
        if (!sel) return;
        Array.prototype.forEach.call(sel.options, (o) => {
          const p = (f.presets || []).find((x) => x.valor === o.value);
          if (p && p.formula) o.textContent = p.label + " · " + fmt(G.retiroFormula) + " mm";
        });
      });
    }

    // ---- dibujo -------------------------------------------------------------
    function pintar() {
      const G = rcc.geomEntrepanos(manifest, reg.valores, V);
      const F = rcc.geomFrentes(manifest, reg.valores, V);
      const choques = G.on ? rcc.choquesRepisas(G, F) : [];
      const chocan = {};
      choques.forEach((c) => { chocan[c.repisa] = true; });

      vistas.innerHTML = "";
      const fN = campo(V.cantidad);
      lblN.textContent = G.on ? G.n + (G.n === 1 ? " repisa" : " repisas") : "Sin repisas";
      bMenos.disabled = !G.on || G.n <= (fN.min || 1);
      bMas.disabled = !G.on || G.n >= (fN.max || 6);
      bIguales.disabled = !G.on || !G.personal;
      geom = null;
      if (!(G.cuerpo > 0) || !(G.ancho > 0) || !(G.fondoCuerpo > 0)) {
        pie.textContent = "Faltan las dimensiones del cuerpo para dibujar.";
        return;
      }
      pistas(G);

      const s = ESC_ALTO / G.cuerpo;                      // px por mm, común a las dos vistas
      const M = { t: 12, b: 24, l: 48, r: 18 };
      const Y = (z) => M.t + (G.cuerpo - z) * s;          // z en coordenadas del cuerpo
      const tPx = Math.max(3, G.esp * s);
      const anchoC = G.ancho + 2 * G.esp;
      const H = ESC_ALTO + M.t + M.b;
      const clase = (r) => "vs-repisa" + (r.divisor ? " is-div" : "") + (chocan[r.i] ? " is-choque" : "");
      const nombre = (r) => (r.divisor ? "Divisor " : "Entrepaño ") + (r.i + 1);
      const otro = (r) => (r.divisor ? "entrepaño" : "divisor");

      // Cada vista mide al menos lo que su título (10 px de monoespaciada ≈ 6.2 px
      // por letra) y el dibujo va centrado: en un mueble alto y poco profundo
      // (alacena de 1900 × 300) el corte queda angosto y el título se salía.
      const anchoVista = (wDibujo, titulo) => {
        const w = Math.max(wDibujo + M.l + M.r, titulo.length * 6.2 + 12);
        return { w, l: M.l + (w - (wDibujo + M.l + M.r)) / 2 };
      };

      // ===== Alzado ==========================================================
      const wA = anchoC * s;
      const tituloA = `Frente · ${fmt(anchoC)} × ${fmt(G.cuerpo)} mm`;
      const vA = anchoVista(wA, tituloA);
      const A = svg("svg", { class: "visual-svg", width: vA.w, height: H, viewBox: `0 0 ${vA.w} ${H}` });
      const X = (x) => vA.l + x * s;
      A.appendChild(rect(X(0), Y(G.cuerpo), wA, ESC_ALTO, "vs-cuerpo"));
      A.appendChild(rect(X(G.esp), Y(G.cuerpo - G.esp), G.ancho * s, G.alto * s, "vs-caja"));
      F.zonas.forEach((zn) => zn.cajas.forEach((c) => {
        A.appendChild(rect(X(c.x0), Y(c.z1), (c.x1 - c.x0) * s, (c.z1 - c.z0) * s, "vs-cajon"));
      }));
      if (G.on) {
        // cotas de los espacios (interior)
        let zb = G.esp;
        G.espacios.forEach((e, j) => {
          const y1 = Y(zb), y0 = Y(zb + e);
          A.appendChild(svg("line", { class: "vs-cota", x1: vA.l - 10, y1: y0, x2: vA.l - 10, y2: y1 }));
          A.appendChild(svg("text", { class: "vs-cota-txt" + (G.crudos[j] > 0 ? " is-fijo" : ""),
            x: vA.l - 14, y: (y0 + y1) / 2 + 4, "text-anchor": "end" }, fmt(e)));
          zb += e + (j < G.n ? G.esp : 0);
        });
        G.repisas.forEach((r) => {
          const il = r.lateralIzq > 0 ? Math.max(2, r.lateralIzq * s) : 0;
          const id = r.lateralDer > 0 ? Math.max(2, r.lateralDer * s) : 0;
          const g = svg("g", { class: clase(r) });
          const y = Y(r.zCuerpo + G.esp);
          g.appendChild(rect(X(G.esp), y - 6, G.ancho * s, tPx + 12, "vs-hit"));
          g.appendChild(rect(X(G.esp) + il, y, G.ancho * s - il - id, tPx, "vs-tabla", { rx: 1.5 }));
          g.appendChild(svg("title", {}, `${nombre(r)} · arrastra para mover · clic para cambiar a ${otro(r)}`));
          g.addEventListener("pointerdown", (ev) => empezar(ev, "alto", r.i, A));
          A.appendChild(g);
        });
      }
      // frentes al final, encima de todo pero sin estorbar (punteado fino)
      F.zonas.forEach((zn) => zn.frentes.forEach((fr) => {
        A.appendChild(rect(X(fr.x0), Y(fr.z1), (fr.x1 - fr.x0) * s, (fr.z1 - fr.z0) * s, "vs-frente-out"));
        A.appendChild(svg("text", { class: "vs-frente-txt", x: X(fr.x0) + 4, y: Y(fr.z1) + 11 }, fr.tipo === "puerta" ? "P" : "C" + fr.n));
      }));
      A.appendChild(svg("text", { class: "vs-titulo", x: vA.w / 2, y: ESC_ALTO + M.t + 17, "text-anchor": "middle" }, tituloA));

      // ===== Corte lateral ===================================================
      // y = 0 en la cara frontal del cuerpo, creciendo hacia el fondo; el frente
      // queda a la derecha y sobresale el espesor de puerta.
      const wC = (G.fondoCuerpo + F.espPuerta) * s;
      const tituloC = `Lado · fondo ${fmt(G.fondoCuerpo)} mm · frente →`;
      const vC = anchoVista(wC, tituloC);
      const C = svg("svg", { class: "visual-svg", width: vC.w, height: H, viewBox: `0 0 ${vC.w} ${H}` });
      const XF = vC.l + G.fondoCuerpo * s;                 // cara frontal del cuerpo
      const XC = (y) => XF - y * s;
      C.appendChild(rect(vC.l, Y(G.cuerpo), G.fondoCuerpo * s, ESC_ALTO, "vs-cuerpo"));
      C.appendChild(rect(XC(G.fondoCuerpo - G.reserva), Y(G.cuerpo - G.esp), (G.fondoCuerpo - G.reserva) * s, G.alto * s, "vs-caja"));
      if (G.reserva > 0) C.appendChild(rect(vC.l, Y(G.cuerpo - G.esp), G.reserva * s, G.alto * s, "vs-fondo"));
      F.zonas.forEach((zn) => zn.cajas.forEach((c) => {
        C.appendChild(rect(XC(c.y1), Y(c.z1), (c.y1 - c.y0) * s, (c.z1 - c.z0) * s, "vs-cajon"));
      }));
      if (G.on) {
        G.repisas.forEach((r) => {
          const y = Y(r.zCuerpo + G.esp);
          const xa = XC(G.fondoCuerpo - G.reserva), xb = XC(r.retiro);
          const g = svg("g", { class: clase(r) + " es-lado" });
          g.appendChild(rect(xa, y, Math.max(4, xb - xa), tPx, "vs-tabla", { rx: 1.5 }));
          g.appendChild(svg("title", {}, `${nombre(r)} · ${fmt(r.profundidad)} mm de fondo · clic para cambiar a ${otro(r)}`));
          g.addEventListener("click", () => { if (!drag || !drag.movio) alternarTipo(r.i); });
          C.appendChild(g);
          const h = svg("g", { class: "vs-tirador" });
          h.appendChild(rect(xb - 8, y - 6, 16, tPx + 12, "vs-hit"));
          h.appendChild(svg("circle", { cx: xb, cy: y + tPx / 2, r: 4.5 }));
          h.appendChild(svg("title", {}, "Arrastra para cambiar el retiro del frente (en 0 es divisor)"));
          h.addEventListener("pointerdown", (ev) => empezar(ev, "retiro", r.i, C));
          C.appendChild(h);
          if (!r.divisor) {
            C.appendChild(svg("text", { class: "vs-retiro", x: xb - 7, y: y - 3, "text-anchor": "end" }, (r.formula ? "ƒ " : "") + fmt(r.retiro)));
          }
        });
      }
      F.zonas.forEach((zn) => zn.frentes.forEach((fr) => {
        C.appendChild(rect(fr.interior ? XC(F.espPuerta) : XF, Y(fr.z1), F.espPuerta * s, (fr.z1 - fr.z0) * s, "vs-frente-out"));
      }));
      C.appendChild(svg("text", { class: "vs-titulo", x: vC.w / 2, y: ESC_ALTO + M.t + 17, "text-anchor": "middle" }, tituloC));

      vistas.append(A, C);

      let msg = G.on
        ? `Interior ${fmt(G.ancho)} × ${fmt(G.alto)} × ${fmt(G.prof)} mm · repisas de ${fmt(G.esp)} mm · ` +
          (G.personal ? "altos personalizados (los vacíos se reparten el resto)" : "separaciones iguales") +
          ` · ƒ = retiro por fórmula (${fmt(G.retiroFormula)} mm)`
        : "Activa «Entrepaño: Sí» para acomodar repisas. Los frentes y cajones se dibujan como referencia.";
      if (G.exceso > 1) msg += ` — se pasan ${fmt(G.exceso)} mm`;
      if (choques.length) msg += ` — ${choques.length} ${choques.length === 1 ? "choque" : "choques"} (en rojo)`;
      pie.textContent = msg;
      pie.classList.toggle("bad", G.exceso > 1 || choques.length > 0);

      geom = { G, s, XF };
    }

    function alternarTipo(i) {
      const f = campo(V.retiros[i]);
      if (!geom || !f || !rcc.fieldEnabled(f, manifest, reg.valores)) return;
      const r = geom.G.repisas[i];
      setRetiro(i, r && r.divisor ? null : 0);   // divisor → entrepaño (fórmula), si no → divisor
      cambio();
    }

    function empezar(ev, modo, i, lienzo) {
      if (ev.button !== 0 || !geom) return;
      ev.preventDefault();
      // k = px de pantalla por unidad del dibujo: en un panel angosto el SVG se encoge (max-width).
      const caja = lienzo.getBoundingClientRect();
      const k = caja.width / lienzo.viewBox.baseVal.width || 1;
      drag = { modo, i, k, x0: ev.clientX, y0: ev.clientY, left: caja.left, movio: false, base: geom, x: ev.clientX, y: ev.clientY };
      // Se fijan TODOS los espacios en su medida actual: mover una repisa no
      // hace saltar a las demás. El de arriba queda vacío (toma el resto).
      if (modo === "alto") drag.espacios = geom.G.espacios.slice();
      // La captura mantiene el arrastre aunque el puntero salga del dibujo.
      try { wrap.setPointerCapture(ev.pointerId); } catch (e) { /* sigue dentro del gráfico */ }
    }

    function aplicar() {
      cuadro = 0;
      if (!drag || !drag.movio) return;
      const { G, s, XF } = drag.base;
      if (drag.modo === "alto") {
        const e = arrastreAlto(drag.espacios, drag.i, -(drag.y - drag.y0) / drag.k / s);
        setValor(V.modo, V.modo_personalizado);
        for (let j = 0; j < G.n; j++) setValor(V.espacios[j], Math.round(e[j]));
        setValor(V.espacios[G.n], "");                      // el de arriba toma el resto
      } else {
        setRetiro(drag.i, arrastreRetiro((XF - (drag.x - drag.left) / drag.k) / s, G.prof));   // 0 = «Divisor»
      }
      cambio();
    }

    wrap.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      if (!drag.movio && Math.abs(ev.clientX - drag.x0) < 3 && Math.abs(ev.clientY - drag.y0) < 3) return;
      drag.movio = true;
      drag.x = ev.clientX; drag.y = ev.clientY;
      // Un repintado por cuadro: cada cambio revalida el formulario y la vista previa.
      if (!cuadro) cuadro = requestAnimationFrame(aplicar);
    });

    function terminar(ev) {
      if (!drag) return;
      if (cuadro) { cancelAnimationFrame(cuadro); aplicar(); }
      const d = drag;
      try { wrap.releasePointerCapture(ev.pointerId); } catch (e) { /* ya suelta */ }
      // Sin movimiento sobre una repisa del alzado = clic: alterna el tipo.
      if (!d.movio && d.modo === "alto") alternarTipo(d.i);
      setTimeout(() => { drag = null; }, 0);
    }
    wrap.addEventListener("pointerup", terminar);
    wrap.addEventListener("pointercancel", terminar);

    return { nodo: wrap, pintar };
  }

  return { crear, arrastreAlto, arrastreRetiro };
})();
