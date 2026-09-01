// Harness sin navegador para tp-fases.js + su integración con repairs.js
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';

const els = {};
function el(id) {
  return els[id] = {
    id, value: '', textContent: '', innerHTML: '', style: {}, options: [], dataset: {},
    classList: { _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
                 toggle(c,f){f?this._s.add(c):this._s.delete(c)}, contains(c){return this._s.has(c)} },
    closest(){return null}, focus(){}, setAttribute(){}, addEventListener(){},
    querySelector(){return null}, querySelectorAll(){return []}, appendChild(){}, remove(){},
  };
}
['rep-list','rep-empty','rep-search','rep-f-estado','rep-f-marca','rep-f-fecha','rep-sort',
 'rs-reparando','rs-listo','rs-demorados','rs-devolver','rep-det-body','rep-det-actions',
 'rep-det-marca','rep-det-modelo','rep-detail-modal','rep-det-foto-wrap','rep-det-foto-img',
 'rep-fi-imei','rep-fi-condicion','rep-fi-codigo'].forEach(el);

let TOASTS = [], CONFIRMS = [];
const ctx = {
  console, setTimeout: (f)=>{ return 0; }, clearTimeout, requestAnimationFrame: f=>f(),
  document: {
    getElementById: id => els[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el('tmp'), addEventListener: () => {},
    body: { style:{}, classList:{add(){},remove(){},toggle(){},contains(){return false}} },
    documentElement: { classList:{add(){},remove(){},toggle(){},contains(){return false}}, style:{setProperty(){}} },
  },
  window: { addEventListener(){}, _DAKI_NAME: 'TechPoint', matchMedia: () => ({matches:false, addEventListener(){}}), open: (u)=>{ ctx.__lastUrl = u; } },
  localStorage: { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]} },
  navigator: { userAgent:'node', clipboard:{ writeText: async()=>{} } },
  firebase: { firestore: { FieldValue: { increment:n=>({__inc:n}), serverTimestamp:()=>({__ts:1}) } } },
  __TOAST: (m,t) => TOASTS.push([t||'info', m]),
  confirm: (m) => { CONFIRMS.push(m); return CONFIRM_ANSWERS.shift() ?? false; },
  prompt: (m, def) => { PROMPTS.push(m); return PROMPT_ANSWERS.length ? PROMPT_ANSWERS.shift() : null; },
  alert: () => {},
  BIZ_DATA: { dir: 'Urquiza 4741 L22', tel: '1172392511' },
};
let CONFIRM_ANSWERS = [], PROMPT_ANSWERS = [], PROMPTS = [];
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);

vm.runInContext(fs.readFileSync(DIR+'tp-fases.js','utf8'), ctx, {filename:'tp-fases.js'});
vm.runInContext(fs.readFileSync(DIR+'webpush.js','utf8'), ctx, {filename:'webpush.js'});
vm.runInContext(fs.readFileSync(DIR+'repairs.js','utf8'), ctx, {filename:'repairs.js'});

const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);

// Firestore falso
const W = { updates: [], sets: [] };
ctx.__DB = {
  collection: n => ({
    doc: id => ({
      update: async d => { W.updates.push([n,id,d]); },
      set: async (d,o) => { W.sets.push([n,id,d]); },
      get: async () => ({ exists:false, data:()=>({}) }),
    }),
    add: async d => ({ id:'x' }),
    where: () => ({ limit: () => ({ get: async () => ({ empty:true }) }) }),
  }),
};
// Guardamos las funciones reales antes de stubbearlas (para el test de render)
run('__realRender = renderRepairs; __realDetail = openRepairDetail;');
run(`
  db = __DB;
  toast = (m,t) => __TOAST(m,t);
  esc = s => String(s==null?'':s);
  fmt = n => '$'+n;
  timeAgo = () => '1 d';
  fmtDate = s => s; fmtDateTime = s => s;
  searchMatch = () => true;
  logActivity = () => {};
  updateNavBadge = () => {};
  upsertSeguimientoPublico = r => { __SEG.push(r.id); };
  _tgEstadoRepair = () => {};
  triggerWaNotify = () => {};
  openRepairDetail = () => {};
  closeRepairDetail = () => {};
  renderRepairs = () => {};
  _faltaCargarCosto = () => false;
  openRepUsoModal = cb => cb(null);
  openCobroModal = () => {};
  _refreshDashIfVisible = () => {};
  WA_TEMPLATES = {};
  // "¿Se lleva el equipo?" ya no es un confirm() del navegador sino el modal
  // de tp-fases.js. Acá se lo reemplaza por una cola de respuestas; el modal
  // de verdad (textos, botones, el parche que escribe) se prueba entero en
  // test-entrega.js.
  tpEntregaModal = (r, o) => {
    __ENTREGAS.push({ nOrden: r.nOrden, contexto: (o||{}).contexto });
    return Promise.resolve(__ENTREGA_ANSWERS.shift() ?? { entregado: false, avisar: false });
  };
  _normWaPhone = t => '549'+String(t).replace(/\\D/g,'');
  getDeviceId = () => 'ESTE-CELU';
  getNotifConfig = () => __CFG;
  fetch = (u, o) => { __PUSH.push({ url: u, body: JSON.parse(o.body), headers: o.headers || {} }); return Promise.resolve({ ok: true, status: 200 }); };
  // apiFetch vive en utils.js, que esta prueba no carga. El stub imita lo que
  // hace el de verdad: engancha el token de sesión y delega en fetch.
  apiFetch = (u, o = {}) => fetch(u, Object.assign({}, o, {
    headers: Object.assign(
      { 'Content-Type': 'application/json', 'Authorization': 'Bearer TOKEN-DE-PRUEBA' },
      o.headers || {}
    ),
  }));
`);
ctx.__PUSH = [];
ctx.__CFG = { push: { enabled: true, repairNueva: true, repairEstado: true }, pushTargets: {} };
ctx.__SEG = [];
ctx.__ENTREGAS = [];
ctx.__ENTREGA_ANSWERS = [];

let fails = 0;
function ok(c, label, extra) {
  console.log((c?'  OK  ':'  FAIL')+' · '+label+(c?'':'  → '+JSON.stringify(extra)));
  if (!c) fails++;
}
const hAgo = h => new Date(Date.now()-h*3600000).toISOString();
function setRepairs(arr) { ctx.__R = arr; run('REPAIRS = __R'); W.updates=[]; W.sets=[]; TOASTS=[]; CONFIRMS=[]; ctx.__SEG=[]; ctx.__ENTREGAS=[]; ctx.__ENTREGA_ANSWERS=[]; }
const R = id => get('REPAIRS').find(x=>x.id===id);

(async () => {

console.log('\n1) Datos viejos (sin fase): se deduce del estado, no se escribe nada');
setRepairs([
  { id:'a1', nOrden:7001, estado:'reparando', fechaIngreso:hAgo(100), marca:'Samsung', modelo:'A54' },
  { id:'a2', nOrden:7002, estado:'listo', fechaIngreso:hAgo(20),
    estadoHistorial:[{estado:'reparando',fecha:hAgo(50)},{estado:'listo',fecha:hAgo(10)}] },
  { id:'a3', nOrden:7003, estado:'no va', fechaIngreso:hAgo(30), devuelto:false },
  { id:'a4', nOrden:7004, estado:'entregado', fechaIngreso:hAgo(300) },
]);
ok(get(`tpFaseDe(REPAIRS[0])`) === 'reparacion', 'reparando → fase reparacion');
ok(get(`tpFaseDe(REPAIRS[1])`) === 'listo', 'listo → fase listo');
ok(get(`tpFaseDe(REPAIRS[2])`) === 'irreparable', 'no va → fase irreparable');
ok(get(`tpFaseDe(REPAIRS[3])`) === 'entregado', 'entregado → fase entregado');
ok(W.updates.length === 0, 'no escribió nada en Firestore al solo mostrar', W.updates);

console.log('\n2) Historial reconstruido desde estadoHistorial');
const h2 = get('tpHistorial(REPAIRS[1])');
ok(h2.length === 2, '2 entradas', h2.length);
ok(h2[0].f === 'reparacion' && h2[1].f === 'listo', 'mapea cada estado a su fase', h2.map(x=>x.f));
ok(h2.every(x=>x._derivado), 'marcadas como derivadas', h2);

console.log('\n3) Fase mentirosa: manda el estado (auto-corrección)');
setRepairs([{ id:'b1', estado:'entregado', fase:'reparacion', faseHist:[{f:'reparacion',t:hAgo(5)}], fechaIngreso:hAgo(50) }]);
ok(get(`tpFaseDe(REPAIRS[0])`) === 'entregado', 'la fase vieja no gana sobre el estado real', get(`tpFaseDe(REPAIRS[0])`));

console.log('\n4) SLA por fase');
setRepairs([
  { id:'c1', estado:'reparando', fase:'repuesto', faseHist:[{f:'repuesto',t:hAgo(100)}] },  // sla 120 → ok
  { id:'c2', estado:'reparando', fase:'repuesto', faseHist:[{f:'repuesto',t:hAgo(130)}] },  // sla 120 → vencido
  { id:'c3', estado:'reparando', fase:'ingresado', faseHist:[{f:'ingresado',t:hAgo(5)}] },  // sla 4 → vencido
  { id:'c4', estado:'entregado', fase:'entregado', faseHist:[{f:'entregado',t:hAgo(900)}] },// sla null
  { id:'c5', estado:'listo', fase:'abandonado', faseHist:[{f:'abandonado',t:hAgo(900)}] },  // sla null
]);
ok(get('tpVencido(REPAIRS[0])') === false, '100 h esperando repuesto: todavía no', null);
ok(get('tpVencido(REPAIRS[1])') === true,  '130 h esperando repuesto: demorado', null);
ok(get('tpVencido(REPAIRS[2])') === true,  '5 h ingresado sin tocar: demorado', null);
ok(get('tpVencido(REPAIRS[3])') === false, 'entregado nunca se demora', null);
ok(get('tpVencido(REPAIRS[4])') === false, 'abandonado no molesta más', null);

console.log('\n5) Avanzar de fase DENTRO del mismo estado (no toca caja ni Telegram)');
setRepairs([{ id:'d1', nOrden:7010, estado:'reparando', fase:'ingresado',
              faseHist:[{f:'ingresado',t:hAgo(3)}], marca:'Motorola', modelo:'G35' }]);
await get(`tpCambiarFase('d1','diagnostico')`);
const u5 = W.updates.find(u=>u[0]==='repairs');
ok(!!u5, 'escribió en repairs', W.updates);
ok(u5[2].fase === 'diagnostico', 'fase = diagnostico', u5[2].fase);
ok(u5[2].faseHist.length === 2, 'historial +1', u5[2].faseHist);
ok(u5[2].estado === undefined, 'NO tocó el estado (sigue reparando)', u5[2]);
ok(W.sets.filter(s=>s[0]==='backups').length === 1, 'hizo el backup previo una vez', W.sets.map(s=>s[0]));

console.log('\n6) Avanzar cruzando de estado: pasa por el camino de siempre');
setRepairs([{ id:'e1', nOrden:7011, estado:'reparando', fase:'reparacion',
              faseHist:[{f:'reparacion',t:hAgo(10)}], marca:'iPhone', modelo:'13', monto:50000, tlf:'1155667788' }]);
ctx.__ENTREGA_ANSWERS = [{ entregado:false, avisar:false }];   // "¿se lo lleva?" → NO, queda listo
await get(`tpCambiarFase('e1','listo')`);
const u6 = W.updates.find(u=>u[0]==='repairs');
ok(!!u6, 'escribió en repairs', W.updates);
ok(u6[2].estado === 'listo', 'estado → listo', u6 && u6[2].estado);
ok(u6[2].fase === 'listo', 'fase → listo', u6 && u6[2].fase);
ok(Array.isArray(u6[2].estadoHistorial), 'estadoHistorial actualizado (lo lee la impresión y el QR)', u6[2].estadoHistorial);
ok(ctx.__ENTREGAS.some(e => e.nOrden === 7011), 'preguntó si el cliente se lo lleva', ctx.__ENTREGAS);
ok(ctx.__SEG.includes('e1'), 'actualizó el seguimiento público del QR', ctx.__SEG);

console.log('\n7) Chip rápido de la lista: ahora también deja historial y sincroniza fase');
setRepairs([{ id:'f1', nOrden:7012, estado:'reparando', fase:'reparacion',
              faseHist:[{f:'reparacion',t:hAgo(10)}], estadoHistorial:[{estado:'reparando',fecha:hAgo(10)}] }]);
await get(`_doStatusChange('f1','entregado')`);
const u7 = W.updates.find(u=>u[0]==='repairs');
ok(u7[2].estado === 'entregado', 'estado entregado', u7[2].estado);
ok(u7[2].fase === 'entregado', 'fase sincronizada sola', u7[2].fase);
ok(u7[2].estadoHistorial.length === 2, 'BUG-FIX: ahora sí escribe historial', u7[2].estadoHistorial);
ok(ctx.__SEG.includes('f1'), 'BUG-FIX: ahora sí actualiza el QR público', ctx.__SEG);

console.log('\n8) Deshacer');
setRepairs([{ id:'g1', nOrden:7013, estado:'reparando', fase:'repuesto',
              faseHist:[{f:'reparacion',t:hAgo(20)},{f:'repuesto',t:hAgo(2)}],
              estadoHistorial:[{estado:'reparando',fecha:hAgo(20)}] }]);
CONFIRM_ANSWERS = [true];
await get(`tpDeshacer('g1')`);
const u8 = W.updates.find(u=>u[0]==='repairs');
ok(u8[2].fase === 'reparacion', 'volvió a la fase anterior', u8[2].fase);
ok(u8[2].faseHist.length === 1, 'sacó la última entrada', u8[2].faseHist);

console.log('\n9) "No va" → marcar devuelto (no cambia la fase)');
setRepairs([{ id:'h1', estado:'no va', fase:'irreparable', faseHist:[{f:'irreparable',t:hAgo(5)}], devuelto:false }]);
await get(`tpMarcarDevuelto('h1')`);
const u9 = W.updates.find(u=>u[0]==='repairs');
ok(u9[2].devuelto === true, 'devuelto = true', u9[2]);
ok(u9[2].fase === undefined, 'no tocó la fase', u9[2]);

console.log('\n10) Botones contextuales (nada de 11 estados sueltos)');
setRepairs([{ id:'i1', estado:'reparando', fase:'presupuestado', faseHist:[{f:'presupuestado',t:hAgo(2)}] }]);
const acc = get('tpAccionesHtml(REPAIRS[0])');
ok(/aprobado/.test(acc) && /rechazado/.test(acc), 'desde presupuestado: aprobar o rechazar', acc.match(/tpCambiarFase\('i1','(\w+)'\)/g));
ok(!/entregado/.test(acc), 'no ofrece saltar a entregado', acc);
setRepairs([{ id:'i2', estado:'entregado', fase:'entregado', faseHist:[{f:'entregado',t:hAgo(2)}] }]);
ok(/Orden cerrada/.test(get('tpAccionesHtml(REPAIRS[0])')), 'entregado no tiene salidas');

console.log('\n11) Mensaje de WhatsApp por fase');
setRepairs([{ id:'j1', nOrden:7020, estado:'listo', fase:'listo', faseHist:[{f:'listo',t:hAgo(1)}],
              marca:'Samsung', modelo:'A54', nombre:'Marina Suárez', tlf:'1169887744',
              monto:85000, arreglo:'Módulo', diasGarantia:90 }]);
const wa = get('tpWaTexto(REPAIRS[0])');
ok(/Marina/.test(wa), 'usa el nombre de pila', wa);
ok(/Samsung A54/.test(wa), 'usa el equipo', wa);
ok(/85\.000/.test(wa), 'precio formateado', wa);
ok(/90 días/.test(wa), 'garantía', wa);
ok(/Urquiza 4741/.test(wa), 'dirección desde BIZ_DATA', wa);
ok(!/{/.test(wa), 'no quedaron placeholders sin reemplazar', wa);

console.log('\n11b) Motivo del cierre');
setRepairs([{ id:'m1', nOrden:7040, estado:'reparando', fase:'diagnostico',
              faseHist:[{f:'diagnostico',t:hAgo(3)}], marca:'Nokia', modelo:'G20', tlf:'11' }]);
PROMPTS = []; PROMPT_ANSWERS = ['Placa con sulfato, no hay caso'];
CONFIRM_ANSWERS = [false];   // "¿ya lo devolviste?" → no
await get(`tpCambiarFase('m1','irreparable')`);
const um = W.updates.find(u=>u[0]==='repairs');
ok(PROMPTS.length === 1 && /no tiene reparación/i.test(PROMPTS[0]), 'pidió el motivo', PROMPTS);
ok(um[2].motivo === 'Placa con sulfato, no hay caso', 'guardó el motivo', um && um[2].motivo);
ok(um[2].fase === 'irreparable' && um[2].estado === 'no va', 'fase y estado correctos', um[2]);
ok(um[2].devuelto === false, 'quedó para devolver', um[2].devuelto);

setRepairs([{ id:'m2', nOrden:7041, estado:'reparando', fase:'reparacion', faseHist:[{f:'reparacion',t:hAgo(3)}] }]);
PROMPTS = []; PROMPT_ANSWERS = [];   // null = cancelar
await get(`tpCambiarFase('m2','irreparable')`);
ok(W.updates.length === 0, 'si cancela el cartel del motivo NO mueve nada (red de seguridad)', W.updates);

setRepairs([{ id:'m3', nOrden:7042, estado:'no va', fase:'irreparable',
              faseHist:[{f:'irreparable',t:hAgo(2)}], marca:'Nokia', modelo:'G20',
              motivo:'Placa con sulfato', tlf:'11', nombre:'Ana' }]);
const waM = get('tpWaTexto(REPAIRS[0])');
ok(/Placa con sulfato/.test(waM), 'el motivo entra en el aviso al cliente', waM);

console.log('\n12) Render de la lista y de la ficha no explota');
setRepairs([
  { id:'k1', nOrden:7030, estado:'reparando', fase:'repuesto', faseHist:[{f:'repuesto',t:hAgo(130)}],
    marca:'Xiaomi', modelo:'Redmi 12', arreglo:'Pantalla', monto:60000, fechaIngreso:hAgo(200), tlf:'111' },
  { id:'k2', nOrden:7031, estado:'entregado', fechaIngreso:hAgo(400), marca:'LG', modelo:'K50' },
]);
els['rep-search'].value=''; els['rep-f-estado'].value=''; els['rep-f-marca'].value='';
els['rep-f-fecha'].value=''; els['rep-sort'].value='nOrden';
run('_repairsLoaded = true');
run('renderRepairs = __realRender');   // la de verdad
run('renderRepairs()');
const html = els['rep-list'].innerHTML;
ok(/tp-chip/.test(html), 'la tarjeta tiene chip de fase');
ok(/tp-steps/.test(html), 'la tarjeta tiene barra de avance');
ok(/tp-step now/.test(html), 'marca el paso actual');
ok(/rep-card--demorado/.test(html), 'marca el demorado por SLA');
ok(Number(els['rs-demorados'].textContent) === 1, 'contador de demorados = 1', els['rs-demorados'].textContent);

run('openRepairDetail = __realDetail');
run(`openRepairDetail('k1')`);
const det = els['rep-det-body'].innerHTML;
ok(/tp-acciones/.test(det), 'la ficha tiene los botones de avance');
ok(/Llegó el repuesto/.test(det), 'ofrece la transición correcta desde "esperando repuesto"');
ok(/tp-hist/.test(det), 'la ficha tiene historial');
ok(/Diagnóstico técnico/.test(det), 'la ficha tiene diagnóstico editable');

console.log('\n13) El QR del cliente se actualiza en TODOS los caminos');
// Bug reportado: mover de fase sin cambiar de estado no republicaba el
// documento público, y el cliente seguía viendo el paso anterior.
async function seguimientoTrasMover(fase, estadoInicial, faseInicial) {
  setRepairs([{ id: 's1', nOrden: 7050, estado: estadoInicial, fase: faseInicial,
                faseHist: [{ f: faseInicial, t: hAgo(5) }],
                estadoHistorial: [{ estado: estadoInicial, fecha: hAgo(5) }],
                marca: 'Samsung', modelo: 'A54', monto: 1000, tlf: '11' }]);
  CONFIRM_ANSWERS = [false, false]; PROMPT_ANSWERS = ['motivo de prueba'];
  await get(`tpCambiarFase('s1','${fase}')`);
  return ctx.__SEG.includes('s1');
}
ok(await seguimientoTrasMover('diagnostico', 'reparando', 'ingresado'),
   'ingresado → diagnóstico (mismo estado) republica el QR  ← ESTE ERA EL BUG');
ok(await seguimientoTrasMover('repuesto', 'reparando', 'aprobado'),
   'aprobado → esperando repuesto republica el QR');
ok(await seguimientoTrasMover('presupuestado', 'reparando', 'diagnostico'),
   'diagnóstico → presupuestado republica el QR');
ok(await seguimientoTrasMover('listo', 'reparando', 'reparacion'),
   'reparación → listo (cambia el estado) republica el QR');
ok(await seguimientoTrasMover('irreparable', 'reparando', 'diagnostico'),
   'sin reparación republica el QR');

setRepairs([{ id: 's2', nOrden: 7051, estado: 'reparando', fase: 'repuesto',
              faseHist: [{ f: 'reparacion', t: hAgo(9) }, { f: 'repuesto', t: hAgo(2) }] }]);
CONFIRM_ANSWERS = [true];
await get(`tpDeshacer('s2')`);
ok(ctx.__SEG.includes('s2'), 'deshacer republica el QR');

setRepairs([{ id: 's3', estado: 'no va', fase: 'irreparable', faseHist: [{ f: 'irreparable', t: hAgo(2) }], devuelto: false }]);
await get(`tpMarcarDevuelto('s3')`);
ok(ctx.__SEG.includes('s3'), 'marcar devuelto republica el QR');

setRepairs([{ id: 's4', estado: 'listo', fase: 'listo', faseHist: [{ f: 'listo', t: hAgo(2) }],
              estadoHistorial: [{ estado: 'listo', fecha: hAgo(2) }] }]);
await get(`_doStatusChange('s4','entregado')`);
ok(ctx.__SEG.includes('s4'), 'chip rápido de la lista republica el QR');

console.log('\n13b) Aviso push a todos los dispositivos');
const cfgOn = { push: { enabled: true, repairNueva: true, repairEstado: true }, pushTargets: {} };
ctx.__CFG = cfgOn;
const ultimoPush = () => ctx.__PUSH[ctx.__PUSH.length - 1];

// a) Equipo nuevo
ctx.__PUSH = [];
await get(`pushEquipos({pushKey:'repairNueva',title:'🔧 Equipo ingresado N°7100',body:'Samsung A54'})`);
ok(ctx.__PUSH.length === 1, 'manda un push', ctx.__PUSH.length);
ok(ultimoPush().url === '/api/send-push', 'al endpoint correcto', ultimoPush().url);
ok(/^Bearer /.test(ultimoPush().headers['Authorization'] || ''),
   'con el token de sesión (el endpoint lo exige)', ultimoPush().headers);
ok(JSON.stringify(ultimoPush().body.targets) === '["ESTE-CELU_NEGATED"]',
   'va a TODOS los dispositivos menos el que cargó el equipo', ultimoPush().body.targets);
ok(ultimoPush().body.pushKey === 'repairNueva', 'manda la clave para respetar los toggles del server');
ok(Array.isArray(ultimoPush().body.vibrate) && ultimoPush().body.vibrate.length > 3,
   'viaja el patrón de vibración', ultimoPush().body.vibrate);
ok(Array.isArray(ultimoPush().body.actions) && ultimoPush().body.actions.length === 2,
   'viajan los botones "Ver equipo" y "Descartar"', ultimoPush().body.actions);

// b) Interruptores
ctx.__CFG = { push: { enabled: true, repairNueva: false }, pushTargets: {} };
ctx.__PUSH = [];
await get(`pushEquipos({pushKey:'repairNueva',title:'x'})`);
ok(ctx.__PUSH.length === 0, 'si el aviso está apagado no manda nada', ctx.__PUSH);
ctx.__CFG = { push: { enabled: false, repairNueva: true }, pushTargets: {} };
ctx.__PUSH = [];
await get(`pushEquipos({pushKey:'repairNueva',title:'x'})`);
ok(ctx.__PUSH.length === 0, 'con el push maestro apagado tampoco', ctx.__PUSH);

// c) Dispositivos elegidos a mano
ctx.__CFG = { push: { enabled: true, repairEstado: true }, pushTargets: { repairEstado: ['CELU-B', 'ESTE-CELU'] } };
ctx.__PUSH = [];
await get(`pushEquipos({pushKey:'repairEstado',title:'x'})`);
ok(JSON.stringify(ultimoPush().body.targets) === '["CELU-B"]',
   'si elegís dispositivos, respeta la lista y se saca a sí mismo', ultimoPush().body.targets);

// d) Texto del cambio de estado
ctx.__CFG = cfgOn;
ctx.__PUSH = [];
await get(`pushCambioEquipo({id:'z1',nOrden:7123,marca:'Samsung',modelo:'A54',arreglo:'Módulo',nombre:'Marina'},'repuesto','reparando')`);
ok(/N°7123/.test(ultimoPush().body.title) && /ESPERANDO REPUESTO/.test(ultimoPush().body.title),
   'el título dice la orden y la fase nueva, en mayúsculas', ultimoPush().body.title);
ok(/Samsung A54/.test(ultimoPush().body.body) && /Marina/.test(ultimoPush().body.body),
   'el cuerpo dice el equipo y el cliente', ultimoPush().body.body);

// e) Un solo aviso por acción (sin duplicados)
async function pushesDe(fase, estadoInicial, faseInicial) {
  setRepairs([{ id: 'p1', nOrden: 7060, estado: estadoInicial, fase: faseInicial,
                faseHist: [{ f: faseInicial, t: hAgo(4) }],
                estadoHistorial: [{ estado: estadoInicial, fecha: hAgo(4) }],
                marca: 'LG', modelo: 'K50', monto: 1000 }]);
  ctx.__PUSH = []; CONFIRM_ANSWERS = [false, false]; PROMPT_ANSWERS = ['x'];
  await get(`tpCambiarFase('p1','${fase}')`);
  return ctx.__PUSH.length;
}
ok(await pushesDe('diagnostico', 'reparando', 'ingresado') === 1, 'cambio de fase (mismo estado): 1 aviso');
ok(await pushesDe('listo', 'reparando', 'reparacion') === 1, 'cambio que además mueve el estado: 1 aviso, no dos');

setRepairs([{ id: 'p2', nOrden: 7061, estado: 'listo', fase: 'listo',
              faseHist: [{ f: 'listo', t: hAgo(2) }], estadoHistorial: [{ estado: 'listo', fecha: hAgo(2) }] }]);
ctx.__PUSH = [];
await get(`_doStatusChange('p2','entregado')`);
ok(ctx.__PUSH.length === 1, 'chip rápido de la lista: 1 aviso', ctx.__PUSH.length);

// f) Si el aviso falla, el trabajo no se frena (con el cliente enfrente)
setRepairs([{ id: 'p3', nOrden: 7062, estado: 'reparando', fase: 'ingresado',
              faseHist: [{ f: 'ingresado', t: hAgo(3) }] }]);
run(`fetch = () => Promise.reject(new Error('sin internet'))`);
await get(`tpCambiarFase('p3','diagnostico')`);
const guardado = W.updates.find(u => u[0] === 'repairs');
ok(guardado && guardado[2].fase === 'diagnostico',
   'si el push falla, el cambio de fase igual se guarda', guardado && guardado[2]);
ok(ctx.__SEG.includes('p3'), 'y el QR del cliente igual se actualiza', ctx.__SEG);
run(`fetch = (u, o) => { __PUSH.push({ url: u, body: JSON.parse(o.body) }); return Promise.resolve({ ok: true, status: 200 }); };`);

console.log('\n14) Ningún camino nuevo puede olvidarse de republicar');
// Guardia: toda escritura sobre `repairs` tiene que republicar el seguimiento,
// salvo las que no cambian nada de lo que ve el cliente.
const fsx = require('fs');
const EXENTAS = [
  'seguimientoAck',   // marca interna de recordatorio
  'notaRapida',       // nota interna
  'costoRepuesto',    // costo, no lo ve el cliente
  'tieneGarantia',    // marca en la orden original
  'tokenSeguimiento', // lo escribe el propio upsert
  'sena: firebase',   // revertir seña al borrar un movimiento
  '[campo]: v',       // tpGuardarCampo (diagnóstico/motivo son internos)
  'arreglos: lista',  // tildar una reparación como hecha: el doc público no
                      // tiene los arreglos, solo paso/equipo/fechas
];
const sospechosas = [];
for (const archivo of ['repairs.js', 'caja.js', 'tp-fases.js', 'seguimiento.js']) {
  const src = fsx.readFileSync(DIR + archivo, 'utf8').split('\n');
  src.forEach((linea, i) => {
    if (!/collection\('repairs'\)\.doc\([^)]*\)\.(update|set)/.test(linea)) return;
    // Ventana amplia: la publicación puede ir unas líneas después (tras el
    // toast o el log), y lo que identifica a una escritura exenta suele estar
    // unas líneas antes (el objeto que se arma).
    const bloque = src.slice(Math.max(0, i - 16), i + 40).join('\n');
    const exenta = EXENTAS.some(e => bloque.includes(e));
    if (!exenta && !/upsertSeguimientoPublico/.test(bloque)) {
      sospechosas.push(`${archivo}:${i + 1}  ${linea.trim().slice(0, 70)}`);
    }
  });
}
ok(sospechosas.length === 0, 'toda escritura sobre reparaciones republica el seguimiento (o está exenta)', sospechosas);

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails?1:0);
})();
