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
  catPubAviso();
}

// ── Lo que le falta a la ficha ────────────────────────────
// Los equipos publicados salían pelados: de los 19 que había, ninguno tenía
// batería, ni color, ni detalles. La ficha sabe mostrar todo eso lindo (hasta
// una barra de batería de color) y quedaba vacía porque el formulario no lo
// pedía. Esto NO frena el guardado: avisa, ahí, mientras lo cargas.
const CAT_PRECIO_MIN_ARS = 10000;
const CAT_PRECIO_MIN_USD = 10;

function catPrecioRaro(precio, esUSD) {
  const n = Number(precio) || 0;
  if (n <= 0) return false;
  return n < (esUSD ? CAT_PRECIO_MIN_USD : CAT_PRECIO_MIN_ARS);
}

// Lo que el cliente pregunta y la ficha podría contestar sola.
function catFaltantes() {
  const v = id => (_catEl(id)?.value || '').trim();
  const falta = [];
  if (!v('fi-color')) falta.push('color');
  // La batería es LA pregunta de un usado. En uno nuevo no hace falta.
  const esUsado = v('fi-estado') && v('fi-estado') !== 'Nuevo';
  if (esUsado && !(parseInt(v('fi-bateria'), 10) > 0)) falta.push('batería');
  if (!v('fi-detalles-pub')) falta.push('detalles');
  if (!(parseInt(v('fi-garantia'), 10) > 0)) falta.push('garantía');
  if (!_catFotos.length && !_catPendientes.length) falta.push('fotos');
  return falta;
}

function catPubAviso() {
  const box = _catEl('fi-pub-aviso');
  if (!box) return;
  if (!_catEl('fi-publicar')?.checked) { box.innerHTML = ''; box.classList.add('hidden'); return; }
  const falta = catFaltantes();
  const esUSD = typeof window !== 'undefined' && window._precioUSD !== null && window._precioUSD !== undefined;
  const raro = catPrecioRaro(_catEl('fi-precio')?.value, esUSD);
  if (!falta.length && !raro) {
    box.innerHTML = '✅ La ficha sale completa';
    box.className = 'pub-aviso pub-aviso--ok';
    return;
  }
  box.className = 'pub-aviso';
  box.innerHTML = (raro ? `<b>⚠️ Revisá el precio: ${esc(_catEl('fi-precio')?.value || '')} es muy bajo para un celular.</b><br>` : '')
    + (falta.length ? `Le falta <b>${falta.join(', ')}</b> — son los datos que te preguntan por WhatsApp.` : '');
}

// Antes de guardar: el precio imposible sí frena, porque lo ve el cliente.
// Devuelve false para cortar el guardado.
function catConfirmarPublicacion(precio, esUSD) {
  if (!_catEl('fi-publicar')?.checked) return true;
  if (!catPrecioRaro(precio, esUSD)) return true;
  return confirm(`El precio es ${esUSD ? 'U$S ' : '$'}${precio}.\n\n` +
    `Para un celular eso no cierra: ¿no son dólares cargados en el campo de pesos?\n\n` +
    `Si lo publicás así, el cliente ve ese número en la página.\n\n¿Guardar igual?`);
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
  catEngancharAviso();
  catPubAviso();
}

// El aviso se repinta cuando cambia cualquiera de los campos que mira.
let _catEnganchado = false;
function catEngancharAviso() {
  if (_catEnganchado) return;   // catFormCargar corre en cada apertura
  _catEnganchado = true;
  ['fi-color', 'fi-detalles-pub', 'fi-bateria', 'fi-garantia', 'fi-precio', 'fi-estado']
    .forEach(id => _catEl(id)?.addEventListener('input', catPubAviso));
  _catEl('fi-estado')?.addEventListener('change', catPubAviso);
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
  catPubAviso();   // las fotos también son uno de los faltantes
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

// ══════════════════════════════════════════════════════════════
//  🌐 PANEL: PUBLICAR O SACAR EQUIPOS DE LA PÁGINA
// ══════════════════════════════════════════════════════════════
// Alan (23/11): "me hacés algo para los equipos en venta, con respecto a
// publicarlos o sacarlos de la página". Antes había que abrir cada equipo
// (o entrar a "Seleccionar varios"). Acá están todos los que están a la
// venta, cada uno con un interruptor: se toca y listo. Dice qué le falta a
// cada uno para verse bien (fotos, precio, batería) y deja publicar de una
// todos los que ya tienen fotos.
let _cpFiltro = 'todos', _cpQ = '';

function catPanelEquipos(stock) {
  return (stock || []).filter(p => p && !p.vendido && !p.eliminado && !p.bloqueado);
}
// Lo que le falta a un equipo YA cargado para que la ficha se vea bien
function catFaltaDe(p) {
  const f = [];
  if (!(Array.isArray(p.fotos) && p.fotos.length)) f.push('fotos');
  const usd = p.moneda === 'usd' && Number(p.precioUSD) > 0;
  if (!p.ocultarPrecio && !(Number(usd ? p.precioUSD : p.precio) > 0)) f.push('precio');
  if (p.estado && p.estado !== 'Nuevo' && !(Number(p.bateria) > 0)) f.push('batería');
  return f;
}
function _cpNombre(p) {
  const m = (typeof marcaCanon === 'function') ? marcaCanon(p.marca) : (p.marca || '');
  const repite = m && String(p.modelo || '').toLowerCase().startsWith(m.toLowerCase());
  return [repite ? '' : m, p.modelo, p.almacenamiento].filter(Boolean).join(' ') || 'Equipo';
}
function _cpPrecio(p) {
  if (p.ocultarPrecio) return 'Consultar precio';
  if (p.moneda === 'usd' && Number(p.precioUSD) > 0) return 'U$S ' + Number(p.precioUSD).toLocaleString('es-AR');
  return Number(p.precio) > 0 ? '$ ' + Number(p.precio).toLocaleString('es-AR') : 'Sin precio';
}

function catPanelAbrir() {
  if (typeof tpFrenar === 'function' && tpFrenar('stock', 'publicar equipos')) return;
  _cpEstilos();
  let m = document.getElementById('cp-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'cp-modal';
    m.className = 'cp-fondo';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-label', 'Equipos en la página');
    m.addEventListener('click', e => { if (e.target === m) catPanelCerrar(); });
    document.body.appendChild(m);
  }
  _cpQ = '';
  m.innerHTML = `<div class="cp-hoja">
    <div class="cp-cab">
      <div><b>🌐 Equipos en la página</b><small id="cp-resumen"></small></div>
      <button type="button" class="cp-x" onclick="catPanelCerrar()" aria-label="Cerrar">✕</button>
    </div>
    <input id="cp-buscar" class="fi" type="search" placeholder="Buscar: iPhone 13, A54…" autocomplete="off" oninput="_cpQ=this.value;catPanelPintar()">
    <div class="cp-tabs" id="cp-tabs"></div>
    <div class="cp-lista" id="cp-lista"></div>
    <div class="cp-pie" id="cp-pie"></div>
  </div>`;
  m.classList.remove('hidden');
  catPanelPintar();
}
function catPanelCerrar() {
  const m = document.getElementById('cp-modal');
  if (m) m.classList.add('hidden');
}
function catPanelFiltro(f) { _cpFiltro = f; catPanelPintar(); }

function catPanelPintar() {
  const todos = catPanelEquipos(typeof STOCK !== 'undefined' ? STOCK : []);
  const en = todos.filter(p => p.publicar), fuera = todos.filter(p => !p.publicar);
  const res = document.getElementById('cp-resumen');
  if (res) res.textContent = `${en.length} en la página · ${fuera.length} sin publicar`;
  const tabs = document.getElementById('cp-tabs');
  if (tabs) tabs.innerHTML = [['todos', `Todos (${todos.length})`], ['en', `En la página (${en.length})`], ['fuera', `Sin publicar (${fuera.length})`]]
    .map(([k, t]) => `<button type="button" class="${_cpFiltro === k ? 'on' : ''}" onclick="catPanelFiltro('${k}')">${t}</button>`).join('');
  let lista = _cpFiltro === 'en' ? en : (_cpFiltro === 'fuera' ? fuera : todos);
  const q = String(_cpQ || '').toLowerCase().trim();
  if (q) lista = lista.filter(p => q.split(/\s+/).every(w => (_cpNombre(p) + ' ' + (p.color || '')).toLowerCase().includes(w)));
  // Publicados arriba; de los que no, primero los que ya están listos (con fotos)
  lista = lista.slice().sort((a, b) => (!!b.publicar - !!a.publicar) || (catFaltaDe(a).length - catFaltaDe(b).length));
  const box = document.getElementById('cp-lista');
  if (box) box.innerHTML = lista.length ? lista.map(p => {
    const falta = catFaltaDe(p);
    const foto = Array.isArray(p.fotos) && p.fotos[0];
    return `<div class="cp-fila${p.publicar ? ' on' : ''}">
      <button type="button" class="cp-info" onclick="catPanelCerrar();openForm('${esc(p.id)}')" title="Abrir el equipo">
        ${foto ? `<img src="${esc(foto)}" alt="" loading="lazy">` : '<span class="cp-sinfoto">📱</span>'}
        <span class="cp-txt"><b>${esc(_cpNombre(p))}</b>
          <small>${esc(_cpPrecio(p))}${p.estado ? ' · ' + esc(p.estado) : ''}${p.reservado ? ' · 🔒 reservado' : ''}</small>
          ${falta.length ? `<small class="cp-falta">Falta: ${falta.join(', ')}</small>` : '<small class="cp-ok">✓ Ficha completa</small>'}
        </span>
      </button>
      <label class="cp-sw" title="${p.publicar ? 'Sacar de la página' : 'Publicar en la página'}">
        <input type="checkbox" ${p.publicar ? 'checked' : ''} onchange="catPanelSwitch('${esc(p.id)}', this.checked, this)">
        <span aria-hidden="true"></span>
      </label>
    </div>`;
  }).join('') : `<p class="cp-vacio">${q ? 'No hay equipos con esa búsqueda.' : (_cpFiltro === 'en' ? 'No hay equipos en la página todavía.' : 'No hay equipos acá.')}</p>`;
  const listos = fuera.filter(p => (p.fotos || []).length);
  const pie = document.getElementById('cp-pie');
  if (pie) pie.innerHTML = (listos.length ? `<button type="button" class="cp-btn" onclick="catPanelPublicarListos()">🌐 ${listos.length === 1 ? 'Publicar el que ya tiene fotos' : `Publicar los ${listos.length} que ya tienen fotos`}</button>` : '')
    + `<button type="button" class="cp-btn sec" onclick="catAbrirPagina()">🔗 Ver la página</button>`;
}

async function catPanelSwitch(id, on, input) {
  if (typeof tpFrenar === 'function' && tpFrenar('stock', 'publicar equipos')) { if (input) input.checked = !on; return; }
  const p = (typeof STOCK !== 'undefined' ? STOCK : []).find(x => x.id === id);
  if (!p) return;
  const antes = !!p.publicar;
  p.publicar = !!on;
  catPanelPintar();
  try {
    await db.collection('stock').doc(id).update({ publicar: !!on });
    const falta = on ? catFaltaDe(p) : [];
    toast(on ? `🌐 ${_cpNombre(p)} ya está en la página${falta.length ? ' · le falta: ' + falta.join(', ') : ''}` : `🚫 ${_cpNombre(p)} salió de la página`, on && falta.length ? 'info' : 'success');
    if (typeof render === 'function') render();
  } catch (e) {
    console.error('publicar:', e);
    p.publicar = antes;
    catPanelPintar();
    toast('No se pudo cambiar. Revisá la conexión.', 'error');
  }
}

async function catPanelPublicarListos() {
  if (typeof tpFrenar === 'function' && tpFrenar('stock', 'publicar equipos')) return;
  const listos = catPanelEquipos(typeof STOCK !== 'undefined' ? STOCK : []).filter(p => !p.publicar && (p.fotos || []).length);
  if (!listos.length) return;
  if (!confirm(`¿Publicar ${listos.length} equipo${listos.length === 1 ? '' : 's'} en la página?`)) return;
  try {
    for (let i = 0; i < listos.length; i += 450) {
      const b = db.batch();
      listos.slice(i, i + 450).forEach(p => b.update(db.collection('stock').doc(p.id), { publicar: true }));
      await b.commit();
    }
    listos.forEach(p => { p.publicar = true; });
    toast(`🌐 ${listos.length} equipo${listos.length === 1 ? '' : 's'} publicado${listos.length === 1 ? '' : 's'}`, 'success');
    catPanelPintar();
    if (typeof render === 'function') render();
  } catch (e) {
    console.error('publicar listos:', e);
    toast('No se pudo publicar. Revisá la conexión.', 'error');
  }
}

function _cpEstilos() {
  if (document.getElementById('cp-css')) return;
  const st = document.createElement('style');
  st.id = 'cp-css';
  st.textContent = `
  .cp-fondo { position: fixed; inset: 0; z-index: 1200; background: rgba(0,0,0,.5); display: flex; align-items: flex-end; justify-content: center; }
  .cp-fondo.hidden { display: none; }
  .cp-hoja { width: 100%; max-width: 640px; height: 92vh; display: flex; flex-direction: column; gap: 10px; background: var(--card, #fff); color: var(--text, #111);
    border-radius: 20px 20px 0 0; padding: 16px 16px max(14px, env(safe-area-inset-bottom)); box-shadow: 0 -10px 40px rgba(0,0,0,.3); }
  @media (min-width: 700px) { .cp-fondo { align-items: center; } .cp-hoja { border-radius: 20px; height: 86vh; } }
  .cp-cab { display: flex; gap: 10px; align-items: flex-start; }
  .cp-cab > div { flex: 1; min-width: 0; }
  .cp-cab b { display: block; font-size: 19px; }
  .cp-cab small { color: var(--t2, #666); font-size: 13.5px; }
  .cp-x { flex: none; width: 36px; height: 36px; border-radius: 50%; border: 0; background: var(--bg2, rgba(128,128,128,.12)); color: inherit; font-size: 16px; cursor: pointer; }
  .cp-tabs { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; flex: none; }
  .cp-tabs button { flex: none; border: 1px solid var(--border, rgba(128,128,128,.3)); background: none; color: inherit; border-radius: 99px; padding: 7px 13px; font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
  .cp-tabs button.on { background: var(--text, #111); color: var(--card, #fff); border-color: var(--text, #111); }
  .cp-lista { flex: 1; overflow-y: auto; display: grid; align-content: start; gap: 8px; margin: 0 -4px; padding: 0 4px; }
  .cp-fila { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 14px; border: 1px solid var(--border, rgba(128,128,128,.2)); background: var(--bg2, rgba(128,128,128,.04)); }
  .cp-fila.on { border-color: var(--grn, #10b981); }
  .cp-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; border: 0; background: none; color: inherit; text-align: left; padding: 0; font: inherit; cursor: pointer; }
  .cp-info img, .cp-sinfoto { flex: none; width: 54px; height: 54px; border-radius: 10px; object-fit: cover; }
  .cp-sinfoto { display: grid; place-items: center; font-size: 24px; background: var(--border, rgba(128,128,128,.15)); }
  .cp-txt { min-width: 0; display: flex; flex-direction: column; }
  .cp-txt b { font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cp-txt small { font-size: 12.5px; color: var(--t2, #666); }
  .cp-txt small.cp-falta { color: var(--warn, #b45309); font-weight: 600; }
  .cp-txt small.cp-ok { color: var(--grn, #10b981); font-weight: 600; }
  .cp-sw { position: relative; flex: none; width: 52px; height: 30px; cursor: pointer; }
  .cp-sw input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
  .cp-sw span { position: absolute; inset: 0; border-radius: 99px; background: var(--border, rgba(128,128,128,.4)); transition: background .15s; pointer-events: none; }
  .cp-sw span::after { content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .15s; }
  .cp-sw input:checked + span { background: var(--grn, #10b981); }
  .cp-sw input:checked + span::after { transform: translateX(22px); }
  .cp-sw input:focus-visible + span { outline: 2px solid var(--accent, #3b82f6); outline-offset: 2px; }
  .cp-vacio { text-align: center; color: var(--t2, #666); padding: 30px 10px; }
  .cp-pie { display: flex; gap: 8px; flex-wrap: wrap; flex: none; }
  .cp-btn { flex: 1 1 200px; border: 0; border-radius: 12px; padding: 12px; font: inherit; font-weight: 700; background: var(--grn, #10b981); color: #fff; cursor: pointer; }
  .cp-btn.sec { background: var(--bg2, rgba(128,128,128,.12)); color: inherit; flex: 0 1 auto; }`;
  document.head.appendChild(st);
}

// ══════════════════════════════════════════════════════════════
//  🔤 UNIFICAR MARCAS (los equipos ya cargados)
// ══════════════════════════════════════════════════════════════
// marcaCanon (utils.js) ya junta las variantes al mostrar y al guardar. Esto
// corrige de una vez cómo quedaron escritas en los equipos viejos, así en
// todos lados (reportes, búsquedas, exportar) dice lo mismo.
function stockMarcasACorregir(stock) {
  const cambios = {};
  (stock || []).forEach(p => {
    const de = String((p && p.marca) || '');
    if (!de.trim() || typeof marcaCanon !== 'function') return;
    const a = marcaCanon(de);
    if (a === de) return;
    const k = de + '→' + a;
    (cambios[k] = cambios[k] || { de, a, ids: [] }).ids.push(p.id);
  });
  return Object.values(cambios).sort((x, y) => y.ids.length - x.ids.length);
}

async function stockUnificarMarcas() {
  if (typeof tpFrenar === 'function' && tpFrenar('stock', 'corregir marcas')) return;
  const cambios = stockMarcasACorregir(typeof STOCK !== 'undefined' ? STOCK : []);
  if (!cambios.length) { toast('✅ Las marcas ya están todas bien escritas', 'success'); return; }
  const total = cambios.reduce((n, c) => n + c.ids.length, 0);
  const detalle = cambios.slice(0, 15).map(c => `"${c.de}" (${c.ids.length}) → ${c.a}`).join('\n') + (cambios.length > 15 ? `\n… y ${cambios.length - 15} más` : '');
  if (!confirm(`Corregir la marca de ${total} equipo${total === 1 ? '' : 's'}:\n\n${detalle}\n\n¿Dale?`)) return;
  try {
    const ops = [];
    cambios.forEach(c => c.ids.forEach(id => ops.push([id, c.a])));
    for (let i = 0; i < ops.length; i += 450) {
      const b = db.batch();
      ops.slice(i, i + 450).forEach(([id, a]) => b.update(db.collection('stock').doc(id), { marca: a }));
      await b.commit();
    }
    ops.forEach(([id, a]) => { const p = STOCK.find(x => x.id === id); if (p) p.marca = a; });
    toast(`🔤 Listo: ${total} equipo${total === 1 ? '' : 's'} con la marca corregida`, 'success');
    if (typeof render === 'function') render();
  } catch (e) {
    console.error('unificar marcas:', e);
    toast('No se pudieron corregir. Revisá la conexión.', 'error');
  }
}
