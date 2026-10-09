"use strict";

/* «Configuración avanzada»: todas las variables del manifiesto de la
   familia del módulo (familias/*.json). Visibilidad, habilitación, valores
   forzados, errores y aplanado salen de window.RCC_CORE (ui/receta.js), las
   mismas reglas que la importación de CSV. */
window.RKAvanzado = (function () {
  function el(tag, cls, txt) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  function campos(manifest) {
    return manifest.grupos.reduce((a, g) => a.concat(g.campos), []);
  }

  function aUnidad(mm, unidad) {
    const v = unidad === "cm" ? mm / 10 : unidad === "m" ? mm / 1000 : mm;
    return String(Math.round(v * 1000) / 1000);
  }

  /* Fila plana de una receta ({ attr: "870mm" }) -> valores del formulario
     ({ id: "770" }): sin unidad y sin la `suma` (zoclo, puerta), que el
     aplanado vuelve a poner. */
  function valoresDesdeFila(manifest, fila, rcc) {
    const v = rcc.defaultValores(manifest);
    campos(manifest).forEach((f) => {
      if (!Object.prototype.hasOwnProperty.call(fila, f.attr)) return;
      const raw = String(fila[f.attr]);
      const tipo = f.tipo || "numero";
      if (tipo === "select" || tipo === "derivado") { v[f.id] = raw; return; }
      if (tipo === "preset") {
        const porFormula = raw.charAt(0) === "=" && (f.presets || []).find((p) => p.formula === raw.slice(1));
        const igual = (f.presets || []).find((p) => String(p.valor) === raw);
        const p = porFormula || igual;
        if (p) { v[f.id] = p.valor; return; }
        const mm = RKVista.num(raw, NaN);
        if (!isNaN(mm)) { v[f.id] = "__custom__"; v[f.id + "::custom"] = aUnidad(mm, f.unidad); }
        return;
      }
      let mm = f.unidad ? RKVista.num(raw, NaN) : parseFloat(raw);
      if (isNaN(mm)) return;
      (f.suma || []).forEach((s) => {
        if (Object.prototype.hasOwnProperty.call(fila, s.attr)) mm -= RKVista.num(fila[s.attr], 0);
      });
      v[f.id] = f.unidad ? aUnidad(mm, f.unidad) : String(mm);
    });
    return v;
  }

  /* Escribe un valor por attr (para pasar el diseño elegido al formulario). */
  function poner(manifest, valores, attr, valor, rcc) {
    let hecho = false;
    campos(manifest).forEach((f) => {
      if (f.attr !== attr) return;
      valores[f.id] = String(valor);
      hecho = true;
    });
    if (hecho) rcc.aplicarForzados(manifest, valores);
    return hecho;
  }

  // ---- Controles ------------------------------------------------------------
  function ctrlNumero(f, reg, cambio) {
    const box = el("div", "num");
    const inp = el("input");
    inp.type = "text";
    inp.inputMode = "decimal";
    inp.placeholder = f.placeholder || "";
    inp.value = reg.valores[f.id] == null ? "" : reg.valores[f.id];
    inp.oninput = () => { reg.valores[f.id] = inp.value.trim(); cambio(); };
    box.appendChild(inp);
    if (f.unidad) box.appendChild(el("span", "unit", f.unidad));
    box.__set = (v) => { if (document.activeElement !== inp) inp.value = v == null ? "" : v; };
    box.__ctrl = inp;
    return box;
  }

  function ctrlSelect(f, reg, cambio) {
    const sel = el("select");
    (f.opciones || []).forEach((o) => {
      const op = el("option", null, o.label);
      op.value = o.valor;
      sel.appendChild(op);
    });
    sel.value = reg.valores[f.id] == null ? "" : String(reg.valores[f.id]);
    sel.onchange = () => { reg.valores[f.id] = sel.value; cambio(); };
    sel.__set = (v) => { sel.value = v == null ? "" : String(v); };
    sel.__ctrl = sel;
    return sel;
  }

  function ctrlPreset(f, reg, cambio) {
    const box = el("div", "preset");
    const sel = el("select");
    (f.presets || []).forEach((p) => {
      const op = el("option", null, p.label);
      op.value = p.valor;
      sel.appendChild(op);
    });
    if (f.permite_personalizado) {
      const op = el("option", null, "Medida personalizada…");
      op.value = "__custom__";
      sel.appendChild(op);
    }
    const num = el("div", "num");
    const inp = el("input");
    inp.type = "text";
    inp.inputMode = "decimal";
    num.appendChild(inp);
    if (f.unidad) num.appendChild(el("span", "unit", f.unidad));
    const pintar = () => {
      sel.value = reg.valores[f.id] == null ? "" : String(reg.valores[f.id]);
      num.hidden = sel.value !== "__custom__";
      inp.value = reg.valores[f.id + "::custom"] || "";
    };
    sel.onchange = () => { reg.valores[f.id] = sel.value; num.hidden = sel.value !== "__custom__"; cambio(); };
    inp.oninput = () => { reg.valores[f.id + "::custom"] = inp.value.trim(); cambio(); };
    box.appendChild(sel);
    box.appendChild(num);
    pintar();
    box.__set = pintar;
    box.__ctrl = sel;
    return box;
  }

  function ctrlStepper(f, manifest, reg, cambio, rcc) {
    const min = f.min || 0;
    const box = el("div", "stepper");
    const menos = el("button", "key", "−");
    const val = el("span", "stepper-val");
    const mas = el("button", "key", "+");
    menos.type = mas.type = "button";
    const maximo = () => {
      let max = f.max || 99;
      const mr = /^cajones:(.+)$/.exec(f.max_regla || "");
      if (mr) {
        const p = rcc.presupuestoCajones(manifest, reg.valores, mr[1]);
        if (p.aplica && isFinite(p.nMax)) max = Math.min(max, Math.max(min, p.nMax));
      }
      return max;
    };
    const get = () => parseInt(reg.valores[f.id], 10) || min;
    const pintar = () => {
      const n = get();
      val.textContent = String(n);
      menos.disabled = n <= min;
      mas.disabled = n >= maximo();
    };
    const set = (n) => { reg.valores[f.id] = String(Math.max(min, Math.min(maximo(), n))); pintar(); cambio(); };
    menos.onclick = () => set(get() - 1);
    mas.onclick = () => set(get() + 1);
    box.append(menos, val, mas);
    pintar();
    box.__set = pintar;
    box.__ctrl = null;
    return box;
  }

  // ---- Formulario -------------------------------------------------------------
  /* Monta el formulario en +cont+. +reg+ = { familia, valores } (se modifica
     en sitio). onCambio(errores) se llama tras cada edición. */
  function montar(cont, manifest, reg, rcc, onCambio) {
    cont.innerHTML = "";
    rcc.aplicarForzados(manifest, reg.valores);
    const filas = [];   // { f, g, wrap, ctrl }
    const grupos = [];  // { g, sec }

    const cambio = () => refrescar();

    manifest.grupos.forEach((g, gi) => {
      const sec = el("section", "adv-group" + (gi > 1 ? " is-collapsed" : ""));
      const head = el("button", "adv-group-head");
      head.type = "button";
      head.innerHTML = `<span>${g.titulo}</span><i class="adv-count"></i><svg class="ico" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`;
      head.onclick = () => sec.classList.toggle("is-collapsed");
      const body = el("div", "adv-fields");
      g.campos.forEach((f) => {
        const wrap = el("div", "field");
        wrap.dataset.id = f.id;
        wrap.appendChild(el("label", "field-label", f.label));
        let ctrl;
        switch (f.tipo) {
          case "select": ctrl = ctrlSelect(f, reg, cambio); break;
          case "preset": ctrl = ctrlPreset(f, reg, cambio); break;
          case "derivado": ctrl = ctrlStepper(f, manifest, reg, cambio, rcc); break;
          default: ctrl = ctrlNumero(f, reg, cambio);
        }
        wrap.appendChild(ctrl);
        const hint = el("span", "field-hint");
        wrap.appendChild(hint);
        body.appendChild(wrap);
        filas.push({ f, g, wrap, ctrl, hint });
      });
      sec.append(head, body);
      cont.appendChild(sec);
      grupos.push({ g, sec, head });
    });

    function refrescar() {
      rcc.aplicarForzados(manifest, reg.valores);
      const errores = rcc.erroresConfig(manifest, reg.valores);
      const malos = {};
      errores.forEach((e) => (e.ids || []).forEach((id) => { malos[id] = e.msg; }));
      grupos.forEach(({ g, sec, head }) => {
        const on = rcc.groupEnabled(g, manifest, reg.valores);
        sec.hidden = !on;
        const n = g.campos.filter((f) => malos[f.id]).length;
        head.querySelector(".adv-count").textContent = n ? `${n} por revisar` : "";
        if (n) sec.classList.remove("is-collapsed");
      });
      filas.forEach(({ f, wrap, ctrl, hint }) => {
        const visible = rcc.fieldVisible(f, manifest, reg.valores);
        const activo = rcc.fieldEnabled(f, manifest, reg.valores);
        wrap.hidden = !visible;
        wrap.classList.toggle("is-off", !activo);
        wrap.classList.toggle("is-bad", !!malos[f.id]);
        if (ctrl.__set) ctrl.__set(reg.valores[f.id]);
        if (!activo) wrap.querySelectorAll("input, select, button").forEach((c) => { c.disabled = true; });
        else wrap.querySelectorAll("input, select").forEach((c) => { c.disabled = false; });
        const forz = rcc.valorForzado(f, manifest, reg.valores);
        let txt = malos[f.id] || "";
        if (!txt && !activo && f.habilitado_si && f.habilitado_si.mensaje) txt = f.habilitado_si.mensaje;
        if (!txt && forz != null) txt = "Valor fijado por la configuración.";
        if (!txt && f.suma) {
          const tot = RKVista.num(rcc.effectiveValue(f, reg.valores, manifest), NaN);
          if (!isNaN(tot)) txt = `Total en SketchUp: ${Math.round(tot * 10) / 10} mm`;
        }
        if (!txt && f.nota) txt = f.nota;
        hint.textContent = txt;
        hint.classList.toggle("bad", !!malos[f.id]);
      });
      if (onCambio) onCambio(errores);
    }

    refrescar();
    return { refrescar };
  }

  return { montar, valoresDesdeFila, poner };
})();
