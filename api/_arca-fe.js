// ══════════════════════════════════════════
//  _arca-fe.js — armar y leer comprobantes (WSFEv1)
// ══════════════════════════════════════════
// FASE 2. Funciones PURAS: sin red, sin Firebase, sin certificado. Arman el
// pedido de CAE y leen lo que contesta ARCA. Van aparte de _arca.js para
// poder probarlas solas (tests/test-arca-emitir.js); la parte que habla con
// ARCA y guarda en Firestore está en _arca.js.
//
// El local es MONOTRIBUTO → Factura C (tipo 11): un solo importe, sin IVA
// discriminado. Ver tools/factura-arca.md.
'use strict';

export const CBTE_FACTURA_C = 11;

// Concepto: 1 productos · 2 servicios · 3 productos y servicios.
// Una reparación es servicio (y casi siempre lleva repuesto): 3. Con 2 o 3
// ARCA exige las fechas del servicio y del vencimiento del pago.
export const CONCEPTOS = { productos: 1, servicios: 2, ambos: 3 };

// Documento del cliente (DocTipo de ARCA)
export const DOC_TIPOS = { cf: 99, dni: 96, cuit: 80, cuil: 86 };

// Condición de IVA del cliente (CondicionIVAReceptorId, obligatorio desde la
// versión 4.x del manual de WSFEv1: si falta, ARCA rechaza)
export const COND_IVA = { consumidorFinal: 5, responsableInscripto: 1, monotributo: 6, exento: 4 };

// Un tope de cordura: un importe así es un error de tipeo, no una venta
export const IMPORTE_MAX = 100_000_000;

// "2026-10-28" o Date → "20261028" (día argentino)
export function fechaArca(d) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d.replace(/-/g, '');
  const t = d instanceof Date ? d.getTime() : Date.now();
  return new Date(t - 3 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
}
// "20261028" → "2026-10-28"
export function fechaIso(f) {
  const s = String(f || '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
}

const _num = n => (Math.round(Number(n) * 100) / 100).toFixed(2);

// Valida lo que llega y lo deja listo. Devuelve { error } o el detalle limpio.
export function normalizarDetalle(d) {
  const importe = Math.round(Number(d && d.importe) * 100) / 100;
  if (!(importe > 0)) return { error: 'El importe tiene que ser mayor a cero' };
  if (importe > IMPORTE_MAX) return { error: 'Importe demasiado alto: revisá que esté bien escrito' };
  const concepto = CONCEPTOS[d.concepto] || (Object.values(CONCEPTOS).includes(Number(d.concepto)) ? Number(d.concepto) : CONCEPTOS.productos);
  const docTipo = DOC_TIPOS[d.docTipo] || (Object.values(DOC_TIPOS).includes(Number(d.docTipo)) ? Number(d.docTipo) : DOC_TIPOS.cf);
  const docNro = docTipo === DOC_TIPOS.cf ? 0 : Number(String(d.docNro || '').replace(/\D/g, ''));
  if (docTipo !== DOC_TIPOS.cf && !(docNro > 0)) return { error: 'Falta el número de documento del cliente' };
  if ((docTipo === DOC_TIPOS.cuit || docTipo === DOC_TIPOS.cuil) && String(docNro).length !== 11) return { error: 'El CUIT tiene que tener 11 dígitos' };
  const condIva = COND_IVA[d.condIva] || (Object.values(COND_IVA).includes(Number(d.condIva)) ? Number(d.condIva) : COND_IVA.consumidorFinal);
  return { importe, concepto, docTipo, docNro, condIva, fecha: fechaArca(d.fecha) };
}

// El pedido de CAE para UN comprobante (FECAESolicitar). El orden de los
// campos importa: es el del esquema de ARCA.
export function armarFECAE({ ptoVenta, cbteTipo = CBTE_FACTURA_C, nro, detalle }) {
  const d = detalle;
  const servicio = d.concepto === CONCEPTOS.servicios || d.concepto === CONCEPTOS.ambos;
  return `<ar:FeCAEReq>`
    + `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${Number(ptoVenta)}</ar:PtoVta><ar:CbteTipo>${Number(cbteTipo)}</ar:CbteTipo></ar:FeCabReq>`
    + `<ar:FeDetReq><ar:FECAEDetRequest>`
    + `<ar:Concepto>${d.concepto}</ar:Concepto>`
    + `<ar:DocTipo>${d.docTipo}</ar:DocTipo><ar:DocNro>${d.docNro}</ar:DocNro>`
    + `<ar:CbteDesde>${Number(nro)}</ar:CbteDesde><ar:CbteHasta>${Number(nro)}</ar:CbteHasta>`
    + `<ar:CbteFch>${d.fecha}</ar:CbteFch>`
    // Factura C: todo el importe va como neto, sin IVA ni tributos
    + `<ar:ImpTotal>${_num(d.importe)}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc>`
    + `<ar:ImpNeto>${_num(d.importe)}</ar:ImpNeto><ar:ImpOpEx>0.00</ar:ImpOpEx>`
    + `<ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>0.00</ar:ImpIVA>`
    + (servicio ? `<ar:FchServDesde>${d.fecha}</ar:FchServDesde><ar:FchServHasta>${d.fecha}</ar:FchServHasta><ar:FchVtoPago>${d.fecha}</ar:FchVtoPago>` : '')
    + `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>`
    + `<ar:CondicionIVAReceptorId>${d.condIva}</ar:CondicionIVAReceptorId>`
    + `</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`;
}

// Saca el texto de una etiqueta (con o sin prefijo de namespace)
function _val(xml, tag) {
  const m = String(xml).match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  return m ? m[1].trim() : null;
}
// Todos los { code, msg } de un bloque (<Errors> u <Observaciones>)
function _mensajes(xml, bloque) {
  const b = _val(xml, bloque);
  if (!b) return [];
  const out = [];
  const re = /<(?:\w+:)?Code>([\s\S]*?)<\/(?:\w+:)?Code>\s*<(?:\w+:)?Msg>([\s\S]*?)<\/(?:\w+:)?Msg>/g;
  let m;
  while ((m = re.exec(b))) out.push({ code: Number(m[1]), msg: m[2].trim() });
  return out;
}

// Respuesta de FECAESolicitar →
//   { aprobado: true, cae, caeVto, nro, obs }       (A: tiene CAE)
//   { aprobado: false, rechazo: [..], obs }         (R: ARCA dijo que no)
// "R" NO consume número: se puede volver a pedir con el mismo.
export function leerFECAE(xml) {
  const errores = _mensajes(xml, 'Errors');
  const obs = _mensajes(xml, 'Observaciones');
  const det = _val(xml, 'FECAEDetResponse') || '';
  const resultado = _val(det, 'Resultado') || _val(xml, 'Resultado');
  const cae = _val(det, 'CAE');
  if (resultado === 'A' && cae && /^\d{14}$/.test(cae)) {
    return { aprobado: true, cae, caeVto: fechaIso(_val(det, 'CAEFchVto')), nro: Number(_val(det, 'CbteDesde')), obs };
  }
  return { aprobado: false, rechazo: errores.length ? errores : obs, obs };
}

// ¿El rechazo es porque el número ya no es el que sigue? (otra venta se
// facturó al mismo tiempo). Ahí se vuelve a preguntar el último y se reintenta.
export function esNumeroOcupado(r) {
  return !!(r && r.rechazo && r.rechazo.some(e => e.code === 10016));
}

// Respuesta de FECompConsultar → el comprobante si existe, o null.
// Es lo que hace la numeración a prueba de cortes: antes de reintentar una
// factura que quedó a medias, se pregunta si ARCA ya la había emitido.
export function leerConsulta(xml) {
  const r = _val(xml, 'ResultGet');
  if (!r) return null;
  const cae = _val(r, 'CodAutorizacion');
  if (!cae) return null;
  return {
    cae, caeVto: fechaIso(_val(r, 'FchVto')), nro: Number(_val(r, 'CbteDesde')),
    importe: Number(_val(r, 'ImpTotal')), fecha: fechaIso(_val(r, 'CbteFch')),
    docTipo: Number(_val(r, 'DocTipo')), docNro: Number(_val(r, 'DocNro')),
  };
}

// Los datos del QR obligatorio (RG 4892). Se guardan con la factura para
// imprimirla después: https://www.afip.gob.ar/fe/qr/?p=<base64 de esto>
export function datosQR({ cuit, ptoVenta, cbteTipo = CBTE_FACTURA_C, nro, cae, detalle }) {
  return {
    ver: 1, fecha: fechaIso(detalle.fecha), cuit: Number(cuit), ptoVta: Number(ptoVenta), tipoCmp: Number(cbteTipo),
    nroCmp: Number(nro), importe: Number(_num(detalle.importe)), moneda: 'PES', ctz: 1,
    tipoDocRec: detalle.docTipo, nroDocRec: detalle.docNro, tipoCodAut: 'E', codAut: Number(cae),
  };
}
