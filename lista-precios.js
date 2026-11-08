// ══════════════════════════════════════════════════════════════
//  📋 LISTA DE PRECIOS PARA LOS ESTADOS
// ══════════════════════════════════════════════════════════════
//  Alan mandó la historia de otro local (una sola imagen con todo el stock,
//  un renglón por equipo: "iPhone 13 | 128GB | 100% | 360 USD") y pidió
//  "armar algo así con los equipos que tenemos".
//
//  Sale del STOCK que la app ya tiene en memoria (cero lecturas). Los usados
//  van en la lista, agrupados por modelo; los nuevos, en un recuadro aparte
//  ("¡Nuevos en caja!"). Si no entran en una imagen, se parten en varias.
//
//  Usa las herramientas de estado-equipos.js (fondo, letras, compartir al
//  celu / guardar en la compu), así se sube igual que los otros estados.
'use strict';

const LP_UNIDADES_PAG = 28;      // renglones que entran en una imagen (con la letra más chica)

// ── Qué equipos van ───────────────────────────────────────
// En stock = sin vender, sin reservar. `soloPublicados`: solo los que están
// en la página de equipos.
function lpEquipos(stock, opciones) {
  const soloPub = !!(opciones && opciones.soloPublicados);
  const grupos = new Map();
  for (const p of (stock || [])) {
    if (!p || p.vendido || p.reservado || p.eliminado) continue;
    if (soloPub && !p.publicar) continue;
    if (!p.marca && !p.modelo) continue;
    const e = eeDesdeStock(p);
    // Para la lista, el precio que se muestra es el cargado aunque la página
    // lo esconda ("consultar precio" es una decisión de la página)
    const k = [e.marca, e.modelo, e.capacidad, e.condicion, e.precio, e.moneda, e.bateria].map(_eeNorm).join('|');
    const g = grupos.get(k);
    if (g) {
      g.unidades++;
      if (!g.fotos.length && e.fotos.length) g.fotos = e.fotos;
      if (e.color && !g.colores.includes(e.color)) g.colores.push(e.color);
    } else { e._k = k; grupos.set(k, e); }
  }
  return [...grupos.values()];
}

// ── Filtros: qué entra en la imagen ───────────────────────
// Alan (08/11): "fijate que haya filtros para seleccionar qué hacer en la
// imagen". Se elige por marca, usados/nuevos, y se pueden sacar equipos
// sueltos. `f` = { marcasOff: [...], usados, nuevos, sacados: [claves] }
function lpMarca(e) { return String(e.marca || 'Otros').trim() || 'Otros'; }
function lpMarcas(lista) {
  const n = {};
  (lista || []).forEach(e => { const m = lpMarca(e); n[m] = (n[m] || 0) + 1; });
  return Object.keys(n).sort((a, b) => (_lpMarcaOrden(a) - _lpMarcaOrden(b)) || a.localeCompare(b)).map(m => ({ marca: m, n: n[m] }));
}
function lpFiltrar(lista, f) {
  const o = f || {};
  const off = new Set((o.marcasOff || []).map(_eeNorm));
  const sac = new Set(o.sacados || []);
  return (lista || []).filter(e =>
    !off.has(_eeNorm(lpMarca(e))) &&
    (e.condicion === 'Nuevo' ? o.nuevos !== false : o.usados !== false) &&
    !sac.has(e._k));
}

// Apple primero (es lo que más se busca), después las marcas grandes y el resto
const LP_MARCAS = ['apple', 'samsung', 'motorola', 'xiaomi'];
function _lpMarcaOrden(m) { const i = LP_MARCAS.indexOf(_eeNorm(m)); return i < 0 ? 99 : i; }
function _lpCapGB(c) {
  const m = String(c || '').match(/(\d+)\s*(GB|TB)/i);
  return m ? Number(m[1]) * (/tb/i.test(m[2]) ? 1024 : 1) : 0;
}
// Lo que separa un grupo del otro (con un hueco): la marca y, en iPhone, la
// generación ("iPhone 13", "13 Pro" y "13 Pro Max" juntos), como en la
// historia que mandó Alan. En las otras marcas no: con un modelo distinto
// en cada renglón quedaría un hueco entre cada uno.
function lpFamilia(e) {
  const marca = _eeNorm(e.marca);
  const mod = _eeNorm(e.modelo);
  if (/apple/.test(marca) || /iphone/.test(mod)) {
    const n = mod.match(/\d+/);
    return 'apple|' + (n ? n[0] : mod);
  }
  return marca;
}

function lpOrdenar(lista) {
  return (lista || []).slice().sort((a, b) =>
    (_lpMarcaOrden(a.marca) - _lpMarcaOrden(b.marca)) ||
    _eeNorm(a.marca).localeCompare(_eeNorm(b.marca)) ||
    _eeNorm(a.modelo).localeCompare(_eeNorm(b.modelo), 'es', { numeric: true }) ||
    (_lpCapGB(a.capacidad) - _lpCapGB(b.capacidad)) ||
    ((a.bateria || 101) - (b.bateria || 101)) ||
    ((a.precio || 0) - (b.precio || 0)));
}

// El nombre corto: "iPhone 13" y no "Apple iPhone 13"
function lpNombre(e) {
  const mod = String(e.modelo || '').trim();
  const repite = e.marca && _eeNorm(mod).startsWith(_eeNorm(e.marca));
  if (repite || /iphone|ipad/i.test(mod) || !e.marca) return mod || e.marca;
  return `${e.marca} ${mod}`;
}

function lpPrecio(e) {
  if (!e.precio) return 'Consultar';
  return e.moneda === 'usd'
    ? `${Math.round(e.precio).toLocaleString('es-AR')} USD`
    : `$${Math.round(e.precio).toLocaleString('es-AR')}`;
}

// Un renglón: "iPhone 13 | 128GB | 🔋100% | 360 USD". `mostrar` elige los
// datos: { cap, bat, color } (por defecto capacidad y batería, sin color).
const LP_MOSTRAR_DEF = { cap: true, bat: true, color: false };
function lpRenglon(e, conPrecio, mostrar) {
  const m = Object.assign({}, LP_MOSTRAR_DEF, mostrar || {});
  const partes = [lpNombre(e)];
  if (m.cap && e.capacidad) partes.push(e.capacidad.replace(/\s+/g, ''));
  if (m.color && e.colores && e.colores.length) partes.push(e.colores.join('/'));
  if (m.bat && e.condicion !== 'Nuevo' && e.bateria) partes.push(`🔋${e.bateria}%`);
  if (conPrecio) partes.push(lpPrecio(e));
  return partes.join(' | ');
}

// La lista armada: usados con un hueco entre familias, y los nuevos aparte
function lpArmar(lista, conPrecio, mostrar) {
  const orden = lpOrdenar(lista);
  const usados = [], nuevos = [];
  let fam = null;
  orden.forEach(e => {
    if (e.condicion === 'Nuevo') { nuevos.push(lpRenglon(e, conPrecio, mostrar)); return; }
    const f = lpFamilia(e);
    usados.push({ txt: lpRenglon(e, conPrecio, mostrar), hueco: fam !== null && f !== fam });
    fam = f;
  });
  return { usados, nuevos };
}

// Si no entra todo en una imagen, se parte. Los nuevos van en la última.
// Si no entra todo en una imagen, se parte en las que hagan falta, PAREJO
// (antes de repartir así, la última podía quedar con un renglón solo). Los
// nuevos van en la última. "Peso" = renglones: un hueco suma 0,6 y el
// recuadro de los nuevos, su título y sus renglones (más altos).
function lpPaginas(armado) {
  const { usados, nuevos } = armado;
  const CAP = LP_UNIDADES_PAG;
  const pesoN = nuevos.length ? nuevos.length * 1.6 + 3.5 : 0;
  const pesoU = usados.reduce((t, r, i) => t + (i && r.hueco ? 1.6 : 1), 0);
  const npag = Math.max(1, Math.ceil((pesoU + pesoN) / CAP));
  const objetivo = (pesoU + pesoN) / npag;
  const pags = [];
  let act = [], peso = 0;
  for (const r of usados) {
    const p = act.length && r.hueco ? 1.6 : 1;
    const corta = act.length && (peso + p > CAP || (pags.length < npag - 1 && peso + p > objetivo + 0.5));
    if (corta) { pags.push({ usados: act, nuevos: [] }); act = []; peso = 0; }
    // Arriba de todo de una imagen no va hueco
    act.push(act.length ? r : { ...r, hueco: false });
    peso += act.length === 1 ? 1 : p;
  }
  // Los nuevos: en la última si entran; si no, en las que hagan falta
  const maxN = Math.floor((CAP - 3.5) / 1.6);
  const resto = nuevos.slice();
  while (resto.length) {
    const lugar = Math.min(maxN, Math.floor((CAP - peso - 3.5) / 1.6));
    if (lugar <= 0) { pags.push({ usados: act, nuevos: [] }); act = []; peso = 0; continue; }
    pags.push({ usados: act, nuevos: resto.splice(0, lugar) });
    act = []; peso = 0;
  }
  if (act.length) pags.push({ usados: act, nuevos: [] });
  return pags;
}

function lpTitulo(lista) {
  return lista.length && lista.every(e => /apple/i.test(e.marca) || /iphone/i.test(e.modelo)) ? 'STOCK IPHONES' : 'STOCK CELULARES';
}

// ── El dibujo ─────────────────────────────────────────────
// Una cinta negra de lado a lado, como la de la historia que mandó Alan
// Alan (08/11): "¿se le puede agregar algunos emojis y cambiar el fondo?"
const LP_CINTA = '✅ GARANTÍA  |  🔄 TOMAMOS TU USADO  |  💳 CUOTAS  |  ✅ GARANTÍA';

// Los fondos para elegir. "foto" es el de antes: una foto de los equipos
// desenfocada. Los otros son de color, con dos manchas de luz para que no
// sea un color liso. `acento` es el color del título de los nuevos.
const LP_FONDOS = {
  foto:    { lbl: '📷 Foto',   muestra: 'linear-gradient(135deg,#6b7280,#1f2937)', acento: '#7dd3fc' },
  azul:    { lbl: 'Azul',      a: '#0b3a7a', b: '#020a1c', luces: ['rgba(56,189,248,.38)', 'rgba(37,99,235,.40)'], acento: '#7dd3fc' },
  negro:   { lbl: 'Negro',     a: '#1d1d1f', b: '#000000', luces: ['rgba(250,204,21,.20)', 'rgba(250,204,21,.12)'], acento: '#FFD23F' },
  violeta: { lbl: 'Violeta',   a: '#5b21b6', b: '#12052b', luces: ['rgba(236,72,153,.38)', 'rgba(139,92,246,.40)'], acento: '#f0abfc' },
  verde:   { lbl: 'Verde',     a: '#065f46', b: '#01140f', luces: ['rgba(52,211,153,.32)', 'rgba(16,185,129,.28)'], acento: '#6ee7b7' },
};
const LP_FONDO_KEY = 'lpFondo';
function lpFondoGuardado() {
  try { const f = localStorage.getItem(LP_FONDO_KEY); if (LP_FONDOS[f]) return f; } catch {}
  return 'foto';
}

function _lpFondo(x, fondo, foto) {
  const f = LP_FONDOS[fondo] || LP_FONDOS.foto;
  if (!f.a) {                                   // la foto de los equipos
    _eeFondo(x, foto);
    x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(0, 0, EE_W, EE_H);
    return;
  }
  const g = x.createLinearGradient(0, 0, EE_W * 0.4, EE_H);
  g.addColorStop(0, f.a); g.addColorStop(1, f.b);
  x.fillStyle = g; x.fillRect(0, 0, EE_W, EE_H);
  [[160, 520, 620, f.luces[0]], [960, 1380, 720, f.luces[1]]].forEach(([cx, cy, r, col]) => {
    const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = rg; x.fillRect(0, 0, EE_W, EE_H);
  });
  // Unas rayas finitas en diagonal, apenas se ven: le dan textura
  x.save();
  x.strokeStyle = 'rgba(255,255,255,.035)'; x.lineWidth = 2;
  for (let d = -EE_H; d < EE_W; d += 46) { x.beginPath(); x.moveTo(d, 0); x.lineTo(d + EE_H, EE_H); x.stroke(); }
  x.restore();
}

function _lpCinta(x, y) {
  x.fillStyle = 'rgba(0,0,0,.88)';
  x.fillRect(0, y, EE_W, 70);
  x.fillStyle = '#fff'; x.textAlign = 'center';
  _eeEntra(x, LP_CINTA, 800, 36, 24, EE_W - 40);
  x.fillText(LP_CINTA, EE_W / 2, y + 48);
}

function _lpTexto(x, txt, y, peso, px) {
  x.font = EE_F(peso, px);
  x.save();
  x.shadowColor = 'rgba(0,0,0,.75)'; x.shadowBlur = 10; x.shadowOffsetY = 3;
  x.fillText(txt, EE_W / 2, y);
  x.restore();
}

async function lpDibujar(pag, opciones) {
  const o = opciones || {};
  await _eeFuentes();
  const cv = document.createElement('canvas');
  cv.width = EE_W; cv.height = EE_H;
  const x = cv.getContext('2d');
  x.textBaseline = 'alphabetic';
  // El fondo elegido; con "foto", una de los equipos desenfocada (si hay)
  const fondo = LP_FONDOS[o.fondo] ? o.fondo : 'foto';
  const foto = fondo === 'foto' && o.foto ? await _eeFoto(o.foto) : null;
  _lpFondo(x, fondo, foto);

  // Encabezado: el local chiquito, el título grande y la cinta
  x.textAlign = 'center'; x.fillStyle = 'rgba(255,255,255,.85)';
  _lpTexto(x, 'TECHPOINT · CASEROS', 196, 800, 34);
  x.fillStyle = '#fff';
  const tit = `📱 ${o.titulo || 'STOCK CELULARES'} 📱`;
  const tt = _eeEntra(x, tit, 900, 132, 70, 980);
  if ('letterSpacing' in x) x.letterSpacing = '4px';
  _lpTexto(x, tit, 330, 900, tt);
  if ('letterSpacing' in x) x.letterSpacing = '0px';
  _lpCinta(x, 372);
  if (o.total > 1) {
    x.textAlign = 'right'; x.fillStyle = 'rgba(255,255,255,.8)'; x.font = EE_F(700, 30);
    x.fillText(`${o.n + 1}/${o.total}`, EE_W - 40, 196);
    x.textAlign = 'center';
  }

  // Abajo: los datos del local y la cinta de nuevo
  const biz = (typeof BIZ_DATA !== 'undefined' && BIZ_DATA) ? BIZ_DATA : {};
  const dir = String(biz.dir || 'Urquiza 4741, Local 22').trim() + (/caseros/i.test(biz.dir || '') ? '' : ' · Caseros');
  const tel = biz.tel || '11 7239-2511';
  x.fillStyle = '#fff';
  const lin1 = `📍 ${dir}`;
  _lpTexto(x, lin1, 1592, 800, _eeEntra(x, lin1, 800, 36, 24, 980));
  x.fillStyle = 'rgba(255,255,255,.9)';
  const lin2 = `💬 ${tel}  ·  🕘 Lunes a sábado de 9:30 a 19:30`;
  _lpTexto(x, lin2, 1640, 700, _eeEntra(x, lin2, 700, 32, 22, 980));
  _lpCinta(x, 1680);

  // El recuadro de los nuevos (abajo, arriba de los datos)
  let limite = 1540;
  if (pag.nuevos.length) {
    const fs = 40, lh = 54;
    const h = 96 + pag.nuevos.length * lh + 20;
    const top = limite - h;
    x.save();
    x.fillStyle = 'rgba(0,0,0,.35)';
    _eeRedondo(x, 120, top, 840, h, 34); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.92)'; x.lineWidth = 4;
    _eeRedondo(x, 120, top, 840, h, 34); x.stroke();
    x.restore();
    x.fillStyle = (LP_FONDOS[fondo] || LP_FONDOS.foto).acento;
    if ('letterSpacing' in x) x.letterSpacing = '3px';
    _lpTexto(x, '🎁 ¡NUEVOS EN CAJA! 🎁', top + 68, 900, _eeEntra(x, '🎁 ¡NUEVOS EN CAJA! 🎁', 900, 46, 30, 780));
    if ('letterSpacing' in x) x.letterSpacing = '0px';
    x.fillStyle = '#fff';
    pag.nuevos.forEach((r, i) => {
      const t = _eeEntra(x, r, 700, fs, 26, 780);
      _lpTexto(x, r, top + 96 + (i + 1) * lh - 14, 700, t);
    });
    limite = top - 30;
  }

  // Los renglones: la letra más grande con la que entran todos
  const filas = pag.usados;
  if (filas.length) {
    const arriba = 500, alto = limite - arriba;
    const huecos = filas.filter(f => f.hueco).length;
    let fs = 50;
    const mide = s => { x.font = EE_F(800, s); return Math.max(...filas.map(f => x.measureText(f.txt).width)); };
    while (fs > 28 && (filas.length * fs * 1.2 + huecos * fs * 0.7 > alto || mide(fs) > 990)) fs -= 2;
    const lh = fs * 1.2, gap = fs * 0.7;
    const total = filas.length * lh + huecos * gap;
    let y = arriba + Math.max(0, (alto - total) / 2) + fs;
    x.fillStyle = '#fff';
    filas.forEach(f => {
      if (f.hueco) y += gap;
      const t = _eeEntra(x, f.txt, 800, fs, 22, 1000);
      _lpTexto(x, f.txt, y, 800, t);
      y += lh;
    });
  }
  if (o.sinPrecio) {
    x.fillStyle = '#FFD23F';
    _lpTexto(x, '💬 Consultá precios por WhatsApp', limite + (pag.nuevos.length ? 0 : 6), 800, 38);
  }
  return await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.92));
}

// ── Armar y mandar ────────────────────────────────────────
async function lpCompartir(lista, conPrecio, btn, fondo, mostrar) {
  if (!lista.length) { toast('No hay equipos en stock para la lista', 'info'); return; }
  const pags = lpPaginas(lpArmar(lista, conPrecio, mostrar));
  const conFoto = lpOrdenar(lista).find(e => e.condicion === 'Nuevo' && e.fotos.length) || lpOrdenar(lista).find(e => e.fotos.length);
  const titulo = lpTitulo(lista);
  const txt = btn ? btn.textContent : '';
  const archivos = [];
  try {
    if (btn) btn.disabled = true;
    for (let i = 0; i < pags.length; i++) {
      if (btn) btn.textContent = `Armando ${i + 1} de ${pags.length}…`;
      const blob = await lpDibujar(pags[i], { titulo, n: i, total: pags.length, foto: conFoto ? conFoto.fotos[0] : null, sinPrecio: !conPrecio, fondo });
      // El nombre empieza con "estado-NN-": así la carpeta de la compu borra
      // la lista vieja al guardar la nueva (estado-equipos.js)
      if (blob) archivos.push(new File([blob], `estado-${String(i + 1).padStart(2, '0')}-lista-de-precios.jpg`, { type: 'image/jpeg' }));
    }
  } catch (e) {
    console.error('[lista-precios] armar:', e);
    toast('No se pudo armar la lista', 'error');
    return;
  } finally { if (btn) { btn.disabled = false; btn.textContent = txt; } }
  const esCompu = typeof _waEsCompu === 'function' ? _waEsCompu() : true;
  if (!esCompu && navigator.canShare && navigator.canShare({ files: archivos })) _eeListo(archivos);
  else _eeListoPc(archivos);
}

// ── El cuadro ─────────────────────────────────────────────
let _lpPrecio = null, _lpSoloPub = false, _lpFondoSel = null;
// Filtros (duran mientras la app está abierta; el precio se pregunta siempre)
let _lpMarcasOff = [], _lpUsados = true, _lpNuevos = true, _lpSacados = [];
let _lpMostrar = Object.assign({}, LP_MOSTRAR_DEF);

function _lpEstilos() {
  if (document.getElementById('lp-estilos')) return;
  const st = document.createElement('style');
  st.id = 'lp-estilos';
  st.textContent = `
.lp-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.lp-chip{padding:7px 12px;border-radius:999px;border:2px solid rgba(128,128,128,.3);background:none;color:inherit;font-size:13px;font-weight:700;cursor:pointer;opacity:.55}
.lp-chip.on{border-color:#25D366;background:rgba(37,211,102,.12);opacity:1}
.lp-uno summary{cursor:pointer;font-size:13px;font-weight:700;color:#2563eb;padding:4px 0;margin-bottom:6px}
.lp-uno label{display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px solid rgba(128,128,128,.15);font-size:13px;cursor:pointer}
.lp-uno input{width:18px;height:18px;flex:none}
.lp-uno .lp-sub{opacity:.6;font-size:12px}`;
  document.head.appendChild(st);
}

function lpAbrir() {
  if (typeof closeSheet === 'function') closeSheet();
  _lpPrecio = null;
  _eeEstilos();
  _lpEstilos();
  eeCerrar();
  const ov = document.createElement('div');
  ov.className = 'ee-ov'; ov.id = 'ee-ov'; ov.onclick = eeCerrar;
  const m = document.createElement('div');
  m.className = 'ee-mod'; m.id = 'ee-mod';
  m.innerHTML = `<div class="ee-hd"><span>📋 Lista de precios</span><button type="button" class="ee-x" onclick="eeCerrar()">✕</button></div>
    <p class="ee-ayuda">Una imagen para el estado con los equipos en stock, un renglón por equipo. Elegí abajo qué entra.</p>
    <div class="ee-preg">¿De dónde?</div>
    <div class="ee-seg">
      <button type="button" id="lp-todos" onclick="lpCuales(false)">📦 Todo el stock</button>
      <button type="button" id="lp-pub" onclick="lpCuales(true)">🌐 Los de la página</button>
    </div>
    <div id="lp-filtros"></div>
    <div class="ee-preg">¿Va con el precio?</div>
    <div class="ee-seg">
      <button type="button" id="lp-p-si" onclick="lpConPrecio(true)">💲 Con precio</button>
      <button type="button" id="lp-p-no" onclick="lpConPrecio(false)">🤫 Sin precio</button>
    </div>
    <div class="ee-preg">Fondo</div>
    <div class="lp-fondos" style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:6px">
      ${Object.entries(LP_FONDOS).map(([k, f]) => `<button type="button" id="lp-f-${k}" onclick="lpElegirFondo('${k}')"
        style="height:58px;border-radius:12px;border:3px solid transparent;cursor:pointer;color:#fff;font:700 11px inherit;text-shadow:0 1px 3px #000;
        background:${f.muestra || `radial-gradient(circle at 25% 30%, ${f.luces[0]}, transparent 60%), linear-gradient(160deg, ${f.a}, ${f.b})`}">${f.lbl}</button>`).join('')}
    </div>
    <button type="button" class="ee-ir" id="lp-ir" onclick="lpIr(this)"></button>`;
  document.body.appendChild(ov);
  document.body.appendChild(m);
  lpElegirFondo(_lpFondoSel || lpFondoGuardado());
  lpCuales(_lpSoloPub);
}

// Se recuerda en este aparato: si te gustó el violeta, la próxima sale violeta
function lpElegirFondo(k) {
  if (!LP_FONDOS[k]) return;
  _lpFondoSel = k;
  try { localStorage.setItem(LP_FONDO_KEY, k); } catch {}
  Object.keys(LP_FONDOS).forEach(f => {
    const b = document.getElementById('lp-f-' + f);
    if (b && b.style) b.style.borderColor = f === k ? '#25D366' : 'transparent';
  });
}

// Todos los del origen elegido (antes de los filtros)
function _lpBase() { return lpEquipos(typeof STOCK !== 'undefined' ? STOCK : [], { soloPublicados: _lpSoloPub }); }
function _lpFiltro() { return { marcasOff: _lpMarcasOff, usados: _lpUsados, nuevos: _lpNuevos, sacados: _lpSacados }; }
// Los que van a la imagen
function _lpLista() { return lpFiltrar(_lpBase(), _lpFiltro()); }

const _lpEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Los filtros se arman con los equipos que hay (las marcas salen de ahí)
function _lpPintarFiltros() {
  const caja = document.getElementById('lp-filtros');
  if (!caja) return;
  const base = _lpBase();
  const off = new Set(_lpMarcasOff.map(_eeNorm));
  const chip = (on, txt, click) => `<button type="button" class="lp-chip${on ? ' on' : ''}" onclick="${click}">${txt}</button>`;
  const marcas = lpMarcas(base);
  const nU = base.filter(e => e.condicion !== 'Nuevo').length, nN = base.length - nU;
  // Uno por uno: con los filtros de marca y condición ya aplicados
  const visibles = lpOrdenar(lpFiltrar(base, { marcasOff: _lpMarcasOff, usados: _lpUsados, nuevos: _lpNuevos }));
  const sac = new Set(_lpSacados);
  const abierto = document.getElementById('lp-uno')?.open ? ' open' : '';
  caja.innerHTML = `
    ${marcas.length > 1 ? `<div class="ee-preg">Marcas</div>
    <div class="lp-chips">${marcas.map(m => chip(!off.has(_eeNorm(m.marca)), `${_lpEsc(m.marca)} (${m.n})`, `lpMarcaToggle('${_lpEsc(m.marca).replace(/'/g, '&#39;')}')`)).join('')}</div>` : ''}
    <div class="ee-preg">¿Usados o nuevos?</div>
    <div class="lp-chips">${chip(_lpUsados, `📱 Usados (${nU})`, 'lpCondToggle("usados")')}${chip(_lpNuevos, `🎁 Nuevos (${nN})`, 'lpCondToggle("nuevos")')}</div>
    <div class="ee-preg">¿Qué dice cada renglón?</div>
    <div class="lp-chips">${chip(_lpMostrar.cap, '💾 Capacidad', 'lpMostrarToggle("cap")')}${chip(_lpMostrar.bat, '🔋 Batería', 'lpMostrarToggle("bat")')}${chip(_lpMostrar.color, '🎨 Color', 'lpMostrarToggle("color")')}</div>
    <details class="lp-uno" id="lp-uno"${abierto}>
      <summary>Elegir uno por uno (${visibles.filter(e => !sac.has(e._k)).length} de ${visibles.length}) ▾</summary>
      ${visibles.map(e => `<label><input type="checkbox" ${sac.has(e._k) ? '' : 'checked'} onchange="lpSacarToggle(${JSON.stringify(e._k).replace(/"/g, '&quot;')})">
        <span>${_lpEsc(lpRenglon(e, false, _lpMostrar))} <span class="lp-sub">${_lpEsc(lpPrecio(e))}</span></span></label>`).join('') || '<p class="ee-ayuda">No queda ninguno con estos filtros.</p>'}
    </details>`;
  _lpBoton();
}

function lpCuales(soloPub) {
  _lpSoloPub = !!soloPub;
  document.getElementById('lp-todos')?.classList.toggle('on', !_lpSoloPub);
  document.getElementById('lp-pub')?.classList.toggle('on', _lpSoloPub);
  _lpPintarFiltros();
}
function lpMarcaToggle(marca) {
  const k = _eeNorm(marca);
  _lpMarcasOff = _lpMarcasOff.some(m => _eeNorm(m) === k) ? _lpMarcasOff.filter(m => _eeNorm(m) !== k) : _lpMarcasOff.concat([marca]);
  _lpPintarFiltros();
}
function lpCondToggle(cual) {
  if (cual === 'usados') _lpUsados = !_lpUsados; else _lpNuevos = !_lpNuevos;
  _lpPintarFiltros();
}
function lpMostrarToggle(campo) {
  _lpMostrar[campo] = !_lpMostrar[campo];
  _lpPintarFiltros();
}
function lpSacarToggle(k) {
  _lpSacados = _lpSacados.includes(k) ? _lpSacados.filter(x => x !== k) : _lpSacados.concat([k]);
  _lpPintarFiltros();
}
function lpConPrecio(v) {
  _lpPrecio = !!v;
  document.getElementById('lp-p-si')?.classList.toggle('on', _lpPrecio === true);
  document.getElementById('lp-p-no')?.classList.toggle('on', _lpPrecio === false);
  _lpBoton();
}
function _lpBoton() {
  const b = document.getElementById('lp-ir');
  if (!b) return;
  const n = _lpLista().length;
  b.disabled = !n || _lpPrecio === null;
  b.textContent = !_lpBase().length ? 'No hay equipos en stock'
    : !n ? 'Con estos filtros no queda ningún equipo'
    : _lpPrecio === null ? 'Elegí arriba si va con precio'
    : `📋 Armar la lista (${n} equipo${n === 1 ? '' : 's'})`;
}

async function lpIr(btn) {
  if (_lpPrecio === null) return;
  await lpCompartir(_lpLista(), _lpPrecio, btn, _lpFondoSel || lpFondoGuardado(), _lpMostrar);
}
