// 📷 Escanear un celular en el Stock. Alan (14/11): "necesito desde el stock
// de celulares escanear el código de barras y que lo busque". Antes el
// buscador del stock no miraba el código de la etiqueta, y la pistola desde
// el Stock mandaba siempre a la caja.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// Las funciones del stock, sacadas de app.js
const app = leer('app.js');
const trozo = app.slice(app.indexOf('function stockPorCodigo'), app.indexOf('function render() {'));
const els = {
  search: { value: '' }, 'f-vendido': { value: '0' },
  'stock-section': { classList: { contains: c => c === 'section-hidden' && ctx._oculto } },
};
const TOASTS = [], CAJA = [];
let RENDERS = 0;
const ctx = {
  console, String, Array, Object, JSON, setTimeout: f => f(), location: { href: '' }, _oculto: false,
  document: { getElementById: id => els[id] || null },
  toast: (m, t) => TOASTS.push([t, m]), render: () => { RENDERS++; },
  switchSection: s => { ctx._fui = s; ctx._oculto = false; },
};
vm.createContext(ctx);
vm.runInContext(trozo, ctx, { filename: 'app.js (stock escanear)' });
vm.runInContext(leer('pistola.js'), ctx, { filename: 'pistola.js' });
vm.runInContext(`var STOCK = [
  { id: 'a', marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '128GB', codigo: 'IP13NEGRO128', codigoCorto: 'TP00041', imei: '356789012345678' },
  { id: 'b', marca: 'Samsung', modelo: 'A54', codigo: '7790000000017', vendido: true },
];`, ctx);
const run = c => vm.runInContext(c, ctx);

console.log('\n1) Encontrar el celular por el código');
ok(run('stockPorCodigo("TP00041", STOCK).id') === 'a' && run('stockPorCodigo("tp00041", STOCK).id') === 'a', 'por el código corto de la etiqueta (sin importar mayúsculas)');
ok(run('stockPorCodigo("IP13NEGRO128", STOCK).id') === 'a', 'por el código largo');
ok(run('stockPorCodigo("356789012345678", STOCK).id') === 'a', 'por el IMEI de la caja del equipo');
ok(run('stockPorCodigo("123", STOCK)') === null, 'uno que no es de nadie: nada');

console.log('\n2) Con la pistola, estando en el Stock');
ctx.pistolaACaja = c => CAJA.push(c);
const BODY = { tagName: 'BODY' };
function escanear(texto, t0) { let t = t0; for (const k of [...texto, 'Enter']) { t += 8; const c = ctx.pistolaTecla({ key: k, target: BODY }, t); if (c) return c; } return null; }
let cod = escanear('TP00041', 10000);
ok(cod === 'TP00041' && ctx.pistolaEnStock(cod) === true, 'la etiqueta de un celular: se busca en el Stock');
ok(els.search.value === 'TP00041' && RENDERS === 1 && /iPhone 13/.test(TOASTS[0][1]), 'queda en el buscador, se ve en la lista y avisa cuál es', TOASTS);
ok(ctx.pistolaEnStock('7798123456789') === false, 'un código que no es de un celular (un accesorio) sigue a la caja como siempre');
ctx.pistolaEnStock('7790000000017');
ok(els['f-vendido'].value === '' && /VENDIDO/.test(TOASTS[TOASTS.length - 1][1]), 'si ya se vendió, lo muestra igual y avisa que está vendido');
ok(escanear('356789012345678', 50000) === '356789012345678', 'la pistola reconoce el IMEI (15 cifras)');
ctx._oculto = true;
ok(ctx.pistolaEnStock('356789012345678') === true && ctx._fui === 'stock', 'un IMEI desde otra pantalla: va al Stock a mostrarlo');
ctx._oculto = true;
ok(ctx.pistolaEnStock('TP00041') === false, 'pero un código común desde otra pantalla sigue yendo a la caja');

console.log('\n3) Enganchado');
const html = leer('index.html'), pis = leer('pistola.js');
ok(/\$\{p\.codigo \|\| ''\} \$\{p\.codigoCorto \|\| ''\}/.test(app), 'el buscador del stock ahora mira el código de la etiqueta (escaneando con el cursor en el buscador también anda)');
ok(/onclick="stockEscanearCam\(\)"/.test(html) && /abrirEscaner\(cod =>/.test(trozo), 'botón 📷 en el buscador del stock para escanear con la cámara del celu');
ok(/if \(pistolaEnStock\(cod\)\) return;/.test(pis) && /No hay ningún celular con el IMEI/.test(pis), 'la pistola primero mira el Stock; un IMEI que no está no va a la caja');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
