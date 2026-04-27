const CACHE = 'cel-v21';
const SHELL = ['manifest.json', 'icon.svg'];

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
