// ══════════════════════════════════════════════════════════════
//  🌐 CANAL DE VENTA (local / online) y 💸 COMISIONES ONLINE
// ══════════════════════════════════════════════════════════════
// Alan (27/11): "contraté una chica, va a tener sus ventas online, que van a
// tener una comisión. Que use el stock que tenemos, pero que se marque
// diferente si es venta online a través de ella o venta en el local, que la
// haga ella, pero eso no tiene comisión".
//
// Cada venta lleva ahora dónde se hizo: 🏪 En el local (como siempre) o
// 🌐 Online, y en ese caso quién la vendió (de entrada, el usuario que la
// carga). El stock es el mismo de siempre. Se marca en los tres lugares donde
// se vende: el cobro de la caja, la venta de equipo de la caja y "Vender"
// desde el Stock.
//
// La comisión NO se guarda en la venta: la calcula el informe (solo el dueño)
// con el % de config/comisiones. Así un empleado no puede tocarse la comisión
// (config solo lo lee y escribe el dueño, ver firestore.rules) y si el % cambia
// no hay que corregir ventas una por una.
'use strict';

function _cvnEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function _cvYo() {
  try { const u = (typeof tpUsuario === 'function') ? tpUsuario() : null; if (u && u.nombre) return u.nombre; } catch (e) {}
  try { return localStorage.getItem('cajaVendedor') || ''; } catch (e) { return ''; }
}

function _cvEstilos() {
  if (typeof document === 'undefined' || document.getElementById('cv-css')) return;
  const s = document.createElement('style');
  s.id = 'cv-css';
  s.textContent = `
  .cv-bloque{display:flex;flex-direction:column;gap:6px}
  .cv-opciones{display:flex;gap:6px}
  .cv-op{flex:1;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:10px;padding:10px 8px;font:inherit;font-weight:700;cursor:pointer}
  .cv-op.on{border-color:var(--accent);background:var(--accent);color:#fff}
  .cv-quien{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--text2)}
  .cv-quien input{flex:1;min-width:0}
  .cv-quien.hidden{display:none}
  `;
  document.head.appendChild(s);
}

// Pone el selector en un formulario (una sola vez) y lo deja en "local".
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
    b.innerHTML = `<label class="fl">¿Dónde se vendió?</label>
      <div class="cv-opciones">
        <button type="button" class="cv-op on" data-cv="local" onclick="cvElegir('${p}','local')">🏪 En el local</button>
        <button type="button" class="cv-op" data-cv="online" onclick="cvElegir('${p}','online')">🌐 Online</button>
      </div>
      <div class="cv-quien hidden" id="${p}-cv-quien">Vendió:
        <input id="${p}-cv-nombre" class="fi" type="text" maxlength="40" autocomplete="off" placeholder="Quién hizo la venta online">
      </div>`;
    ref.parentNode.insertBefore(b, ref);
  }
  cvElegir(p, 'local');
  return b;
}

function cvElegir(p, canal) {
  const b = typeof document !== 'undefined' && document.getElementById(p + '-canal');
  if (!b) return;
  b.dataset.canal = canal === 'online' ? 'online' : 'local';
  b.querySelectorAll('.cv-op').forEach(o => o.classList.toggle('on', o.dataset.cv === b.dataset.canal));
  const q = document.getElementById(p + '-cv-quien');
  if (q) q.classList.toggle('hidden', b.dataset.canal !== 'online');
  const n = document.getElementById(p + '-cv-nombre');
  if (n && b.dataset.canal === 'online' && !n.value) n.value = _cvYo();
  if (n && b.dataset.canal === 'local') n.value = '';
}

function cvMostrar(p, si) {
  const b = typeof document !== 'undefined' && document.getElementById(p + '-canal');
  if (b) b.style.display = si ? '' : 'none';
}

// { canal, vendedorOnline } de lo que quedó elegido
function cvLeer(p) {
  const b = typeof document !== 'undefined' && document.getElementById(p + '-canal');
  if (!b || b.style.display === 'none') return { canal: 'local', vendedorOnline: '' };
  const canal = b.dataset.canal === 'online' ? 'online' : 'local';
  const n = document.getElementById(p + '-cv-nombre');
  const quien = canal === 'online' ? (String((n && n.value) || '').trim() || _cvYo()) : '';
  return { canal, vendedorOnline: quien.slice(0, 40) };
}

// Lo anota en la venta. Las de antes no tienen el campo: cuentan como local.
function cvAplicar(data, p) {
  const c = cvLeer(p);
  data.canal = c.canal;
  if (c.canal === 'online') data.vendedorOnline = c.vendedorOnline || 'Sin nombre';
  return data;
}

// ── 💸 Informe de comisiones (dueño) ──────────────────────────
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

// Movimientos → por vendedora: ventas, total, comisión
function cvResumen(movs, mes, cfg) {
  const c = cvCfgNormal(cfg);
  const porQuien = {};
  (movs || []).forEach(m => {
    if (!m || m.tipo !== 'ingreso' || m.canal !== 'online') return;
    if (mes && String(m.fecha || '').slice(0, 7) !== mes) return;
    const nombre = String(m.vendedorOnline || 'Sin nombre').trim();
    const k = nombre.toLowerCase();
    const r = porQuien[k] = porQuien[k] || { nombre, ventas: 0, total: 0, base: 0, comision: 0, sinCosto: 0, lista: [] };
    const base = cvBase(m, c);
    r.ventas++;
    r.total += Number(m.monto) || 0;
    if (base === null) r.sinCosto++;
    else { r.base += base; r.comision += Math.round(base * c.pct / 100); }
    r.lista.push(m);
  });
  return Object.values(porQuien).sort((a, b) => b.total - a.total);
}

async function cvAbrirComisiones() {
  if (typeof closeSheet === 'function') closeSheet();
  _cvEstilos();
  document.getElementById('cv-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'cv-modal';
  m.className = 'modal-overlay';
  const mes = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7);
  m.innerHTML = `<div class="modal-card form-card" style="max-width:640px">
    <div class="modal-header"><h3>💸 Comisiones de ventas online</h3><button class="modal-close" onclick="document.getElementById('cv-modal').remove()">✕</button></div>
    <div class="modal-body" style="gap:10px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input id="cv-mes" class="fi" type="month" value="${mes}" style="max-width:170px" onchange="cvPintar()">
        <span style="font-size:13px;color:var(--text2)">Comisión</span>
        <input id="cv-pct" class="fi" type="number" min="0" max="100" step="0.5" style="width:80px" onchange="cvGuardarCfg()">
        <span style="font-size:13px;color:var(--text2)">% sobre</span>
        <select id="cv-base" class="fi" style="max-width:170px" onchange="cvGuardarCfg()">
          <option value="venta">lo que se cobró</option>
          <option value="ganancia">la ganancia</option>
        </select>
      </div>
      <p style="margin:0;font-size:12px;color:var(--text2)">Solo cuentan las ventas marcadas <b>🌐 Online</b>. Las que hace en el local no llevan comisión.</p>
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
  try {
    // Solo las online (pocas): no se lee la caja entera
    const snap = await db.collection('caja_movimientos').where('canal', '==', 'online').get();
    _cvMovs = snap.docs.map(x => ({ id: x.id, ...x.data() }));
  } catch (e) {
    console.error('comisiones:', e);
    document.getElementById('cv-cuerpo').innerHTML = '<p style="color:#dc2626">No se pudieron leer las ventas (¿sin señal?)</p>';
    return;
  }
  cvPintar();
}

async function cvGuardarCfg() {
  const pct = Number(document.getElementById('cv-pct')?.value);
  const base = document.getElementById('cv-base')?.value;
  _cvCfg = cvCfgNormal({ pct, base });
  try { await db.collection('config').doc('comisiones').set(_cvCfg, { merge: true }); if (typeof toast === 'function') toast('Comisión guardada', 'success'); }
  catch (e) { if (typeof toast === 'function') toast('No se pudo guardar (¿modo dueño?)', 'error'); }
  cvPintar();
}

function cvPintar() {
  const box = document.getElementById('cv-cuerpo');
  if (!box) return;
  const mes = document.getElementById('cv-mes')?.value || '';
  const res = cvResumen(_cvMovs, mes, _cvCfg);
  const $ = n => '$' + Math.round(n).toLocaleString('es-AR');
  if (!res.length) { box.innerHTML = '<p style="color:var(--text2)">No hay ventas online en ese mes.</p>'; return; }
  box.innerHTML = res.map(r => `<div style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline">
      <b style="font-size:16px">${_cvnEsc(r.nombre)}</b>
      <span>${r.ventas} venta${r.ventas === 1 ? '' : 's'} · ${$(r.total)} · <b style="color:var(--accent)">comisión ${$(r.comision)}</b></span>
    </div>
    ${r.sinCosto ? `<div style="font-size:12px;color:#b45309;margin-top:4px">⚠️ ${r.sinCosto} sin costo cargado: no entran en la comisión sobre la ganancia</div>` : ''}
    <details style="margin-top:6px"><summary style="cursor:pointer;font-size:13px;color:var(--text2)">Ver las ventas</summary>
      <div style="font-size:13px;margin-top:6px;display:flex;flex-direction:column;gap:4px">
        ${r.lista.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).map(x => `<div style="display:flex;justify-content:space-between;gap:8px">
          <span>${_cvnEsc(String(x.fecha || '').slice(8, 10) + '/' + String(x.fecha || '').slice(5, 7))} · ${_cvnEsc(x.descripcion || x.categoria || '')}</span><b>${$(Number(x.monto) || 0)}</b></div>`).join('')}
      </div></details>
  </div>`).join('');
}
