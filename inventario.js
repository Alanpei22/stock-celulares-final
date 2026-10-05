// ══════════════════════════════════════════
//  INVENTARIO DE PRODUCTOS — TechPoint
// ══════════════════════════════════════════

// Colección Firestore: productos
// Schema: { codigo, nombre, categoria, precioVenta, precioCostoUSD, precioCosto, stock, stockMin, activo, fechaAlta, updatedAt }
//
// El costo se carga en DÓLARES (precioCostoUSD), igual que en repuestos: la
// mercadería se compra en dólares y el costo en pesos cambia con el dólar.
// precioCosto (pesos) queda como el costo al momento de guardar, y es el que
// tienen los productos cargados antes; vale solo si no hay costo en dólares.
function invDolar() {
  if (typeof _dolarActual === 'function') return _dolarActual() || 0;
  if (typeof dolarBlue === 'number' && dolarBlue > 0) return dolarBlue;
  return (typeof getCurrentDolar === 'function') ? (getCurrentDolar() || 0) : 0;
}
function invCostoUSD(p) { return Number(p && p.precioCostoUSD) || 0; }

// ── En qué moneda se carga el costo ─────────────────────────
// Los accesorios se compran en pesos casi siempre; los repuestos, en dólares.
// El formulario tenía solo dólares: para cargar una funda que salió $4.500
// había que dividir de memoria. Ahora se elige, y la elección queda guardada
// para no tocarla en cada artículo de la tanda.
//
// Guardado: `precioCostoUSD` sigue siendo el canónico (es lo que ya leen los
// reportes) y `precioCosto` los pesos. Se guarda SIEMPRE lo que escribiste tal
// cual y lo otro convertido, así nunca se pierde el número que pusiste.
function invMoneda() {
  try { return localStorage.getItem('invMonedaCosto') === 'usd' ? 'usd' : 'ars'; } catch { return 'ars'; }
}
function invSetMoneda(m) {
  try { localStorage.setItem('invMonedaCosto', m === 'usd' ? 'usd' : 'ars'); } catch {}
  _invPintarMoneda();
}
function _invPintarMoneda() {
  const usd = invMoneda() === 'usd';
  document.getElementById('inv-mon-ars')?.classList.toggle('inv-mon-on', !usd);
  document.getElementById('inv-mon-usd')?.classList.toggle('inv-mon-on', usd);
  const inp = document.getElementById('inv-fi-costoUSD');
  if (inp) inp.placeholder = usd ? '0.00' : '0';
  _invHintCosto();
}
// El equivalente en la otra moneda, al dólar de hoy. Es el control de que no
// te comiste un cero.
function _invHintCosto() {
  const el = document.getElementById('inv-fi-costoARS-hint');
  if (!el) return;
  const v = parseFloat(document.getElementById('inv-fi-costoUSD')?.value) || 0;
  const d = invDolar();
  if (!v || !d) { el.textContent = ''; return; }
  el.textContent = invMoneda() === 'usd'
    ? '≈ $' + Math.round(v * d).toLocaleString('es-AR')
    : '≈ u$' + (v / d).toFixed(2);
}
function invCostoARS(p) {
  const usd = invCostoUSD(p), d = invDolar();
  return usd > 0 && d > 0 ? Math.round(usd * d) : (Number(p && p.precioCosto) || 0);
}

let PRODUCTOS = [];        // array completo (onSnapshot)
let PRODUCTOS_MAP = new Map(); // codigo → producto (O(1) lookup para POS e inventario)
let _invListener = null;
let _invEditingId = null;
let _invScanBuf = '';
let _invScanTimer = null;

const INV_CATEGORIAS = [
  'Accesorio', 'Vidrio templado / Hidrogel', 'Cable', 'Cargador',
  'Auricular', 'Funda / Cover', 'Repuesto', 'Otro'
];

// ── Inicializar ─────────────────────────────────────────────
// opts.soloUI = true → engancha la interfaz pero NO lee la colección de
// productos. El listener arranca al entrar a la pestaña Accesorios
// (ver switchCajaTab en caja.html), para no gastar cupo si nadie la abre.
function initInventario(opts = {}) {
  if (!opts.soloUI) _listenProductos();
  _initInvScanInput();
  _invCamBtn();

  document.getElementById('inv-add-btn').addEventListener('click', () => openProductoForm());
  // Búsqueda con debounce para evitar lag con muchos productos
  let _invSearchTimer;
  document.getElementById('inv-search').addEventListener('input', () => {
    clearTimeout(_invSearchTimer);
    _invSearchTimer = setTimeout(renderInventario, 80);
  });
  document.getElementById('inv-f-cat').addEventListener('change', renderInventario);
  document.getElementById('inv-f-estado').addEventListener('change', renderInventario);

  document.getElementById('inv-form-close').addEventListener('click', closeProductoForm);
  document.getElementById('inv-form-cancel').addEventListener('click', closeProductoForm);
  document.getElementById('inv-form-save').addEventListener('click', saveProducto);
  document.getElementById('inv-fi-costoUSD')?.addEventListener('input', _invCostoHint);
  document.getElementById('inv-form-modal').addEventListener('click', e => {
    if (e.target.id === 'inv-form-modal') closeProductoForm();
  });

  // Llenar select de categorías en el form
  const catSel = document.getElementById('inv-fi-cat');
  INV_CATEGORIAS.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });

  // Llenar filtro de categorías
  const catFilter = document.getElementById('inv-f-cat');
  INV_CATEGORIAS.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    catFilter.appendChild(o);
  });

  // URL param: ?section=inventario&newProducto=CODIGO
  const urlParams = new URLSearchParams(location.search);
  if (urlParams.get('newProducto')) {
    const cod = urlParams.get('newProducto');
    // Esperar a que el listener cargue antes de abrir el form
    setTimeout(() => openProductoForm(null, cod), 800);
    history.replaceState({}, '', location.pathname);
  }
}

// ── Listener Firestore ──────────────────────────────────────
function _listenProductos() {
  if (_invListener) return;
  let _primerInv = true;
  _invListener = db.collection('productos').orderBy('nombre').onSnapshot(snap => {
    if (typeof cupoSnap === 'function') { cupoSnap('productos', snap, _primerInv); _primerInv = false; }
    PRODUCTOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    PRODUCTOS_MAP.clear();
    PRODUCTOS.forEach(p => { if (p.codigo) PRODUCTOS_MAP.set(String(p.codigo), p); });
    renderInventario();
  }, err => {
    console.error('Inventario Firestore:', err);
    toast('Error cargando inventario', 'error');
  });
}

// ── Render lista ────────────────────────────────────────────
// ¿Se cargó hoy? `fechaAlta` es una marca del servidor: puede venir como
// Timestamp de Firestore, como Date o, los primeros segundos después de
// guardar, como null (el servidor todavía no la resolvió). En ese caso cuenta
// como de hoy: lo acabás de cargar vos.
function _invEsDeHoy(p) {
  // Sin fechaAlta no hay con qué decidir: o es de antes de que existiera el
  // campo, o el servidor todavía no resolvió la marca (dura un parpadeo, el
  // listener la completa enseguida).
  if (!p || !p.fechaAlta) return false;
  const d = typeof p.fechaAlta.toDate === 'function' ? p.fechaAlta.toDate() : new Date(p.fechaAlta);
  if (isNaN(d)) return false;
  const hoy = (typeof _todayAR === 'function') ? _todayAR()
            : new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);
  return d.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10) === hoy;
}

// Los productos que están a la vista, con los filtros puestos. Lo usan la
// lista y la impresión de etiquetas: si imprimieran cosas distintas de lo que
// se ve en pantalla, nadie entendería qué salió.
function _invFiltrados() {
  const search = (document.getElementById('inv-search')?.value || '').trim();
  const catF   = document.getElementById('inv-f-cat')?.value || '';
  const estF   = document.getElementById('inv-f-estado')?.value || '';

  let lista = PRODUCTOS;
  if (search) lista = lista.filter(p => searchMatch([p.nombre, p.codigo, p.categoria], search));
  if (catF)  lista = lista.filter(p => p.categoria === catF);
  if (estF === 'activo')    lista = lista.filter(p => p.activo !== false);
  if (estF === 'inactivo')  lista = lista.filter(p => p.activo === false);
  if (estF === 'bajo')      lista = lista.filter(p => p.stockMin > 0 && (p.stock || 0) <= p.stockMin);
  if (estF === 'hoy')       lista = lista.filter(_invEsDeHoy);
  return lista;
}

function renderInventario() {
  const search = (document.getElementById('inv-search')?.value || '').trim();
  const catF   = document.getElementById('inv-f-cat')?.value || '';
  const estF   = document.getElementById('inv-f-estado')?.value || '';

  const lista = _invFiltrados();

  // Stats
  const total   = PRODUCTOS.filter(p => p.activo !== false).length;
  const bajost  = PRODUCTOS.filter(p => p.activo !== false && p.stockMin > 0 && (p.stock || 0) <= p.stockMin).length;
  const valorT  = PRODUCTOS.filter(p => p.activo !== false).reduce((s, p) => s + invCostoARS(p) * (p.stock || 0), 0);
  document.getElementById('inv-s-total').textContent  = total;
  document.getElementById('inv-s-bajo').textContent   = bajost;
  document.getElementById('inv-s-valor').textContent  = '$' + _fmtNum(valorT);

  const el    = document.getElementById('inv-list');
  const empty = document.getElementById('inv-empty');

  if (!lista.length) {
    el.innerHTML = '';
    if (empty) {
      empty.style.display = '';
      // Diferenciar entre "no hay productos" y "sin resultados de búsqueda"
      if (search || catF || estF) {
        empty.innerHTML = `<span class="empty-ico">🔍</span><p class="empty-txt">Sin resultados para <em>"${esc(search || catF || estF)}"</em></p><button class="btn-secondary" onclick="document.getElementById('inv-search').value='';document.getElementById('inv-f-cat').value='';document.getElementById('inv-f-estado').value='';renderInventario()">Limpiar filtros</button>`;
      } else {
        empty.innerHTML = `<span class="empty-ico">🏷️</span><p class="empty-txt">No hay productos registrados</p><button class="btn-primary" onclick="openProductoForm()">Agregar primer producto</button>`;
      }
    }
    return;
  }
  if (empty) empty.style.display = 'none';

  el.innerHTML = lista.map(p => {
    const stockOk  = p.stock > 0;
    const stockBaj = p.stockMin > 0 && (p.stock || 0) <= p.stockMin;
    const stockCls = !stockOk ? 'inv-stock-cero' : stockBaj ? 'inv-stock-bajo' : 'inv-stock-ok';
    const inact    = p.activo === false;
    return `<div class="inv-item${inact ? ' inv-item--inactivo' : ''}">
      <div class="inv-item-main" onclick="openProductoForm('${esc(p.id)}')">
        <div class="inv-item-info">
          <span class="inv-item-nombre">${esc(p.nombre)}</span>
          <span class="inv-item-sub">${esc(p.categoria || '')}${p.codigo ? ' · <code>' + esc(p.codigo) + '</code>' : ''}</span>
        </div>
        <div class="inv-item-right">
          <span class="inv-item-precio">$${_fmtNum(p.precioVenta || 0)}</span>
          <span class="inv-item-stock ${stockCls}">${p.stock ?? 0} u.</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

// _fmtNum → alias de fmtNum() en utils.js
const _fmtNum = fmtNum;

// ── Formulario producto ─────────────────────────────────────
function openProductoForm(id, precodigo) {
  _invEditingId = id || null;
  const title = document.getElementById('inv-form-title');
  const delBtn = document.getElementById('inv-form-del');
  // La etiqueta solo tiene sentido con el artículo ya guardado: uno nuevo
  // todavía no tiene ni código ni precio.
  const etqBtn = document.getElementById('inv-form-etq');
  if (etqBtn) etqBtn.style.display = id ? '' : 'none';
  // "Guardar y cargar otro" solo al dar de alta: editando no tiene sentido.
  const otroBtn = document.getElementById('inv-form-save-otro');
  if (otroBtn) otroBtn.style.display = id ? 'none' : '';
  _invPintarMoneda();

  _clearProductoForm();

  if (id) {
    const p = PRODUCTOS.find(x => x.id === id);
    if (!p) return;
    title.textContent = '✏️ Editar producto';
    document.getElementById('inv-fi-cod').value   = p.codigo || '';
    document.getElementById('inv-fi-nom').value   = p.nombre || '';
    document.getElementById('inv-fi-cat').value   = p.categoria || '';
    document.getElementById('inv-fi-pv').value    = p.precioVenta ?? '';
    // Se muestra en la moneda que estas usando, no siempre en dolares.
    document.getElementById('inv-fi-costoUSD').value = invMoneda() === 'usd'
      ? (invCostoUSD(p) || '')
      : (invCostoARS(p) || '');
    _invCostoAnterior = Number(p.precioCosto) || 0;
    document.getElementById('inv-fi-stock').value = p.stock ?? 0;
    document.getElementById('inv-fi-stockmin').value = p.stockMin ?? 0;
    document.getElementById('inv-fi-activo').checked = p.activo !== false;
    if (delBtn) delBtn.style.display = _invIsOwner() ? '' : 'none';
  } else {
    title.textContent = '➕ Nuevo producto';
    if (precodigo) document.getElementById('inv-fi-cod').value = precodigo;
    if (delBtn) delBtn.style.display = 'none';
  }

  _invCostoHint();
  document.getElementById('inv-form-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('inv-fi-nom').focus(), 100);
}

function closeProductoForm() {
  document.getElementById('inv-form-modal').classList.add('hidden');
  _invEditingId = null;
}

// Costo en pesos que tenía el producto (los cargados antes de pasar a dólares).
// Se muestra como referencia y no se pisa si no se carga el costo en dólares.
let _invCostoAnterior = 0;

function _invCostoHint() {
  const el = document.getElementById('inv-fi-costoARS-hint');
  if (!el) return;
  const usd = parseFloat(document.getElementById('inv-fi-costoUSD')?.value) || 0;
  const d = invDolar();
  if (usd > 0 && d > 0) el.textContent = '≈ $' + Math.round(usd * d).toLocaleString('es-AR');
  else if (_invCostoAnterior > 0) el.textContent = '(antes $' + _invCostoAnterior.toLocaleString('es-AR') + ' en pesos)';
  else el.textContent = '';
}

function _clearProductoForm() {
  _invCostoAnterior = 0;
  ['inv-fi-cod','inv-fi-nom','inv-fi-pv','inv-fi-costoUSD'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('inv-fi-cat').value   = '';
  document.getElementById('inv-fi-stock').value = 0;
  document.getElementById('inv-fi-stockmin').value = 0;
  document.getElementById('inv-fi-activo').checked = true;
}

async function saveProducto(opts) {
  const cod    = document.getElementById('inv-fi-cod').value.trim();
  const nom    = document.getElementById('inv-fi-nom').value.trim();
  const cat    = document.getElementById('inv-fi-cat').value;
  const pv     = parseFloat(document.getElementById('inv-fi-pv').value) || 0;
  const costoIn  = parseFloat(document.getElementById('inv-fi-costoUSD').value) || 0;
  const enUSD    = invMoneda() === 'usd';
  const dolarHoy = invDolar();
  // Lo que escribiste se guarda tal cual; lo otro, convertido al dólar de hoy.
  // A dos decimales: cargando $2.800 el canónico salía 2.3333333333333335 y
  // eso es lo que veías al reabrir el artículo en modo dólares.
  const costoUSD = enUSD ? costoIn : (dolarHoy > 0 ? Math.round((costoIn / dolarHoy) * 100) / 100 : 0);
  const costoARS = enUSD ? (dolarHoy > 0 ? Math.round(costoIn * dolarHoy) : 0) : Math.round(costoIn);
  const stock  = parseInt(document.getElementById('inv-fi-stock').value)    || 0;
  const stmin  = parseInt(document.getElementById('inv-fi-stockmin').value) || 0;
  const activo = document.getElementById('inv-fi-activo').checked;

  if (!nom) { toast('Ingresá el nombre del producto', 'error'); return; }

  // Verificar código duplicado (al crear Y al editar si cambió el código)
  if (cod && PRODUCTOS_MAP.has(cod)) {
    const existente = PRODUCTOS_MAP.get(cod);
    // Si estamos editando y el producto con ese código ES el mismo que editamos, está ok
    if (!_invEditingId || existente.id !== _invEditingId) {
      toast('Ya existe un producto con ese código', 'error');
      return;
    }
  }

  const seguir = !!(opts && opts.seguir);
  const btn = document.getElementById(seguir ? 'inv-form-save-otro' : 'inv-form-save');
  btn.disabled = true;

  try {
    const data = {
      codigo: cod, nombre: nom, categoria: cat,
      precioVenta: pv, precioCostoUSD: costoUSD,
      stock, stockMin: stmin, activo,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (costoARS > 0) data.precioCosto = costoARS;
    else if (!_invEditingId) data.precioCosto = 0;

    // Cada guardado cuenta como actividad: cargando una tanda larga, el modo
    // dueño no se tiene que apagar solo y llevarse el campo del costo.
    if (typeof _cajaOwnerRenovar === 'function') _cajaOwnerRenovar();

    if (_invEditingId) {
      await db.collection('productos').doc(_invEditingId).update(data);
      toast('✅ Producto actualizado', 'success');
    } else {
      data.fechaAlta = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('productos').add(data);
      toast('✅ Producto guardado', 'success');
    }
    // Cargando una tanda, cerrar el formulario y volver a tocar "escanear" en
    // cada artículo son dos toques de más por artículo. Con "guardar y cargar
    // otro" queda listo para el siguiente, con la categoría puesta.
    if (seguir) _invSiguiente(cat);
    else closeProductoForm();
  } catch(e) {
    console.error(e);
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
  }
}

function _invIsOwner() {
  if (typeof _cajaIsOwner !== 'undefined') return _cajaIsOwner;
  if (typeof OWNER_MODE !== 'undefined') return OWNER_MODE;
  return false;
}
function _invRequirePin(cb, msg) {
  if (typeof requireCajaOwnerPin === 'function') requireCajaOwnerPin(cb, msg);
  else if (typeof requireOwnerPin === 'function') requireOwnerPin(cb, msg);
  else cb();
}

async function deleteProducto(id) {
  if (!id) { toast('Error: ID de producto no válido', 'error'); return; }
  if (!_invIsOwner()) { toast('Requiere modo dueño', 'error'); return; }
  _invRequirePin(async () => {
    try {
      await db.collection('productos').doc(id).delete();
      closeProductoForm();
      toast('Producto eliminado', 'success');
    } catch(e) {
      toast('Error al eliminar', 'error');
    }
  }, 'Confirmar eliminación de producto');
}

// ── Escaneo por código de barras (inventario) ───────────────
// El lector actúa como teclado (keyboard-wedge): tipea el código y envía Enter.
// Usamos un input siempre visible con inputmode="none" para capturar el escaneo.

// El lector de mano manda el codigo y despues un Enter. En el campo de codigo
// ese Enter tiene que pasar al nombre, no mandar el formulario a medio llenar.
function _initInvFormAtajos() {
  const cod = document.getElementById('inv-fi-cod');
  if (cod && !cod._atado) {
    cod._atado = true;
    cod.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      document.getElementById('inv-fi-nom')?.focus();
    });
  }
  const costo = document.getElementById('inv-fi-costoUSD');
  if (costo && !costo._atado) {
    costo._atado = true;
    costo.addEventListener('input', _invHintCosto);
  }
}

function _initInvScanInput() {
  _initInvFormAtajos();
  const inp = document.getElementById('inv-scan-input');
  if (!inp) return;

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const cod = inp.value.trim();
      inp.value = '';
      if (cod) _handleInvScan(cod);
    }
  });

  // Foco automático cuando la sección es visible
  inp.addEventListener('blur', () => {
    // Si el blur no fue hacia otro input del DOM, volver a enfocar
    setTimeout(() => {
      const active = document.activeElement;
      const invModal = document.getElementById('inv-form-modal');
      if (invModal && !invModal.classList.contains('hidden')) return;
      if (!active || active === document.body || (!active.tagName.match(/^(INPUT|TEXTAREA|BUTTON|SELECT|A)$/i) && !active.closest('#inv-form-modal'))) inp.focus(); // MED-09
    }, 150);
  });
}

// Leer el código con la CÁMARA del celu. El lector de mano sigue andando
// igual: son dos caminos al mismo _handleInvScan.
async function escanearInvCam() {
  if (typeof abrirEscaner !== 'function') { toast('El lector no está disponible acá', 'error'); return; }
  await abrirEscaner(cod => _handleInvScan(cod), { titulo: 'Escaneá el código del producto' });
}

// El botón se ve SIEMPRE. Antes se escondía cuando el navegador no sabía leer
// códigos, y el resultado era peor: no aparecía y no había forma de saber por
// qué. Ahora está, y si el navegador no puede, al tocarlo te dice el motivo.
async function _invCamBtn() {
  const btn = document.getElementById('inv-scan-cam');
  if (!btn) return;
  btn.classList.remove('hidden');
}

function focusInvScan() {
  const inp = document.getElementById('inv-scan-input');
  if (inp) inp.focus();
}

function _handleInvScan(codigo) {
  const p = PRODUCTOS_MAP.get(codigo);
  if (p) {
    // Producto existe → abrir form para editar / ajustar stock
    openProductoForm(p.id);
    toast(`📦 ${p.nombre}`, 'info');
  } else {
    // Producto nuevo → abrir form con código pre-cargado
    openProductoForm(null, codigo);
    toast('Código nuevo — completá los datos', 'info');
  }
}

// ══════════════════════════════════════════
//  MENÚ INVENTARIO (bottom sheet)
// ══════════════════════════════════════════
function toggleInvMenu() {
  if (typeof openSheet !== 'function') return;
  openSheet('Inventario', [
    { icon: '🌙', label: 'Modo oscuro/claro', onClick: toggleDarkMode },
    { icon: '🔒', label: 'Modo dueño', onClick: openCajaOwnerPin },
    { divider: true },
    { icon: '🧙', label: 'Control de stock guiado', sub: 'Recorré uno por uno', onClick: openInvWizard },
    { icon: '🏷️', label: 'Imprimir etiquetas', sub: 'Las de la lista que estás viendo', onClick: imprimirEtiquetasInv },
    { icon: '🆕', label: 'Etiquetas de lo cargado hoy', sub: 'Al terminar una tanda', onClick: etiquetasDeHoy },
    { icon: '🔢', label: 'Generar códigos de barras', sub: 'A los artículos que no tienen', onClick: generarCodigosInv },
    { icon: '📐', label: 'Sentido de la etiqueta',
      sub: (typeof etqFormato === 'function' && typeof ETQ_FORMATO_NOMBRE === 'object')
             ? ETQ_FORMATO_NOMBRE[etqFormato()] : '',
      onClick: () => { closeInvMenu(); elegirFormatoEtiqueta(); } },
    { icon: '🖨️', label: 'Impresión directa',
      sub: (typeof qzMenuSub === 'function') ? qzMenuSub() : '',
      onClick: () => { closeInvMenu(); if (typeof configurarImpresoras === 'function') configurarImpresoras(); } },
    { icon: '💵', label: 'Cargar costos', sub: 'En dólares, todos en una lista (modo dueño)',
      onClick: () => { closeInvMenu(); abrirCostosInv(); } },
    { icon: '💾', label: 'Exportar a CSV', onClick: exportInventarioCSV },
  ]);
}
function closeInvMenu() { if (typeof closeSheet === 'function') closeSheet(); }

// Deja el formulario listo para el que viene, conservando la categoría (en una
// tanda suelen ser todos del mismo rubro) y el foco en el código, que es donde
// escribe el lector de mano.
function _invSiguiente(cat) {
  _invEditingId = null;
  const t = document.getElementById('inv-form-title');
  if (t) t.textContent = '➕ Nuevo producto';
  const stminAntes = document.getElementById('inv-fi-stockmin')?.value;
  _clearProductoForm();
  if (cat) document.getElementById('inv-fi-cat').value = cat;
  // La cantidad SÍ se borra (cada artículo tiene la suya) pero el mínimo suele
  // repetirse en toda la tanda: volver a escribirlo 150 veces no tiene sentido.
  if (stminAntes) document.getElementById('inv-fi-stockmin').value = stminAntes;
  const del = document.getElementById('inv-form-del');
  if (del) del.style.display = 'none';
  const etq = document.getElementById('inv-form-etq');
  if (etq) etq.style.display = 'none';
  _invPintarMoneda();
  const cod = document.getElementById('inv-fi-cod');
  if (cod) { cod.value = ''; setTimeout(() => cod.focus(), 60); }
}

// ══════════════════════════════════════════
//  ETIQUETAS DE ARTÍCULOS
// ══════════════════════════════════════════
// Se imprime lo que está a la vista: filtrás por categoría y salen las de esa
// categoría. Una copia por artículo; para la góndola se pide cuántas.
function imprimirEtiquetasInv() {
  closeInvMenu();
  const lista = _invFiltrados();
  if (!lista.length) { toast('No hay artículos en la lista', 'error'); return; }
  if (typeof printEtiquetasProductos !== 'function') { toast('No se puede imprimir desde acá', 'error'); return; }
  const copias = prompt(`${lista.length} artículo${lista.length > 1 ? 's' : ''} a la vista.\n¿Cuántas etiquetas de cada uno?`, '1');
  if (copias === null) return;
  printEtiquetasProductos(lista, Number(copias) || 1);
}

// Al terminar de cargar una tanda: las etiquetas de todo lo que entró hoy, sin
// tener que acordarse cuáles fueron ni buscarlos uno por uno.
function etiquetasDeHoy() {
  closeInvMenu();
  const hoy = PRODUCTOS.filter(_invEsDeHoy);
  if (!hoy.length) { toast('Todavía no cargaste ningún artículo hoy', 'info'); return; }
  if (typeof printEtiquetasProductos !== 'function') { toast('No se puede imprimir desde acá', 'error'); return; }
  const copias = prompt(`${hoy.length} artículo${hoy.length > 1 ? 's' : ''} cargado${hoy.length > 1 ? 's' : ''} hoy.\n¿Cuántas etiquetas de cada uno?`, '1');
  if (copias === null) return;
  printEtiquetasProductos(hoy, Number(copias) || 1);
}

// Una etiqueta sola, desde la ficha del artículo.
function imprimirEtiquetaProducto(id) {
  const p = PRODUCTOS.find(x => x.id === (id || _invEditingId));
  if (!p) { toast('Guardá el artículo primero', 'error'); return; }
  if (typeof printEtiquetasProductos !== 'function') { toast('No se puede imprimir desde acá', 'error'); return; }
  const copias = prompt('¿Cuántas etiquetas?', '1');
  if (copias === null) return;
  printEtiquetasProductos([p], Number(copias) || 1);
}

// ── Códigos internos para los que no tienen ──
// Sin código no hay barras, y sin barras la etiqueta no se puede escanear en
// la caja. Los de fábrica (EAN) se respetan: esto solo toca los vacíos.
// El número lo reparte un contador común con los repuestos (ver
// tpReservarCodigos en utils.js), que viven en otra pantalla: dos cosas con el
// mismo código serían la misma cosa al escanear.
async function generarCodigosInv() {
  closeInvMenu();
  const sin = PRODUCTOS.filter(p => !String(p.codigo || '').trim());
  if (!sin.length) { toast('Todos los artículos ya tienen código', 'success'); return; }
  if (!confirm(`${sin.length} artículo${sin.length > 1 ? 's' : ''} sin código de barras.\n¿Les genero uno interno (TP…)?`)) return;
  try {
    const codigos = await tpReservarCodigos(db, sin.length, tpMaxCodigoLocal(PRODUCTOS));
    const batch = db.batch();
    sin.forEach((p, n) => batch.update(db.collection('productos').doc(p.id), { codigo: codigos[n] }));
    await batch.commit();
    toast(`✅ ${sin.length} código${sin.length > 1 ? 's' : ''} generado${sin.length > 1 ? 's' : ''}`, 'success');
  } catch (e) {
    console.error('generarCodigosInv:', e);
    toast('No se pudieron generar', 'error');
  }
}

// ══════════════════════════════════════════
//  EXPORTAR INVENTARIO A CSV
// ══════════════════════════════════════════
function exportInventarioCSV() {
  if (!PRODUCTOS.length) { toast('No hay productos para exportar', 'info'); return; }
  const rows = [['codigo','nombre','categoria','stock','stockMin','precioVenta','precioCostoUSD','precioCosto','activo']];
  PRODUCTOS.forEach(p => {
    rows.push([
      p.codigo || '',
      (p.nombre || '').replace(/"/g, '""'),
      p.categoria || '',
      p.stock ?? 0,
      p.stockMin ?? 0,
      p.precioVenta ?? 0,
      invCostoUSD(p),
      invCostoARS(p),
      p.activo === false ? 'no' : 'sí',
    ]);
  });
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventario_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  toast('💾 CSV descargado', 'success');
}

// ══════════════════════════════════════════
//  CONTROL DE STOCK GUIADO (PRODUCTOS)
// ══════════════════════════════════════════
let _invWizList = [];
let _invWizIdx  = 0;
let _invWizStats = { actualizados: 0, omitidos: 0 };

function openInvWizard() {
  if (!PRODUCTOS.length) { toast('No hay productos cargados', 'info'); return; }
  _invWizList = PRODUCTOS.filter(p => p.activo !== false);
  _invWizIdx = 0;
  _invWizStats = { actualizados: 0, omitidos: 0 };
  if (!_invWizList.length) { toast('No hay productos activos', 'info'); return; }
  _renderInvWizModal();
}

function _renderInvWizModal() {
  // Crear modal dinámicamente la primera vez
  let modal = document.getElementById('invwiz-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'invwiz-modal';
    modal.className = 'modal-overlay invwiz-overlay';
    modal.innerHTML = `
      <div class="invwiz-card">
        <div class="invwiz-hdr">
          <span>🧙 Control de stock</span>
          <button onclick="closeInvWizard()" class="invwiz-close">✕</button>
        </div>
        <div class="invwiz-body">
          <div class="stockwiz-progress">
            <div class="stockwiz-progress-bar"><div id="invwiz-fill"></div></div>
            <span id="invwiz-prog-txt">1 / 1</span>
          </div>
          <div class="stockwiz-item-info">
            <div id="invwiz-nom" class="stockwiz-item-nombre"></div>
            <div id="invwiz-meta" class="stockwiz-item-meta"></div>
          </div>
          <div class="fi"><label>Cantidad <span class="stockwiz-current" id="invwiz-cur-c"></span></label>
            <input type="number" id="invwiz-fi-cant" inputmode="numeric" min="0">
          </div>
          <div class="fi"><label>Precio venta <span class="stockwiz-current" id="invwiz-cur-pv"></span></label>
            <input type="number" id="invwiz-fi-pv" inputmode="decimal" min="0" step="0.01">
          </div>
          <div class="stockwiz-btns">
            <button class="btn-secondary" id="invwiz-prev-btn" onclick="_invWizPrev()">◀ Anterior</button>
            <button class="btn-secondary" onclick="_invWizSkip()">Omitir →</button>
            <button class="btn-primary" onclick="_invWizSaveNext()">💾 Guardar</button>
          </div>
          <div class="stockwiz-finish-row">
            <button class="btn-link" onclick="_invWizFinish()">Finalizar antes</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  modal.classList.remove('hidden');
  _invWizRender();
}

function closeInvWizard() {
  document.getElementById('invwiz-modal')?.classList.add('hidden');
}

function _invWizRender() {
  if (_invWizIdx >= _invWizList.length) { _invWizFinish(); return; }
  const p = _invWizList[_invWizIdx];
  const total = _invWizList.length;
  const num = _invWizIdx + 1;
  document.getElementById('invwiz-fill').style.width = ((num - 1) / total * 100) + '%';
  document.getElementById('invwiz-prog-txt').textContent = `${num} / ${total}`;
  document.getElementById('invwiz-nom').textContent = p.nombre || '(sin nombre)';
  document.getElementById('invwiz-meta').textContent = [p.categoria, p.codigo].filter(Boolean).join(' · ') || '—';
  document.getElementById('invwiz-cur-c').textContent  = `(actual: ${Number(p.stock) || 0})`;
  document.getElementById('invwiz-cur-pv').textContent = `(actual: $${Number(p.precioVenta || 0).toLocaleString('es-AR')})`;
  document.getElementById('invwiz-fi-cant').value = Number(p.stock) || 0;
  document.getElementById('invwiz-fi-pv').value   = Number(p.precioVenta) || 0;
  document.getElementById('invwiz-prev-btn').disabled = (_invWizIdx === 0);
  setTimeout(() => document.getElementById('invwiz-fi-cant')?.select?.(), 80);
}

function _invWizPrev() { if (_invWizIdx > 0) { _invWizIdx--; _invWizRender(); } }

function _invWizSkip() { _invWizStats.omitidos++; _invWizIdx++; _invWizRender(); }

async function _invWizSaveNext() {
  const p = _invWizList[_invWizIdx];
  if (!p) return;
  const cant = parseInt(document.getElementById('invwiz-fi-cant').value);
  const pv   = parseFloat(document.getElementById('invwiz-fi-pv').value);
  const update = {};
  if (!isNaN(cant) && cant !== (Number(p.stock) || 0)) update.stock = cant;
  if (!isNaN(pv)   && pv   !== (Number(p.precioVenta) || 0)) update.precioVenta = pv;
  if (Object.keys(update).length === 0) {
    _invWizStats.omitidos++; _invWizIdx++; _invWizRender(); return;
  }
  try {
    await db.collection('productos').doc(p.id).set(update, { merge: true });
    Object.assign(p, update);
    _invWizStats.actualizados++;
    _invWizIdx++;
    _invWizRender();
  } catch (e) {
    console.error('invwiz save:', e);
    toast('Error al guardar', 'error');
  }
}

function _invWizFinish() {
  const total = _invWizList.length;
  const restantes = Math.max(0, total - _invWizIdx);
  toast(`✅ Control terminado · ${_invWizStats.actualizados} actualizados · ${_invWizStats.omitidos} omitidos · ${restantes} sin revisar`, 'success');
  closeInvWizard();
}

// ══════════════════════════════════════════
//  CARGAR COSTOS — todos en una lista
// ══════════════════════════════════════════
// Abrir artículo por artículo para ponerle el costo era eterno. Acá van todos
// los de la lista que estás viendo (mismos filtros y búsqueda), con un
// casillero de costo en dólares cada uno. Se guardan solo los que cambiaron.
// Solo el dueño: el costo no lo ven los empleados.
function abrirCostosInv() {
  if (!_invIsOwner()) { toast('🔒 Activá el modo dueño para cargar costos', 'error'); return; }
  const lista = _invFiltrados().filter(p => p.activo !== false)
    .slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
  if (!lista.length) { toast('No hay artículos en la lista', 'error'); return; }
  const d = invDolar();

  document.getElementById('inv-costos-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'inv-costos-modal';
  m.className = 'modal-overlay';
  m.innerHTML = `
  <div class="modal-card form-card">
    <div class="modal-header">
      <h3>💵 Cargar costos <small style="font-weight:500;color:var(--t3)">${lista.length} artículos${d > 0 ? ' · dólar $' + d.toLocaleString('es-AR') : ''}</small></h3>
      <button class="modal-close" onclick="cerrarCostosInv()">✕</button>
    </div>
    <div class="modal-body" style="max-height:65vh;overflow:auto">
      ${lista.map(p => {
        const usd = invCostoUSD(p), viejo = Number(p.precioCosto) || 0;
        return `<div class="invc-fila" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--bd, #e5e7eb)">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.nombre || '(sin nombre)')}</div>
            <div style="font-size:12px;color:var(--t3)">${esc(p.codigo || 'sin código')} · venta $${(Number(p.precioVenta) || 0).toLocaleString('es-AR')}${!usd && viejo ? ' · antes $' + viejo.toLocaleString('es-AR') + ' en pesos' : ''}</div>
          </div>
          <span style="font-size:13px;color:var(--t3)">u$</span>
          <input class="fi invc-usd" data-id="${esc(p.id)}" data-antes="${usd || ''}" type="number" min="0" step="0.01"
                 inputmode="decimal" value="${usd || ''}" placeholder="0" style="width:90px"
                 oninput="_invCostosFila(this)">
          <span class="invc-ars" style="width:78px;font-size:12px;color:var(--t3);text-align:right">${usd && d ? '$' + Math.round(usd * d).toLocaleString('es-AR') : ''}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:12px 16px">
      <button class="btn-secondary" onclick="cerrarCostosInv()">Cancelar</button>
      <button class="btn-primary" id="inv-costos-save" onclick="guardarCostosInv()">Guardar costos</button>
    </div>
  </div>`;
  m.addEventListener('click', e => { if (e.target === m) cerrarCostosInv(); });
  document.body.appendChild(m);
  // Enter pasa al siguiente: cargar 50 costos sin tocar el mouse.
  const inputs = [...m.querySelectorAll('.invc-usd')];
  inputs.forEach((el, i) => el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); (inputs[i + 1] || document.getElementById('inv-costos-save')).focus(); }
  }));
  setTimeout(() => inputs[0]?.focus(), 100);
}

function _invCostosFila(el) {
  const usd = parseFloat(el.value) || 0, d = invDolar();
  const ars = el.parentElement.querySelector('.invc-ars');
  if (ars) ars.textContent = usd > 0 && d > 0 ? '$' + Math.round(usd * d).toLocaleString('es-AR') : '';
}

function cerrarCostosInv() {
  document.getElementById('inv-costos-modal')?.remove();
}

// Lo que cambió en la lista, listo para guardar. Aparte para poder probarlo.
function _invCostosCambios(inputs, dolar) {
  const out = [];
  inputs.forEach(el => {
    const nuevo = Math.max(0, parseFloat(el.value) || 0);
    const antes = parseFloat(el.dataset.antes) || 0;
    if (Math.abs(nuevo - antes) < 0.005) return;
    const data = { precioCostoUSD: nuevo };
    if (nuevo > 0 && dolar > 0) data.precioCosto = Math.round(nuevo * dolar);
    out.push({ id: el.dataset.id, data });
  });
  return out;
}

async function guardarCostosInv() {
  const m = document.getElementById('inv-costos-modal');
  if (!m) return;
  const cambios = _invCostosCambios([...m.querySelectorAll('.invc-usd')], invDolar());
  if (!cambios.length) { cerrarCostosInv(); toast('No cambiaste ningún costo', 'info'); return; }
  const btn = document.getElementById('inv-costos-save');
  if (btn) btn.disabled = true;
  try {
    // Firestore acepta hasta 500 escrituras por tanda.
    for (let i = 0; i < cambios.length; i += 450) {
      const batch = db.batch();
      cambios.slice(i, i + 450).forEach(c => batch.update(db.collection('productos').doc(c.id),
        Object.assign({}, c.data, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() })));
      await batch.commit();
    }
    cerrarCostosInv();
    toast(`✅ ${cambios.length} costo${cambios.length === 1 ? '' : 's'} guardado${cambios.length === 1 ? '' : 's'}`, 'success');
  } catch (e) {
    console.error('costos:', e);
    toast('Error al guardar los costos', 'error');
    if (btn) btn.disabled = false;
  }
}

