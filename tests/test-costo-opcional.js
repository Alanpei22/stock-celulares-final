// Harness sin navegador para el modal de costo al entregar una reparación.
//
// Cargar el costo NO tiene que ser obligatorio: frenaba la entrega en el
// mostrador con el cliente esperando. El modal sigue apareciendo como
// recordatorio, pero trae "Entregar sin cargar el costo" y con eso la entrega
// sigue igual. Cancelar (o la ✕) sí corta: eso es apretar el botón equivocado,
// no una entrega sin costo.
const fs = require('fs'), vm = require('vm'), path = require('path');
const raiz = f => path.join(__dirname, '..', f);
const leer = f => fs.readFileSync(raiz(f), 'utf8');

let fails = 0;
function ok(cond, label, extra) {
  console.log((cond ? '  OK  ' : '  FAIL') + ' · ' + label + (cond ? '' : '  → ' + JSON.stringify(extra)));
  if (!cond) fails++;
}

// ── DOM mínimo, solo lo que toca el modal ───────────────────
const els = {};
function el(id) {
  return els[id] = {
    id, value: '', textContent: '', innerHTML: '', checked: false, style: {}, dataset: {},
    focus(){}, select(){}, blur(){}, setAttribute(){}, addEventListener(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; }, closest(){ return null; },
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
                 toggle(c,f){ f ? this._s.add(c) : this._s.delete(c); }, contains(c){return this._s.has(c);} },
  };
}
['costo-req-overlay','costo-req-info','costo-req-search','costo-req-usd','costo-req-ars',
 'costo-req-suggest','costo-req-no-rep','costo-req-mode-catalog','costo-req-mode-manual',
 'costo-req-mode-norep'].forEach(id => el(id));

const ESCRITURAS = [];
const ctx = {
  console, setTimeout: (f) => { f(); }, clearTimeout,
  document: {
    getElementById: id => els[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => el('tmp'),
    addEventListener(){},
    body: { style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} } },
    documentElement: { classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} }, style:{setProperty(){}} },
  },
  window: { addEventListener(){}, matchMedia: () => ({ matches:false, addEventListener(){} }), location:{href:''} },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  navigator: { userAgent: 'node' },
  esc: s => String(s == null ? '' : s),
  fmt: n => '$' + Number(n || 0),
  toast: () => {},
  db: {
    collection: name => ({
      doc: id => ({ update: async d => { ESCRITURAS.push([name, id, d]); } }),
    }),
  },
  REPAIRS: [],
  firebase: { firestore: { FieldValue: { serverTimestamp: () => ({ __ts: true }) } } },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('repairs.js'), ctx, { filename: 'repairs.js' });
const run = code => vm.runInContext(code, ctx);
const get = expr => vm.runInContext(expr, ctx);

console.log('\n  ── El modal de costo ──');

// ── 1) Existe la salida sin cargar nada ─────────────────────
ok(typeof get('typeof entregarSinCargarCosto') === 'string' &&
   get('typeof entregarSinCargarCosto') === 'function',
   'existe entregarSinCargarCosto()');

const html = leer('index.html');
ok(/onclick="entregarSinCargarCosto\(\)"/.test(html),
   'el botón está en la pantalla, no solo en el código');
ok(!/Cargá el costo antes de entregar/.test(html),
   'el título ya no lo presenta como obligatorio');

// ── 2) Entregar sin cargar → la entrega SIGUE ───────────────
ctx.__REP = { id: 'r1', nOrden: 7001, marca: 'Samsung', modelo: 'A54', monto: 50000 };
let resuelto = null;
run('__P = openCostoRequeridoModal(__REP)');
run('__P.then(v => { __RES = v; })');
run('entregarSinCargarCosto()');

(async () => {
  await new Promise(r => setImmediate(r));
  resuelto = get('__RES');
  ok(resuelto === true,
     'entregar sin cargar el costo deja seguir la entrega', { resolvio: resuelto });
  ok(ESCRITURAS.length === 0,
     'y no le escribe ningún costo inventado a la reparación', ESCRITURAS);
  ok(els['costo-req-overlay'].classList.contains('hidden'),
     'el modal se cierra');

  // ── 3) Cancelar SÍ corta ──────────────────────────────────
  run('__P2 = openCostoRequeridoModal(__REP)');
  run('__P2.then(v => { __RES2 = v; })');
  run('closeCostoRequeridoModal(false)');
  await new Promise(r => setImmediate(r));
  ok(get('__RES2') === false,
     'cancelar (o la ✕) sigue cortando la entrega', { resolvio: get('__RES2') });

  // ── 4) El camino de siempre no se tocó ────────────────────
  const src = leer('repairs.js');
  ok(/function _faltaCargarCosto/.test(src),
     'sigue existiendo la detección de "falta el costo"');
  ok((src.match(/openCostoRequeridoModal\(/g) || []).length >= 3,
     'el modal se sigue abriendo desde los dos lugares de entrega');
  ok(/function confirmCostoRequerido/.test(src),
     'cargar el costo de verdad sigue funcionando igual');
  // El costo se puede cargar después: el campo de la ficha tiene que seguir ahí.
  ok(/id="rep-fi-costo"/.test(html),
     'el costo se puede cargar después desde la ficha de la reparación');

  console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
  process.exit(fails ? 1 : 0);
})();
