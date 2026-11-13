// 🏷️ Promos automáticas. Alan (13/11): "a veces hago promo de 2 x tanto o 2x1
// en fundas y en otras cosas… el tema es que se descuenten las fundas". La
// caja aplica la promo sola: se escanean todas, cada una baja del stock y el
// precio se acomoda.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

const ctx = { console, Math, Number, String, Array, Object, JSON, Date, parseInt, parseFloat, document: { getElementById: () => null } };
vm.createContext(ctx);
vm.runInContext(leer('promos.js'), ctx, { filename: 'promos.js' });
const F = (qty, precio, extra) => Object.assign({ source: 'producto', id: 'f' + Math.random(), nombre: 'Funda', categoria: 'Fundas', qty, precio, precioLista: precio }, extra || {});
const total = c => Math.round(c.reduce((s, it) => s + it.precio * it.qty, 0));
const P = p => [Object.assign({ categoria: 'Fundas', activa: true }, p)];
const DOSxUNO = P({ tipo: 'nxm', n: 2, m: 1 }), TRESxDOS = P({ tipo: 'nxm', n: 3, m: 2 });
const DOSxDIEZ = P({ tipo: 'nxprecio', n: 2, precio: 10000 }), PCT = P({ tipo: 'pct', n: 2, pct: 20 });

console.log('\n1) 2x1 y 3x2');
let c = [F(2, 6000)];
let d = ctx.promosAplicar(c, DOSxUNO);
ok(d === 6000 && total(c) === 6000 && c[0].precio === 3000 && c[0].qty === 2, '2 fundas en 2x1: se cobra una, y siguen siendo 2 en el carrito (bajan 2 del stock)', c);
ok(c[0].promo && c[0].promo.nombre === '2x1', 'el renglón dice con qué promo salió', c[0].promo);
c = [F(1, 6000)];
ok(ctx.promosAplicar(c, DOSxUNO) === 0 && c[0].precio === 6000 && !c[0].promo, 'una sola: precio normal');
c = [F(3, 6000)];
ctx.promosAplicar(c, DOSxUNO);
ok(total(c) === 12000, '3 en 2x1: paga 2 (la tercera no completa otro par)', total(c));
c = [F(4, 6000)];
ctx.promosAplicar(c, DOSxUNO);
ok(total(c) === 12000, '4 en 2x1: paga 2');
c = [F(1, 8000), F(1, 5000)];
d = ctx.promosAplicar(c, DOSxUNO);
ok(d === 5000 && total(c) === 8000, 'dos fundas distintas (escaneadas por separado): gratis va la más barata', c.map(i => i.precio));
c = [F(3, 6000)];
ctx.promosAplicar(c, TRESxDOS);
ok(total(c) === 12000 && c[0].precio === 4000, '3x2: lleva 3, paga 2');

console.log('\n2) "2 x $10.000" y el % llevando varias');
c = [F(2, 6000)];
ctx.promosAplicar(c, DOSxDIEZ);
ok(total(c) === 10000 && c[0].precio === 5000, '2 x $10.000');
c = [F(3, 6000)];
ctx.promosAplicar(c, DOSxDIEZ);
ok(total(c) === 16000, 'la tercera va a su precio (10.000 + 6.000), aunque el precio por unidad tenga centavos', c[0].precio);
c = [F(2, 4000)];
ok(ctx.promosAplicar(c, DOSxDIEZ) === 0 && total(c) === 8000, 'si la promo saliera más cara que la lista, no se aplica');
c = [F(2, 5000)];
ctx.promosAplicar(c, PCT);
ok(total(c) === 8000, '20% llevando 2');
c = [F(1, 5000)];
ok(ctx.promosAplicar(c, PCT) === 0, 'y con una sola, nada');

console.log('\n3) Qué entra y qué no');
c = [F(2, 6000), { source: 'producto', id: 'v', nombre: 'Vidrio', categoria: 'Vidrios', qty: 2, precio: 4000, precioLista: 4000 }];
ctx.promosAplicar(c, DOSxUNO);
ok(c[1].precio === 4000 && !c[1].promo && total(c) === 14000, 'solo la categoría de la promo (los vidrios quedan igual)');
c = [F(2, 6000, { categoria: ' fundas ' })];
ok(ctx.promosAplicar(c, DOSxUNO) === 6000, 'la categoría, sin importar mayúsculas ni espacios');
c = [F(1, 6000), F(1, 6000, { regalo: true, precio: 0 })];
ok(ctx.promosAplicar(c, DOSxUNO) === 0 && c[1].precio === 0 && c[0].precio === 6000, 'lo que va 🎁 sin cargo no cuenta para la promo');
c = [F(1, 6000), F(1, 6000, { precioMano: true, precio: 5500 })];
ok(ctx.promosAplicar(c, DOSxUNO) === 0 && c[1].precio === 5500, 'un precio hecho a mano manda: ese renglón queda afuera');
c = [F(1, 6000), F(1, 6000, { sinPromo: true })];
ok(ctx.promosAplicar(c, DOSxUNO) === 0, 'y el que el cajero sacó de la promo (↩), también');
c = [F(2, 6000), { source: 'libre', nombre: 'Funda suelta', categoria: 'Fundas', qty: 2, precio: 3000, precioLista: 0 }, { source: 'equipo', nombre: 'iPhone', qty: 1, precio: 500000, precioLista: 500000 }];
ctx.promosAplicar(c, DOSxUNO);
ok(c[1].precio === 3000 && c[2].precio === 500000, 'ni los productos libres ni los equipos');
c = [F(2, 6000)];
ok(ctx.promosAplicar(c, P({ tipo: 'nxm', n: 2, m: 1, activa: false })) === 0 && c[0].precio === 6000, 'promo apagada: no se aplica');
// Se puede llamar mil veces (cada vez que se dibuja el carrito)
c = [F(2, 6000)];
ctx.promosAplicar(c, DOSxUNO); ctx.promosAplicar(c, DOSxUNO);
ok(c[0].precio === 3000, 'aplicarla dos veces no descuenta dos veces');
c[0].qty = 1;
ctx.promosAplicar(c, DOSxUNO);
ok(c[0].precio === 6000 && !c[0].promo, 'si saca una, vuelve al precio de lista');
c = [F(2, 6000)];
ctx.promosAplicar(c, DOSxUNO.concat(P({ tipo: 'pct', n: 2, pct: 10 })));
ok(c[0].promo.nombre === '2x1', 'con dos promos en la misma categoría, la que más le conviene al cliente');

console.log('\n4) Nombres, validación y el aviso');
ok(ctx.promoNombre(DOSxUNO[0]) === '2x1' && ctx.promoNombre(DOSxDIEZ[0]) === '2 x $10.000' && ctx.promoNombre(PCT[0]) === '20% llevando 2', 'cómo se llaman');
ok(ctx.promoValida(DOSxUNO[0]) && !ctx.promoValida({ categoria: 'Fundas', tipo: 'nxm', n: 2, m: 2 }) && !ctx.promoValida({ categoria: '', tipo: 'nxm', n: 2, m: 1 }) &&
   !ctx.promoValida({ categoria: 'Fundas', tipo: 'nxprecio', n: 2, precio: 0 }) && !ctx.promoValida({ categoria: 'Fundas', tipo: 'pct', n: 2, pct: 100 }), 'un 2x2, sin categoría, $0 o 100% no son promos');
let av = ctx.promosAvisos([F(1, 6000)], DOSxUNO);
ok(av.length === 1 && /Con 1 más de Fundas entra la promo 2x1/.test(av[0]), 'con una funda avisa "con 1 más entra la promo" (para ofrecerla)', av);
ok(ctx.promosAvisos([F(2, 6000)], DOSxUNO).length === 0, 'y con la promo completa no avisa nada');

console.log('\n5) Enganchado en la caja');
const cj = leer('caja.js'), html = leer('caja.html'), cv = leer('comprobante-venta.js');
ok(/<script src="promos\.js"><\/script>/.test(html), 'cargado en la caja');
ok(/function _cartTotal\(\) \{\s*const conPromo = _cartPromos\(\) > 0;/.test(cj), 'el total se calcula con las promos aplicadas');
ok(/_cartPromos\(\);   \/\/ 🏷️ los precios de promo, antes de dibujar/.test(cj), 'y los renglones se dibujan con el precio de promo');
ok((cj.match(/categoria: (p|prod|r)\.categoria \|\| ''/g) || []).length === 3, 'el buscador, el lector y el carrito llevan la categoría del producto');
ok(/_cartPrecioMano\(_cart\[i\], val\);/.test(cj) && /it\.precioMano = false;\s*it\.precio = Number\(it\.precioLista\);/.test(cj), 'hacer precio a mano saca el renglón de la promo; volver al de lista lo deja entrar');
ok(/onclick="_sacarDePromo\(\$\{i\}\)"/.test(cj) && /🏷️ Promo ' \+ esc\(it\.promo\.nombre\)/.test(cj), 'el renglón muestra la promo y se puede sacar');
ok(/it\.promo \? \{ promo: it\.promo\.nombre, precioListaUnit:/.test(cj), 'queda guardado en la venta con qué promo salió');
ok(/stockUpdates\.push\(\{ collection, id: it\.id, stockField, qty, nombre: it\.nombre, regalo: !!it\.regalo \}\)/.test(cj), 'el stock baja por la cantidad entera (las 2 fundas), no por lo cobrado');
ok(/label: 'Promos'/.test(cj) && /hide: !isOwner, onClick: \(\) => \(typeof promosAbrir === 'function'\) && promosAbrir\(\)/.test(cj), 'menú de la caja → 🏷️ Promos (solo el dueño)');
ok(/promosEscuchar\(\);   \/\/ 🏷️ las promos prendidas/.test(cj) && /collection\('config'\)\.doc\('promos'\)/.test(leer('promos.js')), 'se leen una vez al abrir la caja (un solo documento)');
ok(/\(promo ' \+ it\.promo \+ '\)'/.test(cv), 'el ticket dice la promo');

console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
