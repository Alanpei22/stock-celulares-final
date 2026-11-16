// Equipos vendidos, mes a mes.
//
// El informe de finanzas da UN mes por vez y en PDF. Esto contesta la otra
// pregunta: ¿venimos para arriba o para abajo?
//
// Lo que se prueba acá es lo que hace que los números no mientan:
//  · el mes se corta en HORA ARGENTINA (la fecha de venta se guarda en hora
//    universal, tres horas adelante: una venta del 31 a las 21:30 figuraría
//    en el mes siguiente);
//  · la ganancia sale SOLO de los equipos con costo cargado, y se dice de
//    cuántos sobre cuántos;
//  · un mes sin ventas aparece en cero, no desaparece.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = {};
const el = id => els[id] = { id, value: '', textContent: '', innerHTML: '', style: {},
  classList: { add() {}, remove() {} }, addEventListener() {} };
['vm-modal', 'vm-overlay', 'vm-cuerpo', 'vm-meses'].forEach(el);

let LEIDO = null;
const ctx = {
  console, Math, JSON, Date, Number, String, Object, Array, isFinite, parseInt, parseFloat,
  setTimeout: f => f(), clearTimeout,
  document: { getElementById: id => els[id] || null, body: { style: {} }, addEventListener() {} },
  window: {}, localStorage: { getItem: () => null, setItem() {} },
  esc: s => String(s == null ? '' : s),
  fmt: n => '$' + Number(n || 0).toLocaleString('es-AR'),
  cupoContar: () => {},
  db: { collection: () => ({ where: (campo, op, val) => { LEIDO = { campo, op, val };
          return { get: async () => ({ size: VENTAS.length, docs: VENTAS.map(v => ({ data: () => v })) }) }; } }) },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('ventas-meses.js'), ctx, { filename: 'ventas-meses.js' });
const run = e => vm.runInContext(e, ctx);
const call = (f, ...a) => { ctx.__a = a; return run(`${f}(...__a)`); };

let VENTAS = [];

(async () => {

console.log('\n1) El mes se corta en hora argentina');
// Guardado en hora universal: el 31/10 a las 21:30 de acá son las 00:30 del
// 1/11 allá. Sin corregir, esa venta se muda al mes siguiente.
ok(call('vmMesDe', '2026-11-01T00:30:00.000Z') === '2026-10',
   'una venta del 31 a las 21:30 queda en octubre', call('vmMesDe', '2026-11-01T00:30:00.000Z'));
ok(call('vmMesDe', '2026-11-01T04:00:00.000Z') === '2026-11', 'y una del 1 a la 1 de la mañana, en noviembre');
ok(call('vmMesDe', '2026-10-15T18:00:00.000Z') === '2026-10', 'una del medio del mes no se mueve');
ok(call('vmMesDe', '') === '' && call('vmMesDe', 'cualquier cosa') === '', 'sin fecha no inventa un mes');

console.log('\n2) Cada mes con lo suyo');
const V = [
  // Octubre: dos con costo, uno sin.
  { fecha_venta: '2026-10-05T14:00:00Z', vendido: true, precio: 500000, costo: 400000, marca: 'Samsung', modelo: 'A54' },
  { fecha_venta: '2026-10-20T14:00:00Z', vendido: true, precio: 300000, costo: 200000, marca: 'Samsung', modelo: 'A54' },
  { fecha_venta: '2026-10-28T14:00:00Z', vendido: true, precio: 900000, marca: 'Apple', modelo: 'iPhone 13' },
  // Noviembre: uno solo.
  { fecha_venta: '2026-11-03T14:00:00Z', vendido: true, precio: 600000, costo: 450000, marca: 'Motorola', modelo: 'G54' },
];
// Se fija "hoy" para que el período sea siempre el mismo.
const HOY = Date.parse('2026-11-16T15:00:00Z');
const _now = Date.now;
Date.now = () => HOY;
ctx.Date = Date;
let filas = call('vmAgrupar', V, 3);
const oct = filas.find(f => f.mes === '2026-10');
const nov = filas.find(f => f.mes === '2026-11');
ok(filas.length === 3, 'tres meses pedidos, tres filas', filas.map(f => f.mes));
ok(filas[0].mes === '2026-09' && filas[2].mes === '2026-11', 'del más viejo al más nuevo', filas.map(f => f.mes));
ok(oct.equipos === 3 && oct.recaudado === 1700000, 'octubre: 3 equipos y lo recaudado', [oct.equipos, oct.recaudado]);
ok(oct.ganancia === 200000, 'la ganancia sale solo de los dos con costo', oct.ganancia);
ok(oct.conCosto === 2, 'y dice de cuántos pudo calcularla', oct.conCosto);
ok(oct.margen === Math.round((200000 / 1700000) * 100), 'el margen, sobre todo lo recaudado', oct.margen);
ok(oct.top === 'Samsung A54' && oct.topVeces === 2, 'el modelo que más salió ese mes', [oct.top, oct.topVeces]);
ok(nov.equipos === 1 && nov.ganancia === 150000, 'noviembre, lo suyo', [nov.equipos, nov.ganancia]);

// Un mes sin ventas tiene que aparecer: un cero es un dato.
const sept = filas.find(f => f.mes === '2026-09');
ok(!!sept && sept.equipos === 0 && sept.margen === null,
   'el mes sin ventas aparece en cero, no desaparece', sept);

console.log('\n3) Cómo viene contra el mes anterior');
const t = call('vmTendencia', filas);
ok(t.equipos === 1 - 3 && t.ganancia === 150000 - 200000,
   'compara el último contra el anterior', t);
ok(t.mesAnterior === '2026-10', 'diciendo contra cuál', t.mesAnterior);
ok(call('vmTendencia', [{ mes: '2026-11' }]) === null, 'con un solo mes no hay con qué comparar');

console.log('\n4) Lo que se lee de la base');
VENTAS = V.concat([
  // Tiene fecha pero volvió a estar disponible: no es una venta.
  { fecha_venta: '2026-10-09T14:00:00Z', vendido: false, precio: 100000 },
]);
const leidas = await run('vmLeer(6)');
ok(leidas.length === 4, 'el que dejó de estar vendido no cuenta', leidas.length);
ok(LEIDO.campo === 'fecha_venta' && LEIDO.op === '>=', 'se pide por fecha de venta, no toda la colección', LEIDO);
ok(LEIDO.val.slice(0, 7) === '2026-06' && LEIDO.val.endsWith('Z'),
   'desde el 1° del primer mes del período, en hora universal como está guardado', LEIDO.val);

console.log('\n5) El cuadro');
els['vm-meses'].value = '3';
await run('vmBuscar()');
const html = els['vm-cuerpo'].innerHTML;
ok(/oct 26/.test(html) && /nov 26/.test(html), 'muestra los meses con nombre', html.slice(0, 200));
ok(/vm-bar/.test(html), 'con las barras para ver la tendencia de un vistazo');
ok(/de los \d+ de \d+ equipos que tienen el costo cargado/.test(html),
   'y aclara sobre cuántos equipos se pudo calcular la ganancia', (html.match(/de los .*cargado/) || [])[0]);
Date.now = _now;

console.log('\n6) El cupo');
const src = leer('ventas-meses.js');
ok(!/onSnapshot/.test(src), 'no engancha ningún listener nuevo');
ok(/cupoContar\('stock', snap\.size\)/.test(src), 'y cuenta lo que leyó');

console.log('\n7) Enganchado en la caja');
ok(/ventas-meses\.js/.test(leer('caja.html')), 'el script se carga');
ok(/id="vm-modal"/.test(leer('caja.html')), 'y el cuadro está en la página');
ok(/vmAbrir\(\)/.test(leer('caja.js')), 'se entra desde el menú, al lado del reporte financiero');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})().catch(e => { console.error('Error:', e); process.exit(1); });
