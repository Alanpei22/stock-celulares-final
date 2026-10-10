// Dar de baja lo que se rompe antes de venderse.
//
// Los vidrios templados y el hidrogel a veces vienen rotos de fábrica y a
// veces se rompen colocándolos. Esas unidades salen del stock igual que si se
// vendieran, pero no entró plata: sin descontarlas, el inventario dice que hay
// veinte y hay diecisiete.
//
// Los dos motivos se separan a propósito: "vino roto" es un reclamo al
// proveedor, "se rompió colocándolo" es costo del trabajo. Mezclados, el
// número no sirve para decidir nada.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = {};
const el = id => els[id] = {
  id, value: '', textContent: '', innerHTML: '', checked: false, style: {}, dataset: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  focus() {}, blur() {}, setAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  remove() { delete els[this.id]; },
};
['inv-fi-cod', 'inv-fi-nom', 'inv-fi-cat', 'inv-fi-pv', 'inv-fi-costoUSD', 'inv-fi-stock',
 'inv-fi-stockmin', 'inv-fi-activo', 'inv-list', 'inv-empty', 'inv-search', 'inv-f-cat',
 'inv-f-estado', 'inv-s-total', 'inv-s-bajo', 'inv-s-valor', 'inv-form-modal',
 'inv-form-title', 'inv-form-del', 'inv-form-etq', 'inv-form-rotura', 'inv-form-save-otro',
 'inv-mon-ars', 'inv-mon-usd', 'inv-fi-costoARS-hint'].forEach(el);

const TOASTS = [], MERMAS = [], UPDATES = [];
let CONFIRMA = true, LEIDAS = [], FILTRO = null, DUENO = true, FALLAR = false;

const ctx = {
  console, setTimeout: f => f(), clearTimeout, Date, Math, JSON, Number, String, Set, Map,
  parseInt, parseFloat, isNaN,
  document: {
    getElementById: id => els[id] || el(id),
    querySelector: () => null,
    querySelectorAll: sel => (sel.includes('rot-motivo') ? (ctx.__BOTONES || []) : []),
    createElement: () => el('creado-' + Math.random()),
    addEventListener() {},
    body: { style: {}, appendChild(n) { els[n.id] = n; },
            classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: '' } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node' },
  esc: s => String(s == null ? '' : s), fmtNum: n => String(n),
  toast: (m, t) => TOASTS.push([t || 'info', m]),
  confirm: () => CONFIRMA, alert: () => {}, prompt: () => null,
  searchMatch: () => true, dolarBlue: 1200,
  _todayAR: () => '2026-10-10',
  tpFirma: () => ({ cargadoPor: 'Alan', cargadoPorUid: 'u1' }),
  _cajaIsOwner: true,
  db: {
    collection: nombre => ({
      add: async d => { if (FALLAR === 'merma') throw new Error('sin internet'); MERMAS.push({ col: nombre, data: d }); return { id: 'm1' }; },
      doc: id => ({ update: async d => { if (FALLAR === 'stock') throw new Error('sin internet'); UPDATES.push({ col: nombre, id, data: d }); },
                    get: async () => ({ exists: false, data: () => ({}) }), set: async () => {} }),
      where: (campo, op, val) => { FILTRO = { campo, op, val }; return { get: async () => ({ docs: LEIDAS.map(x => ({ id: x.id || 'x', data: () => x })) }) }; },
    }),
  },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({ __ts: true }) } } },
};
ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(leer('inventario.js'), ctx, { filename: 'inventario.js' });
const run = e => vm.runInContext(e, ctx);
// Los campos del cartel estan dentro de su innerHTML: en este DOM de mentira
// se piden por la misma puerta que usa el codigo.
const E = id => els[id] || el(id);
const get = e => vm.runInContext(e, ctx);
run('toast = (m, t) => __T(m, t); renderInventario = () => {}; closeProductoForm = () => { __CERRO(); };');
ctx.__T = (m, t) => TOASTS.push([t || 'info', m]);
let CERRO = 0;
ctx.__CERRO = () => { CERRO++; };
run(`PRODUCTOS = [
  { id:'p1', nombre:'Vidrio templado iPhone 15', codigo:'TP00041', categoria:'Vidrio templado / Hidrogel',
    stock:20, precioVenta:4500, precioCosto:1500, activo:true },
  { id:'p2', nombre:'Hidrogel A54', codigo:'TP00042', categoria:'Vidrio templado / Hidrogel',
    stock:2, precioVenta:3000, precioCosto:900, activo:true }
];`);

(async () => {

console.log('\n1) Dar de baja desde la ficha');
ok(/id="inv-form-rotura"/.test(leer('caja.html')), 'hay un botón en la ficha del artículo');
run("_invEditingId = 'p1'");
run('invRotura()');
ok(!!els['inv-rotura-modal'], 'se abre el cartel');
const html = els['inv-rotura-modal'].innerHTML;
ok(/Vidrio templado iPhone 15/.test(html), 'dice qué artículo es');
ok(/hay 20 en stock/.test(html), 'y cuántos figuran, para darse cuenta si no cierra', html.slice(0, 300));
ok(/Vino roto/.test(html) && /Se rompió colocándolo/.test(html), 'con los dos motivos que importan');

console.log('\n2) Descuenta del stock y deja registro');
E('inv-rot-cant').value = '3';
E('inv-rot-nota').value = 'caja del 3/10';
run("_invRoturaMotivo = 'proveedor'");
await run('guardarRotura()');

const mer = MERMAS.find(m => m.col === 'mermas');
ok(!!mer, 'queda el registro de la rotura', MERMAS.map(m => m.col));
ok(mer.data.cantidad === 3 && mer.data.motivo === 'proveedor', 'con cuántos y por qué', mer.data);
ok(mer.data.productoId === 'p1' && mer.data.nombre === 'Vidrio templado iPhone 15',
   'y de qué artículo', mer.data);
ok(mer.data.costoUnit === 1500 && mer.data.costoTotal === 4500,
   'con el costo, que es lo que perdiste', mer.data);
ok(mer.data.fecha === '2026-10-10', 'con la fecha argentina', mer.data.fecha);
ok(mer.data.cargadoPor === 'Alan', 'y quién lo cargó', mer.data.cargadoPor);
ok(mer.data.nota === 'caja del 3/10', 'la nota se guarda: sirve para el reclamo', mer.data.nota);

const upd = UPDATES.find(u => u.col === 'productos');
ok(upd && upd.id === 'p1' && upd.data.stock.__inc === -3, 'y el stock baja 3', UPDATES);

// No toca la caja: esa plata salió cuando compraste la caja de vidrios.
ok(!MERMAS.some(m => m.col === 'caja_movimientos') && !UPDATES.some(u => u.col === 'caja_movimientos'),
   'no se carga como gasto del día: sería contar el mismo peso dos veces',
   MERMAS.concat(UPDATES).map(x => x.col));

console.log('\n3) El orden importa');
// Si fallara el descuento, el número del stock lo ves en pantalla y lo
// corregís. Un motivo que no se guardó no te enterás nunca.
const src = leer('inventario.js');
const bloque = src.slice(src.indexOf('async function guardarRotura'), src.indexOf('async function abrirRoturas'));
ok(bloque.indexOf("collection('mermas')") < bloque.indexOf("collection('productos')"),
   'el registro se escribe antes que el descuento');

MERMAS.length = 0; UPDATES.length = 0;
FALLAR = 'merma';
const grito = [console.warn, console.error];
console.warn = console.error = () => {};   // el fallo es a proposito
run("_invEditingId = 'p1'"); run('invRotura()');
E('inv-rot-cant').value = '1';
await run('guardarRotura()');
FALLAR = false;
[console.warn, console.error] = grito;
ok(UPDATES.length === 0, 'si no se pudo registrar, tampoco se descuenta a ciegas', UPDATES);
ok(TOASTS.some(t => t[0] === 'error'), 'y avisa', TOASTS[TOASTS.length - 1]);

console.log('\n4) No deja el stock en negativo');
MERMAS.length = 0; UPDATES.length = 0;
run("_invEditingId = 'p2'");   // tiene 2
run('invRotura()');
E('inv-rot-cant').value = '5';
CONFIRMA = false;
await run('guardarRotura()');
ok(MERMAS.length === 0, 'dando de baja más de lo que hay, pregunta antes', MERMAS);
CONFIRMA = true;
run("_invEditingId = 'p2'"); run('invRotura()');
E('inv-rot-cant').value = '5';
await run('guardarRotura()');
ok(MERMAS[0].data.cantidad === 5, 'si confirmás, registra los 5 que se rompieron', MERMAS[0].data.cantidad);
ok(UPDATES[0].data.stock.__inc === -2, 'pero del stock saca 2, que es lo que había: no queda en negativo',
   UPDATES[0].data.stock);

console.log('\n5) Cantidad inválida');
MERMAS.length = 0;
run("_invEditingId = 'p1'"); run('invRotura()');
E('inv-rot-cant').value = '0';
await run('guardarRotura()');
ok(MERMAS.length === 0, 'cero no da de baja nada', MERMAS);

console.log('\n6) El informe del mes');
ok(/Roturas del mes/.test(leer('inventario.js')), 'está en el menú de Accesorios');
LEIDAS = [
  { id:'a', fecha:'2026-10-02', createdAt:'2026-10-02T10:00:00Z', nombre:'Vidrio A', cantidad:4, motivo:'proveedor',  costoTotal:6000, cargadoPor:'Alan' },
  { id:'b', fecha:'2026-10-05', createdAt:'2026-10-05T10:00:00Z', nombre:'Vidrio B', cantidad:2, motivo:'colocacion', costoTotal:3000, cargadoPor:'Dani' },
  { id:'c', fecha:'2026-10-07', createdAt:'2026-10-07T10:00:00Z', nombre:'Vidrio A', cantidad:5, motivo:'proveedor',  costoTotal:7500, cargadoPor:'Alan' },
];
await run('abrirRoturas()');
// CUPO: no se lee la colección entera, se acota al mes.
ok(FILTRO && FILTRO.campo === 'fecha' && FILTRO.val === '2026-10-01',
   'lee solo desde el 1° del mes, no la colección entera', FILTRO);
const inf = els['inv-roturas-modal'].innerHTML;
ok(/9 u\./.test(inf), 'suma 9 unidades del proveedor (4 + 5)', inf.match(/9 u\./g));
ok(/11 u\./.test(inf), 'y 11 en total', inf.match(/11 u\./g));
ok(/\$16\.500/.test(inf), 'con la plata que se perdió', (inf.match(/\$[\d.]+/g) || []));
ok(inf.indexOf('Vidrio A') < inf.indexOf('Vidrio B'), 'lo más nuevo primero');
ok(/Dani/.test(inf), 'y quién cargó cada una');

// El empleado ve las unidades pero no la plata, como en el resto de la app.
run('_cajaIsOwner = false');
await run('abrirRoturas()');
const inf2 = els['inv-roturas-modal'].innerHTML;
ok(/11 u\./.test(inf2), 'un empleado ve las unidades');
ok(!/\$16\.500/.test(inf2), 'pero no los pesos', (inf2.match(/\$[\d.]+/g) || []));
run('_cajaIsOwner = true');

LEIDAS = [];
await run('abrirRoturas()');
ok(/Ninguna rotura/.test(els['inv-roturas-modal'].innerHTML), 'sin roturas lo dice y no muestra una tabla vacía');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})().catch(e => { console.error('Error:', e); process.exit(1); });
