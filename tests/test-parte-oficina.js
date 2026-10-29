// ✅ El parte de las 10:30 por Telegram (cron-resumen-telegram, { oficina: true }).
//
// Antes era un parte largo firmado por personajes, con una "idea" de la IA
// arriba; Alan dijo que no le servía. Ahora: SOLO lo urgente, y si no hay
// nada, no se manda. Además anota solo en el pedido lo que se terminó.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const src = fs.readFileSync(DIR + 'api/cron-resumen-telegram.js', 'utf8');
const trozo = src.slice(src.indexOf('export function hoyAR'), src.indexOf('export default')).replace(/export /g, '');
const ctx = { console, Date, Math, Number, String, Array, Object, JSON, Set };
vm.createContext(ctx);
vm.runInContext(trozo + '\nthis.armar = armarParteOficina; this.texto = textoParteOficina; this.terminados = terminadosSinPedir;', ctx);

const AHORA = Date.parse('2026-10-27T10:30:00-03:00');
const h = n => new Date(AHORA - n * 3600e3).toISOString();
console.log('\n1) Lo urgente');
const p = ctx.armar({ ahora: AHORA, cierreAyer: false, anotados: ['Batería iPhone 11'],
  repairs: [
    { nOrden: 8398, marca: 'iPhone', modelo: '11', estado: 'listo', nombre: 'Juan Pérez', fechaIngreso: h(24 * 20), fechaListo: h(24 * 10) },
    { nOrden: 8399, estado: 'listo', fechaIngreso: h(24 * 4), fechaListo: h(24 * 3) },
    { nOrden: 5191, estado: 'listo', fechaIngreso: h(24 * 945) },
  ],
  equipos: [{ marca: 'Samsung', modelo: 'A15', almacenamiento: '128GB', fecha: h(24 * 100) }, { marca: 'Moto', modelo: 'E13', fecha: h(24 * 60) }, { marca: 'X', fecha: h(24 * 200), reservado: true }] });
ok(p.caja[0] === 'ayer la caja no se cerró', 'la caja de ayer sin cerrar');
ok(p.taller.length === 1 && /Juan no retiró su iPhone 11 \(#8398\): listo hace 10 días/.test(p.taller[0]), 'listos sin retirar hace 7+ días (ni los recientes, ni los de hace años, sin apellido)', p.taller);
ok(/anoté en el pedido: Batería iPhone 11/.test(p.stock[0]), 'te cuenta lo que anotó solo en el pedido');
ok(p.ventas.length === 1 && /A15 128GB: 100 días/.test(p.ventas[0]), 'equipos parados 90+ días (no los reservados)', p.ventas);

let pc = ctx.armar({ ahora: AHORA, certVto: new Date(AHORA + 20 * 864e5).toISOString() });
ok(/certificado vence en 20 días/.test(pc.arca[0]), 'certificado de ARCA a 20 días de vencer: avisa');
pc = ctx.armar({ ahora: AHORA, certVto: new Date(AHORA + 200 * 864e5).toISOString() });
ok(!pc.arca.length, 'a 200 días: nada');
pc = ctx.armar({ ahora: AHORA, certVto: new Date(AHORA - 864e5).toISOString() });
ok(/VENCIÓ/.test(pc.arca[0]), 'vencido: lo dice bien claro');
ok(/<b>🧾 Facturación \(ARCA\)<\/b>/.test(ctx.texto(pc, '2026-10-27')), 'y sale primero en el Telegram');

console.log('\n2) El mensaje');
let t = ctx.texto(p, '2026-10-27');
ok(/✅ <b>Para hacer hoy — 27\/10\/2026<\/b>/.test(t) && /<b>💵 Caja<\/b>/.test(t) && /<b>📱 Para retirar<\/b>/.test(t), 'título y temas');
ok(!/Tito|Rosa|Beto|Para arrancar/.test(t), 'sin personajes ni IA');
ok(ctx.texto({ arca: [], caja: [], taller: [], stock: [], ventas: [] }, '2026-10-27') === null, 'si no hay nada urgente, no se manda nada');
t = ctx.texto({ taller: ['<b>raro</b> & cosa'] }, '2026-10-27');
ok(/&lt;b&gt;raro/.test(t), 'lo escrito por clientes no rompe el HTML de Telegram');

console.log('\n3) Lo que se terminó va solo al pedido');
const tm = ctx.terminados({
  repuestos: [{ id: 'r1', tipo: 'Batería', marca: 'iPhone', modelo: '11', cantidad: 0, stockMin: 2 }, { id: 'r2', tipo: 'Pin', cantidad: 0, stockMin: 3 },
    { id: 'r3', tipo: 'Flex', cantidad: 9, stockMin: 2 }, { id: 'r4', tipo: 'Viejo', cantidad: 0 }],
  productos: [{ id: 'p1', nombre: 'Cargador 20W', stock: -1, stockMin: 1 }],
  pedidos: [{ itemId: 'r2', comprado: false }] });
ok(tm.map(x => x.id).join() === 'r1,p1', 'se terminó y tiene mínimo; no lo que ya está pedido ni lo que no se trabaja', tm);
ok(tm[0].nombre === 'Batería iPhone 11' && tm[0].cantidad === 4 && tm[0].categoria === 'Batería', 'nombre, cantidad (2 × el mínimo) y categoría', tm[0]);
ok(/doc\('auto_' \+ t\.id\)/.test(src), 'mismo id que la app (auto_<id>): no se duplica');
ok(!/api\.anthropic\.com/.test(src), 'ya no llama a la IA (era lento y no aportaba)');
const wf = fs.readFileSync(DIR + '.github/workflows/resumen-telegram.yml', 'utf8');
ok(/cron: '30 13 \* \* \*'/.test(wf) && /\{"oficina":true\}/.test(wf), 'GitHub lo dispara a las 10:30 AR');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
