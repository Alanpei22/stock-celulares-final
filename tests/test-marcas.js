// 🔤 Marcas unificadas y 🔀 panel para publicar/sacar equipos. Alan (23/11):
// "me hacés algo para los equipos en venta, con respecto a publicarlos o
// sacarlos de la página. Y también: iPhone está escrito de varias maneras y
// las toma como diferentes marcas".
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

(async () => {
  console.log('\n1) Una sola forma por marca');
  const utils = leer('utils.js');
  const u = { console, String, RegExp };
  vm.createContext(u);
  vm.runInContext(utils.slice(utils.indexOf('const MARCAS_CANON'), utils.indexOf('// Escapa los 5 caracteres')), u);
  const C = u.marcaCanon;
  ok(['iPhone', 'iphone', 'Iphone', 'IPHONE', ' I phone ', 'Apple', 'APPLE', 'iphon'].every(m => C(m) === 'iPhone'), 'iPhone, iphone, Iphone, IPHONE, Apple… → iPhone', ['iphone', 'Apple', 'IPHONE'].map(C));
  ok(['samsung', 'SAMSUNG', 'Samsumg', 'Galaxy'].every(m => C(m) === 'Samsung') && C('moto') === 'Motorola' && C('Redmi') === 'Xiaomi' && C('lg') === 'LG', 'lo mismo con Samsung, Motorola, Xiaomi, LG');
  ok(C('blu') === 'Blu' && C('BLU') === 'BLU' && C('') === '' && C(null) === '', 'una marca que no está en la lista: solo la primera letra en mayúscula');

  const api = await import('data:text/javascript;base64,' + Buffer.from(leer('api/equipos.js').replace("import admin from 'firebase-admin';", 'const admin = {};')).toString('base64'));
  const prueba = ['iphone', 'APPLE', 'Samsumg', 'moto', 'Redmi', 'blu', 'BLU', 'Huawey', 'pixel', 'Nokia', ''];
  ok(prueba.every(m => api.marcaCanon(m) === C(m)), 'la página pública (api/equipos.js) usa exactamente la misma regla', prueba.map(m => [m, api.marcaCanon(m), C(m)]));
  ok(api.equipoPublico({ id: 'x', publicar: true, marca: 'Iphone', modelo: '13', precio: 500000 }).marca === 'iPhone', 'en /equipos los chips de marca ya no se repiten');

  console.log('\n2) Dónde se usa');
  const app = leer('app.js');
  ok(/fMarca && _mc\(p\.marca\) !== fMarca/.test(app) && /new Set\(STOCK\.map\(p => _mc\(p\.marca\)\)/.test(app), 'el filtro de marcas del stock junta las variantes');
  ok(/const marca\s+= _mc\(document\.getElementById\('fi-marca'\)/.test(app), 'al guardar un equipo se guarda la forma única');
  ok(/marcaCanon\(document\.getElementById\('rep-fi-marca'\)/.test(leer('repairs.js')), 'y al guardar una reparación');
  ok(/marca: \(typeof marcaCanon === 'function'\) \? marcaCanon\(p\.marca\)/.test(leer('estado-equipos.js')), 'lista de precios y estados de WhatsApp también');
  ok(/'iphone'/.test(leer('lista-precios.js').match(/const LP_MARCAS = \[[^\]]*\]/)[0]), 'en la lista de precios iPhone va primero');

  console.log('\n3) Unificar las marcas de los equipos ya cargados');
  const cat = leer('catalogo-stock.js');
  const TOASTS = [], LOTES = [];
  const STOCK = [
    { id: 'a', marca: 'Iphone', modelo: '13', publicar: true, fotos: ['f'], precio: 500000, estado: 'Usado', bateria: 88 },
    { id: 'b', marca: 'IPHONE', modelo: '11', publicar: false, fotos: [], precio: 0, estado: 'Usado' },
    { id: 'c', marca: 'iPhone', modelo: '12', publicar: false, fotos: ['f'], precio: 450000, estado: 'Nuevo' },
    { id: 'd', marca: 'Apple', modelo: 'iPhone 14', vendido: true, publicar: true, fotos: ['f'] },
    { id: 'e', marca: 'samsung', modelo: 'A54', publicar: false, fotos: ['f'], precio: 380000, estado: 'Usado', bateria: 90 },
  ];
  const els = {};
  const elem = id => (els[id] = els[id] || { id, innerHTML: '', textContent: '', classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {} });
  const ctx = {
    console, String, Number, Array, Object, JSON, Math, Promise, STOCK,
    marcaCanon: C, esc: s => String(s == null ? '' : s),
    toast: (m, t) => TOASTS.push([m, t]), confirm: () => true,
    document: { getElementById: id => (id === 'cp-css' ? {} : (id.startsWith('cp-') ? elem(id) : (els[id] || null))), createElement: () => elem('cp-modal'), body: { appendChild() {} }, head: { appendChild() {} } },
    db: {
      collection: c => ({ doc: id => ({ update: d => { LOTES.push(['uno', c, id, d]); return Promise.resolve(); } }) }),
      batch: () => { const ops = []; return { update: (ref, d) => ops.push(d), commit: () => { LOTES.push(['lote', ops.length, ops]); return Promise.resolve(); } }; },
    },
  };
  ctx.db.collection = c => ({ doc: id => ({ id, update: d => { LOTES.push(['uno', c, id, d]); return Promise.resolve(); } }) });
  vm.createContext(ctx);
  vm.runInContext(cat, ctx, { filename: 'catalogo-stock.js' });
  const cam = ctx.stockMarcasACorregir(STOCK);
  ok(cam.length === 4 && cam.every(c => c.de !== c.a) && !cam.some(c => c.de === 'iPhone'), 'encuentra las mal escritas (Iphone, IPHONE, Apple, samsung) y no toca las bien escritas', cam.map(c => c.de + '→' + c.a));
  await ctx.stockUnificarMarcas();
  ok(LOTES.length === 1 && LOTES[0][1] === 4 && LOTES[0][2].every(d => Object.keys(d).join() === 'marca'), 'las corrige en una tanda, cambiando solo la marca', LOTES);
  ok(STOCK.filter(p => p.id !== 'e').every(p => p.marca === 'iPhone') && STOCK[4].marca === 'Samsung', 'y quedan todas bien');
  await ctx.stockUnificarMarcas();
  ok(/ya están todas bien/.test(TOASTS[TOASTS.length - 1][0]), 'la segunda vez avisa que no hay nada para corregir');

  console.log('\n4) Panel para publicar o sacar equipos');
  LOTES.length = 0;
  ok(ctx.catPanelEquipos(STOCK).map(p => p.id).join() === 'a,b,c,e', 'muestra los que están a la venta (no los vendidos)');
  ok(ctx.catFaltaDe(STOCK[1]).join() === 'fotos,precio,batería' && ctx.catFaltaDe(STOCK[0]).length === 0, 'dice qué le falta a cada uno (fotos, precio, batería)');
  ctx.catPanelAbrir();
  ctx.catPanelPintar();
  const h = els['cp-lista'] ? els['cp-lista'].innerHTML : '';
  ok((h.match(/class="cp-sw"/g) || []).length === 4 && /catPanelSwitch\('a', this\.checked/.test(h), 'un interruptor por equipo', h.slice(0, 200));
  ok(/Falta: fotos, precio, batería/.test(h) && /Ficha completa/.test(h), 'con lo que le falta a cada ficha');
  ok(/1 en la página · 3 sin publicar/.test(els['cp-resumen'].textContent), 'el resumen arriba', els['cp-resumen'].textContent);
  await ctx.catPanelSwitch('e', true);
  ok(LOTES[0] && LOTES[0][1] === 'stock' && LOTES[0][2] === 'e' && LOTES[0][3].publicar === true && STOCK[4].publicar === true, 'tocar el interruptor publica ese equipo', LOTES[0]);
  await ctx.catPanelSwitch('a', false);
  ok(LOTES[1][3].publicar === false && /salió de la página/.test(TOASTS[TOASTS.length - 1][0]), 'y otra vez lo saca');
  ok(/Publicar el que ya tiene fotos|Publicar los 2 que ya tienen fotos/.test(els['cp-pie'].innerHTML), 'ofrece publicar de una los que ya tienen fotos', els['cp-pie'].innerHTML);
  LOTES.length = 0;
  await ctx.catPanelPublicarListos();
  ok(LOTES.length === 1 && LOTES[0][0] === 'lote' && STOCK.filter(p => !p.vendido && p.fotos.length).every(p => p.publicar), 'publica todos los que tienen fotos en una tanda');
  ctx.tpFrenar = () => true;
  LOTES.length = 0;
  await ctx.catPanelSwitch('b', true);
  ok(!LOTES.length, 'sin permiso de stock no se puede');

  console.log('\n5) En el menú');
  ok(/label: 'Publicar o sacar equipos'[\s\S]{0,200}catPanelAbrir\(\)/.test(app), 'Stock → Página de equipos → "Publicar o sacar equipos"');
  ok(/label: 'Unificar marcas'[\s\S]{0,200}stockUnificarMarcas\(\)/.test(app), 'Stock → Datos → "Unificar marcas"');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})();
