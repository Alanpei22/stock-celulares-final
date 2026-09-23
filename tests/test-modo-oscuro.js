// Modo oscuro: una sola paleta y textos que se lean.
//
// Había DOS paletas oscuras conviviendo en style.css: un azul marino
// (#0f172a / #1e293b) y un gris casi negro (#1E1E20 / #28282A) que había
// quedado pegado en varios componentes. La caja terminaba con pedazos de un
// color y pedazos de otro.
//
// Y los textos chicos (hora, categoría, fechas) usaban un gris que contra el
// fondo azul no se leía. Acá se mide el contraste de verdad, con la fórmula
// de accesibilidad (WCAG), en vez de confiar en el ojo.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const css = fs.readFileSync(DIR + 'style.css', 'utf8');

// ── Contraste (WCAG) ────────────────────────────────────────
function rgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16));
}
function luminancia(hex) {
  const [r, g, b] = rgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Variables del tema oscuro. Tiene que haber UN solo bloque que las defina:
// cuando había tres, ganaba el último del archivo y la pantalla mezclaba.
const bloquesVars = (css.match(/body\.dark \{[^}]*--card:/g) || []).length;
const bloque = css.slice(css.indexOf('body.dark {'), css.indexOf('}', css.indexOf('body.dark {')));
const V = {};
bloque.replace(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g, (_, k, v) => { V[k] = v; return ''; });

console.log('\n1) Las variables del tema oscuro están, y en un solo lugar');
ok(bloquesVars === 1, 'un único bloque body.dark con la paleta (había tres)', bloquesVars);
['bg', 'bg1', 'bg2', 'bg3', 'card', 'border', 'text', 'text2', 'text3', 't1', 't2', 't3', 'input'].forEach(k =>
  ok(!!V[k], `--${k} = ${V[k] || 'FALTA'}`));

console.log('\n2) Los textos se leen (contraste medido, no a ojo)');
// 4.5:1 es el mínimo para texto chico; 7:1 lo cómodo para el principal.
const cT1 = contraste(V.t1, V.bg);
const cT2 = contraste(V.t2, V.card);
const cT3 = contraste(V.t3, V.card);
ok(cT1 >= 7, `texto principal sobre el fondo: ${cT1.toFixed(1)}:1 (mínimo cómodo 7)`, cT1.toFixed(2));
ok(cT2 >= 4.5, `texto secundario sobre las tarjetas: ${cT2.toFixed(1)}:1`, cT2.toFixed(2));
// Este era el que fallaba: las horas y fechas con #475569 sobre azul daban 2,6:1
ok(cT3 >= 4, `fechas y horas sobre las tarjetas: ${cT3.toFixed(1)}:1 (antes 2,6:1, ilegible)`, cT3.toFixed(2));

console.log('\n3) La tarjeta se distingue del fondo, pero no encandila');
const cCard = contraste(V.card, V.bg);
ok(cCard > 1.05 && cCard < 2, `tarjeta vs fondo: ${cCard.toFixed(2)}:1`, cCard.toFixed(2));
ok(luminancia(V.bg) < 0.03, 'el fondo es oscuro de verdad (no gris medio)', luminancia(V.bg).toFixed(3));

console.log('\n4) Una sola paleta: no quedan restos de las dos viejas');
const VIEJOS = ['0f172a', '1e293b', '334155', '2d3f55', '475569', '64748b',
                '1e1e20', '28282a', '2e2e31', 'f2f2f7', '3a3a3c', '1c1c1e'];
const sucias = [];
css.replace(/([^{}]+)\{([^{}]*)\}/g, (todo, sel, cuerpo) => {
  if (!sel.includes('.dark')) return todo;
  VIEJOS.forEach(v => { if (cuerpo.toLowerCase().includes(v)) sucias.push(sel.trim().slice(0, 40) + ' → #' + v); });
  return todo;
});
ok(sucias.length === 0, 'ninguna regla de modo oscuro usa los colores viejos', sucias.slice(0, 5));

console.log('\n5) Los chips no encandilan');
// Venían blancos: en una pantalla oscura es un cartel de luz en la mano.
const chips = css.slice(css.indexOf('body.dark .cat-btn,'));
ok(/background:\s*transparent/.test(chips), 'chips en fantasma, no blancos');
ok(/\.cat-btn\.cat-active[\s\S]{0,120}var\(--accent\)/.test(css),
   'y el elegido se pinta con el dorado del local');
ok(/body\.dark \.fi[\s\S]{0,400}background:\s*#0d0f12/.test(css),
   'los campos de texto son oscuros (se veían claros contra el fondo)');

console.log('\n6) El acento del local no cambió');
// La identidad es el dorado: el modo oscuro cambia el fondo, no la marca.
const raiz = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
ok(/--accent:\s*#C8965A/i.test(raiz), 'sigue siendo #C8965A', raiz.match(/--accent:[^;]*/));

console.log('\n7) Lo que elegís se tiene que ver elegido');
// El bug: en oscuro los chips van en fantasma (`body.dark .metodo-btn` con
// fondo transparente), y esa regla le GANA por especificidad a la que pinta el
// elegido (`.metodo-btn.metodo-active`). Resultado: tocabas el método de pago
// y no se marcaba ninguno. El de categorías sí andaba porque tenía su propia
// regla oscura; los de método, no.
const cajaCss = fs.readFileSync(DIR + 'caja.css', 'utf8');
const CHIPS = [
  ['cat-btn',    'cat-active',     'la categoría'],
  ['metodo-btn', 'metodo-active',  'el método de pago'],
  ['metodo-btn2', 'metodo2-active', 'el segundo método (pago dividido)'],
];
CHIPS.forEach(([chip, act, que]) => {
  const fantasma = new RegExp('body\\.dark[^{]*\\.' + chip + '\\b[^{]*\\{[^}]*background:\\s*transparent');
  if (!fantasma.test(css)) { ok(true, que + ': no va en fantasma, se pinta sola'); return; }
  const marcado = new RegExp('body\\.dark[^{]*\\.' + chip + '\\.' + act + '\\b[^{]*\\{[^}]*background:\\s*[^;t]');
  ok(marcado.test(css), que + ': el elegido se pinta distinto de los demás');
});

console.log('\n8) Pintar con el color del texto y escribir en blanco');
// `--text` en modo oscuro ES casi blanco: blanco sobre blanco no se lee. Lo
// que corresponde es `var(--card)`, que en modo día es blanco igual (no cambia
// nada) y de noche es oscuro.
const sospechosas = [];
[['style.css', css], ['caja.css', cajaCss]].forEach(([nombre, txt]) => {
  txt.replace(/([^{}]+)\{([^{}]*)\}/g, (todo, sel, cuerpo) => {
    if (/background:\s*var\(--text[23]?[,)]/.test(cuerpo) && /color:\s*(#fff(?:fff)?|white)\b/i.test(cuerpo))
      sospechosas.push(nombre + ' → ' + sel.trim().slice(0, 44));
    return todo;
  });
});
ok(sospechosas.length === 0,
   'ninguna regla pinta con --text y escribe en blanco', sospechosas.slice(0, 6));

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
