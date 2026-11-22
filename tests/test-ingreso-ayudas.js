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

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
