// ══════════════════════════════════════════
//  _arca.js — hablar con ARCA (ex AFIP)
// ══════════════════════════════════════════
// FASE 1: solo autenticarse y LEER. Todavía no emite ningún comprobante.
//
// Son dos servicios SOAP encadenados:
//   WSAA   → se le manda un XML firmado con el certificado y devuelve un
//            token + sign que valen 12 horas.
//   WSFEv1 → con ese token se consulta o se emite.
//
// ── POR QUÉ EL TOKEN SE CACHEA EN FIRESTORE ─────────────────
// No es una optimización, es lo que hace que esto entre en Vercel. En el plan
// gratis las funciones cortan a los 10 segundos, y WSAA + WSFEv1 encadenados
// pueden no entrar. Con el token cacheado, la enorme mayoría de las llamadas
// se saltean WSAA y hacen una sola llamada SOAP.
// El caché es un documento, no una colección: no afecta el cupo.
//
// ── LA CLAVE PRIVADA ────────────────────────────────────────
// Vive SOLO en las env vars de Vercel. Nunca en el repo, nunca en el
// navegador. Con esa clave se puede facturar a nombre del local.
'use strict';

import forge from 'node-forge';
import admin from 'firebase-admin';

// Endpoints verificados el 19/08/2026 pidiendo el WSDL de cada uno.
// OJO: `wsfev1homo.afip.gov.ar` NO existe, aunque circule en tutoriales.
// El host de homologación es `wswhomo`.
const ENDPOINTS = {
  homologacion: {
    wsaa:  'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe:  'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  produccion: {
    wsaa:  'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe:  'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
};

// El identificador que se le pide a WSAA es 'wsfe' aunque el endpoint sea
// wsfev1. Es una rareza histórica de AFIP, no un error. Ver tools/factura-arca.md
const SERVICIO_WSAA = 'wsfe';

export function arcaConfig() {
  const entorno = (process.env.ARCA_ENTORNO || 'homologacion').toLowerCase();
  if (!ENDPOINTS[entorno]) throw new Error(`ARCA_ENTORNO inválido: ${entorno}`);
  return {
    entorno,
    urls: ENDPOINTS[entorno],
    cuit: String(process.env.ARCA_CUIT || '').replace(/\D/g, ''),
    cert: process.env.ARCA_CERT || '',
    key:  process.env.ARCA_KEY || '',
    ptoVenta: Number(process.env.ARCA_PTO_VENTA || 0),
  };
}

// Qué falta configurar. Se usa para dar un error entendible en vez de que
// reviente adentro de la firma.
export function arcaFaltantes() {
  const c = arcaConfig();
  const faltan = [];
  if (!c.cuit || c.cuit.length !== 11) faltan.push('ARCA_CUIT (11 dígitos)');
  if (!/BEGIN CERTIFICATE/.test(c.cert)) faltan.push('ARCA_CERT (el .crt completo, en PEM)');
  if (!/BEGIN (RSA )?PRIVATE KEY/.test(c.key)) faltan.push('ARCA_KEY (la clave privada, en PEM)');
  return faltan;
}

// ── Fecha en horario Argentina con offset, como la pide WSAA ─
// No sirve toISOString(): WSAA quiere el offset explícito (-03:00) y con UTC
// el ticket queda 3 horas corrido.
function _fechaAR(d) {
  const ar = new Date(d.getTime() - 3 * 3600 * 1000);   // UTC-3
  return ar.toISOString().replace(/\.\d{3}Z$/, '') + '-03:00';
}

// ── El XML que se firma (Login Ticket Request) ──────────────
function _armarTRA(servicio) {
  const ahora = Date.now();
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(ahora / 1000)}</uniqueId>
    <generationTime>${_fechaAR(new Date(ahora - 5 * 60 * 1000))}</generationTime>
    <expirationTime>${_fechaAR(new Date(ahora + 12 * 3600 * 1000))}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`;
}

// ── Firmar el TRA en CMS/PKCS#7, que es lo que WSAA espera ──
// Se firma con SHA-256. Si ARCA rechazara la firma, el otro candidato es
// SHA-1: es el único parámetro con margen de duda acá.
export function firmarTRA(tra, certPem, keyPem) {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  const cert = forge.pki.certificateFromPem(certPem);
  const key  = forge.pki.privateKeyFromPem(keyPem);
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

// ── Sacar un valor de un XML, sin traer un parser entero ─────
// Las respuestas de ARCA son chicas y de forma conocida. Contempla CDATA.
export function xmlValor(xml, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</(?:\\w+:)?${tag}>`);
  const m = String(xml).match(re);
  return m ? m[1].trim() : null;
}

// ── Caché del token en Firestore ────────────────────────────
function _db() {
  if (!admin.apps.length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) : null;
    if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT env var faltante');
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin.firestore();
}

const _docTA = (entorno) => _db().collection('config').doc('arca_ta_' + entorno);

// Se renueva 10 minutos ANTES de que venza: si se apura hasta el final, una
// llamada lenta puede arrancar con token válido y llegar vencida.
const MARGEN_MS = 10 * 60 * 1000;

async function _taCacheado(entorno) {
  try {
    const snap = await _docTA(entorno).get();
    if (!snap.exists) return null;
    const d = snap.data();
    if (!d || !d.token || !d.sign || !d.expira) return null;
    if (new Date(d.expira).getTime() - MARGEN_MS <= Date.now()) return null;
    return { token: d.token, sign: d.sign, expira: d.expira, deCache: true };
  } catch (e) {
    console.warn('[arca] no se pudo leer el token cacheado:', e.message);
    return null;   // sin caché igual funciona, solo más lento
  }
}

// ── WSAA: obtener token + sign ──────────────────────────────
export async function obtenerTA({ forzar = false } = {}) {
  const cfg = arcaConfig();
  if (!forzar) {
    const cache = await _taCacheado(cfg.entorno);
    if (cache) return cache;
  }

  const faltan = arcaFaltantes();
  if (faltan.length) throw new Error('Falta configurar: ' + faltan.join(', '));

  const cms = firmarTRA(_armarTRA(SERVICIO_WSAA), cfg.cert, cfg.key);
  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body>
</soapenv:Envelope>`;

  const r = await fetch(cfg.urls.wsaa, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' },
    body: sobre,
  });
  const xml = await r.text();

  // WSAA devuelve los errores adentro de un soap:Fault, no con status != 200
  const falla = xmlValor(xml, 'faultstring');
  if (falla) throw new Error('WSAA rechazó: ' + falla);

  const token = xmlValor(xml, 'token');
  const sign  = xmlValor(xml, 'sign');
  const expira = xmlValor(xml, 'expirationTime');
  if (!token || !sign) throw new Error('WSAA no devolvió token. Respuesta: ' + xml.slice(0, 400));

  try {
    await _docTA(cfg.entorno).set({
      token, sign, expira,
      servicio: SERVICIO_WSAA,
      guardadoEn: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[arca] no se pudo cachear el token:', e.message);
  }
  return { token, sign, expira, deCache: false };
}

// ── WSFEv1: una llamada SOAP cualquiera ─────────────────────
async function _llamarWsfe(metodo, cuerpoXml) {
  const cfg = arcaConfig();
  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body><ar:${metodo}>${cuerpoXml}</ar:${metodo}></soap:Body>
</soap:Envelope>`;

  const r = await fetch(cfg.urls.wsfe, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://ar.gov.afip.dif.FEV1/' + metodo,
    },
    body: sobre,
  });
  const xml = await r.text();
  const falla = xmlValor(xml, 'faultstring');
  if (falla) throw new Error(`WSFEv1 (${metodo}) rechazó: ` + falla);
  return xml;
}

function _authXml({ token, sign, cuit }) {
  return `<ar:Auth><ar:Token>${token}</ar:Token><ar:Sign>${sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>`;
}

// Errores de negocio: WSFEv1 los devuelve con HTTP 200 y un bloque <Errors>.
// Si no se miran, un rechazo parece un éxito.
function _errorNegocio(xml) {
  if (!/<Errors>/.test(xml)) return null;
  const code = xmlValor(xml, 'Code');
  const msg  = xmlValor(xml, 'Msg');
  return msg ? `[${code || 's/n'}] ${msg}` : null;
}

// ── FEDummy: ¿está viva ARCA? No necesita certificado ───────
// Es el primer chequeo útil: separa "no llego a ARCA" de "mi certificado
// está mal", que desde afuera se parecen.
export async function dummy() {
  const xml = await _llamarWsfe('FEDummy', '');
  return {
    appServer: xmlValor(xml, 'AppServer'),
    dbServer:  xmlValor(xml, 'DbServer'),
    authServer: xmlValor(xml, 'AuthServer'),
  };
}

// ── FECompUltimoAutorizado: qué número sigue ────────────────
// Factura C = tipo 11 (monotributo).
export async function ultimoAutorizado({ ptoVenta, cbteTipo = 11 }) {
  const cfg = arcaConfig();
  const ta  = await obtenerTA();
  const pv  = Number(ptoVenta || cfg.ptoVenta);
  if (!pv) throw new Error('Falta el punto de venta (ARCA_PTO_VENTA)');

  const xml = await _llamarWsfe('FECompUltimoAutorizado',
    `${_authXml({ ...ta, cuit: cfg.cuit })}<ar:PtoVta>${pv}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`);

  const err = _errorNegocio(xml);
  if (err) throw new Error('WSFEv1: ' + err);

  const ultimo = Number(xmlValor(xml, 'CbteNro'));
  return {
    ptoVenta: pv,
    cbteTipo,
    ultimo: Number.isFinite(ultimo) ? ultimo : 0,
    proximo: (Number.isFinite(ultimo) ? ultimo : 0) + 1,
    tokenDeCache: ta.deCache,
  };
}
