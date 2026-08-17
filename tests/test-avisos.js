// Harness sin navegador para la campanita de novedades (avisos.js).
//
// Qué es: un popup con las últimas actualizaciones de reparaciones, agrupadas
// por equipo (si una cambió 3 veces es UNA fila que dice "3 cambios"), con un
// globito rojo que cuenta EQUIPOS con novedades, no cambios sueltos.
//
// Lo más delicado acá es el CUPO: el globito necesita un listener vivo, y un
// listener sin techo sobre `actividad` sería exactamente lo que la regla 6
// prohíbe. Por eso la mitad de esta prueba vigila que el límite siga puesto.
// (test-cupo.js no lo ve: su sandbox no carga avisos.js y la guarda
//  `typeof initAvisos === 'function'` lo saltea.)
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
const leer = f => fs.readFileSync(DIR + f, 'utf8');

let fails = 0;
const ok = (c, l, x) => {
  console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x)));
  if (!c) fails++;
};

// ── DOM mínimo ──────────────────────────────────────────────
const els = {};
function el(id) {
  return els[id] = {
    id, textContent: '', innerHTML: '', value: '', style: {},
    classList: {
      _s: new Set(['hidden']),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { f === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (f ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); },
    },
  };
}
['avisos-popup', 'avisos-backdrop', 'avisos-lista'].forEach(id => el(id));
// Tres globitos: uno por sección. Cada página tiene un header por sección y
// el botón se repite en todos, así que el código tiene que pintarlos TODOS.
const BADGES = [el('b1'), el('b2'), el('b3')];

let STORE = {};
let SUSCRIPCION = null;   // lo que le pidió al Firestore falso

const ctx = {
  console, setTimeout: f => f(), clearTimeout,
  document: {
    getElementById: id => els[id] || null,
    querySelectorAll: sel => (sel === '.avisos-badge' ? BADGES : []),
  },
  window: {}, location: { href: '' },
  localStorage: {
    getItem: k => (k in STORE ? STORE[k] : null),
    setItem: (k, v) => { STORE[k] = String(v); },
    removeItem: k => { delete STORE[k]; },
  },
  db: {
    collection: nombre => {
      const q = { _c: nombre, _orden: null, _limite: null };
      q.orderBy = (campo, dir) => { q._orden = campo + ' ' + dir; return q; };
      q.limit = n => { q._limite = n; return q; };
      q.onSnapshot = (cb) => { SUSCRIPCION = { q, cb }; return () => { SUSCRIPCION = null; }; };
      return q;
    },
  },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('avisos.js'), ctx, { filename: 'avisos.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);

// Empujar eventos como si vinieran de Firestore
const emitir = evs => SUSCRIPCION.cb({ docs: evs.map(e => ({ data: () => e })) });
const badge = () => BADGES[0].textContent;
const badgeVisible = () => !BADGES[0].classList.contains('hidden');
// Todos los globitos tienen que decir lo mismo: si solo se pintara el primero,
// en las demás secciones no aparecería nada. (Fue exactamente el bug.)
const badgesCoinciden = () =>
  BADGES.every(b => b.textContent === BADGES[0].textContent
                 && b.classList.contains('hidden') === BADGES[0].classList.contains('hidden'));

const hace = min => new Date(Date.now() - min * 60000).toISOString();

// ══════════════════════════════════════════════════════════
console.log('\n1) El CUPO: el listener tiene techo');
run('initAvisos()');
ok(!!SUSCRIPCION, 'se suscribió');
ok(SUSCRIPCION.q._c === 'actividad', 'a la colección de actividad', SUSCRIPCION.q._c);
ok(SUSCRIPCION.q._limite > 0, 'CON limit(): sin esto lee la colección entera', SUSCRIPCION.q._limite);
ok(SUSCRIPCION.q._limite <= 100,
   'y el techo es bajo (60 lecturas la 1ª vez, después 1 por evento)', SUSCRIPCION.q._limite);
ok(/fecha desc/.test(SUSCRIPCION.q._orden || ''), 'ordenado por fecha, lo último primero', SUSCRIPCION.q._orden);

const src = leer('avisos.js');
ok(!/collection\('(repairs|stock|repuestos|productos)'\)/.test(src),
   'no toca repairs, stock, repuestos ni productos');
ok((src.match(/\.onSnapshot\(/g) || []).length === 1, 'un solo listener en todo el archivo');
// Llamarlo de nuevo (dos páginas, o un re-init) no puede duplicar la suscripción.
const antes = SUSCRIPCION;
run('initAvisos()');
ok(SUSCRIPCION === antes, 'llamarlo de nuevo NO abre una segunda suscripción');

console.log('\n2) Una fila por reparación, no una por cambio');
STORE = {};   // dispositivo nuevo: todo es novedad
emitir([
  { repairId: 'r1', tipo: 'estado',  desc: 'Samsung A54 N°7001 → Listo',      fecha: hace(5),  extra: { nOrden: 7001 } },
  { repairId: 'r1', tipo: 'whatsapp', desc: 'WhatsApp enviado a Marina',      fecha: hace(20), extra: { nOrden: 7001 } },
  { repairId: 'r1', tipo: 'ingreso', desc: 'Samsung A54 N°7001 ingresó',      fecha: hace(90), extra: { nOrden: 7001 } },
  { repairId: 'r2', tipo: 'estado',  desc: 'Motorola G32 N°7002 → Reparando', fecha: hace(40), extra: { nOrden: 7002 } },
]);
const filas = () => (els['avisos-lista'].innerHTML.match(/class="avisos-fila/g) || []).length;
ok(filas() === 2, '4 cambios de 2 equipos → 2 filas', filas());
ok(/3 cambios/.test(els['avisos-lista'].innerHTML),
   'la fila dice cuántos cambios tuvo ese equipo');
ok(!/1 cambios/.test(els['avisos-lista'].innerHTML),
   'y no dice "1 cambios" cuando hubo uno solo');

// El de arriba tiene que ser el más reciente de ese equipo, no el primero que llegó.
const iListo = els['avisos-lista'].innerHTML.indexOf('→ Listo');
const iWa    = els['avisos-lista'].innerHTML.indexOf('WhatsApp enviado');
ok(iListo >= 0 && (iWa < 0 || iListo < iWa),
   'de cada equipo se muestra el último cambio');

console.log('\n3) El globito cuenta EQUIPOS, no cambios');
// Es la decisión que tomamos: si contara cambios diría 4 y abajo verías 2
// filas, y el número no cerraría con lo que se ve.
ok(badge() === '2', 'globito = 2 (los dos equipos con novedades)', badge());
ok(badgeVisible(), 'y se ve');
ok(badgesCoinciden(), 'y se ve IGUAL en las tres secciones, no solo en la primera',
   BADGES.map(b => b.textContent + (b.classList.contains('hidden') ? ' (oculto)' : '')));

console.log('\n4) Lo ya visto deja de contar');
STORE['avisos_visto'] = hace(30);   // vi la campana hace media hora
emitir([
  { repairId: 'r1', tipo: 'estado', desc: 'A54 → Listo',      fecha: hace(5),  extra: {} },  // nuevo
  { repairId: 'r2', tipo: 'estado', desc: 'G32 → Reparando',  fecha: hace(40), extra: {} },  // viejo
]);
ok(badge() === '1', 'solo cuenta lo posterior a la última mirada', badge());
ok(filas() === 2, 'pero la lista sigue mostrando los dos', filas());
ok(/avisos-fila--nueva/.test(els['avisos-lista'].innerHTML),
   'y se resalta cuál es el nuevo');

console.log('\n5) Abrir el popup apaga el globito');
run('abrirAvisos()');
ok(!els['avisos-popup'].classList.contains('hidden'), 'el popup se abre');
ok(!badgeVisible(), 'el globito se apaga', badge());
ok(badgesCoinciden(), 'se apagan los de todas las secciones');
ok(!!STORE['avisos_visto'], 'y queda anotado que se miró');
// Es un popup, no un modal: no bloquea el scroll de la página de atrás.
ok(!/document\.body\.style\.overflow/.test(src),
   'no bloquea la pantalla como hacen los modales');
run('cerrarAvisos()');
ok(els['avisos-popup'].classList.contains('hidden'), 'y se cierra');

// Después de mirar, lo que ya estaba no vuelve a contar
emitir([{ repairId: 'r2', tipo: 'estado', desc: 'G32 → Reparando', fecha: hace(40), extra: {} }]);
ok(!badgeVisible(), 'lo viejo no vuelve a encender el globito', badge());

console.log('\n5b) La barrita de color del cambio de estado');
// Todas las filas se veían iguales. La barrita dice de un vistazo si algo se
// entregó, si se cayó o si sigue en curso.
STORE = {};
emitir([
  { repairId: 'a', tipo: 'estado', desc: 'A → Listo',     fecha: hace(1), extra: { estadoNuevo: 'listo' } },
  { repairId: 'b', tipo: 'estado', desc: 'B → Entregado', fecha: hace(2), extra: { estadoNuevo: 'entregado' } },
  { repairId: 'c', tipo: 'estado', desc: 'C → No va',     fecha: hace(3), extra: { estadoNuevo: 'no va' } },
  { repairId: 'd', tipo: 'estado', desc: 'D → Reparando', fecha: hace(4), extra: { estadoNuevo: 'reparando' } },
]);
const h5 = () => els['avisos-lista'].innerHTML;
ok(/avisos-fila--ok/.test(h5()),   'listo → verde');
ok(/avisos-fila--fin/.test(h5()),  'entregado → su propio color, no el mismo que listo');
ok(/avisos-fila--bad/.test(h5()),  'no va → rojo');
ok(/avisos-fila--work/.test(h5()), 'reparando → ámbar');

// Los cambios que salen del tablero de fases guardan `faseNueva`, no
// `estadoNuevo`. Si solo se mirara uno, la mitad quedaría sin color.
emitir([
  { repairId: 'e', tipo: 'estado', desc: 'E → Esperando repuesto', fecha: hace(1), extra: { faseNueva: 'repuesto' } },
  { repairId: 'f', tipo: 'estado', desc: 'F → Sin reparación',     fecha: hace(2), extra: { faseNueva: 'irreparable' } },
]);
ok(/avisos-fila--wait/.test(h5()), 'fase del tablero: esperando repuesto → gris');
ok(/avisos-fila--bad/.test(h5()),  'fase del tablero: irreparable → rojo');

// Solo los cambios de estado llevan barrita: era lo pedido.
emitir([
  { repairId: 'g', tipo: 'whatsapp', desc: 'WhatsApp enviado', fecha: hace(1), extra: {} },
  { repairId: 'h', tipo: 'ingreso',  desc: 'Ingresó un equipo', fecha: hace(2), extra: {} },
]);
ok(!/avisos-fila--(ok|fin|bad|work|wait)/.test(h5()),
   'un WhatsApp o un ingreso no llevan color de estado', h5().slice(0, 120));

// Un estado que no conocemos no puede romper el marcado
emitir([{ repairId: 'i', tipo: 'estado', desc: 'X → ???', fecha: hace(1), extra: { estadoNuevo: 'inventado' } }]);
ok(/class="avisos-fila /.test(h5()) && !/avisos-fila--undefined/.test(h5()),
   'un estado desconocido queda sin color, sin ensuciar la clase', h5().slice(0, 140));

console.log('\n6) Solo reparaciones');
STORE = {};
emitir([
  { repairId: 'r1', tipo: 'estado', desc: 'A54 → Listo', fecha: hace(5), extra: {} },
  { repairId: null, tipo: 'venta',  desc: 'Venta: iPhone 13 — $520.000', fecha: hace(2), extra: {} },
  { tipo: 'repuesto', desc: 'Repuesto nuevo cargado', fecha: hace(1), extra: {} },
]);
ok(filas() === 1, 'las ventas y los repuestos no entran', filas());
ok(!/Venta: iPhone/.test(els['avisos-lista'].innerHTML), 'no se cuela la venta');
ok(badge() === '1', 'ni cuentan para el globito', badge());

console.log('\n7) Sin nada, no miente');
STORE = {};
emitir([]);
ok(/avisos-vacio/.test(els['avisos-lista'].innerHTML), 'dice que no hay movimientos');
ok(!badgeVisible(), 'y no muestra un globito en cero');

console.log('\n8) Funciona igual desde la caja');
// caja.html NO carga repairs.js. Este archivo no puede depender de él.
ok(!/\bREPAIRS\b(?![\s\S]{0,40}typeof)/.test(src.replace(/typeof REPAIRS/g, '')) ||
   /typeof REPAIRS !== 'undefined'/.test(src),
   'si usa REPAIRS, siempre lo chequea antes');
ok(!/openRepairDetail\(/.test(src) || /typeof openRepairDetail === 'function'/.test(src),
   'y lo mismo con openRepairDetail');
ok(/index\.html\?repair=/.test(src),
   'desde la caja navega a index.html con el id, en vez de romper');
ok(/function _avEsc/.test(src), 'tiene su propio escape (no depende de utils.js)');

// Las dos páginas tienen que traer el mismo bloque de la campana
const idx = leer('index.html'), caj = leer('caja.html');
[['index.html', idx], ['caja.html', caj]].forEach(([n, h]) => {
  ok(/src="avisos\.js"/.test(h), `${n} carga avisos.js`);
  ok(/id="avisos-popup"/.test(h) && /id="avisos-lista"/.test(h), `${n} tiene el popup`);
  ok(/onclick="toggleAvisos\(\)"/.test(h), `${n} tiene la campana clickeable`);

  // ESTE fue el bug: cada sección tiene su propio <header>, y la campana
  // estaba solo en el primero. Desde Reparaciones no se veía nada.
  const headers = (h.match(/<div class="hdr-actions">/g) || []).length;
  const botones = (h.match(/class="hdr-btn avisos-btn"/g) || []).length;
  ok(headers > 1, `${n} tiene un header por sección (${headers})`, headers);
  ok(botones === headers,
     `${n}: la campana está en TODOS los headers, no solo en el primero`,
     { headers, botones });

  // Y el popup tiene que ser uno solo: repetido, getElementById agarra el
  // primero y los demás quedan muertos.
  ok((h.match(/id="avisos-popup"/g) || []).length === 1, `${n}: un solo popup`);
  ok((h.match(/id="avisos-lista"/g) || []).length === 1, `${n}: una sola lista`);
  ok((h.match(/id="avisos-badge"/g) || []).length === 0,
     `${n}: el globito va por clase, no por id (se repite en cada header)`);
});
// El código tiene que pintarlos todos, no solo el primero.
ok(/querySelectorAll\('\.avisos-badge'\)/.test(src),
   'avisos.js busca TODOS los globitos');
ok(!/getElementById\('avisos-badge'\)/.test(src),
   'y ninguno por id, que solo devolvería el primero');
ok(/initAvisos\(\)/.test(leer('app.js')) && /initAvisos\(\)/.test(leer('caja.js')),
   'las dos páginas lo arrancan');
ok(/\?repair=|params\.get\('repair'\)/.test(leer('app.js')),
   'index.html sabe abrir la ficha que le mandan por URL');
ok(/_avisosCleanup/.test(leer('auth.js')),
   'al cerrar sesión se corta el listener (si no, sigue leyendo)');

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
