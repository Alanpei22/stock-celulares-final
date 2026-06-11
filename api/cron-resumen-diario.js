// Vercel Function — invocada por GitHub Actions a las 21:00 AR (00:00 UTC)
// Calcula el resumen del día desde caja_movimientos + repairs y lo manda
// por push a todos los dispositivos suscritos.

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

function fmtK(n) {
  n = Math.round(Number(n) || 0);
  return '$' + n.toLocaleString('es-AR');
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const a = getAdmin();
    const db = a.firestore();
    const today = todayAR();

    // Toggle opcional: se puede apagar con push.resumenDiario=false en la config
    const cfgDoc = await db.collection('caja_config').doc('notifications').get();
    const cfg = cfgDoc.exists ? cfgDoc.data() : {};
    if (cfg?.push?.enabled === false || cfg?.push?.resumenDiario === false) {
      return res.status(200).json({ skipped: 'resumenDiario deshabilitado' });
    }

    // ── Movimientos del día ──
    const movsSnap = await db.collection('caja_movimientos')
      .where('fecha', '==', today).get();
    const movs = movsSnap.docs.map(d => d.data());

    if (!movs.length) {
      return res.status(200).json({ skipped: 'sin movimientos hoy' });
    }

    let ingresos = 0, egresos = 0, ganancia = 0, ventas = 0;
    const porMetodo = {};
    for (const m of movs) {
      const monto = Number(m.monto) || 0;
      if (m.tipo === 'ingreso') {
        ingresos += monto;
        ventas++;
        ganancia += Number(m.gananciaARS) || 0;
        // Split de pago: monto2 va al 2do método, el resto al 1ro
        const m2 = Number(m.monto2) || 0;
        const met1 = m.metodoPago || 'Efectivo';
        porMetodo[met1] = (porMetodo[met1] || 0) + (monto - m2);
        if (m2 > 0 && m.metodoPago2) {
          porMetodo[m.metodoPago2] = (porMetodo[m.metodoPago2] || 0) + m2;
        }
      } else {
        egresos += monto;
      }
    }

    // ── Reparaciones del día (rango sobre ISO string) ──
    const d0 = today + 'T00:00:00';
    const d1 = today + 'T23:59:59';
    let repIn = 0, repOut = 0;
    try {
      const inSnap = await db.collection('repairs')
        .where('fechaIngreso', '>=', d0).where('fechaIngreso', '<=', d1).get();
      repIn = inSnap.size;
    } catch (e) { console.error('repairs in:', e.message); }
    try {
      const outSnap = await db.collection('repairs')
        .where('fechaCobro', '>=', d0).where('fechaCobro', '<=', d1).get();
      repOut = outSnap.size;
    } catch (e) { console.error('repairs out:', e.message); }

    // ── Armar el cuerpo del push ──
    const metodoStr = Object.entries(porMetodo)
      .sort((x, y) => y[1] - x[1])
      .map(([met, tot]) => `${met}: ${fmtK(tot)}`)
      .join(' · ');

    const lines = [
      `💰 Ingresos ${fmtK(ingresos)} (${ventas}) · Gastos ${fmtK(egresos)}`,
      `📦 Balance ${fmtK(ingresos - egresos)}${ganancia > 0 ? ` · Ganancia prod. ${fmtK(ganancia)}` : ''}`,
    ];
    if (metodoStr) lines.push(metodoStr);
    if (repIn || repOut) lines.push(`🔧 Reparaciones: ${repIn} entraron · ${repOut} cobradas`);

    // ── Enviar push ──
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (process.env.PUBLIC_URL || '');
    const r = await fetch(baseUrl + '/api/send-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({
        targets: 'all',
        pushKey: 'resumenDiario',
        title: `📊 Resumen del día — ${today.split('-').reverse().join('/')}`,
        body: lines.join('\n'),
        url: '/caja.html',
        tag: 'resumen-diario',
        requireInteraction: true,
      }),
    });
    const data = await r.json();
    return res.status(200).json({ resumen: { ingresos, egresos, ventas, ganancia, repIn, repOut }, push: data });
  } catch (e) {
    console.error('cron-resumen-diario:', e);
    return res.status(500).json({ error: e.message });
  }
}
