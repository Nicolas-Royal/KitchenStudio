"use strict";

/* RKProyectos: lógica pura de la lista de proyectos (filtrar, ordenar, textos
   de fecha, candado y sincronía). Sin DOM: se prueba en node. Las reglas de
   estados viven en Ruby (Registro) y llegan en onEstado. */
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
      return norm([p.folio, p.cliente, p.telefono, p.notas, d.nombre, d.sede, a.nombre].join(" ")).includes(q);
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

  return { filtrar, ordenar, fecha, haceCuanto, compromiso, candado, sincronia, nombreEstado, CANDADO_VENCE_MS };
})();
