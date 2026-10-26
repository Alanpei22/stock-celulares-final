// Vercel Function — POST /api/cron-resumen-telegram
// La dispara GitHub Actions a las 19:15 AR (22:15 UTC).
// Con { oficina: true }, a las 10:30 AR: el parte de la oficina (ver abajo).
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
//  🏢 El parte de la oficina (body { oficina: true }, 10:30 AR)
// ══════════════════════════════════════════════════════════════
// Los personajes de la oficina (oficina.js) avisan solo con la app abierta.
// Esto es lo mismo pero de mañana y por Telegram, aunque nadie la abra:
// cada uno firma lo suyo, y arriba la IA dice por dónde arrancar el día.
// Las reglas son una copia corta de las de oficina.js (acá no hay app):
// si cambian allá, conviene mirar acá.
const DIA = 864e5;
const PJ = { tito: '🔧 Tito', rosa: '📦 Rosa', beto: '💵 Beto', lu: '📱 Lu', marta: '🗂️ Marta' };
const dias = (iso, ahora) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? Math.floor((ahora - t) / DIA) : null; };
const equipoRep = r => [r.marca, r.modelo].filter(Boolean).join(' ') || 'Equipo';

// Hechos por personaje: { tito: ['...'], ... }. Pura (tests/test-parte-oficina.js).
export function armarParteOficina({ ahora, repairs, repuestos, productos, pedidos, equipos, cierreAyer }) {
  const p = { tito: [], rosa: [], beto: [], lu: [], marta: [] };
  const reps = (repairs || []).filter(r => { const d = dias(r.fechaIngreso, ahora); return d !== null && d <= 60; });

  const dem = reps.filter(r => r.estado === 'reparando' && dias(r.fechaIngreso, ahora) > 3)
    .sort((a, b) => String(a.fechaIngreso).localeCompare(String(b.fechaIngreso)));
  dem.forEach(r => p.tito.push(`#${r.nOrden || '?'} ${equipoRep(r)} lleva ${dias(r.fechaIngreso, ahora)} días en el taller${r.tecnico ? ' (' + r.tecnico + ')' : ''}`));
  const listas = reps.filter(r => r.estado === 'listo')
    .map(r => ({ r, d: dias(r.fechaListo || r.fechaIngreso, ahora) })).filter(x => x.d !== null && x.d >= 7)
    .sort((a, b) => b.d - a.d);
  listas.forEach(({ r, d }) => p.tito.push(`#${r.nOrden || '?'} ${equipoRep(r)} lista hace ${d} días y ${r.nombre ? String(r.nombre).split(' ')[0] : 'el cliente'} no la retiró`));
  const hoy = new Date(ahora - 3 * 3600e3).toISOString().slice(0, 10);
  (repairs || []).filter(r => r.seguimientoFecha && r.seguimientoFecha <= hoy && !r.seguimientoAck)
    .forEach(r => p.tito.push(`seguimiento pendiente: #${r.nOrden || '?'} ${equipoRep(r)}`));

  const pedidosAbiertos = new Set((pedidos || []).filter(x => !x.comprado && x.itemId).map(x => x.itemId));
  const bajo = (lista, campo, nombre) => (lista || []).filter(x => x && x.activo !== false && !pedidosAbiertos.has(x.id))
    .map(x => ({ x, c: Number(x[campo]) || 0, m: Number(x.stockMin) || 0 }))
    .filter(o => o.m > 0 && o.c <= o.m)
    .sort((a, b) => (a.c - a.m) - (b.c - b.m))
    .map(({ x, c, m }) => `${nombre(x)}: ${c <= 0 ? 'se terminó' : 'quedan ' + c} (mínimo ${m})`);
  p.rosa.push(...bajo(repuestos, 'cantidad', x => [x.tipo, x.nombre && x.nombre !== x.tipo ? x.nombre : '', x.marca, x.modelo].filter(Boolean).join(' ')));
  p.rosa.push(...bajo(productos, 'stock', x => x.nombre || 'Artículo'));
  const pend = (pedidos || []).filter(x => !x.comprado).length;
  if (pend >= 10) p.rosa.push(`el pedido al proveedor ya tiene ${pend} cosas anotadas`);

  if (cierreAyer === false) p.beto.push('ayer la caja no se cerró');

  const eqs = (equipos || []).filter(e => e && !e.vendido && !e.eliminado);
  eqs.filter(e => !e.reservado).map(e => ({ e, d: dias(e.fecha, ahora) })).filter(x => x.d !== null && x.d >= 45)
    .sort((a, b) => b.d - a.d)
    .forEach(({ e, d }) => p.lu.push(`${[e.marca, e.modelo, e.almacenamiento].filter(Boolean).join(' ')} lleva ${d} días sin venderse`));
  const sinFotos = eqs.filter(e => e.publicar === true && !(Array.isArray(e.fotos) && e.fotos.length)).length;
  if (sinFotos) p.lu.push(`${sinFotos} ${sinFotos === 1 ? 'equipo está' : 'equipos están'} en la página sin fotos`);

  // Los que retiraron ayer (día argentino)
  const diaAR = iso => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t - 3 * 3600e3).toISOString().slice(0, 10) : ''; };
  const diaAyer = new Date(ahora - 3 * 3600e3 - DIA).toISOString().slice(0, 10);
  const ayer = (repairs || []).filter(r => r.estado === 'entregado' && r.tlf && !r.devuelto && diaAR(r.fechaEntrega) === diaAyer).length;
  if (ayer) p.marta.push(`${ayer} ${ayer === 1 ? 'cliente retiró' : 'clientes retiraron'} ayer: buen momento para pedirles una reseña`);
  return p;
}

// Hechos → mensaje de Telegram (HTML). La idea de la IA va arriba si vino.
export function textoParteOficina(p, idea, dia) {
  const l = [`🏢 <b>Buen día — el parte de la oficina ${dia.split('-').reverse().join('/')}</b>`];
  if (idea && idea.length) {
    l.push('', '🧠 <b>Para arrancar:</b>');
    idea.slice(0, 3).forEach((t, i) => l.push(`${i + 1}. ${esc(t)}`));
  }
  let algo = false;
  for (const id of Object.keys(PJ)) {
    const xs = p[id] || [];
    if (!xs.length) continue;
    algo = true;
    l.push('', `<b>${PJ[id]}:</b>`);
    lista(l, xs);
  }
  if (!algo) l.push('', 'Nadie tiene nada para decirte hoy. ☕');
  l.push('', '<i>El detalle y los botones, en la app: Dashboard → 🏢 Oficina.</i>');
  return l.join('\n');
}

// La IA lee los hechos y dice las 3 cosas por las que conviene empezar. Si
// tarda o falla, el parte sale igual sin esta parte (no se pierde el aviso).
export function pedidoIdeaIA(p, dia) {
  const hechos = Object.keys(PJ).map(id => `${PJ[id]}:\n` + ((p[id] || []).slice(0, 15).map(x => '- ' + x).join('\n') || '- nada')).join('\n\n');
  return {
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    // low: es un mensaje corto de todas las mañanas, tiene que salir rápido
    output_config: { effort: 'low', format: { type: 'json_schema', schema: {
      type: 'object', additionalProperties: false, required: ['prioridades'],
      properties: { prioridades: { type: 'array', items: { type: 'string' } } },
    } } },
    fallbacks: 'default',
    system: 'Sos el encargado de TechPoint, un local de reparación y venta de celulares en Caseros (Buenos Aires). Cada mañana leés lo que avisan los personajes de la oficina y le decís al dueño, Alan, por dónde arrancar el día. Español rioplatense, directo, sin jerga. Usá solo los datos que te pasan; no inventes. Devolvé hasta 3 prioridades, cada una una frase corta (máx 120 caracteres) con la acción concreta. Si no hay nada importante, una sola diciendo que el día arranca tranquilo.',
    messages: [{ role: 'user', content: `Hoy es ${dia}. Esto avisan:\n\n${hechos}` }],
  };
}

async function ideaIA(p, dia) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), 40000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
        'anthropic-beta': 'server-side-fallback-2026-07-01' },
      body: JSON.stringify(pedidoIdeaIA(p, dia)),
    });
    const j = await r.json();
    if (!r.ok || j.stop_reason === 'refusal' || j.stop_reason === 'max_tokens') return null;
    const o = JSON.parse((j.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
    return (Array.isArray(o.prioridades) ? o.prioridades : []).map(s => String(s).slice(0, 200)).filter(Boolean);
  } catch (e) {
    console.warn('parte oficina, IA:', e.message);
    return null;
  } finally { clearTimeout(corte); }
}

async function parteOficina(db) {
  const ahora = Date.now();
  const dia = hoyAR();
  const ayer = new Date(Date.parse(dia + 'T12:00:00Z') - DIA).toISOString().slice(0, 10);
  // Una vez por día: unas cientos de lecturas, lejos del cupo de 50.000
  const [rep, lis, entr, rpt, prod, ped, eq, cierre] = await Promise.all([
    db.collection('repairs').where('estado', '==', 'reparando').get(),
    db.collection('repairs').where('estado', '==', 'listo').get(),
    db.collection('repairs').where('fechaEntrega', '>=', new Date(ahora - 2 * DIA).toISOString()).get(),
    db.collection('repuestos').get(),
    db.collection('productos').get(),
    db.collection('pedidos').where('comprado', '==', false).get(),
    db.collection('stock').where('vendido', '==', false).get(),
    db.collection('caja_cierres').doc(ayer).get(),
  ]);
  const docs = s => s.docs.map(d => Object.assign({ id: d.id }, d.data()));
  // seguimientos: los trae la consulta de reparando/listo (no se pide aparte)
  const p = armarParteOficina({
    ahora, repairs: [...docs(rep), ...docs(lis), ...docs(entr)],
    repuestos: docs(rpt), productos: docs(prod), pedidos: docs(ped), equipos: docs(eq),
    // domingo cerrado: ayer sin cierre un lunes no es un problema
    cierreAyer: new Date(Date.parse(ayer + 'T12:00:00Z')).getUTCDay() === 0 ? null : cierre.exists,
  });
  const idea = await ideaIA(p, dia);
  return { texto: textoParteOficina(p, idea, dia), conIA: !!idea };
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
      const { texto, conIA } = await parteOficina(db);
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      const data = await r.json();
      if (!data.ok) console.error('parte oficina:', data);
      return res.status(200).json({ ok: !!data.ok, oficina: true, conIA, error: data.ok ? undefined : data.description });
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
