// Harness sin navegador para las estadísticas de reparaciones por período
// personalizado.
//
// Los botones fijos (mes, 30d, 90d, año) no alcanzan cuando querés mirar una
// quincena, una temporada o el año pasado entero. Ahora hay un rango a medida.
//
// Lo delicado: la app solo tiene en memoria los últimos REPAIRS_DIAS_VENTANA
// días. Un rango más viejo obliga a leer TODO el historial de Firestore. Esta
// prueba vigila que eso pase SOLO cuando de verdad hace falta: si el rango
// entra en la ventana, no se lee un solo documento.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
const leer = f => fs.readFileSync(DIR + f, 'utf8');

let fails = 0;
const ok = (c, l, x) => {
  console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x)));
  if (!c) fails++;
};

const els = {};
function el(id) {
  return els[id] = {
    id, value: '', textContent: '', innerHTML: '', scrollTop: 0, style: {}, dataset: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { f === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (f ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); },
    },
  };
}
['rstats-desde', 'rstats-hasta', 'rstats-custom-bar', 'rep-stats-body', 'rep-stats-modal']
  .forEach(id => el(id));

const TOASTS = [];
let LECTURAS = [];          // cada .get() sobre una colección
const ctx = {
  console, setTimeout: f => f(), clearTimeout,
  document: {
    getElementById: id => els[id] || null,
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
    body: { style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} } },
    documentElement: { classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} }, style: { setProperty(){} } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener(){} }), location: { href: '' } },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  navigator: { userAgent: 'node' },
  esc: s => String(s == null ? '' : s), fmt: n => '$' + n,
  toast: (m, t) => TOASTS.push([t || 'info', m]),
  searchMatch: () => false,
  firebase: { firestore: { FieldValue: { serverTimestamp: () => ({}) } } },
  db: {
    collection: nombre => {
      const q = { orderBy: () => q, where: () => q };
      q.get = async () => { LECTURAS.push(nombre); return { docs: [] }; };
      q.doc = () => ({ get: async () => ({ exists: false, data: () => ({}) }), update: async () => {}, set: async () => {} });
      return q;
    },
  },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('repairs.js'), ctx, { filename: 'repairs.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
run('buildRepairStatsHTML = () => "<div></div>";');   // el pintado no interesa acá

// Fecha local en YYYY-MM-DD. NO se puede usar toISOString(): es UTC, y en
// Argentina (UTC-3) un rango que termina a las 23:59 locales cae al dia
// siguiente en UTC, asi que las comparaciones daban corridas por un dia.
const iso = d => [d.getFullYear(),
                  String(d.getMonth() + 1).padStart(2, '0'),
                  String(d.getDate()).padStart(2, '0')].join('-');
const diasAtras = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const setRango = (desde, hasta) =>
  run(`_statsCustomFrom = '${desde}'; _statsCustomTo = '${hasta}';`);
const ventana = get('REPAIRS_DIAS_VENTANA');

console.log('\n1) Está el botón y su barra de fechas');
const html = leer('index.html');
ok(/data-period="custom"/.test(html), 'el botón "Elegir" está en la barra de períodos');
ok(/id="rstats-desde"/.test(html) && /id="rstats-hasta"/.test(html), 'y los dos campos de fecha');
ok(/id="rstats-custom-bar"[^>]*hidden/.test(html), 'la barra arranca escondida');
ok(/_statsCustomRapido\('semana'\)/.test(html), 'con atajos rápidos');

console.log('\n2) El rango define el período y su comparación');
setRango('2026-08-01', '2026-08-15');
const r = get("_periodRange('custom')");
ok(iso(new Date(r.from)) === '2026-08-01', 'arranca donde se pidió', iso(new Date(r.from)));
ok(iso(new Date(r.to)) === '2026-08-15', 'y termina donde se pidió', iso(new Date(r.to)));
// La comparación tiene que medir lo mismo y estar pegada antes: si no, el
// "vs anterior" compara peras con manzanas.
const largo     = new Date(r.to)     - new Date(r.from);
const largoPrev = new Date(r.prevTo) - new Date(r.prevFrom);
ok(Math.abs(largo - largoPrev) < 2000, 'el período anterior mide lo mismo', { largo, largoPrev });
ok(new Date(r.prevTo) < new Date(r.from), 'y termina justo antes del elegido');
ok(typeof r.label === 'string' && r.label.length > 3, 'el título muestra el rango', r.label);

console.log('\n3) CUPO: solo lee el historial si el rango se sale de la ventana');
setRango(iso(diasAtras(5)), iso(new Date()));
ok(get('_statsCustomNecesitaHistorial()') === false,
   `un rango de 5 días entra en los ${ventana} días que ya están en memoria`);

setRango(iso(diasAtras(ventana + 120)), iso(diasAtras(ventana + 90)));
ok(get('_statsCustomNecesitaHistorial()') === true,
   'un rango más viejo que la ventana sí necesita el historial');

// Borde: rango corto, pero cuya COMPARACIÓN se va para atrás. Sin contemplarlo,
// el "vs anterior" saldría en cero sin avisar.
setRango(iso(diasAtras(ventana - 5)), iso(diasAtras(1)));
ok(get('_statsCustomNecesitaHistorial()') === true,
   'si el período de comparación se sale, también lo pide');

console.log('\n4) El cambio de tab respeta eso');
(async () => {
  LECTURAS = [];
  setRango(iso(diasAtras(5)), iso(new Date()));
  await get("switchRepairStatsTab('custom')");
  ok(LECTURAS.length === 0, 'un rango corto NO lee nada de Firestore', LECTURAS);
  ok(!els['rstats-custom-bar'].classList.contains('hidden'), 'y muestra la barra de fechas');

  LECTURAS = [];
  setRango(iso(diasAtras(ventana + 200)), iso(diasAtras(ventana + 100)));
  await get("switchRepairStatsTab('custom')");
  ok(LECTURAS.includes('repairs'), 'un rango viejo sí trae el historial', LECTURAS);

  await get("switchRepairStatsTab('mes')");
  ok(els['rstats-custom-bar'].classList.contains('hidden'),
     'al volver a un período fijo se esconde la barra de fechas');

  console.log('\n5) No deja poner un rango dado vuelta');
  TOASTS.length = 0;
  els['rstats-desde'].value = '2026-08-20';
  els['rstats-hasta'].value = '2026-08-01';
  run('_statsCustomAplicar()');
  ok(TOASTS.some(t => /posterior/.test(t[1])), 'avisa si "Desde" es posterior a "Hasta"', TOASTS);

  TOASTS.length = 0;
  els['rstats-desde'].value = '';
  run('_statsCustomAplicar()');
  ok(TOASTS.length === 0, 'y con una fecha a medio cargar no molesta', TOASTS);

  console.log('\n6) Los atajos');
  run("_statsCustomRapido('trimestre')");
  const [aT, mT, dT] = els['rstats-desde'].value.split('-').map(Number);
  ok([1, 4, 7, 10].includes(mT), 'el trimestre arranca en ene/abr/jul/oct', mT);
  // El dia 01 es lo que agarra el bug de UTC: con toISOString() en Argentina
  // (UTC-3) daba el ultimo dia del mes anterior, corrido un dia para atras.
  ok(dT === 1, 'y arranca el dia 1, no el ultimo del mes anterior',
     els['rstats-desde'].value);
  ok(aT === new Date().getFullYear(), 'del anio corriente', aT);

  // El bug de verdad que tenia esto: _hoyISO() salia de toISOString(), que es
  // UTC. En Argentina (UTC-3) despues de las 21:00 la fecha UTC ya es la de
  // manana, asi que abrir las estadisticas de noche ponia "hasta" en el dia
  // siguiente. Con medianoche NO se nota, por eso hay que probar de noche.
  const noche = new Date(2026, 7, 18, 22, 30);
  ok(get('_fechaISO')(noche) === '2026-08-18',
     'una fecha de las 22:30 se formatea con el dia de HOY, no el de manana',
     get('_fechaISO')(noche));
  ok(noche.toISOString().slice(0, 10) === '2026-08-19',
     '(y se comprueba que toISOString si se iba al dia siguiente)');
  // Comparar _hoyISO() contra la fecha local en tiempo real solo fallaria si la
  // prueba corriera entre las 21:00 y medianoche. Se chequea el codigo, que es
  // determinista a cualquier hora.
  ok(/const _hoyISO = \(\) => _fechaISO\(new Date\(\)\);/.test(leer('repairs.js')),
     '_hoyISO sale de _fechaISO, no de toISOString');
  ok(!/rstats-(desde|hasta)'\)\.value = [a-z]+\.toISOString/.test(leer('repairs.js')),
     'ningun campo de fecha se llena con toISOString');

  run("_statsCustomRapido('semana')");
  const lunes = new Date(els['rstats-desde'].value + 'T12:00:00');
  ok(lunes.getDay() === 1, 'la semana arranca un lunes', els['rstats-desde'].value);

  run("_statsCustomRapido('anio-1')");
  const anioPasado = new Date().getFullYear() - 1;
  ok(els['rstats-desde'].value === anioPasado + '-01-01',
     'el año pasado arranca el 1 de enero', els['rstats-desde'].value);
  ok(els['rstats-hasta'].value === anioPasado + '-12-31',
     'y termina el 31 de diciembre', els['rstats-hasta'].value);

  console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
  process.exit(fails ? 1 : 0);
})();
