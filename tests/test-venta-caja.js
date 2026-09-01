// Venta de equipo desde la CAJA: el formulario nuevo, lo que guarda y el
// comprobante A5 (que ahora es el mismo que sale desde Stock).
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── DOM mínimo ──────────────────────────────────────────────
const els = {};
const el = (id, extra = {}) => els[id] = Object.assign({
  id, value: '', textContent: '', innerHTML: '', checked: false, style: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { if (f === undefined) { if (this._s.has(c)) { this._s.delete(c); return false; } this._s.add(c); return true; }
                              f ? this._s.add(c) : this._s.delete(c); return f; },
               contains(c) { return this._s.has(c); } },
  focus() {}, setAttribute() {}, addEventListener() {}, querySelector: () => null,
}, extra);

const VE_IDS = ['ve-marca','ve-modelo','ve-imei','ve-imei2','ve-serie','ve-capacidad','ve-color',
  've-bateria','ve-ciclos','ve-condicion','ve-estetico','ve-libre','ve-cuentas','ve-precio','ve-pago',
  've-cuotas','ve-cuotas-wrap','ve-permuta','ve-permuta-val','ve-saldo','ve-garantia','ve-nro',
  've-vendedor','ve-notas','ve-cli-nombre','ve-cli-dni','ve-cli-tel','ve-accesorios','ve-pruebas',
  've-mas','ve-mas-btn','ve-confirm','ve-reg-caja','ventaeq-overlay','ventaeq-modal','ventaeq-tit',
  'comprobante-overlay','comprobante-modal'];
VE_IDS.forEach(id => el(id));

// Lo tildado en accesorios / funciones probadas: lo maneja el test.
let TILDES = { 've-accesorios': [], 've-pruebas': [] };

const sandboxDoc = {
  getElementById: id => els[id] || null,
  querySelector: () => null,
  querySelectorAll: sel => {
    const m = /^#([\w-]+) input:checked$/.exec(sel);
    return m ? (TILDES[m[1]] || []).map(v => ({ value: v })) : [];
  },
  createElement: () => el('tmp'),
  addEventListener: () => {},
  body: { appendChild() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } },
  documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, style: { setProperty() {} } },
};

let TOASTS = [];
const WRITES = { add: [], update: [] };
const fakeDb = {
  collection: name => ({
    add: async data => { WRITES.add.push({ col: name, data }); return { id: 'mov-nuevo' }; },
    doc: id => ({
      update: async d => { WRITES.update.push({ col: name, id, data: d }); },
      set: async d => { WRITES.update.push({ col: name, id, data: d, set: true }); },
      get: async () => ({ exists: false, data: () => ({}) }),
    }),
  }),
};

const ctx = {
  console, setTimeout, clearTimeout, requestAnimationFrame: f => f(),
  TextEncoder, crypto: require('crypto').webcrypto,
  btoa: s => Buffer.from(s, 'binary').toString('base64'), unescape, encodeURIComponent,
  document: sandboxDoc,
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
            location: { href: '', origin: 'https://x' }, open: () => null, _DAKI_NAME: 'TechPoint' },
  location: { origin: 'https://x' },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
  navigator: { userAgent: 'node' },
  firebase: { firestore: { FieldValue: { increment: n => ({ __inc: n }), serverTimestamp: () => ({ __ts: true }) } } },
  db: fakeDb,
  _todayAR: () => '2026-08-20',
  toast: (m, t) => TOASTS.push([t || 'info', m]),
  confirm: () => true, alert: () => {},
  fmt: n => '$' + Number(n || 0).toLocaleString('es-AR'),
  esc: s => String(s == null ? '' : s),
  searchMatch: () => false, getCurrentDolar: () => 1000, getDeviceId: () => 'test',
  upsertCliente: async () => { ctx.__CLIENTE = true; },
  tgNotify: m => { ctx.__TG = m; }, tgMonto: n => '$' + n, tgHora: () => '10:00',
  requireAuth: () => Promise.resolve(null), showApp: () => {},
  getConfig: () => ({ telefonoNegocio: '1172392511' }),
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);

console.log('\n1) caja.js + qr.js + print.js conviven en la misma página');
// Es lo que pasa ahora en caja.html: si dos archivos declaran el mismo nombre,
// el navegador tira SyntaxError y la caja no abre. Esto lo detecta.
let bomba = null;
try {
  for (const f of ['caja.js', 'qr.js', 'print.js']) {
    vm.runInContext(fs.readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
  }
} catch (e) { bomba = e.message; }
ok(!bomba, 'los tres cargan juntos sin chocar nombres', bomba);

const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
run('_openPrint = (html, t) => { __HTML = html; __TIT = t; }');
run("db = globalThis.db; currentDate = '2026-08-20';");
// caja.js trae su propio toast() que pinta en pantalla: acá se lo cambia por
// uno que anota, para poder revisar qué se le avisó al usuario.
ctx.__TOASTS = TOASTS;
run("toast = (m, t) => __TOASTS.push([t || 'info', m]);");

console.log('\n2) El picker de la caja abre el formulario, ya no la página vieja');
const cajaSrc = fs.readFileSync(DIR + 'caja.js', 'utf8');
const cajaHtml = fs.readFileSync(DIR + 'caja.html', 'utf8');
ok(!/comprobante-venta\.html'/.test(cajaSrc), 'caja.js ya no abre comprobante-venta.html');
ok(!fs.existsSync(DIR + 'comprobante-venta.html'), 'la página vieja de 389 KB ya no está en el repo');
ok(!/_checkVentaPendiente\(\)/.test(cajaSrc.replace(/\/\/.*/g, '')), 'se fue el rodeo por localStorage');
ok(!/_VENTA_PEND_KEY/.test(cajaSrc), 'y su clave de localStorage');
ok(/src="print\.js"/.test(cajaHtml) && /src="qr\.js"/.test(cajaHtml), 'caja.html carga print.js y qr.js');
ok(cajaHtml.indexOf('src="qr.js"') < cajaHtml.indexOf('src="print.js"'),
   'qr.js va ANTES de print.js (print.js le pide el QR)');
ok(/id="ventaeq-modal"/.test(cajaHtml), 'está el modal de venta');

console.log('\n3) Precarga desde el stock');
run(`CAJA_STOCK = [{ id: 's1', marca: 'Samsung', modelo: 'Galaxy A54', imei: '356789102345678',
  almacenamiento: '256 GB', color: 'Negro', bateria: 89, precio: 520000, costo: 400000,
  estado: 'Muy bueno', garantiaMeses: 6 }];`);
run("openVentaEqModal('s1')");
ok(els['ve-marca'].value === 'Samsung' && els['ve-modelo'].value === 'Galaxy A54', 'marca y modelo');
ok(els['ve-imei'].value === '356789102345678', 'IMEI');
ok(els['ve-precio'].value === '520000', 'precio');
ok(els['ve-bateria'].value === '89' && els['ve-capacidad'].value === '256 GB', 'batería y capacidad');
ok(els['ve-condicion'].value === 'Muy bueno', 'condición');
ok(els['ve-imei2'].value === '' && els['ve-permuta'].value === '', 'lo que no está en el stock queda vacío');
ok(!els['ventaeq-modal'].classList.contains('hidden'), 'el modal se abre');
ok(els['ve-mas'].classList.contains('hidden'), 'los detalles arrancan plegados');
run("openVentaEqModal(null)");
ok(els['ve-marca'].value === '' && els['ve-precio'].value === '', 'la venta "en blanco" abre todo vacío');
ok(get('_veStockId') === null, 'sin equipo del stock asociado');

console.log('\n4) Lo que no cargás no viaja al comprobante');
run("openVentaEqModal('s1')");
els['ve-pago'].value = 'Efectivo';
let d = get('_veDatos()');
ok(d.precio === 520000 && d.marca === 'Samsung', 'lo cargado sí viaja');
['imei2', 'serie', 'ciclos', 'estetico', 'permuta', 'permutaValor', 'saldoAbonado',
 'comprobanteNro', 'libre', 'cuentas', 'accesorios', 'pruebas', 'cuotas'].forEach(k =>
  ok(!(k in d), `«${k}» vacío no se manda`, d[k]));

console.log('\n5) Con todo cargado, todo llega');
els['ve-imei2'].value = '356789102345679';
els['ve-serie'].value = 'F2LX1234';
els['ve-ciclos'].value = '312';
els['ve-estetico'].value = 'B · buen estado';
els['ve-libre'].value = 'si';
els['ve-cuentas'].value = 'no';
els['ve-permuta'].value = 'iPhone 8 · IMEI 111';
els['ve-permuta-val'].value = '120000';
els['ve-saldo'].value = '400000';
els['ve-nro'].value = '0001-00000123';
els['ve-cuotas'].value = '3';
els['ve-pago'].value = 'Tarjeta crédito';
els['ve-cli-nombre'].value = 'Pérez, Juan';
els['ve-cli-dni'].value = '38412907';
els['ve-cli-tel'].value = '1155554433';
els['ve-notas'].value = 'Se entrega con vidrio puesto';
TILDES['ve-accesorios'] = ['Caja', 'Cargador'];
TILDES['ve-pruebas'] = ['Pantalla', 'Cámaras'];
d = get('_veDatos()');
ok(d.libre === true && d.cuentas === false, 'los tildes viajan como sí/no de verdad', [d.libre, d.cuentas]);
ok(d.permutaValor === 120000 && d.saldoAbonado === 400000, 'permuta y saldo');
ok(d.cuotas === 3 && d.comprobanteNro === '0001-00000123', 'cuotas y N° de comprobante');
ok(Array.isArray(d.accesorios) && d.accesorios.length === 2, 'accesorios tildados');
ok(Array.isArray(d.pruebas) && d.pruebas.join() === 'Pantalla,Cámaras', 'funciones probadas');

console.log('\n6) La venta se registra en la caja y marca el equipo vendido');
els['ve-reg-caja'].checked = true;
run('confirmVentaEquipo()');
setTimeout(() => {
  const mov = WRITES.add.find(w => w.col === 'caja_movimientos');
  ok(!!mov, 'entra un movimiento en caja_movimientos');
  ok(mov.data.tipo === 'ingreso' && mov.data.categoria === 'Venta equipo', 'ingreso · Venta equipo');
  ok(mov.data.monto === 520000, 'por el precio de venta', mov.data.monto);
  ok(mov.data.metodoPago === 'Tarjeta crédito', 'con la forma de pago elegida', mov.data.metodoPago);
  ok(mov.data.fecha === '2026-08-20', 'en el día que está abierto en la caja');
  ok(mov.data.costoARSTotal === 400000 && mov.data.gananciaARS === 120000,
     'guarda costo y ganancia del equipo', [mov.data.costoARSTotal, mov.data.gananciaARS]);
  ok(mov.data.itemId === 's1' && mov.data.itemSource === 'equipo', 'queda enganchado al equipo del stock');

  const upd = WRITES.update.find(w => w.col === 'stock');
  ok(!!upd && upd.id === 's1', 'se actualiza el equipo del stock');
  ok(upd.data.vendido === true, 'queda marcado como vendido');
  ok(upd.data.ventaMovId === 'mov-nuevo', 'con el id del movimiento de caja');
  ok(upd.data.clienteNombre === 'Pérez, Juan' && upd.data.clienteDni === '38412907', 'y los datos del comprador');
  ok(!!upd.data.garantiaHasta, 'la garantía de 6 meses calcula su vencimiento');
  // Nada de renombrar ni borrar campos que ya estaban en Firestore
  ok(!('marca' in upd.data) && !('precio' in upd.data),
     'no le pisa marca ni precio al equipo (solo agrega lo de la venta)', Object.keys(upd.data));
  ok(!!ctx.__TG, 'avisa por Telegram');

  console.log('\n7) Sin registrar en caja: solo marca el equipo');
  WRITES.add.length = 0; WRITES.update.length = 0;
  run("openVentaEqModal('s1')");
  els['ve-precio'].value = '300000'; els['ve-pago'].value = 'Efectivo';
  els['ve-reg-caja'].checked = false;
  run('confirmVentaEquipo()');
  setTimeout(() => {
    ok(WRITES.add.length === 0, 'no entra plata en la caja', WRITES.add.length);
    ok(WRITES.update.some(w => w.col === 'stock'), 'pero el equipo igual queda vendido');

    console.log('\n8) Sin precio no se vende');
    WRITES.add.length = 0; WRITES.update.length = 0; TOASTS.length = 0;
    run("openVentaEqModal('s1')");
    els['ve-precio'].value = '';
    run('confirmVentaEquipo()');
    ok(WRITES.add.length === 0 && WRITES.update.length === 0, 'no escribe nada');
    ok(TOASTS.some(t => /precio/i.test(t[1])), 'y avisa que falta el precio', TOASTS);

    console.log('\n9) El comprobante A5 imprime solo lo cargado');
    // Venta corta: cuatro datos y nada más.
    ctx.__EQ = { marca: 'Motorola', modelo: 'G54', precio: 300000, forma_pago: 'Efectivo' };
    run("printVentaTicket(null, __EQ, 'A5')");
    const corto = get('__HTML');
    ok(/@page\{size:A5 portrait/.test(corto), 'sale en A5');
    ok((corto.match(/class="tk"/g) || []).length === 2, 'original + copia');
    ok(!/IMEI 2/.test(corto), 'sin IMEI 2 no imprime el renglón');
    ok(!/N° de serie/.test(corto), 'sin serie tampoco');
    ok(!/Accesorios incluidos/.test(corto), 'sin accesorios no aparece el bloque');
    ok(!/Probado en el local/.test(corto), 'sin pruebas tampoco');
    ok(!/parte de pago/.test(corto), 'sin permuta no aparece la fila ni la cláusula');
    ok(!/Ciclos de batería/.test(corto), 'sin ciclos tampoco');
    ok(!/>—</.test(corto.replace(/vfir|vqr/g, '')), 'no quedan renglones vacíos con guión');
    ok(/300\.000/.test(corto), 'el total sí sale');

    // Venta completa: todo el detalle.
    ctx.__EQ = {
      marca: 'Samsung', modelo: 'Galaxy A54', imei: '356789102345678', imei2: '356789102345679',
      serie: 'F2LX1234', almacenamiento: '256 GB', color: 'Negro', bateria: 89, ciclos: 312,
      estado: 'Muy bueno', estetico: 'B · buen estado', libre: true, cuentas: false,
      accesorios: ['Caja', 'Cargador'], pruebas: ['Pantalla', 'Cámaras'],
      precio: 520000, forma_pago: 'Tarjeta crédito', cuotas: 3,
      permuta: 'iPhone 8 · IMEI 111', permutaValor: 120000, saldoAbonado: 400000,
      garantiaMeses: 6, comprobanteNro: '0001-00000123', vendedor: 'Alan',
      clienteNombre: 'Pérez, Juan', clienteDni: '38412907', clienteTel: '1155554433',
      notas: 'Se entrega con vidrio puesto',
    };
    run("printVentaTicket(null, __EQ, 'A5')");
    const largo = get('__HTML');
    ok(/N° 0001-00000123/.test(largo), 'número de comprobante en el encabezado');
    ok(/356789102345679/.test(largo), 'IMEI 2');
    ok(/F2LX1234/.test(largo), 'N° de serie');
    ok(/312/.test(largo), 'ciclos de batería');
    ok(/B · buen estado/.test(largo), 'estado estético');
    ok(/Libre de fábrica[\s\S]{0,40}Sí/.test(largo), 'libre de fábrica: Sí');
    ok(/iCloud \/ Google removido[\s\S]{0,40}No/.test(largo), 'cuentas removidas: No (no lo da por hecho)');
    ok(/Caja · Cargador/.test(largo), 'accesorios entregados');
    ok(/Pantalla · Cámaras/.test(largo), 'funciones probadas');
    ok(/3 cuotas/.test(largo), 'las cuotas al lado de la forma de pago');
    ok(/iPhone 8 · IMEI 111/.test(largo), 'el equipo tomado en permuta');
    ok(/− \$120\.000/.test(largo), 'el valor tomado se descuenta');
    ok(/SALDO ABONADO[\s\S]{0,60}400\.000/.test(largo), 'el saldo abonado');
    ok(/legítimo titular/.test(largo), 'con permuta aparece la cláusula de procedencia lícita');
    ok(/6\. Conformidad/.test(largo), 'y las condiciones se renumeran', (largo.match(/\d\. Conformidad/) || [])[0]);
    ok(/Pérez, Juan/.test(largo) && /38412907/.test(largo), 'datos del comprador');
    ok(/GARANTÍA 6 MESES/.test(largo), 'garantía');
    ok(/<svg/.test(largo), 'QR de WhatsApp generado en la app');
    const limpio = largo.replace(/https:\/\/wa\.me[^"'<]*/g, '').replace(/http:\/\/www\.w3\.org[^"']*/g, '');
    ok(!/https?:\/\//.test(limpio), 'no descarga nada de internet para imprimir',
       (limpio.match(/https?:\/\/[^"'\s<]*/g) || []).slice(0, 3));
    // Sin permuta la numeración vuelve a 5
    delete ctx.__EQ.permuta;
    run("printVentaTicket(null, __EQ, 'A5')");
    ok(/5\. Conformidad/.test(get('__HTML')), 'sin permuta, Conformidad vuelve a ser la 5');

    console.log('\n10) Las ventas viejas se siguen imprimiendo igual');
    // Un equipo guardado antes de todo esto: solo los campos de siempre.
    ctx.__EQ = { marca: 'Xiaomi', modelo: 'Redmi Note 12', imei: '111222333444555',
                 almacenamiento: '128 GB', bateria: 95, estado: 'Bueno', precio: 250000,
                 forma_pago: 'Transferencia', garantiaMeses: 3, vendedor: 'Alan',
                 fecha_venta: '2026-05-10T14:00:00.000Z' };
    run("printVentaTicket(null, __EQ, 'A5')");
    const viejo = get('__HTML');
    ok(/Redmi Note 12/.test(viejo) && /250\.000/.test(viejo), 'imprime el equipo y el total');
    ok(/GARANTÍA 3 MESES/.test(viejo), 'y la garantía');
    ok(!/IMEI 2|N° de serie|parte de pago|Accesorios incluidos/.test(viejo),
       'sin bloques nuevos vacíos');
    ok(/10\/05\/2026/.test(viejo), 'respeta la fecha de venta guardada');

    console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
    process.exit(fails ? 1 : 0);
  }, 20);
}, 20);
