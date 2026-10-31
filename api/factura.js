// Vercel Function — POST /api/factura
//
// FASE 1 (consultas):
//   · ¿La app llega a ARCA?                      → action: 'dummy'
//   · ¿El certificado sirve y WSAA da token?     → action: 'token'
//   · ¿Qué número sigue?                         → action: 'ultimo'
// FASE 2 (emitir Factura C; producción bloqueada hasta la fase 4):
//   · Facturar una venta de la caja              → action: 'emitir', movId
//   · Una factura de prueba (solo homologación)  → action: 'prueba', importe
//   · ¿Qué dice ARCA de un número?               → action: 'consultar', nro
// Cada respuesta trae `ms`: el plan gratis de Vercel corta a los 10s.
//
// Auth OBLIGATORIA. Es el endpoint más sensible del repo: del otro lado está
// la identidad fiscal del local.
//
// El detalle técnico y el plan completo: tools/factura-arca.md

import { exigirSesion, verificarSesion, esDuenoUid } from './_auth.js';
import { arcaConfig, arcaFaltantes, dummy, obtenerTA, ultimoAutorizado, consultarCbte, emitirFactura, arcaDb, armarCSR, certVence, emiteEnProduccion, anularFactura, recalcularMes } from './_arca.js';
import { normalizarDetalle } from './_arca-fe.js';

// Los métodos de pago que NO se facturan (decidido el 19/08/2026: solo los
// cobros digitales; ver tools/factura-arca.md). Con pago dividido, si una de
// las dos partes es digital se factura la venta entera.
const NO_SE_FACTURA = ['efectivo', 'dólares', 'dolares'];
export function seFactura(mov) {
  const m = [mov && mov.metodoPago, mov && Number(mov.monto2) > 0 ? mov.metodoPago2 : null].filter(Boolean).map(x => String(x).toLowerCase());
  return m.some(x => !NO_SE_FACTURA.includes(x));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!await exigirSesion(req, res)) return;

  const { action } = req.body || {};
  const cfg = arcaConfig();
  const t0 = Date.now();
  // El tiempo de cada paso importa tanto como el resultado: es lo que dice si
  // esto entra en los 10 segundos de Vercel cuando haya que emitir de verdad.
  const ms = () => Date.now() - t0;

  try {
    // ── Estado de la configuración. No llama a ARCA. ──
    if (action === 'config' || !action) {
      return res.status(200).json({
        entorno: cfg.entorno,
        cuit: cfg.cuit || null,
        ptoVenta: cfg.ptoVenta || null,
        urls: cfg.urls,
        faltaConfigurar: arcaFaltantes(),
        // Cuándo vence el certificado cargado (y de qué entorno es)
        certVence: certVence(cfg.cert),
        emiteEnProduccion: cfg.entorno === 'produccion' && emiteEnProduccion(),
        listo: arcaFaltantes().length === 0,
      });
    }

    // ── ¿Está viva ARCA? No usa el certificado. ──
    // Separa "no llego a ARCA" de "mi certificado está mal", que desde afuera
    // se parecen bastante.
    if (action === 'dummy') {
      const r = await dummy();
      return res.status(200).json({ ok: true, entorno: cfg.entorno, servidores: r, ms: ms() });
    }

    // ── ¿WSAA me da un token? ──
    // No devuelve el token: no hace falta verlo desde el navegador y es una
    // credencial. Solo si salió, cuándo vence y si vino del caché.
    if (action === 'token') {
      const ta = await obtenerTA({ forzar: !!(req.body || {}).forzar });
      return res.status(200).json({
        ok: true, entorno: cfg.entorno,
        expira: ta.expira, deCache: ta.deCache, ms: ms(),
      });
    }

    // ── ¿Qué número sigue? ──
    if (action === 'ultimo') {
      const { ptoVenta, cbteTipo } = req.body || {};
      const r = await ultimoAutorizado({ ptoVenta, cbteTipo });
      return res.status(200).json({ ok: true, entorno: cfg.entorno, ...r, ms: ms() });
    }

    // ── Facturar una venta de la caja ──
    // El importe sale del movimiento guardado, no de lo que mande el
    // navegador: así la factura no puede decir otra cosa que la venta.
    if (action === 'emitir') {
      const { movId, concepto, docTipo, docNro, condIva, receptorNombre } = req.body || {};
      if (!movId || typeof movId !== 'string') return res.status(400).json({ error: 'Falta la venta (movId)' });
      const snap = await arcaDb().collection('caja_movimientos').doc(movId).get();
      if (!snap.exists) return res.status(404).json({ error: 'No encuentro esa venta en la caja' });
      const mov = snap.data();
      if (mov.tipo !== 'ingreso') return res.status(400).json({ error: 'Solo se facturan ingresos' });
      if (!seFactura(mov)) return res.status(400).json({ error: 'Se cobró en efectivo: no se factura' });
      const detalle = normalizarDetalle({ importe: mov.monto, fecha: mov.fecha, concepto, docTipo, docNro, condIva });
      if (detalle.error) return res.status(400).json({ error: detalle.error });
      const receptor = { nombre: String(receptorNombre || '').trim().slice(0, 120), docTipo: detalle.docTipo, docNro: detalle.docNro, condIva: detalle.condIva };
      const movRef = arcaDb().collection('caja_movimientos').doc(movId);
      let f;
      try {
        f = await emitirFactura({ id: movId, detalle, extra: { movId, receptor, descripcion: String(mov.descripcion || '').slice(0, 200) } });
      } catch (e) {
        // La venta queda marcada "falló": así aparece en "sin facturar" con
        // el motivo, y no se pierde. (Si se está facturando en otro lado, no
        // se pisa nada.)
        if (!/se está facturando/.test(e.message)) {
          await movRef.set({ factura: { estado: 'fallo', error: e.message.slice(0, 300), en: new Date().toISOString() } }, { merge: true }).catch(() => {});
        }
        throw e;
      }
      // Lo justo en la venta, para la lista de la caja y para reimprimir
      // (el detalle completo queda en facturas/<movId>)
      await movRef.set({ factura: {
        estado: 'emitida', entorno: f.entorno || cfg.entorno, ptoVenta: f.ptoVenta, cbteTipo: f.cbteTipo, nro: f.nro,
        cae: f.cae, caeVto: f.caeVto, qr: f.qr, receptor: f.receptor || receptor,
      } }, { merge: true });
      return res.status(200).json({ ok: true, factura: Object.assign({ receptor }, f), ms: ms() });
    }

    // ── Factura de prueba: SOLO en homologación ──
    if (action === 'prueba') {
      if (cfg.entorno !== 'homologacion') return res.status(400).json({ error: 'Las facturas de prueba son solo para homologación' });
      const { importe, concepto, docTipo, docNro, condIva } = req.body || {};
      const detalle = normalizarDetalle({ importe, concepto, docTipo, docNro, condIva });
      if (detalle.error) return res.status(400).json({ error: detalle.error });
      const f = await emitirFactura({ id: 'prueba_' + Date.now(), detalle, extra: { prueba: true } });
      return res.status(200).json({ ok: true, factura: f, ms: ms() });
    }

    // ── Anular la factura de una venta: Nota de Crédito C (solo el dueño) ──
    // Es definitivo ante ARCA: por eso no lo puede hacer un empleado.
    if (action === 'anular') {
      const s = await verificarSesion(req);
      if (!s.ok || !esDuenoUid(s.uid)) return res.status(403).json({ error: 'Anular una factura es solo del dueño' });
      const { movId } = req.body || {};
      if (!movId || typeof movId !== 'string') return res.status(400).json({ error: 'Falta la venta (movId)' });
      const nc = await anularFactura({ id: movId });
      // En la venta, para que la caja muestre "anulada" y deje reimprimir la NC
      await arcaDb().collection('caja_movimientos').doc(movId).set({ factura: { anulada: {
        cbteTipo: nc.cbteTipo, ptoVenta: nc.ptoVenta, nro: nc.nro, cae: nc.cae, caeVto: nc.caeVto, qr: nc.qr, entorno: nc.entorno || cfg.entorno,
      } } }, { merge: true }).catch(() => {});
      return res.status(200).json({ ok: true, notaCredito: nc, ms: ms() });
    }

    // ── Recalcular el total facturado de un mes (solo el dueño) ──
    if (action === 'recalcular') {
      const s = await verificarSesion(req);
      if (!s.ok || !esDuenoUid(s.uid)) return res.status(403).json({ error: 'Solo el dueño' });
      const ym = String((req.body || {}).mes || new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7));
      if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'Mes inválido (AAAA-MM)' });
      return res.status(200).json(Object.assign({ ok: true }, await recalcularMes(ym), { ms: ms() }));
    }

    // ── El pedido de certificado de PRODUCCIÓN (solo el dueño) ──
    // Se arma con la clave que ya está en Vercel: la clave no sale de ahí y
    // lo que se devuelve (el CSR) es público. Se pega en ARCA → Administración
    // de Certificados Digitales.
    if (action === 'csr') {
      const s = await verificarSesion(req);
      if (!s.ok || !esDuenoUid(s.uid)) return res.status(403).json({ error: 'Solo el dueño' });
      if (!/BEGIN (RSA )?PRIVATE KEY/.test(cfg.key) || !cfg.cuit) return res.status(400).json({ error: 'Falta ARCA_KEY o ARCA_CUIT en Vercel' });
      const csr = armarCSR({ keyPem: cfg.key, cuit: cfg.cuit, razonSocial: 'RICARDI ALAN AGUSTIN', alias: 'techpoint' });
      return res.status(200).json({ ok: true, csr });
    }

    // ── ¿Qué dice ARCA de un número? ──
    if (action === 'consultar') {
      const nro = Number((req.body || {}).nro);
      if (!(nro > 0)) return res.status(400).json({ error: 'Falta el número' });
      const c = await consultarCbte({ ptoVenta: cfg.ptoVenta, nro });
      return res.status(200).json({ ok: true, existe: !!c, comprobante: c, ms: ms() });
    }

    return res.status(400).json({
      error: 'action desconocida',
      disponibles: ['config', 'dummy', 'token', 'ultimo', 'emitir', 'prueba', 'consultar', 'csr', 'anular', 'recalcular'],
    });
  } catch (e) {
    console.error('factura:', e);
    // El mensaje de ARCA se pasa tal cual: es lo único que dice qué pasó, y
    // tragárselo obliga a adivinar.
    return res.status(500).json({ error: e.message, entorno: cfg.entorno, ms: ms() });
  }
}
