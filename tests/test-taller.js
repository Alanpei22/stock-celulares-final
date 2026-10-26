// 🔧 Tablero del taller (vista del Dashboard, sin montos).
//
// Alan quiere ver en la compu del local qué hay en el taller, qué está listo
// para retirar, qué se demora y quién está trabajando, sin que se vea plata.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ctx = { console, Math, Date, JSON, Number, String, Array, Object, Set };
vm.createContext(ctx);
vm.runInContext(leer('horas.js'), ctx, { filename: 'horas.js' });
vm.runInContext(leer('taller.js'), ctx, { filename: 'taller.js' });
const run = (c, v) => { ctx._v = v; return vm.runInContext(c, ctx); };
const h = n => new Date(Date.now() - n * 3600e3).toISOString();

console.log('\n1) Las columnas');
const R = [
  { id: 'a', estado: 'reparando', fechaIngreso: h(5) },
  { id: 'b', estado: 'reparando', fechaIngreso: h(100) },
  { id: 'c', estado: 'listo', fechaIngreso: h(30) },
  { id: 'd', estado: 'entregado', fechaIngreso: h(30), fechaEntrega: h(0.5) },
  { id: 'e', estado: 'no va', fechaIngreso: h(10) },
];
const c = run('tallerColumnas(_v)', R);
ok(c.reparando.map(r => r.id).join() === 'a', 'en reparación: las del día a día', c.reparando.map(r => r.id));
ok(c.demoradas.map(r => r.id).join() === 'b', 'demoradas: más de 3 días reparando (la misma cuenta que la app)', c.demoradas.map(r => r.id));
ok(c.listas.map(r => r.id).join() === 'c', 'listas para retirar', c.listas.map(r => r.id));
ok(![...c.reparando, ...c.listas, ...c.demoradas].some(r => r.id === 'd' || r.id === 'e'), 'las entregadas y las que no van no ocupan lugar');

// Órdenes de hace años que nunca se cerraron no tapan el taller
const v = run('tallerColumnas(_v)', [{ id: 'x', estado: 'listo', fechaIngreso: h(945 * 24) }, { id: 'y', estado: 'reparando' }, { id: 'z', estado: 'listo', fechaIngreso: h(20) }]);
ok(v.listas.length === 1 && v.viejas.listas === 1 && v.viejas.reparando === 1, 'las de hace más de 60 días (o sin fecha) se cuentan aparte', v.viejas);

console.log('\n2) Lo de hoy');
const hoy = run('tallerHoy(_v)', [{ fechaIngreso: h(0.2), estado: 'reparando' }, { fechaIngreso: h(50), estado: 'entregado', fechaEntrega: h(0.1) }, { fechaIngreso: h(80), estado: 'reparando' }]);
ok(hoy.entraron === 1 && hoy.entregadas === 1, 'cuántas entraron y cuántas se entregaron hoy', hoy);

console.log('\n3) Quién está trabajando (del fichaje)');
const T = n => ({ toMillis: () => Date.now() - n * 3600e3 });
const ahoraMed = Date.parse(new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10) + 'T12:00:00-03:00');
const ad = run(`tallerAdentro(_v, ${ahoraMed})`, [
  { uid: '1', nombre: 'Nacho', tipo: 'entrada', ts: { toMillis: () => ahoraMed - 3 * 3600e3 } },
  { uid: '2', nombre: 'Mati', tipo: 'entrada', ts: { toMillis: () => ahoraMed - 2 * 3600e3 } },
  { uid: '2', nombre: 'Mati', tipo: 'salida', ts: { toMillis: () => ahoraMed - 1 * 3600e3 } },
]);
ok(ad.length === 1 && ad[0].nombre === 'Nacho', 'solo los que ficharon entrada y no salida', ad);
ok(run("tallerColor('Nacho')") === run("tallerColor('nacho ')"), 'cada uno tiene siempre el mismo color de avatar');

console.log('\n4) Sin plata');
const t = leer('taller.js');
ok(!/monto|precio|sena|seña|presupuesto|cobrad/i.test(t.replace(/\/\/.*$/gm, '')), 'el tablero no lee ni muestra montos');
ok(/#dash-section\.modo-taller \.dash-body > \*:not\(\.d-topbar\):not\(\.d-taller\) \{ display: none !important; \}/.test(t),
   'en modo taller se esconde todo lo demás del dashboard (ganancia, ventas, top)');
// Los estilos viajan con el JS: con el CSS del caché viejo el tablero salía
// como texto suelto en el celu (y sin la regla que esconde los montos).
ok(/function _tlEstilos\(\)/.test(t) && /_tlEstilos\(\);   \/\/ antes de esconder los números/.test(t), 'los estilos van con el programa, no dependen del CSS guardado');

console.log('\n5) Enganchado en el Dashboard');
const ix = leer('index.html');
ok(/onclick="tallerModo\('numeros'\)"/.test(ix) && /onclick="tallerModo\('taller'\)"/.test(ix) && /id="d-taller"/.test(ix), 'botones 📊 Números / 🔧 Taller');
ok(/src="taller\.js"/.test(ix), 'carga taller.js');
const app = leer('app.js');
ok(/tallerModoGuardado\(\) === 'taller'/.test(app), 'la compu del local queda en la vista que se usó la última vez');
ok(/if \(typeof tallerActivo === 'function' && tallerActivo\(\)\) \{ tallerRender\(\); return; \}/.test(app), 'se actualiza solo cuando cambia una reparación');
ok(/_tlDejar\(\)/.test(app), 'y deja de escuchar las fichadas al salir del dashboard (cupo)');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
