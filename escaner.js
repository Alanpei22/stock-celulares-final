// ══════════════════════════════════════════════════════════════
//  escaner.js — Leer códigos de barras con la cámara del celu
// ══════════════════════════════════════════════════════════════
//  Usa BarcodeDetector, que viene ADENTRO del navegador (Chrome en Android):
//  cero librerías que bajar, cero peso extra, y anda sin internet una vez que
//  la app está cacheada.
//
//  Dónde NO anda: Safari de iPhone y Firefox no lo traen. En vez de romperse,
//  el cartel dice que se use el lector de mano o que se escriba el código.
//  (Si algún día hace falta iPhone: ahí sí hay que sumar una librería de ~200 KB
//  y este archivo es el único lugar donde se toca.)
//
//  No lee ni escribe NADA en Firebase: todo pasa en el celu.
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

// ¿El navegador puede leer códigos? (no pide permiso de cámara)
async function escanerDisponible() {
  if (typeof BarcodeDetector === 'undefined') return false;
  try {
    const soporta = await BarcodeDetector.getSupportedFormats();
    return ESCANER_FORMATOS.some(f => soporta.includes(f));
  } catch {
    return false;
  }
}

// Qué decirle al que toca el botón en un equipo que no puede leer códigos.
// Importa el detalle: en Android la solución es abrir la app en Chrome, en
// iPhone y en la PC no hay solución por ahora.
function _escSinSoporte() {
  const ua = (navigator.userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua))
    return 'El navegador del iPhone todavía no lee códigos con la cámara. Usá el lector de mano o escribí el código.';
  if (/Android/i.test(ua))
    return 'Este navegador no lee códigos. Abrí la app en Chrome desde el celular y probá de nuevo.';
  return 'Leer con la cámara anda en el celular (Chrome de Android), no en la computadora. Acá usá el lector de mano o escribí el código.';
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

  if (!(await escanerDisponible())) {
    toast(_escSinSoporte(), 'error');
    return false;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast(_escMotivo({}), 'error');
    return false;
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

  const detector = new BarcodeDetector({ formats: ESCANER_FORMATOS });
  _escTimer = setInterval(() => _escBuscar(detector, video), 220);
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
