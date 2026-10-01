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
      limit: () => ({ get: async () => ({ docs: DOCS.filter(d => op === '==' ? d.nOrden === v : d.nOrden > v).map(d => ({ id: d.id, data: () => d })) }) }),
      orderBy: () => ({ limit: () => ({ get: async () => {
        const top = DOCS.slice().sort((x, y) => y.nOrden - x.nOrden)[0];
        return { empty: !top, docs: top ? [{ data: () => top }] : [] };
      } }) }),
    }),
  }),
  runTransaction: async fn => fn({ get: async () => ({ exists: true, data: () => META }), set: (r, v) => Object.assign(META, v) }),
};
const ALERTS = [], TOASTS = [];
let RESP = null;
const ctx = { console, Math, Number, String, Array, Object, JSON, Promise, db, REPAIRS: [],
  toast: (m, t) => TOASTS.push([t, m]), alert: m => ALERTS.push(m), prompt: () => RESP,
  requireOwnerPin: cb => cb(), logActivity: () => {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(trozo('let _ultimoContadorVisto', '// ── Init'), ctx);

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
RESP = '7500';
await vm.runInContext('corregirContadorOrdenes()', ctx); await new Promise(r => setTimeout(r, 10));
ok(META.nextOrderNum === 75001 && /ya existe la orden N°75000/.test(ALERTS.pop() || ''),
   'no deja ponerlo detrás de una orden que existe: primero hay que corregir la N°75000');
DOCS[1].nOrden = 7500;   // se corrigió la orden mal cargada
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

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
