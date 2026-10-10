// Dar de baja lo que se rompe antes de venderse.
//
// Los vidrios templados y el hidrogel a veces vienen rotos de fábrica y a
// veces se rompen colocándolos. Las pantallas, más todavía. Esas unidades
// salen del stock igual que si se vendieran, pero no entró plata: sin
// descontarlas, el inventario dice que hay veinte y hay diecisiete.
//
// Los dos motivos se separan a propósito: "vino roto" es un reclamo al
// proveedor, "se rompió colocándolo" es costo del trabajo. Mezclados, el
// número no sirve para decidir nada.
//
// roturas.js es uno solo para las dos páginas: accesorios y repuestos hacen lo
// mismo, con otra colección y otro campo de stock.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = {};
const el = id => els[id] = {
  id, value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  focus() {}, addEventListener() {}, remove() { delete els[this.id]; },
};
const E = id => els[id] || el(id);

const TOASTS = [], ESCRITO = [];
let CONFIRMA = true, LEIDAS = [], FILTRO = null, FALLAR = false, CERRO = 0;

const ctx = {
  console, setTimeout: f => f(), clearTimeout, Date, Math, JSON, Number, String, parseInt,
  document: {
    getElementById: id => els[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el('creado-' + Math.random()),
    addEventListener() {},
    body: { style: {}, appendChild(n) { els[n.id] = n; } },
  },
  navigator: { userAgent: 'node' },
  esc: s => String(s == null ? '' : s),
  toast: (m, t) => TOASTS.push([t || 'info', m]),
  confirm: () => CONFIRMA,
  _todayAR: () => '2026-10-10',
  tpFirma: () => ({ cargadoPor: 'Alan', cargadoPorUid: 'u1' }),
  _cajaIsOwner: true,
  db: {
    collection: nombre => ({
      add: async d => { if (FALLAR === 'merma') throw new Error('sin internet'); ESCRITO.push({ op: 'add', col: nombre, data: d }); return { id: 'm1' }; },
      doc: id => ({ update: async d => { if (FALLAR === 'stock') throw new Error('sin internet'); ESCRITO.push({ op: 'update', col: nombre, id, data: d }); } }),
      where: (campo, op, val) => { FILTRO = { campo, op, val }; return { get: async () => ({ size: LEIDAS.length, docs: LEIDAS.map(x => ({ id: 'x', data: () => x })) }) }; },
    }),
  },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({ __ts: true }) } } },
};
ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(leer('roturas.js'), ctx, { filename: 'roturas.js' });
const run = e => vm.runInContext(e, ctx);
run('toast = (m, t) => __T(m, t);');
ctx.__T = (m, t) => TOASTS.push([t || 'info', m]);
ctx.__CERRO = () => { CERRO++; };

const VIDRIO = { id: 'p1', nombre: 'Vidrio templado iPhone 15', codigo: 'TP00041',
                 categoria: 'Vidrio templado / Hidrogel' };
const abrirVidrio = (stock = 20) => {
  ctx.__CFG = { coleccion: 'productos', campoStock: 'stock', origen: 'accesorio',
                item: { ...VIDRIO, stock }, costo: 1500, alTerminar: () => ctx.__CERRO() };
  run('tpRotura(__CFG)');
};
const ultimaMerma = () => [...ESCRITO].reverse().find(x => x.col === 'mermas');
const ultimoStock = () => [...ESCRITO].reverse().find(x => x.op === 'update');

(async () => {

console.log('\n1) El cartel');
abrirVidrio();
ok(!!els['tp-rotura-modal'], 'se abre');
const html = els['tp-rotura-modal'].innerHTML;
ok(/Vidrio templado iPhone 15/.test(html), 'dice qué artículo es');
ok(/hay 20 en stock/.test(html), 'y cuántos figuran, para darte cuenta si no cierra');
ok(/Vino roto/.test(html) && /Se rompió colocándolo/.test(html), 'con los dos motivos que importan');
ok(/Costo: \$1\.500/.test(html), 'y el costo, porque sos el dueño');
run('_cajaIsOwner = false'); abrirVidrio();
ok(!/Costo:/.test(els['tp-rotura-modal'].innerHTML), 'a un empleado no le muestra el costo');
run('_cajaIsOwner = true');

console.log('\n2) Accesorio: descuenta y deja registro');
ESCRITO.length = 0;
abrirVidrio();
E('rot-cant').value = '3';
E('rot-nota').value = 'caja del 3/10';
run("_rotMotivoElegido = 'proveedor'");
await run('guardarRotura()');

const mer = ultimaMerma();
ok(!!mer && mer.op === 'add', 'queda el registro', ESCRITO.map(x => x.col));
ok(mer.data.cantidad === 3 && mer.data.motivo === 'proveedor', 'con cuántos y por qué', mer.data);
ok(mer.data.origen === 'accesorio', 'marcado como accesorio', mer.data.origen);
ok(mer.data.costoUnit === 1500 && mer.data.costoTotal === 4500, 'con lo que perdiste', mer.data);
ok(mer.data.fecha === '2026-10-10' && mer.data.cargadoPor === 'Alan', 'fecha argentina y quién lo cargó', mer.data);
ok(mer.data.nota === 'caja del 3/10', 'y la nota, que sirve para el reclamo');
const st = ultimoStock();
ok(st.col === 'productos' && st.id === 'p1' && st.data.stock.__inc === -3,
   'el stock del accesorio baja 3', st);
ok(CERRO === 1, 'y se cierra la ficha');
ok(!ESCRITO.some(x => x.col === 'caja_movimientos'),
   'no se carga como gasto del día: sería contar el mismo peso dos veces', ESCRITO.map(x => x.col));

console.log('\n3) Repuesto: el mismo cartel, otra colección');
// Las pantallas se rompen al colocarlas más seguido que los vidrios.
ESCRITO.length = 0;
ctx.__CFG = { coleccion: 'repuestos', campoStock: 'cantidad', origen: 'repuesto',
              item: { id: 'r1', nombre: 'Pantalla A54', codigo: 'TP00099', categoria: 'Pantalla', stock: 4 },
              costo: 30000, alTerminar: () => {} };
run('tpRotura(__CFG)');
E('rot-cant').value = '1';
run("_rotMotivoElegido = 'colocacion'");
await run('guardarRotura()');
const st2 = ultimoStock();
ok(st2.col === 'repuestos' && st2.data.cantidad.__inc === -1,
   'descuenta de `cantidad`, que es como se llama en repuestos', st2);
ok(ultimaMerma().data.origen === 'repuesto', 'y el registro queda marcado como repuesto');
ok(ultimaMerma().data.motivo === 'colocacion', 'con el motivo elegido');

console.log('\n4) El orden importa');
// Si fallara el descuento, el número del stock lo ves en pantalla y lo
// corregís. Un motivo que no se guardó no te enterás nunca.
const src = leer('roturas.js');
const bloque = src.slice(src.indexOf('async function guardarRotura'), src.indexOf('// ── El informe'));
ok(bloque.indexOf("collection('mermas')") < bloque.indexOf('collection(cfg.coleccion)'),
   'el registro se escribe antes que el descuento');
ESCRITO.length = 0;
FALLAR = 'merma';
const grito = [console.warn, console.error];
console.warn = console.error = () => {};   // el fallo es a proposito
abrirVidrio();
E('rot-cant').value = '1';
await run('guardarRotura()');
[console.warn, console.error] = grito;
FALLAR = false;
ok(!ESCRITO.some(x => x.op === 'update'), 'si no se pudo registrar, tampoco se descuenta a ciegas', ESCRITO);
ok(TOASTS.some(t => t[0] === 'error'), 'y avisa');

console.log('\n5) Nunca deja el stock en negativo');
ESCRITO.length = 0;
CONFIRMA = false;
abrirVidrio(2);
E('rot-cant').value = '5';
await run('guardarRotura()');
ok(ESCRITO.length === 0, 'dando de baja más de lo que hay, pregunta antes', ESCRITO);
CONFIRMA = true;
abrirVidrio(2);
E('rot-cant').value = '5';
await run('guardarRotura()');
ok(ultimaMerma().data.cantidad === 5, 'si confirmás, registra los 5 que se rompieron');
ok(ultimoStock().data.stock.__inc === -2, 'pero del stock saca 2, que es lo que había', ultimoStock().data);

ESCRITO.length = 0;
abrirVidrio();
E('rot-cant').value = '0';
await run('guardarRotura()');
ok(ESCRITO.length === 0, 'cero no da de baja nada');

console.log('\n6) El informe junta accesorios y repuestos');
LEIDAS = [
  { fecha:'2026-10-02', createdAt:'2026-10-02T10:00:00Z', nombre:'Vidrio A',     cantidad:4, motivo:'proveedor',  costoTotal:6000,  cargadoPor:'Alan', origen:'accesorio' },
  { fecha:'2026-10-05', createdAt:'2026-10-05T10:00:00Z', nombre:'Pantalla A54', cantidad:2, motivo:'colocacion', costoTotal:60000, cargadoPor:'Dani', origen:'repuesto' },
  { fecha:'2026-10-07', createdAt:'2026-10-07T10:00:00Z', nombre:'Vidrio A',     cantidad:5, motivo:'proveedor',  costoTotal:7500,  cargadoPor:'Alan', origen:'accesorio' },
];
await run('tpAbrirRoturas()');
// CUPO: no se lee la colección entera, se acota al mes.
ok(FILTRO && FILTRO.campo === 'fecha' && FILTRO.val === '2026-10-01',
   'lee solo desde el 1° del mes, no la colección entera', FILTRO);
const inf = els['tp-roturas-modal'].innerHTML;
ok(/9 u\./.test(inf), 'suma 9 del proveedor (4 + 5)');
ok(/11 u\./.test(inf), 'y 11 en total');
ok(/Pantalla A54/.test(inf) && /· repuesto/.test(inf), 'los repuestos aparecen y se distinguen');
ok(inf.indexOf('Vidrio A') < inf.indexOf('Pantalla A54'), 'lo más nuevo primero');
ok(/\$73\.500/.test(inf), 'con la plata perdida', (inf.match(/\$[\d.]+/g) || []));

run('_cajaIsOwner = false');
await run('tpAbrirRoturas()');
const inf2 = els['tp-roturas-modal'].innerHTML;
ok(/11 u\./.test(inf2) && !/\$73\.500/.test(inf2), 'un empleado ve las unidades pero no los pesos');
run('_cajaIsOwner = true');

LEIDAS = [];
await run('tpAbrirRoturas()');
ok(/Ninguna rotura/.test(els['tp-roturas-modal'].innerHTML), 'sin roturas lo dice, no muestra una tabla vacía');

console.log('\n7) Enganchado en las dos pantallas');
ok(/id="inv-form-rotura"/.test(leer('caja.html')), 'botón en la ficha del accesorio');
ok(/id="rep2-form-rotura"/.test(leer('index.html')), 'y en la del repuesto');
// El botón nace escondido: si nadie lo muestra al abrir una ficha guardada,
// está en el HTML pero no lo ve nadie.
ok(leer('repuestos.js').includes("if (rotBtn) rotBtn.style.display = id ? '' : 'none';"),
   'y se muestra al abrir un repuesto guardado, no al crear uno nuevo');
ok(/src="roturas\.js"/.test(leer('caja.html')) && /src="roturas\.js"/.test(leer('index.html')),
   'las dos páginas cargan el mismo archivo');
ok(/coleccion: 'productos', campoStock: 'stock'/.test(leer('inventario.js')), 'accesorios: colección productos');
ok(/coleccion: 'repuestos', campoStock: 'cantidad'/.test(leer('repuestos.js')), 'repuestos: colección repuestos');
ok(/Roturas del mes/.test(leer('inventario.js')) && /Roturas del mes/.test(leer('app.js')),
   'y el informe está en los dos menús');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})().catch(e => { console.error('Error:', e); process.exit(1); });
