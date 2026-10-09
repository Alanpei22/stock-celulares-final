// Cuentas de empleado creadas desde la app (👥 Empleados → /api/usuarios).
//
// Lo que se cuida:
//  · que SOLO el dueño pueda crear/tocar cuentas, y solo cuentas de empleado
//    (nunca la del dueño);
//  · que la cuenta nueva quede marcada rol=empleado (es lo que miran las
//    reglas de Firebase y /api), y que desactivar corte la sesión;
//  · que las reglas acepten la marca y sigan cerradas para cualquier otra
//    cuenta (el registro de Firebase está abierto);
//  · que el empleado entre con un usuario corto.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');
const DUENO = 'G9jAIYy86MZ1qTjRmMFyK9yO93e2';
const modulo = src => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

(async () => {
console.log('\n1) /api/usuarios: solo el dueño, solo cuentas de empleado');
// Firebase Auth de mentira
const USERS = {
  [DUENO]: { uid: DUENO, email: 'guyrepair22@gmail.com', customClaims: {}, disabled: false, metadata: {} },
  emp1: { uid: 'emp1', email: 'nacho@techpoint.local', displayName: 'Nacho', customClaims: { rol: 'empleado', nombre: 'Nacho' }, disabled: false, metadata: { lastSignInTime: new Date().toISOString() } },
  extra: { uid: 'extra', email: 'random@gmail.com', customClaims: {}, disabled: false, metadata: {} },
};
const LOG = [];
const authMock = {
  listUsers: async () => ({ users: Object.values(USERS) }),
  getUser: async uid => { if (!USERS[uid]) throw new Error('no'); return USERS[uid]; },
  createUser: async ({ email, password, displayName }) => {
    if (Object.values(USERS).some(u => u.email === email)) { const e = new Error('existe'); e.code = 'auth/email-already-exists'; throw e; }
    const uid = 'nuevo' + Object.keys(USERS).length;
    USERS[uid] = { uid, email, displayName, customClaims: {}, disabled: false, metadata: {} };
    LOG.push(['create', email, password]); return USERS[uid];
  },
  setCustomUserClaims: async (uid, c) => { USERS[uid].customClaims = c; LOG.push(['claims', uid, c]); },
  updateUser: async (uid, d) => { Object.assign(USERS[uid], d); LOG.push(['update', uid, d]); },
  revokeRefreshTokens: async uid => LOG.push(['revoke', uid]),
};
let QUIEN = DUENO;
globalThis.__AUTH = {
  verificarSesion: async () => QUIEN ? { ok: true, uid: QUIEN } : { ok: false, motivo: 'sin token' },
  esDuenoUid: uid => uid === DUENO,
  getAdmin: () => ({ auth: () => authMock }),
};
const api = await modulo(leer('api/usuarios.js').replace(/import \{[^}]+\} from '\.\/_auth\.js';/, 'const { verificarSesion, esDuenoUid, getAdmin } = globalThis.__AUTH;'));
const llamar = async (body, method = 'POST') => {
  let st = 200, out;
  const res = { status: c => { st = c; return res; }, json: j => { out = j; return res; } };
  await api.default({ method, body }, res);
  return { st, j: out };
};
let r = await llamar({ accion: 'listar' }, 'GET');
ok(r.st === 405, 'solo POST');
QUIEN = null; r = await llamar({ accion: 'listar' });
ok(r.st === 401, 'sin sesión: 401');
QUIEN = 'emp1'; r = await llamar({ accion: 'crear', nombre: 'Malo', usuario: 'malo', clave: '123456' });
ok(r.st === 403 && !USERS.nuevo3, 'un empleado NO puede crear cuentas', r);
QUIEN = DUENO;
r = await llamar({ accion: 'listar' });
ok(r.st === 200 && r.j.empleados.length === 1 && r.j.empleados[0].usuario === 'nacho', 'lista solo las cuentas de empleado (ni el dueño ni otras)', r.j);
r = await llamar({ accion: 'crear', nombre: 'Juli Gómez', usuario: 'Juli', clave: 'mate42' });
const nuevo = Object.values(USERS).find(u => u.email === 'juli@techpoint.local');
ok(r.st === 200 && nuevo, 'crea la cuenta: "Juli" → juli@techpoint.local', r);
ok(nuevo && nuevo.customClaims.rol === 'empleado' && nuevo.customClaims.nombre === 'Juli Gómez', 'y la marca como empleado, con su nombre', nuevo && nuevo.customClaims);
r = await llamar({ accion: 'crear', nombre: 'Juli', usuario: 'juli', clave: 'otra12' });
ok(r.st === 409, 'usuario repetido: avisa');
r = await llamar({ accion: 'crear', nombre: 'X', usuario: 'x y', clave: '1' });
ok(r.st === 400, 'datos inválidos: avisa', r.j);
LOG.length = 0;
r = await llamar({ accion: 'activo', uid: DUENO, activo: false });
ok(r.st === 404 && !LOG.length && !USERS[DUENO].disabled, 'la cuenta del dueño no se puede desactivar desde acá');
r = await llamar({ accion: 'clave', uid: 'extra', clave: 'hackeo1' });
ok(r.st === 404 && !LOG.length, 'ni tocar una cuenta que no es de empleado');
r = await llamar({ accion: 'activo', uid: 'emp1', activo: false });
ok(r.st === 200 && USERS.emp1.disabled === true && LOG.some(x => x[0] === 'revoke' && x[1] === 'emp1'), 'desactivar: no entra más y se le cortan las sesiones', LOG);
r = await llamar({ accion: 'activo', uid: 'emp1', activo: true });
ok(USERS.emp1.disabled === false, 'y se puede volver a activar');
LOG.length = 0;
r = await llamar({ accion: 'clave', uid: 'emp1', clave: 'nueva99' });
ok(r.st === 200 && USERS.emp1.password === 'nueva99' && LOG.some(x => x[0] === 'revoke'), 'cambiar contraseña (y tiene que volver a entrar)');
r = await llamar({ accion: 'nombre', uid: 'emp1', nombre: 'Ignacio' });
ok(USERS.emp1.customClaims.nombre === 'Ignacio' && USERS.emp1.customClaims.rol === 'empleado', 'cambiar el nombre no le saca el rol', USERS.emp1.customClaims);
ok(api.aMail('nacho') === 'nacho@techpoint.local' && api.aMail('Ana@Gmail.com') === 'ana@gmail.com', 'aMail');

console.log('\n2) La sesión en /api acepta la marca de empleado');
let REVOCADO = false;
globalThis.__ADMIN = { apps: [1], auth: () => ({ verifyIdToken: async (t, check) => {
  if (check && REVOCADO) throw new Error('revocado');
  return { emp: { uid: 'emp9', rol: 'empleado' }, rnd: { uid: 'rnd' }, dueno: { uid: DUENO } }[t];
} }) };
const au = await modulo(leer('api/_auth.js').replace("import admin from 'firebase-admin';", 'const admin = globalThis.__ADMIN;'));
const sesion = t => au.verificarSesion({ headers: { authorization: 'Bearer ' + t } });
ok((await sesion('dueno')).ok, 'el dueño entra');
ok((await sesion('emp')).ok, 'un empleado creado desde la app entra');
ok(!(await sesion('rnd')).ok, 'una cuenta cualquiera (registro abierto) NO');
REVOCADO = true;
ok((await sesion('emp')).motivo === 'cuenta desactivada', 'un empleado desactivado tampoco');
ok(au.esDuenoUid(DUENO) && !au.esDuenoUid('emp9'), 'esDuenoUid');
const edge = leer('api/_auth-edge.js');
ok(/customAttributes/.test(edge) && /rolMarcado !== 'empleado'/.test(edge) && /!u\.disabled/.test(edge), '/api/ai (edge) también acepta la marca, y no a los desactivados');

console.log('\n3) Las reglas de Firebase');
const fr = leer('firestore.rules'), sr = leer('storage.rules');
const esEmp = fr.slice(fr.indexOf('function esEmpleado()'), fr.indexOf('function isAllowed'));
ok(/request\.auth\.token\.rol == 'empleado'/.test(esEmp), 'Firestore: la marca rol=empleado alcanza (no hay que tocar este archivo por cada empleado)');
ok(!/token\.rol == 'dueno'/.test(fr), 'el dueño NO sale de una marca: sigue siendo su UID fijo');
ok(/function esDelNegocio\(\)/.test(sr) && /allow create, update: if esDelNegocio\(\)/.test(sr) && /allow delete: if esDelNegocio\(\)/.test(sr),
   'Storage: subir/borrar fotos solo cuentas del negocio');
ok(!/allow write: if request\.auth != null/.test(sr), 'Storage ya no deja a cualquier cuenta registrada');
ok(sr.includes(`'${DUENO}'`), 'Storage conoce al dueño');
const api2 = leer('api/usuarios.js');
ok(/rol: 'empleado'/.test(api2) && !/rol: 'dueno'/.test(api2), '/api/usuarios solo puede crear empleados, nunca dueños');

console.log('\n4) Entrar con usuario corto');
const authJs = leer('auth.js');
const m = authJs.match(/const TP_DOMINIO_EMPLEADOS[\s\S]*?function tpMailDeUsuario[\s\S]*?\n\}/);
const c = {}; vm.createContext(c); vm.runInContext(m[0] + ';this.f = tpMailDeUsuario;', c);
ok(c.f('Nacho ') === 'nacho@techpoint.local' && c.f('alan@gmail.com') === 'alan@gmail.com', '"nacho" → nacho@techpoint.local; un mail queda igual');
ok(/signInWithEmailAndPassword\(\s*tpMailDeUsuario\(email\)/.test(authJs), 'signIn lo usa');
const lg = leer('login.html');
ok(/id="email" type="text"/.test(lg) && /Usuario o email/.test(lg), 'el login acepta usuario (no exige un mail)');
ok(/auth\/user-disabled/.test(lg), 'cuenta desactivada: lo dice');
ok(/techpoint\\\.local/.test(lg) && /Pedile al dueño/.test(lg), '"olvidé mi contraseña" de un empleado: se la cambia el dueño');

console.log('\n5) En la app');
const app = leer('app.js'), uj = leer('usuarios.js'), ix = leer('index.html'), roles = leer('roles.js');
ok((app.match(/label: 'Empleados'[^\n]*hide: _soloDueno\(\)/g) || []).length === 2, '👥 Empleados en el menú, solo para el dueño');
ok(/requireOwnerPin\(abrir/.test(uj), 'y pide el PIN de dueño');
ok(ix.includes('src="usuarios.js"'), 'usuarios.js se carga');
ok(/apiFetch\('\/api\/usuarios'/.test(uj), 'habla con /api/usuarios con la sesión');
ok(/tpLeerMarca\(\)/.test(roles) && /tpNombre_/.test(roles), 'el nombre del empleado sale de su cuenta (para firmar ventas y reparaciones)');
const ctx = { localStorage: { getItem: k => k === 'tpNombre_emp1' ? 'Nacho' : null, setItem() {} },
  currentUser: () => ({ uid: 'emp1', email: 'nacho@techpoint.local' }), document: { body: { classList: { toggle() {} } } } };
vm.createContext(ctx); vm.runInContext(roles, ctx);
ok(vm.runInContext('tpNombre()', ctx) === 'Nacho' && vm.runInContext('tpEsEmpleado()', ctx), 'firma con su nombre y es empleado');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
