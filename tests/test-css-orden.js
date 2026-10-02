// El orden del CSS: que no crezca el desorden.
//
// `style.css` tiene el mismo selector escrito dos veces 261 veces. No es un
// detalle de prolijidad: cuando hay dos bloques para lo mismo, el navegador
// aplica el de más abajo propiedad por propiedad, y el de arriba queda vivo
// solo en lo que el otro no repite. De ahí salieron tres bugs seguidos:
//
//   · el modo oscuro mezclaba dos paletas (tres bloques `body.dark`);
//   · el método de pago elegido no se marcaba (la regla del chip fantasma
//     le ganaba a la del elegido);
//   · `.owner-pin-modal` tiene dos definiciones con bordes distintos.
//
// Arreglar los 261 de una es reescribir 6.000 líneas, y eso sí puede cambiar
// cómo se ve todo. Esta prueba no los arregla: congela el número para que no
// siga creciendo. Si agregás un bloque repetido, salta acá y lo ves en el
// momento, no tres semanas después cuando algo se ve raro.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── Lectura mínima de CSS: reglas planas y un nivel de @media ──
function reglas(css) {
  const out = [];
  let i = 0, buf = '', ctx = [];
  while (i < css.length) {
    if (css.startsWith('/*', i)) { i = css.indexOf('*/', i) + 2; continue; }
    const c = css[i];
    if (c === '}') { if (ctx.length) ctx.pop(); buf = ''; i++; continue; }
    if (c === '{') {
      const cab = buf.trim(); buf = '';
      if (cab.startsWith('@') && !cab.startsWith('@font-face')) { ctx.push(cab); i++; continue; }
      const j = css.indexOf('}', i);
      out.push({ ctx: ctx.join('>'), sel: cab, cuerpo: css.slice(i + 1, j) });
      i = j + 1; continue;
    }
    buf += c; i++;
  }
  return out;
}
const props = cuerpo => (cuerpo.match(/(^|;)\s*([-a-zA-Z]+)\s*:/g) || [])
  .map(s => s.replace(/[;:]/g, '').trim().toLowerCase());
const norm = sel => sel.split(',').map(s => s.trim()).sort().join(',');

const ARCHIVOS = ['style.css', 'caja.css', 'dashboard.css', 'placas.css'];

// El número de hoy, medido por ESTA prueba. Vale contra sí mismo: si sube,
// algo se duplicó; cuando se limpie, se baja el tope y queda trabado más abajo.
const TECHO = { 'style.css': 295, 'caja.css': 0, 'dashboard.css': 0, 'placas.css': 0 };

console.log('\n1) Selectores escritos dos veces');
ARCHIVOS.forEach(f => {
  const rs = reglas(fs.readFileSync(DIR + f, 'utf8'));
  const cuenta = {};
  rs.forEach(r => { const k = r.ctx + '|' + norm(r.sel); cuenta[k] = (cuenta[k] || 0) + 1; });
  const repes = Object.values(cuenta).filter(n => n > 1).length;
  ok(repes <= TECHO[f], `${f}: ${repes} selectores repetidos (tope ${TECHO[f]})`, repes);
});

console.log('\n2) Y cuántas propiedades quedaron tapadas por eso');
// Una propiedad que un bloque posterior con el MISMO selector vuelve a
// definir, no se aplica nunca. Son líneas que mienten.
let tapadas = 0;
ARCHIVOS.forEach(f => {
  const rs = reglas(fs.readFileSync(DIR + f, 'utf8'));
  const porSel = {};
  rs.forEach((r, n) => { const k = r.ctx + '|' + norm(r.sel); (porSel[k] = porSel[k] || []).push(n); });
  Object.values(porSel).filter(ns => ns.length > 1).forEach(ns => {
    const despues = new Set();
    for (let i = ns.length - 1; i >= 0; i--) {
      const p = props(rs[ns[i]].cuerpo);
      tapadas += p.filter(x => despues.has(x)).length;
      p.forEach(x => despues.add(x));
    }
  });
});
ok(tapadas <= 1124, `${tapadas} propiedades que el navegador ignora (tope 1124)`, tapadas);

console.log('\n3) Lo que ya se limpió, sigue limpio');
const style = fs.readFileSync(DIR + 'style.css', 'utf8');
['chpin-btn', 'fade-in-3', 'shimmer', 'td-num', 'tk-biz-img'].forEach(c =>
  ok(!new RegExp('\\.' + c + '\\b').test(style), `.${c} no volvió (no la usaba ningún elemento)`));
['float', 'shimmer'].forEach(k =>
  ok(!new RegExp('@keyframes ' + k + '\\b').test(style), `@keyframes ${k} tampoco: se quedó sin nadie`));
// fadeInUp sí se usa: queda.
ok(/@keyframes fadeInUp/.test(style), 'y fadeInUp se queda, porque sí se usa');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
