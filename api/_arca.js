// ══════════════════════════════════════════
//  _arca.js — hablar con ARCA (ex AFIP)
// ══════════════════════════════════════════
// FASE 1: autenticarse y leer. FASE 2 (al final): emitir Factura C, con la
// numeración a prueba de cortes. Producción sigue bloqueada (fase 4).
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
import { CBTE_FACTURA_C, armarFECAE, leerFECAE, esNumeroOcupado, leerConsulta, datosQR } from './_arca-fe.js';

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

// ── Desescapar entidades XML ─────────────────────
// WSAA devuelve el ticket ESCAPADO adentro de <loginCmsReturn>, no en un
// CDATA: llega como &lt;token&gt;... Sin desescapar, buscar <token> no
// encuentra nada y parece que WSAA no contestó.
export function desescapar(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');   // &amp; ÚLTIMO, si no rompe los de arriba
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

// Para el endpoint (leer la venta): inicializa Firebase Admin si hace falta
export function arcaDb() { return _db(); }

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

  // El ticket viene adentro de <loginCmsReturn>, ESCAPADO como entidades XML
  // (&lt;token&gt;...), no en un CDATA. Hay que desescaparlo antes de buscar
  // nada adentro. Si algún día viniera sin escapar, desescapar no lo rompe.
  const ticket = desescapar(xmlValor(xml, 'loginCmsReturn') || xml);
  const token = xmlValor(ticket, 'token');
  const sign  = xmlValor(ticket, 'sign');
  const expira = xmlValor(ticket, 'expirationTime');
  if (!token || !sign) {
    throw new Error('WSAA no devolvió token. Respuesta: ' + xml.slice(0, 1500));
  }

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

// ══════════════════════════════════════════
//  FASE 2 — EMITIR (Factura C)
// ══════════════════════════════════════════
// Lo que se cuida, en orden:
//  1. La numeración no puede tener huecos ni repetidos (es un problema
//     fiscal, no de pantalla). Cada venta tiene su documento en `facturas`
//     (id = la venta). ANTES de pedir el CAE se anota qué número se va a
//     usar; si se corta en el medio, el próximo intento le pregunta a ARCA
//     (FECompConsultar) si ese número ya salió, en vez de pedir otro.
//  2. Dos intentos a la vez de la misma venta: una transacción deja pasar
//     uno solo. Dos ventas distintas a la vez: si ARCA dice que el número ya
//     no es el que sigue (10016), se pregunta de nuevo y se reintenta.
//  3. Producción bloqueada hasta la fase 4: con ARCA_ENTORNO=produccion no
//     se emite salvo ARCA_EMITIR_PRODUCCION=si. Emitir de verdad creyendo que
//     se prueba es lo peor que puede pasar.

// ── FECompConsultar: ¿ese número ya se emitió? ──────────────
export async function consultarCbte({ ptoVenta, cbteTipo = CBTE_FACTURA_C, nro }) {
  const cfg = arcaConfig();
  const ta = await obtenerTA();
  const xml = await _llamarWsfe('FECompConsultar',
    `${_authXml({ ...ta, cuit: cfg.cuit })}<ar:FeCompConsReq><ar:CbteTipo>${cbteTipo}</ar:CbteTipo><ar:CbteNro>${Number(nro)}</ar:CbteNro><ar:PtoVta>${Number(ptoVenta)}</ar:PtoVta></ar:FeCompConsReq>`);
  const c = leerConsulta(xml);
  if (c) return c;
  // 602 = "no existen datos": ese número no se emitió. Cualquier otro error
  // no se puede tomar como "no existe" (sería arriesgarse a repetir).
  if (/<(?:\w+:)?Code>602</.test(xml)) return null;
  const err = _errorNegocio(xml);
  throw new Error('No se pudo consultar a ARCA: ' + (err || 'respuesta inesperada'));
}

export async function emitirFactura({ id, detalle, extra = {} }) {
  const cfg = arcaConfig();
  if (cfg.entorno === 'produccion' && process.env.ARCA_EMITIR_PRODUCCION !== 'si') {
    throw new Error('Facturar en producción todavía no está habilitado (fase 4).');
  }
  const pv = cfg.ptoVenta;
  if (!pv) throw new Error('Falta el punto de venta (ARCA_PTO_VENTA)');
  const db = _db();
  const ref = db.collection('facturas').doc(String(id));
  const ahora = () => new Date().toISOString();

  // 1) El turno de esta venta
  const previo = await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    const d = s.exists ? s.data() : null;
    if (d && d.estado === 'emitida') return { listo: d };
    if (d && d.estado === 'emitiendo' && Date.now() - Date.parse(d.desde || 0) < 60e3) return { ocupado: true };
    tx.set(ref, {
      estado: 'emitiendo', desde: ahora(), entorno: cfg.entorno, ptoVenta: pv, cbteTipo: CBTE_FACTURA_C,
      importe: detalle.importe, detalle, ...extra, nro: (d && d.estado === 'emitiendo' && d.nro) || null,
    }, { merge: true });
    return { pendiente: d && d.estado === 'emitiendo' ? d : null };
  });
  if (previo.listo) return Object.assign({}, previo.listo, { yaEstaba: true });
  if (previo.ocupado) throw new Error('Esta venta se está facturando en este momento. Esperá un minuto.');

  const guardar = async (r, nro) => {
    const f = {
      estado: 'emitida', nro, cae: r.cae, caeVto: r.caeVto, emitidaEn: ahora(), rechazo: null,
      qr: datosQR({ cuit: cfg.cuit, ptoVenta: pv, nro, cae: r.cae, detalle }),
    };
    await ref.set(f, { merge: true });
    return Object.assign({ entorno: cfg.entorno, ptoVenta: pv, cbteTipo: CBTE_FACTURA_C, importe: detalle.importe }, f);
  };

  // 2) Quedó a medias: ¿ARCA la había emitido?
  if (previo.pendiente && previo.pendiente.nro) {
    const nro = previo.pendiente.nro;
    const c = await consultarCbte({ ptoVenta: pv, nro });
    if (c && Math.abs(c.importe - detalle.importe) < 0.01 && c.docNro === detalle.docNro) {
      // Ojo: dos ventas del mismo importe a la vez podrían tener el mismo
      // número anotado. Si otra venta ya lo tiene como suyo, no es nuestro.
      const otra = await db.collection('facturas').where('ptoVenta', '==', pv).where('nro', '==', nro).where('estado', '==', 'emitida').get();
      if (!otra.docs.some(x => x.id !== String(id))) return guardar(c, nro);
    }
  }

  // 3) Número nuevo y CAE. Hasta 3 vueltas si otra venta ganó el número.
  const ta = await obtenerTA();
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const { proximo } = await ultimoAutorizado({ ptoVenta: pv });
    // Se anota ANTES de pedir: si se corta, el reintento sabe qué consultar
    await ref.set({ nro: proximo, desde: ahora() }, { merge: true });
    let xml;
    try {
      xml = await _llamarWsfe('FECAESolicitar', _authXml({ ...ta, cuit: cfg.cuit }) + armarFECAE({ ptoVenta: pv, nro: proximo, detalle }));
    } catch (e) {
      // No se sabe si ARCA la emitió: queda 'emitiendo' con el número y el
      // próximo intento pregunta antes de repetir
      throw new Error('No se supo si ARCA la emitió (' + e.message + '). Volvé a intentar: antes de repetir se fija.');
    }
    const r = leerFECAE(xml);
    if (r.aprobado) return guardar(r, proximo);
    if (esNumeroOcupado(r)) continue;
    // Rechazada: no consume número, se puede reintentar corrigiendo el dato
    await ref.set({ estado: 'rechazada', rechazo: r.rechazo, nro: null }, { merge: true });
    throw new Error('ARCA la rechazó: ' + (r.rechazo.map(e => `[${e.code}] ${e.msg}`).join(' · ') || 'sin detalle'));
  }
  await ref.set({ estado: 'rechazada', rechazo: [{ code: 10016, msg: 'Número ocupado tres veces seguidas' }], nro: null }, { merge: true });
  throw new Error('Había muchas facturas saliendo a la vez. Volvé a intentar.');
}
