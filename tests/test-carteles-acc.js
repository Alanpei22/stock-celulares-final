// Carteles de accesorios: los de la vitrina, apaisados y en tres medidas.
//
// Lo que se mide acá, además del precio, es el ACOMODADO. Una hoja A4 cuesta
// lo mismo con un cartel que con dieciocho, así que lo caro es dejar huecos:
// si un mediano deja media fila libre, ahí tienen que entrar dos chicos en vez
// de empezar otra hoja.
//
// Y el precio va EXACTO. En un equipo de un millón redondear a la centena no
// se nota; acá un vidrio de $2.950 pasaría a decir $3.000 y la caja cobraría
// otra cosa.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// ── El entorno de mentira ─────────────────────────────────
const els = {};
const el = id => els[id] = {
  id, value: '', textContent: '', innerHTML: '', srcdoc: '', disabled: false,
  style: {}, clientWidth: 480,
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
               contains(c) { return this._s.has(c); } },
  removeAttribute(a) { this[a] = ''; }, setAttribute() {}, addEventListener() {},
};
['cartacc-modal', 'cartacc-overlay', 'acc-f-buscar', 'acc-f-cat', 'cartacc-lista',
 'cartacc-cuenta', 'cartacc-nota', 'cartacc-imprimir', 'cartacc-preview',
 'cartacc-preview-wrap'].forEach(el);

const ESCRITO = [], IMPRESO = [];
const ctx = {
  console, Math, JSON, Date, Set, Map, Number, String, Object, Array,
  parseInt, parseFloat, isNaN, isFinite, setTimeout: f => f(), clearTimeout,
  document: {
    getElementById: id => els[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el('tmp'), addEventListener() {},
    body: { style: {}, appendChild() {}, classList: { add() {}, remove() {} } },
  },
  window: { open: () => null, addEventListener() {} },
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; },
                  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  navigator: { userAgent: 'node' },
  toast: () => {}, alert: () => {},
  searchMatch: (hay, q) => String(hay).toLowerCase().includes(String(q).toLowerCase()),
  PRICES: { c3: 26 },
  _openPrint: html => IMPRESO.push(html),
  db: { collection: c => ({ doc: d => ({ set: async (data, o) => { ESCRITO.push({ col: c, doc: d, data, o }); } }) }) },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
// carteles.js primero: de ahí salen el color, la plata y el escapado, que son
// los mismos para los dos tipos de cartel.
vm.runInContext(leer('carteles.js'), ctx, { filename: 'carteles.js' });
vm.runInContext(leer('carteles-acc.js'), ctx, { filename: 'carteles-acc.js' });
const run = e => vm.runInContext(e, ctx);
const call = (f, ...args) => { ctx.__a = args; return run(`${f}(...__a)`); };

const P = {
  funda:  { id: 'f1', nombre: 'Funda silicona iPhone 13', categoria: 'Fundas', precioVenta: 15500, activo: true },
  vidrio: { id: 'v1', nombre: 'Vidrio templado 9D', categoria: 'Vidrios', precioVenta: 2950, activo: true },
  cable:  { id: 'c1', nombre: 'Cable USB-C 1m', categoria: 'Cables', precioVenta: 4500, activo: true },
  sinPr:  { id: 's1', nombre: 'Algo sin precio', categoria: 'Varios', precioVenta: 0, activo: true },
  baja:   { id: 'b1', nombre: 'Discontinuado', categoria: 'Varios', precioVenta: 8000, activo: false },
};

console.log('\n1) Las tres medidas');
ok(call('cartAccMedida', 'chico').w === 1 && call('cartAccMedida', 'chico').h === 1, 'el chico ocupa un casillero');
ok(call('cartAccMedida', 'mediano').w === 2 && call('cartAccMedida', 'mediano').h === 1, 'el mediano, dos de ancho');
ok(call('cartAccMedida', 'grande').w === 3 && call('cartAccMedida', 'grande').h === 2, 'el grande, la fila entera por dos de alto');
ok(call('cartAccMedida', 'cualquiera').w === 1, 'una medida que no existe cae en chico');
// Son horizontales: por eso ninguna es más alta que ancha.
ok(run('CART_ACC_ORDEN.every(k => CART_ACC_MEDIDAS[k].w >= CART_ACC_MEDIDAS[k].h)'),
   'todas son apaisadas o cuadradas, ninguna parada');

console.log('\n2) El acomodado: no dejar huecos');
const n = (id, medida) => ({ id, nombre: 'X' + id, precioVenta: 1000, medida });
// 18 chicos = una hoja justa (3 columnas × 6 filas).
let h = call('cartAccHojas', Array.from({ length: 18 }, (_, i) => n('c' + i, 'chico')));
ok(h.length === 1 && h[0].length === 18, '18 chicos entran en una hoja', h.map(x => x.length));
h = call('cartAccHojas', Array.from({ length: 19 }, (_, i) => n('c' + i, 'chico')));
ok(h.length === 2 && h[1].length === 1, 'el 19 arranca la hoja siguiente', h.map(x => x.length));

// Lo que importa: un mediano deja un casillero libre al lado y ahí entra un chico.
h = call('cartAccHojas', [n('m', 'mediano'), n('a', 'chico')]);
ok(h.length === 1 && h[0].length === 2, 'un mediano y un chico comparten la fila');
const chico = h[0].find(x => x.id === 'a');
ok(chico.fila === 1 && chico.col === 3, 'el chico se mete en el hueco que dejó el mediano', chico);

// Y si el que sigue en la lista no entra, se saltea y se prueba el otro: así
// no queda media hoja vacía esperando.
h = call('cartAccHojas', [n('g1', 'grande'), n('g2', 'grande'), n('x', 'chico')]);
ok(h.length === 1 && h[0].length === 3, 'dos grandes dejan dos filas libres y el chico entra ahí',
   h.map(x => x.length));
ok(h[0].find(x => x.id === 'x').fila === 5, 'abajo de los dos grandes', h[0].find(x => x.id === 'x'));

// Y cuando el que sigue NO entra, se saltea y se prueba el otro, en vez de
// dejar media hoja vacía esperando.
h = call('cartAccHojas', [n('c0', 'chico'), n('g1', 'grande'), n('g2', 'grande'), n('g3', 'grande'), n('y', 'chico')]);
ok(h[0].some(x => x.id === 'y'), 'el chico de atrás se adelanta al grande que no entraba',
   h.map(x => x.map(i => i.id)));

// 3 grandes = 6 filas justas.
h = call('cartAccHojas', [n('g1', 'grande'), n('g2', 'grande'), n('g3', 'grande')]);
ok(h.length === 1 && h[0].length === 3, 'tres grandes llenan una hoja entera');
ok(h[0].map(x => x.fila).join(',') === '1,3,5', 'uno abajo del otro', h[0].map(x => x.fila));
ok(call('cartAccHojas', []).length === 0, 'sin nada, no hay hoja');

// Ningún cartel puede pisar a otro.
const mezcla = [n('g', 'grande'), n('m1', 'mediano'), n('m2', 'mediano'),
                n('c1', 'chico'), n('c2', 'chico'), n('c3', 'chico'), n('c4', 'chico')];
call('cartAccHojas', mezcla).forEach((hoja, nh) => {
  const usado = {};
  let pisa = null;
  hoja.forEach(it => {
    for (let r = it.fila; r < it.fila + it.h; r++)
      for (let c = it.col; c < it.col + it.w; c++) {
        const k = r + ',' + c;
        if (usado[k]) pisa = { it: it.id, sobre: usado[k], k };
        usado[k] = it.id;
      }
  });
  ok(!pisa, `hoja ${nh + 1}: ningún cartel pisa a otro`, pisa);
  ok(Object.keys(usado).length <= 18, `hoja ${nh + 1}: no se pasa de los 18 casilleros`, Object.keys(usado).length);
});

console.log('\n3) Lo que dice el cartel');
let c = call('cartelAccHtml', { ...P.funda, medida: 'chico' });
ok(/Funda silicona iPhone 13/.test(c), 'el nombre');
ok(/\$15\.500/.test(c), 'y el precio');
ok(/TECHPOINT/.test(c), 'con el nombre del local');
ok(!/Fundas/.test(c), 'la categoría no va: en la vitrina no le dice nada al cliente');

// El precio exacto, sin redondear para arriba.
c = call('cartelAccHtml', { ...P.vidrio, medida: 'chico' });
ok(/\$2\.950/.test(c) && !/\$3\.000/.test(c),
   'el precio sale clavado: si dijera $3.000 la caja cobraría otra cosa', c.match(/\$[\d.]+/g));
ok(call('cartAccPrecio', { precioVenta: 2950 }) === 2950, 'nada de redondeos acá');

console.log('\n4) Las letras entran');
// Medido en el navegador con Baloo 2 cargada: .55 por letra en el nombre,
// .58 en el precio (son cifras, más anchas). El nombre puede usar dos
// renglones, pero no enteros: el texto corta por palabra y el final de cada
// renglón queda a medio llenar.
const EM_N = 0.55, EM_P = 0.58;
const anchoDe = w => w * 248 - 30;
[['Funda silicona iPhone 13', 'mediano', 2, 1], ['Auriculares', 'chico', 1, 1],
 ['Soporte de auto magnético', 'chico', 1, 1], ['Vidrio templado 9D', 'grande', 3, 2],
 ['Funda antigolpe transparente Samsung A54', 'mediano', 2, 1]].forEach(([nom, med, w, hh]) => {
  const tam = call('cartAccTamNombre', nom, w, hh);
  ok(nom.length * EM_N * tam <= anchoDe(w) * 1.7, `"${nom}" entra en el ${med}`, tam);
});
['$2.950', '$15.500', '$1.250.000'].forEach(p => {
  [[1, 1], [2, 1], [3, 2]].forEach(([w, hh]) => {
    const tam = call('cartAccTamPrecio', p, w, hh);
    ok(p.length * EM_P * tam <= anchoDe(w), `${p} entra en un renglón (${w}×${hh})`, tam);
  });
});
// El precio es lo que se mira primero: siempre más grande que el nombre.
ok(call('cartAccTamPrecio', '$15.500', 1, 1) > call('cartAccTamNombre', 'Funda silicona iPhone 13', 1, 1),
   'y el precio siempre le gana al nombre en tamaño');

console.log('\n5) La hoja');
const doc = call('cartAccDocumento', [{ ...P.funda, medida: 'grande' }, { ...P.cable, medida: 'chico' }]);
ok(/@page\{size:A4 portrait;margin:0\}/.test(doc), 'A4 vertical sin márgenes');
ok(/repeat\(3,1fr\)/.test(doc) && /repeat\(6,1fr\)/.test(doc), 'la grilla de 3 × 6');
ok(/grid-column:1\/span 3;grid-row:1\/span 2/.test(doc), 'el grande ocupa sus casilleros', doc.match(/grid-column:[^"]*/g));
ok(/grid-column:1\/span 1;grid-row:3\/span 1/.test(doc), 'y el chico, el suyo', doc.match(/grid-column:[^"]*/g));
ok(/1px dashed #9A9AA8/.test(doc), 'las líneas de corte');
ok(/print-color-adjust:exact/.test(doc) && /-webkit-print-color-adjust:exact/.test(doc), 'los colores salen impresos');
ok(/Baloo\+2/.test(doc), 'la misma tipografía que los carteles de equipos');
ok(/-webkit-line-clamp:2/.test(doc), 'el nombre nunca pasa de dos renglones');
ok(/line-height:1\.1/.test(doc), 'con el interlineado apretado: con el de fábrica no cierra');

// El color es el MISMO que el de los carteles de equipos: se elige una vez.
run("CART_CFG = { ...CART_CFG, color: '#008C3A' }");
const verde = call('cartAccDocumento', [{ ...P.funda, medida: 'chico' }]);
ok(/#008C3A/.test(verde) && !/#0040FF/.test(verde), 'usa el color elegido para los carteles, no uno propio');
run("CART_CFG = { ...CART_CFG, color: '#0040FF' }");

console.log('\n6) Elegir y medir en el cuadro');
ctx.__prods = [P.funda, P.vidrio, P.cable, P.sinPr, P.baja];
run('PRODUCTOS = __prods');
call('cartAccAbrir');
ok(run('_accBase.length') === 3, 'los dados de baja y el que no tiene precio quedan afuera', run('_accBase.map(p => p.id)'));
ok(run('_accFuera.length') === 1, 'y avisa por el del precio');
ok(run('_accSel.length') === 0, 'abriendo la lista entera no arranca ninguno tildado');

call('accTocar', 'v1');
call('accTocar', 'f1');
ok(run('JSON.stringify(_accSel)') === '["v1","f1"]', 'salen en el orden en que se tildan');
ok(/2 elegidos · 1 hoja/.test(els['cartacc-cuenta'].textContent), 'dice cuántos y cuántas hojas', els['cartacc-cuenta'].textContent);

// La medida es por cartel.
call('accMedida', 'f1', 'grande');
ok(run("_accMedidas['f1']") === 'grande', 'cada uno lleva su medida');
ok(/grid-column:1\/span 3/.test(els['cartacc-preview'].srcdoc), 'y la vista previa lo muestra grande');
// Tocar una medida de algo que no estaba tildado lo tilda: que no pase nada
// es para volverse loco.
call('accMedida', 'c1', 'mediano');
ok(run('_accSel.includes("c1")') === true, 'elegir la medida tilda el artículo');
call('accMedidaTodos', 'chico');
ok(run('Object.values(_accMedidas).every(m => m === "chico")'), 'y se pueden pasar todos a una medida de una', run('JSON.stringify(_accMedidas)'));

// Filtros
run("document.getElementById('acc-f-cat').value = 'Vidrios'");
call('accFiltrar');
ok(/Vidrio templado/.test(els['cartacc-lista'].innerHTML) && !/Funda/.test(els['cartacc-lista'].innerHTML), 'el filtro de categoría');
run("document.getElementById('acc-f-cat').value = ''");
run("document.getElementById('acc-f-buscar').value = 'cable'");
call('accFiltrar');
ok(/Cable USB/.test(els['cartacc-lista'].innerHTML) && !/Funda/.test(els['cartacc-lista'].innerHTML), 'y el buscador');
run("document.getElementById('acc-f-buscar').value = ''");

console.log('\n7) Imprimir');
IMPRESO.length = 0;
call('cartAccAbrir');
call('cartAccImprimir');
ok(IMPRESO.length === 0, 'sin nada tildado no imprime');
call('accTocar', 'f1');
call('cartAccImprimir');
ok(IMPRESO.length === 1 && /class="cartelA"/.test(IMPRESO[0]), 'con uno tildado, sale');
ok(els['cartacc-preview'].srcdoc === IMPRESO[0], 'y la vista previa es exactamente lo que se imprime');
ok(ESCRITO.length === 0, 'no se escribió nada en la base: los datos salen del inventario', ESCRITO);

console.log('\n8) Enganchado en la caja');
const cajaHtml = leer('caja.html');
ok(/carteles-acc\.js/.test(cajaHtml) && /carteles\.js/.test(cajaHtml),
   'caja.html carga los dos archivos (el de accesorios usa el color del otro)');
ok(/id="cartacc-modal"/.test(cajaHtml), 'y el cuadro está en la página');
const inv = leer('inventario.js');
ok(/cartAccAbrir\(\)/.test(inv), 'se entra desde el menú de Accesorios');
ok(/cartAccAbrir\(_invSelLista\(\)\)/.test(inv), 'y desde "seleccionar varios", con los marcados');
// CUPO: sale de PRODUCTOS, que la caja ya tiene cargado.
ok(!/onSnapshot|collection\('productos'\)/.test(leer('carteles-acc.js')),
   'no lee Firestore: usa el inventario que ya está en memoria');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
