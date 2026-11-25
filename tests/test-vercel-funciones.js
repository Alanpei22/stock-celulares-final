// 🚦 Que Vercel acepte el deploy. Alan (25/11): "no me aparece lo del control".
// El plan gratis de Vercel acepta hasta 12 funciones por deploy. El 22/11, con
// /api/accesorios, pasamos a 13 y desde ahí Vercel rechazaba TODOS los deploys:
// ningún cambio llegaba a los celus y nadie se enteraba. Esta prueba falla
// antes de subir si se pasa del límite.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const LIMITE = 12;
// Lo que Vercel cuenta como función: cada archivo de /api que no empieza con "_"
const funciones = fs.readdirSync(DIR + 'api').filter(f => /\.(js|mjs|ts)$/.test(f) && !f.startsWith('_'));
console.log('\n1) No pasar de ' + LIMITE + ' funciones');
ok(funciones.length <= LIMITE, `${funciones.length} funciones (el máximo del plan gratis es ${LIMITE}). Si hace falta una nueva, que sea una tarea de una que ya existe (como api/cron.js) o un "_ayudante"`, funciones);
ok(funciones.length <= LIMITE - 1, 'y queda lugar para una más sin que se rompa el deploy', funciones.length);

console.log('\n2) Las direcciones viejas siguen andando');
const v = JSON.parse(leer('vercel.json'));
const rw = Object.fromEntries((v.rewrites || []).map(r => [r.source, r.destination]));
ok(rw['/api/accesorios'] === '/api/equipos?tipo=accesorios', '/api/accesorios la atiende /api/equipos');
['cierre-pendiente', 'reparaciones-demoradas', 'resumen-diario', 'resumen-telegram'].forEach(t =>
  ok(rw['/api/cron-' + t] === '/api/cron?tarea=' + t, `/api/cron-${t} → /api/cron?tarea=${t}`));
// Lo que vercel.json configura tiene que existir (si no, Vercel también rechaza el deploy)
Object.keys(v.functions || {}).forEach(f => ok(fs.existsSync(DIR + f), `vercel.json configura ${f}, y existe`));

console.log('\n3) Cada tarea apunta a un archivo que existe');
const cron = leer('api/cron.js');
const tareas = [...cron.matchAll(/import\('\.\/(_cron-[\w-]+\.js)'\)/g)].map(m => m[1]);
ok(tareas.length === 4 && tareas.every(f => fs.existsSync(DIR + 'api/' + f)), 'api/cron.js: las 4 tareas existen', tareas);
ok(/CRON_SECRET/.test(cron) && /status\(401\)/.test(cron), 'y pide el CRON_SECRET antes de hacer nada');
ok(/import\('\.\/_accesorios\.js'\)/.test(leer('api/equipos.js')) && fs.existsSync(DIR + 'api/_accesorios.js'), 'api/equipos.js carga los accesorios de api/_accesorios.js');
ok(/fetch\('\/api\/equipos\?tipo=accesorios'/.test(leer('accesorios.js')), 'la página /accesorios pide a /api/equipos?tipo=accesorios');

console.log('\n4) Los GitHub Actions llaman a direcciones que existen');
const wfs = fs.readdirSync(DIR + '.github/workflows').map(f => leer('.github/workflows/' + f)).join('\n');
const llamadas = [...wfs.matchAll(/\$BASE_URL(\/api\/[\w-]+)(\?[^"\s]*)?/g)].map(m => m[1]);
ok(llamadas.length > 0 && llamadas.every(u => funciones.includes(u.slice(5) + '.js') || rw[u]), 'cada curl de los workflows va a una función o a una dirección redirigida', llamadas);

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
