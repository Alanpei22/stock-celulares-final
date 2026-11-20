// ══════════════════════════════════════════════════════════════
//  ✨ HISTORIA DE WHATSAPP DE UN EQUIPO (estilo casa de celulares)
// ══════════════════════════════════════════════════════════════
//  Alan (20/11): "que agarre las fotos de los equipos de venta y
//  automáticamente se conviertan en el cartel". Antes lo hacía pasándole un
//  prompt y las fotos a una IA de imágenes, de a un equipo. Ahora sale de la
//  ficha del equipo (✨ Historia) con los datos que la app ya tiene.
//
//  El diseño (de arriba para abajo): TECHPOINT con su línea roja, el modelo
//  bien grande, la capacidad en una pastilla, los teléfonos RECORTADOS (sin
//  la mano ni el mostrador) uno de frente y otro de espalda, la batería, lo
//  que incluye con íconos, el precio en una pastilla roja (o el lugar vacío
//  para el widget de precio de WhatsApp) y la dirección al pie. De fondo,
//  una de las fotos desenfocada, sin color y oscura.
//
//  El recorte: en el celu no se puede "sacar el fondo" sin un programa
//  pesado. La IA (/api/ai → ubicarEquipos) dice dónde están las 4 esquinas
//  de cada teléfono y dónde hay IMEI / número de serie; acá se ajusta cada
//  borde al borde real de la foto, se recorta con esquinas redondeadas y se
//  tapan los datos. Si la IA no anda (sin internet), sale igual con las
//  fotos enteras en tarjetas: nunca te quedás sin historia.
//
//  Reutiliza de estado-equipos.js: cómo se bajan las fotos (CORS), la letra
//  y el "compartir" (WhatsApp → Mi estado / carpeta en la compu).
'use strict';

const HE_W = 1080, HE_H = 1920;
const HE_ROJO = '#e11d2a';
const HE_PIE = 'Urquiza 4741, Local 22 · Caseros | @techpoint.arg';
// Lo que puede incluir un equipo, con su ícono dibujado
const HE_INCLUYE = ['Cargador', 'Cable', 'Funda', 'Templado', 'Caja', 'Auriculares'];

const _heFuente = "Inter, 'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif";
const _heF = (peso, px) => `${peso} ${px}px ${_heFuente}`;

// ── Los datos ─────────────────────────────────────────────
// Del equipo del stock a lo que va en la historia. Sin color ni "libre":
// Alan no los quiere en el cartel.
function heDatos(p) {
  if (!p) return null;
  const usd = p.moneda === 'usd' && Number(p.precioUSD) > 0;
  const precio = Number(usd ? p.precioUSD : p.precio) || 0;
  const marca = String(p.marca || '').trim();
  let modelo = String(p.modelo || '').trim();
  // "iPhone 13" ya dice la marca; un Motorola "Edge 40" la necesita adelante
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (marca && !/^iphone/i.test(modelo) && !norm(modelo).startsWith(norm(marca)) && !/^apple$/i.test(marca)) modelo = `${marca} ${modelo}`;
  if (!modelo) modelo = marca || 'Celular';
  const cap = String(p.almacenamiento || '').trim().replace(/^(\d+)\s*(gb|tb)$/i, (m, n, u) => `${n} ${u.toUpperCase()}`);
  const bat = Math.round(Number(p.bateria) || 0);
  return {
    id: p.id || '',
    modelo,
    capacidad: cap,
    bateria: bat >= 1 && bat <= 100 && p.estado !== 'Nuevo' ? bat : 0,
    incluye: (Array.isArray(p.incluye) ? p.incluye : []).map(s => String(s).trim()).filter(Boolean).slice(0, 5),
    precio: precio > 0 && !p.ocultarPrecio ? hePrecioTxt(precio, usd ? 'usd' : 'ars') : '',
    fotos: (Array.isArray(p.fotos) ? p.fotos : []).filter(u => typeof u === 'string' && /^https:\/\//.test(u)),
  };
}

// 380 → "U$S 380.-" · 450000 → "$ 450.000.-" (como se escribe en el local)
function hePrecioTxt(n, moneda) {
  const v = Math.round(Number(n) || 0);
  if (!v) return '';
  return (moneda === 'usd' ? 'U$S ' : '$ ') + v.toLocaleString('es-AR') + '.-';
}

// Qué ícono lleva cada cosa que incluye
function heIcono(txt) {
  const t = String(txt || '').toLowerCase();
  if (/cargador|fuente|adaptador/.test(t)) return 'cargador';
  if (/cable/.test(t)) return 'cable';
  if (/funda|case|carcasa/.test(t)) return 'funda';
  if (/templado|vidrio|glass|protector|film|hidrogel/.test(t)) return 'templado';
  if (/caja/.test(t)) return 'caja';
  if (/auri|airpod|headphone/.test(t)) return 'auriculares';
  return 'otro';
}

// ── Geometría del recorte (pura: se prueba sin navegador) ────
// Las esquinas que dio la IA (en milésimas) → píxeles de la foto
function heEsquinasPx(esquinas, w, h) {
  return esquinas.map(([x, y]) => [x / 1000 * w, y / 1000 * h]);
}

// Ancho, alto, centro y giro del teléfono a partir de sus 4 esquinas
// (arriba-izq, arriba-der, abajo-der, abajo-izq)
function heMedidas(q) {
  const d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ancho = (d(q[0], q[1]) + d(q[3], q[2])) / 2;
  const alto = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
  const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  // El giro sale de los dos lados largos promediados (más estable)
  const a1 = Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]);
  const a2 = Math.atan2(q[2][1] - q[3][1], q[2][0] - q[3][0]);
  const giro = Math.atan2(Math.sin(a1) + Math.sin(a2), Math.cos(a1) + Math.cos(a2));
  return { ancho, alto, cx, cy, giro };
}

// Ajusta cada lado al borde de verdad: la IA marca las esquinas con un
// margen de error de unos píxeles, y un recorte corrido deja una franja de
// alfombrilla o le come el borde al teléfono. Se prueba correr cada lado
// para afuera y para adentro y se queda donde la foto "cambia" más (el
// borde del teléfono). `grad(x, y)` = cuánto cambia la foto en ese punto.
function heAjustarBordes(q, grad, margen) {
  const out = q.map(p => p.slice());
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
  const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  const lados = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const corr = lados.map(([i, j]) => {
    const a = q[i], b = q[j];
    const lx = b[0] - a[0], ly = b[1] - a[1], L = Math.hypot(lx, ly) || 1;
    // normal que apunta para afuera del teléfono
    let nx = -ly / L, ny = lx / L;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const puntaje = o => {
      let s = 0;
      // el tramo del medio del lado (en las puntas está la curva de la esquina)
      for (let k = 0.2; k <= 0.8001; k += 0.05) s += grad(a[0] + lx * k + nx * o, a[1] + ly * k + ny * o);
      // a igual borde, se prefiere no moverse (la IA casi siempre anda cerca)
      return s * (1 - Math.abs(o) / margen * 0.15);
    };
    // Cerca del teléfono suele haber VARIOS bordes (pantalla/marco,
    // marco/mano, mano/fondo). Quedarse con el más marcado a veces elige el
    // de la mano y queda un hilito de piel. Por eso: de los bordes claros
    // (al menos la mitad del más marcado), el más cercano a lo que dijo la
    // IA; si hay dos igual de cerca, el de adentro (perder un pelito de
    // marco no se nota, un pedazo de mano sí). Si la foto es pareja, nada.
    const paso = Math.max(1, margen / 12), os = [], ss = [];
    for (let o = -margen; o <= margen + 1e-9; o += paso) { os.push(o); ss.push(puntaje(o)); }
    const max = Math.max(...ss);
    let mejor = 0;
    if (max > 0) {
      let dist = Infinity;
      for (let k = 0; k < os.length; k++) {
        const pico = ss[k] >= max * 0.5 && (k === 0 || ss[k] >= ss[k - 1]) && (k === os.length - 1 || ss[k] >= ss[k + 1]);
        if (!pico) continue;
        const dd = Math.abs(os[k]) + (os[k] > 0 ? 0.5 : 0);   // a igual distancia, gana el de adentro
        if (dd < dist) { dist = dd; mejor = os[k]; }
      }
    }
    return { nx, ny, o: mejor };
  });
  // Cada esquina se mueve con los dos lados que se juntan en ella
  for (let i = 0; i < 4; i++) {
    const A = corr[(i + 3) % 4], B = corr[i];
    out[i][0] += A.nx * A.o + B.nx * B.o;
    out[i][1] += A.ny * A.o + B.ny * B.o;
  }
  return out;
}

// Achica el cuadrilátero hacia su centro `d` píxeles: el borde de la foto
// tiene una franja "mezclada" (medio teléfono, medio alfombrilla) que en la
// historia se ve como un hilito de color alrededor del equipo.
function heAchicar(q, d) {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
  const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  return q.map(([x, y]) => {
    const L = Math.hypot(x - cx, y - cy) || 1;
    // en la diagonal, para que cada lado entre ~d
    return [x - (x - cx) / L * d * 1.4, y - (y - cy) / L * d * 1.4];
  });
}

// El camino del recorte: el cuadrilátero con las esquinas redondeadas
function heCaminoRedondo(x, q, r) {
  const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  x.beginPath();
  const ini = m(q[3], q[0]);
  x.moveTo(ini[0], ini[1]);
  for (let i = 0; i < 4; i++) {
    const c = q[i], sig = m(q[i], q[(i + 1) % 4]);
    x.arcTo(c[0], c[1], sig[0], sig[1], r);
  }
  x.closePath();
}

// ── Las fotos ─────────────────────────────────────────────
function _heCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

// Una copia de la foto (achicada a lo que hace falta) donde se pueda
// dibujar: ahí se tapan los datos sensibles antes de usarla para nada.
function _heCopia(img, max) {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = _heCanvas(img.width * k, img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// Tapa una zona con un pixelado grueso (no se puede volver a leer)
function heTapar(cv, caja) {
  const x = cv.getContext('2d');
  const [x0, y0, x1, y1] = [caja[0] / 1000 * cv.width, caja[1] / 1000 * cv.height, caja[2] / 1000 * cv.width, caja[3] / 1000 * cv.height];
  const pad = Math.max(6, (y1 - y0) * 0.25);
  const X = Math.max(0, x0 - pad), Y = Math.max(0, y0 - pad);
  const W = Math.min(cv.width, x1 + pad) - X, H = Math.min(cv.height, y1 + pad) - Y;
  if (W <= 0 || H <= 0) return;
  const chico = _heCanvas(Math.max(2, W / 14), Math.max(2, H / 14));
  chico.getContext('2d').drawImage(cv, X, Y, W, H, 0, 0, chico.width, chico.height);
  x.save();
  x.imageSmoothingEnabled = false;
  x.drawImage(chico, X, Y, W, H);
  x.restore();
}

// Mapa de "cuánto cambia la foto" (para encontrar los bordes)
function _heGradiente(cv) {
  const k = Math.min(1, 640 / Math.max(cv.width, cv.height));
  const w = Math.round(cv.width * k), h = Math.round(cv.height * k);
  const c = _heCanvas(w, h);
  const x = c.getContext('2d');
  x.drawImage(cv, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
  return (px, py) => {
    const X = Math.round(px * k), Y = Math.round(py * k);
    if (X < 1 || Y < 1 || X >= w - 1 || Y >= h - 1) return 0;
    const i = Y * w + X;
    return Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]);
  };
}

// Recorta el teléfono: queda derecho (sin el giro que tenía en la foto),
// con las esquinas redondeadas y fondo transparente.
function heRecortar(cv, esquinas) {
  let q = heEsquinasPx(esquinas, cv.width, cv.height);
  const m0 = heMedidas(q);
  q = heAjustarBordes(q, _heGradiente(cv), Math.max(3, Math.min(m0.ancho, m0.alto) * 0.035));
  q = heAchicar(q, Math.max(2, Math.min(m0.ancho, m0.alto) * 0.026));
  const m = heMedidas(q);
  // Que quede parado aunque en la foto esté acostado
  let giro = m.giro, ancho = m.ancho, alto = m.alto;
  if (ancho > alto) { giro += Math.PI / 2; [ancho, alto] = [alto, ancho]; }
  const out = _heCanvas(ancho + 4, alto + 4);
  const x = out.getContext('2d');
  x.translate(out.width / 2, out.height / 2);
  x.rotate(-giro);
  x.translate(-m.cx, -m.cy);
  heCaminoRedondo(x, q, Math.min(ancho, alto) * 0.13);
  x.clip();
  x.drawImage(cv, 0, 0);
  return out;
}

// Sin recorte (la IA no anduvo): la foto entera en una tarjeta redondeada
function heTarjeta(cv) {
  const out = _heCanvas(cv.width, cv.height);
  const x = out.getContext('2d');
  const r = Math.min(cv.width, cv.height) * 0.06;
  x.beginPath(); x.roundRect ? x.roundRect(0, 0, cv.width, cv.height, r) : x.rect(0, 0, cv.width, cv.height);
  x.clip(); x.drawImage(cv, 0, 0);
  return out;
}

// ── El dibujo ─────────────────────────────────────────────
function _heSombraTexto(x, fuerte) {
  x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = fuerte ? 22 : 12; x.shadowOffsetX = 0; x.shadowOffsetY = fuerte ? 5 : 3;
}
function _heSinSombra(x) { x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetY = 0; }

function _heRedondo(x, cx, cy, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  x.beginPath();
  x.moveTo(cx + r, cy);
  x.arcTo(cx + w, cy, cx + w, cy + h, r);
  x.arcTo(cx + w, cy + h, cx, cy + h, r);
  x.arcTo(cx, cy + h, cx, cy, r);
  x.arcTo(cx, cy, cx + w, cy, r);
  x.closePath();
}

function _heEntra(x, txt, peso, base, min, ancho) {
  for (let t = base; t > min; t -= 2) { x.font = _heF(peso, t); if (x.measureText(txt).width <= ancho) return t; }
  x.font = _heF(peso, min); return min;
}

// Fondo: la foto ampliada, MUY desenfocada, casi sin color y oscura, con
// los bordes más oscuros. El desenfoque se hace achicando y agrandando (el
// filtro "blur" del canvas no anda en todos los iPhone), y el color se saca
// pintando gris en modo "saturación": así una alfombrilla rosa no mancha.
function heFondo(x, cv) {
  if (cv) {
    // Se achica de a mitades: de un saque el navegador "saltea" píxeles y
    // quedan manchones cuadrados en vez de un desenfoque parejo
    let src = cv;
    while (src.width > 72 || src.height > 128) {
      const m = _heCanvas(src.width / 2, src.height / 2);
      const mx = m.getContext('2d');
      mx.imageSmoothingEnabled = true; mx.imageSmoothingQuality = 'high';
      mx.drawImage(src, 0, 0, m.width, m.height);
      src = m;
    }
    // 36×64: desenfocado pero se reconoce el lugar (Alan, 20/11: como las
    // historias de las casas de celulares, "fondo real")
    const chico = _heCanvas(36, 64);
    const c = chico.getContext('2d');
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    const k = Math.max(36 / src.width, 64 / src.height);
    c.drawImage(src, (36 - src.width * k) / 2, (64 - src.height * k) / 2, src.width * k, src.height * k);
    // Dos pasadas (chico → mediano → grande): queda más parejo, sin cuadros
    const medio = _heCanvas(108, 192);
    const mc = medio.getContext('2d');
    mc.imageSmoothingEnabled = true; mc.imageSmoothingQuality = 'high';
    mc.drawImage(chico, -2, -2, 112, 196);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(medio, -80, -80, HE_W + 160, HE_H + 160);
    x.save();
    x.globalCompositeOperation = 'saturation';
    x.fillStyle = 'rgba(128,128,128,.88)';
    x.fillRect(0, 0, HE_W, HE_H);
    x.restore();
    x.fillStyle = 'rgba(8,10,14,.42)';
    x.fillRect(0, 0, HE_W, HE_H);
  } else {
    const g = x.createLinearGradient(0, 0, 0, HE_H);
    g.addColorStop(0, '#22262e'); g.addColorStop(1, '#0b0d11');
    x.fillStyle = g; x.fillRect(0, 0, HE_W, HE_H);
  }
  // Viñeta: los bordes más oscuros
  const v = x.createRadialGradient(HE_W / 2, HE_H * 0.45, HE_W * 0.35, HE_W / 2, HE_H * 0.45, HE_H * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.6)');
  x.fillStyle = v; x.fillRect(0, 0, HE_W, HE_H);
}

// Los íconos de "Incluye": dibujados con volumen (blanco con degradé y
// brillo), para que parezcan el cargador o la funda de verdad, como en las
// historias de las casas de celulares (Alan, 20/11). Un emoji sale distinto
// en cada celular y no combina con el estilo.
function heDibujarIcono(x, tipo, cx, cy, s) {
  x.save();
  x.translate(cx, cy);
  x.lineCap = 'round'; x.lineJoin = 'round';
  const blanco = (y0, y1) => { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c9ced6'); return g; };
  const vidrio = (y0, y1) => { const g = x.createLinearGradient(-s * 0.3, y0, s * 0.3, y1); g.addColorStop(0, 'rgba(255,255,255,.42)'); g.addColorStop(1, 'rgba(255,255,255,.06)'); return g; };
  const sombra = () => { x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = s * 0.12; x.shadowOffsetY = s * 0.04; };
  if (tipo === 'cargador') {
    // el cubito blanco con las patitas, y el cable enrollado al lado
    x.strokeStyle = '#e9ecf0'; x.lineWidth = s * 0.07;
    for (let k = 0; k < 3; k++) { x.beginPath(); x.ellipse(s * 0.2, s * 0.14, s * 0.2 - k * s * 0.035, s * 0.22 - k * s * 0.035, 0, 0, Math.PI * 2); x.stroke(); }
    x.beginPath(); x.moveTo(-s * 0.05, s * 0.2); x.quadraticCurveTo(0, s * 0.42, s * 0.12, s * 0.34); x.stroke();
    x.fillStyle = '#b8bec7';
    x.fillRect(-s * 0.3, -s * 0.46, s * 0.05, s * 0.16); x.fillRect(-s * 0.15, -s * 0.46, s * 0.05, s * 0.16);
    sombra(); x.fillStyle = blanco(-s * 0.3, s * 0.25);
    _heRedondo(x, -s * 0.4, -s * 0.3, s * 0.4, s * 0.5, s * 0.07); x.fill();
  } else if (tipo === 'cable') {
    x.strokeStyle = '#eef0f3'; x.lineWidth = s * 0.07;
    for (let k = 0; k < 4; k++) { x.beginPath(); x.ellipse(0, s * 0.02, s * 0.34 - k * s * 0.05, s * 0.3 - k * s * 0.05, 0, 0, Math.PI * 2); x.stroke(); }
    sombra(); x.fillStyle = blanco(-s * 0.46, -s * 0.2);
    _heRedondo(x, -s * 0.06, -s * 0.46, s * 0.12, s * 0.22, s * 0.03); x.fill();
  } else if (tipo === 'funda') {
    // la funda transparente, un poco girada, con el hueco de la cámara
    x.rotate(-0.22);
    x.fillStyle = vidrio(-s * 0.45, s * 0.45);
    _heRedondo(x, -s * 0.24, -s * 0.45, s * 0.48, s * 0.9, s * 0.1); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineWidth = s * 0.05;
    _heRedondo(x, -s * 0.24, -s * 0.45, s * 0.48, s * 0.9, s * 0.1); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = s * 0.025;
    _heRedondo(x, -s * 0.2, -s * 0.41, s * 0.4, s * 0.82, s * 0.08); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = s * 0.035;
    _heRedondo(x, -s * 0.17, -s * 0.38, s * 0.17, s * 0.17, s * 0.04); x.stroke();
  } else if (tipo === 'templado') {
    // el vidrio: lámina con brillo en diagonal
    x.rotate(-0.22);
    x.fillStyle = vidrio(-s * 0.45, s * 0.45);
    _heRedondo(x, -s * 0.24, -s * 0.45, s * 0.48, s * 0.9, s * 0.08); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = s * 0.035;
    _heRedondo(x, -s * 0.24, -s * 0.45, s * 0.48, s * 0.9, s * 0.08); x.stroke();
    x.save(); _heRedondo(x, -s * 0.24, -s * 0.45, s * 0.48, s * 0.9, s * 0.08); x.clip();
    x.fillStyle = 'rgba(255,255,255,.45)';
    x.beginPath(); x.moveTo(-s * 0.3, -s * 0.05); x.lineTo(s * 0.3, -s * 0.38); x.lineTo(s * 0.3, -s * 0.24); x.lineTo(-s * 0.3, s * 0.09); x.closePath(); x.fill();
    x.restore();
    x.fillStyle = 'rgba(255,255,255,.8)';
    _heRedondo(x, -s * 0.06, -s * 0.41, s * 0.12, s * 0.03, s * 0.015); x.fill();
  } else if (tipo === 'caja') {
    sombra();
    x.fillStyle = blanco(-s * 0.42, s * 0.42);
    _heRedondo(x, -s * 0.26, -s * 0.42, s * 0.52, s * 0.84, s * 0.06); x.fill();
    x.shadowColor = 'transparent';
    x.strokeStyle = 'rgba(0,0,0,.15)'; x.lineWidth = s * 0.02;
    x.beginPath(); x.moveTo(-s * 0.26, -s * 0.3); x.lineTo(s * 0.26, -s * 0.3); x.stroke();
  } else if (tipo === 'auriculares') {
    sombra(); x.fillStyle = blanco(-s * 0.1, s * 0.4);
    _heRedondo(x, -s * 0.3, -s * 0.06, s * 0.6, s * 0.44, s * 0.18); x.fill();
    x.shadowColor = 'transparent';
    x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = s * 0.02;
    x.beginPath(); x.moveTo(-s * 0.3, s * 0.08); x.lineTo(s * 0.3, s * 0.08); x.stroke();
    x.fillStyle = blanco(-s * 0.46, -s * 0.1);
    x.beginPath(); x.ellipse(-s * 0.14, -s * 0.28, s * 0.1, s * 0.14, -0.3, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(s * 0.14, -s * 0.28, s * 0.1, s * 0.14, 0.3, 0, Math.PI * 2); x.fill();
  } else {
    sombra(); x.fillStyle = blanco(-s * 0.36, s * 0.36);
    x.beginPath(); x.arc(0, 0, s * 0.36, 0, Math.PI * 2); x.fill();
    x.shadowColor = 'transparent';
    x.strokeStyle = '#16a34a'; x.lineWidth = s * 0.08;
    x.beginPath(); x.moveTo(-s * 0.16, 0); x.lineTo(-s * 0.03, s * 0.13); x.lineTo(s * 0.18, -s * 0.12); x.stroke();
  }
  x.restore();
}

function _heBateria(x, cx, cy, s, pct) {
  const w = s * 1.5, h = s * 0.8;
  x.save();
  x.strokeStyle = '#fff'; x.lineWidth = s * 0.09;
  _heRedondo(x, cx - w / 2, cy - h / 2, w, h, s * 0.14); x.stroke();
  x.fillStyle = '#fff';
  _heRedondo(x, cx + w / 2 + s * 0.04, cy - h * 0.2, s * 0.12, h * 0.4, s * 0.04); x.fill();
  x.fillStyle = '#22c55e';
  const pad = s * 0.12;
  _heRedondo(x, cx - w / 2 + pad, cy - h / 2 + pad, (w - pad * 2) * Math.max(0.15, pct / 100), h - pad * 2, s * 0.06); x.fill();
  x.restore();
}

// Los lugares de cada cosa, de abajo para arriba (así nada se pisa). Se
// calcula aparte del dibujo para poder probarlo.
function heLayout(d, altoModelo) {
  const L = {};
  L.pie = HE_H - 64;
  L.precio = { top: L.pie - 44 - 146, alto: 146 };            // aunque no haya precio: el lugar queda
  let abajo = L.precio.top - 28;
  if (d.incluye && d.incluye.length) {
    L.incluye = { top: abajo - 172, alto: 172, titulo: abajo - 172 - 18 };
    abajo = L.incluye.titulo - 46;
  }
  if (d.bateria) { L.bateria = { top: abajo - 92, alto: 92 }; abajo = L.bateria.top - 18; }
  L.marca = 168; L.linea = 194; L.sub = 238;
  L.modeloTop = 278;
  L.modeloBase = L.modeloTop + altoModelo;
  let arriba = L.modeloBase + 22;
  if (d.capacidad) { L.capacidad = { top: arriba, alto: 80 }; arriba += 80 + 12; }
  L.equipos = { top: arriba + 6, bottom: abajo - 6 };
  return L;
}

// Arma la historia. `piezas` = { fondo, frente, espalda } (canvas ya
// recortados o tarjetas). Devuelve el canvas.
function heDibujar(d, piezas) {
  const cv = _heCanvas(HE_W, HE_H);
  const x = cv.getContext('2d');
  x.textBaseline = 'alphabetic';
  heFondo(x, piezas.fondo);

  // El modelo: grande, en uno o dos renglones
  const ANCHO = 960;
  x.font = _heF(900, 128);
  let tm = _heEntra(x, d.modelo, 900, 128, 92, ANCHO);
  let renglones = [d.modelo];
  if (x.measureText(d.modelo).width > ANCHO) {
    const pal = d.modelo.split(' ');
    for (let i = pal.length - 1; i > 0; i--) {
      const a = pal.slice(0, i).join(' '), b = pal.slice(i).join(' ');
      x.font = _heF(900, tm);
      if (x.measureText(a).width <= ANCHO && x.measureText(b).width <= ANCHO) { renglones = [a, b]; break; }
    }
  }
  const altoRen = Math.round(tm * 1.02);
  const L = heLayout(d, Math.round(tm * 0.78) + (renglones.length - 1) * altoRen);

  // 1. TECHPOINT + línea roja + "Servicio técnico · Venta"
  x.textAlign = 'center'; x.fillStyle = '#fff';
  _heSombraTexto(x, true);
  x.font = _heF(900, 104);
  if ('letterSpacing' in x) x.letterSpacing = '6px';
  x.fillText('TECHPOINT', HE_W / 2 + 3, L.marca);
  if ('letterSpacing' in x) x.letterSpacing = '0px';
  _heSinSombra(x);
  x.fillStyle = HE_ROJO; x.fillRect(HE_W / 2 - 170, L.linea, 340, 5);
  _heSombraTexto(x);
  x.fillStyle = 'rgba(255,255,255,.92)';
  x.font = _heF(600, 34);
  x.fillText('Servicio técnico · Venta', HE_W / 2, L.sub);

  // 2. Modelo
  x.fillStyle = '#fff';
  _heSombraTexto(x, true);
  x.font = _heF(900, tm);
  renglones.forEach((r, i) => x.fillText(r, HE_W / 2, L.modeloTop + Math.round(tm * 0.78) + i * altoRen));
  _heSinSombra(x);

  // 3. Capacidad
  if (L.capacidad) {
    x.font = _heF(800, 48);
    const w = x.measureText(d.capacidad).width + 90, t = L.capacidad.top;
    x.fillStyle = 'rgba(12,14,20,.78)';
    _heRedondo(x, (HE_W - w) / 2, t, w, L.capacidad.alto, 40); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 6;
    _heRedondo(x, (HE_W - w) / 2, t, w, L.capacidad.alto, 40); x.stroke();
    x.fillStyle = '#fff';
    x.fillText(d.capacidad, HE_W / 2, t + 56);
  }

  // 4. Los teléfonos, grandes, sin cortarse en los bordes
  heDibujarEquipos(x, piezas, L.equipos.top, L.equipos.bottom);

  // 5a. Batería
  if (L.bateria) {
    const t = L.bateria.top, h = L.bateria.alto;
    x.font = _heF(600, 44);
    const a = 'Batería ', b = `${d.bateria}%`;
    const wa = x.measureText(a).width;
    x.font = _heF(900, 46);
    const wb = x.measureText(b).width;
    const w = 50 + 76 + 22 + wa + wb + 50;
    const X = (HE_W - w) / 2;
    x.fillStyle = 'rgba(12,14,20,.72)';
    _heRedondo(x, X, t, w, h, h / 2); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 5;
    _heRedondo(x, X, t, w, h, h / 2); x.stroke();
    _heBateria(x, X + 50 + 34, t + h / 2, 48, d.bateria);
    x.textAlign = 'left'; x.fillStyle = '#fff';
    x.font = _heF(600, 44); x.fillText(a, X + 50 + 76 + 22, t + 62);
    x.font = _heF(900, 46); x.fillText(b, X + 50 + 76 + 22 + wa, t + 62);
    x.textAlign = 'center';
  }

  // 5b. Incluye
  if (L.incluye) {
    const it = d.incluye, n = it.length;
    const W = Math.min(960, 150 + n * 170), X = (HE_W - W) / 2, t = L.incluye.top, h = L.incluye.alto;
    _heSombraTexto(x);
    x.fillStyle = '#fff'; x.font = _heF(800, 40);
    x.fillText('Incluye:', HE_W / 2, L.incluye.titulo);
    _heSinSombra(x);
    x.fillStyle = 'rgba(12,14,20,.62)';
    _heRedondo(x, X, t, W, h, 34); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 5;
    _heRedondo(x, X, t, W, h, 34); x.stroke();
    const col = W / n;
    for (let i = 0; i < n; i++) {
      const cx = X + col * i + col / 2;
      if (i) { x.strokeStyle = 'rgba(255,255,255,.4)'; x.lineWidth = 2; x.beginPath(); x.moveTo(X + col * i, t + 26); x.lineTo(X + col * i, t + h - 26); x.stroke(); }
      heDibujarIcono(x, heIcono(it[i]), cx, t + 70, 92);
      x.fillStyle = '#fff';
      _heEntra(x, it[i], 700, 30, 20, col - 20);
      x.fillText(it[i], cx, t + h - 26);
    }
  }

  // 5c. Precio (si no hay, el lugar queda libre para el widget de WhatsApp)
  if (d.precio) {
    const t = L.precio.top, h = L.precio.alto;
    const tp = _heEntra(x, d.precio, 900, 104, 64, 820);
    const w = Math.max(560, x.measureText(d.precio).width + 150);
    const X = (HE_W - w) / 2;
    x.save();
    x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 30; x.shadowOffsetY = 10;
    const g = x.createLinearGradient(0, t, 0, t + h);
    g.addColorStop(0, '#d42a2a'); g.addColorStop(0.55, '#a51212'); g.addColorStop(1, '#6a0808');
    x.fillStyle = g;
    _heRedondo(x, X, t, w, h, h / 2); x.fill();
    x.restore();
    // el brillo de arriba (como una pastilla de vidrio)
    x.save();
    _heRedondo(x, X, t, w, h, h / 2); x.clip();
    const br = x.createLinearGradient(0, t, 0, t + h * 0.5);
    br.addColorStop(0, 'rgba(255,255,255,.32)'); br.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = br;
    _heRedondo(x, X + h * 0.25, t + 6, w - h * 0.5, h * 0.46, h * 0.23); x.fill();
    x.restore();
    x.strokeStyle = '#fff'; x.lineWidth = 6;
    _heRedondo(x, X, t, w, h, h / 2); x.stroke();
    x.fillStyle = '#fff';
    _heSombraTexto(x);
    x.font = _heF(900, tp);
    x.fillText(d.precio, HE_W / 2, t + h / 2 + tp * 0.36);
    _heSinSombra(x);
  }

  // 6. Pie
  _heSombraTexto(x);
  x.fillStyle = 'rgba(255,255,255,.9)';
  _heEntra(x, HE_PIE, 600, 30, 22, 980);
  x.fillText(HE_PIE, HE_W / 2, L.pie);
  _heSinSombra(x);
  return cv;
}

// Frente y espalda, apenas inclinados hacia lados opuestos, con sombra.
// Se calcula el tamaño para que, ya girados, entren enteros en el espacio.
function heDibujarEquipos(x, piezas, top, bottom) {
  const lista = [piezas.espalda, piezas.frente].filter(Boolean);   // la espalda atrás
  if (!lista.length) return;
  const H = bottom - top, W = 1040;
  const dos = lista.length === 2;
  const ang = dos ? [4, -4] : [-3];
  const GAP = 26;                    // un poquito de aire entre los dos
  const caja = (c, a, alto) => {
    const k = alto / c.height, w = c.width * k, r = Math.abs(a) * Math.PI / 180;
    return { w: w * Math.cos(r) + alto * Math.sin(r), h: w * Math.sin(r) + alto * Math.cos(r), k };
  };
  // El alto más grande que entra (los dos lado a lado, solapados un poco)
  let alto = H;
  for (; alto > 120; alto -= 8) {
    const cs = lista.map((c, i) => caja(c, ang[i], alto));
    const anchoTot = dos ? cs[0].w + cs[1].w + GAP : cs[0].w;
    if (Math.max(...cs.map(c => c.h)) <= H && anchoTot <= W) break;
  }
  const cs = lista.map((c, i) => caja(c, ang[i], alto));
  const anchoTot = dos ? cs[0].w + cs[1].w + GAP : cs[0].w;
  let px = (HE_W - anchoTot) / 2;
  const cy = top + H / 2;
  // Espalda a la derecha (atrás), frente a la izquierda (adelante)
  const orden = dos ? [{ i: 0, cx: px + anchoTot - cs[0].w / 2 }, { i: 1, cx: px + cs[1].w / 2 }] : [{ i: 0, cx: HE_W / 2 }];
  orden.forEach(({ i, cx }) => {
    const c = lista[i], k = cs[i].k;
    x.save();
    x.translate(cx, cy);
    x.rotate(ang[i] * Math.PI / 180);
    x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 50; x.shadowOffsetY = 24;
    x.drawImage(c, -c.width * k / 2, -c.height * k / 2, c.width * k, c.height * k);
    x.restore();
  });
}

// ── Armar todo: fotos → IA → recorte → dibujo ─────────────
async function heArmar(d, alAvanzar) {
  const av = t => { if (typeof alAvanzar === 'function') alAvanzar(t); };
  if (typeof _eeFuentes === 'function') await _eeFuentes();
  av('Bajando las fotos…');
  const urls = d.fotos.slice(0, 4);
  const imgs = (await Promise.all(urls.map(u => (typeof _eeFoto === 'function' ? _eeFoto(u) : null)))).filter(Boolean);
  const copias = imgs.map(img => _heCopia(img, 1400));
  let ub = null;
  if (copias.length) {
    av('Buscando los teléfonos en las fotos…');
    try {
      const imagenes = copias.map(c => _heCopia(c, 900).toDataURL('image/jpeg', 0.82).split(',')[1]);
      const r = await apiFetch('/api/ai', { method: 'POST', body: JSON.stringify({ action: 'ubicarEquipos', data: { imagenes } }) });
      const j = r.ok ? await r.json() : null;
      ub = j && j.ubicacion;
    } catch (e) { console.warn('[historia] ubicar:', e); }
  }
  av('Armando la historia…');
  // Primero se tapan los datos sensibles (antes de usar la foto para nada)
  if (ub) ub.sensibles.forEach(s => copias[s.foto] && heTapar(copias[s.foto], s.caja));
  const piezas = { fondo: copias[ub ? ub.fondo : 0] || copias[0] || null, frente: null, espalda: null, recortado: false };
  if (ub) {
    if (ub.frente && copias[ub.frente.foto]) piezas.frente = heRecortar(copias[ub.frente.foto], ub.frente.esquinas);
    if (ub.espalda && copias[ub.espalda.foto]) piezas.espalda = heRecortar(copias[ub.espalda.foto], ub.espalda.esquinas);
    piezas.recortado = !!(piezas.frente || piezas.espalda);
  }
  if (!piezas.recortado) {
    // Sin la IA: hasta dos fotos enteras, en tarjetas
    piezas.frente = copias[0] ? heTarjeta(copias[0]) : null;
    piezas.espalda = copias[1] ? heTarjeta(copias[1]) : null;
  }
  const cv = heDibujar(d, piezas);
  const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.92));
  return { blob, recortado: piezas.recortado, sinFotos: !copias.length };
}

// ── La pantalla ───────────────────────────────────────────
let _heEq = null, _heArch = null;

function heAbrir(id) {
  const p = (typeof STOCK !== 'undefined') ? STOCK.find(x => x.id === id) : null;
  if (!p) return;
  _heEq = p; _heArch = null;
  const d = heDatos(p);
  _heEstilos();
  heCerrar();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const chips = HE_INCLUYE.map(n => `<button type="button" class="he-chip${d.incluye.includes(n) ? ' on' : ''}" onclick="this.classList.toggle('on')">${n}</button>`).join('');
  const ov = document.createElement('div');
  ov.id = 'he-ov'; ov.onclick = e => { if (e.target === ov) heCerrar(); };
  ov.innerHTML = `<div class="he-box">
    <div class="he-hd"><b>✨ Historia de WhatsApp</b><button type="button" onclick="heCerrar()">✕</button></div>
    ${d.fotos.length ? `<p class="he-sub">Sale con las ${d.fotos.length === 1 ? 'foto' : d.fotos.length + ' fotos'} del equipo: los teléfonos recortados y el fondo desenfocado.</p>`
      : '<p class="he-sub he-ojo">Este equipo no tiene fotos: sale sin los teléfonos. Subile fotos (una de frente y una de espalda) para que quede mejor.</p>'}
    <label class="he-l">Modelo<input id="he-modelo" class="he-in" value="${esc(d.modelo)}"></label>
    <div class="he-dos">
      <label class="he-l">Capacidad<input id="he-cap" class="he-in" value="${esc(d.capacidad)}" placeholder="128 GB"></label>
      <label class="he-l">Batería %<input id="he-bat" class="he-in" type="number" inputmode="numeric" min="1" max="100" value="${d.bateria || ''}" placeholder="—"></label>
    </div>
    <div class="he-l">Incluye</div>
    <div class="he-chips" id="he-inc">${chips}</div>
    <label class="he-l">Precio <small>(vacío = lugar libre para el widget de precio de WhatsApp)</small><input id="he-precio" class="he-in" value="${esc(d.precio)}" placeholder="U$S 380.-"></label>
    <button type="button" class="he-ok" id="he-ir" onclick="heIr()">✨ Armar la historia</button>
    <div id="he-res"></div>
  </div>`;
  document.body.appendChild(ov);
}

function heCerrar() { document.getElementById('he-ov')?.remove(); }

// Lo que quedó en la pantalla → datos para el dibujo
function heLeerPantalla() {
  const v = id => (document.getElementById(id)?.value || '').trim();
  const d = heDatos(_heEq);
  d.modelo = v('he-modelo') || d.modelo;
  d.capacidad = v('he-cap');
  const b = Math.round(Number(v('he-bat')) || 0);
  d.bateria = b >= 1 && b <= 100 ? b : 0;
  d.incluye = [...document.querySelectorAll('#he-inc .he-chip.on')].map(c => c.textContent.trim()).slice(0, 5);
  let pr = v('he-precio');
  // "380" solo → con el formato del local
  if (/^\d[\d.]*$/.test(pr)) pr = hePrecioTxt(Number(pr.replace(/\./g, '')), Number(pr.replace(/\./g, '')) < 10000 ? 'usd' : 'ars');
  d.precio = pr;
  return d;
}

async function heIr() {
  if (!_heEq) return;
  const d = heLeerPantalla();
  const btn = document.getElementById('he-ir');
  const res = document.getElementById('he-res');
  if (btn) btn.disabled = true;
  // Lo que incluye queda guardado en el equipo para la próxima
  const antes = JSON.stringify(Array.isArray(_heEq.incluye) ? _heEq.incluye : []);
  if (JSON.stringify(d.incluye) !== antes && typeof db !== 'undefined' && db && _heEq.id) {
    db.collection('stock').doc(_heEq.id).update({ incluye: d.incluye }).then(() => { _heEq.incluye = d.incluye; }).catch(e => console.warn('[historia] incluye:', e));
  }
  try {
    const r = await heArmar(d, t => { if (btn) btn.textContent = '⏳ ' + t; });
    if (!r.blob) throw new Error('sin imagen');
    const nombre = 'historia-' + (d.modelo.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'equipo') + '.jpg';
    _heArch = new File([r.blob], nombre, { type: 'image/jpeg' });
    const url = URL.createObjectURL(r.blob);
    if (res) res.innerHTML = `
      ${!r.recortado && !r.sinFotos ? '<p class="he-sub he-ojo">No pude recortar los teléfonos (¿sin internet?): salió con las fotos enteras. <b>Ojo:</b> así tampoco se pudo tapar el IMEI o el número de serie si alguna foto los muestra.</p>' : ''}
      <img class="he-prev" src="${url}" alt="Historia">
      <p class="he-sub">Revisala antes de subirla: que los teléfonos estén bien recortados y no se vea ningún dato (IMEI, serie).</p>
      <button type="button" class="he-ok" onclick="heCompartir()">📲 Subir a WhatsApp</button>`;
  } catch (e) {
    console.error('[historia]', e);
    toast('No se pudo armar la historia', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔁 Armarla de nuevo'; }
  }
}

function heCompartir() {
  if (!_heArch) return;
  heCerrar();
  const esCompu = typeof _waEsCompu === 'function' ? _waEsCompu() : true;
  if (!esCompu && navigator.canShare && navigator.canShare({ files: [_heArch] }) && typeof _eeListo === 'function') _eeListo([_heArch]);
  else if (typeof _eeListoPc === 'function') _eeListoPc([_heArch]);
}

function _heEstilos() {
  if (document.getElementById('he-css')) return;
  const s = document.createElement('style');
  s.id = 'he-css';
  s.textContent = `
  #he-ov { position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; padding: 12px; }
  .he-box { background: var(--card, #fff); color: var(--text, #111); border-radius: 16px; padding: 16px; width: min(460px, 100%); max-height: 92vh; overflow: auto; }
  .he-hd { display: flex; justify-content: space-between; align-items: center; font-size: 17px; margin-bottom: 4px; }
  .he-hd button { border: 0; background: none; font-size: 20px; cursor: pointer; color: inherit; }
  .he-sub { font-size: 13px; opacity: .8; margin: 6px 0 10px; line-height: 1.4; }
  .he-ojo { opacity: 1; background: rgba(245,158,11,.14); border: 1px solid rgba(245,158,11,.5); border-radius: 10px; padding: 8px 10px; }
  .he-l { display: block; font-size: 13px; font-weight: 700; margin: 8px 0 4px; }
  .he-l small { font-weight: 500; opacity: .7; }
  .he-in { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; padding: 10px; border-radius: 10px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; font-size: 15px; }
  .he-dos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .he-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .he-chip { padding: 8px 12px; border-radius: 999px; border: 1.5px solid rgba(128,128,128,.4); background: none; color: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
  .he-chip.on { border-color: #25D366; background: rgba(37,211,102,.15); }
  .he-ok { width: 100%; margin-top: 14px; padding: 14px; border: 0; border-radius: 12px; background: #25D366; color: #fff; font-weight: 800; font-size: 15.5px; cursor: pointer; }
  .he-ok:disabled { opacity: .65; }
  .he-prev { display: block; width: 100%; max-width: 300px; margin: 12px auto 0; border-radius: 12px; box-shadow: 0 6px 20px rgba(0,0,0,.3); }`;
  document.head.appendChild(s);
}
