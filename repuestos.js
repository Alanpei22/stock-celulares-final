// ══════════════════════════════════════════
//  REPUESTOS
// ══════════════════════════════════════════

let REPUESTOS           = [];
let editingRepuestoId   = null;
let rep2RenderTimer;
let _lowStockDismissed  = false;
let _repuestosListener  = null; // referencia al unsubscribe de onSnapshot

// Expone cleanup para que auth.js cancele el listener en logout
window._repuestosCleanup = function() {
  if (_repuestosListener) { _repuestosListener(); _repuestosListener = null; }
  REPUESTOS = [];
};

function dismissLowStockBanner() {
  _lowStockDismissed = true;
  const banner = document.getElementById('rep2-lowstock-banner');
  if (banner) banner.style.display = 'none';
}

// ── Carga Masiva ──────────────────────────
const _BULK_BRANDS = {
  'moto':'Motorola','motorola':'Motorola',
  'samsung':'Samsung',
  'redmi':'Xiaomi','xiaomi':'Xiaomi',
  'zte':'ZTE',
  'iphone':'iPhone','apple':'iPhone',
  'nokia':'Nokia','tcl':'TCL',
  'huawei':'Huawei','lg':'LG',
  'alcatel':'Alcatel','lenovo':'Lenovo',
  'oppo':'OPPO','realme':'Realme','vivo':'Vivo',
  'note':'Xiaomi', // Redmi Note series
};

function _bulkDetectBrand(parts) {
  const fw = parts[0].toLowerCase();
  if (fw === 'note')           return { marca: 'Xiaomi',        modelParts: ['Note', ...parts.slice(1)] };
  if (_BULK_BRANDS[fw])        return { marca: _BULK_BRANDS[fw], modelParts: parts.slice(1) };
  if (/^[ajs]\d/.test(fw))     return { marca: 'Samsung',       modelParts: parts };
  if (/^\d+[a-z]/i.test(fw))   return { marca: 'TCL',           modelParts: parts };
  return { marca: fw.charAt(0).toUpperCase() + fw.slice(1), modelParts: parts.slice(1) };
}

function _parseBulkLine(line, tipo) {
  line = line.trim(); if (!line) return null;
  const parts = line.split(/\s+/);
  let cantidad = 0, nameParts = [...parts];
  if (/^\d+$/.test(parts[parts.length - 1])) {
    cantidad = parseInt(parts[parts.length - 1]);
    nameParts = parts.slice(0, -1);
  }
  if (!nameParts.length) return null;
  const { marca, modelParts } = _bulkDetectBrand(nameParts);
  const modelo = modelParts.map(w =>
    w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(' ');
  const nombre = [tipo, marca, modelo].filter(Boolean).join(' ');
  return { nombre, marca, modelo, tipo, cantidad };
}

function openBulkImport() {
  document.getElementById('bulk-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('bulk-step1').classList.remove('hidden');
  document.getElementById('bulk-step2').classList.add('hidden');
}
function closeBulkImport() {
  document.getElementById('bulk-modal').classList.add('hidden');
  document.body.style.overflow = '';
}
function backToBulkInput() {
  document.getElementById('bulk-step1').classList.remove('hidden');
  document.getElementById('bulk-step2').classList.add('hidden');
}

function previewBulk() {
  const texto = document.getElementById('bulk-texto').value;
  const tipo  = document.getElementById('bulk-tipo').value;
  const lines = texto.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) { toast('Pegá una lista primero', 'error'); return; }

  const items = lines.map(l => _parseBulkLine(l, tipo)).filter(Boolean);
  if (!items.length) { toast('No se pudieron parsear los ítems', 'error'); return; }

  document.getElementById('bulk-count-lbl').textContent = `${items.length} repuesto${items.length !== 1 ? 's' : ''}`;
  document.getElementById('bulk-save-lbl').textContent = `💾 Guardar ${items.length} repuestos`;

  const tbody = document.getElementById('bulk-tbody');
  tbody.innerHTML = items.map((it, i) => `
    <tr id="brow-${i}">
      <td><input class="bulk-inp" value="${_esc(it.nombre)}" data-f="nombre" data-i="${i}"></td>
      <td><input class="bulk-inp bulk-inp-sm" value="${_esc(it.marca)}" data-f="marca" data-i="${i}"></td>
      <td><input class="bulk-inp bulk-inp-sm" value="${_esc(it.modelo)}" data-f="modelo" data-i="${i}"></td>
      <td><input class="bulk-inp bulk-inp-qty" type="number" min="0" value="${it.cantidad}" data-f="cantidad" data-i="${i}"></td>
      <td><button class="bulk-del-btn" onclick="removeBulkRow(${i})">✕</button></td>
    </tr>`).join('');

  document.getElementById('bulk-step1').classList.add('hidden');
  document.getElementById('bulk-step2').classList.remove('hidden');
}

function removeBulkRow(i) {
  const row = document.getElementById('brow-' + i);
  if (row) row.remove();
  const rem = document.getElementById('bulk-tbody').querySelectorAll('tr').length;
  document.getElementById('bulk-count-lbl').textContent = `${rem} repuesto${rem !== 1 ? 's' : ''}`;
  document.getElementById('bulk-save-lbl').textContent = `💾 Guardar ${rem} repuestos`;
}

async function saveBulk() {
  const proveedor = document.getElementById('bulk-proveedor').value.trim();
  const tipo      = document.getElementById('bulk-tipo').value;
  const rows = document.getElementById('bulk-tbody').querySelectorAll('tr');
  if (!rows.length) { toast('No hay ítems para guardar', 'error'); return; }

  // Leer valores actuales de los inputs
  const items = [];
  rows.forEach(row => {
    const get = f => row.querySelector(`[data-f="${f}"]`)?.value?.trim() || '';
    const nombre = get('nombre'), marca = get('marca');
    if (!nombre || !marca) return;
    items.push({
      nombre, marca,
      modelo:      get('modelo'),
      tipo:        tipo,
      cantidad:    parseInt(row.querySelector('[data-f="cantidad"]')?.value) || 0,
      stockMin:    2,
      precioCompra:0,
      proveedor,
      notas:       '',
      fechaAlta:   new Date().toISOString()
    });
  });

  const btn = document.getElementById('bulk-save-btn');
  btn.disabled = true;
  document.getElementById('bulk-save-lbl').textContent = '⏳ Guardando...';

  try {
    const CHUNK = 400; // Firestore batch limit 500, usamos 400 para seguridad
    for (let i = 0; i < items.length; i += CHUNK) {
      const batch = db.batch();
      items.slice(i, i + CHUNK).forEach(item => {
        const ref = db.collection('repuestos').doc();
        batch.set(ref, { id: ref.id, ...item });
      });
      await batch.commit();
    }
    toast(`✅ ${items.length} repuestos guardados`, 'success');
    closeBulkImport();
  } catch(e) {
    toast('Error al guardar: ' + e.message, 'error');
    btn.disabled = false;
    document.getElementById('bulk-save-lbl').textContent = `💾 Guardar ${items.length} repuestos`;
  }
}

function _esc(s) { return String(s||'').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// ── Firebase ──────────────────────────────
function listenRepuestos() {
  // CUPO: si ya está escuchando NO se recrea. Antes se cancelaba y se volvía a
  // crear, y cada recreación vuelve a leer la colección entera (se llama cada
  // vez que se entra a la sección).
  if (_repuestosListener) return;
  if (typeof db === 'undefined' || !db) return;

  let _primerRepu = true;
  _repuestosListener = db.collection('repuestos').onSnapshot(snap => {
    if (typeof cupoSnap === 'function') { cupoSnap('repuestos', snap, _primerRepu); _primerRepu = false; }
    REPUESTOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    REPUESTOS.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    _lowStockDismissed = false; // reaparece en cada cambio de inventario
    renderRepuestos();
    if (typeof _refreshDashIfVisible === 'function') _refreshDashIfVisible();
    else if (typeof renderDashLowStock === 'function') renderDashLowStock();
  }, err => {
    console.error('Repuestos:', err);
    toast('Error cargando repuestos', 'error');
  });
}

// ── Init ──────────────────────────────────
function initRepuestos() {
  document.getElementById('rep2-add-btn').addEventListener('click', () => openRepuestoForm());
  // ENTER en la sección Repuestos → abrir "Nuevo repuesto"
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const sec = document.getElementById('repuestos-section');
    if (!sec || sec.classList.contains('section-hidden')) return;   // no estamos en Repuestos
    if (document.querySelector('.modal-overlay:not(.hidden), .nota-overlay:not(.hidden)')) return; // hay un modal abierto
    const ae = document.activeElement;
    const tag = (ae?.tagName || '').toLowerCase();
    // Caso típico: buscaste un repuesto que no está → Enter lo abre con el nombre precargado
    if (ae && ae.id === 'rep2-search') {
      e.preventDefault();
      const q = ae.value.trim();
      openRepuestoForm();
      if (q) setTimeout(() => {
        const nom = document.getElementById('rep2-fi-nombre');
        if (nom) { nom.value = q; nom.select(); }
      }, 320);
      return;
    }
    // Solo se ignora si se está escribiendo. Si el foco quedó en un botón
    // (ej. el del menú con el que entraste a Repuestos), igual abrimos:
    // el preventDefault evita que Enter re-active ese botón.
    if (['input', 'textarea', 'select'].includes(tag) || ae?.isContentEditable) return;
    e.preventDefault();
    if (ae && typeof ae.blur === 'function') ae.blur();
    openRepuestoForm();
  });
  document.getElementById('rep2-search').addEventListener('input', () => {
    clearTimeout(rep2RenderTimer);
    rep2RenderTimer = setTimeout(renderRepuestos, 60);
  });
  document.getElementById('rep2-f-tipo').addEventListener('change', renderRepuestos);
  document.getElementById('rep2-f-marca').addEventListener('change', renderRepuestos);
  document.getElementById('rep2-f-alta')?.addEventListener('change', renderRepuestos);
  document.getElementById('rep2-form-close').addEventListener('click', closeRepuestoForm);
  document.getElementById('rep2-form-cancel').addEventListener('click', closeRepuestoForm);
  document.getElementById('rep2-form-save').addEventListener('click', () => saveRepuesto());
  document.getElementById('rep2-form-save-otro')
    ?.addEventListener('click', () => saveRepuesto({ seguir: true }));
  document.getElementById('rep2-delete-btn').addEventListener('click', () => deleteRepuesto(editingRepuestoId));
  document.getElementById('rep2-form-modal').addEventListener('click', e => {
    if (e.target.id === 'rep2-form-modal') closeRepuestoForm();
  });
  // Hint dinámico del costo en pesos al lado del campo USD
  document.getElementById('rep2-fi-costoUSD')?.addEventListener('input', _updateCostoARSHint);
  initCatalogAutocomplete();
  // CUPO: el listener de repuestos (colección completa) arranca recién al
  // entrar a la sección Repuestos — ver switchSection() en app.js.
}

// ── Autocompletado desde catálogo de módulos ───────────────
function initCatalogAutocomplete() {
  if (typeof MODULOS_CATALOG === 'undefined') return;
  const input = document.getElementById('rep2-fi-nombre');
  const list  = document.getElementById('rep2-ac-list');
  if (!input || !list) return;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q.length < 2) { list.classList.add('hidden'); return; }

    const matches = MODULOS_CATALOG.filter(([marca, nombre]) =>
      searchMatch([nombre, marca], q)
    ).slice(0, 12);

    if (!matches.length) { list.classList.add('hidden'); return; }

    list.innerHTML = matches.map(([marca, nombre, precio, notas]) => {
      const precioStr = precio > 0
        ? '$ ' + precio.toLocaleString('es-AR')
        : '<span style="color:#ef4444">Sin stock</span>';
      const notaStr = notas ? ` · ${notas}` : '';
      const safeM = marca.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const safeN = nombre.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const safeT = (notas||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      return `<div class="rep2-ac-item" onclick="selectCatalogItem('${safeM}','${safeN}',${precio},'${safeT}')">
        <span class="rep2-ac-name">${nombre}</span>
        <span class="rep2-ac-meta">${marca}${notaStr} · ${precioStr}</span>
      </div>`;
    }).join('');
    list.classList.remove('hidden');
  });

  // Cerrar al hacer click fuera
  document.addEventListener('click', e => {
    if (!e.target.closest('#rep2-ac-wrap')) list.classList.add('hidden');
  });
}

function selectCatalogItem(marca, nombre, precio, notas) {
  document.getElementById('rep2-fi-nombre').value    = nombre;
  document.getElementById('rep2-fi-marca').value     = marca;
  document.getElementById('rep2-fi-tipo').value      = 'Pantalla';
  document.getElementById('rep2-fi-precio').value    = precio > 0 ? precio : '';
  document.getElementById('rep2-fi-notas').value     = notas || '';
  document.getElementById('rep2-ac-list').classList.add('hidden');
  // Foco en cantidad para completar rápido
  document.getElementById('rep2-fi-cantidad').focus();
}

// ── Render ────────────────────────────────
// Los repuestos que están a la vista con los filtros puestos. Lo usan la lista
// y la impresión de etiquetas: si imprimieran cosas distintas de lo que se ve,
// nadie entendería qué salió.
// ¿Se cargó hoy? `fechaAlta` se guarda al dar de alta (una por una o por
// carga masiva). Los repuestos viejos no la tienen y no cuentan como de hoy,
// que es lo correcto: son de antes de que existiera el campo.
function _repuEsDeHoy(r) {
  if (!r || !r.fechaAlta) return false;
  const d = new Date(r.fechaAlta);
  if (isNaN(d)) return false;
  const hoy = (typeof _todayAR === 'function') ? _todayAR()
            : new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
  return d.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10) === hoy;
}

function _rep2Filtrados() {
  const q      = (document.getElementById('rep2-search')?.value || '').trim().toLowerCase();
  const fTipo  = document.getElementById('rep2-f-tipo')?.value || '';
  const fMarca = document.getElementById('rep2-f-marca')?.value || '';
  const fAlta  = document.getElementById('rep2-f-alta')?.value || '';
  return REPUESTOS.filter(r => {
    if (fAlta === 'hoy' && !_repuEsDeHoy(r)) return false;
    if (fTipo  && r.tipo  !== fTipo)  return false;
    if (fMarca && r.marca !== fMarca) return false;
    // El código entra en la búsqueda: si está impreso en la etiqueta, tiene que
    // servir para encontrar el repuesto tecleándolo.
    if (q && !searchMatch([r.nombre, r.marca, r.modelo, r.tipo, r.proveedor, r.codigo, r.codigoCorto], q)) return false;
    return true;
  });
}

function renderRepuestos() {
  const q      = (document.getElementById('rep2-search').value || '').trim().toLowerCase();
  const fTipo  = document.getElementById('rep2-f-tipo').value;
  const fMarca = document.getElementById('rep2-f-marca').value;
  const fAlta  = document.getElementById('rep2-f-alta')?.value || '';

  // Reconstruir select de marcas
  const marcas = [...new Set(REPUESTOS.map(r => r.marca).filter(Boolean))].sort();
  const selM   = document.getElementById('rep2-f-marca');
  const prev   = selM.value;
  while (selM.options.length > 1) selM.remove(1);
  marcas.forEach(m => {
    const o = document.createElement('option');
    o.value = m; o.textContent = m; selM.appendChild(o);
  });
  selM.value = prev;

  let filtered = _rep2Filtrados();

  // Stats — sobre el total completo
  const lowStock = REPUESTOS.filter(r =>
    r.stockMin != null && r.stockMin > 0 && (r.cantidad || 0) <= r.stockMin
  ).length;
  const totalVal = REPUESTOS.reduce((s, r) =>
    s + (r.cantidad || 0) * (r.precioCompra || 0), 0);

  document.getElementById('rs2-total').textContent    = REPUESTOS.length;
  document.getElementById('rs2-lowstock').textContent = lowStock;
  document.getElementById('rs2-valor').textContent    =
    '$ ' + totalVal.toLocaleString('es-AR', { maximumFractionDigits: 0 });

  // Badge en nav
  const badge = document.getElementById('nav-badge-repuestos');
  if (badge) {
    badge.textContent   = lowStock;
    badge.style.display = lowStock > 0 ? '' : 'none';
  }

  // Banner de stock bajo
  const lowItems = REPUESTOS.filter(r =>
    r.stockMin != null && r.stockMin > 0 && (r.cantidad || 0) <= r.stockMin
  );
  const banner    = document.getElementById('rep2-lowstock-banner');
  const bannerCnt = document.getElementById('rep2-lowstock-count');
  const bannerList = document.getElementById('rep2-lowstock-list');
  if (banner) {
    if (_lowStockDismissed) {
      banner.style.display = 'none';
    } else {
      banner.style.display = lowItems.length > 0 ? '' : 'none';
      if (bannerCnt) bannerCnt.textContent = lowItems.length;
      if (bannerList) {
        bannerList.innerHTML = lowItems.map(r =>
          `<div class="lowstock-item">
            <span class="lowstock-item-name">🔩 ${esc(r.marca || '')} ${esc(r.nombre)}</span>
            <span class="lowstock-item-qty">${r.cantidad ?? 0} / mín ${r.stockMin}</span>
          </div>`
        ).join('');
      }
    }
  }

  const listEl  = document.getElementById('rep2-list');
  const emptyEl = document.getElementById('rep2-empty');

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  listEl.innerHTML = filtered.map(r => {
    const isLow  = r.stockMin != null && r.stockMin > 0 && (r.cantidad || 0) <= r.stockMin;
    const lowCls = isLow ? ' rep2-card--lowstock' : '';
    // Costo USD canónico, precioVenta en pesos
    const dolar = (typeof dolarBlue === 'number' && dolarBlue > 0) ? dolarBlue : 0;
    const usd   = Number(r.precioCostoUSD) || 0;
    const venta = Number(r.precioVenta) || 0;
    // Fallback al legacy precioCompra si no hay USD cargado
    const costoARS = usd > 0 && dolar > 0 ? Math.round(usd * dolar) : (Number(r.precioCompra) || 0);
    const priceParts = [];
    if (usd > 0) priceParts.push(`<span class="rep2-price-usd">U$D ${usd.toLocaleString('es-AR')}</span>`);
    else if (costoARS > 0) priceParts.push(`<span class="rep2-price-cost">$${costoARS.toLocaleString('es-AR')}</span>`);
    if (venta > 0) priceParts.push(`<span class="rep2-price-venta">→ $${venta.toLocaleString('es-AR')}</span>`);

    // En modo selección tocar la tarjeta la marca en vez de abrirla.
    const sel = _repuSelModo && _repuSel.has(r.id);
    const click = _repuSelModo ? `_repuSelToggle('${r.id}')` : `openRepuestoForm('${r.id}')`;
    return `
      <div class="card rep2-card${lowCls}${sel ? ' rep2-card--sel' : ''}" onclick="${click}">
        <div class="card-top">
          <div class="card-info">
            <span class="card-marca">${_repuSelModo ? (sel ? '☑️ ' : '⬜ ') : '🔩 '}${esc(r.marca || '—')}${r.modelo ? ' · ' + esc(r.modelo) : ''}</span>
            <span class="card-modelo">${esc(r.nombre)}</span>
            <span class="card-specs">${esc(r.tipo || '')}${r.proveedor ? ' · ' + esc(r.proveedor) : ''}</span>
          </div>
          <div class="card-right">
            ${isLow
              ? '<span class="badge rep2-badge-low">⚠ Stock bajo</span>'
              : '<span class="badge rep2-badge-ok">✓ OK</span>'}
          </div>
        </div>
        <div class="card-bottom">
          <div class="rep2-qty-display"${_repuSelModo ? '' : ' onclick="event.stopPropagation()"'}>
            ${_repuSelModo
              ? `<span class="rep2-qty-num${isLow ? ' rep2-qty-num--low' : ''}">${r.cantidad ?? 0}</span>`
              : `<button class="rep2-qty-btn rep2-qty-minus" onclick="changeQty('${r.id}',-1)">−</button>
                 <span class="rep2-qty-num${isLow ? ' rep2-qty-num--low' : ''}">${r.cantidad ?? 0}</span>
                 <button class="rep2-qty-btn rep2-qty-plus" onclick="changeQty('${r.id}',+1)">＋</button>`}
          </div>
          <div class="card-meta">
            <span class="card-date owner-only">${priceParts.join(' ') || '—'}</span>
            ${r.stockMin != null && r.stockMin > 0
              ? `<span class="card-imei">mín: ${r.stockMin}</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Cambio rápido de cantidad ──────────────
function changeQty(id, delta) {
  const r = REPUESTOS.find(x => x.id === id);
  if (!r) return;
  const nueva = Math.max(0, (r.cantidad || 0) + delta);
  db.collection('repuestos').doc(id)
    .update({ cantidad: nueva })
    .then(() => toast(delta > 0 ? '＋1 unidad' : '−1 unidad', 'success'))
    .catch(() => toast('Error al actualizar', 'error'));
}

// ── Formulario ────────────────────────────
function openRepuestoForm(id) {
  if (typeof tpFrenar === 'function' && tpFrenar('inventario', 'cargar o editar repuestos')) return;
  editingRepuestoId = id || null;
  const title = document.getElementById('rep2-form-title');
  const delWrap = document.getElementById('rep2-delete-wrap');
  // La etiqueta solo tiene sentido con el repuesto guardado: uno nuevo todavía
  // no tiene código ni precio.
  const etqBtn = document.getElementById('rep2-form-etq');
  if (etqBtn) etqBtn.style.display = id ? '' : 'none';
  // "Cargar otro" solo tiene sentido dando de alta, no editando uno viejo.
  const otroBtn = document.getElementById('rep2-form-save-otro');
  if (otroBtn) otroBtn.style.display = id ? 'none' : '';
  // Dar de baja solo tiene sentido con el repuesto ya guardado.
  const rotBtn = document.getElementById('rep2-form-rotura');
  if (rotBtn) rotBtn.style.display = id ? '' : 'none';

  if (id) {
    const r = REPUESTOS.find(x => x.id === id);
    if (!r) return;
    title.textContent = '✏️ Editar Repuesto';
    delWrap.style.display = '';
    document.getElementById('rep2-fi-nombre').value      = r.nombre          || '';
    document.getElementById('rep2-fi-marca').value       = r.marca           || '';
    document.getElementById('rep2-fi-modelo').value      = r.modelo          || '';
    document.getElementById('rep2-fi-tipo').value        = r.tipo            || '';
    document.getElementById('rep2-fi-cantidad').value    = r.cantidad        ?? '';
    document.getElementById('rep2-fi-stockmin').value    = r.stockMin        ?? '';
    document.getElementById('rep2-fi-costoUSD').value    = r.precioCostoUSD  ?? '';
    document.getElementById('rep2-fi-precioVenta').value = r.precioVenta     ?? '';
    const codEl = document.getElementById('rep2-fi-codigo');
    if (codEl) codEl.value = r.codigo || '';
    document.getElementById('rep2-fi-proveedor').value   = r.proveedor       || '';
    document.getElementById('rep2-fi-notas').value       = r.notas           || '';
  } else {
    title.textContent = '🔩 Nuevo Repuesto';
    delWrap.style.display = 'none';
    // El código también: sin esto, abrir uno viejo y después "nuevo" dejaba
    // el código del anterior en el campo y se guardaba repetido.
    ['rep2-fi-nombre','rep2-fi-marca','rep2-fi-modelo','rep2-fi-codigo',
     'rep2-fi-cantidad','rep2-fi-stockmin',
     'rep2-fi-costoUSD','rep2-fi-precioVenta',
     'rep2-fi-proveedor','rep2-fi-notas'].forEach(i => {
       const el = document.getElementById(i); if (el) el.value = '';
    });
    document.getElementById('rep2-fi-tipo').value = '';
  }

  // Hint del costo en pesos al lado del costo USD
  _updateCostoARSHint();
  _bindRepuestoEnter();

  document.getElementById('rep2-form-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('rep2-fi-nombre').focus(), 300);
}

// Enter en cualquier campo del form guarda el repuesto (en Notas hace salto de línea).
function _bindRepuestoEnter() {
  const modal = document.getElementById('rep2-form-modal');
  if (!modal || modal._enterBound) return;
  modal._enterBound = true;
  modal.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!t || t.tagName === 'TEXTAREA') return;  // Notas: Enter = nueva línea
    e.preventDefault();
    saveRepuesto();
  });
}

// Actualiza el hint "= $X.XXX" al costado del input de Costo USD
function _updateCostoARSHint() {
  const usdEl  = document.getElementById('rep2-fi-costoUSD');
  const hintEl = document.getElementById('rep2-fi-costoARS-hint');
  if (!usdEl || !hintEl) return;
  const usd = parseFloat(usdEl.value) || 0;
  const dolar = (typeof dolarBlue === 'number' && dolarBlue > 0) ? dolarBlue : 0;
  if (usd > 0 && dolar > 0) {
    hintEl.textContent = ` ≈ $${Math.round(usd * dolar).toLocaleString('es-AR')}`;
  } else if (usd > 0 && !dolar) {
    hintEl.textContent = ' (cargá el dólar en Configuración)';
  } else {
    hintEl.textContent = '';
  }
}

// ── Roturas ───────────────────────────────────────────────
// Las pantallas se rompen al colocarlas más seguido que los vidrios. Es el
// mismo cartel de Accesorios (roturas.js), con la colección de repuestos.
function repuRotura() {
  const r = REPUESTOS.find(x => x.id === editingRepuestoId);
  if (!r) { toast('Guardá el repuesto primero', 'error'); return; }
  if (typeof tpRotura !== 'function') return;
  const d = (typeof dolarBlue === 'number' && dolarBlue > 0) ? dolarBlue : 0;
  const usd = Number(r.precioCostoUSD) || 0;
  tpRotura({
    coleccion: 'repuestos', campoStock: 'cantidad', origen: 'repuesto',
    item: { id: r.id, nombre: r.nombre, codigo: r.codigo, categoria: r.tipo,
            stock: Number(r.cantidad) || 0 },
    costo: usd > 0 && d > 0 ? Math.round(usd * d) : (Number(r.precioCompra) || 0),
    alTerminar: closeRepuestoForm,
  });
}

// ══════════════════════════════════════════
//  SELECCIONAR VARIOS — imprimir o eliminar en masa
// ══════════════════════════════════════════
// Menú → ☑️ Seleccionar varios. Tocar una tarjeta la marca; abajo aparece una
// barra con cuántos van. "Todos" marca los de la lista que estás viendo, con
// la búsqueda y los filtros puestos: para "todas las pantallas Samsung" se
// filtra y se toca Todos. Rehacer la lista entera era ir de a uno por el
// botón de cada ficha, o borrar la colección desde la consola de Firebase.
let _repuSelModo = false;
let _repuSel = new Set();

function repuSelEntrar() {
  _repuSelModo = true;
  _repuSel = new Set();
  const l = document.getElementById('rep2-list');
  if (l) l.style.paddingBottom = '80px';   // que la barra no tape el último
  renderRepuestos();
  _repuSelBarra();
  toast('Tocá los repuestos para marcarlos', 'info');
}

function repuSelSalir() {
  _repuSelModo = false;
  _repuSel = new Set();
  document.getElementById('rep2-sel-barra')?.remove();
  const l = document.getElementById('rep2-list');
  if (l) l.style.paddingBottom = '';
  renderRepuestos();
}

function _repuSelToggle(id) {
  if (_repuSel.has(id)) _repuSel.delete(id); else _repuSel.add(id);
  renderRepuestos();
  _repuSelBarra();
}

function repuSelTodos() {
  const ids = _rep2Filtrados().map(r => r.id);
  // Si ya estaban todos marcados, el mismo botón los desmarca.
  const todos = ids.length && ids.every(id => _repuSel.has(id));
  ids.forEach(id => todos ? _repuSel.delete(id) : _repuSel.add(id));
  renderRepuestos();
  _repuSelBarra();
}

function _repuSelBarra() {
  if (!_repuSelModo) return;
  let b = document.getElementById('rep2-sel-barra');
  if (!b) {
    b = document.createElement('div');
    b.id = 'rep2-sel-barra';
    b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:900;display:flex;gap:8px;align-items:center;' +
      'padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:var(--card,#fff);' +
      'border-top:1px solid var(--border);box-shadow:0 -4px 16px rgba(0,0,0,.12)';
    document.body.appendChild(b);
  }
  const n = _repuSel.size;
  // Compactos a propósito: con el padding normal, en un teléfono "3 marcados"
  // se parte en dos renglones.
  const chico = 'padding:9px 13px;font-size:14px;flex-shrink:0';
  b.innerHTML = `
    <b style="flex:1;min-width:0;font-size:15px;white-space:nowrap">${n} marcado${n === 1 ? '' : 's'}</b>
    <button class="btn-secondary" style="${chico}" onclick="repuSelTodos()">Todos</button>
    <button class="btn-primary" style="${chico}" ${n ? '' : 'disabled'} onclick="repuSelAcciones()">Acciones</button>
    <button class="btn-secondary" style="${chico}" onclick="repuSelSalir()" title="Salir">✕</button>`;
}

function _repuSelLista() {
  return REPUESTOS.filter(r => _repuSel.has(r.id));
}

function repuSelAcciones() {
  const n = _repuSel.size;
  if (!n || typeof openSheet !== 'function') return;
  openSheet(`${n} repuesto${n === 1 ? '' : 's'}`, [
    { icon: '🏷️', label: 'Imprimir etiquetas', sub: 'Las de los marcados',
      onClick: () => { closeSheet(); repuSelEtiquetas(); } },
    { divider: true },
    { icon: '🗑️', label: 'Eliminar', sub: 'No se puede deshacer (dueño, con PIN)', danger: true,
      onClick: () => { closeSheet(); repuSelEliminar(); } },
  ]);
}

function repuSelEtiquetas() {
  const lista = _repuSelLista();
  if (!lista.length) return;
  if (typeof printEtiquetasRepuestos !== 'function') { toast('No se puede imprimir desde acá', 'error'); return; }
  const copias = prompt(`${lista.length} repuesto${lista.length > 1 ? 's' : ''} marcado${lista.length > 1 ? 's' : ''}.\n¿Cuántas etiquetas de cada uno?`, '1');
  if (copias === null) return;
  printEtiquetasRepuestos(lista, Number(copias) || 1);
}

// Firestore acepta hasta 500 escrituras por tanda: rehacer la lista entera
// son cientos de repuestos, así que va de a 450.
async function _repuSelBorrar(lista) {
  for (let i = 0; i < lista.length; i += 450) {
    const batch = db.batch();
    lista.slice(i, i + 450).forEach(r => batch.delete(db.collection('repuestos').doc(r.id)));
    await batch.commit();
  }
}

function repuSelEliminar() {
  if (typeof tpFrenar === 'function' && tpFrenar('borrar', 'borrar repuestos')) return;
  const lista = _repuSelLista();
  if (!lista.length) return;
  const muestra = lista.slice(0, 5).map(r => '• ' + (r.nombre || '(sin nombre)')).join('\n') +
                  (lista.length > 5 ? `\n… y ${lista.length - 5} más` : '');
  if (!confirm(`¿ELIMINAR ${lista.length} repuesto${lista.length === 1 ? '' : 's'}?\n\n${muestra}\n\n` +
               `No se puede deshacer. Bajate el Excel antes (⋮ → Exportar / Importar).`)) return;

  const hacer = async () => {
    try {
      await _repuSelBorrar(lista);
      toast(`🗑️ ${lista.length} repuesto${lista.length === 1 ? '' : 's'} eliminado${lista.length === 1 ? '' : 's'}`, 'success');
      repuSelSalir();
    } catch (e) {
      console.error('[repuestos] eliminar en masa:', e);
      toast(e?.code === 'permission-denied' ? 'Sin permiso para borrar' : 'Error al eliminar', 'error');
    }
  };
  // Un empleado con permiso de borrar ya pasó el freno de arriba; al dueño se
  // le pide el PIN, que es el mismo que para borrar uno solo.
  const empleadoPuede = typeof tpEmpleadoPuede === 'function' && tpEmpleadoPuede('borrar');
  if (!empleadoPuede && typeof requireOwnerPin === 'function') {
    requireOwnerPin(hacer, `PIN de dueño para eliminar ${lista.length} repuestos`);
  } else hacer();
}

// ══════════════════════════════════════════
//  ETIQUETAS DE REPUESTOS
// ══════════════════════════════════════════
// Sale lo que está a la vista: filtrás por marca o tipo y salen esas.
function imprimirEtiquetasRep2() {
  if (typeof closeRep2Menu === 'function') closeRep2Menu();
  const lista = _rep2Filtrados();
  if (!lista.length) { toast('No hay repuestos en la lista', 'error'); return; }
  if (typeof printEtiquetasRepuestos !== 'function') { toast('No se puede imprimir desde acá', 'error'); return; }
  const copias = prompt(`${lista.length} repuesto${lista.length > 1 ? 's' : ''} a la vista.\n¿Cuántas etiquetas de cada uno?`, '1');
  if (copias === null) return;
  printEtiquetasRepuestos(lista, Number(copias) || 1);
}

// Al terminar una tanda: las etiquetas de todo lo que cargaste hoy, sin
// acordarte cuáles fueron. Es el momento en que se etiqueta la mercadería
// recién llegada, que es para lo que se carga.
function etiquetasDeHoyRep2() {
  const hoy = REPUESTOS.filter(_repuEsDeHoy);
  if (!hoy.length) { toast('No cargaste repuestos hoy', 'info'); return; }
  if (typeof printEtiquetasRepuestos !== 'function') { toast('No se puede imprimir desde acá', 'error'); return; }
  const copias = prompt(`${hoy.length} repuesto${hoy.length > 1 ? 's' : ''} cargado${hoy.length > 1 ? 's' : ''} hoy.\n¿Cuántas etiquetas de cada uno?`, '1');
  if (copias === null) return;
  printEtiquetasRepuestos(hoy, Number(copias) || 1);
}

// Una sola, desde la ficha.
function imprimirEtiquetaRepuesto(id) {
  const rep = REPUESTOS.find(x => x.id === (id || editingRepuestoId));
  if (!rep) { toast('Guardá el repuesto primero', 'error'); return; }
  if (typeof printEtiquetasRepuestos !== 'function') { toast('No se puede imprimir desde acá', 'error'); return; }
  const copias = prompt('¿Cuántas etiquetas?', '1');
  if (copias === null) return;
  printEtiquetasRepuestos([rep], Number(copias) || 1);
}

// ── Códigos internos para los repuestos que no tienen ──
// El número lo reparte un contador común con los accesorios (ver
// tpReservarCodigos en utils.js): dos cosas con el mismo código serían la misma
// cosa para la caja, que busca primero en accesorios y después acá.
async function generarCodigosRep2() {
  if (typeof closeRep2Menu === 'function') closeRep2Menu();
  const sin = REPUESTOS.filter(r => !String(r.codigo || '').trim());
  if (!sin.length) { toast('Todos los repuestos ya tienen código', 'success'); return; }
  if (!confirm(`${sin.length} repuesto${sin.length > 1 ? 's' : ''} sin código.\n¿Les genero uno interno (TP…)?`)) return;
  try {
    const codigos = await tpReservarCodigos(db, sin.length, tpMaxCodigoLocal(REPUESTOS));
    const batch = db.batch();
    sin.forEach((rep, i) => batch.update(db.collection('repuestos').doc(rep.id), { codigo: codigos[i] }));
    await batch.commit();
    toast(`✅ ${sin.length} código${sin.length > 1 ? 's' : ''} generado${sin.length > 1 ? 's' : ''}`, 'success');
  } catch (e) {
    console.error('generarCodigosRep2:', e);
    toast('No se pudieron generar', 'error');
  }
}

function closeRepuestoForm() {
  document.getElementById('rep2-form-modal').classList.add('hidden');
  document.body.style.overflow = '';
  editingRepuestoId = null;
}

function saveRepuesto(opts) {
  if (typeof tpFrenar === 'function' && tpFrenar('inventario', 'cargar o editar repuestos')) return;
  const nombre         = document.getElementById('rep2-fi-nombre').value.trim();
  const marca          = document.getElementById('rep2-fi-marca').value.trim();
  const modelo         = document.getElementById('rep2-fi-modelo').value.trim();
  const tipo           = document.getElementById('rep2-fi-tipo').value;
  const cantidad       = parseInt(document.getElementById('rep2-fi-cantidad').value) || 0;
  const stockMin       = parseInt(document.getElementById('rep2-fi-stockmin').value) || 0;
  const precioCostoUSD = parseFloat(document.getElementById('rep2-fi-costoUSD').value)    || 0;
  const precioVenta    = parseFloat(document.getElementById('rep2-fi-precioVenta').value) || 0;
  // Campo NUEVO: los repuestos que ya están guardados no lo tienen y siguen
  // funcionando igual. La caja ya buscaba por acá (`CAJA_REPUESTOS.codigo`),
  // solo que nunca había dónde cargarlo.
  const codigo = (document.getElementById('rep2-fi-codigo')?.value || '').trim().toUpperCase();
  const proveedor      = document.getElementById('rep2-fi-proveedor').value.trim();
  const notas          = document.getElementById('rep2-fi-notas').value.trim();

  if (!nombre) { toast('Ingresá el nombre del repuesto', 'error'); return; }
  if (!marca)  { toast('Ingresá la marca', 'error'); return; }
  if (!tipo)   { toast('Seleccioná el tipo', 'error'); return; }

  // precioCompra (legacy) = costo en pesos al momento del guardado, para reportes/back-compat.
  // El canónico es precioCostoUSD; se recalcula dinámicamente con dolarBlue actual.
  const dolar = (typeof dolarBlue === 'number' && dolarBlue > 0) ? dolarBlue : 0;
  const precioCompra = precioCostoUSD > 0 && dolar > 0 ? Math.round(precioCostoUSD * dolar) : 0;

  const data = { nombre, marca, modelo, tipo, cantidad, stockMin,
                 precioCostoUSD, precioVenta, precioCompra, codigo,
                 proveedor, notas };

  // Devuelve la promesa: el guardado es asíncrono (reserva el código).
  return _guardarRepuesto(data, !!codigo, opts);
}

// El campo del código dice "Vacío = se genera uno (TP…)" desde que existe, pero
// no lo generaba nadie: se guardaba en blanco. Sin código no hay etiqueta ni
// se escanea en la caja, que es justo para lo que se carga el repuesto.
async function _guardarRepuesto(data, teniaCodigo, opts) {
  const seguir = !!(opts && opts.seguir);
  const btn = document.getElementById(seguir ? 'rep2-form-save-otro' : 'rep2-form-save');
  if (btn) btn.disabled = true;
  try {
    if (!data.codigo && typeof tpReservarCodigos === 'function') {
      try {
        const maxLocal = (typeof tpMaxCodigoLocal === 'function') ? tpMaxCodigoLocal(REPUESTOS) : 0;
        data.codigo = (await tpReservarCodigos(db, 1, maxLocal))[0] || '';
      } catch (e) {
        // Sin internet se guarda igual, sin código: frenar la carga sería peor.
        // Queda para "Generar códigos de barras" del menú.
        console.error('[repuestos] reservar código:', e);
      }
    }
    if (editingRepuestoId) {
      await db.collection('repuestos').doc(editingRepuestoId).set(data, { merge: true });
      toast('Repuesto actualizado ✅', 'success');
    } else {
      const ref = db.collection('repuestos').doc();
      await ref.set({ id: ref.id, ...data, fechaAlta: new Date().toISOString() });
      toast('Repuesto agregado ✅' + (!teniaCodigo && data.codigo ? ' · ' + data.codigo : ''), 'success');
    }
    if (seguir) _repuSiguiente(data);
    else closeRepuestoForm();
  } catch (e) {
    console.error('[repuestos] guardar:', e);
    toast('Error al guardar', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Deja el formulario listo para el que viene. Se conservan tipo, marca,
// proveedor y stock mínimo: en una tanda suelen repetirse, y volver a
// escribirlos en cada repuesto es tiempo perdido.
function _repuSiguiente(data) {
  editingRepuestoId = null;
  const t = document.getElementById('rep2-form-title');
  if (t) t.textContent = '🔩 Nuevo Repuesto';
  ['rep2-fi-nombre', 'rep2-fi-modelo', 'rep2-fi-codigo', 'rep2-fi-cantidad',
   'rep2-fi-costoUSD', 'rep2-fi-precioVenta', 'rep2-fi-notas'].forEach(i => {
    const el = document.getElementById(i); if (el) el.value = '';
  });
  const etq = document.getElementById('rep2-form-etq');
  if (etq) etq.style.display = 'none';
  const del = document.getElementById('rep2-delete-wrap');
  if (del) del.style.display = 'none';
  _updateCostoARSHint();
  const nom = document.getElementById('rep2-fi-nombre');
  if (nom) setTimeout(() => nom.focus(), 60);
}

function deleteRepuesto(id) {
  if (!id) return;
  if (typeof tpFrenar === 'function' && tpFrenar('borrar', 'borrar repuestos')) return;
  if (!confirm('¿Eliminar este repuesto del sistema?')) return;
  db.collection('repuestos').doc(id).delete()
    .then(() => { toast('Repuesto eliminado', 'success'); closeRepuestoForm(); })
    .catch(() => toast('Error al eliminar', 'error'));
}

// ══════════════════════════════════════════
//  CONTROL DE STOCK GUIADO (WIZARD v2)
// ══════════════════════════════════════════

const STOCKWIZ_TIPOS = ['Pantalla','Batería','Conector','Flex','Táctil','Cámara','Parlante','Micrófono','Marco','Otro'];

const STOCKWIZ_ICONS = {
  'Pantalla':'📱','Batería':'🔋','Conector':'🔌','Flex':'🔗',
  'Táctil':'👆','Cámara':'📷','Parlante':'🔊','Micrófono':'🎤',
  'Marco':'🖼️','Otro':'🔧'
};

let _stockwizList = [];
let _stockwizIdx  = 0;
let _stockwizStats = { actualizados: 0, omitidos: 0 };
let _stockwizKbHandler = null;

function openStockWizard() {
  // Llenar selects de filtro
  const tSel = document.getElementById('stockwiz-f-tipo');
  const mSel = document.getElementById('stockwiz-f-marca');
  while (tSel.options.length > 1) tSel.remove(1);
  while (mSel.options.length > 1) mSel.remove(1);
  STOCKWIZ_TIPOS.forEach(t => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t; tSel.appendChild(o);
  });
  const marcas = [...new Set(REPUESTOS.map(r => r.marca).filter(Boolean))].sort();
  marcas.forEach(m => {
    const o = document.createElement('option');
    o.value = m; o.textContent = m; mSel.appendChild(o);
  });

  // Reset
  tSel.value = ''; mSel.value = '';
  document.getElementById('stockwiz-f-bajo').checked = false;
  document.getElementById('stockwiz-f-sincalidad').checked = false;
  _stockwizList = []; _stockwizIdx = 0;
  _stockwizStats = { actualizados: 0, omitidos: 0 };

  // Mostrar paso filtro
  document.getElementById('stockwiz-step-filter').classList.remove('hidden');
  document.getElementById('stockwiz-step-item').classList.add('hidden');
  document.getElementById('stockwiz-step-done').classList.add('hidden');
  document.getElementById('stockwiz-modal').classList.remove('hidden');

  // Listeners para contador en vivo
  ['stockwiz-f-tipo','stockwiz-f-marca','stockwiz-f-bajo','stockwiz-f-sincalidad'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._wizListener) {
      el.addEventListener('change', _stockwizUpdateCount);
      el._wizListener = true;
    }
  });
  _stockwizUpdateCount();

  // Atajos de teclado
  if (!_stockwizKbHandler) {
    _stockwizKbHandler = e => {
      if (document.getElementById('stockwiz-modal')?.classList.contains('hidden')) return;
      if (e.key === 'Escape') { closeStockWizard(); return; }
      if (!document.getElementById('stockwiz-step-item')?.classList.contains('hidden')) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _stockwizSaveNext(); }
        else if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); _stockwizSkip(); }
        else if (e.key === 'ArrowLeft'  && e.altKey) { e.preventDefault(); _stockwizPrev(); }
      }
    };
    document.addEventListener('keydown', _stockwizKbHandler);
  }
}

function closeStockWizard() {
  document.getElementById('stockwiz-modal').classList.add('hidden');
  if (_stockwizKbHandler) {
    document.removeEventListener('keydown', _stockwizKbHandler);
    _stockwizKbHandler = null;
  }
}

function _stockwizConfirmExit() {
  const restantes = _stockwizList.length - _stockwizIdx;
  if (_stockwizStats.actualizados > 0 && restantes > 0) {
    if (!confirm(`Te quedan ${restantes} repuestos por revisar. ¿Salir igual?`)) return;
  }
  closeStockWizard();
}

function _stockwizFilterList() {
  const fT = document.getElementById('stockwiz-f-tipo').value;
  const fM = document.getElementById('stockwiz-f-marca').value;
  const fBajo = document.getElementById('stockwiz-f-bajo').checked;
  const fSinCal = document.getElementById('stockwiz-f-sincalidad').checked;

  return REPUESTOS.filter(r => {
    if (fT && r.tipo !== fT) return false;
    if (fM && r.marca !== fM) return false;
    if (fBajo) {
      const sm = Number(r.stockMin) || 0;
      if (sm <= 0 || (Number(r.cantidad) || 0) > sm) return false;
    }
    if (fSinCal && r.calidad) return false;
    return true;
  });
}

function _stockwizUpdateCount() {
  const list = _stockwizFilterList();
  const el = document.getElementById('stockwiz-count');
  const btn = document.getElementById('stockwiz-start-btn');
  if (el) el.textContent = list.length === 0
    ? 'Ningún repuesto coincide'
    : `${list.length} repuesto${list.length !== 1 ? 's' : ''} para revisar`;
  if (btn) btn.disabled = list.length === 0;
}

function _stockwizStart() {
  _stockwizList = _stockwizFilterList();
  if (!_stockwizList.length) { toast('No hay repuestos que coincidan', 'info'); return; }
  _stockwizIdx = 0;
  _stockwizStats = { actualizados: 0, omitidos: 0 };
  document.getElementById('stockwiz-step-filter').classList.add('hidden');
  document.getElementById('stockwiz-step-item').classList.remove('hidden');
  _stockwizRender();
}

function _stockwizRender() {
  if (_stockwizIdx >= _stockwizList.length) { _stockwizFinish(); return; }
  const r = _stockwizList[_stockwizIdx];
  const total = _stockwizList.length;
  const num = _stockwizIdx + 1;

  // Progreso
  document.getElementById('stockwiz-progress-fill').style.width = (num / total * 100) + '%';
  document.getElementById('stockwiz-progress-txt').textContent = `${num} / ${total}`;

  // Info repuesto
  document.getElementById('stockwiz-item-icon').textContent = STOCKWIZ_ICONS[r.tipo] || '🔧';
  document.getElementById('stockwiz-item-nombre').textContent = r.nombre || '(sin nombre)';
  const meta = [r.tipo, r.marca, r.modelo].filter(Boolean).join(' · ');
  document.getElementById('stockwiz-item-meta').textContent = meta || '—';

  // Tags (info adicional: stock bajo, sin precio, etc)
  const tags = [];
  const cant = Number(r.cantidad) || 0;
  const sm   = Number(r.stockMin) || 0;
  if (sm > 0 && cant <= sm) tags.push(`<span class="swz-tag swz-tag-bajo">⚠️ Bajo stock (mín ${sm})</span>`);
  if (cant === 0)           tags.push(`<span class="swz-tag swz-tag-bajo">Sin stock</span>`);
  if (cant > sm && cant > 0) tags.push(`<span class="swz-tag swz-tag-stock">${cant} u.</span>`);
  document.getElementById('stockwiz-item-tags').innerHTML = tags.join('');

  // Valores actuales
  document.getElementById('stockwiz-cur-cant').textContent = `Actual: ${cant}`;
  document.getElementById('stockwiz-cur-pv').textContent   = `Actual: $${Number(r.precioVenta || 0).toLocaleString('es-AR')}`;
  document.getElementById('stockwiz-cur-cal').textContent  = `Actual: ${r.calidad || '—'}`;

  // Pre-cargar inputs
  const cantInput = document.getElementById('stockwiz-fi-cant');
  const pvInput   = document.getElementById('stockwiz-fi-pv');
  cantInput.value = cant;
  pvInput.value   = Number(r.precioVenta) || 0;

  // Marcar chip de calidad activo
  document.querySelectorAll('#stockwiz-cal-grid .swz-q-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cal === (r.calidad || ''));
  });

  // Quitar marcas de "campo cambiado"
  ['stockwiz-fld-cant','stockwiz-fld-pv','stockwiz-fld-cal'].forEach(id => {
    document.getElementById(id)?.classList.remove('swz-field-changed');
  });

  // Listeners para detectar cambios y marcar
  cantInput.oninput = () => {
    const v = parseInt(cantInput.value);
    document.getElementById('stockwiz-fld-cant').classList.toggle('swz-field-changed',
      !isNaN(v) && v !== (Number(r.cantidad) || 0));
  };
  pvInput.oninput = () => {
    const v = parseFloat(pvInput.value);
    document.getElementById('stockwiz-fld-pv').classList.toggle('swz-field-changed',
      !isNaN(v) && v !== (Number(r.precioVenta) || 0));
  };

  // Botón anterior
  document.getElementById('stockwiz-prev-btn').disabled = (_stockwizIdx === 0);

  // Scroll al inicio
  document.querySelector('#stockwiz-step-item .swz-body')?.scrollTo(0, 0);
}

function _stockwizStep(field, delta) {
  if (field === 'cant') {
    const inp = document.getElementById('stockwiz-fi-cant');
    const cur = parseInt(inp.value) || 0;
    inp.value = Math.max(0, cur + delta);
    inp.dispatchEvent(new Event('input'));
  }
}

function _stockwizSetCant(val) {
  const inp = document.getElementById('stockwiz-fi-cant');
  inp.value = val;
  inp.dispatchEvent(new Event('input'));
}

function _stockwizSetCal(cal) {
  document.querySelectorAll('#stockwiz-cal-grid .swz-q-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cal === cal);
  });
  // Marcar campo como cambiado si difiere del actual
  const r = _stockwizList[_stockwizIdx];
  if (r) {
    document.getElementById('stockwiz-fld-cal').classList.toggle('swz-field-changed',
      cal !== (r.calidad || ''));
  }
}

function _stockwizGetCal() {
  const active = document.querySelector('#stockwiz-cal-grid .swz-q-chip.active');
  return active ? active.dataset.cal : '';
}

function _stockwizPrev() {
  if (_stockwizIdx > 0) { _stockwizIdx--; _stockwizRender(); }
}

function _stockwizSkip() {
  _stockwizStats.omitidos++;
  _stockwizIdx++;
  _stockwizRender();
}

async function _stockwizSaveNext() {
  const r = _stockwizList[_stockwizIdx];
  if (!r) return;

  const cant = parseInt(document.getElementById('stockwiz-fi-cant').value);
  const pv   = parseFloat(document.getElementById('stockwiz-fi-pv').value);
  const cal  = _stockwizGetCal();

  const update = {};
  if (!isNaN(cant) && cant !== (Number(r.cantidad) || 0)) update.cantidad = cant;
  if (!isNaN(pv)   && pv   !== (Number(r.precioVenta) || 0)) update.precioVenta = pv;
  if (cal !== (r.calidad || '')) update.calidad = cal;

  if (Object.keys(update).length === 0) {
    _stockwizStats.omitidos++;
    _stockwizIdx++;
    _stockwizRender();
    return;
  }

  try {
    await db.collection('repuestos').doc(r.id).set(update, { merge: true });
    Object.assign(r, update);
    _stockwizStats.actualizados++;
    _stockwizIdx++;
    _stockwizRender();
  } catch (e) {
    console.error('stockwiz save:', e);
    toast('Error al guardar', 'error');
  }
}

function _stockwizFinish() {
  document.getElementById('stockwiz-step-item').classList.add('hidden');
  document.getElementById('stockwiz-step-done').classList.remove('hidden');
  const stats = _stockwizStats;
  const total = _stockwizList.length;
  const restantes = Math.max(0, total - _stockwizIdx);
  document.getElementById('stockwiz-done-stats').innerHTML = `
    <div class="swz-done-stat">
      <span class="swz-done-stat-lbl">✏️ Actualizados</span>
      <span class="swz-done-stat-val swz-good">${stats.actualizados}</span>
    </div>
    <div class="swz-done-stat">
      <span class="swz-done-stat-lbl">⏭ Omitidos</span>
      <span class="swz-done-stat-val">${stats.omitidos}</span>
    </div>
    <div class="swz-done-stat">
      <span class="swz-done-stat-lbl">📦 Sin revisar</span>
      <span class="swz-done-stat-val">${restantes}</span>
    </div>
    <div class="swz-done-stat">
      <span class="swz-done-stat-lbl">📊 Total recorrido</span>
      <span class="swz-done-stat-val">${stats.actualizados + stats.omitidos} / ${total}</span>
    </div>
  `;
}

function toggleLowStockBanner() {
  const list = document.getElementById('rep2-lowstock-list');
  const chevron = document.getElementById('rep2-lowstock-chevron');
  if (!list) return;
  const isOpen = !list.classList.contains('hidden');
  list.classList.toggle('hidden', isOpen);
  if (chevron) chevron.classList.toggle('open', !isOpen);
}
