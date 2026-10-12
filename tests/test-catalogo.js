// Página pública de equipos (/equipos) armada desde el stock del local.
//
// Lo que se cuida:
//  · que NADA privado del stock (costo, IMEI, notas, comprador) llegue a la
//    página: la ficha se arma por lista blanca;
//  · los estados: disponible / reservado / sin stock (vendido hace ≤30 días);
//    los vendidos viejos y los no publicados no aparecen;
//  · el orden, el precio (pesos, dólares, "Consultar precio") y el mensaje
//    de WhatsApp;
//  · que el formulario del stock guarde lo de la página y suba las fotos.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

(async () => {
console.log('\n1) La ficha pública sale del stock');
const src = leer('api/equipos.js').replace("import admin from 'firebase-admin';", 'const admin = {};');
const api = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const AHORA = Date.parse('2026-10-09T12:00:00Z');
const dias = n => new Date(AHORA - n * 864e5).toISOString();
const privado = { id: 'a', publicar: true, marca: 'iPhone', modelo: 'iPhone 13', estado: 'Usado', almacenamiento: '128GB',
  color: 'Azul', bateria: 89, garantiaMeses: 3, moneda: 'usd', precioUSD: 480, precio: 600000,
  detallesPublicos: 'Con caja', fotos: ['https://x/1.jpg', 'http://inseguro/2.jpg', 'javascript:alert(1)'], fecha: dias(2),
  costo: 300000, imei: '356938035643809', notas: 'le falta un tornillo', clienteNombre: 'Juan', clienteDni: '30111222',
  vendedor: 'Ana', forma_pago: 'Efectivo', reservaTelefono: '1155554444' };
const e = api.equipoPublico(privado, AHORA);
const json = JSON.stringify(e);
ok(!/300000|356938|tornillo|Juan|30111222|Ana|1155554444|Efectivo/.test(json), 'sin costo, IMEI, notas internas ni datos de clientes', json);
ok(Object.keys(e).sort().join() === 'bateria,capacidad,color,condicion,condicionTexto,detalles,estado,fecha,fotos,garantiaMeses,id,marca,modelo,moneda,precio',
   'solo los campos de la lista blanca', Object.keys(e));
ok(e.precio === 480 && e.moneda === 'usd', 'cargado en dólares se muestra en dólares');
ok(e.capacidad === '128 GB' && e.condicion === 'usado' && e.estado === 'disponible', 'capacidad legible, usado, disponible', e);
ok(e.fotos.length === 1 && e.fotos[0] === 'https://x/1.jpg', 'solo fotos https (nada de links raros)', e.fotos);
ok(api.equipoPublico({ ...privado, publicar: false }, AHORA) === null && api.equipoPublico({ ...privado, publicar: undefined }, AHORA) === null,
   'si no está marcado "Mostrar en la página", no sale');
ok(api.equipoPublico({ ...privado, reservado: true }, AHORA).estado === 'reservado', 'reservado');
ok(api.equipoPublico({ ...privado, vendido: true, fecha_venta: dias(3) }, AHORA).estado === 'sinstock', 'vendido en la caja → Sin stock');
ok(api.equipoPublico({ ...privado, vendido: true, fecha_venta: dias(31) }, AHORA) === null, 'vendido hace más de 30 días → ya no aparece');
ok(api.equipoPublico({ ...privado, vendido: true }, AHORA) === null, 'vendido sin fecha → no aparece');
ok(api.equipoPublico({ ...privado, ocultarPrecio: true }, AHORA).precio === 0, '"Consultar precio" no manda el precio');
let r = api.equipoPublico({ ...privado, moneda: 'ars', precio: 210000 }, AHORA);
ok(r.precio === 210000 && r.moneda === 'ars', 'en pesos');
r = api.equipoPublico({ ...privado, estado: 'Reacondicionado' }, AHORA);
ok(r.condicion === 'usado' && r.condicionTexto === 'Reacondicionado', 'reacondicionado: filtra como usado, se nombra como es');
ok(api.equipoPublico({ ...privado, estado: 'Nuevo' }, AHORA).condicion === 'nuevo', 'nuevo');
const orden = api.ordenarEquipos([
  { id: 'v', estado: 'sinstock', fecha: dias(0) }, { id: 'r', estado: 'reservado', fecha: dias(0) },
  { id: 'd1', estado: 'disponible', fecha: dias(5) }, { id: 'd2', estado: 'disponible', fecha: dias(1) }]).map(x => x.id).join();
ok(orden === 'd2,d1,r,v', 'disponibles, reservados, sin stock; y los más nuevos arriba', orden);

const fn = leer('api/equipos.js');
ok(/where\('publicar', '==', true\)/.test(fn), 'solo se leen los publicados');
ok(/s-maxage=60/.test(fn) && /req\.method !== 'GET'/.test(fn), 'solo lectura, con caché de Vercel (abre rápido y no gasta lecturas)');
ok(!/match \/stock\/[^}]*allow read: if true/.test(leer('firestore.rules')), 'el stock sigue cerrado en Firestore: lo público sale solo por la función');

console.log('\n2) La página');
const html = leer('equipos.html');
ok(/og:image" content="https:\/\/[^"]+\/equipos-og\.png"/.test(html) && fs.existsSync(DIR + 'equipos-og.png'), 'imagen para cuando se comparte el link (con URL completa)');
ok(/og:title/.test(html) && /name="description"/.test(html), 'título y descripción');
ok(!/firebase/i.test(html), 'no carga Firebase: abre liviana desde Instagram/WhatsApp');
const vj = JSON.parse(leer('vercel.json'));
ok(vj.rewrites.some(x => x.source === '/equipos' && x.destination === '/equipos.html'), 'la ruta /equipos');
// equipos.js en un DOM mínimo
const nodos = {};
const nodo = id => nodos[id] || (nodos[id] = { id, innerHTML: '', textContent: '', style: {}, value: '', href: '', classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {} });
const ctx = { console, Math, JSON, String, Number, Array, Object, Date, encodeURIComponent, Promise, setTimeout, clearTimeout,
  document: { getElementById: nodo, querySelectorAll: () => [], addEventListener() {}, body: { style: {} } },
  history: { pushState() {}, back() {}, replaceState() {} },
  location: { origin: 'https://x.vercel.app', pathname: '/equipos', search: '' },
  URLSearchParams,
  navigator: { clipboard: { writeText: async () => {} } },
  fetch: async () => ({ ok: true, json: async () => ({ equipos: [] }) }) };
ctx.window = ctx; ctx.window.addEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(leer('equipos.js'), ctx);
const EQ = ctx._equipos;
const ip = { ...e, marca: 'iPhone', modelo: 'iPhone 13' };
ok(EQ.mensajeInteres(ip) === 'Hola TechPoint! Me interesa el iPhone 13 128 GB (usado) que vi en la página de equipos. ¿Sigue disponible?',
   'mensaje de "Me interesa" (sin repetir "iPhone iPhone")', EQ.mensajeInteres(ip));
ok(EQ.mensajeInteres({ ...e, marca: 'Samsung', modelo: 'Galaxy A55', capacidad: '256 GB', condicion: 'nuevo' }).includes('el Samsung Galaxy A55 256 GB (nuevo)'), 'con marca cuando no se repite');
let f = EQ.fichaHtml({ ...e, estado: 'sinstock' }, 0);
ok(/Sin stock/.test(f) && /Pedir uno parecido/.test(f) && !/Me interesa/.test(f), 'sin stock: etiqueta roja y "Pedir uno parecido"');
f = EQ.fichaHtml({ ...e, estado: 'reservado', precio: 0 }, 0);
ok(/Reservado/.test(f) && /Consultar precio/.test(f), 'reservado y sin precio: "Consultar precio"');
f = EQ.fichaHtml({ ...e, fotos: ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg', 'https://x/4.jpg'] }, 0);
ok(/1 \/ 4/.test(f) && /U\$S/.test(f) && /89%/.test(f) && /3 meses/.test(f), 'contador de fotos, dólares, batería y garantía');
ok(/wa\.me\/5491172392511/.test(f), 'el WhatsApp del local');
f = EQ.fichaHtml({ ...e, modelo: '<img src=x onerror=alert(1)>' }, 0);
ok(!/<img src=x/.test(f), 'lo que se escribe en el stock no puede inyectar HTML');
EQ.S.equipos = [ip, { ...e, id: 'b', marca: 'Samsung', modelo: 'A55', color: 'Lila', condicion: 'nuevo' }];
EQ.S.q = '128gb';
ok(EQ.filtrados().length === 2, 'buscar "128gb" encuentra "128 GB"');
EQ.S.q = 'lila'; ok(EQ.filtrados().map(x => x.id).join() === 'b', 'buscar por color');
EQ.S.q = ''; EQ.S.cond = 'nuevo'; ok(EQ.filtrados().map(x => x.id).join() === 'b', 'filtro Nuevos');
EQ.S.cond = ''; EQ.S.marca = 'iPhone'; ok(EQ.filtrados().map(x => x.id).join() === 'a', 'filtro por marca');

// ── Lo que se agregó mirando la página en vivo ──
console.log('\n1b) Varias unidades del mismo modelo, una sola ficha');
// De los nuevos entran varios iguales: misma foto, mismo precio, distinto
// IMEI. Adentro de la app cada uno sigue siendo su propio equipo (su
// garant\u00eda, su venta, su comprobante). Lo que cambia es que al cliente no se
// le muestra la misma ficha cinco veces.
const u = (id, extra) => api.equipoPublico({ ...privado, id, estado: 'Nuevo', moneda: 'ars',
  precioUSD: 0, precio: 300000, bateria: 0, almacenamiento: '128GB', color: '',
  marca: 'Samsung', modelo: 'A16', garantiaMeses: 6, detallesPublicos: '', ...extra }, AHORA);

let gr = api.agruparEquipos([u('a'), u('b'), u('c')]);
ok(gr.length === 1, 'tres unidades iguales son una sola ficha', gr.length);
ok(gr[0].unidades === 3, 'que dice que hay 3', gr[0].unidades);
ok(gr[0].id === 'a', 'con el id de la primera, para el link de compartir', gr[0].id);

// Los colores son la gracia: "lo tenemos en negro, azul y verde".
gr = api.agruparEquipos([u('a', { color: 'Negro' }), u('b', { color: 'Azul' }), u('c', { color: 'Negro' })]);
ok(gr.length === 1 && gr[0].unidades === 3, 'distinto color no las separa', gr.map(x => x.unidades));
ok(gr[0].color === 'Negro, Azul', 'los colores se juntan, sin repetir', gr[0].color);

// Lo que el cliente ver\u00eda distinto S\u00cd las separa.
ok(api.agruparEquipos([u('a'), u('b', { precio: 320000 })]).length === 2,
   'dos precios distintos no se pueden mostrar con un n\u00famero solo');
ok(api.agruparEquipos([u('a'), u('b', { almacenamiento: '256GB' })]).length === 2, 'ni dos capacidades');
ok(api.agruparEquipos([u('a'), u('b', { garantiaMeses: 3 })]).length === 2, 'ni dos garant\u00edas');
ok(api.agruparEquipos([u('a'), u('b', { estado: 'Usado' })]).length === 2, 'ni nuevo con usado');
ok(api.agruparEquipos([u('a'), u('b', { modelo: 'A17' })]).length === 2, 'ni dos modelos');
// Reservado y disponible tampoco: diria "2 disponibles" y hay uno solo.
ok(api.agruparEquipos([u('a'), u('b', { reservado: true })]).length === 2,
   'ni uno reservado con uno disponible');

// Si la primera unidad vino sin fotos, la ficha no queda pelada.
gr = api.agruparEquipos([u('a', { fotos: [] }), u('b', { fotos: ['https://x/9.jpg'] })]);
ok(gr.length === 1 && gr[0].fotos.length === 1, 'usa las fotos de la unidad que tenga', gr[0].fotos);

// Para ordenar vale la m\u00e1s nueva del grupo.
gr = api.agruparEquipos([u('a', { fecha: dias(9) }), u('b', { fecha: dias(1) })]);
ok(gr[0].fecha === dias(1), 'la fecha del grupo es la de la unidad m\u00e1s nueva', gr[0].fecha);

// El endpoint no se puede correr aca (necesita las credenciales de Firebase),
// asi que se chequea que la respuesta pase por el agrupado.
ok(/ordenarEquipos\(agruparEquipos\(/.test(leer('api/equipos.js')),
   'y la respuesta del endpoint pasa por el agrupado');

// Y en la ficha.

console.log('\n2b) Un precio imposible no sale publicado');
// Estaba publicado un Realme nuevo a "$67": eran 67 dólares cargados en el
// campo de pesos. El cliente que ve eso no piensa "ganga", piensa que los
// precios de la página no son serios.
ok(api.PRECIO_MIN_ARS >= 1000, 'hay un piso en pesos', api.PRECIO_MIN_ARS);
ok(api.equipoPublico({ ...privado, precio: 67, moneda: 'ars', precioUSD: 0 }, AHORA).precio === 0,
   'un celular a $67 sale como "Consultar precio", no con ese número');
ok(api.equipoPublico({ ...privado, precio: 250000, moneda: 'ars', precioUSD: 0 }, AHORA).precio === 250000,
   'un precio normal pasa igual');
ok(api.equipoPublico({ ...privado, moneda: 'usd', precioUSD: 3 }, AHORA).precio === 0,
   'y en dólares también hay piso');
ok(api.equipoPublico({ ...privado, moneda: 'usd', precioUSD: 250 }, AHORA).precio === 250,
   'con un precio en dólares normal, pasa');

// Y en la app, antes de guardar.
const catSrc = leer('catalogo-stock.js');
// catalogo-stock.js de verdad, con un formulario de mentira.
const frm = {};
const frmEl = id => frm[id] || (frm[id] = { id, value: '', checked: false, innerHTML: '', className: '',
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {} });
const cctx = { console, Math, JSON, String, Number, Array, Object, Date, parseInt, parseFloat, setTimeout,
  document: { getElementById: frmEl, querySelectorAll: () => [], createElement: () => frmEl('tmp'),
              addEventListener() {}, body: { appendChild() {} } },
  esc: x => String(x == null ? '' : x), toast: () => {}, confirm: () => true, URL: { revokeObjectURL() {} } };
cctx.window = cctx; cctx.globalThis = cctx;
vm.createContext(cctx);
vm.runInContext(catSrc, cctx, { filename: 'catalogo-stock.js' });
const crun = x => vm.runInContext(x, cctx);

ok(crun('catPrecioRaro(67, false)') === true, 'un celular a $67 es un precio que no cierra');
ok(crun('catPrecioRaro(250000, false)') === false, 'uno normal no molesta');
ok(crun('catPrecioRaro(67, true)') === false, '67 D\u00d3LARES s\u00ed es un precio posible');
ok(crun('catPrecioRaro(3, true)') === true, 'pero 3 d\u00f3lares no');
ok(crun('catPrecioRaro(0, false)') === false, 'sin precio no avisa nada: para eso est\u00e1 "Consultar precio"');

// Lo que le falta a la ficha, que es por lo que sal\u00edan peladas.
frmEl('fi-estado').value = 'Usado';
let falta = crun('catFaltantes()');
ok(falta.includes('color') && falta.includes('bater\u00eda') && falta.includes('detalles') && falta.includes('fotos'),
   'en un usado vac\u00edo, pide color, bater\u00eda, detalles y fotos', falta);
frmEl('fi-estado').value = 'Nuevo';
falta = crun('catFaltantes()');
ok(!falta.includes('bater\u00eda'), 'en uno nuevo no pide bater\u00eda: no aplica', falta);
frmEl('fi-color').value = 'Negro';
frmEl('fi-bateria').value = '92';
frmEl('fi-detalles-pub').value = 'Con caja';
frmEl('fi-garantia').value = '6';
crun('_catFotos = ["https://x/1.jpg"]');
ok(crun('catFaltantes()').length === 0, 'con todo cargado no pide nada', crun('catFaltantes()'));

// Y el freno al guardar: solo si el equipo va a la p\u00e1gina.
// El cartel se deja en "no" ANTES: así, si alguien sacara la traba del
// publicar, este chequeo se daría cuenta.
crun('confirm = () => __NO();'); cctx.__NO = () => false;
frmEl('fi-publicar').checked = false;
ok(crun('catConfirmarPublicacion(67, false)') === true, 'sin publicar, un precio raro no frena nada');
frmEl('fi-publicar').checked = true;
ok(crun('catConfirmarPublicacion(67, false)') === false, 'publicando, pregunta y si dec\u00eds que no, no guarda');
crun('confirm = () => __SI();'); cctx.__SI = () => true;
ok(crun('catConfirmarPublicacion(67, false)') === true, 'y si dec\u00eds que s\u00ed, guarda igual: es tu decisi\u00f3n');
ok(crun('catConfirmarPublicacion(250000, false)') === true, 'con un precio normal no pregunta nada');

ok(/function catConfirmarPublicacion/.test(catSrc), 'y pregunta antes de publicarlo');
ok(/catConfirmarPublicacion\(precio/.test(leer('app.js')), 'enganchado al guardar el equipo');
ok(/function catFaltantes/.test(catSrc) && /bater\u00eda/.test(JSON.stringify(catSrc)),
   'y avisa lo que le falta a la ficha (batería, color, detalles…)');
ok(/id="fi-pub-aviso"/.test(leer('index.html')), 'con un renglón en el formulario');

// La ficha de un grupo lo dice.
let fg = EQ.fichaHtml({ ...e, estado: 'disponible', unidades: 3 }, 0);
ok(/3 disponibles/.test(fg), 'la ficha avisa que hay 3');
fg = EQ.fichaHtml({ ...e, estado: 'disponible', unidades: 1 }, 0);
ok(!/disponibles/.test(fg), 'con una sola unidad no dice nada');
fg = EQ.fichaHtml({ ...e, estado: 'sinstock', unidades: 3 }, 0);
ok(!/3 disponibles/.test(fg), 'y si est\u00e1n todas vendidas, tampoco');

console.log('\n2c) Ordenar, compartir y la fecha');
// Lo que faltaba para el que entra desde Instagram: ver de más barato a más
// caro, mandarle a un cliente el link de UN equipo, y saber si los precios
// son de hoy.
EQ.S.q = ''; EQ.S.cond = ''; EQ.S.marca = ''; EQ.S.uno = '';
EQ.S.equipos = [
  { ...e, id: 'caro',  precio: 500000, moneda: 'ars' },
  { ...e, id: 'barato', precio: 150000, moneda: 'ars' },
  { ...e, id: 'sinprecio', precio: 0 },
];
EQ.S.orden = 'barato';
ok(EQ.filtrados().map(x => x.id).join() === 'barato,caro,sinprecio',
   'de más barato a más caro, y los "a consultar" al final', EQ.filtrados().map(x => x.id));
EQ.S.orden = 'caro';
ok(EQ.filtrados()[0].id === 'caro', 'y al revés', EQ.filtrados().map(x => x.id));
// Un precio en dólares no puede quedar último por ser "250".
ok(EQ.precioComparable({ precio: 250, moneda: 'usd' }) > EQ.precioComparable({ precio: 200000, moneda: 'ars' }),
   'los dólares se comparan contra los pesos, no por el número pelado');
EQ.S.orden = '';

// El link de un equipo solo.
ok(/\?eq=barato$/.test(EQ.linkEquipo({ id: 'barato' })), 'el link lleva el id del equipo', EQ.linkEquipo({ id: 'barato' }));
EQ.S.uno = 'barato';
ok(EQ.filtrados().map(x => x.id).join() === 'barato', 'abriendo ese link se ve ese equipo solo');
EQ.S.uno = 'noexiste';
ok(EQ.filtrados().length === 0, 'y si ya se vendió, no se ve nada (la página ofrece uno parecido)');
EQ.S.uno = '';
ok(/data-share=/.test(EQ.fichaHtml(e, 0)), 'cada ficha tiene su botón de compartir');
ok(/id="f-orden"/.test(html), 'el selector de orden está en la página');

// La fecha: el que entra no sabe si los precios son de hoy o de hace meses.
nodos['actualizado'] = { id: 'actualizado', textContent: '' };
EQ.pintarActualizado(new Date().toISOString());
ok(/hoy/.test(nodos['actualizado'].textContent), 'dice que se actualizó hoy', nodos['actualizado'].textContent);
EQ.pintarActualizado('2026-01-05T12:00:00.000Z');
ok(/05\/01/.test(nodos['actualizado'].textContent), 'o la fecha, si es de antes', nodos['actualizado'].textContent);

console.log('\n3) En la app: el formulario del stock');
const ix = leer('index.html'), app = leer('app.js'), cat = leer('catalogo-stock.js'), sx = leer('stock-extras.js');
ok(['fi-publicar', 'fi-color', 'fi-detalles-pub', 'fi-ocultar-precio', 'fi-fotos'].every(id => ix.includes(`id="${id}"`)), 'los campos de la página están en el formulario');
ok(ix.indexOf('src="catalogo-stock.js"') > ix.indexOf('src="stock-extras.js"'), 'catalogo-stock.js se carga');
ok((app.match(/catFormCampos\(\)/g) || []).length === 2 && (app.match(/catSubirPendientes\((editingId|id)\)/g) || []).length === 2,
   'se guarda al crear y al editar, y las fotos se suben después de guardar');
ok((app.match(/catFormCargar\(/g) || []).length === 2, 'se cargan al abrir (nuevo y editar)');
ok(/catBorrarFotosDe\(p\)/.test(app.slice(app.indexOf('async function deletePhone'))), 'al borrar un equipo se borran sus fotos');
ok(/refFromURL\(url\)\.delete\(\)/.test(cat), 'al quitar una foto se borra el archivo');
ok(/fotosSubir\(stockId, files/.test(sx) && ix.indexOf('src="fotos-subir.js"') > 0 && ix.indexOf('src="fotos-subir.js"') < ix.indexOf('src="stock-extras.js"'),
   'la compu sube con fotos-subir.js (el mismo que el celu)');
ok(/catPortada\(/.test(sx) && /fotos\.unshift\(url\)/.test(cat), 'se puede cambiar la portada (la primera foto)');
const c2 = { document: { getElementById: id => ({ 'fi-publicar': { checked: true }, 'fi-color': { value: ' Azul ' }, 'fi-detalles-pub': { value: 'Con caja ' }, 'fi-ocultar-precio': { checked: false } })[id] } };
vm.createContext(c2); vm.runInContext(cat, c2);
const campos = vm.runInContext('catFormCampos()', c2);
ok(campos.publicar === true && campos.color === 'Azul' && campos.detallesPublicos === 'Con caja' && campos.ocultarPrecio === false, 'catFormCampos', campos);

console.log('\n4) Publicar varios desde la selección múltiple');
{
  const COMMITS = [], TOASTS = [];
  let salio = 0;
  const STOCK = [
    { id: '1', marca: 'A', fotos: ['https://x'] }, { id: '2', marca: 'B' },
    { id: '3', marca: 'C', vendido: true }, { id: '4', marca: 'D', publicar: true },
  ];
  const c3 = { console, Array, Set, STOCK, _batchSelected: new Set(['1', '2', '3', '4']),
    toast: (m, t) => TOASTS.push(m), exitBatchMode: () => salio++,
    db: { batch: () => { const ops = []; return { update: (ref, d) => ops.push([ref.id, d]), commit: async () => COMMITS.push(ops) }; },
          collection: () => ({ doc: id => ({ id }) }) },
    document: { getElementById: () => null } };
  vm.createContext(c3); vm.runInContext(cat, c3);
  await vm.runInContext('batchPublicar(true)', c3);
  const hechos = COMMITS.flat().map(x => x[0]).join();
  ok(hechos === '1,2' && COMMITS.flat().every(x => x[1].publicar === true), 'publica los elegidos (no los vendidos, ni repite los que ya estaban)', hechos);
  ok(/2 equipos publicados/.test(TOASTS[0]) && /1 vendido quedó afuera/.test(TOASTS[0]) && /1 sin fotos/.test(TOASTS[0]), 'avisa cuántos, vendidos afuera y sin fotos', TOASTS[0]);
  ok(salio === 1 && STOCK[0].publicar === true, 'sale de la selección y se ve al toque');
  COMMITS.length = 0; TOASTS.length = 0;
  c3._batchSelected = new Set(['1', '4', '2']);
  await vm.runInContext('batchPublicar(false)', c3);
  ok(COMMITS.flat().map(x => x[0]).join() === '1,4,2' && COMMITS.flat().every(x => x[1].publicar === false), 'sacar de la página');
  ok(/batchPublicar\(true\)/.test(ix) && /batchPublicar\(false\)/.test(ix), 'los botones están en la barra de selección múltiple');
  ok(/bg-publicado/.test(app), 'la tarjeta del stock muestra "🌐 En la página"');
}

console.log('\n5) Fotos desde el celu (QR)');
{
  const fc = leer('fotos-celu.js'), fh = leer('fotos-celu.html'), lg = leer('login.html');
  ok(/requireAuth\('login\.html\?next=' \+ encodeURIComponent\(volver\)\)/.test(fc), 'pide sesión; si el celu no estaba logueado, el login lo devuelve a la misma pantalla');
  ok(/fotosSubir\(ID, files/.test(fc) && fh.indexOf('fotos-subir.js') < fh.indexOf('fotos-celu.js'), 'el celu sube con fotos-subir.js');
  ok(/\^\[A-Za-z0-9_-\]\{4,60\}\$/.test(fc), 'un id raro en el link no se usa');
  ok(/capture="environment"/.test(fh) && /firebase-storage-compat/.test(fh) && /noindex/.test(fh), 'abre la cámara trasera; no aparece en Google');
  ok(/catQrCelu\(_catId\)/.test(cat) && /catQrCelu\('\$\{id\}'\)/.test(sx), 'botón "Desde el celu" en el formulario y en la ficha del equipo');
  ok(/onSnapshot/.test(cat.slice(cat.indexOf('function catQrCelu'))) && /_catQrUnsub\(\)/.test(cat), 'con el QR abierto las fotos aparecen solas, y al cerrar se deja de escuchar');
  // el ?next del login: solo páginas propias
  const m = lg.match(/function destino\(\) \{[\s\S]*?\n    \}/);
  ok(!!m, 'el login vuelve a donde se pidió (también después de escribir la contraseña)');
  const cl = { URLSearchParams, location: { search: '' } };
  vm.createContext(cl); vm.runInContext(m[0], cl);
  const dest = q => { cl.location.search = '?next=' + encodeURIComponent(q); return vm.runInContext('destino()', cl); };
  ok(dest('fotos-celu.html?id=abc123') === 'fotos-celu.html?id=abc123', 'acepta la pantalla de fotos');
  ok(dest('https://malo.com/x.html') === 'index.html' && dest('//malo.com/x.html') === 'index.html' && dest('x.html?a=<script>') === 'index.html',
     'no manda a otro sitio (open redirect)');
}

console.log('\n6) La subida de fotos (fotos-subir.js)');
{
  const fsu = leer('fotos-subir.js');
  ok(/FOTO_MAX = 1000/.test(fsu) && /FOTO_CALIDAD = 0\.7/.test(fsu), '1000 px, calidad 70%');
  ok(/'image\/webp'/.test(fsu) && /b\.type === 'image\/webp'/.test(fsu) && /'image\/jpeg'/.test(fsu), 'WebP si el navegador lo sabe hacer; si no, JPG');
  ok(/imageOrientation: 'from-image'/.test(fsu), 'respeta la rotación de la foto del celu');
  ok(/cacheControl: FOTO_CACHE/.test(fsu) && /max-age=31536000, immutable/.test(fsu), 'las fotos se guardan con caché larga (la página no las vuelve a bajar)');
  // Simulación: 5 fotos, Storage que termina en desorden. Se tienen que anotar en orden.
  const ANOTADAS = [], PUTS = [];
  let activas = 0, maxActivas = 0, n = 0;
  const cc = { console, Math, Array, Promise, Date, setTimeout, Error,
    firebase: { firestore: { FieldValue: { arrayUnion: (...v) => ({ u: v }) } } },
    document: { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob: (cb, tipo) => cb({ type: tipo, size: 1000 }) }) },
    createImageBitmap: async f => ({ width: 4000, height: 3000, close() {} }) };
  vm.createContext(cc); vm.runInContext(fsu, cc);
  const demora = [300, 50, 200, 10, 120];
  const storage = { ref: path => ({ put: (blob, meta) => {
    activas++; maxActivas = Math.max(maxActivas, activas); PUTS.push([path, meta]);
    const i = Number(path.split('_')[1]);
    const snap = { ref: { getDownloadURL: async () => 'u' + i } };
    return { snapshot: snap, on: (ev, prog, err, fin) => setTimeout(() => { prog({ bytesTransferred: 1000 }); activas--; fin(); }, demora[i]) };
  } }) };
  const dbm = { collection: () => ({ doc: () => ({ update: async d => { ANOTADAS.push(d.fotos.u[0]); } }) }) };
  const PROG = [];
  const r = await cc.fotosSubir('eq1', [1, 2, 3, 4, 5].map(i => ({ size: 3e6 })), { storage, db: dbm, alProgreso: p => PROG.push(p) });
  ok(ANOTADAS.join() === 'u0,u1,u2,u3,u4', 'aunque terminen desordenadas, se anotan en el orden elegido (la portada es la primera)', ANOTADAS);
  ok(maxActivas === 3, 'de a 3 en paralelo', maxActivas);
  ok(r.urls.length === 5 && r.fallas === 0, 'devuelve las 5', r);
  ok(PUTS.every(([p, m]) => /^stock-photos\/eq1\/.+\.webp$/.test(p) && m.contentType === 'image/webp'), 'en la carpeta del equipo, en WebP', PUTS[0]);
  ok(PROG.length > 3 && PROG[PROG.length - 1].pct === 100 && PROG[PROG.length - 1].hechas === 5, 'avisa el progreso hasta el 100%');
  // Un corte: la foto 2 falla una vez y se reintenta sola
  ANOTADAS.length = 0;
  let falloUna = false;
  const storage2 = { ref: path => ({ put: () => {
    if (/_1_0\./.test(path) && !falloUna) { falloUna = true; return { snapshot: {}, on: (e, p, err) => setTimeout(() => err(new Error('corte')), 5) }; }
    const i = Number(path.split('_')[1]);
    return { snapshot: { ref: { getDownloadURL: async () => 'v' + i } }, on: (e, p, err, fin) => setTimeout(fin, 5) };
  } }) };
  const r2 = await cc.fotosSubir('eq1', [{}, {}, {}], { storage: storage2, db: dbm });
  ok(falloUna && r2.urls.length === 3 && ANOTADAS.join() === 'v0,v1,v2', 'si se corta, reintenta sola y no se pierde la foto', ANOTADAS);
  // Safari viejo: pide WebP y devuelve PNG → JPG
  const c4 = { ...cc, document: { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob: (cb, tipo) => cb({ type: tipo === 'image/webp' ? 'image/png' : tipo, size: 1 }) }) } };
  vm.createContext(c4); vm.runInContext(fsu, c4);
  const a = await c4.fotoAchicar({});
  ok(a.tipo === 'image/jpeg' && a.ext === 'jpg', 'si no sabe hacer WebP, sale JPG', a);
}

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
