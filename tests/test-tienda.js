// 🛒 Tienda online: carrito → Mercado Pago (api/_tienda.js, api/tienda.js,
// tienda.js). Alan (26/11): "carrito, medio de pago (Mercado Pago)". Pagar
// todo o seña; retiro en el local o envío sin cargo hasta 2 km; mismo precio;
// al pagarse: stock, caja y Telegram.
const fs = require('fs'), vm = require('vm'), path = require('path');
const { pathToFileURL } = require('url');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

(async () => {
  const T = await import(pathToFileURL(DIR + 'api/_tienda.js').href);
  const AHORA = Date.parse('2026-11-26T15:00:00Z');
  const eq = (o = {}) => ({ id: 'e1', publicar: true, marca: 'Samsung', modelo: 'A54', almacenamiento: '128GB', estado: 'Usado', precio: 380000, ...o });
  const acc = (o = {}) => ({ id: 'a1', nombre: 'Funda A54', categoria: 'Funda', precioVenta: 12500, precioCosto: 4000, stock: 5, publicar: true, ...o });

  console.log('\n1) El precio lo pone el servidor, con el stock');
  ok(T.precioEquipoARS(eq(), 0, AHORA) === 380000, 'equipo publicado y disponible: su precio');
  ok(T.precioEquipoARS(eq({ vendido: true, fecha_venta: '2026-11-25' }), 0, AHORA) === 0 && T.precioEquipoARS(eq({ reservado: true }), 0, AHORA) === 0
     && T.precioEquipoARS(eq({ publicar: false }), 0, AHORA) === 0, 'vendido, reservado o sin publicar: no se vende');
  ok(T.precioEquipoARS(eq({ moneda: 'usd', precioUSD: 300 }), 1210, AHORA) === 363000, 'en dólares: en pesos al dólar del día (redondeado a $100)');
  ok(T.precioEquipoARS(eq({ moneda: 'usd', precioUSD: 300 }), 0, AHORA) === 0, 'sin dólar del día, no se cobra un equipo en dólares');
  ok(T.precioAccesorioARS(acc()) === 12500 && T.precioAccesorioARS(acc({ publicar: false })) === 0 && T.precioAccesorioARS(acc({ stock: 0 })) === 0, 'accesorio: publicado y con stock');

  console.log('\n2) El carrito y los datos');
  const c = T.normalizarCarrito([{ tipo: 'equipo', id: 'e1', qty: 3, precio: 1 }, { tipo: 'accesorio', id: 'a1', qty: 2 }, { tipo: 'accesorio', id: 'a1', qty: 1 }, { tipo: 'x', id: 'z' }, { tipo: 'accesorio', id: '../config/owner' }]);
  ok(JSON.stringify(c) === '[{"tipo":"equipo","id":"e1","qty":1},{"tipo":"accesorio","id":"a1","qty":3}]', 'un equipo es uno solo, se juntan repetidos, y nada raro (ni el precio que mande la página)', c);
  ok(!T.validarDatos({ nombre: 'A', tlf: '1123456789' }).ok && !T.validarDatos({ nombre: 'Ana', tlf: '123' }).ok, 'pide nombre y WhatsApp');
  ok(!T.validarDatos({ nombre: 'Ana', tlf: '1123456789', entrega: 'envio' }).ok, 'con envío pide la dirección');
  const datos = T.validarDatos({ nombre: 'Ana', tlf: '11 2345-6789', entrega: 'envio', direccion: 'Mitre 1234, Caseros', modo: 'sena' }).datos;
  ok(datos.tlf === '1123456789' && datos.entrega === 'envio' && datos.modo === 'sena', 'limpia el teléfono', datos);

  console.log('\n3) El pedido: todo o seña');
  const docs = { 'equipo:e1': eq(), 'accesorio:a1': acc() };
  let r = T.armarPedido({ carrito: c, datos: { ...datos, modo: 'total' }, docs, cfg: null, dolar: 0, ahora: AHORA });
  ok(r.ok && r.pedido.total === 380000 + 3 * 12500 && r.pedido.aPagar === r.pedido.total && r.pedido.resto === 0, 'pagar todo: el total con los precios de la base', r.pedido);
  ok(r.pedido.items[0].nombre === 'Samsung A54 128 GB', 'con el nombre armado del stock', r.pedido.items[0].nombre);
  r = T.armarPedido({ carrito: c, datos, docs, cfg: null, dolar: 0, ahora: AHORA });
  ok(r.pedido.aPagar === 83500 && r.pedido.resto === 417500 - 83500, 'seña: el 20% (redondeado a $100)', r.pedido);
  ok(T.calcSena(20000, null) === 10000 && T.calcSena(5000, null) === 5000 && T.calcSena(100000, { senaPct: 30 }) === 30000, 'con mínimo de $10.000, nunca más que el total, y el % se puede cambiar');
  r = T.armarPedido({ carrito: [{ tipo: 'accesorio', id: 'a1', qty: 6 }], datos, docs, cfg: null, dolar: 0, ahora: AHORA });
  ok(!r.ok && /Funda A54/.test(r.error), 'si no alcanza el stock, dice qué', r.error);
  r = T.armarPedido({ carrito: c, datos, docs: { ...docs, 'equipo:e1': eq({ vendido: true }) }, cfg: null, dolar: 0, ahora: AHORA });
  ok(!r.ok && /Samsung A54/.test(r.error), 'si el celular se vendió mientras estaba en el carrito, también');

  console.log('\n4) Mercado Pago');
  const ped = T.armarPedido({ carrito: c, datos, docs, cfg: null, dolar: 0, ahora: AHORA }).pedido;
  const pref = T.preferenciaMP(ped, 'PED123');
  ok(pref.items.length === 1 && pref.items[0].unit_price === 83500 && pref.items[0].currency_id === 'ARS' && /^Seña: /.test(pref.items[0].title), 'se cobra lo que corresponde ahora (la seña)', pref.items[0]);
  ok(pref.external_reference === 'PED123' && /\/api\/tienda\?accion=webhook$/.test(pref.notification_url) && /\/equipos\?pedido=PED123$/.test(pref.back_urls.success), 'vuelve a la página y avisa a /api/tienda');
  const pago = { id: 999, status: 'approved', external_reference: 'PED123', currency_id: 'ARS', transaction_amount: 83500 };
  ok(T.pagoValido(pago, ped, 'PED123'), 'pago aprobado, de este pedido y por el monto: vale');
  ok(!T.pagoValido({ ...pago, status: 'pending' }, ped, 'PED123') && !T.pagoValido({ ...pago, external_reference: 'OTRO' }, ped, 'PED123')
     && !T.pagoValido({ ...pago, transaction_amount: 100 }, ped, 'PED123'), 'pendiente, de otro pedido o por menos plata: no vale');

  console.log('\n5) Cuando se paga');
  let ef = T.efectosDelPago(ped, 'PED123', pago, '2026-11-26T15:00:00Z', '2026-11-26');
  ok(ef.pedidoPatch.estado === 'pagado' && ef.pedidoPatch.montoPagado === 83500, 'el pedido queda pagado');
  ok(ef.productos.length === 1 && ef.productos[0].id === 'a1' && ef.productos[0].inc === -3, 'los accesorios bajan del stock');
  ok(ef.equipos[0].patch.reservado === true && ef.equipos[0].patch.reservaCliente === 'Ana' && ef.equipos[0].patch.reservaSena === Math.round(83500 * 380000 / 417500) && !ef.equipos[0].patch.vendido,
     'con seña, el celular queda RESERVADO a su nombre (con su parte de la seña)', ef.equipos[0].patch);
  ok(ef.caja.tipo === 'ingreso' && ef.caja.metodoPago === 'MercadoPago' && ef.caja.monto === 83500 && ef.caja.categoria === 'Seña venta' && ef.caja.fecha === '2026-11-26', 'en la caja: la seña, por Mercado Pago', ef.caja);
  ok(/PAGADO/.test(ef.telegram) && /Ana/.test(ef.telegram) && /1123456789/.test(ef.telegram) && /Envío a Mitre 1234/.test(ef.telegram) && /falta \$334\.000/.test(ef.telegram), 'Telegram: qué, quién, adónde y cuánto falta', ef.telegram);
  const pedT = T.armarPedido({ carrito: c, datos: { ...datos, modo: 'total', entrega: 'retiro', direccion: '' }, docs, cfg: null, dolar: 0, ahora: AHORA }).pedido;
  ef = T.efectosDelPago(pedT, 'P2', { ...pago, external_reference: 'P2', transaction_amount: pedT.aPagar }, '2026-11-26T15:00:00Z', '2026-11-26');
  ok(ef.equipos[0].patch.vendido === true && ef.equipos[0].patch.ventaOnline === 'P2' && ef.caja.categoria === 'Venta online' && /Retira en el local/.test(ef.telegram), 'pagado completo: el celular queda VENDIDO y la caja dice "Venta online"');
  ok(JSON.stringify(Object.keys(T.estadoPublico({ ...pedT, estado: 'pagado' })).sort()) === '["aPagar","entrega","estado","items","modo","total"]', 'a la vuelta, el cliente ve el estado (nada de nombre ni teléfono)');

  console.log('\n6) El servidor');
  const api = leer('api/tienda.js');
  ok(/process\.env\.MP_ACCESS_TOKEN/.test(api) && !/APP_USR-|TEST-\d/.test(api), 'la clave de Mercado Pago sale de Vercel (MP_ACCESS_TOKEN), nunca del código');
  ok(/if \(!process\.env\.MP_ACCESS_TOKEN\) return res\.status\(503\)\.json\(\{ error: 'sin_mp' \}\)/.test(api), 'sin la clave cargada, avisa (y la página ofrece mandar el pedido por WhatsApp)');
  ok(/stock: admin\.firestore\.FieldValue\.increment\(x\.inc\)/.test(api) && /t\.set\(db\.collection\('caja_movimientos'\)\.doc\(\), ef\.caja\)/.test(api), 'stock y caja en la misma transacción que marca el pedido pagado');

  console.log('\n7) El carrito en la página');
  const LS = {};
  const ctx = { console, JSON, Math, Number, String, Array, Object, Promise, setTimeout, clearTimeout, encodeURIComponent, URLSearchParams,
    localStorage: { getItem: k => LS[k] ?? null, setItem: (k, v) => { LS[k] = String(v); } } };
  vm.createContext(ctx);
  vm.runInContext(leer('tienda.js'), ctx, { filename: 'tienda.js' });
  const TI = ctx.TIENDA;
  TI.T.items = [];
  const avisos = [];
  ctx.document = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, addEventListener() {} }), body: { appendChild() {}, style: {} } };
  TI.agregar({ tipo: 'equipo', id: 'e1', nombre: 'Samsung A54', precio: '380000' });
  TI.agregar({ tipo: 'accesorio', id: 'a1', nombre: 'Funda', precio: '12500' });
  TI.agregar({ tipo: 'accesorio', id: 'a1', nombre: 'Funda', precio: '12500' });
  ok(TI.agregar({ tipo: 'equipo', id: 'e1', nombre: 'Samsung A54', precio: '380000' }) === false && TI.unidades() === 3, 'un celular entra una vez; los accesorios suman cantidad');
  ok(JSON.parse(LS.tpCarrito).length === 2, 'queda guardado en el navegador');
  ok(TI.totales().pesos === 405000 && TI.senaEstimada(405000) === 81000, 'total y seña estimada en la página');
  ok(/Dirección|dirección/.test(TI.validar({ entrega: 'envio', direccion: '', nombre: 'Ana', tlf: '1123456789' })) && TI.validar({ entrega: 'retiro', direccion: '', nombre: 'Ana', tlf: '11 2345 6789' }) === '', 'valida antes de mandar');
  const wa = TI.textoWhatsApp({ modo: 'sena', entrega: 'envio', direccion: 'Mitre 1234', nombre: 'Ana' });
  ok(/Samsung A54/.test(wa) && /2× Funda/.test(wa) && /seña/.test(wa) && /Mitre 1234/.test(wa), 'plan B: el pedido entero por WhatsApp', wa);
  const src = leer('tienda.js');
  ok(/items: T\.items\.map\(x => \(\{ tipo: x\.tipo, id: x\.id, qty: x\.qty \}\)\)/.test(src), 'a pagar manda tipo, id y cantidad: el precio no');
  ok(/data-carrito="equipo"/.test(leer('equipos.js')) && /data-carrito="accesorio"/.test(leer('accesorios.js')), '"🛒 Agregar" en cada celular y cada accesorio');
  ok(/<script src="tienda\.js"><\/script>/.test(leer('equipos.html')) && /<script src="tienda\.js"><\/script>/.test(leer('accesorios.html')), 'en las dos páginas');

  console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
  process.exit(fails ? 1 : 0);
})();
