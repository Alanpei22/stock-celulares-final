// Retirar una reparación y llevarse un vidrio en el mismo cobro.
//
// Alan: "si retiran una reparación y se lleva un vidrio o una funda, no me
// deja agregarlo en la misma venta". Al vincular la reparación, la app
// escribía "Reparación N°… — cliente — equipo" en el MISMO campo donde se
// busca el producto: escribir "vidrio" quedaba pegado a ese texto y no
// encontraba nada.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const caja = fs.readFileSync(DIR + 'caja.js', 'utf8');
const sel = caja.slice(caja.indexOf('function _selectRepairMode'), caja.indexOf('function _repairCardHtml'));

console.log('\n1) Al vincular la reparación, el buscador queda libre');
ok(!/descEl\.value = _repairDescAuto/.test(sel), 'ya no se llena el buscador con el texto de la reparación');
ok(/descEl\.value = '';/.test(sel) && /¿Se lleva algo más\?/.test(sel), 'queda vacío, invitando a sumar vidrio o funda');
ok(/\|\| \(_selectedRepairItem \? _repairDescAuto : ''\)/.test(caja), 'y la descripción del cobro sale igual de la reparación');
const clr = caja.slice(caja.indexOf('function _clearRepairItem'), caja.indexOf('async function saveMov'));
ok(/placeholder = 'Buscá producto \/ repuesto o escribí qué fue \*'/.test(clr), 'al desvincularla, el buscador vuelve a lo de siempre');

console.log('\n2) Sumar el vidrio no le cambia la categoría al retiro');
ok(/if \(!_selectedRepairItem\) selectCat\('Venta producto'\);/.test(caja), 'sigue siendo Reparación: cuenta como reparación en el desglose');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
