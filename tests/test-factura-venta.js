// 🧾 Factura C desde la caja (factura-venta.js) y el QR de la factura (qr.js).
//
// Lo que se cuida:
//  · que se ofrezca factura SOLO en cobros digitales (efectivo y dólares no)
//    y que el efectivo siga con su "¿Comprobante?" de siempre;
//  · consumidor final con un toque; a un CUIT validando el número;
//  · que el ticket tenga todo lo que pide ARCA (tipo, número, CAE, vto, QR)
//    y que en prueba diga "SIN VALIDEZ FISCAL";
//  · que el QR de ARCA (una URL de ~300 caracteres) se pueda generar: el
//    generador llegaba a la versión 10 y, además, desde la 7 armaba mal el
//    código (patrones de alineación y la info de versión).
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

(async () => {
console.log('\n1) El QR de la factura');
const q = { TextEncoder, Uint8Array, Math, Array, Error, console };
vm.createContext(q);
vm.runInContext(leer('qr.js') + '\nthis.qrMatriz = qrMatriz; this.info = _qrInfoVersion;', q);
// Valores de la tabla de la norma (ISO 18004, anexo D)
const tabla = { 7: 0x07C94, 8: 0x085BC, 10: 0x0A4D3, 11: 0x0BBF6, 14: 0x0E60D, 15: 0x0F928 };
ok(Object.keys(tabla).every(v => q.info(Number(v)) === tabla[v]), 'la info de versión es la de la norma (antes estaba mal calculada)', Object.keys(tabla).map(v => q.info(Number(v)).toString(16)));
const qrJson = { ver: 1, fecha: '2026-10-29', cuit: 20385199628, ptoVta: 6, tipoCmp: 11, nroCmp: 1, importe: 1000, moneda: 'PES', ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: 'E', codAut: 86441029094101 };
const url = 'https://www.afip.gob.ar/fe/qr/?p=' + Buffer.from(JSON.stringify(qrJson)).toString('base64');
let m = q.qrMatriz(url);
ok(url.length > 250 && m.length > 57, `la URL de ARCA (${url.length} caracteres) entra (versión ${(m.length - 17) / 4})`);
m = q.qrMatriz('x'.repeat(120));   // versión 7: alineación en (6,22) sobre la línea de tiempo
ok(m.length === 45 && m[4][22] === true && m[5][22] === false && m[6][22] === true, 'en versión 7+ están los patrones de alineación que caen sobre la línea de tiempo');

console.log('\n2) Qué se factura');
const LS = {}, els = {}, PRINTS = [], TOASTS = [];
let ENVIADO = null, RESP = null, STATUS = 200;
const ctx = { console, Math, Date, JSON, Number, String, Array, Object, Set, Promise, TextEncoder, Uint8Array, Error, setTimeout, clearTimeout,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  localStorage: { getItem: k => LS[k] ?? null, setItem: (k, v) => { LS[k] = String(v); } },
  toast: (msg, k) => TOASTS.push([k, msg]),
  apiFetch: async (u, o) => { ENVIADO = JSON.parse(o.body); return { ok: STATUS === 200, status: STATUS, json: async () => RESP }; },
  _imprimirDirecto: async (tipo, html) => { PRINTS.push([tipo, html]); return true; },
  db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ iibb: '901-123456-7', inicio: '01/03/2020' }) }) }) }) },
};
const BARRAS = {};
ctx.document = {
  getElementById: id => BARRAS[id] || null,
  createElement: () => { const el = { style: {}, _q: {}, innerHTML: '', remove() { delete BARRAS[this.id]; },
    querySelector(sel) { return this._q[sel] || (this._q[sel] = { onclick: null, value: '', focus() {}, textContent: '' }); } }; return el; },
  body: { appendChild: el => { BARRAS[el.id] = el; } },
};
vm.createContext(ctx);
vm.runInContext(leer('qr.js') + '\n' + leer('comprobante-venta.js') + '\n' + leer('factura-venta.js'), ctx);
const run = (c, v) => { if (v !== undefined) ctx._v = v; return vm.runInContext(c, ctx); };
ok(run('ventaFacturable(_v)', { tipo: 'ingreso', monto: 100, metodoPago: 'Transferencia' }), 'transferencia: sí');
ok(run('ventaFacturable(_v)', { tipo: 'ingreso', monto: 100, metodoPago: 'Tarjeta crédito' }), 'tarjeta: sí');
ok(!run('ventaFacturable(_v)', { tipo: 'ingreso', monto: 100, metodoPago: 'Efectivo' }) && !run('ventaFacturable(_v)', { tipo: 'ingreso', monto: 100, metodoPago: 'Dólares' }), 'efectivo y dólares: no');
ok(run('ventaFacturable(_v)', { tipo: 'ingreso', monto: 100, metodoPago: 'Efectivo', metodoPago2: 'MercadoPago', monto2: 40 }), 'mitad y mitad: sí (la venta entera)');
ok(!run('ventaFacturable(_v)', { tipo: 'egreso', monto: 100, metodoPago: 'Transferencia' }), 'un egreso: no');
ok(run('cuitValido("20385199628")') && run('cuitValido("20-38519962-8")') && !run('cuitValido("20385199627")') && !run('cuitValido("2038519962")'), 'CUIT: valida el dígito verificador');

console.log('\n3) Después de cobrar');
let COMP = null;
ctx.ofrecerComprobanteVenta = (id) => { COMP = id; };
run('ofrecerDespuesDeCobrar("e1", _v)', { tipo: 'ingreso', monto: 100, metodoPago: 'Efectivo' });
ok(COMP === 'e1' && !BARRAS['fv-barra'], 'efectivo: el "¿Comprobante?" de siempre');
run('ofrecerDespuesDeCobrar("d1", _v)', { id: 'd1', tipo: 'ingreso', monto: 15000, metodoPago: 'Transferencia', descripcion: 'Funda A15' });
ok(!!BARRAS['fv-barra'] && /¿factura\?/.test(BARRAS['fv-barra'].innerHTML) && /Consumidor final/.test(BARRAS['fv-barra'].innerHTML) && /A un CUIT/.test(BARRAS['fv-barra'].innerHTML), 'digital: "¿Factura?" con consumidor final / a un CUIT');

console.log('\n4) Consumidor final, un toque');
RESP = { ok: true, factura: { entorno: 'homologacion', ptoVenta: 6, cbteTipo: 11, nro: 1, importe: 15000, cae: '86441029094101', caeVto: '2026-11-08',
  receptor: { docTipo: 99, docNro: 0, condIva: 5 }, qr: qrJson } };
await run('facturarVenta("d1", _v, null)', { id: 'd1', tipo: 'ingreso', monto: 15000, metodoPago: 'Transferencia', descripcion: 'Funda A15' });
ok(ENVIADO.action === 'emitir' && ENVIADO.movId === 'd1' && ENVIADO.docTipo === 'cf' && ENVIADO.concepto === 'productos', 'pide la factura con la venta (el importe lo pone el servidor)', ENVIADO);
ok(PRINTS.length === 0, 'NO imprime sola: muchas veces el cliente no quiere el papel');
ok(/Factura C 00006-00000001 \(PRUEBA\) hecha/.test(BARRAS['fv-barra'].innerHTML) && /Imprimir/.test(BARRAS['fv-barra'].innerHTML) && /WhatsApp/.test(BARRAS['fv-barra'].innerHTML) && /No, listo/.test(BARRAS['fv-barra'].innerHTML),
   'pregunta: imprimir / WhatsApp / no');
BARRAS['fv-barra'].querySelector('#fv-imp').onclick();
await new Promise(r => setTimeout(r, 20));
const html = PRINTS[0] && PRINTS[0][1];
ok(PRINTS.length === 1 && PRINTS[0][0] === 'ticket', 'con "Imprimir" sale por la de tickets');
ok(/FACTURA C/.test(html) && /Cód\. 011/.test(html) && /N° 00006-00000001/.test(html), 'tipo y número (punto de venta 6, factura 1)');
ok(/CAE: <b>86441029094101<\/b>/.test(html) && /Vto\. CAE: 08\/11\/2026/.test(html), 'CAE y vencimiento');
ok(/<svg/.test(html), 'con el QR');
ok(/\.fin\{margin-top:18mm/.test(html) && /<div class="fin">· · ·<\/div>\s*<\/div>/.test(html), 'termina en una marca 18mm más abajo: la impresora avanza el papel y no corta pegado al QR');
ok(/Consumidor Final/.test(html) && /CUIT: 20-38519962-8/.test(html) && /Responsable Monotributo/.test(html), 'emisor y receptor');
ok(/Ingresos Brutos: 901-123456-7/.test(html) && /Inicio de actividades: 01\/03\/2020/.test(html), 'Ingresos Brutos e inicio de actividades (de config/facturaEmisor)');
ok(/PRUEBA — SIN VALIDEZ FISCAL/.test(html), 'en prueba lo dice bien grande');

ctx._f = RESP.factura;
let WA = null;
ctx.waAbrir = u => { WA = u; };
run('whatsappFactura(_v, _f)', { clienteTel: '1155554444', monto: 15000 });
const txt = WA && decodeURIComponent(WA.split('text=')[1]);
ok(/^https:\/\/wa\.me\/5491155554444/.test(WA || '') && /Factura C N° 00006-00000001/.test(txt) && /CAE: 86441029094101/.test(txt) && /afip\.gob\.ar\/fe\/qr\/\?p=/.test(txt), 'por WhatsApp: número, CAE y el link de ARCA para verificarla', txt);

console.log('\n5) A un CUIT');
PRINTS.length = 0;
await run('facturarVenta("r1", _v, { docTipo: "cuit", docNro: "30712345671", condIva: 1, nombre: "Empresa SA" })', { id: 'r1', tipo: 'ingreso', monto: 50000, metodoPago: 'Transferencia', repairId: 'x', montoReparacion: 50000 });
ok(ENVIADO.docTipo === 'cuit' && ENVIADO.docNro === '30712345671' && ENVIADO.condIva === 1 && ENVIADO.receptorNombre === 'Empresa SA', 'manda CUIT, condición y nombre');
ok(ENVIADO.concepto === 'ambos', 'una reparación va como productos y servicios');
RESP.factura.receptor = { docTipo: 80, docNro: 30712345671, condIva: 1, nombre: 'Empresa SA' };
ctx._f = RESP.factura;
const h3 = run('ticketFacturaHtml(_v, _f, {})', { monto: 50000, descripcion: 'Reparación' });
ok(/Empresa SA/.test(h3) && /CUIT: 30712345671/.test(h3) && /IVA Responsable Inscripto/.test(h3), 'el ticket dice a quién: nombre, CUIT y condición');
ctx._f = Object.assign({}, RESP.factura, { entorno: 'produccion' });
ok(!/SIN VALIDEZ/.test(run('ticketFacturaHtml(_v, _f, {})')), 'en producción no dice "prueba"');

console.log('\n6) Si falla');
STATUS = 500; RESP = { error: 'ARCA la rechazó: [10015] DocNro invalido' }; TOASTS.length = 0;
const r = await run('facturarVenta("d2", _v, null)', { id: 'd2', tipo: 'ingreso', monto: 100, metodoPago: 'Transferencia' });
ok(r === null && TOASTS.some(([k, t]) => k === 'error' && /10015/.test(t) && /sin facturar/.test(t)), 'avisa el motivo y que queda para reintentar', TOASTS);

console.log('\n7) En la lista de la caja');
let b = run('facturaBadge(_v)', { id: 'a', tipo: 'ingreso', monto: 1, metodoPago: 'Transferencia', factura: { estado: 'emitida', ptoVenta: 6, nro: 12, entorno: 'produccion' } });
// Desde el 31/10 el toque abre un menú (reimprimir / WhatsApp / anular)
ok(/🧾 FC 00006-00000012/.test(b) && /menuFactura/.test(b), 'facturada: el número, y tocás para reimprimirla (o mandarla, o anularla)');
b = run('facturaBadge(_v)', { id: 'a', tipo: 'ingreso', monto: 1, metodoPago: 'Transferencia' });
ok(/sin facturar/.test(b) && /facturarDesdeLista/.test(b), 'sin facturar: tocás y factura');
b = run('facturaBadge(_v)', { id: 'a', tipo: 'ingreso', monto: 1, metodoPago: 'Transferencia', factura: { estado: 'fallo', error: 'x' } });
ok(/falló la factura/.test(b), 'si falló, se ve');
ok(run('facturaBadge(_v)', { id: 'a', tipo: 'ingreso', monto: 1, metodoPago: 'Efectivo' }) === '', 'efectivo: nada');
const sf = run('ventasSinFacturar(_v)', [{ id: 1, tipo: 'ingreso', monto: 1, metodoPago: 'Transferencia' }, { id: 2, tipo: 'ingreso', monto: 1, metodoPago: 'Transferencia', factura: { estado: 'emitida' } }, { id: 3, tipo: 'ingreso', monto: 1, metodoPago: 'Efectivo' }]);
ok(sf.length === 1 && sf[0].id === 1, '"Sin facturar": solo los digitales sin factura');

console.log('\n7b) Anular: nota de crédito');
STATUS = 200; ENVIADO = null; TOASTS.length = 0;
ctx.confirm = () => true;
ctx.tpEsDueno = () => true;
const vendida = { id: 'v9', tipo: 'ingreso', monto: 15000, metodoPago: 'Transferencia', descripcion: 'Funda',
  factura: { estado: 'emitida', entorno: 'produccion', ptoVenta: 6, nro: 1, cae: '86441029094101', caeVto: '2026-11-08', receptor: { docTipo: 99 }, qr: qrJson } };
ctx.MOVIMIENTOS = [vendida]; vm.runInContext('MOVIMIENTOS = this.MOVIMIENTOS', ctx);
run('menuFactura("v9")');
const menu = BARRAS['fv-modal'].innerHTML;
ok(/Reimprimir la factura/.test(menu) && /Mandarla por WhatsApp/.test(menu) && /Anular \(nota de crédito\)/.test(menu), 'tocando la factura: reimprimir, WhatsApp o anular');
ctx.tpEsDueno = () => false;
run('menuFactura("v9")');
ok(!/Anular/.test(BARRAS['fv-modal'].innerHTML), 'un empleado no ve "Anular"');
ctx.tpEsDueno = () => true;
ok(run('ventaConFacturaViva(_v)', vendida) === true, 'una venta con factura real sin anular: "viva" (no se puede borrar)');
RESP = { ok: true, notaCredito: { cbteTipo: 13, ptoVenta: 6, nro: 1, cae: '80000000000001', caeVto: '2026-11-10', entorno: 'produccion', qr: Object.assign({}, qrJson, { tipoCmp: 13 }) } };
const nc = await run('anularFacturaVenta("v9")');
ok(ENVIADO.action === 'anular' && ENVIADO.movId === 'v9' && nc && nc.nro === 1, 'pide la nota de crédito al servidor');
ok(/Nota de Crédito C 00006-00000001/.test(BARRAS['fv-barra'].innerHTML) && /Imprimir/.test(BARRAS['fv-barra'].innerHTML), 'y pregunta si se la das (no se imprime sola)');
ctx._f = Object.assign({ importe: 15000, receptor: { docTipo: 99 }, asociado: { ptoVenta: 6, nro: 1 } }, RESP.notaCredito);
const hNC = run('ticketFacturaHtml(_v, _f, {})', vendida);
ok(/NOTA DE CRÉDITO C/.test(hNC) && /Cód\. 013/.test(hNC) && /Anula la Factura C N° 00006-00000001/.test(hNC) && !/FACTURA C<\/div>/.test(hNC), 'el ticket dice NOTA DE CRÉDITO C (cód. 013) y qué factura anula');
ctx.confirm = () => false; ENVIADO = null;
await run('anularFacturaVenta("v9")');
ok(ENVIADO === null, 'si no confirmás, no se anula nada');
vendida.factura.anulada = { cbteTipo: 13, ptoVenta: 6, nro: 1, cae: '80000000000001' };
ok(run('ventaConFacturaViva(_v)', vendida) === false, 'anulada: ya se puede borrar la venta');
const bA = run('facturaBadge(_v)', vendida);
ok(/anulada/.test(bA) && /line-through/.test(bA), 'en la lista se ve tachada: "anulada"');
run('menuFactura("v9")');
ok(/Reimprimir la nota de crédito/.test(BARRAS['fv-modal'].innerHTML) && !/❌ Anular/.test(BARRAS['fv-modal'].innerHTML), 'anulada: se puede reimprimir la NC, y no se anula dos veces');
ok(run('ventaConFacturaViva(_v)', { factura: { estado: 'emitida', entorno: 'homologacion' } }) === false, 'una de prueba no traba nada');
const cjB = leer('caja.js');
ok(/ventaConFacturaViva\(movFact\)/.test(cjB) && /Primero anulala/.test(cjB), 'la caja no deja borrar una venta con factura real sin anular');

console.log('\n7c) Facturado y tope');
const rs = run('fvResumenFacturado(_v, "2026-10", 10000000)', { meses: { '2026-10': 1500000, '2026-09': 1000000, '2025-11': 500000, '2025-10': 999999 } });
ok(rs.mes === 1500000 && rs.anterior === 1000000 && rs.anio === 3000000 && rs.pct === 30, 'este mes, el anterior, los últimos 12 (no el de hace 13) y el %', rs);
ok(run('fvResumenFacturado(_v, "2026-10", 0)', { meses: {} }).pct === null, 'sin tope cargado: no inventa un porcentaje');
ok(/abrirFacturado\(\)/.test(cjB) && /'Facturado y tope'/.test(cjB), 'en el menú de la caja (Facturación y tarjetas)');

console.log('\n8) Enganchado');
const cj = leer('caja.js');
ok(/ofrecerDespuesDeCobrar\(movRef\.id, movIns\)/.test(cj), 'después de cobrar, la caja pregunta factura o comprobante');
ok(/facturaBadge\(m\)/.test(cj) && /abrirSinFacturar\(\)/.test(cj), 'la marca en la lista y "Sin facturar" en el menú');
ok(/<script src="factura-venta\.js"><\/script>/.test(leer('caja.html')), 'caja.html carga factura-venta.js');
const fac = leer('api/factura.js');
ok(/factura: \{\s*estado: 'emitida'/.test(fac) && /estado: 'fallo'/.test(fac), 'el servidor deja marcada la venta (facturada o falló)');
const rules = leer('firestore.rules');
ok(/match \/config\/facturaEmisor \{\s*allow write: if esDueno\(\);/.test(rules) && /'fichar', 'facturaEmisor'/.test(rules), 'los datos del local en la factura los cambia solo el dueño');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})();
