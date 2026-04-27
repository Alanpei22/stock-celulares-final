// ══════════════════════════════════════════
//  PEDIDOS DE MERCADERÍA — TechPoint
//  Lista de items que faltan, agrupados por categoría.
//  Para luego mandar el pedido al proveedor (export WhatsApp).
// ══════════════════════════════════════════

let PEDIDOS = [];
let _pedidosListener = null;
let _pedidosFilter   = 'pendientes'; // 'pendientes' | 'comprados' | 'todos'
let _pedidoEditingId = null;
let _pedidoSelectedItem = null; // resultado del autocomplete (si aplica)

const PEDIDO_PRIORIDADES = [
  { val: 'urgente', label: '🔴 Urgente' },
  { val: 'normal',  label: '🟡 Normal'  },
  { val: 'baja',    label: '🟢 Cuando se pueda' },
];

const PEDIDO_CATEGORIAS = [
  'Pantalla', 'Módulo', 'Batería', 'Cargador', 'Cable',
  'Auricular', 'Funda', 'Vidrio templado / Hidrogel',
  'Conector', 'Flex', 'Cámara', 'Parlante', 'Micrófono',
  'Marco', 'Herramienta', 'Insumo', 'Otro',
];

// Cleanup expuesto a auth.js (logout)
window._pedidosCleanup = function() {
  if (_pedidosListener) { _pedidosListener(); _pedidosListener = null; }
  PEDIDOS = [];
  _pedidoEditingId = null;
  _pedidoSelectedItem = null;
};

// ── Init ──────────────────────────────────────
function initPedidos() {
  // Listener Firestore (auto-arranca al abrir el modal por primera vez)
  if (!_pedidosListener) listenPedidos();

  // Cerrar modal con click fuera
  const overlay = document.getElementById('pedidos-modal');
  if (overlay) {
    overlay.addEventListener('click', e => {
      if (e.target.id === 'pedidos-modal') closePedidosModal();
    });
  }
  // Cerrar form con click fuera
  const formOverlay = document.getElementById('pedido-form-modal');
  if (formOverlay) {
    formOverlay.addEventListener('click', e => {
      if (e.target.id === 'pedido-form-modal') closePedidoForm();
    });
  }
  // Llenar selects de categorías y prioridad
  _llenarSelectsPedido();
  // Autocomplete del nombre (busca en repuestos + inventario)
  _initPedidoAutocomplete();
}

function _llenarSelectsPedido() {
  const catSel = document.getElementById('pedido-fi-categoria');
  if (catSel && !catSel.options.length) {
    catSel.innerHTML = '<option value="">Seleccionar…</option>' +
      PEDIDO_CATEGORIAS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
  const priSel = document.getElementById('pedido-fi-prioridad');
  if (priSel && !priSel.options.length) {
    priSel.innerHTML = PEDIDO_PRIORIDADES
      .map(p => `<option value="${esc(p.val)}"${p.val === 'normal' ? ' selected' : ''}>${esc(p.label)}</option>`).join('');
  }
}

// ── Listener Firestore ───────────────────────
function listenPedidos() {
  if (_pedidosListener) { _pedidosListener(); _pedidosListener = null; }
  _pedidosListener = db.collection('pedidos').onSnapshot(snap => {
    PEDIDOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Más recientes primero
    PEDIDOS.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    renderPedidos();
  }, err => {
    console.error('Pedidos:', err);
    toast('Error cargando pedidos', 'error');
  });
}

// ── Abrir / cerrar modal principal ───────────
function openPedidosModal() {
  if (typeof closeRep2Menu === 'function') closeRep2Menu();
  // Asegurar listener activo
  if (!_pedidosListener && typeof db !== 'undefined' && db) listenPedidos();
  document.getElementById('pedidos-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  renderPedidos();
}

function closePedidosModal() {
  document.getElementById('pedidos-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── Filtros ──────────────────────────────────
function setPedidosFilter(f) {
  _pedidosFilter = f;
  document.querySelectorAll('.pedido-filter-btn').forEach(b => {
    b.classList.toggle('pedido-filter-active', b.dataset.f === f);
  });
  renderPedidos();
}

// ── Render lista agrupada por categoría ─────
function renderPedidos() {
  const list = document.getElementById('pedidos-list');
  const empty = document.getElementById('pedidos-empty');
  if (!list) return;

  // Filtrado
  let items = PEDIDOS;
  if (_pedidosFilter === 'pendientes') items = items.filter(p => !p.comprado);
  else if (_pedidosFilter === 'comprados') items = items.filter(p => p.comprado);

  // Stats globales (sobre TODOS, no filtrados)
  const pendCount  = PEDIDOS.filter(p => !p.comprado).length;
  const compCount  = PEDIDOS.filter(p => p.comprado).length;
  const urgCount   = PEDIDOS.filter(p => !p.comprado && p.prioridad === 'urgente').length;
  document.getElementById('pedidos-stat-pend').textContent = pendCount;
  document.getElementById('pedidos-stat-comp').textContent = compCount;
  document.getElementById('pedidos-stat-urg').textContent  = urgCount;

  if (!items.length) {
    list.innerHTML = '';
    empty.style.display = '';
    empty.textContent = _pedidosFilter === 'pendientes'
      ? 'No hay items pendientes. ¡Buen trabajo! 🎉'
      : _pedidosFilter === 'comprados'
      ? 'Aún no marcaste nada como comprado.'
      : 'La lista está vacía. Tocá "+ Agregar" para empezar.';
    return;
  }
  empty.style.display = 'none';

  // Agrupar por categoría
  const grupos = {};
  items.forEach(p => {
    const cat = p.categoria || 'Sin categoría';
    (grupos[cat] = grupos[cat] || []).push(p);
  });

  // Orden: urgentes primero, después por categoría alfabética
  const cats = Object.keys(grupos).sort();

  list.innerHTML = cats.map(cat => {
    const itemsCat = grupos[cat];
    // Dentro de la categoría: urgentes primero, después por fecha desc
    itemsCat.sort((a, b) => {
      const pa = _priorityRank(a.prioridad);
      const pb = _priorityRank(b.prioridad);
      if (pa !== pb) return pa - pb;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    const totalItems = itemsCat.reduce((s, p) => s + (Number(p.cantidad) || 1), 0);
    return `
      <div class="pedido-cat-group">
        <div class="pedido-cat-hdr">
          <span class="pedido-cat-title">${esc(cat)}</span>
          <span class="pedido-cat-count">${itemsCat.length} item${itemsCat.length > 1 ? 's' : ''} · ${totalItems} u.</span>
        </div>
        <div class="pedido-cat-list">
          ${itemsCat.map(p => _renderPedidoCard(p)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function _priorityRank(prio) {
  if (prio === 'urgente') return 0;
  if (prio === 'normal')  return 1;
  return 2;
}

function _renderPedidoCard(p) {
  const cant = Number(p.cantidad) || 1;
  const prio = PEDIDO_PRIORIDADES.find(x => x.val === p.prioridad);
  const prioLbl = prio ? prio.label : '🟡 Normal';
  const prioCls = p.prioridad === 'urgente' ? 'urg' : (p.prioridad === 'baja' ? 'baja' : 'normal');
  const fecha = p.createdAt ? _timeAgoShort(p.createdAt) : '';
  const compradoCls = p.comprado ? ' pedido-card--comprado' : '';
  const checkSym = p.comprado ? '✓' : '';
  return `
    <div class="pedido-card${compradoCls}">
      <button class="pedido-check ${p.comprado ? 'pedido-check--on' : ''}"
              onclick="togglePedidoComprado('${p.id}')" title="${p.comprado ? 'Desmarcar' : 'Marcar como comprado'}">
        ${checkSym}
      </button>
      <div class="pedido-info" onclick="openPedidoForm('${p.id}')">
        <div class="pedido-name-row">
          <span class="pedido-name">${esc(p.nombre)}</span>
          <span class="pedido-qty">×${cant}</span>
        </div>
        <div class="pedido-meta">
          <span class="pedido-prio pedido-prio--${prioCls}">${prioLbl}</span>
          ${p.proveedor ? `<span class="pedido-meta-tag">📦 ${esc(p.proveedor)}</span>` : ''}
          ${fecha ? `<span class="pedido-meta-tag">⏱ ${fecha}</span>` : ''}
        </div>
        ${p.notas ? `<div class="pedido-notas">📝 ${esc(p.notas)}</div>` : ''}
      </div>
      <button class="pedido-del-btn" onclick="deletePedido('${p.id}')" title="Eliminar">🗑️</button>
    </div>
  `;
}

function _timeAgoShort(iso) {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 60)   return `hace ${m}min`;
    const h = Math.floor(m / 60);
    if (h < 24)   return `hace ${h}h`;
    const d = Math.floor(h / 24);
    if (d === 1)  return 'ayer';
    if (d < 30)   return `hace ${d}d`;
    return new Date(iso).toLocaleDateString('es-AR', { day:'2-digit', month:'short' });
  } catch { return ''; }
}

// ── Form: agregar / editar ───────────────────
function openPedidoForm(id) {
  _pedidoEditingId = id || null;
  _pedidoSelectedItem = null;
  const title = document.getElementById('pedido-form-title');
  const delWrap = document.getElementById('pedido-delete-wrap');
  _llenarSelectsPedido();

  if (id) {
    const p = PEDIDOS.find(x => x.id === id);
    if (!p) return;
    title.textContent = '✏️ Editar item';
    delWrap.style.display = '';
    document.getElementById('pedido-fi-nombre').value     = p.nombre || '';
    document.getElementById('pedido-fi-cantidad').value   = p.cantidad ?? 1;
    document.getElementById('pedido-fi-categoria').value  = p.categoria || '';
    document.getElementById('pedido-fi-prioridad').value  = p.prioridad || 'normal';
    document.getElementById('pedido-fi-proveedor').value  = p.proveedor || '';
    document.getElementById('pedido-fi-notas').value      = p.notas || '';
  } else {
    title.textContent = '＋ Nuevo item';
    delWrap.style.display = 'none';
    document.getElementById('pedido-fi-nombre').value     = '';
    document.getElementById('pedido-fi-cantidad').value   = 1;
    document.getElementById('pedido-fi-categoria').value  = '';
    document.getElementById('pedido-fi-prioridad').value  = 'normal';
    document.getElementById('pedido-fi-proveedor').value  = '';
    document.getElementById('pedido-fi-notas').value      = '';
  }

  document.getElementById('pedido-form-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('pedido-fi-nombre').focus(), 100);
}

function closePedidoForm() {
  document.getElementById('pedido-form-modal').classList.add('hidden');
  _pedidoEditingId = null;
  _pedidoSelectedItem = null;
  _hidePedidoSuggestions();
}

async function savePedido() {
  const nombre    = document.getElementById('pedido-fi-nombre').value.trim();
  const cantidad  = parseInt(document.getElementById('pedido-fi-cantidad').value) || 1;
  const categoria = document.getElementById('pedido-fi-categoria').value;
  const prioridad = document.getElementById('pedido-fi-prioridad').value || 'normal';
  const proveedor = document.getElementById('pedido-fi-proveedor').value.trim();
  const notas     = document.getElementById('pedido-fi-notas').value.trim();

  if (!nombre) { toast('Ingresá el nombre del item', 'error'); return; }
  if (!categoria) { toast('Elegí una categoría', 'error'); return; }
  if (cantidad < 1) { toast('Cantidad debe ser ≥ 1', 'error'); return; }

  const data = {
    nombre, cantidad, categoria, prioridad,
    proveedor: proveedor || null,
    notas: notas || null,
  };

  // Si vino del autocomplete, guardamos referencia al item original
  if (_pedidoSelectedItem && !_pedidoEditingId) {
    data.itemId = _pedidoSelectedItem.id;
    data.itemSource = _pedidoSelectedItem.source; // 'repuesto' | 'producto'
  }

  try {
    if (_pedidoEditingId) {
      await db.collection('pedidos').doc(_pedidoEditingId).update(data);
      toast('Item actualizado ✅', 'success');
    } else {
      data.createdAt = new Date().toISOString();
      data.comprado = false;
      await db.collection('pedidos').add(data);
      toast('Item agregado ✅', 'success');
    }
    closePedidoForm();
  } catch (e) {
    console.error('savePedido:', e);
    toast('Error al guardar', 'error');
  }
}

async function togglePedidoComprado(id) {
  const p = PEDIDOS.find(x => x.id === id);
  if (!p) return;
  const newVal = !p.comprado;
  try {
    await db.collection('pedidos').doc(id).update({
      comprado: newVal,
      fechaCompra: newVal ? new Date().toISOString() : null,
    });
  } catch {
    toast('Error al actualizar', 'error');
  }
}

async function deletePedido(id) {
  const p = PEDIDOS.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`¿Eliminar "${p.nombre}" de la lista?`)) return;
  try {
    await db.collection('pedidos').doc(id).delete();
    toast('Item eliminado', 'info');
    if (_pedidoEditingId === id) closePedidoForm();
  } catch {
    toast('Error al eliminar', 'error');
  }
}

// ── Acciones bulk ───────────────────────────
async function clearComprados() {
  const comprados = PEDIDOS.filter(p => p.comprado);
  if (!comprados.length) { toast('No hay items comprados para borrar', 'info'); return; }
  if (!confirm(`¿Borrar ${comprados.length} item${comprados.length > 1 ? 's' : ''} ya comprado${comprados.length > 1 ? 's' : ''}?`)) return;
  try {
    let batch = db.batch(), n = 0;
    for (const p of comprados) {
      batch.delete(db.collection('pedidos').doc(p.id));
      n++;
      if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n > 0) await batch.commit();
    toast(`${comprados.length} comprados eliminados`, 'success');
  } catch {
    toast('Error al limpiar', 'error');
  }
}

async function clearAllPedidos() {
  if (!PEDIDOS.length) { toast('La lista ya está vacía', 'info'); return; }
  if (!confirm(`⚠️ ¿BORRAR TODA LA LISTA? (${PEDIDOS.length} items)\n\nEsta acción no se puede deshacer.`)) return;
  try {
    let batch = db.batch(), n = 0;
    for (const p of PEDIDOS) {
      batch.delete(db.collection('pedidos').doc(p.id));
      n++;
      if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n > 0) await batch.commit();
    toast('Lista borrada', 'success');
  } catch {
    toast('Error al borrar', 'error');
  }
}

// ── Exportar a WhatsApp ──────────────────────
function exportPedidoWhatsApp() {
  const pendientes = PEDIDOS.filter(p => !p.comprado);
  if (!pendientes.length) {
    toast('No hay items pendientes para enviar', 'info');
    return;
  }
  // Agrupar por categoría
  const grupos = {};
  pendientes.forEach(p => {
    const c = p.categoria || 'Sin categoría';
    (grupos[c] = grupos[c] || []).push(p);
  });
  const cats = Object.keys(grupos).sort();
  const fecha = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });

  let texto = `*📋 Pedido de mercadería — ${fecha}*\n`;
  texto += `_Total items: ${pendientes.length}_\n\n`;

  for (const cat of cats) {
    const itemsCat = grupos[cat];
    // Urgentes primero
    itemsCat.sort((a, b) => _priorityRank(a.prioridad) - _priorityRank(b.prioridad));
    texto += `*▸ ${cat}* (${itemsCat.length})\n`;
    for (const p of itemsCat) {
      const cant = Number(p.cantidad) || 1;
      const urg = p.prioridad === 'urgente' ? ' 🔴' : '';
      const notas = p.notas ? ` _(${p.notas})_` : '';
      texto += `  • ${p.nombre} × ${cant}${urg}${notas}\n`;
    }
    texto += '\n';
  }
  texto = texto.trim();

  // Si tenemos navigator.share, lo preferimos en mobile
  if (navigator.share) {
    navigator.share({ title: 'Pedido de mercadería', text: texto })
      .catch(() => _fallbackPedidoWA(texto));
    return;
  }
  _fallbackPedidoWA(texto);
}

function _fallbackPedidoWA(texto) {
  const url = `https://wa.me/?text=${encodeURIComponent(texto)}`;
  window.open(url, '_blank');
}

function copyPedidoTextoToClipboard() {
  const pendientes = PEDIDOS.filter(p => !p.comprado);
  if (!pendientes.length) { toast('No hay items pendientes', 'info'); return; }
  const grupos = {};
  pendientes.forEach(p => {
    const c = p.categoria || 'Sin categoría';
    (grupos[c] = grupos[c] || []).push(p);
  });
  const cats = Object.keys(grupos).sort();
  const fecha = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
  let texto = `📋 Pedido de mercadería — ${fecha}\nTotal items: ${pendientes.length}\n\n`;
  for (const cat of cats) {
    texto += `▸ ${cat}\n`;
    grupos[cat].forEach(p => {
      const cant = Number(p.cantidad) || 1;
      const notas = p.notas ? ` (${p.notas})` : '';
      texto += `  • ${p.nombre} × ${cant}${notas}\n`;
    });
    texto += '\n';
  }
  navigator.clipboard?.writeText(texto.trim())
    .then(() => toast('📋 Lista copiada al portapapeles', 'success'))
    .catch(() => toast('No se pudo copiar', 'error'));
}

// ── Autocomplete del nombre ─────────────────
// Reusa la estrategia de caja: busca en repuestos + productos, expandido
// con sinónimos de utils.js (searchMatch). Selecciona auto-completa cat/proveedor.
function _initPedidoAutocomplete() {
  const input = document.getElementById('pedido-fi-nombre');
  if (!input) return;
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', _onPedidoNombreInput);
  input.addEventListener('focus', _onPedidoNombreInput);
  input.addEventListener('blur', () => setTimeout(_hidePedidoSuggestions, 180));
}

function _onPedidoNombreInput() {
  const input = document.getElementById('pedido-fi-nombre');
  if (!input) return;
  const q = (input.value || '').trim();

  // Si cambia el texto después de seleccionar, descartar
  if (_pedidoSelectedItem && q !== _pedidoSelectedItem.nombre) {
    _pedidoSelectedItem = null;
  }
  if (q.length < 1) { _hidePedidoSuggestions(); return; }

  const results = [];
  // Repuestos
  if (typeof REPUESTOS !== 'undefined' && Array.isArray(REPUESTOS)) {
    REPUESTOS.forEach(r => {
      if (typeof searchMatch === 'function' && !searchMatch([r.nombre, r.marca, r.modelo, r.tipo], q)) return;
      results.push({
        source: 'repuesto', id: r.id,
        nombre: r.nombre || `${r.tipo || ''} ${r.marca || ''} ${r.modelo || ''}`.trim() || '(repuesto)',
        meta: [r.tipo, r.marca].filter(Boolean).join(' · '),
        categoria: r.tipo || 'Otro',
        proveedor: r.proveedor || '',
        stock: Number(r.cantidad) || 0,
        icon: '🔧',
      });
    });
  }
  // Productos del inventario (si está cargado en esta página)
  if (typeof PRODUCTOS !== 'undefined' && Array.isArray(PRODUCTOS)) {
    PRODUCTOS.forEach(p => {
      if (p.activo === false) return;
      if (typeof searchMatch === 'function' && !searchMatch([p.nombre, p.codigo, p.categoria], q)) return;
      results.push({
        source: 'producto', id: p.id,
        nombre: p.nombre || '(sin nombre)',
        meta: [p.categoria, p.codigo].filter(Boolean).join(' · '),
        categoria: p.categoria || 'Otro',
        proveedor: '',
        stock: Number(p.stock) || 0,
        icon: '📦',
      });
    });
  }

  // Sort: empieza con el query primero
  const qNorm = (typeof normalizeText === 'function') ? normalizeText(q) : q.toLowerCase();
  results.sort((a, b) => {
    const ns = (typeof normalizeText === 'function') ? normalizeText : (s => String(s||'').toLowerCase());
    const aS = ns(a.nombre).startsWith(qNorm) ? 0 : 1;
    const bS = ns(b.nombre).startsWith(qNorm) ? 0 : 1;
    if (aS !== bS) return aS - bS;
    return a.nombre.localeCompare(b.nombre);
  });

  _showPedidoSuggestions(results.slice(0, 8), q);
}

function _showPedidoSuggestions(results, q) {
  const drop = document.getElementById('pedido-suggest');
  if (!drop) return;
  if (!results.length) {
    drop.innerHTML = `
      <div class="mov-sug-empty">
        <span class="sug-empty-ico">✏️</span>
        <div class="sug-empty-text">
          <div class="sug-empty-title">Sin coincidencias para "${esc(q || '')}"</div>
          <div class="sug-empty-sub">Seguí escribiendo libre — vas a poder elegir la categoría manual</div>
        </div>
      </div>`;
    drop._results = [];
    drop.classList.remove('hidden');
    return;
  }
  drop.innerHTML = results.map((r, i) => `
    <button type="button" class="mov-sug-item" data-i="${i}"
            onmousedown="event.preventDefault()" onclick="_selectPedidoSuggestion(${i})">
      <span class="sug-ico">${r.icon}</span>
      <span class="sug-info">
        <span class="sug-name">${esc(r.nombre)}</span>
        <span class="sug-meta">${r.source === 'producto' ? '📦 Inventario' : '🔧 Repuesto'}${r.meta ? ' · ' + esc(r.meta) : ''}</span>
      </span>
      <span class="sug-right">
        <span class="sug-stock ${r.stock <= 0 ? 'sug-stock-zero' : (r.stock <= 2 ? 'sug-stock-low' : 'sug-stock-ok')}">${r.stock} u.</span>
      </span>
    </button>
  `).join('');
  drop._results = results;
  drop.classList.remove('hidden');
}

function _hidePedidoSuggestions() {
  const drop = document.getElementById('pedido-suggest');
  if (drop) drop.classList.add('hidden');
}

function _selectPedidoSuggestion(idx) {
  const drop = document.getElementById('pedido-suggest');
  const r = drop?._results?.[idx];
  if (!r) return;
  _pedidoSelectedItem = r;
  document.getElementById('pedido-fi-nombre').value = r.nombre;
  // Auto-set categoría si la categoría del item está en la lista
  const catSel = document.getElementById('pedido-fi-categoria');
  if (catSel) {
    const opt = [...catSel.options].find(o => o.value.toLowerCase() === (r.categoria || '').toLowerCase());
    if (opt) catSel.value = opt.value;
    else if (PEDIDO_CATEGORIAS.includes(r.categoria)) catSel.value = r.categoria;
    else catSel.value = 'Otro';
  }
  // Auto-set proveedor si el item lo tiene
  const provInp = document.getElementById('pedido-fi-proveedor');
  if (provInp && r.proveedor) provInp.value = r.proveedor;
  _hidePedidoSuggestions();
  // Foco en cantidad para que tipee la cantidad rápido
  document.getElementById('pedido-fi-cantidad').focus();
  document.getElementById('pedido-fi-cantidad').select();
}
