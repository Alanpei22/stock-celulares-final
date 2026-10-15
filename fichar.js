// Celu → fichar entrada o salida (fichar.html).
//
// Se llega escaneando el QR pegado en el local. Cada uno ficha con SU cuenta
// (la misma con la que entra a la app), así nadie ficha por otro.
//
// Lo que cuida que no se haga trampa:
//  · la hora la pone Firebase (las reglas exigen ts == request.time): atrasar
//    el reloj del celu no sirve;
//  · se guarda dónde estaba el celu al fichar: si fichó lejos del local, el
//    dueño lo ve marcado con ⚠️ y le llega dicho por Telegram;
//  · una fichada hecha no se puede tocar (solo el dueño la corrige, marcada).
//
// Al dueño le llega cada entrada y salida por Telegram (/api/telegram-notify).
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let db, user, nombre = '', local = null, deHoy = [];

  function error(html) {
    $('cargando').classList.add('hidden');
    $('app').classList.add('hidden');
    const e = $('error');
    e.innerHTML = html;
    e.classList.remove('hidden');
  }
  function msg(txt, cls) { const m = $('msg'); m.textContent = txt || ''; m.className = 'msg' + (cls ? ' ' + cls : ''); }

  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  function tic() {
    const ahora = Date.now();
    $('reloj').textContent = horasHora(ahora);
    const d = new Date(horasDia(ahora) + 'T12:00:00Z');
    $('fecha').textContent = `${DIAS[d.getUTCDay()]} ${horasDia(ahora).slice(8, 10)}/${horasDia(ahora).slice(5, 7)}`;
  }

  // ¿Está adentro? = su última fichada de hoy es una entrada
  function adentro() {
    const l = deHoy.slice().sort((a, b) => horasMs(a) - horasMs(b));
    return l.length > 0 && l[l.length - 1].tipo === 'entrada';
  }

  function pintar() {
    const dentro = adentro();
    const b = $('b-fichar');
    b.textContent = dentro ? '⏹  Salida' : '▶️  Entrada';
    b.className = 'btn ' + (dentro ? 'btn-sal' : 'btn-ent');
    b.disabled = false;
    const turnos = horasTurnos(deHoy.map(f => Object.assign({ uid: user.uid }, f)));
    const total = turnos.reduce((s, t) => s + t.min, 0);
    const ult = deHoy.slice().sort((a, b) => horasMs(a) - horasMs(b)).pop();
    $('estado').innerHTML = dentro
      ? `🟢 Estás trabajando desde las <b>${horasHora(horasMs(ult))}</b>`
      : (ult ? `Saliste a las <b>${horasHora(horasMs(ult))}</b>` : 'Todavía no fichaste hoy');
    const hoy = $('hoy');
    if (turnos.length) {
      hoy.classList.remove('hidden');
      hoy.innerHTML = turnos.filter(t => !t.sinEntrada).map(t =>
        `<div><span>${horasHora(t.desde)} → ${t.enCurso ? 'ahora' : horasHora(t.hasta)}</span><b>${horasFmt(t.min)}</b></div>`).join('')
        + `<div style="border-top:1px solid var(--line);margin-top:4px;padding-top:6px"><span>Hoy</span><b>${horasFmt(total)}</b></div>`;
    } else hoy.classList.add('hidden');
  }

  // Ubicación del celu. Si no la da (permiso negado, GPS apagado) se ficha
  // igual: perder la fichada es peor. Queda marcada "sin ubicación".
  function ubicacion() {
    return new Promise(ok => {
      if (!navigator.geolocation) return ok({ sinUbicacion: true, motivo: 'no soportado' });
      navigator.geolocation.getCurrentPosition(
        p => ok({ lat: p.coords.latitude, lng: p.coords.longitude, prec: Math.round(p.coords.accuracy) }),
        e => ok({ sinUbicacion: true, motivo: e && e.code === 1 ? 'permiso negado' : 'no se pudo' }),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    });
  }

  function lugarTxt(f) {
    const l = horasLugar(f, local);
    if (l === 'local') return '📍 en el local';
    if (l === 'lejos') return `⚠️ <b>a ${horasDistTxt(horasDistM(f, local))} del local</b>`;
    if (l === 'nofijado') return '📍 (falta fijar la ubicación del local)';
    return `❓ sin ubicación (${f.motivo || 'no la dio'})`;
  }

  async function fichar() {
    const b = $('b-fichar');
    if (b.disabled) return;
    b.disabled = true;
    const tipo = adentro() ? 'salida' : 'entrada';
    msg('📍 Buscando tu ubicación…');
    const ubi = await ubicacion();
    msg('Guardando…');
    const datos = Object.assign({
      uid: user.uid, nombre, tipo,
      ts: firebase.firestore.FieldValue.serverTimestamp(),
      tsCel: Date.now(),
      dia: horasDia(Date.now()),
      ua: String(navigator.userAgent || '').slice(0, 120),
    }, ubi);
    if (datos.motivo === undefined) delete datos.motivo;
    try {
      const ref = db.collection('fichadas').doc();
      // Sin internet, Firestore la deja en cola y la manda al volver (con la
      // hora de ese momento): se avisa en vez de quedar "Guardando…" mudo.
      const lento = setTimeout(() => msg('Sin conexión: se anota cuando vuelva internet. No cierres esta pantalla.', 'warn'), 8000);
      await ref.set(datos);
      clearTimeout(lento);
      let f = datos;
      try { const d = await ref.get(); if (d.exists) f = d.data(); } catch {}
      deHoy.push(f);
      const t = horasMs(f) || Date.now();
      pintar();
      const lug = horasLugar(f, local);
      msg(`${tipo === 'entrada' ? '✅ Entrada' : '✅ Salida'} ${horasHora(t)}${lug === 'lejos' ? ' · ⚠️ estás lejos del local' : ''}`, lug === 'lejos' ? 'warn' : 'ok');
      if (navigator.vibrate) try { navigator.vibrate(80); } catch {}
      avisar(tipo, f, t);
    } catch (e) {
      console.error('fichar:', e);
      msg('No se pudo fichar. Probá de nuevo.', 'err');
      b.disabled = false;
    }
  }

  // Telegram del dueño. Si falla no pasa nada: la fichada ya quedó.
  function avisar(tipo, f, t) {
    if (typeof apiFetch !== 'function') return;
    const total = horasTurnos(deHoy.map(x => Object.assign({ uid: user.uid }, x))).reduce((s, x) => s + x.min, 0);
    const n = String(nombre).replace(/[<>&]/g, '');
    const texto = tipo === 'entrada'
      ? `🟢 <b>${n}</b> entró · ${horasHora(t)}\n${lugarTxt(f)}`
      : `🔴 <b>${n}</b> salió · ${horasHora(t)} · hoy ${horasFmt(total)}\n${lugarTxt(f)}`;
    apiFetch('/api/telegram-notify', { method: 'POST', body: JSON.stringify({ text: texto }) }).catch(() => {});
  }

  async function iniciar() {
    user = await requireAuth('login.html?next=fichar.html');
    if (!user) return;
    db = _fbInit();
    try {
      const tk = await user.getIdTokenResult();
      const ficha = (typeof TP_USUARIOS === 'object' && TP_USUARIOS[user.uid]) || null;
      nombre = (tk.claims && tk.claims.nombre) || (ficha && ficha.nombre) || user.displayName || (user.email || '').split('@')[0];
    } catch { nombre = user.displayName || (user.email || '').split('@')[0]; }
    $('nombre').textContent = 'Hola, ' + nombre;
    tic(); setInterval(tic, 15000);
    try {
      const [loc, snap] = await Promise.all([
        db.collection('config').doc('fichar').get().catch(() => null),
        // Las reglas solo dejan leer las propias: el filtro por uid es obligatorio
        db.collection('fichadas').where('uid', '==', user.uid).where('dia', '==', horasDia(Date.now())).get(),
      ]);
      local = loc && loc.exists ? loc.data() : null;
      deHoy = snap.docs.map(d => d.data());
    } catch (e) {
      console.error(e);
      error('No se pudieron leer tus fichadas. ¿Tu cuenta está activa?<br><a href="index.html">Ir a la app</a>');
      return;
    }
    $('cargando').classList.add('hidden');
    $('app').classList.remove('hidden');
    pintar();
    $('b-fichar').onclick = fichar;
  }

  iniciar().catch(e => { console.error(e); error('Algo falló al abrir la página. Probá de nuevo.'); });
})();
