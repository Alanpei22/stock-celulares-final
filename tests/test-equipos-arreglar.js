// 🔧 Equipos para arreglar: los del local que necesitan un arreglo antes de
// venderse. Alan: "poner todos los equipos míos que necesitan cierta
// reparación y después, reparados, dar opción de poner a la venta".
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// ── Firestore y DOM de mentira ──
const DB = {};
const db = {
  collection: col => ({
    doc: id => ({ set: async (d, o) => { DB[col + '/' + id] = Object.assign({}, (o && o.merge && DB[col + '/' + id]) || {}, d); } }),
    where: () => ({ onSnapshot: () => () => {} }),
  }),
};
const NODOS = {};
const el = id => (NODOS[id] = NODOS[id] || { id, value: '', textContent: '', innerHTML: '', options: [], focus() {}, remove() { delete NODOS[id]; } });
const TOASTS = [];
let EMPLEADO = false, PROMPT = '';
const ctx = {
  console, Math, Number, String, Array, Object, JSON, Date, Promise, setTimeout: f => f(),
  db, toast: m => TOASTS.push(m), confirm: () => true, prompt: () => PROMPT,
  tpFrenar: () => false, tpEsEmpleado: () => EMPLEADO,
  document: {
    getElementById: id => NODOS[id] || null,
    createElement: () => ({ remove() { if (NODOS[this.id] === this) delete NODOS[this.id]; }, set innerHTML(v) { this._h = v; for (const m of v.matchAll(/id="([\w-]+)"(?:\s+value="([^"]*)")?/g)) { el(m[1]).value = m[2] || ''; } }, get innerHTML() { return this._h; } }),
    head: { appendChild() {} },
    body: { appendChild(n) { if (n.id) NODOS[n.id] = n; } },
  },
};
ctx.openForm = () => { ctx.FORM_ABIERTO = true; ['fi-marca', 'fi-modelo', 'fi-estado', 'fi-imei', 'fi-notas', 'fi-bateria', 'fi-costo', 'fi-precio', 'form-title'].forEach(el);
  el('fi-storage').options = [{ value: '' }, { value: '64GB' }, { value: '128GB' }]; };
ctx.catFormCargar = p => { ctx.COLOR = p && p.color; };
vm.createContext(ctx);
vm.runInContext(leer('equipos-arreglar.js'), ctx, { filename: 'equipos-arreglar.js' });
const run = c => vm.runInContext(c, ctx);

console.log('\n1) Cuentas');
ctx._l = [
  { id: 'a', activo: true, estado: 'pendiente', costoCompra: 50000, fecha: '2026-11-01' },
  { id: 'b', activo: true, estado: 'listo', costoCompra: 80000, costoArreglo: 25000, fecha: '2026-11-03' },
  { id: 'c', activo: true, estado: 'arreglando', fecha: '2026-10-20' },
  { id: 'd', activo: false, estado: 'a_la_venta', costoCompra: 999999 },
];
const r = run('arrResumen(_l)');
ok(r.total === 3 && r.pendiente === 1 && r.arreglando === 1 && r.listo === 1, 'cuenta los que están en el taller (no los ya vendidos)', r);
ok(r.invertido === 155000, 'y la plata metida en ellos (compra + arreglo)', r.invertido);
ok(run('arrOrdenar(_l.slice(0,3)).map(a => a.id).join()') === 'b,c,a', 'los listos arriba (se pueden vender ya), después los que se arreglan');
ok(run(`arrNombre({ marca: 'Samsung', modelo: 'A32', almacenamiento: '128GB' })`) === 'Samsung A32 128GB', 'el nombre');

console.log('\n2) Anotar uno');
ok(run(`arrValidar({ marca: '', modelo: '', falla: 'x' })`) && run(`arrValidar({ marca: 'Moto', falla: '' })`), 'pide modelo y qué necesita');
ok(/15/.test(run(`arrValidar({ marca: 'Moto', falla: 'x', imei: '123' })`)), 'un IMEI incompleto no pasa');
(async () => {
  run('arrEditar()');
  Object.assign(el('eqa-marca'), { value: 'Samsung' }); el('eqa-modelo').value = 'Galaxy A32';
  el('eqa-falla').value = 'Cambio de módulo'; el('eqa-almacenamiento').value = '128 gb'; el('eqa-color').value = 'Negro';
  el('eqa-imei').value = '356938035643809'; el('eqa-bateria').value = '84';
  el('eqa-costoCompra').value = '$ 90.000'; el('eqa-costoArreglo').value = ''; el('eqa-notas').value = 'Parte de pago de Juan';
  await run('arrGuardarForm()');
  const k = Object.keys(DB).find(x => x.startsWith('equipos_arreglo/arr_'));
  const d = DB[k];
  ok(!!d && d.estado === 'pendiente' && d.activo === true && d.falla === 'Cambio de módulo', 'queda anotado "por arreglar", en su propia colección (no en el stock)', d);
  ok(d.costoCompra === 90000 && d.bateria === 84 && d.imei === '356938035643809', 'con lo que se pagó y los datos', d);
  ok(!Object.keys(DB).some(x => x.startsWith('stock/')), 'el stock (lo que se vende) ni se toca');
  // Al anotarlo, arriba de la lista: "Imprimir su etiqueta" (un toque nuevo:
  // la impresión no puede esperar a que se guarde)
  ok(/Anotado: <b>Samsung Galaxy A32 128 gb<\/b>/i.test((NODOS['eqa-cuerpo'] || {}).innerHTML || '') && /Imprimir su etiqueta/.test(NODOS['eqa-cuerpo'].innerHTML),
     'recién anotado: botón para imprimir su etiqueta ahí mismo', (NODOS['eqa-cuerpo'] || {}).innerHTML);
  const id = k.split('/')[1];
  ctx._id = id;

  console.log('\n3) Los pasos');
  await run('arrPaso(_id, "arreglando")');
  ok(DB[k].estado === 'arreglando', '🔧 Empezar a arreglar');
  PROMPT = '25.000';
  await run('arrPaso(_id, "listo")');
  ok(DB[k].estado === 'listo' && DB[k].costoArreglo === 25000 && DB[k].fechaListo, '✅ Quedó listo: pregunta cuánto se gastó en el arreglo', DB[k]);

  console.log('\n3b) Cambiar el estado a mano');
  // Alan: "que tenga una forma de cambiar el estado de reparación"
  run('arrElegirEstado(_id)');
  const hEst = NODOS['eqa-mod'].innerHTML;
  ok(/Por arreglar/.test(hEst) && /Arreglando/.test(hEst) && /Listo/.test(hEst) && !/A la venta/.test(hEst), 'tocando el estado se elige entre los tres (a la venta es pasarlo al stock)');
  ok(/class="eqa-op on" disabled[\s\S]*?Listo[\s\S]*?está así/.test(hEst), 'marca en cuál está ahora');
  await run('arrElegido(_id, "pendiente")');
  ok(DB[k].estado === 'pendiente', 'se puede volver atrás (por ejemplo, a "Por arreglar")', DB[k].estado);
  await run('arrElegido(_id, "arreglando")');
  ok(DB[k].estado === 'arreglando', 'o a cualquier otro');
  // Desde ✏️ Editar también
  run('arrEditar(_id)');
  ok(/<select id="eqa-estado">/.test(NODOS['eqa-mod'].innerHTML) && /value="arreglando" selected/.test(NODOS['eqa-mod'].innerHTML), 'al editar está el estado, con el actual elegido');
  ['marca', 'modelo', 'falla', 'almacenamiento', 'color', 'imei', 'bateria', 'notas'].forEach(c => { el('eqa-' + c).value = String(DB[k][c] == null ? '' : DB[k][c]); });
  el('eqa-costoCompra').value = '90000'; el('eqa-costoArreglo').value = '25000';
  el('eqa-estado').value = 'listo';
  await run('arrGuardarForm()');
  ok(DB[k].estado === 'listo' && DB[k].costoArreglo === 25000, 'y se guarda desde ahí', DB[k].estado);
  run('arrEditar()');
  ok(!/eqa-estado/.test(NODOS['eqa-mod'].innerHTML), 'uno nuevo no lo pregunta: arranca "Por arreglar"');
  const lst = leer('equipos-arreglar.js');
  ok(/onclick="arrElegirEstado\('\$\{id\}'\)"/.test(lst), 'el cartelito del estado de cada equipo se toca');

  console.log('\n4) Poner a la venta');
  run('arrPonerALaVenta(_id)');
  ok(ctx.FORM_ABIERTO, 'abre el formulario de siempre del stock');
  ok(NODOS['fi-marca'].value === 'Samsung' && NODOS['fi-modelo'].value === 'Galaxy A32' && NODOS['fi-imei'].value === '356938035643809', 'ya completo con los datos');
  ok(NODOS['fi-costo'].value === 115000, 'el costo es lo que se pagó + el arreglo (así la ganancia da bien)', NODOS['fi-costo'].value);
  ok(NODOS['fi-storage'].value === '128GB' && NODOS['fi-estado'].value === 'Usado' && ctx.COLOR === 'Negro', 'capacidad, estado y color', [NODOS['fi-storage'].value, ctx.COLOR]);
  ok(/Arreglado en el local: Cambio de módulo/.test(NODOS['fi-notas'].value) && /Juan/.test(NODOS['fi-notas'].value), 'en las notas queda qué se le hizo');
  ok(NODOS['fi-precio'].value === '', 'el precio lo ponés vos');

  // Cerrar sin guardar: sigue en la lista
  run('arrFormCerrado()');
  await run('arrALaVentaGuardado("stockX")');
  ok(DB[k].activo === true && DB[k].estado === 'listo', 'si cerrás el formulario sin guardar, sigue en "para arreglar"');

  // Guardar: pasa al stock y sale de la lista
  run('arrPonerALaVenta(_id)');
  await run('arrALaVentaGuardado("stock123")');
  ok(DB[k].activo === false && DB[k].estado === 'a_la_venta' && DB[k].stockId === 'stock123', 'al guardarlo en el stock, sale de la lista (y queda anotado a qué equipo pasó)', DB[k]);
  ok(run('ARREGLOS.some(a => a.id === _id)') === false, 'y deja de contarse');

  console.log('\n4b) Precio sugerido');
  // Alan (08/11): "precio sugerido al poner a la venta"
  const AHORA = Date.parse('2026-11-08T12:00:00Z');
  const hace = d => new Date(AHORA - d * 864e5).toISOString();
  ctx._a = { marca: 'Samsung', modelo: 'Galaxy A32', almacenamiento: '128GB', costoCompra: 90000, costoArreglo: 25000 };
  ctx._st = [
    { marca: 'Samsung', modelo: 'Galaxy A32', almacenamiento: '128GB', estado: 'Usado', vendido: true, precio: 180000, fecha_venta: hace(20) },
    { marca: 'Samsung', modelo: 'A32',        almacenamiento: '128GB', estado: 'Usado', vendido: true, precio: 200000, fecha_venta: hace(60) },
    { marca: 'Samsung', modelo: 'Galaxy A32', almacenamiento: '128GB', estado: 'Usado', vendido: true, precio: 999000, fecha_venta: hace(90) },
    { marca: 'Samsung', modelo: 'Galaxy A32', almacenamiento: '64GB',  estado: 'Usado', vendido: true, precio: 120000, fecha_venta: hace(10) },
    { marca: 'Samsung', modelo: 'Galaxy A32', almacenamiento: '128GB', estado: 'Usado', vendido: true, precio: 50000,  fecha_venta: hace(500) },
    { marca: 'Samsung', modelo: 'Galaxy A32', almacenamiento: '128GB', estado: 'Nuevo', vendido: true, precio: 400000, fecha_venta: hace(5) },
    { marca: 'Samsung', modelo: 'Galaxy A54', almacenamiento: '128GB', estado: 'Usado', vendido: true, precio: 350000, fecha_venta: hace(5) },
  ];
  ctx._AH = AHORA;
  let sg = run('arrPrecioSugerido(_a, _st, { ahora: _AH })');
  ok(sg.fuente === 'vendidos' && sg.mismaCapacidad === true && sg.n === 3, 'mira los iguales vendidos (misma capacidad, usados, último año)', sg);
  ok(sg.precio === 200000 && sg.moneda === 'ars', 'y toma el del medio: una venta carísima no lo corre', sg.precio);
  ok(sg.costo === 115000, 'sabe lo que costó (compra + arreglo)');
  const txtS = run('arrSugeridoTexto(arrPrecioSugerido(_a, _st, { ahora: _AH }), 1000)');
  ok(/Sugerido: <b>\$200\.000<\/b>/.test(txtS) && /los 3 iguales de la misma capacidad que vendiste/.test(txtS) && /ganás \$85\.000/.test(txtS), 'lo explica: por qué ese precio y cuánto ganás', txtS);
  // Sin vendidos: lo publicado en stock
  ctx._st2 = [{ marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '128GB', estado: 'Usado', precio: 500000, moneda: 'usd', precioUSD: 380 },
              { marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '128GB', estado: 'Usado', precio: 520000, moneda: 'usd', precioUSD: 392 }];
  sg = run(`arrPrecioSugerido({ marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '128GB', costoCompra: 250000 }, _st2, { ahora: _AH })`);
  ok(sg.fuente === 'stock' && sg.moneda === 'usd' && sg.precio === 385, 'si nunca vendiste uno: como tenés publicados los iguales, y en dólares si van en dólares', sg);
  ok(/U\$S 385/.test(run(`arrSugeridoTexto(arrPrecioSugerido({ marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '128GB', costoCompra: 250000 }, _st2, { ahora: _AH }), 1200)`)), 'en dólares lo muestra en dólares');
  // Sin iguales: costo + margen
  ctx._st3 = [1, 2, 3].map(i => ({ marca: 'X', modelo: 'M' + i, estado: 'Usado', vendido: true, costo: 100000, precio: 150000 }));
  sg = run(`arrPrecioSugerido({ marca: 'Motorola', modelo: 'G52', costoCompra: 60000, costoArreglo: 20000 }, _st3, { ahora: _AH })`);
  ok(sg.fuente === 'margen' && Math.abs(sg.margen - 0.5) < 1e-9 && sg.precio === 120000, 'si no hay iguales: tu costo + el margen que venís sacando', sg);
  sg = run(`arrPrecioSugerido({ marca: 'Motorola', modelo: 'G52', costoCompra: 100000 }, [], { ahora: _AH })`);
  ok(sg.margen === 0.35 && sg.precio === 135000, 'sin historia: 35%', sg);
  ok(run(`arrPrecioSugerido({ marca: 'Motorola', modelo: 'G52' }, [], {})`) === null, 'sin iguales ni costo: no inventa un precio');
  ok(/perdés/.test(run(`arrSugeridoTexto({ precio: 100000, moneda: 'ars', fuente: 'stock', n: 1, costo: 150000 }, 0)`)), 'si a ese precio perdés plata, lo avisa');
  const srcS = leer('equipos-arreglar.js');
  ok(/_arrSugerir\(a\);\n\}/.test(srcS) && /Usar este precio/.test(srcS) && /toggleMoneda\(\)/.test(srcS), 'aparece al poner a la venta, con "Usar este precio" (cambia a dólares si hace falta)');
  ok(/function arrFormCerrado\(\) \{ _arrDesde = null; document\.getElementById\('fi-sugerido'\)\?\.remove\(\); \}/.test(srcS), 'y se va al cerrar el formulario (no queda pegado al cargar otro equipo)');

  console.log('\n5) Sacar de la lista');
  run('ARREGLOS.push({ id: "z", activo: true, estado: "pendiente", marca: "Moto" })');
  await run('arrBorrar("z")');
  ok(DB['equipos_arreglo/z'].activo === false && DB['equipos_arreglo/z'].estado === 'baja', 'se da de baja (no se borra el registro)');

  console.log('\n6) La plata solo la ve el dueño');
  EMPLEADO = true;
  run('arrEditar()');
  ok(!NODOS['eqa-costoCompra'] || !/eqa-costoCompra/.test(NODOS['eqa-mod'].innerHTML), 'el empleado no ve lo que se pagó', null);
  ok(run('arrVePlata()') === false, 'igual que el costo del stock');
  EMPLEADO = false;

  console.log('\n6b) La etiqueta');
  // Alan: "agregar la impresión de una etiqueta para esos equipos que faltan reparar"
  const et = run(`arrEtiquetaDatos({ marca: 'Samsung', modelo: 'Galaxy A32', almacenamiento: '128GB', falla: 'Cambio de módulo', color: 'Negro', imei: '356938035643809', fecha: '2026-10-28T12:00:00' })`);
  ok(et.titulo === 'Samsung Galaxy A32 128GB' && et.lineas[0] === '🔧 Cambio de módulo', 'dice qué equipo es y qué le falta', et);
  ok(et.lineas[1] === 'IMEI 356938035643809' && /PARA ARREGLAR · Negro · desde 28\/10/.test(et.lineas[2]), 'el IMEI en su renglón, y que es para arreglar desde cuándo', et.lineas);
  ok(et.lineas.length <= 3, 'entra en el rollo (máximo 3 renglones abajo del nombre)');
  ok(run(`arrEtiquetaDatos({ modelo: 'G52' })`).lineas.join('|') === '🔧 Revisar|PARA ARREGLAR', 'sin datos, igual sale algo útil');
  const IMPRESO = [];
  ctx._hojaEtiquetas = (items, fn) => '<style></style>' + items.map(i => i.titulo).join(',');
  ctx.etiquetaLibreHtml = () => '';
  ctx._imprimirTocando = (tipo, html, tit) => IMPRESO.push({ tipo, html, tit });
  ctx.ARREGLOS = null;
  run(`ARREGLOS = [{ id: 'e1', activo: true, estado: 'pendiente', marca: 'Moto', modelo: 'G52', fecha: '2026-11-01' },
                   { id: 'e2', activo: true, estado: 'listo', marca: 'Apple', modelo: 'iPhone 11', fecha: '2026-11-02' }]; _arrFiltro = 'todos'`);
  run('arrEtiqueta("e1")');
  ok(IMPRESO[0] && IMPRESO[0].tipo === 'etiqueta' && /Moto G52/.test(IMPRESO[0].html), 'el 🏷️ de cada equipo la imprime por la etiquetadora (directa o remota, como las otras)', IMPRESO[0]);
  run('arrEtiquetasTodas()');
  ok(/Apple iPhone 11,Moto G52/.test(IMPRESO[1].html) && /Etiquetas \(2\)/.test(IMPRESO[1].tit), 'y "imprimir todas" saca las de la lista que estás mirando');
  run(`_arrFiltro = 'pendiente'`); run('arrEtiquetasTodas()');
  ok(IMPRESO[2].html.endsWith('Moto G52'), 'con un filtro puesto, solo las de ese paso');
  const src = leer('equipos-arreglar.js');
  const fnImp = (src.match(/function _arrImprimir[\s\S]*?\n\}/) || [''])[0];
  ok(fnImp && !/await/.test(fnImp), 'imprime en el mismo toque (si espera algo, Chrome bloquea la ventana)');
  ok(/onclick="arrEtiqueta\('\$\{id\}'\)"/.test(src) && /onclick="arrEtiquetasTodas\(\)"/.test(src), 'los botones están en la lista');

  // Los avisos (toast) quedaban DETRÁS del cuadro: imprimiendo desde otro
  // equipo no se veía "Mandado a la impresora" y parecía que no andaba
  const ut = leer('utils.js');
  const fnToast = (ut.match(/function toast\(msg, tipo\) \{[\s\S]*?\n\}/) || [''])[0];
  const zMod = Number((leer('equipos-arreglar.js').match(/\.eqa-mod\{[^}]*z-index:(\d+)/) || [])[1]);
  const zToast = Number((fnToast.match(/zIndex = '(\d+)'/) || [])[1]);
  ok(zToast > zMod && zMod > 0, `los avisos van arriba del cuadro (${zToast} > ${zMod})`, [zToast, zMod]);

  console.log('\n7) Enganchado');
  const app = leer('app.js'), html = leer('index.html');
  ok(/arrALaVentaGuardado\(id\)/.test(app), 'savePhone avisa cuando el equipo entra al stock');
  ok(/function closeForm\(\) \{\s*if \(typeof arrFormCerrado === 'function'\) arrFormCerrado\(\);/.test(app), 'cerrar el formulario lo suelta');
  ok(/id="s-arreglar"/.test(html) && /onclick="arrAbrir\(\)"/.test(html), 'en la barra del stock: el recuadro "🔧 Para arreglar" con la cantidad');
  ok(/<script defer src="equipos-arreglar\.js"><\/script>/.test(html), 'cargado en index.html');
  const reglas = leer('firestore.rules');
  const sens = (reglas.match(/function sensible\(col\) \{[\s\S]*?\];/) || [''])[0];
  ok(sens && !/equipos_arreglo/.test(sens), 'las reglas no cambian: va por la regla general del trabajo diario');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
