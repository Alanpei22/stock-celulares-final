// ══════════════════════════════════════════════════════════════
// Subida de fotos de equipos (compu y celu usan esto mismo)
// ══════════════════════════════════════════════════════════════
// Antes: una foto por vez (achicar → subir → pedir el link) y todas se
// anotaban en el equipo recién al final. Ahora:
//
//  · de a 3 en paralelo: mientras una sube, la otra ya se está achicando;
//  · se achica con createImageBitmap (decodifica fuera del hilo de la página,
//    respeta la rotación de la cámara) en vez de pasar por un dataURL;
//  · WebP cuando el navegador lo sabe hacer (~30% menos que JPG a la misma
//    calidad); si no, JPG como antes;
//  · cada foto se anota en el equipo apenas sube (la compu la ve al toque),
//    pero en el ORDEN en que se eligieron: la portada es la primera;
//  · progreso real por bytes, y un reintento si se corta la conexión;
//  · las fotos se guardan con caché larga: la página /equipos las vuelve a
//    mostrar sin bajarlas de nuevo.
'use strict';

const FOTO_MAX = 1000;          // px del lado más largo
const FOTO_CALIDAD = 0.7;
const FOTO_PARALELO = 3;
const FOTO_CACHE = 'public, max-age=31536000, immutable';   // el nombre nunca se reusa

let _fotoWebp = null;   // ¿el navegador codifica WebP? (Safari viejo devuelve PNG)

function _fotoCanvasBlob(canvas, tipo, q) {
  return new Promise(ok => canvas.toBlob(b => ok(b), tipo, q));
}

async function _fotoDecodificar(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* cae al <img> */ }
  }
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo abrir la foto')); };
    img.src = url;
  });
}

// File → { blob, ext, tipo } achicado
async function fotoAchicar(file, max = FOTO_MAX, q = FOTO_CALIDAD) {
  const img = await _fotoDecodificar(file);
  const w0 = img.width, h0 = img.height;
  const k = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  if (img.close) try { img.close(); } catch {}
  if (_fotoWebp !== false) {
    const b = await _fotoCanvasBlob(c, 'image/webp', q);
    _fotoWebp = !!(b && b.type === 'image/webp');
    if (_fotoWebp) return { blob: b, ext: 'webp', tipo: 'image/webp' };
  }
  const b = await _fotoCanvasBlob(c, 'image/jpeg', q);
  if (!b) throw new Error('No se pudo achicar la foto');
  return { blob: b, ext: 'jpg', tipo: 'image/jpeg' };
}

function _fotoPut(ref, blob, meta, alAvanzar) {
  return new Promise((ok, mal) => {
    const task = ref.put(blob, meta);
    if (task && typeof task.on === 'function') {
      task.on('state_changed', s => alAvanzar && alAvanzar(s.bytesTransferred), mal, () => ok(task.snapshot));
    } else {
      Promise.resolve(task).then(ok, mal);   // por si no es un UploadTask
    }
  });
}

// Sube `files` al equipo `stockId`.
//   op.storage, op.db       → firebase.storage() / firebase.firestore()
//   op.alProgreso({ hechas, total, pct })
//   op.alSubir(url, i)      → cada foto ya anotada en el equipo
// Devuelve { urls, fallas }.
async function fotosSubir(stockId, files, op = {}) {
  files = Array.from(files || []);
  const total = files.length;
  if (!total) return { urls: [], fallas: 0 };
  const storage = op.storage || firebase.storage();
  const db = op.db || firebase.firestore();
  const doc = db.collection('stock').doc(stockId);
  const union = (...v) => firebase.firestore.FieldValue.arrayUnion(...v);

  // Progreso: bytes subidos / bytes a subir (los tamaños se conocen al achicar;
  // mientras tanto se estima con el original).
  const tam = files.map(f => Math.max(1, f.size || 1));
  const subido = files.map(() => 0);
  let hechas = 0;
  const avisar = () => {
    if (!op.alProgreso) return;
    const pct = Math.round(100 * subido.reduce((a, b) => a + b, 0) / tam.reduce((a, b) => a + b, 0));
    op.alProgreso({ hechas, total, pct: Math.min(99, pct) });
  };
  avisar();

  const urls = new Array(total).fill(null);
  const base = Date.now().toString(36);

  async function una(i) {
    for (let intento = 0; intento < 2; intento++) {
      try {
        const { blob, ext, tipo } = await fotoAchicar(files[i]);
        tam[i] = blob.size || 1;
        const ref = storage.ref(`stock-photos/${stockId}/${base}_${i}_${intento}.${ext}`);
        const snap = await _fotoPut(ref, blob, { contentType: tipo, cacheControl: FOTO_CACHE },
          b => { subido[i] = b; avisar(); });
        subido[i] = tam[i];
        return await snap.ref.getDownloadURL();
      } catch (e) {
        console.warn(`foto ${i + 1}: intento ${intento + 1} falló`, e);
        subido[i] = 0;
        if (intento === 1) return null;
      }
    }
    return null;
  }

  // Las subidas van en paralelo, pero se anotan en el equipo en orden: la foto
  // 2 espera a que esté anotada la 1 (así la portada es la que elegiste primero).
  const promesas = new Array(total);
  let sig = 0;
  const trabajador = async () => {
    while (sig < total) { const i = sig++; promesas[i] = una(i); await promesas[i]; }
  };
  const pool = Array.from({ length: Math.min(FOTO_PARALELO, total) }, trabajador);

  let fallas = 0;
  for (let i = 0; i < total; i++) {
    while (!promesas[i]) await new Promise(r => setTimeout(r, 30));   // todavía no arrancó
    const url = await promesas[i];
    if (!url) { fallas++; continue; }
    try {
      await doc.update({ fotos: union(url) });
      urls[i] = url;
      hechas++;
      avisar();
      if (op.alSubir) op.alSubir(url, i);
    } catch (e) {
      console.error('anotar foto en el equipo:', e);
      fallas++;
    }
  }
  await Promise.all(pool);
  if (op.alProgreso) op.alProgreso({ hechas, total, pct: 100 });
  return { urls: urls.filter(Boolean), fallas };
}
