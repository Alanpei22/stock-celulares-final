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
let _movTipo = 'ingreso'; // HIGH-02: track tipo via module variable
let _cajaChicaFecha = null; // fecha del preset de caja chica encontrado
let _dateToken = 0; // BUG-FIX: token que se incrementa al cambiar de fecha; los async viejos descartan su resultado si ya cambió
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
  // LOW-01: actualizar solo el span del ícono, no el textContent completo del botón
  const icon = document.querySelector('.dark-toggle-btn .dark-icon');
  if (!icon) return;
  const isDark = document.body.classList.contains('dark');
  icon.textContent = isDark ? '☀️' : '🌙';
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
  _loadYesterdayStats().then(() => renderStats()); // Feature 6: vs ayer
  listenCierresParciales();        // ← turnos/cierres parciales
  listenCajaRepuestos();           // ← repuestos para autocomplete
  listenCajaRepairs();             // ← reparaciones para autocomplete
  _initMovDescAutocomplete();      // ← input handler de descripción
  ensureDolar(db);                 // ← cotización para calcular costo en pesos
  if (typeof initInventario === 'function') initInventario();

  // Estado colapsado/expandido del panel de detalle de caja
  _initCajaDetailState();

  // ── URL action handler (?action=cierre desde notifs/banners) ──
  _handleUrlAction();

  // ── Notifications boot (Fase 1) ──
  if (typeof loadNotifConfig === 'function') {
    loadNotifConfig().then(() => {
      const tryRenderBanner = () => {
        if (typeof renderInAppBanners === 'function') renderInAppBanners('notif-banners', 'caja');
      };
      tryRenderBanner();
      // Re-check cada 10 min (para que aparezca el banner de cierre pendiente al pasar las 19:30)
      setInterval(tryRenderBanner, 10 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') tryRenderBanner();
      });
      // Cross-device listener
      if (typeof startCrossDeviceListener === 'function') {
        setTimeout(startCrossDeviceListener, 2000);
      }
    });
  }

  // (HIGH-01 obsoleto: dropdown HTML zombie removido, ahora usamos bottom sheet)

  // MED-12: patch closeCajaDuenoPrompt una sola vez (flag para evitar acumulación en re-login)
  if (typeof closeCajaDuenoPrompt === 'function' && !closeCajaDuenoPrompt._patched) {
    const _origClose = closeCajaDuenoPrompt;
    closeCajaDuenoPrompt = function() {
      _origClose();
      if (CIERRE) setTimeout(() => openReporteModal(), 350);
    };
    closeCajaDuenoPrompt._patched = true;
  }

  // MED-01: refresh automático cuando el reloj pasa medianoche
  _scheduleMedianoche();
}

// Maneja URL params como ?action=cierre, ?action=arqueo, etc.
// Disparado desde notificaciones push y banners.
function _handleUrlAction() {
  try {
    const params = new URLSearchParams(location.search);
    const action = params.get('action');
    if (!action) return;
    // Limpiar el param de la URL (sin recargar)
    params.delete('action');
    const newSearch = params.toString();
    history.replaceState({}, '', location.pathname + (newSearch ? '?' + newSearch : ''));
    // Esperar a que arqueo/cierre cargue antes de abrir el modal
    const tryAct = (retry = 0) => {
      if (action === 'cierre') {
        if (typeof openCierreModal === 'function') openCierreModal();
        else if (retry < 10) setTimeout(() => tryAct(retry + 1), 300);
      } else if (action === 'arqueo') {
        if (typeof reopenArqueo === 'function') reopenArqueo();
        else if (retry < 10) setTimeout(() => tryAct(retry + 1), 300);
      } else if (action === 'reporte') {
        if (typeof openReporteModal === 'function') openReporteModal();
        else if (retry < 10) setTimeout(() => tryAct(retry + 1), 300);
      }
    };
    setTimeout(() => tryAct(0), 600);
  } catch (e) { console.error('handleUrlAction:', e); }
}

// BUG-FIX: detectar cambio de día cuando la PWA vuelve a primer plano
// (los setTimeout no son confiables en mobile background)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const realToday = _todayAR();
  if (currentDate === realToday) return;
  // Solo refrescar si estábamos viendo el día "anterior" (el que era hoy cuando se durmió)
  // Si el usuario navegó manualmente a otro día, no tocar.
  // Heurística simple: si currentDate < realToday, refrescamos.
  if (currentDate < realToday) {
    currentDate = realToday;
    _dateToken++;
    updateDateLabel();
    if (movListener) { movListener(); movListener = null; }
    if (_parcialListener) { _parcialListener(); _parcialListener = null; }
    MOVIMIENTOS = []; CIERRES_PARCIALES = [];
    ARQUEO = null; CIERRE = null;
    listenMovimientos();
    listenCierresParciales();
    loadArqueo();
    loadCierre();
    _yesterdayNeto = null;
    _loadYesterdayStats().then(() => renderStats());
    toast('📅 Nuevo día — caja actualizada', 'info');
  }
});

let _medianochTimer = null;
function _scheduleMedianoche() {
  if (_medianochTimer) clearTimeout(_medianochTimer);
  const now  = new Date();
  const msAR = now.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  // Calcular ms hasta medianoche AR (aproximado: esperar hasta que _todayAR() cambie)
  const mañana = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const mañanaStr = mañana.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
  const todayStr  = _todayAR();
  // Buscar el momento exacto de medianoche AR
  const msHastaMedianoche = (() => {
    const ar = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(now);
    const h = Number(ar.find(p => p.type === 'hour')?.value || 0);
    const m = Number(ar.find(p => p.type === 'minute')?.value || 0);
    const s = Number(ar.find(p => p.type === 'second')?.value || 0);
    return ((23 - h) * 3600 + (59 - m) * 60 + (60 - s)) * 1000;
  })();
  _medianochTimer = setTimeout(() => {
    currentDate = _todayAR();
    updateDateLabel();
    listenMovimientos();
    loadArqueo();
    loadCierre();
    _yesterdayNeto = null;
    _loadYesterdayStats().then(() => renderStats());
    toast('📅 Nuevo día iniciado', 'info');
    _scheduleMedianoche(); // reprogramar para la próxima medianoche
  }, msHastaMedianoche + 1000); // +1s de margen
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
  _dateToken++; // invalida cualquier load async pendiente del día anterior
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
  _yesterdayNeto = null; // Feature 6: invalidar comparativa al cambiar de fecha
  _loadYesterdayStats().then(() => renderStats());
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
  const myToken = _dateToken;
  try {
    const doc = await db.collection('caja_arqueos').doc(currentDate).get();
    if (myToken !== _dateToken) return; // BUG-FIX: la fecha cambió mientras esperábamos
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
              _cajaChicaFecha = d.fecha; // para mostrar fecha real en el hint
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
      // MED-13: mostrar fecha real en vez de hardcodear "ayer"
      const hintFecha = _cajaChicaFecha
        ? new Date(_cajaChicaFecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' })
        : 'el último cierre';
      hintEl.textContent = `💡 El ${hintFecha} se dejaron $${cajaChicaPreset.toLocaleString('es-AR')} de caja chica`;
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
      }).catch(e => { console.error('listenMovimientos get fallback error:', e); toast('Error cargando movimientos', 'error'); }); // MED-02
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
  // Defensivo: metodoPago vacío/undefined → tratar como Efectivo (movimientos viejos sin el campo)
  const met1 = m.metodoPago || 'Efectivo';
  const met2 = m.metodoPago2 || '';
  if (met1 === 'Efectivo' && met2) return total - m2amt;
  if (met1 === 'Efectivo') return total;
  if (met2 === 'Efectivo') return m2amt;
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

  // Quick bar (siempre visible)
  set('qb-efectivo', efectivoEnCaja);
  const qbNeto = document.getElementById('qb-neto');
  if (qbNeto) {
    qbNeto.textContent = (neto < 0 ? '−' : '') + fmt(neto);
    qbNeto.style.color = neto >= 0 ? '#10b981' : '#ef4444';
  }

  // Feature 6: comparativa "vs ayer" (usa _yesterdayNeto cargado por _loadYesterdayStats)
  _renderVsYesterday(neto);

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

// ── Feature 6: Comparativa vs ayer ──
let _yesterdayNeto = null; // null = no cargado todavía

async function _loadYesterdayStats() {
  // Solo cargar si estamos viendo HOY (no tiene sentido comparar días arbitrarios)
  if (currentDate !== _todayAR()) { _yesterdayNeto = null; _renderVsYesterday(0); return; }
  const myToken = _dateToken;
  try {
    const yDate = new Date(currentDate + 'T12:00:00');
    yDate.setDate(yDate.getDate() - 1);
    const yesterday = yDate.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
    const snap = await db.collection('caja_movimientos').where('fecha', '==', yesterday).get();
    if (myToken !== _dateToken) return; // BUG-FIX: ignorar respuesta vieja
    let yIng = 0, yGastos = 0;
    snap.docs.forEach(d => {
      const m = d.data();
      const monto = Number(m.monto) || 0;
      if (m.tipo === 'ingreso') yIng += monto;
      else if (m.categoria !== RETIRO_CAT) yGastos += monto;
    });
    _yesterdayNeto = yIng - yGastos;
  } catch (e) {
    if (myToken !== _dateToken) return;
    console.error('Vs ayer:', e);
    _yesterdayNeto = null;
  }
}

function _renderVsYesterday(todayNeto) {
  const el = document.getElementById('stat-vs-yest');
  if (!el) return;
  if (_yesterdayNeto === null || currentDate !== _todayAR()) {
    el.classList.add('hidden');
    return;
  }
  // Si ayer fue 0, no podemos calcular % — mostrar diferencia absoluta
  if (Math.abs(_yesterdayNeto) < 1) {
    el.classList.remove('hidden');
    el.classList.remove('vs-up','vs-down','vs-eq');
    el.classList.add(todayNeto > 0 ? 'vs-up' : todayNeto < 0 ? 'vs-down' : 'vs-eq');
    el.textContent = todayNeto === 0 ? '— sin ref.' : 'vs ayer $0';
    return;
  }
  const diff = todayNeto - _yesterdayNeto;
  const pct = Math.round((diff / Math.abs(_yesterdayNeto)) * 100);
  el.classList.remove('hidden','vs-up','vs-down','vs-eq');
  if (pct === 0)      el.classList.add('vs-eq');
  else if (pct > 0)   el.classList.add('vs-up');
  else                el.classList.add('vs-down');
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '=';
  el.textContent = `${arrow} ${Math.abs(pct)}% vs ayer`;
}

let _cajaResumenOpen = false;

function updateCajaResumen() {
  const bar = document.getElementById('caja-resumen-bar');
  if (!bar) return;
  if (!MOVIMIENTOS.length) { bar.classList.add('hidden'); return; }

  const ingMovs  = MOVIMIENTOS.filter(m => m.tipo === 'ingreso');
  const egMovs   = MOVIMIENTOS.filter(m => m.tipo === 'egreso');
  const retiros  = egMovs.filter(m => m.categoria === RETIRO_CAT);
  const gastos   = egMovs.filter(m => m.categoria !== RETIRO_CAT);
  const totalIng = ingMovs.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const totalEg  = egMovs.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const totalGastos = gastos.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  // HIGH-07: neto excluye retiros (igual que el stat-card) para mostrar valores consistentes
  const neto = totalIng - totalGastos;
  const apertura = ARQUEO?.total || 0;

  const ingEfec = ingMovs.reduce((s, m) => s + _efecMonto(m), 0);
  const digIng  = totalIng - ingEfec;

  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('cres-ing',  '+' + fmt(totalIng));
  set('cres-eg',   '−' + fmt(totalEg));
  // MED-08: mostrar signo explícito para neto negativo (fmt usa Math.abs internamente)
  set('cres-neto', (neto < 0 ? '−' : '') + fmt(neto));
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
  if (chevron) chevron.textContent = _cajaResumenOpen ? '▲' : '▼'; // LOW-15: ▲=expanded, ▼=collapsed
}

// Panel de detalle de caja (stats + desglose) — colapsable, recuerda preferencia
function toggleCajaDetail() {
  const panel = document.getElementById('caja-detail-panel');
  const chevron = document.getElementById('cqb-chevron');
  if (!panel) return;
  const willOpen = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !willOpen);
  if (chevron) chevron.textContent = willOpen ? '▴' : '▾';
  try { localStorage.setItem('cajaDetailOpen', willOpen ? '1' : '0'); } catch {}
}

// Aplica el estado guardado al cargar (colapsado por defecto)
function _initCajaDetailState() {
  const panel = document.getElementById('caja-detail-panel');
  const chevron = document.getElementById('cqb-chevron');
  if (!panel) return;
  const open = localStorage.getItem('cajaDetailOpen') === '1';
  panel.classList.toggle('hidden', !open);
  if (chevron) chevron.textContent = open ? '▴' : '▾';
}

// Estado de búsqueda + filtro (Feature 5)
let _movSearchQuery = '';
let _movFilterType  = 'all'; // all | ingreso | egreso | efectivo | digital

function _setMovFilter(filter) {
  _movFilterType = filter;
  document.querySelectorAll('.mov-fchip').forEach(b => {
    b.classList.toggle('mov-fchip-active', b.dataset.f === filter);
  });
  renderMovimientos();
}

function _clearMovSearch() {
  _movSearchQuery = '';
  const inp = document.getElementById('mov-search');
  if (inp) inp.value = '';
  document.getElementById('mov-search-clear')?.classList.add('hidden');
  renderMovimientos();
}

function _initMovSearch() {
  const inp = document.getElementById('mov-search');
  const clr = document.getElementById('mov-search-clear');
  if (!inp || inp._initialized) return;
  inp._initialized = true;
  let timer;
  inp.addEventListener('input', () => {
    _movSearchQuery = inp.value.trim().toLowerCase();
    clr?.classList.toggle('hidden', !_movSearchQuery);
    clearTimeout(timer);
    timer = setTimeout(renderMovimientos, 80);
  });
}

function _movMatchesFilter(m) {
  if (_movFilterType === 'all') return true;
  if (_movFilterType === 'ingreso') return m.tipo === 'ingreso';
  if (_movFilterType === 'egreso')  return m.tipo === 'egreso';
  if (_movFilterType === 'efectivo') return _efecMonto(m) > 0;
  if (_movFilterType === 'digital')  return ((Number(m.monto) || 0) - _efecMonto(m)) > 0;
  return true;
}

function _movMatchesSearch(m) {
  if (!_movSearchQuery) return true;
  const txt = [m.descripcion, m.categoria, m.metodoPago, m.metodoPago2, m.vendedor, m.itemNombre]
    .filter(Boolean).join(' ').toLowerCase();
  return txt.includes(_movSearchQuery);
}

function renderMovimientos() {
  const list  = document.getElementById('caja-list');
  const empty = document.getElementById('caja-empty');
  const searchWrap = document.getElementById('mov-search-wrap');
  if (!list) return;

  // Init search lazy
  _initMovSearch();

  // Mostrar/ocultar la barra de búsqueda según haya o no movimientos
  if (searchWrap) {
    searchWrap.style.display = MOVIMIENTOS.length >= 4 ? '' : 'none';
  }

  if (!MOVIMIENTOS.length && !CIERRES_PARCIALES.length) {
    list.innerHTML = '';
    if (empty) {
      empty.style.display = '';
      empty.innerHTML = '<div class="empty-icon">💸</div><p>Sin movimientos hoy</p><p class="empty-sub">Tocá + para registrar</p>';
    }
    return;
  }

  // Aplicar búsqueda + filtro a los MOVIMIENTOS (no a los turnos)
  const filteredMovs = MOVIMIENTOS.filter(m => _movMatchesFilter(m) && _movMatchesSearch(m));
  const isFiltering = _movSearchQuery || _movFilterType !== 'all';

  if (isFiltering && filteredMovs.length === 0) {
    list.innerHTML = '';
    if (empty) {
      empty.style.display = '';
      empty.innerHTML = `<div class="empty-icon">🔍</div><p>Sin resultados</p><p class="empty-sub">Probá con otra búsqueda o filtro</p>
        <button class="btn-primary" style="margin-top:10px;padding:8px 18px;border-radius:10px;border:none;background:#C8965A;color:#fff;font-weight:700;cursor:pointer" onclick="_clearMovSearch();_setMovFilter('all')">Limpiar</button>`;
    }
    return;
  }

  if (empty) empty.style.display = 'none';

  // Si hay filtro activo, no mostrar separadores de turno (no tienen sentido)
  const items = isFiltering
    ? filteredMovs.map(m => ({ ...m, _type: 'mov' }))
    : [
        ...MOVIMIENTOS.map(m => ({ ...m, _type: 'mov' })),
        ...CIERRES_PARCIALES.map(c => ({ ...c, _type: 'turno' })),
      ];
  items.sort((a, b) => {
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
      ? `${m.metodoPago} $${Math.round(m.monto - (m.monto2||0)).toLocaleString('es-AR')} + ${m.metodoPago2} $${(m.monto2||0).toLocaleString('es-AR')}` // MED-07
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

// ══════════════════════════════════════════
//  BOTTOM SHEET — menú deslizante reutilizable
// ══════════════════════════════════════════
let _sheetItems = [];
let _sheetHideTimer = null; // BUG-FIX: cancelable

function openSheet(title, items) {
  // Cancelar cualquier close pendiente
  if (_sheetHideTimer) { clearTimeout(_sheetHideTimer); _sheetHideTimer = null; }

  _sheetItems = items.filter(it => !it.hide);
  const titleEl = document.getElementById('sheet-title');
  const cont    = document.getElementById('sheet-items');
  const overlay = document.getElementById('sheet-overlay');
  const sheet   = document.getElementById('sheet');
  if (!titleEl || !cont || !overlay || !sheet) return;

  titleEl.textContent = title || '';
  cont.innerHTML = _sheetItems.map((it, i) => {
    if (it.divider) return '<div class="sheet-sep"></div>';
    const cls = 'sheet-item' + (it.danger ? ' sheet-item--danger' : '');
    return `<button class="${cls}" type="button" onclick="_sheetItemClick(${i})">
      <span class="sheet-item-icon">${it.icon || ''}</span>
      <span class="sheet-item-label">${it.label}</span>
      ${it.sub ? `<span class="sheet-item-sub">${it.sub}</span>` : ''}
    </button>`;
  }).join('');

  overlay.classList.remove('hidden');
  sheet.classList.remove('hidden');
  requestAnimationFrame(() => sheet.classList.add('sheet--open'));
}

function closeSheet() {
  const overlay = document.getElementById('sheet-overlay');
  const sheet   = document.getElementById('sheet');
  if (!sheet) return;
  sheet.classList.remove('sheet--open');
  if (_sheetHideTimer) clearTimeout(_sheetHideTimer);
  _sheetHideTimer = setTimeout(() => {
    overlay?.classList.add('hidden');
    sheet.classList.add('hidden');
    _sheetHideTimer = null;
  }, 280);
}

function _sheetItemClick(i) {
  const it = _sheetItems[i];
  if (!it) return;
  closeSheet();
  if (it.onClick) setTimeout(() => it.onClick(), 220);
}

// ── Menú caja (bottom sheet) ──
function toggleCajaMenu() {
  const isOwner = (typeof _cajaIsOwner !== 'undefined' && _cajaIsOwner) || (typeof OWNER_MODE !== 'undefined' && OWNER_MODE);
  openSheet('Caja', [
    { icon: '🌙', label: 'Modo oscuro/claro', onClick: toggleDarkMode },
    { icon: '🔒', label: 'Modo dueño', onClick: openCajaOwnerPin },
    { divider: true },
    { icon: '🧾', label: 'Arqueo de caja', onClick: reopenArqueo },
    { icon: '🔄', label: 'Cierre de turno', sub: 'Cambio de cajero', onClick: openCierreParcialModal },
    { icon: '🔐', label: CIERRE ? 'Cierre registrado' : 'Cerrar caja del día', sub: CIERRE ? `Contado: $${(CIERRE.contado || 0).toLocaleString('es-AR')}` : null, onClick: openCierreModal },
    { icon: '📋', label: 'Reporte del día', sub: 'Compartir por WhatsApp', onClick: openReporteModal },
    { divider: true, hide: !isOwner },
    { icon: '📊', label: 'Historial / Stats', hide: !isOwner, onClick: openCajaHistorial },
    { icon: '📦', label: 'Caja Dueño', hide: !isOwner, onClick: openCajaDueno },
    { icon: '📄', label: 'Reporte financiero', sub: 'Exportar a PDF por período', hide: !isOwner, onClick: () => (typeof openFinanzasReport === 'function') && openFinanzasReport() },
    { divider: true },
    { icon: '🚪', label: 'Cerrar sesión', danger: true, onClick: async () => { await signOut(); location.replace('login.html'); } },
  ]);
}
function closeCajaMenu() { closeSheet(); }
// HIGH-01: listener registrado una sola vez en initApp (ver abajo), no en top-level
let _cajaMenuClickHandler = null;

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
    // Limpiar split antes de cargar datos del movimiento existente
    resetSplit();
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
    resetSplit();
    setMovTipo('ingreso');
    document.getElementById('mov-fi-monto').value = '';
    document.getElementById('mov-fi-desc').value  = '';
    selectMetodo('Efectivo');
    _clearSaleItem();
    _selectedRepairItem = null;
  }

  // Clear any previous error highlights
  document.querySelectorAll('#mov-modal .field-error').forEach(el => el.classList.remove('field-error'));
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
  _movTipo = tipo; // HIGH-02: keep module variable in sync
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
  // MED-10: 300ms en vez de 180ms para que el tap mobile registre antes de que se oculte
  input.addEventListener('blur', () => setTimeout(_hideMovSuggestions, 300));
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

  // Solo autocompletar para INGRESO (ventas) — HIGH-02: use module variable
  if (_movTipo !== 'ingreso') { _hideMovSuggestions(); return; }

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
        // HIGH-05: si no hay precioVenta configurado, mostrar 0 (no el costo) para evitar
        // que el cajero cobre al costo sin darse cuenta
        precio: precioVenta || 0,
        sinPrecio: precioVenta === 0, // flag para avisar en la UI
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
      return `<button type="button" class="mov-sug-item mov-sug-item--repair" data-i="${i}" onpointerdown="event.preventDefault()" onclick="_selectMovSuggestion(${i})">
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
    // HIGH-05: si no tiene precio de venta, avisar al cajero en vez de mostrar el costo
    const precioStr = r.precio > 0
      ? `$${r.precio.toLocaleString('es-AR')}`
      : (r.sinPrecio ? '⚠️ Sin precio' : '');
    return `<button type="button" class="mov-sug-item" data-i="${i}" onpointerdown="event.preventDefault()" onclick="_selectMovSuggestion(${i})">
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
  // HIGH-06: si stock=0 es pedido especial — no limitar cantidad a 1
  const stockMax = item.stock > 0 ? item.stock : 999;

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
      ${item.stock <= 0 ? '<div class="sale-item-warn">⚠️ Sin stock — pedido especial, ingresá la cantidad manualmente</div>' : ''}
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
  const splitOk = !_splitActive || (metodo2.length > 0 && splitAmt > 0 && splitAmt <= monto);

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
  // BUG-FIX: si hubo cierres parciales, el último vendedor es quien sigue de cajero.
  // Sino: localStorage (actualizado en arqueo/turno) > ARQUEO.vendedor como fallback.
  let vendedorActivo = '';
  if (CIERRES_PARCIALES && CIERRES_PARCIALES.length > 0) {
    vendedorActivo = CIERRES_PARCIALES[CIERRES_PARCIALES.length - 1].vendedor || '';
  }
  if (!vendedorActivo) vendedorActivo = localStorage.getItem('cajaVendedor') || ARQUEO?.vendedor || '';
  if (vendedorActivo) data.vendedor = vendedorActivo;

  // ── Item seleccionado del autocomplete (solo en INGRESO y al CREAR, no editar) ──
  let stockUpdate  = null;
  let repairUpdate = null;

  if (_selectedSaleItem && tipo === 'ingreso' && !editingMovId) {
    let qty = Math.max(1, parseInt(document.getElementById('mov-sale-qty')?.value) || 1);
    // LOW-13: cap qty to available stock (only when stock > 0, i.e. not special order)
    if (_selectedSaleItem.stock > 0 && qty > _selectedSaleItem.stock) {
      toast(`Cantidad ajustada al stock disponible (${_selectedSaleItem.stock} u.)`, 'error');
      qty = _selectedSaleItem.stock;
      const qtyInp = document.getElementById('mov-sale-qty');
      if (qtyInp) qtyInp.value = qty;
    }
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
    // CRIT-03: usar increment atómico en vez de valor stale para evitar race conditions
    stockUpdate = { collection, id: _selectedSaleItem.id, stockField, qty };
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
        // CRIT-07: increment atómico para evitar pérdida de seña en escrituras simultáneas
        sena: firebase.firestore.FieldValue.increment(monto),
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
      await db.collection('caja_movimientos').add({
        ...data,
        createdAt: new Date().toISOString(),
        _sourceDevice: (typeof getDeviceId === 'function') ? getDeviceId() : null,
      });

      let toastMsg = 'Movimiento registrado';

      // Actualizar reparación vinculada
      if (repairUpdate) {
        try {
          const { id: repId, ...repFields } = repairUpdate;
          await db.collection('repairs').doc(repId).update(repFields);
          toastMsg = `Movimiento registrado · Reparación ${repairUpdate.cobrado ? 'cobrada ✅' : 'seña actualizada ✅'}`;
        } catch (repErr) {
          console.error('Repair update error:', repErr);
          toast('Movimiento guardado, pero falló la actualización de la reparación', 'error');
        }
      }

      // CRIT-03/04: stock se descuenta siempre (independiente de repairUpdate) con increment atómico
      if (stockUpdate) {
        try {
          await db.collection(stockUpdate.collection).doc(stockUpdate.id).update({
            [stockUpdate.stockField]: firebase.firestore.FieldValue.increment(-stockUpdate.qty)
          });
          toastMsg += ` · stock −${stockUpdate.qty} u.`;
        } catch (stockErr) {
          console.error('Stock decrement error:', stockErr);
          toast('Movimiento guardado, pero falló el descuento de stock', 'error');
        }
      }

      toast(toastMsg + (toastMsg === 'Movimiento registrado' ? '' : ''), 'success');
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
      // Capturar data antes de borrar (para undo + revertir stock)
      const docSnap = await db.collection('caja_movimientos').doc(id).get();
      if (!docSnap.exists) { toast('Movimiento no encontrado', 'error'); return; }
      const movData = docSnap.data();

      await db.collection('caja_movimientos').doc(id).delete();
      closeMovForm();

      // Revertir stock si era venta de inventario (Feature 1)
      let stockReturned = 0;
      let stockColl = null, stockField = null;
      if (movData.itemId && movData.itemSource && movData.itemQty > 0 && movData.tipo === 'ingreso') {
        stockColl  = movData.itemSource === 'producto' ? 'productos' : 'repuestos';
        stockField = movData.itemSource === 'producto' ? 'stock' : 'cantidad';
        try {
          await db.collection(stockColl).doc(movData.itemId).update({
            [stockField]: firebase.firestore.FieldValue.increment(movData.itemQty)
          });
          stockReturned = movData.itemQty;
        } catch (stockErr) { console.error('Stock revert:', stockErr); }
      }

      // Revertir seña si correspondía (simétrico al increment del save)
      let senaReverted = 0;
      if (movData.esSena && movData.repairId && movData.monto > 0) {
        try {
          await db.collection('repairs').doc(movData.repairId).update({
            sena: firebase.firestore.FieldValue.increment(-Number(movData.monto))
          });
          senaReverted = Number(movData.monto);
        } catch {}
      }

      // Toast con undo (Feature 7)
      const parts = ['🗑 Eliminado'];
      if (stockReturned > 0) parts.push(`Stock +${stockReturned} u.`);
      if (senaReverted > 0)  parts.push(`Seña −${fmt(senaReverted).slice(1)}`);
      _showUndoToast({
        msg: parts.join(' · '),
        onUndo: async () => {
          try {
            await db.collection('caja_movimientos').doc(id).set(movData);
            if (stockReturned > 0) {
              await db.collection(stockColl).doc(movData.itemId).update({
                [stockField]: firebase.firestore.FieldValue.increment(-stockReturned)
              });
            }
            if (senaReverted > 0) {
              await db.collection('repairs').doc(movData.repairId).update({
                sena: firebase.firestore.FieldValue.increment(senaReverted)
              });
            }
            toast('↩️ Movimiento restaurado', 'success');
          } catch (undoErr) {
            console.error('Undo:', undoErr);
            toast('No se pudo deshacer', 'error');
          }
        }
      });
    } catch (e) {
      console.error('deleteMov:', e);
      toast('Error al eliminar', 'error');
    }
  }, 'PIN de dueño para eliminar el movimiento');
}

// ── Undo toast (Feature 7) ──
let _undoToastEl = null;
let _undoToastTimer = null;
function _showUndoToast({ msg, onUndo, duration = 6000 }) {
  // Cancelar toast anterior
  if (_undoToastEl) { _undoToastEl.remove(); _undoToastEl = null; }
  if (_undoToastTimer) { clearTimeout(_undoToastTimer); _undoToastTimer = null; }

  const el = document.createElement('div');
  el.className = 'undo-toast';
  el.innerHTML = `
    <span class="undo-toast-msg">${esc(msg)}</span>
    <button class="undo-toast-btn" type="button">↩️ Deshacer</button>
    <div class="undo-toast-bar"></div>
  `;
  document.body.appendChild(el);
  _undoToastEl = el;
  requestAnimationFrame(() => el.classList.add('show'));

  el.querySelector('.undo-toast-btn').addEventListener('click', () => {
    if (_undoToastTimer) clearTimeout(_undoToastTimer);
    el.classList.remove('show');
    setTimeout(() => { el.remove(); if (_undoToastEl === el) _undoToastEl = null; }, 320);
    if (onUndo) onUndo();
  });

  _undoToastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.remove(); if (_undoToastEl === el) _undoToastEl = null; }, 320);
  }, duration);
}

// ══════════════════════════════════════════
//  CIERRE DE CAJA
// ══════════════════════════════════════════

async function loadCierre() {
  const myToken = _dateToken;
  try {
    const doc = await db.collection('caja_cierres').doc(currentDate).get();
    if (myToken !== _dateToken) return; // BUG-FIX: fecha cambió mientras esperábamos
    CIERRE = doc.exists ? doc.data() : null;
  } catch(e) {
    if (myToken !== _dateToken) return;
    CIERRE = null;
  }
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

  // BUG-FIX: confirmación si hay diferencia grande
  if (Math.abs(diferencia) > 500) {
    const signo = diferencia > 0 ? 'sobra' : 'falta';
    const ok = confirm(
      `⚠️ Diferencia importante en el cierre\n\n` +
      `Esperado: $${esperado.toLocaleString('es-AR')}\n` +
      `Contado:  $${contado.toLocaleString('es-AR')}\n` +
      `${signo === 'sobra' ? 'Sobran' : 'Faltan'}: $${Math.abs(diferencia).toLocaleString('es-AR')}\n\n` +
      `¿Estás seguro de querer cerrar con esta diferencia?`
    );
    if (!ok) return;
  }

  // BUG-FIX: si ya hay un cierre del día, confirmar antes de sobreescribir
  if (CIERRE) {
    const ok = confirm(
      `⚠️ Ya hay un cierre registrado para hoy:\n` +
      `   Contado: $${(CIERRE.contado || 0).toLocaleString('es-AR')}\n` +
      `   Diferencia: $${(CIERRE.diferencia || 0).toLocaleString('es-AR')}\n\n` +
      `¿Sobrescribir con el nuevo cierre?`
    );
    if (!ok) return;
  }

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
// LOW-03: esc() defined in utils.js — duplicate removed

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
//  REPORTE DE CIERRE DEL DÍA
// ══════════════════════════════════════════

const REPORTE_WA = '5491140689253';

function _buildReporteText() {
  const fechaStr = new Date(currentDate + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
  });

  const apertura  = ARQUEO?.total || 0;
  const ingMovs   = MOVIMIENTOS.filter(m => m.tipo === 'ingreso');
  const egMovs    = MOVIMIENTOS.filter(m => m.tipo === 'egreso');
  const retiros   = egMovs.filter(m => m.categoria === RETIRO_CAT);
  const gastos    = egMovs.filter(m => m.categoria !== RETIRO_CAT);

  const totalIng  = ingMovs.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const totalEg   = egMovs.reduce((s,  m) => s + (Number(m.monto) || 0), 0);
  const ingEfec   = ingMovs.reduce((s, m) => s + _efecMonto(m), 0);
  const ingDig    = totalIng - ingEfec;
  const egEfec    = egMovs.reduce((s,  m) => s + _efecMonto(m), 0);
  const esperado  = apertura + ingEfec - egEfec;
  const contado   = CIERRE?.contado ?? null;
  const diferencia = contado !== null ? contado - esperado : null;

  // Desglose ingresos por categoría
  const ingPorCat = {};
  ingMovs.forEach(m => {
    const c = m.categoria || 'Otro';
    ingPorCat[c] = (ingPorCat[c] || 0) + (Number(m.monto) || 0);
  });
  // Desglose egresos por categoría (sin retiros)
  const egPorCat = {};
  gastos.forEach(m => {
    const c = m.categoria || 'Otro';
    egPorCat[c] = (egPorCat[c] || 0) + (Number(m.monto) || 0);
  });
  const totalRetiros = retiros.reduce((s, m) => s + (Number(m.monto) || 0), 0);

  const pad = (lbl, val, w = 22) => {
    const l = String(lbl);
    const v = String(val);
    return l + ' '.repeat(Math.max(1, w - l.length)) + v;
  };
  const fmt2 = n => '$' + Math.round(n).toLocaleString('es-AR');
  const line = '─'.repeat(30);

  let txt = '';
  txt += `🔐 *Cierre del día — TechPoint*\n`;
  txt += `📅 ${fechaStr}\n`;
  txt += `${line}\n`;
  txt += `\n💼 *RESUMEN*\n`;
  txt += pad('📂 Apertura:', fmt2(apertura)) + '\n';
  txt += pad('📈 Ingresos:', fmt2(totalIng)) + '\n';
  if (ingDig > 0 && ingEfec > 0) {
    txt += pad('   💵 Efectivo:', fmt2(ingEfec)) + '\n';
    txt += pad('   💳 Digital:', fmt2(ingDig)) + '\n';
  } else if (ingDig > 0) {
    txt += pad('   💳 Digital:', fmt2(ingDig)) + '\n';
  }
  if (totalEg > 0) txt += pad('📉 Egresos/Gastos:', fmt2(totalEg)) + '\n';
  if (totalRetiros > 0) txt += pad('↩️ Retiros:', fmt2(totalRetiros)) + '\n';
  txt += `${line}\n`;
  txt += pad('💰 Esperado en caja:', fmt2(esperado)) + '\n';
  if (contado !== null) {
    txt += pad('🧮 Contado:', fmt2(contado)) + '\n';
    if (diferencia === 0) {
      txt += pad('✅ Diferencia:', '$0 ✅') + '\n';
    } else {
      const difSign = diferencia > 0 ? '+' : '';
      txt += pad('⚠️ Diferencia:', difSign + fmt2(diferencia)) + '\n';
    }
  }

  // Desglose ingresos
  const catIng = Object.entries(ingPorCat).sort((a, b) => b[1] - a[1]);
  if (catIng.length > 0) {
    txt += `\n📦 *INGRESOS POR CATEGORÍA*\n`;
    catIng.forEach(([c, v]) => { txt += pad(`• ${c}:`, fmt2(v)) + '\n'; });
  }

  // Desglose egresos/gastos
  const catEg = Object.entries(egPorCat).sort((a, b) => b[1] - a[1]);
  if (catEg.length > 0) {
    txt += `\n💸 *GASTOS / EGRESOS*\n`;
    catEg.forEach(([c, v]) => { txt += pad(`• ${c}:`, fmt2(v)) + '\n'; });
  }

  // Cierres parciales
  if (CIERRES_PARCIALES.length > 0) {
    txt += `\n🔄 *TURNOS*\n`;
    CIERRES_PARCIALES.forEach(cp => {
      const h = cp.periodoDesdeHora ? `${cp.periodoDesdeHora}` : '';
      txt += `• ${cp.vendedor || '—'} — ${h} → +${fmt2(cp.ingresosPeriodo || 0)}\n`;
    });
  }

  txt += `\n${line}\n`;
  txt += `_TechPoint · generado automáticamente_`;
  return txt;
}

function openReporteModal() {
  const txt = _buildReporteText();
  const pre = document.getElementById('reporte-texto');
  if (pre) pre.textContent = txt;

  const waBtn = document.getElementById('reporte-wa-btn');
  if (waBtn) {
    waBtn.href = `https://wa.me/${REPORTE_WA}?text=${encodeURIComponent(txt)}`;
  }

  document.getElementById('reporte-overlay').classList.remove('hidden');
  document.getElementById('reporte-modal').classList.remove('hidden');
}

function closeReporteModal() {
  document.getElementById('reporte-overlay').classList.add('hidden');
  document.getElementById('reporte-modal').classList.add('hidden');
}

function _reporteCopiar() {
  const txt = document.getElementById('reporte-texto')?.textContent || '';
  navigator.clipboard.writeText(txt)
    .then(() => toast('📋 Copiado al portapapeles', 'success'))
    .catch(() => toast('No se pudo copiar — copiá el texto manualmente', 'error'));
}

// ══════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════

requireAuth().then(u => { if (u) showApp(); });
