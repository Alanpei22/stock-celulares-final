// ══════════════════════════════════════════
//  CAJA DIARIA — TechPoint
// ══════════════════════════════════════════

const PIN_CAJA   = '2210';
const CAJA_AUTH  = 'caja_auth';
const AUTH_DAYS  = 30;

const FB_CONFIG = {
  apiKey: "AIzaSyAMRkrADBxRF6rST8rNwO5IqdWneXocBsE",
  authDomain: "stockcelustech.firebaseapp.com",
  projectId: "stockcelustech",
  storageBucket: "stockcelustech.firebasestorage.app",
  messagingSenderId: "140592485004",
  appId: "1:140592485004:web:29f6b0aa0f02fdf99ba1a9"
};

const DENOMINACIONES = [20000, 10000, 2000, 1000, 500, 200, 100];

const CATEGORIAS = {
  ingreso: ['Venta equipo', 'Reparación', 'Hidrogel / Accesorio', 'Seña', 'Otro ingreso'],
  egreso:  ['Compra repuesto', 'Gasto fijo', 'Retiro dueño', 'Otro gasto']
};
const RETIRO_CAT = 'Retiro dueño';

const METODOS_PAGO = ['Efectivo', 'Transferencia', 'MercadoPago', 'Tarjeta débito', 'Tarjeta crédito'];

const CAT_ICONS = {
  'Venta equipo': '📱', 'Reparación': '🔧', 'Hidrogel / Accesorio': '🛡️',
  'Seña': '📝', 'Otro ingreso': '💰',
  'Compra repuesto': '🛒', 'Gasto fijo': '📋', 'Retiro dueño': '🏧', 'Otro gasto': '💸'
};

let db = null;
let _fabOpen = false;
let MOVIMIENTOS = [];
let ARQUEO = null;
// Fecha en horario Argentina (UTC-3)
const _todayAR = () => new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
let currentDate = _todayAR();
let movListener = null;
let editingMovId = null;
let CIERRE = null;
let _pinBuf = '';

// ══════════════════════════════════════════
//  FIREBASE
// ══════════════════════════════════════════

function initFirebase() {
  if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
  db = firebase.firestore();
}

// ══════════════════════════════════════════
//  DARK MODE
// ══════════════════════════════════════════

function initDarkMode() {
  const dm = localStorage.getItem('darkMode');
  if (dm === '1') document.body.classList.add('dark');
  else document.body.classList.remove('dark');
  _updateDarkIcon();
}

function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('darkMode', isDark ? '1' : '0');
  _updateDarkIcon();
}

function _updateDarkIcon() {
  const btn = document.querySelector('.dark-toggle-btn');
  if (!btn) return;
  const isDark = document.body.classList.contains('dark');
  btn.textContent = isDark ? '☀️' : '🌙';
}

// ══════════════════════════════════════════
//  AUTH / PIN
// ══════════════════════════════════════════

function checkAuth() {
  const stored = localStorage.getItem(CAJA_AUTH);
  if (stored) {
    const ts = parseInt(stored, 10);
    const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    if (days < AUTH_DAYS) {
      showApp();
      return;
    }
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

function initApp() {
  initDarkMode();
  initFirebase();
  updateDateLabel();
  listenMovimientos();
  loadArqueo();
  loadCierre();
}

// PIN pad

function addPin(d) {
  if (_pinBuf.length >= 4) return;
  _pinBuf += d;
  _updateCajaDots();
  if (_pinBuf.length === 4) checkCajaPin();
}

function backPin() {
  _pinBuf = _pinBuf.slice(0, -1);
  _updateCajaDots();
}

function clearCajaPin() {
  _pinBuf = '';
  _updateCajaDots();
  const errEl = document.getElementById('pin-error');
  if (errEl) errEl.textContent = '';
}

function _updateCajaDots() {
  const dots = document.querySelectorAll('#pin-dots span');
  dots.forEach((dot, i) => {
    dot.classList.toggle('filled', i < _pinBuf.length);
  });
}

function checkCajaPin() {
  if (_pinBuf === PIN_CAJA) {
    localStorage.setItem(CAJA_AUTH, Date.now().toString());
    const screen = document.getElementById('login-screen');
    screen.classList.add('success');
    setTimeout(() => showApp(), 400);
  } else {
    const screen = document.getElementById('login-screen');
    screen.classList.add('shake');
    setTimeout(() => screen.classList.remove('shake'), 500);
    const errEl = document.getElementById('pin-error');
    if (errEl) errEl.textContent = 'PIN incorrecto';
    _pinBuf = '';
    _updateCajaDots();
  }
}

function initPinPad() {
  document.querySelectorAll('.pin-btn[data-n]').forEach(btn => {
    btn.addEventListener('click', () => addPin(btn.dataset.n));
  });
  const backBtn = document.getElementById('pin-back');
  if (backBtn) backBtn.addEventListener('click', backPin);
  const clearBtn = document.getElementById('pin-clear');
  if (clearBtn) clearBtn.addEventListener('click', clearCajaPin);
}

// ══════════════════════════════════════════
//  DATE NAVIGATION
// ══════════════════════════════════════════

function prevDay() {
  const d = new Date(currentDate + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  setDate(d.toISOString().slice(0, 10));
}

function nextDay() {
  const today = _todayAR();
  if (currentDate >= today) return;
  const d = new Date(currentDate + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  setDate(d.toISOString().slice(0, 10));
}

function setDate(date) {
  currentDate = date;
  updateDateLabel();
  if (movListener) {
    movListener();
    movListener = null;
  }
  MOVIMIENTOS = [];
  ARQUEO = null;
  CIERRE = null;
  listenMovimientos();
  loadArqueo();
  loadCierre();
}

function updateDateLabel() {
  const today = _todayAR();
  const yDate = new Date(today + 'T12:00:00');
  yDate.setDate(yDate.getDate() - 1);
  const yesterday = yDate.toISOString().slice(0, 10);
  const label = document.getElementById('caja-date-label');
  const nextBtn = document.getElementById('next-day-btn');

  let text;
  if (currentDate === today) {
    text = 'Hoy';
  } else if (currentDate === yesterday) {
    text = 'Ayer';
  } else {
    const [y, m, d] = currentDate.split('-');
    text = `${d}/${m}/${y}`;
  }

  if (label) label.textContent = text;
  if (nextBtn) {
    nextBtn.style.opacity = currentDate >= today ? '0.3' : '1';
    nextBtn.style.pointerEvents = currentDate >= today ? 'none' : 'auto';
  }
}

// ══════════════════════════════════════════
//  ARQUEO
// ══════════════════════════════════════════

async function loadArqueo() {
  try {
    const doc = await db.collection('caja_arqueos').doc(currentDate).get();
    if (doc.exists) {
      ARQUEO = doc.data();
    } else {
      ARQUEO = null;
      const today = new Date().toISOString().slice(0, 10);
      if (currentDate === today) {
        openArqueoModal();
        return;
      }
    }
  } catch (e) {
    console.error('loadArqueo:', e);
    ARQUEO = null;
  }
  renderStats();
}

function openArqueoModal() {
  document.getElementById('arqueo-billetes').innerHTML = renderArqueoRows();
  updateArqueoTotal();
  document.getElementById('arqueo-overlay').classList.remove('hidden');
  document.getElementById('arqueo-modal').classList.remove('hidden');
}

function renderArqueoRows() {
  return DENOMINACIONES.map(denom => {
    const label = '$' + denom.toLocaleString('es-AR');
    return `
      <div class="arqueo-row">
        <span class="arqueo-denom">${label}</span>
        <div class="arqueo-counter">
          <button class="arqueo-btn" onclick="changeArqueoBillete(${denom}, -1)">−</button>
          <input class="arqueo-input" id="billete-${denom}" type="number" value="0" min="0" inputmode="numeric">
          <button class="arqueo-btn" onclick="changeArqueoBillete(${denom}, 1)">+</button>
        </div>
        <span class="arqueo-subtotal" id="sub-${denom}">$0</span>
      </div>`;
  }).join('');
}

function changeArqueoBillete(denom, delta) {
  const input = document.getElementById('billete-' + denom);
  if (!input) return;
  const current = parseInt(input.value, 10) || 0;
  input.value = Math.max(0, current + delta);
  updateArqueoTotal();
}

function updateArqueoTotal() {
  let total = 0;
  DENOMINACIONES.forEach(denom => {
    const input = document.getElementById('billete-' + denom);
    const cantidad = input ? (parseInt(input.value, 10) || 0) : 0;
    const subtotal = cantidad * denom;
    total += subtotal;
    const subEl = document.getElementById('sub-' + denom);
    if (subEl) subEl.textContent = '$' + subtotal.toLocaleString('es-AR');
  });
  const totalEl = document.getElementById('arqueo-total');
  if (totalEl) totalEl.textContent = '$' + total.toLocaleString('es-AR');
}

async function saveArqueo() {
  const billetes = {};
  let total = 0;
  DENOMINACIONES.forEach(denom => {
    const input = document.getElementById('billete-' + denom);
    const cantidad = input ? (parseInt(input.value, 10) || 0) : 0;
    billetes[denom] = cantidad;
    total += cantidad * denom;
  });

  const ahora = new Date();
  const horaAR = ahora.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });
  const inputVend = document.getElementById('arqueo-vendedor-input');
  const vendedor = (inputVend && inputVend.value.trim()) || localStorage.getItem('cajaVendedor') || '';
  if (inputVend && inputVend.value.trim()) localStorage.setItem('cajaVendedor', inputVend.value.trim());

  try {
    await db.collection('caja_arqueos').doc(currentDate).set({
      billetes,
      total,
      fecha: currentDate,
      savedAt: ahora.toISOString(),
      horaAR,
      vendedor
    });
    ARQUEO = { billetes, total, fecha: currentDate, savedAt: ahora.toISOString(), horaAR, vendedor };
    closeArqueoModal();
    renderStats();
    toast('✅ Arqueo guardado: $' + total.toLocaleString('es-AR'), 'success');
  } catch (e) {
    console.error('saveArqueo:', e);
    toast('Error al guardar arqueo', 'error');
  }
}

function closeArqueoModal() {
  document.getElementById('arqueo-overlay').classList.add('hidden');
  document.getElementById('arqueo-modal').classList.add('hidden');
}

function reopenArqueo() {
  if (!document.getElementById('arqueo-billetes')) return;
  // Pre-llenar nombre guardado
  const inputVend = document.getElementById('arqueo-vendedor-input');
  if (inputVend) {
    const saved = ARQUEO?.vendedor || localStorage.getItem('cajaVendedor') || '';
    inputVend.value = saved;
  }
  document.getElementById('arqueo-billetes').innerHTML = renderArqueoRows();
  if (ARQUEO && ARQUEO.billetes) {
    DENOMINACIONES.forEach(denom => {
      const input = document.getElementById('billete-' + denom);
      if (input && ARQUEO.billetes[denom] !== undefined) input.value = ARQUEO.billetes[denom];
    });
  }
  updateArqueoTotal();

  // Mostrar aviso si ya fue hecho hoy
  const yaHechoEl = document.getElementById('arqueo-ya-hecho');
  if (yaHechoEl) {
    if (ARQUEO && ARQUEO.savedAt && currentDate === _todayAR()) {
      const hora = ARQUEO.horaAR || new Date(ARQUEO.savedAt).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });
      const quien = ARQUEO.vendedor || '';
      yaHechoEl.innerHTML = `✅ Arqueo realizado a las <b>${hora}</b>${quien ? ` por <b>${quien}</b>` : ''}`;
      yaHechoEl.classList.remove('hidden');
      document.getElementById('arqueo-save-btn').textContent = '✏️ Actualizar arqueo';
    } else {
      yaHechoEl.classList.add('hidden');
      document.getElementById('arqueo-save-btn').textContent = '✅ Confirmar apertura';
    }
  }

  document.getElementById('arqueo-overlay').classList.remove('hidden');
  document.getElementById('arqueo-modal').classList.remove('hidden');
}

// ══════════════════════════════════════════
//  MOVIMIENTOS
// ══════════════════════════════════════════

function listenMovimientos() {
  const query = db.collection('caja_movimientos').where('fecha', '==', currentDate);

  try {
    movListener = query.onSnapshot(snap => {
      MOVIMIENTOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      MOVIMIENTOS.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      renderMovimientos();
      renderStats();
    }, err => {
      console.error('listenMovimientos onSnapshot error:', err);
      // fallback to get()
      query.get().then(snap => {
        MOVIMIENTOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        MOVIMIENTOS.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        renderMovimientos();
        renderStats();
      }).catch(e => console.error('listenMovimientos get fallback error:', e));
    });
  } catch (err) {
    console.error('listenMovimientos setup error:', err);
    query.get().then(snap => {
      MOVIMIENTOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      MOVIMIENTOS.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      renderMovimientos();
      renderStats();
    }).catch(e => console.error('listenMovimientos get error:', e));
  }
}

function renderStats() {
  const apertura  = ARQUEO?.total || 0;
  const ingMovs   = MOVIMIENTOS.filter(m => m.tipo === 'ingreso');
  const egMovs    = MOVIMIENTOS.filter(m => m.tipo === 'egreso');
  const retiros   = egMovs.filter(m => m.categoria === RETIRO_CAT);
  const gastos    = egMovs.filter(m => m.categoria !== RETIRO_CAT);

  const totalIng    = ingMovs.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const totalEg     = egMovs.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const totalGastos = gastos.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const _efecPortion = m => {
    const total = Number(m.monto) || 0;
    const m2amt = Number(m.monto2) || 0;
    if (m.metodoPago === 'Efectivo' && m.metodoPago2) return total - m2amt;
    if (m.metodoPago === 'Efectivo') return total;
    if (m.metodoPago2 === 'Efectivo') return m2amt;
    return 0;
  };
  const ingEfec = ingMovs.reduce((s, m) => s + _efecPortion(m), 0);
  const egEfec  = egMovs.reduce((s, m) => s + _efecPortion(m), 0);
  const efectivoEnCaja = apertura + ingEfec - egEfec;
  const neto = totalIng - totalGastos; // retiros no afectan neto

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = fmt(val); };
  set('stat-apertura', apertura);
  set('stat-ingresos', totalIng);
  set('stat-egresos',  totalEg);
  set('stat-efectivo', efectivoEnCaja);

  const netoEl = document.getElementById('stat-neto');
  if (netoEl) { netoEl.textContent = fmt(neto); netoEl.style.color = neto >= 0 ? '#10b981' : '#ef4444'; }

  // Desglose del día
  const reparac   = ingMovs.filter(m => m.categoria === 'Reparación').reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const ventaEfec = ingMovs.filter(m => m.metodoPago === 'Efectivo' && m.categoria !== 'Reparación').reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const digital   = ingMovs.filter(m => m.metodoPago !== 'Efectivo').reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const totalRetiros = retiros.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  set('desglose-efectivo', ventaEfec);
  set('desglose-digital', digital);
  set('desglose-reparac', reparac);
  set('desglose-gastos', totalGastos);
  const retWrap = document.getElementById('desglose-retiros-wrap');
  if (retWrap) {
    retWrap.style.display = totalRetiros > 0 ? '' : 'none';
    const retEl = document.getElementById('desglose-retiros');
    if (retEl) retEl.textContent = fmt(totalRetiros);
  }
}

function renderMovimientos() {
  const list  = document.getElementById('caja-list');
  const empty = document.getElementById('caja-empty');
  if (!list) return;

  if (!MOVIMIENTOS.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  list.innerHTML = MOVIMIENTOS.map(m => {
    const hora = m.createdAt ? m.createdAt.slice(11, 16) : '';
    const metodoStr = m.metodoPago2
      ? `${m.metodoPago} $${(m.monto - (m.monto2||0)).toLocaleString('es-AR')} + ${m.metodoPago2} $${(m.monto2||0).toLocaleString('es-AR')}`
      : m.metodoPago;
    const meta = [metodoStr, hora].filter(Boolean).join(' · ');
    const signo = m.tipo === 'ingreso' ? '+' : '−';
    return `
      <div class="mov-card mov-${esc(m.tipo)}" onclick="openMovForm('${esc(m.id)}')">
        <div class="caja-card-left">
          <span class="caja-cat">${esc(m.categoria || '')}</span>
          <span class="caja-desc">${esc(m.descripcion || '—')}</span>
          <span class="caja-meta">${esc(meta)}</span>
        </div>
        <div class="caja-card-right">
          <span class="caja-monto mov-${esc(m.tipo)}">${signo}${fmt(m.monto)}</span>
        </div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════
//  FORMULARIO MOVIMIENTO
// ══════════════════════════════════════════

// ══════════════════════════════════════════
//  FAB SPEED DIAL
// ══════════════════════════════════════════

// ── Menú dropdown header ──
function toggleCajaMenu() {
  const dd = document.getElementById('caja-menu-dropdown');
  if (!dd) return;
  dd.classList.toggle('hidden');
}
function closeCajaMenu() {
  const dd = document.getElementById('caja-menu-dropdown');
  if (dd) dd.classList.add('hidden');
}
document.addEventListener('click', e => {
  const btn = document.getElementById('caja-menu-btn');
  const dd  = document.getElementById('caja-menu-dropdown');
  if (dd && btn && !btn.contains(e.target) && !dd.contains(e.target)) dd.classList.add('hidden');
});

function toggleFabMenu() { _fabOpen ? closeFabMenu() : openFabMenu(); }

function openFabMenu() {
  _fabOpen = true;
  document.getElementById('fab-actions').classList.remove('hidden');
  document.getElementById('fab-backdrop').classList.remove('hidden');
  document.getElementById('fab-main').classList.add('fab-open');
}

function closeFabMenu() {
  _fabOpen = false;
  const actions  = document.getElementById('fab-actions');
  const backdrop = document.getElementById('fab-backdrop');
  const fab      = document.getElementById('fab-main');
  if (actions)  actions.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
  if (fab)      fab.classList.remove('fab-open');
}

function openMovFormType(tipo) {
  closeFabMenu();
  openMovForm(null);
  setMovTipo(tipo);
}

function addQuickAmt(amt) {
  const input = document.getElementById('mov-fi-monto');
  if (!input) return;
  input.value = (parseFloat(input.value) || 0) + amt;
}

function openMovForm(id) {
  closeFabMenu();
  editingMovId = id || null;
  const overlay = document.getElementById('mov-overlay');
  const modal   = document.getElementById('mov-modal');
  const deleteWrap = document.getElementById('mov-delete-wrap');

  if (id) {
    const m = MOVIMIENTOS.find(x => x.id === id);
    if (!m) return;
    deleteWrap.style.display = '';
    setMovTipo(m.tipo || 'ingreso');
    document.getElementById('mov-fi-monto').value = m.monto || '';
    document.getElementById('mov-fi-desc').value  = m.descripcion || '';
    // select category
    renderCatBtns(m.tipo || 'ingreso');
    selectCat(m.categoria || '');
    // select method
    selectMetodo(m.metodoPago || 'Efectivo');
    if (m.metodoPago2 && m.monto2) {
      _splitActive = true;
      const section = document.getElementById('split-section');
      const btn = document.getElementById('btn-split-toggle');
      if (section) section.classList.remove('hidden');
      if (btn) { btn.textContent = '✕ Quitar'; btn.classList.add('split-active'); }
      selectMetodo2(m.metodoPago2);
      const splitInput = document.getElementById('mov-split-amt');
      if (splitInput) splitInput.value = m.monto2;
      updateSplitRemainder();
    }
  } else {
    deleteWrap.style.display = 'none';
    setMovTipo('ingreso');
    document.getElementById('mov-fi-monto').value = '';
    document.getElementById('mov-fi-desc').value  = '';
    selectMetodo('Efectivo');
  }

  // Clear any previous error highlights and split state
  document.querySelectorAll('#mov-modal .field-error').forEach(el => el.classList.remove('field-error'));
  resetSplit();
  // Reset vuelto
  const vueltoSec = document.getElementById('vuelto-section');
  if (vueltoSec) vueltoSec.classList.add('hidden');
  const recibidoEl = document.getElementById('mov-recibido');
  if (recibidoEl) recibidoEl.value = '';
  const vueltoVal = document.getElementById('vuelto-val');
  if (vueltoVal) { vueltoVal.textContent = '$0'; vueltoVal.className = 'vuelto-val'; }

  // Auto-clear error on input
  document.getElementById('mov-fi-monto').oninput = () =>
    document.querySelector('.mov-monto-area')?.classList.remove('field-error');
  document.getElementById('mov-fi-desc').oninput = () =>
    document.getElementById('mov-fi-desc')?.closest('.fg')?.classList.remove('field-error');

  overlay.classList.remove('hidden');
  modal.classList.remove('hidden');
}

function closeMovForm() {
  document.getElementById('mov-overlay').classList.add('hidden');
  document.getElementById('mov-modal').classList.add('hidden');
  editingMovId = null;
}

function setMovTipo(tipo) {
  const btnIng = document.getElementById('mov-btn-ingreso');
  const btnEg  = document.getElementById('mov-btn-egreso');
  if (btnIng) btnIng.classList.toggle('tipo-active', tipo === 'ingreso');
  if (btnEg)  btnEg.classList.toggle('tipo-active',  tipo === 'egreso');
  renderCatBtns(tipo);
  const cats = CATEGORIAS[tipo] || [];
  selectCat(cats[0] || '');
}

function renderCatBtns(tipo) {
  const container = document.getElementById('mov-categorias');
  if (!container) return;
  const cats = CATEGORIAS[tipo] || [];
  container.innerHTML = cats.map(c => {
    const icon = CAT_ICONS[c] ? CAT_ICONS[c] + ' ' : '';
    return `<button class="cat-btn" data-cat="${esc(c)}" onclick="selectCat('${esc(c)}')">${icon}${esc(c)}</button>`;
  }).join('');
}

function selectCat(cat) {
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.classList.toggle('cat-active', btn.dataset.cat === cat);
  });
  const hidden = document.getElementById('mov-hidden-cat');
  if (hidden) hidden.value = cat;
}

function selectMetodo(metodo) {
  document.querySelectorAll('.metodo-btn').forEach(btn => {
    btn.classList.toggle('metodo-active', btn.dataset.m === metodo);
  });
  const hidden = document.getElementById('mov-hidden-metodo');
  if (hidden) hidden.value = metodo;
  updateSplitRemainder();
  // Mostrar calculadora de vuelto solo si es efectivo y no hay split
  const vueltoSec = document.getElementById('vuelto-section');
  if (vueltoSec) {
    const splitActivo = document.getElementById('split-section') && !document.getElementById('split-section').classList.contains('hidden');
    vueltoSec.classList.toggle('hidden', metodo !== 'Efectivo' || splitActivo);
    if (metodo !== 'Efectivo') { document.getElementById('mov-recibido').value = ''; document.getElementById('vuelto-val').textContent = '$0'; }
  }
}

function calcVuelto() {
  const monto = parseFloat(document.getElementById('mov-fi-monto').value) || 0;
  const recibido = parseFloat(document.getElementById('mov-recibido').value) || 0;
  const vuelto = recibido >= monto ? recibido - monto : 0;
  const el = document.getElementById('vuelto-val');
  if (el) {
    el.textContent = '$' + vuelto.toLocaleString('es-AR');
    el.classList.toggle('vuelto-ok', recibido >= monto && monto > 0);
    el.classList.toggle('vuelto-falta', recibido > 0 && recibido < monto);
  }
}

function selectMetodo2(metodo) {
  document.querySelectorAll('.metodo-btn2').forEach(btn => {
    btn.classList.toggle('metodo2-active', btn.dataset.m2 === metodo);
  });
  const hidden = document.getElementById('mov-hidden-metodo2');
  if (hidden) hidden.value = metodo;
}

let _splitActive = false;

function toggleSplit() {
  _splitActive = !_splitActive;
  const section  = document.getElementById('split-section');
  const btn      = document.getElementById('btn-split-toggle');
  if (_splitActive) {
    section.classList.remove('hidden');
    btn.textContent = '✕ Quitar';
    btn.classList.add('split-active');
    // Default second method to Transferencia if first is Efectivo
    const m1 = document.getElementById('mov-hidden-metodo')?.value || '';
    selectMetodo2(m1 === 'Efectivo' ? 'Transferencia' : 'Efectivo');
    updateSplitRemainder();
  } else {
    section.classList.add('hidden');
    btn.textContent = '＋ Dividir';
    btn.classList.remove('split-active');
    document.getElementById('mov-split-amt').value = '';
    document.getElementById('mov-hidden-metodo2').value = '';
  }
}

function updateSplitRemainder() {
  if (!_splitActive) return;
  const total  = parseFloat(document.getElementById('mov-fi-monto')?.value) || 0;
  const split2 = parseFloat(document.getElementById('mov-split-amt')?.value) || 0;
  const resto  = Math.max(0, total - split2);
  const el = document.getElementById('split-remainder-val');
  if (el) el.textContent = '$' + resto.toLocaleString('es-AR');
}

function resetSplit() {
  _splitActive = false;
  const section = document.getElementById('split-section');
  const btn     = document.getElementById('btn-split-toggle');
  if (section) section.classList.add('hidden');
  if (btn)   { btn.textContent = '＋ Dividir'; btn.classList.remove('split-active'); }
  const splitAmt = document.getElementById('mov-split-amt');
  if (splitAmt) splitAmt.value = '';
  const hidden2 = document.getElementById('mov-hidden-metodo2');
  if (hidden2) hidden2.value = '';
}

function _markError(el, on) {
  if (!el) return;
  if (on) {
    el.classList.add('field-error');
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = 'shake .35s ease';
    setTimeout(() => { el.style.animation = ''; }, 400);
  } else {
    el.classList.remove('field-error');
  }
}

async function saveMov() {
  const montoInput = document.getElementById('mov-fi-monto');
  const descInput  = document.getElementById('mov-fi-desc');
  const catWrap    = document.querySelector('#mov-categorias')?.closest('.fg');
  const metWrap    = document.querySelector('.metodos-group')?.closest('.fg');

  const monto      = parseFloat(montoInput?.value);
  const descripcion = descInput?.value.trim() || '';
  const categoria  = document.getElementById('mov-hidden-cat')?.value || '';
  const metodoPago = document.getElementById('mov-hidden-metodo')?.value || '';

  const metodo2  = document.getElementById('mov-hidden-metodo2')?.value || '';
  const splitAmt = _splitActive ? (parseFloat(document.getElementById('mov-split-amt')?.value) || 0) : 0;

  const montoOk = monto > 0;
  const descOk  = descripcion.length > 0;
  const catOk   = categoria.length > 0;
  const metOk   = metodoPago.length > 0;
  const splitOk = !_splitActive || (metodo2.length > 0 && splitAmt > 0 && splitAmt < monto);

  _markError(montoInput?.closest('.mov-monto-area'), !montoOk);
  _markError(descInput?.closest('.fg'), !descOk);
  _markError(catWrap, !catOk);
  _markError(metWrap, !metOk);

  if (!montoOk || !descOk || !catOk || !metOk) {
    const faltantes = [
      !montoOk && 'monto',
      !descOk  && 'descripción',
      !catOk   && 'categoría',
      !metOk   && 'método de pago',
    ].filter(Boolean).join(', ');
    toast('Completá: ' + faltantes, 'error');
    return;
  }
  if (!splitOk) {
    toast('El monto del 2do método debe ser > $0 y < total', 'error');
    return;
  }

  const tipo = document.getElementById('mov-btn-ingreso').classList.contains('tipo-active') ? 'ingreso' : 'egreso';

  const data = { tipo, categoria, descripcion, monto, metodoPago, fecha: currentDate };
  if (_splitActive && metodo2 && splitAmt > 0) {
    data.metodoPago2 = metodo2;
    data.monto2 = splitAmt;
  }

  try {
    if (editingMovId) {
      await db.collection('caja_movimientos').doc(editingMovId).update(data);
      toast('Movimiento actualizado', 'success');
    } else {
      await db.collection('caja_movimientos').add({ ...data, createdAt: new Date().toISOString() });
      toast('Movimiento registrado', 'success');
    }
    closeMovForm();
  } catch (e) {
    console.error('saveMov:', e);
    toast('Error al guardar', 'error');
  }
}

async function deleteMov() {
  if (!editingMovId) return;
  if (!confirm('¿Eliminar este movimiento?')) return;
  try {
    await db.collection('caja_movimientos').doc(editingMovId).delete();
    toast('Movimiento eliminado', 'success');
    closeMovForm();
  } catch (e) {
    console.error('deleteMov:', e);
    toast('Error al eliminar', 'error');
  }
}

// ══════════════════════════════════════════
//  CIERRE DE CAJA
// ══════════════════════════════════════════

async function loadCierre() {
  try {
    const doc = await db.collection('caja_cierres').doc(currentDate).get();
    CIERRE = doc.exists ? doc.data() : null;
  } catch(e) { CIERRE = null; }
  renderCierreStatus();
}

function renderCierreStatus() {
  const btn = document.getElementById('cierre-btn');
  if (!btn) return;
  btn.style.opacity = CIERRE ? '0.5' : '1';
  btn.title = CIERRE
    ? 'Cierre registrado — contado: $' + (CIERRE.contado || 0).toLocaleString('es-AR')
    : 'Cerrar caja del día';
}

function openCierreModal() {
  document.getElementById('cierre-billetes').innerHTML = renderCierreArqueoRows();
  if (CIERRE && CIERRE.billetes) {
    DENOMINACIONES.forEach(d => {
      const inp = document.getElementById('cierre-b-' + d);
      if (inp) inp.value = CIERRE.billetes[d] || 0;
    });
  }
  updateCierreTotal();
  document.getElementById('cierre-overlay').classList.remove('hidden');
  document.getElementById('cierre-modal').classList.remove('hidden');
}

function closeCierreModal() {
  document.getElementById('cierre-overlay').classList.add('hidden');
  document.getElementById('cierre-modal').classList.add('hidden');
}

function renderCierreArqueoRows() {
  return DENOMINACIONES.map(d => `
    <div class="arqueo-row">
      <span class="arqueo-denom">$${d.toLocaleString('es-AR')}</span>
      <div class="arqueo-counter">
        <button class="arqueo-btn" onclick="changeCierreBillete(${d},-1)">−</button>
        <input class="arqueo-input" id="cierre-b-${d}" type="number" value="0" min="0" inputmode="numeric" oninput="updateCierreTotal()">
        <button class="arqueo-btn" onclick="changeCierreBillete(${d},1)">+</button>
      </div>
      <span class="arqueo-subtotal" id="cierre-s-${d}">$0</span>
    </div>`).join('');
}

function changeCierreBillete(d, delta) {
  const inp = document.getElementById('cierre-b-' + d);
  if (!inp) return;
  inp.value = Math.max(0, (parseInt(inp.value) || 0) + delta);
  updateCierreTotal();
}

function _getCierreEsperado() {
  const apertura = ARQUEO?.total || 0;
  const ingEfec = MOVIMIENTOS.filter(m => m.tipo === 'ingreso' && m.metodoPago === 'Efectivo').reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const egEfec  = MOVIMIENTOS.filter(m => m.tipo === 'egreso'  && m.metodoPago === 'Efectivo').reduce((s, m) => s + (Number(m.monto) || 0), 0);
  return apertura + ingEfec - egEfec;
}

function updateCierreTotal() {
  const esperado = _getCierreEsperado();
  let contado = 0;
  DENOMINACIONES.forEach(d => {
    const inp = document.getElementById('cierre-b-' + d);
    const cant = inp ? (parseInt(inp.value) || 0) : 0;
    const sub = cant * d;
    contado += sub;
    const subEl = document.getElementById('cierre-s-' + d);
    if (subEl) subEl.textContent = '$' + sub.toLocaleString('es-AR');
  });
  const dif = contado - esperado;
  document.getElementById('cierre-esperado-val').textContent = fmt(esperado);
  document.getElementById('cierre-contado-val').textContent  = fmt(contado);
  const difEl = document.getElementById('cierre-dif-val');
  if (difEl) {
    difEl.textContent = (dif >= 0 ? '+' : '') + '$' + dif.toLocaleString('es-AR');
    difEl.className = 'cierre-dif-val ' + (Math.abs(dif) <= 500 ? 'dif-ok' : 'dif-warn');
  }
}

async function saveCierre() {
  const esperado = _getCierreEsperado();
  const billetes = {};
  let contado = 0;
  DENOMINACIONES.forEach(d => {
    const inp = document.getElementById('cierre-b-' + d);
    const cant = inp ? (parseInt(inp.value) || 0) : 0;
    billetes[d] = cant;
    contado += cant * d;
  });
  const diferencia = contado - esperado;
  try {
    await db.collection('caja_cierres').doc(currentDate).set({
      fecha: currentDate, billetes, contado, esperado, diferencia,
      savedAt: new Date().toISOString()
    });
    CIERRE = { billetes, contado, esperado, diferencia };
    closeCierreModal();
    renderCierreStatus();
    const difStr = diferencia === 0
      ? 'sin diferencia ✅'
      : (diferencia > 0 ? '+' : '') + '$' + diferencia.toLocaleString('es-AR');
    toast('🔐 Cierre guardado — ' + difStr, Math.abs(diferencia) <= 500 ? 'success' : 'info');
  } catch(e) { toast('Error al guardar cierre', 'error'); }
}

// ══════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n) {
  return '$' + Math.abs(Math.round(n)).toLocaleString('es-AR');
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2800);
}

// ══════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════

initPinPad();
checkAuth();
