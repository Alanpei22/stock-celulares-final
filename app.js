// ── Configuración ──────────────────────────────────────────
const PIN       = '2210';
const AUTH_KEY  = 'cel_auth';
const STOCK_KEY = 'cel_stock';
const AUTH_DAYS = 30;

// ── Auth ───────────────────────────────────────────────────
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

function checkPin() {
  if (pinBuffer === PIN) {
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

// ── Stock ──────────────────────────────────────────────────
let STOCK = [];
let editingId = null;
let appInited = false;

function loadStock() {
  try {
    STOCK = JSON.parse(localStorage.getItem(STOCK_KEY) || '[]');
  } catch (e) { STOCK = []; }
}

function saveStock() {
  localStorage.setItem(STOCK_KEY, JSON.stringify(STOCK));
}

// ── Init ───────────────────────────────────────────────────
function initApp() {
  if (appInited) return;
  appInited = true;
  loadStock();

  document.getElementById('add-btn').addEventListener('click', () => openForm());
  document.getElementById('stats-btn').addEventListener('click', openStats);
  document.getElementById('export-btn').addEventListener('click', openExport);

  document.getElementById('search').addEventListener('input', debounceRender);
  document.getElementById('f-marca').addEventListener('change', debounceRender);
  document.getElementById('f-estado').addEventListener('change', debounceRender);
  document.getElementById('f-vendido').addEventListener('change', debounceRender);
  document.getElementById('f-min').addEventListener('input', debounceRender);
  document.getElementById('f-max').addEventListener('input', debounceRender);

  // Form modal
  document.getElementById('form-close').addEventListener('click', closeForm);
  document.getElementById('form-cancel').addEventListener('click', closeForm);
  document.getElementById('form-save').addEventListener('click', savePhone);
  document.getElementById('form-modal').addEventListener('click', e => {
    if (e.target.id === 'form-modal') closeForm();
  });

  // Detail modal
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-modal').addEventListener('click', e => {
    if (e.target.id === 'detail-modal') closeDetail();
  });

  // Stats modal
  document.getElementById('stats-close').addEventListener('click', closeStats);
  document.getElementById('stats-modal').addEventListener('click', e => {
    if (e.target.id === 'stats-modal') closeStats();
  });

  // Export modal
  document.getElementById('export-close').addEventListener('click', closeExport);
  document.getElementById('export-modal').addEventListener('click', e => {
    if (e.target.id === 'export-modal') closeExport();
  });
  document.getElementById('export-csv').addEventListener('click', exportCSV);
  document.getElementById('export-json').addEventListener('click', exportJSON);
  document.getElementById('import-json-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', importJSON);

  initPWA();
  render();
}

// ── Render ─────────────────────────────────────────────────
let renderTimer;
function debounceRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 60);
}

function render() {
  const q       = (document.getElementById('search').value || '').trim().toLowerCase();
  const fMarca  = document.getElementById('f-marca').value;
  const fEstado = document.getElementById('f-estado').value;
  const fVend   = document.getElementById('f-vendido').value;
  const fMin    = parseInt(document.getElementById('f-min').value) || 0;
  const fMax    = parseInt(document.getElementById('f-max').value) || 0;
  const words   = q ? q.split(/\s+/).filter(Boolean) : [];

  // Actualizar select de marcas
  const marcas = [...new Set(STOCK.map(p => p.marca))].sort();
  const selM   = document.getElementById('f-marca');
  const prev   = selM.value;
  while (selM.options.length > 1) selM.remove(1);
  marcas.forEach(m => {
    const o = document.createElement('option');
    o.value = m; o.textContent = m;
    selM.appendChild(o);
  });
  selM.value = prev;

  // Filtrar
  const filtered = STOCK.filter(p => {
    if (fMarca  && p.marca  !== fMarca)  return false;
    if (fEstado && p.estado !== fEstado) return false;
    if (fVend === '0' && p.vendido)      return false;
    if (fVend === '1' && !p.vendido)     return false;
    if (fMin > 0 && (p.precio || 0) < fMin) return false;
    if (fMax > 0 && (p.precio || 0) > fMax) return false;
    if (words.length) {
      const hay = (p.marca + ' ' + p.modelo + ' ' + (p.imei || '') + ' ' + (p.notas || '')).toLowerCase();
      return words.every(w => hay.includes(w));
    }
    return true;
  });

  // Stats
  const inStock  = STOCK.filter(p => !p.vendido);
  const sold     = STOCK.filter(p => p.vendido);
  const totalVal = inStock.reduce((s, p) => s + (p.precio || 0), 0);
  document.getElementById('s-stock').textContent = inStock.length;
  document.getElementById('s-sold').textContent  = sold.length;
  document.getElementById('s-value').textContent = '$' + totalVal.toLocaleString('es-AR');

  // Render lista
  const listEl  = document.getElementById('list');
  const emptyEl = document.getElementById('empty');

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  const badgeCls = { Nuevo: 'bg-new', Usado: 'bg-used', Reacondicionado: 'bg-refurb' };

  listEl.innerHTML = filtered.map(p => {
    const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' · ');
    const fecha = p.fecha
      ? new Date(p.fecha).toLocaleDateString('es-AR', { day:'2-digit', month:'short' })
      : '';
    return `
<div class="card${p.vendido ? ' card-sold' : ''}" onclick="openDetail('${p.id}')">
  <div class="card-top">
    <div class="card-info">
      <span class="card-marca">${esc(p.marca)}</span>
      <span class="card-modelo">${esc(p.modelo)}</span>
      ${specs ? `<span class="card-specs">${esc(specs)}</span>` : ''}
    </div>
    <div class="card-right">
      <span class="badge ${badgeCls[p.estado] || ''}">${esc(p.estado)}</span>
      ${p.vendido ? '<span class="badge bg-sold">VENDIDO</span>' : ''}
    </div>
  </div>
  <div class="card-bottom">
    <span class="card-price">${p.precio ? '$ ' + p.precio.toLocaleString('es-AR') : '—'}</span>
    <div class="card-meta">
      ${p.imei ? `<span class="card-imei">${esc(p.imei)}</span>` : ''}
      ${fecha ? `<span class="card-date">${fecha}</span>` : ''}
    </div>
  </div>
</div>`;
  }).join('');
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Formulario ─────────────────────────────────────────────
function openForm(id) {
  editingId = id || null;
  const t = document.getElementById('form-title');

  if (id) {
    const p = STOCK.find(x => x.id === id);
    if (!p) return;
    t.textContent = '✏️ Editar Equipo';
    document.getElementById('fi-marca').value   = p.marca || '';
    document.getElementById('fi-modelo').value  = p.modelo || '';
    document.getElementById('fi-estado').value  = p.estado || '';
    document.getElementById('fi-precio').value  = p.precio || '';
    document.getElementById('fi-storage').value = p.almacenamiento || '';
    document.getElementById('fi-ram').value     = p.ram || '';
    document.getElementById('fi-imei').value    = p.imei || '';
    document.getElementById('fi-notas').value   = p.notas || '';
  } else {
    t.textContent = '📱 Agregar Equipo';
    ['fi-marca','fi-modelo','fi-precio','fi-imei','fi-notas'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('fi-estado').value  = '';
    document.getElementById('fi-storage').value = '';
    document.getElementById('fi-ram').value     = '';
  }

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
  const marca   = document.getElementById('fi-marca').value.trim();
  const modelo  = document.getElementById('fi-modelo').value.trim();
  const estado  = document.getElementById('fi-estado').value;
  const precio  = parseInt(document.getElementById('fi-precio').value) || 0;
  const storage = document.getElementById('fi-storage').value;
  const ram     = document.getElementById('fi-ram').value;
  const imei    = document.getElementById('fi-imei').value.trim();
  const notas   = document.getElementById('fi-notas').value.trim();

  if (!marca)  { toast('Ingresá la marca', 'error');  return; }
  if (!modelo) { toast('Ingresá el modelo', 'error'); return; }
  if (!estado) { toast('Seleccioná el estado', 'error'); return; }
  if (!precio || precio <= 0) { toast('Ingresá un precio válido', 'error'); return; }
  if (imei && !/^\d{15}$/.test(imei)) {
    toast('El IMEI debe tener 15 dígitos', 'error'); return;
  }
  if (imei) {
    const dup = STOCK.find(x => x.imei === imei && x.id !== editingId);
    if (dup) {
      toast('Ya existe un equipo con ese IMEI', 'error'); return;
    }
  }

  if (editingId) {
    const idx = STOCK.findIndex(x => x.id === editingId);
    if (idx >= 0) {
      STOCK[idx] = { ...STOCK[idx], marca, modelo, estado, precio, almacenamiento: storage, ram, imei, notas };
    }
    toast('Equipo actualizado', 'success');
  } else {
    STOCK.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      marca, modelo, estado, precio,
      almacenamiento: storage, ram, imei, notas,
      fecha: new Date().toISOString(),
      vendido: false,
    });
    toast('Equipo agregado al stock', 'success');
  }

  saveStock();
  closeForm();
  render();
}

// ── Detalle ────────────────────────────────────────────────
function openDetail(id) {
  const p = STOCK.find(x => x.id === id);
  if (!p) return;

  document.getElementById('det-marca').textContent  = p.marca;
  document.getElementById('det-modelo').textContent = p.modelo;

  const badgeCls = { Nuevo: 'bg-new', Usado: 'bg-used', Reacondicionado: 'bg-refurb' };
  const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' · ');
  const fechaIng  = p.fecha ? new Date(p.fecha).toLocaleDateString('es-AR') : '—';
  const fechaVta  = p.fecha_venta ? new Date(p.fecha_venta).toLocaleDateString('es-AR') : null;

  document.getElementById('det-body').innerHTML = `
    <div class="det-row">
      <span class="det-label">Estado</span>
      <span class="badge ${badgeCls[p.estado] || ''}">${esc(p.estado)}</span>
    </div>
    <div class="det-row">
      <span class="det-label">Precio</span>
      <span class="det-val det-price">$ ${p.precio ? p.precio.toLocaleString('es-AR') : '—'}</span>
    </div>
    ${specs ? `<div class="det-row"><span class="det-label">Specs</span><span class="det-val">${esc(specs)}</span></div>` : ''}
    ${p.imei ? `<div class="det-row"><span class="det-label">IMEI</span><span class="det-val det-imei">${esc(p.imei)}</span></div>` : ''}
    <div class="det-row">
      <span class="det-label">Ingreso</span>
      <span class="det-val">${fechaIng}</span>
    </div>
    ${fechaVta ? `<div class="det-row"><span class="det-label">Venta</span><span class="det-val">${fechaVta}</span></div>` : ''}
    ${p.notas ? `<div class="det-row det-row--full"><span class="det-label">Notas</span><span class="det-val">${esc(p.notas)}</span></div>` : ''}
    ${p.vendido ? '<div class="det-sold-badge">VENDIDO</div>' : ''}
  `;

  document.getElementById('det-actions').innerHTML = `
    ${!p.vendido ? `<button class="btn-whatsapp" onclick="shareWhatsApp('${p.id}')">🟢 WhatsApp</button>` : ''}
    <button class="btn-copy" onclick="copyInfo('${p.id}')">📋 Copiar</button>
    ${!p.vendido ? `<button class="btn-edit" onclick="closeDetail();openForm('${p.id}')">✏️ Editar</button>` : ''}
    ${!p.vendido
      ? `<button class="btn-sell" onclick="markSold('${p.id}')">💰 Vendido</button>`
      : `<button class="btn-unsell" onclick="markSold('${p.id}')">↩️ Reactivar</button>`}
    <button class="btn-delete" onclick="deletePhone('${p.id}')">🗑️</button>
  `;

  document.getElementById('detail-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── WhatsApp ───────────────────────────────────────────────
function shareWhatsApp(id) {
  const p = STOCK.find(x => x.id === id);
  if (!p) return;

  const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' / ');
  const precio = p.precio ? '$ ' + p.precio.toLocaleString('es-AR') : '—';

  let msg = `📱 *${p.marca} ${p.modelo}*\n`;
  if (specs)    msg += `💾 ${specs}\n`;
  if (p.estado) msg += `✅ Estado: ${p.estado}\n`;
  msg += `💰 Precio: ${precio}`;
  if (p.notas)  msg += `\n📝 ${p.notas}`;
  msg += `\n\n_Consultá disponibilidad_ 👋`;

  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

// ── Copiar info ────────────────────────────────────────────
function copyInfo(id) {
  const p = STOCK.find(x => x.id === id);
  if (!p) return;

  const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' / ');
  let text = `${p.marca} ${p.modelo}`;
  if (specs)    text += ` - ${specs}`;
  if (p.estado) text += ` - ${p.estado}`;
  text += ` - $${(p.precio || 0).toLocaleString('es-AR')}`;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      toast('Info copiada al portapapeles', 'success');
    }).catch(() => toast('No se pudo copiar', 'error'));
  } else {
    toast('Tu navegador no soporta copiar', 'error');
  }
}

// ── Acciones ───────────────────────────────────────────────
function markSold(id) {
  const p = STOCK.find(x => x.id === id);
  if (!p) return;
  p.vendido = !p.vendido;
  if (p.vendido) p.fecha_venta = new Date().toISOString();
  else           delete p.fecha_venta;
  saveStock();
  closeDetail();
  render();
  toast(p.vendido ? 'Marcado como vendido' : 'Reactivado al stock', 'success');
}

function deletePhone(id) {
  const p = STOCK.find(x => x.id === id);
  if (!p) return;
  if (!confirm('¿Eliminar ' + p.marca + ' ' + p.modelo + '?')) return;
  STOCK = STOCK.filter(x => x.id !== id);
  saveStock();
  closeDetail();
  render();
  toast('Equipo eliminado', 'info');
}

// ── Modal Estadísticas ─────────────────────────────────────
function openStats() {
  const sold   = STOCK.filter(p => p.vendido && p.fecha_venta);
  const inStock = STOCK.filter(p => !p.vendido);
  const totalVal = inStock.reduce((s, p) => s + (p.precio || 0), 0);

  // Agrupar ventas por mes
  const byMonth = {};
  sold.forEach(p => {
    const d   = new Date(p.fecha_venta);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const lbl = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    if (!byMonth[key]) byMonth[key] = { label: lbl, items: [], total: 0 };
    byMonth[key].items.push(p);
    byMonth[key].total += p.precio || 0;
  });

  const keys = Object.keys(byMonth).sort().reverse();

  // Marca más vendida
  const marcaCount = {};
  sold.forEach(p => { marcaCount[p.marca] = (marcaCount[p.marca] || 0) + 1; });
  const topMarca = Object.entries(marcaCount).sort((a,b) => b[1]-a[1])[0];

  let html = `
    <div class="ss-grid">
      <div class="ss-card">
        <div class="ss-num">${inStock.length}</div>
        <div class="ss-lbl">En stock</div>
      </div>
      <div class="ss-card">
        <div class="ss-num">${sold.length}</div>
        <div class="ss-lbl">Total vendidos</div>
      </div>
      <div class="ss-card ss-green">
        <div class="ss-num">$${totalVal.toLocaleString('es-AR')}</div>
        <div class="ss-lbl">Valor stock</div>
      </div>
      ${topMarca ? `
      <div class="ss-card ss-blue">
        <div class="ss-num">${topMarca[0]}</div>
        <div class="ss-lbl">Marca más vendida</div>
      </div>` : ''}
    </div>
    <h4 class="hist-title">Historial de ventas por mes</h4>
  `;

  if (keys.length === 0) {
    html += '<p class="hist-empty">Sin ventas registradas aún 📦</p>';
  } else {
    keys.forEach(k => {
      const m = byMonth[k];
      html += `
        <div class="hist-month">
          <div class="hist-month-hdr">
            <span class="hist-month-name">${m.label}</span>
            <span class="hist-month-stats">${m.items.length} venta${m.items.length !== 1 ? 's' : ''} · $${m.total.toLocaleString('es-AR')}</span>
          </div>
          ${m.items.map(p => {
            const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' · ');
            return `
            <div class="hist-item">
              <div class="hist-item-info">
                <span class="hist-item-name">${esc(p.marca)} ${esc(p.modelo)}</span>
                ${specs ? `<span class="hist-item-specs">${esc(specs)}</span>` : ''}
              </div>
              <span class="hist-item-price">$${(p.precio || 0).toLocaleString('es-AR')}</span>
            </div>`;
          }).join('')}
        </div>
      `;
    });
  }

  document.getElementById('stats-body').innerHTML = html;
  document.getElementById('stats-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeStats() {
  document.getElementById('stats-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── Export / Import ────────────────────────────────────────
function openExport() {
  document.getElementById('export-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeExport() {
  document.getElementById('export-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function exportCSV() {
  const headers = ['Marca','Modelo','Estado','Precio','Almacenamiento','RAM','IMEI','Notas','Fecha Ingreso','Vendido','Fecha Venta'];
  const rows = STOCK.map(p => [
    p.marca, p.modelo, p.estado, p.precio || 0,
    p.almacenamiento || '', p.ram || '', p.imei || '', p.notas || '',
    p.fecha     ? new Date(p.fecha).toLocaleDateString('es-AR')       : '',
    p.vendido   ? 'Sí' : 'No',
    p.fecha_venta ? new Date(p.fecha_venta).toLocaleDateString('es-AR') : ''
  ]);

  const csv = [headers, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'stock_celulares_' + new Date().toISOString().slice(0,10) + '.csv'
  });
  a.click();
  URL.revokeObjectURL(a.href);
  closeExport();
  toast('Stock exportado como CSV ✅', 'success');
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(STOCK, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'backup_stock_' + new Date().toISOString().slice(0,10) + '.json'
  });
  a.click();
  URL.revokeObjectURL(a.href);
  closeExport();
  toast('Backup guardado ✅', 'success');
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error('Formato inválido');
      if (!confirm(`¿Restaurar ${data.length} equipos? Esto reemplazará el stock actual.`)) return;
      STOCK = data;
      saveStock();
      closeExport();
      render();
      toast(`Stock restaurado: ${data.length} equipos ✅`, 'success');
    } catch (err) {
      toast('Archivo inválido: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

// ── Toast ──────────────────────────────────────────────────
let toastTimer;
function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type || 'info');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── PWA ────────────────────────────────────────────────────
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  let deferredPrompt = null;
  const banner = document.getElementById('install-banner');

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    banner.classList.add('show');
  });

  document.getElementById('install-btn').addEventListener('click', () => {
    banner.classList.remove('show');
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; }
  });

  window.addEventListener('appinstalled', () => banner.classList.remove('show'));

  const isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  if (isIOS && !isStandalone) {
    document.getElementById('ios-tip').classList.add('show');
  }
}

// ── Arranque ───────────────────────────────────────────────
initPinPad();
checkAuth();
