// Service worker de la app web / PWA: permite abrirla sin conexión después de una primera carga.
// Solo guarda los archivos de la propia app (página, código, fuentes, iconos). NUNCA guarda respuestas
// del servidor de datos (otro dominio) ni peticiones que no sean GET: las partidas viven en IndexedDB.
// - Página (navegación): primero la red, así una versión nueva llega en cuanto hay conexión; sin red,
//   la última página guardada.
// - Código y recursos con hash en el nombre (/_expo/static, /assets): primero la caché (no cambian).
// - Resto de archivos propios (manifest, iconos): caché y actualización en segundo plano.
const VERSION = 'v1';
const SHELL = `domino-shell-${VERSION}`;
const ASSETS = `domino-assets-${VERSION}`;
const MAX_ASSETS = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['/', '/manifest.json']))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('domino-') && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const sameOrigin = (url) => url.origin === self.location.origin;
const immutable = (url) => url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/');

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

async function cacheAsset(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') {
    await cache.put(request, res.clone());
    void trim(cache);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!sameOrigin(url) || url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res.ok) {
            const cache = await caches.open(SHELL);
            // Todas las rutas de la app usan la misma página (index.html).
            await cache.put('/', res.clone());
          }
          return res;
        } catch {
          const cached = (await caches.match('/', { cacheName: SHELL })) || (await caches.match(request));
          return cached || new Response('<h1>Sin conexión</h1><p>Abre la app una vez con internet para usarla sin conexión.</p>', { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 503 });
        }
      })(),
    );
    return;
  }

  if (immutable(url)) {
    event.respondWith(cacheAsset(request));
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res.ok && res.type === 'basic') void cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })(),
  );
});

// La página envía los archivos que ya cargó antes de que existiera este service worker (primera
// visita) para que queden guardados y la app abra sin conexión desde la segunda vez.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'cache-urls' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    Promise.all(
      data.urls.slice(0, 200).map(async (raw) => {
        try {
          const url = new URL(raw, self.location.origin);
          if (!sameOrigin(url) || url.pathname === '/sw.js') return;
          if (immutable(url)) await cacheAsset(new Request(url.href));
          else {
            const res = await fetch(url.href);
            if (res.ok && res.type === 'basic') await (await caches.open(SHELL)).put(url.href, res);
          }
        } catch {
          // sin red: se reintentará en la próxima visita
        }
      }),
    ).then(() => {
      if (event.source) event.source.postMessage({ type: 'cached' });
    }),
  );
});
