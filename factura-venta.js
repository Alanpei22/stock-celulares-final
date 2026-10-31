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
  const esNC = Number(f.cbteTipo) === 13;   // Nota de Crédito C (anula una factura)
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
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esNC ? 'Nota de Crédito C' : 'Factura C'} ${_fvNro(f.ptoVenta, f.nro)}</title>
<style>
@page{size:58mm 260mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;color:#000;background:#fff;width:58mm;padding:0 5mm}
/* El final: la cuchilla de la XPrinter corta más arriba que el cabezal y
   cortaba pegado al QR (Alan, 30/10). Con margen en blanco no alcanzó: el
   driver se saltea las líneas vacías del final. Por eso termina en una
   marca chiquita (.fin) 18mm más abajo: para llegar a imprimirla, la
   impresora tiene que avanzar el papel. */
.tkt{width:48mm;padding:3mm 0 3mm;font-size:12px;line-height:1.35;font-weight:600}
.fin{margin-top:18mm;text-align:center;font-size:10px;letter-spacing:3px}
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
  <div class="c tipo">${esNC ? 'NOTA DE CRÉDITO C' : 'FACTURA C'}</div>
  <div class="c sm">Cód. ${esNC ? '013' : '011'}</div>
  <div class="c">N° ${_fvNro(f.ptoVenta, f.nro)}</div>
  ${esNC && f.asociado ? `<div class="c sm">Anula la Factura C N° ${_fvNro(f.asociado.ptoVenta, f.asociado.nro)}</div>` : ''}
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
  <div class="c sm" style="margin-top:1mm">¡Gracias por tu compra!</div>
  <div class="fin">· · ·</div>
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
    // No se imprime sola: muchas veces el cliente no quiere el papel (Alan:
    // "a veces solo necesito facturar"). Se pregunta, y si nadie toca nada,
    // queda facturada igual y se puede reimprimir desde la lista.
    ofrecerTicketFactura(mov, f);
    return f;
  } catch (e) {
    console.error('facturar:', e);
    if (typeof toast === 'function') toast('⚠️ Sin conexión. La venta queda en "sin facturar" para reintentar.', 'error');
    return null;
  } finally {
    _fvEnCurso = false;
  }
}

// ── Ya facturada: ¿ticket? (imprimir / WhatsApp / no) ──
function ofrecerTicketFactura(mov, f) {
  _fvOcultarBarra();
  const b = document.createElement('div');
  b.id = 'fv-barra';
  b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:950;' +
    'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border-radius:14px;' +
    'background:var(--card,#fff);border:1px solid var(--border);box-shadow:0 8px 24px rgba(0,0,0,.18);max-width:560px;margin:0 auto';
  b.innerHTML = `<b style="flex:1 1 100%;font-size:15px">✅ ${Number(f.cbteTipo) === 13 ? 'Nota de Crédito C' : 'Factura C'} ${_fvNro(f.ptoVenta, f.nro)}${f.entorno !== 'produccion' ? ' (PRUEBA)' : ''} hecha. ¿Se la das?</b>
    <button class="btn-primary" style="flex:1" id="fv-imp">🖨️ Imprimir</button>
    <button class="btn-secondary" style="flex:1" id="fv-wa">🟢 WhatsApp</button>
    <button class="btn-secondary" id="fv-listo">No, listo</button>`;
  document.body.appendChild(b);
  b.querySelector('#fv-imp').onclick = () => { _fvOcultarBarra(); imprimirFactura(mov, f); };
  b.querySelector('#fv-wa').onclick = () => { _fvOcultarBarra(); whatsappFactura(mov, f); };
  b.querySelector('#fv-listo').onclick = _fvOcultarBarra;
  b._timer = setTimeout(_fvOcultarBarra, 20000);
}

// El texto para mandar por WhatsApp, con el link de ARCA para verificarla
// (el mismo que tiene el QR del ticket)
function textoFacturaWa(mov, f) {
  const biz = (typeof window !== 'undefined' && window._DAKI_NAME) || 'TechPoint';
  const qrUrl = 'https://www.afip.gob.ar/fe/qr/?p=' + btoa(JSON.stringify(f.qr || {}));
  const fecha = (f.qr && f.qr.fecha) ? f.qr.fecha.split('-').reverse().join('/') : '';
  return [
    `*${biz}* — ${Number(f.cbteTipo) === 13 ? 'Nota de Crédito C' : 'Factura C'} N° ${_fvNro(f.ptoVenta, f.nro)}`,
    Number(f.cbteTipo) === 13 && f.asociado ? `Anula la Factura C N° ${_fvNro(f.asociado.ptoVenta, f.asociado.nro)}` : '',
    fecha ? 'Fecha: ' + fecha : '',
    `Total: *${_fvPlata(f.importe != null ? f.importe : mov.monto)}*`,
    `CAE: ${f.cae} (vence ${String(f.caeVto || '').split('-').reverse().join('/')})`,
    f.entorno && f.entorno !== 'produccion' ? '_PRUEBA — sin validez fiscal_' : '',
    '',
    'Verificala en ARCA: ' + qrUrl,
    '',
    '¡Gracias por tu compra!',
  ].filter((x, i, a) => x !== '' || (a[i - 1] !== '' && i > 0)).join('\n');
}
function whatsappFactura(mov, f) {
  let tel = String(mov.clienteTel || '').replace(/\D/g, '');
  if (!tel) {
    const r = prompt('WhatsApp del cliente (con código de área, sin 0 ni 15):', '');
    if (r === null) return;
    tel = String(r).replace(/\D/g, '');
    if (tel.length < 8) { if (typeof toast === 'function') toast('Ese número no parece un celular', 'error'); return; }
  }
  if (!tel.startsWith('54')) tel = '549' + tel;
  const url = 'https://wa.me/' + tel + '?text=' + encodeURIComponent(textoFacturaWa(mov, f));
  if (typeof waAbrir === 'function') waAbrir(url); else window.open(url, '_blank');
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
    const anul = f.anulada && f.anulada.cae;
    return `<span class="mov-metodo-badge metodo-otro" style="cursor:pointer;${anul ? 'text-decoration:line-through;opacity:.75' : ''}" title="${anul ? 'Anulada con nota de crédito' : 'Reimprimir, mandar o anular'}" onclick="event.stopPropagation();menuFactura('${_fvEsc(m.id)}')">🧾 FC ${_fvNro(f.ptoVenta, f.nro)}${f.entorno && f.entorno !== 'produccion' ? ' · prueba' : ''}${anul ? ' · anulada' : ''}</span>`;
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
async function reimprimirNotaCredito(movId) {
  const mov = _fvMov(movId);
  const f = mov && mov.factura;
  if (!f || !f.anulada) return;
  await imprimirFactura(mov, Object.assign({ importe: mov.monto, receptor: f.receptor, asociado: { ptoVenta: f.ptoVenta, nro: f.nro } }, f.anulada));
}
function whatsappFacturaDe(movId) {
  const mov = _fvMov(movId);
  if (mov && mov.factura) whatsappFactura(mov, Object.assign({ importe: mov.monto }, mov.factura));
}

// ── Tocar la factura en la lista: qué hacer con ella ──
function _fvCerrarModal() { const x = document.getElementById('fv-modal'); if (x) x.remove(); }
function menuFactura(movId) {
  const mov = _fvMov(movId);
  const f = mov && mov.factura;
  if (!f || f.estado !== 'emitida') return;
  const anul = f.anulada && f.anulada.cae;
  const dueno = typeof tpEsDueno !== 'function' || tpEsDueno();
  _fvCerrarModal();
  const m = document.createElement('div');
  m.id = 'fv-modal';
  m.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
  const id = _fvEsc(movId);
  const btn = (txt, fn, rojo) => `<button class="btn-secondary" style="width:100%;margin-top:8px${rojo ? ';color:#dc2626' : ''}" onclick="_fvCerrarModal();${fn}('${id}')">${txt}</button>`;
  m.innerHTML = `<div style="background:var(--card,#fff);color:var(--text,#111);border-radius:14px;padding:16px;width:100%;max-width:360px">
    <b style="font-size:16px">🧾 Factura C ${_fvNro(f.ptoVenta, f.nro)}</b>
    <div style="font-size:13px;opacity:.8;margin-top:4px">${_fvPlata(mov.monto)} · CAE ${_fvEsc(f.cae || '')}${anul ? `<br><b style="color:#dc2626">Anulada con la Nota de Crédito C ${_fvNro(f.anulada.ptoVenta, f.anulada.nro)}</b>` : ''}</div>
    ${btn('🖨️ Reimprimir la factura', 'reimprimirFactura')}
    ${btn('🟢 Mandarla por WhatsApp', 'whatsappFacturaDe')}
    ${anul ? btn('🖨️ Reimprimir la nota de crédito', 'reimprimirNotaCredito') : ''}
    ${!anul && dueno ? btn('❌ Anular (nota de crédito)', 'anularFacturaVenta', true) : ''}
    <button class="btn-secondary" style="width:100%;margin-top:12px" onclick="_fvCerrarModal()">Cerrar</button>
  </div>`;
  document.body.appendChild(m);
}

// ── Anular: Nota de Crédito C por el mismo importe ──
// Una factura con CAE no se borra: se anula ante ARCA con una nota de
// crédito. Es definitivo, por eso se confirma y es solo del dueño (el
// servidor también lo exige).
let _fvAnulando = false;
async function anularFacturaVenta(movId) {
  const mov = _fvMov(movId);
  const f = mov && mov.factura;
  if (!f || f.estado !== 'emitida' || _fvAnulando) return null;
  if (!confirm(`¿Anular la Factura C ${_fvNro(f.ptoVenta, f.nro)} por ${_fvPlata(mov.monto)}?\n\nSe hace una NOTA DE CRÉDITO C por el mismo importe ante ARCA. Es definitivo.\n\nUsalo si el cliente devolvió lo que compró o si la factura salió mal (después podés facturar de nuevo la venta corregida).`)) return null;
  _fvAnulando = true;
  if (typeof toast === 'function') toast('🧾 Pidiendo la nota de crédito a ARCA…', 'info');
  try {
    const res = await apiFetch('/api/factura', { method: 'POST', body: JSON.stringify({ action: 'anular', movId }) });
    let out = {};
    try { out = await res.json(); } catch {}
    if (!res.ok || !out.notaCredito) {
      if (typeof toast === 'function') toast('⚠️ No se pudo anular: ' + (out.error || 'error ' + res.status), 'error');
      return null;
    }
    const nc = out.notaCredito;
    if (typeof toast === 'function') toast(`✅ Factura anulada: Nota de Crédito C ${_fvNro(nc.ptoVenta, nc.nro)}`, 'success');
    // ¿Se la das? (igual que la factura: no se imprime sola)
    ofrecerTicketFactura(mov, Object.assign({ importe: mov.monto, receptor: f.receptor, asociado: { ptoVenta: f.ptoVenta, nro: f.nro } }, nc));
    return nc;
  } catch (e) {
    console.error('anular:', e);
    if (typeof toast === 'function') toast('⚠️ Sin conexión: no se anuló. Probá de nuevo.', 'error');
    return null;
  } finally {
    _fvAnulando = false;
  }
}

// ¿Esta venta tiene una factura viva (sin anular)? La caja no deja borrarla:
// la venta desaparecería de la app pero la factura seguiría en ARCA.
function ventaConFacturaViva(mov) {
  const f = mov && mov.factura;
  return !!(f && f.estado === 'emitida' && f.entorno === 'produccion' && !(f.anulada && f.anulada.cae));
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

// ══════════════════════════════════════════════════════════════
//  📊 Cuánto se facturó (y el tope de la categoría del monotributo)
// ══════════════════════════════════════════════════════════════
// El servidor lleva el total de cada mes en config/facturacionTotales (cada
// factura suma, cada nota de crédito resta; solo las reales). Leerlo es UNA
// lectura. El tope de la categoría lo carga el dueño (cambia dos veces por
// año y depende de la categoría): queda en config/facturaEmisor.topeAnual.
// Ojo: cuenta lo facturado DESDE LA APP; lo de antes (web de ARCA, otro
// sistema) no está.

// "2026-10" → los 12 meses que terminan en ese (para el tope anual)
function fvUltimos12(ym) {
  let [a, m] = String(ym).split('-').map(Number);
  const out = [];
  for (let i = 0; i < 12; i++) {
    out.push(`${a}-${String(m).padStart(2, '0')}`);
    m--; if (m === 0) { m = 12; a--; }
  }
  return out;
}
// { meses: { 'AAAA-MM': total } } + mes → los números del panel (pura)
function fvResumenFacturado(totales, ym, topeAnual) {
  const meses = (totales && totales.meses) || {};
  const v = k => Math.round((Number(meses[k]) || 0) * 100) / 100;
  const doce = fvUltimos12(ym);
  const anio = doce.reduce((t, k) => t + v(k), 0);
  const tope = Number(topeAnual) || 0;
  return { mes: v(ym), anterior: v(doce[1]), anio, tope, pct: tope ? Math.round(anio / tope * 1000) / 10 : null };
}

async function abrirFacturado() {
  if (typeof tpEsDueno === 'function' && !tpEsDueno()) { if (typeof toast === 'function') toast('Solo el dueño', 'error'); return; }
  const ym = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
  let tot = {}, emisor = {};
  try {
    const [a, b] = await Promise.all([db.collection('config').doc('facturacionTotales').get(), db.collection('config').doc('facturaEmisor').get()]);
    tot = a.exists ? a.data() : {};
    emisor = b.exists ? b.data() : {};
  } catch (e) { console.error(e); }
  const r = fvResumenFacturado(tot, ym, emisor.topeAnual);
  const color = r.pct == null ? '#64748b' : r.pct >= 90 ? '#dc2626' : r.pct >= 80 ? '#d97706' : '#16a34a';
  _fvCerrarModal();
  const m = document.createElement('div');
  m.id = 'fv-modal';
  m.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
  const fila = (t, v, fuerte) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border,#ddd)"><span>${t}</span><b style="${fuerte ? 'font-size:17px' : ''}">${v}</b></div>`;
  m.innerHTML = `<div style="background:var(--card,#fff);color:var(--text,#111);border-radius:14px;padding:16px;width:100%;max-width:400px">
    <b style="font-size:16px">📊 Facturado (Factura C)</b>
    <div style="font-size:12px;opacity:.75;margin:4px 0 8px">Solo lo facturado desde la app. Las notas de crédito ya están restadas.</div>
    ${fila('Este mes', _fvPlata(r.mes), true)}
    ${fila('Mes anterior', _fvPlata(r.anterior))}
    ${fila('Últimos 12 meses', _fvPlata(r.anio), true)}
    ${fila('Tope de tu categoría (anual)', r.tope ? _fvPlata(r.tope) : '<span style="opacity:.7">sin cargar</span>')}
    ${r.pct != null ? `<div style="margin-top:8px;background:var(--bg2,#eee);border-radius:999px;height:12px;overflow:hidden"><div style="height:100%;width:${Math.min(100, r.pct)}%;background:${color}"></div></div>
      <div style="text-align:right;font-weight:700;color:${color};margin-top:4px">${r.pct}% del tope${r.pct >= 80 ? ' · hablalo con el contador' : ''}</div>` : ''}
    <button class="btn-secondary" style="width:100%;margin-top:12px" onclick="_fvCerrarModal();cambiarTopeFacturacion()">${r.tope ? 'Cambiar' : 'Cargar'} el tope de la categoría</button>
    <button class="btn-secondary" style="width:100%;margin-top:8px" onclick="_fvCerrarModal();recalcularFacturado()">Recalcular este mes</button>
    <button class="btn-secondary" style="width:100%;margin-top:8px" onclick="_fvCerrarModal()">Cerrar</button>
  </div>`;
  document.body.appendChild(m);
}

async function cambiarTopeFacturacion() {
  const e = await _fvCargarEmisor();
  const r = prompt('Tope de ingresos ANUAL de tu categoría de monotributo, en pesos (sin puntos).\n\nEstá en la página de ARCA de monotributo, o te lo dice el contador. Cambia dos veces por año: acordate de actualizarlo.', e.topeAnual || '');
  if (r === null) return;
  const n = Number(String(r).replace(/[^\d]/g, ''));
  if (!(n > 0)) { if (typeof toast === 'function') toast('Escribí un número', 'error'); return; }
  try {
    await db.collection('config').doc('facturaEmisor').set({ topeAnual: n }, { merge: true });
    _fvEmisor = null;
    if (typeof toast === 'function') toast('📊 Tope guardado: ' + _fvPlata(n), 'success');
    abrirFacturado();
  } catch (err) { console.error(err); if (typeof toast === 'function') toast('No se pudo guardar (¿publicaste las reglas?)', 'error'); }
}

// Para las facturas hechas antes de que existiera el total del mes
async function recalcularFacturado() {
  try {
    const res = await apiFetch('/api/factura', { method: 'POST', body: JSON.stringify({ action: 'recalcular' }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'error ' + res.status);
    if (typeof toast === 'function') toast(`📊 ${out.mes}: ${_fvPlata(out.total)} (${out.comprobantes} comprobantes)`, 'success');
    abrirFacturado();
  } catch (e) { if (typeof toast === 'function') toast('No se pudo recalcular: ' + e.message, 'error'); }
}
