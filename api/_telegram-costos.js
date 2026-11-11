// ══════════════════════════════════════════════════════════════
//  💲 El costo de una reparación, por Telegram
// ══════════════════════════════════════════════════════════════
//  Alan (11/11): "si se rellena sin costo, ¿se me puede preguntar por
//  Telegram y que se cargue?". Cuando una reparación queda lista o entregada
//  sin costo, la app manda "💲 Falta el costo de la #8412 …" (repairs.js).
//  Alan RESPONDE ese mensaje con el número y se carga. No hay que guardar
//  nada en el medio: el N° de orden sale del mensaje respondido.
//  También a mano: "costo 8412 15000".
//
//  Sin Firestore acá (lo usa telegram-webhook.js), para poder probarlo solo.

// El N° de orden del mensaje que se está respondiendo (o null si no es una
// pregunta de costo). Telegram devuelve el texto sin las etiquetas HTML.
export function ordenDePregunta(textoRespondido) {
  const m = String(textoRespondido || '').match(/Falta el costo de la #(\d{1,7})/);
  return m ? parseInt(m[1], 10) : null;
}

// "costo 8412 15000" → { orden, resto: '15000' }
export function comandoCosto(texto) {
  const m = String(texto || '').trim().match(/^\/?costo\s+#?(\d{1,7})\s+(.+)$/i);
  return m ? { orden: parseInt(m[1], 10), resto: m[2].trim() } : null;
}

// Lo que escribió → pesos. "15000", "$15.000", "15k", "15 mil" → 15000.
// "0", "nada", "sin repuesto", "mano de obra" → 0. Si no se entiende: null.
export function leerCosto(texto) {
  const t = String(texto || '').trim().toLowerCase();
  if (!t) return null;
  if (/^(0|nada|ninguno|sin repuesto|sin costo|no us[eé]( repuesto)?|mano de obra|mo)$/.test(t)) return 0;
  const m = t.match(/^\$?\s*(\d[\d.,]*)\s*(k|mil|m|palos?|lucas?)?$/);
  if (!m) return null;
  let s = m[1];
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, ''); else s = s.replace(',', '.');
  let n = parseFloat(s);
  if (!isFinite(n)) return null;
  const suf = m[2] || '';
  if (suf === 'k' || suf === 'mil' || /^lucas?$/.test(suf)) n *= 1000;
  else if (suf === 'm' || /^palos?$/.test(suf)) n *= 1e6;
  n = Math.round(n);
  return n >= 0 && n <= 20e6 ? n : null;
}

// Lo que se le escribe a la reparación (igual que el aviso de costo de la app)
export function patchReparacion(costo) {
  return costo > 0 ? { costo, costoRepuesto: costo, costoPorTelegram: true }
                   : { sinRepuesto: true, costo: 0, costoRepuesto: 0, costoPorTelegram: true };
}

// ── La ganancia del cobro, si ya estaba cobrada ──
// COPIA de repEsCobro / repGananciaPatch de utils.js (el navegador y el
// servidor no comparten archivos). tests/test-telegram-costos.js comprueba
// que den lo mismo: si se toca una, se toca la otra.
export function esCobro(m) {
  return !!m && m.tipo === 'ingreso' && !m.esSena && (m.esCobro || m.repairMode === 'cobro' || typeof m.gananciaARS === 'number');
}
export function gananciaPatch(mov, r, costoNuevo, costoViejo) {
  const cn = Math.max(0, Math.round(Number(costoNuevo) || 0));
  const patch = { costoReparacionARS: cn, sinCosto: !(cn > 0) };
  const gan = typeof mov.gananciaARS === 'number' ? mov.gananciaARS : null;
  if (mov.costoReparacionARS != null) {
    const delta = cn - (Number(mov.costoReparacionARS) || 0);
    patch.gananciaARS = (gan || 0) - delta;
    patch.costoARSTotal = Math.max(0, (Number(mov.costoARSTotal) || 0) + delta);
  } else if (mov.repairMode || gan === null) {
    const precioOrden = Number(r && r.monto) || Number(mov.montoReparacion) || Number(mov.monto) || 0;
    const base = gan !== null ? gan : -(Number(mov.comisionTarjeta) || 0);
    patch.gananciaARS = base + (precioOrden - cn);
    patch.costoARSTotal = (Number(mov.costoARSTotal) || 0) + cn;
  } else {
    const delta = cn - (Number(costoViejo) || 0);
    patch.gananciaARS = gan - delta;
    patch.costoARSTotal = Math.max(0, (Number(mov.costoARSTotal) || 0) + delta);
  }
  return patch;
}

const _fmt = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function textoCostoCargado(r, costo, cobrosCorregidos) {
  const eq = `#${r.nOrden} ${_esc(r.marca || '')} ${_esc(r.modelo || '')}`.trim();
  const monto = Number(r.monto) || 0;
  const gan = monto > 0 ? ` · ganancia <b>${_fmt(monto - costo)}</b>` : '';
  return (costo > 0 ? `✅ Costo cargado en la ${eq}: <b>${_fmt(costo)}</b>${gan}`
                    : `✅ Anotado: la ${eq} fue sin repuesto (solo mano de obra)${gan}`) +
    (cobrosCorregidos ? `\n📈 Ya estaba cobrada: corregí la ganancia en la caja.` : '');
}

export const AYUDA_COSTOS = `💲 <b>Costos de reparaciones:</b>
· Cuando una queda lista sin costo te pregunto: <b>respondé ese mensaje</b> con lo que te costó (ej. <b>15000</b>; <b>0</b> si no usaste repuesto)
· <b>costo 8412 15000</b> → cargarlo a mano para la orden 8412`;
