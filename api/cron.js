// Vercel Function — POST /api/cron?tarea=...
// Los avisos automáticos que disparan los GitHub Actions (.github/workflows),
// todos por una sola función.
//
// ⚠️ Por qué juntos: el plan gratis de Vercel acepta hasta 12 funciones por
// deploy. Con /api/accesorios llegamos a 13 y desde el 22/11 Vercel rechazaba
// TODOS los deploys sin que nadie se enterara (Alan, 25/11: "no me aparece lo
// del control"; tampoco habían llegado los arreglos de impresión ni de las
// órdenes perdidas). Cada tarea sigue en su archivo (api/_cron-*.js: el guion
// bajo hace que Vercel no la cuente como función) y acá solo se elige cuál.
// Las direcciones viejas (/api/cron-resumen-diario, etc.) siguen andando por
// vercel.json. tests/test-vercel-funciones.js vigila que no pasemos de 12.
//
// Auth: Authorization: Bearer <CRON_SECRET> (además cada tarea lo revisa).

// Import con el nombre escrito tal cual: así Vercel sabe qué archivos llevar.
const TAREAS = {
  'cierre-pendiente':       () => import('./_cron-cierre-pendiente.js'),
  'reparaciones-demoradas': () => import('./_cron-reparaciones-demoradas.js'),
  'resumen-diario':         () => import('./_cron-resumen-diario.js'),
  'resumen-telegram':       () => import('./_cron-resumen-telegram.js'),
};

export default async function handler(req, res) {
  if ((req.headers.authorization || '') !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const tarea = String((req.query && req.query.tarea) || '');
  const cargar = Object.prototype.hasOwnProperty.call(TAREAS, tarea) ? TAREAS[tarea] : null;
  if (!cargar) return res.status(404).json({ error: 'tarea desconocida' });
  const mod = await cargar();
  return mod.default(req, res);
}
