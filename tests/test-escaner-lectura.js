// ¿El lector de respaldo LEE un código de barras de verdad?
//
// Esta prueba nació de un bug real: el escáner abría la cámara, se veía todo
// bien y no leía NADA. La causa era un "hint" de ZXing (TRY_HARDER) que suena a
// que ayuda y en esta versión rompe el lector: medido en un navegador de verdad
// sobre un <video>, 0 de 6 lecturas con el hint y 20 de 20 sin él. Las pruebas
// de test-escaner.js no lo agarraban porque usan una librería de mentira: esta
// usa la de verdad.
//
// Acá se dibuja un EAN-13 de verdad (píxeles, con su tabla de codificación) y
// se lo pasa a la ZXing REAL de vendor/ a través del mismo envoltorio que usa
// la app.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── Un EAN-13 dibujado a mano ────────────────────────────────
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function verificador(doce) {
  let s = 0;
  doce.split('').forEach((c, i) => { s += Number(c) * (i % 2 ? 3 : 1); });
  return String((10 - (s % 10)) % 10);
}

function barras(cod) {
  const d = cod.split('').map(Number);
  const p = PAR[d[0]];
  let b = '101';
  for (let i = 1; i <= 6; i++) b += (p[i - 1] === 'L' ? L : G)[d[i]];
  b += '01010';
  for (let i = 7; i <= 12; i++) b += R[d[i]];
  return b + '101';
}

// Imagen en blanco con las barras negras al medio, como la vería la cámara
function imagen(cod, mod = 4, alto = 180, quiet = 12) {
  const b = barras(cod);
  const w = (b.length + quiet * 2) * mod, h = alto;
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let x = 0; x < w; x++) {
    const i = Math.floor(x / mod) - quiet;
    if (i < 0 || i >= b.length || b[i] !== '1') continue;
    for (let y = 0; y < h; y++) { const o = (y * w + x) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
  }
  return { px, w, h };
}

const CODIGO = '779089500099' + verificador('779089500099');
const IMG = imagen(CODIGO);

// ── Navegador de mentira, pero librería y píxeles de verdad ──
function armarLector(fuenteEnvoltorio) {
  const lienzo = {
    width: IMG.w, height: IMG.h, style: {},
    getContext: () => ({ drawImage() {}, getImageData: () => ({ data: IMG.px, width: IMG.w, height: IMG.h }) }),
  };
  const c = {
    console, setTimeout, clearTimeout, Math, Date, Map, Set,
    Uint8ClampedArray, Uint8Array, Int32Array, Float32Array,
    document: { createElement: t => (t === 'canvas' ? lienzo : { style: {} }), body: { appendChild() {} } },
    navigator: { userAgent: 'node' },
  };
  c.HTMLVideoElement = class {};
  c.HTMLImageElement = class {};
  c.self = c; c.globalThis = c; c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(DIR + 'vendor/zxing.min.js', 'utf8'), c, { filename: 'zxing.min.js' });
  vm.runInContext(fuenteEnvoltorio, c, { filename: 'envoltorio' });
  return { lector: vm.runInContext('_escLectorZxing()', c), ctx: c };
}

function envoltorioDeLaApp() {
  const src = fs.readFileSync(DIR + 'escaner.js', 'utf8');
  const desde = src.indexOf('function _escLectorZxing()');
  const hasta = src.indexOf('\n}\n', desde) + 3;
  return src.slice(desde, hasta);
}

(async () => {

console.log('\n1) Lee un EAN-13 de verdad, con la ZXing de verdad');
const fuente = envoltorioDeLaApp();
const { lector, ctx } = armarLector(fuente);
const video = Object.assign(new ctx.HTMLVideoElement(), {
  videoWidth: IMG.w, videoHeight: IMG.h, width: IMG.w, height: IMG.h, style: {},
});
const r = await lector.detect(video);
ok(r.length === 1 && r[0].rawValue === CODIGO, 'lee ' + CODIGO, r);

console.log('\n2) Y lo lee SIEMPRE, no una de cada dos');
// Esta versión de ZXing falla uno sí y uno no sobre la MISMA imagen. Por eso el
// envoltorio intenta dos veces por cuadro. Medido en el navegador: 10 de 20 con
// un intento, 20 de 20 con dos.
let leidos = 0;
for (let i = 0; i < 10; i++) {
  const x = await lector.detect(video);
  if (x.length && x[0].rawValue === CODIGO) leidos++;
}
ok(leidos === 10, 'diez cuadros seguidos, diez lecturas', leidos + '/10');
lector.stop();

console.log('\n3) El hint que rompía todo no volvió');
const src = fs.readFileSync(DIR + 'escaner.js', 'utf8');
ok(!/TRY_HARDER,\s*true/.test(src), 'TRY_HARDER sigue afuera (medido en navegador: con él, 0 lecturas)');
ok(/POSSIBLE_FORMATS/.test(src), 'y los formatos siguen acotados a los que se usan');

// (Ojo: el efecto de TRY_HARDER NO se reproduce en este harness, porque el
// lienzo es de mentira y la rotación de ese camino no llega a ocurrir. Se midió
// en un navegador de verdad, con el mismo EAN-13 sobre un <video>: 0 de 6 con
// el hint, 20 de 20 sin él. Acá solo se vigila que no vuelva.)

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
