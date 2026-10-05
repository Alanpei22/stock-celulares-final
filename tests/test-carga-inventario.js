// Cargar el inventario de accesorios: artículo, cantidad, precio, costo y las
// etiquetas al final.
//
// Es una tanda larga: se cargan decenas de artículos de una sentada. Lo que se
// mide acá son los tres roces que la hacían lenta o inexacta:
//
//   · el costo solo se podía poner en dólares, y los accesorios se compran en
//     pesos: había que dividir de memoria en cada artículo;
//   · guardar cerraba el formulario, así que cada artículo costaba dos toques
//     de más (volver a abrir, volver a escanear);
//   · al terminar no había forma de imprimir las etiquetas de lo recién
//     cargado sin acordarse cuáles fueron.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const inv = fs.readFileSync(DIR + 'inventario.js', 'utf8');
const caja = fs.readFileSync(DIR + 'caja.html', 'utf8');

// ── Sandbox con el inventario.js de verdad ──
const LS = {};
const els = {};
const mk = id => (els[id] = { id, value: '', textContent: '', placeholder: '', checked: false, style: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  addEventListener() {}, focus() {}, select() {}, querySelector: () => null, querySelectorAll: () => [] });
['inv-mon-ars', 'inv-mon-usd', 'inv-fi-costoUSD', 'inv-fi-costoARS-hint', 'inv-search',
 'inv-f-cat', 'inv-f-estado'].forEach(mk);

const ctx = {
  console, Math, Date, JSON, Number, String, Array, Object, isNaN, parseFloat, parseInt,
  setTimeout: f => { f(); return 0; },
  document: { getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [],
              createElement: () => mk('tmp'), addEventListener() {}, body: { appendChild() {} } },
  localStorage: { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); } },
  toast: () => {}, fmtNum: n => String(n), esc: s => String(s),
  searchMatch: () => true, dolarBlue: 1200,
  _todayAR: () => '2026-10-06',
  firebase: { firestore: { FieldValue: { serverTimestamp: () => ({}) } } },
};
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(inv, ctx, { filename: 'inventario.js' });
const run = e => vm.runInContext(e, ctx);

console.log('\n1) El costo se carga en la moneda en que compraste');
ok(run('invMoneda()') === 'ars', 'arranca en pesos: así se compran los accesorios');
run("invSetMoneda('usd')");
ok(run('invMoneda()') === 'usd' && LS['invMonedaCosto'] === 'usd', 'se puede pasar a dólares');
ok(els['inv-mon-usd'].classList.contains('inv-mon-on') && !els['inv-mon-ars'].classList.contains('inv-mon-on'),
   'y se ve cuál está elegida');
run("invSetMoneda('ars')");
ok(run('invMoneda()') === 'ars' && els['inv-mon-ars'].classList.contains('inv-mon-on'), 'y volver');
// Queda guardada: en una tanda de 50 fundas, tocar $ / u$ en cada una es un
// toque al pedo cincuenta veces.
ok(LS['invMonedaCosto'] === 'ars', 'la elección queda guardada para toda la tanda');

console.log('\n2) El equivalente, al lado, mientras escribís');
// Es el control de que no te comiste un cero: $45.000 en una funda canta.
els['inv-fi-costoUSD'].value = '4500';
run('_invHintCosto()');
ok(/≈ u\$3\.75/.test(els['inv-fi-costoARS-hint'].textContent),
   '$4.500 al dólar de 1.200 → u$3,75', els['inv-fi-costoARS-hint'].textContent);
run("invSetMoneda('usd')");
els['inv-fi-costoUSD'].value = '5';
run('_invHintCosto()');
ok(/≈ \$6\.000/.test(els['inv-fi-costoARS-hint'].textContent), 'y al revés: u$5 → $6.000',
   els['inv-fi-costoARS-hint'].textContent);
els['inv-fi-costoUSD'].value = '';
run('_invHintCosto()');
ok(els['inv-fi-costoARS-hint'].textContent === '', 'sin costo no dice nada');
run("invSetMoneda('ars')");

console.log('\n3) Lo que se guarda, en las dos monedas');
const save = inv.slice(inv.indexOf('async function saveProducto'), inv.indexOf('function _invSiguiente'));
ok(/const costoUSD = enUSD \? costoIn : \(dolarHoy > 0 \? Math\.round\(\(costoIn \/ dolarHoy\) \* 100\) \/ 100 : 0\)/.test(save),
   'cargás pesos → los dólares salen del dólar de hoy, a dos decimales');
ok(/const costoARS = enUSD \? \(dolarHoy > 0 \? Math\.round\(costoIn \* dolarHoy\) : 0\) : Math\.round\(costoIn\)/.test(save),
   'cargás dólares → los pesos salen del dólar de hoy');
ok(/precioCostoUSD: costoUSD/.test(save) && /data\.precioCosto = costoARS/.test(save),
   'y los dos quedan en el documento: lo que escribiste, tal cual');

console.log('\n4) Guardar y seguir, sin cerrar');
ok(/onclick="saveProducto\(\{ seguir: true \}\)"/.test(caja), 'hay botón de "guardar y cargar otro"');
ok(/if \(seguir\) _invSiguiente\(cat\);\s*\n\s*else closeProductoForm\(\);/.test(inv),
   'guardando así, el formulario no se cierra');
const sig = inv.slice(inv.indexOf('function _invSiguiente'), inv.indexOf('function _invSiguiente') + 800);
ok(/_invEditingId = null/.test(sig), 'queda listo para un artículo nuevo, no editando el anterior');
ok(/if \(cat\) document\.getElementById\('inv-fi-cat'\)\.value = cat/.test(sig),
   'conservando la categoría: en una tanda suelen ser todos del mismo rubro');
ok(/cod\.focus\(\)/.test(inv.slice(inv.indexOf('function _invSiguiente'), inv.indexOf('function _invSiguiente') + 1100)),
   'y con el foco en el código, que es donde escribe el lector de mano');
// La cantidad se borra (cada articulo tiene la suya) pero el minimo se repite
// en toda la tanda: volver a escribirlo 150 veces no tiene sentido.
ok(/if \(stminAntes\) document\.getElementById\('inv-fi-stockmin'\)\.value = stminAntes/.test(inv),
   'y el stock minimo se conserva, la cantidad no');
// El lector manda el codigo y despues un Enter: ese Enter no puede mandar el
// formulario a medio llenar.
const atajos = inv.slice(inv.indexOf('function _initInvFormAtajos'), inv.indexOf('function _initInvScanInput'));
ok(/e\.preventDefault\(\)/.test(atajos) && /'inv-fi-nom'\)\?\.focus\(\)/.test(atajos),
   'el Enter del lector pasa al nombre, no guarda a medias');
ok(/otroBtn\.style\.display = id \? 'none' : ''/.test(inv), 'y editando uno viejo, ese botón no aparece');

console.log('\n4b) El modo dueño no se apaga en el medio de la tanda');
// El campo del COSTO vive adentro de `.owner-only`. Si el modo dueño se apaga
// solo a los 15 minutos, el campo desaparece en el medio y todo lo que cargues
// después queda con costo cero, sin que nada avise.
const extra = fs.readFileSync(DIR + 'caja_extra.js', 'utf8');
ok(/function _cajaOwnerRenovar/.test(extra), 'los 15 minutos se pueden renovar');
ok(/_cajaOwnerRenovar\(\);\s*\n\s*closeCajaOwnerPin\(\)/.test(extra), 'al poner el PIN arranca el reloj');
ok(/if \(typeof _cajaOwnerRenovar === 'function'\) _cajaOwnerRenovar\(\)/.test(inv),
   'y cada artículo guardado lo renueva');
ok(/<div class="fg owner-only">/.test(caja), '(el costo sigue siendo solo del dueño)');

console.log('\n5) Las etiquetas de lo cargado hoy');
const hoy = { fechaAlta: { toDate: () => new Date('2026-10-06T14:00:00-03:00') } };
const ayer = { fechaAlta: { toDate: () => new Date('2026-10-05T14:00:00-03:00') } };
// 21:00 de acá ya es el dia siguiente en Londres: no tiene que contar como de ayer.
const anoche = { fechaAlta: { toDate: () => new Date('2026-10-06T21:30:00-03:00') } };
ctx.__p = hoy;    ok(run('_invEsDeHoy(__p)') === true, 'uno de hoy, sí');
ctx.__p = ayer;   ok(run('_invEsDeHoy(__p)') === false, 'uno de ayer, no');
ctx.__p = anoche; ok(run('_invEsDeHoy(__p)') === true, 'y uno de las 21:30 sigue siendo de hoy');
ctx.__p = {};     ok(run('_invEsDeHoy(__p)') === false, 'uno viejo sin fecha, no');
ok(/label: 'Etiquetas de lo cargado hoy'/.test(inv), 'está en el menú');
ok(/PRODUCTOS\.filter\(_invEsDeHoy\)/.test(inv.slice(inv.indexOf('function etiquetasDeHoy'))),
   'y saca justo esos');
ok(/value="hoy">🆕 Cargados hoy/.test(caja), 'también como filtro de la lista');
ok(/if \(estF === 'hoy'\)\s+lista = lista\.filter\(_invEsDeHoy\)/.test(inv), 'con la misma cuenta');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
