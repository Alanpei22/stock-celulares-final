// ══════════════════════════════════════════════════════════════
//  📈 VENTAS DE EQUIPOS, MES A MES
// ══════════════════════════════════════════════════════════════
//  El informe de finanzas da UN mes por vez y en PDF. Esto es la otra
//  pregunta: ¿venimos para arriba o para abajo? Los últimos meses juntos,
//  cuántos equipos y cuánta ganancia cada uno.
//
//  Dos cosas que no son obvias:
//
//   · EL MES SE CORTA EN HORA ARGENTINA. `fecha_venta` se guarda en hora
//     universal (toISOString), que va tres horas adelante: una venta del 31 a
//     las 21:30 figura como día 1 del mes siguiente. Sin corregirlo, todos
//     los fines de mes se mudan de columna.
//
//   · LA GANANCIA SOLO SE PUEDE CONTAR DONDE HAY COSTO CARGADO. Si de 14
//     equipos 9 tienen costo, la ganancia del mes es la de esos 9 y así se
//     dice. Sumar los otros como si hubieran costado cero sería inventar
//     ganancia; dejarlos afuera sin avisar sería esconder ventas.
//
//  Lee el stock vendido UNA vez, cuando se lo pedís: no hay listener nuevo.
'use strict';

const VM_MESES_DEF = 6;
const VM_MES_NOMBRE = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                       'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Argentina es UTC-3 todo el año.
function vmMesDe(iso) {
  const t = Date.parse(iso || '');
  if (!t) return '';
  return new Date(t - 3 * 3600e3).toISOString().slice(0, 7);
}

function vmMesLbl(mes) {
  const [a, m] = String(mes || '').split('-');
  const i = Number(m) - 1;
  return (VM_MES_NOMBRE[i] || m) + ' ' + String(a).slice(2);
}

// El primer día del mes que arranca el período, en hora argentina.
function vmDesde(meses) {
  const n = Number(meses) || VM_MESES_DEF;
  const hoy = new Date(Date.now() - 3 * 3600e3);
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - (n - 1), 1));
  // Se pide en hora universal, que es como está guardado: el 1° a las 00:00
  // de acá son las 03:00 universales.
  return new Date(d.getTime() + 3 * 3600e3).toISOString();
}

// [{ mes, equipos, recaudado, costo, ganancia, conCosto, margen }] del más
// viejo al más nuevo, con los meses sin ventas incluidos (un mes en cero es
// un dato, no un agujero).
function vmAgrupar(ventas, meses) {
  const g = {};
  (ventas || []).forEach(p => {
    const mes = vmMesDe(p.fecha_venta);
    if (!mes) return;
    const x = g[mes] = g[mes] || { mes, equipos: 0, recaudado: 0, costo: 0, ganancia: 0, conCosto: 0, modelos: {} };
    const precio = Number(p.precio) || 0;
    const costo = Number(p.costo) || 0;
    x.equipos++;
    x.recaudado += precio;
    if (costo > 0) { x.conCosto++; x.costo += costo; x.ganancia += precio - costo; }
    const nom = [p.marca, p.modelo].filter(Boolean).join(' ').trim() || '(sin nombre)';
    x.modelos[nom] = (x.modelos[nom] || 0) + 1;
  });
  // Los meses del período que no tuvieron ninguna venta también van.
  const n = Number(meses) || VM_MESES_DEF;
  const hoy = new Date(Date.now() - 3 * 3600e3);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    const mes = d.toISOString().slice(0, 7);
    const x = g[mes] || { mes, equipos: 0, recaudado: 0, costo: 0, ganancia: 0, conCosto: 0, modelos: {} };
    const top = Object.keys(x.modelos).sort((a, b) => x.modelos[b] - x.modelos[a])[0] || '';
    out.push({ ...x,
      margen: x.recaudado > 0 && x.conCosto ? Math.round((x.ganancia / x.recaudado) * 100) : null,
      top, topVeces: top ? x.modelos[top] : 0 });
  }
  return out;
}

// Cómo viene el último contra el anterior: { equipos, ganancia } en diferencia.
function vmTendencia(filas) {
  if (!filas || filas.length < 2) return null;
  const a = filas[filas.length - 2], b = filas[filas.length - 1];
  return { equipos: b.equipos - a.equipos, ganancia: b.ganancia - a.ganancia,
           recaudado: b.recaudado - a.recaudado, mesAnterior: a.mes };
}

async function vmLeer(meses) {
  if (typeof db === 'undefined' || !db) return [];
  const snap = await db.collection('stock').where('fecha_venta', '>=', vmDesde(meses)).get();
  if (typeof cupoContar === 'function') cupoContar('stock', snap.size);
  // El `where` deja afuera los que nunca se vendieron (no tienen el campo),
  // pero un equipo puede tener fecha y haber vuelto a estar disponible.
  return snap.docs.map(d => d.data()).filter(p => p.vendido && p.fecha_venta);
}

// ══════════════════════════════════════════════════════════
//  EL CUADRO
// ══════════════════════════════════════════════════════════
let VM_FILAS = [];
let VM_MESES = VM_MESES_DEF;

const _vmEsc = s => (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s);
const _vmPlata = n => (typeof fmt === 'function') ? fmt(Math.round(n)) : '$' + Math.round(Number(n) || 0);
function _vmCorto(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (Math.abs(v) >= 1000) return '$' + Math.round(v / 1000) + 'k';
  return '$' + v;
}

function vmAbrir() {
  const modal = document.getElementById('vm-modal');
  if (!modal) return;
  document.getElementById('vm-overlay')?.classList.remove('hidden');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  vmBuscar();
}

function vmCerrar() {
  document.getElementById('vm-overlay')?.classList.add('hidden');
  document.getElementById('vm-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

async function vmBuscar() {
  const cont = document.getElementById('vm-cuerpo');
  VM_MESES = Number(document.getElementById('vm-meses')?.value) || VM_MESES_DEF;
  if (cont) cont.innerHTML = '<p class="lwa-vacio">Leyendo las ventas…</p>';
  try {
    VM_FILAS = vmAgrupar(await vmLeer(VM_MESES), VM_MESES);
    vmPintar();
  } catch (e) {
    console.error('[ventas por mes]', e);
    if (cont) cont.innerHTML = '<p class="lwa-vacio">No se pudieron leer las ventas.</p>';
  }
}

function vmPintar() {
  const cont = document.getElementById('vm-cuerpo');
  if (!cont) return;
  const filas = VM_FILAS;
  if (!filas.length) { cont.innerHTML = '<p class="lwa-vacio">Sin ventas en el período.</p>'; return; }

  const totEq = filas.reduce((s, f) => s + f.equipos, 0);
  const totRec = filas.reduce((s, f) => s + f.recaudado, 0);
  const totGan = filas.reduce((s, f) => s + f.ganancia, 0);
  const totCon = filas.reduce((s, f) => s + f.conCosto, 0);
  const maxGan = Math.max(1, ...filas.map(f => f.ganancia));
  const maxEq = Math.max(1, ...filas.map(f => f.equipos));
  const t = vmTendencia(filas);
  const mejor = filas.slice().sort((a, b) => b.ganancia - a.ganancia)[0];

  const flecha = n => n > 0 ? '🟢 +' : n < 0 ? '🔴 ' : '• ';
  cont.innerHTML = `
    <div class="vm-tot">
      <div><small>Equipos</small><b>${totEq}</b></div>
      <div><small>Recaudado</small><b>${_vmPlata(totRec)}</b></div>
      <div><small>Ganancia</small><b>${_vmPlata(totGan)}</b></div>
    </div>
    ${t ? `<p class="vm-tend">Contra ${_vmEsc(vmMesLbl(t.mesAnterior))}:
      ${flecha(t.equipos)}${Math.abs(t.equipos)} equipo${Math.abs(t.equipos) === 1 ? '' : 's'} ·
      ${flecha(t.ganancia)}${_vmPlata(Math.abs(t.ganancia))} de ganancia</p>` : ''}
    <div class="vm-barras">
      ${filas.map(f => `
        <div class="vm-fila">
          <span class="vm-mes">${_vmEsc(vmMesLbl(f.mes))}</span>
          <span class="vm-bar-wrap">
            <span class="vm-bar" style="width:${Math.round((f.ganancia / maxGan) * 100)}%"></span>
            <span class="vm-bar-eq" style="width:${Math.round((f.equipos / maxEq) * 100)}%"></span>
          </span>
          <span class="vm-num"><b>${f.equipos}</b><small>${_vmCorto(f.ganancia)}</small></span>
        </div>`).join('')}
    </div>
    <table class="vm-tabla">
      <thead><tr><th>Mes</th><th class="num">Eq.</th><th class="num">Recaudado</th><th class="num">Ganancia</th><th class="num">Margen</th><th>Más vendido</th></tr></thead>
      <tbody>${filas.slice().reverse().map(f => `<tr>
        <td>${_vmEsc(vmMesLbl(f.mes))}</td>
        <td class="num">${f.equipos}</td>
        <td class="num">${f.recaudado ? _vmPlata(f.recaudado) : '—'}</td>
        <td class="num">${f.conCosto ? _vmPlata(f.ganancia) : '—'}</td>
        <td class="num">${f.margen != null ? f.margen + '%' : '—'}</td>
        <td>${f.top ? _vmEsc(f.top) + (f.topVeces > 1 ? ' (' + f.topVeces + ')' : '') : '—'}</td>
      </tr>`).join('')}</tbody>
    </table>
    ${mejor && mejor.ganancia > 0 ? `<p class="fi-helper">Mejor mes: <b>${_vmEsc(vmMesLbl(mejor.mes))}</b> con ${_vmPlata(mejor.ganancia)} de ganancia.</p>` : ''}
    <p class="fi-helper">La ganancia sale de los ${totCon} de ${totEq} equipos que tienen el costo cargado.
      ${totCon < totEq ? 'Los otros suman en recaudado pero no en ganancia.' : ''}</p>`;
}
