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
const printSrc = fs.readFileSync(DIR + 'print.js', 'utf8');
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
  const svgIni = html.indexOf('<svg');
  const ancho = Number((html.slice(svgIni, svgIni + 400).match(/width="([\d.]+)mm"/) || [])[1]);
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
ok(/Vidrio templado iPhone 13/.test(pr), 'nombre');
// El precio de los artículos va en clave: 0 + los primeros números.
ok(/class="etq-precio">080</.test(pr) && !/\$8\.000/.test(pr), 'el precio en clave ($8.000 → 080), no a la vista del cliente');
pCtx._n = 0;
const clave = n => { pCtx._n = n; return vm.runInContext('_precioClave(_n)', pCtx); };
ok(clave(8500) === '085' && clave(25000) === '025' && clave(99999) === '099', 'menos de $100.000: 0 + dos números');
ok(clave(150000) === '0150' && clave(15000) === '015', 'desde $100.000: 0 + tres (si no, $150.000 y $15.000 darían lo mismo)');
ok(clave(0) === '' && clave(null) === '', 'sin precio no se inventa una clave');
ok(/class="etq-cod">7790895000997</.test(pr), 'con el CÓDIGO escrito, que es lo que se lee en el mostrador',
   (pr.match(/class="etq-cod">[^<]*/) || [])[0]);
ok(/Vidrio templado \/ Hidrogel/.test(pr), 'y la categoría');
ok(!/<text/.test(pr), 'las barras van sin su leyenda: el número ya está arriba y no se escribe dos veces');
medirBarras(pr, '7790895000997', 'el código del artículo');
ok((pr.match(/<svg/g) || []).length === 1, 'el que no tiene código sale sin barras', (pr.match(/<svg/g) || []).length);
ok(/SIN CÓDIGO/.test(pr), 'y el que no tiene lo dice en la cara, para no pegarla y descubrirlo después');
ok(TOASTS.some(t => /sin código/.test(t[1])), 'avisando cuántos fueron', TOASTS);
ok(/PRODUCTOS/.test(caja) && /String\(p\.codigo \|\| ''\)\.trim\(\) === txt/.test(caja),
   'y la caja busca el artículo por ese mismo código');

console.log('\n5b) Etiqueta de repuesto');
// "Módulo" solo no dice nada: el nombre es el tipo con la marca y el modelo.
const rpu = imprimir('printEtiquetasRepuestos', [
  { id: 'r1', tipo: 'Módulo', nombre: 'A54 5G', marca: 'Samsung', modelo: 'A54',
    precioVenta: 90000, codigo: 'TP00007' },
  { id: 'r2', tipo: 'Batería', marca: 'Apple', modelo: 'iPhone 11', precioVenta: 45000, codigo: '' },
]);
ok(/Módulo A54 5G/.test(rpu), 'el tipo y el nombre juntos', (rpu.match(/etq-eq--prod">[^<]*/g) || []));
ok(/Samsung A54/.test(rpu), 'con la marca y el modelo, que es lo que lo identifica');
ok(/class="etq-cod">TP00007</.test(rpu), 'y el código escrito');
ok(/class="etq-precio">090</.test(rpu) && !/\$90\.000/.test(rpu), 'con el precio de venta en clave');
ok((rpu.match(/<svg/g) || []).length === 1, 'barras solo en el que tiene código');
ok(/SIN CÓDIGO/.test(rpu), 'y el otro lo dice');
medirBarras(rpu, 'TP00007', 'el código del repuesto');

console.log('\n6) Etiqueta de reparación — la que se cuelga del equipo');
// Sin código de barras a propósito: al equipo en el taller se lo busca por el
// número leyéndolo. Y sin las barras entra lo que de verdad se mira.
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
ok(/Batería/.test(rp), 'y el arreglo, que ahora entra porque no están las barras');
ok(!/<svg/.test(rp), 'SIN código de barras: no se escanea, se lee', (rp.match(/<svg[^>]*>/) || [])[0]);
ok(/24\/0?9/.test(rp), 'con la fecha de ingreso', (rp.match(/class="etqr-fecha">[^<]*/) || [])[0]);
// Si algún día se le quiere poner el código: la caja ya sabe abrir el cobro
// con el número de orden suelto, así que alcanzaría con volver a dibujarlo.
ok(/digitos && digitos\.length <= 7/.test(caja) && /String\(r\.nOrden \|\| ''\) === digitos/.test(caja),
   'la caja igual sabe abrir el cobro tecleando el número de orden');
ok(/@page\{size:30mm 40mm/.test(rp), 'en la etiquetadora, como las demás');
ok(/se apaga solo cuando llega al 30%/.test(rp) && /Juan Pérez/.test(rp) && /Batería/.test(rp),
   'y ahora entran juntos cliente, falla y arreglo');

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

console.log('\n8b) Los tres formatos');
ok(vm.runInContext('etqFormato()', pCtx) === '30x40', 'arranca parada: es como alimenta el rollo esta etiquetadora');
const eq40 = imprimir('printEtiquetas', [{ marca: 'Samsung', modelo: 'A54', precio: 1, imei: '356938035643809' }]);
ok(/@page\{size:30mm 40mm;margin:0\}/.test(eq40) && /rotate\(90deg\)/.test(eq40),
   'página de 30×40 con la etiqueta girada');
vm.runInContext("setEtqFormato('40x30')", pCtx);
const eqAp = imprimir('printEtiquetas', [{ marca: 'Samsung', modelo: 'A54', precio: 1, imei: '356938035643809' }]);
ok(/@page\{size:40mm 30mm;margin:0\}/.test(eqAp) && !/rotate\(90deg\)/.test(eqAp), 'o apaisada, sin girar');
// Girada o apaisada, el código mide lo mismo: siempre cae sobre los 40mm.
ok((eqAp.match(/width="([\d.]+)mm"/) || [])[1] === (eq40.match(/width="([\d.]+)mm"/) || [])[1],
   'y el código mide lo mismo en las dos: siempre cae a lo largo de los 40mm',
   [(eq40.match(/width="([\d.]+)mm"/) || [])[1], (eqAp.match(/width="([\d.]+)mm"/) || [])[1]]);
vm.runInContext("setEtqFormato('a4')", pCtx);
const eqA4 = imprimir('printEtiquetas', [{ marca: 'Samsung', modelo: 'A54', precio: 1, imei: '356938035643809' }]);
ok(/@page\{size:A4 portrait/.test(eqA4) && /repeat\(3,63mm\)/.test(eqA4), 'y la hoja A4 sigue ahí');
// En A4 hay más ancho: la barra se engorda sola en vez de quedarse en el mínimo.
const wA4 = Number((eqA4.match(/width="([\d.]+)mm"/) || [])[1]);
const w40 = Number((eq40.match(/width="([\d.]+)mm"/) || [])[1]);
ok(wA4 > w40, `en A4 el mismo código sale más ancho (${wA4}mm contra ${w40}mm)`, [wA4, w40]);
const repA4 = imprimir('printEtiquetasReparaciones', [{ nOrden: 7123, marca: 'Motorola', modelo: 'G54', falla: 'x' }]);
ok(/grid-template-columns:repeat\(2,97mm\)/.test(repA4), 'la de reparación en A4 sigue siendo la grande');
ok(!/<svg/.test(repA4), 'y tampoco lleva código de barras');
// Apaisada dada vuelta: hay drivers que tiran el rollo al revés y Chrome no
// deja girar la página, así que se gira acá. Misma página, contenido a 180°.
vm.runInContext("setEtqFormato('40x30r')", pCtx);
const eqR = imprimir('printEtiquetas', [{ marca: 'S', modelo: 'A20', precio: 1, imei: '356938035643809' }]);
ok(vm.runInContext('etqFormato()', pCtx) === '40x30r', 'la dada vuelta se guarda');
ok(/size:40mm 30mm/.test(eqR), 'dada vuelta: la página sigue siendo 40×30');
ok(/translate\(40mm,30mm\) rotate\(180deg\)/.test(eqR), 'y el contenido va girado 180° adentro del papel');
vm.runInContext("setEtqFormato('30x40')", pCtx);

console.log('\n8c) El sentido guardado, y que se note cuál está puesto');
// La versión anterior venía apaisada por defecto y la dejaba guardada. En los
// dispositivos que ya habían impreso, el sentido nuevo no llegaba: seguían
// tirando 40mm de ancho sobre una etiqueta de 30 y el contenido se iba a la
// etiqueta de al lado (pasó de verdad, con una foto de por medio).
ok(/_ETQ_KEY = 'etqFmt'/.test(printSrc), 'la clave cambió, así el sentido nuevo llega igual', (printSrc.match(/_ETQ_KEY = [^;]*/) || [])[0]);
ok(!/'etqFormato'/.test(printSrc), 'y no queda leyendo la vieja');
pCtx.localStorage._d['etqFormato'] = '40x30';   // lo que tenía guardado antes
ok(vm.runInContext('etqFormato()', pCtx) === '30x40', 'lo guardado por la versión vieja ya no manda');
// Y al imprimir se dice en qué sentido va: si sale corrida, el aviso explica
// dónde cambiarlo en vez de dejarte mirando la etiqueta sin saber por qué.
TOASTS.length = 0;
imprimir('printEtiquetas', [{ marca: 'S', modelo: 'A20', precio: 1, imei: '356938035643809' }]);
ok(TOASTS.some(t => /parada/.test(t[1])), 'al imprimir avisa el sentido', TOASTS);
ok(TOASTS.some(t => /corrida/.test(t[1])), 'y qué hacer si sale mal', TOASTS);

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
// El sentido se elige desde las TRES pantallas que imprimen. Vivía en
// inventario.js, que solo carga la caja: desde Repuestos el botón no hacía nada.
const appSrc = fs.readFileSync(DIR + 'app.js', 'utf8');
ok(/function elegirFormatoEtiqueta\(/.test(printSrc),
   'elegir el sentido vive en print.js, que es el único que cargan las dos páginas');
ok(!/function elegirFormatoEtiqueta\(/.test(inv), 'y no quedó una copia en inventario.js');
// Los menús la llaman sin typeof: si print.js no estuviera en las dos páginas,
// el menú reventaría al armarse en vez de no hacer nada.
ok(/src="print\.js"/.test(idx) && /src="print\.js"/.test(cajaHtml), 'y las dos páginas cargan print.js');
ok((appSrc.match(/label: 'Sentido de la etiqueta'/g) || []).length === 2,
   'está en el menú de Stock y en el de Repuestos', (appSrc.match(/label: 'Sentido de la etiqueta'/g) || []).length);
ok(/label: 'Sentido de la etiqueta'/.test(inv), 'y en el de Accesorios');
// Las opciones salen de la lista de formatos, no escritas a mano.
ok(/ETQ_FORMATOS\.map\(/.test(printSrc), 'las tres salen de la lista de formatos',
   (printSrc.match(/ETQ_FORMATOS\.map[^\n]*/) || [])[0]);
ok(/onclick="etiquetaReparacion\(\)"/.test(idx), 'reparaciones: botón en la ficha');
ok(/function etiquetaReparacion/.test(rep) && /printEtiquetasReparaciones/.test(rep), 'que imprime la etiqueta');
ok(/src="barcode\.js"/.test(idx) && /src="barcode\.js"/.test(cajaHtml), 'y las dos páginas cargan barcode.js');
ok(idx.indexOf('barcode.js') < idx.indexOf('print.js'), 'antes que print.js, que es quien lo usa');

console.log('\n10) Los códigos internos que se generan');
// El contador es UNO para accesorios y repuestos, que viven en pantallas
// distintas. Si cada uno llevara su cuenta, dos cosas terminarían con el mismo
// código — y para la caja, que busca primero en accesorios y después en
// repuestos, serían la misma cosa.
const utilsSrc = fs.readFileSync(DIR + 'utils.js', 'utf8');
const uCtx = { console, Math, Number, String, Array, JSON, Date, RegExp };
uCtx.globalThis = uCtx;
vm.createContext(uCtx);
vm.runInContext(utilsSrc.slice(utilsSrc.indexOf('const TP_COD_PREFIJO'),
                               utilsSrc.indexOf('//  IMEI — validación') - 60), uCtx);
const META = {};
uCtx.__db = { collection: () => ({ doc: () => ({
  get: async () => ({ exists: 'ultimoCodigo' in META, data: () => META }),
  set: async d => Object.assign(META, d),
}) }) };
const reservar = async (n, maxLocal) => {
  uCtx.__n = n; uCtx.__m = maxLocal || 0;
  return await vm.runInContext('tpReservarCodigos(__db, __n, __m)', uCtx);
};
ok(vm.runInContext('tpFormatoCodigo(1)', uCtx) === 'TP00001', 'quedan como TP00001',
   vm.runInContext('tpFormatoCodigo(1)', uCtx));
const c1 = await reservar(3);
ok(JSON.stringify(c1) === '["TP00001","TP00002","TP00003"]', 'la primera tanda arranca en 1', c1);
const c2 = await reservar(2);
ok(JSON.stringify(c2) === '["TP00004","TP00005"]', 'la segunda sigue donde quedó la primera', c2);
// Y esto es lo que evita el choque entre pantallas: la otra colección pide al
// mismo contador y no repite ninguno.
const c3 = await reservar(1);
ok(c3[0] === 'TP00006' && c1.concat(c2, c3).length === new Set(c1.concat(c2, c3)).size,
   'nunca repite un código, venga de accesorios o de repuestos', c3);
// Paracaídas: si el contador se borró, arranca por encima de lo que ya hay.
delete META.ultimoCodigo;
const c4 = await reservar(1, vm.runInContext("tpMaxCodigoLocal([{codigo:'TP00042'},{codigo:'7790895'}])", uCtx));
ok(c4[0] === 'TP00043', 'y si el contador se pierde, sigue del más alto que haya cargado', c4);
ok(vm.runInContext("tpMaxCodigoLocal([{codigo:'7790895000997'}])", uCtx) === 0,
   'los códigos de fábrica no cuentan para la serie');
ok(/p => !String\(p\.codigo \|\| ''\)\.trim\(\)/.test(inv),
   'solo a los que no tienen: los códigos de fábrica no se tocan');
ok(/tpReservarCodigos\(db, sin\.length, tpMaxCodigoLocal\(PRODUCTOS\)\)/.test(inv),
   'los accesorios piden al contador común');
const rep2 = fs.readFileSync(DIR + 'repuestos.js', 'utf8');
ok(/tpReservarCodigos\(db, sin\.length, tpMaxCodigoLocal\(REPUESTOS\)\)/.test(rep2),
   'y los repuestos también');

console.log('\n11) Repuestos: el campo código, que no existía');
// La caja ya buscaba el repuesto por `codigo` (`CAJA_REPUESTOS.codigo`), solo
// que no había dónde cargarlo: ese camino nunca encontraba nada.
ok(/id="rep2-fi-codigo"/.test(idx), 'hay campo en el formulario');
ok(/const codigo = \(document\.getElementById\('rep2-fi-codigo'\)\?\.value \|\| ''\)\.trim\(\)\.toUpperCase\(\)/.test(rep2),
   'se guarda en mayúsculas');
ok(/precioCostoUSD, precioVenta, precioCompra, codigo,/.test(rep2), 'y va al documento');
ok(/codEl\.value = r\.codigo \|\| ''/.test(rep2), 'y se vuelve a cargar al editar');
ok(/r\.proveedor, r\.codigo\]/.test(rep2),
   'el buscador lo encuentra por el código (si está impreso, tiene que servir para buscarlo)');
const buscaRepu = caja.slice(caja.indexOf('const repu = '), caja.indexOf('const repu = ') + 200);
ok(/CAJA_REPUESTOS/.test(buscaRepu) && /String\(r\.codigo \|\| ''\)\.trim\(\) === txt/.test(buscaRepu),
   'y la caja lo encuentra al escanear ese código', buscaRepu.slice(0, 120));
ok(/onclick="imprimirEtiquetaRepuesto\(\)"/.test(idx), 'con su botón de etiqueta en la ficha');
ok(/label: 'Imprimir etiquetas'/.test(fs.readFileSync(DIR + 'app.js', 'utf8')),
   'y en el menú de Repuestos');
ok(/_rep2Filtrados\(\)/.test(rep2.slice(rep2.indexOf('function renderRepuestos'))),
   'la lista y las etiquetas comparten el filtro');

console.log('\n12) Al ingresar un equipo salen solas la hoja y la etiqueta');
const save = rep.slice(rep.indexOf('async function saveRepair('), rep.indexOf('async function saveRepair(') + 12000);
ok(/imprimirIngresoReparacion\(newDoc\)/.test(save), 'saveRepair imprime con el doc recién creado (REPAIRS todavía no lo tiene)');
const fnIng = printSrc.slice(printSrc.indexOf('async function imprimirIngresoReparacion'), printSrc.indexOf('async function imprimirIngresoReparacion') + 400);
ok(fnIng.indexOf('_buildA5') >= 0 && fnIng.indexOf('_buildA5') < fnIng.indexOf('_etiquetaRepHtml'), 'primero la hoja A5, después la etiqueta');
ok(/await _imprimirEnIframe\(hoja\)/.test(fnIng) && fnIng.indexOf('await _imprimirEnIframe(hoja)') < fnIng.indexOf('_etiquetaRepHtml'),
   'y la etiqueta espera a que se cierre el diálogo de la hoja');
// document.open() borra los listeners de la ventana: el load puesto antes no
// se dispara y no imprime nada (pasó al hacerlo).
const fnIf = printSrc.slice(printSrc.indexOf('function _imprimirEnIframe'), printSrc.indexOf('async function imprimirIngresoReparacion'));
ok(fnIf.indexOf('document.close()') < fnIf.indexOf("addEventListener('load'"), 'el load se escucha después de escribir el iframe');
ok(!/window\.open/.test(fnIf), 'en iframe y no en ventana: después de esperar el N° el navegador bloquearía la ventana');

console.log('\n13) La clave y el patrón en la etiqueta de reparación');
const conClave = imprimir('printEtiquetasReparaciones', [{ nOrden: 7501, marca: 'Samsung', modelo: 'A32', falla: 'No carga',
  codigo: '147<258', patron: [0, 3, 6, 7, 8] }]);
ok(/Clave: 147&lt;258/.test(conClave), 'la clave sale escrita (y escapada)');
ok(/class="etqr-patron"><svg/.test(conClave), 'el patrón sale dibujado');
ok((conClave.match(/<line /g) || []).length === 4, 'una línea por tramo del patrón', (conClave.match(/<line /g) || []).length);
ok(/marker-end/.test(conClave) && /r="8" fill="#000"/.test(conClave), 'con el punto de arranque marcado y flecha al final: se sabe para dónde va');
ok(!/#6366f1|#0f172a/.test(conClave), 'en negro: el violeta sobre oscuro de la app en térmica es una mancha');
ok(/class="etqr etqr--clave"/.test(conClave), 'y con clave la falla corta antes, para que entre todo');
const sinClave = imprimir('printEtiquetasReparaciones', [{ nOrden: 7502, marca: 'Moto', modelo: 'G54', falla: 'x', patron: [4] }]);
ok(!/Clave:/.test(sinClave) && !/class="etqr-patron"/.test(sinClave) && !/class="etqr etqr--clave"/.test(sinClave),
   'sin clave ni patrón (o un patrón de un solo punto) queda como antes');
ok(!/_patronEtqSvg|etqr-clave/.test(printSrc.slice(printSrc.indexOf('function _a5Body'), printSrc.indexOf('function _a5Body') + 3000)),
   'la boleta A5 que se lleva el cliente sigue sin clave');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
