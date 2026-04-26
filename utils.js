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

// ── Hash de PIN (Web Crypto, sin dependencias) ─────────────
// Devuelve Promise<string> con SHA-256 hex del PIN.
// Usar para almacenar/comparar PINs en Firestore.
async function hashPin(pin) {
  const data = new TextEncoder().encode(String(pin) + 'tp-v1');
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
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
