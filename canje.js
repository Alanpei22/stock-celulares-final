// ══════════════════════════════════════════════════════════════
//  🔄 Plan canje: el cliente entrega su celular en parte de pago
// ══════════════════════════════════════════════════════════════
//  Alan (17/11): "agregame un sistema para hacer plan canje". Antes había
//  un campo de texto "Permuta" escondido en "Más detalles": salía en el
//  comprobante y nada más. La caja registraba el precio ENTERO (aunque
//  entrara menos plata), y el celular recibido no aparecía en ningún lado.
//
//  Ahora, en la venta de equipo de la caja:
//   · se cargan los datos del usado que deja el cliente y cuánto se le toma,
//     con un valor sugerido sacado de lo que vale uno igual en tu stock;
//   · la caja registra solo lo que paga de diferencia (la plata que entra);
//   · la ganancia de la venta sigue siendo la del equipo vendido (el usado
//     es mercadería que entró, no plata perdida);
//   · el usado entra solo al Stock (con su costo = lo que se tomó), o a
//     "🔧 Equipos para arreglar" si necesita algo antes de venderse;
//   · el comprobante lo dice (permuta, valor tomado y lo que abonó).

const CANJE_MARGEN_DEF = 35;   // % que se le descuenta al precio de venta de uno igual
// Días que un usado de canje espera antes de venderse. Alan (18/11): la
// trampa típica es dejar el celu, cobrar la diferencia y a los días
// denunciarlo (o lo bloquea la compañía por cuotas). El IMEI está limpio
// el día del canje y se "ensucia" después.
const CANJE_ESPERA_DEF = 10;
// Antes de vender un usado de canje, el IMEI se vuelve a consultar: vale
// por este tiempo (si lo consultaste ayer, no pregunta de nuevo hoy)
const CANJE_REVISION_MS = 2 * 864e5;

let CANJE_CFG = { margen: CANJE_MARGEN_DEF, diasEspera: CANJE_ESPERA_DEF };
try { const c = JSON.parse(localStorage.getItem('tpCanjeCfg') || 'null'); if (c && c.margen >= 0) CANJE_CFG = Object.assign({ diasEspera: CANJE_ESPERA_DEF }, c); } catch {}
let _canjeOn = false;
let _canjeCfgLeida = false;

// 📸 Fotos del canje: DNI (frente y dorso) y el equipo que deja. Alan
// (18/11) las pidió: si el usado aparece robado, sirven de respaldo.
// OJO dónde se guardan: NO en Storage/stock-photos, que se lee con el link
// sin cuenta (lo usa la página pública). Van a la colección canje_fotos de
// Firestore, que solo leen las cuentas del negocio. Achicadas (1000 px) las
// tres entran en un documento (límite 1 MB).
const CANJE_FOTOS = [
  { k: 'dniFrente', lbl: 'DNI frente', ico: '🪪' },
  { k: 'dniDorso', lbl: 'DNI dorso', ico: '🪪' },
  { k: 'equipo', lbl: 'El equipo', ico: '📱' },
];
let _cjFotos = {};

// Dónde está el formulario: en la venta de equipo de la caja o en "Registrar
// venta" del Stock (index.html). Cada pantalla dice de dónde sale el total y
// con qué stock se compara. Arranca en la de la caja.
const _CJ_CAJA = {
  caja: 've-canje',
  total: () => (parseInt(String(document.getElementById('ve-precio')?.value || '').replace(/\D/g, ''), 10) || 0)
             + ((typeof vaTotal === 'function') ? vaTotal() : 0),
  stock: () => (typeof CAJA_STOCK !== 'undefined' ? CAJA_STOCK : []),
  cli: ['ve-cli-nombre', 've-cli-dni'],   // nombre y DNI del cliente en esta pantalla
};
let _cjCtx = _CJ_CAJA;

// La pantalla de venta del Stock la usa así: canjeEn({ caja, total, stock })
function canjeEn(ctx) {
  _cjCtx = Object.assign({}, _CJ_CAJA, ctx || {});
  canjeReset();
}

const _cjNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const _cjCap = s => String(s || '').replace(/\D/g, '');

// Precio de venta en pesos de un equipo del stock
function canjePrecioARS(p, dolar) {
  if (Number(p.precio) > 0 && p.moneda !== 'usd') return Number(p.precio);
  if (Number(p.precioUSD) > 0 && dolar > 0) return Math.round(Number(p.precioUSD) * dolar);
  return Number(p.precio) || 0;
}

// ¿Cuánto se le puede tomar? Sale del precio al que vendés uno igual (misma
// marca, modelo y capacidad), menos tu margen, y un poco menos si la batería
// o la estética no están bien. Sin uno igual en el stock, null: se pone a mano.
function canjeSugerido(eq, stock, cfg, dolar) {
  const mod = _cjNorm(eq && eq.modelo);
  if (!mod) return null;
  const mar = _cjNorm(eq.marca), cap = _cjCap(eq.almacenamiento);
  const iguales = (Array.isArray(stock) ? stock : []).filter(p => {
    if (!p || _cjNorm(p.modelo) !== mod) return false;
    if (mar && p.marca && _cjNorm(p.marca) !== mar) return false;
    if (cap && _cjCap(p.almacenamiento) && _cjCap(p.almacenamiento) !== cap) return false;
    return (p.estado || '').toLowerCase() !== 'nuevo';   // se compara con usados
  });
  const precios = iguales.map(p => canjePrecioARS(p, dolar)).filter(n => n > 0).sort((a, b) => a - b);
  if (!precios.length) return null;
  // La del medio: un precio raro (uno con caja y todo, o uno roto) no la mueve
  const ref = precios[Math.floor((precios.length - 1) / 2)];
  const margen = Math.min(90, Math.max(0, Number(cfg && cfg.margen) >= 0 ? Number(cfg.margen) : CANJE_MARGEN_DEF));
  let factor = 1 - margen / 100;
  const ajustes = [];
  const bat = Number(eq.bateria) || 0;
  if (bat && bat < 80) { factor -= 0.10; ajustes.push('batería baja −10%'); }
  else if (bat && bat < 85) { factor -= 0.05; ajustes.push('batería −5%'); }
  const est = String(eq.estetico || '').charAt(0).toUpperCase();
  if (est === 'B') { factor -= 0.05; ajustes.push('marcas de uso −5%'); }
  if (est === 'C') { factor -= 0.15; ajustes.push('bastante marcado −15%'); }
  // Redondeado para abajo, de a $5.000 (nadie toma un celu a $312.437)
  const valor = Math.max(0, Math.floor(ref * Math.max(0, factor) / 5000) * 5000);
  return { valor, ref, iguales: precios.length, margen, ajustes };
}

// Lo que paga el cliente de diferencia
function canjeSaldo(total, valor) {
  return Math.max(0, (Number(total) || 0) - (Number(valor) || 0));
}

// null si está bien; si no, qué falta
function canjeValidar(c, total, cliente) {
  if (!c) return null;
  if (!c.marca && !c.modelo) return 'Plan canje: poné la marca o el modelo del equipo que deja';
  if (!(c.valor > 0)) return 'Plan canje: poné cuánto se le toma el equipo';
  if (c.valor > (Number(total) || 0)) return 'Plan canje: lo que se le toma no puede ser más que lo que se lleva';
  if (c.imei && c.imei.length !== 15) return 'Plan canje: el IMEI del equipo que deja tiene que tener 15 números';
  // Comprarle un usado a alguien sin saber quién es, no: si aparece robado,
  // es lo primero que te piden
  if (!cliente || !cliente.nombre || !cliente.dni) return 'Plan canje: cargá nombre y DNI del cliente (es quien te vende el usado)';
  if (c.destino === 'arreglo' && !c.falla) return 'Plan canje: anotá qué necesita arreglar';
  return null;
}

function canjeNombre(c) {
  return [c.marca, c.modelo, c.almacenamiento].filter(Boolean).join(' ') || 'Equipo';
}

// El usado, como equipo del Stock (listo para vender)
function canjeDocStock(c, cliente, venta, ahoraIso, precioSugerido) {
  const d = {
    marca: c.marca || '', modelo: c.modelo || '', estado: 'Usado',
    precio: Number(precioSugerido) || 0,
    almacenamiento: c.almacenamiento || '', ram: '', imei: c.imei || '',
    notas: ['Entró por plan canje', c.notas].filter(Boolean).join(' · '),
    ubicacion: 'Depósito', fecha: ahoraIso, vendido: false,
    costo: Number(c.valor) || 0,
    origen: 'canje',
    canje: { cliente: cliente.nombre || '', dni: cliente.dni || '', tel: cliente.tel || '',
             valor: Number(c.valor) || 0, fecha: ahoraIso, venta: venta || '',
             imei: c.imei || '' },
  };
  // ⏳ La espera antes de venderlo
  const dias = Number(CANJE_CFG.diasEspera ?? CANJE_ESPERA_DEF) || 0;
  if (dias > 0) {
    const t = Date.parse(ahoraIso);
    if (!isNaN(t)) d.canje.esperaHasta = new Date(t + dias * 864e5).toISOString();
  }
  if (c.bateria) d.bateria = Number(c.bateria);
  if (c.color) d.color = c.color;
  // Sin precio de referencia, que se note que falta ponérselo
  if (!d.precio) d.sinPrecio = true;
  return d;
}

// El usado, como equipo para arreglar (🔧 Equipos para arreglar)
function canjeDocArreglo(c, cliente, venta, ahoraIso) {
  return {
    marca: c.marca || '', modelo: c.modelo || '', falla: c.falla || 'revisar',
    almacenamiento: c.almacenamiento || '', color: c.color || '', imei: c.imei || '',
    bateria: Number(c.bateria) || null,
    notas: ['Entró por plan canje de ' + (cliente.nombre || 'un cliente') + (venta ? ' (compró ' + venta + ')' : ''), c.notas].filter(Boolean).join(' · '),
    costoCompra: Number(c.valor) || 0, costoArreglo: 0,
    estado: 'pendiente', activo: true, fecha: ahoraIso, origen: 'canje',
  };
}

// ══════════════════════════════════════════════════════════════
//  ⏳ Espera y 🚫 baja de los usados de canje
// ══════════════════════════════════════════════════════════════
// En qué anda un usado de canje: null si no vino por canje;
// { tipo: 'bloqueado' } · { tipo: 'espera', hasta, dias } (todavía no se
// vende) · { tipo: 'revisar' } (se puede vender, pero antes hay que volver a
// consultar el IMEI) · { tipo: 'ok' } (IMEI consultado hace poco).
function canjeEstado(p, ahora) {
  if (!p || (p.origen !== 'canje' && !p.canje)) return null;
  if (p.bloqueado) return { tipo: 'bloqueado' };
  const t = typeof ahora === 'number' ? ahora : Date.now();
  const hasta = p.canje && Date.parse(p.canje.esperaHasta || '');
  if (hasta && hasta > t) return { tipo: 'espera', hasta: p.canje.esperaHasta, dias: Math.ceil((hasta - t) / 864e5) };
  const rev = p.canje && Date.parse(p.canje.imeiRevisado || '');
  if (rev && t - rev < CANJE_REVISION_MS) return { tipo: 'ok' };
  return { tipo: 'revisar' };
}

const _cjFecha = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }); };

// Antes de vender (desde el Stock o la caja). Devuelve false si no hay que
// seguir. Es sincrónica: las preguntas son confirm() y lo que se anota se
// guarda atrás.
function canjeAntesDeVender(p, ahora) {
  const e = canjeEstado(p, ahora);
  if (!e || e.tipo === 'ok') return true;
  const imei = (p.canje && p.canje.imei) || p.imei || '';
  if (e.tipo === 'bloqueado') {
    alert('🚫 Este equipo está marcado como BLOQUEADO / dado de baja.\n\nNo se puede vender así: reclamale al cliente que lo dejó (ficha del equipo) o marcalo como resuelto si ya lo desbloquearon.');
    return false;
  }
  if (e.tipo === 'espera' && !confirm(`⏳ Este equipo entró por plan canje y está en espera hasta el ${_cjFecha(e.hasta)} (faltan ${e.dias} día${e.dias === 1 ? '' : 's'}).\n\nEs por si el cliente lo denuncia o se lo bloquea la compañía después.\n\n¿Venderlo igual?`)) return false;
  if (!confirm(`🔎 Antes de vender un usado de canje, volvé a consultar el IMEI${imei ? ' ' + imei : ''} en ENACOM.\n\n¿Lo consultaste hoy y está limpio (sin denuncia ni bloqueo)?`)) return false;
  canjeAnotarRevision(p.id);
  return true;
}

// "Revisé el IMEI y está limpio"
function canjeAnotarRevision(id, aviso) {
  if (!id || typeof db === 'undefined' || !db) return;
  const ahora = new Date().toISOString();
  db.collection('stock').doc(id).update({ 'canje.imeiRevisado': ahora })
    .then(() => { if (aviso) toast('✅ Anotado: IMEI consultado y limpio', 'success'); })
    .catch(e => console.warn('canje revisión:', e));
  const p = (typeof STOCK !== 'undefined' ? STOCK : []).find(x => x.id === id);
  if (p && p.canje) p.canje.imeiRevisado = ahora;
}

// El botón de la ficha: anota y vuelve a dibujar la ficha (solo existe en el Stock)
function canjeRevisadoDesdeFicha(id) {
  canjeAnotarRevision(id, true);
  if (typeof openDetail === 'function') setTimeout(() => openDetail(id), 300);
}

// El mensaje para reclamarle al cliente que lo dejó
function canjeReclamoTexto(p, negocio) {
  const c = p.canje || {};
  const eq = [p.marca, p.modelo, p.almacenamiento].filter(Boolean).join(' ');
  const imei = c.imei || p.imei || '';
  const fecha = c.fecha ? new Date(c.fecha).toLocaleDateString('es-AR') : '';
  return `Hola ${String(c.cliente || '').split(/[ ,]/).filter(Boolean)[0] || ''}, te escribimos de ${negocio || 'TechPoint'}. `
    + `El ${eq}${imei ? ' (IMEI ' + imei + ')' : ''} que dejaste en parte de pago${fecha ? ' el ' + fecha : ''} figura bloqueado / dado de baja. `
    // Sin el monto: Alan (18/11) no quiere que figure en qué se tomó
    + `Según el comprobante que firmaste, tenés 72 horas para desbloquearlo o devolver el valor que se te reconoció por ese equipo. `
    + `Avisanos cómo lo resolvemos. Gracias.`;
}

function _cjTelWa(tlf) {
  if (typeof _waPhone === 'function') return _waPhone(tlf);
  let d = String(tlf || '').replace(/\D/g, '');
  if (d.length === 10) d = '549' + d;
  return d;
}

function canjeReclamar(id) {
  const p = (typeof STOCK !== 'undefined' ? STOCK : []).find(x => x.id === id);
  if (!p || !p.canje) return;
  if (!p.canje.tel) { toast('No hay teléfono del cliente: buscalo con su DNI (' + (p.canje.dni || '—') + ')', 'error'); return; }
  const url = 'https://wa.me/' + _cjTelWa(p.canje.tel) + '?text=' + encodeURIComponent(canjeReclamoTexto(p, (typeof window !== 'undefined' && window._DAKI_NAME) || 'TechPoint'));
  if (typeof waAbrir === 'function') waAbrir(url); else window.open(url, '_blank');
}

// 🚫 "Lo dieron de baja": sale de la venta y de la página, queda anotado y
// se ofrece reclamarle al cliente
async function canjeMarcarBloqueado(id) {
  const p = (typeof STOCK !== 'undefined' ? STOCK : []).find(x => x.id === id);
  if (!p) return;
  if (!confirm(`🚫 ¿Marcar ${[p.marca, p.modelo].filter(Boolean).join(' ')} como BLOQUEADO / dado de baja?\n\nSale de la venta y de la página de equipos hasta que lo marques como resuelto.`)) return;
  const ahora = new Date().toISOString();
  try {
    await db.collection('stock').doc(id).update({ bloqueado: true, bloqueadoFecha: ahora, publicar: false });
    if (typeof movStock === 'function') movStock({ tipo: 'equipo', id, doc: p, cant: 0, motivo: 'ajuste', detalle: '🚫 IMEI bloqueado / dado de baja' });
    if (typeof tgNotify === 'function') tgNotify(`🚫 <b>Equipo de canje bloqueado</b>\n${[p.marca, p.modelo, p.almacenamiento].filter(Boolean).join(' ')}${p.imei ? '\n🔑 ' + p.imei : ''}`
      + (p.canje ? `\n👤 ${p.canje.cliente || ''}${p.canje.dni ? ' · DNI ' + p.canje.dni : ''}${p.canje.tel ? ' · ' + p.canje.tel : ''}\n💸 Se le tomó en $${(Number(p.canje.valor) || 0).toLocaleString('es-AR')}` : ''));
    Object.assign(p, { bloqueado: true, bloqueadoFecha: ahora, publicar: false });
    toast('🚫 Marcado como bloqueado', 'success');
    if (typeof openDetail === 'function') openDetail(id);
    if (p.canje && p.canje.tel && confirm('¿Le mandás ahora el reclamo por WhatsApp al cliente que lo dejó?\n\n(El mensaje ya está escrito: le recuerda las 72 horas del comprobante.)')) canjeReclamar(id);
  } catch (e) { console.error('canje bloqueado:', e); toast('No se pudo guardar', 'error'); }
}

async function canjeDesbloqueado(id) {
  const p = (typeof STOCK !== 'undefined' ? STOCK : []).find(x => x.id === id);
  if (!p || !confirm('✅ ¿Ya lo desbloquearon? Vuelve a estar a la venta.')) return;
  try {
    await db.collection('stock').doc(id).update({ bloqueado: false, desbloqueadoFecha: new Date().toISOString() });
    if (typeof movStock === 'function') movStock({ tipo: 'equipo', id, doc: p, cant: 0, motivo: 'ajuste', detalle: '✅ IMEI desbloqueado' });
    p.bloqueado = false;
    toast('✅ De nuevo a la venta', 'success');
    if (typeof openDetail === 'function') openDetail(id);
  } catch (e) { console.error('canje desbloqueado:', e); toast('No se pudo guardar', 'error'); }
}

// Lo que se muestra en la ficha del equipo (Stock)
function canjeFichaHtml(p) {
  if (!p || p.origen !== 'canje' || !p.canje) return '';
  const e = canjeEstado(p);
  const c = p.canje;
  const x = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const b = (txt, fn, fondo) => `<button type="button" class="btn-ai" style="margin:6px 6px 0 0${fondo ? ';background:' + fondo + ';color:#fff;border-color:' + fondo : ''}" onclick="${fn}">${txt}</button>`;
  const quien = `${x(c.cliente)}${c.dni ? ' · DNI ' + x(c.dni) : ''}${c.tel ? ' · ' + x(c.tel) : ''}${c.fecha ? ' · ' + _cjFecha(c.fecha) : ''}${c.valor ? ' · se tomó en $' + Number(c.valor).toLocaleString('es-AR') : ''}`;
  let estado = '', botones = '';
  if (!p.vendido && e) {
    if (e.tipo === 'bloqueado') {
      estado = `<div style="color:#dc2626;font-weight:800;margin-top:4px">🚫 BLOQUEADO / DADO DE BAJA${p.bloqueadoFecha ? ' desde el ' + _cjFecha(p.bloqueadoFecha) : ''}</div>`;
      botones = b('📲 Reclamarle por WhatsApp', `canjeReclamar('${p.id}')`, '#16a34a') + b('✅ Ya lo desbloquearon', `canjeDesbloqueado('${p.id}')`);
    } else {
      estado = e.tipo === 'espera'
        ? `<div style="color:#b45309;font-weight:700;margin-top:4px">⏳ En espera hasta el ${_cjFecha(e.hasta)} (faltan ${e.dias} día${e.dias === 1 ? '' : 's'}): no venderlo todavía</div>`
        : e.tipo === 'ok' ? `<div style="color:#16a34a;font-weight:700;margin-top:4px">✅ IMEI consultado el ${_cjFecha(c.imeiRevisado)}: limpio</div>`
        : `<div style="color:#b45309;font-weight:700;margin-top:4px">🔎 Antes de venderlo, volvé a consultar el IMEI</div>`;
      botones = (e.tipo !== 'ok' ? b('✅ Consulté el IMEI: está limpio', `canjeRevisadoDesdeFicha('${p.id}')`) : '')
              + b('🚫 Lo dieron de baja', `canjeMarcarBloqueado('${p.id}')`, '#dc2626');
    }
  }
  const fotos = c.fotos ? b('📸 Ver fotos (DNI y equipo)', `canjeVerFotos('${p.id}')`) : '';
  return `<div class="det-row det-row--full" style="display:block;background:rgba(200,150,90,.1);padding:10px 12px;border-radius:10px;border:1px solid rgba(200,150,90,.35)">
      <div><b>🔄 Entró por plan canje</b></div>
      <div style="font-size:13px;margin-top:2px">${quien}</div>
      ${estado}
      <div>${botones}${fotos}</div>
    </div>`;
}

// El cartelito en la tarjeta de la lista del Stock
function canjeBadgeHtml(p) {
  if (!p || p.vendido) return '';
  const e = canjeEstado(p);
  if (!e) return '';
  if (e.tipo === 'bloqueado') return '<span class="badge" style="background:#dc2626;color:#fff">🚫 BLOQUEADO</span>';
  if (e.tipo === 'espera') return `<span class="badge" style="background:#f59e0b;color:#111" title="Entró por canje: esperar antes de venderlo">⏳ Canje · ${_cjFecha(e.hasta)}</span>`;
  return '<span class="badge" style="background:rgba(200,150,90,.25)" title="Entró por plan canje">🔄 Canje</span>';
}

// ── Formulario (dentro de la venta de equipo de la caja) ─────────────
const _cjV = id => String(document.getElementById(id)?.value ?? '').trim();

function canjeLeer() {
  if (!_canjeOn) return null;
  return {
    marca: _cjV('cj-marca'), modelo: _cjV('cj-modelo'), almacenamiento: _cjV('cj-cap'),
    color: _cjV('cj-color'), imei: _cjV('cj-imei').replace(/\D/g, ''),
    bateria: Math.min(100, parseInt(_cjV('cj-bat'), 10) || 0) || null,
    estetico: _cjV('cj-estetico'),
    valor: parseInt(_cjV('cj-valor').replace(/\D/g, ''), 10) || 0,
    destino: _cjV('cj-destino') || 'stock', falla: _cjV('cj-falla'),
    imeiOk: !!document.getElementById('cj-chk-imei')?.checked,
    cuentasOk: !!document.getElementById('cj-chk-cuentas')?.checked,
    fotos: Object.assign({}, _cjFotos),
  };
}

function canjeReset() {
  _canjeOn = false;
  _cjFotos = {};
  const box = document.getElementById(_cjCtx.caja);
  if (box) box.innerHTML = _canjeBotonHtml();
}

function _canjeBotonHtml() {
  return `<button type="button" class="cj-add" onclick="canjeActivar()">🔄 <b>Plan canje</b> — deja su celular en parte de pago</button>`;
}

function canjeActivar() {
  _canjeOn = true;
  _canjeEstilos();
  _canjeLeerCfg();
  const box = document.getElementById(_cjCtx.caja);
  if (!box) return;
  // Clases propias (cj-…): antes usaba las de la caja (precio-fg,
  // ventaeq-g2) y en "Registrar venta" del Stock, que no las tiene, se veía
  // todo desarmado.
  box.innerHTML = `
    <div class="cj-box">
      <div class="cj-hd">
        <div><b>🔄 Plan canje</b><small>El equipo que deja en parte de pago</small></div>
        ${_canjeDueno() ? `<button type="button" class="cj-cfg" onclick="canjeConfigurar()" title="Cuánto se le descuenta al precio de venta">⚙️ ${CANJE_CFG.margen}%</button>` : ''}
        <button type="button" class="cj-x" onclick="canjeReset();_canjeTotales()" title="Sacar el canje">✕</button>
      </div>
      <div class="cj-cli hidden" id="cj-cli"></div>
      <div class="cj-fg"><label>IMEI <small>(marcá *#06# o escanealo)</small></label>
        <div class="cj-fila"><input id="cj-imei" class="cj-in" type="text" inputmode="numeric" maxlength="15" placeholder="15 números" autocomplete="off" oninput="canjeRecalcular()">
        <button type="button" class="cj-cam" onclick="canjeEscanearImei()" title="Escanear el IMEI">📷</button></div></div>
      <div class="cj-g2">
        <div class="cj-fg"><label>Marca</label><input id="cj-marca" class="cj-in" type="text" placeholder="iPhone" autocomplete="off" oninput="canjeRecalcular()"></div>
        <div class="cj-fg"><label>Modelo</label><input id="cj-modelo" class="cj-in" type="text" placeholder="iPhone 11" autocomplete="off" oninput="canjeRecalcular()"></div>
        <div class="cj-fg"><label>Capacidad</label><input id="cj-cap" class="cj-in" type="text" placeholder="128GB" autocomplete="off" oninput="canjeRecalcular()"></div>
        <div class="cj-fg"><label>Batería %</label><input id="cj-bat" class="cj-in" type="number" inputmode="numeric" placeholder="86" oninput="canjeRecalcular()"></div>
        <div class="cj-fg"><label>Estética</label>
          <select id="cj-estetico" class="cj-in" onchange="canjeRecalcular()">
            <option value="A">A · impecable</option><option value="B">B · marcas de uso</option><option value="C">C · muy marcado</option>
          </select></div>
        <div class="cj-fg"><label>Color</label><input id="cj-color" class="cj-in" type="text" placeholder="Negro" autocomplete="off"></div>
      </div>
      <div class="cj-sug" id="cj-sug"></div>
      <div class="cj-fg"><label>Se le toma en *</label><input id="cj-valor" class="cj-in cj-valor" type="number" inputmode="numeric" placeholder="$ 0" oninput="_canjeTotales()"></div>
      <div class="cj-g2">
        <div class="cj-fg"><label>¿Adónde va?</label>
          <select id="cj-destino" class="cj-in" onchange="_canjeDestino()">
            <option value="stock">📱 Al stock</option>
            <option value="arreglo">🔧 A arreglar</option>
          </select></div>
        <div class="cj-fg hidden" id="cj-falla-wrap"><label>¿Qué necesita?</label><input id="cj-falla" class="cj-in" type="text" placeholder="Batería, módulo…" autocomplete="off"></div>
      </div>
      <div class="cj-fg"><label>📸 Fotos <small>(te cubren si alguna vez lo reclaman)</small></label>
        <div class="cj-fotos" id="cj-fotos">${_canjeFotosHtml()}</div></div>
      <label class="cj-chk"><input type="checkbox" id="cj-chk-imei"> <span>Consulté el IMEI en ENACOM: no tiene denuncia</span></label>
      <label class="cj-chk"><input type="checkbox" id="cj-chk-cuentas"> <span>iCloud / Google borrado y restablecido</span></label>
      <div class="cj-tot" id="cj-tot"></div>
    </div>`;
  // Que el aviso de "falta el DNI" se vaya apenas lo escriben
  (_cjCtx.cli || []).forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._cjOye) { el.addEventListener('input', _canjeTotales); el._cjOye = true; }
  });
  canjeRecalcular();
  setTimeout(() => document.getElementById('cj-imei')?.focus(), 50);
}

function _canjeFotosHtml() {
  return CANJE_FOTOS.map(f => _cjFotos[f.k]
    ? `<button type="button" class="cj-foto cj-foto--ok" onclick="canjeFoto('${f.k}')" title="Sacarla de nuevo">
         <img src="${_cjFotos[f.k]}" alt=""><span>✓ ${f.lbl}</span></button>`
    : `<button type="button" class="cj-foto" onclick="canjeFoto('${f.k}')"><b>${f.ico}</b><span>${f.lbl}</span></button>`).join('');
}

// Saca (o vuelve a sacar) una de las fotos con la cámara de atrás
function canjeFoto(k) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    try {
      _cjFotos[k] = await canjeAchicarFoto(file, 1000, 0.7);
      const box = document.getElementById('cj-fotos');
      if (box) box.innerHTML = _canjeFotosHtml();
    } catch { toast('No pude abrir la foto', 'error'); }
  };
  inp.click();
}

// Foto del celu (varios MB) → JPG chico, en texto (dataURL)
function canjeAchicarFoto(file, max, q) {
  return new Promise((ok, mal) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('foto')); };
    img.src = url;
  });
}

// El documento de canje_fotos (solo las que se sacaron)
function canjeDocFotos(fotos, cliente, equipoId, donde, ahoraIso) {
  const d = { equipoId, donde, cliente: cliente.nombre || '', dni: cliente.dni || '', tel: cliente.tel || '', fecha: ahoraIso };
  let n = 0;
  CANJE_FOTOS.forEach(f => { if (fotos && fotos[f.k]) { d[f.k] = fotos[f.k]; n++; } });
  return n ? d : null;
}

// Guarda las fotos; devuelve cuántas (0 si no había o si falló: la venta y
// el equipo no se frenan por esto)
async function _canjeGuardarFotos(c, cliente, id, donde, ahora) {
  const doc = canjeDocFotos(c.fotos, cliente, id, donde, ahora);
  if (!doc) return 0;
  try {
    await db.collection('canje_fotos').doc(id).set(doc);
    return CANJE_FOTOS.filter(f => doc[f.k]).length;
  } catch (e) {
    console.error('fotos del canje:', e);
    toast('No se pudieron guardar las fotos del canje (el equipo sí quedó cargado)', 'error');
    return 0;
  }
}

// Ver las fotos de un canje (desde la ficha del equipo)
async function canjeVerFotos(id) {
  _canjeEstilos();
  let d = null;
  try { const s = await db.collection('canje_fotos').doc(id).get(); d = s.exists ? s.data() : null; }
  catch (e) { console.error('fotos del canje:', e); }
  if (!d) { toast('No encontré las fotos de este canje', 'error'); return; }
  document.getElementById('cj-ver')?.remove();
  const ov = document.createElement('div');
  ov.id = 'cj-ver';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  const fotos = CANJE_FOTOS.filter(f => d[f.k]).map(f =>
    `<figure><img src="${d[f.k]}" alt="${f.lbl}" onclick="window.open(this.src)"><figcaption>${f.lbl}</figcaption></figure>`).join('');
  const e = s => String(s || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  ov.innerHTML = `<div class="cj-ver-box">
    <div class="cj-hd"><div><b>🔄 Fotos del canje</b><small>${e(d.cliente)}${d.dni ? ' · DNI ' + e(d.dni) : ''}${d.fecha ? ' · ' + new Date(d.fecha).toLocaleDateString('es-AR') : ''}</small></div>
    <button type="button" class="cj-x" onclick="document.getElementById('cj-ver').remove()">✕</button></div>
    <div class="cj-ver-g">${fotos}</div></div>`;
  document.body.appendChild(ov);
}

// 📷 El IMEI del equipo que deja, con la cámara. El lector de siempre lo
// valida y, por los primeros números, completa marca y modelo.
function canjeEscanearImei() {
  if (typeof escanearImei === 'function') escanearImei('cj-imei', { marca: 'cj-marca', modelo: 'cj-modelo' });
  else toast('El lector no está disponible acá', 'error');
}

function _canjeDueno() {
  return (typeof _cajaIsOwner !== 'undefined' && _cajaIsOwner) || (typeof tpEsDueno === 'function' && tpEsDueno());
}

function _canjeDestino() {
  document.getElementById('cj-falla-wrap')?.classList.toggle('hidden', _cjV('cj-destino') !== 'arreglo');
}

let _canjeUltSug = null;
function canjeRecalcular() {
  const c = canjeLeer();
  const el = document.getElementById('cj-sug');
  if (!c || !el) return;
  const dolar = (typeof getCurrentDolar === 'function' ? getCurrentDolar() : 0) || 0;
  const s = canjeSugerido(c, _cjCtx.stock(), CANJE_CFG, dolar);
  _canjeUltSug = s;
  const f = n => (typeof fmt === 'function' ? fmt(n) : '$' + Math.round(n).toLocaleString('es-AR'));
  if (!c.modelo) el.innerHTML = '';
  else if (!s) el.innerHTML = `<span class="cj-sug-no">No hay uno igual en tu stock para comparar: poné el valor a mano.</span>`;
  else el.innerHTML = `💡 Sugerido: <b>${f(s.valor)}</b>
      <small>Vendés uno igual a ${f(s.ref)}${s.iguales > 1 ? ` (${s.iguales} en stock)` : ''} · menos ${s.margen}%${s.ajustes.length ? ' · ' + s.ajustes.join(' · ') : ''}</small>
      <button type="button" class="cj-usar" onclick="canjeUsarSugerido()">Usar</button>`;
  _canjeTotales();
}

function canjeUsarSugerido() {
  const v = document.getElementById('cj-valor');
  if (v && _canjeUltSug) { v.value = _canjeUltSug.valor; _canjeTotales(); }
}

// Total − canje = lo que paga
function _canjeTotales() {
  const el = document.getElementById('cj-tot');
  const total = _cjCtx.total();
  const c = canjeLeer();
  if (!el || !c) return;
  const f = n => (typeof fmt === 'function' ? fmt(n) : '$' + Math.round(n).toLocaleString('es-AR'));
  if (!total) { el.innerHTML = '<small>Poné el precio del equipo que se lleva para ver la diferencia.</small>'; return; }
  // Sin nombre y DNI no se puede confirmar: avisarlo acá y no al final
  const cliEl = document.getElementById('cj-cli');
  if (cliEl) {
    const [nId, dId] = _cjCtx.cli || [];
    const faltan = [];
    if (nId && !String(document.getElementById(nId)?.value || '').trim()) faltan.push('nombre');
    if (dId && !String(document.getElementById(dId)?.value || '').trim()) faltan.push('DNI');
    cliEl.classList.toggle('hidden', !faltan.length);
    cliEl.textContent = faltan.length ? `⚠️ Para el canje cargá ${faltan.join(' y ')} del cliente (arriba, en los datos del comprador)` : '';
  }
  const pasa = c.valor > total;
  el.innerHTML = `
    <div><span>Se lleva</span><b>${f(total)}</b></div>
    <div><span>Deja su equipo</span><b>− ${f(c.valor)}</b></div>
    <div class="cj-paga${pasa ? ' cj-mal' : ''}"><span>${pasa ? '⚠️ Lo que se toma es más que lo que se lleva' : 'Paga de diferencia'}</span><b>${pasa ? '' : f(canjeSaldo(total, c.valor))}</b></div>`;
}

// ── Margen (lo define el dueño; se guarda en config/canje) ──
async function _canjeLeerCfg() {
  if (_canjeCfgLeida || typeof db === 'undefined' || !db) return;
  _canjeCfgLeida = true;
  try {
    const d = await db.collection('config').doc('canje').get();
    if (d.exists && Number(d.data().margen) >= 0) {
      const de = Number(d.data().diasEspera);
      CANJE_CFG = { margen: Number(d.data().margen), diasEspera: de >= 0 ? de : CANJE_ESPERA_DEF };
      try { localStorage.setItem('tpCanjeCfg', JSON.stringify(CANJE_CFG)); } catch {}
      canjeRecalcular();
    }
  } catch (e) { console.warn('canje cfg:', e); }
}

async function canjeConfigurar() {
  const r = prompt('🔄 Plan canje: ¿qué % le descontás al precio de venta de uno igual para tomarlo?\n\n'
    + 'Ej: 35 → si vendés uno igual a $500.000, se sugiere tomarlo en $325.000.', String(CANJE_CFG.margen));
  if (r === null) return;
  const n = parseFloat(String(r).replace(',', '.'));
  if (!(n >= 0 && n <= 90)) { toast('Poné un número entre 0 y 90', 'error'); return; }
  if (!_canjeDueno()) { toast('El margen lo define el dueño', 'error'); return; }
  const rd = prompt('⏳ ¿Cuántos días espera un usado de canje antes de venderlo?\n\n'
    + 'Por si el cliente lo denuncia o se lo bloquea la compañía después. 0 = sin espera.', String(CANJE_CFG.diasEspera ?? CANJE_ESPERA_DEF));
  if (rd === null) return;
  const dias = parseInt(rd, 10);
  if (!(dias >= 0 && dias <= 60)) { toast('Poné un número de días entre 0 y 60', 'error'); return; }
  try {
    await db.collection('config').doc('canje').set({ margen: n, diasEspera: dias, actualizado: new Date().toISOString() });
    CANJE_CFG = { margen: n, diasEspera: dias };
    try { localStorage.setItem('tpCanjeCfg', JSON.stringify(CANJE_CFG)); } catch {}
    toast(`🔄 Plan canje: se sugiere el precio de venta menos ${n}% · espera ${dias} día${dias === 1 ? '' : 's'} antes de venderlo`, 'success');
    canjeRecalcular();
  } catch (e) { console.error('canje cfg:', e); toast('No se pudo guardar', 'error'); }
}

// Después de la venta: el usado entra al stock o a "para arreglar"
async function canjeGuardarEquipo(c, cliente, ventaNombre) {
  const ahora = new Date().toISOString();
  if (c.destino === 'arreglo') {
    const id = 'arr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const nFotos = await _canjeGuardarFotos(c, cliente, id, 'arreglo', ahora);
    const docA = canjeDocArreglo(c, cliente, ventaNombre, ahora);
    if (nFotos) docA.canjeFotos = nFotos;
    await db.collection('equipos_arreglo').doc(id).set(docA);
    return { donde: 'arreglo', id, fotos: nFotos };
  }
  const dolar = (typeof getCurrentDolar === 'function' ? getCurrentDolar() : 0) || 0;
  const s = canjeSugerido(c, _cjCtx.stock(), CANJE_CFG, dolar);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const doc = { id, ...canjeDocStock(c, cliente, ventaNombre, ahora, s ? s.ref : 0),
                _sourceDevice: (typeof getDeviceId === 'function') ? getDeviceId() : null };
  const nFotos = await _canjeGuardarFotos(c, cliente, id, 'stock', ahora);
  if (nFotos) doc.canje.fotos = nFotos;
  await db.collection('stock').doc(id).set(doc);
  if (typeof movStock === 'function') movStock({ tipo: 'equipo', id, doc, cant: 1, motivo: 'canje', detalle: 'de ' + (cliente.nombre || '') });
  return { donde: 'stock', id, fotos: nFotos };
}

function _canjeEstilos() {
  if (document.getElementById('cj-css')) return;
  const s = document.createElement('style');
  s.id = 'cj-css';
  // Desde acá: el CSS se sirve del caché
  s.textContent = `
  .cj-add { width: 100%; margin: 12px 0 6px; padding: 14px; border-radius: 12px; border: 2px dashed var(--accent, #C8965A);
    background: transparent; color: inherit; font-size: 14px; cursor: pointer; text-align: left; line-height: 1.3; }
  .cj-box { margin: 12px 0; border: 2px solid var(--accent, #C8965A); border-radius: 14px; padding: 14px; background: rgba(200,150,90,.06); }
  .cj-hd { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .cj-hd > div { flex: 1; min-width: 0; }
  .cj-hd b { display: block; font-size: 16px; }
  .cj-hd small { display: block; font-size: 12px; opacity: .7; }
  .cj-cfg { border: 1px solid rgba(128,128,128,.4); border-radius: 8px; background: transparent; color: inherit; font-size: 12px; padding: 5px 8px; cursor: pointer; white-space: nowrap; }
  .cj-x { border: 0; background: transparent; font-size: 18px; cursor: pointer; color: inherit; padding: 4px 6px; }
  .cj-cli { background: rgba(239,68,68,.12); color: #ef4444; border-radius: 10px; padding: 8px 10px; font-size: 13px; font-weight: 600; margin-bottom: 10px; }
  .cj-g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
  .cj-fg { margin-bottom: 10px; min-width: 0; }
  .cj-fg label { display: block; font-size: 11.5px; font-weight: 700; letter-spacing: .3px; text-transform: uppercase; opacity: .7; margin-bottom: 4px; }
  .cj-fg label small { text-transform: none; font-weight: 500; letter-spacing: 0; }
  .cj-in { width: 100%; box-sizing: border-box; padding: 11px 12px; border: 1.5px solid var(--border, rgba(128,128,128,.35)); border-radius: 10px;
    background: var(--card, #fff); color: var(--text, inherit); font-size: 15px; font-family: inherit; outline: none; -webkit-appearance: none; appearance: none; }
  .cj-in:focus { border-color: var(--accent, #C8965A); }
  select.cj-in { background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
    background-position: calc(100% - 16px) 50%, calc(100% - 11px) 50%; background-size: 5px 5px; background-repeat: no-repeat; padding-right: 28px; }
  .cj-fila { display: flex; gap: 8px; }
  .cj-fila .cj-in { flex: 1; }
  .cj-cam { flex: 0 0 auto; width: 48px; border-radius: 10px; border: 1.5px solid var(--accent, #C8965A); background: transparent; font-size: 20px; cursor: pointer; }
  .cj-sug { font-size: 13.5px; margin: 2px 0 10px; line-height: 1.35; }
  .cj-sug:empty { display: none; }
  .cj-sug small { display: block; opacity: .75; margin-top: 2px; }
  .cj-sug-no { opacity: .75; }
  .cj-usar { margin-top: 6px; border: 0; border-radius: 8px; padding: 7px 14px; background: var(--accent, #C8965A); color: #111; font-weight: 700; cursor: pointer; }
  .cj-valor { font-size: 20px; font-weight: 800; }
  .cj-chk { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; margin: 6px 0; cursor: pointer; line-height: 1.3; }
  .cj-chk input { margin-top: 2px; flex: 0 0 auto; }
  .cj-tot { margin-top: 10px; border-top: 1px dashed rgba(128,128,128,.4); padding-top: 10px; font-size: 14px; }
  .cj-tot div { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
  .cj-paga { font-size: 18px; font-weight: 800; color: #10b981; }
  .cj-mal { color: #ef4444; font-size: 14px; }
  .cj-box .hidden { display: none !important; }
  .cj-fotos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .cj-foto { position: relative; height: 78px; border-radius: 10px; border: 1.5px dashed var(--border, rgba(128,128,128,.5));
    background: transparent; color: inherit; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; overflow: hidden; padding: 0; }
  .cj-foto b { font-size: 22px; }
  .cj-foto span { font-size: 11.5px; font-weight: 600; }
  .cj-foto--ok { border: 2px solid #10b981; }
  .cj-foto--ok img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .cj-foto--ok span { position: absolute; left: 0; right: 0; bottom: 0; background: rgba(16,185,129,.9); color: #fff; padding: 2px 0; }
  #cj-ver { position: fixed; inset: 0; z-index: 3000; background: rgba(0,0,0,.7); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .cj-ver-box { background: var(--card, #fff); color: var(--text, #111); border-radius: 16px; padding: 14px; width: min(560px, 100%); max-height: 90vh; overflow: auto; }
  .cj-ver-g { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .cj-ver-g figure { margin: 0; }
  .cj-ver-g img { width: 100%; border-radius: 10px; cursor: zoom-in; display: block; }
  .cj-ver-g figcaption { font-size: 12px; text-align: center; opacity: .75; margin-top: 4px; }`;
  document.head.appendChild(s);
}
