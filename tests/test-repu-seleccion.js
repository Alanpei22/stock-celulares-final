// Seleccionar varios repuestos para imprimir o eliminar en masa.
//
// Alan rehace la lista de repuestos desde cero. Para vaciar la vieja, lo único
// que había era el botón de cada ficha (de a uno, doscientas veces) o borrar
// la colección desde la consola de Firebase, que es fuera de la app.
//
// Lo que se chequea acá es sobre todo que NO borre de más: que "Todos" tome
// los de la lista filtrada y no la colección entera, que un repuesto marcado
// no se abra para editar, y que borrar pase por el PIN.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = {};
const el = id => els[id] = {
  id, value: '', textContent: '', innerHTML: '', checked: false, style: {}, dataset: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  focus() {}, blur() {}, setAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  remove() { delete els[this.id]; },
};
['rep2-search', 'rep2-f-tipo', 'rep2-list', 'rep2-empty',
 'rep2-count', 'rep2-low-banner'].forEach(el);
// El select de marcas se rearma en cada dibujo: necesita options de verdad.
const selMarca = el('rep2-f-marca');
selMarca.options = [{ value: '', textContent: 'Todas' }];
selMarca.remove = i => selMarca.options.splice(i, 1);
selMarca.appendChild = o => selMarca.options.push(o);

const TOASTS = [], BORRADOS = [], IMPRESOS = [];
let CONFIRMA = true, PIN_PEDIDO = null, PROMPT = '1';

const ctx = {
  console, setTimeout: f => f(), clearTimeout, Date, Math, JSON, Number, String, Set,
  parseInt, parseFloat,
  document: {
    getElementById: id => els[id] || el(id),
    querySelector: () => null, querySelectorAll: () => [],
    createElement: id => el('creado-' + Math.random()),
    addEventListener() {},
    body: { style: {}, appendChild(n) { els[n.id] = n; },
            classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: '' } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node' },
  esc: s => String(s == null ? '' : s), fmt: n => '$' + Number(n || 0),
  toast: (m, t) => TOASTS.push([t || 'info', m]),
  confirm: () => CONFIRMA, alert: () => {}, prompt: () => PROMPT,
  searchMatch: (hay, q) => (Array.isArray(hay) ? hay.join(' ') : String(hay || ''))
                             .toLowerCase().includes(String(q || '').toLowerCase()),
  dolarBlue: 1200,
  openSheet: (titulo, items) => { ctx.__SHEET = { titulo, items }; },
  closeSheet: () => {},
  printEtiquetasRepuestos: (lista, copias) => IMPRESOS.push({ n: lista.length, copias }),
  // El PIN de dueño: se anota que lo pidió y se deja pasar.
  // Guarda la promesa del borrado para poder esperarla desde el test.
  requireOwnerPin: (cb, msg) => { PIN_PEDIDO = msg; ctx.__ESPERA = cb(); },
  db: { batch: () => ({ _d: [], delete(ref) { this._d.push(ref.__id); }, commit: async function () { BORRADOS.push(...this._d); } }),
        collection: () => ({ doc: id => ({ __id: id, update: async () => {}, delete: async () => {},
                                           get: async () => ({ exists: false, data: () => ({}) }) }) }) },
  firebase: { firestore: { FieldValue: { serverTimestamp: () => ({}) } } },
};
ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(leer('repuestos.js'), ctx, { filename: 'repuestos.js' });
const run = e => vm.runInContext(e, ctx);
const get = e => vm.runInContext(e, ctx);
run('toast = (m, t) => __T(m, t);');
ctx.__T = (m, t) => TOASTS.push([t || 'info', m]);

run(`REPUESTOS = [
  { id:'r1', nombre:'Pantalla A54', marca:'Samsung', modelo:'A54', tipo:'Pantalla', cantidad:3, codigo:'TP00001' },
  { id:'r2', nombre:'Pantalla 13',  marca:'Apple',   modelo:'13',  tipo:'Pantalla', cantidad:1, codigo:'TP00002' },
  { id:'r3', nombre:'Bateria A14',  marca:'Samsung', modelo:'A14', tipo:'Batería', cantidad:5, codigo:'TP00003' }
];`);

(async () => {

console.log('\n1) Entrar y marcar');
ok(/Seleccionar varios/.test(leer('app.js')), 'está en el menú de Repuestos');
run('repuSelEntrar()');
ok(get('_repuSelModo') === true, 'se entra al modo');
ok(!!els['rep2-sel-barra'], 'aparece la barra de abajo');
ok(els['rep2-list'].style.paddingBottom === '80px', 'y la lista deja lugar para que no tape el último');

run("_repuSelToggle('r1')");
ok(get('_repuSel.size') === 1, 'tocar uno lo marca');
run("_repuSelToggle('r1')");
ok(get('_repuSel.size') === 0, 'y tocarlo de nuevo lo desmarca');

// Marcado, la tarjeta no abre la ficha: si no, al marcar se te abre el
// formulario encima.
run("_repuSelToggle('r2'); renderRepuestos()");
ok(/_repuSelToggle\('r2'\)/.test(els['rep2-list'].innerHTML), 'marcado, tocar la tarjeta marca en vez de abrir');
ok(!/openRepuestoForm\('r2'\)/.test(els['rep2-list'].innerHTML), 'la ficha no se abre');
ok(!/changeQty\('r2'/.test(els['rep2-list'].innerHTML),
   'y los botones de cantidad no actúan mientras marcás');

console.log('\n2) "Todos" toma los de la lista que estás viendo');
// Es lo que evita borrar de más: filtrás Samsung y Todos marca esos, no los
// tres. Si tomara la colección entera, un filtro puesto sería una trampa.
run('repuSelSalir(); repuSelEntrar()');
els['rep2-f-marca'].value = 'Samsung';
run('repuSelTodos()');
ok(get('_repuSel.size') === 2, 'con un filtro puesto marca solo esos', get('[..._repuSel]'));
ok(get("_repuSel.has('r2')") === false, 'y no el que el filtro deja afuera');
run('repuSelTodos()');
ok(get('_repuSel.size') === 0, 'el mismo botón los desmarca');
els['rep2-f-marca'].value = '';
run('repuSelTodos()');
ok(get('_repuSel.size') === 3, 'sin filtro, marca todos');

console.log('\n3) Eliminar');
run('repuSelSalir(); repuSelEntrar()');
run("_repuSelToggle('r1'); _repuSelToggle('r3')");
run('repuSelAcciones()');
const acc = ctx.__SHEET;
ok(/2 repuestos/.test(acc.titulo), 'las acciones dicen cuántos van', acc.titulo);
const borrar = acc.items.find(i => i.label === 'Eliminar');
ok(!!borrar && borrar.danger === true, 'eliminar está, marcado como peligroso');

CONFIRMA = false;
run('repuSelEliminar()');
ok(BORRADOS.length === 0, 'si decís que no, no borra nada', BORRADOS);

CONFIRMA = true;
PIN_PEDIDO = null;
run('repuSelEliminar()');
await ctx.__ESPERA;
ok(PIN_PEDIDO && /PIN/.test(PIN_PEDIDO), 'pide el PIN de dueño antes de borrar', PIN_PEDIDO);
ok(BORRADOS.length === 2 && BORRADOS.includes('r1') && BORRADOS.includes('r3'),
   'borra los marcados y solo esos', BORRADOS);
ok(get('_repuSelModo') === false, 'y sale del modo al terminar');
ok(!els['rep2-sel-barra'], 'la barra se va');

console.log('\n4) Borrar de a cientos, en tandas');
// Firestore corta a las 500 escrituras por tanda: rehacer la lista entera son
// más que eso y una sola tanda fallaría a la mitad.
const src = leer('repuestos.js');
const bloque = src.slice(src.indexOf('async function _repuSelBorrar'), src.indexOf('function repuSelEliminar'));
ok(/i \+= 450/.test(bloque), 'se borra de a 450, no todo junto', bloque.slice(0, 200));
BORRADOS.length = 0;
run(`REPUESTOS = []; for (let i = 0; i < 1000; i++) REPUESTOS.push({ id: 'x' + i, nombre: 'R' + i, marca: 'M', tipo: 'Pantalla', cantidad: 1 });`);
run('repuSelEntrar(); repuSelTodos()');
await run('_repuSelBorrar(_repuSelLista())');
ok(BORRADOS.length === 1000, 'los mil se borran igual', BORRADOS.length);
run('repuSelSalir()');

console.log('\n5) Imprimir las etiquetas de los marcados');
run(`REPUESTOS = [
  { id:'r1', nombre:'Pantalla A54', marca:'Samsung', tipo:'Pantalla', cantidad:3, codigo:'TP00001' },
  { id:'r2', nombre:'Pantalla 13',  marca:'Apple',   tipo:'Pantalla', cantidad:1, codigo:'TP00002' }
];`);
run('repuSelEntrar()');
run("_repuSelToggle('r1')");
PROMPT = '2';
run('repuSelEtiquetas()');
ok(IMPRESOS.length === 1 && IMPRESOS[0].n === 1 && IMPRESOS[0].copias === 2,
   'imprime solo el marcado, con las copias que pediste', IMPRESOS);
run('repuSelSalir()');

console.log('\n6) La barra no queda flotando en otra pantalla');
// Está fija abajo de todo: cambiando de sección sin salir, quedaba encima de
// Equipos o Reparaciones.
ok(/section !== 'repuestos'[\s\S]{0,80}repuSelSalir\(\)/.test(leer('app.js')),
   'al cambiar de sección se sale del modo');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})().catch(e => { console.error('Error:', e); process.exit(1); });
