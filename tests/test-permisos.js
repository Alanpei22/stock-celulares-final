// Permisos de cada empleado (👥 Empleados → 🔐).
//
// Lo que se cuida:
//  · que la lista de permisos sea la MISMA en roles.js, en /api/usuarios y en
//    las reglas de Firebase (si se separan, la pantalla deja algo que la base
//    niega, o al revés);
//  · que un empleado sin tocar tenga lo de siempre, y que "ninguno" sea ninguno;
//  · que cada permiso frene en la pantalla Y, en lo de plata/borrar, en las reglas.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');
const DUENO = 'G9jAIYy86MZ1qTjRmMFyK9yO93e2';

(async () => {
console.log('\n1) Una sola lista de permisos');
const roles = leer('roles.js'), api = leer('api/usuarios.js'), rules = leer('firestore.rules');
const store = {}; let USER = { uid: 'emp1', email: 'nacho@techpoint.local' };
const TOASTS = [];
const ctx = { console, JSON, Array, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  currentUser: () => USER, toast: (m, t) => TOASTS.push(m), document: { body: { classList: { toggle() {} } } } };
vm.createContext(ctx); vm.runInContext(roles, ctx);
const catalogo = vm.runInContext('TP_PERMISOS.map(p => p.k)', ctx);
const defs = vm.runInContext('TP_PERMISOS_DEF', ctx);
const apiLista = JSON.parse((api.match(/export const PERMISOS = (\[[^\]]+\])/) || [])[1].replace(/'/g, '"'));
const rulesDef = JSON.parse((rules.match(/request\.auth\.token\.get\('perms', (\[[^\]]+\])\)/) || [])[1].replace(/'/g, '"'));
ok(JSON.stringify(catalogo) === JSON.stringify(apiLista), 'roles.js y /api/usuarios tienen los mismos permisos', [catalogo, apiLista]);
ok(JSON.stringify(defs.slice().sort()) === JSON.stringify(rulesDef.slice().sort()), 'y las reglas dan por defecto los mismos que la pantalla', [defs, rulesDef]);
ok(JSON.stringify(defs.slice().sort()) === JSON.stringify(['caja', 'gastos', 'inventario', 'reparaciones', 'stock']),
   'por defecto: lo que un empleado podía hacer antes (caja, gastos, equipos, reparaciones, inventario)', defs);
ok(!defs.includes('totales') && !defs.includes('cierre') && !defs.includes('borrar') && !defs.includes('reporte'),
   'y por defecto NO ve la plata, no cierra, no ve reportes ni borra');

console.log('\n2) Qué puede el empleado logueado');
const puede = p => vm.runInContext(`tpPuede('${p}')`, ctx);
ok(puede('caja') && puede('stock') && !puede('borrar') && !puede('totales'), 'nunca le tocaron los permisos: los de siempre');
store.tpPerms_emp1 = JSON.stringify(['caja', 'totales']);
ok(puede('caja') && puede('totales') && !puede('stock') && !puede('gastos'), 'con permisos elegidos: exactamente esos');
store.tpPerms_emp1 = JSON.stringify([]);
ok(!puede('caja') && !puede('stock'), 'sin ningún permiso: nada (no vuelve a los de siempre)');
store.tpPerms_emp1 = 'null';
ok(puede('caja') && !puede('borrar'), 'null guardado = nunca se tocaron = los de siempre');
store.tpPerms_emp1 = JSON.stringify(['borrar']);
ok(vm.runInContext("tpEmpleadoPuede('borrar')", ctx) === true, 'tpEmpleadoPuede: empleado con ese permiso');
ok(vm.runInContext("tpFrenar('caja', 'usar la caja')", ctx) === true && /No tenés permiso para usar la caja/.test(TOASTS.pop()), 'tpFrenar frena y dice por qué');
USER = { uid: DUENO };
ok(['caja', 'borrar', 'totales', 'cierre', 'reporte'].every(puede), 'el dueño puede todo');
ok(vm.runInContext("tpFrenar('borrar')", ctx) === false && vm.runInContext("tpEmpleadoPuede('borrar')", ctx) === false, 'al dueño no lo frena (y no es "empleado con permiso")');
ok(/getIdTokenResult\(true\)/.test(roles) && /location\.reload\(\)/.test(roles), 'los permisos nuevos se leen al abrir la app (token fresco) y se aplican');

console.log('\n3) /api/usuarios → permisos');
const USERS = { emp1: { uid: 'emp1', email: 'n@techpoint.local', customClaims: { rol: 'empleado', nombre: 'Nacho' }, metadata: {} },
                [DUENO]: { uid: DUENO, customClaims: {}, metadata: {} } };
const CLAIMS = [];
globalThis.__AUTH = { verificarSesion: async () => ({ ok: true, uid: globalThis.__QUIEN }), esDuenoUid: u => u === DUENO,
  getAdmin: () => ({ auth: () => ({ getUser: async u => { if (!USERS[u]) throw new Error('no'); return USERS[u]; },
    setCustomUserClaims: async (u, c) => { USERS[u].customClaims = c; CLAIMS.push([u, c]); } }) }) };
const mod = await import('data:text/javascript;base64,' + Buffer.from(api.replace(/import \{[^}]+\} from '\.\/_auth\.js';/, 'const { verificarSesion, esDuenoUid, getAdmin } = globalThis.__AUTH;')).toString('base64'));
const llamar = async b => { let st = 200, j; const res = { status: c => { st = c; return res; }, json: x => { j = x; return res; } }; await mod.default({ method: 'POST', body: b }, res); return { st, j }; };
globalThis.__QUIEN = DUENO;
let r = await llamar({ accion: 'permisos', uid: 'emp1', perms: ['caja', 'totales', 'hackear', 'borrar'] });
ok(r.st === 200 && JSON.stringify(USERS.emp1.customClaims.perms) === '["caja","totales","borrar"]', 'guarda solo permisos que existen (descarta inventados)', USERS.emp1.customClaims);
ok(USERS.emp1.customClaims.rol === 'empleado' && USERS.emp1.customClaims.nombre === 'Nacho', 'y no le borra el rol ni el nombre');
r = await llamar({ accion: 'permisos', uid: DUENO, perms: [] });
ok(r.st === 404, 'la cuenta del dueño no se toca');
r = await llamar({ accion: 'permisos', uid: 'emp1', perms: 'todo' });
ok(r.st === 400, 'una lista inválida se rechaza');
globalThis.__QUIEN = 'emp1';
r = await llamar({ accion: 'permisos', uid: 'emp1', perms: ['caja', 'totales', 'cierre', 'reporte', 'borrar'] });
ok(r.st === 403, 'un empleado NO se puede dar permisos a sí mismo');

console.log('\n4) Cada permiso frena en la pantalla');
const app = leer('app.js'), caja = leer('caja.js'), rep = leer('repairs.js'), inv = leer('inventario.js'), r2 = leer('repuestos.js');
const tiene = (src, fn, perm) => { const i = src.indexOf(fn); return i >= 0 && new RegExp(`tpFrenar\\('${perm}'`).test(src.slice(i, i + 600)); };
[[app, 'function openForm(', 'stock'], [app, 'async function savePhone(', 'stock'], [app, 'async function deletePhone(', 'borrar'],
 [rep, 'function openRepairForm(', 'reparaciones'], [rep, 'async function saveRepair(', 'reparaciones'], [rep, 'async function deleteRepair(', 'borrar'],
 [inv, 'function openProductoForm(', 'inventario'], [inv, 'async function saveProducto(', 'inventario'],
 [r2, 'function openRepuestoForm(', 'inventario'], [r2, 'function saveRepuesto(', 'inventario'], [r2, 'function deleteRepuesto(', 'borrar'],
 [caja, 'function openMovForm(', 'caja'], [caja, 'async function saveMov(', 'caja'], [caja, 'async function saveMov(', 'gastos'], [caja, 'function deleteMov(', 'borrar'],
].forEach(([src, fn, perm]) => ok(tiene(src, fn, perm), `${fn.replace(/(async )?function /, '').replace('(', '')}(): permiso "${perm}"`));
ok(/tpEmpleadoPuede\('borrar'\)\)\s*\? \(cb => \{ if \(confirm/.test(caja), 'empleado con permiso de borrar: confirma sin PIN de dueño');
ok(/tipo === 'egreso' && typeof tpPuede === 'function' && !tpPuede\('gastos'\)\) tipo = 'ingreso'/.test(caja), 'sin permiso de gastos, la caja solo cobra');
ok(/!tpPuede\('caja'\)\) \{[\s\S]{0,200}location\.replace\('index\.html'\)/.test(caja), 'sin permiso de caja, la caja no abre');
const css = leer('style.css');
catalogo.forEach(p => ok(new RegExp(`body\\.rol-empleado:not\\(\\.p-${p}\\) \\.req-${p} \\{ display: none !important; \\}`).test(css), `CSS: .req-${p} se esconde sin el permiso`));
ok(/req-gastos/.test(leer('caja.html')) && /req-caja/.test(leer('index.html')) && /req-stock/.test(leer('index.html')) && /req-reparaciones/.test(leer('index.html')), 'botones marcados');

console.log('\n5) Y en las reglas de Firebase (lo que de verdad frena)');
ok(/function puedeEscribir\(col\)/.test(rules) && /puede\('caja'\) && \(request\.resource\.data\.get\('tipo', ''\) != 'egreso' \|\| puede\('gastos'\)\)/.test(rules),
   'caja: escribir movimientos pide permiso de caja; los gastos, el de gastos');
ok(/puede\('reparaciones'\) && request\.resource\.data\.get\('tipo', ''\) == 'ingreso'\s*&& request\.resource\.data\.get\('esSena', false\) == true/.test(rules),
   'la seña al tomar una reparación entra con el permiso de reparaciones');
ok(/allow delete: if puede\('borrar'\) && !sensible\(col\);/.test(rules), 'borrar: con permiso de borrar');

console.log('\n6) La pantalla de 👥 Empleados');
const uj = leer('usuarios.js');
ok(/empPermisos\('/.test(uj) && /accion: 'permisos'/.test(uj), 'botón 🔐 por empleado que guarda en /api/usuarios');
ok(/accion: 'crear', nombre, usuario, clave, perms: _empLeerCasillas\('emp-perm-nuevo'\)/.test(uj), 'y al crear se eligen de entrada');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
