// ══════════════════════════════════════════════════════════════
//  📥 Importar el historial de la caja (planillas de Drive)
// ══════════════════════════════════════════════════════════════
//  Alan (19/11): tenía la caja diaria de 2025 en una planilla de Drive
//  ("caja techpoint", pestaña 2025: por día lo que entró en Caseros, lo que
//  entró en Morris y los gastos con su detalle) y pidió pasarla a la app,
//  para que los informes y las comparaciones de meses arranquen desde antes.
//
//  La planilla se convirtió en un archivo .json con los movimientos ya
//  armados (un ingreso por local y por día, y cada gasto con su rubro). Los
//  datos NO están en el código: el dueño sube el archivo desde la app.
//
//  Cada movimiento tiene un id fijo (hist2025_<fecha>_<qué>): importar dos
//  veces el mismo archivo no duplica nada. Quedan marcados con
//  `importado: '<origen>'` y se pueden borrar todos juntos.

const IMP_CATEGORIAS = {
  ingreso: ['Venta equipo', 'Reparación', 'Venta producto', 'Hidrogel / Accesorio', 'Seña', 'Plan ahorro', 'Otro ingreso'],
  egreso: ['Compra repuesto', 'Gasto fijo', 'Retiro dueño', 'Otro gasto'],
};
const IMP_MAX = 5000;
// Las cajas diarias de 2026 (un Excel por mes) sí dicen cómo se cobró (transf,
// mp, débito…): se respeta. Solo se aceptan las formas de pago de la caja; si
// no viene o es otra cosa, queda "Planilla" como en 2025.
const IMP_METODOS = ['Efectivo', 'Transferencia', 'MercadoPago', 'Tarjeta débito', 'Tarjeta crédito'];

let _impArchivo = null;   // { origen, nombre, movimientos }

// El archivo → movimientos listos para guardar, o { error }
function impValidar(datos) {
  if (!datos || typeof datos !== 'object') return { error: 'El archivo no es del formato esperado' };
  const origen = String(datos.origen || '').trim();
  if (!/^[a-z0-9-]{3,40}$/.test(origen)) return { error: 'Al archivo le falta de dónde viene (origen)' };
  const lista = Array.isArray(datos.movimientos) ? datos.movimientos : null;
  if (!lista || !lista.length) return { error: 'El archivo no trae movimientos' };
  if (lista.length > IMP_MAX) return { error: `Son demasiados movimientos (${lista.length})` };
  const movs = [], ids = new Set();
  for (let i = 0; i < lista.length; i++) {
    const m = lista[i] || {};
    const malo = txt => ({ error: `Renglón ${i + 1}: ${txt}` });
    const id = String(m.id || '');
    if (!/^hist[0-9]{4}_[0-9]{4}-[0-9]{2}-[0-9]{2}_[a-z0-9]{1,20}$/.test(id)) return malo('id raro');
    if (ids.has(id)) return malo('repetido');
    ids.add(id);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(m.fecha || ''))) return malo('fecha raro');
    if (m.tipo !== 'ingreso' && m.tipo !== 'egreso') return malo('tipo raro');
    if (!IMP_CATEGORIAS[m.tipo].includes(m.categoria)) return malo('categoría que la caja no tiene');
    const monto = Math.round(Number(m.monto));
    if (!(monto > 0) || monto > 1e9) return malo('monto raro');
    const mov = {
      fecha: m.fecha, tipo: m.tipo, categoria: m.categoria, monto,
      descripcion: String(m.descripcion || m.categoria).slice(0, 120),
      // No se sabe cómo se pagó: la planilla no lo dice
      metodoPago: IMP_METODOS.includes(m.metodoPago) ? m.metodoPago : 'Planilla',
      createdAt: m.fecha + 'T12:00:00.000Z',
      importado: origen, historico: true,
    };
    if (m.local) mov.local = String(m.local).slice(0, 30);
    if (m.rubro) mov.rubro = String(m.rubro).slice(0, 60);
    movs.push({ id, data: mov });
  }
  return { origen, nombre: String(datos.nombre || origen).slice(0, 80), movimientos: movs };
}

// Resumen por mes para mostrar antes de importar
function impResumen(movs) {
  const meses = {};
  movs.forEach(({ data: m }) => {
    const k = m.fecha.slice(0, 7);
    const r = meses[k] = meses[k] || { ingresos: 0, egresos: 0, n: 0 };
    r[m.tipo === 'ingreso' ? 'ingresos' : 'egresos'] += m.monto;
    r.n++;
  });
  return Object.keys(meses).sort().map(k => Object.assign({ mes: k }, meses[k]));
}

// ── Pantalla ─────────────────────────────────────────────────
function impAbrir() {
  const dueno = (typeof _cajaIsOwner !== 'undefined' && _cajaIsOwner) || (typeof tpEsDueno === 'function' && tpEsDueno());
  if (!dueno) { toast('Esto lo hace el dueño', 'error'); return; }
  _impArchivo = null;
  _impPintar(`
    <p class="imp-sub">Subí el archivo <b>.json</b> que te armé con la planilla de la caja (por ejemplo <b>caja-2025-planilla.json</b> o <b>caja-2026-ene-mar.json</b>).
    Antes de guardar te muestro qué tiene. Importarlo dos veces no duplica nada.</p>
    <label class="imp-file">📂 Elegir el archivo<input type="file" accept=".json,application/json" onchange="impElegido(this.files && this.files[0])" hidden></label>
    <div class="imp-borrar"><button type="button" class="imp-link" onclick="impBorrarPregunta()">🗑 Borrar un historial importado</button></div>`);
}

async function impElegido(file) {
  if (!file) return;
  let datos;
  try { datos = JSON.parse(await file.text()); }
  catch { toast('No pude leer el archivo (¿es el .json?)', 'error'); return; }
  const v = impValidar(datos);
  if (v.error) { toast(v.error, 'error'); return; }
  _impArchivo = v;
  const choque = await _impYaCargado(v.movimientos);
  const f = n => (typeof fmt === 'function' ? fmt(n) : '$' + Math.round(n).toLocaleString('es-AR'));
  const meses = impResumen(v.movimientos);
  const tot = meses.reduce((a, m) => ({ i: a.i + m.ingresos, e: a.e + m.egresos }), { i: 0, e: 0 });
  const N = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  _impPintar(`
    <p class="imp-sub"><b>${_impEsc(v.nombre)}</b> · ${v.movimientos.length} movimientos</p>
    <table class="imp-tabla"><tr><th>Mes</th><th>Entró</th><th>Salió</th></tr>
      ${meses.map(m => `<tr><td>${N[+m.mes.slice(5)]} ${m.mes.slice(0, 4)}</td><td>${f(m.ingresos)}</td><td>${f(m.egresos)}</td></tr>`).join('')}
      <tr class="imp-tot"><td>Total</td><td>${f(tot.i)}</td><td>${f(tot.e)}</td></tr></table>
    <p class="imp-sub">Neto: <b>${f(tot.i - tot.e)}</b>. Quedan en la caja de cada día como "importado de la planilla".</p>
    ${choque ? `<p class="imp-ojo">⚠️ Ojo: en esas fechas la app ya tiene <b>${choque.n}${choque.mas ? ' o más' : ''}</b> movimientos cargados a mano (el primero, el ${_impEsc(choque.desde)}). Si esos días ya están en la app, se van a contar dos veces.</p>` : ''}
    <button type="button" class="imp-ok" id="imp-ok" onclick="impGuardar()">📥 Importar ${v.movimientos.length} movimientos</button>`);
}

// ¿La app ya tiene movimientos propios (no importados) en las fechas del
// archivo? Las cajas de 2026 llegan hasta fines de marzo y por esos días se
// empezó a usar la app: importar encima duplicaría esos días. Lee pocos
// documentos (tope 300) para no gastar el cupo de Firebase.
async function _impYaCargado(movs) {
  if (typeof db === 'undefined' || !db || !movs.length) return null;
  const fechas = movs.map(x => x.data.fecha).sort();
  try {
    const snap = await db.collection('caja_movimientos')
      .where('fecha', '>=', fechas[0]).where('fecha', '<=', fechas[fechas.length - 1])
      .orderBy('fecha').limit(300).get();
    const propios = snap.docs.map(d => d.data()).filter(m => !m.importado);
    if (!propios.length) return null;
    return { n: propios.length, mas: snap.size === 300, desde: propios[0].fecha.split('-').reverse().join('/') };
  } catch (e) { console.warn('importar: no pude revisar si ya había movimientos', e); return null; }
}

async function impGuardar() {
  const v = _impArchivo;
  if (!v || typeof db === 'undefined' || !db) return;
  const btn = document.getElementById('imp-ok');
  if (btn) btn.disabled = true;
  let hechos = 0;
  try {
    // De a 400 (Firestore admite 500 por tanda)
    for (let i = 0; i < v.movimientos.length; i += 400) {
      const batch = db.batch();
      v.movimientos.slice(i, i + 400).forEach(({ id, data }) => batch.set(db.collection('caja_movimientos').doc(id), data));
      await batch.commit();
      hechos = Math.min(v.movimientos.length, i + 400);
      if (btn) btn.textContent = `⏳ ${hechos} de ${v.movimientos.length}…`;
    }
    toast(`📥 Listo: ${hechos} movimientos de la planilla en la caja`, 'success');
    if (typeof _vsInvalidar === 'function') _vsInvalidar();
    impCerrar();
  } catch (e) {
    console.error('importar historial:', e);
    toast(e && e.code === 'resource-exhausted'
      ? '⚠️ Se terminó el cupo de Firebase de hoy: importó ' + hechos + '. Mañana volvé a subir el mismo archivo (no duplica).'
      : 'No se pudo importar todo (' + hechos + ' guardados). Probá de nuevo: no duplica.', 'error');
    if (btn) btn.disabled = false;
  }
}

async function impBorrarPregunta() {
  const origen = prompt('¿Qué historial importado borro?\n\nEscribí su origen: planilla-2025, caja-2026 o caja-2026-telefonia', 'planilla-2025');
  if (!origen) return;
  try {
    const snap = await db.collection('caja_movimientos').where('importado', '==', origen.trim()).get();
    if (snap.empty) { toast('No hay movimientos importados con ese origen', 'info'); return; }
    if (!confirm(`Se van a borrar ${snap.size} movimientos importados de "${origen}".\n\nLo que cargaste en la app no se toca. ¿Seguir?`)) return;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    toast(`🗑 Borrados ${docs.length} movimientos importados`, 'success');
    if (typeof _vsInvalidar === 'function') _vsInvalidar();
    impCerrar();
  } catch (e) { console.error('borrar historial:', e); toast('No se pudo borrar', 'error'); }
}

function _impEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function impCerrar() { document.getElementById('imp-ov')?.remove(); }

function _impPintar(cuerpo) {
  _impEstilos();
  impCerrar();
  const ov = document.createElement('div');
  ov.id = 'imp-ov';
  ov.onclick = e => { if (e.target === ov) impCerrar(); };
  ov.innerHTML = `<div class="imp-box"><div class="imp-hd"><b>📥 Importar historial de caja</b><button type="button" onclick="impCerrar()">✕</button></div>${cuerpo}</div>`;
  document.body.appendChild(ov);
}

function _impEstilos() {
  if (document.getElementById('imp-css')) return;
  const s = document.createElement('style');
  s.id = 'imp-css';
  s.textContent = `
  #imp-ov { position: fixed; inset: 0; z-index: 3000; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .imp-box { background: var(--card, #fff); color: var(--text, #111); border-radius: 16px; padding: 16px; width: min(460px, 100%); max-height: 90vh; overflow: auto; }
  .imp-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 16px; }
  .imp-hd button { border: 0; background: transparent; font-size: 18px; cursor: pointer; color: inherit; }
  .imp-sub { font-size: 14px; line-height: 1.4; margin: 8px 0; }
  .imp-file { display: block; text-align: center; padding: 16px; border: 2px dashed var(--accent, #C8965A); border-radius: 12px; cursor: pointer; font-weight: 700; margin: 12px 0; }
  .imp-tabla { width: 100%; border-collapse: collapse; font-size: 14px; }
  .imp-tabla th, .imp-tabla td { padding: 6px 4px; border-bottom: 1px solid rgba(128,128,128,.25); text-align: right; }
  .imp-tabla th:first-child, .imp-tabla td:first-child { text-align: left; }
  .imp-tot td { font-weight: 800; }
  .imp-ojo { font-size: 13.5px; line-height: 1.4; margin: 8px 0; padding: 10px; border-radius: 10px; background: rgba(239,68,68,.12); border: 1px solid rgba(239,68,68,.45); }
  .imp-ok { width: 100%; padding: 13px; border: 0; border-radius: 12px; background: var(--accent, #C8965A); color: #111; font-weight: 800; font-size: 15px; cursor: pointer; margin-top: 8px; }
  .imp-borrar { text-align: center; margin-top: 4px; }
  .imp-link { border: 0; background: transparent; color: #ef4444; cursor: pointer; font-size: 13px; text-decoration: underline; }`;
  document.head.appendChild(s);
}
