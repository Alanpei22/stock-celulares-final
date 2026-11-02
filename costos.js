// ══════════════════════════════════════════════════════
//  EDITOR MASIVO DE COSTOS — celulares, repuestos y accesorios
//  Planilla para cargar el precio de costo de todo de corrido.
//  Celulares → stock.costo · Repuestos/Accesorios → repuestos.precioCompra
// ══════════════════════════════════════════════════════

let costosRows    = [];   // filas armadas al abrir
let costosDirty   = {};   // key → valor nuevo (número)
let costosInited  = false;
let costosTimer;

function costosEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function costosFmt(n) { return '$ ' + Math.round(n).toLocaleString('es-AR'); }

function initCostos() {
  if (costosInited) return;
  costosInited = true;
  document.getElementById('costos-close').addEventListener('click', closeCostos);
  document.getElementById('costos-cancel').addEventListener('click', closeCostos);
  document.getElementById('costos-save').addEventListener('click', saveCostos);
  document.getElementById('costos-modal').addEventListener('click', e => {
    if (e.target.id === 'costos-modal') closeCostos();
  });
  document.getElementById('costos-search').addEventListener('input', () => {
    clearTimeout(costosTimer);
    costosTimer = setTimeout(renderCostos, 80);
  });
  document.getElementById('costos-f-cat').addEventListener('change', renderCostos);
  document.getElementById('costos-f-sin').addEventListener('change', renderCostos);

  const list = document.getElementById('costos-list');
  list.addEventListener('input', e => {
    const inp = e.target.closest('.costos-inp');
    if (!inp) return;
    const row = costosRows.find(r => r.key === inp.dataset.key);
    if (!row) return;
    const raw = inp.value.trim();
    const val = raw === '' ? 0 : Math.max(0, parseFloat(raw.replace(',', '.')) || 0);
    if (val === (row.costo || 0)) delete costosDirty[row.key];
    else costosDirty[row.key] = val;
    inp.classList.toggle('costos-inp--dirty', row.key in costosDirty);
    updateCostosMargin(inp.closest('.costos-row'), row, val);
    updateCostosSaveBtn();
  });
  // Enter / flecha abajo → siguiente producto; flecha arriba → anterior
  list.addEventListener('keydown', e => {
    const inp = e.target.closest('.costos-inp');
    if (!inp) return;
    let dir = 0;
    if (e.key === 'Enter' || e.key === 'ArrowDown') dir = 1;
    else if (e.key === 'ArrowUp') dir = -1;
    if (!dir) return;
    e.preventDefault();
    const all = [...list.querySelectorAll('.costos-inp')];
    const next = all[all.indexOf(inp) + dir];
    if (next) { next.focus(); next.select(); }
    else if (dir === 1) inp.blur();
  });
}

function buildCostosRows() {
  const rows = [];
  (typeof STOCK !== 'undefined' ? STOCK : []).forEach(p => {
    if (p.vendido) return;
    const extra = [p.almacenamiento, p.estado].filter(Boolean).join(' · ');
    rows.push({
      key: 'stock/' + p.id, col: 'stock', id: p.id, field: 'costo',
      cat: 'celular', catLbl: '📱 Celular',
      nombre: `${p.marca || ''} ${p.modelo || ''}`.trim(),
      sub: extra + (p.imei ? (extra ? ' · ' : '') + 'IMEI …' + String(p.imei).slice(-4) : ''),
      venta: p.precio || 0,
      costo: p.costo || 0,
    });
  });
  (typeof REPUESTOS !== 'undefined' ? REPUESTOS : []).forEach(r => {
    const esAcc = r.tipo === 'Accesorio';
    rows.push({
      key: 'repuestos/' + r.id, col: 'repuestos', id: r.id, field: 'precioCompra',
      cat: esAcc ? 'accesorio' : 'repuesto',
      catLbl: esAcc ? '🎧 Accesorio' : '🔩 ' + (r.tipo || 'Repuesto'),
      nombre: r.nombre || '',
      sub: [r.marca, r.modelo, r.cantidad != null ? `Cant: ${r.cantidad}` : ''].filter(Boolean).join(' · '),
      venta: 0,
      costo: r.precioCompra || 0,
    });
  });
  const order = { celular: 0, repuesto: 1, accesorio: 2 };
  rows.sort((a, b) => order[a.cat] - order[b.cat] || a.nombre.localeCompare(b.nombre));
  return rows;
}

function openCostos() {
  if (typeof OWNER_MODE !== 'undefined' && !OWNER_MODE) {
    toast('Activá el modo dueño 🔒 para ver los costos', 'error');
    return;
  }
  initCostos();
  costosRows  = buildCostosRows();
  costosDirty = {};
  document.getElementById('costos-search').value = '';
  updateCostosSaveBtn();
  renderCostos();
  document.getElementById('costos-modal').classList.remove('hidden');
}

function closeCostos() {
  const n = Object.keys(costosDirty).length;
  if (n && !confirm(`Tenés ${n} costo(s) sin guardar. ¿Salir igual?`)) return;
  costosDirty = {};
  document.getElementById('costos-modal').classList.add('hidden');
}

function costoActual(row) {
  return row.key in costosDirty ? costosDirty[row.key] : (row.costo || 0);
}

function renderCostos() {
  const q   = document.getElementById('costos-search').value.trim().toLowerCase();
  const cat = document.getElementById('costos-f-cat').value;
  const sin = document.getElementById('costos-f-sin').checked;

  const visibles = costosRows.filter(r => {
    if (cat && r.cat !== cat) return false;
    // "Sin costo" mira el valor guardado, así la fila no desaparece mientras escribís
    if (sin && r.costo > 0) return false;
    if (q && !(r.nombre + ' ' + r.sub + ' ' + r.catLbl).toLowerCase().includes(q)) return false;
    return true;
  });

  const faltan = costosRows.filter(r => !costoActual(r)).length;
  document.getElementById('costos-summary').textContent =
    `${costosRows.length} productos · ${faltan} sin costo · mostrando ${visibles.length}`;

  const list = document.getElementById('costos-list');
  if (!visibles.length) {
    list.innerHTML = '<div class="costos-empty">No hay productos con ese filtro</div>';
    return;
  }
  list.innerHTML = visibles.map(r => {
    const val = costoActual(r);
    return `<div class="costos-row">
      <div class="costos-info">
        <div class="costos-name">${costosEsc(r.nombre) || '<em>Sin nombre</em>'}</div>
        <div class="costos-sub">${costosEsc(r.catLbl)}${r.sub ? ' · ' + costosEsc(r.sub) : ''}</div>
        ${r.venta ? `<div class="costos-sub">Venta: ${costosFmt(r.venta)} <span class="costos-margin"></span></div>` : ''}
      </div>
      <input class="fi costos-inp${r.key in costosDirty ? ' costos-inp--dirty' : ''}" type="number" min="0"
        inputmode="decimal" enterkeyhint="next" placeholder="Costo $" data-key="${costosEsc(r.key)}"
        value="${val ? val : ''}" aria-label="Costo de ${costosEsc(r.nombre)}">
    </div>`;
  }).join('');

  list.querySelectorAll('.costos-row').forEach((el, i) => {
    updateCostosMargin(el, visibles[i], costoActual(visibles[i]));
  });
}

function updateCostosMargin(rowEl, row, costo) {
  const m = rowEl && rowEl.querySelector('.costos-margin');
  if (!m) return;
  if (!row.venta || !costo) { m.textContent = ''; m.className = 'costos-margin'; return; }
  const gan = row.venta - costo;
  const pct = Math.round(gan / row.venta * 100);
  m.textContent = `· Ganancia ${costosFmt(gan)} (${pct}%)`;
  m.className = 'costos-margin ' + (gan < 0 ? 'costos-margin--neg' : 'costos-margin--pos');
}

function updateCostosSaveBtn() {
  const n = Object.keys(costosDirty).length;
  const btn = document.getElementById('costos-save');
  btn.textContent = n ? `💾 Guardar ${n} cambio${n > 1 ? 's' : ''}` : '💾 Guardar';
  btn.disabled = !n;
}

async function saveCostos() {
  const keys = Object.keys(costosDirty);
  if (!keys.length) return;
  const btn = document.getElementById('costos-save');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';
  try {
    // Firestore permite hasta 500 escrituras por lote
    for (let i = 0; i < keys.length; i += 400) {
      const batch = db.batch();
      keys.slice(i, i + 400).forEach(k => {
        const row = costosRows.find(r => r.key === k);
        if (!row) return;
        batch.set(db.collection(row.col).doc(row.id), { [row.field]: costosDirty[k] }, { merge: true });
      });
      await batch.commit();
    }
    keys.forEach(k => {
      const row = costosRows.find(r => r.key === k);
      if (row) row.costo = costosDirty[k];
    });
    toast(`${keys.length} costo(s) guardado(s) ✅`, 'success');
    costosDirty = {};
    renderCostos();
  } catch (e) {
    console.error('Costos:', e);
    toast('Error al guardar los costos', 'error');
  }
  updateCostosSaveBtn();
}
