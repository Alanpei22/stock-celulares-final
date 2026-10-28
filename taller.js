// ══════════════════════════════════════════════════════════════
// 🔧 Tablero del taller — segunda vista del Dashboard
// ══════════════════════════════════════════════════════════════
// Para dejar abierto en la compu del local: de un vistazo, qué hay en el
// taller, qué está listo para avisarle al cliente, qué se está demorando y
// quién está trabajando. SIN MONTOS: lo puede mirar cualquiera que pase por
// el mostrador (la plata sigue en la vista 📊 Números).
//
// La idea vino de las "oficinas virtuales" con un muñequito por persona: acá
// cada uno tiene su avatar (inicial y color propio) en "trabajando ahora" y
// en las reparaciones que tiene en la mesa.
//
// CUPO: las reparaciones salen de REPAIRS (el listener que la app ya tiene
// abierto). Lo único nuevo es un listener chico a las fichadas de HOY, y solo
// mientras se mira el tablero.
'use strict';

let _tlModo = 'numeros';        // 'numeros' | 'taller'
let _tlFichadas = [];
let _tlFichUnsub = null;
let _tlReloj = null;

function _tlEsc(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function _tlHoyAR(ms) { return new Date((ms || Date.now()) - 3 * 3600e3).toISOString().slice(0, 10); }

// ── Avatares: inicial + un color fijo por persona ──
const _TL_COLORES = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626'];
function tallerColor(nombre) {
  const s = String(nombre || '').trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return _TL_COLORES[h % _TL_COLORES.length];
}
function tallerAvatar(nombre, chico) {
  const n = String(nombre || '').trim();
  const ini = n ? n.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase() : '?';
  return `<span class="tl-ava${chico ? ' tl-ava--chico' : ''}" style="background:${tallerColor(n)}" title="${_tlEsc(n)}">${_tlEsc(ini)}</span>`;
}

// ── Desde cuándo está en lo que está (la fase actual, o el ingreso) ──
function _tlDesde(r) {
  // El mismo reloj que la lista de reparaciones (tp-fases.js)
  if (typeof tpDesde === 'function') return tpDesde(r);
  const h = (typeof tpHistorial === 'function') ? tpHistorial(r) : [];
  const ult = h.length ? h[h.length - 1].t : null;
  return ult || r.fechaListo || r.fechaIngreso || '';
}
function _tlHace(iso) {
  if (!iso) return '';
  if (typeof tpTxtTiempo === 'function') return tpTxtTiempo(iso);
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  return h < 1 ? Math.max(1, Math.round(h * 60)) + ' min' : h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' d';
}
function _tlDemorada(r) {
  if (typeof _repDemorado === 'function') return _repDemorado(r);
  return r.estado === 'reparando' && r.fechaIngreso && (Date.now() - new Date(r.fechaIngreso)) / 86400000 > 3;
}

// Lo que entró hace más de esto no va a las columnas. En la base quedaron
// órdenes de hace años que nunca se cerraron (102 "listas" en el primer
// intento, una de hace 945 días): taparían el taller de verdad. Se cuentan
// aparte, con un aviso para revisarlas en Reparaciones.
const TL_DIAS_MAX = 60;

// Las tres columnas (aparte para poder probarlo)
function tallerColumnas(reps, ahora) {
  const lista = Array.isArray(reps) ? reps : [];
  const corte = (ahora || Date.now()) - TL_DIAS_MAX * 86400e3;
  const reciente = r => { const t = r.fechaIngreso ? new Date(r.fechaIngreso).getTime() : 0; return t && t >= corte; };
  const abiertas = lista.filter(r => r.estado === 'reparando' || r.estado === 'listo');
  const viejo = (a, b) => String(_tlDesde(a)).localeCompare(String(_tlDesde(b)));
  const reparando = abiertas.filter(r => r.estado === 'reparando' && reciente(r));
  const viejas = abiertas.filter(r => !reciente(r));
  return {
    reparando: reparando.filter(r => !_tlDemorada(r)).sort(viejo),
    listas: abiertas.filter(r => r.estado === 'listo' && reciente(r)).sort(viejo),
    demoradas: reparando.filter(r => _tlDemorada(r)).sort(viejo),
    viejas: { reparando: viejas.filter(r => r.estado === 'reparando').length, listas: viejas.filter(r => r.estado === 'listo').length },
  };
}

// Cuántas entraron y se entregaron hoy (día argentino)
function tallerHoy(reps, ahora) {
  const hoy = _tlHoyAR(ahora);
  const dia = iso => iso ? _tlHoyAR(new Date(iso).getTime()) : '';
  const lista = Array.isArray(reps) ? reps : [];
  return {
    entraron: lista.filter(r => dia(r.fechaIngreso) === hoy).length,
    entregadas: lista.filter(r => r.estado === 'entregado' && dia(r.fechaEntrega) === hoy).length,
  };
}

// Quién está adentro según las fichadas de hoy: [{ nombre, desde }]
function tallerAdentro(fichadas, ahora) {
  if (typeof horasTurnos !== 'function') return [];
  return horasTurnos(fichadas || [], ahora || Date.now())
    .filter(t => t.enCurso)
    .map(t => ({ nombre: t.nombre || '', desde: t.desde }))
    .sort((a, b) => a.desde - b.desde);
}

function _tlTarjeta(r, tipo) {
  const equipo = [r.marca, r.modelo].filter(Boolean).join(' ') || 'Equipo';
  const fase = (typeof tpFaseInfo === 'function' && r.estado === 'reparando') ? tpFaseInfo(r).corto : '';
  const que = r.arreglo || r.falla || '';
  const hace = _tlHace(tipo === 'demorada' ? r.fechaIngreso : _tlDesde(r));
  return `<div class="tl-card tl-card--${tipo}" role="button" tabindex="0" onclick="openRepairDetail('${_tlEsc(r.id)}')">
    <div class="tl-card-top">
      <span class="tl-orden">#${_tlEsc(r.nOrden || '?')}</span>
      <span class="tl-hace">${tipo === 'lista' ? 'lista hace ' : ''}${_tlEsc(hace)}</span>
    </div>
    <div class="tl-equipo">${_tlEsc(equipo)}</div>
    <div class="tl-que">${_tlEsc(que)}${fase && tipo !== 'lista' ? ` · <span class="tl-fase">${_tlEsc(fase)}</span>` : ''}</div>
    <div class="tl-card-pie">
      ${r.tecnico ? `${tallerAvatar(r.tecnico, true)}<span class="tl-tec">${_tlEsc(r.tecnico)}</span>` : '<span class="tl-tec tl-sin">sin técnico</span>'}
      ${tipo === 'lista' && r.nombre ? `<span class="tl-cli">👤 ${_tlEsc(r.nombre)}</span>` : ''}
    </div>
  </div>`;
}

function _tlColumna(titulo, ico, cls, items, tipo, vacio) {
  return `<section class="tl-col tl-col--${cls}">
    <h3>${ico} ${titulo} <span class="tl-cuenta">${items.length}</span></h3>
    <div class="tl-col-lista">${items.length ? items.map(r => _tlTarjeta(r, tipo)).join('') : `<p class="tl-vacio">${vacio}</p>`}</div>
  </section>`;
}

// Los estilos van ACÁ y no en dashboard.css: el CSS se sirve del caché y se
// actualiza atrás, así que después de un deploy el celu tenía el programa
// nuevo con el diseño viejo y el tablero salía como texto suelto (y sin la
// regla que esconde los montos). Viajando con el JS, llegan juntos.
function _tlEstilos() {
  if (document.getElementById('tl-estilos')) return;
  const st = document.createElement('style');
  st.id = 'tl-estilos';
  st.textContent = [
    '#dash-section .d-modo { margin-left: auto; margin-right: 10px; }',
    '#dash-section .d-modo button { font-size: 13px; padding: 6px 12px; }',
    '#dash-section .d-taller { display: none; }',
    '#dash-section.modo-taller .dash-body > *:not(.d-topbar):not(.d-taller) { display: none !important; }',
    '#dash-section.modo-taller .d-taller { display: block; }',
    '.d-taller .tl-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin: 6px 0 16px; }',
    '.d-taller .tl-reloj b { font-size: 40px; font-weight: 800; letter-spacing: -1px; font-variant-numeric: tabular-nums; }',
    '.d-taller .tl-reloj span { color: var(--d-mut); font-size: 16px; margin-left: 8px; text-transform: capitalize; }',
    '.d-taller .tl-gente { display: flex; gap: 14px; flex-wrap: wrap; }',
    '.d-taller .tl-persona { display: flex; align-items: center; gap: 8px; background: var(--d-card); border: 1px solid var(--d-bd); border-radius: 999px; padding: 4px 14px 4px 4px; }',
    '.d-taller .tl-persona b { display: block; font-size: 15px; }',
    '.d-taller .tl-persona small { color: var(--d-mut); font-size: 12px; }',
    '.d-taller .tl-ava { width: 38px; height: 38px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-weight: 800; font-size: 15px; flex: none; box-shadow: 0 0 0 2px rgba(255,255,255,.08); }',
    '.d-taller .tl-ava--chico { width: 24px; height: 24px; font-size: 11px; }',
    '.d-taller .tl-cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }',
    '@media (max-width: 900px) { .d-taller .tl-cols { grid-template-columns: 1fr; } .d-taller .tl-col-lista { max-height: none; } .d-taller .tl-reloj b { font-size: 30px; } .d-taller .tl-col { min-height: 0; } }',
    '.d-taller .tl-col { background: var(--d-card); border: 1px solid var(--d-bd); border-radius: var(--d-r); padding: 12px; min-height: 200px; }',
    '.d-taller .tl-col h3 { margin: 0 0 10px; font-size: 18px; display: flex; align-items: center; gap: 8px; }',
    '.d-taller .tl-cuenta { margin-left: auto; font-size: 15px; background: var(--d-bd-2); border-radius: 999px; padding: 2px 10px; }',
    '.d-taller .tl-col--lista h3 { color: var(--d-green); }',
    '.d-taller .tl-col--dem h3 { color: var(--d-red); }',
    '.d-taller .tl-col-lista { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 290px); overflow: auto; }',
    '.d-taller .tl-card { background: var(--d-bg); border: 1px solid var(--d-bd); border-left: 4px solid var(--d-cyan); border-radius: 10px; padding: 10px 12px; cursor: pointer; }',
    '.d-taller .tl-card:hover { border-color: var(--d-bd-2); }',
    '.d-taller .tl-card--lista { border-left-color: var(--d-green); }',
    '.d-taller .tl-card--demorada { border-left-color: var(--d-red); }',
    '.d-taller .tl-card-top { display: flex; justify-content: space-between; font-size: 13px; color: var(--d-mut); }',
    '.d-taller .tl-orden { font-weight: 800; color: var(--d-tx); }',
    '.d-taller .tl-card--demorada .tl-hace { color: var(--d-red); font-weight: 700; }',
    '.d-taller .tl-equipo { font-size: 18px; font-weight: 800; margin: 2px 0; }',
    '.d-taller .tl-que { font-size: 14px; color: var(--d-mut); }',
    '.d-taller .tl-fase { color: var(--d-amber); }',
    '.d-taller .tl-card-pie { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 13px; }',
    '.d-taller .tl-cli { margin-left: auto; color: var(--d-mut); }',
    '.d-taller .tl-sin { color: var(--d-mut); font-style: italic; }',
    '.d-taller .tl-vacio { color: var(--d-mut); text-align: center; padding: 24px 0; }',
    '.d-taller .tl-pie { margin-top: 14px; color: var(--d-mut); font-size: 16px; }',
    '.d-taller .tl-pie b { color: var(--d-tx); font-size: 18px; }',
    '.d-taller .tl-viejas { margin-top: 10px; padding: 10px 12px; border: 1px dashed var(--d-bd-2); border-radius: 10px; color: var(--d-mut); font-size: 14px; }',
  ].join('\n');
  document.head.appendChild(st);
}

const _TL_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function tallerRender() {
  const cont = document.getElementById('d-taller');
  if (!cont || _tlModo !== 'taller') return;
  _tlEstilos();
  const reps = (typeof REPAIRS !== 'undefined' && Array.isArray(REPAIRS)) ? REPAIRS : [];
  const c = tallerColumnas(reps);
  const hoy = tallerHoy(reps);
  const gente = tallerAdentro(_tlFichadas);
  const ahora = new Date(Date.now() - 3 * 3600e3);
  const hhmm = ahora.toISOString().slice(11, 16);
  const fecha = `${_TL_DIAS[ahora.getUTCDay()]} ${ahora.toISOString().slice(8, 10)}/${ahora.toISOString().slice(5, 7)}`;
  const horaDe = ms => new Date(ms - 3 * 3600e3).toISOString().slice(11, 16);
  cont.innerHTML = `
    <div class="tl-top">
      <div class="tl-reloj"><b>${hhmm}</b> <span>${_tlEsc(fecha)}</span></div>
      <div class="tl-gente">${gente.length
        ? gente.map(g => `<span class="tl-persona">${tallerAvatar(g.nombre)}<span><b>${_tlEsc(g.nombre)}</b><small>🟢 desde ${horaDe(g.desde)}</small></span></span>`).join('')
        : `<span class="tl-sin">${_tlFichUnsub ? 'Nadie fichó entrada todavía' : ''}</span>`}</div>
    </div>
    <div class="tl-cols">
      ${_tlColumna('En reparación', '🔧', 'rep', c.reparando, 'rep', 'Nada en la mesa')}
      ${_tlColumna('Listas para retirar', '✅', 'lista', c.listas, 'lista', 'Ninguna esperando al cliente')}
      ${_tlColumna('Demoradas', '⚠️', 'dem', c.demoradas, 'demorada', 'Ninguna demorada 👌')}
    </div>
    <div class="tl-pie">Hoy: entraron <b>${hoy.entraron}</b> · se entregaron <b>${hoy.entregadas}</b></div>
    ${(c.viejas.reparando + c.viejas.listas) ? `<div class="tl-viejas">🗂️ Además hay órdenes abiertas de hace más de ${TL_DIAS_MAX} días que no se muestran acá:
      ${[c.viejas.listas ? `<b>${c.viejas.listas}</b> listas sin retirar` : '', c.viejas.reparando ? `<b>${c.viejas.reparando}</b> en reparación` : ''].filter(Boolean).join(' y ')}.
      Conviene revisarlas en Reparaciones y marcarlas como entregadas o que no van.</div>` : ''}`;
}

// Fichadas de hoy, en vivo (solo mientras se mira el tablero). Las reglas
// dejan leer las de todos solo al dueño: con otra cuenta no se muestra
// "trabajando ahora" y el resto anda igual.
function _tlEscucharFichadas() {
  if (_tlFichUnsub || typeof db === 'undefined' || !db) return;
  try {
    _tlFichUnsub = db.collection('fichadas').where('dia', '==', _tlHoyAR()).onSnapshot(snap => {
      _tlFichadas = snap.docs.map(d => d.data());
      tallerRender();
    }, () => { _tlFichadas = []; if (_tlFichUnsub) { _tlFichUnsub(); } _tlFichUnsub = null; tallerRender(); });
  } catch { _tlFichUnsub = null; }
}
function _tlDejar() {
  if (_tlFichUnsub) { try { _tlFichUnsub(); } catch {} _tlFichUnsub = null; }
  if (_tlReloj) { clearInterval(_tlReloj); _tlReloj = null; }
}

// Cambia entre 📊 Números y 🔧 Taller. Se recuerda en el dispositivo: la
// compu del local queda siempre en el tablero.
// Las vistas del dashboard: 📊 Números · 🔧 Taller. (Hubo una tercera,
// 🏢 Oficina; se reemplazó por la tarjeta "Para hacer hoy" de hoy.js. Quien
// la tenía guardada vuelve a Números.)
const TL_MODOS = ['numeros', 'taller'];
function tallerModo(modo) {
  _tlModo = TL_MODOS.includes(modo) ? modo : 'numeros';
  try { localStorage.setItem('dashModo', _tlModo); } catch {}
  _tlEstilos();   // antes de esconder los números
  const sec = document.getElementById('dash-section');
  if (sec) sec.classList.toggle('modo-taller', _tlModo === 'taller');
  document.querySelectorAll('#d-modo button').forEach(b => b.classList.toggle('sel', b.dataset.modo === _tlModo));
  if (_tlModo === 'taller') {
    _tlEscucharFichadas();
    if (!_tlReloj) _tlReloj = setInterval(tallerRender, 60000);   // la hora y los "hace X"
    tallerRender();
  } else _tlDejar();
  if (_tlModo === 'numeros' && typeof renderDashboard === 'function') renderDashboard();
}

function tallerModoGuardado() {
  let m = 'numeros';
  try { m = localStorage.getItem('dashModo') || 'numeros'; } catch {}
  return TL_MODOS.includes(m) ? m : 'numeros';
}
function tallerActivo() { return _tlModo === 'taller'; }

// Los estilos del tablero (y el del botón 📊/🔧) desde que carga la página
if (typeof document !== 'undefined' && document.head) _tlEstilos();
