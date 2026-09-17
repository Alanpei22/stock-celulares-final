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

// Igual que fmtMoney, con el nombre corto que usa media app.
// VIVE ACÁ, no en caja.js: index.html no carga caja.js, así que todo lo que
// llame a fmt() desde reparaciones o stock reventaba con ReferenceError.
function fmt(n) {
  return '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('es-AR');
}

// Fecha de HOY en horario de Argentina (UTC-3), formato YYYY-MM-DD.
// Misma historia que fmt(): la usa la caja y también el cobro de una
// reparación, que se dispara desde index.html.
const _todayAR = () => new Date()
  .toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  .slice(0, 10);

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

// ══════════════════════════════════════════════════════════════
//  CONTADOR DE LECTURAS DE FIREBASE
//  ─────────────────────────────────────────────────────────────
//  El plan gratis corta en 50.000 lecturas por día y cada documento leído
//  cuenta una. Cuando se llena, la app deja de traer datos y no hay forma de
//  saber QUÉ lo gastó: la consola de Firebase muestra el total, no el detalle.
//
//  Esto lleva la cuenta por colección, por día y POR DISPOSITIVO (es
//  localStorage). Sirve para saber a dónde apuntar, no para facturar: los
//  números de verdad están en la consola de Firebase.
// ══════════════════════════════════════════════════════════════
const _CUPO_KEY = 'cupoLecturas';

function cupoLeer() {
  try {
    const d = JSON.parse(localStorage.getItem(_CUPO_KEY) || '{}');
    if (d.dia !== todayAR()) return { dia: todayAR(), cols: {}, aperturas: 0 };
    return { dia: d.dia, cols: d.cols || {}, aperturas: d.aperturas || 0 };
  } catch { return { dia: todayAR(), cols: {}, aperturas: 0 }; }
}

function cupoContar(coleccion, n) {
  if (!n || n < 0) return;
  try {
    const d = cupoLeer();
    d.cols[coleccion] = (d.cols[coleccion] || 0) + n;
    localStorage.setItem(_CUPO_KEY, JSON.stringify(d));
  } catch { /* modo privado: sin contador, la app sigue igual */ }
}

// Una apertura de la app = un ciclo de lecturas. Sirve para el promedio.
function cupoApertura() {
  try {
    const d = cupoLeer();
    d.aperturas = (d.aperturas || 0) + 1;
    localStorage.setItem(_CUPO_KEY, JSON.stringify(d));
  } catch {}
}

// Un snapshot de listener: la PRIMERA vez llegan todos los documentos; después,
// solo los que cambiaron. Contar siempre docs.length multiplicaría por diez.
function cupoSnap(coleccion, snap, primero) {
  if (!snap) return;
  const n = primero ? (snap.size ?? (snap.docs || []).length)
                    : (typeof snap.docChanges === 'function' ? snap.docChanges().length : 0);
  cupoContar(coleccion, n);
}

function cupoTotal(d) {
  return Object.values((d || cupoLeer()).cols).reduce((s, n) => s + n, 0);
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

// ── Métodos de pago ─────────────────────────────
// El método se guarda como texto, y hubo dos escrituras del mismo:
// "MercadoPago" (los botones de la caja) y "Mercado Pago" (el listado por
// defecto del alta de stock, ya corregido). Sin unificar, el desglose del
// cierre muestra DOS métodos donde hay uno.
//
// Los documentos viejos NO se reescriben — la app no rompe datos que ya están
// en Firestore. Se normaliza al LEER, que arregla el pasado y el futuro.
const _METODOS_CANON = ['Efectivo', 'Transferencia', 'MercadoPago',
                        'Tarjeta débito', 'Tarjeta crédito', 'Dólares'];
function metodoCanonico(m) {
  const s = String(m == null || m === '' ? 'Efectivo' : m);
  const k = s.toLowerCase().replace(/\s+/g, '');
  return _METODOS_CANON.find(c => c.toLowerCase().replace(/\s+/g, '') === k) || s;
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

// ══════════════════════════════════════════════════════════
//  IMEI — validación
// ══════════════════════════════════════════════════════════
// Un IMEI son 15 dígitos y el último es un verificador Luhn (el mismo
// algoritmo de las tarjetas). Con eso se agarra el 90% de los errores de
// tipeo: un dígito cambiado o dos dados vuelta rompen el verificador.
//
// NO bloquea. El cliente está parado en el mostrador y a veces lo que hay que
// cargar es lo que dice la caja, aunque no cierre. Lo que hace es avisar
// mientras escribís (en rojo, al lado del campo) y volver a preguntar antes
// de guardar. Casi siempre el error se corrige antes de llegar a guardar.

function imeiDigitos(v) { return String(v ?? '').replace(/\D/g, ''); }

// Verificador Luhn sobre los 15 dígitos (los 14 primeros + el de control).
function imeiLuhnOk(d) {
  if (!/^\d{15}$/.test(d)) return false;
  let suma = 0;
  for (let i = 0; i < 15; i++) {
    let n = +d[i];
    // Se duplican las posiciones pares empezando por la segunda (índice 1)
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    suma += n;
  }
  return suma % 10 === 0;
}

// Estado del campo: sirve para el cartelito y para el aviso al guardar.
function imeiEstado(v) {
  const d = imeiDigitos(v);
  if (!d) return { vacio: true, ok: true, digitos: 0, msg: '' };
  if (d.length < 15) return { vacio: false, ok: false, digitos: d.length,
                              msg: `${d.length}/15 dígitos` };
  if (d.length > 15) return { vacio: false, ok: false, digitos: d.length,
                              msg: `${d.length} dígitos: un IMEI tiene 15` };
  if (!imeiLuhnOk(d)) return { vacio: false, ok: false, digitos: 15,
                               msg: '15 dígitos pero el número no cierra — revisá *#06#' };
  return { vacio: false, ok: true, digitos: 15, msg: '✓ IMEI válido' };
}

// Engancha el aviso en vivo a un campo. Crea el cartelito solo, así no hay
// que tocar el HTML de cada formulario.
function imeiWatch(inputId) {
  const inp = document.getElementById(inputId);
  if (!inp || inp._imeiWatch) return;
  inp._imeiWatch = true;
  let hint = document.getElementById(inputId + '-hint');
  if (!hint) {
    hint = document.createElement('span');
    hint.id = inputId + '-hint';
    hint.className = 'imei-hint';
    inp.insertAdjacentElement('afterend', hint);
  }
  const pintar = () => {
    const e = imeiEstado(inp.value);
    hint.textContent = e.msg;
    hint.classList.toggle('imei-hint--mal', !e.vacio && !e.ok);
    hint.classList.toggle('imei-hint--ok', !e.vacio && e.ok);
    inp.classList.toggle('imei-mal', !e.vacio && !e.ok);
  };
  inp.addEventListener('input', pintar);
  inp.addEventListener('blur', pintar);
  pintar();
}

// Antes de guardar: si hay algo cargado y no cierra, preguntar una vez.
// Devuelve true si se puede seguir.
function imeiConfirmar(valor, etiqueta) {
  const e = imeiEstado(valor);
  if (e.ok) return true;
  return confirm(`⚠️ El ${etiqueta || 'IMEI'} no parece válido:\n${e.msg}\n\n`
    + 'Marcá *#06# en el equipo para verlo.\n\n¿Guardar igual?');
}

// ══════════════════════════════════════════════════════════
//  COTIZACIÓN DEL BLUE — para MOSTRAR
// ══════════════════════════════════════════════════════════
// Trae compra y venta por separado, que es lo que se le canta a un cliente
// que paga en dólares.
//
// OJO: esto NO es el número con el que la app hace las cuentas. Para convertir
// se usa getCurrentDolar() (la venta con el recargo del local, o el valor
// cargado a mano). Son dos cosas distintas a propósito y la barra muestra las
// dos, si no el dueño ve "venta 1.545" y la app convirtiendo a otro número y
// no entiende por qué.
//
// No toca el cupo de Firebase: es una API pública, no Firestore. Se cachea
// 10 minutos para no llamarla en cada pantalla.
const _DOLAR_TTL_MS = 10 * 60 * 1000;
let _dolarDet = null;

async function dolarDetalle(forzar) {
  const manual = parseInt(localStorage.getItem('dolarManual')) || 0;
  if (manual > 0) {
    return { manual: true, compra: null, venta: null, usa: manual, at: null };
  }
  if (!forzar && _dolarDet && (Date.now() - _dolarDet.t) < _DOLAR_TTL_MS) return _dolarDet;
  try {
    const r = await fetch('https://dolarapi.com/v1/dolares/blue');
    const d = await r.json();
    const compra = Math.round(Number(d.compra) || 0);
    const venta  = Math.round(Number(d.venta) || 0);
    if (!venta && !compra) return _dolarDet;
    _dolarDet = { manual: false, compra, venta, at: d.fechaActualizacion || null, t: Date.now() };
    return _dolarDet;
  } catch {
    return _dolarDet;   // si se cayó la API, lo último que sabíamos
  }
}

// Hora de la última actualización, en formato de acá.
function dolarHora(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}
