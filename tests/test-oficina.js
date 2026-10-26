// 🏢 La oficina: personajes que miran el local y avisan.
//
// Alan quería algo "tipo oficina, con personajes que tengan sus roles y
// trabajen avisando cosas o preguntando". Cada personaje tiene una función
// revisar(ctx) PURA: estas pruebas le pasan datos y miran qué diría.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const LS = {};
const ctx = { console, Math, Date, JSON, Number, String, Array, Object, Set,
  localStorage: { getItem: k => LS[k] ?? null, setItem: (k, v) => { LS[k] = String(v); } } };
vm.createContext(ctx);
vm.runInContext(leer('oficina.js'), ctx, { filename: 'oficina.js' });
const run = (c, v) => { ctx._v = v; return vm.runInContext(c, ctx); };
const AHORA = Date.parse('2026-10-26T15:00:00-03:00');
const h = n => new Date(AHORA - n * 3600e3).toISOString();

console.log('\n1) Tito · Taller');
let t = run(`revisarTito(Object.assign({ ahora: ${AHORA} }, _v))`, { repairs: [
  { id: 'a', nOrden: 8350, marca: 'Moto', modelo: 'G32', estado: 'reparando', fechaIngreso: h(24 * 9), tecnico: 'Nacho' },
  { id: 'b', nOrden: 8361, estado: 'reparando', fechaIngreso: h(24 * 4) },
  { id: 'c', nOrden: 8370, estado: 'reparando', fechaIngreso: h(10) },
  { id: 'd', nOrden: 8398, estado: 'listo', nombre: 'Juan', tlf: '11', fechaIngreso: h(24 * 20), fechaListo: h(24 * 10) },
  { id: 'e', nOrden: 5191, estado: 'listo', fechaIngreso: h(24 * 945) },
  { id: 'f', nOrden: 8400, estado: 'listo', fechaIngreso: h(24 * 3), fechaListo: h(24 * 2) },
] });
const cl = t.map(x => x.clave);
ok(cl.includes('tito:dem:a') && t.find(x => x.clave === 'tito:dem:a').nivel === 'urgente', 'una demorada de 9 días es urgente');
ok(t.find(x => x.clave === 'tito:dem:a').texto.includes('la tiene Nacho'), 'y dice quién la tiene');
ok(cl.includes('tito:dem:b') && !cl.includes('tito:dem:c'), 'una de hoy no es demorada');
const ret = t.find(x => x.clave === 'tito:retiro:d');
ok(ret && ret.acciones.some(a => a.fn === 'waRepair'), 'lista hace 10 días: pregunta si le manda WhatsApp', ret);
ok(!cl.includes('tito:retiro:f'), 'lista hace 2 días: todavía no molesta');
ok(cl.includes('tito:viejas') && !cl.includes('tito:retiro:e'), 'las órdenes de hace años van en UN aviso, no una por una');
ok(cl.includes('tito:sintec'), 'avisa de los equipos sin técnico');
const muchas = Array.from({ length: 9 }, (_, i) => ({ id: 'x' + i, nOrden: i, estado: 'reparando', fechaIngreso: h(24 * 5) }));
t = run(`revisarTito(Object.assign({ ahora: ${AHORA} }, _v))`, { repairs: muchas });
ok(t.filter(x => x.clave.startsWith('tito:dem:x')).length === 5 && t.some(x => x.clave === 'tito:dem:resto'), 'con muchas demoradas: 5 y "y N más"');

console.log('\n2) Rosa · Stock');
let r = run('revisarRosa(_v)', {
  repuestos: [
    { id: 'r1', tipo: 'Pantalla', nombre: 'Pantalla', marca: 'Samsung', modelo: 'A54', cantidad: 1, stockMin: 3 },
    { id: 'r2', tipo: 'Batería', nombre: 'Batería', marca: 'iPhone', modelo: '11', cantidad: 0, stockMin: 2 },
    { id: 'r3', tipo: 'Flex', nombre: 'Flex', cantidad: 10, stockMin: 2 },
    { id: 'r4', tipo: 'Pin', nombre: 'Pin', cantidad: -2 },
  ],
  productos: [{ id: 'p1', nombre: 'Vidrio A14', stock: 1, stockMin: 5 }, { id: 'p2', nombre: 'Funda', stock: 1, stockMin: 3 }],
  pedidos: [{ itemId: 'p2', comprado: false }],
});
const rc = r.map(x => x.clave);
ok(rc.includes('rosa:min:r1') && rc.includes('rosa:min:r2') && !rc.includes('rosa:min:r3'), 'avisa lo que está en el mínimo o abajo');
ok(r.find(x => x.clave === 'rosa:min:r2').nivel === 'urgente', 'lo que se terminó es urgente');
ok(r.find(x => x.clave === 'rosa:neg:r4').nivel === 'urgente', 'stock negativo: hay que contar de nuevo');
const ped = r.find(x => x.clave === 'rosa:min:r1').acciones[0];
ok(ped.fn === 'pedido' && ped.cantidad === 5 && ped.categoria === 'Pantalla', 'propone pedir (mínimo × 2 − lo que hay), con su categoría', ped);
ok(rc.includes('rosa:min:p1') && !rc.includes('rosa:min:p2'), 'lo que ya está en el pedido no lo repite');
ok(run('_ofCategoriaPedido(_v)', { tipo: 'Vidrio templado' }) === 'Vidrio templado / Hidrogel', 'categorías del pedido');

console.log('\n3) Beto · Caja');
const beto = (hora, caja, extra) => run(`revisarBeto(Object.assign({ ahora: Date.parse('2026-10-26T${hora}:00-03:00'), caja: _v.caja }, _v.extra || {}))`, { caja, extra });
ok(beto('10:30', { arqueo: false, cierre: false, movs: [] }).some(x => x.clave.startsWith('beto:apertura')), '10:30 sin arqueo: avisa');
ok(!beto('09:30', { arqueo: false, cierre: false, movs: [] }).some(x => x.clave.startsWith('beto:apertura')), '9:30: todavía no');
ok(!beto('10:30', { arqueo: null, cierre: null, movs: [] }).length, 'si no pudo leer la caja (permisos), no inventa nada');
ok(beto('19:45', { arqueo: true, cierre: false, movs: [] }).some(x => x.nivel === 'urgente' && x.clave.startsWith('beto:cierre')), '19:45 sin cierre: urgente');
const tarj = { arqueo: true, cierre: false, movs: [{ tipo: 'ingreso', metodoPago: 'Tarjeta débito', monto: 1000 }] };
ok(beto('12:00', tarj, { tarjetas: {} }).some(x => x.clave === 'beto:getnet-cfg'), 'cobró con tarjeta sin comisión cargada: lo dice');
ok(!beto('12:00', tarj, { tarjetas: { debito: 2 } }).some(x => x.clave === 'beto:getnet-cfg'), 'con la comisión cargada, no');
const getnet = { arqueo: true, cierre: false, movs: [{ tipo: 'ingreso', comisionTarjeta: 500, netoTarjeta: 9500 }] };
ok(beto('12:00', getnet, { verPlata: true }).some(x => x.clave.startsWith('beto:getnet:')) && !beto('12:00', getnet, { verPlata: false }).some(x => x.clave.startsWith('beto:getnet:')),
   'lo que deposita Getnet: solo a quien puede ver la plata');
ok(beto('12:00', { arqueo: true, cierre: false, movs: [] }, { chequeoPendiente: '14:00' }).some(x => x.clave.includes('beto:chq')), 'chequeo pendiente');

console.log('\n3b) Lu · Ventas');
const eq = (id, dias, extra) => Object.assign({ id, marca: 'Samsung', modelo: 'A15', almacenamiento: '128GB', fecha: h(24 * dias), vendido: false, precio: 300000, costo: 200000 }, extra || {});
let lu = run(`revisarLu(Object.assign({ ahora: ${AHORA} }, _v))`, { verPlata: true, equipos: [
  eq('q1', 100, { publicar: true, fotos: ['https://x/1.jpg'] }), eq('q2', 50), eq('n1', 3), eq('r1', 120, { reservado: true }),
  eq('sf', 5, { publicar: true, fotos: [] }), eq('cf', 5, { fotos: ['https://x/2.jpg'] }), eq('sc', 5, { costo: 0 }), eq('v', 200, { vendido: true }) ] });
let lc = lu.map(x => x.clave);
ok(lc.includes('lu:quieto:q1') && lu.find(x => x.clave === 'lu:quieto:q1').nivel === 'aviso' && lc.includes('lu:quieto:q2'), 'equipos quietos (más de 90 días: aviso)', lc);
ok(!lc.includes('lu:quieto:n1') && !lc.includes('lu:quieto:r1') && !lc.includes('lu:quieto:v'), 'ni los nuevos, ni los reservados, ni los vendidos');
ok(/no está en la página/.test(lu.find(x => x.clave === 'lu:quieto:q2').texto), 'si además no está publicado, lo dice');
ok(lu.find(x => x.clave === 'lu:quieto:q1').acciones[0].fn === 'ia' && /id q1/.test(lu.find(x => x.clave === 'lu:quieto:q1').acciones[0].pregunta), 'botón ✨ para que la IA sugiera precio');
ok(lc.includes('lu:sinfoto:sf') && lc.includes('lu:publicar:1'), 'en la página sin fotos; con fotos sin publicar', lc);
ok(lc.some(c => c.startsWith('lu:sincosto:')), 'equipos sin costo cargado');
lu = run(`revisarLu(Object.assign({ ahora: ${AHORA} }, _v))`, { verPlata: false, equipos: [eq('sc', 5, { costo: 0 })] });
ok(!lu.some(x => x.clave.startsWith('lu:sincosto')), 'sin permiso de totales, no habla de costos');

console.log('\n3c) Marta · Personal y clientes');
vm.runInContext(leer('horas.js'), ctx, { filename: 'horas.js' });
const fich = (uid, nombre, tipo, iso) => ({ uid, nombre, tipo, dia: iso.slice(0, 10), ts: { toMillis: () => Date.parse(iso) } });
const FICH = [fich('u1', 'Nacho', 'entrada', '2026-10-24T10:00:00-03:00'),
  fich('u2', 'Lucas', 'entrada', '2026-10-24T10:05:00-03:00'), fich('u2', 'Lucas', 'salida', '2026-10-24T19:00:00-03:00'),
  fich('u2', 'Lucas', 'salida', '2026-10-25T19:00:00-03:00')];
let ma = run(`revisarMarta(Object.assign({ ahora: ${AHORA} }, _v))`, { esDueno: true, fichadas: FICH, repairs: [] });
let mc = ma.map(x => x.clave);
ok(mc.includes('marta:sinsal:u1:2026-10-24') && /Nacho no marcó la salida/.test(ma.find(x => x.clave === 'marta:sinsal:u1:2026-10-24').texto), 'salida sin marcar', mc);
ok(mc.includes('marta:sinent:u2:2026-10-25'), 'salida sin entrada');
ok(mc.includes('marta:nadie:2026-10-26'), 'a las 15 nadie fichó hoy: pregunta');
ok(!run(`revisarMarta(Object.assign({ ahora: ${AHORA} }, _v))`, { esDueno: false, fichadas: FICH, repairs: [] }).length, 'un empleado no ve las horas de los demás');
ma = run(`revisarMarta(Object.assign({ ahora: ${AHORA} }, _v))`, { esDueno: false, repairs: [
  { id: 'x', estado: 'entregado', tlf: '11', fechaEntrega: h(24 * 2) }, { id: 'y', estado: 'entregado', tlf: '11', fechaEntrega: h(24 * 20) },
  { id: 'z', estado: 'entregado', fechaEntrega: h(24) }, { id: 'w', estado: 'entregado', tlf: '11', devuelto: true, fechaEntrega: h(24) }] });
ok(ma.length === 1 && ma[0].clave === 'marta:resenas' && /^1 cliente retiró/.test(ma[0].texto), 'reseñas: solo los de esta semana, con WhatsApp y que no devolvieron', ma);
ok(ma[0].acciones[0].fn === 'ia' && ma[0].acciones[0].pj === 'marta', 'y la IA escribe los mensajes');
ok(/oficinaIA\(a\.pj, a\.pregunta\)/.test(leer('oficina.js')), 'el botón ✨ de un aviso le pregunta a la IA');

console.log('\n4) "Más tarde"');
LS.oficinaPosp = JSON.stringify({ 'tito:dem:a': AHORA + 3600e3 * 999999 });
const g = run(`oficinaHallazgos({ ahora: ${AHORA}, repairsListas: true, repairs: _v, stockListo: false, cajaLista: false })`, [{ id: 'a', estado: 'reparando', fechaIngreso: h(24 * 9) }]);
ok(!g[0].items.some(x => x.clave === 'tito:dem:a'), 'lo pospuesto no aparece hasta que se cumple el plazo');
ok(g[1].revisando && g[2].revisando && g[3].revisando, 'sin datos todavía, el personaje dice "Revisando…" (no "todo en orden")');

console.log('\n5) Enganchado');
const ix = leer('index.html');
ok(/onclick="tallerModo\('oficina'\)"/.test(ix) && /id="d-oficina"/.test(ix) && /src="oficina\.js"/.test(ix), 'tercera vista del Dashboard: 🏢 Oficina');
ok(/TL_MODOS = \['numeros', 'taller', 'oficina'\]/.test(leer('taller.js')), 'y se recuerda como las otras');
ok(/oficinaActiva\(\)\) \{ oficinaRender\(\); return; \}/.test(leer('app.js')), 'se actualiza cuando cambian los datos');
const of = leer('oficina.js');
ok(/#dash-section\.modo-oficina \.dash-body > \*:not\(\.d-topbar\):not\(\.d-oficina\) \{ display: none !important; \}/.test(of), 'en la oficina se esconden los números del dashboard');
ok(/Date\.now\(\) - _ofCaja\.leida < 5 \* 60e3/.test(of), 'la caja de hoy se lee como mucho cada 5 minutos (cupo)');
ok(/Date\.now\(\) - _ofFich\.leida < 15 \* 60e3/.test(of) && /tpEsDueno\(\)\)\) return;/.test(of), 'las fichadas: solo el dueño y cada 15 minutos (cupo)');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
