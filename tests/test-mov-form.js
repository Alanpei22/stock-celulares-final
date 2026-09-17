// El formulario de la caja: anotar una venta o un gasto.
//
// Tres cosas que estaban mal y se arreglaron acá:
//  1. La categoría se elegía SOLA (la primera de la lista). Si no te acordabas
//     de tocarla, toda venta rápida quedaba como "Venta equipo" y todo gasto
//     como "Compra repuesto": el desglose del día y las estadísticas mentían.
//  2. Se podía guardar igual, sin mirar nada.
//  3. Al cargar un producto desaparecía el bloque del monto y la pantalla
//     saltaba.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const els = {};
const mk = id => els[id] = {
  id, value: '', textContent: '', innerHTML: '', placeholder: '', disabled: false, readOnly: false,
  dataset: {}, style: {}, options: [{}], remove() {}, appendChild() {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (f ? this._s.add(c) : this._s.delete(c)); },
               contains(c) { return this._s.has(c); } },
  addEventListener() {}, focus() {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [],
};
['mov-fi-monto', 'mov-fi-desc', 'mov-categorias', 'mov-hidden-cat', 'mov-hidden-metodo', 'mov-cat-wrap',
 'mov-cat-auto', 'mov-cat-lbl', 'mov-metodo-lbl', 'mov-step-monto', 'mov-quick-amounts', 'mov-monto-hint',
 'mov-save-btn', 'mov-resumen-txt', 'mov-resumen-total', 'mov-btn-ingreso', 'mov-btn-egreso',
 'mov-cliente-section', 'mov-sale-item-info', 'mov-fi-usd', 'mov-usd-ars', 'mov-usd-dolar',
 'mov-fi-vuelto-pesos', 'mov-split-amt', 'split-remainder-val'].forEach(mk);

// Los chips de categoría que dibuja renderCatBtns
let CHIPS = [];
const ctx = {
  console, Date, Math, JSON, Promise, Number, String, Set, Map, Array, Object,
  setTimeout: () => 0, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  document: {
    getElementById: id => els[id] || mk(id),
    querySelectorAll: sel => (sel === '.cat-btn' ? CHIPS : []),
    querySelector: () => null, createElement: () => mk('tmp'), addEventListener() {},
    body: { style: {}, classList: { add() {}, remove() {}, contains: () => false } },
    documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { search: '' } },
  navigator: { userAgent: 'node', onLine: true },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  URLSearchParams, location: { search: '' },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({}) } } },
  _todayAR: () => '2026-09-17',
  requireAuth: () => Promise.resolve(null), showApp: () => {},
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(`
  var fmtNum = n => String(n); var fmtMoney = n => '$' + n;
  var safeListener = (p, c) => c();
`, ctx);
vm.runInContext(fs.readFileSync(DIR + 'inventario.js', 'utf8'), ctx, { filename: 'inventario.js' });
vm.runInContext(fs.readFileSync(DIR + 'caja.js', 'utf8'), ctx, { filename: 'caja.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
run(`
  db = { collection: () => ({ doc: () => ({ set: async () => {}, update: async () => {} }), where: () => ({ get: async () => ({ empty: true, docs: [] }) }), add: async () => ({ id: 'x' }) }) };
  toast = () => {}; esc = s => String(s == null ? '' : s); fmt = n => '$' + Number(n || 0).toLocaleString('es-AR');
  searchMatch = () => false; normalizeText = s => String(s || '');
  getCurrentDolar = () => 1500; ensureDolar = () => {};
  renderMovimientos = () => {}; renderStats = () => {}; renderInventario = () => {};
`);
// renderCatBtns dibuja chips: acá se simulan para poder "tocarlos"
run(`
  renderCatBtns = tipo => { __CHIPS((CATEGORIAS[tipo] || [])); };
`);
ctx.__CHIPS = cats => {
  CHIPS = cats.map(c => ({ dataset: { cat: c },
    classList: { _s: new Set(), add(x) { this._s.add(x); }, remove(x) { this._s.delete(x); },
                 toggle(x, f) { f ? this._s.add(x) : this._s.delete(x); }, contains(x) { return this._s.has(x); } } }));
};

const cat = () => els['mov-hidden-cat'].value;
const btn = () => els['mov-save-btn'];

console.log('\n1) La categoría NO se elige sola');
run(`setMovTipo('ingreso')`);
ok(cat() === '', 'al abrir un ingreso no hay categoría puesta', cat());
ok(CHIPS.every(c => !c.classList.contains('cat-active')), 'ningún chip queda marcado');
run(`setMovTipo('egreso')`);
ok(cat() === '', 'y en un gasto tampoco', cat());

console.log('\n2) Sin categoría no se puede guardar');
run(`setMovTipo('ingreso'); document.getElementById('mov-fi-monto').value = '50000'; _updateMovResumen();`);
ok(btn().disabled === true, 'el botón queda bloqueado', btn().disabled);
ok(/categoría/i.test(btn().textContent), 'y dice qué falta', btn().textContent);
run(`selectCat('Venta producto')`);
ok(btn().disabled === false, 'al elegirla se destraba');
ok(/Cobrar/.test(btn().textContent), 'y vuelve a decir el monto', btn().textContent);

console.log('\n3) En un gasto habla de gasto, no de venta');
run(`setMovTipo('egreso'); document.getElementById('mov-fi-monto').value = '8000'; _updateMovResumen();`);
ok(/rubro/i.test(btn().textContent), 'pide el rubro del gasto', btn().textContent);
ok(els['mov-cat-lbl'].textContent === 'Rubro del gasto', 'el rótulo cambia', els['mov-cat-lbl'].textContent);
ok(els['mov-metodo-lbl'].textContent === 'Con qué se pagó', 'y el del método', els['mov-metodo-lbl'].textContent);
ok(/gast/i.test(els['mov-fi-desc'].placeholder), 'el campo de texto también', els['mov-fi-desc'].placeholder);
run(`selectCat('Gasto fijo')`);
ok(/gasto/i.test(btn().textContent) && !btn().disabled, 'con rubro elegido, confirma el gasto', btn().textContent);

console.log('\n4) Con productos, el monto no desaparece: queda calculado');
run(`setMovTipo('ingreso'); _cart = [{ source: 'prod', id: 'p1', nombre: 'Vidrio', precio: 8000, qty: 1, stock: 5 }]; _updateMovResumen();`);
ok(!els['mov-step-monto'].classList.contains('hidden'), 'el bloque del monto sigue en pantalla (antes se escondía y saltaba todo)');
ok(els['mov-fi-monto'].readOnly === true, 'pero no se escribe a mano: lo manda la lista');
ok(!els['mov-monto-hint'].classList.contains('hidden'), 'y se explica de dónde sale');
ok(els['mov-quick-amounts'].classList.contains('hidden'), 'los botones de +5k/+10k se van (descuadraban el total)');

console.log('\n5) La categoría deducida se ve');
// Con productos cargados los chips se esconden porque se deduce sola: si no se
// muestra en algún lado, el movimiento queda categorizado por arte de magia.
run(`selectCat('Venta producto'); _updateMovResumen();`);
ok(els['mov-cat-wrap'].classList.contains('hidden'), 'los chips se esconden con carrito');
ok(!els['mov-cat-auto'].classList.contains('hidden'), 'pero aparece el renglón que dice cuál quedó');
ok(/Venta producto/.test(els['mov-cat-auto'].innerHTML), 'con el nombre de la categoría', els['mov-cat-auto'].innerHTML);
run(`_cart = []; _updateMovResumen();`);
ok(els['mov-cat-auto'].classList.contains('hidden'), 'sin carrito, el renglón se va y vuelven los chips');

console.log('\n6) El formulario quedó sin los pasos numerados');
const html = fs.readFileSync(DIR + 'caja.html', 'utf8');
ok(!/mov-step-hdr/.test(html), 'se fueron los títulos 1/2/3 (tres renglones de pantalla en un celu)');
ok(!/id="mov-step1-lbl"/.test(html) && !/id="mov-step3-lbl"/.test(html), 'y sus rótulos');
ok(html.indexOf('id="mov-fi-monto"') < html.indexOf('id="mov-fi-desc"'),
   'el monto va PRIMERO: es lo único que se carga siempre');
const js = fs.readFileSync(DIR + 'caja.js', 'utf8');
ok(!/selectCat\(cats\[0\]/.test(js), 'y no queda ninguna autoselección de categoría');

console.log('\n7) Lo que ya andaba, sigue andando');
run(`setMovTipo('ingreso'); selectCat('Venta equipo'); selectMetodo('Efectivo'); document.getElementById('mov-fi-monto').value = '120000'; _updateMovResumen();`);
ok(get(`document.getElementById('mov-hidden-metodo').value`) === 'Efectivo', 'el método sigue guardándose', get(`document.getElementById('mov-hidden-metodo').value`));
ok(els['mov-resumen-total'].textContent === '$120.000', 'el total del pie', els['mov-resumen-total'].textContent);

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
