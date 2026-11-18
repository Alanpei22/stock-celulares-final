// 📷 El lector de la cámara con las etiquetas de los equipos. Alan (18/11):
// "no funciona el lector de código de barras". Probado con su foto (Code 128
// finito con el IMEI): el lector de respaldo (iPhone/PC) no lo encontraba en
// el cuadro entero, y lo lee recortando la franja del medio justo en las
// barras. Con la cámara simulada con su foto: antes 0 lecturas en 12 s,
// ahora lo lee enseguida (también con el código un poco corrido).
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ctx = { console, Math, Number, String, Array, Object, JSON, Float32Array, Uint8ClampedArray,
  document: { getElementById: () => null, addEventListener() {} }, navigator: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(leer('escaner.js'), ctx, { filename: 'escaner.js' });

console.log('\n1) Las franjas del medio');
const rs = ctx.escRecortes(1080, 1440);
ok(rs.length === 3 && rs.every(r => r.x === 43 && r.w === 994 && Math.abs((r.y + r.h / 2) - 720) <= 1), 'tres franjas centradas, del ancho del recuadro', rs);

console.log('\n2) Dónde están las barras');
// Lienzo de 1000x100: papel blanco, un celular rojo oscuro a la izquierda, y
// barras de 300 a 700
const W = 1000, H = 100, d = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  let v = 245;
  if (x < 120) v = 70;                                         // el celu
  else if (x >= 300 && x < 700) v = (Math.floor((x - 300) / 4) % 3 === 0) ? 20 : 245;   // barras
  d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
}
const b = ctx.escBordesBarras(d, W, H);
ok(b && Math.abs(b[0] - 300) < 30 && Math.abs(b[1] - 700) < 30, 'encuentra el bloque de barras (no el borde del celular)', b);
const liso = new Uint8ClampedArray(W * H * 4).fill(240);
ok(ctx.escBordesBarras(liso, W, H) === null, 'sin barras: nada');

console.log('\n3) Enganchado');
const src = leer('escaner.js');
ok(/_escLector = nativo \? _escLectorNativo\(\) : _escLectorZxing\(\);/.test(src), 'los dos motores (Android y respaldo) prueban las franjas');
ok(/escBordesBarras\(g\.getImageData/.test(src) && /for \(const k of \[0\.01, 0\.005, 0\.02\]\)/.test(src), 'el de respaldo recorta justo en las barras, con poco margen');
ok(/reader\.decode\(video\)/.test(src), 'y sigue probando el cuadro entero (los EAN de las cajas)');
ok(/llene casi todo el ancho del recuadro/.test(src), 'si no lee, dice que el código tiene que llenar el recuadro');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
