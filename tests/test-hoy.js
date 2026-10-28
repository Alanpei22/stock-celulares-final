// ✅ Para hacer hoy (hoy.js): la tarjeta de arriba del Dashboard.
//
// Reemplazó a "🏢 La oficina" (personajes que avisaban de todo). Lo que se
// cuida: que avise SOLO lo que hace perder plata o clientes, que muestre 5
// como mucho, que lo que se termina se anote solo en el pedido, y que la IA
// reciba lo justo (sin teléfonos ni apellidos; sin montos si no hay permiso).
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

(async () => {
const LS = {}, els = {}, SETS = [], DOCS = {};
let ENVIADO = null, RESP = null, CONFIRMA = true, BATCH = [];
const ctx = { console, Math, Date, JSON, Number, String, Array, Object, Set, Promise,
  localStorage: { getItem: k => LS[k] ?? null, setItem: (k, v) => { LS[k] = String(v); } },
  document: { getElementById: id => els[id] || null, head: { appendChild() {} }, createElement: () => ({}) },
  confirm: () => CONFIRMA, toast() {},
  apiFetch: async (url, o) => { ENVIADO = JSON.parse(o.body); return { status: 200, text: async () => RESP }; },
  db: {
    collection: c => ({ doc: id => ({
      get: async () => ({ exists: !!DOCS[c + '/' + id], data: () => DOCS[c + '/' + id] }),
      set: async v => { SETS.push([c + '/' + id, v]); DOCS[c + '/' + id] = v; },
    }) }),
    batch: () => ({ update: (ref, v) => BATCH.push(v), commit: async () => {} }),
  },
};
vm.createContext(ctx);
vm.runInContext(leer('hoy.js'), ctx, { filename: 'hoy.js' });
const run = (c, v) => { if (v !== undefined) ctx._v = v; return vm.runInContext(c, ctx); };
const AHORA = Date.parse('2026-10-26T20:00:00-03:00');
const h = n => new Date(AHORA - n * 3600e3).toISOString();

console.log('\n1) Qué avisa');
const REPS = [
  { id: 'a', nOrden: 8350, marca: 'Moto', modelo: 'G32', estado: 'reparando', fechaIngreso: h(24 * 9) },
  { id: 'd', nOrden: 8398, marca: 'iPhone', modelo: '11', estado: 'listo', nombre: 'Juan Pérez', tlf: '11', fechaIngreso: h(24 * 30), fechaListo: h(24 * 25) },
  { id: 'f', nOrden: 8400, estado: 'listo', fechaIngreso: h(24 * 3), fechaListo: h(24 * 2) },
  { id: 'e', nOrden: 5191, estado: 'listo', fechaIngreso: h(24 * 945) },
  { id: 'v', nOrden: 5200, estado: 'reparando', fechaIngreso: h(24 * 400) },
];
const base = { ahora: AHORA, repairs: REPS, verPlata: true, esDueno: true,
  caja: { arqueo: true, cierre: false, movs: [{ tipo: 'ingreso', sinCosto: true }] },
  repuestos: [{ id: 'r1', tipo: 'Batería', marca: 'iPhone', modelo: '11', cantidad: 0, stockMin: 2 }, { id: 'r2', tipo: 'Flex', cantidad: 1, stockMin: 3 }, { id: 'r3', tipo: 'Viejo', cantidad: 0 }],
  productos: [], pedidos: [],
  equipos: [{ id: 'q', marca: 'Samsung', modelo: 'A15', fecha: h(24 * 120) }, { id: 'n', marca: 'Moto', modelo: 'E13', fecha: h(24 * 50) }],
  anotadosHoy: [] };
let it = run('hoyItems(_v)', base);
let cl = it.map(x => x.clave);
ok(it[0].clave.startsWith('caja:') && it[0].nivel === 'urgente', 'primero: la caja sin cerrar después de las 19:30', cl);
ok(cl.includes('retiro:d') && !cl.includes('retiro:f') && !cl.includes('retiro:e'), 'listo sin retirar hace 7+ días (no el de ayer, no el de hace años)', cl);
ok(/Juan no retiró su iPhone 11/.test(it.find(x => x.clave === 'retiro:d').texto) && !/Pérez/.test(JSON.stringify(it)), 'nombre de pila, sin apellido');
ok(it.find(x => x.clave === 'retiro:d').acciones[0].fn === 'waRepair', 'botón para avisarle por WhatsApp');
ok(cl.includes('fin:r1') && !cl.includes('fin:r2') && !cl.includes('fin:r3'), 'lo que SE TERMINÓ (no lo que está bajo, ni lo que no se trabaja)', cl);
ok(cl.some(c => c.startsWith('sincosto:')), 'ventas sin costo');
ok(cl.includes('quieto:q') && !cl.includes('quieto:n'), 'equipos parados 90+ días', cl);
ok(cl.includes('viejas') && /2 órdenes abiertas/.test(it.find(x => x.clave === 'viejas').texto), 'las órdenes viejas, en un solo renglón');
ok(!cl.some(c => /retiro:a|dem|tec|getnet|fich|foto/.test(c)), 'nada de lo que sobraba (demoradas, técnico, Getnet, fichadas, fotos)', cl);
it = run('hoyItems(_v)', Object.assign({}, base, { verPlata: false, esDueno: false }));
ok(!it.some(x => x.clave.startsWith('sincosto') || x.clave === 'viejas'), 'un empleado: sin costos ni el cierre de órdenes');
it = run('hoyItems(_v)', Object.assign({}, base, { ahora: Date.parse('2026-10-26T15:00:00-03:00') }));
ok(!it.some(x => x.clave.startsWith('caja:')), 'a las 15 la caja no se reclama');
it = run('hoyItems(_v)', Object.assign({}, base, { pedidos: [{ itemId: 'r1', comprado: false }] }));
ok(!it.some(x => x.clave === 'fin:r1'), 'lo que ya está en el pedido no se repite');

console.log('\n2) Se anota solo en el pedido');
await run('_hoyAutoPedido(_v)', Object.assign({}, base, { pedidosListos: true }));
ok(SETS.length === 1 && SETS[0][0] === 'pedidos/auto_r1' && SETS[0][1].cantidad === 4 && SETS[0][1].auto === true && SETS[0][1].categoria === 'Batería', 'anota «Batería iPhone 11» × 4 con id fijo', SETS);
ok(JSON.parse(LS.hoyAnotados).nombres[0] === 'Batería iPhone 11', 'y te lo cuenta después');
it = run('hoyItems(_v)', Object.assign({}, base, { anotadosHoy: ['Batería iPhone 11'] }));
ok(/Anoté en el pedido lo que se terminó: Batería iPhone 11/.test(it.find(x => x.clave.startsWith('anote:')).texto), '"Anoté en el pedido…" con botón al proveedor');
SETS.length = 0;
await run('_hoyAutoPedido(_v)', Object.assign({}, base, { pedidosListos: true }));
ok(SETS.length === 0, 'no lo intenta dos veces en la misma sesión');
vm.runInContext('_hoyIntentados.clear()', ctx);
DOCS['pedidos/auto_r1'] = { comprado: true, fechaCompra: new Date().toISOString() };
await run('_hoyAutoPedido(_v)', Object.assign({}, base, { pedidosListos: true }));
ok(SETS.length === 0, 'recién comprado (la compra no se cargó todavía): no lo vuelve a pedir');
vm.runInContext('_hoyIntentados.clear()', ctx);
await run('_hoyAutoPedido(_v)', Object.assign({}, base, { pedidosListos: false }));
ok(SETS.length === 0, 'sin el pedido cargado no anota nada (no sabe qué ya se anotó a mano)');

console.log('\n3) La tarjeta');
els['d-hoy'] = { innerHTML: '', style: {} };
vm.runInContext('_hoyCtx = () => _v', ctx); ctx._v = Object.assign({}, base);
// 8 cosas para hacer: se ven 5
ctx._v.equipos = [1, 2, 3, 4, 5].map(i => ({ id: 'q' + i, marca: 'Eq', modelo: String(i), fecha: h(24 * (100 + i)) }));
run('hoyRender()');
let html = els['d-hoy'].innerHTML;
ok((html.match(/class="hoy-item/g) || []).length === 5 && /Ver \d+ más/.test(html), 'muestra 5 y "ver N más"');
run('hoyVerTodo()');
ok((els['d-hoy'].innerHTML.match(/class="hoy-item/g) || []).length > 5, 'y al tocar, todo');
run('hoyPosponer("viejas", 4)');
ok(!/órdenes abiertas/.test(els['d-hoy'].innerHTML), '⏰ lo saca por un rato');
ctx._v = Object.assign({}, base, { repairs: [], caja: {}, repuestos: [], equipos: [], esDueno: false });
run('hoyRender()');
ok(els['d-hoy'].style.display === 'none', 'si no hay nada, la tarjeta no aparece');

console.log('\n4) Órdenes viejas: se cierran juntas');
ctx.REPAIRS = REPS; vm.runInContext('REPAIRS = this.REPAIRS', ctx);
await run('hoyCerrarViejas()');
ok(BATCH.length === 2 && BATCH.every(v => v.estado === 'entregado' && v.cierreMasivo), 'las 2 viejas quedan entregadas y marcadas', BATCH);
ok(BATCH.some(v => v.fechaEntrega === REPS[3].fechaIngreso), 'con la fecha de entonces, no la de hoy (no infla el resumen del día)');

console.log('\n5) La IA, solo con lo justo');
let d = run('hoyDatosIA("tito", _v)', Object.assign({}, base, { ahora: AHORA }));
ok(d.ordenesListas.some(o => o.cliente === 'Juan') && !/Pérez|"tlf"|11"/.test(JSON.stringify(d).replace(/"orden":\d+|iPhone 11/g, '')), 'Tito: nombre de pila, sin teléfono', d);
d = run('hoyDatosIA("lu", _v)', Object.assign({}, base, { verPlata: false, equipos: [{ id: 'q', marca: 'S', fecha: h(24), precio: 100, costo: 50 }] }));
ok(d.equipos[0].precioPesos === 100 && !('costoPesos' in d.equipos[0]), 'Lu sin permiso de totales: sin costo');
ctx._v = Object.assign({}, base);
RESP = '  ' + JSON.stringify({ ia: { respuesta: 'Listo', pasos: [], borradores: [{ titulo: 'Retiro', texto: 'Hola Juan, tu iPhone está listo. TechPoint', ref: 'd' }] } });
await run('hoyIA("tito", "Escribile a Juan")');
ok(ENVIADO.action === 'oficina' && ENVIADO.data.pj === 'tito' && ENVIADO.data.pregunta === 'Escribile a Juan', 'manda la pregunta armada');
html = els['d-hoy'].innerHTML;
ok(/Hola Juan, tu iPhone está listo/.test(html) && /Mandar a Juan/.test(html) && /Copiar/.test(html), 'muestra el mensaje con botón de WhatsApp y copiar');

console.log('\n6) Enganchado');
const ix = leer('index.html');
ok(/id="d-hoy"/.test(ix) && /src="hoy\.js"/.test(ix) && !/oficina/.test(ix), 'la tarjeta está en el Dashboard y la oficina ya no');
ok(/TL_MODOS = \['numeros', 'taller'\]/.test(leer('taller.js')), 'el Dashboard vuelve a dos vistas (quien tenía 🏢 guardado ve Números)');
ok(/hoyMostrar\(\)/.test(leer('app.js')) && /hoyRender\(\)/.test(leer('app.js')), 'se muestra con el Dashboard y se actualiza cuando cambian los datos');
ok(!fs.existsSync(DIR + 'oficina.js'), 'oficina.js se fue');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})();
