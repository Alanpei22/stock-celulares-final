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
//   · reparación → repairs.costo en pesos (lo que costó arreglarla: repuesto
//                  y lo que haga falta). Si ya estaba cobrada, también se
//                  corrige la ganancia de ese cobro en la caja.
// Solo el dueño: el costo no lo ven los empleados.
//
// Reparaciones sin PRECIO (Alan, 25/11: "a veces cuando entra no se pone el
// precio, pero sí cuando se cobra"): esas filas traen también un casillero de
// precio, y el botón "Traer precios de la caja" los completa con lo que se
// cobró de cada una (seña + cobro). Sin precio, las estadísticas las contaban
// $0. De entrada se ven solo las que les falta algo.

// Las reparaciones: de la más nueva a la más vieja (no por nombre), sin las
// que no se hicieron
const _COSTOS_REP_FUERA = /^(no va|no van|cancelad)/i;
const _COSTOS_CFG = {
  reparacion: {
    titulo: '🔧 Costos de reparaciones',
    col: 'repairs',
    lista: () => (typeof REPAIRS !== 'undefined' ? REPAIRS : []).filter(r => !_COSTOS_REP_FUERA.test(String(r.estado || ''))),
    orden: (a, b) => String(b.fechaIngreso || '').localeCompare(String(a.fechaIngreso || '')),
    nombre: r => `#${r.nOrden || '?'} ${r.marca || ''} ${r.modelo || ''}`.replace(/\s+/g, ' ').trim(),
    sub: r => [r.arreglo || (Array.isArray(r.arreglos) ? r.arreglos.map(a => a && (a.txt || a.nombre)).filter(Boolean).join(' + ') : ''),
               r.estado, r.fechaIngreso ? new Date(r.fechaIngreso).toLocaleDateString('es-AR') : '',
               (!(Number(r.costo) > 0) && Number(r.costoRepuesto) > 0) ? 'costo del repuesto usado' : ''].filter(Boolean).join(' · '),
    venta: r => Number(r.monto) || 0,
    costo: r => Math.round((typeof repCostoEfectivo === 'function' ? repCostoEfectivo(r) : Number(r.costo)) || 0),
    // "Sin repuesto" (solo mano de obra) ya tiene su costo: 0
    falta: r => !(Number(r.costo) > 0 || Number(r.costoRepuesto) > 0 || r.sinRepuesto),
    // Sin precio: entró sin precio y nadie se lo puso (ni al cobrar)
    faltaPrecio: r => !(Number(r.monto) > 0),
    historial: true,
    soloFaltanDeEntrada: true,
  },
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
    .sort(cfg.orden || ((a, b) => cfg.nombre(a).localeCompare(cfg.nombre(b), 'es')));
  if (!lista.length) { toast('No hay nada en la lista que estás viendo', 'error'); return; }
  _costosTipo = tipo;
  const falta = x => (cfg.falta ? cfg.falta(x) : !cfg.costo(x));
  const faltaPrecio = x => !!(cfg.faltaPrecio && cfg.faltaPrecio(x));
  const faltan = lista.filter(falta).length;
  const sinPrecio = lista.filter(faltaPrecio).length;
  // Las cobradas o entregadas sin precio: a esas se les puede buscar lo que
  // se cobró en la caja
  const sinPrecioCobradas = lista.filter(x => faltaPrecio(x) && (x.cobrado || x.estado === 'entregado')).length;
  // De entrada solo las que les falta algo (si no falta nada, se ven todas)
  const soloDeEntrada = !!cfg.soloFaltanDeEntrada && (faltan + sinPrecio) > 0;

  document.getElementById('costos-lista-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'costos-lista-modal';
  m.className = 'modal-overlay';
  m.innerHTML = `
  <div class="modal-card form-card">
    <div class="modal-header">
      <h3>${cfg.titulo} <small style="font-weight:500;color:var(--t3)">${lista.length} · ${faltan} sin costo${cfg.faltaPrecio ? ` · ${sinPrecio} sin precio` : ''}</small></h3>
      <button class="modal-close" onclick="cerrarCostosLista()">✕</button>
    </div>
    <div style="padding:8px 16px 0;font-size:12px;color:var(--t3)">
      ${tipo === 'reparacion'
        ? `Lo que te costó cada una (repuesto y lo que haga falta), en pesos. Enter pasa a la siguiente. Si ya estaba cobrada, se corrige la ganancia en la caja.
           ${cfg.historial && typeof _cargarHistorialRep === 'function' && (typeof repAlcance !== 'function' || repAlcance() !== 'todo')
             ? `<button type="button" class="btn-secondary" style="min-height:0;padding:4px 10px;font-size:12px;margin-left:6px" onclick="_costosTraerTodas()">🗂️ Traer también las viejas</button>` : ''}`
        : 'Costo en pesos. Enter pasa al siguiente. Son los de la lista que estabas viendo (con tus filtros).'}
      <label style="display:inline-flex;align-items:center;gap:4px;margin-left:6px;cursor:pointer">
        <input type="checkbox" id="costos-solo-faltan" onchange="_costosSoloFaltan(this.checked)"${soloDeEntrada ? ' checked' : ''}> ${cfg.faltaPrecio ? 'solo las que les falta algo' : 'solo sin costo'}
      </label>
      ${sinPrecioCobradas ? `<button type="button" class="btn-secondary" style="min-height:0;padding:4px 10px;font-size:12px;margin-left:6px"
              onclick="_costosPreciosCaja()">💰 Traer precios de la caja (${sinPrecioCobradas})</button>
      <span id="costos-precios-res" style="font-size:12px;margin-left:6px"></span>` : ''}
      <button type="button" class="btn-secondary" style="min-height:0;padding:4px 10px;font-size:12px;margin-left:6px"
              onclick="_costosPegarToggle()">📋 Pegar lista</button>
      <div id="costos-pegar" class="hidden" style="margin-top:8px">
        <textarea id="costos-pegar-txt" class="fi" rows="5" style="font-size:13px"
                  placeholder="Un producto por renglón, con el costo al final. Ej:&#10;Modulo a04 premium 16900&#10;Modulo a05 oled 15000"></textarea>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
          <button type="button" class="btn-primary" style="min-height:0;padding:8px 14px" onclick="_costosPegarAplicar()">Completar casilleros</button>
          <span id="costos-pegar-res" style="font-size:12px"></span>
        </div>
      </div>
    </div>
    <div class="modal-body" style="max-height:62vh;overflow:auto;gap:0">
      ${lista.map(x => {
        const val = cfg.costo(x), venta = cfg.venta(x), sinP = faltaPrecio(x);
        return `<div class="costos-fila" data-falta="${falta(x) || sinP ? '1' : '0'}" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(cfg.nombre(x) || '(sin nombre)')}</div>
            <div style="font-size:12px;color:var(--t3)">${esc(cfg.sub(x))}</div>
            ${venta ? `<div style="font-size:12px;color:var(--t3)">venta ${_costosPesos(venta)} <span class="costos-gan">${_costosGanancia(venta, val)}</span></div>`
              : sinP ? `<div style="font-size:12px;color:#b45309;font-weight:700">⚠️ sin precio <span class="costos-gan"></span></div>` : ''}
          </div>
          ${sinP ? `<input class="fi costos-inp costos-precio" data-campo="monto" data-id="${esc(x.id)}" data-antes=""
                 type="number" min="0" step="1" inputmode="numeric" enterkeyhint="next"
                 value="" placeholder="precio" title="Precio de la reparación (lo que pagó el cliente)" style="width:88px;text-align:right"
                 oninput="_costosFila(this)">` : ''}
          <span style="font-size:13px;color:var(--t3)">$</span>
          <input class="fi costos-inp" data-id="${esc(x.id)}" data-nombre="${esc(cfg.nombre(x))}" data-antes="${val || ''}" data-venta="${venta}"
                 type="number" min="0" step="1" inputmode="numeric" enterkeyhint="next"
                 value="${val || ''}" placeholder="${sinP ? 'costo' : '0'}" style="width:${sinP ? 88 : 110}px;text-align:right"
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
  if (soloDeEntrada) _costosSoloFaltan(true);
  setTimeout(() => [...m.querySelectorAll('.costos-inp')].find(i => i.closest('.costos-fila').style.display !== 'none')?.focus(), 100);
}

// Al escribir: se recalcula la ganancia y se marca lo que cambió
function _costosFila(el) {
  _costosSeguirDueno();
  const fila = el.closest('.costos-fila');
  const gan = fila && fila.querySelector('.costos-gan');
  // El precio recién escrito pasa a ser la "venta" del costo de esa fila
  const inpCosto = el.dataset.campo === 'monto' && fila ? fila.querySelector('.costos-inp:not(.costos-precio)') : el;
  if (el !== inpCosto && inpCosto) inpCosto.dataset.venta = Math.round(parseFloat(el.value) || 0);
  if (gan && inpCosto) gan.innerHTML = _costosGanancia(inpCosto.dataset.venta, parseFloat(inpCosto.value));
  const cambio = Math.round(parseFloat(el.value) || 0) !== Math.round(parseFloat(el.dataset.antes) || 0);
  el.style.borderColor = cambio ? '#f59e0b' : '';
  const n = _costosContarCambios();
  const btn = document.getElementById('costos-lista-save');
  if (btn) btn.textContent = n ? `Guardar ${n} ${_costosTipo === 'reparacion' ? 'cambio' : 'costo'}${n === 1 ? '' : 's'}` : 'Guardar costos';
}

// 💰 Precios de la caja: para las cobradas sin precio, lo que entró por cada
// una (repPreciosDesdeCaja en utils.js). Como "Pegar lista": completa los
// casilleros, y se revisa antes de tocar Guardar.
async function _costosPreciosCaja() {
  const m = document.getElementById('costos-lista-modal');
  const res = document.getElementById('costos-precios-res');
  if (!m || typeof repPreciosDesdeCaja !== 'function') return;
  const inputs = [...m.querySelectorAll('.costos-precio')].filter(i => !(parseFloat(i.value) > 0));
  const reps = inputs.map(i => (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(r => r.id === i.dataset.id))
    .filter(r => r && (r.cobrado || r.estado === 'entregado'));
  if (!reps.length) { if (res) res.textContent = 'No quedan cobradas sin precio'; return; }
  if (res) { res.style.color = 'var(--t3)'; res.textContent = '⏳ Buscando en la caja…'; }
  try {
    const encontrados = await repPreciosDesdeCaja(reps);
    encontrados.forEach(e => {
      const inp = inputs.find(i => i.dataset.id === e.id);
      if (!inp) return;
      inp.value = e.monto;
      _costosFila(inp);
    });
    const faltan = reps.length - encontrados.length;
    if (res) {
      res.style.color = encontrados.length ? '#10b981' : '#b45309';
      res.textContent = (encontrados.length ? `✅ ${encontrados.length} completado${encontrados.length === 1 ? '' : 's'} — revisá y tocá Guardar` : '⚠️ No encontré cobros vinculados')
        + (faltan && encontrados.length ? ` · ${faltan} sin cobro vinculado en la caja (escribí el precio a mano)` : '');
    }
  } catch (e) {
    console.error('precios de la caja:', e);
    if (res) { res.style.color = '#dc2626'; res.textContent = 'No se pudo leer la caja (¿sin señal?)'; }
  }
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

// ── Pegar lista ─────────────────────────────────────────────
// Para no tipear de a uno lo que ya está escrito en otro lado (la lista del
// proveedor, una nota, WhatsApp): se pega "nombre costo" por renglón y se
// completan los casilleros que coinciden por nombre. NO guarda solo: llena
// los casilleros (quedan marcados como cambiados) y se revisa antes de
// tocar Guardar.
function _costosPegarToggle() {
  const box = document.getElementById('costos-pegar');
  if (!box) return;
  box.classList.toggle('hidden');
  if (!box.classList.contains('hidden')) document.getElementById('costos-pegar-txt')?.focus();
}

// Nombre comparable: sin mayúsculas, acentos ni espacios ("Módulo a04e / a03"
// = "modulo a04e/a03").
function _costosNorm(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
}

// Distancia entre dos textos, cortada en `max` (para perdonar un error de
// tipeo: "premiun" por "premium").
function _costosDist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let minFila = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < minFila) minFila = cur[j];
    }
    if (minFila > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Renglones → [{ nombre, costo }]. El costo es el último número del renglón;
// acepta "16.900", "$16900", "16900,00", y separado por tab, ; o espacios.
function _costosLeerLista(texto) {
  const out = [];
  String(texto || '').split(/\r?\n/).forEach(l => {
    const m = /^(.*?)[\s;:\t|=-]*\$?\s*(\d[\d.]*)(?:,\d{1,2})?\s*$/.exec(l.trim());
    if (!m) return;
    const nombre = m[1].replace(/[\s;:\t|=$-]+$/, '').trim();
    const costo = parseInt(m[2].replace(/\./g, ''), 10);
    if (nombre && costo > 0) out.push({ nombre, costo });
  });
  return out;
}

// Para cada renglón, el casillero con el mismo nombre. Si no hay uno igual,
// se acepta UNO que difiera en una letra; si hay dos parecidos, no se adivina.
function _costosEmparejar(renglones, nombres) {
  const norm = nombres.map(_costosNorm);
  return renglones.map(r => {
    const n = _costosNorm(r.nombre);
    let idx = norm.map((x, i) => x === n ? i : -1).filter(i => i >= 0);
    // Los números tienen que ser los mismos: "a04" y "a05" difieren en una
    // sola letra pero son otro módulo, y eso no se perdona nunca.
    const nums = t => t.replace(/\D+/g, ' ').trim();
    if (!idx.length) idx = norm.map((x, i) => nums(x) === nums(n) && _costosDist(x, n, 1) <= 1 ? i : -1).filter(i => i >= 0);
    return { ...r, idx: idx.length === 1 ? idx[0] : -1, dudoso: idx.length > 1 };
  });
}

function _costosPegarAplicar() {
  const m = document.getElementById('costos-lista-modal');
  if (!m) return;
  const inputs = [...m.querySelectorAll('.costos-inp:not(.costos-precio)')];
  const renglones = _costosLeerLista(document.getElementById('costos-pegar-txt').value);
  const res = document.getElementById('costos-pegar-res');
  if (!renglones.length) { res.textContent = 'No encontré renglones con nombre y costo'; res.style.color = '#dc2626'; return; }
  const pares = _costosEmparejar(renglones, inputs.map(i => i.dataset.nombre || ''));
  let ok = 0;
  pares.forEach(p => {
    if (p.idx < 0) return;
    const inp = inputs[p.idx];
    inp.value = p.costo;
    _costosFila(inp);
    const fila = inp.closest('.costos-fila');
    if (fila) fila.style.display = '';
    ok++;
  });
  const faltan = pares.filter(p => p.idx < 0).map(p => p.nombre + (p.dudoso ? ' (hay varios parecidos)' : ''));
  res.style.color = faltan.length ? '#b45309' : '#10b981';
  res.textContent = `✅ ${ok} completado${ok === 1 ? '' : 's'}` +
    (faltan.length ? ` · ⚠️ no encontré: ${faltan.join(', ')}` : '') + ' — revisá y tocá Guardar';
}

// "Solo sin costo" mira cómo estaba al abrir: así la fila no se esconde
// mientras le estás escribiendo el número.
function _costosSoloFaltan(solo) {
  document.querySelectorAll('#costos-lista-modal .costos-fila').forEach(f => {
    f.style.display = solo && f.dataset.falta !== '1' ? 'none' : '';
  });
}

// Las reparaciones de hace más de 30 días no están en memoria: se traen
// (una vez, como el "Todo" de la lista de reparaciones) y se reabre.
async function _costosTraerTodas() {
  if (_costosContarCambios() && !confirm('Tenés costos sin guardar: se pierden si traés las viejas. ¿Seguir?')) return;
  document.getElementById('costos-lista-modal')?.remove();
  toast('🗂️ Trayendo todas las reparaciones…', 'info');
  const ok = await _cargarHistorialRep();
  if (ok) abrirCostosLista('reparacion');
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
    if (el.dataset && el.dataset.campo === 'monto') {
      // El precio de una reparación que no tenía (nunca se borra uno: en 0 no se guarda)
      if (!(nuevo > 0)) return;
      data = { monto: nuevo };
      const ya = out.find(c => c.id === el.dataset.id);
      if (ya) { Object.assign(ya.data, data); return; }
      out.push({ id: el.dataset.id, data });
      return;
    }
    if (tipo === 'equipo') {
      // Igual que el formulario: sin costo, el campo no queda en 0, se borra.
      data = { costo: nuevo > 0 ? nuevo : del };
    } else if (tipo === 'reparacion') {
      // El que se escribe es el costo de la reparación (pisa al del repuesto)
      data = { costo: nuevo };
    } else {
      data = { precioCompra: nuevo, precioCostoUSD: (typeof repCostoUSD === 'function') ? repCostoUSD(nuevo, dolar)
               : (nuevo > 0 && dolar > 0 ? Math.round((nuevo / dolar) * 100) / 100 : 0) };
      if (nuevo > 0 && dolar > 0) data.dolarCosto = dolar;
    }
    const ya = out.find(c => c.id === el.dataset.id);
    if (ya) Object.assign(ya.data, data); else out.push({ id: el.dataset.id, data });
  });
  return out;
}

// Después de guardar costos de reparaciones: la copia local, y la ganancia
// de los cobros que ya estaban hechos
async function _costosRepDespues(cambios) {
  let corregidos = 0;
  for (const c of cambios) {
    const r = (typeof REPAIRS !== 'undefined' ? REPAIRS : []).find(x => x.id === c.id);
    if (!r) continue;
    const costoAntes = Number(r.costo) || 0;
    if (typeof _repPatchLocal === 'function') _repPatchLocal(c.id, c.data); else Object.assign(r, c.data);
    // Si solo se puso el precio, el cobro de la caja queda como está (la plata
    // que entró es la que entró)
    if ('costo' in c.data && r.cobrado && typeof repActualizarCobro === 'function') corregidos += await repActualizarCobro(r, c.data.costo, costoAntes);
  }
  if (corregidos) toast(`📈 Ganancia corregida en ${corregidos} cobro${corregidos === 1 ? '' : 's'} de la caja`, 'success');
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
    const nP = cambios.filter(c => 'monto' in c.data).length, nC = cambios.filter(c => !('monto' in c.data) || Object.keys(c.data).length > 1).length;
    toast(nP ? `✅ Guardado: ${nC} costo${nC === 1 ? '' : 's'} · ${nP} precio${nP === 1 ? '' : 's'}`
             : `✅ ${cambios.length} costo${cambios.length === 1 ? '' : 's'} guardado${cambios.length === 1 ? '' : 's'}`, 'success');
    if (_costosTipo === 'reparacion') await _costosRepDespues(cambios);
  } catch (e) {
    console.error('costos:', e);
    toast('Error al guardar los costos', 'error');
    if (btn) btn.disabled = false;
  }
}
