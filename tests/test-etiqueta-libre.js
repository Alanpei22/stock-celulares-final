// La etiqueta en blanco: la que dice lo que uno quiera.
//
// Las otras salen de algo cargado (un equipo, un repuesto, una reparación).
// Esta no: se escriben los renglones y sale. Para rotular un cajón, una caja,
// el equipo de un cliente.
//
// Lo que se prueba acá es que entre en la etiqueta de verdad: son 40×30 mm y
// ahí no entra cualquier cosa, y que salga por el mismo camino y con el mismo
// tamaño de rollo que el resto (no sirve una que te obligue a cambiar la
// configuración de la impresora para imprimir una sola).
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const LS = {};
const IMPRESO = [];
const els = {};
const el = id => els[id] = { id, value: '', textContent: '', innerHTML: '', srcdoc: '', disabled: false,
  style: {}, clientWidth: 300,
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  removeAttribute(a) { this[a] = ''; }, setAttribute() {}, addEventListener() {}, focus() {} };
['etql-modal', 'etql-overlay', 'etql-titulo', 'etql-l1', 'etql-l2', 'etql-l3', 'etql-codigo',
 'etql-copias', 'etql-prev', 'etql-prev-wrap', 'etql-nota', 'etql-imprimir'].forEach(el);

const ctx = {
  console, Math, JSON, Date, Number, String, Object, Array, isFinite, parseInt, parseFloat, Set, Map,
  setTimeout: f => f(), clearTimeout,
  document: { getElementById: id => els[id] || null, querySelectorAll: () => [],
              createElement: () => ({ style: {}, setAttribute() {}, remove() {}, addEventListener() {} }),
              body: { style: {}, appendChild() {} }, addEventListener() {} },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
  localStorage: { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: k => { delete LS[k]; } },
  navigator: { maxTouchPoints: 0 },
  toast: () => {}, alert: () => {},
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('barcode.js'), ctx, { filename: 'barcode.js' });
vm.runInContext(leer('print.js'), ctx, { filename: 'print.js' });
vm.runInContext(leer('etiqueta-libre.js'), ctx, { filename: 'etiqueta-libre.js' });
// La impresión de verdad se cambia por una libreta.
vm.runInContext('_imprimirTocando = (tipo, html, t) => __IMP(tipo, html); _openPrint = html => __IMP("open", html);', ctx);
ctx.__IMP = (tipo, html) => IMPRESO.push({ tipo, html });
const run = e => vm.runInContext(e, ctx);
const call = (f, ...a) => { ctx.__a = a; return run(`${f}(...__a)`); };

const CAJON = { titulo: 'CAJÓN 3', lineas: ['Fundas iPhone', 'Reponer el viernes', ''], codigo: '', copias: 1 };

console.log('\n1) Dice lo que escribiste');
let h = call('etiquetaLibreHtml', CAJON);
ok(/CAJ&Oacute;N 3|CAJÓN 3/.test(h), 'el renglón grande', h.slice(0, 120));
ok(/Fundas iPhone/.test(h) && /Reponer el viernes/.test(h), 'y los de abajo');
ok(!/><\/div>/.test(h.replace(/<div class="etq">/, '')), 'sin renglones vacíos de relleno');

// Lo que se escribe es texto, no HTML: si no, un "<" rompe la etiqueta.
h = call('etiquetaLibreHtml', { titulo: '<b>ojo</b>', lineas: [], codigo: '' });
ok(/&lt;b&gt;/.test(h) && !/<b>ojo/.test(h), 'lo tipeado se escapa, no se interpreta', h.slice(0, 140));

console.log('\n2) Vacía no se imprime');
ok(call('etqlVacia', { titulo: '', lineas: ['', ''], codigo: '' }) === true, 'sin nada escrito, está vacía');
ok(call('etqlVacia', { titulo: '', lineas: ['', 'algo'], codigo: '' }) === false, 'con un renglón, no');
ok(call('etqlVacia', { titulo: '', lineas: [], codigo: 'TP1' }) === false, 'con un código, tampoco');
IMPRESO.length = 0;
run("ETQL = { titulo: '', lineas: ['', '', ''], codigo: '', copias: 1 }");
run('etiquetaLibreImprimir()');
ok(IMPRESO.length === 0, 'y no manda nada a la impresora', IMPRESO.length);

console.log('\n3) El código de barras');
h = call('etiquetaLibreHtml', { titulo: 'VIDRIOS', lineas: [], codigo: 'TP00412' });
ok(/<svg/.test(h), 'un código corto sale en barras');
// Un código largo no entra en 38mm con el mínimo que lee el lector: antes de
// imprimir barras ilegibles, va escrito.
h = call('etiquetaLibreHtml', { titulo: 'X', lineas: [], codigo: 'ESTE-CODIGO-ES-LARGUISIMO-123456' });
ok(!/<svg/.test(h), 'uno muy largo no sale en barras');
ok(/etq-cod/.test(h), 'pero sale escrito, que es mejor que nada', h);

console.log('\n4) Las copias');
run("ETQL = { titulo: 'CAJÓN', lineas: [], codigo: '', copias: 3 }");
let doc = run('etiquetaLibreDoc()');
ok((doc.match(/class="etq"/g) || []).length === 3, 'tres copias, tres etiquetas', (doc.match(/class="etq"/g) || []).length);
run("ETQL.copias = 999");
ok((run('etiquetaLibreDoc()').match(/class="etq"/g) || []).length === 20, 'el tope es 20: no se vacía el rollo por un cero de más');
run("ETQL.copias = 0");
ok((run('etiquetaLibreDoc()').match(/class="etq"/g) || []).length === 1, 'y nunca menos de una');

console.log('\n5) Sale por donde salen todas');
run("ETQL = { titulo: 'CAJÓN 3', lineas: ['Fundas'], codigo: '', copias: 1 }");
IMPRESO.length = 0;
run('etiquetaLibreImprimir()');
ok(IMPRESO.length === 1, 'se manda a imprimir');
ok(IMPRESO[0].tipo === 'etiqueta', 'por la etiquetadora, no por la hoja', IMPRESO[0].tipo);
ok(/@page/.test(IMPRESO[0].html) && /CAJ/.test(IMPRESO[0].html), 'con la etiqueta adentro');
// El tamaño de rollo es el que ya esté elegido: no hay que cambiar nada para
// imprimir una suelta.
run("setEtqFormato('40x30')");
ok(/size:40mm 30mm/.test(run('etiquetaLibreDoc()')), 'respeta el formato elegido (40×30)');
run("setEtqFormato('30x40')");
ok(/size:30mm 40mm/.test(run('etiquetaLibreDoc()')), 'y el otro también (30×40)');

console.log('\n6) La vista previa se ve derecha');
// En el papel la etiqueta sale girada (el rollo de 30×40 entra parado). En
// pantalla eso se lee al revés, así que el marco se gira al revés. Los dos
// giros tienen que cancelarse.
const src = leer('etiqueta-libre.js');
const prev = src.slice(src.indexOf('function _etqlAcomodarPrev'), src.indexOf('function _etqlAcomodarPrev') + 1200);
const giroDoc = f => { run(`setEtqFormato('${f}')`); const d = run('etiquetaLibreDoc()');
  const m = d.match(/\.pag > \.etq[^{]*\{([^}]*)\}/); const g = (m && m[1].match(/rotate\((-?\d+)deg\)/)); return g ? Number(g[1]) : 0; };
ok(giroDoc('30x40') === 90, 'el rollo parado gira la etiqueta 90°', giroDoc('30x40'));
ok(giroDoc('40x30') === 0, 'el apaisado no la gira');
ok(giroDoc('40x30r') === 180, 'y el dado vuelta, 180°');
ok(/parada \? -90 : \(f === '40x30r' \? 180 : 0\)/.test(prev),
   'la vista previa compensa cada uno de esos giros', prev.slice(0, 400));

console.log('\n7) Se acuerda de lo último');
// Se imprimen de a tandas: tener que escribir todo de nuevo para la segunda
// es la forma más rápida de que nadie la use.
run("ETQL = { titulo: 'GÓNDOLA 2', lineas: ['Vidrios'], codigo: '', copias: 2 }");
run('_etqlGuardar()');
ok(!!LS.etqLibre, 'queda guardado en el aparato', Object.keys(LS));
run("ETQL = { titulo: '', lineas: ['', '', ''], codigo: '', copias: 1 }");
run('_etqlCargar()');
ok(run('ETQL.titulo') === 'GÓNDOLA 2' && run('ETQL.copias') === 2, 'y vuelve como estaba', run('JSON.stringify(ETQL)'));

console.log('\n8) Enganchado en Equipos');
const idx = leer('index.html');
ok(/etiqueta-libre\.js/.test(idx), 'el script se carga');
ok(/id="etql-modal"/.test(idx), 'y el cuadro está en la página');
const app = leer('app.js');
const menu = app.slice(app.indexOf('function toggleHdrMenu'), app.indexOf('function closeHdrMenu'));
ok(/etiquetaLibreAbrir\(\)/.test(menu), 'se entra desde el menú de Equipos', menu.slice(0, 80));

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
