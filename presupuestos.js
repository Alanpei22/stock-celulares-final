// ══════════════════════════════════════════
//  PRESUPUESTOS
// ══════════════════════════════════════════

let PRESUPUESTOS = [];
let editingPresId = null;
let presRenderTimer;

// ── Firebase ──────────────────────────────
function listenPresupuestos() {
  db.collection('presupuestos').onSnapshot(snap => {
    PRESUPUESTOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    PRESUPUESTOS.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    renderPresupuestos();
  }, err => {
    console.error('Presupuestos:', err);
    toast('Error cargando presupuestos', 'error');
  });
}

// ── Init ──────────────────────────────────
function initPresupuestos() {
  document.getElementById('pres-add-btn').addEventListener('click', () => openPresForm());
  document.getElementById('pres-search').addEventListener('input', () => {
    clearTimeout(presRenderTimer);
    presRenderTimer = setTimeout(renderPresupuestos, 60);
  });
  document.getElementById('pres-f-estado').addEventListener('change', renderPresupuestos);
  document.getElementById('pres-form-close').addEventListener('click', closePresForm);
  document.getElementById('pres-form-cancel').addEventListener('click', closePresForm);
  document.getElementById('pres-form-save').addEventListener('click', savePres);
  document.getElementById('pres-delete-wrap') && document.getElementById('pres-delete-btn').addEventListener('click', () => deletePres(editingPresId));
  document.getElementById('pres-form-modal').addEventListener('click', e => {
    if (e.target.id === 'pres-form-modal') closePresForm();
  });
  listenPresupuestos();
}

// ── Render ────────────────────────────────
function renderPresupuestos() {
  const q       = (document.getElementById('pres-search').value || '').trim().toLowerCase();
  const fEstado = document.getElementById('pres-f-estado').value;

  let filtered = PRESUPUESTOS.filter(p => {
    if (fEstado && p.estado !== fEstado) return false;
    if (q) {
      const hay = [p.nombre, p.marca, p.modelo, p.problema, p.tlf]
        .map(x => String(x || '')).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Stats
  document.getElementById('prs-total').textContent     = PRESUPUESTOS.length;
  document.getElementById('prs-pendiente').textContent = PRESUPUESTOS.filter(p => p.estado === 'pendiente').length;
  document.getElementById('prs-aceptado').textContent  = PRESUPUESTOS.filter(p => p.estado === 'aceptado').length;

  const listEl  = document.getElementById('pres-list');
  const emptyEl = document.getElementById('pres-empty');

  if (!filtered.length) {
    listEl.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  const ESTADO_CFG = {
    pendiente:  { label: 'Pendiente',  cls: 'pres-badge--pendiente'  },
    aceptado:   { label: 'Aceptado ✓', cls: 'pres-badge--aceptado'   },
    rechazado:  { label: 'Rechazado',  cls: 'pres-badge--rechazado'  },
    expirado:   { label: 'Expirado',   cls: 'pres-badge--expirado'   },
  };

  listEl.innerHTML = filtered.map(p => {
    const est = ESTADO_CFG[p.estado] || { label: p.estado, cls: '' };
    const precio = p.precio ? '$ ' + Number(p.precio).toLocaleString('es-AR') : '—';
    const fecha  = p.createdAt
      ? new Date(p.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
      : '';
    const isAcep = p.estado === 'aceptado';

    return `
      <div class="card pres-card pres-card--${p.estado || 'pendiente'}" onclick="openPresForm('${p.id}')">
        <div class="card-top">
          <div class="card-info">
            <span class="card-marca">📋 ${esc(p.marca || '—')} ${esc(p.modelo || '')}</span>
            <span class="card-modelo">${esc(p.nombre || '—')}</span>
            <span class="card-specs">🔧 ${esc(p.problema || '')}</span>
          </div>
          <div class="card-right">
            <span class="badge ${est.cls}">${est.label}</span>
          </div>
        </div>
        <div class="card-bottom">
          <span class="card-price">${precio}</span>
          <div class="card-meta">
            ${p.tlf ? `<span class="card-imei">📞 ${esc(p.tlf)}</span>` : ''}
            ${fecha ? `<span class="card-date">📅 ${fecha}</span>` : ''}
          </div>
        </div>
        <div class="card-quick-actions" onclick="event.stopPropagation()">
          ${p.tlf ? `<button class="card-chip chip-wa" onclick="enviarPresWA('${p.id}')">📲 Enviar WA</button>` : ''}
          ${isAcep ? `<button class="card-chip chip-listo" onclick="convertirAOrden('${p.id}')">→ Crear Orden</button>` : ''}
          ${p.estado === 'pendiente' ? `<button class="card-chip chip-entregado" onclick="cambiarEstadoPres('${p.id}','aceptado')">✓ Aceptado</button>` : ''}
          ${p.estado === 'pendiente' ? `<button class="card-chip chip-cancelado" onclick="cambiarEstadoPres('${p.id}','rechazado')">✗ Rechazado</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ── WhatsApp ──────────────────────────────
function enviarPresWA(id) {
  const p = PRESUPUESTOS.find(x => x.id === id);
  if (!p || !p.tlf) return;

  const precio = p.precio ? '$ ' + Number(p.precio).toLocaleString('es-AR') : 'A consultar';
  const validez = p.validez ? `📅 Válido por ${p.validez} días` : '';
  const detalle = p.detalle ? `\n📝 ${p.detalle}` : '';

  const msg = `Hola ${p.nombre || ''}! 👋\n\nTe enviamos el presupuesto para tu *${p.marca || ''} ${p.modelo || ''}*:\n\n🔧 Trabajo: ${p.problema || ''}${detalle}\n💰 Precio: *${precio}*\n${validez}\n\nPara confirmar respondé este mensaje 🙌\n\n_TechPoint_`;

  const num = p.tlf.replace(/\D/g, '');
  const link = `https://wa.me/${num.startsWith('54') ? num : '54' + num}?text=${encodeURIComponent(msg)}`;
  window.open(link, '_blank');
}

// ── Convertir a orden ─────────────────────
function convertirAOrden(id) {
  const p = PRESUPUESTOS.find(x => x.id === id);
  if (!p) return;
  // Pre-fill repair form with presupuesto data
  closePresSection();  // hide presupuestos, go to repairs
  switchSection('repairs');
  setTimeout(() => {
    openRepairForm();
    setTimeout(() => {
      document.getElementById('rep-fi-nombre').value  = p.nombre  || '';
      document.getElementById('rep-fi-tlf').value     = p.tlf     || '';
      document.getElementById('rep-fi-marca').value   = p.marca   || '';
      document.getElementById('rep-fi-modelo').value  = p.modelo  || '';
      // Try to match arreglo
      const arregloSel = document.getElementById('rep-fi-arreglo');
      if (arregloSel) arregloSel.value = 'Módulo / Pantalla'; // default
      document.getElementById('rep-fi-monto').value   = p.precio  || '';
      if (p.detalle || p.problema) {
        const obsEl = document.getElementById('rep-fi-observaciones');
        if (obsEl) obsEl.value = [p.problema, p.detalle].filter(Boolean).join(' — ');
      }
      toast('📋 Datos del presupuesto cargados', 'success');
    }, 400);
  }, 200);
}

function closePresSection() {
  document.getElementById('pres-form-modal').classList.add('hidden');
}

async function cambiarEstadoPres(id, estado) {
  await db.collection('presupuestos').doc(id).update({ estado })
    .then(() => toast('Estado actualizado', 'success'))
    .catch(() => toast('Error', 'error'));
}

// ── Formulario ────────────────────────────
function openPresForm(id) {
  editingPresId = id || null;
  const title   = document.getElementById('pres-form-title');
  const delWrap = document.getElementById('pres-delete-wrap');

  if (id) {
    const p = PRESUPUESTOS.find(x => x.id === id);
    if (!p) return;
    title.textContent = '✏️ Editar Presupuesto';
    delWrap.style.display = '';
    document.getElementById('pres-fi-nombre').value   = p.nombre   || '';
    document.getElementById('pres-fi-tlf').value      = p.tlf      || '';
    document.getElementById('pres-fi-marca').value    = p.marca    || '';
    document.getElementById('pres-fi-modelo').value   = p.modelo   || '';
    document.getElementById('pres-fi-problema').value = p.problema || '';
    document.getElementById('pres-fi-detalle').value  = p.detalle  || '';
    document.getElementById('pres-fi-precio').value   = p.precio   ?? '';
    document.getElementById('pres-fi-validez').value  = p.validez  || '15';
    document.getElementById('pres-fi-estado').value   = p.estado   || 'pendiente';
    document.getElementById('pres-fi-notas').value    = p.notas    || '';
  } else {
    title.textContent = '📋 Nuevo Presupuesto';
    delWrap.style.display = 'none';
    ['pres-fi-nombre','pres-fi-tlf','pres-fi-marca','pres-fi-modelo',
     'pres-fi-problema','pres-fi-detalle','pres-fi-precio','pres-fi-notas']
      .forEach(i => { document.getElementById(i).value = ''; });
    document.getElementById('pres-fi-validez').value = '15';
    document.getElementById('pres-fi-estado').value  = 'pendiente';
  }

  document.getElementById('pres-form-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('pres-fi-nombre').focus(), 300);
}

function closePresForm() {
  document.getElementById('pres-form-modal').classList.add('hidden');
  document.body.style.overflow = '';
  editingPresId = null;
}

function savePres() {
  const nombre   = document.getElementById('pres-fi-nombre').value.trim();
  const tlf      = document.getElementById('pres-fi-tlf').value.trim();
  const marca    = document.getElementById('pres-fi-marca').value.trim();
  const modelo   = document.getElementById('pres-fi-modelo').value.trim();
  const problema = document.getElementById('pres-fi-problema').value.trim();
  const detalle  = document.getElementById('pres-fi-detalle').value.trim();
  const precio   = parseFloat(document.getElementById('pres-fi-precio').value) || 0;
  const validez  = parseInt(document.getElementById('pres-fi-validez').value) || 15;
  const estado   = document.getElementById('pres-fi-estado').value || 'pendiente';
  const notas    = document.getElementById('pres-fi-notas').value.trim();

  if (!nombre)   { toast('Ingresá el nombre del cliente', 'error'); return; }
  if (!problema) { toast('Describí el trabajo a realizar', 'error'); return; }

  const data = { nombre, tlf, marca, modelo, problema, detalle, precio, validez, estado, notas };

  if (editingPresId) {
    db.collection('presupuestos').doc(editingPresId).update(data)
      .then(() => { toast('Presupuesto actualizado ✅', 'success'); closePresForm(); })
      .catch(() => toast('Error al guardar', 'error'));
  } else {
    const ref = db.collection('presupuestos').doc();
    ref.set({ id: ref.id, ...data, createdAt: new Date().toISOString() })
      .then(() => {
        toast('Presupuesto creado ✅', 'success');
        closePresForm();
        // Auto-send WA if has phone
        if (tlf) setTimeout(() => enviarPresWA(ref.id), 600);
      })
      .catch(() => toast('Error al guardar', 'error'));
  }
}

function deletePres(id) {
  if (!id) return;
  if (!confirm('¿Eliminar este presupuesto?')) return;
  db.collection('presupuestos').doc(id).delete()
    .then(() => { toast('Presupuesto eliminado', 'success'); closePresForm(); })
    .catch(() => toast('Error al eliminar', 'error'));
}
