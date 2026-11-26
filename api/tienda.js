// Vercel Function — /api/tienda?accion=...  (la tienda online de /equipos)
//
//   GET  ?accion=config   → la seña y el envío, para mostrarlos en el carrito
//   POST ?accion=pedido   → arma el pedido con los precios del stock, lo guarda
//                           en pedidos_online y devuelve el link de Mercado Pago
//   POST ?accion=webhook  → Mercado Pago avisa un pago: se le PREGUNTA a
//                           Mercado Pago si es real y, si está aprobado, se
//                           descuenta stock, se anota en la caja y se avisa por
//                           Telegram (una sola vez, en una transacción)
//   GET  ?accion=estado&id= → cómo quedó el pedido (para la vuelta del pago)
//
// Es pública a propósito (el que compra no tiene cuenta). Por eso:
//   · la página manda QUÉ compra, nunca el precio (los calcula api/_tienda.js);
//   · el aviso de pago no se cree: se consulta el pago a Mercado Pago con
//     nuestra clave, y tiene que ser de este pedido y por el monto justo;
//   · lo único que escribe sin pago confirmado es el pedido en pendiente.
// Clave en Vercel: MP_ACCESS_TOKEN (Mercado Pago → Tus integraciones → la
// aplicación → Credenciales de producción → Access Token). Nunca en el repo.

import admin from 'firebase-admin';
import { tiendaCfg, normalizarCarrito, validarDatos, armarPedido, preferenciaMP, pagoValido,
         efectosDelPago, estadoPublico } from './_tienda.js';

function getAdmin() {
  if (admin.apps.length) return admin;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT env var faltante');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin;
}

const MP = 'https://api.mercadopago.com';
const hoyAR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

async function leerCfg(db) {
  try { const d = await db.collection('config').doc('tienda').get(); return tiendaCfg(d.exists ? d.data() : null); }
  catch (e) { return tiendaCfg(null); }
}

// El mismo dólar que usa la app: el manual de Configuración o el blue + $10
async function dolarHoy(db) {
  try {
    const d = await db.collection('config').doc('appSettings').get();
    const m = d.exists ? Number(d.data().dolarManual) : 0;
    if (m > 0) return m;
  } catch (e) {}
  try {
    const r = await fetch('https://dolarapi.com/v1/dolares/blue');
    const j = await r.json();
    const v = Math.round(Number(j.venta || j.compra) || 0);
    return v > 0 ? v + 10 : 0;
  } catch (e) { return 0; }
}

async function telegram(texto) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (e) { console.error('tienda telegram:', e); }
}

export default async function handler(req, res) {
  const accion = String((req.query && req.query.accion) || '');
  try {
    if (accion === 'config' && req.method === 'GET') return await config(req, res);
    if (accion === 'pedido' && req.method === 'POST') return await crearPedido(req, res);
    if (accion === 'webhook') return await webhook(req, res);
    if (accion === 'estado' && req.method === 'GET') return await estado(req, res);
    return res.status(404).json({ error: 'No existe' });
  } catch (e) {
    console.error('api/tienda', accion, e);
    res.setHeader('Cache-Control', 'no-store');
    // Al webhook se le contesta 200 igual: si no, Mercado Pago reintenta sin fin
    return res.status(accion === 'webhook' ? 200 : 500).json({ error: 'Algo falló, probá de nuevo' });
  }
}

async function config(req, res) {
  const c = await leerCfg(getAdmin().firestore());
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  return res.status(200).json({ senaPct: c.senaPct, senaMin: c.senaMin, envioKm: c.envioKm, mp: !!process.env.MP_ACCESS_TOKEN });
}

async function crearPedido(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const v = validarDatos(body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const carrito = normalizarCarrito(body.items);
  if (!carrito.length) return res.status(400).json({ error: 'El carrito está vacío' });
  if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ error: 'sin_mp' });

  const db = getAdmin().firestore();
  const refs = carrito.map(it => db.collection(it.tipo === 'equipo' ? 'stock' : 'productos').doc(it.id));
  const snaps = await db.getAll(...refs);
  const docs = {};
  carrito.forEach((it, i) => { docs[it.tipo + ':' + it.id] = snaps[i].exists ? { id: it.id, ...snaps[i].data() } : null; });
  const cfg = await leerCfg(db);
  const usd = carrito.some((it, i) => it.tipo === 'equipo' && snaps[i].exists && snaps[i].data().moneda === 'usd');
  const dolar = usd ? await dolarHoy(db) : 0;
  const r = armarPedido({ carrito, datos: v.datos, docs, cfg, dolar, ahora: Date.now() });
  if (!r.ok) return res.status(409).json({ error: r.error });

  const ref = db.collection('pedidos_online').doc();
  const ahora = new Date().toISOString();
  await ref.set({ ...r.pedido, estado: 'pendiente_pago', creado: ahora, dolar: dolar || null });
  const mp = await fetch(`${MP}/checkout/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'X-Idempotency-Key': ref.id },
    body: JSON.stringify(preferenciaMP(r.pedido, ref.id)),
  });
  const pref = await mp.json().catch(() => ({}));
  if (!mp.ok || !pref.init_point) {
    console.error('mercadopago preferencia:', mp.status, pref);
    await ref.update({ estado: 'error_mp' });
    return res.status(502).json({ error: 'No se pudo abrir Mercado Pago. Probá de nuevo o escribinos por WhatsApp.' });
  }
  await ref.update({ mpPreferencia: pref.id || null });
  return res.status(200).json({ id: ref.id, url: pref.init_point, aPagar: r.pedido.aPagar, total: r.pedido.total });
}

async function webhook(req, res) {
  const q = req.query || {};
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch (e) { return {}; } })() : (req.body || {});
  const tipo = String(q.type || q.topic || body.type || body.topic || '');
  const pagoId = String(q['data.id'] || (body.data && body.data.id) || (tipo === 'payment' ? q.id : '') || '').replace(/\D+/g, '');
  if (tipo !== 'payment' || !pagoId || !process.env.MP_ACCESS_TOKEN) return res.status(200).json({ ok: true });

  // No se cree lo que dice el aviso: se le pregunta a Mercado Pago
  const r = await fetch(`${MP}/v1/payments/${pagoId}`, { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } });
  if (!r.ok) return res.status(200).json({ ok: true });
  const pago = await r.json();
  const id = String(pago.external_reference || '');
  if (!id || /[\/.]/.test(id)) return res.status(200).json({ ok: true });

  const db = getAdmin().firestore();
  const ref = db.collection('pedidos_online').doc(id);
  let aviso = null;
  await db.runTransaction(async t => {
    aviso = null;
    const d = await t.get(ref);
    if (!d.exists) return;
    const p = d.data();
    if (p.estado === 'pagado') return;                       // ya se procesó (Mercado Pago avisa varias veces)
    if (!pagoValido(pago, p, id)) {
      if (['rejected', 'cancelled'].includes(pago.status)) t.update(ref, { estado: 'rechazado', mpPagoId: String(pago.id) });
      else if (pago.status) t.update(ref, { mpEstado: pago.status, mpPagoId: String(pago.id) });
      return;
    }
    const ahora = new Date().toISOString();
    const ef = efectosDelPago(p, id, pago, ahora, hoyAR());
    t.update(ref, ef.pedidoPatch);
    ef.productos.forEach(x => t.update(db.collection('productos').doc(x.id), { stock: admin.firestore.FieldValue.increment(x.inc) }));
    ef.equipos.forEach(x => t.update(db.collection('stock').doc(x.id), x.patch));
    t.set(db.collection('caja_movimientos').doc(), ef.caja);
    aviso = ef.telegram;
  });
  if (aviso) await telegram(aviso);
  return res.status(200).json({ ok: true });
}

async function estado(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const id = String((req.query && req.query.id) || '');
  if (!id || id.length > 40 || /[\/.]/.test(id)) return res.status(400).json({ error: 'Pedido inválido' });
  const d = await getAdmin().firestore().collection('pedidos_online').doc(id).get();
  if (!d.exists) return res.status(404).json({ error: 'No encontramos el pedido' });
  return res.status(200).json(estadoPublico(d.data()));
}
