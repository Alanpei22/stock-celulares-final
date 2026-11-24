// 🖨️ Un ingreso imprime UNA etiqueta y UNA hoja. Alan (24/11): "cuando tomo
// un equipo de reparación se me imprime etiqueta y hoja A5 por duplicado".
// Se prueba que un segundo guardado mientras corre el primero no hace nada, y
// que la impresión automática de la misma orden no sale dos veces seguidas.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

(async () => {
  console.log('\n1) Un guardado a la vez');
  const rep = leer('repairs.js');
  let corridas = 0, soltar;
  const ctx = { console, Promise, _saveRepairAhora: () => { corridas++; return new Promise(r => { soltar = r; }); } };
  vm.createContext(ctx);
  vm.runInContext(rep.slice(rep.indexOf('let _repGuardando'), rep.indexOf('async function _saveRepairAhora')), ctx);
  const a = ctx.saveRepair(), b = ctx.saveRepair();
  await new Promise(r => setTimeout(r, 5));
  ok(corridas === 1, 'dos toques seguidos: guarda una sola vez', corridas);
  soltar(); await a; await b;
  const c = ctx.saveRepair(); await new Promise(r => setTimeout(r, 5));
  ok(corridas === 2, 'cuando terminó, el siguiente ingreso guarda normal', corridas);
  soltar(); await c;

  console.log('\n2) La impresión automática de la misma orden sale una vez');
  const pr = leer('print.js');
  const SALIDAS = [];
  const p = { console, Promise, Date, Object,
    _puedeImprimirAca: () => true, _buildA5: r => 'hoja-' + r.nOrden, _hojaEtiquetas: rs => 'etq-' + rs[0].nOrden,
    _etiquetaRepHtml: () => '', _imprimirDirecto: (t, h) => { SALIDAS.push(h); return Promise.resolve(true); }, _imprimirEnIframe: h => { SALIDAS.push('iframe:' + h); return Promise.resolve(); } };
  vm.createContext(p);
  vm.runInContext(pr.slice(pr.indexOf('const _INGRESO_YA_MS'), pr.indexOf('//  BOLETA DE LA REPARACIÓN')), p);
  await p.imprimirIngresoReparacion({ id: 'x', nOrden: 8700 });
  ok(SALIDAS.join() === 'hoja-8700,etq-8700', 'sale una hoja y una etiqueta', SALIDAS);
  await p.imprimirIngresoReparacion({ id: 'x', nOrden: 8700 });
  ok(SALIDAS.length === 2, 'si se vuelve a pedir enseguida, no sale de nuevo', SALIDAS);
  await p.imprimirIngresoReparacion({ id: 'y', nOrden: 8701 });
  ok(SALIDAS.length === 4, 'la orden siguiente imprime normal', SALIDAS);
  await p.imprimirEtiquetaIngreso({ id: 'z', nOrden: 8702 }); await p.imprimirEtiquetaIngreso({ id: 'z', nOrden: 8702 });
  ok(SALIDAS.filter(s => s === 'etq-8702').length === 1, 'lo mismo con la etiqueta de gremio');
  ok(/function reimprimirBoleta[\s\S]{0,200}printRepair\('A5'\)/.test(rep), 'reimprimir a mano (la barra, la ficha) no pasa por esta traba');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})();
