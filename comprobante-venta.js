// ══════════════════════════════════════════════════════════════
//  comprobante-venta.js — Ticket de venta (58mm, no fiscal)
//  ─────────────────────────────────────────────────────────────
//  Al confirmar una venta en la caja aparece abajo "¿Comprobante?" con
//  Imprimir / WhatsApp / No. Se pregunta y no sale solo: muchos clientes no
//  lo quieren y el rollo cuesta plata.
//
//  Es un COMPROBANTE, no una factura: lleva "Documento no válido como
//  factura". La factura electrónica (ARCA) es otra cosa y va aparte (ver
//  tools/factura-arca.md).
//
//  El número sale de un contador propio (config/ventasMeta.nextComprobante) y
//  se le asigna a la venta recién cuando se pide el comprobante: una venta sin
//  comprobante no gasta número, y reimprimir uno ya numerado no lo cambia.
//
//  Se imprime en la impresora de tickets de QZ Tray (🖨️ Impresión directa →
//  tickets). Sin QZ, por el diálogo de Chrome, con la página del largo justo.
// ══════════════════════════════════════════════════════════════
'use strict';

function _cvEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _cvPlata(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR'); }
function _cvNro(n) { return String(n).padStart(6, '0'); }

// Los renglones del ticket: los productos del carrito, o la venta suelta como
// un solo renglón (una venta cargada a mano no tiene items).
function _cvRenglones(mov) {
  const items = Array.isArray(mov.items) ? mov.items : [];
  const r = items.map(it => {
    const qty = Math.max(1, Number(it.qty) || 1);
    const unit = Number(it.precioUnit) || 0;
    return { nombre: it.nombre || 'Artículo', qty, unit, total: qty * unit };
  });
  // Venta mixta: la parte de la reparación también va escrita.
  const rep = Number(mov.montoReparacion) || 0;
  if (rep > 0) r.unshift({ nombre: 'Reparación' + (mov.repairNOrden ? ' N°' + mov.repairNOrden : ''), qty: 1, unit: rep, total: rep });
  if (!r.length) r.push({ nombre: mov.descripcion || mov.categoria || 'Venta', qty: 1, unit: Number(mov.monto) || 0, total: Number(mov.monto) || 0 });
  return r;
}

function _cvFechaHora(mov) {
  const d = mov.createdAt ? new Date(mov.createdAt) : new Date();
  const f = isNaN(d) ? new Date() : d;
  const tz = { timeZone: 'America/Argentina/Buenos_Aires' };
  return f.toLocaleDateString('es-AR', { ...tz, day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
         f.toLocaleTimeString('es-AR', { ...tz, hour: '2-digit', minute: '2-digit' });
}

// El ticket, como página para imprimir. 48mm útiles del rollo de 58.
function ticketVentaHtml(mov, nro) {
  const biz = (typeof window !== 'undefined' && window._DAKI_NAME) || 'TechPoint';
  const bd = (typeof BIZ_DATA !== 'undefined' && BIZ_DATA) || {};
  const renglones = _cvRenglones(mov);
  const total = Number(mov.monto) || renglones.reduce((s, r) => s + r.total, 0);
  const pagos = [];
  if (mov.metodoPago2 && Number(mov.monto2) > 0) {
    pagos.push([mov.metodoPago, total - Number(mov.monto2)], [mov.metodoPago2, Number(mov.monto2)]);
  } else {
    pagos.push([mov.metodoPago || 'Efectivo', total]);
  }
  const usd = mov.metodoPago === 'Dólares' && Number(mov.montoUSD) > 0 ? ` (u$${mov.montoUSD})` : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Comprobante ${_cvEsc(nro)}</title>
<style>
@page{size:58mm 200mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;color:#000;background:#fff;width:58mm;padding:0 5mm}
.tkt{width:48mm;padding:2mm 0 6mm;font-size:10px;line-height:1.3}
.c{text-align:center}
.biz{font-size:15px;font-weight:800;letter-spacing:.3px}
.sm{font-size:9px}
.sep{border-top:1px dashed #000;margin:1.6mm 0}
.tit{font-weight:800;font-size:10.5px;margin-top:1mm}
.nofis{font-size:8.5px;font-weight:700;margin-top:.5mm}
.r{display:flex;justify-content:space-between;gap:1.5mm}
.r span:first-child{flex:1;min-width:0;word-break:break-word}
.r span:last-child{white-space:nowrap}
.qty{font-size:9px}
.tot{font-size:14px;font-weight:800}
</style></head><body>
<div class="tkt">
  <div class="c biz">${_cvEsc(String(biz).toUpperCase())}</div>
  ${bd.dir ? `<div class="c sm">${_cvEsc(bd.dir)}</div>` : ''}
  ${bd.tel ? `<div class="c sm">Tel. ${_cvEsc(bd.tel)}</div>` : ''}
  <div class="sep"></div>
  <div class="c tit">COMPROBANTE DE VENTA<br>N° ${_cvEsc(nro)}</div>
  <div class="c nofis">DOCUMENTO NO VÁLIDO COMO FACTURA</div>
  <div class="c sm">${_cvEsc(_cvFechaHora(mov))}</div>
  <div class="sep"></div>
  ${renglones.map(r => `<div class="r"><span>${_cvEsc(r.nombre)}</span><span>${_cvPlata(r.total)}</span></div>
  ${r.qty > 1 ? `<div class="qty">  ${r.qty} x ${_cvPlata(r.unit)}</div>` : ''}`).join('')}
  <div class="sep"></div>
  <div class="r tot"><span>TOTAL</span><span>${_cvPlata(total)}</span></div>
  ${pagos.map(([m, v]) => `<div class="r sm"><span>${_cvEsc(m)}${pagos.length === 1 ? usd : ''}</span><span>${_cvPlata(v)}</span></div>`).join('')}
  ${mov.clienteNombre || mov.clienteTel ? `<div class="sep"></div><div class="sm">Cliente: ${_cvEsc([mov.clienteNombre, mov.clienteTel].filter(Boolean).join(' · '))}</div>` : ''}
  ${mov.vendedor ? `<div class="sm">Atendió: ${_cvEsc(mov.vendedor)}</div>` : ''}
  ${bd.extra ? `<div class="sep"></div><div class="c sm">${_cvEsc(bd.extra)}</div>` : ''}
  <div class="sep"></div>
  <div class="c sm">¡Gracias por tu compra!</div>
</div>
<script>
// El rollo es continuo: la página mide lo que mide el ticket. Si no, Chrome
// tira 200mm de papel en blanco (o lo corta en dos).
(function(){var mm=96/25.4,h=Math.ceil(document.querySelector('.tkt').getBoundingClientRect().height/mm)+2;
var s=document.createElement('style');s.textContent='@page{size:58mm '+h+'mm;margin:0}';document.head.appendChild(s);})();
</script>
</body></html>`;
}

// El texto para WhatsApp: lo mismo que el ticket, en renglones.
function ticketVentaTexto(mov, nro) {
  const biz = (typeof window !== 'undefined' && window._DAKI_NAME) || 'TechPoint';
  const renglones = _cvRenglones(mov);
  const total = Number(mov.monto) || renglones.reduce((s, r) => s + r.total, 0);
  return [
    `*${biz}* — Comprobante de venta N° ${nro}`,
    _cvFechaHora(mov),
    '',
    ...renglones.map(r => `• ${r.qty > 1 ? r.qty + ' x ' : ''}${r.nombre}: ${_cvPlata(r.total)}`),
    '',
    `*Total: ${_cvPlata(total)}* (${mov.metodoPago || 'Efectivo'}${mov.metodoPago2 ? ' + ' + mov.metodoPago2 : ''})`,
    '',
    '_Documento no válido como factura._',
    '¡Gracias por tu compra!',
  ].join('\n');
}

// ── Número ──────────────────────────────────────────────────
// Se asigna una sola vez por venta, en una transacción: dos cajas pidiendo a
// la vez no reciben el mismo número.
async function _cvNumero(movId) {
  const movRef = db.collection('caja_movimientos').doc(movId);
  const metaRef = db.collection('config').doc('ventasMeta');
  let nro = null;
  await db.runTransaction(async t => {
    const mov = await t.get(movRef);
    const ya = mov.exists && mov.data().comprobanteNro;
    if (ya) { nro = ya; return; }
    const meta = await t.get(metaRef);
    const n = meta.exists ? (Number(meta.data().nextComprobante) || 1) : 1;
    nro = _cvNro(n);
    t.set(metaRef, { nextComprobante: n + 1 }, { merge: true });
    t.update(movRef, { comprobanteNro: nro });
  });
  return nro;
}

function _cvMov(movId) {
  return (typeof MOVIMIENTOS !== 'undefined' ? MOVIMIENTOS : []).find(m => m.id === movId) || null;
}

// ── Imprimir / WhatsApp ─────────────────────────────────────
async function imprimirComprobanteVenta(movId, movDatos) {
  _cvOcultarBarra();
  const mov = movDatos || _cvMov(movId);
  if (!mov) { toast('No encontré esa venta', 'error'); return; }
  let nro;
  try { nro = await _cvNumero(movId); }
  catch (e) { console.error('comprobante:', e); toast('No se pudo numerar el comprobante (¿sin conexión?)', 'error'); return; }
  const html = ticketVentaHtml(mov, nro);
  // Por QZ Tray sale directo; si no, por el diálogo (en iframe: después de
  // esperar el número, una ventana nueva la bloquearía el navegador).
  const directo = typeof _imprimirDirecto === 'function' ? await _imprimirDirecto('ticket', html) : false;
  if (!directo && typeof _imprimirEnIframe === 'function') await _imprimirEnIframe(html);
}

async function whatsappComprobanteVenta(movId, movDatos) {
  _cvOcultarBarra();
  const mov = movDatos || _cvMov(movId);
  if (!mov) { toast('No encontré esa venta', 'error'); return; }
  let tel = String(mov.clienteTel || '').replace(/\D/g, '');
  if (!tel) {
    const r = prompt('WhatsApp del cliente (con código de área, sin 0 ni 15):', '');
    if (r === null) return;
    tel = String(r).replace(/\D/g, '');
    if (tel.length < 8) { toast('Ese número no parece un celular', 'error'); return; }
  }
  if (!tel.startsWith('54')) tel = '549' + tel;
  // La ventana se abre YA, en el toque, y se le pone la dirección cuando está
  // el número: si se abre después de esperar, el navegador la bloquea.
  const w = window.open('', '_blank');
  let nro;
  try { nro = await _cvNumero(movId); }
  catch (e) { if (w) w.close(); toast('No se pudo numerar el comprobante (¿sin conexión?)', 'error'); return; }
  const url = 'https://wa.me/' + tel + '?text=' + encodeURIComponent(ticketVentaTexto(mov, nro));
  if (w) w.location.href = url; else location.href = url;
}

// ── La pregunta, después de cobrar ──────────────────────────
function ofrecerComprobanteVenta(movId, movDatos) {
  _cvOcultarBarra();
  const b = document.createElement('div');
  b.id = 'cv-barra';
  b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:950;' +
    'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border-radius:14px;' +
    'background:var(--card,#fff);border:1px solid var(--border);box-shadow:0 8px 24px rgba(0,0,0,.18);max-width:520px;margin:0 auto';
  b.innerHTML = `<b style="flex:1 1 100%;font-size:15px">🧾 ¿Comprobante para el cliente?</b>
    <button class="btn-primary" style="flex:1" id="cv-imp">🖨️ Imprimir</button>
    <button class="btn-secondary" style="flex:1" id="cv-wa">🟢 WhatsApp</button>
    <button class="btn-secondary" id="cv-no">No</button>`;
  document.body.appendChild(b);
  b.querySelector('#cv-imp').onclick = () => imprimirComprobanteVenta(movId, movDatos);
  b.querySelector('#cv-wa').onclick = () => whatsappComprobanteVenta(movId, movDatos);
  b.querySelector('#cv-no').onclick = _cvOcultarBarra;
  // Si nadie contesta, se va sola: la próxima venta no puede tenerla tapando.
  b._timer = setTimeout(_cvOcultarBarra, 20000);
}

function _cvOcultarBarra() {
  const b = document.getElementById('cv-barra');
  if (b) { clearTimeout(b._timer); b.remove(); }
}
