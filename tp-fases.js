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
    wa: 'Hola {nombre}! 👋 Te escribo de {NEGOCIO}.\n\nYa nos quedamos con tu *{MODELO}* — orden N°{ORDEN}.\nLo que nos contaste: {FALLA}\n\nApenas lo revisemos te paso el diagnóstico y el precio. No hacemos ningún trabajo sin tu OK 👌',
  },
  diagnostico: {
    n: '02', nombre: 'En diagnóstico', corto: 'Diagnóstico', tono: 'work', pipe: 1, estado: 'reparando',
    sig: [
      { a: 'presupuestado', txt: '💬 Pasar presupuesto' },
      { a: 'reparacion',    txt: '🔧 Arreglar directo' },
      { a: 'irreparable',   txt: 'Sin reparación', warn: 1 },
    ],
    wa: 'Hola {nombre}! Ya revisamos tu *{MODELO}* 🔎\n\nQué encontramos: {DIAGNOSTICO}\n\nAhora te armo el presupuesto y te lo paso por acá.',
  },
  presupuestado: {
    n: '03', nombre: 'Presupuestado', corto: 'Presupuesto', tono: 'wait', pipe: 2, estado: 'reparando',
    sig: [
      { a: 'aprobado',   txt: '👍 Cliente aprobó' },
      { a: 'rechazado',  txt: 'Rechazó', warn: 1 },
    ],
    wa: 'Hola {nombre}! Te paso el presupuesto de tu *{MODELO}* — orden N°{ORDEN}\n\n{DETALLE}\n\n💰 Total: *${PRECIO}*\n📅 Listo aprox.: {PLAZO}\n🛡️ Garantía: {GARANTIA}\n\nAvisame si lo aprobás y arranco. El precio vale por 7 días.',
  },
  aprobado: {
    n: '04', nombre: 'Aprobado', corto: 'Aprobado', tono: 'work', pipe: 3, estado: 'reparando',
    sig: [
      { a: 'reparacion', txt: '🔧 Hay repuesto · a banco' },
      { a: 'repuesto',   txt: '📦 Falta repuesto' },
    ],
    wa: 'Perfecto {nombre}, aprobado 👌\nYa lo tomo. Te aviso por acá apenas esté listo.',
  },
  repuesto: {
    n: '05', nombre: 'Esperando repuesto', corto: 'Sin repuesto', tono: 'wait', pipe: 4, estado: 'reparando',
    sig: [
      { a: 'reparacion',  txt: '📦 Llegó el repuesto' },
      { a: 'irreparable', txt: 'No se consigue', warn: 1 },
    ],
    wa: 'Hola {nombre}! Te actualizo tu *{MODELO}* 📦\n\nEstamos esperando que llegue el repuesto. Apenas entra lo reparo y te aviso.\nCualquier duda escribime, no hay drama 🙌',
  },
  reparacion: {
    n: '06', nombre: 'En reparación', corto: 'Reparando', tono: 'work', pipe: 5, estado: 'reparando',
    sig: [
      { a: 'listo',       txt: '✅ Listo para retirar' },
      { a: 'repuesto',    txt: '📦 Falta repuesto' },
      { a: 'irreparable', txt: 'Sin reparación', warn: 1 },
    ],
    wa: 'Hola {nombre}! Tu *{MODELO}* ya está en el banco de trabajo 🔧\nTe aviso apenas esté listo para retirar.',
  },
  listo: {
    n: '07', nombre: 'Listo · avisado', corto: 'Listo', tono: 'ok', pipe: 6, estado: 'listo',
    sig: [
      { a: 'entregado',  txt: '📦 Cliente retiró' },
      { a: 'reparacion', txt: '↩️ Volver al banco' },
      { a: 'abandonado', txt: 'Abandonado', warn: 1 },
    ],
    wa: 'Hola {nombre}! Tu *{MODELO}* ya está listo ✅\n\n🔧 Trabajo: {TRABAJO}\n💰 A pagar al retirar: *${SALDO}*\n🛡️ Garantía: {GARANTIA}\n\n📍 Te esperamos en {DIRECCION}\n🕐 {HORARIO}\n\nAcordate de traer el comprobante 🙏',
  },
  entregado: {
    n: '08', nombre: 'Entregado', corto: 'Entregado', tono: 'ok', pipe: 7, estado: 'entregado',
    // Sin transiciones: un reingreso por garantía se hace con el botón 🔄 Garantía,
    // que crea una orden nueva enlazada a esta (no revive la vieja).
    sig: [],
    wa: '¡Gracias por confiar en {NEGOCIO}! 🙌\n\nTu *{MODELO}* tiene {GARANTIA} de garantía sobre el trabajo realizado. Guardá el comprobante: es lo que la hace válida.\n\nCualquier cosa escribinos por acá 📲',
  },
  irreparable: {
    n: '—', nombre: 'Sin reparación posible', corto: 'No va', tono: 'bad', pipe: -1, estado: 'no va',
    sig: [{ a: '_devuelto', txt: '↩️ Devuelto al cliente' }],
    wa: 'Hola {nombre}. Revisamos tu *{MODELO}* y lamentablemente no tiene arreglo viable:\n{MOTIVO}\n\nTe lo devolvemos armado tal como entró. Pasá cuando puedas por {DIRECCION} — {HORARIO}.',
  },
  rechazado: {
    n: '—', nombre: 'Presupuesto rechazado', corto: 'Rechazado', tono: 'bad', pipe: -1, estado: 'no va',
    sig: [{ a: '_devuelto', txt: '↩️ Devuelto al cliente' }],
    wa: '¡Sin drama {nombre}! Te dejamos el *{MODELO}* tal como vino, listo para retirar en {DIRECCION} — {HORARIO}.\n\nSi más adelante lo querés hacer, escribime y lo vemos 👍',
  },
  abandonado: {
    // El equipo está reparado y en el local: la barra llega hasta "Listo"
    // (no es una orden cortada). El chip queda rojo como aviso.
    n: '—', nombre: 'Abandonado', corto: 'Abandonado', tono: 'bad', pipe: 6, estado: 'listo',
    sig: [{ a: 'entregado', txt: '📦 Al final retiró' }],
    wa: 'Hola {nombre}! Te recordamos que tu *{MODELO}* (orden N°{ORDEN}) sigue acá en el local, reparado y listo.\n\nPasá a retirarlo cuando puedas por {DIRECCION} — {HORARIO} 🙏',
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
  // Entregado = trabajo terminado: la barra va TODA en verde, sin paso "actual".
  // Antes el último tramo quedaba en ámbar y parecía que todavía faltaba algo.
  const terminado = f === 'entregado';
  return '<div class="tp-steps">' + TP_PIPE.map((k, i) => {
    const cls = terminado ? 'on' : (i < p ? 'on' : (i === p ? 'now' : ''));
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

// Variables que se pueden usar en las plantillas. El editor de la ficha
// (tpWaEditar) dibuja un chip por cada una: esta lista es la que manda.
const TP_WA_VARS = [
  { k: 'nombre',      d: 'Nombre de pila del cliente' },
  { k: 'MODELO',      d: 'Marca y modelo del equipo' },
  { k: 'ORDEN',       d: 'Número de orden' },
  { k: 'FALLA',       d: 'Lo que contó el cliente al dejarlo' },
  { k: 'DIAGNOSTICO', d: 'Lo que encontró el técnico' },
  { k: 'TRABAJO',     d: 'Arreglo, en una línea' },
  { k: 'DETALLE',     d: 'Los arreglos con el precio de cada uno' },
  { k: 'PRECIO',      d: 'Total del trabajo' },
  { k: 'SENA',        d: 'Seña que ya pagó' },
  { k: 'SALDO',       d: 'Lo que falta pagar al retirar' },
  { k: 'GARANTIA',    d: 'Días de garantía' },
  { k: 'PLAZO',       d: 'Fecha estimada de entrega' },
  { k: 'MOTIVO',      d: 'Por qué no se reparó / lo rechazó' },
  { k: 'NEGOCIO',     d: 'Nombre del local' },
  { k: 'DIRECCION',   d: 'Dirección (Configuración → Datos del negocio)' },
  { k: 'HORARIO',     d: 'Horario (Configuración → Datos del negocio)' },
  { k: 'TELEFONO',    d: 'WhatsApp del local' },
];

const _tpMoney = n => Number(n || 0).toLocaleString('es-AR');

// Los arreglos con su precio, uno por línea. Con uno solo sale en una línea
// sin viñeta; con varios, la lista. Las órdenes viejas no tienen `arreglos`:
// caen en el texto de `arreglo` de siempre.
function tpWaDetalle(r) {
  const lista = Array.isArray(r.arreglos) ? r.arreglos.filter(a => a && a.texto) : [];
  if (lista.length < 2) return '🔧 ' + (r.arreglo || lista[0]?.texto || '—');
  return lista
    .map(a => `• ${a.texto}${Number(a.precio) > 0 ? ' — $' + _tpMoney(a.precio) : ''}`)
    .join('\n');
}

// Plantilla de la fase: primero la que tengas configurada (WA_TEMPLATES),
// sino la que viene por defecto acá arriba.
function tpWaTexto(r, override) {
  const f = tpFaseDe(r);
  const tpls = (typeof WA_TEMPLATES !== 'undefined' && WA_TEMPLATES) || {};
  // `override` es lo que estás tipeando en el editor: sirve para la vista
  // previa en vivo, antes de guardar nada.
  const raw = (override != null) ? override : (tpls['fase_' + f] || TP_FASES[f].wa);
  if (!raw) return null;

  const biz  = (typeof window !== 'undefined' && window._DAKI_NAME) || 'TechPoint';
  const bd   = (typeof BIZ_DATA !== 'undefined' && BIZ_DATA) || {};
  const dir  = bd.dir || 'el local';
  const hor  = bd.extra || 'consultá horarios por acá';
  const tel  = bd.tel || '';
  const gar  = r.diasGarantia > 0 ? r.diasGarantia + ' días' : '30 días';
  const equipo = `${r.marca || ''} ${r.modelo || ''}`.trim() || 'tu equipo';
  // El saldo es lo que de verdad va a pagar al retirar. Antes el aviso de
  // "listo" decía el total, así que si había seña el cliente venía con la
  // plata de más.
  const saldo = Math.max(0, (Number(r.monto) || 0) - (Number(r.sena) || 0));

  return raw
    .replace(/{nombre}/g, r.nombre ? String(r.nombre).split(' ')[0] : '')
    .replace(/{MODELO}/g, equipo)
    .replace(/{equipo}/g, equipo)
    .replace(/{modelo}/g, r.modelo || '')
    .replace(/{marca}/g, r.marca || '')
    .replace(/{ORDEN}/g, r.nOrden || '—')
    .replace(/{nOrden}/g, r.nOrden || '—')
    // La falla declarada es campo propio desde agosto 2026. Antes de eso se
    // escribía en `condicion`, por eso el respaldo.
    .replace(/{FALLA}/g, r.falla || r.condicion || r.arreglo || '—')
    .replace(/{DETALLE}/g, tpWaDetalle(r))
    .replace(/{PRECIO}/g, r.monto ? _tpMoney(r.monto) : '—')
    .replace(/{SENA}/g, _tpMoney(r.sena))
    .replace(/{SALDO}/g, _tpMoney(saldo))
    .replace(/{TRABAJO}/g, r.arreglo || '—')
    .replace(/{GARANTIA}/g, gar)
    .replace(/{PLAZO}/g, r.fechaEstimada || 'a confirmar')
    .replace(/{DIAGNOSTICO}/g, r.diagnostico || '—')
    .replace(/{MOTIVO}/g, r.motivo || r.diagnostico || '—')
    .replace(/{NEGOCIO}/g, biz)
    .replace(/{DIRECCION}/g, dir)
    .replace(/{HORARIO}/g, hor)
    .replace(/{TELEFONO}/g, tel);
}

// Teléfono argentino a formato wa.me. Está acá y no en repairs.js porque
// caja.html no carga repairs.js: sin esto, avisar por WhatsApp desde la caja
// abría un número sin el 549 adelante.
function tpWaFono(tlf) {
  let p = String(tlf || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.length === 10)                            p = '549' + p;
  else if (p.length === 11 && p.startsWith('0'))  p = '549' + p.slice(1);
  else if (!p.startsWith('54'))                   p = '549' + p;
  return p;
}

// Abre WhatsApp con el mensaje de la fase. Toma el OBJETO de la reparación,
// así también sirve desde la caja (donde no existe REPAIRS).
function tpWaAbrir(r) {
  if (!r) return false;
  if (!r.tlf) { toast('No hay teléfono registrado', 'error'); return false; }
  const msg = tpWaTexto(r);
  if (!msg) return false;
  if (typeof logActivity === 'function') {
    logActivity({
      tipo: 'whatsapp',
      desc: `WhatsApp (${TP_FASES[tpFaseDe(r)].nombre}) a ${r.nombre || r.tlf} — N°${r.nOrden}`,
      repairId: r.id, tecnico: r.tecnico || null,
      extra: { nOrden: r.nOrden, fase: tpFaseDe(r) },
    });
  }
  window.open('https://wa.me/' + tpWaFono(r.tlf) + '?text=' + encodeURIComponent(msg), '_blank');
  return true;
}

function tpWaEnviar(id) {
  const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === id);
  if (r) tpWaAbrir(r);
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
//  ¿SE LLEVA EL EQUIPO? — un solo cartel para los tres lugares
//  ─────────────────────────────────────────────────────────────
//  Antes esto era un confirm() del navegador en tres lugares distintos
//  (cobrar desde la caja, pasar a Listo desde la ficha y desde la lista).
//  Tres problemas que este modal arregla:
//
//  1. "Cancelar" se leía como "cancelar el cobro", pero el cobro se hacía
//     igual: lo único que cambiaba era que no marcaba entregado. Ahora las
//     tres salidas están escritas: se lo lleva / queda en el local / volver.
//  2. No decía DE QUÉ equipo hablaba. Con dos órdenes del mismo cliente en
//     el mostrador era una lotería.
//  3. Marcaba `estado` pero no la `fase`, así que la entrega no quedaba en
//     el historial del tablero.
//
//  Vive acá porque tp-fases.js es de los pocos archivos que cargan las DOS
//  páginas (caja.html no carga repairs.js).
// ══════════════════════════════════════════════════════════════
let _tpEntCb = null;

// Devuelve Promise<{ entregado, avisar } | null>.  null = volver atrás, no
// hacer nada (ni cobrar, ni cambiar el estado).
//
// opts.contexto: 'cobro'  → se está cobrando desde la caja
//                'estado' → se está pasando a Listo desde reparaciones
// opts.cobra:    cuánto se cobra en este momento (solo en 'cobro')
function tpEntregaModal(r, opts = {}) {
  const modal = document.getElementById('tpent-modal');
  // Si la página no tiene el modal, no se traba nada: sigue como antes.
  if (!modal || !r) return Promise.resolve({ entregado: false, avisar: false });

  return new Promise(resolve => {
    _tpEntCb = resolve;
    const cobra  = Number(opts.cobra) || 0;
    const total  = Number(r.monto) || 0;
    const sena   = Number(r.sena) || 0;
    const saldo  = Math.max(0, total - sena - (opts.contexto === 'cobro' ? cobra : 0));
    const equipo = `${r.marca || ''} ${r.modelo || ''}`.trim() || 'el equipo';

    document.getElementById('tpent-info').innerHTML =
      `<b>N°${r.nOrden || '?'}</b> — ${esc(equipo)}` +
      (r.nombre ? `<span class="tpent-cli">👤 ${esc(r.nombre)}</span>` : '');

    // Renglón de plata: qué se está cobrando y qué queda debiendo.
    const plata = [];
    if (opts.contexto === 'cobro' && cobra > 0) plata.push(`Cobrás <b>$${cobra.toLocaleString('es-AR')}</b>`);
    if (saldo > 0) plata.push(`<span class="tpent-debe">Queda debiendo $${saldo.toLocaleString('es-AR')}</span>`);
    else if (total > 0) plata.push('Sin saldo pendiente ✅');
    document.getElementById('tpent-plata').innerHTML = plata.join(' · ');

    // El aviso de WhatsApp usa el mensaje de la fase "entregado" (gracias +
    // garantía), el mismo que se edita desde la ficha.
    const waWrap = document.getElementById('tpent-wa-wrap');
    const waChk  = document.getElementById('tpent-wa');
    const hayWa  = !!r.tlf;
    waWrap.classList.toggle('hidden', !hayWa);
    if (hayWa) waChk.checked = false;

    document.getElementById('tpent-overlay').classList.remove('hidden');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  });
}

function _tpEntCerrar(res) {
  document.getElementById('tpent-overlay')?.classList.add('hidden');
  document.getElementById('tpent-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
  if (_tpEntCb) { const cb = _tpEntCb; _tpEntCb = null; cb(res); }
}

function tpEntregaSi()       { _tpEntCerrar({ entregado: true,  avisar: !!document.getElementById('tpent-wa')?.checked }); }
function tpEntregaNo()       { _tpEntCerrar({ entregado: false, avisar: false }); }
function tpEntregaCancelar() { _tpEntCerrar(null); }

// El parche que hay que escribir en la reparación para dejarla entregada.
// Incluye la FASE, que es lo que el confirm viejo no hacía: sin esto la
// entrega no aparecía en el historial del tablero.
function tpEntregaPatch(r) {
  const ahora = new Date().toISOString();
  const prev  = Array.isArray(r.estadoHistorial) ? r.estadoHistorial : [];
  return {
    estado: 'entregado',
    fechaEntrega: ahora,
    estadoHistorial: [...prev, { estado: 'entregado', fecha: ahora }],
    ..._tpSyncFase(r, 'entregado', ahora),
  };
}

// ══════════════════════════════════════════════════════════════
//  EDITOR DE LA PLANTILLA — desde la ficha de la reparación
//  ─────────────────────────────────────────────────────────────
//  Se edita el mensaje de LA FASE que estás mirando, con la
//  reparación de adelante como vista previa. Lo que guardás vale
//  para todas las reparaciones que estén en esa fase.
//  Vive solo en index.html: caja.html carga tp-fases.js pero no
//  tiene el modal ni WA_TEMPLATES, por eso los guardas.
// ══════════════════════════════════════════════════════════════
let _tpWaEdit = null;   // { id, fase } de lo que se está editando

function tpWaPlantillaDe(fase) {
  const tpls = (typeof WA_TEMPLATES !== 'undefined' && WA_TEMPLATES) || {};
  return tpls['fase_' + fase] || (TP_FASES[fase] && TP_FASES[fase].wa) || '';
}

function tpWaEditar(id) {
  const modal = document.getElementById('wa-fase-modal');
  if (!modal) return;
  const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === id);
  if (!r) return;
  const f = tpFaseDe(r);
  _tpWaEdit = { id, fase: f };

  document.getElementById('wf-titulo').textContent = '💬 Mensaje de «' + TP_FASES[f].nombre + '»';
  document.getElementById('wf-sub').textContent =
    'Este texto se usa para toda reparación que esté en esta fase. Tocá una variable para insertarla.';
  document.getElementById('wf-txt').value = tpWaPlantillaDe(f);
  document.getElementById('wf-vars').innerHTML = TP_WA_VARS
    .map(v => `<button type="button" class="wf-var" title="${v.d}" onclick="tpWaVar('${v.k}')">{${v.k}}</button>`)
    .join('');
  tpWaPrevia();
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeWaFaseModal() {
  const m = document.getElementById('wa-fase-modal');
  if (m) m.classList.add('hidden');
  document.body.style.overflow = '';
  _tpWaEdit = null;
}

// Inserta {VARIABLE} donde está el cursor (no al final: si estás en el medio
// de una frase es ahí donde la querés).
function tpWaVar(k) {
  const ta = document.getElementById('wf-txt');
  if (!ta) return;
  const t = '{' + k + '}';
  const a = ta.selectionStart, b = ta.selectionEnd;
  ta.value = ta.value.slice(0, a) + t + ta.value.slice(b);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = a + t.length;
  tpWaPrevia();
}

// Vista previa con los datos REALES de la reparación abierta, y el *negrita*
// de WhatsApp dibujado como lo va a ver el cliente.
function tpWaPrevia() {
  const box = document.getElementById('wf-prev');
  if (!box || !_tpWaEdit) return;
  const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === _tpWaEdit.id);
  const txt = document.getElementById('wf-txt').value;
  const msg = r ? tpWaTexto(r, txt) : txt;
  const _e = (typeof esc === 'function') ? esc : (s => String(s == null ? '' : s));
  box.innerHTML = _e(msg || '')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/\n/g, '<br>');
}

function tpWaResetPlantilla() {
  if (!_tpWaEdit) return;
  document.getElementById('wf-txt').value = (TP_FASES[_tpWaEdit.fase] || {}).wa || '';
  tpWaPrevia();
  toast('Texto original cargado — dale Guardar para dejarlo así', 'success');
}

async function tpWaGuardarPlantilla() {
  if (!_tpWaEdit) return;
  if (typeof WA_TEMPLATES === 'undefined') { toast('No se puede guardar desde acá', 'error'); return; }
  const txt = document.getElementById('wf-txt').value.trim();
  if (!txt) { toast('El mensaje no puede quedar vacío', 'error'); return; }
  const key = 'fase_' + _tpWaEdit.fase;
  const id  = _tpWaEdit.id;

  WA_TEMPLATES[key] = txt;
  try { localStorage.setItem('cel_wa_templates', JSON.stringify(WA_TEMPLATES)); } catch {}
  // Una sola escritura, y con merge: el resto de las plantillas no se toca.
  try {
    await db.collection('config').doc('waTemplates').set({ [key]: txt }, { merge: true });
    toast('Mensaje guardado ✅', 'success');
  } catch (e) {
    console.error('guardar plantilla WA:', e);
    toast('Guardado en este dispositivo, pero no se pudo sincronizar', 'error');
  }
  closeWaFaseModal();
  // Repintar la ficha para que el "Aviso al cliente" muestre el texto nuevo
  if (typeof openRepairDetail === 'function') openRepairDetail(id);
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
  //
  // changeRepairStatus vive en repairs.js, que carga index.html y NO caja.html
  // (allá este archivo se carga solo por tpFaseDe/tpHistorial, que usa
  // seguimiento.js). El tablero no se dibuja en la caja, así que esto no
  // debería pasar nunca: si pasa, que se vea, en vez de tirar un error suelto
  // que nadie mira.
  if (estadoNuevo !== r.estado) {
    if (typeof changeRepairStatus !== 'function') {
      console.error('tpCambiarFase: changeRepairStatus no está cargado en esta página');
      if (typeof toast === 'function') toast('Esta acción solo funciona desde Reparaciones', 'error');
      return;
    }
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
    // Aviso a los demás dispositivos (el cambio de estado avisa por su camino)
    if (typeof pushCambioEquipo === 'function') pushCambioEquipo(r, nuevaFase, r.estado);
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
