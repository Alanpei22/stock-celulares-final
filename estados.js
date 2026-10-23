// ══════════════════════════════════════════════════════════════
//  📅 ESTADO DEL DÍA — "Hoy lunes, ya estamos abiertos"
// ══════════════════════════════════════════════════════════════
//  El estado de todos los días para WhatsApp, Instagram y TikTok: el logo del
//  local con un cartel que dice el día, el horario y los datos.
//
//  La gracia es que son SIETE IMÁGENES FIJAS, no una por día. El lunes dice
//  lo mismo todos los lunes. Así que se generan una sola vez acá (y cada vez
//  que cambies el horario o el color), se suben, y el aviso de cada mañana
//  solo manda la que toca. Nada que armar a la hora de abrir.
//
//  Se dibujan con el mismo truco que la hoja A5 para WhatsApp: el HTML entra
//  en un <svg><foreignObject> y de ahí a un canvas. Sin librerías.
//
//  OJO con el tipo de letra: adentro del SVG no se baja nada de internet, así
//  que una fuente de Google saldría cambiada por otra sin avisar. Por eso acá
//  se usan las del sistema, que es lo mismo que hace el comprobante A5.
'use strict';

const EST_DOC = 'estados';                  // config/estados
const EST_W = 1080, EST_H = 1920;           // la medida de una historia

// El 0 es domingo, como getDay().
const EST_DIAS = [
  { k: 'dom', lbl: 'Domingo' }, { k: 'lun', lbl: 'Lunes' }, { k: 'mar', lbl: 'Martes' },
  { k: 'mie', lbl: 'Miércoles' }, { k: 'jue', lbl: 'Jueves' }, { k: 'vie', lbl: 'Viernes' },
  { k: 'sab', lbl: 'Sábado' },
];

const EST_DEF = {
  activo: false,
  hora: 10,                                  // a qué hora sale el aviso (hora AR)
  titulo: '¡YA ESTAMOS ABIERTOS!',
  color: '#0040FF',
  horarios: {
    lun: '9 a 19:30', mar: '9 a 19:30', mie: '9 a 19:30',
    jue: '9 a 19:30', vie: '9 a 19:30', sab: '9 a 13:30', dom: '',
  },
  cerradoTxt: 'HOY CERRADO',
  urls: {},
};

let EST_CFG = { ...EST_DEF, horarios: { ...EST_DEF.horarios } };

function estCfg() { return EST_CFG; }
function estDiaDe(ms) { return EST_DIAS[new Date((ms || Date.now()) - 3 * 3600e3).getUTCDay()]; }

function _estNorm(d) {
  const c = { ...EST_DEF, ...(d || {}) };
  c.horarios = { ...EST_DEF.horarios, ...((d && d.horarios) || {}) };
  c.urls = { ...((d && d.urls) || {}) };
  return c;
}

async function estCargar() {
  try {
    const snap = await db.collection('config').doc(EST_DOC).get();
    if (typeof cupoContar === 'function') cupoContar('config/estados', 1);
    EST_CFG = _estNorm(snap.exists ? snap.data() : null);
  } catch (e) { console.error('[estados] cargar:', e); }
  return EST_CFG;
}

async function estGuardar(parche) {
  Object.assign(EST_CFG, parche || {});
  await db.collection('config').doc(EST_DOC).set(EST_CFG, { merge: true });
}

// ── El dibujo ─────────────────────────────────────────────
function _estEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Las letras se achican solas si el texto es largo: el cartel es de ancho fijo.
function _estTam(txt, base, ancho, em) {
  const n = String(txt || '').length || 1;
  return Math.max(28, Math.min(base, Math.floor(ancho / (em * n))));
}

// El HTML de una historia. `dia` es un elemento de EST_DIAS.
function estStoryHtml(dia, cfg) {
  const c = _estNorm(cfg || EST_CFG);
  const horario = String(c.horarios[dia.k] || '').trim();
  const abierto = !!horario;
  const logo = (typeof BIZ_IMAGE !== 'undefined' && BIZ_IMAGE) ? BIZ_IMAGE : '';
  const biz = (typeof BIZ_DATA !== 'undefined' && BIZ_DATA) ? BIZ_DATA : { dir: '', tel: '' };
  const titulo = abierto ? (c.titulo || EST_DEF.titulo) : (c.cerradoTxt || EST_DEF.cerradoTxt);
  // Arriba y abajo quedan ~260px libres: ahí WhatsApp e Instagram ponen sus
  // botones y taparían lo que se escriba.
  return `<div class="st${abierto ? '' : ' st--cerrado'}">
    <div class="st-top">HOY ES</div>
    ${logo ? `<img class="st-logo" src="${logo}" alt="">` : '<div class="st-logo st-logo--falta"></div>'}
    <div class="st-cartel">
      <div class="st-cartel-cara" style="font-size:${_estTam(dia.lbl, 128, 620, 0.58)}px">${_estEsc(dia.lbl.toUpperCase())}</div>
      <div class="st-cartel-palo"></div>
    </div>
    <div class="st-tit" style="font-size:${_estTam(titulo, 86, 940, 0.56)}px">${_estEsc(titulo)}</div>
    ${abierto ? `<div class="st-hora"><span class="st-hora-lbl">Horario de hoy</span><b>${_estEsc(horario)}</b></div>` : ''}
    <div class="st-pie">
      ${biz.dir ? `<div>${_estEsc(biz.dir)}</div>` : ''}
      ${biz.tel ? `<div>${_estEsc(biz.tel)}</div>` : ''}
    </div>
  </div>`;
}

function estStoryCss(color) {
  return `
*{box-sizing:border-box;margin:0;padding:0}
body{width:${EST_W}px;height:${EST_H}px;background:#fff}
.st{width:${EST_W}px;height:${EST_H}px;background:${color};color:#fff;
  font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;
  display:flex;flex-direction:column;align-items:center;
  padding:260px 70px;text-align:center;overflow:hidden}
.st-top{font-size:40px;font-weight:700;letter-spacing:.3em;opacity:.75}
/* El logo y el cartel se superponen a propósito: el cartel sale de abajo del
   logo, como si lo estuviera sosteniendo. */
.st-logo{width:420px;height:420px;object-fit:contain;margin-top:30px}
.st-logo--falta{border:6px dashed rgba(255,255,255,.4);border-radius:40px}
.st-cartel{position:relative;margin-top:-56px;transform:rotate(-5deg)}
.st-cartel-cara{background:#fff;color:#16161D;font-weight:800;line-height:1;
  border-radius:26px;padding:34px 46px;min-width:620px;
  box-shadow:0 18px 40px rgba(0,0,0,.28)}
.st-cartel-palo{position:absolute;left:50%;margin-left:-22px;top:92%;
  width:44px;height:150px;background:#C8965A;border-radius:0 0 10px 10px;
  box-shadow:0 10px 24px rgba(0,0,0,.2)}
.st-tit{font-weight:800;line-height:1.05;margin-top:170px;letter-spacing:-.01em}
.st-hora{margin-top:46px;background:rgba(255,255,255,.16);border-radius:30px;
  padding:26px 54px;display:flex;flex-direction:column;gap:8px}
.st-hora-lbl{font-size:34px;font-weight:600;opacity:.85}
.st-hora b{font-size:76px;font-weight:800;line-height:1;white-space:nowrap}
.st-pie{margin-top:auto;font-size:36px;font-weight:600;opacity:.9;line-height:1.5}
/* El día que no se abre no puede salir con los colores de fiesta. */
.st--cerrado{background:#3E3E52}
.st--cerrado .st-cartel-cara{color:#3E3E52}`;
}

function estDocumento(dia, cfg) {
  const c = _estNorm(cfg || EST_CFG);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<style>${estStoryCss(c.color || EST_DEF.color)}</style></head><body>
${estStoryHtml(dia, c)}
</body></html>`;
}

// HTML → PNG, con el mismo camino que la hoja A5 para WhatsApp: se escribe en
// un marco escondido, se serializa y entra en un <svg><foreignObject>.
async function _estPng(html) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = `position:fixed;left:-10000px;top:0;width:${EST_W}px;height:${EST_H}px;border:0;visibility:hidden`;
  document.body.appendChild(f);
  try {
    const w = f.contentWindow, d = w.document;
    d.open(); d.write(html); d.close();
    if (d.readyState !== 'complete') await new Promise(r => w.addEventListener('load', r, { once: true }));
    if (d.fonts && d.fonts.ready) await d.fonts.ready;
    const ser = new XMLSerializer();
    const estilos = [...d.querySelectorAll('style')].map(s => ser.serializeToString(s)).join('');
    const cuerpo = ser.serializeToString(d.querySelector('.st'));
    const xhtml = `<html xmlns="http://www.w3.org/1999/xhtml"><head>${estilos}</head>` +
      `<body style="margin:0;padding:0">${cuerpo}</body></html>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${EST_W}" height="${EST_H}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = EST_W; cv.height = EST_H;
    const x = cv.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, EST_W, EST_H);
    x.drawImage(img, 0, 0);
    return await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.92));
  } finally { f.remove(); }
}

// ── Generar y subir los siete ─────────────────────────────
async function estGenerarTodos(alAvanzar) {
  if (typeof firebase === 'undefined' || !firebase.storage) throw new Error('falta Storage');
  const st = firebase.storage();
  const urls = {};
  for (let i = 0; i < EST_DIAS.length; i++) {
    const dia = EST_DIAS[i];
    if (alAvanzar) alAvanzar(i, EST_DIAS.length, dia.lbl);
    const blob = await _estPng(estDocumento(dia, EST_CFG));
    if (!blob) throw new Error('no se pudo dibujar ' + dia.lbl);
    const ref = st.ref(`estados/${dia.k}.jpg`);
    // El nombre es fijo: cada vez pisa el anterior y no se junta basura.
    await ref.put(blob, { contentType: 'image/jpeg', cacheControl: 'public,max-age=60' });
    urls[dia.k] = await ref.getDownloadURL();
  }
  await estGuardar({ urls, generado: new Date().toISOString() });
  return urls;
}

// ══════════════════════════════════════════════════════════
//  EL CUADRO
// ══════════════════════════════════════════════════════════
let _estDiaPrev = null;     // qué día se está mirando

async function estAbrir() {
  const modal = document.getElementById('estados-modal');
  if (!modal) return;
  await estCargar();
  _estDiaPrev = _estDiaPrev || estDiaDe();
  estPintar();
  document.getElementById('estados-overlay')?.classList.remove('hidden');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function estCerrar() {
  document.getElementById('estados-overlay')?.classList.add('hidden');
  document.getElementById('estados-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

function estVerDia(k) {
  _estDiaPrev = EST_DIAS.find(d => d.k === k) || EST_DIAS[1];
  estPintar();
}

function estPintar() {
  const c = EST_CFG;
  const set = (id, v) => { const e = document.getElementById(id); if (e && e.value !== v) e.value = v; };
  set('est-titulo', c.titulo || '');
  set('est-hora', String(c.hora ?? 10));
  const act = document.getElementById('est-activo');
  if (act) act.checked = !!c.activo;

  const dias = document.getElementById('est-dias');
  if (dias) {
    dias.innerHTML = EST_DIAS.map(d => `<button type="button" class="est-dia${d.k === _estDiaPrev.k ? ' est-dia--on' : ''}"
      onclick="estVerDia('${d.k}')">${_estEsc(d.lbl.slice(0, 3))}</button>`).join('');
  }

  const hs = document.getElementById('est-horarios');
  if (hs) {
    hs.innerHTML = EST_DIAS.map(d => `<label class="est-hfila">
      <span>${_estEsc(d.lbl)}</span>
      <input type="text" class="fi" value="${_estEsc(c.horarios[d.k] || '')}"
        placeholder="vacío = cerrado" oninput="estHorario('${d.k}', this.value)">
    </label>`).join('');
  }

  const cols = document.getElementById('est-colores');
  if (cols && typeof CART_COLORES !== 'undefined') {
    cols.innerHTML = CART_COLORES.map(col =>
      `<button type="button" class="cart-color${col === c.color ? ' cart-color--on' : ''}"
        style="background:${col}" onclick="estColor('${col}')"></button>`).join('');
  }

  const nota = document.getElementById('est-nota');
  if (nota) {
    nota.textContent = c.generado
      ? 'Última vez generadas: ' + new Date(c.generado).toLocaleString('es-AR')
      : 'Todavía no se generaron. Tocá "Generar las 7".';
  }
  estPintarPreview();
}

function estHorario(k, v) {
  EST_CFG.horarios[k] = String(v || '').trim();
  estPintarPreview();
  _estGuardarDespues();
}

function estColor(col) {
  EST_CFG.color = col;
  estPintar();
  _estGuardarDespues();
}

function estCampo(campo, v) {
  EST_CFG[campo] = campo === 'hora' ? (parseInt(v, 10) || 0) : String(v || '');
  estPintarPreview();
  _estGuardarDespues();
}

function estActivo(v) {
  EST_CFG.activo = !!v;
  _estGuardarDespues();
}

// Se guarda al ratito de dejar de tocar: tipear el horario no puede ser una
// escritura por letra.
let _estTimer = null;
function _estGuardarDespues() {
  clearTimeout(_estTimer);
  _estTimer = setTimeout(() => {
    estGuardar({}).catch(e => console.error('[estados] guardar:', e));
  }, 900);
}

// La vista previa es el MISMO documento que se convierte en imagen.
function estPintarPreview() {
  const marco = document.getElementById('est-preview');
  const wrap = document.getElementById('est-preview-wrap');
  if (!marco || !wrap || !_estDiaPrev) return;
  const esc = Math.min(1, (wrap.clientWidth || 300) / EST_W);
  marco.style.transform = `scale(${esc})`;
  marco.style.height = EST_H + 'px';
  wrap.style.height = Math.round(EST_H * esc) + 'px';
  marco.srcdoc = estDocumento(_estDiaPrev, EST_CFG);
}

async function estGenerar(btn) {
  const txt = btn ? btn.textContent : '';
  try {
    if (btn) { btn.disabled = true; }
    await estGuardar({});
    await estGenerarTodos((i, n, lbl) => { if (btn) btn.textContent = `Generando ${lbl} (${i + 1}/${n})…`; });
    estPintar();
    toast('✅ Las 7 quedaron listas', 'success');
  } catch (e) {
    console.error('[estados] generar:', e);
    toast('No se pudieron generar: ' + (e.message || e), 'error');
  } finally { if (btn) { btn.disabled = false; btn.textContent = txt; } }
}

// Bajar la del día que estás mirando, para subirla a mano ahora mismo.
async function estDescargar() {
  try {
    const blob = await _estPng(estDocumento(_estDiaPrev, EST_CFG));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `estado-${_estDiaPrev.k}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { toast('No se pudo bajar: ' + (e.message || e), 'error'); }
}
