// ══════════════════════════════════════════
//  clientes.js — CRM básico
//  Colección Firestore: clientes
//  ID del doc = teléfono normalizado (últimos 10 dígitos)
//  Schema: { telefono, telefonoRaw, nombre, dni, email, notas,
//            totalReparaciones, totalGastado, primeraVez, ultimaVez,
//            createdAt, updatedAt }
// ══════════════════════════════════════════
'use strict';

// Normaliza un teléfono a su clave: solo dígitos, últimos 10.
// "11 1234-5678" → "1112345678" ; "+54 9 11 1234 5678" → "1112345678"
function _cliKey(tlf) {
  const digits = String(tlf || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// DNI → solo dígitos ("30.123.456" → "30123456"). Sirve para buscar igual
// aunque uno lo haya escrito con puntos y otro sin.
function _cliDni(dni) {
  const d = String(dni || '').replace(/\D/g, '');
  return d.length >= 6 && d.length <= 9 ? d : '';
}

function _cliEsc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Upsert: crea o actualiza la ficha del cliente ──
// Se llama al guardar una reparación. Mantiene datos básicos al día.
async function upsertCliente({ tlf, nombre, dni, email }) {
  const key = _cliKey(tlf);
  if (!key) return null; // sin teléfono no hay cliente
  const ref = db.collection('clientes').doc(key);
  const ahora = new Date().toISOString();
  try {
    const snap = await ref.get();
    if (snap.exists) {
      // Actualizar solo campos que vengan con valor (no pisar con vacío)
      const upd = { updatedAt: ahora, ultimaVez: ahora };
      if (nombre) upd.nombre = nombre;
      if (dni)    { upd.dni = dni; upd.dniKey = _cliDni(dni); }
      if (email)  upd.email = email;
      if (tlf)    upd.telefonoRaw = tlf;
      await ref.set(upd, { merge: true });
    } else {
      await ref.set({
        telefono: key,
        telefonoRaw: tlf || '',
        nombre: nombre || '',
        dni: dni || '',
        dniKey: _cliDni(dni),   // para encontrarlo por DNI al tomar un equipo
        email: email || '',
        notas: '',
        primeraVez: ahora,
        ultimaVez: ahora,
        createdAt: ahora,
        updatedAt: ahora,
      });
    }
    return key;
  } catch (e) {
    console.error('upsertCliente:', e);
    return null;
  }
}

// Busca la ficha por teléfono (para autocompletar el form de reparación)
async function getClientePorTel(tlf) {
  const key = _cliKey(tlf);
  if (!key) return null;
  try {
    const snap = await db.collection('clientes').doc(key).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  } catch { return null; }
}

// Devuelve todas las reparaciones de un cliente (desde el array en memoria REPAIRS)
function _historialCliente(key) {
  if (typeof REPAIRS === 'undefined' || !Array.isArray(REPAIRS)) return [];
  return REPAIRS
    .filter(r => _cliKey(r.tlf) === key)
    .sort((a, b) => (b.fechaIngreso || '').localeCompare(a.fechaIngreso || ''));
}

// ══════════════════════════════════════════
//  FICHA DE CLIENTE (modal)
// ══════════════════════════════════════════
let _clienteFichaKey = null;

async function openClienteFicha(tlf) {
  const key = _cliKey(tlf);
  if (!key) { toast('Sin teléfono para buscar', 'info'); return; }
  _clienteFichaKey = key;

  let cli = await getClientePorTel(tlf);
  const hist = _historialCliente(key);

  // Si no hay ficha pero hay historial, armar una "virtual" con los datos de la última reparación
  if (!cli && hist.length) {
    const ult = hist[0];
    cli = { telefonoRaw: ult.tlf, nombre: ult.nombre || '', dni: ult.dni || '', email: '', notas: '' };
  }
  if (!cli) cli = { telefonoRaw: tlf, nombre: '', dni: '', email: '', notas: '' };

  const totalGastado = hist
    .filter(r => r.estado === 'entregado')
    .reduce((s, r) => s + (Number(r.monto) || 0), 0);
  const entregadas = hist.filter(r => r.estado === 'entregado').length;

  const modal = document.getElementById('cliente-ficha-modal');
  const body = document.getElementById('cliente-ficha-body');
  if (!modal || !body) return;

  body.innerHTML = `
    <div class="cli-ficha-hero">
      <div class="cli-ficha-avatar">${(cli.nombre || '?').charAt(0).toUpperCase()}</div>
      <div class="cli-ficha-id">
        <div class="cli-ficha-nombre">${_cliEsc(cli.nombre || 'Sin nombre')}</div>
        <div class="cli-ficha-tel">📞 ${_cliEsc(cli.telefonoRaw || tlf)}</div>
        ${cli.dni ? `<div class="cli-ficha-dni">DNI: ${_cliEsc(cli.dni)}</div>` : ''}
      </div>
      <a class="cli-ficha-wa" href="https://wa.me/${_waPhone(cli.telefonoRaw || tlf)}" target="_blank" title="WhatsApp" onclick="if (waAppActiva()) { event.preventDefault(); waAbrir(this.href); }">🟢</a>
    </div>

    <div class="cli-ficha-stats">
      <div class="cli-stat"><span class="cli-stat-num">${hist.length}</span><span class="cli-stat-lbl">Reparaciones</span></div>
      <div class="cli-stat"><span class="cli-stat-num">${entregadas}</span><span class="cli-stat-lbl">Entregadas</span></div>
      <div class="cli-stat"><span class="cli-stat-num">$${totalGastado.toLocaleString('es-AR')}</span><span class="cli-stat-lbl">Total gastado</span></div>
    </div>

    <div class="cli-ficha-notas">
      <label>📝 Notas del cliente</label>
      <textarea id="cli-ficha-notas-input" rows="2" placeholder="Ej: cliente frecuente, paga al retirar...">${_cliEsc(cli.notas || '')}</textarea>
      <button class="cli-notas-save" onclick="_saveClienteNotas()">Guardar nota</button>
    </div>

    <div class="cli-ficha-hist-title">Historial de reparaciones</div>
    <div class="cli-ficha-hist">
      ${hist.length ? hist.map(r => `
        <div class="cli-hist-row" onclick="closeClienteFicha();${typeof openRepairDetail === 'function' ? `openRepairDetail('${_cliEsc(r.id)}')` : ''}">
          <div class="cli-hist-info">
            <span class="cli-hist-equipo">N°${r.nOrden || '?'} · ${_cliEsc(r.marca || '')} ${_cliEsc(r.modelo || '')}</span>
            <span class="cli-hist-arreglo">${_cliEsc(r.arreglo || '')} · ${_fmtFechaCli(r.fechaIngreso)}</span>
          </div>
          <div class="cli-hist-right">
            ${r.monto ? `<span class="cli-hist-monto">$${Number(r.monto).toLocaleString('es-AR')}</span>` : ''}
            <span class="cli-hist-estado cli-estado-${_cliEsc(r.estado || '')}">${_cliEsc(_estadoLabel(r.estado))}</span>
          </div>
        </div>
      `).join('') : '<div class="cli-hist-empty">Sin reparaciones registradas</div>'}
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('cliente-ficha-overlay')?.classList.remove('hidden');
}

function closeClienteFicha() {
  document.getElementById('cliente-ficha-modal')?.classList.add('hidden');
  document.getElementById('cliente-ficha-overlay')?.classList.add('hidden');
  _clienteFichaKey = null;
}

async function _saveClienteNotas() {
  if (!_clienteFichaKey) return;
  const notas = document.getElementById('cli-ficha-notas-input')?.value.trim() || '';
  try {
    await db.collection('clientes').doc(_clienteFichaKey).set(
      { notas, updatedAt: new Date().toISOString() }, { merge: true }
    );
    toast('Nota guardada', 'success');
  } catch (e) {
    console.error('saveClienteNotas:', e);
    toast('Error al guardar la nota', 'error');
  }
}

function _fmtFechaCli(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' }); }
  catch { return '—'; }
}
function _estadoLabel(e) {
  const map = { reparando: 'Reparando', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado', no_van: 'No va' };
  return map[e] || e || '—';
}
function _waPhone(tlf) {
  let p = String(tlf || '').replace(/\D/g, '');
  if (p.length === 10) p = '549' + p;
  else if (p.length === 11 && p.startsWith('0')) p = '549' + p.slice(1);
  else if (!p.startsWith('54')) p = '549' + p;
  return p;
}

// ══════════════════════════════════════════
//  AUTOCOMPLETAR en el form de reparación
// ══════════════════════════════════════════
// Al salir del campo teléfono, si el cliente ya existe:
// - completa nombre/dni si están vacíos
// - muestra un hint con cuántas reparaciones tiene + link a la ficha
// Al escribir el teléfono, completa nombre y DNI si el cliente ya vino antes.
// Se usa desde el alta de reparación y desde la venta de un equipo, que tienen
// los mismos tres campos con distintos ids.
async function _repTelAutocomplete(tlf) {
  return _telAutocomplete(tlf, {
    hint: 'rep-cliente-hint', nombre: 'rep-fi-nombre', dni: 'rep-fi-dni',
  });
}

async function _sellTelAutocomplete(tlf) {
  return _telAutocomplete(tlf, {
    hint: 'sell-cli-hint', nombre: 'sell-cli-nombre', dni: 'sell-cli-dni',
  });
}

async function _telAutocomplete(tlf, ids) {
  const hint = document.getElementById(ids.hint);
  const key = _cliKey(tlf);
  if (!key) { if (hint) hint.classList.add('hidden'); return; }

  // Buscar historial local (sin reads) primero
  const hist = _historialCliente(key);
  let cli = null;
  if (hist.length) {
    const ult = hist[0];
    cli = { nombre: ult.nombre || '', dni: ult.dni || '' };
  } else {
    // Si no hay historial en memoria, intentar la ficha en Firestore
    cli = await getClientePorTel(tlf);
  }
  if (!cli) { if (hint) hint.classList.add('hidden'); return; }

  // Completar campos vacíos (no pisar lo que el usuario ya escribió)
  const nomEl = document.getElementById(ids.nombre);
  const dniEl = document.getElementById(ids.dni);
  if (nomEl && !nomEl.value.trim() && cli.nombre) nomEl.value = cli.nombre;
  if (dniEl && !dniEl.value.trim() && cli.dni) dniEl.value = cli.dni;

  // Mostrar hint
  if (hint) {
    if (hist.length > 0) {
      hint.innerHTML = `✅ Cliente conocido — <b>${hist.length}</b> reparación${hist.length !== 1 ? 'es' : ''} previa${hist.length !== 1 ? 's' : ''}. <a onclick="openClienteFicha('${_cliEsc(tlf)}')">Ver ficha →</a>`;
    } else {
      hint.innerHTML = `✅ Cliente registrado: <b>${_cliEsc(cli.nombre || 'sin nombre')}</b>`;
    }
    hint.classList.remove('hidden');
  }
}

// ══════════════════════════════════════════
//  POR DNI: poner el DNI y que se carguen los datos
// ══════════════════════════════════════════
// Alan (14/11): "quiero poner el DNI del cliente y que se carguen sus datos
// cuando tomo un equipo". Antes solo se autocompletaba por teléfono, y el
// teléfono es lo que más cambia (y lo que más se escribe mal); el DNI no.

// Lo que ya está en memoria (reparaciones y celulares vendidos), sin gastar
// lecturas. Devuelve el dato más nuevo que tenga ese DNI.
function cliBuscarDniLocal(dni, repairs, stock) {
  const k = _cliDni(dni);
  if (!k) return null;
  const cands = [];
  (Array.isArray(repairs) ? repairs : []).forEach(r => {
    if (r && !r._borrado && _cliDni(r.dni) === k) cands.push({ nombre: r.nombre || '', tlf: r.tlf || '', fecha: r.fechaIngreso || '', de: 'rep' });
  });
  (Array.isArray(stock) ? stock : []).forEach(e => {
    if (e && _cliDni(e.clienteDni) === k) cands.push({ nombre: e.clienteNombre || '', tlf: e.clienteTel || '', fecha: e.fecha_venta || '', de: 'compra' });
  });
  if (!cands.length) return null;
  cands.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  // El nombre y el teléfono, del más nuevo que los tenga (uno viejo puede
  // tener el teléfono y el último no)
  const nombre = (cands.find(c => c.nombre) || {}).nombre || '';
  const tlf = (cands.find(c => _cliKey(c.tlf)) || {}).tlf || '';
  return {
    nombre, tlf,
    reparaciones: cands.filter(c => c.de === 'rep').length,
    compras: cands.filter(c => c.de === 'compra').length,
  };
}

// Si no está en memoria (cliente de hace mucho), la ficha en Firestore.
// Las fichas nuevas tienen `dniKey`; las viejas solo `dni` como se escribió,
// así que se prueba también sin puntos y con puntos. Es una consulta por
// cliente nuevo, nada más.
async function cliBuscarDniFicha(dni) {
  const k = _cliDni(dni);
  if (!k || typeof db === 'undefined' || !db) return null;
  const conPuntos = k.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const intentos = [['dniKey', k], ['dni', k], ['dni', conPuntos]];
  for (const [campo, valor] of intentos) {
    try {
      const s = await db.collection('clientes').where(campo, '==', valor).limit(1).get();
      if (!s.empty) { const d = s.docs[0]; return { id: d.id, ...d.data() }; }
    } catch (e) { console.warn('cliente por DNI:', e); return null; }
  }
  return null;
}

// Para no buscar dos veces lo mismo (blur + Enter)
let _cliDniUltimo = '';

async function _dniAutocomplete(dni, ids, forzar) {
  const k = _cliDni(dni);
  const hint = document.getElementById(ids.hint);
  if (!k) return;
  // Ya buscado y con el nombre puesto: no repetir (el blur después del oninput)
  if (!forzar && k === _cliDniUltimo && ((document.getElementById(ids.nombre) || {}).value || '').trim()) return;
  _cliDniUltimo = k;
  let cli = cliBuscarDniLocal(k, typeof REPAIRS !== 'undefined' ? REPAIRS : [], typeof STOCK !== 'undefined' ? STOCK : []);
  let deFicha = false;
  if (!cli || !cli.nombre || !_cliKey(cli.tlf)) {
    const f = await cliBuscarDniFicha(k);
    if (f) {
      deFicha = true;
      cli = Object.assign({ reparaciones: 0, compras: 0 }, cli || {});
      if (!cli.nombre) cli.nombre = f.nombre || '';
      if (!_cliKey(cli.tlf)) cli.tlf = f.telefonoRaw || f.telefono || '';
    }
  }
  if (_cliDni((document.getElementById(ids.dni) || {}).value) !== k) return;   // cambió mientras buscaba
  if (!cli || (!cli.nombre && !_cliKey(cli.tlf))) {
    if (hint) { hint.innerHTML = '🆕 Cliente nuevo: cargá nombre y teléfono'; hint.classList.remove('hidden'); }
    return;
  }
  // Completar lo vacío (no pisar lo que ya escribieron)
  const nomEl = document.getElementById(ids.nombre);
  const telEl = document.getElementById(ids.tel);
  if (nomEl && !nomEl.value.trim() && cli.nombre) nomEl.value = cli.nombre;
  if (telEl && !telEl.value.trim() && cli.tlf) telEl.value = cli.tlf;
  if (hint) {
    const partes = [];
    if (cli.reparaciones) partes.push(`<b>${cli.reparaciones}</b> ${cli.reparaciones !== 1 ? 'reparaciones' : 'reparación'}`);
    if (cli.compras) partes.push(`<b>${cli.compras}</b> compra${cli.compras !== 1 ? 's' : ''} de celular`);
    const ficha = cli.tlf ? ` <a onclick="openClienteFicha('${_cliEsc(cli.tlf)}')">Ver ficha →</a>` : '';
    hint.innerHTML = `✅ <b>${_cliEsc(cli.nombre || 'Cliente')}</b> ya vino` + (partes.length ? ` — ${partes.join(' y ')}` : deFicha ? ' (tiene ficha)' : '') +
      `. Revisá que el teléfono siga siendo el mismo.${ficha}`;
    hint.classList.remove('hidden');
  }
}

function _repDniAutocomplete(dni, forzar) {
  return _dniAutocomplete(dni, { hint: 'rep-cliente-hint', nombre: 'rep-fi-nombre', tel: 'rep-fi-tlf', dni: 'rep-fi-dni' }, forzar);
}

function _sellDniAutocomplete(dni, forzar) {
  return _dniAutocomplete(dni, { hint: 'sell-cli-hint', nombre: 'sell-cli-nombre', tel: 'sell-cli-tel', dni: 'sell-cli-dni' }, forzar);
}

// ══════════════════════════════════════════
//  MIGRACIÓN — generar fichas desde el historial
// ══════════════════════════════════════════
async function migrarClientesDesdeHistorial() {
  if (typeof REPAIRS === 'undefined' || !Array.isArray(REPAIRS)) {
    toast('Cargá la sección Reparaciones primero', 'info');
    return;
  }
  const conTel = REPAIRS.filter(r => _cliKey(r.tlf));
  if (!conTel.length) { toast('No hay reparaciones con teléfono', 'info'); return; }

  // Agrupar por clave de teléfono, quedándonos con el dato más reciente
  const porCliente = {};
  conTel.forEach(r => {
    const key = _cliKey(r.tlf);
    if (!porCliente[key]) porCliente[key] = { tlf: r.tlf, nombre: '', dni: '', fechas: [] };
    porCliente[key].fechas.push(r.fechaIngreso || '');
    // Tomar el nombre/dni más reciente que tenga valor
    if (r.nombre && (!porCliente[key]._nombreFecha || (r.fechaIngreso || '') > porCliente[key]._nombreFecha)) {
      porCliente[key].nombre = r.nombre; porCliente[key]._nombreFecha = r.fechaIngreso || '';
    }
    if (r.dni) porCliente[key].dni = r.dni;
    if (r.tlf) porCliente[key].tlf = r.tlf;
  });

  const keys = Object.keys(porCliente);
  if (!confirm(`Se van a crear/actualizar ${keys.length} fichas de cliente desde tus ${conTel.length} reparaciones con teléfono.\n\n¿Continuar?`)) return;

  if (typeof toast === 'function') toast('⏳ Generando fichas...', 'info');

  let batch = db.batch();
  let ops = 0, creados = 0;
  const ahora = new Date().toISOString();

  try {
    for (const key of keys) {
      const c = porCliente[key];
      const fechas = c.fechas.filter(Boolean).sort();
      const ref = db.collection('clientes').doc(key);
      batch.set(ref, {
        telefono: key,
        telefonoRaw: c.tlf || '',
        nombre: c.nombre || '',
        dni: c.dni || '',
        dniKey: _cliDni(c.dni),
        primeraVez: fechas[0] || ahora,
        ultimaVez: fechas[fechas.length - 1] || ahora,
        updatedAt: ahora,
        createdAt: ahora,
      }, { merge: true });
      ops++; creados++;
      if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops > 0) await batch.commit();
    toast(`✅ ${creados} fichas de cliente generadas`, 'success');
  } catch (e) {
    console.error('migrarClientes:', e);
    toast('Error durante la migración', 'error');
  }
}
