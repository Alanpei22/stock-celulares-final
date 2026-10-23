// El estado de cada día: "Hoy lunes, ya estamos abiertos".
//
// Son SIETE IMÁGENES FIJAS, no una por día: el lunes dice lo mismo todos los
// lunes. Se generan una vez desde la app y el aviso de cada mañana solo manda
// la que toca. Por eso acá se prueban dos cosas separadas: lo que dice cada
// imagen, y a quién y cuándo le toca salir.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

// ── estados.js, con un DOM de mentira ─────────────────────
const ctx = {
  console, Math, JSON, Date, Number, String, Object, Array, isFinite, parseInt, parseFloat,
  setTimeout: f => f(), clearTimeout,
  document: { getElementById: () => null, querySelectorAll: () => [],
              createElement: () => ({ style: {}, setAttribute() {}, remove() {} }),
              body: { style: {}, appendChild() {} } },
  window: {}, localStorage: { getItem: () => null, setItem() {} },
  BIZ_IMAGE: 'data:image/png;base64,AAAA',
  BIZ_DATA: { dir: 'J.J. de Urquiza 4741 — Local 22', tel: '11 7239-2511' },
  db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }) }) },
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(leer('estados.js'), ctx, { filename: 'estados.js' });
const run = e => vm.runInContext(e, ctx);
const call = (f, ...a) => { ctx.__a = a; return run(`${f}(...__a)`); };
const DIAS = run('EST_DIAS');

console.log('\n1) Qué día es, en hora argentina');
// Argentina es UTC-3 todo el año. A las 23:30 de un domingo en Argentina, en
// Londres ya es lunes: si se mira la hora del servidor, el estado sale con el
// día equivocado.
const domNoche = Date.parse('2026-10-26T02:30:00Z');     // domingo 23:30 AR
ok(call('estDiaDe', domNoche).k === 'dom', 'domingo a las 23:30 sigue siendo domingo', call('estDiaDe', domNoche));
const lunCero = Date.parse('2026-10-26T03:10:00Z');      // lunes 00:10 AR
ok(call('estDiaDe', lunCero).k === 'lun', 'y a las 00:10 ya es lunes', call('estDiaDe', lunCero));
ok(DIAS.length === 7 && DIAS[0].k === 'dom', 'los días arrancan en domingo, como getDay()', DIAS.map(d => d.k));

console.log('\n2) Lo que dice la imagen');
const CFG = { color: '#0040FF', titulo: '¡YA ESTAMOS ABIERTOS!',
              horarios: { lun: '9 a 19:30', sab: '9 a 13:30', dom: '' } };
const lun = call('estDocumento', DIAS[1], CFG);
ok(/LUNES/.test(lun), 'el día, en el cartel');
ok(/YA ESTAMOS ABIERTOS/.test(lun), 'el texto grande');
ok(/9 a 19:30/.test(lun), 'y el horario de ese día');
ok(/Urquiza 4741/.test(lun) && /7239-2511/.test(lun), 'con la dirección y el teléfono del local');
ok(/src="data:image\/png/.test(lun), 'el logo va metido adentro, no por internet');

// Cada día el suyo.
ok(/13:30/.test(call('estDocumento', DIAS[6], CFG)), 'el sábado lleva su propio horario');

console.log('\n3) El día que no se abre');
const dom = call('estDocumento', DIAS[0], CFG);
ok(/HOY CERRADO/.test(dom), 'sin horario cargado, dice cerrado');
// Se mira el div, no el archivo: la regla `.st--cerrado` está en el CSS de
// los dos y una búsqueda suelta no se entera si al div le falta la clase.
const divDe = d => (d.match(/<div class="st[^"]*"/) || [''])[0];
ok(/st--cerrado/.test(divDe(dom)), 'y cambia de color: no puede salir de fiesta', divDe(dom));
ok(!/st--cerrado/.test(divDe(lun)), 'el día que abre no', divDe(lun));
ok(!/Horario de hoy/.test(dom), 'sin el recuadro del horario');
ok(/\.st--cerrado\{background:#3E3E52\}/.test(dom), 'el color de cerrado existe de verdad');

console.log('\n4) La medida y el lugar de los botones');
// Una historia es 1080×1920. Arriba y abajo las apps ponen sus botones
// encima: lo que se escriba ahí queda tapado.
ok(/width:1080px;height:1920px/.test(lun), 'mide 1080 × 1920', (lun.match(/width:\d+px;height:\d+px/) || [])[0]);
ok(/padding:260px 70px/.test(lun), 'y deja libre arriba y abajo para los botones de la app');

console.log('\n5) Los textos largos entran igual');
// El cartel del día es de ancho fijo: "MIÉRCOLES" no puede salirse.
const EM = 0.58, ANCHO = 620;
DIAS.forEach(d => {
  const tam = call('_estTam', d.lbl, 128, ANCHO, EM);
  ok(d.lbl.length * EM * tam <= ANCHO + 1, `"${d.lbl}" entra en el cartel`, tam);
});
ok(call('_estTam', 'LUNES', 128, ANCHO, EM) > call('_estTam', 'MIÉRCOLES', 128, ANCHO, EM),
   'el día más largo sale más chico');
ok(call('_estTam', 'UNA FRASE MUCHO MÁS LARGA QUE LA OTRA', 86, 940, 0.56) >= 28,
   'y nunca baja de un tamaño que se lea');

console.log('\n6) A quién le toca salir, y cuándo');
// Esta parte vive en la función del server: el cron pega cada hora y ella
// decide. Se saca el pedazo y se corre suelto, sin firebase.
const api = leer('api/estado-dia.js');
const apiCtx = { console, Date, Number, Math };
apiCtx.globalThis = apiCtx;
vm.createContext(apiCtx);
vm.runInContext(api.slice(api.indexOf('export const EST_DIAS'), api.indexOf('export default'))
                   .replace(/export /g, ''), apiCtx, { filename: 'estado-dia.js' });
const toca = (cfg, h, d) => { apiCtx.__c = cfg; apiCtx.__a = { hora: h, dia: d }; return vm.runInContext('estLeToca(__c, __a)', apiCtx); };
const URLS = { urls: { lun: 'https://x/lun.jpg' }, hora: 10, activo: true };

ok(toca(URLS, 10, 'lun').ok === true, 'a las 10 de un lunes, sale');
ok(toca(URLS, 11, 'lun').ok === false, 'a las 11 no: el cron pega todas las horas', toca(URLS, 11, 'lun'));
ok(toca({ ...URLS, activo: false }, 10, 'lun').ok === false, 'apagado, no sale');
ok(toca(URLS, 10, 'mar').ok === false, 'y si falta la imagen de ese día, tampoco', toca(URLS, 10, 'mar'));
ok(/falta generar/.test(toca(URLS, 10, 'mar').por), 'diciendo que falta generarla', toca(URLS, 10, 'mar').por);
ok(toca(null, 10, 'lun').ok === false, 'sin configurar, no hace nada');

// La hora del server es UTC: si se usa esa, el aviso sale tres horas antes.
apiCtx.__ms = Date.parse('2026-10-26T13:00:00Z');   // 10:00 AR
ok(vm.runInContext('estAhoraAR(__ms).hora', apiCtx) === 10, 'las 13 UTC son las 10 acá',
   vm.runInContext('estAhoraAR(__ms).hora', apiCtx));
ok(vm.runInContext('estAhoraAR(__ms).dia', apiCtx) === 'lun', 'y es lunes');

console.log('\n7) Enganchado en la app');
const idx = leer('index.html');
ok(/estados\.js/.test(idx), 'el script se carga');
ok(/id="estados-modal"/.test(idx), 'y el cuadro está en la página');
ok(/estAbrir\(\)/.test(leer('app.js')), 'se entra desde el menú de Inicio');
// Las imágenes se suben a Storage y Telegram las baja por la URL: sin esta
// regla, el `put` falla y no hay estado.
ok(/match \/estados\/\{filename\}/.test(leer('storage.rules')), 'Storage deja subirlas');
ok(/allow read: if true/.test(leer('storage.rules').split('match /estados/')[1].slice(0, 200)),
   'y se pueden leer por la URL, que es como las baja Telegram');
const wf = leer('.github/workflows/notifications-cron.yml');
ok(/cron: '0 \* \* \* \*'/.test(wf), 'el cron pega cada hora');
ok(/api\/estado-dia/.test(wf), 'contra la función del estado');
// Sin el secreto, cualquiera con la URL te manda estados al Telegram.
ok(/CRON_SECRET/.test(api) && /exigirSesion/.test(api),
   'y la función pide el secreto del cron o sesión de la app');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
