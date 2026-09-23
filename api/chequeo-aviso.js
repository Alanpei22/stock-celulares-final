// Vercel Function — POST /api/chequeo-aviso
// Body: { id } → el id del chequeo (ej. "2026-09-23_1400").
//
// Manda por Telegram el resultado de un chequeo de caja: cuánto se contó y
// cuánto tendría que haber.
//
// ── Por qué el mensaje se arma ACÁ y no en el celular ──────────
//  1. El celular del empleado no sabe cuánto tendría que haber. La apertura
//     del día (`caja_arqueos`) es plata: las reglas de Firestore no se la dan.
//     Acá se lee con las credenciales del server y la cuenta cierra.
//  2. El mensaje sale de lo que quedó GUARDADO, no de lo que mande el
//     teléfono. Un control que se puede editar desde el aparato que se está
//     controlando no controla nada.
//
// Auth OBLIGATORIA (ver _auth.js): Authorization: Bearer <ID token de Firebase>.

import admin from 'firebase-admin';
import { exigirSesion } from './_auth.js';

function getAdmin() {
  if (admin.apps.length) return admin;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT env var faltante');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin;
}

const fmt = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// El mensaje, a partir de lo guardado. `apertura` puede venir del arqueo del
// día cuando el que contó no la tenía.
export function armarMensaje(d, aperturaDelDia) {
  const hora  = esc(d.hora || '');
  const quien = esc(d.cargadoPor || '—');

  if (d.salteado) {
    return `⏭ <b>Chequeo de las ${hora} salteado</b>\n👤 ${quien}`;
  }

  const apertura = (d.apertura === null || d.apertura === undefined) ? aperturaDelDia : d.apertura;
  const esperado = (apertura === null || apertura === undefined || d.movEfecNeto === null || d.movEfecNeto === undefined)
    ? null
    : Number(apertura) + Number(d.movEfecNeto);
  const contado = Number(d.contado) || 0;

  const l = [`🧾 <b>Chequeo de caja — ${hora}</b>`, `👤 ${quien}`, `💵 Contado: <b>${fmt(contado)}</b>`];

  if (esperado === null) {
    // Sin apertura no hay con qué comparar: la caja no se abrió ese día.
    l.push('📊 Debería haber: <i>no se puede saber, la caja no se abrió hoy</i>');
  } else {
    l.push(`📊 Debería haber: <b>${fmt(esperado)}</b>`);
    l.push(`   <i>apertura ${fmt(apertura)} + efectivo del día ${fmt(d.movEfecNeto)}</i>`);
    const dif = contado - esperado;
    if (dif === 0)     l.push('✅ Justo');
    else if (dif > 0)  l.push(`🔵 Sobra ${fmt(dif)}`);
    else               l.push(`🔴 <b>Falta ${fmt(-dif)}</b>`);
  }

  if (d.notas) l.push(`🗒 “${esc(d.notas)}”`);
  return l.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!await exigirSesion(req, res)) return;

  const id = String((req.body || {}).id || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}_\d{4}$/.test(id)) return res.status(400).json({ error: 'id inválido' });

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return res.status(200).json({ skipped: 'sin configurar' });

  try {
    const db = getAdmin().firestore();
    const snap = await db.collection('caja_chequeos_detalle').doc(id).get();
    if (!snap.exists) return res.status(404).json({ error: 'no existe' });
    const d = snap.data();

    // Toggle de Telegram, el mismo que usa el resto de la app
    const cfgDoc = await db.collection('caja_config').doc('notifications').get();
    if (cfgDoc.exists && cfgDoc.data()?.telegram?.enabled === false) {
      return res.status(200).json({ skipped: 'telegram apagado' });
    }

    // La apertura solo si hace falta: el que contó puede no haberla tenido.
    let aperturaDelDia = null;
    if (d.apertura === null || d.apertura === undefined) {
      const arq = await db.collection('caja_arqueos').doc(String(d.fecha || '')).get();
      if (arq.exists) aperturaDelDia = Number(arq.data().total) || 0;
    }

    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: armarMensaje(d, aperturaDelDia),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await r.json();
    if (!data.ok) {
      console.error('chequeo-aviso:', data);
      return res.status(200).json({ ok: false, error: data.description });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('chequeo-aviso:', e);
    return res.status(200).json({ ok: false, error: e.message });
  }
}
