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

// Exportar los seleccionados del modo selección múltiple.
// Antes armaba su PROPIO formato, distinto al del botón 📋 Lista: el mismo
// negocio mandaba dos mensajes con dos caras según de dónde salieran. Ahora
// los dos caminos abren el mismo cuadro y usan el mismo texto.
function batchExportWA() {
  if (!_batchSelected.size) { toast('Seleccioná al menos uno', 'info'); return; }
  const items = Array.from(_batchSelected).map(id => STOCK.find(x => x.id === id)).filter(Boolean);
  if (!items.length) return;
  openListaWaModal(items);
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

// ══════════════════════════════════════════
//  LISTA DE EQUIPOS PARA WHATSAPP
//  ─────────────────────────────────────────
//  Los clientes piden "mandame qué tenés". Esto arma el texto con LO QUE
//  ESTÁS VIENDO: filtrás arriba como siempre (marca, estado, precio) y el
//  botón convierte esa misma lista en un mensaje.
//
//  Decisiones tomadas con el dueño:
//   · Agrupado por marca, una línea por equipo.
//   · En los iPhone va la salud de batería: es lo primero que preguntan.
//   · Solo equipos disponibles: nunca vendidos ni reservados. Ofrecer algo
//     reservado y que te lo pidan es quedar mal con dos clientes a la vez.
//   · Todo en pesos, aunque el equipo esté cargado en dólares.
// ══════════════════════════════════════════

// El precio en pesos, como NÚMERO. Si el equipo está cargado en dólares se
// convierte con la cotización que la app ya tiene.
// Se usa para mostrar Y para ordenar: ordenando por `precio` a secas, un
// equipo en dólares vale 0 y se iba al principio de la lista aunque fuera el
// más caro.
function _listaPrecioNum(p) {
  const ars = Number(p.precio) || 0;
  if (ars > 0) return ars;
  const usd = Number(p.precioUSD) || 0;
  const dolar = (typeof dolarBlue === 'number' && dolarBlue > 0) ? dolarBlue
              : (typeof getCurrentDolar === 'function' ? (getCurrentDolar() || 0) : 0);
  if (usd > 0 && dolar > 0) return Math.round(usd * dolar);
  return 0;
}

function _listaPrecio(p) {
  const n = _listaPrecioNum(p);
  if (n > 0) return '$' + n.toLocaleString('es-AR');
  // Cargado en dólares pero sin cotización a mano: mejor el número real que
  // un "consultar" que no dice nada.
  const usd = Number(p.precioUSD) || 0;
  return usd > 0 ? 'u$' + usd.toLocaleString('es-AR') : 'consultar';
}

// ¿Es un iPhone? Se mira marca y modelo porque en el stock aparece cargado de
// las dos formas ("Apple" + "iPhone 11", o directamente marca "iPhone").
function _esIphone(p) {
  return /iphone|apple/i.test(`${p.marca || ''} ${p.modelo || ''}`);
}

// Una línea de equipo: modelo · memoria · estado — precio
function _listaLinea(p) {
  const partes = [p.modelo || 'Equipo'];
  if (p.almacenamiento) partes.push(p.almacenamiento);
  if (p.estado) partes.push(p.estado);
  // La batería solo en los iPhone: es el dato que siempre preguntan.
  if (_esIphone(p) && Number(p.bateria) > 0) partes.push('🔋' + p.bateria + '%');
  return `• ${partes.join(' · ')} — ${_listaPrecio(p)}`;
}

const LISTA_HEADER_DEF = '📱 *EQUIPOS DISPONIBLES* — {NEGOCIO}\n_Actualizado {FECHA}_';
const LISTA_FOOTER_DEF = '📍 {DIRECCION}\n🕐 {HORARIO}\n_Consultanos por otros modelos_ 👋';

function _listaTpl(clave, porDefecto) {
  const t = (typeof WA_TEMPLATES !== 'undefined' && WA_TEMPLATES) ? WA_TEMPLATES[clave] : null;
  const bd = (typeof BIZ_DATA !== 'undefined' && BIZ_DATA) || {};
  return (t || porDefecto)
    .replace(/{NEGOCIO}/g, (typeof window !== 'undefined' && window._DAKI_NAME) || 'TechPoint')
    // La fecha sale de todayAR() (yyyy-mm-dd) y se da vuelta a mano: con
    // toLocaleDateString el mismo código imprime "5/9" o "05/09" según el
    // dispositivo, y la lista se manda desde el celu y desde la compu.
    .replace(/{FECHA}/g, (() => {
      const h = (typeof todayAR === 'function') ? todayAR() : new Date().toISOString().slice(0, 10);
      const [, m, d] = h.split('-');
      return `${d}/${m}`;
    })())
    .replace(/{DIRECCION}/g, bd.dir || '')
    .replace(/{HORARIO}/g, bd.extra || '')
    .replace(/{TELEFONO}/g, bd.tel || '');
}

// Arma el texto completo. `equipos` ya viene filtrado.
function armarListaWa(equipos) {
  const dispo = (equipos || []).filter(p => !p.vendido && !p.reservado);
  if (!dispo.length) return '';

  // Agrupado por marca, las marcas alfabéticas y adentro por precio.
  const porMarca = {};
  dispo.forEach(p => {
    const m = (p.marca || 'Otros').trim() || 'Otros';
    (porMarca[m] = porMarca[m] || []).push(p);
  });
  const bloques = Object.keys(porMarca).sort((a, b) => a.localeCompare(b, 'es')).map(m => {
    const lineas = porMarca[m]
      .sort((a, b) => _listaPrecioNum(a) - _listaPrecioNum(b))
      .map(_listaLinea).join('\n');
    return `*${m.toUpperCase()}*\n${lineas}`;
  });

  return [_listaTpl('lista_header', LISTA_HEADER_DEF), bloques.join('\n\n'),
          _listaTpl('lista_footer', LISTA_FOOTER_DEF)]
    .filter(Boolean).join('\n\n');
}

// ── Modal ─────────────────────────────────
// _listaBase = todos los equipos que se pueden ofrecer (ni vendidos ni
// reservados). Los filtros de acá adentro achican esa base para MOSTRAR, pero
// lo tildado se mantiene: podés filtrar Samsung, elegir dos, cambiar a Apple,
// elegir uno más, y mandar los tres juntos.
let _listaBase = [];
let _listaSel  = new Set();

const _lwaV = id => (document.getElementById(id)?.value || '').trim();
const _lwaN = id => { const n = parseInt(String(_lwaV(id)).replace(/[^\d]/g, ''), 10); return isNaN(n) ? 0 : n; };

// Los que se ven ahora, según los filtros del cuadro.
function _listaVisibles() {
  const q      = _lwaV('lwa-f-buscar');
  const marca  = _lwaV('lwa-f-marca');
  const estado = _lwaV('lwa-f-estado');
  const min    = _lwaN('lwa-f-min');
  const max    = _lwaN('lwa-f-max');
  return _listaBase.filter(p => {
    if (marca && p.marca !== marca) return false;
    if (estado && p.estado !== estado) return false;
    const pr = _listaPrecioNum(p);   // el precio en pesos, el mismo que se muestra
    if (min > 0 && pr < min) return false;
    if (max > 0 && pr > max) return false;
    if (q) {
      const hay = `${p.marca || ''} ${p.modelo || ''} ${p.almacenamiento || ''}`;
      return (typeof searchMatch === 'function')
        ? searchMatch(hay, q)
        : hay.toLowerCase().includes(q.toLowerCase());
    }
    return true;
  });
}

// `preSel` = equipos ya elegidos desde afuera (modo selección múltiple).
// Sin eso, la base es todo lo que se puede ofrecer.
function openListaWaModal(preSel) {
  const modal = document.getElementById('listawa-modal');
  if (!modal) return;
  const todos = (Array.isArray(preSel) && preSel.length)
    ? preSel
    : (typeof STOCK !== 'undefined' ? STOCK : []);
  _listaBase = todos.filter(p => !p.vendido && !p.reservado);

  // Los filtros del cuadro arrancan con lo que tengas puesto en la pantalla
  // de atrás, y de ahí en más mandan los de acá.
  // Si venís de elegir equipos a mano, arrancan LIMPIOS: un filtro heredado
  // podría esconder justo los que acabás de seleccionar.
  const set = (k, v) => { const el = document.getElementById(k); if (el) el.value = v == null ? '' : String(v); };
  const de = id => (preSel ? '' : (document.getElementById(id)?.value || ''));
  set('lwa-f-buscar', de('search'));
  set('lwa-f-marca',  de('f-marca'));
  set('lwa-f-estado', de('f-estado'));
  set('lwa-f-min',    de('f-min'));
  set('lwa-f-max',    de('f-max'));
  _listaMarcasSelect();

  // Arrancan tildados los que se ven: lo más común es mandar eso. Sacar dos
  // es más rápido que tildar quince.
  _listaSel = new Set(_listaVisibles().map(p => p.id));

  const ocultos = todos.length - _listaBase.length;
  const nota = document.getElementById('listawa-nota');
  if (nota) {
    nota.textContent = _listaBase.length
      ? 'Filtrá y destildá los que no querés mandar.'
        + (ocultos > 0 ? ` (${ocultos} vendido/reservado queda afuera)` : '')
      : 'No hay equipos disponibles para ofrecer.';
  }
  _listaRenderSel();

  document.getElementById('listawa-overlay')?.classList.remove('hidden');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

// Carga el desplegable de marcas con las que hay de verdad para ofrecer.
function _listaMarcasSelect() {
  const sel = document.getElementById('lwa-f-marca');
  if (!sel) return;
  const previo = sel.value;
  const marcas = [...new Set(_listaBase.map(p => p.marca).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  sel.innerHTML = '<option value="">Todas las marcas</option>'
    + marcas.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  if (marcas.includes(previo)) sel.value = previo;
}

// Al mover un filtro solo cambia lo que se VE. Lo ya tildado se respeta.
function listaFiltrar() { _listaRenderSel(); }

function listaLimpiarFiltros() {
  ['lwa-f-buscar', 'lwa-f-marca', 'lwa-f-estado', 'lwa-f-min', 'lwa-f-max'].forEach(k => {
    const el = document.getElementById(k); if (el) el.value = '';
  });
  _listaRenderSel();
}

// Dibuja la lista de tildes y regenera el texto.
function _listaRenderSel() {
  const visibles = _listaVisibles();
  const cont = document.getElementById('listawa-sel');
  if (cont) {
    cont.innerHTML = visibles.length ? visibles.map(p => {
      const on = _listaSel.has(p.id);
      const specs = [p.almacenamiento, p.estado].filter(Boolean).join(' · ');
      return `<label class="lwa-item${on ? ' lwa-item--on' : ''}" data-id="${esc(p.id)}">
        <input type="checkbox" ${on ? 'checked' : ''} onchange="listaTogglePick('${esc(p.id)}')">
        <span class="lwa-item-txt">
          <span class="lwa-item-nom">${esc(p.marca || '')} ${esc(p.modelo || '')}</span>
          ${specs ? `<span class="lwa-item-meta">${esc(specs)}</span>` : ''}
        </span>
        <b class="lwa-item-precio">${_listaPrecio(p)}</b>
      </label>`;
    }).join('') : '<p class="lwa-vacio">Ningún equipo con estos filtros.</p>';
  }
  _listaCuenta();
  _listaRegenerar();
}

// El renglón de arriba de la lista.
function _listaCuenta() {
  const cuenta = document.getElementById('listawa-cuenta');
  if (!cuenta) return;
  const visibles = _listaVisibles();
  // Si hay filtro puesto, puede haber elegidos que no estén a la vista: se
  // dice, si no parece que se perdieron.
  const fuera = _listaSel.size - visibles.filter(p => _listaSel.has(p.id)).length;
  cuenta.textContent = `${_listaSel.size} elegido${_listaSel.size !== 1 ? 's' : ''}`
    + ` · ${visibles.length} a la vista`
    + (fuera > 0 ? ` (${fuera} fuera del filtro)` : '');
}

// Rearma el texto con TODO lo tildado, esté o no a la vista.
// Pisa lo que haya en el cuadro: el orden de uso es elegir primero y retocar
// el texto al final.
//
// OJO CON ESTO: lo primero que se ve en el cuadro es el ENCABEZADO, que nunca
// cambia. Al destildar un equipo la parte visible queda igual y parece que no
// pasó nada (los equipos están más abajo). Por eso el rótulo dice cuántos
// equipos y cuántos caracteres tiene, y el cuadro pega un destello: son las
// dos únicas señales de que se rearmó.
function _listaRegenerar() {
  const ta = document.getElementById('listawa-txt');
  if (!ta) return;
  const elegidos = _listaBase.filter(p => _listaSel.has(p.id));
  ta.value = armarListaWa(elegidos);

  const rot = document.getElementById('listawa-rotulo');
  if (rot) {
    rot.textContent = elegidos.length
      ? `Mensaje · ${elegidos.length} equipo${elegidos.length !== 1 ? 's' : ''} · ${ta.value.length} caracteres`
      : 'Mensaje · sin equipos elegidos';
  }
  // Destello: sacar la clase, forzar el reflow y volver a ponerla, si no dos
  // cambios seguidos no se notan (el navegador no reinicia la animación).
  ta.classList.remove('lwa-flash');
  void ta.offsetWidth;
  ta.classList.add('lwa-flash');
}

function listaTogglePick(id) {
  if (_listaSel.has(id)) _listaSel.delete(id); else _listaSel.add(id);
  // Se toca SOLO esa fila. Rearmando la lista entera, el innerHTML nuevo
  // manda el scroll al principio: si estabas abajo eligiendo el equipo 12,
  // perdías el lugar en cada toque.
  const fila = document.querySelector('.lwa-item[data-id="' + String(id).replace(/"/g, '') + '"]');
  if (fila) fila.classList.toggle('lwa-item--on', _listaSel.has(id));
  _listaCuenta();
  _listaRegenerar();
}

// "Todos" y "Ninguno" trabajan sobre lo que está A LA VISTA: con un filtro
// puesto, es lo que uno espera que hagan.
function listaPickTodos(v) {
  const visibles = _listaVisibles();
  if (v) visibles.forEach(p => _listaSel.add(p.id));
  else   visibles.forEach(p => _listaSel.delete(p.id));
  _listaRenderSel();
}

function closeListaWaModal() {
  document.getElementById('listawa-overlay')?.classList.add('hidden');
  document.getElementById('listawa-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

function listaWaCopiar(btn) {
  const txt = document.getElementById('listawa-txt')?.value || '';
  if (!txt) { toast('No hay nada para copiar', 'error'); return; }
  navigator.clipboard.writeText(txt).then(() => {
    if (btn) { const t = btn.textContent; btn.textContent = '✓ Copiado'; setTimeout(() => btn.textContent = t, 1600); }
  }).catch(() => toast('No se pudo copiar', 'error'));
}

// OJO: el link wa.me mete el texto en la URL y con listas largas se corta.
// Por eso el botón grande es Copiar y este avisa antes de romper el mensaje.
const _LISTA_WA_MAX = 1800;

function listaWaEnviar() {
  const txt = document.getElementById('listawa-txt')?.value || '';
  if (!txt) return;
  if (txt.length > _LISTA_WA_MAX &&
      !confirm(`La lista es larga (${txt.length} caracteres) y WhatsApp puede cortarla al abrirla por el link.\n\nConviene usar 📋 Copiar y pegarla en el chat.\n\n¿Abrir WhatsApp igual?`)) return;
  window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
}
