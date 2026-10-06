// Que las pantallas se vean como el resto de la app.
//
// Dos cosas se escaparon durante meses y las dos dan el mismo síntoma: una
// pantalla que "se ve rara" sin que nada esté roto.
//
//   · El buscador de Accesorios era un input pelado del navegador, angosto,
//     con la lupa impresa encima del texto. La regla del buscador estaba
//     atada a los IDs de index.html (#search, #rep-search, #rep2-search) y
//     los de las otras páginas no entraban. Lo mismo en Placas.
//
//   · `var(--bd)` no existe en ninguna hoja de estilo. Donde se usaba, el
//     navegador caía al gris claro de respaldo: rayas blancas sobre el fondo
//     negro del modo oscuro.
//
// Las dos se chequean mirando los archivos, que es como se verifica acá: la
// app está detrás del login y no se puede abrir en un navegador.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const PAGINAS = fs.readdirSync(DIR).filter(f => f.endsWith('.html') && !f.startsWith('prev'));
const HOJAS   = fs.readdirSync(DIR).filter(f => f.endsWith('.css'));
const SCRIPTS = fs.readdirSync(DIR).filter(f => f.endsWith('.js'));
const leer = f => fs.readFileSync(DIR + f, 'utf8');
const css = HOJAS.map(leer).join('\n');

console.log('\n1) Todo buscador tiene estilo de buscador');
// Cada <input type="search"> adentro de un .search-wrap tiene que estar en la
// regla que le da ancho, alto y el lugar para la lupa. Si no, sale el input
// crudo del navegador con el ícono encima.
const regla = (css.match(/#search,[^{]*\{/) || [''])[0];
ok(/#search\b/.test(regla), 'existe la regla de los buscadores', regla.slice(0, 80));

const buscadores = [];
PAGINAS.forEach(p => {
  const h = leer(p);
  // Solo los que viven en un .search-wrap: los otros tienen su propio estilo.
  const re = /<div class="search-wrap">[\s\S]{0,400}?<input id="([\w-]+)"/g;
  let m; while ((m = re.exec(h))) buscadores.push({ pagina: p, id: m[1] });
});
ok(buscadores.length >= 5, `se encontraron ${buscadores.length} buscadores en las páginas`, buscadores);
buscadores.forEach(b => {
  ok(regla.indexOf('#' + b.id) >= 0,
     `${b.pagina}: #${b.id} está en la regla (si no, sale el input pelado)`, regla);
});
// Y el foco y el placeholder tienen que acompañar, o el campo salta al tocarlo.
['::placeholder', ':focus'].forEach(suf => {
  const r = (css.match(new RegExp('#search' + suf.replace(/[:]/g, '\\:') + '[^{]*\\{')) || [''])[0];
  buscadores.forEach(b => ok(r.indexOf('#' + b.id + suf) >= 0,
     `#${b.id}${suf} también`, r.slice(0, 120)));
});

console.log('\n2) Ninguna variable de color inventada');
// Una `var(--loquesea)` que nadie definió no falla: el navegador usa el valor
// de respaldo, que siempre está escrito para el modo claro. En el oscuro
// queda un gris claro de más.
const definidas = new Set();
(css.match(/(--[\w-]+)\s*:/g) || []).forEach(s => definidas.add(s.replace(':', '').trim()));
// Las páginas sueltas (login, estado) definen las suyas en su propio <style>.
const propias = {};
PAGINAS.forEach(p => {
  const h = leer(p);
  propias[p] = new Set();
  (h.match(/(--[\w-]+)\s*:/g) || []).forEach(s => propias[p].add(s.replace(':', '').trim()));
});
ok(definidas.size > 40, `${definidas.size} variables definidas en las hojas de estilo`, definidas.size);

const inventadas = [];
HOJAS.concat(SCRIPTS).forEach(f => {
  const s = leer(f);
  const re = /var\(\s*(--[\w-]+)/g;
  let m; while ((m = re.exec(s))) if (!definidas.has(m[1])) inventadas.push(f + ' → ' + m[1]);
});
PAGINAS.forEach(p => {
  const s = leer(p);
  const re = /var\(\s*(--[\w-]+)/g;
  let m; while ((m = re.exec(s))) if (!definidas.has(m[1]) && !propias[p].has(m[1])) inventadas.push(p + ' → ' + m[1]);
});
ok(inventadas.length === 0, 'ninguna var(--x) sin definir', inventadas);

console.log('\n3) El dorado de Accesorios es el que cambia de noche');
// `--acc` está definida una sola vez, en el tema claro: nunca se vuelve a
// escribir en el bloque oscuro. `--accent` sí. El precio de la lista usaba
// la primera y salía con el dorado de día sobre el fondo negro.
const cuenta = re => (css.match(re) || []).length;
ok(cuenta(/--accent\s*:/g) > 1, '--accent está escrita más de una vez: tiene su valor de noche',
   cuenta(/--accent\s*:/g));
ok(cuenta(/--acc\s*:/g) === 1,
   'y --acc una sola: se queda con el dorado de día, sirve para los tickets impresos',
   cuenta(/--acc\s*:/g));
ok(/\.inv-item-precio[^}]*var\(--accent\)/.test(css), 'el precio de la lista usa --accent', (css.match(/\.inv-item-precio[^}]*}/g) || []));
ok(!/\.inv-scan-wrap[^}]*var\(--acc\)/.test(css), 'y el recuadro del lector tampoco usa --acc');

console.log('\n4) El código del artículo se lee');
// El recuadrito del código iba sobre var(--bg), que es el fondo de la página
// (#F8F8F8) mientras la tarjeta es blanca: no se veía el recuadro. --bg1 es
// la superficie, que sí contrasta contra la tarjeta.
const codes = css.match(/\.inv-item-sub code[^}]*}/g) || [];
ok(codes.length > 0, 'hay regla para el código del artículo', codes);
ok(codes.every(r => !/background:\s*var\(--bg\)/.test(r)),
   'ninguna lo pinta del color del fondo de la página', codes);

console.log('\n5) La barra de "seleccionar varios" entra en un teléfono');
// Con el padding normal de los botones, "3 marcados" se parte en dos
// renglones y la barra crece.
const invjs = leer('inventario.js');
const barra = invjs.slice(invjs.indexOf('function _invSelBarra'), invjs.indexOf('function _invSelLista'));
ok(/white-space:nowrap/.test(barra), 'la cuenta no se parte en dos renglones', barra.slice(0, 200));
ok(/flex-shrink:0/.test(barra), 'y los botones no se deforman');
ok(!/var\(--bd/.test(barra), 'el borde de arriba usa una variable que existe');

console.log('\n────────────────────────────');
console.log(fails ? `❌ ${fails} fallas` : '✅ todo bien');
process.exit(fails ? 1 : 0);
