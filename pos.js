// ══════════════════════════════════════════
//  PUNTO DE VENTA — pos.js
// ══════════════════════════════════════════

const POS_FB_CONFIG = {
  apiKey: "AIzaSyAMRkrADBxRF6rST8rNwO5IqdWneXocBsE",
  authDomain: "stockcelustech.firebaseapp.com",
  projectId: "stockcelustech",
  storageBucket: "stockcelustech.firebasestorage.app",
  messagingSenderId: "140592485004",
  appId: "1:140592485004:web:29f6b0aa0f02fdf99ba1a9"
};

let db = null;
let PRODUCTOS_MAP = new Map(); // codigo → producto
let _posListener = null;

// Carrito: Array<{ producto, qty }>
let CART = [];
let _posMetodo = 'Efectivo';

// ── Firebase init ───────────────────────────────────────────
function initPos() {
  if (!firebase.apps.length) firebase.initializeApp(POS_FB_CONFIG);
  db = firebase.firestore();
  initPosDark();
  loadProductos();
  initScanInput();
}

// ── Cargar productos (onSnapshot) ──────────────────────────
function loadProductos() {
  _posListener = db.collection('productos')
    .where('activo', '!=', false)
    .onSnapshot(snap => {
      PRODUCTOS_MAP.clear();
      snap.docs.forEach(d => {
        const p = { id: d.id, ...d.data() };
        if (p.codigo) PRODUCTOS_MAP.set(String(p.codigo), p);
      });
    }, err => {
      console.error('POS productos:', err);
      posToast('Error cargando productos', true);
    });
}

// ── Scan input ──────────────────────────────────────────────
function initScanInput() {
  const inp = document.getElementById('pos-scan-input');
  if (!inp) return;

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const cod = inp.value.trim();
      inp.value = '';
      if (cod) handleScan(cod);
    }
  });

  // Mantener foco en el input salvo que haya modal abierto
  inp.addEventListener('blur', () => {
    setTimeout(() => {
      const overlay = document.getElementById('pos-confirm-overlay');
      if (overlay && !overlay.classList.contains('hidden')) return;
      const success = document.getElementById('pos-success-overlay');
      if (success && !success.classList.contains('hidden')) return;
      const active = document.activeElement;
      if (!active || active.tagName === 'BODY') inp.focus();
    }, 150);
  });

  inp.focus();
}

// ── Manejar escaneo ────────────────────────────────────────
function handleScan(codigo) {
  const p = PRODUCTOS_MAP.get(codigo);
  const infoEl = document.getElementById('pos-found-info');

  if (!p) {
    // Producto no encontrado
    infoEl.className = 'pos-found-flash pos-found-err';
    infoEl.innerHTML = `❌ Código <strong>${_esc(codigo)}</strong> no encontrado en inventario`;
    infoEl.style.display = '';
    setTimeout(() => { infoEl.style.display = 'none'; }, 2500);
    posToast('Producto no encontrado', true);
    return;
  }

  if ((p.stock || 0) <= 0) {
    infoEl.className = 'pos-found-flash pos-found-warn';
    infoEl.innerHTML = `⚠️ <strong>${_esc(p.nombre)}</strong> — sin stock`;
    infoEl.style.display = '';
    setTimeout(() => { infoEl.style.display = 'none'; }, 2000);
    posToast('Sin stock disponible', true);
    return;
  }

  // Producto encontrado → agregar al carrito
  infoEl.className = 'pos-found-flash';
  infoEl.innerHTML = `✅ <strong>${_esc(p.nombre)}</strong> — $${_fmtNum(p.precioVenta || 0)}`;
  infoEl.style.display = '';
  setTimeout(() => { infoEl.style.display = 'none'; }, 1800);

  addToCart(p);
}

// ── Carrito ─────────────────────────────────────────────────
function addToCart(producto) {
  const existing = CART.find(i => i.producto.id === producto.id);
  if (existing) {
    // Verificar stock disponible
    const maxQty = producto.stock || 0;
    if (existing.qty >= maxQty) {
      posToast(`Stock máximo: ${maxQty} u.`, true);
      return;
    }
    existing.qty++;
  } else {
    CART.push({ producto, qty: 1 });
  }
  renderCart();
}

function changeQty(idx, delta) {
  if (idx < 0 || idx >= CART.length) return;
  const item = CART[idx];
  const newQty = item.qty + delta;
  if (newQty <= 0) {
    CART.splice(idx, 1);
  } else {
    const max = item.producto.stock || 0;
    item.qty = Math.min(newQty, max);
  }
  renderCart();
}

function renderCart() {
  const listEl  = document.getElementById('pos-cart-list');
  const emptyEl = document.getElementById('pos-cart-empty');
  const totalEl = document.getElementById('pos-total');
  const checkBtn = document.getElementById('pos-checkout-btn');

  if (!CART.length) {
    if (emptyEl) emptyEl.style.display = '';
    if (listEl)  listEl.innerHTML = '';
    if (totalEl) totalEl.textContent = '$0';
    if (checkBtn) checkBtn.disabled = true;
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  const total = CART.reduce((s, i) => s + (i.producto.precioVenta || 0) * i.qty, 0);
  if (totalEl) totalEl.textContent = '$' + _fmtNum(total);
  if (checkBtn) checkBtn.disabled = false;

  if (!listEl) return;
  listEl.innerHTML = CART.map((item, idx) => {
    const subtotal = (item.producto.precioVenta || 0) * item.qty;
    return `<div class="pos-cart-item">
      <div class="pos-cart-item-info">
        <span class="pos-cart-item-nombre">${_esc(item.producto.nombre)}</span>
        <span class="pos-cart-item-precio">$${_fmtNum(item.producto.precioVenta || 0)} c/u · stock: ${item.producto.stock}</span>
      </div>
      <div class="pos-cart-qty-ctrl">
        <button class="pos-qty-btn pos-qty-del" onclick="changeQty(${idx}, -1)">
          ${item.qty === 1 ? '🗑' : '−'}
        </button>
        <span class="pos-qty-num">${item.qty}</span>
        <button class="pos-qty-btn" onclick="changeQty(${idx}, 1)">＋</button>
      </div>
      <span class="pos-cart-item-total">$${_fmtNum(subtotal)}</span>
    </div>`;
  }).join('');
}

// ── Método de pago ──────────────────────────────────────────
function selectMetodo(m) {
  _posMetodo = m;
  document.querySelectorAll('.pos-metodo-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.m === m);
  });
}

// ── Confirmación ────────────────────────────────────────────
function openConfirm() {
  if (!CART.length) return;
  const total = CART.reduce((s, i) => s + (i.producto.precioVenta || 0) * i.qty, 0);
  const linesEl = document.getElementById('pos-confirm-lines');
  if (linesEl) {
    let html = CART.map(item =>
      `<div class="pos-confirm-line">
        <span>${_esc(item.producto.nombre)} x${item.qty}</span>
        <span>$${_fmtNum((item.producto.precioVenta || 0) * item.qty)}</span>
      </div>`
    ).join('');
    html += `<div class="pos-confirm-line">
      <span>💳 ${_esc(_posMetodo)}</span>
      <span>$${_fmtNum(total)}</span>
    </div>`;
    linesEl.innerHTML = html;
  }
  document.getElementById('pos-confirm-overlay').classList.remove('hidden');
}

function closeConfirm() {
  document.getElementById('pos-confirm-overlay').classList.add('hidden');
  // Re-enfocar scan
  setTimeout(() => document.getElementById('pos-scan-input')?.focus(), 100);
}

// ── Checkout — Firestore batch ──────────────────────────────
async function checkout() {
  if (!CART.length) return;

  const btn = document.getElementById('pos-confirm-ok');
  if (btn) btn.disabled = true;

  const total = CART.reduce((s, i) => s + (i.producto.precioVenta || 0) * i.qty, 0);
  const now   = new Date();
  // Fecha en horario Argentina
  const fechaAR = now.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
  const horaAR  = now.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });

  // Descripción del movimiento
  const items = CART.map(i => `${i.producto.nombre} x${i.qty}`).join(', ');
  const desc  = `Venta producto: ${items}`;

  try {
    const batch = db.batch();

    // 1. Movimiento de caja (ingreso)
    const movRef = db.collection('caja_movimientos').doc();
    batch.set(movRef, {
      tipo:      'ingreso',
      categoria: 'Venta producto',
      monto:     total,
      metodo:    _posMetodo,
      descripcion: desc,
      fecha:     fechaAR,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 2. Decrementar stock de cada producto
    CART.forEach(item => {
      const ref = db.collection('productos').doc(item.producto.id);
      batch.update(ref, {
        stock: firebase.firestore.FieldValue.increment(-item.qty),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    await batch.commit();

    // Éxito
    closeConfirm();
    showSuccess(total, _posMetodo);
    CART = [];
    renderCart();

  } catch(e) {
    console.error('POS checkout error:', e);
    posToast('Error al registrar la venta', true);
    if (btn) btn.disabled = false;
  }
}

// ── Flash de éxito ──────────────────────────────────────────
function showSuccess(total, metodo) {
  const overlay = document.getElementById('pos-success-overlay');
  const sub     = document.getElementById('pos-success-sub');
  if (sub) sub.textContent = `$${_fmtNum(total)} · ${metodo}`;
  if (overlay) overlay.classList.remove('hidden');
  setTimeout(() => {
    if (overlay) overlay.classList.add('hidden');
    document.getElementById('pos-scan-input')?.focus();
  }, 2200);
}

// ── Modo oscuro ─────────────────────────────────────────────
function initPosDark() {
  if (localStorage.getItem('darkMode') === '1') document.body.classList.add('dark');
  _updatePosDarkBtn();
}
function togglePosDark() {
  document.body.classList.toggle('dark');
  localStorage.setItem('darkMode', document.body.classList.contains('dark') ? '1' : '0');
  _updatePosDarkBtn();
}
function _updatePosDarkBtn() {
  const btn = document.querySelector('.pos-dark-btn');
  if (btn) btn.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
}

// ── Toast ───────────────────────────────────────────────────
let _posToastTimer = null;
function posToast(msg, isError) {
  const el = document.getElementById('pos-toast');
  if (!el) return;
  el.textContent = (isError ? '⚠️ ' : '✅ ') + msg;
  el.style.background = isError ? '#b91c1c' : '#0f172a';
  el.classList.add('show');
  clearTimeout(_posToastTimer);
  _posToastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ── Helpers ─────────────────────────────────────────────────
function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _fmtNum(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Arrancar ────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', initPos);
