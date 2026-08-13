// Harness sin navegador para la autenticación de las funciones de /api.
//
// Por qué existe: /api/ai, /api/send-push y /api/telegram-notify estaban
// abiertos en internet. Cualquiera con la URL podía quemar los créditos de la
// API de Anthropic (que pagamos nosotros), mandarle notificaciones a todos los
// dispositivos del negocio, o escribirle al Telegram privado del dueño.
//
// Ahora los tres exigen el token de sesión de Firebase de una cuenta de la
// allowlist. Esta prueba vigila que no se le escape ninguno — incluido un
// endpoint nuevo que alguien agregue más adelante sin guardia.
const fs = require('fs'), vm = require('vm'), path = require('path');
const raiz = f => path.join(__dirname, '..', f);
const leer = f => fs.readFileSync(raiz(f), 'utf8');

let fails = 0;
function ok(cond, label, extra) {
  console.log((cond ? '  OK  ' : '  FAIL') + ' · ' + label + (cond ? '' : '  → ' + JSON.stringify(extra)));
  if (!cond) fails++;
}

// Los chequeos miran el CÓDIGO, no los comentarios. Si no, alcanzaría con
// nombrar el guardia en un comentario para que la prueba diera por protegida
// una función que no lo está (pasó: este archivo mismo lo dejó pasar una vez).
function sinComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// "a" tiene que aparecer, "b" también, y "a" antes que "b".
// Ojo con indexOf: si el texto no está devuelve -1, que es menor que todo.
function antesQue(src, a, b) {
  const ia = src.indexOf(a), ib = src.indexOf(b);
  return ia >= 0 && ib >= 0 && ia < ib;
}

// ════════════════════════════════════════════════════════════
//  1) Ningún endpoint de /api queda sin guardia
// ════════════════════════════════════════════════════════════
console.log('\n  ── Los endpoints de /api ──');

// Cada endpoint tiene que probar QUE la llamada está autorizada, de alguna de
// estas formas. Si mañana aparece un archivo nuevo en /api sin ninguna, falla.
const FORMAS_VALIDAS = [
  /exigirSesion\s*\(/,                    // sesión de Firebase (node)
  /corteSiNoAutorizadoEdge\s*\(/,         // sesión de Firebase (edge)
  /CRON_SECRET/,                          // cron del server
  /x-telegram-bot-api-secret-token/,      // webhook de Telegram
];

const endpoints = fs.readdirSync(raiz('api'))
  .filter(f => f.endsWith('.js') && !f.startsWith('_'));   // "_" = ayudante, no ruta

ok(endpoints.length >= 7, 'se encontraron los endpoints de /api', endpoints);

endpoints.forEach(f => {
  const src = sinComentarios(leer(path.join('api', f)));
  const guardado = FORMAS_VALIDAS.some(re => re.test(src));
  ok(guardado, `/api/${f.replace('.js','')} exige alguna autenticación`, f);
});

// ── Los tres que arreglamos, en detalle ──
const sendPush = sinComentarios(leer('api/send-push.js'));
ok(/import\s*\{[^}]*exigirSesion[^}]*\}\s*from\s*'\.\/_auth\.js'/.test(sendPush),
   'send-push importa el guardia');
ok(/exigirSesion\(req, res, \{ permitirCron: true \}\)/.test(sendPush),
   'send-push acepta la sesión del navegador Y el cron del server');
ok(!/Access-Control-Allow-Origin['"],\s*['"]\*/.test(sendPush),
   'send-push ya no se puede llamar desde cualquier página (se fue el CORS *)');

const tg = sinComentarios(leer('api/telegram-notify.js'));
ok(/import\s*\{[^}]*exigirSesion[^}]*\}\s*from\s*'\.\/_auth\.js'/.test(tg),
   'telegram-notify importa el guardia');
// El guardia tiene que estar ANTES de leer el token del bot, no después.
ok(antesQue(tg, 'exigirSesion(req, res)', 'process.env.TELEGRAM_BOT_TOKEN'),
   'telegram-notify corta antes de tocar las credenciales del bot');

const ai = sinComentarios(leer('api/ai.js'));
ok(/corteSiNoAutorizadoEdge/.test(ai), 'ai.js importa el guardia de edge');
ok(antesQue(ai, 'corteSiNoAutorizadoEdge(req)', 'process.env.ANTHROPIC_API_KEY'),
   'ai.js corta antes de tocar la API key de Anthropic');
ok(/runtime:\s*'edge'/.test(ai),
   'ai.js sigue en edge (en node el plan gratis corta a los 10s y la carga masiva tarda más)');

// El webhook de Telegram no se tocó: ya tenía lo suyo.
const hook = sinComentarios(leer('api/telegram-webhook.js'));
ok(/x-telegram-bot-api-secret-token/.test(hook),
   'telegram-webhook conserva su propio secreto');

// ── La allowlist ──
const auth = leer('api/_auth.js');
const rules = leer('firestore.rules');
const uidEnAuth  = (auth.match(/'([A-Za-z0-9]{20,})'/) || [])[1];
const uidEnRules = (rules.match(/'([A-Za-z0-9]{20,})'/) || [])[1];
ok(!!uidEnAuth && uidEnAuth === uidEnRules,
   'la allowlist de /api usa el mismo UID que firestore.rules',
   { api: uidEnAuth, rules: uidEnRules });
ok(/ALLOWED_UIDS/.test(auth),
   'se puede ampliar la allowlist por env var sin tocar código');

// ════════════════════════════════════════════════════════════
//  2) El navegador manda el token (utils.js → apiFetch)
// ════════════════════════════════════════════════════════════
console.log('\n  ── apiFetch en el navegador ──');

let LLAMADAS = [], WARNS = [], STATUS = 200, HAY_SESION = true;

const ctx = {
  console: Object.assign(Object.create(console), {
    warn: (...a) => { WARNS.push(a.join(' ')); },
  }),
  setTimeout, clearTimeout,
  document: { getElementById: () => null },
  window: {},
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  navigator: { userAgent: 'node' },
  crypto: require('crypto').webcrypto,
  fetch: async (url, opts) => {
    LLAMADAS.push({ url, opts });
    return { ok: STATUS < 400, status: STATUS, json: async () => ({}) };
  },
  // Sesión de Firebase falsa
  _fbAuth: () => ({
    currentUser: HAY_SESION ? { getIdToken: async () => 'TOKEN-DE-PRUEBA' } : null,
  }),
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('utils.js'), ctx, { filename: 'utils.js' });
const run = code => vm.runInContext(code, ctx);

(async () => {
  // Con sesión: va el header
  LLAMADAS = [];
  await run("apiFetch('/api/send-push', { method: 'POST', body: '{}' })");
  ok(LLAMADAS.length === 1, 'apiFetch llamó al endpoint');
  ok(LLAMADAS[0].opts.headers['Authorization'] === 'Bearer TOKEN-DE-PRUEBA',
     'apiFetch manda el token de sesión', LLAMADAS[0].opts.headers);
  ok(LLAMADAS[0].opts.headers['Content-Type'] === 'application/json',
     'apiFetch conserva el Content-Type');
  ok(LLAMADAS[0].opts.method === 'POST' && LLAMADAS[0].opts.body === '{}',
     'apiFetch no toca el resto de las opciones');

  // Sin sesión: no rompe, simplemente no manda token (el server contesta 401)
  HAY_SESION = false; LLAMADAS = [];
  await run("apiFetch('/api/send-push', { method: 'POST' })");
  ok(!('Authorization' in LLAMADAS[0].opts.headers),
     'sin sesión abierta no inventa un token');
  HAY_SESION = true;

  // Un 401 tiene que dejar rastro en la consola: varias de estas llamadas son
  // fire-and-forget y si no avisaran, un rechazo se vería como "dejó de andar".
  WARNS = []; STATUS = 401;
  await run("apiFetch('/api/telegram-notify', { method: 'POST' })");
  ok(WARNS.some(w => /401/.test(w)), 'un 401 queda avisado en la consola', WARNS);
  STATUS = 200;

  // tgNotify pasa por apiFetch (era el que llamaba con fetch pelado)
  LLAMADAS = [];
  run("tgNotify('hola')");
  await new Promise(r => setTimeout(r, 0));
  ok(LLAMADAS.length === 1 && LLAMADAS[0].url === '/api/telegram-notify',
     'tgNotify sigue avisando a Telegram', LLAMADAS[0]);
  ok(LLAMADAS[0].opts.headers['Authorization'] === 'Bearer TOKEN-DE-PRUEBA',
     'tgNotify ahora manda el token');

  // ══════════════════════════════════════════════════════════
  //  3) Nadie quedó llamando a /api con fetch pelado
  // ══════════════════════════════════════════════════════════
  console.log('\n  ── El resto de la app ──');

  const delCliente = fs.readdirSync(raiz('.'))
    .filter(f => f.endsWith('.js') && !f.startsWith('sw.'));
  delCliente.forEach(f => {
    const src = leer(f);
    const pelado = /fetch\(\s*['"`]\/api\//.test(src);
    ok(!pelado, `${f} no llama a /api con fetch pelado`);
  });

  const webpush = leer('webpush.js');
  ok((webpush.match(/apiFetch\('\/api\/send-push'/g) || []).length === 2,
     'webpush.js manda los dos pushes con apiFetch');
  const appjs = leer('app.js');
  ok((appjs.match(/apiFetch\('\/api\/ai'/g) || []).length === 3,
     'app.js manda las tres consultas de IA con apiFetch');

  console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
  process.exit(fails ? 1 : 0);
})();
