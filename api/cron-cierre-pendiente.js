// Vercel Function — invocada por GitHub Actions a las 19:30 AR (22:30 UTC)
// Si no hay caja_cierres/{hoy}, manda push a todos los dispositivos suscritos
// que tengan push.cierrePendiente=true.

import admin from 'firebase-admin';

function getAdmin() {
  if (admin.apps.length) return admin;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin;
}

function todayAR() {
  return new Date().toLocaleString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires'
  }).slice(0, 10);
}

export default async function handler(req, res) {
  // Authorization
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const a = getAdmin();
    const db = a.firestore();
    const today = todayAR();

    // ¿Hay arqueo? Si no hubo, no se trabajó hoy → no avisar
    const arq = await db.collection('caja_arqueos').doc(today).get();
    if (!arq.exists) {
      return res.status(200).json({ skipped: 'sin arqueo del día' });
    }

    // ¿Hay cierre? Si sí, no avisar
    const cierre = await db.collection('caja_cierres').doc(today).get();
    if (cierre.exists) {
      return res.status(200).json({ skipped: 'cierre ya registrado' });
    }

    // Llamar al endpoint de send-push internamente
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (process.env.PUBLIC_URL || '');
    const url = baseUrl + '/api/send-push';
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({
        targets: 'all',
        pushKey: 'cierrePendiente',
        title: '⏰ Cierre de caja pendiente',
        body: 'Pasaron las 19:30 y todavía no cerraste la caja del día.',
        url: '/caja.html',
        requireInteraction: true,
      }),
    });
    const data = await r.json();
    return res.status(200).json(data);
  } catch (e) {
    console.error('cron-cierre:', e);
    return res.status(500).json({ error: e.message });
  }
}
