// Chequeo de caja obligatorio.
//
// El dueño pone horarios (14:00, 20:00…). Llegada la hora la app se traba en
// todos los celulares hasta que alguien cuente el efectivo. Dos cosas que no
// se negocian y que esta prueba vigila:
//
//   · es a CIEGAS — la pantalla nunca dice cuánto tendría que haber. Si el que
//     cuenta ve el número, no está contando: está copiando.
//   · si falla el guardado, la app se destraba igual. La persona contó la
//     plata; trabarle el mostrador porque se cayó internet es peor.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── DOM de mentira ──────────────────────────────────────────
const els = {};
function mk(id) {
  const e = {
    value: '', textContent: '', innerHTML: '', disabled: false, checked: false, style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                 toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    appendChild() {}, focus() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  };
  let _id = id || '';
  Object.defineProperty(e, 'id', { get: () => _id, set: v => { _id = v; els[v] = e; } });
  if (id) els[id] = e;
  return e;
}

// ── Firestore de mentira ────────────────────────────────────
const BASE = { caja_chequeos: {}, caja_chequeos_detalle: {}, config: {} };
let FALLAR = null;          // colección que rechaza escrituras
const LEIDAS = [];
const ESCUCHAS = [];        // listeners abiertos { ruta, cb }
function col(nombre) {
  return {
    doc: id => ({
      get: async () => { LEIDAS.push(nombre + '/' + id); const d = BASE[nombre][id]; return { exists: !!d, data: () => d }; },
      onSnapshot: (cb) => {
        LEIDAS.push(nombre + '/' + id + ' (listener)');
        ESCUCHAS.push({ ruta: nombre + '/' + id, cb });
        cb({ exists: !!BASE[nombre][id], data: () => BASE[nombre][id] });
        return () => { ESCUCHAS.length = 0; };
      },
      set: async data => {
        if (FALLAR === nombre) throw new Error('permission-denied');
        BASE[nombre][id] = JSON.parse(JSON.stringify(data));
      },
    }),
    where: (campo, _op, val) => ({ get: async () => ({
      docs: Object.values(BASE[nombre]).filter(d => d[campo] === val).map(d => ({ data: () => d })),
    }) }),
  };
}

const TOASTS = [];
const LS = {};
let AHORA = '2026-09-23T13:00:00-03:00';
let PIN_PEDIDO = null;
const APIS = [];                              // llamadas a /api
let NOTIF_CFG = { telegram: { enabled: true } };

const ctx = {
  console, JSON, Math, Object, Number, String, Array, Promise, Set,
  setInterval: () => 0, clearInterval: () => {}, clearTimeout: () => {}, setTimeout: f => { f(); return 0; },
  Date: class extends Date {
    constructor(...a) { super(...(a.length ? a : [AHORA])); }
    static now() { return new Date(AHORA).getTime(); }
  },
  document: {
    getElementById: id => els[id] || null,
    createElement: () => mk(''),
    addEventListener() {},
    body: { style: {}, appendChild() {}, classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); },
    } },
  },
  localStorage: { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); }, removeItem: k => { delete LS[k]; } },
  location: { href: '' },
  db: { collection: col },
  toast: (m, t) => TOASTS.push([t, m]),
  _todayAR: () => new Date(AHORA).toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10),
  tpFirma: () => ({ cargadoPor: 'Nacho', cargadoPorUid: 'uid-nacho' }),
  tpEsDueno: () => false,
  tpFrenarEmpleado: que => { TOASTS.push(['error', que + ' es solo del dueño']); return true; },
  requireCajaOwnerPin: (cb, msg) => { PIN_PEDIDO = msg; cb(); },
  apiFetch: (url, opts) => { APIS.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); },
  getNotifConfig: () => NOTIF_CFG,
};
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
const src = fs.readFileSync(DIR + 'chequeo.js', 'utf8');
vm.runInContext(src, ctx, { filename: 'chequeo.js' });
const run = e => vm.runInContext(e, ctx);

const DENOM = [20000, 10000, 2000, 1000, 500, 200, 100];
const overlay = () => els['chq-overlay'];
const cfg = (activo, horarios) => run(`CHQ_CFG = ${JSON.stringify({ activo, horarios })}`);
const limpiar = () => { Object.keys(LS).forEach(k => delete LS[k]); run('_chqAbierto = null'); TOASTS.length = 0; };

// El DOM falso no interpreta el innerHTML, así que los campos se crean acá.
// Que los ids coincidan con los del HTML real se chequea en la sección 3.
function montarCampos() {
  DENOM.forEach(d => { mk('chq-b-' + d); mk('chq-s-' + d); });
  mk('chq-total'); mk('chq-notas'); mk('chq-ok');
}

(async () => {

console.log('\n1) Los horarios que se guardan');
ok(run("JSON.stringify(_chqNormalizar({activo:true, horarios:['20:00','9:5','14:00','14:00','25:00']}))")
   === JSON.stringify({ activo: true, horarios: ['14:00', '20:00'] }),
   'ordena, saca repetidos y tira las horas inventadas',
   run("JSON.stringify(_chqNormalizar({activo:true,horarios:['20:00','9:5','14:00','14:00','25:00']}))"));
ok(run('_chqNormalizar({activo:true, horarios:[]}).activo') === false,
   'activo sin ningún horario no traba nada (sería una app trabada para siempre)');

console.log('\n2) Cuándo hay que contar');
limpiar(); cfg(true, ['14:00', '20:00']);
AHORA = '2026-09-23T13:59:00-03:00';
ok(run('_chqPendiente()') === null, 'a las 13:59 todavía no');
AHORA = '2026-09-23T14:00:30-03:00';
ok(run('_chqPendiente()') === '14:00', 'a las 14:00 sí', run('_chqPendiente()'));
AHORA = '2026-09-23T21:00:00-03:00';
ok(run('_chqPendiente()') === '14:00', 'si nadie lo hizo, sigue pidiendo el de las 14 antes que el de las 20');
run("_chqMarcar('14:00')");
ok(run('_chqPendiente()') === '20:00', 'hecho el de las 14, pide el de las 20');
run("_chqMarcar('20:00')");
ok(run('_chqPendiente()') === null, 'y con los dos hechos, nada');
// Lo de ayer no traba hoy: el local estaba cerrado y listo.
AHORA = '2026-09-24T10:00:00-03:00';
ok(run('_chqPendiente()') === null, 'al otro día a las 10 tampoco (los de ayer no se arrastran)');
AHORA = '2026-09-24T14:30:00-03:00';
ok(run('_chqPendiente()') === '14:00', 'pero a las 14:30 del día nuevo, otra vez');
limpiar(); cfg(false, ['14:00']);
ok(run('_chqPendiente()') === null, 'apagado no pide nada');

console.log('\n3) Traba la app y no se puede cerrar');
limpiar(); cfg(true, ['14:00']); AHORA = '2026-09-23T15:00:00-03:00';
run('_getCierreEsperado = () => 250000; ARQUEO = { total: 50000 };');   // estamos en la caja
await run('_chqRevisar()');
ok(!!overlay() && !overlay().classList.contains('hidden'), 'aparece la pantalla de conteo');
ok(ctx.document.body.style.overflow === 'hidden', 'y no se puede scrollear por atrás');
const html = overlay().innerHTML;
ok(/Chequeo de caja de las 14:00/.test(html), 'dice de qué horario es');
ok(!/onclick="[^"]*(close|cerrar|hidden)/i.test(html), 'no tiene botón de cerrar: es el punto');
DENOM.forEach(d => ok(html.indexOf('id="chq-b-' + d + '"') > 0, `tiene la fila de $${d.toLocaleString('es-AR')}`));
montarCampos();

console.log('\n4) A ciegas: la pantalla no dice cuánto tendría que haber');
// _getCierreEsperado() da 250.000. Si ese número aparece, el que cuenta lo
// copia y el chequeo no sirve para nada.
ok(!/250\.?000/.test(html), 'el esperado no está en la pantalla');
ok(!/esperado/i.test(html), 'ni la palabra', (html.match(/.{0,30}esperado.{0,20}/i) || [])[0]);

console.log('\n5) Contar');
els['chq-b-10000'].value = '3';
els['chq-b-1000'].value = '2';
run('_chqTotal()');
ok(els['chq-total'].textContent === '$32.000', 'suma los billetes', els['chq-total'].textContent);
run('_chqMas(10000, 1)');
ok(els['chq-b-10000'].value === 4, 'el + suma uno', els['chq-b-10000'].value);
run('_chqMas(100, -1)');
ok(els['chq-b-100'].value === 0, 'y el − no baja de cero', els['chq-b-100'].value);

console.log('\n6) Confirmar');
els['chq-notas'].value = 'saqué 5 lucas para el flete';
await run('_chqGuardar()');
const id = '2026-09-23_1400';
const guardado = BASE.caja_chequeos[id];
const detalle  = BASE.caja_chequeos_detalle[id];
ok(!!guardado, 'queda registrado que se hizo');
ok(guardado && guardado.cargadoPor === 'Nacho', 'con quién lo hizo', guardado && guardado.cargadoPor);
ok(guardado && guardado.contado === undefined,
   'el doc que lee todo el mundo NO lleva los montos (el empleado lo puede leer)', guardado);
ok(detalle && detalle.contado === 42000, 'el detalle sí: contó $42.000', detalle && detalle.contado);
ok(detalle && detalle.esperado === 250000 && detalle.diferencia === -208000,
   'y la diferencia contra lo esperado', detalle && [detalle.esperado, detalle.diferencia]);
ok(detalle && detalle.notas === 'saqué 5 lucas para el flete', 'con la nota que escribió');
ok(overlay().classList.contains('hidden') && ctx.document.body.style.overflow === '', 'la app se destraba');
ok(run('_chqPendiente()') === null, 'y no lo vuelve a pedir');

console.log('\n7) Con cuenta de empleado no se ve la diferencia ni al final');
ok(!TOASTS.some(t => /208|sobra|falta/.test(t[1])), 'el aviso no le canta el número', TOASTS);
ok(TOASTS.some(t => /42\.000/.test(t[1])), 'solo le confirma lo que contó él', TOASTS);

console.log('\n8) Sin la apertura cargada, no se inventa la cuenta');
// El celular del empleado no tiene la apertura del día: las reglas no se la
// dan. Se guarda lo que sabe y el dueño completa la cuenta después.
limpiar(); cfg(true, ['16:00']); AHORA = '2026-09-23T16:10:00-03:00';
run('ARQUEO = null');
await run('_chqRevisar()');
montarCampos();
els['chq-b-10000'].value = '1'; els['chq-b-1000'].value = '0';
await run('_chqGuardar()');
const d2 = BASE.caja_chequeos_detalle['2026-09-23_1600'];
ok(d2 && d2.apertura === null && d2.esperado === null && d2.diferencia === null,
   'no dice una diferencia que no puede saber', d2);
ok(d2 && d2.movEfecNeto === 250000, 'pero guarda el movimiento de efectivo, que sí sabe', d2 && d2.movEfecNeto);

console.log('\n9) Si falla el guardado, la app se destraba igual');
limpiar(); cfg(true, ['17:00']); AHORA = '2026-09-23T17:05:00-03:00';
await run('_chqRevisar()');
montarCampos();
FALLAR = 'caja_chequeos';
els['chq-b-1000'].value = '7';
await run('_chqGuardar()');
ok(overlay().classList.contains('hidden'), 'se destraba (la plata se contó igual)');
ok(JSON.parse(LS['chqPendientes']).length === 1, 'y queda en la cola para reintentar', LS['chqPendientes']);
ok(TOASTS.some(t => /conexión/.test(t[1])), 'avisando que falta guardarlo', TOASTS);
FALLAR = null;
await run('_chqReintentar()');
ok(!!BASE.caja_chequeos['2026-09-23_1700'], 'al volver la conexión se guarda');
ok(JSON.parse(LS['chqPendientes']).length === 0, 'y sale de la cola');

console.log('\n10) Si ya lo hizo otro celular, no traba de nuevo');
limpiar(); cfg(true, ['18:00']); AHORA = '2026-09-23T18:30:00-03:00';
BASE.caja_chequeos['2026-09-23_1800'] = { fecha: '2026-09-23', hora: '18:00', cargadoPor: 'Alan' };
LEIDAS.length = 0;
await run('_chqRevisar()');
ok(run('_chqAbierto') === null, 'no traba: lo contaron en el mostrador de al lado');
ok(LEIDAS.length === 1, 'y le costó UNA lectura de Firebase, no un listener', LEIDAS);

console.log('\n11) Saltear es del dueño');
limpiar(); cfg(true, ['19:00']); AHORA = '2026-09-23T19:30:00-03:00';
await run('_chqRevisar()');
montarCampos();
run('_chqSaltear()');
ok(run('_chqAbierto') === '19:00', 'un empleado no puede saltearlo');
ok(TOASTS.some(t => /solo del dueño/.test(t[1])), 'y se lo dice', TOASTS);
run('tpEsDueno = () => true;');
PIN_PEDIDO = null;
await run('_chqSaltear()');
await new Promise(r => setImmediate(r));
ok(!!PIN_PEDIDO, 'al dueño le pide el PIN', PIN_PEDIDO);
ok(BASE.caja_chequeos['2026-09-23_1900'] && BASE.caja_chequeos['2026-09-23_1900'].salteado === true,
   'y queda registrado que se salteó (si no, no se sabría)', BASE.caja_chequeos['2026-09-23_1900']);
ok(run('_chqAbierto') === null, 'ahí sí se destraba');
run('tpEsDueno = () => false;');

console.log('\n12) La configuración');
limpiar();
mk('chq-cfg-activo').checked = true;
run("_chqCfgEdit = { activo: true, horarios: [] }");
await run('guardarChequeoConfig()');
ok(!BASE.config['chequeoCaja'], 'no deja activarlo sin horarios');
ok(TOASTS.some(t => /al menos un horario/.test(t[1])), 'y explica por qué', TOASTS);
run("_chqCfgEdit = { activo: true, horarios: ['14:00','20:00'] }");
await run('guardarChequeoConfig()');
ok(BASE.config['chequeoCaja'] && JSON.stringify(BASE.config['chequeoCaja'].horarios) === '["14:00","20:00"]',
   'guarda los horarios', BASE.config['chequeoCaja']);
ok(JSON.parse(LS['chqCfg']).cfg.activo === true,
   'y los deja cacheados: si no, es una lectura de Firebase en cada apertura');

console.log('\n13) El dueño sí ve el resultado');
const hoySrc = src.slice(src.indexOf('async function openChequeosHoy'));
ok(/tpFrenarEmpleado/.test(hoySrc.slice(0, 300)), 'la lista de chequeos es solo del dueño');
ok(/caja_chequeos_detalle/.test(hoySrc), 'y lee el detalle, que es donde está la diferencia');
ok(/tpFrenarEmpleado/.test(src.slice(src.indexOf('function openChequeoConfig'), src.indexOf('function openChequeoConfig') + 300)),
   'configurar los horarios también');

console.log('\n14) Las reglas de Firestore');
const rules = fs.readFileSync(DIR + 'firestore.rules', 'utf8');
ok(/match \/config\/chequeoCaja \{[\s\S]{0,120}allow read: if isAllowed\(\);[\s\S]{0,60}allow write: if esDueno\(\);/.test(rules),
   'los horarios los lee cualquiera (su celular tiene que saber cuándo frenar) pero los cambia el dueño');
ok(/match \/caja_chequeos\/\{doc\} \{[\s\S]{0,140}allow read, create: if isAllowed\(\);/.test(rules),
   'el empleado puede dejar hecho el chequeo');
const det = rules.slice(rules.indexOf('match /caja_chequeos_detalle/'), rules.indexOf('match /accessLogs/'));
ok(/allow create: if isAllowed\(\);/.test(det) && /allow read, update, delete: if esDueno\(\);/.test(det),
   'escribe el detalle pero no lo lee: eso hace que el conteo sea a ciegas', det.slice(0, 160));
ok(/'caja_chequeos_detalle'/.test(rules.slice(rules.indexOf('function sensible('), rules.indexOf('function sensible(') + 600)),
   'y está en sensible(), o el comodín general se lo devolvería');

console.log('\n15) Está enganchado en las dos páginas');
['caja.html', 'index.html'].forEach(p => {
  ok(/src="chequeo\.js"/.test(fs.readFileSync(DIR + p, 'utf8')), p + ' carga chequeo.js');
});
ok(/if \(typeof initChequeoCaja === 'function'\) initChequeoCaja\(\);/.test(fs.readFileSync(DIR + 'caja.js', 'utf8')),
   'la caja lo arranca');
ok(/if \(typeof initChequeoCaja === 'function'\) initChequeoCaja\(\);/.test(fs.readFileSync(DIR + 'app.js', 'utf8')),
   'y la pantalla de stock/reparaciones también: si no, se seguía trabajando desde ahí sin contar');

console.log('\n16) El aviso de Telegram sale solo');
limpiar(); cfg(true, ['11:00']); AHORA = '2026-09-23T11:20:00-03:00';
run('ARQUEO = { total: 50000 };');
await run('_chqRevisar()');
montarCampos();
APIS.length = 0;
els['chq-b-10000'].value = '2';
await run('_chqGuardar()');
ok(APIS.length === 1 && APIS[0].url === '/api/chequeo-aviso', 'se avisa al confirmar el conteo', APIS);
ok(APIS[0].body.id === '2026-09-23_1100', 'mandando el id del chequeo, no los numeros', APIS[0].body);
// El mensaje lo arma el server: si lo armara el celular, el que esta siendo
// controlado podria escribir cualquier cosa en el aviso.
ok(!/contado|esperado|monto/i.test(JSON.stringify(APIS[0].body)),
   'el celular no dicta el contenido del mensaje', APIS[0].body);

console.log('\n17) Cuando NO se avisa');
limpiar(); cfg(true, ['12:00']); AHORA = '2026-09-23T12:20:00-03:00';
await run('_chqRevisar()');
montarCampos();
APIS.length = 0;
FALLAR = 'caja_chequeos';
els['chq-b-1000'].value = '3';
await run('_chqGuardar()');
ok(APIS.length === 0, 'si no se pudo guardar, no se avisa de algo que no esta', APIS);
FALLAR = null;
await run('_chqReintentar()');
ok(APIS.length === 1, 'y cuando vuelve la conexion, ahi si', APIS);
// Toggle de Configuracion -> Notificaciones
limpiar(); cfg(true, ['13:00']); AHORA = '2026-09-23T13:20:00-03:00';
await run('_chqRevisar()');
montarCampos();
APIS.length = 0;
NOTIF_CFG = { telegram: { enabled: false } };
await run('_chqGuardar()');
ok(APIS.length === 0, 'con Telegram apagado no manda nada', APIS);
NOTIF_CFG = { telegram: { enabled: true } };

console.log('\n18) El mensaje que llega al celular del dueno');
// Se prueba la funcion de verdad del endpoint, no una copia.
const apiSrc = fs.readFileSync(DIR + 'api/chequeo-aviso.js', 'utf8');
const trozo = apiSrc.slice(apiSrc.indexOf('const fmt ='), apiSrc.indexOf('export default'));
const ctxApi = { console, Number, String, Math, JSON };
ctxApi.globalThis = ctxApi;
vm.createContext(ctxApi);
vm.runInContext(trozo.replace('export function', 'function'), ctxApi, { filename: 'chequeo-aviso.js' });
const msg = (d, ap) => { ctxApi._d = d; ctxApi._ap = ap === undefined ? null : ap;
                         return vm.runInContext('armarMensaje(_d, _ap)', ctxApi); };

const m1 = msg({ hora: '14:00', cargadoPor: 'Nacho', contado: 42000, apertura: 50000, movEfecNeto: 200000, notas: null });
ok(/Contado.*\$42\.000/.test(m1), 'dice cuanto se conto', m1);
ok(/Debería haber: <b>\$250\.000<\/b>/.test(m1), 'y cuánto debería haber', m1);
ok(/\$250\.000/.test(m1), 'que es la apertura mas el efectivo del dia', m1);
ok(/Falta.*\$208\.000/.test(m1), 'con la diferencia hecha', m1);
ok(/apertura \$50\.000 \+ efectivo del d/.test(m1), 'y el desglose, para saber de donde sale', m1);
ok(/Nacho/.test(m1), 'y quien lo conto');

ok(/Sobra \$1\.000/.test(msg({ hora: '14:00', contado: 5000, apertura: 1000, movEfecNeto: 3000 })), 'sobra cuando sobra');
ok(/Justo/.test(msg({ hora: '14:00', contado: 4000, apertura: 1000, movEfecNeto: 3000 })), 'y justo cuando da justo');

// El celular del empleado no tiene la apertura: la pone el server desde el arqueo.
const m2 = msg({ hora: '16:00', contado: 10000, apertura: null, movEfecNeto: 3000 }, 1000);
ok(/\$4\.000/.test(m2) && /Sobra \$6\.000/.test(m2),
   'si el que conto no tenia la apertura, la completa el server', m2);
const m3 = msg({ hora: '16:00', contado: 10000, apertura: null, movEfecNeto: 3000 }, null);
ok(/no se puede saber/.test(m3), 'y si no hay arqueo del dia, lo dice en vez de inventar', m3);

const m4 = msg({ hora: '19:00', cargadoPor: 'Alan', salteado: true });
ok(/salteado/.test(m4) && !/Contado/.test(m4), 'un chequeo salteado se avisa igual', m4);

const m5 = msg({ hora: '14:00', contado: 1, apertura: 0, movEfecNeto: 1, notas: '<b>ojo</b>' });
ok(/&lt;b&gt;ojo&lt;\/b&gt;/.test(m5), 'la nota va escapada: Telegram interpreta HTML', m5);

console.log('\n19) El endpoint nuevo tiene guardia');
const av = apiSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
ok(/exigirSesion\(req, res\)/.test(av), 'exige sesion de Firebase');
ok(av.indexOf('exigirSesion(req, res)') < av.indexOf('TELEGRAM_BOT_TOKEN'),
   'y corta ANTES de tocar las credenciales del bot');
ok(/caja_arqueos/.test(av), 'lee la apertura con las credenciales del server');

console.log('\n20) El horario le llega a TODOS los celulares');
// El bug del primer dia: la config se leia una vez y se cacheaba 6 horas, asi
// que el chequeo aparecia solo en el celular donde se habia configurado. En
// los demas se seguia trabajando. Eso no es obligatorio, es una sugerencia.
limpiar();
run('CHQ_CFG = { activo: false, horarios: [] }; _chqCfgListener = null; _chqEnganchado = false;');
BASE.config['chequeoCaja'] = { activo: false, horarios: [] };
Object.keys(BASE.caja_chequeos).forEach(k => delete BASE.caja_chequeos[k]);   // dia limpio
AHORA = '2026-09-23T15:00:00-03:00';
ESCUCHAS.length = 0; LEIDAS.length = 0;
run('initChequeoCaja()');
await new Promise(r => setImmediate(r));
ok(ESCUCHAS.length === 1 && ESCUCHAS[0].ruta === 'config/chequeoCaja',
   'la app queda escuchando el documento de los horarios', ESCUCHAS.map(e => e.ruta));
ok(LEIDAS.filter(x => x.indexOf('config/') === 0).length === 1,
   'un solo documento, no una coleccion: una lectura por apertura', LEIDAS);
ok(run('_chqAbierto') === null, 'con el chequeo apagado no traba');

// El dueno agrega un horario desde SU celular: al de al lado le tiene que
// llegar solo, sin recargar nada.
BASE.config['chequeoCaja'] = { activo: true, horarios: ['14:00'] };
ESCUCHAS[0].cb({ exists: true, data: () => BASE.config['chequeoCaja'] });
await new Promise(r => setImmediate(r));
ok(run("JSON.stringify(CHQ_CFG.horarios)") === '["14:00"]', 'el horario nuevo llega solo', run('JSON.stringify(CHQ_CFG)'));
ok(run('_chqAbierto') === '14:00', 'y este celular se traba tambien', run('_chqAbierto'));

// Y al reves: si lo apaga, el que quedo trabado se destraba solo. Si no, hay
// que ir local por local a contar plata por un horario que ya no existe.
BASE.config['chequeoCaja'] = { activo: false, horarios: [] };
ESCUCHAS[0].cb({ exists: true, data: () => BASE.config['chequeoCaja'] });
await new Promise(r => setImmediate(r));
ok(run('_chqAbierto') === null, 'apagarlo destraba a los que estaban trabados');

console.log('\n21) Nada de cachear el horario');
ok(!/_CHQ_CFG_TTL/.test(src), 'no queda el cache de 6 horas que causo el bug');
ok(/onSnapshot/.test(src), 'el horario se escucha, no se consulta cada tanto');
ok(/window\.addEventListener\('focus'/.test(src) && /window\.addEventListener\('online'/.test(src),
   'y se revisa al volver a la app y al recuperar internet (el setInterval se congela en segundo plano)');
ok(/window\._chequeoCleanup/.test(src) && /_chequeoCleanup/.test(fs.readFileSync(DIR + 'auth.js', 'utf8')),
   'al cerrar sesion se suelta el listener');

console.log('\n22) El teclado del PIN, por encima de la pantalla que traba');
// Al tocar "Soy el dueno - saltear", el teclado del PIN se abria DETRAS de la
// pantalla del chequeo y no se podia escribir el codigo: el chequeo tapa la app
// con z-index 99999 y el teclado vive en 1100.
limpiar(); cfg(true, ['09:00']); AHORA = '2026-09-23T09:30:00-03:00';
Object.keys(BASE.caja_chequeos).forEach(k => delete BASE.caja_chequeos[k]);
await run('_chqRevisar()');
ok(ctx.document.body.classList.contains('chq-trabado'),
   'mientras traba, el body queda marcado');
const cssTxt = fs.readFileSync(DIR + 'style.css', 'utf8');
const zDe = sel => {
  const i = cssTxt.indexOf(sel);
  if (i < 0) return null;
  const m = cssTxt.slice(i, cssTxt.indexOf('}', i)).match(/z-index:\s*(\d+)/);
  return m ? Number(m[1]) : null;
};
const zTraba = zDe('.chq-overlay {');
const zPin   = zDe('body.chq-trabado #caja-owner-modal');
ok(zTraba > 0 && zPin > zTraba,
   `y ahi el teclado del PIN va por encima (${zPin} > ${zTraba})`, [zPin, zTraba]);
ok(zDe('body.chq-trabado #caja-owner-overlay') > zTraba, 'su fondo tambien');
ok(/body\.chq-trabado #owner-pin-modal/.test(cssTxt),
   'y el otro teclado de PIN, el de la pantalla de stock');
// Al destrabar se saca la clase: el resto de la app vuelve a su orden normal.
run('tpEsDueno = () => true;');
await run('_chqSaltear()');
await new Promise(r => setImmediate(r));
ok(!ctx.document.body.classList.contains('chq-trabado'),
   'y al destrabar la marca se va (si no, el PIN queda flotando por encima de todo)');
run('tpEsDueno = () => false;');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);

})();
