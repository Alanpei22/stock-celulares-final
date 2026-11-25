// 🏷️ Precio que se pone al cobrar + 💵 lista de costos y precios. Alan (25/11):
// "¿podemos armar algo para cargar los costos a las reparaciones que no
// tienen? Y a veces cuando entra una reparación no se pone el precio, pero sí
// cuando se cobra, y creo que no está cruzada esa info". Las estadísticas
// salen de repairs.monto: una cobrada sin precio en la orden contaba $0.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const u = leer('utils.js');
const ctx = { console, Math, Number, String, Array, Object, JSON };
const CONSULTAS = [];
ctx.db = { collection: () => ({ where: (campo, op, ids) => ({ get: async () => {
  CONSULTAS.push([campo, op, ids.length]);
  return { docs: ctx.MOVS.filter(m => ids.includes(m.repairId)).map(m => ({ data: () => m })) };
} }) }) };
vm.createContext(ctx);
vm.runInContext(u.slice(u.indexOf('function repCostoEfectivo'), u.indexOf('function tarjetaAplicar')), ctx, { filename: 'utils.js' });

(async () => {
  console.log('\n1) Al cobrar, el precio pasa a la orden');
  ok(ctx.repPrecioDesdeCobro({ monto: 0 }, 40000) === 40000, 'entró sin precio y se cobraron $40.000 → la orden queda en $40.000');
  ok(ctx.repPrecioDesdeCobro({ sena: 10000 }, 30000) === 40000, 'con seña: precio = seña + lo cobrado');
  ok(ctx.repPrecioDesdeCobro({ monto: 45000 }, 40000) === 0, 'si ya tenía precio (y se hizo un descuento), el de la orden no se toca');
  ok(ctx.repPrecioDesdeCobro({}, 0) === 0, 'sin cobrar nada, no inventa un precio');

  console.log('\n2) Las que ya se cobraron sin precio: se busca en la caja');
  ctx.MOVS = [
    { tipo: 'ingreso', esSena: true, monto: 10000, repairId: 'a' },
    { tipo: 'ingreso', esCobro: true, monto: 30000, repairId: 'a' },
    { tipo: 'ingreso', esCobro: true, monto: 52000, montoReparacion: 45000, repairId: 'b' },   // se llevó un vidrio
    { tipo: 'ingreso', esSena: true, monto: 5000, repairId: 'c' },                              // solo la seña
    { tipo: 'egreso', esCobro: true, monto: 9999, repairId: 'a' },
  ];
  const REPS = [{ id: 'a', sena: 10000 }, { id: 'b' }, { id: 'c', sena: 5000 }, { id: 'd', monto: 20000 }];
  ok(ctx.repCobradoDeMovs(REPS[0], ctx.MOVS) === 40000, 'seña + cobro = $40.000 (los egresos no cuentan)');
  ok(ctx.repCobradoDeMovs(REPS[1], ctx.MOVS) === 45000, 'si se llevó algo más, solo la parte de la reparación');
  ok(ctx.repCobradoDeMovs(REPS[2], ctx.MOVS) === 0, 'solo con la seña no se sabe el precio: no se completa');
  ok(ctx.repCobradoDeMovs({ id: 'a', sena: 15000 }, ctx.MOVS.slice(1, 2)) === 45000, 'una seña cargada en la orden sin movimiento en la caja también cuenta');
  const enc = await ctx.repPreciosDesdeCaja(REPS);
  ok(JSON.stringify(enc) === '[{"id":"a","monto":40000},{"id":"b","monto":45000}]', 'devuelve las que encontró (no guarda nada)', enc);
  ok(CONSULTAS.length === 1 && CONSULTAS[0][0] === 'repairId' && CONSULTAS[0][1] === 'in' && CONSULTAS[0][2] === 3, 'una sola consulta, solo de las órdenes sin precio (no lee la caja entera)', CONSULTAS);
  CONSULTAS.length = 0;
  await ctx.repPreciosDesdeCaja(Array.from({ length: 65 }, (_, i) => ({ id: 'x' + i })));
  ok(CONSULTAS.length === 3 && CONSULTAS.every(c => c[2] <= 30), 'de a 30 por consulta (el máximo de Firestore)', CONSULTAS);

  console.log('\n3) Enganches en los dos cobros');
  const cj = leer('caja.js'), rp = leer('repairs.js'), html = leer('index.html');
  ok(/const precioCobro = \(typeof repPrecioDesdeCobro === 'function'\) \? repPrecioDesdeCobro\(repair, repAmt\)/.test(cj)
     && /if \(precioCobro > 0\) \{ upd\.monto = precioCobro; upd\.montoDesdeCobro = true; \}/.test(cj), 'caja: el cobro vinculado le escribe el precio a la orden');
  ok(/const precioOrden = Number\(repair\.monto\) \|\| precioCobro \|\| repAmt;/.test(cj), 'caja: la ganancia usa el precio entero (con la seña), no solo el saldo');
  ok(/id="cobro-precio-box"/.test(html) && /id="cobro-precio"[^>]*oninput="_cobroPintarTotal\(\)"/.test(html), 'Reparaciones → Cobrar: casilla de precio cuando la orden no tiene');
  ok(/const repAmt = sinPrecio \? Math\.max\(0, precioNuevo - \(Number\(r\.sena\) \|\| 0\)\) : _saldoACobrar\(r\);/.test(rp), 'se cobra lo escrito menos la seña');
  ok(/if \(sinPrecio && precioNuevo > 0\) \{ repUpd\.monto = precioNuevo; repUpd\.montoDesdeCobro = true; \}/.test(rp) && /_repPatchLocal\(r\.id, repUpd\)/.test(rp), 'y el precio queda en la orden');
  ok(/Se entrega SIN COBRAR/.test(rp), 'en $0 solo si se confirma que es sin cargo (antes cobraba $0 sin avisar)');
  // El cartel, de verdad
  const ini = rp.indexOf('let _cobroRepair = null;'), fin = rp.indexOf('function selectCobroMetodo');
  const els = {};
  const el = id => (els[id] = els[id] || { id, value: '', textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} }, focus() {} });
  const c2 = { console, Math, Number, String, parseFloat, setTimeout: () => 0, REPAIRS: [],
    document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null, body: { style: {} } } };
  vm.createContext(c2);
  vm.runInContext(rp.slice(ini, fin), c2, { filename: 'repairs.js' });
  const r = { id: 'z', nOrden: 9001, marca: 'Samsung', modelo: 'A15', sena: 5000 };
  c2.REPAIRS.push(r);
  c2.openCobroModal(r);
  ok(els['cobro-precio-box'].style.display === '' && /precio menos la seña/.test(els['cobro-sena-info'].innerHTML), 'sin precio: aparece la casilla y explica la seña');
  els['cobro-precio'].value = '35000';
  c2._cobroPintarTotal();
  ok(els['cobro-monto-label'].textContent === '$ ' + (30000).toLocaleString('es-AR'), 'escribís $35.000 → el número grande dice $30.000 (le resta la seña)', els['cobro-monto-label'].textContent);
  c2.openCobroModal({ id: 'y', monto: 20000 });
  ok(els['cobro-precio-box'].style.display === 'none', 'con precio, la casilla no aparece');

  console.log('\n4) La lista de costos (y precios)');
  const cl = leer('costos-lista.js');
  const cx = { console, Math, Number, String, Array, Object, JSON, Date, esc: s => String(s), document: { getElementById: () => null } };
  vm.createContext(cx);
  vm.runInContext(cl, cx, { filename: 'costos-lista.js' });
  const cfg = vm.runInContext('_COSTOS_CFG.reparacion', cx);
  ok(cfg.faltaPrecio({ monto: 0 }) && !cfg.faltaPrecio({ monto: 1 }) && cfg.soloFaltanDeEntrada, 'marca las sin precio y arranca mostrando solo lo que falta');
  const cam = vm.runInContext(`_costosCambios('reparacion', [
    { value: '40000', dataset: { campo: 'monto', id: 'a', antes: '' } },
    { value: '12000', dataset: { id: 'a', antes: '' } },
    { value: '0', dataset: { campo: 'monto', id: 'b', antes: '' } },
    { value: '8000', dataset: { id: 'b', antes: '' } },
  ], 1000, 'DEL')`, cx);
  ok(cam.length === 2 && cam[0].data.monto === 40000 && cam[0].data.costo === 12000 && !('monto' in cam[1].data) && cam[1].data.costo === 8000,
     'precio y costo de la misma orden se guardan juntos; un precio en 0 no se guarda', cam);
  ok(/'costo' in c\.data && r\.cobrado && typeof repActualizarCobro === 'function'/.test(cl), 'poner solo el precio no toca el cobro de la caja');
  ok(/querySelectorAll\('\.costos-inp:not\(\.costos-precio\)'\)/.test(cl), '"Pegar lista" sigue llenando solo los costos');
  ok(/onclick="_costosPreciosCaja\(\)"/.test(cl) && /await repPreciosDesdeCaja\(reps\)/.test(cl), 'botón "Traer precios de la caja"');
  ok(/sinpreciorep:/.test(leer('hoy.js')) && /Poner precios', fn: 'costosRep'/.test(leer('hoy.js')), 'Inicio avisa las entregadas del mes sin precio y abre la lista');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})();
