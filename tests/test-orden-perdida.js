// ⚠️ Órdenes que no llegan a la base. Alan (24/11): "no me aparece la orden
// 8679, figura en Telegram ingresada pero en la app no". El aviso de Telegram
// salía al tocar Guardar aunque la base no la guardara, y la orden quedaba
// escondida en la cola del aparato que la tomó sin que nadie se enterara.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const src = fs.readFileSync(DIR + 'repairs.js', 'utf8');

const TG = [], TOASTS = [], ESCRITAS = [], EN_BASE = new Set();
let FALLA = null, CUELGA = false;
const store = {};
const barra = { id: 'rep-subir-barra', innerHTML: '', style: {}, setAttribute() {}, remove() { delete els['rep-subir-barra']; } };
const els = {};
const ctx = {
  console, JSON, Object, Date, Promise, String, Number, Array, Set,
  setTimeout: () => 0,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  document: { getElementById: id => els[id] || null, createElement: () => barra, body: { appendChild: el => { els[el.id] = el; } } },
  esc: s => String(s == null ? '' : s),
  toast: (m, t) => TOASTS.push([m, t]),
  tgNotify: m => TG.push(m),
  _stripUndefined: o => JSON.parse(JSON.stringify(o)),
  REPAIRS: [],
  db: { collection: () => ({ doc: id => ({
    set: d => {
      if (CUELGA) return new Promise(() => {});
      if (FALLA) return Promise.reject(FALLA);
      ESCRITAS.push([id, d]); EN_BASE.add(id); return Promise.resolve();
    },
    get: () => Promise.resolve({ exists: EN_BASE.has(id) }),
  }) }) },
};
vm.createContext(ctx);
vm.runInContext(src.slice(src.indexOf('const _PEND_KEY'), src.indexOf('// Número de orden.')), ctx, { filename: 'repairs.js' });
const espera = () => new Promise(r => setTimeout(r, 5));
const doc = n => ({ id: 'r' + n, nOrden: n, marca: 'Samsung', modelo: 'A54', nombre: 'Juan' });

(async () => {
  console.log('\n1) Telegram avisa cuando la base CONFIRMA');
  CUELGA = true;
  ctx._guardarRepairSinBloquear(doc(8679), '🔧 Equipo ingresado #8679');
  await espera();
  ok(TG.length === 0, 'mientras la base no contesta (sin señal), Telegram NO dice "ingresado"');
  ok(ctx._pendLeer().length === 1 && ctx._pendLeer()[0].__tg, 'la orden queda en la cola del aparato, con su aviso guardado');
  CUELGA = false;
  ctx._pendBorrar('r8679');
  ctx._guardarRepairSinBloquear(doc(8680), '🔧 Equipo ingresado #8680');
  await espera();
  ok(TG.length === 1 && /#8680/.test(TG[0]), 'cuando la base la guarda, recién ahí sale el aviso', TG);
  ok(ESCRITAS[0] && !('__tg' in ESCRITAS[0][1]) && !('__t' in ESCRITAS[0][1]), 'a la base va la orden limpia (sin los datos de la cola)', ESCRITAS[0]);
  ok(ctx._pendLeer().length === 0, 'y sale de la cola');

  console.log('\n2) Si la base la rechaza, se entera todo el mundo');
  TG.length = 0; TOASTS.length = 0;
  FALLA = { code: 'permission-denied' };
  ctx._guardarRepairSinBloquear(doc(8681), '🔧 Equipo ingresado #8681');
  await espera();
  ok(TOASTS.some(t => t[1] === 'error' && /N°8681 NO se guardó/.test(t[0])), 'cartel rojo en el aparato que la tomó', TOASTS);
  ok(TG.length === 1 && /NO se guardó/.test(TG[0]) && !/Equipo ingresado/.test(TG[0]) && /permiso/.test(TG[0]), 'Telegram dice "NO se guardó" (y por qué), no "ingresado"', TG);
  const p = ctx._pendLeer();
  ok(p.length === 1 && /permiso/.test(p[0].__err), 'queda en la cola con el motivo', p);
  ok(els['rep-subir-barra'] && /N°8681/.test(els['rep-subir-barra'].innerHTML) && /Reintentar/.test(els['rep-subir-barra'].innerHTML), 'y un cartel fijo: "Una orden no se subió: N°8681 · Reintentar"');

  console.log('\n3) Reintentar');
  TG.length = 0;
  await ctx._pendReintentar(true);
  ok(ctx._pendLeer().length === 1 && TOASTS.some(t => /Sigue sin poder subir la N°8681/.test(t[0])), 'si sigue fallando, lo dice y la deja en la cola');
  FALLA = null;
  await ctx._pendReintentar(true);
  ok(EN_BASE.has('r8681') && ctx._pendLeer().length === 0, 'cuando se puede, la sube y sale de la cola');
  ok(TG.length === 1 && /Equipo ingresado #8681/.test(TG[0]) && /más tarde/.test(TG[0]), 'y manda el aviso que faltaba, aclarando que subió tarde', TG);
  ok(!els['rep-subir-barra'], 'el cartel se va');

  console.log('\n4) No se pierde por mirar el caché');
  // Antes: si la orden aparecía en la lista (que puede venir del caché de este
  // mismo aparato), se la daba por subida y se borraba de la cola.
  ctx.REPAIRS = [{ id: 'r8682', nOrden: 8682 }];
  store['repsPendientes'] = JSON.stringify([{ ...doc(8682), __t: 1 }]);
  ESCRITAS.length = 0;
  await ctx._pendReintentar();
  ok(ESCRITAS.some(e => e[0] === 'r8682'), 'le pregunta a la base: como no está, la sube igual aunque figure en la lista');
  store['repsPendientes'] = JSON.stringify([{ ...doc(8682), __t: 1 }]);
  ESCRITAS.length = 0;
  await ctx._pendReintentar();
  ok(!ESCRITAS.length && ctx._pendLeer().length === 0, 'si ya está en la base, no la reescribe (no pisa cambios de estado) y la saca de la cola');

  console.log('\n5) Enganches');
  ok(/_guardarRepairSinBloquear\(newDoc, tgIngreso\)/.test(src) && !/tgNotify\(`🔧 <b>Equipo ingresado/.test(src), 'el ingreso ya no manda Telegram antes de guardar');
  ok(/addEventListener\('online', \(\) => _pendReintentar\(\)\)/.test(src), 'apenas vuelve la señal, reintenta solo');

  console.log('\n6) Alan (25/11): "se perdió, no hay datos" — la app se cierra mientras busca el N°');
  // Antes de guardar nada se esperaba a la base por el N° de orden: si la app
  // se cerraba en ese rato, no quedaba nada en ningún lado.
  const fuente = src;
  const guardar = fuente.indexOf('_borradorGuardar(newDoc'), numero = fuente.indexOf('await _numeroConTope(ordenInputVal)');
  ok(guardar > 0 && numero > guardar, 'el ingreso se guarda en el celu ANTES de esperar el número');
  ok(fuente.indexOf('_borradorGuardar(newDoc') < fuente.indexOf("db.collection('repairs').where('nOrden', '==', ordenInputVal)"), 'y antes del chequeo de N° repetido');
  // El celu se "cierra" con el borrador puesto (hace 2 minutos)
  Object.keys(store).forEach(k => delete store[k]);
  ctx.Date = Date;
  ok(ctx._borradorGuardar({ id: 'rb1', marca: 'Samsung', modelo: 'A15', nombre: 'Ana', sena: 0, foto: 'data:xxxx', patronImg: 'data:yyyy' }, { __orden: 0 }), 'se guarda');
  const b0 = JSON.parse(store['repBorradores']);
  ok(b0.length === 1 && !('foto' in b0[0]) && !('patronImg' in b0[0]), 'liviano: sin imágenes');
  ok(!ctx._borradorLeer(), 'recién tocado Guardar no se muestra el cartel (todavía está guardando)');
  b0[0].__t = Date.now() - 120000; store['repBorradores'] = JSON.stringify(b0);
  ctx._borradorGuardar({ id: 'rb2', marca: 'Moto', modelo: 'G32' });
  ok(JSON.parse(store['repBorradores']).length === 2, 'un segundo ingreso no pisa al primero');
  ctx._borradorAviso();
  const barraB = els['rep-borrador-barra'];
  ok(barraB && /Quedó un ingreso a medio guardar: Samsung A15 · Ana/.test(barraB.innerHTML) && /Terminar de guardar/.test(barraB.innerHTML) && /Descartar/.test(barraB.innerHTML),
     'al abrir la app: "Quedó un ingreso a medio guardar" con Terminar / Descartar', barraB && barraB.innerHTML);
  ok(/_borradorAviso\(\);\s+\/\/ un ingreso que quedó a medio guardar/.test(src), 'se revisa al abrir la app');
  // Terminar de guardar
  TG.length = 0; ESCRITAS.length = 0;
  ctx._numeroConTope = async () => ({ nOrden: 8700, provisorio: false });
  ctx._senaAlIngresoACaja = () => {}; ctx._anotarPendiente = () => {};
  ctx.toast = (m, t) => TOASTS.push([m, t]);
  await ctx._borradorTerminar('rb1');
  await espera();
  ok(ESCRITAS.some(e => e[0] === 'rb1' && e[1].nOrden === 8700 && !('__orden' in e[1]) && !('__t' in e[1])), 'Terminar: saca el N° y la sube (limpia)', ESCRITAS);
  ok(TG.some(m => /Equipo ingresado #8700/.test(m) && /más tarde/.test(m)), 'y sale el aviso de Telegram', TG);
  ok(JSON.parse(store['repBorradores'] || '[]').every(b => b.id !== 'rb1'), 'sale de los borradores');
  // Si ya se había subido (la cola de Firestore la mandó sola), no se duplica
  EN_BASE.add('rb3'); ESCRITAS.length = 0;
  store['repBorradores'] = JSON.stringify([{ id: 'rb3', marca: 'X', __t: 1 }]);
  await ctx._borradorTerminar('rb3');
  ok(!ESCRITAS.length && !JSON.parse(store['repBorradores'] || '[]').length, 'si ya estaba en la base, no la vuelve a escribir');

  console.log('\n7) Sin lugar en el celu');
  // El historial guardado en el celu puede llenar el lugar: antes la copia de
  // la orden no entraba y no avisaba
  const lleno = { 'repairsHistCache': 'x'.repeat(50) };
  const store2 = { ...lleno };
  ctx.localStorage = { getItem: k => (k in store2 ? store2[k] : null), removeItem: k => { delete store2[k]; },
    setItem: (k, v) => { if ('repairsHistCache' in store2) throw new Error('QuotaExceededError'); store2[k] = String(v); } };
  ok(ctx._pendGuardar({ id: 'q1', nOrden: 1 }, '') === true && store2['repsPendientes'] && !('repairsHistCache' in store2), 'tira el historial (se vuelve a bajar) y guarda la orden');
  ctx.localStorage = { getItem: () => null, removeItem() {}, setItem: () => { throw new Error('QuotaExceededError'); } };
  ok(ctx._pendGuardar({ id: 'q2', nOrden: 2 }, '') === false, 'si igual no entra, lo dice (no se lo calla)');
  ok(/El celu no tiene lugar para guardar una copia/.test(src), 'y avisa que no cierre la app');

  console.log('\n8) El N° no hace esperar para siempre');
  const n = { console, Promise, Number, Math, REPAIRS: [{ nOrden: 8690 }], setTimeout, clearTimeout };
  n.db = { collection: () => ({ doc: () => ({ get: () => new Promise(() => {}) }), where: () => ({ where: () => ({ get: () => new Promise(() => {}) }) }) }), runTransaction: () => new Promise(() => {}) };
  vm.createContext(n);
  vm.runInContext(src.slice(src.indexOf('async function _numeroDeOrden'), src.indexOf('// Primer N° de orden sin reparación')), n);
  const t0 = Date.now();
  const r = await n._numeroConTope(0, 50);
  ok(r.nOrden === 8691 && r.provisorio === true && Date.now() - t0 < 1000, 'con la base colgada, sigue con un N° provisorio (el siguiente al más alto del celu)', r);
  ok(/Promise\.race\(\[\s*db\.collection\('repairs'\)\.where\('nOrden', '==', ordenInputVal\)/.test(src), 'el chequeo de N° repetido también tiene tope');
  ok(/btn\.innerHTML = '⏳ Guardando…'/.test(src), 'el botón dice "Guardando…" mientras tanto');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})();
