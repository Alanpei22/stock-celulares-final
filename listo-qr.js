// ══════════════════════════════════════════════════════════════
//  ✅ EQUIPO LISTO LEYENDO EL QR (con foto de adelante y de atrás)
// ══════════════════════════════════════════════════════════════
//  Alan (22/11): "quiero que cada equipo pase a estar listo a través de la
//  lectura de QR, pida una foto del equipo, atrás y adelante".
//
//  Cómo queda:
//   · Se lee el QR de la etiqueta pegada al equipo: con el 📷 de Reparaciones,
//     con el acceso directo "Escanear reparación" o con la cámara del celu
//     (el link ?r=N de la etiqueta, app.js abrirRepairPorOrden).
//   · Si el equipo está en reparación, sale "✅ Equipo listo" con dos
//     recuadros: 📷 ADELANTE y 📷 ATRÁS. Hasta que no estén las dos fotos no
//     se puede marcar.
//   · Las fotos se achican (fotos-subir.js) y se suben a Storage
//     (reparaciones/{id}/), se anotan en la reparación (`fotosListo`) y recién
//     ahí pasa a Listo por el MISMO camino que el botón del tablero
//     (tpCambiarFase → changeRepairStatus): cobro, repuesto, aviso al
//     cliente, seguimiento del QR, todo igual.
//   · El botón "✅ Listo para retirar" de la ficha también pide las fotos. Solo
//     el dueño puede marcarlo sin fotos (por si se rompió la cámara).
//   · Si ya está listo, entregado o cerrado, el QR abre la ficha como siempre.
//
//  Para qué las fotos: queda cómo se entregó el equipo (pantalla sana, tapa
//  sin rayones). Si el cliente vuelve con un reclamo, está la foto. Se ven en
//  la ficha, en "📷 Cómo quedó".
'use strict';

const LQ_LADOS = [['adelante', 'Adelante', 'La pantalla, prendida si se puede'], ['atras', 'Atrás', 'La tapa y las cámaras']];
let _lq = null;   // { id, fotos: { adelante: File, atras: File }, urls: { … } }

// Lo leído → { nOrden } o { id }. Acepta el QR de la etiqueta (…?r=1234), el
// del comprobante del cliente (estado.html?o=1234&k=… o ?id=…) y un número a
// mano ("1234", "N°1234", "#1234").
function lqLeerCodigo(cod) {
  const s = String(cod == null ? '' : cod).trim();
  if (!s) return null;
  const q = /[?&]r=(\d+)/.exec(s) || /estado\.html\?(?:[^#]*&)?o=(\d+)/.exec(s);
  if (q) return { nOrden: parseInt(q[1], 10) };
  const id = /estado\.html\?(?:[^#]*&)?id=([\w-]+)/.exec(s);
  if (id) return { id: id[1] };
  const n = /^(?:n[°º.]?\s*|#)?(\d{1,7})$/i.exec(s.replace(/\s+/g, ''));
  if (n) return { nOrden: parseInt(n[1], 10) };
  return null;
}

// ¿Se puede pasar a Listo? Solo si está en el taller (no listo, ni entregado,
// ni cerrado sin arreglo).
function lqPuedeListo(r) {
  if (!r) return false;
  return r.estado === 'reparando';
}

// ── Leer con la cámara de la app (📷 de Reparaciones / acceso directo) ──
function repEscanearListo() {
  if (typeof abrirEscaner !== 'function') { if (typeof toast === 'function') toast('El lector no está disponible acá', 'error'); return; }
  abrirEscaner(cod => {
    const l = lqLeerCodigo(cod);
    if (!l) { toast('Ese código no es de la etiqueta de un equipo', 'error'); return; }
    if (l.id) { lqAbrir(l.id); return; }
    if (typeof abrirRepairPorOrden === 'function') abrirRepairPorOrden(l.nOrden);   // la busca aunque sea vieja → lqAbrir
  }, { titulo: 'Escaneá el QR de la etiqueta del equipo' });
}

// Llamado al encontrar la reparación por QR (y por el botón Listo de la ficha)
function lqAbrir(id) {
  const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === id);
  if (!r || !lqPuedeListo(r)) {
    if (typeof openRepairDetail === 'function') openRepairDetail(id);
    if (r && r.estado === 'listo' && typeof toast === 'function') toast(`N°${r.nOrden} ya estaba listo`, 'info');
    return 'ficha';
  }
  _lq = { id, fotos: {}, urls: {} };
  _lqPintar(r);
  return 'fotos';
}

function _lqPintar(r) {
  _lqEstilos();
  let m = document.getElementById('lq-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'lq-modal';
    m.className = 'lq-fondo';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-label', 'Equipo listo');
    document.body.appendChild(m);
  }
  const dueno = (typeof tpEsDueno === 'function') && tpEsDueno();
  const trabajo = (typeof _arreglosResumen === 'function' ? _arreglosResumen(r.arreglos) : '') || r.arreglo || '';
  const listas = LQ_LADOS.every(([k]) => _lq.fotos[k]);
  m.innerHTML = `<div class="lq-hoja">
    <div class="lq-cab">
      <div><b>✅ Equipo listo</b><small>N°${esc(r.nOrden)} · ${esc([r.marca, r.modelo].filter(Boolean).join(' '))}${r.nombre ? ' · ' + esc(r.nombre) : ''}</small></div>
      <button type="button" class="lq-x" onclick="lqCerrar()" aria-label="Cerrar">✕</button>
    </div>
    ${trabajo ? `<p class="lq-trab">🔧 ${esc(trabajo)}</p>` : ''}
    <p class="lq-pide">Sacale una foto <b>adelante</b> y otra <b>atrás</b> antes de marcarlo:</p>
    <div class="lq-fotos">${LQ_LADOS.map(([k, nom, ayuda]) => `
      <label class="lq-foto${_lq.fotos[k] ? ' ok' : ''}">
        <input type="file" accept="image/*" capture="environment" onchange="lqFoto('${k}', this)">
        ${_lq.urls[k] ? `<img src="${_lq.urls[k]}" alt="">` : `<span class="lq-cam" aria-hidden="true">📷</span>`}
        <b>${_lq.fotos[k] ? '✓ ' : ''}${nom}</b><small>${_lq.fotos[k] ? 'Tocá para sacarla de nuevo' : ayuda}</small>
      </label>`).join('')}
    </div>
    <button type="button" id="lq-ok" class="lq-ok" ${listas ? '' : 'disabled'} onclick="lqConfirmar(this)">${listas ? '✅ Marcar como listo' : 'Faltan las dos fotos'}</button>
    <div class="lq-pie">
      <button type="button" class="lq-link" onclick="lqVerFicha()">Ver la ficha</button>
      ${dueno ? `<button type="button" class="lq-link lq-sin" onclick="lqSinFotos()">Marcarlo sin fotos</button>` : ''}
    </div>
  </div>`;
  m.classList.remove('hidden');
}

function lqFoto(lado, input) {
  const f = input && input.files && input.files[0];
  if (!_lq || !f) return;
  if (_lq.urls[lado]) { try { URL.revokeObjectURL(_lq.urls[lado]); } catch {} }
  _lq.fotos[lado] = f;
  try { _lq.urls[lado] = URL.createObjectURL(f); } catch { _lq.urls[lado] = ''; }
  const r = REPAIRS.find(x => x.id === _lq.id);
  if (r) _lqPintar(r);
}

function lqCerrar() {
  const m = document.getElementById('lq-modal');
  if (m) m.classList.add('hidden');
  if (_lq) Object.values(_lq.urls).forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
  _lq = null;
}
function lqVerFicha() {
  const id = _lq && _lq.id;
  lqCerrar();
  if (id && typeof openRepairDetail === 'function') openRepairDetail(id);
}

// Una foto → Storage. Carpeta propia `reparaciones/{id}/`. Si las reglas
// nuevas de Storage todavía no se publicaron en Firebase, esa carpeta está
// cerrada: se usa la de fotos del stock, que ya está permitida, para que
// marcar Listo no se trabe por eso.
async function lqSubirFoto(id, lado, file, op = {}) {
  const storage = op.storage || firebase.storage();
  const { blob, ext, tipo } = await fotoAchicar(file);
  const nombre = `${lado}_${Date.now().toString(36)}.${ext}`;
  const meta = { contentType: tipo, cacheControl: (typeof FOTO_CACHE !== 'undefined' ? FOTO_CACHE : undefined) };
  const subir = async ruta => { const snap = await _fotoPut(storage.ref(ruta), blob, meta); return snap.ref.getDownloadURL(); };
  try {
    return await subir(`reparaciones/${id}/${nombre}`);
  } catch (e) {
    if (!/unauthori[sz]ed|permission|forbidden/i.test(String((e && (e.code || e.message)) || e))) throw e;
    console.warn('Storage: reparaciones/ sin permiso (¿falta publicar storage.rules?), uso stock-photos/');
    return await subir(`stock-photos/rep-${id}/${nombre}`);
  }
}

function _lqQuien() {
  const u = (typeof tpUsuario === 'function') ? tpUsuario() : null;
  return u ? String(u.nombre || '').slice(0, 40) : '';
}

async function lqConfirmar(btn) {
  if (!_lq) return;
  const id = _lq.id;
  const r = REPAIRS.find(x => x.id === id);
  if (!r) return;
  if (!LQ_LADOS.every(([k]) => _lq.fotos[k])) { toast('Faltan las fotos: adelante y atrás', 'error'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Subiendo las fotos…'; }
  try {
    const [adelante, atras] = await Promise.all(LQ_LADOS.map(([k]) => lqSubirFoto(id, k, _lq.fotos[k])));
    const fotosListo = { adelante, atras, fecha: new Date().toISOString(), por: _lqQuien() };
    await db.collection('repairs').doc(id).update({ fotosListo });
    Object.assign(r, { fotosListo });
    if (typeof _repPatchLocal === 'function') _repPatchLocal(id, { fotosListo });
  } catch (e) {
    console.error('fotos de listo:', e);
    toast('No se pudieron subir las fotos. Revisá la señal y probá de nuevo.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Marcar como listo'; }
    return;
  }
  lqCerrar();
  await _lqMarcarListo(id);
}

function lqSinFotos() {
  if (!_lq || !((typeof tpEsDueno === 'function') && tpEsDueno())) return;
  if (!confirm('¿Marcarlo listo SIN fotos? Si el cliente reclama, no va a haber cómo se entregó.')) return;
  const id = _lq.id;
  lqCerrar();
  _lqMarcarListo(id);
}

// El mismo camino que el botón del tablero (con la marca de que ya pasó por
// las fotos, para que no las vuelva a pedir)
async function _lqMarcarListo(id) {
  if (typeof tpCambiarFase === 'function') return tpCambiarFase(id, 'listo', { conFotos: true });
  if (typeof changeRepairStatus === 'function') return changeRepairStatus(id, 'listo');
}

// En la ficha: las dos fotos de cómo quedó
function lqFotosHtml(r) {
  const f = r && r.fotosListo;
  if (!f || !(f.adelante || f.atras)) return '';
  const cuando = (typeof tpFechaCorta === 'function' && f.fecha) ? tpFechaCorta(f.fecha) : String(f.fecha || '').slice(0, 10);
  const img = (u, nom) => u ? `<a class="lq-mini" href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${nom}" loading="lazy"><span>${nom}</span></a>` : '';
  _lqEstilos();
  return `<div class="det-row det-row--full tp-bloque">
    <span class="det-label">📷 Cómo quedó${cuando ? ' · ' + esc(cuando) : ''}${f.por ? ' · ' + esc(f.por) : ''}</span>
    <div class="lq-minis">${img(f.adelante, 'Adelante')}${img(f.atras, 'Atrás')}</div>
  </div>`;
}

function _lqEstilos() {
  if (document.getElementById('lq-css')) return;
  const st = document.createElement('style');
  st.id = 'lq-css';
  st.textContent = `
  .lq-fondo { position: fixed; inset: 0; z-index: 1200; background: rgba(0,0,0,.55); display: flex; align-items: flex-end; justify-content: center; }
  .lq-fondo.hidden { display: none; }
  .lq-hoja { width: 100%; max-width: 520px; max-height: 94vh; overflow-y: auto; background: var(--card, #fff); color: var(--text, #111); border-radius: 20px 20px 0 0; padding: 16px 16px max(18px, env(safe-area-inset-bottom)); box-shadow: 0 -10px 40px rgba(0,0,0,.3); }
  @media (min-width: 700px) { .lq-fondo { align-items: center; } .lq-hoja { border-radius: 20px; } }
  .lq-cab { display: flex; align-items: flex-start; gap: 10px; }
  .lq-cab > div { flex: 1; min-width: 0; }
  .lq-cab b { font-size: 19px; display: block; }
  .lq-cab small { display: block; color: var(--t2, #666); font-size: 13.5px; margin-top: 2px; }
  .lq-x { flex: none; border: 0; background: var(--bg2, rgba(128,128,128,.12)); color: inherit; width: 36px; height: 36px; border-radius: 50%; font-size: 16px; cursor: pointer; }
  .lq-trab { margin: 10px 0 0; font-size: 14px; background: var(--bg2, rgba(128,128,128,.08)); border-radius: 10px; padding: 8px 10px; }
  .lq-pide { margin: 12px 0 8px; font-size: 14.5px; }
  .lq-fotos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .lq-foto { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 190px; padding: 10px; border: 2px dashed var(--border, rgba(128,128,128,.4)); border-radius: 16px; text-align: center; cursor: pointer; overflow: hidden; background: var(--bg2, rgba(128,128,128,.06)); }
  .lq-foto input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .lq-foto.ok { border-style: solid; border-color: var(--grn, #10b981); }
  .lq-foto img { width: 100%; height: 120px; object-fit: cover; border-radius: 10px; }
  .lq-cam { font-size: 44px; line-height: 1; }
  .lq-foto b { font-size: 15px; }
  .lq-foto small { font-size: 12px; color: var(--t2, #666); }
  .lq-ok { width: 100%; margin-top: 14px; padding: 15px; border: 0; border-radius: 14px; background: var(--grn, #10b981); color: #fff; font: inherit; font-size: 16.5px; font-weight: 800; cursor: pointer; }
  .lq-ok:disabled { background: var(--border, rgba(128,128,128,.35)); color: var(--t2, #666); cursor: default; }
  .lq-pie { display: flex; justify-content: space-between; gap: 10px; margin-top: 10px; }
  .lq-link { border: 0; background: none; color: var(--accent, #3b82f6); font: inherit; font-size: 14px; font-weight: 600; padding: 6px 2px; cursor: pointer; }
  .lq-sin { color: var(--t2, #666); font-weight: 500; }
  .lq-minis { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }
  .lq-mini { position: relative; display: block; border-radius: 12px; overflow: hidden; background: var(--bg2, rgba(128,128,128,.08)); }
  .lq-mini img { display: block; width: 100%; height: 150px; object-fit: cover; }
  .lq-mini span { position: absolute; left: 6px; bottom: 6px; background: rgba(0,0,0,.6); color: #fff; font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 99px; }`;
  document.head.appendChild(st);
}
