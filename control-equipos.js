// ══════════════════════════════════════════════════════════════
//  ✅ CONTROL DE STOCK DE EQUIPOS — checklist con filtros
// ══════════════════════════════════════════════════════════════
// Alan (25/11): "necesito hacer un checklist para control del stock de
// equipos, con filtros". Se recorre el local con la lista de los equipos que
// figuran en stock y se marca cada uno: ✓ está / ✗ no lo encuentro. Para no
// buscarlo a mano, se escanea la etiqueta (o el IMEI de la caja) con la
// cámara o con la pistola, o se tipea el IMEI (alcanza con el final).
//
// · Los filtros (marca, estado, dónde está, lo que falta controlar) sirven
//   para hacerlo por partes: hoy la vitrina, mañana el depósito.
// · El control queda guardado en la base (controles_stock/equipos-actual),
//   así se puede seguir desde otro aparato o entre dos personas, y no se
//   pierde si se cierra la app.
// · Si se escanea algo que figura VENDIDO o que no está en el stock, queda
//   anotado aparte: es justo lo que hay que revisar.
// · Al terminar queda el resumen en el historial y se puede mandar por WhatsApp.
//
// Cupo: la lista sale del stock que ya está en memoria. La base se escucha
// solo mientras el control está abierto (un documento).
'use strict';

const CE_COL = 'controles_stock';
const CE_ACTUAL = 'equipos-actual';
let _ceCtl = null;        // { inicio, marcas: { id: { r: 'ok'|'falta', t, por } }, extras: [] }
let _ceUnsub = null;
let _ceFiltro = { q: '', marca: '', estado: '', ubic: '', ver: '' };
let _ceUltimo = null;     // id del último marcado (se resalta)

function _ceDoc() { return db.collection(CE_COL).doc(CE_ACTUAL); }
function _ceStock() { return (typeof STOCK !== 'undefined' && Array.isArray(STOCK)) ? STOCK : []; }
function _ceMarca(m) { return (typeof marcaCanon === 'function') ? marcaCanon(m) : String(m || '').trim(); }
function _ceQuien() {
  const f = (typeof tpFirma === 'function') ? tpFirma() : {};
  return f.cargadoPor || (typeof getDeviceName === 'function' && getDeviceName()) || '';
}
function _ceNombre(p) {
  // "Apple" + "iPhone 12" no tiene que quedar "iPhone iPhone 12"
  const marca = _ceMarca(p.marca);
  const repite = marca && String(p.modelo || '').toLowerCase().startsWith(marca.toLowerCase());
  return [repite ? '' : marca, p.modelo, p.almacenamiento, p.color].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || '(sin nombre)';
}

// Lo que hay que controlar: lo que figura en stock (los reservados también
// están en el local)
function ceLista(stock) {
  return (stock || []).filter(p => p && p.id && !p.vendido)
    .sort((a, b) => _ceNombre(a).localeCompare(_ceNombre(b), 'es', { numeric: true }));
}
function ceEstadoDe(id, ctl) {
  const m = ctl && ctl.marcas && ctl.marcas[id];
  return m && (m.r === 'ok' || m.r === 'falta') ? m.r : '';
}
function ceFiltrar(lista, f, ctl) {
  const q = String(f.q || '').trim().toLowerCase();
  return lista.filter(p => {
    if (f.marca && _ceMarca(p.marca) !== f.marca) return false;
    if (f.estado && p.estado !== f.estado) return false;
    if (f.ubic === '-' ? !!p.ubicacion : (f.ubic && p.ubicacion !== f.ubic)) return false;
    const e = ceEstadoDe(p.id, ctl);
    if (f.ver === 'pend' && e) return false;
    if (f.ver === 'ok' && e !== 'ok') return false;
    if (f.ver === 'falta' && e !== 'falta') return false;
    if (q) {
      const hay = `${_ceNombre(p)} ${p.imei || ''} ${p.imei2 || ''} ${p.codigo || ''} ${p.codigoCorto || ''} ${p.notas || ''}`.toLowerCase();
      if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  });
}
function ceResumen(lista, ctl) {
  const r = { total: lista.length, ok: 0, falta: 0, pend: 0 };
  lista.forEach(p => { const e = ceEstadoDe(p.id, ctl); if (e === 'ok') r.ok++; else if (e === 'falta') r.falta++; else r.pend++; });
  return r;
}

// Un código leído → el equipo. La etiqueta (código largo o corto TP#####) o
// el IMEI entero; tipeado a mano alcanza con los últimos 5 o más números si
// hay uno solo en stock que termine así.
function ceBuscarCodigo(cod, stock) {
  const t = String(cod || '').trim();
  if (!t) return null;
  const exacto = (typeof stockPorCodigo === 'function') ? stockPorCodigo(t, stock) : null;
  if (exacto) return exacto;
  const T = t.toUpperCase();
  const igual = c => c != null && String(c).trim().toUpperCase() === T;
  const uno = (stock || []).filter(p => [p.codigo, p.codigoCorto, p.imei, p.imei2].some(igual));
  if (uno.length) return uno.find(p => !p.vendido) || uno[0];
  if (/^\d{5,}$/.test(t)) {
    const fin = (stock || []).filter(p => !p.vendido && [p.imei, p.imei2].some(i => i && String(i).endsWith(t)));
    if (fin.length === 1) return fin[0];
  }
  return null;
}

// ── Base ────────────────────────────────────────────────────
function _ceEscuchar() {
  if (_ceUnsub || typeof db === 'undefined' || !db) return;
  _ceUnsub = _ceDoc().onSnapshot(d => {
    _ceCtl = d.exists ? d.data() : null;
    cePintar();
  }, e => { console.error('control de stock:', e); _ceUnsub = null; });
}
function _ceGuardarMarca(id, valor) {
  if (!_ceCtl) _ceCtl = { inicio: new Date().toISOString(), por: _ceQuien(), marcas: {}, extras: [] };
  _ceCtl.marcas = _ceCtl.marcas || {};
  const base = { tipo: 'equipos', inicio: _ceCtl.inicio || new Date().toISOString(), por: _ceCtl.por || _ceQuien() };
  if (valor) {
    _ceCtl.marcas[id] = valor;
    return _ceDoc().set(Object.assign(base, { marcas: { [id]: valor } }), { merge: true });
  }
  delete _ceCtl.marcas[id];
  return _ceDoc().set(Object.assign(base, { marcas: { [id]: firebase.firestore.FieldValue.delete() } }), { merge: true });
}

// ✓ / ✗ (tocar el mismo otra vez lo deja sin controlar)
function ceMarcar(id, r) {
  const ya = ceEstadoDe(id, _ceCtl);
  const valor = ya === r ? null : { r, t: Date.now(), por: _ceQuien() };
  _ceUltimo = valor ? id : null;
  _ceGuardarMarca(id, valor).catch(e => { console.error('control de stock:', e); toast('No se pudo guardar la marca (¿sin señal?). Queda en este aparato y sube sola.', 'error'); });
  cePintar();
}

// Algo escaneado que no está en el stock (o figura vendido): aparte
function _ceExtra(e) {
  if (!_ceCtl) _ceCtl = { inicio: new Date().toISOString(), por: _ceQuien(), marcas: {}, extras: [] };
  _ceCtl.extras = (_ceCtl.extras || []).filter(x => x.cod !== e.cod).concat([e]);
  _ceDoc().set({ tipo: 'equipos', inicio: _ceCtl.inicio, por: _ceCtl.por || _ceQuien(), extras: _ceCtl.extras }, { merge: true })
    .catch(err => console.error('control de stock:', err));
}

function ceCodigo(cod) {
  const t = String(cod || '').trim();
  const inp = document.getElementById('ce-cod');
  if (inp) inp.value = '';
  if (!t) return;
  const p = ceBuscarCodigo(t, _ceStock());
  if (!p) {
    _ceExtra({ cod: t, tipo: 'desconocido', t: Date.now(), por: _ceQuien() });
    toast(`❓ ${t}: no está en el stock. Quedó anotado para revisar.`, 'error');
    cePintar();
    return;
  }
  if (p.vendido) {
    _ceExtra({ cod: t, tipo: 'vendido', id: p.id, nombre: _ceNombre(p), t: Date.now(), por: _ceQuien() });
    toast(`⚠️ ${_ceNombre(p)} figura VENDIDO y está acá. Quedó anotado para revisar.`, 'error');
    cePintar();
    return;
  }
  if (ceEstadoDe(p.id, _ceCtl) === 'ok') { toast(`Ya estaba controlado: ${_ceNombre(p)}`, 'info'); _ceUltimo = p.id; cePintar(); return; }
  ceMarcar(p.id, 'ok');
  toast(`✅ ${_ceNombre(p)}`, 'success');
}

function ceEscanear() {
  if (typeof abrirEscaner !== 'function') { toast('El lector no está en esta pantalla', 'error'); return; }
  abrirEscaner(cod => ceCodigo(cod), { continuo: true, titulo: 'Control de stock: escaneá las etiquetas' });
}

// ── Pantalla ────────────────────────────────────────────────
function _ceEstilos() {
  if (document.getElementById('ce-css')) return;
  const s = document.createElement('style');
  s.id = 'ce-css';
  s.textContent = `
  #ce-modal .modal-card{max-width:760px;width:100%}
  #ce-modal .ce-top{padding:10px 16px 0;display:flex;flex-direction:column;gap:8px}
  #ce-modal .ce-barra{height:10px;border-radius:6px;background:var(--bg2);overflow:hidden;display:flex}
  #ce-modal .ce-barra i{display:block;height:100%}
  #ce-modal .ce-cnt{display:flex;gap:6px;flex-wrap:wrap}
  #ce-modal .ce-chip{border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer}
  #ce-modal .ce-chip.on{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:700}
  #ce-modal .ce-filtros{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px}
  #ce-modal .ce-filtros select,#ce-modal .ce-filtros input{min-width:0}
  #ce-modal .ce-scan{display:flex;gap:6px}
  #ce-modal .ce-scan input{flex:1;min-width:0;font-size:16px}
  #ce-modal .ce-fila{display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--border)}
  #ce-modal .ce-fila.ultimo{background:var(--accent-soft)}
  #ce-modal .ce-fila .ce-info{flex:1;min-width:0}
  #ce-modal .ce-fila b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #ce-modal .ce-fila small{color:var(--text3);font-size:12px}
  #ce-modal .ce-btn{width:46px;height:42px;border-radius:10px;border:1px solid var(--border);background:var(--bg);font-size:18px;cursor:pointer;flex:none}
  #ce-modal .ce-btn.ok.on{background:var(--grn);border-color:var(--grn);color:#fff}
  #ce-modal .ce-btn.falta.on{background:var(--red);border-color:var(--red);color:#fff}
  #ce-modal .ce-extra{background:var(--bg2);border-radius:10px;padding:8px 10px;font-size:13px}
  /* Los botones de abajo siempre a la vista */
  #ce-modal .modal-footer{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--border);z-index:1}
  /* En el celu, una sola barra para bajar (no una lista con su propia barra adentro) */
  @media (max-width:640px){#ce-modal .modal-body{max-height:none!important;overflow:visible!important}}
  `;
  document.head.appendChild(s);
}

function ceAbrir() {
  if (typeof closeSheet === 'function') closeSheet();
  if (!ceLista(_ceStock()).length) { toast('No hay equipos en stock para controlar', 'error'); return; }
  _ceEstilos();
  document.getElementById('ce-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'ce-modal';
  m.className = 'modal-overlay';
  m.innerHTML = `
  <div class="modal-card form-card">
    <div class="modal-header">
      <h3>✅ Control de stock <small id="ce-desde" style="font-weight:500;color:var(--text3)"></small></h3>
      <button class="modal-close" onclick="ceCerrar()">✕</button>
    </div>
    <div class="ce-top">
      <div class="ce-scan">
        <input id="ce-cod" class="fi" placeholder="Escaneá la etiqueta o escribí el IMEI (o el final)" enterkeyhint="go" autocomplete="off"
               onkeydown="if(event.key==='Enter'){event.preventDefault();ceCodigo(this.value)}">
        <button type="button" class="btn-secondary" onclick="ceEscanear()" title="Escanear con la cámara">📷</button>
      </div>
      <div class="ce-barra" id="ce-barra"></div>
      <div class="ce-cnt" id="ce-cnt"></div>
      <div class="ce-filtros">
        <input id="ce-q" class="fi" placeholder="🔍 Buscar" oninput="ceFiltro('q', this.value)">
        <select id="ce-marca" class="fi" onchange="ceFiltro('marca', this.value)"></select>
        <select id="ce-estado" class="fi" onchange="ceFiltro('estado', this.value)"></select>
        <select id="ce-ubic" class="fi" onchange="ceFiltro('ubic', this.value)"></select>
      </div>
      <div id="ce-extras"></div>
    </div>
    <div class="modal-body" id="ce-lista" style="max-height:52vh;overflow:auto;gap:0"></div>
    <div class="modal-footer" style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;padding:12px 16px">
      <button class="btn-secondary" onclick="ceImprimir()">🖨️ Imprimir lista</button>
      <div style="display:flex;gap:8px">
        <button class="btn-secondary" onclick="ceCerrar()">Seguir después</button>
        <button class="btn-primary" onclick="ceTerminar()">Terminar control</button>
      </div>
    </div>
  </div>`;
  m.addEventListener('click', e => { if (e.target === m) ceCerrar(); });
  document.body.appendChild(m);
  _cePintarFiltros();
  _ceEscuchar();
  cePintar();
  setTimeout(() => document.getElementById('ce-cod')?.focus(), 100);
}

function _cePintarFiltros() {
  const lista = ceLista(_ceStock());
  const opts = (id, todos, valores, nombres) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<option value="">${todos}</option>` + valores.map(v => `<option value="${esc(v)}"${_ceFiltro[id.slice(3)] === v ? ' selected' : ''}>${esc((nombres && nombres[v]) || v)}</option>`).join('');
  };
  const unicos = f => [...new Set(lista.map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  opts('ce-marca', 'Todas las marcas', unicos(p => _ceMarca(p.marca)));
  opts('ce-estado', 'Nuevos y usados', unicos(p => p.estado));
  const ubis = unicos(p => p.ubicacion);
  if (lista.some(p => !p.ubicacion)) ubis.push('-');
  opts('ce-ubic', 'Todo el local', ubis, { '-': 'Sin ubicación' });
}

function ceFiltro(k, v) {
  _ceFiltro[k] = v;
  cePintar();
}

function cePintar() {
  const cont = document.getElementById('ce-lista');
  if (!cont) return;
  const todos = ceLista(_ceStock());
  // El progreso es de lo que estás mirando con los filtros (sin el de "ver")
  const base = ceFiltrar(todos, Object.assign({}, _ceFiltro, { ver: '' }), _ceCtl);
  const r = ceResumen(base, _ceCtl);
  const pc = n => (r.total ? (n / r.total * 100) : 0).toFixed(1) + '%';
  document.getElementById('ce-barra').innerHTML = `<i style="width:${pc(r.ok)};background:var(--grn)"></i><i style="width:${pc(r.falta)};background:var(--red)"></i>`;
  const chip = (v, txt) => `<button type="button" class="ce-chip${_ceFiltro.ver === v ? ' on' : ''}" onclick="ceFiltro('ver','${v}')">${txt}</button>`;
  document.getElementById('ce-cnt').innerHTML = chip('', `Todos ${r.total}`) + chip('pend', `⏳ Sin controlar ${r.pend}`)
    + chip('ok', `✅ Están ${r.ok}`) + chip('falta', `❌ Faltan ${r.falta}`);
  const desde = document.getElementById('ce-desde');
  if (desde) desde.textContent = _ceCtl && _ceCtl.inicio ? 'empezado el ' + new Date(_ceCtl.inicio).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nuevo';

  const extras = (_ceCtl && _ceCtl.extras) || [];
  document.getElementById('ce-extras').innerHTML = extras.length ? `<div class="ce-extra">⚠️ <b>Para revisar:</b> ${extras.map(e =>
    e.tipo === 'vendido' ? `${esc(e.nombre)} figura vendido y está en el local` : `${esc(e.cod)} no está en el stock`).join(' · ')}</div>` : '';

  const lista = ceFiltrar(todos, _ceFiltro, _ceCtl);
  cont.innerHTML = lista.length ? lista.map(p => {
    const e = ceEstadoDe(p.id, _ceCtl);
    const sub = [p.estado, p.imei ? 'IMEI …' + String(p.imei).slice(-5) : '', p.ubicacion, p.reservado ? '🔖 reservado' : '',
                 p.bateria ? '🔋' + p.bateria + '%' : ''].filter(Boolean).join(' · ');
    return `<div class="ce-fila${_ceUltimo === p.id ? ' ultimo' : ''}">
      <div class="ce-info"><b>${esc(_ceNombre(p))}</b><small>${esc(sub)}</small></div>
      <button type="button" class="ce-btn ok${e === 'ok' ? ' on' : ''}" title="Está" onclick="ceMarcar('${esc(p.id)}','ok')">✓</button>
      <button type="button" class="ce-btn falta${e === 'falta' ? ' on' : ''}" title="No lo encuentro" onclick="ceMarcar('${esc(p.id)}','falta')">✗</button>
    </div>`;
  }).join('') : `<p style="color:var(--text3);padding:12px 0">${_ceFiltro.ver === 'pend' && r.total ? '🎉 No queda ninguno sin controlar con estos filtros.' : 'No hay equipos con estos filtros.'}</p>`;
}

function ceCerrar() {
  if (_ceUnsub) { _ceUnsub(); _ceUnsub = null; }
  document.getElementById('ce-modal')?.remove();
  _ceTilePintar(_ceCtl);
}
function _ceTilePintar(ctl) {
  const el = document.getElementById('s-control');
  if (!el) return;
  const r = ceResumen(ceLista(_ceStock()), ctl);
  el.textContent = ctl && (r.ok || r.falta) ? `${r.ok + r.falta}/${r.total}` : '—';
}

// El texto del resumen (WhatsApp / historial)
function ceResumenTexto(todos, ctl) {
  const r = ceResumen(todos, ctl);
  const faltan = todos.filter(p => ceEstadoDe(p.id, ctl) === 'falta');
  const pend = todos.filter(p => !ceEstadoDe(p.id, ctl));
  const extras = (ctl && ctl.extras) || [];
  const lineas = [`✅ Control de stock de equipos — ${new Date().toLocaleDateString('es-AR')}`,
    `Están: ${r.ok} de ${r.total}`];
  if (faltan.length) lineas.push('', `❌ No se encontraron (${faltan.length}):`, ...faltan.map(p => '• ' + _ceNombre(p) + (p.imei ? ' · IMEI ' + p.imei : '')));
  if (pend.length) lineas.push('', `⏳ Sin controlar (${pend.length}):`, ...pend.map(p => '• ' + _ceNombre(p)));
  if (extras.length) lineas.push('', '⚠️ Para revisar:', ...extras.map(e => '• ' + (e.tipo === 'vendido' ? e.nombre + ' figura vendido y estaba en el local' : e.cod + ' no está en el stock')));
  return lineas.join('\n');
}

async function ceTerminar() {
  const todos = ceLista(_ceStock());
  const r = ceResumen(todos, _ceCtl);
  if (!r.ok && !r.falta) { toast('Todavía no controlaste ningún equipo', 'info'); return; }
  if (!confirm(`¿Terminar el control?\n\n✅ Están: ${r.ok}\n❌ Faltan: ${r.falta}\n⏳ Sin controlar: ${r.pend}\n\nQueda guardado en el historial y la próxima vez arranca de cero.`)) return;
  const texto = ceResumenTexto(todos, _ceCtl);
  const fin = new Date().toISOString();
  const hist = {
    tipo: 'equipos', inicio: (_ceCtl && _ceCtl.inicio) || fin, fin, por: (_ceCtl && _ceCtl.por) || _ceQuien(), cerradoPor: _ceQuien(),
    resumen: r, texto,
    faltan: todos.filter(p => ceEstadoDe(p.id, _ceCtl) === 'falta').map(p => ({ id: p.id, nombre: _ceNombre(p), imei: p.imei || '' })),
    sinControlar: todos.filter(p => !ceEstadoDe(p.id, _ceCtl)).map(p => ({ id: p.id, nombre: _ceNombre(p) })),
    extras: (_ceCtl && _ceCtl.extras) || [],
  };
  try {
    const batch = db.batch();
    batch.set(db.collection(CE_COL).doc('equipos-' + fin.replace(/[:.]/g, '-')), hist);
    batch.delete(_ceDoc());
    await batch.commit();
  } catch (e) {
    console.error('control de stock:', e);
    toast('No se pudo guardar el cierre del control (¿sin señal?). Probá de nuevo.', 'error');
    return;
  }
  ceCerrar();
  _ceCtl = null;
  _ceMostrarResumen(texto);
}

function _ceMostrarResumen(texto) {
  document.getElementById('ce-fin')?.remove();
  const m = document.createElement('div');
  m.id = 'ce-fin';
  m.className = 'modal-overlay';
  m.innerHTML = `<div class="modal-card form-card" style="max-width:560px">
    <div class="modal-header"><h3>✅ Control terminado</h3><button class="modal-close" onclick="document.getElementById('ce-fin').remove()">✕</button></div>
    <div class="modal-body"><pre style="white-space:pre-wrap;font:inherit;font-size:14px;margin:0">${esc(texto)}</pre></div>
    <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px">
      <button class="btn-secondary" id="ce-copiar">📋 Copiar</button>
      <button class="btn-primary" id="ce-wa">💬 Mandar por WhatsApp</button>
    </div></div>`;
  document.body.appendChild(m);
  document.getElementById('ce-copiar').onclick = () => {
    try { navigator.clipboard.writeText(texto).then(() => toast('Copiado', 'success')); } catch { toast('No se pudo copiar', 'error'); }
  };
  document.getElementById('ce-wa').onclick = () => {
    const url = 'https://wa.me/?text=' + encodeURIComponent(texto);
    if (typeof waAbrir === 'function') waAbrir(url); else window.open(url, '_blank');
  };
}

// Para el que prefiere papel: la lista de lo que estás viendo, con casilleros
function ceImprimir() {
  const lista = ceFiltrar(ceLista(_ceStock()), _ceFiltro, _ceCtl);
  if (!lista.length) { toast('No hay equipos con estos filtros', 'error'); return; }
  const filtros = [_ceFiltro.marca, _ceFiltro.estado, _ceFiltro.ubic === '-' ? 'sin ubicación' : _ceFiltro.ubic, _ceFiltro.q].filter(Boolean).join(' · ');
  const filas = lista.map((p, i) => {
    const e = ceEstadoDe(p.id, _ceCtl);
    return `<tr><td>${i + 1}</td><td>${esc(_ceNombre(p))}</td><td>${esc(p.estado || '')}</td><td>${esc(p.imei || '')}</td><td>${esc(p.ubicacion || '')}</td>`
      + `<td class="c">${e === 'ok' ? '✓' : '☐'}</td><td class="c">${e === 'falta' ? '✗' : '☐'}</td></tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Control de stock</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;margin:14mm}
    h1{font-size:17px;margin:0 0 4px} p{margin:0 0 10px;color:#555}
    table{width:100%;border-collapse:collapse} th,td{border:1px solid #999;padding:5px 6px;text-align:left} th{background:#eee}
    td.c,th.c{text-align:center;width:42px;font-size:15px}
  </style></head><body>
    <h1>✅ Control de stock de equipos — ${new Date().toLocaleDateString('es-AR')}</h1>
    <p>${lista.length} equipos${filtros ? ' · ' + esc(filtros) : ''} · Controló: ____________________</p>
    <table><thead><tr><th>#</th><th>Equipo</th><th>Estado</th><th>IMEI</th><th>Dónde</th><th class="c">Está</th><th class="c">Falta</th></tr></thead><tbody>${filas}</tbody></table>
  </body></html>`;
  if (typeof _openPrint === 'function') { _openPrint(html, 'Control de stock'); return; }
  const w = window.open('', '_blank');
  if (!w) { alert('Habilitá los popups para imprimir.'); return; }
  w.document.write(html); w.document.close(); w.focus(); w.print();
}

// El cuadrito de la barra del stock: cómo va el control abierto. Lee el doc
// una vez al abrir la app (1 lectura), no se queda escuchando.
async function ceTileActualizar() {
  const el = document.getElementById('s-control');
  if (!el || typeof db === 'undefined' || !db) return;
  try {
    const d = await _ceDoc().get();
    _ceTilePintar(d.exists ? d.data() : null);
  } catch (e) { /* sin señal: queda como estaba */ }
}
if (typeof window !== 'undefined' && window.addEventListener) {
  // Cuando ya cargó el stock (y hay sesión)
  window.addEventListener('load', () => setTimeout(ceTileActualizar, 8000));
}
