// Vercel Function — POST /api/usuarios
// Cuentas de los empleados, administradas desde la app (👥 Empleados).
//
// Antes, sumar un empleado era tocar tres archivos y volver a publicar las
// reglas de Firebase. Ahora la cuenta se crea acá con la marca rol=empleado
// (custom claim de Firebase Auth) y las reglas ya la aceptan: no hay que
// tocar código ni publicar nada.
//
// SOLO EL DUEÑO. Ni un empleado puede crear otro empleado, ni nadie puede
// tocar una cuenta que no sea de empleado (la del dueño, por ejemplo).
//
// Body: { accion, ... }
//   listar
//   crear       { nombre, usuario, clave }
//   activo      { uid, activo }        → desactivar corta la sesión ya
//   clave       { uid, clave }
//   nombre      { uid, nombre }

import { verificarSesion, esDuenoUid, getAdmin } from './_auth.js';

const DOMINIO = 'techpoint.local';   // "nacho" → nacho@techpoint.local

export function aMail(usuario) {
  const u = String(usuario || '').trim().toLowerCase();
  if (!u) return '';
  if (u.includes('@')) return u;
  return `${u}@${DOMINIO}`;
}

export function validar({ nombre, usuario, clave }, { crear = false } = {}) {
  if (nombre !== undefined) {
    const n = String(nombre || '').trim();
    if (n.length < 2 || n.length > 30) return 'El nombre tiene que tener entre 2 y 30 letras';
  }
  if (crear || usuario !== undefined) {
    const mail = aMail(usuario);
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(mail)) return 'Usuario inválido: usá letras, números y puntos (ej: nacho)';
  }
  if (crear || clave !== undefined) {
    const c = String(clave || '');
    if (c.length < 6) return 'La contraseña tiene que tener al menos 6 caracteres';
    if (c.length > 64) return 'La contraseña es demasiado larga';
  }
  return null;
}

function ficha(u) {
  const c = u.customClaims || {};
  return {
    uid: u.uid,
    nombre: c.nombre || u.displayName || (u.email || '').split('@')[0],
    usuario: (u.email || '').endsWith('@' + DOMINIO) ? u.email.split('@')[0] : (u.email || ''),
    activo: !u.disabled,
    creado: u.metadata?.creationTime || null,
    ultimoIngreso: u.metadata?.lastSignInTime || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const s = await verificarSesion(req);
  if (!s.ok) return res.status(401).json({ error: 'No autorizado', motivo: s.motivo });
  if (!esDuenoUid(s.uid)) return res.status(403).json({ error: 'Solo el dueño administra las cuentas' });

  const b = req.body || {};
  let auth;
  try { auth = getAdmin().auth(); }
  catch (e) { return res.status(500).json({ error: 'Falta FIREBASE_SERVICE_ACCOUNT en Vercel' }); }

  // Solo se tocan cuentas marcadas como empleado (nunca la del dueño)
  async function empleado(uid) {
    if (!uid || typeof uid !== 'string' || esDuenoUid(uid)) return null;
    try {
      const u = await auth.getUser(uid);
      return (u.customClaims || {}).rol === 'empleado' ? u : null;
    } catch { return null; }
  }

  try {
    switch (b.accion) {
      case 'listar': {
        const lista = [];
        let token;
        do {
          const r = await auth.listUsers(1000, token);
          r.users.forEach(u => { if ((u.customClaims || {}).rol === 'empleado') lista.push(ficha(u)); });
          token = r.pageToken;
        } while (token);
        lista.sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre));
        return res.status(200).json({ empleados: lista, dominio: DOMINIO });
      }

      case 'crear': {
        const err = validar(b, { crear: true });
        if (err) return res.status(400).json({ error: err });
        const nombre = String(b.nombre).trim();
        const email = aMail(b.usuario);
        let u;
        try {
          u = await auth.createUser({ email, password: String(b.clave), displayName: nombre });
        } catch (e) {
          if (e.code === 'auth/email-already-exists') return res.status(409).json({ error: 'Ya existe una cuenta con ese usuario' });
          throw e;
        }
        await auth.setCustomUserClaims(u.uid, { rol: 'empleado', nombre });
        return res.status(200).json({ empleado: ficha({ ...u, customClaims: { rol: 'empleado', nombre } }), email });
      }

      case 'activo': {
        const u = await empleado(b.uid);
        if (!u) return res.status(404).json({ error: 'No es una cuenta de empleado' });
        const activo = b.activo === true;
        await auth.updateUser(u.uid, { disabled: !activo });
        // Desactivar corta las sesiones abiertas (el celu del empleado sale)
        if (!activo) await auth.revokeRefreshTokens(u.uid);
        return res.status(200).json({ ok: true });
      }

      case 'clave': {
        const u = await empleado(b.uid);
        if (!u) return res.status(404).json({ error: 'No es una cuenta de empleado' });
        const err = validar({ clave: b.clave });
        if (err) return res.status(400).json({ error: err });
        await auth.updateUser(u.uid, { password: String(b.clave) });
        await auth.revokeRefreshTokens(u.uid);   // tiene que volver a entrar con la nueva
        return res.status(200).json({ ok: true });
      }

      case 'nombre': {
        const u = await empleado(b.uid);
        if (!u) return res.status(404).json({ error: 'No es una cuenta de empleado' });
        const err = validar({ nombre: b.nombre });
        if (err) return res.status(400).json({ error: err });
        const nombre = String(b.nombre).trim();
        await auth.setCustomUserClaims(u.uid, { ...(u.customClaims || {}), rol: 'empleado', nombre });
        await auth.updateUser(u.uid, { displayName: nombre });
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'Acción inválida' });
    }
  } catch (e) {
    console.error('api/usuarios:', e);
    return res.status(500).json({ error: 'No se pudo completar: ' + (e.message || 'error') });
  }
}
