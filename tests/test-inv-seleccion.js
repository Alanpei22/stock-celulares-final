// Accesorios → Seleccionar varios: modificar o eliminar en masa.
//
// Lo delicado: un "+10%" mal interpretado cambia el precio de cientos de
// artículos de una, y eliminar no tiene vuelta atrás. Por eso se prueban las
// cuentas y que lo peligroso pida dueño (y PIN para eliminar).
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

(async () => {
const ESCRITO = [], TOASTS = [];
let OWNER = true, PIN_PEDIDO = 0, CONFIRMA = true, RESP = '';
const batch = () => { const ops = []; return {
  update: (ref, d) => ops.push({ op: 'update', id: ref.id, d }),
  delete: ref => ops.push({ op: 'delete', id: ref.id }),
  commit: async () => { ESCRITO.push(...ops); } }; };
const ctx = {
  console, Math, Number, String, Array, Object, JSON, Set, Map, Promise, parseInt, parseFloat,
  fmtNum: n => String(n), esc: s => String(s), toast: (m, t) => TOASTS.push([t, m]),
  document: { getElementById: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } },
  db: { batch, collection: () => ({ doc: id => ({ id }) }) },
  firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
  confirm: () => CONFIRMA, prompt: () => RESP, alert: () => {},
  _cajaIsOwner: true, requireCajaOwnerPin: cb => { PIN_PEDIDO++; cb(); },
  closeSheet() {}, openSheet() {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'inventario.js', 'utf8'), ctx, { filename: 'inventario.js' });
vm.runInContext('renderInventario = () => {}; _invSelBarra = () => {};', ctx);
const run = c => vm.runInContext(c, ctx);
const espera = () => new Promise(r => setTimeout(r, 0));

console.log('\n1) Las cuentas del precio');
const precio = (t, a) => { ctx._t = t; ctx._a = a; return run('_invNuevoPrecio(_t, _a)'); };
ok(precio('8000', 5000) === 8000 && precio('8.000', 5000) === 8000 && precio('$ 8000', 0) === 8000, '8000 / 8.000 / $8000 → todos a $8.000');
ok(precio('+10%', 8000) === 8800, '+10% sobre $8.000 → $8.800');
ok(precio('+10%', 8350) === 9200, 'redondeado a $100 ($8.350 + 10% = $9.185 → $9.200)');
ok(precio('-5%', 10000) === 9500, '-5% baja');
ok(precio('+500', 8000) === 8500 && precio('-500', 300) === 0, '+500 / -500 suma o resta pesos, nunca negativo');
ok(precio('diez', 8000) === null && precio('', 8000) === null && precio('10%', 8000) === null,
   'lo que no se entiende no cambia nada (ni un "10%" sin signo: ¿subir o fijar?)');

console.log('\n2) Las cuentas del stock');
const stock = (t, a) => { ctx._t = t; ctx._a = a; return run('_invNuevoStock(_t, _a)'); };
ok(stock('10', 3) === 10 && stock('+5', 3) === 8 && stock('-5', 3) === 0, '10 fija · +5 suma · -5 resta sin bajar de 0');
ok(stock('x', 3) === null, 'lo que no se entiende, no');

console.log('\n3) Aplicar a los marcados');
run(`PRODUCTOS = [
  { id: 'a', nombre: 'Funda A15', precioVenta: 8000, stock: 2, categoria: 'Funda / Cover' },
  { id: 'b', nombre: 'Funda A25', precioVenta: 9000, stock: 0, categoria: 'Funda / Cover' },
  { id: 'c', nombre: 'Cable C', precioVenta: 5000, stock: 4, categoria: 'Cable', activo: false }];
  _invFiltrados = () => PRODUCTOS.slice(0, 2);`);
run('invSelEntrar()'); run('invSelTodos()');
ok(run('[..._invSel].join()') === 'a,b', '"Todos" marca los de la lista filtrada, no todo el inventario');
run('invSelTodos()');
ok(run('_invSel.size') === 0, 'y tocarlo otra vez los desmarca');
run("_invSelToggle('a'); _invSelToggle('b')");
RESP = '+10%'; ESCRITO.length = 0;
run('invSelPrecio()'); await espera();
ok(ESCRITO.length === 2 && ESCRITO[0].d.precioVenta === 8800 && ESCRITO[1].d.precioVenta === 9900, 'precio +10% a los dos marcados', ESCRITO);

run("invSelEntrar(); _invSelToggle('a')");
ctx._cajaIsOwner = false; ESCRITO.length = 0; TOASTS.length = 0;
run('invSelPrecio()'); await espera();
ok(ESCRITO.length === 0 && TOASTS.some(t => /modo dueño/.test(t[1])), 'sin modo dueño no se cambian precios en masa');
run('invSelEliminar()'); await espera();
ok(ESCRITO.length === 0, 'ni se elimina');
ctx._cajaIsOwner = true;

RESP = '+3'; run('invSelStock()'); await espera();
ok(ESCRITO.length === 1 && ESCRITO[0].d.stock === 5, 'stock +3 → 5');
run("invSelEntrar(); _invSelToggle('c')"); ESCRITO.length = 0;
run('invSelActivo(true)'); await espera();
ok(ESCRITO.length === 1 && ESCRITO[0].d.activo === true, 'activar un desactivado');

console.log('\n4) Eliminar');
run("invSelEntrar(); _invSelToggle('a'); _invSelToggle('b')"); ESCRITO.length = 0; PIN_PEDIDO = 0;
CONFIRMA = false; run('invSelEliminar()'); await espera();
ok(ESCRITO.length === 0 && PIN_PEDIDO === 0, 'si no confirma, no pasa nada');
CONFIRMA = true; run('invSelEliminar()'); await espera();
ok(PIN_PEDIDO === 1, 'confirmado, pide el PIN');
ok(ESCRITO.length === 2 && ESCRITO.every(e => e.op === 'delete'), 'y borra los dos marcados', ESCRITO);
ok(run('_invSelModo') === false, 'y sale del modo selección');

console.log('\n5) En la pantalla');
const inv = fs.readFileSync(DIR + 'inventario.js', 'utf8');
ok(/label: 'Seleccionar varios'/.test(inv), 'en el menú de Accesorios');
ok(/_invSelModo \? `_invSelToggle/.test(inv), 'en modo selección, tocar un artículo lo marca en vez de abrirlo');
ok(/if \(tab !== 'inventario' && typeof _invSelModo !== 'undefined' && _invSelModo\) invSelSalir\(\)/.test(fs.readFileSync(DIR + 'caja.html', 'utf8')),
   'al cambiar de pestaña se sale (la barra no queda flotando sobre la caja)');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
