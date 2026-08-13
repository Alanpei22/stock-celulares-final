// ══════════════════════════════════════════
//  _auth.js — guardia de las funciones de /api
// ══════════════════════════════════════════
// Estos endpoints están abiertos en internet: cualquiera que sepa la URL los
// puede llamar. Y el registro de Firebase también está abierto, así que "traer
// un token válido" no alcanza: hay que ser una de las cuentas del negocio.
//
// Misma allowlist que firestore.rules. Si sumás un empleado, va en los dos
// lados (o se setea ALLOWED_UIDS en Vercel, que le gana a esta lista).
//
// El nombre empieza con "_" a propósito: Vercel no publica como ruta los
// archivos de /api que arrancan con guión bajo.

import admin from 'firebase-admin';

const UIDS_POR_DEFECTO = [
  'G9jAIYy86MZ1qTjRmMFyK9yO93e2',   // guyrepair22@gmail.com (dueño)
];

export function uidsPermitidos() {
  const desdeEnv = String(process.env.ALLOWED_UIDS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return desdeEnv.length ? desdeEnv : UIDS_POR_DEFECTO;
}

function getAdmin() {
  if (admin.apps.length) return admin;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT env var faltante');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin;
}

// ¿La llamada viene de uno de los crons? Los crons corren en el server, no
// tienen sesión de Firebase, así que se identifican con CRON_SECRET.
export function esCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.authorization || '') === `Bearer ${secret}`;
}

// ¿La llamada viene del navegador con una sesión abierta y autorizada?
// Devuelve { ok: true, uid } o { ok: false, motivo }.
export async function verificarSesion(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return { ok: false, motivo: 'sin token' };
  const token = header.slice(7).trim();
  if (!token) return { ok: false, motivo: 'sin token' };

  let decoded;
  try {
    decoded = await getAdmin().auth().verifyIdToken(token);
  } catch (e) {
    // Vencido, firmado por otro proyecto, manoteado: todo cae acá.
    return { ok: false, motivo: 'token inválido' };
  }
  if (!uidsPermitidos().includes(decoded.uid)) {
    return { ok: false, motivo: 'cuenta no autorizada' };
  }
  return { ok: true, uid: decoded.uid };
}

// Atajo para los handlers: corta con 401 si no pasa. Devuelve true si siguió.
// `permitirCron` para los endpoints que además llaman los crons del server.
export async function exigirSesion(req, res, { permitirCron = false } = {}) {
  if (permitirCron && esCron(req)) return true;
  const s = await verificarSesion(req);
  if (s.ok) return true;
  res.status(401).json({ error: 'No autorizado', motivo: s.motivo });
  return false;
}
