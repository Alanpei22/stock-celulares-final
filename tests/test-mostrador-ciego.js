// 🙈 Modo mostrador y arqueo ciego. Alan (20/11): "necesito ocultar todo del
// usuario principal, total caja diaria, cuando se haga el arqueo que sea
// ciego". En la compu del local queda abierta la cuenta del dueño: con el
// modo mostrador prendido EN ESA COMPU trabaja como un empleado (sin ver la
// plata) hasta que se pone el PIN; y el que cuenta la caja no ve lo esperado.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const LS = {};
const clases = new Set();
const TOASTS = [];
const ctx = {
  console, JSON, Math, Object, Array, String, globalThis: null,
  localStorage: { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: k => { delete LS[k]; } },
  document: {
    body: { classList: { toggle: (c, v) => { if (v) clases.add(c); else clases.delete(c); } } },
    getElementById: () => null, createElement: () => ({}), head: { appendChild() {} },
  },
  toast: m => TOASTS.push(m),
  _USER: { uid: 'G9jAIYy86MZ1qTjRmMFyK9yO93e2', email: 'x@y' },
};
ctx.globalThis = ctx;
ctx.currentUser = () => ctx._USER;
vm.createContext(ctx);
vm.runInContext(leer('roles.js'), ctx, { filename: 'roles.js' });
const run = c => vm.runInContext(c, ctx);

console.log('\n1) La cuenta del dueño, sin modo mostrador: igual que siempre');
ok(run('tpEsDueno()') === true && run("tpPuede('totales')") === true && run('cajaCiega()') === false, 've todo y el arqueo no es ciego');

console.log('\n2) Con el modo mostrador prendido en esta compu');
run('tpMostradorPoner(true)');
ok(LS['tp-mostrador'] === '1', 'se guarda en esta compu (no en la cuenta: el celu del dueño no cambia)');
ok(run('tpEsDueno()') === false && run('tpCuentaDueno()') === true, 'la cuenta del dueño trabaja como empleado (pero se sabe que es la del dueño)');
ok(run("tpPuede('totales')") === false && run("tpPuede('reporte')") === false && run("tpPuede('borrar')") === false, 'no ve la plata del día, ni reportes, ni puede borrar');
ok(run("tpPuede('caja')") && run("tpPuede('cierre')") && run("tpPuede('stock')") && run("tpPuede('reparaciones')"), 'sí cobra, abre y cierra la caja, carga equipos y reparaciones');
ok(run('cajaCiega()') === true, 'el arqueo y el cierre son a ciegas');
ok(clases.has('rol-empleado') && clases.has('tp-mostrador') && !clases.has('p-totales'), 'la pantalla esconde lo de la plata (y marca que es el mostrador)');
ok(run("tpFrenarEmpleado('El modo dueño')") === false, 'puede pedir el PIN de dueño (es la forma de ver todo)');
TOASTS.length = 0;
ok(run("tpFrenarEmpleado('Ver los chequeos')") === true && TOASTS.length === 1, 'lo demás "solo del dueño" sigue frenado sin el PIN');

console.log('\n3) Con el PIN puesto');
ctx._cajaIsOwner = true;
ok(run('tpEsDueno()') === true && run("tpPuede('totales')") === true && run('cajaCiega()') === false, 've todo (hasta que el modo dueño se bloquea solo)');
ctx._cajaIsOwner = false;
ok(run('tpEsDueno()') === false, 'al bloquearse, vuelve a esconder');

console.log('\n4) Un empleado de verdad no cambia');
ctx._USER = { uid: 'OTRO', email: 'nacho@techpoint.local' };
ok(run('tpEsDueno()') === false && run('tpCuentaDueno()') === false, 'sigue siendo empleado');
TOASTS.length = 0;
ok(run("tpFrenarEmpleado('El modo dueño')") === true, 'y NO puede pedir el PIN de dueño (aunque lo haya visto)');
ok(run('cajaCiega()') === true, 'sin permiso de ver la plata, cuenta a ciegas');
run('tpMostradorPoner(false)');
ctx._USER = { uid: 'G9jAIYy86MZ1qTjRmMFyK9yO93e2' };
ok(run('tpEsDueno()') === true, 'apagando el modo mostrador, el dueño vuelve a ver todo sin PIN');

console.log('\n5) La caja a ciegas');
const caja = leer('caja.js');
ok(/\['cierre-esperado-val', 'cierre-dif-val', 'cierre-usd-dif-val'\]\.forEach[\s\S]{0,160}row\.style\.display = ciega \? 'none' : ''/.test(caja), 'cierre: no se ve lo esperado ni la diferencia');
ok(/if \(ciega\) \{\s*if \(!confirm\(`🔐 Cerrar la caja con \$\$\{contado/.test(caja), 'al confirmar no se avisa la diferencia (sería decir cuánto había)');
ok(/if \(ciega\) toast\('🔐 Cierre guardado\. La diferencia la ve el dueño\.'/.test(caja), 'ni después de guardar');
ok(/const ciega = typeof cajaCiega === 'function' && cajaCiega\(\);\s*if \(ciega\) rows\.push/.test(caja), 'cambio de turno: sin la plata del turno ni lo esperado');
ok(/if \(typeof cajaCiega === 'function' && cajaCiega\(\)\) cajaChicaPreset = 0;/.test(caja), 'apertura: no se dice cuánto se dejó de caja chica (hay que contarlo)');
ok(/diferencia: esperado === null \? null : total - esperado/.test(leer('chequeo.js')) && /tpEsDueno\(\) && detalle\.diferencia !== null/.test(leer('chequeo.js')), 'los chequeos de horario ya eran ciegos (la diferencia, solo el dueño)');

console.log('\n6) Enganchado');
ok(/label: 'Modo mostrador \(esta compu\)'/.test(caja) && /hide: !\(typeof tpEsDueno === 'function' && tpEsDueno\(\)\), onClick: cajaMostradorToggle/.test(caja), 'caja → Arqueo y chequeos → 🙈 Modo mostrador (solo el dueño lo prende o lo apaga)');
ok(/label: 'Modo dueño', hide: emp && !\(typeof tpCuentaDueno/.test(caja), 'el "Modo dueño" sigue en el menú en modo mostrador');
ok(/tpRepintar\(\)/.test(leer('caja_extra.js')) && /tpRepintar/.test(leer('app.js')), 'al poner o sacar el PIN, la pantalla se repinta');
ok(/tp-mostrador \.owner-lock-btn\.solo-dueno/.test(leer('roles.js')), 'en la página principal el candado del modo dueño sigue a la vista');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
