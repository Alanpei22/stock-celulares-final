// Etiquetas al guardar, desde el formulario de carga (accesorios y repuestos).
//
// Alan carga un artículo y quiere la etiqueta ya, con lo que escribió. Antes
// había que guardar, buscarlo en la lista, abrirlo y tocar 🏷️.
//
// Lo delicado: sin QZ Tray, Chrome bloquea la ventana de impresión si no se
// abre en el mismo toque. Por eso se abre al tocar Guardar y se llena cuando
// Firestore devuelve el artículo guardado (con su código TP). Si no se pudo
// guardar, la ventana se cierra y no sale nada.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// ── print.js en una sandbox ──
const els = {};
const mk = (id, extra) => (els[id] = Object.assign({ id, value: '', checked: false, style: {}, addEventListener() {} }, extra));
const VENTANAS = [];
const ctx = {
  console, Date, Math, JSON, Number, String, Array, Object, Promise, parseInt, parseFloat,
  setTimeout: f => { f(); return 0; },
  document: { getElementById: id => els[id] || null, createElement: () => ({ style: {} }), body: { appendChild() {} } },
  navigator: { userAgent: 'node' },
  toast: () => {}, alert: () => {},
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
  btoa: s => Buffer.from(s, 'binary').toString('base64'), TextEncoder, unescape, encodeURIComponent,
};
ctx.window = {
  _DAKI_NAME: 'TechPoint',
  open: () => {
    const w = { html: '', cerrada: false, document: { open() {}, write(h) { w.html += h; }, close() {} },
                addEventListener() {}, focus() {}, print() {}, close() { w.cerrada = true; } };
    VENTANAS.push(w); return w;
  },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('qr.js'), ctx, { filename: 'qr.js' });
vm.runInContext(leer('barcode.js'), ctx, { filename: 'barcode.js' });
vm.runInContext(leer('print.js'), ctx, { filename: 'print.js' });
const run = c => vm.runInContext(c, ctx);
ctx.open = ctx.window.open;
const espera = () => new Promise(r => setImmediate(r));

(async () => {

console.log('\n1) Cuántas etiquetas');
['inv-etq-row', 'inv-fi-etq', 'inv-fi-etq-copias'].forEach(id => mk(id));
ok(run("etqAlGuardarCopias('inv', 5)") === 0, 'sin tildar la casilla, ninguna');
els['inv-fi-etq'].checked = true;
ok(run("etqAlGuardarCopias('inv', 5)") === 5, 'tildada y sin decir cuántas: una por unidad cargada');
ok(run("etqAlGuardarCopias('inv', 0)") === 1, 'con stock 0, igual una');
els['inv-fi-etq-copias'].value = '2';
ok(run("etqAlGuardarCopias('inv', 5)") === 2, 'si ponés cuántas, esas');
els['inv-etq-row'].style.display = 'none';
ok(run("etqAlGuardarCopias('inv', 5)") === 0, 'editando (renglón escondido) no imprime al guardar');

console.log('\n2) La casilla queda tildada para la tanda');
run("etqAlGuardarPreparar('inv', false)");
ok(els['inv-etq-row'].style.display === '' && els['inv-fi-etq-copias'].value === '', 'artículo nuevo: se ve, sin copias puestas');
ctx.localStorage._d['etqAlGuardar_inv'] = '1';
els['inv-fi-etq'].checked = false;
run("etqAlGuardarPreparar('inv', false)");
ok(els['inv-fi-etq'].checked === true, 'si la última vez estaba tildada, arranca tildada');
run("etqAlGuardarPreparar('inv', true)");
ok(els['inv-etq-row'].style.display === 'none', 'editando no aparece (para eso está el botón 🏷️)');

console.log('\n3) Sale con lo que guardaste');
let listo;
run('qzActivo = () => false');
ctx.__P = new Promise(r => { listo = r; });
run("printEtiquetasAlGuardar(__P, 2)");
ok(VENTANAS.length === 1, 'la ventana se abre en el toque, antes de guardar (si no, Chrome la bloquea)');
listo({ id: 'x1', nombre: 'Funda iPhone 15 negra', precioVenta: 9000, codigo: 'TP00123' });
await espera(); await espera();
const h = VENTANAS[0].html;
ok(/Funda iPhone 15 negra/.test(h), 'con el nombre que escribiste');
ok(h.includes(run('_precioClave(9000)')), 'y el precio (en clave, como en las demás etiquetas)');
ok((h.match(/Funda iPhone 15 negra/g) || []).length >= 2, 'las copias pedidas');

console.log('\n4) Si no se guardó, no sale nada');
ctx.__P = Promise.resolve(null);
run("printEtiquetasAlGuardar(__P, 1)");
await espera(); await espera();
ok(VENTANAS[1].cerrada && !/Funda/.test(VENTANAS[1].html), 'la ventana se cierra sola');

console.log('\n5) Repuestos: el nombre es tipo + nombre');
ctx.__P = Promise.resolve({ id: 'r1', tipo: 'Pantalla', nombre: 'A54 con marco', precioVenta: 60000, codigo: 'TP00124' });
run("printEtiquetasAlGuardar(__P, 1, 'repuesto')");
await espera(); await espera();
ok(/Pantalla A54 con marco/.test(VENTANAS[2].html), 'como en la etiqueta de siempre', VENTANAS[2].html.slice(0, 80));

console.log('\n6) Enganchado en los dos formularios');
const inv = leer('inventario.js'), rep = leer('repuestos.js');
ok(/id="inv-fi-etq"/.test(leer('caja.html')) && /id="inv-fi-etq-copias"/.test(leer('caja.html')), 'accesorios tiene la casilla');
ok(/id="rep2-fi-etq"/.test(leer('index.html')) && /id="rep2-fi-etq-copias"/.test(leer('index.html')), 'repuestos también');
// La ventana se pide ANTES del primer await del guardado
const save = inv.slice(inv.indexOf('async function saveProducto'), inv.indexOf('function _invIsOwner'));
ok(save.indexOf('printEtiquetasAlGuardar') > 0 && save.indexOf('printEtiquetasAlGuardar') < save.indexOf('await '),
   'accesorios: se pide en el toque, antes de esperar a la base');
ok(/alGuardar\(\{ \.\.\.data, id: ref && ref\.id \}\)/.test(save) && /finally \{\s*\n\s*alGuardar\(null\)/.test(save),
   'y se llena con el artículo guardado, o se cancela');
ok(/printEtiquetasAlGuardar\(new Promise[\s\S]{0,80}'repuesto'\)/.test(rep) && /opts\.alGuardar\(nuevo\)/.test(rep)
   && /opts\.alGuardar\(null\)/.test(rep), 'repuestos: lo mismo');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
