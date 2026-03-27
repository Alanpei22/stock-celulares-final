// ── Configuración ─────────────────────────────────────────
const PIN = '2210';
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
// ── Firebase ─────────────────────────────────────────────
const FB_CONFIG = {
    apiKey: "AIzaSyAMRkrADBxRF6rST8rNwO5IqdWneXocBsE",
    authDomain: "stockcelustech.firebaseapp.com",
    projectId: "stockcelustech",
    storageBucket: "stockcelustech.firebasestorage.app",
    messagingSenderId: "140592485004",
    appId: "1:140592485004:web:29f6b0aa0f02fdf99ba1a9"
};
let db = null;
function initFirebase() {
    if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
    db = firebase.firestore();
}
let _autoBackupDone = false;
function listenStock() {
    db.collection('stock').onSnapshot(snapshot => {
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
    btn.textContent = isDark ? '☀️' : '🌙';
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

// ── Auth ──────────────────────────────────────────────────
let pinBuffer = '';

function checkAuth() {
  const stored = localStorage.getItem(AUTH_KEY);
  if (stored) {
    const days = (Date.now() - parseInt(stored)) / 86400000;
    if (days < AUTH_DAYS) { showApp(); return; }
  }
  showLogin();
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').classList.add('app-hidden');
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.remove('app-hidden');
  initApp();
}

function initPinPad() {
  document.querySelectorAll('.pin-btn[data-n]').forEach(btn => {
    btn.addEventListener('click', () => addPin(btn.dataset.n));
  });
  document.getElementById('pin-back').addEventListener('click', backPin);
  document.getElementById('pin-clear').addEventListener('click', clearPin);
  document.addEventListener('keydown', e => {
    const ls = document.getElementById('login-screen');
    if (ls.style.display === 'none') return;
    if (e.key >= '0' && e.key <= '9') addPin(e.key);
    else if (e.key === 'Backspace') backPin();
    else if (e.key === 'Escape') clearPin();
  });
}

function addPin(d) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += d;
  updateDots();
  if (pinBuffer.length === 4) setTimeout(checkPin, 180);
}

function backPin() { pinBuffer = pinBuffer.slice(0, -1); updateDots(); }
function clearPin() { pinBuffer = ''; updateDots(); }

function updateDots() {
  document.querySelectorAll('#pin-dots span').forEach((d, i) => {
    d.classList.toggle('filled', i < pinBuffer.length);
  });
}

let justLoggedIn = false;

function checkPin() {
  if (pinBuffer === PIN) {
    justLoggedIn = true;
    localStorage.setItem(AUTH_KEY, Date.now().toString());
    document.getElementById('login-screen').classList.add('success');
    setTimeout(showApp, 650);
  } else {
    document.getElementById('pin-error').textContent = 'PIN incorrecto';
    document.getElementById('login-screen').classList.add('shake');
    setTimeout(() => {
      document.getElementById('login-screen').classList.remove('shake');
      document.getElementById('pin-error').textContent = '';
      clearPin();
    }, 650);
  }
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
  try {
    const r = await fetch('https://dolarapi.com/v1/dolares/blue');
    const d = await r.json();
    dolarBlue = Math.round(d.venta || d.compra || 0) + 10;
  } catch(e) { dolarBlue = null; }
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
  initFirebase();
  loadConfig();
  loadWaTemplates();
  fetchDolarBlue();
  applyBizImage();
  if (justLoggedIn) { justLoggedIn = false; setTimeout(logAccess, 800); }

  document.getElementById('add-btn').addEventListener('click', () => openForm());
  document.getElementById('stats-btn').addEventListener('click', openStats);
  document.getElementById('export-btn').addEventListener('click', openExport);
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('search').addEventListener('input', debounceRender);
  document.getElementById('f-marca').addEventListener('change', debounceRender);
  document.getElementById('f-estado').addEventListener('change', debounceRender);
  document.getElementById('f-vendido').addEventListener('change', debounceRender);
  document.getElementById('f-min').addEventListener('input', debounceRender);
  document.getElementById('f-max').addEventListener('input', debounceRender);

  document.getElementById('form-close').addEventListener('click', closeForm);
  document.getElementById('form-cancel').addEventListener('click', closeForm);
  document.getElementById('form-save').addEventListener('click', savePhone);
  document.getElementById('form-modal').addEventListener('click', e => { if (e.target.id === 'form-modal') closeForm(); });

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

  initPWA();
  listenStock();
  initRepairs();
  initRepuestos();
}

// ── Secciones ─────────────────────────────────────────────
function switchSection(section) {
  ['stock', 'repairs', 'repuestos'].forEach(s => {
    const sec = document.getElementById(s + '-section');
    const btn = document.getElementById('nav-' + s);
    if (sec) sec.classList.toggle('section-hidden', s !== section);
    if (btn) btn.classList.toggle('active', s === section);
  });
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
  const words = q ? q.split(/\s+/).filter(Boolean) : [];

  const marcas = [...new Set(STOCK.map(p => p.marca))].sort();
  const selM = document.getElementById('f-marca');
  const prev = selM.value;
  while (selM.options.length > 1) selM.remove(1);
  marcas.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; selM.appendChild(o); });
  selM.value = prev;

  const filtered = STOCK.filter(p => {
    if (fMarca && p.marca !== fMarca) return false;
    if (fEstado && p.estado !== fEstado) return false;
    if (fVend === '0' && p.vendido) return false;
    if (fVend === '1' && !p.vendido) return false;
    if (fMin > 0 && (p.precio || 0) < fMin) return false;
    if (fMax > 0 && (p.precio || 0) > fMax) return false;
    if (words.length) {
      const hay = (p.marca + ' ' + p.modelo + ' ' + (p.imei || '') + ' ' + (p.notas || '')).toLowerCase();
      return words.every(w => hay.includes(w));
    }
    return true;
  });

  const inStock = STOCK.filter(p => !p.vendido);
  const sold = STOCK.filter(p => p.vendido);
  document.getElementById('s-stock').textContent     = inStock.length;
  document.getElementById('s-sold').textContent      = sold.length;
  document.getElementById('s-exhibicion').textContent = inStock.filter(p => p.ubicacion === 'Exhibición').length;
  document.getElementById('s-deposito').textContent   = inStock.filter(p => p.ubicacion === 'Depósito').length;

  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  if (filtered.length === 0) { listEl.innerHTML = ''; emptyEl.style.display = ''; return; }
  emptyEl.style.display = 'none';

  const badgeCls = { Nuevo: 'bg-new', Usado: 'bg-used', Reacondicionado: 'bg-refurb' };
  listEl.innerHTML = filtered.map(p => {
    const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' · ');
    const fecha = p.fecha ? new Date(p.fecha).toLocaleDateString('es-AR', { day:'2-digit', month:'short' }) : '';
    const usd = (!p.vendido && p.precio && dolarBlue) ? Math.round(p.precio / dolarBlue) : null;
    const ubiBadge = p.ubicacion === 'Exhibición'
      ? '<span class="badge-ubicacion">📺 Exhibición</span>'
      : p.ubicacion === 'Depósito'
        ? '<span class="badge-ubicacion badge-ubicacion--deposito">📦 Depósito</span>'
        : '';
    const stCls = p.vendido ? 'stock-vendido'
      : p.estado === 'Nuevo' ? 'stock-nuevo'
      : p.estado === 'Reacondicionado' ? 'stock-refurb'
      : 'stock-usado';
    return `
      <div class="card ${stCls}${p.vendido ? ' card-sold' : ''}" onclick="openDetail('${p.id}')">
        <div class="card-top">
          <div class="card-info">
            <span class="card-marca">📱 ${esc(p.marca)}</span>
            <span class="card-modelo">${esc(p.modelo)}</span>
            ${specs ? `<span class="card-specs">${esc(specs)}</span>` : ''}
          </div>
          <div class="card-right">
            ${ubiBadge}
            <span class="badge ${badgeCls[p.estado] || ''}">${esc(p.estado)}</span>
            ${p.vendido ? '<span class="badge bg-sold">VENDIDO</span>' : ''}
          </div>
        </div>
        <div class="card-bottom">
          <span class="card-price">${p.precio ? '$ ' + p.precio.toLocaleString('es-AR') : '—'}${usd ? `<span class="card-usd">U$S ${usd.toLocaleString('es-AR')}</span>` : ''}</span>
          <div class="card-meta">
            ${p.imei ? `<span class="card-imei">🔑 ${esc(p.imei)}</span>` : ''}
            ${fecha ? `<span class="card-date">📅 ${fecha}</span>` : ''}
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
  if (id) {
    const p = STOCK.find(x => x.id === id);
    if (!p) return;
    t.textContent = '✏️ Editar Equipo';
    document.getElementById('fi-marca').value     = p.marca         || '';
    document.getElementById('fi-modelo').value    = p.modelo        || '';
    document.getElementById('fi-estado').value    = p.estado        || '';
    document.getElementById('fi-precio').value    = p.precio        || '';
    document.getElementById('fi-storage').value   = p.almacenamiento|| '';
    document.getElementById('fi-ram').value       = p.ram           || '';
    document.getElementById('fi-imei').value      = p.imei          || '';
    document.getElementById('fi-notas').value     = p.notas         || '';
    document.getElementById('fi-ubicacion').value = p.ubicacion     || '';
  } else {
    t.textContent = '📱 Agregar Equipo';
    ['fi-marca','fi-modelo','fi-precio','fi-imei','fi-notas'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('fi-estado').value    = '';
    document.getElementById('fi-storage').value   = '';
    document.getElementById('fi-ram').value       = '';
    document.getElementById('fi-ubicacion').value = '';
  }
  // Reset moneda toggle to ARS
  const btnM = document.getElementById('btn-moneda');
  if (btnM) { btnM.textContent = 'ARS $'; btnM.classList.remove('btn-moneda--usd'); btnM.dataset.mode = 'ars'; }
  const helper = document.getElementById('fi-precio-helper');
  if (helper) helper.textContent = '';
  document.getElementById('form-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('fi-marca').focus(), 300);
}

function closeForm() {
  document.getElementById('form-modal').classList.add('hidden');
  document.body.style.overflow = '';
  editingId = null;
}

function savePhone() {
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

  if (editingId) {
        const existing = STOCK.find(x => x.id === editingId);
        if (!existing) { closeForm(); return; }
        db.collection('stock').doc(editingId).set({
                ...existing, marca, modelo, estado, precio, almacenamiento: storage, ram, imei, notas, ubicacion
        });
        toast('Equipo actualizado', 'success');
  } else {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        db.collection('stock').doc(id).set({
                id, marca, modelo, estado, precio, almacenamiento: storage, ram, imei, notas, ubicacion,
                fecha: new Date().toISOString(), vendido: false
        });
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
      <span class="det-val det-price">$ ${p.precio ? p.precio.toLocaleString('es-AR') : '—'}</span>
    </div>
    ${specs ? `<div class="det-row"><span class="det-label">Specs</span><span class="det-val">${esc(specs)}</span></div>` : ''}
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

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
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
  const p = STOCK.find(x => x.id === id);
  const vendedor = document.getElementById('sell-vendedor').value;
  const formaPago = document.getElementById('sell-pago').value;
  db.collection('stock').doc(id).update({
    vendido: true,
    fecha_venta: new Date().toISOString(),
    vendedor,
    forma_pago: formaPago
  });
  // Log de venta
  if (p) {
    db.collection('actividad').add({
      tipo: 'venta',
      desc: `Venta: ${p.marca} ${p.modelo}${p.almacenamiento ? ' '+p.almacenamiento : ''} — $${(p.precio||0).toLocaleString('es-AR')}`,
      tecnico: vendedor || null,
      repairId: null,
      extra: { stockId: id, precio: p.precio, formaPago, marca: p.marca, modelo: p.modelo },
      fecha: new Date().toISOString()
    }).catch(() => {});
  }
  closeSellModal();
  closeDetail();
  toast('Venta registrada ✅', 'success');
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
  const dolarEl = document.getElementById('dolar-blue-display');
  if (dolarEl) dolarEl.textContent = dolarBlue !== null ? '$ ' + dolarBlue.toLocaleString('es-AR') + ' (blue + $10)' : 'No disponible';
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

initPinPad();
checkAuth();

// ── Toggle moneda (USD/ARS en formulario stock) ───────────
let monedaMode = 'ars';
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

// Al guardar, convertir USD→ARS si corresponde (se llama desde savePhone)
// La conversión se hace leyendo monedaMode en savePhone():
// En app.js savePhone, el precio ya usa fi-precio pero hay que convertir
// Inyectar el override aquí para no romper savePhone:
const _origSavePhone = window.savePhone;

// Wrap savePhone to handle USD conversion
(function () {
  const orig = savePhone;
  window.savePhone = function () {
    if (monedaMode === 'usd' && dolarBlue) {
      const usdVal = parseFloat(document.getElementById('fi-precio').value) || 0;
      const arsVal = Math.round(usdVal * dolarBlue);
      document.getElementById('fi-precio').value = arsVal;
      monedaMode = 'ars'; // reset after conversion
      const btn = document.getElementById('btn-moneda');
      if (btn) { btn.textContent = 'ARS $'; btn.classList.remove('btn-moneda--usd'); }
      const h = document.getElementById('fi-precio-helper');
      if (h) h.textContent = '';
    }
    orig.apply(this, arguments);
  };
})();

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
