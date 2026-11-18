// ══════════════════════════════════════════════════════════════
//  🔄 Plan canje: el cliente entrega su celular en parte de pago
// ══════════════════════════════════════════════════════════════
//  Alan (17/11): "agregame un sistema para hacer plan canje". Antes había
//  un campo de texto "Permuta" escondido en "Más detalles": salía en el
//  comprobante y nada más. La caja registraba el precio ENTERO (aunque
//  entrara menos plata), y el celular recibido no aparecía en ningún lado.
//
//  Ahora, en la venta de equipo de la caja:
//   · se cargan los datos del usado que deja el cliente y cuánto se le toma,
//     con un valor sugerido sacado de lo que vale uno igual en tu stock;
//   · la caja registra solo lo que paga de diferencia (la plata que entra);
//   · la ganancia de la venta sigue siendo la del equipo vendido (el usado
//     es mercadería que entró, no plata perdida);
//   · el usado entra solo al Stock (con su costo = lo que se tomó), o a
//     "🔧 Equipos para arreglar" si necesita algo antes de venderse;
//   · el comprobante lo dice (permuta, valor tomado y lo que abonó).

const CANJE_MARGEN_DEF = 35;   // % que se le descuenta al precio de venta de uno igual

let CANJE_CFG = { margen: CANJE_MARGEN_DEF };
try { const c = JSON.parse(localStorage.getItem('tpCanjeCfg') || 'null'); if (c && c.margen >= 0) CANJE_CFG = c; } catch {}
let _canjeOn = false;
let _canjeCfgLeida = false;

// Dónde está el formulario: en la venta de equipo de la caja o en "Registrar
// venta" del Stock (index.html). Cada pantalla dice de dónde sale el total y
// con qué stock se compara. Arranca en la de la caja.
const _CJ_CAJA = {
  caja: 've-canje',
  total: () => (parseInt(String(document.getElementById('ve-precio')?.value || '').replace(/\D/g, ''), 10) || 0)
             + ((typeof vaTotal === 'function') ? vaTotal() : 0),
  stock: () => (typeof CAJA_STOCK !== 'undefined' ? CAJA_STOCK : []),
  cli: ['ve-cli-nombre', 've-cli-dni'],   // nombre y DNI del cliente en esta pantalla
};
let _cjCtx = _CJ_CAJA;

// La pantalla de venta del Stock la usa así: canjeEn({ caja, total, stock })
function canjeEn(ctx) {
  _cjCtx = Object.assign({}, _CJ_CAJA, ctx || {});
  canjeReset();
}

const _cjNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const _cjCap = s => String(s || '').replace(/\D/g, '');

// Precio de venta en pesos de un equipo del stock
function canjePrecioARS(p, dolar) {
  if (Number(p.precio) > 0 && p.moneda !== 'usd') return Number(p.precio);
  if (Number(p.precioUSD) > 0 && dolar > 0) return Math.round(Number(p.precioUSD) * dolar);
  return Number(p.precio) || 0;
}

// ¿Cuánto se le puede tomar? Sale del precio al que vendés uno igual (misma
// marca, modelo y capacidad), menos tu margen, y un poco menos si la batería
// o la estética no están bien. Sin uno igual en el stock, null: se pone a mano.
function canjeSugerido(eq, stock, cfg, dolar) {
  const mod = _cjNorm(eq && eq.modelo);
  if (!mod) return null;
  const mar = _cjNorm(eq.marca), cap = _cjCap(eq.almacenamiento);
  const iguales = (Array.isArray(stock) ? stock : []).filter(p => {
    if (!p || _cjNorm(p.modelo) !== mod) return false;
    if (mar && p.marca && _cjNorm(p.marca) !== mar) return false;
    if (cap && _cjCap(p.almacenamiento) && _cjCap(p.almacenamiento) !== cap) return false;
    return (p.estado || '').toLowerCase() !== 'nuevo';   // se compara con usados
  });
  const precios = iguales.map(p => canjePrecioARS(p, dolar)).filter(n => n > 0).sort((a, b) => a - b);
  if (!precios.length) return null;
  // La del medio: un precio raro (uno con caja y todo, o uno roto) no la mueve
  const ref = precios[Math.floor((precios.length - 1) / 2)];
  const margen = Math.min(90, Math.max(0, Number(cfg && cfg.margen) >= 0 ? Number(cfg.margen) : CANJE_MARGEN_DEF));
  let factor = 1 - margen / 100;
  const ajustes = [];
  const bat = Number(eq.bateria) || 0;
  if (bat && bat < 80) { factor -= 0.10; ajustes.push('batería baja −10%'); }
  else if (bat && bat < 85) { factor -= 0.05; ajustes.push('batería −5%'); }
  const est = String(eq.estetico || '').charAt(0).toUpperCase();
  if (est === 'B') { factor -= 0.05; ajustes.push('marcas de uso −5%'); }
  if (est === 'C') { factor -= 0.15; ajustes.push('bastante marcado −15%'); }
  // Redondeado para abajo, de a $5.000 (nadie toma un celu a $312.437)
  const valor = Math.max(0, Math.floor(ref * Math.max(0, factor) / 5000) * 5000);
  return { valor, ref, iguales: precios.length, margen, ajustes };
}

// Lo que paga el cliente de diferencia
function canjeSaldo(total, valor) {
  return Math.max(0, (Number(total) || 0) - (Number(valor) || 0));
}

// null si está bien; si no, qué falta
function canjeValidar(c, total, cliente) {
  if (!c) return null;
  if (!c.marca && !c.modelo) return 'Plan canje: poné la marca o el modelo del equipo que deja';
  if (!(c.valor > 0)) return 'Plan canje: poné cuánto se le toma el equipo';
  if (c.valor > (Number(total) || 0)) return 'Plan canje: lo que se le toma no puede ser más que lo que se lleva';
  if (c.imei && c.imei.length !== 15) return 'Plan canje: el IMEI del equipo que deja tiene que tener 15 números';
  // Comprarle un usado a alguien sin saber quién es, no: si aparece robado,
  // es lo primero que te piden
  if (!cliente || !cliente.nombre || !cliente.dni) return 'Plan canje: cargá nombre y DNI del cliente (es quien te vende el usado)';
  if (c.destino === 'arreglo' && !c.falla) return 'Plan canje: anotá qué necesita arreglar';
  return null;
}

function canjeNombre(c) {
  return [c.marca, c.modelo, c.almacenamiento].filter(Boolean).join(' ') || 'Equipo';
}

// El usado, como equipo del Stock (listo para vender)
function canjeDocStock(c, cliente, venta, ahoraIso, precioSugerido) {
  const d = {
    marca: c.marca || '', modelo: c.modelo || '', estado: 'Usado',
    precio: Number(precioSugerido) || 0,
    almacenamiento: c.almacenamiento || '', ram: '', imei: c.imei || '',
    notas: ['Entró por plan canje', c.notas].filter(Boolean).join(' · '),
    ubicacion: 'Depósito', fecha: ahoraIso, vendido: false,
    costo: Number(c.valor) || 0,
    origen: 'canje',
    canje: { cliente: cliente.nombre || '', dni: cliente.dni || '', tel: cliente.tel || '',
             valor: Number(c.valor) || 0, fecha: ahoraIso, venta: venta || '' },
  };
  if (c.bateria) d.bateria = Number(c.bateria);
  if (c.color) d.color = c.color;
  // Sin precio de referencia, que se note que falta ponérselo
  if (!d.precio) d.sinPrecio = true;
  return d;
}

// El usado, como equipo para arreglar (🔧 Equipos para arreglar)
function canjeDocArreglo(c, cliente, venta, ahoraIso) {
  return {
    marca: c.marca || '', modelo: c.modelo || '', falla: c.falla || 'revisar',
    almacenamiento: c.almacenamiento || '', color: c.color || '', imei: c.imei || '',
    bateria: Number(c.bateria) || null,
    notas: ['Entró por plan canje de ' + (cliente.nombre || 'un cliente') + (venta ? ' (compró ' + venta + ')' : ''), c.notas].filter(Boolean).join(' · '),
    costoCompra: Number(c.valor) || 0, costoArreglo: 0,
    estado: 'pendiente', activo: true, fecha: ahoraIso, origen: 'canje',
  };
}

// ── Formulario (dentro de la venta de equipo de la caja) ─────────────
const _cjV = id => String(document.getElementById(id)?.value ?? '').trim();

function canjeLeer() {
  if (!_canjeOn) return null;
  return {
    marca: _cjV('cj-marca'), modelo: _cjV('cj-modelo'), almacenamiento: _cjV('cj-cap'),
    color: _cjV('cj-color'), imei: _cjV('cj-imei').replace(/\D/g, ''),
    bateria: Math.min(100, parseInt(_cjV('cj-bat'), 10) || 0) || null,
    estetico: _cjV('cj-estetico'),
    valor: parseInt(_cjV('cj-valor').replace(/\D/g, ''), 10) || 0,
    destino: _cjV('cj-destino') || 'stock', falla: _cjV('cj-falla'),
    imeiOk: !!document.getElementById('cj-chk-imei')?.checked,
    cuentasOk: !!document.getElementById('cj-chk-cuentas')?.checked,
  };
}

function canjeReset() {
  _canjeOn = false;
  const box = document.getElementById(_cjCtx.caja);
  if (box) box.innerHTML = _canjeBotonHtml();
}

function _canjeBotonHtml() {
  return `<button type="button" class="cj-add" onclick="canjeActivar()">🔄 <b>Plan canje</b> — deja su celular en parte de pago</button>`;
}

function canjeActivar() {
  _canjeOn = true;
  _canjeEstilos();
  _canjeLeerCfg();
  const box = document.getElementById(_cjCtx.caja);
  if (!box) return;
  // Clases propias (cj-…): antes usaba las de la caja (precio-fg,
  // ventaeq-g2) y en "Registrar venta" del Stock, que no las tiene, se veía
  // todo desarmado.
  box.innerHTML = `
    <div class="cj-box">
      <div class="cj-hd">
        <div><b>🔄 Plan canje</b><small>El equipo que deja en parte de pago</small></div>
        ${_canjeDueno() ? `<button type="button" class="cj-cfg" onclick="canjeConfigurar()" title="Cuánto se le descuenta al precio de venta">⚙️ ${CANJE_CFG.margen}%</button>` : ''}
        <button type="button" class="cj-x" onclick="canjeReset();_canjeTotales()" title="Sacar el canje">✕</button>
      </div>
      <div class="cj-cli hidden" id="cj-cli"></div>
      <div class="cj-fg"><label>IMEI <small>(marcá *#06# o escanealo)</small></label>
        <div class="cj-fila"><input id="cj-imei" class="cj-in" type="text" inputmode="numeric" maxlength="15" placeholder="15 números" autocomplete="off" oninput="canjeRecalcular()">
        <button type="button" class="cj-cam" onclick="canjeEscanearImei()" title="Escanear el IMEI">📷</button></div></div>
      <div class="cj-g2">
        <div class="cj-fg"><label>Marca</label><input id="cj-marca" class="cj-in" type="text" placeholder="iPhone" autocomplete="off" oninput="canjeRecalcular()"></div>
        <div class="cj-fg"><label>Modelo</label><input id="cj-modelo" class="cj-in" type="text" placeholder="iPhone 11" autocomplete="off" oninput="canjeRecalcular()"></div>
        <div class="cj-fg"><label>Capacidad</label><input id="cj-cap" class="cj-in" type="text" placeholder="128GB" autocomplete="off" oninput="canjeRecalcular()"></div>
        <div class="cj-fg"><label>Batería %</label><input id="cj-bat" class="cj-in" type="number" inputmode="numeric" placeholder="86" oninput="canjeRecalcular()"></div>
        <div class="cj-fg"><label>Estética</label>
          <select id="cj-estetico" class="cj-in" onchange="canjeRecalcular()">
            <option value="A">A · impecable</option><option value="B">B · marcas de uso</option><option value="C">C · muy marcado</option>
          </select></div>
        <div class="cj-fg"><label>Color</label><input id="cj-color" class="cj-in" type="text" placeholder="Negro" autocomplete="off"></div>
      </div>
      <div class="cj-sug" id="cj-sug"></div>
      <div class="cj-fg"><label>Se le toma en *</label><input id="cj-valor" class="cj-in cj-valor" type="number" inputmode="numeric" placeholder="$ 0" oninput="_canjeTotales()"></div>
      <div class="cj-g2">
        <div class="cj-fg"><label>¿Adónde va?</label>
          <select id="cj-destino" class="cj-in" onchange="_canjeDestino()">
            <option value="stock">📱 Al stock</option>
            <option value="arreglo">🔧 A arreglar</option>
          </select></div>
        <div class="cj-fg hidden" id="cj-falla-wrap"><label>¿Qué necesita?</label><input id="cj-falla" class="cj-in" type="text" placeholder="Batería, módulo…" autocomplete="off"></div>
      </div>
      <label class="cj-chk"><input type="checkbox" id="cj-chk-imei"> <span>Consulté el IMEI en ENACOM: no tiene denuncia</span></label>
      <label class="cj-chk"><input type="checkbox" id="cj-chk-cuentas"> <span>iCloud / Google borrado y restablecido</span></label>
      <div class="cj-tot" id="cj-tot"></div>
    </div>`;
  // Que el aviso de "falta el DNI" se vaya apenas lo escriben
  (_cjCtx.cli || []).forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._cjOye) { el.addEventListener('input', _canjeTotales); el._cjOye = true; }
  });
  canjeRecalcular();
  setTimeout(() => document.getElementById('cj-imei')?.focus(), 50);
}

// 📷 El IMEI del equipo que deja, con la cámara. El lector de siempre lo
// valida y, por los primeros números, completa marca y modelo.
function canjeEscanearImei() {
  if (typeof escanearImei === 'function') escanearImei('cj-imei', { marca: 'cj-marca', modelo: 'cj-modelo' });
  else toast('El lector no está disponible acá', 'error');
}

function _canjeDueno() {
  return (typeof _cajaIsOwner !== 'undefined' && _cajaIsOwner) || (typeof tpEsDueno === 'function' && tpEsDueno());
}

function _canjeDestino() {
  document.getElementById('cj-falla-wrap')?.classList.toggle('hidden', _cjV('cj-destino') !== 'arreglo');
}

let _canjeUltSug = null;
function canjeRecalcular() {
  const c = canjeLeer();
  const el = document.getElementById('cj-sug');
  if (!c || !el) return;
  const dolar = (typeof getCurrentDolar === 'function' ? getCurrentDolar() : 0) || 0;
  const s = canjeSugerido(c, _cjCtx.stock(), CANJE_CFG, dolar);
  _canjeUltSug = s;
  const f = n => (typeof fmt === 'function' ? fmt(n) : '$' + Math.round(n).toLocaleString('es-AR'));
  if (!c.modelo) el.innerHTML = '';
  else if (!s) el.innerHTML = `<span class="cj-sug-no">No hay uno igual en tu stock para comparar: poné el valor a mano.</span>`;
  else el.innerHTML = `💡 Sugerido: <b>${f(s.valor)}</b>
      <small>Vendés uno igual a ${f(s.ref)}${s.iguales > 1 ? ` (${s.iguales} en stock)` : ''} · menos ${s.margen}%${s.ajustes.length ? ' · ' + s.ajustes.join(' · ') : ''}</small>
      <button type="button" class="cj-usar" onclick="canjeUsarSugerido()">Usar</button>`;
  _canjeTotales();
}

function canjeUsarSugerido() {
  const v = document.getElementById('cj-valor');
  if (v && _canjeUltSug) { v.value = _canjeUltSug.valor; _canjeTotales(); }
}

// Total − canje = lo que paga
function _canjeTotales() {
  const el = document.getElementById('cj-tot');
  const total = _cjCtx.total();
  const c = canjeLeer();
  if (!el || !c) return;
  const f = n => (typeof fmt === 'function' ? fmt(n) : '$' + Math.round(n).toLocaleString('es-AR'));
  if (!total) { el.innerHTML = '<small>Poné el precio del equipo que se lleva para ver la diferencia.</small>'; return; }
  // Sin nombre y DNI no se puede confirmar: avisarlo acá y no al final
  const cliEl = document.getElementById('cj-cli');
  if (cliEl) {
    const [nId, dId] = _cjCtx.cli || [];
    const faltan = [];
    if (nId && !String(document.getElementById(nId)?.value || '').trim()) faltan.push('nombre');
    if (dId && !String(document.getElementById(dId)?.value || '').trim()) faltan.push('DNI');
    cliEl.classList.toggle('hidden', !faltan.length);
    cliEl.textContent = faltan.length ? `⚠️ Para el canje cargá ${faltan.join(' y ')} del cliente (arriba, en los datos del comprador)` : '';
  }
  const pasa = c.valor > total;
  el.innerHTML = `
    <div><span>Se lleva</span><b>${f(total)}</b></div>
    <div><span>Deja su equipo</span><b>− ${f(c.valor)}</b></div>
    <div class="cj-paga${pasa ? ' cj-mal' : ''}"><span>${pasa ? '⚠️ Lo que se toma es más que lo que se lleva' : 'Paga de diferencia'}</span><b>${pasa ? '' : f(canjeSaldo(total, c.valor))}</b></div>`;
}

// ── Margen (lo define el dueño; se guarda en config/canje) ──
async function _canjeLeerCfg() {
  if (_canjeCfgLeida || typeof db === 'undefined' || !db) return;
  _canjeCfgLeida = true;
  try {
    const d = await db.collection('config').doc('canje').get();
    if (d.exists && Number(d.data().margen) >= 0) {
      CANJE_CFG = { margen: Number(d.data().margen) };
      try { localStorage.setItem('tpCanjeCfg', JSON.stringify(CANJE_CFG)); } catch {}
      canjeRecalcular();
    }
  } catch (e) { console.warn('canje cfg:', e); }
}

async function canjeConfigurar() {
  const r = prompt('🔄 Plan canje: ¿qué % le descontás al precio de venta de uno igual para tomarlo?\n\n'
    + 'Ej: 35 → si vendés uno igual a $500.000, se sugiere tomarlo en $325.000.', String(CANJE_CFG.margen));
  if (r === null) return;
  const n = parseFloat(String(r).replace(',', '.'));
  if (!(n >= 0 && n <= 90)) { toast('Poné un número entre 0 y 90', 'error'); return; }
  if (!_canjeDueno()) { toast('El margen lo define el dueño', 'error'); return; }
  try {
    await db.collection('config').doc('canje').set({ margen: n, actualizado: new Date().toISOString() });
    CANJE_CFG = { margen: n };
    try { localStorage.setItem('tpCanjeCfg', JSON.stringify(CANJE_CFG)); } catch {}
    toast(`🔄 Plan canje: se sugiere el precio de venta menos ${n}%`, 'success');
    canjeRecalcular();
  } catch (e) { console.error('canje cfg:', e); toast('No se pudo guardar', 'error'); }
}

// Después de la venta: el usado entra al stock o a "para arreglar"
async function canjeGuardarEquipo(c, cliente, ventaNombre) {
  const ahora = new Date().toISOString();
  if (c.destino === 'arreglo') {
    const id = 'arr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await db.collection('equipos_arreglo').doc(id).set(canjeDocArreglo(c, cliente, ventaNombre, ahora));
    return { donde: 'arreglo', id };
  }
  const dolar = (typeof getCurrentDolar === 'function' ? getCurrentDolar() : 0) || 0;
  const s = canjeSugerido(c, _cjCtx.stock(), CANJE_CFG, dolar);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const doc = { id, ...canjeDocStock(c, cliente, ventaNombre, ahora, s ? s.ref : 0),
                _sourceDevice: (typeof getDeviceId === 'function') ? getDeviceId() : null };
  await db.collection('stock').doc(id).set(doc);
  if (typeof movStock === 'function') movStock({ tipo: 'equipo', id, doc, cant: 1, motivo: 'canje', detalle: 'de ' + (cliente.nombre || '') });
  return { donde: 'stock', id };
}

function _canjeEstilos() {
  if (document.getElementById('cj-css')) return;
  const s = document.createElement('style');
  s.id = 'cj-css';
  // Desde acá: el CSS se sirve del caché
  s.textContent = `
  .cj-add { width: 100%; margin: 12px 0 6px; padding: 14px; border-radius: 12px; border: 2px dashed var(--accent, #C8965A);
    background: transparent; color: inherit; font-size: 14px; cursor: pointer; text-align: left; line-height: 1.3; }
  .cj-box { margin: 12px 0; border: 2px solid var(--accent, #C8965A); border-radius: 14px; padding: 14px; background: rgba(200,150,90,.06); }
  .cj-hd { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .cj-hd > div { flex: 1; min-width: 0; }
  .cj-hd b { display: block; font-size: 16px; }
  .cj-hd small { display: block; font-size: 12px; opacity: .7; }
  .cj-cfg { border: 1px solid rgba(128,128,128,.4); border-radius: 8px; background: transparent; color: inherit; font-size: 12px; padding: 5px 8px; cursor: pointer; white-space: nowrap; }
  .cj-x { border: 0; background: transparent; font-size: 18px; cursor: pointer; color: inherit; padding: 4px 6px; }
  .cj-cli { background: rgba(239,68,68,.12); color: #ef4444; border-radius: 10px; padding: 8px 10px; font-size: 13px; font-weight: 600; margin-bottom: 10px; }
  .cj-g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
  .cj-fg { margin-bottom: 10px; min-width: 0; }
  .cj-fg label { display: block; font-size: 11.5px; font-weight: 700; letter-spacing: .3px; text-transform: uppercase; opacity: .7; margin-bottom: 4px; }
  .cj-fg label small { text-transform: none; font-weight: 500; letter-spacing: 0; }
  .cj-in { width: 100%; box-sizing: border-box; padding: 11px 12px; border: 1.5px solid var(--border, rgba(128,128,128,.35)); border-radius: 10px;
    background: var(--card, #fff); color: var(--text, inherit); font-size: 15px; font-family: inherit; outline: none; -webkit-appearance: none; appearance: none; }
  .cj-in:focus { border-color: var(--accent, #C8965A); }
  select.cj-in { background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
    background-position: calc(100% - 16px) 50%, calc(100% - 11px) 50%; background-size: 5px 5px; background-repeat: no-repeat; padding-right: 28px; }
  .cj-fila { display: flex; gap: 8px; }
  .cj-fila .cj-in { flex: 1; }
  .cj-cam { flex: 0 0 auto; width: 48px; border-radius: 10px; border: 1.5px solid var(--accent, #C8965A); background: transparent; font-size: 20px; cursor: pointer; }
  .cj-sug { font-size: 13.5px; margin: 2px 0 10px; line-height: 1.35; }
  .cj-sug:empty { display: none; }
  .cj-sug small { display: block; opacity: .75; margin-top: 2px; }
  .cj-sug-no { opacity: .75; }
  .cj-usar { margin-top: 6px; border: 0; border-radius: 8px; padding: 7px 14px; background: var(--accent, #C8965A); color: #111; font-weight: 700; cursor: pointer; }
  .cj-valor { font-size: 20px; font-weight: 800; }
  .cj-chk { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; margin: 6px 0; cursor: pointer; line-height: 1.3; }
  .cj-chk input { margin-top: 2px; flex: 0 0 auto; }
  .cj-tot { margin-top: 10px; border-top: 1px dashed rgba(128,128,128,.4); padding-top: 10px; font-size: 14px; }
  .cj-tot div { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
  .cj-paga { font-size: 18px; font-weight: 800; color: #10b981; }
  .cj-mal { color: #ef4444; font-size: 14px; }
  .cj-box .hidden { display: none !important; }`;
  document.head.appendChild(s);
}
