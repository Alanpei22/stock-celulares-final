// ══════════════════════════════════════════
//  REPARACIONES
// ══════════════════════════════════════════

const REPAIR_STATES = {
  reparando: { label: 'Reparando', cls: 'bg-reparando' },
  listo:     { label: 'Listo ✓',  cls: 'bg-listo'     },
  entregado: { label: 'Entregado', cls: 'bg-entregado' },
  cancelado: { label: 'No van',    cls: 'bg-cancelado' },
  'no van':  { label: 'No van',    cls: 'bg-cancelado' },
};

let REPAIRS = [];
let STAFF   = [];
let editingRepairId    = null;
let pendingGarantiaRef = null;
let repRenderTimer;

// ── Firebase ──────────────────────────────
function listenRepairs() {
  // Limitar a 365 días: cubre estadísticas anuales y no lee toda la historia
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  const cutoffISO = cutoff.toISOString();

  db.collection('repairs')
    .where('fechaIngreso', '>=', cutoffISO)
    .onSnapshot(snap => {
      REPAIRS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      REPAIRS.sort((a, b) => (b.fechaIngreso || '').localeCompare(a.fechaIngreso || ''));
      renderRepairs();
    }, err => {
      console.error('Repairs:', err);
      toast('Error cargando reparaciones', 'error');
    });
}

// Carga histórico completo (solo cuando se pide explícitamente, ej: estadísticas anuales)
async function loadAllRepairsHistory() {
  const snap = await db.collection('repairs').orderBy('fechaIngreso', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
  loadCustomMarcas();
  loadWaNotifyNumber();
  listenRepairs();
}

// ── Filtro rápido desde stat bar ──────────
function filterRepsByStatus(status) {
  const sel = document.getElementById('rep-f-estado');
  if (!sel) return;
  sel.value = sel.value === status ? '' : status;
  renderRepairs();
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
    if (fEstado === 'demorado') {
      // Demorado = reparando hace más de 3 días
      if (r.estado !== 'reparando' || !r.fechaIngreso) return false;
      if ((now - new Date(r.fechaIngreso)) / 86400000 <= 3) return false;
    } else if (fEstado && r.estado !== fEstado) return false;
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

  // Stats bar: demorados = reparando > 3 días (excluye cancelado y 'no van')
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
      ? new Date(r.fechaIngreso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: 'short' })
      : '';
    const monto = r.monto ? '$ ' + r.monto.toLocaleString('es-AR') : '—';
    const ganancia = (r.monto != null && r.costoRepuesto != null)
      ? r.monto - r.costoRepuesto : null;
    const gananciaHTML = ganancia != null
      ? `<span class="owner-only ganancia-chip ${ganancia >= 0 ? 'ganancia-pos' : 'ganancia-neg'}">📈 $${ganancia.toLocaleString('es-AR')}</span>`
      : '';

    // Demorado? Solo aplica a reparando (no van/cancelado nunca son demorados)
    const isDemorado = r.estado === 'reparando' && r.fechaIngreso &&
      (now - new Date(r.fechaIngreso)) / 86400000 > 3;

    // Card class — sanitizar estado para evitar espacios en el nombre de clase CSS
    const estadoSlug = (r.estado || '').replace(/\s+/g, '-').toLowerCase();
    let cardClass = `rep-card--${estadoSlug}`;
    if (isDemorado) cardClass += ' rep-card--demorado';

    // Time ago
    const taStr  = r.fechaIngreso ? timeAgo(r.fechaIngreso) : '';
    const taCls  = isDemorado ? 'card-time-ago card-time-demorado' : 'card-time-ago';

    // Saldo pendiente
    const saldoVal = (r.monto && r.sena && r.monto > r.sena && r.estado !== 'entregado')
      ? r.monto - r.sena : null;
    const saldoHTML = saldoVal
      ? `<span class="card-saldo-badge">💰 Saldo $${saldoVal.toLocaleString('es-AR')}</span>`
      : '';

    // Nota rápida
    const notaHTML = r.notaRapida
      ? `<div class="card-nota" onclick="event.stopPropagation();openNotaModal('${r.id}')">📝 ${esc(r.notaRapida)}</div>`
      : '';

    // Quick action chips
    const CHIP_CFG = {
      listo:     { ico: '✅', label: 'LISTO',      cls: 'chip-listo'     },
      entregado: { ico: '📦', label: 'ENTREGADO',  cls: 'chip-entregado' },
      reparando: { ico: '🔧', label: 'REPARANDO',  cls: 'chip-reparando' },
      cancelado: { ico: '✖',  label: 'NO VAN',     cls: 'chip-cancelado' },
    };
    const CHIP_MAP = {
      reparando: ['listo', 'cancelado'],
      listo:     ['entregado', 'reparando', 'cancelado'],
      entregado: ['reparando'],
      cancelado: ['entregado', 'reparando'],  // después de "no van" → se puede entregar o volver a reparar
      'no van':  ['entregado', 'reparando'],  // soporte para datos legacy
    };
    const chipsToShow = (CHIP_MAP[r.estado] || []);
    const chipsHTML = chipsToShow.map(st => {
      const c = CHIP_CFG[st];
      return `<button class="card-chip ${c.cls}" onclick="quickStatusChange(event,'${r.id}','${st}')">${c.ico} ${c.label}</button>`;
    }).join('');
    const garantiaChip = !r.esGarantia && r.estado !== 'cancelado'
      ? `<button class="card-chip chip-garantia" onclick="event.stopPropagation();openGarantiaModal('${r.id}')">🔄 GARANTÍA</button>`
      : '';
    const quickBtn = (chipsHTML || garantiaChip)
      ? `<div class="card-quick-actions" onclick="event.stopPropagation()">${chipsHTML}${garantiaChip}</div>`
      : '';

    return `
      <div class="card rep-card ${cardClass}" onclick="openRepairDetail('${r.id}')">
        <div class="card-top">
          <div class="card-info">
            <span class="card-marca">📱 ${esc(r.marca || '')} · N°${r.nOrden || '?'}</span>
            <span class="card-modelo">${esc(r.modelo || '')}</span>
            <span class="card-specs">🔧 ${esc(r.arreglo || '')}</span>
          </div>
          <div class="card-right">
            <span class="badge ${st.cls}">${st.label}</span>
            ${r.esGarantia ? '<span class="badge bg-warn" style="margin-top:3px">Garantía</span>' : ''}
            ${isDemorado ? '<span class="badge" style="margin-top:3px;background:#fee2e2;color:#dc2626;font-size:.6rem">⚠️ Demorado</span>' : ''}
            ${r.tlf ? `<button class="card-wa-btn" title="WhatsApp" onclick="event.stopPropagation();repairWhatsApp('${r.id}')"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#25D366" width="28" height="28"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg></button>` : ''}
          </div>
        </div>
        <div class="card-bottom">
          <span class="card-price">${monto}</span>${gananciaHTML}
          <div class="card-meta">
            ${r.nombre ? `<span class="card-imei">👤 ${esc(r.nombre)}</span>` : ''}
            ${fecha ? `<span class="card-date">📅 ${fecha}</span>` : ''}
            ${taStr ? `<span class="${taCls}">⏱ ${taStr}</span>` : ''}
          </div>
        </div>
        ${saldoVal ? `<div class="card-saldo-row">${saldoHTML}</div>` : ''}
        ${notaHTML}
        <div class="card-quick-actions" onclick="event.stopPropagation()">
          ${chipsHTML}${garantiaChip}
          <button class="card-chip chip-nota" onclick="openNotaModal('${r.id}')">${r.notaRapida ? '📝' : '📝 NOTA'}</button>
        </div>
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

    window._currentPatronDots = r.patron || null;
    window._currentPatronImg  = r.patronImg || null;
    const patronPrev = document.getElementById('patron-preview');
    if (r.patronImg) {
      patronPrev.innerHTML = r.patronImg;
      patronPrev.style.display = '';
      document.getElementById('btn-patron-clear').style.display = '';
    } else {
      patronPrev.innerHTML = '';
      patronPrev.style.display = 'none';
      document.getElementById('btn-patron-clear').style.display = 'none';
    }
    // Foto
    window._currentFotoBase64 = null;
    if (r.foto) {
      window._currentFotoBase64 = r.foto;
      document.getElementById('rep-fi-foto-img').src = r.foto;
      document.getElementById('rep-fi-foto-preview').classList.remove('hidden');
    } else {
      document.getElementById('rep-fi-foto-img').src = '';
      document.getElementById('rep-fi-foto-preview').classList.add('hidden');
    }
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
    window._currentPatronDots = null;
    window._currentPatronImg  = null;
    const patronPrevNew = document.getElementById('patron-preview');
    patronPrevNew.innerHTML = '';
    patronPrevNew.style.display = 'none';
    document.getElementById('btn-patron-clear').style.display = 'none';
    // Resetear toggle password
    const passInput = document.getElementById('rep-fi-codigo');
    passInput.type = 'password';
    refreshStaffSelect('');
    // Foto
    window._currentFotoBase64 = null;
    document.getElementById('rep-fi-foto').value = '';
    document.getElementById('rep-fi-foto-img').src = '';
    document.getElementById('rep-fi-foto-preview').classList.add('hidden');
  }

  document.getElementById('rep-form-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('rep-fi-marca').focus(), 300);
}

function closeRepairForm() {
  document.getElementById('rep-form-modal').classList.add('hidden');
  document.body.style.overflow = '';
  editingRepairId = null;
  window._currentFotoBase64 = null;
}

// ── Foto handling ─────────────────────────
window._currentFotoBase64 = null;

function handleFotoSelect(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 900;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const b64 = canvas.toDataURL('image/jpeg', 0.65);
      window._currentFotoBase64 = b64;
      document.getElementById('rep-fi-foto-img').src = b64;
      document.getElementById('rep-fi-foto-preview').classList.remove('hidden');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeFoto() {
  window._currentFotoBase64 = null;
  document.getElementById('rep-fi-foto').value = '';
  document.getElementById('rep-fi-foto-img').src = '';
  document.getElementById('rep-fi-foto-preview').classList.add('hidden');
}

function openFotoModal(src) {
  document.getElementById('foto-modal-img').src = src;
  document.getElementById('foto-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeFotoModal() {
  document.getElementById('foto-modal').classList.add('hidden');
  document.body.style.overflow = '';
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
  const patron    = window._currentPatronDots  || null;
  const patronImg = window._currentPatronImg   || null;
  const foto      = window._currentFotoBase64  || null;

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
      const updateData = {
        ...existing,
        marca, modelo, arreglo, condicion, codigo, patron, patronImg, monto, sena, costo, presupuesto, tecnico,
        fechaEstimada, nombre, tlf, dni, accesorios, observaciones: obs
      };
      if (foto) updateData.foto = foto;
      await db.collection('repairs').doc(editingRepairId).set(updateData);
      toast('Reparación actualizada', 'success');
      logActivity({
        tipo: 'edicion',
        desc: `Editó ${marca} ${modelo} N°${existing.nOrden}`,
        repairId: editingRepairId,
        tecnico,
        extra: { nOrden: existing.nOrden, marca, modelo, arreglo }
      });
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
      const newDoc = {
        id, nOrden, marca, modelo, arreglo, condicion, codigo, patron, patronImg, monto, sena, costo, presupuesto, tecnico,
        fechaEstimada, nombre, tlf, dni, accesorios, observaciones: obs,
        estado: 'reparando',
        fechaIngreso: ahora,
        estadoHistorial: [{ estado: 'reparando', fecha: ahora }],
        esGarantia: false
      };
      if (foto) newDoc.foto = foto;
      await db.collection('repairs').doc(id).set(newDoc);
      toast('Reparación N°' + nOrden + ' registrada', 'success');
      logActivity({
        tipo: 'ingreso',
        desc: `Nuevo ingreso: ${marca} ${modelo} N°${nOrden} — ${arreglo}`,
        repairId: id,
        tecnico,
        extra: { nOrden, marca, modelo, arreglo, monto, nombre }
      });
      triggerWaNotify('ingreso', { marca, modelo, nOrden, arreglo, nombre, monto });
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

  // Foto
  const fotoWrap = document.getElementById('rep-det-foto-wrap');
  const fotoImg  = document.getElementById('rep-det-foto-img');
  if (fotoWrap && fotoImg) {
    if (r.foto) {
      fotoImg.src = r.foto;
      fotoWrap.classList.remove('hidden');
    } else {
      fotoWrap.classList.add('hidden');
      fotoImg.src = '';
    }
  }

  const accsMap = { cargador:'🔌 Cargador', funda:'🛡️ Funda', caja:'📦 Caja', auriculares:'🎧 Auriculares' };
  const accs = (r.accesorios || []).map(a => accsMap[a] || a).join(', ');
  const saldo = (r.monto && r.sena) ? r.monto - r.sena : null;
  const fechaIng = r.fechaIngreso ? fmtDateTime(r.fechaIngreso) : '—';

  document.getElementById('rep-det-body').innerHTML = `
    <div class="det-row">
      <span class="det-label">Estado</span>
      <div class="rep-status-btns">
        ${Object.entries(REPAIR_STATES).map(([k, v]) =>
          `<button class="status-btn ${v.cls}${k === r.estado ? ' status-btn--active' : ''}"
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
    ${r.patronImg ? `<div class="det-row det-row--full">
      <span class="det-label">Patrón de desbloqueo</span>
      <div class="det-patron">${r.patronImg}</div>
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
              ? new Date(h.fecha).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
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
    ${(r.tlf && r.presupuesto) ? `<button class="btn-presupuesto" onclick="sendPresupuestoWA('${id}')">💬 Presupuesto</button>` : ''}
    <button class="btn-ai-wa" onclick="aiRepairWaMessage('${id}')">✨ Mensaje IA</button>
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

// ── Log de actividad ──────────────────────
async function logActivity({ tipo, desc, repairId, tecnico, extra = {} }) {
  try {
    await db.collection('actividad').add({
      tipo,
      desc,
      repairId: repairId || null,
      tecnico:  tecnico  || null,
      extra,
      fecha: new Date().toISOString()
    });
  } catch (e) { /* silencioso */ }
}

// ── Cambio de estado ──────────────────────
async function changeRepairStatus(id, newStatus) {
  const r = REPAIRS.find(x => x.id === id);
  if (!r || r.estado === newStatus) return;

  // Al marcar como "listo", preguntar qué repuesto se usó
  if (newStatus === 'listo') {
    openRepUsoModal(async (repuestoId) => {
      await _doChangeRepairStatus(id, newStatus, r);
      if (repuestoId && typeof REPUESTOS !== 'undefined') {
        const rep = REPUESTOS.find(x => x.id === repuestoId);
        if (rep) {
          const nueva = Math.max(0, (rep.cantidad || 0) - 1);
          Promise.all([
            db.collection('repuestos').doc(repuestoId).update({ cantidad: nueva }),
            db.collection('repairs').doc(id).update({ costoRepuesto: rep.precioCompra || 0 })
          ])
            .then(() => toast(`🔩 −1 ${rep.nombre}`, 'success'))
            .catch(() => toast('Error al descontar repuesto', 'error'));
        }
      }
    });
    return;
  }

  await _doChangeRepairStatus(id, newStatus, r);
}

async function _doChangeRepairStatus(id, newStatus, r) {
  const ahora = new Date().toISOString();
  const update = { estado: newStatus };
  if (newStatus === 'entregado') update.fechaEntrega = ahora;
  const prevHistory = Array.isArray(r.estadoHistorial) ? r.estadoHistorial : [];
  update.estadoHistorial = [...prevHistory, { estado: newStatus, fecha: ahora }];

  try {
    await db.collection('repairs').doc(id).update(update);
    toast('Estado: ' + (REPAIR_STATES[newStatus]?.label || newStatus), 'success');

    const estadoLabel = REPAIR_STATES[newStatus]?.label || newStatus;
    logActivity({
      tipo: 'estado',
      desc: `${r.marca} ${r.modelo} N°${r.nOrden} → ${estadoLabel}`,
      repairId: id,
      tecnico: r.tecnico || null,
      extra: { estadoAnterior: r.estado, estadoNuevo: newStatus, nOrden: r.nOrden }
    });

    closeRepairDetail();
    if (newStatus !== 'entregado') {
      setTimeout(() => openRepairDetail(id), 120);
    }
    if (newStatus === 'entregado' && r.monto && r.monto > 0) {
      setTimeout(() => openCobroModal(r), 400);
    }
  } catch (e) {
    console.error(e);
    toast('Error al actualizar estado', 'error');
  }
}

// ── Registrar cobro en caja ─────────────────────────────
let _cobroRepair = null;

function openCobroModal(r) {
  _cobroRepair = r;
  document.getElementById('cobro-monto-label').textContent = '$ ' + Number(r.monto).toLocaleString('es-AR');
  document.getElementById('cobro-desc-label').textContent = `N°${r.nOrden} ${r.marca} ${r.modelo}`;
  // reset method selection
  document.querySelectorAll('.cobro-metodo-btn').forEach(b => b.classList.remove('cobro-m-active'));
  document.querySelector('.cobro-metodo-btn[data-m="Efectivo"]').classList.add('cobro-m-active');
  document.getElementById('cobro-overlay').classList.remove('hidden');
  document.getElementById('cobro-modal').classList.remove('hidden');
}

function closeCobroModal() {
  document.getElementById('cobro-overlay').classList.add('hidden');
  document.getElementById('cobro-modal').classList.add('hidden');
  _cobroRepair = null;
}

function selectCobroMetodo(metodo) {
  document.querySelectorAll('.cobro-metodo-btn').forEach(b => b.classList.toggle('cobro-m-active', b.dataset.m === metodo));
}

async function confirmarCobro() {
  if (!_cobroRepair) return;
  const metodo = document.querySelector('.cobro-metodo-btn.cobro-m-active')?.dataset.m || 'Efectivo';
  const r = _cobroRepair;
  closeCobroModal();
  try {
    await db.collection('caja_movimientos').add({
      tipo: 'ingreso',
      categoria: 'Reparación',
      descripcion: `N°${r.nOrden} ${r.marca} ${r.modelo} — ${r.arreglo || ''}`.trim(),
      monto: r.monto,
      metodoPago: metodo,
      fecha: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      repairId: r.id
    });
    toast('💰 Cobro registrado en caja', 'success');
  } catch(e) {
    toast('Error al registrar en caja', 'error');
  }
}

// ── WhatsApp ──────────────────────────────
function repairWhatsApp(id) {
  const r = REPAIRS.find(x => x.id === id);
  if (!r || !r.tlf) { toast('No hay teléfono registrado', 'error'); return; }
  logActivity({
    tipo: 'whatsapp',
    desc: `WhatsApp enviado a ${r.nombre || r.tlf} — ${r.marca} ${r.modelo} N°${r.nOrden}`,
    repairId: id,
    tecnico: r.tecnico || null,
    extra: { nOrden: r.nOrden, tlf: r.tlf, estado: r.estado }
  });

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

// ── WhatsApp Presupuesto ──────────────────
function sendPresupuestoWA(id) {
  const r = REPAIRS.find(x => x.id === id);
  if (!r || !r.tlf) { toast('No hay teléfono registrado', 'error'); return; }
  if (!r.presupuesto) { toast('No hay presupuesto cargado', 'error'); return; }

  let phone = String(r.tlf).replace(/\D/g, '');
  if (phone.length === 10)                             phone = '549' + phone;
  else if (phone.length === 11 && phone.startsWith('0')) phone = '54' + phone.slice(1);
  else if (!phone.startsWith('54'))                    phone = '549' + phone;

  const nombre = r.nombre ? r.nombre.split(' ')[0] : 'cliente';
  const equipo = `${r.marca} ${r.modelo}`;
  const monto  = Number(r.presupuesto).toLocaleString('es-AR');
  const arreglo = r.arreglo || '';

  const tpls = (typeof WA_TEMPLATES !== 'undefined' && WA_TEMPLATES) || {};
  const tpl = tpls.repair_presupuesto ||
    'Hola {nombre}! 👋\nTe paso el presupuesto para tu *{equipo}* (Orden N°{nOrden}):\n\n🔧 Trabajo: {arreglo}\n💰 Presupuesto: *${monto}*\n\n¿Querés que lo hagamos? Cualquier consulta, avisá. 😊';

  const msg = tpl
    .replace(/{nombre}/g, nombre)
    .replace(/{equipo}/g,  equipo)
    .replace(/{nOrden}/g,  r.nOrden || '—')
    .replace(/{arreglo}/g, arreglo)
    .replace(/{monto}/g,   monto);

  logActivity({
    tipo: 'whatsapp',
    desc: `Presupuesto WA a ${r.nombre || r.tlf} — N°${r.nOrden} $${monto}`,
    repairId: id,
    extra: { nOrden: r.nOrden, presupuesto: r.presupuesto }
  });
  window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), '_blank');
}

// ── WhatsApp resumen pendientes ───────────
function sendPendingWA() {
  const sorted = [...REPAIRS]
    .sort((a, b) => (b.nOrden || 0) - (a.nOrden || 0))
    .slice(0, 100);

  const reparando = sorted.filter(r => r.estado === 'reparando');
  const listos    = sorted.filter(r => r.estado === 'listo');

  if (reparando.length === 0 && listos.length === 0) {
    toast('No hay equipos pendientes', 'info');
    return;
  }

  // Mostrar popup de selección
  closePendingMenu();
  const menu = document.createElement('div');
  menu.id = 'pending-wa-menu';
  menu.className = 'pending-wa-menu';
  menu.innerHTML = `
    <div class="pending-wa-title">Enviar por WhatsApp</div>
    ${reparando.length > 0 ? `<button class="pending-wa-opt" onclick="buildAndSendPendingWA('reparando');closePendingMenu()">🔧 En reparación <span class="pending-wa-cnt">${reparando.length}</span></button>` : ''}
    ${listos.length > 0 ? `<button class="pending-wa-opt" onclick="buildAndSendPendingWA('listo');closePendingMenu()">✅ Listos para retirar <span class="pending-wa-cnt">${listos.length}</span></button>` : ''}
    ${reparando.length > 0 && listos.length > 0 ? `<button class="pending-wa-opt" onclick="buildAndSendPendingWA('ambos');closePendingMenu()">📋 Todos los pendientes <span class="pending-wa-cnt">${reparando.length + listos.length}</span></button>` : ''}
  `;
  document.body.appendChild(menu);
  setTimeout(() => menu.classList.add('pending-wa-menu--show'), 10);
  setTimeout(() => document.addEventListener('click', closePendingMenu, { once: true }), 50);
}

function closePendingMenu() {
  const m = document.getElementById('pending-wa-menu');
  if (m) m.remove();
}

function buildAndSendPendingWA(tipo) {
  const sorted = [...REPAIRS]
    .sort((a, b) => (b.nOrden || 0) - (a.nOrden || 0))
    .slice(0, 100);

  const reparando = sorted.filter(r => r.estado === 'reparando');
  const listos    = sorted.filter(r => r.estado === 'listo');

  const fmtLine = r => {
    const partes = [`N°${r.nOrden || '?'}`, `${r.marca} ${r.modelo}`, r.arreglo].filter(Boolean);
    if (r.nombre) partes.push(r.nombre);
    return '• ' + partes.join(' | ');
  };

  let msg = '';
  const fecha = new Date().toLocaleDateString('es-AR');

  if (tipo === 'reparando') {
    msg = `🔧 *EN REPARACIÓN (${reparando.length})*\n_${fecha}_\n\n`;
    msg += reparando.map(fmtLine).join('\n');
  } else if (tipo === 'listo') {
    msg = `✅ *LISTOS PARA RETIRAR (${listos.length})*\n_${fecha}_\n\n`;
    msg += listos.map(fmtLine).join('\n');
  } else {
    msg = `📋 *EQUIPOS PENDIENTES*\n_${fecha}_`;
    if (reparando.length > 0) {
      msg += `\n\n🔧 *En reparación (${reparando.length})*\n`;
      msg += reparando.map(fmtLine).join('\n');
    }
    if (listos.length > 0) {
      msg += `\n\n✅ *Listos para retirar (${listos.length})*\n`;
      msg += listos.map(fmtLine).join('\n');
    }
    msg += `\n\n_Total: ${reparando.length + listos.length} equipos_`;
  }

  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
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

// ── Modal de actividad ────────────────────
let _actividadData = [];

async function openActividadModal() {
  document.getElementById('actividad-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('actividad-feed').innerHTML = '<div class="act-empty">Cargando...</div>';

  // Poblar filtro de técnicos
  const tecSel = document.getElementById('act-filter-tec');
  const tecOpts = ['<option value="">Todos los técnicos</option>'];
  STAFF.forEach(s => { tecOpts.push(`<option value="${s}">${s}</option>`); });
  tecSel.innerHTML = tecOpts.join('');

  try {
    const snap = await db.collection('actividad')
      .orderBy('fecha', 'desc')
      .limit(200)
      .get();
    _actividadData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderActividad();
  } catch (e) {
    document.getElementById('actividad-feed').innerHTML =
      '<div class="act-empty">Error al cargar actividad</div>';
  }
}

function closeActividadModal() {
  document.getElementById('actividad-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function renderActividad() {
  const tipoFil = document.getElementById('act-filter-tipo').value;
  const tecFil  = document.getElementById('act-filter-tec').value;

  const ICOS = {
    ingreso:  '📥', estado: '🔄', edicion: '✏️',
    whatsapp: '💬', venta:  '💰'
  };

  let items = _actividadData;
  if (tipoFil) items = items.filter(a => a.tipo === tipoFil);
  if (tecFil)  items = items.filter(a => a.tecnico === tecFil);

  if (!items.length) {
    document.getElementById('actividad-feed').innerHTML =
      '<div class="act-empty">Sin actividad para este filtro</div>';
    return;
  }

  document.getElementById('actividad-feed').innerHTML = items.map(a => {
    const ico   = ICOS[a.tipo] || '📌';
    const fecha = a.fecha ? new Date(a.fecha).toLocaleString('es-AR', {
      day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'
    }) : '';
    const tec = a.tecnico ? `<span class="act-tec">👤 ${a.tecnico}</span>` : '';
    return `
      <div class="act-item">
        <div class="act-ico act-ico--${a.tipo || ''}">${ico}</div>
        <div class="act-body">
          <div class="act-desc">${a.desc || '—'}</div>
          <div class="act-meta">${fecha}${tec}</div>
        </div>
      </div>`;
  }).join('');
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
      <div class="ss-card"><div class="ss-num">${reparando}</div><div class="ss-lbl">🔧 En reparación</div></div>
      <div class="ss-card ss-green"><div class="ss-num">${listo}</div><div class="ss-lbl">✅ Listos p/ retirar</div></div>
      <div class="ss-card ss-blue"><div class="ss-num">${mesTotal}</div><div class="ss-lbl">📥 Ingresados mes</div></div>
      <div class="ss-card ss-blue"><div class="ss-num">${mesEntregados}</div><div class="ss-lbl">📦 Entregados mes</div></div>
      <div class="ss-card ss-green"><div class="ss-num">$${mesIngreso.toLocaleString('es-AR')}</div><div class="ss-lbl">💰 Recaudado mes</div></div>
      ${mesGanancia > 0 ? `<div class="ss-card ss-green"><div class="ss-num">$${mesGanancia.toLocaleString('es-AR')}</div><div class="ss-lbl">📈 Ganancia mes</div></div>` : ''}
      ${mesSeñas > 0 ? `<div class="ss-card"><div class="ss-num">$${mesSeñas.toLocaleString('es-AR')}</div><div class="ss-lbl">🤝 Señas recibidas</div></div>` : ''}
      ${promedio > 0 ? `<div class="ss-card"><div class="ss-num">$${promedio.toLocaleString('es-AR')}</div><div class="ss-lbl">📊 Promedio por rep.</div></div>` : ''}
      ${demorados > 0 ? `<div class="ss-card" style="border-left:3px solid #ef4444"><div class="ss-num" style="color:#ef4444">${demorados}</div><div class="ss-lbl">⚠️ Demorados +3días</div></div>` : ''}
      ${garantiasMes > 0 ? `<div class="ss-card"><div class="ss-num">${garantiasMes}</div><div class="ss-lbl">🔄 Garantías mes</div></div>` : ''}
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
      <div class="ss-card ss-blue"><div class="ss-num">${yearTotal}</div><div class="ss-lbl">📋 Total año</div></div>
      <div class="ss-card ss-blue"><div class="ss-num">${yearEntregados}</div><div class="ss-lbl">📦 Entregados</div></div>
      <div class="ss-card ss-green"><div class="ss-num">$${yearIngreso.toLocaleString('es-AR')}</div><div class="ss-lbl">💰 Recaudado año</div></div>
      ${yearGanancia > 0 ? `<div class="ss-card ss-green"><div class="ss-num">$${yearGanancia.toLocaleString('es-AR')}</div><div class="ss-lbl">📈 Ganancia año</div></div>` : ''}
      ${avgMensual > 0 ? `<div class="ss-card"><div class="ss-num">${avgMensual}</div><div class="ss-lbl">📊 Promedio mensual</div></div>` : ''}
      ${garantiasYear > 0 ? `<div class="ss-card"><div class="ss-num">${garantiasYear}</div><div class="ss-lbl">🔄 Garantías año</div></div>` : ''}
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

// ══════════════════════════════════════════
//  PATRÓN DE DESBLOQUEO
// ══════════════════════════════════════════

let _patronDots     = [];   // secuencia de índices 0-8 dibujados
let _patronDrawing  = false;
const PATRON_COLS   = 3;
const PATRON_RADIUS = 18;   // radio del punto
const PATRON_SIZE   = 270;  // canvas px

function openPatronModal() {
  document.getElementById('patron-overlay').classList.remove('hidden');
  document.getElementById('patron-modal').classList.remove('hidden');
  resetPatronCanvas();
}

function closePatronModal() {
  document.getElementById('patron-overlay').classList.add('hidden');
  document.getElementById('patron-modal').classList.add('hidden');
}

function _patronDotCenters() {
  const step = PATRON_SIZE / PATRON_COLS;
  const off  = step / 2;
  const pts  = [];
  for (let r = 0; r < PATRON_COLS; r++) {
    for (let c = 0; c < PATRON_COLS; c++) {
      pts.push({ x: off + c * step, y: off + r * step });
    }
  }
  return pts;
}

function _patronHitDot(px, py) {
  const pts = _patronDotCenters();
  for (let i = 0; i < pts.length; i++) {
    const dx = px - pts[i].x, dy = py - pts[i].y;
    if (Math.sqrt(dx * dx + dy * dy) <= PATRON_RADIUS + 8) return i;
  }
  return -1;
}

function drawPatronGrid(curX, curY) {
  const canvas = document.getElementById('patron-canvas');
  if (!canvas) return;
  const ctx  = canvas.getContext('2d');
  const pts  = _patronDotCenters();
  ctx.clearRect(0, 0, PATRON_SIZE, PATRON_SIZE);

  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, PATRON_SIZE, PATRON_SIZE);

  // Lines connecting selected dots
  if (_patronDots.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.moveTo(pts[_patronDots[0]].x, pts[_patronDots[0]].y);
    for (let i = 1; i < _patronDots.length; i++) {
      ctx.lineTo(pts[_patronDots[i]].x, pts[_patronDots[i]].y);
    }
    ctx.stroke();
  }

  // Line to cursor while drawing
  if (_patronDrawing && _patronDots.length > 0 && curX !== undefined) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(99,102,241,0.5)';
    ctx.lineWidth   = 2;
    const last = pts[_patronDots[_patronDots.length - 1]];
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(curX, curY);
    ctx.stroke();
  }

  // Draw dots
  pts.forEach((p, i) => {
    const selected = _patronDots.includes(i);
    // Outer ring
    ctx.beginPath();
    ctx.arc(p.x, p.y, PATRON_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = selected ? '#6366f1' : '#334155';
    ctx.lineWidth   = 2;
    ctx.stroke();
    // Fill
    ctx.beginPath();
    ctx.arc(p.x, p.y, selected ? 10 : 6, 0, Math.PI * 2);
    ctx.fillStyle = selected ? '#818cf8' : '#475569';
    ctx.fill();
  });
}

function _patronPos(e) {
  const canvas = document.getElementById('patron-canvas');
  const rect   = canvas.getBoundingClientRect();
  const scaleX = PATRON_SIZE / rect.width;
  const scaleY = PATRON_SIZE / rect.height;
  const src    = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top)  * scaleY
  };
}

function initPatronCanvas() {
  const canvas = document.getElementById('patron-canvas');
  if (!canvas || canvas._patronInited) return;
  canvas._patronInited = true;

  const start = e => {
    e.preventDefault();
    _patronDrawing = true;
    _patronDots    = [];
    const { x, y } = _patronPos(e);
    const hit = _patronHitDot(x, y);
    if (hit >= 0) _patronDots.push(hit);
    drawPatronGrid(x, y);
  };

  const move = e => {
    e.preventDefault();
    if (!_patronDrawing) return;
    const { x, y } = _patronPos(e);
    const hit = _patronHitDot(x, y);
    if (hit >= 0 && !_patronDots.includes(hit)) _patronDots.push(hit);
    drawPatronGrid(x, y);
  };

  const end = e => {
    e.preventDefault();
    _patronDrawing = false;
    drawPatronGrid();
  };

  canvas.addEventListener('mousedown',  start, { passive: false });
  canvas.addEventListener('mousemove',  move,  { passive: false });
  canvas.addEventListener('mouseup',    end,   { passive: false });
  canvas.addEventListener('mouseleave', end,   { passive: false });
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove',  move,  { passive: false });
  canvas.addEventListener('touchend',   end,   { passive: false });

  drawPatronGrid();
}

function resetPatronCanvas() {
  _patronDots    = [];
  _patronDrawing = false;
  initPatronCanvas();
  drawPatronGrid();
}

function generatePatronSVG(dots) {
  const step = 90;
  const off  = 45;
  const size = 270;

  const positions = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      positions.push({ x: off + c * step, y: off + r * step });
    }
  }

  let lines = '';
  for (let i = 1; i < dots.length; i++) {
    const a = positions[dots[i - 1]];
    const b = positions[dots[i]];
    lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#6366f1" stroke-width="4" stroke-linecap="round"/>`;
  }

  let circles = '';
  positions.forEach((p, i) => {
    const sel = dots.includes(i);
    circles += `<circle cx="${p.x}" cy="${p.y}" r="14" fill="none" stroke="${sel ? '#6366f1' : '#334155'}" stroke-width="2"/>`;
    circles += `<circle cx="${p.x}" cy="${p.y}" r="${sel ? 8 : 5}" fill="${sel ? '#818cf8' : '#475569'}"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="background:#0f172a;border-radius:10px">${lines}${circles}</svg>`;
}

function savePatron() {
  if (_patronDots.length < 4) {
    toast('Conectá al menos 4 puntos', 'error');
    return;
  }
  const svg = generatePatronSVG(_patronDots);
  window._currentPatronDots = [..._patronDots];
  window._currentPatronImg  = svg;

  const prev = document.getElementById('patron-preview');
  prev.innerHTML     = svg;
  prev.style.display = '';
  document.getElementById('btn-patron-clear').style.display = '';

  closePatronModal();
  toast('Patrón guardado', 'success');
}

function clearPatronForm() {
  window._currentPatronDots = null;
  window._currentPatronImg  = null;
  const prev = document.getElementById('patron-preview');
  prev.innerHTML     = '';
  prev.style.display = 'none';
  document.getElementById('btn-patron-clear').style.display = 'none';
}

// Inicializar canvas cuando se abre el modal
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('patron-overlay');
  if (overlay) {
    const obs = new MutationObserver(() => {
      if (!document.getElementById('patron-modal').classList.contains('hidden')) {
        initPatronCanvas();
      }
    });
    obs.observe(document.getElementById('patron-modal'), { attributes: true, attributeFilter: ['class'] });
  }
});

async function quickStatusChange(e, id, newStatus) {
  e.stopPropagation();

  // Al marcar como "listo", preguntar qué repuesto se usó
  if (newStatus === 'listo') {
    openRepUsoModal(async (repuestoId) => {
      await _doStatusChange(id, newStatus);
      if (repuestoId && typeof REPUESTOS !== 'undefined') {
        const rep = REPUESTOS.find(x => x.id === repuestoId);
        if (rep) {
          const nueva = Math.max(0, (rep.cantidad || 0) - 1);
          Promise.all([
            db.collection('repuestos').doc(repuestoId).update({ cantidad: nueva }),
            db.collection('repairs').doc(id).update({ costoRepuesto: rep.precioCompra || 0 })
          ])
            .then(() => toast(`🔩 −1 ${rep.nombre}`, 'success'))
            .catch(() => toast('Error al descontar repuesto', 'error'));
        }
      }
    });
    return;
  }

  await _doStatusChange(id, newStatus);
}

async function _doStatusChange(id, newStatus) {
  const update = { estado: newStatus };
  if (newStatus === 'entregado') update.fechaEntrega = new Date().toISOString();
  try {
    await db.collection('repairs').doc(id).update(update);
    toast('→ ' + (REPAIR_STATES[newStatus]?.label || newStatus), 'success');
    // WA auto-notify on entregado
    if (newStatus === 'entregado') {
      const r = REPAIRS.find(x => x.id === id);
      if (r) triggerWaNotify('entregado', r);
    }
  } catch (err) {
    toast('Error al actualizar', 'error');
  }
}

// ── Modal: Repuesto Usado ────────────────────
let _repUsoCallback   = null;
let _repUsoSelectedId = null;

function openRepUsoModal(callback) {
  _repUsoCallback   = callback;
  _repUsoSelectedId = null;
  const searchEl = document.getElementById('rep-uso-search');
  if (searchEl) searchEl.value = '';
  const selEl = document.getElementById('rep-uso-selected');
  if (selEl) selEl.classList.add('hidden');
  const confirmBtn = document.getElementById('rep-uso-confirm-btn');
  if (confirmBtn) confirmBtn.disabled = true;
  renderRepUsoList();
  document.getElementById('rep-uso-overlay').classList.remove('hidden');
  document.getElementById('rep-uso-modal').classList.remove('hidden');
  setTimeout(() => { if (searchEl) searchEl.focus(); }, 100);
}

function closeRepUsoModal() {
  document.getElementById('rep-uso-overlay').classList.add('hidden');
  document.getElementById('rep-uso-modal').classList.add('hidden');
  _repUsoCallback   = null;
  _repUsoSelectedId = null;
}

function renderRepUsoList() {
  const q    = (document.getElementById('rep-uso-search').value || '').trim().toLowerCase();
  const list = document.getElementById('rep-uso-list');
  if (!list) return;
  if (typeof REPUESTOS === 'undefined' || !REPUESTOS.length) {
    list.innerHTML = '<p class="rep-uso-empty">Sin repuestos cargados</p>';
    return;
  }
  let items = REPUESTOS;
  if (q) {
    items = items.filter(r =>
      [r.nombre, r.marca, r.modelo, r.tipo]
        .map(x => (x || '').toLowerCase()).join(' ').includes(q)
    );
  }
  if (!items.length) {
    list.innerHTML = '<p class="rep-uso-empty">Sin resultados</p>';
    return;
  }
  list.innerHTML = items.slice(0, 20).map(r => {
    const sel = r.id === _repUsoSelectedId ? ' rep-uso-item--sel' : '';
    return `<div class="rep-uso-item${sel}" onclick="selectRepUsoItem('${r.id}')">
      <span class="rep-uso-name">${esc(r.nombre)}</span>
      <span class="rep-uso-meta">${esc(r.marca || '')}${r.modelo ? ' · ' + esc(r.modelo) : ''} <b>· Stock: ${r.cantidad ?? 0}</b></span>
    </div>`;
  }).join('');
}

function selectRepUsoItem(id) {
  _repUsoSelectedId = id;
  const r = typeof REPUESTOS !== 'undefined' && REPUESTOS.find(x => x.id === id);
  if (r) {
    const selEl = document.getElementById('rep-uso-selected');
    selEl.textContent = `✔ ${r.nombre} (${r.marca || ''}) — Stock actual: ${r.cantidad ?? 0}`;
    selEl.classList.remove('hidden');
  }
  const confirmBtn = document.getElementById('rep-uso-confirm-btn');
  if (confirmBtn) confirmBtn.disabled = false;
  renderRepUsoList();
}

function confirmRepUso() {
  if (_repUsoCallback) _repUsoCallback(_repUsoSelectedId);
  closeRepUsoModal();
}

function skipRepUso() {
  if (_repUsoCallback) _repUsoCallback(null);
  closeRepUsoModal();
}

// ── Nota rápida ────────────────────────────
let _notaCurrentId = null;

function openNotaModal(id) {
  _notaCurrentId = id;
  const r = REPAIRS.find(x => x.id === id);
  const input = document.getElementById('nota-input');
  input.value = r?.notaRapida || '';
  updateNotaChars();
  document.getElementById('nota-overlay').classList.remove('hidden');
  document.getElementById('nota-modal').classList.remove('hidden');
  setTimeout(() => input.focus(), 100);
}

function closeNotaModal() {
  document.getElementById('nota-overlay').classList.add('hidden');
  document.getElementById('nota-modal').classList.add('hidden');
  _notaCurrentId = null;
}

function updateNotaChars() {
  const v = document.getElementById('nota-input').value.length;
  document.getElementById('nota-chars-left').textContent = 200 - v;
}

async function saveNota() {
  if (!_notaCurrentId) return;
  const val = document.getElementById('nota-input').value.trim();
  try {
    await db.collection('repairs').doc(_notaCurrentId).update({ notaRapida: val || null });
    toast(val ? '📝 Nota guardada' : '🗑 Nota eliminada', 'success');
    closeNotaModal();
  } catch { toast('Error al guardar nota', 'error'); }
}

async function clearNota() {
  document.getElementById('nota-input').value = '';
  updateNotaChars();
  await saveNota();
}

// ── WhatsApp notificaciones automáticas ────
function _getWaNum() {
  // Firestore tiene prioridad; localStorage como caché local
  return window._waNotifyNum || localStorage.getItem('tp_wa_notify') || '';
}

async function loadWaNotifyNumber() {
  try {
    const doc = await db.collection('config').doc('settings').get();
    const num = doc.exists ? (doc.data().waNotify || '') : '';
    if (num) {
      window._waNotifyNum = num;
      localStorage.setItem('tp_wa_notify', num); // caché local
    }
  } catch {}
  updateWaNotifyStatus();
}

function triggerWaNotify(tipo, r) {
  const waNum = _getWaNum();
  if (!waNum) return;
  let msg = '';
  if (tipo === 'entregado') {
    msg = `✅ *EQUIPO ENTREGADO*\n📱 ${r.marca} ${r.modelo} (N°${r.nOrden})\n🔧 ${r.arreglo || ''}\n👤 ${r.nombre || '—'}\n💰 $${(r.monto||0).toLocaleString('es-AR')}`;
  } else if (tipo === 'ingreso') {
    msg = `📥 *NUEVO INGRESO*\n📱 ${r.marca} ${r.modelo} (N°${r.nOrden})\n🔧 ${r.arreglo || ''}\n👤 ${r.nombre || '—'}\n💰 $${(r.monto||0).toLocaleString('es-AR')}`;
  }
  const url = `https://wa.me/${waNum.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

function setWaNotifyNumber() {
  const current = _getWaNum();
  const num = prompt('Número para notificaciones WhatsApp\n(con código de país, ej: 5491112345678)\nDejá vacío para desactivar:', current);
  if (num === null) return;
  const trimmed = num.trim();
  if (trimmed) {
    window._waNotifyNum = trimmed;
    localStorage.setItem('tp_wa_notify', trimmed);
    // Guardar en Firestore para que no se pierda nunca
    db.collection('config').doc('settings').set({ waNotify: trimmed }, { merge: true })
      .then(() => toast('✅ Número guardado permanentemente', 'success'))
      .catch(() => toast('✅ Número configurado (sin sincronizar)', 'success'));
  } else {
    window._waNotifyNum = '';
    localStorage.removeItem('tp_wa_notify');
    db.collection('config').doc('settings').set({ waNotify: '' }, { merge: true }).catch(() => {});
    toast('🔕 Notificaciones desactivadas', 'success');
  }
  updateWaNotifyStatus();
}

function updateWaNotifyStatus() {
  const el = document.getElementById('wa-notify-status');
  if (!el) return;
  const num = localStorage.getItem('tp_wa_notify');
  el.textContent = num ? `✅ Activo: +${num}` : '🔕 No configurado';
  el.style.color = num ? '#10b981' : '#94a3b8';
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

// ── IA Reparaciones ──────────────────────
async function aiRepairDiagnosis() {
  const marca    = (document.getElementById('rep-fi-marca').value    || '').trim();
  const modelo   = (document.getElementById('rep-fi-modelo').value   || '').trim();
  const arreglo  = document.getElementById('rep-fi-arreglo').value === 'Otro'
    ? document.getElementById('rep-fi-arreglo-custom').value
    : document.getElementById('rep-fi-arreglo').value;
  const condicion = (document.getElementById('rep-fi-condicion').value || '').trim();
  const problema  = [arreglo, condicion].filter(Boolean).join('. ');

  if (!marca || !modelo)  { toast('Completá marca y modelo primero', 'error'); return; }
  if (!problema)          { toast('Seleccioná el tipo de arreglo', 'error'); return; }

  try {
    const text = await callAI('diagnosis', { marca, modelo, problema });
    showAiResult(text);
  } catch {}
}

async function aiRepairTimePrice() {
  const marca   = (document.getElementById('rep-fi-marca').value   || '').trim();
  const modelo  = (document.getElementById('rep-fi-modelo').value  || '').trim();
  const arreglo = document.getElementById('rep-fi-arreglo').value === 'Otro'
    ? document.getElementById('rep-fi-arreglo-custom').value
    : document.getElementById('rep-fi-arreglo').value;

  if (!marca || !modelo || !arreglo) {
    toast('Completá marca, modelo y tipo de arreglo', 'error'); return;
  }

  try {
    const text = await callAI('timePrice', { marca, modelo, arreglo });
    showAiResult(text, [{
      label: '💰 Usar precio mínimo',
      fn: `(function(){const m=document.getElementById('ai-result').innerText.match(/[\d]+\.?[\d]*/g);if(m){const nums=m.map(n=>parseInt(n.replace(/\./g,'')));const mn=Math.min(...nums.filter(n=>n>500));if(mn)document.getElementById('rep-fi-monto').value=mn;}closeAiPanel();})()`
    }]);
  } catch {}
}

async function aiRepairWaMessage(id) {
  const r = REPAIRS.find(x => x.id === id);
  if (!r) return;
  try {
    const text = await callAI('waMessage', {
      nombre:  r.nombre  || 'cliente',
      marca:   r.marca   || '',
      modelo:  r.modelo  || '',
      estado:  (typeof REPAIR_STATES !== 'undefined' && REPAIR_STATES[r.estado])
                 ? REPAIR_STATES[r.estado].label : r.estado,
      arreglo: r.arreglo || '',
      nOrden:  r.nOrden  || ''
    });
    showAiResult(text, [{
      label: '📲 Enviar por WhatsApp',
      fn: `repairWhatsAppText('${id}', document.getElementById('ai-result').innerText);closeAiPanel()`
    }]);
  } catch {}
}

function repairWhatsAppText(id, msg) {
  const r = REPAIRS.find(x => x.id === id);
  if (!r || !r.tlf) { toast('No hay teléfono registrado', 'error'); return; }
  let phone = String(r.tlf).replace(/\D/g, '');
  if (phone.length === 10)                            phone = '549' + phone;
  else if (phone.length === 11 && phone.startsWith('0')) phone = '54' + phone.slice(1);
  else if (!phone.startsWith('54'))                   phone = '549' + phone;
  window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), '_blank');
}

// ── Gestión de marcas personalizadas ──────
let _customMarcas = [];

async function loadCustomMarcas() {
  try {
    const doc = await db.collection('config').doc('marcas').get();
    _customMarcas = doc.exists ? (doc.data().lista || []) : [];
    applyMarcasToDatalists();
  } catch {}
}

function applyMarcasToDatalists() {
  ['rep-dl-marca', 'dl-marca'].forEach(id => {
    const dl = document.getElementById(id);
    if (!dl) return;
    [...dl.querySelectorAll('[data-custom]')].forEach(o => o.remove());
    _customMarcas.forEach(m => {
      const o = document.createElement('option');
      o.value = m; o.dataset.custom = '1';
      dl.appendChild(o);
    });
  });
}

function openAddMarcaModal() {
  document.getElementById('add-marca-modal').classList.remove('hidden');
  document.getElementById('new-marca-input').value = '';
  renderMarcasGuardadas();
  setTimeout(() => document.getElementById('new-marca-input').focus(), 100);
}

function closeAddMarcaModal() {
  document.getElementById('add-marca-modal').classList.add('hidden');
}

function renderMarcasGuardadas() {
  const cont = document.getElementById('marcas-guardadas');
  if (!_customMarcas.length) {
    cont.innerHTML = '<span style="color:#94a3b8;font-size:.75rem">Sin marcas personalizadas aún</span>';
    return;
  }
  cont.innerHTML = _customMarcas.map((m, i) =>
    `<span class="marca-chip">${m}<button onclick="deleteMarca(${i})" title="Eliminar">✕</button></span>`
  ).join('');
}

async function saveNewMarca() {
  const val = (document.getElementById('new-marca-input').value || '').trim();
  if (!val) { toast('Escribí el nombre de la marca', 'error'); return; }
  if (_customMarcas.map(m => m.toLowerCase()).includes(val.toLowerCase())) {
    toast('Esa marca ya existe', 'error'); return;
  }
  _customMarcas.push(val);
  await db.collection('config').doc('marcas').set({ lista: _customMarcas });
  applyMarcasToDatalists();
  document.getElementById('new-marca-input').value = '';
  renderMarcasGuardadas();
  toast(`Marca "${val}" guardada ✅`, 'success');
}

async function deleteMarca(idx) {
  _customMarcas.splice(idx, 1);
  await db.collection('config').doc('marcas').set({ lista: _customMarcas });
  applyMarcasToDatalists();
  renderMarcasGuardadas();
  toast('Marca eliminada', 'success');
}
