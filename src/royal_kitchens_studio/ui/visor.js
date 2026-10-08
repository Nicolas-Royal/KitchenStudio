"use strict";

/* Visor de la vista previa: el SVG de RKVista dentro de un marco fijo que no
   crece con el módulo. Rueda = acercar/alejar en el punto del cursor,
   arrastrar = moverse, doble clic o «Ajustar» = ver el módulo completo.
   Trabaja sobre el viewBox, así el dibujo sigue nítido a cualquier zoom. */
window.RKVisor = (function () {
  const Z_MIN = 0.5, Z_MAX = 10, PASO = 1.25;
  const ICO = {
    mas: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    menos: '<path d="M5 12h14"/>',
    ajustar: '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
  };
  const boton = (k, titulo) =>
    `<button type="button" class="icon-btn" data-z="${k}" title="${titulo}" aria-label="${titulo}"><svg class="ico" viewBox="0 0 24 24">${ICO[k]}</svg></button>`;

  function crear(box) {
    if (box.__visor) return box.__visor;
    box.classList.add("visor");
    box.innerHTML = `<div class="visor-lienzo"></div>` +
      `<div class="visor-ctrl">${boton("mas", "Acercar")}${boton("menos", "Alejar")}${boton("ajustar", "Ajustar a la vista")}</div>` +
      `<span class="visor-zoom stamp">100%</span>`;
    const lienzo = box.querySelector(".visor-lienzo");
    const etiqueta = box.querySelector(".visor-zoom");
    let base = null;     // viewBox completo del dibujo
    let v = null;        // { cx, cy, z } en mm; null = ajustado
    let clave = null;

    const svg = () => lienzo.querySelector("svg");
    const actual = () => v || { cx: base.x + base.w / 2, cy: base.y + base.h / 2, z: 1 };
    // mm por pixel con preserveAspectRatio="meet" (manda el lado más justo).
    function mmPorPx(z) {
      const r = lienzo.getBoundingClientRect();
      if (!r.width || !r.height) return 1;
      return Math.max(base.w / z / r.width, base.h / z / r.height);
    }

    function aplicar() {
      const s = svg();
      if (!s || !base) return;
      const a = actual();
      const w = base.w / a.z, h = base.h / a.z;
      s.setAttribute("viewBox", `${a.cx - w / 2} ${a.cy - h / 2} ${w} ${h}`);
      etiqueta.textContent = Math.round(a.z * 100) + "%";
      box.classList.toggle("is-zoom", !!v);
    }

    /* Zoom manteniendo fijo el punto (px, py) de la pantalla (por defecto el centro). */
    function zoom(factor, px, py) {
      if (!base) return;
      const a = actual();
      const z = Math.min(Z_MAX, Math.max(Z_MIN, a.z * factor));
      if (z === a.z) return;
      const r = lienzo.getBoundingClientRect();
      const upp = mmPorPx(a.z);
      const dx = px == null ? 0 : px - (r.left + r.width / 2);
      const dy = py == null ? 0 : py - (r.top + r.height / 2);
      const mx = a.cx + dx * upp, my = a.cy + dy * upp;
      const k = a.z / z;
      v = { cx: mx - (mx - a.cx) * k, cy: my - (my - a.cy) * k, z };
      aplicar();
    }

    function ajustar() { v = null; aplicar(); }

    lienzo.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? PASO : 1 / PASO, e.clientX, e.clientY);
    }, { passive: false });

    let arrastre = null;
    lienzo.addEventListener("pointerdown", (e) => {
      if (!base || e.button !== 0) return;
      arrastre = { x: e.clientX, y: e.clientY, a: Object.assign({}, actual()) };
      lienzo.setPointerCapture(e.pointerId);
      box.classList.add("is-drag");
    });
    lienzo.addEventListener("pointermove", (e) => {
      if (!arrastre) return;
      const upp = mmPorPx(arrastre.a.z);
      v = { cx: arrastre.a.cx - (e.clientX - arrastre.x) * upp, cy: arrastre.a.cy - (e.clientY - arrastre.y) * upp, z: arrastre.a.z };
      aplicar();
    });
    const soltar = () => { arrastre = null; box.classList.remove("is-drag"); };
    lienzo.addEventListener("pointerup", soltar);
    lienzo.addEventListener("pointercancel", soltar);
    lienzo.addEventListener("dblclick", ajustar);
    box.querySelector(".visor-ctrl").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.z === "mas") zoom(PASO);
      else if (b.dataset.z === "menos") zoom(1 / PASO);
      else ajustar();
    });

    /* Pinta un SVG nuevo. Con la misma +k+ (mismo módulo) se conserva el
       acercamiento; con otra, se vuelve a ajustar. */
    function mostrar(html, k) {
      if (k !== clave) { v = null; clave = k; }
      lienzo.innerHTML = html;
      const s = svg();
      const vb = s && (s.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
      base = vb && vb.length === 4 ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] } : null;
      aplicar();
    }

    box.__visor = { mostrar, ajustar, zoom };
    return box.__visor;
  }

  return { crear };
})();
