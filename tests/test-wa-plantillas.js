// Mensajes de WhatsApp: los avisos por fase, sus variables y el editor de la ficha.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── Sandbox: tp-fases.js con DOM y Firestore de mentira ──
const ctx = {
  console,
  window: { _DAKI_NAME: 'TechPoint' },
  document: { getElementById: () => null, addEventListener: () => {} },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
  BIZ_DATA: { dir: 'Urquiza 4741, Caseros', tel: '11 7239-2511', extra: 'Lun a Sáb 9 a 19' },
  toast: () => {}, esc: s => String(s == null ? '' : s),
  REPAIRS: [], WA_TEMPLATES: {},
};
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'tp-fases.js', 'utf8'), ctx, { filename: 'tp-fases.js' });

// Reparación completa: dos arreglos, seña, falla declarada y diagnóstico.
const REP = {
  id: 'r1', nOrden: 1287, nombre: 'Juan Pérez', tlf: '1155554433',
  marca: 'Samsung', modelo: 'Galaxy A54', estado: 'reparando', fase: 'listo',
  falla: 'Se cayó y no anda el táctil',
  diagnostico: 'Módulo partido, batería hinchada',
  arreglo: 'Módulo + Batería',
  arreglos: [{ texto: 'Cambio de módulo', precio: 185000 }, { texto: 'Cambio de batería', precio: 42000 }],
  monto: 227000, sena: 80000, diasGarantia: 90, fechaEstimada: '2026-08-23',
  motivo: '', condicion: 'Golpe en la esquina',
};
// Los const de arriba de un archivo no aparecen como propiedades del contexto
// del vm: hay que pedirlos evaluando dentro.
const G = e => vm.runInContext(e, ctx);
const TP_FASES = G('TP_FASES'), TP_WA_VARS = G('TP_WA_VARS');
const txt = f => { ctx.__R = { ...REP, fase: f, estado: TP_FASES[f].estado }; return vm.runInContext('tpWaTexto(__R)', ctx); };

console.log('\n1) Todas las fases tienen algo para decirle al cliente');
const FASES = Object.keys(TP_FASES);
ok(FASES.length === 11, 'siguen siendo 11 fases', FASES.length);
FASES.forEach(f => ok(!!TP_FASES[f].wa, `«${TP_FASES[f].nombre}» tiene mensaje`));
// "En reparación" era la única sin texto: el botón de WhatsApp no aparecía.
ok(/banco de trabajo/i.test(TP_FASES.reparacion.wa), 'la fase En reparación ya tiene aviso (antes era null)');

console.log('\n2) No queda ninguna variable sin reemplazar');
FASES.forEach(f => {
  const m = txt(f) || '';
  const sueltas = m.match(/\{[A-Za-zÁÉÍÓÚñ_]+\}/g);
  ok(!sueltas, `«${TP_FASES[f].nombre}» sale limpio`, sueltas);
});
// Una plantilla con TODAS las variables de la lista tampoco deja restos:
// si mañana se agrega una a TP_WA_VARS y se olvidan del replace, esto falla.
const todas = TP_WA_VARS.map(v => '{' + v.k + '}').join(' | ');
ctx.__R = { ...REP }; ctx.__T = todas;
const full = vm.runInContext('tpWaTexto(__R, __T)', ctx);
ok(!/\{[A-Za-z_]+\}/.test(full), 'las 17 variables de TP_WA_VARS se reemplazan todas',
   (full.match(/\{[A-Za-z_]+\}/g) || []));
ok(TP_WA_VARS.length === 17, 'la lista de variables del editor tiene 17', TP_WA_VARS.length);

console.log('\n3) El aviso de "listo" dice el SALDO, no el total');
const listo = txt('listo');
ok(/147\.000/.test(listo), 'saldo = 227.000 - 80.000 de seña', listo);
ok(!/227\.000/.test(listo), 'no le manda el total, que lo haría venir con plata de más');
ok(/Urquiza 4741/.test(listo), 'lleva la dirección del local');
ok(/Lun a Sáb 9 a 19/.test(listo), 'lleva el horario');
ok(/90 días/.test(listo), 'lleva la garantía');
// Sin seña, saldo y total coinciden
ctx.__R = { ...REP, sena: 0, fase: 'listo', estado: 'listo' };
ok(/227\.000/.test(vm.runInContext('tpWaTexto(__R)', ctx)), 'sin seña, el saldo es el total');

console.log('\n4) {FALLA} usa el campo falla, no la condición estética');
const ing = txt('ingresado');
ok(/Se cayó y no anda el táctil/.test(ing), 'sale lo que contó el cliente', ing);
ok(!/Golpe en la esquina/.test(ing), 'no confunde la falla con la condición estética');
// Órdenes viejas: no tenían campo `falla`, ahí sigue valiendo `condicion`
ctx.__R = { ...REP, falla: undefined, fase: 'ingresado', estado: 'reparando' };
ok(/Golpe en la esquina/.test(vm.runInContext('tpWaTexto(__R)', ctx)),
   'en las órdenes viejas (sin campo falla) cae en condicion, como antes');

console.log('\n5) {DETALLE}: los arreglos con su precio');
const pres = txt('presupuestado');
ok(/Cambio de módulo — \$185\.000/.test(pres), 'lista el primer arreglo con su precio', pres);
ok(/Cambio de batería — \$42\.000/.test(pres), 'y el segundo');
ctx.__R = { ...REP, arreglos: [{ texto: 'Cambio de módulo', precio: 185000 }], fase: 'presupuestado', estado: 'reparando' };
const uno = vm.runInContext('tpWaTexto(__R)', ctx);
ok(!/•/.test(uno) && /Cambio de módulo|Módulo \+ Batería/.test(uno), 'con un solo arreglo no arma lista', uno);
ctx.__R = { ...REP, arreglos: undefined, fase: 'presupuestado', estado: 'reparando' };
ok(/Módulo \+ Batería/.test(vm.runInContext('tpWaTexto(__R)', ctx)), 'las órdenes viejas usan el texto `arreglo`');

console.log('\n6) El texto editado pisa al de fábrica');
ctx.WA_TEMPLATES = { fase_listo: 'Che {nombre}, pasá a buscar el {MODELO}. Debés ${SALDO}.' };
const custom = txt('listo');
ok(/Che Juan, pasá a buscar el Samsung Galaxy A54/.test(custom), 'usa la plantilla guardada', custom);
ok(/147\.000/.test(custom), 'y le reemplaza las variables igual');
ctx.WA_TEMPLATES = {};
ok(/ya está listo/.test(txt('listo')), 'sin plantilla guardada vuelve la de fábrica');

console.log('\n7) Vista previa en vivo: el 2º argumento gana siempre');
ctx.WA_TEMPLATES = { fase_listo: 'guardada' };
ctx.__R = { ...REP, fase: 'listo', estado: 'listo' }; ctx.__T = 'tipeando {nombre}';
ok(vm.runInContext('tpWaTexto(__R, __T)', ctx) === 'tipeando Juan',
   'lo que estás escribiendo manda sobre lo guardado');
ctx.WA_TEMPLATES = {};

console.log('\n8) El editor no explota donde no existe el modal (caja.html)');
let reventó = false;
try { vm.runInContext("tpWaEditar('r1')", ctx); } catch (e) { reventó = true; }
ok(!reventó, 'tpWaEditar sin modal no tira error');
ok(typeof ctx.tpWaGuardarPlantilla === 'function' && typeof ctx.tpWaVar === 'function',
   'existen guardar e insertar variable');

console.log('\n9) La ficha tiene el botón y el modal está en index.html');
const rep = fs.readFileSync(DIR + 'repairs.js', 'utf8');
const idx = fs.readFileSync(DIR + 'index.html', 'utf8');
ok(/tpWaEditar\('\$\{id\}'\)/.test(rep), 'botón ✏️ Editar texto en el bloque Aviso al cliente');
ok(/id="wa-fase-modal"/.test(idx), 'modal wa-fase-modal');
['wf-txt', 'wf-vars', 'wf-prev', 'wf-titulo', 'wf-sub'].forEach(k =>
  ok(idx.includes('id="' + k + '"'), 'el modal tiene #' + k));
ok(/oninput="tpWaPrevia\(\)"/.test(idx), 'la previa se actualiza al tipear');

console.log('\n10) loadWaTemplates trae las plantillas de fase desde Firestore');
// Se ejecuta la función REAL sacada de app.js, con un Firestore de mentira.
const app = fs.readFileSync(DIR + 'app.js', 'utf8');
const fnSrc = app.match(/function loadWaTemplates\(\)[\s\S]*?\n\}/);
ok(!!fnSrc, 'se encontró loadWaTemplates en app.js');
const REMOTO = { repair_listo: 'remoto listo', fase_listo: 'remoto fase listo', fase_repuesto: 'remoto repuesto' };
const ctx2 = {
  console, WA_TEMPLATES: {},
  WA_TPL_DEFAULTS: { repair_listo: 'def listo', stock: 'def stock' },
  WA_TEMPLATES_KEY: 'cel_wa_templates',
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } },
  db: { collection: () => ({ doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => REMOTO }) }) }) },
};
ctx2.globalThis = ctx2; vm.createContext(ctx2);
vm.runInContext(fnSrc[0] + '\nloadWaTemplates();', ctx2);
setTimeout(() => {
  ok(ctx2.WA_TEMPLATES.fase_listo === 'remoto fase listo', 'baja fase_listo', ctx2.WA_TEMPLATES.fase_listo);
  ok(ctx2.WA_TEMPLATES.fase_repuesto === 'remoto repuesto', 'baja fase_repuesto');
  ok(ctx2.WA_TEMPLATES.repair_listo === 'remoto listo', 'y las viejas siguen bajando');
  ok(ctx2.WA_TEMPLATES.stock === 'def stock', 'lo que no está en Firestore queda con el default');
  ok(JSON.parse(ctx2.localStorage._d['cel_wa_templates']).fase_listo === 'remoto fase listo',
     'queda cacheado en localStorage para la próxima apertura');

  console.log('\n11) "Restablecer" del modal viejo no borra los mensajes de fase');
  const reset = app.match(/function resetWaTemplates\(\)[\s\S]*?\n\}/)[0];
  ok(/Object\.assign\(WA_TEMPLATES, WA_TPL_DEFAULTS\)/.test(reset),
     'reemplaza solo las claves de esa pantalla, no el objeto entero');
  ok(!/WA_TEMPLATES = \{ \.\.\.WA_TPL_DEFAULTS \}/.test(reset),
     'ya no pisa WA_TEMPLATES entero (se llevaba puestas las claves fase_*)');
  ok(/repair_presupuesto/.test(app) && /id="wt-presup"/.test(idx),
     'el mensaje de presupuesto por fin se puede editar');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
}, 10);
