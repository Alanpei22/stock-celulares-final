// ── Configuración ─────────────────────────────────────────
const AUTH_KEY = 'cel_auth';
const STOCK_KEY = 'cel_stock';
const SELLERS_KEY = 'cel_sellers';
const PAYMENTS_KEY = 'cel_payments';
const BIZ_KEY = 'cel_biz';
const AUTH_DAYS = 30;

const DEFAULT_SELLERS = ['Vendedor 1', 'Vendedor 2'];
const DEFAULT_PAYMENTS = ['Efectivo', 'Transferencia', 'Tarjeta débito', 'Tarjeta crédito', 'Mercado Pago'];
const PRICES_KEY = 'cel_prices';
const DEFAULT_PRICES = { transfer: 0, c3: 15, c6: 25 };

// ── WA Templates ─────────────────────────────────────────
const WA_TEMPLATES_KEY = 'cel_wa_templates';
const WA_TPL_DEFAULTS = {
  repair_reparando: 'Hola {nombre}! 👋\nTe contactamos por tu {equipo} (Orden N°{nOrden}). Estamos trabajando en ella 🔧',
  repair_listo:     'Hola {nombre}! 👋\nTu {equipo} (Orden N°{nOrden}) ya está *lista para retirar* 🔧✅\n_Cuando puedas coordinamos el horario._',
  repair_default:   'Hola {nombre}! 👋\nTe contactamos por tu {equipo} (Orden N°{nOrden}).',
  stock:            '📱 *{marca} {modelo}*\n{specs}\n✅ Estado: {estado}\n💰 Precio: {precio}\n\n_Consultá disponibilidad_ 👋'
};
let WA_TEMPLATES = {};
// ── Firebase — ver firebase-config.js ────────────────────
let db = null;
let _autoBackupDone = false;
let _stockListener  = null; // unsubscribe del listener de stock
let _stockLoaded    = false; // true tras el primer snapshot

// Expone cleanup para que auth.js pueda cancelar todos los listeners en logout
window._appCleanup = function() {
  if (_stockListener) { _stockListener(); _stockListener = null; }
  _stockLoaded = false;
  STOCK = [];
};

function listenStock() {
  // Cancelar listener previo (evita duplicados en re-login)
  if (_stockListener) { _stockListener(); _stockListener = null; }

  _stockListener = db.collection('stock').onSnapshot(snapshot => {
    _stockLoaded = true;
    STOCK = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    STOCK.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    render();
    // Backup automático una vez por sesión, 3s después de cargar datos
    if (!_autoBackupDone) { _autoBackupDone = true; setTimeout(autoBackup, 3000); }
  }, err => {
    console.error('Firestore:', err);
    toast('Error de conexion', 'error');
  });
}

// ── Modo Oscuro ────────────────────────────────────────────
function initDarkMode() {
  if (localStorage.getItem('darkMode') === '1') {
    document.body.classList.add('dark');
  }
  _updateDarkIcon();
}

function toggleDarkMode() {
  document.body.classList.toggle('dark');
  localStorage.setItem('darkMode', document.body.classList.contains('dark') ? '1' : '0');
  _updateDarkIcon();
}

function _updateDarkIcon() {
  const isDark = document.body.classList.contains('dark');
  document.querySelectorAll('.dark-toggle-btn').forEach(btn => {
    const iconEl = btn.querySelector('.dark-icon');
    if (iconEl) iconEl.textContent = isDark ? '☀️' : '🌙';
    else btn.textContent = isDark ? '☀️' : '🌙';
    btn.title = isDark ? 'Modo claro' : 'Modo oscuro';
  });
}

// ── Backup Automático ──────────────────────────────────────
async function autoBackup() {
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem('lastAutoBackup') === today) return;
  try {
    const backupData = {
      fecha: new Date().toISOString(),
      stock_count: STOCK.length,
      stock: STOCK.map(p => ({
        marca: p.marca || '', modelo: p.modelo || '',
        almacenamiento: p.almacenamiento || '',
        estado: p.estado || '', precio: p.precio || 0,
        ubicacion: p.ubicacion || '', vendido: p.vendido || false,
        imei: p.imei || '', fecha: p.fecha || ''
      }))
    };
    await db.collection('backups').doc(today).set(backupData);
    localStorage.setItem('lastAutoBackup', today);
    toast('💾 Backup diario guardado', 'success');
  } catch(e) {
    console.warn('Auto-backup error:', e);
  }
}

// ── Modo Dueño ──────────────────────────────────────────────
let OWNER_MODE = false;
let _ownerPinBuf = '';
let _ownerLockTimer = null;
let _ownerPinCallback = null; // función a ejecutar tras PIN correcto

// Verificar PIN sin entrar a modo dueño — para acciones puntuales
function requireOwnerPin(onSuccess, mensaje) {
  _ownerPinCallback = onSuccess;
  _ownerPinBuf = '';
  _updateOwnerDots();
  document.getElementById('owner-pin-error').textContent = '';
  const sub = document.getElementById('owner-pin-sub');
  sub.textContent = mensaje || 'Ingresá el PIN de dueño para continuar';
  sub.style.color = '#f59e0b';
  document.getElementById('owner-pin-overlay').classList.remove('hidden');
  document.getElementById('owner-pin-modal').classList.remove('hidden');
}

function toggleOwnerLock() {
  if (OWNER_MODE) { lockOwnerMode(); } else { openOwnerPinModal(); }
}

async function openOwnerPinModal() {
  _ownerPinBuf = '';
  _updateOwnerDots();
  document.getElementById('owner-pin-error').textContent = '';
  // Detectar si es primer uso para mostrar mensaje apropiado
  try {
    const doc = await db.collection('config').doc('owner').get();
    const sub = document.getElementById('owner-pin-sub');
    if (!doc.exists || !doc.data().pin) {
      sub.textContent = 'Primera vez: elegí tu PIN de 4 dígitos';
      sub.style.color = '#f59e0b';
    } else {
      sub.textContent = 'Ingresá tu PIN de dueño';
      sub.style.color = '';
    }
  } catch {}
  document.getElementById('owner-pin-overlay').classList.remove('hidden');
  document.getElementById('owner-pin-modal').classList.remove('hidden');
}

function closeOwnerPinModal() {
  document.getElementById('owner-pin-overlay').classList.add('hidden');
  document.getElementById('owner-pin-modal').classList.add('hidden');
  _ownerPinBuf = '';
  _ownerPinCallback = null;
  hidePinResetConfirm('owner');
}

function addOwnerPin(d) {
  if (_ownerPinBuf.length >= 4) return;
  _ownerPinBuf += d;
  _updateOwnerDots();
  if (_ownerPinBuf.length === 4) setTimeout(submitOwnerPin, 200);
}

function backOwnerPin() {
  _ownerPinBuf = _ownerPinBuf.slice(0, -1);
  _updateOwnerDots();
}

function clearOwnerPin() {
  _ownerPinBuf = '';
  _updateOwnerDots();
}

function showPinResetConfirm(ctx) {
  const el = document.getElementById(ctx + '-pin-reset-confirm');
  if (el) el.classList.remove('hidden');
}
function hidePinResetConfirm(ctx) {
  const el = document.getElementById(ctx + '-pin-reset-confirm');
  if (el) el.classList.add('hidden');
}
async function doResetOwnerPin(ctx) {
  try {
    await db.collection('config').doc('owner').delete();
    hidePinResetConfirm(ctx);
    closeOwnerPinModal();
    toast('PIN reseteado. El próximo PIN que ingreses quedará guardado.', 'success');
  } catch(e) {
    toast('Error al resetear PIN', 'error');
  }
}

function _updateOwnerDots() {
  document.querySelectorAll('#owner-pin-dots span').forEach((d, i) => {
    d.classList.toggle('filled', i < _ownerPinBuf.length);
  });
}

async function submitOwnerPin() {
  const pin = _ownerPinBuf;
  try {
    const doc = await db.collection('config').doc('owner').get();
    if (!doc.exists || !doc.data().pin) {
      // Primer uso: guardar el PIN elegido
      await db.collection('config').doc('owner').set({ pin });
      closeOwnerPinModal();
      unlockOwnerMode();
      toast('🔑 PIN de dueño configurado', 'success');
      return;
    }
    if (pin === doc.data().pin) {
      closeOwnerPinModal();
      if (_ownerPinCallback) {
        const cb = _ownerPinCallback;
        _ownerPinCallback = null;
        cb();
      } else {
        unlockOwnerMode();
      }
    } else {
      document.getElementById('owner-pin-error').textContent = 'PIN incorrecto';
      _ownerPinBuf = '';
      _updateOwnerDots();
    }
  } catch(e) {
    document.getElementById('owner-pin-error').textContent = 'Error de conexión';
    _ownerPinBuf = '';
    _updateOwnerDots();
  }
}

function unlockOwnerMode() {
  OWNER_MODE = true;
  document.body.classList.add('owner-mode');
  document.querySelectorAll('.owner-lock-btn').forEach(b => {
    const iconEl = b.querySelector('.lock-icon');
    if (iconEl) iconEl.textContent = '🔓'; else b.textContent = '🔓';
    b.title = 'Bloquear';
  });
  clearTimeout(_ownerLockTimer);
  _ownerLockTimer = setTimeout(lockOwnerMode, 15 * 60 * 1000);
  toast('🔓 Modo dueño activo', 'success');
}

function lockOwnerMode() {
  OWNER_MODE = false;
  document.body.classList.remove('owner-mode');
  clearTimeout(_ownerLockTimer);
  document.querySelectorAll('.owner-lock-btn').forEach(b => {
    const iconEl = b.querySelector('.lock-icon');
    if (iconEl) iconEl.textContent = '🔒'; else b.textContent = '🔒';
    b.title = 'Modo dueño';
  });
  toast('🔒 Vista bloqueada', 'info');
}

// ── Auth — Firebase ──────────────────────────────────────
function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.remove('app-hidden');
  initApp();
}

// ── Stock ─────────────────────────────────────────────────
let STOCK = [];
let SELLERS = [];
let PAYMENTS = [];
let BIZ_IMAGE = null;
let editingId = null;
let pendingSellId = null;
let appInited = false;
let currentTab = 'ventas';
let PRICES = {};
let dolarBlue = null;

function loadStock() {
  try { STOCK = JSON.parse(localStorage.getItem(STOCK_KEY) || '[]'); } catch { STOCK = []; }
}
function saveStock() { localStorage.setItem(STOCK_KEY, JSON.stringify(STOCK)); }

// ── Config: localStorage (caché) + Firestore (persistencia) ──
function loadConfig() {
  // Carga instantánea desde localStorage (caché)
  try { SELLERS = JSON.parse(localStorage.getItem(SELLERS_KEY)); if (!Array.isArray(SELLERS) || !SELLERS.length) SELLERS = DEFAULT_SELLERS.slice(); } catch { SELLERS = DEFAULT_SELLERS.slice(); }
  try { PAYMENTS = JSON.parse(localStorage.getItem(PAYMENTS_KEY)); if (!Array.isArray(PAYMENTS) || !PAYMENTS.length) PAYMENTS = DEFAULT_PAYMENTS.slice(); } catch { PAYMENTS = DEFAULT_PAYMENTS.slice(); }
  BIZ_IMAGE = localStorage.getItem(BIZ_KEY) || null;
  loadPrices();
  // Luego sincroniza desde Firestore (fuente de verdad)
  syncConfigFromFirestore();
}

async function syncConfigFromFirestore() {
  try {
    const doc = await db.collection('config').doc('appSettings').get();
    if (!doc.exists) return;
    const d = doc.data();
    let changed = false;
    if (Array.isArray(d.sellers) && d.sellers.length)   { SELLERS = d.sellers;   localStorage.setItem(SELLERS_KEY,  JSON.stringify(SELLERS));  changed = true; }
    if (Array.isArray(d.payments) && d.payments.length) { PAYMENTS = d.payments; localStorage.setItem(PAYMENTS_KEY, JSON.stringify(PAYMENTS)); changed = true; }
    if (d.prices && typeof d.prices === 'object')        { PRICES = d.prices;     localStorage.setItem(PRICES_KEY,   JSON.stringify(PRICES));   changed = true; }
    if (d.bizImage)  { BIZ_IMAGE = d.bizImage; localStorage.setItem(BIZ_KEY, d.bizImage); applyBizImage(); changed = true; }
    if (d.dolarManual > 0) { localStorage.setItem('dolarManual', d.dolarManual); dolarBlue = d.dolarManual; changed = true; }
    if (changed) render();
  } catch {}
}

function saveSellers() {
  localStorage.setItem(SELLERS_KEY, JSON.stringify(SELLERS));
  db.collection('config').doc('appSettings').set({ sellers: SELLERS }, { merge: true }).catch(() => {});
}
function savePayments() {
  localStorage.setItem(PAYMENTS_KEY, JSON.stringify(PAYMENTS));
  db.collection('config').doc('appSettings').set({ payments: PAYMENTS }, { merge: true }).catch(() => {});
}
function loadPrices() {
  try { PRICES = JSON.parse(localStorage.getItem(PRICES_KEY)); if (!PRICES || typeof PRICES !== 'object') PRICES = {...DEFAULT_PRICES}; } catch { PRICES = {...DEFAULT_PRICES}; }
}
function savePrices() {
  localStorage.setItem(PRICES_KEY, JSON.stringify(PRICES));
  db.collection('config').doc('appSettings').set({ prices: PRICES }, { merge: true }).catch(() => {});
}
async function fetchDolarBlue() {
  // Si hay override manual guardado, usarlo
  const manual = parseInt(localStorage.getItem('dolarManual')) || 0;
  if (manual > 0) {
    dolarBlue = manual;
    renderSettingsPrices();
    return;
  }
  try {
    const r = await fetch('https://dolarapi.com/v1/dolares/blue');
    const d = await r.json();
    dolarBlue = Math.round(d.venta || d.compra || 0) + 10;
  } catch(e) { dolarBlue = null; }
  renderSettingsPrices();
}

function saveDolarManual() {
  const val = parseInt(document.getElementById('dolar-blue-input').value) || 0;
  if (val <= 0) { toast('Ingresá un valor válido', 'error'); return; }
  localStorage.setItem('dolarManual', val);
  db.collection('config').doc('appSettings').set({ dolarManual: val }, { merge: true }).catch(() => {});
  dolarBlue = val;
  renderSettingsPrices();
  render();
  toast('💲 Cotización guardada: $' + val.toLocaleString('es-AR'), 'success');
}

function resetDolarManual() {
  localStorage.removeItem('dolarManual');
  db.collection('config').doc('appSettings').set({ dolarManual: 0 }, { merge: true }).catch(() => {});
  toast('Cotización: volviendo a API…', 'info');
  dolarBlue = null;
  fetchDolarBlue().then(() => render());
}
function saveBizImage() {
  if (BIZ_IMAGE) {
    localStorage.setItem(BIZ_KEY, BIZ_IMAGE);
    // Solo guardar en Firestore si la imagen no es demasiado grande (límite ~900KB)
    if (BIZ_IMAGE.length < 900000) {
      db.collection('config').doc('appSettings').set({ bizImage: BIZ_IMAGE }, { merge: true }).catch(() => {});
    }
  } else {
    localStorage.removeItem(BIZ_KEY);
    db.collection('config').doc('appSettings').set({ bizImage: '' }, { merge: true }).catch(() => {});
  }
}

// ── Init ──────────────────────────────────────────────────
function initApp() {
  if (appInited) return;
  appInited = true;
  initDarkMode();
  db = _fbInit();
  window._DAKI_NAME = 'TechPoint';
  loadConfig();
  loadWaTemplates();
  fetchDolarBlue();
  applyBizImage();
  setTimeout(logAccess, 800);

  document.getElementById('add-btn').addEventListener('click', () => openForm());
  document.getElementById('stats-btn').addEventListener('click', () => { closeHdrMenu(); openStats(); });
  document.getElementById('export-btn').addEventListener('click', () => { closeHdrMenu(); openExport(); });
  document.getElementById('settings-btn').addEventListener('click', () => { closeHdrMenu(); openSettings(); });
  document.getElementById('search').addEventListener('input', debounceRender);
  document.getElementById('f-marca').addEventListener('change', debounceRender);
  document.getElementById('f-estado').addEventListener('change', debounceRender);
  document.getElementById('f-vendido').addEventListener('change', debounceRender);
  document.getElementById('f-min').addEventListener('input', debounceRender);
  document.getElementById('f-max').addEventListener('input', debounceRender);
  document.getElementById('f-vendedor').addEventListener('change', debounceRender);

  document.getElementById('fi-marca').addEventListener('input', e => _updateBateriaVisibility(e.target.value));
  document.getElementById('form-close').addEventListener('click', closeForm);
  document.getElementById('form-cancel').addEventListener('click', closeForm);
  document.getElementById('form-save').addEventListener('click', savePhone);
  document.getElementById('form-modal').addEventListener('click', e => { if (_blockFormClose) return; if (e.target.id === 'form-modal') closeForm(); });

  document.getElementById('sell-close').addEventListener('click', closeSellModal);
  document.getElementById('sell-cancel').addEventListener('click', closeSellModal);
  document.getElementById('sell-confirm').addEventListener('click', confirmSell);
  document.getElementById('sell-modal').addEventListener('click', e => { if (e.target.id === 'sell-modal') closeSellModal(); });

  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-modal').addEventListener('click', e => { if (e.target.id === 'detail-modal') closeDetail(); });

  document.getElementById('stats-close').addEventListener('click', closeStats);
  document.getElementById('stats-modal').addEventListener('click', e => { if (e.target.id === 'stats-modal') closeStats(); });

  document.getElementById('export-close').addEventListener('click', closeExport);
  document.getElementById('export-modal').addEventListener('click', e => { if (e.target.id === 'export-modal') closeExport(); });
  document.getElementById('export-csv').addEventListener('click', exportCSV);
  document.getElementById('export-json').addEventListener('click', exportJSON);
  document.getElementById('import-json-btn').addEventListener('click', () => { document.getElementById('import-file').click(); });
  document.getElementById('import-file').addEventListener('change', importJSON);

  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-modal').addEventListener('click', e => { if (e.target.id === 'settings-modal') closeSettings(); });
  document.getElementById('biz-image-input').addEventListener('change', handleBizImage);

  // Cerrar modales de stock con ESC
  document.addEventListener('keydown', function _appEsc(e) {
    if (e.key !== 'Escape') return;
    const order = [
      { id: 'sell-modal',     fn: closeSellModal  },
      { id: 'stats-modal',    fn: closeStats       },
      { id: 'settings-modal', fn: closeSettings    },
      { id: 'export-modal',   fn: closeExport      },
      { id: 'detail-modal',   fn: closeDetail      },
    ];
    for (const { id, fn } of order) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) { fn(); return; }
    }
  });

  initPWA();
  listenStock();
  initRepairs();
  initRepuestos();
}

// ── Menú desplegable header ───────────────────────────────
function toggleHdrMenu() {
  const menu = document.getElementById('hdr-menu-dropdown');
  if (!menu) return;
  const isOpen = !menu.classList.contains('hidden');
  menu.classList.toggle('hidden', isOpen);
  if (!isOpen) {
    setTimeout(() => document.addEventListener('click', _closeHdrMenuOutside, { once: true }), 0);
  }
}
function closeHdrMenu() {
  const menu = document.getElementById('hdr-menu-dropdown');
  if (menu) menu.classList.add('hidden');
}
function _closeHdrMenuOutside(e) {
  const menu = document.getElementById('hdr-menu-dropdown');
  const btn  = document.getElementById('hdr-menu-btn');
  if (menu && !menu.contains(e.target) && e.target !== btn) {
    menu.classList.add('hidden');
  }
}

// ── Menú reparaciones ─────────────────────────────────────
function toggleRepMenu() {
  const dd = document.getElementById('rep-menu-dropdown');
  if (!dd) return;
  dd.classList.toggle('hidden');
  if (!dd.classList.contains('hidden')) {
    setTimeout(() => document.addEventListener('click', _closeRepMenuOutside, { once: true }), 0);
  }
}
function closeRepMenu() { document.getElementById('rep-menu-dropdown')?.classList.add('hidden'); }
function _closeRepMenuOutside(e) {
  const dd = document.getElementById('rep-menu-dropdown');
  const btn = document.getElementById('rep-menu-btn');
  if (dd && !dd.contains(e.target) && e.target !== btn) dd.classList.add('hidden');
}

// ── Menú repuestos ────────────────────────────────────────
function toggleRep2Menu() {
  const dd = document.getElementById('rep2-menu-dropdown');
  if (!dd) return;
  dd.classList.toggle('hidden');
  if (!dd.classList.contains('hidden')) {
    setTimeout(() => document.addEventListener('click', _closeRep2MenuOutside, { once: true }), 0);
  }
}
function closeRep2Menu() { document.getElementById('rep2-menu-dropdown')?.classList.add('hidden'); }
function _closeRep2MenuOutside(e) {
  const dd = document.getElementById('rep2-menu-dropdown');
  const btn = document.getElementById('rep2-menu-btn');
  if (dd && !dd.contains(e.target) && e.target !== btn) dd.classList.add('hidden');
}

// ── Secciones ─────────────────────────────────────────────
function switchSection(section) {
  ['dash', 'stock', 'repairs', 'repuestos'].forEach(s => {
    const sec = document.getElementById(s + '-section');
    const btn = document.getElementById('nav-' + s);
    if (sec) sec.classList.toggle('section-hidden', s !== section);
    if (btn) btn.classList.toggle('active', s === section);
  });
  if (section === 'dash') renderDashboard();
}

// ── Dashboard ──────────────────────────────────────────────

async function renderDashboard() {
  renderDashRepairs();
  renderDashFollowUps();
  renderDashLowStock();
  loadDashCaja();
}

function renderDashRepairs() {
  const el = document.getElementById('dash-repairs-list');
  if (!el) return;
  const activos = (typeof REPAIRS !== 'undefined' ? REPAIRS : [])
    .filter(r => r.estado === 'reparando' || r.estado === 'listo');
  if (!activos.length) {
    el.innerHTML = '<p class="dash-empty">Sin reparaciones activas</p>';
    return;
  }
  el.innerHTML = activos.slice(0, 5).map(r => {
    const cls = r.estado === 'listo' ? 'dash-rep-listo' : 'dash-rep-rep';
    const lbl = r.estado === 'listo' ? 'Listo ✓' : 'Reparando';
    return `<div class="dash-rep-row" onclick="switchSection('repairs')">
      <span class="dash-rep-badge ${cls}">${lbl}</span>
      <div class="dash-rep-info">
        <span class="dash-rep-nombre">${esc(r.nombre || '—')}</span>
        <span class="dash-rep-equipo">${esc((r.marca || '') + ' ' + (r.modelo || ''))}</span>
      </div>
    </div>`;
  }).join('');
  if (activos.length > 5) {
    el.innerHTML += `<p class="dash-more">+ ${activos.length - 5} más → <button class="dash-more-btn" onclick="switchSection('repairs')">ver todas</button></p>`;
  }
}

function renderDashLowStock() {
  const card = document.getElementById('dash-stock-card');
  const el   = document.getElementById('dash-stock-list');
  if (!card || !el) return;
  const rep = typeof REPUESTOS !== 'undefined' ? REPUESTOS : [];
  const low = rep.filter(r => r.stockMin != null && r.stockMin > 0 && (r.cantidad || 0) <= r.stockMin);
  if (!low.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  el.innerHTML = low.slice(0, 5).map(r =>
    `<div class="dash-stock-row">
      <span class="dash-stock-nombre">${esc(r.nombre)}</span>
      <span class="dash-stock-qty">${r.cantidad ?? 0} / mín ${r.stockMin}</span>
    </div>`
  ).join('');
  if (low.length > 5) el.innerHTML += `<p class="dash-more">+ ${low.length - 5} más</p>`;
}

function renderDashFollowUps() {
  const card  = document.getElementById('dash-seguimiento-card');
  const el    = document.getElementById('dash-seguimiento-list');
  if (!card || !el) return;
  const today = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
  const rep   = typeof REPAIRS !== 'undefined' ? REPAIRS : [];
  const pending = rep.filter(r => r.seguimientoFecha && r.seguimientoFecha <= today && !r.seguimientoAck);
  const badge = document.getElementById('nav-badge-dash');
  if (badge) { badge.style.display = pending.length ? '' : 'none'; }
  if (!pending.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  el.innerHTML = pending.map(r =>
    `<div class="dash-seg-row">
      <div class="dash-seg-info">
        <span class="dash-seg-nombre">${esc(r.nombre || '—')}</span>
        <span class="dash-seg-nota">${esc(r.seguimientoNota || r.seguimientoFecha || '')}</span>
      </div>
      <button class="dash-seg-ack" onclick="ackFollowUp('${esc(r.id)}')">✓ Listo</button>
    </div>`
  ).join('');
}

async function loadDashCaja() {
  const today = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
  try {
    const snap = await db.collection('caja_movimientos').where('fecha', '==', today).get();
    const movs = snap.docs.map(d => d.data());
    const ing  = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (Number(m.monto) || 0), 0);
    const eg   = movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + (Number(m.monto) || 0), 0);
    const neto = ing - eg;
    const set  = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('dash-caja-ing',  ing  ? '+$' + ing.toLocaleString('es-AR')  : '$0');
    set('dash-caja-eg',   eg   ? '−$' + eg.toLocaleString('es-AR')   : '$0');
    set('dash-caja-neto', '$' + Math.abs(neto).toLocaleString('es-AR'));
    const netoEl = document.getElementById('dash-caja-neto');
    if (netoEl) netoEl.style.color = neto >= 0 ? '#10b981' : '#ef4444';
  } catch(e) { console.warn('Dashboard caja:', e); }
}

async function ackFollowUp(id) {
  try {
    await db.collection('repairs').doc(id).update({ seguimientoAck: true });
    const r = REPAIRS.find(x => x.id === id);
    if (r) r.seguimientoAck = true;
    renderDashFollowUps();
    toast('Recordatorio marcado como listo', 'success');
  } catch(e) { toast('Error al actualizar', 'error'); }
}

// ── Render ────────────────────────────────────────────────
let renderTimer;
function debounceRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 60); }

function render() {
  const q = (document.getElementById('search').value || '').trim().toLowerCase();
  const fMarca = document.getElementById('f-marca').value;
  const fEstado = document.getElementById('f-estado').value;
  const fVend = document.getElementById('f-vendido').value;
  const fMin = parseInt(document.getElementById('f-min').value) || 0;
  const fMax = parseInt(document.getElementById('f-max').value) || 0;
  const fVendedorEl = document.getElementById('f-vendedor');
  const fVendedor = fVendedorEl ? fVendedorEl.value : '';
  const words = q ? q.split(/\s+/).filter(Boolean) : [];

  // Populate marca filter
  const marcas = [...new Set(STOCK.map(p => p.marca))].sort();
  const selM = document.getElementById('f-marca');
  const prevM = selM.value;
  while (selM.options.length > 1) selM.remove(1);
  marcas.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; selM.appendChild(o); });
  selM.value = prevM;

  // Populate vendedor filter
  if (fVendedorEl) {
    const vendedores = [...new Set(STOCK.filter(p => p.vendedor).map(p => p.vendedor))].sort();
    const prevV = fVendedorEl.value;
    while (fVendedorEl.options.length > 1) fVendedorEl.remove(1);
    vendedores.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; fVendedorEl.appendChild(o); });
    fVendedorEl.value = prevV;
  }

  // Apply pending ubicacion filter (from stats bar click)
  const fUbi = _pendingUbiFilter;

  const filtered = STOCK.filter(p => {
    if (fMarca && p.marca !== fMarca) return false;
    if (fEstado && p.estado !== fEstado) return false;
    if (fVend === '0' && p.vendido) return false;
    if (fVend === '1' && !p.vendido) return false;
    if (fMin > 0 && (p.precio || 0) < fMin) return false;
    if (fMax > 0 && (p.precio || 0) > fMax) return false;
    if (fVendedor && p.vendedor !== fVendedor) return false;
    if (fUbi && p.ubicacion !== fUbi) return false;
    if (words.length) {
      const hay = (p.marca + ' ' + p.modelo + ' ' + (p.imei || '') + ' ' + (p.notas || '')).toLowerCase();
      return words.every(w => hay.includes(w));
    }
    return true;
  });

  // Sort: sold items by fecha_venta desc, others by fecha desc
  filtered.sort((a, b) => {
    if (a.vendido && b.vendido) {
      return (b.fecha_venta || '').localeCompare(a.fecha_venta || '');
    }
    return (b.fecha || '').localeCompare(a.fecha || '');
  });

  const inStock = STOCK.filter(p => !p.vendido);
  const sold = STOCK.filter(p => p.vendido);
  document.getElementById('s-stock').textContent      = inStock.length;
  document.getElementById('s-sold').textContent       = sold.length;
  document.getElementById('s-exhibicion').textContent = inStock.filter(p => p.ubicacion === 'Exhibición').length;
  document.getElementById('s-deposito').textContent   = inStock.filter(p => p.ubicacion === 'Depósito').length;

  // Low qty banner (models with ≤1 unit in stock)
  const modelCount = {};
  inStock.forEach(p => {
    const k = p.marca + ' ' + p.modelo;
    modelCount[k] = (modelCount[k] || 0) + 1;
  });
  const lowQtyModels = Object.entries(modelCount).filter(([, c]) => c <= 1).sort((a, b) => a[0].localeCompare(b[0]));
  const lowQtyBanner = document.getElementById('stock-lowqty-banner');
  if (lowQtyBanner) {
    if (lowQtyModels.length > 0) {
      lowQtyBanner.style.display = '';
      const listEl2 = document.getElementById('stock-lowqty-list');
      if (listEl2) listEl2.innerHTML = lowQtyModels.map(([k]) => `<span class="lowstock-item">📱 ${esc(k)}</span>`).join('');
    } else {
      lowQtyBanner.style.display = 'none';
    }
  }

  _pendingUbiFilter = null; // reset after applying

  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  if (filtered.length === 0) {
    if (!_stockLoaded) {
      emptyEl.style.display = 'none';
      listEl.innerHTML = '<div class="list-loading"><span class="list-loading__spinner"></span>Cargando stock…</div>';
    } else {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
    }
    return;
  }
  emptyEl.style.display = 'none';

  const today = new Date();
  const badgeCls = { Nuevo: 'bg-new', Usado: 'bg-used', Reacondicionado: 'bg-refurb' };
  listEl.innerHTML = filtered.map(p => {
    const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' · ');
    const usdVal = p.precioUSD || ((!p.vendido && p.precio && dolarBlue) ? Math.round(p.precio / dolarBlue) : null);
    const isUSD = p.moneda === 'usd' && p.precioUSD;
    const ubiBadge = p.ubicacion === 'Exhibición'
      ? '<span class="badge-ubicacion">📺 Exhibición</span>'
      : p.ubicacion === 'Depósito'
        ? '<span class="badge-ubicacion badge-ubicacion--deposito">📦 Depósito</span>'
        : '';
    const stCls = p.vendido ? 'stock-vendido'
      : p.estado === 'Nuevo' ? 'stock-nuevo'
      : p.estado === 'Reacondicionado' ? 'stock-refurb'
      : 'stock-usado';

    // Date display: sold → fecha_venta, unsold → entry date
    let dateLabel = '';
    if (p.vendido && p.fecha_venta) {
      const fv = new Date(p.fecha_venta).toLocaleDateString('es-AR', { day:'2-digit', month:'short' });
      dateLabel = `<span class="card-date">🛒 ${fv}</span>`;
    } else if (!p.vendido && p.fecha) {
      const fi = new Date(p.fecha);
      const diffDays = Math.floor((today - fi) / 86400000);
      const diasStr = diffDays === 0 ? 'hoy' : diffDays === 1 ? '1 día' : diffDays + ' días';
      const oldCls = diffDays >= 30 ? ' card-old' : '';
      dateLabel = `<span class="card-date${oldCls}" title="Ingresó hace ${diasStr}">📅 ${diasStr}</span>`;
    }

    // Battery badge for non-sold iPhones (marca "Apple" or contains "iPhone")
    const bateriaBadge = (!p.vendido && p.bateria && (/iphone/i.test(p.marca) || /apple/i.test(p.marca)))
      ? `<span class="card-bateria">🔋 ${p.bateria}%</span>`
      : '';

    // Payment method for sold items
    const pagoBadge = (p.vendido && p.forma_pago)
      ? `<span class="card-pago">${esc(p.forma_pago)}</span>`
      : '';

    return `
      <div class="card ${stCls}${p.vendido ? ' card-sold' : ''}" onclick="openDetail('${p.id}')">
        <div class="card-top">
          <div class="card-info">
            <span class="card-marca">📱 ${esc(p.marca)}</span>
            <span class="card-modelo">${esc(p.modelo)}</span>
            ${specs ? `<span class="card-specs">${esc(specs)}${bateriaBadge}</span>` : bateriaBadge}
          </div>
          <div class="card-right">
            ${ubiBadge}
            <span class="badge ${badgeCls[p.estado] || ''}">${esc(p.estado)}</span>
            ${p.vendido ? '<span class="badge bg-sold">VENDIDO</span>' : ''}
          </div>
        </div>
        <div class="card-bottom">
          <span class="card-price">${isUSD
            ? `U$D ${p.precioUSD.toLocaleString('es-AR')}${p.precio ? `<span class="card-usd">≈ $${p.precio.toLocaleString('es-AR')}</span>` : ''}`
            : p.precio ? '$ ' + p.precio.toLocaleString('es-AR') + (usdVal ? `<span class="card-usd">U$D ${usdVal.toLocaleString('es-AR')}</span>` : '') : '—'
          }</span>
          <div class="card-meta">
            ${p.imei ? `<span class="card-imei">🔑 ${esc(p.imei)}</span>` : ''}
            ${dateLabel}
            ${pagoBadge}
          </div>
        </div>
      </div>`;
  }).join('');
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Formulario ────────────────────────────────────────────
function openForm(id) {
  editingId = id || null;
  const t = document.getElementById('form-title');
  const btnM = document.getElementById('btn-moneda');
  const helper = document.getElementById('fi-precio-helper');
  monedaMode = 'ars';
  if (id) {
    const p = STOCK.find(x => x.id === id);
    if (!p) return;
    t.textContent = '✏️ Editar Equipo';
    document.getElementById('fi-marca').value     = p.marca         || '';
    document.getElementById('fi-modelo').value    = p.modelo        || '';
    document.getElementById('fi-estado').value    = p.estado        || '';
    document.getElementById('fi-storage').value   = p.almacenamiento|| '';
    document.getElementById('fi-ram').value       = p.ram           || '';
    document.getElementById('fi-imei').value      = p.imei          || '';
    document.getElementById('fi-notas').value     = p.notas         || '';
    document.getElementById('fi-ubicacion').value = p.ubicacion     || '';
    document.getElementById('fi-bateria').value   = p.bateria       || '';
    _updateBateriaVisibility(p.marca || '');
    // Restaurar modo USD si el equipo fue cargado en dólares
    if (p.moneda === 'usd' && p.precioUSD) {
      monedaMode = 'usd';
      document.getElementById('fi-precio').value = p.precioUSD;
      if (btnM) { btnM.textContent = 'USD $'; btnM.classList.add('btn-moneda--usd'); }
      if (helper) helper.textContent = dolarBlue ? `Cotización: $${dolarBlue.toLocaleString('es-AR')} (blue)` : 'Cotización no disponible';
    } else {
      document.getElementById('fi-precio').value = p.precio || '';
      if (btnM) { btnM.textContent = 'ARS $'; btnM.classList.remove('btn-moneda--usd'); }
      if (helper) helper.textContent = '';
    }
  } else {
    t.textContent = '📱 Agregar Equipo';
    ['fi-marca','fi-modelo','fi-precio','fi-imei','fi-notas'].forEach(fid => { document.getElementById(fid).value = ''; });
    document.getElementById('fi-estado').value    = '';
    document.getElementById('fi-storage').value   = '';
    document.getElementById('fi-ram').value       = '';
    document.getElementById('fi-ubicacion').value = '';
    document.getElementById('fi-bateria').value   = '';
    _updateBateriaVisibility('');
    if (btnM) { btnM.textContent = 'ARS $'; btnM.classList.remove('btn-moneda--usd'); }
    if (helper) helper.textContent = '';
  }
  document.getElementById('form-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  _blockFormClose = true;
  setTimeout(() => { _blockFormClose = false; }, 400);
  setTimeout(() => document.getElementById('fi-marca').focus(), 300);
}

function closeForm() {
  document.getElementById('form-modal').classList.add('hidden');
  document.body.style.overflow = '';
  editingId = null;
}

function savePhone() {
  // Conversión USD→ARS si corresponde
  if (monedaMode === 'usd') {
    const usdVal = parseFloat(document.getElementById('fi-precio').value) || 0;
    if (!usdVal) { toast('Ingresá un precio en dólares', 'error'); return; }
    window._precioUSD = usdVal;
    document.getElementById('fi-precio').value = dolarBlue ? Math.round(usdVal * dolarBlue) : 0;
  } else {
    window._precioUSD = null;
  }

  const marca     = document.getElementById('fi-marca').value.trim();
  const modelo    = document.getElementById('fi-modelo').value.trim();
  const estado    = document.getElementById('fi-estado').value;
  const precio    = parseInt(document.getElementById('fi-precio').value) || 0;
  const storage   = document.getElementById('fi-storage').value;
  const ram       = document.getElementById('fi-ram').value;
  const imei      = document.getElementById('fi-imei').value.trim();
  const notas     = document.getElementById('fi-notas').value.trim();
  const ubicacion = document.getElementById('fi-ubicacion').value;

  if (!marca) { toast('Ingresá la marca', 'error'); return; }
  if (!modelo) { toast('Ingresá el modelo', 'error'); return; }
  if (!estado) { toast('Seleccioná el estado', 'error'); return; }
  if (!precio || precio <= 0) { toast('Ingresá un precio válido', 'error'); return; }
  if (imei && !/^\d{15}$/.test(imei)) { toast('El IMEI debe tener 15 dígitos', 'error'); return; }
  if (imei) {
    const dup = STOCK.find(x => x.imei === imei && x.id !== editingId);
    if (dup) { toast('Ya existe un equipo con ese IMEI', 'error'); return; }
  }

  const bateria  = parseInt(document.getElementById('fi-bateria').value) || null;
  const esUSD    = window._precioUSD !== null;
  const precioUSD = window._precioUSD;
  window._precioUSD = null;
  monedaMode = 'ars';

  if (editingId) {
    const existing = STOCK.find(x => x.id === editingId);
    if (!existing) { closeForm(); return; }
    const upd = { ...existing, marca, modelo, estado, precio, almacenamiento: storage, ram, imei, notas, ubicacion };
    if (bateria) upd.bateria = bateria; else delete upd.bateria;
    if (esUSD) { upd.precioUSD = precioUSD; upd.moneda = 'usd'; }
    else { delete upd.precioUSD; upd.moneda = 'ars'; }
    db.collection('stock').doc(editingId).set(upd);
    toast('Equipo actualizado', 'success');
  } else {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const newDoc = { id, marca, modelo, estado, precio, almacenamiento: storage, ram, imei, notas, ubicacion, fecha: new Date().toISOString(), vendido: false };
    if (bateria) newDoc.bateria = bateria;
    if (esUSD) { newDoc.precioUSD = precioUSD; newDoc.moneda = 'usd'; }
    db.collection('stock').doc(id).set(newDoc);
    toast('Equipo agregado al stock', 'success');
  }
  closeForm();
}

// ── Detalle ───────────────────────────────────────────────
function openDetail(id) {
  const p = STOCK.find(x => x.id === id);
  if (!p) return;
  document.getElementById('det-marca').textContent = p.marca;
  document.getElementById('det-modelo').textContent = p.modelo;

  const badgeCls = { Nuevo: 'bg-new', Usado: 'bg-used', Reacondicionado: 'bg-refurb' };
  const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' · ');
  const fechaIng = p.fecha ? fmtDateTime(p.fecha) : '—';
  const fechaVta = p.fecha_venta ? fmtDateTime(p.fecha_venta) : null;

  document.getElementById('det-body').innerHTML = `
    <div class="det-row">
      <span class="det-label">Estado</span>
      <span class="badge ${badgeCls[p.estado] || ''}">${esc(p.estado)}</span>
    </div>
    <div class="det-row">
      <span class="det-label">Precio efectivo</span>
      <span class="det-val det-price">${p.moneda === 'usd' && p.precioUSD
        ? `U$D ${p.precioUSD.toLocaleString('es-AR')}${p.precio ? ` <small style="color:var(--t2);font-weight:400">(≈ $${p.precio.toLocaleString('es-AR')})</small>` : ''}`
        : '$ ' + (p.precio ? p.precio.toLocaleString('es-AR') : '—')}</span>
    </div>
    ${specs ? `<div class="det-row"><span class="det-label">Specs</span><span class="det-val">${esc(specs)}</span></div>` : ''}
    ${p.bateria ? `<div class="det-row"><span class="det-label">Batería</span><span class="det-val">🔋 ${p.bateria}%</span></div>` : ''}
    ${p.imei ? `<div class="det-row"><span class="det-label">IMEI</span><span class="det-val det-imei">${esc(p.imei)}</span></div>` : ''}
    <div class="det-row">
      <span class="det-label">Ingreso</span>
      <span class="det-val">${fechaIng}</span>
    </div>
    ${fechaVta ? `<div class="det-row"><span class="det-label">Venta</span><span class="det-val">${fechaVta}</span></div>` : ''}
    ${p.vendedor ? `<div class="det-row"><span class="det-label">Vendedor</span><span class="det-val">${esc(p.vendedor)}</span></div>` : ''}
    ${p.forma_pago ? `<div class="det-row"><span class="det-label">Forma de pago</span><span class="det-val">${esc(p.forma_pago)}</span></div>` : ''}
    ${p.notas ? `<div class="det-row det-row--full"><span class="det-label">Notas</span><span class="det-val">${esc(p.notas)}</span></div>` : ''}
    ${!p.vendido && p.precio ? buildPriceTable(p.precio) : ''}
    ${p.vendido ? '<div class="det-sold-badge">VENDIDO</div>' : ''}
  `;

  document.getElementById('det-actions').innerHTML = `
    ${!p.vendido ? `<button class="btn-whatsapp" onclick="shareWhatsApp('${p.id}')">🟢 WhatsApp</button>` : ''}
    <button class="btn-copy" onclick="copyInfo('${p.id}')">📋 Copiar</button>
    ${!p.vendido ? `<button class="btn-edit" onclick="closeDetail();openForm('${p.id}')">✏️ Editar</button>` : ''}
    ${!p.vendido ? `<button class="btn-sell" onclick="markSold('${p.id}')">💰 Vendido</button>` : `<button class="btn-unsell" onclick="markUnsold('${p.id}')">↩️ Reactivar</button>`}
    <button class="btn-delete" onclick="deletePhone('${p.id}')">🗑️</button>
  `;

  document.getElementById('detail-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── Filter shortcuts (stats bar clicks) ──────────────────
function filterToInStock() {
  document.getElementById('f-vendido').value = '0';
  debounceRender();
}
function filterToSold() {
  document.getElementById('f-vendido').value = '1';
  debounceRender();
}
function filterToUbicacion(ubi) {
  document.getElementById('f-vendido').value = '0';
  // use search box to filter by ubicacion via keyword isn't ideal;
  // instead set a known-safe text search — but we don't have a ubicacion filter.
  // Workaround: trigger a custom render with ubicacion override via search text:
  // Actually let's just scroll and highlight. Simple: filter by marca reset + set f-marca
  // Best option: store pending ubicacion override and apply in render.
  // For now: use fMarca to filter is wrong. Let's do a quick f-marca='' + search fill:
  _pendingUbiFilter = ubi;
  debounceRender();
}
let _pendingUbiFilter = null;

function toggleStockLowBanner() {
  const list = document.getElementById('stock-lowqty-list');
  const chevron = document.getElementById('stock-lowqty-chevron');
  if (!list) return;
  const isOpen = !list.classList.contains('hidden');
  list.classList.toggle('hidden', isOpen);
  if (chevron) chevron.classList.toggle('open', !isOpen);
}

function _updateBateriaVisibility(marca) {
  const wrap = document.getElementById('fi-bateria-wrap');
  if (!wrap) return;
  wrap.style.display = (/iphone/i.test(marca) || /apple/i.test(marca)) ? '' : 'none';
}

function buildPriceTable(precio) {
  if (!precio) return '';
  const fmt = n => '$ ' + Math.round(n).toLocaleString('es-AR');
  const transferTotal = Math.round(precio * (1 + (PRICES.transfer || 0) / 100));
  const c3Total = Math.round(precio * (1 + (PRICES.c3 || 0) / 100));
  const c6Total = Math.round(precio * (1 + (PRICES.c6 || 0) / 100));
  const usd = dolarBlue ? Math.round(precio / dolarBlue) : null;
  return `
    <div class="price-table-wrap">
      <div class="price-table-title">💳 Precios por forma de pago</div>
      <div class="price-table">
        <div class="pt-row pt-efectivo">
          <span class="pt-label">💵 Efectivo</span>
          <span class="pt-value">${fmt(precio)}</span>
        </div>
        <div class="pt-row">
          <span class="pt-label">🏦 Transf. / 1 pago${(PRICES.transfer||0) > 0 ? ' <small>(+'+PRICES.transfer+'%)</small>' : ''}</span>
          <span class="pt-value">${fmt(transferTotal)}</span>
        </div>
        <div class="pt-row">
          <span class="pt-label">📆 3 cuotas${(PRICES.c3||0) > 0 ? ' <small>(+'+PRICES.c3+'%)</small>' : ''}</span>
          <span class="pt-value">${fmt(c3Total / 3)}<span class="pt-sub">/cuota</span></span>
        </div>
        <div class="pt-row">
          <span class="pt-label">📆 6 cuotas${(PRICES.c6||0) > 0 ? ' <small>(+'+PRICES.c6+'%)</small>' : ''}</span>
          <span class="pt-value">${fmt(c6Total / 6)}<span class="pt-sub">/cuota</span></span>
        </div>
        ${usd !== null ? `<div class="pt-row pt-usd">
          <span class="pt-label">💲 Dólares <span class="pt-sub">(blue ${dolarBlue.toLocaleString('es-AR')})</span></span>
          <span class="pt-value">U$S ${usd.toLocaleString('es-AR')}</span>
        </div>` : ''}
      </div>
    </div>`;
}

const TZ = 'America/Argentina/Buenos_Aires';
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: TZ,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('es-AR', {
    timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric'
  });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit'
  });
}
function nowAR() {
  // Retorna string ISO en hora AR (para guardar en Firestore)
  return new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T') + ':00.000Z';
}

// ── WhatsApp ──────────────────────────────────────────────
function shareWhatsApp(id) {
  const p = STOCK.find(x => x.id === id);
  if (!p) return;
  const specs  = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' / ');
  const precio = p.precio ? '$ ' + p.precio.toLocaleString('es-AR') : '—';
  const tpl = WA_TEMPLATES.stock ||
    '📱 *{marca} {modelo}*\n{specs}\n✅ Estado: {estado}\n💰 Precio: {precio}\n\n_Consultá disponibilidad_ 👋';
  const msg = tpl
    .replace(/{marca}/g, p.marca || '')
    .replace(/{modelo}/g, p.modelo || '')
    .replace(/{specs}/g, specs ? '💾 ' + specs : '')
    .replace(/{estado}/g, p.estado || '')
    .replace(/{precio}/g, precio)
    .replace(/{notas}/g, p.notas || '');
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

// ── Copiar info ───────────────────────────────────────────
function copyInfo(id) {
  const p = STOCK.find(x => x.id === id);
  if (!p) return;
  const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' / ');
  let text = `${p.marca} ${p.modelo}`;
  if (specs) text += ` - ${specs}`;
  if (p.estado) text += ` - ${p.estado}`;
  text += ` - $${(p.precio || 0).toLocaleString('es-AR')}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => { toast('Info copiada al portapapeles', 'success'); }).catch(() => toast('No se pudo copiar', 'error'));
  } else { toast('Tu navegador no soporta copiar', 'error'); }
}

// ── Acciones ──────────────────────────────────────────────
function markSold(id) { openSellModal(id); }

function markUnsold(id) {
  const p = STOCK.find(x => x.id === id);
  if (!p) return;
  const updated = { ...p, vendido: false };
  delete updated.fecha_venta;
  delete updated.vendedor;
  delete updated.forma_pago;
  db.collection('stock').doc(id).set(updated);
  closeDetail();
  toast('Reactivado al stock', 'success');
}
function deletePhone(id) {
  const p = STOCK.find(x => x.id === id);
  if (!p) return;
  if (!confirm('¿Eliminar ' + p.marca + ' ' + p.modelo + '?')) return;
  db.collection('stock').doc(id).delete();
  closeDetail();
  toast('Equipo eliminado', 'info');
}

// ── Modal Venta ───────────────────────────────────────────
function openSellModal(id) {
  pendingSellId = id;
  const selV = document.getElementById('sell-vendedor');
  const selP = document.getElementById('sell-pago');
  selV.innerHTML = SELLERS.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  selP.innerHTML = PAYMENTS.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  document.getElementById('sell-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeSellModal() {
  document.getElementById('sell-modal').classList.add('hidden');
  document.body.style.overflow = '';
  pendingSellId = null;
}

function confirmSell() {
  const id = pendingSellId;
  if (!id) return;
  const p          = STOCK.find(x => x.id === id);
  const vendedor   = document.getElementById('sell-vendedor').value;
  const formaPago  = document.getElementById('sell-pago').value;
  const regCaja    = document.getElementById('sell-caja-check')?.checked ?? true;

  const ahora = new Date().toISOString();
  const batch = db.batch();

  // ── Marcar equipo como vendido ──
  batch.update(db.collection('stock').doc(id), {
    vendido: true,
    fecha_venta: ahora,
    vendedor,
    forma_pago: formaPago
  });

  // ── Registrar en caja (si toggle activo y tiene precio) ──
  if (regCaja && p?.precio > 0) {
    const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' ');
    const desc  = `Venta: ${p.marca} ${p.modelo}${specs ? ' ' + specs : ''}`;
    const movRef = db.collection('caja_movimientos').doc();
    batch.set(movRef, {
      tipo: 'ingreso',
      categoria: 'Venta',
      descripcion: desc,
      monto: p.precio,
      metodoPago: formaPago,
      fecha: todayAR(),
      createdAt: ahora,
      stockId: id
    });
  }

  batch.commit().catch(e => console.error('confirmSell batch:', e));

  // ── Log de actividad ──
  if (p) {
    db.collection('actividad').add({
      tipo: 'venta',
      desc: `Venta: ${p.marca} ${p.modelo}${p.almacenamiento ? ' '+p.almacenamiento : ''} — $${(p.precio||0).toLocaleString('es-AR')}`,
      tecnico: vendedor || null,
      repairId: null,
      extra: { stockId: id, precio: p.precio, formaPago, marca: p.marca, modelo: p.modelo },
      fecha: ahora
    }).catch(() => {});
  }

  closeSellModal();
  closeDetail();
  toast(regCaja ? 'Venta registrada en caja ✅' : 'Venta registrada ✅', 'success');
}

// ── Modal Estadísticas ────────────────────────────────────
function openStats() {
  currentTab = 'ventas';
  document.getElementById('tab-ventas').classList.add('active');
  document.getElementById('tab-entradas').classList.remove('active');
  renderStatsVentas();
  document.getElementById('stats-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeStats() {
  document.getElementById('stats-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tab-ventas').classList.toggle('active', tab === 'ventas');
  document.getElementById('tab-entradas').classList.toggle('active', tab === 'entradas');
  if (tab === 'ventas') renderStatsVentas();
  else renderStatsEntradas();
}

function renderStatsVentas() {
  const now     = new Date();
  const sold    = STOCK.filter(p => p.vendido && p.fecha_venta);
  const inStock = STOCK.filter(p => !p.vendido);
  const totalVentas = sold.reduce((s, p) => s + (p.precio || 0), 0);
  const promedio    = sold.length > 0 ? Math.round(totalVentas / sold.length) : 0;

  // Mes actual vs anterior
  const mesCur  = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const prevDate = new Date(now); prevDate.setMonth(prevDate.getMonth() - 1);
  const mesAnterior = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');
  const ventasMes  = sold.filter(p => p.fecha_venta && p.fecha_venta.startsWith(mesCur));
  const ventasPrev = sold.filter(p => p.fecha_venta && p.fecha_venta.startsWith(mesAnterior));
  const totalMes   = ventasMes.reduce((s, p) => s + (p.precio || 0), 0);
  const totalPrev  = ventasPrev.reduce((s, p) => s + (p.precio || 0), 0);

  // Top marcas
  const marcaCount = {};
  sold.forEach(p => { marcaCount[p.marca] = (marcaCount[p.marca] || 0) + 1; });
  const topMarcas = Object.entries(marcaCount).sort((a,b) => b[1]-a[1]).slice(0, 5);

  // Top modelos
  const modelCount = {};
  sold.forEach(p => {
    const k = p.marca + ' ' + p.modelo;
    modelCount[k] = (modelCount[k] || 0) + 1;
  });
  const topModelos = Object.entries(modelCount).sort((a,b) => b[1]-a[1]).slice(0, 5);

  // Vendedores
  const vendCount = {};
  sold.filter(p => p.vendedor).forEach(p => { vendCount[p.vendedor] = (vendCount[p.vendedor] || 0) + 1; });
  const topVend = Object.entries(vendCount).sort((a,b) => b[1]-a[1]);

  // Formas de pago
  const pagoCount = {};
  sold.filter(p => p.forma_pago).forEach(p => { pagoCount[p.forma_pago] = (pagoCount[p.forma_pago] || 0) + 1; });
  const topPagos = Object.entries(pagoCount).sort((a,b) => b[1]-a[1]);

  // Por mes
  const byMonth = {};
  sold.forEach(p => {
    const d = new Date(p.fecha_venta);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const lbl = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    if (!byMonth[key]) byMonth[key] = { label: lbl, items: [], total: 0 };
    byMonth[key].items.push(p);
    byMonth[key].total += p.precio || 0;
  });
  const keys = Object.keys(byMonth).sort().reverse();
  const bestMonth = keys.reduce((best, k) => !best || byMonth[k].total > byMonth[best].total ? k : best, null);

  const diff = totalPrev > 0 ? Math.round(((totalMes - totalPrev) / totalPrev) * 100) : null;

  let html = `
    <div class="ss-grid">
      <div class="ss-card"><div class="ss-num">${inStock.length}</div><div class="ss-lbl">En stock</div></div>
      <div class="ss-card"><div class="ss-num">${sold.length}</div><div class="ss-lbl">Total vendidos</div></div>
      <div class="ss-card ss-green"><div class="ss-num">$${totalMes.toLocaleString('es-AR')}</div><div class="ss-lbl">Este mes</div></div>
      <div class="ss-card ss-green"><div class="ss-num">$${totalVentas.toLocaleString('es-AR')}</div><div class="ss-lbl">Total acumulado</div></div>
      ${promedio > 0 ? `<div class="ss-card"><div class="ss-num">$${promedio.toLocaleString('es-AR')}</div><div class="ss-lbl">Precio promedio</div></div>` : ''}
      ${diff !== null ? `<div class="ss-card ${diff >= 0 ? 'ss-green' : ''}"><div class="ss-num" style="color:${diff >= 0 ? 'var(--grn)' : '#ef4444'}">${diff >= 0 ? '+' : ''}${diff}%</div><div class="ss-lbl">vs mes anterior</div></div>` : ''}
      ${bestMonth ? `<div class="ss-card ss-blue"><div class="ss-num" style="font-size:.72rem">$${byMonth[bestMonth].total.toLocaleString('es-AR')}</div><div class="ss-lbl">Mejor mes</div></div>` : ''}
      ${topVend[0] ? `<div class="ss-card ss-blue"><div class="ss-num" style="font-size:.75rem">${esc(topVend[0][0])}</div><div class="ss-lbl">Mejor vendedor</div></div>` : ''}
    </div>`;

  if (topMarcas.length > 0) {
    html += `<h4 class="hist-title" style="margin-top:10px">📊 Top marcas vendidas</h4>`;
    const maxMarca = topMarcas[0][1];
    html += topMarcas.map(([marca, cnt]) => `
      <div class="hist-item">
        <div class="hist-item-info"><div class="hist-item-name">${esc(marca)}</div>
          <div style="height:5px;border-radius:3px;background:#e2e8f0;margin-top:4px;overflow:hidden">
            <div style="height:100%;width:${Math.round(cnt/maxMarca*100)}%;background:var(--acc);border-radius:3px"></div>
          </div>
        </div>
        <span class="badge bg-reparando">${cnt}</span>
      </div>`).join('');
  }

  if (topModelos.length > 0) {
    html += `<h4 class="hist-title" style="margin-top:10px">📱 Modelos más vendidos</h4>`;
    html += topModelos.map(([modelo, cnt], i) => `
      <div class="hist-item">
        <div class="hist-item-info"><div class="hist-item-name">${i+1}. ${esc(modelo)}</div></div>
        <span class="badge bg-entregado">${cnt}</span>
      </div>`).join('');
  }

  if (topPagos.length > 0) {
    html += `<h4 class="hist-title" style="margin-top:10px">💳 Formas de pago</h4>`;
    html += topPagos.map(([pago, cnt]) => `
      <div class="hist-item">
        <div class="hist-item-info"><div class="hist-item-name">${esc(pago)}</div></div>
        <span class="badge bg-reparando">${cnt}</span>
      </div>`).join('');
  }

  html += `<h4 class="hist-title" style="margin-top:12px">📅 Historial mensual</h4>`;
  if (keys.length === 0) {
    html += '<p class="hist-empty">Sin ventas registradas aún 📦</p>';
  } else {
    keys.forEach(k => {
      const m = byMonth[k];
      html += `<div class="hist-month">
        <div class="hist-month-hdr">
          <span class="hist-month-name">${m.label}${k === bestMonth ? ' 🏆' : ''}</span>
          <span class="hist-month-stats">${m.items.length} venta${m.items.length !== 1 ? 's' : ''} · $${m.total.toLocaleString('es-AR')}</span>
        </div>
        ${m.items.map(p => {
          const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' · ');
          const hora = p.fecha_venta ? fmtDateTime(p.fecha_venta) : '';
          return `<div class="hist-item">
            <div class="hist-item-info">
              <span class="hist-item-name">${esc(p.marca)} ${esc(p.modelo)}</span>
              ${specs ? `<span class="hist-item-specs">${esc(specs)}</span>` : ''}
              <span class="hist-item-meta">${hora}${p.vendedor ? ' · ' + esc(p.vendedor) : ''}${p.forma_pago ? ' · ' + esc(p.forma_pago) : ''}</span>
            </div>
            <span class="hist-item-price">$${(p.precio || 0).toLocaleString('es-AR')}</span>
          </div>`;
        }).join('')}
      </div>`;
    });
  }
  document.getElementById('stats-body').innerHTML = html;
}

function renderStatsEntradas() {
  const byMonth = {};
  STOCK.forEach(p => {
    if (!p.fecha) return;
    const d = new Date(p.fecha);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const lbl = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    if (!byMonth[key]) byMonth[key] = { label: lbl, items: [] };
    byMonth[key].items.push(p);
  });
  const keys = Object.keys(byMonth).sort().reverse();
  const badgeCls = { Nuevo: 'bg-new', Usado: 'bg-used', Reacondicionado: 'bg-refurb' };

  let html = '<h4 class="hist-title">Entradas de equipos por mes</h4>';
  if (keys.length === 0) {
    html += '<p class="hist-empty">Sin entradas registradas 📦</p>';
  } else {
    keys.forEach(k => {
      const m = byMonth[k];
      html += `<div class="hist-month">
        <div class="hist-month-hdr">
          <span class="hist-month-name">${m.label}</span>
          <span class="hist-month-stats">${m.items.length} equipo${m.items.length !== 1 ? 's' : ''}</span>
        </div>
        ${m.items.map(p => {
          const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' · ');
          const hora = p.fecha ? fmtDateTime(p.fecha) : '';
          return `<div class="hist-item">
            <div class="hist-item-info">
              <span class="hist-item-name">${esc(p.marca)} ${esc(p.modelo)}</span>
              ${specs ? `<span class="hist-item-specs">${esc(specs)}</span>` : ''}
              <span class="hist-item-meta">${hora}</span>
            </div>
            <div style="text-align:right">
              <span class="badge ${badgeCls[p.estado] || ''}" style="font-size:.6rem">${esc(p.estado)}</span>
              <div class="hist-item-price" style="margin-top:3px">$${(p.precio || 0).toLocaleString('es-AR')}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    });
  }
  document.getElementById('stats-body').innerHTML = html;
}

// ── Export / Import ───────────────────────────────────────
function openExport() { document.getElementById('export-modal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeExport() { document.getElementById('export-modal').classList.add('hidden'); document.body.style.overflow = ''; }

function exportCSV() {
  const headers = ['Marca','Modelo','Estado','Precio','Almacenamiento','RAM','IMEI','Notas','Fecha Ingreso','Vendido','Fecha Venta','Vendedor','Forma de Pago'];
  const rows = STOCK.map(p => [
    p.marca, p.modelo, p.estado, p.precio || 0,
    p.almacenamiento || '', p.ram || '', p.imei || '', p.notas || '',
    p.fecha ? fmtDateTime(p.fecha) : '',
    p.vendido ? 'Sí' : 'No',
    p.fecha_venta ? fmtDateTime(p.fecha_venta) : '',
    p.vendedor || '', p.forma_pago || ''
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'stock_celulares_' + new Date().toISOString().slice(0,10) + '.csv' });
  a.click(); URL.revokeObjectURL(a.href);
  closeExport(); toast('Stock exportado como CSV ✅', 'success');
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(STOCK, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'backup_stock_' + new Date().toISOString().slice(0,10) + '.json' });
  a.click(); URL.revokeObjectURL(a.href);
  closeExport(); toast('Backup guardado ✅', 'success');
}

function importJSON(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error('Formato inválido');
      if (!confirm(`¿Restaurar ${data.length} equipos? Esto reemplazará el stock actual.`)) return;
      db.collection('stock').get().then(snap => {
                const batch = db.batch();
                snap.docs.forEach(doc => batch.delete(doc.ref));
                data.forEach(p => {
                            const id = p.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                            batch.set(db.collection('stock').doc(id), { ...p, id });
                });
                return batch.commit();
      }).then(() => {
                closeExport();
                toast(`Stock restaurado: ${data.length} equipos ✅`, 'success');
      }).catch(err => toast('Error al importar: ' + err.message, 'error'));
    } catch (err) { toast('Archivo inválido: ' + err.message, 'error'); }
  };
  reader.readAsText(file, 'UTF-8'); e.target.value = '';
}

// ── Configuración ─────────────────────────────────────────
function openSettings() {
  renderSettingsSellers();
  renderSettingsPayments();
  renderSettingsPrices();
  updateBizPreview();
  if (typeof updateWaNotifyStatus === 'function') updateWaNotifyStatus();
  document.getElementById('settings-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function renderSettingsSellers() {
  const el = document.getElementById('sellers-list');
  if (!SELLERS.length) { el.innerHTML = '<p class="settings-empty">Sin vendedores registrados</p>'; return; }
  el.innerHTML = SELLERS.map((s, i) => `
    <div class="settings-item">
      <span class="settings-item-name">${esc(s)}</span>
      <button class="settings-del-btn" onclick="removeSeller(${i})">🗑️</button>
    </div>`).join('');
}

function renderSettingsPayments() {
  const el = document.getElementById('payments-list');
  if (!PAYMENTS.length) { el.innerHTML = '<p class="settings-empty">Sin medios de pago registrados</p>'; return; }
  el.innerHTML = PAYMENTS.map((p, i) => `
    <div class="settings-item">
      <span class="settings-item-name">${esc(p)}</span>
      <button class="settings-del-btn" onclick="removePayment(${i})">🗑️</button>
    </div>`).join('');
}

function renderSettingsPrices() {
  const inp = document.getElementById('price-transfer');
  if (inp) inp.value = PRICES.transfer ?? 0;
  const inp3 = document.getElementById('price-c3');
  if (inp3) inp3.value = PRICES.c3 ?? 15;
  const inp6 = document.getElementById('price-c6');
  if (inp6) inp6.value = PRICES.c6 ?? 25;

  const dolarInput  = document.getElementById('dolar-blue-input');
  const dolarStatus = document.getElementById('dolar-blue-status');
  const dolarApiLbl = document.getElementById('dolar-blue-api-label');
  const resetBtn    = document.getElementById('dolar-reset-btn');
  const manual      = parseInt(localStorage.getItem('dolarManual')) || 0;
  if (dolarInput)  dolarInput.value = dolarBlue || '';
  if (dolarApiLbl) dolarApiLbl.textContent = manual > 0
    ? 'Manual (API ignorada)'
    : dolarBlue ? 'API: $' + dolarBlue.toLocaleString('es-AR') : 'API: no disponible';
  if (dolarStatus) dolarStatus.textContent = manual > 0
    ? '✏️ Usando cotización manual: $' + manual.toLocaleString('es-AR')
    : dolarBlue ? '🌐 Cotización automática desde dolarapi.com' : '';
  if (resetBtn)    resetBtn.style.display = manual > 0 ? '' : 'none';
}

function savePriceSettings() {
  PRICES.transfer = parseInt(document.getElementById('price-transfer').value) || 0;
  PRICES.c3 = parseInt(document.getElementById('price-c3').value) || 0;
  PRICES.c6 = parseInt(document.getElementById('price-c6').value) || 0;
  savePrices();
  toast('Precios actualizados ✅', 'success');
}

function addSeller() {
  const inp = document.getElementById('new-seller');
  const val = inp.value.trim();
  if (!val) { toast('Ingresá un nombre', 'error'); return; }
  if (SELLERS.includes(val)) { toast('Ya existe ese vendedor', 'error'); return; }
  SELLERS.push(val); saveSellers(); inp.value = '';
  renderSettingsSellers(); toast('Vendedor agregado ✅', 'success');
}

function removeSeller(i) {
  if (!confirm(`¿Eliminar "${SELLERS[i]}"?`)) return;
  SELLERS.splice(i, 1); saveSellers(); renderSettingsSellers();
  toast('Vendedor eliminado', 'info');
}

function addPayment() {
  const inp = document.getElementById('new-payment');
  const val = inp.value.trim();
  if (!val) { toast('Ingresá un medio de pago', 'error'); return; }
  if (PAYMENTS.includes(val)) { toast('Ya existe ese medio de pago', 'error'); return; }
  PAYMENTS.push(val); savePayments(); inp.value = '';
  renderSettingsPayments(); toast('Medio de pago agregado ✅', 'success');
}

function removePayment(i) {
  if (!confirm(`¿Eliminar "${PAYMENTS[i]}"?`)) return;
  PAYMENTS.splice(i, 1); savePayments(); renderSettingsPayments();
  toast('Medio de pago eliminado', 'info');
}

// ── Imagen del negocio ────────────────────────────────────
function handleBizImage(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    BIZ_IMAGE = ev.target.result;
    saveBizImage(); applyBizImage(); updateBizPreview();
    toast('Imagen guardada ✅', 'success');
  };
  reader.readAsDataURL(file); e.target.value = '';
}

function removeBizImage() {
  BIZ_IMAGE = null; saveBizImage(); applyBizImage(); updateBizPreview();
  toast('Imagen eliminada', 'info');
}

function applyBizImage() {
  const hdrImg = document.getElementById('hdr-biz-img');
  const loginImg = document.getElementById('login-biz-img');
  const loginIcon = document.getElementById('login-default-icon');
  if (BIZ_IMAGE) {
    if (hdrImg) { hdrImg.src = BIZ_IMAGE; hdrImg.style.display = 'block'; }
    if (loginImg) { loginImg.src = BIZ_IMAGE; loginImg.style.display = 'block'; }
    if (loginIcon) loginIcon.style.display = 'none';
  } else {
    if (hdrImg) hdrImg.style.display = 'none';
    if (loginImg) loginImg.style.display = 'none';
    if (loginIcon) loginIcon.style.display = '';
  }
}

function updateBizPreview() {
  const preview = document.getElementById('biz-preview');
  const removeBtn = document.getElementById('biz-remove');
  if (!preview) return;
  if (BIZ_IMAGE) {
    preview.innerHTML = `<img src="${BIZ_IMAGE}" class="biz-preview-img" alt="Logo">`;
    if (removeBtn) removeBtn.style.display = '';
  } else {
    preview.innerHTML = '<span class="biz-no-img">Sin imagen cargada</span>';
    if (removeBtn) removeBtn.style.display = 'none';
  }
}

// ── Toast ─────────────────────────────────────────────────
let toastTimer;
function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + (type || 'info');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── PWA ───────────────────────────────────────────────────
function initPWA() {
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(() => {}); }
  let deferredPrompt = null;
  const banner = document.getElementById('install-banner');
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; banner.classList.add('show'); });
  document.getElementById('install-btn').addEventListener('click', () => {
    banner.classList.remove('show');
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; }
  });
  window.addEventListener('appinstalled', () => banner.classList.remove('show'));
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  if (isIOS && !isStandalone) { document.getElementById('ios-tip').classList.add('show'); }
}

// ── Arranque ──────────────────────────────────────────────
(function() {
  const img = localStorage.getItem(BIZ_KEY);
  if (img) {
    const loginImg = document.getElementById('login-biz-img');
    const loginIcon = document.getElementById('login-default-icon');
    if (loginImg) { loginImg.src = img; loginImg.style.display = 'block'; }
    if (loginIcon) loginIcon.style.display = 'none';
  }
})();

requireAuth().then(u => { if (u) showApp(); });

// ── Toggle moneda (USD/ARS en formulario stock) ───────────
let monedaMode = 'ars';
let _blockFormClose = false;
function toggleMoneda() {
  const btn = document.getElementById('btn-moneda');
  const input = document.getElementById('fi-precio');
  const helper = document.getElementById('fi-precio-helper');
  if (!btn || !input) return;

  if (monedaMode === 'ars') {
    monedaMode = 'usd';
    btn.textContent = 'USD $';
    btn.classList.add('btn-moneda--usd');
    input.placeholder = '450';
    helper.textContent = dolarBlue
      ? `Cotización: $${dolarBlue.toLocaleString('es-AR')} (blue)`
      : 'Cotización no disponible';
    input.value = '';
  } else {
    monedaMode = 'ars';
    btn.textContent = 'ARS $';
    btn.classList.remove('btn-moneda--usd');
    input.placeholder = '85000';
    helper.textContent = '';
    input.value = '';
  }
}


// WA_TEMPLATES declared at top of file (see top of app.js)

function loadWaTemplates() {
  // Carga desde localStorage primero
  try { WA_TEMPLATES = JSON.parse(localStorage.getItem(WA_TEMPLATES_KEY)) || {}; } catch { WA_TEMPLATES = {}; }
  Object.keys(WA_TPL_DEFAULTS).forEach(k => { if (!WA_TEMPLATES[k]) WA_TEMPLATES[k] = WA_TPL_DEFAULTS[k]; });
  // Luego sincroniza desde Firestore
  db.collection('config').doc('waTemplates').get().then(doc => {
    if (!doc.exists) return;
    const d = doc.data();
    let updated = false;
    Object.keys(WA_TPL_DEFAULTS).forEach(k => {
      if (d[k]) { WA_TEMPLATES[k] = d[k]; updated = true; }
    });
    if (updated) localStorage.setItem(WA_TEMPLATES_KEY, JSON.stringify(WA_TEMPLATES));
  }).catch(() => {});
}

function openWaTplModal() {
  loadWaTemplates();
  document.getElementById('wt-reparando').value = WA_TEMPLATES.repair_reparando;
  document.getElementById('wt-listo').value     = WA_TEMPLATES.repair_listo;
  document.getElementById('wt-default').value   = WA_TEMPLATES.repair_default;
  document.getElementById('wt-stock').value     = WA_TEMPLATES.stock;
  document.getElementById('wa-tpl-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  // close settings modal
  document.getElementById('settings-modal').classList.add('hidden');
}

function closeWaTplModal() {
  document.getElementById('wa-tpl-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function saveWaTemplates() {
  WA_TEMPLATES.repair_reparando = document.getElementById('wt-reparando').value;
  WA_TEMPLATES.repair_listo     = document.getElementById('wt-listo').value;
  WA_TEMPLATES.repair_default   = document.getElementById('wt-default').value;
  WA_TEMPLATES.stock            = document.getElementById('wt-stock').value;
  localStorage.setItem(WA_TEMPLATES_KEY, JSON.stringify(WA_TEMPLATES));
  // Guardar en Firestore
  db.collection('config').doc('waTemplates').set(WA_TEMPLATES, { merge: true }).catch(() => {});
  toast('Templates guardados ✅', 'success');
  closeWaTplModal();
}

function resetWaTemplates() {
  if (!confirm('¿Restablecer todos los mensajes a los valores por defecto?')) return;
  WA_TEMPLATES = { ...WA_TPL_DEFAULTS };
  document.getElementById('wt-reparando').value = WA_TEMPLATES.repair_reparando;
  document.getElementById('wt-listo').value     = WA_TEMPLATES.repair_listo;
  document.getElementById('wt-default').value   = WA_TEMPLATES.repair_default;
  document.getElementById('wt-stock').value     = WA_TEMPLATES.stock;
}

// ── Historial de accesos ──────────────────────────────────
async function logAccess() {
  try {
    let ip = '—';
    try {
      const r = await fetch('https://api.ipify.org?format=json');
      ip = (await r.json()).ip || '—';
    } catch(e) {}
    await db.collection('accessLogs').add({
      fecha: new Date().toISOString(),
      ip,
      ua: navigator.userAgent.slice(0, 200)
    });
  } catch(e) { /* silent */ }
}

async function openAccessLogModal() {
  document.getElementById('access-log-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('settings-modal').classList.add('hidden');
  const body = document.getElementById('access-log-body');
  body.innerHTML = 'Cargando...';
  try {
    const snap = await db.collection('accessLogs')
      .orderBy('fecha', 'desc').limit(30).get();
    if (snap.empty) {
      body.innerHTML = '<p class="access-empty">Sin registros aún</p>';
      return;
    }
    body.innerHTML = snap.docs.map(d => {
      const data = d.data();
      const fecha = data.fecha
        ? new Date(data.fecha).toLocaleString('es-AR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
        : '—';
      const ua = data.ua || '—';
      const isMobile = /Android|iPhone|iPad/i.test(ua);
      return `<div class="access-item">
        <span class="access-fecha">${fecha} ${isMobile ? '📱' : '💻'}</span>
        <span class="access-ip">🌐 ${data.ip || '—'}</span>
        <span class="access-ua">${esc(ua)}</span>
      </div>`;
    }).join('');
  } catch(e) {
    body.innerHTML = '<p class="access-empty">Error al cargar accesos</p>';
  }
}

function closeAccessLogModal() {
  document.getElementById('access-log-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── AGREGAR STOCK DESDE IA CHAT ───────────────────────────
async function addPhoneFromAI(phone) {
  const ref = db.collection('stock').doc();
  phone.id = ref.id;
  await ref.set(phone);
}

// ── IA ────────────────────────────────────────────────────
async function callAI(action, data) {
  showAiPanel();
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, data })
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.text;
  } catch (err) {
    showAiError(err.message);
    throw err;
  }
}

function showAiPanel() {
  document.getElementById('ai-loading').style.display = '';
  document.getElementById('ai-result').style.display  = 'none';
  document.getElementById('ai-panel-actions').innerHTML = '';
  document.getElementById('ai-panel').classList.remove('hidden');
  document.getElementById('ai-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeAiPanel() {
  document.getElementById('ai-panel').classList.add('hidden');
  document.getElementById('ai-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function showAiResult(text, actions) {
  document.getElementById('ai-loading').style.display = 'none';
  const res = document.getElementById('ai-result');
  res.style.display = '';
  res.innerHTML = text
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  const actEl = document.getElementById('ai-panel-actions');
  if (actions && actions.length) {
    actEl.innerHTML = actions.map(a =>
      `<button class="ai-action-btn" onclick="${a.fn}">${a.label}</button>`
    ).join('');
  }
}

function showAiError(msg) {
  document.getElementById('ai-loading').style.display = 'none';
  const res = document.getElementById('ai-result');
  res.style.display = '';
  res.innerHTML = `<span style="color:#ef4444">⚠️ ${msg || 'Error al consultar IA'}</span>`;
}

// ── IA Quick Add ──────────────────────────────────────────
let _aiAddTipo = 'equipo';
let _aiAddData = null;
let _aiAddImage = null; // { base64, mediaType }

function onAIAddImage(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    const comma = dataUrl.indexOf(',');
    _aiAddImage = { base64: dataUrl.slice(comma + 1), mediaType: file.type || 'image/jpeg' };
    document.getElementById('ai-add-img-thumb').src = dataUrl;
    document.getElementById('ai-add-img-preview').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearAIAddImage() {
  _aiAddImage = null;
  document.getElementById('ai-add-img-input').value = '';
  document.getElementById('ai-add-img-thumb').src = '';
  document.getElementById('ai-add-img-preview').classList.add('hidden');
}

function openAIAdd(tipo) {
  _aiAddTipo = tipo || 'equipo';
  _aiAddData = null;
  document.getElementById('ai-add-texto').value = '';
  document.getElementById('ai-add-result').classList.add('hidden');
  document.getElementById('ai-add-actions').classList.add('hidden');
  document.getElementById('ai-add-submit-lbl').textContent = '✨ Analizar con IA';
  document.getElementById('ai-add-submit-btn').disabled = false;
  clearAIAddImage();
  setAIAddTipo(_aiAddTipo);
  document.getElementById('ai-add-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('ai-add-texto').focus(), 300);
}

function closeAIAdd() {
  document.getElementById('ai-add-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function setAIAddTipo(tipo) {
  _aiAddTipo = tipo;
  document.getElementById('ai-add-btn-equipo').classList.toggle('ai-add-tipo-active', tipo === 'equipo');
  document.getElementById('ai-add-btn-repuesto').classList.toggle('ai-add-tipo-active', tipo === 'repuesto');
  const hint = document.getElementById('ai-add-hint');
  const ta   = document.getElementById('ai-add-texto');
  if (tipo === 'equipo') {
    hint.textContent = 'Describí el equipo con todos los datos que tengas';
    ta.placeholder   = 'Ej: iPhone 13 128GB usado buen estado $350000 IMEI 123456789012345';
  } else {
    hint.textContent = 'Describí el repuesto con marca, modelo y tipo';
    ta.placeholder   = 'Ej: pantalla Samsung A54 OLED sin marco 3 unidades $15000 c/u';
  }
  _aiAddData = null;
  document.getElementById('ai-add-result').classList.add('hidden');
  document.getElementById('ai-add-actions').classList.add('hidden');
}

async function processAIAdd() {
  const texto = (document.getElementById('ai-add-texto').value || '').trim();
  if (!texto && !_aiAddImage) { toast('Escribí una descripción o adjuntá una imagen', 'error'); return; }
  const btn = document.getElementById('ai-add-submit-btn');
  const lbl = document.getElementById('ai-add-submit-lbl');
  btn.disabled = true;
  lbl.textContent = '⏳ Analizando…';
  document.getElementById('ai-add-result').classList.add('hidden');
  document.getElementById('ai-add-actions').classList.add('hidden');
  try {
    const action = _aiAddTipo === 'equipo' ? 'extractEquipo' : 'extractRepuesto';
    const payload = { texto };
    if (_aiAddImage) { payload.imageBase64 = _aiAddImage.base64; payload.imageMediaType = _aiAddImage.mediaType; }
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, data: payload })
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    const raw = json.text.trim();
    const start = raw.indexOf('{');
    const end   = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('Respuesta inválida de IA');
    _aiAddData = JSON.parse(raw.slice(start, end + 1));
    _renderAIAddResult(_aiAddData);
  } catch (e) {
    toast('Error al analizar: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    lbl.textContent = '✨ Analizar de nuevo';
  }
}

function _renderAIAddResult(d) {
  const el = document.getElementById('ai-add-result');
  let html = '<div class="ai-add-fields">';
  if (_aiAddTipo === 'equipo') {
    const rows = [
      ['Marca', d.marca], ['Modelo', d.modelo], ['Estado', d.estado],
      ['Precio', d.precio ? '$' + d.precio.toLocaleString('es-AR') : '—'],
      ['Almacenamiento', d.almacenamiento || '—'], ['RAM', d.ram || '—'],
      ['Batería', d.bateria ? d.bateria + '%' : '—'],
      ['IMEI', d.imei || '—'], ['Notas', d.notas || '—']
    ];
    rows.forEach(([k, v]) => { html += `<div class="ai-field-row"><span class="ai-field-k">${k}</span><span class="ai-field-v">${v || '—'}</span></div>`; });
  } else {
    const rows = [
      ['Nombre', d.nombre], ['Marca', d.marca], ['Modelo', d.modelo || '—'],
      ['Tipo', d.tipo], ['Cantidad', d.cantidad ?? '—'],
      ['Stock mín.', d.stockMin ?? '—'],
      ['Precio compra', d.precioCompra ? '$' + d.precioCompra.toLocaleString('es-AR') : '—'],
      ['Proveedor', d.proveedor || '—'], ['Notas', d.notas || '—']
    ];
    rows.forEach(([k, v]) => { html += `<div class="ai-field-row"><span class="ai-field-k">${k}</span><span class="ai-field-v">${v || '—'}</span></div>`; });
  }
  html += '</div>';
  el.innerHTML = html;
  el.classList.remove('hidden');
  document.getElementById('ai-add-actions').classList.remove('hidden');
}

function fillFormFromAI() {
  if (!_aiAddData) return;
  closeAIAdd();
  if (_aiAddTipo === 'equipo') {
    openForm(null);
    const d = _aiAddData;
    document.getElementById('fi-marca').value     = d.marca        || '';
    document.getElementById('fi-modelo').value    = d.modelo       || '';
    document.getElementById('fi-estado').value    = d.estado       || '';
    document.getElementById('fi-precio').value    = d.precio       || '';
    document.getElementById('fi-storage').value   = d.almacenamiento || '';
    document.getElementById('fi-ram').value       = d.ram          || '';
    document.getElementById('fi-imei').value      = d.imei         || '';
    document.getElementById('fi-notas').value     = d.notas        || '';
    if (d.bateria) document.getElementById('fi-bateria').value = d.bateria;
    _updateBateriaVisibility(d.marca || '');
  } else {
    openRepuestoForm(null);
    const d = _aiAddData;
    document.getElementById('rep2-fi-nombre').value    = d.nombre       || '';
    document.getElementById('rep2-fi-marca').value     = d.marca        || '';
    document.getElementById('rep2-fi-modelo').value    = d.modelo       || '';
    document.getElementById('rep2-fi-tipo').value      = d.tipo         || '';
    document.getElementById('rep2-fi-cantidad').value  = d.cantidad     ?? '';
    document.getElementById('rep2-fi-stockmin').value  = d.stockMin     ?? '';
    document.getElementById('rep2-fi-precio').value    = d.precioCompra || '';
    document.getElementById('rep2-fi-proveedor').value = d.proveedor    || '';
    document.getElementById('rep2-fi-notas').value     = d.notas        || '';
  }
}

async function saveFromAI() {
  if (!_aiAddData) return;
  const d = _aiAddData;
  const btn = document.querySelector('#ai-add-actions .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Guardando…'; }
  try {
    if (_aiAddTipo === 'equipo') {
      if (!d.marca || !d.modelo) { toast('La IA no pudo extraer marca/modelo. Usá el formulario.', 'error'); return; }
      if (!d.estado) d.estado = 'Usado';
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const doc = { id, marca: d.marca, modelo: d.modelo, estado: d.estado, precio: d.precio || 0,
        almacenamiento: d.almacenamiento || '', ram: d.ram || '', imei: d.imei || '',
        notas: d.notas || '', ubicacion: '', fecha: new Date().toISOString(), vendido: false };
      if (d.bateria) doc.bateria = d.bateria;
      await db.collection('stock').doc(id).set(doc);
      toast('Equipo agregado al stock ✅', 'success');
    } else {
      if (!d.nombre || !d.marca || !d.tipo) { toast('La IA no pudo extraer todos los campos. Usá el formulario.', 'error'); return; }
      const ref = db.collection('repuestos').doc();
      await ref.set({ id: ref.id, nombre: d.nombre, marca: d.marca, modelo: d.modelo || '',
        tipo: d.tipo, cantidad: d.cantidad || 1, stockMin: d.stockMin || 2,
        precioCompra: d.precioCompra || 0, proveedor: d.proveedor || '', notas: d.notas || '',
        fechaAlta: new Date().toISOString() });
      toast('Repuesto agregado ✅', 'success');
    }
    closeAIAdd();
  } catch (e) {
    toast('Error al guardar', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar directo'; }
  }
}

async function aiStockSpecs() {
  const marca  = (document.getElementById('fi-marca').value  || '').trim();
  const modelo = (document.getElementById('fi-modelo').value || '').trim();
  if (!marca || !modelo) { toast('Completá marca y modelo primero', 'error'); return; }
  try {
    const text = await callAI('stockSpecs', { marca, modelo });
    showAiResult(text, [{
      label: '📋 Copiar a notas',
      fn: `document.getElementById('fi-notas').value=document.getElementById('ai-result').innerText;closeAiPanel()`
    }]);
  } catch {}
}

async function aiStockPrice() {
  const marca  = (document.getElementById('fi-marca').value  || '').trim();
  const modelo = (document.getElementById('fi-modelo').value || '').trim();
  const estado = document.getElementById('fi-estado').value;
  const almEl  = document.getElementById('fi-almacenamiento');
  const almacenamiento = almEl ? almEl.value.trim() : '';
  if (!marca || !modelo) { toast('Completá marca y modelo primero', 'error'); return; }
  try {
    const text = await callAI('stockPrice', { marca, modelo, estado, almacenamiento });
    showAiResult(text, [{
      label: '💰 Usar precio mínimo',
      fn: `(function(){const m=document.getElementById('ai-result').innerText.match(/[\d]+\.?[\d]*/g);if(m){const nums=m.map(n=>parseInt(n.replace(/\./g,'')));const mn=Math.min(...nums.filter(n=>n>1000));if(mn)document.getElementById('fi-precio').value=mn;}closeAiPanel();})()`
    }]);
  } catch {}
}

// ══════════════════════════════════════════════════════════════
// IMPORTAR LISTA DE EQUIPOS CON IA
// ══════════════════════════════════════════════════════════════

let _bulkAIItems = [];

function openBulkAIImport() {
  _bulkAIItems = [];
  document.getElementById('bulk-ai-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('bulk-ai-step1').classList.remove('hidden');
  document.getElementById('bulk-ai-step2').classList.add('hidden');
  document.getElementById('bulk-ai-error').textContent = '';
  document.getElementById('bulk-ai-analyze-lbl').textContent = '✨ Analizar con IA';
  document.getElementById('bulk-ai-analyze-btn').disabled = false;
}

function closeBulkAIImport() {
  document.getElementById('bulk-ai-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function backToBulkAIInput() {
  document.getElementById('bulk-ai-step1').classList.remove('hidden');
  document.getElementById('bulk-ai-step2').classList.add('hidden');
}

async function runBulkAIAnalysis() {
  const texto = (document.getElementById('bulk-ai-texto').value || '').trim();
  if (!texto) { document.getElementById('bulk-ai-error').textContent = 'Pegá una lista primero.'; return; }

  const btn = document.getElementById('bulk-ai-analyze-btn');
  const lbl = document.getElementById('bulk-ai-analyze-lbl');
  btn.disabled = true;
  lbl.textContent = '⏳ Analizando...';
  document.getElementById('bulk-ai-error').textContent = '';

  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'extractBulkEquipos', data: { text: texto } })
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);

    const raw = json.text || '';
    const start = raw.indexOf('[');
    const end   = raw.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('La IA no devolvió un formato válido. Intentá de nuevo.');
    _bulkAIItems = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(_bulkAIItems) || !_bulkAIItems.length) throw new Error('No se detectaron equipos. Revisá el formato.');

    _renderBulkAIPreview();
  } catch(e) {
    document.getElementById('bulk-ai-error').textContent = e.message;
    btn.disabled = false;
    lbl.textContent = '✨ Analizar con IA';
  }
}

function _renderBulkAIPreview() {
  const count = _bulkAIItems.length;
  document.getElementById('bulk-ai-count').textContent = `${count} equipo${count !== 1 ? 's' : ''} detectados`;
  document.getElementById('bulk-ai-save-lbl').textContent = `💾 Guardar ${count} equipo${count !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('bulk-ai-tbody');
  tbody.innerHTML = _bulkAIItems.map((it, i) => `
    <tr id="bai-row-${i}">
      <td><input class="bulk-ai-inp" value="${esc(it.modelo||'')}" data-f="modelo" data-i="${i}" style="min-width:110px"></td>
      <td><input class="bulk-ai-inp" value="${esc(it.almacenamiento||'')}" data-f="almacenamiento" data-i="${i}" style="width:70px"></td>
      <td><input class="bulk-ai-inp" value="${esc(it.bateria!=null?it.bateria:'')}" data-f="bateria" data-i="${i}" style="width:45px" type="number" min="1" max="100"></td>
      <td><input class="bulk-ai-inp" value="${esc(it.notas||it.color||'')}" data-f="notas" data-i="${i}" style="min-width:80px"></td>
      <td><input class="bulk-ai-inp" value="${esc(it.precio||0)}" data-f="precio" data-i="${i}" style="width:80px" type="number" min="0"></td>
      <td><button class="bulk-ai-del" onclick="_removeBulkAIRow(${i})" title="Quitar">✕</button></td>
    </tr>`).join('');

  document.getElementById('bulk-ai-step1').classList.add('hidden');
  document.getElementById('bulk-ai-step2').classList.remove('hidden');
}

function _removeBulkAIRow(i) {
  const row = document.getElementById('bai-row-' + i);
  if (row) row.remove();
  const rem = document.getElementById('bulk-ai-tbody').querySelectorAll('tr').length;
  document.getElementById('bulk-ai-count').textContent = `${rem} equipo${rem !== 1 ? 's' : ''} detectados`;
  document.getElementById('bulk-ai-save-lbl').textContent = `💾 Guardar ${rem} equipo${rem !== 1 ? 's' : ''}`;
}

async function saveBulkAI() {
  const rows = document.getElementById('bulk-ai-tbody').querySelectorAll('tr');
  if (!rows.length) { toast('No hay equipos para guardar', 'error'); return; }

  const btn = document.getElementById('bulk-ai-save-btn');
  btn.disabled = true;
  document.getElementById('bulk-ai-save-lbl').textContent = '⏳ Guardando...';

  let saved = 0, errors = 0;
  for (const row of rows) {
    const get = f => row.querySelector(`[data-f="${f}"]`)?.value?.trim() || '';
    const modelo = get('modelo');
    const precio = parseFloat(get('precio')) || 0;
    if (!modelo || precio <= 0) { errors++; continue; }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const bateria = parseInt(get('bateria')) || null;
    const doc = {
      id, marca: 'iPhone', modelo, estado: 'Usado', precio,
      almacenamiento: get('almacenamiento') || '',
      notas: get('notas') || '',
      vendido: false, fecha: new Date().toISOString()
    };
    if (bateria) doc.bateria = bateria;

    try {
      await db.collection('stock').doc(id).set(doc);
      saved++;
    } catch(e) { errors++; }
    await new Promise(r => setTimeout(r, 80));
  }

  btn.disabled = false;
  document.getElementById('bulk-ai-save-lbl').textContent = '💾 Guardar todos';

  if (saved > 0) { toast(`✅ ${saved} equipo${saved !== 1 ? 's' : ''} agregado${saved !== 1 ? 's' : ''} al stock`); closeBulkAIImport(); }
  if (errors > 0) toast(`⚠ ${errors} equipo${errors !== 1 ? 's' : ''} sin modelo o precio`, 'error');
}
