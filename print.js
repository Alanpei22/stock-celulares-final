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

// ── Abrir ventana con flujo secuencial: ORIGINAL → pausa → COPIA ──
// Imprime primero el original, espera que el usuario lo corte,
// y después con un click imprime la copia en un segundo trabajo.
function _openPrintSequential({ bodyOriginal, bodyCopia, css, title }) {
  const w = window.open('', '_blank', 'width=520,height=760,scrollbars=yes');
  if (!w) {
    alert('Habilitá los popups para imprimir.\nAjustes del navegador → Permitir popups de este sitio.');
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>${title || 'Ticket'}</title>
<style>
${css}
/* ── Controles en pantalla (se ocultan al imprimir) ── */
.ctrl-bar {
  position: fixed; top:0; left:0; right:0; z-index:9999;
  background: linear-gradient(180deg,#161618,#0b0b0d);
  color:#F2F2F7; padding:14px 16px 12px;
  font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
  box-shadow: 0 4px 18px rgba(0,0,0,.35);
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.ctrl-head { font-size:14px; font-weight:700; margin-bottom:3px; text-align:center; }
.ctrl-hint { font-size:11.5px; opacity:.72; text-align:center; margin-bottom:10px; line-height:1.35; }
.ctrl-row  { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; }
.ctrl-btn  {
  border:none; border-radius:10px; padding:10px 16px;
  font-size:13px; font-weight:700; cursor:pointer;
  font-family:inherit;
  transition: transform .15s ease, opacity .2s;
}
.ctrl-btn:active { transform: scale(.96); }
.ctrl-btn--pri  { background:#C8965A; color:#fff; box-shadow:0 2px 8px rgba(200,150,90,.35); }
.ctrl-btn--alt  { background:#22c55e; color:#fff; box-shadow:0 2px 8px rgba(34,197,94,.35); }
.ctrl-btn--sec  { background:#2E2E31; color:#F2F2F7; }
.ctrl-btn:disabled { opacity:.4; cursor:default; }
.ctrl-step { display:inline-block; padding:2px 8px; border-radius:99px; background:rgba(255,255,255,.08); font-size:10px; font-weight:700; letter-spacing:.1em; margin-right:6px; vertical-align:2px; }
.ctrl-step.done { background:rgba(34,197,94,.22); color:#86efac; }
.ctrl-step.active { background:rgba(200,150,90,.28); color:#E5C38A; }
.doc-wrap { padding-top: 140px; }
.ticket-hidden { display:none !important; }
@media print {
  .ctrl-bar { display:none !important; }
  .doc-wrap { padding-top: 0 !important; }
}
</style>
</head><body>
<div class="ctrl-bar" id="ctrlBar">
  <div class="ctrl-head" id="ctrlHead">
    <span class="ctrl-step active" id="pillO">1·ORIGINAL</span><span class="ctrl-step" id="pillC">2·COPIA</span>
  </div>
  <div class="ctrl-hint" id="ctrlHint">Se abrirá el diálogo de impresión para el <b>ORIGINAL</b>…</div>
  <div class="ctrl-row" id="ctrlRow">
    <button class="ctrl-btn ctrl-btn--pri" id="btnO" onclick="printOriginal()">🖨 Imprimir ORIGINAL</button>
    <button class="ctrl-btn ctrl-btn--alt" id="btnC" onclick="printCopia()" style="display:none">🖨 Imprimir COPIA</button>
    <button class="ctrl-btn ctrl-btn--sec" id="btnClose" onclick="window.close()" style="display:none">✕ Cerrar</button>
  </div>
</div>

<div class="doc-wrap">
  <div id="docO">${bodyOriginal}</div>
  <div id="docC" class="ticket-hidden">${bodyCopia}</div>
</div>

<script>
(function(){
  var step = 0; // 0 idle · 1 imprimiendo original · 2 esperando corte · 3 imprimiendo copia · 4 listo
  function showOnly(which) {
    document.getElementById('docO').classList.toggle('ticket-hidden', which !== 'O');
    document.getElementById('docC').classList.toggle('ticket-hidden', which !== 'C');
  }
  window.printOriginal = function() {
    step = 1;
    showOnly('O');
    document.getElementById('ctrlHint').innerHTML = 'Imprimiendo <b>ORIGINAL</b>…';
    document.getElementById('btnO').disabled = true;
    setTimeout(function(){ window.print(); }, 180);
  };
  window.printCopia = function() {
    step = 3;
    showOnly('C');
    document.getElementById('pillO').classList.remove('active');
    document.getElementById('pillO').classList.add('done');
    document.getElementById('pillC').classList.add('active');
    document.getElementById('ctrlHint').innerHTML = 'Imprimiendo <b>COPIA</b>…';
    document.getElementById('btnC').disabled = true;
    setTimeout(function(){ window.print(); }, 180);
  };
  window.addEventListener('afterprint', function(){
    if (step === 1) {
      step = 2;
      document.getElementById('ctrlHint').innerHTML = '✂ Cortá el <b>ORIGINAL</b> y cuando estés listo, imprimí la <b>COPIA</b>.';
      document.getElementById('btnO').style.display = 'none';
      document.getElementById('btnC').style.display = 'inline-block';
      document.getElementById('btnClose').style.display = 'inline-block';
    } else if (step === 3) {
      step = 4;
      document.getElementById('pillC').classList.remove('active');
      document.getElementById('pillC').classList.add('done');
      document.getElementById('ctrlHead').innerHTML = '<span class="ctrl-step done">1·ORIGINAL</span><span class="ctrl-step done">2·COPIA</span>';
      document.getElementById('ctrlHint').innerHTML = '✓ Listo, ambos tickets impresos.';
      document.getElementById('btnC').style.display = 'none';
      document.getElementById('btnClose').style.display = 'inline-block';
    }
  });
  window.addEventListener('load', function(){
    window.focus();
    setTimeout(window.printOriginal, 420);
  });
})();
</script>
</body></html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ── Punto de entrada — Ticket de ingreso ─────────────────────
function printRepair(format) {
  const rep = window._printRep;
  if (!rep) return;
  if (format === 'A4') {
    _openPrint(_buildA4(rep));
  } else {
    _build80mm(rep); // abre el popup con flujo secuencial (original → copia)
  }
}

// ── Punto de entrada — Ticket de retiro/entrega ──────────────
function printDelivery(format) {
  const rep = window._printRep;
  if (!rep) return;
  if (format === 'A4') {
    _openPrint(_buildDeliveryA4(rep));
  } else {
    _buildDelivery80mm(rep); // abre el popup con flujo secuencial
  }
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  TICKET 80mm — INGRESO  (original + copia)                  ║
// ╚══════════════════════════════════════════════════════════════╝
function _ticket80mmBody(rep, label) {
  const shop  = (window._DAKI_NAME || 'TechPoint').toUpperCase();
  const saldo = _prSaldo(rep);
  const accs  = _prAccs(rep.accesorios);
  return `
<div class="c b lg">${shop}</div>
<div class="c sm">SERVICIO TÉCNICO · ORDEN DE REPARACIÓN</div>
<div class="c b sm label-tag">${label}</div>
<div class="sep2"></div>

<div class="row"><span class="b">N° Orden:</span><span class="r b">#${_pr(rep.nOrden)}</span></div>
<div class="row"><span>Ingreso:</span><span class="r">${_prDate(rep.fechaIngreso)}</span></div>
${rep.fechaEstimada ? `<div class="row"><span>Estimado:</span><span class="r">${_prDate(rep.fechaEstimada)}</span></div>` : ''}
<div class="row"><span>Técnico:</span><span class="r">${_pr(rep.tecnico)}</span></div>
<div class="sep"></div>

<div class="b" style="margin-bottom:2px">▸ CLIENTE</div>
<div class="row"><span>Nombre:</span><span class="r">${_pr(rep.nombre)}</span></div>
<div class="row"><span>Tel:</span><span class="r">${_pr(rep.tlf)}</span></div>
${rep.dni ? `<div class="row"><span>DNI:</span><span class="r">${rep.dni}</span></div>` : ''}
<div class="sep"></div>

<div class="b" style="margin-bottom:2px">▸ EQUIPO</div>
<div class="row"><span>Marca:</span><span class="r">${_pr(rep.marca)}</span></div>
<div class="row"><span>Modelo:</span><span class="r">${_pr(rep.modelo)}</span></div>
${rep.imei ? `<div class="row"><span>IMEI:</span><span class="r sm">${rep.imei}</span></div>` : ''}
${rep.condicion ? `<div class="row"><span>Estado:</span><span class="r">${rep.condicion}</span></div>` : ''}
${rep.codigo ? `<div class="row"><span>Código/Patrón:</span><span class="r">${rep.codigo}</span></div>` : ''}
<div class="sep"></div>

<div class="b" style="margin-bottom:2px">▸ TRABAJO</div>
<div style="white-space:pre-wrap;word-break:break-word;line-height:1.35">${_pr(rep.arreglo)}</div>
${accs ? `<div class="sep"></div><div class="sm">Accesorios: ${accs}</div>` : ''}
${rep.observaciones ? `<div class="sm">Obs: ${rep.observaciones}</div>` : ''}
<div class="sep2"></div>

${rep.presupuesto ? `<div class="row"><span>Presupuesto:</span><span class="r">${_prMoney(rep.presupuesto)}</span></div>` : ''}
<div class="row"><span>Seña / Anticipo:</span><span class="r">${_prMoney(rep.sena)}</span></div>
<div class="sep"></div>
<div class="row total-row"><span>TOTAL:</span><span class="r">${_prMoney(rep.monto)}</span></div>
<div class="row total-row"><span>SALDO PENDIENTE:</span><span class="r">${_prMoney(saldo)}</span></div>
<div class="sep2"></div>

<div class="row"><span>Estado:</span><span class="r b">${_pr(rep.estado) !== '—' ? rep.estado.toUpperCase() : '—'}</span></div>
<div class="sep"></div>

<div class="firma">
  <div class="sm">Firma y aclaración del cliente:</div>
  <div style="height:22px"></div>
  <div style="border-top:1px solid #000;margin-top:2px"></div>
</div>
<div class="c" style="margin-top:10px;font-size:10px">✦ Gracias por elegirnos ✦</div>`;
}

// CSS compartido por los tickets 80mm (ingreso y retiro)
const _CSS_80MM = `
* { margin:0; padding:0; box-sizing:border-box; }
@page { size: 80mm auto; margin: 3mm 0; }
body { font-family:'Courier New',Courier,monospace; font-size:11px; color:#000; background:#fff; }
#docO, #docC { width:72mm; margin:0 auto; }
.c  { text-align:center; }
.b  { font-weight:bold; }
.lg { font-size:15px; }
.sm { font-size:9.5px; }
.sep  { border-top:1px dashed #555; margin:4px 0; }
.sep2 { border-top:2px solid #000; margin:5px 0; }
.row  { display:flex; justify-content:space-between; gap:4px; margin-bottom:1px; }
.row .r { text-align:right; white-space:nowrap; }
.total-row { font-size:12.5px; font-weight:bold; }
.firma { border-top:1px solid #000; margin-top:14px; padding-top:3px; }
.label-tag { font-size:10px; letter-spacing:.1em; margin:3px 0 2px; }
@media print { body { -webkit-print-color-adjust:exact; } }`;

function _build80mm(rep) {
  // Flujo secuencial: imprime original, usuario corta, imprime copia
  _openPrintSequential({
    bodyOriginal: _ticket80mmBody(rep, '— ORIGINAL —'),
    bodyCopia:    _ticket80mmBody(rep, '— COPIA —'),
    css: _CSS_80MM,
    title: `Ticket #${rep.nOrden || ''}`
  });
  return null; // no devuelve HTML — ya abrió el popup
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  HOJA A4 — INGRESO  (original + copia en una sola hoja)     ║
// ╚══════════════════════════════════════════════════════════════╝
function _buildA4(rep) {
  const shop  = window._DAKI_NAME || 'TechPoint';
  const saldo = _prSaldo(rep);
  const accs  = _prAccs(rep.accesorios);

  const block = (label) => `
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
<div class="title-bar">Orden de reparación <span class="copy-label">${label}</span></div>
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
    ${rep.imei ? `<div class="field"><span class="lbl">IMEI</span><span class="val" style="font-size:9px">${rep.imei}</span></div>` : ''}
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
  <div class="firma-box"><div>Firma y aclaración del cliente</div><div class="firma-space"></div></div>
  <div class="firma-box"><div>Firma del técnico — ${_pr(rep.tecnico)}</div><div class="firma-space"></div></div>
</div>`;

  const css = `
* { margin:0; padding:0; box-sizing:border-box; }
@page { size: A4 portrait; margin: 8mm 12mm; }
body { font-family:-apple-system,'Segoe UI',Arial,sans-serif; font-size:10px; color:#0f172a; background:#fff; }
.half { height:130mm; overflow:hidden; }
.cut { text-align:center; font-size:9px; color:#666; border-top:1px dashed #aaa; border-bottom:1px dashed #aaa; padding:2px 0; margin:3mm 0; letter-spacing:4px; }
.hdr { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; padding-bottom:6px; border-bottom:2px solid #0f172a; }
.hdr-shop { font-size:18px; font-weight:900; letter-spacing:-1px; }
.hdr-sub  { font-size:8.5px; color:#64748b; margin-top:1px; }
.hdr-orden { text-align:right; }
.hdr-orden .num { font-size:14px; font-weight:800; color:#4f46e5; }
.hdr-orden .meta { font-size:8.5px; color:#475569; line-height:1.5; }
.title-bar { background:#0f172a; color:#fff; padding:3px 10px; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; border-radius:3px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; }
.copy-label { font-size:8.5px; opacity:.75; font-style:italic; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px; }
.card { border:1px solid #e2e8f0; border-radius:4px; padding:5px 8px; }
.card-title { font-size:7px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:#94a3b8; padding-bottom:3px; margin-bottom:3px; border-bottom:1px solid #e2e8f0; }
.field { display:flex; justify-content:space-between; margin-bottom:2px; }
.field .lbl { color:#64748b; }
.field .val { font-weight:600; text-align:right; max-width:58%; word-break:break-word; }
.card-full { border:1px solid #e2e8f0; border-radius:4px; padding:5px 8px; margin-bottom:6px; }
.desc { line-height:1.4; white-space:pre-wrap; word-break:break-word; min-height:16px; }
.totals { width:100%; border-collapse:collapse; margin-bottom:6px; }
.totals td { padding:2.5px 8px; border:1px solid #e2e8f0; }
.totals .amt { text-align:right; font-weight:600; }
.totals .hl td { background:#0f172a; color:#fff; font-weight:700; font-size:10.5px; }
.firmas { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.firma-box { border-top:1.5px solid #0f172a; padding-top:3px; font-size:8px; color:#64748b; }
.firma-space { height:16px; }
@media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }`;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Orden N°${rep.nOrden || ''}</title>
<style>${css}</style></head><body>
<div class="half">${block('ORIGINAL')}</div>
<div class="cut">✂ &nbsp;&nbsp; CORTAR &nbsp;&nbsp; ✂</div>
<div class="half">${block('COPIA')}</div>
</body></html>`;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  TICKET 80mm — RETIRO/ENTREGA  (original + copia)           ║
// ╚══════════════════════════════════════════════════════════════╝
function _delivery80mmBody(rep, label) {
  const shop  = (window._DAKI_NAME || 'TechPoint').toUpperCase();
  const saldo = _prSaldo(rep);
  return `
<div class="c b lg">${shop}</div>
<div class="c sm">SERVICIO TÉCNICO · COMPROBANTE DE RETIRO</div>
<div class="c b sm label-tag">${label}</div>
<div class="sep2"></div>

<div class="row"><span class="b">N° Orden:</span><span class="r b">#${_pr(rep.nOrden)}</span></div>
<div class="row"><span>Ingreso:</span><span class="r">${_prDate(rep.fechaIngreso)}</span></div>
<div class="row"><span>Fecha retiro:</span><span class="r">${_today()}</span></div>
<div class="row"><span>Técnico:</span><span class="r">${_pr(rep.tecnico)}</span></div>
<div class="sep"></div>

<div class="b" style="margin-bottom:2px">▸ CLIENTE</div>
<div class="row"><span>Nombre:</span><span class="r">${_pr(rep.nombre)}</span></div>
<div class="row"><span>Tel:</span><span class="r">${_pr(rep.tlf)}</span></div>
${rep.dni ? `<div class="row"><span>DNI:</span><span class="r">${rep.dni}</span></div>` : ''}
<div class="sep"></div>

<div class="b" style="margin-bottom:2px">▸ EQUIPO</div>
<div class="row"><span>Marca:</span><span class="r">${_pr(rep.marca)}</span></div>
<div class="row"><span>Modelo:</span><span class="r">${_pr(rep.modelo)}</span></div>
${rep.imei ? `<div class="row"><span>IMEI:</span><span class="r sm">${rep.imei}</span></div>` : ''}
<div class="sep"></div>

<div class="b" style="margin-bottom:2px">▸ TRABAJO REALIZADO</div>
<div style="white-space:pre-wrap;word-break:break-word;line-height:1.35">${_pr(rep.arreglo)}</div>
<div class="sep2"></div>

<div class="row"><span>Seña / Anticipo:</span><span class="r">${_prMoney(rep.sena)}</span></div>
<div class="sep"></div>
<div class="row total-row"><span>TOTAL:</span><span class="r">${_prMoney(rep.monto)}</span></div>
<div class="row total-row"><span>SALDO ABONADO:</span><span class="r">${_prMoney(saldo)}</span></div>
<div class="sep2"></div>

${rep.diasGarantia > 0 ? `
<div class="b" style="margin-bottom:3px">▸ GARANTÍA</div>
<div class="row"><span>Días:</span><span class="r b">${rep.diasGarantia} días</span></div>
<div class="row"><span>Desde:</span><span class="r">${_today()}</span></div>
<div class="row"><span>Válida hasta:</span><span class="r b">${_garantiaFin(rep.diasGarantia)}</span></div>
<div class="sep"></div>
<div class="sm" style="line-height:1.5">
  ✗ No cubre golpes ni daños por humedad<br>
  ✗ No cubre manipulación de terceros
</div>
` : '<div class="c sm">Sin garantía incluida.</div>'}
<div class="sep"></div>

<div class="c sm" style="margin-bottom:6px">El cliente retira el equipo en conformidad</div>
<div class="firma">
  <div class="sm">Firma y aclaración del cliente:</div>
  <div style="height:22px"></div>
  <div style="border-top:1px solid #000;margin-top:2px"></div>
</div>
<div class="c" style="margin-top:10px;font-size:10px">✦ Gracias por elegirnos ✦</div>`;
}

function _buildDelivery80mm(rep) {
  // Flujo secuencial: imprime original, usuario corta, imprime copia
  _openPrintSequential({
    bodyOriginal: _delivery80mmBody(rep, '— ORIGINAL —'),
    bodyCopia:    _delivery80mmBody(rep, '— COPIA —'),
    css: _CSS_80MM,
    title: `Retiro #${rep.nOrden || ''}`
  });
  return null;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  HOJA A4 — RETIRO/ENTREGA  (original + copia en una hoja)   ║
// ╚══════════════════════════════════════════════════════════════╝
function _buildDeliveryA4(rep) {
  const shop  = window._DAKI_NAME || 'TechPoint';
  const saldo = _prSaldo(rep);

  const block = (label) => `
<div class="hdr">
  <div>
    <div class="hdr-shop">${shop.toUpperCase()}</div>
    <div class="hdr-sub">Servicio técnico de celulares</div>
  </div>
  <div class="hdr-orden">
    <div class="num">RETIRO N° ${_pr(rep.nOrden)}</div>
    <div class="meta">
      Ingreso: ${_prDate(rep.fechaIngreso)}<br>
      Retiro: ${_today()}<br>
      Técnico: ${_pr(rep.tecnico)}
    </div>
  </div>
</div>
<div class="title-bar">Comprobante de retiro <span class="copy-label">${label}</span></div>
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
    ${rep.imei ? `<div class="field"><span class="lbl">IMEI</span><span class="val" style="font-size:9px">${rep.imei}</span></div>` : ''}
  </div>
</div>
<div class="card-full">
  <div class="card-title">Trabajo realizado</div>
  <div class="desc">${_pr(rep.arreglo)}</div>
</div>
<div class="grid2-bottom">
  <table class="totals">
    <colgroup><col style="width:65%"><col style="width:35%"></colgroup>
    <tbody>
      ${rep.presupuesto ? `<tr><td>Cotización</td><td class="amt">${_prMoney(rep.presupuesto)}</td></tr>` : ''}
      <tr><td>Seña / Anticipo abonado</td><td class="amt">${_prMoney(rep.sena)}</td></tr>
      <tr class="hl"><td>TOTAL</td><td class="amt">${_prMoney(rep.monto)}</td></tr>
      <tr class="hl"><td>SALDO ABONADO AL RETIRAR</td><td class="amt">${_prMoney(saldo)}</td></tr>
    </tbody>
  </table>
  ${rep.diasGarantia > 0 ? `
  <div class="garantia-box">
    <div class="card-title">🛡 Garantía del servicio</div>
    <div class="garantia-item hl">✔ ${rep.diasGarantia} días — válida hasta ${_garantiaFin(rep.diasGarantia)}</div>
    <div class="garantia-item no">✗ No cubre golpes ni daños por humedad</div>
    <div class="garantia-item no">✗ No cubre manipulación de terceros</div>
  </div>` : `
  <div class="garantia-box">
    <div class="card-title">Garantía</div>
    <div class="garantia-item no">Este servicio no incluye garantía.</div>
  </div>`}
</div>
<div class="retiro-conf">
  El cliente declara retirar el equipo en perfecto estado de funcionamiento y en conformidad con el trabajo realizado.
</div>
<div class="firmas">
  <div class="firma-box"><div>Firma y aclaración del cliente</div><div class="firma-space"></div></div>
  <div class="firma-box"><div>Firma del técnico — ${_pr(rep.tecnico)}</div><div class="firma-space"></div></div>
</div>`;

  const css = `
* { margin:0; padding:0; box-sizing:border-box; }
@page { size: A4 portrait; margin: 8mm 12mm; }
body { font-family:-apple-system,'Segoe UI',Arial,sans-serif; font-size:10px; color:#0f172a; background:#fff; }
.half { height:130mm; overflow:hidden; }
.cut { text-align:center; font-size:9px; color:#666; border-top:1px dashed #aaa; border-bottom:1px dashed #aaa; padding:2px 0; margin:3mm 0; letter-spacing:4px; }
.hdr { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; padding-bottom:6px; border-bottom:2px solid #059669; }
.hdr-shop { font-size:18px; font-weight:900; letter-spacing:-1px; }
.hdr-sub  { font-size:8.5px; color:#64748b; margin-top:1px; }
.hdr-orden { text-align:right; }
.hdr-orden .num { font-size:14px; font-weight:800; color:#059669; }
.hdr-orden .meta { font-size:8.5px; color:#475569; line-height:1.5; }
.title-bar { background:#059669; color:#fff; padding:3px 10px; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; border-radius:3px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; }
.copy-label { font-size:8.5px; opacity:.8; font-style:italic; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px; }
.grid2-bottom { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px; }
.card { border:1px solid #e2e8f0; border-radius:4px; padding:5px 8px; }
.card-title { font-size:7px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:#94a3b8; padding-bottom:3px; margin-bottom:3px; border-bottom:1px solid #e2e8f0; }
.field { display:flex; justify-content:space-between; margin-bottom:2px; }
.field .lbl { color:#64748b; }
.field .val { font-weight:600; text-align:right; max-width:58%; word-break:break-word; }
.card-full { border:1px solid #e2e8f0; border-radius:4px; padding:5px 8px; margin-bottom:6px; }
.desc { line-height:1.4; white-space:pre-wrap; word-break:break-word; min-height:16px; }
.totals { width:100%; border-collapse:collapse; }
.totals td { padding:2.5px 8px; border:1px solid #e2e8f0; }
.totals .amt { text-align:right; font-weight:600; }
.totals .hl td { background:#0f172a; color:#fff; font-weight:700; font-size:10.5px; }
.garantia-box { border:1px solid #d1fae5; border-radius:4px; padding:5px 8px; background:#f0fdf4; }
.garantia-item { font-size:9px; margin-bottom:2px; line-height:1.4; color:#166534; }
.garantia-item.hl { font-weight:700; font-size:10px; }
.garantia-item.no { color:#991b1b; }
.retiro-conf { font-size:8.5px; color:#475569; border:1px dashed #cbd5e1; border-radius:4px; padding:4px 8px; margin-bottom:6px; font-style:italic; text-align:center; }
.firmas { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.firma-box { border-top:1.5px solid #0f172a; padding-top:3px; font-size:8px; color:#64748b; }
.firma-space { height:16px; }
@media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }`;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Retiro N°${rep.nOrden || ''}</title>
<style>${css}</style></head><body>
<div class="half">${block('ORIGINAL')}</div>
<div class="cut">✂ &nbsp;&nbsp; CORTAR &nbsp;&nbsp; ✂</div>
<div class="half">${block('COPIA')}</div>
</body></html>`;
}
