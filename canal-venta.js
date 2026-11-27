// ══════════════════════════════════════════════════════════════
//  🧑‍💼 QUIÉN VENDIÓ y 🌐 DÓNDE (local / online) — y 💸 COMISIONES
// ══════════════════════════════════════════════════════════════
// Alan (27/11): "contraté una chica, va a tener sus ventas online, que van a
// tener una comisión; que use el stock que tenemos pero que se marque
// diferente si es venta online o en el local (esa no tiene comisión)". Y
// después: "estaría bueno que también se registre los que venden acá en el
// local, hacer todo uno solo. Detectá qué usuario es el de la compu
// principal y ahí, en cada venta, que se puedan seleccionar los nombres".
//
// En cada venta (el cobro de la caja, la venta de equipo de la caja y
// "Vender" desde el Stock) aparece:
//   ¿Quién vendió?   [Alan] [Nacho] [Sofi] [Otra persona…]
//   ¿Dónde?          [🏪 En el local] [🌐 Online]
// · En la cuenta COMPARTIDA (la de la compu principal) hay que tocar un
//   nombre: sin eso no se guarda. Esa cuenta se marca una vez desde el
//   informe ("esta cuenta es la compartida"); la compu en "modo mostrador"
//   también cuenta como compartida.
// · En una cuenta personal ya aparece elegido el nombre de esa persona.
// · Se guarda en la venta: vendidoPor, canal y, si fue online, vendedorOnline.
//   El stock es el mismo de siempre.
//
// La comisión NO se guarda en la venta: la calcula el informe (solo el dueño)
// con el % de config/comisiones, sobre las ventas online. Así nadie puede
// tocarse la comisión (config solo lo lee y escribe el dueño) y si el % cambia
// no hay que corregir ventas. Los nombres y las cuentas compartidas viven en
// ajustes_venta/vendedoras, que leen todas las cuentas.
'use strict';

function _cvnEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function _cvUsuario() {
  try { return (typeof tpUsuario === 'function') ? tpUsuario() : null; } catch (e) { return null; }
}
function _cvUid() {
  try { const u = (typeof currentUser === 'function') ? currentUser() : null; return (u && u.uid) || ''; } catch (e) { return ''; }
}
function _cvYo() { const u = _cvUsuario(); return (u && u.nombre) || ''; }

function _cvEstilos() {
  if (typeof document === 'undefined' || document.getElementById('cv-css')) return;
  const s = document.createElement('style');
  s.id = 'cv-css';
  s.textContent = `
  .cv-bloque{display:flex;flex-direction:column;gap:6px}
  .cv-opciones{display:flex;gap:6px}
  .cv-op{flex:1;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:10px;padding:10px 8px;font:inherit;font-weight:700;cursor:pointer}
  .cv-op.on{border-color:var(--accent);background:var(--accent);color:#fff}
  .cv-chips{display:flex;flex-wrap:wrap;gap:6px}
  .cv-chip{border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:999px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}
  .cv-chip.on{border-color:var(--accent);background:var(--accent);color:#fff}
  .cv-bloque input.hidden{display:none}
  .cv-aviso{font-size:12px;color:var(--text2)}
  `;
  document.head.appendChild(s);
}

// ── Los nombres y las cuentas compartidas ─────────────────────
const _CV_LS = 'cvAjustesVenta';
let _cvAj = null;     // { nombres: [], compartidas: [uid] }
function cvAjustes() {
  if (_cvAj) return _cvAj;
  try { const a = JSON.parse(localStorage.getItem(_CV_LS) || 'null'); if (a && Array.isArray(a.nombres)) return a; } catch (e) {}
  return { nombres: [], compartidas: [] };
}
function cvVendedoras() { return cvAjustes().nombres || []; }
// Una lectura por apertura de la pantalla (y queda guardada en el aparato)
async function cvCargarVendedoras() {
  if (_cvAj || typeof db === 'undefined' || !db) return cvAjustes();
  try {
    const d = await db.collection('ajustes_venta').doc('vendedoras').get();
    const x = d.exists ? d.data() : {};
    _cvAj = { nombres: (Array.isArray(x.nombres) ? x.nombres : []).filter(Boolean),
              compartidas: (Array.isArray(x.compartidas) ? x.compartidas : []).filter(Boolean) };
    try { localStorage.setItem(_CV_LS, JSON.stringify(_cvAj)); } catch (e) {}
  } catch (e) { /* sin señal: lo último que se supo */ }
  return cvAjustes();
}
function cvNombresDeTexto(t) {
  const vistos = new Set();
  return String(t || '').split(/[,\n]+/).map(x => x.trim().replace(/\s+/g, ' ').slice(0, 30)).filter(x => {
    const k = x.toLowerCase(); if (!x || vistos.has(k)) return false; vistos.add(k); return true;
  }).slice(0, 20);
}

// ¿La está usando una cuenta de todos? (la de la compu principal, o la compu
// en modo mostrador). Ahí el usuario de la app no dice quién vendió.
function cvCuentaCompartida() {
  if (typeof tpMostrador === 'function' && tpMostrador()) return true;
  const uid = _cvUid();
  return !!uid && (cvAjustes().compartidas || []).includes(uid);
}

// El nombre que va solo: en una cuenta personal, el de esa persona
function _cvNombreSolo() {
  if (cvCuentaCompartida()) return '';
  const yo = _cvYo();
  const enLista = cvVendedoras().find(n => n.toLowerCase() === yo.toLowerCase());
  return enLista || yo;
}

// ── El bloque en el formulario ────────────────────────────────
// `p`: prefijo de los ids; `antesDe`: el elemento delante del que va.
function cvMontar(p, antesDe) {
  if (typeof document === 'undefined') return null;
  _cvEstilos();
  let b = document.getElementById(p + '-canal');
  if (!b) {
    const ref = typeof antesDe === 'string' ? document.getElementById(antesDe) : antesDe;
    if (!ref || !ref.parentNode) return null;
    b = document.createElement('div');
    b.id = p + '-canal';
    b.className = 'fg cv-bloque';
    b.innerHTML = `<label class="fl">¿Quién vendió?</label>
      <div class="cv-chips" id="${p}-cv-chips"></div>
      <input id="${p}-cv-nombre" class="fi hidden" type="text" maxlength="40" autocomplete="off" placeholder="Nombre de quien vendió">
      <label class="fl" style="margin-top:4px">¿Dónde se vendió?</label>
      <div class="cv-opciones">
        <button type="button" class="cv-op on" data-cv="local" onclick="cvElegir('${p}','local')">🏪 En el local</button>
        <button type="button" class="cv-op" data-cv="online" onclick="cvElegir('${p}','online')">🌐 Online</button>
      </div>`;
    ref.parentNode.insertBefore(b, ref);
  }
  // Cada venta arranca de cero: en el local y con el nombre que va solo
  const inp = document.getElementById(p + '-cv-nombre');
  if (inp) { inp.value = _cvNombreSolo(); inp.dataset.otro = ''; }
  cvElegir(p, 'local');
  _cvPintarChips(p);            // con los nombres que ya conoce este aparato…
  cvCargarVendedoras().then(() => {   // …y otra vez cuando llegan los de la base
    const i2 = document.getElementById(p + '-cv-nombre');
    if (i2 && !i2.value && !i2.dataset.otro) i2.value = _cvNombreSolo();
    _cvPintarChips(p);
  });
  return b;
}

function _cvPintarChips(p) {
  const box = typeof document !== 'undefined' && document.getElementById(p + '-cv-chips');
  if (!box) return;
  const lista = cvVendedoras();
  const inp = document.getElementById(p + '-cv-nombre');
  const actual = inp ? inp.value : '';
  const esOtro = !!actual && !lista.some(n => n.toLowerCase() === actual.toLowerCase());
  box.innerHTML = lista.map(n => `<button type="button" class="cv-chip${actual.toLowerCase() === n.toLowerCase() ? ' on' : ''}" onclick="cvQuien('${p}', this.textContent)">${_cvnEsc(n)}</button>`).join('')
    + `<button type="button" class="cv-chip${esOtro || (inp && inp.dataset.otro === '1') ? ' on' : ''}" onclick="cvQuien('${p}', '')">${lista.length ? 'Otra persona…' : 'Escribir el nombre…'}</button>`;
  if (inp) inp.classList.toggle('hidden', !esOtro && inp.dataset.otro !== '1');
}

// Tocar un nombre ('' = escribir otro)
function cvQuien(p, nombre) {
  const inp = typeof document !== 'undefined' && document.getElementById(p + '-cv-nombre');
  if (!inp) return;
  inp.value = nombre || '';
  inp.dataset.otro = nombre ? '' : '1';
  _cvPintarChips(p);
  if (!nombre) { inp.classList.remove('hidden'); try { inp.focus(); } catch (e) {} }
}

function cvElegir(p, canal) {
  const b = typeof document !== 'undefined' && document.getElementById(p + '-canal');
  if (!b) return;
  b.dataset.canal = canal === 'online' ? 'online' : 'local';
  b.querySelectorAll('.cv-op').forEach(o => o.classList.toggle('on', o.dataset.cv === b.dataset.canal));
}

function cvMostrar(p, si) {
  const b = typeof document !== 'undefined' && document.getElementById(p + '-canal');
  if (b) b.style.display = si ? '' : 'none';
}

// { canal, vendidoPor } de lo que quedó elegido
function cvLeer(p) {
  const b = typeof document !== 'undefined' && document.getElementById(p + '-canal');
  if (!b || b.style.display === 'none') return { canal: 'local', vendidoPor: '', visible: false };
  const n = document.getElementById(p + '-cv-nombre');
  return { canal: b.dataset.canal === 'online' ? 'online' : 'local',
           vendidoPor: String((n && n.value) || '').trim().slice(0, 40), visible: true };
}

// Antes de guardar: sin decir quién vendió no se guarda (en la cuenta
// compartida no hay otra forma de saberlo; en una personal ya viene puesto)
function cvFalta(p) {
  const c = cvLeer(p);
  if (!c.visible || c.vendidoPor) return false;
  if (typeof toast === 'function') toast('🧑‍💼 Tocá el nombre de quién hizo la venta', 'error');
  const b = document.getElementById(p + '-canal');
  try { b && b.scrollIntoView && b.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
  return true;
}

// Lo anota en la venta. Las de antes no tienen estos campos: cuentan como
// ventas en el local sin vendedor anotado.
function cvAplicar(data, p) {
  const c = cvLeer(p);
  if (!c.visible) return data;
  data.canal = c.canal;
  if (c.vendidoPor) data.vendidoPor = c.vendidoPor;
  if (c.canal === 'online') data.vendedorOnline = c.vendidoPor || 'Sin nombre';
  return data;
}

// ── 💸 Informe: ventas por persona y comisiones (dueño) ───────
const CV_DEF = { pct: 5, base: 'venta' };     // se cambian en el mismo informe
let _cvCfg = Object.assign({}, CV_DEF);
let _cvMovs = [];

function cvCfgNormal(c) {
  const x = Object.assign({}, CV_DEF);
  if (c && Number(c.pct) >= 0 && Number(c.pct) <= 100) x.pct = Number(c.pct);
  if (c && (c.base === 'venta' || c.base === 'ganancia')) x.base = c.base;
  return x;
}

// Sobre qué se calcula: lo que se cobró, o la ganancia (si tiene costo)
function cvBase(m, cfg) {
  if (cfg.base === 'ganancia') return typeof m.gananciaARS === 'number' ? Math.max(0, m.gananciaARS) : null;
  return Math.max(0, Number(m.monto) || 0);
}

// Movimientos → por persona: en el local, online y la comisión (de las online)
function cvResumen(movs, mes, cfg) {
  const c = cvCfgNormal(cfg);
  const porQuien = {};
  (movs || []).forEach(m => {
    if (!m || m.tipo !== 'ingreso') return;
    if (mes && String(m.fecha || '').slice(0, 7) !== mes) return;
    const online = m.canal === 'online';
    const nombre = String(m.vendidoPor || (online ? m.vendedorOnline : '') || '').trim();
    if (!nombre) return;                       // ventas sin vendedor anotado (las de antes)
    const k = nombre.toLowerCase();
    const r = porQuien[k] = porQuien[k] || { nombre, local: { n: 0, total: 0 }, online: { n: 0, total: 0 }, comision: 0, sinCosto: 0, lista: [] };
    const monto = Number(m.monto) || 0;
    if (online) {
      r.online.n++; r.online.total += monto;
      const base = cvBase(m, c);
      if (base === null) r.sinCosto++; else r.comision += Math.round(base * c.pct / 100);
    } else { r.local.n++; r.local.total += monto; }
    r.lista.push(m);
  });
  return Object.values(porQuien).sort((a, b) => (b.online.total + b.local.total) - (a.online.total + a.local.total));
}

function _cvMesRango(mes) {
  const [y, m] = mes.split('-').map(Number);
  const fin = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${mes}-01`, `${mes}-${String(fin).padStart(2, '0')}`];
}

async function cvAbrirComisiones() {
  if (typeof closeSheet === 'function') closeSheet();
  _cvEstilos();
  document.getElementById('cv-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'cv-modal';
  m.className = 'modal-overlay';
  const mes = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7);
  m.innerHTML = `<div class="modal-card form-card" style="max-width:660px">
    <div class="modal-header"><h3>🧑‍💼 Ventas por vendedor y comisiones</h3><button class="modal-close" onclick="document.getElementById('cv-modal').remove()">✕</button></div>
    <div class="modal-body" style="gap:10px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input id="cv-mes" class="fi" type="month" value="${mes}" style="max-width:170px" onchange="cvLeerMes()">
        <span style="font-size:13px;color:var(--text2)">Comisión online</span>
        <input id="cv-pct" class="fi" type="number" min="0" max="100" step="0.5" style="width:80px" onchange="cvGuardarCfg()">
        <span style="font-size:13px;color:var(--text2)">% sobre</span>
        <select id="cv-base" class="fi" style="max-width:170px" onchange="cvGuardarCfg()">
          <option value="venta">lo que se cobró</option>
          <option value="ganancia">la ganancia</option>
        </select>
      </div>
      <p class="cv-aviso" style="margin:0">La comisión sale solo de las ventas marcadas <b>🌐 Online</b>. Las del local se cuentan para saber cuánto vendió cada uno, sin comisión.</p>
      <details style="border:1px solid var(--border);border-radius:10px;padding:8px 10px">
        <summary style="cursor:pointer;font-weight:700;font-size:14px">⚙️ Vendedores y cuenta compartida</summary>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
          <span class="cv-aviso">Los nombres que aparecen como botones en cada venta, separados por coma:</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="cv-nombres" class="fi" placeholder="Ej: Alan, Nacho, Sofi" style="flex:1;min-width:180px">
            <button type="button" class="btn-secondary" onclick="cvGuardarNombres()">Guardar</button>
          </div>
          <div id="cv-compartida" class="cv-aviso"></div>
        </div>
      </details>
      <div id="cv-cuerpo"><p style="color:var(--text2)">Cargando…</p></div>
    </div></div>`;
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
  try {
    const d = await db.collection('config').doc('comisiones').get();
    _cvCfg = cvCfgNormal(d.exists ? d.data() : null);
  } catch (e) { _cvCfg = cvCfgNormal(null); }
  document.getElementById('cv-pct').value = _cvCfg.pct;
  document.getElementById('cv-base').value = _cvCfg.base;
  _cvAj = null;
  await cvCargarVendedoras();
  document.getElementById('cv-nombres').value = cvVendedoras().join(', ');
  _cvPintarCompartida();
  await cvLeerMes();
}

// La cuenta con la que se está usando la app ahora: ¿es la compartida?
function _cvPintarCompartida() {
  const box = document.getElementById('cv-compartida');
  if (!box) return;
  const uid = _cvUid();
  const comp = (cvAjustes().compartidas || []).includes(uid);
  const u = _cvUsuario();
  box.innerHTML = uid
    ? `Esta cuenta (<b>${_cvnEsc((u && u.nombre) || 'sin nombre')}</b>) ${comp ? 'es la <b>compartida</b>: en cada venta hay que tocar quién vendió.' : 'es personal: las ventas salen a su nombre solas.'}
       <button type="button" class="btn-secondary" style="margin-left:6px;min-height:0;padding:6px 10px" onclick="cvMarcarCompartida(${comp ? 'false' : 'true'})">${comp ? 'No es compartida' : 'Es la cuenta compartida de la compu principal'}</button>
       <br><span>Entrá a este informe desde la compu principal (con su cuenta) para marcarla.</span>`
    : 'Sin sesión.';
}

async function cvMarcarCompartida(si) {
  const uid = _cvUid();
  if (!uid) return;
  const lista = new Set(cvAjustes().compartidas || []);
  if (si) lista.add(uid); else lista.delete(uid);
  try {
    await db.collection('ajustes_venta').doc('vendedoras').set({ compartidas: [...lista] }, { merge: true });
    _cvAj = Object.assign({}, cvAjustes(), { compartidas: [...lista] });
    try { localStorage.setItem(_CV_LS, JSON.stringify(_cvAj)); } catch (e) {}
    if (typeof toast === 'function') toast(si ? 'Listo: en esta cuenta cada venta pide quién vendió' : 'Listo: esta cuenta ya no es la compartida', 'success');
  } catch (e) { if (typeof toast === 'function') toast('No se pudo guardar', 'error'); }
  _cvPintarCompartida();
}

async function cvGuardarNombres() {
  const nombres = cvNombresDeTexto(document.getElementById('cv-nombres')?.value);
  try {
    await db.collection('ajustes_venta').doc('vendedoras').set({ nombres }, { merge: true });
    _cvAj = Object.assign({}, cvAjustes(), { nombres });
    try { localStorage.setItem(_CV_LS, JSON.stringify(_cvAj)); } catch (e) {}
    document.getElementById('cv-nombres').value = nombres.join(', ');
    if (typeof toast === 'function') toast(nombres.length ? `Listo: ${nombres.join(', ')}` : 'Lista vacía', 'success');
  } catch (e) { if (typeof toast === 'function') toast('No se pudo guardar la lista', 'error'); }
}

async function cvGuardarCfg() {
  const pct = Number(document.getElementById('cv-pct')?.value);
  const base = document.getElementById('cv-base')?.value;
  _cvCfg = cvCfgNormal({ pct, base });
  try { await db.collection('config').doc('comisiones').set(_cvCfg, { merge: true }); if (typeof toast === 'function') toast('Comisión guardada', 'success'); }
  catch (e) { if (typeof toast === 'function') toast('No se pudo guardar (¿modo dueño?)', 'error'); }
  cvPintar();
}

// Las ventas del mes (solo ese mes: no se lee la caja entera)
async function cvLeerMes() {
  const mes = document.getElementById('cv-mes')?.value;
  const box = document.getElementById('cv-cuerpo');
  if (!mes || !box) return;
  box.innerHTML = '<p style="color:var(--text2)">Cargando…</p>';
  try {
    const [ini, fin] = _cvMesRango(mes);
    const snap = await db.collection('caja_movimientos').where('fecha', '>=', ini).where('fecha', '<=', fin).get();
    if (typeof cupoContar === 'function') cupoContar('caja (ventas por vendedor)', snap.size);
    _cvMovs = snap.docs.map(x => ({ id: x.id, ...x.data() }));
  } catch (e) {
    console.error('ventas por vendedor:', e);
    box.innerHTML = '<p style="color:#dc2626">No se pudieron leer las ventas (¿sin señal?)</p>';
    return;
  }
  cvPintar();
}

function cvPintar() {
  const box = document.getElementById('cv-cuerpo');
  if (!box) return;
  const mes = document.getElementById('cv-mes')?.value || '';
  const res = cvResumen(_cvMovs, mes, _cvCfg);
  const $ = n => '$' + Math.round(n).toLocaleString('es-AR');
  if (!res.length) { box.innerHTML = '<p style="color:var(--text2)">No hay ventas con vendedor anotado en ese mes.</p>'; return; }
  box.innerHTML = res.map(r => `<div style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline">
      <b style="font-size:16px">${_cvnEsc(r.nombre)}</b>
      ${r.online.n ? `<b style="color:var(--accent)">comisión ${$(r.comision)}</b>` : ''}
    </div>
    <div style="font-size:13px;color:var(--text2);margin-top:4px">
      🏪 En el local: ${r.local.n} venta${r.local.n === 1 ? '' : 's'} · ${$(r.local.total)}
      &nbsp;·&nbsp; 🌐 Online: ${r.online.n} venta${r.online.n === 1 ? '' : 's'} · ${$(r.online.total)}
    </div>
    ${r.sinCosto ? `<div style="font-size:12px;color:#b45309;margin-top:4px">⚠️ ${r.sinCosto} online sin costo cargado: no entran en la comisión sobre la ganancia</div>` : ''}
    <details style="margin-top:6px"><summary style="cursor:pointer;font-size:13px;color:var(--text2)">Ver las ventas</summary>
      <div style="font-size:13px;margin-top:6px;display:flex;flex-direction:column;gap:4px">
        ${r.lista.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).map(x => `<div style="display:flex;justify-content:space-between;gap:8px">
          <span>${_cvnEsc(String(x.fecha || '').slice(8, 10) + '/' + String(x.fecha || '').slice(5, 7))} · ${x.canal === 'online' ? '🌐' : '🏪'} ${_cvnEsc(x.descripcion || x.categoria || '')}</span><b>${$(Number(x.monto) || 0)}</b></div>`).join('')}
      </div></details>
  </div>`).join('');
}
