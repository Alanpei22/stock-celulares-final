// Harness sin navegador para la conexión con ARCA (fase 1).
//
// LO QUE ESTA PRUEBA **NO** PUEDE HACER
// Todo lo demás en este repo se valida en una sandbox sin red. ARCA es un
// servicio externo con autenticación por certificado: que devuelva un token o
// un CAE solo se comprueba contra homologación, con el certificado real.
//
// LO QUE SÍ PUEDE, Y ES LO QUE MÁS SE ROMPE
//   · Que el XML que se firma tenga la forma que pide WSAA (sobre todo la
//     fecha con offset -03:00: con UTC el ticket queda 3 horas corrido).
//   · Que la firma CMS/PKCS#7 sea válida de verdad. Se genera un certificado
//     descartable acá mismo, se firma y se vuelve a parsear.
//   · Que los endpoints de homologación y producción no estén cruzados. Eso
//     es lo peor que puede pasar: emitir de verdad creyendo que se prueba.
//   · Que la fase 1 no emita nada.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DIR = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(DIR, f), 'utf8');

let fails = 0;
const ok = (c, l, x) => {
  console.log((c ? '  OK  ' : '  FAIL') + ' · ' + l + (c ? '' : '  → ' + JSON.stringify(x)));
  if (!c) fails++;
};

// api/ usa módulos ESM y estas pruebas son CommonJS. Para poder EJECUTAR el
// código real (no solo mirarlo con regex) se copia a un .mjs temporal dentro
// del proyecto, así node_modules resuelve igual, y se importa.
const TMP = path.join(__dirname, '_tmp-arca.mjs');
fs.writeFileSync(TMP, leer('api/_arca.js'));

(async () => {
try {
  const arca = await import('file://' + TMP.replace(/\\/g, '/'));

  console.log('\n1) Los endpoints no están cruzados');
  // Lo peor que puede pasar es emitir en producción creyendo que se prueba.
  const src = leer('api/_arca.js');
  // Los chequeos miran el CODIGO, no los comentarios: este archivo justamente
  // documenta cual es la URL que NO existe, y grepear crudo la encuentra ahi.
  const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const srcCode = sinCom(src);
  process.env.ARCA_ENTORNO = 'homologacion';
  const homo = arca.arcaConfig().urls;
  process.env.ARCA_ENTORNO = 'produccion';
  const prod = arca.arcaConfig().urls;

  ok(/wsaahomo\.afip\.gov\.ar/.test(homo.wsaa), 'WSAA de prueba apunta a wsaahomo', homo.wsaa);
  ok(/wswhomo\.afip\.gov\.ar/.test(homo.wsfe), 'WSFEv1 de prueba apunta a wswhomo', homo.wsfe);
  ok(!/homo/.test(prod.wsaa) && !/homo/.test(prod.wsfe), 'los de producción NO dicen homo', prod);
  ok(homo.wsaa !== prod.wsaa && homo.wsfe !== prod.wsfe, 'no hay ninguno repetido');
  // wsfev1homo.afip.gov.ar circula en tutoriales y NO existe: se verificó el
  // 19/08/2026 pidiendo el WSDL (no resuelve).
  ok(!/wsfev1homo/.test(srcCode), 'no se usa wsfev1homo, que no existe');
  // Por defecto tiene que ser homologación: si el default fuera producción,
  // olvidarse la env var significa emitir de verdad.
  delete process.env.ARCA_ENTORNO;
  ok(arca.arcaConfig().entorno === 'homologacion',
     'sin configurar nada, el entorno por defecto es el de PRUEBA');
  process.env.ARCA_ENTORNO = 'homologacion';

  console.log('\n2) Qué falta configurar se dice claro');
  ['ARCA_CUIT', 'ARCA_CERT', 'ARCA_KEY'].forEach(v => delete process.env[v]);
  const faltan = arca.arcaFaltantes();
  ok(faltan.length === 3, 'lista las tres cosas que faltan', faltan);
  ok(faltan.some(f => /CUIT/.test(f)) && faltan.some(f => /CERT/.test(f)) && faltan.some(f => /KEY/.test(f)),
     'y dice cuál es cada una', faltan);
  process.env.ARCA_CUIT = '20385199628';
  ok(arca.arcaFaltantes().length === 2, 'al cargar una, deja de pedirla');
  // Un CUIT mal tipeado no puede pasar silencioso.
  process.env.ARCA_CUIT = '203851996';
  ok(arca.arcaFaltantes().some(f => /CUIT/.test(f)), 'un CUIT de 9 dígitos lo marca como faltante');
  process.env.ARCA_CUIT = '20385199628';

  console.log('\n3) La firma CMS es válida de verdad');
  // Certificado descartable, generado acá: la prueba no depende del real, que
  // está fuera del repo a propósito.
  const forge = require('node-forge');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter  = new Date(Date.now() + 86400000);
  const attrs = [{ name: 'commonName', value: 'test' }, { name: 'countryName', value: 'AR' }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);

  const tra = '<?xml version="1.0"?><loginTicketRequest><service>wsfe</service></loginTicketRequest>';
  const firmado = arca.firmarTRA(tra, certPem, privateKey);

  ok(typeof firmado === 'string' && firmado.length > 100, 'devuelve algo', firmado && firmado.length);
  ok(/^[A-Za-z0-9+/=]+$/.test(firmado), 'en base64 limpio, como lo pide WSAA');
  // Lo importante: que se pueda volver a parsear como PKCS#7 y que adentro
  // esté el TRA. Si la firma estuviera mal armada, esto revienta.
  const der = forge.util.decode64(firmado);
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der));
  ok(!!p7, 'y se puede volver a leer como PKCS#7');
  const contenido = p7.rawCapture && p7.rawCapture.content
    ? forge.util.decodeUtf8(p7.rawCapture.content.value[0].value) : '';
  ok(contenido.includes('loginTicketRequest'), 'con el TRA adentro', contenido.slice(0, 60));
  ok(p7.certificates && p7.certificates.length === 1, 'y el certificado adjunto');

  console.log('\n4) El TRA tiene la forma que pide WSAA');
  // El TRA se arma adentro de obtenerTA, que sale a la red. Se mira el código,
  // que es lo que se puede sin llamar a ARCA.
  ok(/<uniqueId>/.test(src) && /<generationTime>/.test(src) && /<expirationTime>/.test(src),
     'lleva uniqueId, generationTime y expirationTime');
  ok(/<service>\$\{servicio\}<\/service>/.test(src), 'y el servicio');
  ok(/SERVICIO_WSAA = 'wsfe'/.test(src),
     "el servicio para WSAA es 'wsfe' (el endpoint es wsfev1, pero el id es wsfe)");

  // La fecha: con toISOString() el ticket queda 3 horas corrido y WSAA lo
  // rechaza por fuera de rango.
  ok(/-03:00/.test(src), 'la fecha lleva el offset -03:00 explícito');
  ok(!/generationTime>\$\{new Date\(\)\.toISOString/.test(src),
     'y no se arma con toISOString() pelado');

  console.log('\n5) Leer las respuestas de ARCA');
  ok(arca.xmlValor('<a><token>ABC</token></a>', 'token') === 'ABC', 'saca un valor simple');
  ok(arca.xmlValor('<ns:sign>XYZ</ns:sign>', 'sign') === 'XYZ', 'aunque venga con namespace');
  // WSAA devuelve el ticket adentro de un CDATA.
  ok(arca.xmlValor('<x><![CDATA[hola]]></x>', 'x') === 'hola', 'y adentro de un CDATA');
  ok(arca.xmlValor('<a>1</a>', 'token') === null, 'si no está, devuelve null');

  console.log('\n5b) La respuesta REAL de WSAA viene escapada');
  // Esto fallo en produccion el 19/08/2026: WSAA no manda el ticket en un
  // CDATA, lo manda ESCAPADO adentro de <loginCmsReturn> (&lt;token&gt;...).
  // Buscar <token> directo no encontraba nada y parecia que WSAA no contesto.
  const escXml = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                       .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ticket = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<loginTicketResponse version="1.0"><header>'
    + '<expirationTime>2026-08-20T05:20:00.000-03:00</expirationTime></header>'
    + '<credentials><token>TOKEN123</token><sign>SIGN456</sign></credentials>'
    + '</loginTicketResponse>';
  const respuestaWsaa = '<soapenv:Envelope><soapenv:Body><loginCmsResponse>'
    + '<loginCmsReturn>' + escXml(ticket) + '</loginCmsReturn>'
    + '</loginCmsResponse></soapenv:Body></soapenv:Envelope>';

  // Sin desescapar no se encuentra nada: es exactamente el bug que hubo.
  ok(arca.xmlValor(respuestaWsaa, 'token') === null,
     'buscar <token> en la respuesta cruda NO encuentra nada (era el bug)');

  const desescapado = arca.desescapar(arca.xmlValor(respuestaWsaa, 'loginCmsReturn'));
  ok(arca.xmlValor(desescapado, 'token') === 'TOKEN123', 'desescapado, sale el token');
  ok(arca.xmlValor(desescapado, 'sign') === 'SIGN456', 'y el sign');
  ok(arca.xmlValor(desescapado, 'expirationTime') === '2026-08-20T05:20:00.000-03:00',
     'y el vencimiento');

  ok(/loginCmsReturn/.test(src) && /desescapar\(/.test(src),
     'obtenerTA desescapa antes de buscar el token');
  // El & tiene que desescaparse ULTIMO, si no rompe a los demas.
  ok(arca.desescapar('&amp;lt;x&amp;gt;') === '&lt;x&gt;',
     'un & escapado no se convierte por error en una etiqueta');

  console.log('\n6) Los errores no se pueden tragar');
  // WSFEv1 contesta HTTP 200 con un bloque <Errors> adentro. Si no se mira,
  // un rechazo parece un éxito.
  ok(/<Errors>/.test(src) && /_errorNegocio/.test(src),
     'se miran los <Errors> que vienen con HTTP 200');
  ok(/faultstring/.test(src), 'y los soap:Fault');
  const fac = leer('api/factura.js');
  ok(/error: e\.message/.test(fac), 'el mensaje de ARCA se pasa tal cual, no se reemplaza');

  console.log('\n7) El caché del token');
  // No es una optimización: es lo que hace que esto entre en los 10s de Vercel.
  ok(/config'\)\.doc\('arca_ta_/.test(src), 'el token se cachea en UN documento, no en una colección');
  ok(/MARGEN_MS/.test(src), 'y se renueva antes de que venza, no justo al filo');

  console.log('\n8) La fase 1 NO emite nada');
  ok(!/FECAESolicitar/.test(src), '_arca.js no tiene FECAESolicitar');
  ok(!/FECAESolicitar/.test(fac), 'el endpoint tampoco');
  ok(/FECompUltimoAutorizado/.test(src), 'sí puede consultar el último número');
  ok(/FEDummy/.test(src), 'y preguntar si ARCA está viva');

  console.log('\n9) El endpoint está protegido');
  // Es el más sensible del repo: del otro lado está la identidad fiscal.
  ok(/import \{ exigirSesion \} from '\.\/_auth\.js'/.test(fac), 'importa el guardia');
  ok(fac.indexOf('exigirSesion(req, res)') < fac.indexOf('arcaConfig()'),
     'y corta antes de tocar nada de ARCA');
  ok(!/return res\.status\(200\)\.json\(\{[^}]*token:/.test(fac),
     'no devuelve el token al navegador: es una credencial');

  // Los archivos que empiezan con "_" no los publica Vercel como ruta.
  ok(fs.existsSync(path.join(DIR, 'api/_arca.js')), '_arca.js es ayudante, no ruta');

  console.log('\n10) La clave privada no está en el repo');
  // Si un .key entra al repo y se pushea, queda publico en GitHub y con eso
  // se puede facturar a nombre del local.
  const enRepo = fs.readdirSync(DIR).filter(f => /\.(key|crt|pem|p12|pfx)$/i.test(f));
  ok(enRepo.length === 0, 'no hay certificados ni claves sueltas en el repo', enRepo);
  // Ojo: el archivo TIENE las cadenas "BEGIN CERTIFICATE" y "BEGIN PRIVATE
  // KEY" como regex de validacion. Una clave pegada de verdad viene con los
  // guiones (-----BEGIN ...-----), que es lo que hay que buscar.
  ok(!/-----BEGIN [A-Z ]+-----/.test(src), 'ni pegadas adentro del código');
  ok(/process\.env\.ARCA_KEY/.test(src), 'la clave sale de una env var');

  console.log(fails ? `\n${fails} FALLARON` : '\nTodo OK');
} finally {
  try { fs.unlinkSync(TMP); } catch {}
}
process.exit(fails ? 1 : 0);
})();
