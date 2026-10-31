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
  set: async (v, o) => {
    const prev = DB[col + '/' + id] || {};
    if (v && v.meses) {   // config/facturacionTotales: increment por mes
      const meses = Object.assign({}, prev.meses || {});
      Object.keys(v.meses).forEach(k => { const x = v.meses[k]; meses[k] = (x && x.__inc != null) ? (meses[k] || 0) + x.__inc : x; });
      DB[col + '/' + id] = Object.assign({}, prev, v, { meses }); return;
    }
    DB[col + '/' + id] = (o && o.merge) ? Object.assign({}, prev, v) : Object.assign({}, v);
  },
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
const _fs = () => fakeDb;
_fs.FieldValue = { increment: n => ({ __inc: n }) };
globalThis.__fakeAdmin = { apps: [1], firestore: _fs };

// ── ARCA de mentira ──
const ARCA = { ultimo: 0, comps: {}, cortar: null, robarNumero: false, rechazar: false, llamadas: [], nc: { ultimo: 0, comps: {}, ultimoBody: '' } };
const tag = (x, t) => { const m = x.match(new RegExp(`<ar:${t}>([^<]*)</ar:${t}>`)); return m ? m[1] : null; };
globalThis.fetch = async (url, o) => {
  const accion = String(o.headers.SOAPAction || '').split('/').pop();
  ARCA.llamadas.push(accion);
  const resp = body => ({ text: async () => `<soap:Envelope><soap:Body>${body}</soap:Body></soap:Envelope>` });
  if (accion === 'FECompUltimoAutorizado') return resp(`<CbteNro>${tag(o.body, 'CbteTipo') === '13' ? ARCA.nc.ultimo : ARCA.ultimo}</CbteNro>`);
  if (accion === 'FECompConsultar') {
    const n = Number(tag(o.body, 'CbteNro')), c = ARCA.comps[n];
    return resp(c ? `<ResultGet><CbteDesde>${n}</CbteDesde><CbteFch>20261028</CbteFch><ImpTotal>${c.importe}</ImpTotal><DocTipo>99</DocTipo><DocNro>0</DocNro><CodAutorizacion>${c.cae}</CodAutorizacion><FchVto>20261107</FchVto></ResultGet>`
      : `<Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros para los parametros ingresados.</Msg></Err></Errors>`);
  }
  if (accion === 'FECAESolicitar' && tag(o.body, 'CbteTipo') === '13') {
    // Nota de Crédito C: su propia numeración
    ARCA.nc.ultimoBody = o.body;
    const n = Number(tag(o.body, 'CbteDesde'));
    if (n !== ARCA.nc.ultimo + 1) return resp(`<Errors><Err><Code>10016</Code><Msg>numero</Msg></Err></Errors>`);
    ARCA.nc.ultimo = n;
    const cae = String(80000000000000 + n);
    ARCA.nc.comps[n] = { importe: Number(tag(o.body, 'ImpTotal')), cae };
    return resp(`<FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><CbteDesde>${n}</CbteDesde><Resultado>A</Resultado><CAE>${cae}</CAE><CAEFchVto>20261110</CAEFchVto></FECAEDetResponse></FeDetResp>`);
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
  arca._usarTransporte((url, o) => globalThis.fetch(url, o));   // el ARCA de mentira

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

  console.log('\n9) Pasar a producción');
  const crypto = require('crypto');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const csrPem = arca.armarCSR({ keyPem: privateKey, cuit: '20385199628', razonSocial: 'RICARDI ALAN AGUSTIN' });
  const forge = require(path.join(DIR, 'node_modules/node-forge'));
  const csr = forge.pki.certificationRequestFromPem(csrPem);
  ok(/BEGIN CERTIFICATE REQUEST/.test(csrPem) && csr.verify(), 'el pedido de certificado (CSR) sale firmado y válido');
  ok(csr.subject.getField({ type: '2.5.4.5' }).value === 'CUIT 20385199628' && csr.subject.getField('O').value === 'RICARDI ALAN AGUSTIN' && csr.subject.getField('C').value === 'AR', 'con el CUIT y la razón social, como pide ARCA');
  const pub = forge.pki.privateKeyFromPem(privateKey);
  ok(csr.publicKey.n.equals(pub.n), 'con la misma clave que ya está en Vercel (la clave no sale de ahí)');
  const fac2 = leer('api/factura.js');
  ok(/action === 'csr'/.test(fac2) && /esDuenoUid\(s\.uid\)/.test(fac2), 'el CSR lo pide solo el dueño');
  const cert = forge.pki.createCertificate();
  cert.publicKey = csr.publicKey; cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-10-29'); cert.validity.notAfter = new Date('2028-10-29T00:00:00Z');
  cert.setSubject(csr.subject.attributes); cert.setIssuer(csr.subject.attributes); cert.sign(pub, forge.md.sha256.create());
  ok(arca.certVence(forge.pki.certificateToPem(cert)) === '2028-10-29T00:00:00.000Z' && arca.certVence('basura') === null, 'sabe cuándo vence el certificado');

  // Una factura de PRUEBA hecha sobre una venta real no traba la de verdad
  process.env.ARCA_ENTORNO = 'produccion'; process.env.ARCA_EMITIR_PRODUCCION = 'si';
  DB['config/arca_ta_produccion'] = { token: 'T', sign: 'S', expira: new Date(Date.now() + 6 * 3600e3).toISOString() };
  ARCA.llamadas = [];
  f = await arca.emitirFactura({ id: 'v1', detalle: det });
  ok(!f.yaEstaba && f.estado === 'emitida' && DB['facturas/v1'].entorno === 'produccion' && ARCA.llamadas.includes('FECAESolicitar'), 'una venta con factura de prueba se factura de verdad en producción', f);
  delete process.env.ARCA_EMITIR_PRODUCCION;

  console.log('\n10) El cifrado viejo de ARCA, solo para ARCA');
  // servicios1.afip.gov.ar (producción) usa DH de 1024 bits: Node lo corta con
  // "dh key too small". Se acepta SOLO hacia los servidores de ARCA.
  const srcA = leer('api/_arca.js');
  ok(/ciphers: 'DEFAULT@SECLEVEL=1'/.test(srcA) && (srcA.match(/SECLEVEL=1'/g) || []).length === 1, 'acepta el cifrado viejo en un único lugar (el agente de ARCA)');
  ok(!/rejectUnauthorized:\s*false/.test(srcA), 'sigue verificando el certificado del servidor');
  ok(!/await fetch\(/.test(srcA), 'todas las llamadas a ARCA pasan por ese agente');
  const otros = [];
  for (const u of ['https://evil.com/x', 'http://servicios1.afip.gov.ar/x', 'https://afip.gov.ar.evil.com/x']) {
    try { await arca._probarHost(u); otros.push(u + ' PASÓ'); } catch (e) { otros.push(/Solo se habla con servidores de ARCA/.test(e.message) ? 'ok' : e.message); }
  }
  ok(otros.every(x => x === 'ok'), 'con otro servidor (o sin https, o un dominio disfrazado) ni intenta conectarse', otros);
  let errMsg = null;
  arca._usarTransporte(async () => { const e = new Error('fetch failed'); e.cause = { code: 'ERR_SSL_DH_KEY_TOO_SMALL', message: 'dh key too small' }; throw e; });
  try { await arca.dummy(); } catch (e) { errMsg = e.message; }
  ok(/No se pudo conectar con ARCA \(servicios1\.afip\.gov\.ar\): ERR_SSL_DH_KEY_TOO_SMALL · dh key too small/.test(errMsg || ''), 'si no conecta, dice el servidor y el motivo', errMsg);
  arca._usarTransporte((url, o) => globalThis.fetch(url, o));

  console.log('\n11) Anular: Nota de Crédito C');
  process.env.ARCA_ENTORNO = 'homologacion'; delete process.env.ARCA_EMITIR_PRODUCCION;
  let x2 = fe.armarFECAE({ ptoVenta: 6, cbteTipo: 13, nro: 1, detalle: fe.normalizarDetalle({ importe: 10, concepto: 'ambos', fecha: '2026-10-31' }),
    asociado: { tipo: 11, ptoVenta: 6, nro: 7, cuit: '20385199628', fecha: '20261029' } });
  ok(/<ar:CbteTipo>13<\/ar:CbteTipo>/.test(x2) && /<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>11<\/ar:Tipo><ar:PtoVta>6<\/ar:PtoVta><ar:Nro>7<\/ar:Nro><ar:Cuit>20385199628<\/ar:Cuit><ar:CbteFch>20261029<\/ar:CbteFch><\/ar:CbteAsoc><\/ar:CbtesAsoc>/.test(x2),
     'la NC dice qué factura anula (tipo, punto de venta, número, CUIT y fecha)');
  ok(/<ar:CondicionIVAReceptorId>5<\/ar:CondicionIVAReceptorId><ar:CbtesAsoc>/.test(x2), 'en el orden del esquema (después de la condición de IVA)');
  const fAnt = DB['facturas/v1'];   // la de la sección 2, en homologación... se rehace una limpia
  DB['facturas/a1'] = { estado: 'emitida', entorno: 'homologacion', cbteTipo: 11, ptoVenta: 6, nro: 7, importe: 15000, movId: 'a1',
    detalle: fe.normalizarDetalle({ importe: 15000, concepto: 'ambos', fecha: '2026-10-29' }), receptor: { docTipo: 99 } };
  const nc = await arca.anularFactura({ id: 'a1' });
  ok(nc.cbteTipo === 13 && nc.nro === 1 && /^8\d{13}$/.test(nc.cae), 'sale la NC con su propio número (la 1) y CAE', nc);
  ok(ARCA.nc.comps[1].importe === 15000, 'por el mismo importe de la factura');
  ok(/<ar:FchServDesde>20261029<\/ar:FchServDesde>/.test(ARCA.nc.ultimoBody), 'el servicio es el de la factura (no el de hoy)');
  ok(DB['facturas/a1'].anulada && DB['facturas/a1'].anulada.nro === 1 && DB['facturas/nc_a1'].anulaA === 'a1', 'la factura queda marcada como anulada, y la NC sabe a cuál anula');
  ARCA.llamadas = [];
  const nc2 = await arca.anularFactura({ id: 'a1' });
  ok(nc2.yaEstaba && !ARCA.llamadas.includes('FECAESolicitar'), 'anularla dos veces no hace dos notas de crédito');
  let e2 = null;
  try { await arca.anularFactura({ id: 'noexiste' }); } catch (e) { e2 = e.message; }
  ok(/no tiene factura/.test(e2 || ''), 'una venta sin factura no se "anula"');
  const facA = leer('api/factura.js');
  ok(/action === 'anular'/.test(facA) && /Anular una factura es solo del dueño/.test(facA), 'anular es solo del dueño');

  console.log('\n12) El total del mes (para el tope del monotributo)');
  process.env.ARCA_ENTORNO = 'produccion'; process.env.ARCA_EMITIR_PRODUCCION = 'si';
  delete DB['config/facturacionTotales'];
  await arca.emitirFactura({ id: 't1', detalle: fe.normalizarDetalle({ importe: 10000, fecha: '2026-10-31' }) });
  await arca.emitirFactura({ id: 't2', detalle: fe.normalizarDetalle({ importe: 5000, fecha: '2026-10-31' }) });
  ok(DB['config/facturacionTotales'].meses['2026-10'] === 15000, 'cada factura real suma al mes', DB['config/facturacionTotales']);
  await arca.anularFactura({ id: 't2' });
  ok(DB['config/facturacionTotales'].meses['2026-10'] === 10000, 'la nota de crédito resta');
  process.env.ARCA_ENTORNO = 'homologacion';
  await arca.emitirFactura({ id: 't3', detalle: fe.normalizarDetalle({ importe: 999, fecha: '2026-10-31' }) });
  ok(DB['config/facturacionTotales'].meses['2026-10'] === 10000, 'las de prueba no cuentan');
  ok(/'facturacionTotales'\]\);/.test(leer('firestore.rules')), 'el total no se puede tocar desde la app (solo el servidor)');
  delete process.env.ARCA_EMITIR_PRODUCCION;

  console.log('\n13) Producción, bloqueada');
  process.env.ARCA_ENTORNO = 'produccion';
  err = null;
  try { await arca.emitirFactura({ id: 'p', detalle: det }); } catch (e) { err = e.message; }
  ok(/producción todavía no está habilitado/.test(err || ''), 'sin ARCA_EMITIR_PRODUCCION=si no factura de verdad', err);
  for (const v of ['Si', ' SI ', 'sí']) { process.env.ARCA_EMITIR_PRODUCCION = v; ok(arca.emiteEnProduccion(), `"${v}" también vale`); }
  for (const v of ['no', '', 'sii']) { process.env.ARCA_EMITIR_PRODUCCION = v; ok(!arca.emiteEnProduccion(), `"${v}" no habilita`); }
  delete process.env.ARCA_EMITIR_PRODUCCION;
} catch (e) {
  console.error(e); fails++;
} finally {
  try { fs.unlinkSync(TMP); fs.unlinkSync(TMP_FE); } catch {}
}
console.log(fails ? `\n❌ ${fails} fallas` : '\n✅ todo bien');
process.exit(fails ? 1 : 0);
})();
