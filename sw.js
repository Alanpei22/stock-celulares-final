const CACHE = 'cel-v105';
const SHELL = ['manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'mp-logo.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const ext = url.pathname.split('.').pop();

  // HTML: network-first — siempre busca la versión más nueva
  if (ext === 'html' || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request).then(res => {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // JS y CSS: stale-while-revalidate — sirve del caché al instante, actualiza en fondo
  if (['js', 'css'].includes(ext)) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const networkFetch = fetch(e.request).then(res => {
            cache.put(e.request, res.clone());
            return res;
          });
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // Todo lo demás (imágenes, fuentes, etc.): cache-first
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// ══════════════════════════════════════════
//  WEB PUSH — recepción + click
// ══════════════════════════════════════════
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: 'Notificación', body: event.data ? event.data.text() : '' }; }

  const title = data.title || '🔔 TechPoint';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: data.tag || undefined,
    requireInteraction: !!data.requireInteraction,
    data: { url: data.url || '/index.html', ...(data.data || {}) },
  };
  if (data.actions) options.actions = data.actions;

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      // Si hay una ventana abierta de la app, focusearla y navegar
      for (const w of wins) {
        if (w.url.includes(self.registration.scope) && 'focus' in w) {
          w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
