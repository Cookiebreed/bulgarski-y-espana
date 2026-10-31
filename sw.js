// Macht den Start sofort und die App offline nutzbar.
const CACHE = 'bulgarski-v3';
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
      // Dateien unter assets/ und audio/ tragen einen Hash im Namen und ändern sich nie.
      /\/(assets|audio)\//.test(url.pathname) ? fromCacheFirst(cache, request) : fromNetworkFirst(cache, request),
    ),
  );
});

async function fromCacheFirst(cache, request) {
  // Immer die ganze Datei holen und speichern, auch wenn Safari nur einen Teil anfragt.
  const whole = new Request(request.url);
  let response = await cache.match(whole);
  if (!response) {
    response = await fetch(whole);
    // Manche Hoster liefern für fehlende Dateien die Startseite, die darf hier nie hängen bleiben.
    const isHtml = (response.headers.get('content-type') ?? '').includes('text/html');
    if (response.ok && !isHtml) cache.put(whole, response.clone());
  }
  const range = request.headers.get('range');
  return range && response.ok ? partial(response, range) : response;
}

/** Safari spielt Audio nur ab, wenn Teilanfragen auch als Teilantwort beantwortet werden. */
async function partial(response, range) {
  const bytes = await response.arrayBuffer();
  const match = /bytes=(\d+)-(\d*)/.exec(range);
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(Number(match[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
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
