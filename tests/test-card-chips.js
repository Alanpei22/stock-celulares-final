// Harness sin navegador para los botones de la card de reparaciones.
//
// Antes eran hasta 4 chips del mismo peso, en una fila envuelta: la acción que
// hacés veinte veces por día (avanzar el estado) pesaba lo mismo que
// "Garantía", que tocás una vez cada tanto. Y "Garantía" aparecía hasta en
// equipos que seguían en el taller, donde no tiene sentido.
//
// Ahora hay dos niveles: principales (lo del día) y secundarias (fantasma).
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
const leer = f => fs.readFileSync(DIR + f, 'utf8');

let fails = 0;
const ok = (c, l, x) => {
  console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x)));
  if (!c) fails++;
};

const ctx = {
  console, setTimeout: f => f(), clearTimeout,
  esc: s => String(s == null ? '' : s), fmt: n => '$' + n, toast: () => {},
  searchMatch: () => false, REPAIRS: [], REPUESTOS: [],
  db: { collection: () => ({ doc: () => ({ update: async () => {}, set: async () => {} }) }) },
  document: {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {},
    body: { style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} } },
    documentElement: { classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} }, style: { setProperty(){} } },
  },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener(){} }), location: { href: '' } },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  navigator: { userAgent: 'node' },
  firebase: { firestore: { FieldValue: { serverTimestamp: () => ({}) } } },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('repairs.js'), ctx, { filename: 'repairs.js' });
const get = e => vm.runInContext(e, ctx);

// Devuelve { pri: [...], sec: [...] } con el texto de cada chip
function chips(rep) {
  ctx.__R = rep;
  const h = get('_cardAccionesHtml(__R)');
  const corte = h.indexOf('card-acc-sec');
  const trozo = (a, b) => h.slice(a, b);
  // Ojo: entre la clase y el ">" está el onclick, así que hay que saltearlo.
  const sacar = t => [...t.matchAll(/<button class="card-chip[^>]*>([^<]*)<\/button>/g)]
    .map(m => m[1].trim());
  return {
    html: h,
    pri: sacar(trozo(0, corte < 0 ? h.length : corte)),
    sec: corte < 0 ? [] : sacar(trozo(corte, h.length)),
  };
}

const base = { id: 'r1', nOrden: 7001, tlf: '1155667788', monto: 50000 };

console.log('\n1) Reparando: lo que hacés es marcarla lista');
const rep = chips({ ...base, estado: 'reparando' });
ok(rep.pri.some(t => /Listo/.test(t)), 'principal: Listo', rep.pri);
ok(rep.pri.some(t => /Avisar/.test(t)), 'principal: Avisar por WhatsApp', rep.pri);
// Todavía no se cobra: el equipo no está listo.
ok(!rep.pri.some(t => /Cobrar/.test(t)), 'sin Cobrar todavía', rep.pri);
ok(rep.sec.some(t => /No va/.test(t)), 'secundaria: No va', rep.sec);
ok(rep.sec.some(t => /Boleta/.test(t)), 'secundaria: reimprimir boleta', rep.sec);
ok(rep.sec.some(t => /Llamar/.test(t)), 'secundaria: llamar', rep.sec);
ok(rep.pri.length <= 3, 'como mucho 3 principales, si no vuelve el amontonamiento', rep.pri);

console.log('\n2) Lista: aparece Cobrar');
const listo = chips({ ...base, estado: 'listo' });
ok(listo.pri.some(t => /Entregado/.test(t)), 'principal: Entregado', listo.pri);
ok(listo.pri.some(t => /Cobrar/.test(t)), 'principal: Cobrar', listo.pri);
ok(listo.sec.some(t => /Reparando/.test(t)), 'volver a Reparando queda de secundaria', listo.sec);

console.log('\n3) Cobrada: no se ofrece cobrar de nuevo');
const cobrada = chips({ ...base, estado: 'listo', cobrado: true });
ok(!cobrada.pri.some(t => /Cobrar/.test(t)), 'ya cobrada, no aparece', cobrada.pri);
const sinMonto = chips({ ...base, estado: 'listo', monto: 0 });
ok(!sinMonto.pri.some(t => /Cobrar/.test(t)), 'sin monto tampoco', sinMonto.pri);

console.log('\n4) Garantía: solo en equipos ya entregados');
// Antes salía en casi todas las cards, incluso en las que seguían en el
// taller, donde reingresar por garantía no tiene ningún sentido.
const entregado = chips({ ...base, estado: 'entregado' });
ok(entregado.sec.some(t => /Garantía/.test(t)), 'entregado: sí ofrece garantía', entregado.sec);
ok(!rep.sec.some(t => /Garantía/.test(t)), 'reparando: NO la ofrece', rep.sec);
ok(!listo.sec.some(t => /Garantía/.test(t)), 'listo: tampoco', listo.sec);
const yaGarantia = chips({ ...base, estado: 'entregado', esGarantia: true });
ok(!yaGarantia.sec.some(t => /Garantía/.test(t)),
   'y si YA es un reingreso por garantía, no se encadena otro', yaGarantia.sec);

console.log('\n5) Sin teléfono no hay chips que no llevan a ningún lado');
const sinTel = chips({ ...base, estado: 'reparando', tlf: '' });
ok(!sinTel.pri.some(t => /Avisar/.test(t)), 'sin teléfono no ofrece avisar', sinTel.pri);
ok(!sinTel.sec.some(t => /Llamar/.test(t)), 'ni llamar', sinTel.sec);
ok(sinTel.sec.some(t => /Boleta/.test(t)), 'pero la boleta sigue', sinTel.sec);

console.log('\n6) La nota dice si ya hay una escrita');
const conNota = chips({ ...base, estado: 'reparando', notaRapida: 'Cliente pidió apuro' });
ok(conNota.sec.some(t => /Ver nota/.test(t)), 'con nota: "Ver nota"', conNota.sec);
ok(rep.sec.some(t => /^📝 Nota$|Nota/.test(t)), 'sin nota: "Nota"', rep.sec);

console.log('\n7) Los estados no se repiten entre niveles');
[rep, listo, entregado].forEach((c, i) => {
  const cruce = c.pri.filter(t => c.sec.includes(t));
  ok(cruce.length === 0, `caso ${i + 1}: ningún chip aparece dos veces`, cruce);
});

console.log('\n8) Nada quedó suelto');
const js = leer('repairs.js');
ok(!/card-wa-btn/.test(js), 'se fue el ícono de WhatsApp duplicado de la card');
ok(/function reimprimirBoleta/.test(js), 'existe la reimpresión desde la lista');
ok(/window\._printRep = r;[\s\S]{0,80}printRepair/.test(js),
   'y deja la reparación donde print.js la busca antes de imprimir');
// El quickBtn que se armaba y no se usaba nunca.
ok(!/const quickBtn/.test(js), 'se fue la variable de chips que no se usaba');
// Un ">" dentro del onclick es HTML válido pero sucio, y rompe cualquier
// lectura del marcado. La búsqueda va en una función, no en el atributo.
ok(/function abrirCobro/.test(js), 'el cobro se abre por función, no por expresión inline');
ok(!/REPAIRS\.find\(x=>x\.id===.\$\{r\.id\}/.test(js),
   'ningún onclick trae una arrow function adentro');

const css = leer('style.css');
ok(/\.card-chip--pri[^}]*min-height: 36px/.test(css),
   'las principales tienen alto de dedo (36 px)');
ok(/\.card-chip--sec[^}]*background: transparent/.test(css),
   'las secundarias son fantasma');
ok(!/^\.card-wa-btn/m.test(css), 'y no quedó CSS del botón que se borró');
// En oscuro, las secundarias tampoco pueden pintarse de colores.
ok(!/^body\.dark \.chip-(listo|entregado|reparando|cancelado|garantia|cobrar)\b/m.test(css),
   'en modo oscuro el color va solo en las principales');

console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
process.exit(fails ? 1 : 0);
