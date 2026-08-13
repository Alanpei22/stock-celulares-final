// Vercel Function — POST /api/telegram-notify
// Body: { text } → lo manda al chat privado del dueño vía bot de Telegram.
// Credenciales SOLO en env vars (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).
//
// Auth OBLIGATORIA (ver _auth.js): Authorization: Bearer <ID token de Firebase>.
// Sin esto cualquiera con la URL te escribía al Telegram privado.
// (El sentido contrario — Telegram hablándole a la app — es telegram-webhook.js,
//  que ya se valida con x-telegram-bot-api-secret-token.)

import { exigirSesion } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!await exigirSesion(req, res)) return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return res.status(200).json({ skipped: 'sin configurar' });
  }

  const text = String((req.body || {}).text || '').slice(0, 4000);
  if (!text.trim()) return res.status(400).json({ error: 'text required' });

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await r.json();
    if (!data.ok) {
      console.error('telegram-notify:', data);
      return res.status(200).json({ ok: false, error: data.description });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('telegram-notify:', e);
    return res.status(200).json({ ok: false, error: e.message });
  }
}
