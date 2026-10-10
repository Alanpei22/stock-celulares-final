// Cargar la lista de repuestos de cero, con etiqueta en cada uno.
//
// Alan borra la lista vieja y arma una nueva poniéndole una etiqueta con
// código de barras a cada repuesto. Dos cosas lo hacían lento o lo rompían:
//
//   · El campo del código dice "Vacío = se genera uno (TP…)" desde que
//     existe, pero no lo generaba nadie: se guardaba en blanco. Sin código no
//     hay etiqueta ni se escanea en la caja, que es para lo que se carga.
//   · Guardar cerraba el formulario, así que cada repuesto costaba dos toques
//     de más (volver a abrir, volver a elegir tipo y marca).
//
// Y un bug viejo: abrir uno existente y después "nuevo" dejaba el código del
// anterior en el campo, listo para guardarse repetido.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// ── Sandbox con repuestos.js y el contador real de utils.js ─
const els = {};
const el = id => els[id] = {
  id, value: '', textContent: '', innerHTML: '', checked: false, style: {}, dataset: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  focus() {}, blur() {}, select() {}, setAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], closest: () => null, appendChild() {},
};
['rep2-fi-nombre', 'rep2-fi-marca', 'rep2-fi-modelo', 'rep2-fi-tipo', 'rep2-fi-cantidad',
 'rep2-fi-stockmin', 'rep2-fi-costoUSD', 'rep2-fi-precioVenta', 'rep2-fi-codigo',
 'rep2-fi-proveedor', 'rep2-fi-notas', 'rep2-form-save', 'rep2-form-save-otro',
 'rep2-form-title', 'rep2-form-etq', 'rep2-delete-wrap', 'rep2-form-modal',
 'rep2-fi-costoARS-hint'].forEach(el);

const TOASTS = [];
const GUARDADO = [];
let META = null, FALLAR = false;

const ctx = {
  console, setTimeout: f => f(), clearTimeout, Date, Math, JSON, Number, String, parseInt, parseFloat,
  document: {
    getElementById: id => els[id] || el(id),
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el('tmp'), addEventListener() {},
    body: { style: {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: '' } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node' },
  esc: s => String(s == null ? '' : s), fmt: n => '$' + Number(n || 0),
  toast: (m, t) => TOASTS.push([t || 'info', m]),
  confirm: () => true, alert: () => {}, searchMatch: () => true,
  dolarBlue: 1200,
  db: {
    collection: () => ({
      doc: () => ({
        // El contador de códigos (config/etiquetasMeta) y los repuestos usan
        // el mismo doc() de mentira: alcanza para esto.
        get: async () => { if (FALLAR) throw new Error('sin internet'); return { exists: META !== null, data: () => META }; },
        set: async d => {
          if (d && d.ultimoCodigo !== undefined) { if (FALLAR) throw new Error('sin internet'); META = Object.assign({}, META, d); return; }
          GUARDADO.push(d);
        },
        update: async () => {},
      }),
    }),
  },
  firebase: { firestore: { FieldValue: { serverTimestamp: () => ({}) } } },
};
ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(leer('utils.js'), ctx, { filename: 'utils.js' });
vm.runInContext(leer('repuestos.js'), ctx, { filename: 'repuestos.js' });
const run = e => vm.runInContext(e, ctx);
run('toast = (m, t) => __T(m, t); REPUESTOS = []; renderRepuestos = () => {}; _updateCostoARSHint = () => {};');
ctx.__T = (m, t) => TOASTS.push([t || 'info', m]);

const cargar = (nombre, codigo = '') => {
  els['rep2-fi-nombre'].value = nombre;
  els['rep2-fi-marca'].value = 'Samsung';
  els['rep2-fi-modelo'].value = 'A54';
  els['rep2-fi-tipo'].value = 'Pantalla';
  els['rep2-fi-cantidad'].value = '3';
  els['rep2-fi-stockmin'].value = '2';
  els['rep2-fi-costoUSD'].value = '25';
  els['rep2-fi-precioVenta'].value = '60000';
  els['rep2-fi-codigo'].value = codigo;
  els['rep2-fi-proveedor'].value = 'Mayorista';
};
const ultimo = () => GUARDADO[GUARDADO.length - 1];

(async () => {

console.log('\n1) El código de barras sale solo');
// Es lo que el formulario ya prometía: "Vacío = se genera uno (TP…)".
ok(/Vacío = se genera uno \(TP/.test(leer('index.html')), 'el formulario lo promete');
run('editingRepuestoId = null');
cargar('Pantalla A54');
await run('saveRepuesto()');
ok(ultimo() && /^TP\d{5}$/.test(ultimo().codigo), 'y ahora se cumple', ultimo() && ultimo().codigo);
const primero = ultimo().codigo;
ok(TOASTS.some(t => t[1].includes(primero)), 'el aviso dice cuál le tocó, que es el que va en la etiqueta',
   TOASTS[TOASTS.length - 1]);

// Dos repuestos no pueden compartir etiqueta: la caja no sabría cuál es cuál.
run('editingRepuestoId = null');
cargar('Pantalla A14');
await run('saveRepuesto()');
ok(ultimo().codigo !== primero, 'el siguiente es otro número', [primero, ultimo().codigo]);
ok(Number(ultimo().codigo.slice(2)) === Number(primero.slice(2)) + 1, 'el que sigue, sin saltos');

// Si el repuesto ya trae código del proveedor, ese manda.
run('editingRepuestoId = null');
cargar('Bateria con codigo', '7790040123456');
await run('saveRepuesto()');
ok(ultimo().codigo === '7790040123456', 'un código escrito a mano no se pisa', ultimo().codigo);

// Sin internet se guarda igual: perder la carga es peor que quedarse sin
// código, que después se genera desde el menú.
FALLAR = true;
const grito = [console.warn, console.error];
console.warn = console.error = () => {};
const antes = GUARDADO.length;
run('editingRepuestoId = null');
cargar('Pantalla sin señal');
await run('saveRepuesto()');
[console.warn, console.error] = grito;
FALLAR = false;
ok(GUARDADO.length === antes + 1, 'sin internet el repuesto se guarda igual', GUARDADO.length - antes);
ok(ultimo().codigo === '', 'sin código, que queda para "Generar códigos de barras"', ultimo().codigo);

console.log('\n2) Guardar y cargar otro');
ok(/id="rep2-form-save-otro"/.test(leer('index.html')), 'está el botón');
ok(/rep2-form-save-otro[\s\S]{0,200}saveRepuesto\(\{ seguir: true \}\)/.test(leer('repuestos.js')),
   'y guarda sin cerrar el formulario');
run('editingRepuestoId = null');
cargar('Pantalla A34');
await run('saveRepuesto({ seguir: true })');
ok(els['rep2-form-title'].textContent === '🔩 Nuevo Repuesto', 'queda listo para el siguiente',
   els['rep2-form-title'].textContent);
// Lo que se repite en una tanda se conserva; lo de cada repuesto se borra.
ok(els['rep2-fi-tipo'].value === 'Pantalla' && els['rep2-fi-marca'].value === 'Samsung',
   'conserva tipo y marca: en una tanda se repiten');
ok(els['rep2-fi-proveedor'].value === 'Mayorista' && els['rep2-fi-stockmin'].value === '2',
   'y el proveedor y el stock mínimo');
ok(els['rep2-fi-nombre'].value === '' && els['rep2-fi-modelo'].value === '' &&
   els['rep2-fi-cantidad'].value === '', 'borra lo que cambia en cada uno');
ok(els['rep2-fi-codigo'].value === '', 'y el código, que si no se repetiría', els['rep2-fi-codigo'].value);
// El caso que de verdad duele: escribiste un código a mano y seguís cargando.
// Si quedara puesto, el que viene se guardaría con la misma etiqueta.
run('editingRepuestoId = null');
cargar('Pantalla con codigo propio', '7790040999999');
await run('saveRepuesto({ seguir: true })');
ok(els['rep2-fi-codigo'].value === '',
   'también cuando el código lo escribiste vos: dos repuestos con la misma etiqueta sería peor',
   els['rep2-fi-codigo'].value);
ok(els['rep2-fi-precioVenta'].value === '' && els['rep2-fi-costoUSD'].value === '',
   'los precios también: cada repuesto tiene el suyo');

console.log('\n3) Abrir uno viejo y después uno nuevo no arrastra el código');
// Pasaba antes: el campo del código no se limpiaba al abrir "Nuevo", así que
// el repuesto nuevo se guardaba con la etiqueta del anterior.
run("REPUESTOS = [{ id:'r1', nombre:'Vieja', marca:'Apple', modelo:'13', tipo:'Pantalla', codigo:'TP00099', cantidad:1 }]");
run("openRepuestoForm('r1')");
ok(els['rep2-fi-codigo'].value === 'TP00099', 'editando se ve su código');
run('openRepuestoForm()');
ok(els['rep2-fi-codigo'].value === '', 'y al abrir uno nuevo el campo queda vacío', els['rep2-fi-codigo'].value);
ok(els['rep2-form-save-otro'].style.display === '', 'el botón de cargar otro aparece dando de alta');
run("openRepuestoForm('r1')");
ok(els['rep2-form-save-otro'].style.display === 'none', 'y no aparece editando uno viejo');

console.log('\n4) Lo de siempre sigue igual');
ok(/Generar códigos de barras/.test(leer('app.js')), 'el menú sigue teniendo generar códigos para los que no tienen');
run('editingRepuestoId = null');
els['rep2-fi-nombre'].value = '';
await run('saveRepuesto()');
ok(TOASTS.some(t => /Ingresá el nombre/.test(t[1])), 'sin nombre no guarda', TOASTS[TOASTS.length - 1]);

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})().catch(e => { console.error('Error:', e); process.exit(1); });
