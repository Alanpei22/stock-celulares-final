// ══════════════════════════════════════════════════════════════
//  factura-venta.js — Factura C electrónica (ARCA) desde la caja
//  ─────────────────────────────────────────────────────────────
//  Lo decidido con Alan (tools/factura-arca.md):
//   · Se factura SOLO lo cobrado por medio digital (transferencia,
//     MercadoPago, tarjetas). Efectivo y dólares no. Con pago dividido, si
//     una parte es digital se factura la venta entera.
//   · Nunca sale sola: después de cobrar se pregunta "¿Factura?".
//   · Siempre es Factura C (monotributo). Lo que cambia es a quién: consumidor
//     final (lo normal, un toque) o un CUIT (monotributista, empresa…).
//   · La factura la pide el servidor (/api/factura): la clave del local no
//     está en el navegador. Si falla, la venta queda marcada y se puede
//     reintentar sin repetir número (ver api/_arca.js).
//
//  El ticket sale por el mismo camino que el comprobante (QZ Tray → tickets,
//  o el diálogo de Chrome), con CAE, vencimiento y el QR obligatorio.
// ══════════════════════════════════════════════════════════════
'use strict';

const FV_NO_SE_FACTURA = ['efectivo', 'dólares', 'dolares'];
const FV_COND = {
  5: 'Consumidor Final',
  6: 'Responsable Monotributo',
  1: 'IVA Responsable Inscripto',
  4: 'IVA Sujeto Exento',
};

function _fvEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _fvPlata(n) { return '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function _fvNro(pv, nro) { return String(pv || 0).padStart(5, '0') + '-' + String(nro || 0).padStart(8, '0'); }

// ¿Esta venta se factura? (la misma regla que api/factura.js)
function ventaFacturable(mov) {
  if (!mov || mov.tipo !== 'ingreso' || !(Number(mov.monto) > 0)) return false;
  const m = [mov.metodoPago, Number(mov.monto2) > 0 ? mov.metodoPago2 : null].filter(Boolean).map(x => String(x).toLowerCase());
  return m.some(x => !FV_NO_SE_FACTURA.includes(x));
}

// Validación del CUIT con el dígito verificador: un número mal tipeado lo
// rechaza ARCA, pero mejor enterarse antes de mandarlo.
function cuitValido(c) {
  const s = String(c || '').replace(/\D/g, '');
  if (s.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((t, p, i) => t + p * Number(s[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;   // casos raros (CUIT con prefijo 23): ARCA decide
  return dv === Number(s[10]);
}

// Una reparación es servicio (con repuesto): "productos y servicios"
function _fvConcepto(mov) {
  return (mov.repairId || Number(mov.montoReparacion) > 0) ? 'ambos' : 'productos';
}

// ── Datos del local para el encabezado de la factura ──
// En config/facturaEmisor (los edita el dueño: 🧾 en el menú de la caja).
const FV_EMISOR_DEF = {
  razonSocial: 'RICARDI ALAN AGUSTIN', cuit: '20-38519962-8', fantasia: 'TECHPOINT',
  domicilio: 'Av. Urquiza 4741 Local 22 - Caseros (1678)', iibb: '', inicio: '',
};
let _fvEmisor = null;
async function _fvCargarEmisor() {
  if (_fvEmisor) return _fvEmisor;
  try {
    const d = await db.collection('config').doc('facturaEmisor').get();
    _fvEmisor = Object.assign({}, FV_EMISOR_DEF, d.exists ? d.data() : {});
  } catch { _fvEmisor = Object.assign({}, FV_EMISOR_DEF); }
  return _fvEmisor;
}

// ── El ticket de la factura (58mm) ──
function ticketFacturaHtml(mov, f, emisor) {
  const e = Object.assign({}, FV_EMISOR_DEF, emisor || {});
  const rec = f.receptor || {};
  const renglones = (typeof _cvRenglones === 'function') ? _cvRenglones(mov) : [{ nombre: mov.descripcion || 'Venta', qty: 1, unit: Number(mov.monto) || 0, total: Number(mov.monto) || 0 }];
  const total = Number(f.importe != null ? f.importe : mov.monto) || 0;
  const qrUrl = 'https://www.afip.gob.ar/fe/qr/?p=' + btoa(JSON.stringify(f.qr || {}));
  let qr = '';
  try { qr = (typeof qrSvg === 'function') ? qrSvg(qrUrl, 30) : ''; } catch (err) { console.error('QR factura:', err); }
  const prueba = f.entorno && f.entorno !== 'produccion';
  const fecha = (f.qr && f.qr.fecha) ? f.qr.fecha.split('-').reverse().join('/') : '';
  const vto = f.caeVto ? f.caeVto.split('-').reverse().join('/') : '';
  const cliente = (Number(rec.docTipo) === 99 || !rec.docTipo)
    ? '<div>A: <b>Consumidor Final</b></div>'
    : `<div>A: <b>${_fvEsc(rec.nombre || '')}</b></div>
       <div>${Number(rec.docTipo) === 80 ? 'CUIT' : Number(rec.docTipo) === 96 ? 'DNI' : 'Doc.'}: ${_fvEsc(rec.docNro)}</div>
       <div>${_fvEsc(FV_COND[rec.condIva] || '')}</div>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Factura C ${_fvNro(f.ptoVenta, f.nro)}</title>
<style>
@page{size:58mm 260mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;color:#000;background:#fff;width:58mm;padding:0 5mm}
.tkt{width:48mm;padding:3mm 0 8mm;font-size:12px;line-height:1.35;font-weight:600}
.c{text-align:center}
.biz{font-size:19px;font-weight:900;line-height:1.15}
.sm{font-size:10.5px}
.sep{border-top:1.5px dashed #000;margin:2.4mm 0}
.tipo{font-size:17px;font-weight:900;margin:1mm 0}
.r{display:flex;justify-content:space-between;gap:2mm;margin:.8mm 0}
.r span:first-child{flex:1;min-width:0;word-break:break-word}
.r span:last-child{white-space:nowrap;font-weight:800}
.qty{font-size:10.5px;margin:-.5mm 0 1mm}
.tot{font-size:17px;font-weight:900;margin:1.5mm 0}
.prueba{border:2px solid #000;font-weight:900;text-align:center;padding:1mm;margin:1mm 0;font-size:12px}
.qr{display:flex;justify-content:center;margin-top:2mm}
</style></head><body>
<div class="tkt">
  ${prueba ? '<div class="prueba">PRUEBA — SIN VALIDEZ FISCAL</div>' : ''}
  <div class="c biz">${_fvEsc(e.fantasia)}</div>
  <div class="c sm">${_fvEsc(e.razonSocial)}</div>
  <div class="c sm">${_fvEsc(e.domicilio)}</div>
  <div class="c sm">CUIT: ${_fvEsc(e.cuit)}</div>
  ${e.iibb ? `<div class="c sm">Ingresos Brutos: ${_fvEsc(e.iibb)}</div>` : ''}
  ${e.inicio ? `<div class="c sm">Inicio de actividades: ${_fvEsc(e.inicio)}</div>` : ''}
  <div class="c sm">Responsable Monotributo</div>
  <div class="sep"></div>
  <div class="c tipo">FACTURA C</div>
  <div class="c sm">Cód. 011</div>
  <div class="c">N° ${_fvNro(f.ptoVenta, f.nro)}</div>
  <div class="c sm">Fecha: ${_fvEsc(fecha)}</div>
  <div class="sep"></div>
  <div class="sm">${cliente}</div>
  <div class="sep"></div>
  ${renglones.map(r => `<div class="r"><span>${_fvEsc(r.nombre)}</span><span>${_fvPlata(r.total)}</span></div>
  ${r.qty > 1 ? `<div class="qty">  ${r.qty} x ${_fvPlata(r.unit)}</div>` : ''}`).join('')}
  <div class="sep"></div>
  <div class="r tot"><span>TOTAL</span><span>${_fvPlata(total)}</span></div>
  <div class="sep"></div>
  <div class="sm">CAE: <b>${_fvEsc(f.cae)}</b></div>
  <div class="sm">Vto. CAE: ${_fvEsc(vto)}</div>
  ${qr ? `<div class="qr">${qr}</div>` : ''}
  <div class="c sm" style="margin-top:1.5mm">Comprobante autorizado por ARCA</div>
</div>
<script>
(function(){var mm=96/25.4,h=Math.ceil(document.querySelector('.tkt').getBoundingClientRect().height/mm)+2;
var st=document.createElement('style');st.textContent='@page{size:58mm '+h+'mm;margin:0}';document.head.appendChild(st);})();
</script>
</body></html>`;
}

async function imprimirFactura(mov, f) {
  const emisor = await _fvCargarEmisor();
  const html = ticketFacturaHtml(mov, f, emisor);
  const directo = typeof _imprimirDirecto === 'function' ? await _imprimirDirecto('ticket', html) : false;
  if (!directo && typeof _imprimirEnIframe === 'function') await _imprimirEnIframe(html);
}

// ── Pedir la factura ──
let _fvEnCurso = false;
async function facturarVenta(movId, mov, receptor) {
  if (_fvEnCurso) return;
  _fvEnCurso = true;
  _fvOcultarBarra();
  const r = receptor || {};
  if (typeof toast === 'function') toast('🧾 Pidiendo la factura a ARCA…', 'info');
  try {
    const res = await apiFetch('/api/factura', { method: 'POST', body: JSON.stringify({
      action: 'emitir', movId, concepto: _fvConcepto(mov),
      docTipo: r.docTipo || 'cf', docNro: r.docNro || '', condIva: r.condIva || 5, receptorNombre: r.nombre || '',
    }) });
    let out = {};
    try { out = await res.json(); } catch {}
    if (!res.ok || !out.factura) {
      const msg = out.error || (res.status === 401 ? 'La sesión venció: salí y volvé a entrar' : 'Error ' + res.status);
      if (typeof toast === 'function') toast('⚠️ No se pudo facturar: ' + msg + '. Queda en "sin facturar" para reintentar.', 'error');
      return null;
    }
    const f = out.factura;
    if (typeof toast === 'function') toast(`✅ Factura C ${_fvNro(f.ptoVenta, f.nro)}${f.entorno !== 'produccion' ? ' (PRUEBA)' : ''}`, 'success');
    await imprimirFactura(mov, f);
    return f;
  } catch (e) {
    console.error('facturar:', e);
    if (typeof toast === 'function') toast('⚠️ Sin conexión. La venta queda en "sin facturar" para reintentar.', 'error');
    return null;
  } finally {
    _fvEnCurso = false;
  }
}

// ── A un CUIT: monotributista, empresa, exento ──
function facturarAUnCuit(movId, mov) {
  _fvOcultarBarra();
  document.getElementById('fv-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'fv-modal';
  m.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<div style="background:var(--card,#fff);color:var(--text,#111);border-radius:14px;padding:16px;width:100%;max-width:380px;display:flex;flex-direction:column;gap:10px">
    <b style="font-size:16px">🧾 Factura C a un CUIT</b>
    <label style="font-size:13px">CUIT (sin guiones)<input id="fv-cuit" inputmode="numeric" maxlength="13" autocomplete="off" style="width:100%;padding:9px;font-size:16px;margin-top:4px;border:1px solid var(--border,#ccc);border-radius:8px"></label>
    <label style="font-size:13px">Nombre o razón social<input id="fv-nombre" maxlength="120" autocomplete="off" style="width:100%;padding:9px;font-size:16px;margin-top:4px;border:1px solid var(--border,#ccc);border-radius:8px"></label>
    <label style="font-size:13px">Condición frente al IVA<select id="fv-cond" style="width:100%;padding:9px;font-size:15px;margin-top:4px;border:1px solid var(--border,#ccc);border-radius:8px">
      <option value="6">Monotributista</option><option value="1">Responsable Inscripto (empresa)</option><option value="4">Exento</option>
    </select></label>
    <div id="fv-err" style="color:#dc2626;font-size:13px;min-height:16px"></div>
    <div style="display:flex;gap:8px"><button class="btn-primary" style="flex:1" id="fv-ok">Facturar</button><button class="btn-secondary" id="fv-cancel">Cancelar</button></div>
  </div>`;
  document.body.appendChild(m);
  const cuit = m.querySelector('#fv-cuit');
  setTimeout(() => cuit.focus(), 50);
  m.querySelector('#fv-cancel').onclick = () => m.remove();
  m.querySelector('#fv-ok').onclick = () => {
    const nro = cuit.value.replace(/\D/g, '');
    const nombre = m.querySelector('#fv-nombre').value.trim();
    const err = m.querySelector('#fv-err');
    if (!cuitValido(nro)) { err.textContent = 'Ese CUIT no es válido: revisá los 11 números.'; return; }
    if (!nombre) { err.textContent = 'Falta el nombre o la razón social.'; return; }
    m.remove();
    facturarVenta(movId, mov, { docTipo: 'cuit', docNro: nro, condIva: Number(m.querySelector('#fv-cond').value), nombre });
  };
}

// ── La pregunta, después de cobrar algo digital ──
// Reemplaza a "¿Comprobante?" en esas ventas: la factura ya es el comprobante.
function ofrecerFacturaVenta(movId, mov) {
  _fvOcultarBarra();
  if (typeof _cvOcultarBarra === 'function') _cvOcultarBarra();
  const b = document.createElement('div');
  b.id = 'fv-barra';
  b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:950;' +
    'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border-radius:14px;' +
    'background:var(--card,#fff);border:1px solid var(--border);box-shadow:0 8px 24px rgba(0,0,0,.18);max-width:560px;margin:0 auto';
  b.innerHTML = `<b style="flex:1 1 100%;font-size:15px">🧾 Cobro digital: ¿factura?</b>
    <button class="btn-primary" style="flex:1" id="fv-cf">Consumidor final</button>
    <button class="btn-secondary" style="flex:1" id="fv-cuit-b">A un CUIT</button>
    <button class="btn-secondary" id="fv-comp" title="Ticket común, sin factura">Solo ticket</button>
    <button class="btn-secondary" id="fv-no">No</button>`;
  document.body.appendChild(b);
  b.querySelector('#fv-cf').onclick = () => facturarVenta(movId, mov, null);
  b.querySelector('#fv-cuit-b').onclick = () => facturarAUnCuit(movId, mov);
  b.querySelector('#fv-comp').onclick = () => { _fvOcultarBarra(); if (typeof ofrecerComprobanteVenta === 'function') ofrecerComprobanteVenta(movId, mov); };
  b.querySelector('#fv-no').onclick = _fvOcultarBarra;
  // Si nadie contesta se va (la venta queda en "sin facturar", no se pierde)
  b._timer = setTimeout(_fvOcultarBarra, 30000);
}
function _fvOcultarBarra() {
  const b = document.getElementById('fv-barra');
  if (b) { clearTimeout(b._timer); b.remove(); }
}

// Después de cobrar: si es digital, factura; si no, el comprobante de siempre
function ofrecerDespuesDeCobrar(movId, mov) {
  if (ventaFacturable(mov)) ofrecerFacturaVenta(movId, mov);
  else if (typeof ofrecerComprobanteVenta === 'function') ofrecerComprobanteVenta(movId, mov);
}

// ── En la lista de movimientos ──
// 🧾 FC 00006-00000001 (tocás y reimprime) o ⚠️ sin facturar (tocás y factura)
function facturaBadge(m) {
  if (!ventaFacturable(m)) return '';
  const f = m.factura;
  if (f && f.estado === 'emitida') {
    return `<span class="mov-metodo-badge metodo-otro" style="cursor:pointer" title="Reimprimir la factura" onclick="event.stopPropagation();reimprimirFactura('${_fvEsc(m.id)}')">🧾 FC ${_fvNro(f.ptoVenta, f.nro)}${f.entorno && f.entorno !== 'produccion' ? ' · prueba' : ''}</span>`;
  }
  const fallo = f && f.estado === 'fallo';
  return `<span class="mov-metodo-badge metodo-otro" style="cursor:pointer;${fallo ? 'color:#dc2626' : ''}" title="${_fvEsc(fallo ? 'Falló: ' + (f.error || '') : 'Tocá para facturar')}" onclick="event.stopPropagation();facturarDesdeLista('${_fvEsc(m.id)}')">${fallo ? '⚠️ falló la factura' : '🧾 sin facturar'}</span>`;
}

function _fvMov(movId) {
  return (typeof MOVIMIENTOS !== 'undefined' ? MOVIMIENTOS : []).find(x => x.id === movId) || null;
}
function facturarDesdeLista(movId) {
  const mov = _fvMov(movId);
  if (!mov) return;
  ofrecerFacturaVenta(movId, mov);
}
async function reimprimirFactura(movId) {
  const mov = _fvMov(movId);
  if (!mov || !mov.factura) return;
  await imprimirFactura(mov, Object.assign({ importe: mov.monto }, mov.factura));
}

// ── Ventas sin facturar (de lo que está cargado en la caja) ──
function ventasSinFacturar(movs) {
  return (movs || []).filter(m => ventaFacturable(m) && !(m.factura && m.factura.estado === 'emitida'));
}
function abrirSinFacturar() {
  const lista = ventasSinFacturar(typeof MOVIMIENTOS !== 'undefined' ? MOVIMIENTOS : []);
  document.getElementById('fv-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'fv-modal';
  m.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<div style="background:var(--card,#fff);color:var(--text,#111);border-radius:14px;padding:16px;width:100%;max-width:440px;max-height:80vh;overflow:auto">
    <b style="font-size:16px">🧾 Cobros digitales sin facturar</b>
    <p style="font-size:12px;opacity:.75;margin:4px 0 10px">De lo que está cargado en la caja (el día o período que estás mirando).</p>
    ${lista.length ? lista.map(x => `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;border-top:1px solid var(--border,#ddd);padding:8px 0">
      <div style="min-width:0"><div style="font-size:14px;font-weight:600">${_fvEsc(x.descripcion || x.categoria || 'Venta')}</div>
      <div style="font-size:12px;opacity:.75">${_fvEsc(x.fecha || '')} · ${_fvEsc(x.metodoPago || '')} · ${_fvPlata(x.monto)}${x.factura && x.factura.estado === 'fallo' ? ' · ⚠️ ' + _fvEsc(x.factura.error || 'falló') : ''}</div></div>
      <button class="btn-primary" onclick="document.getElementById('fv-modal').remove();facturarDesdeLista('${_fvEsc(x.id)}')">Facturar</button></div>`).join('')
    : '<p style="padding:12px 0">✅ Está todo facturado.</p>'}
    <button class="btn-secondary" style="margin-top:10px;width:100%" onclick="document.getElementById('fv-modal').remove()">Cerrar</button>
  </div>`;
  document.body.appendChild(m);
}

// ── Datos del local en la factura (dueño) ──
async function editarDatosFactura() {
  if (typeof tpEsDueno === 'function' && !tpEsDueno()) { if (typeof toast === 'function') toast('Solo el dueño', 'error'); return; }
  const e = await _fvCargarEmisor();
  const iibb = prompt('Número de Ingresos Brutos (sale en la factura).\nEstá en tu constancia de ARBA; si sos Convenio Multilateral o exento, escribilo así:', e.iibb || '');
  if (iibb === null) return;
  const inicio = prompt('Fecha de inicio de actividades (dd/mm/aaaa).\nEstá en tu constancia de inscripción de ARCA:', e.inicio || '');
  if (inicio === null) return;
  const domicilio = prompt('Domicilio comercial que sale en la factura:', e.domicilio || '');
  if (domicilio === null) return;
  try {
    await db.collection('config').doc('facturaEmisor').set({ iibb: iibb.trim(), inicio: inicio.trim(), domicilio: domicilio.trim() }, { merge: true });
    _fvEmisor = null;
    if (typeof toast === 'function') toast('🧾 Datos de la factura guardados', 'success');
  } catch (err) {
    console.error(err);
    if (typeof toast === 'function') toast('No se pudo guardar (¿publicaste las reglas nuevas?)', 'error');
  }
}
