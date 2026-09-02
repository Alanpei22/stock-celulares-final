// Buscador de ventas (el de "todas las fechas", 🔎 del menú de la caja).
// Estaba comparando con includes() sobre el texto en minúsculas: buscar
// "reparacion" no encontraba "Reparación" y por el monto no se podía buscar.
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
['vsearch-overlay','vsearch-modal','vsearch-input','vsearch-chips','vsearch-info','vsearch-results',
 'mov-search'].forEach(id => el(id));

const ctx = {
  console, setTimeout: f => { f(); return 0; }, clearTimeout, requestAnimationFrame: f => f(),
  document: {
    getElementById: id => els[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el('tmp'), addEventListener: () => {},
    body: { style: {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } },
    documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, style: { setProperty() {} } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: '' } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node' },
  firebase: { firestore: { FieldValue: { increment: n => n, delete: () => null } } },
  _todayAR: () => '2026-09-01',
  confirm: () => true, alert: () => {},
  getCurrentDolar: () => 1000, getDeviceId: () => 'test',
  requireAuth: () => Promise.resolve(null), showApp: () => {},
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'caja.js', 'utf8'), ctx, { filename: 'caja.js' });
// searchMatch / normalizeText DE VERDAD (utils.js): el arreglo depende de que
// normalicen los acentos.
const utils = fs.readFileSync(DIR + 'utils.js', 'utf8');
vm.runInContext(utils.slice(utils.indexOf('function normalizeText'),
                            utils.indexOf('\n}', utils.indexOf('function searchMatch')) + 2),
                ctx, { filename: 'utils.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);

let CONSULTAS = 0, DESDE = null;
ctx.__DB = {
  collection: () => ({
    where: (campo, op, val) => { DESDE = val; return { get: async () => { CONSULTAS++; return { docs: MOVS.map(m => ({ id: m.id, data: () => m })) }; } }; },
  }),
};
run(`db = __DB;
     esc = s => String(s == null ? '' : s);
     fmt = n => '$' + Number(n || 0).toLocaleString('es-AR');
     toast = () => {};
     _metodoInfo = () => ({ cls: 'x', icon: '💵', short: 'Efectivo' });
     metodoCanonico = m => m || 'Efectivo';`);

const MOVS = [
  { id:'m1', tipo:'ingreso', fecha:'2026-08-14', createdAt:'2026-08-14T15:00:00.000Z',
    categoria:'Reparación', descripcion:'Cobro reparación N°1287', monto: 50000,
    metodoPago:'Efectivo', repairNOrden: 1287, clienteNombre:'Juan Pérez' },
  { id:'m2', tipo:'ingreso', fecha:'2026-08-20', createdAt:'2026-08-20T12:00:00.000Z',
    categoria:'Venta equipo', descripcion:'Venta: Samsung Galaxy A54 · IMEI 356789102345678',
    monto: 520000, metodoPago:'Transferencia', clienteNombre:'Ana Gómez' },
  { id:'m3', tipo:'egreso', fecha:'2026-08-21', createdAt:'2026-08-21T10:00:00.000Z',
    categoria:'Compra repuesto', descripcion:'Repuesto: módulo iPhone 11', monto: 90000,
    metodoPago:'Efectivo' },
  { id:'m4', tipo:'ingreso', fecha:'2026-08-25', createdAt:'2026-08-25T18:00:00.000Z',
    categoria:'Venta producto', descripcion:'Funda + vidrio templado', monto: 12000,
    metodoPago:'MercadoPago', vendedor:'Alan' },
];

const buscar = (q, tipo) => {
  els['vsearch-input'].value = q;
  if (tipo) run(`_vsTipo = '${tipo}'`);
  run('_vsearchRender()');
  return get('_vsFiltrar(_vsCache[_vsPeriodo] || [], ' + JSON.stringify(q) + ', _vsTipo)');
};
const ids = r => r.map(m => m.id).sort().join(',');

(async () => {

// openVentasSearch dispara la carga pero no la espera (no es async): en el
// harness hay que esperarla a mano para que el cache esté lleno.
run('openVentasSearch()');
await get('_vsLoad(90)');

console.log('\n1) Los acentos ya no rompen la búsqueda');
// Este era EL problema: se comparaba con includes() sobre minúsculas.
ok(ids(buscar('reparacion')) === 'm1', '"reparacion" encuentra "Reparación"', ids(buscar('reparacion')));
ok(ids(buscar('Reparación')) === 'm1', 'y escribiéndolo con acento también');
ok(ids(buscar('modulo')) === 'm3', '"modulo" encuentra "módulo"', ids(buscar('modulo')));
ok(ids(buscar('perez')) === 'm1', '"perez" encuentra al cliente "Pérez"', ids(buscar('perez')));

console.log('\n2) Buscar por monto (no se podía)');
ok(ids(buscar('50000')) === 'm1', '"50000" encuentra la venta de $50.000', ids(buscar('50000')));
ok(ids(buscar('50.000')) === 'm1', 'y escrito con puntos también');
ok(ids(buscar('520000')) === 'm2', 'otro monto', ids(buscar('520000')));

console.log('\n3) Buscar por fecha');
ok(ids(buscar('14/08/2026')) === 'm1', 'como uno se acuerda: 14/08/2026', ids(buscar('14/08/2026')));
ok(ids(buscar('2026-08-20')) === 'm2', 'y en el formato de la base');

console.log('\n4) Lo que ya andaba');
ok(ids(buscar('1287')) === 'm1', 'por N° de orden');
ok(ids(buscar('356789102345678')) === 'm2', 'por IMEI');
ok(ids(buscar('galaxy')) === 'm2', 'por modelo');
ok(ids(buscar('alan')) === 'm4', 'por vendedor');
ok(ids(buscar('funda vidrio')) === 'm4', 'con dos palabras sueltas');
ok(ids(buscar('mercadopago')) === 'm4', 'por método de pago');

console.log('\n5) Filtro por tipo (nuevo)');
ok(ids(buscar('', 'egreso')) === 'm3', 'solo egresos', ids(buscar('', 'egreso')));
ok(ids(buscar('', 'ingreso')) === 'm1,m2,m4', 'solo ingresos', ids(buscar('', 'ingreso')));
ok(ids(buscar('repuesto', 'ingreso')) === '', 'combina texto y tipo: no hay ingresos de repuesto');
ok(ids(buscar('repuesto', 'egreso')) === 'm3', 'y sí un egreso');
run("_vsTipo = 'todos'");

console.log('\n6) Al abrir muestra los movimientos, no una pantalla en blanco');
const vacio = buscar('');
ok(vacio.length === 4, 'sin escribir nada, están los del período', vacio.length);
ok(/vsearch-item/.test(els['vsearch-results'].innerHTML), 'y se dibujan en la lista');
ok(/<b>4<\/b> movimientos/.test(els['vsearch-info'].innerHTML), 'el encabezado los cuenta', els['vsearch-info'].innerHTML);

console.log('\n7) Los dos totales, no solo ingresos');
buscar('');
const inf = els['vsearch-info'].innerHTML;
ok(/582\.000/.test(inf), 'suma los ingresos (50.000 + 520.000 + 12.000)', inf);
ok(/90\.000/.test(inf), 'y los egresos aparte  ← antes decía "ingresos $0" al buscar un egreso', inf);
buscar('repuesto');
ok(/90\.000/.test(els['vsearch-info'].innerHTML) && !/582/.test(els['vsearch-info'].innerHTML),
   'buscando un egreso, muestra su total', els['vsearch-info'].innerHTML);

console.log('\n8) El resultado muestra al cliente');
buscar('galaxy');
ok(/Ana Gómez/.test(els['vsearch-results'].innerHTML), 'quién compró', els['vsearch-results'].innerHTML.slice(0, 200));

console.log('\n9) Sin resultados lo dice y sugiere ampliar');
buscar('zzzz');
ok(/Sin resultados/.test(els['vsearch-info'].innerHTML), 'avisa', els['vsearch-info'].innerHTML);
ok(els['vsearch-results'].innerHTML === '', 'y no deja resultados viejos colgados');

console.log('\n10) El rango arranca en el día de acá, no en UTC');
// Con toISOString() a secas, después de las 21:00 el "desde" se corría un día.
ok(DESDE === '2026-06-03', '90 días antes del 2026-09-01', DESDE);

console.log('\n11) Cupo: una consulta por período, y se rehace si cambia algo');
const antes = CONSULTAS;
await get('_vsLoad(90)');
ok(CONSULTAS === antes, 'volver al mismo período no vuelve a consultar', CONSULTAS - antes);
await get('_vsLoad(365)');
ok(CONSULTAS === antes + 1, 'otro período sí consulta lo suyo');
run('_vsInvalidar()');
await get('_vsLoad(90)');
ok(CONSULTAS === antes + 2, 'si se registra o borra un movimiento, se vuelve a consultar', CONSULTAS);
const src = fs.readFileSync(DIR + 'caja.js', 'utf8');
ok(/_vsInvalidar\(\);/.test(src.slice(src.indexOf('function listenMovimientos'), src.indexOf('function _efecMonto'))),
   'y el listener del día es el que avisa');

console.log('\n12) No quedó el includes() viejo');
const bloque = src.slice(src.indexOf('function _vsTexto'), src.indexOf('function _vsFromDay'));
ok(/searchMatch/.test(bloque), 'el filtro usa searchMatch (normaliza acentos y sinónimos)');
ok(!/terms\.every/.test(bloque), 'se fue el filtrado a mano');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})();
