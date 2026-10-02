// Una sola copia de lo que usan todas las pantallas.
//
// De acá salieron tres bugs seguidos: el modo oscuro mezclado, el método de
// pago que no se marcaba y el sentido de la etiqueta que no llegaba. Los tres
// eran lo mismo — dos definiciones de la misma cosa, y gana la de más abajo.
//
// El caso que más dolía: `toast` estaba tres veces, y la copia de la caja
// armaba la clase `toast-error`, que NO existe en el CSS. En la pantalla que
// maneja plata, un error se veía igual que un "guardado".
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const JS = fs.readdirSync(DIR).filter(f => f.endsWith('.js') && f !== 'sw.js');
const fuente = {};
JS.forEach(f => { fuente[f] = fs.readFileSync(DIR + f, 'utf8'); });

const COMPARTIDAS = ['toast', 'openSheet', 'closeSheet', '_sheetItemClick',
                     'toggleDarkMode', 'initDarkMode', '_updateDarkIcon'];

console.log('\n1) Lo compartido está una sola vez, y en utils.js');
COMPARTIDAS.forEach(fn => {
  const re = new RegExp('^(async )?function ' + fn + '\\s*\\(', 'm');
  const donde = JS.filter(f => re.test(fuente[f]));
  ok(donde.length === 1 && donde[0] === 'utils.js', `${fn}() solo en utils.js`, donde);
});

console.log('\n2) Y utils.js llega a todas las páginas que la usan');
const usaAlguna = txt => COMPARTIDAS.some(fn => new RegExp('(?<![\\w$.])' + fn + '\\s*\\(').test(txt));
fs.readdirSync(DIR).filter(f => f.endsWith('.html')).forEach(p => {
  const h = fs.readFileSync(DIR + p, 'utf8');
  const sus = (h.match(/src="([a-z0-9_.-]+)\.js"/g) || []).map(s => s.slice(5, -1));
  const usa = usaAlguna(h) || sus.some(f => fuente[f] && usaAlguna(fuente[f]));
  if (!usa) { ok(true, `${p}: no las usa`); return; }
  ok(/src="utils\.js"/.test(h), `${p} carga utils.js`);
});

console.log('\n3) El toast usa las clases que existen en el CSS');
// `toast-error` no existe: si alguien la vuelve a escribir, el error sale del
// color del éxito y nadie se entera hasta que falte plata.
const css = fs.readFileSync(DIR + 'style.css', 'utf8');
ok(/\.toast\.error/.test(css), 'el CSS define .toast.error');
ok(/\.toast\.success/.test(css), 'y .toast.success');
const t = fuente['utils.js'].slice(fuente['utils.js'].indexOf('function toast('));
ok(/className = 'toast ' \+ \(tipo \|\| 'info'\)/.test(t), 'y el toast arma esas',
   (t.match(/className = [^;]*/) || [])[0]);
ok(!JS.some(f => /toast-\$\{|'toast-' \+|`toast-\$/.test(fuente[f])), 'nadie arma `toast-` + algo');
// Y que funcione sin el div en la página: caja.html y placas.html no lo traen.
// Esto se CORRE, no se lee: que el texto diga createElement no prueba que
// llegue a ejecutarse.
const vm = require('vm');
const creados = [];
const elMentira = () => ({ _c: '', textContent: '', classList: { add() {}, remove() {} },
                           set className(v) { this._c = v; }, get className() { return this._c; } });
const ctx = {
  console, setTimeout: f => { f(); return 0; }, clearTimeout: () => {},
  document: {
    getElementById: () => null,                    // la página NO trae el div
    createElement: () => { const e = elMentira(); creados.push(e); return e; },
    body: { appendChild: () => {} },
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fuente['utils.js'].slice(fuente['utils.js'].indexOf('let _toastTimer'),
                                         fuente['utils.js'].indexOf('// ── Menú deslizante')), ctx);
vm.runInContext("toast('No se pudo cobrar', 'error')", ctx);
ok(creados.length === 1, 'si la página no trae el div, lo crea', creados.length);
ok(creados[0] && creados[0].textContent === 'No se pudo cobrar', 'con el mensaje adentro', creados[0]);
ok(creados[0] && /\berror\b/.test(creados[0].className), 'y la clase del error, que es la que lo pinta rojo',
   creados[0] && creados[0].className);

console.log('\n4) El modo oscuro pinta TODOS los botones');
// Había una copia con querySelector (el primero) y otra con querySelectorAll.
// Con el botón repetido en varios menús, uno quedaba con sol y otro con luna.
const d = fuente['utils.js'].slice(fuente['utils.js'].indexOf('function _updateDarkIcon('));
ok(/querySelectorAll\('\.dark-toggle-btn'\)/.test(d), 'recorre todos los botones');
ok(/btn\.title =/.test(d), 'y les pone el título que corresponde');

console.log('\n5) Lo que se borró por no usarlo no volvió');
const BORRADAS = ['loadStock', 'saveStock', 'addPhoneFromAI', 'ackFollowUp', 'nowAR', 'fmtTime',
                  'loadDashCaja', 'closeDashMenu', 'isAuthed', 'onAuthChange', 'qrDataUri',
                  'fmtDateShort', 'tpUid', 'stopCrossDeviceListener', 'termCenter', 'termLR', 'termLine',
                  'buildStatsAnnualHTML_LEGACY', 'buildStatsMonthHTML_LEGACY', 'filterRepsByStatus',
                  'printPromptAction', '_hideQtyPicker', '_addServicioAModelo', '_toggleRepModelo'];
const vivas = BORRADAS.filter(fn => JS.some(f => new RegExp('^(async )?function ' + fn + '\\s*\\(', 'm').test(fuente[f])));
ok(vivas.length === 0, `${BORRADAS.length} funciones que no llamaba nadie siguen afuera`, vivas);
ok(!fs.existsSync(DIR + 'pos.html') && !fs.existsSync(DIR + 'pos.js'),
   'y el punto de venta viejo también (hacía lo mismo que la caja, sin guardia de login)');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
