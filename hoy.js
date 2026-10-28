// ══════════════════════════════════════════════════════════════
// ✅ Para hacer hoy — la tarjeta de arriba del Dashboard
// ══════════════════════════════════════════════════════════════
// Reemplaza a "🏢 La oficina" (personajes con globitos). Alan: "no me
// estarían sirviendo para nada". Avisaban de todo y preguntaban en vez de
// hacer. Esto es lo contrario:
//  · SOLO lo que hace perder plata o clientes: equipos listos sin retirar,
//    la caja sin cerrar, lo que se terminó, ventas sin costo, equipos que no
//    se venden hace meses, y (una vez) las órdenes viejas sin cerrar.
//  · 5 cosas como máximo a la vista; el resto, en "ver N más".
//  · Lo seguro lo hace solo: lo que se termina se anota en el pedido al
//    proveedor y después te avisa qué anotó.
//  · La IA (api/ai.js, acción 'oficina') solo donde ahorra tiempo: escribir
//    el mensaje al cliente, el del pedido al proveedor y sugerir precio.
//
// hoyItems(ctx) es PURA (tests/test-hoy.js); lo demás es pantalla.
//
// CUPO: usa lo que la app ya tiene en memoria (reparaciones, equipos, y los
// repuestos/accesorios/pedido SI ya se abrieron). No abre listeners nuevos:
// el Dashboard se abre muchas veces por día. Lo que se termina sin que nadie
// abra Repuestos lo anota igual el parte de las 10:30 (cron-resumen-telegram).
'use strict';

const HOY_CIERRE = '19:30';      // el local cierra sí o sí
const HOY_DIAS_RETIRO = 7;       // lista sin retirar desde hace esto → avisar
const HOY_DIAS_QUIETO = 90;      // equipo sin venderse hace esto → avisar
const HOY_DIAS_VIEJA = 60;       // orden abierta más vieja que esto: vieja
const HOY_VISIBLES = 5;

function _hoyEsc(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function _hoyDiaAR(ms) { return new Date((ms || Date.now()) - 3 * 3600e3).toISOString().slice(0, 10); }
function _hoyHoraAR(ms) { return new Date((ms || Date.now()) - 3 * 3600e3).toISOString().slice(11, 16); }
function _hoyDias(iso, ahora) { const t = iso ? new Date(iso).getTime() : 0; return t ? Math.floor(((ahora || Date.now()) - t) / 86400e3) : null; }
function _hoyEquipoRep(r) { return [r.marca, r.modelo].filter(Boolean).join(' ') || 'Equipo'; }
function _hoyEquipoNom(e) { return [e.marca, e.modelo, e.almacenamiento].filter(Boolean).join(' ') || 'Equipo'; }
function _hoyPila(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
function _hoyPlural(n, uno, varios) { return n === 1 ? uno : varios; }

// Nombre de un repuesto / accesorio para el pedido
function _hoyNomStock(x, origen) {
  return origen === 'repuesto'
    ? [x.tipo, x.nombre && x.nombre !== x.tipo ? x.nombre : '', x.marca, x.modelo].filter(Boolean).join(' ')
    : (x.nombre || 'Artículo');
}
// Categoría del pedido según el tipo
function _hoyCategoria(x) {
  const t = String((x && (x.tipo || x.categoria)) || '').toLowerCase();
  const tabla = [['módulo', 'Módulo'], ['modulo', 'Módulo'], ['pantalla', 'Pantalla'], ['bater', 'Batería'], ['cargador', 'Cargador'],
    ['cable', 'Cable'], ['auricular', 'Auricular'], ['funda', 'Funda'], ['vidrio', 'Vidrio templado / Hidrogel'], ['hidrogel', 'Vidrio templado / Hidrogel'],
    ['conector', 'Conector'], ['pin', 'Conector'], ['flex', 'Flex'], ['cámara', 'Cámara'], ['camara', 'Cámara'], ['parlante', 'Parlante'],
    ['micr', 'Micrófono'], ['marco', 'Marco']];
  const hit = tabla.find(([k]) => t.includes(k));
  return hit ? hit[1] : 'Otro';
}

// Lo que se terminó (con mínimo cargado) y no está en el pedido. Solo los
// que tienen mínimo: un artículo viejo en 0 que ya no se trabaja no se pide.
function hoyTerminados(ctx) {
  const abiertos = new Set((ctx.pedidos || []).filter(p => !p.comprado && p.itemId).map(p => p.itemId));
  const de = (lista, campo, origen) => (Array.isArray(lista) ? lista : [])
    .filter(x => x && x.id && x.activo !== false && Number(x.stockMin) > 0 && (Number(x[campo]) || 0) <= 0 && !abiertos.has(x.id))
    .map(x => ({ id: x.id, origen, nombre: _hoyNomStock(x, origen), cantidad: Math.max(1, Number(x.stockMin) * 2), categoria: _hoyCategoria(x) }));
  return [...de(ctx.repuestos, 'cantidad', 'repuesto'), ...de(ctx.productos, 'stock', 'accesorio')];
}

// ── Qué hay para hacer hoy, de lo más urgente a lo menos ──
function hoyItems(ctx) {
  const ahora = ctx.ahora || Date.now();
  const hora = _hoyHoraAR(ahora), hoy = _hoyDiaAR(ahora);
  const reps = Array.isArray(ctx.repairs) ? ctx.repairs : [];
  const out = [];

  // 1) La caja sin cerrar, pasadas las 19:30
  const caja = ctx.caja || {};
  if (caja.arqueo === true && caja.cierre === false && hora >= HOY_CIERRE) out.push({
    clave: 'caja:' + hoy, nivel: 'urgente', ico: '💵',
    texto: `Son las ${hora} y falta cerrar la caja.`,
    acciones: [{ txt: 'Cerrar caja', fn: 'caja', id: 'cierre' }],
  });

  // 2) Equipos listos que no retiraron: cada día que pasa es un cliente que
  //    se enfría y un equipo ocupando lugar
  reps.filter(r => r.estado === 'listo')
    .map(r => ({ r, d: _hoyDias(r.fechaListo || (typeof ctx.desde === 'function' ? ctx.desde(r) : r.fechaIngreso), ahora), ing: _hoyDias(r.fechaIngreso, ahora) }))
    .filter(x => x.d !== null && x.d >= HOY_DIAS_RETIRO && x.ing !== null && x.ing <= HOY_DIAS_VIEJA)
    .sort((a, b) => b.d - a.d)
    .forEach(({ r, d }) => out.push({
      clave: 'retiro:' + r.id, nivel: d >= 20 ? 'urgente' : 'aviso', ico: '📱',
      texto: `${r.nombre ? _hoyPila(r.nombre) : 'Un cliente'} no retiró su ${_hoyEquipoRep(r)} (#${r.nOrden || '?'}): está listo hace ${d} días.`,
      abrir: { fn: 'repair', id: r.id },
      acciones: r.tlf
        ? [{ txt: '🟢 Avisarle', fn: 'waRepair', id: r.id, posponer: 72 },
           { txt: '✨ Mensaje con IA', fn: 'ia', pj: 'tito', pregunta: `Escribile un WhatsApp a ${_hoyPila(r.nombre) || 'el cliente'} de la orden id ${r.id} (#${r.nOrden || '?'}) para que pase a retirar su ${_hoyEquipoRep(r)}, que está listo hace ${d} días. Uno solo, corto y amable.` }]
        : [{ txt: 'Ver orden', fn: 'repair', id: r.id }],
    }));

  // 3) Lo que se terminó y no se pudo anotar solo en el pedido
  hoyTerminados(ctx).forEach(t => out.push({
    clave: 'fin:' + t.id, nivel: 'aviso', ico: '📦',
    texto: `Se terminó «${t.nombre}».`,
    acciones: [{ txt: `🛒 Pedir ${t.cantidad}`, fn: 'pedido', id: t.id, origen: t.origen, nombre: t.nombre, cantidad: t.cantidad, categoria: t.categoria, posponer: 1 }],
  }));

  // 4) Ventas de hoy sin costo: no se sabe cuánto se ganó
  if (ctx.verPlata) {
    const sinCosto = ((caja.movs) || []).filter(m => m.tipo === 'ingreso' && m.sinCosto).length;
    if (sinCosto) out.push({
      clave: 'sincosto:' + hoy + ':' + sinCosto, nivel: 'aviso', ico: '💲',
      texto: `${sinCosto} ${_hoyPlural(sinCosto, 'venta de hoy no tiene', 'ventas de hoy no tienen')} el costo cargado: no sabés cuánto ganaste.`,
      acciones: [{ txt: 'Ver ventas', fn: 'caja', id: '' }],
    });
  }

  // 5) Equipos que no se venden hace meses: plata parada
  (Array.isArray(ctx.equipos) ? ctx.equipos : [])
    .filter(e => e && !e.vendido && !e.eliminado && !e.reservado)
    .map(e => ({ e, d: _hoyDias(e.fecha, ahora) }))
    .filter(x => x.d !== null && x.d >= HOY_DIAS_QUIETO)
    .sort((a, b) => b.d - a.d)
    .forEach(({ e, d }) => out.push({
      clave: 'quieto:' + e.id, nivel: 'info', ico: '🏷️',
      texto: `El ${_hoyEquipoNom(e)} lleva ${d} días sin venderse.`,
      abrir: { fn: 'equipo', id: e.id },
      acciones: [{ txt: '✨ ¿A cuánto lo dejo?', fn: 'ia', pj: 'lu', pregunta: `¿A cuánto dejo el ${_hoyEquipoNom(e)} (id ${e.id}) que lleva ${d} días sin venderse? Escribime también un texto corto para promocionarlo.` }],
    }));

  // 6) Órdenes viejas sin cerrar (una sola vez: se cierran todas juntas)
  if (ctx.esDueno) {
    const viejas = hoyViejas(reps, ahora);
    if (viejas.length) out.push({
      clave: 'viejas', nivel: 'info', ico: '🗂️',
      texto: `Hay ${viejas.length} ${_hoyPlural(viejas.length, 'orden abierta', 'órdenes abiertas')} de hace más de ${HOY_DIAS_VIEJA} días. Inflan las listas y los números.`,
      acciones: [{ txt: 'Cerrarlas todas', fn: 'cerrarViejas' }],
    });
  }

  // 7) Lo que se anotó solo en el pedido (para que te enteres)
  const anotados = Array.isArray(ctx.anotadosHoy) ? ctx.anotadosHoy : [];
  if (anotados.length) out.push({
    clave: 'anote:' + hoy + ':' + anotados.length, nivel: 'info', ico: '🛒',
    texto: `Anoté en el pedido lo que se terminó: ${anotados.slice(0, 4).join(', ')}${anotados.length > 4 ? ` y ${anotados.length - 4} más` : ''}.`,
    acciones: [{ txt: 'Ver pedido', fn: 'verPedido' },
      { txt: '✨ Mensaje al proveedor', fn: 'ia', pj: 'rosa', pregunta: 'Armame el mensaje de WhatsApp para pedirle al proveedor todo lo que está en el pedido, agrupado por tipo y con cantidades.' }],
  });

  const orden = { urgente: 0, aviso: 1, info: 2 };
  return out.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}

// Abiertas (en el taller o listas) que entraron hace más de 60 días
function hoyViejas(reps, ahora) {
  return (reps || []).filter(r => (r.estado === 'reparando' || r.estado === 'listo')
    && (_hoyDias(r.fechaIngreso, ahora) ?? 0) > HOY_DIAS_VIEJA);
}

// ══════════════════════════════════════════════════════════════
//  Datos
// ══════════════════════════════════════════════════════════════
let _hoyCaja = { leida: 0, arqueo: null, cierre: null, movs: [] };
let _hoyVerTodo = false;

function _hoyCtx() {
  const g = n => (typeof window !== 'undefined' && Array.isArray(window[n])) ? window[n] : undefined;
  return {
    ahora: Date.now(),
    repairs: (typeof REPAIRS !== 'undefined' && Array.isArray(REPAIRS)) ? REPAIRS : [],
    desde: (typeof tpDesde === 'function') ? tpDesde : null,
    repuestos: (typeof REPUESTOS !== 'undefined' && Array.isArray(REPUESTOS)) ? REPUESTOS : [],
    productos: (typeof vaLista === 'function') ? vaLista() : (g('PRODUCTOS') || []),
    pedidos: (typeof PEDIDOS !== 'undefined' && Array.isArray(PEDIDOS)) ? PEDIDOS : [],
    // Sin el pedido cargado no se sabe qué ya está anotado a mano: no se
    // anota nada solo (lo hace el parte de las 10:30, que sí lo lee)
    pedidosListos: (typeof _pedidosListener !== 'undefined') ? !!_pedidosListener : false,
    equipos: (typeof _stockEnLocal !== 'undefined' && Array.isArray(_stockEnLocal)) ? _stockEnLocal : [],
    caja: _hoyCaja,
    verPlata: (typeof tpPuede === 'function') ? tpPuede('totales') : true,
    esDueno: (typeof tpEsDueno === 'function') ? tpEsDueno() : false,
    anotadosHoy: _hoyAnotados(),
  };
}

// La caja de hoy: apertura, cierre y movimientos. Como mucho cada 10
// minutos y solo con el Dashboard a la vista. Si las reglas no dejan, queda
// en "no sé" (null) y no se avisa nada de la caja.
async function _hoyLeerCaja() {
  if (typeof db === 'undefined' || !db) return;
  if (Date.now() - _hoyCaja.leida < 10 * 60e3) return;
  _hoyCaja.leida = Date.now();   // antes del await: que dos renders no lean dos veces
  const hoy = _hoyDiaAR();
  const existe = ref => ref.get().then(d => d.exists).catch(() => null);
  const key = hoy + '|' + hoy;
  const movsCache = (typeof _dashCache !== 'undefined' && _dashCache[key]) ? _dashCache[key] : null;
  const [arqueo, cierre, movs] = await Promise.all([
    existe(db.collection('caja_arqueos').doc(hoy)),
    existe(db.collection('caja_cierres').doc(hoy)),
    movsCache ? Promise.resolve(movsCache)
      : db.collection('caja_movimientos').where('fecha', '==', hoy).get().then(s => s.docs.map(d => d.data())).catch(() => []),
  ]);
  _hoyCaja = { leida: Date.now(), arqueo, cierre, movs: movs || [] };
}

// ── Lo que se terminó se anota solo en el pedido ──
// El id del pedido es fijo por artículo (auto_<id>): si dos celus lo anotan a
// la vez, queda uno solo. Si ya estaba comprado hace más de 3 días y se
// volvió a terminar, se reabre (antes de eso, la compra todavía no se cargó).
const _hoyIntentados = new Set();
function _hoyAnotados() {
  try {
    const o = JSON.parse(localStorage.getItem('hoyAnotados') || '{}');
    return o.dia === _hoyDiaAR() && Array.isArray(o.nombres) ? o.nombres : [];
  } catch { return []; }
}
function _hoyAnotar(nombre) {
  const nombres = _hoyAnotados();
  if (!nombres.includes(nombre)) nombres.push(nombre);
  try { localStorage.setItem('hoyAnotados', JSON.stringify({ dia: _hoyDiaAR(), nombres })); } catch {}
}
async function _hoyAutoPedido(ctx) {
  if (typeof db === 'undefined' || !db || !ctx.pedidosListos) return;
  if (typeof tpPuede === 'function' && !tpPuede('stock')) return;
  const nuevos = hoyTerminados(ctx).filter(t => !_hoyIntentados.has(t.id)).slice(0, 10);
  if (!nuevos.length) return;
  let alguno = false;
  for (const t of nuevos) {
    _hoyIntentados.add(t.id);
    try {
      const ref = db.collection('pedidos').doc('auto_' + t.id);
      const d = await ref.get();
      if (d.exists) {
        const p = d.data();
        if (!p.comprado) continue;
        if (Date.now() - Date.parse(p.fechaCompra || 0) < 3 * 86400e3) continue;
      }
      await ref.set({
        nombre: t.nombre, cantidad: t.cantidad, categoria: t.categoria, prioridad: 'normal', proveedor: null,
        notas: 'Se anotó solo: se terminó', itemId: t.id, itemSource: t.origen === 'repuesto' ? 'repuesto' : 'producto',
        createdAt: new Date().toISOString(), comprado: false, fechaCompra: null, auto: true,
      });
      _hoyAnotar(t.nombre);
      alguno = true;
    } catch (e) { console.warn('[hoy] auto-pedido:', e); }
  }
  if (alguno) hoyRender();
}

// ══════════════════════════════════════════════════════════════
//  Botones
// ══════════════════════════════════════════════════════════════
const _hoyAcciones = {};
function _hoyPospuestos() {
  try {
    const o = JSON.parse(localStorage.getItem('hoyPosp') || '{}') || {};
    Object.keys(o).forEach(k => { if (!(o[k] > Date.now())) delete o[k]; });
    return o;
  } catch { return {}; }
}
function hoyPosponer(clave, horas) {
  const o = _hoyPospuestos();
  o[clave] = Date.now() + (horas || 4) * 3600e3;
  try { localStorage.setItem('hoyPosp', JSON.stringify(o)); } catch {}
  hoyRender();
}

async function hoyAccion(clave, i) {
  const item = _hoyAcciones[clave];
  const a = item && (i === 'abrir' ? item.abrir : (item.acciones || [])[i]);
  if (!a) return;
  try {
    if (a.fn === 'repair' && typeof openRepairDetail === 'function') openRepairDetail(a.id);
    else if (a.fn === 'waRepair' && typeof repairWhatsApp === 'function') repairWhatsApp(a.id);
    else if (a.fn === 'equipo') { if (typeof switchSection === 'function') switchSection('stock'); setTimeout(() => (typeof openDetail === 'function') && openDetail(a.id), 300); }
    else if (a.fn === 'caja') location.href = 'caja.html' + (a.id ? '?action=' + a.id : '');
    else if (a.fn === 'verPedido' && typeof openPedidosModal === 'function') openPedidosModal();
    else if (a.fn === 'ia') hoyIA(a.pj, a.pregunta);
    else if (a.fn === 'cerrarViejas') await hoyCerrarViejas();
    else if (a.fn === 'pedido') {
      await db.collection('pedidos').doc('auto_' + a.id).set({
        nombre: a.nombre, cantidad: a.cantidad, categoria: a.categoria || 'Otro', prioridad: 'normal', proveedor: null,
        notas: 'Desde "Para hacer hoy"', itemId: a.id, itemSource: a.origen === 'repuesto' ? 'repuesto' : 'producto',
        createdAt: new Date().toISOString(), comprado: false, fechaCompra: null, auto: true,
      });
      if (typeof toast === 'function') toast(`🛒 Anotado: ${a.cantidad} × ${a.nombre}`, 'success');
    }
    if (a.posponer) hoyPosponer(clave, a.posponer);
  } catch (e) {
    console.error('[hoy] acción:', e);
    if (typeof toast === 'function') toast('No se pudo hacer', 'error');
  }
}

// Cierra de un saque las órdenes viejas. Quedan como entregadas CON LA FECHA
// DE ENTONCES (no la de hoy): si no, el resumen de hoy diría "entregados: 80"
// y los números del día saldrían inflados. Llevan la marca cierreMasivo por
// si alguna hay que reabrirla.
async function hoyCerrarViejas() {
  const reps = (typeof REPAIRS !== 'undefined' && Array.isArray(REPAIRS)) ? REPAIRS : [];
  const viejas = hoyViejas(reps, Date.now());
  if (!viejas.length) return;
  if (!confirm(`¿Cerrar ${viejas.length} ${_hoyPlural(viejas.length, 'orden', 'órdenes')} de hace más de ${HOY_DIAS_VIEJA} días?\n\nQuedan como entregadas, con la fecha de cuando estuvieron listas (no la de hoy). No toca la caja ni el stock. Si alguna sigue en el local, la reabrís desde su ficha.`)) return;
  const marca = _hoyDiaAR();
  for (let i = 0; i < viejas.length; i += 400) {
    const batch = db.batch();
    viejas.slice(i, i + 400).forEach(r => batch.update(db.collection('repairs').doc(r.id), {
      estado: 'entregado', fechaEntrega: r.fechaListo || r.fechaIngreso, cierreMasivo: marca,
    }));
    await batch.commit();
  }
  if (typeof toast === 'function') toast(`🗂️ Listo: ${viejas.length} ${_hoyPlural(viejas.length, 'orden cerrada', 'órdenes cerradas')}`, 'success');
}

// ══════════════════════════════════════════════════════════════
//  ✨ IA (solo a pedido, con la pregunta ya armada)
// ══════════════════════════════════════════════════════════════
// Lo que va a la IA: SOLO lo necesario y sin teléfonos ni apellidos (el
// WhatsApp se arma acá, con la orden). Sin permiso de totales, sin montos.
function hoyDatosIA(pj, ctx) {
  const ahora = ctx.ahora || Date.now();
  const verPlata = ctx.verPlata !== false;
  if (pj === 'tito') {
    return { ordenesListas: (ctx.repairs || []).filter(r => r.estado === 'listo')
      .map(r => ({ r, d: _hoyDias(r.fechaListo || r.fechaIngreso, ahora) })).filter(x => x.d !== null && x.d <= HOY_DIAS_VIEJA)
      .slice(0, 40).map(({ r, d }) => {
        const o = { id: r.id, orden: r.nOrden || null, equipo: _hoyEquipoRep(r), diasLista: d, cliente: _hoyPila(r.nombre), tieneWhatsApp: !!r.tlf };
        if (r.arreglo) o.arreglo = String(r.arreglo).slice(0, 120);
        if (verPlata && Number(r.presupuesto) > 0) o.presupuesto = Number(r.presupuesto);
        if (verPlata && Number(r.sena) > 0) o.sena = Number(r.sena);
        return o;
      }) };
  }
  if (pj === 'rosa') {
    return { pedidoAbierto: (ctx.pedidos || []).filter(p => !p.comprado).slice(0, 60)
      .map(p => ({ nombre: p.nombre, cantidad: p.cantidad || 1, categoria: p.categoria || '' })) };
  }
  if (pj === 'lu') {
    return { dolarBlue: (typeof dolarBlue !== 'undefined' && Number(dolarBlue) > 0) ? Number(dolarBlue) : null,
      equipos: (ctx.equipos || []).filter(e => e && !e.vendido && !e.eliminado).slice(0, 60).map(e => {
        const o = { id: e.id, equipo: _hoyEquipoNom(e), condicion: e.estado || '', diasEnStock: _hoyDias(e.fecha, ahora), enLaPagina: e.publicar === true };
        if (Number(e.bateria) > 0) o.bateria = Number(e.bateria);
        if (Number(e.precio) > 0) o.precioPesos = Number(e.precio);
        if (e.moneda === 'usd' && Number(e.precioUSD) > 0) o.precioDolares = Number(e.precioUSD);
        if (verPlata && Number(e.costo) > 0) o.costoPesos = Number(e.costo);
        return o;
      }) };
  }
  return {};
}

let _hoyIA = null;       // { pensando } | { ia } | { error }
let _hoyBorr = [];
async function hoyIA(pj, pregunta) {
  if (_hoyIA && _hoyIA.pensando) return;
  _hoyIA = { pensando: true, pregunta };
  hoyRender();
  try {
    const res = await apiFetch('/api/ai', { method: 'POST', body: JSON.stringify({ action: 'oficina', data: { pj, pregunta, hallazgos: [], datos: hoyDatosIA(pj, _hoyCtx()) } }) });
    let out;
    try { out = JSON.parse(await res.text()); } catch { out = {}; }
    if (!out.ia && !out.error) out.error = res.status === 401 ? 'La sesión venció: salí y volvé a entrar.' : 'No se pudo hablar con la IA (error ' + res.status + ').';
    _hoyIA = out.ia ? { ia: out.ia, pregunta } : { error: out.error, pregunta };
  } catch {
    _hoyIA = { error: 'Sin conexión. Probá de nuevo en un rato.', pregunta };
  }
  hoyRender();
}
function hoyIACerrar() { _hoyIA = null; hoyRender(); }
function hoyIABorrador(i, como) {
  const b = _hoyBorr[i];
  if (!b) return;
  if (como === 'wa' && typeof repairWhatsAppText === 'function') return repairWhatsAppText(b.ref, b.texto);
  const ok = () => (typeof toast === 'function') && toast('📋 Copiado: pegalo donde quieras', 'success');
  try { navigator.clipboard.writeText(b.texto).then(ok, () => prompt('Copiá el texto:', b.texto)); }
  catch { prompt('Copiá el texto:', b.texto); }
}

function _hoyIAHtml() {
  _hoyBorr = [];
  const e = _hoyIA;
  if (!e) return '';
  const cab = `<div class="hoy-ia-cab"><b>✨ IA</b><button type="button" onclick="hoyIACerrar()" title="Cerrar">✕</button></div>`;
  if (e.pensando) return `<div class="hoy-ia">${cab}<p class="hoy-mut">Pensando… (puede tardar hasta un minuto)</p></div>`;
  if (e.error) return `<div class="hoy-ia">${cab}<p class="hoy-err">😕 ${_hoyEsc(e.error)}</p></div>`;
  const repById = id => (typeof REPAIRS !== 'undefined' && Array.isArray(REPAIRS)) ? REPAIRS.find(r => r.id === id) : null;
  return `<div class="hoy-ia">${cab}
    ${e.ia.respuesta ? `<p>${_hoyEsc(e.ia.respuesta).replace(/\n/g, '<br>')}</p>` : ''}
    ${e.ia.borradores.map(b => {
      const i = _hoyBorr.push(b) - 1;
      const r = b.ref ? repById(b.ref) : null;
      return `<div class="hoy-borr"><div class="hoy-borr-txt">${_hoyEsc(b.texto)}</div>
        <div class="hoy-acc">${r && r.tlf ? `<button type="button" class="hoy-pri" onclick="hoyIABorrador(${i}, 'wa')">🟢 Mandar a ${_hoyEsc(_hoyPila(r.nombre) || 'el cliente')}</button>` : ''}
        <button type="button" onclick="hoyIABorrador(${i}, 'copiar')">📋 Copiar</button></div></div>`;
    }).join('')}
  </div>`;
}

// ══════════════════════════════════════════════════════════════
//  Pantalla
// ══════════════════════════════════════════════════════════════
function hoyVerTodo() { _hoyVerTodo = !_hoyVerTodo; hoyRender(); }

function hoyRender() {
  const cont = typeof document !== 'undefined' && document.getElementById('d-hoy');
  if (!cont) return;
  _hoyEstilos();
  const ctx = _hoyCtx();
  const posp = _hoyPospuestos();
  const items = hoyItems(ctx).filter(h => !posp[h.clave]);
  Object.keys(_hoyAcciones).forEach(k => delete _hoyAcciones[k]);
  items.forEach(h => { _hoyAcciones[h.clave] = h; });
  const vis = _hoyVerTodo ? items : items.slice(0, HOY_VISIBLES);
  const ia = _hoyIAHtml();
  if (!items.length && !ia) { cont.innerHTML = ''; cont.style.display = 'none'; return; }
  cont.style.display = '';
  const k = c => _hoyEsc(c).replace(/'/g, '&#39;');
  cont.innerHTML = `
    <div class="hoy-cab"><b>✅ Para hacer hoy</b>${items.length ? `<span>${items.length}</span>` : ''}</div>
    ${vis.map(h => `
      <div class="hoy-item hoy-${h.nivel}">
        <span class="hoy-ico">${h.ico}</span>
        <div class="hoy-cuerpo">
          <p${h.abrir ? ` class="hoy-link" onclick="hoyAccion('${k(h.clave)}', 'abrir')"` : ''}>${_hoyEsc(h.texto)}</p>
          <div class="hoy-acc">
            ${(h.acciones || []).map((a, i) => `<button type="button"${i === 0 ? ' class="hoy-pri"' : ''} onclick="hoyAccion('${k(h.clave)}', ${i})">${_hoyEsc(a.txt)}</button>`).join('')}
            <button type="button" class="hoy-luego" onclick="hoyPosponer('${k(h.clave)}', ${h.clave === 'viejas' ? 24 * 7 : 4})" title="Que no lo diga por un rato">⏰</button>
          </div>
        </div>
      </div>`).join('')}
    ${items.length > HOY_VISIBLES ? `<button type="button" class="hoy-mas" onclick="hoyVerTodo()">${_hoyVerTodo ? 'Ver menos' : `Ver ${items.length - HOY_VISIBLES} más`}</button>` : ''}
    ${ia}`;
}

// Lo llama el Dashboard al mostrarse (app.js). Lee la caja si hace falta y
// anota en el pedido lo que se terminó.
function hoyMostrar() {
  hoyRender();
  _hoyLeerCaja().then(() => hoyRender()).catch(() => {});
  _hoyAutoPedido(_hoyCtx()).catch(() => {});
}

// ── Estilos (viajan con el JS: el CSS se sirve del caché y tarda en llegar) ──
function _hoyEstilos() {
  if (typeof document === 'undefined' || document.getElementById('hoy-estilos')) return;
  const st = document.createElement('style');
  st.id = 'hoy-estilos';
  st.textContent = `
.d-hoy { background: var(--d-card); border: 1px solid var(--d-bd); border-radius: 14px; padding: 12px 14px; margin: 0 0 14px; display: flex; flex-direction: column; gap: 8px; }
.d-hoy .hoy-cab { display: flex; align-items: center; gap: 8px; }
.d-hoy .hoy-cab b { font-size: 16px; }
.d-hoy .hoy-cab span { background: var(--d-bd-2); border-radius: 999px; padding: 0 8px; font-size: 12px; font-weight: 700; }
.d-hoy .hoy-item { display: flex; gap: 10px; align-items: flex-start; border-left: 4px solid var(--d-cyan); padding: 6px 0 6px 10px; }
.d-hoy .hoy-aviso { border-left-color: var(--d-amber); }
.d-hoy .hoy-urgente { border-left-color: var(--d-red); }
.d-hoy .hoy-ico { font-size: 20px; line-height: 1.2; }
.d-hoy .hoy-cuerpo { flex: 1; min-width: 0; }
.d-hoy .hoy-cuerpo p { margin: 0 0 6px; font-size: 15px; line-height: 1.35; }
.d-hoy .hoy-link { cursor: pointer; }
.d-hoy .hoy-link:hover { text-decoration: underline; }
.d-hoy .hoy-acc { display: flex; gap: 6px; flex-wrap: wrap; }
.d-hoy .hoy-acc button, .d-hoy .hoy-mas { background: var(--d-bd-2); color: var(--d-tx); border: 0; border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
.d-hoy .hoy-acc .hoy-pri { background: var(--d-cyan); color: #04121a; font-weight: 700; }
.d-hoy .hoy-acc .hoy-luego { background: transparent; color: var(--d-mut); margin-left: auto; }
.d-hoy .hoy-mas { align-self: flex-start; background: transparent; color: var(--d-cyan); padding-left: 0; }
.d-hoy .hoy-ia { border: 1px dashed #a855f7; border-radius: 10px; padding: 8px 10px; }
.d-hoy .hoy-ia p { margin: 4px 0 8px; font-size: 14px; line-height: 1.4; }
.d-hoy .hoy-ia-cab { display: flex; justify-content: space-between; align-items: center; }
.d-hoy .hoy-ia-cab button { background: transparent; border: 0; color: var(--d-mut); cursor: pointer; font-size: 16px; }
.d-hoy .hoy-borr { border-top: 1px solid var(--d-bd); padding-top: 8px; margin-top: 6px; }
.d-hoy .hoy-borr-txt { white-space: pre-wrap; font-size: 14px; line-height: 1.4; margin-bottom: 6px; }
.d-hoy .hoy-mut { color: var(--d-mut); }
.d-hoy .hoy-err { color: var(--d-red); }
`;
  document.head.appendChild(st);
}
