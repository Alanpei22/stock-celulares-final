// 🔫 La pistola lectora desde cualquier pantalla (pistola.js).
//
// Alan: "si escaneo producto, ¿se puede acceder a la caja desde cualquier
// lado?". Lo que se cuida: que se reconozca la pistola (rápida, termina en
// Enter, parece un código) y NO a una persona tipeando; que con el cursor en
// un campo no se toque nada; y que el código llegue a la venta.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ctx = { console, Date, setTimeout: (f) => f(), location: { href: '' } };
const els = {};
ctx.document = { getElementById: id => els[id] || null };
vm.createContext(ctx);
vm.runInContext(leer('pistola.js'), ctx);
const BODY = { tagName: 'BODY' }, INPUT = { tagName: 'INPUT' };
// Simula teclas: cada una `ms` después de la anterior
function tipear(texto, ms, target = BODY, t0 = 10000) {
  let t = t0, cod = null;
  for (const k of [...texto, 'Enter']) { t += ms; const r = ctx.pistolaTecla({ key: k, target }, t); if (r) cod = r; }
  return cod;
}

console.log('\n1) Reconocer la pistola');
ok(tipear('7798123456789', 8) === '7798123456789', 'EAN de 13 cifras tipeado en milisegundos: es la pistola');
ok(tipear('TP00041', 8, BODY, 50000) === 'TP00041', 'nuestro código corto (TP#####) también');
ok(tipear('7798123456789', 150, BODY, 90000) === null, 'una persona tipeando despacio: no');
ok(tipear('hola', 8, BODY, 130000) === null, 'algo que no parece código: no');
ok(tipear('7798123456789', 8, INPUT, 170000) === null, 'con el cursor en un campo: no se toca (escribe ahí, como siempre)');
let r = null, t = 200000;
for (const k of ['7', '7', '9']) { t += 8; ctx.pistolaTecla({ key: k, target: BODY, ctrlKey: false }, t); }
t += 8; r = ctx.pistolaTecla({ key: 'c', target: BODY, ctrlKey: true }, t);
ok(r === null && ctx.pistolaTecla({ key: 'Enter', target: BODY }, t + 8) === null, 'un atajo con Ctrl corta la lectura');

console.log('\n2) A la caja');
ctx.pistolaACaja('7798123456789');
ok(ctx.location.href === 'caja.html?action=venta&scan=7798123456789', 'fuera de la caja: abre la caja con la venta y el producto');
let VENTA = null, BUSCADO = null;
els['mov-fi-desc'] = {}; els['mov-modal'] = { classList: { contains: c => c === 'hidden' } };
ctx.openMovFormType = tipo => { VENTA = tipo; };
ctx._movEnterBuscador = cod => { BUSCADO = cod; };
ctx.location.href = '';
ctx.pistolaACaja('7798123456789');
ok(VENTA === 'ingreso' && BUSCADO === '7798123456789' && ctx.location.href === '', 'en la caja: abre "Nueva venta" y lo agrega');
VENTA = null; els['mov-modal'] = { classList: { contains: () => false } };
ctx.pistolaACaja('TP00041');
ok(VENTA === null && BUSCADO === 'TP00041', 'con la venta ya abierta: lo suma a esa venta');

console.log('\n3) Enganchado');
const cj = leer('caja.js');
ok(/const scan = params\.get\('scan'\)/.test(cj) && /_movEnterBuscador\(scan\)/.test(cj), 'la caja lee ?scan= y carga el producto en la venta');
ok(/src="pistola\.js"/.test(leer('index.html')) && /src="pistola\.js"/.test(leer('caja.html')), 'está en la app y en la caja');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
