// ══════════════════════════════════════════
//  STOCK EXTRAS — Batch ops + Fotos múltiples
// ══════════════════════════════════════════

// ── F9: Batch operations ────────────────────
let _batchMode = false;
let _batchSelected = new Set();

function enterBatchMode() {
  _batchMode = true;
  _batchSelected.clear();
  document.body.classList.add('batch-mode');
  document.getElementById('batch-toolbar')?.classList.remove('hidden');
  _updateBatchUI();
  if (typeof debounceRender === 'function') debounceRender();
  else if (typeof render === 'function') render();
}

function exitBatchMode() {
  _batchMode = false;
  _batchSelected.clear();
  document.body.classList.remove('batch-mode');
  document.getElementById('batch-toolbar')?.classList.add('hidden');
  if (typeof debounceRender === 'function') debounceRender();
  else if (typeof render === 'function') render();
}

function isBatchMode() { return _batchMode; }

function toggleBatchSelection(id) {
  if (!_batchMode) return false;
  if (_batchSelected.has(id)) _batchSelected.delete(id);
  else _batchSelected.add(id);
  _updateBatchUI();
  const card = document.querySelector(`.card[data-stock-id="${id}"]`);
  if (card) card.classList.toggle('card-selected', _batchSelected.has(id));
  return true;
}

function _updateBatchUI() {
  const count = _batchSelected.size;
  const el = document.getElementById('batch-count');
  if (el) el.textContent = count === 0 ? 'Tocá para seleccionar' : `${count} seleccionado${count !== 1 ? 's' : ''}`;
}

function batchSelectAll() {
  document.querySelectorAll('#list .card[data-stock-id]').forEach(card => {
    const id = card.dataset.stockId;
    if (id) {
      _batchSelected.add(id);
      card.classList.add('card-selected');
    }
  });
  _updateBatchUI();
}

async function batchChangeUbicacion() {
  if (!_batchSelected.size) { toast('Seleccionalo al menos uno', 'info'); return; }
  const ubic = prompt('Nueva ubicacion:\n\n1 = Exhibicion\n2 = Deposito\n3 = Sin asignar\n\nIngresa numero o nombre:');
  if (!ubic) return;
  let val = ubic.trim();
  if (val === '1') val = 'Exhibición';
  else if (val === '2') val = 'Depósito';
  else if (val === '3') val = '';
  if (val && !['Exhibición','Depósito',''].includes(val)) {
    toast('Ubicación inválida', 'error'); return;
  }
  try {
    const batch = db.batch();
    _batchSelected.forEach(id => {
      batch.update(db.collection('stock').doc(id), { ubicacion: val });
    });
    await batch.commit();
    toast(`📍 ${_batchSelected.size} equipo(s) actualizados`, 'success');
    exitBatchMode();
  } catch (e) {
    console.error('batchChangeUbicacion:', e);
    toast('Error al actualizar', 'error');
  }
}

async function batchDescuento() {
  if (!_batchSelected.size) { toast('Seleccioná al menos uno', 'info'); return; }
  const raw = prompt(`Aplicar descuento sobre ${_batchSelected.size} equipo(s):\n\nIngresá el porcentaje (ej: 10 para 10% off, -5 para 5% más caro):`);
  const pct = parseFloat(raw);
  if (isNaN(pct) || pct === 0) return;
  if (Math.abs(pct) > 99) { toast('Porcentaje inválido', 'error'); return; }
  if (!confirm(`Confirmás aplicar ${pct > 0 ? 'descuento' : 'aumento'} de ${Math.abs(pct)}% sobre ${_batchSelected.size} equipo(s)?`)) return;

  try {
    const batch = db.batch();
    let countOk = 0;
    _batchSelected.forEach(id => {
      const p = STOCK.find(x => x.id === id);
      if (!p || !p.precio || p.vendido) return;
      const factor = 1 - (pct / 100);
      const nuevoPrecio = Math.round(p.precio * factor);
      const upd = { precio: nuevoPrecio };
      if (p.moneda === 'usd' && p.precioUSD) {
        upd.precioUSD = Math.round(p.precioUSD * factor * 100) / 100;
      }
      batch.update(db.collection('stock').doc(id), upd);
      countOk++;
    });
    if (!countOk) { toast('Ningún equipo válido para actualizar', 'info'); return; }
    await batch.commit();
    toast(`💸 ${pct > 0 ? '-' : '+'}${Math.abs(pct)}% aplicado a ${countOk} equipo(s)`, 'success');
    exitBatchMode();
  } catch (e) {
    console.error('batchDescuento:', e);
    toast('Error al aplicar descuento', 'error');
  }
}

function batchExportWA() {
  if (!_batchSelected.size) { toast('Seleccioná al menos uno', 'info'); return; }
  const items = Array.from(_batchSelected).map(id => STOCK.find(x => x.id === id)).filter(Boolean);
  if (!items.length) return;

  const lines = items.map(p => {
    const specs = [p.almacenamiento, p.ram ? p.ram + ' RAM' : ''].filter(Boolean).join(' ');
    const precio = p.precio ? '$' + p.precio.toLocaleString('es-AR') : 'Consultar';
    let line = `📱 *${p.marca} ${p.modelo}*`;
    if (specs) line += ` ${specs}`;
    if (p.estado) line += ` (${p.estado})`;
    if (p.bateria) line += ` 🔋${p.bateria}%`;
    line += `\n💰 ${precio}`;
    if (p.garantiaMeses > 0) line += ` · 🛡️ ${p.garantiaMeses}m garantía`;
    return line;
  }).join('\n\n');

  const businessName = window._DAKI_NAME || 'TechPoint';
  const fullMsg = `📲 *Equipos disponibles — ${businessName}*\n\n${lines}\n\n_Consultanos para más info_`;
  const url = 'https://wa.me/?text=' + encodeURIComponent(fullMsg);
  window.open(url, '_blank');
  toast(`🟢 ${items.length} equipo(s) en WhatsApp`, 'success');
}

// ── F6: Fotos múltiples (Firebase Storage) ──
function _getStorage() {
  if (typeof firebase === 'undefined' || !firebase.storage) return null;
  try { return firebase.storage(); } catch { return null; }
}

async function _compressImage(file, maxSize = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > h && w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
        else if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('img load'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('FileReader'));
    reader.readAsDataURL(file);
  });
}

async function uploadStockPhotos(stockId, files) {
  const storage = _getStorage();
  if (!storage) {
    toast('Firebase Storage no disponible (revisá setup)', 'error');
    return [];
  }
  const uploaded = [];
  toast(`Subiendo ${files.length} foto(s)...`, 'info');
  for (let i = 0; i < files.length; i++) {
    try {
      const blob = await _compressImage(files[i]);
      const filename = `${Date.now()}_${i}.jpg`;
      const ref = storage.ref(`stock-photos/${stockId}/${filename}`);
      const snap = await ref.put(blob, { contentType: 'image/jpeg' });
      const url = await snap.ref.getDownloadURL();
      uploaded.push(url);
    } catch (e) {
      console.error('uploadStockPhotos:', e);
    }
  }
  if (uploaded.length) {
    const p = STOCK.find(x => x.id === stockId);
    const fotos = [...(p?.fotos || []), ...uploaded];
    await db.collection('stock').doc(stockId).update({ fotos });
    toast(`✅ ${uploaded.length} foto(s) subida(s)`, 'success');
  } else {
    toast('No se pudo subir ninguna foto', 'error');
  }
  return uploaded;
}

async function deleteStockPhoto(stockId, photoUrl) {
  if (!confirm('¿Eliminar esta foto?')) return;
  const storage = _getStorage();
  try {
    if (storage) {
      try {
        const ref = storage.refFromURL(photoUrl);
        await ref.delete();
      } catch (e) { console.warn('No se pudo borrar de Storage:', e); }
    }
    const p = STOCK.find(x => x.id === stockId);
    const fotos = (p?.fotos || []).filter(u => u !== photoUrl);
    await db.collection('stock').doc(stockId).update({ fotos });
    toast('Foto eliminada', 'info');
    if (typeof openDetail === 'function') openDetail(stockId);
  } catch (e) {
    console.error('deleteStockPhoto:', e);
    toast('Error al eliminar foto', 'error');
  }
}

function viewPhotoFullscreen(url) {
  const overlay = document.createElement('div');
  overlay.className = 'photo-fullscreen';
  overlay.innerHTML = `<img src="${url}" alt=""><button class="photo-fs-close">✕</button>`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

function _onStockPhotoFileChange(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const id = e.target.dataset.stockId;
  if (!id) return;
  uploadStockPhotos(id, files).then(() => {
    e.target.value = '';
    if (typeof openDetail === 'function') openDetail(id);
  });
}

function buildPhotoGalleryHTML(p) {
  const fotos = p.fotos || [];
  const id = p.id;
  let html = '<div class="photo-gallery">';
  fotos.forEach(url => {
    html += `<div class="photo-thumb">
      <img src="${url}" alt="" onclick="viewPhotoFullscreen('${url}')">
      <button class="photo-del" onclick="deleteStockPhoto('${id}', '${url}')">🗑</button>
    </div>`;
  });
  if (!p.vendido) {
    html += `<label class="photo-add">
      <input type="file" accept="image/*" multiple data-stock-id="${id}" onchange="_onStockPhotoFileChange(event)" style="display:none">
      <span>📷</span>
      <span class="photo-add-lbl">Agregar foto${fotos.length > 0 ? 's' : ''}</span>
    </label>`;
  }
  html += '</div>';
  return html;
}
