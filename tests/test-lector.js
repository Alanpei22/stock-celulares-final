// El lector de mano: por qué había que escanear dos veces.
//
// Alan: "a veces tengo que escanear dos veces para que reconozca". No era el
// lector. Eran dos cosas del código, y las dos pasaban SOLO la primera vez:
//
//  1) Las listas (accesorios, repuestos, equipos) se piden recién cuando
//     hacen falta, para no gastar cupo de Firebase. Tardan lo que tarde
//     Firestore. Abrís la venta, escaneás en el acto y el código se busca
//     contra listas TODAVÍA VACÍAS: no encuentra nada. A la segunda pasada ya
//     llegaron y anda.
//
//  2) `_movDesdeCodigo` hacía `return` pelado cuando SÍ encontraba algo, o
//     sea devolvía undefined. Quien lo llamaba lo leía como "no encontré
//     nada" y seguía de largo con la búsqueda aproximada — justo lo que ese
//     código decía en su comentario que venía a evitar.
//
// Y de yapa: lo que no se encontraba entraba como "producto libre" con el
// código de barras de nombre. Un artículo llamado "7798123456789" en la venta
// y en el comprobante.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const els = {};
const mk = id => els[id] = { id, value: '', textContent: '', innerHTML: '', disabled: false, readOnly: false,
  dataset: {}, style: {}, options: [{}], remove() {}, appendChild() {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  addEventListener() {}, focus() {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [] };
['mov-fi-monto', 'mov-fi-desc', 'mov-categorias', 'mov-hidden-cat', 'mov-hidden-metodo', 'mov-cat-wrap',
 'mov-cat-auto', 'mov-save-btn', 'mov-resumen-txt', 'mov-resumen-total', 'mov-btn-ingreso', 'mov-btn-egreso',
 'mov-desc-suggest', 'mov-sale-item-info', 'mov-quick-amounts', 'mov-monto-hint', 'mov-step-monto',
 'mov-cat-lbl', 'mov-metodo-lbl', 'mov-hidden-metodo2'].forEach(mk);

const TOASTS = [];
const ctx = {
  console, Date, Math, JSON, Promise, Number, String, Set, Map, Array, Object,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  document: {
    getElementById: id => els[id] || mk(id),
    querySelectorAll: () => [], querySelector: () => null, createElement: () => mk('tmp'), addEventListener() {},
    body: { style: {}, classList: { add() {}, remove() {}, contains: () => false } },
    documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { search: '' } },
  navigator: { userAgent: 'node', onLine: true },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  URLSearchParams, location: { search: '' },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({}) } } },
  _todayAR: () => '2026-10-28',
  requireAuth: () => Promise.resolve(null), showApp: () => {},
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext('var fmtNum = n => String(n); var fmtMoney = n => "$" + n; var safeListener = (p, c) => c();', ctx);
// utils.js primero: de ahí sale la comparación de códigos que usan las dos.
vm.runInContext(fs.readFileSync(DIR + 'utils.js', 'utf8'), ctx, { filename: 'utils.js' });
vm.runInContext(fs.readFileSync(DIR + 'inventario.js', 'utf8'), ctx, { filename: 'inventario.js' });
vm.runInContext(fs.readFileSync(DIR + 'caja.js', 'utf8'), ctx, { filename: 'caja.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
run(`
  db = { collection: () => { const q = { doc: () => ({ set: async () => {}, update: async () => {} }),
           where: () => q, orderBy: () => q, limit: () => q,
           get: async () => ({ empty: true, docs: [] }),
           add: async () => ({ id: 'x' }),
           // Los listeners no contestan nunca a propósito: lo que se prueba es
           // justo lo que pasa MIENTRAS las listas no llegaron.
           onSnapshot: () => () => {} }; return q; } };
  toast = (m, t) => __TOAST(m, t);
  esc = s => String(s == null ? '' : s); fmt = n => '$' + Number(n || 0).toLocaleString('es-AR');
  searchMatch = () => false; normalizeText = s => String(s || '');
  getCurrentDolar = () => 1500; ensureDolar = () => {};
  renderMovimientos = () => {}; renderStats = () => {}; renderInventario = () => {};
  renderCatBtns = () => {}; _renderCart = () => {}; _hideMovSuggestions = () => {};
  _cart = []; setMovTipo('ingreso');
`);
ctx.__TOAST = (m, t) => TOASTS.push([t, m]);
const cart = () => get('_cart');

const VIDRIO = { id: 'p1', codigo: '7790895000997', nombre: 'Vidrio templado iPhone 13',
                 categoria: 'Vidrio', stock: 8, precioVenta: 8000, precioCosto: 3000, activo: true };
ctx.__PRODS = [VIDRIO];

(async () => {

console.log('\n1) Escanear antes de que lleguen las listas');
// Esto es, textual, lo que pasa en el mostrador: abrís la venta y escaneás.
run('_cart = []; PRODUCTOS = []; PRODUCTOS_MAP = new Map(); CAJA_REPUESTOS = []; CAJA_STOCK = []; CAJA_REPAIRS = [];');
run('_datosVentaListos = null; _snapEspera.productos = null; _snapEspera.repuestos = null;');
run('_asegurarDatosVenta()');
TOASTS.length = 0;
els['mov-fi-desc'].value = '7790895000997';
const esperando = get("_movEnterBuscador('7790895000997')");
ok(cart().length === 0, 'con las listas vacías todavía no hay nada en el carrito');
ok(!TOASTS.some(t => /no está/.test(t[1])), 'y NO dice que el código no existe: todavía no se sabe', TOASTS);

// Llega el snapshot de Firestore, como en la vida real.
run("PRODUCTOS = __PRODS; PRODUCTOS.forEach(p => PRODUCTOS_MAP.set(String(p.codigo), p)); _snapLlego('productos'); _snapLlego('repuestos');");
await esperando;
ok(cart().length === 1 && cart()[0].id === 'p1',
   'al llegar la lista entra solo, sin escanear de nuevo', cart());
ok(cart()[0].precio === 8000, 'con su precio', cart()[0]);
ok(els['mov-fi-desc'].value === '', 'y el buscador queda limpio para el que sigue');

console.log('\n2) Con las listas cargadas, entra en el acto');
run('_cart = []');
await get("_movEnterBuscador('7790895000997')");
ok(cart().length === 1, 'un escaneo, un artículo', cart());
// Y UNA sola unidad: con el `return` pelado se agregaba, se creía que no se
// había encontrado nada, se esperaba y se agregaba de nuevo — el mismo
// artículo con cantidad 2 sin que nadie lo tocara.
ok(cart()[0].qty === 1, 'y una sola unidad, no dos', cart()[0]);

console.log('\n3) Un código que no existe NO se inventa como producto');
// Antes entraba como "producto libre" con el código de nombre, y así salía
// impreso en el comprobante.
run('_cart = []');
TOASTS.length = 0;
els['mov-fi-desc'].value = '7798123456789';
await get("_movEnterBuscador('7798123456789')");
ok(cart().length === 0, 'no entra nada al carrito', cart());
ok(TOASTS.some(t => /no está en el inventario/.test(t[1])), 'y avisa que ese código no está', TOASTS);

console.log('\n4) Lo escrito a mano sigue siendo un artículo suelto');
// Un cable que trajo el cliente se sigue cobrando escribiéndolo.
run('_cart = []');
els['mov-fi-desc'].value = 'Cable viejo';
await get("_movEnterBuscador('Cable viejo')");
ok(cart().length === 1 && cart()[0].source === 'libre', 'lo tipeado entra como suelto', cart());

console.log('\n5) Qué parece un código y qué no');
// De esto depende lo de arriba: si no parece código, no hay que esperar
// ninguna lista ni negarse a crear el artículo.
[['7790895000997', true, 'un código de fábrica'],
 ['12345678', true, 'uno corto de fábrica'],
 ['TP00041', true, 'uno de los nuestros'],
 ['tp00041', true, 'y en minúscula igual'],
 ['Cable viejo', false, 'un nombre con espacios no'],
 ['Funda', false, 'una palabra sola tampoco'],
 ['1234', false, 'cuatro cifras es un precio, no un código'],
 ['', false, 'y vacío menos']].forEach(([txt, esp, lbl]) => {
  ctx.__t = txt;
  ok(get('_pareceCodigo(__t)') === esp, lbl, [txt, get('_pareceCodigo(__t)')]);
});

console.log('\n6) El que abre otra ventana limpia el buscador');
// El IMEI de un equipo abre la venta de equipo; la boleta abre el cobro de la
// reparación. Si el código quedaba escrito, al Enter siguiente se colaba como
// "producto libre".
run(`CAJA_STOCK = [{ id: 'e1', imei: '356938035643809', codigo: 'TP00099', marca: 'Samsung', modelo: 'A54', precio: 350000, vendido: false }];
     _addEquipoAlCarrito = () => { __ABRIO = true; };`);
ctx.__ABRIO = false;
els['mov-fi-desc'].value = '356938035643809';
ok(get("_movDesdeCodigo('356938035643809')") === true, 'el IMEI se reconoce');
ok(els['mov-fi-desc'].value === '', 'y el buscador queda limpio', els['mov-fi-desc'].value);
// Lo mismo por el código corto de la etiqueta, que es el otro camino.
els['mov-fi-desc'].value = 'TP00099';
ok(get("_movDesdeCodigo('TP00099')") === true, 'y el código de la etiqueta también');
ok(els['mov-fi-desc'].value === '', 'con el buscador igual de limpio', els['mov-fi-desc'].value);

console.log('\n6b) Los códigos que no leían nunca');
// Alan: "tengo dos códigos que no me leen el producto". Siempre los mismos,
// no "a veces": eso ya no es la carrera, es la comparación. Era `===` pelado.
ok(get("tpCodigosIguales('7790895000997', '07790895000997')") === true,
   'el cero de adelante: UPC de 12 y EAN de 13 son la misma etiqueta');
ok(get("tpCodigosIguales('0000123', '123')") === true, 'y varios ceros también');
ok(get("tpCodigosIguales(' 7790895000997 ', '7790895000997')") === true, 'un espacio de más al cargarlo');
ok(get("tpCodigosIguales('7790-895-000997', '7790895000997')") === true, 'guiones del Excel');
ok(get("tpCodigosIguales('tp00041', 'TP00041')") === true, 'y la minúscula en los nuestros');
// Lo que NO puede pasar: que un código encuentre al de otro producto.
ok(get("tpCodigosIguales('7790895000997', '7790895000998')") === false, 'una cifra distinta es otro producto');
ok(get("tpCodigosIguales('TP007', 'TP7')") === false, 'y a los nuestros no se les sacan ceros: TP007 no es TP7');
// Los ceros se sacan SOLO entre números: en algo con letras, el cero es
// parte del código y sacárselo lo convertiría en otro.
ok(get("tpCodigosIguales('007TP', '7TP')") === false, 'a un código con letras no se le tocan los ceros');
ok(get("tpCodigosIguales('', '123')") === false, 'vacío no encuentra nada');

// El caso completo, como en el mostrador: el producto cargado SIN el cero y
// el lector que lo manda CON el cero.
run("_cart = []; PRODUCTOS = __PRODS; PRODUCTOS_MAP = new Map(); PRODUCTOS.forEach(p => PRODUCTOS_MAP.set(String(p.codigo), p));");
TOASTS.length = 0;
ok(get("_movDesdeCodigo('07790895000997')") === true, 'escaneado con el cero adelante, lo encuentra igual');
ok(cart().length === 1 && cart()[0].id === 'p1', 'y entra el producto correcto', cart());

// El código corto (TP…): print.js lo imprime cuando el de fábrica es muy
// largo para que entre legible en la etiqueta, así que es el que se escanea.
run("_cart = []; PRODUCTOS = [{ id: 'p5', codigo: '7790895000997', codigoCorto: 'TP00041', nombre: 'Funda', precioVenta: 5000, stock: 3, activo: true }];");
ok(get("_movDesdeCodigo('TP00041')") === true, 'también lo encuentra por el código corto de la etiqueta');
ok(cart().length === 1 && cart()[0].id === 'p5', 'y es el producto correcto', cart());

// Un artículo desactivado no se vende, pero decir "no existe" lleva a
// cargarlo de nuevo y termina duplicado en el inventario.
run("_cart = []; PRODUCTOS = [{ id: 'p9', codigo: '7799999999999', nombre: 'Funda vieja', activo: false }];");
TOASTS.length = 0;
ok(get("_movDesdeCodigo('7799999999999')") === false, 'un artículo desactivado no entra a la venta');
ok(TOASTS.some(t => /desactivado/.test(t[1])), 'pero avisa que está desactivado, no que no existe', TOASTS);
ok(TOASTS.some(t => /Funda vieja/.test(t[1])), 'y dice cuál es', TOASTS);

// Y cuando de verdad no está, el cartel dice el código leído: así se ve de un
// vistazo si lo que salió del lector es lo mismo que está cargado.
run("_cart = []; PRODUCTOS = [];");
TOASTS.length = 0;
get("_movDesdeCodigo('1234567890123')");
ok(TOASTS.some(t => /1234567890123/.test(t[1])), 'el cartel muestra el código que leyó', TOASTS);

console.log('\n7) La espera no se cuelga para siempre');
// Si Firestore no contesta, el mostrador no puede quedar esperando: a los 6
// segundos sigue igual y dice lo que sepa.
const caja = fs.readFileSync(DIR + 'caja.js', 'utf8');
const prom = caja.slice(caja.indexOf('function _asegurarDatosVenta'), caja.indexOf('function _asegurarDatosVenta') + 600);
ok(/Promise\.race/.test(prom) && /6000/.test(prom), 'hay un corte por tiempo', prom.slice(0, 300));
// Y la promesa se arma UNA sola vez: si no, cada escaneo abriría otra espera.
ok(/if \(!_datosVentaListos\)/.test(prom), 'y la espera se arma una sola vez');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})().catch(e => { console.error('Error:', e); process.exit(1); });
