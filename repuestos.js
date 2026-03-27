// ══════════════════════════════════════════
//  REPUESTOS
// ══════════════════════════════════════════

let REPUESTOS         = [];
let editingRepuestoId = null;
let rep2RenderTimer;

// ── Firebase ──────────────────────────────
function listenRepuestos() {
  db.collection('repuestos').onSnapshot(snap => {
    REPUESTOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    REPUESTOS.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    renderRepuestos();
  }, err => {
    console.error('Repuestos:', err);
    toast('Error cargando repuestos', 'error');
  });
}

// ── Init ──────────────────────────────────
function initRepuestos() {
  document.getElementById('rep2-add-btn').addEventListener('click', () => openRepuestoForm());
  document.getElementById('rep2-search').addEventListener('input', () => {
    clearTimeout(rep2RenderTimer);
    rep2RenderTimer = setTimeout(renderRepuestos, 60);
  });
  document.getElementById('rep2-f-tipo').addEventListener('change', renderRepuestos);
  document.getElementById('rep2-f-marca').addEventListener('change', renderRepuestos);
  document.getElementById('rep2-form-close').addEventListener('click', closeRepuestoForm);
  document.getElementById('rep2-form-cancel').addEventListener('click', closeRepuestoForm);
  document.getElementById('rep2-form-save').addEventListener('click', saveRepuesto);
  document.getElementById('rep2-delete-btn').addEventListener('click', () => deleteRepuesto(editingRepuestoId));
  document.getElementById('rep2-form-modal').addEventListener('click', e => {
    if (e.target.id === 'rep2-form-modal') closeRepuestoForm();
  });
  initCatalogAutocomplete();
  listenRepuestos();
}

// ── Autocompletado desde catálogo de módulos ───────────────
function initCatalogAutocomplete() {
  if (typeof MODULOS_CATALOG === 'undefined') return;
  const input = document.getElementById('rep2-fi-nombre');
  const list  = document.getElementById('rep2-ac-list');
  if (!input || !list) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { list.classList.add('hidden'); return; }

    const matches = MODULOS_CATALOG.filter(([marca, nombre]) =>
      nombre.toLowerCase().includes(q) || marca.toLowerCase().includes(q)
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
function renderRepuestos() {
  const q      = (document.getElementById('rep2-search').value || '').trim().toLowerCase();
  const fTipo  = document.getElementById('rep2-f-tipo').value;
  const fMarca = document.getElementById('rep2-f-marca').value;

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

  let filtered = REPUESTOS.filter(r => {
    if (fTipo  && r.tipo  !== fTipo)  return false;
    if (fMarca && r.marca !== fMarca) return false;
    if (q) {
      const hay = [r.nombre, r.marca, r.modelo, r.tipo, r.proveedor]
        .map(x => String(x || '')).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

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
    const price  = r.precioCompra
      ? '$ ' + Number(r.precioCompra).toLocaleString('es-AR') : '—';

    return `
      <div class="card rep2-card${lowCls}" onclick="openRepuestoForm('${r.id}')">
        <div class="card-top">
          <div class="card-info">
            <span class="card-marca">🔩 ${esc(r.marca || '—')}${r.modelo ? ' · ' + esc(r.modelo) : ''}</span>
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
          <div class="rep2-qty-display" onclick="event.stopPropagation()">
            <button class="rep2-qty-btn rep2-qty-minus" onclick="changeQty('${r.id}',-1)">−</button>
            <span class="rep2-qty-num${isLow ? ' rep2-qty-num--low' : ''}">${r.cantidad ?? 0}</span>
            <button class="rep2-qty-btn rep2-qty-plus" onclick="changeQty('${r.id}',+1)">＋</button>
          </div>
          <div class="card-meta">
            <span class="card-date">${price}</span>
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
  editingRepuestoId = id || null;
  const title = document.getElementById('rep2-form-title');
  const delWrap = document.getElementById('rep2-delete-wrap');

  if (id) {
    const r = REPUESTOS.find(x => x.id === id);
    if (!r) return;
    title.textContent = '✏️ Editar Repuesto';
    delWrap.style.display = '';
    document.getElementById('rep2-fi-nombre').value    = r.nombre       || '';
    document.getElementById('rep2-fi-marca').value     = r.marca        || '';
    document.getElementById('rep2-fi-modelo').value    = r.modelo       || '';
    document.getElementById('rep2-fi-tipo').value      = r.tipo         || '';
    document.getElementById('rep2-fi-cantidad').value  = r.cantidad     ?? '';
    document.getElementById('rep2-fi-stockmin').value  = r.stockMin     ?? '';
    document.getElementById('rep2-fi-precio').value    = r.precioCompra ?? '';
    document.getElementById('rep2-fi-proveedor').value = r.proveedor    || '';
    document.getElementById('rep2-fi-notas').value     = r.notas        || '';
  } else {
    title.textContent = '🔩 Nuevo Repuesto';
    delWrap.style.display = 'none';
    ['rep2-fi-nombre','rep2-fi-marca','rep2-fi-modelo',
     'rep2-fi-cantidad','rep2-fi-stockmin','rep2-fi-precio',
     'rep2-fi-proveedor','rep2-fi-notas'].forEach(i => {
       document.getElementById(i).value = '';
    });
    document.getElementById('rep2-fi-tipo').value = '';
  }

  document.getElementById('rep2-form-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('rep2-fi-nombre').focus(), 300);
}

function closeRepuestoForm() {
  document.getElementById('rep2-form-modal').classList.add('hidden');
  document.body.style.overflow = '';
  editingRepuestoId = null;
}

function saveRepuesto() {
  const nombre       = document.getElementById('rep2-fi-nombre').value.trim();
  const marca        = document.getElementById('rep2-fi-marca').value.trim();
  const modelo       = document.getElementById('rep2-fi-modelo').value.trim();
  const tipo         = document.getElementById('rep2-fi-tipo').value;
  const cantidad     = parseInt(document.getElementById('rep2-fi-cantidad').value) || 0;
  const stockMin     = parseInt(document.getElementById('rep2-fi-stockmin').value) || 0;
  const precioCompra = parseFloat(document.getElementById('rep2-fi-precio').value) || 0;
  const proveedor    = document.getElementById('rep2-fi-proveedor').value.trim();
  const notas        = document.getElementById('rep2-fi-notas').value.trim();

  if (!nombre) { toast('Ingresá el nombre del repuesto', 'error'); return; }
  if (!marca)  { toast('Ingresá la marca', 'error'); return; }
  if (!tipo)   { toast('Seleccioná el tipo', 'error'); return; }

  const data = { nombre, marca, modelo, tipo, cantidad, stockMin,
                 precioCompra, proveedor, notas };

  if (editingRepuestoId) {
    db.collection('repuestos').doc(editingRepuestoId).set(data, { merge: true })
      .then(() => { toast('Repuesto actualizado ✅', 'success'); closeRepuestoForm(); })
      .catch(() => toast('Error al guardar', 'error'));
  } else {
    const ref = db.collection('repuestos').doc();
    ref.set({ id: ref.id, ...data, fechaAlta: new Date().toISOString() })
      .then(() => { toast('Repuesto agregado ✅', 'success'); closeRepuestoForm(); })
      .catch(() => toast('Error al guardar', 'error'));
  }
}

function deleteRepuesto(id) {
  if (!id) return;
  if (!confirm('¿Eliminar este repuesto del sistema?')) return;
  db.collection('repuestos').doc(id).delete()
    .then(() => { toast('Repuesto eliminado', 'success'); closeRepuestoForm(); })
    .catch(() => toast('Error al eliminar', 'error'));
}
