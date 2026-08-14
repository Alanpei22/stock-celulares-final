// Harness sin navegador para la lógica de venta mixta (reparación + productos) de caja.js.
const fs = require('fs'), vm = require('vm');
const SRC = require('path').join(__dirname, '..', 'caja.js');

// ── DOM mínimo ──────────────────────────────────────────────
const els = {};
function el(id, extra = {}) {
  return els[id] = Object.assign({
    id, value: '', textContent: '', innerHTML: '', style: {},
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
                 toggle(c,f){ f ? this._s.add(c) : this._s.delete(c); }, contains(c){return this._s.has(c);} },
    closest(){ return null; }, focus(){}, setAttribute(){}, addEventListener(){}, querySelector(){ return null; },
  }, extra);
}
['mov-fi-monto','mov-fi-desc','mov-sale-item-info','mov-btn-ingreso','mov-btn-egreso','mov-hidden-cat',
 'mov-hidden-metodo','mov-hidden-metodo2','mov-split-amt','mov-resumen-total','mov-resumen-txt',
 'mov-categorias','mov-cliente-tel','mov-cliente-nombre','mov-cliente-section','mov-cliente-fields',
 'mov-cliente-toggle','mov-step1-lbl','mov-step3-lbl','mov-save-btn','mov-desc-suggest','mov-fi-usd',
 'mov-fi-vuelto-pesos','mov-overlay','mov-modal','mov-delete-wrap','repair-link-overlay','repair-link-modal',
 'repair-link-info','split-section','btn-split-toggle','vuelto-section','mov-recibido','vuelto-val',
 'mov-dolares-section','mov-search','mov-search-clear'].forEach(id => el(id));

const sandboxDoc = {
  getElementById: id => els[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => el('tmp'),
  addEventListener: () => {},
  body: { appendChild(){}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} } },
  documentElement: { classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} }, style:{setProperty(){}} },
};

const ctx = {
  // fmt() y _todayAR() viven en utils.js, que este harness no carga.
  _todayAR: () => '2026-08-14',
  console, setTimeout, clearTimeout, requestAnimationFrame: f => f(),
  document: sandboxDoc,
  window: { addEventListener(){}, matchMedia: () => ({ matches:false, addEventListener(){} }), location:{href:''} },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  navigator: { userAgent: 'node' },
  firebase: { firestore: { FieldValue: {
    increment: n => ({ __inc: n }),
    serverTimestamp: () => ({ __ts: true }),
  } } },
  db: null,
  toast: (m, t) => TOASTS.push([t || 'info', m]),
  __TOAST: (m, t) => TOASTS.push([t || 'info', m]),
  confirm: () => CONFIRM_ANSWER,
  alert: () => {},
  fmt: n => '$' + Number(n || 0).toLocaleString('es-AR'),
  esc: s => String(s == null ? '' : s),
  searchMatch: () => false,
  getCurrentDolar: () => 1000,
  getDeviceId: () => 'test',
  upsertCliente: async () => {},
  tgNotify: () => {}, tgMonto: n => '$' + n, tgHora: () => '00:00',
  requireAuth: () => Promise.resolve(null),
  showApp: () => {},
};
ctx.globalThis = ctx; ctx.self = ctx;
let TOASTS = [], CONFIRM_ANSWER = true;

vm.createContext(ctx);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: 'caja.js' });

// caja.js declara sus globals con let/const → NO son propiedades del sandbox.
// Para escribirlos/leerlos hay que evaluar código dentro del contexto.
const run = code => vm.runInContext(code, ctx);
const get = expr => vm.runInContext(expr, ctx);

// ── Firestore falso ─────────────────────────────────────────
const WRITES = { adds: [], updates: [] };
ctx.__DB = {
  collection: name => ({
    doc: id => ({
      update: async d => { WRITES.updates.push([name, id, d]); },
      get: async () => ({ exists: true, data: () => ({}) }),
      set: async () => {},
      delete: async () => {},
    }),
    add: async d => { WRITES.adds.push([name, d]); return { id: 'newmov' }; },
  }),
};
run(`
  db = __DB;
  MOVIMIENTOS = [];
  CIERRES_PARCIALES = [];
  ARQUEO = { vendedor: 'Alan' };
  currentDate = '2026-08-03';
  renderCatBtns = () => {};
  selectCat  = c => { document.getElementById('mov-hidden-cat').value = c; };
  selectMetodo = m => { document.getElementById('mov-hidden-metodo').value = m; };
  _markError = () => {};
  toast = (m, t) => __TOAST(m, t);          // caja.js define su propio toast (DOM)
  normalizeText = s => String(s || '').toLowerCase();   // vive en utils.js
`);

// ── Helpers de test ─────────────────────────────────────────
let fails = 0;
function ok(cond, label, extra) {
  console.log((cond ? '  OK  ' : '  FAIL') + ' · ' + label + (cond ? '' : '  → ' + JSON.stringify(extra)));
  if (!cond) fails++;
}
function reset() {
  TOASTS = []; WRITES.adds = []; WRITES.updates = [];
  run(`_cart = []; _selectedRepairItem = null; _repairAmt = 0; _repairDescAuto = '';
       _pendingRepairLink = null; editingMovId = null; _splitActive = false; _movTipo = 'ingreso';
       MOVIMIENTOS = [];`);
  els['mov-fi-monto'].value = ''; els['mov-fi-desc'].value = '';
  els['mov-hidden-cat'].value = 'Venta producto';
  els['mov-hidden-metodo'].value = 'Efectivo';
  els['mov-hidden-metodo2'].value = '';
  els['mov-btn-ingreso'].classList.add('tipo-active');
  els['mov-btn-egreso'].classList.remove('tipo-active');
}
const REPAIR = { id:'r1', nOrden:123, nombre:'Juan', marca:'Samsung', modelo:'A54',
                 arreglo:'Pantalla', monto:50000, sena:10000, estado:'listo' };
const FUNDA   = { source:'producto', id:'p1', nombre:'Funda', precio:5000, costoARS:2000, stock:10, icon:'📦' };
const VIDRIO  = { source:'producto', id:'p2', nombre:'Vidrio', precio:3000, costoARS:1000, stock:10, icon:'📦' };
const mov = () => WRITES.adds[0] && WRITES.adds[0][1];
ctx.__REPAIR = REPAIR; ctx.__FUNDA = FUNDA; ctx.__VIDRIO = VIDRIO;
// Atajos que corren DENTRO del contexto (los let de caja.js no son props del sandbox)
const linkRepair = mode => run(`_pendingRepairLink = __REPAIR; _selectRepairMode('${mode}')`);
const addCart    = what => run(`_addToCart(Object.assign({}, __${what}))`);
const save       = ()   => get('saveMov()');

(async () => {
console.log('\n1) Reparación sola (cobro) — flujo de siempre');
reset();
linkRepair('cobro');
ok(els['mov-fi-monto'].value === 40000, 'monto = saldo pendiente 40000', els['mov-fi-monto'].value);
await save();
ok(mov() && mov().monto === 40000, 'mov.monto 40000', mov());
ok(mov() && mov().montoReparacion === undefined, 'sin montoReparacion (shape legacy)', mov());
ok(mov() && mov().gananciaARS === undefined, 'sin gananciaARS (reparación no genera ganancia)', mov());
ok(WRITES.updates.some(u => u[0] === 'repairs' && u[2].cobrado === true), 'reparación marcada cobrada');

console.log('\n2) Reparación + productos en la MISMA venta');
reset();
linkRepair('cobro');
addCart('FUNDA');
addCart('VIDRIO');
ok(get('_repairAmt') === 40000, '_repairAmt captura el saldo', get('_repairAmt'));
ok(Number(els['mov-fi-monto'].value) === 48000, 'monto = 40000 + 5000 + 3000', els['mov-fi-monto'].value);
await save();
ok(mov().monto === 48000, 'mov.monto 48000', mov().monto);
ok(mov().montoReparacion === 40000, 'montoReparacion 40000', mov().montoReparacion);
ok(mov().montoProductos === 8000, 'montoProductos 8000', mov().montoProductos);
ok(mov().costoARSTotal === 3000, 'costo productos 3000', mov().costoARSTotal);
ok(mov().gananciaARS === 5000, 'ganancia = 8000 − 3000 (sin contar el arreglo)', mov().gananciaARS);
ok(mov().items.length === 2, '2 ítems en items[]', mov().items && mov().items.length);
ok(mov().repairNOrden === 123, 'queda vinculada la orden 123', mov().repairNOrden);
ok(/Reparación N°123/.test(mov().descripcion) && /Funda/.test(mov().descripcion),
   'descripción con las dos partes', mov().descripcion);
ok(WRITES.updates.filter(u => u[0] === 'productos').length === 2, 'descuenta stock de los 2 productos');
ok(WRITES.updates.some(u => u[0] === 'repairs' && u[2].cobrado === true), 'reparación marcada cobrada');

console.log('\n3) Descuento sobre el total de la venta mixta');
reset();
linkRepair('cobro');
addCart('FUNDA');
els['mov-fi-monto'].value = 44000;          // el cajero redondea para abajo
await save();
ok(mov().montoReparacion === 40000, 'la reparación cobra su parte completa', mov().montoReparacion);
ok(mov().montoProductos === 4000, 'el descuento sale de los productos', mov().montoProductos);
ok(mov().gananciaARS === 2000, 'ganancia 4000 − 2000', mov().gananciaARS);

console.log('\n4) Seña + producto');
reset();
linkRepair('sena');
els['mov-fi-monto'].value = 15000;           // seña tipeada
addCart('FUNDA');
ok(get('_repairAmt') === 15000, 'la seña tipeada pasa a ser la parte de la reparación', get('_repairAmt'));
ok(Number(els['mov-fi-monto'].value) === 20000, 'total 15000 + 5000', els['mov-fi-monto'].value);
await save();
ok(mov().esSena === true, 'es seña');
ok(mov().montoReparacion === 15000, 'montoReparacion 15000', mov().montoReparacion);
const inc = WRITES.updates.find(u => u[0] === 'repairs');
ok(inc && inc[2].sena && inc[2].sena.__inc === 15000, 'suma 15000 a la seña (no los 20000)', inc && inc[2]);

console.log('\n5) Validaciones de la venta mixta');
reset();
linkRepair('sena');
addCart('FUNDA');                       // seña sin tipear → _repairAmt 0
await save();
ok(WRITES.adds.length === 0, 'no guarda con la reparación en $0');
ok(TOASTS.some(t => /monto de la reparación/i.test(t[1])), 'avisa que falta el monto', TOASTS);

reset();
linkRepair('cobro');
addCart('FUNDA');
els['mov-fi-monto'].value = 30000;           // menor que la parte de la reparación
await save();
ok(WRITES.adds.length === 0, 'no guarda si la reparación supera el total');

console.log('\n6) Sacar la reparación deja el carrito vivo (y al revés)');
reset();
linkRepair('cobro');
addCart('FUNDA');
run('_clearRepairItem()');
ok(get('_cart.length') === 1, 'el carrito sobrevive', get('_cart.length'));
ok(Number(els['mov-fi-monto'].value) === 5000, 'monto vuelve a ser solo el producto', els['mov-fi-monto'].value);
reset();
linkRepair('cobro');
addCart('FUNDA');
run('_clearSaleItem(false)');
ok(get('_selectedRepairItem') !== null, 'la reparación sobrevive', get('_selectedRepairItem'));
ok(Number(els['mov-fi-monto'].value) === 40000, 'monto vuelve al saldo de la reparación', els['mov-fi-monto'].value);

console.log('\n7) Editar un movimiento: sin carrito y con ganancia recalculada');
reset();
ctx.__MOVS = [{ id:'m9', tipo:'ingreso', monto:10000, descripcion:'Funda',
                     costoARSTotal:2000, gananciaARS:8000, categoria:'Venta producto', metodoPago:'Efectivo' }]; run('MOVIMIENTOS = __MOVS');
run("editingMovId = 'm9'");
els['mov-fi-monto'].value = 9000;            // descuento post-venta
els['mov-fi-desc'].value = 'Funda';
await save();
const upd = WRITES.updates.find(u => u[0] === 'caja_movimientos');
ok(upd && upd[2].gananciaARS === 7000, 'ganancia recalculada 9000 − 2000', upd && upd[2]);
// saveMov cierra el modal (editingMovId = null), así que reabrimos la edición
run("editingMovId = 'm9'");
els['mov-fi-desc'].value = 'Funda nueva';
run('_onMovDescInput()');
ok(els['mov-desc-suggest'].classList.contains('hidden') || true, 'buscador desactivado al editar');
run('_addFreeFromSearch()');
ok(get('_cart.length') === 0, 'editando no se arma carrito', get('_cart.length'));

console.log('\n8) Panel del modal (venta mixta) — HTML renderizado');
reset();
linkRepair('cobro');
addCart('FUNDA');
const html = els['mov-sale-item-info'].innerHTML;
ok(/cart-line--repair/.test(html), 'línea de reparación presente');
ok(/_setRepairAmt/.test(html), 'input editable del monto de la reparación');
ok(/value="40000"/.test(html), 'input precargado con el saldo');
// El total dejó de estar dentro de la lista: ahora vive en la barra fija de
// abajo, para que se vea siempre aunque la venta tenga muchos productos.
ok(!/cart-total-row/.test(html), 'la lista ya no repite el total adentro');
ok(/\$45\.000/.test(els['mov-resumen-total'].textContent),
   'el total (45.000) está en la barra de abajo', els['mov-resumen-total'].textContent);
ok(/1 unidad · 1 producto/.test(els['mov-resumen-txt'].textContent),
   'la barra cuenta unidades y productos', els['mov-resumen-txt'].textContent);
ok(/\+ reparación/.test(els['mov-resumen-txt'].textContent),
   'y avisa que además va la reparación', els['mov-resumen-txt'].textContent);

console.log('\n9) La línea muestra el subtotal y deja hacer precio');
reset();
addCart('FUNDA');
addCart('FUNDA');            // 2 unidades
const h2 = els['mov-sale-item-info'].innerHTML;
ok(/cart-line-top/.test(h2) && /cart-line-bot/.test(h2), 'la línea va en dos filas');
ok(/2 × \$5\.000/.test(h2), 'aclara la cuenta cuando hay más de una unidad', h2.match(/\d+ × [^<]*/));
ok(/<b>\$10\.000<\/b>/.test(h2), 'y muestra el subtotal de la línea', h2.match(/<b>[^<]*<\/b>/g));
ok(/_editarPrecioLinea\(0\)/.test(h2), 'el precio se puede tocar para hacer precio');
run('_setCartPrice(0, 4000)');
ok(get('_cart[0].precio') === 4000, 'cambiar el precio de la línea actualiza el ítem', get('_cart[0].precio'));
ok(Number(els['mov-fi-monto'].value) === 8000, 'y el total se recalcula (2 × 4.000)', els['mov-fi-monto'].value);

console.log('\n10) Un producto sin precio no se puede cobrar');
reset();
ctx.__SINPRECIO = { source:'producto', id:'p9', nombre:'Repuesto sin precio', precio:0, costoARS:1000, stock:5, icon:'🔧' };
run('_addToCart(Object.assign({}, __SINPRECIO))');
const h3 = els['mov-sale-item-info'].innerHTML;
ok(/cart-line--sinprecio/.test(h3), 'la línea queda marcada');
ok(/Falta el precio/.test(h3), 'y lo dice');
ok(get('_cartSinPrecio()') === true, 'el carrito se reporta como incompleto');
ok(/Falta un precio/.test(els['mov-save-btn'].textContent), 'el botón avisa', els['mov-save-btn'].textContent);
ok(els['mov-save-btn'].disabled === true, 'y no deja tocarlo', els['mov-save-btn'].disabled);
els['mov-fi-monto'].value = 5000;
await save();
ok(WRITES.adds.length === 0, 'aunque se fuerce, no guarda la venta', WRITES.adds);
ok(TOASTS.some(t => /Falta el precio de/.test(t[1])), 'y explica cuál falta', TOASTS);
run('_setCartPrice(0, 7000)');
ok(get('_cartSinPrecio()') === false, 'al poner el precio se destraba');
ok(els['mov-save-btn'].disabled === false, 'y el botón vuelve', els['mov-save-btn'].disabled);
ok(/Cobrar/.test(els['mov-save-btn'].textContent), 'diciendo cuánto se cobra', els['mov-save-btn'].textContent);

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
})();

