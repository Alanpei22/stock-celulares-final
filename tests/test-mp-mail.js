// Prueba del filtro de mails de MercadoPago (la parte frágil del script de Gmail).
const fs = require('fs'), vm = require('vm');
const SRC = fs.readFileSync(require('path').join(__dirname, '..', 'tools', 'gmail-aviso-mp.gs'), 'utf8');

const ctx = { Logger: { log: () => {} }, GmailApp: {}, UrlFetchApp: {}, JSON, String };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx, { filename: 'gmail-aviso-mp.gs' });
const leer = (a, c = '') => vm.runInContext('leerTransferencia', ctx)(a, c);

let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

console.log('\n1) Mails que SÍ son plata que entra');
const entran = [
  ['Juan Pérez te transfirió $ 25.000', '', '$25.000', 'Juan Pérez'],
  ['María González te transfirió dinero', 'María González te transfirió $ 10.500,50 a tu cuenta', '$10.500,50', 'María González'],
  ['Recibiste $ 8.000', 'Ya tenés el dinero disponible en tu cuenta.', '$8.000', ''],
  ['Te transfirieron $ 120.000', 'Se acreditó en tu cuenta de Mercado Pago', '$120.000', ''],
  ['Carlos A. Ruiz te envió $ 3.400', '', '$3.400', 'Carlos A. Ruiz'],
];
for (const [asunto, cuerpo, montoEsp, quienEsp] of entran) {
  const r = leer(asunto, cuerpo);
  ok(!!r, `detecta: "${asunto}"`, r);
  if (r) {
    ok(r.monto === montoEsp, `  monto ${montoEsp}`, r.monto);
    if (quienEsp) ok(r.quien === quienEsp, `  remitente ${quienEsp}`, r.quien);
  }
}

console.log('\n2) Mails que NO tienen que avisar');
const noEntran = [
  ['Tu resumen de cuenta de julio', 'Mirá todos tus movimientos del mes'],
  ['Pago rechazado', 'No pudimos procesar el pago'],
  ['Vencimiento de tu tarjeta', 'Tu tarjeta vence pronto'],
  ['Promociones de la semana', '50% de descuento en...'],
  ['Tu factura está disponible', 'Descargá tu factura'],
  ['Mercado Pago: novedades', 'Conocé las nuevas funciones'],
  ['Se acreditó tu inversión', 'Rendimiento del día'],
];
for (const [asunto, cuerpo] of noEntran) {
  ok(leer(asunto, cuerpo) === null, `ignora: "${asunto}"`, leer(asunto, cuerpo));
}

console.log('\n3) Casos borde');
ok(leer('Te transfirieron dinero', 'Sin monto en el texto').monto === '',
   'si no encuentra el monto igual avisa (mejor avisar sin monto que no avisar)');
const r2 = leer('Juan te transfirió $ 25.000', 'Juan te transfirió $ 25.000 el 03/08');
ok(r2 && r2.monto === '$25.000', 'toma el primer monto que aparece', r2 && r2.monto);

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
