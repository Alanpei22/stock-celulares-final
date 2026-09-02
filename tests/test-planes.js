// Planes de ahorro y comprobante de reserva.
// La app maneja plata: lo que más se vigila acá es que lo que el cliente
// entrega NO se cuente dos veces en la caja.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── DOM mínimo ──────────────────────────────────────────────
const els = {};
const el = (id, extra = {}) => els[id] = Object.assign({
  id, value: '', textContent: '', innerHTML: '', checked: false, style: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  closest() { return null; }, focus() {}, setAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
}, extra);
['planes-overlay','planes-modal','planes-lista','planes-chips','planform-overlay','planform-modal',
 'pf-cli-nombre','pf-cli-dni','pf-cli-tel','pf-buscar','pf-stock-res','pf-marca','pf-modelo',
 'pf-capacidad','pf-color','pf-desc','pf-precio','pf-plazo','pf-cuota','pf-vendedor','pf-pago1',
 'pf-pago1-metodo','pf-reg-caja','pf-confirm','plandet-overlay','plandet-modal','pd-tit','pd-body',
 'pd-acciones','planpago-overlay','planpago-modal','pp-info','pp-monto','pp-metodo','pp-reg-caja',
 'pp-confirm','mov-fi-desc','mov-desc-suggest'].forEach(id => el(id));

let TOASTS = [], CONFIRM = true;
const W = { adds: [], updates: [], sets: [] };
const META = { nextPlanNum: 5 };
const ctx = {
  console, setTimeout, clearTimeout, requestAnimationFrame: f => f(),
  TextEncoder, crypto: require('crypto').webcrypto,
  btoa: s => Buffer.from(s, 'binary').toString('base64'), unescape, encodeURIComponent,
  document: {
    getElementById: id => els[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el('tmp'), addEventListener: () => {},
    body: { style: {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } },
    documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, style: { setProperty() {} } },
  },
  window: { addEventListener() {}, _DAKI_NAME: 'TechPoint', location: { href: '', origin: 'https://x' },
            matchMedia: () => ({ matches: false, addEventListener() {} }), open: u => { ctx.__url = u; } },
  location: { origin: 'https://x' },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem() {} },
  navigator: { userAgent: 'node' },
  BIZ_DATA: { dir: 'Urquiza 4741', tel: '11 7239-2511', extra: 'Lun a Sáb 9 a 19' },
  firebase: { firestore: { FieldValue: {
    increment: n => ({ __inc: n }),
    arrayUnion: v => ({ __arr: v }),
    delete: () => ({ __del: true }),
    serverTimestamp: () => ({ __ts: 1 }),
  } } },
  _todayAR: () => '2026-09-01',
  confirm: () => CONFIRM, alert: () => {},
  getCurrentDolar: () => 1000, getDeviceId: () => 'test',
  upsertCliente: async () => {},
  tgNotify: m => { ctx.__TG = m; }, tgMonto: n => '$' + n, tgHora: () => '10:00',
  requireAuth: () => Promise.resolve(null), showApp: () => {},
  getConfig: () => ({ telefonoNegocio: '1172392511' }),
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const f of ['caja.js', 'qr.js', 'print.js']) {
  vm.runInContext(fs.readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
}
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);

// Firestore falso, con transacción para el contador de números de plan
ctx.__DB = {
  collection: name => ({
    doc: id => ({
      update: async d => { W.updates.push([name, id, d]); },
      set: async (d, o) => { W.sets.push([name, id, d]); },
      get: async () => ({ exists: true, data: () => META }),
    }),
    add: async d => { W.adds.push([name, d]); return { id: 'plan-nuevo' }; },
    orderBy: () => ({ limit: () => ({ get: async () => ({ docs: (ctx.__DOCS || []).map(d => ({ id: d.id, data: () => d })) }) }) }),
  }),
  runTransaction: async fn => fn({
    get: async () => ({ exists: true, data: () => META }),
    set: (ref, d) => { Object.assign(META, d); },
  }),
};
run(`db = __DB; currentDate = '2026-09-01'; ARQUEO = { vendedor: 'Alan' };
     esc = s => String(s == null ? '' : s);
     fmt = n => '$' + Number(n || 0).toLocaleString('es-AR');
     normalizeText = s => String(s || '').toLowerCase();
     toast = (m, t) => __TOASTS.push([t || 'info', m]);
     _openPrint = (html) => { __HTML = html; };`);
ctx.__TOASTS = TOASTS;
run(`CAJA_STOCK = [{ id: 's1', marca: 'Samsung', modelo: 'Galaxy A54', imei: '356789102345678',
      almacenamiento: '256 GB', color: 'Negro', estado: 'Muy bueno', bateria: 89, precio: 520000, vendido: false }];`);

const reset = () => { W.adds = []; W.updates = []; W.sets = []; TOASTS.length = 0; };
const setV = (k, v) => { els[k].value = String(v); };
const tick = () => new Promise(r => setImmediate(r));
// El comprobante se imprime en un setTimeout, para no trabar el guardado.
const esperarImpresion = () => new Promise(r => setTimeout(r, 320));

(async () => {

console.log('\n1) Alta de un plan con equipo del stock');
reset();
run('openPlanForm()');
ok(els['pf-plazo'].value === '90', 'el plazo arranca en 90 días');
setV('pf-buscar', 'galaxy');
run('_planBuscarStock()');
ok(/Galaxy A54/.test(els['pf-stock-res'].innerHTML), 'el buscador encuentra el equipo del stock');
run("_planElegirStock('s1')");
ok(els['pf-marca'].value === 'Samsung' && els['pf-modelo'].value === 'Galaxy A54', 'al elegirlo completa los campos');
ok(els['pf-precio'].value === '520000', 'y trae el precio');
ok(get('_planStockId') === 's1', 'queda enganchado al equipo del stock');

setV('pf-cli-nombre', 'Gómez, Ana');
setV('pf-cli-tel', '1166667788');
setV('pf-precio', '520000');
setV('pf-cuota', '65000');
setV('pf-pago1', '100000');
setV('pf-pago1-metodo', 'Efectivo');
els['pf-reg-caja'].checked = true;
await get('confirmPlan()');
await tick();

const alta = W.adds.find(a => a[0] === 'planes');
ok(!!alta, 'crea el documento del plan', W.adds.map(a => a[0]));
ok(alta[1].nro === 5, 'toma el número del contador de config', alta[1].nro);
ok(META.nextPlanNum === 6, 'y lo adelanta para el próximo', META.nextPlanNum);
ok(alta[1].precioPactado === 520000, 'precio pactado');
ok(alta[1].pagado === 100000, 'la primera entrega ya cuenta');
ok(alta[1].pagos.length === 1 && alta[1].pagos[0].monto === 100000, 'y queda registrada en el historial');
ok(alta[1].estado === 'activo', 'nace activo');
ok(/^\d{4}-\d{2}-\d{2}$/.test(alta[1].fechaLimite), 'con fecha límite calculada', alta[1].fechaLimite);
ok(alta[1].equipo.stockId === 's1' && alta[1].equipo.imei === '356789102345678',
   'el equipo guarda el id del stock y su IMEI', alta[1].equipo);

const rsv = W.updates.find(u => u[0] === 'stock');
ok(!!rsv && rsv[2].reservado === true, 'el equipo del stock queda RESERVADO', W.updates);
ok(rsv[2].planId === 'plan-nuevo', 'con el id del plan');
ok(rsv[2].reservaCliente === 'Gómez, Ana', 'y el nombre del cliente');

const mov = W.adds.find(a => a[0] === 'caja_movimientos');
ok(!!mov, 'la primera entrega entra en la caja');
ok(mov[1].monto === 100000 && mov[1].categoria === 'Plan ahorro', 'como ingreso "Plan ahorro"', mov[1].categoria);
ok(mov[1].planId === 'plan-nuevo', 'enganchado al plan');
ok(get('PLANES.length') === 1, 'queda en la lista local sin releer Firestore');

console.log('\n2) Registrar entregas');
reset();
run("_planSel = 'plan-nuevo'");
run('openPlanPago()');
ok(els['pp-monto'].value === '65000', 'propone la cuota sugerida');
setV('pp-monto', '150000');
setV('pp-metodo', 'Transferencia');
await get('confirmPlanPago()');
await esperarImpresion();
const updPlan = W.updates.find(u => u[0] === 'planes');
ok(!!updPlan, 'actualiza el plan');
ok(updPlan[2].pagado && updPlan[2].pagado.__inc === 150000,
   'suma con increment atómico (dos cajas a la vez no se pisan)', updPlan[2].pagado);
ok(updPlan[2].pagos && updPlan[2].pagos.__arr.monto === 150000, 'y agrega el pago al historial');
ok(W.adds.some(a => a[0] === 'caja_movimientos' && a[1].monto === 150000), 'el ingreso entra en la caja');
ok(get('PLANES[0].pagado') === 250000, 'la copia local queda al día', get('PLANES[0].pagado'));
ok(!!ctx.__HTML && /PLAN AHORRO/.test(ctx.__HTML), 'imprime el comprobante');
ok(/150\.000/.test(ctx.__HTML), 'con la entrega de hoy');
ok(/250\.000/.test(ctx.__HTML), 'y el acumulado');
ok(W.updates.some(u => u[0] === 'stock' && u[2].reservaSena === 250000),
   'la seña del equipo reservado acompaña al acumulado');

console.log('\n3) No se puede entregar si falta plata');
reset();
await get('entregarPlan()');
ok(W.updates.length === 0 && W.adds.length === 0, 'no escribe nada', W.updates);
ok(TOASTS.some(t => /falta/i.test(t[1])), 'y avisa cuánto falta', TOASTS);

console.log('\n4) Completar y entregar: NO entra plata nueva en la caja');
reset();
run('openPlanPago()');
setV('pp-monto', '270000');
setV('pp-metodo', 'Efectivo');
await get('confirmPlanPago()');
await tick();
ok(get('PLANES[0].pagado') === 520000, 'el plan queda completo', get('PLANES[0].pagado'));
ok(get('_planCompleto(PLANES[0])') === true, 'y se marca como completo');

reset();
CONFIRM = true;
await get('entregarPlan()');
await tick();
const ent = W.updates.find(u => u[0] === 'planes');
ok(ent && ent[2].estado === 'entregado', 'el plan pasa a entregado', ent && ent[2]);
const st = W.updates.find(u => u[0] === 'stock');
ok(st && st[2].vendido === true, 'el equipo queda vendido');
ok(st && st[2].reservado && st[2].reservado.__del, 'y deja de estar reservado');
ok(st[2].clienteNombre === 'Gómez, Ana', 'con los datos del comprador');
// ESTO es lo importante: la plata ya entró entrega por entrega
ok(!W.adds.some(a => a[0] === 'caja_movimientos'),
   'NO registra un ingreso nuevo por el precio del equipo (ya entró en cada entrega)',
   W.adds.map(a => a[0]));

console.log('\n5) Cancelar un plan: queda crédito, no sale plata');
reset();
run(`PLANES = [{ id: 'p2', nro: 6, estado: 'activo', precioPactado: 400000, pagado: 130000,
      pagos: [{ fecha: '2026-08-01', monto: 130000, metodo: 'Efectivo' }],
      cliente: { nombre: 'Luis Díaz' }, equipo: { stockId: 's1', marca: 'Xiaomi', modelo: 'Note 12' },
      fechaLimite: '2026-12-01' }];
     _planSel = 'p2';`);
await get('cancelarPlan()');
await tick();
const can = W.updates.find(u => u[0] === 'planes');
ok(can && can[2].estado === 'cancelado', 'el plan queda cancelado');
ok(can && can[2].creditoRestante === 130000, 'con el crédito a favor del cliente', can && can[2].creditoRestante);
ok(!W.adds.some(a => a[0] === 'caja_movimientos'), 'no sale plata de la caja: no se devuelve efectivo');
ok(W.updates.some(u => u[0] === 'stock' && u[2].reservado && u[2].reservado.__del),
   'el equipo vuelve al stock disponible');

console.log('\n6) Cuentas del plan');
ctx.__P = { precioPactado: 500000, pagado: 200000 };
ok(get('_planFalta(__P)') === 300000, 'falta = pactado − entregado');
ok(get('_planPct(__P)') === 40, 'porcentaje', get('_planPct(__P)'));
ctx.__P = { precioPactado: 500000, pagado: 600000 };
ok(get('_planFalta(__P)') === 0, 'si pagó de más, falta 0 (no da negativo)');
ok(get('_planPct(__P)') === 100, 'y el porcentaje no pasa de 100');
ctx.__P = { estado: 'activo', fechaLimite: '2026-08-01' };
ok(get('_planVencido(__P)') === true, 'detecta el plazo vencido');
ctx.__P = { estado: 'activo', fechaLimite: '2026-12-01' };
ok(get('_planVencido(__P)') === false, 'y el que está en fecha, no');

console.log('\n7) La colección `planes` no engancha ningún listener');
// El cupo de Firebase es lo que puede dejar al local sin poder cobrar.
const cajaSrc = fs.readFileSync(DIR + 'caja.js', 'utf8');
const bloque = cajaSrc.slice(cajaSrc.indexOf('PLANES DE AHORRO'), cajaSrc.indexOf('VENTA DE EQUIPO DESDE LA CAJA'));
ok(!/onSnapshot/.test(bloque), 'se lee con .get() puntual, nunca con onSnapshot');
ok(/limit\(100\)/.test(bloque), 'y con un techo de 100 documentos');

console.log('\n8) Comprobante de reserva');
ctx.__RES = {
  nro: 45, cliente: { nombre: 'Pérez, Juan', dni: '38412907', tlf: '1155554433' },
  equipo: { marca: 'Samsung', modelo: 'Galaxy A54', imei: '356789102345678',
            almacenamiento: '256 GB', color: 'Negro', estado: 'Muy bueno', bateria: 89 },
  precio: 520000, sena: 150000, fechaLimite: '2026-09-15', vendedor: 'Alan',
};
run('printReserva(__RES)');
const rHtml = ctx.__HTML;
ok(/COMPROBANTE DE RESERVA/.test(rHtml), 'dice qué es');
ok((rHtml.match(/class="tk"/g) || []).length === 2, 'original + copia');
ok(/@page\{size:A5 portrait/.test(rHtml), 'en A5');
ok(/N° 45/.test(rHtml), 'con su número');
ok(/520\.000/.test(rHtml) && /150\.000/.test(rHtml) && /370\.000/.test(rHtml),
   'precio, seña y saldo (520.000 − 150.000)');
ok(/15\/09\/2026/.test(rHtml), 'la fecha límite en formato de acá');
ok(/no se devuelve en efectivo/.test(rHtml), 'dice qué pasa si desiste (crédito, no devolución)');
ok(/sin variación hasta la fecha límite/.test(rHtml), 'y que el precio queda congelado');
ok(/Firma y aclaración del cliente/.test(rHtml), 'con la firma del cliente');
ok(/<svg/.test(rHtml), 'QR de WhatsApp generado en la app');
const limpio = rHtml.replace(/https:\/\/wa\.me[^"'<]*/g, '').replace(/http:\/\/www\.w3\.org[^"']*/g, '');
ok(!/https?:\/\//.test(limpio), 'no descarga nada de internet para imprimir');

console.log('\n9) Comprobante del plan');
ctx.__PLAN = {
  nro: 7, cliente: { nombre: 'Gómez, Ana' }, vendedor: 'Alan',
  equipo: { marca: 'iPhone', modelo: '13', descripcion: 'A pedido' },
  precioPactado: 720000, pagado: 425000, fechaLimite: '2026-11-05',
  pagos: [
    { fecha: '2026-06-05', monto: 80000, metodo: 'Efectivo' },
    { fecha: '2026-08-20', monto: 345000, metodo: 'Transferencia' },
  ],
};
run('printPlanAhorro(__PLAN, 345000, "Transferencia")');
const pHtml = ctx.__HTML;
ok(/PLAN AHORRO/.test(pHtml), 'dice qué es');
ok(/720\.000/.test(pHtml) && /425\.000/.test(pHtml) && /295\.000/.test(pHtml),
   'pactado, entregado y lo que falta');
ok(/59% del plan/.test(pHtml), 'la barra con el porcentaje', (pHtml.match(/\d+% del plan/) || [])[0]);
ok(/ENTREGA DE HOY/.test(pHtml) && /345\.000/.test(pHtml), 'destaca la entrega de hoy');
ok(/Efectivo/.test(pHtml) && /Transferencia/.test(pHtml), 'lista los pagos anteriores');
ok(/el IMEI se completa al momento de la entrega/.test(pHtml),
   'si el equipo es a pedido y no tiene IMEI, lo aclara');
ok(/quedan acreditados a su favor/.test(pHtml), 'dice qué pasa si abandona');
ok(/se aplica al precio vigente/.test(pHtml), 'y qué pasa si se le vence el plazo');
// Con muchos pagos la hoja no puede crecer sin límite
ctx.__PLAN.pagos = Array.from({ length: 15 }, (_, i) => ({ fecha: '2026-0' + (i % 9 + 1) + '-05', monto: 20000, metodo: 'Efectivo' }));
run('printPlanAhorro(__PLAN, 20000, "Efectivo")');
ok(/pagos anteriores por/.test(ctx.__HTML), 'con 15 pagos resume los viejos en una línea');

console.log('\n10) UNA hoja A5 por comprobante, nunca dos en la misma');
// La reserva ocupa 126 mm de los 196 útiles: si se cae la regla del corte,
// el original y la copia entran juntos en la misma hoja y el cliente se va
// con la copia del negocio pegada abajo. Medido en el navegador: reserva
// 126,5 mm y plan 177,5 mm por hoja, ninguno necesita achicarse.
const docs = [['reserva', rHtml], ['plan ahorro', pHtml]];
docs.forEach(([nombre, html]) => {
  ok((html.match(/class="tk"/g) || []).length === 2, `${nombre}: son dos comprobantes (original + copia)`);
  ok(/@page\{size:A5 portrait;margin:7mm\}/.test(html), `${nombre}: la hoja es A5`);
  ok(/\.tk \+ \.tk\{page-break-before:always\}/.test(html),
     `${nombre}: corte de página OBLIGATORIO entre uno y otro`);
  ok(/192\*MM/.test(html), `${nombre}: el auto-ajuste mide contra una hoja A5 sola`);
  // El corte NO puede ser page-break-after: eso deja una hoja en blanco al final
  ok(!/\.tk\{page-break-after:always\}/.test(html), `${nombre}: sin hoja en blanco al final`);
});
// Y que la regla siga viva en los dos CSS que usan todos los comprobantes
const printSrc = fs.readFileSync(DIR + 'print.js', 'utf8');
ok((printSrc.match(/\.tk \+ \.tk\{page-break-before:always\}/g) || []).length === 2,
   'la regla está en los dos CSS de comprobantes (venta/reserva/plan y recepción)',
   (printSrc.match(/\.tk \+ \.tk\{page-break-before:always\}/g) || []).length);

console.log('\n11) La seña ya no se cuenta dos veces al vender');
const appSrc = fs.readFileSync(DIR + 'app.js', 'utf8');
const venta = appSrc.slice(appSrc.indexOf('async function confirmSell'), appSrc.indexOf('async function confirmSell') + 4000);
ok(/const aCobrar = Math\.max\(0, \(Number\(p\?\.precio\) \|\| 0\) - yaEntregado\)/.test(venta),
   'la venta cobra el precio menos lo que ya había dejado');
ok(/monto: aCobrar/.test(venta), 'y ese es el monto del movimiento de caja');
ok(!/monto: p\.precio,/.test(venta), 'ya no registra el precio completo');
ok(/printReserva/.test(appSrc) && /printReservaDe/.test(appSrc),
   'y el detalle del equipo puede reimprimir la reserva');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})();
