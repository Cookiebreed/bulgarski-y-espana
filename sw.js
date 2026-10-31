// Macht den Start sofort und die App offline nutzbar.
const CACHE = 'bulgarski-v1';
const SHELL = new URL('./', self.registration.scope).href;
/** Länger wartet die App beim Start nicht aufs Netz, wenn sie eine Kopie hat. */
const NETWORK_WAIT_MS = 800;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const response = await fetch(new URL('precache.json', SHELL), { cache: 'no-store' });
      const files = await response.json();
      await cache.addAll([SHELL, ...files.map((f) => new URL(f, SHELL).href)]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      // Dateien unter assets/ tragen einen Inhalts-Hash im Namen und ändern sich nie.
      url.pathname.includes('/assets/') ? fromCacheFirst(cache, request) : fromNetworkFirst(cache, request),
    ),
  );
});

async function fromCacheFirst(cache, request) {
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Manche Hoster liefern für fehlende Dateien die Startseite, die darf hier nie hängen bleiben.
  const isHtml = (response.headers.get('content-type') ?? '').includes('text/html');
  if (response.ok && !isHtml) cache.put(request, response.clone());
  return response;
}

async function fromNetworkFirst(cache, request) {
  const key = request.mode === 'navigate' ? SHELL : request;
  const cached = await cache.match(key);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(key, response.clone());
    return response;
  });
  if (!cached) return network;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_WAIT_MS));
  return Promise.race([network.catch(() => cached), timeout]);
}
