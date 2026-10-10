// Los filtros de Reparaciones quedan como los dejaste.
//
// Estado, marca, fecha y orden se borraban al recargar la app o al volver de
// otra pantalla: si trabajabas mirando solo "Listo", tenías que volver a
// elegirlo cada vez. El alcance (30 días / todo historial) ya se guardaba;
// estos cuatro no.
//
// El riesgo de guardarlos es el contrario: abrís la app, ves tres equipos y
// pensás que se perdió todo. Por eso, con un filtro puesto y la lista vacía,
// el cartel lo dice y ofrece limpiarlos.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// ── Sandbox con repairs.js de verdad ────────────────────────
function arrancar(LS = {}) {
  const els = {};
  const opcion = (value, textContent) => ({ value, textContent });
  const el = (id, extra = {}) => els[id] = Object.assign({
    id, value: '', textContent: '', innerHTML: '', checked: false, style: {}, dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                 toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    focus() {}, blur() {}, select() {}, setAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, appendChild() {},
  }, extra);

  // El select de marcas se arma solo: necesita options de verdad.
  const selMarca = el('rep-f-marca');
  selMarca.options = [opcion('', 'Todas las marcas')];
  selMarca.remove = i => selMarca.options.splice(i, 1);
  selMarca.appendChild = o => selMarca.options.push(o);

  ['rep-search', 'rep-f-estado', 'rep-f-fecha', 'rep-sort', 'rep-alcance', 'rep-list',
   'rep-empty', 'rep-add-btn', 'rep-stats-btn'].forEach(id => el(id));

  const ctx = {
    console, setTimeout: f => f(), clearTimeout, Date, Math, JSON,
    document: {
      // initRepairs engancha media pantalla: lo que no se declaró arriba se
      // inventa al vuelo, así el test no tiene que listar 40 ids.
      getElementById: id => els[id] || el(id),
      querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ value: '', textContent: '' }),
      addEventListener() {},
      body: { style: {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
      documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: { setProperty() {} } },
    },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: '' } },
    localStorage: { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); } },
    navigator: { userAgent: 'node' },
    esc: s => String(s == null ? '' : s), fmt: n => '$' + Number(n || 0),
    toast: () => {}, confirm: () => true, alert: () => {},
    searchMatch: () => true, _todayAR: () => '2026-10-09',
    // Firestore de mentira: initRepairs engancha el listener de siempre.
    db: { collection: () => { const q = {
            where: () => q, orderBy: () => q, limit: () => q,
            onSnapshot: () => () => {},
            doc: () => ({ update: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }),
            get: async () => ({ docs: [] }),
          }; return q; } },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => ({}) } } },
  };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(leer('repairs.js'), ctx, { filename: 'repairs.js' });
  const run = e => vm.runInContext(e, ctx);
  // Lo que redibuja media pantalla y acá no existe.
  run('updateNavBadge = () => {}; renderRepStats = () => {}; _repPintar = () => {};');
  run('_repairsLoaded = true;');
  return { ctx, els, run, LS, marcas: () => selMarca.options.map(o => o.value) };
}

const EQUIPOS = `REPAIRS = [
  { id:'a', nOrden:1, nombre:'Juan',  marca:'Samsung', modelo:'A54', estado:'listo',
    arreglo:'Pantalla', monto:50000, fechaIngreso:'2026-10-08T12:00:00.000Z' },
  { id:'b', nOrden:2, nombre:'Ana',   marca:'Apple',   modelo:'13',  estado:'reparando',
    arreglo:'Bateria', monto:30000, fechaIngreso:'2026-10-08T12:00:00.000Z' },
  { id:'c', nOrden:3, nombre:'Pedro', marca:'Samsung', modelo:'A14', estado:'entregado',
    arreglo:'Pin', monto:20000, fechaIngreso:'2026-10-08T12:00:00.000Z' }
];`;

console.log('\n1) Lo que elegís queda guardado');
const a = arrancar();
a.run(EQUIPOS);
a.run('initRepairs()');
a.els['rep-f-estado'].value = 'listo';
a.els['rep-sort'].value = 'monto';
a.run('renderRepairs()');
const g = JSON.parse(a.LS['repFiltros'] || '{}');
ok(g.estado === 'listo' && g.sort === 'monto', 'estado y orden se guardan', g);
ok('marca' in g && 'fecha' in g, 'y los otros dos también, aunque estén vacíos', g);

// Lo que la app pone sola también cuenta: tocar "Demorados" en estadísticas
// es tan "dejarlo así" como elegirlo del desplegable.
a.run("_filterRepairsByEstado('demoradas')");
ok(JSON.parse(a.LS['repFiltros']).estado === 'demorado',
   'un filtro que pone la app sola también queda', a.LS['repFiltros']);

// El buscador NO: se escribe para una búsqueda puntual.
a.els['rep-search'].value = 'juan';
a.run('renderRepairs()');
ok(!('busqueda' in JSON.parse(a.LS['repFiltros'])), 'el texto del buscador no se guarda',
   a.LS['repFiltros']);

console.log('\n2) Al volver a abrir, están puestos');
const b = arrancar({ repFiltros: JSON.stringify({ estado: 'listo', marca: '', fecha: 'mes', sort: 'monto' }) });
b.run(EQUIPOS);
b.run('initRepairs()');
ok(b.els['rep-f-estado'].value === 'listo', 'el estado vuelve', b.els['rep-f-estado'].value);
ok(b.els['rep-f-fecha'].value === 'mes', 'la fecha también', b.els['rep-f-fecha'].value);
ok(b.els['rep-sort'].value === 'monto', 'y el orden', b.els['rep-sort'].value);
ok(b.els['rep-search'].value === '', 'el buscador arranca vacío', b.els['rep-search'].value);

console.log('\n3) La marca espera a que existan sus opciones');
// Las marcas se arman con los equipos que llegaron de Firestore: en el primer
// dibujo el desplegable tiene una sola opción ("Todas"). Si la marca guardada
// se aplicara ahí nomás, se perdía.
const c = arrancar({ repFiltros: JSON.stringify({ estado: '', marca: 'Apple', fecha: '', sort: '' }) });
c.run('initRepairs()');
ok(c.els['rep-f-marca'].value === '', 'antes de que lleguen los equipos no hay nada que elegir');
c.run(EQUIPOS);
c.run('renderRepairs()');
ok(c.marcas().includes('Apple'), 'llegan los equipos y se arma la lista de marcas', c.marcas());
ok(c.els['rep-f-marca'].value === 'Apple', 'ahí sí queda elegida la guardada', c.els['rep-f-marca'].value);
// Y filtra de verdad en ese mismo dibujo, no en el siguiente.
ok(/Ana/.test(c.els['rep-list'].innerHTML) && !/Juan/.test(c.els['rep-list'].innerHTML),
   'y la lista ya sale filtrada por esa marca');

// Una marca que ya no existe (se borró el último equipo de esa marca) no
// puede dejar la lista vacía para siempre.
const d = arrancar({ repFiltros: JSON.stringify({ estado: '', marca: 'Motorola', fecha: '', sort: '' }) });
d.run(EQUIPOS);
d.run('initRepairs()');
d.run('renderRepairs()');
ok(d.els['rep-f-marca'].value === '', 'una marca que ya no existe se suelta', d.els['rep-f-marca'].value);
ok(/Juan/.test(d.els['rep-list'].innerHTML), 'y la lista vuelve a mostrarse');
// Y si más tarde entra un equipo de esa marca, NO tiene que saltar a
// filtrarla: ese filtro ya lo soltó y el usuario no pidió nada.
d.run("REPAIRS.push({ id:'z', nOrden:9, nombre:'Luis', marca:'Motorola', modelo:'G54', estado:'listo', arreglo:'Pin', monto:1, fechaIngreso:'2026-10-08T12:00:00.000Z' })");
d.run('renderRepairs()');
ok(d.els['rep-f-marca'].value === '' && /Juan/.test(d.els['rep-list'].innerHTML),
   'y aunque después entre un equipo de esa marca, no salta a filtrarla sola',
   d.els['rep-f-marca'].value);

console.log('\n4) Si el filtro tapa todo, lo dice');
// Es el riesgo de que queden puestos: abrís la app, ves vacío y pensás que se
// perdió todo. Decir "No hay reparaciones registradas" ahí sería mentira.
const e = arrancar({ repFiltros: JSON.stringify({ estado: 'no va', marca: '', fecha: '', sort: '' }) });
e.run(EQUIPOS);
e.run('initRepairs()');
e.run('renderRepairs()');
const html = e.els['rep-list'].innerHTML;
ok(/filtros puestos/.test(html), 'avisa que es por los filtros', html.slice(0, 200));
ok(/repLimpiarFiltros\(\)/.test(html), 'y ofrece limpiarlos');
ok(e.els['rep-empty'].style.display === 'none', 'sin el cartel de "no hay reparaciones", que mentiría');

e.run('repLimpiarFiltros()');
ok(e.els['rep-f-estado'].value === '' && e.els['rep-f-marca'].value === '' &&
   e.els['rep-f-fecha'].value === '', 'limpiar los borra');
ok(/Juan/.test(e.els['rep-list'].innerHTML), 'y vuelven a aparecer los equipos');
ok(JSON.parse(e.LS['repFiltros']).estado === '', 'limpio también queda guardado', e.LS['repFiltros']);

// Sin filtros y sin equipos, el cartel de siempre.
const f = arrancar();
f.run('REPAIRS = [];');
f.run('initRepairs()');
f.run('renderRepairs()');
ok(!/filtros puestos/.test(f.els['rep-list'].innerHTML),
   'sin filtros no habla de filtros', f.els['rep-list'].innerHTML.slice(0, 120));

console.log('\n5) El alcance sigue guardándose aparte');
// Ya andaba así: se deja como estaba para no cambiar lo que funciona.
ok(/_REP_ALCANCE_KEY/.test(leer('repairs.js')), 'el alcance tiene su propia clave');
ok(leer('repairs.js').includes("const _REP_FILTROS_KEY = 'repFiltros'"),
   'y los filtros la suya, sin pisarse');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
