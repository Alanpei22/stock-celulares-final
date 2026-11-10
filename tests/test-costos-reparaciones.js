// 🔧 Costos de reparaciones. Alan (10/11): "necesito cargar los costos de
// todo… algo para cargar fácilmente los costos de las reparaciones ya
// ingresadas y las que ingresen luego". Y que la ganancia de la caja se
// entere: si no, el tablero miente.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// Las funciones de utils.js (el trozo de costos), sin el resto del archivo
const u = leer('utils.js');
const trozo = u.slice(u.indexOf('function repCostoEfectivo'), u.indexOf('function tarjetaAplicar'));
const UPD = [];
const ctx = { console, Math, Number, String, Array, Object, JSON };
ctx.db = { collection: () => ({ where: () => ({ get: async () => ({ docs: ctx.MOVS.map(m => ({ data: () => m, ref: { update: async p => { UPD.push(p); Object.assign(m, p); } } })) }) }) }) };
vm.createContext(ctx);
vm.runInContext(trozo, ctx, { filename: 'utils.js (costos)' });
const run = c => vm.runInContext(c, ctx);

console.log('\n1) El costo de una reparación');
ok(run('repCostoEfectivo({ costo: 15000, costoRepuesto: 9000 })') === 15000, 'el escrito a mano manda');
ok(run('repCostoEfectivo({ costoRepuesto: 9000 })') === 9000, 'si no hay, el del repuesto que se descontó al marcarla lista');
ok(run('repCostoEfectivo({})') === 0, 'sin nada: 0');

console.log('\n2) La ganancia del cobro se corrige');
const P = (mov, r, cn, cv) => JSON.parse(JSON.stringify(run(`repGananciaPatch(${JSON.stringify(mov)}, ${JSON.stringify(r)}, ${cn}, ${cv})`)));
// Cobrada desde la ficha, sin costo: ganancia = precio entero
let p = P({ tipo: 'ingreso', esCobro: true, monto: 40000, gananciaARS: 40000, costoARSTotal: 0, sinCosto: true }, { monto: 40000 }, 12000, 0);
ok(p.gananciaARS === 28000 && p.costoARSTotal === 12000 && p.sinCosto === false && p.costoReparacionARS === 12000, 'cobrada sin costo y cargado después: 40.000 − 12.000 = 28.000', p);
// Ya corregida una vez: se corrige la diferencia
p = P({ tipo: 'ingreso', esCobro: true, gananciaARS: 28000, costoARSTotal: 12000, costoReparacionARS: 12000 }, { monto: 40000 }, 15000, 12000);
ok(p.gananciaARS === 25000 && p.costoARSTotal === 15000, 'si después cambia el costo, se corrige solo la diferencia', p);
// Con productos en el mismo cobro: no toca la parte de los productos
p = P({ tipo: 'ingreso', esCobro: true, gananciaARS: 40000 + 5000, costoARSTotal: 3000 }, { monto: 40000 }, 10000, 0);
ok(p.gananciaARS === 35000 && p.costoARSTotal === 13000, 'con productos en el mismo cobro, la ganancia de ellos queda', p);
// Cobrada desde la caja: la ganancia no tenía la reparación (contaba $0)
p = P({ tipo: 'ingreso', esCobro: true, repairMode: 'cobro', monto: 30000, comisionTarjeta: 1200 }, { monto: 40000, sena: 10000 }, 12000, 0);
ok(p.gananciaARS === 40000 - 12000 - 1200 && p.costoARSTotal === 12000, 'cobrada desde la caja: suma la ganancia de la orden entera (antes contaba $0), menos la comisión de la tarjeta', p);
p = P({ tipo: 'ingreso', esCobro: true, repairMode: 'cobro', monto: 45000, gananciaARS: 2000, costoARSTotal: 3000, montoReparacion: 40000 }, { monto: 40000 }, 12000, 0);
ok(p.gananciaARS === 2000 + 28000 && p.costoARSTotal === 15000, 'desde la caja con productos: la de los productos más la de la reparación', p);
p = P({ tipo: 'ingreso', esCobro: true, gananciaARS: 40000 }, { monto: 40000 }, 0, 0);
ok(p.sinCosto === true, 'costo 0 sigue marcado "sin costo"', p);
ok(run('repEsCobro({ tipo: "ingreso", esCobro: true })') && !run('repEsCobro({ tipo: "ingreso", esSena: true, gananciaARS: 0 })') && !run('repEsCobro({ tipo: "egreso", esCobro: true })'), 'la seña no se toca, solo el cobro');

(async () => {
  ctx.MOVS = [{ tipo: 'ingreso', esSena: true, monto: 10000, repairId: 'r1' },
              { tipo: 'ingreso', esCobro: true, monto: 30000, gananciaARS: 40000, costoARSTotal: 0, repairId: 'r1' }];
  const n = await run('repActualizarCobro({ id: "r1", monto: 40000 }, 9000, 0)');
  ok(n === 1 && UPD.length === 1 && ctx.MOVS[1].gananciaARS === 31000 && ctx.MOVS[0].gananciaARS === undefined, 'repActualizarCobro corrige el cobro en la caja y no la seña', ctx.MOVS);

  console.log('\n3) La lista para cargarlos todos');
  const cx = { console, Math, Number, String, Array, Object, JSON, Date, esc: s => String(s), repCostoEfectivo: ctx.repCostoEfectivo, document: { getElementById: () => null } };
  vm.createContext(cx);
  vm.runInContext(leer('costos-lista.js'), cx, { filename: 'costos-lista.js' });
  cx.REPAIRS = [
    { id: 'a', nOrden: 101, marca: 'Samsung', modelo: 'A32', arreglo: 'Módulo', monto: 45000, estado: 'entregado', fechaIngreso: '2026-11-01' },
    { id: 'b', nOrden: 102, marca: 'iPhone', modelo: '11', arreglo: 'Batería', monto: 50000, estado: 'listo', costoRepuesto: 20000, fechaIngreso: '2026-11-05' },
    { id: 'c', nOrden: 103, marca: 'Moto', modelo: 'G52', monto: 15000, estado: 'entregado', sinRepuesto: true, costo: 0, fechaIngreso: '2026-10-20' },
    { id: 'd', nOrden: 104, marca: 'X', modelo: 'Y', monto: 0, estado: 'no va', fechaIngreso: '2026-11-06' },
  ];
  const cfg = vm.runInContext('_COSTOS_CFG.reparacion', cx);
  const L = cfg.lista().slice().sort(cfg.orden);
  ok(L.map(r => r.id).join() === 'b,a,c', 'todas las reparaciones, de la más nueva a la más vieja, sin las que "no van"', L.map(r => r.id));
  ok(cfg.nombre(L[1]) === '#101 Samsung A32' && /Módulo/.test(cfg.sub(L[1])) && cfg.venta(L[1]) === 45000, 'con N° de orden, equipo, arreglo y precio');
  ok(cfg.costo(L[0]) === 20000 && /costo del repuesto usado/.test(cfg.sub(L[0])), 'si ya descontaste un repuesto, aparece su costo (y lo dice)');
  ok(cfg.falta(L[1]) === true && cfg.falta(L[0]) === false && cfg.falta(L[2]) === false, '"solo sin costo": las que no tienen nada (las "sin repuesto" ya están)');
  const cambios = vm.runInContext(`_costosCambios('reparacion', [{ value: '12000', dataset: { id: 'a', antes: '' } }, { value: '20000', dataset: { id: 'b', antes: '20000' } }], 1000, 'DEL')`, cx);
  ok(cambios.length === 1 && cambios[0].id === 'a' && cambios[0].data.costo === 12000, 'guarda solo lo que cambió, en repairs.costo', cambios);

  console.log('\n4) Enganchado');
  const cl = leer('costos-lista.js'), rp = leer('repairs.js'), cj = leer('caja.js'), ap = leer('app.js'), hy = leer('hoy.js');
  ok(/if \(_costosTipo === 'reparacion'\) await _costosRepDespues\(cambios\)/.test(cl) && /repActualizarCobro\(r, c\.data\.costo, costoAntes\)/.test(cl), 'al guardar la lista, se corrige la ganancia de lo ya cobrado');
  ok(/_costosTraerTodas\(\)/.test(cl) && /await _cargarHistorialRep\(\)/.test(cl), 'botón para traer también las reparaciones viejas');
  ok(/abrirCostosLista\('reparacion'\)/.test(ap) && /label: 'Cargar costos', sub: 'De todas las reparaciones/.test(ap), 'menú de reparaciones → 💵 Cargar costos (solo el dueño)');
  ok(/datos\.costoReparacionARS = costo;/.test(rp) && /repCostoEfectivo\(r\) : \(Number\(r\.costo\)/.test(rp), 'el cobro desde la ficha usa también el costo del repuesto y anota con qué costo se cobró');
  ok(/existing\.cobrado && typeof repActualizarCobro === 'function'/.test(rp), 'cambiar el costo en la ficha de una ya cobrada corrige el cobro');
  ok(/if \(r\.cobrado && typeof repActualizarCobro === 'function'\) repActualizarCobro\(r, Number\(update\.costo\) \|\| 0, costoAntes\)/.test(rp), 'y el aviso de costo al entregar, también');
  ok(/data\.costoReparacionARS = cRep;/.test(cj) && /data\.gananciaARS   = \(typeof data\.gananciaARS === 'number' \? data\.gananciaARS : 0\) \+ \(precioOrden - cRep\)/.test(cj), 'cobrar una reparación desde la caja ahora suma su ganancia (antes $0)');
  ok(cj.indexOf('data.costoReparacionARS = cRep;') < cj.lastIndexOf("tarjetaAplicar(data);   // 💳 lo que se queda Getnet"), 'antes de descontar la comisión de la tarjeta');
  ok(/sincostorep:/.test(hy) && /fn: 'costosRep'/.test(hy) && /abrirCostosLista\('reparacion'\)/.test(hy), '"Para hacer hoy" avisa las entregadas del mes sin costo, con botón para cargarlas');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
