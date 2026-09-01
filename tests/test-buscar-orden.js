// Buscar una reparación por número de orden en el cobro de la caja.
// El bug: tipeabas el número y la orden no aparecía. Un número suelto pega por
// subcadena en los IMEI (15 dígitos) y en las capacidades del stock, y como
// las reparaciones iban forzadas al final de una lista cortada en 10, la orden
// buscada quedaba afuera.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── DOM mínimo ──────────────────────────────────────────────
const els = {};
const el = (id, extra = {}) => els[id] = Object.assign({
  id, value: '', textContent: '', innerHTML: '', checked: false, style: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  closest() { return null; }, focus() {}, setAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
}, extra);
['mov-fi-desc', 'mov-desc-suggest', 'mov-fi-monto', 'mov-sale-item-info', 'mov-hidden-cat',
 'mov-hidden-metodo', 'mov-resumen-total', 'mov-resumen-txt', 'mov-modal', 'mov-overlay',
 'mov-search', 'mov-search-clear'].forEach(id => el(id));

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
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node' },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({ __ts: 1 }) } } },
  _todayAR: () => '2026-08-20',
  toast: () => {}, confirm: () => true, alert: () => {},
  getCurrentDolar: () => 1000, getDeviceId: () => 'test',
  requireAuth: () => Promise.resolve(null), showApp: () => {},
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'caja.js', 'utf8'), ctx, { filename: 'caja.js' });
// searchMatch y normalizeText son las DE VERDAD (utils.js): el bug depende de
// que searchMatch busque por subcadena. Se sacan del archivo real en vez de
// escribir una copia, así la prueba no se queda con una versión vieja.
const utils = fs.readFileSync(DIR + 'utils.js', 'utf8');
const desde = utils.indexOf('function normalizeText');
const hasta = utils.indexOf('\n}', utils.indexOf('function searchMatch')) + 2;
if (desde < 0 || hasta < 2) throw new Error('no se encontró normalizeText/searchMatch en utils.js');
vm.runInContext(utils.slice(desde, hasta), ctx, { filename: 'utils.js' });

const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
run(`db = null; esc = s => String(s == null ? '' : s); fmt = n => '$' + n;
     toast = () => {}; _movTipo = 'ingreso'; editingMovId = null;`);

// ── Datos: stock lleno de números que ensucian ──────────────
// IMEIs con "1287" adentro y un montón de equipos de 128 GB.
const STOCK = [];
for (let i = 0; i < 20; i++) {
  STOCK.push({ id: 'e' + i, marca: 'Samsung', modelo: 'A' + (30 + i), almacenamiento: '128 GB',
               imei: '35' + String(i).padStart(2, '0') + '1287' + '90123', precio: 300000, vendido: false });
}
const REPAIRS = [
  { id: 'r1', nOrden: 1287, nombre: 'Juan Pérez',  marca: 'Samsung', modelo: 'A54', arreglo: 'Pantalla',
    estado: 'listo', monto: 50000, sena: 10000 },
  { id: 'r2', nOrden: 128,  nombre: 'Ana Gómez',   marca: 'Motorola', modelo: 'G54', arreglo: 'Batería',
    estado: 'reparando', monto: 30000, sena: 0 },
  { id: 'r3', nOrden: 1288, nombre: 'Luis Díaz',   marca: 'Xiaomi', modelo: 'Note 12', arreglo: 'Puerto',
    estado: 'listo', monto: 20000, sena: 0 },
  { id: 'r4', nOrden: 9128, nombre: 'Sofía Ruiz',  marca: 'iPhone', modelo: '11', arreglo: 'Módulo',
    estado: 'reparando', monto: 90000, sena: 0 },
  { id: 'r5', nOrden: 1290, nombre: 'Cancelada',   marca: 'LG', modelo: 'K50', arreglo: 'x',
    estado: 'no va', monto: 1000, sena: 0 },
  { id: 'r6', nOrden: 1291, nombre: 'Ya entregada', marca: 'LG', modelo: 'K51', arreglo: 'x',
    estado: 'entregado', cobrado: true, monto: 1000, sena: 0 },
];
ctx.__STOCK = STOCK; ctx.__REPAIRS = REPAIRS;
run('CAJA_STOCK = __STOCK; CAJA_REPAIRS = __REPAIRS; CAJA_REPUESTOS = []; PRODUCTOS = [];');

// Tipear en el buscador y devolver lo que quedó en la lista
function buscar(q) {
  els['mov-fi-desc'].value = q;
  run('_onMovDescInput()');
  return els['mov-desc-suggest']._results || [];
}
const ordenes = res => res.filter(r => r.source === 'repair').map(r => r.repair.nOrden);

console.log('\n1) El número exacto de la orden sale PRIMERO');
let res = buscar('1287');
ok(res.length > 0, 'muestra algo', res.length);
ok(res[0] && res[0].source === 'repair', 'el primer resultado es una reparación',
   res[0] && { src: res[0].source, nom: res[0].nombre });
ok(res[0] && res[0].repair && res[0].repair.nOrden === 1287, 'y es la orden 1287', res[0] && res[0].nombre);
// Los 12 equipos con 1287 en el IMEI también matchean: antes se comían el corte
ok(res.some(r => r.source === 'equipo'), 'los equipos con ese número en el IMEI siguen apareciendo');

console.log('\n2) Aunque haya más resultados que lugares, la orden no se pierde');
ok(res.length <= 10, 'la lista sigue cortada en 10', res.length);
ok(ordenes(res).includes(1287), 'la orden buscada está en la lista', ordenes(res));

console.log('\n3) Prefijo: escribís los primeros dígitos');
res = buscar('128');
const ord3 = ordenes(res);
ok(ord3.includes(128), 'sale la orden 128 (coincidencia exacta)', ord3);
ok(res[0] && res[0].repair && res[0].repair.nOrden === 128, 'y va primera: la exacta le gana al prefijo', res[0].nombre);
ok(ord3.includes(1287) && ord3.includes(1288), 'y también las que empiezan con 128', ord3);
ok(res.filter(r => r.source === 'repair').length >= 3, 'entran al menos 3 reparaciones aunque haya 20 equipos de 128 GB',
   res.filter(r => r.source === 'repair').length);

console.log('\n4) También encuentra por dígitos del medio');
res = buscar('287');
ok(ordenes(res).includes(1287), '"287" encuentra la orden 1287', ordenes(res));
// Pero la que empieza con 287 tendría que ir antes que la que lo contiene
res = buscar('9128');
ok(res[0] && res[0].repair && res[0].repair.nOrden === 9128, 'la exacta primero', res[0].nombre);

console.log('\n5) Las que no van, no salen');
res = buscar('1290');
ok(!ordenes(res).includes(1290), 'una cancelada no aparece', ordenes(res));
res = buscar('1291');
ok(!ordenes(res).includes(1291), 'una ya cobrada y entregada tampoco', ordenes(res));

console.log('\n6) Buscar por nombre sigue funcionando igual');
res = buscar('juan');
ok(ordenes(res).includes(1287), 'encuentra por el nombre del cliente', ordenes(res));
res = buscar('samsung');
ok(res.length > 0 && res[0] && res[0].source === 'equipo',
   'con texto, los productos y equipos siguen primero (no se cambió ese orden)',
   res[0] && res[0].source);

console.log('\n7) Un número no rompe la búsqueda de equipos');
// Buscar por IMEI completo sigue trayendo el equipo: es como se vende un usado.
res = buscar('3500128790123');
ok(res.some(r => r.source === 'equipo' && r.id === 'e0'), 'el IMEI completo encuentra su equipo',
   res.map(r => r.source));

console.log('\n8) Sin reparaciones cargadas no explota');
run('CAJA_REPAIRS = []');
res = buscar('1287');
ok(Array.isArray(res), 'sigue devolviendo una lista', res.length);
run('CAJA_REPAIRS = __REPAIRS');

console.log('\n9) El corte reserva lugares para reparaciones');
const muchos = [];
for (let i = 0; i < 20; i++) muchos.push({ source: 'producto', id: 'p' + i, nombre: 'Prod ' + i });
for (let i = 0; i < 5; i++) muchos.push({ source: 'repair', id: 'x' + i, nombre: 'Rep ' + i, repair: { nOrden: i } });
ctx.__M = muchos;
const cortado = get('_cortarSugerencias(__M)');
ok(cortado.length === 10, 'devuelve 10', cortado.length);
ok(cortado.filter(r => r.source === 'repair').length === 3, 'de los cuales 3 son reparaciones',
   cortado.filter(r => r.source === 'repair').length);
ok(cortado[0].id === 'p0', 'respeta el orden que dejó el sort', cortado[0].id);
ok(get('_cortarSugerencias(__M.slice(0,4))').length === 4, 'si entra todo, no toca nada');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
