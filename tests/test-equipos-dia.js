// 📱 Equipos vendidos en el día, en la caja. Alan (16/11): "¿me podés
// agregar en la caja un resumen de equipos vendidos en el día?"
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = { 'caja-equipos-dia': { innerHTML: '', style: {} } };
const ctx = { console, Math, Number, String, Array, Object, JSON, Date, localStorage: { getItem: () => null, setItem() {} },
  document: { getElementById: id => els[id] || null, createElement: () => ({}), head: { appendChild() {} } },
  fmt: n => '$' + Math.round(n).toLocaleString('es-AR'), esc: s => String(s) };
vm.createContext(ctx);
vm.runInContext(leer('equipos-dia.js'), ctx, { filename: 'equipos-dia.js' });
const run = c => vm.runInContext(c, ctx);

ctx.MOVS = [
  // Desde la caja (venta de equipo), con funda
  { tipo: 'ingreso', categoria: 'Venta equipo', descripcion: 'Venta: Apple iPhone 13 · IMEI 356 + Funda', itemNombre: 'Apple iPhone 13',
    monto: 806000, montoEquipo: 800000, gananciaARS: 150000, metodoPago: 'Efectivo', vendedor: 'Nacho', createdAt: '2026-11-16T15:30:00Z' },
  // Desde el Stock, sin costo cargado
  { tipo: 'ingreso', categoria: 'Venta', stockId: 's1', descripcion: 'Venta: Samsung A54 128GB', monto: 450000, metodoPago: 'Transferencia', sinCosto: true, createdAt: '2026-11-16T13:00:00Z' },
  // Desde el Stock, saldo de una seña
  { tipo: 'ingreso', categoria: 'Venta', stockId: 's2', descripcion: 'Venta: Motorola G24 (saldo · ya había dejado $50.000)', monto: 150000, costoARSTotal: 120000, gananciaARS: 80000, createdAt: '2026-11-16T18:00:00Z' },
  // En el carrito, con un cargador
  { tipo: 'ingreso', categoria: 'Venta producto', monto: 320000, items: [
    { source: 'equipo', nombre: 'Xiaomi Redmi 13', qty: 1, precioUnit: 300000, costoARSUnit: 220000 },
    { source: 'producto', nombre: 'Cargador', qty: 1, precioUnit: 20000 } ], createdAt: '2026-11-16T16:00:00Z' },
  // Lo que NO es una venta de equipo
  { tipo: 'ingreso', categoria: 'Seña venta', descripcion: 'Seña iPhone 12', monto: 50000 },
  { tipo: 'ingreso', categoria: 'Venta', descripcion: 'Venta suelta', monto: 3000 },
  { tipo: 'ingreso', categoria: 'Reparación', monto: 40000 },
  { tipo: 'egreso', categoria: 'Venta equipo', monto: 1 },
];

console.log('\n1) Qué cuenta como equipo vendido');
const L = run('eqDiaLista(MOVS)');
ok(L.length === 4, 'los tres caminos (caja, Stock y carrito); sin señas, ventas sueltas ni reparaciones', L.map(x => x.nombre));
ok(L.map(x => x.nombre).join() === 'Samsung A54 128GB,Apple iPhone 13,Xiaomi Redmi 13,Motorola G24', 'ordenados por hora, con el nombre limpio (sin IMEI, sin "saldo", sin la funda)', L.map(x => x.nombre));
const ip = L.find(x => /iPhone/.test(x.nombre));
ok(ip.precio === 800000 && ip.ganancia === 150000 && ip.vendedor === 'Nacho', 'el precio del equipo (sin la funda), la ganancia y quién lo vendió', ip);
ok(L.find(x => /A54/.test(x.nombre)).ganancia === null, 'sin costo cargado: no inventa la ganancia');
ok(L.find(x => /Redmi/.test(x.nombre)).precio === 300000 && L.find(x => /Redmi/.test(x.nombre)).ganancia === 80000, 'en el carrito: solo la línea del equipo');
ok(L.find(x => /G24/.test(x.nombre)).saldo === true && L.find(x => /G24/.test(x.nombre)).precio === 150000, 'el saldo de una seña se marca como tal');
const T = run('eqDiaTotales(eqDiaLista(MOVS))');
ok(T.cant === 4 && T.total === 1700000 && T.ganancia === 310000 && T.sinCosto === 1, 'totales: cuántos, cuánto y la ganancia de los que tienen costo', T);

console.log('\n2) En pantalla');
ctx.MOVIMIENTOS = ctx.MOVS;
ctx.tpEsDueno = () => true;
run('_eqDiaAbierto = true; renderEquiposDia()');
let h = els['caja-equipos-dia'].innerHTML;
ok(/4 equipos vendidos/.test(h) && /\$1\.700\.000/.test(h) && /gana \$150\.000/.test(h) && /sin costo/.test(h) && /Ganancia de los equipos/.test(h), 'el dueño ve cuántos, el total y la ganancia de cada uno');
ctx.tpEsDueno = () => false; ctx.tpPuede = () => false;
run('renderEquiposDia()');
h = els['caja-equipos-dia'].innerHTML;
ok(/4 equipos vendidos/.test(h) && !/\$1\.700\.000/.test(h) && !/gana/.test(h), 'el empleado sin permiso de "plata del día" ve cuáles, pero no el total ni la ganancia');
ctx.MOVIMIENTOS = [{ tipo: 'ingreso', categoria: 'Reparación', monto: 1 }];
run('renderEquiposDia()');
ok(els['caja-equipos-dia'].style.display === 'none', 'si no se vendió ningún equipo, no ocupa lugar');

console.log('\n3) Enganchado');
ok(/if \(typeof renderEquiposDia === 'function'\) renderEquiposDia\(\);/.test(leer('caja.js')), 'se actualiza junto con los números de la caja');
ok(/id="caja-equipos-dia"/.test(leer('caja.html')) && /<script src="equipos-dia\.js"><\/script>/.test(leer('caja.html')), 'está en la caja');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
