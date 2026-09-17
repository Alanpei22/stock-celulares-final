// Saber QUÉ EQUIPO es a partir del IMEI escaneado.
//
// Los primeros 8 dígitos (el TAC) identifican el modelo. Se usan dos fuentes:
// primero el historial del local (así respeta cómo escribís vos los modelos) y
// después la tabla de vendor/tac.json.
//
// Lo que más se cuida: que NO pise lo que ya escribiste, y que no se baje la
// tabla al pedo (son 440 KB: si el IMEI no sirve o el modelo ya lo conocés por
// tu historial, no se toca).
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const els = {};
const mk = id => els[id] = { id, value: '', textContent: '', eventos: [],
  dispatchEvent(e) { this.eventos.push(e.type); return true; }, focus() {}, addEventListener() {},
  classList: { _s: new Set(), add() {}, remove() {}, toggle() {}, contains: () => false },
  insertAdjacentElement(_, el) { if (el.id) els[el.id] = el; } };
['esc-modal', 'esc-video', 'esc-titulo', 'esc-estado', 'esc-luz',
 'fi-imei', 'fi-marca', 'fi-modelo', 'rep-fi-imei', 'rep-fi-marca', 'rep-fi-modelo'].forEach(mk);

let BAJADAS = 0;
const TOASTS = [];
const TABLA = JSON.parse(fs.readFileSync(DIR + 'vendor/tac.json', 'utf8'));

const ctx = {
  console, Date, Math, JSON, Promise, String, Number, Array, Object,
  setInterval: () => 1, clearInterval: () => {}, setTimeout: f => { f(); return 0; }, clearTimeout,
  document: { hidden: false, getElementById: id => els[id] || null, createElement: () => mk('tmp'), addEventListener() {}, body: { style: {} } },
  navigator: { vibrate: () => true, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getVideoTracks: () => [{ stop() {}, getCapabilities: () => ({}) }] }) } },
  window: { isSecureContext: true },
  Event: class { constructor(t) { this.type = t; } },
  toast: (m, t) => TOASTS.push([t, m]),
  fetch: async url => { BAJADAS++; return { json: async () => TABLA }; },
};
ctx.globalThis = ctx; ctx.self = ctx; ctx.window.AudioContext = null;
vm.createContext(ctx);
const u = fs.readFileSync(DIR + 'utils.js', 'utf8');
vm.runInContext(u.slice(u.indexOf('function imeiDigitos')), ctx, { filename: 'utils.js (imei)' });
vm.runInContext(fs.readFileSync(DIR + 'escaner.js', 'utf8'), ctx, { filename: 'escaner.js' });
const get = e => vm.runInContext(e, ctx);
const run = c => vm.runInContext(c, ctx);

// Un TAC real de la tabla, con su modelo, y un IMEI completo armado sobre él
const TAC_REAL = Object.keys(TABLA.t)[0];
const MODELO_REAL = TABLA.m[TABLA.t[TAC_REAL]];
const imeiCon = tac => {
  const base = (tac + '000000').slice(0, 14);
  return base + get(`imeiVerificador('${base}')`);
};
const IMEI_TABLA = imeiCon(TAC_REAL);

(async () => {

console.log('\n1) El TAC son los primeros 8 dígitos');
ok(get(`tacDe('${IMEI_TABLA}')`) === TAC_REAL, 'los saca del IMEI', get(`tacDe('${IMEI_TABLA}')`));
ok(get(`tacDe('123')`) === '', 'un número corto no tiene TAC');
ok(get(`tacDe('')`) === '', 'vacío tampoco');

console.log('\n2) Primero TU historial, con TU forma de escribirlo');
// Si ya cargaste ese modelo, vale más cómo lo escribís vos ("A54") que como
// figura en la tabla ("GALAXY A54 5G"): es lo que después buscás en la app.
run(`STOCK = [{ imei: '${imeiCon('99887766')}', marca: 'Samsung', modelo: 'A54' }]; REPAIRS = [];`);
BAJADAS = 0;
let m = await get(`modeloPorImei('${imeiCon('99887766')}')`);
ok(m && m.marca === 'Samsung' && m.modelo === 'A54', 'sale del historial', m);
ok(m && m.fuente === 'historial', 'y lo dice');
ok(BAJADAS === 0, 'sin bajar la tabla: el dato ya estaba en el celu', BAJADAS);

console.log('\n3) Si no lo cargaste nunca, la tabla');
BAJADAS = 0;
m = await get(`modeloPorImei('${IMEI_TABLA}')`);
ok(!!m, 'lo encuentra', m);
ok(m && (m.marca + '|' + m.modelo) === MODELO_REAL, 'con el modelo que dice la tabla', [m, MODELO_REAL]);
ok(BAJADAS === 1, 'baja la tabla una sola vez', BAJADAS);
await get(`modeloPorImei('${IMEI_TABLA}')`);
ok(BAJADAS === 1, 'y no la vuelve a bajar en toda la sesión', BAJADAS);

console.log('\n4) Un IMEI desconocido no inventa nada');
m = await get(`modeloPorImei('${imeiCon('00000001')}')`);
ok(m === null, 'TAC que no está en ningún lado: null', m);
run(`_tacTabla = null; _tacCarga = null;`);   // como si recién abriera la app
BAJADAS = 0;
m = await get(`modeloPorImei('123')`);
ok(m === null && BAJADAS === 0, 'y con un número corto ni se molesta en bajar la tabla', BAJADAS);

console.log('\n5) Completa los campos vacíos, NO pisa lo cargado');
run(`_tacTabla = null; _tacCarga = null; STOCK = []; REPAIRS = [];`);
els['fi-marca'].value = ''; els['fi-modelo'].value = '';
await get(`_autocompletarPorImei('${IMEI_TABLA}', { marca: 'fi-marca', modelo: 'fi-modelo' })`);
ok(els['fi-marca'].value === MODELO_REAL.split('|')[0], 'pone la marca', els['fi-marca'].value);
ok(els['fi-modelo'].value === MODELO_REAL.split('|')[1], 'y el modelo', els['fi-modelo'].value);
ok(els['fi-marca'].eventos.includes('input'), 'avisando al formulario (input)', els['fi-marca'].eventos);
ok(TOASTS.some(t => /Corregí si no coincide/.test(t[1])), 'y aclara que es una sugerencia', TOASTS.slice(-1));

els['fi-marca'].value = 'Samsung'; els['fi-modelo'].value = 'A54 EDICIÓN MÍA';
await get(`_autocompletarPorImei('${IMEI_TABLA}', { marca: 'fi-marca', modelo: 'fi-modelo' })`);
ok(els['fi-modelo'].value === 'A54 EDICIÓN MÍA', 'lo que ya estaba escrito no se toca', els['fi-modelo'].value);

console.log('\n6) Enganchado al escaneo de los formularios');
const src = fs.readFileSync(DIR + 'escaner.js', 'utf8');
ok(/'fi-imei':\s*\{\s*marca:\s*'fi-marca',\s*modelo:\s*'fi-modelo'\s*\}/.test(src), 'alta de stock');
ok(/'rep-fi-imei':\s*\{\s*marca:\s*'rep-fi-marca',\s*modelo:\s*'rep-fi-modelo'\s*\}/.test(src), 'ingreso de reparación');
const idx = fs.readFileSync(DIR + 'index.html', 'utf8');
['fi-marca', 'fi-modelo', 'rep-fi-marca', 'rep-fi-modelo'].forEach(id =>
  ok(idx.includes(`id="${id}"`), `el campo ${id} existe en index.html`));

console.log('\n7) La tabla que va en la app');
const st = fs.statSync(DIR + 'vendor/tac.json');
ok(st.size < 4 * 1024 * 1024, 'pesa menos de 4 MB (se sirve comprimida, ~440 KB)', Math.round(st.size / 1024) + ' KB');
ok(Array.isArray(TABLA.m) && TABLA.m.length > 5000, 'trae miles de modelos', TABLA.m.length);
ok(Object.keys(TABLA.t).length > 50000, 'y decenas de miles de códigos', Object.keys(TABLA.t).length);
ok(Object.keys(TABLA.t).every(k => /^\d{8}$/.test(k)) === true, 'todas las claves son TAC de 8 dígitos');
const sw = fs.readFileSync(DIR + 'sw.js', 'utf8');
ok(/'js', 'css', 'json'/.test(sw), 'el service worker la cachea: se baja una vez y queda');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
