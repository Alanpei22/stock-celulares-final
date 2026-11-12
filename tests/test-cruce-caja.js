// 🔀 Cruce caja ↔ reparaciones. Alan (12/11): "capaz se cobró algo de una
// reparación y se entregó, pero no se marcó entregada".
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const DB = {}, TOASTS = [];
const ctx = { console, Math, Number, String, Array, Object, JSON, Date, isFinite,
  document: { getElementById: () => null }, toast: m => TOASTS.push(m), tpFrenar: () => false,
  db: { collection: c => ({ doc: id => ({ update: async d => { DB[c + '/' + id] = d; } }) }) } };
vm.createContext(ctx);
vm.runInContext(leer('cruce-caja.js'), ctx, { filename: 'cruce-caja.js' });
const run = c => vm.runInContext(c, ctx);

const AHORA = Date.parse('2026-11-12T15:00:00Z');
const hace = d => new Date(AHORA - d * 864e5).toISOString();
ctx.AH = AHORA;
ctx.R = [
  { id: 'a', nOrden: 8401, estado: 'listo', cobrado: true, fechaCobro: hace(5), monto: 40000, marca: 'Samsung', modelo: 'A32' },
  { id: 'b', nOrden: 8402, estado: 'listo', cobrado: true, fechaCobro: hace(0), monto: 30000 },
  { id: 'c', nOrden: 8403, estado: 'reparando', monto: 20000, sena: 20000, fechaIngreso: hace(3) },
  { id: 'd', nOrden: 8404, estado: 'entregado', cobrado: true, fechaCobro: hace(2) },
  { id: 'e', nOrden: 8405, estado: 'listo', monto: 50000, sena: 10000 },
  { id: 'f', nOrden: 8406, estado: 'listo', cobrado: true, fechaCobro: hace(9), sigueEnLocal: hace(2) },
  { id: 'g', nOrden: 8407, estado: 'listo', cobrado: true, fechaCobro: hace(20), sigueEnLocal: hace(8) },
  { id: 'h', nOrden: 8408, estado: 'no va', cobrado: true },
];
vm.runInContext('REPAIRS = R', ctx);

console.log('\n1) Cobradas que no figuran entregadas');
const todas = run('cruceCobradasSinEntregar(R, AH)').map(x => x.r.id);
ok(todas.join() === 'g,f,a,c,b', 'las cobradas (o con la seña cubriendo todo) que siguen "listo" o "reparando", la más vieja primero', todas);
ok(!todas.includes('d') && !todas.includes('e') && !todas.includes('h'), 'no las ya entregadas, ni las que deben plata, ni las "no va"');
const aviso = run('cruceCobradasSinEntregar(R, AH, true)').map(x => x.r.id);
ok(aviso.join() === 'g,a,c', 'el aviso: no las cobradas hoy (pueden estar por retirarla), ni las marcadas "sigue en el local" esta semana', aviso);
ok(aviso.includes('g'), 'pasada una semana de "sigue en el local", vuelve a preguntar');

console.log('\n2) Cobros de "Reparación" sin orden');
ctx.M = [
  { tipo: 'ingreso', categoria: 'Reparación', monto: 40000, descripcion: 'cambio modulo N°8405', metodoPago: 'Efectivo' },
  { tipo: 'ingreso', categoria: 'Reparación', monto: 15000, descripcion: 'pin de carga moto' },
  { tipo: 'ingreso', categoria: 'Reparación', monto: 30000, repairId: 'b', descripcion: 'N°8402' },
  { tipo: 'ingreso', categoria: 'Venta producto', monto: 5000, descripcion: 'funda' },
  { tipo: 'egreso', categoria: 'Reparación', monto: 100 },
];
const S = run('cruceCobrosSueltos(M, R)');
ok(S.length === 2, 'solo los ingresos de "Reparación" que no eligieron la orden', S.length);
ok(S[0].r && S[0].r.id === 'e' && S[1].r === null, 'si la descripción trae el N° de orden, dice cuál es', S.map(x => x.r && x.r.id));
ok(run(`cruceCobrosSueltos([{ tipo: 'ingreso', categoria: 'Reparación', monto: 1, descripcion: 'orden 8401' }, { tipo: 'ingreso', categoria: 'Reparación', monto: 1, descripcion: '#8403 bateria' }], R)`).every(x => x.r), '"orden 8401" y "#8403" también');

console.log('\n3) "Ya se entregó" / "Sigue en el local"');
(async () => {
  await run('cruceEntregada("a")');
  const p = DB['repairs/a'];
  ok(p && p.estado === 'entregado' && p.fechaEntrega === hace(5), 'queda entregada con la fecha del COBRO (no la de hoy: no infla el resumen de hoy)', p);
  ok(p.entregaPorCruce && p.estadoHistorial[p.estadoHistorial.length - 1].cruce === true, 'y se sabe que se puso al día desde el cruce');
  ok(!run('cruceCobradasSinEntregar(R, AH)').some(x => x.r.id === 'a'), 'y sale de la lista');
  await run('cruceSigue("c")');
  ok(DB['repairs/c'].sigueEnLocal && !run('cruceCobradasSinEntregar(R, Date.now(), true)').some(x => x.r.id === 'c'), '"sigue en el local": no vuelve a avisar por una semana (sigue en la lista si la abrís)');
  const src = leer('cruce-caja.js');
  const fnE = (src.match(/async function cruceEntregada[\s\S]*?\n\}/) || [''])[0];
  ok(!/tgNotify|triggerWaNotify|openCobroModal|changeRepairStatus/.test(fnE), 'sin avisarle al cliente ni volver a ofrecer el cobro: es poner al día algo que ya pasó');

  console.log('\n4) Enganchado');
  const hy = leer('hoy.js'), ap = leer('app.js');
  ok(/cruceCobradasSinEntregar\(reps, ahora, true\)/.test(hy) && /fn: 'cruce'/.test(hy) && /a\.fn === 'cruce' && typeof cruceAbrir === 'function'\) cruceAbrir\(\)/.test(hy), '"Para hacer hoy" lo avisa, con botón Revisar');
  ok(/label: 'Cruzar con la caja'/.test(ap) && /cruceAbrir\(\)/.test(ap), 'y está en Reparaciones → ⋮ → Mantenimiento');
  ok(/<script defer src="cruce-caja\.js"><\/script>/.test(leer('index.html')), 'cargado en index.html');
  ok(!/\.get\(\)|onSnapshot/.test(src), 'no lee nada de más de la base: usa las reparaciones y la caja de hoy ya cargadas');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
