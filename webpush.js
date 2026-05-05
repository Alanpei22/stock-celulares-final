// ══════════════════════════════════════════
//  WEB PUSH — client-side (Phase 2)
//  Suscribe el navegador al Push API y guarda
//  la suscripción en Firestore.
//  Backend: /api/send-push.js (Vercel Function)
// ══════════════════════════════════════════

// VAPID PUBLIC KEY: se inyecta en build/runtime.
// Para empezar, queda hardcodeada acá. La privada vive solo en Vercel (env var).
// Para generar las claves: `npx web-push generate-vapid-keys`
const VAPID_PUBLIC_KEY = 'BFagfRF0p-1d8Dhs6UxsbA7_AMEDFFaahbZiDwwwNhJkav_eF3Gs9jv2ciC0j37ipMRlXbieBbaArwtbqszbwW4';

function _urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function isPushSupported() {
  return ('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window);
}

async function subscribeToPush() {
  if (!isPushSupported()) {
    if (typeof toast === 'function') toast('Tu navegador no soporta push', 'error');
    return false;
  }
  if (!VAPID_PUBLIC_KEY) {
    if (typeof toast === 'function') toast('Push no configurado todavía (falta VAPID key)', 'error');
    console.error('[push] VAPID_PUBLIC_KEY vacía. Configurar en webpush.js o window.VAPID_PUBLIC_KEY');
    return false;
  }

  try {
    // 1) Asegurar nombre del dispositivo
    if (typeof ensureDeviceName === 'function') {
      const name = ensureDeviceName(true);
      if (!name) {
        if (typeof toast === 'function') toast('Necesito un nombre para este dispositivo', 'info');
        return false;
      }
    }

    // 2) Pedir permiso
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      if (typeof toast === 'function') toast('Permiso de notificaciones denegado', 'error');
      return false;
    }

    // 3) Obtener registration del SW
    const reg = await navigator.serviceWorker.ready;

    // 4) Suscribir
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlB64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // 5) Guardar en Firestore
    await _saveSubscriptionToFirestore(sub);

    localStorage.setItem('pushSubscribed', '1');
    if (typeof toast === 'function') toast('🔔 Push activado en este dispositivo', 'success');
    return true;
  } catch (e) {
    console.error('[push] subscribe:', e);
    if (typeof toast === 'function') toast('No se pudo activar push: ' + e.message, 'error');
    return false;
  }
}

async function unsubscribeFromPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    await _removeSubscriptionFromFirestore();
    localStorage.removeItem('pushSubscribed');
    if (typeof toast === 'function') toast('Push desactivado', 'info');
    return true;
  } catch (e) {
    console.error('[push] unsubscribe:', e);
    return false;
  }
}

async function _saveSubscriptionToFirestore(subscription) {
  if (typeof db === 'undefined' || !db) return;
  const deviceId = getDeviceId();
  const deviceName = getDeviceName() || 'Sin nombre';
  await db.collection('caja_config')
    .doc('notifications')
    .collection('devices')
    .doc(deviceId)
    .set({
      name: deviceName,
      subscription: JSON.parse(JSON.stringify(subscription)),
      ua: navigator.userAgent,
      updatedAt: new Date().toISOString(),
    });
}

async function _removeSubscriptionFromFirestore() {
  if (typeof db === 'undefined' || !db) return;
  const deviceId = getDeviceId();
  await db.collection('caja_config')
    .doc('notifications')
    .collection('devices')
    .doc(deviceId)
    .delete()
    .catch(() => {});
}

async function updateDeviceNameInFirestore(name) {
  if (typeof db === 'undefined' || !db) return;
  const deviceId = getDeviceId();
  try {
    await db.collection('caja_config')
      .doc('notifications')
      .collection('devices')
      .doc(deviceId)
      .set({ name }, { merge: true });
  } catch (e) { console.error('[push] updateDeviceName:', e); }
}

// Test push: llama a /api/send-push con el deviceId actual
async function sendTestPush() {
  try {
    const deviceId = getDeviceId();
    const res = await fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targets: [deviceId],
        title: '🧪 Push de prueba',
        body: 'Si ves esto, las notificaciones funcionan.',
        url: '/index.html',
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return true;
  } catch (e) {
    console.error('[push] test:', e);
    return false;
  }
}

// ══════════════════════════════════════════
//  CROSS-DEVICE LOCAL NOTIFICATIONS
//  Cuando otro dispositivo crea un mov,
//  este lo escucha por onSnapshot y muestra
//  una notif local (NO requiere backend).
// ══════════════════════════════════════════

let _crossDeviceListener = null;
let _crossDeviceListenerRepairs = null;
let _crossDeviceStartTs = null;

function startCrossDeviceListener() {
  if (typeof db === 'undefined' || !db) return;
  // El popup in-page funciona siempre (no requiere permiso de push).
  // El push del SO solo se envía si Notification.permission === 'granted'.

  _crossDeviceStartTs = new Date().toISOString();
  const today = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10);

  // ── 1) Movimientos del día (cobros + señas) ──
  if (!_crossDeviceListener) {
    _crossDeviceListener = db.collection('caja_movimientos')
      .where('fecha', '==', today)
      .where('createdAt', '>', _crossDeviceStartTs)
      .onSnapshot(snap => {
        const cfg = (typeof getNotifConfig === 'function') ? getNotifConfig() : null;
        snap.docChanges().forEach(change => {
          if (change.type !== 'added') return;
          const m = change.doc.data();
          // No notificar nuestros propios movimientos
          if (m._sourceDevice === getDeviceId()) return;
          const monto = Number(m.monto) || 0;
          const montoStr = '$' + monto.toLocaleString('es-AR');

          // ── COBRO (ingreso) ──
          if (m.tipo === 'ingreso') {
            const titulo = m.esSena ? '🪙 Nueva seña' : '💰 Cobro recibido';
            const bodyParts = [];
            if (m.categoria) bodyParts.push(m.categoria);
            if (m.descripcion) bodyParts.push(m.descripcion);
            else if (m.itemNombre) bodyParts.push(m.itemNombre);
            else if (m.repairNOrden) bodyParts.push(`Reparación N°${m.repairNOrden}`);
            const body = `${montoStr} · ${m.metodoPago || 'Efectivo'}\n${bodyParts.join(' · ')}${m.vendedor ? '\nVendedor: ' + m.vendedor : ''}`;

            // Popup in-page (siempre)
            if (typeof showLivePopup === 'function') {
              showLivePopup({
                icon: m.esSena ? '🪙' : '💰',
                title: titulo,
                body,
                duration: 30000,
                tag: 'cobro-' + change.doc.id,
                onClick: () => location.href = 'caja.html',
              });
            }
            // Push del SO (solo si está activado)
            if (cfg && Notification.permission === 'granted') {
              if (m.esSena && cfg.push.senasNuevas) {
                _showLocalNotif({ title: titulo, body, tag: 'sena-' + change.doc.id });
              } else if (!m.esSena && cfg.push.cobrosRemotos) {
                _showLocalNotif({ title: titulo, body, tag: 'cobro-' + change.doc.id });
              }
            }
          }
        });
      }, err => console.error('[live] mov listener:', err));
  }

  // ── 2) Reparaciones nuevas ──
  if (!_crossDeviceListenerRepairs) {
    _crossDeviceListenerRepairs = db.collection('repairs')
      .where('fechaIngreso', '>', _crossDeviceStartTs)
      .onSnapshot(snap => {
        snap.docChanges().forEach(change => {
          if (change.type !== 'added') return;
          const r = change.doc.data();
          if (r._sourceDevice === getDeviceId()) return;
          const titulo = '🔧 Nueva reparación';
          const bodyParts = [];
          if (r.nOrden) bodyParts.push('N°' + r.nOrden);
          if (r.marca || r.modelo) bodyParts.push((r.marca || '') + ' ' + (r.modelo || '')).trim();
          if (r.arreglo) bodyParts.push(r.arreglo);
          const body = bodyParts.join(' · ') + (r.nombre ? '\nCliente: ' + r.nombre : '');

          if (typeof showLivePopup === 'function') {
            showLivePopup({
              icon: '🔧',
              title: titulo,
              body,
              duration: 30000,
              tag: 'rep-' + change.doc.id,
              onClick: () => location.href = 'index.html',
            });
          }
        });
      }, err => console.error('[live] repairs listener:', err));
  }
}

function stopCrossDeviceListener() {
  if (_crossDeviceListener) { _crossDeviceListener(); _crossDeviceListener = null; }
  if (_crossDeviceListenerRepairs) { _crossDeviceListenerRepairs(); _crossDeviceListenerRepairs = null; }
}

function _showLocalNotif({ title, body, tag, url }) {
  if (Notification.permission !== 'granted') return;
  // Preferir SW notification (más confiable en mobile)
  if (navigator.serviceWorker?.ready) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, {
        body,
        tag,
        icon: '/icon.svg',
        badge: '/icon.svg',
        data: { url: url || '/index.html' },
      });
    }).catch(() => {
      try { new Notification(title, { body, tag }); } catch {}
    });
  } else {
    try { new Notification(title, { body, tag }); } catch {}
  }
}

// Marcar el deviceId en cada movimiento que se crea (para no auto-notificarse)
// Se llama desde caja.js antes de db.collection('caja_movimientos').add(...)
window._withSourceDevice = function(data) {
  return { ...data, _sourceDevice: getDeviceId() };
};
