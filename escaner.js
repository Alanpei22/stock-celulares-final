// ══════════════════════════════════════════════════════════════
//  escaner.js — Leer códigos de barras con la cámara del celu
// ══════════════════════════════════════════════════════════════
//  DOS MOTORES, y el liviano primero:
//
//   1. BarcodeDetector, que viene ADENTRO del navegador (Chrome en Android).
//      Cero peso, y anda sin internet apenas la app quedó cacheada.
//   2. Si el navegador no lo trae — Safari de iPhone, Chrome de escritorio en
//      Windows, Firefox — recién ahí se baja `vendor/zxing.min.js` (336 KB).
//      Se baja UNA vez por dispositivo y queda en el caché de la app.
//
//  Así el celular con Android, que es donde más se escanea, no paga los 336 KB
//  que solo necesitan la PC y el iPhone.
//
//  No lee ni escribe NADA en Firebase: todo pasa en el aparato.
// ══════════════════════════════════════════════════════════════
'use strict';

// Los que trae un producto de kiosco/accesorio + QR por si acaso.
const ESCANER_FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar', 'qr_code'];

// Mismo código leído dos veces seguidas: el detector dispara muchas veces por
// segundo mientras el código está enfrente.
const _ESC_REPETIR_MS = 2500;

let _escStream = null;     // MediaStream de la cámara
let _escTimer = null;      // loop de detección
let _escCb = null;         // a quién le avisamos el código
let _escUltimo = { cod: '', t: 0 };
let _escOpts = {};
let _escTrack = null;      // pista de video (para la linterna)
let _escLector = null;     // el motor en uso (nativo o de respaldo)
let _escAyudaTimer = null; // aviso de "no lo estoy leyendo"

// ¿El navegador trae el lector propio? (no pide permiso de cámara)
async function _escNativo() {
  if (typeof BarcodeDetector === 'undefined') return false;
  try {
    const soporta = await BarcodeDetector.getSupportedFormats();
    return ESCANER_FORMATOS.some(f => soporta.includes(f));
  } catch {
    return false;
  }
}

// ¿Se puede escanear en este aparato? Con cámara y https, sí: si falta el
// lector propio del navegador, se usa el de respaldo.
async function escanerDisponible() {
  if (await _escNativo()) return true;
  const hayCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  return hayCam && (typeof window === 'undefined' || window.isSecureContext !== false);
}

// ── Motor de respaldo (PC, iPhone, Firefox) ──────────────────
// Se baja recién cuando hace falta.
let _escZxingCarga = null;

function _escCargarZxing() {
  if (typeof ZXing !== 'undefined') return Promise.resolve(true);
  if (_escZxingCarga) return _escZxingCarga;
  _escZxingCarga = new Promise(res => {
    const sc = document.createElement('script');
    sc.src = 'vendor/zxing.min.js';
    sc.onload = () => res(typeof ZXing !== 'undefined');
    sc.onerror = () => { _escZxingCarga = null; res(false); };
    document.head.appendChild(sc);
  });
  return _escZxingCarga;
}

// ── Recortes del cuadro ─────────────────────────────────────
// Alan (18/11): "no funciona el lector de código de barras" con la etiqueta
// del proveedor (un Code 128 finito con el IMEI). Probado con su foto: sobre
// el cuadro ENTERO el lector no lo encuentra nunca (0 de 4), y recortando la
// franja del código lo lee siempre. Con todo el cuadro, el celular, el
// plástico y el texto de la etiqueta lo confunden.
// Así que además del cuadro entero se prueban franjas horizontales del
// medio, que es donde está el recuadro blanco en el que apuntás.
const ESC_FRANJAS = [0.16, 0.10, 0.26];   // alto de la franja (parte del cuadro)
let _escLienzo = null;

function escRecortes(vw, vh) {
  // El recuadro va de 8% a 92% del ancho: se toma un poco más, por si no
  // quedó centrado justo
  const x = Math.round(vw * 0.04), w = Math.round(vw * 0.92);
  return ESC_FRANJAS.map(k => {
    const h = Math.max(40, Math.round(vh * k));
    return { x, y: Math.round((vh - h) / 2), w, h };
  });
}

// Dibuja la franja en un lienzo de hasta 1000 px de ancho (agrandarla no
// ayuda: probado, a 2x deja de leer)
function _escFranja(video, r) {
  if (!_escLienzo) _escLienzo = document.createElement('canvas');
  const k = Math.min(1, 1000 / r.w);
  _escLienzo.width = Math.round(r.w * k);
  _escLienzo.height = Math.round(r.h * k);
  _escLienzo.getContext('2d').drawImage(video, r.x, r.y, r.w, r.h, 0, 0, _escLienzo.width, _escLienzo.height);
  return _escLienzo;
}

// Dónde empiezan y terminan las barras dentro de la franja: las columnas
// donde el brillo cambia mucho (negro-blanco-negro…). Probado con la foto de
// Alan: el lector de respaldo SOLO lee si el recorte arranca pegado a las
// barras (a 1% del ancho sí; a 2% o 4% ya no, aunque sea papel blanco).
// Devuelve [desde, hasta] en píxeles del lienzo, o null.
function escBordesBarras(datos, ancho, alto) {
  if (!ancho || !alto) return null;
  const act = new Float32Array(ancho);
  for (const fr of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    const y = Math.min(alto - 1, Math.round(alto * fr));
    let prev = -1;
    for (let x = 0; x < ancho; x++) {
      const i = (y * ancho + x) * 4;
      const v = datos[i] * 0.3 + datos[i + 1] * 0.59 + datos[i + 2] * 0.11;
      if (prev >= 0 && Math.abs(v - prev) > 40) act[x]++;
      prev = v;
    }
  }
  // Suavizado (ventana de 4% del ancho) para que las barras formen un bloque
  const R = Math.max(2, Math.round(ancho * 0.02));
  const sm = new Float32Array(ancho);
  let acc = 0;
  for (let x = 0; x < ancho; x++) {
    acc += act[x];
    if (x - 2 * R - 1 >= 0) acc -= act[x - 2 * R - 1];
    sm[Math.max(0, x - R)] = acc;
  }
  let mx = 0;
  for (let x = 0; x < ancho; x++) if (sm[x] > mx) mx = sm[x];
  if (mx < 4) return null;
  const umbral = mx * 0.25;
  let mejor = null, ini = -1;
  for (let x = 0; x <= ancho; x++) {
    const on = x < ancho && sm[x] > umbral;
    if (on && ini < 0) ini = x;
    if (!on && ini >= 0) { if (!mejor || x - ini > mejor[1] - mejor[0]) mejor = [ini, x]; ini = -1; }
  }
  // Muy angosto no es un código de barras
  if (!mejor || mejor[1] - mejor[0] < ancho * 0.15) return null;
  return mejor;
}

// El lector del navegador (Android) también prueba las franjas si en el
// cuadro entero no encontró nada
function _escLectorNativo() {
  const det = new BarcodeDetector({ formats: ESCANER_FORMATOS });
  let vuelta = 0;
  return {
    async detect(video) {
      const r = await det.detect(video);
      if (r && r.length) return r;
      // Una franja por vuelta, para no cargar el celu
      const rs = escRecortes(video.videoWidth, video.videoHeight);
      const f = rs[vuelta++ % rs.length];
      try { return await det.detect(_escFranja(video, f)); } catch { return []; }
    },
    stop() {},
  };
}

// Envoltorio con la MISMA forma que BarcodeDetector: detect(video) → [{rawValue}].
// Así el resto del archivo no sabe cuál de los dos motores está usando.
function _escLectorZxing() {
  const Z = ZXing;
  let hints = null;
  try {
    hints = new Map();
    const F = Z.BarcodeFormat;
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
      F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.CODABAR, F.QR_CODE,
    ]);
    // OJO: NADA de TRY_HARDER. Suena a que ayuda, pero en esta versión de ZXing
    // deja de leer del todo: medido contra un EAN-13 de verdad, 0 de 6 con el
    // hint puesto y 6 de 6 sin él. Fue el motivo de que no leyera nada.
  } catch { hints = null; }
  const reader = new Z.BrowserMultiFormatReader(hints, 200);
  // DOS intentos por cuadro: esta versión de ZXing falla uno sí y uno no sobre
  // la MISMA imagen (medido: 10 de 20 con un intento, 20 de 20 con dos). Cada
  // intento cuesta ~17 ms, así que sale gratis.
  const texto = r => r && (typeof r.getText === 'function' ? r.getText() : r.text);
  const leer = lienzo => {
    try {
      const bm = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(lienzo)));
      return texto(reader.decodeBitmap(bm)) || '';
    } catch { return ''; }
  };
  let _ajustado = null;
  // Una franja recortada → código (o nada). Primero recortada justo en las
  // barras (con poco margen), que es como lee las etiquetas finitas.
  const deFranja = (video, rec) => {
    const lienzo = _escFranja(video, rec);
    try {
      const g = lienzo.getContext('2d');
      const b = escBordesBarras(g.getImageData(0, 0, lienzo.width, lienzo.height).data, lienzo.width, lienzo.height);
      if (b) {
        if (!_ajustado) _ajustado = document.createElement('canvas');
        for (const k of [0.01, 0.005, 0.02]) {
          const m = Math.round(lienzo.width * k);
          const x0 = Math.max(0, b[0] - m), x1 = Math.min(lienzo.width, b[1] + m);
          _ajustado.width = x1 - x0; _ajustado.height = lienzo.height;
          _ajustado.getContext('2d').drawImage(lienzo, x0, 0, x1 - x0, lienzo.height, 0, 0, x1 - x0, lienzo.height);
          const t = leer(_ajustado);
          if (t) return t;
        }
      }
    } catch { /* sigue con la franja entera */ }
    return leer(lienzo);
  };
  // Antes cada vuelta probaba las 3 franjas (hasta 4 lecturas cada una) y
  // después el cuadro entero dos veces: hasta 14 lecturas seguidas sin soltar
  // la pantalla, y en un celu eso la trababa. Ahora cada vuelta tiene un tope
  // de tiempo, las franjas se van turnando y el cuadro entero (el más caro)
  // va una vuelta de cada tres. En unas pocas vueltas se prueba todo igual.
  const TOPE_MS = 90;
  let _vuelta = 0;
  // (local: las pruebas cargan solo esta función)
  const _escAhora = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  return {
    async detect(video) {
      const t0 = _escAhora();
      const n = _vuelta++;
      // (typeof: las pruebas cargan solo esta función, sin las de recortes)
      const puedeFranjas = !!(video.videoWidth && typeof escRecortes === 'function' && typeof document !== 'undefined' && document.createElement
          && Z.HTMLCanvasElementLuminanceSource && Z.HybridBinarizer);
      // Una vuelta de cada tres es SOLO para el cuadro entero: si va después de
      // las franjas, en un celu lento el tope se gasta antes y nunca llega (y
      // los EAN de las cajas dejaban de leerse)
      const tocaEntero = !puedeFranjas || n % 3 === 2;
      // Las franjas del medio (así lee la etiqueta de los equipos)
      if (puedeFranjas && !tocaEntero) {
        const recs = escRecortes(video.videoWidth, video.videoHeight);
        for (let i = 0; i < recs.length; i++) {
          const t = deFranja(video, recs[(n + i) % recs.length]);
          if (t) return [{ rawValue: t }];
          if (_escAhora() - t0 > TOPE_MS) return [];     // se sigue en la próxima vuelta
        }
      }
      // El cuadro entero (así lee los EAN de las cajas). Dos intentos: esta
      // versión de ZXing falla uno sí y uno no sobre la misma imagen.
      if (tocaEntero) {
        for (let i = 0; i < 2; i++) {
          try {
            const txt = texto(reader.decode(video));
            if (txt) return [{ rawValue: txt }];
          } catch { /* cuadro sin código: no es un error */ }
        }
      }
      return [];
    },
    stop() { try { reader.reset(); } catch {} },
  };
}

// Ya no hay aparatos sin lector: lo que puede faltar es la cámara o el https.
function _escSinSoporte() {
  if (typeof window !== 'undefined' && window.isSecureContext === false)
    return 'La cámara solo funciona con https. Entrá a la app por su dirección web, no por el archivo.';
  return 'Este dispositivo no tiene cámara disponible. Usá el lector de mano o escribí el código.';
}

// Por qué no se puede, en castellano y con la salida a mano.
function _escMotivo(e) {
  const n = (e && e.name) || '';
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError')
    return 'No diste permiso para usar la cámara. Tocá el candado en la barra de direcciones y habilitala.';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError')
    return 'No encontré ninguna cámara en este dispositivo.';
  if (n === 'NotReadableError')
    return 'La cámara está ocupada por otra aplicación. Cerrala y probá de nuevo.';
  if (!window.isSecureContext)
    return 'La cámara solo funciona con https.';
  return 'No se pudo abrir la cámara.';
}

// Abre el lector. cb recibe el código leído.
// opts.continuo = true → sigue escaneando después de cada código (para cargar
// varios seguidos); si no, se cierra solo con el primero.
// opts.titulo   → qué dice arriba.
async function abrirEscaner(cb, opts = {}) {
  const modal = document.getElementById('esc-modal');
  const video = document.getElementById('esc-video');
  if (!modal || !video) { toast('Falta el lector en esta pantalla', 'error'); return false; }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast(_escSinSoporte(), 'error');
    return false;
  }

  // Motor: el del navegador si está; si no, el de respaldo (se baja una vez).
  const nativo = await _escNativo();
  if (!nativo) {
    _escEstado('Preparando el lector…');
    toast('Preparando el lector por primera vez…', 'info');
    if (!(await _escCargarZxing())) {
      toast('No se pudo preparar el lector. Probá con internet una primera vez.', 'error');
      return false;
    }
  }

  _escCb = cb;
  _escOpts = opts;
  _escUltimo = { cod: '', t: 0 };
  const tit = document.getElementById('esc-titulo');
  if (tit) tit.textContent = opts.titulo || 'Escaneá el código de barras';
  _escEstado('Buscando el código…');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  try {
    // facingMode ideal (no exact): en una tablet con una sola cámara, `exact`
    // falla y no abre nada.
    //
    // 1920 y no 1280: un código de barras chico se juega en cuántos píxeles
    // entran en la barra más fina. A 1280, una barra de 0,25mm en una etiqueta
    // que ocupa medio cuadro son ~4 píxeles; a 1920 son ~6, y ahí el lector
    // empieza a engancharla. `ideal` y no `exact`: si la cámara no da, baja sola.
    _escStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (e) {
    console.error('escáner:', e);
    cerrarEscaner();
    toast(_escMotivo(e), 'error');
    return false;
  }

  video.srcObject = _escStream;
  video.setAttribute('playsinline', '');   // iOS: sin esto abre el video a pantalla completa
  try { await video.play(); } catch { /* algunos navegadores ya lo arrancan solos */ }

  _escTrack = _escStream.getVideoTracks()[0] || null;
  _escEnfoqueContinuo();
  _escZoomUtil();
  _escMostrarLinterna();

  _escLector = nativo ? _escLectorNativo() : _escLectorZxing();
  _escEstado('Buscando el código…');
  // Si a los 8 segundos no leyó nada, el problema suele ser distancia o luz.
  // Sin este aviso te quedás mirando la pantalla sin saber qué está pasando.
  _escAyudaTimer = setTimeout(() => {
    // Las etiquetas de los equipos tienen barras muy finas: tienen que llenar
    // el recuadro (probado: más chicas, no se leen)
    if (_escStream && !_escUltimo.cod) _escEstado('No lo estoy leyendo. Que el código llene casi todo el ancho del recuadro, derecho, con luz y sin reflejo.');
  }, 8000);
  // Alan (21/11): "la app en el celu se frezzea". Antes era un setInterval:
  // cada 220/350 ms arrancaba una búsqueda AUNQUE la anterior no hubiera
  // terminado, y en el iPhone (sin lector propio) una búsqueda podía tardar
  // más que eso → se encimaban y la pantalla no respondía ni al ✕. Ahora la
  // próxima vuelta se programa recién cuando termina la anterior, con un
  // respiro proporcional a lo que tardó (la pantalla siempre llega a pintar).
  const pausa = nativo ? 150 : 250;
  const vuelta = async () => {
    if (!_escStream) return;
    const t0 = _escAhora();
    try { await _escBuscar(_escLector, video); } catch (e) { /* un cuadro fallado no corta el loop */ }
    if (!_escStream) return;
    _escTimer = setTimeout(vuelta, Math.max(pausa, (_escAhora() - t0) * 1.5));
  };
  _escTimer = setTimeout(vuelta, pausa);
  return true;
}

function _escAhora() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

async function _escBuscar(detector, video) {
  if (!_escStream) return;
  if (document.hidden) return;              // pantalla apagada o app en segundo plano
  if (!video.videoWidth) return;            // todavía no arrancó el video
  let codigos = [];
  try {
    codigos = await detector.detect(video);
  } catch (e) {
    return;                                  // un cuadro fallado no es un error
  }
  const raw = codigos && codigos.length ? String(codigos[0].rawValue || '').trim() : '';
  if (!raw) return;

  // Filtro del que pidió el escaneo: para un IMEI, el código de barras del
  // producto no sirve. Se sigue buscando en vez de cargar cualquier número.
  let valor = raw;
  if (typeof _escOpts.validar === 'function') {
    valor = _escOpts.validar(raw);
    if (!valor) {
      _escEstado(_escOpts.noSirve || 'Ese código no sirve acá. Buscá el otro de la etiqueta.');
      return;
    }
  }

  const ahora = Date.now();
  if (raw === _escUltimo.cod && ahora - _escUltimo.t < _ESC_REPETIR_MS) return;
  _escUltimo = { cod: raw, t: ahora };
  if (_escAyudaTimer) { clearTimeout(_escAyudaTimer); _escAyudaTimer = null; }

  _escAvisar(valor);
  const cb = _escCb;
  // opts.conFoto: se guarda también lo que veía la cámara (antes de apagarla),
  // para leer con IA el resto de la etiqueta (modelo, capacidad, color…)
  const foto = _escOpts.conFoto ? escFotoDelCuadro(video) : null;
  if (!_escOpts.continuo) cerrarEscaner();
  if (typeof cb === 'function') cb(valor, foto);
}

// El cuadro de la cámara como foto (JPG, hasta 1400 px)
function escFotoDelCuadro(video) {
  try {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const k = Math.min(1, 1400 / Math.max(vw, vh));
    const c = document.createElement('canvas');
    c.width = Math.round(vw * k); c.height = Math.round(vh * k);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } catch { return null; }
}

// Que se note que leyó, sin mirar la pantalla.
function _escAvisar(cod) {
  try { if (navigator.vibrate) navigator.vibrate(60); } catch {}
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.05;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 90);
    }
  } catch {}
  _escEstado('✓ ' + cod);
}

function _escEstado(txt) {
  const el = document.getElementById('esc-estado');
  if (el) el.textContent = txt;
}

// Enfoque continuo: un código de barras chico, a 10 cm, sale borroso si la
// cámara se queda con el enfoque fijo. No todas lo soportan; si no, no pasa nada.
function _escEnfoqueContinuo() {
  if (!_escTrack || !_escTrack.applyConstraints) return;
  try {
    const cap = _escTrack.getCapabilities ? _escTrack.getCapabilities() : {};
    if (cap.focusMode && cap.focusMode.includes && cap.focusMode.includes('continuous')) {
      _escTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }
  } catch { /* la cámara no deja tocar el enfoque: seguimos igual */ }
}

// Un poco de zoom, si la cámara lo tiene.
//
// El problema de fondo con los códigos chicos es que el celular NO ENFOCA abajo
// de unos 10 cm: acercás para que se vea grande y sale todo borroso. Con zoom
// óptico/digital se lo deja a una distancia donde enfoca y el código igual
// ocupa buena parte del cuadro.
//
// 2x o lo máximo que dé, lo que sea menor. Más que eso recorta tanto que hay
// que tener mucho pulso para encuadrar.
function _escZoomUtil() {
  if (!_escTrack || !_escTrack.applyConstraints) return;
  try {
    const cap = _escTrack.getCapabilities ? _escTrack.getCapabilities() : {};
    if (!cap || typeof cap.zoom !== 'object' || !cap.zoom) return;
    const min = Number(cap.zoom.min) || 1;
    const max = Number(cap.zoom.max) || 1;
    if (!(max > min)) return;
    const z = Math.min(max, Math.max(min, min * 2));
    _escTrack.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {});
  } catch { /* la cámara no deja tocar el zoom: seguimos igual */ }
}

// ── Linterna ────────────────────────────────────────────────
// Un código impreso en una caja, en un local con poca luz, no se lee sin esto.
function _escMostrarLinterna() {
  const btn = document.getElementById('esc-luz');
  if (!btn) return;
  let puede = false;
  try {
    puede = !!(_escTrack && _escTrack.getCapabilities && _escTrack.getCapabilities().torch);
  } catch {}
  btn.classList.toggle('hidden', !puede);
  btn.dataset.on = '';
}

async function escanerLuz() {
  const btn = document.getElementById('esc-luz');
  if (!_escTrack || !btn) return;
  const prender = btn.dataset.on !== '1';
  try {
    await _escTrack.applyConstraints({ advanced: [{ torch: prender }] });
    btn.dataset.on = prender ? '1' : '';
    btn.textContent = prender ? '🔦 Apagar luz' : '🔦 Luz';
  } catch (e) {
    console.error('linterna:', e);
    btn.classList.add('hidden');
  }
}

// Cerrar SIEMPRE apaga la cámara: si el stream queda abierto, el celu se
// calienta y la luz de la cámara queda prendida.
function cerrarEscaner() {
  if (_escTimer) { clearTimeout(_escTimer); _escTimer = null; }
  if (_escAyudaTimer) { clearTimeout(_escAyudaTimer); _escAyudaTimer = null; }
  if (_escStream) {
    try { _escStream.getTracks().forEach(t => t.stop()); } catch {}
    _escStream = null;
  }
  if (_escLector && typeof _escLector.stop === 'function') _escLector.stop();
  _escLector = null;
  _escTrack = null;
  const video = document.getElementById('esc-video');
  if (video) { try { video.pause(); } catch {} video.srcObject = null; }
  const modal = document.getElementById('esc-modal');
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = '';
  const btn = document.getElementById('esc-luz');
  if (btn) { btn.classList.add('hidden'); btn.dataset.on = ''; btn.textContent = '🔦 Luz'; }
  _escCb = null;
  _escOpts = {};
}

// ══════════════════════════════════════════════════════════════
//  IMEI CON LA CÁMARA
//  ─────────────────────────────────────────────────────────────
//  El IMEI está impreso en la caja del equipo y atrás del celular, en código
//  de barras. Tipearlo a mano son 15 dígitos y un error de tipeo se arrastra a
//  la boleta, a la garantía y al día que haya que consultarlo.
// ══════════════════════════════════════════════════════════════

// Escanea dentro de un campo de IMEI. Solo acepta un número que cierre por
// Luhn: si apuntás al código de barras del producto, sigue buscando.
function escanearImei(inputId, campos) {
  const inp = document.getElementById(inputId);
  if (!inp) return Promise.resolve(false);
  return abrirEscaner((imei, foto) => {
    inp.value = imei;
    // 'input' para que el cartelito de validación se vuelva a pintar
    try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    try { inp.focus(); } catch {}
    toast('📷 IMEI ' + imei, 'success');
    // Y de paso, qué equipo es
    _autocompletarPorImei(imei, campos || _CAMPOS_EQUIPO[inputId]);
    // Alan (18/11): "fijate que lea la info completa". El código de barras
    // trae solo el IMEI; el resto de la etiqueta está escrito. Al cargar un
    // equipo, la foto del mismo escaneo va a la IA y completa lo demás.
    if (foto && inputId === 'fi-imei' && typeof etqCompletarDesdeFoto === 'function') etqCompletarDesdeFoto(foto);
  }, {
    titulo: 'Escaneá el IMEI de la etiqueta',
    // Sigue leyendo hasta encontrar uno válido: las cajas tienen varios
    // códigos juntos (IMEI, serie, EAN del producto).
    continuo: false,
    conFoto: inputId === 'fi-imei',   // agregar equipo: leer también el resto de la etiqueta
    validar: raw => (typeof imeiDesdeCodigo === 'function' ? imeiDesdeCodigo(raw) : null),
    noSirve: 'Ese no es el IMEI (puede ser la serie o el código del producto). Probá con el otro.',
  });
}

// ══════════════════════════════════════════════════════════════
//  QUÉ EQUIPO ES, A PARTIR DEL IMEI
//  ─────────────────────────────────────────────────────────────
//  Los primeros 8 dígitos del IMEI (el TAC) identifican el modelo: son iguales
//  en todas las unidades del mismo equipo. Con eso se completa marca y modelo
//  al escanear, en vez de tipearlos.
//
//  Dos fuentes, en este orden:
//   1. TU historial. Si ese TAC ya lo cargaste, se usa TU forma de escribirlo
//      ("A54" y no "GALAXY A54 5G"), que es la que después buscás.
//   2. `vendor/tac.json`: 109.000 códigos de las marcas que se venden acá,
//      sacados de una base pública. Se baja una sola vez por dispositivo
//      (~440 KB comprimido) y recién cuando hace falta.
//
//  Lo que el IMEI NO dice: capacidad, color ni estado. Eso se sigue cargando.
// ══════════════════════════════════════════════════════════════
let _tacTabla = null;
let _tacCarga = null;

function tacDe(imei) {
  const d = (typeof imeiDigitos === 'function') ? imeiDigitos(imei) : String(imei || '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(0, 8) : '';
}

// Lo que ya cargaste vos, que manda sobre la tabla.
function _modeloEnHistorial(tac) {
  const listas = [
    (typeof STOCK !== 'undefined' && Array.isArray(STOCK)) ? STOCK : [],
    (typeof REPAIRS !== 'undefined' && Array.isArray(REPAIRS)) ? REPAIRS : [],
  ];
  for (const lista of listas) {
    for (let i = lista.length - 1; i >= 0; i--) {
      const p = lista[i];
      if (!p || !p.imei || !p.marca) continue;
      if (tacDe(p.imei) !== tac) continue;
      return { marca: p.marca, modelo: p.modelo || '', fuente: 'historial' };
    }
  }
  return null;
}

async function _tacCargarTabla() {
  if (_tacTabla) return _tacTabla;
  if (_tacCarga) return _tacCarga;
  _tacCarga = (async () => {
    try {
      const r = await fetch('vendor/tac.json');
      const j = await r.json();
      // Formato compacto: modelos aparte, para que el archivo pese la mitad
      if (j && Array.isArray(j.m) && j.t) _tacTabla = j;
    } catch (e) {
      console.error('tabla de modelos:', e);
    } finally {
      _tacCarga = null;
    }
    return _tacTabla;
  })();
  return _tacCarga;
}

// { marca, modelo, fuente } o null. No baja nada si el IMEI no sirve.
async function modeloPorImei(imei) {
  const tac = tacDe(imei);
  if (!tac) return null;
  const propio = _modeloEnHistorial(tac);
  if (propio) return propio;
  const tabla = await _tacCargarTabla();
  if (!tabla) return null;
  const i = tabla.t[tac];
  if (i == null) return null;
  const partes = String(tabla.m[i] || '').split('|');
  if (!partes[0]) return null;
  return { marca: partes[0], modelo: partes[1] || '', fuente: 'tabla' };
}

// Completa marca y modelo DESPUÉS de escanear, sin pisar lo que ya escribiste.
async function _autocompletarPorImei(imei, campos) {
  if (!campos) return;
  const m = await modeloPorImei(imei);
  if (!m) return;
  const puesto = [];
  const poner = (id, val) => {
    const el = id && document.getElementById(id);
    if (!el || !val || el.value.trim()) return;   // no pisar lo cargado
    el.value = val;
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    puesto.push(val);
  };
  poner(campos.marca, m.marca);
  poner(campos.modelo, m.modelo);
  if (puesto.length) {
    toast(`📱 ${puesto.join(' ')} — ${m.fuente === 'historial' ? 'como lo cargaste antes' : 'según el IMEI'}. Corregí si no coincide.`, 'success');
  }
}

// Qué campos de marca/modelo acompañan a cada campo de IMEI.
const _CAMPOS_EQUIPO = {
  'fi-imei':     { marca: 'fi-marca',     modelo: 'fi-modelo' },      // alta de stock
  'rep-fi-imei': { marca: 'rep-fi-marca', modelo: 'rep-fi-modelo' },  // ingreso de reparación
};

// Pone el botón de cámara al lado de un campo de IMEI, sin tocar el HTML de
// cada formulario (son cuatro: stock, reparación y los dos de la venta).
function imeiBotonCam(inputId) {
  const inp = document.getElementById(inputId);
  if (!inp || document.getElementById(inputId + '-cam')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = inputId + '-cam';
  btn.className = 'imei-cam-btn';
  btn.textContent = '📷';
  btn.title = 'Escanear el IMEI con la cámara';
  btn.onclick = () => escanearImei(inputId);
  inp.insertAdjacentElement('afterend', btn);
  inp.classList.add('fi--con-cam');
}

// Si la app pasa a segundo plano (atendés a alguien, suena el teléfono), la
// cámara se apaga sola.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && _escStream) cerrarEscaner();
});
