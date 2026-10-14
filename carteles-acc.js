// ══════════════════════════════════════════════════════════════
//  CARTELES DE ACCESORIOS — horizontales, tres medidas, A4 vertical
// ══════════════════════════════════════════════════════════════
//  Los de la vitrina y la góndola: nombre y precio, nada más. Se leen de
//  lejos y de costado, por eso son apaisados.
//
//  Tres medidas sobre una grilla de 3 columnas × 6 filas:
//   · Chico   1×1  (70 × 50 mm)  — 18 por hoja
//   · Mediano 2×1  (140 × 50 mm) —  9 por hoja
//   · Grande  3×2  (210 × 100 mm) — 3 por hoja
//
//  Y se MEZCLAN en la misma hoja: dos chicos al lado de un mediano llenan la
//  fila. Una hoja A4 cuesta lo mismo con un cartel que con dieciocho, así que
//  el acomodado busca no dejar huecos (ver cartAccHojas).
//
//  Los datos salen del inventario en el momento, sin copia guardada: si
//  cambiás un precio, el próximo cartel sale con el nuevo.
//
//  El color y lo demás se comparten con los carteles de equipos
//  (carteles.js): un solo lugar para elegirlo y los dos salen iguales.
// ══════════════════════════════════════════════════════════════

const CART_ACC_COLS = 3;
const CART_ACC_FILAS = 6;

// w y h son casilleros de la grilla, no milímetros: así una medida nueva es
// una línea acá y el acomodado sigue funcionando solo.
const CART_ACC_MEDIDAS = {
  chico:   { w: 1, h: 1, lbl: 'Chico',   mm: '70 × 50 mm',   porHoja: 18 },
  mediano: { w: 2, h: 1, lbl: 'Mediano', mm: '140 × 50 mm',  porHoja: 9 },
  grande:  { w: 3, h: 2, lbl: 'Grande',  mm: '210 × 100 mm', porHoja: 3 },
};
const CART_ACC_ORDEN = ['chico', 'mediano', 'grande'];

function cartAccMedida(k) { return CART_ACC_MEDIDAS[k] || CART_ACC_MEDIDAS.chico; }

// ── El acomodado ──────────────────────────────────────────
// Se va poniendo en el primer hueco que entre, de arriba a la izquierda. Si
// uno no entra en lo que queda de la hoja, se saltea y se prueba el que
// sigue: así un chico tapa el hueco que dejó un mediano en vez de empezar
// otra hoja a medio llenar. Lo que no entró arranca la hoja siguiente.
function _accHueco(ocupado, w, h) {
  for (let r = 0; r + h <= CART_ACC_FILAS; r++) {
    for (let c = 0; c + w <= CART_ACC_COLS; c++) {
      let libre = true;
      for (let i = 0; i < h && libre; i++)
        for (let j = 0; j < w && libre; j++) if (ocupado[r + i][c + j]) libre = false;
      if (libre) return { r, c };
    }
  }
  return null;
}

function cartAccHojas(items) {
  const hojas = [];
  let pend = (items || []).slice();
  while (pend.length) {
    const ocupado = Array.from({ length: CART_ACC_FILAS }, () => new Array(CART_ACC_COLS).fill(false));
    const puestos = [], quedan = [];
    for (const it of pend) {
      const m = cartAccMedida(it.medida);
      const pos = _accHueco(ocupado, m.w, m.h);
      if (!pos) { quedan.push(it); continue; }
      for (let i = 0; i < m.h; i++) for (let j = 0; j < m.w; j++) ocupado[pos.r + i][pos.c + j] = true;
      puestos.push({ ...it, col: pos.c + 1, fila: pos.r + 1, w: m.w, h: m.h });
    }
    // Ninguno entró: una medida más grande que la hoja. Mejor cortar que
    // quedarse armando hojas vacías para siempre.
    if (!puestos.length) break;
    hojas.push(puestos);
    pend = quedan;
  }
  return hojas;
}

// ── Un cartel ─────────────────────────────────────────────
// El precio va EXACTO, sin redondear. En un equipo de un millón el redondeo
// a la centena no se nota, pero acá un vidrio de $2.950 pasaría a decir
// $3.000 y la caja cobraría otra cosa.
function cartAccPrecio(p) {
  return Math.round(Number(p && (p.precioVenta ?? p.precio)) || 0);
}

// Las letras se achican solas según el lugar que tenga el cartel: lo mismo
// escrito entra distinto en 70mm que en 210mm. `k` es cuántos casilleros de
// ancho ocupa.
// `ancho` es el lugar que tiene de verdad: el casillero por lo que ocupa a lo
// ancho, menos el padding y el borde. El .55 y el .58 son lo que ocupa una
// letra de Baloo 2 en negrita, medido en el navegador. Los topes salen del
// ALTO del cartel: más grande que eso y el precio no entra abajo.
function cartAccTamNombre(nombre, w, h) {
  const n = String(nombre || '').trim().length || 1;
  const ancho = w * 248 - 30;
  const tope = h > 1 ? 72 : 34;
  // Puede usar dos renglones, pero no se cuenta como dos enteros: el texto
  // corta por palabra, así que el final de cada renglón queda a medio llenar.
  // Con los dos completos, "Soporte de auto magnético" se iba a un tercer
  // renglón y salía cortado con puntos suspensivos.
  return Math.max(11, Math.min(tope, Math.floor((ancho * 1.7) / (0.55 * n))));
}

// El precio es lo que se mira primero: va siempre más grande que el nombre y
// en un solo renglón.
function cartAccTamPrecio(txt, w, h) {
  const n = String(txt || '').length || 1;
  const ancho = w * 248 - 30;
  const tope = h > 1 ? 80 : 40;
  return Math.max(13, Math.min(tope, Math.floor(ancho / (0.58 * n))));
}

function cartelAccHtml(it) {
  const m = cartAccMedida(it.medida);
  const nombre = String(it.nombre || '').trim() || 'Producto';
  const precio = cartAccPrecio(it);
  const txt = (typeof cartPlata === 'function') ? cartPlata(precio) : '$' + precio;
  const esc = (typeof _cartEsc === 'function') ? _cartEsc : (s => String(s == null ? '' : s));
  const grande = m.h > 1;
  return `<article class="cartelA${grande ? ' cartelA--g' : ''}">
    <div class="ca-top">
      <span class="ca-biz">TECHPOINT</span>
    </div>
    <div class="ca-nom" style="font-size:${cartAccTamNombre(nombre, m.w, m.h)}px">${esc(nombre)}</div>
    <div class="ca-precio" style="font-size:${cartAccTamPrecio(txt, m.w, m.h)}px">${esc(txt)}</div>
  </article>`;
}

function _cartAccCss(color) {
  return `
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:'Baloo 2','Segoe UI',system-ui,sans-serif;color:#16161D;background:#fff;
  print-color-adjust:exact;-webkit-print-color-adjust:exact}
/* La hoja: 210×297mm. El alto va un pelo corto porque a la medida exacta
   Chrome a veces se pasa un pixel y manda una hoja en blanco atrás. */
.hojaA{width:210mm;height:296.5mm;padding:14px;overflow:hidden;
  display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(6,1fr);
  break-after:page;page-break-after:always}
.hojaA:last-child{break-after:auto;page-break-after:auto}
.celdaA{border:1px dashed #9A9AA8;overflow:hidden;min-width:0;min-height:0;padding:8px}
.cartelA{width:100%;height:100%;display:flex;flex-direction:column;background:#fff;
  border:2px solid ${color};border-radius:12px;padding:7px 10px;line-height:1.1;overflow:hidden}
.cartelA--g{border-width:3px;border-radius:18px;padding:14px 18px}
.ca-top{display:flex;align-items:center;justify-content:space-between}
.ca-biz{font-size:9px;font-weight:800;letter-spacing:.12em;color:${color}}
.cartelA--g .ca-biz{font-size:15px}
/* Dos renglones como máximo: con tres el cartel se desarma. */
.ca-nom{font-weight:700;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden}
.ca-precio{font-weight:800;color:${color};line-height:1;white-space:nowrap;margin-top:auto;text-align:right}
/* Solo en la vista previa: se ven los bordes de cada hoja. Al imprimir no. */
@media screen{
  body{background:#e9e9ee}
  .hojaA{background:#fff;margin:0 auto 14px;box-shadow:0 2px 10px rgba(0,0,0,.18)}
}`;
}

// El documento entero, el mismo para la vista previa y para la impresora.
function cartAccDocumento(items, cfg) {
  const c = cfg || (typeof CART_CFG !== 'undefined' ? CART_CFG : { color: '#0040FF' });
  const hojas = cartAccHojas(items);
  const cuerpo = hojas.map(hoja => {
    const celdas = hoja.map(it =>
      `<div class="celdaA" style="grid-column:${it.col}/span ${it.w};grid-row:${it.fila}/span ${it.h}">${cartelAccHtml(it)}</div>`
    ).join('');
    return `<section class="hojaA">${celdas}</section>`;
  }).join('\n');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Carteles de accesorios — TechPoint</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&display=swap">
<style>${_cartAccCss(c.color || '#0040FF')}</style></head><body>
${cuerpo}
</body></html>`;
}

// ══════════════════════════════════════════════════════════
//  EL CUADRO
// ══════════════════════════════════════════════════════════
let _accBase = [];        // los que se pueden poner en un cartel
let _accSel = [];         // ids EN ORDEN DE SELECCIÓN
let _accMedidas = {};     // { id: 'chico' | 'mediano' | 'grande' }
let _accFuera = [];       // sin precio cargado

const _accV = id => (document.getElementById(id)?.value || '').trim();
const _accEsc = s => (typeof _cartEsc === 'function') ? _cartEsc(s) : String(s == null ? '' : s);
const _accPlata = n => (typeof cartPlata === 'function') ? cartPlata(n) : '$' + n;

function _accVisibles() {
  const q = _accV('acc-f-buscar');
  const cat = _accV('acc-f-cat');
  return _accBase.filter(p => {
    if (cat && (p.categoria || '') !== cat) return false;
    if (q) {
      const hay = `${p.nombre || ''} ${p.categoria || ''} ${p.codigo || ''}`;
      return (typeof searchMatch === 'function') ? searchMatch(hay, q)
        : hay.toLowerCase().includes(q.toLowerCase());
    }
    return true;
  });
}

function _accElegidos() {
  return _accSel.map(id => {
    const p = _accBase.find(x => x.id === id);
    return p ? { id: p.id, nombre: p.nombre, precioVenta: p.precioVenta, medida: _accMedidas[id] || 'chico' } : null;
  }).filter(Boolean);
}

// `preSel` = los artículos del modo "seleccionar varios".
function cartAccAbrir(preSel) {
  const modal = document.getElementById('cartacc-modal');
  if (!modal) return;
  if (typeof cartCargarCfg === 'function') cartCargarCfg();
  const todos = (Array.isArray(preSel) && preSel.length)
    ? preSel
    : (typeof PRODUCTOS !== 'undefined' && Array.isArray(PRODUCTOS) ? PRODUCTOS : []);
  const activos = todos.filter(p => p && p.activo !== false);
  _accBase = activos.filter(p => cartAccPrecio(p) > 0);
  _accFuera = activos.filter(p => cartAccPrecio(p) <= 0);
  _accMedidas = {};
  _accSel = (Array.isArray(preSel) && preSel.length) ? _accBase.map(p => p.id) : [];
  const set = (k, v) => { const el = document.getElementById(k); if (el) el.value = v; };
  set('acc-f-buscar', '');
  _accCatSelect();
  set('acc-f-cat', '');
  accRender();
  document.getElementById('cartacc-overlay')?.classList.remove('hidden');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function cartAccCerrar() {
  document.getElementById('cartacc-overlay')?.classList.add('hidden');
  document.getElementById('cartacc-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

function _accCatSelect() {
  const sel = document.getElementById('acc-f-cat');
  if (!sel) return;
  const cats = [...new Set(_accBase.map(p => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  sel.innerHTML = '<option value="">Todas las categorías</option>'
    + cats.map(c => `<option value="${_accEsc(c)}">${_accEsc(c)}</option>`).join('');
}

function accFiltrar() { accRender(); }

function accTocar(id) {
  const i = _accSel.indexOf(id);
  if (i >= 0) _accSel.splice(i, 1); else _accSel.push(id);
  accRender();
}

function accTodos(v) {
  const vis = _accVisibles();
  if (v) vis.forEach(p => { if (!_accSel.includes(p.id)) _accSel.push(p.id); });
  else   vis.forEach(p => { const i = _accSel.indexOf(p.id); if (i >= 0) _accSel.splice(i, 1); });
  accRender();
}

function accMedida(id, k) {
  _accMedidas[id] = k;
  // Elegir la medida es también elegir el cartel: si no estaba tildado, se
  // tilda solo. Tocar "Grande" y que no pase nada es para volverse loco.
  if (!_accSel.includes(id)) _accSel.push(id);
  accRender();
}

// Para cambiarle la medida a todos de una, que es lo normal: una tanda de
// chicos para la vitrina, uno grande para la promo.
function accMedidaTodos(k) {
  _accSel.forEach(id => { _accMedidas[id] = k; });
  accRender();
}

function accRender() {
  const vis = _accVisibles();
  const cont = document.getElementById('cartacc-lista');
  if (cont) {
    cont.innerHTML = vis.length ? vis.map(p => {
      const on = _accSel.includes(p.id);
      const med = _accMedidas[p.id] || 'chico';
      const botones = CART_ACC_ORDEN.map(k => {
        const m = CART_ACC_MEDIDAS[k];
        return `<button type="button" class="acc-med${on && med === k ? ' acc-med--on' : ''}"
          title="${m.lbl} · ${m.mm}" onclick="event.stopPropagation();accMedida('${_accEsc(p.id)}','${k}')">${m.lbl[0]}</button>`;
      }).join('');
      return `<div class="lwa-item acc-item${on ? ' lwa-item--on' : ''}" onclick="accTocar('${_accEsc(p.id)}')">
        <input type="checkbox" ${on ? 'checked' : ''} onclick="event.stopPropagation();accTocar('${_accEsc(p.id)}')">
        <span class="lwa-item-txt">
          <span class="lwa-item-nom">${_accEsc(p.nombre || '(sin nombre)')}</span>
          ${p.categoria ? `<span class="lwa-item-meta">${_accEsc(p.categoria)}</span>` : ''}
        </span>
        <b class="lwa-item-precio">${_accPlata(cartAccPrecio(p))}</b>
        <span class="acc-meds">${botones}</span>
      </div>`;
    }).join('') : '<p class="lwa-vacio">Ningún artículo con estos filtros.</p>';
  }

  const cuenta = document.getElementById('cartacc-cuenta');
  if (cuenta) {
    const hojas = cartAccHojas(_accElegidos()).length;
    cuenta.textContent = _accSel.length
      ? `${_accSel.length} elegido${_accSel.length !== 1 ? 's' : ''} · ${hojas} hoja${hojas !== 1 ? 's' : ''}`
      : `0 elegidos de ${vis.length}`;
  }

  const nota = document.getElementById('cartacc-nota');
  if (nota) {
    nota.textContent = _accFuera.length
      ? `${_accFuera.length} artículo${_accFuera.length !== 1 ? 's' : ''} sin precio cargado queda${_accFuera.length !== 1 ? 'n' : ''} afuera.`
      : 'Tildá los artículos y elegí la medida de cada uno. Las medidas se mezclan en la misma hoja.';
  }

  const btn = document.getElementById('cartacc-imprimir');
  if (btn) btn.disabled = !_accSel.length;
  accPintarPreview();
}

// La vista previa es el MISMO documento que se imprime, achicado para que
// entre en la pantalla. Así no hay forma de que se vea una cosa y salga otra.
function accPintarPreview() {
  const marco = document.getElementById('cartacc-preview');
  const wrap = document.getElementById('cartacc-preview-wrap');
  if (!marco || !wrap) return;
  const elegidos = _accElegidos();
  if (!elegidos.length) { marco.removeAttribute('srcdoc'); wrap.style.height = '0px'; return; }
  const hojas = cartAccHojas(elegidos).length;
  const anchoHoja = 794;                              // 210mm a 96 dpi
  const esc = Math.min(1, (wrap.clientWidth || 320) / anchoHoja);
  marco.style.transform = `scale(${esc})`;
  marco.style.height = (1123 * hojas + 14 * hojas + 10) + 'px';
  wrap.style.height = Math.round((1123 * hojas + 14 * hojas + 10) * esc) + 'px';
  marco.srcdoc = cartAccDocumento(elegidos);
}

function cartAccImprimir() {
  const elegidos = _accElegidos();
  if (!elegidos.length) { if (typeof toast === 'function') toast('Tildá al menos un artículo', 'info'); return; }
  const html = cartAccDocumento(elegidos);
  // Por el diálogo del navegador a propósito: son a color y la impresora del
  // QZ es la del mostrador (blanco y negro).
  if (typeof _openPrint === 'function') _openPrint(html, 'Carteles');
  else {
    const w = window.open('', '_blank', 'width=900,height=700,scrollbars=yes');
    if (!w) { alert('Habilitá los popups para imprimir.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
    w.addEventListener('load', () => { w.focus(); setTimeout(() => w.print(), 350); });
  }
}
