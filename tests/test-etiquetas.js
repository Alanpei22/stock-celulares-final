// Etiquetas de los equipos (hoja A4 para cortar o pegar).
//
// Después de cargar un lote, los equipos quedan en el cajón sin nada pegado y
// para saber el precio hay que buscarlos en la app uno por uno.
//
// La etiqueta lleva modelo, precio y un QR con el IMEI: escaneándolo con la
// misma app se encuentra el equipo.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

let IMPRESO = null;
const TOASTS = [];
const ctx = {
  console, Date, Math, JSON, Number, String, Array,
  setTimeout: f => { f(); return 0; },
  document: { getElementById: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } },
  window: { _DAKI_NAME: 'TechPoint', open: () => null },
  navigator: { userAgent: 'node' },
  toast: (m, t) => TOASTS.push([t, m]),
  alert: () => {},
  btoa: s => Buffer.from(s, 'binary').toString('base64'), TextEncoder,
  unescape, encodeURIComponent,
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'qr.js', 'utf8'), ctx, { filename: 'qr.js' });
vm.runInContext(fs.readFileSync(DIR + 'print.js', 'utf8'), ctx, { filename: 'print.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
// _openPrint abre una ventana: acá se captura el HTML
run(`_openPrint = (html, titulo) => { __CAP(html, titulo); };`);
ctx.__CAP = (html, titulo) => { IMPRESO = { html, titulo }; };

const EQUIPOS = [
  { id: 'a', marca: 'Samsung', modelo: 'Galaxy A54', almacenamiento: '128GB', ram: '8GB', estado: 'Nuevo',
    precio: 350000, imei: '356938035643809' },
  { id: 'b', marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '256GB', estado: 'Usado',
    precio: 750000, precioUSD: 500, moneda: 'usd', bateria: 89, imei: '356938035643817' },
  { id: 'c', marca: 'Motorola', modelo: 'G54', estado: 'Nuevo', precio: 290000, imei: '' },
];

console.log('\n1) Sale una etiqueta por equipo');
run('printEtiquetas(__EQ)', Object.assign(ctx, { __EQ: EQUIPOS }));
ctx.__EQ = EQUIPOS;
run('printEtiquetas(__EQ)');
ok(!!IMPRESO, 'imprime');
const html = IMPRESO.html;
ok((html.match(/class="etq"/g) || []).length === 3, 'tres etiquetas', (html.match(/class="etq"/g) || []).length);
ok(/Samsung Galaxy A54/.test(html) && /Apple iPhone 13/.test(html), 'con marca y modelo');

console.log('\n2) Lo que se mira de lejos: el precio');
ok(/\$350\.000/.test(html), 'precio en pesos', html.match(/etq-precio">[^<]*/g));
ok(/u\$500/.test(html), 'y en dólares el que se compró en dólares (no el convertido)', html.match(/u\$[\d.]+/g));

console.log('\n3) Especificaciones y estado');
ok(/128GB · 8GB RAM/.test(html), 'capacidad y RAM', html.match(/etq-specs">[^<]*/g));
ok(/🔋 89%/.test(html), 'batería en los usados (es lo primero que pregunta el cliente)');
ok(/Nuevo/.test(html) && /Usado/.test(html), 'el estado');

console.log('\n4) El QR lleva el IMEI');
// Así se escanea la etiqueta del cajón y la app encuentra el equipo.
ok((html.match(/<svg/g) || []).length === 2, 'QR solo en los que tienen IMEI', (html.match(/<svg/g) || []).length);
const qrEsperado = get(`qrSvg('356938035643809', 16, 2)`);
ok(html.includes(qrEsperado), 'y es el QR del IMEI de ese equipo');
ok(/IMEI …643809/.test(html), 'con los últimos 6 dígitos escritos, para el ojo');

console.log('\n5) La hoja');
ok(/@page\{size:A4 portrait/.test(html), 'A4 (cualquier impresora)', html.match(/@page[^}]*}/));
ok(/grid-template-columns:repeat\(3,63mm\)/.test(html) && /grid-auto-rows:34mm/.test(html),
   '3 columnas de 63×34 mm: la medida de las hojas autoadhesivas comunes');
ok(/dashed/.test(html), 'con línea de corte punteada si se imprime en papel común');

console.log('\n6) Sin equipos no abre una hoja en blanco');
IMPRESO = null; TOASTS.length = 0;
run('printEtiquetas([])');
ok(IMPRESO === null, 'no imprime nada', IMPRESO);
ok(TOASTS.some(t => /No hay equipos/.test(t[1])), 'y lo dice', TOASTS);

console.log('\n7) Enganchado donde hace falta');
const lote = fs.readFileSync(DIR + 'lote.js', 'utf8');
ok(/printEtiquetas\(docs\)/.test(lote), 'al terminar un lote las ofrece');
ok(/¿Imprimo las etiquetas/.test(lote), 'preguntando primero');
const app = fs.readFileSync(DIR + 'app.js', 'utf8');
ok(/function etiquetaDe/.test(app) && /printEtiquetas\(\[p\]\)/.test(app), 'y se puede reimprimir una sola desde la ficha');
ok(/etiquetaDe\('\$\{p\.id\}'\)/.test(app), 'con su botón en el detalle del equipo');
ok(!/etiquetaDe[\s\S]{0,400}p\.vendido \? /.test(app), 'el botón no aparece en equipos vendidos');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
