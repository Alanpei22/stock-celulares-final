// Guardia de CUPO de Firebase: qué colecciones lee la app al abrirse.
// Cada documento leído se cobra, y el plan gratis corta en 50.000 por día.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── DOM mínimo ──
const els = {};
const el = id => els[id] = { id, value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, options: [],
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  closest: () => null, focus() {}, setAttribute() {}, removeAttribute() {},
  addEventListener(ev, fn, o) { (this._h = this._h || {})[ev] = fn; },
  querySelector: () => null, querySelectorAll: () => [], appendChild() {}, remove() {}, insertAdjacentHTML() {} };

const ATACHES = [];   // { coleccion, filtros }
function fakeQuery(nombre, filtros = []) {
  return {
    where: (campo, op, val) => fakeQuery(nombre, [...filtros, `${campo}${op}`]),
    orderBy: () => fakeQuery(nombre, filtros),
    limit: () => fakeQuery(nombre, filtros),
    onSnapshot: (a, b) => { ATACHES.push({ coleccion: nombre, filtros }); return () => {}; },
    get: async () => ({ docs: [], empty: true, forEach() {} }),
    doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), set: async () => {}, update: async () => {} }),
  };
}

const ctx = {
  console, setTimeout: () => 0, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  document: { getElementById: id => els[id] || el(id), querySelector: () => null, querySelectorAll: () => [],
              createElement: () => el('tmp'), addEventListener() {}, hidden: false,
              body: { style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
              documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } } },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { search: '' } },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  navigator: { userAgent: 'node', onLine: true },
  URLSearchParams, location: { search: '', href: '' },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({}) } } },
  requireAuth: () => Promise.resolve(null), showApp: () => {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);
// Helpers que en la app vienen de utils.js
vm.runInContext(`
  var fmtNum = n => String(n);
  var fmtMoney = n => '$' + n;
  var safeListener = (prev, crear) => { if (prev) prev(); return crear(); };
`, ctx);
vm.runInContext(fs.readFileSync(DIR + 'inventario.js', 'utf8'), ctx, { filename: 'inventario.js' });
vm.runInContext(fs.readFileSync(DIR + 'caja.js', 'utf8'), ctx, { filename: 'caja.js' });
const run = c => vm.runInContext(c, ctx);
ctx.__Q = fakeQuery;
run(`
  _fbInit = () => ({ collection: n => __Q(n) });
  db = _fbInit();
  toast = () => {}; esc = s => String(s ?? ''); fmt = n => '$' + n;
  searchMatch = () => false; normalizeText = s => String(s || '');
  getCurrentDolar = () => 1000; ensureDolar = () => {};
  renderMovimientos = () => {}; renderStats = () => {}; renderInventario = () => {};
  updateDateLabel = () => {}; loadArqueo = () => {}; loadCierre = () => {};
  _loadYesterdayStats = () => Promise.resolve();
  _hydrateStockFromCache = () => {}; getDeviceId = () => 'x';
  renderCatBtns = () => {}; selectCat = () => {}; selectMetodo = () => {};
  _initInvScanInput = () => {}; focusInvScan = () => {};
`);
ctx.__Q = fakeQuery;

const leidas = () => [...new Set(ATACHES.map(a => a.coleccion))].sort();

console.log('\n1) Al abrir la CAJA solo se lee lo del día');
ATACHES.length = 0;
run('initApp()');
const alAbrir = leidas();
ok(!alAbrir.includes('repuestos'), 'NO lee la colección entera de repuestos', alAbrir);
ok(!alAbrir.includes('productos'), 'NO lee la colección entera de productos', alAbrir);
ok(!alAbrir.includes('stock'), 'NO lee el stock', alAbrir);
ok(!alAbrir.includes('repairs'), 'NO lee las reparaciones', alAbrir);
ok(alAbrir.includes('caja_movimientos'), 'sí lee los movimientos del día (es la pantalla)', alAbrir);
const movs = ATACHES.find(a => a.coleccion === 'caja_movimientos');
ok(movs && movs.filtros.some(f => f.startsWith('fecha')), 'y filtrados por fecha', movs);

console.log('\n2) Recién al ir a vender se traen productos y equipos');
ATACHES.length = 0;
run('_asegurarDatosVenta()');
const alVender = leidas();
ok(alVender.includes('repuestos') && alVender.includes('stock') && alVender.includes('repairs'),
   'ahí sí: repuestos, stock y reparaciones', alVender);
const st = ATACHES.find(a => a.coleccion === 'stock');
ok(st && st.filtros.some(f => f.startsWith('vendido')), 'el stock solo trae los NO vendidos', st);
const rp = ATACHES.find(a => a.coleccion === 'repairs');
ok(rp && rp.filtros.some(f => f.startsWith('fechaIngreso')), 'las reparaciones van acotadas por fecha', rp);

console.log('\n3) No se duplican los listeners');
ATACHES.length = 0;
run('_asegurarDatosVenta(); _asegurarDatosVenta();');
ok(ATACHES.length === 0, 'llamarlo de nuevo no vuelve a leer nada', ATACHES);

console.log('\n4) Accesorios se lee al entrar a la pestaña');
ATACHES.length = 0;
run('_listenProductos()');
ok(leidas().includes('productos'), 'entrar a Accesorios trae los productos', leidas());
ATACHES.length = 0;
run('_listenProductos()');
ok(ATACHES.length === 0, 'volver a entrar no los relee', ATACHES);

console.log('\n5) Ventana de reparaciones');
const repSrc = fs.readFileSync(DIR + 'repairs.js', 'utf8');
const dias = (repSrc.match(/REPAIRS_DIAS_VENTANA\s*=\s*(\d+)/) || [])[1];
ok(Number(dias) === 60, 'la app mantiene 60 días de reparaciones (antes 120)', dias);
ok(/cutoff\.setDate\(cutoff\.getDate\(\) - REPAIRS_DIAS_VENTANA\)/.test(repSrc),
   'y el número sale de una sola constante, no repetido a mano');

console.log('\n6) Los listeners pesados ya no arrancan solos');
const appSrc = fs.readFileSync(DIR + 'app.js', 'utf8');
const repuSrc = fs.readFileSync(DIR + 'repuestos.js', 'utf8');
const pedSrc = fs.readFileSync(DIR + 'pedidos.js', 'utf8');
ok(!/initRepuestos\(\)[\s\S]{0,400}listenRepuestos\(\);/.test(repuSrc.slice(repuSrc.indexOf('function initRepuestos'))),
   'repuestos no se lee al iniciar la app');
ok(/section === 'repuestos'[^\n]*listenRepuestos/.test(appSrc),
   'se lee al entrar a la sección Repuestos');
ok(!/function initPedidos\(\)[\s\S]{0,200}listenPedidos\(\);/.test(pedSrc),
   'pedidos no se lee al iniciar la app');
ok(/openPedidosModal[\s\S]{0,300}listenPedidos\(\)/.test(pedSrc),
   'se lee al abrir el modal de pedidos');
ok(/if \(_repuestosListener\) return;/.test(repuSrc), 'el listener de repuestos no se recrea (antes se cancelaba y releía todo)');

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
