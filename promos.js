// ══════════════════════════════════════════════════════════════
//  🏷️ Promos automáticas (2x1, 2 x $tanto, 3x2, % llevando varias)
// ══════════════════════════════════════════════════════════════
//  Alan (13/11): "a veces hago promo de 2 x tanto o 2x1 en fundas y en otras
//  cosas… el tema es que se descuenten las fundas". Antes la promo se hacía
//  cobrando una sola funda o tocando el total, y del stock bajaba una (o el
//  precio quedaba a ojo). Ahora el dueño define la promo por categoría y la
//  caja la aplica sola: se escanean TODAS las fundas, cada una baja del
//  stock, y el precio de cada renglón se acomoda.
//
//  La promo se aplica bajando el precio de los renglones (no como un
//  descuento aparte): así el total, la ganancia, el ticket y la factura
//  salen bien sin tocar nada más.
//
//  Una promo: { id, categoria, tipo, n, m, precio, pct, activa }
//    tipo 'nxm'      → llevando n pagás m   (2x1: n=2 m=1 · 3x2: n=3 m=2)
//    tipo 'nxprecio' → n por $precio        (2 x $10.000)
//    tipo 'pct'      → pct% llevando n o más

let PROMOS = [];

const _promoFmt = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const _promoCat = s => String(s == null ? '' : s).trim().toLowerCase();

// Cómo se llama en el carrito y en el ticket
function promoNombre(p) {
  if (!p) return '';
  if (p.tipo === 'nxm') return `${p.n}x${p.m}`;
  if (p.tipo === 'nxprecio') return `${p.n} x ${_promoFmt(p.precio)}`;
  if (p.tipo === 'pct') return Number(p.n) > 1 ? `${p.pct}% llevando ${p.n}` : `${p.pct}% off`;
  return '';
}

// ¿Está bien armada? (un 2x2 o un 0% no son promos)
function promoValida(p) {
  if (!p || !_promoCat(p.categoria)) return false;
  const n = Number(p.n), m = Number(p.m), precio = Number(p.precio), pct = Number(p.pct);
  const entero = x => Number.isInteger(x) && x >= 1 && x <= 99;
  if (p.tipo === 'nxm') return entero(n) && entero(m) && n > m;
  if (p.tipo === 'nxprecio') return entero(n) && n >= 2 && precio > 0;
  if (p.tipo === 'pct') return entero(n) && pct > 0 && pct < 100;
  return false;
}

// ¿Este renglón puede entrar en una promo? Solo accesorios del inventario a
// precio de lista: lo que va sin cargo, lo que tiene un precio hecho a mano y
// lo que el cajero sacó de la promo (↩) quedan como están.
function _promoEntra(it) {
  return !!it && it.source === 'producto' && !it.regalo && !it.precioMano && !it.sinPromo &&
    Number(it.precioLista) > 0 && !!_promoCat(it.categoria);
}

// Cuánto descuenta una promo sobre estas unidades (precios de lista, de mayor
// a menor). Lo que se regala o se agrupa siempre a favor del cliente como en
// cualquier comercio: gratis van las más baratas.
function promoDescuento(p, precios) {
  const u = precios.slice().sort((a, b) => b - a);
  const n = Number(p.n);
  if (p.tipo === 'pct') {
    if (u.length < n) return 0;
    return Math.round(u.reduce((s, x) => s + x, 0) * Number(p.pct) / 100);
  }
  const grupos = Math.floor(u.length / n);
  if (!grupos) return 0;
  if (p.tipo === 'nxm') {
    const gratis = grupos * (n - Number(p.m));
    return u.slice(u.length - gratis).reduce((s, x) => s + x, 0);
  }
  if (p.tipo === 'nxprecio') {
    // Las que no completan un grupo (la tercera de un "2 x $") quedan a su
    // precio. Si la promo saliera más cara que la lista, no se aplica.
    const enPromo = u.slice(0, grupos * n).reduce((s, x) => s + x, 0);
    return Math.max(0, enPromo - grupos * Number(p.precio));
  }
  return 0;
}

// Aplica las promos al carrito (cambia `precio` y marca `promo` en cada
// renglón) y devuelve cuánto se descontó en total. Se puede llamar las veces
// que haga falta: siempre arranca del precio de lista.
function promosAplicar(cart, promos) {
  const lista = Array.isArray(cart) ? cart : [];
  // 1) Todo lo que puede entrar vuelve a su precio de lista
  lista.forEach(it => {
    if (!it) return;
    delete it.promo;
    if (_promoEntra(it)) it.precio = Number(it.precioLista);
  });
  const activas = (Array.isArray(promos) ? promos : []).filter(p => p && p.activa !== false && promoValida(p));
  if (!activas.length) return 0;

  // 2) Por categoría: la promo que más descuenta
  const porCat = {};
  lista.forEach(it => { if (_promoEntra(it)) (porCat[_promoCat(it.categoria)] = porCat[_promoCat(it.categoria)] || []).push(it); });
  let total = 0;
  Object.keys(porCat).forEach(cat => {
    const items = porCat[cat];
    const precios = [];
    items.forEach(it => { for (let k = 0; k < Math.max(1, Number(it.qty) || 1); k++) precios.push(Number(it.precioLista)); });
    let mejor = null, desc = 0;
    activas.filter(p => _promoCat(p.categoria) === cat).forEach(p => {
      const d = promoDescuento(p, precios);
      if (d > desc) { desc = d; mejor = p; }
    });
    if (!mejor || desc <= 0) return;
    // 3) El descuento se reparte parejo entre los renglones (en proporción a
    // su precio): dos fundas de $6.000 en 2x1 quedan a $3.000 cada una.
    const suma = precios.reduce((s, x) => s + x, 0);
    const factor = 1 - desc / suma;
    items.forEach(it => {
      it.precio = Math.round(Number(it.precioLista) * factor * 100) / 100;
      it.promo = { nombre: promoNombre(mejor), id: mejor.id || null };
    });
    total += desc;
  });
  return total;
}

// "Con una más entra en la promo": para que el cajero la ofrezca.
function promosAvisos(cart, promos) {
  const activas = (Array.isArray(promos) ? promos : []).filter(p => p && p.activa !== false && promoValida(p));
  const cant = {}, nombre = {};
  (Array.isArray(cart) ? cart : []).forEach(it => {
    if (!_promoEntra(it)) return;
    const c = _promoCat(it.categoria);
    cant[c] = (cant[c] || 0) + Math.max(1, Number(it.qty) || 1);
    nombre[c] = String(it.categoria).trim();
  });
  const out = [];
  activas.forEach(p => {
    const c = _promoCat(p.categoria), u = cant[c] || 0, n = Number(p.n);
    if (!u || n < 2) return;
    const falta = p.tipo === 'pct' ? (u === n - 1) : (u % n === n - 1);
    if (falta) out.push(`🏷️ Con 1 más de ${nombre[c]} entra la promo ${promoNombre(p)}`);
  });
  return out;
}

// ── Guardado (config/promos) ────────────────────────────────
// Un solo documento con la lista: una lectura al abrir la caja y queda
// escuchando (si el dueño prende una promo, las otras compus se enteran).
let _promosEscuchando = false;
function promosEscuchar() {
  try { const c = JSON.parse(localStorage.getItem('tpPromos') || 'null'); if (Array.isArray(c)) PROMOS = c; } catch {}
  if (_promosEscuchando || typeof db === 'undefined' || !db) return;
  _promosEscuchando = true;
  db.collection('config').doc('promos').onSnapshot(d => {
    const l = d.exists ? (d.data().lista || []) : [];
    PROMOS = Array.isArray(l) ? l : [];
    try { localStorage.setItem('tpPromos', JSON.stringify(PROMOS)); } catch {}
    if (typeof _renderCart === 'function' && typeof _cart !== 'undefined' && _cart.length) {
      _renderCart();
      if (typeof _syncMontoFromCart === 'function') _syncMontoFromCart();
      if (typeof _updateMovResumen === 'function') _updateMovResumen();
    }
    if (document.getElementById('promos-modal')) _promosPintar();
  }, e => { _promosEscuchando = false; console.warn('promos:', e); });
}

async function _promosGuardar(lista) {
  await db.collection('config').doc('promos').set({ lista, actualizado: new Date().toISOString() });
  PROMOS = lista;
  try { localStorage.setItem('tpPromos', JSON.stringify(PROMOS)); } catch {}
}

// ── Pantalla del dueño ──────────────────────────────────────
function _promosEstilos() {
  if (document.getElementById('promos-css')) return;
  const s = document.createElement('style');
  s.id = 'promos-css';
  // Los estilos van desde acá porque el CSS se sirve del caché
  s.textContent = `
  #promos-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 2000; }
  #promos-modal { position: fixed; z-index: 2001; left: 50%; top: 50%; transform: translate(-50%,-50%);
    width: min(520px, 94vw); max-height: 90vh; overflow: auto; background: var(--card, #1b2130);
    color: var(--text, #e8ecf3); border-radius: 16px; padding: 18px; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
  #promos-modal h3 { margin: 0 0 4px; font-size: 1.15rem; }
  #promos-modal .pr-sub { opacity: .75; font-size: .85rem; margin-bottom: 12px; }
  .pr-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid rgba(128,128,128,.3);
    border-radius: 12px; margin-bottom: 8px; }
  .pr-item--off { opacity: .55; }
  .pr-item-main { flex: 1; min-width: 0; }
  .pr-item-main b { display: block; font-size: 1rem; }
  .pr-item-main small { opacity: .75; }
  .pr-btn { border: 0; border-radius: 10px; padding: 9px 12px; font-weight: 700; cursor: pointer; font-size: .85rem; }
  .pr-btn--on { background: #16a34a; color: #fff; }
  .pr-btn--off { background: rgba(128,128,128,.3); color: inherit; }
  .pr-btn--del { background: transparent; color: #ef4444; font-size: 1.1rem; padding: 6px 8px; }
  .pr-form { border-top: 1px solid rgba(128,128,128,.3); margin-top: 12px; padding-top: 12px; display: grid; gap: 8px; }
  .pr-form label { font-size: .8rem; opacity: .8; display: grid; gap: 4px; }
  .pr-form select, .pr-form input { padding: 10px; border-radius: 10px; border: 1px solid rgba(128,128,128,.4);
    background: transparent; color: inherit; font-size: 1rem; width: 100%; box-sizing: border-box; }
  .pr-form select option { color: #111; }
  .pr-fila { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .pr-ej { font-size: .85rem; opacity: .85; min-height: 1.2em; }
  .pr-acciones { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
  .pr-btn--ok { background: var(--accent, #3b82f6); color: #fff; padding: 11px 16px; }
  .cart-promo-aviso { font-size: .82rem; padding: 6px 10px; border-radius: 10px; margin-top: 6px;
    background: rgba(22,163,74,.15); color: #16a34a; font-weight: 600; }
  .cart-line-precio--promo { border: 1px solid #16a34a; border-radius: 10px; }
  .cart-line-precio--promo small { color: #16a34a; font-weight: 700; }`;
  document.head.appendChild(s);
}

function promosAbrir() {
  if (typeof tpEsDueno === 'function' && !tpEsDueno()) { toast('Las promos las arma el dueño', 'error'); return; }
  promosCerrar();
  _promosEstilos();
  promosEscuchar();
  const ov = document.createElement('div');
  ov.id = 'promos-overlay';
  ov.onclick = promosCerrar;
  const m = document.createElement('div');
  m.id = 'promos-modal';
  document.body.appendChild(ov);
  document.body.appendChild(m);
  _promosPintar();
}

function promosCerrar() {
  ['promos-overlay', 'promos-modal'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
}

function _promosPintar() {
  const m = document.getElementById('promos-modal');
  if (!m) return;
  // No pisar lo que se está escribiendo en el formulario
  const previo = {};
  ['pr-cat', 'pr-tipo', 'pr-n', 'pr-m', 'pr-precio', 'pr-pct'].forEach(id => { const e = document.getElementById(id); if (e) previo[id] = e.value; });
  const cats = (typeof invCategorias === 'function') ? invCategorias() : [];
  const filas = PROMOS.length ? PROMOS.map((p, i) => `
    <div class="pr-item${p.activa === false ? ' pr-item--off' : ''}">
      <div class="pr-item-main"><b>🏷️ ${esc(promoNombre(p))}</b><small>en ${esc(p.categoria)}</small></div>
      <button type="button" class="pr-btn ${p.activa === false ? 'pr-btn--off' : 'pr-btn--on'}" onclick="promosPrender(${i})">${p.activa === false ? 'Apagada' : '✓ Prendida'}</button>
      <button type="button" class="pr-btn pr-btn--del" onclick="promosBorrar(${i})" title="Borrar">🗑</button>
    </div>`).join('') : '<div class="pr-sub">Todavía no armaste ninguna promo.</div>';
  m.innerHTML = `
    <h3>🏷️ Promos</h3>
    <div class="pr-sub">La caja las aplica sola al escanear. Escaneá <b>todas</b> las unidades que se llevan: cada una baja del stock.</div>
    ${filas}
    <div class="pr-form">
      <b>Nueva promo</b>
      <label>¿En qué categoría?
        <select id="pr-cat">${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      </label>
      <label>¿Qué promo?
        <select id="pr-tipo" onchange="_promosTipo()">
          <option value="nxm">Llevá tantas, pagá menos (2x1, 3x2)</option>
          <option value="nxprecio">Tantas por un precio (2 x $10.000)</option>
          <option value="pct">Un % de descuento llevando varias</option>
        </select>
      </label>
      <div class="pr-fila">
        <label>Llevando<input id="pr-n" type="number" min="1" max="99" inputmode="numeric" value="2" oninput="_promosEjemplo()"></label>
        <label id="pr-m-wrap">Paga<input id="pr-m" type="number" min="1" max="98" inputmode="numeric" value="1" oninput="_promosEjemplo()"></label>
        <label id="pr-precio-wrap" style="display:none">Por $ (todas juntas)<input id="pr-precio" type="number" min="1" inputmode="numeric" placeholder="10000" oninput="_promosEjemplo()"></label>
        <label id="pr-pct-wrap" style="display:none">% de descuento<input id="pr-pct" type="number" min="1" max="99" inputmode="numeric" placeholder="20" oninput="_promosEjemplo()"></label>
      </div>
      <div class="pr-ej" id="pr-ej"></div>
      <div class="pr-acciones">
        <button type="button" class="pr-btn pr-btn--off" onclick="promosCerrar()">Cerrar</button>
        <button type="button" class="pr-btn pr-btn--ok" onclick="promosAgregar()">＋ Agregar promo</button>
      </div>
    </div>`;
  Object.keys(previo).forEach(id => { const e = document.getElementById(id); if (e && previo[id] !== '') e.value = previo[id]; });
  _promosTipo();
}

function _promosTipo() {
  const t = (document.getElementById('pr-tipo') || {}).value || 'nxm';
  const ver = (id, si) => { const e = document.getElementById(id); if (e) e.style.display = si ? '' : 'none'; };
  ver('pr-m-wrap', t === 'nxm');
  ver('pr-precio-wrap', t === 'nxprecio');
  ver('pr-pct-wrap', t === 'pct');
  _promosEjemplo();
}

function _promosDelForm() {
  const v = id => (document.getElementById(id) || {}).value;
  const tipo = v('pr-tipo') || 'nxm';
  const p = { categoria: String(v('pr-cat') || '').trim(), tipo, n: parseInt(v('pr-n'), 10) || 0, activa: true };
  if (tipo === 'nxm') p.m = parseInt(v('pr-m'), 10) || 0;
  if (tipo === 'nxprecio') p.precio = Math.round(parseFloat(v('pr-precio')) || 0);
  if (tipo === 'pct') p.pct = parseFloat(v('pr-pct')) || 0;
  return p;
}

function _promosEjemplo() {
  const el = document.getElementById('pr-ej');
  if (!el) return;
  const p = _promosDelForm();
  el.textContent = promoValida(p) ? `Queda: ${promoNombre(p)} en ${p.categoria}` : '';
}

async function promosAgregar() {
  const p = _promosDelForm();
  if (!p.categoria) { toast('Elegí la categoría (cargá primero los productos en el inventario)', 'error'); return; }
  if (!promoValida(p)) { toast('Revisá los números de la promo', 'error'); return; }
  p.id = 'p' + Date.now().toString(36);
  try {
    await _promosGuardar(PROMOS.concat([p]));
    toast(`🏷️ Promo ${promoNombre(p)} en ${p.categoria}: prendida`, 'success');
    _promosPintar();
  } catch (e) { console.error('promos:', e); toast('No se pudo guardar la promo', 'error'); }
}

async function promosPrender(i) {
  if (!PROMOS[i]) return;
  const lista = PROMOS.map((p, k) => k === i ? Object.assign({}, p, { activa: p.activa === false }) : p);
  try { await _promosGuardar(lista); _promosPintar(); }
  catch (e) { console.error('promos:', e); toast('No se pudo guardar', 'error'); }
}

async function promosBorrar(i) {
  const p = PROMOS[i];
  if (!p || !confirm(`¿Borrar la promo ${promoNombre(p)} en ${p.categoria}?`)) return;
  try { await _promosGuardar(PROMOS.filter((_, k) => k !== i)); _promosPintar(); }
  catch (e) { console.error('promos:', e); toast('No se pudo borrar', 'error'); }
}
