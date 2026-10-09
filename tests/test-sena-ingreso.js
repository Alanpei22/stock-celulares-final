// La seña que se cobra al tomar una reparación tiene que entrar a la caja.
//
// Pasó: al ingresar un equipo con seña, la seña quedaba anotada SOLO en la
// reparación. La caja no la veía y al cerrar el día faltaba esa plata.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const src = fs.readFileSync(DIR + 'repairs.js', 'utf8');
const html = fs.readFileSync(DIR + 'index.html', 'utf8');

(async () => {
console.log('\n1) El movimiento de caja');
const fn = src.slice(src.indexOf('function _senaAlIngresoACaja'), src.indexOf('// ── Detalle ─'));
const MOVS = [], TOASTS = [];
let METODO = 'Transferencia', FALLA = false;
const ctx = {
  console, Date, Number, String, Promise, JSON,
  document: { getElementById: id => id === 'rep-fi-sena-metodo' ? { value: METODO } : null },
  localStorage: { getItem: k => k === 'cajaVendedor' ? 'Alan' : null },
  todayAR: () => '2026-10-09', getDeviceId: () => 'pc1', tpFirma: () => ({ cargadoPor: 'Alan', cargadoPorUid: 'u1' }),
  toast: (m, t) => TOASTS.push([t, m]),
  db: { collection: c => ({ add: async d => { if (FALLA) throw new Error('sin red'); MOVS.push([c, d]); return { id: 'm1' }; } }) },
};
vm.createContext(ctx); vm.runInContext(fn, ctx);
const rep = { id: 'r1', nOrden: 8410, marca: 'Samsung', modelo: 'A54', nombre: 'Juan', sena: 15000, monto: 60000 };
await vm.runInContext('_senaAlIngresoACaja', ctx)(rep);
await new Promise(r => setTimeout(r, 5));
const [col, m] = MOVS[0] || [];
ok(col === 'caja_movimientos', 'va a la caja', col);
ok(m && m.tipo === 'ingreso' && m.monto === 15000 && m.categoria === 'Seña', 'ingreso de $15.000, categoría Seña', m);
ok(m && m.metodoPago === 'Transferencia', 'con el método que se eligió');
ok(m && m.repairId === 'r1' && m.repairNOrden === 8410 && m.esSena === true && m.repairMode === 'sena',
   'vinculada a la reparación como seña (el cobro final descuenta lo pagado; si se borra, se revierte)', m);
ok(m && m.fecha === '2026-10-09' && /N°8410/.test(m.descripcion) && /Juan/.test(m.descripcion), 'del día, con N° de orden y cliente');
ok(m && m.cargadoPor === 'Alan' && m.vendedor === 'Alan', 'firmada');
ok(TOASTS.some(t => /anotada en la caja/.test(t[1])), 'avisa que entró');
MOVS.length = 0;
ok(vm.runInContext('_senaAlIngresoACaja', ctx)({ ...rep, sena: 0 }) === null && !MOVS.length, 'sin seña no crea nada');
FALLA = true; TOASTS.length = 0;
await vm.runInContext('_senaAlIngresoACaja', ctx)(rep).catch(() => {});
await new Promise(r => setTimeout(r, 5));
ok(TOASTS.some(t => /NO se pudo anotar/.test(t[1])), 'si falla, avisa fuerte para cargarla a mano');

console.log('\n2) Enganchado al guardar');
const nuevo = src.slice(src.indexOf('_guardarRepairSinBloquear(newDoc);'), src.indexOf('_guardarRepairSinBloquear(newDoc);') + 500);
ok(/if \(sena > 0\) _senaAlIngresoACaja\(newDoc\)/.test(nuevo), 'al ingresar una reparación con seña');
const edit = src.slice(src.indexOf("await db.collection('repairs').doc(editingRepairId).set"), src.indexOf("await db.collection('repairs').doc(editingRepairId).set") + 800);
ok(/sena > senaAntes/.test(edit) && /sena: sena - senaAntes/.test(edit), 'al editar, si sube la seña entra solo la diferencia');
ok(/id="rep-fi-sena-metodo"/.test(html) && /value="Efectivo"/.test(html.slice(html.indexOf('rep-fi-sena-metodo'))), 'el formulario pregunta con qué pagó (Efectivo por defecto)');
const iNuevo = src.indexOf("'rep-fi-monto','rep-fi-sena'");
ok(/rep-fi-sena-metodo'\); if \(sm\) sm\.value = 'Efectivo'/.test(src), 'y vuelve a Efectivo al abrir el formulario');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
