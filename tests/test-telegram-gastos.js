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

console.log('\n3) El movimiento de caja');
r = g('gasto $25.000 pantalla a32 transferencia');
const mov = ctx.armarMovimiento(r, '2026-11-08', '2026-11-08T15:00:00.000Z');
ok(mov.tipo === 'egreso' && mov.monto === 25000 && mov.categoria === 'Compra repuesto' && mov.metodoPago === 'Transferencia' && mov.fecha === '2026-11-08',
   'un egreso como los de la app (tipo, rubro, monto, cómo se pagó, fecha)', mov);
ok(mov.origen === 'telegram' && mov.cargadoPor === 'Telegram (dueño)', 'y se sabe que vino de Telegram');
const cats = (leer('caja.js').match(/egreso:\s*\[([^\]]+)\]/) || [])[1] || '';
ok(['Compra repuesto', 'Gasto fijo', 'Retiro dueño', 'Otro gasto'].every(c => cats.includes(`'${c}'`)), 'los rubros son los mismos de la caja', cats);
let txt = ctx.textoGastoCargado(r, '2026-11-08', {});
ok(/Gasto cargado en la caja/.test(txt) && /\$25\.000/.test(txt) && /deshacer/.test(txt), 'contesta qué cargó y cómo deshacerlo', txt);
txt = ctx.textoGastoCargado(g('pagué 80 mil de luz ayer'), '2026-11-07', { cajaCerrada: true });
ok(/de <b>ayer<\/b>, 07\/11/.test(txt) && /ya estaba cerrada/.test(txt), 'avisa si va a otro día y si esa caja ya estaba cerrada', txt);

console.log('\n4) Enganchado en el bot');
const hook = leer('api/telegram-webhook.js');
ok(/import \{[^}]*parsearGasto[^}]*\} from '\.\/_telegram-gastos\.js'/.test(hook), 'el bot usa estas funciones');
ok(/esGasto\(text\)\) \{\s*respuesta = await qGasto\(db, text\)/.test(hook), 'un mensaje de gasto lo carga');
ok(hook.indexOf('esGasto(text)') < hook.indexOf('respuesta = await qRepairByText(db, text)'), 'antes de buscarlo como reparación');
ok(/collection\('caja_movimientos'\)\.add\(mov\)/.test(hook), 'va a caja_movimientos (aparece en la caja de la app)');
ok(/lower === 'deshacer'/.test(hook) && /DESHACER_MIN \* 60e3/.test(hook) && /telegramUltimoGasto/.test(hook), '"deshacer" borra el último, solo si es de los últimos 30 minutos');
ok(/String\(msg\.chat\?\.id\) !== String\(process\.env\.TELEGRAM_CHAT_ID\)/.test(hook), 'solo lo puede usar el chat del dueño (como todo el bot)');
ok(/\$\{AYUDA_GASTOS\}/.test(hook), 'y está en la ayuda del bot');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
