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

// Las tres columnas (aparte para poder probarlo)
function tallerColumnas(reps) {
  const lista = Array.isArray(reps) ? reps : [];
  const viejo = (a, b) => String(_tlDesde(a)).localeCompare(String(_tlDesde(b)));
  const reparando = lista.filter(r => r.estado === 'reparando');
  return {
    reparando: reparando.filter(r => !_tlDemorada(r)).sort(viejo),
    listas: lista.filter(r => r.estado === 'listo').sort(viejo),
    demoradas: reparando.filter(r => _tlDemorada(r)).sort(viejo),
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

const _TL_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function tallerRender() {
  const cont = document.getElementById('d-taller');
  if (!cont || _tlModo !== 'taller') return;
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
    <div class="tl-pie">Hoy: entraron <b>${hoy.entraron}</b> · se entregaron <b>${hoy.entregadas}</b></div>`;
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
function tallerModo(modo) {
  _tlModo = modo === 'taller' ? 'taller' : 'numeros';
  try { localStorage.setItem('dashModo', _tlModo); } catch {}
  const sec = document.getElementById('dash-section');
  if (sec) sec.classList.toggle('modo-taller', _tlModo === 'taller');
  document.querySelectorAll('#d-modo button').forEach(b => b.classList.toggle('sel', b.dataset.modo === _tlModo));
  if (_tlModo === 'taller') {
    _tlEscucharFichadas();
    if (!_tlReloj) _tlReloj = setInterval(tallerRender, 60000);   // la hora y los "hace X"
    tallerRender();
  } else {
    _tlDejar();
    if (typeof renderDashboard === 'function') renderDashboard();
  }
}

function tallerModoGuardado() {
  try { return localStorage.getItem('dashModo') === 'taller' ? 'taller' : 'numeros'; } catch { return 'numeros'; }
}
function tallerActivo() { return _tlModo === 'taller'; }
