// ══════════════════════════════════════════
//  NOTIFICATIONS — sistema unificado
//  - In-app banners (Fase 1)
//  - Web Push (Fase 2, en webpush.js)
// ══════════════════════════════════════════

// ── Config defaults ─────────────────────────
const NOTIF_DEFAULTS = {
  inApp: {
    enabled: true,
    cierrePendiente: true,
    reparacionesListas: true,
    bajoStock: true,
    resumenAyer: true,
    cajaChicaPendiente: true,
    diferenciaCierre: false,
    fechaRetiroVencida: true,
  },
  push: {
    enabled: false,
    cierrePendiente: true,
    reparacionesListas: false,
    bajoStockCritico: false,
    cobrosRemotos: false,
    senasNuevas: false,
  },
  // Por cada tipo de push, qué dispositivos lo reciben (lista de deviceIds)
  // Si vacío → TODOS los dispositivos suscritos lo reciben
  pushTargets: {
    cierrePendiente: [],
    reparacionesListas: [],
    bajoStockCritico: [],
    cobrosRemotos: [],
    senasNuevas: [],
  },
  thresholds: {
    diasReparacionDemorada: 3,
    diasReparacionCritica: 10,    // a los 10 días → push obligatorio aunque toggle off
    horaCierrePendiente: 19,
    minutoCierrePendiente: 30,
    stockMinimoCritico: 0,
    diferenciaMinAlerta: 1000,
  },
};

let _notifConfig = null;   // cache sync
let _notifLoaded = false;  // ya cargó de Firestore?

// ── Helpers ─────────────────────────────────
function _mergeConfig(base, override) {
  const out = JSON.parse(JSON.stringify(base));
  for (const k of Object.keys(override || {})) {
    if (typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null) {
      out[k] = { ...base[k], ...(override[k] || {}) };
    } else {
      out[k] = override[k];
    }
  }
  return out;
}

function _todayARNotif() {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
}

function _nowAR() {
  // Devuelve { hora, minuto, dateStr } en horario AR
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: 'numeric', minute: 'numeric', hour12: false
  }).formatToParts(now);
  return {
    hora: Number(parts.find(p => p.type === 'hour')?.value || 0),
    minuto: Number(parts.find(p => p.type === 'minute')?.value || 0),
    dateStr: _todayARNotif(),
  };
}

// ── Public API: load/get/save ───────────────
async function loadNotifConfig() {
  // 1) cache localStorage para arranque sin esperar Firestore
  const cached = localStorage.getItem('notifConfig');
  if (cached) {
    try { _notifConfig = _mergeConfig(NOTIF_DEFAULTS, JSON.parse(cached)); } catch {}
  }
  if (!_notifConfig) _notifConfig = JSON.parse(JSON.stringify(NOTIF_DEFAULTS));

  // 2) async: leer Firestore y mergear
  try {
    if (typeof db !== 'undefined' && db) {
      const doc = await db.collection('caja_config').doc('notifications').get();
      if (doc.exists) {
        _notifConfig = _mergeConfig(NOTIF_DEFAULTS, doc.data());
        localStorage.setItem('notifConfig', JSON.stringify(_notifConfig));
      }
    }
  } catch (e) {
    console.error('[notif] loadNotifConfig:', e);
  }
  _notifLoaded = true;
  return _notifConfig;
}

function getNotifConfig() {
  return _notifConfig || NOTIF_DEFAULTS;
}

let _saveDebounce = null;
function saveNotifConfig(partial) {
  _notifConfig = _mergeConfig(_notifConfig || NOTIF_DEFAULTS, partial);
  localStorage.setItem('notifConfig', JSON.stringify(_notifConfig));

  if (_saveDebounce) clearTimeout(_saveDebounce);
  _saveDebounce = setTimeout(async () => {
    try {
      if (typeof db !== 'undefined' && db) {
        await db.collection('caja_config').doc('notifications').set(_notifConfig, { merge: true });
      }
    } catch (e) {
      console.error('[notif] saveNotifConfig:', e);
    }
  }, 400);
}

// ── Dismiss tracking (por clave + ttl) ──────
// Cuando el usuario cierra un banner, se guarda timestamp en localStorage
// para no volver a mostrarlo por X horas.
function _dismissedKey(key) { return `notif_dismiss_${key}`; }

function isDismissed(key, ttlHours = 4) {
  const v = localStorage.getItem(_dismissedKey(key));
  if (!v) return false;
  const ts = parseInt(v) || 0;
  return (Date.now() - ts) < ttlHours * 3600 * 1000;
}

function dismissBanner(key, ttlHours = 4) {
  localStorage.setItem(_dismissedKey(key), String(Date.now()));
  // Re-render banners para que desaparezca
  if (typeof renderInAppBanners === 'function') renderInAppBanners();
}

// ══════════════════════════════════════════
//  REGLAS IN-APP — devuelven banners activos
// ══════════════════════════════════════════

// REPAIRS, PRODUCTOS, REPUESTOS, MOVIMIENTOS, CIERRE: leemos de globals
// existentes en otros módulos (REPAIRS de repairs.js, PRODUCTOS de inventario.js, etc.)

async function _checkCierrePendiente() {
  const { hora, minuto, dateStr } = _nowAR();
  const cfg = getNotifConfig();
  const hLimit = cfg.thresholds.horaCierrePendiente;
  const mLimit = cfg.thresholds.minutoCierrePendiente;
  const isAfterCutoff = (hora > hLimit) || (hora === hLimit && minuto >= mLimit);
  if (!isAfterCutoff) return null;

  // ¿Hay cierre del día?
  try {
    const doc = await db.collection('caja_cierres').doc(dateStr).get();
    if (doc.exists) return null;
  } catch { return null; }

  // ¿Hay arqueo? (si no hay arqueo, no se trabajó hoy → no avisar)
  try {
    const arq = await db.collection('caja_arqueos').doc(dateStr).get();
    if (!arq.exists) return null;
  } catch { return null; }

  return {
    key: 'cierrePendiente',
    level: 'critical',
    icon: '⏰',
    title: 'Cierre pendiente',
    msg: `Son las ${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')} y todavía no cerraste la caja del día.`,
    cta: { label: 'Cerrar caja ahora', href: 'caja.html?action=cierre' },
  };
}

function _checkReparacionesListas() {
  if (typeof REPAIRS === 'undefined' || !Array.isArray(REPAIRS)) return null;
  const cfg = getNotifConfig();
  const { diasReparacionDemorada, diasReparacionCritica } = cfg.thresholds;
  const now = Date.now();
  const dms = (d) => d * 86400 * 1000;

  const listas = REPAIRS.filter(r => r.estado === 'listo');
  if (!listas.length) return null;

  const demoradas = [];
  const criticas = [];
  listas.forEach(r => {
    const fLista = r.fechaListo || _findFechaEstadoListo(r);
    if (!fLista) return;
    const diff = now - new Date(fLista).getTime();
    if (diff >= dms(diasReparacionCritica)) criticas.push(r);
    else if (diff >= dms(diasReparacionDemorada)) demoradas.push(r);
  });

  if (!demoradas.length && !criticas.length) return null;

  if (criticas.length) {
    return {
      key: 'reparacionesListas',
      level: 'critical',
      icon: '🚨',
      title: `${criticas.length} reparacion${criticas.length !== 1 ? 'es' : ''} sin retirar hace +${diasReparacionCritica} días`,
      msg: criticas.slice(0, 3).map(r => `• N°${r.nOrden || '?'} — ${r.nombre || (r.marca + ' ' + r.modelo)}`).join('\n') + (criticas.length > 3 ? `\n…y ${criticas.length - 3} más` : ''),
      cta: { label: 'Ver reparaciones', href: 'index.html#reparaciones?filter=listo' },
      count: criticas.length,
    };
  }

  return {
    key: 'reparacionesListas',
    level: 'warn',
    icon: '🔧',
    title: `${demoradas.length} reparacion${demoradas.length !== 1 ? 'es' : ''} listas hace +${diasReparacionDemorada} días`,
    msg: demoradas.slice(0, 3).map(r => `• N°${r.nOrden || '?'} — ${r.nombre || (r.marca + ' ' + r.modelo)}`).join('\n') + (demoradas.length > 3 ? `\n…y ${demoradas.length - 3} más` : ''),
    cta: { label: 'Ver reparaciones', href: 'index.html#reparaciones?filter=listo' },
    count: demoradas.length,
  };
}

function _findFechaEstadoListo(r) {
  if (!r || !Array.isArray(r.estadoHistorial)) return null;
  // Recorremos al revés buscando el último cambio a 'listo'
  for (let i = r.estadoHistorial.length - 1; i >= 0; i--) {
    if (r.estadoHistorial[i].estado === 'listo') return r.estadoHistorial[i].fecha;
  }
  return null;
}

function _checkBajoStock() {
  const productos = (typeof PRODUCTOS !== 'undefined') ? PRODUCTOS : [];
  const repuestos = (typeof REPUESTOS !== 'undefined') ? REPUESTOS : [];

  const bajos = [];
  productos.forEach(p => {
    if (p.activo === false) return;
    if (p.stockMin > 0 && (Number(p.stock) || 0) <= p.stockMin) {
      bajos.push({ nombre: p.nombre, stock: Number(p.stock) || 0, tipo: 'producto' });
    }
  });
  repuestos.forEach(r => {
    if (r.stockMin > 0 && (Number(r.cantidad) || 0) <= r.stockMin) {
      bajos.push({ nombre: r.nombre, stock: Number(r.cantidad) || 0, tipo: 'repuesto' });
    }
  });

  if (!bajos.length) return null;

  const sinStock = bajos.filter(b => b.stock === 0).length;
  return {
    key: 'bajoStock',
    level: sinStock > 0 ? 'critical' : 'warn',
    icon: sinStock > 0 ? '🚨' : '📦',
    title: `${bajos.length} con bajo stock${sinStock > 0 ? ` · ${sinStock} agotados` : ''}`,
    msg: bajos.slice(0, 4).map(b => `• ${b.nombre} — ${b.stock} u.`).join('\n') + (bajos.length > 4 ? `\n…y ${bajos.length - 4} más` : ''),
    cta: { label: 'Ver inventario', href: 'index.html#repuestos' },
    count: bajos.length,
  };
}

async function _checkDiferenciaCierre() {
  const cfg = getNotifConfig();
  const minDif = cfg.thresholds.diferenciaMinAlerta;
  // Buscar el último cierre de los últimos 7 días
  try {
    const today = _todayARNotif();
    const desde = new Date(today + 'T12:00:00');
    desde.setDate(desde.getDate() - 7);
    const desdeStr = desde.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
    const snap = await db.collection('caja_cierres')
      .where('fecha', '>=', desdeStr)
      .orderBy('fecha', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const cierre = snap.docs[0].data();
    if (Math.abs(cierre.diferencia || 0) < minDif) return null;
    return {
      key: 'diferenciaCierre',
      level: 'warn',
      icon: '⚠️',
      title: `Último cierre con diferencia de $${Math.abs(cierre.diferencia).toLocaleString('es-AR')}`,
      msg: `Cierre del ${cierre.fecha} — esperado $${(cierre.esperado || 0).toLocaleString('es-AR')}, contado $${(cierre.contado || 0).toLocaleString('es-AR')}.`,
      cta: { label: 'Revisar', href: 'caja.html?date=' + cierre.fecha },
    };
  } catch { return null; }
}

function _checkFechaRetiroVencida() {
  if (typeof REPAIRS === 'undefined' || !Array.isArray(REPAIRS)) return null;
  const today = _todayARNotif();
  const vencidas = REPAIRS.filter(r => {
    if (r.estado === 'entregado' || r.estado === 'cancelado') return false;
    if (!r.fechaEstimada) return false;
    return r.fechaEstimada < today;
  });
  if (!vencidas.length) return null;
  return {
    key: 'fechaRetiroVencida',
    level: 'warn',
    icon: '📅',
    title: `${vencidas.length} reparacion${vencidas.length !== 1 ? 'es' : ''} con fecha vencida`,
    msg: vencidas.slice(0, 3).map(r => `• N°${r.nOrden || '?'} — venció ${r.fechaEstimada}`).join('\n'),
    cta: { label: 'Ver', href: 'index.html#reparaciones' },
    count: vencidas.length,
  };
}

// ── Resumen de ayer (toast, no banner) ──────
function _maybeShowResumenAyer() {
  const cfg = getNotifConfig();
  if (!cfg.inApp.enabled || !cfg.inApp.resumenAyer) return;
  const today = _todayARNotif();
  const lastSeen = localStorage.getItem('notif_lastSeenDay');
  if (lastSeen === today) return; // ya lo mostramos hoy
  localStorage.setItem('notif_lastSeenDay', today);

  // Calcular ayer
  const yDate = new Date(today + 'T12:00:00');
  yDate.setDate(yDate.getDate() - 1);
  const yesterday = yDate.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);

  db.collection('caja_movimientos').where('fecha', '==', yesterday).get().then(snap => {
    if (snap.empty) return;
    let ing = 0, eg = 0;
    snap.docs.forEach(d => {
      const m = d.data();
      const monto = Number(m.monto) || 0;
      if (m.tipo === 'ingreso') ing += monto;
      else if (m.categoria !== 'Retiro dueño') eg += monto;
    });
    const neto = ing - eg;
    const sign = neto >= 0 ? '+' : '−';
    if (typeof toast === 'function') {
      toast(`☀️ Ayer: ${sign}$${Math.abs(neto).toLocaleString('es-AR')} (${snap.docs.length} movs)`, 'info');
    }
  }).catch(() => {});
}

// ══════════════════════════════════════════
//  CHECK ALL + RENDER BANNERS
// ══════════════════════════════════════════

async function checkAllInAppAlerts(context = 'dashboard') {
  if (!_notifLoaded) await loadNotifConfig();
  const cfg = getNotifConfig().inApp;
  if (!cfg.enabled) return [];

  const banners = [];

  // Cierre pendiente: dashboard + caja
  if (cfg.cierrePendiente && (context === 'dashboard' || context === 'caja')) {
    const b = await _checkCierrePendiente();
    if (b && !isDismissed(b.key)) banners.push(b);
  }

  // El resto solo en dashboard
  if (context === 'dashboard') {
    if (cfg.reparacionesListas) {
      const b = _checkReparacionesListas();
      if (b && !isDismissed(b.key)) banners.push(b);
    }
    if (cfg.bajoStock) {
      const b = _checkBajoStock();
      if (b && !isDismissed(b.key)) banners.push(b);
    }
    if (cfg.fechaRetiroVencida) {
      const b = _checkFechaRetiroVencida();
      if (b && !isDismissed(b.key)) banners.push(b);
    }
    if (cfg.diferenciaCierre) {
      const b = await _checkDiferenciaCierre();
      if (b && !isDismissed(b.key)) banners.push(b);
    }
  }

  return banners;
}

async function renderInAppBanners(containerId = 'notif-banners', context = 'dashboard') {
  const cont = document.getElementById(containerId);
  if (!cont) return;
  const banners = await checkAllInAppAlerts(context);

  if (!banners.length) {
    cont.innerHTML = '';
    cont.classList.add('hidden');
    return;
  }
  cont.classList.remove('hidden');
  cont.innerHTML = banners.map(b => {
    const lvlCls = b.level === 'critical' ? 'nb-critical' : b.level === 'warn' ? 'nb-warn' : 'nb-info';
    const ctaHtml = b.cta
      ? `<a class="nb-cta" href="${b.cta.href || '#'}"${b.cta.onClick ? ` onclick="${b.cta.onClick};return false"` : ''}>${esc(b.cta.label)}</a>`
      : '';
    return `
      <div class="notif-banner ${lvlCls}" data-key="${esc(b.key)}">
        <div class="nb-icon">${b.icon || '🔔'}</div>
        <div class="nb-body">
          <div class="nb-title">${esc(b.title)}</div>
          ${b.msg ? `<div class="nb-msg">${esc(b.msg).replace(/\n/g, '<br>')}</div>` : ''}
          ${ctaHtml}
        </div>
        <button class="nb-dismiss" onclick="dismissBanner('${esc(b.key)}')" title="Descartar">✕</button>
      </div>
    `;
  }).join('');
}

// Helper: esc local (utils.js puede no estar cargado en algunos contextos)
if (typeof esc !== 'function') {
  window.esc = function(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
}

// ══════════════════════════════════════════
//  DEVICE ID (para targeting de push)
// ══════════════════════════════════════════

function getDeviceId() {
  let id = localStorage.getItem('deviceId');
  if (!id) {
    id = 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('deviceId', id);
  }
  return id;
}

function getDeviceName() {
  return localStorage.getItem('deviceName') || '';
}

function setDeviceName(name) {
  localStorage.setItem('deviceName', name);
}

// Pregunta nombre del dispositivo si nunca se seteó (lazy, en pantalla de notif)
function ensureDeviceName(prompt = false) {
  let name = getDeviceName();
  if (name) return name;
  if (!prompt) return '';
  const userInput = window.prompt('¿Cómo querés llamar a este dispositivo?\n\nEj: "Mi celular", "Tablet del local", "Caja PC"', _suggestDeviceName());
  if (userInput && userInput.trim()) {
    name = userInput.trim().slice(0, 40);
    setDeviceName(name);
    return name;
  }
  return '';
}

function _suggestDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua))   return 'iPad';
  if (/Android/i.test(ua)) return /Mobi/i.test(ua) ? 'Android' : 'Tablet Android';
  if (/Windows/i.test(ua)) return 'PC Windows';
  if (/Mac/i.test(ua))     return 'Mac';
  return 'Mi dispositivo';
}

// ══════════════════════════════════════════
//  POPUP CONFIG (por dispositivo, en localStorage)
// ══════════════════════════════════════════
const POPUP_DEFAULTS = { enabled: true, cobros: true, senas: true, reparaciones: true };

function getPopupConfig() {
  const get = (k, def) => {
    const v = localStorage.getItem('popups.' + k);
    if (v === null) return def;
    return v === '1';
  };
  return {
    enabled:      get('enabled',      POPUP_DEFAULTS.enabled),
    cobros:       get('cobros',       POPUP_DEFAULTS.cobros),
    senas:        get('senas',        POPUP_DEFAULTS.senas),
    reparaciones: get('reparaciones', POPUP_DEFAULTS.reparaciones),
  };
}
function setPopupConfig(key, val) {
  localStorage.setItem('popups.' + key, val ? '1' : '0');
}

// ══════════════════════════════════════════
//  LIVE POPUPS (esquina inferior derecha, 30s)
//  Para cobros y reparaciones en tiempo real.
// ══════════════════════════════════════════

function _ensureLivePopupStack() {
  let stack = document.getElementById('live-popup-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'live-popup-stack';
    stack.className = 'live-popup-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

/**
 * Muestra un popup en la esquina inferior derecha durante N segundos.
 * @param {Object} opts
 * @param {string} opts.title — título principal
 * @param {string} [opts.body] — texto descriptivo
 * @param {string} [opts.icon] — emoji
 * @param {string} [opts.color] — accent color (default: verde)
 * @param {Function|string} [opts.onClick] — callback al click (o URL string)
 * @param {number} [opts.duration=30000] — ms hasta auto-dismiss
 * @param {string} [opts.tag] — para deduplicar; si ya existe uno con mismo tag, se reemplaza
 */
function showLivePopup(opts) {
  const { title, body, icon, color, onClick, duration = 30000, tag } = opts || {};
  if (!title) return;

  const stack = _ensureLivePopupStack();
  // Deduplicar por tag
  if (tag) {
    stack.querySelectorAll(`[data-tag="${CSS.escape(tag)}"]`).forEach(el => el.remove());
  }

  const el = document.createElement('div');
  el.className = 'live-popup';
  if (tag) el.dataset.tag = tag;
  if (color) el.style.borderLeftColor = color;
  el.innerHTML = `
    <div class="live-popup-icon">${icon || '🔔'}</div>
    <div class="live-popup-body">
      <div class="live-popup-title">${esc(title)}</div>
      ${body ? `<div class="live-popup-msg">${esc(body).replace(/\n/g, '<br>')}</div>` : ''}
    </div>
    <button class="live-popup-close" type="button" aria-label="Cerrar">✕</button>
    <div class="live-popup-bar" style="animation-duration:${duration}ms"></div>
  `;
  el.querySelector('.live-popup-close').addEventListener('click', e => {
    e.stopPropagation();
    _dismissLivePopup(el);
  });
  if (onClick) {
    const body = el.querySelector('.live-popup-body');
    body.style.cursor = 'pointer';
    body.addEventListener('click', () => {
      if (typeof onClick === 'function') onClick();
      else if (typeof onClick === 'string') location.href = onClick;
      _dismissLivePopup(el);
    });
  }
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  const autoTimer = setTimeout(() => _dismissLivePopup(el), duration);
  el._autoTimer = autoTimer;
}

function _dismissLivePopup(el) {
  if (!el || !el.parentNode) return;
  if (el._autoTimer) clearTimeout(el._autoTimer);
  el.classList.remove('show');
  el.classList.add('dismiss');
  setTimeout(() => { try { el.remove(); } catch {} }, 380);
}

// Expose for debug
window._notifDebug = { getNotifConfig, checkAllInAppAlerts, NOTIF_DEFAULTS, showLivePopup };
