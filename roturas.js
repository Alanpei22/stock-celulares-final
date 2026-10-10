// ══════════════════════════════════════════════════════════
//  ROTURAS — lo que se pierde antes de venderse
// ══════════════════════════════════════════════════════════
// Los vidrios templados y el hidrogel a veces vienen rotos de fábrica y a
// veces se rompen colocándolos. Las pantallas, más todavía. Esas unidades
// salen del stock igual que si se vendieran, pero no entró plata: si no se
// descuentan, el inventario dice que tenés veinte y hay diecisiete.
//
// Los dos motivos se separan a propósito. "Vino roto" es un reclamo al
// proveedor; "se rompió colocándolo" es costo del trabajo. Mezclados, el
// número no sirve para decidir nada.
//
// NO se anota como gasto en la caja: esa plata salió cuando compraste la caja
// de vidrios o el repuesto. Cargarlo de nuevo sería contar el mismo peso dos
// veces. Es una baja de inventario y se mira en su propio informe.
//
// Este archivo lo cargan las DOS páginas: accesorios (caja.html) y repuestos
// (index.html) hacen exactamente lo mismo, con otra colección y otro campo.
const ROT_MOTIVOS = [
  { k: 'proveedor',  ico: '📦', label: 'Vino roto',             sub: 'De fábrica o del proveedor — sirve para reclamarle' },
  { k: 'colocacion', ico: '🧰', label: 'Se rompió colocándolo', sub: 'Se arruinó al pegarlo o quedó mal' },
  { k: 'otro',       ico: '❓', label: 'Otro',                   sub: 'Se perdió, se lo llevaron, no se sabe' },
];
const rotMotivo = k => ROT_MOTIVOS.find(m => m.k === k) || { ico: '❓', label: k || '—' };

// El modo dueño se llama distinto en cada página.
function rotEsDueno() {
  if (typeof _cajaIsOwner !== 'undefined') return _cajaIsOwner;
  if (typeof OWNER_MODE !== 'undefined') return OWNER_MODE;
  return false;
}

let _rotCfg = null;          // lo que se está dando de baja
let _rotMotivoElegido = 'proveedor';

// cfg: { coleccion, campoStock, origen, item:{id,nombre,codigo,categoria,stock}, costo, alTerminar }
function tpRotura(cfg) {
  if (!cfg || !cfg.item || !cfg.item.id) return;
  _rotCfg = cfg;
  _rotMotivoElegido = 'proveedor';
  const it = cfg.item;
  const costo = Number(cfg.costo) || 0;
  const verCosto = rotEsDueno() && costo > 0;

  document.getElementById('tp-rotura-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'tp-rotura-modal';
  m.className = 'modal-overlay';
  m.innerHTML = `
  <div class="modal-card form-card">
    <div class="modal-header">
      <h3>📉 Dar de baja por rotura</h3>
      <button class="modal-close" onclick="cerrarRotura()">✕</button>
    </div>
    <div class="modal-body">
      <div class="rot-art">
        <b>${esc(it.nombre || '(sin nombre)')}</b>
        <span>${esc(it.codigo || 'sin código')} · hay ${Number(it.stock) || 0} en stock</span>
      </div>
      <div class="fg">
        <label class="fl">¿Cuántos?</label>
        <input id="rot-cant" class="fi" type="number" min="1" value="1" inputmode="numeric">
      </div>
      <div class="fg">
        <label class="fl">¿Por qué?</label>
        <div id="rot-motivos">
          ${ROT_MOTIVOS.map(mo => `
            <button type="button" class="rot-motivo${mo.k === 'proveedor' ? ' rot-motivo--on' : ''}"
                    data-k="${mo.k}" onclick="_rotElegir('${mo.k}')">
              <span class="rot-motivo-ico">${mo.ico}</span>
              <span class="rot-motivo-txt"><b>${mo.label}</b><span>${mo.sub}</span></span>
            </button>`).join('')}
        </div>
      </div>
      <div class="fg">
        <label class="fl">Nota <span class="fl-hint">— opcional</span></label>
        <input id="rot-nota" class="fi" type="text" placeholder="Ej: caja del 3/10, vinieron 4 rotos">
      </div>
      ${verCosto ? `<div class="rot-costo owner-only">Costo: $${costo.toLocaleString('es-AR')} cada uno</div>` : ''}
    </div>
    <div class="modal-footer" style="display:flex;gap:8px">
      <button class="btn-secondary" style="flex:1" onclick="cerrarRotura()">Cancelar</button>
      <button class="btn-danger" style="flex:2" id="rot-ok" onclick="guardarRotura()">📉 Dar de baja</button>
    </div>
  </div>`;
  m.addEventListener('click', e => { if (e.target === m) cerrarRotura(); });
  document.body.appendChild(m);
  setTimeout(() => document.getElementById('rot-cant')?.focus(), 100);
}

function cerrarRotura() { document.getElementById('tp-rotura-modal')?.remove(); }

function _rotElegir(k) {
  _rotMotivoElegido = k;
  document.querySelectorAll('#rot-motivos .rot-motivo').forEach(b =>
    b.classList.toggle('rot-motivo--on', b.dataset.k === k));
}

function _rotHoy() {
  return (typeof _todayAR === 'function') ? _todayAR()
       : new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
}

async function guardarRotura() {
  const cfg = _rotCfg;
  if (!cfg) return;
  const it = cfg.item;
  const n = parseInt(document.getElementById('rot-cant')?.value, 10) || 0;
  if (n < 1) { toast('¿Cuántos se rompieron?', 'error'); return; }
  const hay = Number(it.stock) || 0;
  if (n > hay && !confirm(`Figuran ${hay} en stock y estás dando de baja ${n}.\n\n¿Seguro? El stock va a quedar en 0.`)) return;

  const btn = document.getElementById('rot-ok');
  if (btn) btn.disabled = true;
  const costo = Number(cfg.costo) || 0;
  try {
    // El registro va PRIMERO. Si fallara después el descuento, el número del
    // stock lo ves en pantalla y lo corregís; un motivo que no se guardó no
    // te enterás nunca.
    await db.collection('mermas').add({
      fecha: _rotHoy(),
      createdAt: new Date().toISOString(),
      origen: cfg.origen || 'accesorio',
      productoId: it.id, nombre: it.nombre || '', codigo: it.codigo || '',
      categoria: it.categoria || '',
      cantidad: n, motivo: _rotMotivoElegido,
      nota: (document.getElementById('rot-nota')?.value || '').trim(),
      costoUnit: costo, costoTotal: costo * n,
      ...(typeof tpFirma === 'function' ? tpFirma() : {}),
    });
    await db.collection(cfg.coleccion).doc(it.id).update({
      [cfg.campoStock]: firebase.firestore.FieldValue.increment(-Math.min(n, hay)),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    cerrarRotura();
    if (typeof cfg.alTerminar === 'function') cfg.alTerminar();
    toast(`📉 ${n} ${n === 1 ? 'unidad dada' : 'unidades dadas'} de baja · ${rotMotivo(_rotMotivoElegido).label}`, 'success');
  } catch (e) {
    console.error('[roturas] guardar:', e);
    toast('No se pudo dar de baja', 'error');
    if (btn) btn.disabled = false;
  }
}

// ── El informe ────────────────────────────────────────────
// Del mes corriente: es la ventana con la que se reclama a un proveedor y se
// decide si conviene cambiarlo. CUPO: una lectura acotada por fecha, y solo
// cuando se abre el informe.
async function tpAbrirRoturas() {
  const mes = _rotHoy().slice(0, 7);
  toast('Buscando las roturas del mes…', 'info');
  let lista = [];
  try {
    const snap = await db.collection('mermas').where('fecha', '>=', mes + '-01').get();
    lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof cupoContar === 'function') cupoContar('mermas', snap.size);
  } catch (e) {
    console.error('[roturas] leer:', e);
    toast('No se pudieron leer las roturas', 'error');
    return;
  }
  lista.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const verPlata = rotEsDueno();
  const porMotivo = ROT_MOTIVOS.map(mo => {
    const del = lista.filter(x => x.motivo === mo.k);
    return { ...mo, unidades: del.reduce((s, x) => s + (Number(x.cantidad) || 0), 0),
             plata: del.reduce((s, x) => s + (Number(x.costoTotal) || 0), 0) };
  }).filter(mo => mo.unidades > 0);
  const totalU = porMotivo.reduce((s, m) => s + m.unidades, 0);
  const totalP = porMotivo.reduce((s, m) => s + m.plata, 0);

  document.getElementById('tp-roturas-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'tp-roturas-modal';
  m.className = 'modal-overlay';
  m.innerHTML = `
  <div class="modal-card form-card">
    <div class="modal-header">
      <h3>📉 Roturas del mes <small style="font-weight:500;color:var(--t3)">${mes}</small></h3>
      <button class="modal-close" onclick="cerrarRoturas()">✕</button>
    </div>
    <div class="modal-body" style="max-height:65vh;overflow:auto">
      ${!lista.length ? '<p class="rot-vacio">Ninguna rotura cargada este mes.</p>' : `
        <div class="rot-resumen">
          ${porMotivo.map(mo => `<div class="rot-res-fila">
            <span>${mo.ico} ${esc(mo.label)}</span>
            <b>${mo.unidades} u.${verPlata && mo.plata > 0 ? ' · $' + Math.round(mo.plata).toLocaleString('es-AR') : ''}</b>
          </div>`).join('')}
          <div class="rot-res-fila rot-res-total">
            <span>Total</span>
            <b>${totalU} u.${verPlata && totalP > 0 ? ' · $' + Math.round(totalP).toLocaleString('es-AR') : ''}</b>
          </div>
        </div>
        ${lista.map(x => `<div class="rot-item">
          <div class="rot-item-top">
            <b>${esc(x.nombre || '(sin nombre)')}</b>
            <span class="rot-item-n">${Number(x.cantidad) || 0} u.</span>
          </div>
          <div class="rot-item-sub">${rotMotivo(x.motivo).ico} ${esc(rotMotivo(x.motivo).label)} · ${esc(x.fecha || '')}${x.origen === 'repuesto' ? ' · repuesto' : ''}${x.cargadoPor ? ' · ' + esc(x.cargadoPor) : ''}</div>
          ${x.nota ? `<div class="rot-item-nota">${esc(x.nota)}</div>` : ''}
        </div>`).join('')}
      `}
    </div>
  </div>`;
  m.addEventListener('click', e => { if (e.target === m) cerrarRoturas(); });
  document.body.appendChild(m);
}

function cerrarRoturas() { document.getElementById('tp-roturas-modal')?.remove(); }
