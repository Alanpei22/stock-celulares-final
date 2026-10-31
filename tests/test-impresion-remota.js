// 🖨️ Imprimir desde otro equipo en la compu de la caja (qz-print.js).
//
// Alan: "que desde otro equipo se imprima en el equipo que tiene programadas
// las impresoras". Lo que se cuida:
//  · el equipo sin impresora manda IMÁGENES (no HTML: la caja no ejecuta nada
//    ajeno), partidas para que entren en un documento;
//  · la caja imprime cada pedido una sola vez y lo borra;
//  · un pedido viejo (la caja estaba apagada) no sale de golpe a la mañana;
//  · si la caja no tiene esa impresora, avisa en vez de tragárselo.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

(async () => {
const LS = {}, DB = {}, TOASTS = [], PRINTS = [];
let nid = 0;
const ref = (col, id) => ({
  id, path: col + '/' + id,
  get: async () => ({ exists: !!DB[col + '/' + id], data: () => DB[col + '/' + id] && Object.assign({}, DB[col + '/' + id]) }),
  set: async v => { DB[col + '/' + id] = Object.assign({}, v); },
  update: async v => { DB[col + '/' + id] = Object.assign({}, DB[col + '/' + id], v); },
  delete: async () => { delete DB[col + '/' + id]; },
  onSnapshot: () => () => {},
});
const db = {
  collection: col => ({
    doc: id => ref(col, id),
    add: async v => { const id = 'j' + (++nid); DB[col + '/' + id] = Object.assign({}, v); return ref(col, id); },
    where: () => ({ onSnapshot: () => () => {} }),
  }),
  runTransaction: async fn => fn({ get: r => r.get(), update: (r, v) => { DB[r.path] = Object.assign({}, DB[r.path], v); } }),
};
const ctx = { console, Math, Date, JSON, Number, String, Array, Object, Promise, Error, setTimeout, clearTimeout,
  localStorage: { getItem: k => LS[k] ?? null, setItem: (k, v) => { LS[k] = String(v); } },
  toast: (m, k) => TOASTS.push([k, m]), db, getDeviceName: () => 'Celu de Nacho',
  qz: { websocket: { isActive: () => true }, configs: { create: (imp, o) => ({ imp, o }) }, print: async (cfg, data) => { PRINTS.push({ cfg, data }); } },
};
vm.createContext(ctx);
vm.runInContext(leer('qz-print.js'), ctx, { filename: 'qz-print.js' });
// Las imágenes las arma Chrome; acá se simula
vm.runInContext(`_qzPaginasPng = async () => { const p = ['PAG1', 'PAG2']; p.altos = [60, 61]; return p; }; qzConectar = async () => true;`, ctx);
const run = c => vm.runInContext(c, ctx);

console.log('\n1) El equipo sin impresora');
ok(run(`qzActivo('ticket')`) === false, 'sin impresora y sin caja que imprima: va el diálogo de siempre');
LS.qzRemota = JSON.stringify({ tipos: { ticket: true, etiqueta: true, hoja: false }, nombre: 'Compu caja' });
ok(run(`qzActivo('ticket')`) && run(`qzActivo('etiqueta')`) && !run(`qzActivo('hoja')`), 'si la caja imprime tickets y etiquetas: esos salen sin diálogo; la hoja, con diálogo');
const okEnvio = await run(`qzImprimir('ticket', '<div class="tkt">hola</div>')`);
const jobs = Object.keys(DB).filter(k => k.startsWith('cola_impresion/'));
const job = DB[jobs[0]];
ok(okEnvio === true && jobs.length === 1 && job.estado === 'pendiente' && job.tipo === 'ticket', 'deja el pedido en la cola', job);
ok(job.pngs.join() === 'PAG1,PAG2' && job.altos.join() === '60,61' && !('html' in job), 'manda las IMÁGENES, no el HTML');
ok(job.de === 'Celu de Nacho' && job.pag.papelAncho === 58, 'quién lo mandó y el tamaño del papel');
ok(TOASTS.some(([k, m]) => /Mandado a la impresora de Compu caja/.test(m)), 'avisa adónde fue');

console.log('\n2) Pedidos grandes');
const partes = run(`qzPartirPaginas(['a'.repeat(400), 'b'.repeat(400), 'c'.repeat(400)], [1, 2, 3], 900)`);
ok(partes.length === 2 && partes[0].pngs.length === 2 && partes[1].altos[0] === 3, 'se parten para que entren en un documento');

console.log('\n3) La compu de la caja');
LS.qzServidor = '1';
LS.qzImpresoras = JSON.stringify({ hoja: '', etiqueta: 'XPrinter', ticket: 'XPrinter 58' });
ok(run(`qzActivo('ticket')`) && !run(`qzRemotaActiva('ticket')`), 'la caja imprime con lo suyo (no se manda a sí misma)');
ctx._r = db.collection('cola_impresion').doc(jobs[0].split('/')[1]);
await run(`qzServidorImprimir(_r)`);
ok(PRINTS.length === 1 && PRINTS[0].cfg.imp === 'XPrinter 58' && PRINTS[0].data.map(d => d.data).join() === 'PAG1,PAG2', 'lo imprime en SU impresora de tickets', PRINTS[0] && PRINTS[0].cfg);
ok(PRINTS[0].cfg.o.size.width === 58 && PRINTS[0].cfg.o.size.height === 61, 'con el tamaño que mandó el otro equipo');
ok(!DB[jobs[0]], 'y borra el pedido (no queda ocupando lugar)');
await run(`qzServidorImprimir(_r)`);
ok(PRINTS.length === 1, 'no lo imprime dos veces');

DB['cola_impresion/viejo'] = { tipo: 'ticket', pag: job.pag, pngs: ['X'], altos: [10], estado: 'pendiente', creado: Date.now() - 2 * 3600e3 };
ctx._r = db.collection('cola_impresion').doc('viejo');
await run(`qzServidorImprimir(_r)`);
ok(PRINTS.length === 1 && DB['cola_impresion/viejo'].estado === 'vencido', 'uno de hace 2 horas (la caja estaba apagada) no sale: queda "vencido"');

DB['cola_impresion/hoja'] = { tipo: 'hoja', pag: { papelAncho: 148, papelAlto: 210, alto: 196, margen: 7 }, pngs: ['H'], altos: [196], estado: 'pendiente', creado: Date.now() };
ctx._r = db.collection('cola_impresion').doc('hoja');
await run(`qzServidorImprimir(_r)`);
ok(DB['cola_impresion/hoja'].estado === 'error' && /no tiene impresora para hoja/.test(DB['cola_impresion/hoja'].error), 'si la caja no tiene esa impresora: queda el error (y el otro equipo se entera)');

console.log('\n4) Prender el modo "imprime lo de los demás"');
LS.qzServidor = '0';
await run(`qzServidorConfigurar(true)`);
const cfg = DB['config/impresoraRemota'];
ok(LS.qzServidor === '1' && cfg.activa === true && cfg.tipos.ticket === true && cfg.tipos.etiqueta === true && cfg.tipos.hoja === false, 'queda anotado qué imprime la caja', cfg);
ok(/Celu de Nacho|la caja/.test(cfg.nombre), 'con el nombre del equipo');

console.log('\n4b) El sentido de la etiqueta es el de la caja');
// Antes cada equipo usaba su sentido (se guarda por equipo) y desde el celu la
// etiqueta salía distinta que desde la caja.
const p2 = { console, Math, Date, JSON, Number, String, Array, Object, Promise, Error, setTimeout, clearTimeout,
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } }, db, getDeviceName: () => 'Compu caja' };
vm.createContext(p2);
vm.runInContext(leer('qz-print.js') + '\n' + leer('print.js').slice(0, leer('print.js').indexOf('function elegirFormatoEtiqueta')), p2, { filename: 'print+qz' });
p2.localStorage.setItem('etqFmt', '40x30r');                     // así la eligió el dueño en la caja
p2.localStorage.setItem('qzImpresoras', JSON.stringify({ etiqueta: 'XPrinter' }));
p2.localStorage.setItem('qzServidor', '1');
await vm.runInContext(`_qzServidorPublicar(true)`, p2);
ok(DB['config/impresoraRemota'].etqFmt === '40x30r', 'la caja publica su sentido de etiqueta');
const celu = { console, Math, Date, JSON, Number, String, Array, Object, Promise, Error, setTimeout, clearTimeout,
  localStorage: { _d: { etqFmt: '30x40', qzRemota: JSON.stringify({ tipos: { etiqueta: true }, nombre: 'Compu caja', etqFmt: '40x30r' }) }, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } } };
vm.createContext(celu);
vm.runInContext(leer('qz-print.js') + '\n' + leer('print.js').slice(0, leer('print.js').indexOf('function elegirFormatoEtiqueta')), celu, { filename: 'print+qz' });
ok(vm.runInContext(`etqFormato()`, celu) === '40x30r', 'el celu (que tenía otro guardado) arma la etiqueta con el sentido de la caja');
celu.localStorage._d.qzRemota = 'null';
ok(vm.runInContext(`etqFormato()`, celu) === '30x40', 'sin caja que imprima por él, vuelve a usar el suyo');

console.log('\n4c) Una etiqueta armada en otro sentido no se gasta');
LS.qzServidor = '1'; LS.etqFmt = '40x30r';
LS.qzImpresoras = JSON.stringify({ etiqueta: 'XPrinter', ticket: 'XPrinter 58' });
const antes = PRINTS.length;
vm.runInContext(leer('print.js').slice(0, leer('print.js').indexOf('function elegirFormatoEtiqueta')), ctx, { filename: 'print' });
DB['cola_impresion/etq'] = { tipo: 'etiqueta', fmt: '30x40', pag: { papelAncho: 30, papelAlto: 40, alto: 40, margen: 0 }, pngs: ['E'], altos: [40], estado: 'pendiente', creado: Date.now() };
ctx._r = db.collection('cola_impresion').doc('etq');
await run(`qzServidorImprimir(_r)`);
ok(PRINTS.length === antes && DB['cola_impresion/etq'].estado === 'error' && /otro sentido \(30x40, la caja usa 40x30r\)/.test(DB['cola_impresion/etq'].error), 'no la imprime y avisa por qué', DB['cola_impresion/etq']);
ok(DB['config/impresoraRemota'].etqFmt === '40x30r', 'y vuelve a avisar el sentido correcto');
DB['cola_impresion/etq2'] = Object.assign({}, DB['cola_impresion/etq'], { fmt: '40x30r', estado: 'pendiente' });
ctx._r = db.collection('cola_impresion').doc('etq2');
await run(`qzServidorImprimir(_r)`);
ok(PRINTS.length === antes + 1 && !DB['cola_impresion/etq2'], 'armada en el sentido de la caja: sale');
ok(/_qzServidorPublicar\(true\)\.catch\(\(\) => \{\}\);\n  _qzServUnsub = db\.collection\('cola_impresion'\)/.test(leer('qz-print.js')), 'la caja avisa su sentido cada vez que abre la app');

console.log('\n5) Reglas');
const rules = leer('firestore.rules');
ok(/match \/cola_impresion\/\{doc\} \{\s*allow read, create, update, delete: if isAllowed\(\);/.test(rules), 'la cola la usan solo las cuentas del local');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})();
