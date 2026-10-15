// Carteles de exhibición: los de la vidriera, A7, 8 por hoja A4.
//
// Esto se imprime y se pega en el mostrador: una vez que salió en papel, el
// cliente lo lee y discute el precio con eso en la mano. Así que lo que se
// mide acá es sobre todo la plata.
//
//   · La cuota sale del MISMO recargo que la ficha del equipo (PRICES.c3).
//     Un recargo propio del cartel era garantía de que un día la vidriera
//     dijera una cosa y el mostrador otra.
//   · Todo redondeado para arriba a la centena: en un cartel no va un
//     "$659.250" (eso aparece al pasar los dólares por la cotización).
//   · Un equipo sin precio NO sale. Salió publicado un Realme a "$67" porque
//     eran dólares en el campo de pesos; impreso y pegado es peor.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// ── El entorno de mentira ─────────────────────────────────
const els = {};
const el = id => els[id] = {
  id, value: '', textContent: '', innerHTML: '', srcdoc: '', disabled: false,
  style: {}, clientWidth: 480,
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
               contains(c) { return this._s.has(c); } },
  removeAttribute(a) { this[a] = ''; }, setAttribute() {}, addEventListener() {},
};
['carteles-modal', 'carteles-overlay', 'cart-f-buscar', 'cart-f-estado',
 'cart-gar-nuevo', 'cart-gar-usado', 'carteles-colores', 'carteles-lista',
 'carteles-cuenta', 'carteles-nota', 'carteles-imprimir', 'carteles-preview',
 'carteles-preview-wrap', 'carteles-ajustes', 'carteles-recargo'].forEach(el);

const ESCRITO = [];
const IMPRESO = [];
const ctx = {
  console, Math, JSON, Date, Set, Map, Number, String, Object, Array,
  parseInt, parseFloat, isNaN, isFinite, setTimeout: f => f(), clearTimeout,
  document: {
    getElementById: id => els[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el('tmp'), addEventListener() {},
    body: { style: {}, appendChild() {}, classList: { add() {}, remove() {} } },
  },
  window: { open: () => null, addEventListener() {} },
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; },
                  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  navigator: { userAgent: 'node' },
  toast: () => {}, alert: () => {},
  searchMatch: (hay, q) => String(hay).toLowerCase().includes(String(q).toLowerCase()),
  dolarBlue: 1465,
  PRICES: { transfer: 0, c3: 26, c6: 25 },
  _openPrint: html => IMPRESO.push(html),
  db: { collection: c => ({ doc: d => ({
    set: async (data, o) => { ESCRITO.push({ col: c, doc: d, data, o }); },
    update: async data => { ESCRITO.push({ col: c, doc: d, data }); } }) }) },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('carteles.js'), ctx, { filename: 'carteles.js' });
const run = e => vm.runInContext(e, ctx);
const call = (f, ...args) => { ctx.__a = args; return run(`${f}(...__a)`); };

const EQ = {
  // Un iPhone usado con batería
  ip: { id: 'ip', marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '128GB', ram: '',
        estado: 'Usado', bateria: 92, garantiaMeses: 6, precio: 1250000 },
  // Un Samsung nuevo con RAM
  sm: { id: 'sm', marca: 'Samsung', modelo: 'Galaxy A54', almacenamiento: '256GB', ram: '8GB',
        estado: 'Nuevo', bateria: 100, garantiaMeses: 12, precio: 980000 },
  // Sin RAM cargada
  mt: { id: 'mt', marca: 'Motorola', modelo: 'G52', almacenamiento: '128GB',
        estado: 'Usado', precio: 420000 },
  // En dólares: el precio pasa por la cotización y queda sucio
  us: { id: 'us', marca: 'Xiaomi', modelo: '13T Pro', almacenamiento: '512GB', ram: '12GB',
        estado: 'Nuevo', moneda: 'usd', precioUSD: 450, precio: 0 },
  // El error del Realme: dólares cargados en el campo de pesos
  rl: { id: 'rl', marca: 'Realme', modelo: 'P4 lite', almacenamiento: '128GB',
        estado: 'Nuevo', precio: 67 },
};

console.log('\n1) La plata');
ok(call('cartRedondear', 659250) === 659300, 'siempre para arriba a la centena', call('cartRedondear', 659250));
ok(call('cartRedondear', 659300) === 659300, 'y lo que ya es redondo no se mueve');
ok(call('cartPlata', 1250000) === '$1.250.000', 'pesos con punto de miles y sin centavos', call('cartPlata', 1250000));

// 1.250.000 × 1,26 = 1.575.000 ; / 3 = 525.000
ok(call('cartCuota', 1250000) === 525000, 'la cuota es precio × (1 + recargo) / 3', call('cartCuota', 1250000));
ok(call('cartRecargo') === 26, 'el recargo sale de Configuración, no de un número escrito acá', call('cartRecargo'));
// Y si mañana lo cambia en Configuración, el cartel cambia con él.
run('PRICES = { c3: 40 }');
ok(call('cartCuota', 1200000) === 560000, 'cambiando el porcentaje en la app, el cartel lo sigue', call('cartCuota', 1200000));
run('PRICES = { transfer: 0, c3: 26, c6: 25 }');
// 300.000 × 1,26 / 3 = 126.000 justo; uno que no da redondo sube a la centena
ok(call('cartCuota', 317000) === 133200, 'la cuota también se redondea para arriba', call('cartCuota', 317000));
ok(call('cartRecargo') === 26 && /c3/.test(leer('carteles.js')), 'y el porcentaje es el de las 3 cuotas de la app');

// Sin Configuración cargada cae al 26, no al 15 viejo.
run('PRICES = {}');
ok(call('cartRecargo') === 26, 'sin nada guardado, el respaldo es 26%', call('cartRecargo'));
ok(/c3: 26/.test(leer('app.js')), 'y el valor por defecto de la app también es 26');
run('PRICES = { transfer: 0, c3: 26, c6: 25 }');

console.log('\n2) Equipos que no pueden salir');
ok(call('cartPublicable', EQ.ip) === true, 'un equipo con precio sale');
ok(call('cartPublicable', EQ.rl) === false, 'uno a "$67" no: eran dólares en el campo de pesos', call('cartPrecioArs', EQ.rl));
ok(call('cartPublicable', { id: 'x', precio: 0 }) === false, 'sin precio tampoco');
ok(call('cartPrecioArs', EQ.us) === 450 * 1465, 'el cargado en dólares pasa por la cotización', call('cartPrecioArs', EQ.us));
// Sin cotización a mano no se adivina: queda afuera.
run('dolarBlue = 0');
ok(call('cartPublicable', EQ.us) === false, 'en dólares y sin cotización, afuera');
run('dolarBlue = 1465');

console.log('\n3) Lo que dice cada cartel');
let h = call('cartelHtml', EQ.ip);
ok(/iPhone 13/.test(h) && /Apple/.test(h), 'marca y modelo');
ok(/128 GB/.test(h), '"128GB" se escribe "128 GB"');
ok(/USADO/.test(h), 'el estado, en la pastilla');
ok(/Garantía 6 meses/.test(h), 'la garantía del equipo');
ok(/92%/.test(h), 'y la batería, que es un iPhone');
ok(/\$1\.250\.000/.test(h), 'el precio de efectivo');
ok(/\$525\.000/.test(h), 'y la cuota');
ok(!/1\.575\.000/.test(h), 'el total con tarjeta NO se muestra: solo la cuota');

h = call('cartelHtml', EQ.sm);
ok(!/%/.test(h), 'en un Samsung no va la batería aunque esté cargada', h.match(/\d+%/g));
ok(/NUEVO/.test(h) && /8 GB/.test(h), 'nuevo, y la RAM en su casilla');
ok(/Garantía 12 meses/.test(h), 'garantía de 12 meses');

// La batería es la pregunta del que compra un iPhone usado; en el resto es ruido.
ok(call('cartLlevaBateria', EQ.ip) === true, 'iPhone con dato: lleva');
ok(call('cartLlevaBateria', EQ.sm) === false, 'Samsung: no');
ok(call('cartLlevaBateria', { marca: 'Apple', modelo: 'iPhone 11' }) === false, 'iPhone sin el dato cargado: tampoco');
ok(call('cartLlevaBateria', { marca: 'iPhone', modelo: '12', bateria: 88 }) === true,
   'y "iPhone" cargado como marca cuenta igual: en el stock está de las dos formas');

console.log('\n4) Sin RAM, el almacenamiento ocupa todo');
// Una casilla vacía al lado hace que el cartel parezca a medio hacer.
h = call('cartelHtml', EQ.mt);
ok(/c-casillas--una/.test(h), 'queda una sola casilla a todo el ancho');
ok(!/RAM/.test(h), 'y no se nombra la RAM que no hay');
ok(/c-casillas--una\{grid-template-columns:1fr\}/.test(call('cartDocumento', [EQ.mt])),
   'el CSS de esa casilla existe de verdad');
ok(!/c-casillas--una/.test(call('cartelHtml', EQ.sm)), 'con RAM van las dos');

console.log('\n5) Garantía: manda la del equipo');
// La del equipo es la que sale en el comprobante que firma el cliente. Si el
// cartel dijera otra cosa, la vidriera estaría prometiendo distinto.
ok(call('cartGarantiaTxt', EQ.ip) === '6 meses', 'la que tiene cargada');
ok(call('cartGarantiaTxt', { estado: 'Nuevo' }) === '6 meses', 'sin cargar y nuevo: el texto de los ajustes');
ok(call('cartGarantiaTxt', { estado: 'Usado' }) === '30 días', 'sin cargar y usado: el otro texto');
ok(call('cartGarantiaTxt', { estado: 'Usado', garantiaMeses: 1 }) === '1 mes', 'un mes, en singular');
run("CART_CFG = { garNuevo: '1 año', garUsado: '15 días', color: '#0040FF' }");
ok(call('cartGarantiaTxt', { estado: 'Nuevo' }) === '1 año', 'cambiando el ajuste, cambia el cartel');
ok(call('cartGarantiaTxt', EQ.ip) === '6 meses', 'pero el que la tiene cargada no se toca');
run("CART_CFG = { garNuevo: '6 meses', garUsado: '30 días', color: '#0040FF' }");

console.log('\n6) Reacondicionado');
ok(call('cartEstadoTxt', { estado: 'Reacondicionado' }) === 'REACOND.',
   '"REACONDICIONADO" no entra en la pastilla', call('cartEstadoTxt', { estado: 'Reacondicionado' }));
ok(call('cartGarantiaTxt', { estado: 'Reacondicionado' }) === '30 días', 'y usa la garantía de usados');

console.log('\n7) Textos largos: baja la letra');
// El cartel es de cartón: no se puede scrollear.
ok(call('cartTamModelo', 'A54') === 36, 'un modelo corto, a tamaño lleno');
ok(call('cartTamModelo', 'Galaxy S23 Ultra 5G') < 36, 'uno largo, más chico', call('cartTamModelo', 'Galaxy S23 Ultra 5G'));
ok(call('cartTamModelo', 'Redmi Note 13 Pro Plus 5G') < call('cartTamModelo', 'Galaxy S23 Ultra 5G'),
   'y uno larguísimo, más chico todavía');
ok(call('cartTamPrecio', '$1.250.000') === 46, 'un precio normal, grande');
ok(call('cartTamPrecio', '$12.500.000') < 46, 'uno de 8 cifras, más chico', call('cartTamPrecio', '$12.500.000'));
ok(/font-size:19px/.test(call('cartelHtml', { id: 'z', marca: 'Xiaomi', modelo: 'Redmi Note 13 Pro Plus 5G', precio: 500000 })),
   'el tamaño va escrito en el cartel: el documento impreso no corre JavaScript');

// Esto se midió en el navegador con Baloo 2 cargada: con el tamaño de siempre,
// "iPhone 15 Pro Max" se parte en dos renglones, el cartel crece 25px y la
// franja negra de la tarjeta queda cortada abajo. Salió en TODOS los carteles
// y no se ve hasta que está impreso.
const ANCHO = 232, EM = 0.55;      // el ancho libre del cartel y lo que ocupa una letra
[['iPhone 15 Pro Max', 17], ['Galaxy S23 Ultra 5G', 19], ['Redmi Note 13 Pro Plus 5G', 25],
 ['Galaxy A54', 10], ['Moto G84 5G', 11], ['Edge 50 Fusion', 14], ['11', 2]].forEach(([m]) => {
  const tam = call('cartTamModelo', m);
  // Arriba del piso tiene que entrar en un renglón; en el piso se le permiten
  // dos, que es para lo que alcanza el lugar que queda.
  ok(m.length * EM * tam <= ANCHO * (tam > 19 ? 1 : 2),
     `"${m}" entra sin romper el cartel`, tam);
});
ok(call('cartTamModelo', 'Galaxy Z Fold 5 Edición Especial Larga') === 19,
   'y uno larguisimo no baja de 19: más chico no se lee de lejos');
// Se miran las reglas de verdad y no el archivo entero: `line-height:1.1`
// aparece en varios lados y así la prueba no se da cuenta si falta donde
// importa.
const css = call('cartDocumento', [EQ.ip]);
const regla = sel => { const i = css.indexOf(sel + '{'); return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1); };
ok(/line-height:1\.1/.test(regla('.cartel')),
   'el interlineado apretado está en el cartel: con el de fábrica no cierra', regla('.cartel'));
const rm = regla('.c-modelo');
ok(/-webkit-line-clamp:2/.test(rm) && /overflow:hidden/.test(rm),
   'y el modelo nunca pasa de dos renglones (con el corte puesto)', rm);

console.log('\n8) La hoja: 8 por A4 apaisada');
const diez = Array.from({ length: 10 }, (_, i) => ({ id: 'e' + i, marca: 'M', modelo: 'X' + i, precio: 500000 }));
ok(call('cartHojas', diez).length === 2, '10 equipos son 2 hojas', call('cartHojas', diez).length);
ok(call('cartHojas', diez)[0].length === 8 && call('cartHojas', diez)[1].length === 2, '8 y 2');
ok(call('cartHojas', []).length === 0, 'sin equipos no hay hoja');

const doc = call('cartDocumento', diez);
ok((doc.match(/class="hoja"/g) || []).length === 2, 'el documento tiene las 2 hojas');
ok((doc.match(/class="cartel"/g) || []).length === 10, 'y los 10 carteles');
// Los lugares que sobran quedan pelados: no se corta aire.
ok((doc.match(/class="celda celda--vacia"/g) || []).length === 6,
   'los 6 lugares que sobran, vacíos', (doc.match(/class="celda celda--vacia"/g) || []).length);
ok(/\.celda--vacia\{border:0\}/.test(doc), 'y sin línea de corte');
ok(/@page\{size:A4 landscape;margin:0\}/.test(doc), 'A4 apaisada sin márgenes');
ok(/repeat\(4,1fr\)/.test(doc) && /repeat\(2,1fr\)/.test(doc), '4 columnas × 2 filas');
ok(/print-color-adjust:exact/.test(doc) && /-webkit-print-color-adjust:exact/.test(doc),
   'los fondos de color salen impresos');
ok(new RegExp('family=' + call('cartFuente').web.split(':')[0]).test(doc),
   'la tipografía es la elegida en los ajustes', doc.match(/family=[^&"]*/));
ok(/1px dashed #9A9AA8/.test(doc), 'las líneas de corte');
ok(/transform:scale\(\.955\)/.test(doc), 'el cartel se achica para que entre en impresoras sin borde');
ok(/width:280px;height:397px/.test(doc), 'y está diseñado a 280×397 (A7)');

console.log('\n8b) La tipografía');
// Es una sola para los dos tipos de cartel y se elige en los ajustes. Lo que
// no se puede cambiar sin lo otro es el ANCHO de letra: de ahí sale el tamaño
// automático, y si no acompaña, los nombres largos se salen del cartel.
ok(Object.keys(run('CART_FUENTES')).length >= 3, 'hay varias para elegir', Object.keys(run('CART_FUENTES')));
Object.keys(run('CART_FUENTES')).forEach(k => {
  const f = run('CART_FUENTES')[k];
  ok(f.em > 0.3 && f.em < 0.8, `${k}: tiene medido el ancho de letra`, f.em);
  ok(f.emNum > 0.3 && f.emNum < 0.8, `${k}: y el de las cifras`, f.emNum);
  ok(f.peso >= 700, `${k}: y cuánto negrita tiene de verdad`, f.peso);
});
// Oswald es angosta: con la misma caja tiene que dejar el modelo más grande.
const _f = run('CART_CFG.fuente');
run("CART_CFG = { ...CART_CFG, fuente: 'archivo' }");
const anchoArchivo = call('cartTamModelo', 'Galaxy S23 Ultra 5G');
run("CART_CFG = { ...CART_CFG, fuente: 'oswald' }");
const anchoOswald = call('cartTamModelo', 'Galaxy S23 Ultra 5G');
ok(anchoOswald > anchoArchivo, 'con una letra más angosta, el modelo sale más grande',
   [anchoArchivo, anchoOswald]);
// Y el peso que se pide es el que la fuente tiene: pedirle 800 a Oswald la
// deja deforme, porque el navegador la engorda a mano.
const docOs = call('cartDocumento', [EQ.ip]);
ok(/font-weight:700/.test(docOs) && !/font-weight:800/.test(docOs),
   'a Oswald se le pide 700, que es lo que tiene', (docOs.match(/font-weight:\d+/g) || []).slice(0, 5));
ok(/family=Oswald/.test(docOs), 'y el documento la pide a Google Fonts');
run(`CART_CFG = { ...CART_CFG, fuente: '${_f}' }`);

console.log('\n9) El color del cartel');
ok(/#0040FF/.test(doc), 'por defecto, el azul');
run("CART_CFG = { ...CART_CFG, color: '#E5006E' }");
const rosa = call('cartDocumento', [EQ.ip]);
ok(/#E5006E/.test(rosa) && !/#0040FF/.test(rosa), 'elegido otro, el cartel entero cambia');
run("CART_CFG = { ...CART_CFG, color: '#0040FF' }");

console.log('\n10) Elegir, y en el orden que se tilda');
ctx.__stock = [EQ.ip, EQ.sm, EQ.mt, EQ.rl,
               { id: 'vd', marca: 'LG', modelo: 'K40', precio: 300000, vendido: true },
               { id: 'rs', marca: 'Nokia', modelo: 'G21', precio: 300000, reservado: true }];
run('STOCK = __stock');
call('cartAbrir');
ok(run('_cartBase.length') === 3, 'vendidos, reservados y el del precio raro quedan afuera', run('_cartBase.map(p => p.id)'));
ok(run('_cartFuera.length') === 1, 'y avisa que uno quedó afuera por el precio');
ok(/queda afuera/.test(els['carteles-nota'].textContent), 'lo dice en el cuadro', els['carteles-nota'].textContent);
ok(run('_cartSel.length') === 0, 'abriendo la lista entera no arranca ninguno tildado');

call('cartTocar', 'mt');
call('cartTocar', 'ip');
ok(run('JSON.stringify(_cartSel)') === '["mt","ip"]', 'el orden es el de los toques, no el de la lista', run('JSON.stringify(_cartSel)'));
let prev = els['carteles-preview'].srcdoc;
ok(prev.indexOf('G52') < prev.indexOf('iPhone 13'), 'y así salen en la hoja');
ok(/2 elegidos · 1 hoja/.test(els['carteles-cuenta'].textContent), 'dice cuántos y cuántas hojas', els['carteles-cuenta'].textContent);
call('cartTocar', 'mt');
ok(run('JSON.stringify(_cartSel)') === '["ip"]', 'tocando de nuevo se destilda');

// Viniendo del modo "seleccionar varios" ya están todos elegidos.
call('cartAbrir', [EQ.ip, EQ.sm]);
ok(run('_cartSel.length') === 2, 'eligiendo a mano desde el stock, arrancan tildados');

console.log('\n11) El filtro Nuevos / Usados');
call('cartAbrir');
run("document.getElementById('cart-f-estado').value = 'Nuevo'");
call('cartFiltrar');
ok(/Galaxy A54/.test(els['carteles-lista'].innerHTML) && !/iPhone/.test(els['carteles-lista'].innerHTML),
   'solo nuevos');
run("document.getElementById('cart-f-estado').value = 'Usado'");
call('cartFiltrar');
ok(/iPhone/.test(els['carteles-lista'].innerHTML) && !/Galaxy A54/.test(els['carteles-lista'].innerHTML),
   'solo usados');
run("document.getElementById('cart-f-estado').value = ''");
run("document.getElementById('cart-f-buscar').value = 'motorola'");
call('cartFiltrar');
ok(/G52/.test(els['carteles-lista'].innerHTML) && !/iPhone/.test(els['carteles-lista'].innerHTML), 'y el buscador');
run("document.getElementById('cart-f-buscar').value = ''");

console.log('\n12) Retoques: solo para esta impresión');
// Para abreviar un modelo largo o poner el precio del día sin tocar el stock.
call('cartAbrir');
call('cartTocar', 'ip');
run("_cartRetoques = { ip: { modelo: 'iPhone 13 ¡OFERTA!', precio: 1199000 } }");
const conRetoque = call('cartPintado', EQ.ip);
ok(conRetoque.modelo === 'iPhone 13 ¡OFERTA!', 'el cartel usa el texto retocado');
ok(conRetoque.precio === 1199000, 'y el precio retocado');
ok(EQ.ip.modelo === 'iPhone 13' && EQ.ip.precio === 1250000, 'el equipo del stock queda intacto', [EQ.ip.modelo, EQ.ip.precio]);
ok(ESCRITO.filter(w => w.col === 'stock').length === 0, 'y no se escribió nada en el stock', ESCRITO);
// La cuota del cartel se recalcula con el precio retocado, no con el viejo.
ok(/\$503\.600/.test(call('cartelHtml', conRetoque)), 'la cuota se recalcula sobre el precio nuevo',
   call('cartelHtml', conRetoque).match(/\$[\d.]+/g));
call('cartBorrarRetoque', 'ip');
ok(run('JSON.stringify(_cartRetoques)') === '{}', 'y se puede volver a como está en el stock');

console.log('\n13) Imprimir');
IMPRESO.length = 0;
call('cartAbrir');
call('cartImprimir');
ok(IMPRESO.length === 0, 'sin nada tildado no imprime');
call('cartTocar', 'ip');
call('cartTocar', 'sm');
call('cartImprimir');
ok(IMPRESO.length === 1, 'con equipos tildados, sale una vez');
ok((IMPRESO[0].match(/class="cartel"/g) || []).length === 2, 'con los dos carteles');
// La vista previa es el MISMO documento: no hay forma de que se vea una cosa
// y salga otra.
ok(els['carteles-preview'].srcdoc === IMPRESO[0], 'la vista previa es exactamente lo que se imprime');

console.log('\n14) Los ajustes se guardan');
ESCRITO.length = 0;
run("document.getElementById('cart-gar-nuevo').value = '1 año'");
run("document.getElementById('cart-gar-usado').value = '90 días'");
call('cartGuardarGarantias');
ok(run('CART_CFG.garNuevo') === '1 año' && run('CART_CFG.garUsado') === '90 días', 'quedan en memoria');
ok(!!ctx.localStorage._d['cartelesCfg'], 'y en el aparato, para que abra al toque');
const w = ESCRITO.find(x => x.col === 'config' && x.doc === 'appSettings');
ok(!!w && !!w.data.carteles, 'y en la config de la app: el celular ve lo mismo que el mostrador', ESCRITO);
ok(!!w && w.o && w.o.merge === true, 'con merge, para no pisar el resto de la configuración');
// Y al revés: lo que baja de Firestore se aplica.
call('cartCfgDesdeFirestore', { garNuevo: '8 meses', color: '#008C3A' });
ok(run('CART_CFG.garNuevo') === '8 meses' && run('CART_CFG.color') === '#008C3A', 'lo que baja de Firestore se usa');
ok(/cartCfgDesdeFirestore/.test(leer('app.js')), 'y app.js la llama al sincronizar');

console.log('\n15) Enganchado en la app');
const idx = leer('index.html');
ok(/carteles\.js/.test(idx), 'el script se carga en index.html');
ok(/id="carteles-modal"/.test(idx), 'y el cuadro está en la página');
ok(/cartAbrir\(\)/.test(leer('app.js')), 'se entra desde el menú de Stock');
ok(/batchCarteles\(\)/.test(idx) && /function batchCarteles/.test(leer('stock-extras.js')),
   'y desde el modo "seleccionar varios"');
// CUPO: los carteles no leen Firestore, salen del stock que ya está en memoria.
ok(!/collection\('stock'\)/.test(leer('carteles.js')), 'no lee ni escribe el stock: usa STOCK, ya cargado');
ok(!/onSnapshot/.test(leer('carteles.js')), 'y no engancha ningún listener nuevo');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
