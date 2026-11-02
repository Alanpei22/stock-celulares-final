// El ingreso de una reparación no se pierde por un toque sin querer.
//
// Pasaba en el mostrador: cargando un equipo, un toque al costado del
// formulario (en el fondo oscuro) lo cerraba y se iba todo lo escrito:
// cliente, falla, seña. Lo que se cuida acá:
//  · tocar el fondo ya no cierra el ingreso;
//  · la ✕, Cancelar y Escape preguntan antes, si ya escribiste algo;
//  · si no escribiste nada, cierran directo (no molesta);
//  · lo que la app carga sola al abrir no cuenta como "escrito";
//  · guardar cierra directo, sin preguntar.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = {};
const mk = id => els[id] = els[id] || {
  id, value: '', style: {}, dataset: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  classList: { _s: new Set(['hidden']), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle() {} },
};
let RESPUESTA = true, PREGUNTAS = 0;
const ctx = {
  console, Date, Math, JSON, Promise, Number, String, Set, Map,
  setTimeout: () => 0, clearTimeout() {},
  document: {
    getElementById: id => mk(id), querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    body: { style: {}, classList: { add() {}, remove() {}, contains: () => false } },
  },
  window: { addEventListener() {} }, navigator: { userAgent: 'node' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  confirm: () => { PREGUNTAS++; return RESPUESTA; },
  toast() {},
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('tp-fases.js'), ctx, { filename: 'tp-fases.js' });
vm.runInContext(leer('repairs.js'), ctx, { filename: 'repairs.js' });
const run = c => vm.runInContext(c, ctx);
const abierto = () => !els['rep-form-modal'].classList.contains('hidden');
const abrir = () => { mk('rep-form-modal').classList.remove('hidden'); run('_repFormTocado = false'); };

console.log('\n1) Tocar el fondo ya no cierra');
const src = leer('repairs.js');
const init = src.slice(src.indexOf("getElementById('rep-form-close')"), src.indexOf("getElementById('rep-form-close')") + 1200);
ok(!/rep-form-modal'\)\s*closeRepairForm/.test(src), 'no queda el "click en el fondo → cerrar"');
ok(/'rep-form-close'\)\.addEventListener\('click', pedirCerrarRepairForm\)/.test(init), 'la ✕ pregunta');
ok(/'rep-form-cancel'\)\.addEventListener\('click', pedirCerrarRepairForm\)/.test(init), 'Cancelar pregunta');
ok(/id: 'rep-form-modal',\s*fn: pedirCerrarRepairForm/.test(src), 'Escape pregunta');

console.log('\n2) Sin escribir nada, cierra directo');
abrir(); PREGUNTAS = 0;
run('pedirCerrarRepairForm()');
ok(!abierto() && PREGUNTAS === 0, 'cerró sin preguntar');

console.log('\n3) Lo que carga la app sola no cuenta');
abrir();
run('_repFormMarcarTocado({ isTrusted: false })');
PREGUNTAS = 0; run('pedirCerrarRepairForm()');
ok(!abierto() && PREGUNTAS === 0, 'un valor puesto por código no frena el cierre');

console.log('\n4) Con algo escrito, pregunta');
abrir(); run('_repFormMarcarTocado({ isTrusted: true })');
RESPUESTA = false; PREGUNTAS = 0; run('pedirCerrarRepairForm()');
ok(abierto() && PREGUNTAS === 1, 'si decís que no, el ingreso queda abierto con todo');
RESPUESTA = true; run('pedirCerrarRepairForm()');
ok(!abierto(), 'si decís que sí, se cierra');
abrir(); PREGUNTAS = 0; run('pedirCerrarRepairForm()');
ok(!abierto() && PREGUNTAS === 0, 'el próximo ingreso arranca limpio (no arrastra el "tocado")');

console.log('\n5) Guardar cierra directo');
abrir(); run('_repFormMarcarTocado({ isTrusted: true })'); PREGUNTAS = 0;
run('closeRepairForm()');
ok(!abierto() && PREGUNTAS === 0, 'closeRepairForm (lo que usa guardar) no pregunta');
const save = src.slice(src.indexOf('async function saveRepair'), src.indexOf('async function saveRepair') + 30000);
ok(!/pedirCerrarRepairForm/.test(save), 'saveRepair no pasa por la pregunta');

console.log(fails ? `\n❌ ${fails} fallaron` : '\n✅ todo OK');
process.exit(fails ? 1 : 0);
