// Demorados: una sola cuenta para toda la app.
// Antes había cinco: la lista usaba el plazo de la fase (con "Ingresado" en
// 4 horas, así que casi todo salía demorado, y sumaba listos sin retirar y
// "no va" ya devueltos), el panel de inicio y las estadísticas contaban
// "más de 3 días reparando", y la lista de demoradas de estadísticas metía
// los listos. Cada pantalla decía un número distinto.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const ctx = {
  console, Date, Math, JSON,
  setTimeout: () => 0, clearTimeout,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
              body: { style: {}, classList: { add() {}, remove() {}, contains: () => false } } },
  window: { addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'tp-fases.js', 'utf8'), ctx, { filename: 'tp-fases.js' });
vm.runInContext(fs.readFileSync(DIR + 'repairs.js', 'utf8'), ctx, { filename: 'repairs.js' });
const get = e => vm.runInContext(e, ctx);
const dem = r => { ctx.__r = r; return get('tpDemorado(__r)'); };
const venc = r => { ctx.__r = r; return get('tpVencido(__r)'); };
const hAgo = h => new Date(Date.now() - h * 3600000).toISOString();

console.log('\n1) Lo que entra hoy no está demorado');
// Así se trabaja desde la card: Ingresado → Listo, sin tocar las fases del medio.
const recien = { estado: 'reparando', fase: 'ingresado', faseHist: [{ f: 'ingresado', t: hAgo(6) }], fechaIngreso: hAgo(6) };
ok(!dem(recien), '6 horas en el taller: NO (antes a las 4 h ya era demorado)');
ok(!dem({ ...recien, faseHist: [{ f: 'ingresado', t: hAgo(50) }], fechaIngreso: hAgo(50) }), '2 días: todavía no');
ok(dem({ ...recien, faseHist: [{ f: 'ingresado', t: hAgo(80) }], fechaIngreso: hAgo(80) }), 'más de 3 días sin moverse: sí');

console.log('\n2) Solo lo que sigue en el taller sin terminar');
const listoViejo = { estado: 'listo', fase: 'listo', faseHist: [{ f: 'listo', t: hAgo(24 * 10) }] };
ok(!dem(listoViejo), 'listo sin retirar hace 10 días: NO es demora del taller');
ok(venc(listoViejo), 'pero sigue con el reloj rojo (sin retirar)');
const devuelto = { estado: 'no va', fase: 'irreparable', faseHist: [{ f: 'irreparable', t: hAgo(24 * 30) }], devuelto: true };
ok(!dem(devuelto) && !venc(devuelto), '"no va" ya devuelto: ni demorado ni reloj rojo (antes, para siempre)');
ok(venc({ ...devuelto, devuelto: false }), '"no va" sin devolver hace un mes: reloj rojo');
ok(!dem({ ...devuelto, devuelto: false }), 'pero no suma en Demorados (ya está en "Devolver")');
ok(!dem({ estado: 'entregado', fase: 'entregado', faseHist: [{ f: 'entregado', t: hAgo(9999) }] }), 'entregado: nunca');

console.log('\n3) Cada fase respeta su plazo');
ok(!dem({ estado: 'reparando', fase: 'repuesto', faseHist: [{ f: 'ingresado', t: hAgo(200) }, { f: 'repuesto', t: hAgo(100) }] }),
   'esperando repuesto 4 días (plazo 5): no');
ok(dem({ estado: 'reparando', fase: 'repuesto', faseHist: [{ f: 'ingresado', t: hAgo(200) }, { f: 'repuesto', t: hAgo(130) }] }),
   'esperando repuesto 5 días y medio: sí');

console.log('\n4) El reloj arranca de la fase ACTUAL');
// Estado cambiado sin anotar la fase (versión vieja de la app, otro celu):
// la última entrada del historial de fases es de otra fase.
const mal = { estado: 'listo', fase: 'reparacion', faseHist: [{ f: 'reparacion', t: hAgo(24 * 9) }],
              estadoHistorial: [{ estado: 'reparando', fecha: hAgo(24 * 9) }, { estado: 'listo', fecha: hAgo(2) }] };
ctx.__r = mal;
ok(get('tpHoras(tpDesde(__r))') < 3, 'recién pasado a Listo cuenta desde ese cambio, no desde hace 9 días', get('tpHoras(tpDesde(__r))'));
ok(!venc(mal), 'y no sale con reloj rojo');
// Orden cargada con fecha de ayer (el selector de día lo permite)
const ayer = { estado: 'reparando', fase: 'ingresado', faseHist: [{ f: 'ingresado', t: hAgo(1) }], fechaIngreso: hAgo(80) };
ctx.__r = ayer;
ok(get('tpHoras(tpDesde(__r))') > 79, 'cargada con fecha de ingreso anterior: cuenta desde el ingreso', get('tpHoras(tpDesde(__r))'));

console.log('\n5) Todas las pantallas usan la misma cuenta');
const rep = fs.readFileSync(DIR + 'repairs.js', 'utf8');
const app = fs.readFileSync(DIR + 'app.js', 'utf8');
ok(!/> 3\)\.length/.test(rep.replace(/function _repDemorado[\s\S]*?\n}\n/, '')),
   'repairs.js ya no cuenta "más de 3 días" por su lado');
ok((rep.match(/_repDemorado\)/g) || []).length >= 3, 'estadísticas (estado actual, lista de demoradas y resumen) usan la misma');
ok(/if \(!tpDemorado\(r\)\) return false/.test(rep), 'el filtro de la lista');
ok(/BASE\.filter\(r => _tpOn \? tpDemorado\(r\)/.test(rep), 'el número de arriba');
ok(/_repDemorado\(r\)/.test(app), 'y el panel de inicio');
ok(/'demoradas' \? 'demorado'/.test(rep), 'tocar "Demoradas" en estadísticas filtra demorados (antes filtraba "Reparando")');
ok(/function sendWAToCustomer[\s\S]{0,200}repairWhatsApp\(repairId\)/.test(rep),
   'el botón de WhatsApp de las demoradas abre WhatsApp (llamaba a una función que no existe)');

console.log('\n6) Lo que dice la card');
const mk = (estado, fase, horas) => ({ id: 'x', nOrden: 1, estado, fase, faseHist: [{ f: fase, t: hAgo(horas) }], fechaIngreso: hAgo(horas) });
const els = {};
['rep-search', 'rep-f-estado', 'rep-f-marca', 'rep-f-fecha', 'rep-sort', 'rs-reparando', 'rs-listo', 'rs-demorados', 'rs-devolver', 'rep-list', 'rep-empty']
  .forEach(id => els[id] = { value: '', textContent: '', innerHTML: '', style: {}, options: [{}], remove() {}, appendChild() {} });
vm.runInContext(`
  document = { getElementById: id => __els[id] || null };
  esc = s => String(s == null ? '' : s); timeAgo = () => ''; updateNavBadge = () => {};
  searchMatch = () => true; _cardAccionesHtml = () => ''; _arregloCardHtml = () => '';
  _repairsLoaded = true;
`, Object.assign(ctx, { __els: els }));
const cardDe = r => { ctx.__R = [r]; get('REPAIRS = __R; renderRepairs()'); return els['rep-list'].innerHTML; };
let c = cardDe(mk('listo', 'listo', 24 * 10));
ok(/sin retirar ⚠️/.test(c), 'listo viejo: "sin retirar"', c.match(/tp-dias[^<]*/));
ok(!/rep-card--demorado/.test(c), 'sin borde de demorado');
ok(String(els['rs-demorados'].textContent) === '0', 'y no suma arriba', els['rs-demorados'].textContent);
c = cardDe(mk('reparando', 'reparacion', 24 * 4));
ok(/rep-card--demorado/.test(c) && String(els['rs-demorados'].textContent) === '1', 'en el banco 4 días: demorado y suma');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
