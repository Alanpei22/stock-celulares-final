// 🌐 Ventas en el local / online y 💸 comisiones (canal-venta.js). Alan (27/11):
// "contraté una chica, va a tener sus ventas online, que van a tener una
// comisión. Que use el stock que tenemos, pero que se marque diferente si es
// venta online a través de ella o venta en el local, que la haga ella, pero
// eso no tiene comisión".
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// DOM chiquito: lo justo para el selector
const els = {};
function nodo(id) {
  const n = { id, value: '', style: {}, dataset: {}, children: [], _h: '', parentNode: null,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { (on === undefined ? !this._s.has(c) : on) ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    insertBefore(b) { this.children.push(b); },
    querySelectorAll(sel) { return sel === '.cv-op' ? (this._ops || []) : []; },
    set innerHTML(h) {
      this._h = h;
      // Las piezas que arma cvMontar
      this._ops = [...h.matchAll(/data-cv="(\w+)"/g)].map(m => { const o = nodo('op-' + m[1] + Math.random()); o.dataset.cv = m[1]; return o; });
      [...h.matchAll(/id="([\w-]+)"/g)].forEach(m => { els[m[1]] = els[m[1]] || nodo(m[1]); });
    },
    get innerHTML() { return this._h; } };
  return n;
}
const ref = nodo('mov-cliente-section'); ref.parentNode = nodo('form');
els['mov-cliente-section'] = ref;
const ctx = { console, String, Number, Math, Object, JSON, Array,
  localStorage: { getItem: k => (k === 'cajaVendedor' ? 'Mostrador' : null) },
  tpUsuario: () => ({ nombre: 'Sofi', rol: 'empleado' }),
  document: {
    getElementById: id => els[id] || null,
    createElement: () => nodo('nuevo'),
    head: { appendChild() {} },
  } };
ctx.document.createElement = () => { const n = nodo('nuevo'); return new Proxy(n, { set(t, k, v) { t[k] = v; if (k === 'id') els[v] = t; return true; } }); };
vm.createContext(ctx);
vm.runInContext(leer('canal-venta.js'), ctx, { filename: 'canal-venta.js' });
const run = c => vm.runInContext(c, ctx);

console.log('\n1) Cada venta dice dónde se hizo');
run("cvMontar('mov', 'mov-cliente-section')");
ok(!!els['mov-canal'] && /En el local/.test(els['mov-canal'].innerHTML) && /Online/.test(els['mov-canal'].innerHTML), 'el selector "🏪 En el local / 🌐 Online" aparece en la venta');
let d = run("cvAplicar({}, 'mov')");
ok(d.canal === 'local' && !('vendedorOnline' in d), 'de entrada es en el local (sin comisión)', d);
run("cvElegir('mov', 'online')");
ok(els['mov-cv-nombre'].value === 'Sofi', 'al elegir Online, "vendió" se completa con quien está usando la app', els['mov-cv-nombre'].value);
d = run("cvAplicar({}, 'mov')");
ok(d.canal === 'online' && d.vendedorOnline === 'Sofi', 'la venta queda online y a nombre de ella', d);
els['mov-cv-nombre'].value = 'Sofía G.';
ok(run("cvAplicar({}, 'mov')").vendedorOnline === 'Sofía G.', 'se puede poner otro nombre (si la carga otra persona por ella)');
run("cvMontar('mov', 'mov-cliente-section')");
ok(run("cvAplicar({}, 'mov')").canal === 'local', 'la próxima venta arranca otra vez en local');
run("cvMostrar('mov', false)");
ok(run("cvAplicar({}, 'mov')").canal === 'local', 'escondido (un gasto, o al editar): no marca nada online');

console.log('\n2) La comisión: solo las online');
const MOVS = [
  { tipo: 'ingreso', canal: 'online', vendedorOnline: 'Sofi', monto: 100000, gananciaARS: 30000, fecha: '2026-11-03' },
  { tipo: 'ingreso', canal: 'online', vendedorOnline: 'sofi ', monto: 50000, fecha: '2026-11-10' },
  { tipo: 'ingreso', canal: 'local', vendedorOnline: 'Sofi', monto: 999999, fecha: '2026-11-12' },
  { tipo: 'ingreso', monto: 70000, fecha: '2026-11-12', cargadoPor: 'Sofi' },
  { tipo: 'ingreso', canal: 'online', vendedorOnline: 'Sofi', monto: 20000, fecha: '2026-10-30' },
  { tipo: 'egreso', canal: 'online', vendedorOnline: 'Sofi', monto: 5000, fecha: '2026-11-05' },
];
let r = JSON.parse(JSON.stringify(run(`cvResumen(${JSON.stringify(MOVS)}, '2026-11', { pct: 5, base: 'venta' })`)));
ok(r.length === 1 && r[0].ventas === 2 && r[0].total === 150000 && r[0].comision === 7500, 'noviembre: 2 ventas online, $150.000, 5% = $7.500 (las del local y las viejas sin marca no cuentan)', r);
r = JSON.parse(JSON.stringify(run(`cvResumen(${JSON.stringify(MOVS)}, '2026-11', { pct: 10, base: 'ganancia' })`)));
ok(r[0].comision === 3000 && r[0].sinCosto === 1, 'sobre la ganancia: 10% de $30.000; la que no tiene costo se avisa aparte', r);
ok(run("cvCfgNormal({ pct: 300, base: 'x' })").pct === 5, 'un % imposible no se acepta');

console.log('\n3) Enganchado en los tres lugares donde se vende');
const caja = leer('caja.js'), app = leer('app.js');
ok(/cvMontar\('mov', 'mov-cliente-section'\); cvMostrar\('mov', tipo === 'ingreso' && !editingMovId\)/.test(caja) && /if \(tipo === 'ingreso' && !editingMovId && typeof cvAplicar === 'function'\) cvAplicar\(data, 'mov'\)/.test(caja),
   'cobro de la caja (solo ventas nuevas: al editar no se pisa)');
ok(/cvMontar\('ve', reg\.closest\('label'\) \|\| reg\)/.test(caja) && /cvAplicar\(data, 've'\)/.test(caja), 'venta de equipo desde la caja');
ok(/cvMontar\('sell', 'sell-canje'\)/.test(app) && /cvAplicar\(movData, 'sell'\)/.test(app), '"Vender" desde el Stock');
ok(/<script src="canal-venta\.js"><\/script>/.test(leer('caja.html')) && /<script defer src="canal-venta\.js"><\/script>/.test(leer('index.html')), 'se carga en las dos pantallas');
ok(/label: 'Comisiones online'[\s\S]{0,200}hide: !isOwner/.test(caja), 'Caja → Informes → "Comisiones online" (solo el dueño)');
ok(/collection\('config'\)\.doc\('comisiones'\)/.test(leer('canal-venta.js')) && /'config',/.test(leer('firestore.rules')), 'el % vive en config (solo el dueño lo ve y lo cambia): un empleado no puede tocarse la comisión');
ok(/where\('canal', '==', 'online'\)/.test(leer('canal-venta.js')), 'el informe lee solo las ventas online (no la caja entera)');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
