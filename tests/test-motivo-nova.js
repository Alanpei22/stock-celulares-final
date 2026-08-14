// Harness sin navegador para el motivo de "No va".
//
// Por qué: el botón "No va" solo preguntaba si el equipo ya se había devuelto.
// El motivo era texto libre y solo se llegaba desde el tablero de fases. Texto
// libre no se puede contar: para saber si estás perdiendo trabajos por precio
// o por otra cosa hace falta una CATEGORÍA.
//
// `motivoCierre` es campo nuevo. El `motivo` de texto libre del tablero sigue
// como estaba, para el detalle.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
const leer = f => fs.readFileSync(DIR + f, 'utf8');

let fails = 0;
const ok = (c, l, x) => {
  console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x)));
  if (!c) fails++;
};

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
['nova-overlay','nova-modal','nova-info','nova-motivos','nova-devuelto'].forEach(id => el(id));

const TOASTS = [];
const ctx = {
  console, setTimeout: f => f(), clearTimeout,
  document: {
    getElementById: id => els[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el('tmp'), addEventListener(){},
    body: { style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} } },
    documentElement: { classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} }, style:{setProperty(){}} },
  },
  window: { addEventListener(){}, matchMedia: () => ({ matches:false, addEventListener(){} }), location:{href:''} },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  navigator: { userAgent: 'node' },
  esc: s => String(s == null ? '' : s),
  fmt: n => '$' + Number(n || 0),
  toast: (m, t) => TOASTS.push([t || 'info', m]),
  searchMatch: () => false,
  REPAIRS: [], REPUESTOS: [],
  db: { collection: () => ({ doc: () => ({ update: async () => {}, set: async () => {} }) }) },
  firebase: { firestore: { FieldValue: { serverTimestamp: () => ({ __ts: true }) } } },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('repairs.js'), ctx, { filename: 'repairs.js' });
const run = code => vm.runInContext(code, ctx);
const get = expr => vm.runInContext(expr, ctx);

// ── 1) Las categorías ───────────────────────────────────────
console.log('\n1) Las categorías');
const motivos = get('NOVA_MOTIVOS');
ok(Array.isArray(motivos) && motivos.length >= 4, 'hay categorías para elegir', motivos.length);
const claves = motivos.map(m => m.k);
['presupuesto', 'sin-arreglo', 'sin-repuesto', 'no-aparecio'].forEach(k => {
  ok(claves.includes(k), `está la categoría "${k}"`, claves);
});
ok(motivos.every(m => m.k && m.txt), 'todas tienen clave y texto');
ok(get("novaMotivoLabel('presupuesto')") === 'Rechazó el presupuesto',
   'la clave se traduce a texto para mostrar', get("novaMotivoLabel('presupuesto')"));
ok(get("novaMotivoLabel('inventada')") === '', 'una clave que no existe no rompe');

// ── 2) El modal ─────────────────────────────────────────────
console.log('\n2) El modal pide la categoría');
ctx.__REP = { id: 'r1', nOrden: 7050, marca: 'Nokia', modelo: 'G20' };
run('__P = openNoVaModal(__REP); __P.then(v => { __RES = v; });');
ok(!els['nova-modal'].classList.contains('hidden'), 'el modal se abre');
ok(/7050/.test(els['nova-info'].innerHTML), 'dice de qué orden se trata');
ok(/nova-motivo/.test(els['nova-motivos'].innerHTML), 'muestra las opciones');

// Sin elegir motivo no deja cerrar: si dejara, el dato no serviría de nada.
TOASTS.length = 0;
run('confirmNoVa()');
ok(TOASTS.some(t => /Elegí por qué/.test(t[1])), 'sin elegir motivo no deja confirmar', TOASTS);
ok(!els['nova-modal'].classList.contains('hidden'), 'y el modal sigue abierto');

(async () => {
  run("_pickNovaMotivo('presupuesto')");
  ok(/nova-motivo--sel/.test(els['nova-motivos'].innerHTML), 'la opción elegida queda marcada');
  els['nova-devuelto'].checked = true;
  run('confirmNoVa()');
  await new Promise(r => setImmediate(r));
  const res = get('__RES');
  ok(res && res.motivoCierre === 'presupuesto', 'devuelve la categoría elegida', res);
  ok(res && res.devuelto === true, 'y si ya se devolvió, también', res);
  ok(els['nova-modal'].classList.contains('hidden'), 'el modal se cierra');

  // Cancelar tiene que dejar la orden como estaba.
  run('__P2 = openNoVaModal(__REP); __P2.then(v => { __RES2 = v; });');
  run('closeNoVaModal(null)');
  await new Promise(r => setImmediate(r));
  ok(get('__RES2') === null, 'cancelar no cierra la orden', get('__RES2'));

  // ── 3) Desde el tablero no pregunta dos veces ─────────────
  console.log('\n3) Desde el tablero no vuelve a preguntar');
  // El tablero ya pide el motivo en texto libre, y la fase misma dice la
  // categoría. Preguntar otra vez sería preguntar dos veces por lo mismo.
  ok(get("_motivoDesdeFase('irreparable')") === 'sin-arreglo',
     'la fase "irreparable" ya significa que no tiene arreglo');
  ok(get("_motivoDesdeFase('rechazado')") === 'presupuesto',
     'la fase "rechazado" ya significa que rechazó el presupuesto');
  ok(get("_motivoDesdeFase('reparacion')") === null,
     'una fase normal no cierra nada');
  ok(get('_motivoDesdeFase(undefined)') === null,
     'sin fase (el botón "No va" suelto) sí hay que preguntar');

  const src = leer('repairs.js');
  ok(/_motivoDesdeFase\(faseExtra\.fase\)/.test(src),
     'changeRepairStatus mira la fase antes de abrir el modal');

  // ── 4) Las estadísticas ───────────────────────────────────
  console.log('\n4) El desglose en estadísticas');
  // BUG que había: se filtraba por 'no_van' con guión bajo, un estado que la
  // app nunca escribe (usa 'no va'). El contador daba casi siempre 0.
  ok(!/r\.estado === 'no_van'/.test(src),
     'ya no se filtra por el estado inexistente "no_van"');
  ok(/const canceladas = reps\.filter\(r => _esNoVa\(r\.estado\)\)/.test(src),
     'las canceladas se cuentan con _esNoVa, que cubre las tres variantes');
  ok(/topMotivos/.test(src) && /sinMotivo/.test(src),
     'se calcula el desglose por motivo');
  ok(/son de antes de que se pidiera/.test(src),
     'y aclara cuántas son viejas sin motivo, para no leer mal el gráfico');

  // ── 5) Compatibilidad ─────────────────────────────────────
  console.log('\n5) Sin romper lo que ya está');
  ok(/tpGuardarCampo\('\$\{id\}','motivo'/.test(src),
     'el motivo en texto libre del tablero sigue existiendo');
  ok(/motivoCierre/.test(src), 'motivoCierre es un campo nuevo, aparte');
  // Las órdenes viejas no tienen motivoCierre y no se puede inventar.
  ok(/if \(!r\.motivoCierre\) return;/.test(src),
     'las órdenes viejas sin motivo no se cuentan en el desglose');

  console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
  process.exit(fails ? 1 : 0);
})();
