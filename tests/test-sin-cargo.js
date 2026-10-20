// 🎁 Sin cargo: el cargador que se regala con el equipo.
//
// Alan: "cuando vendo un equipo se llevan un cargador y lo damos sin cargo,
// pero tengo que escanearlo y que se descuente del stock, cobrándolo o no".
// Antes un artículo en $0 frenaba el cobro ("falta el precio"), así que había
// que sacarlo de la venta y el stock no bajaba.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

console.log('\n1) Artículos en la misma venta (venta de equipo, cobro de reparación)');
const ctx = { console, Math, Number, String, Array, Object, JSON, esc: s => String(s), document: { getElementById: () => null } };
vm.createContext(ctx);
vm.runInContext(leer('venta-articulos.js'), ctx, { filename: 'venta-articulos.js' });
const run = c => vm.runInContext(c, ctx);
run(`VA_ITEMS = [{ id: 'c1', nombre: 'Cargador 20W', qty: 1, precio: 15000, costoARS: 5000, stock: 8 }]`);
run('_vaRegalo(0)');
ok(run('vaTotal()') === 0, 'en $0: no suma al total');
ok(run('vaSinPrecio()') === false, 'y no frena el cobro como "falta el precio"');
ok(run('vaStockUpdates()[0].qty') === 1 && run('vaStockUpdates()[0].regalo') === true, 'se descuenta del stock igual');
ok(run('vaCostoTotal()') === 5000, 'y su costo cuenta en la ganancia (regalarlo cuesta plata)');
ok(run('vaItems()[0].regalo') === true, 'queda marcado en la venta');
run('_vaRegalo(0)');
ok(run('vaTotal()') === 15000, 'tocando de nuevo, vuelve a su precio');
run(`VA_ITEMS = [{ id: 'x', nombre: 'Funda', qty: 1, precio: 0 }]`);
ok(run('vaSinPrecio()') === true, 'uno en $0 SIN marcar sigue frenando (que no se regale sin querer)');

console.log('\n2) Carrito de la caja');
const cj = leer('caja.js');
ok(/return _cart\.some\(it => !it\.regalo && \(Number\(it\.precio\) \|\| 0\) <= 0\);/.test(cj), 'lo marcado 🎁 no cuenta como "falta precio"');
ok(/function _toggleRegalo\(i\)/.test(cj) && /onclick="_toggleRegalo\(\$\{i\}\)"/.test(cj), 'cada renglón tiene el botón 🎁');
ok(/if \(!it \|\| it\.source === 'equipo'\) return;/.test(cj), 'el equipo no se puede regalar por error');
ok(/\.\.\.\(it\.regalo \? \{ regalo: true \} : \{\}\)/.test(cj), 'queda guardado en la venta');
ok(/stockUpdates\.push\(\{ collection, id: it\.id, stockField, qty, nombre: it\.nombre, regalo: !!it\.regalo \}\)/.test(cj), 'y el stock se descuenta como cualquier venta');
ok(/' \(sin cargo\)'/.test(cj), 'la descripción del movimiento lo dice');

console.log('\n3) Comprobantes');
ok(/it\.regalo \? ' \(sin cargo\)' : ''/.test(leer('comprobante-venta.js')), 'el ticket dice "(sin cargo)"');
ok((leer('print.js').match(/a\.regalo \? 'Sin cargo'/g) || []).length === 2, 'y el comprobante A5 "Sin cargo" en vez de $0');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
