// Service worker du client mobile : l'interface est servie depuis le cache pour un démarrage rapide,
// puis rafraîchie en arrière-plan. L'API et le temps réel ne passent jamais par le cache.
const CACHE = 'motscultes-v2'; // changer la version à chaque modification de l'interface
const SHELL = ['/mobile/', '/shared/core.js', '/socket.io/socket.io.min.js', '/mobile/icon.svg', '/mobile/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || (url.pathname.startsWith('/socket.io/') && url.search)) return;
  // La page elle-même est servie sans le paramètre ?code=… (le code est lu par le script).
  const key = url.pathname === '/mobile/' || url.pathname === '/mobile/index.html' ? '/mobile/' : e.request;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key);
    const fresh = fetch(e.request).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    if (cached) { fresh.catch(() => {}); return cached; }
    return fresh;
  }));
});
