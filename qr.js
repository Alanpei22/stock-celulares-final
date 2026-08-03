// ══════════════════════════════════════════════════════════════
//  qr.js — Generador de códigos QR, sin librerías ni internet
// ══════════════════════════════════════════════════════════════
//  Antes el QR del ticket era una imagen que se bajaba de un servidor ajeno
//  (api.qrserver.com). Si el local se quedaba sin internet o ese servicio se
//  caía, el ticket salía SIN QR y no te enterabas hasta que el cliente
//  intentaba escanearlo.
//
//  Esto lo genera acá adentro. Pensado para impresión térmica:
//    · blanco y negro puro, sin grises ni degradados
//    · zona de silencio (margen blanco) de 4 módulos, como manda la norma
//    · corrección de errores nivel M (recupera ~15% del código)
//    · salida en SVG, que imprime nítido a cualquier tamaño
//
//  Modo byte (UTF-8), versiones 1 a 10 (hasta ~200 caracteres con nivel M),
//  de sobra para una URL de seguimiento.
// ══════════════════════════════════════════════════════════════
'use strict';

// ── Aritmética en GF(256) para Reed-Solomon ──
const _QR_EXP = new Uint8Array(512);
const _QR_LOG = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    _QR_EXP[i] = x;
    _QR_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;          // polinomio primitivo del QR
  }
  for (let i = 255; i < 512; i++) _QR_EXP[i] = _QR_EXP[i - 255];
})();

function _qrMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return _QR_EXP[_QR_LOG[a] + _QR_LOG[b]];
}

// Polinomio generador de grado `grado`
function _qrGenPoly(grado) {
  let poly = [1];
  for (let i = 0; i < grado; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= _qrMul(poly[j], 1);
      next[j + 1] ^= _qrMul(poly[j], _QR_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// Codewords de corrección de errores para un bloque de datos
function _qrECC(datos, cantEC) {
  const gen = _qrGenPoly(cantEC);
  const res = new Array(datos.length + cantEC).fill(0);
  for (let i = 0; i < datos.length; i++) res[i] = datos[i];
  for (let i = 0; i < datos.length; i++) {
    const factor = res[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) res[i + j] ^= _qrMul(gen[j], factor);
  }
  return res.slice(datos.length);
}

// ── Tablas del nivel M (el que usamos), versiones 1..10 ──
// [ total de codewords de datos, codewords EC por bloque, bloques grupo1, bloques grupo2 ]
const _QR_M = {
  1:  [16,  10, 1, 0],
  2:  [28,  16, 1, 0],
  3:  [44,  26, 1, 0],
  4:  [64,  18, 2, 0],
  5:  [86,  24, 2, 0],
  6:  [108, 16, 4, 0],
  7:  [124, 18, 4, 0],
  8:  [154, 22, 2, 2],
  9:  [182, 22, 3, 2],
  10: [216, 26, 4, 1],
};
// Posiciones de los patrones de alineación por versión
const _QR_ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function _qrSize(v) { return v * 4 + 17; }

// ── Datos → codewords ──
function _qrCodewords(texto, version) {
  const bytes = new TextEncoder().encode(texto);
  const [capacidad] = _QR_M[version];
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };

  push(0b0100, 4);                                   // modo byte
  push(bytes.length, version < 10 ? 8 : 16);         // longitud
  bytes.forEach(b => push(b, 8));

  const maxBits = capacidad * 8;
  if (bits.length > maxBits) return null;             // no entra en esta versión

  push(0, Math.min(4, maxBits - bits.length));        // terminador
  while (bits.length % 8) bits.push(0);               // completar el byte

  const cw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    cw.push(b);
  }
  // Relleno alternado, como manda la norma
  const RELLENO = [0xEC, 0x11];
  let k = 0;
  while (cw.length < capacidad) cw.push(RELLENO[k++ % 2]);
  return cw;
}

// Intercalado de bloques de datos y de corrección
function _qrEntrelazar(cw, version) {
  const [capacidad, ecPorBloque, g1, g2] = _QR_M[version];
  const totalBloques = g1 + g2;
  const base = Math.floor(capacidad / totalBloques);
  const bloques = [];
  let pos = 0;
  for (let i = 0; i < totalBloques; i++) {
    const largo = i < g1 ? base : base + 1;
    bloques.push(cw.slice(pos, pos + largo));
    pos += largo;
  }
  const ecs = bloques.map(b => _qrECC(b, ecPorBloque));

  const salida = [];
  const maxLargo = Math.max(...bloques.map(b => b.length));
  for (let i = 0; i < maxLargo; i++) {
    for (const b of bloques) if (i < b.length) salida.push(b[i]);
  }
  for (let i = 0; i < ecPorBloque; i++) {
    for (const e of ecs) salida.push(e[i]);
  }
  return salida;
}

// ── Matriz ──
function _qrMatrizVacia(version) {
  const n = _qrSize(version);
  const m = [], reservado = [];
  for (let i = 0; i < n; i++) {
    m.push(new Array(n).fill(0));
    reservado.push(new Array(n).fill(false));
  }

  const finder = (fr, fc) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = fr + r, cc = fc + c;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const borde = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                      (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const centro = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        m[rr][cc] = (borde || centro) ? 1 : 0;
        reservado[rr][cc] = true;
      }
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);

  // Patrones de tiempo
  for (let i = 8; i < n - 8; i++) {
    m[6][i] = i % 2 === 0 ? 1 : 0; reservado[6][i] = true;
    m[i][6] = i % 2 === 0 ? 1 : 0; reservado[i][6] = true;
  }

  // Patrones de alineación
  const ali = _QR_ALIGN[version];
  for (const r of ali) {
    for (const c of ali) {
      if (reservado[r][c]) continue;   // no pisar los finders
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const borde = Math.abs(dr) === 2 || Math.abs(dc) === 2;
          const centro = dr === 0 && dc === 0;
          m[r + dr][c + dc] = (borde || centro) ? 1 : 0;
          reservado[r + dr][c + dc] = true;
        }
      }
    }
  }

  // Módulo oscuro fijo + reserva de la info de formato
  m[n - 8][8] = 1; reservado[n - 8][8] = true;
  for (let i = 0; i <= 8; i++) {
    if (!reservado[8][i]) { reservado[8][i] = true; }
    if (!reservado[i][8]) { reservado[i][8] = true; }
  }
  for (let i = 0; i < 8; i++) {
    reservado[8][n - 1 - i] = true;
    reservado[n - 1 - i][8] = true;
  }
  // Info de versión (v7+)
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        reservado[i][n - 11 + j] = true;
        reservado[n - 11 + j][i] = true;
      }
    }
  }
  return { m, reservado, n };
}

// Recorrido en zigzag de abajo a la derecha hacia arriba
function _qrColocarDatos(m, reservado, n, cw) {
  const bits = [];
  cw.forEach(b => { for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1); });
  let idx = 0, subiendo = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;                     // la columna de tiempo no cuenta
    for (let i = 0; i < n; i++) {
      const fila = subiendo ? n - 1 - i : i;
      for (let d = 0; d < 2; d++) {
        const c = col - d;
        if (reservado[fila][c]) continue;
        m[fila][c] = idx < bits.length ? bits[idx] : 0;
        idx++;
      }
    }
    subiendo = !subiendo;
  }
}

const _QR_MASCARAS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// Info de formato: nivel M (00) + máscara, con BCH(15,5) y XOR fijo
function _qrFormato(mascara) {
  const datos = (0b00 << 3) | mascara;
  let v = datos << 10;
  for (let i = 4; i >= 0; i--) {
    if ((v >> (i + 10)) & 1) v ^= 0b10100110111 << i;
  }
  return ((datos << 10) | v) ^ 0b101010000010010;
}

// Info de versión (v7+): BCH(18,6)
function _qrInfoVersion(version) {
  let v = version << 12;
  for (let i = 5; i >= 0; i--) {
    if ((v >> (i + 12)) & 1) v ^= 0b1111100100 << i;
  }
  return (version << 12) | v;
}

function _qrPonerFormato(m, n, mascara) {
  const f = _qrFormato(mascara);
  const bit = i => (f >> i) & 1;
  // Copia 1 (alrededor del finder superior izquierdo)
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);        // col 8, filas 0..5
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  m[8][7] = bit(8);
  for (let i = 9; i <= 14; i++) m[8][14 - i] = bit(i);  // fila 8, cols 5..0
  // Copia 2 (repetida abajo y a la derecha, por si se daña una esquina)
  for (let i = 0; i <= 7; i++)  m[8][n - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i++) m[n - 15 + i][8] = bit(i);
}

function _qrPonerVersion(m, n, version) {
  if (version < 7) return;
  const info = _qrInfoVersion(version);
  for (let i = 0; i < 18; i++) {
    const bit = (info >> i) & 1;
    const r = Math.floor(i / 3), c = i % 3;
    m[r][n - 11 + c] = bit;
    m[n - 11 + c][r] = bit;
  }
}

// Penalizaciones de la norma, para elegir la máscara que mejor lee
function _qrPenalizacion(m, n) {
  let p = 0;
  // Regla 1: corridas de 5 o más iguales
  for (let i = 0; i < n; i++) {
    for (const fila of [true, false]) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        const a = fila ? m[i][j] : m[j][i];
        const b = fila ? m[i][j - 1] : m[j - 1][i];
        if (a === b) { run++; }
        else { if (run >= 5) p += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) p += 3 + (run - 5);
    }
  }
  // Regla 2: bloques 2x2
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
  }
  // Regla 3: patrón parecido al finder
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const coincide = (get, i) => {
    let ok1 = true, ok2 = true;
    for (let k = 0; k < 11; k++) {
      const v = get(i + k);
      if (v !== P1[k]) ok1 = false;
      if (v !== P2[k]) ok2 = false;
    }
    return ok1 || ok2;
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j + 11 <= n; j++) {
      if (coincide(k => m[i][k], j)) p += 40;
      if (coincide(k => m[k][i], j)) p += 40;
    }
  }
  // Regla 4: balance de oscuros
  let oscuros = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) oscuros += m[r][c];
  const pct = (oscuros * 100) / (n * n);
  p += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return p;
}

// ── API ──

// Devuelve la matriz de módulos (true = negro) para un texto.
function qrMatriz(texto) {
  let version = 0, cw = null;
  for (let v = 1; v <= 10; v++) {
    const c = _qrCodewords(texto, v);
    if (c) { version = v; cw = c; break; }
  }
  if (!version) throw new Error('QR: el texto es demasiado largo');

  const entrelazado = _qrEntrelazar(cw, version);
  const { m: base, reservado, n } = _qrMatrizVacia(version);
  _qrColocarDatos(base, reservado, n, entrelazado);

  let mejor = null, mejorPen = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = base.map(f => f.slice());
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!reservado[r][c] && _QR_MASCARAS[mask](r, c)) m[r][c] ^= 1;
      }
    }
    _qrPonerFormato(m, n, mask);
    _qrPonerVersion(m, n, version);
    const pen = _qrPenalizacion(m, n);
    if (pen < mejorPen) { mejorPen = pen; mejor = m; }
  }
  return mejor.map(fila => fila.map(v => v === 1));
}

// SVG en blanco y negro puro, con margen blanco (quiet zone) de 4 módulos.
// `mm` = lado del cuadrado impreso. 25 mm es el mínimo legible en térmica.
function qrSvg(texto, mm = 25, quiet = 4) {
  const mat = qrMatriz(texto);
  const n = mat.length;
  const total = n + quiet * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mat[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `width="${mm}mm" height="${mm}mm" shape-rendering="crispEdges" ` +
    `style="display:block;background:#fff">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`;
}

// Igual pero como data URI, para usar en <img src="...">
function qrDataUri(texto, mm = 25, quiet = 4) {
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(qrSvg(texto, mm, quiet))));
}

if (typeof module !== 'undefined') module.exports = { qrMatriz, qrSvg, _qrECC, _qrFormato, _qrCodewords, _qrEntrelazar };
