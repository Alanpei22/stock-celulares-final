// 🛍️ Página de accesorios (/accesorios). Alan (22/11): "precio sí, stock
// hay / últimas unidades, sin publicar (después lo hacemos desde la app),
// primero sin envío, fotos las vamos a hacer nosotros". Se prueba: qué sale
// de /api/accesorios (lista blanca: nada de costos ni stock exacto), la
// búsqueda "¿Qué celu tenés?" y la carga desde el inventario.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

(async () => {
  console.log('\n1) /api/accesorios: qué sale y qué no');
  const src = leer('api/accesorios.js').replace("import admin from 'firebase-admin';", 'const admin = {};');
  const api = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const doc = { id: 'p1', nombre: 'Funda silicona negra', categoria: 'Funda / Cover', precioVenta: 12500, precioCosto: 4000, precioCostoUSD: 3.5,
    stock: 7, stockMin: 2, codigo: '7790001', publicar: true, compat: 'A54, A34 / A24', fotos: ['https://f/a.webp', 'data:x', 'http://inseguro'] };
  const pub = api.accesorioPublico(doc);
  ok(pub && pub.nombre === 'Funda silicona negra' && pub.precio === 12500, 'sale con nombre y precio');
  ok(!('precioCosto' in pub) && !('precioCostoUSD' in pub) && !('stock' in pub) && !('codigo' in pub) && !JSON.stringify(pub).includes('4000'), 'sin costo, sin stock exacto, sin código', Object.keys(pub));
  ok(pub.disponibilidad === 'hay', 'stock 7 → "hay"');
  ok(api.accesorioPublico({ ...doc, stock: 2 }).disponibilidad === 'ultimas' && api.accesorioPublico({ ...doc, stock: 4, stockMin: 5 }).disponibilidad === 'ultimas', '2 o menos (o debajo del mínimo) → "últimas unidades"');
  ok(api.accesorioPublico({ ...doc, stock: 0 }) === null, 'sin stock no se muestra');
  ok(api.accesorioPublico({ ...doc, publicar: false }) === null && api.accesorioPublico({ ...doc, publicar: undefined }) === null, 'sin publicar no sale (arranca así)');
  ok(api.accesorioPublico({ ...doc, activo: false }) === null, 'desactivado tampoco');
  ok(JSON.stringify(pub.compat) === '["A54","A34","A24"]', '"Para qué celu" se separa por comas o barras', pub.compat);
  ok(pub.fotos.length === 1 && pub.fotos[0] === 'https://f/a.webp', 'solo fotos https');
  ok(api.accesorioPublico({ ...doc, precioVenta: 3 }).precio === 0, 'un precio que no puede ser ($3) no se muestra: queda "Consultá el precio"');
  const ord = api.ordenarAccesorios([{ nombre: 'B', categoria: 'Cable', fotos: [] }, { nombre: 'A', categoria: 'Funda', fotos: ['x'] }]);
  ok(ord[0].nombre === 'A', 'los que tienen foto, primero');
  ok(/where\('publicar', '==', true\)/.test(leer('api/accesorios.js')) && /s-maxage=60/.test(leer('api/accesorios.js')), 'lee solo los publicados y queda en caché un minuto (no una lectura por visita)');

  console.log('\n2) "¿Qué celu tenés?"');
  const ctx = { console, String, Array, Set, Math, JSON, encodeURIComponent, URL, URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext(leer('accesorios.js'), ctx, { filename: 'accesorios.js' });
  const A = ctx.ACC;
  const L = [
    { id: 'f1', nombre: 'Funda silicona', categoria: 'Funda / Cover', precio: 12500, disponibilidad: 'hay', compat: ['A54'], detalle: '', fotos: [] },
    { id: 'v1', nombre: 'Vidrio 9D', categoria: 'Vidrio templado / Hidrogel', precio: 6000, disponibilidad: 'ultimas', compat: ['A54', 'A34'], detalle: '', fotos: [] },
    { id: 'f5', nombre: 'Funda A5', categoria: 'Funda / Cover', precio: 9000, disponibilidad: 'hay', compat: ['A5'], detalle: '', fotos: [] },
    { id: 'i13', nombre: 'Funda MagSafe', categoria: 'Funda / Cover', precio: 18000, disponibilidad: 'hay', compat: ['iPhone 13'], detalle: '', fotos: [] },
    { id: 'i13p', nombre: 'Funda antigolpe', categoria: 'Funda / Cover', precio: 15000, disponibilidad: 'hay', compat: ['iPhone 13 Pro'], detalle: '', fotos: [] },
    { id: 'c1', nombre: 'Cargador 20W', categoria: 'Cargador', precio: 22000, disponibilidad: 'hay', compat: [], detalle: 'Carga rápida', fotos: [] },
  ];
  const ids = (q, c) => A.buscar(L, q, c).grupos.map(g => g.items.map(a => a.id).join(',')).join(' | ');
  ok(ids('A54') === 'f1,v1 | c1', '"A54": la funda y el vidrio del A54, y aparte lo que sirve para cualquiera', ids('A54'));
  ok(!ids('A54').includes('f5') && ids('A5').startsWith('f5 |'), '"A54" no trae lo del "A5" (ni al revés)', ids('A5'));
  ok(ids('Samsung Galaxy A54 5G') === ids('A54'), '"Samsung Galaxy A54 5G" es lo mismo que "A54"');
  ok(ids('iPhone 13') === 'i13 | c1' && ids('13 pro').startsWith('i13p'), '"iPhone 13" no trae lo del 13 Pro', ids('iPhone 13'));
  ok(ids('a3').startsWith('v1 |'), 'a medio escribir ("a3") ya encuentra el A34', ids('a3'));
  ok(A.buscar(L, 'A54', '').modo === 'modelo' && /Para tu A54/.test(A.buscar(L, 'A54', '').grupos[0].titulo), 'arma el título "Para tu A54"');
  ok(ids('cargador') === 'c1' && A.buscar(L, 'cargador', '').modo === 'texto', 'si no es un modelo, busca por texto ("cargador")');
  ok(ids('A54', 'Funda / Cover') === 'f1', 'con una pestaña elegida (Fundas), solo de esa categoría');
  ok(ids('') === 'f1,v1,f5,i13,i13p,c1', 'sin buscar: todos');

  console.log('\n3) La tarjeta');
  const h = A.ficha(L[1], 'A54');
  ok(/\$ 6\.000/.test(h) && /Últimas unidades/.test(h) && /Para: <b>A54 · A34<\/b>/.test(h), 'precio, "últimas unidades" y para qué celu');
  ok(/wa\.me\/5491172392511\?text=/.test(h) && decodeURIComponent(h.match(/text=([^"]+)/)[1]).includes('Mi celu es A54'), '"Lo quiero" abre WhatsApp con el producto y el modelo', decodeURIComponent(h.match(/text=([^"]+)/)[1]));
  ok(/Hay stock/.test(A.ficha(L[0], '')) && /Sirve para cualquier celu/.test(A.ficha(L[5], '')), '"Hay stock" y "Sirve para cualquier celu"');
  ok(!/\b\d+ (u\.|unidades)\b/.test(A.ficha(L[0], '')), 'nunca la cantidad exacta');
  ok(/acc-sin-foto/.test(A.ficha(L[0], '')), 'sin foto: un dibujo de la categoría, no un hueco');

  console.log('\n4) La página y el inventario');
  const html = leer('accesorios.html');
  ok(/id="h-buscar"/.test(html) && /¿Qué celu tenés\?/.test(html), 'arriba de todo: "¿Qué celu tenés?"');
  ok(/no hacemos envíos/.test(html) && /Retiro en el local/.test(html), 'dice que por ahora es con retiro en el local');
  ok(/src="accesorios-video\.mp4"/.test(html) && fs.statSync(DIR + 'accesorios-video.mp4').size < 3 * 1048576, 'el pedazo del video de accesorios, liviano');
  ok(/"source": "\/accesorios"/.test(leer('vercel.json')), '/accesorios anda como link corto');
  ok(/href="accesorios"/.test(leer('equipos.html')), 'desde /equipos hay link a accesorios');
  const caja = leer('caja.html'), inv = leer('inventario.js');
  ok(/id="inv-fi-publicar" type="checkbox">/.test(caja) && !/id="inv-fi-publicar" type="checkbox" checked/.test(caja), 'inventario: "Mostrar en la página", destildado de entrada');
  ok(/id="inv-fi-compat"/.test(caja) && /id="inv-fotos"/.test(caja), 'inventario: "Para qué celu" y fotos');
  ok(/publicar, compat, fotos: _invFotos\.guardadas\.slice\(\)/.test(inv), 'al guardar se anotan publicar, compat y las fotos');
  ok((inv.match(/invSubirFotos\((_invEditingId|ref\.id), fotosNuevas, nom\)/g) || []).length === 2, 'las fotos nuevas se suben después de guardar (al crear y al editar)');
  ok(/arrayUnion\(\.\.\.urls\)/.test(inv) && /accesorios\/\$\{id\}/.test(inv) && /stock-photos\/acc-\$\{id\}/.test(inv), 'a accesorios/{id}/ (o stock-photos/ si falta publicar la regla), sin pisar otras');
  ok(/firebase-storage-compat\.js/.test(caja) && /<script src="fotos-subir\.js"><\/script>/.test(caja), 'la caja carga Storage y fotos-subir.js');
  ok(/match \/accesorios\/\{productoId\}\/\{filename\}/.test(leer('storage.rules')), 'storage.rules tiene la carpeta accesorios/ (hay que publicarla)');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})();
