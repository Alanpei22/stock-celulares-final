// ✅ Control de stock de equipos (control-equipos.js). Alan (25/11):
// "necesito hacer un checklist para control del stock de equipos, con filtros".
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = {};
const el = id => (els[id] = els[id] || { id, value: '', innerHTML: '', textContent: '', focus() {}, remove() { delete els[id]; } });
const ESCRITO = [], TOASTS = [];
let SNAP = null;
const ctx = {
  console, Math, Number, String, Array, Object, JSON, Date, Set, Promise, setTimeout: () => 0,
  esc: s => String(s == null ? '' : s),
  toast: (m, t) => TOASTS.push([m, t]),
  marcaCanon: m => /iphone|apple/i.test(m || '') ? 'iPhone' : String(m || '').replace(/^./, c => c.toUpperCase()),
  tpFirma: () => ({ cargadoPor: 'Nacho' }),
  document: {
    getElementById: id => (id.startsWith('ce-') || id === 's-control' ? el(id) : null),
    createElement: () => ({ addEventListener() {}, remove() {}, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; } }),
    body: { appendChild: n => { els['ce-modal'] = n; } }, head: { appendChild() {} },
  },
  firebase: { firestore: { FieldValue: { delete: () => '__BORRAR__' } } },
  db: { collection: c => ({ doc: id => ({
    set: (d, o) => { ESCRITO.push([c, id, JSON.parse(JSON.stringify(d)), o]); return Promise.resolve(); },
    onSnapshot: cb => { SNAP = cb; return () => {}; },
    get: () => Promise.resolve({ exists: false }),
  }) }), batch: () => ({ set: (r, d) => ESCRITO.push(['batch-set', d]), delete: () => ESCRITO.push(['batch-del']), commit: () => Promise.resolve() }) },
};
ctx.STOCK = [
  { id: 'a', marca: 'Iphone', modelo: '13', almacenamiento: '128GB', estado: 'Usado', imei: '356000000012345', ubicacion: 'Exhibición' },
  { id: 'b', marca: 'samsung', modelo: 'A54', estado: 'Nuevo', imei: '356111111167890', ubicacion: 'Depósito', codigoCorto: 'TP00042' },
  { id: 'c', marca: 'Motorola', modelo: 'G32', estado: 'Usado', imei: '356222222200001' },
  { id: 'd', marca: 'iPhone', modelo: '11', estado: 'Usado', imei: '356333333300002', vendido: true },
  { id: 'e', marca: 'Apple', modelo: 'iPhone 12', estado: 'Usado', reservado: true, ubicacion: 'Exhibición' },
];
ctx.stockPorCodigo = (cod, lista) => {
  const t = String(cod).trim().toUpperCase();
  const todos = lista.filter(p => [p.codigo, p.codigoCorto, p.imei, p.imei2].some(c => c != null && String(c).toUpperCase() === t));
  return todos.find(p => !p.vendido) || todos[0] || null;
};
vm.createContext(ctx);
vm.runInContext(leer('control-equipos.js'), ctx, { filename: 'control-equipos.js' });
const run = c => vm.runInContext(c, ctx);

console.log('\n1) Qué se controla y los filtros');
const L = ctx.ceLista(ctx.STOCK);
ok(L.map(p => p.id).join() === 'e,a,c,b' && !L.some(p => p.vendido), 'los que figuran en stock (también los reservados), no los vendidos', L.map(p => p.id));
const ids = f => ctx.ceFiltrar(L, Object.assign({ q: '', marca: '', estado: '', ubic: '', ver: '' }, f), null).map(p => p.id).join();
ok(ids({ marca: 'iPhone' }) === 'e,a', 'por marca ("Iphone" y "Apple" son la misma)', ids({ marca: 'iPhone' }));
ok(ids({ estado: 'Nuevo' }) === 'b', 'por estado');
ok(ids({ ubic: 'Exhibición' }) === 'e,a' && ids({ ubic: '-' }) === 'c', 'por dónde está (y los que no tienen ubicación)');
ok(ids({ q: 'a54' }) === 'b' && ids({ q: '12345' }) === 'a', 'buscando por nombre o por IMEI');

console.log('\n2) Marcar ✓ / ✗');
ctx.ceAbrir();
SNAP({ exists: false });
ctx.ceMarcar('a', 'ok');
ctx.ceMarcar('c', 'falta');
let ctl = run('_ceCtl');
ok(ctx.ceEstadoDe('a', ctl) === 'ok' && ctx.ceEstadoDe('c', ctl) === 'falta' && !ctx.ceEstadoDe('b', ctl), '✓ está y ✗ no lo encuentro');
const w = ESCRITO.find(e => e[1] === 'equipos-actual' && e[2].marcas && e[2].marcas.a);
ok(w && w[0] === 'controles_stock' && w[3].merge && w[2].marcas.a.r === 'ok' && w[2].marcas.a.por === 'Nacho', 'se guarda en la base (para seguir desde otro aparato), con quién lo marcó', w);
ctx.ceMarcar('a', 'ok');
ok(!ctx.ceEstadoDe('a', run('_ceCtl')) && ESCRITO[ESCRITO.length - 1][2].marcas.a === '__BORRAR__', 'tocar otra vez lo deja sin controlar');
ok(JSON.stringify(ctx.ceResumen(L, run('_ceCtl'))) === '{"total":4,"ok":0,"falta":1,"pend":3}', 'cuenta están / faltan / sin controlar');
ok(ids.call ? ctx.ceFiltrar(L, { ver: 'falta' }, run('_ceCtl')).map(p => p.id).join() === 'c' : false, 'filtro "Faltan"');
ok(/Sin controlar 3/.test(els['ce-cnt'].innerHTML) && /Faltan 1/.test(els['ce-cnt'].innerHTML), 'los contadores arriba (y se tocan para filtrar)', els['ce-cnt'].innerHTML);

console.log('\n3) Escanear o escribir el IMEI');
ctx.ceCodigo('TP00042');
ok(ctx.ceEstadoDe('b', run('_ceCtl')) === 'ok', 'la etiqueta (código corto) marca el equipo');
ctx.ceCodigo('356000000012345');
ok(ctx.ceEstadoDe('a', run('_ceCtl')) === 'ok', 'el IMEI de la caja también');
ok(ctx.ceBuscarCodigo('00001', ctx.STOCK).id === 'c', 'tipeado a mano alcanza con el final del IMEI');
ok(ctx.ceBuscarCodigo('0000', ctx.STOCK) === null, '(con menos de 5 números no adivina)');
ctx.ceCodigo('356333333300002');
let ex = run('_ceCtl').extras;
ok(ex.some(e => e.tipo === 'vendido' && e.id === 'd') && TOASTS.some(t => /figura VENDIDO/.test(t[0])), 'uno que figura vendido y está en el local: avisa y queda anotado');
ctx.ceCodigo('999999999999999');
ex = run('_ceCtl').extras;
ok(ex.some(e => e.tipo === 'desconocido' && e.cod === '999999999999999'), 'uno que no está en el stock: también');
ok(/Para revisar/.test(els['ce-extras'].innerHTML), 'y se ve arriba');

console.log('\n4) Terminar');
const txt = ctx.ceResumenTexto(L, run('_ceCtl'));
ok(/Están: 2 de 4/.test(txt) && /No se encontraron \(1\):\n• Motorola G32/.test(txt) && /Sin controlar \(1\)/.test(txt) && /figura vendido/.test(txt), 'el resumen dice cuántos están, cuáles faltan y qué revisar', txt);
ctx.confirm = () => true;
ESCRITO.length = 0;
(async () => {
  await ctx.ceTerminar();
  ok(ESCRITO.some(e => e[0] === 'batch-set' && e[1].resumen && e[1].resumen.ok === 2 && e[1].faltan[0].id === 'c'), 'queda en el historial', ESCRITO);
  // Alan (25/11): "no me deja hacerlo, habilitalo a todos los usuarios". Borrar
  // en la base pide el permiso "borrar" (los empleados no lo tienen): se vacía.
  ok(!ESCRITO.some(e => e[0] === 'batch-del') && ESCRITO.some(e => e[0] === 'batch-set' && e[1].marcas && !Object.keys(e[1].marcas).length && e[1].ultimoCierre),
     'el control actual arranca de cero SIN borrar nada (así puede terminarlo cualquier usuario)', ESCRITO);
  const reglas = leer('firestore.rules');
  ok(!/controles_stock/.test(reglas.slice(reglas.indexOf('function sensible'), reglas.indexOf('function sensible') + 900)), 'controles_stock no es una colección "sensible": la escriben todos los usuarios');
  ok(!/tpFrenar|tpPuede|_soloDueno/.test(leer('control-equipos.js')), 'y la pantalla no pide ningún permiso');

  console.log('\n5) Dónde está');
  const html = leer('index.html'), app = leer('app.js');
  ok(/onclick="ceAbrir\(\)"[^>]*>.*id="s-control"/.test(html), 'cuadrito "✅ Control" en la barra del stock');
  ok(/<script defer src="control-equipos\.js"><\/script>/.test(html), 'se carga en la app');
  // Alan (25/11): "no me aparece lo del control" → a un toque en el menú del Stock
  const menuStock = app.slice(app.indexOf("openSheet('Stock', ["), app.indexOf("sheetGrupo(toggleHdrMenu, 'Página de equipos'"));
  ok(/label: 'Control de stock', sub: 'Checklist de los equipos[\s\S]{0,120}ceAbrir\(\)/.test(menuStock), 'en Stock → ⋯, arriba de todo (no escondido en un grupo)');
  ok(/action === 'control-equipos'[\s\S]{0,300}ceAbrir\(\)/.test(app) && /index\.html\?action=control-equipos/.test(leer('caja.html')) && /index\.html\?action=control-equipos/.test(leer('inventario.js')),
     'y desde la caja (menú de Inventario) lleva al control de equipos');
  ok(/abrirEscaner\(cod => ceCodigo\(cod\), \{ continuo: true/.test(leer('control-equipos.js')), 'con la cámara escanea uno atrás del otro');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})();
