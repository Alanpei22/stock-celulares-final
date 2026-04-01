const CACHE = 'cel-v11';
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

  // JS, CSS y HTML: stale-while-revalidate
  // Sirve del caché al instante; actualiza en segundo plano para la próxima visita
  if (['js', 'css', 'html'].includes(ext) || url.pathname.endsWith('/')) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const networkFetch = fetch(e.request).then(res => {
            cache.put(e.request, res.clone());
            return res;
          });
          // Si hay versión cacheada la sirve al instante y actualiza en fondo
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
