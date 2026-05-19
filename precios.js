// ══════════════════════════════════════════
//  precios.js — Lista de precios de reparación
//  Colección Firestore: precios_reparaciones
//  Schema: { tipo, equipo, precio, nota, updatedAt }
// ══════════════════════════════════════════
'use strict';

let PRECIOS = [];
let _preciosListener = null;
let _precioEditId = null;
let _precioSearchQ = '';
let _precioFilterTipo = '';

const PRECIO_TIPOS = [
  'Pantalla / Módulo', 'Batería', 'Pin de carga', 'Flex', 'Cámara',
  'Parlante / Auricular', 'Micrófono', 'Tapa / Carcasa', 'Botones',
  'Software / Liberación', 'Placa', 'Otro'
];

const PRECIO_TIPO_ICON = {
  'Pantalla / Módulo': '📱', 'Batería': '🔋', 'Pin de carga': '🔌',
  'Flex': '🔗', 'Cámara': '📷', 'Parlante / Auricular': '🔊',
  'Micrófono': '🎤', 'Tapa / Carcasa': '🛡️', 'Botones': '⏺️',
  'Software / Liberación': '💾', 'Placa': '🔧', 'Otro': '🔩'
};

// ── Listener Firestore ──────────────────────
function initPrecios() {
  if (_preciosListener) return;
  if (typeof db === 'undefined' || !db) return;
  _preciosListener = db.collection('precios_reparaciones')
    .onSnapshot(snap => {
      PRECIOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      PRECIOS.sort((a, b) => {
        const t = (a.tipo || '').localeCompare(b.tipo || '');
        return t !== 0 ? t : (a.equipo || '').localeCompare(b.equipo || '');
      });
      if (!document.getElementById('precios-modal')?.classList.contains('hidden')) {
        renderPreciosList();
      }
    }, err => {
      console.error('precios listener:', err);
      if (typeof toast === 'function') toast('Error cargando precios', 'error');
    });
}

// ── Modal lista ─────────────────────────────
function openPreciosModal() {
  initPrecios();
  _precioSearchQ = '';
  _precioFilterTipo = '';
  const inp = document.getElementById('precios-search');
  if (inp) inp.value = '';
  _renderPreciosFilterChips();
  renderPreciosList();
  document.getElementById('precios-overlay').classList.remove('hidden');
  document.getElementById('precios-modal').classList.remove('hidden');
}

function closePreciosModal() {
  document.getElementById('precios-overlay').classList.add('hidden');
  document.getElementById('precios-modal').classList.add('hidden');
}

function _renderPreciosFilterChips() {
  const cont = document.getElementById('precios-filter-chips');
  if (!cont) return;
  // Solo mostrar tipos que tienen al menos un precio cargado
  const tiposUsados = [...new Set(PRECIOS.map(p => p.tipo).filter(Boolean))];
  let html = `<button class="precio-chip${_precioFilterTipo === '' ? ' precio-chip--active' : ''}" onclick="_setPrecioFilter('')">Todos</button>`;
  tiposUsados.forEach(t => {
    html += `<button class="precio-chip${_precioFilterTipo === t ? ' precio-chip--active' : ''}" onclick="_setPrecioFilter('${_escP(t)}')">${PRECIO_TIPO_ICON[t] || ''} ${_escP(t)}</button>`;
  });
  cont.innerHTML = html;
}

function _setPrecioFilter(tipo) {
  _precioFilterTipo = tipo;
  _renderPreciosFilterChips();
  renderPreciosList();
}

function _initPreciosSearch() {
  const inp = document.getElementById('precios-search');
  if (!inp || inp._initialized) return;
  inp._initialized = true;
  let t;
  inp.addEventListener('input', () => {
    _precioSearchQ = inp.value.trim().toLowerCase();
    clearTimeout(t);
    t = setTimeout(renderPreciosList, 80);
  });
}

function renderPreciosList() {
  _initPreciosSearch();
  const cont = document.getElementById('precios-list');
  const empty = document.getElementById('precios-empty');
  if (!cont) return;

  let lista = PRECIOS;
  if (_precioFilterTipo) lista = lista.filter(p => p.tipo === _precioFilterTipo);
  if (_precioSearchQ) {
    lista = lista.filter(p => {
      const txt = [p.tipo, p.equipo, p.nota].filter(Boolean).join(' ').toLowerCase();
      return txt.includes(_precioSearchQ);
    });
  }

  if (!lista.length) {
    cont.innerHTML = '';
    if (empty) {
      empty.classList.remove('hidden');
      empty.innerHTML = PRECIOS.length === 0
        ? '<span class="precios-empty-ico">💲</span><p>No hay precios cargados todavía</p><p class="precios-empty-sub">Tocá "Agregar precio" para empezar</p>'
        : '<span class="precios-empty-ico">🔍</span><p>Sin resultados</p>';
    }
    return;
  }
  if (empty) empty.classList.add('hidden');

  // Agrupar por tipo
  const grupos = {};
  lista.forEach(p => {
    const t = p.tipo || 'Otro';
    if (!grupos[t]) grupos[t] = [];
    grupos[t].push(p);
  });

  let html = '';
  Object.keys(grupos).forEach(tipo => {
    html += `<div class="precio-grupo-hdr">${PRECIO_TIPO_ICON[tipo] || '🔧'} ${_escP(tipo)}</div>`;
    grupos[tipo].forEach(p => {
      html += `
        <div class="precio-row" onclick="openPrecioForm('${_escP(p.id)}')">
          <div class="precio-row-info">
            <span class="precio-row-equipo">${_escP(p.equipo || '(sin equipo)')}</span>
            ${p.nota ? `<span class="precio-row-nota">${_escP(p.nota)}</span>` : ''}
          </div>
          <span class="precio-row-precio">$${Number(p.precio || 0).toLocaleString('es-AR')}</span>
        </div>`;
    });
  });
  cont.innerHTML = html;
}

// ── Form precio ─────────────────────────────
function openPrecioForm(id) {
  _precioEditId = id || null;
  const title = document.getElementById('precio-form-title');
  const delBtn = document.getElementById('precio-form-del');

  // Llenar select de tipos
  const tipoSel = document.getElementById('precio-fi-tipo');
  if (tipoSel && tipoSel.options.length <= 1) {
    PRECIO_TIPOS.forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      tipoSel.appendChild(o);
    });
  }

  if (id) {
    const p = PRECIOS.find(x => x.id === id);
    if (!p) return;
    title.textContent = '✏️ Editar precio';
    document.getElementById('precio-fi-tipo').value = p.tipo || '';
    document.getElementById('precio-fi-equipo').value = p.equipo || '';
    document.getElementById('precio-fi-precio').value = p.precio ?? '';
    document.getElementById('precio-fi-nota').value = p.nota || '';
    if (delBtn) delBtn.style.display = '';
  } else {
    title.textContent = '➕ Nuevo precio';
    document.getElementById('precio-fi-tipo').value = '';
    document.getElementById('precio-fi-equipo').value = '';
    document.getElementById('precio-fi-precio').value = '';
    document.getElementById('precio-fi-nota').value = '';
    if (delBtn) delBtn.style.display = 'none';
  }

  document.getElementById('precio-form-overlay').classList.remove('hidden');
  document.getElementById('precio-form-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('precio-fi-equipo')?.focus(), 120);
}

function closePrecioForm() {
  document.getElementById('precio-form-overlay').classList.add('hidden');
  document.getElementById('precio-form-modal').classList.add('hidden');
  _precioEditId = null;
}

async function savePrecio() {
  const tipo   = document.getElementById('precio-fi-tipo').value;
  const equipo = document.getElementById('precio-fi-equipo').value.trim();
  const precio = parseInt(document.getElementById('precio-fi-precio').value) || 0;
  const nota   = document.getElementById('precio-fi-nota').value.trim();

  if (!tipo)   { toast('Elegí el tipo de arreglo', 'error'); return; }
  if (!equipo) { toast('Ingresá el equipo (marca y modelo)', 'error'); return; }
  if (precio <= 0) { toast('Ingresá un precio válido', 'error'); return; }

  const data = { tipo, equipo, precio, nota, updatedAt: new Date().toISOString() };

  try {
    if (_precioEditId) {
      await db.collection('precios_reparaciones').doc(_precioEditId).set(data, { merge: true });
      toast('Precio actualizado ✅', 'success');
    } else {
      await db.collection('precios_reparaciones').add(data);
      toast('Precio agregado ✅', 'success');
    }
    closePrecioForm();
  } catch (e) {
    console.error('savePrecio:', e);
    toast('Error al guardar', 'error');
  }
}

async function deletePrecio() {
  if (!_precioEditId) return;
  const id = _precioEditId;
  const doDelete = async () => {
    try {
      await db.collection('precios_reparaciones').doc(id).delete();
      closePrecioForm();
      toast('Precio eliminado', 'info');
    } catch (e) {
      console.error('deletePrecio:', e);
      toast('Error al eliminar', 'error');
    }
  };
  // Si hay PIN de dueño, pedirlo; sino confirmar normal
  if (typeof requireCajaOwnerPin === 'function') {
    requireCajaOwnerPin(doDelete, 'PIN de dueño para eliminar el precio');
  } else if (confirm('¿Eliminar este precio de la lista?')) {
    doDelete();
  }
}

function _escP(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
