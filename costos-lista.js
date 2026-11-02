// ══════════════════════════════════════════
//  CARGAR COSTOS EN LISTA — equipos y repuestos
// ══════════════════════════════════════════
// Los accesorios ya tenían "Cargar costos" (inventario.js), pero para los
// celulares y los repuestos había que abrir uno por uno y escribir el costo en
// el formulario: con todo el stock, era una tarde entera. Acá van todos los de
// la lista que estás viendo (con la búsqueda y los filtros puestos), con un
// casillero de costo cada uno. Enter pasa al siguiente y se guardan juntos,
// solo los que cambiaron.
//
// Se guarda igual que el formulario de cada uno, así el resto de la app (caja,
// ganancia, reportes) no nota la diferencia:
//   · equipo   → stock.costo en pesos (sin costo = se borra el campo)
//   · repuesto → precioCompra en pesos + precioCostoUSD al dólar de hoy
// Solo el dueño: el costo no lo ven los empleados.

const _COSTOS_CFG = {
  equipo: {
    titulo: '📱 Costos de equipos',
    col: 'stock',
    lista: () => (typeof _stockFiltrado === 'function' ? _stockFiltrado() : (typeof STOCK !== 'undefined' ? STOCK : [])),
    nombre: p => `${p.marca || ''} ${p.modelo || ''}${p.almacenamiento ? ' ' + p.almacenamiento : ''}`.trim(),
    sub: p => [p.estado, p.imei ? 'IMEI …' + String(p.imei).slice(-4) : '', p.vendido ? 'vendido' : ''].filter(Boolean).join(' · '),
    venta: p => Number(p.precio) || 0,
    costo: p => Math.round(Number(p.costo) || 0),
  },
  repuesto: {
    titulo: '🔩 Costos de repuestos',
    col: 'repuestos',
    lista: () => (typeof _rep2Filtrados === 'function' ? _rep2Filtrados() : (typeof REPUESTOS !== 'undefined' ? REPUESTOS : [])),
    nombre: r => r.nombre || '',
    sub: r => [r.tipo, r.marca, r.modelo, r.cantidad != null ? 'cant. ' + r.cantidad : ''].filter(Boolean).join(' · '),
    venta: r => Number(r.precioVenta) || 0,
    // Lo mismo que muestra el formulario: lo que se pagó en pesos o, en los
    // viejos cargados solo en dólares, lo que vale hoy.
    costo: r => {
      if (Number(r.precioCompra) > 0) return Math.round(r.precioCompra);
      const usd = Number(r.precioCostoUSD) || 0, d = _costosDolar();
      return usd > 0 && d > 0 ? Math.round(usd * d) : 0;
    },
  },
};

let _costosTipo = null;

function _costosDolar() {
  if (typeof _dolarHoy === 'function') return _dolarHoy() || 0;
  return (typeof dolarBlue === 'number' && dolarBlue > 0) ? dolarBlue : 0;
}

function _costosEsDueno() {
  return typeof OWNER_MODE !== 'undefined' && !!OWNER_MODE;
}

function _costosPesos(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR'); }

// "Ganancia $40.000 (25%)" al lado del precio de venta
function _costosGanancia(venta, costo) {
  venta = Number(venta) || 0; costo = Number(costo) || 0;
  if (!(venta > 0 && costo > 0)) return '';
  const g = venta - costo;
  const color = g < 0 ? '#dc2626' : '#10b981';
  return `<span style="color:${color};font-weight:700">· gan. ${_costosPesos(g)} (${Math.round(g / venta * 100)}%)</span>`;
}

function abrirCostosLista(tipo) {
  const cfg = _COSTOS_CFG[tipo];
  if (!cfg) return;
  if (!_costosEsDueno()) { toast('🔒 Activá el modo dueño para cargar costos', 'error'); return; }
  const lista = cfg.lista().slice()
    .sort((a, b) => cfg.nombre(a).localeCompare(cfg.nombre(b), 'es'));
  if (!lista.length) { toast('No hay nada en la lista que estás viendo', 'error'); return; }
  _costosTipo = tipo;
  const faltan = lista.filter(x => !cfg.costo(x)).length;

  document.getElementById('costos-lista-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'costos-lista-modal';
  m.className = 'modal-overlay';
  m.innerHTML = `
  <div class="modal-card form-card">
    <div class="modal-header">
      <h3>${cfg.titulo} <small style="font-weight:500;color:var(--t3)">${lista.length} · ${faltan} sin costo</small></h3>
      <button class="modal-close" onclick="cerrarCostosLista()">✕</button>
    </div>
    <div style="padding:8px 16px 0;font-size:12px;color:var(--t3)">
      Costo en pesos. Enter pasa al siguiente. Son los de la lista que estabas viendo (con tus filtros).
      <label style="display:inline-flex;align-items:center;gap:4px;margin-left:6px;cursor:pointer">
        <input type="checkbox" id="costos-solo-faltan" onchange="_costosSoloFaltan(this.checked)"> solo sin costo
      </label>
    </div>
    <div class="modal-body" style="max-height:62vh;overflow:auto;gap:0">
      ${lista.map(x => {
        const val = cfg.costo(x), venta = cfg.venta(x);
        return `<div class="costos-fila" data-falta="${val ? '0' : '1'}" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(cfg.nombre(x) || '(sin nombre)')}</div>
            <div style="font-size:12px;color:var(--t3)">${esc(cfg.sub(x))}</div>
            ${venta ? `<div style="font-size:12px;color:var(--t3)">venta ${_costosPesos(venta)} <span class="costos-gan">${_costosGanancia(venta, val)}</span></div>` : ''}
          </div>
          <span style="font-size:13px;color:var(--t3)">$</span>
          <input class="fi costos-inp" data-id="${esc(x.id)}" data-antes="${val || ''}" data-venta="${venta}"
                 type="number" min="0" step="1" inputmode="numeric" enterkeyhint="next"
                 value="${val || ''}" placeholder="0" style="width:110px;text-align:right"
                 oninput="_costosFila(this)">
        </div>`;
      }).join('')}
    </div>
    <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px">
      <button class="btn-secondary" onclick="cerrarCostosLista()">Cancelar</button>
      <button class="btn-primary" id="costos-lista-save" onclick="guardarCostosLista()">Guardar costos</button>
    </div>
  </div>`;
  m.addEventListener('click', e => { if (e.target === m) cerrarCostosLista(); });
  document.body.appendChild(m);
  // Enter pasa al siguiente visible: cargar 50 costos sin tocar el mouse.
  m.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.classList.contains('costos-inp')) return;
    e.preventDefault();
    const vis = [...m.querySelectorAll('.costos-inp')].filter(i => i.closest('.costos-fila').style.display !== 'none');
    (vis[vis.indexOf(e.target) + 1] || document.getElementById('costos-lista-save')).focus();
  });
  // Al entrar a un casillero queda todo el número marcado: escribir lo
  // reemplaza. Si no, con Enter el número nuevo se pegaba al final del que ya
  // estaba (450000 + 520000 = 450000520000).
  m.addEventListener('focusin', e => { if (e.target.classList.contains('costos-inp')) e.target.select(); });
  setTimeout(() => m.querySelector('.costos-inp')?.focus(), 100);
}

// Al escribir: se recalcula la ganancia y se marca lo que cambió
function _costosFila(el) {
  _costosSeguirDueno();
  const fila = el.closest('.costos-fila');
  const gan = fila && fila.querySelector('.costos-gan');
  if (gan) gan.innerHTML = _costosGanancia(el.dataset.venta, parseFloat(el.value));
  const cambio = Math.round(parseFloat(el.value) || 0) !== Math.round(parseFloat(el.dataset.antes) || 0);
  el.style.borderColor = cambio ? '#f59e0b' : '';
  const n = _costosContarCambios();
  const btn = document.getElementById('costos-lista-save');
  if (btn) btn.textContent = n ? `Guardar ${n} costo${n === 1 ? '' : 's'}` : 'Guardar costos';
}

// Mientras cargás, el modo dueño no se vence: cada número escrito vuelve a
// contar los 15 minutos (los mismos que usa unlockOwnerMode en app.js).
function _costosSeguirDueno() {
  if (!_costosEsDueno() || typeof lockOwnerMode !== 'function') return;
  try {
    clearTimeout(_ownerLockTimer);
    _ownerLockTimer = setTimeout(lockOwnerMode, 15 * 60 * 1000);
  } catch (e) {}
}

function _costosContarCambios() {
  const m = document.getElementById('costos-lista-modal');
  return m ? _costosCambios(_costosTipo, [...m.querySelectorAll('.costos-inp')], _costosDolar()).length : 0;
}

// "Solo sin costo" mira cómo estaba al abrir: así la fila no se esconde
// mientras le estás escribiendo el número.
function _costosSoloFaltan(solo) {
  document.querySelectorAll('#costos-lista-modal .costos-fila').forEach(f => {
    f.style.display = solo && f.dataset.falta !== '1' ? 'none' : '';
  });
}

function cerrarCostosLista() {
  const n = _costosContarCambios();
  if (n && !confirm(`Tenés ${n} costo${n === 1 ? '' : 's'} sin guardar. ¿Cerrar igual?`)) return;
  document.getElementById('costos-lista-modal')?.remove();
}

// Lo que cambió, listo para guardar. Aparte para poder probarlo.
// del: cómo se borra un campo en Firestore (FieldValue.delete()).
function _costosCambios(tipo, inputs, dolar, del) {
  const out = [];
  inputs.forEach(el => {
    const nuevo = Math.max(0, Math.round(parseFloat(el.value) || 0));
    const antes = Math.round(parseFloat(el.dataset.antes) || 0);
    if (nuevo === antes) return;
    let data;
    if (tipo === 'equipo') {
      // Igual que el formulario: sin costo, el campo no queda en 0, se borra.
      data = { costo: nuevo > 0 ? nuevo : del };
    } else {
      data = { precioCompra: nuevo, precioCostoUSD: (typeof repCostoUSD === 'function') ? repCostoUSD(nuevo, dolar)
               : (nuevo > 0 && dolar > 0 ? Math.round((nuevo / dolar) * 100) / 100 : 0) };
      if (nuevo > 0 && dolar > 0) data.dolarCosto = dolar;
    }
    out.push({ id: el.dataset.id, data });
  });
  return out;
}

async function guardarCostosLista() {
  const m = document.getElementById('costos-lista-modal');
  const cfg = _COSTOS_CFG[_costosTipo];
  if (!m || !cfg) return;
  // El modo dueño se bloquea solo a los 15 minutos. Antes, si se vencía con la
  // lista abierta, Guardar decía "activá el modo dueño" y la lista tapaba el
  // 🔒: no había forma de guardar lo cargado (se perdieron 21 costos así).
  // Ahora pide el PIN ahí mismo y guarda: la lista queda abierta con todo.
  if (!_costosEsDueno()) {
    if (typeof requireOwnerPin === 'function') {
      requireOwnerPin(() => {
        if (typeof unlockOwnerMode === 'function') unlockOwnerMode();
        guardarCostosLista();
      }, 'Se bloqueó el modo dueño. Poné el PIN para guardar los costos');
    } else {
      toast('🔒 Activá el modo dueño para guardar', 'error');
    }
    return;
  }
  const cambios = _costosCambios(_costosTipo, [...m.querySelectorAll('.costos-inp')], _costosDolar(),
                                 firebase.firestore.FieldValue.delete());
  if (!cambios.length) { m.remove(); toast('No cambiaste ningún costo', 'info'); return; }
  if (_costosTipo === 'repuesto' && !_costosDolar()) toast('Sin cotización del dólar: el costo se guarda solo en pesos', 'info');
  const btn = document.getElementById('costos-lista-save');
  if (btn) btn.disabled = true;
  try {
    // Firestore acepta hasta 500 escrituras por tanda.
    for (let i = 0; i < cambios.length; i += 450) {
      const batch = db.batch();
      cambios.slice(i, i + 450).forEach(c => batch.update(db.collection(cfg.col).doc(c.id), c.data));
      await batch.commit();
    }
    m.remove();
    toast(`✅ ${cambios.length} costo${cambios.length === 1 ? '' : 's'} guardado${cambios.length === 1 ? '' : 's'}`, 'success');
  } catch (e) {
    console.error('costos:', e);
    toast('Error al guardar los costos', 'error');
    if (btn) btn.disabled = false;
  }
}
