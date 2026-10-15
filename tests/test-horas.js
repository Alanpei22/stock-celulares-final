// ⏰ Horas del personal: fichar entrada y salida desde el celu.
//
// Lo que pidió Alan: solo contar horas (sin horario fijo), el local cierra a
// las 19:30 sí o sí, y aviso por Telegram. Fichan con su celu escaneando un QR
// pegado en el local: si dependía de la compu, hasta que se prende se perdía
// tiempo.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');
const modulo = src => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

const ctx = { console, Math, Date, JSON, Number, String, Array, Object, Set, isNaN };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(leer('horas.js'), ctx, { filename: 'horas.js' });
const run = (c, v) => { ctx._v = v; return vm.runInContext(c, ctx); };
// Hora argentina → milisegundos
const ms = (dia, hh) => Date.parse(`${dia}T${hh}:00-03:00`);
const F = (uid, tipo, dia, hh, extra) => Object.assign({ uid, nombre: uid, tipo, ts: ms(dia, hh) }, extra || {});
const D = '2026-10-13';
const DESPUES = ms('2026-10-14', '10:00');   // "ahora": el día siguiente

(async () => {

console.log('\n1) Las horas se cuentan de entrada a salida');
let t = run('horasTurnos(_v, ' + DESPUES + ')', [F('nacho', 'entrada', D, '09:07'), F('nacho', 'salida', D, '18:02')]);
ok(t.length === 1 && t[0].min === 535, '9:07 → 18:02 = 8 h 55 min', t.map(x => x.min));
ok(run('horasFmt(535)') === '8 h 55 min' && run('horasFmt(45)') === '45 min', 'y se muestra como se lee');
t = run('horasTurnos(_v, ' + DESPUES + ')', [F('nacho', 'entrada', D, '09:00'), F('nacho', 'salida', D, '13:00'),
                                            F('nacho', 'entrada', D, '14:00'), F('nacho', 'salida', D, '18:00')]);
ok(t.length === 2 && t[0].min + t[1].min === 480, 'con un corte al mediodía, se suman los dos tramos');
// Tocó dos veces "Entrada": vale la primera
t = run('horasTurnos(_v, ' + DESPUES + ')', [F('nacho', 'entrada', D, '09:00'), F('nacho', 'entrada', D, '09:01'), F('nacho', 'salida', D, '10:00')]);
ok(t.length === 1 && t[0].min === 60, 'dos entradas seguidas: vale la primera');
t = run('horasTurnos(_v, ' + DESPUES + ')', [F('nacho', 'salida', D, '18:00')]);
ok(t.length === 1 && t[0].sinEntrada && t[0].min === 0, 'una salida sin entrada no suma, y queda marcada para revisar');
t = run('horasTurnos(_v, ' + DESPUES + ')', [F('nacho', 'entrada', D, '09:00'), F('nacho', 'salida', D, '18:00'),
                                            F('mati', 'entrada', D, '10:00'), F('mati', 'salida', D, '12:00')]);
const per = run('horasPorPersona(_v)', t);
ok(per.length === 2 && per.find(p => p.uid === 'nacho').min === 540 && per.find(p => p.uid === 'mati').min === 120,
   'cada uno con lo suyo');

console.log('\n2) El local cierra a las 19:30 sí o sí');
t = run('horasTurnos(_v, ' + DESPUES + ')', [F('nacho', 'entrada', D, '09:00'), F('nacho', 'salida', D, '20:15')]);
ok(t[0].min === 630 && t[0].tope, 'una salida a las 20:15 cuenta hasta las 19:30', t[0]);
t = run('horasTurnos(_v, ' + DESPUES + ')', [F('nacho', 'entrada', D, '09:00')]);
ok(t[0].min === 630 && t[0].sinSalida, 'si no fichó la salida, se cuenta hasta las 19:30 (y se marca)', t[0]);
t = run('horasTurnos(_v, ' + ms(D, '12:00') + ')', [F('nacho', 'entrada', D, '09:00')]);
ok(t[0].enCurso && t[0].min === 180, 'hoy, antes del cierre: está trabajando, van 3 h', t[0]);
t = run('horasTurnos(_v, ' + DESPUES + ')', [F('nacho', 'entrada', D, '19:45'), F('nacho', 'salida', D, '20:00')]);
ok(t[0].min === 0, 'después del cierre no suma nada');

console.log('\n3) La hora que vale');
// La corrige el dueño: la original queda guardada, manda la corregida
t = run('horasTurnos(_v, ' + DESPUES + ')', [F('nacho', 'entrada', D, '09:00'),
                                            F('nacho', 'salida', D, '19:30', { tsCorregido: ms(D, '17:00'), corregido: true })]);
ok(t[0].min === 480, 'la corrección del dueño gana', t[0].min);
// Las de Firestore vienen como Timestamp
const ts = n => ({ toMillis: () => n });
ok(run('horasMs(_v)', { ts: ts(123) }) === 123 && run('horasMs(_v)', { tsCel: 5 }) === 5,
   'lee los Timestamp de Firebase (y la hora del celu solo mientras no llegó la otra)');
// Medianoche argentina = 03:00 UTC: una entrada a las 22 AR es de ese día
ok(run('horasDia(_v)', ms(D, '22:00')) === D && run('horasHora(_v)', ms(D, '09:07')) === '09:07', 'días y horas en hora argentina');

console.log('\n4) Dónde estaba al fichar');
const LOCAL = { lat: -34.6, lng: -58.56, radio: 150 };
ctx.__L = LOCAL;
ok(run('horasLugar(_v, __L)', { lat: -34.6003, lng: -58.5601, prec: 20 }) === 'local', 'a ~35 m: en el local');
ok(run('horasLugar(_v, __L)', { lat: -34.62, lng: -58.56, prec: 20 }) === 'lejos', 'a 2 km: lejos');
ok(run('horasDistTxt(horasDistM(_v, __L))', { lat: -34.62, lng: -58.56 }) === '2,2 km', 'y dice a cuánto', run('horasDistTxt(horasDistM(_v, __L))', { lat: -34.62, lng: -58.56 }));
ok(run('horasLugar(_v, __L)', { lat: -34.6025, lng: -58.56, prec: 200 }) === 'local',
   'con GPS impreciso (200 m de error) a 280 m: se le da el beneficio de la duda');
ok(run('horasLugar(_v, __L)', { sinUbicacion: true }) === 'sin', 'sin permiso de ubicación: se marca');
ok(run('horasLugar(_v, null)', { lat: -34.62, lng: -58.56 }) === 'nofijado', 'si el local todavía no está fijado, no acusa a nadie');
ok(run('horasLugar(_v, __L)', { manual: true }) === 'manual', 'las cargadas a mano se ven como tales');

console.log('\n5) Períodos');
const HOY = ms('2026-10-15', '11:00');   // jueves
ok(JSON.stringify(run(`horasPeriodo('semana', ${HOY})`)) === '["2026-10-12","2026-10-15"]', 'esta semana: desde el lunes');
ok(JSON.stringify(run(`horasPeriodo('semanaPasada', ${HOY})`)) === '["2026-10-05","2026-10-11"]', 'la pasada: lunes a domingo');
ok(JSON.stringify(run(`horasPeriodo('mes', ${HOY})`)) === '["2026-10-01","2026-10-15"]', 'este mes');
ok(JSON.stringify(run(`horasPeriodo('mesPasado', ${HOY})`)) === '["2026-09-01","2026-09-30"]', 'el mes pasado entero');

console.log('\n6) No se puede hacer trampa');
const rules = leer('firestore.rules');
const bloque = rules.slice(rules.indexOf('match /fichadas/{doc}'), rules.indexOf('}', rules.indexOf('allow update, delete', rules.indexOf('match /fichadas/{doc}'))));
ok(/request\.resource\.data\.ts == request\.time/.test(bloque), 'la hora la pone Firebase: atrasar el reloj del celu no sirve');
ok(/request\.resource\.data\.uid == request\.auth\.uid/.test(bloque), 'cada uno ficha por sí mismo, no por otro');
ok(/allow update, delete: if esDueno\(\);/.test(bloque), 'una fichada hecha solo la toca el dueño');
ok(/!\('tsCorregido' in request\.resource\.data\)/.test(bloque) && /!\('manual' in request\.resource\.data\)/.test(bloque),
   'el empleado no puede cargar una "corregida" ni una "a mano"');
ok(/resource\.data\.uid == request\.auth\.uid/.test(bloque.slice(0, bloque.indexOf('allow create'))), 'y solo ve las suyas');
ok(/'fichadas'/.test(rules.slice(rules.indexOf('function sensible('), rules.indexOf(']', rules.indexOf('function sensible(')))),
   'está en sensible(): la regla general no se la abre');
ok(/match \/config\/fichar \{\s*allow read: if isAllowed\(\);\s*allow write: if esDueno\(\);/.test(rules),
   'la ubicación del local la mueve solo el dueño (si no, se la corre a su casa)');
const fj = leer('fichar.js');
ok(/ts: firebase\.firestore\.FieldValue\.serverTimestamp\(\)/.test(fj), 'fichar.js manda la hora del servidor');
ok(/where\('uid', '==', user\.uid\)/.test(fj), 'y lee solo las propias (lo que las reglas dejan)');
ok(/\/api\/telegram-notify/.test(fj), 'cada fichada le llega por Telegram al dueño');

console.log('\n7) Lo que queda sin salida, por Telegram a las 20:00');
const cron = leer('api/cron-cierre-pendiente.js');
const m = await modulo(cron.replace(/^import .*$/m, 'const admin = {};'));
const q = m.sinSalida([F('nacho', 'entrada', D, '09:00'), F('mati', 'entrada', D, '10:00'), F('mati', 'salida', D, '18:00')]
  .map(f => Object.assign({}, f, { ts: ts(f.ts) })));
ok(q.length === 1 && q[0].nombre === 'nacho', 'avisa solo de los que siguen "adentro"', q);
ok(/'0 23 \* \* \*'/.test(leer('.github/workflows/notifications-cron.yml')) && /"fichadas":true/.test(leer('.github/workflows/notifications-cron.yml')),
   'lo dispara GitHub a las 20:00 (23 UTC)');

console.log('\n8) Enganchado en la app');
ok(/label: 'Horas del personal'/.test(leer('app.js')), 'está en el menú ☰ (solo dueño)');
ok(/src="horas\.js"/.test(leer('index.html')) && /src="horas\.js"/.test(leer('fichar.html')), 'las dos pantallas usan las mismas cuentas');
ctx.qrSvg = () => '<svg/>';
const cartel = run("horasCartelHtml('https://x.app/fichar.html')");
ok(/Fichá acá/.test(cartel) && /<svg/.test(cartel), 'el cartel con el QR para pegar en la pared');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})().catch(e => { console.error('Error:', e); process.exit(1); });
