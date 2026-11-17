// ══════════════════════════════════════════════════════════════
//  📱 Equipos vendidos en el día (en la caja)
// ══════════════════════════════════════════════════════════════
//  Alan (16/11): "¿me podés agregar en la caja un resumen de equipos
//  vendidos en el día?". Los celulares entran a la caja por tres lados y
//  hasta ahora quedaban mezclados con el resto de los movimientos:
//   · la venta de equipo desde la caja        → categoría "Venta equipo"
//   · la venta desde el Stock (index.html)     → categoría "Venta" con stockId
//   · un equipo cargado en el carrito          → items[] con source 'equipo'
//  Las señas de un equipo reservado NO son una venta (el equipo sigue en el
//  local): no se cuentan acá.
//  Sale de los movimientos que la caja ya tiene cargados: no lee nada más.

// Movimientos del día → un renglón por equipo vendido
function eqDiaLista(movs) {
  const out = [];
  (Array.isArray(movs) ? movs : []).forEach(m => {
    if (!m || m.tipo !== 'ingreso') return;
    const base = {
      metodo: m.metodoPago || '', vendedor: m.vendedor || '', hora: _eqDiaHora(m.createdAt),
      cliente: m.clienteNombre || '', ts: String(m.createdAt || ''),
    };
    // Venta desde la caja (ventana de venta de equipo) o desde el Stock
    if (m.categoria === 'Venta equipo' || (m.categoria === 'Venta' && m.stockId)) {
      const precio = Number(m.montoEquipo) || Number(m.monto) || 0;
      // La ganancia del movimiento es del equipo + lo que se llevó con él
      // (funda, cargador): se muestra entera, es la de esa venta.
      out.push(Object.assign(base, {
        nombre: m.itemNombre || _eqDiaNombre(m.descripcion) || 'Equipo',
        precio, cobrado: Number(m.monto) || 0,
        ganancia: typeof m.gananciaARS === 'number' && !m.sinCosto ? m.gananciaARS : null,
        saldo: /\(saldo/.test(m.descripcion || ''),
        canje: Number(m.montoCanje) || 0,
      }));
      return;
    }
    // Equipo en el carrito de la caja (junto con accesorios)
    (Array.isArray(m.items) ? m.items : []).forEach(it => {
      if (!it || it.source !== 'equipo') return;
      const precio = (Number(it.precioUnit) || 0) * Math.max(1, Number(it.qty) || 1);
      const costo = Number(it.costoARSUnit) || 0;
      out.push(Object.assign({}, base, {
        nombre: it.nombre || 'Equipo', precio, cobrado: precio,
        ganancia: costo > 0 ? precio - costo : null, saldo: false,
      }));
    });
  });
  // Por el momento de la venta (la hora escrita depende del formato del equipo)
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

function eqDiaTotales(lista) {
  const conGan = lista.filter(e => e.ganancia !== null);
  return {
    cant: lista.length,
    total: lista.reduce((s, e) => s + e.precio, 0),
    ganancia: conGan.reduce((s, e) => s + e.ganancia, 0),
    sinCosto: lista.length - conGan.length,
  };
}

// "Venta: Apple iPhone 13 128GB · IMEI 3567… + Funda" → "Apple iPhone 13 128GB"
function _eqDiaNombre(desc) {
  return String(desc || '').replace(/^Venta:\s*/i, '').split(' · IMEI')[0].split(' (saldo')[0].split(' + ')[0].trim();
}

function _eqDiaHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── En pantalla ─────────────────────────────────────────────
let _eqDiaAbierto = false;
try { _eqDiaAbierto = localStorage.getItem('tpEqDiaAbierto') === '1'; } catch {}

function _eqDiaDueno() {
  return (typeof _cajaIsOwner !== 'undefined' && _cajaIsOwner) || (typeof tpEsDueno === 'function' && tpEsDueno());
}

function eqDiaToggle() {
  _eqDiaAbierto = !_eqDiaAbierto;
  try { localStorage.setItem('tpEqDiaAbierto', _eqDiaAbierto ? '1' : '0'); } catch {}
  renderEquiposDia();
}

function renderEquiposDia() {
  const cont = document.getElementById('caja-equipos-dia');
  if (!cont) return;
  _eqDiaEstilos();
  const lista = eqDiaLista(typeof MOVIMIENTOS !== 'undefined' ? MOVIMIENTOS : []);
  // Sin ventas de equipos, no ocupa lugar
  if (!lista.length) { cont.innerHTML = ''; cont.style.display = 'none'; return; }
  cont.style.display = '';
  const t = eqDiaTotales(lista);
  const f = n => (typeof fmt === 'function' ? fmt(n) : '$' + Math.round(n).toLocaleString('es-AR'));
  const e = s => (typeof esc === 'function' ? esc(s) : String(s));
  const dueno = _eqDiaDueno();
  // El total del día es "la plata del día": el empleado sin ese permiso ve
  // cuántos y cuáles, no la suma (igual que el resto de los totales)
  const verTotal = dueno || typeof tpPuede !== 'function' || tpPuede('totales');
  const filas = lista.map(x => `
    <div class="eqd-fila">
      <div class="eqd-main">
        <b>📱 ${e(x.nombre)}</b>
        <small>${[x.hora, x.metodo, x.vendedor && 'vendió ' + x.vendedor, x.cliente].filter(Boolean).map(e).join(' · ')}${x.saldo ? ' · <i>saldo de una seña</i>' : ''}${x.canje ? ` · 🔄 canje ${f(x.canje)}` : ''}</small>
      </div>
      <div class="eqd-plata">
        <b>${f(x.precio)}</b>
        ${dueno ? (x.ganancia !== null ? `<small class="${x.ganancia >= 0 ? 'eqd-gan' : 'eqd-per'}">${x.ganancia >= 0 ? 'gana' : 'pierde'} ${f(Math.abs(x.ganancia))}</small>` : '<small class="eqd-sc">sin costo</small>') : ''}
      </div>
    </div>`).join('');
  cont.innerHTML = `
    <button type="button" class="eqd-cab" onclick="eqDiaToggle()">
      <span>📱 <b>${t.cant} equipo${t.cant === 1 ? '' : 's'} vendido${t.cant === 1 ? '' : 's'}</b> en el día</span>
      <span class="eqd-cab-der">${verTotal ? `<b>${f(t.total)}</b> ` : ''}${_eqDiaAbierto ? '▲' : '▼'}</span>
    </button>
    ${_eqDiaAbierto ? `<div class="eqd-lista">${filas}
      ${dueno && lista.length > 1 ? `<div class="eqd-tot">Ganancia de los equipos: <b>${f(t.ganancia)}</b>${t.sinCosto ? ` <small>(${t.sinCosto} sin costo cargado, no cuenta${t.sinCosto === 1 ? '' : 'n'})</small>` : ''}</div>` : ''}
    </div>` : ''}`;
}

function _eqDiaEstilos() {
  if (document.getElementById('eqd-css')) return;
  const s = document.createElement('style');
  s.id = 'eqd-css';
  // Desde acá porque el CSS se sirve del caché
  s.textContent = `
  #caja-equipos-dia { margin: 10px 0; border-radius: 14px; border: 1px solid var(--border, rgba(128,128,128,.3));
    background: var(--card, #fff); overflow: hidden; }
  .eqd-cab { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px;
    padding: 12px 14px; border: 0; background: transparent; color: inherit; font-size: 15px; cursor: pointer; text-align: left; }
  .eqd-cab-der { white-space: nowrap; }
  .eqd-lista { border-top: 1px solid var(--border, rgba(128,128,128,.3)); padding: 4px 14px 10px; }
  .eqd-fila { display: flex; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px dashed var(--border, rgba(128,128,128,.25)); }
  .eqd-fila:last-of-type { border-bottom: 0; }
  .eqd-main { min-width: 0; }
  .eqd-main b { display: block; font-size: 14px; }
  .eqd-main small, .eqd-plata small { display: block; font-size: 12px; opacity: .75; }
  .eqd-plata { text-align: right; white-space: nowrap; }
  .eqd-gan { color: #10b981; opacity: 1 !important; font-weight: 700; }
  .eqd-per { color: #ef4444; opacity: 1 !important; font-weight: 700; }
  .eqd-sc { color: #f59e0b; opacity: 1 !important; }
  .eqd-tot { padding-top: 8px; font-size: 13px; }`;
  document.head.appendChild(s);
}
