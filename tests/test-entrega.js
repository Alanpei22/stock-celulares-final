// "¿Se lleva el equipo?" — el modal que reemplazó a los tres confirm() del
// navegador, y el cobro de la caja que lo usa.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── DOM mínimo ──────────────────────────────────────────────
const els = {};
const el = (id, extra = {}) => els[id] = Object.assign({
  id, value: '', textContent: '', innerHTML: '', checked: false, style: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  closest() { return null; }, focus() {}, setAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
}, extra);

// Los del modal de entrega + los que necesita saveMov de caja.js
['tpent-overlay','tpent-modal','tpent-info','tpent-plata','tpent-wa','tpent-wa-wrap',
 'mov-fi-monto','mov-fi-desc','mov-sale-item-info','mov-btn-ingreso','mov-btn-egreso',
 'mov-hidden-cat','mov-hidden-metodo','mov-hidden-metodo2','mov-split-amt','mov-resumen-total',
 'mov-resumen-txt','mov-categorias','mov-cliente-tel','mov-cliente-nombre','mov-cliente-section',
 'mov-cliente-fields','mov-cliente-toggle','mov-step1-lbl','mov-step3-lbl','mov-save-btn',
 'mov-desc-suggest','mov-fi-usd','mov-fi-vuelto-pesos','mov-overlay','mov-modal','mov-delete-wrap',
 'repair-link-overlay','repair-link-modal','repair-link-info','split-section','btn-split-toggle',
 'vuelto-section','mov-recibido','vuelto-val','mov-dolares-section','mov-search','mov-search-clear',
].forEach(id => el(id));

let TOASTS = [];
const W = { adds: [], updates: [] };
const ctx = {
  console, setTimeout, clearTimeout, requestAnimationFrame: f => f(),
  document: {
    getElementById: id => els[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el('tmp'), addEventListener: () => {},
    body: { style: {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } },
    documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, style: { setProperty() {} } },
  },
  window: { addEventListener() {}, _DAKI_NAME: 'TechPoint', location: { href: '' },
            matchMedia: () => ({ matches: false, addEventListener() {} }),
            open: u => { ctx.__waUrl = u; } },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  navigator: { userAgent: 'node' },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({ __ts: 1 }) } } },
  BIZ_DATA: { dir: 'Urquiza 4741 L22', tel: '11 7239-2511', extra: 'Lun a Sáb 9 a 19' },
  __TOAST: (m, t) => TOASTS.push([t || 'info', m]),
  confirm: () => true, alert: () => {},
  _todayAR: () => '2026-08-20',
  getCurrentDolar: () => 1000, getDeviceId: () => 'test',
  upsertCliente: async () => {}, upsertSeguimientoPublico: r => { ctx.__SEG = r; },
  pushCambioEquipo: (r, f, e) => { ctx.__PUSH = { fase: f, estado: e }; },
  tgNotify: m => { ctx.__TG = m; }, tgMonto: n => '$' + n, tgHora: () => '10:00',
  requireAuth: () => Promise.resolve(null), showApp: () => {},
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const f of ['tp-fases.js', 'caja.js']) {
  vm.runInContext(fs.readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
}
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);

ctx.__DB = {
  collection: name => ({
    doc: id => ({
      update: async d => { W.updates.push([name, id, d]); },
      set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }), delete: async () => {},
    }),
    add: async d => { W.adds.push([name, d]); return { id: 'mov1' }; },
  }),
};
run(`
  db = __DB;
  MOVIMIENTOS = []; CIERRES_PARCIALES = [];
  ARQUEO = { vendedor: 'Alan' };
  currentDate = '2026-08-20';
  renderCatBtns = () => {};
  _markError = () => {};
  esc = s => String(s == null ? '' : s);
  fmt = n => '$' + Number(n || 0).toLocaleString('es-AR');
  normalizeText = s => String(s || '').toLowerCase();
  searchMatch = () => false;
  toast = (m, t) => __TOAST(m, t);
  WA_TEMPLATES = {};
`);

const REP = {
  id: 'r1', nOrden: 7100, nombre: 'Juan Pérez', tlf: '1155554433',
  marca: 'Samsung', modelo: 'Galaxy A54', arreglo: 'Pantalla',
  monto: 50000, sena: 10000, estado: 'listo', fase: 'listo',
  faseHist: [{ f: 'reparacion', t: '2026-08-18T10:00:00.000Z' }, { f: 'listo', t: '2026-08-19T10:00:00.000Z' }],
  estadoHistorial: [{ estado: 'reparando', fecha: '2026-08-18T10:00:00.000Z' }, { estado: 'listo', fecha: '2026-08-19T10:00:00.000Z' }],
  diasGarantia: 90,
};
ctx.__REP = REP;
const tick = () => new Promise(r => setImmediate(r));

(async () => {

console.log('\n1) El modal dice DE QUÉ equipo habla (el confirm() viejo no lo decía)');
let p = get('tpEntregaModal(__REP, { contexto: "cobro", cobra: 40000 })');
await tick();
ok(!els['tpent-modal'].classList.contains('hidden'), 'se abre');
const info = els['tpent-info'].innerHTML;
ok(/N°7100/.test(info), 'número de orden', info);
ok(/Samsung Galaxy A54/.test(info), 'marca y modelo');
ok(/Juan Pérez/.test(info), 'nombre del cliente');
const plata = els['tpent-plata'].innerHTML;
ok(/Cobrás.*40\.000/.test(plata), 'cuánto se está cobrando', plata);
ok(/Sin saldo pendiente/.test(plata), '40.000 + 10.000 de seña = los 50.000: no queda debiendo', plata);
ok(!els['tpent-wa-wrap'].classList.contains('hidden'), 'ofrece avisar por WhatsApp (hay teléfono)');
ok(els['tpent-wa'].checked === false, 'el aviso arranca destildado');

console.log('\n2) Las tres salidas están escritas y devuelven cosas distintas');
get('tpEntregaSi()');
let res = await p;
ok(res && res.entregado === true, '"Sí, se lo lleva" → entregado', res);
ok(els['tpent-modal'].classList.contains('hidden'), 'y cierra el modal');

p = get('tpEntregaModal(__REP, { contexto: "estado" })');
await tick(); get('tpEntregaNo()');
res = await p;
ok(res && res.entregado === false, '"No, queda en el local" → NO entregado', res);

p = get('tpEntregaModal(__REP, { contexto: "cobro", cobra: 40000 })');
await tick(); get('tpEntregaCancelar()');
res = await p;
ok(res === null, '"Volver" devuelve null: la acción entera se cancela', res);

console.log('\n3) El aviso por WhatsApp');
p = get('tpEntregaModal(__REP, { contexto: "estado" })');
await tick();
els['tpent-wa'].checked = true;
get('tpEntregaSi()');
res = await p;
ok(res.avisar === true, 'si lo tildás, lo pide');
// Sin teléfono no se ofrece
ctx.__SIN_TEL = { ...REP, tlf: '' };
p = get('tpEntregaModal(__SIN_TEL, { contexto: "estado" })');
await tick();
ok(els['tpent-wa-wrap'].classList.contains('hidden'), 'sin teléfono no ofrece el aviso');
get('tpEntregaNo()'); await p;

console.log('\n4) Saldo pendiente: lo dice antes de entregar');
ctx.__DEBE = { ...REP, monto: 50000, sena: 10000 };
p = get('tpEntregaModal(__DEBE, { contexto: "cobro", cobra: 15000 })');
await tick();
ok(/Queda debiendo.*25\.000/.test(els['tpent-plata'].innerHTML),
   'cobra 15.000 sobre 40.000 de saldo → debe 25.000', els['tpent-plata'].innerHTML);
get('tpEntregaNo()'); await p;

console.log('\n5) El parche de entrega mueve el ESTADO y la FASE');
// El confirm() viejo escribía solo el estado: la entrega no quedaba en el
// historial del tablero de fases.
const patch = get('tpEntregaPatch(__REP)');
ok(patch.estado === 'entregado', 'estado');
ok(!!patch.fechaEntrega, 'fecha de entrega');
ok(patch.estadoHistorial.length === 3 && patch.estadoHistorial[2].estado === 'entregado',
   'estadoHistorial +1', patch.estadoHistorial);
ok(patch.fase === 'entregado', 'fase → entregado  ← esto es lo que faltaba', patch.fase);
ok(Array.isArray(patch.faseHist) && patch.faseHist.length === 3 && patch.faseHist[2].f === 'entregado',
   'y queda en el historial de fases', patch.faseHist);

console.log('\n6) Cobrar desde la caja y entregar: una sola escritura, completa');
function nuevoCobro(monto) {
  TOASTS = []; W.adds = []; W.updates = [];
  run(`_cart = []; _selectedRepairItem = null; editingMovId = null; _splitActive = false; _movTipo = 'ingreso';
       _pendingRepairLink = __REP; _selectRepairMode('cobro');`);
  els['mov-fi-monto'].value = String(monto);
  els['mov-fi-desc'].value = 'Cobro reparación';
  els['mov-hidden-cat'].value = 'Reparación';
  els['mov-hidden-metodo'].value = 'Efectivo';
  els['mov-hidden-metodo2'].value = '';
  els['mov-btn-ingreso'].classList.add('tipo-active');
  els['tpent-wa'].checked = false;
  return get('saveMov()');
}
let save = nuevoCobro(40000);
await tick();
ok(!els['tpent-modal'].classList.contains('hidden'), 'al cobrar pregunta si se lo lleva');
get('tpEntregaSi()');
await save;
const upd = W.updates.find(u => u[0] === 'repairs');
ok(!!upd, 'actualiza la reparación', W.updates);
ok(upd[2].cobrado === true, 'cobrado');
ok(upd[2].estado === 'entregado', 'entregado');
ok(upd[2].fase === 'entregado', 'y la fase también  ← antes quedaba desfasada', upd[2].fase);
ok(Array.isArray(upd[2].faseHist), 'con su historial de fases');
ok(W.updates.filter(u => u[0] === 'repairs').length === 1, 'una sola escritura sobre la reparación (cupo)',
   W.updates.filter(u => u[0] === 'repairs').length);
ok(W.adds.some(a => a[0] === 'caja_movimientos'), 'y el ingreso entra en la caja');
ok(W.adds.some(a => a[0] === 'actividad' && /Entregado/.test(a[1].desc)),
   'la entrega queda en la campanita  ← antes no se registraba', W.adds.map(a => a[0]));
ok(!!ctx.__SEG && ctx.__SEG.estado === 'entregado', 'republica el seguimiento del QR');
ok(!!ctx.__PUSH && ctx.__PUSH.estado === 'entregado', 'avisa a los otros dispositivos');

console.log('\n7) "No, queda en el local": se cobra pero NO se entrega');
save = nuevoCobro(40000);
await tick(); get('tpEntregaNo()');
await save;
const upd7 = W.updates.find(u => u[0] === 'repairs');
ok(upd7 && upd7[2].cobrado === true, 'igual se cobra');
ok(upd7 && upd7[2].estado === undefined, 'pero el estado no se toca', upd7 && upd7[2].estado);
ok(W.adds.some(a => a[0] === 'caja_movimientos'), 'el movimiento entra igual');

console.log('\n8) "Volver": no se cobra NADA  ← esto antes no se podía');
// Con el confirm() viejo, apretar Cancelar igual registraba el cobro: lo
// único que hacía era no marcar entregado.
save = nuevoCobro(40000);
await tick(); get('tpEntregaCancelar()');
await save;
ok(W.adds.length === 0, 'no entra ningún movimiento en la caja', W.adds);
ok(W.updates.length === 0, 'no se toca la reparación', W.updates);

console.log('\n9) Si ya estaba entregado, no vuelve a preguntar');
ctx.__REP2 = { ...REP, estado: 'entregado', fase: 'entregado' };
TOASTS = []; W.adds = []; W.updates = [];
run(`_cart = []; _selectedRepairItem = null; editingMovId = null; _splitActive = false; _movTipo = 'ingreso';
     _pendingRepairLink = __REP2; _selectRepairMode('cobro');`);
els['mov-fi-monto'].value = '40000';
els['mov-fi-desc'].value = 'Cobro';
els['mov-hidden-cat'].value = 'Reparación';
els['mov-hidden-metodo'].value = 'Efectivo';
await get('saveMov()');
ok(W.adds.some(a => a[0] === 'caja_movimientos'), 'cobra directo, sin cartel');

console.log('\n10) El WhatsApp desde la caja sale con el número bien armado');
// tpWaFono vive en tp-fases.js justamente porque caja.html no carga
// repairs.js: antes, avisar desde la caja habría abierto un número sin 549.
ok(get(`tpWaFono('1155554433')`) === '5491155554433', '10 dígitos → 549 adelante', get(`tpWaFono('1155554433')`));
ok(get(`tpWaFono('01155554433')`) === '5491155554433', 'con el 0 de área también');
ok(get(`tpWaFono('5491155554433')`) === '5491155554433', 'si ya viene completo no lo toca');
ok(get(`tpWaFono('')`) === '', 'sin teléfono, vacío');
ctx.__ENT = { ...REP, estado: 'entregado', fase: 'entregado' };
ok(get('tpWaAbrir(__ENT)') === true, 'abre WhatsApp con el objeto (sin necesitar REPAIRS)');
ok(/wa\.me\/5491155554433/.test(ctx.__waUrl || ''), 'al número correcto', ctx.__waUrl);
ok(/garant/i.test(decodeURIComponent(ctx.__waUrl || '')), 'con el mensaje de la fase entregado', ctx.__waUrl);

console.log('\n11) Donde no está el modal, no se traba nada');
// estado.html y cualquier página sin el bloque HTML: tiene que seguir de largo.
const sinModal = { ...els['tpent-modal'] };
els['tpent-modal'] = null;
const r11 = await get('tpEntregaModal(__REP, {})');
ok(r11 && r11.entregado === false, 'devuelve "no entregado" en vez de colgarse', r11);
els['tpent-modal'] = sinModal;

console.log('\n12) Ya no queda ningún confirm() del navegador para esto');
const cajaSrc = fs.readFileSync(DIR + 'caja.js', 'utf8');
const repSrc  = fs.readFileSync(DIR + 'repairs.js', 'utf8');
ok(!/confirm\([^)]*se llev/i.test(cajaSrc), 'caja.js');
ok(!/confirm\([^)]*se llev/i.test(repSrc), 'repairs.js');
ok((repSrc.match(/tpEntregaModal\(/g) || []).length === 2,
   'los dos lugares de repairs.js usan el modal', (repSrc.match(/tpEntregaModal\(/g) || []).length);
['index.html', 'caja.html'].forEach(f => {
  const h = fs.readFileSync(DIR + f, 'utf8');
  ok(/id="tpent-modal"/.test(h) && /tpEntregaSi\(\)/.test(h), `${f} tiene el modal`);
});

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})();
