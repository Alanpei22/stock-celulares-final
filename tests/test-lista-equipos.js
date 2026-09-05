// Lista de equipos para mandar por WhatsApp (botón 📋 de la pantalla Stock).
// Lo que más se vigila: que no se le ofrezca al cliente un equipo vendido o
// reservado, y que la lista sea EXACTAMENTE lo que hay filtrado en pantalla.
const fs = require('fs'), vm = require('vm');
const DIR = require('path').join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

const els = {};
const el = (id, extra = {}) => els[id] = Object.assign({
  id, value: '', textContent: '', innerHTML: '', checked: false, style: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
               toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  closest() { return null; }, focus() {}, setAttribute() {}, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], appendChild() {}, remove() {}, options: [],
}, extra);
['search','f-marca','f-estado','f-vendido','f-min','f-max','f-vendedor',
 'listawa-overlay','listawa-modal','listawa-txt','listawa-nota','listawa-sel','listawa-cuenta'].forEach(id => el(id));
els['f-vendido'].value = '0';   // "En stock", que es el valor por defecto

let COPIADO = '', ABIERTO = '', CONFIRMA = true;
const ctx = {
  console, setTimeout: f => { f(); return 0; }, clearTimeout, requestAnimationFrame: f => f(),
  document: {
    getElementById: id => els[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => el('tmp'), addEventListener: () => {},
    body: { style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
    documentElement: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: { setProperty() {} } },
  },
  window: { addEventListener() {}, _DAKI_NAME: 'TechPoint', open: u => { ABIERTO = u; },
            matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: '' } },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node', clipboard: { writeText: t => { COPIADO = t; return Promise.resolve(); } } },
  confirm: () => CONFIRMA, alert: () => {},
  BIZ_DATA: { dir: 'Urquiza 4741, Caseros', tel: '11 7239-2511', extra: 'Lun a Sáb 9 a 19' },
  toast: () => {}, esc: s => String(s == null ? '' : s),
  searchMatch: (hay, q) => String(hay).toLowerCase().includes(String(q).toLowerCase()),
  dolarBlue: 1200,
  WA_TEMPLATES: {},
  _pendingUbiFilter: null,
  todayAR: () => '2026-09-05',
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(DIR + 'stock-extras.js', 'utf8'), ctx, { filename: 'stock-extras.js' });
// _stockFiltrado vive en app.js: se saca la función real para no reescribir el
// filtro en la prueba (si cambia allá y acá no, la prueba dejaría de valer).
const app = fs.readFileSync(DIR + 'app.js', 'utf8');
const fn = app.slice(app.indexOf('function _stockFiltrado()'), app.indexOf('function render()'));
vm.runInContext(fn, ctx, { filename: 'app.js' });
const run = c => vm.runInContext(c, ctx);
const get = e => vm.runInContext(e, ctx);

const STOCK = [
  { id:'a', marca:'Samsung', modelo:'Galaxy A54', almacenamiento:'128GB', estado:'Nuevo',  precio:520000, vendido:false },
  { id:'b', marca:'Samsung', modelo:'Galaxy S21', almacenamiento:'256GB', estado:'Usado',  precio:430000, vendido:false, bateria:91 },
  { id:'c', marca:'Apple',   modelo:'iPhone 11',  almacenamiento:'64GB',  estado:'Usado',  precio:380000, vendido:false, bateria:87 },
  { id:'d', marca:'Apple',   modelo:'iPhone 13',  almacenamiento:'128GB', estado:'Nuevo',  precio:720000, vendido:false },
  { id:'e', marca:'Motorola',modelo:'Moto G54',   almacenamiento:'128GB', estado:'Nuevo',  precio:290000, vendido:true  },
  { id:'f', marca:'Xiaomi',  modelo:'Redmi 12',   almacenamiento:'128GB', estado:'Nuevo',  precio:250000, vendido:false, reservado:true, reservaCliente:'Ana' },
  { id:'g', marca:'Apple',   modelo:'iPhone 15',  almacenamiento:'256GB', estado:'Nuevo',  moneda:'usd', precioUSD:900, precio:0, vendido:false },
];
ctx.__S = STOCK;
run('STOCK = __S;');

const lista = () => { run('openListaWaModal()'); return els['listawa-txt'].value; };

console.log('\n1) Nunca se ofrece algo que no se puede vender');
let t = lista();
ok(!/Moto G54/.test(t), 'un equipo VENDIDO no entra en la lista', t);
ok(!/Redmi 12/.test(t), 'un equipo RESERVADO tampoco  ← ofrecerlo es quedar mal con dos clientes');
ok(/Galaxy A54/.test(t) && /iPhone 11/.test(t), 'los disponibles sí');
ok(/no entra/.test(els['listawa-nota'].textContent), 'y avisa cuántos quedaron afuera', els['listawa-nota'].textContent);

console.log('\n2) Agrupado por marca');
ok(/\*APPLE\*/.test(t) && /\*SAMSUNG\*/.test(t), 'un título por marca', t);
ok(t.indexOf('*APPLE*') < t.indexOf('*SAMSUNG*'), 'las marcas en orden alfabético');
const bloqueApple = t.slice(t.indexOf('*APPLE*'), t.indexOf('*SAMSUNG*'));
ok(bloqueApple.indexOf('iPhone 11') < bloqueApple.indexOf('iPhone 13'),
   'dentro de cada marca, del más barato al más caro', bloqueApple);

console.log('\n3) Cada línea: modelo · memoria · estado — precio');
ok(/• Galaxy A54 · 128GB · Nuevo — \$520\.000/.test(t), 'formato de la línea', t.split('\n').find(l => /A54/.test(l)));
ok(/• iPhone 13 · 128GB · Nuevo — \$720\.000/.test(t), 'otra línea');

console.log('\n4) En los iPhone va la batería (y en los demás no)');
ok(/iPhone 11 · 64GB · Usado · 🔋87% —/.test(t), 'el iPhone usado muestra la salud de batería',
   t.split('\n').find(l => /iPhone 11/.test(l)));
ok(!/Galaxy S21[^\n]*🔋/.test(t), 'el Samsung usado NO, aunque tenga el dato cargado',
   t.split('\n').find(l => /S21/.test(l)));
ok(!/iPhone 13[^\n]*🔋/.test(t), 'y un iPhone sin batería cargada tampoco');

console.log('\n5) Los precios en dólares salen convertidos a pesos');
// El iPhone 15 está cargado a u$900 y el dólar en 1200.
ok(/iPhone 15[^\n]*— \$1\.080\.000/.test(t), '900 × 1200 = $1.080.000',
   t.split('\n').find(l => /iPhone 15/.test(l)));
ok(!/u\$/.test(t), 'no queda ningún precio en dólares en el mensaje');
// Y ordena por el precio QUE SE MUESTRA: ordenando por `precio` a secas, un
// equipo en dólares vale 0 y se iba al principio aunque fuera el más caro.
const apple = t.slice(t.indexOf('*APPLE*'), t.indexOf('*SAMSUNG*'));
ok(apple.indexOf('iPhone 11') < apple.indexOf('iPhone 13')
   && apple.indexOf('iPhone 13') < apple.indexOf('iPhone 15'),
   'el equipo en dólares se ordena por su precio en pesos, no al principio', apple);

console.log('\n6) Encabezado y pie con los datos del local');
ok(/EQUIPOS DISPONIBLES/.test(t) && /TechPoint/.test(t), 'encabezado');
ok(/Urquiza 4741, Caseros/.test(t), 'la dirección');
ok(/Lun a Sáb 9 a 19/.test(t), 'el horario');
ok(/Actualizado 05\/09/.test(t), 'y la fecha de hoy en dd/mm, igual en el celu y en la compu',
   (t.match(/Actualizado .*/) || [])[0]);
// Se puede cambiar desde Configuración
run("WA_TEMPLATES = { lista_header: 'MI TITULO', lista_footer: 'MI PIE {TELEFONO}' };");
t = lista();
ok(t.startsWith('MI TITULO'), 'el encabezado se puede editar', t.slice(0, 30));
ok(/MI PIE 11 7239-2511/.test(t), 'y el pie, con sus variables', t.slice(-40));
run('WA_TEMPLATES = {};');

console.log('\n7) La lista es LO QUE ESTÁS VIENDO: respeta los filtros de arriba');
els['f-marca'].value = 'Apple';
t = lista();
ok(/iPhone/.test(t) && !/Samsung/i.test(t), 'filtro por marca', t);
els['f-marca'].value = '';
els['f-estado'].value = 'Usado';
t = lista();
ok(/iPhone 11/.test(t) && /Galaxy S21/.test(t) && !/A54/.test(t), 'filtro por estado', t);
els['f-estado'].value = '';
els['f-min'].value = '400000'; els['f-max'].value = '600000';
t = lista();
ok(/Galaxy A54/.test(t) && /Galaxy S21/.test(t), 'filtro por precio: entra lo que está en el rango', t);
ok(!/iPhone 11/.test(t) && !/iPhone 13/.test(t), 'y queda afuera lo de abajo y lo de arriba');
els['f-min'].value = ''; els['f-max'].value = '';
els['search'].value = 'galaxy';
t = lista();
ok(/Galaxy/.test(t) && !/iPhone/.test(t), 'el buscador de arriba también');
els['search'].value = '';
// Y que el filtro sea el MISMO que usa la pantalla, no una copia
ok(/_stockFiltrado\(\)/.test(app.slice(app.indexOf('function render()'), app.indexOf('function render()') + 3000)),
   'render() y la lista usan el mismo filtro (una sola cuenta)');

console.log('\n8) Sin equipos, lo dice en vez de mandar una lista vacía');
els['f-marca'].value = 'Nokia';
t = lista();
ok(t === '', 'no arma texto');
ok(/No hay equipos disponibles/.test(els['listawa-nota'].textContent), 'y avisa', els['listawa-nota'].textContent);
els['f-marca'].value = '';

console.log('\n9) Copiar y abrir WhatsApp');
t = lista();
run('listaWaCopiar(null)');
ok(COPIADO === els['listawa-txt'].value, 'copia lo que hay en el cuadro (editado incluido)');
// Editar el texto antes de mandarlo
els['listawa-txt'].value = 'lista corta';
run('listaWaCopiar(null)');
ok(COPIADO === 'lista corta', 'si lo editás, se copia lo editado', COPIADO);
run('listaWaEnviar()');
ok(/wa\.me\/\?text=lista%20corta/.test(ABIERTO), 'y WhatsApp abre con ese texto', ABIERTO);

console.log('\n8b) Elegir equipo por equipo, no solo filtrar');
// Filtrar por marca/precio no alcanza: muchas veces querés mandarle a un
// cliente estos tres y no toda la categoría.
els['f-marca'].value = ''; els['f-estado'].value = '';
els['f-min'].value = ''; els['f-max'].value = ''; els['search'].value = '';
t = lista();
ok(get('_listaSel.size') === 5, 'al abrir vienen todos tildados', get('_listaSel.size'));
ok(/5 de 5 elegidos/.test(els['listawa-cuenta'].textContent), 'y lo dice', els['listawa-cuenta'].textContent);
ok(/lwa-item/.test(els['listawa-sel'].innerHTML), 'dibuja la lista para tildar');
ok(/Galaxy A54/.test(els['listawa-sel'].innerHTML), 'con el nombre de cada equipo');

// Destildar uno lo saca del mensaje
run("listaTogglePick('a')");   // Galaxy A54
t = els['listawa-txt'].value;
ok(!/Galaxy A54/.test(t), 'el destildado sale del mensaje', t);
ok(/Galaxy S21/.test(t), 'y el resto queda');
ok(/4 de 5 elegidos/.test(els['listawa-cuenta'].textContent), 'la cuenta acompaña');
// Volver a tildarlo lo devuelve
run("listaTogglePick('a')");
ok(/Galaxy A54/.test(els['listawa-txt'].value), 'y si lo volvés a tildar, vuelve');

// Elegir de a pocos: ninguno y después dos
run('listaPickTodos(false)');
ok(els['listawa-txt'].value === '', 'sin nada tildado no hay mensaje');
ok(/0 de 5/.test(els['listawa-cuenta'].textContent), 'cuenta en cero');
run("listaTogglePick('c'); listaTogglePick('d');");   // los dos iPhone
t = els['listawa-txt'].value;
ok(/iPhone 11/.test(t) && /iPhone 13/.test(t), 'quedan los dos elegidos', t);
ok(!/Samsung/i.test(t) && !/iPhone 15/.test(t), 'y solo esos');
ok(/\*APPLE\*/.test(t) && !/\*SAMSUNG\*/.test(t), 'la marca sin equipos elegidos ni aparece');
run('listaPickTodos(true)');
ok(get('_listaSel.size') === 5, '"Todos" vuelve a tildar todo');

// Al reabrir arranca limpio otra vez
run("listaTogglePick('a')");
lista();
ok(get('_listaSel.size') === 5, 'al reabrir el cuadro vuelven todos tildados');

console.log('\n9b) El botón flotante');
// Estaba entre los filtros, pero esa fila scrollea de costado y en el celular
// el botón quedaba fuera de pantalla.
const idx = fs.readFileSync(DIR + 'index.html', 'utf8');
ok(/id="lista-fab"[\s\S]{0,120}openListaWaModal\(\)/.test(idx), 'existe y abre la lista',
   (idx.match(/<button id="lista-fab"[\s\S]{0,160}/) || [])[0]);
ok(!/class="pill pill--accion"/.test(idx), 'ya no está metido entre los filtros que scrollean');
ok(idx.indexOf('id="lista-fab"') < idx.indexOf('<nav class="bottom-nav"'),
   'va antes de la barra de abajo, para quedar por encima');
const css = fs.readFileSync(DIR + 'style.css', 'utf8');
const fabCss = css.slice(css.indexOf('.lista-fab {'), css.indexOf('.lista-fab:active'));
ok(/position: fixed/.test(fabCss) && /right: 16px/.test(fabCss), 'fijo abajo a la derecha', fabCss);
ok(/env\(safe-area-inset-bottom\)/.test(fabCss), 'respeta el área segura del iPhone');
// Solo se ve en Stock
const swi = app.slice(app.indexOf('function switchSection'), app.indexOf('function switchSection') + 900);
ok(/lista-fab/.test(swi) && /section !== 'stock'/.test(swi),
   'se esconde fuera de la pantalla de Stock', swi.split('\n').filter(l => /lista-fab|stock/.test(l)));

console.log('\n10) Con una lista larga avisa antes de que WhatsApp la corte');
// El link wa.me mete el texto en la URL: con listas largas se trunca.
els['listawa-txt'].value = 'x'.repeat(2500);
ABIERTO = ''; CONFIRMA = false;
run('listaWaEnviar()');
ok(ABIERTO === '', 'si decís que no, no abre nada roto');
CONFIRMA = true;
run('listaWaEnviar()');
ok(ABIERTO !== '', 'y si insistís, abre igual');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
