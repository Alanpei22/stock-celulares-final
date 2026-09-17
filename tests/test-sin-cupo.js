// Ingresar un equipo cuando Firebase no contesta.
//
// Pasó de verdad: se agotó el cupo diario de lecturas (se renueva a las 4 AM de
// acá) y la app no dejaba cargar un equipo nuevo. El motivo es que para dar el
// número de orden hay que LEER un contador, y leer estaba agotado.
//
// Con un cliente parado en el mostrador, "volvé mañana" no es una opción: el
// ingreso tiene que quedar guardado igual y subirse solo cuando se pueda.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const els = {};
const mk = id => els[id] = { id, value: '', textContent: '', innerHTML: '', checked: false, disabled: false,
  style: {}, dataset: {}, options: [{}], remove() {}, appendChild() {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  addEventListener() {}, focus() {}, select() {}, querySelector: () => null, querySelectorAll: () => [] };
['rep-form-save', 'rep-fi-orden', 'rep-fi-marca', 'rep-fi-modelo', 'rep-list', 'rep-empty', 'rep-search',
 'rep-f-estado', 'rep-f-marca', 'rep-f-fecha', 'rep-sort', 'rs-reparando', 'rs-listo', 'rs-demorados',
 'rs-devolver', 'rep-alcance'].forEach(mk);

const TOASTS = [];
const ESCRITURAS = [];       // lo que se mandó a Firestore
let CUPO_AGOTADO = false;    // simula el "resource-exhausted"
let SET_CUELGA = false;      // la escritura nunca resuelve

const err = (code) => Object.assign(new Error(code), { code });

const ctx = {
  console, Date, Math, JSON, Promise, Number, String, Set, Map,
  setTimeout: f => { f(); return 0; }, clearTimeout,
  document: {
    getElementById: id => els[id] || mk(id),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    body: { style: {}, classList: { add() {}, remove() {}, contains: () => false } },
  },
  window: { addEventListener() {} },
  navigator: { userAgent: 'node' },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  toast: (m, t) => TOASTS.push([t, m]),
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);

ctx.__DB = {
  collection: n => ({
    doc: id => ({
      id,
      set: async d => {
        if (CUPO_AGOTADO) throw err('resource-exhausted');
        if (SET_CUELGA) return new Promise(() => {});   // nunca resuelve
        ESCRITURAS.push([n, id, d]);
      },
      update: async () => {},
      get: async () => { if (CUPO_AGOTADO) throw err('resource-exhausted'); return { exists: false, data: () => ({}) }; },
    }),
    where: () => ({ limit: () => ({ get: async () => { if (CUPO_AGOTADO) throw err('resource-exhausted'); return { empty: true }; } }) }),
    add: async () => ({ id: 'x' }),
    orderBy: () => ({ get: async () => ({ docs: [], size: 0 }) }),
    onSnapshot: () => () => {},
  }),
  runTransaction: async fn => {
    if (CUPO_AGOTADO) throw err('resource-exhausted');
    return fn({ get: async () => ({ exists: true, data: () => ({ nextOrderNum: 7100 }) }), set: () => {} });
  },
};

vm.runInContext(fs.readFileSync(DIR + 'tp-fases.js', 'utf8'), ctx, { filename: 'tp-fases.js' });
vm.runInContext(fs.readFileSync(DIR + 'repairs.js', 'utf8'), ctx, { filename: 'repairs.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
run(`
  db = __DB;
  esc = s => String(s == null ? '' : s); fmt = n => '$' + n; fmtDate = s => s; fmtDateTime = s => s;
  timeAgo = () => ''; searchMatch = () => true; updateNavBadge = () => {};
  renderRepairs = () => {}; logActivity = () => {}; upsertSeguimientoPublico = () => {};
  upsertCliente = () => {}; pushEquipos = () => {}; tgNotify = () => {}; _showPrintPrompt = () => {};
  tgMonto = n => '$' + n; tgHora = () => '15:00';
  closeRepairForm = () => {}; _segNuevoToken = () => 'tok'; getDeviceId = () => 'celu';
  _cacheRepairs = () => {}; _refreshDashIfVisible = () => {};
`);

// Los datos del formulario que saveRepair lee del DOM
function cargarForm(orden) {
  els['rep-fi-orden'].value = orden ? String(orden) : '';
  run(`
    _repArreglos = [{ texto: 'Módulo', precio: 50000, hecho: false }];
    _repIngresoISO = () => '2026-09-17T15:00:00.000Z';
    readChecklist = () => ({}); _readGarantiaForm = () => 30;
    imeiConfirmar = () => true;
    document.getElementById = id => __els[id] || __mk(id);
  `);
}
ctx.__els = els; ctx.__mk = mk;

// Valores que saveRepair saca de los inputs
function campo(id, val) { (els[id] || mk(id)).value = val; }

(async () => {

// El formulario, con lo mínimo para que pase las validaciones
campo('rep-fi-marca', 'Samsung');
campo('rep-fi-modelo', 'A54');
cargarForm();
run(`REPAIRS = [{ id: 'viejo', nOrden: 7123, estado: 'reparando', fechaIngreso: '2026-09-01T10:00:00.000Z' }]`);

console.log('\n1) Con cupo: todo como siempre');
CUPO_AGOTADO = false; ESCRITURAS.length = 0; TOASTS.length = 0;
await get('saveRepair()');
let doc = (ESCRITURAS.find(e => e[0] === 'repairs') || [])[2];
ok(!!doc, 'guarda la reparación', ESCRITURAS.map(e => e[0]));
ok(doc.nOrden === 7100, 'con el número que da el contador de la base', doc && doc.nOrden);
ok(!doc.numeroProvisorio, 'sin marca de provisorio');
ok(get('_pendLeer()').length === 0, 'y no queda nada pendiente');

console.log('\n2) Sin cupo: el equipo entra igual');
// Esto es lo que antes tiraba "la reparación NO se guardó".
CUPO_AGOTADO = true; ESCRITURAS.length = 0; TOASTS.length = 0;
await get('saveRepair()');
const pend = get('_pendLeer()');
ok(pend.length === 1, 'queda guardado en el celu', pend.length);
ok(pend[0].marca === 'Samsung' && pend[0].modelo === 'A54', 'con los datos del equipo', pend[0] && pend[0].marca);
ok(pend[0].nOrden === 7124, 'número provisorio: el siguiente al más alto que tiene el celu', pend[0] && pend[0].nOrden);
ok(pend[0].numeroProvisorio === true, 'y marcado como provisorio, para revisarlo después');
ok(TOASTS.some(t => /guardada en el celu/.test(t[1])), 'el cartel dice que quedó guardado, no "error"', TOASTS);
ok(!els['rep-form-save'].disabled, 'el botón de guardar queda libre para el siguiente equipo');

console.log('\n3) Cuando Firebase vuelve, sube solo');
CUPO_AGOTADO = false; ESCRITURAS.length = 0; TOASTS.length = 0;
await get('_pendReintentar()');
doc = (ESCRITURAS.find(e => e[0] === 'repairs') || [])[2];
ok(doc && doc.nOrden === 7124, 'sube la reparación que había quedado', doc && doc.nOrden);
ok(get('_pendLeer()').length === 0, 'y se saca de la cola');
ok(TOASTS.some(t => /pendiente/.test(t[1])), 'avisa que subió', TOASTS);

console.log('\n4) Lo que ya está en la base no se sube dos veces');
run(`_pendGuardar({ id: 'viejo', nOrden: 7123 })`);
ESCRITURAS.length = 0;
await get('_pendReintentar()');
ok(ESCRITURAS.length === 0, 'la reparación que ya figura en la lista no se reescribe', ESCRITURAS);
ok(get('_pendLeer()').length === 0, 'y sale de la cola igual');

console.log('\n5) Si la escritura se cuelga, el mostrador sigue');
// Sin cupo, Firestore puede aceptar la escritura y no confirmarla nunca:
// el formulario no puede quedarse esperando con el cliente enfrente.
CUPO_AGOTADO = false; SET_CUELGA = true; TOASTS.length = 0;
let terminó = false;
const p = get('saveRepair()').then(() => { terminó = true; });
await p;
ok(terminó === true, 'saveRepair termina sin esperar la confirmación de Firebase');
ok(get('_pendLeer()').length === 1, 'y queda la copia local hasta que confirme', get('_pendLeer()').length);
SET_CUELGA = false;

console.log('\n6) El número repetido se sigue frenando');
CUPO_AGOTADO = true;   // sin base: se revisa contra lo que hay en el celu
run(`REPAIRS = [{ id: 'v2', nOrden: 7200, estado: 'reparando' }]`);
campo('rep-fi-orden', '7200');
TOASTS.length = 0;
const antes = get('_pendLeer()').length;
await get('saveRepair()');
ok(TOASTS.some(t => /Ya existe/.test(t[1])), 'avisa que el N° está usado', TOASTS);
ok(get('_pendLeer()').length === antes, 'y no lo guarda');
CUPO_AGOTADO = false;
campo('rep-fi-orden', '');

console.log('\n7) El mensaje viejo ya no aplica');
const src = fs.readFileSync(DIR + 'repairs.js', 'utf8');
ok(!/La reparación NO se guardó/.test(src), 'se fue el cartel que decía que no se había guardado');
ok(/_pendReintentar\(\)/.test(src) && /initRepairs/.test(src), 'y al abrir la app se reintenta lo pendiente');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
