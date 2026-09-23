// ══════════════════════════════════════════════════════════════
//  chequeo.js — chequeo de caja obligatorio
//  ─────────────────────────────────────────────────────────────
//  El dueño configura horarios (14:00, 20:00…). Llegada la hora, la app se
//  traba en TODOS los celulares hasta que alguien cuente el efectivo. No hay
//  botón de cerrar: es el punto.
//
//  ── A ciegas ────────────────────────────────────────────────
//  La pantalla NUNCA muestra cuánto tendría que haber. Si el que cuenta ve el
//  número esperado, no está contando: está copiando. El esperado se guarda
//  aparte (`caja_chequeos_detalle`, que el empleado escribe pero no lee) y la
//  diferencia la mira el dueño después.
//
//  ── Dos colecciones a propósito ─────────────────────────────
//   · caja_chequeos          — QUE está hecho. Lo lee cualquiera: es lo que
//                              destraba la app en el resto de los celulares.
//   · caja_chequeos_detalle  — CUÁNTO había y cuánto tenía que haber.
//
//  ── Si falla el guardado ────────────────────────────────────
//  El chequeo se hizo igual: la persona contó la plata. Queda en la cola de
//  `chqPendientes` y la app se destraba. Trabarle el mostrador porque se cayó
//  internet sería el peor de los dos males (pasó con el cupo de Firebase).
//
//  Vive en las DOS páginas y es autosuficiente: index.html no carga caja.js.
// ══════════════════════════════════════════════════════════════
'use strict';

const _CHQ_CFG_KEY   = 'chqCfg';          // cache local de la config
const _CHQ_HECHOS    = 'chqHechos';       // { '2026-09-23': ['14:00'] }
const _CHQ_PEND      = 'chqPendientes';   // los que no se pudieron guardar
const _CHQ_POSPUESTOS = 'chqPospuestos';  // { '2026-09-23_1400': <ISO> }
// Saltear no perdona el chequeo: lo patea 5 minutos. Sirve para terminar la
// venta que estabas haciendo, no para saltearlo y seguir todo el día.
const _CHQ_SALTEO_MIN = 5;
const _CHQ_DENOM     = [20000, 10000, 2000, 1000, 500, 200, 100];

let CHQ_CFG        = { activo: false, horarios: [] };
let _chqTimer      = null;
let _chqCfgListener = null;
let _chqEnganchado  = false;   // los handlers de la ventana, una sola vez
let _chqAbierto  = null;    // hora del chequeo que está trabando, o null
let _chqGuardando = false;

// ── Reloj de acá ────────────────────────────────────────────
function _chqHoy()   { return (typeof _todayAR === 'function') ? _todayAR() : new Date().toISOString().slice(0, 10); }
function _chqAhora() {
  return new Date().toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
function _chqFmt(n) { return '$' + (Number(n) || 0).toLocaleString('es-AR'); }
function _chqId(fecha, hora) { return fecha + '_' + hora.replace(':', ''); }
function _chqLS(k, def) { try { return JSON.parse(localStorage.getItem(k)) || def; } catch { return def; } }
function _chqSet(k, v)  { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ── Qué ya se hizo hoy ──────────────────────────────────────
function _chqHechosHoy() {
  const d = _chqLS(_CHQ_HECHOS, {});
  return d[_chqHoy()] || [];
}
function _chqMarcar(hora) {
  const d = _chqLS(_CHQ_HECHOS, {});
  const hoy = _chqHoy();
  d[hoy] = (d[hoy] || []).concat(hora).filter((v, i, a) => a.indexOf(v) === i);
  // Los días viejos no sirven para nada
  Object.keys(d).forEach(k => { if (k < hoy) delete d[k]; });
  _chqSet(_CHQ_HECHOS, d);
}

// ── Salteos: el chequeo vuelve a los 5 minutos ──────────────
function _chqPospuestoHasta(hora) {
  const d = _chqLS(_CHQ_POSPUESTOS, {});
  const iso = d[_chqId(_chqHoy(), hora)];
  if (!iso) return 0;
  const t = Date.parse(iso);
  return t > Date.now() ? t : 0;
}
function _chqPosponer(hora, iso) {
  const d = _chqLS(_CHQ_POSPUESTOS, {});
  const hoy = _chqHoy();
  d[_chqId(hoy, hora)] = iso;
  Object.keys(d).forEach(k => { if (k.slice(0, 10) < hoy) delete d[k]; });
  _chqSet(_CHQ_POSPUESTOS, d);
}

// ── Config ──────────────────────────────────────────────────
//  El horario tiene que llegarle a TODOS los celulares, y rápido.
//
//  La primera versión leía la config UNA vez y la cacheaba 6 horas. Resultado:
//  el chequeo aparecía solo en el celular donde se había configurado, y los
//  demás seguían trabajando con la config vieja hasta que se vencía el caché.
//  Eso no es un chequeo obligatorio, es una sugerencia.
//
//  Ahora es un listener sobre UN documento: cuesta una lectura al abrir la app
//  (lo mismo que costaba el .get()) más una por cada vez que se cambian los
//  horarios. Nada que ver con enganchar una colección entera, que es lo que el
//  cupo no perdona.
function _chqSemilla() {
  // Lo último que se supo, para no arrancar en blanco mientras llega Firestore.
  const cache = _chqLS(_CHQ_CFG_KEY, null);
  if (cache && cache.cfg) CHQ_CFG = cache.cfg;
  return CHQ_CFG;
}

function _chqEscucharCfg() {
  if (_chqCfgListener) return;
  try {
    _chqCfgListener = db.collection('config').doc('chequeoCaja').onSnapshot(snap => {
      CHQ_CFG = snap.exists ? _chqNormalizar(snap.data()) : { activo: false, horarios: [] };
      _chqSet(_CHQ_CFG_KEY, { t: Date.now(), cfg: CHQ_CFG });
      // Si el dueño apagó el chequeo o sacó ese horario desde su celular, el
      // que está trabado tiene que destrabarse solo. Si no, hay que ir local
      // por local a contar plata por un horario que ya no existe.
      if (_chqAbierto && !(CHQ_CFG.activo && CHQ_CFG.horarios.indexOf(_chqAbierto) >= 0)) {
        _chqDestrabar();
      }
      _chqRevisar();
    }, e => { console.warn('[chequeo] config:', e); });
  } catch (e) { console.warn('[chequeo] config:', e); }
}

function _chqNormalizar(d) {
  const horarios = (Array.isArray(d && d.horarios) ? d.horarios : [])
    .map(h => String(h).trim())
    .filter(h => /^([01]\d|2[0-3]):[0-5]\d$/.test(h))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();
  return { activo: !!(d && d.activo) && horarios.length > 0, horarios };
}

// ── El que manda: ¿hay algo pendiente ahora? ────────────────
// Devuelve el PRIMER horario del día que ya pasó y no se hizo.
function _chqPendiente() {
  if (!CHQ_CFG.activo) return null;
  const ahora  = _chqAhora();
  const hechos = _chqHechosHoy();
  return CHQ_CFG.horarios.find(h => h <= ahora
                                 && hechos.indexOf(h) === -1
                                 && !_chqPospuestoHasta(h)) || null;
}

// ── Ciclo ───────────────────────────────────────────────────
function initChequeoCaja() {
  if (typeof db === 'undefined' || !db) return;
  _chqReintentar();
  _chqSemilla();
  _chqEscucharCfg();
  _chqRevisar();
  clearInterval(_chqTimer);
  _chqTimer = setInterval(_chqRevisar, 60 * 1000);
  if (_chqEnganchado) return;
  _chqEnganchado = true;
  // El celular pasa el día en el bolsillo: al desbloquearlo, al volver a la
  // pestaña y al recuperar internet hay que mirar de nuevo. El setInterval
  // solo no alcanza: el navegador lo congela con la app en segundo plano.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) _chqRevisar(); });
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('focus',  () => _chqRevisar());
    window.addEventListener('online', () => { _chqReintentar(); _chqRevisar(); });
  }
}

// Al cerrar sesión se sueltan los listeners (lo llama signOut en auth.js).
if (typeof window !== 'undefined') {
  window._chequeoCleanup = function() {
    try { if (_chqCfgListener) _chqCfgListener(); } catch {}
    _chqCfgListener = null;
    clearInterval(_chqTimer);
    _chqTimer = null;
  };
}

async function _chqRevisar() {
  if (_chqAbierto || _chqGuardando) return;
  const hora = _chqPendiente();
  if (!hora) return;
  // Puede haberlo hecho otro celular hace un minuto: una lectura antes de
  // trabarle el mostrador a alguien.
  let salteadoAntes = false;
  try {
    const snap = await db.collection('caja_chequeos').doc(_chqId(_chqHoy(), hora)).get();
    if (snap.exists) {
      const d = snap.data() || {};
      const hasta = d.repetirDesde ? Date.parse(d.repetirDesde) : 0;
      // Sin `repetirDesde` es un conteo de verdad: listo por hoy.
      if (!hasta) { _chqMarcar(hora); return; }
      // Salteado hace poco: se respeta en TODOS los celulares, no solo en el
      // que lo salteó.
      if (Date.now() < hasta) { _chqPosponer(hora, d.repetirDesde); return; }
      salteadoAntes = true;   // se venció el salteo: vuelve a pedirlo
    }
  } catch (e) { console.warn('[chequeo] revisar:', e); }
  _chqTrabar(hora, salteadoAntes);
}

// ══════════════════════════════════════════════════════════════
//  LA PANTALLA QUE TRABA
// ══════════════════════════════════════════════════════════════
function _chqEnCaja() { return typeof _getCierreEsperado === 'function'; }

function _chqTrabar(hora, salteadoAntes) {
  if (_chqAbierto) return;
  _chqAbierto = hora;
  let ov = document.getElementById('chq-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'chq-overlay';
    ov.className = 'chq-overlay';
    document.body.appendChild(ov);
  }
  ov.innerHTML = _chqEnCaja() ? _chqHtmlContar(hora, salteadoAntes) : _chqHtmlIrACaja(hora, salteadoAntes);
  ov.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  // El teclado del PIN (para saltear) vive muy por debajo de esta pantalla:
  // sin esta clase se abre DETRÁS y no se puede ni tocar. Ver style.css.
  try { document.body.classList.add('chq-trabado'); } catch {}
  if (_chqEnCaja()) _chqTotal();
}

// En index.html no están los movimientos del día, así que la cuenta no se
// puede hacer acá. Se traba igual y se manda a la caja.
function _chqHtmlIrACaja(hora, salteadoAntes) {
  return `
    <div class="chq-box">
      <div class="chq-ico">🔒</div>
      <h2 class="chq-ttl">Chequeo de caja de las ${hora}</h2>
      ${salteadoAntes ? '<p class="chq-otravez">Lo salteaste hace un rato. Ahora hay que contar.</p>' : ''}
      <p class="chq-sub">Hay que contar el efectivo para poder seguir usando la app.</p>
      <button class="chq-ok" onclick="location.href='caja.html'">Ir a la caja y contar</button>
    </div>`;
}

function _chqHtmlContar(hora, salteadoAntes) {
  const filas = _CHQ_DENOM.map(d => `
    <div class="chq-row">
      <span class="chq-denom">$${d.toLocaleString('es-AR')}</span>
      <div class="chq-counter">
        <button type="button" class="chq-pm" onclick="_chqMas(${d},-1)">−</button>
        <input class="chq-inp" id="chq-b-${d}" type="number" value="0" min="0" inputmode="numeric" oninput="_chqTotal()">
        <button type="button" class="chq-pm" onclick="_chqMas(${d},1)">+</button>
      </div>
      <span class="chq-sub-val" id="chq-s-${d}">$0</span>
    </div>`).join('');
  return `
    <div class="chq-box">
      <div class="chq-ico">🧾</div>
      <h2 class="chq-ttl">Chequeo de caja de las ${hora}</h2>
      ${salteadoAntes ? '<p class="chq-otravez">Lo salteaste hace un rato. Ahora hay que contar.</p>' : ''}
      <p class="chq-sub">Contá el efectivo que hay ahora. La app sigue cuando termines.</p>
      <div class="chq-rows">${filas}</div>
      <div class="chq-total-row"><span>Contaste</span><b id="chq-total">$0</b></div>
      <input id="chq-notas" class="chq-notas" type="text" maxlength="120"
             placeholder="Nota (opcional): falta un vuelto, saqué para el flete…">
      <button class="chq-ok" id="chq-ok" onclick="_chqGuardar()">Confirmar el conteo</button>
      <button class="chq-link" onclick="_chqSaltear()">Soy el dueño — postergar ${_CHQ_SALTEO_MIN} minutos</button>
    </div>`;
}

function _chqMas(denom, delta) {
  const i = document.getElementById('chq-b-' + denom);
  if (!i) return;
  i.value = Math.max(0, (parseInt(i.value, 10) || 0) + delta);
  _chqTotal();
}

function _chqContado() {
  let total = 0;
  const billetes = {};
  _CHQ_DENOM.forEach(d => {
    const i = document.getElementById('chq-b-' + d);
    const c = i ? (parseInt(i.value, 10) || 0) : 0;
    billetes[d] = c;
    total += c * d;
  });
  return { total, billetes };
}

function _chqTotal() {
  const { total } = _chqContado();
  _CHQ_DENOM.forEach(d => {
    const i = document.getElementById('chq-b-' + d);
    const s = document.getElementById('chq-s-' + d);
    if (s) s.textContent = _chqFmt((parseInt(i && i.value, 10) || 0) * d);
  });
  const t = document.getElementById('chq-total');
  if (t) t.textContent = _chqFmt(total);
}

function _chqDestrabar() {
  const ov = document.getElementById('chq-overlay');
  if (ov) ov.classList.add('hidden');
  document.body.style.overflow = '';
  try { document.body.classList.remove('chq-trabado'); } catch {}
  _chqAbierto = null;
}

// ── Guardar ─────────────────────────────────────────────────
async function _chqGuardar() {
  if (_chqGuardando || !_chqAbierto) return;
  const hora = _chqAbierto;
  const { total, billetes } = _chqContado();
  const notas = (document.getElementById('chq-notas')?.value || '').trim() || null;
  _chqGuardando = true;
  const btn = document.getElementById('chq-ok');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  // La apertura del día es plata: con cuenta de empleado no está cargada, y
  // las reglas no se la dan. Se guarda lo que ESTE celular sabe y el dueño
  // completa la cuenta cuando mira los chequeos con su cuenta.
  const apertura = (typeof ARQUEO !== 'undefined' && ARQUEO) ? (Number(ARQUEO.total) || 0) : null;
  const esperadoCrudo = (typeof _getCierreEsperado === 'function') ? _getCierreEsperado() : null;
  const movEfecNeto = esperadoCrudo === null ? null : esperadoCrudo - (apertura || 0);
  const esperado = (apertura === null || movEfecNeto === null) ? null : apertura + movEfecNeto;

  const base = {
    fecha: _chqHoy(), hora, cuando: new Date().toISOString(), notas,
    ...(typeof tpFirma === 'function' ? tpFirma() : {}),
  };
  const detalle = { ...base, contado: total, billetes, apertura, movEfecNeto, esperado,
                    diferencia: esperado === null ? null : total - esperado };

  const ok = await _chqEscribir(base, detalle);
  _chqMarcar(hora);
  _chqDestrabar();
  _chqGuardando = false;
  if (btn) { btn.disabled = false; btn.textContent = 'Confirmar el conteo'; }

  if (typeof toast === 'function') {
    if (!ok) toast('Chequeo tomado. Se guarda cuando vuelva la conexión', 'info');
    else if (typeof tpEsDueno === 'function' && tpEsDueno() && detalle.diferencia !== null) {
      const d = detalle.diferencia;
      toast(d === 0 ? '✅ Chequeo justo: ' + _chqFmt(total)
                    : `Chequeo guardado · ${d > 0 ? 'sobra' : 'falta'} ${_chqFmt(Math.abs(d))}`,
            d === 0 ? 'success' : 'error');
    } else toast('✅ Chequeo guardado: ' + _chqFmt(total), 'success');
  }
}

// Aviso por Telegram con el resultado del chequeo.
// El mensaje lo arma el SERVER desde lo que quedó guardado, no el celular:
//  · el celular del empleado no sabe cuánto tendría que haber (la apertura del
//    día es plata y las reglas no se la dan);
//  · un control que se puede editar desde el aparato que se está controlando
//    no controla nada.
function _chqAvisar(id) {
  try {
    if (typeof getNotifConfig === 'function' && getNotifConfig()?.telegram?.enabled === false) return;
    if (typeof apiFetch !== 'function') return;
    apiFetch('/api/chequeo-aviso', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => {});
  } catch { /* un aviso nunca rompe el mostrador */ }
}

async function _chqEscribir(base, detalle) {
  const id = _chqId(base.fecha, base.hora);
  try {
    await db.collection('caja_chequeos').doc(id).set(base);
    // El detalle es aparte y puede fallar por permisos sin que importe:
    // lo que destraba la app es el de arriba.
    try { await db.collection('caja_chequeos_detalle').doc(id).set(detalle); } catch (e) { console.warn('[chequeo] detalle:', e); }
    _chqAvisar(id);
    return true;
  } catch (e) {
    console.warn('[chequeo] guardar:', e);
    const pend = _chqLS(_CHQ_PEND, []);
    pend.push({ base, detalle });
    _chqSet(_CHQ_PEND, pend);
    return false;
  }
}

async function _chqReintentar() {
  const pend = _chqLS(_CHQ_PEND, []);
  if (!pend.length) return;
  const quedan = [];
  for (const p of pend) {
    const id = _chqId(p.base.fecha, p.base.hora);
    try {
      await db.collection('caja_chequeos').doc(id).set(p.base);
      try { await db.collection('caja_chequeos_detalle').doc(id).set(p.detalle); } catch {}
      _chqAvisar(id);   // el que quedó en la cola también se avisa
    } catch { quedan.push(p); }
  }
  _chqSet(_CHQ_PEND, quedan);
}

// ── Saltear = POSTERGAR 5 minutos (solo dueño, con PIN) ─────
// Es para terminar la venta que estabas haciendo, no para saltearlo y seguir
// todo el día: a los 5 minutos el chequeo vuelve solo, en todos los celulares.
// Sin esta salida, un horario mal puesto deja el mostrador trabado hasta que
// alguien llegue con la computadora. Queda registrado que se salteó y quién.
function _chqSaltear() {
  if (typeof tpEsDueno === 'function' && !tpEsDueno()) {
    if (typeof toast === 'function') toast('Saltear el chequeo es solo del dueño', 'error');
    return;
  }
  const pedirPin = (typeof requireCajaOwnerPin === 'function') ? requireCajaOwnerPin
                 : (typeof requireOwnerPin === 'function') ? requireOwnerPin : null;
  if (!pedirPin) { _chqHacerSalteo(); return; }
  pedirPin(() => _chqHacerSalteo(), 'PIN para saltear el chequeo');
}

async function _chqHacerSalteo() {
  const hora = _chqAbierto;
  if (!hora) return;
  const repetirDesde = new Date(Date.now() + _CHQ_SALTEO_MIN * 60 * 1000).toISOString();
  const base = {
    fecha: _chqHoy(), hora, cuando: new Date().toISOString(), salteado: true, notas: null,
    repetirDesde,   // ← esto es lo que hace que vuelva, acá y en el resto
    ...(typeof tpFirma === 'function' ? tpFirma() : {}),
  };
  await _chqEscribir(base, { ...base, contado: null, esperado: null, diferencia: null });
  // OJO: no va `_chqMarcar` — eso lo daría por hecho. Solo se posterga.
  _chqPosponer(hora, repetirDesde);
  _chqDestrabar();
  if (typeof toast === 'function') toast(`Postergado ${_CHQ_SALTEO_MIN} minutos`, 'info');
}

// ══════════════════════════════════════════════════════════════
//  CONFIGURACIÓN (modo dueño)
// ══════════════════════════════════════════════════════════════
let _chqCfgEdit = null;

function openChequeoConfig() {
  if (typeof tpFrenarEmpleado === 'function' && tpFrenarEmpleado('La configuración del chequeo')) return;
  if (typeof closeSheet === 'function') closeSheet();
  // No hace falta releer: el listener de arriba mantiene CHQ_CFG al día.
  _chqCfgEdit = { activo: CHQ_CFG.activo, horarios: CHQ_CFG.horarios.slice() };
  let m = document.getElementById('chq-cfg-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'chq-cfg-modal';
    m.className = 'chq-cfg-modal';
    document.body.appendChild(m);
  }
  m.classList.remove('hidden');
  _chqCfgPintar();
}

function closeChequeoConfig() {
  document.getElementById('chq-cfg-modal')?.classList.add('hidden');
}

function _chqCfgPintar() {
  const m = document.getElementById('chq-cfg-modal');
  if (!m) return;
  const chips = _chqCfgEdit.horarios.length
    ? _chqCfgEdit.horarios.map(h => `<span class="chq-chip">${h}<button type="button" onclick="_chqCfgQuitar('${h}')">✕</button></span>`).join('')
    : '<span class="chq-vacio">Sin horarios todavía</span>';
  m.innerHTML = `
    <div class="chq-cfg-box">
      <div class="chq-cfg-hd">
        <h2>⏰ Chequeo de caja</h2>
        <button type="button" class="chq-cfg-x" onclick="closeChequeoConfig()">✕</button>
      </div>
      <p class="chq-cfg-txt">A la hora que pongas, la app se traba en todos los
        celulares hasta que alguien cuente el efectivo. El que cuenta no ve
        cuánto tendría que haber: eso lo mirás vos después.</p>
      <label class="chq-cfg-sw">
        <input type="checkbox" id="chq-cfg-activo" ${_chqCfgEdit.activo ? 'checked' : ''}>
        <span>Chequeo obligatorio</span>
      </label>
      <div class="chq-cfg-lbl">Horarios</div>
      <div class="chq-chips">${chips}</div>
      <div class="chq-cfg-add">
        <input type="time" id="chq-cfg-hora" value="14:00">
        <button type="button" onclick="_chqCfgAgregar()">Agregar</button>
      </div>
      <button class="chq-ok" onclick="guardarChequeoConfig()">Guardar</button>
    </div>`;
}

function _chqCfgAgregar() {
  const v = (document.getElementById('chq-cfg-hora')?.value || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) { if (typeof toast === 'function') toast('Elegí una hora', 'error'); return; }
  const activo = !!document.getElementById('chq-cfg-activo')?.checked;
  if (_chqCfgEdit.horarios.indexOf(v) === -1) _chqCfgEdit.horarios.push(v);
  _chqCfgEdit.horarios.sort();
  _chqCfgEdit.activo = activo;
  _chqCfgPintar();
}

function _chqCfgQuitar(h) {
  _chqCfgEdit.activo = !!document.getElementById('chq-cfg-activo')?.checked;
  _chqCfgEdit.horarios = _chqCfgEdit.horarios.filter(x => x !== h);
  _chqCfgPintar();
}

async function guardarChequeoConfig() {
  const activo = !!document.getElementById('chq-cfg-activo')?.checked;
  const cfg = _chqNormalizar({ activo, horarios: _chqCfgEdit.horarios });
  if (activo && !cfg.horarios.length) {
    if (typeof toast === 'function') toast('Agregá al menos un horario', 'error');
    return;
  }
  try {
    await db.collection('config').doc('chequeoCaja').set(cfg, { merge: false });
    CHQ_CFG = cfg;
    _chqSet(_CHQ_CFG_KEY, { t: Date.now(), cfg });
    closeChequeoConfig();
    if (typeof toast === 'function') {
      toast(cfg.activo ? '⏰ Chequeo obligatorio a las ' + cfg.horarios.join(', ') : 'Chequeo desactivado', 'success');
    }
    _chqRevisar();
  } catch (e) {
    console.error('[chequeo] guardar config:', e);
    if (typeof toast === 'function') toast('No se pudo guardar', 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  LOS CHEQUEOS DE HOY (modo dueño) — acá sí se ve la diferencia
// ══════════════════════════════════════════════════════════════
async function openChequeosHoy() {
  if (typeof tpFrenarEmpleado === 'function' && tpFrenarEmpleado('Ver los chequeos')) return;
  if (typeof closeSheet === 'function') closeSheet();
  let m = document.getElementById('chq-cfg-modal');
  if (!m) { m = document.createElement('div'); m.id = 'chq-cfg-modal'; m.className = 'chq-cfg-modal'; document.body.appendChild(m); }
  m.classList.remove('hidden');
  m.innerHTML = `<div class="chq-cfg-box"><div class="chq-cfg-hd"><h2>🧾 Chequeos de hoy</h2>
    <button type="button" class="chq-cfg-x" onclick="closeChequeoConfig()">✕</button></div>
    <div id="chq-hoy-body">Cargando…</div></div>`;
  let filas = [];
  try {
    const snap = await db.collection('caja_chequeos_detalle').where('fecha', '==', _chqHoy()).get();
    filas = snap.docs.map(d => d.data()).sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
  } catch (e) { console.warn('[chequeo] hoy:', e); }
  const body = document.getElementById('chq-hoy-body');
  if (!body) return;
  if (!filas.length) { body.innerHTML = '<p class="chq-vacio">Todavía no se hizo ninguno hoy.</p>'; return; }
  // La apertura puede faltar si lo contó un empleado: su celular no la tiene.
  const apertura = (typeof ARQUEO !== 'undefined' && ARQUEO) ? (Number(ARQUEO.total) || 0) : null;
  body.innerHTML = filas.map(f => {
    if (f.salteado) return `<div class="chq-hoy-row"><b>${f.hora}</b><span class="chq-hoy-sal">salteado por ${f.cargadoPor || '—'}</span></div>`;
    const esp = f.esperado !== null && f.esperado !== undefined ? f.esperado
              : (apertura !== null && f.movEfecNeto != null ? apertura + f.movEfecNeto : null);
    const dif = esp === null ? null : (Number(f.contado) || 0) - esp;
    const txt = dif === null ? '<span class="chq-hoy-sin">sin la apertura</span>'
      : dif === 0 ? '<span class="chq-hoy-ok">justo</span>'
      : `<span class="chq-hoy-dif">${dif > 0 ? 'sobra' : 'falta'} ${_chqFmt(Math.abs(dif))}</span>`;
    return `<div class="chq-hoy-row">
        <b>${f.hora}</b>
        <span class="chq-hoy-quien">${f.cargadoPor || '—'}</span>
        <span class="chq-hoy-num">contó ${_chqFmt(f.contado)}${esp !== null ? ' · esperado ' + _chqFmt(esp) : ''}</span>
        ${txt}
        ${f.notas ? `<span class="chq-hoy-nota">“${f.notas}”</span>` : ''}
      </div>`;
  }).join('');
}
