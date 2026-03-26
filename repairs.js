// ══════════════════════════════════════════
//  REPARACIONES
// ══════════════════════════════════════════

const REPAIR_STATES = {
  reparando: { label: 'Reparando', cls: 'bg-reparando' },
  listo:     { label: 'Listo ✓',  cls: 'bg-listo'     },
  entregado: { label: 'Entregado', cls: 'bg-entregado' },
  cancelado: { label: 'Cancelado', cls: 'bg-cancelado' },
};

let REPAIRS = [];
let STAFF   = [];
let editingRepairId    = null;
let pendingGarantiaRef = null;
let repRenderTimer;

// ── Firebase ──────────────────────────────
function listenRepairs() {
  db.collection('repairs').onSnapshot(snap => {
    REPAIRS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    REPAIRS.sort((a, b) => (b.fechaIngreso || '').localeCompare(a.fechaIngreso || ''));
    renderRepairs();
  }, err => {
    console.error('Repairs:', err);
    toast('Error cargando reparaciones', 'error');
  });
}

// ── Init ──────────────────────────────────
function initRepairs() {
  document.getElementById('rep-add-btn').addEventListener('click', () => openRepairForm());
  document.getElementById('rep-stats-btn').addEventListener('click', openRepairStats);

  document.getElementById('rep-search').addEventListener('input', () => {
    clearTimeout(repRenderTimer);
    repRenderTimer = setTimeout(renderRepairs, 60);
  });
  document.getElementById('rep-f-estado').addEventListener('change', renderRepairs);
  document.getElementById('rep-f-marca').addEventListener('change', renderRepairs);
  document.getElementById('rep-f-fecha').addEventListener('change', renderRepairs);
  document.getElementById('rep-sort').addEventListener('change', renderRepairs);

  document.getElementById('rep-form-close').addEventListener('click', closeRepairForm);
  document.getElementById('rep-form-cancel').addEventListener('click', closeRepairForm);
  document.getElementById('rep-form-save').addEventListener('click', saveRepair);
  document.getElementById('rep-form-modal').addEventListener('click', e => {
    if (e.target.id === 'rep-form-modal') closeRepairForm();
  });
  document.getElementById('rep-fi-arreglo').addEventListener('change', function () {
    document.getElementById('rep-fi-arreglo-custom').style.display =
      this.value === 'Otro' ? '' : 'none';
  });

  document.getElementById('rep-detail-close').addEventListener('click', closeRepairDetail);
  document.getElementById('rep-detail-modal').addEventListener('click', e => {
    if (e.target.id === 'rep-detail-modal') closeRepairDetail();
  });

  document.getElementById('garantia-close').addEventListener('click', closeGarantiaModal);
  document.getElementById('garantia-cancel').addEventListener('click', closeGarantiaModal);
  document.getElementById('garantia-save').addEventListener('click', saveGarantia);
  document.getElementById('garantia-modal').addEventListener('click', e => {
    if (e.target.id === 'garantia-modal') closeGarantiaModal();
  });

  document.getElementById('history-close').addEventListener('click', closeHistoryModal);
  document.getElementById('history-modal').addEventListener('click', e => {
    if (e.target.id === 'history-modal') closeHistoryModal();
  });

  document.getElementById('rep-stats-close').addEventListener('click', closeRepairStats);
  document.getElementById('rep-stats-modal').addEventListener('click', e => {
    if (e.target.id === 'rep-stats-modal') closeRepairStats();
  });

  document.getElementById('rep-ticket-close').addEventListener('click', closeTicket);
  document.getElementById('rep-ticket-modal').addEventListener('click', e => {
    if (e.target.id === 'rep-ticket-modal') closeTicket();
  });

  document.getElementById('staff-modal-close').addEventListener('click', closeStaffModal);
  document.getElementById('staff-modal').addEventListener('click', e => {
    if (e.target.id === 'staff-modal') closeStaffModal();
  });
  document.getElementById('staff-new-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') addStaffMember();
  });

  document.getElementById('rep-import-btn').addEventListener('click', () => {
    document.getElementById('rep-import-file').click();
  });
  document.getElementById('rep-import-file').addEventListener('change', importRepairHistory);

  loadStaff();
  listenRepairs();
}

// ── Render ────────────────────────────────
function renderRepairs() {
  const q       = (document.getElementById('rep-search').value || '').trim().toLowerCase();
  const fEstado = document.getElementById('rep-f-estado').value;
  const fMarca  = document.getElementById('rep-f-marca').value;
  const fFecha  = document.getElementById('rep-f-fecha').value;
  const fSort   = document.getElementById('rep-sort').value;

  // Actualizar filtro de marcas
  const marcas = [...new Set(REPAIRS.map(r => r.marca).filter(Boolean))].sort();
  const selM = document.getElementById('rep-f-marca');
  const prev = selM.value;
  while (selM.options.length > 1) selM.remove(1);
  marcas.forEach(m => {
    const o = document.createElement('option');
    o.value = m; o.textContent = m; selM.appendChild(o);
  });
  selM.value = prev;

  // Date filter refs
  const now      = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgo  = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  let filtered = REPAIRS.filter(r => {
    if (fEstado && r.estado !== fEstado) return false;
    if (fMarca  && r.marca  !== fMarca)  return false;
    if (q) {
      const hay = [r.nOrden, r.marca, r.modelo, r.arreglo, r.nombre, r.tlf, r.dni]
        .map(x => String(x || '')).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (fFecha === 'hoy') {
      if (!r.fechaIngreso || !r.fechaIngreso.startsWith(todayStr)) return false;
    } else if (fFecha === 'semana') {
      if (!r.fechaIngreso || new Date(r.fechaIngreso) < weekAgo) return false;
    } else if (fFecha === 'mes') {
      if (!r.fechaIngreso || !r.fechaIngreso.startsWith(monthStr)) return false;
    }
    return true;
  });

  // Sort
  const STATE_ORDER = { reparando: 0, listo: 1, entregado: 2, cancelado: 3 };
  if (fSort === 'antiguo') {
    filtered.sort((a, b) => (a.fechaIngreso || '').localeCompare(b.fechaIngreso || ''));
  } else if (fSort === 'estado') {
    filtered.sort((a, b) => (STATE_ORDER[a.estado] ?? 9) - (STATE_ORDER[b.estado] ?? 9));
  } else if (fSort === 'monto') {
    filtered.sort((a, b) => (b.monto || 0) - (a.monto || 0));
  } else if (fSort === 'reciente') {
    filtered.sort((a, b) => (b.fechaIngreso || '').localeCompare(a.fechaIngreso || ''));
  } else {
    // nOrden (default)
    filtered.sort((a, b) => (b.nOrden || 0) - (a.nOrden || 0));
  }

  // Stats bar: demorados = reparando > 3 días
  const demorados = REPAIRS.filter(r => {
    if (r.estado !== 'reparando' || !r.fechaIngreso) return false;
    return (now - new Date(r.fechaIngreso)) / 86400000 > 3;
  }).length;

  document.getElementById('rs-reparando').textContent = REPAIRS.filter(r => r.estado === 'reparando').length;
  document.getElementById('rs-listo').textContent     = REPAIRS.filter(r => r.estado === 'listo').length;
  document.getElementById('rs-demorados').textContent = demorados;

  updateNavBadge();

  const listEl  = document.getElementById('rep-list');
  const emptyEl = document.getElementById('rep-empty');

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  listEl.innerHTML = filtered.map(r => {
    const st   = REPAIR_STATES[r.estado] || { label: r.estado || '—', cls: '' };
    const fecha = r.fechaIngreso
      ? new Date(r.fechaIngreso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
      : '';
    const monto = r.monto ? '$ ' + r.monto.toLocaleString('es-AR') : '—';

    // Demorado?
    const isDemorado = r.estado === 'reparando' && r.fechaIngreso &&
      (now - new Date(r.fechaIngreso)) / 86400000 > 3;

    // Card class
    let cardClass = `rep-card--${r.estado}`;
    if (isDemorado) cardClass += ' rep-card--demorado';

    // Time ago
    const taStr  = r.fechaIngreso ? timeAgo(r.fechaIngreso) : '';
    const taCls  = isDemorado ? 'card-time-ago card-time-demorado' : 'card-time-ago';

    // Saldo pendiente
    const saldoHTML = (r.monto && r.sena && r.monto > r.sena && r.estado !== 'entregado')
      ? `<span class="card-saldo">Saldo: $${(r.monto - r.sena).toLocaleString('es-AR')}</span>`
      : '';

    // Quick status button (reparando→listo, listo→entregado)
    const nextSt = { reparando: 'listo', listo: 'entregado' }[r.estado];
    const quickBtn = nextSt
      ? `<div class="card-quick-actions" onclick="event.stopPropagation()">
           <button class="btn-quick-status" onclick="quickStatusChange(event,'${r.id}','${nextSt}')">→ ${REPAIR_STATES[nextSt].label}</button>
         </div>`
      : '';

    return `
      <div class="card rep-card ${cardClass}" onclick="openRepairDetail('${r.id}')">
        <div class="card-top">
          <div class="card-info">
            <span class="card-marca">${esc(r.marca || '')} · N°${r.nOrden || '?'}</span>
            <span class="card-modelo">${esc(r.modelo || '')}</span>
            <span class="card-specs">${esc(r.arreglo || '')}</span>
          </div>
          <div class="card-right">
            <span class="badge ${st.cls}">${st.label}</span>
            ${r.esGarantia ? '<span class="badge bg-warn" style="margin-top:3px">Garantía</span>' : ''}
            ${isDemorado ? '<span class="badge" style="margin-top:3px;background:#fee2e2;color:#dc2626;font-size:.6rem">⚠️ Demorado</span>' : ''}
            ${r.tlf ? `<button class="card-wa-btn" title="WhatsApp" onclick="event.stopPropagation();repairWhatsApp('${r.id}')">🟢</button>` : ''}
          </div>
        </div>
        <div class="card-bottom">
          <span class="card-price">${monto}</span>
          <div class="card-meta">
            ${r.nombre ? `<span class="card-imei">${esc(r.nombre)}</span>` : ''}
            ${saldoHTML}
            ${fecha ? `<span class="card-date">${fecha}</span>` : ''}
            ${taStr ? `<span class="${taCls}">${taStr}</span>` : ''}
          </div>
        </div>
        ${quickBtn}
      </div>`;
  }).join('');
}

// ── Form ──────────────────────────────────
function openRepairForm(id) {
  editingRepairId = id || null;
  const COMMON_ARREGLOS = [
    'Módulo / Pantalla','Ficha de carga','Batería','Módulo + Templado',
    'Sistemas / Software','Conector','Revisión','Placa','Cámara','Altavoz / Micrófono'
  ];

  if (id) {
    const r = REPAIRS.find(x => x.id === id);
    if (!r) return;
    document.getElementById('rep-form-title').textContent = '✏️ Editar Reparación';
    document.getElementById('rep-orden-row').style.display    = '';
    document.getElementById('rep-orden-spacer').style.display = '';
    document.getElementById('rep-orden-label').textContent    = 'N° Orden';
    const ordenInput = document.getElementById('rep-fi-orden');
    ordenInput.value    = r.nOrden || '';
    ordenInput.readOnly = true;
    ordenInput.style.background = '#f1f5f9';
    ordenInput.style.color      = '#64748b';
    document.getElementById('rep-fi-marca').value  = r.marca  || '';
    document.getElementById('rep-fi-modelo').value = r.modelo || '';

    const isCustom = r.arreglo && !COMMON_ARREGLOS.includes(r.arreglo);
    document.getElementById('rep-fi-arreglo').value = isCustom ? 'Otro' : (r.arreglo || '');
    document.getElementById('rep-fi-arreglo-custom').style.display = isCustom ? '' : 'none';
    document.getElementById('rep-fi-arreglo-custom').value = isCustom ? r.arreglo : '';

    document.getElementById('rep-fi-condicion').value  = r.condicion    || '';
    document.getElementById('rep-fi-codigo').value     = r.codigo       || '';
    document.getElementById('rep-fi-monto').value      = r.monto        || '';
    document.getElementById('rep-fi-sena').value       = r.sena         || '';
    document.getElementById('rep-fi-fecha-est').value  = r.fechaEstimada|| '';
    document.getElementById('rep-fi-nombre').value     = r.nombre       || '';
    document.getElementById('rep-fi-tlf').value        = r.tlf          || '';
    document.getElementById('rep-fi-dni').value        = r.dni          || '';
    document.getElementById('rep-fi-obs').value         = r.observaciones || '';
    document.getElementById('rep-fi-costo').value       = r.costo         || '';
    document.getElementById('rep-fi-presupuesto').value = r.presupuesto   || '';
    refreshStaffSelect(r.tecnico || '');

    const accs = r.accesorios || [];
    document.getElementById('acc-cargador').checked    = accs.includes('cargador');
    document.getElementById('acc-funda').checked       = accs.includes('funda');
    document.getElementById('acc-caja').checked        = accs.includes('caja');
    document.getElementById('acc-auriculares').checked = accs.includes('auriculares');
  } else {
    document.getElementById('rep-form-title').textContent = '🔧 Nueva Reparación';
    document.getElementById('rep-orden-row').style.display    = '';
    document.getElementById('rep-orden-spacer').style.display = '';
    document.getElementById('rep-orden-label').textContent    = 'N° Orden (editable)';
    const ordenInput = document.getElementById('rep-fi-orden');
    ordenInput.value    = '';
    ordenInput.readOnly = false;
    ordenInput.style.background = '';
    ordenInput.style.color      = '';
    // Fetch suggested nOrden asynchronously
    db.collection('config').doc('repairsMeta').get().then(snap => {
      const suggested = snap.exists ? (snap.data().nextOrderNum || 7100) : 7100;
      if (!ordenInput.value) ordenInput.value = suggested;
    }).catch(() => {});

    ['rep-fi-marca','rep-fi-modelo','rep-fi-condicion','rep-fi-codigo',
     'rep-fi-monto','rep-fi-sena','rep-fi-costo','rep-fi-presupuesto','rep-fi-fecha-est',
     'rep-fi-nombre','rep-fi-tlf','rep-fi-dni','rep-fi-obs'].forEach(fid => {
      const el = document.getElementById(fid);
      if (el) el.value = '';
    });
    document.getElementById('rep-fi-arreglo').value = '';
    document.getElementById('rep-fi-arreglo-custom').style.display = 'none';
    document.getElementById('rep-fi-arreglo-custom').value = '';
    ['acc-cargador','acc-funda','acc-caja','acc-auriculares'].forEach(fid => {
      document.getElementById(fid).checked = false;
    });
    // Resetear toggle password
    const passInput = document.getElementById('rep-fi-codigo');
    passInput.type = 'password';
    refreshStaffSelect('');
  }

  document.getElementById('rep-form-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('rep-fi-marca').focus(), 300);
}

function closeRepairForm() {
  document.getElementById('rep-form-modal').classList.add('hidden');
  document.body.style.overflow = '';
  editingRepairId = null;
}

async function saveRepair() {
  const marca    = document.getElementById('rep-fi-marca').value.trim();
  const modelo   = document.getElementById('rep-fi-modelo').value.trim();
  const arregloSel    = document.getElementById('rep-fi-arreglo').value;
  const arregloCustom = document.getElementById('rep-fi-arreglo-custom').value.trim();
  const arreglo  = arregloSel === 'Otro' ? arregloCustom : arregloSel;
  const condicion= document.getElementById('rep-fi-condicion').value.trim();
  const codigo   = document.getElementById('rep-fi-codigo').value.trim();
  const monto       = parseInt(document.getElementById('rep-fi-monto').value)       || 0;
  const sena        = parseInt(document.getElementById('rep-fi-sena').value)        || 0;
  const costo       = parseInt(document.getElementById('rep-fi-costo').value)       || 0;
  const presupuesto = parseInt(document.getElementById('rep-fi-presupuesto').value) || 0;
  const tecnico     = document.getElementById('rep-fi-tecnico').value.trim();
  const fechaEstimada = document.getElementById('rep-fi-fecha-est').value;
  const nombre   = document.getElementById('rep-fi-nombre').value.trim();
  const tlf      = document.getElementById('rep-fi-tlf').value.trim();
  const dni      = document.getElementById('rep-fi-dni').value.trim();
  const obs      = document.getElementById('rep-fi-obs').value.trim();

  const accesorios = [];
  if (document.getElementById('acc-cargador').checked)    accesorios.push('cargador');
  if (document.getElementById('acc-funda').checked)       accesorios.push('funda');
  if (document.getElementById('acc-caja').checked)        accesorios.push('caja');
  if (document.getElementById('acc-auriculares').checked) accesorios.push('auriculares');

  if (!marca)   { toast('Ingresá la marca', 'error'); return; }
  if (!modelo)  { toast('Ingresá el modelo', 'error'); return; }
  if (!arreglo) { toast('Seleccioná el tipo de arreglo', 'error'); return; }

  const btn = document.getElementById('rep-form-save');
  btn.disabled = true;

  try {
    if (editingRepairId) {
      const existing = REPAIRS.find(x => x.id === editingRepairId);
      if (!existing) { closeRepairForm(); return; }
      await db.collection('repairs').doc(editingRepairId).set({
        ...existing,
        marca, modelo, arreglo, condicion, codigo, monto, sena, costo, presupuesto, tecnico,
        fechaEstimada, nombre, tlf, dni, accesorios, observaciones: obs
      });
      toast('Reparación actualizada', 'success');
    } else {
      // Usar nOrden ingresado por el usuario (o auto si está vacío)
      const ordenInputVal = parseInt(document.getElementById('rep-fi-orden').value) || 0;
      const metaRef = db.collection('config').doc('repairsMeta');
      let nOrden;
      await db.runTransaction(async t => {
        const meta  = await t.get(metaRef);
        const next  = meta.exists ? (meta.data().nextOrderNum || 7100) : 7100;
        nOrden = ordenInputVal > 0 ? ordenInputVal : next;
        // Advance counter only if the entered value >= current next
        if (nOrden >= next) {
          t.set(metaRef, { nextOrderNum: nOrden + 1 }, { merge: true });
        }
      });

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const ahora = new Date().toISOString();
      await db.collection('repairs').doc(id).set({
        id, nOrden, marca, modelo, arreglo, condicion, codigo, monto, sena, costo, presupuesto, tecnico,
        fechaEstimada, nombre, tlf, dni, accesorios, observaciones: obs,
        estado: 'reparando',
        fechaIngreso: ahora,
        estadoHistorial: [{ estado: 'reparando', fecha: ahora }],
        esGarantia: false
      });
      toast('Reparación N°' + nOrden + ' registrada', 'success');
    }
    closeRepairForm();
  } catch (e) {
    console.error(e);
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Detalle ───────────────────────────────
function openRepairDetail(id) {
  const r = REPAIRS.find(x => x.id === id);
  if (!r) return;

  document.getElementById('rep-det-marca').textContent  =
    (r.marca || '') + (r.nOrden ? ' · N°' + r.nOrden : '');
  document.getElementById('rep-det-modelo').textContent = r.modelo || '';

  const accsMap = { cargador:'🔌 Cargador', funda:'🛡️ Funda', caja:'📦 Caja', auriculares:'🎧 Auriculares' };
  const accs = (r.accesorios || []).map(a => accsMap[a] || a).join(', ');
  const saldo = (r.monto && r.sena) ? r.monto - r.sena : null;
  const fechaIng = r.fechaIngreso ? fmtDateTime(r.fechaIngreso) : '—';

  document.getElementById('rep-det-body').innerHTML = `
    <div class="det-row">
      <span class="det-label">Estado</span>
      <div class="rep-status-btns">
        ${Object.entries(REPAIR_STATES).map(([k, v]) =>
          `<button class="status-btn ${k === r.estado ? 'status-btn--active ' + v.cls : ''}"
            onclick="changeRepairStatus('${id}','${k}')">${v.label}</button>`
        ).join('')}
      </div>
    </div>
    <div class="det-row">
      <span class="det-label">Arreglo</span>
      <span class="det-val">${esc(r.arreglo || '—')}</span>
    </div>
    ${r.condicion ? `<div class="det-row det-row--full">
      <span class="det-label">Condición visual</span>
      <span class="det-val">${esc(r.condicion)}</span>
    </div>` : ''}
    ${r.codigo ? `<div class="det-row">
      <span class="det-label">Cód. seguridad</span>
      <div class="pass-inline">
        <span class="pass-dots" id="det-pass-hidden">••••••</span>
        <span class="pass-val" id="det-pass-shown" style="display:none">${esc(r.codigo)}</span>
        <button class="pass-toggle-sm" onclick="toggleDetPass()">👁️</button>
      </div>
    </div>` : ''}
    ${accs ? `<div class="det-row det-row--full">
      <span class="det-label">Accesorios</span>
      <span class="det-val">${accs}</span>
    </div>` : ''}
    ${r.nombre ? `<div class="det-row">
      <span class="det-label">Cliente</span>
      <span class="det-val">${esc(r.nombre)}</span>
    </div>` : ''}
    ${r.tlf ? `<div class="det-row">
      <span class="det-label">Teléfono</span>
      <span class="det-val">${esc(r.tlf)}</span>
    </div>` : ''}
    ${r.dni ? `<div class="det-row">
      <span class="det-label">DNI</span>
      <span class="det-val">${esc(r.dni)}</span>
    </div>` : ''}
    ${r.monto ? `<div class="det-row">
      <span class="det-label">Monto</span>
      <span class="det-val det-price">$ ${r.monto.toLocaleString('es-AR')}</span>
    </div>` : ''}
    ${r.sena ? `<div class="det-row">
      <span class="det-label">Seña</span>
      <span class="det-val" style="color:var(--grn2);font-weight:700">$ ${r.sena.toLocaleString('es-AR')}</span>
    </div>` : ''}
    ${saldo !== null ? `<div class="det-row">
      <span class="det-label">Saldo</span>
      <span class="det-val" style="color:var(--warn);font-weight:700">$ ${saldo.toLocaleString('es-AR')}</span>
    </div>` : ''}
    ${r.costo ? `<div class="det-row">
      <span class="det-label">Costo repuesto</span>
      <span class="det-val">$ ${r.costo.toLocaleString('es-AR')}</span>
    </div>` : ''}
    ${(r.monto && r.costo) ? `<div class="det-row">
      <span class="det-label">Ganancia</span>
      <span class="det-val" style="color:var(--grn2);font-weight:700">$ ${(r.monto - r.costo).toLocaleString('es-AR')}</span>
    </div>` : ''}
    ${r.presupuesto ? `<div class="det-row">
      <span class="det-label">Presupuesto</span>
      <span class="det-val">$ ${r.presupuesto.toLocaleString('es-AR')}${r.monto ? ` → <strong style="color:${r.monto > r.presupuesto ? '#ef4444' : '#10b981'}">$ ${r.monto.toLocaleString('es-AR')}</strong>` : ''}</span>
    </div>` : ''}
    ${r.tecnico ? `<div class="det-row">
      <span class="det-label">Tomado por</span>
      <span class="det-val">👤 ${esc(r.tecnico)}</span>
    </div>` : ''}
    ${r.fechaEstimada ? `<div class="det-row">
      <span class="det-label">Entrega est.</span>
      <span class="det-val">${fmtDate(r.fechaEstimada)}</span>
    </div>` : ''}
    <div class="det-row">
      <span class="det-label">Ingresó</span>
      <span class="det-val">${fechaIng}</span>
    </div>
    ${r.fechaEntrega ? `<div class="det-row">
      <span class="det-label">Entregado</span>
      <span class="det-val">${fmtDateTime(r.fechaEntrega)}</span>
    </div>` : ''}
    ${r.observaciones ? `<div class="det-row det-row--full">
      <span class="det-label">Observaciones</span>
      <span class="det-val">${esc(r.observaciones)}</span>
    </div>` : ''}
    ${r.esGarantia && r.ordenOriginal ? `<div class="det-row">
      <span class="det-label">Garantía de</span>
      <span class="det-val" style="color:var(--acc);font-weight:700">N°${r.ordenOriginal}</span>
    </div>` : ''}
    ${r.tieneGarantia ? `<div class="det-row">
      <span class="det-label">Reingreso</span>
      <span class="det-val" style="color:var(--warn)">⚠️ Tiene garantía</span>
    </div>` : ''}
    ${Array.isArray(r.estadoHistorial) && r.estadoHistorial.length > 0 ? `
    <div class="det-row det-row--full">
      <span class="det-label">Historial de estados</span>
      <ul class="state-timeline">
        ${[...r.estadoHistorial]
          .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
          .map(h => {
            const hs   = REPAIR_STATES[h.estado] || { label: h.estado || '?' };
            const hFec = h.fecha
              ? new Date(h.fecha).toLocaleString('es-AR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
              : '—';
            return `<li class="state-tl-item">
              <span class="state-tl-dot state-tl-dot--${h.estado}"></span>
              <span class="state-tl-label">${hs.label}</span>
              <span class="state-tl-date">${hFec}</span>
            </li>`;
          }).join('')}
      </ul>
    </div>` : ''}
  `;

  const hasHistory = (r.tlf || r.dni);
  document.getElementById('rep-det-actions').innerHTML = `
    ${r.tlf ? `<button class="btn-whatsapp" onclick="repairWhatsApp('${id}')">🟢 WhatsApp</button>` : ''}
    ${r.tlf ? `<button class="btn-edit" onclick="copyPhone('${esc(r.tlf)}')">📋 Tel.</button>` : ''}
    <button class="btn-edit" onclick="closeRepairDetail();openRepairForm('${id}')">✏️ Editar</button>
    <button class="btn-history" onclick="openTicket('${id}')">🧾 Ticket</button>
    ${!r.esGarantia ? `<button class="btn-garantia" onclick="openGarantiaModal('${id}')">🔄 Garantía</button>` : ''}
    ${hasHistory ? `<button class="btn-history" onclick="openCustomerHistory('${id}')">👤 Historial</button>` : ''}
    <button class="btn-delete" onclick="deleteRepair('${id}')">🗑️</button>
  `;

  document.getElementById('rep-detail-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeRepairDetail() {
  document.getElementById('rep-detail-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function toggleDetPass() {
  const hidden = document.getElementById('det-pass-hidden');
  const shown  = document.getElementById('det-pass-shown');
  if (!hidden || !shown) return;
  const isHidden = hidden.style.display !== 'none';
  hidden.style.display = isHidden ? 'none' : '';
  shown.style.display  = isHidden ? ''     : 'none';
}

function togglePassField(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.textContent = '🙈';
  } else {
    input.type = 'password';
    if (btn) btn.textContent = '👁️';
  }
}

// ── Cambio de estado ──────────────────────
async function changeRepairStatus(id, newStatus) {
  const r = REPAIRS.find(x => x.id === id);
  if (!r || r.estado === newStatus) return;

  const ahora = new Date().toISOString();
  const update = { estado: newStatus };
  if (newStatus === 'entregado') update.fechaEntrega = ahora;
  // Append to state history (avoid arrayUnion dependency — safe for single-user)
  const prevHistory = Array.isArray(r.estadoHistorial) ? r.estadoHistorial : [];
  update.estadoHistorial = [...prevHistory, { estado: newStatus, fecha: ahora }];

  try {
    await db.collection('repairs').doc(id).update(update);
    toast('Estado: ' + (REPAIR_STATES[newStatus]?.label || newStatus), 'success');
    closeRepairDetail();
    setTimeout(() => openRepairDetail(id), 120);
  } catch (e) {
    console.error(e);
    toast('Error al actualizar estado', 'error');
  }
}

// ── WhatsApp ──────────────────────────────
function repairWhatsApp(id) {
  const r = REPAIRS.find(x => x.id === id);
  if (!r || !r.tlf) { toast('No hay teléfono registrado', 'error'); return; }

  let phone = String(r.tlf).replace(/\D/g, '');
  if (phone.length === 10)                      phone = '549' + phone;
  else if (phone.length === 11 && phone.startsWith('0')) phone = '54' + phone.slice(1);
  else if (!phone.startsWith('54'))             phone = '549' + phone;

  const nombre = r.nombre ? r.nombre.split(' ')[0] : '';
  const equipo = `*${r.marca} ${r.modelo}*`;

  const tpls = (typeof WA_TEMPLATES !== 'undefined' && WA_TEMPLATES) || {};
  let tpl;
  if (r.estado === 'listo') {
    tpl = tpls.repair_listo     || 'Hola {nombre}! 👋\nTu {equipo} (Orden N°{nOrden}) ya está *lista para retirar* 🔧✅\n_Cuando puedas coordinamos el horario._';
  } else if (r.estado === 'reparando') {
    tpl = tpls.repair_reparando || 'Hola {nombre}! 👋\nTe contactamos por tu {equipo} (Orden N°{nOrden}). Estamos trabajando en ella 🔧';
  } else {
    tpl = tpls.repair_default   || 'Hola {nombre}! 👋\nTe contactamos por tu {equipo} (Orden N°{nOrden}).';
  }
  const msg = tpl
    .replace(/{nombre}/g, nombre)
    .replace(/{equipo}/g, equipo.replace(/\*/g, ''))
    .replace(/{nOrden}/g, r.nOrden || '—')
    .replace(/{marca}/g, r.marca || '')
    .replace(/{modelo}/g, r.modelo || '');

  window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), '_blank');
}

// ── Eliminar ──────────────────────────────
async function deleteRepair(id) {
  const r = REPAIRS.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`¿Eliminar N°${r.nOrden} — ${r.nombre || (r.marca + ' ' + r.modelo)}?`)) return;
  try {
    await db.collection('repairs').doc(id).delete();
    closeRepairDetail();
    toast('Reparación eliminada', 'info');
  } catch (e) {
    toast('Error al eliminar', 'error');
  }
}

// ── Garantía ──────────────────────────────
function openGarantiaModal(originalId) {
  const r = REPAIRS.find(x => x.id === originalId);
  if (!r) return;
  pendingGarantiaRef = originalId;

  document.getElementById('garantia-ref-info').innerHTML = `
    <div class="garantia-ref-card">
      <span class="garantia-ref-title">Reparación original</span>
      <span class="garantia-ref-desc">N°${r.nOrden} · ${esc(r.marca)} ${esc(r.modelo)} — ${esc(r.arreglo || '')}</span>
    </div>`;

  document.getElementById('gar-fi-codigo').value  = r.codigo || '';
  document.getElementById('gar-fi-arreglo').value = '';
  document.getElementById('gar-fi-obs').value     = '';
  document.getElementById('gar-fi-codigo').type   = 'password';

  document.getElementById('garantia-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeGarantiaModal() {
  document.getElementById('garantia-modal').classList.add('hidden');
  document.body.style.overflow = '';
  pendingGarantiaRef = null;
}

async function saveGarantia() {
  const originalId = pendingGarantiaRef;
  if (!originalId) return;

  const arreglo = document.getElementById('gar-fi-arreglo').value.trim();
  const codigo  = document.getElementById('gar-fi-codigo').value.trim();
  const obs     = document.getElementById('gar-fi-obs').value.trim();

  if (!arreglo) { toast('Describí el problema', 'error'); return; }

  const original = REPAIRS.find(x => x.id === originalId);
  if (!original) return;

  const btn = document.getElementById('garantia-save');
  btn.disabled = true;

  try {
    // Garantía usa el mismo N° de orden que la original
    const nOrden = original.nOrden;

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await db.collection('repairs').doc(id).set({
      id, nOrden,
      marca: original.marca, modelo: original.modelo,
      arreglo, codigo, observaciones: obs,
      nombre: original.nombre, tlf: original.tlf, dni: original.dni,
      accesorios: original.accesorios || [],
      condicion: '',
      monto: 0, sena: 0,
      estado: 'reparando',
      fechaIngreso: new Date().toISOString(),
      esGarantia: true,
      ordenOriginal: original.nOrden,
      ordenOriginalId: originalId
    });

    await db.collection('repairs').doc(originalId).update({ tieneGarantia: true });

    closeGarantiaModal();
    closeRepairDetail();
    toast('Garantía N°' + nOrden + ' registrada', 'success');
  } catch (e) {
    console.error(e);
    toast('Error al registrar garantía', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Historial del cliente ─────────────────
function openCustomerHistory(repairId) {
  const r = REPAIRS.find(x => x.id === repairId);
  if (!r) return;

  const related = REPAIRS.filter(x =>
    x.id !== repairId &&
    ((r.dni && x.dni === r.dni) || (r.tlf && x.tlf === r.tlf))
  ).sort((a, b) => (b.fechaIngreso || '').localeCompare(a.fechaIngreso || ''));

  let html = `
    <div class="customer-hdr">
      <div class="customer-name">${esc(r.nombre || 'Cliente')}</div>
      ${r.tlf ? `<div class="customer-meta">📞 ${esc(r.tlf)}</div>` : ''}
      ${r.dni ? `<div class="customer-meta">🪪 ${esc(r.dni)}</div>` : ''}
    </div>`;

  if (related.length === 0) {
    html += '<p class="hist-empty">No hay otras reparaciones de este cliente</p>';
  } else {
    html += `<h4 class="hist-title">${related.length} reparación${related.length !== 1 ? 'es' : ''} anterior${related.length !== 1 ? 'es' : ''}</h4>`;
    html += related.map(x => {
      const st   = REPAIR_STATES[x.estado] || { label: x.estado || '—', cls: '' };
      const fecha = x.fechaIngreso
        ? new Date(x.fechaIngreso).toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'numeric' })
        : '';
      return `
        <div class="hist-item" style="cursor:pointer" onclick="closeHistoryModal();openRepairDetail('${x.id}')">
          <div class="hist-item-info">
            <div class="hist-item-name">N°${x.nOrden} — ${esc(x.marca)} ${esc(x.modelo)}</div>
            <div class="hist-item-specs">${esc(x.arreglo || '')} · ${fecha}</div>
          </div>
          <span class="badge ${st.cls}" style="font-size:.65rem;white-space:nowrap">${st.label}</span>
        </div>`;
    }).join('');
  }

  document.getElementById('history-body').innerHTML = html;
  document.getElementById('history-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeHistoryModal() {
  document.getElementById('history-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── Estadísticas ──────────────────────────
let repStatsTab = 'mes';

function openRepairStats() {
  repStatsTab = 'mes';
  document.getElementById('stats-tab-mes').classList.add('stats-tab--active');
  document.getElementById('stats-tab-anual').classList.remove('stats-tab--active');
  document.getElementById('rep-stats-body').innerHTML = buildRepairStatsHTML('mes');
  document.getElementById('rep-stats-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeRepairStats() {
  document.getElementById('rep-stats-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function switchRepairStatsTab(tab) {
  repStatsTab = tab;
  document.getElementById('stats-tab-mes').classList.toggle('stats-tab--active', tab === 'mes');
  document.getElementById('stats-tab-anual').classList.toggle('stats-tab--active', tab === 'anual');
  document.getElementById('rep-stats-body').innerHTML = buildRepairStatsHTML(tab);
}

function buildRepairStatsHTML(tab) {
  const now = new Date();
  const thisYear  = now.getFullYear();
  const thisMonth = thisYear + '-' + String(now.getMonth() + 1).padStart(2, '0');

  if (tab === 'mes') {
    return buildStatsMonthHTML(now, thisMonth);
  } else {
    return buildStatsAnnualHTML(now, thisYear, thisMonth);
  }
}

function buildStatsMonthHTML(now, thisMonth) {
  const reparando = REPAIRS.filter(r => r.estado === 'reparando').length;
  const listo     = REPAIRS.filter(r => r.estado === 'listo').length;
  const demorados = REPAIRS.filter(r => r.estado === 'reparando' && r.fechaIngreso &&
    (now - new Date(r.fechaIngreso)) / 86400000 > 3).length;

  const mesReps    = REPAIRS.filter(r => r.fechaIngreso && r.fechaIngreso.startsWith(thisMonth));
  const mesTotal   = mesReps.length;
  const mesEntregados = mesReps.filter(r => r.estado === 'entregado').length;
  const mesIngreso = mesReps.reduce((s, r) => s + (r.monto || 0), 0);
  const mesGanancia = mesReps.filter(r => r.costo).reduce((s, r) => s + (r.monto || 0) - (r.costo || 0), 0);
  const mesSeñas   = mesReps.reduce((s, r) => s + (r.sena || 0), 0);
  const promedio   = mesTotal > 0 ? Math.round(mesIngreso / mesTotal) : 0;
  const garantiasMes = mesReps.filter(r => r.esGarantia).length;

  // Top arreglos del mes
  const arregloCount = {};
  mesReps.forEach(r => {
    if (r.arreglo) arregloCount[r.arreglo] = (arregloCount[r.arreglo] || 0) + 1;
  });
  const topArreglos = Object.entries(arregloCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const mesLabel = now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  return `
    <p class="stats-period-label">${mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1)}</p>
    <div class="ss-grid">
      <div class="ss-card"><div class="ss-num">${reparando}</div><div class="ss-lbl">En reparación</div></div>
      <div class="ss-card ss-green"><div class="ss-num">${listo}</div><div class="ss-lbl">Listos p/ retirar</div></div>
      <div class="ss-card ss-blue"><div class="ss-num">${mesTotal}</div><div class="ss-lbl">Ingresados mes</div></div>
      <div class="ss-card ss-blue"><div class="ss-num">${mesEntregados}</div><div class="ss-lbl">Entregados mes</div></div>
      <div class="ss-card ss-green"><div class="ss-num">$${mesIngreso.toLocaleString('es-AR')}</div><div class="ss-lbl">Recaudado mes</div></div>
      ${mesGanancia > 0 ? `<div class="ss-card ss-green"><div class="ss-num">$${mesGanancia.toLocaleString('es-AR')}</div><div class="ss-lbl">Ganancia mes</div></div>` : ''}
      ${mesSeñas > 0 ? `<div class="ss-card"><div class="ss-num">$${mesSeñas.toLocaleString('es-AR')}</div><div class="ss-lbl">Señas recibidas</div></div>` : ''}
      ${promedio > 0 ? `<div class="ss-card"><div class="ss-num">$${promedio.toLocaleString('es-AR')}</div><div class="ss-lbl">Promedio por rep.</div></div>` : ''}
      ${demorados > 0 ? `<div class="ss-card" style="border-left:3px solid #ef4444"><div class="ss-num" style="color:#ef4444">${demorados}</div><div class="ss-lbl">Demorados +3días</div></div>` : ''}
      ${garantiasMes > 0 ? `<div class="ss-card"><div class="ss-num">${garantiasMes}</div><div class="ss-lbl">Garantías mes</div></div>` : ''}
    </div>

    ${topArreglos.length > 0 ? `
    <h4 class="hist-title" style="margin-top:12px">Top reparaciones del mes</h4>
    ${topArreglos.map(([arreglo, count], i) => `
      <div class="hist-item">
        <div class="hist-item-info"><div class="hist-item-name">${i + 1}. ${esc(arreglo)}</div></div>
        <span class="badge bg-reparando">${count}</span>
      </div>`).join('')}` : ''}
  `;
}

function buildStatsAnnualHTML(now, thisYear, thisMonth) {
  const yearReps = REPAIRS.filter(r => r.fechaIngreso && r.fechaIngreso.startsWith(String(thisYear)));
  const yearTotal    = yearReps.length;
  const yearIngreso  = yearReps.reduce((s, r) => s + (r.monto || 0), 0);
  const yearGanancia = yearReps.filter(r => r.costo).reduce((s, r) => s + (r.monto || 0) - (r.costo || 0), 0);
  const yearEntregados = yearReps.filter(r => r.estado === 'entregado').length;
  const garantiasYear = yearReps.filter(r => r.esGarantia).length;

  // Historial mensual del año
  const byMonth = {};
  yearReps.forEach(r => {
    const d   = new Date(r.fechaIngreso);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const lbl = d.toLocaleDateString('es-AR', { month: 'long' });
    if (!byMonth[key]) byMonth[key] = { label: lbl, count: 0, ingresos: 0, ganancia: 0 };
    byMonth[key].count++;
    byMonth[key].ingresos += r.monto || 0;
    if (r.costo) byMonth[key].ganancia += (r.monto || 0) - (r.costo || 0);
  });
  const monthKeys = Object.keys(byMonth).sort().reverse();
  const bestMonth = monthKeys.reduce((best, k) => (!best || byMonth[k].count > byMonth[best].count) ? k : best, null);
  const avgMensual = monthKeys.length > 0 ? Math.round(yearTotal / monthKeys.length) : 0;

  // Top arreglos del año
  const arregloCount = {};
  yearReps.forEach(r => {
    if (r.arreglo) arregloCount[r.arreglo] = (arregloCount[r.arreglo] || 0) + 1;
  });
  const topArreglos = Object.entries(arregloCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Tiempo promedio por tipo
  const avgByTipo = {};
  REPAIRS.filter(r => r.estado === 'entregado' && r.fechaIngreso && r.fechaEntrega && r.arreglo
    && r.fechaIngreso.startsWith(String(thisYear)))
    .forEach(r => {
      const dias = (new Date(r.fechaEntrega) - new Date(r.fechaIngreso)) / 86400000;
      if (!avgByTipo[r.arreglo]) avgByTipo[r.arreglo] = { sum: 0, cnt: 0 };
      avgByTipo[r.arreglo].sum += dias;
      avgByTipo[r.arreglo].cnt++;
    });
  const avgTipoRows = Object.entries(avgByTipo)
    .map(([tipo, v]) => ({ tipo, avg: v.sum / v.cnt, cnt: v.cnt }))
    .sort((a, b) => b.cnt - a.cnt).slice(0, 6);

  return `
    <p class="stats-period-label">Año ${thisYear}</p>
    <div class="ss-grid">
      <div class="ss-card ss-blue"><div class="ss-num">${yearTotal}</div><div class="ss-lbl">Total año</div></div>
      <div class="ss-card ss-blue"><div class="ss-num">${yearEntregados}</div><div class="ss-lbl">Entregados</div></div>
      <div class="ss-card ss-green"><div class="ss-num">$${yearIngreso.toLocaleString('es-AR')}</div><div class="ss-lbl">Recaudado año</div></div>
      ${yearGanancia > 0 ? `<div class="ss-card ss-green"><div class="ss-num">$${yearGanancia.toLocaleString('es-AR')}</div><div class="ss-lbl">Ganancia año</div></div>` : ''}
      ${avgMensual > 0 ? `<div class="ss-card"><div class="ss-num">${avgMensual}</div><div class="ss-lbl">Promedio mensual</div></div>` : ''}
      ${garantiasYear > 0 ? `<div class="ss-card"><div class="ss-num">${garantiasYear}</div><div class="ss-lbl">Garantías año</div></div>` : ''}
    </div>

    <h4 class="hist-title" style="margin-top:12px">Historial mensual ${thisYear}</h4>
    ${monthKeys.length === 0
      ? '<p class="hist-empty">Sin datos aún</p>'
      : monthKeys.map(k => {
          const m = byMonth[k];
          const isBest = k === bestMonth && monthKeys.length > 1;
          return `<div class="hist-month">
            <div class="hist-month-hdr">
              <span class="hist-month-name">${m.label.charAt(0).toUpperCase() + m.label.slice(1)}${isBest ? ' 🏆' : ''}</span>
              <span class="hist-month-stats">${m.count} rep. · $${m.ingresos.toLocaleString('es-AR')}</span>
            </div>
          </div>`;
        }).join('')}

    ${topArreglos.length > 0 ? `
    <h4 class="hist-title" style="margin-top:12px">Top reparaciones del año</h4>
    ${topArreglos.map(([arreglo, count], i) => `
      <div class="hist-item">
        <div class="hist-item-info"><div class="hist-item-name">${i + 1}. ${esc(arreglo)}</div></div>
        <span class="badge bg-reparando">${count}</span>
      </div>`).join('')}` : ''}

    ${avgTipoRows.length > 0 ? `
    <h4 class="hist-title" style="margin-top:12px">⏱ Tiempo promedio por tipo</h4>
    ${avgTipoRows.map(row => `
      <div class="hist-item">
        <div class="hist-item-info">
          <div class="hist-item-name">${esc(row.tipo)}</div>
          <div class="hist-item-specs">${row.cnt} entregados</div>
        </div>
        <span class="badge bg-entregado">${row.avg < 1 ? '<1 día' : Math.round(row.avg) + ' día' + (Math.round(row.avg) !== 1 ? 's' : '')}</span>
      </div>`).join('')}` : ''}
  `;
}

// ── Importar historial ────────────────────
function importRepairHistory(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      const records = parsed.records || parsed;
      const meta    = parsed.meta   || {};

      if (!Array.isArray(records) || records.length === 0) {
        toast('Archivo inválido o sin registros', 'error');
        return;
      }

      if (!confirm(`¿Importar ${records.length} reparaciones históricas?\nEsto no borrará datos existentes.`)) return;

      toast('Importando...', 'info');

      // Batch write en grupos de 400
      const CHUNK = 400;
      let imported = 0;

      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK);
        const batch = db.batch();
        chunk.forEach(r => {
          const docId = r.id || ('import_' + r.nOrden + '_' + Date.now().toString(36));
          batch.set(db.collection('repairs').doc(docId), { ...r, id: docId });
        });
        await batch.commit();
        imported += chunk.length;
      }

      // Actualizar nextOrderNum si viene en el meta
      if (meta.nextOrderNum) {
        await db.collection('config').doc('repairsMeta').set(
          { nextOrderNum: meta.nextOrderNum }, { merge: true }
        );
      }

      toast(`✅ ${imported} reparaciones importadas`, 'success');
    } catch (err) {
      console.error(err);
      toast('Error al importar: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

// ── Helpers ───────────────────────────────
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = (new Date() - new Date(isoStr)) / 1000;
  if (diff < 60)    return 'Hace un momento';
  if (diff < 3600)  return 'Hace ' + Math.floor(diff / 60) + ' min';
  if (diff < 86400) return 'Hace ' + Math.floor(diff / 3600) + 'h';
  const days = Math.floor(diff / 86400);
  if (days < 7)     return 'Hace ' + days + ' día' + (days !== 1 ? 's' : '');
  const weeks = Math.floor(days / 7);
  if (weeks < 5)    return 'Hace ' + weeks + ' sem.';
  const months = Math.floor(days / 30);
  return 'Hace ' + months + ' mes' + (months !== 1 ? 'es' : '');
}

function updateNavBadge() {
  const listos = REPAIRS.filter(r => r.estado === 'listo').length;
  const badge  = document.getElementById('nav-badge-repairs');
  if (!badge) return;
  if (listos > 0) {
    badge.textContent    = listos;
    badge.style.display  = '';
  } else {
    badge.style.display  = 'none';
  }
}

async function quickStatusChange(e, id, newStatus) {
  e.stopPropagation();
  const update = { estado: newStatus };
  if (newStatus === 'entregado') update.fechaEntrega = new Date().toISOString();
  try {
    await db.collection('repairs').doc(id).update(update);
    toast('→ ' + (REPAIR_STATES[newStatus]?.label || newStatus), 'success');
  } catch (err) {
    toast('Error al actualizar', 'error');
  }
}

function copyPhone(tlf) {
  if (!tlf) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(tlf).then(() => toast('📋 Teléfono copiado', 'success'));
  } else {
    const el = document.createElement('textarea');
    el.value = tlf;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    toast('📋 Teléfono copiado', 'success');
  }
}

function openTicket(id) {
  const r = REPAIRS.find(x => x.id === id);
  if (!r) return;
  const accsMap = { cargador: 'Cargador', funda: 'Funda', caja: 'Caja', auriculares: 'Auriculares' };
  const accs  = (r.accesorios || []).map(a => accsMap[a] || a).join(', ');
  const saldo = (r.monto && r.sena) ? r.monto - r.sena : null;
  const fechaIng = r.fechaIngreso
    ? new Date(r.fechaIngreso).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
    : '—';
  const st = REPAIR_STATES[r.estado] || { label: r.estado || '—' };

  document.getElementById('ticket-body').innerHTML = `
    <div class="ticket-section">Equipo</div>
    <div class="ticket-row"><span class="ticket-lbl">N° Orden</span><span class="ticket-val">N°${r.nOrden}</span></div>
    <div class="ticket-row"><span class="ticket-lbl">Equipo</span><span class="ticket-val">${esc(r.marca)} ${esc(r.modelo)}</span></div>
    <div class="ticket-row"><span class="ticket-lbl">Arreglo</span><span class="ticket-val">${esc(r.arreglo || '—')}</span></div>
    ${r.condicion ? `<div class="ticket-row"><span class="ticket-lbl">Condición</span><span class="ticket-val">${esc(r.condicion)}</span></div>` : ''}
    ${accs ? `<div class="ticket-row"><span class="ticket-lbl">Accesorios</span><span class="ticket-val">${accs}</span></div>` : ''}
    <div class="ticket-section">Cliente</div>
    ${r.nombre ? `<div class="ticket-row"><span class="ticket-lbl">Nombre</span><span class="ticket-val">${esc(r.nombre)}</span></div>` : ''}
    ${r.tlf    ? `<div class="ticket-row"><span class="ticket-lbl">Teléfono</span><span class="ticket-val">${esc(r.tlf)}</span></div>` : ''}
    ${r.dni    ? `<div class="ticket-row"><span class="ticket-lbl">DNI</span><span class="ticket-val">${esc(r.dni)}</span></div>` : ''}
    <div class="ticket-section">Pago</div>
    ${r.monto  ? `<div class="ticket-row"><span class="ticket-lbl">Monto</span><span class="ticket-val">$ ${r.monto.toLocaleString('es-AR')}</span></div>` : ''}
    ${r.sena   ? `<div class="ticket-row"><span class="ticket-lbl">Seña</span><span class="ticket-val">$ ${r.sena.toLocaleString('es-AR')}</span></div>` : ''}
    ${saldo !== null ? `<div class="ticket-row"><span class="ticket-lbl">Saldo</span><span class="ticket-val" style="color:#f59e0b;font-weight:800">$ ${saldo.toLocaleString('es-AR')}</span></div>` : ''}
    <div class="ticket-section">Información</div>
    <div class="ticket-row"><span class="ticket-lbl">Estado</span><span class="ticket-val">${st.label}</span></div>
    <div class="ticket-row"><span class="ticket-lbl">Ingreso</span><span class="ticket-val">${fechaIng}</span></div>
    ${r.fechaEstimada ? `<div class="ticket-row"><span class="ticket-lbl">Entrega est.</span><span class="ticket-val">${fmtDate(r.fechaEstimada)}</span></div>` : ''}
    ${r.observaciones ? `<div class="ticket-row" style="flex-direction:column;gap:2px"><span class="ticket-lbl">Observaciones</span><span class="ticket-val" style="text-align:left;font-weight:400">${esc(r.observaciones)}</span></div>` : ''}
  `;

  document.getElementById('rep-ticket-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeTicket() {
  document.getElementById('rep-ticket-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function printTicket() {
  window.print();
}

// ── Personal (Staff) ──────────────────────
async function loadStaff() {
  try {
    const doc = await db.collection('config').doc('staff').get();
    STAFF = doc.exists ? (doc.data().members || []) : [];
  } catch (e) {
    STAFF = [];
  }
  refreshStaffSelect('');
}

function refreshStaffSelect(selectedValue) {
  const sel = document.getElementById('rep-fi-tecnico');
  if (!sel) return;
  const current = selectedValue !== undefined ? selectedValue : sel.value;
  while (sel.options.length > 1) sel.remove(1);
  STAFF.forEach(name => {
    const o = document.createElement('option');
    o.value = name; o.textContent = name; sel.appendChild(o);
  });
  sel.value = current;
}

function openStaffModal() {
  renderStaffList();
  document.getElementById('staff-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('staff-new-name').focus(), 200);
}

function closeStaffModal() {
  document.getElementById('staff-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function renderStaffList() {
  const el = document.getElementById('staff-list');
  if (!el) return;
  if (STAFF.length === 0) {
    el.innerHTML = '<p class="staff-empty">No hay técnicos registrados</p>';
    return;
  }
  el.innerHTML = STAFF.map(name => `
    <div class="staff-member">
      <span class="staff-name">👤 ${esc(name)}</span>
      <button class="staff-del" onclick="deleteStaffMember('${esc(name)}')">✕ Eliminar</button>
    </div>`).join('');
}

async function addStaffMember() {
  const input = document.getElementById('staff-new-name');
  const name  = (input.value || '').trim();
  if (!name) { toast('Ingresá un nombre', 'error'); return; }
  if (STAFF.includes(name)) { toast('Ya existe ese técnico', 'error'); return; }

  STAFF = [...STAFF, name];
  try {
    await db.collection('config').doc('staff').set({ members: STAFF });
    input.value = '';
    renderStaffList();
    refreshStaffSelect('');
    toast('✅ ' + name + ' agregado', 'success');
  } catch (e) {
    STAFF = STAFF.filter(x => x !== name);
    toast('Error al guardar', 'error');
  }
}

async function deleteStaffMember(name) {
  if (!confirm('¿Eliminar a ' + name + '?')) return;
  STAFF = STAFF.filter(x => x !== name);
  try {
    await db.collection('config').doc('staff').set({ members: STAFF });
    renderStaffList();
    refreshStaffSelect('');
    toast(name + ' eliminado', 'info');
  } catch (e) {
    toast('Error al guardar', 'error');
  }
}
