// Ingresar equipos de a lotes (compras de 10-15 aparatos, modelos distintos).
//
// Lo que más se cuida NO es la velocidad sino no perder trabajo:
//  · El borrador se guarda en el celu en cada cambio: si se cierra la app con
//    14 equipos escaneados, están cuando volvés.
//  · Si el guardado falla (cupo, sin internet), el lote NO se borra.
//  · No entra dos veces el mismo IMEI, ni uno que ya esté en el stock.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const els = {};
const mk = id => els[id] = { id, value: '', textContent: '', innerHTML: '', disabled: false,
  classList: { _s: new Set(['hidden']), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  focus() {}, addEventListener() {} };
['lote-modal', 'lote-filas', 'lote-totales', 'lote-guardar', 'lote-estado', 'lote-ubicacion',
 'lote-garantia', 'lote-proveedor'].forEach(mk);

const TOASTS = [];
const COMMITS = [];
let FALLA_COMMIT = false;
let ESCANEO = null;     // { cb, opts } del lector

const ctx = {
  console, Date, Math, JSON, Promise, Number, String, Set, Array, Object,
  setTimeout: f => { f(); return 0; }, clearTimeout,
  document: { getElementById: id => els[id] || null, body: { style: {} }, addEventListener() {} },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  toast: (m, t) => TOASTS.push([t, m]),
  esc: s => String(s == null ? '' : s),
  fmt: n => '$' + Number(n || 0).toLocaleString('es-AR'),
  confirm: () => true,
  abrirEscaner: (cb, opts) => { ESCANEO = { cb, opts }; return Promise.resolve(true); },
  imeiDesdeCodigo: raw => (/^\d{15}$/.test(String(raw)) ? String(raw) : null),
  modeloPorImei: async imei => (imei.startsWith('35693803') ? { marca: 'Samsung', modelo: 'GALAXY A54', fuente: 'tabla' } : null),
  getDeviceId: () => 'celu',
  STOCK: [{ id: 'yaesta', imei: '111111111111111', marca: 'Motorola', modelo: 'G54', vendido: false }],
};
ctx.globalThis = ctx; ctx.self = ctx;
ctx.db = {
  collection: () => ({ doc: id => ({ id }) }),
  batch: () => {
    const ops = [];
    return {
      set: (ref, d) => ops.push(d),
      commit: async () => { if (FALLA_COMMIT) throw Object.assign(new Error('x'), { code: 'resource-exhausted' }); COMMITS.push(ops); },
    };
  },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'lote.js', 'utf8'), ctx, { filename: 'lote.js' });
const get = e => vm.runInContext(e, ctx);
const run = c => vm.runInContext(c, ctx);

const IMEI_A = '356938035643809';   // el TAC 35693803 lo conoce el stub
const IMEI_B = '356938035643817';
const filas = () => get('_lote.filas');
const borrador = () => JSON.parse(ctx.localStorage.getItem('loteBorrador') || 'null');

(async () => {

console.log('\n1) Escanear uno atrás del otro');
run('abrirLote()');
run('loteEscanear()');
ok(ESCANEO && ESCANEO.opts.continuo === true, 'la cámara NO se cierra con cada equipo', ESCANEO && ESCANEO.opts);
ok(typeof ESCANEO.opts.validar === 'function', 'y solo acepta IMEIs de verdad');
await ESCANEO.cb(IMEI_A);
await ESCANEO.cb(IMEI_B);
ok(filas().length === 2, 'dos equipos en el lote', filas().length);
ok(filas()[0].marca === 'Samsung' && filas()[0].modelo === 'GALAXY A54',
   'con marca y modelo puestos por el IMEI', filas()[0]);

console.log('\n2) No entra dos veces ni pisa lo que ya está en stock');
TOASTS.length = 0;
await ESCANEO.cb(IMEI_A);
ok(filas().length === 2, 'el mismo IMEI no se agrega de nuevo', filas().length);
ok(TOASTS.some(t => /ya está en el lote/.test(t[1])), 'y avisa', TOASTS);
TOASTS.length = 0;
await ESCANEO.cb('111111111111111');
ok(filas().length === 2, 'un IMEI que ya está en el stock tampoco');
ok(TOASTS.some(t => /ya está cargado/.test(t[1])), 'diciendo qué equipo es', TOASTS);

console.log('\n3) El borrador se guarda en el celu');
ok(borrador() && borrador().filas.length === 2, 'cada cambio queda guardado', borrador() && borrador().filas.length);
run('loteSetCampo(0, "precio", "350000")');
ok(borrador().filas[0].precio === '350000', 'también lo que se escribe a mano');
// Cerrar la app y volver
run('_lote = null; cerrarLote(); abrirLote()');
ok(filas().length === 2, 'al reabrir, el lote sigue ahí', filas().length);
ok(filas()[0].precio === '350000', 'con lo que habías cargado', filas()[0].precio);

console.log('\n4) Copiar el precio a todos');
run('loteAplicarATodas("precio")');
ok(filas()[1].precio === '350000', 'el segundo equipo toma el precio del primero', filas()[1].precio);

console.log('\n5) No guarda cosas a medias');
run('loteSetCampo(1, "modelo", "")');
TOASTS.length = 0;
await get('loteGuardar()');
ok(COMMITS.length === 0, 'sin modelo no guarda nada', COMMITS.length);
ok(TOASTS.some(t => /Falta completar/.test(t[1])), 'y dice qué falta', TOASTS);
run('loteSetCampo(1, "modelo", "G54"); loteSetCampo(1, "marca", "Motorola")');

console.log('\n6) Guardar: una sola operación para todo el lote');
run('loteSetComun("estado", "Usado"); loteSetComun("ubicacion", "Depósito"); loteSetComun("proveedor", "Remito 123"); loteSetComun("garantiaMeses", "6")');
TOASTS.length = 0;
await get('loteGuardar()');
ok(COMMITS.length === 1, 'un solo commit (no 15 escrituras sueltas)', COMMITS.length);
const guardados = COMMITS[0];
ok(guardados.length === 2, 'con los dos equipos', guardados.length);
ok(guardados.every(d => d.estado === 'Usado' && d.ubicacion === 'Depósito' && d.garantiaMeses === 6),
   'los datos comunes van en todos', guardados[0]);
ok(guardados.every(d => d.vendido === false && d.fecha && d.id), 'y quedan como equipos en stock', guardados[0]);
ok(guardados[0].notas === 'Lote: Remito 123', 'el proveedor queda anotado', guardados[0].notas);
ok(guardados[0].precio === 350000 && typeof guardados[0].precio === 'number', 'el precio va como número', guardados[0].precio);
ok(filas().length === 0 && borrador() === null, 'y el lote se limpia', { filas: filas().length, borrador: borrador() });
ok(TOASTS.some(t => /2 equipos cargados/.test(t[1])), 'avisa cuántos entraron', TOASTS);

console.log('\n7) Si falla el guardado, el lote NO se pierde');
// Es lo peor que puede pasar: escaneaste 15 equipos y se borran por un error.
run('loteAgregarManual(); loteSetCampo(0,"marca","Samsung"); loteSetCampo(0,"modelo","A15"); loteSetCampo(0,"precio","300000")');
FALLA_COMMIT = true;
TOASTS.length = 0;
await get('loteGuardar()');
ok(filas().length === 1, 'el equipo sigue en la lista', filas().length);
ok(borrador() && borrador().filas.length === 1, 'y el borrador sigue guardado', borrador());
ok(TOASTS.some(t => /Cupo de Firebase/.test(t[1])), 'explicando qué pasó', TOASTS);
ok(els['lote-guardar'].disabled === false, 'el botón vuelve a quedar habilitado para reintentar');
FALLA_COMMIT = false;
await get('loteGuardar()');
ok(COMMITS.length === 2, 'al reintentar, entra', COMMITS.length);

console.log('\n8) Está enganchado en la app');
const idx = fs.readFileSync(DIR + 'index.html', 'utf8');
ok(/onclick="abrirLote\(\)/.test(idx), 'el menú de Stock lo abre');
ok(/id="lote-modal"/.test(idx) && /id="lote-filas"/.test(idx), 'el modal está');
ok(/src="lote\.js"/.test(idx), 'y el archivo se carga');
const src = fs.readFileSync(DIR + 'lote.js', 'utf8');
ok(!/collection\('stock'\)[^\n]*\.get\(\)/.test(src), 'no lee la colección para validar: usa lo que ya está en memoria (cupo)');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
