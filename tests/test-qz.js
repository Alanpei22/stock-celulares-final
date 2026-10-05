// Impresión directa con QZ Tray (qz-print.js + api/qz-sign.js).
//
// Lo que se cuida acá:
//  · que sin QZ Tray configurado todo siga EXACTAMENTE como antes (el diálogo),
//    porque la tablet y el celular no lo tienen;
//  · que cada cosa vaya a SU impresora: la hoja a la de hojas, la etiqueta a
//    la XPrinter, con el tamaño de papel de cada una;
//  · que si QZ Tray falla, el ingreso igual tenga su hoja (cae al diálogo);
//  · que la clave privada no esté en el repo y la firma pida sesión.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

(async () => {
console.log('\n1) La configuración, por dispositivo');
const store = {};
let QZ_FALLA = false, IMPRESOS = [], TOASTS = [];
const ctx = {
  console, Math, Number, String, Array, Object, JSON, Promise, Date, Error,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  toast: (m, t) => TOASTS.push([t, m]),
  apiFetch: async () => ({ ok: true, json: async () => ({ signature: 'x' }) }),
  fetch: async () => ({ ok: true, text: async () => 'CERT' }),
  window: {},
  qz: {
    websocket: { isActive: () => false, connect: async () => { if (QZ_FALLA) throw new Error('sin QZ'); } },
    security: { setCertificatePromise() {}, setSignatureAlgorithm() {}, setSignaturePromise() {} },
    printers: { find: async () => ['HP', 'XPrinter'] },
    configs: { create: (p, o) => ({ p, o }) },
    print: async (cfg, data) => { IMPRESOS.push({ impresora: cfg.p, o: cfg.o, n: data.length, data }); },
  },
  etqFormato: () => '40x30', etqEsA4: () => false,
};
ctx.window.qz = ctx.qz;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(leer('qz-print.js'), ctx, { filename: 'qz-print.js' });
// El dibujo a imagen necesita un navegador de verdad (se probó con Chromium);
// acá se reemplaza para mirar a quién se manda qué.
vm.runInContext("_qzPaginasPng = async (html, sel, a, h, dpi, byn) => [JSON.stringify({ sel, a, h, dpi, byn })]", ctx);
const run = c => vm.runInContext(c, ctx);

ok(run("qzActivo('hoja')") === false && run("qzActivo('etiqueta')") === false, 'sin configurar no está activo en nada');
ok(await run("qzImprimir('hoja', '<x>')") === false && IMPRESOS.length === 0, 'y sin configurar no manda nada: queda el diálogo');
store.qzImpresoras = JSON.stringify({ hoja: 'HP', etiqueta: 'XPrinter' });
ok(run("qzActivo('hoja')") && run("qzActivo('etiqueta')"), 'configurado, se activa');
store.qzImpresoras = '{roto';
ok(run("qzActivo('hoja')") === false, 'si lo guardado está roto, vuelve al diálogo en vez de romper');

console.log('\n2) Cada cosa a su impresora');
store.qzImpresoras = JSON.stringify({ hoja: 'HP', etiqueta: 'XPrinter' });
ok(await run("qzImprimir('hoja', '<x>')") === true, 'la hoja sale por QZ');
let h = IMPRESOS.pop();
ok(h.impresora === 'HP', 'a la impresora de hojas', h.impresora);
ok(h.o.size.width === 148 && h.o.size.height === 210 && h.o.margins === 7, 'en A5 con 7mm de margen, como el @page', h.o);
ok(JSON.parse(h.data[0].data).sel === '.tk', 'una página por comprobante');
ok(h.data[0].type === 'pixel' && h.data[0].format === 'image', 'como imagen (el HTML de QZ dibuja a 96 dpi)');
ok(await run("qzImprimir('etiqueta', '<x>')") === true, 'la etiqueta sale por QZ');
h = IMPRESOS.pop();
ok(h.impresora === 'XPrinter', 'a la XPrinter', h.impresora);
ok(h.o.size.width === 40 && h.o.size.height === 30 && h.o.margins === 0, 'en 40×30 sin margen', h.o);
const e = JSON.parse(h.data[0].data);
ok(e.sel === '.pag' && e.byn === true && e.dpi === 203, 'una por etiqueta, en blanco y negro puro a la resolución de la térmica', e);
ctx.etqFormato = () => '30x40';
await run("qzImprimir('etiqueta', '<x>')");
h = IMPRESOS.pop();
ok(h.o.size.width === 30 && h.o.size.height === 40, 'parada: la página es 30×40, igual que en el diálogo', h.o.size);
ctx.etqFormato = () => '40x30';
ctx.etqEsA4 = () => true;
ok(await run("qzImprimir('etiqueta', '<x>')") === false, 'la hoja A4 de etiquetas sigue por el diálogo');
ctx.etqEsA4 = () => false;

console.log('\n3) Si QZ Tray no está, el ingreso igual tiene su hoja');
QZ_FALLA = true; TOASTS.length = 0;
ok(await run("qzImprimir('hoja', '<x>')") === false, 'QZ caído devuelve false (y print.js abre el diálogo)');
ok(TOASTS.some(t => /sin QZ · sale el diálogo de siempre/.test(t[1])), 'y avisa por qué falló y que salió por el diálogo');
QZ_FALLA = false;

console.log('\n4) Enganchado en print.js');
const pr = leer('print.js');
const ing = pr.slice(pr.indexOf('async function imprimirIngresoReparacion'), pr.indexOf('function _imprimirTocando'));
ok(/Promise\.all\(\[_imprimirDirecto\('hoja', hoja\), _imprimirDirecto\('etiqueta', etq\)\]\)/.test(ing),
   'ingreso: por QZ la hoja y la etiqueta salen a la vez (impresoras distintas, nada que esperar)');
ok(/if \(!hojaOk\) await _imprimirEnIframe\(hoja\)/.test(ing) && /if \(!etqOk\) await _imprimirEnIframe\(etq\)/.test(ing),
   'y la que no salió por QZ va por el diálogo');
const qzs = leer('qz-print.js');
ok(/toDataURL\(byn \? 'image\/png' : 'image\/jpeg', 0\.9\)/.test(qzs), 'la hoja viaja en JPEG (la mitad de peso); la térmica en PNG blanco y negro');
ok(/function qzPrecalentar/.test(qzs) && /addEventListener\('load', \(\) => setTimeout\(qzPrecalentar/.test(qzs),
   'al abrir la app se conecta con QZ Tray y despierta al server: la primera impresión no arranca en frío');
ok(/if \(!c\.hoja && !c\.etiqueta\) return;/.test(qzs.slice(qzs.indexOf('function qzPrecalentar'))), 'solo en la PC que tiene impresoras configuradas');
ok(/if \(!_qzCert\)/.test(qzs), 'el certificado se baja una vez por sesión');
const toc = pr.slice(pr.indexOf('function _imprimirTocando'), pr.indexOf('function _imprimirTocando') + 500);
ok(/!qzActivo\(tipo\)\) \{ _openPrint\(html, titulo\); return; \}/.test(toc),
   'botones sin QZ: la ventana se abre en el toque, como antes (si espera, el navegador la bloquea)');
['printEtiquetas(', 'printEtiquetasProductos(', 'printEtiquetasReparaciones(', 'printRepair('].forEach(fn => {
  const cuerpo = pr.slice(pr.indexOf('function ' + fn), pr.indexOf('function ' + fn) + 900);
  ok(/_imprimirTocando\('(hoja|etiqueta)'/.test(cuerpo), fn.slice(0, -1) + ' pasa por QZ cuando está configurado');
});
['index.html', 'caja.html'].forEach(f => {
  const s = leer(f);
  ok(s.indexOf('src="print.js"') >= 0 && s.indexOf('src="qz-print.js"') > s.indexOf('src="print.js"'), f + ' carga qz-print.js');
});
ok(fs.existsSync(DIR + 'vendor/qz-tray.js'), 'la librería de QZ Tray está en vendor/ (sin depender de un CDN)');
ok(!/src="vendor\/qz-tray\.js"/.test(leer('index.html')), 'y se carga recién cuando hace falta');

console.log('\n5) Firma');
const sign = leer('api/qz-sign.js');
ok(/exigirSesion\(req, res\)/.test(sign) && sign.indexOf('exigirSesion(req, res)') < sign.indexOf('process.env.QZ_PRIVATE_KEY'),
   'la firma pide sesión antes de tocar la clave');
ok(/createSign\('SHA512'\)/.test(sign) && /setSignatureAlgorithm\('SHA512'\)/.test(leer('qz-print.js')), 'server y navegador firman con el mismo algoritmo');
ok(/BEGIN CERTIFICATE/.test(leer('qz-cert.pem')), 'el certificado público está publicado');
const conClave = fs.readdirSync(DIR).filter(f => /\.(pem|key|crt)$/.test(f) && /PRIVATE KEY/.test(leer(f)));
ok(conClave.length === 0, 'ninguna clave privada en el repo', conClave);

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
