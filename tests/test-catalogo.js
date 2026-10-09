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
  history: { pushState() {}, back() {} }, fetch: async () => ({ ok: true, json: async () => ({ equipos: [] }) }) };
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

console.log('\n3) En la app: el formulario del stock');
const ix = leer('index.html'), app = leer('app.js'), cat = leer('catalogo-stock.js'), sx = leer('stock-extras.js');
ok(['fi-publicar', 'fi-color', 'fi-detalles-pub', 'fi-ocultar-precio', 'fi-fotos'].every(id => ix.includes(`id="${id}"`)), 'los campos de la página están en el formulario');
ok(ix.indexOf('src="catalogo-stock.js"') > ix.indexOf('src="stock-extras.js"'), 'catalogo-stock.js se carga');
ok((app.match(/catFormCampos\(\)/g) || []).length === 2 && (app.match(/catSubirPendientes\((editingId|id)\)/g) || []).length === 2,
   'se guarda al crear y al editar, y las fotos se suben después de guardar');
ok((app.match(/catFormCargar\(/g) || []).length === 2, 'se cargan al abrir (nuevo y editar)');
ok(/catBorrarFotosDe\(p\)/.test(app.slice(app.indexOf('async function deletePhone'))), 'al borrar un equipo se borran sus fotos');
ok(/refFromURL\(url\)\.delete\(\)/.test(cat), 'al quitar una foto se borra el archivo');
ok(/_compressImage\(file, maxSize = 1000, quality = 0\.7\)/.test(sx), 'las fotos se achican a 1000 px, JPG al 70%');
ok(/catPortada\(/.test(sx) && /fotos\.unshift\(url\)/.test(cat), 'se puede cambiar la portada (la primera foto)');
const c2 = { document: { getElementById: id => ({ 'fi-publicar': { checked: true }, 'fi-color': { value: ' Azul ' }, 'fi-detalles-pub': { value: 'Con caja ' }, 'fi-ocultar-precio': { checked: false } })[id] } };
vm.createContext(c2); vm.runInContext(cat, c2);
const campos = vm.runInContext('catFormCampos()', c2);
ok(campos.publicar === true && campos.color === 'Azul' && campos.detallesPublicos === 'Con caja' && campos.ocultarPrecio === false, 'catFormCampos', campos);

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
