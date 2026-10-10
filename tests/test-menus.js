// Los menús ⋮ se leen de una mirada.
//
// Habían crecido sin control: la caja llegó a 14 opciones de un tirón,
// reparaciones y stock a 12, repuestos a 11. Una lista así no se lee, se
// busca — y buscar con un cliente enfrente es justo lo que no querés.
//
// Lo que las agrupa es `sheetGrupo` (utils.js), uno solo para todas las
// pantallas: una opción que abre otra hoja con las de adentro y un "Volver".
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// ── Lee un menú del código fuente y separa lo de arriba de lo de adentro ──
// Se cuenta profundidad: un `label:` que esté dentro de un sheetGrupo(...) o de
// cualquier paréntesis anidado NO es una opción de arriba.
function menu(archivo, titulo) {
  const s = leer(archivo);
  const i = s.indexOf(`openSheet('${titulo}', [`);
  if (i < 0) return null;
  const a = s.indexOf('[', i) + 1;
  const b = s.indexOf('\n  ]);', a);
  const cuerpo = s.slice(a, b);

  const arriba = [], adentro = [], grupos = [];
  let prof = 0;
  for (let j = 0; j < cuerpo.length; j++) {
    const c = cuerpo[j];
    if (c === "'" || c === '"' || c === '`') {       // saltar el texto entrecomillado
      const fin = cuerpo.indexOf(c, j + 1);
      if (fin < 0) break;
      j = fin; continue;
    }
    if (c === '[' || c === '(') prof++;
    else if (c === ']' || c === ')') prof--;
    else if (cuerpo.startsWith('label:', j)) {
      const m = /label:\s*(?:[^']*\?\s*)?'([^']+)'(?:\s*:\s*'([^']+)')?/.exec(cuerpo.slice(j, j + 180));
      if (m) (prof > 0 ? adentro : arriba).push(m[2] || m[1]);
    } else if (cuerpo.startsWith('sheetGrupo(', j)) {
      const m = /sheetGrupo\([^,]+,\s*'[^']+'\s*,\s*'[^']*'\s*,\s*'([^']+)'/.exec(cuerpo.slice(j, j + 200));
      if (m) grupos.push(m[1]);
    }
  }
  return { arriba: arriba.concat(grupos), adentro, grupos };
}

const MENUS = [
  { archivo: 'caja.js',       titulo: 'Caja',          antes: 14 },
  { archivo: 'app.js',        titulo: 'Reparaciones',  antes: 12 },
  { archivo: 'app.js',        titulo: 'Stock',         antes: 12 },
  { archivo: 'app.js',        titulo: 'Repuestos',     antes: 11 },
  { archivo: 'inventario.js', titulo: 'Inventario',    antes: 12 },
];

console.log('\n1) Ninguno pasa de diez opciones arriba');
MENUS.forEach(m => {
  const r = menu(m.archivo, m.titulo);
  ok(!!r, `${m.titulo}: se encontró el menú`);
  if (!r) return;
  ok(r.arriba.length <= 10, `${m.titulo}: ${r.arriba.length} opciones (antes ${m.antes})`, r.arriba);
});

console.log('\n2) Lo de todos los días quedó arriba');
// Agrupar está bien mientras no esconda lo que se usa a cada rato.
const quedaArriba = {
  'Caja': ['Cerrar caja del día', 'Precios de reparación', 'Caja Dueño'],
  'Reparaciones': ['Diagnóstico de placa', 'Estadísticas', 'Actividad reciente'],
  'Stock': ['Seleccionar varios', 'Página de equipos', 'Empleados', 'Configuración'],
  'Repuestos': ['Seleccionar varios', 'Control de stock guiado', 'Pedido de mercadería'],
  'Inventario': ['Seleccionar varios', 'Roturas del mes', 'Cargar costos'],
};
MENUS.forEach(m => {
  const r = menu(m.archivo, m.titulo);
  if (!r) return;
  (quedaArriba[m.titulo] || []).forEach(l => {
    // "Cerrar caja del día" cambia de texto cuando ya cerraste: vale cualquiera.
    const esta = r.arriba.some(x => x === l || x.startsWith(l.slice(0, 12))) ||
                 (l === 'Cerrar caja del día' && r.arriba.includes('Cierre registrado'));
    ok(esta, `${m.titulo}: "${l}" sigue a un toque`, r.arriba);
  });
});

console.log('\n3) Lo de etiquetas, junto en las tres pantallas que imprimen');
['Stock', 'Repuestos', 'Inventario'].forEach(t => {
  const r = menu(MENUS.find(m => m.titulo === t).archivo, t);
  ok(r.grupos.some(g => /Etiquetas/.test(g)), `${t}: tiene el grupo de etiquetas`, r.grupos);
  ['Sentido de la etiqueta', 'Impresión directa'].forEach(l =>
    ok(!r.arriba.includes(l), `${t}: "${l}" ya no está suelta arriba`, r.arriba));
});

console.log('\n4) La misma cosa se llama igual en todas');
// En Stock se llamaba "Selección múltiple" y en las otras dos "Seleccionar
// varios". Es lo mismo: dos nombres para lo mismo te hacen dudar.
['Stock', 'Repuestos', 'Inventario'].forEach(t => {
  const r = menu(MENUS.find(m => m.titulo === t).archivo, t);
  ok(r.arriba.includes('Seleccionar varios'), `${t}: se llama "Seleccionar varios"`, r.arriba);
});
ok(!/label: 'Selección múltiple'/.test(leer('app.js')), 'no quedó el nombre viejo');

console.log('\n5) sheetGrupo: el grupo de verdad');
const els = {};
const el = id => els[id] = { id, textContent: '', innerHTML: '', style: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  addEventListener() {} };
['sheet-title', 'sheet-items', 'sheet-overlay', 'sheet'].forEach(el);
const ctx = {
  console, setTimeout: f => f(), clearTimeout, requestAnimationFrame: f => f(), Date, Math, JSON,
  document: { getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [],
              createElement: () => el('tmp'), addEventListener() {}, body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node' },
};
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(leer('utils.js'), ctx, { filename: 'utils.js' });
const run = e => vm.runInContext(e, ctx);

let abiertas = [];
ctx.__ABRIR = (t, items) => abiertas.push({ t, items });
run('openSheet = (t, items) => __ABRIR(t, items);');

ctx.__PADRE = () => abiertas.push({ t: 'PADRE', items: [] });
ctx.__A = () => {}; ctx.__B = () => {};
run(`__G = sheetGrupo(__PADRE, 'Etiquetas', 'X', 'Etiquetas e impresión', 'sub', [
  { icon: '1', label: 'Imprimir', onClick: __A },
  { icon: '2', label: 'Impresora', onClick: __B },
])`);
ok(run('__G.label') === 'Etiquetas e impresión', 'el grupo se ve como una opción más');
ok(run('typeof __G.submenu') === 'function', 'que abre otra hoja');
ok(run('__G.hide') === false, 'y se muestra si adentro hay algo');
run('__G.submenu()');
const h = abiertas[abiertas.length - 1];
ok(h.t === 'Etiquetas', 'la hoja de adentro tiene su título', h.t);
ok(h.items.filter(i => !i.divider).map(i => i.label).join(',') === 'Imprimir,Impresora,Volver',
   'con las de adentro y un Volver', h.items.map(i => i.label));
h.items.find(i => i.label === 'Volver').submenu();
ok(abiertas[abiertas.length - 1].t === 'PADRE', 'y Volver trae el menú de afuera');

// Un grupo vacío por permisos sería una puerta a una pieza vacía.
run(`__V = sheetGrupo(__PADRE, 'X', 'X', 'Vacío', null, [
  { label: 'a', hide: true, onClick: __A },
  { label: 'b', hide: true, onClick: __B },
])`);
ok(run('__V.hide') === true, 'si los permisos esconden todo lo de adentro, el grupo no se muestra');
run(`__P = sheetGrupo(__PADRE, 'X', 'X', 'Parcial', null, [
  { label: 'a', hide: true, onClick: __A },
  { label: 'b', onClick: __B },
])`);
ok(run('__P.hide') === false, 'con uno solo visible, sí');
abiertas = [];
run('__P.submenu()');
ok(abiertas[0].items.filter(i => !i.divider && i.label !== 'Volver').length === 1,
   'y adentro va solo lo que puede ver', abiertas[0].items.map(i => i.label));

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
