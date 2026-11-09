// El saldo de caja dueño, sin leer la colección entera cada vez.
//
// Antes, abrir el cartel de Caja Dueño leía TODOS los movimientos solo para
// sumar el saldo, aunque en pantalla se muestren los últimos 80. Eso crece
// para siempre: a los dos años, abrirlo te cuesta miles de lecturas del cupo
// gratis de Firestore, y se abre varias veces por día.
//
// Ahora el saldo vive en un documento y se corrige con `increment()`, que es
// atómico. Lo que se chequea acá es sobre todo que el número no mienta: un
// saldo mal contado en la caja del dueño es peor que una lectura de más.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = {};
const el = id => els[id] = {
  id, value: '', textContent: '', innerHTML: '', className: '', style: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  focus() {}, addEventListener() {},
};
['cd-movs-list', 'cd-saldo-val', 'cd-saldo-sub', 'cd-prompt-monto', 'cd-prompt-desc',
 'cd-add-tipo', 'cd-add-monto', 'cd-add-desc', 'cd-prompt-overlay', 'cd-prompt-modal',
 'cd-add-overlay', 'cd-add-modal', 'cd-mgmt-overlay', 'cd-mgmt-modal'].forEach(el);

const TOASTS = [];
let MOVS = [];                 // la "colección"
let SALDO = null;              // el documento del saldo
let LEIDOS = 0;                // cuántos movimientos se leyeron
let CUPO = [];

// set con merge como Firestore: los increment suman, y los mapas (las
// cuentas) se mezclan campo por campo.
function _mezclar(dst, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && v.__inc !== undefined) dst[k] = (Number(dst[k]) || 0) + v.__inc;
    else if (v && typeof v === 'object' && !Array.isArray(v)) { dst[k] = (dst[k] && typeof dst[k] === 'object') ? dst[k] : {}; _mezclar(dst[k], v); }
    else dst[k] = v;
  }
  return dst;
}
const docSaldo = {
  get: async () => ({ exists: SALDO !== null, data: () => SALDO }),
  set: async (d, opts) => {
    if (opts && opts.merge && SALDO) _mezclar(SALDO, d);
    else SALDO = _mezclar({}, d);
  },
};

function consulta(lista) {
  const q = {
    _lim: 0,
    orderBy() { return q; },
    limit(n) { q._lim = n; return q; },
    get: async () => {
      const docs = (q._lim ? lista.slice(0, q._lim) : lista).map(m => ({ id: m.id, data: () => m }));
      LEIDOS += docs.length;
      return { size: docs.length, docs };
    },
  };
  return q;
}

const ctx = {
  console, setTimeout: f => f(), clearTimeout, Date, Math, JSON, Number, String, parseInt,
  document: { getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [],
              createElement: () => el('tmp'), addEventListener() {},
              body: { style: {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } } },
  window: { addEventListener() {} },
  navigator: { userAgent: 'node' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  esc: s => String(s == null ? '' : s),
  fmt: n => '$' + Number(n || 0).toLocaleString('es-AR'),
  toast: (m, t) => TOASTS.push([t || 'info', m]),
  confirm: () => true, alert: () => {}, prompt: () => null,
  _todayAR: () => '2026-10-10',
  cupoContar: (c, n) => CUPO.push([c, n]),
  tgNotify: () => {}, tgMonto: n => '$' + n, tgHora: () => '10:00',
  requireCajaOwnerPin: cb => cb(),
  db: {
    collection: nombre => {
      if (nombre === 'config') return { doc: () => docSaldo };
      const q = consulta(MOVS);
      q.add = async d => { const m = { id: 'n' + MOVS.length, ...d }; MOVS.unshift(m); return { id: m.id }; };
      q.doc = id => ({
        get: async () => { LEIDOS++; const m = MOVS.find(x => x.id === id); return { exists: !!m, data: () => m }; },
        delete: async () => { MOVS = MOVS.filter(x => x.id !== id); },
      });
      return q;
    },
  },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({ __ts: true }) } } },
};
ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(leer('caja_extra.js'), ctx, { filename: 'caja_extra.js' });
const run = e => vm.runInContext(e, ctx);
// caja_extra.js define su propio PIN y su propio toast: los de mentira van
// DESPUES de cargarlo. El PIN guarda la promesa, para poder esperar el borrado.
run('toast = (m, t) => __T(m, t); requireCajaOwnerPin = (cb) => { __ESPERA(cb()); };');
let ESPERA = Promise.resolve();
ctx.__ESPERA = p => { ESPERA = p; };
ctx.__T = (m, t) => TOASTS.push([t || 'info', m]);

const mov = (id, tipo, monto) => ({ id, tipo, monto, fecha: '2026-10-01', desc: 'x', ts: '2026-10-01T10:00:00Z' });

(async () => {

console.log('\n1) La primera vez cuenta todo y lo guarda');
MOVS = [mov('a', 'ingreso', 100000), mov('b', 'egreso', 30000), mov('c', 'ingreso', 5000)];
SALDO = null; LEIDOS = 0;
await run('_loadCajaDueno()');
ok(SALDO && SALDO.saldo === 75000, 'el saldo queda guardado (100.000 − 30.000 + 5.000)', SALDO);
ok(SALDO.ingresos === 105000 && SALDO.egresos === 30000, 'con los dos totales por separado', SALDO);
ok(els['cd-saldo-val'].textContent === '$75.000', 'y es el que se muestra', els['cd-saldo-val'].textContent);

console.log('\n2) Las veces siguientes NO lee todo');
// Es el punto de todo esto: que abrirlo no cueste más cada año que pasa.
MOVS = [];
for (let i = 0; i < 500; i++) MOVS.push(mov('x' + i, 'ingreso', 1000));
SALDO = { saldo: 500000, ingresos: 500000, egresos: 0 };
LEIDOS = 0;
await run('_loadCajaDueno()');
ok(LEIDOS === 80, `con 500 movimientos lee 80, no 500 (leyó ${LEIDOS})`, LEIDOS);
ok(els['cd-saldo-val'].textContent === '$500.000', 'y el saldo sale del documento', els['cd-saldo-val'].textContent);

console.log('\n3) Cada alta y cada baja corrigen el saldo');
MOVS = [mov('a', 'ingreso', 100000)];
SALDO = { saldo: 100000, ingresos: 100000, egresos: 0 };
els['cd-add-tipo'].value = 'egreso';
els['cd-add-monto'].value = '25000';
els['cd-add-desc'].value = 'Proveedor';
await run('saveCajaDuenoMov()');
ok(SALDO.saldo === 75000, 'un egreso lo baja', SALDO);
ok(SALDO.egresos === 25000, 'y suma en egresos', SALDO);

els['cd-prompt-monto'].value = '40000';
els['cd-prompt-desc'].value = 'Cierre';
await run('saveCajaDuenoFromCierre()');
ok(SALDO.saldo === 115000, 'lo que apartás en el cierre lo sube', SALDO);

// Borrar tiene que devolver exactamente lo que ese movimiento había movido.
const idEgreso = MOVS.find(m => m.tipo === 'egreso').id;
ctx.__ID = idEgreso;
run('deleteCajaDueno(__ID)');
await ESPERA;
ok(SALDO.saldo === 140000, 'borrar un egreso devuelve esa plata al saldo', SALDO);
ok(SALDO.egresos === 0, 'y lo saca de los egresos', SALDO);

console.log('\n4) Si el número dejara de cerrar, se recalcula');
// Es la salida de emergencia: un increment que no entró deja el saldo
// mintiendo, y sin esto no habría forma de arreglarlo desde la app.
MOVS = [mov('a', 'ingreso', 10000), mov('b', 'egreso', 4000)];
SALDO = { saldo: 999999, ingresos: 999999, egresos: 0 };   // desfasado a propósito
LEIDOS = 0;
await run('recalcularSaldoCajaDueno(true)');
ok(SALDO.saldo === 6000, 'vuelve a contar todo y lo corrige', SALDO);
const cuenta = CUPO[CUPO.length - 1];
ok(cuenta && cuenta[0] === 'caja_dueno_movimientos' && cuenta[1] === 2,
   'leyendo los movimientos una sola vez', cuenta);
ok(CUPO.some(c => c[0] === 'caja_dueno_movimientos'), 'y esa lectura se cuenta en el cupo', CUPO);
ok(TOASTS.some(t => /recalculado/.test(t[1])), 'avisando que se recalculó', TOASTS[TOASTS.length - 1]);
ok(/onclick="recalcularSaldoCajaDueno\(true\)"/.test(leer('caja.html')), 'hay un botón para hacerlo');

console.log('\n5) Lo que antes se leía entero, ahora está medido');
// No se acota pedidos a propósito: un pedido viejo sin createdAt se caería de
// un orderBy y desaparecería de la lista sin que nadie se entere. Pero ahora
// se mide, que es lo que permite decidir con números y no de memoria.
['pedidos.js', 'precios.js', 'placas.js'].forEach(f =>
  ok(/cupoSnap\(/.test(leer(f)), `${f} reporta sus lecturas al contador`));
ok(/limit\(80\)/.test(leer('caja_extra.js')), 'la lista de caja dueño pide 80, no todo');
ok(!/orderBy\('ts', 'desc'\)\.get\(\)/.test(leer('caja_extra.js')),
   'ya no queda la lectura entera de antes');

console.log('\n6) Las tres cuentas: efectivo, banco y MercadoPago');
// Alan (09/11): "una caja mía aparte… y llevar cuentas de las cuentas de
// transferencia y mercadopago".
const E = m => JSON.parse(JSON.stringify(run('cdEfecto(' + JSON.stringify(m) + ')')));
let e = E({ tipo: 'egreso', monto: 1000, cuenta: 'banco' });
ok(e.saldo === -1000 && e.egresos === 1000 && e.cuentas.banco === -1000 && e.cuentas.efectivo === 0, 'un gasto resta en su cuenta', e);
e = E({ tipo: 'ingreso', monto: 500 });
ok(e.cuentas.efectivo === 500 && e.ingresos === 500, 'sin cuenta (los de antes) es efectivo', e);
e = E({ tipo: 'pase', monto: 2000, cuenta: 'banco', cuentaDestino: 'efectivo' });
ok(e.saldo === 0 && e.ingresos === 0 && e.egresos === 0 && e.cuentas.banco === -2000 && e.cuentas.efectivo === 2000, 'un pase saca de una y pone en otra: el total no cambia', e);
e = E({ tipo: 'ajuste', monto: -300, cuenta: 'mp' });
ok(e.saldo === -300 && e.cuentas.mp === -300 && e.ingresos === 0 && e.egresos === 0, 'un ajuste corrige la cuenta sin contar como gasto (comisión de MP, por ejemplo)', e);
const conC = JSON.parse(JSON.stringify(run('cdConCuentas({ saldo: 75000, ingresos: 1, egresos: 0 })')));
ok(conC.cuentas.efectivo === 75000 && conC.cuentas.banco === 0, 'el saldo de antes de las cuentas pasa entero a efectivo', conC);

// Altas con cuenta y pases, contra el documento del saldo
MOVS = []; SALDO = { saldo: 100000, ingresos: 100000, egresos: 0, cuentas: { efectivo: 100000, banco: 0, mp: 0 } };
el('cd-add-cuenta'); el('cd-add-destino');
els['cd-add-tipo'].value = 'ingreso'; els['cd-add-monto'].value = '50000'; els['cd-add-desc'].value = ''; els['cd-add-cuenta'].value = 'banco';
await run('saveCajaDuenoMov()');
ok(SALDO.cuentas.banco === 50000 && SALDO.saldo === 150000, 'un ingreso al banco suma en el banco', SALDO);
ok(MOVS[0].cuenta === 'banco', 'y el movimiento dice de qué cuenta es', MOVS[0]);
els['cd-add-tipo'].value = 'pase'; els['cd-add-monto'].value = '20000'; els['cd-add-cuenta'].value = 'banco'; els['cd-add-destino'].value = 'efectivo';
await run('saveCajaDuenoMov()');
ok(SALDO.cuentas.banco === 30000 && SALDO.cuentas.efectivo === 120000 && SALDO.saldo === 150000, 'sacar 20.000 del banco: baja el banco, sube el efectivo, el total igual', SALDO);
ok(MOVS[0].tipo === 'pase' && MOVS[0].cuentaDestino === 'efectivo', 'queda como pase');
els['cd-add-destino'].value = 'banco'; TOASTS.length = 0; const nAntes = MOVS.length;
await run('saveCajaDuenoMov()');
ok(MOVS.length === nAntes && TOASTS.some(x => /dos cuentas distintas/.test(x[1])), 'un pase a la misma cuenta no se guarda');
// Borrar un pase lo deshace entero
ctx.__ID = MOVS.find(m => m.tipo === 'pase').id;
run('deleteCajaDueno(__ID)'); await ESPERA;
ok(SALDO.cuentas.banco === 50000 && SALDO.cuentas.efectivo === 100000, 'borrar el pase devuelve cada peso a su cuenta', SALDO);
// Ajustar a lo real
run('_cdTot = cdConCuentas(' + JSON.stringify(SALDO) + ')');
ctx.prompt = () => '48.500';
run('prompt = () => "48.500"');
await run('cdAjustar("banco")');
ok(SALDO.cuentas.banco === 48500 && MOVS[0].tipo === 'ajuste' && MOVS[0].monto === -1500, '"en el banco hay $48.500": queda un ajuste de −1.500', MOVS[0]);
// Recalcular cuenta por cuenta
LEIDOS = 0;
await run('recalcularSaldoCajaDueno(false)');
ok(SALDO.cuentas.banco === 48500 && SALDO.cuentas.efectivo === 0 && SALDO.saldo === 48500, 'recalcular también rehace cada cuenta', SALDO);

console.log('\n7) En el cierre: lo cobrado por transferencia y MercadoPago');
const MV = [
  { tipo: 'ingreso', monto: 30000, metodoPago: 'Transferencia' },
  { tipo: 'ingreso', monto: 50000, metodoPago: 'Efectivo', metodoPago2: 'Transferencia', monto2: 20000 },
  { tipo: 'egreso',  monto: 5000,  metodoPago: 'Transferencia' },
  { tipo: 'ingreso', monto: 12000, metodoPago: 'MercadoPago' },
  { tipo: 'ingreso', monto: 9000,  metodoPago: 'Efectivo' },
];
ctx._MV = MV;
ok(run('cdNetoMetodo(_MV, "Transferencia")') === 45000, 'transferencias del día: 30.000 + 20.000 (parte de un pago dividido) − 5.000 pagados = 45.000');
ok(run('cdNetoMetodo(_MV, "MercadoPago")') === 12000, 'MercadoPago del día');
MOVS = []; SALDO = { saldo: 0, ingresos: 0, egresos: 0, cuentas: { efectivo: 0, banco: 0, mp: 0 } };
run(`_cdCierreOfrecido = [{ metodo: 'Transferencia', cuenta: 'banco', lbl: 'Transferencias', monto: 45000, fecha: '2026-11-09', ya: false },
                          { metodo: 'MercadoPago', cuenta: 'mp', lbl: 'MercadoPago', monto: 12000, fecha: '2026-11-09', ya: true }]`);
el('cd-prompt-c0').checked = true; el('cd-prompt-c1').checked = true;
els['cd-prompt-monto'].value = '0';
await run('saveCajaDuenoFromCierre()');
ok(SALDO.cuentas.banco === 45000 && SALDO.cuentas.mp === 0, 'pasa las transferencias tildadas al banco (aunque no apartes efectivo), y no repite lo ya anotado hoy', SALDO);
ok(MOVS[0].origen === 'cierre-banco' && MOVS[0].cuenta === 'banco', 'queda marcado para no anotarlo dos veces si se cierra de nuevo', MOVS[0]);
const cx = leer('caja_extra.js'), ch = leer('caja.html');
ok(/where\('fecha', '==', fecha\)/.test(cx) && /ya: ya\.includes\('cierre-' \+ x\.cuenta\)/.test(cx), 'mira si ya se anotó ese día antes de ofrecerlo');
ok(/id="cd-cuentas"/.test(ch) && /id="cd-prompt-cuentas"/.test(ch) && /openCajaDuenoMovForm\('pase'\)/.test(ch) && /id="cd-add-cuenta"/.test(ch), 'en pantalla: las tres cuentas, ⇄ Pasar, elegir cuenta y lo del cierre');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})().catch(e => { console.error('Error:', e); process.exit(1); });
