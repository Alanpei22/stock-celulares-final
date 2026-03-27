// ══════════════════════════════════════════
//  MODO DUEÑO (caja)
// ══════════════════════════════════════════

let _cajaOwnerBuf = '';
let _cajaOwnerTimer = null;
let _cajaIsOwner   = false;

function openCajaOwnerPin() {
  if (_cajaIsOwner) {
    lockCajaOwner(); return;
  }
  _cajaOwnerBuf = '';
  _updateCajaOwnerDots();
  document.getElementById('caja-owner-error').textContent = '';
  document.getElementById('caja-owner-overlay').classList.remove('hidden');
  document.getElementById('caja-owner-modal').classList.remove('hidden');
}

function closeCajaOwnerPin() {
  document.getElementById('caja-owner-overlay').classList.add('hidden');
  document.getElementById('caja-owner-modal').classList.add('hidden');
  _cajaOwnerBuf = '';
}

function cajaOwnerPin(d) {
  if (_cajaOwnerBuf.length >= 4) return;
  _cajaOwnerBuf += d;
  _updateCajaOwnerDots();
  if (_cajaOwnerBuf.length === 4) setTimeout(submitCajaOwnerPin, 200);
}

function cajaOwnerPinBack() {
  _cajaOwnerBuf = _cajaOwnerBuf.slice(0, -1);
  _updateCajaOwnerDots();
}

function cajaOwnerPinClear() {
  _cajaOwnerBuf = '';
  _updateCajaOwnerDots();
  document.getElementById('caja-owner-error').textContent = '';
}

function _updateCajaOwnerDots() {
  const dots = document.querySelectorAll('#caja-owner-dots span');
  dots.forEach((dot, i) => dot.classList.toggle('filled', i < _cajaOwnerBuf.length));
}

async function submitCajaOwnerPin() {
  const pin = _cajaOwnerBuf;
  try {
    const doc = await db.collection('config').doc('owner').get();
    let storedPin = doc.exists ? doc.data().pin : null;
    if (!storedPin) {
      await db.collection('config').doc('owner').set({ pin });
      storedPin = pin;
    }
    if (pin === storedPin) {
      _cajaIsOwner = true;
      document.body.classList.add('owner-mode');
      document.getElementById('caja-owner-btn').textContent = '🔓';
      clearTimeout(_cajaOwnerTimer);
      _cajaOwnerTimer = setTimeout(lockCajaOwner, 15 * 60 * 1000);
      closeCajaOwnerPin();
      toast('Modo dueño activado', 'success');
    } else {
      document.getElementById('caja-owner-error').textContent = 'PIN incorrecto';
      _cajaOwnerBuf = '';
      _updateCajaOwnerDots();
    }
  } catch (e) {
    document.getElementById('caja-owner-error').textContent = 'Error de conexion';
    _cajaOwnerBuf = '';
    _updateCajaOwnerDots();
  }
}

function lockCajaOwner() {
  _cajaIsOwner = false;
  document.body.classList.remove('owner-mode');
  document.getElementById('caja-owner-btn').textContent = '🔒';
  clearTimeout(_cajaOwnerTimer);
}

// ══════════════════════════════════════════
//  HISTORIAL + STATS DE CAJA (owner)
// ══════════════════════════════════════════

let _cajHistTab = 'sem';

function openCajaHistorial() {
  if (!_cajaIsOwner) {
    openCajaOwnerPin();
    return;
  }
  _cajHistTab = 'sem';
  document.getElementById('cht-sem').classList.add('caja-hist-tab--active');
  document.getElementById('cht-mes').classList.remove('caja-hist-tab--active');
  document.getElementById('cht-stats').classList.remove('caja-hist-tab--active');
  document.getElementById('caja-hist-overlay').classList.remove('hidden');
  document.getElementById('caja-hist-modal').classList.remove('hidden');
  loadHistorialData('sem');
}

function closeCajaHistorial() {
  document.getElementById('caja-hist-overlay').classList.add('hidden');
  document.getElementById('caja-hist-modal').classList.add('hidden');
}

function switchHistTab(tab) {
  _cajHistTab = tab;
  ['sem','mes','stats'].forEach(t => {
    document.getElementById('cht-' + t).classList.toggle('caja-hist-tab--active', t === tab);
  });
  loadHistorialData(tab);
}

async function loadHistorialData(tab) {
  const body = document.getElementById('caja-hist-body');
  body.innerHTML = '<p style="text-align:center;padding:20px;color:var(--t2)">Cargando...</p>';

  const today = new Date().toISOString().slice(0, 10);
  let desde;
  if (tab === 'sem') {
    const d = new Date(); d.setDate(d.getDate() - 6);
    desde = d.toISOString().slice(0, 10);
  } else if (tab === 'mes') {
    const d = new Date(); d.setDate(1);
    desde = d.toISOString().slice(0, 10);
  }

  try {
    if (tab === 'stats') {
      const d30 = new Date(); d30.setDate(d30.getDate() - 29);
      const snap = await db.collection('caja_movimientos')
        .where('fecha', '>=', d30.toISOString().slice(0, 10))
        .where('fecha', '<=', today).get();
      const movs = snap.docs.map(d => d.data());
      body.innerHTML = buildCajaStatsHTML(movs);
    } else {
      const snap = await db.collection('caja_movimientos')
        .where('fecha', '>=', desde).where('fecha', '<=', today).get();
      const movs = snap.docs.map(d => d.data());

      const arqueoSnap = await db.collection('caja_arqueos')
        .where('fecha', '>=', desde).where('fecha', '<=', today).get();
      const arqueos = {};
      arqueoSnap.docs.forEach(d => { const data = d.data(); arqueos[data.fecha] = data.total; });

      body.innerHTML = buildHistorialHTML(movs, arqueos, desde, today);
    }
  } catch (e) {
    body.innerHTML = '<p style="text-align:center;padding:20px;color:#ef4444">Error al cargar</p>';
  }
}

function buildHistorialHTML(movs, arqueos, desde, today) {
  const byDate = {};
  movs.forEach(m => {
    if (!byDate[m.fecha]) byDate[m.fecha] = [];
    byDate[m.fecha].push(m);
  });

  const dates = [];
  const d = new Date(today + 'T12:00:00');
  const dStart = new Date(desde + 'T12:00:00');
  while (d >= dStart) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
  }

  let totalIngresos = 0, totalEgresos = 0;
  const rows = dates.map(fecha => {
    const ms = byDate[fecha] || [];
    const ing = ms.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (Number(m.monto) || 0), 0);
    const eg  = ms.filter(m => m.tipo === 'egreso').reduce((s, m)  => s + (Number(m.monto) || 0), 0);
    const neto = ing - eg;
    totalIngresos += ing; totalEgresos += eg;
    const aper = arqueos[fecha] != null ? fmt(arqueos[fecha]) : '--';
    const fmtFecha = new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday:'short', day:'2-digit', month:'short' });
    return '<div class="hist-day-row" onclick="goToDate(\'' + fecha + '\')">' +
      '<div class="hist-day-info">' +
      '<span class="hist-day-lbl">' + fmtFecha + '</span>' +
      '<span class="hist-day-aper">Apertura: ' + aper + '</span>' +
      '</div>' +
      '<div class="hist-day-nums">' +
      '<span class="hist-day-ing">+' + fmt(ing) + '</span>' +
      '<span class="hist-day-eg">-' + fmt(eg) + '</span>' +
      '<span class="hist-day-neto ' + (neto >= 0 ? 'neto-pos' : 'neto-neg') + '">' + (neto >= 0 ? '+' : '') + fmt(neto) + '</span>' +
      '</div></div>';
  }).join('');

  const totalNeto = totalIngresos - totalEgresos;
  return '<div class="hist-totales">' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Total ingresos</span><span class="hist-tot-val hist-day-ing">+' + fmt(totalIngresos) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Total egresos</span><span class="hist-tot-val hist-day-eg">-' + fmt(totalEgresos) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Neto</span><span class="hist-tot-val ' + (totalNeto >= 0 ? 'neto-pos' : 'neto-neg') + '">' + fmt(totalNeto) + '</span></div>' +
    '</div>' + rows;
}

function buildCajaStatsHTML(movs) {
  const ingresos = movs.filter(m => m.tipo === 'ingreso');
  const egresos  = movs.filter(m => m.tipo === 'egreso');
  const totalIng = ingresos.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const totalEg  = egresos.reduce((s, m) => s + (Number(m.monto) || 0), 0);

  const byMetodo = {};
  ingresos.forEach(m => {
    const met = m.metodoPago || 'Efectivo';
    byMetodo[met] = (byMetodo[met] || 0) + (Number(m.monto) || 0);
  });
  const metRanking = Object.entries(byMetodo).sort((a, b) => b[1] - a[1]);

  const byCat = {};
  ingresos.forEach(m => {
    const cat = m.categoria || 'Otro';
    byCat[cat] = (byCat[cat] || 0) + (Number(m.monto) || 0);
  });
  const catRanking = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const byEgCat = {};
  egresos.forEach(m => {
    const cat = m.categoria || 'Otro';
    byEgCat[cat] = (byEgCat[cat] || 0) + (Number(m.monto) || 0);
  });
  const egCatRanking = Object.entries(byEgCat).sort((a, b) => b[1] - a[1]);

  function metItem(met, val) {
    const pct = totalIng > 0 ? Math.round(val * 100 / totalIng) : 0;
    return '<div class="stats-met-row">' +
      '<span class="stats-met-lbl">' + esc(met) + '</span>' +
      '<div class="stats-met-bar-wrap"><div class="stats-met-bar" style="width:' + pct + '%"></div></div>' +
      '<span class="stats-met-val">' + fmt(val) + ' (' + pct + '%)</span>' +
      '</div>';
  }
  function catItem(cat, val, cls) {
    return '<div class="stats-met-row">' +
      '<span class="stats-met-lbl">' + esc(cat) + '</span>' +
      '<span class="stats-met-val ' + cls + '">' + fmt(val) + '</span>' +
      '</div>';
  }

  const metItems   = metRanking.map(([m, v]) => metItem(m, v)).join('') || '<p class="stats-empty">Sin datos</p>';
  const catItems   = catRanking.map(([c, v]) => catItem(c, v, 'hist-day-ing')).join('') || '<p class="stats-empty">Sin datos</p>';
  const egCatItems = egCatRanking.map(([c, v]) => catItem(c, v, 'hist-day-eg')).join('') || '<p class="stats-empty">Sin datos</p>';

  return '<div class="hist-totales">' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Ingresos (30d)</span><span class="hist-tot-val hist-day-ing">+' + fmt(totalIng) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Egresos (30d)</span><span class="hist-tot-val hist-day-eg">-' + fmt(totalEg) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Neto</span><span class="hist-tot-val ' + (totalIng-totalEg >= 0 ? 'neto-pos' : 'neto-neg') + '">' + fmt(totalIng-totalEg) + '</span></div>' +
    '</div>' +
    '<h4 class="stats-section-title">Metodos de pago (ingresos)</h4>' + metItems +
    '<h4 class="stats-section-title">Categorias de ingreso</h4>' + catItems +
    '<h4 class="stats-section-title">Categorias de egreso</h4>' + egCatItems;
}

function goToDate(fecha) {
  closeCajaHistorial();
  setDate(fecha);
}
