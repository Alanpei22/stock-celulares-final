// Vercel Function — POST /api/factura
//
// FASE 1: SOLO CONSULTA. Este endpoint todavía NO emite ningún comprobante.
// Sirve para contestar tres preguntas antes de escribir la parte que factura:
//   1. ¿La app llega a ARCA?                      → action: 'dummy'
//   2. ¿El certificado sirve y WSAA da token?     → action: 'token'
//   3. ¿Se puede consultar el último número?      → action: 'ultimo'
// y de paso, cuánto tarda cada cosa: el plan gratis de Vercel corta a los 10s.
//
// Auth OBLIGATORIA. Es el endpoint más sensible del repo: del otro lado está
// la identidad fiscal del local.
//
// El detalle técnico y el plan completo: tools/factura-arca.md

import { exigirSesion } from './_auth.js';
import { arcaConfig, arcaFaltantes, dummy, obtenerTA, ultimoAutorizado } from './_arca.js';

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

    return res.status(400).json({
      error: 'action desconocida',
      disponibles: ['config', 'dummy', 'token', 'ultimo'],
      nota: 'Fase 1: todavía no se emite ningún comprobante.',
    });
  } catch (e) {
    console.error('factura:', e);
    // El mensaje de ARCA se pasa tal cual: es lo único que dice qué pasó, y
    // tragárselo obliga a adivinar.
    return res.status(500).json({ error: e.message, entorno: cfg.entorno, ms: ms() });
  }
}
