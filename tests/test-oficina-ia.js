// ✨ Pensalo con IA (🏢 La oficina): cada personaje le pasa a la IA lo suyo
// y vuelve un plan con mensajes listos.
//
// Lo que se cuida:
//  · el servidor arma un pedido válido y cerrado (solo personajes conocidos,
//    JSON con forma fija, sin datos de más) y lee bien la respuesta;
//  · a la IA no viajan teléfonos ni apellidos, y sin permiso no van montos;
//  · el botón muestra "pensando", después la respuesta, y la guarda;
//  · el WhatsApp sale con la orden de la app, no con un número de la IA.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = path.join(__dirname, '..') + '/';
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };
const leer = f => fs.readFileSync(DIR + f, 'utf8');

(async () => {
console.log('\n1) Servidor: el pedido a la IA');
const api = leer('api/ai.js');
const ini = api.indexOf('export const OFICINA_IA_PJ'), fin = api.indexOf('// La respuesta del modelo → un ticket');
const sctx = { JSON, String, Array, Date, Number, Object };
vm.createContext(sctx);
vm.runInContext(api.slice(ini, fin).replace(/export (const|function) /g, '$1 ') + '\nthis.armar = oficinaArmarPedido; this.leerR = oficinaLeerRespuesta;', sctx);
const AH = new Date('2026-10-26T18:00:00Z');
ok(sctx.armar({ pj: 'hacker' }, AH).error, 'personaje desconocido → error (no es un chat abierto)');
ok(sctx.armar({ pj: 'tito', datos: { x: 'a'.repeat(50000) } }, AH).error, 'demasiados datos → error');
const p = sctx.armar({ pj: 'tito', pregunta: '¿Qué hago primero?', hallazgos: ['La #1 lleva 9 días'], datos: { ordenes: [{ id: 'a' }] } }, AH).body;
ok(p.model === 'claude-opus-5-5' && p.max_tokens >= 8000, 'modelo y lugar para pensar', [p.model, p.max_tokens]);
ok(p.thinking && p.thinking.type === 'adaptive' && p.output_config.effort === 'medium', 'piensa (adaptive) con esfuerzo medio');
ok(p.output_config.format.type === 'json_schema' && p.output_config.format.schema.required.join() === 'respuesta,pasos,borradores', 'respuesta con forma fija');
ok(p.fallbacks === 'default', 'si se niega por error, reintenta con otro modelo');
ok(!('temperature' in p) && p.messages.length === 1 && p.messages[0].role === 'user', 'sin temperatura ni prefill');
ok(/Tito/.test(p.system) && /rioplatense/.test(p.system) && /Nunca inventes/.test(p.system), 'el personaje, el tono y "no inventar"');
ok(/¿Qué hago primero\?/.test(p.messages[0].content) && /La #1 lleva 9 días/.test(p.messages[0].content) && /2026-10-26 15:00/.test(p.messages[0].content), 'van la pregunta, los avisos y la hora de Argentina');
ok(/action === 'oficina'/.test(api) && /server-side-fallback-2026-07-01/.test(api), 'la acción vive en /api/ai (detrás de la sesión) con el header de fallbacks');
ok(/setInterval\(\(\) => \{ w\.write\(enc\.encode\(' '\)\)/.test(api), 'mientras piensa manda espacios (Vercel no corta a los 25 s)');

console.log('\n2) Servidor: la respuesta');
ok(/no responder/.test(sctx.leerR({ stop_reason: 'refusal', content: [] }).error), 'se negó → mensaje claro');
ok(/largo/.test(sctx.leerR({ stop_reason: 'max_tokens', content: [] }).error), 'se cortó → mensaje claro');
ok(sctx.leerR({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hola' }] }).error, 'texto que no es JSON → error');
let r = sctx.leerR({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: JSON.stringify({ respuesta: 'Arrancá por la #1', pasos: ['a', '', 'b'], borradores: [{ titulo: 'Juan', texto: 'Hola Juan', ref: 'd' }, { titulo: 'vacío', texto: '', ref: '' }] }) }] });
ok(r.ia && r.ia.respuesta === 'Arrancá por la #1' && r.ia.pasos.join() === 'a,b' && r.ia.borradores.length === 1, 'lee el JSON y descarta lo vacío', r);
ok(sctx.leerR({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"respuesta":"","pasos":[],"borradores":[]}' }] }).error, 'respuesta vacía → error');

console.log('\n3) Lo que cada personaje le cuenta a la IA');
const LS = {};
const els = {};
let RESP = null, ENVIADO = null, WA = null;
const ctx = { console, Math, Date, JSON, Number, String, Array, Object, Set, Promise,
  localStorage: { getItem: k => LS[k] ?? null, setItem: (k, v) => { LS[k] = String(v); } },
  document: { getElementById: id => els[id] || null, activeElement: null, head: { appendChild() {} }, createElement: () => ({}) },
  apiFetch: async (url, o) => { ENVIADO = JSON.parse(o.body); return { status: 200, text: async () => RESP }; },
  repairWhatsAppText: (id, txt) => { WA = [id, txt]; },
  toast() {},
};
vm.createContext(ctx);
vm.runInContext(leer('oficina.js'), ctx, { filename: 'oficina.js' });
const run = (c, v) => { ctx._v = v; return vm.runInContext(c, ctx); };
const AHORA = Date.parse('2026-10-26T15:00:00-03:00');
const h = n => new Date(AHORA - n * 3600e3).toISOString();
const REPS = [
  { id: 'a', nOrden: 8350, marca: 'Moto', modelo: 'G32', estado: 'reparando', fechaIngreso: h(24 * 9), tecnico: 'Nacho', nombre: 'Juan Pérez', tlf: '1155554444', presupuesto: 45000, arreglo: 'Módulo' },
  { id: 'd', nOrden: 8398, estado: 'listo', nombre: 'Ana Gómez', tlf: '11', fechaIngreso: h(24 * 20), fechaListo: h(24 * 10) },
  { id: 'e', nOrden: 5191, estado: 'listo', fechaIngreso: h(24 * 945) },
  { id: 'f', nOrden: 8400, estado: 'entregado', fechaIngreso: h(24 * 3) },
];
let d = run(`oficinaDatosIA('tito', Object.assign({ ahora: ${AHORA} }, _v))`, { repairs: REPS, verPlata: true });
const oA = d.ordenes.find(o => o.id === 'a'), oD = d.ordenes.find(o => o.id === 'd');
ok(d.ordenes.map(o => o.id).join() === 'd,a', 'Tito: solo órdenes abiertas recientes, la más vieja primero (ni entregadas ni de hace años)', d.ordenes.map(o => o.id));
ok(oA.cliente === 'Juan' && !JSON.stringify(d).includes('5555') && !JSON.stringify(d).includes('Pérez'), 'Tito: nombre de pila, sin teléfono ni apellido');
ok(oA.tieneWhatsApp === true && oA.presupuesto === 45000 && oD.diasLista === 10, 'Tito: si tiene WhatsApp, presupuesto y días lista');
ok(d.enTallerPorTecnico.Nacho === 1, 'Tito: cuántas tiene cada técnico');
d = run(`oficinaDatosIA('tito', Object.assign({ ahora: ${AHORA} }, _v))`, { repairs: REPS, verPlata: false });
ok(!JSON.stringify(d).includes('presupuesto'), 'Tito sin permiso de totales: sin presupuesto');
d = run(`oficinaDatosIA('rosa', _v)`, {
  repuestos: [{ id: 'r1', tipo: 'Módulo', marca: 'Moto', modelo: 'G32', cantidad: 1, stockMin: 2 }, { id: 'r2', tipo: 'Batería', cantidad: 30, stockMin: 2 }],
  productos: [{ id: 'p1', nombre: 'Cargador 20W', stock: 0, stockMin: 0 }],
  pedidos: [{ nombre: 'Funda A15', cantidad: 3, comprado: false }, { nombre: 'Vieja', comprado: true }] });
ok(d.repuestosBajos.length === 1 && d.repuestosBajos[0].nombre === 'Módulo Moto G32' && d.repuestosBajos[0].tipo === 'Módulo', 'Rosa: lo que está bajo, no lo que sobra', d.repuestosBajos);
ok(d.accesoriosBajos[0].nombre === 'Cargador 20W' && d.yaEnElPedido.length === 1, 'Rosa: accesorios agotados y lo que ya está pedido');
const MOVS = [{ tipo: 'ingreso', monto: 10000, metodoPago: 'Efectivo', categoria: 'Reparación', gananciaARS: 6000 },
  { tipo: 'ingreso', monto: 50000, metodoPago: 'Tarjeta débito', categoria: 'Venta equipo', sinCosto: true },
  { tipo: 'egreso', monto: 3000, metodoPago: 'Efectivo', categoria: 'Gasto' }];
d = run(`oficinaDatosIA('beto', _v)`, { caja: { arqueo: true, cierre: false, movs: MOVS }, verPlata: true, tarjetas: {} });
ok(d.ingresosHoy === 60000 && d.egresosHoy === 3000 && d.ventasSinCosto === 1 && d.porMetodoDePago.Efectivo.cantidad === 2, 'Beto: resumen del día con montos', d);
d = run(`oficinaDatosIA('beto', _v)`, { caja: { arqueo: true, cierre: false, movs: MOVS }, verPlata: false, tarjetas: {} });
ok(!JSON.stringify(d).match(/10000|50000|60000|total|ingresosHoy/) && d.movimientosHoy === 3 && d.seVenLosMontos === false, 'Beto sin permiso: cuántos y cómo, ningún monto', d);

d = run(`oficinaDatosIA('lu', Object.assign({ ahora: ${AHORA} }, _v))`, { verPlata: false, dolar: 1200, equipos: [
  { id: 'e1', marca: 'Samsung', modelo: 'A15', estado: 'Usado', fecha: h(24 * 60), precio: 300000, costo: 200000, publicar: true, fotos: ['u'] },
  { id: 'e2', marca: 'Moto', modelo: 'G32', fecha: h(24), precio: 250000, vendido: true }] });
ok(d.equipos.length === 1 && d.equipos[0].diasEnStock === 60 && d.equipos[0].precioPesos === 300000 && d.equipos[0].enLaPagina && d.dolarBlue === 1200, 'Lu: equipos en venta con días, precio y si están en la página', d);
ok(!('costoPesos' in d.equipos[0]), 'Lu sin permiso de totales: sin costo');
vm.runInContext(leer('horas.js'), ctx, { filename: 'horas.js' });
d = run(`oficinaDatosIA('marta', Object.assign({ ahora: ${AHORA} }, _v))`, { esDueno: true,
  fichadas: [{ uid: 'u1', nombre: 'Nacho', tipo: 'entrada', ts: { toMillis: () => Date.parse('2026-10-24T10:00:00-03:00') } }, { uid: 'u1', nombre: 'Nacho', tipo: 'salida', ts: { toMillis: () => Date.parse('2026-10-24T18:00:00-03:00') } }],
  repairs: [{ id: 'x', estado: 'entregado', nombre: 'Ana Gómez', tlf: '1144443333', marca: 'Moto', modelo: 'E13', fechaEntrega: h(48) }] });
ok(d.horasUltimos7Dias.Nacho.horas === 8 && d.horasUltimos7Dias.Nacho.dias[0].entrada === '10:00', 'Marta: horas de cada uno', d.horasUltimos7Dias);
ok(d.clientesQueRetiraron[0].cliente === 'Ana' && !JSON.stringify(d).includes('4444'), 'Marta: clientes que retiraron, sin teléfono');
d = run(`oficinaDatosIA('marta', Object.assign({ ahora: ${AHORA} }, _v))`, { esDueno: false, fichadas: [], repairs: [] });
ok(!('horasUltimos7Dias' in d), 'Marta con un empleado: sin las horas de los demás');

console.log('\n4) El botón');
run(`_ofVisible = true; REPAIRS = _v; _repairsLoaded = true;`, REPS);
els['d-oficina'] = { clientWidth: 1200, innerHTML: '' };
RESP = '   ' + JSON.stringify({ ia: { respuesta: 'Primero la #8350.', pasos: ['Llamá a Ana'], borradores: [{ titulo: 'Retiro', texto: 'Hola Ana, tu equipo está listo. TechPoint', ref: 'd' }, { titulo: 'Proveedor', texto: 'Pedido…', ref: '' }] } });
const prom = run(`oficinaIA('tito')`);
ok(/Tito está pensando/.test(els['d-oficina'].innerHTML), 'mientras espera dice que está pensando');
await prom;
ok(ENVIADO.action === 'oficina' && ENVIADO.data.pj === 'tito' && ENVIADO.data.datos.ordenes.length === 2 && ENVIADO.data.hallazgos.length > 0, 'manda personaje, datos y avisos', ENVIADO && ENVIADO.data.pj);
const html = els['d-oficina'].innerHTML;
ok(/Primero la #8350/.test(html) && /Llamá a Ana/.test(html) && /Hola Ana, tu equipo está listo/.test(html), 'muestra respuesta, pasos y mensajes (los espacios del principio no molestan)');
ok(/Mandar a Ana/.test(html) && (html.match(/📋 Copiar/g) || []).length === 2, 'WhatsApp solo donde hay orden con teléfono; copiar en todos');
run(`oficinaIABorrador(0, 'wa')`);
ok(WA && WA[0] === 'd' && /tu equipo está listo/.test(WA[1]), 'el WhatsApp sale con la orden de la app', WA);
ok(JSON.parse(LS.oficinaIA).tito.ia.respuesta === 'Primero la #8350.', 'la respuesta queda guardada (no se paga dos veces)');
RESP = JSON.stringify({ error: 'Se le hizo muy largo' });
await run(`oficinaIA('rosa')`);
ok(/Se le hizo muy largo/.test(els['d-oficina'].innerHTML) && /Probar de nuevo/.test(els['d-oficina'].innerHTML), 'si falla, lo dice y deja reintentar');
ctx.apiFetch = async () => ({ status: 401, text: async () => 'Unauthorized' });
await run(`oficinaIA('beto')`);
ok(/sesión venció/.test(els['d-oficina'].innerHTML), 'sesión vencida → explica qué hacer');
ctx.document.activeElement = { id: 'of-ia-preg' };
els['d-oficina'].innerHTML = 'X';
run(`oficinaRender()`);
ok(els['d-oficina'].innerHTML === 'X', 'mientras escribís la pregunta, el refresco no te borra lo escrito');

console.log(fails ? `\n✗ ${fails} fallas` : '\n✓ todo bien');
process.exit(fails ? 1 : 0);
})();
