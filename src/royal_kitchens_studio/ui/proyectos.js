"use strict";

/* RKProyectos: lógica pura de la lista de proyectos (filtrar, ordenar, textos
   de fecha, candado, sincronía y botones de estado). Sin DOM: se prueba en
   node. Las reglas de estados viven en Ruby (Registro::PASOS) y llegan en
   onEstado; Ruby vuelve a validar cada paso. */
window.RKProyectos = (function () {
  const CANDADO_VENCE_MS = 30 * 60 * 1000; // igual a Registro::CANDADO_VENCE

  const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  /* f: { q, alcance: "mios"|"todos", usuario, estado } */
  function filtrar(lista, f) {
    const q = norm(f.q).trim();
    return (lista || []).filter((p) => {
      if (f.alcance === "mios" && (p.disenadora || {}).usuario !== f.usuario) return false;
      if (f.estado && p.estado !== f.estado) return false;
      if (!q) return true;
      const d = p.disenadora || {}, a = p.actualizado || {};
      return norm([p.folio, p.cliente, p.notas, d.nombre, d.sede, a.nombre].join(" ")).includes(q);
    });
  }

  // Lo último actualizado primero.
  function ordenar(lista) {
    return (lista || []).slice().sort((a, b) =>
      String((b.actualizado || {}).fecha || "").localeCompare(String((a.actualizado || {}).fecha || "")));
  }

  const dos = (n) => String(n).padStart(2, "0");
  function fecha(iso) {
    const t = new Date(iso);
    if (isNaN(t)) return "—";
    return `${dos(t.getDate())}/${dos(t.getMonth() + 1)}/${t.getFullYear()} ${dos(t.getHours())}:${dos(t.getMinutes())}`;
  }
  function hora(iso) {
    const t = new Date(iso);
    return isNaN(t) ? "—" : `${dos(t.getHours())}:${dos(t.getMinutes())}`;
  }

  function haceCuanto(iso, ahora) {
    const t = new Date(iso);
    if (isNaN(t)) return "—";
    const min = Math.floor(((ahora || new Date()) - t) / 60000);
    if (min < 1) return "hace un momento";
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    if (d === 1) return "ayer";
    if (d < 7) return `hace ${d} días`;
    return fecha(iso).slice(0, 10);
  }

  // Fecha compromiso "2026-11-20" -> "20/11/2026"; vencida si ya pasó.
  function compromiso(s, ahora) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    if (!m) return null;
    const fin = new Date(+m[1], +m[2] - 1, +m[3], 23, 59);
    return { texto: `${m[3]}/${m[2]}/${m[1]}`, vencida: fin < (ahora || new Date()) };
  }

  /* null si nadie lo tiene abierto (o el candado ya venció). */
  function candado(c, usuario, ahora) {
    if (!c || !c.latido) return null;
    const lat = new Date(c.latido);
    if (isNaN(lat) || (ahora || new Date()) - lat >= CANDADO_VENCE_MS) return null;
    const propio = c.usuario === usuario;
    return { propio, texto: propio ? `Abierto por ti desde ${hora(c.desde)}` : `Abierto por ${c.nombre || c.usuario} desde ${hora(c.desde)}` };
  }

  const SINCRONIA = {
    ok: { clase: "ok", texto: "Sincronizado" },
    pendiente: { clase: "aviso", texto: "Pendiente de subir" },
    sin_conexion: { clase: "aviso", texto: "Sin conexión · se sube al volver" },
    conflicto: { clase: "bad", texto: "Conflicto de versiones" },
  };
  function sincronia(actual) {
    if (!actual || !actual.folio) return null;
    if (actual.modo === "consulta") return { clase: "info", texto: "Solo lectura" };
    return SINCRONIA[actual.sincronia] || SINCRONIA.ok;
  }

  function nombreEstado(estados, id) {
    const e = (estados || []).find((x) => x[0] === id);
    return e ? e[1] : id;
  }

  const EN_FABRICA = ["planeacion", "fabricacion"]; // igual a Registro::EN_FABRICA

  /* Botones de la ficha para +rol+, el principal primero. +pasos+ viene de
     Registro::PASOS. Cada uno: { tipo: "estado"|"cambio"|"recibido", a,
     etiqueta, principal, atras, nota (obligatoria), confirmar }. */
  function acciones(reg, pasos, rol) {
    const r = rol === "planeacion" ? "planeacion" : "diseno";
    const out = [];
    if (r === "planeacion" && reg.cambio_sin_revisar) {
      out.push({ tipo: "recibido", etiqueta: `Recibí el cambio (v${reg.version_congelada})`, principal: true });
    }
    (pasos || []).filter((p) => p.de === reg.estado && p.rol === r)
      .sort((x, y) => !!x.atras - !!y.atras)
      .forEach((p) => {
        out.push({
          tipo: "estado", a: p.a, atras: !!p.atras, nota: !!p.nota, confirmar: p.confirmar || "",
          etiqueta: p.a === "planeacion" && !p.atras ? `${p.etiqueta} (congela v${reg.version_actual})` : p.etiqueta,
          // Con un cambio sin confirmar no se avanza (Ruby lo valida igual).
          principal: !p.atras && !reg.cambio_sin_revisar, bloqueado: !p.atras && !!reg.cambio_sin_revisar,
        });
      });
    if (EN_FABRICA.includes(reg.estado) && reg.cambios_tras_congelar) {
      out.push({
        tipo: "cambio", nota: true, principal: !out.some((x) => x.principal),
        etiqueta: `Enviar cambio a planeación (v${reg.version_congelada} → v${reg.version_actual})`,
        confirmar: `La v${reg.version_actual} pasa a ser la congelada; la v${reg.version_congelada} queda en el historial.` +
          (r === "diseno" ? " Planeación tiene que confirmar que lo recibió." : ""),
      });
    }
    return out;
  }

  // Texto de un movimiento del historial del proyecto.
  function movimiento(e, estados) {
    const n = (id) => nombreEstado(estados, id);
    if (e.tipo === "creado") return "Creó el proyecto";
    if (e.tipo === "cambio") return `Cambio en ${e.de_version ? `v${e.de_version} → ` : ""}v${e.version}`;
    if (e.tipo === "recibido") return `Planeación recibió el cambio (v${e.version})`;
    const extra = e.version ? ` (${e.a === "aprobado" ? "aprobó" : "congeló"} v${e.version})` : "";
    return `${n(e.de)} → ${n(e.a)}${extra}`;
  }

  return { filtrar, ordenar, fecha, haceCuanto, compromiso, candado, sincronia, nombreEstado, acciones, movimiento, CANDADO_VENCE_MS };
})();
