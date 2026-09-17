// Leer el IMEI con la cámara, en equipos nuevos y usados.
//
// Lo delicado: la etiqueta de la caja tiene VARIOS códigos de barras pegados
// (IMEI 1, IMEI 2, número de serie, y el EAN del producto). Si el lector carga
// el primero que ve, termina guardando el código del cartón como IMEI, y eso
// se arrastra a la boleta, a la garantía y al día que haya que consultarlo.
//
// Por eso solo se acepta un número que cierre por Luhn.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const els = {};
const mk = id => els[id] = {
  id, value: '', textContent: '', innerHTML: '', srcObject: null, videoWidth: 640, dataset: {}, style: {},
  classList: { _s: new Set(['hidden']), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  eventos: [], dispatchEvent(e) { this.eventos.push(e.type); return true; },
  addEventListener() {}, setAttribute() {}, focus() {}, play: async () => {}, pause() {},
  // Insertar en el documento = queda accesible por id (como en el navegador)
  insertAdjacentElement(_, el) { (this.hermanos = this.hermanos || []).push(el); if (el.id) els[el.id] = el; },
};
['esc-modal', 'esc-video', 'esc-titulo', 'esc-estado', 'esc-luz', 'fi-imei', 'rep-fi-imei'].forEach(mk);

let LEIDOS = [], TICK = null, TRACKS = [];
const TOASTS = [];
const creados = [];

const ctx = {
  console, Date, Math, JSON, Promise, String, Number,
  setInterval: f => { TICK = f; return 1; }, clearInterval: () => { TICK = null; },
  setTimeout: f => { f(); return 0; }, clearTimeout,
  document: {
    hidden: false,
    getElementById: id => els[id] || null,
    createElement: () => { const e = mk('btn-' + creados.length); creados.push(e); return e; },
    addEventListener() {}, body: { style: {} },
  },
  navigator: {
    vibrate: () => true,
    mediaDevices: { getUserMedia: async () => { const t = { stop() { this.activo = false; }, activo: true, getCapabilities: () => ({}) }; TRACKS.push(t); return { getTracks: () => [t], getVideoTracks: () => [t] }; } },
  },
  window: { isSecureContext: true },
  Event: class { constructor(t) { this.type = t; } },
  toast: (m, t) => TOASTS.push([t, m]),
};
ctx.globalThis = ctx; ctx.self = ctx; ctx.window.AudioContext = null;
ctx.BarcodeDetector = class {
  static async getSupportedFormats() { return ['ean_13', 'code_128']; }
  async detect() { return LEIDOS.map(rawValue => ({ rawValue })); }
};
vm.createContext(ctx);
// utils.js (la parte sin firebase) + escaner.js
const u = fs.readFileSync(DIR + 'utils.js', 'utf8');
// (las llamadas a /api quedan afuera: este harness no las necesita)
vm.runInContext(u.slice(0, u.indexOf('//  LLAMADAS A NUESTRAS FUNCIONES DE /api')), ctx, { filename: 'utils.js' });
vm.runInContext(u.slice(u.indexOf('function imeiDigitos')), ctx, { filename: 'utils.js (imei)' });
vm.runInContext(fs.readFileSync(DIR + 'escaner.js', 'utf8'), ctx, { filename: 'escaner.js' });
const get = e => vm.runInContext(e, ctx);
const run = c => vm.runInContext(c, ctx);

// IMEIs de prueba, con el verificador calculado de verdad
const IMEI = get(`(() => { const base = '35693803564380'; return base + imeiVerificador(base); })()`);
const IMEI2 = get(`(() => { const base = '35693803564381'; return base + imeiVerificador(base); })()`);

(async () => {

console.log('\n1) Sacar el IMEI de lo que diga la etiqueta');
ok(get(`imeiDesdeCodigo('${IMEI}')`) === IMEI, 'el número pelado', get(`imeiDesdeCodigo('${IMEI}')`));
ok(get(`imeiDesdeCodigo('IMEI1: ${IMEI}')`) === IMEI, 'con el rótulo adelante');
ok(get(`imeiDesdeCodigo('${IMEI.slice(0, 8)} ${IMEI.slice(8)}')`) === IMEI, 'partido con un espacio en el medio');
ok(get(`imeiDesdeCodigo('${IMEI.slice(0, 14)}')`) === IMEI,
   'sin el dígito verificador: se calcula (muchas etiquetas lo omiten)', get(`imeiDesdeCodigo('${IMEI.slice(0, 14)}')`));

console.log('\n2) Y NO tomar cualquier número');
ok(get(`imeiDesdeCodigo('7790895000997')`) === null, 'el código de barras del producto (EAN-13) no es un IMEI');
ok(get(`imeiDesdeCodigo('SN: R58M12ABCDE')`) === null, 'el número de serie tampoco');
ok(get(`imeiDesdeCodigo('123456789012345')`) === null, '15 dígitos que no cierran por Luhn: no');
ok(get(`imeiDesdeCodigo('')`) === null, 'vacío');

console.log('\n3) El lector no carga el código equivocado');
let abrio = await get(`escanearImei('fi-imei')`);
ok(typeof TICK === 'function', 'abre la cámara');
LEIDOS = ['7790895000997'];          // el EAN del cartón
await TICK();
ok(els['fi-imei'].value === '', 'el código del producto NO entra al campo', els['fi-imei'].value);
ok(/no es el IMEI/i.test(els['esc-estado'].textContent), 'y avisa qué está leyendo', els['esc-estado'].textContent);
ok(typeof TICK === 'function', 'sigue buscando en vez de cerrarse');

LEIDOS = [IMEI];
await TICK();
ok(els['fi-imei'].value === IMEI, 'el IMEI sí entra', els['fi-imei'].value);
ok(els['fi-imei'].eventos.includes('input'), 'y dispara el "input" para que se revalide el campo', els['fi-imei'].eventos);
ok(TICK === null && !TRACKS.some(t => t.activo), 'con el IMEI cargado, la cámara se apaga');
ok(TOASTS.some(t => t[1].includes(IMEI)), 'confirma con el número leído', TOASTS);

console.log('\n4) El botón se pone solo en cada campo');
run(`imeiBotonCam('rep-fi-imei')`);
const btn = (els['rep-fi-imei'].hermanos || [])[0];
ok(!!btn, 'aparece al lado del campo de la reparación');
ok(btn && btn.id === 'rep-fi-imei-cam', 'con su id', btn && btn.id);
run(`imeiBotonCam('rep-fi-imei')`);
ok((els['rep-fi-imei'].hermanos || []).length === 1, 'y no se duplica si se llama dos veces');

console.log('\n5) Enganchado en los cuatro campos que hay');
const app = fs.readFileSync(DIR + 'app.js', 'utf8');
const caja = fs.readFileSync(DIR + 'caja.js', 'utf8');
ok(/imeiBotonCam\('fi-imei'\)/.test(app), 'alta de equipo (stock)');
ok(/imeiBotonCam\('rep-fi-imei'\)/.test(app), 'ingreso de reparación');
ok(/imeiBotonCam\('ve-imei'\)/.test(caja) && /imeiBotonCam\('ve-imei2'\)/.test(caja), 'los dos IMEI de la venta');

console.log('\n6) El lector está en las dos páginas');
const idx = fs.readFileSync(DIR + 'index.html', 'utf8');
const cajaH = fs.readFileSync(DIR + 'caja.html', 'utf8');
ok(/id="esc-video"/.test(idx) && /src="escaner\.js"/.test(idx), 'index.html');
ok(/id="esc-video"/.test(cajaH) && /src="escaner\.js"/.test(cajaH), 'caja.html');
ok(idx.indexOf('escaner.js') < idx.indexOf('src="app.js"') || /defer/.test(idx), 'cargado antes de usarse');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
