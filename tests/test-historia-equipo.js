// ✨ Historia de WhatsApp de un equipo, estilo casa de celulares. Alan
// (20/11): "que agarre las fotos de los equipos de venta y automáticamente
// se conviertan en el cartel". La IA ubica los teléfonos en las fotos y la
// app los recorta, tapa el IMEI y arma la historia.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ctx = { console, Math, Number, String, Array, Object, JSON, Set, Float32Array };
vm.createContext(ctx);
vm.runInContext(leer('historia-equipo.js'), ctx, { filename: 'historia-equipo.js' });
const run = c => vm.runInContext(c, ctx);
const J = v => JSON.stringify(v);

console.log('\n1) Los datos del equipo');
ctx.P = { id: 'a', marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '128gb', bateria: 76, color: 'Rojo', estado: 'Usado',
  moneda: 'usd', precioUSD: 380, fotos: ['https://x/1.jpg', 'no-es-link'], incluye: ['Cargador', 'Funda'] };
const d = run('heDatos(P)');
ok(d.modelo === 'iPhone 13' && d.capacidad === '128 GB' && d.bateria === 76, 'modelo, capacidad y batería', d);
ok(d.precio === 'U$S 380.-', 'el precio como se escribe en el local: "U$S 380.-"', d.precio);
ok(!/rojo/i.test(J(d)) && !('color' in d), 'el color no va (Alan no lo quiere en el cartel)');
ok(d.fotos.length === 1 && d.incluye.length === 2, 'solo las fotos que son links; lo que incluye, guardado en el equipo');
ok(run(`heDatos({ marca: 'Motorola', modelo: 'Edge 40', precio: 450000 })`).modelo === 'Motorola Edge 40', 'un Motorola lleva la marca adelante; un iPhone no');
ok(run(`heDatos({ marca: 'Motorola', modelo: 'Edge 40', precio: 450000 })`).precio === '$ 450.000.-', 'en pesos: "$ 450.000.-"');
ok(run(`heDatos({ modelo: 'A15', precio: 0 })`).precio === '', 'sin precio: queda vacío (el lugar libre para el widget de WhatsApp)');
ok(run(`heDatos({ modelo: 'A15', precio: 300000, ocultarPrecio: true })`).precio === '', 'con "ocultar precio": tampoco');
ok(run(`heDatos({ modelo: 'A15', bateria: 100, estado: 'Nuevo' })`).bateria === 0, 'en un nuevo no va la batería');

console.log('\n2) Los íconos de "Incluye"');
ok(['Cargador', 'Cable', 'Funda', 'Templado', 'Caja', 'Auriculares', 'Vidrio', 'Stickers'].map(t => run(`heIcono(${J(t)})`)).join() === 'cargador,cable,funda,templado,caja,auriculares,templado,otro', 'cada cosa con su dibujo (y uno genérico)');

console.log('\n3) El recorte');
// Un teléfono de 400×800 girado 10° con centro en (500, 600)
const g = 10 * Math.PI / 180;
const real = [[-200, -400], [200, -400], [200, 400], [-200, 400]].map(([a, b]) => [500 + a * Math.cos(g) - b * Math.sin(g), 600 + a * Math.sin(g) + b * Math.cos(g)]);
ctx.REAL = real;
const m = run('heMedidas(REAL)');
ok(Math.abs(m.ancho - 400) < 0.5 && Math.abs(m.alto - 800) < 0.5 && Math.abs(m.giro - g) < 1e-6 && Math.abs(m.cx - 500) < 1e-6, 'mide ancho, alto, centro y giro', m);
// La foto "cambia" solo en el borde verdadero del teléfono
ctx.grad = (x, y) => {
  const dx = x - 500, dy = y - 600;
  const u = dx * Math.cos(-g) - dy * Math.sin(-g), v = dx * Math.sin(-g) + dy * Math.cos(-g);
  const borde = Math.min(Math.abs(Math.abs(u) - 200), Math.abs(Math.abs(v) - 400));
  return borde < 1.5 ? 100 : 0;
};
// La IA se equivoca unos píxeles: corrida para afuera y para adentro
ctx.MAL = real.map(([x, y], i) => [x + [-9, 8, 10, -7][i], y + [-8, -9, 7, 10][i]]);
const aj = run('heAjustarBordes(MAL, grad, 20)');
const err = (q) => Math.max(...q.map((p, i) => Math.hypot(p[0] - real[i][0], p[1] - real[i][1])));
ok(err(aj) < err(ctx.MAL) / 2 && err(aj) < 6, `corrige el borde que marcó la IA (${err(ctx.MAL).toFixed(1)}px → ${err(aj).toFixed(1)}px)`);
ctx.grad0 = () => 0;
ok(err(run('heAjustarBordes(REAL, grad0, 20)')) < 0.01, 'si la foto no muestra un borde claro, deja lo que dijo la IA');
const ach = run('heAchicar(REAL, 4)');
ok(run('heMedidas(heAchicar(REAL, 4))').ancho < 400 && run('heMedidas(heAchicar(REAL, 4))').ancho > 390, 'achica un pelito el recorte (saca el hilito de color del borde)', ach[0]);
ok(J(run('heEsquinasPx([[500, 250], [1000, 1000]], 800, 1200)')) === J([[400, 300], [800, 1200]]), 'las milésimas de la IA → píxeles de la foto');

console.log('\n4) Que nada se pise');
const lay = (dd, alto) => run(`heLayout(${J(dd)}, ${alto})`);
const todo = lay({ capacidad: '128 GB', bateria: 76, incluye: ['Cargador', 'Funda', 'Templado'], precio: 'U$S 380.-' }, 2 * 130);
const tramos = [
  ['modelo', todo.modeloTop, todo.modeloBase], ['capacidad', todo.capacidad.top, todo.capacidad.top + todo.capacidad.alto],
  ['equipos', todo.equipos.top, todo.equipos.bottom], ['bateria', todo.bateria.top, todo.bateria.top + todo.bateria.alto],
  ['incluye', todo.incluye.titulo - 34, todo.incluye.top + todo.incluye.alto], ['precio', todo.precio.top, todo.precio.top + todo.precio.alto],
  ['pie', todo.pie - 26, todo.pie + 6],
];
const pisa = tramos.slice(1).filter((t, i) => t[1] < tramos[i][2]).map(t => t[0]);
ok(!pisa.length && todo.pie < 1920 && todo.marca > 100, 'de arriba para abajo, cada cosa debajo de la anterior y adentro de la imagen', pisa);
ok(todo.equipos.bottom - todo.equipos.top > 500, `aun con todo y el modelo en dos renglones, los teléfonos tienen lugar (${todo.equipos.bottom - todo.equipos.top}px)`);
const poco = lay({ capacidad: '', bateria: 0, incluye: [], precio: '' }, 100);
ok(!poco.bateria && !poco.incluye && !poco.capacidad && poco.precio.top > 1600, 'lo que está vacío no ocupa lugar (salvo el precio, que queda libre)');
ok(poco.equipos.bottom - poco.equipos.top > todo.equipos.bottom - todo.equipos.top, 'y los teléfonos aprovechan ese lugar');

console.log('\n5) La respuesta de la IA (api/ai.js)');
const api = leer('api/ai.js');
const src = api.slice(api.indexOf('export function parsearUbicacion'), api.indexOf('export function parsearEtiqueta')).replace(/^export function/gm, 'function');
vm.runInContext(src, ctx);
const resp = o => run(`parsearUbicacion(${J(J(o))}, 2)`);
const bueno = { frente: { foto: 0, esquinas: [[300, 200], [700, 220], [690, 820], [290, 800]] }, espalda: null, fondo: 1, sensibles: [{ foto: 0, caja: [400, 300, 650, 340] }] };
const u = resp(bueno);
ok(u && u.frente.foto === 0 && u.espalda === null && u.fondo === 1 && u.sensibles.length === 1, 'una respuesta buena pasa', u);
ok(resp({ ...bueno, frente: { foto: 5, esquinas: bueno.frente.esquinas } }) === null, 'una foto que no existe, no');
ok(resp({ ...bueno, frente: { foto: 0, esquinas: [[10, 10], [12, 10], [12, 12], [10, 12]] } }) === null, 'un "teléfono" de 2 píxeles, no');
ok(resp({ ...bueno, frente: { foto: 0, esquinas: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]] } }) === null, 'la foto entera como teléfono, no');
ok(resp({ ...bueno, frente: { foto: 0, esquinas: [[1, 2], [3, 4]] } }) === null, 'sin las 4 esquinas, no');
ok(resp({ ...bueno, sensibles: [{ foto: 9, caja: [1, 1, 50, 50] }, { foto: 1, caja: [800, 900, 100, 50] }] }).sensibles[0].caja.join() === '100,50,800,900', 'las cajas del IMEI se ordenan y las de fotos que no existen se descartan');
ok(run(`parsearUbicacion('no hay nada', 1)`) === null && run(`parsearUbicacion('{"frente":null,"espalda":null}', 1)`) === null, 'sin ningún teléfono: null (sale con las fotos enteras)');

console.log('\n5b) Con la mano (Alan, 20/11: "queda más real")');
const he0 = leer('historia-equipo.js');
ok(/function heConMano\(cv, esquinas\)/.test(he0) && /const cortar = conMano \? heConMano : heRecortar/.test(he0), 'hay dos formas: con la mano (se desvanece hacia el fondo) o solo el teléfono');
ok(/getItem\('tp-historia-modo'\) === 'recorte' \? 'recorte' : 'mano'/.test(he0), 'por defecto, con la mano (y se acuerda lo que elegiste)');
ok(/out\._tel = \{ w: ancho, h: alto \}/.test(he0) && /const tel = c\._tel \|\|/.test(he0), 'con la mano se acomoda por el tamaño del TELÉFONO (la mano puede desbordar desvanecida)');
ok(he0.indexOf('heDibujarEquipos(x, piezas, L.equipos.top') < he0.indexOf("x.fillText('TECHPOINT'"), 'los teléfonos se dibujan antes que los textos (lo desvanecido no tapa nada escrito)');

console.log('\n5c) Mayúsculas y colores de TechPoint (Alan, 20/11)');
ok(/toLocaleUpperCase\('es-AR'\)/.test(he0) && /'SERVICIO TÉCNICO · VENTA'/.test(he0) && /'INCLUYE:'/.test(he0) && /'BATERÍA '/.test(he0), 'todo lo escrito en la historia va en mayúscula');
ok(/HE_AZUL = '#3b82f6'/.test(he0) && !/HE_ROJO|#e11d2a|#d42a2a/.test(he0), 'la línea y el precio en el azul del logo (ya no en rojo)');
ok(/const fichaC = /.test(he0), 'el cargador y el cable con su ficha USB-C dibujada');

console.log('\n6) Enganchado');
const he = leer('historia-equipo.js');
ok(/action === 'ubicarEquipos'/.test(api) && /corteSiNoAutorizadoEdge/.test(api), 'la IA está en /api/ai, que pide sesión');
ok(/IMEI, número de serie, EID/.test(api) && /ub\.sensibles\.forEach\(s => copias\[s\.foto\] && heTapar/.test(he), 'el IMEI y la serie se tapan antes de usar la foto');
ok(/tile\('✨', 'Historia', `heAbrir\('\$\{p\.id\}'\)`\)/.test(leer('app.js')), 'ficha del equipo → ✨ Historia');
ok(/estado-equipos\.js"><\/script>\s*<script defer src="historia-equipo\.js">/.test(leer('index.html')), 'index.html la carga después de estado-equipos.js (usa sus fotos y su "compartir")');
ok(!/apple-logo|/.test(he), 'no dibuja logos de marcas');
ok(/'saturation'/.test(he) && /Math\.min\(1, 640/.test(he), 'el fondo sin color (que una alfombrilla rosa no manche)');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
