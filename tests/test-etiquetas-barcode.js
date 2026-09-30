// Código de barras de las etiquetas, y las etiquetas nuevas.
//
// Lo importante de esta prueba es la primera parte: la tabla de patrones de
// Code 128 son 107 filas de números que no se pueden revisar a ojo. Así que en
// vez de confiar, acá se DIBUJA el código en píxeles y se lo hace leer por la
// ZXing de verdad (la de vendor/), con el mismo envoltorio que usa la cámara
// de la app. Si la tabla tuviera un dígito mal, esto lo agarra.
//
// Y el número que lleva cada etiqueta es el que la caja busca al escanear:
// el IMEI del equipo, el código del artículo y el número de orden de la
// reparación. Si eso se desalinea, escanear la etiqueta no encuentra nada.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── barcode.js de verdad ────────────────────────────────────
const bcCtx = { console, Math, Number, String, Array };
bcCtx.globalThis = bcCtx;
vm.createContext(bcCtx);
vm.runInContext(fs.readFileSync(DIR + 'barcode.js', 'utf8'), bcCtx, { filename: 'barcode.js' });
const bits = t => { bcCtx._t = t; return vm.runInContext('code128Bits(_t)', bcCtx); };
const svg  = (t, o) => { bcCtx._t = t; bcCtx._o = o || {}; return vm.runInContext('code128Svg(_t, _o)', bcCtx); };

// ── El código dibujado en píxeles, como lo vería un lector ──
function imagen(b, mod = 3, alto = 120, quiet = 12) {
  const w = (b.length + quiet * 2) * mod, h = alto;
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let x = 0; x < w; x++) {
    const i = Math.floor(x / mod) - quiet;
    if (i < 0 || i >= b.length || b[i] !== '1') continue;
    for (let y = 0; y < h; y++) { const o = (y * w + x) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
  }
  return { px, w, h };
}

// El mismo envoltorio de ZXing que usa la cámara (escaner.js), sin tocar nada.
function envoltorioDeLaApp() {
  const src = fs.readFileSync(DIR + 'escaner.js', 'utf8');
  const desde = src.indexOf('function _escLectorZxing()');
  return src.slice(desde, src.indexOf('\n}\n', desde) + 3);
}

async function leerConZxing(IMG) {
  const lienzo = {
    width: IMG.w, height: IMG.h, style: {},
    getContext: () => ({ drawImage() {}, getImageData: () => ({ data: IMG.px, width: IMG.w, height: IMG.h }) }),
  };
  const c = {
    console, setTimeout, clearTimeout, Math, Date, Map, Set,
    Uint8ClampedArray, Uint8Array, Int32Array, Float32Array,
    document: { createElement: t => (t === 'canvas' ? lienzo : { style: {} }), body: { appendChild() {} } },
    navigator: { userAgent: 'node' },
  };
  c.HTMLVideoElement = class {}; c.HTMLImageElement = class {};
  c.self = c; c.globalThis = c; c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(DIR + 'vendor/zxing.min.js', 'utf8'), c, { filename: 'zxing.min.js' });
  vm.runInContext(envoltorioDeLaApp(), c, { filename: 'envoltorio' });
  const lector = vm.runInContext('_escLectorZxing()', c);
  const video = Object.assign(new c.HTMLVideoElement(), {
    videoWidth: IMG.w, videoHeight: IMG.h, width: IMG.w, height: IMG.h, style: {},
  });
  const r = await lector.detect(video);
  try { lector.stop(); } catch {}
  return r.length ? r[0].rawValue : '(no leyó nada)';
}

// ── print.js de verdad, con el HTML capturado ───────────────
let IMPRESO = null;
const TOASTS = [];
const pCtx = {
  console, Date, Math, JSON, Number, String, Array,
  setTimeout: f => { f(); return 0; },
  document: { getElementById: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } },
  window: { _DAKI_NAME: 'TechPoint', open: () => null },
  navigator: { userAgent: 'node' },
  toast: (m, t) => TOASTS.push([t, m]),
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
  alert: () => {}, btoa: s => Buffer.from(s, 'binary').toString('base64'), TextEncoder,
  unescape, encodeURIComponent,
};
pCtx.globalThis = pCtx; pCtx.self = pCtx;
vm.createContext(pCtx);
vm.runInContext(fs.readFileSync(DIR + 'qr.js', 'utf8'), pCtx, { filename: 'qr.js' });
vm.runInContext(fs.readFileSync(DIR + 'barcode.js', 'utf8'), pCtx, { filename: 'barcode.js' });
vm.runInContext(fs.readFileSync(DIR + 'print.js', 'utf8'), pCtx, { filename: 'print.js' });
vm.runInContext('_openPrint = (html, t) => { __CAP(html, t); };', pCtx);
pCtx.__CAP = (html, t) => { IMPRESO = { html, titulo: t }; };
const imprimir = (fn, datos, copias) => {
  IMPRESO = null; TOASTS.length = 0;
  pCtx.__D = datos; pCtx.__C = copias;
  vm.runInContext(`${fn}(__D, __C)`, pCtx);
  return IMPRESO ? IMPRESO.html : '';
};

// El SVG que dibujó la etiqueta mide en mm de verdad. Dos cosas que deciden si
// el lector lee: que ENTRE en la etiqueta y que la barra más fina no baje de
// 0,25mm. Se miden acá, no se suponen.
function medirBarras(html, valor, que) {
  const i = html.indexOf('>' + valor + '</text>');
  const svgIni = html.lastIndexOf('<svg', i);
  const ancho = Number((html.slice(svgIni, i).match(/width="([\d.]+)mm"/) || [])[1]);
  const modulos = bits(valor).length + 20;
  ok(ancho > 0 && ancho <= 40, `${que}: mide ${ancho}mm y entra en la etiqueta de 40mm`, ancho);
  ok(ancho / modulos >= 0.2499, `${que}: la barra más fina es ${(ancho / modulos).toFixed(3)}mm (mínimo 0,25)`,
     (ancho / modulos).toFixed(3));
}

(async () => {

console.log('\n1) Lo que dibujamos, ¿se lee?');
// Con la ZXing de verdad, la misma que usa la cámara del celular.
for (const [txt, que] of [
  ['356938035643809', 'un IMEI (15 dígitos)'],
  ['7790895000997',   'un código de fábrica (EAN de 13)'],
  ['TP00042',         'un código interno nuestro'],
  ['ACC-45X',         'uno con guión y letras'],
  ['7123',            'un número de orden corto'],
]) {
  const leido = await leerConZxing(imagen(bits(txt)));
  ok(leido === txt, `${que}: ${txt}`, leido);
}

console.log('\n2) El IMEI entra en una etiqueta de 40mm');
// Acá se juega todo: la etiquetadora usa rollos de 40×30 y un IMEI de 15
// dígitos es el código más largo que imprimimos. Modo C (dos dígitos por
// símbolo) contra modo B: 134 módulos contra 200. A 40mm de ancho eso es
// 0,25mm por barra contra 0,17 — y abajo de 0,25 los lectores fallan.
const modsImei = bits('356938035643809').length + 20;   // +20 = zonas mudas
ok(modsImei <= 160, `un IMEI son ${modsImei} módulos con zona muda (en modo B serían ~220)`, modsImei);
ok(modsImei * 0.25 <= 40, `a 0,25mm por barra mide ${(modsImei * 0.25).toFixed(1)}mm y entra en los 40mm`,
   (modsImei * 0.25).toFixed(1) + 'mm');

console.log('\n3) El SVG');
const s1 = svg('7123');
ok(/^<svg /.test(s1) && /<\/svg>$/.test(s1.trim()), 'es un SVG');
ok(/width="[\d.]+mm"/.test(s1), 'medido en mm, para que imprima del tamaño real', s1.slice(0, 120));
ok(/7123<\/text>/.test(s1), 'con el número escrito abajo');
ok(!/<text/.test(svg('7123', { leyenda: false })), 'salvo que se pida sin leyenda');
ok(svg('') === '', 'sin dato no dibuja nada (una etiqueta sin código no lleva barras)');
ok(svg('okéé') === svg('ok'), 'los acentos se sacan: Code 128 no los tiene');

console.log('\n4) Etiqueta de equipo');
const eq = imprimir('printEtiquetas', [{ marca: 'Samsung', modelo: 'Galaxy A54', almacenamiento: '128GB',
  estado: 'Usado', precio: 350000, imei: '356938035643809' }]);
ok(/Samsung Galaxy A54/.test(eq) && /\$350\.000/.test(eq), 'equipo y precio');
ok(/>356938035643809<\/text>/.test(eq), 'con el IMEI en barras');
medirBarras(eq, '356938035643809', 'el código del equipo');
// Es lo mismo que busca la caja: _movDesdeCodigo matchea por IMEI.
const caja = fs.readFileSync(DIR + 'caja.js', 'utf8');
ok(/digitos\.length >= 14/.test(caja), 'y la caja busca el equipo por ese mismo IMEI al escanear');

console.log('\n5) Etiqueta de artículo');
const pr = imprimir('printEtiquetasProductos', [
  { nombre: 'Vidrio templado iPhone 13', categoria: 'Vidrio templado / Hidrogel', precioVenta: 8000, codigo: '7790895000997' },
  { nombre: 'Cable tipo C', categoria: 'Cables', precioVenta: 5000, codigo: '' },
]);
ok(/Vidrio templado iPhone 13/.test(pr) && /\$8\.000/.test(pr), 'nombre y precio');
ok(/>7790895000997<\/text>/.test(pr), 'con su código en barras');
medirBarras(pr, '7790895000997', 'el código del artículo');
ok((pr.match(/<svg/g) || []).length === 1, 'el que no tiene código sale sin barras', (pr.match(/<svg/g) || []).length);
ok(/sin código/.test(pr), 'y la etiqueta lo dice, para no pegarla y descubrirlo después');
ok(TOASTS.some(t => /sin código/.test(t[1])), 'avisando cuántos fueron', TOASTS);
ok(/PRODUCTOS/.test(caja) && /String\(p\.codigo \|\| ''\)\.trim\(\) === txt/.test(caja),
   'y la caja busca el artículo por ese mismo código');

console.log('\n6) Etiqueta de reparación — la que se cuelga del equipo');
const rp = imprimir('printEtiquetasReparaciones', [{
  nOrden: 7123, marca: 'Motorola', modelo: 'G54', color: 'Negro', nombre: 'Juan Pérez', tlf: '11 5555-5555',
  falla: 'se apaga solo cuando llega al 30%', arreglo: 'Batería', imei: '356938035643809',
  fechaIngreso: '2026-09-24T14:00:00.000Z',
}]);
ok(/N° 7123/.test(rp), 'el número de orden, grande', rp.match(/etqr-nro[^<]*<\/div>/));
ok(/se apaga solo cuando llega al 30%/.test(rp), 'LA FALLA, que es para qué sirve la etiqueta');
ok(/Motorola G54 · Negro/.test(rp), 'qué equipo es');
ok(/Juan Pérez · 11 5555-5555/.test(rp), 'de quién es');
ok(/Batería/.test(rp), 'y qué hay que hacerle');
ok(/IMEI …643809/.test(rp), 'los últimos 6 del IMEI, para no confundir dos iguales');
ok(/>7123<\/text>/.test(rp), 'con el número de orden en barras');
medirBarras(rp, '7123', 'el número de orden');
// Escanear la etiqueta en la caja abre el cobro de esa orden.
ok(/digitos && digitos\.length <= 7/.test(caja) && /String\(r\.nOrden \|\| ''\) === digitos/.test(caja),
   'y escanearla en la caja abre el cobro de esa orden');
ok(/@page\{size:40mm 30mm/.test(rp), 'en la etiquetadora, como las demás');
ok(/\.etqr-arr\{display:none\}/.test(rp) && /\.etqr-pie\{display:none\}/.test(rp),
   'en 30mm de alto no entra todo: se prioriza número, equipo y falla', rp.match(/\.etqr-(arr|pie)\{[^}]*\}/g));
ok(/\.etqr-top \.etq-bc\{display:none\}/.test(rp),
   'y el código va abajo a lo ancho, no apretado al lado del número');

console.log('\n7) Varias copias del mismo');
const tres = imprimir('printEtiquetasProductos', [{ nombre: 'Cable', precioVenta: 5000, codigo: 'TP00001' }], 3);
ok((tres.match(/class="etq"/g) || []).length === 3, 'tres etiquetas de un artículo', (tres.match(/class="etq"/g) || []).length);
const cero = imprimir('printEtiquetasProductos', [{ nombre: 'Cable', precioVenta: 5000, codigo: 'TP00001' }], 0);
ok((cero.match(/class="etq"/g) || []).length === 1, 'pedir 0 imprime 1, no ninguna');
const mil = imprimir('printEtiquetasProductos', [{ nombre: 'Cable', precioVenta: 5000, codigo: 'TP00001' }], 999);
ok((mil.match(/class="etq"/g) || []).length === 20, 'y hay un techo: 999 copias son 42 hojas',
   (mil.match(/class="etq"/g) || []).length);

console.log('\n8) Sin nada que imprimir, no abre una hoja en blanco');
ok(imprimir('printEtiquetasProductos', []) === '' && TOASTS.some(t => /No hay/.test(t[1])), 'artículos');
ok(imprimir('printEtiquetasReparaciones', []) === '' && TOASTS.some(t => /No hay/.test(t[1])), 'reparaciones');

console.log('\n8b) El formato: etiquetadora por defecto, A4 de emergencia');
ok(vm.runInContext('etqFormato()', pCtx) === '40x30', 'arranca en la etiquetadora de 40×30');
const eq40 = imprimir('printEtiquetas', [{ marca: 'Samsung', modelo: 'A54', precio: 1, imei: '356938035643809' }]);
ok(/@page\{size:40mm 30mm;margin:0\}/.test(eq40), 'una etiqueta por página de 40×30');
vm.runInContext("setEtqFormato('a4')", pCtx);
const eqA4 = imprimir('printEtiquetas', [{ marca: 'Samsung', modelo: 'A54', precio: 1, imei: '356938035643809' }]);
ok(/@page\{size:A4 portrait/.test(eqA4) && /repeat\(3,63mm\)/.test(eqA4), 'y la hoja A4 sigue ahí');
// En A4 hay más ancho: la barra se engorda sola en vez de quedarse en el mínimo.
const wA4 = Number((eqA4.match(/width="([\d.]+)mm"/) || [])[1]);
const w40 = Number((eq40.match(/width="([\d.]+)mm"/) || [])[1]);
ok(wA4 > w40, `en A4 el mismo código sale más ancho (${wA4}mm contra ${w40}mm)`, [wA4, w40]);
const repA4 = imprimir('printEtiquetasReparaciones', [{ nOrden: 7123, marca: 'Motorola', modelo: 'G54', falla: 'x' }]);
ok(/grid-template-columns:repeat\(2,97mm\)/.test(repA4), 'la de reparación en A4 sigue siendo la grande');
vm.runInContext("setEtqFormato('40x30')", pCtx);

console.log('\n9) Enganchado donde hace falta');
const inv = fs.readFileSync(DIR + 'inventario.js', 'utf8');
const idx = fs.readFileSync(DIR + 'index.html', 'utf8');
const rep = fs.readFileSync(DIR + 'repairs.js', 'utf8');
const cajaHtml = fs.readFileSync(DIR + 'caja.html', 'utf8');
ok(/label: 'Imprimir etiquetas'/.test(inv), 'accesorios: en el menú');
ok(/imprimirEtiquetasInv[\s\S]{0,400}_invFiltrados\(\)/.test(inv),
   'y sale lo que está a la vista, con los filtros puestos');
ok(/_invFiltrados\(\)/.test(inv.slice(inv.indexOf('function renderInventario'))),
   'la lista usa ese mismo filtro (si no, se imprime una cosa y se ve otra)');
ok(/onclick="imprimirEtiquetaProducto\(\)"/.test(cajaHtml), 'y una sola desde la ficha del artículo');
ok(/label: 'Generar códigos de barras'/.test(inv), 'con cómo generar los códigos que faltan');
ok(/label: 'Tamaño de etiqueta'/.test(inv) && /setEtqFormato/.test(inv),
   'y cómo cambiar entre la etiquetadora y la hoja A4');
ok(/onclick="etiquetaReparacion\(\)"/.test(idx), 'reparaciones: botón en la ficha');
ok(/function etiquetaReparacion/.test(rep) && /printEtiquetasReparaciones/.test(rep), 'que imprime la etiqueta');
ok(/src="barcode\.js"/.test(idx) && /src="barcode\.js"/.test(cajaHtml), 'y las dos páginas cargan barcode.js');
ok(idx.indexOf('barcode.js') < idx.indexOf('print.js'), 'antes que print.js, que es quien lo usa');

console.log('\n10) Los códigos internos que se generan');
ok(/'TP' \+ String\(n\)\.padStart\(5, '0'\)/.test(inv), 'quedan como TP00001', inv.match(/'TP' \+[^;]*/));
ok(/\/\^TP\(\\d\{5,\}\)\$\//.test(inv), 'y el siguiente sale del más alto que ya haya, para no pisar ninguno');
ok(/p => !String\(p\.codigo \|\| ''\)\.trim\(\)/.test(inv),
   'solo a los que no tienen: los códigos de fábrica no se tocan');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
