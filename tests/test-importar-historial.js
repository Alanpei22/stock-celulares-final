// 📥 Importar el historial de la caja desde las planillas de Drive. Alan
// (19/11): "hagamos lo del año 2025, y pasarlo a la app". La planilla se
// convierte en un .json que el dueño sube (los datos no van en el código).
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ctx = { console, Math, Number, String, Array, Object, JSON, Set };
vm.createContext(ctx);
vm.runInContext(leer('importar-historial.js'), ctx, { filename: 'importar-historial.js' });
const run = c => vm.runInContext(c, ctx);

const base = { origen: 'planilla-2025', nombre: 'caja 2025', movimientos: [
  { id: 'hist2025_2025-06-02_caseros', fecha: '2025-06-02', tipo: 'ingreso', categoria: 'Otro ingreso', monto: 450000, descripcion: 'Caja del día · Caseros', local: 'Caseros' },
  { id: 'hist2025_2025-06-02_morris', fecha: '2025-06-02', tipo: 'ingreso', categoria: 'Otro ingreso', monto: 145000, descripcion: 'Caja del día · Morris', local: 'Morris' },
  { id: 'hist2025_2025-06-02_gasto', fecha: '2025-06-02', tipo: 'egreso', categoria: 'Compra repuesto', monto: 800000, descripcion: 'Repuestos', rubro: 'Mercadería y repuestos' },
  { id: 'hist2025_2025-07-06_gasto', fecha: '2025-07-06', tipo: 'egreso', categoria: 'Retiro dueño', monto: 500000, descripcion: 'alan' },
] };
ctx.B = base;

console.log('\n1) El archivo');
const v = run('impValidar(B)');
ok(!v.error && v.movimientos.length === 4 && v.origen === 'planilla-2025', 'un archivo bueno pasa', v.error);
const m0 = v.movimientos[0];
ok(m0.id === 'hist2025_2025-06-02_caseros' && m0.data.importado === 'planilla-2025' && m0.data.historico === true && m0.data.metodoPago === 'Planilla' && m0.data.local === 'Caseros', 'cada movimiento queda marcado como importado (y con su local)', m0);
ok(m0.data.createdAt === '2025-06-02T12:00:00.000Z' && m0.data.fecha === '2025-06-02', 'con la fecha del día de la planilla');
const mal = cambio => run(`impValidar(${JSON.stringify(Object.assign({}, base, { movimientos: [Object.assign({}, base.movimientos[0], cambio)] }))}).error`);
ok(/categoría/.test(mal({ categoria: 'Inventada' })), 'una categoría que la caja no tiene, no');
ok(/monto/.test(mal({ monto: -5 })) && /monto/.test(mal({ monto: 'mucho' })), 'montos raros, no');
ok(/fecha/.test(mal({ fecha: '2/6' })) && /id/.test(mal({ id: 'cualquiera' })), 'fechas e ids raros, no');
ok(/repetido/.test(run(`impValidar(${JSON.stringify(Object.assign({}, base, { movimientos: [base.movimientos[0], base.movimientos[0]] }))}).error`)), 'un movimiento repetido, no');
ok(run('impValidar({ movimientos: [] }).error') && run('impValidar(null).error'), 'un archivo vacío o de otra cosa, no');

console.log('\n2) El resumen antes de importar');
const r = run('impResumen(impValidar(B).movimientos)');
ok(r.length === 2 && r[0].mes === '2025-06' && r[0].ingresos === 595000 && r[0].egresos === 800000 && r[1].egresos === 500000, 'por mes: lo que entró y lo que salió', r);

console.log('\n3) Enganchado');
const src = leer('importar-historial.js');
ok(/batch\.set\(db\.collection\('caja_movimientos'\)\.doc\(id\), data\)/.test(src), 'se guarda con su id fijo: importar dos veces no duplica');
ok(/where\('importado', '==', origen\.trim\(\)\)/.test(src), 'se puede borrar todo lo importado de una planilla (y nada más)');
ok(/label: 'Importar historial'/.test(leer('caja.js')) && /<script src="importar-historial\.js"><\/script>/.test(leer('caja.html')), 'menú de la caja → Informes → Importar historial (solo el dueño)');
ok(!/hist2025_2025-0[5-9]|hist2025_2025-1/.test(leer('caja.js') + leer('caja.html')), 'los datos de la planilla no están en el código');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
