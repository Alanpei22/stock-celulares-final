// 🔩 Repuestos del modelo en el ingreso de una reparación. Alan (22/11):
// "cuando entra un equipo, cuando ponemos el modelo, estaría bueno que nos
// diga qué repuestos hay". Se prueba la búsqueda (que traiga los de ESE
// modelo y no los parecidos) y que esté enganchada al formulario.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const src = leer('repairs.js');
const ctx = { console, String, Number, Array, Set, Math, JSON };
vm.createContext(ctx);
vm.runInContext(src.slice(src.indexOf('const _RM_VARIANTES'), src.indexOf('let _rmT = null;')), ctx, { filename: 'repairs.js' });
const R = (marca, modelo) => ctx.repuestosDelModelo(marca, modelo, LISTA).map(r => r.id);

const LISTA = [
  { id: 'a54mod', marca: 'Samsung', modelo: 'A54', nombre: 'Módulo A54 con marco', tipo: 'Módulo', cantidad: 2, precioVenta: 85000 },
  { id: 'a54bat', marca: 'Samsung', modelo: 'A54', nombre: 'Batería A54', tipo: 'Batería', cantidad: 0 },
  { id: 'a5mod',  marca: 'Samsung', modelo: 'A5',  nombre: 'Módulo A5', tipo: 'Módulo', cantidad: 4 },
  { id: 'a54pin', marca: 'Samsung', modelo: '',    nombre: 'Pin de carga A54 / A34', tipo: 'Pin de carga', cantidad: 1 },
  { id: 'i13mod', marca: 'iPhone',  modelo: 'iPhone 13', nombre: 'Módulo iPhone 13 OLED', tipo: 'Módulo', cantidad: 1 },
  { id: 'i13pro', marca: 'Apple',   modelo: 'iPhone 13 Pro', nombre: 'Módulo 13 Pro', tipo: 'Módulo', cantidad: 3 },
  { id: 'i13bat', marca: 'Apple',   modelo: '13', nombre: 'Batería iPhone 13', tipo: 'Batería', cantidad: 5 },
  { id: 'motoa54', marca: 'Motorola', modelo: 'A54', nombre: 'Tapa A54', tipo: 'Tapa', cantidad: 1 },
];

console.log('\n1) Trae los de ESE modelo');
ok(R('Samsung', 'A54').sort().join() === 'a54bat,a54mod,a54pin', 'Samsung A54: módulo, batería y el pin que dice "A54 / A34"', R('Samsung', 'A54'));
ok(!R('Samsung', 'A54').includes('a5mod'), '"A54" no trae el del "A5" (palabras enteras)');
ok(!R('Samsung', 'A5').includes('a54mod') && R('Samsung', 'A5').includes('a5mod'), 'y "A5" no trae los del "A54"');
ok(!R('Samsung', 'A54').includes('motoa54'), 'de otra marca, no (aunque se llame igual)');
ok(R('', 'A54').includes('motoa54'), 'sin marca escrita, trae de todas');

console.log('\n2) Variantes: "13" no es "13 Pro"');
ok(R('iPhone', 'iPhone 13').sort().join() === 'i13bat,i13mod', 'iPhone 13: el módulo y la batería, sin el del 13 Pro', R('iPhone', 'iPhone 13'));
ok(R('iPhone', '13 Pro').join() === 'i13pro', '"13 Pro" trae solo el del 13 Pro', R('iPhone', '13 Pro'));
ok(R('Apple', 'iPhone 13').length === 2, 'Apple y iPhone son la misma marca');

console.log('\n3) Orden y casos vacíos');
const a54 = ctx.repuestosDelModelo('Samsung', 'A54', LISTA);
ok((Number(a54[a54.length - 1].cantidad) || 0) === 0, 'los que hay en stock primero, los "sin stock" al final', a54.map(r => r.id));
ok(ctx.repuestosDelModelo('Samsung', '', LISTA).length === 0 && ctx.repuestosDelModelo('Samsung', 'A54', null).length === 0, 'sin modelo o sin lista: nada');
ok(ctx.repuestosDelModelo('samsung', 'a54', LISTA).length === 3, 'no importan mayúsculas');

console.log('\n4) Enganchado al ingreso');
ok(/id="rep-repu-modelo"/.test(leer('index.html')), 'el recuadro está debajo de marca y modelo');
ok(/addEventListener\('input', \(\) => _repuModeloProgramar\(\)\)/.test(src), 'se actualiza mientras se escribe');
ok(/function openRepairForm\(id\) \{[\s\S]{0,900}listenRepuestos\(\)/.test(src), 'al abrir el ingreso se cargan los repuestos (aunque no se haya entrado a Repuestos)');
ok(/_repuModeloPintar\(\)/.test(leer('repuestos.js')), 'cuando cambian los repuestos, el recuadro se actualiza');
ok(/sin stock · pedir/.test(src) && /rm-precio/.test(src), 'muestra el stock (o "sin stock · pedir") y el precio de venta');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
