// ══════════════════════════════════════════
//  print.js — TechPoint (SCF)
//  Impresión de órdenes de reparación y comprobantes de retiro
//  Formatos: ticket 80mm (térmico) y hoja A4
//  Cada impresión incluye ORIGINAL + COPIA
// ══════════════════════════════════════════
'use strict';

// ── Helpers internos ─────────────────────────────────────────
function _pr(v)    { return (v !== undefined && v !== null && v !== '') ? v : '—'; }
function _prMoney(v) {
  const n = Number(v) || 0;
  return '$' + n.toLocaleString('es-AR');
}
function _prDate(str) {
  if (!str) return '—';
  try { const [y, m, d] = str.split('-'); return `${d}/${m}/${y}`; }
  catch { return str; }
}
function _prSaldo(rep) {
  return Math.max(0, (Number(rep.monto) || 0) - (Number(rep.sena) || 0));
}
// Acepta accesorios como array (SCF) o string (DAKI)
function _prAccs(v) {
  if (!v) return '';
  if (Array.isArray(v)) {
    const map = { cargador:'🔌 Cargador', funda:'🛡️ Funda', caja:'📦 Caja', auriculares:'🎧 Auriculares' };
    return v.map(a => map[a] || a).join(', ');
  }
  return String(v);
}
function _today() {
  return new Date().toLocaleDateString('es-AR', { timeZone:'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric' });
}
// Calcula fecha fin de garantía desde hoy
function _garantiaFin(dias) {
  const n = Number(dias) || 0;
  if (!n) return null;
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('es-AR', { timeZone:'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric' });
}

// ── Abrir ventana de impresión (un solo trabajo) ─────────────
function _openPrint(html, title) {
  const w = window.open('', '_blank', 'width=520,height=720,scrollbars=yes');
  if (!w) {
    alert('Habilitá los popups para imprimir.\nAjustes del navegador → Permitir popups de este sitio.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.addEventListener('load', () => { w.focus(); setTimeout(() => w.print(), 350); });
}

// ── Punto de entrada — Ticket de ingreso ─────────────────────
// El comprobante de RECEPCIÓN se imprime siempre en A5: es el único formato
// que quedó (se sacaron A4, 80mm y BT del menú). El parámetro se mantiene por
// compatibilidad con las llamadas que ya existían.
function printRepair(format) {
  const rep = window._printRep;
  if (!rep) return;
  // Asegurar el doc de seguimiento público (para que el QR funcione,
  // también en reparaciones viejas que se reimprimen)
  if (typeof upsertSeguimientoPublico === 'function') upsertSeguimientoPublico(rep);
  _openPrint(_buildA5(rep));
}

// ══════════════════════════════════════════
//  VENTA DE EQUIPO — ficha imprimible (Stock)
// ══════════════════════════════════════════
// ╔══════════════════════════════════════════════════════════════╗
// ║  HOJA A5 — VENTA DE EQUIPO  (original para el cliente +      ║
// ║  copia para el negocio, una hoja cada uno)                   ║
// ╚══════════════════════════════════════════════════════════════╝
const _CSS_VENTA_A5 = `
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A5 portrait;margin:7mm}
body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:9px;line-height:1.35;color:#000;background:#fff}
/* El corte va ENTRE hojas, nunca después de la última (si no sale una en blanco) */
.tk{page-break-after:auto}
.tk + .tk{page-break-before:always}
.vhd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.6px solid #000;padding-bottom:4px;margin-bottom:5px}
.vshop{font-size:17px;font-weight:800;letter-spacing:-.4px}
.vsub{font-size:7.6px;text-transform:uppercase;letter-spacing:.09em}
.vbiz{font-size:8.4px;font-weight:600;margin-top:2px}
.vhd-r{text-align:right}
.vtit{font-size:11px;font-weight:800;border:1.4px solid #000;padding:2px 7px;display:inline-block}
.vcopia{font-size:8px;text-transform:uppercase;letter-spacing:.14em;margin-top:3px;font-weight:800}
.vmeta{display:flex;gap:12px;flex-wrap:wrap;font-size:8.4px;border-bottom:.6px solid #000;padding-bottom:4px;margin-bottom:5px}
.vbox{border:.8px solid #000;padding:4px 7px;margin-bottom:5px}
.vbox-t{font-size:7.2px;font-weight:800;text-transform:uppercase;letter-spacing:.11em;border-bottom:.5px solid #000;padding-bottom:2px;margin-bottom:3px}
.veq{font-size:13px;font-weight:800;margin-bottom:2px}
.vgrid{display:grid;grid-template-columns:1fr 1fr;gap:1px 10px}
.vf{display:flex;justify-content:space-between;gap:6px;font-size:8.6px}
.vf b{font-weight:700;text-align:right}
.vf2{font-size:8.4px;margin-top:1.5px;word-break:break-word}
.vf2 span{font-weight:700}
.vnro{font-size:8.6px;font-weight:800;margin-top:2px}
.vimei{font-family:'Courier New',monospace;font-size:9px;letter-spacing:-.2px}
.vtot{width:100%;border-collapse:collapse;margin-bottom:5px}
.vtot td{border:.8px solid #000;padding:2.5px 7px}
.vtot .a{text-align:right;font-weight:700;width:36%}
.vtot .hl td{font-weight:800;font-size:11px;border-width:1.5px}
.vgar{border:1.3px solid #000;padding:3px 7px;margin-bottom:5px}
.vgar-t{font-size:9.6px;font-weight:800}
.vgar-s{font-size:7.6px;margin-top:1px}
.vcond{border:.7px solid #000;padding:3px 7px;margin-bottom:5px}
.vcond-c{column-count:2;column-gap:8px;font-size:6.2px;line-height:1.3;text-align:justify}
.vcond-c p{margin-bottom:1.6px;break-inside:avoid}
.vfir{border:1.2px solid #000;padding:4px 7px;display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end}
.vfir-c{text-align:center;font-size:7px}
.vfir-sp{height:13mm}
.vfir-c .ln{border-top:.8px solid #000;margin-bottom:2px}
.vfir-n{font-weight:700;margin-top:1px}
.vqr{text-align:center;line-height:1.1}
.vqr svg{width:19mm;height:19mm;display:block;margin:0 auto}
.vqr span{font-size:5.8px;font-weight:700;display:block;margin-top:1px}
.vpie{text-align:center;font-size:7.6px;margin-top:4px}
@media screen{body{width:134mm;margin:0 auto}}
@media print{body{-webkit-print-color-adjust:economy;print-color-adjust:economy}}`;

// Sí / No / nada. Los tildes del formulario llegan como true, false o
// undefined: si no se contestó, el renglón no se imprime.
function _prSiNo(v) {
  if (v === true  || v === 'si' || v === 'sí' || v === 'Sí') return 'Sí';
  if (v === false || v === 'no' || v === 'No') return 'No';
  return null;
}
// Lista (accesorios, funciones probadas) como array o como texto ya armado.
function _prLista(v) {
  if (!v) return '';
  if (Array.isArray(v)) return v.filter(Boolean).join(' · ');
  return String(v);
}

function _ventaA5Body(d, label) {
  const p = d.p;
  // TODO el detalle del equipo es opcional: cada renglón aparece solo si el
  // dato está cargado. Así el comprobante de una venta rápida sale corto y el
  // de un usado con todo el detalle sale completo, sin renglones en "—".
  const libre   = _prSiNo(p.libre);
  const cuentas = _prSiNo(p.cuentas);
  const filas = [
    p.estado ? ['Condición', p.estado] : null,
    p.estetico ? ['Estado estético', p.estetico] : null,
    p.almacenamiento ? ['Almacenamiento', p.almacenamiento] : null,
    p.ram ? ['RAM', p.ram] : null,
    p.bateria ? ['Batería', p.bateria + '%'] : null,
    p.ciclos ? ['Ciclos de batería', p.ciclos] : null,
    p.color ? ['Color', p.color] : null,
    libre   ? ['Libre de fábrica', libre] : null,
    cuentas ? ['iCloud / Google removido', cuentas] : null,
  ].filter(Boolean);

  // Comprador. Campos nuevos: las ventas viejas no los tienen y el
  // comprobante les sale igual que siempre, sin el recuadro.
  const cli = [
    p.clienteNombre ? ['Nombre', p.clienteNombre] : null,
    p.clienteDni    ? ['DNI', p.clienteDni]       : null,
    p.clienteTel    ? ['Teléfono', p.clienteTel]  : null,
  ].filter(Boolean);

  const accs    = _prLista(p.accesorios);
  const pruebas = _prLista(p.pruebas);
  // Permuta: el equipo que se toma en parte de pago. Va en la tabla de
  // totales para que se lea de dónde sale el número final.
  const permutaVal = Number(p.permutaValor) || 0;
  const saldoAb    = Number(p.saldoAbonado) || 0;

  return `
<div class="tk">
  <div class="vhd">
    <div>
      <div class="vshop">${d.businessName.toUpperCase()}</div>
      <div class="vsub">Venta de equipos · servicio técnico</div>
      ${_bizLinea() ? `<div class="vbiz">${_bizLinea()}</div>` : ''}
    </div>
    <div class="vhd-r">
      <div class="vtit">COMPROBANTE DE VENTA</div>
      ${p.comprobanteNro ? `<div class="vnro">N° ${_pr(p.comprobanteNro)}</div>` : ''}
      <div class="vcopia">${label}</div>
    </div>
  </div>

  <div class="vmeta">
    <span><b>Fecha:</b> ${d.fechaVenta}${d.horaVenta ? ' · ' + d.horaVenta : ''}</span>
    ${p.vendedor ? `<span><b>Vendedor:</b> ${_pr(p.vendedor)}</span>` : ''}
  </div>

  ${cli.length ? `
  <div class="vbox">
    <div class="vbox-t">Comprador</div>
    <div class="vgrid">
      ${cli.map(([k, v]) => `<div class="vf"><span>${k}</span><b>${_pr(v)}</b></div>`).join('')}
    </div>
  </div>` : ''}

  <div class="vbox">
    <div class="vbox-t">Equipo</div>
    <div class="veq">${_pr(p.marca)} ${_pr(p.modelo)}</div>
    ${p.imei  ? `<div class="vf"><span>IMEI 1</span><b class="vimei">${_pr(p.imei)}</b></div>` : ''}
    ${p.imei2 ? `<div class="vf"><span>IMEI 2 / eSIM</span><b class="vimei">${_pr(p.imei2)}</b></div>` : ''}
    ${p.serie ? `<div class="vf"><span>N° de serie</span><b class="vimei">${_pr(p.serie)}</b></div>` : ''}
    <div class="vgrid">
      ${filas.map(([k, v]) => `<div class="vf"><span>${k}</span><b>${_pr(v)}</b></div>`).join('')}
    </div>
    ${accs ? `<div class="vf2"><span>Accesorios incluidos:</span> ${accs}</div>` : ''}
    ${pruebas ? `<div class="vf2"><span>Probado en el local:</span> ${pruebas}</div>` : ''}
    ${p.notas ? `<div class="vf2"><span>Observaciones:</span> ${_pr(p.notas)}</div>` : ''}
  </div>

  <table class="vtot">
    ${p.forma_pago ? `<tr><td class="a">Forma de pago</td><td>${_pr(p.forma_pago)}${
      Number(p.cuotas) > 1 ? ` · ${p.cuotas} cuotas` : ''}</td></tr>` : ''}
    ${p.permuta ? `<tr><td class="a">Recibido en parte de pago</td><td>${_pr(p.permuta)}</td></tr>` : ''}
    ${permutaVal > 0 ? `<tr><td class="a">Valor tomado</td><td>− ${_prMoney(permutaVal)}</td></tr>` : ''}
    <tr class="hl"><td class="a">TOTAL</td><td>${_prMoney(p.precio)}</td></tr>
    ${saldoAb > 0 ? `<tr class="hl"><td class="a">SALDO ABONADO</td><td>${_prMoney(saldoAb)}</td></tr>` : ''}
  </table>

  ${p.garantiaMeses > 0 ? `
  <div class="vgar">
    <div class="vgar-t">GARANTÍA ${p.garantiaMeses} ${p.garantiaMeses === 1 ? 'MES' : 'MESES'}${d.fGarantia ? ` · vence el ${d.fGarantia}` : ''}</div>
    <div class="vgar-s">Presentá este comprobante para hacerla válida. No cubre golpes, humedad ni mal uso.</div>
  </div>` : `
  <div class="vgar">
    <div class="vgar-t">VENTA SIN GARANTÍA</div>
    <div class="vgar-s">El comprador declara conocer y aceptar el estado del equipo.</div>
  </div>`}

  <div class="vcond">
    <div class="vbox-t">Condiciones de la venta</div>
    <div class="vcond-c">
      <p><b>1. Estado del equipo.</b> El comprador revisó y probó el equipo al momento de la compra y lo recibe en el estado descrito en este comprobante, incluidos los detalles estéticos y el porcentaje de batería informado.</p>
      <p><b>2. Garantía.</b> Cuando corresponda, cubre fallas de funcionamiento no provocadas por el uso, conforme la Ley 24.240 de Defensa del Consumidor. Se hace válida únicamente presentando este comprobante.</p>
      <p><b>3. Exclusiones.</b> No cubre golpes, caídas, contacto con líquidos o humedad, sobretensión del cargador, fallas de software o configuración, ni equipos abiertos o intervenidos por terceros.</p>
      <p><b>4. Datos y cuentas.</b> El equipo se entrega sin cuentas vinculadas y con los datos borrados. El respaldo de la información posterior a la compra queda a cargo del comprador.</p>
      ${p.permuta ? `<p><b>5. Equipo entregado en parte de pago.</b> El comprador declara ser el legítimo titular del equipo que entrega en permuta, que su procedencia es lícita y que no registra denuncia de robo o extravío, haciéndose responsable por cualquier reclamo de terceros sobre el mismo.</p>` : ''}
      <p><b>${p.permuta ? '6' : '5'}. Conformidad.</b> La firma del presente implica la aceptación del estado del equipo y de estas condiciones.</p>
    </div>
  </div>

  <div class="vfir">
    <div class="vfir-c"><div class="vfir-sp"></div><div class="ln"></div>Firma del vendedor</div>
    <div class="vfir-c"><div class="vfir-sp"></div><div class="ln"></div>Firma y aclaración del comprador${
      p.clienteNombre ? `<div class="vfir-n">${p.clienteNombre}${p.clienteDni ? ` · DNI ${p.clienteDni}` : ''}</div>` : ''
    }</div>
    ${d.qrSvgWa ? `<div class="vqr">${d.qrSvgWa}<span>Escribinos</span></div>` : ''}
  </div>

  <div class="vpie">¡Gracias por tu compra! · ${d.businessName}</div>
</div>`;
}

function _buildVentaA5(d) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Venta — ${_pr(d.p.marca)} ${_pr(d.p.modelo)}</title>
<style>${_CSS_VENTA_A5}</style></head><body>
${_ventaA5Body(d, 'Original · cliente')}
${_ventaA5Body(d, 'Copia · negocio')}
${_autofitJs(192)}
</body></html>`;
}

// formato: 'A5' (hoja, original + copia) o '80mm' (ticket térmico)
function printVentaTicket(stockId, extra, formato = 'A5') {
  // extra: datos de la venta recién hecha (aún no sincronizados en STOCK)
  let p = (typeof STOCK !== 'undefined') ? STOCK.find(x => x.id === stockId) : null;
  if (!p && extra) p = extra;
  if (!p) { alert('Equipo no encontrado'); return; }
  if (extra) p = { ...p, ...extra };
  const businessName = (typeof window !== 'undefined' && window._DAKI_NAME) || 'TechPoint';
  const fechaVenta = p.fecha_venta ? new Date(p.fecha_venta).toLocaleDateString('es-AR', { timeZone:'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric' }) : _today();
  const horaVenta = p.fecha_venta ? new Date(p.fecha_venta).toLocaleTimeString('es-AR', { timeZone:'America/Argentina/Buenos_Aires', hour:'2-digit', minute:'2-digit' }) : '';
  let fGarantia = null;
  if (p.garantiaHasta) {
    fGarantia = new Date(p.garantiaHasta).toLocaleDateString('es-AR', { timeZone:'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric' });
  } else if (p.garantiaMeses > 0) {
    const d = new Date();
    d.setMonth(d.getMonth() + p.garantiaMeses);
    fGarantia = d.toLocaleDateString('es-AR', { timeZone:'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric' });
  }

  const cfg = (typeof getConfig === 'function') ? getConfig() : null;
  const tlfNeg = cfg?.telefonoNegocio || cfg?.tlfNegocio || '';
  let waLink = '';
  if (tlfNeg) {
    const phone = String(tlfNeg).replace(/\D/g, '');
    const msg = encodeURIComponent(`Hola! Te escribo por mi compra de ${p.marca} ${p.modelo}. Garantía:`);
    waLink = `https://wa.me/${phone}?text=${msg}`;
  }
  // QR generado en la app (qr.js), no bajado de un servicio externo
  const qrSvgWa = (waLink && typeof qrSvg === 'function') ? qrSvg(waLink, 25) : '';

  // Hoja A5: una para el cliente y otra para el negocio
  if (formato === 'A5') {
    _openPrint(_buildVentaA5({ p, businessName, fechaVenta, horaVenta, fGarantia, qrSvgWa }),
               `Venta ${p.marca} ${p.modelo}`);
    return;
  }

  const block = (label) => `
    <div class="t80">
      <div class="hdr">
        <div class="biz">${businessName}</div>
        <div class="copy-lbl">${label}</div>
        <div class="ticket-title">COMPROBANTE DE VENTA</div>
      </div>
      <div class="meta">
        <span>📅 ${fechaVenta}${horaVenta ? ' · ' + horaVenta : ''}</span>
        ${p.vendedor ? `<span>👤 ${_pr(p.vendedor)}</span>` : ''}
      </div>
      <div class="prod">
        <div class="prod-marca">📱 ${_pr(p.marca)} ${_pr(p.modelo)}</div>
        ${p.estado ? `<div class="prod-line">Condición: <b>${_pr(p.estado)}</b></div>` : ''}
        ${p.almacenamiento ? `<div class="prod-line">Almacenamiento: <b>${_pr(p.almacenamiento)}</b></div>` : ''}
        ${p.ram ? `<div class="prod-line">RAM: <b>${_pr(p.ram)}</b></div>` : ''}
        ${p.bateria ? `<div class="prod-line">🔋 Batería: <b>${p.bateria}%</b></div>` : ''}
        ${p.imei ? `<div class="prod-line">IMEI: <code>${_pr(p.imei)}</code></div>` : ''}
        ${p.notas ? `<div class="prod-line obs">📝 ${_pr(p.notas)}</div>` : ''}
      </div>
      <div class="precio-box">
        <span class="precio-lbl">Precio</span>
        <span class="precio-val">${_prMoney(p.precio)}</span>
      </div>
      ${p.forma_pago ? `<div class="meta"><span>💳 Forma de pago: <b>${_pr(p.forma_pago)}</b></span></div>` : ''}
      ${p.garantiaMeses > 0 ? `
        <div class="garantia-box">
          <div class="garantia-item hl">🛡️ GARANTÍA: ${p.garantiaMeses} ${p.garantiaMeses === 1 ? 'mes' : 'meses'}</div>
          ${fGarantia ? `<div class="garantia-item">Vence: <b>${fGarantia}</b></div>` : ''}
          <div class="garantia-item">Conservar este comprobante para hacer válida la garantía.</div>
          <div class="garantia-item">No cubre golpes, humedad ni mal uso.</div>
        </div>
      ` : `
        <div class="garantia-box no-warn">
          <div class="garantia-item no">⚠️ VENTA SIN GARANTÍA</div>
        </div>
      `}
      ${qrSvgWa ? `
        <div class="qr-section">
          <div style="display:flex;justify-content:center">${qrSvgWa}</div>
          <div class="qr-text">Escaneá para contactarnos por WhatsApp</div>
        </div>
      ` : ''}
      <div class="firmas">
        <div class="firma-box"><div class="firma-space"></div>Firma vendedor</div>
        <div class="firma-box"><div class="firma-space"></div>Firma cliente</div>
      </div>
      <div class="footer">¡Gracias por tu compra! · ${businessName}</div>
    </div>`;

  const css = `
    body { font-family: 'Segoe UI', Arial, sans-serif; margin:0; padding:0; color:#000; background:#fff; }
    .t80 { width: 76mm; margin: 0 auto; padding: 6mm 4mm; box-sizing: border-box; }
    .hdr { text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
    .biz { font-size: 16px; font-weight: 800; letter-spacing: -0.02em; }
    .copy-lbl { display: inline-block; padding: 2px 8px; background: #000; color: #fff; border-radius: 4px; font-size: 9px; font-weight: 700; letter-spacing: 0.05em; margin: 4px 0; }
    .ticket-title { font-size: 11px; font-weight: 700; color: #000; margin-top: 2px; }
    .meta { display: flex; justify-content: space-between; font-size: 9px; color: #000; margin-bottom: 6px; gap: 8px; }
    .prod { border: 1px solid #000; border-radius: 4px; padding: 8px; margin-bottom: 8px; background: #fff; }
    .prod-marca { font-size: 13px; font-weight: 800; margin-bottom: 4px; color: #000; }
    .prod-line { font-size: 10px; color: #000; margin-bottom: 2px; line-height: 1.45; }
    .prod-line code { background: #000; padding: 1px 4px; border-radius: 3px; font-size: 9px; }
    .prod-line.obs { color: #000; font-style: italic; }
    .precio-box { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: #000; color: #fff; border-radius: 4px; margin-bottom: 6px; }
    .precio-lbl { font-size: 10px; opacity: 0.85; }
    .precio-val { font-size: 16px; font-weight: 800; }
    .garantia-box { border: 1px solid #fff; border-radius: 4px; padding: 6px 8px; background: #fff; margin: 6px 0; }
    .garantia-box.no-warn { border-color: #000; background: #fff; }
    .garantia-item { font-size: 9px; margin-bottom: 2px; line-height: 1.4; color: #000; }
    .garantia-item.hl { font-weight: 700; font-size: 10.5px; }
    .garantia-item.no { color: #000; font-weight: 700; font-size: 10px; text-align: center; }
    .qr-section { text-align: center; margin: 8px 0; padding: 6px; border: 1px dashed #000; border-radius: 4px; }
    .qr-section img { display: block; margin: 0 auto 4px; }
    .qr-text { font-size: 8px; color: #000; }
    .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 12px 0 6px; }
    .firma-box { border-top: 1.5px solid #000; padding-top: 3px; font-size: 8px; color: #000; text-align: center; }
    .firma-space { height: 22px; }
    .footer { text-align: center; font-size: 9px; color: #000; border-top: 1px dashed #000; padding-top: 6px; margin-top: 8px; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  `;

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Venta — ${_pr(p.marca)} ${_pr(p.modelo)}</title>
<style>${css}</style></head><body>
${block('ORIGINAL — Cliente')}
<div style="page-break-after:always;height:0"></div>
${block('COPIA — Negocio')}
</body></html>`;

  _openPrint(html, `Venta ${p.marca} ${p.modelo}`);
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  RESERVA DE EQUIPO y PLAN AHORRO                             ║
// ║  ────────────────────────────────────────────────────────────║
// ║  Los dos son "el cliente dejó plata a cuenta de un equipo",   ║
// ║  así que comparten el CSS del comprobante de venta (_CSS_     ║
// ║  VENTA_A5) y solo suman lo suyo: la barra de avance del plan  ║
// ║  y la lista de pagos.                                        ║
// ╚══════════════════════════════════════════════════════════════╝
const _CSS_SENA = `
.sbar{height:5.5mm;border:1px solid #000;margin:3px 0 2px;position:relative}
.sbar-f{height:100%;background:#000}
.sbar-t{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        font-size:8px;font-weight:800;mix-blend-mode:difference;color:#fff}
.sgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:5px}
.scaja{border:1.1px solid #000;padding:3px 6px;text-align:center}
.scaja-l{font-size:6.6px;font-weight:800;text-transform:uppercase;letter-spacing:.09em}
.scaja-v{font-size:12px;font-weight:800;margin-top:1px}
.scaja--hl{border-width:2px}
.spagos{width:100%;border-collapse:collapse;margin-bottom:5px}
.spagos th{font-size:6.6px;text-transform:uppercase;letter-spacing:.09em;border-bottom:1px solid #000;padding:2px 5px;text-align:left}
.spagos td{font-size:8.2px;border-bottom:.5px dotted #000;padding:2px 5px}
.spagos .n{text-align:right;font-weight:700;white-space:nowrap}
.spagos tr.hoy td{font-weight:800}
.slim{border:1.3px solid #000;padding:3px 7px;margin-bottom:5px;font-size:8.4px}`;

// Encabezado común de los dos comprobantes.
function _senaHd(d, titulo, sub, nro, label) {
  return `
  <div class="vhd">
    <div>
      <div class="vshop">${d.businessName.toUpperCase()}</div>
      <div class="vsub">${sub}</div>
      ${_bizLinea() ? `<div class="vbiz">${_bizLinea()}</div>` : ''}
    </div>
    <div class="vhd-r">
      <div class="vtit">${titulo}</div>
      ${nro ? `<div class="vnro">N° ${_pr(nro)}</div>` : ''}
      <div class="vcopia">${label}</div>
    </div>
  </div>`;
}

// Recuadro del cliente. Los campos vacíos no se imprimen.
function _senaCliente(c) {
  const filas = [
    c.nombre ? ['Nombre', c.nombre] : null,
    c.dni    ? ['DNI', c.dni]       : null,
    c.tlf    ? ['Teléfono', c.tlf]  : null,
  ].filter(Boolean);
  if (!filas.length) return '';
  return `<div class="vbox">
    <div class="vbox-t">Cliente</div>
    <div class="vgrid">${filas.map(([k, v]) => `<div class="vf"><span>${k}</span><b>${_pr(v)}</b></div>`).join('')}</div>
  </div>`;
}

// Recuadro del equipo. Sirve tanto para uno del stock como para uno descrito
// a mano (plan ahorro de un equipo que todavía no está).
function _senaEquipo(e) {
  const filas = [
    e.almacenamiento ? ['Almacenamiento', e.almacenamiento] : null,
    e.color ? ['Color', e.color] : null,
    e.estado ? ['Condición', e.estado] : null,
    e.bateria ? ['Batería', e.bateria + '%'] : null,
  ].filter(Boolean);
  const titulo = `${e.marca || ''} ${e.modelo || ''}`.trim();
  return `<div class="vbox">
    <div class="vbox-t">Equipo</div>
    <div class="veq">${titulo || _pr(e.descripcion)}</div>
    ${e.imei ? `<div class="vf"><span>IMEI</span><b class="vimei">${_pr(e.imei)}</b></div>` : ''}
    ${filas.length ? `<div class="vgrid">${filas.map(([k, v]) => `<div class="vf"><span>${k}</span><b>${_pr(v)}</b></div>`).join('')}</div>` : ''}
    ${titulo && e.descripcion ? `<div class="vf2"><span>Detalle:</span> ${_pr(e.descripcion)}</div>` : ''}
    ${!e.imei ? `<div class="vf2"><span>Nota:</span> el IMEI se completa al momento de la entrega.</div>` : ''}
  </div>`;
}

// Las tres cifras que importan, grandes: precio, entregado y saldo.
function _senaCifras(precio, entregado, etiquetaEntregado) {
  const saldo = Math.max(0, (Number(precio) || 0) - (Number(entregado) || 0));
  return `<div class="sgrid">
    <div class="scaja"><div class="scaja-l">Precio pactado</div><div class="scaja-v">${_prMoney(precio)}</div></div>
    <div class="scaja"><div class="scaja-l">${etiquetaEntregado}</div><div class="scaja-v">${_prMoney(entregado)}</div></div>
    <div class="scaja scaja--hl"><div class="scaja-l">Falta pagar</div><div class="scaja-v">${_prMoney(saldo)}</div></div>
  </div>`;
}

function _senaFirmas(d, nombreCliente) {
  return `
  <div class="vfir">
    <div class="vfir-c"><div class="vfir-sp"></div><div class="ln"></div>Firma del negocio</div>
    <div class="vfir-c"><div class="vfir-sp"></div><div class="ln"></div>Firma y aclaración del cliente${
      nombreCliente ? `<div class="vfir-n">${nombreCliente}</div>` : ''
    }</div>
    ${d.qrSvgWa ? `<div class="vqr">${d.qrSvgWa}<span>Escribinos</span></div>` : ''}
  </div>`;
}

// ── RESERVA ───────────────────────────────────────────────────
function _reservaBody(d, label) {
  const r = d.r;
  return `
<div class="tk">
  ${_senaHd(d, 'COMPROBANTE DE RESERVA', 'Venta de equipos · servicio técnico', r.nro, label)}

  <div class="vmeta">
    <span><b>Fecha:</b> ${d.fecha}</span>
    ${r.vendedor ? `<span><b>Atendió:</b> ${_pr(r.vendedor)}</span>` : ''}
  </div>

  ${_senaCliente(r.cliente || {})}
  ${_senaEquipo(r.equipo || {})}
  ${_senaCifras(r.precio, r.sena, 'Seña entregada')}

  <div class="slim">
    <b>EQUIPO RESERVADO HASTA EL ${d.fechaLimite || '____ / ____ / ______'}.</b>
    Hasta esa fecha el equipo queda separado y el precio no cambia.
  </div>

  <div class="vcond">
    <div class="vbox-t">Condiciones de la reserva</div>
    <div class="vcond-c">
      <p><b>1. Qué es esta seña.</b> El importe entregado se imputa íntegramente al precio del equipo detallado, que queda separado y fuera de la venta al público hasta la fecha indicada.</p>
      <p><b>2. Precio.</b> El precio pactado se mantiene sin variación hasta la fecha límite de la reserva, cualquiera sea la variación de precios en ese lapso.</p>
      <p><b>3. Vencimiento.</b> Pasada la fecha límite sin que el cliente retire el equipo ni acuerde una prórroga, el equipo vuelve a estar disponible para la venta y el precio deja de estar congelado.</p>
      <p><b>4. Si el cliente desiste.</b> El importe entregado no se devuelve en efectivo: queda acreditado a favor del cliente para aplicarlo a otra compra o servicio en el local, presentando este comprobante.</p>
      <p><b>5. Entrega.</b> Se realiza contra la cancelación total del saldo y la firma del comprobante de venta, donde constan la garantía y el estado del equipo.</p>
      <p><b>6. Conformidad.</b> La firma del presente implica la aceptación de estas condiciones.</p>
    </div>
  </div>

  ${_senaFirmas(d, (r.cliente || {}).nombre)}
  <div class="vpie">Guardá este comprobante: es lo que acredita la seña · ${d.businessName}</div>
</div>`;
}

// datos: { nro, cliente:{nombre,dni,tlf}, equipo:{...}, precio, sena,
//          fechaLimite (ISO o yyyy-mm-dd), vendedor }
function printReserva(datos) {
  const d = _senaDatos(datos);
  d.r = datos;
  d.fechaLimite = datos.fechaLimite ? _prDate(String(datos.fechaLimite).slice(0, 10)) : null;
  _openPrint(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Reserva — ${_pr((datos.equipo || {}).modelo)}</title>
<style>${_CSS_VENTA_A5}${_CSS_SENA}</style></head><body>
${_reservaBody(d, 'Original · cliente')}
${_reservaBody(d, 'Copia · negocio')}
${_autofitJs(192)}
</body></html>`, 'Reserva');
}

// ── PLAN AHORRO ───────────────────────────────────────────────
// Se imprime en CADA pago: el cliente se lleva el detalle de lo que lleva
// puesto y lo que le falta. Es la libreta del plan.
function _planBody(d, label) {
  const p = d.p;
  const pagos = Array.isArray(p.pagos) ? p.pagos : [];
  const total = Number(p.precioPactado) || 0;
  const acum  = Number(p.pagado) || 0;
  const pct   = total > 0 ? Math.min(100, Math.round(acum * 100 / total)) : 0;
  // Solo los últimos 8: con un plan largo la hoja no da, y lo que importa es
  // el acumulado (que va arriba, en grande).
  const ultimos = pagos.slice(-8);
  const ocultos = pagos.length - ultimos.length;

  return `
<div class="tk">
  ${_senaHd(d, 'PLAN AHORRO', 'Venta de equipos · servicio técnico', p.nro, label)}

  <div class="vmeta">
    <span><b>Fecha:</b> ${d.fecha}</span>
    <span><b>Pago N°:</b> ${pagos.length}</span>
    ${p.vendedor ? `<span><b>Atendió:</b> ${_pr(p.vendedor)}</span>` : ''}
  </div>

  ${_senaCliente(p.cliente || {})}
  ${_senaEquipo(p.equipo || {})}

  ${d.pagoHoy > 0 ? `<div class="slim"><b>ENTREGA DE HOY: ${_prMoney(d.pagoHoy)}</b>${
    d.metodoHoy ? ` · ${_pr(d.metodoHoy)}` : ''}</div>` : ''}

  ${_senaCifras(total, acum, 'Lleva entregado')}

  <div class="sbar">
    <div class="sbar-f" style="width:${pct}%"></div>
    <div class="sbar-t">${pct}% del plan</div>
  </div>

  ${ultimos.length ? `
  <table class="spagos">
    <tr><th>Pago</th><th>Fecha</th><th>Forma</th><th class="n">Importe</th></tr>
    ${ocultos > 0 ? `<tr><td colspan="4" style="font-size:7px">… ${ocultos} pago${ocultos === 1 ? '' : 's'} anterior${ocultos === 1 ? '' : 'es'} por ${_prMoney(acum - ultimos.reduce((s, x) => s + (Number(x.monto) || 0), 0))}</td></tr>` : ''}
    ${ultimos.map((x, i) => `<tr class="${i === ultimos.length - 1 ? 'hoy' : ''}">
      <td>${ocultos + i + 1}</td>
      <td>${_prDate(String(x.fecha || '').slice(0, 10))}</td>
      <td>${_pr(x.metodo)}</td>
      <td class="n">${_prMoney(x.monto)}</td>
    </tr>`).join('')}
  </table>` : ''}

  <div class="slim">
    <b>PRECIO CONGELADO HASTA EL ${d.fechaLimite || '____ / ____ / ______'}.</b>
    Completando el plan antes de esa fecha, el equipo se entrega al precio pactado arriba.
  </div>

  <div class="vcond">
    <div class="vbox-t">Condiciones del plan</div>
    <div class="vcond-c">
      <p><b>1. Qué es este plan.</b> El cliente entrega importes a cuenta del equipo detallado. Cada entrega se registra en este comprobante y se acumula hasta cubrir el precio pactado.</p>
      <p><b>2. Precio congelado.</b> El precio indicado se mantiene sin variación hasta la fecha límite, cualquiera sea la variación de precios en ese lapso. Completado el total dentro del plazo, el equipo se entrega a ese precio.</p>
      <p><b>3. Si se pasa el plazo.</b> Vencida la fecha límite sin haber completado el total, lo entregado conserva su valor en pesos y se aplica al precio vigente del equipo al momento de la entrega.</p>
      <p><b>4. Si el cliente desiste.</b> Los importes entregados no se devuelven en efectivo: quedan acreditados a su favor para aplicarlos a otra compra o servicio en el local, presentando este comprobante.</p>
      <p><b>5. Disponibilidad.</b> Cuando el equipo está en stock, queda separado y fuera de la venta al público mientras el plan esté vigente. Si se trata de un equipo a pedido, se encarga al completarse el plan.</p>
      <p><b>6. Entrega.</b> Se realiza contra la cancelación total y la firma del comprobante de venta, donde constan la garantía y el estado del equipo.</p>
      <p><b>7. Conformidad.</b> La firma del presente implica la aceptación de estas condiciones.</p>
    </div>
  </div>

  ${_senaFirmas(d, (p.cliente || {}).nombre)}
  <div class="vpie">Traé este comprobante en cada pago · ${d.businessName}</div>
</div>`;
}

// plan: el documento del plan (con `pagos` ya incluyendo el de hoy)
// pagoHoy / metodoHoy: lo que se acaba de entregar (0 = solo reimprimir)
function printPlanAhorro(plan, pagoHoy, metodoHoy) {
  const d = _senaDatos(plan);
  d.p = plan;
  d.pagoHoy = Number(pagoHoy) || 0;
  d.metodoHoy = metodoHoy || '';
  d.fechaLimite = plan.fechaLimite ? _prDate(String(plan.fechaLimite).slice(0, 10)) : null;
  _openPrint(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Plan ahorro — ${_pr((plan.equipo || {}).modelo)}</title>
<style>${_CSS_VENTA_A5}${_CSS_SENA}</style></head><body>
${_planBody(d, 'Original · cliente')}
${_planBody(d, 'Copia · negocio')}
${_autofitJs(192)}
</body></html>`, 'Plan ahorro');
}

// Datos comunes: nombre del negocio, fecha y QR de WhatsApp.
function _senaDatos() {
  const businessName = (typeof window !== 'undefined' && window._DAKI_NAME) || 'TechPoint';
  const cfg = (typeof getConfig === 'function') ? getConfig() : null;
  const tlfNeg = cfg?.telefonoNegocio || cfg?.tlfNegocio
              || (typeof BIZ_DATA !== 'undefined' && BIZ_DATA ? BIZ_DATA.tel : '');
  let qrSvgWa = '';
  if (tlfNeg && typeof qrSvg === 'function') {
    const link = `https://wa.me/${String(tlfNeg).replace(/\D/g, '')}`;
    qrSvgWa = qrSvg(link, 25);
  }
  return { businessName, fecha: _today(), qrSvgWa };
}

const _CL_LABELS = {
  pantalla:'Pantalla', tactil:'Táctil', pixels:'Píxeles', cam_trasera:'Cám. trasera',
  cam_delantera:'Cám. frontal', botones:'Botones', altavoz:'Altavoz', microfono:'Micrófono',
  wifi:'WiFi', bluetooth:'Bluetooth', carga:'Puerto carga', bateria:'Batería',
};

// Checklist de recepción en grilla compacta (✓ ok · ✗ falla · – sin probar)
function _clA5(rep) {
  const cl = rep.checklist;
  if (!cl || typeof cl !== 'object') return '';
  const items = Object.keys(_CL_LABELS).filter(k => cl[k]);
  if (!items.length) return '';
  const cells = items.map(k => {
    const v = cl[k];
    const mark = v === 'ok' ? '✓' : v === 'falla' ? '✗' : '–';
    return `<span class="cl"><b class="${v === 'falla' ? 'x' : ''}">${mark}</b>${_CL_LABELS[k]}</span>`;
  }).join('');
  return `<div class="box"><div class="box-t">Estado al recibir el equipo</div><div class="clgrid">${cells}</div></div>`;
}

// Las reparaciones a hacer, en la boleta.
// Con una sola sale como siempre (una línea). Con varias sale el detalle con
// el precio de cada una: el cliente firma sabiendo qué se le va a hacer y
// cuánto vale cada cosa.
// Las órdenes viejas no tienen `arreglos`, solo el texto `arreglo`: caen en el
// mismo camino de una línea y se imprimen igual que antes.
function _arreglosA5(rep) {
  const lista = Array.isArray(rep.arreglos) ? rep.arreglos.filter(a => a && a.texto) : [];
  if (lista.length < 2) return `<div class="desc">${_pr(rep.arreglo)}</div>`;
  const conPrecio = lista.filter(a => Number(a.precio) > 0).length;
  const filas = lista.map(a => `<div class="arr">
      <span>• ${a.texto}</span>
      ${Number(a.precio) > 0 ? `<b>${_prMoney(a.precio)}</b>` : '<b>—</b>'}
    </div>`).join('');
  const total = lista.reduce((s, a) => s + (Number(a.precio) || 0), 0);
  return `<div class="arrs">${filas}${
    conPrecio > 1 ? `<div class="arr arr-tot"><span>Total</span><b>${_prMoney(total)}</b></div>` : ''
  }</div>`;
}

function _a5Body(rep, label) {
  const shop  = (window._DAKI_NAME || 'TechPoint').toUpperCase();
  const saldo = _prSaldo(rep);
  const accs  = _prAccs(rep.accesorios);
  const garFin = rep.diasGarantia > 0 ? _garantiaFin(rep.diasGarantia) : null;
  // El patrón de desbloqueo NO se imprime. La boleta se la lleva el cliente y
  // además queda dando vueltas por el mostrador: es la llave del teléfono en
  // papel. El técnico lo ve dibujado en la ficha de la app.
  // El QR va DENTRO del recuadro de firmas: aprovecha el alto que ese bloque ya
  // ocupa, así no le suma milímetros a la hoja (el A5 entra justo).
  const qrSvgSeg = (typeof qrSeguimientoSvg === 'function') ? qrSeguimientoSvg(rep, 25) : '';

  return `
<div class="tk">
  <div class="hd">
    <div>
      <div class="shop">${shop}</div>
      <div class="sub">Servicio técnico de celulares</div>
      ${_bizLinea() ? `<div class="biz">${_bizLinea()}</div>` : ''}
    </div>
    <div class="hd-r">
      <div class="orden">ORDEN N° ${_pr(rep.nOrden)}</div>
      <div class="copia">${label}</div>
    </div>
  </div>

  <div class="meta">
    <span><b>Ingreso:</b> ${_prDate(rep.fechaIngreso)}</span>
    ${rep.fechaEstimada ? `<span><b>Entrega est.:</b> ${_prDate(rep.fechaEstimada)}</span>` : ''}
    <span><b>Recibió:</b> ${_pr(rep.tecnico)}</span>
  </div>

  <div class="g2">
    <div class="box">
      <div class="box-t">Cliente</div>
      <div class="f"><span>Nombre</span><b>${_pr(rep.nombre)}</b></div>
      <div class="f"><span>Teléfono</span><b>${_pr(rep.tlf)}</b></div>
      ${rep.dni ? `<div class="f"><span>DNI</span><b>${rep.dni}</b></div>` : ''}
    </div>
    <div class="box">
      <div class="box-t">Equipo</div>
      <div class="f"><span>Marca</span><b>${_pr(rep.marca)}</b></div>
      <div class="f"><span>Modelo</span><b>${_pr(rep.modelo)}</b></div>
      ${rep.imei ? `<div class="f"><span>IMEI</span><b class="mono">${rep.imei}</b></div>` : ''}
      ${/* La clave NO se imprime: la boleta queda en el mostrador y se la lleva
            el cliente. El técnico la ve en la ficha de la app. */ ''}
    </div>
  </div>

  <div class="box">
    <div class="box-t">Trabajo a realizar</div>
    ${/* La falla que declaró el cliente va antes que el arreglo: deja por
          escrito con qué problema entró el equipo, que es lo que después se
          discute si hay reclamo. */ ''}
    ${rep.falla ? `<div class="f2"><span>Falla declarada:</span> ${rep.falla}</div>` : ''}
    ${_arreglosA5(rep)}
    ${rep.condicion ? `<div class="f2"><span>Condición estética al ingreso:</span> ${rep.condicion}</div>` : ''}
  </div>

  ${_clA5(rep)}
  ${_verifHtml()}
  ${_importanteHtml()}

  ${(accs || rep.observaciones) ? `<div class="box">
    ${accs ? `<div class="f2"><span>Accesorios entregados:</span> ${accs}</div>` : ''}
    ${rep.observaciones ? `<div class="f2"><span>Observaciones:</span> ${rep.observaciones}</div>` : ''}
  </div>` : ''}

  <table class="tot">
    ${rep.presupuesto ? `<tr><td>Presupuesto</td><td class="a">${_prMoney(rep.presupuesto)}</td></tr>` : ''}
    <tr><td>Seña / Anticipo</td><td class="a">${_prMoney(rep.sena)}</td></tr>
    <tr class="hl"><td>TOTAL</td><td class="a">${_prMoney(rep.monto)}</td></tr>
    <tr class="hl"><td>SALDO A PAGAR AL RETIRAR</td><td class="a">${_prMoney(saldo)}</td></tr>
  </table>

  ${garFin ? `<div class="gar"><b>GARANTÍA ${rep.diasGarantia} DÍAS</b> — válida hasta ${garFin}. Cubre exclusivamente el trabajo realizado.</div>` : ''}

  ${_condicionesHtml(rep)}

  <div class="fir-box">
    <div class="fir-t">Conformidad del cliente al dejar el equipo</div>
    <div class="fir-txt">Declaro que los datos y el estado del equipo son los descritos, y acepto las condiciones del servicio detalladas arriba.</div>
    <div class="fir-g${qrSvgSeg ? ' fir-g--qr' : ''}">
      <div class="fir-c"><div class="fir-sp"></div><div class="ln"></div>Firma del cliente</div>
      <div class="fir-c"><div class="fir-sp"></div><div class="ln"></div>Aclaración</div>
      <div class="fir-c"><div class="fir-sp"></div><div class="ln"></div>Firma del técnico</div>
      ${qrSvgSeg ? `<div class="fir-qr">${qrSvgSeg}<span>Seguí tu reparación</span></div>` : ''}
    </div>
  </div>

  ${_entregaHtml(rep)}
</div>`;
}

const _CSS_A5 = `
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A5 portrait;margin:7mm}
body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:8.4px;line-height:1.32;color:#000;background:#fff}
/* El corte va ENTRE comprobantes, nunca después del último. Antes esto era
   page-break-after:always + :last-child, pero al agregar el script de
   auto-ajuste al final del body el último .tk dejó de ser :last-child y salía
   una segunda hoja en blanco. */
.tk{page-break-after:auto}
.tk + .tk{page-break-before:always}
.hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.6px solid #000;padding-bottom:3px;margin-bottom:4px}
.shop{font-size:16px;font-weight:800;letter-spacing:-.4px}
.sub{font-size:7.4px;text-transform:uppercase;letter-spacing:.09em}
.hd-r{text-align:right}
.orden{font-size:12.5px;font-weight:800;border:1.4px solid #000;padding:1px 6px;display:inline-block}
.copia{font-size:7.4px;text-transform:uppercase;letter-spacing:.14em;margin-top:2px;font-weight:700}
.meta{display:flex;gap:10px;flex-wrap:wrap;font-size:7.8px;border-bottom:.6px solid #000;padding-bottom:3px;margin-bottom:4px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px}
.box{border:.7px solid #000;padding:3px 6px;margin-bottom:4px}
.box-t{font-size:6.8px;font-weight:800;text-transform:uppercase;letter-spacing:.11em;border-bottom:.5px solid #000;padding-bottom:1.5px;margin-bottom:2.5px}
.f{display:flex;justify-content:space-between;gap:6px}
.f span{white-space:nowrap}
.f b{font-weight:700;text-align:right;word-break:break-word}
.f2{margin-top:1.5px}
.f2 span{font-weight:700}
.mono{font-family:'Courier New',monospace;font-size:8px;letter-spacing:-.2px}
.desc{white-space:pre-wrap;word-break:break-word;font-weight:700;min-height:11px}
.arrs{margin-top:1px}
.arr{display:flex;justify-content:space-between;gap:6px;font-weight:700}
.arr span{word-break:break-word}
.arr b{white-space:nowrap}
.arr-tot{border-top:.5px solid #000;margin-top:1.5px;padding-top:1.5px}
.clgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px 6px}
.cl{font-size:7.4px;white-space:nowrap}
.cl b{display:inline-block;width:8px;font-weight:800}
.cl b.x{text-decoration:none}
.tot{width:100%;border-collapse:collapse;margin-bottom:4px}
.tot td{border:.7px solid #000;padding:1.8px 6px}
.tot .a{text-align:right;font-weight:700;width:34%}
.tot .hl td{font-weight:800;font-size:9.6px;border-width:1.4px}
.gar{border:1.2px solid #000;padding:2.5px 6px;margin-bottom:4px;font-size:7.8px}
.biz{font-size:8.4px;font-weight:600;margin-top:1.5px}
.fir-box{border:1.2px solid #000;padding:3px 6px;margin-bottom:4px}
.fir-t{font-size:6.8px;font-weight:800;text-transform:uppercase;letter-spacing:.11em;border-bottom:.5px solid #000;padding-bottom:1.5px;margin-bottom:2px}
.fir-txt{font-size:6.4px;margin-bottom:2px}
.fir-g{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:12px;font-size:6.6px;text-align:center}
.fir-g--qr{grid-template-columns:1fr 1fr 1fr auto;gap:7px;align-items:end}
.fir-sp{height:15mm}
.fir-g--qr .fir-sp{height:11mm}
.fir-g .ln{border-top:.8px solid #000;margin-bottom:1.5px}
.fir-qr{text-align:center;line-height:1.1}
.fir-qr svg{width:19mm;height:19mm;display:block;margin:0 auto}
.fir-qr span{font-size:5.6px;font-weight:700;display:block;margin-top:.5px}
/* En pantalla, la hoja se mide igual que en la impresora (A5 menos 7mm de
   margen), para que el auto-ajuste calcule bien antes de imprimir. */
@media screen{body{width:134mm;margin:0 auto}}
@media print{body{-webkit-print-color-adjust:economy;print-color-adjust:economy}}`;

// Auto-ajuste a UNA hoja.
// El comprobante tiene bloques de largo variable (condición del equipo,
// observaciones, checklist, patrón), así que con datos cargados se pasaba de
// página y el segundo pliego salía casi vacío. Esto mide el alto real y encoge
// el comprobante lo justo para que entre, sin sacar contenido ni cortar nada.
// `altoMm` = alto útil de la hoja (tamaño menos los márgenes de @page).
function _autofitJs(altoMm) {
  return `<script>(function(){
  var MM = 96/25.4, MAX = ${altoMm}*MM;
  var tk = document.querySelectorAll('.tk, .pg');
  for (var i = 0; i < tk.length; i++) {
    var el = tk[i], s = 1;
    // OJO: acá va zoom y NO transform:scale(). scale() achica lo que se VE pero
    // el hueco que ocupa sigue siendo el original, así que el navegador igual
    // corta la hoja en dos. zoom sí achica el espacio ocupado.
    // offsetHeight (alto de maquetado) es lo que manda para el corte de página.
    for (var n = 0; n < 25 && el.offsetHeight * s > MAX && s > 0.6; n++) {
      s -= 0.02;
      el.style.zoom = s;
    }
    // El QR se achicaría junto con todo y dejaría de leerse. Se lo agranda para
    // compensar; si con eso ya no entra en la hoja, se deja como estaba.
    if (s < 1) {
      var qr = el.querySelector('.fir-qr svg');
      if (qr) {
        var previo = qr.style.width;
        qr.style.width = qr.style.height = (19/s) + 'mm';
        if (el.offsetHeight * s > MAX) {
          qr.style.width = qr.style.height = previo || '19mm';
        }
      }
    }
  }
})();<\/script>`;
}

function _buildA5(rep) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Orden N°${rep.nOrden || ''}</title>
<style>${_CSS_A5}${_CSS_COND}${_CSS_ENTREGA}${_CSS_VERIF}</style></head><body>
${_a5Body(rep, 'Comprobante del cliente')}
${/* 196mm es el alto útil real (A5 menos 7mm de margen arriba y abajo).
      Se apunta a 192 para dejar 4mm de colchón: los márgenes de la impresora
      nunca son exactos y si se pasa por medio milímetro salta a dos hojas. */''}
${_autofitJs(192)}
</body></html>`;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  CONDICIONES DEL SERVICIO — letra chica legal (ingreso)      ║
// ║  Redacción estándar de taller. Conviene validarla con un     ║
// ║  abogado / Defensa del Consumidor antes de usarla en firme.  ║
// ╚══════════════════════════════════════════════════════════════╝
const _RETIRO_DIAS   = 30;   // plazo para retirar sin cargo
const _ABANDONO_DIAS = 90;   // plazo tras el cual se considera abandonado

function _condicionesHtml(rep) {
  const d = Number(rep && rep.diasGarantia) || 0;
  // Ley 24.240: los servicios de reparación llevan garantía mínima implícita.
  // Si no se cargó garantía, se imprime el mínimo legal en vez de "sin garantía".
  const garTxt = d > 0
    ? `<b>${d} días</b> desde la fecha de entrega`
    : `<b>30 días</b> desde la fecha de entrega (garantía legal mínima)`;

  return `
<div class="cond">
  <div class="cond-t">Condiciones del servicio</div>
  <div class="cond-c">
    <p><b>1. Garantía.</b> El trabajo realizado y los repuestos colocados tienen garantía de ${garTxt}, conforme la Ley 24.240 de Defensa del Consumidor. Comprende exclusivamente la falla reparada y el repuesto instalado.</p>
    <p><b>2. Exclusiones.</b> No cubre golpes, caídas, presión o torsión; contacto con líquidos o humedad; fallas de software, actualizaciones o configuración; uso indebido o sobretensión de cargador; ni daños ajenos al trabajo efectuado. Se pierde si el equipo fue abierto o intervenido por terceros o se retiraron los sellos de seguridad.</p>
    <p><b>3. Estado previo y riesgo.</b> El cliente declara conocer que los equipos con daño por líquidos, golpes o placa comprometida pueden presentar fallas nuevas o dejar de funcionar durante la reparación, por causas preexistentes ajenas al taller. El equipo se recibe en el estado descrito en este comprobante.</p>
    <p><b>4. Presupuesto.</b> Todo trabajo o costo adicional al aquí detallado será informado y requerirá aprobación previa del cliente. Si el equipo no tuviera reparación o el presupuesto no fuera aceptado, se devolverá en el estado en que se encuentre, pudiendo haber sido desarmado para su diagnóstico.</p>
    <p><b>5. Datos y respaldo.</b> El taller no se responsabiliza por pérdida de datos, fotos, contactos o aplicaciones: el respaldo previo es responsabilidad del cliente. La clave o patrón se utiliza únicamente para diagnóstico y pruebas de funcionamiento.</p>
    <p><b>6. Retiro y abandono.</b> El equipo debe retirarse dentro de los ${_RETIRO_DIAS} días corridos desde el aviso de finalización. Vencido ese plazo se devengarán gastos de depósito diarios. Transcurridos ${_ABANDONO_DIAS} días sin ser retirado, y previa intimación fehaciente al teléfono y/o domicilio denunciados por el cliente, el equipo se considerará abandonado, quedando el taller facultado a disponer de él para cubrir gastos y trabajos impagos, conforme las normas sobre depósito del Código Civil y Comercial de la Nación.</p>
    <p><b>7. Entrega.</b> Se realiza únicamente contra presentación de este comprobante y documento de identidad del titular, y previa cancelación total del saldo.</p>
    <p><b>8. Repuestos reemplazados.</b> Las piezas sustituidas quedan en poder del taller, salvo solicitud expresa del cliente al momento de la entrega.</p>
    <p><b>9. Conformidad.</b> La firma del presente implica la aceptación de estas condiciones y del estado del equipo descrito.</p>
  </div>
</div>`;
}

const _CSS_COND = `
.cond{border:.7px solid #000;padding:3px 6px;margin-bottom:4px}
.cond-t{font-size:6.8px;font-weight:800;text-transform:uppercase;letter-spacing:.11em;border-bottom:.5px solid #000;padding-bottom:1.5px;margin-bottom:2.5px}
.cond-c{column-count:2;column-gap:7px;font-size:5.75px;line-height:1.28;text-align:justify}
.cond-c p{margin-bottom:1.6px;break-inside:avoid}`;

// ╔══════════════════════════════════════════════════════════════╗
// ║  CONSTANCIA DE ENTREGA — se completa a mano al retirar       ║
// ║  Va en el MISMO comprobante de ingreso (A5 y A4)             ║
// ╚══════════════════════════════════════════════════════════════╝
// Datos del negocio para el encabezado (dirección · WhatsApp · extra)
function _bizLinea() {
  const b = (typeof BIZ_DATA !== 'undefined' && BIZ_DATA) ? BIZ_DATA : {};
  return [b.dir, b.tel ? 'WhatsApp ' + b.tel : '', b.extra].filter(Boolean).join(' · ');
}

function _entregaHtml(rep) {
  const dias = Number(rep && rep.diasGarantia) || 0;
  const garDias = dias > 0 ? dias : 30; // mínimo legal si no se cargó garantía
  const bl = n => '<u>' + '&nbsp;'.repeat(n) + '</u>';
  return `
<div class="entr">
  <div class="entr-t">Entrega y garantía · a completar al retirar el equipo</div>
  <div class="entr-r">
    <span class="entr-f">Fecha de entrega: ${bl(4)}/${bl(4)}/${bl(6)}</span>
    <span class="entr-f">Hora: ${bl(7)}</span>
    <span class="entr-f">Saldo abonado: $${bl(12)}</span>
  </div>
  <div class="entr-txt">Recibí el equipo reparado, probado y en funcionamiento, conforme al trabajo detallado en este comprobante.</div>
  <div class="entr-fir">
    <div><div class="entr-sp"></div><div class="ln"></div>Firma del cliente</div>
    <div><div class="entr-sp"></div><div class="ln"></div>Aclaración</div>
    <div><div class="entr-sp"></div><div class="ln"></div>DNI</div>
  </div>
  <div class="entr-gar">
    <b>GARANTÍA ${garDias} DÍAS</b> desde la fecha de entrega · vence el ${bl(4)}/${bl(4)}/${bl(6)}
    <div class="entr-gar-s">Cubre el trabajo realizado y el repuesto colocado (ver exclusiones en las condiciones). <b>Presentá este comprobante para hacerla válida.</b></div>
  </div>
</div>`;
}

const _CSS_ENTREGA = `
.entr{border:1.2px solid #000;padding:3px 6px;margin-bottom:4px}
.entr-t{font-size:6.8px;font-weight:800;text-transform:uppercase;letter-spacing:.11em;border-bottom:.5px solid #000;padding-bottom:1.5px;margin-bottom:3px}
.entr-r{display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:2.5px}
.entr-f{font-size:7.6px;font-weight:700}
.entr-f u{text-decoration:none;border-bottom:.7px solid #000;display:inline-block;min-width:14mm}
.entr-txt{font-size:6.2px;margin-bottom:7px}
.entr-fir{display:grid;grid-template-columns:1.3fr 1.3fr .8fr;gap:10px;font-size:6.4px;text-align:center}
.entr-sp{height:12mm}
.entr-fir .ln{border-top:.8px solid #000;margin-bottom:1.5px}
.entr-gar{border-top:.7px solid #000;margin-top:5px;padding-top:2.5px;font-size:7.4px}
.entr-gar u{text-decoration:none;border-bottom:.7px solid #000;display:inline-block;min-width:9mm}
.entr-gar-s{font-size:6.4px;margin-top:1px}`;

// ╔══════════════════════════════════════════════════════════════╗
// ║  VERIFICACIÓN AL RECIBIR — casilleros SÍ/NO para tildar      ║
// ╚══════════════════════════════════════════════════════════════╝
const _VERIF_ITEMS = [
  'Se vio encendido',
  'Incluye bandeja porta SIM',
  'Se probaron funciones',
  'Carga',
];

function _verifHtml() {
  const filas = _VERIF_ITEMS.map(t =>
    `<div class="vf"><span class="vf-l">${t}</span><span class="vf-b"><i class="bx"></i>SÍ<i class="bx"></i>NO</span></div>`
  ).join('');
  return `<div class="verif">
  <div class="verif-t">Verificación al recibir el equipo</div>
  <div class="verif-g">${filas}</div>
</div>`;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  AVISO DESTACADO — evita malentendidos con el cliente        ║
// ╚══════════════════════════════════════════════════════════════╝
function _importanteHtml() {
  return `<div class="imp">
  <div class="imp-t">⚠ Importante · leer antes de dejar el equipo</div>
  <ul class="imp-l">
    <li>Si el equipo <b>no enciende</b>, no se puede verificar el estado de la pantalla, cámaras, batería ni otras funciones hasta repararlo. Al encenderlo pueden aparecer fallas que ya existían y no son responsabilidad del taller.</li>
    <li>Los equipos con <b>daño por líquido, golpes o placa comprometida</b> pueden dejar de funcionar durante la reparación por su estado previo.</li>
    <li>El <b>presupuesto puede cambiar</b> si al abrirlo aparece otra falla. En ese caso te avisamos <b>antes</b> de continuar: no se hace ningún trabajo extra sin tu autorización.</li>
    <li>Revisá que el equipo esté completo al retirarlo. <b>Sin este comprobante no se entrega.</b></li>
  </ul>
</div>`;
}

const _CSS_VERIF = `
.verif{border:.7px solid #000;padding:3px 6px;margin-bottom:4px}
.verif-t{font-size:6.8px;font-weight:800;text-transform:uppercase;letter-spacing:.11em;border-bottom:.5px solid #000;padding-bottom:1.5px;margin-bottom:2.5px}
.verif-g{display:grid;grid-template-columns:1fr 1fr;gap:1px 14px}
.vf{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:7.4px}
.vf-b{white-space:nowrap;font-size:6.8px;font-weight:700}
.bx{display:inline-block;width:2.6mm;height:2.6mm;border:.8px solid #000;margin:0 1.5px 0 5px;vertical-align:-.4mm}
.imp{border:1.6px solid #000;padding:3px 7px;margin-bottom:4px}
.imp-t{font-size:7.6px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px}
.imp-l{margin:0;padding-left:9px}
.imp-l li{font-size:6.8px;line-height:1.3;margin-bottom:1.5px}`;
