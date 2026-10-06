// Sumar un artículo a una venta que ya está pasando.
//
// Vendés un celular y el cliente se lleva la funda. Entregás una reparación y
// se lleva un vidrio. Antes eso eran dos operaciones: la del formulario donde
// estabas, y después otra en la caja, con el cliente esperando — y si te
// olvidabas de la segunda, el accesorio salía del local sin registrarse y el
// stock quedaba mintiendo.
//
// El bloque es uno solo (venta-articulos.js) y se monta en los dos lados. Acá
// se prueba el bloque, y después cada formulario con el bloque adentro.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// ── Un DOM de mentira que alcanza para el bloque ────────────
function hacerDom(ids) {
  const els = {};
  const el = id => els[id] = {
    id, value: '', textContent: '', innerHTML: '', checked: false, style: {}, dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                 toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    focus() {}, blur() {}, select() {}, setAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, appendChild() {},
  };
  ids.forEach(el);
  return { els, el };
}
const BUSCAR = (hay, q) => {
  const h = (Array.isArray(hay) ? hay.join(' ') : String(hay || '')).toLowerCase();
  return String(q || '').toLowerCase().split(/\s+/).filter(Boolean).every(t => h.includes(t));
};
const PROD = [
  { id: 'p1', nombre: 'Funda silicona iPhone 15', categoria: 'Funda / Cover', codigo: 'TP00041',
    precioVenta: 8000, precioCosto: 3000, stock: 4, activo: true },
  { id: 'p2', nombre: 'Vidrio templado iPhone 15', categoria: 'Vidrio', codigo: 'TP00042',
    precioVenta: 4500, precioCosto: 1500, stock: 10, activo: true },
  { id: 'p3', nombre: 'Cargador viejo', categoria: 'Cargador', codigo: 'TP00043',
    precioVenta: 2000, precioCosto: 500, stock: 2, activo: false },
];

(async () => {

// ══════════════════════════════════════════════════════════
console.log('\n1) El bloque de artículos');
// ══════════════════════════════════════════════════════════
const d1 = hacerDom(['cobro-articulos', 'va-buscar', 'va-sug', 'va-lineas']);
const c1 = {
  console, setTimeout: f => f(), clearTimeout,
  document: { getElementById: id => d1.els[id] || null, querySelector: () => null,
              querySelectorAll: () => [], createElement: () => d1.el('tmp'), addEventListener() {},
              body: { appendChild() {}, style: {} } },
  esc: s => String(s == null ? '' : s), searchMatch: BUSCAR,
  db: null, PRODUCTOS: PROD,
};
c1.globalThis = c1; c1.window = c1;
vm.createContext(c1);
vm.runInContext(leer('venta-articulos.js'), c1, { filename: 'venta-articulos.js' });
const r1 = e => vm.runInContext(e, c1);

r1("vaMontar('cobro-articulos')");
ok(r1('VA_ITEMS.length') === 0, 'arranca vacío');

// Buscar y agregar.
d1.els['va-buscar'].value = 'funda';
r1('_vaBuscar()');
ok((d1.els['va-sug']._res || []).length === 1, 'el buscador encuentra el artículo',
   (d1.els['va-sug']._res || []).map(p => p.nombre));
r1('_vaAgregar(0)');
ok(r1('VA_ITEMS.length') === 1 && r1('VA_ITEMS[0].nombre') === 'Funda silicona iPhone 15',
   'y lo agrega', r1('JSON.stringify(VA_ITEMS)'));
ok(r1('vaTotal()') === 8000, 'con el precio del inventario', r1('vaTotal()'));
ok(d1.els['va-buscar'].value === '', 'y deja el campo limpio para el siguiente');

// Lo desactivado no se vende: ya no está en la góndola.
d1.els['va-buscar'].value = 'cargador';
r1('_vaBuscar()');
ok((d1.els['va-sug']._res || []).length === 0, 'un artículo desactivado no aparece',
   (d1.els['va-sug']._res || []).map(p => p.nombre));

// El mismo dos veces es cantidad 2, no dos renglones.
d1.els['va-buscar'].value = 'funda';
r1('_vaBuscar()'); r1('_vaAgregar(0)');
ok(r1('VA_ITEMS.length') === 1 && r1('VA_ITEMS[0].qty') === 2,
   'el mismo artículo dos veces suma cantidad, no abre otro renglón', r1('JSON.stringify(VA_ITEMS)'));
ok(r1('vaTotal()') === 16000, 'y el total acompaña', r1('vaTotal()'));
ok(r1('vaCuantos()') === 2, 'la cuenta de unidades también');

// Precio a mano (un descuento puntual) y cantidad con los botones.
r1('_vaPrecio(0, 7000)');
ok(r1('vaTotal()') === 14000, 'se le puede hacer precio', r1('vaTotal()'));
r1('_vaQty(0, -1)');
ok(r1('VA_ITEMS[0].qty') === 1 && r1('vaTotal()') === 7000, 'y bajar la cantidad');
r1('_vaQty(0, -1)');
ok(r1('VA_ITEMS[0].qty') === 1, 'nunca por debajo de 1: para sacarlo está la cruz');

// Lo que el formulario necesita.
d1.els['va-buscar'].value = 'vidrio';
r1('_vaBuscar()'); r1('_vaAgregar(0)');
ok(r1('vaCostoTotal()') === 4500, 'el costo sale del inventario (3000 + 1500)', r1('vaCostoTotal()'));
const su = JSON.parse(r1('JSON.stringify(vaStockUpdates())'));
ok(su.length === 2 && su[0].id === 'p1' && su[0].qty === 1, 'un descuento de stock por artículo', su);
ok(r1('vaItems()[0].source') === 'producto' && r1('vaItems()[0].id') === 'p1',
   'y cada ítem sale con su id del inventario');

// Un precio en cero es plata que no entra.
ok(r1('vaSinPrecio()') === false, 'con precios, se puede cobrar');
r1('_vaPrecio(0, 0)');
ok(r1('vaSinPrecio()') === true, 'sin precio, avisa');
r1('_vaPrecio(0, 7000)');

// Sacar y limpiar.
r1('_vaQuitar(1)');
ok(r1('VA_ITEMS.length') === 1, 'la cruz saca el renglón');
r1('vaDesmontar()');
ok(r1('VA_ITEMS.length') === 0, 'y al cerrar el formulario no queda nada para la próxima venta');

// ══════════════════════════════════════════════════════════
console.log('\n2) Cobrar una reparación y que se lleve algo');
// ══════════════════════════════════════════════════════════
const ids2 = ['cobro-overlay', 'cobro-modal', 'cobro-monto-label', 'cobro-desc-label',
  'cobro-sena-info', 'cobro-articulos', 'va-buscar', 'va-sug', 'va-lineas'];
const d2 = hacerDom(ids2);
const TOASTS2 = [], WRITES2 = { set: [], update: [] };
const REP = { id: 'r1', nOrden: 1287, nombre: 'Juan', marca: 'Samsung', modelo: 'A54',
              arreglo: 'Pantalla', monto: 50000, sena: 10000, estado: 'listo', costo: 0 };
const c2 = {
  console, setTimeout: f => f(), clearTimeout,
  document: { getElementById: id => d2.els[id] || null,
              querySelector: () => null, querySelectorAll: () => [],
              createElement: () => d2.el('tmp'), addEventListener() {},
              body: { style: {}, appendChild() {},
                      classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
              documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
                                 style: { setProperty() {} } } },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: '' } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node' },
  esc: s => String(s == null ? '' : s), fmt: n => '$' + Number(n || 0),
  _todayAR: () => '2026-10-06',   // vive en utils.js
  toast: (m, t) => TOASTS2.push([t || 'info', m]), searchMatch: BUSCAR,
  confirm: () => true, alert: () => {},
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({ __ts: true }) } } },
  db: {
    batch: () => ({
      set: (ref, d) => { WRITES2.set.push({ col: ref.__col, data: d }); },
      update: (ref, d) => { WRITES2.update.push({ col: ref.__col, id: ref.__id, data: d }); },
      commit: async () => {},
    }),
    collection: n => ({
      // index.html no tiene la lista de accesorios: el bloque la pide acá.
      onSnapshot: (cb) => { cb({ docs: PROD.map(p => ({ id: p.id, data: () => p })) }); return () => {}; },
      doc: id => ({ __col: n, __id: id,
        update: async d => { WRITES2.update.push({ col: n, id, data: d }); },
        get: async () => ({ exists: false, data: () => ({}) }) }),
    }),
  },
};
c2.globalThis = c2; c2.self = c2; c2.window = c2;
vm.createContext(c2);
// Las dos del navegador en la misma página: si chocaran nombres, index.html
// no abriría.
let choque = null;
try {
  vm.runInContext(leer('repairs.js'), c2, { filename: 'repairs.js' });
  vm.runInContext(leer('venta-articulos.js'), c2, { filename: 'venta-articulos.js' });
} catch (e) { choque = e.message; }
ok(!choque, 'repairs.js y venta-articulos.js conviven en index.html', choque);

const r2 = e => vm.runInContext(e, c2);
r2('toast = (m, t) => __T(m, t); logActivity = () => {}; _repPatchLocal = () => {};');
c2.__T = (m, t) => TOASTS2.push([t || 'info', m]);
c2.__REP = REP;
r2('REPAIRS = [__REP];');

// CUPO: la pantalla de Reparaciones no lee los accesorios al abrirse. Solo
// cuando se abre el cobro, que es cuando pueden hacer falta.
ok(r2('VA_PRODUCTOS') === null, 'al cargar Reparaciones no se leen los accesorios', r2('VA_PRODUCTOS'));

r2('openCobroModal(__REP)');
ok(d2.els['cobro-monto-label'].textContent === '$ 40.000',
   'el número grande arranca en el saldo de la reparación', d2.els['cobro-monto-label'].textContent);

// Los accesorios llegan solos: el bloque los pide al abrir el cobro, no al
// abrir la pantalla de Reparaciones (que es la regla de cupo).
ok(r2('VA_PRODUCTOS && VA_PRODUCTOS.length') === 3,
   'los accesorios se traen al abrir el cobro', r2('VA_PRODUCTOS && VA_PRODUCTOS.length'));

// Se lleva un vidrio.
d2.els['va-buscar'].value = 'vidrio';
r2('_vaBuscar()');
ok((d2.els['va-sug']._res || []).length === 1, 'y se pueden buscar desde Reparaciones',
   (d2.els['va-sug']._res || []).map(p => p.nombre));
r2('_vaAgregar(0)');
ok(d2.els['cobro-monto-label'].textContent === '$ 44.500',
   'y el número grande pasa a decir lo que el cliente va a pagar', d2.els['cobro-monto-label'].textContent);

await r2('confirmarCobro()');
const movR = WRITES2.set.find(w => w.col === 'caja_movimientos');
ok(!!movR, 'se registra el movimiento', WRITES2.set.map(w => w.col));
ok(movR.data.monto === 44500, 'por el total cobrado (40.000 + 4.500)', movR.data.monto);
ok(movR.data.montoReparacion === 40000 && movR.data.montoProductos === 4500,
   'con las dos partes separadas, como las ventas mixtas de la caja', movR.data);
ok(Array.isArray(movR.data.items) && movR.data.items.length === 1 &&
   movR.data.items[0].id === 'p2', 'y el artículo adentro, con su id', movR.data.items);
ok(movR.data.gananciaARS === 3000, 'la ganancia es la del artículo (4.500 − 1.500)', movR.data.gananciaARS);
ok(/Vidrio templado/.test(movR.data.descripcion), 'la descripción lo nombra', movR.data.descripcion);
ok(movR.data.categoria === 'Reparación' && movR.data.repairId === 'r1',
   'sigue siendo el cobro de esa reparación', movR.data);
const stockR = WRITES2.update.find(w => w.col === 'productos');
ok(stockR && stockR.id === 'p2' && stockR.data.stock.__inc === -1,
   'y se descuenta del stock', WRITES2.update);
ok(r2('VA_ITEMS.length') === 0, 'al cerrar, el bloque queda limpio');

// Sin artículos, el cobro de siempre no cambia.
WRITES2.set.length = 0; WRITES2.update.length = 0;
r2('__REP.cobrado = false; REPAIRS = [__REP];');
r2('openCobroModal(__REP)');
await r2('confirmarCobro()');
const solo = WRITES2.set.find(w => w.col === 'caja_movimientos');
ok(solo.data.monto === 40000, 'cobrar sin artículos sigue siendo el saldo pelado', solo.data.monto);
ok(solo.data.items === undefined && solo.data.montoProductos === undefined,
   'y no agrega campos que antes no estaban', solo.data);
ok(!WRITES2.update.some(w => w.col === 'productos'), 'ni toca el stock', WRITES2.update);

// ══════════════════════════════════════════════════════════
console.log('\n3) Vender un celular con la funda');
// ══════════════════════════════════════════════════════════
const VE = ['ve-marca','ve-modelo','ve-imei','ve-imei2','ve-serie','ve-capacidad','ve-color',
  've-bateria','ve-ciclos','ve-condicion','ve-estetico','ve-libre','ve-cuentas','ve-precio','ve-pago',
  've-cuotas','ve-cuotas-wrap','ve-permuta','ve-permuta-val','ve-saldo','ve-garantia','ve-nro',
  've-vendedor','ve-notas','ve-cli-nombre','ve-cli-dni','ve-cli-tel','ve-accesorios','ve-pruebas',
  've-mas','ve-mas-btn','ve-confirm','ve-reg-caja','ventaeq-overlay','ventaeq-modal','ventaeq-tit',
  've-articulos','va-buscar','va-sug','va-lineas'];
const d3 = hacerDom(VE);
const TOASTS3 = [], W3 = { add: [], update: [] };
const c3 = {
  console, setTimeout, clearTimeout, requestAnimationFrame: f => f(),
  TextEncoder, crypto: require('crypto').webcrypto,
  btoa: s => Buffer.from(s, 'binary').toString('base64'), unescape, encodeURIComponent,
  document: { getElementById: id => d3.els[id] || null, querySelector: () => null,
              querySelectorAll: () => [], createElement: () => d3.el('tmp'), addEventListener() {},
              body: { appendChild() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
              documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: { setProperty() {} } } },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
            location: { href: '', origin: 'https://x' }, open: () => null, _DAKI_NAME: 'TechPoint' },
  location: { origin: 'https://x' },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
  navigator: { userAgent: 'node' },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({ __ts: true }) } } },
  db: { collection: name => ({
          add: async data => { W3.add.push({ col: name, data }); return { id: 'mov1' }; },
          doc: id => ({ update: async d => { W3.update.push({ col: name, id, data: d }); },
                        set: async d => { W3.update.push({ col: name, id, data: d }); },
                        get: async () => ({ exists: false, data: () => ({}) }) }) }) },
  _todayAR: () => '2026-10-06',
  toast: (m, t) => TOASTS3.push([t || 'info', m]), confirm: () => true, alert: () => {},
  fmt: n => '$' + Number(n || 0).toLocaleString('es-AR'),
  esc: s => String(s == null ? '' : s),
  searchMatch: BUSCAR, getCurrentDolar: () => 1000, getDeviceId: () => 'test',
  upsertCliente: async () => {}, tgNotify: m => { c3.__TG = m; },
  tgMonto: n => '$' + n, tgHora: () => '10:00',
  requireAuth: () => Promise.resolve(null), showApp: () => {},
  getConfig: () => ({ telefonoNegocio: '1172392511' }),
};
c3.globalThis = c3; c3.self = c3;
vm.createContext(c3);
let choque3 = null;
try {
  for (const f of ['caja.js', 'qr.js', 'print.js', 'venta-articulos.js']) {
    vm.runInContext(leer(f), c3, { filename: f });
  }
} catch (e) { choque3 = e.message; }
ok(!choque3, 'caja.js, qr.js, print.js y venta-articulos.js conviven en caja.html', choque3);

const r3 = e => vm.runInContext(e, c3);
r3('_openPrint = (html, t) => { __HTML = html; };');
r3("db = globalThis.db; currentDate = '2026-10-06'; toast = (m, t) => __T3(m, t);");
c3.__T3 = (m, t) => TOASTS3.push([t || 'info', m]);
c3.__PROD = PROD;
// En caja.html la lista de accesorios ya la mantiene inventario.js: el bloque
// la reusa y NO abre un segundo listener (seria leer la coleccion dos veces).
r3('var PRODUCTOS = __PROD; var _listenProductos = () => { __LLAMADO(); };');
let reusos = 0;
c3.__LLAMADO = () => { reusos++; };
r3(`CAJA_STOCK = [{ id: 's1', marca: 'Apple', modelo: 'iPhone 15', imei: '356789102345678',
     precio: 900000, costo: 700000, garantiaMeses: 6 }];`);
r3("openVentaEqModal('s1')");
ok(r3('typeof vaItems') === 'function' && d3.els['ve-articulos'] !== undefined,
   'el bloque se monta en el formulario de venta');
ok(reusos === 1 && r3('_vaListener') === null,
   'y reusa la lista que ya tiene la caja, sin leer los accesorios de nuevo',
   { reusos, propio: r3('_vaListener') });

d3.els['va-buscar'].value = 'funda';
r3('_vaBuscar()');
r3('_vaAgregar(0)');
ok(r3('vaTotal()') === 8000, 'se suma la funda', r3('vaTotal()'));

await r3('confirmVentaEquipo()');
const movE = W3.add.find(w => w.col === 'caja_movimientos');
ok(!!movE, 'la venta se registra', W3.add.map(w => w.col));
ok(movE.data.monto === 908000, 'por el total: el celular más la funda', movE.data.monto);
ok(movE.data.montoEquipo === 900000 && movE.data.montoProductos === 8000,
   'con las dos partes separadas', movE.data);
ok(Array.isArray(movE.data.items) && movE.data.items[0].id === 'p1',
   'la funda queda adentro de la venta', movE.data.items);
ok(movE.data.costoARSTotal === 703000, 'el costo suma el del artículo (700.000 + 3.000)', movE.data.costoARSTotal);
ok(movE.data.gananciaARS === 205000, 'y la ganancia sale de los dos (200.000 + 5.000)', movE.data.gananciaARS);
const stockE = W3.update.find(w => w.col === 'productos');
ok(stockE && stockE.id === 'p1' && stockE.data.stock.__inc === -1, 'se descuenta del stock', W3.update);
ok(W3.update.some(w => w.col === 'stock' && w.id === 's1' && w.data.vendido === true),
   'y el celular queda vendido, como siempre', W3.update);
ok(/Funda/.test(c3.__TG || ''), 'el aviso de Telegram nombra lo que se llevó', c3.__TG);

// El comprobante: el cliente se tiene que llevar un papel que diga todo lo que
// pagó, o no sirve como comprobante.
c3.__EQ = { marca: 'Apple', modelo: 'iPhone 15', precio: 900000, precioTotal: 908000,
            garantiaMeses: 6, fecha_venta: '2026-10-06T12:00:00.000Z',
            articulos: [{ nombre: 'Funda silicona iPhone 15', qty: 1, precioUnit: 8000 }] };
r3("printVentaTicket(null, __EQ, 'A5')");
const html = r3('__HTML');
ok(/Funda silicona iPhone 15/.test(html), 'el comprobante nombra el artículo');
ok(/908\.000/.test(html), 'y el total que pagó', (html.match(/\$[\d.]+/g) || []).slice(0, 6));
ok(/TOTAL<\/td><td>\$\s?908\.000/.test(html.replace(/\s+/g, ' ')),
   'y el renglón TOTAL dice el total, no el precio del celular',
   (html.match(/TOTAL[\s\S]{0,60}/) || [''])[0]);

// Sin artículos, el comprobante de siempre.
c3.__EQ2 = { marca: 'Apple', modelo: 'iPhone 15', precio: 900000, garantiaMeses: 6,
             fecha_venta: '2026-10-06T12:00:00.000Z' };
r3("printVentaTicket(null, __EQ2, 'A5')");
const html2 = r3('__HTML');
ok(/TOTAL<\/td><td>\$\s?900\.000/.test(html2.replace(/\s+/g, ' ')),
   'sin artículos, el TOTAL es el precio del celular', (html2.match(/TOTAL[\s\S]{0,60}/) || [''])[0]);
ok(!/Funda/.test(html2), 'y no aparece ningún renglón de artículos');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})().catch(e => { console.error('Error:', e); process.exit(1); });
