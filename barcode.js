// ══════════════════════════════════════════════════════════════
//  barcode.js — código de barras Code 128
//  ─────────────────────────────────────────────────────────────
//  Sin librerías ni internet, como qr.js. Devuelve un SVG, así que la etiqueta
//  imprime nítida en cualquier impresora (un PNG escalado sale borroso y el
//  lector no lo agarra).
//
//  ── Por qué Code 128 ────────────────────────────────────────
//  Es el único de la familia que sirve para las tres cosas que etiquetamos:
//   · IMEI de 15 dígitos — EAN-13 no entra, es de 13 y con verificador propio;
//   · códigos de artículo con letras (TP-0012, ACC-45);
//   · números de orden de reparación, cortitos.
//  Y lo leen los dos lectores que ya usa la app: la cámara (ver
//  ESCANER_FORMATOS en escaner.js) y los lectores de mano.
//
//  ── Modos B y C ─────────────────────────────────────────────
//  El modo C mete DOS dígitos en cada símbolo: un IMEI en modo B ocupa ~200
//  módulos y en C unos 120. En una etiqueta de 63mm eso es la diferencia entre
//  0,2mm y 0,33mm por barra — abajo de 0,25mm los lectores empiezan a fallar.
//  Por eso arranca en C cuando hay dígitos de sobra y cambia a B para la cola
//  impar (el IMEI tiene 15, así que siempre sobra uno).
//
//  La tabla de patrones se verifica DECODIFICANDO lo que dibuja con la ZXing
//  de verdad (tests/test-etiquetas-barcode.js). Escribirla de memoria y
//  confiar no alcanzaba.
// ══════════════════════════════════════════════════════════════
'use strict';

// Ancho de las 6 barras/espacios de cada símbolo (el 106, el de fin, tiene 7).
const _C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];
const _C128_B = 100, _C128_C = 99, _C128_START_B = 104, _C128_START_C = 105, _C128_STOP = 106;

// Lo que se puede imprimir: ASCII 32..126. El resto se saca (una tilde en el
// nombre de un producto no puede romper la etiqueta entera).
function code128Limpio(txt) {
  return String(txt == null ? '' : txt).replace(/[^\x20-\x7E]/g, '').trim();
}

// El texto convertido en la lista de símbolos, con su dígito verificador.
function code128Simbolos(txt) {
  const s = code128Limpio(txt);
  if (!s) return [];
  const esDig = c => c >= '0' && c <= '9';
  const digitosDesde = j => { let n = 0; while (j + n < s.length && esDig(s[j + n])) n++; return n; };

  const codes = [];
  let i = 0;
  // Arrancar en C conviene con 4 dígitos o más (o si es todo dígitos y par).
  let modoC = digitosDesde(0) >= 4 || (digitosDesde(0) === s.length && s.length % 2 === 0);
  codes.push(modoC ? _C128_START_C : _C128_START_B);

  while (i < s.length) {
    const n = digitosDesde(i);
    if (modoC) {
      if (n >= 2) { codes.push(Number(s.substr(i, 2))); i += 2; }
      else { codes.push(_C128_B); modoC = false; }   // cola impar o una letra
    } else {
      // Volver a C solo si hay una tirada larga: cambiar de modo cuesta un símbolo.
      if (n >= 6 || (n >= 4 && i + n === s.length && n % 2 === 0)) { codes.push(_C128_C); modoC = true; }
      else { codes.push(s.charCodeAt(i) - 32); i++; }
    }
  }

  // Verificador: el de arranque pesa 1 y cada uno de los que siguen, su posición.
  let suma = codes[0];
  for (let k = 1; k < codes.length; k++) suma += codes[k] * k;
  codes.push(suma % 103);
  codes.push(_C128_STOP);
  return codes;
}

// Los módulos, como string de 1 (barra) y 0 (espacio). Cada símbolo arranca
// con barra y alterna.
function code128Bits(txt) {
  let bits = '';
  for (const c of code128Simbolos(txt)) {
    const pat = _C128[c];
    if (!pat) continue;
    for (let k = 0; k < pat.length; k++) bits += (k % 2 ? '0' : '1').repeat(Number(pat[k]));
  }
  return bits;
}

// El SVG de la etiqueta.
//   modulo — ancho de la barra más fina, en mm. Menos de 0.25 empieza a fallar.
//   alto   — alto de las barras, en mm.
//   leyenda— el texto abajo, para poder teclearlo cuando el lector no quiere.
function code128Svg(txt, opts) {
  const o = opts || {};
  const bits = code128Bits(txt);
  if (!bits) return '';
  const modulo = Number(o.modulo) || 0.33;
  const alto   = Number(o.alto) || 9;
  const quiet  = 10;                                  // zona muda obligatoria
  const leyenda = o.leyenda === false ? '' : code128Limpio(txt);
  const th     = leyenda ? 2.6 : 0;                   // lugar para el texto
  const w      = (bits.length + quiet * 2) * modulo;
  const h      = alto + th;

  let rects = '';
  let x = quiet * modulo, i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      let n = 1;
      while (bits[i + n] === '1') n++;               // barras pegadas, un solo rect
      rects += `<rect x="${+(x).toFixed(3)}" y="0" width="${+(n * modulo).toFixed(3)}" height="${alto}"/>`;
      x += n * modulo; i += n;
    } else { x += modulo; i++; }
  }
  const txtSvg = leyenda
    ? `<text x="${+(w / 2).toFixed(2)}" y="${+(h - 0.3).toFixed(2)}" text-anchor="middle"
         font-family="monospace" font-size="2.2" letter-spacing="0.15">${
         leyenda.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${+w.toFixed(2)} ${+h.toFixed(2)}"
    width="${+w.toFixed(2)}mm" height="${+h.toFixed(2)}mm" shape-rendering="crispEdges">
    <rect width="${+w.toFixed(2)}" height="${+h.toFixed(2)}" fill="#fff"/>
    <g fill="#000">${rects}</g>${txtSvg}</svg>`;
}
