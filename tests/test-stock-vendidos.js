// El stock se lee en dos partes (cupo de Firebase).
//
// Antes la app se enganchaba a la colección `stock` ENTERA en cada apertura:
// cada celular vendido hace años se volvía a leer y a cobrar, en cada aparato.
// Era la lectura más cara que tenía la app.
//
// Ahora lo que está en el local va en vivo, y lo vendido se pide solo cuando
// hace falta. Lo que se vigila acá: que con el uso normal del día (filtro "En
// stock") no se lea NADA de más, y que cuando se piden las ventas no se
// muestren números a medias.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const els = {};
const mk = id => els[id] = { id, value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
  options: [{}], remove() {}, appendChild() {}, checked: false,
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  addEventListener() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] };
['f-vendido', 'f-marca', 'f-estado', 'f-vendedor', 'search', 'stock-list', 'empty-state',
 's-stock', 's-sold', 's-exhibicion', 's-deposito', 'low-qty-banner', 'sort-select',
 'tab-ventas', 'tab-entradas', 'stats-modal', 'stats-body'].forEach(mk);
els['f-vendido'].value = '0';

const LECTURAS = [];     // cada .get() a Firestore
const TOASTS = [];
let FALLA_GET = false;
const ESCRITURAS = [];

const ctx = {
  console, Date, Math, JSON, Promise, Number, String, Set, Map, Array,
  setTimeout: () => 0, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  document: {
    getElementById: id => els[id] || mk(id),
    querySelector: () => null, querySelectorAll: () => [], createElement: () => mk('tmp'),
    addEventListener() {}, body: { style: {}, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
    documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { search: '' } },
  navigator: { userAgent: 'node', onLine: true },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  toast: (m, t) => TOASTS.push([t, m]),
  URLSearchParams, location: { search: '' },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({}) } } },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);

// Firestore falso: el stock partido en dos
const EN_LOCAL = [
  { id: 'a1', marca: 'Samsung', modelo: 'A54', vendido: false, precio: 350000, fecha: '2026-09-10T10:00:00.000Z' },
  { id: 'a2', marca: 'Motorola', modelo: 'G54', vendido: false, precio: 290000, fecha: '2026-09-12T10:00:00.000Z' },
];
const VENDIDOS = [
  { id: 'v1', marca: 'Apple', modelo: 'iPhone 11', vendido: true, precio: 480000, fecha: '2026-01-05T10:00:00.000Z', fecha_venta: '2026-02-01T10:00:00.000Z' },
  { id: 'v2', marca: 'Xiaomi', modelo: 'Note 12', vendido: true, precio: 250000, fecha: '2026-03-05T10:00:00.000Z', fecha_venta: '2026-04-01T10:00:00.000Z' },
  { id: 'v3', marca: 'Samsung', modelo: 'A32', vendido: true, precio: 180000, fecha: '2025-06-05T10:00:00.000Z', fecha_venta: '2025-07-01T10:00:00.000Z' },
];
let ENGANCHE = null;     // callback del listener en vivo

function q(col, filtros = []) {
  return {
    where: (campo, op, val) => q(col, [...filtros, [campo, op, val]]),
    orderBy: () => q(col, filtros), limit: () => q(col, filtros),
    onSnapshot: (a, b) => {
      const cb = typeof a === 'function' ? a : b;
      if (col === 'stock') ENGANCHE = { filtros, cb };
      return () => {};
    },
    get: async () => {
      LECTURAS.push({ col, filtros });
      if (FALLA_GET) throw Object.assign(new Error('x'), { code: 'resource-exhausted' });
      const vend = filtros.find(f => f[0] === 'vendido');
      const docs = col !== 'stock' ? [] : (vend && vend[2] === true ? VENDIDOS : EN_LOCAL);
      return { size: docs.length, docs: docs.map(d => ({ id: d.id, data: () => d })), empty: !docs.length };
    },
    doc: id => ({
      id,
      get: async () => { LECTURAS.push({ col, doc: id }); return { exists: false, data: () => ({}) }; },
      set: async d => { ESCRITURAS.push([col, id, d]); },
      update: async d => { ESCRITURAS.push([col, id, d]); },
    }),
    add: async () => ({ id: 'x' }),
  };
}
ctx.__DB = { collection: n => q(n), batch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }) };

vm.runInContext(fs.readFileSync(DIR + 'utils.js', 'utf8').split('//  LLAMADAS A NUESTRAS FUNCIONES DE /api')[0], ctx, { filename: 'utils.js' });
// requireAuth/showApp viven en auth.js, que este harness no carga
vm.runInContext('var requireAuth = () => Promise.resolve(null); var showApp = () => {};', ctx);
vm.runInContext(fs.readFileSync(DIR + 'app.js', 'utf8'), ctx, { filename: 'app.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
run(`
  db = __DB;
  toast = (m, t) => __TOAST(m, t);
  esc = s => String(s == null ? '' : s); fmt = n => '$' + n;
  searchMatch = () => true; buildPriceChips = () => ''; buildPriceTable = () => '';
  buildPhotoGalleryHTML = () => ''; _refreshDashIfVisible = () => {};
  updateSyncPill = () => {}; syncReport = () => {}; dolarBlue = 1500;
  renderStatsVentas = () => { __LLAMADAS.push('statsVentas'); };
  renderStatsEntradas = () => {};
`);
ctx.__TOAST = (m, t) => TOASTS.push([t, m]);
ctx.__LLAMADAS = [];

const enganchar = () => {
  run('listenStock()');
  const snap = {
    size: EN_LOCAL.length,
    docs: EN_LOCAL.map(d => ({ id: d.id, data: () => d })),
    docChanges: () => EN_LOCAL,
  };
  ENGANCHE.cb(snap);
};
const idsEnLista = () => get('STOCK').map(p => p.id).sort().join(',');

(async () => {

console.log('\n1) Al abrir, solo lo que está en el local');
LECTURAS.length = 0;
enganchar();
const filtroVivo = ENGANCHE.filtros.find(f => f[0] === 'vendido');
ok(!!filtroVivo && filtroVivo[2] === false,
   'el listener en vivo pide vendido == false (antes: la colección entera)', ENGANCHE.filtros);
ok(LECTURAS.length === 0, 'y no se lee ningún vendido', LECTURAS);
ok(idsEnLista() === 'a1,a2', 'la lista muestra los equipos del local', idsEnLista());
ok(get('vendidosListos()') === false, 'los vendidos todavía no están');

console.log('\n2) El contador de vendidos no miente');
ok(els['s-sold'].textContent === '–', 'muestra un guion, no "0" (que se leería como "no vendiste nada")', els['s-sold'].textContent);
ok(String(els['s-stock'].textContent) === '2', 'y los del local sí se cuentan', els['s-stock'].textContent);

console.log('\n3) Trabajar el día no cuesta lecturas');
LECTURAS.length = 0;
els['f-vendido'].value = '0';
run('render(); render(); render()');
ok(LECTURAS.length === 0, 'con el filtro en "En stock" no se lee nada', LECTURAS);

console.log('\n4) Recién al mirar los vendidos se los trae');
els['f-vendido'].value = '1';
run('render()');
await new Promise(r => setImmediate(r));
ok(LECTURAS.length === 1 && LECTURAS[0].filtros.some(f => f[0] === 'vendido' && f[2] === true),
   'una sola consulta, acotada a los vendidos', LECTURAS);
ok(get('vendidosListos()') === true, 'quedan cargados');
ok(idsEnLista() === 'a1,a2,v1,v2,v3', 'y aparecen en la lista', idsEnLista());
ok(String(els['s-sold'].textContent) === '3', 'ahora sí se cuentan', els['s-sold'].textContent);

console.log('\n5) No se vuelve a leer todo el tiempo');
LECTURAS.length = 0;
run('render(); render()');
els['f-vendido'].value = '';
run('render()');
ok(LECTURAS.length === 0, 'ya están en memoria', LECTURAS);
// Y al reabrir la app quedan guardados unas horas
run('_stockVendidos = []; _vendidosCargados = false;');
LECTURAS.length = 0;
await get('cargarVendidos()');
ok(LECTURAS.length === 0, 'al reabrir salen de lo guardado en el celu, sin leer Firebase', LECTURAS);
ok(get('_stockVendidos').length === 3, 'con los 3 equipos', get('_stockVendidos').length);

console.log('\n6) Estadísticas y exportar los piden solos');
run("localStorage.removeItem('stockVendidosCache'); _stockVendidos = []; _vendidosCargados = false;");
LECTURAS.length = 0;
await get('openStats()');
ok(LECTURAS.length === 1, 'abrir estadísticas trae las ventas', LECTURAS.length);
ok(get('vendidosListos()') === true, 'y quedan listas');

console.log('\n7) El backup diario no se guarda a medias');
// Si los vendidos no se pudieron traer, guardar la copia del día sin ellos
// sería peor que no guardarla: parecería que el stock es solo eso.
run("localStorage.removeItem('stockVendidosCache'); localStorage.removeItem('lastAutoBackup'); _stockVendidos = []; _vendidosCargados = false;");
FALLA_GET = true;
ESCRITURAS.length = 0;
await get('autoBackup()');
ok(!ESCRITURAS.some(e => e[0] === 'backups'), 'sin los vendidos, no escribe el backup', ESCRITURAS);
ok(get("localStorage.getItem('lastAutoBackup')") === null, 'y no lo da por hecho');
FALLA_GET = false;
ESCRITURAS.length = 0;
await get('autoBackup()');
const bk = ESCRITURAS.find(e => e[0] === 'backups');
ok(!!bk, 'con los vendidos disponibles, sí lo guarda');
ok(bk && bk[2].stock.length === 5, 'y lleva el stock completo (local + vendidos)', bk && bk[2].stock.length);

console.log('\n8) Un equipo que se vende no queda duplicado');
// Sale del listener en vivo (ya no cumple vendido == false)
EN_LOCAL.splice(1, 1);                       // se vendió el Motorola
VENDIDOS.push({ id: 'a2', marca: 'Motorola', modelo: 'G54', vendido: true, precio: 290000, fecha: '2026-09-12T10:00:00.000Z', fecha_venta: '2026-09-17T10:00:00.000Z' });
run('_stockVendidos = [...__V]', Object.assign(ctx, { __V: VENDIDOS }));
ctx.__V = VENDIDOS;
run('_stockVendidos = __V.map(x => ({ ...x })); _vendidosCargados = true;');
ENGANCHE.cb({ size: EN_LOCAL.length, docs: EN_LOCAL.map(d => ({ id: d.id, data: () => d })), docChanges: () => EN_LOCAL });
const ids = get('STOCK').map(p => p.id);
ok(new Set(ids).size === ids.length, 'cada equipo aparece una sola vez', ids);
ok(get('STOCK').find(p => p.id === 'a2').vendido === true, 'y figura como vendido', get('STOCK').find(p => p.id === 'a2'));

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
