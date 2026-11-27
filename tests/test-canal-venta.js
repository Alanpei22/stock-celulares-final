// 🧑‍💼 Quién vendió y 🌐 dónde (local / online), y 💸 comisiones (canal-venta.js).
// Alan (27/11): "contraté una chica, sus ventas online van a tener comisión;
// que se marque si es online o en el local (esa sin comisión)". Y después:
// "que también se registre los que venden en el local, todo uno solo;
// detectá qué usuario es el de la compu principal y ahí, en cada venta, que
// se puedan seleccionar los nombres".
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// DOM chiquito: lo justo para el bloque
const els = {};
function nodo(id) {
  const n = { id, value: '', style: {}, dataset: {}, _h: '', parentNode: null,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { (on === undefined ? !this._s.has(c) : on) ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    insertBefore() {}, focus() {},
    querySelectorAll(sel) { return sel === '.cv-op' ? (this._ops || []) : []; },
    set innerHTML(h) {
      this._h = h;
      this._ops = [...h.matchAll(/data-cv="(\w+)"/g)].map(m => { const o = nodo('op'); o.dataset.cv = m[1]; return o; });
      [...h.matchAll(/id="([\w-]+)"/g)].forEach(m => { els[m[1]] = els[m[1]] || nodo(m[1]); });
    },
    get innerHTML() { return this._h; } };
  return n;
}
const ref = nodo('mov-cliente-section'); ref.parentNode = nodo('form');
els['mov-cliente-section'] = ref;
const LS = {};
const TOASTS = [];
let MOSTRADOR = false, USUARIO = 'Sofi', UID = 'uid-sofi';
const ctx = { console, String, Number, Math, Object, JSON, Array, Set, Promise, Date,
  localStorage: { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); } },
  tpUsuario: () => ({ nombre: USUARIO, rol: 'empleado' }),
  currentUser: () => ({ uid: UID }),
  tpMostrador: () => MOSTRADOR,
  toast: (m, t) => TOASTS.push([m, t]),
  document: { getElementById: id => els[id] || null, head: { appendChild() {} } } };
ctx.document.createElement = () => { const n = nodo('nuevo'); return new Proxy(n, { set(t, k, v) { t[k] = v; if (k === 'id') els[v] = t; return true; } }); };
vm.createContext(ctx);
vm.runInContext(leer('canal-venta.js'), ctx, { filename: 'canal-venta.js' });
const run = c => vm.runInContext(c, ctx);
LS.cvAjustesVenta = JSON.stringify({ nombres: ['Alan', 'Nacho', 'Sofi'], compartidas: ['uid-compu'] });

console.log('\n1) En la compu principal (cuenta compartida): se toca quién vendió');
USUARIO = 'TechPoint'; UID = 'uid-compu';
ok(run('cvCuentaCompartida()') === true, 'reconoce la cuenta compartida (la marcada desde el informe)');
run("cvMontar('mov', 'mov-cliente-section')");
const chips = els['mov-cv-chips'].innerHTML;
ok(['Alan', 'Nacho', 'Sofi', 'Otra persona'].every(n => chips.includes(n)) && /En el local/.test(els['mov-canal'].innerHTML) && /Online/.test(els['mov-canal'].innerHTML),
   'en CADA venta: "¿Quién vendió?" con los nombres, y "¿Dónde?" local / online', chips);
ok(els['mov-cv-nombre'].value === '' && run("cvFalta('mov')") === true && TOASTS.some(t => /quién hizo la venta/.test(t[0])), 'no se elige solo: sin tocar un nombre, no se guarda');
run("cvQuien('mov', 'Nacho')");
let d = run("cvAplicar({}, 'mov')");
ok(run("cvFalta('mov')") === false && d.vendidoPor === 'Nacho' && d.canal === 'local' && !('vendedorOnline' in d), 'venta en el local: queda a nombre de Nacho, sin comisión', d);
run("cvMontar('mov', 'mov-cliente-section')");
run("cvQuien('mov', 'Sofi')"); run("cvElegir('mov', 'online')");
d = run("cvAplicar({}, 'mov')");
ok(d.vendidoPor === 'Sofi' && d.canal === 'online' && d.vendedorOnline === 'Sofi', 'venta online de Sofi', d);
run("cvMontar('mov', 'mov-cliente-section')");
ok(els['mov-cv-nombre'].value === '' && run("cvAplicar({}, 'mov')").canal === 'local', 'la próxima venta arranca de cero (sin nombre y en el local)');
MOSTRADOR = true; UID = 'otra-cuenta';
ok(run('cvCuentaCompartida()') === true, 'la compu en "modo mostrador" también cuenta como compartida');
MOSTRADOR = false;

console.log('\n2) Con una cuenta personal: va su nombre solo');
USUARIO = 'Sofi'; UID = 'uid-sofi';
run("cvMontar('mov', 'mov-cliente-section')");
ok(els['mov-cv-nombre'].value === 'Sofi' && run("cvFalta('mov')") === false, 'en su celu, con su cuenta, ya aparece elegida ella');
run("cvQuien('mov', '')"); els['mov-cv-nombre'].value = 'Caro';
ok(run("cvAplicar({}, 'mov')").vendidoPor === 'Caro', '"Otra persona…" deja escribir un nombre');
run("cvMostrar('mov', false)");
ok(JSON.stringify(run("cvAplicar({}, 'mov')")) === '{}' && run("cvFalta('mov')") === false, 'escondido (un gasto, o al editar una venta): no anota nada ni frena');
ok(JSON.stringify(run("cvNombresDeTexto('Sofi, caro,  Caro ,\\nNacho')")) === '["Sofi","caro","Nacho"]', 'la lista de nombres se arma separando por comas (sin repetidos)');

console.log('\n3) El informe: cuánto vendió cada uno y la comisión de las online');
const MOVS = [
  { tipo: 'ingreso', canal: 'online', vendidoPor: 'Sofi', vendedorOnline: 'Sofi', monto: 100000, gananciaARS: 30000, fecha: '2026-11-03' },
  { tipo: 'ingreso', canal: 'online', vendidoPor: 'sofi ', monto: 50000, fecha: '2026-11-10' },
  { tipo: 'ingreso', canal: 'local', vendidoPor: 'Sofi', monto: 40000, fecha: '2026-11-12' },
  { tipo: 'ingreso', canal: 'local', vendidoPor: 'Nacho', monto: 200000, fecha: '2026-11-12' },
  { tipo: 'ingreso', monto: 70000, fecha: '2026-11-12' },                       // de antes: sin vendedor
  { tipo: 'ingreso', canal: 'online', vendedorOnline: 'Sofi', monto: 20000, fecha: '2026-10-30' },
  { tipo: 'egreso', canal: 'online', vendidoPor: 'Sofi', monto: 5000, fecha: '2026-11-05' },
];
let r = JSON.parse(JSON.stringify(run(`cvResumen(${JSON.stringify(MOVS)}, '2026-11', { pct: 5, base: 'venta' })`)));
const sofi = r.find(x => x.nombre.toLowerCase().trim() === 'sofi'), nacho = r.find(x => x.nombre === 'Nacho');
ok(sofi && sofi.online.n === 2 && sofi.online.total === 150000 && sofi.local.n === 1 && sofi.local.total === 40000 && sofi.comision === 7500,
   'Sofi: 2 online ($150.000, 5% = $7.500) y 1 en el local, que no suma comisión', sofi);
ok(nacho && nacho.local.total === 200000 && nacho.online.n === 0 && nacho.comision === 0, 'Nacho: lo que vendió en el local, sin comisión', nacho);
ok(r.length === 2, 'las ventas de antes (sin vendedor) y los gastos no entran');
r = JSON.parse(JSON.stringify(run(`cvResumen(${JSON.stringify(MOVS)}, '2026-11', { pct: 10, base: 'ganancia' })`)));
ok(r.find(x => /sofi/i.test(x.nombre)).comision === 3000 && r.find(x => /sofi/i.test(x.nombre)).sinCosto === 1, 'sobre la ganancia: 10% de $30.000; la que no tiene costo se avisa aparte');
ok(run("cvCfgNormal({ pct: 300, base: 'x' })").pct === 5, 'un % imposible no se acepta');

console.log('\n4) Enganchado en los tres lugares donde se vende');
const caja = leer('caja.js'), app = leer('app.js'), cv = leer('canal-venta.js');
ok(/cvMontar\('mov', 'mov-cliente-section'\); cvMostrar\('mov', tipo === 'ingreso' && !editingMovId\)/.test(caja) && /cvAplicar\(data, 'mov'\)/.test(caja)
   && /if \(!_selectedRepairItem && typeof cvFalta === 'function' && cvFalta\('mov'\)\) return;/.test(caja), 'cobro de la caja (los cobros de reparación no lo exigen; al editar no se pisa)');
ok(/cvMontar\('ve', reg\.closest\('label'\) \|\| reg\)/.test(caja) && /cvFalta\('ve'\)\) return;/.test(caja) && /d\.vendedor = cvLeer\('ve'\)\.vendidoPor/.test(caja), 'venta de equipo de la caja: el nombre tocado es el vendedor del comprobante');
ok(/cvMontar\('sell', 'sell-canje'\)/.test(app) && /cvFalta\('sell'\)\) return;/.test(app) && /cvLeer\('sell'\)\.vendidoPor\) \|\| document\.getElementById\('sell-vendedor'\)\.value/.test(app) && /fgV\.style\.display = 'none'/.test(app),
   '"Vender" desde el Stock: reemplaza al desplegable de vendedor (no se pregunta dos veces)');
ok(/<script src="canal-venta\.js"><\/script>/.test(leer('caja.html')) && /<script defer src="canal-venta\.js"><\/script>/.test(leer('index.html')), 'se carga en las dos pantallas');
ok(/label: 'Ventas por vendedor'[\s\S]{0,200}hide: !isOwner/.test(caja), 'Caja → Informes → "Ventas por vendedor" (solo el dueño)');
ok(/collection\('config'\)\.doc\('comisiones'\)/.test(cv) && /'config',/.test(leer('firestore.rules')), 'el % vive en config (solo el dueño): nadie puede tocarse la comisión');
ok(/collection\('ajustes_venta'\)\.doc\('vendedoras'\)/.test(cv) && !/'ajustes_venta'/.test(leer('firestore.rules')), 'nombres y cuenta compartida en ajustes_venta (los lee la compu compartida)');
ok(/where\('fecha', '>=', ini\)\.where\('fecha', '<=', fin\)/.test(cv), 'el informe lee solo las ventas del mes elegido');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
