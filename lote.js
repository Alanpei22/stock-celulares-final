// ══════════════════════════════════════════════════════════════
//  lote.js — Ingresar varios equipos de una
// ══════════════════════════════════════════════════════════════
//  Cuando entra una compra de 15 equipos, cargarlos uno por uno con el
//  formulario completo son 15 idas y vueltas. Acá:
//
//   1. Escaneás los IMEI uno atrás del otro (la cámara no se cierra).
//   2. Cada equipo entra a la lista con marca y modelo ya puestos (por el TAC
//      del IMEI, ver escaner.js).
//   3. Completás precio y lo que falte, en la misma pantalla.
//   4. Se guardan TODOS con una sola operación.
//
//  Dos cosas que importan más que la velocidad:
//   · El borrador se guarda en el celu en cada cambio. Si se cierra la app con
//     14 equipos escaneados, están cuando volvés.
//   · No entra dos veces el mismo IMEI, ni uno que ya esté en el stock.
// ══════════════════════════════════════════════════════════════
'use strict';

const _LOTE_KEY = 'loteBorrador';
const LOTE_ESTADOS = ['Nuevo', 'Usado', 'Reacondicionado'];

let _lote = null;   // { comun: {...}, filas: [...] }

function _loteVacio() {
  return {
    // moneda: en qué se cargan precio y costo de TODO el lote. Las compras
    // grandes se pagan en dólares, y tipear la conversión equipo por equipo es
    // donde se cuelan los errores.
    comun: { estado: 'Nuevo', ubicacion: '', garantiaMeses: 0, proveedor: '', moneda: 'ars' },
    filas: [],
  };
}

// La cotización con la que se convierte. Es la misma que usa el resto de la app.
function _loteDolar() {
  if (typeof getCurrentDolar === 'function') { const d = getCurrentDolar(); if (d > 0) return d; }
  if (typeof dolarBlue === 'number' && dolarBlue > 0) return dolarBlue;
  return 0;
}

function _loteEsUSD() { return (_lote && _lote.comun.moneda) === 'usd'; }

// ¿Se pueden ver y cargar los costos? Es la misma regla que en el resto: los
// costos son del dueño, no de quien atiende el mostrador.
function _loteVeCostos() {
  return typeof OWNER_MODE === 'undefined' ? true : !!OWNER_MODE;
}

function _loteGuardarBorrador() {
  try { localStorage.setItem(_LOTE_KEY, JSON.stringify(_lote)); } catch {}
}

function _loteLeerBorrador() {
  try {
    const d = JSON.parse(localStorage.getItem(_LOTE_KEY) || 'null');
    if (d && Array.isArray(d.filas)) return d;
  } catch {}
  return null;
}

function _loteBorrarBorrador() {
  try { localStorage.removeItem(_LOTE_KEY); } catch {}
}

// ── Abrir / cerrar ──────────────────────────────────────────
function abrirLote() {
  const guardado = _loteLeerBorrador();
  _lote = guardado || _loteVacio();
  if (guardado && guardado.filas.length) {
    toast(`Retomando el lote de ${guardado.filas.length} equipo${guardado.filas.length > 1 ? 's' : ''}`, 'info');
  }
  _loteRender();
  document.getElementById('lote-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function cerrarLote() {
  // El borrador NO se borra al cerrar: si cerraste sin querer con 14 equipos
  // escaneados, están cuando volvés a abrir.
  document.getElementById('lote-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function loteDescartar() {
  if (_lote && _lote.filas.length &&
      !confirm(`¿Descartar los ${_lote.filas.length} equipos del lote?`)) return;
  _lote = _loteVacio();
  _loteBorrarBorrador();
  _loteRender();
}

// ── Escanear varios seguidos ────────────────────────────────
function loteEscanear() {
  if (typeof abrirEscaner !== 'function') { toast('El lector no está disponible acá', 'error'); return; }
  abrirEscaner(imei => _loteAgregarImei(imei), {
    titulo: 'Escaneá los equipos, uno atrás del otro',
    continuo: true,               // no se cierra: el próximo equipo va enseguida
    validar: raw => (typeof imeiDesdeCodigo === 'function' ? imeiDesdeCodigo(raw) : null),
    noSirve: 'Ese no es el IMEI (puede ser la serie o el código del producto).',
  });
}

async function _loteAgregarImei(imei) {
  if (_lote.filas.some(f => f.imei === imei)) {
    toast('Ese equipo ya está en el lote', 'error');
    return;
  }
  const enStock = (typeof STOCK !== 'undefined' ? STOCK : []).find(p => p.imei === imei);
  if (enStock) {
    toast(`Ese IMEI ya está cargado: ${enStock.marca || ''} ${enStock.modelo || ''}`.trim(), 'error');
    return;
  }
  const fila = { imei, marca: '', modelo: '', almacenamiento: '', precio: '', costo: '', bateria: '' };
  _lote.filas.push(fila);
  _loteGuardarBorrador();
  _loteRender();
  // El modelo llega después (puede tener que bajar la tabla): se rellena cuando está
  if (typeof modeloPorImei === 'function') {
    const m = await modeloPorImei(imei);
    if (m && !fila.marca) {
      fila.marca = m.marca;
      fila.modelo = m.modelo;
      _loteGuardarBorrador();
      _loteRender();
    }
  }
}

function loteAgregarManual() {
  _lote.filas.push({ imei: '', marca: '', modelo: '', almacenamiento: '', precio: '', costo: '', bateria: '' });
  _loteGuardarBorrador();
  _loteRender();
  setTimeout(() => document.getElementById('lote-marca-' + (_lote.filas.length - 1))?.focus(), 60);
}

function loteBorrarFila(i) {
  _lote.filas.splice(i, 1);
  _loteGuardarBorrador();
  _loteRender();
}

function loteSetCampo(i, campo, valor) {
  if (!_lote.filas[i]) return;
  _lote.filas[i][campo] = valor;
  _loteGuardarBorrador();
  _loteTotales();
}

function loteSetComun(campo, valor) {
  _lote.comun[campo] = valor;
  _loteGuardarBorrador();
  if (campo === 'moneda') _loteRender();   // cambian los rótulos y los totales
}

// Cambiar entre pesos y dólares para todo el lote.
function loteMoneda(m) {
  if (m === 'usd' && !_loteDolar()) {
    toast('No tengo la cotización del dólar todavía', 'error');
    return;
  }
  loteSetComun('moneda', m === 'usd' ? 'usd' : 'ars');
}

// Copiar el precio (o el costo) de la primera fila a todas las vacías: en un
// lote del mismo modelo se carga una vez y listo.
function loteAplicarATodas(campo) {
  const primero = _lote.filas.find(f => String(f[campo] || '').trim());
  if (!primero) { toast('Cargá primero un valor en el primer equipo', 'error'); return; }
  let n = 0;
  _lote.filas.forEach(f => { if (!String(f[campo] || '').trim()) { f[campo] = primero[campo]; n++; } });
  _loteGuardarBorrador();
  _loteRender();
  toast(n ? `Copiado a ${n} equipo${n > 1 ? 's' : ''}` : 'Todos ya tenían valor', 'success');
}

// ── Pintar ──────────────────────────────────────────────────
function _loteRender() {
  const cont = document.getElementById('lote-filas');
  if (!cont || !_lote) return;

  document.getElementById('lote-estado').value = _lote.comun.estado || 'Nuevo';
  document.getElementById('lote-ubicacion').value = _lote.comun.ubicacion || '';
  document.getElementById('lote-garantia').value = _lote.comun.garantiaMeses || 0;
  document.getElementById('lote-proveedor').value = _lote.comun.proveedor || '';

  const usd = _loteEsUSD();
  const cot = _loteDolar();
  const btnArs = document.getElementById('lote-moneda-ars');
  const btnUsd = document.getElementById('lote-moneda-usd');
  if (btnArs && btnUsd) {
    btnArs.classList.toggle('lote-moneda--on', !usd);
    btnUsd.classList.toggle('lote-moneda--on', usd);
  }
  const cotEl = document.getElementById('lote-cotizacion');
  if (cotEl) {
    cotEl.textContent = usd
      ? (cot ? `Se convierte a $${cot.toLocaleString('es-AR')} por dólar` : 'Sin cotización')
      : '';
  }
  // Los costos son del dueño: si no está en modo dueño, que sepa por qué no los ve
  const avisoC = document.getElementById('lote-aviso-costo');
  if (avisoC) avisoC.classList.toggle('hidden', _loteVeCostos());

  if (!_lote.filas.length) {
    cont.innerHTML = `<p class="lote-vacio">Todavía no hay equipos.<br>
      Tocá <b>📷 Escanear equipos</b> y pasá uno atrás del otro: la cámara no se cierra hasta que termines.</p>`;
    _loteTotales();
    return;
  }

  const usdF = _loteEsUSD();
  cont.innerHTML = _lote.filas.map((f, i) => `
    <div class="lote-fila">
      <div class="lote-fila-top">
        <span class="lote-n">${i + 1}</span>
        <span class="lote-imei">${f.imei ? '…' + esc(f.imei.slice(-6)) : 'sin IMEI'}</span>
        <button type="button" class="lote-del" onclick="loteBorrarFila(${i})" title="Sacar del lote">✕</button>
      </div>
      <div class="lote-fila-campos">
        <input id="lote-marca-${i}" class="fi lote-in" type="text" placeholder="Marca" value="${esc(f.marca || '')}"
               oninput="loteSetCampo(${i},'marca',this.value)">
        <input class="fi lote-in" type="text" placeholder="Modelo" value="${esc(f.modelo || '')}"
               oninput="loteSetCampo(${i},'modelo',this.value)">
        <input class="fi lote-in lote-in--chico" type="text" placeholder="GB" value="${esc(f.almacenamiento || '')}"
               oninput="loteSetCampo(${i},'almacenamiento',this.value)">
        <input class="fi lote-in lote-in--chico" type="number" inputmode="numeric" placeholder="🔋%" value="${esc(f.bateria || '')}"
               oninput="loteSetCampo(${i},'bateria',this.value)">
        <input class="fi lote-in" type="number" inputmode="numeric" placeholder="${usdF ? 'Precio u$' : 'Precio $'}" value="${esc(f.precio || '')}"
               oninput="loteSetCampo(${i},'precio',this.value)">
        ${_loteVeCostos() ? `<input class="fi lote-in lote-in--costo" type="number" inputmode="numeric" placeholder="${usdF ? 'Costo u$' : 'Costo $'}" value="${esc(f.costo || '')}"
               oninput="loteSetCampo(${i},'costo',this.value)">` : ''}
      </div>
    </div>`).join('');
  _loteTotales();
}

function _loteTotales() {
  const el = document.getElementById('lote-totales');
  if (!el || !_lote) return;
  const n = _lote.filas.length;
  const sinPrecio = _lote.filas.filter(f => !(Number(f.precio) > 0)).length;
  const total = _lote.filas.reduce((s, f) => s + (Number(f.precio) || 0), 0);
  const costo = _lote.filas.reduce((s, f) => s + (Number(f.costo) || 0), 0);
  const usd = _loteEsUSD();
  const cot = _loteDolar();
  const plata = v => usd
    ? `u$${Number(v).toLocaleString('es-AR')}${cot ? ` <small>(${fmt(Math.round(v * cot))})</small>` : ''}`
    : fmt(v);
  el.innerHTML = n
    ? `<b>${n}</b> equipo${n > 1 ? 's' : ''} · venta ${plata(total)}` +
      (costo > 0 && _loteVeCostos()
        ? ` · costo ${plata(costo)} · <span class="lote-gan">ganancia ${plata(total - costo)}</span>` : '') +
      (sinPrecio ? ` · <span class="lote-falta">${sinPrecio} sin precio</span>` : '')
    : '';
  const btn = document.getElementById('lote-guardar');
  if (btn) btn.textContent = n ? `💾 Guardar ${n} equipo${n > 1 ? 's' : ''}` : '💾 Guardar';
}

// ── Guardar ─────────────────────────────────────────────────
async function loteGuardar() {
  if (!_lote || !_lote.filas.length) { toast('No hay equipos en el lote', 'error'); return; }

  // Validar antes de escribir nada
  const problemas = [];
  _lote.filas.forEach((f, i) => {
    if (!String(f.marca || '').trim())  problemas.push(`#${i + 1} sin marca`);
    if (!String(f.modelo || '').trim()) problemas.push(`#${i + 1} sin modelo`);
    if (!(Number(f.precio) > 0))        problemas.push(`#${i + 1} sin precio`);
  });
  if (problemas.length) {
    toast('Falta completar: ' + problemas.slice(0, 3).join(', ') + (problemas.length > 3 ? '…' : ''), 'error');
    return;
  }
  // Un IMEI repetido adentro del mismo lote (se puede cargar a mano)
  const imeis = _lote.filas.map(f => f.imei).filter(Boolean);
  if (new Set(imeis).size !== imeis.length) { toast('Hay un IMEI repetido en el lote', 'error'); return; }

  const btn = document.getElementById('lote-guardar');
  if (btn) btn.disabled = true;
  const ahora = new Date().toISOString();
  const comun = _lote.comun;
  const usd = _loteEsUSD();
  const cot = _loteDolar();
  if (usd && !cot) { toast('Sin cotización no puedo convertir el lote', 'error'); if (btn) btn.disabled = false; return; }

  try {
    const batch = db.batch();
    const docs = _lote.filas.map(f => {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const doc = {
        id,
        marca: String(f.marca).trim(),
        modelo: String(f.modelo).trim(),
        estado: comun.estado || 'Nuevo',
        precio: Number(f.precio) || 0,
        almacenamiento: String(f.almacenamiento || '').trim(),
        ram: '',
        imei: String(f.imei || '').trim(),
        notas: comun.proveedor ? 'Lote: ' + comun.proveedor : '',
        ubicacion: comun.ubicacion || '',
        fecha: ahora,
        vendido: false,
        _sourceDevice: (typeof getDeviceId === 'function') ? getDeviceId() : null,
      };
      // En dólares se guardan LAS DOS: el número que cargaste y el convertido,
      // con la cotización usada. Sin eso, mañana no se sabe a cuánto se compró.
      if (usd) {
        doc.precioUSD = Number(f.precio) || 0;
        doc.precio = Math.round((Number(f.precio) || 0) * cot);
        doc.moneda = 'usd';
        doc.dolarSnapshot = cot;
        if (Number(f.costo) > 0) {
          doc.costoUSD = Number(f.costo);
          doc.costo = Math.round(Number(f.costo) * cot);
        }
      } else if (Number(f.costo) > 0) doc.costo = Number(f.costo);
      if (Number(f.bateria) > 0) doc.bateria = Number(f.bateria);
      if (Number(comun.garantiaMeses) > 0) doc.garantiaMeses = Number(comun.garantiaMeses);
      batch.set(db.collection('stock').doc(id), doc);
      return doc;
    });

    await batch.commit();

    const n = docs.length;
    _lote = _loteVacio();
    _loteBorrarBorrador();
    _loteRender();
    cerrarLote();
    toast(`✅ ${n} equipos cargados al stock`, 'success');

    // Un solo aviso por el lote, no quince
    if (typeof tgNotify === 'function') {
      const total = docs.reduce((s, d) => s + (d.precio || 0), 0);
      tgNotify(`📦 <b>Lote cargado: ${n} equipos</b>\n`
        + docs.slice(0, 6).map(d => `• ${esc(d.marca)} ${esc(d.modelo)}${d.almacenamiento ? ' ' + esc(d.almacenamiento) : ''}`).join('\n')
        + (n > 6 ? `\n…y ${n - 6} más` : '')
        + `\n💵 Total: ${typeof tgMonto === 'function' ? tgMonto(total) : total}`);
    }
  } catch (e) {
    console.error('loteGuardar:', e);
    // El borrador queda: nada de perder 15 equipos escaneados por un error
    toast(e?.code === 'resource-exhausted'
      ? '⚠️ Cupo de Firebase agotado. El lote queda guardado en el celu: probá de nuevo más tarde.'
      : 'No se pudo guardar el lote. Queda guardado en el celu para reintentar.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}
