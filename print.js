// ══════════════════════════════════════════
//  print.js — TechPoint (SCF)
//  Impresión de órdenes de reparación
//  Formatos: ticket 80mm (térmico) y hoja A4
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

// ── Punto de entrada principal ────────────────────────────────
// Llamar desde el modal de detalle con window._printRep ya seteado
function printRepair(format) {
  const rep = window._printRep;
  if (!rep) { return; }
  const html = format === 'A4' ? _buildA4(rep) : _build80mm(rep);
  const w = window.open('', '_blank', 'width=480,height=680,scrollbars=yes');
  if (!w) {
    alert('Habilitá los popups para imprimir.\nAjustes del navegador → Permitir popups de este sitio.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.addEventListener('load', () => { w.focus(); setTimeout(() => w.print(), 350); });
}

// ── TICKET 80mm ──────────────────────────────────────────────
function _build80mm(rep) {
  const shop  = (window._DAKI_NAME || 'TechPoint').toUpperCase();
  const saldo = _prSaldo(rep);
  const accs  = _prAccs(rep.accesorios);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Ticket #${rep.nOrden || ''}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
@page { size: 80mm auto; margin: 3mm 0; }
body {
  font-family: 'Courier New', Courier, monospace;
  font-size: 11px;
  width: 72mm;
  margin: 0 auto;
  color: #000;
  background: #fff;
}
.c  { text-align: center; }
.b  { font-weight: bold; }
.lg { font-size: 15px; }
.sm { font-size: 9.5px; }
.sep  { border-top: 1px dashed #555; margin: 4px 0; }
.sep2 { border-top: 2px solid #000;  margin: 5px 0; }
.row  { display: flex; justify-content: space-between; gap: 4px; margin-bottom: 1px; }
.row .r { text-align: right; white-space: nowrap; }
.total-row { font-size: 12.5px; font-weight: bold; }
.firma { border-top: 1px solid #000; margin-top: 14px; padding-top: 3px; }
@media print { body { -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="c b lg">${shop}</div>
<div class="c sm">SERVICIO TÉCNICO · ORDEN DE REPARACIÓN</div>
<div class="sep2"></div>

<div class="row"><span class="b">N° Orden:</span> <span class="r b">#${_pr(rep.nOrden)}</span></div>
<div class="row"><span>Ingreso:</span>  <span class="r">${_prDate(rep.fechaIngreso)}</span></div>
${rep.fechaEstimada ? `<div class="row"><span>Estimado:</span> <span class="r">${_prDate(rep.fechaEstimada)}</span></div>` : ''}
<div class="row"><span>Técnico:</span>  <span class="r">${_pr(rep.tecnico)}</span></div>
<div class="sep"></div>

<div class="b" style="margin-bottom:2px">▸ CLIENTE</div>
<div class="row"><span>Nombre:</span> <span class="r">${_pr(rep.nombre)}</span></div>
<div class="row"><span>Tel:</span>    <span class="r">${_pr(rep.tlf)}</span></div>
${rep.dni ? `<div class="row"><span>DNI:</span> <span class="r">${rep.dni}</span></div>` : ''}
<div class="sep"></div>

<div class="b" style="margin-bottom:2px">▸ EQUIPO</div>
<div class="row"><span>Marca:</span>  <span class="r">${_pr(rep.marca)}</span></div>
<div class="row"><span>Modelo:</span> <span class="r">${_pr(rep.modelo)}</span></div>
${rep.imei ? `<div class="row"><span>IMEI:</span> <span class="r sm">${rep.imei}</span></div>` : ''}
${rep.condicion ? `<div class="row"><span>Estado:</span> <span class="r">${rep.condicion}</span></div>` : ''}
${rep.codigo ? `<div class="row"><span>Código/Patrón:</span> <span class="r">${rep.codigo}</span></div>` : ''}
<div class="sep"></div>

<div class="b" style="margin-bottom:2px">▸ TRABAJO</div>
<div style="white-space:pre-wrap;word-break:break-word;line-height:1.35">${_pr(rep.arreglo)}</div>
${accs ? `<div class="sep"></div><div class="sm">Accesorios: ${accs}</div>` : ''}
${rep.observaciones ? `<div class="sm">Obs: ${rep.observaciones}</div>` : ''}
<div class="sep2"></div>

${rep.presupuesto ? `<div class="row"><span>Presupuesto:</span>  <span class="r">${_prMoney(rep.presupuesto)}</span></div>` : ''}
<div class="row"><span>Seña / Anticipo:</span> <span class="r">${_prMoney(rep.sena)}</span></div>
<div class="sep"></div>
<div class="row total-row"><span>TOTAL:</span>           <span class="r">${_prMoney(rep.monto)}</span></div>
<div class="row total-row"><span>SALDO PENDIENTE:</span> <span class="r">${_prMoney(saldo)}</span></div>
<div class="sep2"></div>

<div class="row" style="margin-top:2px">
  <span>Estado:</span>
  <span class="r b">${(_pr(rep.estado) !== '—' ? rep.estado.toUpperCase() : '—')}</span>
</div>
<div class="sep"></div>

<div class="firma">
  <div class="sm">Firma y aclaración del cliente:</div>
  <div style="height:22px"></div>
  <div style="border-top:1px solid #000;margin-top:2px"></div>
</div>

<div class="c" style="margin-top:10px;font-size:10px">✦ Gracias por elegirnos ✦</div>
</body>
</html>`;
}

// ── HOJA A4 ──────────────────────────────────────────────────
function _buildA4(rep) {
  const shop  = window._DAKI_NAME || 'TechPoint';
  const saldo = _prSaldo(rep);
  const accs  = _prAccs(rep.accesorios);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Orden N°${rep.nOrden || ''}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
@page { size: A4 portrait; margin: 14mm 12mm; }
body {
  font-family: -apple-system, 'Segoe UI', Arial, sans-serif;
  font-size: 11.5px;
  color: #0f172a;
  background: #fff;
}
.hdr {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 3px solid #0f172a;
}
.hdr-shop { font-size: 26px; font-weight: 900; letter-spacing: -1px; color: #0f172a; }
.hdr-sub  { font-size: 10px; color: #64748b; margin-top: 2px; }
.hdr-orden { text-align: right; }
.hdr-orden .num { font-size: 20px; font-weight: 800; color: #4f46e5; }
.hdr-orden .meta { font-size: 10.5px; color: #475569; line-height: 1.6; }
.title-bar {
  background: #0f172a;
  color: #fff;
  padding: 6px 14px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  border-radius: 3px;
  margin-bottom: 12px;
}
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
.card {
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  padding: 9px 12px;
}
.card-title {
  font-size: 8.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: #94a3b8;
  padding-bottom: 5px;
  margin-bottom: 6px;
  border-bottom: 1px solid #e2e8f0;
}
.field { display: flex; justify-content: space-between; margin-bottom: 3px; }
.field .lbl { color: #64748b; }
.field .val { font-weight: 600; text-align: right; max-width: 58%; word-break: break-word; }
.card-full {
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  padding: 9px 12px;
  margin-bottom: 10px;
}
.desc { font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; min-height: 30px; }
.totals {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 14px;
}
.totals td { padding: 5px 12px; border: 1px solid #e2e8f0; }
.totals .amt { text-align: right; font-weight: 600; }
.totals .hl td { background: #0f172a; color: #fff; font-weight: 700; font-size: 12.5px; }
.firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 8px; }
.firma-box { border-top: 1.5px solid #0f172a; padding-top: 4px; font-size: 9.5px; color: #64748b; }
.firma-space { height: 26px; }
.footer {
  margin-top: 18px;
  padding-top: 8px;
  border-top: 1px solid #e2e8f0;
  text-align: center;
  font-size: 9.5px;
  color: #94a3b8;
}
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>

<div class="hdr">
  <div>
    <div class="hdr-shop">${shop.toUpperCase()}</div>
    <div class="hdr-sub">Servicio técnico de celulares</div>
  </div>
  <div class="hdr-orden">
    <div class="num">ORDEN N° ${_pr(rep.nOrden)}</div>
    <div class="meta">
      Ingreso: ${_prDate(rep.fechaIngreso)}<br>
      ${rep.fechaEstimada ? `Entrega est.: ${_prDate(rep.fechaEstimada)}<br>` : ''}
      Técnico: ${_pr(rep.tecnico)}
    </div>
  </div>
</div>

<div class="title-bar">Orden de reparación</div>

<div class="grid2">
  <div class="card">
    <div class="card-title">Datos del cliente</div>
    <div class="field"><span class="lbl">Nombre</span><span class="val">${_pr(rep.nombre)}</span></div>
    <div class="field"><span class="lbl">Teléfono</span><span class="val">${_pr(rep.tlf)}</span></div>
    ${rep.dni ? `<div class="field"><span class="lbl">DNI</span><span class="val">${rep.dni}</span></div>` : ''}
  </div>
  <div class="card">
    <div class="card-title">Datos del equipo</div>
    <div class="field"><span class="lbl">Marca</span><span class="val">${_pr(rep.marca)}</span></div>
    <div class="field"><span class="lbl">Modelo</span><span class="val">${_pr(rep.modelo)}</span></div>
    ${rep.imei ? `<div class="field"><span class="lbl">IMEI</span><span class="val" style="font-size:10px">${rep.imei}</span></div>` : ''}
    ${rep.condicion ? `<div class="field"><span class="lbl">Condición</span><span class="val">${rep.condicion}</span></div>` : ''}
    ${rep.codigo ? `<div class="field"><span class="lbl">Clave/Patrón</span><span class="val">${rep.codigo}</span></div>` : ''}
  </div>
</div>

<div class="card-full">
  <div class="card-title">Trabajo a realizar / diagnóstico</div>
  <div class="desc">${_pr(rep.arreglo)}</div>
</div>

${(accs || rep.observaciones) ? `
<div class="card-full">
  <div class="card-title">Accesorios y observaciones</div>
  ${accs ? `<div class="field"><span class="lbl">Accesorios entregados:</span><span class="val">${accs}</span></div>` : ''}
  ${rep.observaciones ? `<div class="field"><span class="lbl">Observaciones:</span><span class="val">${rep.observaciones}</span></div>` : ''}
</div>` : ''}

<table class="totals">
  <colgroup><col style="width:68%"><col style="width:32%"></colgroup>
  <tbody>
    ${rep.presupuesto ? `<tr><td>Presupuesto / Cotización</td><td class="amt">${_prMoney(rep.presupuesto)}</td></tr>` : ''}
    <tr><td>Seña / Anticipo abonado</td><td class="amt">${_prMoney(rep.sena)}</td></tr>
    <tr class="hl"><td>TOTAL</td><td class="amt">${_prMoney(rep.monto)}</td></tr>
    <tr class="hl"><td>SALDO PENDIENTE AL RETIRAR</td><td class="amt">${_prMoney(saldo)}</td></tr>
  </tbody>
</table>

<div class="firmas">
  <div class="firma-box">
    <div>Firma y aclaración del cliente</div>
    <div class="firma-space"></div>
  </div>
  <div class="firma-box">
    <div>Firma del técnico — ${_pr(rep.tecnico)}</div>
    <div class="firma-space"></div>
  </div>
</div>

<div class="footer">
  ${shop} · Orden N° ${_pr(rep.nOrden)} · Generado el ${new Date().toLocaleDateString('es-AR')}
</div>

</body>
</html>`;
}
