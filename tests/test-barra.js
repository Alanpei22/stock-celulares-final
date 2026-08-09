// Barra de pasos: en la app (tp-fases.js) y en la página del cliente (estado.html).
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── App ───────────────────────────────────────────────────
console.log('\n1) Barra del tablero (app)');
const ctx = { console, document: { getElementById: () => null }, window: {}, localStorage: { getItem: () => null, setItem() {} } };
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'tp-fases.js', 'utf8'), ctx, { filename: 'tp-fases.js' });
const barra = (fase, estado) => vm.runInContext(
  `tpStepsHtml({id:'x',estado:'${estado}',fase:'${fase}',faseHist:[{f:'${fase}',t:'2026-08-01T10:00:00.000Z'}]})`, ctx);
const cuenta = (html, cls) => (html.match(new RegExp(`tp-step ${cls}[" ]`, 'g')) || []).length;

const bEnt = barra('entregado', 'entregado');
ok(cuenta(bEnt, 'on') === 8, 'ENTREGADO: los 8 tramos en verde', { on: cuenta(bEnt, 'on'), now: cuenta(bEnt, 'now') });
ok(cuenta(bEnt, 'now') === 0, 'ENTREGADO: ningún tramo en ámbar de "en curso"', cuenta(bEnt, 'now'));

const bRep = barra('reparacion', 'reparando');
ok(cuenta(bRep, 'on') === 5 && cuenta(bRep, 'now') === 1, 'EN REPARACIÓN: 5 verdes + 1 en curso', { on: cuenta(bRep, 'on'), now: cuenta(bRep, 'now') });
const bIng = barra('ingresado', 'reparando');
ok(cuenta(bIng, 'on') === 0 && cuenta(bIng, 'now') === 1, 'INGRESADO: ninguno verde, el primero en curso', { on: cuenta(bIng, 'on'), now: cuenta(bIng, 'now') });
const bListo = barra('listo', 'listo');
ok(cuenta(bListo, 'on') === 6 && cuenta(bListo, 'now') === 1, 'LISTO: 6 verdes + el paso actual', { on: cuenta(bListo, 'on'), now: cuenta(bListo, 'now') });
ok(/tp-step--corte/.test(barra('irreparable', 'no va')), 'SIN REPARACIÓN: barra cortada, no verde');
ok(/tp-step--corte/.test(barra('rechazado', 'no va')), 'RECHAZADO: barra cortada');
const bAband = barra('abandonado', 'listo');
ok(!/tp-step--corte/.test(bAband), 'ABANDONADO: no es una orden cortada (el equipo está reparado)');
ok(cuenta(bAband, 'on') === 6 && cuenta(bAband, 'now') === 1,
   'ABANDONADO: la barra llega hasta "Listo", igual que lo que ve el cliente', { on: cuenta(bAband, 'on'), now: cuenta(bAband, 'now') });

// ── Página del cliente ────────────────────────────────────
console.log('\n2) Barra de la página del cliente (estado.html)');
const html = fs.readFileSync(DIR + 'estado.html', 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('<\/script>'));

function render(paso, cerradaSinArreglo) {
  const els = {};
  const el = () => ({ innerHTML: '', textContent: '', className: '', style: {}, classList: { add() {}, remove() {} } });
  ['body', 'pie', 'biz', 'biz2', 'sub', 'act'].forEach(id => els[id] = el());
  const doc = {
    getElementById: id => els[id] || (els[id] = el()),
    title: '', addEventListener() {},
  };
  const campos = {
    nOrden: { integerValue: 7123 }, negocio: { stringValue: 'TechPoint' },
    modelo: { stringValue: 'Samsung Galaxy A54' }, imei4: { stringValue: '5678' },
    paso: { integerValue: paso }, titulo: { stringValue: 'Entregado' },
    detalle: { stringValue: 'Listo, gracias por confiar en nosotros.' },
    fechaIngreso: { stringValue: '2026-08-01T10:00:00.000Z' },
    fechaEstimada: { stringValue: '2026-08-06' },
    cerradaSinArreglo: { booleanValue: !!cerradaSinArreglo },
    historial: { arrayValue: { values: [
      { mapValue: { fields: { paso: { integerValue: 0 }, fecha: { stringValue: '2026-08-01T10:00:00.000Z' } } } },
      { mapValue: { fields: { paso: { integerValue: paso }, fecha: { stringValue: '2026-08-05T12:00:00.000Z' } } } },
    ] } },
    dir: { stringValue: 'Urquiza 4741' }, tel: { stringValue: '1172392511' },
    horarios: { stringValue: 'Lun a Sáb 9 a 19' },
  };
  const sandbox = {
    console, document: doc,
    location: { search: '?o=7123&k=k3n8x2p9qm4vb7ctd5ef', href: '' },
    URLSearchParams, setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
    encodeURIComponent, Date, Number, Array, Object, isNaN, JSON, Math, String,
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ fields: campos }) }),
    window: { addEventListener() {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'estado.html' });
  return new Promise(r => setImmediate(() => r(els.body.innerHTML)));
}

(async () => {
  const entregado = await render(4, false);
  const barras = entregado.match(/paso-b [^"]*/g) || [];
  ok(barras.length === 5, 'dibuja los 5 pasos', barras);
  ok(barras.every(b => /hecho/.test(b)), 'ENTREGADO: los 5 pasos en verde', barras);
  ok(!/ahora/.test(entregado), 'ENTREGADO: ningún paso marcado como "en curso"', entregado.match(/paso-b [^"]*/g));

  const enReparacion = await render(2, false);
  const b2 = enReparacion.match(/paso-b [^"]*/g) || [];
  ok(b2.filter(b => /hecho/.test(b)).length === 2 && b2.filter(b => /ahora/.test(b)).length === 1,
     'EN REPARACIÓN: 2 verdes + 1 en curso', b2);

  const cortada = await render(1, true);
  const b3 = cortada.match(/paso-b [^"]*/g) || [];
  ok(b3.every(b => !/hecho|ahora/.test(b)), 'SIN REPARACIÓN: no pinta pasos como cumplidos', b3);

  console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
  process.exit(fails ? 1 : 0);
})();
