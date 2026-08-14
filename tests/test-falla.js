// Harness sin navegador para el campo "falla" del ingreso de equipos.
//
// Qué es: lo que cuenta el cliente ("se apaga solo en el 30%"). Es distinto
// del tipo de arreglo (la categoría: Batería, Módulo) y de la condición visual
// (los golpes con los que entró). Antes no había dónde escribirlo.
//
// Importa que llegue a la boleta: es la hoja que firma el cliente y es lo que
// se discute si después hay un reclamo.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
const leer = f => fs.readFileSync(DIR + f, 'utf8');

let fails = 0;
const ok = (c, l, x) => {
  console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x)));
  if (!c) fails++;
};

// ── 1) El campo existe en el formulario ─────────────────────
console.log('\n1) El campo en el alta de equipo');
const html = leer('index.html');
ok(/id="rep-fi-falla"/.test(html), 'está el campo en la pantalla');
ok(/¿Qué le pasa\?/.test(html), 'con una etiqueta que se entiende en el mostrador');
// Tiene que ir ANTES del tipo de arreglo: primero escuchás el problema y
// después decidís qué le vas a hacer.
ok(html.indexOf('rep-fi-falla') < html.indexOf('rep-fi-arreglo'),
   'va antes del tipo de arreglo');

const repairs = leer('repairs.js');
ok(/rep-fi-falla/.test(repairs), 'repairs.js lo lee');
// Que se limpie al abrir un alta nueva: si no, arrastra la falla del anterior.
// Se ancla en la lista larga de campos del reset (hay otro array corto con
// 'rep-fi-marca' arriba, el de los listeners del aviso de repuestos).
const iReset = repairs.indexOf("['rep-fi-marca','rep-fi-modelo','rep-fi-imei'");
ok(iReset > 0, 'se encontró el bloque que limpia el formulario');
ok(/rep-fi-falla/.test(repairs.slice(iReset, iReset + 400)),
   'se limpia al abrir una reparación nueva');

// ── 2) Se guarda en Firestore ───────────────────────────────
console.log('\n2) Se guarda con la reparación');
const cuerpoSave = repairs.slice(repairs.indexOf('async function saveRepair'),
                                 repairs.indexOf('async function saveRepair') + 4500);
ok((cuerpoSave.match(/\bfalla\b/g) || []).length >= 3,
   'saveRepair lo lee y lo guarda en los dos caminos (alta y edición)');
// Campo NUEVO: no se toca ni se renombra nada de lo que ya está en Firestore.
ok(/\barreglo\b/.test(cuerpoSave) && /\bcondicion\b/.test(cuerpoSave),
   'arreglo y condicion siguen guardándose igual que siempre');

// ── 3) Sale en la boleta ────────────────────────────────────
console.log('\n3) Sale en la boleta A5');
const ctx = {
  console, TextEncoder, crypto: require('crypto').webcrypto,
  btoa: s => Buffer.from(s, 'binary').toString('base64'), unescape, encodeURIComponent,
  location: { origin: 'https://x' }, window: { _DAKI_NAME: 'TechPoint' },
  document: { getElementById: () => null, addEventListener: () => {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  BIZ_DATA: { dir: 'Urquiza 4741', tel: '11 7239-2511', extra: 'Lun a Sáb 9 a 19' },
  toast: () => {}, esc: s => String(s == null ? '' : s), alert: () => {},
  getConfig: () => ({ telefonoNegocio: '1172392511' }), STOCK: [],
};
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['qr.js', 'tp-fases.js', 'seguimiento.js', 'print.js']) {
  vm.runInContext(leer(f), ctx, { filename: f });
}

const LA_FALLA = 'Se apaga solo cuando llega al 30% de batería';
ctx.__REP = {
  id: 'r1', nOrden: 7123, marca: 'Samsung', modelo: 'A54',
  arreglo: 'Batería', falla: LA_FALLA, condicion: 'Rayón en la tapa',
  monto: 85000, sena: 20000, nombre: 'Marina', tlf: '11',
  estado: 'reparando', fase: 'reparacion',
  fechaIngreso: '2026-08-01T10:00:00.000Z', diasGarantia: 90,
  tokenSeguimiento: 'k3n8x2p9qm4vb7ctd5ef',
};
const a5 = vm.runInContext('_buildA5(__REP)', ctx);

ok(a5.includes(LA_FALLA), 'la falla declarada se imprime', LA_FALLA);
ok(/Falla declarada/.test(a5), 'con su etiqueta, para que se entienda qué es');
// El orden importa: primero con qué entró, después qué se le va a hacer.
ok(a5.indexOf('Falla declarada') < a5.indexOf('Batería'),
   'la falla va antes del trabajo a realizar');
ok(a5.includes('Rayón en la tapa'), 'la condición visual sigue saliendo aparte');

// Sin falla cargada la boleta no tiene que mostrar el renglón vacío.
ctx.__REP2 = Object.assign({}, ctx.__REP, { falla: '' });
const a5sin = vm.runInContext('_buildA5(__REP2)', ctx);
ok(!/Falla declarada/.test(a5sin), 'si no se cargó, no aparece el renglón vacío');

// Las reparaciones viejas no tienen el campo: no se puede romper por eso.
ctx.__REP3 = Object.assign({}, ctx.__REP);
delete ctx.__REP3.falla;
const a5viejo = vm.runInContext('_buildA5(__REP3)', ctx);
ok(a5viejo.includes('Batería') && !/Falla declarada/.test(a5viejo),
   'una reparación vieja sin el campo se imprime igual que antes');

// ── 4) Se ve en la ficha ────────────────────────────────────
console.log('\n4) Se ve en la ficha y en el ticket');
ok(/Falla declarada[\s\S]{0,120}r\.falla|r\.falla[\s\S]{0,120}Falla declarada/.test(repairs),
   'la ficha de la reparación muestra la falla');
ok(/ticket-lbl">Falla</.test(repairs), 'el ticket compartible también');

// ── 5) Alimenta el diagnóstico con IA ───────────────────────
console.log('\n5) El diagnóstico IA la usa');
const cuerpoIA = repairs.slice(repairs.indexOf('async function aiRepairDiagnosis'),
                               repairs.indexOf('async function aiRepairTimePrice'));
ok(/rep-fi-falla/.test(cuerpoIA), 'el diagnóstico IA lee la falla');
ok(/\[falla, arreglo, condicion\]/.test(cuerpoIA),
   'y la manda primero, que es el dato más útil');

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
