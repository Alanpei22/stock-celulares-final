// ══════════════════════════════════════════════════════════════
//  tp-fases.js — Fases de reparación (el detalle del tablero)
// ══════════════════════════════════════════════════════════════
//  DOS NIVELES, a propósito:
//
//    fase   → el detalle fino (11 fases). Es lo que ves y manejás acá.
//    estado → los 4 de siempre (reparando / listo / entregado / no va).
//             Se calcula SOLO a partir de la fase.
//
//  Todo el resto de la app (caja, Telegram, impresión, seguimiento público
//  del QR, estadísticas, resumen diario) sigue leyendo `estado` y no necesita
//  enterarse de que las fases existen. Por eso no se rompe nada viejo.
//
//  Las reparaciones viejas NO se reescriben en masa: si un equipo no tiene
//  `fase`, se deduce de su `estado` en el momento de mostrarlo, y recién se
//  guarda cuando le movés algo. (Escribir mil documentos de una es la mejor
//  forma de quemar el cupo diario de Firebase en medio de un día de laburo.)
// ══════════════════════════════════════════════════════════════
'use strict';

// ══════════════════════════════════════════════════════════════
//  ⚙️  SLA — HORAS antes de marcar el equipo como DEMORADO
//  ─────────────────────────────────────────────────────────────
//  Este es el ÚNICO lugar donde se tocan los plazos.
//  El reloj cuenta desde que el equipo entró a esa fase (no desde el ingreso).
//  null = esa fase no vence nunca (no muestra alerta).
// ══════════════════════════════════════════════════════════════
const TP_SLA = {
  ingresado:     4,     // 4 h  → si entró y nadie lo miró, avisá
  diagnostico:   48,    // 2 días para diagnosticar
  presupuestado: 72,    // 3 días esperando respuesta del cliente
  aprobado:      4,     // aprobado y sin empezar: que no se duerma
  repuesto:      120,   // 5 días esperando que llegue el repuesto
  reparacion:    72,    // 3 días en el banco
  listo:         168,   // 7 días avisado y sin retirar
  entregado:     null,  // cerrado
  irreparable:   48,    // 2 días para devolverlo
  rechazado:     48,    // idem
  abandonado:    null,  // ya sabemos que está abandonado, no insistas
};

// ══════════════════════════════════════════════════════════════
//  MÁQUINA DE ESTADOS
//  sig = a dónde se puede ir DESDE acá (los botones de la ficha).
//  estado = a qué estado viejo mapea (lo que ve el resto de la app).
//  pipe = posición en la barra de avance (-1 = fuera del carril feliz).
//  wa = plantilla del aviso al cliente (se puede pisar desde WA_TEMPLATES
//       con la clave `fase_<clave>`).
// ══════════════════════════════════════════════════════════════
const TP_FASES = {
  ingresado: {
    n: '01', nombre: 'Ingresado', corto: 'Ingresado', tono: 'wait', pipe: 0, estado: 'reparando',
    sig: [
      { a: 'reparacion',  txt: '🔧 Arreglar directo' },
      { a: 'diagnostico', txt: '🔎 Diagnosticar' },
      { a: 'irreparable', txt: 'Sin reparación', warn: 1 },
    ],
    wa: 'Hola {nombre}! Recibimos tu {MODELO} en {NEGOCIO} ✅\nOrden N°{ORDEN}\nFalla declarada: {FALLA}\n\nEn cuanto lo revisemos te paso diagnóstico y presupuesto.',
  },
  diagnostico: {
    n: '02', nombre: 'En diagnóstico', corto: 'Diagnóstico', tono: 'work', pipe: 1, estado: 'reparando',
    sig: [
      { a: 'presupuestado', txt: '💬 Pasar presupuesto' },
      { a: 'reparacion',    txt: '🔧 Arreglar directo' },
      { a: 'irreparable',   txt: 'Sin reparación', warn: 1 },
    ],
    wa: 'Terminamos de revisar tu {MODELO} 🔎\nDiagnóstico: {DIAGNOSTICO}\n\nAhora te armo el presupuesto.',
  },
  presupuestado: {
    n: '03', nombre: 'Presupuestado', corto: 'Presupuesto', tono: 'wait', pipe: 2, estado: 'reparando',
    sig: [
      { a: 'aprobado',   txt: '👍 Cliente aprobó' },
      { a: 'rechazado',  txt: 'Rechazó', warn: 1 },
    ],
    wa: 'Presupuesto {MODELO} — Orden N°{ORDEN}\n\nTrabajo: {TRABAJO}\nPrecio: ${PRECIO}\nPlazo: {PLAZO}\nGarantía: {GARANTIA}\n\nAvisame si lo aprobás y arranco. Válido 7 días.',
  },
  aprobado: {
    n: '04', nombre: 'Aprobado', corto: 'Aprobado', tono: 'work', pipe: 3, estado: 'reparando',
    sig: [
      { a: 'reparacion', txt: '🔧 Hay repuesto · a banco' },
      { a: 'repuesto',   txt: '📦 Falta repuesto' },
    ],
    wa: 'Aprobado 👌 Ya lo tomo. Te aviso apenas esté listo.',
  },
  repuesto: {
    n: '05', nombre: 'Esperando repuesto', corto: 'Sin repuesto', tono: 'wait', pipe: 4, estado: 'reparando',
    sig: [
      { a: 'reparacion',  txt: '📦 Llegó el repuesto' },
      { a: 'irreparable', txt: 'No se consigue', warn: 1 },
    ],
    wa: 'Te actualizo tu {MODELO}: estamos esperando el repuesto. Apenas entra lo reparo y te aviso 🙌',
  },
  reparacion: {
    n: '06', nombre: 'En reparación', corto: 'Reparando', tono: 'work', pipe: 5, estado: 'reparando',
    sig: [
      { a: 'listo',       txt: '✅ Listo para retirar' },
      { a: 'repuesto',    txt: '📦 Falta repuesto' },
      { a: 'irreparable', txt: 'Sin reparación', warn: 1 },
    ],
    wa: null,
  },
  listo: {
    n: '07', nombre: 'Listo · avisado', corto: 'Listo', tono: 'ok', pipe: 6, estado: 'listo',
    sig: [
      { a: 'entregado',  txt: '📦 Cliente retiró' },
      { a: 'reparacion', txt: '↩️ Volver al banco' },
      { a: 'abandonado', txt: 'Abandonado', warn: 1 },
    ],
    wa: 'Hola {nombre}! Tu {MODELO} ya está listo ✅\n\nTrabajo: {TRABAJO}\nTotal: ${PRECIO}\nGarantía: {GARANTIA}\n\nTe esperamos en {DIRECCION}.',
  },
  entregado: {
    n: '08', nombre: 'Entregado', corto: 'Entregado', tono: 'ok', pipe: 7, estado: 'entregado',
    // Sin transiciones: un reingreso por garantía se hace con el botón 🔄 Garantía,
    // que crea una orden nueva enlazada a esta (no revive la vieja).
    sig: [],
    wa: 'Gracias por confiar en {NEGOCIO} 🙌\nTu {MODELO} tiene {GARANTIA} de garantía sobre el trabajo realizado.',
  },
  irreparable: {
    n: '—', nombre: 'Sin reparación posible', corto: 'No va', tono: 'bad', pipe: -1, estado: 'no va',
    sig: [{ a: '_devuelto', txt: '↩️ Devuelto al cliente' }],
    wa: 'Revisamos tu {MODELO} y lamentablemente no tiene reparación viable: {MOTIVO}.\nTe lo devolvemos armado tal como entró.',
  },
  rechazado: {
    n: '—', nombre: 'Presupuesto rechazado', corto: 'Rechazado', tono: 'bad', pipe: -1, estado: 'no va',
    sig: [{ a: '_devuelto', txt: '↩️ Devuelto al cliente' }],
    wa: 'Sin drama! Te dejamos el {MODELO} listo para retirar tal como vino.',
  },
  abandonado: {
    n: '—', nombre: 'Abandonado', corto: 'Abandonado', tono: 'bad', pipe: -1, estado: 'listo',
    sig: [{ a: 'entregado', txt: '📦 Al final retiró' }],
    wa: 'Te recordamos que tu {MODELO} sigue en el local. Pasá a retirarlo cuando puedas.',
  },
};

// Carril feliz que se dibuja en la barra de avance.
const TP_PIPE = ['ingresado', 'diagnostico', 'presupuestado', 'aprobado', 'repuesto', 'reparacion', 'listo', 'entregado'];

// Fases que ya no están en el taller (para el filtro "En taller").
const TP_CERRADAS = ['entregado', 'irreparable', 'rechazado'];

// Fases que cierran sin arreglar: se pide el motivo, que después entra en el
// aviso al cliente ({MOTIVO}) y queda registrado en la ficha.
const TP_PIDE_MOTIVO = {
  irreparable: '¿Por qué no tiene reparación?\n\nEsto se lo mandás al cliente en el aviso.',
  rechazado:   '¿Por qué rechazó el presupuesto?\n\n(queda registrado, no se le manda al cliente)',
};

// ── Estado viejo → fase por defecto (para datos anteriores a las fases) ──
const TP_ESTADO_FASE = {
  reparando:  'reparacion',
  listo:      'listo',
  entregado:  'entregado',
  'no va':    'irreparable',
  cancelado:  'irreparable',   // legacy
  'no van':   'irreparable',   // legacy
};

// ══════════════════════════════════════════════════════════════
//  LECTURA
// ══════════════════════════════════════════════════════════════

// Fase efectiva de una reparación.
// Si la fase guardada no coincide con el estado (porque el estado se cambió
// desde la caja, un chip rápido o el bot), manda el ESTADO y la fase se
// vuelve a deducir. Así nunca se muestra una fase mentirosa.
function tpFaseDe(r) {
  if (!r) return 'ingresado';
  const f = r.fase;
  if (f && TP_FASES[f] && TP_FASES[f].estado === r.estado) return f;
  return TP_ESTADO_FASE[r.estado] || 'reparacion';
}

function tpFaseInfo(r) {
  return TP_FASES[tpFaseDe(r)] || TP_FASES.reparacion;
}

// Historial de fases en formato [{f, t}] con t en ISO.
// Si no existe, se reconstruye desde estadoHistorial (que sí tenés desde siempre).
function tpHistorial(r) {
  if (!r) return [];
  if (Array.isArray(r.faseHist) && r.faseHist.length) {
    return [...r.faseHist].sort((a, b) => (a.t || '').localeCompare(b.t || ''));
  }
  const eh = Array.isArray(r.estadoHistorial) ? r.estadoHistorial : [];
  if (eh.length) {
    return eh
      .slice()
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
      .map(h => ({ f: TP_ESTADO_FASE[h.estado] || 'reparacion', t: h.fecha, _derivado: true }));
  }
  return [{ f: tpFaseDe(r), t: r.fechaIngreso || new Date().toISOString(), _derivado: true }];
}

// Desde cuándo está en la fase actual.
function tpDesde(r) {
  const h = tpHistorial(r);
  return (h.length ? h[h.length - 1].t : null) || r.fechaIngreso || new Date().toISOString();
}

function tpHoras(iso) {
  const t = new Date(iso).getTime();
  if (!t) return 0;
  return (Date.now() - t) / 3600000;
}

// ¿Se pasó del SLA de su fase?
function tpVencido(r) {
  const f = tpFaseDe(r);
  const sla = TP_SLA[f];
  if (sla == null) return false;
  return tpHoras(tpDesde(r)) > sla;
}

// "3 h" / "2 d" / "45 min"
function tpTxtTiempo(iso) {
  const h = tpHoras(iso);
  if (h < 1)  return Math.max(1, Math.round(h * 60)) + ' min';
  if (h < 48) return Math.round(h) + ' h';
  return Math.round(h / 24) + ' d';
}

function tpTxtDuracion(desdeISO, hastaISO) {
  const a = new Date(desdeISO).getTime();
  const b = hastaISO ? new Date(hastaISO).getTime() : Date.now();
  const h = (b - a) / 3600000;
  if (!isFinite(h) || h < 0) return '';
  if (h < 1)  return Math.max(1, Math.round(h * 60)) + ' min';
  if (h < 48) return Math.round(h) + ' h';
  return Math.round(h / 24) + ' d';
}

function tpFechaCorta(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}

// ══════════════════════════════════════════════════════════════
//  RENDER (bloques que usa repairs.js)
// ══════════════════════════════════════════════════════════════

// Chip de fase con LED de color.
function tpChipHtml(r) {
  const f = tpFaseDe(r);
  const info = TP_FASES[f];
  return `<span class="tp-chip tp-tono-${info.tono}"><i class="tp-led"></i>${info.corto}</span>`;
}

// Barra de avance. Los pasos completados y el actual se distinguen por FORMA
// además de por color (más alto + anillo), que es lo que se ve al sol.
function tpStepsHtml(r) {
  const f = tpFaseDe(r);
  const info = TP_FASES[f];
  const p = info.pipe;
  if (p < 0) {
    return `<div class="tp-steps tp-steps--corte"><i class="tp-step tp-step--corte"></i></div>`;
  }
  return '<div class="tp-steps">' + TP_PIPE.map((k, i) => {
    const cls = i < p ? 'on' : (i === p ? 'now' : '');
    return `<i class="tp-step ${cls}" title="${TP_FASES[k].corto}"></i>`;
  }).join('') + '</div>';
}

// Botones de avance: SOLO las transiciones válidas desde la fase actual.
function tpAccionesHtml(r) {
  const f = tpFaseDe(r);
  const info = TP_FASES[f];
  const btns = [];
  (info.sig || []).forEach(a => {
    if (a.a === '_devuelto') {
      if (r.devuelto === true) return;   // ya está devuelto, no ofrecer de nuevo
      btns.push(`<button class="tp-btn" onclick="tpMarcarDevuelto('${r.id}')">${a.txt}</button>`);
      return;
    }
    btns.push(`<button class="tp-btn ${a.warn ? 'warn' : 'pri'}" onclick="tpCambiarFase('${r.id}','${a.a}')">${a.txt}</button>`);
  });
  if (!btns.length) {
    // Orden cerrada: salida de emergencia por si se marcó entregado de más
    // (los equipos viejos no tienen historial de fases, así que "Deshacer" no aplica).
    btns.push('<span class="tp-nota">Orden cerrada.</span>');
    btns.push(`<button class="tp-btn" onclick="tpCambiarFase('${r.id}','reparacion')">↩️ Reabrir</button>`);
  }
  if (tpHistorial(r).length > 1 && Array.isArray(r.faseHist)) {
    btns.push(`<button class="tp-btn" onclick="tpDeshacer('${r.id}')">↩️ Deshacer</button>`);
  }
  return btns.join('');
}

// Historial con duración de cada etapa.
function tpHistorialHtml(r) {
  const h = tpHistorial(r);
  if (!h.length) return '';
  const derivado = h.some(x => x._derivado);
  const filas = h.map((x, i) => {
    const info = TP_FASES[x.f] || { nombre: x.f, tono: 'work' };
    const dur = tpTxtDuracion(x.t, h[i + 1] ? h[i + 1].t : null);
    return `<div class="tp-h">
      <span class="tp-h-fecha">${tpFechaCorta(x.t)}</span>
      <span class="tp-h-fase"><i class="tp-led tp-tono-${info.tono}"></i>${info.nombre}</span>
      <span class="tp-h-dur">${dur}</span>
    </div>`;
  }).join('');
  return `<div class="tp-hist">${filas}</div>` +
    (derivado ? '<p class="tp-nota">Historial reconstruido de los cambios de estado anteriores.</p>' : '');
}

// ══════════════════════════════════════════════════════════════
//  AVISO AL CLIENTE
// ══════════════════════════════════════════════════════════════

// Plantilla de la fase: primero la que tengas configurada (WA_TEMPLATES),
// sino la que viene por defecto acá arriba.
function tpWaTexto(r) {
  const f = tpFaseDe(r);
  const tpls = (typeof WA_TEMPLATES !== 'undefined' && WA_TEMPLATES) || {};
  const raw = tpls['fase_' + f] || TP_FASES[f].wa;
  if (!raw) return null;

  const biz = (typeof window !== 'undefined' && window._DAKI_NAME) || 'TechPoint';
  const dir = (typeof BIZ_DATA !== 'undefined' && BIZ_DATA && BIZ_DATA.dir) || 'el local';
  const gar = r.diasGarantia > 0 ? r.diasGarantia + ' días' : '—';
  const equipo = `${r.marca || ''} ${r.modelo || ''}`.trim() || 'tu equipo';

  return raw
    .replace(/{nombre}/g, r.nombre ? String(r.nombre).split(' ')[0] : '')
    .replace(/{MODELO}/g, equipo)
    .replace(/{equipo}/g, equipo)
    .replace(/{modelo}/g, r.modelo || '')
    .replace(/{marca}/g, r.marca || '')
    .replace(/{ORDEN}/g, r.nOrden || '—')
    .replace(/{nOrden}/g, r.nOrden || '—')
    .replace(/{FALLA}/g, r.condicion || r.arreglo || '—')
    .replace(/{PRECIO}/g, r.monto ? Number(r.monto).toLocaleString('es-AR') : '—')
    .replace(/{TRABAJO}/g, r.arreglo || '—')
    .replace(/{GARANTIA}/g, gar)
    .replace(/{PLAZO}/g, r.fechaEstimada || 'a confirmar')
    .replace(/{DIAGNOSTICO}/g, r.diagnostico || '—')
    .replace(/{MOTIVO}/g, r.motivo || r.diagnostico || '—')
    .replace(/{NEGOCIO}/g, biz)
    .replace(/{DIRECCION}/g, dir);
}

function tpWaEnviar(id) {
  const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === id);
  if (!r) return;
  if (!r.tlf) { toast('No hay teléfono registrado', 'error'); return; }
  const msg = tpWaTexto(r);
  if (!msg) return;
  const phone = (typeof _normWaPhone === 'function') ? _normWaPhone(r.tlf) : String(r.tlf).replace(/\D/g, '');
  if (typeof logActivity === 'function') {
    logActivity({
      tipo: 'whatsapp',
      desc: `WhatsApp (${TP_FASES[tpFaseDe(r)].nombre}) a ${r.nombre || r.tlf} — N°${r.nOrden}`,
      repairId: id, tecnico: r.tecnico || null,
      extra: { nOrden: r.nOrden, fase: tpFaseDe(r) },
    });
  }
  window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), '_blank');
}

function tpWaCopiar(id, btn) {
  const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === id);
  const msg = r && tpWaTexto(r);
  if (!msg) return;
  navigator.clipboard.writeText(msg).then(() => {
    if (btn) { const t = btn.textContent; btn.textContent = '✓ Copiado'; setTimeout(() => btn.textContent = t, 1500); }
  }).catch(() => toast('No se pudo copiar', 'error'));
}

// ══════════════════════════════════════════════════════════════
//  ESCRITURA
// ══════════════════════════════════════════════════════════════

// Backup del formato viejo ANTES de escribir fases por primera vez.
// Se hace una sola vez por dispositivo y no bloquea nada si falla.
const _TP_BACKUP_FLAG = 'tp_fases_backup_ok';
async function _tpBackupPrevio() {
  if (localStorage.getItem(_TP_BACKUP_FLAG)) return;
  try {
    const liviano = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).map(r => ({
      id: r.id, nOrden: r.nOrden, estado: r.estado,
      estadoHistorial: r.estadoHistorial || null,
      fechaIngreso: r.fechaIngreso || null,
      devuelto: r.devuelto === true,
    }));
    if (!liviano.length) return;
    const docId = 'repairs-pre-fases-' + new Date().toISOString().slice(0, 10);
    await db.collection('backups').doc(docId).set({
      motivo: 'Copia de estado/estadoHistorial antes de introducir fases',
      fecha: new Date().toISOString(),
      total: liviano.length,
      repairs: liviano,
    });
    localStorage.setItem(_TP_BACKUP_FLAG, '1');
  } catch (e) {
    console.error('Backup previo a fases:', e);
    // Si el backup falla igual seguimos: no borramos ni renombramos nada,
    // `estado` y `estadoHistorial` quedan intactos.
    localStorage.setItem(_TP_BACKUP_FLAG, 'fallo');
  }
}

// Acomoda la fase cuando el estado cambió por afuera del tablero (chip rápido
// de la lista, cobro desde la caja, etc). Devuelve el parche a escribir.
function _tpSyncFase(r, nuevoEstado, ahoraISO) {
  const destino = TP_ESTADO_FASE[nuevoEstado] || 'reparacion';
  if (tpFaseDe(r) === destino) return {};
  const hist = tpHistorial(r).map(x => ({ f: x.f, t: x.t }));
  hist.push({ f: destino, t: ahoraISO || new Date().toISOString() });
  return { fase: destino, faseHist: hist };
}

// Entrada única para mover una reparación de fase.
async function tpCambiarFase(id, nuevaFase) {
  const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === id);
  if (!r || !TP_FASES[nuevaFase]) return;
  const actual = tpFaseDe(r);
  if (actual === nuevaFase) return;

  // Fases que cierran sin arreglar: pedir el motivo ANTES de mover nada.
  // Si cancela el cartel no se mueve (sirve de red por si tocó el botón sin querer).
  let motivoNuevo = null;
  if (TP_PIDE_MOTIVO[nuevaFase]) {
    const resp = prompt(TP_PIDE_MOTIVO[nuevaFase], r.motivo || '');
    if (resp === null) return;
    motivoNuevo = resp.trim();
  }

  await _tpBackupPrevio();

  const ahora = new Date().toISOString();
  const hist = tpHistorial(r).map(x => ({ f: x.f, t: x.t }));   // saca la marca _derivado
  hist.push({ f: nuevaFase, t: ahora });
  const faseExtra = { fase: nuevaFase, faseHist: hist };
  if (motivoNuevo !== null) faseExtra.motivo = motivoNuevo;

  const estadoNuevo = TP_FASES[nuevaFase].estado;

  // Si además cambia el estado, va por el camino de siempre: ahí viven el
  // cobro en caja, el descuento de repuesto, la guardia de costo, el aviso
  // de Telegram y el seguimiento público del QR.
  if (estadoNuevo !== r.estado) {
    await changeRepairStatus(id, estadoNuevo, faseExtra);
    return;
  }

  // Mismo estado → solo se mueve el detalle.
  try {
    await db.collection('repairs').doc(id).update(faseExtra);
    Object.assign(r, faseExtra);
    // El cliente tiene que ver el cambio al escanear el QR. Esto va SIEMPRE,
    // no solo cuando cambia el estado: casi todo el recorrido del tablero
    // (ingresado → diagnóstico → presupuesto → aprobado → repuesto) pasa por
    // acá sin tocar el estado.
    if (typeof upsertSeguimientoPublico === 'function') upsertSeguimientoPublico(r);
    toast('→ ' + TP_FASES[nuevaFase].nombre, 'success');
    if (typeof logActivity === 'function') {
      logActivity({
        tipo: 'estado',
        desc: `${r.marca || ''} ${r.modelo || ''} N°${r.nOrden} → ${TP_FASES[nuevaFase].nombre}`,
        repairId: id, tecnico: r.tecnico || null,
        extra: { faseAnterior: actual, faseNueva: nuevaFase, nOrden: r.nOrden },
      });
    }
    if (typeof renderRepairs === 'function') renderRepairs();
    if (typeof openRepairDetail === 'function') openRepairDetail(id);
  } catch (e) {
    console.error('tpCambiarFase:', e);
    toast('Error al cambiar la fase', 'error');
  }
}

// Deshacer el último movimiento de fase.
async function tpDeshacer(id) {
  const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === id);
  if (!r || !Array.isArray(r.faseHist) || r.faseHist.length < 2) return;
  const hist = r.faseHist.slice(0, -1);
  const anterior = hist[hist.length - 1].f;
  const estadoAnterior = TP_FASES[anterior] ? TP_FASES[anterior].estado : r.estado;
  if (!confirm(`↩️ Volver a "${TP_FASES[anterior].nombre}"?`)) return;
  try {
    const upd = { fase: anterior, faseHist: hist, estado: estadoAnterior };
    // El historial de estados también retrocede si el estado cambia
    if (estadoAnterior !== r.estado && Array.isArray(r.estadoHistorial) && r.estadoHistorial.length > 1) {
      upd.estadoHistorial = r.estadoHistorial.slice(0, -1);
    }
    await db.collection('repairs').doc(id).update(upd);
    Object.assign(r, upd);
    if (typeof upsertSeguimientoPublico === 'function') upsertSeguimientoPublico(r);
    toast('↩️ ' + TP_FASES[anterior].nombre, 'success');
    if (typeof renderRepairs === 'function') renderRepairs();
    if (typeof openRepairDetail === 'function') openRepairDetail(id);
  } catch (e) {
    console.error('tpDeshacer:', e);
    toast('No se pudo deshacer', 'error');
  }
}

// Marca un equipo "no va" como ya devuelto al cliente (no cambia la fase).
async function tpMarcarDevuelto(id) {
  const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === id);
  if (!r) return;
  try {
    const upd = { devuelto: true, fechaEntrega: new Date().toISOString() };
    await db.collection('repairs').doc(id).update(upd);
    Object.assign(r, upd);
    if (typeof upsertSeguimientoPublico === 'function') upsertSeguimientoPublico(r);
    toast('↩️ Marcado como devuelto', 'success');
    if (typeof renderRepairs === 'function') renderRepairs();
    if (typeof openRepairDetail === 'function') openRepairDetail(id);
  } catch (e) {
    console.error('tpMarcarDevuelto:', e);
    toast('Error al marcar devuelto', 'error');
  }
}

// Guarda el diagnóstico escrito en la ficha (campo nuevo, no pisa observaciones).
async function tpGuardarCampo(id, campo, valor) {
  if (!['diagnostico', 'motivo', 'imei'].includes(campo)) return;
  const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === id);
  if (!r) return;
  const v = String(valor || '').trim();
  if ((r[campo] || '') === v) return;
  try {
    await db.collection('repairs').doc(id).update({ [campo]: v });
    r[campo] = v;
    // El IMEI se muestra enmascarado en la página del cliente
    if (campo === 'imei' && typeof upsertSeguimientoPublico === 'function') upsertSeguimientoPublico(r);
    toast('Guardado', 'success');
  } catch (e) {
    console.error('tpGuardarCampo:', e);
    toast('No se pudo guardar', 'error');
  }
}
