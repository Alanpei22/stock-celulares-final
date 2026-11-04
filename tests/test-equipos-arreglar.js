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
  const id = k.split('/')[1];
  ctx._id = id;

  console.log('\n3) Los pasos');
  await run('arrPaso(_id, "arreglando")');
  ok(DB[k].estado === 'arreglando', '🔧 Empezar a arreglar');
  PROMPT = '25.000';
  await run('arrPaso(_id, "listo")');
  ok(DB[k].estado === 'listo' && DB[k].costoArreglo === 25000 && DB[k].fechaListo, '✅ Quedó listo: pregunta cuánto se gastó en el arreglo', DB[k]);

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
