// La lista de precios sacada del historial.
//
// Los precios de verdad ya están en las reparaciones hechas: cada orden dice
// qué arreglo fue y cuánto se cobró. Esto los junta y propone la lista, que
// hasta ahora se cargaba a mano.
//
// Tres cosas definen si el número que sale sirve o no:
//  · agrupar por ARREGLO y no por orden (una orden puede tener dos arreglos);
//  · entender que "Pantalla", "modulo" y "Módulo + Templado" son lo mismo;
//  · proponer el ÚLTIMO precio y no el promedio: con la inflación de acá, el
//    promedio de seis meses propone precios de hace tres.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = {};
const el = id => els[id] = { id, value: '', textContent: '', innerHTML: '', disabled: false, style: {},
  classList: { add() {}, remove() {}, contains: () => false }, addEventListener() {} };
['ph-modal', 'ph-overlay', 'ph-lista', 'ph-nota', 'ph-meses', 'ph-criterio', 'ph-guardar'].forEach(el);

const ESCRITO = [];
const ctx = {
  console, Math, JSON, Date, Number, String, Object, Array, isFinite, parseInt, parseFloat, Set, Map, Infinity,
  setTimeout: f => f(), clearTimeout,
  document: { getElementById: id => els[id] || null, querySelectorAll: () => [],
              createElement: () => el('tmp'), body: { style: {} }, addEventListener() {} },
  window: {}, localStorage: { getItem: () => null, setItem() {} },
  esc: s => String(s == null ? '' : s),
  fmt: n => '$' + Number(n || 0).toLocaleString('es-AR'),
  toast: () => {}, cupoContar: () => {},
  PRECIOS: [],
  db: {
    batch: () => ({ _c: [], set(ref, d, o) { this._c.push({ id: ref.__id, d, o }); },
                    commit: async function () { ESCRITO.push(...this._c); } }),
    collection: () => ({ doc: id => ({ __id: id || 'nuevo' }) }),
  },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('precios-historial.js'), ctx, { filename: 'precios-historial.js' });
const run = e => vm.runInContext(e, ctx);
const call = (f, ...a) => { ctx.__a = a; return run(`${f}(...__a)`); };

(async () => {

console.log('\n1) El texto libre cae en la categoría que usa la lista');
// En las órdenes el arreglo se escribe a mano: hay de todo.
[['Módulo / Pantalla', 'Pantalla / Módulo'], ['pantalla', 'Pantalla / Módulo'],
 ['Modulo + Templado', 'Pantalla / Módulo'], ['display roto', 'Pantalla / Módulo'],
 ['Batería', 'Batería'], ['cambio de bateria', 'Batería'],
 ['Ficha de carga', 'Pin de carga'], ['pin de carga', 'Pin de carga'], ['Conector', 'Pin de carga'],
 ['Cámara trasera', 'Cámara'], ['altavoz', 'Parlante / Auricular'], ['Micrófono', 'Micrófono'],
 ['Placa — mojado', 'Placa'], ['liberacion', 'Software / Liberación'],
 ['Revisión', 'Otro'], ['', 'Otro']].forEach(([txt, esp]) => {
  ok(call('phTipoDe', txt) === esp, `"${txt || '(vacío)'}" → ${esp}`, call('phTipoDe', txt));
});
// El orden de las reglas importa: "ficha de carga" no puede irse a otro lado
// por la palabra "carga", y "placa mojada" es placa, no pantalla.
ok(call('phTipoDe', 'Placa con pantalla rota') === 'Placa', 'placa gana sobre pantalla: es el arreglo caro');

console.log('\n2) Un renglón por arreglo, no por orden');
// Una orden con pantalla y batería son DOS precios distintos. Usar el total
// de la orden daría un precio que no existe.
const REPS = [
  { marca: 'Samsung', modelo: 'A54', fechaIngreso: '2026-10-01', monto: 95000,
    arreglos: [{ texto: 'Módulo / Pantalla', precio: 80000 }, { texto: 'Batería', precio: 15000 }] },
  // Vieja: sin `arreglos`, el arreglo es uno solo y vale el monto.
  { marca: 'Samsung', modelo: 'A54', fechaIngreso: '2026-09-02', arreglo: 'Pantalla', monto: 72000 },
  { marca: 'Samsung', modelo: 'A54', fechaIngreso: '2026-11-01', arreglo: 'pantalla', monto: 88000 },
  // Sin precio no sirve para una lista de precios.
  { marca: 'Motorola', modelo: 'G52', fechaIngreso: '2026-10-10', arreglo: 'Revisión', monto: 0 },
  // Sin equipo tampoco se puede agrupar.
  { marca: '', modelo: '', fechaIngreso: '2026-10-11', arreglo: 'Pantalla', monto: 50000 },
];
const filas = call('phFilas', REPS);
ok(filas.length === 4, 'cuatro renglones con precio', filas.map(f => f.texto + ' ' + f.precio));
ok(filas.filter(f => f.equipo === 'Samsung A54').length === 4, 'los cuatro del mismo equipo');
ok(!filas.some(f => f.precio === 95000), 'el total de la orden NO entra como precio', filas.map(f => f.precio));
ok(filas.some(f => f.tipo === 'Batería' && f.precio === 15000), 'la batería sale con SU precio');

console.log('\n3) El precio que propone');
const g = call('phAgrupar', filas, 'ultimo');
const pant = g.find(x => x.tipo === 'Pantalla / Módulo');
ok(pant.veces === 3, 'junta las tres pantallas del A54, escritas distinto', pant.veces);
ok(pant.ultimo === 88000, 'el último cobrado es el del 1/11', pant.ultimo);
ok(pant.min === 72000 && pant.max === 88000, 'y muestra entre cuánto y cuánto', [pant.min, pant.max]);
ok(pant.sugerido === 88000, 'por defecto propone el último: con inflación el promedio atrasa', pant.sugerido);
ok(call('phAgrupar', filas, 'mediana').find(x => x.tipo === 'Pantalla / Módulo').sugerido === 80000,
   'con "el del medio" propone la mediana (72, 80, 88)');
ok(call('phMediana', [10, 20, 30]) === 20 && call('phMediana', [10, 20, 30, 40]) === 25,
   'la mediana, con cantidad impar y par');
// Empate en lo que más se repite: gana el más alto, que en la práctica es el
// más nuevo (los precios suben, no bajan).
ok(call('phModa', [10, 10, 20, 20]) === 20, 'empatados, el más alto');
ok(call('phModa', [5, 9, 9, 2]) === 9, 'y si no, el que más veces aparece');

console.log('\n4) Ordenado por lo que más hacés');
ok(g[0].veces >= g[g.length - 1].veces, 'primero lo que más se repitió', g.map(x => x.tipo + ':' + x.veces));

console.log('\n5) Lo que se carga a la lista');
ctx.__G = g;
run('PH_GRUPOS = __G; PH_SEL = {}; PH_EDIT = {};');
run('PH_GRUPOS.forEach(x => { if (x.veces >= 2) PH_SEL[phClave(x)] = true; });');
ok(run('phElegidos().length') === 1, 'arrancan tildados los que se repitieron, no las changas', run('phElegidos().map(x => x.tipo)'));

// Lo que ya está en la lista se actualiza, no se duplica.
run("PRECIOS = [{ id: 'p1', tipo: 'Pantalla / Módulo', equipo: 'samsung a54', precio: 60000 }]");
ok(!!call('phYaEsta', pant), 'reconoce el que ya está aunque esté escrito distinto', call('phYaEsta', pant));
ESCRITO.length = 0;
await run('phGuardar()');
ok(ESCRITO.length === 1, 'escribe uno solo');
ok(ESCRITO[0].id === 'p1' && ESCRITO[0].o && ESCRITO[0].o.merge === true,
   'sobre el que ya existía, sin duplicarlo', ESCRITO[0]);
ok(ESCRITO[0].d.precio === 88000 && ESCRITO[0].d.tipo === 'Pantalla / Módulo', 'con el precio propuesto', ESCRITO[0].d);
ok(/3 veces/.test(ESCRITO[0].d.nota), 'y la nota dice de dónde salió', ESCRITO[0].d.nota);

// Un precio tocado a mano manda sobre el sugerido.
run("PRECIOS = []; PH_EDIT[phClave(PH_GRUPOS.find(x => x.tipo === 'Pantalla / Módulo'))] = 99000;");
ESCRITO.length = 0;
await run('phGuardar()');
ok(ESCRITO[0].d.precio === 99000, 'lo que escribís a mano gana', ESCRITO[0].d.precio);

console.log('\n6) El cupo: una sola lectura, cuando se pide');
const src = leer('precios-historial.js');
ok(!/onSnapshot/.test(src), 'no engancha ningún listener nuevo');
ok(/cupoContar\('repairs', snap\.size\)/.test(src), 'y cuenta lo que leyó, para el contador de cupo');
ok(/where\('fechaIngreso', '>=', phDesde\(meses\)\)/.test(src),
   'por defecto lee un período, no las órdenes de todos los años');
ok(call('phDesde', 6).length === 10, 'la fecha de corte sale en formato de la base', call('phDesde', 6));

console.log('\n7) Enganchado en la caja');
const html = leer('caja.html');
ok(/precios-historial\.js/.test(html), 'el script se carga');
ok(/id="ph-modal"/.test(html), 'y el cuadro está en la página');
ok(/phAbrir\(\)/.test(html), 'se entra desde el cuadro de precios de reparación');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})().catch(e => { console.error('Error:', e); process.exit(1); });
