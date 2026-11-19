// ⭐ QR para que los clientes dejen reseña en Google. Alan (19/11): "Qr para
// que me dejen reseña" (el de TechPoint Caseros). El link se pega una vez en
// la app y el cartel sale con el QR generado acá (qr.js).
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// DOM y Firestore de mentira
let modal = '', guardado = null, impreso = null;
const toasts = [];
const ctx = {
  console, Math, Number, String, Array, Object, JSON, Set, URL, Date, Uint8Array, Promise, TextEncoder,
  toast: (m, t) => toasts.push([m, t]),
  _imprimirTocando: (tipo, html) => { impreso = { tipo, html }; },
  document: {
    getElementById: id => id === 'res-link' ? { value: ctx._link } : (id === 'res-css' ? {} : null),
    createElement: () => ({ set innerHTML(h) { modal = h; }, get innerHTML() { return modal; } }),
    body: { appendChild() {} }, head: { appendChild() {} },
  },
  db: { collection: () => ({ doc: () => ({
    get: async () => ({ exists: !!guardado, data: () => guardado }),
    set: async d => { guardado = Object.assign({}, guardado, d); },
  }) }) },
};
vm.createContext(ctx);
vm.runInContext(leer('qr.js'), ctx, { filename: 'qr.js' });
vm.runInContext(leer('resenas.js'), ctx, { filename: 'resenas.js' });
const run = c => vm.runInContext(c, ctx);
const LINK = 'https://g.page/r/CaBcDeFgHiJk/review';

console.log('\n1) Solo links de Google');
ok(run(`resLinkValido(${JSON.stringify(LINK)}).url`) === LINK, 'el link de "Pedir reseñas" (g.page) sirve');
ok(!run(`resLinkValido('https://search.google.com/local/writereview?placeid=ChIJ123').error`), 'el largo de Google también');
ok(!run(`resLinkValido('https://maps.app.goo.gl/AbC123').error`), 'y el de compartir de Maps');
ok(/Google/.test(run(`resLinkValido('https://reseñas-falsas.com/x').error`)), 'uno que no es de Google, no (un QR impreso nadie lo revisa)');
ok(/https/.test(run(`resLinkValido('http://g.page/r/x/review').error`)), 'sin https, no');
ok(run(`resLinkValido('hola').error`) && run(`resLinkValido('').error`), 'algo que no es un link, no');
ok(!!run(`resLinkValido('https://google.com.evil.com/x').error`), 'un dominio que solo empieza como Google, no');
ok(!run(`resLinkValido('https://www.google.com.ar/maps/place/x').error`), 'google.com.ar sí');

console.log('\n2) Guardar el link: solo el dueño');
(async () => {
  ctx._link = LINK;
  ctx._cajaIsOwner = false;
  await run('resGuardar()');
  ok(guardado === null && /dueño/.test(toasts.pop()[0]), 'un empleado no lo puede cambiar');
  ctx._cajaIsOwner = true;
  ctx._link = 'https://otro-lado.com/x';
  await run('resGuardar()');
  ok(guardado === null, 'un link que no es de Google no se guarda');
  ctx._link = LINK;
  await run('resGuardar()');
  ok(guardado && guardado.caseros === LINK, 'el dueño lo guarda en config/resenas', guardado);
  ok(/res-qr[\s\S]*<svg/.test(modal) && /Cartel para el mostrador/.test(modal), 'y ya muestra el QR y los botones para imprimir');

  console.log('\n3) El cartel');
  run(`resImprimir('grande')`);
  ok(impreso && impreso.tipo === 'hoja' && /size:A5/.test(impreso.html), 'sale en A5 por la impresora de hojas');
  ok(/Dejanos tu reseña en Google/.test(impreso.html) && /TechPoint · Caseros/.test(impreso.html), 'con el texto y el nombre del local');
  const mat = run(`qrMatriz(${JSON.stringify(LINK)})`);
  ok(mat.length >= 21 && (impreso.html.match(/<svg/g) || []).length === 1, 'con un QR del link guardado');
  run(`resImprimir('chicos')`);
  ok((impreso.html.match(/<svg/g) || []).length === 4 && /size:A4/.test(impreso.html), 'o cuatro chiquitos en una A4 para recortar');

  console.log('\n4) Enganchado');
  ok(/label: 'QR de reseñas en Google'/.test(leer('caja.js')) && /resAbrir\(\)/.test(leer('caja.js')), 'menú de la caja → Facturación y tarjetas → QR de reseñas');
  ok(/<script src="qr\.js"><\/script>[\s\S]*<script src="resenas\.js"><\/script>/.test(leer('caja.html')), 'la caja carga resenas.js (después de qr.js)');
  ok(!/api\.qrserver|chart\.googleapis/.test(leer('resenas.js')), 'el QR se hace en la app, sin servicios de afuera');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})();
