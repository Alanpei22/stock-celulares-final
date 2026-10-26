// La clave del script de Gmail (aviso de transferencias de MercadoPago).
//
// Alan no podía copiar el CRON_SECRET de Vercel (está oculto), así que el
// script usa su propia clave, AVISOS_SECRET. Lo que se cuida: que sirva solo
// donde se usa (push y Telegram), que no rompa los crons, y que una clave
// corta no valga.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const src = leer('api/_auth.js');
const fn = src.slice(src.indexOf('export function esCron'), src.indexOf('\n}\n', src.indexOf('export function esCron')) + 3).replace('export function', 'function');
const env = {};
const ctx = { process: { env } };
vm.createContext(ctx);
vm.runInContext(fn + '\nthis.esCron = esCron;', ctx);
const pide = clave => ctx.esCron({ headers: { authorization: 'Bearer ' + clave } });

env.CRON_SECRET = 'corto';
ok(pide('corto'), 'el CRON_SECRET de siempre sigue andando (aunque sea corto)');
ok(!pide('otra'), 'una clave cualquiera no');
env.AVISOS_SECRET = 'ClaveDelScriptDeGmail2026';
ok(pide('ClaveDelScriptDeGmail2026') && pide('corto'), 'la clave del script vale, y la de los crons también');
env.AVISOS_SECRET = 'abc123';
ok(!pide('abc123'), 'una clave del script corta no vale (se adivina)');
delete env.CRON_SECRET; delete env.AVISOS_SECRET;
ok(!pide('') && !pide('undefined'), 'sin claves cargadas, nada pasa');
ok(!ctx.esCron({ headers: {} }), 'sin header, nada pasa');

// Solo donde se usa esCron: push y Telegram. Los crons comparan CRON_SECRET aparte.
const usan = fs.readdirSync(DIR + 'api').filter(f => f.endsWith('.js') && f !== '_auth.js' && /esCron|permitirCron: true/.test(leer('api/' + f)));
ok(usan.sort().join() === 'send-push.js,telegram-notify.js', 'la clave del script solo sirve para mandar push y Telegram', usan);
ok(/AVISOS_SECRET/.test(leer('tools/gmail-aviso-mp.gs')) && !/PEGAR_ACA_EL_CRON_SECRET/.test(leer('tools/gmail-aviso-mp.gs')), 'el script explica la clave nueva');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
