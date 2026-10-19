// 📜 Movimientos de stock: cada cambio de stock deja un renglón.
//
// Alan pidió un registro de movimientos de equipos, repuestos y accesorios.
// El stock cambiaba en muchos lados (alta, venta, anulación, reparación,
// rotura, control, edición a mano, borrado, Telegram) sin dejar rastro.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ESCRITOS = [];
const ctx = {
  console, Math, Date, JSON, Number, String, Array, Object,
  PRODUCTOS: [{ id: 'f1', nombre: 'Funda iPhone 15', codigo: 'TP00001', stock: 5 }],
  REPUESTOS: [{ id: 'r1', tipo: 'Pantalla', nombre: 'Pantalla', marca: 'Samsung', modelo: 'A54', cantidad: 2 }],
  STOCK: [{ id: 'e1', marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '128GB', imei: '356789012345678' }],
  tpUsuario: () => ({ uid: 'u1', nombre: 'Nacho' }),
  firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
  db: { collection: c => ({ add: async d => { ESCRITOS.push({ c, d }); return { id: 'x' }; } }) },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(leer('movstock.js'), ctx, { filename: 'movstock.js' });
const run = (c, v) => { ctx._v = v; return vm.runInContext(c, ctx); };

console.log('\n1) Qué se anota');
let r = run("movStockRenglon({ tipo: 'accesorio', id: 'f1', cant: -2, motivo: 'venta', movId: 'm1' })");
ok(r.nombre === 'Funda iPhone 15' && r.codigo === 'TP00001', 'el nombre y el código salen solos del artículo', r);
ok(r.cant === -2 && r.antes === 5 && r.despues === 3, 'cuánto, y la cantidad antes y después (de lo ya cargado: sin lecturas)', r);
ok(r.motivo === 'venta' && r.movId === 'm1', 'el motivo y el movimiento de caja', r);
ok(r.quien === 'Nacho' && r.uid === 'u1', 'quién lo hizo', r);
ok(/^\d{4}-\d{2}-\d{2}$/.test(r.fecha), 'y el día (hora argentina)', r.fecha);
r = run("movStockRenglon({ tipo: 'repuesto', id: 'r1', cant: -1, motivo: 'reparacion', repairId: 'rep9' })");
ok(r.nombre === 'Pantalla Samsung A54' && r.antes === 2 && r.despues === 1 && r.repairId === 'rep9', 'un repuesto usado en una reparación', r);
r = run("movStockRenglon({ tipo: 'equipo', id: 'e1', cant: -1, motivo: 'venta' })");
ok(r.nombre === 'Apple iPhone 13 128GB · …5678' && r.antes === undefined, 'un equipo: con el final del IMEI, sin cantidades', r);
r = run("movStockRenglon({ tipo: 'producto', id: 'zz', nombre: 'Algo', cant: 1, motivo: 'inventado' })");
ok(r.tipo === 'accesorio' && r.motivo === 'ajuste', 'un motivo desconocido no rompe: queda como ajuste', r);

console.log('\n2) Anotar nunca frena');
ESCRITOS.length = 0;
run("movStock({ tipo: 'accesorio', id: 'f1', cant: 3, motivo: 'compra' })");
ok(ESCRITOS.length === 1 && ESCRITOS[0].c === 'stock_movimientos' && ESCRITOS[0].d.ts === 'TS', 'se escribe en stock_movimientos con la hora de Firebase');
ctx.db = { collection: () => { throw new Error('sin internet'); } };
const w = console.warn; console.warn = () => {};
let tiro = false;
try { run("movStock({ tipo: 'accesorio', id: 'f1', cant: 1, motivo: 'alta' })"); } catch { tiro = true; }
console.warn = w;
ok(!tiro, 'si falla la anotación, la venta (o lo que sea) sigue igual');
ctx.db = { collection: c => ({ add: async d => { ESCRITOS.push({ c, d }); return { id: 'x' }; } }) };
ESCRITOS.length = 0;
run("movStockDiff({ tipo: 'accesorio', id: 'f1' }, 5, 5)");
ok(ESCRITOS.length === 0, 'editar sin cambiar la cantidad no anota nada');
run("movStockDiff({ tipo: 'accesorio', id: 'f1', motivo: 'control' }, 5, 3)");
ok(ESCRITOS.length === 1 && ESCRITOS[0].d.cant === -2 && ESCRITOS[0].d.antes === 5 && ESCRITOS[0].d.despues === 3, 'si cambió, anota la diferencia');

console.log('\n3) Buscar en el registro');
const L = [
  { tipo: 'accesorio', motivo: 'venta', nombre: 'Funda', codigo: 'TP1', quien: 'Nacho', cant: -1 },
  { tipo: 'repuesto', motivo: 'rotura', nombre: 'Módulo A10', quien: 'Alan', cant: -1 },
  { tipo: 'equipo', motivo: 'alta', nombre: 'iPhone 13', quien: 'Alan', cant: 1 },
];
const f = (x) => run('movStockFiltrar(_v.L, _v.f).length', { L, f: x });
ok(f({}) === 3 && f({ tipo: 'repuesto' }) === 1 && f({ motivo: 'alta' }) === 1, 'por tipo y por motivo');
ok(f({ q: 'nacho' }) === 1 && f({ q: 'tp1' }) === 1, 'y por texto: artículo, código o quién');

console.log('\n4) Enganchado donde cambia el stock');
const cuenta = (archivo, re) => (leer(archivo).match(re) || []).length;
const casos = [
  ['app.js',        /movStock\(\{ tipo: 'equipo'/g, 7, 'equipos: alta, venta, reserva, liberar, reactivar, borrar, IA, lista'],
  ['lote.js',       /motivo: 'alta', detalle: 'carga en lote'/g, 1, 'carga en lote'],
  ['caja.js',       /movStock\(/g, 10, 'caja: ventas (carrito y formulario), planes, anulaciones y deshacer'],
  ['repairs.js',    /motivo: 'reparacion'/g, 2, 'repuestos usados en reparaciones'],
  ['inventario.js', /movStock(Diff)?\(/g, 5, 'accesorios: alta, edición, borrado, control, cambios de a varios'],
  ['repuestos.js',  /movStock(Diff)?\(/g, 7, 'repuestos: alta, edición, ＋/−, borrado, control, importación'],
  ['roturas.js',    /motivo: 'rotura'/g, 1, 'roturas'],
  ['api/telegram-webhook.js', /anotarMovStock\(db/g, 2, 'lo que se suma o crea por Telegram'],
];
casos.forEach(([a, re, min, txt]) => { const n = cuenta(a, re); ok(n >= min, `${txt} (${a}: ${n})`, n); });
// Con increment() el número final no se sabe: se anota ANTES del descuento,
// cuando el listener todavía tiene la cantidad vieja.
const cj = leer('caja.js');
ok(cj.indexOf("motivo: data.repairId ? 'reparacion' : 'venta'") < cj.indexOf('[su.stockField]: firebase.firestore.FieldValue.increment(-su.qty)'),
   'en la caja se anota antes del descuento (así "antes → después" es correcto)');

console.log('\n5) Nadie lo puede tocar');
const rules = leer('firestore.rules');
ok(/match \/stock_movimientos\/\{doc\} \{\s*allow read, create: if isAllowed\(\);\s*allow update, delete: if false;/.test(rules),
   'se anota y se lee, pero no se edita ni se borra');
ok(/'stock_movimientos'/.test(rules.slice(rules.indexOf('function sensible('), rules.indexOf(']', rules.indexOf('function sensible(')))),
   'y la regla general no se lo abre');

console.log('\n6) Se puede ver');
ok(/src="movstock\.js"/.test(leer('index.html')) && /src="movstock\.js"/.test(leer('caja.html')), 'en la app y en la caja');
ok(/abrirMovStock\('repuesto'\)/.test(leer('app.js')) && /abrirMovStock\('accesorio'\)/.test(leer('inventario.js')) && /abrirMovStock\('equipo'\)/.test(leer('app.js')),
   'desde los menús de Equipos, Repuestos y Accesorios');
ok(/historialStock\('equipo'/.test(leer('app.js')) && /historialStock\('repuesto'/.test(leer('index.html')) && /historialStock\('accesorio'/.test(leer('caja.html')),
   'y el historial de cada artículo desde su ficha');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
