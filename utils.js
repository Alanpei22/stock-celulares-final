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
