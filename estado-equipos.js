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

// ── El dibujo ─────────────────────────────────────────────
const EE_FUENTE = "'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif";

function _eeRedondo(x, cx, cy, w, h, r) {
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
    x.font = `${peso} ${t}px ${EE_FUENTE}`;
    if (x.measureText(txt).width <= ancho) return t;
  }
  x.font = `${peso} ${min}px ${EE_FUENTE}`;
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

async function eeDibujar(e) {
  const t = eeTextos(e);
  const cv = document.createElement('canvas');
  cv.width = EE_W; cv.height = EE_H;
  const x = cv.getContext('2d');

  // Fondo: el azul de la página de equipos
  const g = x.createLinearGradient(0, 0, 0, EE_H);
  g.addColorStop(0, '#0f2b52'); g.addColorStop(1, '#06162c');
  x.fillStyle = g; x.fillRect(0, 0, EE_W, EE_H);
  x.textBaseline = 'alphabetic';

  // Arriba y abajo quedan ~200px libres: ahí WhatsApp pone su barra y el
  // "Responder", y taparían lo que se escriba.
  x.fillStyle = '#fff';
  x.font = `800 46px ${EE_FUENTE}`;
  x.textAlign = 'left';
  x.fillText('TECHPOINT', 80, 250);

  // Nuevo / Usado / Reacondicionado
  x.font = `700 36px ${EE_FUENTE}`;
  const cw = x.measureText(t.condicion).width + 56;
  x.fillStyle = e.condicion === 'Nuevo' ? '#22c55e' : '#38bdf8';
  _eeRedondo(x, EE_W - 80 - cw, 200, cw, 66, 33); x.fill();
  x.fillStyle = '#06162c'; x.textAlign = 'center';
  x.fillText(t.condicion, EE_W - 80 - cw / 2, 246);

  // La foto, en una tarjeta blanca
  const fx = 80, fy = 300, fw = 920, fh = 900;
  x.fillStyle = '#fff';
  _eeRedondo(x, fx, fy, fw, fh, 48); x.fill();
  const foto = await _eeFoto(e.fotos[0]);
  if (foto) {
    const pad = 30, aw = fw - pad * 2, ah = fh - pad * 2;
    const k = Math.min(aw / foto.width, ah / foto.height);
    const w = foto.width * k, h = foto.height * k;
    x.save(); _eeRedondo(x, fx, fy, fw, fh, 48); x.clip();
    x.drawImage(foto, fx + (fw - w) / 2, fy + (fh - h) / 2, w, h);
    x.restore();
  } else {
    x.font = `300px ${EE_FUENTE}`; x.textAlign = 'center';
    x.fillText('📱', fx + fw / 2, fy + fh / 2 + 100);
  }
  if (t.unidades) {
    x.font = `700 34px ${EE_FUENTE}`;
    const uw = x.measureText(t.unidades).width + 50;
    x.fillStyle = '#0f2b52';
    _eeRedondo(x, fx + 28, fy + fh - 90, uw, 62, 31); x.fill();
    x.fillStyle = '#fff'; x.textAlign = 'center';
    x.fillText(t.unidades, fx + 28 + uw / 2, fy + fh - 47);
  }

  // Modelo (grande; si es muy largo, en dos renglones)
  x.fillStyle = '#fff'; x.textAlign = 'center';
  const tn = _eeEntra(x, t.nombre, 800, 88, 60, 920);
  const ren = _eeRenglones(x, t.nombre, 920);
  let y = 1300;
  ren.forEach((r, i) => x.fillText(r, EE_W / 2, y + i * (tn + 6)));
  y += (ren.length - 1) * (tn + 6);

  if (t.specs) {
    x.fillStyle = 'rgba(255,255,255,.82)';
    _eeEntra(x, t.specs, 600, 42, 28, 940);
    x.fillText(t.specs, EE_W / 2, y + 70);
  }

  // El precio, en el cartel amarillo
  const py = y + 110;
  x.fillStyle = '#FFD23F';
  _eeRedondo(x, 140, py, 800, 150, 75); x.fill();
  x.fillStyle = '#0f2b52';
  _eeEntra(x, t.precio, 800, e.precio ? 104 : 76, 50, 720);
  x.fillText(t.precio, EE_W / 2, py + (e.precio ? 112 : 102));

  // Los datos del local
  const biz = (typeof BIZ_DATA !== 'undefined' && BIZ_DATA) ? BIZ_DATA : {};
  const tel = biz.tel || '11 7239-2511';
  const dir = biz.dir || 'Urquiza 4741, Local 22, Caseros';
  x.fillStyle = '#fff';
  _eeEntra(x, `💬 Escribinos: ${tel}`, 700, 44, 30, 940);
  x.fillText(`💬 Escribinos: ${tel}`, EE_W / 2, 1710);
  x.fillStyle = 'rgba(255,255,255,.75)';
  _eeEntra(x, `📍 ${dir}`, 600, 34, 24, 940);
  x.fillText(`📍 ${dir}`, EE_W / 2, 1762);

  return await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.9));
}

function _eeNombreArchivo(e, i) {
  const base = eeTextos(e).nombre.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'equipo';
  return `estado-${String(i + 1).padStart(2, '0')}-${base}.jpg`;
}

// ── Mandarlas ─────────────────────────────────────────────
// En el celular: el menú de compartir (WhatsApp → "Mi estado"). En la compu
// no hay estados para subir desde el navegador: se descargan.
async function eeCompartir(equipos, btn) {
  const lista = (equipos || []).slice(0, EE_MAX);
  if (!lista.length) { toast('No hay equipos para armar', 'info'); return; }
  const txt = btn ? btn.textContent : '';
  const archivos = [];
  try {
    if (btn) btn.disabled = true;
    for (let i = 0; i < lista.length; i++) {
      if (btn) btn.textContent = `Armando ${i + 1} de ${lista.length}…`;
      const blob = await eeDibujar(lista[i]);
      if (blob) archivos.push(new File([blob], _eeNombreArchivo(lista[i], i), { type: 'image/jpeg' }));
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
  archivos.forEach((f, i) => setTimeout(() => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, i * 300));   // de a una: Chrome frena muchas descargas juntas
  toast(`⬇️ ${archivos.length} imagen${archivos.length === 1 ? '' : 'es'} descargada${archivos.length === 1 ? '' : 's'}. Desde el celu sale directo a WhatsApp`, 'success');
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

// Un equipo solo (botón 📲 de la ficha)
async function eeEstadoDe(id) {
  const p = (typeof STOCK !== 'undefined') ? STOCK.find(x => x.id === id) : null;
  if (!p) return;
  if (!(p.fotos || []).length && !confirm('Este equipo no tiene fotos: el estado sale con un dibujito de celular. ¿Seguís?')) return;
  await eeCompartir([eeDesdeStock(p)]);
}

// ── El cuadro para elegir cuáles ──────────────────────────
let _eeLista = [];

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
.ee-fila{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(128,128,128,.18);cursor:pointer}
.ee-fila img,.ee-fila .ee-sf{width:44px;height:44px;border-radius:8px;object-fit:cover;background:#eef;flex:none;display:flex;align-items:center;justify-content:center}
.ee-fila b{display:block;font-size:14px}
.ee-fila small{opacity:.7;font-size:12px}
.ee-fila input{width:20px;height:20px;flex:none}
.ee-todos{font-size:13px;background:none;border:0;color:#2563eb;cursor:pointer;padding:4px 0;margin-bottom:4px}
.ee-ir{width:100%;margin-top:12px;padding:14px;border:0;border-radius:12px;background:#25D366;color:#fff;font-weight:700;font-size:16px;cursor:pointer}
.ee-ir:disabled{opacity:.6}`;
  document.head.appendChild(st);
}

function eeAbrir() {
  if (typeof closeSheet === 'function') closeSheet();
  _eeLista = eeParaEstados(typeof STOCK !== 'undefined' ? STOCK : []);
  if (!_eeLista.length) {
    toast('No hay equipos publicados en la página (y sin vender) para armar estados', 'info');
    return;
  }
  _eeEstilos();
  eeCerrar();
  const esc2 = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const filas = _eeLista.map((e, i) => {
    const t = eeTextos(e);
    return `<label class="ee-fila">
      <input type="checkbox" data-i="${i}" ${i < EE_MAX ? 'checked' : ''} onchange="eeContar()">
      ${e.fotos[0] ? `<img src="${esc2(e.fotos[0])}" alt="" loading="lazy">` : '<span class="ee-sf">📱</span>'}
      <span><b>${esc2(t.nombre)}</b><small>${esc2(t.precio)}${t.unidades ? ' · ' + esc2(t.unidades) : ''}${e.fotos.length ? '' : ' · sin foto'}</small></span>
    </label>`;
  }).join('');
  const ov = document.createElement('div');
  ov.className = 'ee-ov'; ov.id = 'ee-ov'; ov.onclick = eeCerrar;
  const m = document.createElement('div');
  m.className = 'ee-mod'; m.id = 'ee-mod';
  m.innerHTML = `<div class="ee-hd"><span>📲 Equipos para los estados</span><button type="button" class="ee-x" onclick="eeCerrar()">✕</button></div>
    <p class="ee-ayuda">Se arma una imagen por equipo con foto, precio y los datos del local. En el celu se abre WhatsApp: elegí <b>"Mi estado"</b> y listo.</p>
    <button type="button" class="ee-todos" onclick="eeTodos()">Marcar / desmarcar todos</button>
    <div id="ee-filas">${filas}</div>
    <button type="button" class="ee-ir" id="ee-ir" onclick="eeIr(this)"></button>`;
  document.body.appendChild(ov);
  document.body.appendChild(m);
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
  const n = _eeMarcados().length;
  const b = document.getElementById('ee-ir');
  if (!b) return;
  b.disabled = !n || n > EE_MAX;
  b.textContent = n > EE_MAX ? `Máximo ${EE_MAX} por vez (marcaste ${n})` : `📲 Armar ${n} estado${n === 1 ? '' : 's'} y compartir`;
}

function eeTodos() {
  const cs = [...document.querySelectorAll('#ee-filas input')];
  const marcar = cs.some(c => !c.checked);
  cs.forEach((c, i) => { c.checked = marcar && i < EE_MAX; });
  eeContar();
}

async function eeIr(btn) {
  await eeCompartir(_eeMarcados(), btn);
}
