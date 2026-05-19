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
  if (sel && !sel.value) sel.value = _bulkTipo;
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
