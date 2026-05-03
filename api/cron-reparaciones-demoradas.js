// Vercel Function — invocada por GitHub Actions diariamente a las 10:00 AR
// Busca reparaciones en estado 'listo' con fechaListo > N días.
// Manda 1 push agregado por dispositivo (no spam de N pushes).

import admin from 'firebase-admin';

function getAdmin() {
  if (admin.apps.length) return admin;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin;
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const a = getAdmin();
    const db = a.firestore();

    // 1) Cargar config para umbrales
    const cfgDoc = await db.collection('caja_config').doc('notifications').get();
    const cfg = cfgDoc.exists ? cfgDoc.data() : {};
    const diasDemorada = cfg?.thresholds?.diasReparacionDemorada ?? 3;
    const diasCritica  = cfg?.thresholds?.diasReparacionCritica ?? 10;

    const now = Date.now();
    const dms = (d) => d * 86400 * 1000;

    // 2) Buscar repairs en estado 'listo'
    const snap = await db.collection('repairs').where('estado', '==', 'listo').get();
    if (snap.empty) {
      return res.status(200).json({ skipped: 'sin reparaciones listas' });
    }

    const demoradas = [];
    const criticas  = [];

    snap.docs.forEach(d => {
      const r = d.data();
      // Buscar fecha del último cambio a 'listo' en estadoHistorial
      let fLista = null;
      if (Array.isArray(r.estadoHistorial)) {
        for (let i = r.estadoHistorial.length - 1; i >= 0; i--) {
          if (r.estadoHistorial[i].estado === 'listo') {
            fLista = r.estadoHistorial[i].fecha;
            break;
          }
        }
      }
      if (!fLista) return;
      const diff = now - new Date(fLista).getTime();
      if (diff >= dms(diasCritica)) criticas.push(r);
      else if (diff >= dms(diasDemorada)) demoradas.push(r);
    });

    if (!demoradas.length && !criticas.length) {
      return res.status(200).json({ skipped: 'no hay demoradas' });
    }

    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (process.env.PUBLIC_URL || '');
    const url = baseUrl + '/api/send-push';
    const results = [];

    // 3) Push de "críticas" (push obligatorio aunque toggle off — Q2 = B)
    if (criticas.length) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CRON_SECRET}` },
        body: JSON.stringify({
          targets: 'all',
          // SIN pushKey: el endpoint NO valida el toggle del usuario → push siempre llega
          title: `🚨 ${criticas.length} reparacion${criticas.length !== 1 ? 'es' : ''} sin retirar hace +${diasCritica} días`,
          body: criticas.slice(0, 3).map(r => `N°${r.nOrden || '?'} — ${r.nombre || (r.marca + ' ' + r.modelo)}`).join('\n'),
          url: '/index.html#reparaciones',
          requireInteraction: true,
          tag: 'rep-criticas',
        }),
      });
      results.push({ tipo: 'criticas', count: criticas.length, status: r.status });
    }

    // 4) Push de "demoradas" (respeta toggle del usuario)
    if (demoradas.length) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CRON_SECRET}` },
        body: JSON.stringify({
          targets: 'all',
          pushKey: 'reparacionesListas',
          title: `🔧 ${demoradas.length} reparacion${demoradas.length !== 1 ? 'es' : ''} listas`,
          body: `Hace +${diasDemorada} días sin retirar.\n` + demoradas.slice(0, 3).map(r => `N°${r.nOrden || '?'} — ${r.nombre || (r.marca + ' ' + r.modelo)}`).join('\n'),
          url: '/index.html#reparaciones',
          tag: 'rep-demoradas',
        }),
      });
      results.push({ tipo: 'demoradas', count: demoradas.length, status: r.status });
    }

    return res.status(200).json({ results });
  } catch (e) {
    console.error('cron-reparaciones:', e);
    return res.status(500).json({ error: e.message });
  }
}
