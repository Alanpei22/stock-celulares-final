// ══════════════════════════════════════════
//  avisos.js — campanita de novedades de reparaciones
// ══════════════════════════════════════════
// Qué muestra: las últimas actualizaciones de reparaciones, agrupadas por
// equipo. Si una reparación cambió tres veces, es UNA fila que dice "3
// cambios", no tres filas.
//
// De dónde salen: la colección `actividad`, que ya se escribía desde 9 lugares
// (cambios de estado, ingresos, ediciones, WhatsApp). No hubo que inventar
// ningún historial nuevo.
//
// ── CUPO DE FIREBASE ─────────────────────────────────────────
// El globito con número necesita un listener vivo, pero está ACOTADO:
// `orderBy(fecha desc).limit(AVISOS_LIMITE)`. Son 60 lecturas la primera vez
// y después 1 por evento nuevo, por dispositivo. Con 3 aparatos abiertos y 50
// movimientos por día son ~330 lecturas diarias sobre 50.000 gratis.
// NUNCA agrandar esto a la colección entera ni sacarle el limit().
// Lo vigila tests/test-cupo.js.
//
// ── POR QUÉ ESTE ARCHIVO ES AUTOSUFICIENTE ───────────────────
// caja.html NO carga repairs.js. Así que acá no se puede tocar REPAIRS ni
// llamar a openRepairDetail sin chequear antes. Cada fila se dibuja con el
// `desc` que ya trae el propio doc de actividad.
'use strict';

const AVISOS_LIMITE = 60;      // techo duro de lecturas del listener
const AVISOS_MAX_FILAS = 20;   // cuántos equipos se muestran en el popup
const AVISOS_VISTO_KEY = 'avisos_visto';   // por dispositivo, no por cuenta

let _avisosUnsub = null;
let _avisosData  = [];   // eventos crudos, ya filtrados a reparaciones
let _avisosOpen  = false;

// Todos los globitos de la página (uno por sección, ver _avisosRender).
function _avisosBadges() {
  try { return Array.from(document.querySelectorAll('.avisos-badge')); }
  catch { return []; }
}

// ── Última vez que este dispositivo miró la campana ─────────
function _avisosVisto() {
  try { return localStorage.getItem(AVISOS_VISTO_KEY) || ''; } catch { return ''; }
}
function _avisosMarcarVisto() {
  try { localStorage.setItem(AVISOS_VISTO_KEY, new Date().toISOString()); } catch {}
}

// ── Agrupar por reparación ──────────────────────────────────
// Una fila por equipo, con el último cambio arriba y cuántos hubo.
function _avisosAgrupar(eventos) {
  const porRep = new Map();
  for (const ev of eventos) {
    if (!ev.repairId) continue;
    let g = porRep.get(ev.repairId);
    if (!g) {
      g = { repairId: ev.repairId, ultimo: ev, cambios: 0, nuevos: 0, eventos: [] };
      porRep.set(ev.repairId, g);
    }
    g.cambios++;
    g.eventos.push(ev);
    // Los eventos vienen ordenados por fecha desc, así que el primero manda
    if ((ev.fecha || '') > (g.ultimo.fecha || '')) g.ultimo = ev;
  }
  const visto = _avisosVisto();
  const filas = [...porRep.values()];
  filas.forEach(g => {
    g.nuevos = visto ? g.eventos.filter(e => (e.fecha || '') > visto).length : g.cambios;
  });
  filas.sort((a, b) => (b.ultimo.fecha || '').localeCompare(a.ultimo.fecha || ''));
  return filas.slice(0, AVISOS_MAX_FILAS);
}

// El globito cuenta EQUIPOS con novedades, no cambios sueltos: así el número
// siempre coincide con la cantidad de filas que ves al abrir.
function _avisosNoLeidos(filas) {
  return filas.filter(g => g.nuevos > 0).length;
}

// ── Pintado ─────────────────────────────────────────────────
function _avisosRender() {
  const filas = _avisosAgrupar(_avisosData);
  const n = _avisosNoLeidos(filas);

  // Cada sección tiene su propio header, así que el botón está repetido y hay
  // que pintarlos TODOS. Por eso el globito va por clase y no por id: con id
  // solo se actualizaría el primero y en las demás secciones no aparecería.
  _avisosBadges().forEach(b => {
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hidden', n === 0);
  });

  const lista = document.getElementById('avisos-lista');
  if (!lista) return;
  if (!filas.length) {
    lista.innerHTML = '<div class="avisos-vacio">Todavía no hay movimientos de reparaciones</div>';
    return;
  }
  lista.innerHTML = filas.map(g => {
    const ev = g.ultimo;
    const eq = (ev.extra && ev.extra.nOrden) ? `N°${ev.extra.nOrden}` : '';
    const tono = _avisosTono(ev);
    return `
      <button type="button" class="avisos-fila ${g.nuevos > 0 ? 'avisos-fila--nueva' : ''} ${tono ? 'avisos-fila--' + tono : ''}"
              onclick="avisosAbrirReparacion('${_avEsc(g.repairId)}')">
        <span class="avisos-ico">${_avisosIco(ev.tipo)}</span>
        <span class="avisos-txt">
          <span class="avisos-desc">${_avEsc(ev.desc || 'Actualización')}</span>
          <span class="avisos-meta">
            ${eq ? `<b>${_avEsc(eq)}</b> · ` : ''}${_avisosHace(ev.fecha)}
            ${g.cambios > 1 ? ` · ${g.cambios} cambios` : ''}
            ${ev.tecnico ? ` · ${_avEsc(ev.tecnico)}` : ''}
          </span>
        </span>
        ${g.nuevos > 0 ? `<span class="avisos-punto"></span>` : ''}
      </button>`;
  }).join('');
}

function _avisosIco(tipo) {
  return { estado: '🔄', ingreso: '📥', edicion: '✏️', whatsapp: '📲' }[tipo] || '🔧';
}

// ── Barrita de color del cambio de estado ───────────────────
// Todas las filas se veían iguales y había que leerlas una por una para saber
// si algo se entregó o si algo se cayó. La barrita da eso de un vistazo.
//
// Los eventos de estado vienen en dos formatos, según de dónde salió el
// cambio: `extra.estadoNuevo` si fue desde los botones de la card
// (repairs.js), o `extra.faseNueva` si fue desde el tablero (tp-fases.js).
// Se mapean los dos acá y no se depende de TP_FASES: avisos.js tiene que
// funcionar igual en caja.html.
const AVISOS_TONO = {
  // estados (repairs.js)
  reparando: 'work', listo: 'ok', entregado: 'fin', 'no va': 'bad', cancelado: 'bad',
  // fases (tp-fases.js)
  ingresado: 'wait', diagnostico: 'work', presupuestado: 'wait', aprobado: 'work',
  repuesto: 'wait', reparacion: 'work',
  irreparable: 'bad', rechazado: 'bad', abandonado: 'bad',
};

function _avisosTono(ev) {
  if (!ev || ev.tipo !== 'estado') return '';   // solo los cambios de estado
  const x = ev.extra || {};
  const destino = x.estadoNuevo || x.faseNueva || '';
  return AVISOS_TONO[destino] || '';
}

// "hace 5 min" / "hace 2 h" / "ayer" / fecha corta
function _avisosHace(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1)  return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1)  return 'ayer';
  if (d < 7)    return `hace ${d} días`;
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

// esc local: utils.js está en las dos páginas, pero este archivo no depende de él
function _avEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Abrir / cerrar el popup ─────────────────────────────────
function toggleAvisos() { _avisosOpen ? cerrarAvisos() : abrirAvisos(); }

function abrirAvisos() {
  const pop = document.getElementById('avisos-popup');
  if (!pop) return;
  _avisosOpen = true;
  pop.classList.remove('hidden');
  document.getElementById('avisos-backdrop')?.classList.remove('hidden');
  _avisosRender();                    // pintar ANTES de marcar visto
  _avisosMarcarVisto();
  // El globito se apaga al toque; las filas nuevas quedan resaltadas hasta
  // que se cierra, así se ve qué cambió.
  _avisosBadges().forEach(b => b.classList.add('hidden'));
}

function cerrarAvisos() {
  _avisosOpen = false;
  document.getElementById('avisos-popup')?.classList.add('hidden');
  document.getElementById('avisos-backdrop')?.classList.add('hidden');
  _avisosRender();
}

// Tocar una fila. En index.html abre la ficha; en caja.html repairs.js no está
// cargado, así que se navega y allá lo levanta _handleUrlAction.
function avisosAbrirReparacion(id) {
  cerrarAvisos();
  if (typeof openRepairDetail === 'function' && typeof REPAIRS !== 'undefined'
      && REPAIRS.some(r => r.id === id)) {
    openRepairDetail(id);
    return;
  }
  location.href = 'index.html?repair=' + encodeURIComponent(id);
}

// ── Arranque ────────────────────────────────────────────────
function initAvisos() {
  if (_avisosUnsub) return;                    // una sola suscripción por página
  if (typeof db === 'undefined' || !db) return;
  try {
    _avisosUnsub = db.collection('actividad')
      .orderBy('fecha', 'desc')
      .limit(AVISOS_LIMITE)                    // CUPO: nunca sacar este limit
      .onSnapshot(snap => {
        // Solo reparaciones: las ventas y altas de repuestos guardan
        // repairId en null, así que este filtro alcanza y no hace falta un
        // índice compuesto en Firestore.
        _avisosData = snap.docs.map(d => d.data()).filter(d => d && d.repairId);
        _avisosRender();
      }, err => console.warn('[avisos] listener:', err));
  } catch (e) {
    console.warn('[avisos] no se pudo iniciar:', e);
  }
}

function _avisosCleanup() {
  if (_avisosUnsub) { _avisosUnsub(); _avisosUnsub = null; }
  _avisosData = [];
}
window._avisosCleanup = _avisosCleanup;   // lo llama signOut() de auth.js
