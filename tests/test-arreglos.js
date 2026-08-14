// Harness sin navegador para las VARIAS reparaciones por equipo.
//
// Un equipo entra por más de una cosa (módulo + batería + ficha de carga) y
// antes solo se podía anotar una. Ahora `arreglos` es una lista con precio por
// línea y tilde de hecha.
//
// Lo que más importa acá: `arreglo` (el texto de siempre) TIENE que seguir
// existiendo con el resumen, porque hay ~110 lecturas repartidas por la app
// (tablero, filtros, WhatsApp, QR, Telegram) que no se tocaron. Y las órdenes
// viejas, que no tienen `arreglos`, tienen que seguir funcionando.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
const leer = f => fs.readFileSync(DIR + f, 'utf8');

let fails = 0;
const ok = (c, l, x) => {
  console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x)));
  if (!c) fails++;
};

// ── Sandbox con repairs.js ──────────────────────────────────
const els = {};
function el(id, extra = {}) {
  return els[id] = Object.assign({
    id, value: '', textContent: '', innerHTML: '', checked: false, style: {}, dataset: {},
    focus(){}, select(){}, blur(){}, setAttribute(){}, addEventListener(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; }, closest(){ return null; },
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
                 toggle(c,f){ f ? this._s.add(c) : this._s.delete(c); }, contains(c){return this._s.has(c);} },
  }, extra);
}
['rep-fi-arreglo','rep-fi-arreglo-custom','rep-arreglos-list','rep-arreglos-total',
 'rep-arreglos-repuesto','rep-fi-monto','rep-fi-marca','rep-fi-modelo'].forEach(id => el(id));

const TOASTS = [], WRITES = [];
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
  searchMatch: (hay, q) => {
    const h = (Array.isArray(hay) ? hay.join(' ') : String(hay || '')).toLowerCase();
    return String(q || '').toLowerCase().split(/\s+/).filter(Boolean).every(t => h.includes(t));
  },
  REPAIRS: [], REPUESTOS: [],
  db: { collection: n => ({ doc: id => ({
    update: async d => { WRITES.push([n, id, d]); },
    set: async d => { WRITES.push([n, id, d]); },
  }) }) },
  firebase: { firestore: { FieldValue: { serverTimestamp: () => ({ __ts: true }) } } },
  openRepairDetail: () => {},
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('repairs.js'), ctx, { filename: 'repairs.js' });
const run = code => vm.runInContext(code, ctx);
const get = expr => vm.runInContext(expr, ctx);

// repairs.js declara sus propias funciones y pisan las del sandbox, así que
// los stubs van DESPUÉS de cargarlo. openRepairDetail redibuja la ficha entera
// (medio index.html), que acá no existe: lo único que interesa es que la
// escritura a Firestore salga bien.
run('openRepairDetail = () => {};');

// ── 1) Cargar varias ────────────────────────────────────────
console.log('\n1) Cargar varias reparaciones');
run('_repArreglos = []; _montoTocadoAMano = false;');
run("_addArreglo('Módulo / Pantalla')");
run("_addArreglo('Batería')");
run("_addArreglo('Ficha de carga')");
ok(get('_repArreglos.length') === 3, 'entran tres reparaciones', get('_repArreglos.length'));

TOASTS.length = 0;
run("_addArreglo('batería')");   // misma, distinta capitalización
ok(get('_repArreglos.length') === 3, 'no deja cargar dos veces la misma');
ok(TOASTS.some(t => /ya está/.test(t[1])), 'y lo avisa', TOASTS);

run('_removeArreglo(1)');
ok(get('_repArreglos.length') === 2 && get("_repArreglos[1].texto") === 'Ficha de carga',
   'se puede quitar una del medio', get('_repArreglos'));

// ── 2) Precio por línea y total ─────────────────────────────
console.log('\n2) Precio por reparación');
run('_setArregloPrecio(0, 85000)');
run('_setArregloPrecio(1, 25000)');
ok(get('_arreglosTotal(_repArreglos)') === 110000, 'suma los precios', get('_arreglosTotal(_repArreglos)'));
ok(els['rep-fi-monto'].value === 110000, 'el monto se autocompleta con la suma', els['rep-fi-monto'].value);

// Hacer precio: si el monto se toca a mano, la suma deja de pisarlo.
run('_montoTocadoAMano = true');
run('_setArregloPrecio(1, 30000)');
ok(els['rep-fi-monto'].value === 110000,
   'si hiciste precio a mano, la suma ya no te lo pisa', els['rep-fi-monto'].value);

// ── 3) El resumen que ve el resto de la app ─────────────────
console.log('\n3) `arreglo` sigue siendo el texto de siempre');
ok(get('_arreglosResumen(_repArreglos)') === 'Módulo / Pantalla + Ficha de carga',
   'el resumen junta las reparaciones', get('_arreglosResumen(_repArreglos)'));
ok(typeof get('_arreglosResumen([])') === 'string' && get('_arreglosResumen([])') === '',
   'sin reparaciones el resumen es vacío, no undefined');

// ── 4) Compatibilidad con lo que ya está en Firestore ───────
console.log('\n4) Las órdenes viejas siguen andando');
ctx.__VIEJA = { id: 'v1', arreglo: 'Módulo / Pantalla', monto: 85000 };
const deVieja = get('_arreglosDesdeRepair(__VIEJA)');
ok(deVieja.length === 1 && deVieja[0].texto === 'Módulo / Pantalla',
   'una orden vieja se lee como una sola reparación', deVieja);
ok(deVieja[0].precio === 85000, 'y toma su monto como precio', deVieja);
ok(deVieja[0].hecho === false, 'sin tildar');

ctx.__NUEVA = { id: 'n1', arreglo: 'A + B', arreglos: [
  { texto: 'A', precio: 100, hecho: true }, { texto: 'B', precio: 200, hecho: false },
] };
const deNueva = get('_arreglosDesdeRepair(__NUEVA)');
ok(deNueva.length === 2 && deNueva[0].hecho === true, 'una orden nueva lee su lista', deNueva);

ctx.__VACIA = { id: 'x1' };
ok(get('_arreglosDesdeRepair(__VACIA)').length === 0,
   'una orden sin nada no explota', get('_arreglosDesdeRepair(__VACIA)'));

// ── 5) Tildar como hecha ────────────────────────────────────
console.log('\n5) Tildar una reparación como hecha');
// repairs.js declara `let REPAIRS`, así que NO es la propiedad del sandbox:
// hay que cargarlo evaluando dentro del contexto.
run(`REPAIRS.push({ id: 'r9', arreglo: 'A + B', arreglos: [
  { texto: 'A', precio: 100, hecho: false }, { texto: 'B', precio: 200, hecho: false },
] })`);
ok(get('REPAIRS.length') === 1, 'la reparación de prueba quedó cargada', get('REPAIRS.length'));
WRITES.length = 0;
(async () => {
  await get("toggleArregloHecho('r9', 0, true)");
  const w = WRITES.find(x => x[0] === 'repairs');
  ok(!!w && w[1] === 'r9', 'se guarda en la reparación', WRITES);
  ok(w && Array.isArray(w[2].arreglos) && w[2].arreglos[0].hecho === true,
     'la primera queda tildada', w && w[2]);
  ok(w && w[2].arreglos[1].hecho === false, 'la otra no se toca');
  ok(Object.keys(w[2]).length === 1,
     'solo escribe `arreglos`: no pisa estado, fase ni monto', Object.keys(w[2]));

  // ── 6) El aviso de repuestos no gasta cupo ────────────────
  console.log('\n6) El aviso de stock de repuestos');
  const cuerpo = leer('repairs.js');
  const iSug = cuerpo.indexOf('function _sugerirRepuestos');
  const bloqueSug = cuerpo.slice(iSug, iSug + 1800);
  ok(!/db\.collection|onSnapshot|\.get\(\)/.test(bloqueSug),
     'no lee Firestore: usa lo que ya está en memoria (cupo)');
  ok(/REPUESTOS\.length/.test(bloqueSug), 'y si la sección no se abrió, no muestra nada');

  els['rep-fi-marca'].value = 'Samsung';
  els['rep-fi-modelo'].value = 'A54';
  ctx.REPUESTOS.push({ id: 'p1', nombre: 'Módulo Samsung A54', marca: 'Samsung', modelo: 'A54', tipo: 'Pantalla', cantidad: 3 });
  run("_repArreglos = [{texto:'Módulo / Pantalla', precio:0, hecho:false}]");
  run('_sugerirRepuestos()');
  ok(/hay 3 en stock/.test(els['rep-arreglos-repuesto'].innerHTML),
     'avisa que hay repuesto', els['rep-arreglos-repuesto'].innerHTML);

  ctx.REPUESTOS[0].cantidad = 0;
  run('_sugerirRepuestos()');
  ok(/sin stock/.test(els['rep-arreglos-repuesto'].innerHTML),
     'y avisa cuando no hay', els['rep-arreglos-repuesto'].innerHTML);

  // ── 7) La boleta ──────────────────────────────────────────
  console.log('\n7) La boleta lista cada reparación con su precio');
  const pctx = {
    console, TextEncoder, crypto: require('crypto').webcrypto,
    btoa: s => Buffer.from(s, 'binary').toString('base64'), unescape, encodeURIComponent,
    location: { origin: 'https://x' }, window: { _DAKI_NAME: 'TechPoint' },
    document: { getElementById: () => null, addEventListener: () => {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    BIZ_DATA: { dir: 'x', tel: 'y', extra: 'z' },
    toast: () => {}, esc: s => String(s == null ? '' : s), alert: () => {},
    getConfig: () => ({ telefonoNegocio: '1' }), STOCK: [],
  };
  pctx.globalThis = pctx; vm.createContext(pctx);
  for (const f of ['qr.js', 'tp-fases.js', 'seguimiento.js', 'print.js']) {
    vm.runInContext(leer(f), pctx, { filename: f });
  }
  const base = { id: 'r1', nOrden: 7123, marca: 'Samsung', modelo: 'A54', nombre: 'Marina',
                 tlf: '11', estado: 'reparando', fase: 'reparacion', diasGarantia: 90,
                 fechaIngreso: '2026-08-01T10:00:00.000Z', tokenSeguimiento: 'k3n8x2p9qm4vb7ctd5ef' };

  pctx.__M = Object.assign({}, base, { arreglo: 'Módulo + Batería', arreglos: [
    { texto: 'Módulo', precio: 85000, hecho: false },
    { texto: 'Batería', precio: 25000, hecho: false },
  ], monto: 110000 });
  const varias = vm.runInContext('_buildA5(__M)', pctx);
  ok(/• Módulo/.test(varias) && /• Batería/.test(varias), 'salen las dos, una por renglón');
  ok(/85\.000/.test(varias) && /25\.000/.test(varias), 'con su precio cada una');
  ok(/110\.000/.test(varias), 'y el total');

  // Con una sola, la boleta tiene que salir como salía antes.
  pctx.__U = Object.assign({}, base, { arreglo: 'Módulo', arreglos: [{ texto: 'Módulo', precio: 85000 }], monto: 85000 });
  const una = vm.runInContext('_buildA5(__U)', pctx);
  ok(/class="desc">Módulo/.test(una), 'con una sola sale como siempre, sin lista');
  // Ojo: `.arr-tot` está en el CSS de TODA boleta. Hay que buscar el marcado.
  ok(!/class="arr arr-tot"/.test(una), 'y sin renglón de total');
  ok(/class="arr arr-tot"/.test(varias), 'que con varias sí aparece');

  // Orden vieja: sin `arreglos`, solo el texto.
  pctx.__V = Object.assign({}, base, { arreglo: 'Módulo / Pantalla', monto: 85000 });
  const vieja = vm.runInContext('_buildA5(__V)', pctx);
  ok(/class="desc">Módulo \/ Pantalla/.test(vieja), 'una orden vieja se imprime igual que antes');

  console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
  process.exit(fails ? 1 : 0);
})();
