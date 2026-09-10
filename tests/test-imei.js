// Validación de IMEI (15 dígitos + verificador Luhn).
// Un IMEI mal tipeado se arrastra a la boleta, a la garantía y al día que
// haya que consultarlo en la blacklist. Con Luhn se agarra el error de tipeo
// más común: un dígito cambiado o dos dados vuelta.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const ctx = { console };
ctx.globalThis = ctx; vm.createContext(ctx);
const utils = fs.readFileSync(DIR + 'utils.js', 'utf8');
vm.runInContext(utils.slice(utils.indexOf('function imeiDigitos')), ctx, { filename: 'utils.js' });
const est = v => vm.runInContext('imeiEstado(' + JSON.stringify(v) + ')', ctx);
const luhn = v => vm.runInContext('imeiLuhnOk(' + JSON.stringify(v) + ')', ctx);

console.log('\n1) IMEI de verdad: pasan');
// Números reales de referencia (el de la spec y uno de prueba conocido)
['356938035643809', '490154203237518', '013977000272504', '351678035680105'].forEach(i =>
  ok(est(i).ok === true, `${i} es válido`, est(i)));

console.log('\n2) Lo que se rechaza');
ok(est('123').ok === false, 'muy corto');
ok(/3\/15 dígitos/.test(est('123').msg), 'y dice cuántos faltan', est('123').msg);
ok(est('35693803564380').ok === false, '14 dígitos: le falta uno');
ok(est('3569380356438099').ok === false, '16 dígitos: le sobra uno');
ok(/16 dígitos/.test(est('3569380356438099').msg), 'y lo dice', est('3569380356438099').msg);
ok(est('356789102345678').ok === false, 'un número inventado de 15 dígitos NO pasa el verificador');
ok(/no cierra/.test(est('356789102345678').msg), 'y explica que revise *#06#', est('356789102345678').msg);

console.log('\n3) El error de tipeo típico');
// Cambiar UN dígito del IMEI válido tiene que romper el verificador
const bueno = '356938035643809';
let atrapados = 0;
for (let i = 0; i < 15; i++) {
  for (let d = 0; d <= 9; d++) {
    const malo = bueno.slice(0, i) + d + bueno.slice(i + 1);
    if (malo === bueno) continue;
    if (!est(malo).ok) atrapados++;
  }
}
ok(atrapados === 135, 'cambiar cualquier dígito por otro se detecta SIEMPRE (135 de 135)', atrapados);
// Dos dígitos consecutivos dados vuelta
let vueltos = 0, probados = 0;
for (let i = 0; i < 14; i++) {
  if (bueno[i] === bueno[i + 1]) continue;
  probados++;
  const malo = bueno.slice(0, i) + bueno[i + 1] + bueno[i] + bueno.slice(i + 2);
  if (!est(malo).ok) vueltos++;
}
ok(vueltos >= probados - 1, 'y dar vuelta dos dígitos casi siempre también', { vueltos, probados });

console.log('\n4) Vacío es válido: el IMEI no es obligatorio');
['', null, undefined, '   '].forEach(v =>
  ok(est(v).ok === true && est(v).vacio === true, `${JSON.stringify(v)} no molesta`, est(v)));

console.log('\n5) Tolera cómo lo escribe la gente');
ok(est('35-693803-564380-9').ok === true, 'con guiones');
ok(est(' 356938035643809 ').ok === true, 'con espacios');
ok(vm.runInContext("imeiDigitos('35 6938-035643809')", ctx) === '356938035643809', 'imeiDigitos limpia todo');

console.log('\n6) No bloquea: avisa y pregunta');
// El cliente está en el mostrador. Si el número no cierra igual se puede
// guardar, pero después de un aviso explícito.
let PREGUNTO = null;
const ctx2 = { console, confirm: m => { PREGUNTO = m; return false; } };
ctx2.globalThis = ctx2; vm.createContext(ctx2);
vm.runInContext(utils.slice(utils.indexOf('function imeiDigitos')), ctx2);
ok(vm.runInContext("imeiConfirmar('356938035643809')", ctx2) === true, 'con un IMEI válido no pregunta nada');
ok(PREGUNTO === null, 'ni molesta');
ok(vm.runInContext("imeiConfirmar('123', 'IMEI')", ctx2) === false, 'con uno malo, si decís que no, frena');
ok(/no parece válido/.test(PREGUNTO || ''), 'y el aviso lo explica', PREGUNTO);
ok(/\*#06#/.test(PREGUNTO || ''), 'con cómo verlo en el equipo');
ctx2.confirm = () => true;
ok(vm.runInContext("imeiConfirmar('123')", ctx2) === true, 'pero si insistís, deja guardar');

console.log('\n7) Está enganchado donde se carga un IMEI');
const app = fs.readFileSync(DIR + 'app.js', 'utf8');
const rep = fs.readFileSync(DIR + 'repairs.js', 'utf8');
const caja = fs.readFileSync(DIR + 'caja.js', 'utf8');
const idx = fs.readFileSync(DIR + 'index.html', 'utf8');
ok(/imeiWatch\('fi-imei'\)/.test(app), 'alta de stock: aviso en vivo');
ok(/imeiWatch\('rep-fi-imei'\)/.test(app), 'ingreso de reparación: aviso en vivo');
ok(/imeiWatch\('ve-imei'\)/.test(caja) && /imeiWatch\('ve-imei2'\)/.test(caja), 'venta de equipo: los dos IMEI');
ok(/imeiConfirmar\(imei, 'IMEI'\)/.test(app), 'y pregunta al guardar el stock');
ok(/imeiConfirmar\(imei, 'IMEI'\)/.test(rep), 'al guardar la reparación');
ok(/imeiConfirmar\(d\.imei, 'IMEI'\)/.test(caja) && /imeiConfirmar\(d\.imei2/.test(caja), 'y al vender');

console.log('\n8) La app no enseña un IMEI inválido de ejemplo');
// Los placeholders mostraban números inventados que no pasan el verificador:
// el primero que ve el usuario tiene que ser uno bueno.
const placeholders = [...idx.matchAll(/placeholder="(\d{15})"/g)].map(m => m[1]);
ok(placeholders.length > 0, 'hay ejemplos de IMEI en los formularios', placeholders);
placeholders.forEach(p => ok(luhn(p), `el ejemplo ${p} es un IMEI válido`));

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
