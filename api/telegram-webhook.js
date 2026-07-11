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
· <b>caja</b> → los números de hoy
· 📷 Mandá una <b>foto con el N° de orden como pie</b> → se adjunta a esa reparación

📦 <b>Cargar mercadería:</b>
· <b>sumar 5 funda iphone 13</b> → le suma 5 al stock de ese artículo
· <b>nuevo Funda iPhone 15 $8000 x5</b> → crea el producto (precio y cantidad)`;

// ── Sumar stock a un producto (accesorio) o repuesto existente ──
async function qSumarStock(db, cant, texto) {
  const terms = texto.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 'Decime qué artículo, ej: <b>sumar 5 funda iphone 13</b>';

  const [prodSnap, repSnap] = await Promise.all([
    db.collection('productos').select('nombre', 'codigo', 'categoria', 'stock', 'activo').get(),
    db.collection('repuestos').select('nombre', 'marca', 'modelo', 'tipo', 'cantidad').get(),
  ]);
  const matches = [];
  prodSnap.docs.forEach(d => {
    const p = d.data();
    const hay = `${p.nombre || ''} ${p.codigo || ''} ${p.categoria || ''}`.toLowerCase();
    if (terms.every(t => hay.includes(t))) matches.push({ ref: d.ref, nombre: p.nombre, stock: Number(p.stock) || 0, campo: 'stock', tipo: '📦 Accesorio' });
  });
  repSnap.docs.forEach(d => {
    const r = d.data();
    const hay = `${r.nombre || ''} ${r.marca || ''} ${r.modelo || ''} ${r.tipo || ''}`.toLowerCase();
    if (terms.every(t => hay.includes(t))) matches.push({ ref: d.ref, nombre: r.nombre || `${r.tipo || ''} ${r.marca || ''} ${r.modelo || ''}`.trim(), stock: Number(r.cantidad) || 0, campo: 'cantidad', tipo: '🔧 Repuesto' });
  });

  if (!matches.length) {
    return `No encontré "${esc(texto)}" en accesorios ni repuestos 🤷\nPara crearlo: <b>nuevo ${esc(texto)} $precio x${cant}</b>`;
  }
  if (matches.length > 1) {
    const lista = matches.slice(0, 8).map(m => `· ${m.tipo} ${esc(m.nombre)} (stock ${m.stock})`).join('\n');
    return `Encontré ${matches.length} artículos, sé más específico:\n${lista}${matches.length > 8 ? '\n…' : ''}`;
  }

  const m = matches[0];
  await m.ref.update({ [m.campo]: admin.firestore.FieldValue.increment(cant) });
  return `✅ <b>+${cant} u.</b> → ${m.tipo} <b>${esc(m.nombre)}</b>\nStock: ${m.stock} → <b>${m.stock + cant}</b>`;
}

// ── Crear un producto (accesorio) nuevo: "nuevo <nombre> $<precio> [x<cant>]" ──
async function qNuevoProducto(db, texto) {
  const m = texto.match(/^(.+?)\s+\$?\s*([\d.,]+)\s*(?:x\s*(\d+))?$/i);
  if (!m) return 'Formato: <b>nuevo Funda iPhone 15 $8000 x5</b> (la cantidad es opcional, default 1)';
  const nombre = m[1].trim();
  const precio = parseInt(String(m[2]).replace(/[.,]/g, ''), 10) || 0;
  const cant   = parseInt(m[3], 10) || 1;
  if (!nombre || precio <= 0) return 'Necesito nombre y precio, ej: <b>nuevo Funda iPhone 15 $8000 x5</b>';

  // Evitar duplicado exacto
  const dup = await db.collection('productos').select('nombre').get();
  const ya = dup.docs.find(d => (d.data().nombre || '').toLowerCase() === nombre.toLowerCase());
  if (ya) return `Ya existe <b>${esc(nombre)}</b> — usá <b>sumar ${cant} ${esc(nombre)}</b> para agregarle stock.`;

  await db.collection('productos').add({
    codigo: '', nombre, categoria: '',
    precioVenta: precio, precioCosto: 0,
    stock: cant, stockMin: 0, activo: true,
    fechaAlta: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return `✅ <b>Producto creado</b>\n📦 ${esc(nombre)} · ${fmt(precio)} · stock ${cant}\n(Queda en Accesorios; el costo lo cargás después si querés)`;
}

// ── Foto recibida: adjuntarla a la reparación del N° de orden del pie ──
async function handleFoto(db, msg) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const caption = (msg.caption || '').trim();
  const m = caption.match(/\d{1,7}/);
  if (!m) {
    return 'Para adjuntar la foto a una reparación, mandala con el <b>N° de orden como pie de foto</b>.\nEj: sacás la foto y en el texto ponés <b>7123</b>.';
  }
  const num = parseInt(m[0], 10);
  const snap = await db.collection('repairs').where('nOrden', '==', num)
    .select('marca', 'modelo', 'nOrden').limit(1).get();
  if (snap.empty) return `No encontré la reparación #${num} 🤷 — revisá el número.`;
  const doc = snap.docs[0];
  const r = doc.data();

  // Elegir el tamaño más grande hasta ~900px (mismo criterio que la app)
  const sizes = (msg.photo || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
  const candidatos = sizes.filter(p => (p.width || 0) <= 900);
  const ph = candidatos.length ? candidatos[candidatos.length - 1] : sizes[0];
  if (!ph) return '⚠️ No pude leer la foto, probá de nuevo.';

  // Descargar el archivo desde Telegram
  const fi = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${ph.file_id}`)).json();
  if (!fi.ok) return '⚠️ No pude descargar la foto de Telegram, probá de nuevo.';
  const buf = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${token}/${fi.result.file_path}`)).arrayBuffer());
  if (buf.length > 750 * 1024) return '⚠️ La foto es demasiado pesada, probá mandarla de nuevo (Telegram la comprime solo).';

  const dataUrl = 'data:image/jpeg;base64,' + buf.toString('base64');
  await doc.ref.update({ foto: dataUrl });
  return `📷 <b>Foto guardada</b> en #${num} — ${esc(r.marca || '')} ${esc(r.modelo || '')} ✅\nYa se ve en la app, en el detalle de la reparación.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // (1) Header secreto que Telegram manda en cada webhook
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const msg = (req.body || {}).message;
  // Siempre 200 para que Telegram no reintente
  if (!msg) return res.status(200).json({ ok: true });

  // (2) Solo el chat del dueño
  if (String(msg.chat?.id) !== String(process.env.TELEGRAM_CHAT_ID)) {
    return res.status(200).json({ ok: true, skipped: 'chat desconocido' });
  }

  let respuesta;

  // 📷 Foto adjunta → guardarla en la reparación del N° del pie
  if (Array.isArray(msg.photo) && msg.photo.length) {
    try {
      respuesta = await handleFoto(getAdmin().firestore(), msg);
    } catch (e) {
      console.error('telegram-webhook foto:', e);
      respuesta = '⚠️ Error guardando la foto. Probá de nuevo en un rato.';
    }
    await _tgReply(msg.chat.id, respuesta);
    return res.status(200).json({ ok: true });
  }

  // Documento-imagen (foto "sin comprimir"): pedir que la mande como foto
  if (msg.document && String(msg.document.mime_type || '').startsWith('image/')) {
    await _tgReply(msg.chat.id, 'Mandala como <b>foto</b> (no como archivo), así Telegram la comprime y la puedo guardar 📷');
    return res.status(200).json({ ok: true });
  }

  if (!msg.text) return res.status(200).json({ ok: true });

  const text = msg.text.trim();
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
    } else if (/^(sumar|agregar)\s+\d+\s+/.test(lower)) {
      const ms = text.match(/^(?:sumar|agregar)\s+(\d+)\s+(.+)$/i);
      respuesta = await qSumarStock(db, parseInt(ms[1], 10), ms[2].trim());
    } else if (lower.startsWith('nuevo ')) {
      respuesta = await qNuevoProducto(db, text.slice(6).trim());
    } else {
      respuesta = await qRepairByText(db, text);
    }
  } catch (e) {
    console.error('telegram-webhook:', e);
    respuesta = '⚠️ Error consultando la base. Probá de nuevo en un rato.';
  }

  await _tgReply(msg.chat.id, respuesta);
  return res.status(200).json({ ok: true });
}

// Enviar respuesta al chat (best-effort)
async function _tgReply(chatId, texto) {
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(texto || '').slice(0, 4000),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch (e) { console.error('telegram-webhook send:', e); }
}
