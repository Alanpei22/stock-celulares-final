// Comprobante de venta en A5 (original + copia) y recepción sin A4/tickets.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const ctx = {
  console, TextEncoder, crypto: require('crypto').webcrypto,
  btoa: s => Buffer.from(s, 'binary').toString('base64'), unescape, encodeURIComponent,
  location: { origin: 'https://x' }, window: { _DAKI_NAME: 'TechPoint' },
  document: { getElementById: () => null, addEventListener: () => {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  BIZ_DATA: { dir: 'Urquiza 4741', tel: '11 7239-2511', extra: 'Lun a Sáb 9 a 19' },
  toast: () => {}, esc: s => String(s == null ? '' : s), alert: m => { ctx.__ALERT = m; },
  getConfig: () => ({ telefonoNegocio: '1172392511' }), STOCK: [],
};
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['qr.js', 'tp-fases.js', 'seguimiento.js', 'print.js']) {
  vm.runInContext(fs.readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
}
vm.runInContext('_openPrint = (html, t) => { __HTML = html; __TIT = t; }', ctx);

const EQ = { id: 's1', marca: 'Samsung', modelo: 'Galaxy S21', estado: 'Muy bueno', almacenamiento: '256 GB',
             ram: '12 GB', bateria: 89, color: 'Negro', imei: '356789102345678', notas: 'Incluye cargador',
             precio: 520000, forma_pago: 'Efectivo', garantiaMeses: 6, vendedor: 'Alan',
             fecha_venta: '2026-08-03T15:00:00.000Z' };

console.log('\n1) Venta en A5: original y copia');
ctx.__EQ = EQ;
vm.runInContext("printVentaTicket('s1', __EQ, 'A5')", ctx);
const a5 = ctx.__HTML;
ok((a5.match(/class="tk"/g) || []).length === 2, 'salen DOS hojas', (a5.match(/class="tk"/g) || []).length);
ok(/Original · cliente/.test(a5), 'una dice "Original · cliente"');
ok(/Copia · negocio/.test(a5), 'la otra dice "Copia · negocio"');
ok(/@page\{size:A5 portrait/.test(a5), 'tamaño A5');
ok(/\.tk \+ \.tk\{page-break-before:always\}/.test(a5), 'el corte va entre las dos hojas, no después de la última');
ok(/192\*MM/.test(a5), 'trae el auto-ajuste para que cada hoja entre en una página');
ok(/style\.zoom/.test(a5) && !/transform\s*=\s*'scale/.test(a5), 'el ajuste usa zoom, no transform');

console.log('\n2) Contenido del comprobante');
ok(/Samsung/.test(a5) && /Galaxy S21/.test(a5), 'equipo');
ok(/356789102345678/.test(a5), 'IMEI completo (es el comprobante del dueño, no el QR público)');
ok(/520\.000/.test(a5), 'precio');
ok(/GARANTÍA 6 MESES/.test(a5), 'garantía');
ok(/Firma del vendedor/.test(a5) && /Firma y aclaración del comprador/.test(a5), 'las dos firmas');
ok(/Condiciones de la venta/i.test(a5), 'condiciones');
ok(/Ley 24\.240/.test(a5), 'cita la ley de defensa del consumidor');
ok(/<svg/.test(a5), 'QR de WhatsApp generado en la app');
// Se descuentan el link de WhatsApp (va dentro del QR, no se descarga) y el
// xmlns del SVG, que es un identificador y no una dirección que se visite.
const limpio = a5.replace(/https:\/\/wa\.me[^"'<]*/g, '').replace(/http:\/\/www\.w3\.org[^"']*/g, '');
ok(!/api\.qrserver|gstatic|https?:\/\//.test(limpio), 'no descarga nada de internet para imprimir',
   (limpio.match(/https?:\/\/[^"'\s<]*/g) || []).slice(0, 3));
const sinGar = { ...EQ, garantiaMeses: 0 };
ctx.__EQ = sinGar;
vm.runInContext("printVentaTicket('s2', __EQ, 'A5')", ctx);
ok(/VENTA SIN GARANTÍA/.test(ctx.__HTML), 'si no hay garantía lo dice claro');

console.log('\n3) El ticket de 80mm sigue disponible');
ctx.__EQ = EQ;
vm.runInContext("printVentaTicket('s1', __EQ, '80mm')", ctx);
ok(/ORIGINAL — Cliente/.test(ctx.__HTML) && /COPIA — Negocio/.test(ctx.__HTML), '80mm sigue con original y copia');
ok(!/class="tk"/.test(ctx.__HTML), 'y es el formato viejo, no el A5');

console.log('\n4) Recepción: solo A5');
const printJs = fs.readFileSync(DIR + 'print.js', 'utf8');
const indexHtml = fs.readFileSync(DIR + 'index.html', 'utf8');
ok(!/printRepair\('A4'\)/.test(indexHtml), 'no queda el botón A4 de recepción');
ok(!/printRepair\('80mm'\)/.test(indexHtml), 'no queda el botón 80mm de recepción');
ok(!/printRepairTermica\(\)/.test(indexHtml), 'no queda el botón BT 58mm de recepción');
ok(/printRepair\('A5'\)/.test(indexHtml), 'sí queda el A5');
ok(!/printPromptFmt\('A4'\)|printPromptFmt\('80mm'\)/.test(indexHtml), 'el cartel de después de cargar tampoco los ofrece');
const cuerpoPrintRepair = printJs.slice(printJs.indexOf('function printRepair'), printJs.indexOf('function printDelivery'));
ok(/_buildA5/.test(cuerpoPrintRepair) && !/_buildA4|_build80mm/.test(cuerpoPrintRepair),
   'printRepair imprime A5 aunque le pidan otra cosa');

console.log('\n5) Entrega: se saca el bloque, se usa la misma hoja de recepción');
ok(!/printDelivery\(/.test(indexHtml), 'no quedan botones de entrega');
ok(!/printDeliveryTermica\(/.test(indexHtml), 'tampoco el BT de entrega');
ok(!/rep-print-block--out/.test(indexHtml), 'se fue el bloque entero de entrega');
ok(/ingreso y entrega/i.test(indexHtml), 'el título aclara que la hoja sirve para las dos cosas');

// Lo importante: que el A5 de recepción de verdad traiga el recuadro de entrega
const ctx2 = vm.createContext(Object.assign({}, ctx));
ctx.__REP = { id: 'r1', nOrden: 7123, marca: 'Samsung', modelo: 'A54', arreglo: 'Módulo',
              monto: 85000, sena: 20000, nombre: 'Marina', tlf: '11', estado: 'reparando',
              fase: 'reparacion', fechaIngreso: '2026-08-01T10:00:00.000Z', diasGarantia: 90,
              tokenSeguimiento: 'k3n8x2p9qm4vb7ctd5ef' };
const a5rec = vm.runInContext('_buildA5(__REP)', ctx);
ok(/Entrega y garantía/.test(a5rec), 'el A5 de recepción trae el recuadro de ENTREGA');
ok(/a completar al retirar/.test(a5rec), 'dice que se completa al retirar');
ok(/Fecha de entrega/.test(a5rec) && /Saldo abonado/.test(a5rec), 'tiene fecha de entrega y saldo');
ok(/Firma del cliente/.test(a5rec), 'y la firma del cliente al retirar');
ok(/GARANTÍA 90 DÍAS/.test(a5rec), 'con la garantía y su vencimiento');

console.log('\n6) La boleta NO lleva la llave del teléfono');
// La hoja se la lleva el cliente y además queda dando vueltas por el mostrador.
// La clave y el patrón se ven en la ficha de la app, no impresos.
ctx.__REP2 = Object.assign({}, ctx.__REP, {
  codigo: '4821',
  patron: [0,1,2,5,8],
  patronImg: '<svg id="patron-de-prueba"></svg>',
});
const a5clave = vm.runInContext('_buildA5(__REP2)', ctx);
ok(!/4821/.test(a5clave),               'no se imprime la clave/PIN', '4821');
ok(!/patron-de-prueba/.test(a5clave),   'no se imprime el dibujo del patrón');
ok(!/Patrón de desbloqueo/.test(a5clave), 'no queda ni el recuadro del patrón');
ok(!/>Clave</.test(a5clave),            'no queda el renglón "Clave" del equipo');
// Que no se haya llevado puesto lo demás del equipo
ok(/356789102345678/.test(vm.runInContext(
     '_buildA5(Object.assign({}, __REP2, { imei: "356789102345678" }))', ctx)),
   'el IMEI sí se sigue imprimiendo');
// La condición legal sobre la clave es otra cosa: es texto del contrato, se queda.
ok(/clave o patrón se utiliza únicamente para diagnóstico/.test(a5clave),
   'la cláusula legal sobre la clave se mantiene');

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
