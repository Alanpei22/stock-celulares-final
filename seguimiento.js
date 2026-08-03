// ══════════════════════════════════════════════════════════════
//  seguimiento.js — Seguimiento público (el QR del comprobante)
// ══════════════════════════════════════════════════════════════
//  Mantiene un documento aparte, SIN datos sensibles, para que el cliente
//  vea el estado de su equipo escaneando el QR del ticket.
//
//  Qué ve el cliente: modelo, en qué paso está, fecha de ingreso, fecha
//  estimada y los últimos 4 dígitos del IMEI.
//  Qué NO ve: precio, teléfono, nombre completo, DNI, código de desbloqueo,
//  diagnóstico técnico ni notas internas. Tampoco el tipo de arreglo, que
//  antes se publicaba.
//
//  Dirección del documento: seguimiento_publico/{token}
//  El token es aleatorio de 20 caracteres y NO se puede deducir del número de
//  orden. Las reglas de Firestore permiten leer un documento por su id, pero
//  NO listar la colección: sin el token no se llega a nada.
//
//  Compatibilidad: los tickets impresos antes de esto llevan un QR con
//  ?id={idInterno}. Para esas órdenes se sigue publicando también el documento
//  viejo, así los papeles que ya están en la calle no dejan de funcionar.
// ══════════════════════════════════════════════════════════════
'use strict';

// Órdenes ingresadas antes de esta fecha pueden tener un QR viejo impreso.
const SEG_CORTE_QR_VIEJO = '2026-08-04';

// ── Token ──────────────────────────────────────────────────
function _segNuevoToken() {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';   // sin l/o/0/1 (se confunden)
  let out = '';
  try {
    const buf = new Uint8Array(20);
    crypto.getRandomValues(buf);
    for (const b of buf) out += abc[b % abc.length];
  } catch {
    for (let i = 0; i < 20; i++) out += abc[Math.floor(Math.random() * abc.length)];
  }
  return out;
}

// ── Texto en idioma del cliente, no de taller ──────────────
// La clave es la fase interna; el texto es lo que lee la persona.
const SEG_MENSAJES = {
  ingresado:     { titulo: 'Recibimos tu equipo',        detalle: 'Está anotado y en la fila para revisar.' },
  diagnostico:   { titulo: 'Lo estamos revisando',       detalle: 'Estamos viendo qué tiene. Te avisamos apenas sepamos.' },
  presupuestado: { titulo: 'Te pasamos el presupuesto',  detalle: 'Esperamos que nos confirmes para arrancar.' },
  aprobado:      { titulo: 'Presupuesto aprobado',       detalle: 'Ya lo tomamos, arrancamos con la reparación.' },
  repuesto:      { titulo: 'Esperando el repuesto',      detalle: 'Estamos esperando que llegue el repuesto. Te avisamos apenas entre.' },
  reparacion:    { titulo: 'En reparación',              detalle: 'Está en el banco de trabajo.' },
  listo:         { titulo: '¡Listo para retirar!',       detalle: 'Ya podés pasar a buscarlo por el local.' },
  entregado:     { titulo: 'Entregado',                  detalle: 'Gracias por confiar en nosotros.' },
  irreparable:   { titulo: 'Sin reparación posible',     detalle: 'Te lo devolvemos tal como entró. Pasá cuando puedas.' },
  rechazado:     { titulo: 'Presupuesto no aceptado',    detalle: 'Te lo devolvemos tal como entró. Pasá cuando puedas.' },
  abandonado:    { titulo: 'Te esperamos',               detalle: 'Tu equipo sigue en el local, listo para que lo retires.' },
};

// Pasos que se le muestran al cliente (los internos se agrupan).
const SEG_PASOS = [
  { k: 'recibido',  label: 'Recibido',       fases: ['ingresado'] },
  { k: 'revision',  label: 'En revisión',    fases: ['diagnostico', 'presupuestado', 'aprobado'] },
  { k: 'reparando', label: 'En reparación',  fases: ['repuesto', 'reparacion'] },
  { k: 'listo',     label: 'Listo',          fases: ['listo', 'abandonado'] },
  { k: 'entregado', label: 'Entregado',      fases: ['entregado'] },
];

function _segPasoDe(fase) {
  const i = SEG_PASOS.findIndex(p => p.fases.includes(fase));
  return i < 0 ? 0 : i;
}

// ── Publicación ────────────────────────────────────────────
function _segDocPublico(r, fase) {
  const biz = (typeof window !== 'undefined' && window._DAKI_NAME) || 'TechPoint';
  const bd = (typeof BIZ_DATA !== 'undefined' && BIZ_DATA) || {};
  const msg = SEG_MENSAJES[fase] || SEG_MENSAJES.reparacion;
  const imei = String(r.imei || '').replace(/\D/g, '');

  // Historial: solo fase + fecha, y solo de las que el cliente puede entender
  let hist = [];
  if (typeof tpHistorial === 'function') {
    hist = tpHistorial(r).map(h => ({ paso: _segPasoDe(h.f), fecha: h.t }));
  } else if (Array.isArray(r.estadoHistorial)) {
    hist = r.estadoHistorial.map(h => ({ paso: h.estado === 'entregado' ? 4 : (h.estado === 'listo' ? 3 : 2), fecha: h.fecha }));
  }
  // Una entrada por paso (la primera vez que llegó a ese paso)
  const vistos = new Set();
  hist = hist.filter(h => (vistos.has(h.paso) ? false : (vistos.add(h.paso), true)));

  return {
    nOrden: r.nOrden || null,
    negocio: biz,
    equipo: `${r.marca || ''} ${r.modelo || ''}`.trim(),
    imei4: imei ? imei.slice(-4) : '',
    paso: _segPasoDe(fase),
    cerradaSinArreglo: fase === 'irreparable' || fase === 'rechazado',
    titulo: msg.titulo,
    detalle: msg.detalle,
    fechaIngreso: r.fechaIngreso || null,
    fechaEstimada: r.fechaEstimada || null,
    fechaEntrega: r.fechaEntrega || null,
    historial: hist,
    // Datos del local, para que la página no tenga nada escrito a fuego
    bizDir: bd.dir || '',
    bizTel: bd.tel || '',
    bizExtra: bd.extra || '',
    updatedAt: new Date().toISOString(),
  };
}

// Crea/actualiza el documento público de una reparación.
async function upsertSeguimientoPublico(r) {
  if (!r || !r.id) return;
  if (typeof db === 'undefined' || !db) return;
  try {
    const fase = (typeof tpFaseDe === 'function') ? tpFaseDe(r) : (r.estado || 'reparacion');
    const data = _segDocPublico(r, fase);

    // Token: si la orden no tiene, se le genera y se guarda en la reparación
    let token = r.tokenSeguimiento;
    if (!token) {
      token = _segNuevoToken();
      r.tokenSeguimiento = token;
      await db.collection('repairs').doc(r.id).update({ tokenSeguimiento: token }).catch(() => {});
    }
    await db.collection('seguimiento_publico').doc(token).set(data, { merge: true });

    // Órdenes viejas: mantener vivo el QR ya impreso (?id=...)
    const ingreso = String(r.fechaIngreso || '');
    if (ingreso && ingreso < SEG_CORTE_QR_VIEJO) {
      await db.collection('seguimiento_publico').doc(r.id).set(data, { merge: true }).catch(() => {});
    }
  } catch (e) {
    console.error('upsertSeguimientoPublico:', e);
  }
}

// ── URL y QR ───────────────────────────────────────────────
// URL pública de seguimiento. Acepta la reparación entera (nuevo formato) o
// solo el id (formato viejo, para no romper llamadas existentes).
function urlSeguimiento(rep) {
  const origin = (typeof location !== 'undefined') ? location.origin : '';
  if (rep && typeof rep === 'object') {
    if (rep.tokenSeguimiento) {
      return `${origin}/estado.html?o=${encodeURIComponent(rep.nOrden || '')}&k=${encodeURIComponent(rep.tokenSeguimiento)}`;
    }
    return `${origin}/estado.html?id=${encodeURIComponent(rep.id)}`;
  }
  return `${origin}/estado.html?id=${encodeURIComponent(rep)}`;
}

// QR generado acá adentro (qr.js), sin depender de ningún servicio externo.
// `mm` es el lado impreso: 25 mm es el mínimo que lee bien en térmica.
function qrSeguimientoSvg(rep, mm = 25) {
  if (typeof qrSvg !== 'function') return '';
  try {
    return qrSvg(urlSeguimiento(rep), mm);
  } catch (e) {
    console.error('QR:', e);
    return '';
  }
}
