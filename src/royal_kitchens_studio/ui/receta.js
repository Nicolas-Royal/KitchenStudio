/* ===========================================================================
   RKReceta (window.RCC_CORE) — reglas de las recetas de muebles
   ---------------------------------------------------------------------------
   Validación, valores por defecto, aplanado a variables del componente,
   nombre automático e importación de CSV, guiados por los manifiestos de
   src/royal_kitchens_studio/familias/*.json. Sin DOM: se prueba en node.

   Origen: la capa pura de KitchenCreator (plugin/royal_catalog_creator/
   html/js/app.js, commit 4f6e3fb). Desde aquí Studio es el dueño: se edita en
   este archivo, ya no allá. Los comentarios R-xx / DEV-xx refieren a las
   issues de ese repo.
   =========================================================================== */
(function () {
  'use strict';

  // Lo único que esta capa guardaba de la sesión del creador: manifiestos
  // cargados, nombres ya usados (para numerar) y el consecutivo del nombre.
  var state = { manifests: {}, registros: [], seq: 1 };

  function findManifest(familia) { return state.manifests[familia]; }
  function findField(manifest, predicate) {
    for (var g = 0; g < manifest.grupos.length; g++) {
      var campos = manifest.grupos[g].campos;
      for (var c = 0; c < campos.length; c++) {
        if (predicate(campos[c], manifest.grupos[g])) return campos[c];
      }
    }
    return null;
  }
  function fieldByAttr(manifest, attr) {
    return findField(manifest, function (f) { return f.attr === attr; });
  }

  /* Valor tal como se capturó en el formulario (con unidad), sin los ajustes
     declarativos del manifiesto. */
  function valorCapturado(field, valores) {
    var raw = valores[field.id];
    if (field.tipo === 'numero') {
      if (raw == null || raw === '') return '';
      return String(raw) + (field.unidad || '');
    }
    if (field.tipo === 'select' || field.tipo === 'derivado') {
      return (raw == null) ? '' : String(raw);
    }
    if (field.tipo === 'preset') {
      if (raw === '__custom__') {
        var cv = valores[field.id + '::custom'];
        return (cv == null || cv === '') ? '' : String(cv) + (field.unidad || '');
      }
      return (raw == null) ? '' : String(raw);   // ya viene como "190mm"
    }
    return raw == null ? '' : String(raw);
  }

  /* Valor "efectivo" de un campo tal como se inyectará (incluye unidad).
     Con `manifest` aplica además el ajuste `suma` del manifiesto: el formulario
     captura la medida del CUERPO y aquí se agrega lo que el componente espera
     ver incluido (zócalo en LenZ, espesor de puerta en LenY). Sin `manifest` se
     obtiene el valor crudo, que es lo que necesitan los propios sumandos. */
  function effectiveValue(field, valores, manifest) {
    var v = valorCapturado(field, valores);
    if (!manifest || !field.suma || v === '') return v;
    var extra = sumaExtra(manifest, field, valores);
    if (!extra) return v;
    var base = parseMm(v);
    if (isNaN(base)) return v;
    // Se emite en mm aunque el campo declare otra unidad: el valor va etiquetado
    // y el motor lo convierte igual. Redondeo a centésima para no mandar 617.9999.
    return (Math.round((base + extra) * 100) / 100) + 'mm';
  }

  /* Milímetros que el manifiesto manda sumar al valor capturado (`suma`). Cada
     sumando puede traer condiciones `si` —todas deben cumplirse— para no sumar
     una puerta que no existe o que va montada por dentro del cuerpo. */
  function sumaExtra(manifest, field, valores) {
    var total = 0;
    (field.suma || []).forEach(function (s) {
      var aplica = (s.si || []).every(function (c) { return condicionCumple(manifest, valores, c); });
      if (!aplica) return;
      var f = fieldByAttr(manifest, s.attr);
      // Lo que no se inyecta tampoco existe en el modelo, así que no se suma.
      if (!f || !fieldInyecta(f, manifest, valores)) return;
      // Sin manifiesto: el sumando se lee crudo, para que un ajuste no pueda
      // encadenarse con otro (ni entrar en recursión).
      var mm = parseMm(valorCapturado(f, valores));
      if (!isNaN(mm)) total += mm;
    });
    return total;
  }

  /* Valor numérico simple de un attr (para visible_si / patrón de nombre). */
  function attrNumber(manifest, valores, attr) {
    var n = parseInt(attrRaw(manifest, valores, attr), 10);
    return isNaN(n) ? NaN : n;
  }
  /* Un valor forzado por el manifiesto manda sobre lo capturado aunque todavía
     no se haya escrito en el registro: así ninguna lectura puede resolverse con
     el valor viejo según en qué orden se llame. */
  function attrRaw(manifest, valores, attr) {
    var f = fieldByAttr(manifest, attr);
    if (!f) return undefined;
    var forz = valorForzado(f, manifest, valores);
    return forz != null ? forz : valores[f.id];
  }

  /* "190mm" / "25cm" / "600" -> milímetros. NaN si está vacío o no es medida. */
  function parseMm(valor) {
    if (valor == null) return NaN;
    var m = String(valor).trim().match(/^(-?[\d.,]+)\s*(mm|cm|cms|m|in|"|pulg)?$/i);
    if (!m) return NaN;
    var n = parseFloat(m[1].replace(',', '.'));
    if (isNaN(n)) return NaN;
    switch ((m[2] || 'mm').toLowerCase()) {
      case 'cm': case 'cms':      return n * 10;
      case 'm':                   return n * 1000;
      case 'in': case '"': case 'pulg': return n * 25.4;
      default:                    return n;
    }
  }
  /* Medida de un attr en mm, tal como se va a inyectar (resuelve presets y
     aplica `suma`: es el mismo número que verá SketchUp). */
  function attrMm(manifest, valores, attr) {
    var f = fieldByAttr(manifest, attr);
    return f ? parseMm(effectiveValue(f, valores, manifest)) : NaN;
  }
  function fmt(mm) { return String(Math.round(mm * 10) / 10); }

  function fieldVisible(field, manifest, valores) {
    if (!field.visible_si) return true;
    // Sin `min` es el predicado normal del manifiesto: así un campo puede
    // aparecer solo con ciertos diseños de puerta, no solo por encima de un
    // número (Avento S trae dirección y tipo de apertura; Avento D, abatible).
    if (field.visible_si.min == null) return condicionCumple(manifest, valores, field.visible_si);
    var n = attrNumber(manifest, valores, field.visible_si.attr);
    if (isNaN(n)) return true;
    return n >= field.visible_si.min;
  }
  function groupEnabled(group, manifest, valores) {
    if (!group.condicion) return true;
    return condicionCumple(manifest, valores, group.condicion);
  }
  /* Predicado de condición del manifiesto, en una sola implementación para que
     habilitado_si y los sumandos de `suma` no puedan divergir:
       { attr, valor }        -> igual a ese valor
       { attr, valores: [] }  -> igual a alguno
       { attr, excepto: [] }  -> distinto de todos (ej. «puerta ≠ Ninguna»)
       { todas: [cond…] }     -> se cumplen todas (ej. «2 zonas Y zona 2 con cajones»)
       { alguna: [cond…] }    -> se cumple al menos una */
  function condicionCumple(manifest, valores, cond) {
    if (cond.todas) return cond.todas.every(function (c) { return condicionCumple(manifest, valores, c); });
    if (cond.alguna) return cond.alguna.some(function (c) { return condicionCumple(manifest, valores, c); });
    var actual = String(attrRaw(manifest, valores, cond.attr));
    if (cond.excepto) {
      return !cond.excepto.some(function (v) { return String(v) === actual; });
    }
    var esperado = cond.valores || [cond.valor];
    return esperado.some(function (v) { return String(v) === actual; });
  }
  /* Habilitación por campo: el control queda activo solo si el attr de referencia
     cumple la condición declarada. Un campo forzado nunca está activo: su valor
     ya no lo elige quien captura. */
  function fieldEnabled(field, manifest, valores) {
    if (valorForzado(field, manifest, valores) != null) return false;
    if (!field.habilitado_si) return true;
    return condicionCumple(manifest, valores, field.habilitado_si);
  }

  /* Valor que el manifiesto impone al campo cuando otra elección ya lo decidió
     (un Avento es de una sola puerta; con puerta de cajones no hay entrepaños).
     Gana la primera entrada de `forzar` cuyas condiciones se cumplan. */
  function valorForzado(field, manifest, valores) {
    var e = entradaForzada(field, manifest, valores);
    return e ? e.valor : null;
  }
  /* Por qué está fijado (el `mensaje` de esa entrada de `forzar`), o null. */
  function mensajeForzado(field, manifest, valores) {
    var e = entradaForzada(field, manifest, valores);
    return (e && e.mensaje) || null;
  }
  function entradaForzada(field, manifest, valores) {
    var hit = null;
    (field.forzar || []).forEach(function (e) {
      if (hit) return;
      if ((e.si || []).every(function (c) { return condicionCumple(manifest, valores, c); })) hit = e;
    });
    return hit;
  }

  /* Escribe los valores forzados en el registro. Se llama antes de leer la
     configuración (formulario, aplanado, validación) para que forzado y
     capturado no puedan discrepar: lo que se ve es lo que se inyecta. */
  function aplicarForzados(manifest, valores) {
    var antes = guardadosForzado(valores);
    manifest.grupos.forEach(function (g) {
      g.campos.forEach(function (f) {
        var v = valorForzado(f, manifest, valores);
        if (v != null) {
          if (!Object.prototype.hasOwnProperty.call(antes, f.id)) antes[f.id] = valores[f.id];
          if (valores[f.id] !== v) valores[f.id] = v;
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(antes, f.id)) return;
        // Ya no está forzado (se volvió a poner el zoclo): regresa lo que tenía.
        // Si lo que tenía era el mismo valor forzado (una receta que se guardó
        // así), va el default: «Sin zoclo» guarda alto 0 y con zoclo no sirve.
        var previo = antes[f.id];
        delete antes[f.id];
        var eraForzado = (f.forzar || []).some(function (e) {
          return String(e.valor) === String(previo) || (f.unidad && parseMm(e.valor) === parseMm(previo));
        });
        if (previo == null || previo === '' || eraForzado) previo = f.default != null ? f.default : '';
        valores[f.id] = previo;
      });
    });
  }
  /* Lo que tenía cada campo antes de que lo forzaran, en una propiedad oculta
     de los valores (no viaja en JSON ni en el aplanado). */
  function guardadosForzado(valores) {
    if (!Object.prototype.hasOwnProperty.call(valores, '__antesForzado')) {
      Object.defineProperty(valores, '__antesForzado', { value: {}, enumerable: false, writable: true });
    }
    return valores.__antesForzado;
  }

  /* Un campo llega al .skp si está visible y activo. Un valor forzado también
     viaja: el control se apaga, pero el atributo tiene que quedar escrito. */
  function fieldInyecta(field, manifest, valores) {
    return fieldVisible(field, manifest, valores) &&
           (fieldEnabled(field, manifest, valores) || valorForzado(field, manifest, valores) != null);
  }

  /* ¿El attr existe y está activo en esta configuración? (grupo habilitado +
     campo visible y activo). Es lo que decide si una regla que lo menciona
     aplica: un margen apagado no puede invalidar nada. */
  function attrActivo(manifest, valores, attr) {
    var res = false;
    manifest.grupos.forEach(function (g) {
      if (res || !groupEnabled(g, manifest, valores)) return;
      g.campos.forEach(function (f) {
        if (!res && f.attr === attr && fieldInyecta(f, manifest, valores)) res = true;
      });
    });
    return res;
  }

  /* Campo que puede quedarse vacío legítimamente: «Automático» reparte, y en un
     preset el valor vacío es una opción de la lista (Entrepaño). */
  function esAuto(field) { return !!field.auto; }

  /* Medida capturada, SIN el ajuste `suma` del manifiesto: las reglas
     geométricas comparan piezas del cuerpo entre sí (el zócalo contra el alto
     del cuerpo, no contra el alto ya compensado que ve SketchUp). */
  function attrMmCrudo(manifest, valores, attr) {
    var f = fieldByAttr(manifest, attr);
    return f ? parseMm(valorCapturado(f, valores)) : NaN;
  }

  // =========================================================================
  //  Presupuesto de alto de cajones — una pila por zona de fachada
  // -------------------------------------------------------------------------
  //  El gabinete por zonas reparte la fachada en 1 o 2 zonas y cada zona puede
  //  llevar su propia pila de 1–6 cajones. El componente hace el reparto solo
  //  (alturas iguales, o personalizadas con «0 = igual» y el último tomando el
  //  resto), pero NO conoce el alto físico mínimo de un cajón: con cajones
  //  demasiado bajos recorta hasta 10 mm y el herraje no entra. Aquí se repite
  //  su misma cuenta para bloquearlo antes de generar.
  //
  //  Todo vive en manifest.reglas_cajones (dato, no código):
  //    fachada          { attr_alto, restar[] }       alto total menos zoclo/márgenes
  //    margen_superior  [{ attr, si? }]               el primero que cumple manda
  //    separacion       [{ attr, si? }]               idem (gola vs tirador)
  //    zonas            { attr_cantidad, attr_alto_superior }
  //    pilas            [{ id, titulo, zona, si[], attr_cantidad, attr_modo,
  //                        valor_personalizado, attrs_alto[], max[] }]
  //  Espejo en Ruby: validar_cajones en main.rb.
  // =========================================================================

  /* Primer `attr` de la lista cuyas condiciones `si` se cumplen, en mm.
     0 si ninguna aplica o el campo no existe en el manifiesto. */
  function mmSegun(manifest, valores, lista) {
    var hit = (lista || []).filter(function (e) {
      return (e.si || []).every(function (c) { return condicionCumple(manifest, valores, c); });
    })[0];
    if (!hit) return 0;
    var mm = attrMm(manifest, valores, hit.attr);
    return isNaN(mm) ? 0 : mm;
  }

  /* Alto de la fachada = s01altofachada del componente:
     LenZ (ya con el zoclo sumado) − zoclo − margen superior − margen inferior. */
  function altoFachada(manifest, valores) {
    var R = manifest.reglas_cajones;
    var alto = attrMm(manifest, valores, R.fachada.attr_alto);
    if (isNaN(alto)) return NaN;
    (R.fachada.restar || []).forEach(function (a) {
      var v = attrMm(manifest, valores, a);
      if (!isNaN(v)) alto -= v;
    });
    return alto - mmSegun(manifest, valores, R.margen_superior);
  }

  function sepCajones(manifest, valores) {
    return mmSegun(manifest, valores, manifest.reglas_cajones.separacion);
  }

  /* Alto de la zona 1 (superior) o 2 (inferior) = zn11altozona1 / zn21altozona2.
     Con una sola zona, la zona 1 ocupa toda la fachada. La separación entre
     zonas es la misma que entre cajones (u02sepcajgola). */
  function altoZona(manifest, valores, zona) {
    var R = manifest.reglas_cajones;
    var F = altoFachada(manifest, valores);
    if (isNaN(F)) return NaN;
    var nz = attrNumber(manifest, valores, R.zonas.attr_cantidad);
    if (nz !== 2) return F;
    var sep = sepCajones(manifest, valores);
    var sup = attrMm(manifest, valores, R.zonas.attr_alto_superior);
    var z1 = Math.max(1, (!isNaN(sup) && sup > 0) ? sup : (F - sep) / 2);
    return zona === 1 ? z1 : Math.max(1, F - sep - z1);
  }

  function pilasCajones(manifest) {
    var R = manifest.reglas_cajones;
    return (R && R.pilas) || [];
  }
  function pilaPorId(manifest, id) {
    return pilasCajones(manifest).filter(function (p) { return p.id === id; })[0] || null;
  }

  function presupuestoCajones(manifest, valores, pilaId) {
    var R = manifest.reglas_cajones;
    var P = pilaPorId(manifest, pilaId);
    if (!R || !P) return { aplica: false };
    if (!(P.si || []).every(function (c) { return condicionCumple(manifest, valores, c); })) {
      return { aplica: false };
    }
    var n = attrNumber(manifest, valores, P.attr_cantidad);
    if (isNaN(n) || n < 1) return { aplica: false };

    var zona = altoZona(manifest, valores, P.zona);
    if (isNaN(zona)) return { aplica: false };
    var sep        = sepCajones(manifest, valores);
    var altoMin    = R.alto_min_mm || 0;
    var disponible = zona - sep * (n - 1);   // suma de los n frentes
    var igual      = disponible / n;
    var personal   = condicionCumple(manifest, valores, { attr: P.attr_modo, valor: P.valor_personalizado });
    var attrsAlto  = (P.attrs_alto || []).slice(0, n);

    // Mismo reparto que el componente: con «Personalizado» cada cajón toma su
    // valor (0 = igual) y el último se queda con lo que reste; con «Iguales»
    // todos miden lo mismo.
    var altos = [], fijos = [];
    for (var i = 0; i < n - 1; i++) {
      var v = personal ? attrMm(manifest, valores, attrsAlto[i]) : NaN;
      if (!isNaN(v) && v > 0) { altos.push(v); fijos.push({ mm: v, i: i }); }
      else altos.push(igual);
    }
    var asignado = altos.reduce(function (s, v) { return s + v; }, 0);
    var ultimo   = n === 1 ? disponible : disponible - asignado;
    altos.push(ultimo);

    var paso = altoMin + sep;
    // nMax = tope geométrico de la zona (todos los cajones al mínimo).
    var nMax = paso > 0 ? Math.max(1, Math.floor((zona + sep) / paso)) : n;

    var ok = true, mensaje = '';
    var tope = (P.max || []).filter(function (e) {
      return (e.si || []).every(function (c) { return condicionCumple(manifest, valores, c); });
    })[0];
    var chico = fijos.filter(function (f) { return f.mm < altoMin; })[0];
    if (tope && n > tope.n) {
      ok = false;
      mensaje = tope.mensaje || ('Máximo ' + tope.n + ' cajones en esta zona.');
    } else if (disponible <= 0) {
      ok = false;
      mensaje = 'La zona quedó en ' + fmt(zona) + ' mm. Revisa alto, zoclo, márgenes y alto de zonas.';
    } else if (!personal && igual < altoMin) {
      ok = false;
      mensaje = n + ' cajones iguales en ' + fmt(disponible) + ' mm = ' + fmt(igual) +
                ' mm cada uno, por debajo del mínimo de ' + altoMin + ' mm. En esta zona caben máximo ' +
                nMax + (nMax === 1 ? ' cajón.' : ' cajones.');
    } else if (chico) {
      ok = false;
      mensaje = 'El alto del cajón ' + (chico.i + 1) + ' (' + fmt(chico.mm) + ' mm) es menor al mínimo de ' +
                altoMin + ' mm.';
    } else if (ultimo < altoMin) {
      ok = false;
      mensaje = n === 1
        ? 'El cajón queda en ' + fmt(ultimo) + ' mm, por debajo del mínimo de ' + altoMin + ' mm.'
        : 'Los cajones 1–' + (n - 1) + ' suman ' + fmt(asignado) + ' mm y al último (el que toma el resto) le quedan ' +
          fmt(ultimo) + ' mm, por debajo del mínimo de ' + altoMin + ' mm.';
    }

    return {
      aplica: true, id: P.id, titulo: P.titulo || P.id, n: n, zona: zona, sep: sep,
      disponible: disponible, igual: igual, personal: personal, altos: altos,
      asignado: asignado, ultimo: ultimo, attrsAlto: attrsAlto,
      altoMin: altoMin, nMax: nMax, ok: ok, mensaje: mensaje
    };
  }

  /* Presupuestos de todas las pilas que aplican en esta configuración. */
  function presupuestosCajones(manifest, valores) {
    return pilasCajones(manifest)
      .map(function (P) { return presupuestoCajones(manifest, valores, P.id); })
      .filter(function (p) { return p.aplica; });
  }

  /* Alto máximo que puede tomar el cajón `attr` sin dejar al último (el que
     toma el resto) por debajo del mínimo. Lo usan los presets de alto. */
  function limiteAltoCajon(manifest, valores, attr) {
    var pila = pilasCajones(manifest).filter(function (P) {
      return (P.attrs_alto || []).indexOf(attr) >= 0;
    })[0];
    if (!pila) return Infinity;
    var p = presupuestoCajones(manifest, valores, pila.id);
    if (!p.aplica) return Infinity;
    var i = p.attrsAlto.indexOf(attr);
    if (i < 0 || i === p.n - 1) return Infinity;
    var otros = 0;
    p.altos.forEach(function (mm, j) { if (j !== i && j !== p.n - 1) otros += mm; });
    return p.disponible - otros - p.altoMin;
  }

  // =========================================================================
  //  Geometría de entrepaños, frentes y cajones (gráfico interactivo)
  // -------------------------------------------------------------------------
  //  Repite las fórmulas del componente, verificadas contra la geometría que
  //  genera SketchUp (2026-10-07). Coordenadas del CUERPO: z = 0 en la cara de
  //  abajo del cuerpo (arriba del zoclo), y = 0 en la cara frontal del cuerpo,
  //  creciendo hacia el fondo. Todo en mm.
  //
  //  Repisas (DIA01 bajo Estructura):
  //    interior  = cuerpo − 2 × espesor;  n repisas dejan n + 1 espacios
  //    «Iguales» → (interior − n × espesor) / (n + 1); «Personalizado» → cada
  //    espacio su medida y los vacíos/0 se reparten el resto
  //    fondo     = cuerpo − reserva del fondo (v41tamlenyrep1)
  //    repisa    = fondo − retiro (g01margenf = h2N)
  //  Frentes y cajones (Z1/Z2_PUERTA, Z1/Z2_CAJONES → Cajon):
  //    zonas como zn11/zn21; cajón 1 = el de ARRIBA; el último toma el resto
  //    caja      = desde el frente del cuerpo hacia atrás, largo = corredera
  //    base caja = borde inferior del frente + e34 (28 mm)
  //    lateral   = n12altolatfront acotado (ver altoLateralCajon)
  // =========================================================================

  /* Tipo de fondo del componente: Estructura!o01tipofondo =
     IF(i06_trasera=1, 1, IF(i05_ceja_trasera=1, 2, 3)). */
  function tipoFondo(manifest, valores, V) {
    if (condicionCumple(manifest, valores, V.fondo_tarja)) return 1;
    if (condicionCumple(manifest, valores, V.fondo_sin_ceja)) return 2;
    return 3;
  }

  /* Lo que el fondo ocupa detrás. Las repisas (v41tamlenyrep1) y los cajones
     (s04profinterior) usan tablas distintas: con tarja la repisa llega atrás
     del todo, pero el cajón sigue descontando el espesor del fondo. */
  function reservaFondo(manifest, valores, V, para) {
    var num = function (a) { var v = attrMmCrudo(manifest, valores, a); return isNaN(v) ? 0 : v; };
    var c03 = num(V.fondo), c01 = num(V.espesor_estructura);
    var ranura = (V.ranura_mm || 0) === 0 ? c01 : V.ranura_mm;      // i25 (técnico)
    var t = tipoFondo(manifest, valores, V);
    if (para === 'cajones') return [c03, c03, ranura + c03][t - 1];
    return [0, c03, ranura + c03][t - 1];
  }

  /* Valor de la fórmula del entrepaño: la repisa queda 5 cm más corta que el
     cuerpo (la misma que inyecta el preset «Entrepaño»). */
  function retiroFormulaMm(manifest, valores, V) {
    return 50 - reservaFondo(manifest, valores, V, 'repisas');
  }

  /* Retiro efectivo de una repisa: preset «Entrepaño» = fórmula, «Divisor» = 0,
     o la medida personalizada. */
  function retiroRepisa(manifest, valores, V, attr) {
    var f = fieldByAttr(manifest, attr);
    if (!f) return 0;
    var v = valorCapturado(f, valores);
    if (v === '') return retiroFormulaMm(manifest, valores, V);
    var mm = parseMm(v);
    return isNaN(mm) ? 0 : mm;
  }

  function geomEntrepanos(manifest, valores, V) {
    var num = function (a) { var v = a ? attrMmCrudo(manifest, valores, a) : NaN; return isNaN(v) ? 0 : v; };
    var on = condicionCumple(manifest, valores, V.activo);
    var esp    = num(V.espesor_estructura);
    var cuerpo = num(V.alto);
    var fondoC = num(V.profundidad);
    var alto   = cuerpo - 2 * esp;
    var ancho  = num(V.ancho) - 2 * esp;
    var reserva = reservaFondo(manifest, valores, V, 'repisas');
    var prof   = fondoC - reserva;
    var n      = on ? (attrNumber(manifest, valores, V.cantidad) || 0) : 0;
    var personal = condicionCumple(manifest, valores, { attr: V.modo, valor: V.modo_personalizado });
    var k      = n + 1;
    var libre  = alto - n * esp;

    var crudos = (V.espacios || []).slice(0, k).map(function (a) { return personal ? num(a) : 0; });
    while (crudos.length < k) crudos.push(0);
    var fijos  = crudos.reduce(function (s, v) { return s + (v > 0 ? v : 0); }, 0);
    var ceros  = crudos.filter(function (v) { return !(v > 0); }).length;
    var auto   = ceros > 0 ? (libre - fijos) / ceros : 0;
    var espacios = crudos.map(function (v) { return v > 0 ? v : auto; });

    var latIzq = num(V.lateral_izq), latDer = num(V.lateral_der);
    var repisas = [], z = 0;
    for (var i = 0; i < n; i++) {
      z += espacios[i];
      var retiro = retiroRepisa(manifest, valores, V, V.retiros[i]);
      var f = fieldByAttr(manifest, V.retiros[i]);
      var divisor = retiro < 0.5;
      repisas.push({ i: i, z: z, zCuerpo: esp + z, divisor: divisor, retiro: retiro,
                     formula: !!f && valorCapturado(f, valores) === '',
                     profundidad: prof - retiro,
                     // La holgura lateral es solo de los entrepaños: los
                     // divisores van pegados a las laterales (formulas_piezas).
                     lateralIzq: divisor ? 0 : latIzq, lateralDer: divisor ? 0 : latDer });
      z += esp;
    }
    var usado = espacios.reduce(function (s, v) { return s + v; }, 0) + n * esp;
    return { on: on, cuerpo: cuerpo, fondoCuerpo: fondoC, alto: alto, ancho: ancho, prof: prof,
             reserva: reserva, esp: esp, n: n, personal: personal,
             espacios: espacios, crudos: crudos, repisas: repisas, libre: libre, fijos: fijos,
             retiroFormula: retiroFormulaMm(manifest, valores, V),
             // Lo fijado que no cabe: si hay espacios en 0, ellos absorben (y quedan
             // negativos) en vez de que la suma total crezca.
             exceso: Math.max(usado - alto, fijos - libre), latIzq: latIzq, latDer: latDer };
  }

  /* Alto del lateral de la caja (Cajon!u02altolateral), en mm, para un frente
     de alto `h` mm. Las fórmulas del componente van en cm y redondean a 1 decimal:
       Tandem      n12 = ROUND(h·0.8808 − 5.735, 1)
       Antaro      n12 = ROUND(h·0.4301 + 0.229, 1)
       Telescópica n12 = e32 (12 cm)
     y luego se acota entre 3 cm y h − margen inferior. Un alto fijo de lateral
     (e35, Tandem/Antaro) reemplaza la fórmula. */
  function altoLateralCajon(tipo, hMm, C) {
    var h = hMm / 10;
    var r1 = function (x) { return Math.round(x * 10) / 10; };
    var fijo = (C.alto_lateral_tandem_antaro_mm || 0) / 10;
    var n12 = tipo === 3 ? (C.alto_lateral_telescopica_mm || 120) / 10
            : fijo > 0 ? fijo
            : tipo === 2 ? r1(h * 0.4301 + 0.229) : r1(h * 0.8808 - 5.735);
    var n13 = (C.margen_lateral_frontal_mm || 0) / 10, n15 = (C.margen_inferior_mm || 0) / 10;
    var lat = n12 - n13;
    if (lat < 3) lat = 3;
    else if (lat > h - n15 - n13) lat = h - n15 - n13;
    return lat * 10;
  }

  /* Largo de la caja (= corredera). Automático: n01corredauto =
     FLOOR(fondo, 5 cm) − IF(telescópica, 0, n05 + IF(Tandem, −1, 2.4)) cm. */
  function largoCajon(tipo, corrMm, fondoMm, C) {
    if (corrMm > 0) return corrMm;
    var base = Math.floor(fondoMm / 50 + 1e-9) * 50;
    if (tipo === 3) return base;
    return base - ((C.corredera_margen_post_mm || 0) + (tipo === 1 ? -10 : 24));
  }

  /* Frentes (puertas y cajones) y cajas de cajón de las zonas de fachada. */
  function geomFrentes(manifest, valores, V) {
    var C = V.cajones || {};
    var num = function (a) { var v = a ? attrMmCrudo(manifest, valores, a) : NaN; return isNaN(v) ? 0 : v; };
    var R = manifest.reglas_cajones;
    if (!R) return { zonas: [] };
    var cuerpo = num(V.alto), ancho = num(V.ancho), esp = num(V.espesor_estructura);
    var espPuerta = num(V.espesor_puerta);
    var k02 = num(V.margen_inf);
    var k03 = num(V.margen_izq), k04 = num(V.margen_der), k13 = num(V.sep_puertas);
    var sep = sepCajones(manifest, valores);
    var interior = condicionCumple(manifest, valores, V.montaje_interior);
    var nz = attrNumber(manifest, valores, R.zonas.attr_cantidad) === 2 ? 2 : 1;
    var h1 = altoZona(manifest, valores, 1), h2 = nz === 2 ? altoZona(manifest, valores, 2) : 0;
    var tipo = parseInt(attrRaw(manifest, valores, C.tipo), 10) || 1;
    var corr = num(C.corredera);
    var fondoCaj = num(V.profundidad) - reservaFondo(manifest, valores, V, 'cajones');
    var inset = esp + (tipo === 1 ? 10 : tipo === 2 ? 37.5 : (C.espesor_telescopica_mm || 13));

    var zonas = [];
    var defs = [{ zona: 1, z0: nz === 2 ? k02 + h2 + sep : k02, h: h1 }];
    if (nz === 2) defs.push({ zona: 2, z0: k02, h: h2 });
    defs.forEach(function (d) {
      var Z = (V.zonas || [])[d.zona - 1];
      var cont = String(attrRaw(manifest, valores, Z.contenido));
      var x0 = k03, x1 = ancho - k04;
      var zona = { zona: d.zona, z0: d.z0, z1: d.z0 + d.h, contenido: cont === '1' ? 'puerta' : cont === '2' ? 'cajones' : 'nada',
                   frentes: [], cajas: [] };
      // «Montaje interior» solo mete las PUERTAS dentro del cuerpo (Z?_PUERTA
      // usa f01posextintpu); los frentes de cajón siguen por fuera. Medido.
      if (zona.contenido === 'puerta') {
        var px0 = interior ? esp : x0, px1 = interior ? ancho - esp : x1;
        var fz0 = interior ? d.z0 + esp : d.z0, fz1 = interior ? d.z0 + d.h - esp : d.z0 + d.h;
        var v = parseInt(attrRaw(manifest, valores, Z.puertas), 10) || 1;
        var hojas = v <= 2 ? 1 : v - 1;
        var w = (px1 - px0 - (hojas - 1) * k13) / hojas;
        for (var i = 0; i < hojas; i++) {
          zona.frentes.push({ tipo: 'puerta', interior: interior, x0: px0 + i * (w + k13), x1: px0 + i * (w + k13) + w, z0: fz0, z1: fz1 });
        }
      } else if (zona.contenido === 'cajones') {
        var p = presupuestoCajones(manifest, valores, Z.pila);
        if (p.aplica) {
          var top = d.z0 + d.h;
          p.altos.forEach(function (hc, j) {
            var zf1 = top, zf0 = top - hc;
            top = zf0 - sep;
            zona.frentes.push({ tipo: 'cajon', n: j + 1, x0: x0, x1: x1, z0: zf0, z1: zf1 });
            var lat = altoLateralCajon(tipo, hc, C);
            var cz0 = zf0 + (C.margen_inferior_mm || 0);
            zona.cajas.push({ n: j + 1, x0: inset, x1: ancho - inset, z0: cz0, z1: cz0 + lat,
                              y0: 0, y1: largoCajon(tipo, corr, fondoCaj, C) });
          });
        }
      }
      zonas.push(zona);
    });
    return { zonas: zonas, cuerpo: cuerpo, ancho: ancho, espPuerta: espPuerta, interior: interior,
             tipoCajon: tipo, fondoCajones: fondoCaj };
  }

  /* Choques de las repisas con lo que hay en las zonas: cajas de cajón (en
     altura y en fondo) y puertas montadas por dentro del cuerpo. */
  function choquesRepisas(G, F) {
    var out = [];
    G.repisas.forEach(function (r) {
      var z0 = r.zCuerpo, z1 = r.zCuerpo + G.esp;
      F.zonas.forEach(function (zn) {
        // Un cajón usa todo el alto de su frente al abrirse y cerrarse (lo que se
        // guarda, el herraje), no solo el de su caja dibujada: la franja que
        // ocupan los cajones va de la base de la caja de abajo al tope de la zona.
        // La repisa ocupa del fondo hasta (frente + retiro) y la caja del frente
        // hasta su largo: se cruzan en fondo si el retiro es menor que la caja.
        if (!zn.cajas.length) return;
        var b0 = Math.min.apply(null, zn.cajas.map(function (c) { return c.z0; }));
        var largo = Math.max.apply(null, zn.cajas.map(function (c) { return c.y1; }));
        if (z1 > b0 + 0.5 && z0 < zn.z1 - 0.5 && r.retiro < largo) {
          out.push({ repisa: r.i, zona: zn.zona, motivo: 'cajon' });
        }
      });
      F.zonas.forEach(function (zn) {
        if (F.interior && zn.contenido === 'puerta' && z1 > zn.z0 && z0 < zn.z1 && r.retiro < F.espPuerta) {
          out.push({ repisa: r.i, zona: zn.zona, motivo: 'puerta' });
        }
      });
    });
    return out;
  }

  function visualesEntrepanos(manifest) {
    return manifest.grupos.filter(function (g) { return g.visual && g.visual.tipo === 'entrepanos'; });
  }

  // =========================================================================
  //  Presupuesto de alto de divisores  (R-14)
  // -------------------------------------------------------------------------
  //  A diferencia de los cajones, esto NO bloquea: los espacios personalizados
  //  que no llenan el alto pueden ser una variante legítima. Solo tienen que
  //  verse, con el mismo resumen que la pila de cajones.
  // =========================================================================
  function presupuestoDivisores(manifest, valores) {
    var D = manifest.reglas_divisores;
    var R = D && D.presupuesto;
    if (!R || !attrActivo(manifest, valores, D.attr_cantidad)) return { aplica: false };
    if (R.solo_si && !condicionCumple(manifest, valores, R.solo_si)) return { aplica: false };

    var n = attrNumber(manifest, valores, D.attr_cantidad);
    if (isNaN(n) || n < 1) return { aplica: false };

    // Crudo a propósito: el alto interior se mide contra el CUERPO, no contra el
    // alto ya compensado con el zócalo que se le manda a SketchUp.
    var util = attrMmCrudo(manifest, valores, R.attr_alto_util);
    if (isNaN(util)) return { aplica: false };
    (R.attr_restar || []).forEach(function (a) {
      var v = attrMmCrudo(manifest, valores, a);
      if (!isNaN(v)) util -= v;
    });

    var suma = 0, puestos = 0;
    (R.attrs_espacio || []).slice(0, n).forEach(function (a) {
      var v = attrMmCrudo(manifest, valores, a);
      if (!isNaN(v)) { suma += v; puestos++; }
    });

    return {
      aplica: true, n: n, util: util, suma: suma, puestos: puestos,
      exceso: suma - util, ok: suma - util <= 1
    };
  }

  // =========================================================================
  //  Validación de la configuración — una sola capa (DEV-21)
  // -------------------------------------------------------------------------
  //  La usan los tres caminos que pueden producir un .skp: el botón «Generar»,
  //  el pre-vuelo de «Generar todos» y la revisión de la importación. Tener una
  //  sola implementación es el punto de R-32: dos caminos que generan el mismo
  //  archivo no pueden aceptar cosas distintas.
  //
  //  Devuelve [{ ids, label, msg }]; `ids` son los campos que hay que marcar.
  // =========================================================================
  function erroresConfig(manifest, valores) {
    aplicarForzados(manifest, valores);
    var errs = [];

    // Campo por campo: requerido (R-27/R-20), medida válida (R-09/R-22) y signo
    // (R-08). Un campo apagado no se valida: no va a llegar al modelo.
    manifest.grupos.forEach(function (g) {
      var gOn = groupEnabled(g, manifest, valores);
      g.campos.forEach(function (f) {
        if (!gOn || !fieldVisible(f, manifest, valores) || !fieldEnabled(f, manifest, valores)) return;
        var v = valorCapturado(f, valores);
        if (v === '') {
          if (!esAuto(f)) errs.push({ ids: [f.id], label: f.label, msg: 'Falta el valor.' });
          return;
        }
        if (f.tipo !== 'numero' && f.tipo !== 'preset') return;
        var mm = parseMm(v);
        if (isNaN(mm))          errs.push({ ids: [f.id], label: f.label, msg: 'No es una medida válida: «' + v + '».' });
        else if (mm < 0)        errs.push({ ids: [f.id], label: f.label, msg: 'No puede ser negativo.' });
        else if (f.positivo && mm === 0) errs.push({ ids: [f.id], label: f.label, msg: 'Tiene que ser mayor que cero.' });
      });
    });

    // Imposibles geométricos declarados en el manifiesto (R-10/R-11/R-12/R-25):
    // la suma de unas piezas contra la dimensión de la que se descuentan.
    (manifest.reglas_geometria || []).forEach(function (r) {
      if (!attrActivo(manifest, valores, r.menor_que)) return;
      var objetivo = attrMmCrudo(manifest, valores, r.menor_que);
      if (isNaN(objetivo)) return;

      var suma = 0, hay = false, ids = [];
      (r.attrs || []).forEach(function (a) {
        if (!attrActivo(manifest, valores, a)) return;
        var v = attrMmCrudo(manifest, valores, a);
        if (isNaN(v)) return;
        var f = fieldByAttr(manifest, a);
        if (f) ids.push(f.id);
        suma += v; hay = true;
      });
      if (!hay) return;

      var mal = (r.modo === '<=') ? (suma > objetivo + 0.01) : (suma >= objetivo - 0.01);
      if (mal) errs.push({ ids: ids, label: '', msg: r.mensaje + ' (' + fmt(suma) + ' mm contra ' + fmt(objetivo) + ' mm).' });
    });

    presupuestosCajones(manifest, valores).forEach(function (p) {
      if (p.ok) return;
      var P = pilaPorId(manifest, p.id);
      var f = P && fieldByAttr(manifest, P.attr_cantidad);
      errs.push({ ids: p.attrsAlto.map(function (a) { var c = fieldByAttr(manifest, a); return c ? c.id : a; })
                    .concat(f ? [f.id] : []),
                  label: 'Cajones ' + p.titulo, msg: p.mensaje });
    });

    return errs;
  }

  /* Lo que debe verse pero no bloquea (R-14 y R-17). */
  function avisosConfig(manifest, valores) {
    var out = [];
    visualesEntrepanos(manifest).forEach(function (g) {
      if (!groupEnabled(g, manifest, valores)) return;
      var G = geomEntrepanos(manifest, valores, g.visual);
      if (!G.on || !G.n) return;
      if (G.exceso > 1) {
        out.push('Los espacios fijados entre repisas suman ' + fmt(G.fijos) + ' mm y solo caben ' + fmt(G.libre) +
                 ' mm: se pasan ' + fmt(G.exceso) + ' mm.');
      } else {
        G.espacios.forEach(function (e, i) {
          if (e < 1) out.push('El espacio ' + (i + 1) + ' entre repisas quedó en ' + fmt(e) + ' mm.');
        });
      }
      G.repisas.forEach(function (r) {
        if (r.profundidad < 50) out.push('La repisa ' + (r.i + 1) + ' queda de ' + fmt(r.profundidad) + ' mm de profundidad: revisa su retiro.');
      });
      choquesRepisas(G, geomFrentes(manifest, valores, g.visual)).forEach(function (c) {
        out.push(c.motivo === 'cajon'
          ? 'La repisa ' + (c.repisa + 1) + ' choca con los cajones de la zona ' + c.zona + ': súbela a la zona de puerta o quítala.'
          : 'La repisa ' + (c.repisa + 1) + ' choca con la puerta interior de la zona ' + c.zona +
            ': dale un retiro de al menos el espesor de puerta.');
      });
    });
    var d = presupuestoDivisores(manifest, valores);
    if (d.aplica && !d.ok) {
      out.push('Los espacios de los divisores suman ' + fmt(d.suma) + ' mm y el alto interior es ' + fmt(d.util) + ' mm.');
    }
    return out;
  }

  var RE_NOMBRE_INVALIDO = /[\\\/:*?"<>|]/;

  /* Todo lo que impide generar un registro, en texto listo para mostrar.
     Incluye el nombre de archivo (R-28), que no es parte del manifiesto. */
  function problemasRegistro(r) {
    var manifest = findManifest(r.familia);
    if (!manifest) return ['No se cargó el manifiesto de ' + r.titulo + '.'];

    var msgs = erroresConfig(manifest, r.valores).map(function (e) {
      return e.label ? e.label + ': ' + e.msg : e.msg;
    });
    var n = (r.nombre_salida || '').trim();
    if (!n) msgs.push('Falta el nombre del módulo.');
    else if (RE_NOMBRE_INVALIDO.test(n)) {
      msgs.push('El nombre no puede llevar \\ / : * ? " < > |');
    }
    return msgs;
  }

  /* Nombre libre en la sesión: al repetirse se numera en vez de sobrescribir el
     .skp del módulo anterior (R-29). */
  function nombreUnico(base, idPropio) {
    var usados = {};
    state.registros.forEach(function (r) {
      if (r.id !== idPropio && r.nombre_salida) usados[normTexto(r.nombre_salida)] = true;
    });
    var nombre = base, n = 2;
    while (usados[normTexto(nombre)]) { nombre = base + '-' + n; n++; }
    return nombre;
  }

  // ---- Defaults / registro nuevo ------------------------------------------
  function defaultValores(manifest) {
    var v = {};
    manifest.grupos.forEach(function (g) {
      g.campos.forEach(function (f) {
        if (f.tipo === 'preset') {
          // default "" es legítimo (ej. «Automático»); solo se cae al primer
          // preset cuando el manifiesto no declara default.
          v[f.id] = (f.default != null) ? f.default : (f.presets[0] ? f.presets[0].valor : '');
          v[f.id + '::custom'] = '';
        } else {
          v[f.id] = (f.default != null) ? f.default : '';
        }
      });
    });
    return v;
  }

  /* Patrón del nombre de archivo:
       {attr}        -> valor del attr, traducido por `nombre_codigos[attr]` si
                        lo declara (p. ej. Cajones = "C"). Un attr que no se
                        inyecta en esta configuración se escribe vacío.
       [ … ]         -> tramo opcional: desaparece si todos sus {attr} quedaron
                        vacíos (la zona 2 de un gabinete de una sola zona).
     Sin `nombre_codigos`, un {attr} vacío vale "0" como antes. */
  function autoNombre(manifest, valores) {
    var patron = manifest.nombre_patron;
    if (!patron) return manifest.titulo + '-' + state.seq;
    var codigos = manifest.nombre_codigos;
    function token(attr) {
      if (codigos && !attrActivo(manifest, valores, attr)) return '';
      var r = attrRaw(manifest, valores, attr);
      if (r == null || r === '') return codigos ? '' : '0';
      var mapa = codigos && codigos[attr];
      if (mapa && Object.prototype.hasOwnProperty.call(mapa, String(r))) return mapa[String(r)];
      return String(r);
    }
    function sustituir(txt) {
      var hubo = false;
      var out = txt.replace(/\{([^}]+)\}/g, function (_, attr) {
        var t = token(attr);
        if (t !== '') hubo = true;
        return t;
      });
      return { txt: out, hubo: hubo };
    }
    var conTramos = patron.replace(/\[([^\]]*)\]/g, function (_, dentro) {
      var s = sustituir(dentro);
      return s.hubo ? s.txt : '';
    });
    return sustituir(conTramos).txt;
  }



  /* Si el preset está en «Personalizado» con una medida igual a la de un preset
     de medida fija, cambia a ese preset. Devuelve true si cambió algo. */
  function normalizarPreset(field, valores) {
    if (valores[field.id] !== '__custom__') return false;
    var mm = parseMm(String(valores[field.id + '::custom'] || '') + (field.unidad || ''));
    if (isNaN(mm)) return false;
    var hit = (field.presets || []).filter(function (p) {
      var pm = parseMm(p.valor);
      return p.valor !== '' && !isNaN(pm) && Math.abs(pm - mm) < 0.05;
    })[0];
    if (!hit) return false;
    valores[field.id] = hit.valor;
    valores[field.id + '::custom'] = '';
    return true;
  }


  /* Aplana el registro activo a { attr: valorEfectivo } respetando visibilidad. */
  function flatten(manifest, registro) {
    var flat = {};
    aplicarForzados(manifest, registro.valores);
    manifest.grupos.forEach(function (g) {
      if (!groupEnabled(g, manifest, registro.valores)) return;
      g.campos.forEach(function (f) {
        if (!fieldInyecta(f, manifest, registro.valores)) return;
        var v = effectiveValue(f, registro.valores, manifest);
        // `vacio`: lo que se inyecta cuando el campo se deja en blanco. Un espacio
        // entre repisas vacío significa «reparto automático» y el componente lo
        // espera en 0; sin escribirlo, el .skp conservaría su valor anterior.
        if ((v === '' || v == null) && f.vacio != null) {
          flat[f.attr] = f.vacio;
          return;
        }
        if (v === '' || v == null) {
          // Un preset vacío («Entrepaño») puede traer su propia fórmula: se
          // inyecta explícita para no depender de que el componente base la
          // conserve intacta.
          if (f.tipo === 'preset') {
            var opt = buscarOpcion(f.presets, v);
            if (opt && opt.formula) flat[f.attr] = '=' + opt.formula;
          }
          return;
        }
        flat[f.attr] = v;   // duplicados de attr: gana el último (quirk conocido de la definición)
      });
    });
    return flat;
  }

  /* Nombre de la pieza de cada división, resuelto desde el MODO elegido en el
     desplegable del margen frontal. No se compara la medida contra 0: el dato
     explícito ya existe, y un margen personalizado de 0 mm sigue siendo
     entrepaño. Se resuelve una sola vez, aquí, y el motor solo aplica la lista
     (índice 0 = división 1 = la de más abajo). El mapeo modo→nombre vive en
     reglas_divisores del manifiesto, amarrado a los mismos valores de preset. */
  function nombresDivisores(manifest, registro) {
    var R = manifest.reglas_divisores;
    if (!R) return null;
    // Con la sección apagada («Entrepaño: No», o puerta de cajones) no hay
    // divisiones que nombrar: no se manda ninguna instrucción.
    if (!attrActivo(manifest, registro.valores, R.attr_cantidad)) return null;
    var n = attrNumber(manifest, registro.valores, R.attr_cantidad);
    if (isNaN(n) || n < 1) return null;

    var mapa = R.nombres_por_modo || {};
    var nombres = [];
    for (var i = 1; i <= n; i++) {
      // Sin `attr_modo` (Esquinero) no hay modo que elegir: van todas al default.
      var f = R.attr_modo ? fieldByAttr(manifest, R.attr_modo.replace('{i}', i)) : null;
      // Campo ausente, oculto o deshabilitado: no hay modo elegido, va el default.
      var modo = (f && fieldVisible(f, manifest, registro.valores) &&
                       fieldEnabled(f, manifest, registro.valores))
        ? registro.valores[f.id] : null;
      nombres.push(Object.prototype.hasOwnProperty.call(mapa, modo) ? mapa[modo] : R.nombre_default);
    }
    return { prefijo: R.prefijo, nombres: nombres };
  }

  /* Manda UN registro a generar. Devuelve { ok } o { ok:false, titulo, error }
     sin depender del registro activo ni del input del nombre, para que el lote
     no cambie de resultado según qué módulo esté abierto.

     Los dos toggles sí se leen del DOM: «Insertar en escena» y «Limpiar piezas
     ocultas» son estado de SESIÓN, no del registro (nunca se guardaron en él),
     así que el lote aplica los mismos que el botón individual. */

  // =========================================================================
  //  Importación — mapeo, validación y tabla de revisión
  // -------------------------------------------------------------------------
  //  Ruby entrega la tabla en crudo (encabezados + celdas de texto), el modelo
  //  de columnas de la plantilla y los tres manifiestos. Todo lo semántico se
  //  resuelve aquí reusando los mismos predicados del formulario
  //  (fieldVisible / fieldEnabled / parseMm / presupuestoCajones): son la única
  //  implementación de esas reglas y no deben tener un tercer espejo.
  // =========================================================================

  function normTexto(t) {
    return String(t == null ? '' : t).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function campoPorId(manifest, id) {
    return findField(manifest, function (f) { return f.id === id; });
  }

  function familiaPorTexto(modelo, t) {
    var n = normTexto(t), hit = null;
    modelo.familias.forEach(function (f) {
      if (!hit && (normTexto(f.titulo) === n || normTexto(f.id) === n)) hit = f.id;
    });
    return hit;
  }

  /* Encabezado -> columnas candidatas. Un encabezado de la plantilla identifica
     una columna exacta; uno crudo (`divisor>f03espacio1`, como el CSV viejo)
     puede corresponder a varias, y ahí decide la familia de cada fila. */
  function resolverHeader(modelo, header) {
    var n = normTexto(header);
    var exacta = null, porAttr = [];
    modelo.columnas.forEach(function (c) {
      if (!exacta && normTexto(c.header) === n) exacta = c;
      if (c.attr && c.attr === String(header).trim()) porAttr.push(c);
    });
    if (exacta) return [exacta];
    return porAttr.length ? porAttr : null;
  }

  function columnaParaFamilia(cands, familia) {
    var hit = null;
    cands.forEach(function (c) {
      if (hit) return;
      if (c.clase !== 'campo' || (familia && c.familias.indexOf(familia) >= 0)) hit = c;
    });
    return hit;
  }

  /* Texto de celda -> valor interno del formulario. */
  function convertirCelda(campo, texto) {
    var t = String(texto).trim();
    if (campo.tipo === 'select') {
      var o = buscarOpcion(campo.opciones, t);
      return o ? { valor: o.valor } : { error: 'Opción no válida.' };
    }
    if (campo.tipo === 'preset') {
      var p = buscarOpcion(campo.presets, t);
      if (p) return { valor: p.valor };
      if (!campo.permite_personalizado) return { error: 'Opción no válida.' };
      var n = numeroEnUnidad(t, campo.unidad);
      if (n === null) return { error: 'Escribe una opción de la lista o una medida.' };
      // Igual que en el formulario: «0» en un retiro es el preset «Divisor».
      var tmp = {}; tmp[campo.id] = '__custom__'; tmp[campo.id + '::custom'] = n;
      if (normalizarPreset(campo, tmp)) return { valor: tmp[campo.id] };
      return { valor: '__custom__', custom: n };
    }
    if (campo.tipo === 'derivado') {
      if (!/^-?\d+$/.test(t)) return { error: 'Debe ser un número entero.' };
      var v   = parseInt(t, 10);
      var min = campo.min != null ? campo.min : 0;
      var max = campo.max != null ? campo.max : 99;
      if (v < min || v > max) return { error: 'Fuera de rango (' + min + '–' + max + ').' };
      return { valor: String(v) };
    }
    var m = numeroEnUnidad(t, campo.unidad);
    return m === null ? { error: 'No es una medida válida.' } : { valor: m };
  }

  function buscarOpcion(lista, t) {
    var n = normTexto(t), hit = null;
    (lista || []).forEach(function (o) {
      if (hit) return;
      if (normTexto(o.label) === n || String(o.valor) === String(t).trim()) hit = o;
    });
    return hit;
  }

  /* El formulario guarda el número SIN unidad (la pone el campo al aplanar), así
     que una celda con unidad explícita («25cm») se convierte a la del campo. */
  function numeroEnUnidad(texto, unidad) {
    var mm = parseMm(texto);
    if (isNaN(mm)) return null;
    var v = unidad === 'cm' ? mm / 10 : (unidad === 'm' ? mm / 1000 : mm);
    return String(Math.round(v * 1000) / 1000);
  }

  // ---- Validación de una fila ---------------------------------------------
  function validarFila(f, imp) {
    f.errores = {};
    f.avisos  = [];
    f.error   = null;
    f.valores = null;

    var texto = function (i) { return i >= 0 ? String(f.celdas[i] == null ? '' : f.celdas[i]).trim() : ''; };

    f.familia = imp.idxFamilia >= 0 ? familiaPorTexto(imp.modelo, texto(imp.idxFamilia)) : null;
    if (!f.familia) {
      if (imp.idxFamilia >= 0) f.errores[imp.idxFamilia] = 'Familia desconocida.';
      else f.error = 'El archivo no trae columna «familia».';
    }

    f.nombre = texto(imp.idxNombre);
    if (imp.idxNombre < 0) {
      f.error = f.error || 'El archivo no trae columna «nombre_salida».';
    } else if (!f.nombre) {
      f.errores[imp.idxNombre] = 'Falta el nombre.';
    } else if (/[\\\/:*?"<>|]/.test(f.nombre)) {
      f.errores[imp.idxNombre] = 'Caracteres no válidos para un nombre de archivo.';
    } else if (imp.repetidos[normTexto(f.nombre)] > 1) {
      f.errores[imp.idxNombre] = 'Nombre repetido en el archivo.';
    } else if (nombreEnSesion(f.nombre)) {
      f.errores[imp.idxNombre] = 'Ya hay un módulo con ese nombre en la sesión.';
    }

    var manifest = f.familia ? findManifest(f.familia) : null;
    if (!manifest) { f.estado = 'error'; return; }

    var valores = defaultValores(manifest);
    imp.cols.forEach(function (c) {
      // familia y nombre_salida ya se consumieron arriba; no son campos del
      // manifiesto y avisar de ellas sería ruido en cada fila.
      if (c.indice === imp.idxFamilia || c.indice === imp.idxNombre) return;
      var t = texto(c.indice);
      if (t === '') return;
      var col = columnaParaFamilia(c.cands, f.familia);
      if (!col || col.clase !== 'campo') {
        f.avisos.push('«' + c.header + '» no aplica a ' + manifest.titulo + ': se ignora.');
        return;
      }
      var campo = campoPorId(manifest, col.ids[f.familia]);
      if (!campo) { f.avisos.push('«' + c.header + '» no existe en ' + manifest.titulo + ': se ignora.'); return; }
      var r = convertirCelda(campo, t);
      if (r.error) { f.errores[c.indice] = r.error; return; }
      valores[campo.id] = r.valor;
      if (r.custom != null) valores[campo.id + '::custom'] = r.custom;
    });
    f.valores = valores;

    // Errores: la MISMA capa que el formulario (R-32), ya con todos los valores
    // puestos. Se anclan a la celda cuando la columna existe; si no, al renglón.
    erroresConfig(manifest, valores).forEach(function (e) {
      var i = -1;
      (e.ids || []).forEach(function (id) { if (i < 0) i = indiceDeCampo(imp, f.familia, id); });
      if (i >= 0) f.errores[i] = f.errores[i] || e.msg;
      else f.error = f.error || (e.label ? e.label + ': ' + e.msg : e.msg);
    });

    // Dato capturado sobre un campo que la propia configuración apaga: no es un
    // error, pero conviene decir que no va a llegar al .skp.
    manifest.grupos.forEach(function (g) {
      var gOn = groupEnabled(g, manifest, valores);
      g.campos.forEach(function (campo) {
        var i = indiceDeCampo(imp, f.familia, campo.id);
        if (i < 0 || texto(i) === '') return;
        if (!gOn || !fieldInyecta(campo, manifest, valores)) {
          f.avisos.push('«' + campo.label + '» no aplica con esta configuración: se ignora.');
        }
      });
    });

    avisosConfig(manifest, valores).forEach(function (a) { f.avisos.push(a); });

    var hayErr = f.error || Object.keys(f.errores).length > 0;
    f.estado = hayErr ? 'error' : (f.avisos.length ? 'aviso' : 'ok');
  }

  function indiceDeCampo(imp, familia, campoId) {
    var idx = -1;
    imp.cols.forEach(function (c) {
      if (idx >= 0) return;
      var col = columnaParaFamilia(c.cands, familia);
      if (col && col.clase === 'campo' && col.ids[familia] === campoId) idx = c.indice;
    });
    return idx;
  }

  function nombreEnSesion(nombre) {
    var n = normTexto(nombre);
    return state.registros.some(function (r) { return normTexto(r.nombre_salida) === n; });
  }

  function recontarNombres(imp) {
    imp.repetidos = {};
    imp.filas.forEach(function (f) {
      var n = normTexto(f.celdas[imp.idxNombre]);
      if (n) imp.repetidos[n] = (imp.repetidos[n] || 0) + 1;
    });
  }

  function revalidarTodo(imp) {
    recontarNombres(imp);
    imp.filas.forEach(function (f) { validarFila(f, imp); });
  }

  // ---- Construcción desde la respuesta de Ruby -----------------------------
  /* Tabla validada a partir de la respuesta de importar_archivo, sin tocar el
     DOM: la usa armarImportacion y también Royal Kitchens Studio (RCC_CORE). */
  function construirImportacion(res) {
    // Los manifiestos llegan con el archivo: así la tabla se puede validar de
    // inmediato aunque la sesión no haya abierto todavía esa familia.
    var mans = res.manifiestos || {};
    for (var fam in mans) {
      if (Object.prototype.hasOwnProperty.call(mans, fam)) state.manifests[fam] = mans[fam];
    }

    var imp = {
      modelo: res.modelo, ruta: res.ruta, cols: [], filas: [],
      desconocidos: [], idxFamilia: -1, idxNombre: -1, repetidos: {},
      truncado: !!res.truncado, maxFilas: res.max_filas
    };

    (res.headers || []).forEach(function (h, i) {
      if (String(h).trim() === '') return;
      var cands = resolverHeader(res.modelo, h);
      if (!cands) { imp.desconocidos.push(h); return; }
      if (cands[0].clase === 'familia') imp.idxFamilia = i;
      if (cands[0].clase === 'nombre')  imp.idxNombre  = i;
      imp.cols.push({ indice: i, header: String(h).trim(), cands: cands });
    });

    (res.filas || []).forEach(function (celdas) {
      imp.filas.push({ celdas: celdas.slice(), errores: {}, avisos: [], estado: 'ok' });
    });

    revalidarTodo(imp);
    return imp;
  }

  window.RCC_CORE = {
    defaultValores:       defaultValores,
    erroresConfig:        erroresConfig,
    avisosConfig:         avisosConfig,
    flatten:              flatten,
    presupuestoCajones:   presupuestoCajones,
    presupuestosCajones:  presupuestosCajones,
    altoZona:             altoZona,
    geomEntrepanos:       geomEntrepanos,
    geomFrentes:          geomFrentes,
    choquesRepisas:       choquesRepisas,
    altoLateralCajon:     altoLateralCajon,
    normalizarPreset:     normalizarPreset,
    presupuestoDivisores: presupuestoDivisores,
    fieldByAttr:          fieldByAttr,
    fieldVisible:         fieldVisible,
    fieldEnabled:         fieldEnabled,
    groupEnabled:         groupEnabled,
    fieldInyecta:         fieldInyecta,
    valorForzado:         valorForzado,
    mensajeForzado:       mensajeForzado,
    aplicarForzados:      aplicarForzados,
    effectiveValue:       effectiveValue,
    nombresDivisores:     nombresDivisores,
    autoNombre:           autoNombre,
    problemasRegistro:    problemasRegistro,
    nombreUnico:          nombreUnico,
    construirImportacion: construirImportacion,
    revalidarTodo:        revalidarTodo,
    state:                state
  };
})();
