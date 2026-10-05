// Costo de los accesorios en dólares (inventario.js) y la carga en lista.
//
// Lo que se cuida:
//  · el costo se carga en dólares y el de pesos sale del dólar del día;
//  · los productos cargados antes (costo solo en pesos) no pierden su costo;
//  · la caja usa ese mismo costo para la ganancia de la venta;
//  · "Cargar costos" guarda solo lo que cambió, y solo el dueño.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ctx = { console, Math, Number, String, Array, Object, JSON, Date, dolarBlue: 1200, fmtNum: n => String(n) };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(leer('inventario.js'), ctx, { filename: 'inventario.js' });
const run = (c, v) => { ctx._v = v; return vm.runInContext(c, ctx); };

console.log('\n1) El costo en pesos sale de los dólares');
ok(run('invCostoARS(_v)', { precioCostoUSD: 5, precioCosto: 3000 }) === 6000, 'u$5 al dólar de $1.200 → $6.000 (gana a lo guardado en pesos)');
ok(run('invCostoARS(_v)', { precioCosto: 3000 }) === 3000, 'un producto viejo, sin dólares, conserva su costo en pesos');
ok(run('invCostoARS(_v)', {}) === 0, 'sin costo, cero');
ctx.dolarBlue = 0;
ok(run('invCostoARS(_v)', { precioCostoUSD: 5, precioCosto: 3000 }) === 3000, 'sin dólar del día, usa el último costo en pesos');
ctx.dolarBlue = 1200;

console.log('\n2) Guardar desde el formulario');
const inv = leer('inventario.js');
const save = inv.slice(inv.indexOf('async function saveProducto'), inv.indexOf('function _invIsOwner'));
ok(/precioCostoUSD: costoUSD/.test(save), 'se guarda el costo en dólares');
ok(/if \(costoARS > 0\) data\.precioCosto = costoARS/.test(save), 'y también en pesos');
ok(/else if \(!_invEditingId\) data\.precioCosto = 0/.test(save), 'al editar sin costo no se borra el que tenía');
// El costo se carga en la moneda en que compraste: los accesorios casi siempre
// en pesos, los repuestos en dólares. Antes era solo USD y para una funda de
// $4.500 había que dividir de memoria.
ok(/const enUSD    = invMoneda\(\) === 'usd';/.test(save), 'en la moneda que elegiste');
ok(/const costoUSD = enUSD \? costoIn : \(dolarHoy > 0 \? costoIn \/ dolarHoy : 0\)/.test(save),
   'si cargás pesos, los dólares salen del dólar de hoy');
ok(/const costoARS = enUSD \? \(dolarHoy > 0 \? Math\.round\(costoIn \* dolarHoy\) : 0\) : Math\.round\(costoIn\)/.test(save),
   'y al revés: lo que escribiste se guarda tal cual, lo otro convertido');
const caja = leer('caja.html');
ok(/id="inv-fi-costoUSD"/.test(caja) && !/id="inv-fi-pc"/.test(caja), 'el formulario pide el costo');
ok(/onclick="invSetMoneda\('ars'\)"/.test(caja) && /onclick="invSetMoneda\('usd'\)"/.test(caja),
   'con el botoncito para elegir $ o u$');
ok(/<div class="fg owner-only">\s*<label class="fl">\s*Costo/.test(caja), 'y sigue siendo solo del dueño');
ok(/body\.owner-mode \.fg\.owner-only \{ display: block !important; \}/.test(leer('style.css')), 'y en modo dueño se ve en su renglón, no amontonado');

console.log('\n2b) La moneda queda elegida para toda la tanda');
// Cargando 50 fundas seguidas, tocar $ / u$ en cada una es un toque al pedo.
ok(/localStorage\.setItem\('invMonedaCosto'/.test(inv), 'la eleccion se guarda en el dispositivo');
ok(/getItem\('invMonedaCosto'\) === 'usd' \? 'usd' : 'ars'/.test(inv), 'y arranca en pesos, que es como se compran los accesorios');
const hint = inv.slice(inv.indexOf('function _invHintCosto'), inv.indexOf('function _invHintCosto') + 700);
ok(/≈ \$/.test(hint) && /≈ u\$/.test(hint),
   'y al lado te muestra el equivalente en la otra moneda (el control de que no te comiste un cero)');

console.log('\n3) La caja usa el mismo costo');
const cj = leer('caja.js');
ok((cj.match(/invCostoARS\(p(rod)?\)/g) || []).length === 2, 'al buscar y al escanear un accesorio');
ok((cj.match(/costoUSD: Number\(p(rod)?\.precioCostoUSD\) \|\| 0/g) || []).length === 2, 'con su costo en dólares');

console.log('\n4) Cargar costos en lista');
const el = (id, antes, valor) => ({ dataset: { id, antes: antes === '' ? '' : String(antes) }, value: String(valor) });
const cambios = run('_invCostosCambios(_v, 1000)', [el('a', 5, 5), el('b', '', 3.5), el('c', 2, 2.5), el('d', 4, '')]);
ok(cambios.length === 3 && !cambios.some(c => c.id === 'a'), 'solo los que cambiaron', cambios.map(c => c.id));
const b = cambios.find(c => c.id === 'b');
ok(b.data.precioCostoUSD === 3.5 && b.data.precioCosto === 3500, 'con dólares y pesos del día', b.data);
const d = cambios.find(c => c.id === 'd');
ok(d.data.precioCostoUSD === 0 && !('precioCosto' in d.data), 'borrar el costo en dólares no inventa uno en pesos', d.data);
const abrir = inv.slice(inv.indexOf('function abrirCostosInv'), inv.indexOf('function abrirCostosInv') + 300);
ok(/if \(!_invIsOwner\(\)\)/.test(abrir), 'solo el dueño');
ok(/_invFiltrados\(\)/.test(abrir), 'con la lista que estás viendo (filtros y búsqueda)');
ok(/label: 'Cargar costos'/.test(inv), 'está en el menú de Accesorios');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
