// El costo del repuesto: cuándo es gasto y contra qué.
//
// Decisión de Alan: el repuesto es gasto CUANDO SE USA, y en una reparación
// eso es al cobrarla. Hasta acá la app lo anotaba como un egreso de caja EN
// EFECTIVO aparte, y eso rompía dos cosas distintas:
//
//  · El cierre de caja esperaba menos efectivo del que había. De la caja no
//    salió un peso ese día: el repuesto se pagó cuando se compró, semanas
//    antes. Cinco reparaciones con $10.000 de repuesto = $50.000 de sobrante
//    todos los días.
//  · El tablero mostraba la reparación como pérdida. El ingreso del cobro no
//    guardaba ganancia, así que una de $40.000 con $10.000 de repuesto
//    figuraba −$10.000 en vez de +$30.000: cuantas más reparaciones, más roja
//    la pantalla.
//
// Ahora el costo va contra la ganancia de ESA reparación y no toca el
// efectivo. El informe de finanzas (finanzas-report.js) ya lo calculaba así:
// eran dos números distintos para lo mismo.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// ── El entorno de mentira ─────────────────────────────────
function armar(rep) {
  const els = {};
  const el = id => els[id] = {
    id, value: '', textContent: '', innerHTML: '', checked: false, style: {}, dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                 toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    focus() {}, blur() {}, select() {}, setAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, appendChild() {},
  };
  ['cobro-overlay', 'cobro-modal', 'cobro-monto-label', 'cobro-desc-label', 'cobro-sena-info',
   'cobro-articulos', 'va-buscar', 'va-sug', 'va-lineas', 'rep-list', 'rep-empty'].forEach(el);
  const W = { set: [], update: [] };
  const ctx = {
    console, setTimeout: f => f(), clearTimeout, Date, Math, JSON, Set, Map,
    parseInt, parseFloat, isNaN,
    document: { getElementById: id => els[id] || el(id),
                querySelector: () => null, querySelectorAll: () => [],
                createElement: () => el('tmp'), addEventListener() {},
                body: { style: {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
                documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: { setProperty() {} } } },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: '' } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'node' },
    esc: s => String(s == null ? '' : s), fmt: n => '$' + Number(n || 0),
    _todayAR: () => '2026-10-23',
    toast: () => {}, searchMatch: () => false, confirm: () => true, alert: () => {},
    firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({ __ts: true }),
                                           delete: () => ({ __del: true }) } } },
    db: {
      batch: () => ({
        set: (ref, d) => { W.set.push({ col: ref.__col, data: d }); },
        update: (ref, d) => { W.update.push({ col: ref.__col, id: ref.__id, data: d }); },
        commit: async () => {},
      }),
      collection: n => ({
        onSnapshot: cb => { cb({ docs: [] }); return () => {}; },
        doc: id => ({ __col: n, __id: id,
          update: async d => { W.update.push({ col: n, id, data: d }); },
          get: async () => ({ exists: false, data: () => ({}) }) }),
      }),
    },
  };
  ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(leer('repairs.js'), ctx, { filename: 'repairs.js' });
  vm.runInContext(leer('venta-articulos.js'), ctx, { filename: 'venta-articulos.js' });
  const run = e => vm.runInContext(e, ctx);
  run('logActivity = () => {}; _repPatchLocal = () => {}; renderRepairs = () => {}; updateNavBadge = () => {};');
  ctx.__REP = rep;
  run('REPAIRS = [__REP];');
  return { run, W, els, ctx };
}

// Una pantalla de $50.000 con $18.000 de repuesto y una seña de $20.000.
const REP = { id: 'r1', nOrden: 1301, nombre: 'Juan', marca: 'Samsung', modelo: 'A54',
              arreglo: 'Pantalla', monto: 50000, sena: 20000, costo: 18000, estado: 'listo' };

(async () => {

console.log('\n1) El costo no sale de la caja');
let t = armar({ ...REP });
t.run('openCobroModal(__REP)');
await t.run('confirmarCobro()');
const movs = t.W.set.filter(w => w.col === 'caja_movimientos');
ok(movs.length === 1, 'el cobro deja UN solo movimiento', movs.map(m => m.data.tipo + ' ' + m.data.monto));
ok(!movs.some(m => m.data.tipo === 'egreso'),
   'ninguno es un egreso: el repuesto se pagó cuando se compró, no hoy', movs.map(m => m.data.tipo));
// Esto es lo que arregla el sobrante del cierre: el efectivo esperado sale de
// los movimientos en efectivo (_getCierreEsperado en caja.js), y ya no hay un
// egreso fantasma restando.
ok(!/categoria: 'Repuesto'/.test(leer('repairs.js')),
   'y el egreso automático se fue del código');

console.log('\n2) La ganancia queda en la reparación');
const mov = movs[0];
ok(mov.data.monto === 30000, 'se cobra el saldo (50.000 − 20.000 de seña)', mov.data.monto);
// La ganancia es la de la ORDEN, no la del saldo: la seña ya entró antes, en
// su propio movimiento y sin ganancia. Por eso puede ser mayor que el monto.
ok(mov.data.gananciaARS === 32000, 'la ganancia es la de la orden entera (50.000 − 18.000)', mov.data.gananciaARS);
ok(mov.data.costoARSTotal === 18000, 'y queda anotado el costo', mov.data.costoARSTotal);
ok(mov.data.gananciaARS > mov.data.monto, 'puede ser mayor que el monto, y está bien');

console.log('\n3) Sin costo cargado no se inventa ganancia');
t = armar({ ...REP, costo: 0 });
t.run('openCobroModal(__REP)');
await t.run('confirmarCobro()');
const m0 = t.W.set.find(w => w.col === 'caja_movimientos');
ok(m0.data.gananciaARS === 50000, 'sin costo, la ganancia es todo lo cobrado', m0.data.gananciaARS);
ok(m0.data.sinCosto === true, 'pero queda marcada para poder revisarla', m0.data);
ok(!t.W.set.some(w => w.data && w.data.sinCosto && w.data.tipo === 'egreso'), 'y tampoco hay egreso');

console.log('\n4) Borrar el cobro destraba la orden');
// Antes el movimiento no llevaba la marca `esCobro`, así que borrarlo desde la
// caja dejaba la orden diciendo "cobrada" con la plata ya borrada. La marca la
// ponía solo el cobro hecho DESDE la caja, no este.
ok(mov.data.esCobro === true, 'el cobro queda marcado como cobro', mov.data.esCobro);
ok(mov.data.repairId === 'r1', 'y con la orden que le corresponde');
const caja = leer('caja.js');
const borrar = caja.slice(caja.indexOf('function deleteMov'), caja.indexOf("function deleteMov") + 9000);
ok(/movData\.esCobro && movData\.repairId/.test(borrar) && /cobrado: false/.test(borrar),
   'y la caja usa esa marca para destrabarla al borrar');

console.log('\n5) Con artículos en el mismo cobro');
t = armar({ ...REP });
t.run('openCobroModal(__REP)');
// Un vidrio de 4.500 que costó 1.500, puesto a mano en el bloque de artículos.
t.run("VA_ITEMS = [{ source:'producto', id:'p9', nombre:'Vidrio', precio:4500, costoARS:1500, qty:1, stock:5 }]");
await t.run('confirmarCobro()');
const mix = t.W.set.find(w => w.col === 'caja_movimientos');
ok(mix.data.monto === 34500, 'cobra el saldo más el artículo', mix.data.monto);
ok(mix.data.gananciaARS === 35000, 'y suma las dos ganancias (32.000 + 3.000)', mix.data.gananciaARS);
ok(mix.data.costoARSTotal === 19500, 'con los dos costos (18.000 + 1.500)', mix.data.costoARSTotal);
ok(mix.data.montoReparacion === 30000 && mix.data.montoProductos === 4500,
   'y las partes separadas, como las ventas mixtas de la caja', mix.data);

console.log('\n6) El tablero lo lee igual que cualquier venta');
// El tablero suma gananciaARS de los ingresos y le resta los egresos. Antes
// la reparación aportaba 0 a la suma y su repuesto restaba como egreso.
const app = leer('app.js');
ok(/const gan\s*=\s*m\s*=>\s*\(Number\(m\.gananciaARS\) \|\| 0\)/.test(app),
   'el tablero sigue leyendo el mismo campo', (app.match(/const gan .*/) || [])[0]);
ok(/ganancia \+= Number\(m\.gananciaARS\) \|\| 0/.test(leer('api/cron-resumen-diario.js')),
   'y el resumen diario de Telegram también');

console.log('\n7) Venta de equipo sin el costo cargado');
// La cuenta vive aparte y sin DOM porque es plata: _ventaEqGanancia en caja.js.
const cajaCtx = { console, Math, Number, Object, String };
cajaCtx.globalThis = cajaCtx;
vm.createContext(cajaCtx);
vm.runInContext(caja.slice(caja.indexOf('function _ventaEqGanancia'),
                           caja.indexOf('async function confirmVentaEquipo')),
                cajaCtx, { filename: 'caja.js' });
const gan = (...a) => { cajaCtx.__a = a; return vm.runInContext('_ventaEqGanancia(...__a)', cajaCtx); };

let g = gan(520000, 400000, 0, 0, true);
ok(g.gananciaARS === 120000 && g.costoARSTotal === 400000, 'con costo, la ganancia del equipo', g);

// Sin costo no se cuenta el precio del equipo como ganancia: sería mentir
// para el lado caro.
g = gan(520000, 0, 0, 0, true);
ok(g.gananciaARS === undefined, 'sin costo no se inventa la ganancia del equipo', g);
ok(g.sinCosto === true, 'y el equipo queda marcado para cargarlo', g);

// Lo que estaba mal: con el equipo sin costo se perdía TAMBIÉN la ganancia de
// la funda y el vidrio de la misma venta, que sí se conoce.
g = gan(520000, 0, 12500, 4000, true);
ok(g.gananciaARS === 8500, 'la ganancia de los artículos no se pierde', g);
ok(g.costoARSTotal === 4000, 'con su costo', g);
ok(g.sinCosto === true, 'y el equipo sigue marcado', g);

g = gan(520000, 400000, 12500, 4000, true);
ok(g.gananciaARS === 128500 && g.costoARSTotal === 404000, 'con todo cargado, se suman', g);

g = gan(0, 0, 12500, 4000, false);
ok(!g.sinCosto && g.gananciaARS === 8500, 'una venta sin equipo del stock no se marca', g);

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})().catch(e => { console.error('Error:', e); process.exit(1); });
