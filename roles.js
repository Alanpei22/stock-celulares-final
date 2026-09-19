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
//  ── Agregar un empleado (3 pasos) ────────────────────────────
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

// Cuenta logueada. Una cuenta que NO esté en la lista se trata como empleado:
// si me olvidé de sumarla, que vea de menos y no de más.
function tpUsuario() {
  let u = null;
  try { u = (typeof currentUser === 'function') ? currentUser() : null; } catch {}
  if (!u) return null;
  const ficha = TP_USUARIOS[u.uid];
  if (ficha) return { uid: u.uid, nombre: ficha.nombre, rol: ficha.rol };
  return { uid: u.uid, nombre: (u.email || 'Usuario').split('@')[0], rol: 'empleado', desconocido: true };
}

function tpRol()        { const u = tpUsuario(); return u ? u.rol : 'empleado'; }
function tpEsDueno()    { return tpRol() === 'dueno'; }
function tpEsEmpleado() { return !tpEsDueno(); }

// Nombre para firmar movimientos y reparaciones ("lo cargó Fulano").
function tpNombre() { const u = tpUsuario(); return u ? u.nombre : ''; }
function tpUid()    { const u = tpUsuario(); return u ? u.uid : ''; }

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
  const emp = tpEsEmpleado();
  try {
    document.body.classList.toggle('rol-empleado', emp);
    document.body.classList.toggle('rol-dueno', !emp);
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
