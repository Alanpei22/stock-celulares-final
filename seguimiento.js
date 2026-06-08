// ══════════════════════════════════════════
//  seguimiento.js — Seguimiento público (QR)
//  Mantiene un doc público SIN datos sensibles para que
//  el cliente vea el estado de su reparación escaneando el QR.
//  Colección: seguimiento_publico/{repairId}
// ══════════════════════════════════════════
'use strict';

// Crea/actualiza el doc público de una reparación.
// SOLO incluye datos no sensibles (nada de teléfono, precio, DNI).
async function upsertSeguimientoPublico(r) {
  if (!r || !r.id) return;
  if (typeof db === 'undefined' || !db) return;
  try {
    const biz = (typeof window !== 'undefined' && window._DAKI_NAME) || 'TechPoint';
    await db.collection('seguimiento_publico').doc(r.id).set({
      nOrden: r.nOrden || null,
      negocio: biz,
      equipo: `${r.marca || ''} ${r.modelo || ''}`.trim(),
      arreglo: r.arreglo || '',
      estado: r.estado || 'reparando',
      fechaIngreso: r.fechaIngreso || null,
      fechaEstimada: r.fechaEstimada || null,
      fechaEntrega: r.fechaEntrega || null,
      // Línea de tiempo de estados (solo estado + fecha, sin nada más)
      historial: Array.isArray(r.estadoHistorial)
        ? r.estadoHistorial.map(h => ({ estado: h.estado, fecha: h.fecha }))
        : [{ estado: r.estado || 'reparando', fecha: r.fechaIngreso || new Date().toISOString() }],
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (e) {
    console.error('upsertSeguimientoPublico:', e);
  }
}

// URL pública de seguimiento para una reparación (para el QR).
function urlSeguimiento(repairId) {
  const origin = (typeof location !== 'undefined') ? location.origin : '';
  return `${origin}/estado.html?id=${encodeURIComponent(repairId)}`;
}

// URL de imagen QR (API pública, no requiere librería).
function qrImgSrc(data, size = 120) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(data)}`;
}
