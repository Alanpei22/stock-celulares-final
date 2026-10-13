// Lo que queda sin imprimir cuando cargás desde el celular.
//
// La impresora no está en la nube: está atada al aparato. Qué impresora usar
// para cada cosa vive en el navegador de la compu que tiene QZ Tray, y un
// celular no tiene ninguna. Cargando un equipo desde el celular, antes salía
// el diálogo de impresión DEL CELULAR — un cartel que hay que cancelar — y de
// la etiquetadora del local no salía nada.
//
// Ahora queda anotado en la reparación, y la compu del mostrador lo muestra en
// una barra para imprimirlo de un toque.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// ── 1) print.js: decidir si este aparato imprime ──
(async () => {

console.log('\n1) ¿Este aparato puede imprimir?');
function conPantalla({ ancho, touch, qz }) {
  const ctx = {
    console, Math, JSON, Date, String, Number, Promise, setTimeout, clearTimeout,
    window: { matchMedia: q => ({ matches: /max-width/.test(q) && ancho <= 820 }) },
    navigator: { maxTouchPoints: touch ? 5 : 0 },
    document: { createElement: () => ({ style: {}, setAttribute() {}, remove() {},
                  addEventListener() {}, contentWindow: { document: { open() {}, write() {}, close() {} },
                  addEventListener() {}, focus() {}, print() {} } }),
                body: { appendChild() {} }, getElementById: () => null },
    qzActivo: t => !!(qz && qz[t]),
    esc: s => String(s == null ? '' : s),
  };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(leer('print.js'), ctx, { filename: 'print.js' });
  return e => vm.runInContext(e, ctx);
}

let r = conPantalla({ ancho: 1400, touch: false, qz: { hoja: 'HP', etiqueta: 'XP' } });
ok(r("_puedeImprimirAca('etiqueta')") === true, 'la compu con QZ, sí');
ok(r('_esCelular()') === false, 'y no es un celular');

r = conPantalla({ ancho: 1400, touch: false, qz: null });
ok(r("_puedeImprimirAca('hoja')") === true,
   'una compu SIN QZ también: ahí el diálogo del navegador sirve');

r = conPantalla({ ancho: 390, touch: true, qz: null });
ok(r('_esCelular()') === true, 'un celular se reconoce');
ok(r("_puedeImprimirAca('etiqueta')") === false,
   'y no intenta: el diálogo del celular no imprime en el local');

// Un celular con QZ no existe, pero si alguien lo configurara, manda QZ.
r = conPantalla({ ancho: 390, touch: true, qz: { etiqueta: 'XP' } });
ok(r("_puedeImprimirAca('etiqueta')") === true, 'si tuviera impresora configurada, imprime igual');

console.log('\n2) Qué queda pendiente');
// Las funciones devuelven lo que NO pudieron imprimir, para que se anote.
const pr = leer('print.js');
const etqFn = pr.slice(pr.indexOf('async function imprimirEtiquetaIngreso'),
                       pr.indexOf('async function imprimirEtiquetaIngreso') + 420);
ok(/return \{ etiqueta: true \}/.test(etqFn), 'el de gremio avisa que la etiqueta quedó pendiente');
const ingFn = pr.slice(pr.indexOf('async function imprimirIngresoReparacion'), pr.indexOf('function _imprimirTocando'));
ok(/pend\.hoja = true/.test(ingFn) && /pend\.etiqueta = true/.test(ingFn),
   'y el ingreso normal avisa por cada una de las dos');

console.log('\n3) La barra, solo donde hay impresora');
const els = {};
const el = id => els[id] = { id, innerHTML: '', className: '', style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, remove() { delete els[this.id]; } };
['rep-list', 'rep-empty', 'rep-search', 'rep-f-estado', 'rep-f-fecha', 'rep-sort'].forEach(el);
const selM = el('rep-f-marca');
selM.options = [{ value: '', textContent: 'Todas' }];
selM.remove = i => selM.options.splice(i, 1);
selM.appendChild = o => selM.options.push(o);

const ESCRITO = [];
let QZ = { etiqueta: 'XP' };
const IMPRESAS = [];
const ctx = {
  console, setTimeout: f => f(), clearTimeout, Date, Math, JSON, Set, Map, parseInt, parseFloat, isNaN,
  document: { getElementById: id => els[id] || null,
              querySelector: () => null, querySelectorAll: () => [],
              createElement: () => el('creada'), addEventListener() {},
              body: { style: {}, appendChild(n) { els[n.id] = n; },
                      classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
              documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: { setProperty() {} } } },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: '' } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node' },
  esc: s => String(s == null ? '' : s), fmt: n => '$' + Number(n || 0),
  toast: () => {}, confirm: () => true, searchMatch: () => true, _todayAR: () => '2026-10-13',
  qzActivo: t => !!QZ[t],
  printEtiquetasReparaciones: lista => IMPRESAS.push({ tipo: 'etiqueta', n: lista.length }),
  printRepair: () => IMPRESAS.push({ tipo: 'hoja', n: 1 }),
  db: { batch: () => ({ _c: [], update(ref, d) { this._c.push({ id: ref.__id, d }); },
                        commit: async function () { ESCRITO.push(...this._c); } }),
        collection: () => { const q = { where: () => q, orderBy: () => q, limit: () => q,
          onSnapshot: () => () => {}, get: async () => ({ docs: [], empty: true }),
          doc: id => ({ __id: id, update: async d => { ESCRITO.push({ id, d }); },
                        get: async () => ({ exists: false, data: () => ({}) }) }) }; return q; } },
  firebase: { firestore: { FieldValue: { serverTimestamp: () => ({}) } } },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('repairs.js'), ctx, { filename: 'repairs.js' });
const run = e => vm.runInContext(e, ctx);
const get = e => vm.runInContext(e, ctx);
run('updateNavBadge = () => {}; renderRepairs = () => {}; _repairsLoaded = true;');
run(`REPAIRS = [
  { id:'a', nOrden:1, marca:'Samsung', modelo:'A54', estado:'reparando', etiquetaPendiente: true },
  { id:'b', nOrden:2, marca:'Motorola', modelo:'G52', estado:'reparando' },
  { id:'c', nOrden:3, marca:'Xiaomi', modelo:'12C', estado:'reparando', etiquetaPendiente: true }
];`);

run('repPintarPendientes()');
ok(!!els['rep-pend-barra'], 'con la etiquetadora configurada, aparece la barra');
ok(/2 etiquetas/.test(els['rep-pend-barra'].innerHTML), 'y dice cuántas son', els['rep-pend-barra'].innerHTML.slice(0, 80));

// En el celular NO: ahí no hay con qué imprimir y sería un cartel al pedo.
QZ = {};
run('repPintarPendientes()');
ok(!els['rep-pend-barra'], 'en un aparato sin impresora no aparece');
QZ = { etiqueta: 'XP' };

console.log('\n4) Imprimir las pendientes');
run('repPintarPendientes()');
await run('repImprimirPendientes()');
ok(IMPRESAS.length === 1 && IMPRESAS[0].tipo === 'etiqueta' && IMPRESAS[0].n === 2,
   'las dos etiquetas salen en una tirada, no de a una', IMPRESAS);
ok(ESCRITO.filter(w => w.d && w.d.etiquetaPendiente === false).length === 2,
   'y quedan marcadas como impresas', ESCRITO);
run('repPintarPendientes()');
ok(!els['rep-pend-barra'], 'la barra se va');
ok(get("REPAIRS.filter(r => r.etiquetaPendiente === true).length") === 0,
   'no vuelven a salir la próxima vez', get("REPAIRS.map(r => r.etiquetaPendiente)"));

console.log('\n5) La hoja también');
// Un ingreso normal desde el celular deja las dos cosas pendientes.
IMPRESAS.length = 0; ESCRITO.length = 0;
QZ = { etiqueta: 'XP', hoja: 'HP' };
run("REPAIRS = [{ id:'d', nOrden:4, marca:'Apple', modelo:'13', estado:'reparando', etiquetaPendiente: true, hojaPendiente: true }];");
run('repPintarPendientes()');
ok(/1 etiqueta y 1 hoja/.test(els['rep-pend-barra'].innerHTML), 'la barra nombra las dos', els['rep-pend-barra'].innerHTML.slice(0, 90));
await run('repImprimirPendientes()');
ok(IMPRESAS.some(x => x.tipo === 'hoja') && IMPRESAS.some(x => x.tipo === 'etiqueta'), 'salen las dos', IMPRESAS);

console.log('\n6) La cruz calla, no borra');
// Si se borrara, el equipo se quedaría sin etiqueta y nadie se enteraría.
ESCRITO.length = 0;   // lo de la seccion anterior no cuenta
run("REPAIRS = [{ id:'e', nOrden:5, marca:'LG', modelo:'K40', estado:'reparando', etiquetaPendiente: true }];");
run('repPintarPendientes()');
run('repPendientesDespues()');
ok(!els['rep-pend-barra'], 'la cruz saca la barra');
ok(get("REPAIRS[0].etiquetaPendiente") === true, 'pero la etiqueta sigue pendiente');
ok(ESCRITO.length === 0, 'y no se escribió nada en la base', ESCRITO);

console.log('\n7) Enganchado al guardar');
const src = leer('repairs.js');
ok(/_anotarPendiente\(id, pend\)/.test(src), 'al guardar se anota lo que no se pudo imprimir');
const an = src.slice(src.indexOf('function _anotarPendiente'), src.indexOf('function _repPendientes'));
ok(/etiquetaPendiente = true/.test(an) && /hojaPendiente = true/.test(an), 'cada una por su lado', an.slice(0, 200));
ok(!/await db/.test(an), 'sin esperar a Firebase: el mostrador no se frena por esto');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})().catch(e => { console.error('Error:', e); process.exit(1); });
