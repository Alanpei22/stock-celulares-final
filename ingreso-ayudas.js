// ══════════════════════════════════════════════════════════════
//  ✍️ AYUDAS DEL INGRESO: autocompletar marca/modelo y precios sugeridos
// ══════════════════════════════════════════════════════════════
//  Alan (22/11): "cuando rellenemos los campos, que si pongo 'sa' ya me
//  aparezca para poner Samsung, al igual que los modelos". Y: "hay que
//  trabajar en precios sugeridos para los repuestos en cuanto a su
//  reparación: que aparezcan repuestos, pero también pin de carga, batería
//  y demás".
//
//  1) AUTOCOMPLETAR. Antes la marca tenía una <datalist> fija (en el iPhone
//     casi no se ve) y el modelo nada. Ahora, mientras se escribe, abajo del
//     campo sale una lista con lo que ya se usó: las marcas y modelos de las
//     reparaciones, el stock y los repuestos que la app YA tiene en memoria.
//     CUPO: cero lecturas nuevas. Los más usados, primero.
//
//  2) PRECIOS DE REPARACIÓN. En el recuadro del modelo (repairs.js,
//     _repuModeloPintar) se suma "💲 Precios de reparación": módulo, batería
//     y pin de carga siempre, y cualquier otro arreglo del que haya precio.
//     El precio sale, en este orden:
//       · de la LISTA DE PRECIOS (Caja → 💲 Precios de reparación), que es
//         la que carga Alan y manda;
//       · si no está en la lista, de lo ÚLTIMO que se cobró por ese arreglo
//         en ese modelo (las reparaciones en memoria: últimos 30 días). El
//         último y no el promedio: con la inflación, el promedio queda viejo
//         (mismo criterio que precios-historial.js).
//     Al lado dice si hay el repuesto o hay que pedirlo, y tocándolo se suma
//     a "Reparaciones a hacer" con ese precio.
'use strict';

const IA_MARCAS_BASE = ['Samsung', 'iPhone', 'Motorola', 'Xiaomi', 'LG', 'TCL', 'Huawei'];
const IA_MAX = 6;   // sugerencias que se muestran a la vez

function _iaNorm(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
// "Apple" y "iPhone" son la misma marca (como en repuestosDelModelo)
function _iaMarcaClave(s) { const m = _iaNorm(s); return m === 'apple' ? 'iphone' : m; }
const _IA_MARCAS_CONOCIDAS = new Set(IA_MARCAS_BASE.map(_iaMarcaClave).concat(['apple', 'nokia', 'alcatel', 'oppo', 'realme', 'zte', 'google', 'sony', 'honor', 'infinix', 'tecno', 'nubia', 'vivo', 'redmi', 'poco']));

// ── De dónde salen las sugerencias: lo que ya está en memoria ──
function _iaFuentes() {
  const out = [];
  const sumar = (arr) => { if (Array.isArray(arr)) arr.forEach(x => { if (x && (x.marca || x.modelo)) out.push({ marca: x.marca, modelo: x.modelo }); }); };
  if (typeof REPAIRS !== 'undefined') sumar(REPAIRS);
  if (typeof STOCK !== 'undefined') sumar(STOCK);
  if (typeof REPUESTOS !== 'undefined') sumar(REPUESTOS);
  return out;
}
function _iaMarcasExtra() {
  return (typeof _customMarcas !== 'undefined' && Array.isArray(_customMarcas)) ? _customMarcas : [];
}

// Junta variantes de escritura ("samsung", "Samsung ") en una sola, con la
// forma más usada, y ordena por cuántas veces aparece.
function _iaContar(pares) {
  const grupos = new Map();   // clave → { total, formas: Map(forma → n) }
  pares.forEach(([clave, forma, peso]) => {
    if (!clave || !forma) return;
    let g = grupos.get(clave);
    if (!g) { g = { total: 0, formas: new Map() }; grupos.set(clave, g); }
    g.total += peso;
    g.formas.set(forma, (g.formas.get(forma) || 0) + peso);
  });
  return [...grupos.entries()]
    .map(([clave, g]) => ({ clave, total: g.total, forma: [...g.formas.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.total - a.total || a.forma.localeCompare(b.forma));
}

function iaMarcas(fuentes, extras) {
  const pares = [];
  // Las de siempre y las agregadas con ＋ aparecen aunque no se hayan usado
  IA_MARCAS_BASE.concat(extras || []).forEach(m => pares.push([_iaMarcaClave(m), String(m).trim(), 0.5]));
  (fuentes || []).forEach(f => {
    const m = String(f.marca || '').trim().replace(/\s+/g, ' ');
    if (m && m.length <= 30) pares.push([_iaMarcaClave(m), m, 1]);
  });
  return _iaContar(pares).map(x => x.clave === 'iphone' ? 'iPhone' : x.forma);
}

// Modelos de esa marca. "iPhone 13" y "13" (marca iPhone) son el mismo: la
// clave se arma sin la palabra de la marca.
function iaModelos(fuentes, marca) {
  const mq = _iaMarcaClave(marca);
  const sacar = new Set([mq, mq === 'iphone' ? 'apple' : '', mq === 'iphone' ? 'iphone' : ''].filter(Boolean));
  const pares = [];
  (fuentes || []).forEach(f => {
    const mod = String(f.modelo || '').trim().replace(/\s+/g, ' ');
    if (!mod || mod.length > 40) return;
    if (mq) {
      const mf = _iaMarcaClave(f.marca);
      if (mf !== mq) return;   // otra marca (o sin marca): no ensucia la lista
    }
    const clave = _iaNorm(mod).split(' ').filter(t => !sacar.has(t)).join(' ');
    if (clave) pares.push([clave, mod, 1]);
  });
  return _iaContar(pares).map(x => x.forma);
}

// Filtra por lo escrito: cada palabra escrita tiene que ser el comienzo de
// una palabra de la opción ("sa" → Samsung, "a5" → Galaxy A54, A55…).
function iaFiltrar(lista, q, max) {
  const n = max || IA_MAX;
  const qn = _iaNorm(q);
  const qt = qn.split(' ').filter(Boolean);
  if (!qt.length) return (lista || []).slice(0, n);
  const qj = qt.join('');
  const salen = [];
  (lista || []).forEach(op => {
    const on = _iaNorm(op);
    if (on === qn) return;   // ya está escrito entero: no hace falta sugerirlo
    const ot = on.split(' ');
    const ok = qt.every(t => ot.some(w => w.startsWith(t))) || on.replace(/ /g, '').startsWith(qj);
    if (ok) salen.push({ op, empieza: on.startsWith(qn) || on.replace(/ /g, '').startsWith(qj) });
  });
  // Los que arrancan igual que lo escrito, primero (sin perder el orden por uso)
  return salen.filter(x => x.empieza).concat(salen.filter(x => !x.empieza)).slice(0, n).map(x => x.op);
}

// ── La lista que se despliega abajo del campo ──────────────
function iaEnganchar(inp, fuente, alElegir) {
  if (!inp || inp._iaListo) return;
  inp._iaListo = true;
  _iaEstilos();
  // La <datalist> nativa mostraría una segunda lista encima de esta
  inp.removeAttribute('list');
  const wrap = inp.parentElement;
  wrap.classList.add('ia-wrap');
  const box = document.createElement('div');
  box.className = 'ia-sug hidden';
  box.setAttribute('role', 'listbox');
  inp.insertAdjacentElement('afterend', box);

  let base = [], items = [], sel = -1, recienElegido = false;
  const ocultar = () => { box.classList.add('hidden'); sel = -1; };
  const pintar = () => {
    if (document.activeElement !== inp) { ocultar(); return; }
    items = iaFiltrar(base, inp.value);
    if (!items.length) { ocultar(); return; }
    if (sel >= items.length) sel = -1;
    box.innerHTML = items.map((op, i) =>
      `<button type="button" class="ia-op${i === sel ? ' on' : ''}" data-i="${i}" role="option">${esc(op)}</button>`).join('');
    box.classList.remove('hidden');
  };
  const elegir = (op) => {
    inp.value = op;
    ocultar();
    recienElegido = true;
    // Que se enteren los que escuchan el campo (recuadro de repuestos, etc.)
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    recienElegido = false;
    if (typeof alElegir === 'function') alElegir(op);
  };

  inp.addEventListener('focus', () => { base = fuente() || []; pintar(); });
  inp.addEventListener('input', () => { if (!recienElegido) { sel = -1; pintar(); } });
  // Un ratito antes de cerrar: si no, el toque en la opción se pierde
  inp.addEventListener('blur', () => setTimeout(ocultar, 180));
  inp.addEventListener('keydown', e => {
    if (box.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = e.key === 'ArrowDown' ? Math.min(items.length - 1, sel + 1) : Math.max(-1, sel - 1);
      pintar();
    } else if (e.key === 'Enter' && sel >= 0) {
      e.preventDefault();
      elegir(items[sel]);
    } else if (e.key === 'Escape') {
      ocultar();
    }
  });
  // Que el toque no le saque el foco al campo (así no se cierra antes)
  box.addEventListener('pointerdown', e => e.preventDefault());
  box.addEventListener('mousedown', e => e.preventDefault());
  box.addEventListener('click', e => {
    const b = e.target.closest('.ia-op');
    if (b && items[+b.dataset.i] != null) elegir(items[+b.dataset.i]);
  });
}

function iaIniciar() {
  // Ingreso de reparación y alta de equipo en stock: los dos tienen marca y modelo
  [['rep-fi-marca', 'rep-fi-modelo'], ['fi-marca', 'fi-modelo']].forEach(([m, mo]) => {
    const im = document.getElementById(m), imo = document.getElementById(mo);
    if (!im || !imo) return;
    iaEnganchar(im, () => iaMarcas(_iaFuentes(), _iaMarcasExtra()), () => { if (!imo.value.trim()) imo.focus(); });
    iaEnganchar(imo, () => iaModelos(_iaFuentes(), im.value));
  });
}

// ══════════════════════════════════════════════════════════
//  💲 Precios de reparación del modelo
// ══════════════════════════════════════════════════════════
// [clave, cómo se anota en la orden, ícono, palabras]. El orden importa
// (igual que en precios-historial.js): "módulo con marco" es módulo, no tapa,
// y "ficha de carga" es pin antes de que "carga" lo mande a otro lado.
const IA_TIPOS = [
  ['placa',    'Placa',                 '🔧', /placa|bga|reball|corto|mojad|humedad|sulfat/],
  ['modulo',   'Módulo / Pantalla',     '📱', /pantalla|modulo|display|lcd|oled|incell|glass|templad|vidrio|tactil/],
  ['bateria',  'Batería',               '🔋', /bateri|pila/],
  ['pin',      'Pin de carga',          '🔌', /pin|ficha|puerto|conector|carga/],
  ['flex',     'Flex',                  '🔗', /flex/],
  ['camara',   'Cámara',                '📷', /camara|lente/],
  ['parlante', 'Parlante / Auricular',  '🔊', /parlante|altavoz|auricular|audio|sonido|buzzer/],
  ['mic',      'Micrófono',             '🎤', /microfono|\bmic\b/],
  ['tapa',     'Tapa / Carcasa',        '🛡️', /tapa|carcasa|chasis|marco|back/],
  ['botones',  'Botones',               '⏺️', /boton|power|volumen|home|encendido/],
  ['soft',     'Software / Liberación', '💾', /software|sistema|liberac|desbloque|frp|icloud|formate|actualiz|flasheo/],
];
// Los que se muestran siempre, aunque no tengan precio (son los de todos los días)
const IA_PRINCIPALES = ['modulo', 'bateria', 'pin'];

function iaTipoDe(texto) {
  const t = _iaNorm(texto);
  if (!t) return null;
  for (const x of IA_TIPOS) if (x[3].test(t)) return x[0];
  return null;
}
const _iaTipo = clave => IA_TIPOS.find(x => x[0] === clave);

function _iaMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return Date.parse(v) || 0;
}

// ¿Este texto ("Samsung A54", "A54 / A34", "iPhone 13") es del modelo
// escrito? Misma regla que los repuestos: palabras enteras y sin variantes
// de más ("13" no es "13 Pro"). Si el texto arranca con OTRA marca, no.
function _iaDelModelo(marca, modelo, items) {
  if (typeof repuestosDelModelo !== 'function') return [];
  return repuestosDelModelo(marca, modelo, items);
}
function _iaMarcaDelTexto(txt) {
  const w = _iaNorm(txt).split(' ')[0] || '';
  return _IA_MARCAS_CONOCIDAS.has(w) ? w : '';
}

// Arma los renglones: { clave, rotulo, icono, precio, origen, fecha, ultimo, repuesto, enStock }
//   origen: 'lista' (lista de precios) · 'ultimo' (lo último que se cobró) · null (sin precio)
//   repuesto: 'hay' · 'pedir' · null (no hay repuesto cargado de ese tipo)
function iaPreciosModelo(marca, modelo, datos) {
  const d = datos || {};
  if (!_iaNorm(modelo)) return [];
  const filas = new Map();
  const fila = clave => {
    if (!filas.has(clave)) {
      const t = _iaTipo(clave);
      filas.set(clave, { clave, rotulo: t[1], icono: t[2], precio: 0, origen: null, fecha: '', ultimo: 0, _ts: -1, _tsU: '', repuesto: null, enStock: 0 });
    }
    return filas.get(clave);
  };
  IA_PRINCIPALES.forEach(fila);

  // 1) Lista de precios: { tipo, equipo, precio, updatedAt }
  const lista = (d.lista || []).filter(p => p && Number(p.precio) > 0 && p.equipo)
    .map(p => ({ marca: _iaMarcaDelTexto(p.equipo), modelo: '', nombre: p.equipo, cantidad: 0, _p: p }));
  _iaDelModelo(marca, modelo, lista).forEach(x => {
    const clave = iaTipoDe(x._p.tipo) || iaTipoDe(x._p.nota);
    if (!clave) return;
    const f = fila(clave), ts = _iaMs(x._p.updatedAt);
    if (f.origen !== 'lista' || ts > f._ts) { f.precio = Number(x._p.precio); f.origen = 'lista'; f._ts = ts; }
  });

  // 2) Lo último que se cobró en ese modelo (cada arreglo con SU precio)
  const reps = (d.reps || []).filter(r => r && (r.modelo || r.marca))
    .map(r => ({ marca: r.marca, modelo: r.modelo, nombre: '', cantidad: 0, _r: r }));
  _iaDelModelo(marca, modelo, reps).forEach(x => {
    const r = x._r;
    const fecha = String(r.fechaIngreso || r.fecha || '').slice(0, 10);
    const arr = (Array.isArray(r.arreglos) && r.arreglos.length) ? r.arreglos
      : (r.arreglo ? [{ texto: r.arreglo, precio: r.monto }] : []);
    arr.forEach(a => {
      const precio = Number(a && a.precio) || 0;
      const clave = precio > 0 ? iaTipoDe(a.texto) : null;
      if (!clave) return;
      const f = fila(clave);
      if (fecha >= f._tsU) { f._tsU = fecha; f.ultimo = precio; f.fecha = fecha; }
    });
  });
  filas.forEach(f => {
    if (f.origen !== 'lista' && f.ultimo > 0) { f.precio = f.ultimo; f.origen = 'ultimo'; }
  });

  // 3) ¿Hay el repuesto? (por tipo, entre los repuestos de este modelo)
  _iaDelModelo(marca, modelo, d.repuestos || []).forEach(r => {
    const clave = iaTipoDe(r.tipo) || iaTipoDe(r.nombre);
    if (!clave || !filas.has(clave)) return;   // repuesto sin arreglo con precio: ya sale en la lista de abajo
    const f = filas.get(clave);
    f.enStock += Number(r.cantidad) || 0;
    f.repuesto = f.enStock > 0 ? 'hay' : 'pedir';
  });

  const orden = IA_TIPOS.map(x => x[0]);
  const pri = k => { const i = IA_PRINCIPALES.indexOf(k); return i < 0 ? 9 + orden.indexOf(k) : i; };
  return [...filas.values()].sort((a, b) => pri(a.clave) - pri(b.clave))
    .map(f => { delete f._ts; delete f._tsU; return f; });
}

// ── Lista de precios en el index ───────────────────────────
// La lista vive en la caja (precios.js, con su listener). Acá alcanza con
// leerla UNA vez: se usa el caché que deja la caja en esta compu
// ('preciosCache') y solo si tiene más de 6 horas se pide a Firestore, una
// vez por sesión. CUPO: es una lectura por precio cargado, no por visita.
const IA_PRECIOS_TTL = 6 * 3600 * 1000;
let _iaPrecios = null, _iaPreciosPedidos = false;
function iaListaPrecios() {
  if (typeof PRECIOS !== 'undefined' && Array.isArray(PRECIOS) && PRECIOS.length) return PRECIOS;
  if (!_iaPrecios) {
    try { const c = JSON.parse(localStorage.getItem('preciosCache') || 'null'); if (Array.isArray(c)) _iaPrecios = c; } catch {}
  }
  return _iaPrecios || [];
}
function iaCargarPrecios() {
  if (_iaPreciosPedidos) return;
  _iaPreciosPedidos = true;
  if (typeof PRECIOS !== 'undefined' && Array.isArray(PRECIOS) && PRECIOS.length) return;
  let ts = 0;
  try { ts = Number(localStorage.getItem('preciosCacheTs')) || 0; } catch {}
  if (Date.now() - ts < IA_PRECIOS_TTL && iaListaPrecios().length) return;
  if (typeof db === 'undefined' || !db) return;
  db.collection('precios_reparaciones').get().then(snap => {
    if (typeof cupoSnap === 'function') cupoSnap('precios', snap, true);
    _iaPrecios = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    try {
      localStorage.setItem('preciosCache', JSON.stringify(_iaPrecios));
      localStorage.setItem('preciosCacheTs', String(Date.now()));
    } catch {}
    if (typeof _repuModeloPintar === 'function') _repuModeloPintar();
  }).catch(err => {
    _iaPreciosPedidos = false;   // que lo reintente la próxima vez que se abra el ingreso
    console.warn('precios de reparación:', err);
  });
}

function _iaFechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}` : '';
}
const _iaPlata = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

// El pedazo de HTML que va adentro del recuadro del modelo
function iaPreciosHtml(marca, modelo) {
  _iaEstilos();
  const filas = iaPreciosModelo(marca, modelo, {
    lista: iaListaPrecios(),
    reps: (typeof REPAIRS !== 'undefined') ? REPAIRS : [],
    repuestos: (typeof REPUESTOS !== 'undefined') ? REPUESTOS : [],
  });
  if (!filas.length) return '';
  const enOrden = new Set(((typeof _repArreglos !== 'undefined') ? _repArreglos : []).map(a => iaTipoDe(a.texto)).filter(Boolean));
  const algunoDeLista = filas.some(f => f.origen === 'lista');
  return `<div class="ia-sec">💲 Precios de reparación</div>` + filas.map(f => {
    const ya = enOrden.has(f.clave);
    const de = f.origen === 'lista' ? 'de la lista'
      : f.origen === 'ultimo' ? `último cobrado${f.fecha ? ' el ' + _iaFechaCorta(f.fecha) : ''}` : 'sin precio cargado';
    const rep = f.repuesto === 'hay' ? `<span class="rm-stock ok">hay repuesto</span>`
      : f.repuesto === 'pedir' ? `<span class="rm-stock no">pedir repuesto</span>` : '';
    return `<button type="button" class="ia-pr${ya ? ' ya' : ''}" onclick="iaSumarArreglo('${f.clave}', ${Math.round(f.precio) || 0})">
      <span class="ia-pr-ico" aria-hidden="true">${f.icono}</span>
      <span class="ia-pr-nom">${esc(f.rotulo)}<small>${ya ? '✓ ya está en la orden' : de}</small></span>
      ${rep}
      <span class="ia-pr-precio${f.precio ? '' : ' no'}">${f.precio ? _iaPlata(f.precio) : '—'}</span>
    </button>`;
  }).join('') + `<div class="rm-nada">Tocá un arreglo para sumarlo a la orden.${algunoDeLista ? '' : ' Los precios fijos se cargan en Caja → 💲 Precios de reparación.'}</div>`;
}

// Toque en un renglón → a "Reparaciones a hacer", con el precio sugerido
function iaSumarArreglo(clave, precio) {
  const t = _iaTipo(clave);
  if (!t || typeof _repArreglos === 'undefined') return;
  if (_repArreglos.some(a => iaTipoDe(a.texto) === clave)) {
    if (typeof toast === 'function') toast(`${t[1]} ya está en la orden`, 'error');
    return;
  }
  _repArreglos.push({ texto: t[1], precio: Math.max(0, Number(precio) || 0), hecho: false });
  if (typeof _renderArreglos === 'function') _renderArreglos();
  if (typeof _syncMontoDesdeArreglos === 'function') _syncMontoDesdeArreglos();
  if (typeof _renderArreglosTotal === 'function') _renderArreglosTotal();
  if (typeof _repuModeloPintar === 'function') _repuModeloPintar();
  if (typeof toast === 'function') toast(`Sumado a la orden: ${t[1]}${precio ? ' ' + _iaPlata(precio) : ''}`, 'success');
}

function _iaEstilos() {
  if (typeof document === 'undefined' || document.getElementById('ia-css')) return;
  const st = document.createElement('style');
  st.id = 'ia-css';
  st.textContent = `
  .ia-wrap { position: relative; }
  .ia-sug { position: absolute; left: 0; right: 0; top: 100%; z-index: 60; margin-top: 4px; background: var(--card, #fff); border: 1px solid var(--border, rgba(128,128,128,.3)); border-radius: 12px; box-shadow: var(--shadow-md, 0 8px 24px rgba(0,0,0,.18)); max-height: 264px; overflow-y: auto; }
  .ia-sug.hidden { display: none; }
  .ia-op { display: block; width: 100%; text-align: left; padding: 11px 14px; font: inherit; font-size: 15px; background: none; border: 0; border-top: 1px solid var(--border, rgba(128,128,128,.2)); color: var(--text, inherit); cursor: pointer; }
  .ia-op:first-child { border-top: 0; }
  .ia-op:hover, .ia-op.on { background: var(--hover, rgba(128,128,128,.1)); }
  .ia-sec { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--t2, #888); margin-top: 2px; }
  .ia-pr { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font: inherit; font-size: 13.5px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--border, rgba(128,128,128,.25)); background: var(--card, #fff); color: var(--text, inherit); cursor: pointer; }
  .ia-pr:active { transform: scale(.99); }
  .ia-pr.ya { opacity: .6; }
  .ia-pr-ico { flex: none; font-size: 16px; }
  .ia-pr-nom { flex: 1; min-width: 0; font-weight: 600; }
  .ia-pr-nom small { display: block; font-weight: 400; font-size: 11.5px; color: var(--t2, #888); }
  .ia-pr-precio { flex: none; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 70px; text-align: right; }
  .ia-pr-precio.no { color: var(--t2, #888); font-weight: 500; }`;
  document.head.appendChild(st);
}

if (typeof document !== 'undefined' && document.getElementById) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iaIniciar);
  else iaIniciar();
}
