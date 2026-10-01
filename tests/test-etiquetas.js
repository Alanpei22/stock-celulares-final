// Etiquetas de los equipos (hoja A4 para cortar o pegar).
//
// Después de cargar un lote, los equipos quedan en el cajón sin nada pegado y
// para saber el precio hay que buscarlos en la app uno por uno.
//
// La etiqueta lleva modelo, precio y el IMEI en CÓDIGO DE BARRAS. Barras y no
// QR: el QR lo lee la cámara pero no el lector de mano del mostrador, y la
// cámara lee los dos. Que las barras se puedan DECODIFICAR de verdad se prueba
// aparte, en test-etiquetas-barcode.js.
//
// Salen de la etiquetadora térmica, una etiqueta por página. El rollo de 40×30
// entra parado (página de 30×40 con el contenido girado 90°), que es el sentido
// en que alimenta esta etiquetadora. La hoja A4 de 24 quedó como salida de
// emergencia para cuando se acaba el rollo.
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
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
  btoa: s => Buffer.from(s, 'binary').toString('base64'), TextEncoder,
  unescape, encodeURIComponent,
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'qr.js', 'utf8'), ctx, { filename: 'qr.js' });
vm.runInContext(fs.readFileSync(DIR + 'barcode.js', 'utf8'), ctx, { filename: 'barcode.js' });
vm.runInContext(fs.readFileSync(DIR + 'print.js', 'utf8'), ctx, { filename: 'print.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
// _openPrint abre una ventana: acá se captura el HTML
run(`_openPrint = (html, titulo) => { __CAP(html, titulo); };`);
ctx.__CAP = (html, titulo) => { IMPRESO = { html, titulo }; };

const EQUIPOS = [
  { id: 'a', marca: 'Samsung', modelo: 'Galaxy A54', almacenamiento: '128GB', ram: '8GB', estado: 'Nuevo',
    precio: 350000, imei: '356938035643809', codigo: 'TP00123' },
  { id: 'b', marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '256GB', estado: 'Usado',
    precio: 750000, precioUSD: 500, moneda: 'usd', bateria: 89, imei: '356938035643817', codigo: 'TP00124' },
  // Sin código ni IMEI: no hay nada que codificar, la etiqueta sale sin barras.
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

console.log('\n2) Ni el precio ni el IMEI van escritos');
// La etiqueta del equipo va pegada en la vidriera o en la caja, a la vista del
// cliente: el precio se canta, no se imprime, y el IMEI no es asunto suyo.
ok(!/350\.000/.test(html) && !/u\$500/.test(html), 'no sale el precio', html.match(/etq-precio[^<]*/g));
ok(!/356938035643809/.test(html), 'ni el IMEI escrito');
ok(!/<text/.test(html), 'ni debajo de las barras');

console.log('\n3) Especificaciones y estado');
ok(/128GB · 8GB RAM/.test(html), 'capacidad y RAM', html.match(/etq-specs">[^<]*/g));
ok(/🔋 89%/.test(html), 'batería en los usados (es lo primero que pregunta el cliente)');
ok(/Nuevo/.test(html) && /Usado/.test(html), 'el estado');

console.log('\n4) El código de barras lleva el código corto del equipo');
// Y no el IMEI: un IMEI son 154 módulos y en 38mm cada barra queda en 0,25mm,
// el mínimo que lee un lector. El código corto son ~100 y cada barra queda en
// 0,38mm. Con la cámara de un celular esa diferencia es todo.
ok((html.match(/<svg/g) || []).length === 2, 'barras en los que tienen código', (html.match(/<svg/g) || []).length);
ctx.__COD = 'TP00123';
const modsCod  = get('code128Bits(__COD)').length + 20;
const modsImei = get("code128Bits('356938035643809')").length + 20;
ctx.__MOD = Math.max(0.25, Math.min(0.5, 38.4 / modsCod));          // la misma cuenta que print.js
const esperado = get('code128Svg(__COD, { modulo: __MOD, alto: 11, leyenda: false })');
ok(html.includes(esperado), 'son las del código del equipo, no las del IMEI');
ok(modsCod < modsImei * 0.8,
   `el código corto son ${modsCod} módulos contra ${modsImei} del IMEI`, [modsCod, modsImei]);
ok(ctx.__MOD >= 0.3, `así cada barra mide ${ctx.__MOD.toFixed(2)}mm en vez de 0,25 — la cámara las ve`,
   ctx.__MOD.toFixed(3));
// Y las barras más altas: sin el precio ni el IMEI escritos sobra lugar, y una
// barra alta le da al lector más chances de cruzarla derecho.
ok(/height="11"/.test(html) || /height="1[0-9]/.test(html), 'y más altas que antes (7,5mm)',
   (html.match(/<rect[^>]*height="[\d.]+"/) || [])[0]);
ok(!/qrSvg/.test(fs.readFileSync(DIR + 'print.js', 'utf8').slice(
     fs.readFileSync(DIR + 'print.js', 'utf8').indexOf('function _etiquetaHtml'),
     fs.readFileSync(DIR + 'print.js', 'utf8').indexOf('function _barrasEtq'))),
   'y ya no queda el QR, que el lector de mano no lee');

console.log('\n5) La etiquetadora');
ok(/@page\{size:30mm 40mm;margin:0\}/.test(html), 'papel de 30×40 parado, sin márgenes', html.match(/@page[^}]*}/));
ok(!/class="hoja"/.test(html), 'una etiqueta por página: el rollo avanza sola');
ok(/\.pag \+ \.pag\{page-break-before:always\}/.test(html),
   'el corte va ENTRE etiquetas, nunca después de la última (si no sale una en blanco)');
ok((html.match(/class="pag"/g) || []).length === 3, 'una página por etiqueta', (html.match(/class="pag"/g) || []).length);
ok(!/dashed/.test(html), 'sin línea de corte: en térmica es tinta al pedo');

console.log('\n5b) El giro');
// El contenido se diseña sobre 40×30 y se gira entero. No se rediseña: el
// código de barras de un IMEI necesita 38,5mm y tiene que caer a lo largo de
// los 40mm. En 30 no entra a un ancho que se pueda leer.
ok(/transform:translateX\(30mm\) rotate\(90deg\)/.test(html), 'la etiqueta va girada 90° sobre la página');
ok(/transform-origin:0 0/.test(html), 'desde la esquina, que es lo que hace que el translate la devuelva al papel');
ok(/\.etq,\.etqr\{width:40mm;height:30mm/.test(html), 'y el contenido sigue midiendo 40×30');
const anchoBc = Number((html.match(/width="([\d.]+)mm"/) || [])[1]);
ok(anchoBc > 30 && anchoBc <= 40, `el código mide ${anchoBc}mm: usa el lado largo, no el de 30`, anchoBc);

console.log('\n5c) También se puede apaisada, si el driver alimenta al revés');
run("setEtqFormato('40x30')");
run('printEtiquetas(__EQ)');
const htmlAp = IMPRESO.html;
ok(/@page\{size:40mm 30mm;margin:0\}/.test(htmlAp), 'ahí la página es 40×30', htmlAp.match(/@page[^}]*}/));
ok(!/rotate\(90deg\)/.test(htmlAp), 'y no se gira nada');

console.log('\n5d) La hoja A4 sigue estando, para cuando se acaba el rollo');
run("setEtqFormato('a4')");
run('printEtiquetas(__EQ)');
const htmlA4 = IMPRESO.html;
ok(/@page\{size:A4 portrait/.test(htmlA4), 'A4 (cualquier impresora)', htmlA4.match(/@page[^}]*}/));
ok(/grid-template-columns:repeat\(3,63mm\)/.test(htmlA4) && /grid-auto-rows:34mm/.test(htmlA4),
   '3 columnas de 63×34 mm: la medida de las hojas autoadhesivas comunes');
ok(/dashed/.test(htmlA4), 'con línea de corte punteada');
run("setEtqFormato('30x40')");

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
