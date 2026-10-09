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

  function achicar(file, max = 1000, q = 0.7) {
    return new Promise((ok, mal) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        const k = Math.min(1, max / Math.max(w, h));
        w = Math.round(w * k); h = Math.round(h * k);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? ok(b) : mal(new Error('No se pudo achicar la foto')), 'image/jpeg', q);
      };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo abrir la foto')); };
      img.src = url;
    });
  }

  async function subir(files) {
    files = Array.from(files || []);
    if (!files.length) return;
    const previas = files.map(f => URL.createObjectURL(f));
    subiendo += files.length;
    pintar(previas);
    estado(`Subiendo ${files.length} foto${files.length === 1 ? '' : 's'}…`);
    const ref = firebase.firestore().collection('stock').doc(ID);
    let bien = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        const blob = await achicar(files[i]);
        const nombre = `${Date.now()}_${i}.jpg`;
        const snap = await firebase.storage().ref(`stock-photos/${ID}/${nombre}`).put(blob, { contentType: 'image/jpeg' });
        const url = await snap.ref.getDownloadURL();
        await ref.update({ fotos: firebase.firestore.FieldValue.arrayUnion(url) });
        bien++;
      } catch (e) {
        console.error('subir foto:', e);
      }
    }
    previas.forEach(u => URL.revokeObjectURL(u));
    subiendo -= files.length;
    if (!subiendo) pintar();   // saca los ⏳: quedan las fotos ya subidas
    if (bien === files.length) estado(`✅ ${bien} foto${bien === 1 ? '' : 's'} subida${bien === 1 ? '' : 's'} · ya está${bien === 1 ? '' : 'n'} en la compu`, 'ok');
    else estado(`⚠️ Subieron ${bien} de ${files.length}. Revisá la conexión y probá de nuevo.`, 'err');
    if (navigator.vibrate) try { navigator.vibrate(60); } catch {}
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
      if (!subiendo) pintar();
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
