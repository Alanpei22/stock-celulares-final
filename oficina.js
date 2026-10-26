// ══════════════════════════════════════════════════════════════
// 🏢 La oficina — personajes que vigilan el local y te avisan
// ══════════════════════════════════════════════════════════════
// Tercera vista del Dashboard (📊 Números · 🔧 Taller · 🏢 Oficina). Cada
// personaje tiene un rol, mira su parte de la app y, cuando encuentra algo,
// te lo dice con un globito: un aviso o una pregunta con botones para
// resolverlo de un toque.
//
//   🔧 Tito  · Taller  → demoradas, listas sin retirar, seguimientos…
//   📦 Rosa  · Stock   → repuestos y accesorios bajo el mínimo, al pedido
//   💵 Beto  · Caja    → apertura, chequeo, cierre, tarjetas, costos
//
// ── Cómo está armado ──────────────────────────────────────────
// OFICINA_PJ es la lista de personajes. Cada uno tiene `revisar(ctx)`, una
// función PURA: recibe los datos (ctx) y devuelve hallazgos
//   { clave, nivel: 'info'|'aviso'|'urgente', texto, acciones: [{ txt, fn }] }
// Sin Firestore adentro: así se prueban solos (tests/test-oficina.js) y
// sumar un personaje es agregar uno más a la lista.
//
// ── Lo que se cuida ───────────────────────────────────────────
// · CUPO: se reusan los datos que la app ya tiene (reparaciones, stock,
//   repuestos). Lo nuevo: la caja de HOY (apertura, cierre, movimientos),
//   leída una vez cada 5 minutos y solo mientras se mira la oficina.
// · Datos sin cargar: el personaje dice "Revisando…", no "todo en orden".
// · Volumen: pocos avisos por tipo; el resto va en "y N más".
// · "Más tarde" pospone (en este dispositivo) y vuelve si sigue el problema.
// · Si una cuenta no puede leer algo (reglas), ese aviso no aparece.
// · Nada de "piensa con IA" por ahora: reglas fijas, gratis e instantáneas.
'use strict';

const OF_APERTURA = '10:00';   // desde esta hora Beto reclama el arqueo
const OF_CIERRE = '19:30';     // el local cierra sí o sí
const OF_DIAS_VIEJA = 60;      // más vieja que esto no se trata una por una
const OF_MAX_POR_TIPO = 5;

// ── Utilidades ────────────────────────────────────────────────
function _ofEsc(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function _ofHoyAR(ms) { return new Date((ms || Date.now()) - 3 * 3600e3).toISOString().slice(0, 10); }
function _ofHoraAR(ms) { return new Date((ms || Date.now()) - 3 * 3600e3).toISOString().slice(11, 16); }
function _ofDias(iso, ahora) { const t = iso ? new Date(iso).getTime() : 0; return t ? Math.floor(((ahora || Date.now()) - t) / 86400e3) : null; }
function _ofEquipo(r) { return [r.marca, r.modelo].filter(Boolean).join(' ') || 'Equipo'; }
function _ofPlata(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR'); }
function _ofPlural(n, uno, varios) { return n === 1 ? uno : varios; }

// Corta una lista larga: los primeros N y un resumen con el resto
function _ofTope(items, resumen) {
  if (items.length <= OF_MAX_POR_TIPO) return items;
  const resto = items.length - OF_MAX_POR_TIPO;
  return items.slice(0, OF_MAX_POR_TIPO).concat(resumen ? [resumen(resto)] : []);
}

// ══════════════════════════════════════════════════════════════
//  Los personajes
// ══════════════════════════════════════════════════════════════

// 🔧 Tito — jefe de taller
function revisarTito(ctx) {
  const ahora = ctx.ahora || Date.now();
  const reps = Array.isArray(ctx.repairs) ? ctx.repairs : [];
  const out = [];
  const reciente = r => { const d = _ofDias(r.fechaIngreso, ahora); return d !== null && d <= OF_DIAS_VIEJA; };
  const demorada = r => (typeof ctx.demorada === 'function') ? ctx.demorada(r)
    : (r.estado === 'reparando' && _ofDias(r.fechaIngreso, ahora) > 3);
  const verRep = r => ({ txt: 'Ver orden', fn: 'repair', id: r.id });
  const irRep = { txt: 'Ver en Reparaciones', fn: 'seccion', id: 'repairs' };

  // Demoradas: lo más urgente del taller
  const dem = reps.filter(r => r.estado === 'reparando' && reciente(r) && demorada(r))
    .sort((a, b) => String(a.fechaIngreso).localeCompare(String(b.fechaIngreso)));
  out.push(..._ofTope(dem.map(r => {
    const d = _ofDias(r.fechaIngreso, ahora);
    return {
      clave: 'tito:dem:' + r.id, nivel: d > 7 ? 'urgente' : 'aviso',
      texto: `La #${r.nOrden || '?'} (${_ofEquipo(r)}${r.arreglo ? ' · ' + r.arreglo : ''}) lleva ${d} días en el taller${r.tecnico ? ', la tiene ' + r.tecnico : ''}. ¿Qué le falta?`,
      acciones: [verRep(r)],
    };
  }), n => ({ clave: 'tito:dem:resto', nivel: 'aviso', texto: `Y ${n} demoradas más.`, acciones: [irRep] })));

  // Listas que el cliente no vino a buscar
  const sinRetirar = reps.filter(r => r.estado === 'listo' && reciente(r))
    .map(r => ({ r, d: _ofDias(r.fechaListo || (typeof ctx.desde === 'function' ? ctx.desde(r) : r.fechaIngreso), ahora) }))
    .filter(x => x.d !== null && x.d >= 7)
    .sort((a, b) => b.d - a.d);
  out.push(..._ofTope(sinRetirar.map(({ r, d }) => ({
    clave: 'tito:retiro:' + r.id, nivel: d >= 20 ? 'aviso' : 'info',
    texto: `La #${r.nOrden || '?'} (${_ofEquipo(r)}) está lista hace ${d} días y ${r.nombre || 'el cliente'} no la retiró. ¿Le mando un recordatorio?`,
    acciones: r.tlf ? [{ txt: '🟢 Mandar WhatsApp', fn: 'waRepair', id: r.id, posponer: 72 }, verRep(r)] : [verRep(r)],
  })), n => ({ clave: 'tito:retiro:resto', nivel: 'info', texto: `Y ${n} listas más sin retirar.`, acciones: [irRep] })));

  // Seguimientos que vencieron (llamar al cliente)
  const hoy = _ofHoyAR(ahora);
  reps.filter(r => r.seguimientoFecha && r.seguimientoFecha <= hoy && !r.seguimientoAck).slice(0, OF_MAX_POR_TIPO)
    .forEach(r => out.push({
      clave: 'tito:seg:' + r.id, nivel: 'aviso',
      texto: `Quedaste en hacerle un seguimiento a ${r.nombre || 'un cliente'} por la #${r.nOrden || '?'} (${_ofEquipo(r)}).`,
      acciones: [verRep(r)],
    }));

  // Equipos en el banco sin técnico asignado (más de un día)
  const sinTec = reps.filter(r => r.estado === 'reparando' && reciente(r) && !r.tecnico && _ofDias(r.fechaIngreso, ahora) >= 1);
  if (sinTec.length) out.push({
    clave: 'tito:sintec', nivel: 'info',
    texto: `${sinTec.length} ${_ofPlural(sinTec.length, 'equipo está', 'equipos están')} en el taller sin técnico asignado. Así no sé de quién es cada uno.`,
    acciones: [irRep],
  });

  // Órdenes de hace mucho que nunca se cerraron: un solo aviso, no cien
  const viejas = reps.filter(r => (r.estado === 'reparando' || r.estado === 'listo') && !reciente(r));
  if (viejas.length) out.push({
    clave: 'tito:viejas', nivel: 'info',
    texto: `Hay ${viejas.length} ${_ofPlural(viejas.length, 'orden abierta', 'órdenes abiertas')} de hace más de ${OF_DIAS_VIEJA} días. Si ya se fueron, conviene cerrarlas: inflan las listas y los números.`,
    acciones: [irRep],
  });
  return out;
}

// Categoría del pedido según el tipo de repuesto / accesorio
function _ofCategoriaPedido(x) {
  const t = String((x && (x.tipo || x.categoria)) || '').toLowerCase();
  const tabla = [['módulo', 'Módulo'], ['modulo', 'Módulo'], ['pantalla', 'Pantalla'], ['bater', 'Batería'], ['cargador', 'Cargador'],
    ['cable', 'Cable'], ['auricular', 'Auricular'], ['funda', 'Funda'], ['vidrio', 'Vidrio templado / Hidrogel'], ['hidrogel', 'Vidrio templado / Hidrogel'],
    ['conector', 'Conector'], ['pin', 'Conector'], ['flex', 'Flex'], ['cámara', 'Cámara'], ['camara', 'Cámara'], ['parlante', 'Parlante'],
    ['micr', 'Micrófono'], ['marco', 'Marco']];
  const hit = tabla.find(([k]) => t.includes(k));
  return hit ? hit[1] : 'Otro';
}

// 📦 Rosa — depósito
function revisarRosa(ctx) {
  const out = [];
  const pedidosAbiertos = new Set((Array.isArray(ctx.pedidos) ? ctx.pedidos : [])
    .filter(p => !p.comprado && p.itemId).map(p => p.itemId));
  const revisarLista = (lista, origen, campo) => {
    if (!Array.isArray(lista)) return [];
    return lista.filter(x => x && x.activo !== false)
      .map(x => ({ x, cant: Number(x[campo]) || 0, min: Number(x.stockMin) || 0 }))
      .filter(o => o.cant < 0 || (o.min > 0 && o.cant <= o.min))
      .filter(o => !pedidosAbiertos.has(o.x.id))
      .sort((a, b) => (a.cant - a.min) - (b.cant - b.min))
      .map(({ x, cant, min }) => {
        const nombre = origen === 'repuesto'
          ? [x.tipo, x.nombre && x.nombre !== x.tipo ? x.nombre : '', x.marca, x.modelo].filter(Boolean).join(' ')
          : (x.nombre || 'Artículo');
        const pedir = Math.max(1, min * 2 - Math.max(0, cant));
        if (cant < 0) return {
          clave: `rosa:neg:${x.id}`, nivel: 'urgente',
          texto: `«${nombre}» figura con ${cant}: no puede haber menos de cero. Hay que contarlo de nuevo.`,
          acciones: [{ txt: 'Ver', fn: origen === 'repuesto' ? 'repuesto' : 'accesorios', id: x.id }],
        };
        return {
          clave: `rosa:min:${x.id}`, nivel: cant <= 0 ? 'urgente' : 'aviso',
          texto: cant <= 0
            ? `Se terminó «${nombre}» (el mínimo es ${min}). ¿Lo pongo en el pedido?`
            : `${_ofPlural(cant, 'Queda', 'Quedan')} ${cant} de «${nombre}» y el mínimo es ${min}. ¿Pido ${pedir}?`,
          acciones: [
            { txt: `🛒 Pedir ${pedir}`, fn: 'pedido', id: x.id, origen, nombre, cantidad: pedir, categoria: _ofCategoriaPedido(x), posponer: 1 },
            { txt: 'Ver', fn: origen === 'repuesto' ? 'repuesto' : 'accesorios', id: x.id },
          ],
        };
      });
  };
  const rep = revisarLista(ctx.repuestos, 'repuesto', 'cantidad');
  const acc = revisarLista(ctx.productos, 'accesorio', 'stock');
  out.push(..._ofTope(rep, n => ({ clave: 'rosa:rep:resto', nivel: 'aviso', texto: `Y ${n} repuestos más bajo el mínimo.`, acciones: [{ txt: 'Ver repuestos', fn: 'seccion', id: 'repuestos' }] })));
  out.push(..._ofTope(acc, n => ({ clave: 'rosa:acc:resto', nivel: 'aviso', texto: `Y ${n} accesorios más bajo el mínimo.`, acciones: [{ txt: 'Ver accesorios', fn: 'accesorios' }] })));

  const pendientes = (Array.isArray(ctx.pedidos) ? ctx.pedidos : []).filter(p => !p.comprado).length;
  if (pendientes >= 10) out.push({
    clave: 'rosa:pedido', nivel: 'info',
    texto: `El pedido ya tiene ${pendientes} cosas anotadas. ¿Se lo mandamos al proveedor?`,
    acciones: [{ txt: '📋 Ver el pedido', fn: 'verPedido' }],
  });
  return out;
}

// 💵 Beto — caja
function revisarBeto(ctx) {
  const out = [];
  const ahora = ctx.ahora || Date.now();
  const hora = _ofHoraAR(ahora);
  const caja = ctx.caja || {};
  const movs = Array.isArray(caja.movs) ? caja.movs : [];
  const ingresos = movs.filter(m => m.tipo === 'ingreso');
  const irCaja = (action) => ({ txt: '💵 Ir a la caja', fn: 'caja', id: action || '' });

  // Apertura: después de las 10 y todavía sin arqueo
  if (caja.arqueo === false && hora >= OF_APERTURA && hora < OF_CIERRE) out.push({
    clave: 'beto:apertura:' + _ofHoyAR(ahora), nivel: 'aviso',
    texto: `Son las ${hora} y la caja todavía no se abrió (falta el arqueo de apertura).`,
    acciones: [irCaja('arqueo')],
  });
  // Cierre: pasadas las 19:30, con la caja abierta y sin cerrar
  if (caja.arqueo === true && caja.cierre === false && hora >= OF_CIERRE) out.push({
    clave: 'beto:cierre:' + _ofHoyAR(ahora), nivel: 'urgente',
    texto: `Ya son las ${hora}: falta cerrar la caja del día.`,
    acciones: [irCaja('cierre')],
  });
  // Chequeo obligatorio pendiente (chequeo.js)
  if (ctx.chequeoPendiente) out.push({
    clave: 'beto:chq:' + _ofHoyAR(ahora) + ':' + ctx.chequeoPendiente, nivel: 'aviso',
    texto: `Falta el chequeo de caja de las ${ctx.chequeoPendiente}.`,
    acciones: [irCaja('')],
  });
  // Tarjetas: sin la comisión cargada, la ganancia sale inflada
  const conTarjeta = ingresos.filter(m => /tarjeta/i.test(m.metodoPago || '') || /tarjeta/i.test(m.metodoPago2 || ''));
  const cfg = ctx.tarjetas || {};
  if (conTarjeta.length && !(cfg.debito > 0) && !(cfg.credito > 0)) out.push({
    clave: 'beto:getnet-cfg', nivel: 'aviso',
    texto: 'Hoy se cobró con tarjeta pero no está cargada la comisión de Getnet: la ganancia de esas ventas sale más alta de lo que es. Se carga en 💳 del menú de la caja (modo dueño).',
    acciones: [irCaja('')],
  });
  // Lo que deposita Getnet hoy (solo a quien puede ver la plata)
  const com = ingresos.reduce((s, m) => s + (Number(m.comisionTarjeta) || 0), 0);
  if (com > 0 && ctx.verPlata) {
    const neto = ingresos.reduce((s, m) => s + (Number(m.netoTarjeta) || 0), 0);
    out.push({
      clave: 'beto:getnet:' + _ofHoyAR(ahora) + ':' + Math.round(neto), nivel: 'info',
      texto: `Con tarjeta, Getnet te va a depositar ${_ofPlata(neto)} de lo de hoy (se queda ${_ofPlata(com)}).`,
      acciones: [],
    });
  }
  // Ventas de equipos sin costo: no se sabe cuánto se ganó
  const sinCosto = ingresos.filter(m => m.sinCosto);
  if (sinCosto.length) out.push({
    clave: 'beto:sincosto:' + _ofHoyAR(ahora) + ':' + sinCosto.length, nivel: 'aviso',
    texto: `${sinCosto.length} ${_ofPlural(sinCosto.length, 'venta de equipo de hoy no tiene', 'ventas de equipos de hoy no tienen')} el costo cargado: no se sabe cuánto se ganó.`,
    acciones: [{ txt: 'Ver equipos', fn: 'seccion', id: 'stock' }],
  });
  return out;
}

// El elenco. Para sumar a alguien: un objeto más acá (y su dibujo).
const OFICINA_PJ = [
  { id: 'tito', nombre: 'Tito', rol: 'Taller', color: '#2563eb', piel: '#f1c27d', pelo: '#3b2a1a', alfombra: '#a7f3d0',
    listo: ctx => ctx.repairsListas, revisar: revisarTito, tranquilo: 'El taller está al día 👌',
    mira: 'Demoradas, listas sin retirar, seguimientos y órdenes viejas' },
  { id: 'rosa', nombre: 'Rosa', rol: 'Stock', color: '#16a34a', piel: '#e0ac69', pelo: '#7c2d12', alfombra: '#ddd6fe',
    listo: ctx => ctx.stockListo, revisar: revisarRosa, tranquilo: 'Nada por pedir 👌',
    mira: 'Repuestos y accesorios bajo el mínimo, y el pedido al proveedor' },
  { id: 'beto', nombre: 'Beto', rol: 'Caja', color: '#d97706', piel: '#c68642', pelo: '#111827', alfombra: '#fed7aa',
    listo: ctx => ctx.cajaLista, revisar: revisarBeto, tranquilo: 'La caja está en orden 👌',
    mira: 'Apertura, chequeo y cierre de caja, tarjetas y ventas sin costo' },
];

// ══════════════════════════════════════════════════════════════
//  "Más tarde" (en este dispositivo)
// ══════════════════════════════════════════════════════════════
function _ofPospuestos() {
  try {
    const o = JSON.parse(localStorage.getItem('oficinaPosp') || '{}') || {};
    const ahora = Date.now();
    Object.keys(o).forEach(k => { if (!(o[k] > ahora)) delete o[k]; });
    return o;
  } catch { return {}; }
}
function oficinaPosponer(clave, horas) {
  const o = _ofPospuestos();
  o[clave] = Date.now() + (horas || 4) * 3600e3;
  try { localStorage.setItem('oficinaPosp', JSON.stringify(o)); } catch {}
  oficinaRender();
}

// Todo junto, ya filtrado: [{ pj, items, revisando }]
function oficinaHallazgos(ctx) {
  const posp = _ofPospuestos();
  return OFICINA_PJ.map(pj => {
    if (!pj.listo(ctx)) return { pj, items: [], revisando: true };
    let items = [];
    try { items = pj.revisar(ctx) || []; } catch (e) { console.warn('[oficina] ' + pj.id, e); }
    return { pj, items: items.filter(h => !posp[h.clave]), revisando: false };
  });
}

// ══════════════════════════════════════════════════════════════
//  Datos (lo que la app ya tiene + la caja de hoy)
// ══════════════════════════════════════════════════════════════
let _ofCaja = { leida: 0, arqueo: null, cierre: null, movs: [] };
let _ofVisible = false;
let _ofTimer = null;
let _ofFiltro = '';

function _ofCtx() {
  const g = n => (typeof window !== 'undefined' && Array.isArray(window[n])) ? window[n] : undefined;
  const reps = (typeof REPAIRS !== 'undefined' && Array.isArray(REPAIRS)) ? REPAIRS : [];
  const repuestos = (typeof REPUESTOS !== 'undefined' && Array.isArray(REPUESTOS)) ? REPUESTOS : null;
  const productos = (typeof vaLista === 'function') ? vaLista() : g('PRODUCTOS');
  const pedidos = (typeof PEDIDOS !== 'undefined' && Array.isArray(PEDIDOS)) ? PEDIDOS : [];
  return {
    ahora: Date.now(),
    repairs: reps,
    repairsListas: (typeof _repairsLoaded !== 'undefined') ? !!_repairsLoaded : reps.length > 0,
    demorada: (typeof _repDemorado === 'function') ? _repDemorado : null,
    desde: (typeof tpDesde === 'function') ? tpDesde : null,
    repuestos, productos, pedidos,
    stockListo: !!(repuestos && repuestos.length) || !!(productos && productos.length),
    caja: _ofCaja,
    cajaLista: _ofCaja.leida > 0,
    tarjetas: (typeof tarjetaCfg === 'function') ? tarjetaCfg() : {},
    chequeoPendiente: (typeof _chqPendiente === 'function') ? (() => { try { return _chqPendiente(); } catch { return null; } })() : null,
    verPlata: (typeof tpPuede === 'function') ? tpPuede('totales') : true,
  };
}

// La caja de hoy: apertura, cierre y movimientos. Una vez cada 5 minutos,
// solo con la oficina a la vista. Si las reglas no dejan, queda en "no sé".
async function _ofLeerCaja() {
  if (typeof db === 'undefined' || !db) return;
  if (Date.now() - _ofCaja.leida < 5 * 60e3) return;
  const hoy = _ofHoyAR();
  const existe = ref => ref.get().then(d => d.exists).catch(() => null);
  const key = hoy + '|' + hoy;
  const movsCache = (typeof _dashCache !== 'undefined' && _dashCache[key]) ? _dashCache[key] : null;
  const [arqueo, cierre, movs] = await Promise.all([
    existe(db.collection('caja_arqueos').doc(hoy)),
    existe(db.collection('caja_cierres').doc(hoy)),
    movsCache ? Promise.resolve(movsCache)
      : db.collection('caja_movimientos').where('fecha', '==', hoy).get().then(s => s.docs.map(d => d.data())).catch(() => []),
  ]);
  _ofCaja = { leida: Date.now(), arqueo, cierre, movs: movs || [] };
}

// Abre los listeners que Rosa necesita (los mismos que al entrar a esas
// secciones: no hay lecturas extra si ya estaban abiertos).
function _ofAbrirFuentes() {
  if (typeof listenRepuestos === 'function') try { listenRepuestos(); } catch {}
  if (typeof vaAsegurarProductos === 'function') try { vaAsegurarProductos(); } catch {}
  if (typeof listenPedidos === 'function') try { listenPedidos(); } catch {}
}

// ══════════════════════════════════════════════════════════════
//  Acciones de los botones
// ══════════════════════════════════════════════════════════════
const _ofAccionesVivas = {};
async function oficinaAccion(clave, i) {
  const a = (_ofAccionesVivas[clave] || [])[i];
  if (!a) return;
  try {
    if (a.fn === 'repair' && typeof openRepairDetail === 'function') openRepairDetail(a.id);
    else if (a.fn === 'seccion' && typeof switchSection === 'function') switchSection(a.id);
    else if (a.fn === 'waRepair' && typeof repairWhatsApp === 'function') repairWhatsApp(a.id);
    else if (a.fn === 'repuesto') { if (typeof switchSection === 'function') switchSection('repuestos'); setTimeout(() => (typeof openRepuestoForm === 'function') && openRepuestoForm(a.id), 300); }
    else if (a.fn === 'accesorios') location.href = 'caja.html?tab=inventario';
    else if (a.fn === 'caja') location.href = 'caja.html' + (a.id ? '?action=' + a.id : '');
    else if (a.fn === 'verPedido' && typeof openPedidosModal === 'function') openPedidosModal();
    else if (a.fn === 'pedido') {
      await db.collection('pedidos').add({
        nombre: a.nombre, cantidad: a.cantidad, categoria: a.categoria || 'Otro', prioridad: 'normal',
        proveedor: null, notas: 'Lo agregó Rosa (🏢 Oficina)', itemId: a.id, itemSource: a.origen === 'repuesto' ? 'repuesto' : 'producto',
        createdAt: new Date().toISOString(), comprado: false,
      });
      if (typeof toast === 'function') toast(`🛒 Rosa anotó ${a.cantidad} × ${a.nombre} en el pedido`, 'success');
    }
    // Lo que ya se resolvió con el botón no vuelve a molestar por un rato
    if (a.posponer) oficinaPosponer(clave, a.posponer);
  } catch (e) {
    console.error('[oficina] acción:', e);
    if (typeof toast === 'function') toast('No se pudo hacer', 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  El dibujo
// ══════════════════════════════════════════════════════════════
// Escena vista de frente, cada uno en su escritorio sobre su alfombra.
// Cada personaje tiene algo propio: Tito la gorra y la llave, Rosa la
// colita y las cajas, Beto los anteojos y la caja registradora.
function _ofPersonajeSvg(pj, x, estado, cuenta, globo, compacto) {
  const y = 70;
  const extra = {
    tito: `<path d="M${x - 24} ${y + 18} q24 -26 48 0 v-4 h8 v6 h-56 z" fill="${pj.color}"/>
           <g transform="translate(${x + 52} ${y + 118}) rotate(-30)"><rect x="-3" y="0" width="6" height="26" rx="2" fill="#94a3b8"/><circle cx="0" cy="-2" r="7" fill="none" stroke="#94a3b8" stroke-width="5"/></g>`,
    rosa: `<circle cx="${x + 24}" cy="${y + 24}" r="10" fill="${pj.pelo}"/>
           <rect x="${x - 98}" y="${y + 92}" width="34" height="28" rx="3" fill="#d6a46b"/><rect x="${x - 92}" y="${y + 66}" width="26" height="26" rx="3" fill="#e2b77f"/>
           <path d="M${x - 98} ${y + 104} h34 M${x - 92} ${y + 78} h26" stroke="#b07d45" stroke-width="2"/>`,
    beto: `<g fill="none" stroke="#111827" stroke-width="2.5"><circle cx="${x - 8}" cy="${y + 34}" r="6"/><circle cx="${x + 8}" cy="${y + 34}" r="6"/><path d="M${x - 2} ${y + 34} h4"/></g>
           <rect x="${x + 40}" y="${y + 98}" width="34" height="22" rx="4" fill="#475569"/><rect x="${x + 44}" y="${y + 90}" width="26" height="10" rx="2" fill="#22c55e"/>`,
  }[pj.id] || '';
  const tono = estado === 'urgente' ? '#ef4444' : estado === 'aviso' ? '#f59e0b' : estado === 'revisando' ? '#94a3b8' : '#22c55e';
  const texto = _ofEsc(String(globo || '').length > 34 ? String(globo).slice(0, 33) + '…' : globo || '');
  return `<g class="of-pj of-pj--${estado}" data-pj="${pj.id}" onclick="oficinaFiltrar('${pj.id}')" role="button" tabindex="0" aria-label="${_ofEsc(pj.nombre)}, ${_ofEsc(pj.rol)}">
    <ellipse cx="${x}" cy="${y + 150}" rx="128" ry="34" fill="${pj.alfombra}" opacity=".55"/>
    <g class="of-cuerpo">
      <rect x="${x - 28}" y="${y + 50}" width="56" height="58" rx="18" fill="${pj.color}"/>
      <circle cx="${x}" cy="${y + 32}" r="24" fill="${pj.piel}"/>
      <path d="M${x - 24} ${y + 28} q4 -26 24 -26 q20 0 24 26 q-10 -12 -24 -12 q-14 0 -24 12 z" fill="${pj.pelo}"/>
      <circle cx="${x - 8}" cy="${y + 34}" r="2.6" fill="#1f2937"/><circle cx="${x + 8}" cy="${y + 34}" r="2.6" fill="#1f2937"/>
      <path d="M${x - 7} ${y + 44} q7 ${estado === 'urgente' ? -4 : 5} 14 0" stroke="#7c2d12" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      ${extra}
    </g>
    <rect x="${x - 86}" y="${y + 108}" width="172" height="14" rx="4" fill="#b45309"/>
    <rect x="${x - 80}" y="${y + 122}" width="10" height="34" fill="#92400e"/><rect x="${x + 70}" y="${y + 122}" width="10" height="34" fill="#92400e"/>
    <rect x="${x - 22}" y="${y + 84}" width="44" height="26" rx="3" fill="#1e293b"/><rect x="${x - 6}" y="${y + 108}" width="12" height="4" fill="#1e293b"/>
    <g class="of-globo${estado === 'urgente' ? ' of-globo--late' : ''}">
      ${compacto
        // En el celu la escena se achica: el globito dice solo cuántas cosas
        // tiene, en grande (el detalle está en la lista de abajo)
        ? `<rect x="${x - 70}" y="${y - 66}" width="140" height="52" rx="16" fill="#fff" stroke="${tono}" stroke-width="4"/>
           <text x="${x}" y="${y - 30}" text-anchor="middle" class="of-globo-txt of-globo-txt--grande">${estado === 'revisando' ? '…' : cuenta ? '💬 ' + cuenta : '☕'}</text>`
        : `<rect x="${x - 110}" y="${y - 54}" width="220" height="40" rx="12" fill="#fff" stroke="${tono}" stroke-width="3"/>
           <text x="${x}" y="${y - 28}" text-anchor="middle" class="of-globo-txt">${texto}</text>
           ${cuenta ? `<circle cx="${x + 108}" cy="${y - 52}" r="15" fill="${tono}"/><text x="${x + 108}" y="${y - 46}" text-anchor="middle" class="of-cuenta">${cuenta}</text>` : ''}`}
      <path d="M${x - 8} ${y - 15} l8 12 l8 -12 z" fill="#fff" stroke="${tono}" stroke-width="3" stroke-linejoin="round"/>
      <rect x="${x - 10}" y="${y - 18}" width="20" height="6" fill="#fff"/>
    </g>
    <rect x="${x - (compacto ? 80 : 66)}" y="${y + 160}" width="${compacto ? 160 : 132}" height="${compacto ? 40 : 30}" rx="${compacto ? 20 : 15}" fill="#0f172a" opacity=".85"/>
    <circle cx="${x - (compacto ? 58 : 48)}" cy="${y + (compacto ? 180 : 175)}" r="${compacto ? 8 : 6}" fill="${tono}"/>
    <text x="${x + 8}" y="${y + (compacto ? 189 : 181)}" text-anchor="middle" class="of-nombre${compacto ? ' of-nombre--grande' : ''}">${_ofEsc(pj.nombre)}${compacto ? '' : ' · ' + _ofEsc(pj.rol)}</text>
  </g>`;
}

function _ofEscenaSvg(grupos, compacto) {
  const ancho = 300 * grupos.length;
  const pjs = grupos.map((g, i) => {
    const nivel = g.revisando ? 'revisando'
      : g.items.some(h => h.nivel === 'urgente') ? 'urgente'
      : g.items.some(h => h.nivel === 'aviso') ? 'aviso'
      : g.items.length ? 'info' : 'ok';
    const globo = g.revisando ? 'Revisando…'
      : g.items.length ? (g.items.length === 1 ? 'Tengo algo para vos' : `Tengo ${g.items.length} cosas`) : g.pj.tranquilo;
    return _ofPersonajeSvg(g.pj, 150 + i * 300, nivel, g.items.length, globo, compacto);
  }).join('');
  return `<svg class="of-escena" viewBox="0 0 ${ancho} 280" preserveAspectRatio="xMidYMid meet" role="img" aria-label="La oficina">
    <defs><pattern id="of-piso" width="60" height="280" patternUnits="userSpaceOnUse"><rect width="60" height="280" fill="#c2763a"/><rect width="2" height="280" fill="#a8622e"/></pattern></defs>
    <rect width="${ancho}" height="280" fill="url(#of-piso)" rx="16"/>
    <rect width="${ancho}" height="18" fill="#e2e8f0" rx="8"/>
    ${pjs}
  </svg>`;
}

// ══════════════════════════════════════════════════════════════
//  Render
// ══════════════════════════════════════════════════════════════
function oficinaFiltrar(id) { _ofFiltro = _ofFiltro === id ? '' : id; oficinaRender(); }

function oficinaRender() {
  const cont = document.getElementById('d-oficina');
  if (!cont || !_ofVisible) return;
  _ofEstilos();
  const compacto = (cont.clientWidth || (typeof innerWidth === 'number' ? innerWidth : 1000)) < 700;
  const grupos = oficinaHallazgos(_ofCtx());
  const total = grupos.reduce((s, g) => s + g.items.length, 0);
  const urg = grupos.reduce((s, g) => s + g.items.filter(h => h.nivel === 'urgente').length, 0);
  const orden = { urgente: 0, aviso: 1, info: 2 };
  const lista = grupos.filter(g => !_ofFiltro || g.pj.id === _ofFiltro)
    .flatMap(g => g.items.map(h => ({ h, pj: g.pj })))
    .sort((a, b) => (orden[a.h.nivel] - orden[b.h.nivel]));
  Object.keys(_ofAccionesVivas).forEach(k => delete _ofAccionesVivas[k]);
  lista.forEach(({ h }) => { _ofAccionesVivas[h.clave] = h.acciones || []; });
  const quien = (typeof tpUsuario === 'function' && tpUsuario()) ? tpUsuario().nombre : '';
  cont.innerHTML = `
    <div class="of-cab">
      <div><b>🏢 La oficina</b><span>${quien ? 'Hola ' + _ofEsc(quien) + ' · ' : ''}${total
        ? `${total} ${_ofPlural(total, 'cosa', 'cosas')} para vos${urg ? ` · <em>${urg} ${_ofPlural(urg, 'urgente', 'urgentes')}</em>` : ''}`
        : 'todo en orden'}</span></div>
      <div class="of-chips">
        <button type="button" class="${_ofFiltro ? '' : 'sel'}" onclick="oficinaFiltrar('')">Todos</button>
        ${grupos.map(g => `<button type="button" class="${_ofFiltro === g.pj.id ? 'sel' : ''}" onclick="oficinaFiltrar('${g.pj.id}')"><i style="background:${g.pj.color}"></i>${_ofEsc(g.pj.nombre)}${g.items.length ? ` <b>${g.items.length}</b>` : ''}</button>`).join('')}
      </div>
    </div>
    <div class="of-cuerpo-grid">
      <div class="of-escena-wrap">${_ofEscenaSvg(grupos, compacto)}
        <div class="of-roles">${OFICINA_PJ.map(pj => `<div><span class="of-ava" style="background:${pj.color}">${_ofEsc(pj.nombre[0])}</span><b>${_ofEsc(pj.nombre)}</b> · ${_ofEsc(pj.rol)}<small>${_ofEsc(pj.mira || '')}</small></div>`).join('')}</div>
      </div>
      <div class="of-lista">
        ${lista.length ? lista.map(({ h, pj }) => `
          <div class="of-item of-item--${h.nivel}">
            <div class="of-item-cab"><span class="of-ava" style="background:${pj.color}">${_ofEsc(pj.nombre[0])}</span>
              <b>${_ofEsc(pj.nombre)}</b><span class="of-rol">${_ofEsc(pj.rol)}</span>
              ${h.nivel === 'urgente' ? '<span class="of-tag">urgente</span>' : ''}</div>
            <p>${_ofEsc(h.texto)}</p>
            <div class="of-acc">
              ${(h.acciones || []).map((a, i) => `<button type="button" onclick="oficinaAccion('${_ofEsc(h.clave)}', ${i})">${_ofEsc(a.txt)}</button>`).join('')}
              <button type="button" class="of-luego" onclick="oficinaPosponer('${_ofEsc(h.clave)}', 4)" title="Que no lo diga por 4 horas">⏰ Más tarde</button>
            </div>
          </div>`).join('')
        : `<p class="of-vacio">${grupos.some(g => g.revisando) ? 'Revisando…' : 'Nadie tiene nada para decirte. ☕'}</p>`}
      </div>
    </div>`;
}

function oficinaMostrar() {
  _ofVisible = true;
  _ofEstilos();
  _ofAbrirFuentes();
  oficinaRender();
  _ofLeerCaja().then(oficinaRender).catch(() => {});
  if (!_ofTimer) _ofTimer = setInterval(() => { _ofLeerCaja().then(oficinaRender).catch(() => {}); }, 60000);
}
function oficinaDejar() {
  _ofVisible = false;
  if (_ofTimer) { clearInterval(_ofTimer); _ofTimer = null; }
}
function oficinaActiva() { return _ofVisible; }

// ── Estilos (viajan con el JS: ver la nota en taller.js) ──
function _ofEstilos() {
  if (typeof document === 'undefined' || document.getElementById('of-estilos')) return;
  const st = document.createElement('style');
  st.id = 'of-estilos';
  st.textContent = `
#dash-section .d-oficina { display: none; }
#dash-section.modo-oficina .dash-body > *:not(.d-topbar):not(.d-oficina) { display: none !important; }
#dash-section.modo-oficina .d-oficina { display: block; }
.d-oficina .of-cab { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin: 4px 0 12px; }
.d-oficina .of-cab b { font-size: 22px; margin-right: 10px; }
.d-oficina .of-cab span { color: var(--d-mut); }
.d-oficina .of-cab em { color: var(--d-red); font-style: normal; font-weight: 700; }
.d-oficina .of-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.d-oficina .of-chips button { background: var(--d-card); color: var(--d-tx); border: 1px solid var(--d-bd); border-radius: 999px; padding: 6px 12px; cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
.d-oficina .of-chips button.sel { border-color: var(--d-cyan); color: var(--d-cyan); }
.d-oficina .of-chips i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.d-oficina .of-chips b { background: var(--d-bd-2); border-radius: 999px; padding: 0 6px; font-size: 12px; }
.d-oficina .of-cuerpo-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 14px; align-items: start; }
@media (max-width: 900px) { .d-oficina .of-cuerpo-grid { grid-template-columns: 1fr; } }
.d-oficina .of-escena { width: 100%; height: auto; display: block; }
.d-oficina .of-pj { cursor: pointer; }
.d-oficina .of-globo-txt { font: 600 15px system-ui, sans-serif; fill: #0f172a; }
.d-oficina .of-cuenta { font: 800 15px system-ui, sans-serif; fill: #fff; }
.d-oficina .of-nombre { font: 700 14px system-ui, sans-serif; fill: #fff; }
.d-oficina .of-nombre--grande { font-size: 24px; }
.d-oficina .of-globo-txt--grande { font-size: 30px; font-weight: 800; }
.d-oficina .of-roles { display: grid; gap: 6px; margin-top: 10px; }
.d-oficina .of-roles > div { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; color: var(--d-tx); }
.d-oficina .of-roles small { color: var(--d-mut); width: 100%; padding-left: 34px; margin-top: -4px; }
@media (max-width: 900px) { .d-oficina .of-roles { display: none; } }
@media (max-width: 600px) {
  #dash-section .d-crumb { display: none; }
  #dash-section .d-modo { margin: 0 6px 0 0; }
  #dash-section .d-modo button { padding: 6px 9px; font-size: 12px; }
}
.d-oficina .of-cuerpo { animation: of-respira 3.2s ease-in-out infinite; transform-box: fill-box; }
.d-oficina .of-pj--urgente .of-globo, .d-oficina .of-globo--late { animation: of-late 1.1s ease-in-out infinite; transform-box: fill-box; transform-origin: center bottom; }
@keyframes of-respira { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes of-late { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
@media (prefers-reduced-motion: reduce) { .d-oficina .of-cuerpo, .d-oficina .of-globo { animation: none !important; } }
.d-oficina .of-lista { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 200px); overflow: auto; }
@media (max-width: 900px) { .d-oficina .of-lista { max-height: none; } }
.d-oficina .of-item { background: var(--d-card); border: 1px solid var(--d-bd); border-left: 4px solid var(--d-cyan); border-radius: 12px; padding: 10px 12px; }
.d-oficina .of-item--aviso { border-left-color: var(--d-amber); }
.d-oficina .of-item--urgente { border-left-color: var(--d-red); }
.d-oficina .of-item-cab { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.d-oficina .of-ava { width: 26px; height: 26px; border-radius: 50%; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; }
.d-oficina .of-rol { color: var(--d-mut); font-size: 12px; }
.d-oficina .of-tag { margin-left: auto; background: var(--d-red); color: #fff; border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 700; }
.d-oficina .of-item p { margin: 6px 0 8px; font-size: 15px; line-height: 1.4; }
.d-oficina .of-acc { display: flex; gap: 6px; flex-wrap: wrap; }
.d-oficina .of-acc button { background: var(--d-bd-2); color: var(--d-tx); border: 0; border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
.d-oficina .of-acc button:first-child { background: var(--d-cyan); color: #04121a; font-weight: 700; }
.d-oficina .of-acc .of-luego { background: transparent; color: var(--d-mut); margin-left: auto; }
.d-oficina .of-vacio { color: var(--d-mut); text-align: center; padding: 30px 0; }
`;
  document.head.appendChild(st);
}
