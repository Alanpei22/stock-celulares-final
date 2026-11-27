// Apretar dos veces no cobra dos veces.
//
// Alan: "se duplican los cobros al apretar varias veces". En el mostrador se
// apura y la pantalla tarda en responder, así que el botón se toca de nuevo.
// Mientras la primera guardada esperaba a Firebase no había nada que frenara
// la segunda: entraban DOS movimientos por la misma venta, y el stock se
// descontaba dos veces.
//
// La traba es una bandera, no el botón deshabilitado: el botón es solo lo que
// se ve. Y se suelta en un `finally`, porque si la guardada falla hay que
// poder reintentar — si no, el arreglo sería peor que el problema.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = {};
const mk = id => els[id] = { id, value: '', textContent: '', innerHTML: '', disabled: false,
  dataset: {}, style: {}, options: [{}], remove() {}, appendChild() {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  addEventListener() {}, focus() {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [] };
['mov-fi-monto', 'mov-fi-desc', 'mov-categorias', 'mov-hidden-cat', 'mov-hidden-metodo', 'mov-cat-wrap',
 'mov-cat-auto', 'mov-save-btn', 'mov-resumen-txt', 'mov-resumen-total', 'mov-btn-ingreso', 'mov-btn-egreso',
 'mov-desc-suggest', 'mov-sale-item-info', 'mov-quick-amounts', 'mov-monto-hint', 'mov-step-monto',
 'mov-cat-lbl', 'mov-metodo-lbl', 'mov-hidden-metodo2', 'mov-overlay', 'mov-modal', 'mov-delete-wrap',
 'mov-cliente-tel', 'mov-cliente-nombre', 'mov-cliente-fields', 'mov-cliente-toggle', 'mov-split-amt',
 'split-section', 'btn-split-toggle', 'vuelto-section', 'mov-recibido', 'vuelto-val', 'mov-dolares-section',
 'mov-fi-usd', 'mov-fi-vuelto-pesos', 'mov-search', 'mov-search-clear'].forEach(mk);

const AGREGADOS = [];
let demora = null;           // para dejar la escritura colgada a propósito
let _esperas = [];           // todas las que quedaron colgadas
const soltarTodas = () => { _esperas.splice(0).forEach(r => r()); };
const ctx = {
  console, Date, Math, JSON, Promise, Number, String, Set, Map, Array, Object,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  document: {
    getElementById: id => els[id] || mk(id),
    querySelectorAll: () => [], querySelector: () => null, createElement: () => mk('tmp'), addEventListener() {},
    body: { style: {}, classList: { add() {}, remove() {}, contains: () => false } },
    documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { search: '' } },
  navigator: { userAgent: 'node', onLine: true },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  URLSearchParams, location: { search: '' },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({}) } } },
  _todayAR: () => '2026-11-27',
  requireAuth: () => Promise.resolve(null), showApp: () => {},
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext('var fmtNum = n => String(n); var fmtMoney = n => "$" + n; var safeListener = (p, c) => c();', ctx);
vm.runInContext(leer('inventario.js'), ctx, { filename: 'inventario.js' });
vm.runInContext(leer('caja.js'), ctx, { filename: 'caja.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
run(`
  db = { collection: () => ({
    doc: () => ({ set: async () => {}, update: async () => {} }),
    where: () => ({ get: async () => ({ empty: true, docs: [] }) }),
    add: async d => { __ADD(d); if (__DEMORA) await __DEMORA(); return { id: 'mov' + __N() }; },
  }) };
  toast = () => {}; esc = s => String(s == null ? '' : s);
  fmt = n => '$' + Number(n || 0).toLocaleString('es-AR');
  searchMatch = () => false; normalizeText = s => String(s || '');
  getCurrentDolar = () => 1500; ensureDolar = () => {};
  renderMovimientos = () => {}; renderStats = () => {}; renderInventario = () => {};
  renderCatBtns = () => {}; _renderCart = () => {}; _hideMovSuggestions = () => {};
  closeMovForm = () => {}; _updateMovResumen = () => {}; tgNotify = () => {};
  tgMonto = n => '$' + n; tgHora = () => '00:00';
  logActivity = () => {}; movStock = () => {}; cvFalta = () => false;
  _cart = []; setMovTipo('ingreso');
`);
ctx.__ADD = d => AGREGADOS.push(d);
ctx.__N = () => AGREGADOS.length;
Object.defineProperty(ctx, '__DEMORA', { get: () => demora });

function cargarVenta() {
  AGREGADOS.length = 0;
  els['mov-fi-monto'].value = '15000';
  els['mov-fi-desc'].value = 'Vidrio templado';
  els['mov-hidden-cat'].value = 'Venta producto';
  els['mov-hidden-metodo'].value = 'Efectivo';
  els['mov-btn-ingreso'].classList.add('tipo-active');
  els['mov-save-btn'].disabled = false;
}

(async () => {

console.log('\n1) Dos toques seguidos, un solo cobro');
cargarVenta();
// La escritura queda colgada, como cuando Firebase tarda: ahí es cuando el
// de adelante vuelve a apretar.
demora = () => new Promise(r => _esperas.push(r));
const primera = get('saveMov()');
const segunda = get('saveMov()');     // el segundo toque, con la primera en curso
const tercera = get('saveMov()');     // y el tercero, por las dudas
soltarTodas();
await Promise.all([primera, segunda, tercera]);
ok(AGREGADOS.length === 1, 'entra UN movimiento, no tres', AGREGADOS.length);
ok(AGREGADOS[0].monto === 15000, 'por el monto de la venta', AGREGADOS[0].monto);

console.log('\n2) El botón avisa que está guardando');
cargarVenta();
demora = () => new Promise(r => _esperas.push(r));
const p2 = get('saveMov()');
ok(els['mov-save-btn'].disabled === true, 'mientras guarda, el botón no se puede tocar');
ok(/Guardando/.test(els['mov-save-btn'].textContent), 'y lo dice', els['mov-save-btn'].textContent);
soltarTodas();
await p2;
ok(els['mov-save-btn'].disabled === false, 'al terminar vuelve a estar disponible');

console.log('\n3) Si falla, se puede reintentar');
// Lo peor sería que un error dejara la traba puesta para siempre: el
// mostrador se quedaría sin poder cobrar hasta recargar la página.
cargarVenta();
demora = () => Promise.reject(new Error('sin internet'));
try { await get('saveMov()'); } catch { /* la app lo maneja adentro */ }
ok(get('_guardandoMov') === false, 'la traba se suelta aunque falle', get('_guardandoMov'));
demora = null;
cargarVenta();
await get('saveMov()');
ok(AGREGADOS.length === 1, 'y el reintento entra normal', AGREGADOS.length);

console.log('\n4) Una venta después de otra sí se puede');
cargarVenta();
await get('saveMov()');
const n1 = AGREGADOS.length;
cargarVenta();
await get('saveMov()');
ok(n1 === 1 && AGREGADOS.length === 1, 'dos ventas seguidas entran las dos (la traba no queda pegada)',
   [n1, AGREGADOS.length]);

console.log('\n5) El cobro desde Reparaciones, igual');
// Ahí zafaba de casualidad: al cerrar el cartel se borra `_cobroRepair` y la
// segunda pasada salía por eso. Dependía del orden de dos líneas.
const rep = leer('repairs.js');
const env = rep.slice(rep.indexOf('async function confirmarCobro()'), rep.indexOf('async function _confirmarCobroInterno'));
ok(/_cobrando\) return/.test(env) && /_cobrando = true/.test(env),
   'tiene su propia traba', env.slice(0, 260));
ok(/finally/.test(env), 'que se suelta pase lo que pase');
ok(/_btnCobro\.disabled = true/.test(env), 'y el botón se apaga mientras tanto');

console.log('\n6) Los otros cobros ya estaban cuidados');
const caja = leer('caja.js');
const ve = caja.slice(caja.indexOf('async function confirmVentaEquipo'), caja.indexOf('async function confirmVentaEquipo') + 6000);
ok(/btn\.disabled = true/.test(ve), 'la venta de un equipo apaga su botón');
const pp = caja.slice(caja.indexOf('async function confirmPlanPago'), caja.indexOf('async function confirmPlanPago') + 1200);
ok(/btn\.disabled = true/.test(pp), 'y la entrega de un plan ahorro también');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})().catch(e => { console.error('Error:', e); process.exit(1); });
