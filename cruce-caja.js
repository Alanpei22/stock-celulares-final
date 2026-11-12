// ══════════════════════════════════════════════════════════════
//  🔀 CRUCE CAJA ↔ REPARACIONES
// ══════════════════════════════════════════════════════════════
//  Alan (12/11): "¿hay forma de cruzar las ventas de caja con las
//  reparaciones? Capaz se cobró algo de una reparación y se entregó, pero no
//  se marcó entregada". Dos cruces, los dos con datos que ya están cargados
//  (no lee nada de más):
//   1) Reparaciones COBRADAS que siguen "reparando" o "listo": o el cliente
//      pagó y la dejó en el local, o se la llevó y nadie la marcó.
//   2) Cobros de HOY con rubro "Reparación" que no están vinculados a
//      ninguna orden (se cargaron sueltos en la caja): esa orden sigue
//      figurando sin cobrar. Si la descripción trae el N°, se dice cuál es.
'use strict';

const CRUCE_DIAS_SIGUE = 7;     // "sigue en el local": no se vuelve a preguntar por una semana

function _cruceDias(iso, ahora) {
  const t = Date.parse(iso || '');
  return isFinite(t) ? Math.floor((ahora - t) / 864e5) : null;
}
function _cruceCobrada(r) {
  const monto = Number(r.monto) || 0;
  return !!r.cobrado || (monto > 0 && (Number(r.sena) || 0) >= monto);
}

// 1) Cobradas que no figuran entregadas. `soloAviso`: las que ameritan
// avisar (cobradas hace 1 día o más, y no marcadas "sigue en el local" hace poco).
function cruceCobradasSinEntregar(repairs, ahora, soloAviso) {
  const t = ahora || Date.now();
  return (repairs || [])
    .filter(r => r && (r.estado === 'reparando' || r.estado === 'listo') && _cruceCobrada(r))
    .map(r => ({ r, dias: _cruceDias(r.fechaCobro || r.fechaListo || r.fechaIngreso, t),
                 sigue: r.sigueEnLocal ? _cruceDias(r.sigueEnLocal, t) : null }))
    .filter(x => !soloAviso || ((x.dias === null || x.dias >= 1) && !(x.sigue !== null && x.sigue < CRUCE_DIAS_SIGUE)))
    .sort((a, b) => (b.dias ?? 9999) - (a.dias ?? 9999));
}

// 2) Cobros con rubro "Reparación" sin orden vinculada. Si la descripción
// trae un N° de orden ("N°8412", "#8412", "orden 8412"), se busca esa orden.
function cruceCobrosSueltos(movs, repairs) {
  return (movs || [])
    .filter(m => m && m.tipo === 'ingreso' && m.categoria === 'Reparación' && !m.repairId && Number(m.monto) > 0)
    .map(m => {
      const n = (String(m.descripcion || '').match(/(?:n[°ºo]\.?|#|orden)\s*(\d{2,7})/i) || [])[1];
      const r = n ? (repairs || []).find(x => Number(x.nOrden) === Number(n)) : null;
      return { m, r: r || null };
    });
}

// Lo que se le escribe a la orden al confirmar "ya se entregó". Con la fecha
// del COBRO (cuando de verdad se la llevó), no la de hoy: si no, el resumen
// de hoy diría que hoy se entregaron equipos de la semana pasada.
function cruceEntregaPatch(r, ahoraIso) {
  const fecha = r.fechaCobro || ahoraIso;
  const hist = Array.isArray(r.estadoHistorial) ? r.estadoHistorial : [];
  return { estado: 'entregado', fechaEntrega: fecha, entregaPorCruce: ahoraIso.slice(0, 10),
           estadoHistorial: [...hist, { estado: 'entregado', fecha, cruce: true }] };
}

// ── El cuadro ─────────────────────────────────────────────
const _crEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _crPlata = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

function _crEstilos() {
  if (document.getElementById('cr-estilos')) return;
  const st = document.createElement('style');
  st.id = 'cr-estilos';
  st.textContent = `
.cr-ov{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000}
.cr-mod{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,96vw);max-height:90vh;overflow:auto;
  background:var(--card,#fff);color:var(--text,#111);border-radius:16px;padding:16px;z-index:2001;box-shadow:0 20px 50px rgba(0,0,0,.3)}
.cr-hd{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:18px;margin-bottom:4px}
.cr-x{background:none;border:0;font-size:20px;cursor:pointer;color:inherit}
.cr-sub{font-size:13px;opacity:.75;margin:0 0 10px}
.cr-tit{font-weight:800;font-size:14px;margin:14px 0 6px}
.cr-item{border:1px solid rgba(128,128,128,.22);border-radius:14px;padding:12px;margin-bottom:10px}
.cr-nom{font-weight:800;font-size:15px;cursor:pointer}
.cr-dato{font-size:13px;opacity:.8;margin-top:3px}
.cr-acc{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.cr-btn{flex:1 1 auto;padding:10px;border-radius:10px;border:1.5px solid rgba(128,128,128,.3);background:none;color:inherit;font-weight:700;font-size:13px;cursor:pointer}
.cr-btn--si{background:#22c55e;border-color:#22c55e;color:#fff}
.cr-vacio{text-align:center;padding:26px 10px;opacity:.75;font-size:14px}`;
  document.head.appendChild(st);
}

function cruceCerrar() {
  document.getElementById('cr-ov')?.remove();
  document.getElementById('cr-mod')?.remove();
}

function cruceAbrir() {
  if (typeof closeSheet === 'function') closeSheet();
  _crEstilos();
  cruceCerrar();
  const ov = document.createElement('div');
  ov.className = 'cr-ov'; ov.id = 'cr-ov'; ov.onclick = cruceCerrar;
  const m = document.createElement('div');
  m.className = 'cr-mod'; m.id = 'cr-mod';
  m.innerHTML = '<div id="cr-cuerpo"></div>';
  document.body.appendChild(ov);
  document.body.appendChild(m);
  crucePintar();
}

function crucePintar() {
  const cuerpo = document.getElementById('cr-cuerpo');
  if (!cuerpo) return;
  const reps = (typeof REPAIRS !== 'undefined' && Array.isArray(REPAIRS)) ? REPAIRS : [];
  const movs = (typeof _hoyCaja !== 'undefined' && _hoyCaja && Array.isArray(_hoyCaja.movs)) ? _hoyCaja.movs : [];
  const A = cruceCobradasSinEntregar(reps, Date.now());
  const B = cruceCobrosSueltos(movs, reps);
  const eq = r => `#${r.nOrden || '?'} ${r.marca || ''} ${r.modelo || ''}`.replace(/\s+/g, ' ').trim();
  const itemsA = A.map(({ r, dias, sigue }) => {
    const id = _crEsc(r.id);
    const cuando = dias === null ? '' : dias === 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`;
    return `<div class="cr-item">
      <div class="cr-nom" onclick="cruceVer('${id}')">${_crEsc(eq(r))}</div>
      <div class="cr-dato">${_crEsc([r.nombre, r.arreglo].filter(Boolean).join(' · '))}</div>
      <div class="cr-dato">💵 Cobrada ${cuando}${r.metodoCobro ? ' · ' + _crEsc(r.metodoCobro) : ''}${Number(r.monto) > 0 ? ' · ' + _crPlata(r.monto) : ''} — figura <b>${r.estado === 'listo' ? 'Lista' : 'Reparando'}</b>${sigue !== null ? ` · marcaste "sigue en el local" hace ${sigue} día${sigue === 1 ? '' : 's'}` : ''}</div>
      <div class="cr-acc">
        <button type="button" class="cr-btn cr-btn--si" onclick="cruceEntregada('${id}')">📦 Ya se entregó</button>
        <button type="button" class="cr-btn" onclick="cruceSigue('${id}')">🏠 Sigue en el local</button>
      </div></div>`;
  }).join('');
  const itemsB = B.map(({ m, r }) => `<div class="cr-item">
      <div class="cr-nom">${_crEsc(m.descripcion || 'Reparación')} · ${_crPlata(m.monto)}</div>
      <div class="cr-dato">${_crEsc(m.metodoPago || '')} · cobrado en la caja sin elegir la orden</div>
      ${r ? `<div class="cr-dato">Parece la <b>${_crEsc(eq(r))}</b>${r.nombre ? ' de ' + _crEsc(r.nombre) : ''}: figura <b>${_crEsc(r.estado)}</b>${r.cobrado ? '' : ' y <b>sin cobrar</b>'}.</div>
        <div class="cr-acc"><button type="button" class="cr-btn" onclick="cruceVer('${_crEsc(r.id)}')">Abrir la ficha</button></div>`
          : `<div class="cr-dato">No dice el N° de orden: buscala en Reparaciones y marcala entregada.</div>`}
    </div>`).join('');
  cuerpo.innerHTML = `<div class="cr-hd"><span>🔀 Caja y reparaciones</span><button type="button" class="cr-x" onclick="cruceCerrar()">✕</button></div>
    <p class="cr-sub">Lo que la caja dice que se cobró, contra el estado de cada reparación.</p>
    <div class="cr-tit">💵 Cobradas que no figuran entregadas (${A.length})</div>
    ${cruceParaTodas(A).length > 1 ? `<button type="button" class="cr-btn cr-btn--si" style="width:100%;margin-bottom:10px;padding:13px;font-size:15px" onclick="cruceEntregarTodas(this)">📦 Marcar las ${cruceParaTodas(A).length} como entregadas</button>` : ''}
    ${itemsA || '<div class="cr-vacio">Ninguna: todo lo cobrado está entregado 👍</div>'}
    <div class="cr-tit">🧾 Cobros de hoy de "Reparación" sin orden (${B.length})</div>
    ${itemsB || '<div class="cr-vacio">Ninguno.</div>'}`;
}

function cruceVer(id) {
  cruceCerrar();
  if (typeof switchSection === 'function') switchSection('repairs');
  setTimeout(() => (typeof openRepairDetail === 'function') && openRepairDetail(id), 300);
}

// "Ya se entregó": queda entregada con la fecha del cobro. Sin avisos al
// cliente ni a Telegram: es poner al día algo que pasó antes.
async function cruceEntregada(id) {
  if (typeof tpFrenar === 'function' && tpFrenar('reparaciones', 'marcar reparaciones entregadas')) return;
  const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === id);
  if (!r) return;
  const patch = cruceEntregaPatch(r, new Date().toISOString());
  if (typeof _tpSyncFase === 'function') { try { Object.assign(patch, _tpSyncFase(r, 'entregado', patch.fechaEntrega)); } catch (e) { console.warn('[cruce] fase:', e); } }
  try {
    await db.collection('repairs').doc(id).update(patch);
    Object.assign(r, patch);
    if (typeof _repPatchLocal === 'function') _repPatchLocal(id, patch);
    if (typeof upsertSeguimientoPublico === 'function') upsertSeguimientoPublico(r);
    toast(`📦 #${r.nOrden} quedó entregada`, 'success');
    crucePintar();
  } catch (e) {
    console.error('[cruce] entregar:', e);
    toast('No se pudo marcar — revisá la conexión', 'error');
  }
}

// Alan (12/11): "si están todas cobradas, poner entregadas de una".
// Van todas las de la lista MENOS las que marcaste "sigue en el local" esta
// semana: esas dijiste que no se entregaron.
function cruceParaTodas(lista) {
  return (lista || []).filter(x => !(x.sigue !== null && x.sigue < CRUCE_DIAS_SIGUE));
}

async function cruceEntregarTodas(btn) {
  if (typeof tpFrenar === 'function' && tpFrenar('reparaciones', 'marcar reparaciones entregadas')) return;
  const reps = (typeof REPAIRS !== 'undefined' && Array.isArray(REPAIRS)) ? REPAIRS : [];
  const todas = cruceCobradasSinEntregar(reps, Date.now());
  const van = cruceParaTodas(todas);
  if (!van.length) return;
  const quedan = todas.length - van.length;
  if (!confirm(`¿Marcar ${van.length} reparaciones como ENTREGADAS?\n\n` +
    `Son las que están cobradas y siguen como "Lista" o "Reparando". Quedan con la fecha en que se cobraron. No se le avisa nada al cliente.` +
    (quedan ? `\n\nNo se tocan ${quedan} que marcaste "sigue en el local".` : '') +
    `\n\nSi alguna sigue en el local, después la reabrís desde su ficha.`)) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Marcando…'; }
  const ahora = new Date().toISOString();
  try {
    const cambios = van.map(({ r }) => {
      const patch = cruceEntregaPatch(r, ahora);
      patch.cruceMasivo = ahora.slice(0, 10);     // por si hay que encontrarlas después
      if (typeof _tpSyncFase === 'function') { try { Object.assign(patch, _tpSyncFase(r, 'entregado', patch.fechaEntrega)); } catch (e) { /* sin fase */ } }
      return { r, patch };
    });
    // Firestore acepta hasta 500 escrituras por tanda
    for (let i = 0; i < cambios.length; i += 400) {
      const batch = db.batch();
      cambios.slice(i, i + 400).forEach(c => batch.update(db.collection('repairs').doc(c.r.id), c.patch));
      await batch.commit();
    }
    cambios.forEach(c => {
      Object.assign(c.r, c.patch);
      if (typeof _repPatchLocal === 'function') _repPatchLocal(c.r.id, c.patch);
      if (typeof upsertSeguimientoPublico === 'function') upsertSeguimientoPublico(c.r);
    });
    toast(`📦 ${cambios.length} reparaciones quedaron entregadas`, 'success');
  } catch (e) {
    console.error('[cruce] entregar todas:', e);
    toast('No se pudieron marcar — revisá la conexión', 'error');
  }
  crucePintar();
}

async function cruceSigue(id) {
  const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === id);
  if (!r) return;
  const patch = { sigueEnLocal: new Date().toISOString() };
  try {
    await db.collection('repairs').doc(id).update(patch);
    Object.assign(r, patch);
    if (typeof _repPatchLocal === 'function') _repPatchLocal(id, patch);
    toast(`🏠 Anotado: la #${r.nOrden} sigue en el local`, 'success');
    crucePintar();
  } catch (e) {
    console.error('[cruce] sigue:', e);
    toast('No se pudo anotar — revisá la conexión', 'error');
  }
}
