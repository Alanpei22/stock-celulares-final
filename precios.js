// ══════════════════════════════════════════════════════
//  LISTA DE PRECIOS CPARTS — sincronización automática
// ══════════════════════════════════════════════════════

const CPARTS_URL       = 'https://docs.google.com/spreadsheets/d/1kmBJEat-wFBD1Byxfow7G6JIeEKDv_Ct/pub?output=csv';
const CPARTS_CACHE_KEY = 'cparts_v2';
const CPARTS_TTL       = 10 * 60 * 1000; // 10 min

let CPARTS_DATA    = [];
let cpSearchTimer;
let cpInitialized  = false;
let cpRefreshTimer;

// ── Init ──────────────────────────────────────────────
function initPrecios() {
  if (cpInitialized) return;
  cpInitialized = true;

  document.getElementById('cp-search').addEventListener('input', () => {
    clearTimeout(cpSearchTimer);
    cpSearchTimer = setTimeout(renderPrecios, 80);
  });
  document.getElementById('cp-f-cat').addEventListener('change', renderPrecios);
  document.getElementById('cp-sync-btn').addEventListener('click', manualSyncCPARTS);

  loadCPARTS();

  // Auto-refresh cada 10 min mientras la sección esté abierta
  cpRefreshTimer = setInterval(() => {
    const raw = localStorage.getItem(CPARTS_CACHE_KEY);
    if (!raw || Date.now() - JSON.parse(raw).ts > CPARTS_TTL) fetchCPARTS(false);
  }, CPARTS_TTL);
}

// ── Carga principal ────────────────────────────────────
async function loadCPARTS() {
  const raw = localStorage.getItem(CPARTS_CACHE_KEY);
  if (raw) {
    try {
      const { data, ts } = JSON.parse(raw);
      CPARTS_DATA = data;
      populateCatFilter();
      renderPrecios();
      setCPSyncTime(ts, false);
      if (Date.now() - ts < CPARTS_TTL) return; // cache fresco
    } catch (_) {}
  } else {
    document.getElementById('cp-list').innerHTML =
      '<div class="cp-loading">⏳ Cargando lista de precios...</div>';
  }
  fetchCPARTS(false);
}

async function manualSyncCPARTS() {
  const btn = document.getElementById('cp-sync-btn');
  btn.textContent = '⏳';
  btn.disabled    = true;
  await fetchCPARTS(true);
  btn.textContent = '🔄';
  btn.disabled    = false;
}

async function fetchCPARTS(showToast) {
  try {
    const res = await fetch(CPARTS_URL + '&_=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    CPARTS_DATA = parseCPARTS(text);
    const ts = Date.now();
    localStorage.setItem(CPARTS_CACHE_KEY, JSON.stringify({ data: CPARTS_DATA, ts }));
    setCPSyncTime(ts, false);
    populateCatFilter();
    renderPrecios();
    if (showToast) toast('Precios actualizados ✅', 'success');
  } catch (e) {
    console.error('CPARTS fetch:', e);
    if (CPARTS_DATA.length === 0) {
      document.getElementById('cp-list').innerHTML = `
        <div class="empty-state" style="padding:32px 20px">
          <span class="empty-ico">⚠️</span>
          <p class="empty-txt">No se pudo cargar la lista</p>
          <p class="cp-help-text">
            Para activar la actualización automática, en Google Sheets:<br>
            <strong>Archivo → Compartir → Publicar en la web</strong><br>
            Elegí la hoja <em>LISTA CPARTS 2025</em>, formato <em>CSV</em> y publicá.
          </p>
          <button class="btn-primary" style="margin-top:16px" onclick="manualSyncCPARTS()">🔄 Reintentar</button>
        </div>`;
    } else {
      if (showToast) toast('No se pudo sincronizar', 'error');
      setCPSyncTime(null, true);
    }
  }
}

// ── Parser CSV ─────────────────────────────────────────
function parseCPARTS(csvText) {
  const lines = csvText.replace(/\r/g, '').split('\n');
  const items = [];
  let currentCat = '';

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCsvRow(line);
    if (cols.length < 2) continue;

    const c0 = (cols[0] || '').trim();
    const c1 = (cols[1] || '').trim();

    // Encabezado de categoría
    if (c0 === 'CODIGO' && c1 && c1 !== 'STOCK') {
      currentCat = c1;
      continue;
    }

    const codigo = parseFloat(c0);
    if (isNaN(codigo) || !c1 || !currentCat) continue;

    const stockRaw = (cols[2] || '').trim();
    const precRaw  = (cols[3] || '').trim();
    const mayRaw   = (cols[4] || '').trim();

    const sinStock = /SIN STOCK/i.test(stockRaw);
    const stock    = sinStock ? 0 : (parseInt(stockRaw) || 0);
    const precio   = parseFloat(precRaw.replace('u$s ', '').replace(',', '.')) || 0;
    const mayor    = parseFloat(mayRaw.replace('u$s ', '').replace(',', '.')) || 0;

    if (!c1 || precio === 0) continue;

    items.push({
      codigo: Math.round(codigo),
      nombre: c1,
      categoria: currentCat,
      stock,
      sinStock,
      precio,
      mayor,
    });
  }
  return items;
}

function parseCsvRow(line) {
  const result = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { field += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      result.push(field); field = '';
    } else {
      field += c;
    }
  }
  result.push(field);
  return result;
}

// ── Render ─────────────────────────────────────────────
function renderPrecios() {
  const q    = (document.getElementById('cp-search').value || '').trim().toLowerCase();
  const fCat = document.getElementById('cp-f-cat').value;

  let filtered = CPARTS_DATA.filter(item => {
    if (fCat && item.categoria !== fCat) return false;
    if (q) {
      const hay = `${item.codigo} ${item.nombre} ${item.categoria}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sinStockCount = filtered.filter(i => i.sinStock).length;
  const totalCats     = new Set(CPARTS_DATA.map(i => i.categoria)).size;

  document.getElementById('cp-total').textContent    = filtered.length;
  document.getElementById('cp-sinstock').textContent = sinStockCount;
  document.getElementById('cp-cats').textContent     = totalCats;

  const listEl  = document.getElementById('cp-list');
  const emptyEl = document.getElementById('cp-empty');

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  if (fCat || q) {
    listEl.innerHTML = filtered.map(renderCPItem).join('');
  } else {
    // Agrupar por categoría
    const groups = {};
    filtered.forEach(item => {
      if (!groups[item.categoria]) groups[item.categoria] = [];
      groups[item.categoria].push(item);
    });
    listEl.innerHTML = Object.entries(groups).map(([cat, items]) =>
      `<div class="cp-group">
        <div class="cp-group-hdr">${esc(cat)}<span class="cp-group-count">${items.length}</span></div>
        ${items.map(renderCPItem).join('')}
      </div>`
    ).join('');
  }
}

function renderCPItem(item) {
  const outCls   = item.sinStock ? ' cp-item--out' : '';
  const badgeCls = item.sinStock ? 'cp-badge--out' : (item.stock <= 3 ? 'cp-badge--low' : 'cp-badge--ok');
  const stockTxt = item.sinStock ? 'Sin stock' : `✔ ${item.stock}u`;
  return `<div class="cp-item${outCls}">
    <div class="cp-item-top">
      <span class="cp-item-name">${esc(item.nombre)}</span>
      <span class="cp-badge ${badgeCls}">${stockTxt}</span>
    </div>
    <div class="cp-item-bot">
      <span class="cp-code">#${item.codigo}</span>
      <span class="cp-price">u$s ${item.precio.toFixed(2)}</span>
      <span class="cp-mayor">May: u$s ${item.mayor.toFixed(2)}</span>
    </div>
  </div>`;
}

function populateCatFilter() {
  const sel  = document.getElementById('cp-f-cat');
  const prev = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  const cats = [...new Set(CPARTS_DATA.map(i => i.categoria))];
  cats.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c; sel.appendChild(o);
  });
  if (cats.includes(prev)) sel.value = prev;
}

function setCPSyncTime(ts, error) {
  const el = document.getElementById('cp-sync-info');
  if (!el) return;
  if (!ts) {
    el.textContent = error ? '⚠️ Sin conexión — mostrando caché' : '';
    return;
  }
  const d    = new Date(ts);
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  el.textContent = `Actualizado ${time}`;
}
