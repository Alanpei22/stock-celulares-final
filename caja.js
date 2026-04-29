// ══════════════════════════════════════════
//  CAJA DIARIA — TechPoint
// ══════════════════════════════════════════

// Firebase — ver firebase-config.js

const DENOMINACIONES = [20000, 10000, 2000, 1000, 500, 200, 100];

const CATEGORIAS = {
  ingreso: ['Venta equipo', 'Reparación', 'Venta producto', 'Hidrogel / Accesorio', 'Seña', 'Otro ingreso'],
  egreso:  ['Compra repuesto', 'Gasto fijo', 'Retiro dueño', 'Otro gasto']
};
const RETIRO_CAT = 'Retiro dueño';

const METODOS_PAGO = ['Efectivo', 'Transferencia', 'MercadoPago', 'Tarjeta débito', 'Tarjeta crédito'];

const CAT_ICONS = {
  'Venta equipo': '📱', 'Reparación': '🔧', 'Venta producto': '🏷️', 'Hidrogel / Accesorio': '🛡️',
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

// ── Autocomplete de venta ─────────────────────────────────
let CAJA_REPUESTOS = [];        // listener específico para autocomplete
let _cajaRepuestosListener = null;
let _selectedSaleItem = null;   // { source, id, nombre, stock, precio, icon, extra }

// ── Autocomplete de reparaciones ──────────────────────────
let CAJA_REPAIRS = [];
let _cajaRepairsListener = null;
let _selectedRepairItem = null; // { repair, mode }  mode: 'sena' | 'cobro'
let _pendingRepairLink  = null; // repair esperando confirmación en el popup

// ── Cierres parciales (turnos) ─────────────────────────────
let CIERRES_PARCIALES = [];
let _parcialListener  = null;

// Expone cleanup para que auth.js cancele listeners en logout
window._cajaCleanup = function() {
  if (movListener)             { movListener();             movListener = null; }
  if (_cajaRepuestosListener)  { _cajaRepuestosListener();  _cajaRepuestosListener = null; }
  if (_cajaRepairsListener)    { _cajaRepairsListener();    _cajaRepairsListener = null; }
  if (_parcialListener)        { _parcialListener();        _parcialListener = null; }
  CAJA_REPUESTOS = [];
  CAJA_REPAIRS   = [];
  MOVIMIENTOS    = [];
  CIERRES_PARCIALES = [];
  _selectedSaleItem  = null;
  _selectedRepairItem = null;
  _pendingRepairLink  = null;
};

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
//  AUTH — Firebase
// ══════════════════════════════════════════

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.remove('app-hidden');
  initApp();
}

function initApp() {
  initDarkMode();
  db = _fbInit();
  updateDateLabel();
  listenMovimientos();
  loadArqueo();
  loadCierre();
  listenCierresParciales();        // ← turnos/cierres parciales
  listenCajaRepuestos();           // ← repuestos para autocomplete
  listenCajaRepairs();             // ← reparaciones para autocomplete
  _initMovDescAutocomplete();      // ← input handler de descripción
  ensureDolar(db);                 // ← cotización para calcular costo en pesos
  if (typeof initInventario === 'function') initInventario();
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
  if (movListener) { movListener(); movListener = null; }
  if (_parcialListener) { _parcialListener(); _parcialListener = null; }
  MOVIMIENTOS = [];
  CIERRES_PARCIALES = [];
  ARQUEO = null;
  CIERRE = null;
  listenMovimientos();
  listenCierresParciales();
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
      const today = _todayAR();
      if (currentDate === today) {
        // Caja chica pre-seteada de cualquier cierre previo NO usado todavía
        // (cubre el caso de saltar días: viernes cerrás → lunes abrís)
        let cajaChicaPreset = 0;
        try {
          const cfgDoc = await db.collection('caja_config').doc('nextOpening').get();
          if (cfgDoc.exists) {
            const d = cfgDoc.data();
            if (d.fecha && d.fecha < today && d.monto > 0 && !d.usado) {
              cajaChicaPreset = d.monto;
            }
          }
        } catch { /* no bloquea si falla */ }
        openArqueoModal(cajaChicaPreset);
        return;
      }
    }
  } catch (e) {
    console.error('loadArqueo:', e);
    ARQUEO = null;
  }
  renderStats();
}

function openArqueoModal(cajaChicaPreset = 0) {
  document.getElementById('arqueo-billetes').innerHTML = renderArqueoRows();
  updateArqueoTotal();

  const hintEl  = document.getElementById('arqueo-cajachica-hint');
  const rapidEl = document.getElementById('arqueo-confirm-rapido');
  if (cajaChicaPreset > 0) {
    if (hintEl) {
      hintEl.textContent = `💡 Ayer se dejaron $${cajaChicaPreset.toLocaleString('es-AR')} de caja chica`;
      hintEl.classList.remove('hidden');
    }
    if (rapidEl) {
      rapidEl.textContent = `✅ Confirmar apertura — hay $${cajaChicaPreset.toLocaleString('es-AR')}`;
      rapidEl.className = 'btn-cajachica-confirm';
      rapidEl.onclick = () => confirmAperturaRapida(cajaChicaPreset);
    }
  } else {
    if (hintEl)  hintEl.classList.add('hidden');
    if (rapidEl) rapidEl.className = 'btn-cajachica-confirm hidden';
    if (rapidEl) rapidEl.onclick = null;
  }

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
    // Marcar caja chica del día anterior como ya usada
    try { await db.collection('caja_config').doc('nextOpening').set({ usado: true }, { merge: true }); } catch {}
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
  // Evitar listeners duplicados (setDate() también cancela, pero doble guarda)
  if (movListener) { movListener(); movListener = null; }
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

// ── Porción en efectivo de un movimiento (split-aware) ──────
function _efecMonto(m) {
  const total = Number(m.monto) || 0;
  const m2amt = Number(m.monto2) || 0;
  if (m.metodoPago === 'Efectivo' && m.metodoPago2) return total - m2amt;
  if (m.metodoPago === 'Efectivo') return total;
  if (m.metodoPago2 === 'Efectivo') return m2amt;
  return 0;
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

  const ingEfec = ingMovs.reduce((s, m) => s + _efecMonto(m), 0);
  const egEfec  = egMovs.reduce((s, m) => s + _efecMonto(m), 0);
  const efectivoEnCaja = apertura + ingEfec - egEfec;
  const neto = totalIng - totalGastos; // retiros no afectan neto

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = fmt(val); };
  set('stat-apertura', apertura);
  set('stat-ingresos', totalIng);
  set('stat-egresos',  totalEg);
  set('stat-efectivo', efectivoEnCaja);

  const netoEl = document.getElementById('stat-neto');
  if (netoEl) { netoEl.textContent = fmt(neto); netoEl.style.color = neto >= 0 ? '#10b981' : '#ef4444'; }

  // Desglose del día — usa _efecMonto para respetar el split
  const reparac   = ingMovs.filter(m => m.categoria === 'Reparación').reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const ventaEfec = ingMovs.filter(m => m.categoria !== 'Reparación').reduce((s, m) => s + _efecMonto(m), 0);
  const digital   = ingMovs.reduce((s, m) => s + ((Number(m.monto) || 0) - _efecMonto(m)), 0);
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
  updateCajaResumen();
}

let _cajaResumenOpen = false;

function updateCajaResumen() {
  const bar = document.getElementById('caja-resumen-bar');
  if (!bar) return;
  if (!MOVIMIENTOS.length) { bar.classList.add('hidden'); return; }

  const ingMovs = MOVIMIENTOS.filter(m => m.tipo === 'ingreso');
  const egMovs  = MOVIMIENTOS.filter(m => m.tipo === 'egreso');
  const totalIng = ingMovs.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const totalEg  = egMovs.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const neto = totalIng - totalEg;
  const apertura = ARQUEO?.total || 0;

  const ingEfec = ingMovs.reduce((s, m) => s + _efecMonto(m), 0);
  const digIng  = totalIng - ingEfec;

  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('cres-ing',  '+' + fmt(totalIng));
  set('cres-eg',   '−' + fmt(totalEg));
  set('cres-neto', fmt(neto));
  const netoWrap = document.getElementById('cres-neto');
  if (netoWrap) netoWrap.style.color = neto >= 0 ? '#10b981' : '#ef4444';
  set('cres-d-ef',   fmt(ingEfec));
  set('cres-d-dig',  fmt(digIng));
  set('cres-d-mov',  MOVIMIENTOS.length);
  set('cres-d-aper', fmt(apertura));

  bar.classList.remove('hidden');
}

function toggleCajaResumen() {
  _cajaResumenOpen = !_cajaResumenOpen;
  const detail  = document.getElementById('caja-resumen-detail');
  const chevron = document.getElementById('cres-chevron');
  if (detail)  detail.classList.toggle('hidden', !_cajaResumenOpen);
  if (chevron) chevron.textContent = _cajaResumenOpen ? '▼' : '▲';
}

function renderMovimientos() {
  const list  = document.getElementById('caja-list');
  const empty = document.getElementById('caja-empty');
  if (!list) return;

  if (!MOVIMIENTOS.length && !CIERRES_PARCIALES.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Mezclar movimientos + cierres parciales ordenados por tiempo
  const items = [
    ...MOVIMIENTOS.map(m => ({ ...m, _type: 'mov' })),
    ...CIERRES_PARCIALES.map(c => ({ ...c, _type: 'turno' })),
  ].sort((a, b) => {
    const ka = a._type === 'turno' ? a.timestamp : a.createdAt;
    const kb = b._type === 'turno' ? b.timestamp : b.createdAt;
    return (ka || '').localeCompare(kb || '');
  });

  list.innerHTML = items.map(item => {
    if (item._type === 'turno') return _renderTurnoSep(item);
    const m = item;
    const hora = typeof m.createdAt === 'string'
      ? new Date(m.createdAt).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })
      : '';
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

function _renderTurnoSep(c) {
  const neto    = c.netoPeriodo || 0;
  const difAbs  = Math.abs(c.diferencia || 0);
  const difStr  = c.efectivoContado > 0
    ? (c.diferencia === 0 ? ' ✓' : (c.diferencia > 0 ? ` +$${difAbs.toLocaleString('es-AR')}` : ` -$${difAbs.toLocaleString('es-AR')}`))
    : '';
  return `
    <div class="turno-sep">
      <div class="turno-sep-badge">
        🔄 <b>${esc(c.vendedor || 'Turno')}</b>
        <span class="turno-sep-hora">${esc(c.periodoDesdeHora || '')} → ${esc(c.horaAR || '')}</span>
      </div>
      <div class="turno-sep-stats">
        ${c.ingresosPeriodo > 0 ? `<span class="tsep-ing">+${fmt(c.ingresosPeriodo)}</span>` : ''}
        ${c.egresosPeriodo  > 0 ? `<span class="tsep-eg">−${fmt(c.egresosPeriodo)}</span>`  : ''}
        <span class="tsep-neto" style="color:${neto>=0?'#10b981':'#ef4444'}">Neto ${fmt(neto)}</span>
        ${c.efectivoContado > 0 ? `<span class="tsep-contado">💵 ${fmt(c.efectivoContado)}${difStr}</span>` : ''}
      </div>
    </div>`;
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
    if (deleteWrap) deleteWrap.style.display = '';
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
    if (deleteWrap) deleteWrap.style.display = 'none';
    setMovTipo('ingreso');
    document.getElementById('mov-fi-monto').value = '';
    document.getElementById('mov-fi-desc').value  = '';
    selectMetodo('Efectivo');
    _clearSaleItem();
    _selectedRepairItem = null;
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
  _clearSaleItem(false);
  _clearRepairItem(false);
  _hideMovSuggestions();
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

// ══════════════════════════════════════════
//  AUTOCOMPLETE de descripción de venta
//  → Productos (inventario) + Repuestos
//  → Descuenta stock al guardar (solo en INGRESO)
// ══════════════════════════════════════════

function listenCajaRepuestos() {
  if (_cajaRepuestosListener) return;
  _cajaRepuestosListener = db.collection('repuestos').onSnapshot(snap => {
    CAJA_REPUESTOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }, err => console.error('Repuestos (caja):', err));
}

function listenCajaRepairs() {
  if (_cajaRepairsListener) return;
  // Limitar a 365 días para no traer toda la historia de reparaciones
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  _cajaRepairsListener = db.collection('repairs')
    .where('fechaIngreso', '>=', cutoff.toISOString())
    .onSnapshot(snap => {
      CAJA_REPAIRS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      CAJA_REPAIRS.sort((a, b) => (b.nOrden || 0) - (a.nOrden || 0));
    }, err => console.error('Repairs (caja):', err));
}

function listenCierresParciales() {
  if (_parcialListener) { _parcialListener(); _parcialListener = null; }
  _parcialListener = db.collection('caja_cierres_parciales')
    .where('fecha', '==', currentDate)
    .onSnapshot(snap => {
      CIERRES_PARCIALES = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      CIERRES_PARCIALES.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
      renderMovimientos();
    }, err => console.error('CierresParciales:', err));
}

function _initMovDescAutocomplete() {
  const input = document.getElementById('mov-fi-desc');
  if (!input) return;
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', _onMovDescInput);
  input.addEventListener('focus', _onMovDescInput);
  input.addEventListener('blur', () => setTimeout(_hideMovSuggestions, 180));
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') _hideMovSuggestions();
  });
}

function _onMovDescInput() {
  const input = document.getElementById('mov-fi-desc');
  if (!input) return;
  const q = (input.value || '').trim().toLowerCase();

  // Si el usuario cambió el texto después de elegir, descartar selección previa
  if (_selectedSaleItem && input.value.trim() !== _selectedSaleItem.nombre) {
    _clearSaleItem(false);
  }

  // Cuando está vacío, no mostrar nada
  if (q.length < 1) { _hideMovSuggestions(); return; }

  // Solo autocompletar para INGRESO (ventas)
  const tipo = document.getElementById('mov-btn-ingreso')?.classList.contains('tipo-active') ? 'ingreso' : 'egreso';
  if (tipo !== 'ingreso') { _hideMovSuggestions(); return; }

  // searchMatch (utils.js) tokeniza, normaliza acentos y expande sinónimos.
  // Ejemplos: "modulo iphone" encuentra "Pantalla iPhone 14",
  //           "Módulo" matchea "modulo", "vidrio" matchea "templado", etc.
  const results = [];

  const dolar = getCurrentDolar() || 0;

  // ── Productos (inventario) ──
  if (typeof PRODUCTOS !== 'undefined' && Array.isArray(PRODUCTOS)) {
    PRODUCTOS.forEach(p => {
      if (p.activo === false) return;
      if (searchMatch([p.nombre, p.codigo, p.categoria], q)) {
        results.push({
          source: 'producto',
          id: p.id,
          nombre: p.nombre || '(sin nombre)',
          extra: [p.categoria, p.codigo].filter(Boolean).join(' · '),
          stock: Number(p.stock) || 0,
          precio: Number(p.precioVenta) || 0,
          costoUSD: 0,
          costoARS: Number(p.precioCosto) || 0,
          icon: '📦',
        });
      }
    });
  }

  // ── Repuestos ──
  CAJA_REPUESTOS.forEach(r => {
    if (searchMatch([r.nombre, r.marca, r.modelo, r.tipo], q)) {
      const precioVenta = Number(r.precioVenta) || 0;
      const costoUSD    = Number(r.precioCostoUSD) || 0;
      // costoARS = USD × dólar actual (snapshot). Fallback: precioCompra legacy.
      const costoARS = costoUSD > 0 && dolar > 0
        ? Math.round(costoUSD * dolar)
        : (Number(r.precioCompra) || 0);
      results.push({
        source: 'repuesto',
        id: r.id,
        nombre: r.nombre || `${r.tipo || ''} ${r.marca || ''} ${r.modelo || ''}`.trim() || '(repuesto)',
        extra: [r.tipo, r.marca].filter(Boolean).join(' · '),
        stock: Number(r.cantidad) || 0,
        precio: precioVenta || costoARS, // si no hay precio venta, mostrar al menos el costo como referencia
        costoUSD,
        costoARS,
        icon: '🔧',
      });
    }
  });

  // ── Reparaciones ──
  const qIsNumeric = /^\d+$/.test(q.replace(/\s/g, ''));
  CAJA_REPAIRS.forEach(r => {
    // Omitir canceladas y las ya cobradas+entregadas
    if (r.estado === 'cancelado' || r.estado === 'no van') return;
    if (r.cobrado && r.estado === 'entregado') return;

    let matches = false;
    if (qIsNumeric) {
      const nStr = String(r.nOrden || '');
      matches = nStr.startsWith(q.replace(/\s/g, ''));
    }
    if (!matches) {
      matches = searchMatch([r.nombre, r.marca, r.modelo, r.arreglo, String(r.nOrden || '')], q);
    }
    if (!matches) return;

    const saldo = Math.max(0, (r.monto || 0) - (r.sena || 0));
    results.push({
      source: 'repair',
      repair: r,
      id: r.id,
      nombre: `N°${r.nOrden || '?'} — ${r.nombre || 'Sin nombre'}`,
      extra: [r.marca, r.modelo, r.arreglo].filter(Boolean).join(' · '),
      stock: -1,
      precio: saldo || r.monto || 0,
      saldo,
      estado: r.estado,
      icon: '🔧',
      costoUSD: 0,
      costoARS: 0,
    });
  });

  // Priorizar coincidencia al inicio del nombre, después por stock disponible, después alfabético
  const qNorm = normalizeText(q);
  results.sort((a, b) => {
    // Reparaciones "listo" primero dentro de su grupo
    if (a.source === 'repair' && b.source === 'repair') {
      const aL = a.estado === 'listo' ? 0 : 1;
      const bL = b.estado === 'listo' ? 0 : 1;
      if (aL !== bL) return aL - bL;
      return (b.repair?.nOrden || 0) - (a.repair?.nOrden || 0);
    }
    // Reparaciones al final de la lista (productos/repuestos primero)
    if (a.source === 'repair' && b.source !== 'repair') return 1;
    if (a.source !== 'repair' && b.source === 'repair') return -1;
    const aStart = normalizeText(a.nombre).startsWith(qNorm) ? 0 : 1;
    const bStart = normalizeText(b.nombre).startsWith(qNorm) ? 0 : 1;
    if (aStart !== bStart) return aStart - bStart;
    // Items con stock antes de los sin stock
    const aHas = a.stock > 0 ? 0 : 1;
    const bHas = b.stock > 0 ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    return a.nombre.localeCompare(b.nombre);
  });

  _showMovSuggestions(results.slice(0, 10), q);
}

function _showMovSuggestions(results, q) {
  const drop = document.getElementById('mov-desc-suggest');
  if (!drop) return;

  // Sin resultados → mostrar empty state (no esconder)
  if (!results.length) {
    drop.innerHTML = `
      <div class="mov-sug-empty">
        <span class="sug-empty-ico">🔍</span>
        <div class="sug-empty-text">
          <div class="sug-empty-title">Sin coincidencias para "${esc(q || '')}"</div>
          <div class="sug-empty-sub">Seguí escribiendo libre · o cargá el producto en Inventario</div>
        </div>
      </div>`;
    drop._results = [];
    drop.classList.remove('hidden');
    return;
  }

  drop.innerHTML = results.map((r, i) => {
    // ── Reparación ──
    if (r.source === 'repair') {
      const saldo = r.saldo || 0;
      const saldoStr = saldo > 0
        ? `Saldo $${saldo.toLocaleString('es-AR')}`
        : (r.precio > 0 ? `$${r.precio.toLocaleString('es-AR')}` : '');
      const estadoCls = r.estado === 'listo'     ? 'sug-stock-ok'
                      : r.estado === 'entregado' ? 'sug-stock-low'
                      : 'sug-stock-zero';
      const estadoLbl = r.estado === 'listo'     ? '✓ Listo'
                      : r.estado === 'entregado' ? 'Entregado'
                      : 'Reparando';
      return `<button type="button" class="mov-sug-item mov-sug-item--repair" data-i="${i}" onmousedown="event.preventDefault()" onclick="_selectMovSuggestion(${i})">
        <span class="sug-ico">🔧</span>
        <span class="sug-info">
          <span class="sug-name">${esc(r.nombre)}</span>
          <span class="sug-meta">🔩 Reparación${r.extra ? ' · ' + esc(r.extra) : ''}</span>
        </span>
        <span class="sug-right">
          ${saldoStr ? `<span class="sug-precio sug-saldo-chip">${esc(saldoStr)}</span>` : ''}
          <span class="sug-stock ${estadoCls}">${estadoLbl}</span>
        </span>
      </button>`;
    }
    // ── Producto / Repuesto ──
    const stockCls = r.stock <= 0 ? 'sug-stock-zero'
                  : r.stock <= 2 ? 'sug-stock-low'
                  : 'sug-stock-ok';
    const precioStr = r.precio > 0 ? `$${r.precio.toLocaleString('es-AR')}` : '';
    return `<button type="button" class="mov-sug-item" data-i="${i}" onmousedown="event.preventDefault()" onclick="_selectMovSuggestion(${i})">
      <span class="sug-ico">${r.icon}</span>
      <span class="sug-info">
        <span class="sug-name">${esc(r.nombre)}</span>
        <span class="sug-meta">${r.source === 'producto' ? '📦 Inventario' : '🔧 Repuesto'}${r.extra ? ' · ' + esc(r.extra) : ''}</span>
      </span>
      <span class="sug-right">
        ${precioStr ? `<span class="sug-precio">${precioStr}</span>` : ''}
        <span class="sug-stock ${stockCls}">${r.stock} u.</span>
      </span>
    </button>`;
  }).join('');

  // Guardar resultados en el elemento para usarlos al hacer click
  drop._results = results;
  drop.classList.remove('hidden');
}

function _hideMovSuggestions() {
  const drop = document.getElementById('mov-desc-suggest');
  if (drop) drop.classList.add('hidden');
}

function _selectMovSuggestion(idx) {
  const drop = document.getElementById('mov-desc-suggest');
  const r = drop?._results?.[idx];
  if (!r) return;

  _hideMovSuggestions();

  // ── Reparación → abrir popup "¿Entregado?" ──
  if (r.source === 'repair') {
    _openRepairLinkModal(r.repair);
    return;
  }

  _selectedSaleItem = r;

  // Llenar descripción
  const input = document.getElementById('mov-fi-desc');
  input.value = r.nombre;

  // Auto-set categoría según el origen
  selectCat('Venta producto');

  // Pre-cargar monto con precio de venta * cantidad (= 1 inicialmente)
  if (r.precio > 0) {
    document.getElementById('mov-fi-monto').value = r.precio;
  }

  _showQtyPicker(r);
}


function _showQtyPicker(item) {
  const wrap = document.getElementById('mov-sale-item-info');
  if (!wrap) return;
  const stockBadgeCls = item.stock <= 0 ? 'sug-stock-zero'
                      : item.stock <= 2 ? 'sug-stock-low'
                      : 'sug-stock-ok';
  const stockMax = Math.max(item.stock, 1); // permitir vender 1 aunque stock = 0 (orden a pedido)

  wrap.innerHTML = `
    <div class="sale-item-card">
      <div class="sale-item-row">
        <span class="sale-item-icon">${item.icon}</span>
        <div class="sale-item-text">
          <span class="sale-item-name">${esc(item.nombre)}</span>
          <span class="sale-item-meta">${item.source === 'producto' ? '📦 Inventario' : '🔧 Repuesto'} · Stock: <b class="${stockBadgeCls}">${item.stock}</b></span>
        </div>
        <button class="sale-item-clear" onclick="_clearSaleItem()" type="button" title="Quitar">✕</button>
      </div>
      <div class="sale-item-qty">
        <span class="sale-item-qty-lbl">Cantidad</span>
        <div class="sale-qty-controls">
          <button type="button" class="qty-btn" onclick="_changeSaleQty(-1)">−</button>
          <input id="mov-sale-qty" type="number" min="1" max="${stockMax}" value="1" inputmode="numeric">
          <button type="button" class="qty-btn" onclick="_changeSaleQty(1)">+</button>
        </div>
      </div>
      ${item.stock <= 0 ? '<div class="sale-item-warn">⚠️ Sin stock — se descontará a 0 (verificá si es pedido especial)</div>' : ''}
    </div>
  `;
  wrap.classList.remove('hidden');

  // Recalcular monto cuando cambia la cantidad
  const qtyInput = document.getElementById('mov-sale-qty');
  qtyInput.addEventListener('input', () => {
    const qty = Math.max(1, parseInt(qtyInput.value) || 1);
    if (item.precio > 0) {
      document.getElementById('mov-fi-monto').value = qty * item.precio;
    }
  });
}

function _hideQtyPicker() {
  const wrap = document.getElementById('mov-sale-item-info');
  if (wrap) { wrap.classList.add('hidden'); wrap.innerHTML = ''; }
}

function _changeSaleQty(delta) {
  const inp = document.getElementById('mov-sale-qty');
  if (!inp) return;
  const max = parseInt(inp.max) || 999;
  let val = (parseInt(inp.value) || 1) + delta;
  val = Math.max(1, Math.min(max, val));
  inp.value = val;
  inp.dispatchEvent(new Event('input'));
}

function _clearSaleItem(clearText = true) {
  _selectedSaleItem = null;
  _hideQtyPicker();
  if (clearText) document.getElementById('mov-fi-desc').value = '';
}

// ══════════════════════════════════════════
//  VINCULACIÓN CON REPARACIÓN
// ══════════════════════════════════════════

function _openRepairLinkModal(repair) {
  _pendingRepairLink = repair;
  const saldo = Math.max(0, (repair.monto || 0) - (repair.sena || 0));
  const equip = [repair.marca, repair.modelo].filter(Boolean).join(' ');
  const infoEl = document.getElementById('repair-link-info');
  if (infoEl) {
    infoEl.innerHTML = `
      <div class="rlc-card">
        <div class="rlc-row"><span class="rlc-lbl">N° Orden</span><span class="rlc-val rlc-orden">#${esc(String(repair.nOrden || '—'))}</span></div>
        ${repair.nombre ? `<div class="rlc-row"><span class="rlc-lbl">Cliente</span><span class="rlc-val">${esc(repair.nombre)}</span></div>` : ''}
        ${equip ? `<div class="rlc-row"><span class="rlc-lbl">Equipo</span><span class="rlc-val">${esc(equip)}</span></div>` : ''}
        ${repair.arreglo ? `<div class="rlc-row"><span class="rlc-lbl">Trabajo</span><span class="rlc-val">${esc(repair.arreglo)}</span></div>` : ''}
        ${repair.monto > 0 ? `<div class="rlc-row"><span class="rlc-lbl">Precio total</span><span class="rlc-val">$${(repair.monto).toLocaleString('es-AR')}</span></div>` : ''}
        ${repair.sena > 0 ? `<div class="rlc-row"><span class="rlc-lbl">Seña pagada</span><span class="rlc-val rlc-sena-val">$${(repair.sena).toLocaleString('es-AR')}</span></div>` : ''}
        ${saldo > 0 ? `<div class="rlc-row rlc-row--saldo"><span class="rlc-lbl">Saldo pendiente</span><span class="rlc-val rlc-saldo-val">$${saldo.toLocaleString('es-AR')}</span></div>` : ''}
      </div>`;
  }
  document.getElementById('repair-link-overlay')?.classList.remove('hidden');
  document.getElementById('repair-link-modal')?.classList.remove('hidden');
}

function _cancelRepairLink() {
  _pendingRepairLink = null;
  document.getElementById('repair-link-overlay')?.classList.add('hidden');
  document.getElementById('repair-link-modal')?.classList.add('hidden');
}

function _selectRepairMode(mode) {
  const repair = _pendingRepairLink;
  if (!repair) return;
  _pendingRepairLink = null;
  document.getElementById('repair-link-overlay')?.classList.add('hidden');
  document.getElementById('repair-link-modal')?.classList.add('hidden');

  // Limpiar selección previa de producto/repuesto
  _clearSaleItem(false);
  _selectedRepairItem = { repair, mode };

  const equip   = [repair.marca, repair.modelo].filter(Boolean).join(' ');
  const cliente = repair.nombre || '';
  const saldo   = Math.max(0, (repair.monto || 0) - (repair.sena || 0));
  const partes  = [`N°${repair.nOrden || ''}`];
  if (cliente) partes.push(cliente);
  if (equip)   partes.push(equip);

  if (mode === 'sena') {
    selectCat('Seña');
    document.getElementById('mov-fi-desc').value = `Seña ${partes.join(' — ')}`;
    // Dejar que el usuario ingrese el monto de la seña
  } else {
    selectCat('Reparación');
    document.getElementById('mov-fi-desc').value = `Reparación ${partes.join(' — ')}`;
    // Pre-llenar con el saldo pendiente (o total si no hay seña)
    if (saldo > 0) {
      document.getElementById('mov-fi-monto').value = saldo;
    } else if (repair.monto > 0) {
      document.getElementById('mov-fi-monto').value = repair.monto;
    }
  }

  _showRepairCard(repair, mode);
}

function _showRepairCard(repair, mode) {
  const wrap = document.getElementById('mov-sale-item-info');
  if (!wrap) return;
  const saldo   = Math.max(0, (repair.monto || 0) - (repair.sena || 0));
  const equip   = [repair.marca, repair.modelo].filter(Boolean).join(' ');
  const modeLbl = mode === 'sena' ? '📝 Seña' : '✅ Cobro total';
  const modeClr = mode === 'sena' ? 'var(--acc,#C8965A)' : 'var(--grn2,#10b981)';

  wrap.innerHTML = `
    <div class="sale-item-card">
      <div class="sale-item-row">
        <span class="sale-item-icon">🔧</span>
        <div class="sale-item-text">
          <span class="sale-item-name">N°${esc(String(repair.nOrden || '—'))} — ${esc(repair.nombre || 'Sin cliente')}</span>
          <span class="sale-item-meta">${esc(equip)}${repair.arreglo ? ' · ' + esc(repair.arreglo) : ''}</span>
        </div>
        <button class="sale-item-clear" onclick="_clearRepairItem()" type="button" title="Desvincular">✕</button>
      </div>
      <div class="repair-mode-row">
        <span class="repair-mode-badge" style="background:${modeClr};color:#fff;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:700">${modeLbl}</span>
        ${saldo > 0 ? `<span class="repair-saldo-lbl" style="font-size:.8rem;color:var(--t2,#666);margin-left:8px">Saldo: <b>$${saldo.toLocaleString('es-AR')}</b></span>` : ''}
      </div>
    </div>
  `;
  wrap.classList.remove('hidden');
}

function _clearRepairItem(clearText = true) {
  _selectedRepairItem = null;
  _hideQtyPicker();
  if (clearText) document.getElementById('mov-fi-desc').value = '';
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
  // Evitar split entre dos métodos iguales (rompe el cálculo de efectivo)
  if (_splitActive && metodo2 && metodo2 === metodoPago) {
    toast('El 2do método no puede ser igual al primero', 'error');
    return;
  }

  const tipo = document.getElementById('mov-btn-ingreso').classList.contains('tipo-active') ? 'ingreso' : 'egreso';

  const data = { tipo, categoria, descripcion, monto, metodoPago, fecha: currentDate };
  if (_splitActive && metodo2 && splitAmt > 0) {
    data.metodoPago2 = metodo2;
    data.monto2 = splitAmt;
  }
  // Vendedor activo (para reportes por turno)
  const vendedorActivo = localStorage.getItem('cajaVendedor') || ARQUEO?.vendedor || '';
  if (vendedorActivo) data.vendedor = vendedorActivo;

  // ── Item seleccionado del autocomplete (solo en INGRESO y al CREAR, no editar) ──
  let stockUpdate  = null;
  let repairUpdate = null;

  if (_selectedSaleItem && tipo === 'ingreso' && !editingMovId) {
    const qty = Math.max(1, parseInt(document.getElementById('mov-sale-qty')?.value) || 1);
    data.itemId       = _selectedSaleItem.id;
    data.itemSource   = _selectedSaleItem.source;
    data.itemQty      = qty;
    data.itemNombre   = _selectedSaleItem.nombre;
    // Snapshot del costo al momento de la venta (para reportar margen real)
    data.costoUSDUnit = _selectedSaleItem.costoUSD || 0;
    data.costoARSUnit = _selectedSaleItem.costoARS || 0;
    data.costoARSTotal = (_selectedSaleItem.costoARS || 0) * qty;
    data.gananciaARS  = (Number(monto) || 0) - data.costoARSTotal;

    const collection = _selectedSaleItem.source === 'producto' ? 'productos' : 'repuestos';
    const stockField = _selectedSaleItem.source === 'producto' ? 'stock' : 'cantidad';
    const newStock   = Math.max(0, (_selectedSaleItem.stock || 0) - qty);
    stockUpdate = { collection, id: _selectedSaleItem.id, stockField, newStock, qty };
  }

  if (_selectedRepairItem && tipo === 'ingreso' && !editingMovId) {
    const { repair, mode } = _selectedRepairItem;
    data.repairId    = repair.id;
    data.repairNOrden = repair.nOrden || null;
    data.repairMode  = mode;

    if (mode === 'sena') {
      data.esSena = true;
      repairUpdate = {
        id: repair.id,
        sena: (Number(repair.sena) || 0) + monto,
      };
    } else {
      // Validar que el monto cubra el saldo pendiente
      const saldoPendiente = Math.max(0, (Number(repair.monto) || 0) - (Number(repair.sena) || 0));
      if (saldoPendiente > 0 && monto < saldoPendiente) {
        const ok = confirm(`⚠️ El cobro ($${monto.toLocaleString('es-AR')}) es menor que el saldo pendiente ($${saldoPendiente.toLocaleString('es-AR')}).\n\n¿Marcar como cobro total de todas formas? (Si decís NO, registrá como seña)`);
        if (!ok) return;
      }
      data.esCobro = true;
      const upd = {
        cobrado: true,
        metodoCobro: metodoPago,
        fechaCobro: new Date().toISOString(),
      };
      if (repair.estado === 'listo') upd.estado = 'entregado';
      repairUpdate = { id: repair.id, ...upd };
    }
  }

  try {
    if (editingMovId) {
      await db.collection('caja_movimientos').doc(editingMovId).update(data);
      toast('Movimiento actualizado', 'success');
    } else {
      await db.collection('caja_movimientos').add({ ...data, createdAt: new Date().toISOString() });

      // Actualizar reparación vinculada
      if (repairUpdate) {
        try {
          const { id: repId, ...repFields } = repairUpdate;
          await db.collection('repairs').doc(repId).update(repFields);
          const modeMsg = repairUpdate.cobrado ? 'cobrada ✅' : 'seña actualizada ✅';
          toast(`Movimiento registrado · Reparación ${modeMsg}`, 'success');
        } catch (repErr) {
          console.error('Repair update error:', repErr);
          toast('Movimiento guardado, pero falló la actualización de la reparación', 'error');
        }
      }
      // Descontar stock después de guardar el movimiento (no bloqueante si falla)
      else if (stockUpdate) {
        try {
          await db.collection(stockUpdate.collection).doc(stockUpdate.id).update({
            [stockUpdate.stockField]: stockUpdate.newStock
          });
          toast(`Movimiento + stock − ${stockUpdate.qty} u. ✅`, 'success');
        } catch (stockErr) {
          console.error('Stock decrement error:', stockErr);
          toast('Movimiento guardado, pero falló el descuento de stock', 'error');
        }
      } else {
        toast('Movimiento registrado', 'success');
      }
    }
    _clearSaleItem(false);
    _clearRepairItem(false);
    closeMovForm();
  } catch (e) {
    console.error('saveMov:', e);
    toast('Error al guardar', 'error');
  }
}

function deleteMov() {
  if (!editingMovId) return;
  const id = editingMovId;
  requireCajaOwnerPin(async () => {
    try {
      await db.collection('caja_movimientos').doc(id).delete();
      toast('Movimiento eliminado', 'success');
      closeMovForm();
    } catch (e) {
      toast('Error al eliminar', 'error');
    }
  }, 'PIN de dueño para eliminar el movimiento');
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

// ══════════════════════════════════════════
//  CAJA CHICA (post-cierre / pre-apertura)
// ══════════════════════════════════════════

function openCajaChicaModal(contadoTotal) {
  const el = document.getElementById('cajachica-contado');
  if (el) el.textContent = fmt(contadoTotal || 0);
  const modal = document.getElementById('cajachica-modal');
  if (modal) modal.dataset.contado = String(contadoTotal || 0); // para validación
  const inp = document.getElementById('cajachica-monto');
  if (inp) inp.value = '';
  document.getElementById('cajachica-overlay')?.classList.remove('hidden');
  modal?.classList.remove('hidden');
  setTimeout(() => document.getElementById('cajachica-monto')?.focus(), 200);
}

function closeCajaChicaModal() {
  document.getElementById('cajachica-overlay')?.classList.add('hidden');
  document.getElementById('cajachica-modal')?.classList.add('hidden');
}

function _skipCajaChica() {
  closeCajaChicaModal();
  setTimeout(() => openCajaDuenoPrompt(_getCierreEsperado()), 300);
}

function setCajaChicaMonto(v) {
  const inp = document.getElementById('cajachica-monto');
  if (inp) inp.value = v;
}

async function saveCajaChica() {
  const monto = parseInt(document.getElementById('cajachica-monto').value) || 0;
  const contadoTotal = Number(document.getElementById('cajachica-modal')?.dataset.contado) || 0;
  // Validar que caja chica no supere el efectivo contado
  if (monto > contadoTotal && contadoTotal > 0) {
    if (!confirm(`⚠️ La caja chica ($${monto.toLocaleString('es-AR')}) es mayor que el efectivo contado ($${contadoTotal.toLocaleString('es-AR')}).\n\n¿Confirmás de todas formas?`)) return;
  }
  try {
    // Guardar en cierre del día
    await db.collection('caja_cierres').doc(currentDate).update({
      cajaChicaSiguiente: monto,
    });
    // Guardar en config para que mañana loadArqueo lo encuentre rápido
    await db.collection('caja_config').doc('nextOpening').set({
      fecha: currentDate,
      monto,
      savedAt: new Date().toISOString(),
    });
    closeCajaChicaModal();
    toast(monto > 0
      ? `💰 Caja chica guardada: $${monto.toLocaleString('es-AR')} para mañana`
      : 'Caja chica omitida', 'info');
    setTimeout(() => openCajaDuenoPrompt(_getCierreEsperado()), 400);
  } catch (e) {
    console.error('saveCajaChica:', e);
    // Si falla solo el update del cierre, igual guardamos config y continuamos
    try {
      await db.collection('caja_config').doc('nextOpening').set({
        fecha: currentDate, monto, savedAt: new Date().toISOString(),
      });
    } catch {}
    closeCajaChicaModal();
    setTimeout(() => openCajaDuenoPrompt(_getCierreEsperado()), 400);
  }
}

async function confirmAperturaRapida(monto) {
  const ahora = new Date();
  const horaAR = ahora.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });
  const inputVend = document.getElementById('arqueo-vendedor-input');
  const vendedor = (inputVend && inputVend.value.trim()) || localStorage.getItem('cajaVendedor') || '';
  if (inputVend && inputVend.value.trim()) localStorage.setItem('cajaVendedor', inputVend.value.trim());
  try {
    await db.collection('caja_arqueos').doc(currentDate).set({
      billetes: {}, total: monto,
      fecha: currentDate, savedAt: ahora.toISOString(), horaAR, vendedor,
      fromCajaChica: true,
    });
    ARQUEO = { billetes: {}, total: monto, fecha: currentDate, savedAt: ahora.toISOString(), horaAR, vendedor, fromCajaChica: true };
    try { await db.collection('caja_config').doc('nextOpening').set({ usado: true }, { merge: true }); } catch {}
    closeArqueoModal();
    renderStats();
    toast(`✅ Apertura confirmada — $${monto.toLocaleString('es-AR')}`, 'success');
  } catch (e) {
    console.error('confirmAperturaRapida:', e);
    toast('Error al confirmar apertura', 'error');
  }
}

function _getCierreEsperado() {
  const apertura = ARQUEO?.total || 0;
  const ingEfec = MOVIMIENTOS.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + _efecMonto(m), 0);
  const egEfec  = MOVIMIENTOS.filter(m => m.tipo === 'egreso' ).reduce((s, m) => s + _efecMonto(m), 0);
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
    // Primero preguntar caja chica, después caja dueño
    setTimeout(() => openCajaChicaModal(contado), 600);
  } catch(e) { toast('Error al guardar cierre', 'error'); }
}

// ══════════════════════════════════════════
//  CIERRES PARCIALES (TURNOS)
// ══════════════════════════════════════════

function _getPeriodoDesde() {
  if (CIERRES_PARCIALES.length > 0) {
    return CIERRES_PARCIALES[CIERRES_PARCIALES.length - 1].timestamp;
  }
  return ARQUEO?.savedAt || (currentDate + 'T00:00:00.000Z');
}

function _calcPeriodoStats(desdeISO) {
  const movs = MOVIMIENTOS.filter(m => (m.createdAt || '') > desdeISO);
  const ing  = movs.filter(m => m.tipo === 'ingreso');
  const eg   = movs.filter(m => m.tipo === 'egreso');
  const totalIng = ing.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const totalEg  = eg .reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const efec     = ing.reduce((s, m) => s + _efecMonto(m), 0);
  // Desglose por vendedor (si los movimientos tienen el campo)
  const porVendedor = {};
  movs.forEach(m => {
    const v = m.vendedor || '—';
    if (!porVendedor[v]) porVendedor[v] = { ing: 0, eg: 0, count: 0 };
    if (m.tipo === 'ingreso') porVendedor[v].ing += Number(m.monto) || 0;
    else                       porVendedor[v].eg  += Number(m.monto) || 0;
    porVendedor[v].count++;
  });
  return { totalIng, totalEg, efec, digital: totalIng - efec, neto: totalIng - totalEg, count: movs.length, porVendedor };
}

function openCierreParcialModal() {
  closeCajaMenu();
  const desdeISO  = _getPeriodoDesde();
  const desdeHora = new Date(desdeISO).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });
  const stats     = _calcPeriodoStats(desdeISO);
  const esperado  = _getCierreEsperado();

  const info = document.getElementById('parcial-info');
  if (info) {
    const rows = [];
    rows.push(`<div class="parcial-desde">⏱ Período desde <strong>${esc(desdeHora)}</strong> · ${stats.count} movimiento${stats.count !== 1 ? 's' : ''}</div>`);
    rows.push('<div class="parcial-grid">');
    if (stats.totalIng > 0) {
      rows.push(`<span class="pg-lbl">Ingresos</span><span class="pg-val pg-ing">+${fmt(stats.totalIng)}</span>`);
      if (stats.efec > 0 && stats.digital > 0) {
        rows.push(`<span class="pg-sub">💵 Efectivo</span><span class="pg-sub-val">${fmt(stats.efec)}</span>`);
        rows.push(`<span class="pg-sub">💳 Digital</span><span class="pg-sub-val">${fmt(stats.digital)}</span>`);
      }
    }
    if (stats.totalEg > 0)
      rows.push(`<span class="pg-lbl">Egresos</span><span class="pg-val pg-eg">−${fmt(stats.totalEg)}</span>`);
    rows.push(`<span class="pg-lbl">Neto turno</span><span class="pg-val" style="color:${stats.neto>=0?'#10b981':'#ef4444'}">${stats.neto>=0?'+':''}${fmt(stats.neto)}</span>`);
    rows.push(`<span class="pg-lbl">💵 Ef. esperado caja</span><span class="pg-val">${fmt(esperado)}</span>`);
    rows.push('</div>');
    info.innerHTML = rows.join('');
  }

  const nombreInp = document.getElementById('parcial-fi-nombre');
  if (nombreInp) nombreInp.value = localStorage.getItem('cajaVendedor') || '';
  const efecInp = document.getElementById('parcial-fi-efectivo');
  if (efecInp) efecInp.value = '';
  const notasInp = document.getElementById('parcial-fi-notas');
  if (notasInp) notasInp.value = '';

  document.getElementById('parcial-overlay').classList.remove('hidden');
  document.getElementById('parcial-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('parcial-fi-efectivo')?.focus(), 200);
}

function closeCierreParcialModal() {
  document.getElementById('parcial-overlay').classList.add('hidden');
  document.getElementById('parcial-modal').classList.add('hidden');
}

async function saveCierreParcial() {
  const nombre = document.getElementById('parcial-fi-nombre')?.value.trim() || '';
  const efectivoContado = parseInt(document.getElementById('parcial-fi-efectivo')?.value) || 0;
  const notas  = document.getElementById('parcial-fi-notas')?.value.trim() || null;

  if (!nombre) {
    toast('Ingresá tu nombre para cerrar el turno', 'error');
    document.getElementById('parcial-fi-nombre')?.focus();
    return;
  }

  const ahora = new Date();
  const horaAR = ahora.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });
  const desdeISO = _getPeriodoDesde();
  const desdeHora = new Date(desdeISO).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' });
  const stats    = _calcPeriodoStats(desdeISO);
  const esperado = _getCierreEsperado();

  if (nombre) localStorage.setItem('cajaVendedor', nombre);

  try {
    await db.collection('caja_cierres_parciales').add({
      fecha: currentDate,
      timestamp: ahora.toISOString(),
      horaAR,
      vendedor: nombre,
      periodoDesde: desdeISO,
      periodoDesdeHora: desdeHora,
      ingresosPeriodo: stats.totalIng,
      egresosPeriodo:  stats.totalEg,
      efecPeriodo:     stats.efec,
      digitalPeriodo:  stats.digital,
      netoPeriodo:     stats.neto,
      efectivoEsperado: esperado,
      efectivoContado,
      diferencia: efectivoContado > 0 ? efectivoContado - esperado : null,
      notas,
    });
    closeCierreParcialModal();
    toast(`🔄 Turno de ${nombre} cerrado — ${horaAR}`, 'success');
  } catch (e) {
    console.error('saveCierreParcial:', e);
    toast('Error al guardar cierre de turno', 'error');
  }
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

requireAuth().then(u => { if (u) showApp(); });
