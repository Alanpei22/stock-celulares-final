// ══════════════════════════════════════════════════════════════
// Stock → página pública de equipos (/equipos)
// ══════════════════════════════════════════════════════════════
// La página sale de la misma colección `stock` (api/equipos.js). Acá está lo
// del lado de la app: la sección "🌐 Página de equipos" del formulario
// (publicar, color, detalles para el cliente, "Consultar precio", fotos) y el
// link para compartir.
//
// Las fotos van a Firebase Storage (stock-extras.js, achicadas a 1000 px).
// En un equipo nuevo todavía no hay id donde subirlas: quedan pendientes y se
// suben apenas se guarda.

const CAT_URL = 'https://stock-celulares-final.vercel.app/equipos';

let _catPendientes = [];   // [{ file, url }] elegidas y todavía no subidas
let _catFotos = [];        // las ya subidas del equipo que se está editando
let _catId = null;

function _catEl(id) { return document.getElementById(id); }

function catPubToggle() {
  const on = !!_catEl('fi-publicar')?.checked;
  _catEl('fi-pub-campos')?.classList.toggle('hidden', !on);
}

// Al abrir el formulario (p = equipo, o null si es nuevo)
function catFormCargar(p) {
  _catPendientes.forEach(x => URL.revokeObjectURL(x.url));
  _catPendientes = [];
  _catId = p?.id || null;
  _catFotos = Array.isArray(p?.fotos) ? p.fotos.slice() : [];
  const pub = _catEl('fi-publicar');
  if (pub) pub.checked = !!p?.publicar;
  const set = (id, v) => { const el = _catEl(id); if (el) el.value = v || ''; };
  set('fi-color', p?.color);
  set('fi-detalles-pub', p?.detallesPublicos);
  const op = _catEl('fi-ocultar-precio');
  if (op) op.checked = !!p?.ocultarPrecio;
  catPubToggle();
  _catPintarFotos();
}

// Los campos de la página para guardar en el doc del stock
function catFormCampos() {
  return {
    publicar: !!_catEl('fi-publicar')?.checked,
    color: (_catEl('fi-color')?.value || '').trim(),
    detallesPublicos: (_catEl('fi-detalles-pub')?.value || '').trim(),
    ocultarPrecio: !!_catEl('fi-ocultar-precio')?.checked,
  };
}

function _catPintarFotos() {
  const box = _catEl('fi-fotos');
  if (!box) return;
  const ya = _catFotos.map((url, i) => `<div class="photo-thumb">
      <img src="${esc(url)}" alt="" onclick="viewPhotoFullscreen('${esc(url)}')">
      <button type="button" class="photo-del" title="Quitar foto" onclick="catQuitarFoto(${i})">🗑</button>
      ${i === 0 ? '<span class="photo-portada">Portada</span>'
               : `<button type="button" class="photo-star" title="Usar de portada" onclick="catPortadaForm(${i})">⭐</button>`}
    </div>`).join('');
  const pend = _catPendientes.map((x, i) => `<div class="photo-thumb photo-pend">
      <img src="${x.url}" alt="">
      <button type="button" class="photo-del" title="Quitar" onclick="catQuitarPendiente(${i})">✕</button>
      ${!_catFotos.length && i === 0 ? '<span class="photo-portada">Portada</span>' : ''}
      <span class="photo-pend-lbl">Se sube al guardar</span>
    </div>`).join('');
  box.innerHTML = ya + pend + `<label class="photo-add">
      <input type="file" accept="image/*" multiple style="display:none" onchange="catElegirFotos(this)">
      <span>📷</span><span class="photo-add-lbl">Agregar fotos</span>
    </label>
    <button type="button" class="photo-add photo-celu" onclick="catQrCelu(_catId)">
      <span>📱</span><span class="photo-add-lbl">Desde el celu</span>
    </button>`;
}

// ── 📱 Fotos desde el celu ──
// La compu muestra un QR; el celu lo escanea, abre fotos-celu.html y sube las
// fotos de ESE equipo. Mientras el QR está abierto se escucha el equipo: las
// fotos aparecen acá solas a medida que llegan.
let _catQrUnsub = null;

function catUrlCelu(id) {
  const base = (typeof location !== 'undefined' && /^https?:/.test(location.origin)) ? location.origin : 'https://stock-celulares-final.vercel.app';
  return `${base}/fotos-celu.html?id=${encodeURIComponent(id)}`;
}

function catQrCelu(id) {
  if (!id) { toast('Primero guardá el equipo, después le sacás las fotos desde el celu', 'info'); return; }
  catQrCerrar();
  const p = (typeof STOCK !== 'undefined') ? STOCK.find(x => x.id === id) : null;
  const url = catUrlCelu(id);
  const ov = document.createElement('div');
  ov.id = 'cat-qr';
  ov.className = 'cat-qr-ov';
  ov.innerHTML = `<div class="cat-qr-caja">
      <button type="button" class="cat-qr-x" onclick="catQrCerrar()">✕</button>
      <h3>📱 Fotos desde el celu</h3>
      <p class="cat-qr-eq">${esc([p?.marca, p?.modelo].filter(Boolean).join(' ') || 'Equipo')}</p>
      <div class="cat-qr-img">${typeof qrSvg === 'function' ? qrSvg(url, 52) : ''}</div>
      <p class="cat-qr-paso">Abrí la cámara del celu y apuntá al código.<br>Sacá las fotos y van a ir apareciendo acá.</p>
      <div class="cat-qr-fotos" id="cat-qr-fotos"></div>
      <p class="cat-qr-link"><input readonly value="${esc(url)}" onclick="this.select()"></p>
      <button type="button" class="btn-primary cat-qr-listo" onclick="catQrCerrar()">Listo</button>
    </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) catQrCerrar(); });
  document.body.appendChild(ov);
  let antes = null;
  _catQrUnsub = db.collection('stock').doc(id).onSnapshot(d => {
    const fotos = (d.exists && Array.isArray(d.data().fotos)) ? d.data().fotos : [];
    const box = document.getElementById('cat-qr-fotos');
    if (box) {
      box.innerHTML = fotos.length
        ? `<b>${fotos.length} foto${fotos.length === 1 ? '' : 's'}</b><div>${fotos.map(u => `<img src="${esc(u)}" alt="">`).join('')}</div>`
        : '<span>Esperando fotos…</span>';
    }
    if (antes !== null && fotos.length > antes) toast('📷 Llegó una foto del celu', 'success');
    antes = fotos.length;
    // Si el formulario de ese equipo está abierto, se actualiza su galería
    if (_catId === id) { _catFotos = fotos.slice(); _catPintarFotos(); }
    const sp = (typeof STOCK !== 'undefined') ? STOCK.find(x => x.id === id) : null;
    if (sp) sp.fotos = fotos.slice();
  }, e => console.error('qr celu:', e));
}

function catQrCerrar() {
  if (_catQrUnsub) { _catQrUnsub(); _catQrUnsub = null; }
  document.getElementById('cat-qr')?.remove();
  // Si se abrió desde la ficha del equipo, que muestre las fotos nuevas
  const det = document.getElementById('detail-modal');
  if (det && !det.classList.contains('hidden') && typeof openDetail === 'function' && window._catQrDesdeFicha) openDetail(window._catQrDesdeFicha);
  window._catQrDesdeFicha = null;
}

function catElegirFotos(input) {
  Array.from(input.files || []).forEach(file => _catPendientes.push({ file, url: URL.createObjectURL(file) }));
  input.value = '';
  _catPintarFotos();
}

function catQuitarPendiente(i) {
  const x = _catPendientes.splice(i, 1)[0];
  if (x) URL.revokeObjectURL(x.url);
  _catPintarFotos();
}

// Se llama después de guardar el equipo (ya tiene id)
async function catSubirPendientes(id) {
  if (!_catPendientes.length) return;
  const files = _catPendientes.map(x => x.file);
  _catPendientes.forEach(x => URL.revokeObjectURL(x.url));
  _catPendientes = [];
  if (typeof uploadStockPhotos === 'function') await uploadStockPhotos(id, files);
}

// Reordena: la elegida pasa a ser la primera (la portada)
async function _catGuardarOrden(id, fotos) {
  await db.collection('stock').doc(id).update({ fotos });
  const p = (typeof STOCK !== 'undefined') ? STOCK.find(x => x.id === id) : null;
  if (p) p.fotos = fotos.slice();
}

async function catPortadaForm(i) {
  if (!_catId) return;
  const fotos = _catFotos.slice();
  const [url] = fotos.splice(i, 1);
  fotos.unshift(url);
  try {
    await _catGuardarOrden(_catId, fotos);
    _catFotos = fotos;
    _catPintarFotos();
  } catch (e) { console.error('portada:', e); toast('No se pudo cambiar la portada', 'error'); }
}

// Desde la ficha del equipo (galería de stock-extras.js)
async function catPortada(id, url) {
  const p = (typeof STOCK !== 'undefined') ? STOCK.find(x => x.id === id) : null;
  if (!p) return;
  const fotos = [url, ...(p.fotos || []).filter(u => u !== url)];
  try {
    await _catGuardarOrden(id, fotos);
    toast('⭐ Portada cambiada', 'success');
    if (typeof openDetail === 'function') openDetail(id);
  } catch (e) { console.error('portada:', e); toast('No se pudo cambiar la portada', 'error'); }
}

// Quitar una foto ya subida: se borra el archivo de Storage y del equipo
async function catQuitarFoto(i) {
  if (!_catId) return;
  const url = _catFotos[i];
  if (!url || !confirm('¿Quitar esta foto?')) return;
  try {
    const st = (typeof _getStorage === 'function') ? _getStorage() : null;
    if (st) { try { await st.refFromURL(url).delete(); } catch (e) { console.warn('No se pudo borrar de Storage:', e); } }
    const fotos = _catFotos.filter((_, k) => k !== i);
    await _catGuardarOrden(_catId, fotos);
    _catFotos = fotos;
    _catPintarFotos();
  } catch (e) { console.error('quitar foto:', e); toast('No se pudo quitar la foto', 'error'); }
}

// Al borrar un equipo, sus fotos se van con él (no quedan archivos huérfanos)
async function catBorrarFotosDe(p) {
  const st = (typeof _getStorage === 'function') ? _getStorage() : null;
  if (!st || !p || !Array.isArray(p.fotos)) return;
  await Promise.all(p.fotos.map(u => st.refFromURL(u).delete().catch(e => console.warn('foto huérfana:', u, e))));
}

// Menú → 🌐 Página de equipos
async function catAbrirPagina() {
  const publicados = (typeof STOCK !== 'undefined') ? STOCK.filter(p => p.publicar && !p.vendido).length : 0;
  try { await navigator.clipboard.writeText(CAT_URL); toast(`🔗 Link copiado · ${publicados} equipo${publicados === 1 ? '' : 's'} publicado${publicados === 1 ? '' : 's'}`, 'success'); }
  catch { toast(CAT_URL, 'info'); }
  window.open(CAT_URL, '_blank', 'noopener');
}

// Selección múltiple del stock → 🌐 Publicar / 🚫 Sacar de la página.
// Los vendidos no se publican (saldrían directo como "Sin stock").
async function batchPublicar(publicar) {
  const sel = (typeof _batchSelected !== 'undefined') ? Array.from(_batchSelected) : [];
  if (!sel.length) { toast('Seleccioná al menos un equipo', 'info'); return; }
  const equipos = sel.map(id => (typeof STOCK !== 'undefined' ? STOCK.find(x => x.id === id) : null)).filter(Boolean);
  const vendidos = publicar ? equipos.filter(p => p.vendido).length : 0;
  const cambiar = equipos.filter(p => (publicar ? !p.vendido : true) && !!p.publicar !== publicar);
  if (!cambiar.length) {
    toast(publicar ? (vendidos ? 'Esos equipos ya están vendidos' : 'Ya estaban todos en la página')
                   : 'Ninguno estaba en la página', 'info');
    return;
  }
  try {
    // Firestore acepta hasta 500 cambios por tanda
    for (let i = 0; i < cambiar.length; i += 450) {
      const b = db.batch();
      cambiar.slice(i, i + 450).forEach(p => b.update(db.collection('stock').doc(p.id), { publicar }));
      await b.commit();
    }
    cambiar.forEach(p => { p.publicar = publicar; });
    const n = cambiar.length, s = n === 1 ? '' : 's';
    let msg = publicar ? `🌐 ${n} equipo${s} publicado${s} en la página` : `🚫 ${n} equipo${s} sacado${s} de la página`;
    if (vendidos) msg += ` · ${vendidos} vendido${vendidos === 1 ? '' : 's'} quedó afuera`;
    const sinFoto = publicar ? cambiar.filter(p => !(p.fotos || []).length).length : 0;
    if (sinFoto) msg += ` · ${sinFoto} sin fotos`;
    toast(msg, 'success');
    if (typeof exitBatchMode === 'function') exitBatchMode();
  } catch (e) {
    console.error('batchPublicar:', e);
    toast('No se pudo actualizar la página', 'error');
  }
}
