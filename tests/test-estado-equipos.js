// 📲 Equipos para los estados de WhatsApp.
//
// Alan: "¿podemos publicar los celus de la página en los estados de
// WhatsApp?". WhatsApp no deja publicar estados desde afuera, así que la app
// arma una imagen por equipo y la manda al menú de compartir → "Mi estado".
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const TOASTS = [], DESCARGAS = [];
const NODOS = {};
const fakeEl = id => ({ id, onclick: null, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h || ''; },
  className: '', classList: { _on: {}, toggle(c, v) { this._on[c] = !!v; } }, remove() { delete NODOS[this.id]; }, click() { DESCARGAS.push(this.download); } });
const ctx = {
  console, Math, Number, Symbol, String, Array, Object, JSON, Map, Promise, setTimeout: f => f(), Error,
  toast: (m, t) => TOASTS.push(m),
  confirm: () => true,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  File: function (partes, nombre) { this.name = nombre; },
  navigator: {},
  document: {
    getElementById: id => NODOS[id] || null,
    createElement: () => fakeEl(null),
    querySelectorAll: () => [],
    head: { appendChild() {} },
    body: { appendChild(n) {
      if (n.download) return;   // el código le hace .click() después
      if (n.id) NODOS[n.id] = n;
      // los botones de adentro (id="...") se pueden buscar como en la página
      for (const m of (n.innerHTML || '').matchAll(/id="([\w-]+)"/g)) NODOS[m[1]] = fakeEl(m[1]);
    } },
  },
};
vm.createContext(ctx);
vm.runInContext(leer('estado-equipos.js'), ctx, { filename: 'estado-equipos.js' });
const run = c => vm.runInContext(c, ctx);

console.log('\n1) Cuáles van');
ctx._s = [
  { id: 'a', publicar: true, marca: 'Samsung', modelo: 'Galaxy A16', almacenamiento: '128gb', color: 'Negro', estado: 'Nuevo', precio: 280000, garantiaMeses: 12, fotos: ['https://x/1.jpg'] },
  { id: 'b', publicar: true, marca: 'Samsung', modelo: 'Galaxy A16', almacenamiento: '128gb', color: 'Azul', estado: 'Nuevo', precio: 280000, garantiaMeses: 12 },
  { id: 'c', publicar: true, marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '128GB', estado: 'Usado', moneda: 'usd', precioUSD: 390, bateria: 87, garantiaMeses: 3 },
  { id: 'd', publicar: true, vendido: true, marca: 'Moto', modelo: 'G24' },
  { id: 'e', publicar: true, reservado: true, marca: 'Moto', modelo: 'G34' },
  { id: 'f', marca: 'Xiaomi', modelo: 'Redmi 13' },
  { id: 'g', publicar: true, marca: 'Realme', modelo: 'C61', estado: 'Nuevo', precio: 67 },
];
const L = run('eeParaEstados(_s)');
ok(L.length === 3, 'solo los publicados, sin vender ni reservar (y los iguales juntos)', L.map(e => e.id));
ok(L[0].unidades === 2 && L[0].colores.join(',') === 'Negro,Azul' && L[0].fotos.length === 1, 'dos A16 iguales: un estado, con los dos colores y la foto que haya', L[0]);
ok(run('eeParaEstados([])').length === 0, 'sin publicados: nada');

console.log('\n2) Lo que dice la imagen');
ctx._e = L[0];
let t = run('eeTextos(_e)');
ok(t.nombre === 'Samsung Galaxy A16 128 GB' && t.condicion === 'Nuevo', 'el modelo, con la capacidad prolija', t);
ok(/Negro, Azul/.test(t.specs) && /Garantía 12 meses/.test(t.specs), 'colores y garantía', t.specs);
ok(/^\$ 280[.,]000$/.test(t.precio) && t.unidades === '2 disponibles', 'precio en pesos y cuántos hay', t);
ctx._e = L[1];
t = run('eeTextos(_e)');
ok(t.nombre === 'Apple iPhone 13 128 GB' && t.precio === 'U$S 390' && /🔋 87%/.test(t.specs) && t.condicion === 'Usado', 'usado en dólares con batería', t);
ctx._e = L[2];
ok(run('eeTextos(_e)').precio === 'Consultar precio', 'un precio que no puede ser ($67): "Consultar precio", igual que la página');
ctx._e = run(`eeDesdeStock({ marca: 'Apple', modelo: 'iPhone 12', precio: 500000, ocultarPrecio: true, estado: 'Reacondicionado' })`);
ok(run('eeTextos(_e)').precio === 'Consultar precio' && run('eeTextos(_e)').condicion === 'Reacondicionado', 'precio oculto y reacondicionado, como en la página');
ctx._e = run(`eeDesdeStock({ marca: 'Motorola', modelo: 'Motorola Edge 50' })`);
ok(run('eeTextos(_e)').nombre === 'Motorola Edge 50', 'la marca no sale dos veces');

console.log('\n2b) Todas las fotos del equipo');
// Alan (03/11): "que se puedan subir todas las imágenes que estén subidas del equipo"
ctx._m = [run(`eeDesdeStock({ id: 'm', marca: 'Apple', modelo: 'iPhone 13', fotos: ['https://a/1', 'https://a/2', 'https://a/3'] })`), L[1]];
const P = run('eePiezas(_m)');
ok(P.length === 4, 'un equipo con 3 fotos da 3 imágenes (y uno sin fotos, 1)', P.length);
ok(P[0].n === 0 && P[0].total === 3 && P[0].foto === 'https://a/1' && P[2].foto === 'https://a/3', 'la primera es la portada, las otras la galería, en orden');
ok(P[3].foto === null && P[3].total === 1, 'sin fotos: una sola, con el dibujito');
ok(run('eeCuantasImagenes(_m)') === 4, 'se cuentan imágenes, no equipos (WhatsApp sube hasta 30)');
ok(/-foto2\.jpg$/.test(run('_eeNombreArchivo(_p, 1)'.replace('_p', 'eePiezas(_m)[1]'))), 'el archivo dice qué foto es');

console.log('\n3) Mandarlas');
// El dibujo necesita un canvas de verdad: se reemplaza por uno de mentira.
const OPC = [];
ctx._OPC = OPC;
run(`eeDibujar = async (pz, op) => { _OPC.push(op); return { size: 1 }; }`);
ctx._waEsCompu = () => false;
ctx.navigator.canShare = () => true;
let COMPARTIDO = null;
ctx.navigator.share = async d => { COMPARTIDO = d; };
(async () => {
  ctx._l = L;
  await run('eeCompartir(_l)');
  ok(COMPARTIDO === null && NODOS['ee-compartir'], 'celu: ya armadas, pide un toque más (el de antes "venció" mientras se armaban)');
  await NODOS['ee-compartir'].onclick();
  ok(COMPARTIDO && COMPARTIDO.files.length === 3, 'y ese toque abre compartir con las 3 imágenes juntas', COMPARTIDO);
  ok(/estado-01-Samsung-Galaxy-A16-128-GB\.jpg/.test(COMPARTIDO.files[0].name), 'con nombres prolijos', COMPARTIDO.files[0].name);

  // Compu: WhatsApp de escritorio sube estados eligiendo fotos de una carpeta
  ctx._waEsCompu = () => true;
  ctx.window = {};
  DESCARGAS.length = 0;
  await run('eeCompartir(_l)');
  ok(DESCARGAS.length === 0 && /Novedades/.test(NODOS['ee-mod'].innerHTML) && /Ctrl\+A/.test(NODOS['ee-mod'].innerHTML),
     'compu: ya armadas, explica cómo subirlas desde WhatsApp de escritorio');
  ok(NODOS['ee-wa'] && typeof NODOS['ee-wa'].onclick === 'function', 'con un botón para abrir WhatsApp');
  await NODOS['ee-guardar'].onclick();
  ok(DESCARGAS.length === 3, 'un navegador sin carpetas: se descargan', DESCARGAS);

  // Con carpeta: se guardan juntas y se borran los estados viejos
  const CARPETA = { 'estado-01-Moto-G24.jpg': 1, 'estado-07-viejo.jpg': 1, 'factura.pdf': 1 };
  ctx.window.showDirectoryPicker = async () => ({
    name: 'Estados TechPoint',
    async *entries() { for (const k of Object.keys(CARPETA)) yield [k, { kind: 'file' }]; },
    async removeEntry(n) { delete CARPETA[n]; },
    async getFileHandle(n) { return { async createWritable() { return { async write() { CARPETA[n] = 2; }, async close() {} }; } }; },
  });
  DESCARGAS.length = 0;
  await run('eeCompartir(_l)');
  ok(/Guardar en la carpeta/.test(NODOS['ee-mod'].innerHTML), 'Chrome/Edge: ofrece guardarlas en una carpeta');
  await NODOS['ee-guardar'].onclick();
  const k = Object.keys(CARPETA).sort();
  ok(k.length === 4 && k.includes('factura.pdf') && !k.includes('estado-07-viejo.jpg') && !k.includes('estado-01-Moto-G24.jpg') && DESCARGAS.length === 0,
     'quedan las de hoy, sin las viejas (y sin tocar otros archivos)', k);
  ok(/Estados TechPoint/.test(TOASTS[TOASTS.length - 1]), 'y avisa dónde quedaron', TOASTS[TOASTS.length - 1]);

  OPC.length = 0;
  ctx._waEsCompu = () => false;
  await run('eeCompartir(_m, null, { precio: false })');
  ok(OPC.length === 4 && OPC.every(o => o && o.precio === false), '"sin precio" llega a cada imagen', OPC);

  console.log('\n3b) Con o sin precio: se pregunta cada vez');
  ctx.STOCK = [{ id: 'z', publicar: true, marca: 'Moto', modelo: 'G24', precio: 190000, fotos: ['https://a/1', 'https://a/2'] }];
  run('eeEstadoDe("z")');
  const h = NODOS['ee-mod'].innerHTML;
  ok(/¿Va con el precio\?/.test(h) && /Con precio/.test(h) && /Sin precio/.test(h), 'el cuadro pregunta si va con precio');
  ok(/Estado de este equipo/.test(h), 'el botón de la ficha abre el mismo cuadro, con ese equipo solo');
  ok(NODOS['ee-ir'].disabled === true && /Elegí arriba si va con precio/.test(NODOS['ee-ir'].textContent), 'sin elegir, no arma nada');
  run('eeConPrecio(false)');
  ok(NODOS['ee-p-no'].classList._on.on === true && NODOS['ee-p-si'].classList._on.on === false, 'se marca la opción elegida');
  ok(!/Elegí arriba/.test(NODOS['ee-ir'].textContent), 'elegida, ya se puede armar', NODOS['ee-ir'].textContent);
  run('eeAbrir()');
  ok(NODOS['ee-ir'].disabled === true, 'y la próxima vez vuelve a preguntar (no se queda con la anterior)');

  TOASTS.length = 0;
  await run('eeCompartir([])');
  ok(/No hay equipos/.test(TOASTS[0] || ''), 'sin equipos avisa');

  console.log('\n4) Las fotos (CORS)');
  const api = leer('api/equipos.js');
  const m = api.match(/export const FOTO_PERMITIDA = (\/.*\/);/);
  ok(!!m, 'la API sabe qué fotos puede traer');
  const re = eval(m[1]);
  ok(re.test('https://firebasestorage.googleapis.com/v0/b/stockcelustech.firebasestorage.app/o/stock%2Fabc%2F1.webp?alt=media&token=12ab-34cd'), 'trae las fotos de nuestro Storage');
  ok(!re.test('https://evil.com/x.jpg') && !re.test('https://firebasestorage.googleapis.com/v0/b/otro-bucket/o/x?alt=media'), 'y nada de otro lado (no es un proxy abierto)');
  ok(/if \(req\.query && req\.query\.foto\) return mandarFoto/.test(api) && /\/\^image\\\/\//.test(api), 'solo devuelve imágenes');
  const ee = leer('estado-equipos.js');
  ok(/apiFetch\('\/api\/equipos\?foto='/.test(ee), 'si Storage no deja, la app la pide por el servidor');

  console.log('\n5) Dónde está');
  const app = leer('app.js');
  ok(/eeAbrir\(\)/.test(app) && /'Estados de WhatsApp'/.test(app), 'menú del stock → Página de equipos → Estados de WhatsApp');
  ok(/tile\('📲', 'Estado', `eeEstadoDe\('\$\{p\.id\}'\)`\)/.test(app), 'y en la ficha de cada equipo, el botón 📲 Estado');
  ok(/<script defer src="estado-equipos\.js"><\/script>/.test(leer('index.html')), 'cargado en index.html');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
