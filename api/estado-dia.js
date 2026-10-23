// Vercel Function — POST /api/estado-dia
// El estado de cada mañana: manda por Telegram la imagen del día que toca,
// lista para subir a WhatsApp, Instagram o TikTok.
//
// Las siete imágenes ya están hechas y subidas (estados.js, desde la app):
// acá solo se elige la de hoy y se manda. Por eso esto no dibuja nada ni
// necesita librerías de imagen.
//
// Dos formas de entrar:
//  · El cron de cada hora (GitHub Actions) con el CRON_SECRET. Manda solo si
//    la hora argentina coincide con la configurada y el aviso está activo.
//  · El botón "Probar" de la app, con sesión de Firebase y { probar: true }:
//    manda igual, sin mirar la hora.

import admin from 'firebase-admin';
import { exigirSesion } from './_auth.js';

function getAdmin() {
  if (admin.apps.length) return admin;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT env var faltante');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin;
}

// El 0 es domingo, como getDay(). Argentina es UTC-3 todo el año.
export const EST_DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
export const EST_NOMBRE = {
  dom: 'domingo', lun: 'lunes', mar: 'martes', mie: 'miércoles',
  jue: 'jueves', vie: 'viernes', sab: 'sábado',
};

export function estAhoraAR(ms = Date.now()) {
  const d = new Date(ms - 3 * 3600e3);
  return { dia: EST_DIAS[d.getUTCDay()], hora: d.getUTCHours() };
}

// ¿Le toca salir ahora? El cron corre cada hora; esto decide.
export function estLeToca(cfg, ahora) {
  if (!cfg || !cfg.activo) return { ok: false, por: 'apagado' };
  if (Number(cfg.hora) !== ahora.hora) return { ok: false, por: 'no es la hora' };
  const url = cfg.urls && cfg.urls[ahora.dia];
  if (!url) return { ok: false, por: 'falta generar la imagen de ' + EST_NOMBRE[ahora.dia] };
  return { ok: true, url };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const esCron = !!secret && auth === `Bearer ${secret}`;
  // Sin el secreto del cron, tiene que ser el dueño desde la app.
  if (!esCron && !await exigirSesion(req, res)) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return res.status(200).json({ skipped: 'telegram sin configurar' });

  try {
    const db = getAdmin().firestore();
    const snap = await db.collection('config').doc('estados').get();
    const cfg = snap.exists ? snap.data() : null;
    const ahora = estAhoraAR();

    let url;
    if (body.probar && !esCron) {
      url = cfg && cfg.urls && cfg.urls[ahora.dia];
      if (!url) return res.status(200).json({ ok: false, error: 'todavía no están generadas' });
    } else {
      const toca = estLeToca(cfg, ahora);
      if (!toca.ok) return res.status(200).json({ ok: true, skipped: toca.por });
      url = toca.url;
    }

    const caption = `📅 <b>Estado de hoy ${EST_NOMBRE[ahora.dia]}</b>\n`
      + `Guardala y subila a WhatsApp, Instagram o TikTok.`;
    // Telegram baja la imagen de la URL solo: no hay que mandarle el archivo.
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: url, caption, parse_mode: 'HTML' }),
    });
    const data = await r.json();
    if (!data.ok) {
      console.error('estado-dia:', data);
      return res.status(200).json({ ok: false, error: data.description });
    }
    return res.status(200).json({ ok: true, dia: ahora.dia });
  } catch (e) {
    console.error('estado-dia:', e);
    return res.status(500).json({ error: 'no se pudo mandar el estado' });
  }
}
