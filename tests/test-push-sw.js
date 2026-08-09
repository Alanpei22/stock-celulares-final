// Corre el manejador de push del service worker en una sandbox y revisa
// con qué opciones se muestra la notificación.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const handlers = {};
const mostradas = [];
const ctx = {
  console, Date, JSON, URL, Array, Promise, setTimeout,
  self: {
    addEventListener: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    skipWaiting: () => {}, clients: { claim: () => {}, matchAll: () => Promise.resolve([]) },
    registration: {
      scope: 'https://x/',
      showNotification: (title, options) => { mostradas.push({ title, options }); return Promise.resolve(); },
    },
  },
  caches: { open: () => Promise.resolve({ addAll: () => Promise.resolve(), match: () => Promise.resolve(null), put: () => {} }),
            keys: () => Promise.resolve([]), match: () => Promise.resolve(null) },
  clients: { matchAll: () => Promise.resolve([]), openWindow: (u) => { ctx.__abierto = u; return Promise.resolve(); } },
  fetch: () => Promise.resolve({ clone: () => ({}) }),
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'sw.js', 'utf8'), ctx, { filename: 'sw.js' });

function recibirPush(payload) {
  mostradas.length = 0;
  const ev = { data: { json: () => payload }, waitUntil: p => p };
  handlers.push.forEach(h => h(ev));
  return mostradas[0];
}

console.log('\n1) Aviso de equipo nuevo');
const nuevo = recibirPush({
  title: '🔧 EQUIPO NUEVO · N°7123',
  body: 'Samsung Galaxy A54\n🔧 Módulo / Pantalla\n👤 Marina Suárez\n💵 $85.000',
  url: '/index.html', tag: 'rep-nueva-abc', requireInteraction: true,
  vibrate: [300, 120, 300, 120, 450],
  actions: [{ action: 'ver', title: '👀 Ver equipo' }, { action: 'descartar', title: '✕ Descartar' }],
});
ok(nuevo.options.requireInteraction === true, 'queda fijo hasta que lo tocás', nuevo.options.requireInteraction);
ok(Array.isArray(nuevo.options.vibrate) && nuevo.options.vibrate.length === 5, 'vibra con patrón largo', nuevo.options.vibrate);
ok(nuevo.options.actions.length === 2, 'muestra los dos botones', nuevo.options.actions);
ok(nuevo.options.renotify === true, 'vuelve a sonar si reemplaza a otra igual', nuevo.options.renotify);
ok((nuevo.options.body.match(/\n/g) || []).length === 3, 'el cuerpo tiene 4 líneas (se ve grande al desplegar)', nuevo.options.body);
ok(nuevo.options.icon === '/icon-192.png' && nuevo.options.badge === '/icon-192.png', 'con ícono y badge');
ok(typeof nuevo.options.timestamp === 'number', 'lleva la hora del aviso');

console.log('\n2) Aviso de cambio de estado');
const cambio = recibirPush({
  title: '🔄 N°7123 · ESPERANDO REPUESTO',
  body: 'Samsung Galaxy A54\n🔧 Módulo', tag: 'rep-estado-abc',
  vibrate: [300, 120, 300, 120, 450],
  actions: [{ action: 'ver', title: '👀 Ver equipo' }],
});
ok(cambio.options.requireInteraction === false, 'NO queda fijo (si no, se te llena la pantalla)', cambio.options.requireInteraction);
ok(cambio.options.renotify === true, 'igual vuelve a sonar en cada cambio', cambio.options.renotify);
ok(/ESPERANDO REPUESTO/.test(cambio.title), 'el título grita la fase nueva', cambio.title);

console.log('\n3) Casos borde');
const pelado = recibirPush({ title: 'Hola' });
ok(pelado.options.renotify === undefined, 'sin tag NO manda renotify (Chrome lo rechaza y no mostraría nada)', pelado.options.renotify);
ok(Array.isArray(pelado.options.vibrate), 'igual vibra con el patrón por defecto', pelado.options.vibrate);
ok(pelado.options.image === undefined, 'sin imagen si no se pidió');
const conImg = recibirPush({ title: 'x', tag: 't', image: '/icon-512.png' });
ok(conImg.options.image === '/icon-512.png', 'si se manda imagen, la pasa');

console.log('\n3b) Los banners existen y están cacheados');
const swSrc = fs.readFileSync(DIR + 'sw.js', 'utf8');
ok(/push-nuevo\.png/.test(swSrc) && /push-estado\.png/.test(swSrc),
   'los dos banners están en el SHELL del service worker (salen sin internet)');
for (const png of ['push-nuevo.png', 'push-estado.png']) {
  const b = fs.readFileSync(DIR + png);
  ok(b.length > 5000 && b.slice(1, 4).toString() === 'PNG', `${png} es un PNG válido (${Math.round(b.length / 1024)} KB)`);
  // Ancho y alto viven en el chunk IHDR, bytes 16-23
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  ok(w === 1024 && h === 512, `${png} mide 1024x512 (relación 2:1, la que recorta Chrome)`, { w, h });
}
const webpushSrc = fs.readFileSync(DIR + 'webpush.js', 'utf8');
const repairsSrc = fs.readFileSync(DIR + 'repairs.js', 'utf8');
ok(/image: '\/push-estado\.png'/.test(webpushSrc), 'el aviso de cambio de estado manda su banner');
ok(/image: '\/push-nuevo\.png'/.test(repairsSrc), 'el aviso de equipo nuevo manda su banner');

console.log('\n4) Botón "Descartar" no abre la app');
let abierto = false;
const evClick = {
  notification: { close: () => {}, data: { url: '/index.html' } },
  action: 'descartar',
  waitUntil: p => { abierto = true; return p; },
};
handlers.notificationclick.forEach(h => h(evClick));
ok(abierto === false, 'descartar solo cierra el aviso', abierto);

const evClick2 = { notification: { close: () => {}, data: { url: '/index.html' } }, action: '', waitUntil: p => { abierto = true; return p; } };
handlers.notificationclick.forEach(h => h(evClick2));
ok(abierto === true, 'tocar el aviso sí abre la app');

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
