// N° de orden: que se pueda corregir y que el contador no quede arruinado.
//
// Pasó: se cargó un número mal y no había forma de arreglarlo. Al editar, el
// N° quedaba trabado; y si el número tipeado era alto, el contador lo seguía
// y todas las órdenes siguientes salían mal.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const src = fs.readFileSync(DIR + 'repairs.js', 'utf8');
const trozo = (desde, hasta) => src.slice(src.indexOf(desde), src.indexOf(hasta));

(async () => {
// ── Base de datos de mentira ──
let META = { nextOrderNum: 75001 };
let DOCS = [{ id: 'a', nOrden: 7499 }, { id: 'b', nOrden: 75000 }];
const db = {
  collection: col => ({
    doc: () => ({
      get: async () => ({ exists: true, data: () => META }),
      set: async v => { Object.assign(META, v); },
    }),
    where: (campo, op, v) => ({
      where: (c2, op2, v2) => ({ get: async () => ({ docs: DOCS.filter(d => d.nOrden >= v && d.nOrden < v2).map(d => ({ id: d.id, data: () => d })) }) }),
      limit: () => ({ get: async () => ({ docs: DOCS.filter(d => op === '==' ? d.nOrden === v : d.nOrden > v).map(d => ({ id: d.id, data: () => d })) }) }),
      orderBy: () => ({ limit: () => ({ get: async () => {
        const top = DOCS.slice().sort((x, y) => y.nOrden - x.nOrden)[0];
        return { empty: !top, docs: top ? [{ data: () => top }] : [] };
      } }) }),
    }),
  }),
  runTransaction: async fn => fn({ get: async () => ({ exists: true, data: () => META }), set: (r, v) => Object.assign(META, v) }),
};
const ALERTS = [], TOASTS = [], CONFIRMS = [];
let CONFIRM = true;
let RESP = null;
const ctx = { console, Math, Number, String, Array, Object, JSON, Promise, db, REPAIRS: [],
  toast: (m, t) => TOASTS.push([t, m]), alert: m => ALERTS.push(m), prompt: () => RESP,
  confirm: m => { CONFIRMS.push(m); return CONFIRM; },
  requireOwnerPin: cb => cb(), logActivity: () => {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(trozo('async function _numeroDeOrden', '// ── Init'), ctx);

console.log('\n1) Corregir una orden');
ok(await vm.runInContext("_ordenOcupado(75000, 'x')", ctx) === true, 'un número que tiene otra reparación está ocupado');
ok(await vm.runInContext("_ordenOcupado(75000, 'b')", ctx) === false, 'pero no cuenta la misma reparación que se está editando');
ok(await vm.runInContext("_ordenOcupado(7500, 'b')", ctx) === false, 'un número libre se puede usar');

console.log('\n2) El contador');
META = { nextOrderNum: 7500 };
vm.runInContext('_contadorAlMenos(7400)', ctx); await new Promise(r => setTimeout(r, 0));
ok(META.nextOrderNum === 7500, 'corregir una orden a un número más bajo no baja el contador');
vm.runInContext('_contadorAlMenos(7600)', ctx); await new Promise(r => setTimeout(r, 0));
ok(META.nextOrderNum === 7600, 'y si pasa al contador, el contador lo sigue (si no, el próximo saldría repetido)');

console.log('\n3) Bajar el contador desde el menú');
META = { nextOrderNum: 75001 };
DOCS = [{ id: 'a', nOrden: 7499 }, { id: 'b', nOrden: 75000 }];
RESP = '7499';
await vm.runInContext('corregirContadorOrdenes()', ctx); await new Promise(r => setTimeout(r, 10));
ok(META.nextOrderNum === 75001 && /ya existe una reparación con el N°7499/.test(ALERTS.pop() || ''),
   'un número que ya tiene reparación no se puede poner');
CONFIRM = false; RESP = '7500';
await vm.runInContext('corregirContadorOrdenes()', ctx); await new Promise(r => setTimeout(r, 10));
ok(META.nextOrderNum === 75001 && /la más alta es la N°75000/.test(CONFIRMS.pop() || ''),
   'detrás de órdenes más altas avisa, y si dice que no, no toca nada');
CONFIRM = true;
await vm.runInContext('corregirContadorOrdenes()', ctx); await new Promise(r => setTimeout(r, 10));
ok(META.nextOrderNum === 7500, 'si dice que sí, el contador vuelve a 7500 aunque exista la 75000 (el caso de "no entra")', META);

console.log('\n3b) Al numerar se saltean los usados');
DOCS = [{ id: 'a', nOrden: 8410 }, { id: 'b', nOrden: 8411 }, { id: 'c', nOrden: 8413 }, { id: 'd', nOrden: 9000 }];
ok(await vm.runInContext('_primeroLibre(8410)', ctx) === 8412, 'desde 8410 con 8410 y 8411 usadas → 8412');
ok(await vm.runInContext('_primeroLibre(8414)', ctx) === 8414, 'uno libre se usa tal cual');
META = { nextOrderNum: 8410 };
let r = await vm.runInContext('_numeroDeOrden(0)', ctx);
ok(r.nOrden === 8412 && META.nextOrderNum === 8413, 'el ingreso nuevo toma 8412 y el contador queda en 8413', [r, META]);
r = await vm.runInContext('_numeroDeOrden(0)', ctx);
ok(r.nOrden === 8414 && META.nextOrderNum === 8415, 'y el siguiente saltea la 8413', [r, META]);
DOCS = [{ id: 'a', nOrden: 7499 }, { id: 'b', nOrden: 7500 }];
META = { nextOrderNum: 7501 };
RESP = '7501';
await vm.runInContext('corregirContadorOrdenes()', ctx); await new Promise(r => setTimeout(r, 10));
ok(META.nextOrderNum === 7501, 'corregida la orden, el contador vuelve a 7501', META);
RESP = null;
await vm.runInContext('corregirContadorOrdenes()', ctx); await new Promise(r => setTimeout(r, 10));
ok(META.nextOrderNum === 7501, 'cancelar no toca nada');

console.log('\n4) En la pantalla');
const abrir = trozo("document.getElementById('rep-form-title').textContent = '✏️ Editar Reparación'", "const isCustom");
ok(/ordenInput\.readOnly = false/.test(abrir) && !/readOnly = true/.test(abrir), 'al editar, el N° de orden se puede cambiar');
const guardar = trozo('if (editingRepairId) {\n      const existing', "toast(cambiaOrden");
ok(/_ordenOcupado\(ordenNuevo, editingRepairId\)/.test(guardar), 'y se revisa que no esté repetido');
ok(/updateData\.nOrden = ordenNuevo/.test(guardar) && /delete updateData\.numeroProvisorio/.test(guardar), 'se guarda, y deja de ser provisorio');
ok(/ordenInputVal > sugerido \+ 100/.test(src), 'un número tipeado muy lejos del siguiente pide confirmación');
const app = fs.readFileSync(DIR + 'app.js', 'utf8');
ok(/label: 'Próximo N° de orden'[^\n]*hide: _soloDueno\(\)/.test(app), 'en el menú de Reparaciones, solo para el dueño');

// Pasó: el menú no hacía NADA. requireOwnerPin buscaba #owner-pin-sub, que no
// existía en index.html, y el null cortaba antes de mostrar el teclado del PIN.
const html = fs.readFileSync(DIR + 'index.html', 'utf8');
const rop = app.slice(app.indexOf('function requireOwnerPin'), app.indexOf('function toggleOwnerLock'));
const ids = [...rop.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
const faltan = ids.filter(id => !html.includes(`id="${id}"`));
ok(ids.length >= 4 && faltan.length === 0, 'el cartel del PIN de dueño tiene en index.html todo lo que usa', faltan);
// Y después: con el PIN bien no pasaba nada. Se cerraba el cartel (que borra
// el callback) antes de leer el callback.
{
  const H = {};
  const nodo = id => H[id] || (H[id] = { textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } });
  const c2 = { console, Promise, Error, JSON,
    document: { getElementById: nodo, querySelectorAll: () => [] },
    tpFrenarEmpleado: () => false, verifyOwnerPin: async () => ({ ok: true }), db: {}, toast() {} };
  vm.createContext(c2);
  const pin = app.slice(app.indexOf('let OWNER_MODE'), app.indexOf('function unlockOwnerMode'));
  vm.runInContext(pin + '\nunlockOwnerMode = () => { this.SE_DESBLOQUEO = true; };', c2);
  let corrio = 0;
  c2.cb = () => corrio++;
  vm.runInContext("requireOwnerPin(cb, 'x'); _ownerPinBuf = '1234';", c2);
  await vm.runInContext('submitOwnerPin()', c2);
  ok(corrio === 1, 'con el PIN correcto, se hace lo que se pidió (cambiar el N° de orden)', corrio);
  ok(!c2.SE_DESBLOQUEO, 'y no se queda en modo dueño por eso');
  corrio = 0;
  vm.runInContext("requireOwnerPin(cb, 'x'); closeOwnerPinModal(); _ownerPinBuf = '1234';", c2);
  await vm.runInContext('submitOwnerPin()', c2);
  ok(corrio === 0, 'si se cerró el cartel con ✕, no queda pendiente');
}
console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
