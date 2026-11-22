// ✍️ Ayudas del ingreso (ingreso-ayudas.js). Alan (22/11): "si pongo 'sa' ya
// me aparezca para poner Samsung, al igual que los modelos" y "precios
// sugeridos ... que aparezcan repuestos, pero también pin de carga, batería
// y demás". Se prueba el autocompletar (qué sugiere y en qué orden) y de
// dónde sale cada precio (lista de precios > último cobrado).
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const repairs = leer('repairs.js');
const ayudas = leer('ingreso-ayudas.js');
const toasts = [];
const ctx = {
  console, String, Number, Array, Set, Map, Math, JSON, Date, Object, RegExp,
  esc: s => String(s == null ? '' : s),
  toast: (m, t) => toasts.push([m, t]),
};
vm.createContext(ctx);
// La regla de "es de este modelo" es la misma de los repuestos (repairs.js)
vm.runInContext(repairs.slice(repairs.indexOf('const _RM_VARIANTES'), repairs.indexOf('let _rmT = null;')), ctx, { filename: 'repairs.js' });
vm.runInContext(ayudas, ctx, { filename: 'ingreso-ayudas.js' });   // sin document: no engancha nada
vm.runInContext('var _repArreglos = []; function _renderArreglos(){} function _syncMontoDesdeArreglos(){} function _renderArreglosTotal(){}', ctx);

const FUENTES = [
  { marca: 'Samsung', modelo: 'A54' }, { marca: 'samsung', modelo: 'A54' }, { marca: 'Samsung ', modelo: 'Galaxy A55' },
  { marca: 'Samsung', modelo: 'A05s' }, { marca: 'Samsung', modelo: 'S23 Ultra' },
  { marca: 'iPhone', modelo: 'iPhone 13' }, { marca: 'Apple', modelo: '13' }, { marca: 'iPhone', modelo: 'iPhone 13' },
  { marca: 'iPhone', modelo: '11 Pro Max' },
  { marca: 'Motorola', modelo: 'Moto G54' }, { marca: 'Sansui', modelo: 'X1' },
];

console.log('\n1) Marcas: "sa" → Samsung');
const marcas = ctx.iaMarcas(FUENTES, ['Nubia']);
ok(ctx.iaFiltrar(marcas, 'sa')[0] === 'Samsung', '"sa" sugiere Samsung primero', ctx.iaFiltrar(marcas, 'sa'));
ok(marcas.filter(m => m.toLowerCase() === 'samsung').length === 1, '"samsung" y "Samsung " son una sola', marcas);
ok(marcas.includes('iPhone') && !marcas.includes('Apple'), 'Apple se junta con iPhone', marcas);
ok(marcas.includes('Nubia') && marcas.includes('Huawei'), 'aparecen las de siempre y las agregadas con ＋ aunque no se hayan usado');
ok(marcas.indexOf('Samsung') < marcas.indexOf('Huawei'), 'las más usadas, primero');
ok(ctx.iaFiltrar(marcas, 'mot')[0] === 'Motorola' && ctx.iaFiltrar(marcas, 'SAM')[0] === 'Samsung', 'no importan mayúsculas');
ok(ctx.iaFiltrar(marcas, 'Samsung').length === 0, 'si ya está escrita entera, no molesta');

console.log('\n2) Modelos de esa marca');
const sam = ctx.iaModelos(FUENTES, 'Samsung');
ok(sam[0] === 'A54' && !sam.includes('Moto G54') && !sam.includes('iPhone 13'), 'solo los de Samsung, el más usado primero', sam);
const a5 = ctx.iaFiltrar(sam, 'a5');
ok(a5.includes('A54') && a5.includes('Galaxy A55') && !a5.includes('S23 Ultra'), '"a5" trae A54 y Galaxy A55 (palabra que empieza así)', a5);
ok(ctx.iaFiltrar(sam, 'ultra')[0] === 'S23 Ultra', 'busca por cualquier palabra ("ultra" → S23 Ultra)');
const ip = ctx.iaModelos(FUENTES, 'Apple');
ok(ip.length === 2 && ip[0] === 'iPhone 13', '"iPhone 13" y "13" son el mismo modelo, con la forma más usada', ip);
ok(ctx.iaFiltrar(ip, '13')[0] === 'iPhone 13', 'escribiendo "13" aparece iPhone 13');
ok(ctx.iaModelos(FUENTES, '').length >= 8, 'sin marca escrita, sugiere de todas');

console.log('\n3) Precios: lista de precios > último cobrado');
const LISTA = [
  { tipo: 'Batería', equipo: 'Samsung A54', precio: 45000, updatedAt: { seconds: 100 } },
  { tipo: 'Batería', equipo: 'Samsung A54', precio: 48000, updatedAt: { seconds: 200 } },
  { tipo: 'Pantalla / Módulo', equipo: 'A5', precio: 60000 },
  { tipo: 'Pin de carga', equipo: 'Motorola A54', precio: 1 },
];
const REPS = [
  { marca: 'Samsung', modelo: 'A54', fechaIngreso: '2026-11-02', arreglos: [{ texto: 'Ficha de carga', precio: 25000 }, { texto: 'Batería', precio: 40000 }] },
  { marca: 'Samsung', modelo: 'A54', fechaIngreso: '2026-11-15', arreglos: [{ texto: 'Pin de carga', precio: 28000 }] },
  { marca: 'Samsung', modelo: 'A54', fechaIngreso: '2026-11-10', arreglo: 'Cambio de cámara trasera', monto: 35000 },
  { marca: 'Samsung', modelo: 'A5', fechaIngreso: '2026-11-20', arreglos: [{ texto: 'Módulo', precio: 99999 }] },
];
const REPU = [
  { marca: 'Samsung', modelo: 'A54', nombre: 'Batería A54', tipo: 'Batería', cantidad: 2 },
  { marca: 'Samsung', modelo: 'A54', nombre: 'Módulo A54 con marco', tipo: 'Módulo', cantidad: 0 },
];
const P = ctx.iaPreciosModelo('Samsung', 'A54', { lista: LISTA, reps: REPS, repuestos: REPU });
const de = k => P.find(f => f.clave === k) || {};
ok(P.slice(0, 3).map(f => f.clave).join() === 'modulo,bateria,pin', 'módulo, batería y pin de carga siempre, primero', P.map(f => f.clave));
ok(de('bateria').precio === 48000 && de('bateria').origen === 'lista', 'batería: el de la lista (el más nuevo), aunque se haya cobrado otro', de('bateria'));
ok(de('pin').precio === 28000 && de('pin').origen === 'ultimo' && de('pin').fecha === '2026-11-15', 'pin: sin lista, el ÚLTIMO cobrado (no el promedio)', de('pin'));
ok(de('camara').precio === 35000, 'reparaciones viejas (arreglo + monto) también cuentan: cámara', de('camara'));
ok(de('modulo').precio === 0 && de('modulo').origen === null, 'módulo: el del "A5" no se usa para el A54 (ni de la lista ni cobrado)', de('modulo'));
ok(de('bateria').repuesto === 'hay' && de('modulo').repuesto === 'pedir' && de('pin').repuesto === null, 'dice si hay el repuesto o hay que pedirlo');
ok(!P.some(f => f.precio === 1), 'el precio de un "Motorola A54" no entra en el Samsung A54');
ok(ctx.iaPreciosModelo('Samsung', '', { lista: LISTA }).length === 0, 'sin modelo, nada');
ok(ctx.iaTipoDe('Módulo A54 con marco') === 'modulo' && ctx.iaTipoDe('Ficha de carga') === 'pin' && ctx.iaTipoDe('cambio de pila') === 'bateria', 'entiende cómo se escribe cada arreglo');

console.log('\n4) Tocar un precio lo suma a la orden');
ctx.iaSumarArreglo('bateria', 48000);
ok(ctx._repArreglos.length === 1 && ctx._repArreglos[0].texto === 'Batería' && ctx._repArreglos[0].precio === 48000, 'se suma "Batería" con $48.000', ctx._repArreglos);
ctx.iaSumarArreglo('bateria', 48000);
ok(ctx._repArreglos.length === 1 && /ya está/.test(toasts[toasts.length - 1][0]), 'dos veces la misma, no');

console.log('\n5) Enganchado y cuidando el cupo');
ok(/<script defer src="ingreso-ayudas.js"><\/script>/.test(leer('index.html')), 'index.html carga ingreso-ayudas.js');
ok(/\['rep-fi-marca', 'rep-fi-modelo'\], \['fi-marca', 'fi-modelo'\]/.test(ayudas), 'en el ingreso de reparación y en el alta de stock');
ok(/iaPreciosHtml\(marca, modelo\)/.test(repairs), 'el recuadro del modelo muestra los precios');
ok(/function openRepairForm\(id\) \{[\s\S]{0,1200}iaCargarPrecios\(\)/.test(repairs), 'al abrir el ingreso se busca la lista de precios');
ok(/IA_PRECIOS_TTL[\s\S]{0,900}\.get\(\)/.test(ayudas) && !/onSnapshot/.test(ayudas), 'la lista se lee una vez (get con caché de 6 h), sin listener');
ok(/preciosCacheTs/.test(leer('precios.js')), 'la caja marca la hora del caché, así el index no la vuelve a leer');
ok(!/[\u0300-\u036f]/.test(ayudas), 'los acentos van como \\u0300 (no literales)');

console.log('\n6) 🧠 Memoria de precios: "los que pasamos ya" y los futuros');
ok(ctx.iaClaveModelo('Samsung', 'Galaxy A54 5G') === 'samsung_a54' && ctx.iaClaveModelo('samsung', 'A54') === 'samsung_a54', '"Galaxy A54 5G" y "A54" son el mismo modelo', ctx.iaClaveModelo('Samsung', 'Galaxy A54 5G'));
ok(ctx.iaClaveModelo('Apple', 'iPhone 13') === ctx.iaClaveModelo('iPhone', '13') && ctx.iaClaveModelo('iPhone', '13') !== ctx.iaClaveModelo('iPhone', '13 Pro'), 'iPhone 13 = Apple 13, pero no 13 Pro');
ok(ctx.iaClaveModelo('Samsung', '') === '', 'sin modelo, no hay clave');
const HIST = [
  { marca: 'Samsung', modelo: 'A54', fechaIngreso: '2026-03-01T10:00', arreglos: [{ texto: 'Batería', precio: 30000 }, { texto: 'Revisión', precio: 5000 }] },
  { marca: 'Samsung', modelo: 'Galaxy A54', fechaIngreso: '2026-09-01T10:00', arreglos: [{ texto: 'Cambio de batería', precio: 42000 }] },
  { marca: 'Samsung', modelo: 'A54', fechaIngreso: '2026-06-01T10:00', arreglo: 'Ficha de carga', monto: 22000 },
  { marca: 'Motorola', modelo: 'G54', fechaIngreso: '2026-08-01', arreglos: [{ texto: 'Módulo', precio: 0 }] },
];
const apr = ctx.iaAprenderDeReparaciones(HIST);
const a54 = apr.get('samsung_a54');
ok(apr.size === 1 && a54, 'un doc por modelo (el Moto sin precio no se guarda)', [...apr.keys()]);
ok(a54.tipos.bateria.precio === 42000 && a54.tipos.bateria.fecha === '2026-09-01', 'batería: se queda con la MÁS NUEVA ($42.000 de septiembre, no la de marzo)', a54.tipos.bateria);
ok(a54.tipos.pin.precio === 22000, 'las viejas con arreglo + monto también se aprenden');
ok(!a54.tipos.revision && Object.keys(a54.tipos).length === 2, 'lo que no es un arreglo conocido ("Revisión") no se guarda', Object.keys(a54.tipos));
const MEM = { bateria: { precio: 52000, fecha: '2026-11-18' }, flex: { precio: 15000, fecha: '2026-05-01' }, pin: { precio: 20000, fecha: '2026-10-01' } };
const PM = ctx.iaPreciosModelo('Samsung', 'A54', { lista: [], reps: REPS, repuestos: [], memoria: MEM });
const pm = k => PM.find(f => f.clave === k) || {};
ok(pm('bateria').precio === 52000 && pm('bateria').origen === 'ultimo', 'la memoria (18/11) le gana a lo cobrado antes (02/11)', pm('bateria'));
ok(pm('pin').precio === 28000, 'y si en el celu hay algo más nuevo que la memoria, gana eso', pm('pin'));
ok(pm('flex').precio === 15000, 'arreglos que solo están en la memoria también aparecen');
ok(ctx.iaPreciosModelo('Samsung', 'A54', { lista: LISTA, memoria: MEM }).find(f => f.clave === 'bateria').precio === 48000, 'la lista de precios sigue mandando sobre la memoria');

// Guardar: con un Firebase de mentira
const escritos = [];
ctx.db = { collection: c => ({ doc: id => ({ set: (data, op) => { escritos.push({ c, id, data, op }); return Promise.resolve(); } }) }) };
ctx.localStorage = { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };
const hoy = new Date().toISOString();
ctx.iaMemorizar({ marca: 'Samsung', modelo: 'A54', fechaIngreso: hoy, arreglos: [{ texto: 'Pin de carga', precio: 30000 }] });
ok(escritos.length === 1 && escritos[0].c === 'precios_memoria' && escritos[0].id === 'samsung_a54' && escritos[0].op.merge === true, 'al guardar una reparación, se anota en precios_memoria (sin pisar los otros arreglos)', escritos);
ok(escritos[0].data.tipos.pin.precio === 30000, 'con el precio que se pasó');
ok(ctx.iaMemoria('Samsung', 'Galaxy A54').pin.precio === 30000, 'y se ve enseguida, sin volver a leer');
ctx.iaMemorizar({ marca: 'Samsung', modelo: 'A54', fechaIngreso: '2025-01-10T10:00', arreglos: [{ texto: 'Pin de carga', precio: 9000 }] });
ok(escritos.length === 1, 'editar una reparación vieja no pisa el precio de hoy');

console.log('\n7) Enganches de la memoria');
ok((repairs.match(/iaMemorizar\((updateData|newDoc)\)/g) || []).length === 2, 'saveRepair memoriza al crear y al editar');
ok(/function _addArreglo[\s\S]{0,600}iaPrecioSugerido\(t\)/.test(repairs), 'elegir un arreglo en el paso 2 trae el precio sugerido');
ok(/tpEsDueno\(\)/.test(ayudas) && /_estado/.test(ayudas), 'el botón de "sacar los precios" es del dueño y se hace una sola vez');
ok(/i \+= 400/.test(ayudas) && /IA_APRENDER_MESES = 12/.test(ayudas), 'se escribe en tandas de 400, últimos 12 meses');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
