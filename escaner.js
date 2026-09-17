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
    // Sin esto no lee un código apenas torcido, que es como se escanea de verdad
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
  } catch { hints = null; }
  const reader = new Z.BrowserMultiFormatReader(hints, 200);
  return {
    async detect(video) {
      try {
        const r = reader.decode(video);
        const txt = r && (typeof r.getText === 'function' ? r.getText() : r.text);
        return txt ? [{ rawValue: txt }] : [];
      } catch {
        return [];        // cuadro sin código: no es un error
      }
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
    _escStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
  _escMostrarLinterna();

  _escLector = nativo ? new BarcodeDetector({ formats: ESCANER_FORMATOS }) : _escLectorZxing();
  _escEstado('Buscando el código…');
  // El de respaldo tarda más por cuadro: se le da aire para no trabar la pantalla.
  _escTimer = setInterval(() => _escBuscar(_escLector, video), nativo ? 220 : 400);
  return true;
}

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

  const ahora = Date.now();
  if (raw === _escUltimo.cod && ahora - _escUltimo.t < _ESC_REPETIR_MS) return;
  _escUltimo = { cod: raw, t: ahora };

  _escAvisar(raw);
  const cb = _escCb;
  if (!_escOpts.continuo) cerrarEscaner();
  if (typeof cb === 'function') cb(raw);
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
  if (_escTimer) { clearInterval(_escTimer); _escTimer = null; }
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

// Si la app pasa a segundo plano (atendés a alguien, suena el teléfono), la
// cámara se apaga sola.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && _escStream) cerrarEscaner();
});
