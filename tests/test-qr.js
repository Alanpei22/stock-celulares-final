// Verificación del generador de QR propio (qr.js).
// La prueba fuerte es el LECTOR de abajo: desarma la matriz generada
// (lee el formato, saca la máscara, recorre el zigzag al revés, des-entrelaza
// los bloques y decodifica el texto). Si el texto vuelve igual, la colocación,
// el enmascarado y el entrelazado están bien.
const path = require('path').join(__dirname, '..', 'qr.js');
const { qrMatriz, qrSvg, _qrECC, _qrFormato, _qrCodewords, _qrEntrelazar } = require(path);

let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── 1. Reed-Solomon contra el ejemplo clásico de la norma ──
// "HELLO WORLD" en versión 1-Q: 16 codewords de datos → 10 de corrección.
console.log('\n1) Corrección de errores (Reed-Solomon)');
const datosRef = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
const ecEsperado = [196, 35, 39, 119, 235, 215, 231, 226, 93, 23];
const ecCalc = _qrECC(datosRef, 10);
ok(JSON.stringify(ecCalc) === JSON.stringify(ecEsperado),
   'coincide con el vector conocido de la norma', { esperado: ecEsperado, obtenido: ecCalc });

// ── 2. Info de formato (nivel M, máscara 0) ──
console.log('\n2) Info de formato');
ok(_qrFormato(0) === 0b101010000010010, 'nivel M + máscara 0 = 101010000010010', _qrFormato(0).toString(2));
const fmts = [];
for (let i = 0; i < 8; i++) fmts.push(_qrFormato(i));
ok(new Set(fmts).size === 8, 'las 8 máscaras dan formatos distintos', fmts);

// ── 3. Estructura de la matriz ──
console.log('\n3) Estructura');
const m = qrMatriz('https://stock-celulares-final.vercel.app/estado.html?o=7123&k=abcdefghij0123456789');
const n = m.length;
ok(n === 45 || n === 41 || n === 37, 'tamaño de versión válido (' + n + 'x' + n + ')', n);
const finderOk = (r0, c0) => {
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    const borde = r === 0 || r === 6 || c === 0 || c === 6;
    const centro = r >= 2 && r <= 4 && c >= 2 && c <= 4;
    if (m[r0 + r][c0 + c] !== (borde || centro)) return false;
  }
  return true;
};
ok(finderOk(0, 0), 'patrón de posición arriba-izquierda');
ok(finderOk(0, n - 7), 'patrón de posición arriba-derecha');
ok(finderOk(n - 7, 0), 'patrón de posición abajo-izquierda');
let timingOk = true;
for (let i = 8; i < n - 8; i++) {
  if (m[6][i] !== (i % 2 === 0)) timingOk = false;
  if (m[i][6] !== (i % 2 === 0)) timingOk = false;
}
ok(timingOk, 'patrones de tiempo alternados');
ok(m[n - 8][8] === true, 'módulo oscuro fijo');

// ── 4. LECTOR: desarmar la matriz y recuperar el texto ──
console.log('\n4) Lectura de vuelta (el QR se puede decodificar)');
const M_TABLA = { 21:[1,16,10,1,0], 25:[2,28,16,1,0], 29:[3,44,26,1,0], 33:[4,64,18,2,0],
                  37:[5,86,24,2,0], 41:[6,108,16,4,0], 45:[7,124,18,4,0], 49:[8,154,22,2,2],
                  53:[9,182,22,3,2], 57:[10,216,26,4,1] };
const ALIGN = { 1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50] };
const MASCARAS = [
  (r,c)=>(r+c)%2===0, (r)=>r%2===0, (r,c)=>c%3===0, (r,c)=>(r+c)%3===0,
  (r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0, (r,c)=>((r*c)%2)+((r*c)%3)===0,
  (r,c)=>(((r*c)%2)+((r*c)%3))%2===0, (r,c)=>(((r+c)%2)+((r*c)%3))%2===0,
];

function leer(m) {
  const n = m.length;
  const [version, capacidad, ecPorBloque, g1, g2] = M_TABLA[n];

  // a) máscara, leída del bloque de formato de la matriz
  let fmt = 0;
  for (let i = 0; i <= 5; i++) fmt |= (m[i][8] ? 1 : 0) << i;
  fmt |= (m[7][8] ? 1 : 0) << 6;
  fmt |= (m[8][8] ? 1 : 0) << 7;
  fmt |= (m[8][7] ? 1 : 0) << 8;
  for (let i = 9; i <= 14; i++) fmt |= (m[8][14 - i] ? 1 : 0) << i;
  const desXor = fmt ^ 0b101010000010010;
  const nivel = (desXor >> 13) & 0b11;
  const mascara = (desXor >> 10) & 0b111;

  // b) mapa de módulos reservados (idéntico al de la norma)
  const res = [];
  for (let i = 0; i < n; i++) res.push(new Array(n).fill(false));
  const marcar = (r0, c0, alto, ancho) => {
    for (let r = r0; r < r0 + alto; r++) for (let c = c0; c < c0 + ancho; c++)
      if (r >= 0 && c >= 0 && r < n && c < n) res[r][c] = true;
  };
  marcar(0, 0, 9, 9); marcar(0, n - 8, 9, 8); marcar(n - 8, 0, 8, 9);
  for (let i = 0; i < n; i++) { res[6][i] = true; res[i][6] = true; }
  for (const r of ALIGN[version]) for (const c of ALIGN[version]) {
    if (res[r][c] && ((r < 9 && c < 9) || (r < 9 && c > n - 10) || (r > n - 10 && c < 9))) continue;
    marcar(r - 2, c - 2, 5, 5);
  }
  if (version >= 7) { marcar(0, n - 11, 6, 3); marcar(n - 11, 0, 3, 6); }

  // c) zigzag inverso + desenmascarado
  const bits = [];
  let subiendo = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const fila = subiendo ? n - 1 - i : i;
      for (let d = 0; d < 2; d++) {
        const c = col - d;
        if (res[fila][c]) continue;
        let v = m[fila][c] ? 1 : 0;
        if (MASCARAS[mascara](fila, c)) v ^= 1;
        bits.push(v);
      }
    }
    subiendo = !subiendo;
  }
  const cw = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    cw.push(b);
  }

  // d) des-entrelazar los bloques de datos
  const totalBloques = g1 + g2;
  const base = Math.floor(capacidad / totalBloques);
  const largos = [];
  for (let i = 0; i < totalBloques; i++) largos.push(i < g1 ? base : base + 1);
  const bloques = largos.map(() => []);
  let idx = 0;
  const maxLargo = Math.max(...largos);
  for (let i = 0; i < maxLargo; i++) {
    for (let b = 0; b < totalBloques; b++) if (i < largos[b]) bloques[b].push(cw[idx++]);
  }
  const datos = [].concat(...bloques);

  // e) decodificar (modo byte)
  const dbits = [];
  datos.forEach(b => { for (let i = 7; i >= 0; i--) dbits.push((b >> i) & 1); });
  const take = (p, n2) => { let v = 0; for (let i = 0; i < n2; i++) v = (v << 1) | dbits[p + i]; return v; };
  const modo = take(0, 4);
  const lenBits = version < 10 ? 8 : 16;
  const largo = take(4, lenBits);
  const bytes = [];
  for (let i = 0; i < largo; i++) bytes.push(take(4 + lenBits + i * 8, 8));
  return { version, nivel, mascara, modo, texto: Buffer.from(bytes).toString('utf8') };
}

const casos = [
  'https://stock-celulares-final.vercel.app/estado.html?o=7123&k=k3n8x2p9qm4vb7ct',
  'https://stock-celulares-final.vercel.app/estado.html?o=1&k=aaaaaaaaaaaaaaaa',
  'TechPoint — reparación N°7100 · ñandú áéíóú',
  'x',
];
for (const txt of casos) {
  const mat = qrMatriz(txt);
  const r = leer(mat);
  ok(r.texto === txt, `vuelve igual (v${r.version}, máscara ${r.mascara}, ${mat.length}x${mat.length}): "${txt.slice(0, 42)}${txt.length > 42 ? '…' : ''}"`,
     { esperado: txt, leido: r.texto });
  ok(r.modo === 4, 'modo byte', r.modo);
  ok(r.nivel === 0, 'nivel de corrección M', r.nivel);
}

// ── 5. SVG listo para impresión térmica ──
console.log('\n5) SVG para térmica');
const svg = qrSvg('https://stock-celulares-final.vercel.app/estado.html?o=7123&k=k3n8x2p9qm4vb7ct', 25);
ok(/width="25mm"/.test(svg) && /height="25mm"/.test(svg), '25 mm de lado (mínimo legible)');
ok(/shape-rendering="crispEdges"/.test(svg), 'sin antialias (bordes limpios)');
ok(/fill="#000"/.test(svg) && /fill="#fff"/.test(svg), 'blanco y negro puro, sin grises');
ok(!/gradient|opacity|rgba/i.test(svg), 'sin degradados ni transparencias');
const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
const matAncho = qrMatriz('https://stock-celulares-final.vercel.app/estado.html?o=7123&k=k3n8x2p9qm4vb7ct').length;
ok(Number(vb[1]) === matAncho + 8, 'margen blanco de 4 módulos por lado', { viewBox: vb[1], modulos: matAncho });
// (el único "http" del SVG es el namespace de XML, que no descarga nada)
ok(!/<image|xlink:href|href=|url\(|<script/i.test(svg), 'no descarga ni ejecuta nada externo', svg.slice(0, 120));

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
