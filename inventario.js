// ══════════════════════════════════════════
//  INVENTARIO DE PRODUCTOS — TechPoint
// ══════════════════════════════════════════

// Colección Firestore: productos
// Schema: { codigo, nombre, categoria, precioVenta, precioCosto, stock, stockMin, activo, fechaAlta, updatedAt }

let PRODUCTOS = [];        // array completo (onSnapshot)
let PRODUCTOS_MAP = new Map(); // codigo → producto (O(1) lookup para POS e inventario)
let _invListener = null;
let _invEditingId = null;
let _invScanBuf = '';
let _invScanTimer = null;

const INV_CATEGORIAS = [
  'Accesorio', 'Vidrio templado / Hidrogel', 'Cable', 'Cargador',
  'Auricular', 'Funda / Cover', 'Repuesto', 'Otro'
];

// ── Inicializar ─────────────────────────────────────────────
function initInventario() {
  _listenProductos();
  _initInvScanInput();

  document.getElementById('inv-add-btn').addEventListener('click', () => openProductoForm());
  document.getElementById('inv-search').addEventListener('input', renderInventario);
  document.getElementById('inv-f-cat').addEventListener('change', renderInventario);
  document.getElementById('inv-f-estado').addEventListener('change', renderInventario);

  document.getElementById('inv-form-close').addEventListener('click', closeProductoForm);
  document.getElementById('inv-form-cancel').addEventListener('click', closeProductoForm);
  document.getElementById('inv-form-save').addEventListener('click', saveProducto);
  document.getElementById('inv-form-modal').addEventListener('click', e => {
    if (e.target.id === 'inv-form-modal') closeProductoForm();
  });

  // Llenar select de categorías en el form
  const catSel = document.getElementById('inv-fi-cat');
  INV_CATEGORIAS.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });

  // Llenar filtro de categorías
  const catFilter = document.getElementById('inv-f-cat');
  INV_CATEGORIAS.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    catFilter.appendChild(o);
  });

  // URL param: ?section=inventario&newProducto=CODIGO
  const urlParams = new URLSearchParams(location.search);
  if (urlParams.get('newProducto')) {
    const cod = urlParams.get('newProducto');
    // Esperar a que el listener cargue antes de abrir el form
    setTimeout(() => openProductoForm(null, cod), 800);
    history.replaceState({}, '', location.pathname);
  }
}

// ── Listener Firestore ──────────────────────────────────────
function _listenProductos() {
  if (_invListener) return;
  _invListener = db.collection('productos').orderBy('nombre').onSnapshot(snap => {
    PRODUCTOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    PRODUCTOS_MAP.clear();
    PRODUCTOS.forEach(p => { if (p.codigo) PRODUCTOS_MAP.set(String(p.codigo), p); });
    renderInventario();
  }, err => {
    console.error('Inventario Firestore:', err);
    toast('Error cargando inventario', 'error');
  });
}

// ── Render lista ────────────────────────────────────────────
function renderInventario() {
  const search = (document.getElementById('inv-search')?.value || '').toLowerCase();
  const catF   = document.getElementById('inv-f-cat')?.value || '';
  const estF   = document.getElementById('inv-f-estado')?.value || '';

  let lista = PRODUCTOS;

  if (search) {
    lista = lista.filter(p =>
      (p.nombre || '').toLowerCase().includes(search) ||
      (p.codigo || '').toLowerCase().includes(search) ||
      (p.categoria || '').toLowerCase().includes(search)
    );
  }
  if (catF)  lista = lista.filter(p => p.categoria === catF);
  if (estF === 'activo')    lista = lista.filter(p => p.activo !== false);
  if (estF === 'inactivo')  lista = lista.filter(p => p.activo === false);
  if (estF === 'bajo')      lista = lista.filter(p => p.stockMin > 0 && (p.stock || 0) <= p.stockMin);

  // Stats
  const total   = PRODUCTOS.filter(p => p.activo !== false).length;
  const bajost  = PRODUCTOS.filter(p => p.activo !== false && p.stockMin > 0 && (p.stock || 0) <= p.stockMin).length;
  const valorT  = PRODUCTOS.filter(p => p.activo !== false).reduce((s, p) => s + (p.precioCosto || 0) * (p.stock || 0), 0);
  document.getElementById('inv-s-total').textContent  = total;
  document.getElementById('inv-s-bajo').textContent   = bajost;
  document.getElementById('inv-s-valor').textContent  = '$' + _fmtNum(valorT);

  const el    = document.getElementById('inv-list');
  const empty = document.getElementById('inv-empty');

  if (!lista.length) {
    el.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  el.innerHTML = lista.map(p => {
    const stockOk  = p.stock > 0;
    const stockBaj = p.stockMin > 0 && (p.stock || 0) <= p.stockMin;
    const stockCls = !stockOk ? 'inv-stock-cero' : stockBaj ? 'inv-stock-bajo' : 'inv-stock-ok';
    const inact    = p.activo === false;
    return `<div class="inv-item${inact ? ' inv-item--inactivo' : ''}">
      <div class="inv-item-main" onclick="openProductoForm('${esc(p.id)}')">
        <div class="inv-item-info">
          <span class="inv-item-nombre">${esc(p.nombre)}</span>
          <span class="inv-item-sub">${esc(p.categoria || '')}${p.codigo ? ' · <code>' + esc(p.codigo) + '</code>' : ''}</span>
        </div>
        <div class="inv-item-right">
          <span class="inv-item-precio">$${_fmtNum(p.precioVenta || 0)}</span>
          <span class="inv-item-stock ${stockCls}">${p.stock ?? 0} u.</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function _fmtNum(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Formulario producto ─────────────────────────────────────
function openProductoForm(id, precodigo) {
  _invEditingId = id || null;
  const title = document.getElementById('inv-form-title');
  const delBtn = document.getElementById('inv-form-del');

  _clearProductoForm();

  if (id) {
    const p = PRODUCTOS.find(x => x.id === id);
    if (!p) return;
    title.textContent = '✏️ Editar producto';
    document.getElementById('inv-fi-cod').value   = p.codigo || '';
    document.getElementById('inv-fi-nom').value   = p.nombre || '';
    document.getElementById('inv-fi-cat').value   = p.categoria || '';
    document.getElementById('inv-fi-pv').value    = p.precioVenta ?? '';
    document.getElementById('inv-fi-pc').value    = p.precioCosto ?? '';
    document.getElementById('inv-fi-stock').value = p.stock ?? 0;
    document.getElementById('inv-fi-stockmin').value = p.stockMin ?? 0;
    document.getElementById('inv-fi-activo').checked = p.activo !== false;
    if (delBtn) delBtn.style.display = _invIsOwner() ? '' : 'none';
  } else {
    title.textContent = '➕ Nuevo producto';
    if (precodigo) document.getElementById('inv-fi-cod').value = precodigo;
    if (delBtn) delBtn.style.display = 'none';
  }

  document.getElementById('inv-form-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('inv-fi-nom').focus(), 100);
}

function closeProductoForm() {
  document.getElementById('inv-form-modal').classList.add('hidden');
  _invEditingId = null;
}

function _clearProductoForm() {
  ['inv-fi-cod','inv-fi-nom','inv-fi-pv','inv-fi-pc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('inv-fi-cat').value   = '';
  document.getElementById('inv-fi-stock').value = 0;
  document.getElementById('inv-fi-stockmin').value = 0;
  document.getElementById('inv-fi-activo').checked = true;
}

async function saveProducto() {
  const cod    = document.getElementById('inv-fi-cod').value.trim();
  const nom    = document.getElementById('inv-fi-nom').value.trim();
  const cat    = document.getElementById('inv-fi-cat').value;
  const pv     = parseFloat(document.getElementById('inv-fi-pv').value) || 0;
  const pc     = parseFloat(document.getElementById('inv-fi-pc').value) || 0;
  const stock  = parseInt(document.getElementById('inv-fi-stock').value)    || 0;
  const stmin  = parseInt(document.getElementById('inv-fi-stockmin').value) || 0;
  const activo = document.getElementById('inv-fi-activo').checked;

  if (!nom) { toast('Ingresá el nombre del producto', 'error'); return; }

  // Verificar código duplicado al crear
  if (!_invEditingId && cod && PRODUCTOS_MAP.has(cod)) {
    toast('Ya existe un producto con ese código', 'error');
    return;
  }

  const btn = document.getElementById('inv-form-save');
  btn.disabled = true;

  try {
    const data = {
      codigo: cod, nombre: nom, categoria: cat,
      precioVenta: pv, precioCosto: pc,
      stock, stockMin: stmin, activo,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (_invEditingId) {
      await db.collection('productos').doc(_invEditingId).update(data);
      toast('✅ Producto actualizado', 'success');
    } else {
      data.fechaAlta = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('productos').add(data);
      toast('✅ Producto guardado', 'success');
    }
    closeProductoForm();
  } catch(e) {
    console.error(e);
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
  }
}

function _invIsOwner() {
  if (typeof _cajaIsOwner !== 'undefined') return _cajaIsOwner;
  if (typeof OWNER_MODE !== 'undefined') return OWNER_MODE;
  return false;
}
function _invRequirePin(cb, msg) {
  if (typeof requireCajaOwnerPin === 'function') requireCajaOwnerPin(cb, msg);
  else if (typeof requireOwnerPin === 'function') requireOwnerPin(cb, msg);
  else cb();
}

async function deleteProducto(id) {
  if (!_invIsOwner()) { toast('Requiere modo dueño', 'error'); return; }
  _invRequirePin(async () => {
    try {
      await db.collection('productos').doc(id).delete();
      closeProductoForm();
      toast('Producto eliminado', 'success');
    } catch(e) {
      toast('Error al eliminar', 'error');
    }
  }, 'Confirmar eliminación de producto');
}

// ── Escaneo por código de barras (inventario) ───────────────
// El lector actúa como teclado (keyboard-wedge): tipea el código y envía Enter.
// Usamos un input siempre visible con inputmode="none" para capturar el escaneo.

function _initInvScanInput() {
  const inp = document.getElementById('inv-scan-input');
  if (!inp) return;

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const cod = inp.value.trim();
      inp.value = '';
      if (cod) _handleInvScan(cod);
    }
  });

  // Foco automático cuando la sección es visible
  inp.addEventListener('blur', () => {
    // Si el blur no fue hacia otro input del DOM, volver a enfocar
    setTimeout(() => {
      const active = document.activeElement;
      const invModal = document.getElementById('inv-form-modal');
      if (invModal && !invModal.classList.contains('hidden')) return;
      if (!active || active.tagName === 'BODY') inp.focus();
    }, 150);
  });
}

function focusInvScan() {
  const inp = document.getElementById('inv-scan-input');
  if (inp) inp.focus();
}

function _handleInvScan(codigo) {
  const p = PRODUCTOS_MAP.get(codigo);
  if (p) {
    // Producto existe → abrir form para editar / ajustar stock
    openProductoForm(p.id);
    toast(`📦 ${p.nombre}`, 'info');
  } else {
    // Producto nuevo → abrir form con código pre-cargado
    openProductoForm(null, codigo);
    toast('Código nuevo — completá los datos', 'info');
  }
}
