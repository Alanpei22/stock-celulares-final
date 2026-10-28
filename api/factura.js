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

import { exigirSesion } from './_auth.js';
import { arcaConfig, arcaFaltantes, dummy, obtenerTA, ultimoAutorizado, consultarCbte, emitirFactura, arcaDb } from './_arca.js';
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
      const { movId, concepto, docTipo, docNro, condIva } = req.body || {};
      if (!movId || typeof movId !== 'string') return res.status(400).json({ error: 'Falta la venta (movId)' });
      const snap = await arcaDb().collection('caja_movimientos').doc(movId).get();
      if (!snap.exists) return res.status(404).json({ error: 'No encuentro esa venta en la caja' });
      const mov = snap.data();
      if (mov.tipo !== 'ingreso') return res.status(400).json({ error: 'Solo se facturan ingresos' });
      if (!seFactura(mov)) return res.status(400).json({ error: 'Se cobró en efectivo: no se factura' });
      const detalle = normalizarDetalle({ importe: mov.monto, fecha: mov.fecha, concepto, docTipo, docNro, condIva });
      if (detalle.error) return res.status(400).json({ error: detalle.error });
      const f = await emitirFactura({ id: movId, detalle, extra: { movId, descripcion: String(mov.descripcion || '').slice(0, 200) } });
      return res.status(200).json({ ok: true, factura: f, ms: ms() });
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

    // ── ¿Qué dice ARCA de un número? ──
    if (action === 'consultar') {
      const nro = Number((req.body || {}).nro);
      if (!(nro > 0)) return res.status(400).json({ error: 'Falta el número' });
      const c = await consultarCbte({ ptoVenta: cfg.ptoVenta, nro });
      return res.status(200).json({ ok: true, existe: !!c, comprobante: c, ms: ms() });
    }

    return res.status(400).json({
      error: 'action desconocida',
      disponibles: ['config', 'dummy', 'token', 'ultimo', 'emitir', 'prueba', 'consultar'],
    });
  } catch (e) {
    console.error('factura:', e);
    // El mensaje de ARCA se pasa tal cual: es lo único que dice qué pasó, y
    // tragárselo obliga a adivinar.
    return res.status(500).json({ error: e.message, entorno: cfg.entorno, ms: ms() });
  }
}
