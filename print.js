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
  // Asegurar el doc de seguimiento público (para que el QR funcione,
  // también en reparaciones viejas que se reimprimen)
  if (typeof upsertSeguimientoPublico === 'function') upsertSeguimientoPublico(rep);
  if (format === 'A5') {
    _openPrint(_buildA5(rep));
  } else if (format === 'A4') {
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

${_qrSeguimientoHtml(rep)}

<div class="firma">
  <div class="sm">Firma y aclaración del cliente:</div>
  <div style="height:22px"></div>
  <div style="border-top:1px solid #000;margin-top:2px"></div>
</div>
<div class="c" style="margin-top:10px;font-size:10px">✦ Gracias por elegirnos ✦</div>`;
}

// Bloque QR de seguimiento para el ticket de ingreso.
// El cliente lo escanea y ve el estado de su reparación online.
function _qrSeguimientoHtml(rep) {
  if (!rep || !rep.id) return '';
  if (typeof urlSeguimiento !== 'function' || typeof qrImgSrc !== 'function') return '';
  const url = urlSeguimiento(rep.id);
  const src = qrImgSrc(url, 130);
  return `
<div class="c" style="margin:6px 0;padding:6px 0;border-top:1px dashed #000;border-bottom:1px dashed #000">
  <div class="b sm" style="margin-bottom:4px">📲 SEGUÍ TU REPARACIÓN</div>
  <img src="${src}" width="110" height="110" style="display:block;margin:0 auto" alt="QR">
  <div class="sm" style="margin-top:3px">Escaneá el código para ver el estado</div>
</div>`;
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
.sep  { border-top:1px dashed #000; margin:4px 0; }
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
    ${_bizLinea() ? `<div class="hdr-biz">${_bizLinea()}</div>` : ''}
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
${_condicionesHtml(rep)}
<div class="fir-box">
  <div class="fir-t">Conformidad del cliente al dejar el equipo</div>
  <div class="fir-txt">Declaro que los datos y el estado del equipo son los descritos, y acepto las condiciones del servicio detalladas arriba.</div>
  <div class="fir-g">
    <div class="fir-c"><div class="fir-sp"></div><div class="ln"></div>Firma del cliente</div>
    <div class="fir-c"><div class="fir-sp"></div><div class="ln"></div>Aclaración</div>
    <div class="fir-c"><div class="fir-sp"></div><div class="ln"></div>Firma del técnico — ${_pr(rep.tecnico)}</div>
  </div>
</div>
${_entregaHtml()}`;

  const css = `
* { margin:0; padding:0; box-sizing:border-box; }
@page { size: A4 portrait; margin: 10mm 12mm; }
body { font-family:-apple-system,'Segoe UI',Arial,sans-serif; font-size:10.5px; color:#000; background:#fff; }
.pg { page-break-after: always; }
.pg:last-child { page-break-after: auto; }
.hdr { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; padding-bottom:6px; border-bottom:2px solid #000; }
.hdr-shop { font-size:18px; font-weight:900; letter-spacing:-1px; }
.hdr-sub  { font-size:8.5px; color:#000; margin-top:1px; }
.hdr-orden { text-align:right; }
.hdr-orden .num { font-size:14px; font-weight:800; color:#000; }
.hdr-orden .meta { font-size:8.5px; color:#000; line-height:1.5; }
.title-bar { background:#000; color:#fff; padding:3px 10px; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; border-radius:3px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; }
.copy-label { font-size:8.5px; opacity:.75; font-style:italic; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px; }
.card { border:1px solid #000; border-radius:4px; padding:4px 8px; }
.card-title { font-size:7px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:#000; padding-bottom:3px; margin-bottom:3px; border-bottom:1px solid #000; }
.field { display:flex; justify-content:space-between; margin-bottom:2px; }
.field .lbl { color:#000; }
.field .val { font-weight:600; text-align:right; max-width:58%; word-break:break-word; }
.card-full { border:1px solid #000; border-radius:4px; padding:4px 8px; margin-bottom:5px; }
.desc { line-height:1.4; white-space:pre-wrap; word-break:break-word; min-height:16px; }
.totals { width:100%; border-collapse:collapse; margin-bottom:6px; }
.totals td { padding:2px 8px; border:1px solid #000; }
.totals .amt { text-align:right; font-weight:600; }
.totals .hl td { background:#000; color:#fff; font-weight:700; font-size:10.5px; }
.hdr-biz { font-size:7.6px; margin-top:1px; }
.fir-box { border:1.2px solid #000; padding:3px 7px; margin-bottom:4px; }
.fir-t { font-size:7px; font-weight:800; text-transform:uppercase; letter-spacing:.1em; border-bottom:1px solid #000; padding-bottom:1.5px; margin-bottom:2px; }
.fir-txt { font-size:6.8px; margin-bottom:2px; }
.fir-g { display:grid; grid-template-columns:1.2fr 1fr 1fr; gap:14px; font-size:7px; text-align:center; }
.fir-sp { height:13mm; }
.fir-g .ln { border-top:1px solid #000; margin-bottom:1.5px; }
/* Condiciones legales — 3 columnas para que entren en la mitad de la A4 */
.cond { border:1px solid #000; padding:3px 6px; margin-bottom:4px; }
.cond-t { font-size:7.4px; font-weight:800; text-transform:uppercase; letter-spacing:.1em; border-bottom:1px solid #000; padding-bottom:1.5px; margin-bottom:2.5px; }
.cond-c { column-count:2; column-gap:10px; font-size:7.4px; line-height:1.34; text-align:justify; }
.cond-c p { margin-bottom:1.6px; break-inside:avoid; }
/* Constancia de entrega — se completa a mano al retirar */
.entr { border:1.2px solid #000; padding:3px 7px; margin-top:4px; }
.entr-t { font-size:6.6px; font-weight:800; text-transform:uppercase; letter-spacing:.1em; border-bottom:1px solid #000; padding-bottom:1.5px; margin-bottom:3px; }
.entr-r { display:flex; flex-wrap:wrap; gap:4px 16px; margin-bottom:2.5px; }
.entr-f { font-size:8px; font-weight:700; }
.entr-f u { text-decoration:none; border-bottom:1px solid #000; display:inline-block; min-width:16mm; }
.entr-txt { font-size:6.6px; margin-bottom:6px; }
.entr-fir { display:grid; grid-template-columns:1.3fr 1.3fr .8fr; gap:12px; font-size:6.6px; text-align:center; }
.entr-fir .ln { border-top:1px solid #000; margin-bottom:1.5px; }
@media print { body { -webkit-print-color-adjust:economy; print-color-adjust:economy; } }`;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Orden N°${rep.nOrden || ''}</title>
<style>${css}</style></head><body>
<div class="pg">${block('ORIGINAL — CLIENTE')}</div>
<div class="pg">${block('COPIA — TALLER')}</div>
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
    ${_bizLinea() ? `<div class="hdr-biz">${_bizLinea()}</div>` : ''}
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
body { font-family:-apple-system,'Segoe UI',Arial,sans-serif; font-size:10px; color:#000; background:#fff; }
.half { height:130mm; overflow:hidden; }
.cut { text-align:center; font-size:9px; color:#000; border-top:1px dashed #000; border-bottom:1px dashed #000; padding:2px 0; margin:3mm 0; letter-spacing:4px; }
.hdr { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; padding-bottom:6px; border-bottom:2px solid #000; }
.hdr-shop { font-size:18px; font-weight:900; letter-spacing:-1px; }
.hdr-sub  { font-size:8.5px; color:#000; margin-top:1px; }
.hdr-orden { text-align:right; }
.hdr-orden .num { font-size:14px; font-weight:800; color:#000; }
.hdr-orden .meta { font-size:8.5px; color:#000; line-height:1.5; }
.title-bar { background:#000; color:#fff; padding:3px 10px; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; border-radius:3px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; }
.copy-label { font-size:8.5px; opacity:.8; font-style:italic; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px; }
.grid2-bottom { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px; }
.card { border:1px solid #000; border-radius:4px; padding:5px 8px; }
.card-title { font-size:7px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:#000; padding-bottom:3px; margin-bottom:3px; border-bottom:1px solid #000; }
.field { display:flex; justify-content:space-between; margin-bottom:2px; }
.field .lbl { color:#000; }
.field .val { font-weight:600; text-align:right; max-width:58%; word-break:break-word; }
.card-full { border:1px solid #000; border-radius:4px; padding:5px 8px; margin-bottom:6px; }
.desc { line-height:1.4; white-space:pre-wrap; word-break:break-word; min-height:16px; }
.totals { width:100%; border-collapse:collapse; }
.totals td { padding:2.5px 8px; border:1px solid #000; }
.totals .amt { text-align:right; font-weight:600; }
.totals .hl td { background:#000; color:#fff; font-weight:700; font-size:10.5px; }
.garantia-box { border:1px solid #fff; border-radius:4px; padding:5px 8px; background:#fff; }
.garantia-item { font-size:9px; margin-bottom:2px; line-height:1.4; color:#000; }
.garantia-item.hl { font-weight:700; font-size:10px; }
.garantia-item.no { color:#000; }
.retiro-conf { font-size:8.5px; color:#000; border:1px dashed #000; border-radius:4px; padding:4px 8px; margin-bottom:6px; font-style:italic; text-align:center; }
.hdr-biz { font-size:7.6px; margin-top:1px; }
.firmas { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.firma-box { border-top:1.5px solid #000; padding-top:3px; font-size:8px; color:#000; }
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

// ══════════════════════════════════════════
//  VENTA DE EQUIPO — ficha imprimible (Stock)
// ══════════════════════════════════════════
function printVentaTicket(stockId, extra) {
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
  const qrSrc = waLink ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(waLink)}` : '';

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
      ${qrSrc ? `
        <div class="qr-section">
          <img src="${qrSrc}" alt="QR WhatsApp" width="100" height="100">
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

// ══════════════════════════════════════════
//  TICKETS TÉRMICOS 58mm (Bluetooth vía RawBT)
// ══════════════════════════════════════════
function printRepairTermica() {
  const rep = window._printRep;
  if (!rep) { alert('No hay reparación seleccionada'); return; }
  if (typeof imprimirTermica !== 'function') { alert('Módulo de impresión térmica no cargó'); return; }
  const biz = (window._DAKI_NAME) || 'TechPoint';
  const L = (typeof termLine === 'function') ? termLine : (c='-') => c.repeat(32);
  const C = (typeof termCenter === 'function') ? termCenter : (t) => t;
  const LR = (typeof termLR === 'function') ? termLR : (a,b) => a + ' ' + b;
  const W = (typeof termWrap === 'function') ? termWrap : (t) => t;

  const lines = [];
  lines.push(C(biz));
  lines.push(C('TICKET DE INGRESO'));
  lines.push(L('='));
  lines.push(LR('Orden:', 'N' + (rep.nOrden || '?')));
  lines.push(LR('Fecha:', _today()));
  lines.push(L('-'));
  lines.push(W('Equipo: ' + (rep.marca || '') + ' ' + (rep.modelo || '')));
  if (rep.arreglo)   lines.push(W('Arreglo: ' + rep.arreglo));
  if (rep.condicion) lines.push(W('Estado: ' + rep.condicion));
  if (rep.nombre)    lines.push(W('Cliente: ' + rep.nombre));
  if (rep.tlf)       lines.push(LR('Tel:', rep.tlf));
  lines.push(L('-'));
  if (rep.monto)  lines.push(LR('Presupuesto:', '$' + Number(rep.monto).toLocaleString('es-AR')));
  if (rep.sena)   lines.push(LR('Sena:', '$' + Number(rep.sena).toLocaleString('es-AR')));
  if (rep.monto)  lines.push(LR('Saldo:', '$' + Math.max(0,(Number(rep.monto)||0)-(Number(rep.sena)||0)).toLocaleString('es-AR')));
  lines.push(L('='));
  lines.push(C('Conserve este ticket'));
  lines.push(C('para retirar su equipo'));

  imprimirTermica(lines.join('\n'), { title: 'Ingreso N' + (rep.nOrden||'') });
}

function printDeliveryTermica() {
  const rep = window._printRep;
  if (!rep) { alert('No hay reparación seleccionada'); return; }
  if (typeof imprimirTermica !== 'function') { alert('Módulo de impresión térmica no cargó'); return; }
  const biz = (window._DAKI_NAME) || 'TechPoint';
  const L = (typeof termLine === 'function') ? termLine : (c='-') => c.repeat(32);
  const C = (typeof termCenter === 'function') ? termCenter : (t) => t;
  const LR = (typeof termLR === 'function') ? termLR : (a,b) => a + ' ' + b;
  const W = (typeof termWrap === 'function') ? termWrap : (t) => t;

  const lines = [];
  lines.push(C(biz));
  lines.push(C('COMPROBANTE DE ENTREGA'));
  lines.push(L('='));
  lines.push(LR('Orden:', 'N' + (rep.nOrden || '?')));
  lines.push(LR('Fecha:', _today()));
  lines.push(L('-'));
  lines.push(W('Equipo: ' + (rep.marca || '') + ' ' + (rep.modelo || '')));
  if (rep.arreglo) lines.push(W('Trabajo: ' + rep.arreglo));
  if (rep.nombre)  lines.push(W('Cliente: ' + rep.nombre));
  lines.push(L('-'));
  if (rep.monto) lines.push(LR('Total:', '$' + Number(rep.monto).toLocaleString('es-AR')));
  lines.push(L('-'));
  // Garantía 30 días por defecto si no hay otra
  const garFin = _garantiaFin(rep.garantiaDias || 30);
  lines.push(C('GARANTIA'));
  lines.push(W('Valida hasta: ' + (garFin || '-')));
  lines.push(W('No cubre golpes, humedad ni mal uso.'));
  lines.push(L('='));
  lines.push(C('Gracias por su confianza'));

  imprimirTermica(lines.join('\n'), { title: 'Entrega N' + (rep.nOrden||'') });
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  HOJA A5 — INGRESO · 100% BLANCO Y NEGRO                     ║
// ║  1 ticket por página (pág.1 ORIGINAL cliente / pág.2 COPIA)  ║
// ╚══════════════════════════════════════════════════════════════╝
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

function _a5Body(rep, label) {
  const shop  = (window._DAKI_NAME || 'TechPoint').toUpperCase();
  const saldo = _prSaldo(rep);
  const accs  = _prAccs(rep.accesorios);
  const garFin = rep.diasGarantia > 0 ? _garantiaFin(rep.diasGarantia) : null;
  const patron = rep.patronImg ? `<div class="patron">${rep.patronImg}</div>` : '';

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
      ${rep.codigo ? `<div class="f"><span>Clave</span><b class="mono">${rep.codigo}</b></div>` : ''}
    </div>
  </div>

  <div class="box">
    <div class="box-t">Trabajo a realizar</div>
    <div class="desc">${_pr(rep.arreglo)}</div>
    ${rep.condicion ? `<div class="f2"><span>Condición estética al ingreso:</span> ${rep.condicion}</div>` : ''}
  </div>

  ${_clA5(rep)}
  ${patron ? `<div class="box"><div class="box-t">Patrón de desbloqueo</div>${patron}</div>` : ''}

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
    <div class="fir-g">
      <div class="fir-c"><div class="fir-sp"></div><div class="ln"></div>Firma del cliente</div>
      <div class="fir-c"><div class="fir-sp"></div><div class="ln"></div>Aclaración</div>
      <div class="fir-c"><div class="fir-sp"></div><div class="ln"></div>Firma del técnico</div>
    </div>
  </div>

  ${_entregaHtml()}
</div>`;
}

const _CSS_A5 = `
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A5 portrait;margin:7mm}
body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:8.4px;line-height:1.32;color:#000;background:#fff}
.tk{page-break-after:always}
.tk:last-child{page-break-after:auto}
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
.clgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px 6px}
.cl{font-size:7.4px;white-space:nowrap}
.cl b{display:inline-block;width:8px;font-weight:800}
.cl b.x{text-decoration:none}
.patron{text-align:center;padding:2px 0}
.patron svg{width:26mm;height:26mm;filter:grayscale(1) contrast(3)}
.tot{width:100%;border-collapse:collapse;margin-bottom:4px}
.tot td{border:.7px solid #000;padding:1.8px 6px}
.tot .a{text-align:right;font-weight:700;width:34%}
.tot .hl td{font-weight:800;font-size:9.6px;border-width:1.4px}
.gar{border:1.2px solid #000;padding:2.5px 6px;margin-bottom:4px;font-size:7.8px}
.biz{font-size:7px;margin-top:1px}
.fir-box{border:1.2px solid #000;padding:3px 6px;margin-bottom:4px}
.fir-t{font-size:6.8px;font-weight:800;text-transform:uppercase;letter-spacing:.11em;border-bottom:.5px solid #000;padding-bottom:1.5px;margin-bottom:2px}
.fir-txt{font-size:6.4px;margin-bottom:2px}
.fir-g{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:12px;font-size:6.6px;text-align:center}
.fir-sp{height:15mm}
.fir-g .ln{border-top:.8px solid #000;margin-bottom:1.5px}
@media print{body{-webkit-print-color-adjust:economy;print-color-adjust:economy}}`;

function _buildA5(rep) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Orden N°${rep.nOrden || ''}</title>
<style>${_CSS_A5}${_CSS_COND}${_CSS_ENTREGA}</style></head><body>
${_a5Body(rep, 'Comprobante del cliente')}
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

function _entregaHtml() {
  return `
<div class="entr">
  <div class="entr-t">Constancia de entrega · completar al retirar el equipo</div>
  <div class="entr-r">
    <span class="entr-f">Fecha de entrega: <u>&nbsp;&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u></span>
    <span class="entr-f">Hora: <u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u></span>
    <span class="entr-f">Saldo abonado: $<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u></span>
  </div>
  <div class="entr-txt">Recibí el equipo reparado, probado y en funcionamiento, conforme al trabajo detallado en este comprobante.</div>
  <div class="entr-fir">
    <div><div class="ln"></div>Firma del cliente</div>
    <div><div class="ln"></div>Aclaración</div>
    <div><div class="ln"></div>DNI</div>
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
.entr-fir .ln{border-top:.8px solid #000;margin-bottom:1.5px}`;
