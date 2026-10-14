// ══════════════════════════════════════════════════════════════
//  CARTELES DE EXHIBICIÓN — A7, 8 por hoja A4 apaisada
// ══════════════════════════════════════════════════════════════
//  Los carteles de la vidriera se hacían a mano, uno por uno: cada cambio de
//  precio era volver a escribirlos y siempre quedaba alguno viejo colgado.
//  Acá se tildan los equipos del stock y sale la hoja lista para cortar.
//
//  Los datos salen del stock EN EL MOMENTO de generar: no se guarda ninguna
//  copia. Si cambiás un precio en la app, el próximo cartel ya sale nuevo.
//
//  La plata del cartel:
//   · Efectivo = el precio del equipo (los cargados en dólares pasan por la
//     cotización, con el mismo cálculo que la lista de WhatsApp).
//   · Cuota = precio × (1 + recargo de 3 cuotas) / 3, con el MISMO recargo
//     que usa la ficha del equipo (`PRICES.c3`, se cambia en Configuración).
//     Un recargo propio del cartel era garantía de que un día la vidriera
//     dijera una cosa y el mostrador otra.
//   · Todo redondeado para arriba a la centena: en la vidriera no va un
//     "$659.250".
//
//  Un equipo sin precio (o cargado en dólares sin cotización a mano) NO sale.
//  Salió publicado un Realme a "$67" porque eran dólares en el campo de
//  pesos; impreso y pegado en la vidriera eso es peor que no tener cartel.
// ══════════════════════════════════════════════════════════════

const CART_X_HOJA = 8;                 // 4 columnas × 2 filas de A7 = una A4
const CART_RECARGO_DEF = 26;           // si todavía no se guardó el de Configuración
const CART_PRECIO_MIN = 10000;         // un celular no vale menos que esto

// ── Ajustes del cartel ────────────────────────────────────
// Mismo camino que los porcentajes de precio: localStorage para que abra al
// toque, y `config/appSettings` para que la compu del mostrador y el celular
// usen lo mismo.
const CART_KEY = 'cartelesCfg';
const CART_DEF = { garNuevo: '6 meses', garUsado: '30 días', color: '#0040FF' };
const CART_COLORES = ['#0040FF', '#E5006E', '#008C3A', '#F05A00'];
let CART_CFG = { ...CART_DEF };

function cartCargarCfg() {
  try {
    const d = JSON.parse(localStorage.getItem(CART_KEY) || 'null');
    CART_CFG = d && typeof d === 'object' ? { ...CART_DEF, ...d } : { ...CART_DEF };
  } catch { CART_CFG = { ...CART_DEF }; }
  return CART_CFG;
}

function cartGuardarCfg() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(CART_CFG)); } catch {}
  if (typeof db !== 'undefined' && db) {
    db.collection('config').doc('appSettings').set({ carteles: CART_CFG }, { merge: true })
      .catch(e => console.error('[carteles] guardar ajustes:', e));
  }
}

// La llama app.js cuando baja `config/appSettings` de Firestore.
function cartCfgDesdeFirestore(d) {
  if (!d || typeof d !== 'object') return;
  CART_CFG = { ...CART_DEF, ...d };
  try { localStorage.setItem(CART_KEY, JSON.stringify(CART_CFG)); } catch {}
}

// ── Textos y plata ────────────────────────────────────────
function _cartEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// "128GB" → "128 GB" (en el stock se carga de las dos formas)
function cartMedida(s) {
  const t = String(s == null ? '' : s).trim();
  const m = t.match(/^(\d+)\s*(GB|TB|MB)$/i);
  return m ? `${m[1]} ${m[2].toUpperCase()}` : t;
}

// Siempre para arriba y a la centena. Pega sobre todo en los cargados en
// dólares, que al pasar por la cotización quedan con números sucios.
function cartRedondear(n) {
  const v = Number(n) || 0;
  return v > 0 ? Math.ceil(v / 100) * 100 : 0;
}

function cartPlata(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
}

// El recargo es UNO solo en toda la app: el de Configuración.
function cartRecargo() {
  const pct = (typeof PRICES === 'object' && PRICES) ? Number(PRICES.c3) : NaN;
  return isFinite(pct) && pct > 0 ? pct : CART_RECARGO_DEF;
}

function cartCuota(precioArs) {
  const base = Number(precioArs) || 0;
  if (base <= 0) return 0;
  return cartRedondear(base * (1 + cartRecargo() / 100) / 3);
}

// El precio en pesos. Usa el mismo cálculo que la lista de WhatsApp para que
// los dos lados no digan números distintos del mismo equipo.
function cartPrecioArs(p) {
  if (typeof _listaPrecioNum === 'function') return _listaPrecioNum(p);
  const ars = Number(p && p.precio) || 0;
  if (ars > 0) return ars;
  const usd = Number(p && p.precioUSD) || 0;
  const dolar = (typeof dolarBlue === 'number' && dolarBlue > 0) ? dolarBlue : 0;
  return usd > 0 && dolar > 0 ? Math.round(usd * dolar) : 0;
}

// Sin precio de verdad no hay cartel.
function cartPublicable(p) {
  return cartRedondear(cartPrecioArs(p)) >= CART_PRECIO_MIN;
}

// La batería solo tiene sentido en los iPhone: es lo primero que pregunta el
// que compra uno usado. En un Samsung nadie la mira y ocupa lugar.
function cartLlevaBateria(p) {
  const esIphone = (typeof _esIphone === 'function')
    ? _esIphone(p)
    : /iphone|apple/i.test(`${(p && p.marca) || ''} ${(p && p.modelo) || ''}`);
  return !!(esIphone && Number(p && p.bateria) > 0);
}

function cartEsNuevo(p) { return String(p && p.estado) === 'Nuevo'; }

function cartEstadoTxt(p) {
  const e = String(p && p.estado || '');
  if (e === 'Nuevo') return 'NUEVO';
  // "REACONDICIONADO" no entra en la pastilla sin romper el renglón.
  if (e === 'Reacondicionado') return 'REACOND.';
  return 'USADO';
}

// La garantía que tenga cargada el equipo manda: es la que sale en el
// comprobante que firma el cliente. El texto de los ajustes es el respaldo
// para los que están en cero, así la vidriera nunca promete otra cosa.
function cartGarantiaTxt(p, cfg) {
  const c = cfg || CART_CFG;
  const m = Math.round(Number(p && p.garantiaMeses) || 0);
  if (m > 0) return `${m} ${m === 1 ? 'mes' : 'meses'}`;
  return (cartEsNuevo(p) ? c.garNuevo : c.garUsado) || '';
}

// ── Textos largos: bajar la letra para que entren ─────────
// El cartel es de cartón, no se puede scrollear: un "Galaxy S23 Ultra 5G" con
// la letra de "A54" se desarma. Se calcula acá, al armar el HTML, porque el
// documento que se imprime no corre JavaScript.
// El modelo tiene que entrar en UN renglón. Con dos, el cartel crece 25px y
// la franja negra de la tarjeta se va abajo del borde: pasaba con "iPhone 15
// Pro Max" y con "Galaxy S23 Ultra 5G". En vez de una tabla de tamaños se
// calcula: 232px es el ancho libre del cartel (280 menos los dos padding) y
// .55 lo que ocupa cada letra de Baloo 2 en negrita, medido en el navegador
// sobre los modelos de verdad (van de .46 a .53, el resto es margen).
const _CART_ANCHO_MODELO = 232;
const _CART_EM_MODELO = 0.55;
function cartTamModelo(s) {
  const n = String(s || '').trim().length || 1;
  // El piso es 19: más chico que eso no se lee de lejos, y un modelo que no
  // entra igual se parte en dos renglones, que ahí sí hay lugar.
  return Math.max(19, Math.min(36, Math.floor(_CART_ANCHO_MODELO / (_CART_EM_MODELO * n))));
}

function cartTamPrecio(s) {
  const n = String(s || '').length;     // "$1.250.000" = 10
  if (n <= 10) return 46;
  if (n <= 12) return 39;
  return 33;
}

function cartTamCuota(s) {
  const n = String(s || '').length;
  if (n <= 9) return 30;
  if (n <= 11) return 26;
  return 22;
}

// ── Un cartel ─────────────────────────────────────────────
const _CART_ESCUDO = '<svg class="c-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5.4c0 4.3-2.9 7.6-7 8.6-4.1-1-7-4.3-7-8.6V6l7-3z"/><path d="M9 12l2.2 2.2L15.2 10"/></svg>';
const _CART_PILA = '<svg class="c-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="17" height="10" rx="2.5"/><path d="M21.6 11v2"/><rect x="4.6" y="9.6" width="8.6" height="4.8" rx="1" fill="currentColor" stroke="none"/></svg>';

// `p` ya viene con los retoques de esta impresión aplicados (cartPintado).
function cartelHtml(p, cfg) {
  const c = cfg || CART_CFG;
  const precio = cartRedondear(cartPrecioArs(p));
  const precioTxt = cartPlata(precio);
  const cuotaTxt = cartPlata(cartCuota(precio));
  const alm = cartMedida(p.almacenamiento);
  const ram = cartMedida(p.ram);
  const gar = cartGarantiaTxt(p, c);
  const bat = cartLlevaBateria(p) ? Math.min(100, Math.round(Number(p.bateria))) : 0;
  const modelo = String(p.modelo || '').trim();

  // Sin RAM cargada, la casilla de almacenamiento ocupa todo el ancho: una
  // casilla vacía al lado parece un cartel a medio hacer.
  const casillas = [
    alm ? `<div class="c-box"><span class="c-lbl">Almacenamiento</span><span class="c-val">${_cartEsc(alm)}</span></div>` : '',
    ram ? `<div class="c-box"><span class="c-lbl">RAM</span><span class="c-val">${_cartEsc(ram)}</span></div>` : '',
  ].filter(Boolean);

  return `<article class="cartel">
  <div class="c-top">
    <div class="c-top-fila">
      <span class="c-biz">TECHPOINT</span>
      <span class="c-pastilla">${_cartEsc(cartEstadoTxt(p))}</span>
    </div>
    <div class="c-marca">${_cartEsc(p.marca || '')}</div>
    <div class="c-modelo" style="font-size:${cartTamModelo(modelo)}px">${_cartEsc(modelo)}</div>
  </div>
  ${casillas.length ? `<div class="c-casillas${casillas.length === 1 ? ' c-casillas--una' : ''}">${casillas.join('')}</div>` : ''}
  ${gar || bat ? `<div class="c-fila-gar">
    ${gar ? `<div class="c-gar">${_CART_ESCUDO}<span>Garantía ${_cartEsc(gar)}</span></div>` : ''}
    ${bat ? `<div class="c-bat">${_CART_PILA}<span>${bat}%</span></div>` : ''}
  </div>` : ''}
  <div class="c-sp"></div>
  <div class="c-efec">
    <span class="c-efec-lbl">Efectivo o transferencia</span>
    <span class="c-efec-val" style="font-size:${cartTamPrecio(precioTxt)}px">${_cartEsc(precioTxt)}</span>
  </div>
  <div class="c-tar">
    <span class="c-tar-izq">
      <b class="c-tar-top">Con tarjeta</b>
      <small class="c-tar-sub">3 cuotas de</small>
    </span>
    <span class="c-tar-val" style="font-size:${cartTamCuota(cuotaTxt)}px">${_cartEsc(cuotaTxt)}</span>
  </div>
</article>`;
}

// ── La hoja ───────────────────────────────────────────────
function cartHojas(lista) {
  const out = [];
  const l = Array.isArray(lista) ? lista : [];
  for (let i = 0; i < l.length; i += CART_X_HOJA) out.push(l.slice(i, i + CART_X_HOJA));
  return out;
}

// El CSS del cartel vive acá y no en style.css porque viaja DENTRO del
// documento que se imprime (como las etiquetas). La vista previa usa el mismo
// documento, así que lo que se ve es exactamente lo que sale.
function _cartCss(color) {
  return `
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:'Baloo 2','Segoe UI',system-ui,sans-serif;color:#16161D;background:#fff;
  print-color-adjust:exact;-webkit-print-color-adjust:exact}
/* La hoja: 297×210mm. La altura va un pelo corta porque a la medida exacta
   Chrome a veces se pasa un pixel y manda una hoja en blanco atrás. */
.hoja{width:297mm;height:209.5mm;padding:14px;overflow:hidden;
  display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,1fr);
  break-after:page;page-break-after:always}
.hoja:last-child{break-after:auto;page-break-after:auto}
/* El borde punteado es la línea de corte. */
.celda{border:1px dashed #9A9AA8;display:flex;justify-content:center;align-items:flex-start;
  overflow:hidden;min-width:0;min-height:0}
.celda--vacia{border:0}
/* El cartel se diseña a 280×397px (A7 justo) y se achica un poco: así queda
   en ~71×100mm y deja margen para las impresoras que no llegan al borde. */
/* El interlineado apretado NO es decoración: con el de fábrica de Baloo 2 el
   contenido daba 422px contra los 397 del cartel y la franja negra de la
   tarjeta se cortaba abajo en TODOS. Se vio recién al dibujarlo. */
.cartel{width:280px;height:397px;transform:scale(.955);transform-origin:top center;
  background:#fff;display:flex;flex-direction:column;padding:10px;gap:8px;line-height:1.1}
.c-top{background:${color};color:#fff;border-radius:18px;padding:14px 14px 16px}
.c-top-fila{display:flex;align-items:center;justify-content:space-between;gap:8px}
.c-biz{font-size:12px;font-weight:800;letter-spacing:.12em}
.c-pastilla{background:#fff;color:${color};font-size:12px;font-weight:800;
  border-radius:999px;padding:2px 10px;white-space:nowrap}
.c-marca{font-size:19px;font-weight:600;margin-top:6px}
/* Dos renglones como máximo: con tres el cartel se desarma. */
.c-modelo{font-weight:800;line-height:1.05;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden}
.c-casillas{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.c-casillas--una{grid-template-columns:1fr}
.c-box{background:#E3E5EE;border-radius:14px;padding:8px 12px;display:flex;flex-direction:column}
.c-lbl{font-size:13px;font-weight:600;color:#3E3E52}
.c-val{font-size:24px;font-weight:800;line-height:1.1}
.c-fila-gar{display:flex;gap:8px}
.c-gar{flex:1;border:2px solid ${color};border-radius:14px;padding:8px 10px;color:${color};
  font-size:16px;font-weight:800;white-space:nowrap;display:flex;align-items:center;gap:6px}
.c-bat{background:#E3E5EE;border-radius:14px;padding:8px 10px;font-size:16px;font-weight:800;
  display:flex;align-items:center;gap:5px;white-space:nowrap}
.c-ico{width:18px;height:18px;flex:none}
.c-sp{flex-grow:1}
.c-efec{display:flex;flex-direction:column}
.c-efec-lbl{font-size:15px;font-weight:700;color:#3E3E52}
.c-efec-val{font-weight:800;color:${color};line-height:1;white-space:nowrap}
.c-tar{background:#000;color:#fff;border-radius:14px;padding:8px 12px;
  display:flex;align-items:center;justify-content:space-between;gap:8px}
.c-tar-izq{display:flex;flex-direction:column}
.c-tar-top{font-size:17px;font-weight:800;white-space:nowrap}
.c-tar-sub{font-size:15px;font-weight:600;color:#E2E2EA;white-space:nowrap}
.c-tar-val{font-weight:800;white-space:nowrap}
/* Solo en la vista previa: se ven los bordes de cada hoja. Al imprimir no. */
@media screen{
  body{background:#e9e9ee}
  .hoja{background:#fff;margin:0 auto 14px;box-shadow:0 2px 10px rgba(0,0,0,.18)}
}`;
}

// El documento entero, el mismo para la vista previa y para la impresora.
function cartDocumento(lista, cfg) {
  const c = cfg || CART_CFG;
  const hojas = cartHojas(lista);
  const cuerpo = hojas.map(hoja => {
    const celdas = [];
    for (let i = 0; i < CART_X_HOJA; i++) {
      // Los lugares que sobran quedan pelados: sin cartel y sin línea de
      // corte, para no andar cortando aire.
      celdas.push(hoja[i]
        ? `<div class="celda">${cartelHtml(hoja[i], c)}</div>`
        : '<div class="celda celda--vacia"></div>');
    }
    return `<section class="hoja">${celdas.join('')}</section>`;
  }).join('\n');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Carteles — TechPoint</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&display=swap">
<style>${_cartCss(c.color || CART_DEF.color)}</style></head><body>
${cuerpo}
</body></html>`;
}

// ══════════════════════════════════════════════════════════
//  EL CUADRO: elegir, retocar, ver y imprimir
// ══════════════════════════════════════════════════════════
let _cartBase = [];        // los que se pueden poner en un cartel
let _cartSel = [];         // ids EN ORDEN DE SELECCIÓN (el del cartel)
let _cartFuera = [];       // los que quedaron afuera por el precio
let _cartRetoques = {};    // { id: {modelo, precio} } — solo esta impresión
let _cartEditando = null;  // id del que está abierto para retocar

const _cartV = id => (document.getElementById(id)?.value || '').trim();

function _cartVisibles() {
  const q = _cartV('cart-f-buscar');
  const est = _cartV('cart-f-estado');
  return _cartBase.filter(p => {
    if (est === 'Nuevo' && !cartEsNuevo(p)) return false;
    // Usado incluye los reacondicionados: para el cliente son lo mismo.
    if (est === 'Usado' && cartEsNuevo(p)) return false;
    if (q) {
      const hay = `${p.marca || ''} ${p.modelo || ''} ${p.almacenamiento || ''}`;
      return (typeof searchMatch === 'function') ? searchMatch(hay, q)
        : hay.toLowerCase().includes(q.toLowerCase());
    }
    return true;
  });
}

// El equipo con los retoques de esta impresión encima. No toca la base.
function cartPintado(p) {
  const r = _cartRetoques[p.id];
  if (!r) return p;
  const out = { ...p };
  if (r.modelo) out.modelo = r.modelo;
  if (Number(r.precio) > 0) { out.precio = Number(r.precio); out.precioUSD = 0; out.moneda = 'ars'; }
  return out;
}

function _cartElegidos() {
  return _cartSel.map(id => _cartBase.find(p => p.id === id)).filter(Boolean).map(cartPintado);
}

// `preSel` = los equipos del modo "seleccionar varios".
function cartAbrir(preSel) {
  const modal = document.getElementById('carteles-modal');
  if (!modal) return;
  cartCargarCfg();
  const todos = (Array.isArray(preSel) && preSel.length)
    ? preSel
    : (typeof STOCK !== 'undefined' && Array.isArray(STOCK) ? STOCK : []);
  const disponibles = todos.filter(p => p && !p.vendido && !p.reservado && !p.eliminado);
  _cartBase = disponibles.filter(cartPublicable);
  _cartFuera = disponibles.filter(p => !cartPublicable(p));
  _cartRetoques = {};
  _cartEditando = null;
  const set = (k, v) => { const el = document.getElementById(k); if (el) el.value = v; };
  set('cart-f-buscar', '');
  set('cart-f-estado', '');
  set('cart-gar-nuevo', CART_CFG.garNuevo || '');
  set('cart-gar-usado', CART_CFG.garUsado || '');
  // Si venís de elegir equipos a mano, arrancan todos tildados; si abrís la
  // lista entera, ninguno (son 40 y no se imprimen 40 carteles).
  _cartSel = (Array.isArray(preSel) && preSel.length) ? _cartBase.map(p => p.id) : [];
  cartPintarColores();
  cartRender();
  document.getElementById('carteles-overlay')?.classList.remove('hidden');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function cartCerrar() {
  document.getElementById('carteles-overlay')?.classList.add('hidden');
  document.getElementById('carteles-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

function cartFiltrar() { cartRender(); }

function cartTocar(id) {
  const i = _cartSel.indexOf(id);
  if (i >= 0) _cartSel.splice(i, 1); else _cartSel.push(id);
  cartRender();
}

function cartTodos(v) {
  const vis = _cartVisibles();
  if (v) vis.forEach(p => { if (!_cartSel.includes(p.id)) _cartSel.push(p.id); });
  else   vis.forEach(p => { const i = _cartSel.indexOf(p.id); if (i >= 0) _cartSel.splice(i, 1); });
  cartRender();
}

function cartEditar(id) {
  _cartEditando = _cartEditando === id ? null : id;
  cartRender();
}

// Lo retocado vale SOLO para esta impresión: el equipo en la base queda como
// está. Es para abreviar un modelo largo o poner un precio de oferta del día
// sin tocar el stock.
function cartGuardarRetoque(id) {
  const modelo = _cartV('cart-ed-modelo');
  const precio = Number(String(_cartV('cart-ed-precio')).replace(/[^\d]/g, '')) || 0;
  const r = {};
  if (modelo) r.modelo = modelo;
  if (precio > 0) r.precio = precio;
  if (Object.keys(r).length) _cartRetoques[id] = r; else delete _cartRetoques[id];
  _cartEditando = null;
  cartRender();
}

function cartBorrarRetoque(id) {
  delete _cartRetoques[id];
  _cartEditando = null;
  cartRender();
}

function cartRender() {
  const vis = _cartVisibles();
  const cont = document.getElementById('carteles-lista');
  if (cont) {
    // Se reusan las clases .lwa-* de la lista de WhatsApp: es la misma cosa
    // (una fila con tilde, nombre y precio) y no vale duplicar el CSS.
    cont.innerHTML = vis.length ? vis.map(p => {
      const on = _cartSel.includes(p.id);
      const pos = _cartSel.indexOf(p.id) + 1;
      const pin = cartPintado(p);
      const meta = [cartMedida(pin.almacenamiento), cartEstadoTxt(pin)].filter(Boolean).join(' · ');
      const tocado = !!_cartRetoques[p.id];
      const abierto = _cartEditando === p.id;
      return `<div class="lwa-item cart-item${on ? ' lwa-item--on' : ''}" data-cid="${_cartEsc(p.id)}" onclick="cartTocar('${_cartEsc(p.id)}')">
        <input type="checkbox" ${on ? 'checked' : ''} onclick="event.stopPropagation();cartTocar('${_cartEsc(p.id)}')">
        <span class="lwa-item-txt">
          <span class="lwa-item-nom">${on ? `<b class="cart-nro">${pos}</b>` : ''}${_cartEsc(pin.marca || '')} ${_cartEsc(pin.modelo || '')}${tocado ? ' <span class="cart-tag">retocado</span>' : ''}</span>
          ${meta ? `<span class="lwa-item-meta">${_cartEsc(meta)}</span>` : ''}
        </span>
        <b class="lwa-item-precio">${cartPlata(cartRedondear(cartPrecioArs(pin)))}</b>
        <button type="button" class="cart-lapiz" title="Retocar este cartel"
          onclick="event.stopPropagation();cartEditar('${_cartEsc(p.id)}')">✏️</button>
      </div>
      ${abierto ? `<div class="cart-ed" onclick="event.stopPropagation()">
        <p class="cart-ed-nota">Solo para esta impresión. El equipo en el stock no se toca.</p>
        <input id="cart-ed-modelo" class="fi" type="text" placeholder="Modelo del cartel" value="${_cartEsc((_cartRetoques[p.id] || {}).modelo || pin.modelo || '')}">
        <input id="cart-ed-precio" class="fi" type="number" inputmode="numeric" placeholder="Precio del cartel" value="${(_cartRetoques[p.id] || {}).precio || ''}">
        <div class="cart-ed-btns">
          <button type="button" class="tpent-btn tpent-btn--si" onclick="cartGuardarRetoque('${_cartEsc(p.id)}')">Listo</button>
          <button type="button" class="tpent-btn" onclick="cartBorrarRetoque('${_cartEsc(p.id)}')">Como está en el stock</button>
        </div>
      </div>` : ''}`;
    }).join('') : '<p class="lwa-vacio">Ningún equipo con estos filtros.</p>';
  }

  const cuenta = document.getElementById('carteles-cuenta');
  if (cuenta) {
    const hojas = cartHojas(_cartSel).length;
    cuenta.textContent = _cartSel.length
      ? `${_cartSel.length} elegido${_cartSel.length !== 1 ? 's' : ''} · ${hojas} hoja${hojas !== 1 ? 's' : ''}`
      : `0 elegidos de ${vis.length}`;
  }

  const nota = document.getElementById('carteles-nota');
  if (nota) {
    nota.textContent = _cartFuera.length
      ? `${_cartFuera.length} equipo${_cartFuera.length !== 1 ? 's' : ''} sin precio (o en dólares sin cotización) queda${_cartFuera.length !== 1 ? 'n' : ''} afuera: un cartel con un precio raro es peor que ninguno.`
      : 'Tildá los equipos. Salen en el orden en que los tildás, 8 por hoja.';
  }

  const btn = document.getElementById('carteles-imprimir');
  if (btn) btn.disabled = !_cartSel.length;
  cartPintarPreview();
}

function cartPintarColores() {
  const cont = document.getElementById('carteles-colores');
  if (!cont) return;
  cont.innerHTML = CART_COLORES.map(c =>
    `<button type="button" class="cart-color${c === CART_CFG.color ? ' cart-color--on' : ''}"
      style="background:${c}" data-color="${c}" title="${c}" onclick="cartColor('${c}')"></button>`).join('');
}

function cartColor(c) {
  CART_CFG.color = c;
  cartGuardarCfg();
  cartPintarColores();
  cartPintarPreview();
}

function cartGuardarGarantias() {
  CART_CFG.garNuevo = _cartV('cart-gar-nuevo') || CART_DEF.garNuevo;
  CART_CFG.garUsado = _cartV('cart-gar-usado') || CART_DEF.garUsado;
  cartGuardarCfg();
  cartPintarPreview();
  if (typeof toast === 'function') toast('✅ Guardado', 'success');
}

function cartAjustesToggle() {
  document.getElementById('carteles-ajustes')?.classList.toggle('hidden');
  const r = document.getElementById('carteles-recargo');
  if (r) r.textContent = `Recargo de 3 cuotas: ${cartRecargo()}% — se cambia en ⚙️ Configuración, junto con el de la ficha del equipo.`;
}

// La vista previa es el MISMO documento que se imprime, metido en un marco y
// achicado para que entre en la pantalla. Así no hay forma de que se vea una
// cosa y salga otra.
function cartPintarPreview() {
  const marco = document.getElementById('carteles-preview');
  const wrap = document.getElementById('carteles-preview-wrap');
  if (!marco || !wrap) return;
  const elegidos = _cartElegidos();
  if (!elegidos.length) { marco.removeAttribute('srcdoc'); wrap.style.height = '0px'; return; }
  const hojas = cartHojas(elegidos).length;
  const anchoHoja = 1123;                             // 297mm a 96 dpi
  const esc = Math.min(1, (wrap.clientWidth || 320) / anchoHoja);
  marco.style.transform = `scale(${esc})`;
  marco.style.height = (794 * hojas + 14 * hojas + 10) + 'px';
  wrap.style.height = Math.round((794 * hojas + 14 * hojas + 10) * esc) + 'px';
  marco.srcdoc = cartDocumento(elegidos);
}

function cartImprimir() {
  const elegidos = _cartElegidos();
  if (!elegidos.length) { if (typeof toast === 'function') toast('Tildá al menos un equipo', 'info'); return; }
  const html = cartDocumento(elegidos);
  // Por el diálogo del navegador a propósito: estos carteles son a color y la
  // impresora del QZ es la del mostrador (blanco y negro). Así elegís la
  // impresora y A4 apaisado a mano.
  if (typeof _openPrint === 'function') _openPrint(html, 'Carteles');
  else {
    const w = window.open('', '_blank', 'width=900,height=700,scrollbars=yes');
    if (!w) { alert('Habilitá los popups para imprimir.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
    w.addEventListener('load', () => { w.focus(); setTimeout(() => w.print(), 350); });
  }
}
