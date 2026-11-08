// 📋 Lista de precios para los estados: una imagen con todo el stock, un
// renglón por equipo ("iPhone 13 | 128GB | 100% | 360 USD"). Alan mandó la
// historia de otro local y pidió "armar algo así con los equipos que tenemos".
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ctx = { console, Math, Number, String, Array, Object, JSON, Map, Promise, document: { getElementById: () => null } };
vm.createContext(ctx);
vm.runInContext(leer('estado-equipos.js'), ctx, { filename: 'estado-equipos.js' });
vm.runInContext(leer('lista-precios.js'), ctx, { filename: 'lista-precios.js' });
const run = c => vm.runInContext(c, ctx);

const A = (modelo, cap, bat, usd, extra) => Object.assign({ marca: 'Apple', modelo, almacenamiento: cap, bateria: bat, estado: 'Usado', moneda: 'usd', precioUSD: usd }, extra || {});
ctx._s = [
  A('iPhone 15 Pro', '256GB', 100, 670), A('iPhone 13', '128GB', 100, 360), A('iPhone 13 Pro', '128GB', 100, 480),
  A('iPhone 13', '256GB', 100, 390), A('iPhone 14', '128GB', 100, 395), A('iPhone 15 Pro', '128GB', 89, 590),
  A('iPhone 13', '128GB', 100, 360),                                       // igual a otro: va una vez
  { marca: 'Samsung', modelo: 'Galaxy S23', almacenamiento: '256GB', estado: 'Usado', precio: 650000 },
  { marca: 'Samsung', modelo: 'Galaxy A16', almacenamiento: '128GB', estado: 'Nuevo', precio: 280000, publicar: true },
  A('iPhone 17 Pro Max', '256GB', null, 1640, { estado: 'Nuevo' }),
  A('iPhone 12', '64GB', 80, 250, { vendido: true }),
  A('iPhone 11', '64GB', 80, 200, { reservado: true }),
];

console.log('\n1) Qué equipos van');
const L = run('lpEquipos(_s, {})');
ok(L.length === 9, 'todo lo que está en stock (sin vendidos ni reservados), los iguales una vez', L.length);
ok(run('lpEquipos(_s, { soloPublicados: true })').length === 1, '"Los de la página": solo los publicados');

console.log('\n2) Los renglones');
ctx._L = L;
const a = run('lpArmar(_L, true)');
const txt = a.usados.map(u => u.txt);
ok(txt[0] === 'iPhone 13 | 128GB | 100% | 360 USD', 'como el ejemplo: modelo | capacidad | batería | precio', txt[0]);
ok(txt.indexOf('iPhone 13 | 256GB | 100% | 390 USD') === 1 && txt.indexOf('iPhone 13 Pro | 128GB | 100% | 480 USD') === 2, 'ordenados: modelo, después capacidad', txt);
ok(txt.indexOf('iPhone 15 Pro | 128GB | 89% | 590 USD') < txt.indexOf('iPhone 15 Pro | 256GB | 100% | 670 USD'), 'el mismo modelo, de menor a mayor capacidad');
ok(txt[txt.length - 1] === 'Samsung Galaxy S23 | 256GB | $650.000', 'Apple primero; las otras marcas con su nombre y el precio en pesos', txt[txt.length - 1]);
ok(a.usados[3].hueco === true && a.usados[1].hueco === false && a.usados[2].hueco === false, 'un hueco entre generaciones de iPhone (13 / 14 / 15), como el ejemplo', a.usados.map(u => u.hueco));
ok(a.nuevos.length === 2 && a.nuevos[0] === 'iPhone 17 Pro Max | 256GB | 1.640 USD' && a.nuevos[1] === 'Samsung Galaxy A16 | 128GB | $280.000', 'los nuevos aparte ("¡Nuevos en caja!"), sin batería', a.nuevos);
ok(run('lpArmar(_L, false)').usados[0].txt === 'iPhone 13 | 128GB | 100%', 'sin precio: el renglón no lo lleva');
ok(run(`lpRenglon(eeDesdeStock({ marca: 'Xiaomi', modelo: 'Redmi 13', almacenamiento: '128GB', estado: 'Usado', precio: 50 }), true)`) === 'Xiaomi Redmi 13 | 128GB | Consultar', 'precio que no puede ser: "Consultar"');
ok(run('lpTitulo(_L)') === 'STOCK CELULARES' && run('lpTitulo(_L.filter(e => e.marca === "Apple"))') === 'STOCK IPHONES', 'el título: "STOCK IPHONES" si son todos iPhone');

console.log('\n3) Varias imágenes si no entra');
const una = run('lpPaginas(lpArmar(_L, true))');
ok(una.length === 1 && una[0].usados.length === 7 && una[0].nuevos.length === 2, 'lo de siempre entra en una sola', una.length);
ctx._mucho = Array.from({ length: 40 }, (_, i) => ({ marca: 'Xiaomi', modelo: 'Redmi Note ' + (10 + i), almacenamiento: '128GB', estado: 'Usado', bateria: 90, precio: 200000 + i * 1000 }))
  .concat([{ marca: 'Motorola', modelo: 'G24', estado: 'Nuevo', precio: 190000 }]);
const pg = run('lpPaginas(lpArmar(lpEquipos(_mucho, {}), true))');
ok(pg.length === 2, '40 equipos: dos imágenes', pg.length);
// Parejo en lugar ocupado: la que lleva el recuadro de los nuevos, menos renglones
const lugar = p => p.usados.length + (p.nuevos.length ? p.nuevos.length * 1.6 + 3.5 : 0);
ok(Math.abs(lugar(pg[0]) - lugar(pg[1])) <= 2, 'repartidos parejo (no una llena y otra con un renglón)', pg.map(lugar));
ok(pg[1].nuevos.length === 1 && !pg[0].nuevos.length, 'los nuevos en la última');
ok(pg.every(p => !p.usados.length || p.usados[0].hueco === false), 'ninguna arranca con un hueco');
ok(pg.reduce((t, p) => t + p.usados.length, 0) === 40, 'no se pierde ninguno');

console.log('\n4) Enganchado');
const app = leer('app.js'), html = leer('index.html'), src = leer('lista-precios.js');
ok(/lpAbrir\(\)/.test(app) && /'Lista de precios'/.test(app), 'menú del stock → Página de equipos → Lista de precios');
ok(html.indexOf('estado-equipos.js') < html.indexOf('lista-precios.js'), 'cargado después de estado-equipos.js (usa sus herramientas)');
ok(/¿Va con el precio\?/.test(src) && /b\.disabled = !n \|\| _lpPrecio === null/.test(src), 'pregunta si va con precio (como los otros estados)');
ok(/estado-\$\{String\(i \+ 1\)\.padStart\(2, '0'\)\}-lista-de-precios\.jpg/.test(src), 'el archivo se llama "estado-NN-…": la carpeta de la compu borra la lista vieja');
ok(/_eeListo\(archivos\)/.test(src) && /_eeListoPc\(archivos\)/.test(src), 'se manda igual que los otros estados (celu: compartir; compu: carpeta)');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
