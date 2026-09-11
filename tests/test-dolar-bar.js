// Barra del dólar en la caja.
// Lo que más se vigila: que mostrar la cotización NO cambie el número con el
// que la app hace las cuentas, y que no se llame a la API en cada pantalla.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const els = {};
const el = id => els[id] = {
  id, textContent: '', value: '', innerHTML: '',
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
};
['dolar-bar', 'dolar-compra', 'dolar-venta', 'dolar-usa'].forEach(el);

let LLAMADAS = 0, RESPUESTA = { compra: 1525, venta: 1545, fechaActualizacion: '2026-09-10T13:05:00.000Z' };
let FALLA = false;
const TOASTS = [];

const ctx = {
  console, setTimeout, clearTimeout, Date,
  document: { getElementById: id => els[id] || null },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  fetch: async () => { LLAMADAS++; if (FALLA) throw new Error('sin internet'); return { json: async () => RESPUESTA }; },
  toast: (m, t) => TOASTS.push([t, m]),
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
// utils.js de verdad (la parte sin firebase) + el pintado que vive en caja.js
const u = fs.readFileSync(DIR + 'utils.js', 'utf8');
vm.runInContext(u.slice(0, u.indexOf('//  LLAMADAS A NUESTRAS FUNCIONES DE /api')), ctx, { filename: 'utils.js' });
vm.runInContext(u.slice(u.indexOf('const _DOLAR_TTL_MS')), ctx, { filename: 'utils.js' });
const caja = fs.readFileSync(DIR + 'caja.js', 'utf8');
vm.runInContext(caja.slice(caja.indexOf('async function pintarDolarBar'),
                           caja.indexOf('//  PLANES DE AHORRO')), ctx, { filename: 'caja.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);

(async () => {

console.log('\n1) Trae compra y venta por separado');
let d = await get('dolarDetalle(true)');
ok(d.compra === 1525, 'compra', d.compra);
ok(d.venta === 1545, 'venta', d.venta);
ok(d.manual === false, 'no es manual');
ok(!!d.at, 'guarda cuándo se actualizó', d.at);

console.log('\n2) No llama a la API en cada pantalla');
const antes = LLAMADAS;
await get('dolarDetalle()');
await get('dolarDetalle()');
await get('dolarDetalle()');
ok(LLAMADAS === antes, 'tres consultas seguidas usan lo cacheado', LLAMADAS - antes);
await get('dolarDetalle(true)');
ok(LLAMADAS === antes + 1, 'y tocando la barra sí se actualiza', LLAMADAS - antes);

console.log('\n3) Mostrar la cotización NO cambia lo que usa la app');
// getCurrentDolar es el número con el que se convierten las ventas en USD.
run('_cachedDolar = 1555;');   // como si ensureDolar ya lo hubiera resuelto
const usaAntes = get('getCurrentDolar()');
await get('dolarDetalle(true)');
ok(get('getCurrentDolar()') === usaAntes, 'sigue siendo el mismo después de refrescar la barra',
   { antes: usaAntes, despues: get('getCurrentDolar()') });
ok(usaAntes === 1555, 'y no es la venta pelada de la API (1.545)', usaAntes);

console.log('\n4) La barra pintada');
await get('pintarDolarBar(true)');
ok(els['dolar-compra'].textContent === '$1.525', 'compra con formato de acá', els['dolar-compra'].textContent);
ok(els['dolar-venta'].textContent === '$1.545', 'venta', els['dolar-venta'].textContent);
ok(/la app usa \$1\.555/.test(els['dolar-usa'].textContent),
   'aclara con qué número convierte, porque difiere de la venta', els['dolar-usa'].textContent);

console.log('\n5) Si coincide con la venta, no repite el número');
run('_cachedDolar = 1545;');
await get('pintarDolarBar(true)');
ok(els['dolar-usa'].textContent === '', 'sin aclaración redundante', els['dolar-usa'].textContent);

console.log('\n6) Cotización cargada a mano');
// Si el dueño la fijó en Configuración, los números de la API no se usan:
// mostrarlos sería mentir sobre con qué se está convirtiendo.
run("localStorage.setItem('dolarManual', '1600'); _cachedDolar = 0;");
d = await get('dolarDetalle(true)');
ok(d.manual === true, 'se detecta');
ok(d.usa === 1600, 'y manda el valor cargado', d.usa);
await get('pintarDolarBar(true)');
ok(els['dolar-bar'].classList.contains('dolar-bar--manual'), 'la barra cambia de cara');
ok(/a mano · \$1\.600/.test(els['dolar-usa'].textContent), 'y lo dice', els['dolar-usa'].textContent);
run("localStorage.removeItem('dolarManual'); _cachedDolar = 1555;");

console.log('\n7) Si se cae la API no se rompe ni miente');
FALLA = true;
d = await get('dolarDetalle(true)');
ok(d && d.compra === 1525, 'se queda con lo último que sabía en vez de mostrar vacío', d);
await get('pintarDolarBar(true)');
ok(els['dolar-compra'].textContent === '$1.525', 'y la barra sigue mostrando algo útil');
FALLA = false;
// Sin nada cacheado y sin internet
run('_dolarDet = null;');
FALLA = true;
await get('pintarDolarBar(true)');
ok(/sin conexión/.test(els['dolar-usa'].textContent), 'de cero y sin internet, lo dice', els['dolar-usa'].textContent);
FALLA = false;

console.log('\n8) Tocar la barra avisa con la hora');
run('_dolarDet = null;');
TOASTS.length = 0;
await get('refrescarDolarBar()');
ok(TOASTS.some(t => /actualizada/.test(t[1])), 'sale el aviso', TOASTS);
ok(TOASTS.some(t => /\d{2}:\d{2}/.test(t[1])), 'con la hora de la cotización', TOASTS);
ok(!els['dolar-bar'].classList.contains('dolar-bar--cargando'), 'y no queda en gris de "cargando"');

console.log('\n9) Está puesta en la caja');
const html = fs.readFileSync(DIR + 'caja.html', 'utf8');
ok(/id="dolar-bar"/.test(html), 'la barra está en caja.html');
ok(/onclick="refrescarDolarBar\(\)"/.test(html), 'y se actualiza al tocarla');
ok(html.indexOf('id="dolar-bar"') < html.indexOf('caja-quickbar'), 'arriba de los números del día');
ok(/Promise\.resolve\(typeof ensureDolar/.test(caja) && /pintarDolarBar\(\)/.test(caja),
   'se pinta recién cuando la app ya sabe con qué número convierte');
// Y si ensureDolar no está o no devuelve promesa, la caja tiene que abrir igual
ok(/typeof ensureDolar === 'function'/.test(caja), 'sin cotización, la caja abre lo mismo');
ok(/\.catch\(/.test(caja.slice(caja.indexOf('Promise.resolve(typeof ensureDolar'), caja.indexOf('Promise.resolve(typeof ensureDolar') + 400)), 'y un error no deja la pantalla en blanco');

console.log('\n10) No gasta cupo de Firebase');
// La cotización sale de una API pública. Si algún día alguien la mueve a
// Firestore, esto lo agarra.
const bloque = u.slice(u.indexOf('const _DOLAR_TTL_MS'));
ok(!/collection\(/.test(bloque), 'dolarDetalle no toca Firestore');
ok(/dolarapi\.com/.test(bloque), 'usa la API pública');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})();
