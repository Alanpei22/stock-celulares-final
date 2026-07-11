// Vercel Function — POST /api/telegram-webhook
// Recibe los mensajes que el dueño le manda al bot y responde consultando Firestore.
// Seguridad: (1) header secreto de Telegram (TELEGRAM_WEBHOOK_SECRET),
//            (2) solo responde al chat del dueño (TELEGRAM_CHAT_ID).
// QUOTA: todas las queries usan .select() para NO traer fotos base64.

import admin from 'firebase-admin';

function getAdmin() {
  if (admin.apps.length) return admin;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin;
}

const fmt = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function todayAR() {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
}

function fechaCorta(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: 'short' });
}

const ESTADOS = { reparando: '🔧 Reparando', listo: '✅ Listo', entregado: '📦 Entregado', 'no va': '↩️ No va', cancelado: '↩️ No va', 'no van': '↩️ No va' };

// ── Formateo de una reparación (detalle completo, incluye código/patrón) ──
function repairMsg(r) {
  const lineas = [
    `🔧 <b>#${r.nOrden || '?'} — ${esc(r.marca || '')} ${esc(r.modelo || '')}</b>`,
    `${ESTADOS[r.estado] || esc(r.estado || '—')}${r.estado === 'no va' || r.estado === 'cancelado' || r.estado === 'no van' ? (r.devuelto ? ' (devuelto)' : ' (PARA DEVOLVER)') : ''} · ${esc(r.arreglo || '—')}`,
    `💵 ${fmt(r.monto)}${r.sena > 0 ? ` · seña ${fmt(r.sena)} · saldo ${fmt((r.monto || 0) - (r.sena || 0))}` : ''}${r.cobrado ? ' · COBRADA ✅' : ''}`,
  ];
  const seg = [];
  if (r.codigo) seg.push(`Código: <code>${esc(r.codigo)}</code>`);
  if (Array.isArray(r.patron) && r.patron.length) seg.push(`Patrón: <code>${r.patron.join('-')}</code>`);
  if (seg.length) lineas.push('🔑 ' + seg.join(' · '));
  if (r.nombre || r.tlf) lineas.push(`👤 ${esc(r.nombre || '—')}${r.tlf ? ` · 📱 ${esc(r.tlf)}` : ''}`);
  lineas.push(`📅 Ingresó ${fechaCorta(r.fechaIngreso)}${r.tecnico ? ` · 🧑‍🔧 ${esc(r.tecnico)}` : ''}`);
  if (r.condicion) lineas.push(`👁 ${esc(String(r.condicion).slice(0, 120))}`);
  if (r.observaciones) lineas.push(`📝 ${esc(String(r.observaciones).slice(0, 120))}`);
  return lineas.join('\n');
}

const REP_FIELDS = ['nOrden', 'marca', 'modelo', 'arreglo', 'estado', 'devuelto', 'monto', 'sena', 'cobrado',
  'codigo', 'patron', 'nombre', 'tlf', 'fechaIngreso', 'tecnico', 'condicion', 'observaciones'];

// ── Handlers de consulta ──
async function qRepairByOrden(db, num) {
  const snap = await db.collection('repairs').where('nOrden', '==', num).select(...REP_FIELDS).limit(2).get();
  if (snap.empty) return `No encontré la reparación #${num} 🤷`;
  return snap.docs.map(d => repairMsg(d.data())).join('\n\n');
}

async function qRepairByText(db, q) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 365);
  const snap = await db.collection('repairs')
    .where('fechaIngreso', '>=', cutoff.toISOString())
    .select(...REP_FIELDS).get();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = snap.docs.map(d => d.data()).filter(r => {
    const hay = `${r.marca || ''} ${r.modelo || ''} ${r.nombre || ''} ${r.tlf || ''} ${r.arreglo || ''}`.toLowerCase();
    return terms.every(t => hay.includes(t));
  });
  if (!matches.length) return `Sin resultados para "${esc(q)}" (último año) 🤷`;
  matches.sort((a, b) => (b.fechaIngreso || '').localeCompare(a.fechaIngreso || ''));
  const top = matches.slice(0, 3).map(repairMsg).join('\n\n');
  return matches.length > 3 ? `${top}\n\n…y ${matches.length - 3} más. Afiná la búsqueda o usá el N° de orden.` : top;
}

async function qStock(db, q) {
  const snap = await db.collection('stock').where('vendido', '==', false)
    .select('marca', 'modelo', 'almacenamiento', 'ram', 'bateria', 'estado', 'precio', 'precioUSD', 'moneda', 'imei', 'ubicacion', 'costo').get();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  let items = snap.docs.map(d => d.data());
  if (terms.length) {
    items = items.filter(p => {
      const hay = `${p.marca || ''} ${p.modelo || ''} ${p.almacenamiento || ''} ${p.imei || ''}`.toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }
  if (!items.length) return `Sin equipos disponibles${q ? ` para "${esc(q)}"` : ''} 🤷`;
  const top = items.slice(0, 8).map(p => {
    const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : '', p.bateria ? '🔋' + p.bateria + '%' : ''].filter(Boolean).join(' · ');
    const precio = p.moneda === 'usd' && p.precioUSD ? `u$${p.precioUSD.toLocaleString('es-AR')}` : fmt(p.precio);
    return `📱 <b>${esc(p.marca)} ${esc(p.modelo)}</b>${specs ? ' · ' + esc(specs) : ''}\n   ${precio} · ${esc(p.estado || '')}${p.ubicacion ? ' · 📍' + esc(p.ubicacion) : ''}${p.imei ? `\n   🔑 ${esc(p.imei)}` : ''}`;
  }).join('\n');
  return `<b>Stock disponible (${items.length})</b>\n${top}${items.length > 8 ? `\n…y ${items.length - 8} más` : ''}`;
}

async function qPrecios(db, q) {
  const snap = await db.collection('precios_reparaciones')
    .select('equipo', 'tipo', 'precio', 'precioLista', 'calidad', 'tipoVariante').get();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const items = snap.docs.map(d => d.data()).filter(p => {
    const hay = (p.equipo || '').toLowerCase();
    return terms.every(t => hay.includes(t));
  });
  if (!items.length) return `No tengo precios cargados para "${esc(q)}" 🤷`;
  // Agrupar por equipo (máx 2 equipos)
  const porEquipo = {};
  items.forEach(p => { (porEquipo[p.equipo] = porEquipo[p.equipo] || []).push(p); });
  return Object.entries(porEquipo).slice(0, 2).map(([eq, arr]) => {
    const filas = arr.sort((a, b) => (a.tipo || '').localeCompare(b.tipo || '')).map(p => {
      const variante = [p.calidad, p.tipoVariante].filter(Boolean).join(' ');
      return `· ${esc(p.tipo || '?')}${variante ? ` (${esc(variante)})` : ''}: <b>${p.precio > 0 ? fmt(p.precio) : 'sin precio'}</b>${p.precioLista > 0 ? ` / lista ${fmt(p.precioLista)}` : ''}`;
    }).join('\n');
    return `💲 <b>${esc(eq)}</b>\n${filas}`;
  }).join('\n\n');
}

async function qCaja(db) {
  const today = todayAR();
  const [movSnap, arqSnap] = await Promise.all([
    db.collection('caja_movimientos').where('fecha', '==', today)
      .select('tipo', 'monto', 'monto2', 'metodoPago', 'metodoPago2', 'categoria', 'montoUSD', 'vueltoPesos').get(),
    db.collection('caja_arqueos').doc(today).get(),
  ]);
  const movs = movSnap.docs.map(d => d.data());
  if (!movs.length && !arqSnap.exists) return `Hoy (${today.split('-').reverse().join('/')}) no hubo actividad en la caja todavía.`;
  const apertura = arqSnap.exists ? (arqSnap.data().total || 0) : 0;
  let ing = 0, gastos = 0, retiros = 0, efec = 0, usd = 0, ventas = 0;
  const porMet = {};
  movs.forEach(m => {
    const monto = Number(m.monto) || 0, m2 = Number(m.monto2) || 0;
    if (m.tipo === 'ingreso') {
      ing += monto; ventas++;
      if (m.metodoPago === 'Dólares') { usd += Number(m.montoUSD) || 0; efec -= Number(m.vueltoPesos) || 0; }
      else {
        const met1 = m.metodoPago || 'Efectivo';
        porMet[met1] = (porMet[met1] || 0) + (monto - m2);
        if (m2 > 0 && m.metodoPago2) porMet[m.metodoPago2] = (porMet[m.metodoPago2] || 0) + m2;
        if (met1 === 'Efectivo') efec += monto - m2;
        if (m.metodoPago2 === 'Efectivo') efec += m2;
      }
    } else {
      if (m.categoria === 'Retiro dueño') retiros += monto; else gastos += monto;
      if ((m.metodoPago || 'Efectivo') === 'Efectivo') efec -= monto;
    }
  });
  const metStr = Object.entries(porMet).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([met, v]) => `· ${esc(met)}: ${fmt(v)}`).join('\n');
  const lineas = [
    `💰 <b>Caja de hoy</b> (${today.split('-').reverse().join('/')})`,
    `🔓 Apertura: ${fmt(apertura)}`,
    `💰 Ingresos: <b>${fmt(ing)}</b> (${ventas} mov.)`,
  ];
  if (metStr) lineas.push(metStr);
  if (usd > 0) lineas.push(`💲 Dólares: u$${Math.round(usd).toLocaleString('es-AR')}`);
  lineas.push(`💸 Gastos: ${fmt(gastos)}`);
  if (retiros > 0) lineas.push(`🏧 Retiros dueño: ${fmt(retiros)}`);
  lineas.push(`📊 Neto: <b>${fmt(ing - gastos)}</b>`);
  lineas.push(`💵 Efectivo esperado en caja: <b>${fmt(apertura + efec)}</b>`);
  return lineas.join('\n');
}

const AYUDA = `🤖 <b>Consultas disponibles:</b>
· <b>7123</b> → reparación por N° de orden (con código/patrón)
· <b>iphone juan</b> → buscar reparación por texto
· <b>stock</b> o <b>stock iphone 13</b> → equipos a la venta
· <b>precio a54</b> → lista de precios de reparación
· <b>caja</b> → los números de hoy`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // (1) Header secreto que Telegram manda en cada webhook
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const msg = (req.body || {}).message;
  // Siempre 200 para que Telegram no reintente
  if (!msg || !msg.text) return res.status(200).json({ ok: true });

  // (2) Solo el chat del dueño
  if (String(msg.chat?.id) !== String(process.env.TELEGRAM_CHAT_ID)) {
    return res.status(200).json({ ok: true, skipped: 'chat desconocido' });
  }

  const text = msg.text.trim();
  let respuesta;
  try {
    const db = getAdmin().firestore();
    const lower = text.toLowerCase();
    if (lower === '/start' || lower === 'ayuda' || lower === 'help' || lower === '?') {
      respuesta = AYUDA;
    } else if (/^\/?\d{1,7}$/.test(text.replace('/', ''))) {
      respuesta = await qRepairByOrden(db, parseInt(text.replace('/', ''), 10));
    } else if (lower === 'caja' || lower === '/caja') {
      respuesta = await qCaja(db);
    } else if (lower.startsWith('stock')) {
      respuesta = await qStock(db, text.slice(5).trim());
    } else if (lower.startsWith('precio')) {
      const q = text.replace(/^precios?\s*/i, '').trim();
      respuesta = q ? await qPrecios(db, q) : 'Decime el modelo, ej: <b>precio a54</b>';
    } else {
      respuesta = await qRepairByText(db, text);
    }
  } catch (e) {
    console.error('telegram-webhook:', e);
    respuesta = '⚠️ Error consultando la base. Probá de nuevo en un rato.';
  }

  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: msg.chat.id,
        text: respuesta.slice(0, 4000),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch (e) { console.error('telegram-webhook send:', e); }

  return res.status(200).json({ ok: true });
}
