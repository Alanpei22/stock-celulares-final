// Harness sin navegador para los totales que muestran plata acumulada.
//
// Lo que vigila: el "Retiro dueño" NO es un gasto del negocio. Sale del cajón,
// pero es plata que el taller ya ganó y el dueño se lleva. Si se cuenta como
// egreso, el total del día/mes/año queda más bajo de lo que en verdad se ganó.
//
// Cubre las dos pantallas donde se ve un total de varios días:
//   · finanzas-report.js → el PDF de reporte financiero
//   · caja_extra.js      → Caja › Historial (tabs día / mes / año)
const fs = require('fs'), vm = require('vm');
const path = require('path');
const raiz = f => path.join(__dirname, '..', f);

// ── Movimientos de prueba ───────────────────────────────────
// Un mes simple: entran 100.000, se gastan 20.000 en un repuesto y el dueño
// retira 50.000 para él. El negocio ganó 80.000, no 30.000.
const MOVS = [
  { tipo: 'ingreso', monto: 100000, categoria: 'Venta',           metodoPago: 'Efectivo', fecha: '2026-08-05' },
  { tipo: 'egreso',  monto:  20000, categoria: 'Compra repuesto', metodoPago: 'Efectivo', fecha: '2026-08-06' },
  { tipo: 'egreso',  monto:  50000, categoria: 'Retiro dueño',    metodoPago: 'Efectivo', fecha: '2026-08-07' },
];

// fmt propio, sin separadores de miles: así los chequeos sobre el HTML no
// dependen de si node tiene los datos de idioma es-AR instalados.
const fmt = n => '$' + Math.round(Number(n) || 0);
const esc = s => String(s == null ? '' : s);

let fails = 0;
function ok(cond, label, extra) {
  console.log((cond ? '  OK  ' : '  FAIL') + ' · ' + label + (cond ? '' : '  → ' + JSON.stringify(extra)));
  if (!cond) fails++;
}

// ════════════════════════════════════════════════════════════
//  1) Reporte financiero (finanzas-report.js)
// ════════════════════════════════════════════════════════════
const els = {};
function el(id, extra = {}) {
  return els[id] = Object.assign({
    id, value: '', textContent: '', innerHTML: '', checked: false, disabled: false,
    style: {}, dataset: {},
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
                 toggle(c,f){ f ? this._s.add(c) : this._s.delete(c); }, contains(c){return this._s.has(c);} },
  }, extra);
}
['finrep-from','finrep-to','finrep-status','finrep-generate','finrep-overlay','finrep-modal',
 'finrep-inc-caja','finrep-inc-ventas','finrep-inc-reparaciones','finrep-inc-dueno'].forEach(id => el(id));

let PDF = '';
const ctxFin = {
  console, setTimeout: () => {}, clearTimeout,
  document: { getElementById: id => els[id] || null, querySelectorAll: () => [] },
  window: { open: () => ({ document: { write(h) { PDF += h; }, close(){} }, focus(){}, print(){} }) },
  alert: () => {}, toast: () => {},
  // metodoCanonico vive en utils.js, que este harness no carga. Unifica
  // 'Mercado Pago' y 'MercadoPago', que quedaron guardados distinto.
  metodoCanonico: m => String(m || 'Efectivo').replace(/^Mercado Pago$/, 'MercadoPago'),
  db: {
    collection: name => {
      const q = { where: () => q, get: async () => ({
        docs: (name === 'caja_movimientos' ? MOVS : []).map(m => ({ data: () => m })),
      }) };
      return q;
    },
  },
};
ctxFin.globalThis = ctxFin; ctxFin.self = ctxFin;
vm.createContext(ctxFin);
vm.runInContext(fs.readFileSync(raiz('finanzas-report.js'), 'utf8'), ctxFin, { filename: 'finanzas-report.js' });

const runFin = code => vm.runInContext(code, ctxFin);

// Espiar _renderFinanzasPDF para quedarnos con los números ya calculados,
// sin dejar de correr el render de verdad (así también miramos el HTML).
runFin(`
  var __CAP = null;
  var __origRender = _renderFinanzasPDF;
  _renderFinanzasPDF = function (d) { __CAP = d; return __origRender(d); };
`);

els['finrep-from'].value = '2026-08-01';
els['finrep-to'].value   = '2026-08-31';
els['finrep-inc-caja'].checked = true;   // solo caja: es donde estaba el bug

(async () => {
  console.log('\n  ── Reporte financiero (PDF) ──');
  await runFin('generarFinanzasPDF()');
  const c = runFin('__CAP && __CAP.caja');

  ok(!!c, 'el reporte calculó la sección de caja');
  ok(c.totalIng === 100000, 'ingresos del período', { esperado: 100000, fue: c.totalIng });
  ok(c.totalEg === 20000,
     'los egresos son solo los gastos reales, sin el retiro',
     { esperado: 20000, fue: c.totalEg });
  ok(c.totalRet === 50000,
     'el retiro se cuenta aparte',
     { esperado: 50000, fue: c.totalRet });
  ok(c.neto === 80000,
     'el NETO del período no baja por el retiro',
     { esperado: 80000, fue: c.neto });
  ok(!('Retiro dueño' in c.porCatEg),
     'el retiro no figura entre las categorías de gasto', Object.keys(c.porCatEg));
  ok(c.porCatEg['Compra repuesto'] === 20000,
     'el gasto real sí figura', c.porCatEg);

  // El efectivo es otra cosa: ahí el retiro SÍ resta, porque la plata sale
  // físicamente del cajón. 100.000 − 20.000 − 50.000 = 30.000.
  ok(c.efecEg === 70000,
     'el efectivo que salió del cajón sí incluye el retiro',
     { esperado: 70000, fue: c.efecEg });
  ok(c.efecIng - c.efecEg === 30000,
     'efectivo neto en el cajón', { esperado: 30000, fue: c.efecIng - c.efecEg });

  ok(/Retiro due/.test(PDF), 'el PDF muestra el renglón del retiro');
  ok(/no es gasto/.test(PDF), 'el PDF aclara que el retiro no es un gasto');

  // ══════════════════════════════════════════════════════════
  //  2) Caja › Historial (caja_extra.js)
  // ══════════════════════════════════════════════════════════
  console.log('\n  ── Caja › Historial (día / mes / año) ──');
  // metodoCanonico vive en utils.js, que este harness no carga.
  const ctxHist = { console, fmt, esc, metodoCanonico: ctxFin.metodoCanonico,
                    document: { getElementById: () => null } };
  ctxHist.globalThis = ctxHist; ctxHist.self = ctxHist;
  vm.createContext(ctxHist);
  vm.runInContext(fs.readFileSync(raiz('caja_extra.js'), 'utf8'), ctxHist, { filename: 'caja_extra.js' });
  const runHist = code => vm.runInContext(code, ctxHist);
  ctxHist.__MOVS = MOVS;

  // Los ayudantes, primero sueltos
  ok(runHist('_sumGastos(__MOVS)') === 20000,
     '_sumGastos deja afuera el retiro', { fue: runHist('_sumGastos(__MOVS)') });
  ok(runHist('_sumRetiros(__MOVS)') === 50000,
     '_sumRetiros junta solo los retiros', { fue: runHist('_sumRetiros(__MOVS)') });

  // Tab "mes" del historial: ventana holgada para que no dependa de la zona
  // horaria en la que corra la prueba.
  const htmlDia = runHist("buildHistorialHTML(__MOVS, {}, '2026-08-01', '2026-08-10', null, 'dia')");
  ok(/-\$20000/.test(htmlDia),   'historial: total de egresos = solo los gastos');
  ok(!/-\$70000/.test(htmlDia),  'historial: el retiro NO está sumado a los egresos');
  ok(/\$80000/.test(htmlDia),    'historial: el neto queda en 80.000');
  ok(/Retiros dueño/.test(htmlDia) && /\$50000/.test(htmlDia),
     'historial: el retiro se muestra en su propio renglón');

  // Tab "año": mes por mes — es el "total del mes" que se veía mal
  const htmlAnual = runHist('buildCajaAnualHTML(__MOVS)');
  ok(/-\$20000/.test(htmlAnual),  'anual: los egresos del mes excluyen el retiro');
  ok(!/-\$70000/.test(htmlAnual), 'anual: el retiro NO está sumado a los egresos');
  ok(/\+\$80000/.test(htmlAnual), 'anual: el neto del mes queda en 80.000');
  ok(/Retiros dueño/.test(htmlAnual), 'anual: el retiro se muestra aparte');

  // Estadísticas de 30 días
  const htmlStats = runHist('buildCajaStatsHTML(__MOVS)');
  ok(/-\$20000/.test(htmlStats),  'stats: egresos de 30d sin el retiro');
  ok(!/-\$70000/.test(htmlStats), 'stats: el retiro NO está sumado a los egresos');
  ok(!/stats-met-lbl">Retiro dueño/.test(htmlStats),
     'stats: el retiro no aparece entre las categorías de egreso');
  ok(/Retiros dueño/.test(htmlStats), 'stats: el retiro se muestra aparte');

  console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
  process.exit(fails ? 1 : 0);
})();
