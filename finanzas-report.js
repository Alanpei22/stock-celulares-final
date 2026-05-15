// ══════════════════════════════════════════
//  finanzas-report.js — Reporte financiero PDF
//  Modo dueño · período seleccionable
// ══════════════════════════════════════════
'use strict';

function openFinanzasReport() {
  // Default: este mes
  _finrepPreset('mes');
  document.getElementById('finrep-status').textContent = '';
  document.getElementById('finrep-overlay').classList.remove('hidden');
  document.getElementById('finrep-modal').classList.remove('hidden');
}

function closeFinanzasReport() {
  document.getElementById('finrep-overlay').classList.add('hidden');
  document.getElementById('finrep-modal').classList.add('hidden');
}

function _finrepPreset(preset) {
  const now = new Date();
  let from, to;
  if (preset === 'mes') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (preset === 'mes-1') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to   = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (preset === 'anio') {
    from = new Date(now.getFullYear(), 0, 1);
    to   = new Date(now.getFullYear(), 11, 31);
  } else if (preset === 'ult-30') {
    from = new Date(now.getTime() - 30 * 86400000);
    to   = now;
  }
  const fmt = d => d.toISOString().slice(0, 10);
  document.getElementById('finrep-from').value = fmt(from);
  document.getElementById('finrep-to').value   = fmt(to);
  document.querySelectorAll('.finrep-preset').forEach(b => {
    b.classList.toggle('finrep-preset--active', b.dataset.preset === preset);
  });
}

function _finMoney(n) {
  const v = Math.round(Number(n) || 0);
  return '$' + v.toLocaleString('es-AR');
}

// Porción en efectivo de un movimiento (split-aware)
function _finEfec(m) {
  const total = Number(m.monto) || 0;
  const m2    = Number(m.monto2) || 0;
  const met1  = m.metodoPago || 'Efectivo';
  const met2  = m.metodoPago2 || '';
  if (met1 === 'Efectivo' && met2) return total - m2;
  if (met1 === 'Efectivo') return total;
  if (met2 === 'Efectivo') return m2;
  return 0;
}

async function generarFinanzasPDF() {
  const from = document.getElementById('finrep-from').value;
  const to   = document.getElementById('finrep-to').value;
  if (!from || !to) { toast('Seleccioná el período', 'error'); return; }
  if (from > to)    { toast('La fecha "Desde" es posterior a "Hasta"', 'error'); return; }

  const inc = {
    caja:          document.getElementById('finrep-inc-caja').checked,
    ventas:        document.getElementById('finrep-inc-ventas').checked,
    reparaciones:  document.getElementById('finrep-inc-reparaciones').checked,
    dueno:         document.getElementById('finrep-inc-dueno').checked,
  };

  const btn = document.getElementById('finrep-generate');
  const statusEl = document.getElementById('finrep-status');
  btn.disabled = true;
  statusEl.textContent = '⏳ Recopilando datos...';

  try {
    const data = { from, to, caja: null, ventas: null, reparaciones: null, dueno: null };

    // ── 1) Caja diaria ──
    if (inc.caja) {
      statusEl.textContent = '⏳ Leyendo caja diaria...';
      const snap = await db.collection('caja_movimientos')
        .where('fecha', '>=', from).where('fecha', '<=', to).get();
      const movs = snap.docs.map(d => d.data());
      const ingresos = movs.filter(m => m.tipo === 'ingreso');
      const egresos  = movs.filter(m => m.tipo === 'egreso');
      const totalIng = ingresos.reduce((s, m) => s + (Number(m.monto) || 0), 0);
      const totalEg  = egresos.reduce((s, m)  => s + (Number(m.monto) || 0), 0);
      const efecIng  = ingresos.reduce((s, m) => s + _finEfec(m), 0);
      const efecEg   = egresos.reduce((s, m)  => s + _finEfec(m), 0);
      // Por categoría
      const porCatIng = {}, porCatEg = {};
      ingresos.forEach(m => { const c = m.categoria || 'Otro'; porCatIng[c] = (porCatIng[c]||0) + (Number(m.monto)||0); });
      egresos.forEach(m  => { const c = m.categoria || 'Otro'; porCatEg[c]  = (porCatEg[c]||0)  + (Number(m.monto)||0); });
      // Por método de pago
      const porMetodo = {};
      ingresos.forEach(m => {
        const total = Number(m.monto) || 0;
        const m2 = Number(m.monto2) || 0;
        const met1 = m.metodoPago || 'Efectivo';
        if (m.metodoPago2 && m2 > 0) {
          porMetodo[met1] = (porMetodo[met1]||0) + (total - m2);
          porMetodo[m.metodoPago2] = (porMetodo[m.metodoPago2]||0) + m2;
        } else {
          porMetodo[met1] = (porMetodo[met1]||0) + total;
        }
      });
      data.caja = {
        count: movs.length, totalIng, totalEg, neto: totalIng - totalEg,
        efecIng, efecEg, porCatIng, porCatEg, porMetodo,
      };
    }

    // ── 2) Ventas de equipos (stock) ──
    if (inc.ventas) {
      statusEl.textContent = '⏳ Leyendo ventas de equipos...';
      const snap = await db.collection('stock').where('vendido', '==', true).get();
      const vendidos = snap.docs.map(d => d.data()).filter(p => {
        if (!p.fecha_venta) return false;
        const f = String(p.fecha_venta).slice(0, 10);
        return f >= from && f <= to;
      });
      const recaudado = vendidos.reduce((s, p) => s + (Number(p.precio) || 0), 0);
      const conCosto  = vendidos.filter(p => p.costo > 0);
      const costoTot  = conCosto.reduce((s, p) => s + (Number(p.costo) || 0), 0);
      const ganancia  = conCosto.reduce((s, p) => s + (Number(p.precio)||0) - (Number(p.costo)||0), 0);
      data.ventas = {
        count: vendidos.length, recaudado, costoTot, ganancia,
        conCostoCount: conCosto.length,
        lista: vendidos.sort((a,b)=>(b.fecha_venta||'').localeCompare(a.fecha_venta||'')),
      };
    }

    // ── 3) Reparaciones ──
    if (inc.reparaciones) {
      statusEl.textContent = '⏳ Leyendo reparaciones...';
      const snap = await db.collection('repairs').get();
      const all = snap.docs.map(d => d.data());
      // Ingresadas en el período
      const ingresadas = all.filter(r => {
        if (!r.fechaIngreso) return false;
        const f = String(r.fechaIngreso).slice(0, 10);
        return f >= from && f <= to;
      });
      // Entregadas en el período (el dinero entra al entregar)
      const entregadas = all.filter(r => {
        if (r.estado !== 'entregado' || !r.fechaEntrega) return false;
        const f = String(r.fechaEntrega).slice(0, 10);
        return f >= from && f <= to;
      });
      const recaudado = entregadas.reduce((s, r) => s + (Number(r.monto) || 0), 0);
      const conCosto  = entregadas.filter(r => r.costo > 0);
      const costoTot  = conCosto.reduce((s, r) => s + (Number(r.costo) || 0), 0);
      const ganancia  = conCosto.reduce((s, r) => s + (Number(r.monto)||0) - (Number(r.costo)||0), 0);
      const senas     = ingresadas.reduce((s, r) => s + (Number(r.sena) || 0), 0);
      data.reparaciones = {
        ingresadas: ingresadas.length,
        entregadas: entregadas.length,
        recaudado, costoTot, ganancia, senas,
        conCostoCount: conCosto.length,
        lista: entregadas.sort((a,b)=>(b.fechaEntrega||'').localeCompare(a.fechaEntrega||'')),
      };
    }

    // ── 4) Caja Dueño ──
    if (inc.dueno) {
      statusEl.textContent = '⏳ Leyendo caja dueño...';
      const snap = await db.collection('caja_dueno_movimientos').get();
      const movs = snap.docs.map(d => d.data()).filter(m => {
        const f = String(m.fecha || (m.ts ? m.ts.slice(0,10) : '')).slice(0, 10);
        return f >= from && f <= to;
      });
      const ing = movs.filter(m => m.tipo === 'ingreso').reduce((s,m)=>s+(Number(m.monto)||0),0);
      const eg  = movs.filter(m => m.tipo === 'egreso').reduce((s,m)=>s+(Number(m.monto)||0),0);
      data.dueno = { count: movs.length, ingresos: ing, egresos: eg, neto: ing - eg, lista: movs };
    }

    statusEl.textContent = '✅ Generando PDF...';
    _renderFinanzasPDF(data);
    statusEl.textContent = '';
    closeFinanzasReport();
  } catch (e) {
    console.error('generarFinanzasPDF:', e);
    statusEl.textContent = '❌ Error: ' + e.message;
    toast('Error al generar el reporte', 'error');
  } finally {
    btn.disabled = false;
  }
}

function _renderFinanzasPDF(data) {
  const businessName = (typeof window !== 'undefined' && window._DAKI_NAME) || 'TechPoint';
  const fmtFecha = s => { const [y,m,d] = s.split('-'); return `${d}/${m}/${y}`; };
  const periodoStr = `${fmtFecha(data.from)} — ${fmtFecha(data.to)}`;
  const generado = new Date().toLocaleString('es-AR', { timeZone:'America/Argentina/Buenos_Aires', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

  // ── Resultado neto global ──
  let ingresoGlobal = 0, egresoGlobal = 0;
  if (data.caja) { ingresoGlobal += data.caja.totalIng; egresoGlobal += data.caja.totalEg; }
  // (ventas y reparaciones normalmente ya están en caja; se muestran como detalle)
  const netoGlobal = ingresoGlobal - egresoGlobal;

  const row = (lbl, val, cls) => `<tr><td>${lbl}</td><td class="num ${cls||''}">${val}</td></tr>`;

  // ── Sección Caja ──
  let cajaHtml = '';
  if (data.caja) {
    const c = data.caja;
    const catIngRows = Object.entries(c.porCatIng).sort((a,b)=>b[1]-a[1])
      .map(([k,v]) => row('&nbsp;&nbsp;' + k, _finMoney(v))).join('');
    const catEgRows = Object.entries(c.porCatEg).sort((a,b)=>b[1]-a[1])
      .map(([k,v]) => row('&nbsp;&nbsp;' + k, _finMoney(v))).join('');
    const metRows = Object.entries(c.porMetodo).sort((a,b)=>b[1]-a[1])
      .map(([k,v]) => row('&nbsp;&nbsp;' + k, _finMoney(v))).join('');
    cajaHtml = `
      <h2>📒 Caja diaria</h2>
      <table class="fr-table">
        ${row('<b>Ingresos totales</b>', '<b>' + _finMoney(c.totalIng) + '</b>', 'pos')}
        ${catIngRows}
        ${row('<b>Egresos totales</b>', '<b>' + _finMoney(c.totalEg) + '</b>', 'neg')}
        ${catEgRows}
        ${row('<b>NETO DE CAJA</b>', '<b>' + _finMoney(c.neto) + '</b>', c.neto>=0?'pos':'neg')}
      </table>
      <h3>Por método de pago (ingresos)</h3>
      <table class="fr-table">${metRows || row('—','—')}</table>
      <p class="fr-note">Movimientos en el período: ${c.count} · Efectivo neto: ${_finMoney(c.efecIng - c.efecEg)}</p>
    `;
  }

  // ── Sección Ventas ──
  let ventasHtml = '';
  if (data.ventas) {
    const v = data.ventas;
    const listaRows = v.lista.slice(0, 50).map(p => `
      <tr>
        <td>${(p.fecha_venta||'').slice(0,10).split('-').reverse().join('/')}</td>
        <td>${_esc(p.marca||'')} ${_esc(p.modelo||'')}</td>
        <td class="num">${_finMoney(p.precio||0)}</td>
        <td class="num">${p.costo ? _finMoney((p.precio||0)-(p.costo||0)) : '—'}</td>
      </tr>`).join('');
    ventasHtml = `
      <h2>📱 Ventas de equipos</h2>
      <table class="fr-table">
        ${row('Equipos vendidos', v.count)}
        ${row('<b>Recaudado</b>', '<b>'+_finMoney(v.recaudado)+'</b>', 'pos')}
        ${row('Costo total', _finMoney(v.costoTot), 'neg')}
        ${row('<b>Ganancia</b>', '<b>'+_finMoney(v.ganancia)+'</b>', 'pos')}
        ${v.recaudado>0 ? row('Margen', Math.round((v.ganancia/v.recaudado)*100)+'%') : ''}
      </table>
      ${v.count > 0 ? `
        <h3>Detalle de ventas</h3>
        <table class="fr-table fr-detail">
          <thead><tr><th>Fecha</th><th>Equipo</th><th class="num">Precio</th><th class="num">Ganancia</th></tr></thead>
          <tbody>${listaRows}</tbody>
        </table>
        ${v.lista.length > 50 ? `<p class="fr-note">… y ${v.lista.length-50} ventas más</p>` : ''}
      ` : ''}
      <p class="fr-note">Ganancia calculada sobre ${v.conCostoCount}/${v.count} equipos con costo cargado.</p>
    `;
  }

  // ── Sección Reparaciones ──
  let repHtml = '';
  if (data.reparaciones) {
    const r = data.reparaciones;
    const listaRows = r.lista.slice(0, 50).map(rep => `
      <tr>
        <td>${(rep.fechaEntrega||'').slice(0,10).split('-').reverse().join('/')}</td>
        <td>N°${rep.nOrden||'?'} ${_esc(rep.marca||'')} ${_esc(rep.modelo||'')}</td>
        <td class="num">${_finMoney(rep.monto||0)}</td>
        <td class="num">${rep.costo ? _finMoney((rep.monto||0)-(rep.costo||0)) : '—'}</td>
      </tr>`).join('');
    repHtml = `
      <h2>🔧 Reparaciones</h2>
      <table class="fr-table">
        ${row('Ingresadas en el período', r.ingresadas)}
        ${row('Entregadas en el período', r.entregadas)}
        ${row('<b>Recaudado (entregadas)</b>', '<b>'+_finMoney(r.recaudado)+'</b>', 'pos')}
        ${row('Costo de repuestos', _finMoney(r.costoTot), 'neg')}
        ${row('<b>Ganancia</b>', '<b>'+_finMoney(r.ganancia)+'</b>', 'pos')}
        ${r.senas>0 ? row('Señas recibidas', _finMoney(r.senas)) : ''}
      </table>
      ${r.entregadas > 0 ? `
        <h3>Detalle de entregadas</h3>
        <table class="fr-table fr-detail">
          <thead><tr><th>Fecha</th><th>Reparación</th><th class="num">Monto</th><th class="num">Ganancia</th></tr></thead>
          <tbody>${listaRows}</tbody>
        </table>
        ${r.lista.length > 50 ? `<p class="fr-note">… y ${r.lista.length-50} más</p>` : ''}
      ` : ''}
      <p class="fr-note">Ganancia calculada sobre ${r.conCostoCount}/${r.entregadas} reparaciones con costo cargado.</p>
    `;
  }

  // ── Sección Caja Dueño ──
  let duenoHtml = '';
  if (data.dueno) {
    const d = data.dueno;
    duenoHtml = `
      <h2>📦 Caja Dueño</h2>
      <table class="fr-table">
        ${row('Ingresos', _finMoney(d.ingresos), 'pos')}
        ${row('Egresos', _finMoney(d.egresos), 'neg')}
        ${row('<b>Balance del período</b>', '<b>'+_finMoney(d.neto)+'</b>', d.neto>=0?'pos':'neg')}
        ${row('Movimientos', d.count)}
      </table>
    `;
  }

  const css = `
    @page { margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; margin: 0; font-size: 12px; line-height: 1.5; }
    .fr-header { text-align: center; border-bottom: 3px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
    .fr-biz { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
    .fr-title { font-size: 13px; color: #475569; font-weight: 700; margin-top: 2px; }
    .fr-period { display: inline-block; margin-top: 8px; padding: 4px 14px; background: #0f172a; color: #fff; border-radius: 6px; font-size: 12px; font-weight: 700; }
    .fr-gen { font-size: 10px; color: #94a3b8; margin-top: 6px; }
    .fr-hero { display: flex; gap: 10px; margin-bottom: 20px; }
    .fr-hero-card { flex: 1; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; text-align: center; }
    .fr-hero-card.hl { background: #0f172a; color: #fff; border-color: #0f172a; }
    .fr-hero-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7; font-weight: 700; }
    .fr-hero-num { font-size: 20px; font-weight: 800; margin-top: 4px; }
    h2 { font-size: 15px; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1.5px solid #cbd5e1; }
    h3 { font-size: 12px; margin: 12px 0 4px; color: #475569; }
    .fr-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    .fr-table td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; }
    .fr-table td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    .fr-table td.num.pos { color: #059669; }
    .fr-table td.num.neg { color: #dc2626; }
    .fr-detail thead th { font-size: 10px; text-transform: uppercase; color: #94a3b8; text-align: left; padding: 4px 8px; border-bottom: 1.5px solid #cbd5e1; }
    .fr-detail thead th.num { text-align: right; }
    .fr-detail td { font-size: 11px; }
    .fr-note { font-size: 10px; color: #94a3b8; font-style: italic; margin: 4px 0 8px; }
    .fr-footer { margin-top: 24px; padding-top: 10px; border-top: 1px dashed #cbd5e1; text-align: center; font-size: 10px; color: #94a3b8; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } h2 { page-break-after: avoid; } table { page-break-inside: avoid; } }
  `;

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Reporte financiero ${periodoStr}</title>
<style>${css}</style></head><body>
  <div class="fr-header">
    <div class="fr-biz">${businessName}</div>
    <div class="fr-title">REPORTE FINANCIERO</div>
    <div class="fr-period">${periodoStr}</div>
    <div class="fr-gen">Generado el ${generado}</div>
  </div>

  <div class="fr-hero">
    <div class="fr-hero-card">
      <div class="fr-hero-lbl">Ingresos</div>
      <div class="fr-hero-num" style="color:#059669">${_finMoney(ingresoGlobal)}</div>
    </div>
    <div class="fr-hero-card">
      <div class="fr-hero-lbl">Egresos</div>
      <div class="fr-hero-num" style="color:#dc2626">${_finMoney(egresoGlobal)}</div>
    </div>
    <div class="fr-hero-card hl">
      <div class="fr-hero-lbl">Resultado neto</div>
      <div class="fr-hero-num">${_finMoney(netoGlobal)}</div>
    </div>
  </div>

  ${cajaHtml}
  ${ventasHtml}
  ${repHtml}
  ${duenoHtml}

  <div class="fr-footer">
    ${businessName} · Reporte generado automáticamente · ${periodoStr}<br>
    Documento interno — uso confidencial
  </div>
</body></html>`;

  const w = window.open('', '_blank', 'width=820,height=900,scrollbars=yes');
  if (!w) {
    alert('Habilitá los popups para generar el PDF.\nAjustes del navegador → Permitir popups de este sitio.');
    return;
  }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 400);
}

// esc local (utils.js puede no estar)
function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
