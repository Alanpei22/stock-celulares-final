// Leer códigos de barras con la cámara (escaner.js) y cargar productos al
// inventario desde ahí.
//
// Lo que más se vigila: que la cámara SIEMPRE se apague. Un stream que queda
// abierto deja la luz prendida, calienta el celu y se come la batería en el
// mostrador.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── DOM mínimo ──
const els = {};
const mk = id => els[id] = {
  id, textContent: '', value: '', srcObject: 'nada', videoWidth: 640, dataset: {},
  style: {}, classList: { _s: new Set(['hidden']), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                          toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  play: async () => {}, pause() {}, setAttribute() {}, addEventListener() {},
};
['esc-modal', 'esc-video', 'esc-titulo', 'esc-estado', 'esc-luz', 'inv-scan-cam', 'inv-scan-input'].forEach(mk);

// ── Cámara y detector falsos ──
let CAMARA = { pedidos: [], falla: null };
let TRACKS = [];
function nuevoTrack(conLinterna) {
  const t = { activo: true, torch: false, stop() { this.activo = false; },
              getCapabilities: () => (conLinterna ? { torch: true } : {}),
              applyConstraints: async c => { t.torch = !!(c.advanced && c.advanced[0].torch); } };
  TRACKS.push(t);
  return t;
}
let LEIDOS = [];        // lo que "ve" la cámara en cada vuelta
const TOASTS = [];
let TICK = null;        // el loop de detección, para hacerlo correr a mano
const SCRIPTS = [];     // los <script> que la app pidió bajar
let CARGA_FALLA = false;
let ZXING_RESET = 0;
// La librería de respaldo, con la misma forma que usa escaner.js
const ZXING_FALSO = {
  BarcodeFormat: { EAN_13: 1, EAN_8: 2, UPC_A: 3, UPC_E: 4, CODE_128: 5, CODE_39: 6, ITF: 7, CODABAR: 8, QR_CODE: 9 },
  DecodeHintType: { POSSIBLE_FORMATS: 2, TRY_HARDER: 3 },
  BrowserMultiFormatReader: class {
    constructor(hints) { this.hints = hints; }
    decode() {
      if (!LEIDOS.length) throw new Error('NotFoundException');
      return { getText: () => LEIDOS[0] };
    }
    reset() { ZXING_RESET++; }
  },
};
let VISIBILITY = null;  // handler de visibilitychange

const ctx = {
  console, Date, Math, JSON, Promise, String, Number,
  setInterval: (f, ms) => { TICK = f; return 7; },
  clearInterval: () => { TICK = null; },
  setTimeout: f => { f(); return 0; },
  document: {
    hidden: false,
    getElementById: id => els[id] || null,
    addEventListener: (ev, fn) => { if (ev === 'visibilitychange') VISIBILITY = fn; },
    body: { style: {} },
    querySelector: () => null, querySelectorAll: () => [],
    // El lector de respaldo se baja con un <script>: acá se simula.
    createElement: () => { const sc = { src: '', onload: null, onerror: null }; SCRIPTS.push(sc); return sc; },
    head: { appendChild: sc => setImmediate(() => (CARGA_FALLA ? sc.onerror && sc.onerror() : (ctx.ZXing = ZXING_FALSO, sc.onload && sc.onload()))) },
  },
  navigator: {
    vibrate: () => true,
    mediaDevices: {
      getUserMedia: async c => {
        CAMARA.pedidos.push(c);
        if (CAMARA.falla) throw CAMARA.falla;
        const t = nuevoTrack(CAMARA.conLinterna);
        return { getTracks: () => [t], getVideoTracks: () => [t] };
      },
    },
  },
  window: { isSecureContext: true },
  toast: (m, t) => TOASTS.push([t, m]),
};
ctx.globalThis = ctx; ctx.self = ctx; ctx.window.AudioContext = null;
ctx.BarcodeDetector = class {
  constructor(o) { this.formats = o.formats; }
  static async getSupportedFormats() { return ['ean_13', 'code_128', 'qr_code']; }
  async detect() { return LEIDOS.map(rawValue => ({ rawValue })); }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'escaner.js', 'utf8'), ctx, { filename: 'escaner.js' });
const get = e => vm.runInContext(e, ctx);
const run = c => vm.runInContext(c, ctx);
const abierta = () => TRACKS.some(t => t.activo);
ctx.__BD = ctx.BarcodeDetector;   // guardado antes de probar "navegador sin soporte"

(async () => {

console.log('\n1) Abre la cámara de atrás');
const CODIGOS = [];
LEIDOS = [];
let abrio = await get(`abrirEscaner(c => __COD.push(c), { titulo: 'Escaneá el código del producto' })`.replace('__COD', 'COD'), ctx.COD = CODIGOS);
ok(abrio === true, 'abre');
const pedido = CAMARA.pedidos[0].video;
ok(pedido.facingMode && pedido.facingMode.ideal === 'environment',
   'pide la cámara de atrás como "ideal", no "exact" (con exact, una tablet de una sola cámara no abre nada)', pedido);
ok(CAMARA.pedidos[0].audio === false, 'y no pide el micrófono');
ok(!els['esc-modal'].classList.contains('hidden'), 'se ve el lector');
ok(els['esc-titulo'].textContent === 'Escaneá el código del producto', 'con el título que le pasaron', els['esc-titulo'].textContent);
ok(typeof TICK === 'function', 'quedó buscando códigos');

console.log('\n2) Lee un código, avisa y apaga la cámara');
LEIDOS = ['7790895000997'];
await TICK();
ok(CODIGOS[0] === '7790895000997', 'devuelve el código leído', CODIGOS);
ok(!abierta(), 'la cámara queda APAGADA (si no, el celu se calienta y la luz queda prendida)');
ok(els['esc-modal'].classList.contains('hidden'), 'y el lector se cierra');
ok(els['esc-video'].srcObject === null, 'sin dejar el video colgado', els['esc-video'].srcObject);
ok(TICK === null, 'y sin el loop corriendo');

console.log('\n3) El mismo código no se carga dos veces');
// El detector dispara varias veces por segundo mientras el código está enfrente.
CODIGOS.length = 0;
await get(`abrirEscaner(c => COD.push(c), { continuo: true })`);
LEIDOS = ['7790895000997'];
await TICK(); await TICK(); await TICK();
ok(CODIGOS.length === 1, 'tres vueltas con el código enfrente = una sola carga', CODIGOS);
LEIDOS = ['7791234567890'];
await TICK();
ok(CODIGOS.length === 2, 'pero otro código sí entra', CODIGOS);
ok(abierta(), 'en modo continuo la cámara sigue prendida para el siguiente');
run('cerrarEscaner()');
ok(!abierta(), 'y cerrando se apaga');

console.log('\n4) Si la app pasa a segundo plano, la cámara se apaga sola');
await get(`abrirEscaner(() => {})`);
ok(abierta(), 'prendida');
ctx.document.hidden = true;
VISIBILITY();
ok(!abierta(), 'atendés a alguien, la app queda atrás y la cámara se apaga');
ctx.document.hidden = false;

console.log('\n5) Sin permiso: dice qué hacer, y no queda nada prendido');
TOASTS.length = 0;
CAMARA.falla = Object.assign(new Error('x'), { name: 'NotAllowedError' });
abrio = await get(`abrirEscaner(() => {})`);
ok(abrio === false, 'no abre');
ok(TOASTS.some(t => /permiso/i.test(t[1]) && /candado|habilit/i.test(t[1])),
   'explica cómo darle permiso, no solo "error"', TOASTS);
ok(!abierta() && els['esc-modal'].classList.contains('hidden'), 'y no queda el lector abierto en negro');
CAMARA.falla = Object.assign(new Error('x'), { name: 'NotReadableError' });
TOASTS.length = 0;
await get(`abrirEscaner(() => {})`);
ok(TOASTS.some(t => /otra aplicación/i.test(t[1])), 'cámara ocupada: también lo dice', TOASTS);
CAMARA.falla = null;

console.log('\n6) Linterna solo si la cámara la tiene');
CAMARA.conLinterna = false;
await get(`abrirEscaner(() => {})`);
ok(els['esc-luz'].classList.contains('hidden'), 'sin linterna, el botón no aparece');
run('cerrarEscaner()');
CAMARA.conLinterna = true;
await get(`abrirEscaner(() => {})`);
ok(!els['esc-luz'].classList.contains('hidden'), 'con linterna, sí');
await get('escanerLuz()');
ok(TRACKS[TRACKS.length - 1].torch === true, 'y la prende (un código impreso sin luz no se lee)');
await get('escanerLuz()');
ok(TRACKS[TRACKS.length - 1].torch === false, 'y la apaga');
run('cerrarEscaner()');

console.log('\n7) Navegador sin lector propio: se baja el de respaldo');
// Safari de iPhone, Chrome de escritorio en Windows y Firefox no traen
// BarcodeDetector. Antes ahí no se podía escanear; ahora se usa ZXing.
ok(await get('escanerDisponible()') === true, 'con lector propio: disponible');
run('BarcodeDetector = undefined');
ok(await get('_escNativo()') === false, 'sin lector propio del navegador');
ok(await get('escanerDisponible()') === true, 'pero igual se puede escanear (hay cámara)');

SCRIPTS.length = 0;
const CODB = [];
ctx.COD = CODB;
LEIDOS = [];
abrio = await get(`abrirEscaner(c => COD.push(c))`);
ok(abrio === true, 'abre igual');
ok(SCRIPTS.length === 1 && /vendor\/zxing\.min\.js$/.test(SCRIPTS[0].src),
   'bajó el lector de respaldo desde la app, no de internet', SCRIPTS.map(x => x.src));
LEIDOS = ['7790895000997'];
await TICK();
ok(CODB[0] === '7790895000997', 'y lee el código igual que el nativo', CODB);
ok(!abierta(), 'la cámara también se apaga');
ok(ZXING_RESET > 0, 'y el lector de respaldo se frena (si no, sigue procesando cuadros)');

console.log('\n7b) Se baja una sola vez, y solo donde hace falta');
SCRIPTS.length = 0;
await get(`abrirEscaner(() => {})`);
ok(SCRIPTS.length === 0, 'la segunda vez ya está cargado: no se vuelve a bajar', SCRIPTS.length);
run('cerrarEscaner()');
run('BarcodeDetector = __BD; ZXing = undefined; _escZxingCarga = null;');
SCRIPTS.length = 0;
await get(`abrirEscaner(() => {})`);
ok(SCRIPTS.length === 0,
   'con lector propio (Android) NO se bajan los 336 KB', SCRIPTS.map(x => x.src));
run('cerrarEscaner()');

console.log('\n7c) Si no se puede bajar, lo dice');
run('BarcodeDetector = undefined; ZXing = undefined; _escZxingCarga = null;');
CARGA_FALLA = true;
TOASTS.length = 0;
abrio = await get(`abrirEscaner(() => {})`);
ok(abrio === false, 'no abre a medias');
ok(TOASTS.some(t => /internet/i.test(t[1])), 'y explica que la primera vez necesita internet', TOASTS);
ok(!abierta(), 'sin dejar la cámara prendida');
CARGA_FALLA = false;
run('BarcodeDetector = __BD; ZXing = undefined; _escZxingCarga = null;');

console.log('\n7d) El envoltorio contra la ZXing DE VERDAD');
// Las pruebas de arriba usan una librería de mentira. Esto carga la real de
// vendor/ y llama al envoltorio igual que lo hace la app: si una versión nueva
// de ZXing cambia el constructor, el decode o el reset, se cae acá.
{
  const px = new Uint8ClampedArray(640 * 480 * 4).fill(255);   // imagen en blanco
  const lienzo = { width: 640, height: 480, style: {},
    getContext: () => ({ drawImage() {}, getImageData: () => ({ data: px, width: 640, height: 480 }) }) };
  const c2 = { console, setTimeout, clearTimeout, Math, Date, Map, Set,
    Uint8ClampedArray, Uint8Array, Int32Array, Float32Array,
    document: { createElement: t => (t === 'canvas' ? lienzo : { style: {} }), body: { appendChild() {} } },
    navigator: { userAgent: 'node' } };
  c2.self = c2; c2.globalThis = c2; c2.window = c2;
  vm.createContext(c2);
  vm.runInContext(fs.readFileSync(DIR + 'vendor/zxing.min.js', 'utf8'), c2, { filename: 'zxing.min.js' });
  const fuente = fs.readFileSync(DIR + 'escaner.js', 'utf8');
  const desde = fuente.indexOf('function _escLectorZxing()');
  const hasta = fuente.indexOf('\n}\n', desde) + 3;
  vm.runInContext(fuente.slice(desde, hasta), c2, { filename: 'envoltorio' });
  const lector = vm.runInContext('_escLectorZxing()', c2);
  ok(lector && typeof lector.detect === 'function', 'el envoltorio se arma con la librería real');
  const salida = await lector.detect({ videoWidth: 640, videoHeight: 480, width: 640, height: 480, style: {} });
  ok(Array.isArray(salida) && salida.length === 0,
     'una imagen sin código devuelve lista vacía, no una excepción', salida);
  lector.stop();
  ok(true, 'y stop() no explota');
}

console.log('\n8) El código va al inventario');
const INV = [];
run(`
  BarcodeDetector = __BD;
  PRODUCTOS = []; PRODUCTOS_MAP = new Map();
  db = { collection: () => ({ doc: () => ({ set: async () => {} }), where: () => ({ get: async () => ({ empty: true }) }) }) };
  esc = s => String(s == null ? '' : s); fmt = n => '$' + n;
  fmtNum = n => String(n); fmtMoney = n => '$' + n; safeListener = (p, c) => c();
  document.querySelector = () => null;
  searchMatch = () => true; openSheet = () => {}; closeSheet = () => {};
  renderInventario = () => {}; _initInvScanInput = () => {};
  openProductoForm = (id, precod) => __INV.push([id, precod]);
`.replace('__INV', '__INV'), ctx.__INV = INV);
vm.runInContext(fs.readFileSync(DIR + 'inventario.js', 'utf8'), ctx, { filename: 'inventario.js' });
run(`openProductoForm = (id, precod) => __INV.push([id, precod]); PRODUCTOS_MAP = new Map([['7790895000997', { id: 'p1', nombre: 'Vidrio templado' }]]);`);

const pEsc = get(`escanearInvCam()`);
for (let i=0;i<5 && typeof TICK!=="function";i++) await new Promise(r=>setImmediate(r));
LEIDOS = ['7790895000997'];
await TICK();
await pEsc;
ok(JSON.stringify(INV[0]) === JSON.stringify(['p1', undefined]),
   'código conocido: abre el producto que ya existe (para sumarle stock)', INV[0]);

INV.length = 0;
const pEsc2 = get(`escanearInvCam()`);
for (let i=0;i<5 && typeof TICK!=="function";i++) await new Promise(r=>setImmediate(r));
LEIDOS = ['7799999999999'];
await TICK();
await pEsc2;
ok(INV[0] && INV[0][0] === null && INV[0][1] === '7799999999999',
   'código nuevo: abre el alta con el código ya puesto', INV[0]);

console.log('\n9) El botón de cámara se ve siempre');
// Antes se escondía cuando el navegador no podía leer códigos, y el resultado
// era peor: no aparecía y no había forma de saber por qué.
els['inv-scan-cam'].classList.add('hidden');
await get('_invCamBtn()');
ok(!els['inv-scan-cam'].classList.contains('hidden'), 'con soporte, aparece');
run('BarcodeDetector = undefined');
els['inv-scan-cam'].classList.add('hidden');
await get('_invCamBtn()');
ok(!els['inv-scan-cam'].classList.contains('hidden'),
   'y sin soporte también: el motivo aparece al tocarlo');
run('BarcodeDetector = __BD');

console.log('\n10) Puesto en la caja, y sin gastar cupo');
const html = fs.readFileSync(DIR + 'caja.html', 'utf8');
const src = fs.readFileSync(DIR + 'escaner.js', 'utf8');
ok(/id="esc-modal"/.test(html) && /id="esc-video"/.test(html), 'el lector está en caja.html');
ok(/onclick="escanearInvCam\(\)"/.test(html), 'y el botón que lo abre');
ok(html.indexOf('escaner.js') < html.indexOf('inventario.js'), 'escaner.js se carga antes que inventario.js');
ok(/playsinline/.test(html) && /playsinline/.test(src), 'video en línea (sin esto iPhone lo abre a pantalla completa)');
ok(!/collection\(|firebase/.test(src), 'no toca Firebase: leer un código no gasta cupo');
ok(!/cdn|unpkg|jsdelivr|https:\/\//.test(src.replace(/\/\/.*/g, '')), 'y no baja ninguna librería de internet');
// El lector de respaldo vive en el repo: no se pide a un CDN (que puede caerse
// o bloquearse) y queda en el caché de la app.
const zx = fs.statSync(DIR + 'vendor/zxing.min.js');
ok(zx.size > 200000 && zx.size < 600000, 'vendor/zxing.min.js está en la app', zx.size);
ok(!/zxing/.test(html), 'y NO se carga de arranque: solo cuando el navegador no tiene lector propio');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
