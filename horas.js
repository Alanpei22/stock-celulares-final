// ══════════════════════════════════════════════════════════════
// ⏰ Horas del personal — fichadas de entrada y salida
// ══════════════════════════════════════════════════════════════
// Cada empleado ficha desde SU celu escaneando el QR pegado en el local
// (fichar.html). No depende de la compu: antes la idea era fichar en la PC,
// pero hasta que se prende se pierden minutos.
//
// Colección `fichadas`, un documento por toque:
//   { uid, nombre, tipo: 'entrada'|'salida', ts (hora de Firebase), dia,
//     lat, lng, prec | sinUbicacion, tsCel (hora del celu, de referencia) }
// Las correcciones del dueño van en `tsCorregido` (+ corregido: true) y las
// cargadas a mano llevan `manual: true`. Las reglas no dejan que el empleado
// toque una fichada después de hecha (firestore.rules → fichadas).
//
// Solo se cuentan horas (no hay horario fijo ni llegadas tarde). El local
// cierra a las 19:30 sí o sí: lo que pase de esa hora no cuenta, y una
// entrada sin salida se cuenta hasta las 19:30.
//
// Este archivo tiene dos partes: las cuentas (las usa también fichar.html)
// y el panel del dueño (☰ → ⏰ Horas del personal, en index.html).
'use strict';

const HORAS_CIERRE = '19:30';      // el local cierra sí o sí
const HORAS_RADIO_M = 150;         // a cuántos metros del local vale la fichada

// ── Fechas en hora argentina (UTC-3 todo el año, sin horario de verano) ──
function horasDia(ms) { return new Date(ms - 3 * 3600e3).toISOString().slice(0, 10); }
function horasHora(ms) { return new Date(ms - 3 * 3600e3).toISOString().slice(11, 16); }
function horasMsDe(dia, hhmm) { return Date.parse(`${dia}T${hhmm}:00-03:00`); }

// La hora que vale de una fichada: la corregida por el dueño, si hay; si no,
// la de Firebase. Recién escrita, Firebase todavía no la devolvió: se usa la
// del celu mientras tanto.
function horasMs(f) {
  const t = v => (v && typeof v.toMillis === 'function') ? v.toMillis()
    : (typeof v === 'number' ? v : (v instanceof Date ? v.getTime() : 0));
  return t(f && f.tsCorregido) || t(f && f.ts) || t(f && f.tsCel) || 0;
}

// Fichadas → turnos (entrada → salida), por persona y por día.
//  · dos entradas seguidas: vale la primera (tocó dos veces);
//  · salida sin entrada: no suma, y se marca para que el dueño la mire;
//  · nada cuenta después de las 19:30;
//  · entrada sin salida: si el día ya cerró, se cuenta hasta las 19:30
//    (sinSalida); si es hoy y no son las 19:30, está trabajando (enCurso).
function horasTurnos(fichadas, ahora = Date.now()) {
  const grupos = {};
  (fichadas || []).forEach(f => {
    const t = horasMs(f);
    if (!t || !f.uid || (f.tipo !== 'entrada' && f.tipo !== 'salida')) return;
    const k = f.uid + '|' + horasDia(t);
    (grupos[k] = grupos[k] || []).push({ f, t });
  });
  const out = [];
  Object.keys(grupos).forEach(k => {
    const lista = grupos[k].sort((a, b) => a.t - b.t);
    const [uid, dia] = k.split('|');
    const cierre = horasMsDe(dia, HORAS_CIERRE);
    let abierto = null;
    const turno = (hasta, extra) => {
      const fin = Math.min(hasta, cierre);
      out.push(Object.assign({
        uid, dia, nombre: abierto.f.nombre || '', desde: abierto.t, hasta: fin,
        min: Math.max(0, Math.round((fin - abierto.t) / 60000)),
        entrada: abierto.f, salida: null, sinSalida: false, tope: hasta > cierre, enCurso: false,
      }, extra));
      abierto = null;
    };
    lista.forEach(x => {
      if (x.f.tipo === 'entrada') { if (!abierto) abierto = x; return; }
      if (abierto) { turno(x.t, { salida: x.f }); return; }
      out.push({ uid, dia, nombre: x.f.nombre || '', desde: x.t, hasta: x.t, min: 0,
                 entrada: null, salida: x.f, sinEntrada: true });
    });
    if (abierto) {
      if (ahora < cierre) turno(ahora, { enCurso: true, tope: false });
      else turno(cierre, { sinSalida: true, tope: false });
    }
  });
  return out.sort((a, b) => a.desde - b.desde);
}

// "8 h 05 min"
function horasFmt(min) {
  min = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

// Distancia en metros entre dos puntos { lat, lng }
function horasDistM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// ¿Dónde estaba al fichar? 'local' | 'lejos' | 'sin' (no dio ubicación) |
// 'nofijado' (el dueño todavía no marcó dónde está el local) | 'manual'.
// El GPS del celu a veces tira con error de cientos de metros: se le da el
// beneficio de la duda hasta 500 m de error.
function horasLugar(f, local) {
  if (!f) return 'sin';
  if (f.manual) return 'manual';
  if (f.sinUbicacion || f.lat == null) return 'sin';
  if (!local || local.lat == null) return 'nofijado';
  const d = horasDistM(f, local);
  const radio = Number(local.radio) || HORAS_RADIO_M;
  return d - Math.min(Number(f.prec) || 0, 500) > radio ? 'lejos' : 'local';
}

function horasDistTxt(m) {
  if (m == null) return '';
  return m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km`;
}

// Total por persona: [{ uid, nombre, min, dias, turnos }]
function horasPorPersona(turnos) {
  const p = {};
  turnos.forEach(t => {
    const x = p[t.uid] = p[t.uid] || { uid: t.uid, nombre: t.nombre, min: 0, dias: new Set(), turnos: [] };
    if (t.nombre) x.nombre = t.nombre;
    x.min += t.min || 0;
    if (t.min > 0) x.dias.add(t.dia);
    x.turnos.push(t);
  });
  return Object.values(p).map(x => Object.assign(x, { dias: x.dias.size }))
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
}

// Períodos del panel, en días AR: [desde, hasta] (inclusive)
function horasPeriodo(cual, ahora = Date.now()) {
  const hoy = horasDia(ahora);
  const d = new Date(hoy + 'T12:00:00Z');
  const sumar = (x, n) => { const y = new Date(x); y.setUTCDate(y.getUTCDate() + n); return y; };
  const iso = x => x.toISOString().slice(0, 10);
  const lunes = sumar(d, -((d.getUTCDay() + 6) % 7));
  if (cual === 'semana') return [iso(lunes), hoy];
  if (cual === 'semanaPasada') return [iso(sumar(lunes, -7)), iso(sumar(lunes, -1))];
  if (cual === 'mesPasado') {
    const ini = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, 12));
    const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 12));
    return [iso(ini), iso(fin)];
  }
  return [hoy.slice(0, 8) + '01', hoy];   // 'mes'
}

// ══════════════════════════════════════════════════════════════
//  Panel del dueño (index.html)
// ══════════════════════════════════════════════════════════════
let _horasPer = 'semana';
let _horasFichadas = [];
let _horasLocal = null;
let _horasEmpleados = null;   // [{ uid, nombre }] de 👥 Empleados, para cargar a mano

function _hEsc(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
const _HORAS_DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function _horasDiaTxt(dia) {
  const d = new Date(dia + 'T12:00:00Z');
  return `${_HORAS_DIAS[d.getUTCDay()]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

function abrirHoras() {
  if (typeof closeSheet === 'function') closeSheet();
  if (typeof tpEsDueno === 'function' && !tpEsDueno()) { if (typeof toast === 'function') toast('Solo el dueño ve las horas', 'error'); return; }
  _horasCerrar();
  const ov = document.createElement('div');
  ov.id = 'horas-modal';
  ov.className = 'emp-ov';
  ov.innerHTML = `<div class="emp-caja" role="dialog" aria-label="Horas del personal">
      <div class="emp-cab"><h3>⏰ Horas del personal</h3><button type="button" class="emp-x" onclick="_horasCerrar()">✕</button></div>
      <p class="emp-ayuda">Fichan con su celu escaneando el QR del local. Lo que pasa de las ${HORAS_CIERRE} no cuenta, y si alguien no fichó la salida se cuenta hasta las ${HORAS_CIERRE}.</p>
      <div class="horas-pers" id="horas-pers">
        <button type="button" data-p="semana">Esta semana</button>
        <button type="button" data-p="semanaPasada">Semana pasada</button>
        <button type="button" data-p="mes">Este mes</button>
        <button type="button" data-p="mesPasado">Mes pasado</button>
      </div>
      <div id="horas-local" class="horas-local"></div>
      <div id="horas-lista" class="emp-lista"><p class="emp-vacio">Cargando…</p></div>
      <details class="emp-perm-det" id="horas-manual">
        <summary>＋ Agregar una fichada a mano</summary>
        <div class="horas-form">
          <select id="horas-m-uid" class="fi"></select>
          <input id="horas-m-dia" class="fi" type="date">
          <select id="horas-m-tipo" class="fi"><option value="entrada">Entrada</option><option value="salida">Salida</option></select>
          <input id="horas-m-hora" class="fi" type="time">
          <button type="button" class="btn-primary" onclick="horasAgregarManual()">Agregar</button>
        </div>
      </details>
      <div class="horas-acc">
        <button type="button" class="btn-secondary" onclick="horasImprimirQR()">🖨️ QR para la pared</button>
        <button type="button" class="btn-secondary" onclick="horasFijarLocal()">📍 El local está acá</button>
      </div>
    </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) _horasCerrar(); });
  ov.querySelectorAll('#horas-pers button').forEach(b => b.addEventListener('click', () => { _horasPer = b.dataset.p; horasCargar(); }));
  document.body.appendChild(ov);
  document.getElementById('horas-m-dia').value = horasDia(Date.now());
  horasCargar();
}

function _horasCerrar() { document.getElementById('horas-modal')?.remove(); }

async function horasCargar() {
  const [desde, hasta] = horasPeriodo(_horasPer);
  document.querySelectorAll('#horas-pers button').forEach(b => b.classList.toggle('on', b.dataset.p === _horasPer));
  try {
    // Una lectura por fichada del período (2 por persona por día): barato.
    const [snap, loc] = await Promise.all([
      db.collection('fichadas').where('dia', '>=', desde).where('dia', '<=', hasta).get(),
      db.collection('config').doc('fichar').get(),
    ]);
    _horasFichadas = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    _horasLocal = loc.exists ? loc.data() : null;
    _horasPintar(desde, hasta);
    // Los empleados, para poder cargarle a mano a alguien que no fichó nada
    if (!_horasEmpleados && typeof apiFetch === 'function') {
      _horasEmpleados = [];
      apiFetch('/api/usuarios', { method: 'POST', body: JSON.stringify({ accion: 'listar' }) })
        .then(r => r.ok ? r.json() : null)
        .then(j => { if (j && Array.isArray(j.empleados)) { _horasEmpleados = j.empleados.filter(e => e.activo).map(e => ({ uid: e.uid, nombre: e.nombre })); _horasPintar(desde, hasta); } })
        .catch(() => {});
    }
  } catch (e) {
    console.error('horas:', e);
    const l = document.getElementById('horas-lista');
    if (l) l.innerHTML = `<p class="emp-vacio">No se pudieron leer las fichadas. ¿Publicaste las reglas nuevas de Firebase?</p>`;
  }
}

function _horasBadges(t) {
  const b = [];
  const lug = f => {
    const l = horasLugar(f, _horasLocal);
    if (l === 'lejos') return `<span class="hb hb-mal" title="Fichó lejos del local">⚠️ a ${horasDistTxt(horasDistM(f, _horasLocal))}</span>`;
    if (l === 'sin') return '<span class="hb hb-ojo" title="El celu no dio la ubicación">❓ sin ubicación</span>';
    if (l === 'manual') return '<span class="hb">✍️ a mano</span>';
    return '';
  };
  if (t.entrada) b.push(lug(t.entrada));
  if (t.salida) b.push(lug(t.salida));
  if (t.enCurso) b.push('<span class="hb hb-ok">🟢 trabajando</span>');
  if (t.sinSalida) b.push(`<span class="hb hb-ojo" title="No fichó la salida">🚪 sin salida: hasta las ${HORAS_CIERRE}</span>`);
  if (t.sinEntrada) b.push('<span class="hb hb-mal">sin entrada: no suma</span>');
  if (t.tope) b.push(`<span class="hb" title="El local cierra a las ${HORAS_CIERRE}">🔒 cortado a las ${HORAS_CIERRE}</span>`);
  if ((t.entrada && t.entrada.corregido) || (t.salida && t.salida.corregido)) b.push('<span class="hb">✏️ corregida</span>');
  return b.filter(Boolean).join(' ');
}

function _horasPintar(desde, hasta) {
  const loc = document.getElementById('horas-local');
  if (loc) loc.innerHTML = _horasLocal && _horasLocal.lat != null
    ? '📍 Ubicación del local fijada: las fichadas de lejos se marcan con ⚠️.'
    : '⚠️ <b>Falta fijar dónde está el local.</b> Parado en el local, tocá "📍 El local está acá" (una sola vez).';
  const lista = document.getElementById('horas-lista');
  if (!lista) return;
  const personas = horasPorPersona(horasTurnos(_horasFichadas));
  // Para cargar a mano: los que ya ficharon alguna vez en el período
  const sel = document.getElementById('horas-m-uid');
  if (sel) {
    const ya = sel.value;
    const gente = {};
    (_horasEmpleados || []).forEach(e => { gente[e.uid] = e.nombre; });
    personas.forEach(p => { gente[p.uid] = p.nombre || gente[p.uid]; });
    sel.innerHTML = Object.keys(gente).map(uid => `<option value="${_hEsc(uid)}">${_hEsc(gente[uid] || 'Sin nombre')}</option>`).join('')
      || '<option value="">(todavía no hay empleados)</option>';
    if (ya) sel.value = ya;
  }
  if (!personas.length) {
    lista.innerHTML = `<p class="emp-vacio">Nadie fichó entre el ${_horasDiaTxt(desde)} y el ${_horasDiaTxt(hasta)}.</p>`;
    return;
  }
  lista.innerHTML = personas.map(p => `
    <div class="horas-per">
      <details>
        <summary>
          <span class="horas-nom">${_hEsc(p.nombre || 'Sin nombre')}${p.turnos.some(t => t.enCurso) ? ' 🟢' : ''}</span>
          <span class="horas-tot">${horasFmt(p.min)}</span>
          <span class="horas-dias">${p.dias} día${p.dias === 1 ? '' : 's'}</span>
        </summary>
        ${p.turnos.slice().reverse().map(t => `
          <div class="horas-turno">
            <div><b>${_horasDiaTxt(t.dia)}</b> ·
              ${t.entrada ? `<a href="#" onclick="event.preventDefault(); horasCorregir('${_hEsc(t.entrada.id)}')" title="Corregir la entrada">${horasHora(t.desde)}</a>` : '—'}
              →
              ${t.salida ? `<a href="#" onclick="event.preventDefault(); horasCorregir('${_hEsc(t.salida.id)}')" title="Corregir la salida">${horasHora(horasMs(t.salida))}</a>`
                : (t.enCurso ? 'ahora' : `<a href="#" onclick="event.preventDefault(); horasPonerSalida('${_hEsc(t.uid)}','${t.dia}')" title="Cargar la salida">poner salida</a>`)}
              · <b>${horasFmt(t.min)}</b></div>
            <div class="horas-bd">${_horasBadges(t)}</div>
          </div>`).join('')}
      </details>
    </div>`).join('');
}

function _horasPedirHora(txt, porDefecto) {
  const r = prompt(txt, porDefecto || '');
  if (r === null) return null;
  const m = String(r).trim().match(/^(\d{1,2})[:.]?(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) { if (typeof toast === 'function') toast('Hora inválida: escribila como 9:30', 'error'); return null; }
  return String(m[1]).padStart(2, '0') + ':' + m[2];
}

function _horasQuien() {
  return (typeof tpUsuario === 'function' && tpUsuario() && tpUsuario().nombre) || 'dueño';
}

// Corregir la hora de una fichada. No se pisa la original: queda en `ts` y la
// corregida va aparte, marcada.
async function horasCorregir(id) {
  const f = _horasFichadas.find(x => x.id === id);
  if (!f) return;
  const t = horasMs(f);
  const hh = _horasPedirHora(`Hora de ${f.tipo} de ${f.nombre || ''} (${_horasDiaTxt(horasDia(t))}).\nVacío y Cancelar para dejarla como está.`, horasHora(t));
  if (!hh) return;
  try {
    await db.collection('fichadas').doc(id).update({
      tsCorregido: firebase.firestore.Timestamp.fromMillis(horasMsDe(horasDia(t), hh)),
      corregido: true, corregidoPor: _horasQuien(),
    });
    if (typeof toast === 'function') toast('✏️ Fichada corregida', 'success');
    horasCargar();
  } catch (e) { console.error(e); if (typeof toast === 'function') toast('No se pudo corregir', 'error'); }
}

async function _horasAgregar(uid, dia, tipo, hh) {
  const ref = _horasFichadas.find(x => x.uid === uid);
  const emp = (_horasEmpleados || []).find(x => x.uid === uid);
  await db.collection('fichadas').add({
    uid, nombre: (ref && ref.nombre) || (emp && emp.nombre) || '', tipo, dia,
    ts: firebase.firestore.Timestamp.fromMillis(horasMsDe(dia, hh)),
    manual: true, por: _horasQuien(),
  });
}

async function horasPonerSalida(uid, dia) {
  const hh = _horasPedirHora(`¿A qué hora se fue? (${_horasDiaTxt(dia)})`, HORAS_CIERRE);
  if (!hh) return;
  try { await _horasAgregar(uid, dia, 'salida', hh); if (typeof toast === 'function') toast('Salida cargada', 'success'); horasCargar(); }
  catch (e) { console.error(e); if (typeof toast === 'function') toast('No se pudo guardar', 'error'); }
}

async function horasAgregarManual() {
  const uid = document.getElementById('horas-m-uid')?.value;
  const dia = document.getElementById('horas-m-dia')?.value;
  const tipo = document.getElementById('horas-m-tipo')?.value;
  const hh = document.getElementById('horas-m-hora')?.value;
  if (!uid) { if (typeof toast === 'function') toast('Elegí a quién', 'error'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia || '') || !/^\d{2}:\d{2}$/.test(hh || '')) { if (typeof toast === 'function') toast('Poné el día y la hora', 'error'); return; }
  try { await _horasAgregar(uid, dia, tipo, hh); if (typeof toast === 'function') toast('Fichada agregada', 'success'); horasCargar(); }
  catch (e) { console.error(e); if (typeof toast === 'function') toast('No se pudo guardar', 'error'); }
}

// Se hace UNA vez, parado en el local, con el celu (el GPS de la compu de
// escritorio no sirve: sale por la ubicación del proveedor de internet).
function horasFijarLocal() {
  if (!navigator.geolocation) { if (typeof toast === 'function') toast('Este dispositivo no da la ubicación', 'error'); return; }
  if (!confirm('¿Estás parado en el local ahora?\nHacelo desde el celu: la compu no sabe bien dónde está.')) return;
  if (typeof toast === 'function') toast('📍 Buscando la ubicación…', 'info');
  navigator.geolocation.getCurrentPosition(async p => {
    const { latitude: lat, longitude: lng, accuracy } = p.coords;
    if (accuracy > 200 && !confirm(`La ubicación tiene un error de ${Math.round(accuracy)} m. ¿La guardo igual? (Mejor probá afuera o cerca de la puerta)`)) return;
    try {
      await db.collection('config').doc('fichar').set({ lat, lng, prec: Math.round(accuracy), radio: HORAS_RADIO_M,
        fijado: new Date().toISOString(), direccion: 'Av. Urquiza 4741, Caseros' });
      if (typeof toast === 'function') toast('📍 Ubicación del local guardada', 'success');
      horasCargar();
    } catch (e) { console.error(e); if (typeof toast === 'function') toast('No se pudo guardar', 'error'); }
  }, e => {
    if (typeof toast === 'function') toast('No se pudo leer la ubicación: dale permiso a la app', 'error');
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

// Cartel A4 con el QR para pegar en la pared del local
function horasCartelHtml(url) {
  const qr = (typeof qrSvg === 'function') ? qrSvg(url, 110) : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fichar · TechPoint</title>
<style>@page{size:A4;margin:15mm}body{font-family:system-ui,Arial,sans-serif;text-align:center;color:#111;margin:0}
h1{font-size:44px;margin:10mm 0 4mm}p{font-size:20px;margin:3mm 0}.qr{display:inline-block;margin:8mm 0}
ol{display:inline-block;text-align:left;font-size:22px;line-height:1.6}.url{font-size:13px;color:#666}</style></head>
<body><h1>⏰ Fichá acá</h1><p>Al llegar y al irte</p><div class="qr">${qr}</div>
<ol><li>Escaneá el código con la cámara de tu celu</li><li>Tocá <b>Entrada</b> o <b>Salida</b></li></ol>
<p class="url">${_hEsc(url)}</p></body></html>`;
}

function horasImprimirQR() {
  const url = location.origin + '/fichar.html';
  const html = horasCartelHtml(url);
  if (typeof _openPrint === 'function') _openPrint(html, 'QR para fichar');
  else { const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } }
}
