// Arqueo de apertura: escribir la cantidad de billetes tiene que sumar.
//
// Alan: "cuando cargo la cantidad de billetes en el arqueo de caja no se suma,
// tengo que hacerlo manualmente". Solo los botones − / + recalculaban el
// total; escribiendo el número en el casillero quedaba en $0.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const cj = fs.readFileSync(DIR + 'caja.js', 'utf8');

const filas = cj.slice(cj.indexOf('function renderArqueoRows'), cj.indexOf('function changeArqueoBillete'));
ok(/id="billete-\$\{denom\}"[^>]*oninput="updateArqueoTotal\(\)"/.test(filas), 'apertura: escribir la cantidad recalcula el total');
ok(/oninput="updateCierreTotal\(\)" onfocus="this\.select\(\)"/.test(cj) && /oninput="updateCierreUsdTotal\(\)" onfocus="this\.select\(\)"/.test(cj),
   'cierre (pesos y dólares): igual, y al tocar se selecciona el 0');

// La cuenta, con el código de verdad
const els = {};
const ctx = { document: { getElementById: id => els[id] || null }, DENOMINACIONES: [20000, 10000, 1000] };
vm.createContext(ctx);
vm.runInContext(cj.slice(cj.indexOf('function updateArqueoTotal'), cj.indexOf('async function saveArqueo')), ctx);
els['billete-20000'] = { value: '3' }; els['billete-10000'] = { value: '2' }; els['billete-1000'] = { value: '' };
['sub-20000', 'sub-10000', 'sub-1000', 'arqueo-total'].forEach(id => { els[id] = { textContent: '' }; });
vm.runInContext('updateArqueoTotal()', ctx);
ok(els['arqueo-total'].textContent.replace(/\D/g, '') === '80000', '3 de $20.000 + 2 de $10.000 = $80.000', els['arqueo-total'].textContent);

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
