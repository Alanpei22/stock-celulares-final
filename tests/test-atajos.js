// 📲 Accesos directos en el celu (atajo.js + atajo-*.html). Alan (22/11): "me
// gustaría tener accesos directos en el celu, por ejemplo a la caja, a la toma
// de un equipo por reparación, al escáner de venta de artículos". En iPhone
// son íconos aparte en la pantalla de inicio; en Android, los atajos del
// ícono (manifest). Se prueba a dónde va cada uno y que el login no lo pierda.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ATAJOS = { caja: 'caja.html', reparacion: 'index.html?action=nueva-reparacion', escanear: 'caja.html?action=escanear', listo: 'index.html?action=escanear-reparacion' };

console.log('\n1) Una página, un manifest y un ícono por atajo');
Object.entries(ATAJOS).forEach(([k, dest]) => {
  const html = leer(`atajo-${k}.html`);
  ok(html.includes(`data-destino="${dest}"`), `${k}: va a ${dest}`);
  ok(html.includes(`rel="manifest" href="manifest-atajo-${k}.json"`) && html.includes(`apple-touch-icon" href="atajo-${k}-180.png"`), `${k}: su propio manifest e ícono de iPhone`);
  const man = JSON.parse(leer(`manifest-atajo-${k}.json`));
  ok(man.start_url === `/atajo-${k}.html` && man.display === 'standalone', `${k}: el manifest arranca en la misma página (que es la que redirige)`, man.start_url);
  ok(man.icons.every(i => fs.existsSync(DIR + i.src)) && fs.existsSync(DIR + `atajo-${k}-180.png`), `${k}: los íconos existen`);
  ok(/<script src="atajo\.js"><\/script>/.test(html), `${k}: carga atajo.js`);
  const corto = (new RegExp(`id: '${k}',\\s*corto: '([^']+)'`).exec(leer('atajo.js')) || [])[1];
  ok(corto && html.includes(`apple-mobile-web-app-title" content="${corto}"`) && man.short_name === corto, `${k}: el nombre de abajo del ícono ("${corto}") es el mismo en la página, el manifest y los pasos`, corto);
});

console.log('\n2) Android: los atajos del ícono (mantener apretado)');
const man = JSON.parse(leer('manifest.json'));
const urls = (man.shortcuts || []).map(s => s.url);
ok(urls.includes('/caja.html') && urls.includes('/index.html?action=nueva-reparacion') && urls.includes('/caja.html?action=escanear') && urls.includes('/index.html?action=escanear-reparacion'), 'Caja, Nueva reparación, Escanear venta y Equipo listo', urls);
ok(man.start_url === '/index.html' && man.icons.length >= 3, 'el resto del manifest sigue igual');

console.log('\n3) Abierto desde el ícono va directo; en el navegador, explica');
const src = leer('atajo.js');
const ctx = { console, String, JSON, prompt: () => {} };
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'atajo.js' });   // sin document: no arranca solo
function ventana({ app = false, referrer = '', iphone = true, atajo = 'escanear' } = {}) {
  const w = { replaced: null, main: { innerHTML: '' } };
  w.matchMedia = () => ({ matches: app });
  w.navigator = { standalone: app && iphone, userAgent: iphone ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' : 'Mozilla/5.0 (Linux; Android 14)', platform: iphone ? 'iPhone' : 'Linux', maxTouchPoints: 5 };
  w.location = { origin: 'https://tp.app', pathname: `/atajo-${atajo}.html`, replace: u => { w.replaced = u; } };
  w.document = {
    referrer,
    documentElement: { getAttribute: k => ({ 'data-atajo': atajo, 'data-destino': ATAJOS[atajo] }[k]) },
    getElementById: id => (id === 'atajo' ? w.main : null),
    createElement: () => ({}), head: { appendChild() {} },
  };
  return w;
}
let w = ventana({ app: true });
ok(ctx.atajoPintar(w) === 'fue' && w.replaced === 'caja.html?action=escanear', 'desde el ícono (modo app, sin página anterior) → directo a la venta con el escáner', w.replaced);
w = ventana({ app: true, atajo: 'reparacion' });
ctx.atajoPintar(w);
ok(w.replaced === 'index.html?action=nueva-reparacion', 'el de reparación → abre la toma del equipo');
w = ventana({ app: false });
ok(ctx.atajoPintar(w) === 'explica' && !w.replaced && /Agregar a inicio/.test(w.main.innerHTML) && /Compartir/.test(w.main.innerHTML), 'en Safari: explica Compartir → "Agregar a inicio"');
w = ventana({ app: false, iphone: false });
ctx.atajoPintar(w);
ok(/Agregar a la pantalla principal/.test(w.main.innerHTML) && /mantener apretado/.test(w.main.innerHTML), 'en Android: el menú de Chrome, y que también puede mantener apretado el ícono');
w = ventana({ app: true, referrer: 'https://tp.app/atajos.html' });
ok(ctx.atajoPintar(w) === 'explica' && !w.replaced && /Copiar el link/.test(w.main.innerHTML), 'abierto desde adentro de la app: no redirige, dice que hay que abrirlo en Safari');
w = ventana({ app: false }); ctx.atajoPintar(w);
ok(/usuario y la contraseña/.test(w.main.innerHTML), 'avisa que la primera vez puede pedir entrar');
w = ventana({ app: false });
w.main = { innerHTML: '' };
ctx.atajosPintarTodos(w);
ok(['atajo-caja.html', 'atajo-reparacion.html', 'atajo-escanear.html', 'atajo-listo.html'].every(h => w.main.innerHTML.includes(h)), 'la página de todos los accesos lista los cuatro');

console.log('\n4) La caja entiende "escanear" y el login no pierde a dónde iba');
const caja = leer('caja.js');
ok(/action === 'escanear'[\s\S]{0,500}openMovFormType\('ingreso'\)[\s\S]{0,120}movEscanear\(\)/.test(caja), '?action=escanear abre la venta y prende la cámara');
const auth = leer('auth.js');
ok(/_TP_URL_INICIAL = [\s\S]{0,200}location\.search/.test(auth), 'auth.js guarda la dirección antes de que app.js/caja.js le saquen el ?action=');
// requireAuth sin sesión, entrando por un atajo
const actx = { location: { pathname: '/caja.html', search: '?action=escanear', replace: u => { actx.fue = u; } }, Promise, encodeURIComponent };
vm.createContext(actx);
vm.runInContext(auth + '\n;waitForAuth = () => Promise.resolve(null);', actx, { filename: 'auth.js' });
vm.runInContext('requireAuth()', actx).then(() => {
  ok(actx.fue === 'login.html?next=' + encodeURIComponent('caja.html?action=escanear'), 'sin sesión → login con next=caja.html?action=escanear', actx.fue);
  const login = leer('login.html');
  const m = /function destino\(\) \{[\s\S]*?\n    \}/.exec(login);
  const lctx = { URLSearchParams, location: { search: '?next=' + encodeURIComponent('index.html?action=nueva-reparacion') } };
  vm.createContext(lctx);
  vm.runInContext(m[0], lctx);
  ok(vm.runInContext('destino()', lctx) === 'index.html?action=nueva-reparacion', 'y el login lo devuelve a la toma de reparación');
  ok(/'atajos\.html'/.test(leer('app.js')), 'en la app: Inicio → ⋯ → "Accesos directos en el celu"');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
});
