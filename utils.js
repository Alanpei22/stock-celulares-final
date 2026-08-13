// ══════════════════════════════════════════
//  utils.js — TechPoint · Helpers compartidos
//  Cargar PRIMERO en todos los HTML, antes de cualquier módulo.
// ══════════════════════════════════════════
'use strict';

// ── Sanitización HTML ──────────────────────────────────────
// Escapa los 5 caracteres especiales de HTML.
// Usar SIEMPRE que se inserte contenido de usuario en innerHTML.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Formateo de números ────────────────────────────────────
// Formato monetario: $12.500
function fmtMoney(n) {
  return '$' + Math.abs(Math.round(Number(n) || 0))
    .toLocaleString('es-AR');
}

// Formato numérico: 12.500 (sin signo $)
function fmtNum(n) {
  return Number(n || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

// ── Fechas ─────────────────────────────────────────────────
// Fecha legible: "05/04/2025"
function fmtDateShort(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Fecha actual en zona Argentina (UTC-3)
function todayAR() {
  return new Date().toLocaleString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires'
  }).slice(0, 10);
}

// ── Debounce ───────────────────────────────────────────────
function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ── Gestión de listeners Firestore ────────────────────────
// Cancela un listener existente antes de crear uno nuevo.
// Uso: myListener = safeListener(myListener, () => db.collection(...).onSnapshot(...));
function safeListener(current, creator) {
  if (typeof current === 'function') current();
  return creator();
}

// ══════════════════════════════════════════════════════════
//  BÚSQUEDA: normalización + sinónimos del rubro
// ══════════════════════════════════════════════════════════

// Quita acentos y pasa a minúsculas. Para búsquedas tolerantes a tildes.
//   "Módulo" → "modulo", "iPhoneÉ" → "iphonee"
function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '');
}

// Sinónimos comunes en el rubro celulares — buscar uno encuentra los otros
// del grupo. Ej: buscar "modulo" matchea "pantalla", "display", "lcd", etc.
// Para agregar más grupos, sumá un array al final de SEARCH_SYNONYMS.
const SEARCH_SYNONYMS = [
  ['modulo', 'pantalla', 'display', 'lcd'],
  ['bateria', 'pila'],
  ['cargador', 'fuente'],
  ['auricular', 'audifono'],
  ['funda', 'cover', 'case'],
  ['vidrio', 'templado', 'glass', 'hidrogel', 'protector'],
  ['tactil', 'touch'],
  ['parlante', 'altavoz', 'speaker', 'buzzer'],
  ['microfono', 'mic'],
  ['camara', 'cam'],
  ['conector', 'pin'],
  ['flex', 'placa'],
];

// Mapa precomputado: palabra → array con todos sus sinónimos (incluida ella).
const _SYN_MAP = (() => {
  const m = new Map();
  for (const group of SEARCH_SYNONYMS) {
    const norm = group.map(normalizeText);
    for (const w of norm) m.set(w, norm);
  }
  return m;
})();

// ══════════════════════════════════════════════════════════
//  COTIZACIÓN DEL DÓLAR — accesible desde cualquier página
// ══════════════════════════════════════════════════════════

let _cachedDolar = null;

// Devuelve el dólar actual (sync, cacheado). null si no hay valor.
function getCurrentDolar() {
  if (_cachedDolar > 0) return _cachedDolar;
  // Intentar leer de localStorage (manual override)
  const manual = parseInt(localStorage.getItem('dolarManual')) || 0;
  if (manual > 0) { _cachedDolar = manual; return manual; }
  // Compat: si app.js está cargado y ya seteó dolarBlue
  if (typeof dolarBlue !== 'undefined' && dolarBlue > 0) {
    _cachedDolar = dolarBlue;
    return dolarBlue;
  }
  return null;
}

// Asegura que tengamos el dólar cargado. Lee localStorage → Firestore → API.
// Pasale tu instancia de db de Firestore para el fallback.
async function ensureDolar(db) {
  // 1. localStorage (manual)
  const manual = parseInt(localStorage.getItem('dolarManual')) || 0;
  if (manual > 0) { _cachedDolar = manual; return manual; }
  // 2. Firestore (compartido entre dispositivos)
  if (db) {
    try {
      const doc = await db.collection('config').doc('appSettings').get();
      const v = doc.exists ? (doc.data().dolarManual || 0) : 0;
      if (v > 0) {
        _cachedDolar = v;
        localStorage.setItem('dolarManual', v);
        return v;
      }
    } catch {}
  }
  // 3. API pública (fallback)
  try {
    const r = await fetch('https://dolarapi.com/v1/dolares/blue');
    const d = await r.json();
    const v = Math.round(d.venta || d.compra || 0) + 10;
    if (v > 0) { _cachedDolar = v; return v; }
  } catch {}
  return null;
}

// Devuelve true si haystack matchea TODOS los tokens del query (cada uno
// expandido con sus sinónimos). Tolerante a acentos y mayúsculas.
//
//   searchMatch("Módulo iPhone 14", "modulo 14")  → true
//   searchMatch("Pantalla Samsung",  "modulo")     → true (sinónimos)
//   searchMatch("Cargador 25W",      "fuente")     → true (sinónimos)
//   searchMatch("Vidrio templado",   "glass")      → true (sinónimos)
//
// haystack puede ser string o array de strings (se concatena).
function searchMatch(haystack, query) {
  if (!query) return true;
  const hay = normalizeText(Array.isArray(haystack) ? haystack.join(' ') : haystack);
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every(t => {
    const synGroup = _SYN_MAP.get(t) || [t];
    return synGroup.some(syn => hay.includes(syn));
  });
}

// ══════════════════════════════════════════════════════
//  PIN — hashing seguro (PBKDF2) con migración legacy
// ══════════════════════════════════════════════════════
// Hashea un PIN con PBKDF2 (150k iteraciones) para que un PIN corto sea
// caro de romper por fuerza bruta aunque alguien lea el hash de Firestore.
async function hashPin(pin) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(String(pin)), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('scf_owner_pin_salt_v1'), iterations: 150000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verifica un PIN contra el documento config/owner.
// Maneja migración: si el doc tiene `pin` (texto plano legacy) y coincide,
// lo migra a `pinHash` y borra el campo plano.
// Devuelve: { ok: bool, created: bool }  (created=true si era primer uso)
async function verifyOwnerPin(db, pin) {
  const ref = db.collection('config').doc('owner');
  const snap = await ref.get();
  const hash = await hashPin(pin);

  // Primer uso: no existe doc o no tiene ni pin ni pinHash
  if (!snap.exists || (!snap.data().pinHash && !snap.data().pin)) {
    await ref.set({ pinHash: hash, updatedAt: new Date().toISOString() }, { merge: true });
    return { ok: true, created: true };
  }

  const data = snap.data();

  // Caso moderno: comparar hash
  if (data.pinHash) {
    return { ok: data.pinHash === hash, created: false };
  }

  // Caso legacy: PIN en texto plano → comparar y migrar si coincide
  if (data.pin) {
    if (data.pin === String(pin)) {
      // Migrar a hash y borrar el plano
      try {
        await ref.set({
          pinHash: hash,
          pin: firebase.firestore.FieldValue.delete(),
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      } catch (e) { console.warn('PIN migration:', e); }
      return { ok: true, created: false };
    }
    return { ok: false, created: false };
  }

  return { ok: false, created: false };
}

// ══════════════════════════════════════════
//  LLAMADAS A NUESTRAS FUNCIONES DE /api
// ══════════════════════════════════════════
// Las funciones de /api están abiertas en internet, así que ahora exigen el
// token de sesión de Firebase para saber que la llamada sale de una cuenta del
// negocio. Este envoltorio lo engancha solo: usalo en vez de fetch() para
// cualquier URL que arranque con /api/.
async function apiFetch(url, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  try {
    const u = (typeof _fbAuth === 'function') ? _fbAuth().currentUser : null;
    if (u) headers['Authorization'] = 'Bearer ' + (await u.getIdToken());
  } catch (e) {
    console.warn('[api] no se pudo leer el token de sesión:', e);
  }
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  if (res.status === 401) {
    // Se avisa fuerte: varias de estas llamadas son fire-and-forget y si no
    // dejaran rastro, un rechazo se vería como "dejó de andar" sin explicación.
    console.warn('[api] ' + url + ' rechazó la sesión (401). ' +
      'Cerrá sesión y volvé a entrar; si sigue, la cuenta no está en la allowlist.');
  }
  return res;
}

// ══════════════════════════════════════════
//  TELEGRAM — aviso de movimientos al dueño
//  Fire-and-forget: jamás bloquea ni rompe la operación que avisa.
// ══════════════════════════════════════════
function tgNotify(texto) {
  try {
    // Toggle: apagable desde Configuración → Notificaciones (default: prendido)
    if (typeof getNotifConfig === 'function') {
      const cfg = getNotifConfig();
      if (cfg?.telegram?.enabled === false) return;
    }
    apiFetch('/api/telegram-notify', {
      method: 'POST',
      body: JSON.stringify({ text: String(texto || '') }),
    }).catch(() => {});
  } catch { /* nunca romper la app por una notificación */ }
}

// Hora corta AR para los mensajes de Telegram
function tgHora() {
  return new Date().toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit',
  });
}

// Formato $ para los mensajes
function tgMonto(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
}
