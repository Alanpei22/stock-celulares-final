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

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})();
