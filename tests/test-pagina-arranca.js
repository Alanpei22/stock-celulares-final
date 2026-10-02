// ¿La página ARRANCA? (o sea: ¿los archivos que carga se pueden leer juntos?)
//
// Esta prueba nació de dejar la app sin poder entrar. Al mover `openSheet` a
// utils.js quedó un `let _sheetHideTimer` en caja.js y otro en utils.js. Dos
// `let` con el mismo nombre en la misma página NO es un error de una línea:
// el navegador no parsea el archivo entero, caja.js no existe, y la pantalla
// se queda en el logo para siempre. `node --check` archivo por archivo no lo
// ve, porque cada uno por separado está bien.
//
// Acá se pegan los scripts de cada página en el mismo orden en que los carga
// el navegador y se los parsea juntos, que es lo que pasa de verdad.
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const PAGINAS = fs.readdirSync(DIR).filter(f => f.endsWith('.html'));

console.log('\n1) Los scripts de cada página se leen juntos sin chocar');
PAGINAS.forEach(p => {
  const html = fs.readFileSync(DIR + p, 'utf8');
  const propios = (html.match(/<script[^>]*src="([^"]+)"/g) || [])
    .map(s => (s.match(/src="([^"]+)"/) || [])[1])
    .filter(s => s && !/^https?:/.test(s) && fs.existsSync(DIR + s));
  if (!propios.length) { ok(true, `${p}: no carga scripts propios`); return; }
  // Lo mismo que hace el navegador: un script atrás del otro, mismo ámbito.
  const junto = propios.map(f => fs.readFileSync(DIR + f, 'utf8')).join('\n;\n');
  let error = null;
  try { new vm.Script(junto, { filename: p }); } catch (e) { error = e.message; }
  ok(!error, `${p} (${propios.length} archivos)`, error);
});

console.log('\n2) Nadie declara dos veces el mismo nombre arriba de todo');
// Un `function` repetido no rompe pero se pisa en silencio: queda el último y
// el otro se vuelve mentira. Así vivieron tres copias de `toast` con distinto
// comportamiento según la página.
const decls = src => {
  const d = new Map();
  for (const m of src.matchAll(/^(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)) d.set(m[1], 'let');
  for (const m of src.matchAll(/^(?:async )?function\s+([A-Za-z_$][\w$]*)/gm)) if (!d.has(m[1])) d.set(m[1], 'function');
  return d;
};
PAGINAS.forEach(p => {
  const html = fs.readFileSync(DIR + p, 'utf8');
  const propios = (html.match(/<script[^>]*src="([^"]+)"/g) || [])
    .map(s => (s.match(/src="([^"]+)"/) || [])[1])
    .filter(s => s && !/^https?:/.test(s) && fs.existsSync(DIR + s));
  const visto = new Map(), choques = [];
  propios.forEach(f => {
    decls(fs.readFileSync(DIR + f, 'utf8')).forEach((tipo, nombre) => {
      if (visto.has(nombre)) choques.push(`${nombre} (${visto.get(nombre)} vs ${f})`);
      else visto.set(nombre, f);
    });
  });
  // `esc` y `fmtDate` vienen repetidas de antes y son inofensivas (hacen lo
  // mismo); se dejan anotadas para que no crezca la lista sin que nadie mire.
  const CONOCIDOS = ['esc (utils.js vs app.js)', 'fmtDate (repairs.js vs app.js)'];
  const nuevos = choques.filter(c => !CONOCIDOS.includes(c));
  ok(nuevos.length === 0, `${p}: sin nombres repetidos nuevos`, nuevos);
});

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
