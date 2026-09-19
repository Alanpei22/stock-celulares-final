// Cobrar escaneando.
//
// Cada venta eran cuatro pasos: buscar el producto tipeando, elegir categoría,
// poner el monto y el método. Escaneando, los tres primeros salen solos.
//
// Lee las cuatro cosas que hay arriba del mostrador: el código de un accesorio,
// el de un repuesto, el IMEI de un equipo del stock y el QR (o el número) de
// una boleta de reparación.
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
 'mov-desc-suggest', 'mov-sale-item-info', 'mov-cart', 'mov-quick-amounts', 'mov-monto-hint',
 'mov-step-monto', 'mov-scan-btn', 'mov-cat-lbl', 'mov-metodo-lbl', 'mov-hidden-metodo2'].forEach(mk);

const TOASTS = [];
let ESCANEO = null, CERRADO = 0, REPAIR_MODAL = null;

const ctx = {
  console, Date, Math, JSON, Promise, Number, String, Set, Map, Array, Object,
  setTimeout: () => 0, clearTimeout, setInterval: () => 0, clearInterval: () => {},
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
  _todayAR: () => '2026-09-19',
  requireAuth: () => Promise.resolve(null), showApp: () => {},
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext('var fmtNum = n => String(n); var fmtMoney = n => "$" + n; var safeListener = (p, c) => c();', ctx);
vm.runInContext(fs.readFileSync(DIR + 'inventario.js', 'utf8'), ctx, { filename: 'inventario.js' });
vm.runInContext(fs.readFileSync(DIR + 'caja.js', 'utf8'), ctx, { filename: 'caja.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
run(`
  db = { collection: () => ({ doc: () => ({ set: async () => {}, update: async () => {} }), where: () => ({ get: async () => ({ empty: true, docs: [] }) }), add: async () => ({ id: 'x' }) }) };
  toast = (m, t) => __TOAST(m, t);
  esc = s => String(s == null ? '' : s); fmt = n => '$' + Number(n || 0).toLocaleString('es-AR');
  searchMatch = () => false; normalizeText = s => String(s || '');
  getCurrentDolar = () => 1500; ensureDolar = () => {};
  renderMovimientos = () => {}; renderStats = () => {}; renderInventario = () => {};
  renderCatBtns = () => {}; _renderCart = () => {}; _hideMovSuggestions = () => {};
  abrirEscaner = (cb, opts) => { __ESC(cb, opts); return Promise.resolve(true); };
  cerrarEscaner = () => __CERRAR();
  _openRepairLinkModal = r => __REPMODAL(r);
`);
ctx.__TOAST = (m, t) => TOASTS.push([t, m]);
ctx.__ESC = (cb, opts) => { ESCANEO = { cb, opts }; };
ctx.__CERRAR = () => { CERRADO++; };
ctx.__REPMODAL = r => { REPAIR_MODAL = r; };

// Lo que hay cargado en el local
run(`
  PRODUCTOS = [{ id: 'p1', codigo: '7790895000997', nombre: 'Vidrio templado iPhone 13', categoria: 'Vidrio templado / Hidrogel', stock: 8, precioVenta: 8000, precioCosto: 3000, activo: true }];
  CAJA_REPUESTOS = [{ id: 'r1', codigo: 'RP-001', nombre: 'Módulo', marca: 'Samsung', modelo: 'A54', cantidad: 2, precioVenta: 90000, precioCostoUSD: 40 }];
  CAJA_STOCK = [{ id: 'e1', imei: '356938035643809', marca: 'Samsung', modelo: 'Galaxy A54', almacenamiento: '128GB', estado: 'Usado', precio: 350000, costo: 250000, vendido: false },
                { id: 'e2', imei: '111111111111111', marca: 'Apple', modelo: 'iPhone 11', precio: 400000, vendido: true }];
  CAJA_REPAIRS = [{ id: 'x1', nOrden: 7123, tokenSeguimiento: 'abc123', nombre: 'Juan', marca: 'Motorola', modelo: 'G54', monto: 60000, sena: 20000, estado: 'listo' },
                  { id: 'x2', nOrden: 7000, tokenSeguimiento: 'vieja1', monto: 50000, cobrado: true, estado: 'entregado' }];
  _cart = []; setMovTipo('ingreso');
`);
const cart = () => get('_cart');
const cat = () => els['mov-hidden-cat'].value;

console.log('\n1) El lector se abre en modo seguido');
run('movEscanear()');
ok(!!ESCANEO, 'abre la cámara');
ok(ESCANEO.opts.continuo === true, 'sin cerrarse en cada producto (una venta puede tener varios)', ESCANEO.opts);

console.log('\n2) Accesorio: entra con precio y categoría');
run(`_cart = []; selectCat('');`);
ESCANEO.cb('7790895000997');
ok(cart().length === 1, 'entra al carrito', cart());
ok(cart()[0].nombre === 'Vidrio templado iPhone 13', 'el producto correcto', cart()[0].nombre);
ok(cart()[0].precio === 8000, 'con su precio de venta', cart()[0].precio);
ok(cat() === 'Venta producto', 'y la categoría sale sola', cat());
ok(String(els['mov-fi-monto'].value) === '8000', 'el monto se calcula', els['mov-fi-monto'].value);

console.log('\n3) Dos productos seguidos suman');
ESCANEO.cb('7790895000997');
ok(cart()[0].qty === 2, 'el mismo código sube la cantidad', cart()[0].qty);
ok(String(els['mov-fi-monto'].value) === '16000', 'y el monto acompaña', els['mov-fi-monto'].value);

console.log('\n4) Repuesto por su código');
run('_cart = [];');
ESCANEO.cb('RP-001');
ok(cart().length === 1 && /Módulo/.test(cart()[0].nombre), 'entra el repuesto', cart()[0]);
ok(/Samsung/.test(cart()[0].nombre) && /A54/.test(cart()[0].nombre),
   'con marca y modelo, para que en el ticket se sepa de qué equipo es', cart()[0].nombre);
ok(cart()[0].costoARS === 60000, 'y el costo convertido del dólar (40 × 1500)', cart()[0].costoARS);

console.log('\n5) Equipo del stock por el IMEI');
run('_cart = [];');
ESCANEO.cb('356938035643809');
ok(cart().length === 1 && cart()[0].source === 'equipo', 'entra el equipo', cart()[0]);
ok(cart()[0].precio === 350000, 'con su precio', cart()[0].precio);
// La etiqueta que imprime la app trae el IMEI en QR: tiene que servir igual
run('_cart = [];');
ESCANEO.cb('35693803564380 9');
ok(cart().length === 1, 'aunque el código venga con espacios', cart().length);

console.log('\n6) Un equipo ya vendido no se vuelve a vender');
run('_cart = []; TOASTS = [];');
TOASTS.length = 0;
ESCANEO.cb('111111111111111');
ok(cart().length === 0, 'no entra', cart());
ok(TOASTS.some(t => /no está en el inventario|no está/i.test(t[1])), 'y avisa', TOASTS);

console.log('\n7) La boleta de una reparación');
// El QR de la boleta lleva el token de seguimiento.
run('_cart = [];'); REPAIR_MODAL = null; CERRADO = 0;
ESCANEO.cb('https://stock-celulares-final.vercel.app/seguimiento.html?t=abc123');
ok(REPAIR_MODAL && REPAIR_MODAL.nOrden === 7123, 'abre el cobro de esa orden', REPAIR_MODAL && REPAIR_MODAL.nOrden);
ok(CERRADO === 1, 'y cierra la cámara, que ya no hace falta');
REPAIR_MODAL = null;
ESCANEO.cb('7123');
ok(REPAIR_MODAL && REPAIR_MODAL.nOrden === 7123, 'el número de orden suelto también sirve', REPAIR_MODAL);
REPAIR_MODAL = null; TOASTS.length = 0;
ESCANEO.cb('7000');
ok(REPAIR_MODAL === null, 'una orden ya cobrada y entregada no se cobra de nuevo');
ok(TOASTS.some(t => /ya está cobrada/.test(t[1])), 'y lo dice', TOASTS);

console.log('\n8) Un código que no es de nadie');
run('_cart = [];'); TOASTS.length = 0;
ESCANEO.cb('9999999999999');
ok(cart().length === 0, 'no inventa un producto', cart());
ok(TOASTS.some(t => /no está en el inventario/.test(t[1])), 'y lo dice', TOASTS);

console.log('\n9) Con categoría, la descripción deja de ser obligatoria');
// Antes había que escribir "Venta producto" a mano en cada venta suelta.
const js = fs.readFileSync(DIR + 'caja.js', 'utf8');
ok(/const descOk\s*=\s*descripcion\.length > 0 \|\| categoria\.length > 0/.test(js),
   'la validación acepta que salga de la categoría');
ok(/const descFinal = descripcion \|\| categoria;/.test(js) && /descripcion: descFinal/.test(js),
   'y el movimiento se guarda con ese nombre');

console.log('\n10) El botón está en el formulario');
const html = fs.readFileSync(DIR + 'caja.html', 'utf8');
ok(/onclick="movEscanear\(\)"/.test(html), 'el 📷 al lado del buscador');
ok(html.indexOf('mov-scan-btn') < html.indexOf('mov-desc-suggest'), 'pegado al campo de búsqueda');
ok(/id="esc-video"/.test(html), 'y el lector ya estaba en la página');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
