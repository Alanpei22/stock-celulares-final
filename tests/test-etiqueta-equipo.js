// 📸 Cargar un equipo escaneando su etiqueta. Alan (18/11): "cuando agregue
// equipos desde el celular, poder escanear el código de barras". La etiqueta
// del proveedor: código de barras = IMEI; abajo, escrito, "iPhone 13 128GB",
// "RED", "AA", "76%".
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

console.log('\n1) Lo que contesta la IA → datos limpios (api/ai.js)');
const ai = leer('api/ai.js');
const cx = { console, String, Number, Math, JSON, RegExp };
vm.createContext(cx);
vm.runInContext(ai.slice(ai.indexOf('export function parsearEtiqueta')).replace(/^export /gm, ''), cx);
let e = cx.parsearEtiqueta('{"legible":true,"imei":"352472591721837","marca":"Apple","modelo":"iPhone 13","almacenamiento":"128GB","color":"RED","bateria":76,"grado":"AA"}');
ok(e.imei === '352472591721837' && e.modelo === 'iPhone 13' && e.bateria === 76 && e.grado === 'AA', 'la etiqueta de Alan se lee entera', e);
ok(cx.parsearEtiqueta('Acá está: {"imei":"35247259172","modelo":"iPhone 13"}').imei === '', 'un IMEI incompleto no se usa (mejor vacío que equivocado)');
ok(cx.parsearEtiqueta('{"legible":false}') === null && cx.parsearEtiqueta('no sé') === null && cx.parsearEtiqueta('{"color":"RED"}') === null, 'si no se pudo leer, nada');
ok(cx.parsearEtiqueta('{"modelo":"iPhone 13","bateria":176}').bateria === 0, 'una batería imposible no se usa');
ok(/action === 'leerEtiquetaEquipo'/.test(ai) && /no lo inventes/.test(ai.slice(ai.indexOf("action === 'leerEtiquetaEquipo'"))), 'la IA tiene orden de no inventar lo que no se lee');

console.log('\n2) Datos → formulario (etiqueta-equipo.js)');
const els = {};
const el = (id, extra) => els[id] = Object.assign({ id, value: '', style: {} }, extra || {});
['fi-marca', 'fi-modelo', 'fi-estado', 'fi-color', 'fi-imei', 'fi-bateria', 'fi-notas'].forEach(i => el(i));
el('fi-storage', { tagName: 'SELECT', options: ['', '64GB', '128GB', '256GB', '1TB'].map(value => ({ value })) });
el('fi-estado', { tagName: 'SELECT', options: ['', 'Nuevo', 'Usado', 'Reacondicionado'].map(value => ({ value })) });
el('fi-bateria-wrap', { style: { display: 'none' } });
const TOASTS = [];
const ctx = { console, String, Number, Math, JSON, RegExp, Object, Array, parseInt,
  document: { getElementById: id => els[id] || null }, toast: (m, t) => TOASTS.push([t, m]) };
vm.createContext(ctx);
vm.runInContext(leer('etiqueta-equipo.js'), ctx, { filename: 'etiqueta-equipo.js' });
ctx.E = e;
const f = vm.runInContext('etqAFormulario(E)', ctx);
ok(f.marca === 'iPhone' && f.modelo === 'iPhone 13' && f.almacenamiento === '128GB', 'Apple va como marca "iPhone" (como en la lista de la app)', f);
ok(f.color === 'Rojo' && f.estado === 'Usado' && f.bateria === 76 && f.grado === 'AA', 'el color en castellano; con grado y batería gastada, es un usado', f);
ok(ctx.etqColor('MIDNIGHT') === 'Negro' && ctx.etqColor('(PRODUCT)RED') === 'Rojo' && ctx.etqColor('Sierra Blue') === 'Azul' && ctx.etqColor('Lavanda') === 'Lavanda', 'los colores de Apple se traducen; uno desconocido queda como está');
ok(ctx.etqCapacidad('128 gb') === '128GB' && ctx.etqCapacidad('1TB') === '1TB' && ctx.etqCapacidad('256G') === '256GB', 'la capacidad como las opciones del formulario');
els['fi-modelo'].value = 'iPhone 13 mini';   // ya escrito a mano
const puestos = vm.runInContext('etqCompletar(etqAFormulario(E))', ctx);
ok(els['fi-imei'].value === '352472591721837' && els['fi-marca'].value === 'iPhone' && els['fi-storage'].value === '128GB' && els['fi-color'].value === 'Rojo' && els['fi-bateria'].value === '76', 'completa el formulario', puestos);
ok(els['fi-modelo'].value === 'iPhone 13 mini' && !puestos.includes('modelo'), 'no pisa lo que ya escribiste');
ok(els['fi-bateria-wrap'].style.display === '' && /Grado AA/.test(els['fi-notas'].value), 'muestra el casillero de batería y el grado va a las notas');
ok(vm.runInContext(`etqImeiRepetido('352472591721837', [{ imei: '352472591721837', modelo: 'iPhone 13' }])`, ctx) && !vm.runInContext(`etqImeiRepetido('352472591721837', [])`, ctx), 'avisa si ese IMEI ya está cargado');

console.log('\n3) Enganchado en "Agregar equipo"');
const html = leer('index.html');
ok(/onclick="etqEscanearImei\(\)"/.test(html) && html.indexOf('onclick="etqEscanearImei()"') > html.indexOf('id="fi-imei"'), '📷 al lado del IMEI: escanea el código de barras');
ok(/id="etq-leer-btn" onclick="etqLeerEtiqueta\(\)"/.test(html), '📸 "Leer la etiqueta con una foto"');
ok(/<script defer src="etiqueta-equipo\.js"><\/script>/.test(html), 'cargado en la app');
ok(/inp\.capture = 'environment'/.test(leer('etiqueta-equipo.js')), 'en el celu abre directo la cámara de atrás');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
