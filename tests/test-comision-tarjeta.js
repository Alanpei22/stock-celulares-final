// 💳 Comisión de tarjetas (Getnet).
//
// Alan: "cuando anoto una tarjeta, anoto en caja con el recargo, pero no es lo
// que me depositan a mí". La caja guardaba lo que paga el cliente y la
// ganancia salía inflada: Getnet se queda con su comisión.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const LS = { tpTarjetas: JSON.stringify({ debito: 2, credito: 5 }) };
const ctx = { console, JSON, Math, Number, String, Object, Array, Promise,
  localStorage: { getItem: k => LS[k] ?? null, setItem: (k, v) => { LS[k] = String(v); } } };
vm.createContext(ctx);
const u = leer('utils.js');
vm.runInContext(u.slice(u.indexOf('const TP_TARJETA_METODOS')), ctx, { filename: 'utils.js' });
const run = (c, v) => { ctx._v = v; return vm.runInContext(c, ctx); };

console.log('\n1) Lo que se queda Getnet');
let m = run('tarjetaAplicar(_v)', { tipo: 'ingreso', monto: 110000, metodoPago: 'Tarjeta crédito', gananciaARS: 30000 });
ok(m.comisionTarjeta === 5500 && m.netoTarjeta === 104500, 'crédito al 5%: de $110.000 te depositan $104.500', m);
ok(m.gananciaARS === 24500, 'y la ganancia baja lo que se queda Getnet', m.gananciaARS);
m = run('tarjetaAplicar(_v)', { tipo: 'ingreso', monto: 50000, metodoPago: 'Tarjeta débito' });
ok(m.comisionTarjeta === 1000 && m.gananciaARS === undefined, 'débito al 2%; sin ganancia calculada (reparación) no inventa una', m);
m = run('tarjetaAplicar(_v)', { tipo: 'ingreso', monto: 100000, metodoPago: 'Efectivo', metodoPago2: 'Tarjeta crédito', monto2: 40000, gananciaARS: 10000 });
ok(m.comisionTarjeta === 2000 && m.netoTarjeta === 38000, 'pago dividido: solo paga comisión la parte con tarjeta', m);
m = run('tarjetaAplicar(_v)', { tipo: 'ingreso', monto: 100000, metodoPago: 'Efectivo', gananciaARS: 10000 });
ok(m.comisionTarjeta === undefined && m.gananciaARS === 10000, 'efectivo: no cambia nada', m);
LS.tpTarjetas = 'null';
m = run('tarjetaAplicar(_v)', { tipo: 'ingreso', monto: 100000, metodoPago: 'Tarjeta crédito', gananciaARS: 10000 });
ok(m.comisionTarjeta === undefined && m.gananciaARS === 10000, 'sin comisión cargada, todo como antes', m);

console.log('\n2) Se aplica en todos los cobros');
const llamadas = f => (leer(f).match(/tarjetaAplicar\(/g) || []).length;
ok(llamadas('caja.js') >= 4, 'caja: cobro, edición, venta de equipo y plan ahorro', llamadas('caja.js'));
ok(llamadas('app.js') >= 1 && llamadas('repairs.js') >= 2, 'venta desde Equipos, cobro y seña de reparación');

console.log('\n3) Se ve');
const cj = leer('caja.js');
ok(/🏦 te depositan/.test(cj) && /Getnet te deposita/.test(cj), 'en cada cobro y en el resumen del día');
ok(/label: 'Comisión de tarjetas \(Getnet\)'/.test(cj) && /hide: !isOwner, onClick: configurarComisionTarjetas/.test(cj), 'el dueño carga los % desde el menú de la caja');
ok(/Comisión tarjetas/.test(leer('app.js')), 'y el tablero la resta de la ganancia neta');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
