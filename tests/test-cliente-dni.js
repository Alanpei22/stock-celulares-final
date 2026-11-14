// 🪪 Poner el DNI y que se carguen los datos del cliente. Alan (14/11):
// "quiero que esté armado como para poner el DNI del cliente y se carguen sus
// datos, cuando tomo un equipo".
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const els = {};
const el = id => els[id] = els[id] || { id, value: '', innerHTML: '', classList: { s: new Set(['hidden']), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } } };
['rep-fi-dni', 'rep-fi-nombre', 'rep-fi-tlf', 'rep-cliente-hint', 'sell-cli-dni', 'sell-cli-nombre', 'sell-cli-tel', 'sell-cli-hint'].forEach(el);
const CONSULTAS = [];
const FICHAS = [{ id: '1144445555', nombre: 'Rosa Viejita', telefonoRaw: '11 4444-5555', dni: '12.345.678' }];
const ctx = {
  console, Math, Number, String, Array, Object, JSON, Promise,
  document: { getElementById: id => els[id] || null },
  db: { collection: () => ({ where: (c, op, v) => ({ limit: () => ({ get: async () => {
    CONSULTAS.push(c + '=' + v);
    const d = FICHAS.filter(f => f[c] === v);
    return { empty: !d.length, docs: d.map(f => ({ id: f.id, data: () => f })) };
  } }) }) }) },
};
vm.createContext(ctx);
vm.runInContext(leer('clientes.js'), ctx, { filename: 'clientes.js' });
vm.runInContext(`var REPAIRS = [
  { nombre: 'Juan Pérez', tlf: '1155556666', dni: '30123456', fechaIngreso: '2026-03-01' },
  { nombre: 'Juan Perez', tlf: '', dni: '30.123.456', fechaIngreso: '2026-09-10' },
  { nombre: 'Otra', tlf: '1199998888', dni: '28999111', fechaIngreso: '2026-10-01' },
]; var STOCK = [{ clienteNombre: 'Juan Pérez', clienteTel: '1155556666', clienteDni: '30123456', fecha_venta: '2026-05-01' }];`, ctx);
const run = c => vm.runInContext(c, ctx);

console.log('\n1) Buscar por DNI');
ok(run('_cliDni("30.123.456")') === '30123456' && run('_cliDni("1234")') === '' && run('_cliDni(" 30 123 456 ")') === '30123456', 'el DNI con o sin puntos es el mismo');
let r = run('cliBuscarDniLocal("30.123.456", REPAIRS, STOCK)');
ok(r.nombre === 'Juan Perez' && r.tlf === '1155556666', 'lo encuentra aunque esté escrito distinto: nombre del más nuevo, y el teléfono del último que lo tenía', r);
ok(r.reparaciones === 2 && r.compras === 1, 'cuenta las reparaciones y las compras de celular', r);
ok(run('cliBuscarDniLocal("40111222", REPAIRS, STOCK)') === null, 'uno que nunca vino: nada');

(async () => {
  console.log('\n2) Al ponerlo en el ingreso de la reparación');
  els['rep-fi-dni'].value = '30123456';
  await run('_repDniAutocomplete("30123456")');
  ok(els['rep-fi-nombre'].value === 'Juan Perez' && els['rep-fi-tlf'].value === '1155556666', 'se cargan el nombre y el teléfono');
  ok(!els['rep-cliente-hint'].classList.contains('hidden') && /ya vino/.test(els['rep-cliente-hint'].innerHTML) && /2<\/b> reparaciones/.test(els['rep-cliente-hint'].innerHTML), 'y avisa que ya vino y cuántas veces', els['rep-cliente-hint'].innerHTML);
  ok(CONSULTAS.length === 0, 'si está en memoria no gasta lecturas de Firestore');
  // No pisa lo que ya escribieron
  els['rep-fi-nombre'].value = 'Juan Carlos Pérez'; els['rep-fi-tlf'].value = '1177778888';
  await run('_repDniAutocomplete("30123456", true)');
  ok(els['rep-fi-nombre'].value === 'Juan Carlos Pérez' && els['rep-fi-tlf'].value === '1177778888', 'no pisa lo que ya está escrito');

  console.log('\n3) Cliente de hace mucho (solo tiene ficha)');
  els['rep-fi-nombre'].value = ''; els['rep-fi-tlf'].value = ''; els['rep-fi-dni'].value = '12345678';
  await run('_repDniAutocomplete("12345678")');
  ok(els['rep-fi-nombre'].value === 'Rosa Viejita' && els['rep-fi-tlf'].value === '11 4444-5555', 'la busca en las fichas (las viejas tienen el DNI con puntos)', CONSULTAS);
  ok(CONSULTAS.join() === 'dniKey=12345678,dni=12345678,dni=12.345.678', 'prueba la clave nueva, sin puntos y con puntos', CONSULTAS);

  console.log('\n4) Cliente nuevo');
  els['rep-fi-nombre'].value = ''; els['rep-fi-dni'].value = '45000111';
  await run('_repDniAutocomplete("45000111")');
  ok(els['rep-fi-nombre'].value === '' && /Cliente nuevo/.test(els['rep-cliente-hint'].innerHTML), 'avisa que es nuevo y no completa nada');

  console.log('\n5) En la venta de un celular, igual');
  els['sell-cli-dni'].value = '28999111';
  await run('_sellDniAutocomplete("28999111")');
  ok(els['sell-cli-nombre'].value === 'Otra' && els['sell-cli-tel'].value === '1199998888', 'se cargan los datos del comprador');

  console.log('\n6) Enganchado');
  const html = leer('index.html'), cl = leer('clientes.js'), rp = leer('repairs.js');
  ok(html.indexOf('id="rep-fi-dni"') < html.indexOf('id="rep-fi-nombre"') && html.indexOf('id="rep-fi-dni"') < html.indexOf('id="rep-fi-tlf"'), 'en el ingreso, el DNI va primero (antes del nombre y el teléfono)');
  ok(/onblur="_repDniAutocomplete\(this\.value\)"/.test(html) && /length >= 8\) _repDniAutocomplete/.test(html) && /onblur="_sellDniAutocomplete\(this\.value\)"/.test(html), 'busca al salir del campo o al terminar de escribir los 8 números');
  ok(/upd\.dniKey = _cliDni\(dni\)/.test(cl) && /dniKey: _cliDni\(dni\)/.test(cl) && /dniKey: _cliDni\(c\.dni\)/.test(cl), 'las fichas guardan el DNI sin puntos para encontrarlas');
  ok(/getElementById\('rep-cliente-hint'\)\?\.classList\.add\('hidden'\)/.test(rp), 'el aviso del cliente anterior se borra al abrir un ingreso nuevo');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
