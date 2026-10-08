// Foto del ticket en los gastos (ticket-gasto.js + acción leerTicket de api/ai.js).
//
// Lo que se cuida:
//  · que la IA lea bien los montos argentinos y no invente: si no lee, null;
//  · que lo leído complete el gasto SIN pisar lo que ya se escribió;
//  · que si no se puede leer, la foto quede adjunta igual;
//  · que la foto vaya en su propia colección y el movimiento guarde solo el id.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

(async () => {
console.log('\n1) Lo que devuelve la IA → ticket');
const api = leer('api/ai.js');
const fn = api.slice(api.indexOf('export function parsearTicket')).replace('export function', 'function');
const pctx = {}; vm.createContext(pctx); vm.runInContext(fn + '\nthis.parsearTicket = parsearTicket;', pctx);
const P = pctx.parsearTicket;
let t = P('Acá va: {"legible":true,"proveedor":"Mayorista Cel","fecha":"2026-10-08","items":[{"nombre":"Pantalla A13","cantidad":2,"precio":"$ 45.000,50"},{"nombre":"Batería G32","cantidad":1,"precio":12000}],"total":"102.000","rubro":"Compra repuesto"}');
ok(t && t.proveedor === 'Mayorista Cel' && t.items.length === 2, 'lee proveedor e items', t);
ok(t.items[0].precio === 45000.5 && t.items[0].cantidad === 2, 'monto con punto de miles y coma decimal', t.items[0]);
ok(t.total === 102000, '"102.000" son cien mil, no ciento dos', t.total);
ok(t.rubro === 'Compra repuesto' && t.fecha === '2026-10-08', 'rubro y fecha');
ok(P('{"legible":false,"items":[],"total":0}') === null, 'ilegible → null (queda solo la foto)');
ok(P('no es json') === null && P('{roto') === null, 'basura → null');
t = P('{"items":[{"nombre":"Cable","precio":1500},{"nombre":"Funda","precio":2500}],"total":0}');
ok(t.total === 4000, 'sin total, suma los items', t.total);
ok(/action === 'leerTicket'/.test(api) && /corteSiNoAutorizadoEdge\(req\)/.test(api), 'la acción vive detrás de la sesión, como el resto de /api/ai');
ok(/stop_reason === 'refusal'/.test(api), 'si el modelo se niega, no se completa nada');

console.log('\n2) En la caja');
const els = {};
const el = id => els[id] || (els[id] = { id, value: '', textContent: '', innerHTML: '', style: {}, classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } }, click() {} });
const ADDS = [], TOASTS = [];
let RESP = null;
const ctx = {
  console, Math, Number, String, Array, Object, JSON, Promise, Date, Error, parseFloat,
  document: { getElementById: el, createElement: () => ({}), body: { appendChild() {} } },
  toast: (m, k) => TOASTS.push([k, m]),
  esc: s => String(s),
  CATEGORIAS: { egreso: ['Compra repuesto', 'Gasto fijo', 'Retiro dueño', 'Otro gasto'] },
  selectCat: c => { el('mov-hidden-cat').value = c; },
  _updateMovResumen: () => {},
  apiFetch: async (url, o) => { ctx._ultimoPedido = JSON.parse(o.body); return RESP; },
  db: { collection: c => ({ add: async d => { ADDS.push([c, d]); return { id: 'tk1' }; } }) },
};
vm.createContext(ctx);
vm.runInContext(leer('ticket-gasto.js'), ctx);
vm.runInContext('_tkComprimir = async () => "data:image/jpeg;base64,QUJD"', ctx);
const run = c => vm.runInContext(c, ctx);

run('tkMostrarSegunTipo("ingreso")');
ok(el('mov-tk-wrap').style.display === 'none', 'en una venta no aparece');
run('tkMostrarSegunTipo("egreso")');
ok(el('mov-tk-wrap').style.display === '', 'en un gasto sí');

run('tkReset(null)');
RESP = { ok: true, json: async () => ({ ticket: { proveedor: 'Mayorista', items: [{ nombre: 'Pantalla A13', cantidad: 2, precio: 90000 }], total: 90000, rubro: 'Compra repuesto' } }) };
await run('tkFotoElegida({ files: [{}] })');
ok(ctx._ultimoPedido.action === 'leerTicket' && ctx._ultimoPedido.data.imageBase64 === 'QUJD', 'manda la foto (sin el encabezado data:) a leerTicket');
ok(ctx._ultimoPedido.data.rubros.includes('Compra repuesto'), 'con los rubros de gasto para elegir');
ok(el('mov-fi-monto').value === 90000, 'completa el monto', el('mov-fi-monto').value);
ok(el('mov-fi-desc').value === 'Mayorista: 2× Pantalla A13', 'y la descripción', el('mov-fi-desc').value);
ok(el('mov-hidden-cat').value === 'Compra repuesto', 'y el rubro');
let campos = await run('tkCamposParaGuardar("egreso")');
ok(ADDS.length === 1 && ADDS[0][0] === 'caja_tickets' && /^data:image\/jpeg/.test(ADDS[0][1].foto), 'la foto va a caja_tickets, aparte del movimiento');
ok(campos.ticketFotoId === 'tk1' && campos.ticketItems.length === 1 && campos.ticketProveedor === 'Mayorista', 'el movimiento guarda el id y lo leído', campos);

console.log('\n3) No pisa lo escrito, y si no lee queda la foto');
run('tkReset(null)'); ADDS.length = 0;
el('mov-fi-monto').value = '5000'; el('mov-fi-desc').value = 'Repuestos varios'; el('mov-hidden-cat').value = 'Otro gasto';
await run('tkFotoElegida({ files: [{}] })');
ok(el('mov-fi-monto').value === '5000' && el('mov-fi-desc').value === 'Repuestos varios' && el('mov-hidden-cat').value === 'Otro gasto', 'lo que ya se cargó a mano se respeta');
run('tkReset(null)'); ADDS.length = 0; TOASTS.length = 0;
RESP = { ok: false, json: async () => ({ error: 'x' }) };
await run('tkFotoElegida({ files: [{}] })');
ok(TOASTS.some(x => /queda la foto adjunta/.test(x[1])), 'avisa que no se pudo leer');
campos = await run('tkCamposParaGuardar("egreso")');
ok(campos.ticketFotoId === 'tk1' && !campos.ticketItems, 'y la foto se guarda igual, sin items inventados', campos);
ctx.apiFetch = async () => { throw new Error('sin internet'); };
run('tkReset(null)');
await run('tkFotoElegida({ files: [{}] })');
ok((await run('tkCamposParaGuardar("egreso")')).ticketFotoId === 'tk1', 'sin internet también queda la foto');
run('tkReset(null)');
ok(Object.keys(await run('tkCamposParaGuardar("egreso")')).length === 0, 'sin foto no agrega nada');

console.log('\n4) En la compu, la webcam; en el celular, la cámara del input');
let CLICK = 0, ABRIO = 0;
el('mov-tk-input').click = () => CLICK++;
vm.runInContext('_tkAbrirWebcam = () => { _abrio(); }', ctx);
ctx._abrio = () => ABRIO++;
ctx.navigator = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', mediaDevices: { getUserMedia() {} } };
run('tkSacarFoto()');
ok(ABRIO === 1 && CLICK === 0, 'compu con cámara → abre la webcam, no el explorador de archivos');
ctx.navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile', mediaDevices: { getUserMedia() {} } };
run('tkSacarFoto()');
ok(ABRIO === 1 && CLICK === 1, 'celular → el input con capture (abre la cámara nativa)');
ctx.navigator = { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' };
run('tkSacarFoto()');
ok(ABRIO === 1 && CLICK === 2, 'compu sin getUserMedia → elegir archivo');
const tg = leer('ticket-gasto.js');
ok(/getTracks\(\)\.forEach\(t => t\.stop\(\)\)/.test(tg), 'al cerrar se apaga la cámara (no queda la lucecita prendida)');
ok(/tk-cam-archivo/.test(tg) && /NotAllowed/.test(tg), 'sin permiso o sin cámara, explica y deja elegir un archivo');

console.log('\n5) Enganchado en la caja');
const cj = leer('caja.js'), html = leer('caja.html');
ok(/tkCamposParaGuardar\(tipo\)/.test(cj.slice(cj.indexOf('async function saveMov'))), 'saveMov adjunta la foto');
ok(/tkMostrarSegunTipo\(tipo\)/.test(cj) && (cj.match(/tkReset\(/g) || []).length >= 2, 'se muestra en egresos y se limpia al abrir');
ok(/tkVer\('\$\{esc\(m\.ticketFotoId\)\}'\)/.test(cj), 'en la lista, 🧾 abre la foto');
ok(/capture="environment"/.test(html) && html.indexOf('src="ticket-gasto.js"') > html.indexOf('src="caja.js"'), 'caja.html: cámara trasera y el script cargado');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
