// Reparaciones: estados, card de la lista y cobro.
// Nació de una revisión del módulo. Cada sección es un bug que existía:
// la card y la ficha cambiaban el estado por dos caminos distintos que se
// habían separado, el cobro contaba la seña dos veces, la garantía se medía
// desde el ingreso. Y el alcance de la lista: últimos 30 días o todo.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── DOM mínimo (lo que usa renderRepairs) ──
const els = {};
const mk = id => els[id] = {
  id, value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, checked: false,
  options: [{}], remove() { this.options.pop(); }, appendChild(o) { this.options.push(o); },
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  addEventListener() {},
};
['rep-search', 'rep-f-estado', 'rep-f-marca', 'rep-f-fecha', 'rep-sort', 'rs-reparando', 'rs-listo',
 'rs-demorados', 'rs-devolver', 'rep-list', 'rep-empty', 'cobro-monto-label', 'cobro-desc-label',
 'cobro-sena-info', 'cobro-overlay'].forEach(mk);
els['rep-sort'].value = 'nOrden';

const ctx = {
  console, Date, Math, JSON, Promise,
  setTimeout: f => { f(); return 0; }, clearTimeout,
  document: {
    getElementById: id => els[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({}), addEventListener() {},
    body: { style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
    documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), open() {} },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  navigator: { userAgent: 'node' },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({}) } } },
  prompt: () => null, confirm: () => true,
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'tp-fases.js', 'utf8'), ctx, { filename: 'tp-fases.js' });
vm.runInContext(fs.readFileSync(DIR + 'repairs.js', 'utf8'), ctx, { filename: 'repairs.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);

// ── Firestore falso ──
const W = { updates: [], sets: [], batches: [], listeners: [], gets: [] };
let HISTORIAL = [], HIST_FALLA = false;
function query(n, filtros = []) {
  return {
    where: (c, op, v) => query(n, [...filtros, [c, op, v]]),
    orderBy: () => query(n, filtros), limit: () => query(n, filtros),
    onSnapshot: (a, b) => { const cb = typeof a === 'function' ? a : b; W.listeners.push({ n, filtros, cb }); return () => {}; },
    get: async () => { W.gets.push(n); if (HIST_FALLA) throw new Error('sin internet');
                       return { docs: HISTORIAL.map(x => ({ id: x.id, data: () => x })), empty: !HISTORIAL.length }; },
    doc: id => ({ id: id || 'nuevo', update: async d => { W.updates.push([n, id, d]); }, set: async d => { W.sets.push([n, id, d]); } }),
  };
}
ctx.__DB = {
  collection: n => query(n),
  batch: () => {
    const ops = [];
    return { set: (ref, d) => ops.push(['set', ref, d]), update: (ref, d) => ops.push(['update', ref, d]),
             commit: async () => { W.batches.push(ops); } };
  },
};
const CALLS = { cobro: [], aviso: [], detalle: [], notify: [], nova: [] };
ctx.CALLS = CALLS;
run(`
  db = __DB;
  toast = () => {}; esc = s => String(s == null ? '' : s); fmt = n => '$' + n;
  timeAgo = () => '1 d'; fmtDate = s => s; fmtDateTime = s => s;
  searchMatch = () => true; logActivity = () => {}; updateNavBadge = () => {};
  upsertSeguimientoPublico = () => {}; pushCambioEquipo = () => {}; _tgEstadoRepair = () => {};
  _todayAR = () => '2026-09-12';
  _faltaCargarCosto = () => false;
  openRepUsoModal = cb => cb(null);
  tpEntregaModal = () => Promise.resolve({ entregado: false, avisar: false });
  openRepairDetail = id => CALLS.detalle.push(['abrir', id]);
  closeRepairDetail = () => CALLS.detalle.push(['cerrar']);
  _ofrecerAvisoListo = id => CALLS.aviso.push(id);
  triggerWaNotify = (t, r) => CALLS.notify.push(t);
  _refreshDashIfVisible = () => {};
`);
// openCobroModal real, pero registrando cuándo se abre
run(`__realCobro = openCobroModal; openCobroModal = r => { CALLS.cobro.push(r.id); __realCobro(r); };`);

const hAgo = h => new Date(Date.now() - h * 3600000).toISOString();
const dAgo = d => hAgo(d * 24);
function setRepairs(arr) {
  ctx.__R = arr; run('REPAIRS = __R');
  W.updates = []; W.batches = [];
  Object.values(CALLS).forEach(a => a.length = 0);
}
const ultimoUpdate = () => (W.updates.filter(u => u[0] === 'repairs').pop() || [])[2];

(async () => {

console.log('\n1) La card va por el mismo camino que la ficha');
setRepairs([{ id: 'a1', nOrden: 1, estado: 'reparando', fase: 'reparacion', tlf: '1155667788', monto: 1000 }]);
await get(`quickStatusChange({ stopPropagation() {} }, 'a1', 'listo')`);
ok(ultimoUpdate()?.estado === 'listo', 'marca listo', ultimoUpdate());
ok(CALLS.aviso.includes('a1'), 'ofrece avisarle al cliente (antes desde la card no lo hacía)', CALLS.aviso);
ok(!CALLS.detalle.some(c => c[0] === 'abrir'), 'y no abre la ficha: estabas en la lista', CALLS.detalle);

setRepairs([{ id: 'a2', nOrden: 2, estado: 'listo', fase: 'listo', monto: 1000 }]);
await get(`quickStatusChange({ stopPropagation() {} }, 'a2', 'entregado')`);
ok(ultimoUpdate()?.estado === 'entregado', 'marca entregado');
ok(CALLS.cobro.includes('a2'), 'abre el cobro (antes desde la card no lo hacía)', CALLS.cobro);
ok(CALLS.notify.includes('entregado'), 'y sigue avisando al número del local', CALLS.notify);

console.log('\n2) Entregado ya cobrado: no ofrece cobrar de nuevo');
setRepairs([{ id: 'b1', nOrden: 3, estado: 'listo', fase: 'listo', monto: 1000, cobrado: true }]);
await get(`quickStatusChange({ stopPropagation() {} }, 'b1', 'entregado')`);
ok(!CALLS.cobro.includes('b1'), 'no abre el cobro', CALLS.cobro);
setRepairs([{ id: 'b2', nOrden: 4, estado: 'listo', fase: 'listo', monto: 1000 }]);
await get(`changeRepairStatus('b2', 'entregado')`);
ok(CALLS.cobro.includes('b2'), 'desde la ficha sin cobrar sí lo abre', CALLS.cobro);
setRepairs([{ id: 'b3', nOrden: 5, estado: 'listo', fase: 'listo', monto: 1000, cobrado: true }]);
await get(`changeRepairStatus('b3', 'entregado')`);
ok(!CALLS.cobro.includes('b3'), 'y desde la ficha ya cobrado, no', CALLS.cobro);

console.log('\n3) "No va" por presupuesto rechazado no le dice al cliente que no tiene arreglo');
setRepairs([{ id: 'c1', nOrden: 6, estado: 'reparando', fase: 'presupuestado', faseHist: [{ f: 'presupuestado', t: hAgo(5) }] }]);
run(`openNoVaModal = () => Promise.resolve({ motivoCierre: 'presupuesto', devuelto: false })`);
await get(`quickStatusChange({ stopPropagation() {} }, 'c1', 'cancelado')`);
let u = ultimoUpdate();
ok(u?.estado === 'no va', 'estado no va', u);
ok(u?.fase === 'rechazado', 'fase: presupuesto rechazado (antes: sin reparación)', u?.fase);
const rechazado = { ...get('REPAIRS')[0], ...u, nombre: 'Ana', marca: 'Moto', modelo: 'G54' };
ok(!/no tiene arreglo/.test(get('tpWaTexto')(rechazado)), 'el aviso no dice "no tiene arreglo"', get('tpWaTexto')(rechazado));

setRepairs([{ id: 'c2', nOrden: 7, estado: 'reparando', fase: 'reparacion' }]);
run(`openNoVaModal = () => Promise.resolve({ motivoCierre: 'sin-repuesto', devuelto: false })`);
await get(`quickStatusChange({ stopPropagation() {} }, 'c2', 'cancelado')`);
u = ultimoUpdate();
ok(u?.fase === 'irreparable', 'otro motivo: sin reparación', u?.fase);
const sinRep = { ...get('REPAIRS')[0], ...u, nombre: 'Ana', marca: 'Moto', modelo: 'G54' };
ok(/No se consigue el repuesto/.test(get('tpWaTexto')(sinRep)),
   'sin motivo escrito, el aviso usa la categoría en vez de "—"', get('tpWaTexto')(sinRep));

console.log('\n4) Las cards de "No va" tienen botones');
// Antes la tabla solo conocía 'cancelado' (el nombre viejo) y la card de un
// equipo en 'no va' quedaba sin ningún botón de estado.
const chipsDe = r => { ctx.__X = r; return get('_cardAccionesHtml(__X)'); };
let h = chipsDe({ id: 'd1', estado: 'no va', devuelto: false, tlf: '11' });
ok(/tpMarcarDevuelto\('d1'\)/.test(h), 'para devolver: botón Devuelto', h);
ok(/quickStatusChange\(event,'d1','reparando'\)/.test(h), 'y reabrir', h);
h = chipsDe({ id: 'd2', estado: 'no va', devuelto: true });
ok(!/tpMarcarDevuelto/.test(h), 'ya devuelto: no ofrece devolver de nuevo');
ok(!/'entregado'\)/.test(chipsDe({ id: 'd3', estado: 'no va' })), 'no ofrece "Entregado" (cobraría un equipo sin arreglar)');

console.log('\n5) Cobrar desde reparaciones: se cobra el saldo, no el total');
setRepairs([{ id: 'e1', nOrden: 8, estado: 'listo', marca: 'X', modelo: 'Y', monto: 50000, sena: 20000 }]);
run(`openCobroModal(REPAIRS[0])`);
ok(els['cobro-monto-label'].textContent === '$ 30.000', 'el número grande es el saldo', els['cobro-monto-label'].textContent);
await get('confirmarCobro()');
let ing = (W.batches[0] || []).find(op => op[0] === 'set' && op[2].tipo === 'ingreso');
ok(ing && ing[2].monto === 30000, 'registra $30.000 (antes $50.000: la seña entraba dos veces)', ing && ing[2]);
ok((W.batches[0] || []).some(op => op[0] === 'update' && op[2].cobrado === true), 'y la marca cobrada');

setRepairs([{ id: 'e2', nOrden: 9, estado: 'listo', monto: 50000, sena: 50000 }]);
run(`openCobroModal(REPAIRS[0])`);
await get('confirmarCobro()');
ok(!(W.batches[0] || []).some(op => op[2].tipo === 'ingreso'), 'seña que cubre todo: no ingresa $0 a la caja', W.batches[0]);
ok((W.batches[0] || []).some(op => op[2].cobrado === true), 'pero sí la marca cobrada');

setRepairs([{ id: 'e3', nOrden: 10, estado: 'listo', monto: 50000 }]);
run(`openCobroModal(REPAIRS[0]); REPAIRS[0] = { ...REPAIRS[0], cobrado: true };`);  // se cobró en la caja mientras tanto
await get('confirmarCobro()');
ok(W.batches.length === 0, 'si se cobró desde la caja con el cartel abierto, no se registra dos veces', W.batches);
els['cobro-overlay'].classList.remove('hidden');
CALLS.cobro.length = 0;
run(`__realCobro({ id: 'e3' })`);
ok(get('_cobroRepair') === null, 'y ya cobrada, el cartel ni se prepara');

console.log('\n6) Reabrir un entregado le saca la fecha de entrega');
setRepairs([{ id: 'f1', nOrden: 11, estado: 'entregado', fase: 'entregado', fechaEntrega: dAgo(2) }]);
await get(`changeRepairStatus('f1', 'reparando')`);
ok(ultimoUpdate()?.fechaEntrega === null, 'fechaEntrega → null', ultimoUpdate());
setRepairs([{ id: 'f2', nOrden: 12, estado: 'listo', fase: 'listo', monto: 0 }]);
await get(`_doStatusChange('f2', 'entregado')`);
ok(typeof ultimoUpdate()?.fechaEntrega === 'string', 'entregar la sigue poniendo');
setRepairs([{ id: 'f3', nOrden: 13, estado: 'entregado', fase: 'entregado', fechaEntrega: dAgo(1),
              faseHist: [{ f: 'listo', t: dAgo(2) }, { f: 'entregado', t: dAgo(1) }] }]);
await get(`tpDeshacer('f3')`);
ok(ultimoUpdate()?.fechaEntrega === null, 'deshacer la entrega también', ultimoUpdate());

console.log('\n7) Card: garantía y saldo');
const card = r => { setRepairs([r]); run('renderRepairs()'); return els['rep-list'].innerHTML; };
let c = card({ id: 'g1', nOrden: 14, estado: 'reparando', fase: 'reparacion', fechaIngreso: dAgo(5), diasGarantia: 90 });
ok(!/Garantía:|garantía<\/span>|Gtía/.test(c), 'en el banco NO muestra garantía (antes "Día 5/90d garantía")', c.match(/rep-dias-badge[^<]*/));
ok(!/Día \d+ en taller/.test(c), 'se fue el "Día N en taller" (repetía el ⏱)');
c = card({ id: 'g2', nOrden: 15, estado: 'entregado', fase: 'entregado', fechaIngreso: dAgo(20), fechaEntrega: dAgo(10), diasGarantia: 90 });
ok(/quedan 80 días/.test(c), 'entregado: cuenta desde la ENTREGA (90 − 10 = 80)', c.match(/rep-dias-badge[^<]*/));
c = card({ id: 'g3', nOrden: 16, estado: 'entregado', fase: 'entregado', fechaIngreso: dAgo(20), fechaEntrega: dAgo(10), diasGarantia: 7 });
ok(!/rep-dias-badge/.test(c), 'vencida: no ensucia la card');
c = card({ id: 'g4', nOrden: 17, estado: 'listo', fase: 'listo', fechaIngreso: dAgo(3), monto: 50000, sena: 10000, cobrado: true });
ok(!/Saldo \$/.test(c), 'cobrada: no muestra saldo aunque tenga seña', c.match(/card-saldo-badge[^<]*/));
c = card({ id: 'g5', nOrden: 18, estado: 'listo', fase: 'listo', fechaIngreso: dAgo(3), monto: 50000, sena: 10000 });
ok(/Saldo \$40\.000/.test(c), 'sin cobrar: sí');

console.log('\n8) Filtro "Hoy" con la fecha argentina');
// 23:30 del día anterior en Argentina = 02:30 UTC de hoy.
const hoyAR = get('_diaAR(new Date())');
const [y, m, d] = hoyAR.split('-').map(Number);
const anocheAR = new Date(Date.UTC(y, m - 1, d, 2, 30)).toISOString();   // 23:30 AR de ayer
const hoyTempranoAR = new Date(Date.UTC(y, m - 1, d, 12, 0)).toISOString();  // 09:00 AR de hoy
setRepairs([
  { id: 'h1', nOrden: 20, estado: 'reparando', fechaIngreso: anocheAR },
  { id: 'h2', nOrden: 21, estado: 'reparando', fechaIngreso: hoyTempranoAR },
]);
els['rep-f-fecha'].value = 'hoy';
run('renderRepairs()');
ok(/N°21/.test(els['rep-list'].innerHTML), 'el de hoy aparece');
ok(!/N°20/.test(els['rep-list'].innerHTML), 'el de anoche a las 23:30 no (en UTC ya era hoy)');
els['rep-f-fecha'].value = '';

console.log('\n9) Ordenar "por estado" sigue el recorrido de fases');
setRepairs([
  { id: 'i1', nOrden: 30, fechaIngreso: dAgo(2), estado: 'listo', fase: 'listo' },
  { id: 'i2', nOrden: 31, fechaIngreso: dAgo(2), estado: 'reparando', fase: 'repuesto' },
  { id: 'i3', nOrden: 32, fechaIngreso: dAgo(2), estado: 'reparando', fase: 'ingresado' },
  { id: 'i4', nOrden: 33, fechaIngreso: dAgo(2), estado: 'reparando', fase: 'presupuestado' },
]);
els['rep-sort'].value = 'estado';
run('renderRepairs()');
const orden = [...els['rep-list'].innerHTML.matchAll(/N°(\d+)/g)].map(x => +x[1]);
ok(JSON.stringify(orden) === JSON.stringify([32, 33, 31, 30]), 'ingresado → presupuestado → repuesto → listo', orden);
els['rep-sort'].value = 'nOrden';

console.log('\n10) Alcance: últimos 30 días o todo el historial');
const snap = docs => ({ docs: docs.map(x => ({ id: x.id, data: () => x })), docChanges: () => docs, metadata: {} });
const listaIds = () => [...els['rep-list'].innerHTML.matchAll(/N°(\d+)/g)].map(x => +x[1]).sort();
const nuevo = { id: 'j1', nOrden: 40, estado: 'reparando', fase: 'reparacion', fechaIngreso: dAgo(3) };
const mes45 = { id: 'j2', nOrden: 41, estado: 'listo', fase: 'listo', fechaIngreso: dAgo(45) };   // en la ventana de 60, fuera de 30
const viejo = { id: 'j3', nOrden: 42, estado: 'listo', fase: 'abandonado', fechaIngreso: dAgo(200) };
HISTORIAL = [nuevo, mes45, viejo];

ctx.localStorage.removeItem('repAlcance');
W.listeners = []; W.gets = [];
run('_repHistorial = []; _repairsLoaded = false; listenRepairs()');
ok(get('repAlcance()') === '30', 'arranca en 30 días');
ok(W.gets.length === 0, 'en 30 días NO lee el historial', W.gets);
ok(!W.listeners.some(l => l.filtros.length === 0), 'ningún listener a la colección entera', W.listeners.map(l => l.filtros));
const ventana = W.listeners.find(l => l.filtros.some(f => f[0] === 'fechaIngreso'));
ventana.cb(snap([nuevo, mes45]));
ok(JSON.stringify(listaIds()) === '[40]', 'la lista muestra solo lo ingresado en 30 días', listaIds());
ok(String(els['rs-listo'].textContent) === '0', 'y los números de arriba también cuentan solo eso', els['rs-listo'].textContent);
ok(/últimos 30 días/.test(els['rep-list'].innerHTML) && /1 más viejos ocultos/.test(els['rep-list'].innerHTML),
   'al pie avisa qué estás mirando y cuántos quedaron afuera');
ok(/setRepAlcance\('todo'\)/.test(els['rep-list'].innerHTML), 'con el botón para ver todo');

await get(`setRepAlcance('todo')`);
ok(ctx.localStorage.getItem('repAlcance') === 'todo', 'se guarda en el dispositivo');
ok(W.gets.filter(n => n === 'repairs').length === 1, 'lee el historial UNA vez, con get', W.gets);
ok(JSON.stringify(listaIds()) === '[40,41,42]', 'y la lista muestra todo', listaIds());
ok(String(els['rs-listo'].textContent) === '2', 'los números cuentan todo', els['rs-listo'].textContent);
ok(get('REPAIRS').filter(r => r.id === 'j1').length === 1, 'lo que viene por las dos vías va una sola vez');
ok(!/rep-alcance-pie/.test(els['rep-list'].innerHTML), 'en "todo" no hay renglón de aviso');

console.log('\n11) En "todo", tocar un equipo viejo se ve al instante');
// El viejo no está en la ventana en vivo: no le llega snapshot de Firestore.
setRepairs(get('REPAIRS'));
run(`openCobroModal = () => {}`);
await get(`changeRepairStatus('j3', 'entregado')`);
run('renderRepairs()');
ok(get('REPAIRS').find(r => r.id === 'j3').estado === 'entregado', 'la card vieja pasa a entregado sin reabrir la app',
   get('REPAIRS').find(r => r.id === 'j3').estado);
ventana.cb(snap([{ ...nuevo, estado: 'listo' }, mes45]));
ok(get('REPAIRS').find(r => r.id === 'j1').estado === 'listo', 'lo nuevo sigue llegando en vivo y pisa la copia vieja');
ok(get('REPAIRS').find(r => r.id === 'j3').estado === 'entregado', 'sin perder el cambio del viejo');

console.log('\n12) Reabrir la app en "todo" vuelve a traer el historial; volver a 30 lo suelta');
W.gets = [];
run('_repHistorial = []; _fullHistoryCache = null; _repairsLoaded = false; listenRepairs()');
await new Promise(r => setImmediate(r));
ok(W.gets.includes('repairs'), 'al abrir en "todo" lo carga solo', W.gets);
await get(`setRepAlcance('30')`);
ok(get('_repHistorial').length === 0, 'en 30 días se suelta el historial');
ok(JSON.stringify(listaIds()) === '[40]', 'y la lista vuelve a 30 días', listaIds());

console.log('\n13) Sin internet no queda a medias');
HIST_FALLA = true;
run('_fullHistoryCache = null'); const _ce = console.error; console.error = () => {};
await get(`setRepAlcance('todo')`);
ok(get('repAlcance()') === '30', 'si no pudo traer el historial, vuelve a 30 días');
HIST_FALLA = false; console.error = _ce;

console.log('\n14) Filtros sin opciones repetidas');
const idx = fs.readFileSync(DIR + 'index.html', 'utf8');
ok(!/value="para-entregar"/.test(idx), '"Para entregar (listos)" era lo mismo que "Listo"');
ok(idx.indexOf('id="rep-alcance"') > 0 && idx.indexOf('id="rep-alcance"') < idx.indexOf('id="rep-f-estado"'),
   'el selector de alcance es el primer filtro (no queda escondido al fondo del scroll)');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
