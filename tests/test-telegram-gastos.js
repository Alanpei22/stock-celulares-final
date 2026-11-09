// 💸 Gastos desde el bot de Telegram. Alan (08/11): "podemos cargar gastos
// desde el bot de Telegram". Se escribe como se habla y queda en la caja.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ctx = { console, Math, Number, String, Array, Object, JSON, RegExp, isFinite, parseFloat };
vm.createContext(ctx);
vm.runInContext(leer('api/_telegram-gastos.js').replace(/^export /gm, ''), ctx, { filename: '_telegram-gastos.js' });
const g = t => ctx.parsearGasto(t);

console.log('\n1) Se escribe como se habla');
let r = g('gasto 5000 nafta');
ok(r.monto === 5000 && r.descripcion === 'Nafta' && r.metodoPago === 'Efectivo' && r.categoria === 'Otro gasto', '"gasto 5000 nafta": efectivo, otro gasto', r);
r = g('gasto $25.000 pantalla a32 transferencia');
ok(r.monto === 25000 && r.metodoPago === 'Transferencia' && r.categoria === 'Compra repuesto' && r.descripcion === 'Pantalla a32', 'con $ y puntos, cómo se pagó, y el rubro sale de lo que dice (pantalla = repuesto)', r);
r = g('pagué 80 mil de luz ayer');
ok(r.monto === 80000 && r.categoria === 'Gasto fijo' && r.descripcion === 'Luz' && r.ayer === true, '"80 mil", luz = gasto fijo, "ayer" va a la caja de ayer', r);
r = g('gasté 5k en café');
ok(r.monto === 5000 && r.descripcion === 'Café', '"gasté" (con tilde) y "5k"', r);
r = g('gasto pantalla iphone 13 25000 mp');
ok(r.monto === 25000 && r.metodoPago === 'MercadoPago' && r.descripcion === 'Pantalla iphone 13', 'el número del modelo (13, a32) no se confunde con la plata', r);
r = g('compré 2 fundas $3.500 débito');
ok(r.monto === 3500 && r.metodoPago === 'Tarjeta débito', 'si hay un $, ese es el monto', r);
r = g('pagué el internet 18900 por transferencia');
ok(r.descripcion === 'Internet' && r.metodoPago === 'Transferencia' && r.categoria === 'Gasto fijo', 'limpia la descripción ("el internet por transferencia" → "Internet")', r);
r = g('retiro 20000');
ok(r.categoria === 'Retiro dueño' && r.monto === 20000, '"retiro" = retiro del dueño', r);
r = g('gasto 1,5 palos alquiler');
ok(r.monto === 1500000, '"1,5 palos"', r);

console.log('\n2) Lo que no es un gasto, o no se entiende');
ok(!ctx.esGasto('stock iphone') && !ctx.esGasto('7123') && !ctx.esGasto('gastos varios') && ctx.esGasto('Gasto 100 cafe'), 'solo arranca con gasto / gasté / pagué / compré / retiro');
ok(g('gasto nafta').error === 'sin monto', 'sin monto no carga nada');
ok(g('gasto 99999999 algo').error === 'monto raro', 'un monto disparatado no se carga (seguro es un error de tipeo)');

console.log('\n3) Va a TU caja (la caja dueño), a la cuenta que corresponde');
// Alan (09/11): "es para hacer una caja mía aparte… y llevar cuentas de las
// cuentas de transferencia y mercadopago". No es la caja del mostrador.
r = g('gasto $25.000 pantalla a32 transferencia');
ok(r.tipo === 'egreso' && r.cuenta === 'banco', 'pagado por transferencia: sale del banco', r);
ok(g('gasto 5000 nafta').cuenta === 'efectivo' && g('gasto 3000 algo mp').cuenta === 'mp' && g('gasto 3000 algo débito').cuenta === 'banco', 'efectivo, MercadoPago, y la tarjeta sale del banco');
r = g('guardé 50000');
ok(r.tipo === 'ingreso' && r.cuenta === 'efectivo' && r.monto === 50000, '"guardé 50000": entra al efectivo', r);
r = g('ingreso 30000 mp');
ok(r.tipo === 'ingreso' && r.cuenta === 'mp', '"ingreso 30000 mp": entra a MercadoPago', r);
ok(g('retiro 20000').tipo === 'egreso', 'el retiro sale de tu caja');
const mov = ctx.armarMovDueno(g('gasto $25.000 pantalla a32 transferencia'), '2026-11-09', '2026-11-09T15:00:00.000Z');
ok(mov.tipo === 'egreso' && mov.monto === 25000 && mov.cuenta === 'banco' && mov.fecha === '2026-11-09' && mov.desc === 'Pantalla a32' && mov.ts,
   'el movimiento es como los de la caja dueño (fecha, tipo, monto, desc, ts, cuenta)', mov);
ok(mov.origen === 'telegram' && mov.rubro === 'Compra repuesto', 'y se sabe que vino de Telegram, con su rubro');
// Lo que mueve en el saldo: igual que la app (cdEfecto de caja_extra.js)
const cx = { console, Math, Number, String, Array, Object, JSON, parseInt, isFinite, document: undefined };
vm.createContext(cx);
const extra = leer('caja_extra.js');
vm.runInContext(extra.slice(extra.indexOf('const CD_CUENTAS'), extra.indexOf('// Estilos de las cuentas')) + extra.slice(extra.indexOf('// Cuánto mueve un movimiento'), extra.indexOf('// El saldo guardado antes de las cuentas')), cx);
[['egreso', 'banco'], ['ingreso', 'mp'], ['egreso', 'efectivo']].forEach(([tipo, cuenta]) => {
  const m = { tipo, monto: 1234, cuenta };
  ok(JSON.stringify(ctx.efectoSaldo(m)) === JSON.stringify(vm.runInContext('cdEfecto(' + JSON.stringify(m) + ')', cx)), `el bot y la app mueven igual el saldo (${tipo} ${cuenta})`);
});
const des = ctx.efectoSaldo({ tipo: 'egreso', monto: 1000, cuenta: 'banco' }, true);
ok(des.saldo === 1000 && des.cuentas.banco === 1000 && des.egresos === -1000, '"deshacer" devuelve exactamente lo que se movió', des);
let txt = ctx.textoGastoCargado(g('gasto $25.000 pantalla a32 transferencia'), '2026-11-09', { saldoCuenta: 175000 });
ok(/Gasto en tu caja/.test(txt) && /−\$25\.000/.test(txt) && /🏦 Banco/.test(txt) && /Quedan en Banco: <b>\$175\.000/.test(txt) && /deshacer/.test(txt), 'contesta qué cargó, de qué cuenta y cuánto queda', txt);
txt = ctx.textoGastoCargado(g('pagué 80 mil de luz ayer'), '2026-11-08', {});
ok(/de <b>ayer<\/b>, 08\/11/.test(txt), 'avisa si va con fecha de ayer');
txt = ctx.textoSaldo({ saldo: 300000, cuentas: { efectivo: 100000, banco: 150000, mp: 50000 } });
ok(/💵 Efectivo: <b>\$100\.000/.test(txt) && /🏦 Banco: <b>\$150\.000/.test(txt) && /📱 MercadoPago: <b>\$50\.000/.test(txt) && /Total: <b>\$300\.000/.test(txt), '"saldo": las tres cuentas y el total', txt);
ok(/Efectivo: <b>\$80\.000/.test(ctx.textoSaldo({ saldo: 80000 })), 'el saldo de antes de las cuentas cuenta como efectivo');

console.log('\n4) Enganchado en el bot');
const hook = leer('api/telegram-webhook.js');
ok(/import \{[^}]*parsearGasto[^}]*\} from '\.\/_telegram-gastos\.js'/.test(hook), 'el bot usa estas funciones');
ok(/esGasto\(text\)\) \{\s*respuesta = await qGasto\(db, text\)/.test(hook), 'un mensaje de gasto lo carga');
ok(hook.indexOf('esGasto(text)') < hook.indexOf('respuesta = await qRepairByText(db, text)'), 'antes de buscarlo como reparación');
ok(/collection\('caja_dueno_movimientos'\)\.add\(mov\)/.test(hook) && !/collection\('caja_movimientos'\)\.add/.test(hook), 'va a la caja dueño, NO a la caja del mostrador');
ok(/doc\('cajaDuenoSaldo'\)/.test(hook) && /await aplicarSaldo\(db, mov\)/.test(hook) && /aplicarSaldo\(db, mov\.data\(\), true\)/.test(hook), 'corrige el saldo al cargar y al deshacer');
ok(/lower === 'deshacer'/.test(hook) && /DESHACER_MIN \* 60e3/.test(hook) && /telegramUltimoGasto/.test(hook), '"deshacer" borra el último, solo si es de los últimos 30 minutos');
ok(/lower === 'saldo'/.test(hook) && /qSaldoDueno/.test(hook), '"saldo" muestra las cuentas');
ok(/String\(msg\.chat\?\.id\) !== String\(process\.env\.TELEGRAM_CHAT_ID\)/.test(hook), 'solo lo puede usar el chat del dueño (como todo el bot)');
ok(/\$\{AYUDA_GASTOS\}/.test(hook), 'y está en la ayuda del bot');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
