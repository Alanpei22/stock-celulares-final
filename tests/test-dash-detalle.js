// Dashboard: tocar una tarjeta abre lo que forma ese número.
//
// Alan: "lo que apreto en dashboard no me lleva a ningún lado". Las tarjetas
// (ganancia, ingresos, egresos, rubros, top productos) mostraban el número y
// no tenían destino. Ahora abren la lista de movimientos del período, de lo
// que ya está cargado (sin gastar lecturas de Firestore).
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');
const app = leer('app.js');

// Las funciones de la cuenta, sacadas de app.js tal cual
const tomar = nombre => {
  const i = app.indexOf('function ' + nombre + '(');
  let j = app.indexOf('\n}\n', i);
  return app.slice(i, j + 2);
};
const ctx = { STOCK: [{ id: 'e1', estado: 'Nuevo' }, { id: 'e2', estado: 'Usado' }] };
vm.createContext(ctx);
vm.runInContext("const RETIRO_CAT_DASH = 'Retiro dueño'; let _dashCatTitulos = {}; let _dashMovs = [];\n" +
  ['_dashCatDe', '_dashNomItem', '_dashItemsDe', '_dashDetalleLista'].map(tomar).join('\n'), ctx);
const run = (c, v) => { ctx._v = v; return vm.runInContext(c, ctx); };

const MOVS = [
  { tipo: 'ingreso', monto: 9000, items: [{ nombre: 'Funda iPhone 15', source: 'producto' }] },
  { tipo: 'ingreso', monto: 60000, categoria: 'Reparación', descripcion: 'Pantalla A54', repairId: 'r1' },
  { tipo: 'ingreso', monto: 500000, items: [{ nombre: 'iPhone 13', source: 'equipo', id: 'e1' }] },
  { tipo: 'ingreso', monto: 25000, items: [{ nombre: 'Módulo A10', source: 'repuesto' }] },
  { tipo: 'egreso', monto: 3000, categoria: 'Insumos' },
  { tipo: 'egreso', monto: 50000, categoria: 'Retiro dueño' },
];
const n = (tipo, valor) => run(`_dashDetalleLista(${JSON.stringify(tipo)}, ${JSON.stringify(valor)}, _v).lista.length`, MOVS);

console.log('\n1) Cada tarjeta muestra lo suyo');
ok(n('ingresos') === 4, 'Ingresos: las 4 ventas');
ok(n('egresos') === 1, 'Egresos: el gasto, sin el retiro del dueño (que no es gasto)');
ok(n('retiros') === 1, 'Retiro dueño: el retiro');
ok(n('neta') === 5, 'Ganancia neta: ventas y gastos, sin retiros');
ok(n('cat', 'access') === 1 && n('cat', 'repar') === 1 && n('cat', 'nuevos') === 1 && n('cat', 'repues') === 1,
   'cada rubro con lo suyo (la misma cuenta que las tarjetas)');
ok(n('prod', 'Funda iPhone 15') === 1, 'una fila del top: las ventas de ese producto');

console.log('\n2) Está enganchado');
ok(/click: "dashDetalle\('ingresos'\)"/.test(app) && /click: "dashDetalle\('egresos'\)"/.test(app) &&
   /click: "dashDetalle\('ganancia'\)"/.test(app) && /click: "dashDetalle\('retiros'\)"/.test(app), 'las tarjetas de arriba');
ok(/class="d-cat d-tocable"[^\n]*dashDetalle\(\\'cat\\'/.test(app), 'las de rubros');
ok(/<tr class="d-tocable" onclick="dashDetalle\(\\'prod\\'/.test(app), 'las filas de top productos');
ok(/d-kpi-hero d-tocable[^>]*onclick="dashDetalle\('neta'\)"/.test(leer('index.html')), 'la grande de ganancia neta');
ok(/acc\[k\]\[0\] \+= 1/.test(app) && /_dashCatDe\(m, stock\)/.test(app), 'las tarjetas de rubros usan la misma cuenta que el detalle');
ok(/openRepairDetail\(\\'' \+ esc\(m\.repairId\)/.test(app), 'un cobro de reparación abre esa reparación');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
