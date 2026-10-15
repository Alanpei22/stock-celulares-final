// Vercel Function — invocada por GitHub Actions a las 19:30 AR (22:30 UTC)
// Si no hay caja_cierres/{hoy}, manda push a todos los dispositivos suscritos
// que tengan push.cierrePendiente=true.
//
// Con body { fichadas: true } (GitHub Actions, 20:00 AR) hace otra cosa:
// avisa por Telegram quién no fichó la salida. Va en este mismo archivo para
// no sumar otra función a Vercel.

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

// Quiénes siguen "adentro" según las fichadas del día: su última fichada es
// una entrada. (La misma cuenta que horasTurnos en horas.js, en corto.)
export function sinSalida(fichadas) {
  const ms = f => {
    const v = f.tsCorregido || f.ts;
    return v && typeof v.toMillis === 'function' ? v.toMillis() : (Number(f.tsCel) || 0);
  };
  const ultima = {};
  fichadas.forEach(f => {
    if (!f.uid || (f.tipo !== 'entrada' && f.tipo !== 'salida')) return;
    if (!ultima[f.uid] || ms(f) >= ms(ultima[f.uid])) ultima[f.uid] = f;
  });
  return Object.values(ultima).filter(f => f.tipo === 'entrada')
    .map(f => ({ nombre: f.nombre || 'Sin nombre', desde: ms(f) }));
}

async function avisarSinSalida(db, today) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { skipped: 'telegram sin configurar' };
  const snap = await db.collection('fichadas').where('dia', '==', today).get();
  const quienes = sinSalida(snap.docs.map(d => d.data()));
  if (!quienes.length) return { ok: true, sinSalida: 0 };
  const hora = ms => new Date(ms - 3 * 3600e3).toISOString().slice(11, 16);
  const esc = x => String(x).replace(/[<>&]/g, '');
  const texto = `🚪 <b>No ficharon la salida</b>\n` +
    quienes.map(q => `· ${esc(q.nombre)} (entró ${hora(q.desde)})`).join('\n') +
    `\nSe cuentan hasta las 19:30. Si se fue antes, corregilo en ☰ → ⏰ Horas del personal.`;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const data = await r.json();
  return { ok: !!data.ok, sinSalida: quienes.length };
}

export default async function handler(req, res) {
  // Authorization
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (req.body && req.body.fichadas) {
    try {
      return res.status(200).json(await avisarSinSalida(getAdmin().firestore(), todayAR()));
    } catch (e) {
      console.error('cron-cierre (fichadas):', e);
      return res.status(500).json({ error: e.message });
    }
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
        url: '/caja.html?action=cierre',
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
