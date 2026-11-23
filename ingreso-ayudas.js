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
//
//  3) MEMORIA DE PRECIOS. Alan (22/11): "¿podés sacar precios de los que
//     pasamos ya? Y memorizar también como sugerencia para los precios
//     futuros". Las reparaciones en memoria son solo las de 30 días, así que
//     cada precio que se pasa queda guardado en `precios_memoria` (un doc por
//     modelo: "samsung_a54" → { tipos: { bateria: {precio, fecha}, … } }):
//       · al guardar una reparación se anota el precio de cada arreglo
//         (una escritura por reparación);
//       · al escribir el modelo se lee SOLO el doc de ese modelo (una lectura,
//         y queda en caché 12 h);
//       · "los que pasamos ya": botón del dueño que recorre las reparaciones de
//         los últimos 12 meses UNA vez y carga todo (una lectura por reparación,
//         una sola vez).
//     Y al elegir un arreglo en el paso 2, el precio se completa solo con el
//     sugerido (se puede cambiar).
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
  const canon = m => (typeof marcaCanon === 'function' ? marcaCanon(m) : m);
  return [...new Set(_iaContar(pares).map(x => x.clave === 'iphone' ? 'iPhone' : canon(x.forma)))];
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
    if (f.origen !== 'lista' || ts > f._ts) {
      f.precio = Number(x._p.precio); f.origen = 'lista'; f._ts = ts;
      f.listaId = x._p.id || ''; f.listaEquipo = String(x._p.equipo || '');
    }
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
  // 2b) La memoria de precios (todas las reparaciones, no solo 30 días):
  // gana la más nueva entre la memoria y lo que hay en memoria del celu
  Object.entries(d.memoria || {}).forEach(([clave, v]) => {
    const precio = Number(v && v.precio) || 0;
    if (!(precio > 0) || !_iaTipo(clave)) return;
    const f = fila(clave), fecha = String(v.fecha || '').slice(0, 10);
    if (fecha >= f._tsU) { f._tsU = fecha; f.ultimo = precio; f.fecha = fecha; }
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
function _iaDatos(marca, modelo) {
  return {
    lista: iaListaPrecios(),
    reps: (typeof REPAIRS !== 'undefined') ? REPAIRS : [],
    repuestos: (typeof REPUESTOS !== 'undefined') ? REPUESTOS : [],
    memoria: iaMemoria(marca, modelo),
  };
}
function iaPreciosHtml(marca, modelo) {
  _iaEstilos();
  const filas = iaPreciosModelo(marca, modelo, _iaDatos(marca, modelo));
  if (!filas.length) return '';
  const enOrden = new Set(((typeof _repArreglos !== 'undefined') ? _repArreglos : []).map(a => iaTipoDe(a.texto)).filter(Boolean));
  const algunoDeLista = filas.some(f => f.origen === 'lista');
  const puedeEditar = _iaPuedeEditar();
  // Si se cambió de modelo con un precio a medio editar, esa edición se descarta
  const editando = (puedeEditar && _iaEdit && _iaEdit.modelo === iaClaveModelo(marca, modelo)) ? _iaEdit.clave : null;
  return `<div class="ia-sec">💲 Precios de reparación</div>` + filas.map(f => {
    const ya = enOrden.has(f.clave);
    const de = f.origen === 'lista' ? 'de la lista'
      : f.origen === 'ultimo' ? `último precio${f.fecha ? ' el ' + _iaFechaCorta(f.fecha) : ''}` : 'sin precio cargado';
    const rep = f.repuesto === 'hay' ? `<span class="rm-stock ok">hay repuesto</span>`
      : f.repuesto === 'pedir' ? `<span class="rm-stock no">pedir repuesto</span>` : '';
    if (editando === f.clave) return _iaFilaEditando(f, marca, modelo);
    return `<div class="ia-pr-fila"><button type="button" class="ia-pr${ya ? ' ya' : ''}" onclick="iaSumarArreglo('${f.clave}', ${Math.round(f.precio) || 0})">
      <span class="ia-pr-ico" aria-hidden="true">${f.icono}</span>
      <span class="ia-pr-nom">${esc(f.rotulo)}<small>${ya ? '✓ ya está en la orden' : de}${rep ? ' ' + rep : ''}</small></span>
      <span class="ia-pr-precio${f.precio ? '' : ' no'}">${f.precio ? _iaPlata(f.precio) : '—'}</span>
    </button>${puedeEditar ? `<button type="button" class="ia-pr-lapiz" onclick="iaEditarPrecio('${f.clave}')" aria-label="Cambiar el precio de ${esc(f.rotulo)}" title="Cambiar el precio">✏️</button>` : ''}</div>`;
  }).join('') + `<div class="rm-nada">Tocá un arreglo para sumarlo a la orden.${puedeEditar ? ' Con ✏️ cambiás el precio.' : (algunoDeLista ? '' : ' Los precios fijos se cargan en Caja → 💲 Precios de reparación.')}</div>`
    + _iaBotonAprender();
}

// ── ✏️ Cambiar un precio desde el recuadro ─────────────────
// Alan (22/11): "dame la opción de modificar los precios". El precio que se
// pone queda en la LISTA DE PRECIOS (precios_reparaciones, la misma de Caja →
// 💲 Precios de reparación), que es la que manda: desde ahí lo ven todos, en
// el recuadro y al elegir el arreglo en el paso 2.
//   · Si el precio ya salía de la lista, se cambia ESE renglón (si el renglón
//     es "A54 / A34", cambia para los dos y se avisa).
//   · Si salía del último precio o no había, se crea el renglón
//     "Marca Modelo".
// Solo el dueño (y no en modo mostrador): los precios los decide él.
// Esconder el lápiz no protege la base; la lista ya se podía tocar desde la
// caja, igual que antes.
const IA_TIPO_LISTA = {   // clave → el tipo como lo nombra la lista de precios (PRECIO_TIPOS)
  modulo: 'Pantalla / Módulo', bateria: 'Batería', pin: 'Pin de carga', flex: 'Flex', camara: 'Cámara',
  parlante: 'Parlante / Auricular', mic: 'Micrófono', tapa: 'Tapa / Carcasa', botones: 'Botones',
  soft: 'Software / Liberación', placa: 'Placa',
};
let _iaEdit = null;   // { clave, modelo (iaClaveModelo), valor }

function _iaPuedeEditar() { return (typeof tpEsDueno === 'function') ? tpEsDueno() : false; }
function _iaCampos() {
  const v = id => ((typeof document !== 'undefined' && document.getElementById(id)) || {}).value || '';
  return { marca: v('rep-fi-marca').trim(), modelo: v('rep-fi-modelo').trim() };
}
function _iaFilaDe(clave) {
  const { marca, modelo } = _iaCampos();
  return iaPreciosModelo(marca, modelo, _iaDatos(marca, modelo)).find(x => x.clave === clave) || null;
}

function _iaFilaEditando(f, marca, modelo) {
  const equipo = f.listaId ? f.listaEquipo : [marca.trim(), modelo.trim()].filter(Boolean).join(' ');
  const nota = f.listaId
    ? (iaClaveModelo('', f.listaEquipo) !== iaClaveModelo('', [marca, modelo].join(' ')) ? `cambia el de la lista: "${esc(equipo)}"` : 'cambia el de la lista')
    : `queda en la lista para ${esc(equipo)}`;
  return `<div class="ia-pr ia-pr--edit">
    <span class="ia-pr-ico" aria-hidden="true">${f.icono}</span>
    <span class="ia-pr-nom">${esc(f.rotulo)}<small>${nota}</small></span>
    <span class="ia-edit-ctl">
      <span class="ia-edit-pesos">$</span><input id="ia-edit-in" class="ia-edit-in" type="text" inputmode="numeric" autocomplete="off"
        value="${esc(_iaEdit.valor)}" oninput="iaEditTipeo(this.value)"
        onkeydown="if(event.key==='Enter'){event.preventDefault();iaEditGuardar()}else if(event.key==='Escape'){iaEditCancelar()}">
      <button type="button" class="ia-edit-ok" onclick="iaEditGuardar()">Guardar</button>
      <button type="button" class="ia-edit-x" onclick="iaEditCancelar()" aria-label="Cancelar">✕</button>
    </span>
    ${f.listaId ? `<button type="button" class="ia-edit-quitar" onclick="iaEditQuitar()">Sacarlo de la lista (vuelve al último precio)</button>` : ''}
  </div>`;
}

function iaEditarPrecio(clave) {
  if (!_iaPuedeEditar() || !_iaTipo(clave)) return;
  const { marca, modelo } = _iaCampos();
  const f = _iaFilaDe(clave);
  _iaEdit = { clave, modelo: iaClaveModelo(marca, modelo), valor: f && f.precio ? String(Math.round(f.precio)) : '' };
  if (typeof _repuModeloPintar === 'function') _repuModeloPintar();
  const inp = document.getElementById('ia-edit-in');
  if (inp) { inp.focus(); try { inp.select(); } catch {} }
}
function iaEditTipeo(v) { if (_iaEdit) _iaEdit.valor = String(v || ''); }
function iaEditCancelar() {
  _iaEdit = null;
  if (typeof _repuModeloPintar === 'function') _repuModeloPintar();
}
// "$ 45.000", "45000", "45k" → 45000
function iaLeerPrecio(txt) {
  const s = String(txt || '').toLowerCase().replace(/\s/g, '');
  const k = /k$/.test(s);
  const n = Number(s.replace(/k$/, '').replace(/[$.]/g, '').replace(',', '.')) || 0;
  return Math.round(k ? n * 1000 : n);
}

// La lista que hay que tocar en memoria: la de la caja (PRECIOS) si está
// abierta, si no la del index (_iaPrecios); y el caché de esta compu.
function _iaListaLocal() {
  if (typeof PRECIOS !== 'undefined' && Array.isArray(PRECIOS) && PRECIOS.length) return PRECIOS;
  if (!_iaPrecios) _iaPrecios = iaListaPrecios().slice();
  return _iaPrecios;
}
function _iaListaCache() {
  try { localStorage.setItem('preciosCache', JSON.stringify(_iaListaLocal())); } catch {}
}

function iaEditGuardar() {
  if (!_iaEdit || !_iaPuedeEditar()) return;
  const precio = iaLeerPrecio(_iaEdit.valor);
  if (!(precio > 0)) { if (typeof toast === 'function') toast('Poné un precio mayor a $0', 'error'); return; }
  const { marca, modelo } = _iaCampos();
  const clave = _iaEdit.clave, f = _iaFilaDe(clave), t = _iaTipo(clave);
  if (!f || !t || typeof db === 'undefined' || !db) return;
  const equipo = f.listaId ? f.listaEquipo : [marca, modelo].filter(Boolean).join(' ');
  const data = { tipo: IA_TIPO_LISTA[clave], equipo, precio, updatedAt: new Date().toISOString() };
  const col = db.collection('precios_reparaciones');
  // El id se saca antes de subir: así se ve al instante aunque no haya señal
  // (Firestore lo sube cuando vuelve), sin esperar la respuesta.
  const ref = f.listaId ? col.doc(f.listaId) : col.doc();
  const lista = _iaListaLocal();
  const i = lista.findIndex(p => p && p.id === ref.id);
  if (i >= 0) lista[i] = Object.assign({}, lista[i], data); else lista.push(Object.assign({ id: ref.id }, data));
  _iaListaCache();
  ref.set(data, { merge: true }).catch(err => {
    console.error('guardar precio:', err);
    if (typeof toast === 'function') toast('No se pudo guardar el precio en la base. Probá de nuevo.', 'error');
  });
  _iaEdit = null;
  if (typeof _repuModeloPintar === 'function') _repuModeloPintar();
  if (typeof toast === 'function') toast(`💲 ${t[1]} ${_iaPlata(precio)} para ${equipo} · queda en la lista de precios`, 'success');
}

function iaEditQuitar() {
  if (!_iaEdit || !_iaPuedeEditar()) return;
  const f = _iaFilaDe(_iaEdit.clave);
  if (!f || !f.listaId || typeof db === 'undefined' || !db) return;
  if (typeof confirm === 'function' && !confirm(`¿Sacar "${f.rotulo} · ${f.listaEquipo}" de la lista de precios?`)) return;
  const lista = _iaListaLocal();
  const i = lista.findIndex(p => p && p.id === f.listaId);
  if (i >= 0) lista.splice(i, 1);
  _iaListaCache();
  db.collection('precios_reparaciones').doc(f.listaId).delete().catch(err => {
    console.error('sacar precio:', err);
    if (typeof toast === 'function') toast('No se pudo sacar de la lista. Probá de nuevo.', 'error');
  });
  _iaEdit = null;
  if (typeof _repuModeloPintar === 'function') _repuModeloPintar();
  if (typeof toast === 'function') toast('Sacado de la lista de precios', 'success');
}

// Precio sugerido para un arreglo escrito o elegido en el paso 2
// ("Batería" → el de la lista o el último que se pasó en este modelo)
function iaPrecioSugerido(texto) {
  const clave = iaTipoDe(texto);
  if (!clave || typeof document === 'undefined') return 0;
  const marca  = (document.getElementById('rep-fi-marca')  || {}).value || '';
  const modelo = (document.getElementById('rep-fi-modelo') || {}).value || '';
  const f = iaPreciosModelo(marca, modelo, _iaDatos(marca, modelo)).find(x => x.clave === clave);
  return f ? Math.round(f.precio) || 0 : 0;
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

// ══════════════════════════════════════════════════════════
//  🧠 Memoria de precios (colección precios_memoria)
// ══════════════════════════════════════════════════════════
const IA_MEM_COL = 'precios_memoria';
const IA_MEM_TTL = 12 * 3600 * 1000;
const IA_MEM_DIAS = 7;   // solo se memorizan reparaciones de la última semana (ver iaMemorizar)
// Palabras que no cambian el equipo: "Galaxy A54 5G" es el A54
const IA_RELLENO = new Set(['galaxy', 'moto', '5g', '4g', 'lte']);

// "Samsung" + "Galaxy A54 5G" → "samsung_a54". La misma clave para cómo lo
// escriba cada uno; sin modelo, ''.
function iaClaveModelo(marca, modelo) {
  const mq = _iaMarcaClave(marca);
  const toks = _iaNorm(modelo).split(' ')
    .filter(t => t && t !== mq && t !== 'apple' && !(mq === 'iphone' && t === 'iphone') && !IA_RELLENO.has(t));
  if (!toks.length) return '';
  return ((mq || 'x').replace(/ /g, '-') + '_' + toks.join('-')).slice(0, 120);
}

// Lo que se anota de UNA reparación: { clave, tipos: { bateria: {precio, fecha, texto} } }
function iaMemoDeReparacion(r) {
  if (!r) return null;
  const clave = iaClaveModelo(r.marca, r.modelo);
  if (!clave) return null;
  const fecha = String(r.fechaIngreso || r.fecha || '').slice(0, 10);
  const arr = (Array.isArray(r.arreglos) && r.arreglos.length) ? r.arreglos
    : (r.arreglo ? [{ texto: r.arreglo, precio: r.monto }] : []);
  const tipos = {};
  arr.forEach(a => {
    const precio = Math.round(Number(a && a.precio) || 0);
    const t = precio > 0 ? iaTipoDe(a.texto) : null;
    if (t && !tipos[t]) tipos[t] = { precio, fecha, texto: String(a.texto || '').trim().slice(0, 60) };
  });
  return Object.keys(tipos).length ? { clave, marca: String(r.marca || '').trim(), modelo: String(r.modelo || '').trim(), tipos } : null;
}

// Muchas reparaciones → un doc por modelo, con el precio MÁS NUEVO de cada arreglo
function iaAprenderDeReparaciones(reps) {
  const out = new Map();
  (reps || []).forEach(r => {
    const m = iaMemoDeReparacion(r);
    if (!m) return;
    const g = out.get(m.clave) || { marca: m.marca, modelo: m.modelo, tipos: {} };
    Object.entries(m.tipos).forEach(([t, v]) => {
      if (!g.tipos[t] || v.fecha >= g.tipos[t].fecha) g.tipos[t] = v;
    });
    out.set(m.clave, g);
  });
  return out;
}

const _iaMem = new Map();   // clave → tipos (o null mientras se pide)
let _iaMemT = null;
function _iaMemCache() {
  try { return JSON.parse(localStorage.getItem('tpPreciosMem') || '{}') || {}; } catch { return {}; }
}
function _iaMemGuardar(clave, tipos) {
  _iaMem.set(clave, tipos);
  try {
    const c = _iaMemCache();
    c[clave] = { t: Date.now(), tipos };
    const ks = Object.keys(c);
    if (ks.length > 300) ks.sort((a, b) => c[a].t - c[b].t).slice(0, ks.length - 300).forEach(k => delete c[k]);
    localStorage.setItem('tpPreciosMem', JSON.stringify(c));
  } catch {}
}

// Lo que haya YA de este modelo. Si no está (o el caché es viejo), lo pide
// después de 700 ms sin escribir: mientras se tipea "A5", "A54" no se lee
// cada letra. Al llegar, repinta el recuadro.
function iaMemoria(marca, modelo) {
  const clave = iaClaveModelo(marca, modelo);
  if (!clave) return null;
  if (_iaMem.has(clave)) return _iaMem.get(clave);
  const c = _iaMemCache()[clave];
  if (c && Date.now() - c.t < IA_MEM_TTL) { _iaMem.set(clave, c.tipos); return c.tipos; }
  clearTimeout(_iaMemT);
  _iaMemT = setTimeout(() => _iaMemPedir(clave), 700);
  return c ? c.tipos : null;
}
function _iaMemPedir(clave) {
  if (_iaMem.has(clave) || typeof db === 'undefined' || !db) return;
  _iaMem.set(clave, null);   // que no se pida dos veces
  db.collection(IA_MEM_COL).doc(clave).get().then(doc => {
    if (typeof cupoContar === 'function') cupoContar('precios_memoria', 1);
    _iaMemGuardar(clave, doc.exists ? (doc.data().tipos || {}) : {});
    if (typeof _repuModeloPintar === 'function') _repuModeloPintar();
  }).catch(err => { _iaMem.delete(clave); console.warn('memoria de precios:', err); });
}

// Al guardar una reparación (repairs.js saveRepair). Solo si es de la última
// semana: si se edita una de hace meses, su precio viejo no pisa el de hoy.
function iaMemorizar(r) {
  const m = iaMemoDeReparacion(r);
  if (!m || typeof db === 'undefined' || !db) return;
  const desde = new Date(Date.now() - IA_MEM_DIAS * 86400000).toISOString().slice(0, 10);
  if (Object.values(m.tipos)[0].fecha < desde) return;
  db.collection(IA_MEM_COL).doc(m.clave)
    .set({ marca: m.marca, modelo: m.modelo, tipos: m.tipos, actualizado: new Date().toISOString() }, { merge: true })
    .catch(err => console.warn('memoria de precios:', err));
  // Que se vea ya, sin volver a leer
  const antes = _iaMem.get(m.clave) || (_iaMemCache()[m.clave] || {}).tipos || {};
  _iaMemGuardar(m.clave, Object.assign({}, antes, m.tipos));
}

// ── "Los que pasamos ya": una vez, desde el recuadro (solo el dueño) ──
const IA_APRENDER_MESES = 12;
let _iaAprendido = null;   // null = no se sabe todavía
function _iaYaAprendido() {
  if (_iaAprendido !== null) return _iaAprendido;
  try { if (localStorage.getItem('tpPreciosMemAprendido')) return (_iaAprendido = true); } catch {}
  _iaAprendido = false;
  // Una lectura por sesión para saber si ya se hizo desde otra compu
  if (typeof db !== 'undefined' && db) {
    db.collection(IA_MEM_COL).doc('_estado').get().then(doc => {
      if (!doc.exists) return;
      _iaAprendido = true;
      try { localStorage.setItem('tpPreciosMemAprendido', '1'); } catch {}
      if (typeof _repuModeloPintar === 'function') _repuModeloPintar();
    }).catch(() => {});
  }
  return false;
}
function _iaBotonAprender() {
  const dueno = (typeof tpEsDueno === 'function') ? tpEsDueno() : false;
  if (!dueno || _iaYaAprendido()) return '';
  return `<button type="button" class="ia-aprender" onclick="iaAprenderHistorial(this)">🧠 Sacar los precios de las reparaciones de los últimos ${IA_APRENDER_MESES} meses</button>`;
}

async function iaAprenderHistorial(btn) {
  if (typeof db === 'undefined' || !db) return;
  if (btn) { btn.disabled = true; btn.textContent = '🧠 Leyendo las reparaciones…'; }
  try {
    const desde = new Date(Date.now() - IA_APRENDER_MESES * 30.5 * 86400000).toISOString();
    const snap = await db.collection('repairs').where('fechaIngreso', '>=', desde).get();
    if (typeof cupoContar === 'function') cupoContar('repairs', snap.size);
    const modelos = iaAprenderDeReparaciones(snap.docs.map(d => d.data()));
    const claves = [...modelos.keys()];
    let precios = 0;
    for (let i = 0; i < claves.length; i += 400) {
      const lote = db.batch();
      claves.slice(i, i + 400).forEach(k => {
        const g = modelos.get(k);
        precios += Object.keys(g.tipos).length;
        lote.set(db.collection(IA_MEM_COL).doc(k), { ...g, actualizado: new Date().toISOString() }, { merge: true });
      });
      await lote.commit();
    }
    await db.collection(IA_MEM_COL).doc('_estado').set({
      aprendido: new Date().toISOString(), meses: IA_APRENDER_MESES, reparaciones: snap.size, modelos: claves.length,
    });
    _iaAprendido = true;
    try { localStorage.setItem('tpPreciosMemAprendido', '1'); localStorage.removeItem('tpPreciosMem'); } catch {}
    _iaMem.clear();
    modelos.forEach((g, k) => _iaMemGuardar(k, g.tipos));
    if (typeof toast === 'function') toast(`🧠 Listo: ${precios} precios de ${claves.length} modelos (de ${snap.size} reparaciones)`, 'success');
    if (typeof _repuModeloPintar === 'function') _repuModeloPintar();
  } catch (err) {
    console.error('aprender precios:', err);
    if (typeof toast === 'function') toast('No se pudieron leer las reparaciones. Probá de nuevo.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🧠 Reintentar: sacar los precios de las reparaciones'; }
  }
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
  .ia-pr-precio.no { color: var(--t2, #888); font-weight: 500; }
  .ia-pr-nom .rm-stock { display: inline-block; font-size: 10.5px; padding: 1px 7px; margin-left: 2px; vertical-align: 1px; }
  .ia-pr-fila { display: flex; gap: 6px; align-items: stretch; }
  .ia-pr-fila .ia-pr { flex: 1; min-width: 0; }
  .ia-pr-lapiz { flex: none; width: 40px; border-radius: 10px; border: 1px solid var(--border, rgba(128,128,128,.25)); background: var(--card, #fff); font-size: 16px; cursor: pointer; }
  .ia-pr--edit { flex-wrap: wrap; cursor: default; border-color: var(--accent, #3b82f6); }
  .ia-pr--edit:active { transform: none; }
  .ia-pr--edit .ia-pr-nom { flex: 1 1 60%; }
  .ia-edit-ctl { display: flex; align-items: center; gap: 6px; flex: 1 1 100%; }
  .ia-edit-pesos { font-weight: 700; color: var(--t2, #888); }
  .ia-edit-in { flex: 1; min-width: 0; width: 0; font: inherit; font-size: 16px; font-weight: 700; padding: 9px 10px; border-radius: 8px; border: 1px solid var(--accent, #3b82f6); background: var(--input, #fff); color: var(--text, inherit); }
  .ia-edit-ok { flex: none; font: inherit; font-weight: 700; padding: 9px 14px; border-radius: 8px; border: 0; background: var(--accent, #3b82f6); color: #fff; cursor: pointer; }
  .ia-edit-x { flex: none; font: inherit; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--border, rgba(128,128,128,.3)); background: none; color: var(--text, inherit); cursor: pointer; }
  .ia-edit-quitar { flex: 1 1 100%; text-align: left; background: none; border: 0; padding: 2px 2px 0; font: inherit; font-size: 12px; color: var(--red, #ef4444); cursor: pointer; }
  .ia-aprender { width: 100%; font: inherit; font-size: 13px; font-weight: 700; padding: 10px 12px; border-radius: 10px; border: 1px dashed var(--accent, #3b82f6); background: none; color: var(--accent, #3b82f6); cursor: pointer; }
  .ia-aprender:disabled { opacity: .6; cursor: default; }`;
  document.head.appendChild(st);
}

if (typeof document !== 'undefined' && document.getElementById) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iaIniciar);
  else iaIniciar();
}
