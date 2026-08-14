// Fase 3: documento público, QR en los comprobantes y página del cliente.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── Contexto compartido: qr.js + tp-fases.js + seguimiento.js + print.js ──
const WRITES = [];
const ctx = {
  console, setTimeout, clearTimeout,
  crypto: require('crypto').webcrypto,
  TextEncoder, btoa: s => Buffer.from(s, 'binary').toString('base64'),
  unescape, encodeURIComponent, decodeURIComponent,
  location: { origin: 'https://stock-celulares-final.vercel.app' },
  window: { _DAKI_NAME: 'TechPoint' },
  document: { getElementById: () => null, addEventListener: () => {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { onLine: true },
  toast: () => {}, esc: s => String(s == null ? '' : s),
  BIZ_DATA: { dir: 'J.J. de Urquiza 4741 — Local 22', tel: '11 7239-2511', extra: 'Lun a Sáb 9 a 19' },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const f of ['qr.js', 'tp-fases.js', 'seguimiento.js', 'print.js']) {
  vm.runInContext(fs.readFileSync(DIR + f, 'utf8'), ctx, { filename: f });
}
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);
run(`db = { collection: n => ({ doc: id => ({
        set: async (d, o) => { __W.push(['set', n, id, d]); },
        update: async d => { __W.push(['update', n, id, d]); },
      }) }) };`);
ctx.__W = WRITES;

const REP = {
  id: 'lz9k2f3ab1', nOrden: 7123, marca: 'Samsung', modelo: 'Galaxy A54',
  imei: '356789102345678', arreglo: 'Módulo / Pantalla', condicion: 'Pantalla rota, marco sano',
  codigo: '1234', patron: [0,1,2], monto: 85000, sena: 20000, costo: 30000,
  nombre: 'Marina Suárez', tlf: '11 6988-7744', dni: '38111222',
  diagnostico: 'Tristar en corto', observaciones: 'Cliente apurado',
  estado: 'reparando', fase: 'repuesto',
  faseHist: [{ f: 'ingresado', t: '2026-08-01T10:00:00.000Z' }, { f: 'diagnostico', t: '2026-08-01T14:00:00.000Z' }, { f: 'repuesto', t: '2026-08-02T09:00:00.000Z' }],
  fechaIngreso: '2026-08-01T10:00:00.000Z', fechaEstimada: '2026-08-06',
  diasGarantia: 90, tokenSeguimiento: 'k3n8x2p9qm4vb7ctd5ef',
};

console.log('\n1) Lo que se publica NO tiene datos sensibles');
ctx.__REP = REP;
const pub = get('_segDocPublico(__REP, "repuesto")');
const prohibidos = ['tlf', 'telefono', 'nombre', 'dni', 'monto', 'sena', 'costo', 'precio',
                    'codigo', 'patron', 'diagnostico', 'observaciones', 'arreglo', 'imei',
                    'condicion', 'tecnico'];
const claves = Object.keys(pub);
const filtrados = prohibidos.filter(k => claves.includes(k));
ok(filtrados.length === 0, 'ninguna clave sensible en el documento público', { claves, filtrados });
const json = JSON.stringify(pub);
ok(!/6988|Marina|Su[aá]rez|38111222|85000|1234|Tristar|apurado/i.test(json),
   'ningún valor sensible se cuela en el contenido', json);
ok(!/M[oó]dulo|Pantalla rota/i.test(json), 'no publica el trabajo técnico ni la condición', json);
ok(pub.imei4 === '5678', 'solo los últimos 4 del IMEI', pub.imei4);
ok(!json.includes('356789102345'), 'el IMEI completo no aparece', pub.imei4);

console.log('\n2) Traducción a idioma de cliente');
ok(pub.titulo === 'Esperando el repuesto', 'título en criollo', pub.titulo);
ok(/te avisamos/i.test(pub.detalle), 'detalle explicando, no jerga', pub.detalle);
ok(pub.paso === 2, 'esperando repuesto cae en el paso "En reparación"', pub.paso);
const pubD = get('_segDocPublico(__REP, "diagnostico")');
ok(pubD.paso === 1 && /revis/i.test(pubD.titulo), 'diagnóstico → "En revisión"', pubD);
const pubI = get('_segDocPublico(__REP, "irreparable")');
ok(pubI.cerradaSinArreglo === true, 'marca las cerradas sin arreglo', pubI.cerradaSinArreglo);

console.log('\n3) Historial público: un paso por etapa, sin repetir');
ok(Array.isArray(pub.historial) && pub.historial.length === 3, '3 entradas del historial', pub.historial);
ok(pub.historial.every(h => Object.keys(h).join() === 'paso,fecha'), 'solo paso y fecha', pub.historial[0]);
ctx.__REP2 = Object.assign({}, REP, { faseHist: [
  { f: 'ingresado', t: '2026-08-01T10:00:00.000Z' },
  { f: 'diagnostico', t: '2026-08-01T14:00:00.000Z' },
  { f: 'presupuestado', t: '2026-08-01T16:00:00.000Z' },
  { f: 'aprobado', t: '2026-08-01T18:00:00.000Z' },
] });
const pub2 = get('_segDocPublico(__REP2, "aprobado")');
ok(pub2.historial.length === 2, 'diagnóstico+presupuesto+aprobado son un solo paso visible', pub2.historial);

console.log('\n4) Token y URL');
const t1 = get('_segNuevoToken()'), t2 = get('_segNuevoToken()');
ok(t1.length === 20, 'token de 20 caracteres', t1);
ok(t1 !== t2, 'no se repite', [t1, t2]);
ok(!/[lo01]/.test(t1 + t2), 'sin caracteres que se confunden al leer', t1 + t2);
const u = get('urlSeguimiento(__REP)');
ok(/\?o=7123&k=k3n8x2p9qm4vb7ctd5ef$/.test(u), 'URL con orden + token', u);
ok(!u.includes(REP.id), 'la URL no expone el id interno', u);
ctx.__SIN = Object.assign({}, REP, { tokenSeguimiento: null });
ok(/\?id=lz9k2f3ab1$/.test(get('urlSeguimiento(__SIN)')), 'sin token cae al formato viejo (compatibilidad)', get('urlSeguimiento(__SIN)'));

const espera = ms => new Promise(r => setTimeout(r, ms));

(async () => {

console.log('\n5) Publicación en Firestore');
WRITES.length = 0;
ctx.__POST = Object.assign({}, REP, { fechaIngreso: '2026-08-20T10:00:00.000Z' });
await get('upsertSeguimientoPublico(__POST)');
const escrituras = WRITES.filter(w => w[1] === 'seguimiento_publico');
ok(escrituras.length === 1, 'una sola escritura para una orden nueva (ya con QR nuevo)', WRITES.map(w => w.slice(0, 3)));
ok(escrituras[0][2] === REP.tokenSeguimiento, 'el documento vive bajo el token, no bajo el id interno', escrituras[0][2]);

WRITES.length = 0;
ctx.__VIEJA = Object.assign({}, REP, { fechaIngreso: '2026-06-15T10:00:00.000Z' });
await get('upsertSeguimientoPublico(__VIEJA)');
const ids = WRITES.filter(w => w[1] === 'seguimiento_publico').map(w => w[2]);
ok(ids.length === 2 && ids.includes(REP.id), 'las órdenes viejas siguen publicando el documento del QR ya impreso', ids);

WRITES.length = 0;
ctx.__NUEVA = Object.assign({}, REP, { tokenSeguimiento: null, fechaIngreso: '2026-08-10T10:00:00.000Z' });
await get('upsertSeguimientoPublico(__NUEVA)');
const upd = WRITES.find(w => w[0] === 'update' && w[1] === 'repairs');
ok(!!upd && typeof upd[3].tokenSeguimiento === 'string' && upd[3].tokenSeguimiento.length === 20,
   'si una orden no tiene token se le genera y se le guarda', upd && upd[3]);

// ── Impresión: el QR queda dentro del comprobante ──
console.log('\n6) Comprobantes con el QR adentro (render en node)');
// El A4 se borró de print.js (nadie lo llamaba desde la interfaz), así que
// acá quedó solo el A5, que es el único comprobante de recepción que existe.
const a5 = get('_buildA5(__REP)');
ok(/<svg/.test(a5), 'A5 lleva el QR embebido', a5.length);
ok(/fir-qr[\s\S]{0,400}<svg/.test(a5), 'A5: el QR va dentro del recuadro de firmas (no suma alto a la hoja)');
ok(/Seguí tu reparación/.test(a5), 'A5 explica para qué es');
ok(/\.fir-qr svg\{width:19mm/.test(a5), 'A5: QR de 19 mm (el alto de la hoja manda)');
ok(/192\*MM/.test(a5), 'A5 trae el auto-ajuste a una hoja (192mm = 196 útiles − 4 de colchón)');

// ── Las dos causas por las que salía una segunda hoja ──
// 1) transform:scale() achica lo que se ve pero NO el espacio que ocupa, así que
//    el navegador cortaba la hoja igual. Tiene que ser zoom.
ok(!/transform\s*=\s*'scale/.test(a5) && /style\.zoom/.test(a5),
   'A5: el auto-ajuste usa zoom (transform no achica el espacio y la hoja se parte igual)');
// 2) page-break-after:always + :last-child dejó de aplicar cuando se agregó el
//    script al final del body → salía una hoja en blanco.
ok(/\.tk\{page-break-after:auto\}/.test(a5) && /\.tk \+ \.tk\{page-break-before:always\}/.test(a5),
   'A5: el corte de hoja va ENTRE comprobantes, nunca después del último');
ok(!/:last-child\s*\{\s*page-break-after/.test(a5),
   'no se depende de :last-child (el script del auto-ajuste va después y lo rompía)');
ok(!/qrserver|<img[^>]+https?:/.test(a5), 'el comprobante no pide imágenes a internet');
ok(a5.includes('356789102345678'), 'el IMEI completo SÍ va en el comprobante del cliente (es su equipo)');
const svgA5 = a5.match(/<svg[\s\S]*?<\/svg>/)[0];
ok(/viewBox="0 0 (\d+) \1"/.test(svgA5), 'QR cuadrado');
ok(/fill="#fff"/.test(svgA5), 'con fondo blanco (zona de silencio)');

console.log('\n7) La página del cliente');
const html = fs.readFileSync(DIR + 'estado.html', 'utf8');
ok(!/<script[^>]+src=/.test(html), 'no carga ningún script externo (ni Firebase ni CDN)');
ok(!/(src|href)\s*=\s*"https?:/i.test(html), 'ninguna etiqueta apunta afuera (ni CDN ni fuentes)',
   (html.match(/(src|href)\s*=\s*"https?:[^"]*/gi) || []));
ok(!/gstatic|jsdelivr|unpkg|googleapis\.com\/css/i.test(html), 'sin Firebase SDK ni fuentes de Google',
   (html.match(/gstatic|jsdelivr|unpkg/gi) || []));
ok(/firestore\.googleapis\.com/.test(html), 'lee Firestore por REST');
ok(/setInterval\([\s\S]{0,80}60000\)/.test(html), 'autorefresco cada 60 s');
ok(/document\.hidden/.test(html), 'no refresca con la pestaña oculta (ahorra datos del cliente)');
ok(/noindex/.test(html), 'no se indexa en Google');

// Ejecutar la lógica de la página con un DOM mínimo
const scriptTxt = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function correrPagina(query, docFirestore, status) {
  const nodos = {};
  ['biz', 'body', 'pie', 'wa'].forEach(id => nodos[id] = { id, innerHTML: '', textContent: '', href: '' });
  const c = {
    console,
    document: {
      getElementById: id => nodos[id] || null,
      addEventListener: () => {}, hidden: false, title: '',
    },
    location: { search: query },
    URLSearchParams, encodeURIComponent, setInterval: () => 0, setTimeout: () => 0,
    fetch: async () => ({
      ok: status === 200, status,
      json: async () => docFirestore,
    }),
  };
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(scriptTxt, c, { filename: 'estado.html' });
  return { nodos, c };
}
// Documento tal cual lo devuelve la API REST de Firestore
const docREST = { fields: {
  nOrden: { integerValue: '7123' }, negocio: { stringValue: 'TechPoint' },
  equipo: { stringValue: 'Samsung Galaxy A54' }, imei4: { stringValue: '5678' },
  paso: { integerValue: '2' }, cerradaSinArreglo: { booleanValue: false },
  titulo: { stringValue: 'Esperando el repuesto' },
  detalle: { stringValue: 'Estamos esperando que llegue el repuesto.' },
  fechaIngreso: { stringValue: '2026-08-01T10:00:00.000Z' },
  fechaEstimada: { stringValue: '2026-08-06' },
  bizDir: { stringValue: 'J.J. de Urquiza 4741 — Local 22' },
  bizTel: { stringValue: '11 7239-2511' },
  bizExtra: { stringValue: 'Lun a Sáb 9 a 19' },
  historial: { arrayValue: { values: [
    { mapValue: { fields: { paso: { integerValue: '0' }, fecha: { stringValue: '2026-08-01T10:00:00.000Z' } } } },
    { mapValue: { fields: { paso: { integerValue: '2' }, fecha: { stringValue: '2026-08-02T09:00:00.000Z' } } } },
  ] } },
} };

const bien = correrPagina('?o=7123&k=k3n8x2p9qm4vb7ctd5ef', docREST, 200);
await espera(30);
{
  const b = bien.nodos.body.innerHTML;
  ok(/Samsung Galaxy A54/.test(b), 'muestra el equipo', b.slice(0, 100));
  ok(/Orden N°7123/.test(b), 'muestra el número de orden');
  ok(/•••• 5678/.test(b), 'muestra solo los últimos 4 del IMEI');
  ok(/Esperando el repuesto/.test(b), 'muestra el estado en criollo');
  ok(/paso-b ahora/.test(b), 'marca el paso actual en la barra');
  ok(/Escribinos por WhatsApp/.test(b), 'botón de WhatsApp');
  ok(/5491172392511/.test(bien.nodos.wa.href) && /7123/.test(bien.nodos.wa.href),
     'el WhatsApp lleva el número del local y la orden', bien.nodos.wa.href);
  ok(/Urquiza 4741/.test(bien.nodos.pie.innerHTML) && /Lun a S/.test(bien.nodos.pie.innerHTML),
     'dirección y horarios al pie', bien.nodos.pie.innerHTML);

}

const mal = correrPagina('?o=9999&k=k3n8x2p9qm4vb7ctd5ef', docREST, 200);
await espera(30);
{
  const m = mal.nodos.body.innerHTML;
  ok(/No encontramos esa orden/.test(m), 'orden que no coincide con el token → no encontrada', m.slice(0, 120));
  ok(!/Samsung|7123|5678/.test(m), 'y no filtra ningún dato', m);
}

const noExiste = correrPagina('?o=7123&k=inventado', {}, 404);
await espera(30);
ok(/No encontramos esa orden/.test(noExiste.nodos.body.innerHTML), 'token inexistente → mismo mensaje (no confirma si la orden existe)');

const viejo = correrPagina('?id=lz9k2f3ab1', docREST, 200);
await espera(30);
ok(/Samsung Galaxy A54/.test(viejo.nodos.body.innerHTML), 'los QR viejos (?id=) siguen funcionando', viejo.nodos.body.innerHTML.slice(0, 80));

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
})();
