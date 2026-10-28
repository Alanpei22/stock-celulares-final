// Facturación, fase 2: emitir Factura C en ARCA (homologación).
//
// Lo que más importa acá es la NUMERACIÓN: no puede haber huecos ni números
// repetidos, aunque se corte internet en el peor momento. Esta prueba simula
// ARCA (con sus respuestas reales: CAE, rechazo, 10016, 602) y Firestore, y
// recorre los casos feos: se corta después de que ARCA emitió, se corta
// antes, dos ventas a la vez, la misma venta dos veces.
//
// Lo que NO puede probar: que ARCA de verdad acepte el XML. Eso se ve con la
// primera factura de prueba contra homologación (action 'prueba').
const fs = require('fs'), path = require('path'), vm = require('vm');
const DIR = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(DIR, f), 'utf8');
let fails = 0;
const ok = (c, l, x) => { console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x))); if (!c) fails++; };

// ── Firestore de mentira ──
const DB = {};
const docRef = (col, id) => ({
  id,
  get: async () => ({ exists: !!DB[col + '/' + id], data: () => DB[col + '/' + id] && JSON.parse(JSON.stringify(DB[col + '/' + id])) }),
  set: async (v, o) => { DB[col + '/' + id] = (o && o.merge) ? Object.assign({}, DB[col + '/' + id] || {}, v) : Object.assign({}, v); },
});
const fakeDb = {
  collection: col => ({
    doc: id => docRef(col, id),
    where: function w(f1, _o1, v1) {
      const filtros = [[f1, v1]];
      const q = { where: (f, _o, v) => { filtros.push([f, v]); return q; },
        get: async () => ({ docs: Object.keys(DB).filter(k => k.startsWith(col + '/') && filtros.every(([f, v]) => DB[k][f] === v)).map(k => ({ id: k.slice(col.length + 1), data: () => DB[k] })) }) };
      return q;
    },
  }),
  runTransaction: async fn => fn({ get: r => r.get(), set: (r, v, o) => { r.set(v, o); } }),
};
globalThis.__fakeAdmin = { apps: [1], firestore: () => fakeDb };

// ── ARCA de mentira ──
const ARCA = { ultimo: 0, comps: {}, cortar: null, robarNumero: false, rechazar: false, llamadas: [] };
const tag = (x, t) => { const m = x.match(new RegExp(`<ar:${t}>([^<]*)</ar:${t}>`)); return m ? m[1] : null; };
globalThis.fetch = async (url, o) => {
  const accion = String(o.headers.SOAPAction || '').split('/').pop();
  ARCA.llamadas.push(accion);
  const resp = body => ({ text: async () => `<soap:Envelope><soap:Body>${body}</soap:Body></soap:Envelope>` });
  if (accion === 'FECompUltimoAutorizado') return resp(`<CbteNro>${ARCA.ultimo}</CbteNro>`);
  if (accion === 'FECompConsultar') {
    const n = Number(tag(o.body, 'CbteNro')), c = ARCA.comps[n];
    return resp(c ? `<ResultGet><CbteDesde>${n}</CbteDesde><CbteFch>20261028</CbteFch><ImpTotal>${c.importe}</ImpTotal><DocTipo>99</DocTipo><DocNro>0</DocNro><CodAutorizacion>${c.cae}</CodAutorizacion><FchVto>20261107</FchVto></ResultGet>`
      : `<Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros para los parametros ingresados.</Msg></Err></Errors>`);
  }
  if (accion === 'FECAESolicitar') {
    if (ARCA.cortar === 'antes') { ARCA.cortar = null; throw new Error('timeout'); }
    if (ARCA.robarNumero) { ARCA.robarNumero = false; ARCA.ultimo++; ARCA.comps[ARCA.ultimo] = { importe: 999, cae: '11111111111111' }; }
    const n = Number(tag(o.body, 'CbteDesde'));
    if (n !== ARCA.ultimo + 1) return resp(`<FeCabResp><Resultado>R</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>R</Resultado></FECAEDetResponse></FeDetResp><Errors><Err><Code>10016</Code><Msg>El numero o fecha del comprobante no se corresponde con el proximo a autorizar.</Msg></Err></Errors>`);
    if (ARCA.rechazar) { ARCA.rechazar = false; return resp(`<FeCabResp><Resultado>R</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10015</Code><Msg>Factura C: el DocNro es invalido</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp>`); }
    ARCA.ultimo = n;
    const cae = String(70000000000000 + n);
    ARCA.comps[n] = { importe: Number(tag(o.body, 'ImpTotal')), cae };
    if (ARCA.cortar === 'despues') { ARCA.cortar = null; throw new Error('socket hang up'); }
    return resp(`<FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Concepto>1</Concepto><CbteDesde>${n}</CbteDesde><Resultado>A</Resultado><CAE>${cae}</CAE><CAEFchVto>20261107</CAEFchVto></FECAEDetResponse></FeDetResp>`);
  }
  throw new Error('acción inesperada ' + accion);
};

process.env.ARCA_ENTORNO = 'homologacion';
process.env.ARCA_CUIT = '20385199628';
process.env.ARCA_PTO_VENTA = '6';
// Token en caché: no hace falta firmar nada
DB['config/arca_ta_homologacion'] = { token: 'T', sign: 'S', expira: new Date(Date.now() + 6 * 3600e3).toISOString() };

const TMP_FE = path.join(__dirname, '_tmp-arca-fe.mjs');
const TMP = path.join(__dirname, '_tmp-arca-emitir.mjs');
fs.writeFileSync(TMP_FE, leer('api/_arca-fe.js'));
fs.writeFileSync(TMP, leer('api/_arca.js')
  .replace("import admin from 'firebase-admin';", 'const admin = globalThis.__fakeAdmin;')
  .replace("from './_arca-fe.js'", "from './_tmp-arca-fe.mjs'"));

(async () => {
try {
  const fe = await import('file://' + TMP_FE.replace(/\\/g, '/'));
  const arca = await import('file://' + TMP.replace(/\\/g, '/'));

  console.log('\n1) Armar el pedido');
  let d = fe.normalizarDetalle({ importe: '15000.499', fecha: '2026-10-28' });
  ok(d.importe === 15000.5 && d.docTipo === 99 && d.docNro === 0 && d.condIva === 5 && d.concepto === 1 && d.fecha === '20261028', 'por defecto: consumidor final, productos, redondeado', d);
  ok(fe.normalizarDetalle({ importe: 0 }).error && fe.normalizarDetalle({ importe: 1e9 }).error, 'importe cero o disparatado: no');
  ok(fe.normalizarDetalle({ importe: 10, docTipo: 'cuit', docNro: '20-123' }).error, 'CUIT incompleto: no');
  d = fe.normalizarDetalle({ importe: 10, docTipo: 'dni', docNro: '30.123.456', concepto: 'ambos' });
  ok(d.docTipo === 96 && d.docNro === 30123456 && d.concepto === 3, 'con DNI y reparación (productos y servicios)', d);
  let x = fe.armarFECAE({ ptoVenta: 6, nro: 7, detalle: fe.normalizarDetalle({ importe: 1234.5, fecha: '2026-10-28' }) });
  ok(/<ar:PtoVta>6<\/ar:PtoVta><ar:CbteTipo>11<\/ar:CbteTipo>/.test(x), 'Factura C (11) en el punto de venta 6');
  ok(/<ar:CbteDesde>7<\/ar:CbteDesde><ar:CbteHasta>7<\/ar:CbteHasta>/.test(x) && /<ar:ImpTotal>1234\.50<\/ar:ImpTotal>/.test(x) && /<ar:ImpNeto>1234\.50<\/ar:ImpNeto>/.test(x) && /<ar:ImpIVA>0\.00<\/ar:ImpIVA>/.test(x), 'número e importes (sin IVA: es C)');
  ok(/<ar:CondicionIVAReceptorId>5<\/ar:CondicionIVAReceptorId>/.test(x), 'con la condición de IVA del cliente (obligatoria)');
  ok(!/FchServDesde/.test(x), 'productos: sin fechas de servicio');
  ok(/MonCotiz>1<\/ar:MonCotiz><ar:CondicionIVAReceptorId/.test(x), 'en el orden del esquema de ARCA');
  x = fe.armarFECAE({ ptoVenta: 6, nro: 7, detalle: fe.normalizarDetalle({ importe: 10, concepto: 'ambos', fecha: '2026-10-28' }) });
  ok(/<ar:FchServDesde>20261028<\/ar:FchServDesde><ar:FchServHasta>20261028<\/ar:FchServHasta><ar:FchVtoPago>20261028<\/ar:FchVtoPago>/.test(x), 'reparación: con las fechas del servicio');
  const qr = fe.datosQR({ cuit: '20385199628', ptoVenta: 6, nro: 7, cae: '70000000000007', detalle: fe.normalizarDetalle({ importe: 10, fecha: '2026-10-28' }) });
  ok(qr.fecha === '2026-10-28' && qr.cuit === 20385199628 && qr.tipoCmp === 11 && qr.tipoCodAut === 'E' && qr.codAut === 70000000000007 && qr.importe === 10, 'los datos del QR obligatorio', qr);

  console.log('\n2) Facturar');
  const det = fe.normalizarDetalle({ importe: 15000 });
  let f = await arca.emitirFactura({ id: 'v1', detalle: det });
  ok(f.estado === 'emitida' && f.nro === 1 && /^\d{14}$/.test(f.cae) && f.caeVto === '2026-11-07', 'sale con número 1 y CAE', f);
  ok(DB['facturas/v1'].estado === 'emitida' && DB['facturas/v1'].qr.nroCmp === 1, 'queda guardada con lo del QR');
  ARCA.llamadas = [];
  f = await arca.emitirFactura({ id: 'v1', detalle: det });
  ok(f.yaEstaba && f.nro === 1 && !ARCA.llamadas.includes('FECAESolicitar'), 'la misma venta otra vez: devuelve la que ya estaba, no emite otra');

  console.log('\n3) Se corta DESPUÉS de que ARCA la emitió');
  ARCA.cortar = 'despues';
  let err = null;
  try { await arca.emitirFactura({ id: 'v2', detalle: det }); } catch (e) { err = e.message; }
  ok(/No se supo si ARCA la emitió/.test(err || ''), 'avisa que no se sabe', err);
  ok(DB['facturas/v2'].estado === 'emitiendo' && DB['facturas/v2'].nro === 2, 'queda anotado qué número se intentó');
  err = null;
  try { await arca.emitirFactura({ id: 'v2', detalle: det }); } catch (e) { err = e.message; }
  ok(/se está facturando/.test(err || ''), 'reintentar enseguida: espera (puede seguir en camino)', err);
  DB['facturas/v2'].desde = new Date(Date.now() - 2 * 60e3).toISOString();
  ARCA.llamadas = [];
  f = await arca.emitirFactura({ id: 'v2', detalle: det });
  ok(f.estado === 'emitida' && f.nro === 2 && ARCA.ultimo === 2, 'al reintentar le pregunta a ARCA y se queda con la 2: no la repite', { f, ultimo: ARCA.ultimo });
  ok(ARCA.llamadas[0] === 'FECompConsultar' && !ARCA.llamadas.includes('FECAESolicitar'), 'primero consulta, y no pide otro CAE');

  console.log('\n4) Se corta ANTES de que ARCA la reciba');
  ARCA.cortar = 'antes';
  try { await arca.emitirFactura({ id: 'v3', detalle: det }); } catch (e) { err = e.message; }
  DB['facturas/v3'].desde = new Date(Date.now() - 2 * 60e3).toISOString();
  f = await arca.emitirFactura({ id: 'v3', detalle: det });
  ok(f.nro === 3 && ARCA.ultimo === 3, 'ARCA no la tenía: sale con la 3, sin hueco', f.nro);

  console.log('\n5) Otra venta se llevó el número');
  ARCA.robarNumero = true;
  f = await arca.emitirFactura({ id: 'v4', detalle: det });
  ok(f.nro === 5 && ARCA.comps[4].importe === 999, 'ARCA dijo 10016: vuelve a preguntar y sale con la 5', f.nro);

  console.log('\n6) Mismo importe, número de otra venta');
  // v5 quedó a medias con el número 6, pero el 6 lo emitió OTRA venta del
  // mismo importe (v6) que ya lo tiene guardado: no se lo puede quedar
  ARCA.comps[6] = { importe: 15000, cae: '70000000000006' }; ARCA.ultimo = 6;
  DB['facturas/v6'] = { estado: 'emitida', ptoVenta: 6, nro: 6 };
  DB['facturas/v5'] = { estado: 'emitiendo', nro: 6, desde: new Date(Date.now() - 2 * 60e3).toISOString() };
  f = await arca.emitirFactura({ id: 'v5', detalle: det });
  ok(f.nro === 7, 'no se queda con la factura de otra venta: sale con la 7', f.nro);

  console.log('\n7) Rechazo');
  ARCA.rechazar = true;
  err = null;
  try { await arca.emitirFactura({ id: 'v7', detalle: det }); } catch (e) { err = e.message; }
  ok(/ARCA la rechazó: \[10015\] Factura C: el DocNro es invalido/.test(err || ''), 'el motivo de ARCA, tal cual', err);
  ok(DB['facturas/v7'].estado === 'rechazada' && DB['facturas/v7'].nro === null && ARCA.ultimo === 7, 'queda rechazada y no consume número');
  f = await arca.emitirFactura({ id: 'v7', detalle: det });
  ok(f.estado === 'emitida' && f.nro === 8, 'se puede reintentar');

  console.log('\n8) El endpoint');
  const fac = leer('api/factura.js');
  ok(/exigirSesion\(req, res\)/.test(fac), 'pide sesión');
  ok(/collection\('caja_movimientos'\)\.doc\(movId\)/.test(fac) && /importe: mov\.monto/.test(fac), 'el importe sale de la venta guardada, no del navegador');
  ok(/entorno !== 'homologacion'/.test(fac), 'las facturas de prueba, solo en homologación');
  const sf = fac.slice(fac.indexOf('const NO_SE_FACTURA'), fac.indexOf('export default')).replace('export function', 'function');
  const c = {}; vm.createContext(c); vm.runInContext(sf + '\nthis.seFactura = seFactura;', c);
  ok(c.seFactura({ metodoPago: 'Transferencia' }) && c.seFactura({ metodoPago: 'Tarjeta débito' }), 'transferencia y tarjeta: se facturan');
  ok(!c.seFactura({ metodoPago: 'Efectivo' }) && !c.seFactura({ metodoPago: 'Dólares' }), 'efectivo y dólares: no');
  ok(c.seFactura({ metodoPago: 'Efectivo', metodoPago2: 'MercadoPago', monto2: 5000 }), 'mitad efectivo, mitad MercadoPago: se factura entera');

  console.log('\n9) Producción, bloqueada');
  process.env.ARCA_ENTORNO = 'produccion';
  err = null;
  try { await arca.emitirFactura({ id: 'p', detalle: det }); } catch (e) { err = e.message; }
  ok(/producción todavía no está habilitado/.test(err || ''), 'sin ARCA_EMITIR_PRODUCCION=si no factura de verdad', err);
} catch (e) {
  console.error(e); fails++;
} finally {
  try { fs.unlinkSync(TMP); fs.unlinkSync(TMP_FE); } catch {}
}
console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})();
