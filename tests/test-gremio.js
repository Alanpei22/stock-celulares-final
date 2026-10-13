// Equipos de gremio: los que trae otro taller.
//
// Van con el MISMO contador de órdenes, porque son una reparación más del
// local y tienen que entrar en la misma serie. Lo que no llevan es la hoja
// A5: esa tiene las condiciones de servicio, la garantía y la firma del
// cliente de mostrador. Al colega del taller no le sirve y es una hoja
// desperdiciada en cada ingreso — solo hace falta la etiqueta que queda
// pegada al equipo.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = {};
const el = id => els[id] = {
  id, value: '', textContent: '', innerHTML: '', checked: false, placeholder: '', style: {}, dataset: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  focus() {}, blur() {}, setAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], closest: () => null, remove() {},
};
['rep-fi-gremio', 'rep-lbl-nombre', 'rep-fi-nombre', 'rep-f-estado',
 'rep-f-fecha', 'rep-sort', 'rep-search', 'rep-list', 'rep-empty'].forEach(el);
// El select de marcas se rearma en cada dibujo: necesita options de verdad.
const selMarca = el('rep-f-marca');
selMarca.options = [{ value: '', textContent: 'Todas' }];
selMarca.remove = i => selMarca.options.splice(i, 1);
selMarca.appendChild = o => selMarca.options.push(o);

const ctx = {
  console, setTimeout: f => f(), clearTimeout, Date, Math, JSON, Set, Map,
  parseInt, parseFloat, isNaN,
  document: {
    getElementById: id => els[id] || el(id),
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el('tmp'), addEventListener() {},
    body: { style: {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
    documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: { setProperty() {} } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: '' } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node' },
  esc: s => String(s == null ? '' : s), fmt: n => '$' + Number(n || 0),
  toast: () => {}, confirm: () => true, alert: () => {}, searchMatch: () => true,
  _todayAR: () => '2026-10-13',
  db: { collection: () => { const q = { where: () => q, orderBy: () => q, limit: () => q,
          onSnapshot: () => () => {}, get: async () => ({ docs: [], empty: true }),
          doc: () => ({ update: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }; return q; } },
  firebase: { firestore: { FieldValue: { serverTimestamp: () => ({}) } } },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('repairs.js'), ctx, { filename: 'repairs.js' });
const run = e => vm.runInContext(e, ctx);
const get = e => vm.runInContext(e, ctx);
run('updateNavBadge = () => {}; renderRepStats = () => {}; _repPintar = () => {}; _repairsLoaded = true;');

console.log('\n1) El tilde en el formulario');
ok(/id="rep-fi-gremio"/.test(leer('index.html')), 'está el tilde de "Equipo de gremio"');
ok(/Al guardar sale solo la etiqueta/.test(leer('index.html')),
   'y dice lo que cambia, para no tener que acordarse');

// El "cliente" de un equipo de gremio es el taller, no una persona.
els['rep-fi-gremio'].checked = false;
run('repGremioToggle()');
ok(els['rep-lbl-nombre'].textContent === 'Nombre del cliente', 'sin tildar dice "cliente"', els['rep-lbl-nombre'].textContent);
els['rep-fi-gremio'].checked = true;
run('repGremioToggle()');
ok(els['rep-lbl-nombre'].textContent === 'Taller / colega', 'tildado, el campo pasa a ser el taller', els['rep-lbl-nombre'].textContent);
ok(/taller/i.test(els['rep-fi-nombre'].placeholder), 'y el ejemplo acompaña', els['rep-fi-nombre'].placeholder);
ok(get('repEsGremio()') === true, 'y la app sabe que es de gremio');

console.log('\n2) Al guardar, SOLO la etiqueta');
// Es el punto de todo esto: la hoja A5 es para el cliente de mostrador.
const src = leer('repairs.js');
const bloque = src.slice(src.indexOf('// De gremio sale solo la etiqueta'), src.indexOf('// De gremio sale solo la etiqueta') + 600);
ok(bloque.includes('gremio'), 'al guardar se fija si es de gremio', bloque.slice(0, 160));
ok(/imprimirEtiquetaIngreso\(newDoc\)/.test(bloque), 'y manda solo la etiqueta');
ok(/imprimirIngresoReparacion\(newDoc\)/.test(bloque), 'mientras que uno normal sigue sacando la hoja y la etiqueta');

const pr = leer('print.js');
const fn = pr.slice(pr.indexOf('async function imprimirEtiquetaIngreso'), pr.indexOf('async function imprimirEtiquetaIngreso') + 400);
ok(/_etiquetaRepHtml/.test(fn), 'la etiqueta es la misma de siempre', fn.slice(0, 200));
ok(!/_buildA5/.test(fn), 'y no arma la hoja A5');
// Al guardar ya se esperó a la base: una ventana nueva la bloquea Chrome.
ok(/_imprimirDirecto/.test(fn) && /_imprimirEnIframe/.test(fn),
   'sale por la impresora directa, y si no, por un iframe escondido');

console.log('\n3) Es una reparación más: mismo N° de orden');
// No hay contador aparte ni prefijo: si la N°1287 fue de gremio, la que sigue
// es la 1288 igual. Mezclar dos series es lo que rompe la numeración.
ok(!/gremioOrden|ordenGremio|contadorGremio/i.test(src), 'no hay un contador de órdenes aparte');
const guardado = src.slice(src.indexOf('const newDoc = {'), src.indexOf('const newDoc = {') + 1400);
ok(/\bgremio\b/.test(guardado), 'el campo se guarda en la reparación', /gremio/.test(guardado));
ok(/_numeroDeOrden\(ordenInputVal\)/.test(src), 'y el número sale del mismo lugar de siempre');

console.log('\n4) Se distinguen en la lista');
run(`REPAIRS = [
  { id:'a', nOrden:1, marca:'Samsung', modelo:'A54', estado:'reparando', arreglo:'Pantalla', nombre:'Juan',  fechaIngreso:'2026-10-12T12:00:00Z' },
  { id:'b', nOrden:2, marca:'Motorola', modelo:'G52', estado:'reparando', arreglo:'Pin',     nombre:'Taller Luis', gremio:true, fechaIngreso:'2026-10-12T12:00:00Z' }
];`);
els['rep-f-estado'].value = '';
run('renderRepairs()');
ok(/Gremio/.test(els['rep-list'].innerHTML), 'el de gremio lleva su chip en la tarjeta');
ok((els['rep-list'].innerHTML.match(/Gremio/g) || []).length === 1, 'y el otro no', (els['rep-list'].innerHTML.match(/Gremio/g) || []).length);

// El filtro: para pasarle la cuenta al colega sin ir uno por uno.
ok(/value="gremio"/.test(leer('index.html')), 'está el filtro "De gremio"');
els['rep-f-estado'].value = 'gremio';
run('renderRepairs()');
ok(/G52/.test(els['rep-list'].innerHTML) && !/A54/.test(els['rep-list'].innerHTML),
   'filtrando por gremio salen solo esos');
els['rep-f-estado'].value = '';
run('renderRepairs()');
ok(/A54/.test(els['rep-list'].innerHTML) && /G52/.test(els['rep-list'].innerHTML), 'y sin filtro, los dos');

console.log('\n5) El tilde no se arrastra de un ingreso al otro');
// Cargás uno de gremio y después uno de mostrador: si quedara tildado, el
// cliente se va sin su comprobante.
ok(/greN\.checked = false/.test(src), 'al abrir una reparación nueva arranca destildado');
ok(/gre\.checked = !!r\.gremio/.test(src), 'y editando una vieja se ve como estaba');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
