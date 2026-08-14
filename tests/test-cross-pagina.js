// Vigila que una pantalla no llame a una función que su página no carga.
//
// El bug que originó esta prueba: `confirmarCobro()` vive en repairs.js y usa
// `_todayAR()`, que estaba definida en caja.js. Pero index.html NO carga
// caja.js. Resultado: cobrar una reparación desde la pantalla de reparaciones
// tiraba ReferenceError, el catch lo tapaba y solo se veía "Error al registrar
// en caja". Un bug de plata invisible.
//
// Lo mismo pasaba con fmt(), que también vivía solo en caja.js.
//
// Esto no lo agarra `node --check` (la sintaxis está bien) ni las otras
// pruebas (cada una carga a mano lo que necesita). Solo se ve mirando qué
// carga cada HTML.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';

let fails = 0;
const ok = (c, l, x) => {
  console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x, null, 1)));
  if (!c) fails++;
};

// Scripts propios que carga cada página (los del CDN no interesan)
const scriptsDe = html =>
  (fs.readFileSync(DIR + html, 'utf8').match(/src="([a-z0-9_-]+\.js)"/g) || [])
    .map(s => s.slice(5, -1));

// Nombres declarados arriba de todo en un archivo (funciones y const/let de función)
function declaradosEn(archivos) {
  const set = new Set();
  for (const f of archivos) {
    if (!fs.existsSync(DIR + f)) continue;
    const s = fs.readFileSync(DIR + f, 'utf8');
    for (const m of s.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) set.add(m[1]);
    for (const m of s.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) set.add(m[1]);
  }
  return set;
}

// Busca llamadas a `nombre(` que no estén protegidas por un typeof cercano.
// Las regex se compilan UNA vez: hacerlo por nombre y por línea llevaba la
// suite entera de 1,5 s a 7 s, y esto corre antes de cada push.
function llamadasSinGuarda(archivos, nombres) {
  const res = nombres.map(n => {
    const esc = n.replace(/\$/g, '\\$');
    return {
      n,
      // Ni propiedad (.x), ni dentro de un string, ni parte de otra palabra
      llamada: new RegExp(`(?<![\\w$.'"\`])${esc}\\s*\\(`),
      guarda:  new RegExp(`typeof\\s+${esc}`),
    };
  });
  const hits = [];
  for (const f of archivos) {
    if (!fs.existsSync(DIR + f)) continue;
    const lineas = fs.readFileSync(DIR + f, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(linea)) return;   // comentarios no
      for (const { n, llamada, guarda } of res) {
        if (!llamada.test(linea)) continue;
        // `typeof X === 'function'` es una guarda válida y muy usada acá.
        // Ventana holgada: la guarda puede estar unas líneas arriba, con el
        // console.error y el toast en el medio.
        if (guarda.test(lineas.slice(Math.max(0, i - 14), i + 1).join(' '))) continue;
        hits.push(`${f}:${i + 1}  ${n}()  →  ${linea.trim().slice(0, 60)}`);
      }
    });
  }
  return hits;
}

const PAGINAS = ['index.html', 'caja.html'];

console.log('\n1) Cada página carga sus dependencias');
const scripts = {};
PAGINAS.forEach(p => {
  scripts[p] = scriptsDe(p);
  ok(scripts[p].length > 5, `${p} carga sus scripts`, scripts[p].length);
  ok(scripts[p][0] === 'utils.js',
     `${p} carga utils.js primero (todo lo compartido vive ahí)`, scripts[p][0]);
});

console.log('\n2) Nadie llama a algo que su página no carga');
PAGINAS.forEach(pagina => {
  const otras = PAGINAS.filter(p => p !== pagina);
  const mios  = scripts[pagina];
  // Lo que declaran los archivos que ESTA página no carga
  const ajenos = new Set();
  otras.forEach(o => {
    scripts[o].filter(f => !mios.includes(f)).forEach(f => {
      declaradosEn([f]).forEach(n => ajenos.add(n));
    });
  });
  // Descontar lo que también existe en los archivos que esta página sí carga
  const propios = declaradosEn(mios);
  const soloAjenos = [...ajenos].filter(n => !propios.has(n));

  const hits = llamadasSinGuarda(mios, soloAjenos);
  ok(hits.length === 0,
     `${pagina}: ninguna llamada quedaría sin definir`, hits);
});

console.log('\n3) Las dos que causaron el bug están donde tienen que estar');
const utils = fs.readFileSync(DIR + 'utils.js', 'utf8');
const caja  = fs.readFileSync(DIR + 'caja.js', 'utf8');
ok(/^function fmt\(/m.test(utils), 'fmt() vive en utils.js');
ok(/^const _todayAR/m.test(utils), '_todayAR() vive en utils.js');
// Declararlas dos veces con const es SyntaxError y tumba la página entera.
ok(!/^function fmt\(/m.test(caja), 'caja.js ya no la declara de nuevo');
ok(!/^const _todayAR/m.test(caja),
   'caja.js tampoco _todayAR (dos const con el mismo nombre = la página no arranca)');

// Y que sigan haciendo exactamente lo mismo que antes.
const ctx = {};
new Function('ctx', utils.replace(/^'use strict';?/m, '') + '\nctx.fmt = fmt; ctx._todayAR = _todayAR;')(ctx);
ok(ctx.fmt(12500) === '$12.500', 'fmt formatea igual que antes', ctx.fmt(12500));
ok(ctx.fmt(-800) === '$800', 'fmt sigue mostrando el valor absoluto', ctx.fmt(-800));
ok(ctx.fmt(0) === '$0', 'fmt con cero');
ok(ctx.fmt(null) === '$0', 'fmt sin dato no dice NaN', ctx.fmt(null));
ok(/^\d{4}-\d{2}-\d{2}$/.test(ctx._todayAR()), '_todayAR devuelve YYYY-MM-DD', ctx._todayAR());

console.log('\n4) El cobro de una reparación');
const repairs = fs.readFileSync(DIR + 'repairs.js', 'utf8');
const cuerpo = repairs.slice(repairs.indexOf('async function confirmarCobro'),
                             repairs.indexOf('async function confirmarCobro') + 2000);
ok(/_todayAR\(\)/.test(cuerpo), 'confirmarCobro sigue usando la fecha argentina');
ok(/caja_movimientos/.test(cuerpo), 'y sigue escribiendo el movimiento en la caja');
ok(scriptsDe('index.html').includes('utils.js'),
   'index.html carga utils.js, así que ahora la encuentra');

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
