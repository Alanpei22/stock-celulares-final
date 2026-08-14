// Harness sin navegador para los datos del comprador en la venta de un equipo.
//
// El comprobante de venta no decía a quién se le vendió: ni nombre, ni DNI, ni
// teléfono. Para una hoja que el cliente firma y que después se usa para hacer
// valer la garantía, eso era el dato que faltaba.
//
// El modal de venta ni siquiera los pedía. Ahora sí, y son opcionales: las
// ventas viejas no tienen los campos y el comprobante les sale igual que antes.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
const leer = f => fs.readFileSync(DIR + f, 'utf8');

let fails = 0;
const ok = (c, l, x) => {
  console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x)));
  if (!c) fails++;
};

const html = leer('index.html');
const appjs = leer('app.js');

console.log('\n1) El modal de venta pide los datos');
['sell-cli-nombre', 'sell-cli-dni', 'sell-cli-tel'].forEach(id =>
  ok(html.includes(`id="${id}"`), `está el campo ${id}`));
ok(/salen en el comprobante/.test(html),
   'dice para qué sirven, si no nadie los llena');
// Opcionales: la venta no puede frenarse por esto.
// Ventana amplia: confirmSell es larga y el CRM se llama después del commit.
const cuerpoSell = appjs.slice(appjs.indexOf('async function confirmSell'),
                               appjs.indexOf('async function confirmSell') + 6000);
ok(!/toast\([^)]*comprador/i.test(cuerpoSell),
   'no son obligatorios: la venta sigue sin ellos');

console.log('\n2) Se limpian al abrir el modal');
// Si no, la próxima venta arrastra al cliente anterior y sale un comprobante
// a nombre de otra persona. Eso es peor que no tener el dato.
const cuerpoOpen = appjs.slice(appjs.indexOf('function openSellModal'),
                               appjs.indexOf('async function confirmSell'));
['sell-cli-nombre', 'sell-cli-dni', 'sell-cli-tel'].forEach(id =>
  ok(cuerpoOpen.includes(id), `openSellModal limpia ${id}`));

console.log('\n3) Se guardan, y solo si se cargaron');
['clienteNombre', 'clienteDni', 'clienteTel'].forEach(f =>
  ok(cuerpoSell.includes(f), `confirmSell guarda ${f}`));
ok(/if \(cliNombre\) stockUpdate\.clienteNombre/.test(cuerpoSell),
   'campos nuevos y condicionales: no escribe vacíos sobre lo que ya está');
ok(/upsertCliente\(/.test(cuerpoSell),
   'el comprador va al CRM, igual que en la venta desde la caja');
ok(/upsertCliente[\s\S]{0,160}catch/.test(cuerpoSell),
   'y si el CRM falla, la venta ya quedó registrada igual');

console.log('\n4) El comprobante');
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
  vm.runInContext(leer(f), ctx, { filename: f });
}
vm.runInContext('_openPrint = (h, t) => { __HTML = h; }', ctx);

const EQ = {
  id: 's1', marca: 'Samsung', modelo: 'Galaxy S21', estado: 'Muy bueno',
  almacenamiento: '256 GB', ram: '8 GB', bateria: 89, color: 'Negro',
  imei: '356789102345678', notas: 'Incluye cargador original',
  precio: 520000, forma_pago: 'Efectivo', garantiaMeses: 6, vendedor: 'Alan',
  fecha_venta: '2026-08-14T15:00:00.000Z',
  clienteNombre: 'Marina Gómez', clienteDni: '32456789', clienteTel: '1155667788',
};
ctx.__EQ = EQ;
vm.runInContext("printVentaTicket('s1', __EQ, 'A5')", ctx);
const con = ctx.__HTML;

ok(/Comprador/.test(con), 'el comprobante tiene el recuadro del comprador');
ok(con.includes('Marina Gómez'), 'con el nombre');
ok(con.includes('32456789'), 'el DNI');
ok(con.includes('1155667788'), 'y el teléfono');
// El comprador va ANTES del equipo: primero a quién, después qué.
ok(con.indexOf('Comprador') < con.indexOf('>Equipo<'),
   'el comprador va antes del equipo');
// Aclaración debajo de la firma: es lo que hace valer la hoja firmada.
ok(/vfir-n">Marina Gómez · DNI 32456789/.test(con),
   'y la aclaración va debajo de la línea de firma');
// El equipo sigue completo
['Muy bueno', '256 GB', '8 GB', '89%', 'Negro', '356789102345678', 'Incluye cargador original']
  .forEach(v => ok(con.includes(v), `el equipo sigue mostrando "${v}"`));
// Sale original + copia: los dos con los datos.
ok((con.match(/Marina Gómez/g) || []).length >= 2,
   'los datos salen en el original Y en la copia del negocio');
// El costo del negocio NUNCA va en la hoja del cliente.
ok(!con.includes('costo') && !/Costo/.test(con), 'el costo no se imprime');

console.log('\n5) Las ventas viejas no se rompen');
const VIEJA = Object.assign({}, EQ);
delete VIEJA.clienteNombre; delete VIEJA.clienteDni; delete VIEJA.clienteTel;
ctx.__EQ2 = VIEJA;
vm.runInContext("printVentaTicket('s2', __EQ2, 'A5')", ctx);
const vieja = ctx.__HTML;
ok(!/Comprador/.test(vieja), 'sin datos no aparece el recuadro vacío');
// Ojo: `.vfir-n` está en el CSS de TODO comprobante. Hay que buscar el marcado.
ok(!/class="vfir-n"/.test(vieja), 'ni la aclaración debajo de la firma');
ok(vieja.includes('Galaxy S21') && vieja.includes('520.000'),
   'y el resto del comprobante sale igual que siempre');

// Con solo el nombre (lo más común: te lo dicen y no sacan el DNI)
const PARCIAL = Object.assign({}, VIEJA, { clienteNombre: 'Marina Gómez' });
ctx.__EQ3 = PARCIAL;
vm.runInContext("printVentaTicket('s3', __EQ3, 'A5')", ctx);
const parcial = ctx.__HTML;
ok(/Comprador/.test(parcial) && parcial.includes('Marina Gómez'), 'con solo el nombre alcanza');
ok(!/DNI/.test(parcial.slice(parcial.indexOf('Comprador'), parcial.indexOf('>Equipo<'))),
   'y no inventa un renglón de DNI vacío');

console.log('\n6) El autocompletado por teléfono');
const clientes = leer('clientes.js');
ok(/function _sellTelAutocomplete/.test(clientes), 'existe para la venta');
ok(/function _repTelAutocomplete/.test(clientes), 'y sigue el de reparaciones');
ok(/function _telAutocomplete\(tlf, ids\)/.test(clientes),
   'los dos comparten la misma lógica, no está duplicada');
ok(/onblur="_sellTelAutocomplete\(this\.value\)"/.test(html),
   'el campo de teléfono lo dispara');

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
