// Celu → fotos de un equipo del stock (fotos-celu.html?id=XXXX).
//
// En la compu, el formulario del equipo muestra un QR (catalogo-stock.js).
// Se escanea con el celu, se sacan las fotos y suben a Firebase Storage
// achicadas (1000 px, JPG 70%), igual que desde la compu. Cada foto se suma
// al equipo con arrayUnion: si la compu agrega o reordena fotos al mismo
// tiempo, no se pisan.
//
// Pide sesión (Storage y el stock solo se escriben con una cuenta del
// negocio). Si el celu no estaba logueado, el login lo devuelve acá.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const ID = new URLSearchParams(location.search).get('id') || '';
  let fotos = [];
  let subiendo = 0;

  function error(html) {
    $('cargando').classList.add('hidden');
    $('app').classList.add('hidden');
    const e = $('error');
    e.innerHTML = html;
    e.classList.remove('hidden');
  }

  function estado(txt, cls) {
    const e = $('estado');
    e.textContent = txt || '';
    e.className = 'estado' + (cls ? ' ' + cls : '');
  }

  function pintar(pendientes) {
    const g = $('grilla');
    g.innerHTML = fotos.map((u, i) =>
      `<div><img src="${u.replace(/"/g, '&quot;')}" alt="">${i === 0 ? '<span class="port">Portada</span>' : ''}</div>`).join('')
      + (pendientes || []).map(u => `<div class="subiendo"><img src="${u}" alt=""></div>`).join('');
  }

  // Varias tandas pueden estar subiendo a la vez (sacás una foto, y otra
  // mientras sube la primera): el progreso suma todas.
  const tandas = new Set();
  function progreso() {
    let hechas = 0, total = 0, pctSum = 0;
    tandas.forEach(t => { hechas += t.hechas; total += t.total; pctSum += t.pct * t.total; });
    const barra = $('barra');
    if (!total) { barra.classList.add('hidden'); return; }
    barra.classList.remove('hidden');
    $('barra-i').style.width = Math.round(pctSum / total) + '%';
    estado(`📤 Subiendo ${hechas + 1 > total ? total : hechas + 1} de ${total}…`);
  }

  async function subir(files) {
    files = Array.from(files || []);
    if (!files.length) return;
    const previas = files.map(f => URL.createObjectURL(f));
    const t = { hechas: 0, total: files.length, pct: 0, previas };
    tandas.add(t);
    subiendo += files.length;
    pintarTodo();
    progreso();
    let r = { urls: [], fallas: files.length };
    try {
      r = await fotosSubir(ID, files, {
        alProgreso: p => { t.hechas = p.hechas; t.pct = p.pct; progreso(); },
        // Cada foto que queda anotada deja de mostrarse como "subiendo"
        alSubir: (url, i) => { if (previas[i]) { URL.revokeObjectURL(previas[i]); previas[i] = null; } pintarTodo(); },
      });
    } catch (e) { console.error('subir fotos:', e); }
    previas.forEach(u => u && URL.revokeObjectURL(u));
    tandas.delete(t);
    subiendo -= files.length;
    pintarTodo();
    progreso();
    const bien = r.urls.length, n = files.length;
    if (subiendo) return;   // hay otra tanda en curso: su mensaje manda
    if (bien === n) estado(`✅ ${bien} foto${bien === 1 ? '' : 's'} subida${bien === 1 ? '' : 's'} · ya está${bien === 1 ? '' : 'n'} en la compu`, 'ok');
    else estado(`⚠️ Subieron ${bien} de ${n}. Revisá la conexión y probá de nuevo.`, 'err');
    if (navigator.vibrate) try { navigator.vibrate(60); } catch {}
  }

  // Las ya subidas + las que están subiendo (con ⏳)
  function pintarTodo() {
    const pend = [];
    tandas.forEach(t => t.previas.forEach(u => u && pend.push(u)));
    pintar(pend);
  }

  async function iniciar() {
    if (!/^[A-Za-z0-9_-]{4,60}$/.test(ID)) {
      error('Este link no es válido.<br>Escaneá de nuevo el QR que aparece en la compu.');
      return;
    }
    const volver = 'fotos-celu.html?id=' + ID;
    const user = await requireAuth('login.html?next=' + encodeURIComponent(volver));
    if (!user) return;
    const db = _fbInit();
    // En vivo: si la compu reordena o borra, se ve acá también
    db.collection('stock').doc(ID).onSnapshot(d => {
      if (!d.exists) { error('Ese equipo ya no está en el stock.'); return; }
      const p = d.data();
      const repite = p.marca && String(p.modelo || '').toLowerCase().startsWith(String(p.marca).toLowerCase());
      $('nombre').textContent = [repite ? '' : p.marca, p.modelo].filter(Boolean).join(' ') || 'Equipo';
      $('detalle').textContent = [p.almacenamiento, p.color, p.estado, p.imei ? '…' + String(p.imei).slice(-4) : ''].filter(Boolean).join(' · ');
      fotos = Array.isArray(p.fotos) ? p.fotos : [];
      pintarTodo();
      $('cargando').classList.add('hidden');
      $('app').classList.remove('hidden');
    }, e => {
      console.error(e);
      error('No se pudo abrir el equipo. ¿Esta cuenta tiene acceso al stock?<br><a href="index.html">Ir a la app</a>');
    });
    $('b-cam').onclick = () => $('in-cam').click();
    $('b-gal').onclick = () => $('in-gal').click();
    $('in-cam').onchange = e => { subir(e.target.files); e.target.value = ''; };
    $('in-gal').onchange = e => { subir(e.target.files); e.target.value = ''; };
  }

  iniciar().catch(e => { console.error(e); error('Algo falló al abrir la página. Probá de nuevo.'); });
})();
