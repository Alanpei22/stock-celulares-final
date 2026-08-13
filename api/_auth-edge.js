// ══════════════════════════════════════════
//  _auth-edge.js — el mismo guardia, pero para runtime edge
// ══════════════════════════════════════════
// `ai.js` corre en edge y ahí firebase-admin no funciona (no hay node).
// Se queda en edge a propósito: en el plan gratis una función node corta a los
// 10 segundos y la importación masiva de stock con IA tarda más que eso.
//
// En vez de verificar la firma del token a mano (criptografía escrita por
// nosotros = criptografía rota por nosotros), le preguntamos a Google si el
// token sirve. Es una llamada de red más, pero /api/ai no es un endpoint que
// se use a cada rato.
//
// La apiKey de Firebase es pública por diseño (está en firebase-config.js, que
// el navegador descarga). No es un secreto: lo que protege es la allowlist.

const UIDS_POR_DEFECTO = [
  'G9jAIYy86MZ1qTjRmMFyK9yO93e2',   // guyrepair22@gmail.com (dueño)
];

const FIREBASE_API_KEY_POR_DEFECTO = 'AIzaSyAMRkrADBxRF6rST8rNwO5IqdWneXocBsE';

function uidsPermitidos() {
  const desdeEnv = String(process.env.ALLOWED_UIDS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return desdeEnv.length ? desdeEnv : UIDS_POR_DEFECTO;
}

// Devuelve { ok: true, uid } o { ok: false, motivo }.
export async function verificarSesionEdge(req) {
  const header = String(req.headers.get('authorization') || '');
  if (!header.startsWith('Bearer ')) return { ok: false, motivo: 'sin token' };
  const idToken = header.slice(7).trim();
  if (!idToken) return { ok: false, motivo: 'sin token' };

  const key = process.env.FIREBASE_API_KEY || FIREBASE_API_KEY_POR_DEFECTO;
  let uid = null;
  try {
    const r = await fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + key,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!r.ok) return { ok: false, motivo: 'token inválido' };
    const data = await r.json();
    uid = data && data.users && data.users[0] && data.users[0].localId;
  } catch (e) {
    // Si Google no contesta preferimos cortar: mejor que la IA no ande un rato
    // a dejar la puerta abierta.
    return { ok: false, motivo: 'no se pudo verificar' };
  }

  if (!uid) return { ok: false, motivo: 'token inválido' };
  if (!uidsPermitidos().includes(uid)) return { ok: false, motivo: 'cuenta no autorizada' };
  return { ok: true, uid };
}

// Atajo: devuelve null si pasó, o la Response 401 si hay que cortar.
export async function corteSiNoAutorizadoEdge(req) {
  const s = await verificarSesionEdge(req);
  if (s.ok) return null;
  return new Response(JSON.stringify({ error: 'No autorizado', motivo: s.motivo }), {
    status: 401, headers: { 'content-type': 'application/json' },
  });
}
