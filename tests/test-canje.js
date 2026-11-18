// 🔄 Plan canje. Alan (17/11): "agregame un sistema para hacer plan canje".
// Antes la "Permuta" era un texto en el comprobante: la caja registraba el
// precio entero y el usado que dejaba el cliente no entraba a ningún lado.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ctx = { console, Math, Number, String, Array, Object, JSON, Date, parseInt, parseFloat,
  localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: () => null } };
vm.createContext(ctx);
vm.runInContext(leer('canje.js'), ctx, { filename: 'canje.js' });
const run = c => vm.runInContext(c, ctx);

ctx.STOCK = [
  { marca: 'Apple', modelo: 'iPhone 11', almacenamiento: '128GB', estado: 'Usado', precio: 500000 },
  { marca: 'Apple', modelo: 'iPhone 11', almacenamiento: '128 GB', estado: 'Usado', precio: 520000 },
  { marca: 'Apple', modelo: 'iPhone 11', almacenamiento: '128GB', estado: 'Usado', precio: 900000 },   // uno raro
  { marca: 'Apple', modelo: 'iPhone 11', almacenamiento: '64GB', estado: 'Usado', precio: 400000 },
  { marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '128GB', estado: 'Usado', moneda: 'usd', precioUSD: 450 },
  { marca: 'Apple', modelo: 'iPhone 13', almacenamiento: '128GB', estado: 'Nuevo', precio: 2000000 },
];

console.log('\n1) El valor sugerido');
let s = run(`canjeSugerido({ marca: 'apple', modelo: 'iphone 11', almacenamiento: '128' , estetico: 'A' }, STOCK, { margen: 35 }, 1000)`);
ok(s.ref === 520000 && s.iguales === 3, 'compara con los iguales (marca, modelo y capacidad, sin importar cómo se escribió), con el precio del medio: uno raro no lo mueve', s);
ok(s.valor === 335000 && s.margen === 35, '$520.000 menos 35% = $338.000 → redondeado para abajo a $335.000', s);
s = run(`canjeSugerido({ modelo: 'iPhone 11', almacenamiento: '128GB', bateria: 78, estetico: 'C' }, STOCK, { margen: 35 }, 1000)`);
ok(s.valor === Math.floor(520000 * (1 - 0.35 - 0.10 - 0.15) / 5000) * 5000 && s.ajustes.length === 2, 'batería baja y muy marcado: se toma por menos (y dice por qué)', s);
s = run(`canjeSugerido({ modelo: 'iPhone 13', almacenamiento: '128GB' }, STOCK, { margen: 30 }, 1000)`);
ok(s.ref === 450000 && s.iguales === 1, 'los que están en dólares se pasan a pesos; los nuevos no cuentan', s);
ok(run(`canjeSugerido({ modelo: 'Moto G54' }, STOCK, { margen: 35 }, 1000)`) === null, 'sin uno igual en el stock: no inventa, se pone a mano');

console.log('\n2) La cuenta y lo que se exige');
ok(run('canjeSaldo(600000, 335000)') === 265000 && run('canjeSaldo(100, 200)') === 0, 'paga la diferencia');
const C = { marca: 'Apple', modelo: 'iPhone 11', valor: 335000, imei: '356789012345678', destino: 'stock' };
const CLI = { nombre: 'Juan Pérez', dni: '30123456' };
ctx.C = C; ctx.CLI = CLI;
ok(run('canjeValidar(C, 600000, CLI)') === null, 'con los datos completos, pasa');
ok(/DNI/.test(run('canjeValidar(C, 600000, { nombre: "Juan" })')), 'sin DNI del cliente no se toma un usado (si aparece robado, es lo primero que piden)');
ok(/más que lo que se lleva/.test(run('canjeValidar(C, 300000, CLI)')), 'no se puede tomar por más de lo que se lleva');
ok(/cuánto se le toma/.test(run('canjeValidar(Object.assign({}, C, { valor: 0 }), 600000, CLI)')), 'sin valor, no');
ok(/15 números/.test(run('canjeValidar(Object.assign({}, C, { imei: "123" }), 600000, CLI)')), 'IMEI incompleto, no');
ok(/qué necesita/.test(run('canjeValidar(Object.assign({}, C, { destino: "arreglo" }), 600000, CLI)')), 'si va a arreglo, hay que anotar qué necesita');

console.log('\n3) El usado entra al stock (o a "para arreglar")');
const st = run(`canjeDocStock(Object.assign({}, C, { almacenamiento: '128GB', bateria: 86 }), { nombre: 'Juan Pérez', dni: '30123456', tel: '1155' }, 'Apple iPhone 13', '2026-11-17T15:00:00Z', 520000)`);
ok(st.costo === 335000 && st.precio === 520000 && st.estado === 'Usado' && st.vendido === false && st.imei === C.imei && st.bateria === 86, 'al stock: su costo es lo que se le tomó, y el precio sugerido el de uno igual', st);
ok(st.origen === 'canje' && st.canje.dni === '30123456' && st.canje.venta === 'Apple iPhone 13' && /plan canje/.test(st.notas), 'queda anotado de quién vino (con DNI) y en qué venta');
ok(run(`canjeDocStock(C, CLI, '', 'x', 0)`).sinPrecio === true, 'sin precio de referencia queda marcado para ponérselo');
const ar = run(`canjeDocArreglo(Object.assign({}, C, { falla: 'Batería' }), CLI, 'Apple iPhone 13', 'x')`);
ok(ar.costoCompra === 335000 && ar.falla === 'Batería' && ar.estado === 'pendiente' && ar.activo === true && ar.origen === 'canje', 'a "Para arreglar": con lo que costó y lo que necesita', ar);

console.log('\n4) Enganchado en la venta de equipo de la caja');
const cj = leer('caja.js'), html = leer('caja.html');
ok(/id="ve-canje"/.test(html) && /<script src="canje\.js"><\/script>/.test(html), 'la sección 🔄 Plan canje está en la venta de equipo');
ok(/const cobrado = canje \? canjeSaldo\(total, canje\.valor\) : total;/.test(cj) && /monto: cobrado, metodoPago/.test(cj), 'a la caja entra solo la diferencia (la plata que entra de verdad)');
ok(/data\.montoCanje  = canje\.valor;/.test(cj) && /data\.montoEquipo = d\.precio;/.test(cj), 'el movimiento guarda el precio entero y cuánto fue en canje');
ok(/_ventaEqGanancia\(\s*d\.precio,/.test(cj), 'la ganancia sigue siendo la del equipo vendido a su precio entero');
ok(/d\.permuta = \[canjeNombre\(canje\)/.test(cj) && /d\.permutaValor = canje\.valor;/.test(cj) && /d\.saldoAbonado = canjeSaldo/.test(cj), 'el comprobante dice el equipo recibido, el valor tomado y lo que abonó');
ok(/await canjeGuardarEquipo\(canje,/.test(cj) && cj.indexOf('await canjeGuardarEquipo') > cj.indexOf("collection('caja_movimientos').add(\n        { ...data"), 'el usado se carga después de registrar la venta (si falla, la venta no se pierde)');
ok(/canjeValidar\(canje, total, \{ nombre: d\.clienteNombre, dni: d\.clienteDni \}\)/.test(cj) && /No marcaste que consultaste el IMEI/.test(cj), 'antes de vender: datos completos y pregunta si se chequeó el IMEI');
ok(/canje:      \{ ico: '🔄', txt: 'Entró por plan canje' \}/.test(leer('movstock.js')), 'el registro de stock dice "Entró por plan canje"');
ok(/🔄 canje \$\{f\(x\.canje\)\}/.test(leer('equipos-dia.js')), 'el resumen de equipos del día muestra el canje');

console.log('\n5) También al vender desde el Stock');
// Alan (17/11): "sí, agregalo (en la venta del Stock), igual no encuentro lo primero"
const ap = leer('app.js'), ix = leer('index.html');
ok(/id="sell-canje"/.test(ix) && /<script defer src="canje\.js"><\/script>/.test(ix), 'la sección 🔄 Plan canje está en "Registrar venta" del Stock');
ok(/canjeEn\(\{ caja: 'sell-canje', stock: \(\) => STOCK,/.test(ap), 'compara con el stock de esa pantalla, y lo que falta pagar descuenta la seña si estaba reservado');
ok(/monto: canje \? canjeSaldo\(aCobrar, canje\.valor\) : aCobrar,/.test(ap) && /movData\.montoCanje  = canje\.valor;/.test(ap), 'a la caja entra solo la diferencia');
ok(/stockUpdate\.permutaValor = canje\.valor;/.test(ap), 'el comprobante lo imprime');
ok(/await canjeGuardarEquipo\(canje, \{ nombre: cliNombre/.test(ap) && ap.indexOf('await canjeGuardarEquipo') > ap.indexOf('await batch.commit();'), 'el usado se carga después de guardar la venta');
ok(/canjeValidar\(canje, aPagar, \{ nombre: cliNombre, dni: cliDni \}\)/.test(ap), 'exige nombre y DNI igual que en la caja');
ok(/Vender equipo · 🔄 canje/.test(leer('caja.html')) && /if \(typeof canjeEn === 'function'\) canjeEn\(\);/.test(leer('caja.js')), 'en la caja, el botón ＋ dice "Vender equipo · 🔄 canje" (antes decía "Comprobante" y no se encontraba)');

console.log('\n6) Pulido (Alan, 18/11: "hay que pulir el tema plan canje")');
const cjs = leer('canje.js');
const form = cjs.slice(cjs.indexOf('function canjeActivar()'), cjs.indexOf('function canjeEscanearImei'));
ok(!/class="(precio-fg|precio-input|ventaeq-g2)/.test(form) && /\.cj-in \{/.test(cjs) && /\.cj-g2 \{/.test(cjs), 'estilos propios: en el Stock se veía desarmado (usaba los de la caja)');
ok(/onclick="canjeEscanearImei\(\)"/.test(form) && /escanearImei\('cj-imei', \{ marca: 'cj-marca', modelo: 'cj-modelo' \}\)/.test(cjs), '📷 para escanear el IMEI del usado (y completa marca y modelo)');
ok(/Para el canje cargá \$\{faltan\.join\(' y '\)\} del cliente/.test(cjs) && /cli: \['sell-cli-nombre', 'sell-cli-dni'\]/.test(leer('app.js')) && /cli: \['ve-cli-nombre', 've-cli-dni'\]/.test(cjs), 'avisa en el momento si faltan nombre o DNI del cliente (en las dos pantallas)');

console.log('\n7) Fotos del canje (DNI y equipo)');
// Alan (18/11) eligió esto: si el usado aparece robado, son el respaldo.
const fd = run(`canjeDocFotos({ dniFrente: 'data:image/jpeg;base64,AAA', equipo: 'data:image/jpeg;base64,BBB' }, { nombre: 'Juan', dni: '30123456', tel: '11' }, 'eq1', 'stock', '2026-11-18T10:00:00Z')`);
ok(fd.dniFrente && fd.equipo && !fd.dniDorso && fd.dni === '30123456' && fd.equipoId === 'eq1', 'guarda solo las que se sacaron, con de quién es y a qué equipo va', fd);
ok(run(`canjeDocFotos({}, { nombre: 'Juan' }, 'eq1', 'stock', 'x')`) === null, 'sin fotos no guarda nada');
const cj7 = leer('canje.js');
ok(/collection\('canje_fotos'\)\.doc\(id\)\.set\(doc\)/.test(cj7) && !/stock-photos/.test(cj7.replace(/\/\/.*$/gm, '')), 'van a canje_fotos (solo cuentas del negocio), NO a las fotos públicas de los equipos');
ok(/canjeAchicarFoto\(file, 1000, 0\.7\)/.test(cj7), 'achicadas, para que las tres entren en un documento');
ok(cj7.indexOf("await _canjeGuardarFotos(c, cliente, id, 'stock', ahora)") < cj7.indexOf("await db.collection('stock').doc(id).set(doc)"), 'se guardan antes que el equipo (que queda marcado con cuántas tiene)');
ok(/fotos: Object\.assign\(\{\}, _cjFotos\)/.test(cj7) && /_cjFotos = \{\};/.test(cj7), 'viajan con el resto del canje y se borran al empezar otra venta');
ok(/canjeVerFotos\('\$\{p\.id\}'\)/.test(leer('canje.js')) && /🔄 Entró por plan canje/.test(leer('canje.js')) && /canjeFichaHtml\(p\)/.test(leer('app.js')), 'en la ficha del equipo: de quién vino (DNI, teléfono) y botón para ver las fotos');

console.log('\n8) Espera y "lo dieron de baja"');
// Alan (18/11): "dale, dejalo todo armado". La trampa: deja el celu, cobra
// la diferencia y a los días lo denuncia o lo bloquea la compañía.
const T0 = Date.parse('2026-11-18T12:00:00Z');
run('CANJE_CFG.diasEspera = 10');
const nuevo = run(`canjeDocStock({ marca: 'Apple', modelo: 'iPhone 11', valor: 300000, imei: '356789012345678' }, { nombre: 'Juan Pérez', dni: '30123456', tel: '1155556666' }, 'Apple iPhone 13', '2026-11-18T12:00:00Z', 500000)`);
ok(nuevo.canje.esperaHasta === '2026-11-28T12:00:00.000Z' && nuevo.canje.imei === '356789012345678', 'entra con 10 días de espera (y el IMEI anotado en el canje)', nuevo.canje);
ctx.P = Object.assign({ id: 'u1' }, nuevo);
let e = run(`canjeEstado(P, ${T0 + 3 * 864e5})`);
ok(e.tipo === 'espera' && e.dias === 7, 'a los 3 días: en espera, faltan 7', e);
ok(run(`canjeEstado(P, ${T0 + 11 * 864e5}).tipo`) === 'revisar', 'pasada la espera: se puede vender, pero antes hay que consultar el IMEI');
ctx.P.canje.imeiRevisado = new Date(T0 + 11 * 864e5).toISOString();
ok(run(`canjeEstado(P, ${T0 + 12 * 864e5}).tipo`) === 'ok' && run(`canjeEstado(P, ${T0 + 14 * 864e5}).tipo`) === 'revisar', 'consultado hace poco: listo; a los 2 días hay que consultarlo de nuevo');
ctx.P.bloqueado = true;
ok(run(`canjeEstado(P, ${T0}).tipo`) === 'bloqueado', 'bloqueado manda sobre todo');
ok(run(`canjeEstado({ marca: 'X' })`) === null, 'uno que no vino por canje: nada');
// Antes de vender
ctx.alert = () => {}; let preguntas = [];
ctx.confirm = m => { preguntas.push(m); return true; };
ctx.db = { collection: () => ({ doc: () => ({ update: async () => {} }) }) };
ok(run(`canjeAntesDeVender(P, ${T0})`) === false, 'bloqueado: no se puede vender');
ctx.P.bloqueado = false; delete ctx.P.canje.imeiRevisado;
preguntas = [];
ok(run(`canjeAntesDeVender(P, ${T0 + 3 * 864e5})`) === true && preguntas.length === 2 && /en espera hasta el/.test(preguntas[0]) && /volvé a consultar el IMEI 356789012345678/.test(preguntas[1]), 'en espera: avisa, y pide confirmar que se consultó el IMEI', preguntas);
ctx.confirm = () => false;
ok(run(`canjeAntesDeVender(P, ${T0 + 11 * 864e5})`) === false, 'si no lo consultó, no sigue');
// El reclamo
const msg = run(`canjeReclamoTexto(P, 'TechPoint')`);
ok(/Hola Juan/.test(msg) && /IMEI 356789012345678/.test(msg) && /72 horas/.test(msg) && !/300\.000/.test(msg), 'el WhatsApp de reclamo: equipo, IMEI y las 72 h del comprobante (sin decir en cuánto se tomó)', msg);
// Enganchado
const ap8 = leer('app.js');
ok(/function markSold\(id\) \{[\s\S]{0,200}canjeAntesDeVender\(p\)/.test(ap8) && /canjeAntesDeVender\(p\)\) return;/.test(leer('caja.js')), 'se frena antes de vender, desde el Stock y desde la caja');
ok(/canjeFichaHtml\(p\)/.test(ap8) && /canjeBadgeHtml\(p\)/.test(ap8), 'en la ficha (estado y botones) y en la tarjeta de la lista (⏳ / 🚫)');
ok(/p\.bloqueado\) continue;/.test(leer('lista-precios.js')) && /p\.bloqueado\) continue;/.test(leer('estado-equipos.js')) && /p\.eliminado \|\| p\.bloqueado\) return null;/.test(leer('api/equipos.js')), 'un bloqueado no sale en la lista de precios, los estados ni la página');
ok(/bloqueado: true, bloqueadoFecha: ahora, publicar: false/.test(leer('canje.js')), 'marcarlo bloqueado lo saca de la página');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
