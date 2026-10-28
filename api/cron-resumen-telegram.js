// Vercel Function — POST /api/cron-resumen-telegram
// La dispara GitHub Actions a las 19:15 AR (22:15 UTC).
// Con { oficina: true }, a las 10:30 AR: lo urgente del día (ver abajo).
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

// ══════════════════════════════════════════════════════════════
//  ✅ El parte de la mañana (body { oficina: true }, 10:30 AR)
// ══════════════════════════════════════════════════════════════
// Lo mismo que la tarjeta "Para hacer hoy" del Dashboard (hoy.js), pero por
// Telegram y aunque nadie abra la app. SOLO lo urgente; si no hay nada, no
// manda nada (antes era un parte largo firmado por personajes y Alan dijo
// que no le servía). Además anota solo en el pedido lo que se terminó: acá
// se leen el stock y el pedido enteros, así que se sabe bien qué falta.
// Las reglas son una copia corta de hoy.js: si cambian allá, mirar acá.
const DIA = 864e5;
const dias = (iso, ahora) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? Math.floor((ahora - t) / DIA) : null; };
const equipoRep = r => [r.marca, r.modelo].filter(Boolean).join(' ') || 'Equipo';

// Categoría del pedido según el tipo (la misma tabla que hoy.js)
function categoriaPedido(x) {
  const t = String((x && (x.tipo || x.categoria)) || '').toLowerCase();
  const tabla = [['módulo', 'Módulo'], ['modulo', 'Módulo'], ['pantalla', 'Pantalla'], ['bater', 'Batería'], ['cargador', 'Cargador'],
    ['cable', 'Cable'], ['auricular', 'Auricular'], ['funda', 'Funda'], ['vidrio', 'Vidrio templado / Hidrogel'], ['hidrogel', 'Vidrio templado / Hidrogel'],
    ['conector', 'Conector'], ['pin', 'Conector'], ['flex', 'Flex'], ['cámara', 'Cámara'], ['camara', 'Cámara'], ['parlante', 'Parlante'],
    ['micr', 'Micrófono'], ['marco', 'Marco']];
  const hit = tabla.find(([k]) => t.includes(k));
  return hit ? hit[1] : 'Otro';
}

// Lo que se terminó (con mínimo cargado) y no está en el pedido. Pura.
export function terminadosSinPedir({ repuestos, productos, pedidos }) {
  const abiertos = new Set((pedidos || []).filter(p => !p.comprado && p.itemId).map(p => p.itemId));
  const de = (lista, campo, origen, nombre) => (lista || [])
    .filter(x => x && x.id && x.activo !== false && Number(x.stockMin) > 0 && (Number(x[campo]) || 0) <= 0 && !abiertos.has(x.id))
    .map(x => ({ id: x.id, origen, nombre: nombre(x), cantidad: Math.max(1, Number(x.stockMin) * 2), categoria: categoriaPedido(x) }));
  return [
    ...de(repuestos, 'cantidad', 'repuesto', x => [x.tipo, x.nombre && x.nombre !== x.tipo ? x.nombre : '', x.marca, x.modelo].filter(Boolean).join(' ')),
    ...de(productos, 'stock', 'producto', x => x.nombre || 'Artículo'),
  ];
}

// Lo urgente, por tema. Pura (tests/test-parte-oficina.js).
export function armarParteOficina({ ahora, repairs, equipos, cierreAyer, anotados }) {
  const p = { caja: [], taller: [], stock: [], ventas: [] };
  if (cierreAyer === false) p.caja.push('ayer la caja no se cerró');
  (repairs || []).filter(r => r.estado === 'listo')
    .map(r => ({ r, d: dias(r.fechaListo || r.fechaIngreso, ahora), ing: dias(r.fechaIngreso, ahora) }))
    .filter(x => x.d !== null && x.d >= 7 && x.ing !== null && x.ing <= 60)
    .sort((a, b) => b.d - a.d)
    .forEach(({ r, d }) => p.taller.push(`${r.nombre ? String(r.nombre).split(' ')[0] : 'Un cliente'} no retiró su ${equipoRep(r)} (#${r.nOrden || '?'}): listo hace ${d} días`));
  if ((anotados || []).length) p.stock.push(`se terminó y lo anoté en el pedido: ${anotados.join(', ')}`);
  (equipos || []).filter(e => e && !e.vendido && !e.eliminado && !e.reservado)
    .map(e => ({ e, d: dias(e.fecha, ahora) })).filter(x => x.d !== null && x.d >= 90)
    .sort((a, b) => b.d - a.d)
    .forEach(({ e, d }) => p.ventas.push(`${[e.marca, e.modelo, e.almacenamiento].filter(Boolean).join(' ')}: ${d} días sin venderse`));
  return p;
}

const TEMAS = { caja: '💵 Caja', taller: '📱 Para retirar', stock: '📦 Stock', ventas: '🏷️ Equipos parados' };

// Lo urgente → mensaje de Telegram (HTML), o null si no hay nada que decir
export function textoParteOficina(p, dia) {
  const temas = Object.keys(TEMAS).filter(t => (p[t] || []).length);
  if (!temas.length) return null;
  const l = [`✅ <b>Para hacer hoy — ${dia.split('-').reverse().join('/')}</b>`];
  temas.forEach(t => { l.push('', `<b>${TEMAS[t]}</b>`); lista(l, p[t]); });
  return l.join('\n');
}

async function parteOficina(db) {
  const ahora = Date.now();
  const dia = hoyAR();
  const ayer = new Date(Date.parse(dia + 'T12:00:00Z') - DIA).toISOString().slice(0, 10);
  // Una vez por día: unas cientos de lecturas, lejos del cupo de 50.000
  const [lis, rpt, prod, ped, eq, cierre] = await Promise.all([
    db.collection('repairs').where('estado', '==', 'listo').get(),
    db.collection('repuestos').get(),
    db.collection('productos').get(),
    db.collection('pedidos').where('comprado', '==', false).get(),
    db.collection('stock').where('vendido', '==', false).get(),
    db.collection('caja_cierres').doc(ayer).get(),
  ]);
  const docs = s => s.docs.map(d => Object.assign({ id: d.id }, d.data()));

  // Lo que se terminó va solo al pedido. Mismo id que usa la app (auto_<id>):
  // si la app ya lo anotó, no se duplica.
  const anotados = [];
  for (const t of terminadosSinPedir({ repuestos: docs(rpt), productos: docs(prod), pedidos: docs(ped) }).slice(0, 30)) {
    try {
      const ref = db.collection('pedidos').doc('auto_' + t.id);
      const d = await ref.get();
      if (d.exists && (!d.data().comprado || ahora - Date.parse(d.data().fechaCompra || 0) < 3 * DIA)) continue;
      await ref.set({
        nombre: t.nombre, cantidad: t.cantidad, categoria: t.categoria, prioridad: 'normal', proveedor: null,
        notas: 'Se anotó solo: se terminó', itemId: t.id, itemSource: t.origen,
        createdAt: new Date().toISOString(), comprado: false, fechaCompra: null, auto: true,
      });
      anotados.push(t.nombre);
    } catch (e) { console.error('parte, auto-pedido:', e); }
  }

  const p = armarParteOficina({
    ahora, repairs: docs(lis), equipos: docs(eq), anotados,
    // domingo cerrado: ayer sin cierre un lunes no es un problema
    cierreAyer: new Date(Date.parse(ayer + 'T12:00:00Z')).getUTCDay() === 0 ? null : cierre.exists,
  });
  return { texto: textoParteOficina(p, dia), anotados: anotados.length };
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

    // El parte de la mañana va por la misma función (no sumamos otra: el
    // plan de Vercel tiene un tope de funciones)
    if (req.body && req.body.oficina) {
      const { texto, anotados } = await parteOficina(db);
      // Nada urgente: no se manda nada (un "todo bien" diario se deja de leer)
      if (!texto) return res.status(200).json({ ok: true, oficina: true, nada: true, anotados });
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      const data = await r.json();
      if (!data.ok) console.error('parte oficina:', data);
      return res.status(200).json({ ok: !!data.ok, oficina: true, anotados, error: data.ok ? undefined : data.description });
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
