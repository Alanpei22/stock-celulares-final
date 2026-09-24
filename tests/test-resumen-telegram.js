// Resumen de las 19:15 por Telegram.
//
// Qué entró a reparar, qué se entregó, qué equipos se vendieron y cuánta plata
// entró, separando efectivo de digital.
//
// La parte fina es el DÍA. Los movimientos de caja guardan el día argentino
// ("2026-09-24") pero las reparaciones guardan ISO en UTC, y a las 21:00 AR el
// ISO ya dice mañana. Un equipo que entró a las 21:30 tiene que contar en el
// día que entró, no en el siguiente.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── Se carga el archivo de verdad, sin la parte de Firebase ──
const src = fs.readFileSync(DIR + 'api/cron-resumen-telegram.js', 'utf8');
const trozo = src.slice(src.indexOf('export function hoyAR'), src.indexOf('export default'))
                 .replace(/export /g, '');
const ctx = { console, Date, Math, Number, String, Array, Object, JSON };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(trozo, ctx, { filename: 'cron-resumen-telegram.js' });
const run = e => vm.runInContext(e, ctx);
const call = (fn, ...args) => { ctx._a = args; return run(`${fn}(...${'_a'})`); };

console.log('\n1) El día argentino, no el del reloj de Londres');
const [desde, hasta] = call('rangoUTC', '2026-09-24');
ok(desde === '2026-09-24T03:00:00.000Z', 'el día arranca a las 03:00 UTC', desde);
ok(hasta === '2026-09-25T03:00:00.000Z', 'y termina 24 horas después', hasta);
// Un equipo que entró a las 21:30 AR queda guardado como el día SIGUIENTE en
// UTC. Si el rango se armara con el string del día pelado, no aparecería.
const entro2130 = new Date('2026-09-24T21:30:00-03:00').toISOString();
ok(entro2130 >= desde && entro2130 < hasta,
   'un ingreso de las 21:30 cuenta en su día (en UTC ya es mañana)', entro2130);
const entro0930 = new Date('2026-09-24T09:30:00-03:00').toISOString();
ok(entro0930 >= desde && entro0930 < hasta, 'y uno de la mañana también');
const ayer2000 = new Date('2026-09-23T20:00:00-03:00').toISOString();
ok(!(ayer2000 >= desde), 'lo de ayer a la tarde no se cuela', ayer2000);

console.log('\n2) Cuántos equipos salieron en cada venta');
// Hay dos formas de vender un equipo y guardan distinto.
ok(call('equiposDe', { categoria: 'Venta equipo', itemSource: 'equipo', itemQty: 1 }) === 1,
   'el formulario de venta de equipo');
ok(call('equiposDe', { categoria: 'Venta producto', items: [
    { source: 'equipo', nombre: 'Samsung A54' }, { source: 'producto', nombre: 'Vidrio' }] }) === 1,
   'el carrito, donde el equipo va mezclado con accesorios');
ok(call('equiposDe', { categoria: 'Venta producto', items: [
    { source: 'equipo' }, { source: 'equipo' }] }) === 2, 'dos equipos en la misma venta');
ok(call('equiposDe', { categoria: 'Venta producto', items: [{ source: 'producto' }] }) === 0,
   'una venta de accesorios no es un equipo');
ok(call('equiposDe', { categoria: 'Reparación' }) === 0, 'y una reparación tampoco');

// ── Un día del local ────────────────────────────────────────
const DIA = {
  dia: '2026-09-24',
  movs: [
    { tipo: 'ingreso', categoria: 'Venta equipo', monto: 350000, metodoPago: 'Efectivo',
      itemSource: 'equipo', itemQty: 1, itemNombre: 'Samsung Galaxy A54' },
    { tipo: 'ingreso', categoria: 'Reparación', monto: 60000, metodoPago: 'Transferencia' },
    { tipo: 'ingreso', categoria: 'Venta producto', monto: 8000, metodoPago: 'Efectivo' },
    // Pago dividido: 20.000 en efectivo y 30.000 por MercadoPago
    { tipo: 'ingreso', categoria: 'Reparación', monto: 50000, metodoPago: 'Efectivo',
      monto2: 30000, metodoPago2: 'MercadoPago' },
    { tipo: 'egreso', categoria: 'Repuesto', monto: 77000, metodoPago: 'Efectivo' },
  ],
  ingresadas: [
    { marca: 'Motorola', modelo: 'G54', nombre: 'Juan' },
    { marca: 'Apple', modelo: 'iPhone 11', nombre: 'Marta' },
  ],
  entregadas: [{ marca: 'Samsung', modelo: 'A32', nombre: 'Pedro' }],
};
const msg = call('armarResumen', DIA);

console.log('\n3) Lo del taller');
ok(/Ingresaron para reparar: 2/.test(msg), 'cuántos entraron a reparar', msg);
ok(/Motorola G54 — Juan/.test(msg), 'con cuál es cada uno');
ok(/Entregados: 1/.test(msg) && /Samsung A32 — Pedro/.test(msg), 'y cuántos se entregaron');

console.log('\n4) Los equipos vendidos');
ok(/Equipos vendidos: 1/.test(msg), 'cuántos', msg);
ok(/Samsung Galaxy A54 \$350\.000/.test(msg), 'cuál y por cuánto');

console.log('\n5) La plata: efectivo y digital');
// Ingresos: 350.000 + 60.000 + 8.000 + 50.000 = 468.000
ok(/<b>Ventas del día: \$468\.000<\/b>/.test(msg), 'el total del día', msg.match(/Ventas.*/));
// Efectivo: 350.000 + 8.000 + (50.000 − 30.000) = 378.000
ok(/Efectivo \$378\.000/.test(msg), 'el efectivo, contando bien el pago dividido', msg.match(/Efectivo.*/));
// Digital: 60.000 (transferencia) + 30.000 (MP) = 90.000
ok(/Digital \$90\.000/.test(msg), 'y lo digital', msg.match(/Digital.*/));
ok(/Transferencia \$60\.000 · MercadoPago \$30\.000/.test(msg), 'con el desglose por método', msg);
// El gasto de repuestos del día (77.000) no entra en ningún lado del resumen:
// se pidió ventas, no balance. Si apareciera, el total ya no seria "ventas".
ok(!/77\.000/.test(msg), 'el gasto del día no se mezcla con las ventas', msg);

console.log('\n6) Los dólares van aparte');
const conUsd = call('armarResumen', { dia: '2026-09-24', movs: [
  { tipo: 'ingreso', categoria: 'Venta equipo', monto: 400000, metodoPago: 'Dólares' },
  { tipo: 'ingreso', categoria: 'Reparación', monto: 10000, metodoPago: 'Efectivo' },
], ingresadas: [], entregadas: [] });
ok(/En dólares \$400\.000/.test(conUsd), 'se avisan', conUsd);
ok(/Efectivo \$10\.000/.test(conUsd), 'pero no se suman al efectivo de la caja', conUsd.match(/Efectivo.*/));
ok(/Digital \$0/.test(conUsd), 'ni a lo digital', conUsd.match(/Digital.*/));

console.log('\n7) Un día tranquilo');
const vacio = call('armarResumen', { dia: '2026-09-24', movs: [], ingresadas: [], entregadas: [] });
ok(/Ingresaron para reparar: 0/.test(vacio) && /Entregados: 0/.test(vacio), 'dice que no hubo nada');
ok(/No se registró ningún ingreso/.test(vacio), 'y lo dice con todas las letras', vacio);

console.log('\n8) Un día largo no manda 40 renglones');
const muchas = Array.from({ length: 11 }, (_, i) => ({ marca: 'Equipo', modelo: '#' + (i + 1) }));
const largo = call('armarResumen', { dia: '2026-09-24', movs: [], ingresadas: muchas, entregadas: [] });
ok(/Ingresaron para reparar: 11/.test(largo), 'el número está completo');
ok((largo.match(/· Equipo #/g) || []).length === 6, 'pero lista 6', (largo.match(/· Equipo #/g) || []).length);
ok(/y 5 más/.test(largo), 'y avisa cuántos quedaron afuera', largo);

console.log('\n9) Telegram interpreta HTML');
const conHtml = call('armarResumen', { dia: '2026-09-24', movs: [], ingresadas: [
  { marca: '<b>Raro', modelo: '</b>', nombre: 'Ana & Co' }], entregadas: [] });
ok(/&lt;b&gt;Raro/.test(conHtml) && /Ana &amp; Co/.test(conHtml),
   'los nombres van escapados o el mensaje sale roto', conHtml);

console.log('\n10) Cuándo y cómo se dispara');
const wf = fs.readFileSync(DIR + '.github/workflows/resumen-telegram.yml', 'utf8');
ok(/cron:\s*'15 22 \* \* \*'/.test(wf), '22:15 UTC, que son las 19:15 de acá', wf.match(/cron:.*/));
ok(/api\/cron-resumen-telegram/.test(wf), 'y llama al endpoint');
ok(/workflow_dispatch/.test(wf), 'se puede disparar a mano para probarlo sin esperar al horario');

console.log('\n11) El endpoint');
const vivo = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
ok(/CRON_SECRET/.test(vivo), 'exige el secreto del cron: está abierto en internet');
ok(vivo.indexOf('CRON_SECRET') < vivo.indexOf('TELEGRAM_BOT_TOKEN'),
   'y corta ANTES de tocar las credenciales del bot');
ok(/telegram\?\.enabled === false/.test(vivo), 'respeta el interruptor de Telegram');
// Cupo: tres consultas acotadas, ninguna colección entera.
ok(/collection\('caja_movimientos'\)\.where\('fecha', '==', dia\)/.test(vivo),
   'los movimientos, filtrados por el día');
ok(!/collection\('stock'\)/.test(vivo),
   'no lee el stock entero para contar los vendidos: sale de los movimientos');
ok((vivo.match(/\.get\(\)/g) || []).length <= 4, 'y en total son pocas lecturas',
   (vivo.match(/\.get\(\)/g) || []).length);

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
