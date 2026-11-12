// 📱 El QR de la etiqueta de reparación. Alan (12/11): "agregarle un QR que
// lleve directo desde la cámara de otro equipo… a modificar si ya está
// listo, reparado, o para sacar datos del cliente".
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

console.log('\n1) El link del QR');
const pr = leer('print.js');
const cx = { console, Math, parseInt, Array, String, TextEncoder, Uint8Array, Error };
vm.createContext(cx);
vm.runInContext(leer('qr.js').replace(/if \(typeof module[^\n]*\n?/, '') + '\n' + pr.slice(pr.indexOf('const ETQ_APP_URL'), pr.indexOf('function _etiquetaRepHtml')), cx);
const run = c => vm.runInContext(c, cx);
ok(run('etqRepUrl({ nOrden: 8412 })') === 'https://stock-celulares-final.vercel.app/?r=8412', 'lleva a la app con el N° de orden (corto: menos cuadraditos)');
ok(run('etqRepUrl({})') === '' && run('etqRepUrl({ nOrden: "abc" })') === '' && run('_etqRepQr({})') === '', 'sin N° de orden no hay QR');
const svg = run('_etqRepQr({ nOrden: 8412 })');
const n = run('qrMatriz(etqRepUrl({ nOrden: 8412 })).length');
const mm = Number((svg.match(/width="([\d.]+)mm"/) || [])[1]);
const puntos = mm * 203 / 25.4 / (n + 2);
ok(Math.abs(puntos - 3) < 0.01, `cada cuadradito mide 3 puntos de la térmica (${n} módulos, ${mm}mm): menos no lo lee la cámara`, puntos);
ok(mm <= 14, 'y entra en la etiqueta de 40×30 dejando lugar al texto', mm);
ok(run('qrMatriz(etqRepUrl({ nOrden: 1234567 })).length') === n, 'con un N° de 7 cifras mide lo mismo');
ok(/_handleUrlAction/.test(pr.slice(pr.indexOf('Lleva un QR'), pr.indexOf('const ETQ_APP_URL'))), '(el comentario dice quién abre ese link)');

console.log('\n2) Escanearlo abre la ficha');
const app = leer('app.js');
const fn = (app.match(/function abrirRepairPorOrden\(nOrden\) \{[\s\S]*?\n\}/) || [''])[0];
const ABIERTAS = [], SECC = [], TOASTS = [], SS = {};
let CONSULTAS = 0, ENBASE = null;
const ax = {
  console, Number, Date, JSON,
  setTimeout: f => { ax._cola.push(f); }, _cola: [],
  document: { getElementById: () => ({ classList: { contains: () => ax.SIN_SESION } }) },
  sessionStorage: { removeItem: k => { delete SS[k]; } },
  switchSection: s => SECC.push(s), openRepairDetail: id => ABIERTAS.push(id), toast: m => TOASTS.push(m),
  REPAIRS: [], _repHistorial: [], _repPintar: () => { ax.REPAIRS.push(...ax._repHistorial); },
  db: { collection: () => ({ where: (c, op, v) => ({ limit: () => ({ get: async () => { CONSULTAS++; return ENBASE && ENBASE.nOrden === v ? { empty: false, size: 1, docs: [{ id: ENBASE.id, data: () => ENBASE }] } : { empty: true, size: 0, docs: [] }; } }) }) }) },
};
vm.createContext(ax);
vm.runInContext(fn, ax);
const girar = async (veces = 60) => { for (let i = 0; i < veces && ax._cola.length; i++) { ax._cola.shift()(); await new Promise(r => setImmediate(r)); } };
(async () => {
  SS.tpRepQr = 'x';
  ax.REPAIRS = [{ id: 'abc', nOrden: 8412 }]; vm.runInContext('REPAIRS = this.REPAIRS', ax);
  vm.runInContext('abrirRepairPorOrden(8412)', ax); await girar();
  ok(ABIERTAS[0] === 'abc' && SECC[0] === 'repairs' && CONSULTAS === 0, 'si está entre las cargadas, entra a Reparaciones y abre su ficha (sin leer nada de más)', [ABIERTAS, SECC, CONSULTAS]);
  ok(!('tpRepQr' in SS), 'y no queda pendiente');
  // Una vieja: no está en memoria → una sola lectura
  ABIERTAS.length = 0; ax._cola.length = 0; ENBASE = { id: 'vieja', nOrden: 5001 };
  vm.runInContext('abrirRepairPorOrden(5001)', ax); await girar();
  ok(CONSULTAS === 1 && ABIERTAS[0] === 'vieja', 'una de hace meses la busca en la base (una lectura) y la abre', [CONSULTAS, ABIERTAS]);
  ABIERTAS.length = 0; ax._cola.length = 0; CONSULTAS = 0; ENBASE = null;
  vm.runInContext('abrirRepairPorOrden(999999)', ax); await girar();
  ok(CONSULTAS === 1 && !ABIERTAS.length && /No encontré la reparación N° 999999/.test(TOASTS.join()), 'si ese N° no existe, lo dice');
  // Sin sesión: espera (y el pendiente queda guardado para después del login)
  ABIERTAS.length = 0; ax._cola.length = 0; ax.SIN_SESION = true;
  vm.runInContext('abrirRepairPorOrden(8412)', ax); await girar(10);
  ok(!ABIERTAS.length && ax._cola.length === 1, 'sin sesión iniciada espera, no abre nada');
  ok(/sessionStorage\.setItem\('tpRepQr', JSON\.stringify\(\{ n: nOrdenQr, t: Date\.now\(\) \}\)\)/.test(app) && /Date\.now\(\) - p\.t < 10 \* 60 \* 1000/.test(app), 'el escaneo queda guardado 10 minutos: si te manda al login, al entrar abre la ficha igual');
  ok(/parseInt\(params\.get\('r'\), 10\)/.test(app) && /if \(nOrdenQr\) abrirRepairPorOrden\(nOrdenQr\);/.test(app), 'el link ?r=N lo toma la app al abrir');

  console.log('\n3) En la etiqueta');
  ok(/\$\{qr \? `<div class="etqr-qr">\$\{qr\}<\/div>` : ''\}\s*\$\{patron \? `<div class="etqr-patron">/.test(pr), 'el QR arriba a la derecha y el patrón de desbloqueo abajo');
  ok(/\.etqr--qr \.etqr-eq\{white-space:normal/.test(pr), 'el nombre del equipo va en dos renglones (con el QR al lado se cortaba)');
  ok(/<script[^>]*src="qr\.js"/.test(leer('index.html')) && /<script[^>]*src="qr\.js"/.test(leer('caja.html')), 'el generador de QR está cargado donde se imprimen etiquetas');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
