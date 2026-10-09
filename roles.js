// ══════════════════════════════════════════════════════════════
//  roles.js — quién es cada cuenta
//  ─────────────────────────────────────────────────────────────
//  Cada empleado entra con SU cuenta desde su celular. Dos roles:
//
//   · dueno    — ve todo (es la cuenta de siempre).
//   · empleado — trabaja: toma reparaciones, ingresa equipos, carga ventas,
//                gastos y productos al inventario. NO ve la plata del día:
//                ni efectivo en caja, ni neto, ni apertura, ni desglose, ni
//                reporte, ni cierre, ni dashboard, ni estadísticas.
//
//  ── Cómo se sabe quién es quién ──────────────────────────────
//  Por el UID de Firebase, acá abajo. Está hardcodeado a propósito:
//   · cuesta CERO lecturas de Firestore (el cupo gratis es de 50.000/día);
//   · para que un empleado pueda tocar la base hay que agregarlo igual a
//     `firestore.rules`, así que no agrega un paso que no existiera.
//
//  ⚠️ Esta lista y la de `firestore.rules` tienen que decir lo mismo.
//     tests/test-roles.js falla si se separan.
//
//  ── Agregar un empleado ──────────────────────────────────────
//  Desde la app: ☰ → 👥 Empleados (usuarios.js + api/usuarios.js). La cuenta
//  queda con la marca rol=empleado y entra sola, sin tocar este archivo.
//  Lo de abajo es la forma vieja, a mano (sigue andando):
//  ── A mano (3 pasos) ─────────────────────────────────────────
//  1. Firebase Console → Authentication → "Agregar usuario" con su mail y
//     una contraseña provisoria. Copiá el UID que queda en la lista.
//  2. Agregalo acá abajo Y en `firestore.rules` (lista de `esEmpleado`).
//  3. `firebase deploy --only firestore:rules --project stockcelustech`
//     y `git push` (las reglas NO viajan con el push, van por separado).
//
//  Ojo: lo que esconde la pantalla es comodidad; lo que de verdad frena
//  son las reglas de Firestore. Por eso el paso 3 no es opcional.
// ══════════════════════════════════════════════════════════════
'use strict';

const TP_USUARIOS = {
  // UID de Firebase Auth : { nombre para mostrar, rol }
  'G9jAIYy86MZ1qTjRmMFyK9yO93e2': { nombre: 'Alan', rol: 'dueno' },   // guyrepair22@gmail.com
  // ── Empleados ──
  // 'UID_DEL_EMPLEADO': { nombre: 'Nombre', rol: 'empleado' },
};

// ── Permisos de cada empleado ────────────────────────────────
// El dueño elige qué puede hacer cada empleado (👥 Empleados → 🔐).
// Viajan en la marca de su cuenta (`perms`, la pone api/usuarios.js) y los
// frenan DOS lados: la pantalla (esconde y avisa) y las reglas de Firebase
// en lo que importa (la caja, la plata del día, los cierres y borrar).
// `def`: lo que tiene un empleado al que nunca se le tocaron los permisos
// (= lo que podía hacer antes de que existiera esto).
// ⚠️ La misma lista de claves está en api/usuarios.js y en firestore.rules
//    (los `def`). tests/test-permisos.js falla si se separan.
const TP_PERMISOS = [
  { k: 'caja',         nombre: 'Usar la caja',               desc: 'Cobrar ventas y reparaciones',                    def: true },
  { k: 'gastos',       nombre: 'Cargar gastos',              desc: 'Egresos de la caja',                              def: true },
  { k: 'totales',      nombre: 'Ver la plata del día',       desc: 'Efectivo en caja, neto, apertura y otros días',  def: false },
  { k: 'cierre',       nombre: 'Abrir y cerrar la caja',     desc: 'Apertura, arqueo, cierre de turno y del día',    def: false },
  { k: 'reporte',      nombre: 'Reportes y estadísticas',    desc: 'Reporte del día, dashboard, buscar en ventas',   def: false },
  { k: 'stock',        nombre: 'Cargar y editar equipos',    desc: 'Stock de celulares en venta',                     def: true },
  { k: 'reparaciones', nombre: 'Tomar y editar reparaciones', desc: 'Ingresos, estados y fichas de reparación',       def: true },
  { k: 'inventario',   nombre: 'Accesorios y repuestos',     desc: 'Cargar y editar productos',                       def: true },
  { k: 'borrar',       nombre: 'Borrar cosas',               desc: 'Movimientos, equipos, reparaciones, productos',   def: false },
];
const TP_PERMISOS_DEF = TP_PERMISOS.filter(p => p.def).map(p => p.k);

// Empleados creados desde la app (👥 Empleados): el nombre viene en la marca
// de la cuenta (custom claim). Se lee una vez y queda guardado por UID para
// que la próxima vez esté al instante.
function _tpNombreGuardado(uid) {
  try { return localStorage.getItem('tpNombre_' + uid) || ''; } catch { return ''; }
}
function tpLeerMarca() {
  try {
    const u = (typeof currentUser === 'function') ? currentUser() : null;
    if (!u || TP_USUARIOS[u.uid] || !u.getIdTokenResult) return;
    // `true` = pedir el token de nuevo: si el dueño le cambió los permisos,
    // valen desde que abre la app (y las reglas de Firebase ven los nuevos).
    u.getIdTokenResult(true).then(r => {
      const c = (r && r.claims) || {};
      if (c.nombre) try { localStorage.setItem('tpNombre_' + u.uid, String(c.nombre)); } catch {}
      // JSON: null = nunca se tocaron (van los de siempre); [] = ninguno
      const nuevos = JSON.stringify(Array.isArray(c.perms) ? c.perms.slice().sort() : null);
      let viejos = null;
      try { viejos = localStorage.getItem('tpPerms_' + u.uid); localStorage.setItem('tpPerms_' + u.uid, nuevos); } catch {}
      // Cambiaron desde la última vez: se recarga para que la pantalla los use
      // (solo una vez: la próxima ya coinciden).
      if (viejos !== null && viejos !== nuevos && typeof location !== 'undefined') location.reload();
      else if (viejos === null) aplicarRol();
    }).catch(() => {});
  } catch {}
}

// Los permisos del empleado logueado (los guardados de su marca; si nunca se
// tocaron, los de siempre).
function tpPermisos() {
  const u = tpUsuario();
  if (!u) return [];
  if (u.rol === 'dueno') return TP_PERMISOS.map(p => p.k);
  let guardado = null;
  try { guardado = localStorage.getItem('tpPerms_' + u.uid); } catch {}
  let lista = null;
  try { lista = JSON.parse(guardado); } catch {}
  return Array.isArray(lista) ? lista : TP_PERMISOS_DEF.slice();
}

// ¿Puede hacer esto? El dueño, todo.
function tpPuede(perm) { return tpEsDueno() || tpPermisos().indexOf(perm) >= 0; }
// Empleado al que el dueño le dio este permiso (para saltear el PIN de dueño
// en lo que antes era solo del dueño, como borrar).
function tpEmpleadoPuede(perm) { return tpEsEmpleado() && tpPermisos().indexOf(perm) >= 0; }

// Freno para una acción con permiso: true = no puede (y avisa).
function tpFrenar(perm, queEs) {
  if (tpPuede(perm)) return false;
  try { if (typeof toast === 'function') toast(`No tenés permiso para ${queEs || 'eso'}. Pedíselo al dueño.`, 'error'); } catch {}
  return true;
}

// Cuenta logueada. Una cuenta que NO esté en la lista se trata como empleado:
// si me olvidé de sumarla, que vea de menos y no de más.
function tpUsuario() {
  let u = null;
  try { u = (typeof currentUser === 'function') ? currentUser() : null; } catch {}
  if (!u) return null;
  const ficha = TP_USUARIOS[u.uid];
  if (ficha) return { uid: u.uid, nombre: ficha.nombre, rol: ficha.rol };
  const nombre = _tpNombreGuardado(u.uid) || u.displayName || (u.email || 'Usuario').split('@')[0];
  return { uid: u.uid, nombre, rol: 'empleado', desconocido: !_tpNombreGuardado(u.uid) && !u.displayName };
}

function tpRol()        { const u = tpUsuario(); return u ? u.rol : 'empleado'; }
function tpEsDueno()    { return tpRol() === 'dueno'; }
function tpEsEmpleado() { return !tpEsDueno(); }

// Nombre para firmar movimientos y reparaciones ("lo cargó Fulano").
function tpNombre() { const u = tpUsuario(); return u ? u.nombre : ''; }

// Quién cargó esto. Campos NUEVOS: no pisan nada de lo que ya está guardado.
function tpFirma() {
  const u = tpUsuario();
  if (!u) return {};
  return { cargadoPor: u.nombre, cargadoPorUid: u.uid };
}

// ── Pintar la pantalla según el rol ──────────────────────────
// `body.rol-empleado` + la clase `.solo-dueno` en el HTML hacen el trabajo.
// Para el dueño no cambia absolutamente nada.
function aplicarRol() {
  tpLeerMarca();   // nombre del empleado (si lo creó el dueño desde la app)
  const emp = tpEsEmpleado();
  try {
    document.body.classList.toggle('rol-empleado', emp);
    document.body.classList.toggle('rol-dueno', !emp);
    // Una clase por permiso: `.req-totales` se ve solo con `body.p-totales`
    const tiene = tpPermisos();
    TP_PERMISOS.forEach(p => document.body.classList.toggle('p-' + p.k, tiene.indexOf(p.k) >= 0));
  } catch {}
  // Un empleado no entra a modo dueño aunque adivine el PIN: la cuenta no lo tiene.
  if (emp) {
    try {
      if (typeof OWNER_MODE !== 'undefined' && OWNER_MODE && typeof lockOwnerMode === 'function') lockOwnerMode();
    } catch {}
  }
  return emp;
}

// Cortafuegos para las acciones que son del dueño. Devuelve true si hay que
// frenar. Se usa arriba de todo en las funciones que abren plata.
function tpFrenarEmpleado(queEs) {
  if (tpEsDueno()) return false;
  try { if (typeof toast === 'function') toast((queEs || 'Eso') + ' es solo del dueño', 'error'); } catch {}
  return true;
}
