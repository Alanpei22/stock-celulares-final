// 💲 El costo de una reparación, preguntado por Telegram.
// Alan (11/11): "si se rellena sin costo, ¿se me puede preguntar por Telegram
// y que se cargue?". La app pregunta; él responde ese mensaje con el número.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ctx = { console, Math, Number, String, Array, Object, JSON, parseInt, parseFloat, isFinite };
vm.createContext(ctx);
vm.runInContext(leer('api/_telegram-costos.js').replace(/^export /gm, ''), ctx, { filename: '_telegram-costos.js' });

console.log('\n1) La app pregunta');
const rp = leer('repairs.js');
const fn = (rp.match(/function _tgPreguntarCosto\(r\) \{[\s\S]*?\n\}/) || [''])[0];
const ENVIADOS = [], DBU = [];
const cx = { console, Number, String, esc: s => String(s), tgMonto: n => '$' + Number(n).toLocaleString('es-AR'),
  tgNotify: t => ENVIADOS.push(t), db: { collection: () => ({ doc: id => ({ update: d => { DBU.push([id, d]); return Promise.resolve(); } }) }) } };
vm.createContext(cx);
vm.runInContext((rp.match(/function _faltaCargarCosto\(r\) \{[\s\S]*?\n\}/) || [''])[0] + '\n' + fn, cx);
const rep = { id: 'x1', nOrden: 8412, marca: 'iPhone', modelo: '11', arreglo: 'Batería', monto: 50000 };
cx.r = rep;
vm.runInContext('_tgPreguntarCosto(r)', cx);
ok(ENVIADOS.length === 1 && /Falta el costo de la #8412/.test(ENVIADOS[0]) && /iPhone 11 — Batería/.test(ENVIADOS[0]) && /Respondé este mensaje/.test(ENVIADOS[0]), 'manda la pregunta con el N° de orden, el equipo y el arreglo', ENVIADOS[0]);
// Telegram devuelve el texto sin etiquetas: el bot tiene que reconocerlo igual
const comoLlega = ENVIADOS[0].replace(/<[^>]+>/g, '');
ok(ctx.ordenDePregunta(comoLlega) === 8412, 'y el bot saca el N° de orden de ese mismo texto', comoLlega);
vm.runInContext('_tgPreguntarCosto(r)', cx);
ok(ENVIADOS.length === 1 && DBU[0][1].costoPreguntado === true, 'una sola vez por reparación (no al quedar lista Y al entregarla)');
cx.r = { id: 'x2', nOrden: 1, costo: 5000 }; vm.runInContext('_tgPreguntarCosto(r)', cx);
cx.r = { id: 'x3', nOrden: 2, sinRepuesto: true }; vm.runInContext('_tgPreguntarCosto(r)', cx);
ok(ENVIADOS.length === 1, 'si ya tiene costo (o fue sin repuesto), no pregunta');
ok(/if \(!repuestoId && !\(costoManual > 0\)\) _tgPreguntarCosto\(r\);/.test(rp), 'pregunta al quedar lista sin repuesto ni costo');
ok(/Eligió "Entregar sin cargar el costo"[^\n]*\n\s*_tgPreguntarCosto\(r\);/.test(rp), 'y al entregar sin cargar el costo');

console.log('\n2) La respuesta');
ok(ctx.ordenDePregunta('✅ Listo para retirar #8412') === null && ctx.ordenDePregunta(undefined) === null, 'responder a otro mensaje no carga ningún costo');
const L = t => ctx.leerCosto(t);
ok(L('15000') === 15000 && L('$15.000') === 15000 && L('15k') === 15000 && L('15 mil') === 15000 && L('15 lucas') === 15000, '"15000", "$15.000", "15k", "15 mil", "15 lucas"');
ok(L('0') === 0 && L('sin repuesto') === 0 && L('nada') === 0 && L('mano de obra') === 0, '0 / "sin repuesto" / "nada" = no usó repuesto');
ok(L('hola') === null && L('') === null && L('99999999') === null && L('15000 creo') === null, 'lo que no es un número claro no carga nada');
const c = ctx.comandoCosto('costo 8412 15.000');
ok(c && c.orden === 8412 && c.resto === '15.000' && ctx.comandoCosto('costo #77 0').orden === 77 && ctx.comandoCosto('costos') === null, 'también a mano: "costo 8412 15000"');
ok(JSON.stringify(ctx.patchReparacion(15000)) === JSON.stringify({ costo: 15000, costoRepuesto: 15000, costoPorTelegram: true }), 'guarda el costo en la reparación');
const p0 = ctx.patchReparacion(0);
ok(p0.sinRepuesto === true && p0.costo === 0, 'con 0 queda "sin repuesto" (no vuelve a pedir el costo)');
let t = ctx.textoCostoCargado({ nOrden: 8412, marca: 'iPhone', modelo: '11', monto: 50000 }, 15000, 1);
ok(/Costo cargado en la #8412 iPhone 11: <b>\$15\.000<\/b>/.test(t) && /ganancia <b>\$35\.000/.test(t) && /corregí la ganancia en la caja/.test(t), 'contesta el costo, la ganancia y si corrigió la caja', t);

console.log('\n3) La ganancia de la caja: igual que en la app');
const u = leer('utils.js');
const ux = { console, Math, Number, String, Object };
vm.createContext(ux);
vm.runInContext(u.slice(u.indexOf('function repGananciaPatch'), u.indexOf('async function repActualizarCobro')), ux);
[
  [{ tipo: 'ingreso', esCobro: true, monto: 40000, gananciaARS: 40000, costoARSTotal: 0 }, { monto: 40000 }, 12000, 0],
  [{ tipo: 'ingreso', esCobro: true, gananciaARS: 28000, costoARSTotal: 12000, costoReparacionARS: 12000 }, { monto: 40000 }, 15000, 12000],
  [{ tipo: 'ingreso', esCobro: true, repairMode: 'cobro', monto: 30000, comisionTarjeta: 1200 }, { monto: 40000 }, 12000, 0],
  [{ tipo: 'ingreso', esCobro: true, gananciaARS: 40000 }, { monto: 40000 }, 0, 0],
].forEach((a, i) => {
  ux.a = a;
  const app = JSON.stringify(vm.runInContext('repGananciaPatch(a[0], a[1], a[2], a[3])', ux));
  ok(JSON.stringify(ctx.gananciaPatch(...a)) === app, `caso ${i + 1}: el bot corrige el cobro igual que la app`, app);
  ok(ctx.esCobro(a[0]) === vm.runInContext('repEsCobro(a[0])', ux), `caso ${i + 1}: y reconoce el mismo cobro`);
});
ok(!ctx.esCobro({ tipo: 'ingreso', esSena: true }), 'la seña no se toca');

console.log('\n4) Enganchado en el bot');
const hook = leer('api/telegram-webhook.js');
ok(/ordenDePregunta\(msg\.reply_to_message && msg\.reply_to_message\.text\)/.test(hook), 'mira a qué mensaje se está respondiendo');
ok(hook.indexOf('if (ordenPreg) {') > 0 && hook.indexOf('if (ordenPreg) {') < hook.indexOf("respuesta = await qRepairByOrden(db, parseInt"), 'antes de tomar el número como un N° de orden');
ok(/await doc\.ref\.update\(patchReparacion\(costo\)\)/.test(hook) && /gananciaPatch\(m\.data\(\), r, costo, costoViejo\)/.test(hook), 'carga el costo y corrige el cobro si ya estaba cobrada');
ok(/\$\{AYUDA_COSTOS\}/.test(hook), 'y está en la ayuda');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
