// ══════════════════════════════════════════════════════════
//  ARTÍCULOS EN LA MISMA VENTA
// ══════════════════════════════════════════════════════════
// Vendés un celular y el cliente se lleva la funda. Entregás una reparación y
// se lleva un vidrio. Antes eso eran dos operaciones: la del formulario donde
// estabas, y después otra en la caja, con el cliente esperando.
//
// Este bloque se mete adentro de esos dos formularios y suma los artículos a
// la MISMA venta: un solo movimiento, con el monto del equipo (o de la
// reparación) y el de los artículos separados, el stock descontado y todo en
// el mismo comprobante.
//
// Es uno solo para las dos pantallas. En la caja reusa la lista de accesorios
// que ya está cargada; en Reparaciones, que no la tiene, la pide recién al
// abrir el cobro — nunca al abrir la pantalla, que es la regla de cupo.

let VA_ITEMS = [];          // lo que se está por vender junto
let VA_PRODUCTOS = null;    // lista propia (solo donde no existe PRODUCTOS)
let _vaListener = null;
let _vaCont = null;         // id del contenedor montado
let _vaOnCambio = null;     // para que el formulario recalcule su total

// La lista donde buscar. En caja.html `PRODUCTOS` lo mantiene inventario.js.
function vaLista() {
  if (typeof PRODUCTOS !== 'undefined' && Array.isArray(PRODUCTOS) && PRODUCTOS.length) return PRODUCTOS;
  return VA_PRODUCTOS || [];
}

// Se llama al ABRIR el formulario, no al cargar la página.
function vaAsegurarProductos() {
  // En la caja es el mismo listener del inventario: no se lee dos veces.
  if (typeof _listenProductos === 'function') { _listenProductos(); return; }
  if (_vaListener || typeof db === 'undefined' || !db) return;
  _vaListener = db.collection('productos').onSnapshot(snap => {
    VA_PRODUCTOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (_vaCont) _vaRender();
  }, err => console.error('[articulos] productos:', err));
}

// ── Montaje ───────────────────────────────────────────────
function vaMontar(contenedorId, onCambio) {
  const cont = document.getElementById(contenedorId);
  if (!cont) return;
  _vaCont = contenedorId;
  _vaOnCambio = typeof onCambio === 'function' ? onCambio : null;
  VA_ITEMS = [];
  cont.innerHTML = `
    <div class="va-head">
      <span class="va-titulo">🛍️ Artículos en la misma venta</span>
      <span class="va-sub">funda, vidrio, cargador…</span>
    </div>
    <div class="va-buscar-wrap">
      <input id="va-buscar" class="va-buscar" type="text" autocomplete="off" autocorrect="off"
             spellcheck="false" placeholder="Buscar o escanear un artículo…">
      <div id="va-sug" class="va-sug hidden"></div>
    </div>
    <div id="va-lineas"></div>`;
  const inp = document.getElementById('va-buscar');
  if (inp) {
    inp.addEventListener('input', _vaBuscar);
    inp.addEventListener('focus', _vaBuscar);
    inp.addEventListener('blur', () => setTimeout(_vaCerrarSug, 250));
    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') { _vaCerrarSug(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // El lector de mano termina con Enter: si lo que quedó escrito es un
      // código exacto, entra directo sin tener que tocar la sugerencia.
      const drop = document.getElementById('va-sug');
      if (drop && drop._res && drop._res.length) _vaAgregar(0);
    });
  }
  vaAsegurarProductos();
  _vaRender();
}

function vaDesmontar() {
  VA_ITEMS = [];
  const cont = _vaCont && document.getElementById(_vaCont);
  if (cont) cont.innerHTML = '';
  _vaCont = null;
  _vaOnCambio = null;
}

// ── Lo que el formulario necesita saber ───────────────────
function vaItems() {
  return VA_ITEMS.map(it => ({
    id: it.id, source: 'producto', nombre: it.nombre, qty: it.qty,
    precioUnit: Number(it.precio) || 0,
    costoUSDUnit: Number(it.costoUSD) || 0,
    costoARSUnit: Number(it.costoARS) || 0,
  }));
}
function vaTotal()      { return VA_ITEMS.reduce((s, it) => s + (Number(it.precio) || 0) * it.qty, 0); }
function vaCostoTotal() { return VA_ITEMS.reduce((s, it) => s + (Number(it.costoARS) || 0) * it.qty, 0); }
function vaCuantos()    { return VA_ITEMS.reduce((s, it) => s + it.qty, 0); }

// Un descuento de stock por artículo, para hacerlo con el resto del guardado.
function vaStockUpdates() {
  return VA_ITEMS.filter(it => it.id).map(it => ({ id: it.id, qty: it.qty }));
}

// Falta ponerle precio a alguno: cobrar eso en cero es plata que no entra.
function vaSinPrecio() {
  return VA_ITEMS.some(it => !(Number(it.precio) > 0));
}

// ── Buscador ──────────────────────────────────────────────
function _vaBuscar() {
  const inp  = document.getElementById('va-buscar');
  const drop = document.getElementById('va-sug');
  if (!inp || !drop) return;
  const q = (inp.value || '').trim();
  if (!q) { _vaCerrarSug(); return; }

  const lista = vaLista().filter(p => p.activo !== false);
  const match = (typeof searchMatch === 'function')
    ? (p => searchMatch([p.nombre, p.codigo, p.codigoCorto, p.categoria], q))
    : (p => String(p.nombre || '').toLowerCase().includes(q.toLowerCase()));
  const res = lista.filter(match).slice(0, 6);

  drop._res = res;
  if (!res.length) {
    drop.innerHTML = `<div class="va-sug-vacio">Sin coincidencias para "${esc(q)}"</div>`;
    drop.classList.remove('hidden');
    return;
  }
  drop.innerHTML = res.map((p, i) => `
    <button type="button" class="va-sug-item" onmousedown="event.preventDefault()" onclick="_vaAgregar(${i})">
      <span class="va-sug-nom">${esc(p.nombre || '(sin nombre)')}</span>
      <span class="va-sug-precio">$${Number(p.precioVenta || 0).toLocaleString('es-AR')}</span>
      <span class="va-sug-meta">${esc([p.categoria, p.codigo].filter(Boolean).join(' · '))}</span>
      <span class="va-sug-stock${Number(p.stock) > 0 ? '' : ' va-sin-stock'}">${Number(p.stock) || 0} u.</span>
    </button>`).join('');
  drop.classList.remove('hidden');
}

function _vaCerrarSug() {
  const drop = document.getElementById('va-sug');
  if (drop) { drop.classList.add('hidden'); drop._res = []; }
}

function _vaAgregar(i) {
  const drop = document.getElementById('va-sug');
  const p = drop && drop._res && drop._res[i];
  if (!p) return;
  const inp = document.getElementById('va-buscar');
  if (inp) inp.value = '';
  _vaCerrarSug();

  // El mismo artículo dos veces suma cantidad, no abre otra línea.
  const ya = VA_ITEMS.find(it => it.id === p.id);
  if (ya) { ya.qty++; }
  else {
    VA_ITEMS.push({
      id: p.id, nombre: p.nombre || '(sin nombre)', qty: 1,
      precio: Number(p.precioVenta) || 0,
      costoUSD: Number(p.precioCostoUSD) || 0,
      costoARS: (typeof invCostoARS === 'function') ? invCostoARS(p) : (Number(p.precioCosto) || 0),
      stock: Number(p.stock) || 0,
    });
  }
  _vaRender();
}

// ── Las líneas ────────────────────────────────────────────
function _vaRender() {
  const el = document.getElementById('va-lineas');
  if (!el) return;
  if (!VA_ITEMS.length) { el.innerHTML = ''; if (_vaOnCambio) _vaOnCambio(); return; }

  el.innerHTML = VA_ITEMS.map((it, i) => {
    // Vender más de lo que hay deja el stock en negativo y el inventario miente.
    const pasado = it.qty > it.stock;
    return `
    <div class="va-linea${pasado ? ' va-linea--alerta' : ''}">
      <div class="va-linea-nom">${esc(it.nombre)}
        ${pasado ? `<span class="va-aviso">${it.stock > 0 ? `solo quedan ${it.stock}` : 'no queda ninguno en stock'}</span>` : ''}
      </div>
      <div class="va-linea-ctrl">
        <button type="button" class="va-qty-btn" onclick="_vaQty(${i},-1)">−</button>
        <span class="va-qty">${it.qty}</span>
        <button type="button" class="va-qty-btn" onclick="_vaQty(${i},1)">+</button>
        <input class="va-precio" type="number" inputmode="numeric" min="0" value="${it.precio}"
               onchange="_vaPrecio(${i}, this.value)" title="Precio por unidad">
        <button type="button" class="va-quitar" onclick="_vaQuitar(${i})" title="Quitar">✕</button>
      </div>
    </div>`;
  }).join('') + `
    <div class="va-total-row">
      <span>${vaCuantos()} ${vaCuantos() === 1 ? 'artículo' : 'artículos'}</span>
      <b>$${vaTotal().toLocaleString('es-AR')}</b>
    </div>`;
  if (_vaOnCambio) _vaOnCambio();
}

function _vaQty(i, d) {
  const it = VA_ITEMS[i];
  if (!it) return;
  it.qty = Math.max(1, it.qty + d);
  _vaRender();
}
function _vaPrecio(i, v) {
  const it = VA_ITEMS[i];
  if (!it) return;
  it.precio = Math.max(0, parseFloat(v) || 0);
  _vaRender();
}
function _vaQuitar(i) {
  VA_ITEMS.splice(i, 1);
  _vaRender();
}
