// Vercel Function — POST /api/cron-resumen-telegram
// La dispara GitHub Actions a las 19:15 AR (22:15 UTC).
//
// Manda al Telegram del dueño el resumen del día: qué entró a reparar, qué se
// entregó, qué equipos se vendieron y cuánta plata entró, separando efectivo
// de digital.
//
// ── El día argentino ───────────────────────────────────────────
// `caja_movimientos` guarda `fecha` como día AR ("2026-09-24"), así que ahí
// alcanza con comparar por igual. Pero las reparaciones guardan ISO en UTC
// (`new Date().toISOString()`), y a las 21:00 AR el ISO ya dice mañana. Por eso
// el rango de las reparaciones se arma en UTC a mano: el día AR va de las
// 03:00Z a las 03:00Z del siguiente. (Argentina es UTC-3 todo el año.)
//
// Auth: Authorization: Bearer <CRON_SECRET>.

import admin from 'firebase-admin';

function getAdmin() {
  if (admin.apps.length) return admin;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT env var faltante');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin;
}

export function hoyAR() {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
}

// El día AR, en las marcas UTC que guardan las reparaciones.
export function rangoUTC(diaAR) {
  const desde = new Date(diaAR + 'T03:00:00.000Z');
  const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000);
  return [desde.toISOString(), hasta.toISOString()];
}

const fmt = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Cuántos EQUIPOS del stock salieron en un movimiento.
// Hay dos caminos para vender un equipo y guardan distinto:
//  · el formulario de venta de equipo → categoria "Venta equipo" + itemSource
//  · el carrito → un array `items`, donde el equipo es source: 'equipo'
export function equiposDe(m) {
  if (Array.isArray(m.items) && m.items.length) {
    return m.items.filter(i => i && i.source === 'equipo').length;
  }
  if (m.itemSource === 'equipo') return Number(m.itemQty) || 1;
  if (m.categoria === 'Venta equipo') return 1;
  return 0;
}

// Nombre corto de un equipo vendido, para la lista.
function nombreEquipo(m) {
  if (Array.isArray(m.items)) {
    const eq = m.items.find(i => i && i.source === 'equipo');
    if (eq && eq.nombre) return eq.nombre;
  }
  if (m.itemNombre) return m.itemNombre;
  return String(m.descripcion || 'Equipo').replace(/^Venta:\s*/, '');
}

// ── El resumen, a partir de los movimientos y las reparaciones ──
// Función pura a propósito: es lo que prueba tests/test-resumen-telegram.js.
export function armarResumen({ dia, movs, ingresadas, entregadas }) {
  let ingresos = 0, efectivo = 0, dolares = 0, equipos = 0;
  const porMetodo = {};
  const vendidos = [];

  for (const m of (movs || [])) {
    if (m.tipo !== 'ingreso') continue;
    const total = Number(m.monto) || 0;
    ingresos += total;

    // Split de pago: `monto2` va al segundo método y el resto al primero.
    const m2   = Number(m.monto2) || 0;
    const met1 = m.metodoPago || 'Efectivo';
    const met2 = m.metodoPago2 || '';
    const partes = [[met1, total - m2]];
    if (m2 > 0 && met2) partes.push([met2, m2]);
    for (const [met, monto] of partes) {
      if (monto <= 0) continue;
      if (met === 'Dólares') { dolares += monto; continue; }   // no entra a la caja de pesos
      porMetodo[met] = (porMetodo[met] || 0) + monto;
      if (met === 'Efectivo') efectivo += monto;
    }

    const n = equiposDe(m);
    if (n > 0) { equipos += n; vendidos.push([nombreEquipo(m), total]); }
  }

  const digital = Object.entries(porMetodo)
    .filter(([met]) => met !== 'Efectivo')
    .reduce((s, [, v]) => s + v, 0);
  const detalleDigital = Object.entries(porMetodo)
    .filter(([met]) => met !== 'Efectivo' && met)
    .sort((a, b) => b[1] - a[1])
    .map(([met, v]) => `${esc(met)} ${fmt(v)}`)
    .join(' · ');

  const l = [`📊 <b>Resumen del día — ${dia.split('-').reverse().join('/')}</b>`, ''];

  // ── Taller ──
  l.push(`🔧 <b>Ingresaron para reparar: ${(ingresadas || []).length}</b>`);
  lista(l, (ingresadas || []).map(r =>
    `${[r.marca, r.modelo].filter(Boolean).join(' ') || 'Equipo'}${r.nombre ? ' — ' + r.nombre : ''}`));

  l.push(`✅ <b>Entregados: ${(entregadas || []).length}</b>`);
  lista(l, (entregadas || []).map(r =>
    `${[r.marca, r.modelo].filter(Boolean).join(' ') || 'Equipo'}${r.nombre ? ' — ' + r.nombre : ''}`));

  // ── Equipos vendidos ──
  l.push(`📱 <b>Equipos vendidos: ${equipos}</b>`);
  lista(l, vendidos.map(([n, monto]) => `${n} ${fmt(monto)}`));

  // ── Plata ──
  l.push('');
  l.push(`💰 <b>Ventas del día: ${fmt(ingresos)}</b>`);
  l.push(`   💵 Efectivo ${fmt(efectivo)}`);
  l.push(`   💳 Digital ${fmt(digital)}`);
  if (detalleDigital) l.push(`      <i>${detalleDigital}</i>`);
  if (dolares > 0) l.push(`   💲 En dólares ${fmt(dolares)} <i>(aparte, no entra a la caja de pesos)</i>`);
  if (!ingresos) l.push('   <i>No se registró ningún ingreso.</i>');

  return l.join('\n');
}

// Hasta 6 renglones; el resto se cuenta. Un resumen de 40 líneas no se lee.
function lista(l, items) {
  items.slice(0, 6).forEach(t => l.push(`   · ${esc(t)}`));
  if (items.length > 6) l.push(`   <i>…y ${items.length - 6} más</i>`);
}

export default async function handler(req, res) {
  if ((req.headers.authorization || '') !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return res.status(200).json({ skipped: 'sin configurar' });

  try {
    const db  = getAdmin().firestore();
    const dia = hoyAR();
    const [desde, hasta] = rangoUTC(dia);

    const cfgDoc = await db.collection('caja_config').doc('notifications').get();
    if (cfgDoc.exists && cfgDoc.data()?.telegram?.enabled === false) {
      return res.status(200).json({ skipped: 'telegram apagado' });
    }

    const [movsSnap, inSnap, outSnap] = await Promise.all([
      db.collection('caja_movimientos').where('fecha', '==', dia).get(),
      db.collection('repairs').where('fechaIngreso', '>=', desde).where('fechaIngreso', '<', hasta).get(),
      db.collection('repairs').where('fechaEntrega', '>=', desde).where('fechaEntrega', '<', hasta).get(),
    ]);

    const texto = armarResumen({
      dia,
      movs: movsSnap.docs.map(d => d.data()),
      ingresadas: inSnap.docs.map(d => d.data()),
      entregadas: outSnap.docs.map(d => d.data()),
    });

    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const data = await r.json();
    if (!data.ok) {
      console.error('cron-resumen-telegram:', data);
      return res.status(200).json({ ok: false, error: data.description });
    }
    return res.status(200).json({ ok: true, dia });
  } catch (e) {
    console.error('cron-resumen-telegram:', e);
    return res.status(500).json({ error: e.message });
  }
}
