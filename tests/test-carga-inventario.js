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
// Como en el navegador: utils.js primero, inventario.js después. El menú usa
// sheetGrupo(), que vive en utils.js. Los ayudantes de mentira se reponen
// encima, porque utils.js trae los de verdad y tocan el DOM.
// Todo lo que el test dejó puesto a mano (incluido _todayAR, que fija el día)
// se repone encima: utils.js trae las de verdad y pisarían al de mentira.
const _stubs = Object.fromEntries(Object.entries(ctx).filter(([, v]) => typeof v === 'function'));
vm.runInContext(fs.readFileSync(DIR + 'utils.js', 'utf8'), ctx, { filename: 'utils.js' });
// Hay que reponerlos DESDE ADENTRO: una `function` declarada por el script
// queda enganchada al global interno y asignar sobre `ctx` no la pisa.
ctx.__stubs = _stubs;
vm.runInContext(Object.keys(_stubs).filter(k => /^[A-Za-z_$][\w$]*$/.test(k))
  .map(k => `try { ${k} = __stubs[${JSON.stringify(k)}]; } catch (e) {}`)
  .join(String.fromCharCode(10)), ctx);
vm.runInContext(inv, ctx, { filename: 'inventario.js' });
const run = e => vm.runInContext(e, ctx);

(async () => {

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

console.log('\n4c) Crear categorías sobre la marcha');
// Eran ocho y fijas. Si mañana entra algo que no entra en ninguna (parlantes,
// memorias, soportes), no se puede frenar la carga para tocar código.
const CATS = [];
ctx.db = { collection: () => ({ doc: () => ({
  get: async () => ({ exists: true, data: () => ({ lista: ['Parlantes'] }) }),
  set: async d => { CATS.push(d); },
}) }) };
mk('inv-fi-cat'); mk('inv-f-cat');
run('PRODUCTOS = []');
run('_invLlenarCats()');
ok(/Crear categoría…/.test(els['inv-fi-cat'].innerHTML), 'el select trae la opción de crear');
ok(/value="Cable"/.test(els['inv-fi-cat'].innerHTML), 'con las de fábrica');
ok(!/Crear categoría/.test(els['inv-f-cat'].innerHTML), 'pero el filtro no: ahí no se crea nada');

// Las propias llegan de Firestore y valen para todos los dispositivos.
await run('invCargarCategorias()');
ok(/value="Parlantes"/.test(els['inv-fi-cat'].innerHTML), 'las propias se leen de la base',
   els['inv-fi-cat'].innerHTML.slice(0, 120));

// Y una categoría que quedó en un producto viejo no desaparece del filtro.
run("PRODUCTOS = [{ categoria: 'Memorias' }]");
run('_invLlenarCats()');
ok(/value="Memorias"/.test(els['inv-f-cat'].innerHTML),
   'y la que ya usa un producto tampoco se pierde');

// Crear una: queda elegida en el acto y guardada para la próxima.
ctx.prompt = () => 'Soportes';
els['inv-fi-cat'].value = '__nueva';
await run('_invCatElegida()');
ok(els['inv-fi-cat'].value === 'Soportes', 'al crearla queda elegida, sin tener que buscarla', els['inv-fi-cat'].value);
ok(CATS.length === 1 && CATS[0].lista.indexOf('Soportes') >= 0, 'y se guarda en la base', CATS);
// Repetida, no.
ctx.prompt = () => 'soportes';
els['inv-fi-cat'].value = '__nueva';
await run('_invCatElegida()');
ok(CATS.length === 1, 'la misma dos veces no se duplica (ni cambiando mayúsculas)', CATS.length);
ok(els['inv-fi-cat'].value === 'Soportes', 'y te deja parado en la que ya existía');
// Cancelar el cartel no rompe nada.
ctx.prompt = () => null;
els['inv-fi-cat'].value = '__nueva';
await run('_invCatElegida()');
ok(els['inv-fi-cat'].value === '', 'si cancelás, queda sin categoría y no "__nueva"', els['inv-fi-cat'].value);

console.log('\n5) Las etiquetas de lo cargado hoy');
// El día sale del _todayAR de utils.js, el mismo que usa la app: así la
// prueba vale cualquier día que se corra, y no el 6 de octubre nada más.
const _d = run('_todayAR()');
const hoy = { fechaAlta: { toDate: () => new Date(_d + 'T14:00:00-03:00') } };
const _ayerStr = new Date(new Date(_d + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
const ayer = { fechaAlta: { toDate: () => new Date(_ayerStr + 'T14:00:00-03:00') } };
// 21:00 de acá ya es el día siguiente en Londres: no tiene que contar como de ayer.
const anoche = { fechaAlta: { toDate: () => new Date(_d + 'T21:30:00-03:00') } };
ctx.__p = hoy;    ok(run('_invEsDeHoy(__p)') === true, 'uno de hoy, sí');
ctx.__p = ayer;   ok(run('_invEsDeHoy(__p)') === false, 'uno de ayer, no');
ctx.__p = anoche; ok(run('_invEsDeHoy(__p)') === true, 'y uno de las 21:30 sigue siendo de hoy');
ctx.__p = {};     ok(run('_invEsDeHoy(__p)') === false, 'uno viejo sin fecha, no');
ok(/label: 'Etiquetas de lo cargado hoy'/.test(inv), 'está en el menú');
ok(/PRODUCTOS\.filter\(_invEsDeHoy\)/.test(inv.slice(inv.indexOf('function etiquetasDeHoy'))),
   'y saca justo esos');
ok(/value="hoy">🆕 Cargados hoy/.test(caja), 'también como filtro de la lista');
ok(/if \(estF === 'hoy'\)\s+lista = lista\.filter\(_invEsDeHoy\)/.test(inv), 'con la misma cuenta');

console.log('\n6) El men\u00fa \u22ee se lee de una mirada');
// Lleg\u00f3 a doce opciones corridas, cinco de ellas de etiquetas. Un men\u00fa de
// doce no se lee: se busca. Las cinco se fueron adentro de una sola.
const HOJAS = [];
ctx.openSheet = (titulo, items) => HOJAS.push({ titulo, items });
ctx.toggleDarkMode = () => {};
ctx.openCajaOwnerPin = () => {};

// La hoja no se cierra para abrir la de adentro: si se cerrara, la otra
// entrar\u00eda 220 ms despu\u00e9s y se ver\u00eda el salto.


run('toggleInvMenu()');
const menu = HOJAS[HOJAS.length - 1];
const nombres = h => h.items.filter(i => !i.divider).map(i => i.label);
ok(menu.titulo === 'Inventario', 'el men\u00fa se llama Inventario', menu.titulo);
ok(nombres(menu).length <= 8, `${nombres(menu).length} opciones arriba (antes 11)`, nombres(menu));

const DE_ETIQUETAS = ['Imprimir etiquetas', 'Etiquetas de lo cargado hoy',
  'Generar c\u00f3digos de barras', 'Sentido de la etiqueta', 'Impresi\u00f3n directa'];
DE_ETIQUETAS.forEach(l => ok(nombres(menu).indexOf(l) < 0,
  `"${l}" ya no est\u00e1 suelta arriba`, nombres(menu)));

// Lo de todos los d\u00edas sigue a un toque: no se escondi\u00f3 nada m\u00e1s.
['Seleccionar varios', 'Control de stock guiado', 'Cargar costos', 'Modo due\u00f1o']
  .forEach(l => ok(nombres(menu).indexOf(l) >= 0, `"${l}" sigue arriba`, nombres(menu)));

const puerta = menu.items.find(i => typeof i.submenu === 'function');
ok(!!puerta, 'hay una opci\u00f3n que abre las de etiquetas', nombres(menu));
puerta.submenu();
const sub = HOJAS[HOJAS.length - 1];
DE_ETIQUETAS.forEach(l => ok(nombres(sub).indexOf(l) >= 0, `adentro est\u00e1 "${l}"`, nombres(sub)));

// Sin salida, un submen\u00fa es una trampa.
const volver = sub.items.find(i => i.label === 'Volver');
ok(!!volver && typeof volver.submenu === 'function', 'y se puede volver', nombres(sub));
volver.submenu();
ok(HOJAS[HOJAS.length - 1].titulo === 'Inventario', 'volver trae el men\u00fa de afuera',
   HOJAS[HOJAS.length - 1].titulo);

// La hoja no se cierra para abrir la de adentro: si se cerrara, la otra
// entraría 220 ms después y se vería el salto.

let cerro = 0, abrio = 0;
ctx.closeSheet = () => { cerro++; };
vm.runInContext('_sheetItems = [{ label: "x", submenu: () => _marca() }]', ctx);
ctx._marca = () => { abrio++; };
vm.runInContext('_sheetItemClick(0)', ctx);
ok(abrio === 1 && cerro === 0, 'tocar un submen\u00fa abre sin cerrar', { abrio, cerro });
vm.runInContext('_sheetItems = [{ label: "y", onClick: () => _marca() }]', ctx);
vm.runInContext('_sheetItemClick(0)', ctx);
ok(cerro === 1, 'y una opci\u00f3n normal sigue cerrando', { cerro });

console.log('\n7) El código de barras sale solo al agregar');
// Un artículo sin código no se escanea en la caja ni se etiqueta, y la
// etiqueta es el motivo por el que se carga. Antes guardaba con el código en
// blanco y había que acordarse de ir al menú a generarlos después.
['inv-fi-cod', 'inv-fi-nom', 'inv-fi-cat', 'inv-fi-pv', 'inv-fi-stock', 'inv-fi-stockmin',
 'inv-fi-activo', 'inv-form-save', 'inv-form-save-otro', 'inv-form-modal',
 'inv-form-title', 'inv-form-del', 'inv-form-etq'].forEach(mk);

// El contador de códigos de verdad (el utils.js que ya se cargó arriba),
// contra una base de mentira.
ctx.tpReservarCodigos = ctx.tpReservarCodigos;
ctx.tpMaxCodigoLocal  = ctx.tpMaxCodigoLocal;

let META = null, FALLAR = false;
const GUARDADO = [];
ctx.db = {
  collection: col => ({
    doc: () => ({
      get: async () => { if (FALLAR) throw new Error('sin internet'); return { exists: META !== null, data: () => META }; },
      set: async d => { if (FALLAR) throw new Error('sin internet'); META = Object.assign({}, META, d); },
      update: async d => { GUARDADO.push({ tipo: 'update', data: d }); },
    }),
    add: async d => { GUARDADO.push({ tipo: 'add', data: d }); return { id: 'x' }; },
  }),
};

const cargar = (cod, nom) => {
  els['inv-fi-cod'].value = cod; els['inv-fi-nom'].value = nom;
  els['inv-fi-cat'].value = 'Cable'; els['inv-fi-pv'].value = '8000';
  els['inv-fi-costoUSD'].value = '3000'; els['inv-fi-stock'].value = '5';
  els['inv-fi-stockmin'].value = '2'; els['inv-fi-activo'].checked = true;
};
const ultimo = () => GUARDADO[GUARDADO.length - 1];

run('PRODUCTOS = []; PRODUCTOS_MAP = new Map()');
cargar('', 'Cable USB-C 1m');
await run('saveProducto()');
ok(ultimo() && /^TP\d{5}$/.test(ultimo().data.codigo),
   'guardado sin escribir código, le sale uno interno TP#####', ultimo() && ultimo().data.codigo);
const primero = ultimo().data.codigo;

// Dos altas seguidas no pueden repetir el número: serían dos etiquetas iguales
// en la góndola y la caja no sabría cuál es cuál.
cargar('', 'Cable USB-C 2m');
await run('saveProducto()');
ok(ultimo().data.codigo !== primero, 'y el siguiente es otro número',
   [primero, ultimo().data.codigo]);
ok(Number(ultimo().data.codigo.slice(2)) === Number(primero.slice(2)) + 1, 'el que sigue, sin saltos',
   [primero, ultimo().data.codigo]);

// Si escaneás el código del envase, ese manda: es el que lee la caja.
cargar('7790040123456', 'Funda con código de fábrica');
await run('saveProducto()');
ok(ultimo().data.codigo === '7790040123456', 'el código escaneado no se pisa', ultimo().data.codigo);

// El número no se cuenta contra los códigos de fábrica: sigue por TP.
cargar('', 'Otro cable');
await run('saveProducto()');
ok(/^TP\d{5}$/.test(ultimo().data.codigo), 'y el de al lado vuelve a salir TP', ultimo().data.codigo);

// Sin internet se guarda igual: perder la carga del artículo es peor que
// quedarse sin código, que se puede generar después desde el menú.
FALLAR = true;
const grito = [console.warn, console.error];
console.warn = console.error = () => {};   // el fallo es a proposito
const antes = GUARDADO.length;
cargar('', 'Cable sin señal');
await run('saveProducto()');
FALLAR = false;
[console.warn, console.error] = grito;
ok(GUARDADO.length === antes + 1, 'sin internet el artículo se guarda igual', GUARDADO.length - antes);
ok(ultimo().data.codigo === '', 'sin código, que queda para "Generar códigos de barras"',
   ultimo().data.codigo);

// Y el aviso dice cuál le tocó: es el número que hay que pegarle al artículo.
ok(/toast\('✅ Producto guardado' \+ \(!cod && codigo \? ' · ' \+ codigo : ''\)/.test(inv),
   'el aviso muestra el código que le tocó');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
