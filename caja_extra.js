// ══════════════════════════════════════════
//  MODO DUEÑO (caja)
// ══════════════════════════════════════════

let _cajaOwnerBuf = '';
let _cajaOwnerTimer = null;
let _cajaIsOwner   = false;
let _cajaOwnerCallback = null; // callback para acciones protegidas (borrar mov, etc.)

// ── Retiros del dueño en los totales del historial ──────────
// Un retiro saca plata del cajón, pero NO es un gasto del negocio: es plata
// que el taller ya ganó y el dueño se lleva. Si se cuenta como egreso, el
// total del día/mes/año queda más bajo de lo que en realidad se ganó.
// (caja.js define RETIRO_CAT igual; va aparte para no depender del orden en
//  que el navegador cargue los scripts.)
const RETIRO_CAT_HIST = 'Retiro dueño';
function _esRetiro(m)  { return m.categoria === RETIRO_CAT_HIST; }
function _sumGastos(ms) {
  return ms.reduce((s, m) => s + (m.tipo === 'egreso' && !_esRetiro(m) ? (Number(m.monto) || 0) : 0), 0);
}
function _sumRetiros(ms) {
  return ms.reduce((s, m) => s + (m.tipo === 'egreso' && _esRetiro(m) ? (Number(m.monto) || 0) : 0), 0);
}
// Renglón "Retiros" para el bloque de totales; vacío si no hubo ninguno.
function _totRetiroItem(total) {
  if (!(total > 0)) return '';
  return '<div class="hist-tot-item"><span class="hist-tot-lbl">🏧 Retiros dueño</span>' +
    '<span class="hist-tot-val desglose-num--retiro">' + fmt(total) + '</span></div>';
}

// Los 15 minutos cuentan desde la última vez que hiciste algo de dueño, no
// desde que pusiste el PIN. Es para que una pantalla abandonada se bloquee,
// no para cortarte a la mitad de una carga de inventario: el campo del costo
// vive adentro de `.owner-only` y, al apagarse, desaparece sin avisar.
function _cajaOwnerRenovar() {
  if (!_cajaIsOwner) return;
  clearTimeout(_cajaOwnerTimer);
  _cajaOwnerTimer = setTimeout(lockCajaOwner, 15 * 60 * 1000);
}

// Y "algo de dueño" es cualquier toque o tecla: antes solo renovaban algunas
// acciones del inventario, y el resto de la caja se cortaba a los 15 minutos
// aunque la estuvieras usando (igual que pasó en la lista de costos de la
// app, donde se perdieron 21 costos). Se re-arma como mucho cada 30 segundos.
let _cajaOwnerUltimoUso = 0;
function _cajaOwnerRenovarPorUso() {
  if (!_cajaIsOwner) return;
  const ahora = Date.now();
  if (ahora - _cajaOwnerUltimoUso < 30 * 1000) return;
  _cajaOwnerUltimoUso = ahora;
  _cajaOwnerRenovar();
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  ['pointerdown', 'keydown', 'input'].forEach(ev =>
    document.addEventListener(ev, _cajaOwnerRenovarPorUso, { capture: true, passive: true }));
}

function openCajaOwnerPin() {
  if (_cajaIsOwner) {
    lockCajaOwner(); return;
  }
  // El modo dueño destapa costos y ganancias: una cuenta de empleado no lo
  // tiene, aunque alguien haya mirado el PIN por encima del hombro.
  if (typeof tpFrenarEmpleado === 'function' && tpFrenarEmpleado('El modo dueño')) return;
  _cajaOwnerCallback = null;
  _cajaOwnerBuf = '';
  _updateCajaOwnerDots();
  document.getElementById('caja-owner-error').textContent = '';
  const sub = document.getElementById('caja-owner-sub');
  if (sub) sub.textContent = 'Ingresá el PIN de dueño';
  document.getElementById('caja-owner-overlay').classList.remove('hidden');
  document.getElementById('caja-owner-modal').classList.remove('hidden');
}

// Usar cuando se necesita PIN para una acción puntual (sin entrar en modo dueño)
function requireCajaOwnerPin(onSuccess, msg) {
  if (typeof tpFrenarEmpleado === 'function' && tpFrenarEmpleado('El modo dueño')) return;
  _cajaOwnerCallback = onSuccess;
  _cajaOwnerBuf = '';
  _updateCajaOwnerDots();
  document.getElementById('caja-owner-error').textContent = '';
  const sub = document.getElementById('caja-owner-sub');
  if (sub) { sub.textContent = msg || 'Ingresá el PIN de dueño para continuar'; }
  document.getElementById('caja-owner-overlay').classList.remove('hidden');
  document.getElementById('caja-owner-modal').classList.remove('hidden');
}

function closeCajaOwnerPin() {
  document.getElementById('caja-owner-overlay').classList.add('hidden');
  document.getElementById('caja-owner-modal').classList.add('hidden');
  _cajaOwnerBuf = '';
  _cajaOwnerCallback = null;
  hidePinResetConfirm('caja');
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
    // SEGURIDAD: verificación con hash (PBKDF2) + migración automática de PIN legacy
    const result = await verifyOwnerPin(db, pin);

    if (result.ok) {
      // ¿Hay una acción puntual esperando PIN?
      if (_cajaOwnerCallback) {
        const cb = _cajaOwnerCallback;
        _cajaOwnerCallback = null;
        closeCajaOwnerPin();
        cb();
        return;
      }
      // Entrar a modo dueño normal
      _cajaIsOwner = true;
      document.body.classList.add('owner-mode');
      const _ob1 = document.getElementById('caja-owner-btn'); if (_ob1) _ob1.textContent = '🔓';
      _cajaOwnerRenovar();
      closeCajaOwnerPin();
      toast('Modo dueño activado', 'success');
    } else {
      document.getElementById('caja-owner-error').textContent = 'PIN incorrecto';
      _cajaOwnerBuf = '';
      _updateCajaOwnerDots();
    }
  } catch (e) {
    console.error('submitCajaOwnerPin error:', e);
    document.getElementById('caja-owner-error').textContent = 'Error: ' + (e.message || e.code || e);
    _cajaOwnerBuf = '';
    _updateCajaOwnerDots();
  }
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
    closeCajaOwnerPin();
    toast('PIN reseteado. El próximo PIN que ingreses quedará guardado.', 'success');
  } catch(e) {
    toast('Error al resetear PIN', 'error');
  }
}

function lockCajaOwner() {
  _cajaIsOwner = false;
  document.body.classList.remove('owner-mode');
  const _ob2 = document.getElementById('caja-owner-btn'); if (_ob2) _ob2.textContent = '🔒';
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
  ['sem','mes','anual','stats'].forEach(t => {
    document.getElementById('cht-' + t).classList.toggle('caja-hist-tab--active', t === tab);
  });
  loadHistorialData(tab);
}

// Devuelve fecha Argentina + offset de días como 'YYYY-MM-DD'
function _arOffset(days) {
  const today = _todayAR();
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── CUPO: el historial se paga caro ───────────────────────────
// Cada pestaña hace un .get() sobre caja_movimientos y Firebase cobra por
// DOCUMENTO leído, no por consulta. "Anual" son todos los movimientos del
// año: con 50 por día son ~18.000 lecturas de las 50.000 gratis diarias, en
// un solo toque. Antes cada vez que ibas y volvías de pestaña se pagaba de
// nuevo. Ahora el resultado queda guardado unos minutos: mirar el historial
// tres veces seguidas cuesta una sola consulta.
const _HIST_CACHE_MS = 5 * 60 * 1000;
const _histCache = {};   // tab → { t, html }

async function loadHistorialData(tab, forzar) {
  const body = document.getElementById('caja-hist-body');

  const cache = _histCache[tab];
  if (!forzar && cache && (Date.now() - cache.t) < _HIST_CACHE_MS) {
    body.innerHTML = cache.html;
    return;
  }
  body.innerHTML = '<p style="text-align:center;padding:20px;color:var(--t2)">Cargando...</p>';

  const today = _todayAR();
  let desde;
  if (tab === 'sem') {
    desde = _arOffset(-6);
  } else if (tab === 'mes') {
    // Primer día del mes actual en horario AR
    desde = today.slice(0, 7) + '-01';
  }

  try {
    if (tab === 'anual') {
      const snap = await db.collection('caja_movimientos')
        .where('fecha', '>=', _arOffset(-364))
        .where('fecha', '<=', today).get();
      const movs = snap.docs.map(d => d.data());
      _histGuardar(tab, buildCajaAnualHTML(movs));
      return;
    }
    if (tab === 'stats') {
      const snap = await db.collection('caja_movimientos')
        .where('fecha', '>=', _arOffset(-29))
        .where('fecha', '<=', today).get();
      const movs = snap.docs.map(d => d.data());
      _histGuardar(tab, buildCajaStatsHTML(movs));
    } else {
      const snap = await db.collection('caja_movimientos')
        .where('fecha', '>=', desde).where('fecha', '<=', today).get();
      const movs = snap.docs.map(d => d.data());

      const arqueoSnap = await db.collection('caja_arqueos')
        .where('fecha', '>=', desde).where('fecha', '<=', today).get();
      const arqueos = {};
      arqueoSnap.docs.forEach(d => { const data = d.data(); arqueos[data.fecha] = data.total; });

      // Período anterior (misma cantidad de días)
      let prevMovs = [];
      if (tab === 'mes') {
        // Mes anterior: del 1 al último día del mes previo
        const dPrevEnd = new Date(desde + 'T12:00:00Z');
        dPrevEnd.setUTCDate(0); // último día del mes anterior
        const prevHasta = dPrevEnd.toISOString().slice(0, 10);
        const prevDesde = prevHasta.slice(0, 7) + '-01';
        const prevSnap = await db.collection('caja_movimientos')
          .where('fecha', '>=', prevDesde).where('fecha', '<=', prevHasta).get();
        prevMovs = prevSnap.docs.map(d => d.data());
      }

      _histGuardar(tab, buildHistorialHTML(movs, arqueos, desde, today, prevMovs, tab));
    }
  } catch (e) {
    body.innerHTML = '<p style="text-align:center;padding:20px;color:#ef4444">Error al cargar</p>';
  }
}

// Se llama desde caja.js cuando cambian los movimientos del día: lo guardado
// dejó de ser cierto y la próxima vez se vuelve a consultar.
function _histInvalidar() {
  Object.keys(_histCache).forEach(k => delete _histCache[k]);
}

// Pinta y deja el resultado en el cache de la sesión.
function _histGuardar(tab, html) {
  _histCache[tab] = { t: Date.now(), html };
  const body = document.getElementById('caja-hist-body');
  if (body) body.innerHTML = html;
}

function buildHistorialHTML(movs, arqueos, desde, today, prevMovs, tab) {
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

  let totalIngresos = 0, totalEgresos = 0, totalRetiros = 0, diasActivos = 0;
  const rows = dates.map(fecha => {
    const ms = byDate[fecha] || [];
    const ing = ms.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (Number(m.monto) || 0), 0);
    const eg  = _sumGastos(ms);
    const ret = _sumRetiros(ms);
    const neto = ing - eg;
    if (ing > 0 || eg > 0 || ret > 0) diasActivos++;
    totalIngresos += ing; totalEgresos += eg; totalRetiros += ret;
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
  const promDiario = diasActivos > 0 ? Math.round(totalIngresos / diasActivos) : 0;

  // Comparación mes anterior
  let compHTML = '';
  if (tab === 'mes' && prevMovs && prevMovs.length > 0) {
    const prevIng = prevMovs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (Number(m.monto) || 0), 0);
    if (prevIng > 0 && totalIngresos > 0) {
      const pct = Math.round(((totalIngresos - prevIng) / prevIng) * 100);
      const cls = pct >= 0 ? 'neto-pos' : 'neto-neg';
      compHTML = '<div class="hist-comp-row">' +
        '<span class="hist-comp-lbl">vs mes anterior</span>' +
        '<span class="hist-comp-val ' + cls + '">' + (pct >= 0 ? '+' : '') + pct + '%</span>' +
        '<span class="hist-comp-prev">(' + fmt(prevIng) + ')</span>' +
        '</div>';
    }
  }

  return '<div class="hist-totales">' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Total ingresos</span><span class="hist-tot-val hist-day-ing">+' + fmt(totalIngresos) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Total egresos</span><span class="hist-tot-val hist-day-eg">-' + fmt(totalEgresos) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Neto</span><span class="hist-tot-val ' + (totalNeto >= 0 ? 'neto-pos' : 'neto-neg') + '">' + fmt(totalNeto) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Prom. diario</span><span class="hist-tot-val">' + fmt(promDiario) + '</span></div>' +
    _totRetiroItem(totalRetiros) +
    '</div>' + compHTML + rows;
}

function buildCajaStatsHTML(movs) {
  const ingresos = movs.filter(m => m.tipo === 'ingreso');
  const egresos  = movs.filter(m => m.tipo === 'egreso' && !_esRetiro(m));
  const totalIng = ingresos.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const totalEg  = egresos.reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const totalRet = _sumRetiros(movs);

  const byMetodo = {};
  ingresos.forEach(m => {
    const met = metodoCanonico(m.metodoPago);
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

  const fechas30 = [...new Set(movs.map(m => m.fecha))];
  const diasActivos30 = fechas30.filter(f => movs.filter(m => m.fecha === f && m.tipo === 'ingreso').length > 0).length;
  const prom30 = diasActivos30 > 0 ? Math.round(totalIng / diasActivos30) : 0;

  return '<div class="hist-totales">' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Ingresos (30d)</span><span class="hist-tot-val hist-day-ing">+' + fmt(totalIng) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Egresos (30d)</span><span class="hist-tot-val hist-day-eg">-' + fmt(totalEg) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Neto</span><span class="hist-tot-val ' + (totalIng-totalEg >= 0 ? 'neto-pos' : 'neto-neg') + '">' + fmt(totalIng-totalEg) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Prom. diario</span><span class="hist-tot-val">' + fmt(prom30) + '</span></div>' +
    _totRetiroItem(totalRet) +
    '</div>' +
    '<h4 class="stats-section-title">Metodos de pago (ingresos)</h4>' + metItems +
    '<h4 class="stats-section-title">Categorias de ingreso</h4>' + catItems +
    '<h4 class="stats-section-title">Categorias de egreso</h4>' + egCatItems;
}

function goToDate(fecha) {
  closeCajaHistorial();
  setDate(fecha);
}

function buildCajaAnualHTML(movs) {
  // Group by YYYY-MM
  const byMonth = {};
  movs.forEach(m => {
    const ym = m.fecha ? m.fecha.slice(0, 7) : null;
    if (!ym) return;
    if (!byMonth[ym]) byMonth[ym] = [];
    byMonth[ym].push(m);
  });

  // Build sorted list of months (descending)
  const months = Object.keys(byMonth).sort().reverse();

  let totalIng = 0, totalEg = 0, totalRet = 0;
  const rows = months.map((ym, idx) => {
    const ms = byMonth[ym];
    const ing = ms.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (Number(m.monto) || 0), 0);
    const eg  = _sumGastos(ms);
    const neto = ing - eg;
    totalIng += ing; totalEg += eg; totalRet += _sumRetiros(ms);

    // Compare with previous month in array (idx+1 is the prior month)
    let compHTML = '';
    const prevYm = months[idx + 1];
    if (prevYm) {
      const prevMs = byMonth[prevYm];
      const prevIng = prevMs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (Number(m.monto) || 0), 0);
      if (prevIng > 0 && ing > 0) {
        const pct = Math.round(((ing - prevIng) / prevIng) * 100);
        const cls = pct >= 0 ? 'neto-pos' : 'neto-neg';
        compHTML = '<span class="hist-anual-cmp ' + cls + '">' + (pct >= 0 ? '▲' : '▼') + Math.abs(pct) + '%</span>';
      }
    }

    const label = new Date(ym + '-15').toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    const labelCap = label.charAt(0).toUpperCase() + label.slice(1);

    return '<div class="hist-day-row">' +
      '<div class="hist-day-info">' +
      '<span class="hist-day-lbl">' + labelCap + '</span>' +
      compHTML +
      '</div>' +
      '<div class="hist-day-nums">' +
      '<span class="hist-day-ing">+' + fmt(ing) + '</span>' +
      '<span class="hist-day-eg">-' + fmt(eg) + '</span>' +
      '<span class="hist-day-neto ' + (neto >= 0 ? 'neto-pos' : 'neto-neg') + '">' + (neto >= 0 ? '+' : '') + fmt(neto) + '</span>' +
      '</div></div>';
  }).join('');

  const totalNeto = totalIng - totalEg;

  if (months.length === 0) {
    return '<p style="text-align:center;padding:20px;color:var(--t2)">Sin movimientos en el último año</p>';
  }

  return '<div class="hist-totales">' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Total ingresos</span><span class="hist-tot-val hist-day-ing">+' + fmt(totalIng) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Total egresos</span><span class="hist-tot-val hist-day-eg">-' + fmt(totalEg) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Neto anual</span><span class="hist-tot-val ' + (totalNeto >= 0 ? 'neto-pos' : 'neto-neg') + '">' + (totalNeto >= 0 ? '+' : '') + fmt(totalNeto) + '</span></div>' +
    '<div class="hist-tot-item"><span class="hist-tot-lbl">Prom. mensual</span><span class="hist-tot-val">' + fmt(months.length > 0 ? Math.round(totalIng / months.length) : 0) + '</span></div>' +
    _totRetiroItem(totalRet) +
    '</div>' + rows;
}

// ══════════════════════════════════════════
//  CAJA DUEÑO
// ══════════════════════════════════════════
// Alan (09/11): "hacer una caja mía aparte con lo que guardo del local, gasto
// del local de lo que se guardó, y llevar cuentas de las cuentas de
// transferencia y MercadoPago". La caja dueño ya existía (un solo saldo, en
// efectivo). Ahora tiene TRES cuentas: lo que guardás en efectivo, el banco
// (donde caen las transferencias) y MercadoPago. Cada movimiento dice de qué
// cuenta es; los viejos, sin cuenta, son efectivo (era lo único que había).
//   ingreso / egreso → suman o restan en su cuenta (y en el total)
//   pase   → de una cuenta a otra (sacar del banco, pasar MP al banco…):
//            el total no cambia
//   ajuste → "en el banco hay $X": corrige la cuenta a lo real (comisiones
//            de MP, intereses…). No cuenta como ingreso ni como gasto.
// La misma cuenta la hace el bot de Telegram (api/_telegram-gastos.js).
const CD_CUENTAS = {
  efectivo: { lbl: 'Efectivo',    ico: '💵' },
  banco:    { lbl: 'Banco',       ico: '🏦' },
  mp:       { lbl: 'MercadoPago', ico: '📱' },
};
function cdCuenta(c) { return CD_CUENTAS[c] ? c : 'efectivo'; }

// Estilos de las cuentas: viajan con el JS (el CSS se sirve del caché)
function _cdEstilos() {
  if (typeof document === 'undefined' || !document.head || document.getElementById('cd-estilos')) return;
  const st = document.createElement('style');
  st.id = 'cd-estilos';
  st.textContent = `
.cd-cuentas{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0}
.cd-cuenta{display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 6px;border-radius:12px;border:1.5px solid var(--border,rgba(128,128,128,.25));background:var(--card,#fff);color:inherit;cursor:pointer;font-family:inherit}
.cd-cuenta-ico{font-size:20px}.cd-cuenta-lbl{font-size:12px;opacity:.75;font-weight:600}
.cd-cuenta b{font-size:15px}.cd-cuenta small{font-size:10px;opacity:.5}
.cd-acciones{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.cd-btn-pase{padding:.6rem;border-radius:14px;border:0;background:#DBEAFE;color:#1E40AF;font-weight:700;font-size:.88rem;cursor:pointer}
.cd-add-lbl{font-size:12px;font-weight:700;opacity:.7;margin:6px 0 4px}
.cd-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
.cd-chip{padding:7px 10px;border-radius:999px;border:2px solid rgba(128,128,128,.3);background:none;color:inherit;font-size:13px;font-weight:700;cursor:pointer}
.cd-chip.on{border-color:#25D366;background:rgba(37,211,102,.12)}`;
  document.head.appendChild(st);
}

// Cuánto mueve un movimiento: { saldo, ingresos, egresos, cuentas: {...} }
function cdEfecto(m) {
  const monto = Number(m && m.monto) || 0;
  const c = cdCuenta(m && m.cuenta);
  const d = { saldo: 0, ingresos: 0, egresos: 0, cuentas: { efectivo: 0, banco: 0, mp: 0 } };
  const tipo = m && m.tipo;
  if (tipo === 'egreso') { d.saldo = -monto; d.egresos = monto; d.cuentas[c] -= monto; }
  else if (tipo === 'pase') { d.cuentas[c] -= monto; d.cuentas[cdCuenta(m.cuentaDestino)] += monto; }
  else if (tipo === 'ajuste') { d.saldo = monto; d.cuentas[c] += monto; }
  else { d.saldo = monto; d.ingresos = monto; d.cuentas[c] += monto; }
  return d;
}
function cdSumar(movs) {
  const t = { saldo: 0, ingresos: 0, egresos: 0, cuentas: { efectivo: 0, banco: 0, mp: 0 } };
  (movs || []).forEach(m => {
    const d = cdEfecto(m);
    t.saldo += d.saldo; t.ingresos += d.ingresos; t.egresos += d.egresos;
    Object.keys(t.cuentas).forEach(k => { t.cuentas[k] += d.cuentas[k]; });
  });
  return t;
}
// El saldo guardado antes de las cuentas: todo era efectivo
function cdConCuentas(tot) {
  if (!tot) return tot;
  if (tot.cuentas && typeof tot.cuentas === 'object') {
    const c = tot.cuentas;
    return { ...tot, cuentas: { efectivo: Number(c.efectivo) || 0, banco: Number(c.banco) || 0, mp: Number(c.mp) || 0 } };
  }
  return { ...tot, cuentas: { efectivo: Number(tot.saldo) || 0, banco: 0, mp: 0 } };
}

// Lo cobrado (menos lo pagado) con un medio en los movimientos de la caja
// del mostrador. Con pago dividido, solo la parte de ese medio.
function cdNetoMetodo(movs, metodo) {
  let n = 0;
  (movs || []).forEach(m => {
    const monto = Number(m.monto) || 0, m2 = Number(m.monto2) || 0;
    let parte = 0;
    if (m.metodoPago === metodo) parte += m.metodoPago2 ? monto - m2 : monto;
    if (m.metodoPago2 === metodo) parte += m2;
    n += m.tipo === 'egreso' ? -parte : parte;
  });
  return n;
}
// Qué cuenta toca cada medio del cierre
const CD_CIERRE = [
  { metodo: 'Transferencia', cuenta: 'banco', lbl: 'Transferencias' },
  { metodo: 'MercadoPago',   cuenta: 'mp',    lbl: 'MercadoPago' },
];

// -- Prompt post-cierre --

function openCajaDuenoPrompt(suggestedAmount, cajaChica = 0) {
  const inp = document.getElementById('cd-prompt-monto');
  if (inp) inp.value = suggestedAmount > 0 ? suggestedAmount : '';
  const descEl = document.getElementById('cd-prompt-desc');
  if (descEl) descEl.value = '';
  // Hint: avisar que ya se descontó la caja chica del monto sugerido
  const hintEl = document.getElementById('cd-prompt-hint');
  if (hintEl) {
    if (cajaChica > 0) {
      hintEl.textContent = `Ya se descontaron $${Number(cajaChica).toLocaleString('es-AR')} de caja chica`;
      hintEl.classList.remove('hidden');
    } else {
      hintEl.classList.add('hidden');
    }
  }
  document.getElementById('cd-prompt-overlay').classList.remove('hidden');
  document.getElementById('cd-prompt-modal').classList.remove('hidden');
  if (inp) setTimeout(() => inp.select(), 150);
  _cdEstilos();
  _cdPintarCierreCuentas();
}

// Lo cobrado hoy por transferencia y MercadoPago ya está en esas cuentas:
// en el cierre se ofrece anotarlo en la caja dueño (tildado). Si ese día ya
// se anotó (cierre repetido para corregir algo), no se ofrece de nuevo.
let _cdCierreOfrecido = [];
async function _cdPintarCierreCuentas() {
  _cdCierreOfrecido = [];
  const caja = document.getElementById('cd-prompt-cuentas');
  if (!caja) return;
  caja.innerHTML = '';
  const movs = (typeof MOVIMIENTOS !== 'undefined' && Array.isArray(MOVIMIENTOS)) ? MOVIMIENTOS : [];
  const fecha = (typeof currentDate !== 'undefined' && currentDate) ? currentDate : _todayAR();
  let ya = [];
  try {
    const snap = await db.collection('caja_dueno_movimientos').where('fecha', '==', fecha).get();
    ya = snap.docs.map(d => d.data().origen).filter(Boolean);
  } catch (e) { console.warn('[caja dueño] cierre ya anotado:', e); }
  _cdCierreOfrecido = CD_CIERRE
    .map(x => ({ ...x, monto: Math.round(cdNetoMetodo(movs, x.metodo)), fecha, ya: ya.includes('cierre-' + x.cuenta) }))
    .filter(x => x.monto > 0);
  if (!_cdCierreOfrecido.length) return;
  caja.innerHTML = `<p class="arqueo-sub" style="margin:10px 0 4px;font-weight:700">Y lo cobrado hoy que ya está en tus cuentas:</p>` +
    _cdCierreOfrecido.map((x, i) => x.ya
      ? `<div class="arqueo-sub" style="opacity:.6">${CD_CUENTAS[x.cuenta].ico} ${x.lbl}: ${fmt(x.monto)} · ya anotado hoy</div>`
      : `<label style="display:flex;gap:8px;align-items:center;padding:4px 0;font-size:14px;cursor:pointer">
          <input type="checkbox" id="cd-prompt-c${i}" checked style="width:18px;height:18px">
          <span>${CD_CUENTAS[x.cuenta].ico} ${x.lbl} de hoy: <b>${fmt(x.monto)}</b> → ${CD_CUENTAS[x.cuenta].lbl}</span></label>`).join('');
}

function closeCajaDuenoPrompt() {
  document.getElementById('cd-prompt-overlay').classList.add('hidden');
  document.getElementById('cd-prompt-modal').classList.add('hidden');
}

async function saveCajaDuenoFromCierre() {
  const monto = parseInt(document.getElementById('cd-prompt-monto').value) || 0;
  // Transferencias / MP del día tildadas (y no anotadas ya)
  const cuentas = _cdCierreOfrecido.filter((x, i) => !x.ya && document.getElementById('cd-prompt-c' + i)?.checked);
  if (monto <= 0 && !cuentas.length) { closeCajaDuenoPrompt(); return; }
  const desc = (document.getElementById('cd-prompt-desc').value || '').trim()
    || ('Cierre ' + _todayAR());
  try {
    for (const x of cuentas) {
      const mc = { fecha: x.fecha, tipo: 'ingreso', monto: x.monto, cuenta: x.cuenta, origen: 'cierre-' + x.cuenta,
                   desc: `${x.lbl} del día ${x.fecha.slice(8, 10)}/${x.fecha.slice(5, 7)}`, ts: new Date().toISOString() };
      await db.collection('caja_dueno_movimientos').add(mc);
      await _cdAplicar(mc);
    }
    if (monto <= 0) {
      closeCajaDuenoPrompt();
      toast('📦 ' + cuentas.map(x => `${x.lbl} ${fmt(x.monto)}`).join(' y ') + ' anotado en caja dueño', 'success');
      return;
    }
    await db.collection('caja_dueno_movimientos').add({
      fecha: _todayAR(), tipo: 'ingreso', monto, desc, cuenta: 'efectivo',
      ts: new Date().toISOString()
    });
    await _cdAjustarSaldo('ingreso', monto);
    closeCajaDuenoPrompt();
    toast('📦 ' + fmt(monto) + ' guardado en caja dueño' + (cuentas.length ? ' (y ' + cuentas.map(x => x.lbl).join(' y ') + ')' : ''), 'success');
    // 📨 Aviso Telegram: apartado a caja dueño en el cierre
    if (typeof tgNotify === 'function') {
      tgNotify(`📦 <b>${tgMonto(monto)} a caja dueño</b>\n${desc ? esc(desc) + '\n' : ''}🕐 ${tgHora()}`);
    }
  } catch(e) { toast('Error al guardar en caja dueño', 'error'); }
}

// -- Modal gestión --

function openCajaDueno() {
  if (!_cajaIsOwner) {
    requireCajaOwnerPin(() => openCajaDueno(), 'PIN de dueño para acceder');
    return;
  }
  _cdEstilos();
  document.getElementById('cd-mgmt-overlay').classList.remove('hidden');
  document.getElementById('cd-mgmt-modal').classList.remove('hidden');
  closeCajaDuenoMovForm();
  _loadCajaDueno();
}

function closeCajaDueno() {
  document.getElementById('cd-mgmt-overlay').classList.add('hidden');
  document.getElementById('cd-mgmt-modal').classList.add('hidden');
}

// ── El saldo de caja dueño ────────────────────────────────
// Antes, cada vez que abrías el cartel se leía la colección ENTERA solo para
// sumar el saldo, aunque en pantalla se muestren 80 movimientos. Eso crece
// para siempre: a los dos años, abrir la caja dueño te cuesta miles de
// lecturas del cupo.
//
// Ahora el saldo vive en un documento y se corrige con `increment()` en cada
// alta y en cada borrado, que es atómico. Si alguna vez quedara desfasado
// (una escritura que entró y un increment que no), el botón "Recalcular"
// vuelve a contar todo y lo reescribe. La lista sigue mostrando los últimos 80.
const _cdSaldoRef = () => db.collection('config').doc('cajaDuenoSaldo');

// `quitar` es para cuando se BORRA un movimiento: no alcanza con sumar lo
// contrario, porque entonces el total de ingresos subiría al borrar un egreso.
// Hay que descontarlo de su propia columna.
async function _cdAjustarSaldo(tipo, monto, quitar, extra) {
  return _cdAplicar(Object.assign({ tipo, monto }, extra || {}), quitar);
}
// Aplica lo que mueve un movimiento (o lo revierte, al borrarlo), cuentas incluidas
async function _cdAplicar(mov, quitar) {
  if (!(Number(mov && mov.monto))) return;
  const d = cdEfecto(mov);
  const s = quitar ? -1 : 1;
  const inc = firebase.firestore.FieldValue.increment;
  try {
    await _cdSaldoRef().set({
      saldo:    inc(s * d.saldo),
      ingresos: inc(s * d.ingresos),
      egresos:  inc(s * d.egresos),
      cuentas:  { efectivo: inc(s * d.cuentas.efectivo), banco: inc(s * d.cuentas.banco), mp: inc(s * d.cuentas.mp) },
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (err) { console.error('[caja dueño] saldo:', err); }
}

// Cuenta todo de nuevo y reescribe el documento. Se usa la primera vez (no
// existe todavía) y desde el botón, si el número dejara de cerrar.
async function recalcularSaldoCajaDueno(avisar) {
  const snap = await db.collection('caja_dueno_movimientos').get();
  if (typeof cupoContar === 'function') cupoContar('caja_dueno_movimientos', snap.size);
  const t = cdSumar(snap.docs.map(d => d.data()));
  const tot = { ...t, updatedAt: new Date().toISOString() };
  await _cdSaldoRef().set(tot);
  if (avisar) { toast('🔄 Saldo recalculado sobre ' + snap.size + ' movimientos', 'success'); _loadCajaDueno(); }
  return tot;
}

async function _loadCajaDueno() {
  const list = document.getElementById('cd-movs-list');
  list.innerHTML = '<p style="text-align:center;padding:16px;color:var(--t2)">Cargando...</p>';
  try {
    // Solo los últimos 80, que es lo que se muestra.
    const snap = await db.collection('caja_dueno_movimientos')
      .orderBy('ts', 'desc').limit(80).get();
    const movs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // El saldo sale del documento; si no está, se cuenta una vez y queda.
    let tot = null;
    try {
      const sd = await _cdSaldoRef().get();
      if (sd.exists) tot = sd.data();
    } catch (err) { console.error('[caja dueño] leer saldo:', err); }
    if (!tot) tot = await recalcularSaldoCajaDueno(false);
    // Saldo de antes de las cuentas: todo era efectivo. Se anota una vez.
    if (!tot.cuentas) {
      tot = cdConCuentas(tot);
      try { await _cdSaldoRef().set({ cuentas: tot.cuentas }, { merge: true }); } catch (err) { console.error('[caja dueño] cuentas:', err); }
    }
    tot = cdConCuentas(tot);
    _cdTot = tot;
    _cdPintarCuentas(tot);
    const totalIng = Number(tot.ingresos) || 0;
    const totalEg  = Number(tot.egresos) || 0;
    const saldo    = Number(tot.saldo) || 0;

    const saldoEl = document.getElementById('cd-saldo-val');
    if (saldoEl) {
      saldoEl.textContent = fmt(saldo);
      saldoEl.className = 'cd-saldo-val ' + (saldo >= 0 ? 'cd-pos' : 'cd-neg');
    }
    const subEl = document.getElementById('cd-saldo-sub');
    if (subEl) subEl.textContent = '+' + fmt(totalIng) + '  −' + fmt(totalEg);

    if (movs.length === 0) {
      list.innerHTML = '<p style="text-align:center;padding:24px;color:var(--t2)">Sin movimientos aún</p>';
      return;
    }

    list.innerHTML = movs.map(m => {
      const c = CD_CUENTAS[cdCuenta(m.cuenta)];
      const esPase = m.tipo === 'pase', esAjuste = m.tipo === 'ajuste';
      const isIng = m.tipo === 'ingreso' || (esAjuste && Number(m.monto) >= 0);
      const cuentaTxt = esPase ? c.ico + '→' + CD_CUENTAS[cdCuenta(m.cuentaDestino)].ico : c.ico;
      const signo = esPase ? '⇄ ' : (isIng ? '+' : '−');
      return '<div class="cd-mov-row">' +
        '<div class="cd-mov-info">' +
        '<span class="cd-mov-fecha">' + esc(m.fecha || '') + ' · ' + cuentaTxt + (m.origen === 'telegram' ? ' · 🤖' : '') + '</span>' +
        '<span class="cd-mov-desc">' + esc(m.desc || (esPase ? 'Pase entre cuentas' : isIng ? 'Ingreso' : 'Egreso')) + '</span>' +
        '</div>' +
        '<div class="cd-mov-right">' +
        '<span class="cd-mov-monto ' + (esPase ? '' : isIng ? 'cd-pos' : 'cd-neg') + '">' +
          signo + fmt(Math.abs(Number(m.monto) || 0)) +
        '</span>' +
        '<button class="cd-del-btn" onclick="deleteCajaDueno(\'' + esc(m.id) + '\')">🗑</button>' +
        '</div>' +
        '</div>';
    }).join('');
  } catch(e) {
    list.innerHTML = '<p style="text-align:center;padding:16px;color:#ef4444">Error al cargar</p>';
  }
}

async function deleteCajaDueno(id) {
  requireCajaOwnerPin(async () => {
    try {
      // Se lee antes de borrar: sin el monto no se puede corregir el saldo.
      const ref = db.collection('caja_dueno_movimientos').doc(id);
      const doc = await ref.get();
      const m = doc.exists ? doc.data() : null;
      await ref.delete();
      if (m) await _cdAplicar(m, true);
      toast('Movimiento eliminado', 'success');
      _loadCajaDueno();
    } catch(e) { toast('Error al eliminar', 'error'); }
  }, 'PIN de dueño para eliminar');
}

let _cdTot = null;          // el último saldo leído (para "ajustar")

// Las tres cuentas arriba, con su saldo y ✏️ para ajustarlo a lo real
function _cdPintarCuentas(tot) {
  const caja = document.getElementById('cd-cuentas');
  if (!caja) return;
  const t = cdConCuentas(tot) || { cuentas: { efectivo: 0, banco: 0, mp: 0 } };
  caja.innerHTML = Object.entries(CD_CUENTAS).map(([k, c]) => {
    const v = t.cuentas[k] || 0;
    return `<button type="button" class="cd-cuenta" onclick="cdAjustar('${k}')" title="Tocá para poner el saldo real">
      <span class="cd-cuenta-ico">${c.ico}</span><span class="cd-cuenta-lbl">${c.lbl}</span>
      <b class="${v >= 0 ? 'cd-pos' : 'cd-neg'}">${fmt(v)}</b><small>✏️ ajustar</small></button>`;
  }).join('');
}

// Elegir cuenta en el formulario (y el destino, en un pase)
function cdElegirCuenta(campo, k) {
  const inp = document.getElementById(campo);
  if (inp) inp.value = cdCuenta(k);
  document.querySelectorAll(`[data-cd-campo="${campo}"]`).forEach(b => b.classList.toggle('on', b.dataset.k === k));
}
function _cdChipsCuenta(campo, elegida) {
  return Object.entries(CD_CUENTAS).map(([k, c]) =>
    `<button type="button" class="cd-chip${k === elegida ? ' on' : ''}" data-cd-campo="${campo}" data-k="${k}" onclick="cdElegirCuenta('${campo}','${k}')">${c.ico} ${c.lbl}</button>`).join('');
}

// "En el banco hay $X": la diferencia queda como ajuste
async function cdAjustar(k) {
  const c = CD_CUENTAS[cdCuenta(k)];
  const actual = (_cdTot && _cdTot.cuentas && _cdTot.cuentas[k]) || 0;
  const r = prompt(`¿Cuánto hay HOY en ${c.lbl}? (la app dice ${fmt(actual)})`, '');
  if (r === null) return;
  const real = parseInt(String(r).replace(/[^\d-]/g, ''), 10);
  if (!isFinite(real)) { toast('Poné un número', 'error'); return; }
  const dif = real - actual;
  if (!dif) { toast('Ya estaba bien 👍', 'info'); return; }
  const m = { fecha: _todayAR(), tipo: 'ajuste', monto: dif, cuenta: cdCuenta(k), desc: `Ajuste: hay ${fmt(real)} en ${c.lbl}`, ts: new Date().toISOString() };
  try {
    await db.collection('caja_dueno_movimientos').add(m);
    await _cdAplicar(m);
    toast(`${c.ico} ${c.lbl} ajustado a ${fmt(real)}`, 'success');
    _loadCajaDueno();
  } catch (e) { toast('Error al ajustar', 'error'); }
}

function openCajaDuenoMovForm(tipo) {
  document.getElementById('cd-add-tipo').value = tipo;
  document.getElementById('cd-add-monto').value = '';
  document.getElementById('cd-add-desc').value = '';
  const title = document.getElementById('cd-add-title');
  if (title) title.textContent = tipo === 'pase' ? 'Pasar plata de una cuenta a otra' : tipo === 'egreso' ? 'Nuevo gasto' : 'Nuevo ingreso';
  // Cuenta (y destino, si es un pase)
  const cc = document.getElementById('cd-add-cuentas');
  if (cc) {
    cc.innerHTML = `<div class="cd-add-lbl">${tipo === 'pase' ? 'Sale de' : tipo === 'egreso' ? 'Lo pagaste con' : 'Entra en'}</div>
      <div class="cd-chips">${_cdChipsCuenta('cd-add-cuenta', tipo === 'pase' ? 'banco' : 'efectivo')}</div>
      ${tipo === 'pase' ? `<div class="cd-add-lbl">Va a</div><div class="cd-chips">${_cdChipsCuenta('cd-add-destino', 'efectivo')}</div>` : ''}`;
  }
  const ic = document.getElementById('cd-add-cuenta'); if (ic) ic.value = tipo === 'pase' ? 'banco' : 'efectivo';
  const idn = document.getElementById('cd-add-destino'); if (idn) idn.value = 'efectivo';
  document.getElementById('cd-add-section').classList.remove('hidden');
  setTimeout(() => document.getElementById('cd-add-monto').focus(), 80);
}

function closeCajaDuenoMovForm() {
  const s = document.getElementById('cd-add-section');
  if (s) s.classList.add('hidden');
}

async function saveCajaDuenoMov() {
  const tipo  = document.getElementById('cd-add-tipo').value;
  const monto = parseInt(document.getElementById('cd-add-monto').value) || 0;
  const desc  = document.getElementById('cd-add-desc').value.trim();
  const cuenta = cdCuenta(document.getElementById('cd-add-cuenta')?.value);
  const destino = cdCuenta(document.getElementById('cd-add-destino')?.value);
  if (monto <= 0) { toast('Ingresá un monto válido', 'error'); return; }
  if (tipo === 'pase' && cuenta === destino) { toast('Elegí dos cuentas distintas', 'error'); return; }
  const mov = {
    fecha: _todayAR(), tipo, monto, cuenta,
    desc: desc || (tipo === 'pase' ? `${CD_CUENTAS[cuenta].lbl} → ${CD_CUENTAS[destino].lbl}` : tipo === 'egreso' ? 'Egreso' : 'Ingreso'),
    ts: new Date().toISOString()
  };
  if (tipo === 'pase') mov.cuentaDestino = destino;
  try {
    await db.collection('caja_dueno_movimientos').add(mov);
    await _cdAplicar(mov);
    closeCajaDuenoMovForm();
    _loadCajaDueno();
    toast((tipo === 'pase' ? '⇄ Pase' : tipo === 'ingreso' ? '📦 Ingreso' : '💸 Egreso') + ' guardado', 'success');
    // 📨 Aviso Telegram: movimiento manual de caja dueño
    if (typeof tgNotify === 'function') {
      tgNotify(`📦 <b>Caja dueño: ${tipo === 'ingreso' ? 'ingreso' : 'egreso'} ${tgMonto(monto)}</b>\n${desc ? esc(desc) + '\n' : ''}🕐 ${tgHora()}`);
    }
  } catch(e) { toast('Error al guardar', 'error'); }
}
