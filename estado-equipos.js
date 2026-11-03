// ══════════════════════════════════════════════════════════════
//  📲 EQUIPOS PARA LOS ESTADOS DE WHATSAPP
// ══════════════════════════════════════════════════════════════
//  Alan: "¿podemos publicar los celus de la página en los estados de
//  WhatsApp?". WhatsApp no deja que una app publique estados sola (ni con la
//  cuenta Business ni con su API: los estados se suben solo a mano). Lo que
//  sí se puede es dejarlo a UN toque: la app arma una imagen de historia por
//  equipo (foto, modelo, precio, garantía, datos del local) y las manda
//  todas juntas al menú de compartir del celular → WhatsApp → "Mi estado".
//
//  Sale del STOCK que la app ya tiene en memoria: cero lecturas de Firestore.
//  Las fotos se dibujan en un canvas; si Storage no las deja leer directo
//  (CORS), se piden por /api/equipos?foto=, que las trae desde el servidor.
'use strict';

const EE_W = 1080, EE_H = 1920;     // la medida de una historia
const EE_MAX = 30;                  // WhatsApp sube hasta 30 de una vez
// Los mismos mínimos que la página (api/equipos.js): un precio que no puede
// ser (dólares cargados como pesos) sale "Consultar precio".
const EE_MIN_ARS = 10000, EE_MIN_USD = 10;

function _eeNorm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// Un equipo del stock → lo que va en la imagen. Las mismas reglas que la
// ficha de la página, para que el estado no diga otra cosa que la web.
function eeDesdeStock(p) {
  if (!p) return null;
  const usd = p.moneda === 'usd' && Number(p.precioUSD) > 0;
  let precio = Number(usd ? p.precioUSD : p.precio) || 0;
  if (p.ocultarPrecio || precio < (usd ? EE_MIN_USD : EE_MIN_ARS)) precio = 0;
  const cap = String(p.almacenamiento || '').trim().replace(/^(\d+)\s*(gb|tb)$/i, (m, n, u) => `${n} ${u.toUpperCase()}`);
  return {
    id: p.id,
    marca: String(p.marca || '').trim(),
    modelo: String(p.modelo || '').trim(),
    capacidad: cap,
    color: String(p.color || '').trim(),
    condicion: p.estado === 'Reacondicionado' ? 'Reacondicionado' : (p.estado === 'Nuevo' ? 'Nuevo' : 'Usado'),
    bateria: Math.min(100, Math.round(Number(p.bateria) || 0)) || null,
    garantiaMeses: Math.round(Number(p.garantiaMeses) || 0),
    precio,
    moneda: precio && usd ? 'usd' : 'ars',
    fotos: (Array.isArray(p.fotos) ? p.fotos : []).filter(u => typeof u === 'string' && /^https:\/\//.test(u)),
    unidades: 1,
    colores: p.color ? [String(p.color).trim()] : [],
  };
}

// Los que van: publicados en la página, sin vender y sin reservar.
// Varias unidades iguales (mismo modelo, precio y estado) son UN estado
// con los colores juntos, igual que en la página: cinco estados del mismo
// A16 son ruido.
function eeParaEstados(stock) {
  const grupos = new Map();
  for (const p of (stock || [])) {
    if (!p || !p.publicar || p.vendido || p.reservado || p.eliminado) continue;
    const e = eeDesdeStock(p);
    const k = [e.marca, e.modelo, e.capacidad, e.condicion, e.precio, e.moneda, e.garantiaMeses, e.bateria].map(_eeNorm).join('|');
    const g = grupos.get(k);
    if (!g) { grupos.set(k, e); continue; }
    g.unidades++;
    if (e.color && !g.colores.includes(e.color)) g.colores.push(e.color);
    if (!g.fotos.length && e.fotos.length) g.fotos = e.fotos;
  }
  return [...grupos.values()];
}

// Los textos de la imagen (separados del dibujo para poder probarlos)
function eeTextos(e) {
  const repite = e.marca && _eeNorm(e.modelo).startsWith(_eeNorm(e.marca));
  const nombre = [repite ? '' : e.marca, e.modelo, e.capacidad].filter(Boolean).join(' ');
  const specs = [];
  if (e.colores && e.colores.length) specs.push(e.colores.join(', '));
  if (e.bateria) specs.push(`🔋 ${e.bateria}%`);
  if (e.garantiaMeses) specs.push(`Garantía ${e.garantiaMeses} ${e.garantiaMeses === 1 ? 'mes' : 'meses'}`);
  const precio = e.precio
    ? (e.moneda === 'usd' ? 'U$S ' : '$ ') + Math.round(e.precio).toLocaleString('es-AR')
    : 'Consultar precio';
  return {
    nombre,
    specs: specs.join(' · '),
    precio,
    condicion: e.condicion,
    unidades: e.unidades > 1 ? `${e.unidades} disponibles` : '',
  };
}

// ── Las fotos ─────────────────────────────────────────────
async function _eeImagenDe(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}

async function _eeFoto(url) {
  if (!url) return null;
  // 1) Directo de Storage (anda si el bucket tiene CORS)
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (r.ok) return await _eeImagenDe(await r.blob());
  } catch (e) { /* CORS: probamos por el servidor */ }
  // 2) Por nuestro servidor, que no tiene esa traba
  try {
    const r = await apiFetch('/api/equipos?foto=' + encodeURIComponent(url));
    if (r.ok) return await _eeImagenDe(await r.blob());
  } catch (e) { console.warn('[estado-equipos] foto:', e); }
  return null;
}

// ── Qué imágenes salen ────────────────────────────────────
// Alan (03/11): "que se puedan subir TODAS las imágenes que estén subidas
// del equipo". Antes salía una por equipo, con la primera foto. Ahora cada
// foto es un estado: la primera es la "portada" (con todos los datos) y las
// otras son la galería (la foto grande y lo justo abajo). En WhatsApp quedan
// seguidas, así que el que mira pasa de una a otra del mismo equipo.
function eePiezas(equipos) {
  const out = [];
  for (const e of (equipos || [])) {
    const fotos = (e && e.fotos && e.fotos.length) ? e.fotos : [null];
    fotos.forEach((foto, n) => out.push({ e, foto, n, total: fotos.length }));
  }
  return out;
}
function eeCuantasImagenes(equipos) { return eePiezas(equipos).length; }

// ── El dibujo ─────────────────────────────────────────────
// Alan: "ponele más ganas a las fotos". La idea es que parezca una
// publicidad y no una ficha: de fondo la MISMA foto del equipo, desenfocada
// y oscura (así cada estado tiene los colores de su celular), la foto nítida
// adelante con sombra, y abajo el texto grande con un degradé que lo hace
// legible sobre cualquier foto.
//
// Arriba y abajo quedan ~150px libres: ahí WhatsApp pone su barra y el
// "Responder", y taparían lo que se escriba.
const EE_FUENTE = "Inter, 'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif";
const EE_F = (peso, px) => `${peso} ${px}px ${EE_FUENTE}`;
const EE_COND = { Nuevo: '#22c55e', Usado: '#38bdf8', Reacondicionado: '#a78bfa' };
const EE_ORO = '#FFD23F', EE_WA = '#25D366';

// La letra Inter la usa la app; el canvas la toma solo si ya está cargada.
async function _eeFuentes() {
  try {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      await Promise.all(['500', '600', '700', '800', '900'].map(p => document.fonts.load(EE_F(p, 40))));
    }
  } catch (e) { /* sin Inter sale con la del sistema */ }
}

function _eeRedondo(x, cx, cy, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  x.beginPath();
  x.moveTo(cx + r, cy);
  x.arcTo(cx + w, cy, cx + w, cy + h, r);
  x.arcTo(cx + w, cy + h, cx, cy + h, r);
  x.arcTo(cx, cy + h, cx, cy, r);
  x.arcTo(cx, cy, cx + w, cy, r);
  x.closePath();
}

// Achica la letra hasta que el texto entre en el ancho
function _eeEntra(x, txt, peso, base, min, ancho) {
  let t = base;
  for (; t > min; t -= 2) {
    x.font = EE_F(peso, t);
    if (x.measureText(txt).width <= ancho) return t;
  }
  x.font = EE_F(peso, min);
  return min;
}

// Un texto que no entra ni chico se parte en dos renglones
function _eeRenglones(x, txt, ancho) {
  if (x.measureText(txt).width <= ancho) return [txt];
  const pal = txt.split(' ');
  for (let i = pal.length - 1; i > 0; i--) {
    const a = pal.slice(0, i).join(' ');
    if (x.measureText(a).width <= ancho) return [a, pal.slice(i).join(' ')];
  }
  return [txt];
}

// El logo del local (el de ⚙️ Configuración), una sola vez
let _eeLogoProm = null;
function _eeLogo() {
  if (_eeLogoProm) return _eeLogoProm;
  const src = (typeof BIZ_IMAGE !== 'undefined' && BIZ_IMAGE) ? BIZ_IMAGE : '';
  _eeLogoProm = !src ? Promise.resolve(null) : new Promise(ok => {
    const img = new Image();
    img.onload = () => ok(img); img.onerror = () => ok(null);
    img.src = src;
  });
  return _eeLogoProm;
}

// Fondo: la foto estirada a toda la pantalla y desenfocada. El desenfoque
// se hace achicándola a 27×48 y volviéndola a agrandar: anda en todos los
// navegadores (el filtro "blur" del canvas no está en todos los iPhone).
function _eeFondo(x, foto) {
  if (foto) {
    const chico = document.createElement('canvas');
    chico.width = 27; chico.height = 48;
    const c = chico.getContext('2d');
    const k = Math.max(27 / foto.width, 48 / foto.height);
    c.drawImage(foto, (27 - foto.width * k) / 2, (48 - foto.height * k) / 2, foto.width * k, foto.height * k);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(chico, -60, -60, EE_W + 120, EE_H + 120);
    x.fillStyle = 'rgba(5,12,28,.58)';
    x.fillRect(0, 0, EE_W, EE_H);
  } else {
    const g = x.createLinearGradient(0, 0, EE_W, EE_H);
    g.addColorStop(0, '#163a6b'); g.addColorStop(1, '#050d1c');
    x.fillStyle = g; x.fillRect(0, 0, EE_W, EE_H);
    // Unos círculos de luz para que no sea un fondo liso
    [[180, 420, 520, 'rgba(56,189,248,.18)'], [940, 1300, 620, 'rgba(37,99,235,.22)']].forEach(([cx, cy, r, col]) => {
      const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = rg; x.fillRect(0, 0, EE_W, EE_H);
    });
  }
  // Oscuro arriba (para el encabezado) y bien oscuro abajo (para el texto)
  const arr = x.createLinearGradient(0, 0, 0, 360);
  arr.addColorStop(0, 'rgba(3,8,20,.7)'); arr.addColorStop(1, 'rgba(3,8,20,0)');
  x.fillStyle = arr; x.fillRect(0, 0, EE_W, 360);
}

function _eeDegradeAbajo(x, desde) {
  const g = x.createLinearGradient(0, desde, 0, EE_H);
  g.addColorStop(0, 'rgba(3,8,20,0)');
  g.addColorStop(0.35, 'rgba(3,8,20,.82)');
  g.addColorStop(1, 'rgba(3,8,20,.97)');
  x.fillStyle = g; x.fillRect(0, desde, EE_W, EE_H - desde);
}

// Encabezado: logo + nombre del local, y Nuevo / Usado a la derecha
async function _eeEncabezado(x, t) {
  const logo = await _eeLogo();
  const biz = (typeof BIZ_DATA !== 'undefined' && BIZ_DATA) ? BIZ_DATA : {};
  let tx = 80;
  if (logo) {
    x.save();
    x.beginPath(); x.arc(80 + 48, 200, 48, 0, Math.PI * 2); x.closePath();
    x.fillStyle = '#fff'; x.fill(); x.clip();
    const k = Math.min(80 / logo.width, 80 / logo.height);
    x.drawImage(logo, 128 - logo.width * k / 2, 200 - logo.height * k / 2, logo.width * k, logo.height * k);
    x.restore();
    tx = 200;
  }
  x.textAlign = 'left'; x.fillStyle = '#fff';
  x.font = EE_F(900, 44);
  x.fillText('TECHPOINT', tx, 196);
  x.fillStyle = 'rgba(255,255,255,.72)';
  // "J.J. de Urquiza 4741 — Local 22" → "J.J. de Urquiza 4741 · Caseros"
  let sub = String(biz.dir || 'Urquiza 4741').replace(/\s*[—–-]\s*Local.*$/i, '').trim();
  if (!/caseros/i.test(sub)) sub += ' · Caseros';
  _eeEntra(x, sub, 500, 28, 20, EE_W - 80 - tx - 300);
  x.fillText(sub, tx, 236);

  x.font = EE_F(800, 32);
  const cw = x.measureText(t.condicion).width + 60;
  x.fillStyle = EE_COND[t.condicion] || '#38bdf8';
  _eeRedondo(x, EE_W - 80 - cw, 166, cw, 68, 34); x.fill();
  x.fillStyle = '#04121f'; x.textAlign = 'center';
  x.fillText(t.condicion.toUpperCase(), EE_W - 80 - cw / 2, 212);
}

// La foto nítida, entera (sin recortar el celular), con esquinas redondas
// y sombra, centrada en el espacio que quede.
function _eeFotoNitida(x, foto, top, bottom) {
  const aw = 940, ah = bottom - top;
  if (!foto) {
    x.textAlign = 'center';
    x.font = `${Math.min(420, ah * 0.6)}px ${EE_FUENTE}`;
    x.fillText('📱', EE_W / 2, top + ah / 2 + Math.min(420, ah * 0.6) * 0.35);
    return;
  }
  const k = Math.min(aw / foto.width, ah / foto.height);
  const w = foto.width * k, h = foto.height * k;
  const fx = (EE_W - w) / 2, fy = top + (ah - h) / 2;
  x.save();
  x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 70; x.shadowOffsetY = 30;
  x.fillStyle = '#111';
  _eeRedondo(x, fx, fy, w, h, 40); x.fill();
  x.restore();
  x.save();
  _eeRedondo(x, fx, fy, w, h, 40); x.clip();
  x.drawImage(foto, fx, fy, w, h);
  x.restore();
  // Un filo claro alrededor: separa la foto del fondo (que es la misma foto)
  x.save();
  x.strokeStyle = 'rgba(255,255,255,.22)'; x.lineWidth = 3;
  _eeRedondo(x, fx, fy, w, h, 40); x.stroke();
  x.restore();
  return { fx, fy, w, h };
}

// Los puntitos de "hay más fotos" (como en Instagram)
function _eePuntos(x, n, total, y) {
  if (total < 2) return;
  const r = 9, gap = 30, ancho = (total - 1) * gap;
  for (let i = 0; i < total; i++) {
    x.beginPath(); x.arc(EE_W / 2 - ancho / 2 + i * gap, y, i === n ? r : r * 0.7, 0, Math.PI * 2);
    x.fillStyle = i === n ? '#fff' : 'rgba(255,255,255,.4)'; x.fill();
  }
}

// El botón verde de abajo, con el WhatsApp del local
function _eeBotonWa(x, top) {
  const biz = (typeof BIZ_DATA !== 'undefined' && BIZ_DATA) ? BIZ_DATA : {};
  const tel = biz.tel || '11 7239-2511';
  x.save();
  x.shadowColor = 'rgba(37,211,102,.45)'; x.shadowBlur = 40; x.shadowOffsetY = 10;
  x.fillStyle = EE_WA;
  _eeRedondo(x, 110, top, 860, 104, 52); x.fill();
  x.restore();
  x.fillStyle = '#fff'; x.textAlign = 'center';
  const txt = `Escribinos al ${tel}`;
  _eeEntra(x, txt, 800, 44, 30, 720);
  x.fillText(txt, EE_W / 2 + 30, top + 68);
  // Globito de chat dibujado (un emoji acá sale distinto en cada compu)
  const w = x.measureText(txt).width;
  const cx = EE_W / 2 + 30 - w / 2 - 44, cy = top + 52;
  x.beginPath(); x.arc(cx, cy, 24, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill();
  x.beginPath(); x.moveTo(cx - 18, cy + 14); x.lineTo(cx - 26, cy + 30); x.lineTo(cx - 6, cy + 22); x.closePath(); x.fill();
  x.fillStyle = EE_WA;
  [-9, 0, 9].forEach(d => { x.beginPath(); x.arc(cx + d, cy, 3.6, 0, Math.PI * 2); x.fill(); });
}

// Las "pastillas" de datos, en renglones centrados
function _eePastillas(x, items, ancho) {
  x.font = EE_F(600, 32);
  const filas = [[]]; let w = 0;
  items.forEach(it => {
    const iw = x.measureText(it).width + 52;
    if (w && w + 16 + iw > ancho) { filas.push([]); w = 0; }
    filas[filas.length - 1].push({ it, iw }); w += (w ? 16 : 0) + iw;
  });
  return filas.filter(f => f.length);
}
function _eePintarPastillas(x, filas, top) {
  x.font = EE_F(600, 32); x.textAlign = 'center';
  filas.forEach((f, r) => {
    const total = f.reduce((s, p) => s + p.iw, 0) + (f.length - 1) * 16;
    let px = (EE_W - total) / 2;
    const py = top + r * 76;
    f.forEach(p => {
      x.fillStyle = 'rgba(255,255,255,.13)';
      _eeRedondo(x, px, py, p.iw, 60, 30); x.fill();
      x.strokeStyle = 'rgba(255,255,255,.22)'; x.lineWidth = 2;
      _eeRedondo(x, px, py, p.iw, 60, 30); x.stroke();
      x.fillStyle = '#fff';
      x.fillText(p.it, px + p.iw / 2, py + 41);
      px += p.iw + 16;
    });
  });
}

// El precio: "$" chico y el número grande, en amarillo
function _eePintarPrecio(x, e, base) {
  const num = Math.round(e.precio).toLocaleString('es-AR');
  const sim = e.moneda === 'usd' ? 'U$S' : '$';
  let t = 132;
  for (; t > 80; t -= 4) { x.font = EE_F(900, t); if (x.measureText(num).width + t * 0.75 < 900) break; }
  x.font = EE_F(900, t);
  const wn = x.measureText(num).width;
  x.font = EE_F(800, Math.round(t * 0.45));
  const ws = x.measureText(sim).width + 14;
  const ini = (EE_W - wn - ws) / 2;
  x.fillStyle = EE_ORO; x.textAlign = 'left';
  x.fillText(sim, ini, base - t * 0.42);
  x.font = EE_F(900, t);
  x.fillText(num, ini + ws, base);
  return t;
}

async function eeDibujar(pieza, opciones) {
  // Compatibilidad: también acepta un equipo suelto (la primera foto)
  if (pieza && !pieza.e) pieza = { e: pieza, foto: (pieza.fotos || [])[0] || null, n: 0, total: Math.max(1, (pieza.fotos || []).length) };
  const conPrecio = !opciones || opciones.precio !== false;
  const e = pieza.e, t = eeTextos(e);
  await _eeFuentes();
  const cv = document.createElement('canvas');
  cv.width = EE_W; cv.height = EE_H;
  const x = cv.getContext('2d');
  x.textBaseline = 'alphabetic';
  const foto = await _eeFoto(pieza.foto);

  _eeFondo(x, foto);
  await _eeEncabezado(x, t);

  const BOTON = 1630;
  const muestraPrecio = conPrecio && !!e.precio;

  if (pieza.n === 0) {
    // ── PORTADA: todo el detalle. Se arma de abajo para arriba y la foto
    // ocupa lo que sobre: así un nombre largo no pisa nada.
    let y = BOTON - 46;
    let precioTop;
    if (muestraPrecio) {
      precioTop = y - 112;
    } else {
      precioTop = y - 40;
    }
    const items = [];
    if (e.capacidad) items.push(e.capacidad);
    if (e.colores && e.colores.length) items.push(e.colores.join(' · '));
    if (e.bateria) items.push(`Batería ${e.bateria}%`);
    if (e.garantiaMeses) items.push(`Garantía ${e.garantiaMeses} ${e.garantiaMeses === 1 ? 'mes' : 'meses'}`);
    const filas = _eePastillas(x, items, 940);
    const pastTop = precioTop - 44 - (filas.length ? filas.length * 76 - 16 : 0);

    const repite = e.marca && _eeNorm(e.modelo).startsWith(_eeNorm(e.marca));
    const modelo = (repite ? e.modelo.slice(e.marca.length).trim() : e.modelo) || e.marca || 'Celular';
    const tn = _eeEntra(x, modelo, 900, 112, 70, 940);
    const ren = _eeRenglones(x, modelo, 940);
    const altoRen = Math.round(tn * 1.04);
    const modeloBase = pastTop - (filas.length ? 40 : 0);
    const modeloTop = modeloBase - tn * 0.78 - (ren.length - 1) * altoRen;
    const marcaBase = modeloTop - 26;
    const puntosY = (e.marca ? marcaBase - 34 : modeloTop) - 44;
    const fotoBottom = puntosY - 34;

    _eeDegradeAbajo(x, Math.max(700, fotoBottom - 260));
    const caja = _eeFotoNitida(x, foto, 290, fotoBottom);
    if (t.unidades && caja) {
      x.font = EE_F(800, 30);
      const uw = x.measureText(t.unidades).width + 48;
      x.fillStyle = EE_ORO;
      _eeRedondo(x, caja.fx + 24, caja.fy + 24, uw, 58, 29); x.fill();
      x.fillStyle = '#04121f'; x.textAlign = 'center';
      x.fillText(t.unidades, caja.fx + 24 + uw / 2, caja.fy + 64);
    }
    _eePuntos(x, 0, pieza.total, puntosY);

    x.textAlign = 'center';
    if (e.marca) {
      x.fillStyle = '#7dd3fc';
      x.font = EE_F(800, 34);
      if ('letterSpacing' in x) x.letterSpacing = '10px';
      x.fillText(e.marca.toUpperCase(), EE_W / 2 + 5, marcaBase);
      if ('letterSpacing' in x) x.letterSpacing = '0px';
    }
    x.fillStyle = '#fff';
    x.font = EE_F(900, tn);
    ren.forEach((r, i) => x.fillText(r, EE_W / 2, modeloTop + tn * 0.78 + i * altoRen));
    if (filas.length) _eePintarPastillas(x, filas, pastTop);

    if (muestraPrecio) _eePintarPrecio(x, e, y);
    else {
      x.fillStyle = '#fff'; x.textAlign = 'center';
      x.font = EE_F(700, 44);
      x.fillText('Consultá el precio por WhatsApp', EE_W / 2, y);
    }
  } else {
    // ── GALERÍA: la foto bien grande y lo justo abajo
    const fotoBottom = 1360;
    _eeDegradeAbajo(x, 1180);
    const caja = _eeFotoNitida(x, foto, 290, fotoBottom);
    // Los puntitos pegados a la foto (si es apaisada, queda mucho aire abajo)
    _eePuntos(x, pieza.n, pieza.total, caja ? caja.fy + caja.h + 48 : fotoBottom + 44);
    x.textAlign = 'center'; x.fillStyle = '#fff';
    const nombre = t.nombre;
    _eeEntra(x, nombre, 800, 64, 40, 940);
    x.fillText(nombre, EE_W / 2, 1490);
    if (muestraPrecio) {
      x.fillStyle = EE_ORO;
      _eeEntra(x, t.precio, 900, 60, 40, 940);
      x.fillText(t.precio, EE_W / 2, 1570);
    } else {
      x.fillStyle = 'rgba(255,255,255,.8)';
      x.font = EE_F(600, 38);
      x.fillText([e.condicion, e.garantiaMeses ? `garantía ${e.garantiaMeses} ${e.garantiaMeses === 1 ? 'mes' : 'meses'}` : ''].filter(Boolean).join(' · '), EE_W / 2, 1562);
    }
  }
  _eeBotonWa(x, BOTON);

  return await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.92));
}

function _eeNombreArchivo(pieza, i) {
  const e = pieza.e || pieza;
  const base = eeTextos(e).nombre.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'equipo';
  const foto = pieza.total > 1 ? `-foto${pieza.n + 1}` : '';
  return `estado-${String(i + 1).padStart(2, '0')}-${base}${foto}.jpg`;
}

// ── Mandarlas ─────────────────────────────────────────────
// En el celular: el menú de compartir (WhatsApp → "Mi estado"). En la compu:
// a una carpeta, para elegirlas desde WhatsApp de escritorio.
async function eeCompartir(equipos, btn, opciones) {
  const piezas = eePiezas(equipos).slice(0, EE_MAX);
  if (!piezas.length) { toast('No hay equipos para armar', 'info'); return; }
  const txt = btn ? btn.textContent : '';
  const archivos = [];
  try {
    if (btn) btn.disabled = true;
    for (let i = 0; i < piezas.length; i++) {
      if (btn) btn.textContent = `Armando ${i + 1} de ${piezas.length}…`;
      const blob = await eeDibujar(piezas[i], opciones);
      if (blob) archivos.push(new File([blob], _eeNombreArchivo(piezas[i], i), { type: 'image/jpeg' }));
    }
  } catch (e) {
    console.error('[estado-equipos] armar:', e);
    toast('No se pudieron armar las imágenes', 'error');
    return;
  } finally { if (btn) { btn.disabled = false; btn.textContent = txt; } }


  const esCompu = typeof _waEsCompu === 'function' ? _waEsCompu() : true;
  if (!esCompu && navigator.canShare && navigator.canShare({ files: archivos })) {
    // El celular solo abre "compartir" pegado a un toque. Armar las imágenes
    // tarda unos segundos y para entonces ese toque ya "venció" (el teléfono
    // lo rechaza sin avisar). Por eso, ya listas, se pide un toque más.
    _eeListo(archivos);
    return;
  }
  // Compu: WhatsApp de escritorio ya deja subir estados (Novedades → ➕),
  // pero hay que elegir las fotos de una carpeta. Antes se descargaban de a
  // una y quedaban mezcladas en Descargas; ahora van juntas a una carpeta.
  _eeListoPc(archivos);
}

function _eeDescargar(archivos) {
  archivos.forEach((f, i) => setTimeout(() => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, i * 300));   // de a una: Chrome frena muchas descargas juntas
}

// Las guarda en UNA carpeta (Chrome se acuerda de cuál fue la última vez).
// Antes de guardar borra los estados viejos de esa carpeta: si no, al
// elegirlas en WhatsApp se mezclan los de hoy con equipos ya vendidos.
async function _eeGuardarEnCarpeta(archivos) {
  const dir = await window.showDirectoryPicker({ id: 'tp-estados', mode: 'readwrite', startIn: 'pictures' });
  const viejos = [];
  for await (const [nombre, h] of dir.entries()) {
    if (h.kind === 'file' && /^estado-\d+-.*\.jpg$/.test(nombre)) viejos.push(nombre);
  }
  for (const n of viejos) { try { await dir.removeEntry(n); } catch (e) { console.warn('[estado-equipos] borrar viejo:', n, e); } }
  for (const f of archivos) {
    const fh = await dir.getFileHandle(f.name, { create: true });
    const w = await fh.createWritable();
    await w.write(f); await w.close();
  }
  return dir.name;
}

function _eeListoPc(archivos) {
  _eeEstilos();
  eeCerrar();
  const n = archivos.length;
  const carpeta = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  const ov = document.createElement('div');
  ov.className = 'ee-ov'; ov.id = 'ee-ov'; ov.onclick = eeCerrar;
  const m = document.createElement('div');
  m.className = 'ee-mod'; m.id = 'ee-mod';
  m.innerHTML = `<div class="ee-hd"><span>✅ ${n === 1 ? 'Listo' : n + ' listos'}</span><button type="button" class="ee-x" onclick="eeCerrar()">✕</button></div>
    <ol class="ee-pasos">
      <li>${carpeta ? 'Guardalas en una carpeta (la primera vez creá una, por ejemplo <b>Estados TechPoint</b>; después se acuerda sola).'
                    : 'Se bajan a la carpeta <b>Descargas</b>.'}</li>
      <li>En <b>WhatsApp</b> de la compu: <b>Novedades</b> (el circulito) → <b>➕</b> → <b>Fotos y videos</b>.</li>
      <li>Entrá a esa carpeta, apretá <b>Ctrl+A</b> para elegir todas y <b>Enviar</b>.</li>
    </ol>
    <button type="button" class="ee-ir" id="ee-guardar">${carpeta ? '💾 Guardar en la carpeta' : '⬇️ Descargar'}</button>
    <button type="button" class="ee-ir ee-ir--2" id="ee-wa">🟢 Abrir WhatsApp</button>
    <p class="ee-ayuda" style="margin-top:10px">¿No ves el ➕ en Novedades? Actualizá WhatsApp desde Microsoft Store: la opción de subir estados desde la compu se está habilitando de a poco.</p>`;
  document.body.appendChild(ov);
  document.body.appendChild(m);
  document.getElementById('ee-guardar').onclick = async () => {
    if (!carpeta) { _eeDescargar(archivos); toast(`⬇️ ${n} imagen${n === 1 ? '' : 'es'} en Descargas`, 'success'); return; }
    try {
      const nom = await _eeGuardarEnCarpeta(archivos);
      toast(`💾 ${n} imagen${n === 1 ? '' : 'es'} en la carpeta "${nom}"`, 'success');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      console.error('[estado-equipos] carpeta:', e);
      _eeDescargar(archivos);
      toast('No se pudo usar la carpeta: van a Descargas', 'info');
    }
  };
  // La app de escritorio se abre con su link propio (lo mismo que waAbrir)
  document.getElementById('ee-wa').onclick = () => { location.href = 'whatsapp://'; };
}

function _eeListo(archivos) {
  _eeEstilos();
  eeCerrar();
  const n = archivos.length;
  const ov = document.createElement('div');
  ov.className = 'ee-ov'; ov.id = 'ee-ov'; ov.onclick = eeCerrar;
  const m = document.createElement('div');
  m.className = 'ee-mod'; m.id = 'ee-mod';
  m.innerHTML = `<div class="ee-hd"><span>✅ ${n === 1 ? 'Listo' : n + ' listos'}</span><button type="button" class="ee-x" onclick="eeCerrar()">✕</button></div>
    <p class="ee-ayuda">Tocá el botón, elegí <b>WhatsApp</b> y arriba de todo <b>"Mi estado"</b>.</p>
    <button type="button" class="ee-ir" id="ee-compartir">📲 Compartir en WhatsApp</button>`;
  document.body.appendChild(ov);
  document.body.appendChild(m);
  document.getElementById('ee-compartir').onclick = async () => {
    try { await navigator.share({ files: archivos }); eeCerrar(); }
    catch (e) {
      if (e && e.name === 'AbortError') return;
      console.error('[estado-equipos] compartir:', e);
      toast('No se pudo abrir compartir: ' + (e.message || e), 'error');
    }
  };
}

// Un equipo solo (botón 📲 de la ficha): el mismo cuadro, con ese equipo
// solo, para elegir con o sin precio igual que con todos.
function eeEstadoDe(id) {
  const p = (typeof STOCK !== 'undefined') ? STOCK.find(x => x.id === id) : null;
  if (!p) return;
  eeAbrir([eeDesdeStock(p)]);
}

// ── El cuadro para elegir cuáles ──────────────────────────
let _eeLista = [];
// Alan: "consultarme si quiero que esté el precio o no". No se recuerda a
// propósito: cada vez se elige (a veces conviene que pregunten).
let _eePrecio = null;

function _eeEstilos() {
  if (document.getElementById('ee-estilos')) return;
  const st = document.createElement('style');
  st.id = 'ee-estilos';
  st.textContent = `
.ee-ov{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000}
.ee-mod{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(480px,94vw);max-height:88vh;
  overflow:auto;background:var(--card,#fff);color:var(--text,#111);border-radius:16px;padding:16px;z-index:2001;
  box-shadow:0 20px 50px rgba(0,0,0,.3)}
.ee-hd{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:17px;margin-bottom:6px}
.ee-x{background:none;border:0;font-size:20px;cursor:pointer;color:inherit}
.ee-ayuda{font-size:13px;opacity:.75;margin:0 0 10px}
.ee-preg{font-weight:700;font-size:14px;margin:6px 0 6px}
.ee-seg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.ee-seg button{padding:12px 8px;border-radius:12px;border:2px solid rgba(128,128,128,.3);background:none;color:inherit;font-weight:700;font-size:14px;cursor:pointer}
.ee-seg button.on{border-color:#25D366;background:rgba(37,211,102,.12)}
.ee-fila{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(128,128,128,.18);cursor:pointer}
.ee-fila img,.ee-fila .ee-sf{width:44px;height:44px;border-radius:8px;object-fit:cover;background:#eef;flex:none;display:flex;align-items:center;justify-content:center}
.ee-fila b{display:block;font-size:14px}
.ee-fila small{opacity:.7;font-size:12px}
.ee-fila input{width:20px;height:20px;flex:none}
.ee-todos{font-size:13px;background:none;border:0;color:#2563eb;cursor:pointer;padding:4px 0;margin-bottom:4px}
.ee-ir{width:100%;margin-top:12px;padding:14px;border:0;border-radius:12px;background:#25D366;color:#fff;font-weight:700;font-size:16px;cursor:pointer}
.ee-ir:disabled{opacity:.6}
.ee-ir--2{background:#0f2b52}
.ee-pasos{margin:4px 0 6px 18px;padding:0;font-size:14px;line-height:1.45}
.ee-pasos li{margin-bottom:6px}`;
  document.head.appendChild(st);
}

function eeAbrir(soloEstos) {
  if (typeof closeSheet === 'function') closeSheet();
  const uno = Array.isArray(soloEstos);
  _eeLista = uno ? soloEstos.filter(Boolean) : eeParaEstados(typeof STOCK !== 'undefined' ? STOCK : []);
  _eePrecio = null;
  if (!_eeLista.length) {
    toast('No hay equipos publicados en la página (y sin vender) para armar estados', 'info');
    return;
  }
  _eeEstilos();
  eeCerrar();
  const esc2 = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Se marcan de arriba para abajo mientras entren (30 imágenes por vez)
  let usadas = 0;
  const filas = _eeLista.map((e, i) => {
    const t = eeTextos(e);
    const n = Math.max(1, e.fotos.length);
    const marcar = usadas + n <= EE_MAX;
    if (marcar) usadas += n;
    const fotosTxt = e.fotos.length ? `${e.fotos.length} foto${e.fotos.length === 1 ? '' : 's'}` : 'sin foto';
    return `<label class="ee-fila">
      <input type="checkbox" data-i="${i}" ${marcar ? 'checked' : ''} onchange="eeContar()">
      ${e.fotos[0] ? `<img src="${esc2(e.fotos[0])}" alt="" loading="lazy">` : '<span class="ee-sf">📱</span>'}
      <span><b>${esc2(t.nombre)}</b><small>${esc2(t.precio)} · ${fotosTxt}${t.unidades ? ' · ' + esc2(t.unidades) : ''}</small></span>
    </label>`;
  }).join('');
  const ov = document.createElement('div');
  ov.className = 'ee-ov'; ov.id = 'ee-ov'; ov.onclick = eeCerrar;
  const m = document.createElement('div');
  m.className = 'ee-mod'; m.id = 'ee-mod';
  m.innerHTML = `<div class="ee-hd"><span>📲 ${uno ? 'Estado de este equipo' : 'Equipos para los estados'}</span><button type="button" class="ee-x" onclick="eeCerrar()">✕</button></div>
    <p class="ee-ayuda">Sale una imagen por cada foto del equipo: la primera con todos los datos y las otras para mostrarlo de todos lados.</p>
    <div class="ee-preg">¿Va con el precio?</div>
    <div class="ee-seg">
      <button type="button" id="ee-p-si" onclick="eeConPrecio(true)">💲 Con precio</button>
      <button type="button" id="ee-p-no" onclick="eeConPrecio(false)">🤫 Sin precio</button>
    </div>
    ${uno ? '' : '<button type="button" class="ee-todos" onclick="eeTodos()">Marcar / desmarcar todos</button>'}
    <div id="ee-filas"${uno ? ' style="display:none"' : ''}>${filas}</div>
    <button type="button" class="ee-ir" id="ee-ir" onclick="eeIr(this)"></button>`;
  document.body.appendChild(ov);
  document.body.appendChild(m);
  eeContar();
}

function eeConPrecio(v) {
  _eePrecio = !!v;
  document.getElementById('ee-p-si')?.classList.toggle('on', _eePrecio === true);
  document.getElementById('ee-p-no')?.classList.toggle('on', _eePrecio === false);
  eeContar();
}

function eeCerrar() {
  document.getElementById('ee-ov')?.remove();
  document.getElementById('ee-mod')?.remove();
}

function _eeMarcados() {
  return [...document.querySelectorAll('#ee-filas input:checked')].map(c => _eeLista[+c.dataset.i]).filter(Boolean);
}

function eeContar() {
  const eqs = _eeMarcados();
  const n = eeCuantasImagenes(eqs);
  const b = document.getElementById('ee-ir');
  if (!b) return;
  b.disabled = !eqs.length || n > EE_MAX || _eePrecio === null;
  b.textContent = _eePrecio === null ? 'Elegí arriba si va con precio'
    : n > EE_MAX ? `Máximo ${EE_MAX} imágenes por vez (son ${n}): sacá algún equipo`
    : `📲 Armar ${n} imagen${n === 1 ? '' : 'es'}${eqs.length > 1 ? ` (${eqs.length} equipos)` : ''}`;
}

function eeTodos() {
  const cs = [...document.querySelectorAll('#ee-filas input')];
  const marcar = cs.some(c => !c.checked);
  let usadas = 0;
  cs.forEach(c => {
    const e = _eeLista[+c.dataset.i];
    const n = Math.max(1, (e && e.fotos.length) || 0);
    c.checked = marcar && usadas + n <= EE_MAX;
    if (c.checked) usadas += n;
  });
  eeContar();
}

async function eeIr(btn) {
  if (_eePrecio === null) return;
  await eeCompartir(_eeMarcados(), btn, { precio: _eePrecio });
}
