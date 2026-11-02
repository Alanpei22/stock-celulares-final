// Cargar costos en lista para equipos y repuestos (costos-lista.js).
//
// Antes había que abrir equipo por equipo y repuesto por repuesto para ponerle
// el costo. Lo que se cuida acá:
//  · se guarda IGUAL que el formulario de cada uno (el resto de la app lee
//    esos mismos campos para la ganancia);
//  · se guarda solo lo que cambió;
//  · solo el dueño;
//  · los menús no pasan de diez renglones y la opción está en los dos.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const BORRAR = { __borrar: true };
const ctx = { console, Math, Number, String, Array, Object, JSON, Date, dolarBlue: 1000, OWNER_MODE: false };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(leer('costos-lista.js'), ctx, { filename: 'costos-lista.js' });
const inp = (id, antes, valor) => ({ dataset: { id, antes: String(antes) }, value: String(valor) });
const cambios = (tipo, inputs, dolar) => { ctx._a = [tipo, inputs, dolar, BORRAR]; return vm.runInContext('_costosCambios(..._a)', ctx); };

console.log('\n1) Equipos: stock.costo en pesos, como el formulario');
let c = cambios('equipo', [inp('a', '', '250000'), inp('b', 300000, '300000'), inp('c', 5000, '')], 1000);
ok(c.length === 2, 'solo los que cambiaron (el que quedó igual no se toca)', c);
ok(c[0].id === 'a' && c[0].data.costo === 250000, 'costo nuevo en pesos', c[0]);
ok(c[1].id === 'c' && c[1].data.costo === BORRAR, 'si lo borrás, el campo se borra (no queda en 0)', c[1]);

console.log('\n2) Repuestos: pesos + dólares del día, como el formulario');
c = cambios('repuesto', [inp('r1', '', '12000'), inp('r2', 8000, '8000')], 1200);
ok(c.length === 1, 'solo el que cambió', c);
ok(c[0].data.precioCompra === 12000 && c[0].data.precioCostoUSD === 10 && c[0].data.dolarCosto === 1200,
   '$12.000 al dólar de $1.200 → u$10, y queda anotado el dólar', c[0]);
c = cambios('repuesto', [inp('r1', '', '12000')], 0);
ok(c[0].data.precioCompra === 12000 && c[0].data.precioCostoUSD === 0 && !('dolarCosto' in c[0].data),
   'sin cotización: se guarda en pesos y no se inventa el dólar', c[0]);

console.log('\n3) Lo que muestra el casillero de un repuesto');
ctx.dolarBlue = 1000;
ok(vm.runInContext('_COSTOS_CFG.repuesto.costo({ precioCompra: 9000, precioCostoUSD: 20 })', ctx) === 9000, 'lo que se pagó en pesos');
ok(vm.runInContext('_COSTOS_CFG.repuesto.costo({ precioCostoUSD: 20 })', ctx) === 20000, 'uno viejo solo en dólares: lo que vale hoy');
ok(vm.runInContext('_COSTOS_CFG.repuesto.costo({})', ctx) === 0, 'sin costo, vacío');

console.log('\n4) Solo el dueño');
const src = leer('costos-lista.js');
const abrir = src.slice(src.indexOf('function abrirCostosLista'), src.indexOf('function _costosFila'));
const guardar = src.slice(src.indexOf('async function guardarCostosLista'));
ok(/if \(!_costosEsDueno\(\)\)/.test(abrir), 'abrir la lista pide modo dueño');
ok(/if \(!_costosEsDueno\(\)\)/.test(guardar), 'y guardar también');
ok(/batch\.update\(/.test(guardar) && /i \+= 450/.test(guardar), 'se guarda en tandas (Firestore: hasta 500 por tanda)');

ok(/focusin[\s\S]{0,120}\.select\(\)/.test(abrir), 'al entrar a un casillero se marca el número: escribir lo reemplaza, no se pega al viejo');

console.log('\n5) Está en los menús y en la página');
const app = leer('app.js');
const stock = app.slice(app.indexOf("openSheet('Stock'"), app.indexOf('function closeHdrMenu'));
const rep = app.slice(app.indexOf("openSheet('Repuestos'"), app.indexOf('function closeRep2Menu'));
ok(/abrirCostosLista\('equipo'\)/.test(stock), 'Stock → Costos, exportar y backup → Cargar costos');
ok(/abrirCostosLista\('repuesto'\)/.test(rep), 'Repuestos → Costos y Excel → Cargar costos');
ok(/bulk-edit-repuestos\.html/.test(rep), 'el Excel de repuestos sigue estando');
ok(/<script defer src="costos-lista\.js"><\/script>/.test(leer('index.html')), 'index.html carga costos-lista.js');

console.log(fails ? `\n❌ ${fails} fallaron` : '\n✅ todo OK');
process.exit(fails ? 1 : 0);
