// Ofrecer anclar la app al celular.
//
// Al empleado se le pasa un link. Si lo deja como link, cada vez tiene que ir
// a buscarlo al WhatsApp. Anclada queda como una app más: ícono en la pantalla
// y abre de una.
//
// El ofrecimiento vivía en index.html, o sea DESPUÉS de entrar. El momento en
// que alguien abre el link por primera vez es el login, que era justo donde no
// estaba. Ahora es un bloque solo (instalar.js) para las tres páginas.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// ── Un navegador de mentira ─────────────────────────────────
function navegador({ ua = 'Chrome', standalone = false, display = false, LS = {} } = {}) {
  const creados = [];
  const nodo = (id = '') => ({
    id, innerHTML: '', style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                 contains(c) { return this._s.has(c); } },
    appendChild() {}, addEventListener() {},
  });
  const porId = {};
  const doc = {
    referrer: '',
    getElementById: id => porId[id] || null,
    createElement: () => { const n = nodo(); creados.push(n); return n; },
    body: { appendChild(n) { porId[n.id] = n;
      // El innerHTML del navegador crearía los hijos: acá se simulan los dos
      // que el código busca después por id.
      const ver = () => { porId['tp-inst-btn'] = porId['tp-inst-btn'] || nodo('tp-inst-btn');
                          porId['tp-inst-x']   = porId['tp-inst-x']   || nodo('tp-inst-x'); };
      Object.defineProperty(n, 'innerHTML', { get() { return this._h || ''; },
                                              set(v) { this._h = v; ver(); } });
    } },
  };
  const oyentes = {};
  const ctx = {
    console, setTimeout: (f, ms) => { oyentes.__timer = f; return 0; }, clearTimeout,
    document: doc,
    navigator: { userAgent: ua, standalone, platform: 'Win32', maxTouchPoints: 0,
                 serviceWorker: { register: () => Promise.resolve() } },
    localStorage: { getItem: k => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); } },
    Date,
  };
  ctx.window = {
    matchMedia: () => ({ matches: display }),
    navigator: ctx.navigator,
    addEventListener: (ev, fn) => { oyentes[ev] = fn; },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(leer('instalar.js'), ctx, { filename: 'instalar.js' });
  return { ctx, oyentes, porId, LS, run: e => vm.runInContext(e, ctx) };
}
const VISIBLE = n => !!(n && n.classList.contains('tp-inst--ver'));

console.log('\n1) Está en las tres páginas, y el login explica aunque el navegador no avise');
['login.html', 'index.html', 'caja.html'].forEach(p => {
  ok(/src="instalar\.js"/.test(leer(p)), `${p} carga instalar.js`);
});
ok(/tpOfrecerInstalar\(\{ insistir: true \}\)/.test(leer('login.html')),
   'el login insiste: es donde el empleado abre el link por primera vez');
// El banner viejo vivía pegado al HTML de index: si quedara, saldrían dos.
['install-banner', 'install-btn', 'ios-tip'].forEach(id =>
  ok(!leer('index.html').includes(id), `no quedó el banner viejo (${id}) duplicando el aviso`));
ok(!leer('style.css').includes('.install-banner'), 'ni su CSS muerto');
ok(/tpOfrecerInstalar/.test(leer('app.js')) && /tpOfrecerInstalar/.test(leer('caja.js')),
   'la pantalla principal y la caja usan el mismo bloque');

console.log('\n2) Chrome: sale el botón y abre el cartel del sistema');
const a = navegador();
a.run('tpOfrecerInstalar()');
ok(!VISIBLE(a.porId['tp-instalar']), 'antes de que el navegador avise, no molesta');
let prompteado = 0, prevenido = 0;
a.ctx.__EV = { preventDefault: () => { prevenido++; }, prompt: () => { prompteado++; },
               userChoice: Promise.resolve({ outcome: 'accepted' }) };
a.oyentes['beforeinstallprompt'](a.ctx.__EV);
ok(prevenido === 1, 'el cartel no sale solo: espera a que lo pidan');
ok(VISIBLE(a.porId['tp-instalar']), 'aparece la barra');
ok(/Instalar/.test(a.porId['tp-instalar'].innerHTML), 'con el botón', a.porId['tp-instalar'].innerHTML);
a.run('tpInstalarAhora()');
ok(prompteado === 1, 'y el botón abre el cartel del sistema');
ok(!VISIBLE(a.porId['tp-instalar']), 'la barra se va');

console.log('\n3) iPhone: no hay botón, se explica con palabras');
// En iOS no existe el aviso del navegador: la única forma es Compartir →
// Agregar a inicio. Un botón "Instalar" ahí no haría nada.
const b = navegador({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
b.run('tpOfrecerInstalar()');
const htmlIOS = b.porId['tp-instalar'].innerHTML;
ok(VISIBLE(b.porId['tp-instalar']), 'la barra sale igual');
ok(/Compartir/.test(htmlIOS) && /Agregar a inicio/.test(htmlIOS), 'diciendo los pasos', htmlIOS);
ok(!/tp-inst-btn/.test(htmlIOS), 'y sin botón, que ahí no serviría de nada');

console.log('\n4) Ya anclada: no se ofrece de nuevo');
const c1 = navegador({ display: true });
c1.run('tpOfrecerInstalar()');
ok(!VISIBLE(c1.porId['tp-instalar']), 'abierta como app, no molesta');
const c2 = navegador({ ua: 'iPhone', standalone: true });
c2.run('tpOfrecerInstalar()');
ok(!VISIBLE(c2.porId['tp-instalar']), 'y en iPhone tampoco');

console.log('\n5) "Ahora no" dura un mes, no para siempre');
const d = navegador();
d.run('tpOfrecerInstalar()');
d.ctx.__EV = { preventDefault() {}, prompt() {}, userChoice: Promise.resolve({ outcome: 'accepted' }) };
d.oyentes['beforeinstallprompt'](d.ctx.__EV);
d.porId['tp-inst-x'].onclick();
ok(!VISIBLE(d.porId['tp-instalar']), 'la cruz la cierra');
ok(Number(d.LS['instalarOculto']) > 0, 'y se anota cuándo', d.LS);

// Al día siguiente no vuelve a aparecer.
const ayer = navegador({ LS: { instalarOculto: String(Date.now() - 24 * 60 * 60 * 1000) } });
ayer.run('tpOfrecerInstalar()');
ok(!ayer.oyentes['beforeinstallprompt'], 'al otro día ni se engancha a mirar');
// Pasado el mes sí: el empleado pudo cambiar de celular.
const viejo = navegador({ LS: { instalarOculto: String(Date.now() - 40 * 24 * 60 * 60 * 1000) } });
viejo.run('tpOfrecerInstalar()');
ok(!!viejo.oyentes['beforeinstallprompt'], 'pasado el mes vuelve a ofrecer');

console.log('\n6) El login explica a mano si Chrome nunca avisa');
// Chrome decide solo cuándo avisar, y a veces no avisa nunca. En el login eso
// dejaba al empleado sin saber cómo anclarla.
const e = navegador();
e.run('tpOfrecerInstalar({ insistir: true })');
ok(typeof e.oyentes.__timer === 'function', 'el login espera un rato por el aviso');
e.oyentes.__timer();
ok(VISIBLE(e.porId['tp-instalar']), 'y si no llegó, explica igual');
ok(/Instalar app/.test(e.porId['tp-instalar'].innerHTML), 'dónde está en el menú del navegador',
   e.porId['tp-instalar'].innerHTML);
// Pero si el aviso llegó, no se pisa con el cartel a mano.
const f = navegador();
f.run('tpOfrecerInstalar({ insistir: true })');
f.ctx.__EV = { preventDefault() {}, prompt() {}, userChoice: Promise.resolve({}) };
f.oyentes['beforeinstallprompt'](f.ctx.__EV);
f.oyentes.__timer();
ok(/Instalar<\/button>/.test(f.porId['tp-instalar'].innerHTML) &&
   !/menú/.test(f.porId['tp-instalar'].innerHTML),
   'si el aviso llegó, queda el botón y no el instructivo', f.porId['tp-instalar'].innerHTML);

console.log('\n7) El manifiesto deja instalarla');
const man = JSON.parse(leer('manifest.json'));
ok(man.display === 'standalone', 'se abre sin la barra del navegador', man.display);
ok(!!man.start_url && !!man.name, 'tiene nombre y por dónde arranca', [man.name, man.start_url]);
const tam = (man.icons || []).map(i => i.sizes);
ok(tam.includes('192x192') && tam.includes('512x512'), 'y los íconos que pide Chrome', tam);
['login.html', 'index.html', 'caja.html'].forEach(p =>
  ok(/rel="manifest"/.test(leer(p)), `${p} apunta al manifiesto`));

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
