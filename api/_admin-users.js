// TEMPORAL — lista las cuentas de Firebase Auth para armar el allowlist de reglas.
// Protegido con TELEGRAM_WEBHOOK_SECRET (header x-admin-secret). BORRAR después de usar.
import admin from 'firebase-admin';

function getAdmin() {
  if (admin.apps.length) return admin;
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return admin;
}

export default async function handler(req, res) {
  if (req.headers['x-admin-secret'] !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const users = [];
    let pageToken;
    do {
      const r = await getAdmin().auth().listUsers(1000, pageToken);
      r.users.forEach(u => users.push({
        uid: u.uid,
        email: u.email || null,
        verified: u.emailVerified,
        created: u.metadata.creationTime,
        lastLogin: u.metadata.lastSignInTime,
      }));
      pageToken = r.pageToken;
    } while (pageToken);
    return res.status(200).json({ count: users.length, users });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
