// ══════════════════════════════════════════════════════════════
//  🛒 TIENDA ONLINE — carrito de /equipos → Mercado Pago
// ══════════════════════════════════════════════════════════════
// Alan (26/11): carrito con celulares y accesorios, pago con Mercado Pago.
// Decisiones: se puede pagar TODO o dejar una SEÑA; retiro en el local o
// envío sin cargo hasta 2 km del local; mismo precio que en el local; al
// pagarse se descuenta del stock, queda en la caja como venta online y avisa
// por Telegram.
//
// Acá va lo que no toca la base ni internet (para probarlo en tests/
// test-tienda.js). El que habla con Firestore y Mercado Pago es api/tienda.js.
//
// ⚠️ Seguridad: la página manda QUÉ quiere comprar (tipo, id, cantidad), nunca
// el precio. El precio sale de acá, del stock, con las mismas reglas que la
// página pública (equipoPublico / accesorioPublico): lo que no se muestra,
// no se vende.

import { equipoPublico, marcaCanon } from './equipos.js';
import { accesorioPublico } from './_accesorios.js';

// Se pueden cambiar en Firestore: config/tienda { senaPct, senaMin, envioKm }
export const TIENDA_DEF = { senaPct: 20, senaMin: 10000, envioKm: 2, maxItems: 20 };
export const SITIO = 'https://stock-celulares-final.vercel.app';
export const LOCAL = 'Urquiza 4741, Local 22, Caseros';

const txt = (v, max = 120) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max);
const plata = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const redondear100 = n => Math.round(n / 100) * 100;

export function tiendaCfg(c) {
  const x = Object.assign({}, TIENDA_DEF);
  if (c && Number(c.senaPct) > 0 && Number(c.senaPct) <= 100) x.senaPct = Number(c.senaPct);
  if (c && Number(c.senaMin) >= 0) x.senaMin = Number(c.senaMin);
  if (c && Number(c.envioKm) > 0) x.envioKm = Number(c.envioKm);
  return x;
}

// ── Precios, del lado del servidor ───────────────────────────
// Equipo: tiene que estar publicado y disponible (no vendido ni reservado).
// Los que tienen el precio en dólares se cobran en pesos al dólar del día.
export function precioEquipoARS(doc, dolar, ahora) {
  const pub = doc && equipoPublico(doc, ahora);
  if (!pub || pub.estado !== 'disponible' || !pub.precio) return 0;
  if (pub.moneda === 'usd') return dolar > 0 ? redondear100(pub.precio * dolar) : 0;
  return Math.round(pub.precio);
}
export function precioAccesorioARS(doc) {
  const pub = doc && accesorioPublico(doc);
  return pub && pub.precio ? pub.precio : 0;
}
function nombreDe(tipo, doc) {
  if (tipo === 'accesorio') return txt(doc && doc.nombre, 80) || 'Accesorio';
  // Sin depender de que siga publicado: el nombre hace falta justo para decir
  // "ya no está disponible: Samsung A54"
  const marca = marcaCanon(doc && doc.marca);
  const modelo = txt(doc && doc.modelo, 60);
  const repite = marca && modelo.toLowerCase().startsWith(marca.toLowerCase());
  const cap = txt(doc && doc.almacenamiento, 20).replace(/^(\d+)\s*(GB|TB)$/i, (m, n, u) => `${n} ${u.toUpperCase()}`);
  return [repite ? '' : marca, modelo, cap].filter(Boolean).join(' ') || 'Celular';
}

// ── El carrito que manda la página ───────────────────────────
// [{ tipo: 'equipo' | 'accesorio', id, qty }] → sin repetidos, cantidades
// razonables (un equipo es uno solo: cada ficha es un IMEI).
export function normalizarCarrito(items, max) {
  const lim = max || TIENDA_DEF.maxItems;
  const out = [];
  (Array.isArray(items) ? items : []).forEach(it => {
    const tipo = it && (it.tipo === 'equipo' || it.tipo === 'accesorio') ? it.tipo : null;
    const id = txt(it && it.id, 60);
    if (!tipo || !id || /[\/.]/.test(id)) return;     // un id de Firestore no tiene "/" ni "."
    const qty = tipo === 'equipo' ? 1 : Math.max(1, Math.min(10, Math.floor(Number(it.qty) || 1)));
    const ya = out.find(x => x.tipo === tipo && x.id === id);
    if (ya) ya.qty = tipo === 'equipo' ? 1 : Math.min(10, ya.qty + qty);
    else out.push({ tipo, id, qty });
  });
  return out.slice(0, lim);
}

// Datos del cliente y la entrega
export function validarDatos(d) {
  const nombre = txt(d && d.nombre, 60);
  const tlf = String((d && d.tlf) || '').replace(/\D+/g, '').slice(-13);
  const entrega = d && d.entrega === 'envio' ? 'envio' : 'retiro';
  const direccion = txt(d && d.direccion, 140);
  const nota = txt(d && d.nota, 200);
  const modo = d && d.modo === 'sena' ? 'sena' : 'total';
  if (nombre.length < 2) return { ok: false, error: 'Poné tu nombre' };
  if (tlf.length < 8) return { ok: false, error: 'Poné tu WhatsApp (con característica)' };
  if (entrega === 'envio' && direccion.length < 5) return { ok: false, error: 'Poné la dirección para el envío' };
  return { ok: true, datos: { nombre, tlf, entrega, direccion: entrega === 'envio' ? direccion : '', nota, modo } };
}

// La seña: un porcentaje del total, con un mínimo (y nunca más que el total)
export function calcSena(total, cfg) {
  const c = tiendaCfg(cfg);
  if (!(total > 0)) return 0;
  return Math.min(total, Math.max(c.senaMin, redondear100(total * c.senaPct / 100)));
}

// docs: { 'equipo:ID': datos | null, 'accesorio:ID': datos | null }
export function armarPedido({ carrito, datos, docs, cfg, dolar, ahora }) {
  const items = [], sinStock = [];
  for (const it of carrito) {
    const doc = docs[it.tipo + ':' + it.id] || null;
    const precio = it.tipo === 'equipo' ? precioEquipoARS(doc, dolar, ahora) : precioAccesorioARS(doc);
    const stock = it.tipo === 'equipo' ? 1 : Math.floor(Number(doc && doc.stock) || 0);
    const nombre = doc ? nombreDe(it.tipo, doc) : 'Un artículo';
    if (!precio || stock < it.qty) { sinStock.push(nombre); continue; }
    items.push({ tipo: it.tipo, id: it.id, nombre, qty: it.qty, precio, subtotal: precio * it.qty });
  }
  if (sinStock.length) return { ok: false, error: `Ya no está disponible: ${sinStock.join(', ')}. Sacalo del carrito y probá de nuevo.`, sinStock };
  if (!items.length) return { ok: false, error: 'El carrito está vacío' };
  const total = items.reduce((s, x) => s + x.subtotal, 0);
  const aPagar = datos.modo === 'sena' ? calcSena(total, cfg) : total;
  return { ok: true, pedido: {
    items, total, modo: datos.modo, aPagar, resto: total - aPagar,
    cliente: { nombre: datos.nombre, tlf: datos.tlf },
    entrega: { tipo: datos.entrega, direccion: datos.direccion, nota: datos.nota },
  } };
}

// Lo que se le pide a Mercado Pago (Checkout Pro). Un solo renglón con lo que
// se paga ahora: así la seña y el total cierran justo, sin redondeos.
export function preferenciaMP(p, id) {
  const resumen = p.items.map(x => (x.qty > 1 ? x.qty + '× ' : '') + x.nombre).join(', ');
  return {
    items: [{
      id: 'pedido-' + id,
      title: txt((p.modo === 'sena' ? 'Seña: ' : '') + resumen, 250),
      description: p.modo === 'sena' ? `Seña de ${plata(p.total)}. El resto (${plata(p.resto)}) se paga al retirar o recibir.` : 'Compra en TechPoint Caseros',
      quantity: 1,
      unit_price: p.aPagar,
      currency_id: 'ARS',
    }],
    payer: { name: p.cliente.nombre },
    external_reference: id,
    notification_url: `${SITIO}/api/tienda?accion=webhook`,
    back_urls: {
      success: `${SITIO}/equipos?pedido=${id}`,
      pending: `${SITIO}/equipos?pedido=${id}`,
      failure: `${SITIO}/equipos?pedido=${id}`,
    },
    auto_return: 'approved',
    statement_descriptor: 'TECHPOINT',
  };
}

// ¿El pago de Mercado Pago corresponde a este pedido y está aprobado?
export function pagoValido(pago, pedido, id) {
  if (!pago || !pedido) return false;
  return pago.status === 'approved'
    && String(pago.external_reference || '') === String(id)
    && (pago.currency_id || 'ARS') === 'ARS'
    && Number(pago.transaction_amount) >= Number(pedido.aPagar) - 1;
}

// Lo que hay que hacer cuando se paga (todo en una transacción, una sola vez):
//   · accesorios: se descuenta el stock;
//   · equipos: pago total → vendido; seña → reservado a nombre del cliente;
//   · caja: un ingreso por Mercado Pago ("Venta online" o "Seña venta");
//   · Telegram: el aviso con todo para prepararlo.
export function efectosDelPago(p, id, pago, ahoraISO, fechaAR) {
  const corto = String(id).slice(-6).toUpperCase();
  const monto = Math.round(Number(pago && pago.transaction_amount) || p.aPagar);
  const productos = p.items.filter(x => x.tipo === 'accesorio').map(x => ({ id: x.id, inc: -x.qty }));
  const equipos = p.items.filter(x => x.tipo === 'equipo').map(x => ({
    id: x.id,
    patch: p.modo === 'total'
      ? { vendido: true, fechaVenta: ahoraISO, vendedor: 'Tienda online', ventaOnline: id, compradorNombre: p.cliente.nombre, compradorTlf: p.cliente.tlf }
      : { reservado: true, reservaCliente: p.cliente.nombre, reservaTelefono: p.cliente.tlf, reservaCreadaEn: ahoraISO,
          // La seña se reparte entre los equipos según su precio (la ficha muestra lo que falta)
          reservaSena: Math.round(monto * x.subtotal / p.total), reservaVendedor: 'Tienda online', reservaOnline: id },
  }));
  const entregaTxt = p.entrega.tipo === 'envio' ? `🛵 Envío a ${p.entrega.direccion}` : '🏪 Retira en el local';
  const caja = {
    tipo: 'ingreso',
    categoria: p.modo === 'sena' ? 'Seña venta' : 'Venta online',
    descripcion: `🛒 Pedido online #${corto} — ${p.cliente.nombre} — ${p.items.map(x => (x.qty > 1 ? x.qty + '× ' : '') + x.nombre).join(', ')}`.slice(0, 300),
    monto,
    metodoPago: 'MercadoPago',
    fecha: fechaAR,
    createdAt: ahoraISO,
    pedidoOnlineId: id,
    mpPagoId: String((pago && pago.id) || ''),
    items: p.items.map(x => ({ id: x.id, source: x.tipo === 'equipo' ? 'stock' : 'producto', nombre: x.nombre, qty: x.qty, precioUnit: x.precio })),
    cargadoPor: 'Tienda online',
  };
  if (p.modo === 'sena') caja.esSenaOnline = true;
  const telegram = `🛒 <b>Pedido online #${corto} — PAGADO</b>\n`
    + p.items.map(x => `• ${x.qty > 1 ? x.qty + '× ' : ''}${x.nombre} — ${plata(x.subtotal)}`).join('\n') + '\n'
    + (p.modo === 'sena' ? `💳 Seña ${plata(monto)} por Mercado Pago · falta ${plata(p.total - monto)}` : `💳 ${plata(monto)} por Mercado Pago (total)`) + '\n'
    + `👤 ${p.cliente.nombre} · 📱 ${p.cliente.tlf}\n${entregaTxt}`
    + (p.entrega.nota ? `\n📝 ${p.entrega.nota}` : '');
  return {
    pedidoPatch: { estado: 'pagado', pagadoEn: ahoraISO, montoPagado: monto, mpPagoId: caja.mpPagoId },
    productos, equipos, caja, telegram,
  };
}

// Lo que ve el cliente al volver de Mercado Pago (nada personal)
export function estadoPublico(p) {
  if (!p) return null;
  return { estado: p.estado || 'pendiente_pago', modo: p.modo, total: p.total, aPagar: p.aPagar,
    entrega: p.entrega && p.entrega.tipo, items: (p.items || []).length };
}
