// Vercel Function — POST /api/send-push
// Body: { targets: [deviceId|"all"], title, body, url, requireInteraction?, tag? }
// Headers (opcional para crons): Authorization: Bearer <CRON_SECRET>

import webpush from 'web-push';
import admin from 'firebase-admin';

// ── Init Firebase Admin (singleton) ──
function getAdmin() {
  if (admin.apps.length) return admin;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT env var faltante');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin;
}

// ── VAPID setup ──
function configureVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!pub || !priv) throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars faltantes');
  webpush.setVapidDetails(subject, pub, priv);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth opcional para cron (si CRON_SECRET está seteado y la request lo trae)
  const authHeader = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`;

  // CORS básico (solo si tu propio dominio lo necesita; las funciones same-origin no)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  try {
    configureVapid();
    const adminInstance = getAdmin();
    const db = adminInstance.firestore();

    const { targets, title, body, url, requireInteraction, tag, pushKey } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });

    // 1) Cargar dispositivos suscriptos
    const devicesSnap = await db.collection('caja_config')
      .doc('notifications')
      .collection('devices')
      .get();
    let devices = devicesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 2) Filtrar por targets
    if (Array.isArray(targets) && targets.length > 0 && targets[0] !== 'all') {
      // Detectar marcadores _NEGATED ("excluir tal device")
      const exclude = new Set();
      const include = new Set();
      targets.forEach(t => {
        if (t && t.endsWith('_NEGATED')) exclude.add(t.replace('_NEGATED', ''));
        else include.add(t);
      });
      if (include.size > 0) {
        devices = devices.filter(d => include.has(d.id));
      } else if (exclude.size > 0) {
        devices = devices.filter(d => !exclude.has(d.id));
      }
    }

    // 3) Si pushKey y NO es cron, filtrar por config (respetar toggles del usuario)
    //    Si es cron, ya validó el server con la config Firestore antes de llamar.
    if (pushKey && !isCronAuth) {
      const cfgDoc = await db.collection('caja_config').doc('notifications').get();
      const cfg = cfgDoc.exists ? cfgDoc.data() : {};
      const enabled = cfg?.push?.enabled !== false && cfg?.push?.[pushKey] !== false;
      if (!enabled) {
        return res.status(200).json({ skipped: true, reason: 'pushKey disabled in config' });
      }
    }

    if (!devices.length) {
      return res.status(200).json({ sent: 0, reason: 'no devices' });
    }

    // 4) Enviar a cada uno
    const payload = JSON.stringify({
      title, body: body || '',
      url: url || '/index.html',
      requireInteraction: !!requireInteraction,
      tag: tag || undefined,
    });

    const results = await Promise.allSettled(devices.map(d =>
      webpush.sendNotification(d.subscription, payload).catch(err => {
        // 410 Gone = subscription expirada → borrar
        if (err.statusCode === 410 || err.statusCode === 404) {
          return db.collection('caja_config').doc('notifications')
            .collection('devices').doc(d.id).delete().then(() => { throw err; });
        }
        throw err;
      })
    ));

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return res.status(200).json({ sent, failed, total: devices.length });
  } catch (e) {
    console.error('send-push:', e);
    return res.status(500).json({ error: e.message });
  }
}
