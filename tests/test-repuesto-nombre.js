// El nombre del repuesto en el buscador de caja tiene que incluir el modelo.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// DOM mínimo para poder correr caja.js
const els = {};
const el = id => els[id] = { id, value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  closest: () => null, focus() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
['mov-fi-desc', 'mov-desc-suggest', 'mov-fi-monto', 'mov-sale-item-info'].forEach(el);

const ctx = {
  console, setTimeout: () => 0, clearTimeout,
  document: { getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [],
              createElement: () => el('tmp'), addEventListener() {},
              body: { classList: { add() {}, remove() {}, contains: () => false } },
              documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } } },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node' },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({}) } } },
  requireAuth: () => Promise.resolve(null), showApp: () => {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'caja.js', 'utf8'), ctx, { filename: 'caja.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
run(`
  toast = () => {};
  esc = s => String(s == null ? '' : s);
  fmt = n => '$' + n;
  searchMatch = (campos, q) => !q || campos.some(c => String(c || '').toLowerCase().includes(String(q).toLowerCase()));
  getCurrentDolar = () => 1000;
  normalizeText = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  CAJA_STOCK = [];
  PRODUCTOS = [];
`);

// Las sugerencias se arman dentro de _onMovDescInput y se pasan a
// _showMovSuggestions: lo interceptamos para leer lo que realmente se muestra.
run(`
  _movTipo = 'ingreso';
  editingMovId = null;
  _showMovSuggestions = (results, q) => { __SUG_LIST = results; };
`);
function sugerencias(repuestos, q = 'a') {
  ctx.__REP = repuestos;
  run('CAJA_REPUESTOS = __REP');
  ctx.__SUG_LIST = [];
  els['mov-fi-desc'].value = q;
  run('_onMovDescInput()');
  return (ctx.__SUG_LIST || []).filter(x => x.source === 'repuesto');
}

console.log('\n1) El modelo aparece en el nombre');
const casos = [
  { caso: 'nombre corto + marca + modelo',
    r: { id: '1', nombre: 'Placa de carga', marca: 'Samsung', modelo: 'A54', tipo: 'Placa de carga', cantidad: 3, precioVenta: 12000 },
    esperado: 'Placa de carga Samsung A54' },
  { caso: 'el nombre ya trae todo (no duplicar)',
    r: { id: '2', nombre: 'Placa de carga Samsung A54', marca: 'Samsung', modelo: 'A54', tipo: 'Placa de carga', cantidad: 1, precioVenta: 1 },
    esperado: 'Placa de carga Samsung A54' },
  { caso: 'sin modelo cargado',
    r: { id: '3', nombre: 'Pin de carga', marca: 'Motorola', modelo: '', tipo: 'Pin', cantidad: 1, precioVenta: 1 },
    esperado: 'Pin de carga Motorola' },
  { caso: 'nombre con tilde y marca repetida en minúscula',
    r: { id: '4', nombre: 'Módulo samsung', marca: 'Samsung', modelo: 'A14', tipo: 'Módulo', cantidad: 1, precioVenta: 1 },
    esperado: 'Módulo samsung A14' },
  { caso: 'sin nombre, cae al tipo',
    r: { id: '5', nombre: '', marca: 'Xiaomi', modelo: 'Redmi 12', tipo: 'Placa de carga', cantidad: 1, precioVenta: 1 },
    esperado: 'Placa de carga Xiaomi Redmi 12' },
];

for (const { caso, r, esperado } of casos) {
  const res = sugerencias([r]);
  ok(res.length === 1, `${caso}: aparece en el buscador`, res);
  if (res.length) {
    ok(res[0].nombre === esperado, `${caso}: "${esperado}"`, res[0].nombre);
    if (r.modelo) {
      ok((res[0].nombre + ' ' + res[0].extra).includes(r.modelo),
         `${caso}: el modelo se ve en algún lado`, { nombre: res[0].nombre, extra: res[0].extra });
    }
  }
}

console.log('\n2) No se repite lo que ya está en el nombre');
const dup = sugerencias([casos[1].r])[0];
ok(!/Samsung.*Samsung/.test(dup.nombre + ' ' + dup.extra), 'la marca no sale dos veces', dup);
ok(dup.extra === '', 'si el nombre ya dice todo, el renglón de abajo queda vacío', dup.extra);

console.log('\n3) Lo que se guarda en el movimiento lleva el modelo');
const sug = sugerencias([casos[0].r])[0];
run('_cart = []; _selectedRepairItem = null; _repairAmt = 0;');
ctx.__SUG = sug;
run('_addToCart(__SUG)');
ok(get('_cart[0].nombre') === 'Placa de carga Samsung A54',
   'el carrito guarda el nombre completo (va al ticket y a los reportes)', get('_cart[0].nombre'));
ok(get('_cartSummary()').includes('A54'), 'el resumen de la venta también', get('_cartSummary()'));

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
