// ══════════════════════════════════════════
//  auth.js — TechPoint (SCF)
//  Firebase Auth helpers — app single-tenant.
//  Cargar DESPUÉS de firebase-auth-compat.js y firebase-config.js.
// ══════════════════════════════════════════
'use strict';

let _auth = null;
function _a() { return _auth || (_auth = _fbAuth()); }

// ── Estado actual ─────────────────────────────────────────
function currentUser() {
  try { return _a().currentUser; } catch { return null; }
}

function isAuthed() { return !!currentUser(); }

// ── onAuthStateChanged con Promise ───────────────────────
// Resuelve una única vez cuando Firebase decide si hay sesión.
function waitForAuth() {
  return new Promise(resolve => {
    const unsub = _a().onAuthStateChanged(user => {
      unsub();
      resolve(user || null);
    });
  });
}

function onAuthChange(cb) { return _a().onAuthStateChanged(cb); }

// ── Login ─────────────────────────────────────────────────
async function signIn(email, password) {
  if (!email || !password) throw new Error('Email y contraseña requeridos');
  const cred = await _a().signInWithEmailAndPassword(
    String(email).trim().toLowerCase(),
    String(password)
  );
  return cred.user;
}

// ── Logout ────────────────────────────────────────────────
async function signOut() {
  // Cancelar todos los listeners Firestore activos antes de cerrar sesión
  try { if (typeof window._appCleanup     === 'function') window._appCleanup();     } catch {}
  try { if (typeof window._repairsCleanup === 'function') window._repairsCleanup(); } catch {}
  try { if (typeof window._repuestosCleanup === 'function') window._repuestosCleanup(); } catch {}

  try { await _a().signOut(); } catch(e) { console.warn('[auth] signOut:', e); }
  try {
    localStorage.removeItem('cel_auth');
    localStorage.removeItem('caja_auth');
  } catch {}
}

// ── Reset password ────────────────────────────────────────
async function sendPasswordReset(email) {
  if (!email) throw new Error('Email requerido');
  await _a().sendPasswordResetEmail(String(email).trim().toLowerCase());
}

// ── Guard: redirige a login si no está autenticado ───────
// Uso al arrancar cada página:
//   requireAuth().then(u => { if (u) showApp(); });
async function requireAuth(loginUrl = 'login.html') {
  const user = await waitForAuth();
  if (!user) {
    location.replace(loginUrl);
    return null;
  }
  return user;
}
