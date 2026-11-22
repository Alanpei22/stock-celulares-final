// ✅ Equipo listo leyendo el QR (listo-qr.js). Alan (22/11): "quiero que cada
// equipo pase a estar listo a través de la lectura de QR, pida una foto del
// equipo, atrás y adelante". Se prueba: qué QR entiende, que sin las dos
// fotos no se puede, que las sube y recién ahí pasa a Listo por el camino de
// siempre (tpCambiarFase), y que si Storage no tiene la regla nueva publicada
// igual se guardan.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = {};
const nuevoEl = () => ({ innerHTML: '', id: '', className: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; },
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } } });
const document = {
  getElementById: id => els[id] || null,
  createElement: () => nuevoEl(),
  body: { appendChild: el => { if (el.id) els[el.id] = el; } },
  head: { appendChild: el => { if (el.id) els[el.id] = el; } },
};
const LLAMADAS = [], TOASTS = [], UPDATES = [], SUBIDAS = [];
let storageCerrado = false;
const ctx = {
  console, String, Number, Object, Array, JSON, Math, Date, Promise, RegExp, Set,
  document, esc: s => String(s == null ? '' : s),
  toast: (m, t) => TOASTS.push([m, t]),
  confirm: () => true,
  URL: { createObjectURL: f => 'blob:' + f.name, revokeObjectURL() {} },
  REPAIRS: [
    { id: 'r1', nOrden: 1234, marca: 'Samsung', modelo: 'A54', nombre: 'Juan', estado: 'reparando', arreglo: 'Pin de carga' },
    { id: 'r2', nOrden: 1235, marca: 'iPhone', modelo: '13', estado: 'listo' },
    { id: 'r3', nOrden: 1236, marca: 'Moto', modelo: 'G54', estado: 'entregado' },
  ],
  openRepairDetail: id => LLAMADAS.push(['ficha', id]),
  tpCambiarFase: (id, f, op) => { LLAMADAS.push(['fase', id, f, op]); return Promise.resolve(); },
  tpEsDueno: () => false,
  tpUsuario: () => ({ nombre: 'Nacho' }),
  fotoAchicar: f => Promise.resolve({ blob: { size: 1000, de: f.name }, ext: 'webp', tipo: 'image/webp' }),
  _fotoPut: (ref) => ref.put(),
  firebase: { storage: () => ({ ref: ruta => ({ put: () => {
    if (storageCerrado && ruta.startsWith('reparaciones/')) return Promise.reject({ code: 'storage/unauthorized' });
    SUBIDAS.push(ruta);
    return Promise.resolve({ ref: { getDownloadURL: () => Promise.resolve('https://fotos/' + ruta) } });
  } }) }) },
  db: { collection: c => ({ doc: id => ({ update: d => { UPDATES.push({ c, id, d }); return Promise.resolve(); } }) }) },
};
vm.createContext(ctx);
vm.runInContext(leer('listo-qr.js'), ctx, { filename: 'listo-qr.js' });
const espera = () => new Promise(r => setTimeout(r, 10));

(async () => {
  console.log('\n1) Qué QR entiende');
  const L = c => JSON.stringify(ctx.lqLeerCodigo(c));
  ok(L('https://stock-celulares-final.vercel.app/index.html?r=1234') === '{"nOrden":1234}', 'la etiqueta del equipo (…?r=1234)');
  ok(L('https://x.app/estado.html?o=1234&k=abc') === '{"nOrden":1234}', 'el QR del comprobante del cliente (estado.html?o=…)');
  ok(L('https://x.app/estado.html?id=AbC123') === '{"id":"AbC123"}', 'el comprobante viejo (estado.html?id=…)');
  ok(L('N°1234') === '{"nOrden":1234}' && L('#55') === '{"nOrden":55}' && L('1234') === '{"nOrden":1234}', 'el número a mano ("N°1234", "#55")');
  ok(ctx.lqLeerCodigo('7790001234567') === null && ctx.lqLeerCodigo('hola') === null, 'un código de barras de producto no es una reparación');

  console.log('\n2) En el taller → pide las fotos; si no, la ficha');
  ok(ctx.lqAbrir('r2') === 'ficha' && LLAMADAS.pop()[1] === 'r2' && /ya estaba listo/.test(TOASTS.pop()[0]), 'si ya está listo: abre la ficha y avisa');
  ok(ctx.lqAbrir('r3') === 'ficha', 'entregado: la ficha como siempre');
  LLAMADAS.length = 0;
  ok(ctx.lqAbrir('r1') === 'fotos', 'en reparación: "Equipo listo" con las fotos');
  let h = els['lq-modal'].innerHTML;
  ok((h.match(/type="file" accept="image\/\*" capture="environment"/g) || []).length === 2, 'dos recuadros que abren la cámara: adelante y atrás');
  ok(/Adelante/.test(h) && /Atrás/.test(h) && /N°1234/.test(h) && /Pin de carga/.test(h), 'con el N° de orden, el equipo y el trabajo');
  ok(/id="lq-ok" class="lq-ok" disabled/.test(h) && /Faltan las dos fotos/.test(h), 'sin fotos, el botón está apagado');
  ok(!/Marcarlo sin fotos/.test(h), 'el empleado no puede marcarlo sin fotos');
  await ctx.lqConfirmar(null);
  ok(!LLAMADAS.length && /Faltan las fotos/.test(TOASTS.pop()[0]), 'y aunque lo fuerce, sin las dos fotos no pasa a Listo');
  ctx.lqFoto('adelante', { files: [{ name: 'a.jpg' }] });
  h = els['lq-modal'].innerHTML;
  ok(/blob:a\.jpg/.test(h) && /disabled/.test(h), 'con una sola foto: se ve, pero sigue apagado');
  ctx.lqFoto('atras', { files: [{ name: 'b.jpg' }] });
  h = els['lq-modal'].innerHTML;
  ok(!/id="lq-ok" class="lq-ok" disabled/.test(h) && /Marcar como listo/.test(h), 'con las dos: "✅ Marcar como listo"');

  console.log('\n3) Sube las fotos, las anota y recién ahí pasa a Listo');
  await ctx.lqConfirmar(null);
  await espera();
  ok(SUBIDAS.length === 2 && SUBIDAS.every(s => s.startsWith('reparaciones/r1/')) && SUBIDAS.some(s => /adelante_/.test(s)) && SUBIDAS.some(s => /atras_/.test(s)), 'sube las dos a reparaciones/r1/', SUBIDAS);
  const u = UPDATES[0];
  ok(u && u.c === 'repairs' && u.id === 'r1' && /adelante_/.test(u.d.fotosListo.adelante) && /atras_/.test(u.d.fotosListo.atras) && u.d.fotosListo.por === 'Nacho',
    'anota fotosListo (adelante, atrás, quién) en la reparación', u);
  const f = LLAMADAS.find(x => x[0] === 'fase');
  ok(f && f[1] === 'r1' && f[2] === 'listo' && f[3].conFotos === true, 'y pasa a Listo por el camino del tablero (tpCambiarFase), marcando que ya tiene fotos', f);
  ok(UPDATES.length === 1 && LLAMADAS.indexOf(f) === LLAMADAS.length - 1, 'primero las fotos, después el cambio de estado');
  ok(els['lq-modal'].classList.contains('hidden'), 'la hoja se cierra');

  console.log('\n4) Si Storage todavía no tiene la regla nueva, se guardan igual');
  ctx.REPAIRS[0].estado = 'reparando';
  SUBIDAS.length = 0; UPDATES.length = 0; LLAMADAS.length = 0; storageCerrado = true;
  ctx.lqAbrir('r1'); ctx.lqFoto('adelante', { files: [{ name: 'a.jpg' }] }); ctx.lqFoto('atras', { files: [{ name: 'b.jpg' }] });
  await ctx.lqConfirmar(null); await espera();
  ok(SUBIDAS.length === 2 && SUBIDAS.every(s => s.startsWith('stock-photos/rep-r1/')), 'van a stock-photos/rep-r1/ (la carpeta que ya está permitida)', SUBIDAS);
  ok(LLAMADAS.some(x => x[0] === 'fase'), 'y pasa a Listo igual');
  storageCerrado = false;

  console.log('\n5) Sin fotos: solo el dueño');
  LLAMADAS.length = 0;
  ctx.lqAbrir('r1'); ctx.lqSinFotos();
  ok(!LLAMADAS.length, 'el empleado no puede');
  ctx.tpEsDueno = () => true;
  ctx.lqAbrir('r1');
  ok(/Marcarlo sin fotos/.test(els['lq-modal'].innerHTML), 'el dueño ve "Marcarlo sin fotos"');
  ctx.lqSinFotos(); await espera();
  ok(LLAMADAS.some(x => x[0] === 'fase' && x[3].conFotos), 'y con confirmación, pasa a Listo');

  console.log('\n6) En la ficha se ven las fotos');
  const fh = ctx.lqFotosHtml({ fotosListo: { adelante: 'https://f/a.webp', atras: 'https://f/b.webp', fecha: '2026-11-22T10:00:00Z', por: 'Nacho' } });
  ok(/Cómo quedó/.test(fh) && /a\.webp/.test(fh) && /b\.webp/.test(fh) && /Nacho/.test(fh), '"📷 Cómo quedó" con adelante y atrás');
  ok(ctx.lqFotosHtml({}) === '', 'sin fotos, nada');

  console.log('\n7) Enganches');
  const tp = leer('tp-fases.js'), app = leer('app.js'), idx = leer('index.html');
  ok(/nuevaFase === 'listo' && !opts\.conFotos[\s\S]{0,160}lqAbrir\(id\)/.test(tp), 'el botón "Listo para retirar" de la ficha también pide las fotos');
  ok((app.match(/_repAbrirQr\((r|rep)\.id\)/g) || []).length === 2, 'el QR de la etiqueta (cámara del celu, ?r=N) va a "Equipo listo"');
  ok(/action === 'escanear-reparacion'[\s\S]{0,400}repEscanearListo\(\)/.test(app), 'el acceso directo "Equipo listo" abre la cámara');
  ok(/onclick="repEscanearListo\(\)"/.test(idx) && /<script defer src="listo-qr\.js"><\/script>/.test(idx), '📷 en el buscador de Reparaciones');
  ok(/lqFotosHtml\(r\)/.test(leer('repairs.js')), 'la ficha muestra las fotos');
  ok(/match \/reparaciones\/\{repairId\}\/\{filename\}/.test(leer('storage.rules')), 'storage.rules tiene la carpeta reparaciones/ (hay que publicarla)');

  console.log('\n8) 📥 Fotos de cómo ingresa (formulario de reparación)');
  els['rep-fotos-ingreso'] = nuevoEl();
  ctx.fiReset(null);
  let fi = els['rep-fotos-ingreso'].innerHTML;
  ok((fi.match(/capture="environment" onchange="fiFoto/g) || []).length === 2 && /Cómo ingresa/.test(fi) && /QR/.test(fi), 'dos recuadros (adelante y atrás) que dicen que el cliente las ve en su QR');
  ok(ctx.fiFaltanFotos() === true, 'sin fotos: faltan');
  ok(ctx.fiSubirIngreso({ id: 'r9', nOrden: 9 }) === null, 'sin fotos nuevas no sube nada');
  ctx.fiFoto('adelante', { files: [{ name: 'in-a.jpg' }] }); ctx.fiFoto('atras', { files: [{ name: 'in-b.jpg' }] });
  ok(ctx.fiFaltanFotos() === false && /blob:in-a\.jpg/.test(els['rep-fotos-ingreso'].innerHTML), 'con las dos: se ven y ya no faltan');
  SUBIDAS.length = 0; UPDATES.length = 0;
  const PUBLICADOS = [];
  ctx.upsertSeguimientoPublico = r => PUBLICADOS.push(JSON.parse(JSON.stringify(r)));
  ctx.REPAIRS.push({ id: 'r9', nOrden: 9, estado: 'reparando' });
  const fIng = await ctx.fiSubirIngreso({ id: 'r9', nOrden: 9 });
  ok(SUBIDAS.length === 2 && SUBIDAS.every(s => /^reparaciones\/r9\/ingreso-(adelante|atras)_/.test(s)), 'al guardar, sube las dos a reparaciones/r9/', SUBIDAS);
  ok(UPDATES[0] && UPDATES[0].id === 'r9' && /ingreso-adelante/.test(UPDATES[0].d.fotosIngreso.adelante) && /ingreso-atras/.test(UPDATES[0].d.fotosIngreso.atras), 'anota fotosIngreso en la reparación', UPDATES[0]);
  ok(PUBLICADOS.length === 1 && PUBLICADOS[0].fotosIngreso && PUBLICADOS[0].fotosIngreso.adelante, 'y actualiza el seguimiento del cliente con las fotos');
  ctx.fiReset({ fotosIngreso: { adelante: 'https://f/x.webp', atras: 'https://f/y.webp' } });
  ok(ctx.fiFaltanFotos() === false && /https:\/\/f\/x\.webp/.test(els['rep-fotos-ingreso'].innerHTML), 'al editar, muestra las que ya tenía');
  const fh2 = ctx.lqFotosHtml({ fotosIngreso: { adelante: 'https://f/i.webp' }, fotosListo: { atras: 'https://f/o.webp' } });
  ok(/Cómo ingresó/.test(fh2) && /Cómo quedó/.test(fh2), 'la ficha muestra las de ingreso y las de salida');

  console.log('\n9) Las ve el cliente en su QR');
  const seg = leer('seguimiento.js');
  const sctx = { console, String, JSON, Array, Set, Date, window: {}, SEG_MENSAJES: undefined };
  vm.createContext(sctx);
  vm.runInContext(seg, sctx, { filename: 'seguimiento.js' });
  const pub = sctx._segDocPublico({ nOrden: 7, marca: 'Samsung', modelo: 'A54', foto: 'data:image/jpeg;base64,AAAA',
    fotosIngreso: { adelante: 'https://s/a.webp', atras: 'https://s/b.webp', fecha: '2026-11-18', por: 'Nacho' },
    fotosListo: { adelante: 'https://s/c.webp', atras: 'data:image/png;base64,XX' } }, 'listo');
  ok(pub.fotosIngreso.adelante === 'https://s/a.webp' && pub.fotosIngreso.atras === 'https://s/b.webp', 'el documento público lleva las fotos de ingreso', pub.fotosIngreso);
  ok(pub.fotosSalida.adelante === 'https://s/c.webp' && pub.fotosSalida.atras === '', 'y las de salida (solo links https: nada de base64)', pub.fotosSalida);
  ok(!('por' in pub.fotosIngreso) && !JSON.stringify(pub).includes('base64'), 'sin quién la sacó ni la foto vieja del ingreso');
  ok(sctx._segDocPublico({ nOrden: 8 }, 'reparacion').fotosIngreso === null, 'sin fotos, nada');
  const est = leer('estado.html');
  ok(/fotosBloque\(d\.fotosIngreso, '📥 Cómo ingresó'\)/.test(est) && /paso >= 3 \? fotosBloque\(d\.fotosSalida, '✅ Cómo sale'\)/.test(est), 'estado.html: "Cómo ingresó" siempre y "Cómo sale" recién cuando está listo');
  ok(/function fotoUrl\(u\) \{ return \(typeof u === 'string' && \/\^https:/.test(est) && /id="visor"/.test(est), 'solo muestra links https y se pueden agrandar');
  const rp = leer('repairs.js');
  ok(/fiFaltanFotos\(\)[\s\S]{0,120}confirm\(/.test(rp) && /fiSubirIngreso\(newDoc\)/.test(rp) && /fiSubirIngreso\(\{ \.\.\.existing/.test(rp) && /fiReset\(/.test(rp), 'repairs.js: pregunta si faltan, sube al crear y al editar, limpia al abrir');
  ok(/id="rep-fotos-ingreso"/.test(leer('index.html')), 'el formulario tiene el lugar para las fotos');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})();
