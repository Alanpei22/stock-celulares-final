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
      // Re-render del tab Reparaciones (barato, mantiene el DOM listo aunque esté oculto)
      if (document.getElementById('rep-tab-list')) {
        _renderReparTab();
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

// ══════════════════════════════════════════
//  EDICIÓN MASIVA (tipo Excel)
// ══════════════════════════════════════════
let _bulkRows = [];      // [{ id|null, equipo, precio, nota, _deleted }]
let _bulkTipo = '';

function openPreciosBulk() {
  initPrecios();
  // Llenar select de tipos
  const sel = document.getElementById('bulk-tipo');
  if (sel && sel.options.length <= 1) {
    PRECIO_TIPOS.forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      sel.appendChild(o);
    });
  }
  _bulkTipo = sel ? (sel.value || PRECIO_TIPOS[0]) : PRECIO_TIPOS[0];
  if (sel) sel.value = _bulkTipo; // sincronizar siempre el select con el estado
  _bulkLoadRows();
  // Cerrar el modal de lista si estaba abierto
  closePreciosModal();
  document.getElementById('precios-bulk-overlay').classList.remove('hidden');
  document.getElementById('precios-bulk-modal').classList.remove('hidden');
}

function closePreciosBulk() {
  document.getElementById('precios-bulk-overlay').classList.add('hidden');
  document.getElementById('precios-bulk-modal').classList.add('hidden');
}

function _bulkOnTipoChange() {
  const sel = document.getElementById('bulk-tipo');
  // Avisar si hay cambios sin guardar
  const hayCambios = _bulkRows.some(r => r._dirty || r._isNew || r._deleted);
  if (hayCambios && !confirm('Cambiaste de tipo. Se perderán los cambios sin guardar. ¿Continuar?')) {
    sel.value = _bulkTipo;
    return;
  }
  _bulkTipo = sel.value;
  _bulkLoadRows();
}

function _bulkLoadRows() {
  _bulkRows = PRECIOS
    .filter(p => p.tipo === _bulkTipo)
    .sort((a, b) => (a.equipo || '').localeCompare(b.equipo || ''))
    .map(p => ({ id: p.id, equipo: p.equipo || '', precio: p.precio || 0, nota: p.nota || '', _dirty: false, _isNew: false, _deleted: false }));
  renderBulkTable();
}

function renderBulkTable() {
  const cont = document.getElementById('bulk-table');
  if (!cont) return;
  const visibles = _bulkRows.filter(r => !r._deleted);

  if (!visibles.length) {
    cont.innerHTML = '<div class="bulk-empty">Sin modelos para este tipo.<br>Pegá una lista arriba para empezar.</div>';
    _bulkUpdateCount();
    return;
  }

  let html = `<div class="bulk-row bulk-row--hdr">
    <span class="bulk-c-equipo">Equipo</span>
    <span class="bulk-c-precio">Precio</span>
    <span class="bulk-c-del"></span>
  </div>`;

  _bulkRows.forEach((r, idx) => {
    if (r._deleted) return;
    html += `<div class="bulk-row${r._isNew ? ' bulk-row--new' : ''}">
      <input class="bulk-in bulk-c-equipo" type="text" value="${_escP(r.equipo)}"
        oninput="_bulkEdit(${idx},'equipo',this.value)" placeholder="Equipo">
      <input class="bulk-in bulk-c-precio" type="number" inputmode="numeric" min="0"
        value="${r.precio || ''}" placeholder="0"
        oninput="_bulkEdit(${idx},'precio',this.value)">
      <button class="bulk-del" onclick="_bulkRemoveRow(${idx})" title="Quitar">✕</button>
    </div>`;
  });
  cont.innerHTML = html;
  _bulkUpdateCount();
}

function _bulkEdit(idx, field, value) {
  const r = _bulkRows[idx];
  if (!r) return;
  if (field === 'precio') r.precio = parseInt(value) || 0;
  else r[field] = value;
  r._dirty = true;
  _bulkUpdateCount();
}

function _bulkRemoveRow(idx) {
  const r = _bulkRows[idx];
  if (!r) return;
  if (r._isNew) {
    // Fila nueva sin guardar → quitar del array
    _bulkRows.splice(idx, 1);
  } else {
    r._deleted = true;
  }
  renderBulkTable();
}

function _bulkAddPasted() {
  const ta = document.getElementById('bulk-paste');
  if (!ta) return;
  const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) { toast('Pegá al menos un modelo', 'info'); return; }

  let agregados = 0, duplicados = 0;
  const existentes = new Set(_bulkRows.filter(r => !r._deleted).map(r => (r.equipo || '').toLowerCase().trim()));

  lines.forEach(line => {
    // Soportar formatos: "iPhone 14", "iPhone 14 = 25000", "iPhone 14 | 25000", "iPhone 14<TAB>25000"
    let equipo = line, precio = 0;
    const m = line.match(/^(.+?)\s*(?:=|\||\t)\s*(\d[\d.]*)\s*$/);
    if (m) {
      equipo = m[1].trim();
      precio = parseInt(m[2].replace(/\./g, '')) || 0;
    }
    const key = equipo.toLowerCase().trim();
    if (!equipo) return;
    if (existentes.has(key)) { duplicados++; return; }
    existentes.add(key);
    _bulkRows.push({ id: null, equipo, precio, nota: '', _dirty: true, _isNew: true, _deleted: false });
    agregados++;
  });

  ta.value = '';
  document.getElementById('bulk-paste-wrap').classList.add('hidden');
  renderBulkTable();
  let msg = `${agregados} modelo(s) agregado(s)`;
  if (duplicados) msg += ` · ${duplicados} ya estaban`;
  toast(msg, 'success');
}

function _bulkTogglePaste() {
  document.getElementById('bulk-paste-wrap')?.classList.toggle('hidden');
}

// ══════════════════════════════════════════
//  TAB REPARACIONES — vista por modelo
// ══════════════════════════════════════════
let _reparOpenModelos = new Set();

function openReparTab() {
  initPrecios();
  // Si PRECIOS aún no cargó, mostrar placeholder de carga
  if (!PRECIOS || PRECIOS.length === 0) {
    const empty = document.getElementById('rep-tab-empty');
    const cont = document.getElementById('rep-tab-list');
    if (cont) cont.innerHTML = '';
    if (empty) {
      empty.classList.remove('hidden');
      empty.innerHTML = '<span class="rep-empty-ico">⏳</span><p>Cargando precios…</p>';
    }
  }
  _renderReparTab();
}

function _renderReparTab() {
  const cont = document.getElementById('rep-tab-list');
  const empty = document.getElementById('rep-tab-empty');
  if (!cont) return;

  const q = (document.getElementById('rep-tab-search')?.value || '').trim().toLowerCase();
  let lista = PRECIOS;
  if (q) {
    lista = lista.filter(p =>
      ((p.equipo||'') + ' ' + (p.tipo||'') + ' ' + (p.nota||'')).toLowerCase().includes(q)
    );
  }

  // Agrupar por equipo
  const grupos = {};
  lista.forEach(p => {
    const e = p.equipo || '(sin nombre)';
    if (!grupos[e]) grupos[e] = [];
    grupos[e].push(p);
  });
  const modelos = Object.keys(grupos).sort();

  if (!modelos.length) {
    if (empty) empty.classList.add('hidden');
    if (q) {
      cont.innerHTML = `<div class="rep-tab-empty"><span class="rep-empty-ico">🔍</span><p>Sin resultados para "${_escP(q)}"</p></div>`;
      return;
    }
    // Estado vacío: mostrar PREVIEW de cómo se va a ver + botón crear ejemplo
    cont.innerHTML = `
      <div class="rep-onboard">
        <h3 class="rep-onboard-title">🔧 Catálogo de reparaciones</h3>
        <p class="rep-onboard-sub">Cargá cada modelo con sus servicios y precios para consultar al instante.</p>

        <div class="rep-onboard-preview-lbl">↓ Así se va a ver una vez cargado ↓</div>
        <div class="rep-modelo rep-modelo--open rep-onboard-preview">
          <div class="rep-modelo-hdr">
            <span class="rep-modelo-name">📱 iPhone 14 <span class="rep-onboard-tag">EJEMPLO</span></span>
            <span class="rep-modelo-meta">4 servicios</span>
            <span class="rep-modelo-chev">▴</span>
          </div>
          <div class="rep-modelo-body">
            <div class="rep-svc-row rep-svc-row--demo">
              <span class="rep-svc-ico">📱</span>
              <div class="rep-svc-info"><span class="rep-svc-name">Pantalla / Módulo</span></div>
              <span class="rep-svc-precio">$25.000</span>
            </div>
            <div class="rep-svc-row rep-svc-row--demo">
              <span class="rep-svc-ico">🔋</span>
              <div class="rep-svc-info"><span class="rep-svc-name">Batería</span></div>
              <span class="rep-svc-precio">$15.000</span>
            </div>
            <div class="rep-svc-row rep-svc-row--demo">
              <span class="rep-svc-ico">🔌</span>
              <div class="rep-svc-info"><span class="rep-svc-name">Pin de carga</span></div>
              <span class="rep-svc-precio">$12.000</span>
            </div>
            <div class="rep-svc-row rep-svc-row--demo">
              <span class="rep-svc-ico">🛡️</span>
              <div class="rep-svc-info"><span class="rep-svc-name">Tapa / Carcasa</span></div>
              <span class="rep-svc-precio">$8.000</span>
            </div>
          </div>
        </div>

        <button class="rep-onboard-cta" onclick="_createExampleModel()">
          ✨ Crear este modelo de ejemplo
        </button>
        <p class="rep-onboard-hint">Después podés editar los precios con un toque,<br>o crear más modelos con el botón ＋ de arriba.</p>
      </div>`;
    return;
  }
  if (empty) empty.classList.add('hidden');

  // Si hay búsqueda activa, abrir todos los modelos
  const forceOpen = !!q;

  cont.innerHTML = modelos.map(equipo => {
    const items = grupos[equipo].sort((a, b) => (a.tipo || '').localeCompare(b.tipo || ''));
    const isOpen = forceOpen || _reparOpenModelos.has(equipo);
    const sinPrecio = items.filter(p => !p.precio || p.precio <= 0).length;
    return `
      <div class="rep-modelo${isOpen ? ' rep-modelo--open' : ''}">
        <div class="rep-modelo-hdr" onclick="_toggleRepModelo('${_escP(equipo)}')">
          <span class="rep-modelo-name">📱 ${_escP(equipo)}</span>
          <span class="rep-modelo-meta">
            ${items.length} servicio${items.length !== 1 ? 's' : ''}
            ${sinPrecio > 0 ? `<span class="rep-modelo-warn">· ${sinPrecio} sin precio</span>` : ''}
          </span>
          <span class="rep-modelo-chev">${isOpen ? '▴' : '▾'}</span>
        </div>
        ${isOpen ? `
          <div class="rep-modelo-body">
            ${items.map(p => `
              <div class="rep-svc-row">
                <span class="rep-svc-ico" onclick="openPrecioForm('${_escP(p.id)}')" title="Editar todo">${PRECIO_TIPO_ICON[p.tipo] || '🔧'}</span>
                <div class="rep-svc-info" onclick="openPrecioForm('${_escP(p.id)}')" title="Editar todo">
                  <span class="rep-svc-name">${_escP(p.tipo || 'Otro')}</span>
                  ${p.nota ? `<span class="rep-svc-nota">${_escP(p.nota)}</span>` : ''}
                </div>
                <div class="rep-svc-precio-wrap${(!p.precio || p.precio <= 0) ? ' rep-svc-precio-wrap--zero' : ''}">
                  <span class="rep-svc-precio-prefix">$</span>
                  <input class="rep-svc-precio-input" type="number" inputmode="numeric" min="0"
                    data-id="${_escP(p.id)}" value="${p.precio || ''}" placeholder="0"
                    onfocus="this.select()"
                    onblur="_savePrecioInline('${_escP(p.id)}', this.value)"
                    onkeydown="_onPrecioInlineKey(event)">
                </div>
              </div>`).join('')}
            <button class="rep-svc-add" onclick="event.stopPropagation();_addServicioAModelo('${_escP(equipo)}')">
              ➕ Agregar servicio a este modelo
            </button>
            <button class="rep-modelo-del" onclick="event.stopPropagation();_deleteModeloComplete('${_escP(equipo)}')">
              🗑 Eliminar modelo completo
            </button>
          </div>
        ` : ''}
      </div>`;
  }).join('');
}

function _toggleRepModelo(equipo) {
  if (_reparOpenModelos.has(equipo)) _reparOpenModelos.delete(equipo);
  else _reparOpenModelos.add(equipo);
  _renderReparTab();
}

// Crear modelo de ejemplo para que el usuario arranque con algo
async function _createExampleModel() {
  const equipo = 'iPhone 14';
  const servicios = [
    { tipo: 'Pantalla / Módulo', precio: 25000 },
    { tipo: 'Batería',           precio: 15000 },
    { tipo: 'Pin de carga',      precio: 12000 },
    { tipo: 'Tapa / Carcasa',    precio: 8000  },
  ];
  // No duplicar si ya existe
  const existentes = new Set(PRECIOS.filter(p => p.equipo === equipo).map(p => p.tipo));
  const aCrear = servicios.filter(s => !existentes.has(s.tipo));
  if (!aCrear.length) {
    toast('El modelo de ejemplo ya existe', 'info');
    _reparOpenModelos.add(equipo);
    _renderReparTab();
    return;
  }
  try {
    const batch = db.batch();
    aCrear.forEach(s => {
      const ref = db.collection('precios_reparaciones').doc();
      batch.set(ref, {
        tipo: s.tipo, equipo, precio: s.precio, nota: '',
        updatedAt: new Date().toISOString(),
      });
    });
    await batch.commit();
    _reparOpenModelos.add(equipo);
    toast('✅ Modelo de ejemplo creado — editá los precios como quieras', 'success');
  } catch (e) {
    console.error('createExampleModel:', e);
    toast('Error al crear el ejemplo', 'error');
  }
}

// Edición inline del precio (sin abrir modal)
async function _savePrecioInline(id, value) {
  const p = PRECIOS.find(x => x.id === id);
  if (!p) return;
  const num = parseInt(value) || 0;
  if (num === (Number(p.precio) || 0)) return; // sin cambio
  // Marcar visualmente como guardando
  const inp = document.querySelector(`.rep-svc-precio-input[data-id="${id}"]`);
  if (inp) inp.classList.add('rep-svc-saving');
  try {
    await db.collection('precios_reparaciones').doc(id).update({
      precio: num, updatedAt: new Date().toISOString(),
    });
    if (inp) {
      inp.classList.remove('rep-svc-saving');
      inp.classList.add('rep-svc-saved');
      setTimeout(() => inp?.classList.remove('rep-svc-saved'), 900);
    }
  } catch (e) {
    console.error('savePrecioInline:', e);
    if (inp) inp.classList.remove('rep-svc-saving');
    toast('Error al guardar el precio', 'error');
  }
}

function _onPrecioInlineKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  else if (e.key === 'Escape') {
    const id = e.target.getAttribute('data-id');
    const p = PRECIOS.find(x => x.id === id);
    if (p) e.target.value = p.precio || '';
    e.target.blur();
  }
}

function _addServicioAModelo(equipo) {
  // Reutilizar openPrecioForm con un equipo pre-llenado
  openPrecioForm(null);
  // Override post-apertura: setear equipo y título contextual
  setTimeout(() => {
    const eq = document.getElementById('precio-fi-equipo');
    if (eq) eq.value = equipo;
    const title = document.getElementById('precio-form-title');
    if (title) title.textContent = '➕ Servicio para ' + equipo;
    // Foco en el select de tipo (no en equipo, que ya está cargado)
    document.getElementById('precio-fi-tipo')?.focus();
  }, 130);
}

async function _deleteModeloComplete(equipo) {
  const items = PRECIOS.filter(p => p.equipo === equipo);
  if (!items.length) return;
  const doDelete = async () => {
    if (!confirm(`¿Eliminar el modelo "${equipo}" y sus ${items.length} servicio${items.length !== 1 ? 's' : ''}?`)) return;
    try {
      const batch = db.batch();
      items.forEach(p => batch.delete(db.collection('precios_reparaciones').doc(p.id)));
      await batch.commit();
      toast('Modelo eliminado', 'info');
    } catch (e) {
      console.error('deleteModelo:', e);
      toast('Error al eliminar', 'error');
    }
  };
  // PIN primero (si aplica), luego el confirm va adentro
  if (typeof requireCajaOwnerPin === 'function') {
    requireCajaOwnerPin(doDelete, 'PIN de dueño para eliminar el modelo');
  } else {
    doDelete();
  }
}

// ── Modal "Nuevo modelo" ────────────────────
function openNewModeloModal() {
  const cont = document.getElementById('newmod-svcs');
  if (cont) {
    // Defaults marcados: los más comunes
    const defaults = new Set(['Pantalla / Módulo', 'Batería', 'Pin de carga', 'Tapa / Carcasa']);
    cont.innerHTML = PRECIO_TIPOS.map(t => `
      <label class="newmod-svc">
        <input type="checkbox" value="${_escP(t)}" ${defaults.has(t) ? 'checked' : ''}>
        <span>${PRECIO_TIPO_ICON[t] || '🔧'} ${_escP(t)}</span>
      </label>
    `).join('');
  }
  document.getElementById('newmod-equipo').value = '';
  document.getElementById('newmod-overlay').classList.remove('hidden');
  document.getElementById('newmod-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('newmod-equipo')?.focus(), 150);
}

function closeNewModeloModal() {
  document.getElementById('newmod-overlay').classList.add('hidden');
  document.getElementById('newmod-modal').classList.add('hidden');
}

async function confirmNewModelo() {
  const equipo = document.getElementById('newmod-equipo').value.trim();
  if (!equipo) { toast('Ingresá el nombre del modelo', 'error'); return; }
  const checks = document.querySelectorAll('#newmod-svcs input[type="checkbox"]:checked');
  if (!checks.length) { toast('Elegí al menos un servicio', 'error'); return; }

  // Detectar duplicados por equipo+tipo
  const existentes = new Set(PRECIOS
    .filter(p => p.equipo === equipo)
    .map(p => p.tipo));
  const tipos = Array.from(checks).map(c => c.value).filter(t => !existentes.has(t));
  if (!tipos.length) {
    toast('Todos esos servicios ya existían para este modelo', 'info');
    closeNewModeloModal();
    return;
  }

  try {
    const batch = db.batch();
    tipos.forEach(tipo => {
      const ref = db.collection('precios_reparaciones').doc();
      batch.set(ref, {
        tipo, equipo, precio: 0, nota: '',
        updatedAt: new Date().toISOString(),
      });
    });
    await batch.commit();
    _reparOpenModelos.add(equipo); // abrir el modelo recién creado
    toast(`✅ ${tipos.length} servicio(s) creado(s) para ${equipo}`, 'success');
    closeNewModeloModal();
  } catch (e) {
    console.error('confirmNewModelo:', e);
    toast('Error al crear el modelo', 'error');
  }
}


// Importar modelos del catálogo de proveedor (modulos_catalog.js)
function _bulkImportCatalog() {
  if (typeof MODULOS_CATALOG === 'undefined' || !Array.isArray(MODULOS_CATALOG)) {
    toast('Catálogo no disponible', 'error');
    return;
  }
  const tipoActual = _bulkTipo || '';
  const ok = confirm(
    `Se van a traer ${MODULOS_CATALOG.length} modelos del catálogo de pantallas/módulos.\n\n` +
    `Tipo destino: "${tipoActual}"\n` +
    `Los precios quedan en 0 para que los completes.\n\n¿Continuar?`
  );
  if (!ok) return;

  const existentes = new Set(_bulkRows.filter(r => !r._deleted).map(r => (r.equipo || '').toLowerCase().trim()));
  let agregados = 0, duplicados = 0;

  MODULOS_CATALOG.forEach(entry => {
    // entry = [marca, nombre, precio, notas]
    const marca = entry[0] || '';
    const nombre = entry[1] || '';
    const equipo = `${marca} ${nombre}`.trim();
    const key = equipo.toLowerCase().trim();
    if (!equipo) return;
    if (existentes.has(key)) { duplicados++; return; }
    existentes.add(key);
    _bulkRows.push({ id: null, equipo, precio: 0, nota: '', _dirty: true, _isNew: true, _deleted: false });
    agregados++;
  });

  renderBulkTable();
  let msg = `${agregados} modelo(s) del catálogo agregados`;
  if (duplicados) msg += ` · ${duplicados} ya estaban`;
  toast(msg, 'success');
}

function _bulkUpdateCount() {
  const cambios = _bulkRows.filter(r => (r._dirty || r._deleted) && (r.id || !r._deleted)).length;
  const btn = document.getElementById('bulk-save-btn');
  if (btn) {
    btn.textContent = cambios > 0 ? `💾 Guardar todo (${cambios})` : '💾 Guardar todo';
    btn.disabled = cambios === 0;
  }
}

async function saveBulkPrecios() {
  // Validar
  const aGuardar = _bulkRows.filter(r => !r._deleted);
  for (const r of aGuardar) {
    if (!r.equipo || !r.equipo.trim()) {
      toast('Hay un equipo sin nombre — completalo o quitalo', 'error');
      return;
    }
  }

  const btn = document.getElementById('bulk-save-btn');
  if (btn) btn.disabled = true;

  try {
    let batch = db.batch();
    let ops = 0;
    let creados = 0, actualizados = 0, eliminados = 0;

    const commitIfNeeded = async () => {
      if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    };

    for (const r of _bulkRows) {
      if (r._deleted && r.id) {
        batch.delete(db.collection('precios_reparaciones').doc(r.id));
        ops++; eliminados++;
        await commitIfNeeded();
      } else if (r._isNew && !r._deleted) {
        const ref = db.collection('precios_reparaciones').doc();
        batch.set(ref, {
          tipo: _bulkTipo, equipo: r.equipo.trim(),
          precio: r.precio || 0, nota: r.nota || '',
          updatedAt: new Date().toISOString(),
        });
        ops++; creados++;
        await commitIfNeeded();
      } else if (r._dirty && r.id && !r._deleted) {
        batch.set(db.collection('precios_reparaciones').doc(r.id), {
          tipo: _bulkTipo, equipo: r.equipo.trim(),
          precio: r.precio || 0, nota: r.nota || '',
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        ops++; actualizados++;
        await commitIfNeeded();
      }
    }
    if (ops > 0) await batch.commit();

    const partes = [];
    if (creados) partes.push(`${creados} nuevo(s)`);
    if (actualizados) partes.push(`${actualizados} editado(s)`);
    if (eliminados) partes.push(`${eliminados} borrado(s)`);
    toast('✅ Guardado: ' + (partes.join(' · ') || 'sin cambios'), 'success');
    closePreciosBulk();
  } catch (e) {
    console.error('saveBulkPrecios:', e);
    toast('Error al guardar — intentá de nuevo', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}
