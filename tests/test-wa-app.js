// WhatsApp: abrir la app de escritorio sin la página intermedia de wa.me.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const store = {}, ABIERTO = [];
const ctx = { console, URLSearchParams, encodeURIComponent, decodeURIComponent, String, RegExp,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  location: { href: '' }, window: { open: (u, t) => { ABIERTO.push(u); return {}; }, addEventListener() {}, removeEventListener() {} },
  document: { addEventListener() {}, removeEventListener() {} }, setTimeout: () => 0,
  toast: () => {}, closeSheet: () => {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
// Solo el bloque de WhatsApp de utils.js
const u = leer('utils.js');
vm.runInContext(u.slice(u.indexOf("const _WA_APP_KEY")), ctx);
ctx.window.open = (x) => { ABIERTO.push(x); return {}; };
vm.runInContext('window.open = (x) => { __ab.push(x); return {}; }', Object.assign(ctx, { __ab: ABIERTO }));
const run = c => vm.runInContext(c, ctx);
const URL1 = 'https://wa.me/5491155551234?text=' + encodeURIComponent('Hola Juan, tu equipo está listo ✅ & ya');

console.log('\n1) Sin activar: como siempre');
ctx._u = URL1;
ok(run('waConvertir(_u)') === URL1, 'wa.me queda igual');
run('waAbrir(_u)');
ok(ABIERTO.pop() === URL1, 'y se abre en pestaña nueva');

console.log('\n2) Activado en esta PC');
run('toggleWaApp()');
ok(store.waApp === '1', 'se guarda por dispositivo');
const conv = run('waConvertir(_u)');
ok(conv.startsWith('whatsapp://send?phone=5491155551234&text='), 'pasa a whatsapp://send con el teléfono', conv);
ok(decodeURIComponent(conv.split('text=')[1]) === 'Hola Juan, tu equipo está listo ✅ & ya', 'el texto llega igual (tildes, emojis y &)');
ctx._s = 'https://wa.me/?text=' + encodeURIComponent('lista');
ok(run('waConvertir(_s)') === 'whatsapp://send?text=lista', 'sin teléfono: elegís el chat en la app');
ctx._x = 'https://ejemplo.com/?text=hola';
ok(run('waConvertir(_x)') === 'https://ejemplo.com/?text=hola', 'otros enlaces no se tocan');
ABIERTO.length = 0; ctx.location.href = '';
run('waAbrir(_u)');
ok(ctx.location.href.startsWith('whatsapp://send') && ABIERTO.length === 0, 'abre la app sin dejar una pestaña en blanco');
run('toggleWaApp()');
ok(store.waApp === '0' && run('waConvertir(_u)') === URL1, 'y se puede volver a wa.me');

console.log('\n2b) Sin elegir: en la compu va por la app, en el celular no');
delete store.waApp;
ctx.navigator = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130' };
ok(run('waAppActiva()') === true, 'Windows: app de escritorio, sin pestañas de wa.me');
ctx.navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile Chrome/130' };
ok(run('waAppActiva()') === false, 'celular: wa.me (ya abre la app sola)');
ctx.navigator = { userAgent: 'Windows' };
store.waApp = '0';
ok(run('waAppActiva()') === false, 'si en una compu se apagó, queda apagado');
console.log('\n3) Todo lo que abre el que usa la app pasa por waAbrir');
['repairs.js', 'tp-fases.js', 'app.js', 'pedidos.js', 'stock-extras.js'].forEach(f => {
  ok(!/window\.open\([^)]*wa\.me/.test(leer(f)) && !/window\.open\(url, '_blank'\)/.test(leer(f).replace(/[\s\S]*?(?=wa\.me)/, '')),
     f + ': ningún window.open directo a wa.me');
});
ok(/waAppActiva\(\)\) \{ e\.preventDefault\(\); waAbrir\(waBtn\.href\)/.test(leer('caja.js')), 'reporte del día');
ok(/onclick="if \(waAppActiva\(\)\) \{ event\.preventDefault\(\); waAbrir\(this\.href\); \}"/.test(leer('clientes.js')), 'ficha del cliente');
ok(/if \(app\) \{ waAbrir\(url\); return; \}/.test(leer('comprobante-venta.js')), 'comprobante de venta');
console.log('\n4) Lo que abre el CLIENTE sigue con wa.me');
ok(/https:\/\/wa\.me\//.test(leer('estado.html')) && !/waAbrir/.test(leer('estado.html')), 'la página de seguimiento');
ok((leer('print.js').match(/https:\/\/wa\.me\//g) || []).length >= 2, 'los QR impresos');
ok((leer('app.js').match(/label: 'WhatsApp: abrir la app de escritorio'/g) || []).length === 1 &&
   /label: 'WhatsApp: abrir la app de escritorio'/.test(leer('caja.js')), 'la opción está en el menú de Reparaciones y en el de la caja');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
