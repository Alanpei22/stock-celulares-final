// Auditoría de la caja: los números del día y qué pasa al BORRAR un
// movimiento. Todo lo de acá salió de leer caja.js buscando plata mal contada.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const els = {};
const el = (id, extra = {}) => els[id] = Object.assign({
  id, value: '', textContent: '', innerHTML: '', checked: false, style: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  closest() { return null; }, focus() {}, setAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
}, extra);
['stat-apertura','stat-ingresos','stat-egresos','stat-efectivo','stat-neto','qb-efectivo','qb-neto',
 'desglose-efectivo','desglose-digital','desglose-reparac','desglose-gastos','desglose-retiros',
 'desglose-retiros-wrap','desglose-usd','desglose-usd-wrap','vs-ayer','planes-lista','planes-chips',
 'mov-overlay','mov-modal','mov-delete-wrap'].forEach(id => el(id));

let TOASTS = [];
const W = { adds: [], updates: [], deletes: [], sets: [] };
let DOCS = {};   // id → data, para los .get()
const ctx = {
  console, setTimeout, clearTimeout, requestAnimationFrame: f => f(),
  document: {
    getElementById: id => els[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el('tmp'), addEventListener: () => {},
    body: { style: {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } },
    documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, style: { setProperty() {} } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: '' } },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem() {} },
  navigator: { userAgent: 'node' },
  firebase: { firestore: { FieldValue: {
    increment: n => ({ __inc: n }), arrayUnion: v => ({ __arr: v }), delete: () => ({ __del: true }),
  } } },
  _todayAR: () => '2026-09-01',
  confirm: () => true, alert: () => {},
  getCurrentDolar: () => 1000, getDeviceId: () => 'test',
  tgNotify: () => {}, tgMonto: n => '$' + n, tgHora: () => '10:00',
  requireAuth: () => Promise.resolve(null), showApp: () => {},
  requireCajaOwnerPin: (cb) => cb(),   // el PIN se prueba aparte
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'caja.js', 'utf8'), ctx, { filename: 'caja.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);

ctx.__DB = {
  collection: name => ({
    doc: id => ({
      update: async d => { W.updates.push([name, id, d]); },
      set: async d => { W.sets.push([name, id, d]); },
      delete: async () => { W.deletes.push([name, id]); },
      get: async () => ({ exists: !!DOCS[id], data: () => DOCS[id] }),
    }),
    add: async d => { W.adds.push([name, d]); return { id: 'nuevo' }; },
  }),
};
run(`db = __DB; currentDate = '2026-09-01';
     esc = s => String(s == null ? '' : s);
     fmt = n => '$' + Number(n || 0).toLocaleString('es-AR');
     toast = (m, t) => __TOASTS.push([t || 'info', m]);
     _showUndoToast = o => { __UNDO = o; };
     closeMovForm = () => {};`);
ctx.__TOASTS = TOASTS;
const reset = () => { W.adds = []; W.updates = []; W.deletes = []; W.sets = []; TOASTS.length = 0; ctx.__UNDO = null; };
const num = id => Number(String(els[id].textContent).replace(/[^\d-]/g, '')) || 0;
const tick = () => new Promise(r => setImmediate(r));

(async () => {

console.log('\n1) El desglose del día tiene que poder sumarse');
// Antes: una reparación cobrada por transferencia contaba en "Digital" Y en
// "Reparaciones"; una cobrada en efectivo no aparecía en ninguno de los dos.
run(`ARQUEO = { total: 50000 };
  MOVIMIENTOS = [
    { tipo:'ingreso', categoria:'Venta producto', monto: 30000, metodoPago:'Efectivo' },
    { tipo:'ingreso', categoria:'Venta equipo',   monto: 200000, metodoPago:'Transferencia' },
    { tipo:'ingreso', categoria:'Reparación',     monto: 40000, metodoPago:'Efectivo' },
    { tipo:'ingreso', categoria:'Reparación',     monto: 25000, metodoPago:'MercadoPago' },
    { tipo:'egreso',  categoria:'Compra repuesto',monto: 10000, metodoPago:'Efectivo' },
  ];
  renderStats();`);
const efV = num('desglose-efectivo'), digV = num('desglose-digital'), repV = num('desglose-reparac');
ok(efV === 30000, 'Ef. ventas = solo la venta en efectivo', efV);
ok(digV === 200000, 'Dig. ventas = solo la venta digital, sin la reparación', digV);
ok(repV === 65000, 'Reparaciones = las dos, sin importar cómo se cobraron', repV);
ok(efV + digV + repV === 295000, 'los tres suman TODO lo que entró', [efV, digV, repV, efV + digV + repV]);
ok(num('stat-ingresos') === 295000, 'y coinciden con el total de ingresos');
ok(num('desglose-gastos') === 10000, 'gastos aparte');

console.log('\n2) Efectivo en caja: una sola cuenta, la misma que el cierre');
// 50.000 apertura + 30.000 + 40.000 de reparación en efectivo − 10.000 de gasto
ok(num('stat-efectivo') === 110000, 'el panel del día', num('stat-efectivo'));
ok(get('_getCierreEsperado()') === 110000, 'y el cierre dan lo mismo', get('_getCierreEsperado()'));
const src = fs.readFileSync(DIR + 'caja.js', 'utf8');
const rs = src.slice(src.indexOf('function renderStats'), src.indexOf('function _loadYesterdayStats'));
ok(/const efectivoEnCaja = _getCierreEsperado\(\)/.test(rs),
   'renderStats no rehace la cuenta, llama a la del cierre');

console.log('\n3) Los dólares no son "digital"');
run(`MOVIMIENTOS = [
    { tipo:'ingreso', categoria:'Venta equipo', monto: 500000, metodoPago:'Dólares', montoUSD: 500, vueltoPesos: 0, createdAt:'2026-09-01T12:00:00.000Z' },
    { tipo:'ingreso', categoria:'Venta producto', monto: 10000, metodoPago:'Transferencia', createdAt:'2026-09-01T13:00:00.000Z' },
  ];
  ARQUEO = { total: 0, savedAt: '2026-09-01T09:00:00.000Z' };
  CIERRES_PARCIALES = [];
  renderStats();`);
ok(num('desglose-digital') === 10000, 'el panel del día no mete los dólares en digital', num('desglose-digital'));
const per = get(`_calcPeriodoStats('2026-09-01T09:00:00.000Z')`);
ok(per.digital === 10000, 'el cierre de turno tampoco  ← acá los sumaba', per.digital);
ok(per.totalIng === 510000, 'pero siguen contando como ingreso del día', per.totalIng);
ok(get('_usdEnCaja()') === 500, 'y los dólares tienen su propio renglón en u$', get('_usdEnCaja()'));

console.log('\n4) Borrar el cobro de una reparación la deja sin cobrar');
// La plata dejó de existir: la orden no puede seguir figurando como cobrada.
reset();
DOCS['mov1'] = { tipo:'ingreso', categoria:'Reparación', monto: 40000, metodoPago:'Efectivo',
                 esCobro: true, repairId: 'r1', createdAt: '2026-09-01T12:00:00.000Z' };
run("editingMovId = 'mov1'; deleteMov();");
await tick(); await tick();
ok(W.deletes.some(d => d[0] === 'caja_movimientos'), 'borra el movimiento');
const upRep = W.updates.find(u => u[0] === 'repairs');
ok(!!upRep, 'toca la reparación', W.updates);
ok(upRep && upRep[2].cobrado === false, 'la deja sin cobrar', upRep && upRep[2]);
ok(upRep && upRep[2].metodoCobro && upRep[2].metodoCobro.__del, 'y limpia el método de cobro');
ok(!('estado' in (upRep ? upRep[2] : {})),
   'el ESTADO no se toca: si el equipo se entregó, se entregó', upRep && upRep[2]);
ok(/sin cobrar/i.test(ctx.__UNDO?.msg || ''), 'y el aviso lo dice', ctx.__UNDO?.msg);

console.log('\n5) …y el deshacer la vuelve a marcar cobrada');
const undoCobro = ctx.__UNDO;   // guardarlo ANTES del reset, que lo limpia
reset();
await undoCobro.onUndo();
const reUp = W.updates.find(u => u[0] === 'repairs');
ok(reUp && reUp[2].cobrado === true, 'vuelve a estar cobrada', reUp && reUp[2]);
ok(reUp && reUp[2].metodoCobro === 'Efectivo', 'con el método que tenía');
ok(W.sets.some(s => s[0] === 'caja_movimientos'), 'y el movimiento vuelve a la caja');

console.log('\n6) Borrar una entrega de plan ahorro se la descuenta al plan');
reset();
DOCS['mov2'] = { tipo:'ingreso', categoria:'Plan ahorro', monto: 150000, metodoPago:'Transferencia',
                 esPlan: true, planId: 'p1', createdAt: '2026-09-01T15:00:00.000Z' };
DOCS['p1'] = { nro: 5, pagado: 250000, equipo: { stockId: 's1' },
               pagos: [ { fecha:'2026-08-01T10:00:00.000Z', monto: 100000, metodo:'Efectivo' },
                        { fecha:'2026-09-01T15:00:00.000Z', monto: 150000, metodo:'Transferencia' } ] };
run(`PLANES = [{ id:'p1', nro:5, pagado:250000, precioPactado:520000, estado:'activo',
      cliente:{nombre:'Ana'}, equipo:{stockId:'s1'},
      pagos:[{fecha:'2026-08-01T10:00:00.000Z',monto:100000,metodo:'Efectivo'},
             {fecha:'2026-09-01T15:00:00.000Z',monto:150000,metodo:'Transferencia'}] }];
     editingMovId = 'mov2'; deleteMov();`);
await tick(); await tick(); await tick();
const upPlan = W.updates.find(u => u[0] === 'planes');
ok(!!upPlan, 'actualiza el plan', W.updates.map(u => u[0]));
ok(upPlan && upPlan[2].pagado === 100000, 'le resta la entrega borrada', upPlan && upPlan[2].pagado);
ok(upPlan && upPlan[2].pagos.length === 1, 'y la saca del historial', upPlan && upPlan[2].pagos);
ok(upPlan && upPlan[2].pagos[0].monto === 100000, 'quedando la que sí sigue viva');
ok(get('PLANES[0].pagado') === 100000, 'la copia en pantalla queda al día');
ok(W.updates.some(u => u[0] === 'stock' && u[2].reservaSena === 100000),
   'y la seña del equipo reservado acompaña');
ok(/Plan −/.test(ctx.__UNDO?.msg || ''), 'el aviso lo dice', ctx.__UNDO?.msg);

console.log('\n7) Saca el pago EXACTO, no otro del mismo importe');
reset();
DOCS['mov3'] = { tipo:'ingreso', monto: 100000, metodoPago:'Efectivo', esPlan: true, planId: 'p2',
                 createdAt: '2026-09-01T16:00:00.000Z' };
DOCS['p2'] = { nro: 6, pagado: 300000, equipo: {},
               pagos: [ { fecha:'2026-07-01T10:00:00.000Z', monto: 100000, metodo:'Efectivo' },
                        { fecha:'2026-08-01T10:00:00.000Z', monto: 100000, metodo:'Efectivo' },
                        { fecha:'2026-09-01T16:00:00.000Z', monto: 100000, metodo:'Efectivo' } ] };
run("PLANES = []; editingMovId = 'mov3'; deleteMov();");
await tick(); await tick(); await tick();
const up2 = W.updates.find(u => u[0] === 'planes');
ok(up2 && up2[2].pagos.length === 2, 'quedan dos pagos', up2 && up2[2].pagos.length);
ok(up2 && !up2[2].pagos.some(p => p.fecha === '2026-09-01T16:00:00.000Z'),
   'y el que se fue es el del movimiento borrado, no otro igual', up2 && up2[2].pagos);

console.log('\n8) La entrega del plan y su movimiento comparten la marca de tiempo');
// Es lo que hace posible el punto 7. Si se separan, borrar un movimiento
// saca "alguno" del mismo importe.
ok(/_planMovCaja\(plan, pago1, metodo, ahora\)/.test(src), 'al abrir el plan');
ok(/_planMovCaja\(p, monto, metodo, ahora\)/.test(src), 'y en cada entrega');
ok(/createdAt: cuando \|\| new Date\(\)\.toISOString\(\)/.test(src), 'el movimiento usa esa marca');

console.log('\n9) La fecha límite del plan se calcula con el día de acá, no en UTC');
// Después de las 21:00 el UTC ya está en mañana: el plazo salía un día largo.
const pf = src.slice(src.indexOf('function _planFechaLimite'), src.indexOf('async function confirmPlan'));
ok(/_todayAR/.test(pf), 'parte del día argentino');
ok(!/toISOString\(\)\.slice\(0, 10\)/.test(pf.replace(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, '')),
   'y no arma la fecha desde toISOString');
const limite = get('_planFechaLimite(90)');
ok(/^\d{4}-\d{2}-\d{2}$/.test(limite), 'devuelve yyyy-mm-dd', limite);
ok(limite === '2026-11-30', '2026-09-01 + 90 días = 2026-11-30', limite);

console.log('\n9b) Borrar la seña de una reserva se la saca al equipo');
// Si no, el equipo sigue mostrando una seña que ya no está en la caja y al
// venderlo se le descuenta del precio una plata que nunca quedó registrada.
reset();
DOCS['mov4'] = { tipo:'ingreso', categoria:'Seña venta', monto: 150000, metodoPago:'Efectivo',
                 esSena: true, senaTipo: 'venta', stockId: 's9', createdAt: '2026-09-01T11:00:00.000Z' };
run("PLANES = []; editingMovId = 'mov4'; deleteMov();");
await tick(); await tick();
const upStock = W.updates.find(u => u[0] === 'stock' && u[1] === 's9');
ok(!!upStock, 'toca el equipo reservado', W.updates);
ok(upStock && upStock[2].reservaSena && upStock[2].reservaSena.__inc === -150000,
   'le resta la seña borrada', upStock && upStock[2].reservaSena);
ok(!W.updates.some(u => u[0] === 'repairs'),
   'y no confunde la seña de una venta con la de una reparación', W.updates.map(u => u[0]));
const undoRsv = ctx.__UNDO;
reset();
await undoRsv.onUndo();
const reStock = W.updates.find(u => u[0] === 'stock' && u[1] === 's9');
ok(reStock && reStock[2].reservaSena.__inc === 150000, 'el deshacer se la devuelve', reStock && reStock[2]);

console.log('\n10) El historial no vuelve a leer un año entero en cada toque');
// Firebase cobra por DOCUMENTO leído. La pestaña "Anual" lee todos los
// movimientos del año: con 50 por día son ~18.000 lecturas de las 50.000
// gratis, en un solo toque. Antes se pagaba de nuevo cada vez que ibas y
// volvías de pestaña.
const ctxH = {
  console, Date, Object, setTimeout,
  document: { getElementById: id => els[id] || el(id), querySelectorAll: () => [] },
  _todayAR: () => '2026-09-01',
  fmt: n => '$' + n, esc: s => String(s == null ? '' : s), toast: () => {},
  _cajaIsOwner: true,
};
ctxH.globalThis = ctxH; vm.createContext(ctxH);
let CONSULTAS = 0;
ctxH.db = {
  collection: () => ({
    where: function () { return this; },
    get: async () => { CONSULTAS++; return { docs: [] }; },
  }),
};
vm.runInContext(fs.readFileSync(DIR + 'caja_extra.js', 'utf8'), ctxH, { filename: 'caja_extra.js' });
vm.runInContext('buildCajaAnualHTML = () => "<i>anual</i>"; buildCajaStatsHTML = () => "<i>stats</i>";', ctxH);
el('caja-hist-body');
await vm.runInContext("loadHistorialData('anual')", ctxH);
const trasPrimera = CONSULTAS;
await vm.runInContext("loadHistorialData('anual')", ctxH);
await vm.runInContext("loadHistorialData('anual')", ctxH);
ok(trasPrimera > 0, 'la primera vez sí consulta', trasPrimera);
ok(CONSULTAS === trasPrimera, 'las siguientes salen del cache: 0 lecturas más', CONSULTAS);
ok(els['caja-hist-body'].innerHTML === '<i>anual</i>', 'y muestra lo mismo');
// Cambió un movimiento del día → lo guardado dejó de valer
vm.runInContext('_histInvalidar()', ctxH);
await vm.runInContext("loadHistorialData('anual')", ctxH);
ok(CONSULTAS === trasPrimera + 1, 'si cambia un movimiento, vuelve a consultar', CONSULTAS);
// Cada pestaña tiene su propio cache
await vm.runInContext("loadHistorialData('stats')", ctxH);
ok(CONSULTAS === trasPrimera + 2, 'otra pestaña consulta lo suyo');
await vm.runInContext("loadHistorialData('stats')", ctxH);
ok(CONSULTAS === trasPrimera + 2, 'y también se cachea');
ok(/_histInvalidar\(\)/.test(src), 'caja.js avisa cuando cambian los movimientos del día');

console.log('\n11) Lo que ya andaba bien y no se rompió');
run(`ARQUEO = { total: 10000 };
  MOVIMIENTOS = [
    { tipo:'ingreso', categoria:'Venta producto', monto: 100000, metodoPago:'Efectivo', metodoPago2:'Transferencia', monto2: 60000 },
    { tipo:'egreso',  categoria:'Retiro dueño',   monto: 20000, metodoPago:'Efectivo' },
  ];
  renderStats();`);
ok(get('_efecMonto(MOVIMIENTOS[0])') === 40000, 'pago dividido: solo la parte en efectivo entra al cajón');
ok(num('stat-efectivo') === 30000, 'efectivo = 10.000 + 40.000 − 20.000 del retiro', num('stat-efectivo'));
ok(num('stat-neto') === 100000, 'el retiro del dueño NO baja el neto', num('stat-neto'));

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})();
