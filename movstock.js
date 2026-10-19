// ══════════════════════════════════════════════════════════════
// 📜 Movimientos de stock — equipos, repuestos y accesorios
// ══════════════════════════════════════════════════════════════
// Antes el stock cambiaba en muchos lados (alta, venta, anulación, uso en una
// reparación, rotura, control, edición a mano, borrado) y no quedaba rastro:
// si faltaba una funda no había forma de saber cuándo ni por qué cambió la
// cantidad. Ahora cada cambio deja un renglón en `stock_movimientos`:
//
//   { tipo: 'equipo'|'repuesto'|'accesorio', itemId, nombre, codigo,
//     cant (+3 / −1; 0 si no cambia la cantidad, ej. una reserva),
//     antes, despues (si se sabe), motivo, detalle, movId, repairId,
//     quien, uid, fecha (día AR), ts (hora de Firebase) }
//
// Anotar NUNCA frena lo que se está haciendo: si falla la anotación, la
// venta (o lo que sea) ya quedó hecha y eso es lo que importa. Las reglas no
// dejan editar ni borrar un renglón: es un registro, no una planilla.
//
// CUPO: una escritura por movimiento; se lee solo al abrir el registro (por
// período o por artículo), nunca en cada pantalla.
'use strict';

const MS_MOTIVOS = {
  alta:       { ico: '🆕', txt: 'Alta' },
  compra:     { ico: '📦', txt: 'Ingreso de mercadería' },
  venta:      { ico: '💰', txt: 'Venta' },
  anulacion:  { ico: '↩️', txt: 'Venta anulada' },
  reparacion: { ico: '🔧', txt: 'Usado en reparación' },
  devolucion: { ico: '↩️', txt: 'Devuelto de reparación' },
  rotura:     { ico: '💥', txt: 'Rotura' },
  ajuste:     { ico: '✏️', txt: 'Ajuste a mano' },
  control:    { ico: '📋', txt: 'Control de stock' },
  baja:       { ico: '🗑', txt: 'Borrado' },
  reserva:    { ico: '🔖', txt: 'Reservado' },
  liberado:   { ico: '🔓', txt: 'Reserva cancelada' },
  reactivado: { ico: '♻️', txt: 'Vuelve al stock' },
};
const MS_TIPOS = { equipo: '📱 Equipo', repuesto: '🔩 Repuesto', accesorio: '🏷️ Accesorio' };

function _msHoyAR() { return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); }

// La cantidad que tiene ahora (de los listeners ya abiertos: cero lecturas)
function _msCantidad(tipo, id) {
  const buscar = lista => (Array.isArray(lista) ? lista : []).find(x => x && x.id === id);
  if (tipo === 'accesorio') {
    const p = buscar(typeof PRODUCTOS !== 'undefined' ? PRODUCTOS : null);
    return p ? Number(p.stock) || 0 : null;
  }
  if (tipo === 'repuesto') {
    const r = buscar(typeof REPUESTOS !== 'undefined' ? REPUESTOS : null)
           || buscar(typeof CAJA_REPUESTOS !== 'undefined' ? CAJA_REPUESTOS : null);
    return r ? Number(r.cantidad) || 0 : null;
  }
  return null;
}

// Nombre para mostrar, a partir del documento
function movStockNombre(tipo, x) {
  if (!x) return '';
  if (tipo === 'equipo') {
    return [x.marca, x.modelo, x.almacenamiento, x.color].filter(Boolean).join(' ')
      + (x.imei ? ' · …' + String(x.imei).slice(-4) : '');
  }
  if (tipo === 'repuesto') {
    return [x.tipo, x.nombre && x.nombre !== x.tipo ? x.nombre : '', x.marca, x.modelo].filter(Boolean).join(' ');
  }
  return x.nombre || '';
}

// Busca el documento en lo que ya está cargado, para el nombre
function _msDoc(tipo, id) {
  const buscar = lista => (Array.isArray(lista) ? lista : []).find(x => x && x.id === id);
  if (tipo === 'equipo') return buscar(typeof STOCK !== 'undefined' ? STOCK : null) || buscar(typeof CAJA_STOCK !== 'undefined' ? CAJA_STOCK : null);
  if (tipo === 'repuesto') return buscar(typeof REPUESTOS !== 'undefined' ? REPUESTOS : null) || buscar(typeof CAJA_REPUESTOS !== 'undefined' ? CAJA_REPUESTOS : null);
  return buscar(typeof PRODUCTOS !== 'undefined' ? PRODUCTOS : null);
}

// Arma el renglón (aparte para poder probarlo sin Firestore)
function movStockRenglon(m) {
  const tipo = m.tipo === 'producto' ? 'accesorio' : m.tipo;
  const doc = m.doc || _msDoc(tipo, m.id);
  const cant = Number(m.cant) || 0;
  let antes = m.antes, despues = m.despues;
  if (antes === undefined && tipo !== 'equipo') {
    // Con increment() no se sabe el número final: se toma el que había
    // (listener) y se le suma el movimiento. Llamar ANTES de que el listener
    // traiga el cambio, o pasar `antes`.
    const ahora = _msCantidad(tipo, m.id);
    if (ahora !== null) antes = ahora;
  }
  if (despues === undefined && typeof antes === 'number') despues = antes + cant;
  const r = {
    tipo, itemId: m.id || null,
    nombre: String(m.nombre || movStockNombre(tipo, doc) || '(sin nombre)').slice(0, 120),
    codigo: m.codigo || (doc && (doc.codigo || doc.imei)) || '',
    cant, motivo: MS_MOTIVOS[m.motivo] ? m.motivo : 'ajuste',
    fecha: _msHoyAR(),
  };
  if (typeof antes === 'number') r.antes = antes;
  if (typeof despues === 'number') r.despues = despues;
  if (m.detalle) r.detalle = String(m.detalle).slice(0, 200);
  if (m.movId) r.movId = m.movId;
  if (m.repairId) r.repairId = m.repairId;
  const u = (typeof tpUsuario === 'function') ? tpUsuario() : null;
  if (u) { r.quien = u.nombre; r.uid = u.uid; }
  return r;
}

// Anota un movimiento. No espera ni tira error: nunca frena la operación.
function movStock(m) {
  try {
    if (!m || !m.id || typeof db === 'undefined' || !db) return;
    const r = movStockRenglon(m);
    r.ts = firebase.firestore.FieldValue.serverTimestamp();
    db.collection('stock_movimientos').add(r).catch(e => console.warn('[movstock] no se anotó:', e));
  } catch (e) { console.warn('[movstock]', e); }
}

// Cambio de cantidad entre lo que había y lo que queda (edición a mano,
// control). No anota nada si no cambió.
function movStockDiff(m, antes, despues) {
  const a = Number(antes) || 0, d = Number(despues) || 0;
  if (a === d) return;
  movStock(Object.assign({}, m, { cant: d - a, antes: a, despues: d }));
}

// ══════════════════════════════════════════════════════════════
//  Pantalla: 📜 Movimientos de stock
// ══════════════════════════════════════════════════════════════
let _msLista = [];
let _msFiltro = { per: 'hoy', tipo: '', motivo: '', q: '', itemId: '', titulo: '' };

function _msEsc(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function _msRango(per) {
  const hoy = _msHoyAR();
  const menos = n => new Date(Date.parse(hoy + 'T12:00:00Z') - n * 86400e3).toISOString().slice(0, 10);
  if (per === 'semana') return [menos(6), hoy];
  if (per === 'mes') return [menos(29), hoy];
  return [hoy, hoy];
}

// Abre el registro. `tipo` preselecciona (desde Accesorios, Repuestos…).
function abrirMovStock(tipo) {
  if (typeof closeSheet === 'function') closeSheet();
  if (typeof closeInvMenu === 'function') try { closeInvMenu(); } catch {}
  _msFiltro = { per: 'hoy', tipo: tipo || '', motivo: '', q: '', itemId: '', titulo: '' };
  _msAbrir();
  _msCargar();
}

// Historial de UN artículo (desde su ficha)
function historialStock(tipo, id, nombre) {
  if (!id) return;
  _msFiltro = { per: '', tipo, motivo: '', q: '', itemId: id, titulo: nombre || '' };
  _msAbrir();
  _msCargar();
}

function _msCerrar() { document.getElementById('ms-modal')?.remove(); }

function _msAbrir() {
  _msCerrar();
  const unItem = !!_msFiltro.itemId;
  const ov = document.createElement('div');
  ov.id = 'ms-modal';
  ov.className = 'emp-ov';
  ov.innerHTML = `<div class="emp-caja ms-caja" role="dialog" aria-label="Movimientos de stock">
      <div class="emp-cab"><h3>📜 ${unItem ? 'Historial' : 'Movimientos de stock'}</h3><button type="button" class="emp-x" onclick="_msCerrar()">✕</button></div>
      ${unItem ? `<p class="emp-ayuda">${_msEsc(_msFiltro.titulo)}</p>` : `
      <div class="horas-pers" id="ms-pers">
        <button type="button" data-p="hoy">Hoy</button>
        <button type="button" data-p="semana">7 días</button>
        <button type="button" data-p="mes">30 días</button>
      </div>
      <div class="ms-filtros">
        <select id="ms-tipo" class="fi"><option value="">Todo</option>${Object.keys(MS_TIPOS).map(k => `<option value="${k}">${MS_TIPOS[k]}</option>`).join('')}</select>
        <select id="ms-motivo" class="fi"><option value="">Todos los motivos</option>${Object.keys(MS_MOTIVOS).map(k => `<option value="${k}">${MS_MOTIVOS[k].ico} ${MS_MOTIVOS[k].txt}</option>`).join('')}</select>
        <input id="ms-q" class="fi" type="search" placeholder="Buscar artículo, código o quién…" autocomplete="off">
      </div>`}
      <div id="ms-resumen" class="ms-resumen"></div>
      <div id="ms-lista"><p class="emp-vacio">Cargando…</p></div>
    </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) _msCerrar(); });
  document.body.appendChild(ov);
  if (!unItem) {
    ov.querySelectorAll('#ms-pers button').forEach(b => b.addEventListener('click', () => { _msFiltro.per = b.dataset.p; _msCargar(); }));
    const t = document.getElementById('ms-tipo'); t.value = _msFiltro.tipo;
    t.addEventListener('change', () => { _msFiltro.tipo = t.value; _msPintar(); });
    const mo = document.getElementById('ms-motivo');
    mo.addEventListener('change', () => { _msFiltro.motivo = mo.value; _msPintar(); });
    const q = document.getElementById('ms-q');
    q.addEventListener('input', () => { _msFiltro.q = q.value; _msPintar(); });
  }
}

async function _msCargar() {
  const lista = document.getElementById('ms-lista');
  document.querySelectorAll('#ms-pers button').forEach(b => b.classList.toggle('on', b.dataset.p === _msFiltro.per));
  try {
    let snap;
    // Una sola condición (fecha o artículo): no hace falta índice compuesto
    if (_msFiltro.itemId) snap = await db.collection('stock_movimientos').where('itemId', '==', _msFiltro.itemId).get();
    else {
      const [desde, hasta] = _msRango(_msFiltro.per);
      snap = await db.collection('stock_movimientos').where('fecha', '>=', desde).where('fecha', '<=', hasta).get();
    }
    _msLista = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    _msPintar();
  } catch (e) {
    console.error('movstock:', e);
    if (lista) lista.innerHTML = '<p class="emp-vacio">No se pudo leer el registro. ¿Publicaste las reglas nuevas de Firebase?</p>';
  }
}

function _msMs(r) {
  const t = r.ts;
  return (t && typeof t.toMillis === 'function') ? t.toMillis() : Date.parse(r.fecha + 'T12:00:00-03:00') || 0;
}

// Filtra lo cargado (aparte para poder probarlo)
function movStockFiltrar(lista, f) {
  const q = String(f.q || '').trim().toLowerCase();
  return lista.filter(r =>
    (!f.tipo || r.tipo === f.tipo) &&
    (!f.motivo || r.motivo === f.motivo) &&
    (!q || [r.nombre, r.codigo, r.quien, r.detalle].some(v => String(v || '').toLowerCase().includes(q))));
}

function _msPintar() {
  const cont = document.getElementById('ms-lista');
  if (!cont) return;
  const lista = movStockFiltrar(_msLista, _msFiltro).sort((a, b) => _msMs(b) - _msMs(a));
  const entra = lista.filter(r => r.cant > 0).reduce((s, r) => s + r.cant, 0);
  const sale = lista.filter(r => r.cant < 0).reduce((s, r) => s - r.cant, 0);
  const res = document.getElementById('ms-resumen');
  if (res) res.innerHTML = lista.length
    ? `${lista.length} movimiento${lista.length === 1 ? '' : 's'} · <b class="ms-mas">+${entra}</b> entraron · <b class="ms-menos">−${sale}</b> salieron`
    : '';
  if (!lista.length) { cont.innerHTML = '<p class="emp-vacio">No hay movimientos con esto.</p>'; return; }
  cont.innerHTML = lista.slice(0, 500).map(r => {
    const m = MS_MOTIVOS[r.motivo] || MS_MOTIVOS.ajuste;
    const t = _msMs(r);
    const cuando = new Date(t - 3 * 3600e3).toISOString();
    const signo = r.cant > 0 ? '+' + r.cant : (r.cant < 0 ? '−' + (-r.cant) : '·');
    const cls = r.cant > 0 ? 'ms-mas' : (r.cant < 0 ? 'ms-menos' : '');
    const click = (!_msFiltro.itemId && r.itemId) ? ` onclick="historialStock('${_msEsc(r.tipo)}','${_msEsc(r.itemId)}','${_msEsc(String(r.nombre).replace(/'/g, ''))}')" class="ms-fila d-tocable"` : ' class="ms-fila"';
    return `<div${click}>
      <div class="ms-cuando">${cuando.slice(8, 10)}/${cuando.slice(5, 7)}<br>${cuando.slice(11, 16)}</div>
      <div class="ms-que">
        <div><b>${_msEsc(r.nombre)}</b></div>
        <div class="ms-sub">${(MS_TIPOS[r.tipo] || '').split(' ')[0]} ${m.ico} ${m.txt}${r.detalle ? ' · ' + _msEsc(r.detalle) : ''}${r.quien ? ' · 👤 ' + _msEsc(r.quien) : ''}</div>
      </div>
      <div class="ms-cant ${cls}">${signo}${typeof r.antes === 'number' && typeof r.despues === 'number' ? `<div class="ms-sub">${r.antes} → ${r.despues}</div>` : ''}</div>
    </div>`;
  }).join('') + (lista.length > 500 ? '<p class="emp-vacio">Se muestran los últimos 500. Filtrá para ver el resto.</p>' : '');
}
