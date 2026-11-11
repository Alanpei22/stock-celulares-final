// 🔩 Al marcar "listo": descontar el repuesto o anotar el costo.
// Alan (11/11): "necesito descontar los repuestos cuando les pongo listo, o
// por lo menos poner el costo de la reparación". El cuadro existía, pero la
// lista de repuestos solo se cargaba al entrar a la sección Repuestos (decía
// "Sin repuestos cargados") y no había dónde escribir el costo.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const src = leer('repairs.js');
const trozo = src.slice(src.indexOf('function openRepUsoModal'), src.indexOf('// ── Nota rápida'));
const NODOS = {};
const el = id => (NODOS[id] = NODOS[id] || { id, value: '', textContent: '', innerHTML: '', disabled: false, focus() {},
  classList: { _s: new Set(['hidden']), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } } });
['rep-uso-search', 'rep-uso-costo', 'rep-uso-selected', 'rep-uso-confirm-btn', 'rep-uso-list', 'rep-uso-overlay', 'rep-uso-modal'].forEach(el);
let PEDIDOS = 0;
const ctx = {
  console, Math, Number, String, Array, Object, JSON, parseFloat, setTimeout: f => f(),
  document: { getElementById: id => NODOS[id] || null },
  esc: s => String(s),
  searchMatch: (hay, q) => hay.join(' ').toLowerCase().includes(String(q).toLowerCase()),
  listenRepuestos: () => { PEDIDOS++; },
  REPUESTOS: [],
};
vm.createContext(ctx);
vm.runInContext('let _repUsoCallback = null, _repUsoSelectedId = null;\n' + trozo, ctx, { filename: 'repairs.js (rep-uso)' });
const run = c => vm.runInContext(c, ctx);

console.log('\n1) Los repuestos se piden al abrir el cuadro');
let R = null;
ctx.cb = (id, costo) => { R = { id, costo }; };
run('openRepUsoModal(cb, { modelo: "A32" })');
ok(PEDIDOS === 1, 'aunque no hayas entrado a la sección Repuestos, se cargan');
ok(/Cargando los repuestos/.test(NODOS['rep-uso-list'].innerHTML), 'mientras llegan, lo dice (antes: "Sin repuestos cargados" y nada que elegir)');
ok(NODOS['rep-uso-confirm-btn'].disabled === true, 'sin elegir nada ni poner costo, no confirma');
const rp = leer('repuestos.js');
ok(/uso && !uso\.classList\.contains\('hidden'\) && typeof renderRepUsoList === 'function'\) renderRepUsoList\(\)/.test(rp), 'y cuando llegan, el cuadro abierto se llena solo');

console.log('\n2) Costo a mano');
NODOS['rep-uso-costo'].value = '18500';
run('repUsoCostoCambio()');
ok(NODOS['rep-uso-confirm-btn'].disabled === false && /Guardar el costo/.test(NODOS['rep-uso-confirm-btn'].textContent), 'con un costo escrito ya se puede confirmar');
run('confirmRepUso()');
ok(R && R.id === null && R.costo === 18500, 'guarda el costo sin descontar stock', R);

console.log('\n3) Elegir un repuesto');
ctx.REPUESTOS = [{ id: 'r1', nombre: 'Módulo A32', marca: 'Samsung', modelo: 'A32', cantidad: 3 }, { id: 'r2', nombre: 'Batería iPhone 11', cantidad: 1 }];
run('REPUESTOS = this.REPUESTOS');
R = null;
run('openRepUsoModal(cb, { modelo: "A32" })');
ok(NODOS['rep-uso-search'].value === 'A32' && /Módulo A32/.test(NODOS['rep-uso-list'].innerHTML) && !/iPhone 11/.test(NODOS['rep-uso-list'].innerHTML), 'arranca buscando el modelo del equipo', NODOS['rep-uso-search'].value);
ok(NODOS['rep-uso-costo'].value === '', 'y el costo de la vez anterior no queda pegado');
run('openRepUsoModal(cb, { modelo: "Xiaomi 99" })');
ok(NODOS['rep-uso-search'].value === '', 'si no hay repuestos de ese modelo, muestra todos');
run('selectRepUsoItem("r1")');
ok(NODOS['rep-uso-confirm-btn'].disabled === false && /Descontar y confirmar/.test(NODOS['rep-uso-confirm-btn'].textContent), 'elegido un repuesto: "Descontar y confirmar"');
run('confirmRepUso()');
ok(R && R.id === 'r1' && R.costo === 0, 'descuenta ese repuesto', R);
R = 'x';
run('openRepUsoModal(cb, {})'); run('skipRepUso()');
ok(R && R.id === null && !R.costo, '"No usé repuesto" sigue sin tocar nada', R);

console.log('\n4) Lo que se guarda');
ok(/openRepUsoModal\(async \(repuestoId, costoManual\) =>/.test(src) && /\}, r\);\n    return;/.test(src), 'el cambio a "listo" recibe el repuesto y el costo');
ok(/if \(costoManual > 0\) \{\s*const upd = \{ costo: costoManual, costoRepuesto: costoManual \};/.test(src), 'el costo a mano queda como costo de la reparación');
ok(/costoRepuesto: costoManual > 0 \? costoManual : costoARS,/.test(src), 'con repuesto Y costo a mano: descuenta el stock y manda el costo escrito');
ok(/db\.collection\('repuestos'\)\.doc\(repuestoId\)\.update\(\{ cantidad: nueva \}\)/.test(src), 'el stock del repuesto baja 1');
const html = leer('index.html');
ok(/id="rep-uso-costo"[^>]*oninput="repUsoCostoCambio\(\)"/.test(html) && /No usé repuesto/.test(html), 'el casillero del costo está en el cuadro');
ok(/function openCostoRequeridoModal\(r\) \{[\s\S]{0,260}listenRepuestos\(\)/.test(src), 'el aviso de costo al entregar también carga los repuestos');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
