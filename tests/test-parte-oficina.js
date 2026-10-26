// 🏢 El parte de la oficina por Telegram (10:30, aunque nadie abra la app).
//
// Cada personaje firma lo suyo y arriba la IA dice por dónde arrancar. Lo
// que se cuida: que diga lo mismo que la oficina de la app (versión corta),
// que sin IA el parte salga igual, y que lo escrito por clientes no rompa
// el HTML de Telegram.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const src = fs.readFileSync(DIR + 'api/cron-resumen-telegram.js', 'utf8');
const trozo = src.slice(src.indexOf('export function hoyAR'), src.indexOf('export default')).replace(/export /g, '');
const ctx = { console, Date, Math, Number, String, Array, Object, JSON, Set };
vm.createContext(ctx);
vm.runInContext(trozo + '\nthis.armar = armarParteOficina; this.texto = textoParteOficina; this.pedido = pedidoIdeaIA;', ctx);

const AHORA = Date.parse('2026-10-27T10:30:00-03:00');
const h = n => new Date(AHORA - n * 3600e3).toISOString();
console.log('\n1) Lo que dice cada uno');
const p = ctx.armar({ ahora: AHORA,
  repairs: [
    { nOrden: 8350, marca: 'Moto', modelo: 'G32', estado: 'reparando', fechaIngreso: h(24 * 9), tecnico: 'Nacho' },
    { nOrden: 8370, estado: 'reparando', fechaIngreso: h(24) },
    { nOrden: 8398, marca: 'iPhone', modelo: '11', estado: 'listo', nombre: 'Juan Pérez', fechaIngreso: h(24 * 20), fechaListo: h(24 * 10) },
    { nOrden: 5191, estado: 'listo', fechaIngreso: h(24 * 945) },
    { nOrden: 8401, estado: 'entregado', tlf: '11', fechaIngreso: h(24 * 3), fechaEntrega: '2026-10-26T20:00:00.000Z' },
    { nOrden: 8402, estado: 'entregado', tlf: '11', fechaIngreso: h(24 * 3), fechaEntrega: '2026-10-27T12:00:00.000Z' },
  ],
  repuestos: [{ id: 'r1', tipo: 'Batería', marca: 'iPhone', modelo: '11', cantidad: 0, stockMin: 2 }, { id: 'r2', tipo: 'Pin', cantidad: 1, stockMin: 3 }, { id: 'r3', tipo: 'Flex', cantidad: 9, stockMin: 2 }],
  productos: [{ id: 'p1', nombre: 'Cargador 20W', stock: 1, stockMin: 2 }],
  pedidos: [{ itemId: 'r2', comprado: false }],
  equipos: [{ marca: 'Samsung', modelo: 'A15', almacenamiento: '128GB', fecha: h(24 * 60), publicar: true, fotos: [] }, { marca: 'Moto', modelo: 'E13', fecha: h(24 * 5) }],
  cierreAyer: false });
ok(p.tito.length === 2 && /#8350 Moto G32 lleva 9 días.*Nacho/.test(p.tito[0]) && /#8398 .* lista hace 10 días y Juan no/.test(p.tito[1]), 'Tito: demoradas y listas sin retirar (sin las de hace años, sin apellido)', p.tito);
ok(p.rosa.length === 2 && /Batería iPhone 11: se terminó/.test(p.rosa[0]) && /Cargador 20W: quedan 1/.test(p.rosa[1]), 'Rosa: bajo el mínimo, salvo lo que ya está en el pedido', p.rosa);
ok(p.beto[0] === 'ayer la caja no se cerró', 'Beto: la caja de ayer sin cerrar');
ok(p.lu.length === 2 && /A15 128GB lleva 60 días/.test(p.lu[0]) && /1 equipo está en la página sin fotos/.test(p.lu[1]), 'Lu: equipos quietos y sin fotos', p.lu);
ok(p.marta.length === 1 && /^1 cliente retiró ayer/.test(p.marta[0]), 'Marta: los que retiraron AYER (día argentino), para la reseña', p.marta);

console.log('\n2) El mensaje');
let t = ctx.texto(p, ['Llamá a Juan para que retire', 'Pedí baterías de iPhone 11'], '2026-10-27');
ok(/Buen día — el parte de la oficina 27\/10\/2026/.test(t) && /🧠 <b>Para arrancar:<\/b>\n1\. Llamá a Juan/.test(t), 'arriba, por dónde arrancar (la IA)');
ok(/<b>🔧 Tito:<\/b>/.test(t) && /<b>📦 Rosa:<\/b>/.test(t) && /<b>📱 Lu:<\/b>/.test(t) && /<b>🗂️ Marta:<\/b>/.test(t), 'cada uno firma lo suyo');
t = ctx.texto({ tito: [], rosa: [], beto: [], lu: [], marta: [] }, null, '2026-10-27');
ok(!/Para arrancar/.test(t) && /Nadie tiene nada/.test(t), 'sin IA y sin nada: sale igual, corto');
t = ctx.texto({ tito: ['<b>raro</b> & cosa'] }, ['<script>'], '2026-10-27');
ok(!/<b>raro/.test(t) && /&lt;b&gt;raro/.test(t) && /&lt;script&gt;/.test(t), 'lo escrito por clientes o la IA no rompe el HTML de Telegram');

console.log('\n3) El pedido a la IA');
const b = ctx.pedido(p, '2026-10-27');
ok(b.model === 'claude-opus-5-5' && b.output_config.effort === 'low' && b.output_config.format.type === 'json_schema' && b.fallbacks === 'default', 'Opus, rápido (effort low), JSON fijo y con reintento');
ok(/Batería iPhone 11/.test(b.messages[0].content) && /no inventes/.test(b.system), 'le pasa los hechos y le pide no inventar');
ok(/AbortController/.test(src) && /setTimeout\(\(\) => ctrl\.abort\(\), 40000\)/.test(src), 'si la IA tarda más de 40 s, el parte sale sin ella');
const wf = fs.readFileSync(DIR + '.github/workflows/resumen-telegram.yml', 'utf8');
ok(/cron: '30 13 \* \* \*'/.test(wf) && /\{"oficina":true\}/.test(wf) && /if: github\.event\.schedule == '15 22 \* \* \*'/.test(wf), 'GitHub lo dispara 10:30 AR, sin pisar el resumen de la noche');
ok(JSON.parse(fs.readFileSync(DIR + 'vercel.json', 'utf8')).functions['api/cron-resumen-telegram.js'].maxDuration >= 60, 'la función tiene tiempo para esperar a la IA');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
