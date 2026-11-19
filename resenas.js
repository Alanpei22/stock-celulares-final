// ══════════════════════════════════════════════════════════════
//  ⭐ QR para que los clientes dejen reseña en Google
// ══════════════════════════════════════════════════════════════
//  Alan (19/11): "QR para que me dejen reseña" (el de TechPoint Caseros).
//  El link de reseñas lo da Google en la ficha del negocio ("Pedir reseñas"
//  → copiar link, tipo https://g.page/r/XXXX/review): se pega una vez acá,
//  queda guardado en config/resenas y el cartel sale cuando se quiera.
//
//  El QR se genera en la app (qr.js), sin servicios de afuera: si mañana se
//  corta internet, el cartel igual sale.

let RESENAS_CFG = null;   // { caseros: 'https://…' }

// ¿Es un link que sirva? Tiene que ser https y de Google: un QR pegado en el
// mostrador que mande a cualquier otro lado sería un problema (y una vez
// impreso nadie lo revisa).
function resLinkValido(url) {
  const s = String(url || '').trim();
  let u;
  try { u = new URL(s); } catch { return { error: 'Eso no parece un link (tiene que empezar con https://)' }; }
  if (u.protocol !== 'https:') return { error: 'El link tiene que empezar con https://' };
  const h = u.hostname.toLowerCase();
  // google.com, google.com.ar… pero no "google.com.otro-sitio.com"
  const google = /(^|\.)google\.(com|com\.[a-z]{2}|[a-z]{2})$/.test(h) || ['g.page', 'goo.gl', 'maps.app.goo.gl', 'g.co'].includes(h);
  if (!google) return { error: 'Ese link no es de Google. Copialo desde tu ficha: "Pedir reseñas" → copiar link' };
  if (s.length > 300) return { error: 'El link es demasiado largo para el QR: usá el corto de "Pedir reseñas"' };
  return { url: s };
}

function _resDueno() {
  return (typeof _cajaIsOwner !== 'undefined' && _cajaIsOwner) || (typeof tpEsDueno === 'function' && tpEsDueno());
}

async function resAbrir() {
  _resEstilos();
  if (!RESENAS_CFG && typeof db !== 'undefined' && db) {
    try { const d = await db.collection('config').doc('resenas').get(); RESENAS_CFG = d.exists ? d.data() : {}; }
    catch (e) { console.warn('reseñas: no pude leer el link', e); RESENAS_CFG = {}; }
  }
  _resPintar();
}

function _resPintar() {
  const url = (RESENAS_CFG || {}).caseros || '';
  const dueno = _resDueno();
  const qr = url && typeof qrSvg === 'function' ? qrSvg(url, 46) : '';
  const cuerpo = url ? `
    <div class="res-qr">${qr}</div>
    <p class="res-sub">Probalo con la cámara de tu celu antes de imprimir: tiene que abrir la ventanita de las estrellas de <b>TechPoint Caseros</b>.</p>
    <div class="res-btns">
      <button type="button" class="res-ok" onclick="resImprimir('grande')">🖨️ Cartel para el mostrador (A5)</button>
      <button type="button" class="res-sec" onclick="resImprimir('chicos')">🖨️ 4 chiquitos en una hoja A4 (para recortar)</button>
      <button type="button" class="res-sec" onclick="window.open(${_resAttr(JSON.stringify(url))}, '_blank')">🔗 Probar el link</button>
    </div>` : `
    <p class="res-sub">Todavía no está cargado el link de reseñas de Google.</p>`;
  const editar = dueno ? `
    <details class="res-edit"${url ? '' : ' open'}>
      <summary>${url ? '✏️ Cambiar el link' : '📋 Cargar el link'}</summary>
      <p class="res-ayuda">En Google buscá <b>TechPoint Caseros</b> (con la cuenta de la ficha) → <b>Pedir reseñas</b> → copiar link, y pegalo acá.</p>
      <input id="res-link" class="res-in" type="url" inputmode="url" placeholder="https://g.page/r/…/review" value="${_resAttr(url)}">
      <button type="button" class="res-ok" onclick="resGuardar()">💾 Guardar</button>
    </details>` : (url ? '' : '<p class="res-sub">Pedile al dueño que lo cargue.</p>');
  _resModal(cuerpo + editar);
}

async function resGuardar() {
  if (!_resDueno()) { toast('El link lo cambia el dueño', 'error'); return; }
  const v = resLinkValido(document.getElementById('res-link')?.value);
  if (v.error) { toast(v.error, 'error'); return; }
  try {
    await db.collection('config').doc('resenas').set({ caseros: v.url, actualizado: new Date().toISOString() }, { merge: true });
    RESENAS_CFG = Object.assign({}, RESENAS_CFG, { caseros: v.url });
    toast('⭐ Link guardado: probá el QR con el celu', 'success');
    _resPintar();
  } catch (e) { console.error('reseñas:', e); toast('No se pudo guardar', 'error'); }
}

// ── El cartel ────────────────────────────────────────────────
function resCartelHtml(url, tamano) {
  const uno = mm => `
    <div class="c">
      <div class="t">¿Te gustó cómo te atendimos?</div>
      <div class="e">★★★★★</div>
      <div class="s">Dejanos tu reseña en Google</div>
      <div class="q">${qrSvg(url, mm)}</div>
      <div class="p">Escaneá el código con la cámara del celu</div>
      <div class="n">TechPoint · Caseros</div>
      <div class="g">¡Gracias! Nos ayuda un montón 🙌</div>
    </div>`;
  const grande = tamano !== 'chicos';
  // A5 (148×210): un cartel. A4: cuatro de 105×148 (A6) para recortar.
  const css = grande
    ? `@page{size:A5 portrait;margin:8mm}
       .c{height:192mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:1.2mm solid #111;border-radius:6mm;padding:6mm}
       .t{font-size:25pt;font-weight:900;line-height:1.1}.e{font-size:34pt;color:#f5a623;letter-spacing:2mm;margin:3mm 0 1mm}
       .s{font-size:17pt;font-weight:700}.q{margin:6mm 0 3mm}.p{font-size:12pt}.n{font-size:15pt;font-weight:900;margin-top:5mm}.g{font-size:11pt;margin-top:1mm}`
    : `@page{size:A4 portrait;margin:0}
       .hoja{display:grid;grid-template-columns:105mm 105mm;grid-template-rows:148.5mm 148.5mm}
       .c{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:.2mm dashed #999;padding:5mm}
       .t{font-size:15pt;font-weight:900;line-height:1.1}.e{font-size:21pt;color:#f5a623;letter-spacing:1mm;margin:2mm 0 0}
       .s{font-size:11.5pt;font-weight:700}.q{margin:4mm 0 2mm}.p{font-size:8.5pt}.n{font-size:10.5pt;font-weight:900;margin-top:3mm}.g{font-size:8pt}`;
  const cuerpo = grande ? uno(95) : `<div class="hoja">${uno(60)}${uno(60)}${uno(60)}${uno(60)}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Reseñas TechPoint</title><style>
    *{box-sizing:border-box;margin:0}body{font-family:Arial,Helvetica,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    ${css}</style></head><body>${cuerpo}</body></html>`;
}

function resImprimir(tamano) {
  const url = (RESENAS_CFG || {}).caseros;
  if (!url || typeof qrSvg !== 'function') { toast('Primero cargá el link', 'error'); return; }
  const html = resCartelHtml(url, tamano);
  // La ventana se abre en el toque (si se espera algo antes, Chrome la bloquea)
  if (typeof _imprimirTocando === 'function') _imprimirTocando('hoja', html, 'Reseñas');
  else if (typeof _openPrint === 'function') _openPrint(html, 'Reseñas');
}

// ── Pantalla ─────────────────────────────────────────────────
function _resAttr(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function resCerrar() { document.getElementById('res-ov')?.remove(); }
function _resModal(cuerpo) {
  resCerrar();
  const ov = document.createElement('div');
  ov.id = 'res-ov';
  ov.onclick = e => { if (e.target === ov) resCerrar(); };
  ov.innerHTML = `<div class="res-box"><div class="res-hd"><b>⭐ QR de reseñas en Google</b><button type="button" onclick="resCerrar()">✕</button></div>${cuerpo}</div>`;
  document.body.appendChild(ov);
}
function _resEstilos() {
  if (document.getElementById('res-css')) return;
  const s = document.createElement('style');
  s.id = 'res-css';
  s.textContent = `
  #res-ov { position: fixed; inset: 0; z-index: 3000; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .res-box { background: var(--card, #fff); color: var(--text, #111); border-radius: 16px; padding: 16px; width: min(420px, 100%); max-height: 90vh; overflow: auto; }
  .res-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 16px; }
  .res-hd button { border: 0; background: transparent; font-size: 18px; cursor: pointer; color: inherit; }
  .res-qr { display: flex; justify-content: center; padding: 10px; background: #fff; border-radius: 12px; margin: 6px 0; }
  .res-sub, .res-ayuda { font-size: 14px; line-height: 1.4; margin: 8px 0; }
  .res-ayuda { font-size: 13px; opacity: .85; }
  .res-btns { display: flex; flex-direction: column; gap: 8px; }
  .res-ok, .res-sec { width: 100%; padding: 12px; border-radius: 12px; font-weight: 800; font-size: 14.5px; cursor: pointer; }
  .res-ok { border: 0; background: var(--accent, #C8965A); color: #111; }
  .res-sec { border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; }
  .res-edit { margin-top: 12px; }
  .res-edit summary { cursor: pointer; font-weight: 700; font-size: 14px; }
  .res-in { width: 100%; padding: 11px; border-radius: 10px; border: 1px solid rgba(128,128,128,.45); background: transparent; color: inherit; font-size: 14px; margin: 6px 0 8px; box-sizing: border-box; }`;
  document.head.appendChild(s);
}
