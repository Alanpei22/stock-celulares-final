// ══════════════════════════════════════════════════════════════
//  🔧 EQUIPOS PARA ARREGLAR (los del local, no de clientes)
// ══════════════════════════════════════════════════════════════
//  Alan: "una parte donde pueda poner todos los equipos míos que necesitan
//  cierta reparación y después, reparados, dar opción de poner a la venta".
//
//  Son los celus que el local compró o tomó en parte de pago y que antes de
//  venderse necesitan un arreglo (pantalla, batería, pin de carga…).
//
//  Van en su propia colección (`equipos_arreglo`) y NO en el stock a
//  propósito: el stock es lo que se vende. Si un equipo roto estuviera ahí
//  con una marca, cada lugar que lista el stock (la caja, la página pública,
//  los estados de WhatsApp, el inventario, las estadísticas) tendría que
//  acordarse de saltearlo, y el día que uno se olvide se vende un celu roto.
//  Cuando queda listo, "Poner a la venta" abre el formulario de siempre del
//  stock ya completo (con el costo = compra + arreglo) y recién ahí entra.
//
//  Las reglas de Firebase no cambian: la colección cae en la regla general
//  del trabajo diario (empleados leen y escriben; borrar, con permiso).
'use strict';

const ARR_COL = 'equipos_arreglo';

// Los pasos de un equipo. `activo` dice si todavía está en el taller: la
// lista escucha solo esos (consulta por igualdad, no necesita índice).
const ARR_ESTADOS = {
  pendiente:  { lbl: 'Por arreglar', ico: '🔴' },
  arreglando: { lbl: 'Arreglando',   ico: '🔧' },
  listo:      { lbl: 'Listo',        ico: '✅' },
  a_la_venta: { lbl: 'A la venta',   ico: '💰' },
};

// Los que se eligen a mano (cambiar estado). "A la venta" no: eso es pasarlo al stock.
const ARR_PASOS = ['pendiente', 'arreglando', 'listo'];

let ARREGLOS = [];
let _arrUnsub = null;
let _arrFiltro = 'todos';
let _arrEditId = null;
// Mientras el formulario del stock está abierto desde "Poner a la venta",
// acá queda de qué equipo viene (para cerrarlo al guardar).
let _arrDesde = null;

// La plata (lo que se pagó y lo que costó el arreglo) es como el costo del
// stock: solo la ve el dueño.
function arrVePlata() { return typeof tpEsEmpleado !== 'function' || !tpEsEmpleado(); }

// ── Cuentas (separadas del dibujo para poder probarlas) ───
function arrNum(v) { const n = Math.round(Number(v) || 0); return n > 0 ? n : 0; }
function arrInvertido(a) { return arrNum(a && a.costoCompra) + arrNum(a && a.costoArreglo); }
function arrNombre(a) { return [a.marca, a.modelo, a.almacenamiento].filter(Boolean).join(' ').trim() || 'Equipo sin nombre'; }

function arrResumen(lista) {
  const r = { pendiente: 0, arreglando: 0, listo: 0, total: 0, invertido: 0 };
  (lista || []).forEach(a => {
    if (!a || !a.activo) return;
    if (r[a.estado] !== undefined) r[a.estado]++;
    r.total++;
    r.invertido += arrInvertido(a);
  });
  return r;
}

// Orden: lo listo arriba (es lo que se puede vender ya), después lo que se
// está arreglando y al final lo que espera; dentro, lo más viejo primero.
const _ARR_ORDEN = { listo: 0, arreglando: 1, pendiente: 2 };
function arrOrdenar(lista) {
  return (lista || []).slice().sort((a, b) =>
    ((_ARR_ORDEN[a.estado] ?? 9) - (_ARR_ORDEN[b.estado] ?? 9)) || String(a.fecha || '').localeCompare(String(b.fecha || '')));
}

// Lo que se le pasa al formulario del stock al ponerlo a la venta
function arrParaStock(a) {
  const arreglo = String(a.falla || '').trim();
  const notas = [arreglo ? `Arreglado en el local: ${arreglo}` : '', String(a.notas || '').trim()].filter(Boolean).join(' · ');
  return {
    marca: a.marca || '',
    modelo: a.modelo || '',
    estado: 'Usado',
    almacenamiento: a.almacenamiento || '',
    imei: a.imei || '',
    color: a.color || '',
    bateria: a.bateria || '',
    costo: arrInvertido(a) || '',
    notas,
  };
}

// ── Firestore ─────────────────────────────────────────────
function arrEscuchar() {
  if (_arrUnsub || typeof db === 'undefined') return;
  try {
    _arrUnsub = db.collection(ARR_COL).where('activo', '==', true).onSnapshot(snap => {
      ARREGLOS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      arrPintarContador();
      if (document.getElementById('eqa-mod')) arrPintarLista();
    }, e => console.error('[arreglos] escuchar:', e));
  } catch (e) { console.error('[arreglos] escuchar:', e); }
}

function arrPintarContador() {
  const el = document.getElementById('s-arreglar');
  if (el) el.textContent = arrResumen(ARREGLOS).total;
}

async function _arrGuardar(id, datos) {
  await db.collection(ARR_COL).doc(id).set(datos, { merge: true });
}

// ── Estilos (viajan con el JS: el CSS se sirve del caché) ──
function _arrEstilos() {
  if (document.getElementById('eqa-estilos')) return;
  const st = document.createElement('style');
  st.id = 'eqa-estilos';
  st.textContent = `
.eqa-ov{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000}
.eqa-mod{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,96vw);max-height:90vh;
  overflow:auto;background:var(--card,#fff);color:var(--text,#111);border-radius:16px;padding:16px;z-index:2001;
  box-shadow:0 20px 50px rgba(0,0,0,.3)}
.eqa-hd{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:18px;margin-bottom:4px}
.eqa-x{background:none;border:0;font-size:20px;cursor:pointer;color:inherit}
.eqa-sub{font-size:13px;opacity:.7;margin:0 0 10px}
.eqa-nuevo{width:100%;padding:12px;border:0;border-radius:12px;background:#2563eb;color:#fff;font-weight:700;font-size:15px;cursor:pointer;margin-bottom:10px}
.eqa-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.eqa-chip{padding:6px 12px;border-radius:999px;border:1.5px solid rgba(128,128,128,.3);background:none;color:inherit;font-size:13px;font-weight:600;cursor:pointer}
.eqa-chip.on{background:#0f2b52;border-color:#0f2b52;color:#fff}
.eqa-item{border:1px solid rgba(128,128,128,.22);border-radius:14px;padding:12px;margin-bottom:10px}
.eqa-item--listo{border-color:#22c55e;box-shadow:0 0 0 1px #22c55e inset}
.eqa-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.eqa-nom{font-weight:800;font-size:15px}
.eqa-est{font-size:12px;font-weight:700;white-space:nowrap;padding:3px 9px;border-radius:999px;background:rgba(128,128,128,.14)}
.eqa-est--btn{border:1.5px solid rgba(128,128,128,.3);color:inherit;cursor:pointer;padding:5px 10px;font-family:inherit}
.eqa-ops{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.eqa-op{display:flex;align-items:center;gap:10px;padding:14px;border-radius:12px;border:2px solid rgba(128,128,128,.25);background:none;color:inherit;font-size:16px;font-weight:700;cursor:pointer;text-align:left;font-family:inherit}
.eqa-op.on{border-color:#2563eb;background:rgba(37,99,235,.1);cursor:default}
.eqa-op small{margin-left:auto;font-size:12px;font-weight:600;opacity:.7}
.eqa-f select{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1.5px solid rgba(128,128,128,.3);background:transparent;color:inherit;font-size:15px;font-family:inherit}
.eqa-falla{font-size:14px;margin:6px 0 4px}
.eqa-dato{font-size:12px;opacity:.75}
.eqa-acc{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.eqa-btn{flex:1 1 auto;padding:9px 10px;border-radius:10px;border:1.5px solid rgba(128,128,128,.3);background:none;color:inherit;font-weight:700;font-size:13px;cursor:pointer}
.eqa-btn--si{background:#22c55e;border-color:#22c55e;color:#fff}
.eqa-btn--venta{background:#f59e0b;border-color:#f59e0b;color:#111;flex-basis:100%}
.eqa-btn--x,.eqa-btn--chico{flex:0 0 auto}
.eqa-btn--x{color:#dc2626}
.eqa-vacio{text-align:center;padding:30px 10px;opacity:.7;font-size:14px}
.eqa-f label{display:block;font-size:12px;font-weight:700;opacity:.75;margin:10px 0 4px}
.eqa-f input,.eqa-f textarea{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1.5px solid rgba(128,128,128,.3);background:transparent;color:inherit;font-size:15px;font-family:inherit}
.eqa-f .eqa-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.eqa-guardar{width:100%;margin-top:14px;padding:13px;border:0;border-radius:12px;background:#22c55e;color:#fff;font-weight:800;font-size:16px;cursor:pointer}
.eqa-volver{width:100%;margin-top:8px;padding:10px;border:0;background:none;color:inherit;opacity:.7;cursor:pointer}`;
  document.head.appendChild(st);
}

const _arrEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _arrPlata = n => '$' + arrNum(n).toLocaleString('es-AR');

function _arrModal(html) {
  _arrEstilos();
  document.getElementById('eqa-ov')?.remove();
  document.getElementById('eqa-mod')?.remove();
  const ov = document.createElement('div');
  ov.className = 'eqa-ov'; ov.id = 'eqa-ov'; ov.onclick = arrCerrar;
  const m = document.createElement('div');
  m.className = 'eqa-mod'; m.id = 'eqa-mod';
  m.innerHTML = html;
  document.body.appendChild(ov);
  document.body.appendChild(m);
  return m;
}

function arrCerrar() {
  document.getElementById('eqa-ov')?.remove();
  document.getElementById('eqa-mod')?.remove();
}

// ── La lista ──────────────────────────────────────────────
function arrAbrir() {
  if (typeof closeSheet === 'function') closeSheet();
  arrEscuchar();
  _arrModal('<div id="eqa-cuerpo"></div>');
  arrPintarLista();
}

function arrFiltrar(f) { _arrFiltro = f; arrPintarLista(); }

function arrPintarLista() {
  const cuerpo = document.getElementById('eqa-cuerpo');
  if (!cuerpo) return;
  const r = arrResumen(ARREGLOS);
  const verPlata = arrVePlata();
  const lista = arrOrdenar(ARREGLOS.filter(a => a.activo && (_arrFiltro === 'todos' || a.estado === _arrFiltro)));
  const chip = (k, lbl, n) => `<button type="button" class="eqa-chip${_arrFiltro === k ? ' on' : ''}" onclick="arrFiltrar('${k}')">${lbl} (${n})</button>`;
  const items = lista.map(a => {
    const e = ARR_ESTADOS[a.estado] || ARR_ESTADOS.pendiente;
    const id = _arrEsc(a.id);
    const datos = [a.color, a.imei ? 'IMEI ' + a.imei : '', a.fecha ? 'desde ' + new Date(a.fecha).toLocaleDateString('es-AR') : ''].filter(Boolean).join(' · ');
    const plata = verPlata && arrInvertido(a)
      ? `<div class="eqa-dato">💵 Compra ${_arrPlata(a.costoCompra)} + arreglo ${_arrPlata(a.costoArreglo)} = <b>${_arrPlata(arrInvertido(a))}</b></div>` : '';
    let acc = '';
    if (a.estado === 'pendiente') acc += `<button type="button" class="eqa-btn" onclick="arrPaso('${id}','arreglando')">🔧 Empezar a arreglar</button>`;
    if (a.estado === 'arreglando') acc += `<button type="button" class="eqa-btn eqa-btn--si" onclick="arrPaso('${id}','listo')">✅ Quedó listo</button>`;
    if (a.estado === 'listo') {
      acc += `<button type="button" class="eqa-btn eqa-btn--venta" onclick="arrPonerALaVenta('${id}')">💰 Poner a la venta</button>`;
      acc += `<button type="button" class="eqa-btn" onclick="arrPaso('${id}','arreglando')">↩️ Le falta algo</button>`;
    }
    acc += `<button type="button" class="eqa-btn eqa-btn--chico" onclick="arrEtiqueta('${id}')" title="Imprimir etiqueta">🏷️</button>`;
    acc += `<button type="button" class="eqa-btn eqa-btn--chico" onclick="arrEditar('${id}')" title="Editar">✏️</button>`;
    acc += `<button type="button" class="eqa-btn eqa-btn--x" onclick="arrBorrar('${id}')" title="Sacar de la lista">🗑️</button>`;
    return `<div class="eqa-item${a.estado === 'listo' ? ' eqa-item--listo' : ''}">
      <div class="eqa-top"><span class="eqa-nom">${_arrEsc(arrNombre(a))}</span><button type="button" class="eqa-est eqa-est--btn" onclick="arrElegirEstado('${id}')" title="Cambiar el estado">${e.ico} ${e.lbl} ▾</button></div>
      <div class="eqa-falla">🛠️ ${_arrEsc(a.falla || 'Sin anotar qué necesita')}</div>
      ${datos ? `<div class="eqa-dato">${_arrEsc(datos)}</div>` : ''}
      ${a.notas ? `<div class="eqa-dato">📝 ${_arrEsc(a.notas)}</div>` : ''}
      ${plata}
      <div class="eqa-acc">${acc}</div>
    </div>`;
  }).join('');
  cuerpo.innerHTML = `<div class="eqa-hd"><span>🔧 Equipos para arreglar</span><button type="button" class="eqa-x" onclick="arrCerrar()">✕</button></div>
    <p class="eqa-sub">Los celus del local que necesitan un arreglo antes de venderse. No están en el stock: cuando quedan listos, los ponés a la venta desde acá.${verPlata && r.invertido ? ` Hay <b>${_arrPlata(r.invertido)}</b> invertidos esperando.` : ''}</p>
    <button type="button" class="eqa-nuevo" onclick="arrEditar()">＋ Anotar un equipo</button>
    <div class="eqa-chips">${chip('todos', 'Todos', r.total)}${chip('pendiente', '🔴 Por arreglar', r.pendiente)}${chip('arreglando', '🔧 Arreglando', r.arreglando)}${chip('listo', '✅ Listos', r.listo)}</div>
    ${lista.length ? `<button type="button" class="eqa-chip" style="margin-bottom:10px" onclick="arrEtiquetasTodas()">🏷️ Imprimir ${lista.length === 1 ? 'la etiqueta' : `las ${lista.length} etiquetas`}${_arrFiltro === 'todos' ? '' : ' de este paso'}</button>` : ''}
    ${items || `<div class="eqa-vacio">${r.total ? 'No hay equipos en este paso.' : 'No hay equipos para arreglar.<br>Tocá <b>＋ Anotar un equipo</b> para sumar el primero.'}</div>`}`;
}

// ── Cargar / editar ───────────────────────────────────────
function arrEditar(id) {
  if (typeof tpFrenar === 'function' && tpFrenar('stock', 'anotar equipos para arreglar')) return;
  _arrEditId = id || null;
  const a = id ? ARREGLOS.find(x => x.id === id) : null;
  if (id && !a) return;
  const v = k => _arrEsc(a ? (a[k] ?? '') : '');
  const verPlata = arrVePlata();
  _arrModal(`<div class="eqa-hd"><span>${a ? '✏️ Editar' : '＋ Anotar un equipo'}</span><button type="button" class="eqa-x" onclick="arrAbrir()">✕</button></div>
    <div class="eqa-f">
      <div class="eqa-2">
        <div><label>Marca</label><input id="eqa-marca" value="${v('marca')}" placeholder="Samsung" autocomplete="off"></div>
        <div><label>Modelo</label><input id="eqa-modelo" value="${v('modelo')}" placeholder="Galaxy A32" autocomplete="off"></div>
      </div>
      ${a ? `<label>Estado</label>
      <select id="eqa-estado">${ARR_PASOS.map(k => `<option value="${k}"${a.estado === k ? ' selected' : ''}>${ARR_ESTADOS[k].ico} ${ARR_ESTADOS[k].lbl}</option>`).join('')}</select>` : ''}
      <label>¿Qué necesita? *</label>
      <textarea id="eqa-falla" rows="2" placeholder="Cambio de módulo, batería, pin de carga…">${v('falla')}</textarea>
      <div class="eqa-2">
        <div><label>Capacidad</label><input id="eqa-almacenamiento" value="${v('almacenamiento')}" placeholder="128GB" autocomplete="off"></div>
        <div><label>Color</label><input id="eqa-color" value="${v('color')}" placeholder="Negro" autocomplete="off"></div>
      </div>
      <div class="eqa-2">
        <div><label>IMEI</label><input id="eqa-imei" value="${v('imei')}" inputmode="numeric" maxlength="15" autocomplete="off"></div>
        <div><label>Batería %</label><input id="eqa-bateria" value="${v('bateria')}" inputmode="numeric" maxlength="3" autocomplete="off"></div>
      </div>
      ${verPlata ? `<div class="eqa-2">
        <div><label>Lo que pagaste por él $</label><input id="eqa-costoCompra" value="${v('costoCompra')}" inputmode="numeric" autocomplete="off"></div>
        <div><label>Gastado en el arreglo $</label><input id="eqa-costoArreglo" value="${v('costoArreglo')}" inputmode="numeric" placeholder="Repuestos" autocomplete="off"></div>
      </div>` : ''}
      <label>Notas</label>
      <textarea id="eqa-notas" rows="2" placeholder="De dónde vino, detalles, lo que sea">${v('notas')}</textarea>
      <button type="button" class="eqa-guardar" id="eqa-guardar" onclick="arrGuardarForm()">Guardar</button>
      <button type="button" class="eqa-volver" onclick="arrAbrir()">← Volver a la lista</button>
    </div>`);
  setTimeout(() => document.getElementById(a ? 'eqa-falla' : 'eqa-marca')?.focus(), 50);
}

function arrLeerForm() {
  const val = k => String(document.getElementById('eqa-' + k)?.value ?? '').trim();
  const d = {
    marca: val('marca'), modelo: val('modelo'), falla: val('falla'),
    almacenamiento: val('almacenamiento'), color: val('color'),
    imei: val('imei').replace(/\D/g, ''), notas: val('notas'),
    bateria: Math.min(100, arrNum(val('bateria'))) || null,
  };
  // El estado solo está al editar (uno nuevo arranca "por arreglar")
  const est = val('estado');
  if (ARR_PASOS.includes(est)) d.estado = est;
  // Si el empleado no ve los campos de plata, no se pisan
  if (document.getElementById('eqa-costoCompra')) {
    d.costoCompra = arrNum(val('costoCompra').replace(/\D/g, ''));
    d.costoArreglo = arrNum(val('costoArreglo').replace(/\D/g, ''));
  }
  return d;
}

// null si está bien; si no, qué falta
function arrValidar(d) {
  if (!d.marca && !d.modelo) return 'Poné al menos la marca o el modelo';
  if (!d.falla) return 'Anotá qué necesita (aunque sea "revisar")';
  if (d.imei && d.imei.length !== 15) return 'El IMEI tiene que tener 15 números';
  return null;
}

async function arrGuardarForm() {
  if (typeof tpFrenar === 'function' && tpFrenar('stock', 'anotar equipos para arreglar')) return;
  const d = arrLeerForm();
  const err = arrValidar(d);
  if (err) { toast(err, 'error'); return; }
  const btn = document.getElementById('eqa-guardar');
  if (btn) btn.disabled = true;
  try {
    if (_arrEditId) {
      const antes = ARREGLOS.find(x => x.id === _arrEditId);
      if (d.estado === 'listo' && antes && antes.estado !== 'listo') d.fechaListo = new Date().toISOString();
      await _arrGuardar(_arrEditId, d);
      const a = ARREGLOS.find(x => x.id === _arrEditId);
      if (a) Object.assign(a, d);
      toast('Guardado ✅', 'success');
    } else {
      const id = 'arr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const nuevo = { ...d, estado: 'pendiente', activo: true, fecha: new Date().toISOString() };
      await _arrGuardar(id, nuevo);
      if (!ARREGLOS.some(x => x.id === id)) ARREGLOS.push({ id, ...nuevo });
      toast('🔧 Anotado. Tocá 🏷️ para imprimirle la etiqueta', 'success');
    }
    arrPintarContador();
    arrAbrir();
  } catch (e) {
    console.error('[arreglos] guardar:', e);
    toast('No se pudo guardar — revisá la conexión', 'error');
  } finally { if (btn) btn.disabled = false; }
}

// Alan: "que tenga una forma de cambiar el estado de reparación". Los
// botones de abajo solo avanzan un paso; tocando el cartelito del estado
// se elige cualquiera (por ejemplo, volver a "Por arreglar" si se trabó
// esperando un repuesto). "A la venta" no está acá: eso es pasarlo al stock.

function arrElegirEstado(id) {
  const a = ARREGLOS.find(x => x.id === id);
  if (!a) return;
  const ops = ARR_PASOS.map(k => {
    const e = ARR_ESTADOS[k], ahora = a.estado === k;
    return `<button type="button" class="eqa-op${ahora ? ' on' : ''}" ${ahora ? 'disabled' : `onclick="arrElegido('${_arrEsc(id)}','${k}')"`}>
      <span>${e.ico}</span><span>${e.lbl}</span>${ahora ? '<small>(está así)</small>' : ''}</button>`;
  }).join('');
  _arrModal(`<div class="eqa-hd"><span>Cambiar estado</span><button type="button" class="eqa-x" onclick="arrAbrir()">✕</button></div>
    <p class="eqa-sub">${_arrEsc(arrNombre(a))} · ${_arrEsc(a.falla || '')}</p>
    <div class="eqa-ops">${ops}</div>
    <button type="button" class="eqa-volver" onclick="arrAbrir()">← Volver a la lista</button>`);
}

async function arrElegido(id, estado) {
  arrAbrir();
  await arrPaso(id, estado);
}

// Pasar de un paso al otro
async function arrPaso(id, estado) {
  if (typeof tpFrenar === 'function' && tpFrenar('stock', 'cambiar equipos para arreglar')) return;
  const a = ARREGLOS.find(x => x.id === id);
  if (!a || !ARR_ESTADOS[estado]) return;
  const cambio = { estado };
  if (estado === 'listo') cambio.fechaListo = new Date().toISOString();
  // Al terminarlo se pregunta cuánto se gastó: es lo que hace bien la ganancia
  if (estado === 'listo' && !arrNum(a.costoArreglo) && arrVePlata()) {
    const r = prompt('¿Cuánto gastaste en el arreglo? (repuestos) — dejalo vacío si no sabés', '');
    if (r === null) return;
    const n = arrNum(String(r).replace(/\D/g, ''));
    if (n) cambio.costoArreglo = n;
  }
  try {
    await _arrGuardar(id, cambio);
    Object.assign(a, cambio);
    arrPintarLista();
    if (estado === 'listo') toast('✅ Listo. Cuando quieras, tocá "Poner a la venta"', 'success');
  } catch (e) {
    console.error('[arreglos] paso:', e);
    toast('No se pudo cambiar — revisá la conexión', 'error');
  }
}

async function arrBorrar(id) {
  if (typeof tpFrenar === 'function' && tpFrenar('borrar', 'sacar equipos de la lista')) return;
  const a = ARREGLOS.find(x => x.id === id);
  if (!a) return;
  if (!confirm(`¿Sacar "${arrNombre(a)}" de la lista?\n\nUsalo si se vendió para repuestos o no tenía arreglo. No va al stock.`)) return;
  try {
    // No se borra: queda el registro (por si después se busca qué pasó)
    await _arrGuardar(id, { activo: false, estado: 'baja', fechaBaja: new Date().toISOString() });
    ARREGLOS = ARREGLOS.filter(x => x.id !== id);
    arrPintarContador();
    arrPintarLista();
  } catch (e) {
    console.error('[arreglos] borrar:', e);
    toast('No se pudo sacar — revisá la conexión', 'error');
  }
}

// ── Etiqueta ──────────────────────────────────────────────
// Alan: "agregar la impresión de una etiqueta para esos equipos que faltan
// reparar". Para pegarle al equipo (o a la bolsita) y que en el cajón se
// sepa cuál es y qué le falta, sin abrir la app. Sale por la misma
// etiquetadora, el mismo tamaño y la misma impresión directa/remota que la
// "Etiqueta en blanco" (etiqueta-libre.js): no hay que tocar nada más.
function arrEtiquetaDatos(a) {
  const f = a.fecha ? new Date(a.fecha) : null;
  const fecha = f && !isNaN(f) ? `${String(f.getDate()).padStart(2, '0')}/${String(f.getMonth() + 1).padStart(2, '0')}` : '';
  // El IMEI va solo en su renglón: con el color al lado no entraba y se partía
  return {
    titulo: arrNombre(a),
    lineas: [
      '🔧 ' + (String(a.falla || '').trim() || 'Revisar'),
      a.imei ? 'IMEI ' + a.imei : '',
      ['PARA ARREGLAR', a.color, fecha ? 'desde ' + fecha : ''].filter(Boolean).join(' · '),
    ].filter(Boolean),
    codigo: '',
    copias: 1,
  };
}

function arrEtiquetasDoc(lista) {
  if (typeof _hojaEtiquetas !== 'function' || typeof etiquetaLibreHtml !== 'function') return '';
  const html = _hojaEtiquetas((lista || []).map(arrEtiquetaDatos), etiquetaLibreHtml);
  // El estilo de los renglones sueltos es el de la etiqueta en blanco
  return typeof _ETQL_CSS === 'string' ? html.replace('</style>', _ETQL_CSS + '</style>') : html;
}

// OJO: sin await antes de imprimir. Sin QZ Tray la ventana de impresión
// tiene que abrirse en el mismo toque, si no Chrome la bloquea.
function _arrImprimir(lista) {
  if (!lista.length) { toast('No hay equipos para imprimir', 'info'); return; }
  const html = arrEtiquetasDoc(lista);
  if (!html) { toast('No se puede imprimir desde acá', 'error'); return; }
  const tit = lista.length === 1 ? 'Etiqueta' : `Etiquetas (${lista.length})`;
  if (typeof _imprimirTocando === 'function') _imprimirTocando('etiqueta', html, tit);
  else if (typeof _openPrint === 'function') _openPrint(html, tit);
}

function arrEtiqueta(id) {
  const a = ARREGLOS.find(x => x.id === id);
  if (a) _arrImprimir([a]);
}

// Las de la lista que se está mirando (todas, o solo "por arreglar", etc.)
function arrEtiquetasTodas() {
  _arrImprimir(arrOrdenar(ARREGLOS.filter(a => a.activo && (_arrFiltro === 'todos' || a.estado === _arrFiltro))));
}

// ── Poner a la venta ──────────────────────────────────────
// Abre el formulario de siempre del stock (con fotos, precio, publicar en
// la página, etc.) ya completo. El equipo sale de esta lista recién cuando
// se guarda: si cerrás el formulario sin guardar, sigue acá.
function arrPonerALaVenta(id) {
  const a = ARREGLOS.find(x => x.id === id);
  if (!a || typeof openForm !== 'function') return;
  if (typeof tpFrenar === 'function' && tpFrenar('stock', 'cargar equipos')) return;
  arrCerrar();
  openForm();
  _arrDesde = id;
  const p = arrParaStock(a);
  const set = (fid, v) => { const el = document.getElementById(fid); if (el && v !== undefined && v !== null) el.value = v; };
  set('fi-marca', p.marca);
  set('fi-modelo', p.modelo);
  set('fi-estado', p.estado);
  set('fi-imei', p.imei);
  set('fi-notas', p.notas);
  set('fi-bateria', p.bateria);
  set('fi-costo', p.costo);
  // La capacidad es una lista: solo se elige si está entre las opciones
  const sel = document.getElementById('fi-storage');
  if (sel && p.almacenamiento) {
    const norm = s => String(s).toUpperCase().replace(/\s+/g, '');
    const op = [...sel.options].find(o => norm(o.value) === norm(p.almacenamiento));
    if (op) sel.value = op.value;
  }
  if (typeof _updateBateriaVisibility === 'function') _updateBateriaVisibility(p.marca);
  if (typeof catFormCargar === 'function') catFormCargar({ color: p.color });
  const t = document.getElementById('form-title');
  if (t) t.textContent = '💰 Poner a la venta';
  toast('Completá el precio (y las fotos si querés) y guardá', 'info');
  setTimeout(() => document.getElementById('fi-precio')?.focus(), 350);
  _arrSugerir(a);
}

// ── Precio sugerido ───────────────────────────────────────
// Alan (08/11) eligió "precio sugerido al poner a la venta": que la app
// diga a cuánto conviene publicarlo. Se mira, en este orden:
//   1) a cuánto vendiste los iguales (misma marca y modelo, usados, último
//      año; si hay de la misma capacidad, solo esos),
//   2) si nunca vendiste uno, a cuánto tenés publicados los iguales,
//   3) si no hay ninguno, tu costo + el margen que le venís sacando a los
//      equipos vendidos (35% si todavía no hay con qué calcularlo).
// El número del medio (mediana), no el promedio: una venta regalada o una
// carísima no lo corren.
function _arrNormMod(marca, modelo) {
  const n = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  let m = n(modelo);
  const ma = n(marca);
  if (ma && m.startsWith(ma + ' ')) m = m.slice(ma.length + 1);
  // "Galaxy A32" y "A32" son el mismo: cada uno lo carga como le sale
  m = m.replace(/^galaxy\s+/, '');
  return n(marca === 'Apple' || /iphone/i.test(modelo) ? 'apple' : ma) + '|' + m.replace(/\s+/g, '');
}
function _arrCapGB(c) {
  const m = String(c || '').match(/(\d+)\s*(GB|TB)/i);
  return m ? Number(m[1]) * (/tb/i.test(m[2]) ? 1024 : 1) : 0;
}
function _arrMediana(v) {
  const a = v.slice().sort((x, y) => x - y), i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}
const _arrRedondear = (n, usd) => usd ? Math.round(n / 5) * 5 : Math.round(n / 5000) * 5000;

function arrPrecioSugerido(a, stock, opciones) {
  const o = opciones || {};
  const ahora = o.ahora || Date.now();
  const costo = arrInvertido(a);
  const clave = _arrNormMod(a.marca, a.modelo);
  const cap = _arrCapGB(a.almacenamiento);
  const iguales = (stock || []).filter(p => p && !p.eliminado && p.estado !== 'Nuevo'
    && Number(p.precio) > 0 && _arrNormMod(p.marca, p.modelo) === clave);
  const unAnio = 365 * 864e5;
  const vendidos = iguales.filter(p => p.vendido && (!p.fecha_venta || ahora - Date.parse(p.fecha_venta) <= unAnio));
  const enStock = iguales.filter(p => !p.vendido);
  const mismaCap = arr => { if (!cap) return { l: arr, cap: false }; const c = arr.filter(p => _arrCapGB(p.almacenamiento) === cap); return c.length ? { l: c, cap: true } : { l: arr, cap: false }; };
  const fuente = vendidos.length ? 'vendidos' : enStock.length ? 'stock' : null;
  if (fuente) {
    const { l, cap: conCap } = mismaCap(fuente === 'vendidos' ? vendidos : enStock);
    const usd = l.filter(p => p.moneda === 'usd' && Number(p.precioUSD) > 0);
    const enUsd = usd.length > l.length / 2;
    const precio = _arrRedondear(_arrMediana(enUsd ? usd.map(p => Number(p.precioUSD)) : l.map(p => Number(p.precio))), enUsd);
    return { precio, moneda: enUsd ? 'usd' : 'ars', fuente, n: l.length, mismaCapacidad: conCap, costo };
  }
  if (costo > 0) {
    const conCosto = (stock || []).filter(p => p && p.vendido && Number(p.costo) > 0 && Number(p.precio) > Number(p.costo));
    let margen = conCosto.length >= 3 ? _arrMediana(conCosto.map(p => (p.precio - p.costo) / p.costo)) : 0.35;
    margen = Math.min(1, Math.max(0.15, margen));
    return { precio: _arrRedondear(costo * (1 + margen), false), moneda: 'ars', fuente: 'margen', margen, n: conCosto.length, costo };
  }
  return null;
}

// El texto que se muestra debajo del precio
function arrSugeridoTexto(s, dolar) {
  if (!s) return '';
  const plata = (n, usd) => usd ? `U$S ${Math.round(n).toLocaleString('es-AR')}` : '$' + Math.round(n).toLocaleString('es-AR');
  const usd = s.moneda === 'usd';
  const capTxt = s.mismaCapacidad ? ' de la misma capacidad' : '';
  const porque = s.fuente === 'vendidos'
    ? `es lo que cobraste por ${s.n === 1 ? 'el igual' : `los ${s.n} iguales`}${capTxt} que vendiste`
    : s.fuente === 'stock'
      ? `es como tenés publicado${s.n === 1 ? ' el igual' : `s los ${s.n} iguales`}${capTxt} en stock`
      : `tu costo + el ${Math.round(s.margen * 100)}% que le venís ganando a los equipos`;
  let gan = '';
  if (s.costo > 0) {
    const enPesos = usd ? (dolar > 0 ? s.precio * dolar : 0) : s.precio;
    if (enPesos) {
      const g = enPesos - s.costo;
      gan = g >= 0 ? ` · te costó ${plata(s.costo)} → ganás ${plata(g)}${usd ? ' (al dólar de hoy)' : ''}`
                   : ` · ⚠️ te costó ${plata(s.costo)}: a ese precio perdés ${plata(-g)}`;
    }
  }
  return `💡 Sugerido: <b>${plata(s.precio, usd)}</b> — ${porque}${gan}`;
}

async function _arrSugerir(a) {
  try {
    // Los vendidos se traen solo si hace falta (y quedan guardados unas horas)
    if (typeof cargarVendidos === 'function') await cargarVendidos();
  } catch (e) { /* sin vendidos, se sugiere con lo que haya */ }
  if (!_arrDesde) return;                       // ya cerró el formulario
  const s = arrPrecioSugerido(a, typeof STOCK !== 'undefined' ? STOCK : []);
  const helper = document.getElementById('fi-precio-helper');
  if (!s || !helper || !helper.parentNode) return;
  document.getElementById('fi-sugerido')?.remove();
  const box = document.createElement('div');
  box.id = 'fi-sugerido';
  box.style.cssText = 'margin-top:6px;padding:8px 10px;border-radius:10px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.45);font-size:13px;line-height:1.35';
  box.innerHTML = `${arrSugeridoTexto(s, typeof dolarBlue !== 'undefined' ? dolarBlue : 0)}
    <button type="button" id="fi-sugerido-usar" style="display:block;margin-top:6px;padding:6px 12px;border-radius:8px;border:0;background:#f59e0b;color:#111;font-weight:700;cursor:pointer">Usar este precio</button>`;
  helper.parentNode.insertBefore(box, helper.nextSibling);
  document.getElementById('fi-sugerido-usar').onclick = () => {
    // Si el sugerido está en dólares y el formulario en pesos (o al revés), se cambia
    const quiere = s.moneda === 'usd' ? 'usd' : 'ars';
    if (typeof monedaMode !== 'undefined' && monedaMode !== quiere && typeof toggleMoneda === 'function') toggleMoneda();
    const inp = document.getElementById('fi-precio');
    if (inp) { inp.value = s.precio; inp.focus(); }
  };
}

// La llama savePhone cuando guarda un equipo nuevo en el stock
async function arrALaVentaGuardado(stockId) {
  const id = _arrDesde;
  _arrDesde = null;
  if (!id) return;
  try {
    await _arrGuardar(id, { activo: false, estado: 'a_la_venta', stockId, fechaVenta: new Date().toISOString() });
    ARREGLOS = ARREGLOS.filter(x => x.id !== id);
    arrPintarContador();
    toast('💰 Pasó al stock: ya está a la venta', 'success');
  } catch (e) {
    console.error('[arreglos] a la venta:', e);
    toast('Se cargó al stock, pero sigue en "para arreglar": sacalo a mano', 'error');
  }
}

// Si se cierra el formulario sin guardar, el equipo sigue en la lista
function arrFormCerrado() { _arrDesde = null; document.getElementById('fi-sugerido')?.remove(); }

// La lista se escucha apenas hay sesión (para el número del recuadro)
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('DOMContentLoaded', () => {
    const intentar = (n) => {
      const u = (typeof currentUser === 'function') ? currentUser() : null;
      if (u && typeof db !== 'undefined') arrEscuchar();
      else if (n < 40) setTimeout(() => intentar(n + 1), 500);
    };
    intentar(0);
  });
}
