// Roles: qué ve un empleado y qué no.
//
// Cada empleado entra con SU cuenta desde su celular. Puede trabajar —tomar
// reparaciones, ingresar equipos, cargar ventas, gastos y productos— pero no
// tiene que ver la plata del día: ni efectivo en caja, ni neto, ni apertura,
// ni cierre, ni dashboard.
//
// Son DOS capas y conviene no confundirlas:
//   · la pantalla (roles.js + la clase .solo-dueno) — comodidad;
//   · firestore.rules — lo que de verdad frena, y hay que deployarlo aparte.
// Esta prueba mira las dos, y que digan lo mismo.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const rolesSrc = fs.readFileSync(DIR + 'roles.js', 'utf8');
const rules    = fs.readFileSync(DIR + 'firestore.rules', 'utf8');
const css      = fs.readFileSync(DIR + 'style.css', 'utf8');
const cajaJs   = fs.readFileSync(DIR + 'caja.js', 'utf8');
const cajaEx   = fs.readFileSync(DIR + 'caja_extra.js', 'utf8');
const appJs    = fs.readFileSync(DIR + 'app.js', 'utf8');
const cajaHtml = fs.readFileSync(DIR + 'caja.html', 'utf8');
const idxHtml  = fs.readFileSync(DIR + 'index.html', 'utf8');

// ── Sandbox: el roles.js de verdad, con un usuario falso ──
const TOASTS = [];
let USER = null;
const clases = new Set();
const ctx = {
  console, Date, JSON, Object, String, Number, Array,
  document: { body: { classList: {
    add: c => clases.add(c), remove: c => clases.delete(c),
    toggle: (c, f) => { f ? clases.add(c) : clases.delete(c); },
    contains: c => clases.has(c),
  } } },
  currentUser: () => USER,
  toast: (m, t) => TOASTS.push([t, m]),
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(rolesSrc, ctx, { filename: 'roles.js' });
const run = e => vm.runInContext(e, ctx);

const DUENO = 'G9jAIYy86MZ1qTjRmMFyK9yO93e2';

console.log('\n1) Quién es quién');
USER = { uid: DUENO, email: 'guyrepair22@gmail.com' };
ok(run('tpRol()') === 'dueno', 'la cuenta de siempre es la del dueño', run('tpRol()'));
ok(run('tpEsDueno()') === true && run('tpEsEmpleado()') === false, 'y no es empleado');

USER = { uid: 'UID-DE-UN-EMPLEADO', email: 'nacho@techpoint.com' };
ok(run('tpEsEmpleado()') === true, 'una cuenta que no está en la lista NO es dueño');
ok(run('tpRol()') === 'empleado', 'se la trata como empleado: que vea de menos y no de más', run('tpRol()'));
ok(run('tpNombre()') === 'nacho', 'y se la nombra por su mail hasta que se la cargue', run('tpNombre()'));

USER = null;
ok(run('tpEsEmpleado()') === true, 'sin sesión tampoco se abre nada');

console.log('\n2) La pantalla se pinta según el rol');
USER = { uid: 'UID-DE-UN-EMPLEADO' }; clases.clear();
ok(run('aplicarRol()') === true && clases.has('rol-empleado'), 'empleado → body.rol-empleado', [...clases]);
USER = { uid: DUENO }; clases.clear();
ok(run('aplicarRol()') === false && !clases.has('rol-empleado'), 'dueño → no cambia nada', [...clases]);
ok(/body\.rol-empleado \.solo-dueno \{[^}]*display:\s*none/.test(css),
   'y .solo-dueno se esconde solo con esa clase (para el dueño, todo igual)');

console.log('\n3) Quién cargó cada cosa');
USER = { uid: DUENO };
ok(run('JSON.stringify(tpFirma())').includes('cargadoPor'),
   'los movimientos quedan firmados: con varias cuentas, "lo cargó alguien" no sirve', run('JSON.stringify(tpFirma())'));
// La app maneja plata: la firma agrega campos NUEVOS y no toca ninguno de los
// que ya están guardados en Firestore (monto, categoria, fecha, metodoPago...).
const campos = Object.keys(JSON.parse(run('JSON.stringify(tpFirma())')));
ok(JSON.stringify(campos) === '["cargadoPor","cargadoPorUid"]',
   'agrega dos campos nuevos y nada más: no pisa nada de lo ya guardado', campos);
ok(/\.\.\.\(typeof tpFirma === 'function' \? tpFirma\(\) : \{\}\)/.test(cajaJs),
   'la venta de la caja lo guarda');
ok(/\.\.\.\(typeof tpFirma === 'function' \? tpFirma\(\) : \{\}\)/.test(fs.readFileSync(DIR + 'repairs.js', 'utf8')),
   'y el cobro de una reparación también');

console.log('\n4) El modo dueño no se abre con cuenta de empleado');
// El PIN destapa costos y ganancias. Que alguien lo mire por encima del
// hombro no tiene que alcanzar.
TOASTS.length = 0;
USER = { uid: 'UID-DE-UN-EMPLEADO' };
ok(run('tpFrenarEmpleado("El modo dueño")') === true, 'frena');
ok(TOASTS.some(t => /solo del dueño/.test(t[1])), 'y avisa por qué', TOASTS);
USER = { uid: DUENO };
ok(run('tpFrenarEmpleado("El modo dueño")') === false, 'al dueño no lo frena');
[['app.js', appJs, ['openOwnerPinModal', 'toggleOwnerLock', 'requireOwnerPin']],
 ['caja_extra.js', cajaEx, ['openCajaOwnerPin', 'requireCajaOwnerPin']]].forEach(([f, src, fns]) => {
  fns.forEach(fn => {
    const i = src.indexOf('function ' + fn + '(');
    const trozo = src.slice(i, i + 700);
    ok(i > 0 && /tpFrenarEmpleado/.test(trozo), `${f}: ${fn}() tiene la puerta puesta`);
  });
});

console.log('\n5) La plata del día no está en la pantalla del empleado');
// Efectivo en caja y neto del día son justo lo que no tiene que ver.
ok(/id="caja-quickbar"[^>]*solo-dueno|class="caja-quickbar solo-dueno"/.test(cajaHtml),
   'efectivo en caja / neto del día');
ok(/id="caja-detail-panel"[^>]*solo-dueno/.test(cajaHtml), 'apertura, ingresos, egresos y desglose');
ok(/class="caja-date-nav solo-dueno"/.test(cajaHtml), 'y los otros días (que son los totales de otros días)');
ok(/id="nav-dash"[^>]*solo-dueno|class="nav-btn solo-dueno" id="nav-dash"/.test(idxHtml),
   'el dashboard, que es ganancia neta y top de productos, no se abre');
ok(/section === 'dash' && typeof tpEsEmpleado === 'function' && tpEsEmpleado\(\)/.test(appJs),
   'ni por atajo: cae en Equipos');
// La lista de movimientos SÍ se ve: sirve para no cargar dos veces la misma venta.
ok(!/id="caja-list"[^>]*solo-dueno/.test(cajaHtml),
   'la lista de movimientos sí se ve (para no repetir una venta)');

console.log('\n6) Lo que ni siquiera se lee');
// Además de esconderlo: son lecturas de Firestore que no se van a usar, y el
// cupo gratis es de 50.000 por día.
const trozoInit = cajaJs.slice(cajaJs.indexOf('function initApp'), cajaJs.indexOf('function initApp') + 2500);
ok(/if \(typeof tpEsEmpleado !== 'function' \|\| !tpEsEmpleado\(\)\) \{[\s\S]{0,400}loadArqueo\(\)/.test(trozoInit),
   'apertura, cierre, "vs ayer" y turnos no se piden con cuenta de empleado');
['loadCierre()', '_loadYesterdayStats()', 'listenCierresParciales()'].forEach(f =>
  ok(trozoInit.indexOf(f) > trozoInit.indexOf('!tpEsEmpleado()'), `${f} queda adentro del if`));
// El backup diario lee todo el stock vendido y escribe la copia: las reglas se
// lo niegan al empleado, y el celular de él no tiene por qué gastar el cupo.
const trozoBk = appJs.slice(appJs.indexOf('async function autoBackup()'), appJs.indexOf('async function autoBackup()') + 400);
ok(/tpEsEmpleado\(\)\) return;/.test(trozoBk), 'el backup diario no lo intenta el celular del empleado');

console.log('\n7) Los menús');
['Arqueo de caja', 'Cierre de turno', 'Buscar en ventas', 'Reporte del día'].forEach(lbl => {
  const i = cajaJs.indexOf(`label: '${lbl}'`);
  ok(i > 0 && /hide: emp/.test(cajaJs.slice(i, i + 260)), `caja: "${lbl}" no aparece`);
});
['Estadísticas', 'Configuración', 'Exportar stock', 'Descargar backup'].forEach(lbl => {
  const i = appJs.indexOf(`label: '${lbl}'`);
  ok(i > 0 && /hide: _soloDueno\(\)/.test(appJs.slice(i, i + 200)), `inicio: "${lbl}" no aparece`);
});

console.log('\n8) Las puertas de atrás (URL ?action=, teclado)');
['openArqueoModal', 'reopenArqueo', 'openCierreModal', 'openCierreParcialModal',
 'openReporteModal', 'openVentasSearch'].forEach(fn => {
  const i = cajaJs.indexOf('function ' + fn + '(');
  ok(i > 0 && /tpFrenarEmpleado/.test(cajaJs.slice(i, i + 300)), `${fn}() frena al empleado`);
});

console.log('\n9) Las reglas de Firestore: lo que de verdad frena');
// Esconder un botón no protege nada: cualquiera con la consola del navegador
// abierta puede llamar a la función. Lo que decide es esto.
// Las reglas SIN comentarios: lo que explica un comentario no es una regla.
const reglasVivas = rules.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
ok(/function esDueno\(\)/.test(rules) && /function esEmpleado\(\)/.test(rules), 'hay dos roles');
ok(/function isAllowed\(\) \{ return esDueno\(\) \|\| esEmpleado\(\); \}/.test(rules),
   'y los dos pueden entrar a la base');
[['caja_arqueos', 'la apertura'], ['caja_cierres', 'el cierre'],
 ['caja_cierres_parciales', 'los turnos'], ['caja_dueno_movimientos', 'la caja del dueño']].forEach(([col, que]) => {
  const re = new RegExp('match /' + col + "/\\{doc\\}\\s*\\{ allow read, write: if esDueno\\(\\); \\}");
  ok(re.test(rules), `${que} (${col}) es solo del dueño`);
});
ok(/match \/config\/owner \{[\s\S]{0,200}allow read: if esDueno\(\);/.test(rules),
   'el PIN de dueño no se puede ni leer desde una cuenta de empleado');
// Los movimientos de caja son trabajo diario: entran por la regla general,
// que deja cargar y corregir pero no borrar.
ok(!/'caja_movimientos'/.test(reglasVivas), 'los movimientos no estan cerrados: el empleado carga ventas y gastos');
const resto = rules.slice(rules.indexOf('match /{col}/{doc=**}'));
ok(/allow read, create, update: if isAllowed\(\) && !sensible\(col\);/.test(resto) &&
   /allow delete: if esDueno\(\) && !sensible\(col\);/.test(resto),
   'y en el resto (stock, repairs, productos…) tampoco borra');

// ── La trampa de las reglas de Firestore ──
// Matchean TODAS las que aplican y pasa si CUALQUIERA dice que si: no gana la
// mas especifica, gana la mas permisiva. Un `match /{document=**}` abierto al
// final le devuelve al empleado todo lo negado arriba. Me lo comi una vez.
ok(!/match \/\{document=\*\*\}/.test(reglasVivas),
   'no hay un comodin general que pise las reglas de arriba');
const sensibles = (rules.slice(rules.indexOf('function sensible('), rules.indexOf(']', rules.indexOf('function sensible(')))
  .match(/'([a-zA-Z_]+)'/g) || []).map(x => x.replace(/'/g, ''));
// Toda coleccion que tenga su propio bloque solo-dueno tiene que estar en esa
// lista, o el comodin se la devuelve al empleado.
const soloDuenoEnReglas = [];
rules.replace(/match \/([a-zA-Z_]+)\/\{doc\}[^{]*\{([^}]*)\}/g, (todo, col, cuerpo) => {
  if (/esDueno\(\)/.test(cuerpo) && !/isAllowed\(\)/.test(cuerpo)) soloDuenoEnReglas.push(col);
  return todo;
});
const olvidadas = soloDuenoEnReglas.filter(c => sensibles.indexOf(c) === -1);
ok(olvidadas.length === 0,
   'y cada coleccion cerrada esta en sensible(): ' + soloDuenoEnReglas.join(', '), olvidadas);
ok(sensibles.indexOf('config') >= 0, 'config tambien: adentro esta el PIN de dueno', sensibles);
// Sin esto no puede tomar una reparación: el número de orden sale de ahí.
ok(/match \/config\/\{doc\} \{[\s\S]{0,120}allow read, write: if isAllowed\(\);/.test(rules),
   'config sigue abierto: ahí está el contador de números de orden');

console.log('\n10) Las dos listas dicen lo mismo');
// roles.js decide qué se ve; firestore.rules decide qué se puede. Si se
// separan, alguien ve una pantalla que la base le niega (o al revés).
const uidsJs = {};
// Sin las lineas comentadas: el ejemplo de como se agrega un empleado no cuenta.
const rolesVivo = rolesSrc.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
rolesVivo.replace(/'([A-Za-z0-9_-]{16,})':\s*\{[^}]*rol:\s*'(\w+)'/g, (_, uid, rol) => { uidsJs[uid] = rol; return ''; });
const listaDe = fn => {
  const i = rules.indexOf('function ' + fn + '()');
  const trozo = rules.slice(i, rules.indexOf(']', i));
  return (trozo.match(/'([A-Za-z0-9_-]{16,})'/g) || []).map(s => s.replace(/'/g, ''));
};
const duenosRules = listaDe('esDueno');
const empRules = listaDe('esEmpleado').filter(u => !/^PONER_ACA/.test(u));
const duenosJs = Object.keys(uidsJs).filter(u => uidsJs[u] === 'dueno');
const empJs = Object.keys(uidsJs).filter(u => uidsJs[u] === 'empleado');
ok(duenosJs.length === 1 && duenosJs[0] === DUENO, 'el dueño es uno solo', duenosJs);
ok(JSON.stringify(duenosRules.sort()) === JSON.stringify(duenosJs.sort()),
   'la lista de dueños coincide en roles.js y en firestore.rules', [duenosRules, duenosJs]);
ok(JSON.stringify(empRules.sort()) === JSON.stringify(empJs.sort()),
   'la de empleados también (si agregás uno, va en los dos lados)', [empRules, empJs]);

console.log('\n11) Las dos páginas cargan roles.js');
ok(/<script src="roles\.js"><\/script>/.test(cajaHtml), 'caja.html');
ok(/<script defer src="roles\.js"><\/script>/.test(idxHtml), 'index.html');
ok(idxHtml.indexOf('roles.js') > idxHtml.indexOf('auth.js'), 'después de auth.js, que es de donde sale el usuario');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
