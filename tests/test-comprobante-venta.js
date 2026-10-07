// Comprobante de venta (ticket 58mm, no fiscal) — comprobante-venta.js
//
// Lo que se cuida: que el número no se repita ni se gaste de más (una venta
// sin comprobante no consume número; reimprimir no cambia el que tenía), que
// diga "no válido como factura", y que el total y los pagos sean los de la venta.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

(async () => {
// ── Firestore de mentira, con transacciones ──
const DOCS = { 'config/ventasMeta': null, 'caja_movimientos/m1': { monto: 1 }, 'caja_movimientos/m2': { monto: 1 } };
const ref = (col, id) => ({ k: col + '/' + id });
const db = {
  collection: col => ({ doc: id => ref(col, id) }),
  runTransaction: async fn => fn({
    get: async r => ({ exists: !!DOCS[r.k], data: () => DOCS[r.k] || {} }),
    set: (r, v) => { DOCS[r.k] = Object.assign({}, DOCS[r.k], v); },
    update: (r, v) => { DOCS[r.k] = Object.assign({}, DOCS[r.k], v); },
  }),
};
const IMPRESO = [], ABIERTO = [];
let TEL = '';
const ctx = {
  console, Math, Number, String, Array, Object, JSON, Date, Promise, encodeURIComponent,
  db, toast: () => {}, prompt: () => TEL, MOVIMIENTOS: [],
  BIZ_DATA: { dir: 'Urquiza 4741', tel: '11 7239-2511', extra: 'Cambios dentro de los 7 días' },
  window: { _DAKI_NAME: 'TechPoint', open: () => ({ location: {}, close() {} }) },
  document: { getElementById: () => null, createElement: () => ({ style: {}, querySelector: () => ({}) }), body: { appendChild() {} } },
  location: {},
  _imprimirDirecto: async (tipo, html) => { IMPRESO.push({ tipo, html }); return true; },
  _imprimirEnIframe: async () => {},
  setTimeout: () => 0, clearTimeout: () => {},
};
ctx.window.open = () => { const w = { location: {}, close() {} }; ABIERTO.push(w); return w; };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'comprobante-venta.js', 'utf8'), ctx, { filename: 'comprobante-venta.js' });
const run = c => vm.runInContext(c, ctx);

console.log('\n1) Numeración');
ok(await run("_cvNumero('m1')") === '000001', 'la primera venta con comprobante es la 000001');
ok(await run("_cvNumero('m1')") === '000001', 'reimprimir la misma venta no gasta otro número');
ok(await run("_cvNumero('m2')") === '000002', 'la siguiente sigue en 000002');
ok(DOCS['config/ventasMeta'].nextComprobante === 3 && DOCS['caja_movimientos/m2'].comprobanteNro === '000002',
   'el contador y el número quedan guardados', DOCS);

console.log('\n2) Lo que dice el ticket');
ctx._m = { monto: 21000, metodoPago: 'Efectivo', metodoPago2: 'Transferencia', monto2: 5000, vendedor: 'Alan',
  clienteNombre: 'Juan', createdAt: '2026-10-06T15:30:00.000Z',
  items: [{ nombre: 'Funda A15', qty: 2, precioUnit: 8000 }, { nombre: 'Vidrio <templado>', qty: 1, precioUnit: 5000 }] };
const t = run("ticketVentaHtml(_m, '000007')");
ok(/COMPROBANTE DE VENTA<br>N° 000007/.test(t), 'número');
ok(/DOCUMENTO NO VÁLIDO COMO FACTURA/.test(t), 'dice que no es factura');
ok(/Funda A15/.test(t) && /\$16\.000/.test(t) && /2 x \$8\.000/.test(t), 'renglón con cantidad: 2 x $8.000 = $16.000');
ok(/Vidrio &lt;templado&gt;/.test(t), 'los nombres van escapados');
ok(/TOTAL<\/span><span>\$21\.000/.test(t), 'total');
ok(/Efectivo<\/span><span>\$16\.000/.test(t) && /Transferencia<\/span><span>\$5\.000/.test(t), 'pago dividido: cuánto en cada método');
ok(/Atendió: Alan/.test(t) && /Cliente: Juan/.test(t), 'vendedor y cliente');
ok(/Urquiza 4741/.test(t) && /Cambios dentro de los 7 días/.test(t), 'dirección y el texto propio del negocio (Configuración)');
ok(/12:30/.test(t), 'hora de Argentina (15:30 UTC → 12:30)');
ok(/size:58mm '\+h\+'mm/.test(t), 'el papel mide lo que mide el ticket (rollo continuo)');
ctx._s = { monto: 3000, descripcion: 'Cambio de pin de carga', metodoPago: 'MercadoPago' };
ok(/Cambio de pin de carga<\/span><span>\$3\.000/.test(run("ticketVentaHtml(_s, '1')")), 'una venta cargada a mano sale como un renglón');
ctx._r = { monto: 30000, montoReparacion: 25000, repairNOrden: 7501, metodoPago: 'Efectivo', items: [{ nombre: 'Vidrio', qty: 1, precioUnit: 5000 }] };
ok(/Reparación N°7501<\/span><span>\$25\.000/.test(run("ticketVentaHtml(_r, '1')")), 'venta mixta: la reparación también tiene su renglón');

console.log('\n3) Imprimir y WhatsApp');
IMPRESO.length = 0;
await run("imprimirComprobanteVenta('m1', _m)");
ok(IMPRESO.length === 1 && IMPRESO[0].tipo === 'ticket' && /N° 000001/.test(IMPRESO[0].html), 'va a la impresora de tickets, con su número');
TEL = '11 5555-1234';
await run("whatsappComprobanteVenta('m2', _m)");
const url = ABIERTO.pop().location.href || '';
ok(/^https:\/\/wa\.me\/5491155551234\?text=/.test(url), 'WhatsApp al número que se cargó, con 549 adelante', url);
ok(/N%C2%B0%20000002/.test(url) && /no%20v%C3%A1lido%20como%20factura/.test(url), 'con el número y la leyenda');

console.log('\n3b) En la PC (app de escritorio): el ticket va como imagen para pegar');
const WA = [];
ctx.waAppActiva = () => true;
ctx.waAbrir = u => WA.push(u);
ctx._cvCopiarImagen = async () => true;
TEL = '1155551234';
await run("whatsappComprobanteVenta('m1', _m)");
let txt = decodeURIComponent((WA.pop() || '').split('text=')[1] || '');
ok(/Te mando el comprobante de tu compra \(N° 000001\)/.test(txt) && !/TOTAL|Funda/.test(txt),
   'con la imagen copiada, el mensaje es corto (el detalle va en la imagen)', txt);
ok(ABIERTO.length === 0, 'sin abrir pestañas');
ctx._cvCopiarImagen = async () => false;
await run("whatsappComprobanteVenta('m1', _m)");
txt = decodeURIComponent((WA.pop() || '').split('text=')[1] || '');
ok(/Funda A15/.test(txt) && /no válido como factura/.test(txt), 'si no se pudo copiar la imagen, va el comprobante en texto como antes', txt);
const cv = fs.readFileSync(DIR + 'comprobante-venta.js', 'utf8');
ok(cv.indexOf('await _cvCopiarImagen(mov, nro)') < cv.indexOf("waAbrir('https://wa.me/' + tel"), 'la imagen se copia ANTES de abrir WhatsApp (después Chrome no deja)');
ctx.waAppActiva = () => false;

console.log('\n4) Enganchado');
const caja = fs.readFileSync(DIR + 'caja.js', 'utf8');
ok(/if \(data\.tipo === 'ingreso' && typeof ofrecerComprobanteVenta === 'function'\)/.test(caja), 'después de cobrar una venta se pregunta (los gastos no)');
const html = fs.readFileSync(DIR + 'caja.html', 'utf8');
ok(html.indexOf('src="comprobante-venta.js"') > html.indexOf('src="qz-print.js"'), 'caja.html lo carga después de la impresión directa');
ok(/id="mov-comprobante-btn"/.test(html), 'y se puede pedir de nuevo desde la venta guardada');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
