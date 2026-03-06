// =============================================
//  Milkly Service Worker
//  Cache-first for static assets, network-first
//  for API calls (Supabase).
// =============================================

const CACHE_NAME = 'milkly-v1';
const CACHE_VERSION = 1;

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;1,500&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// ===== INSTALL =====
self.addEventListener('install', event => {
  console.log('[Milkly SW] Installing v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Milkly SW] Pre-caching assets');
        // Use individual adds to avoid one bad URL killing the install
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url => cache.add(url).catch(e => console.warn('Cache miss:', url, e)))
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ===== ACTIVATE =====
self.addEventListener('activate', event => {
  console.log('[Milkly SW] Activating v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[Milkly SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ===== FETCH =====
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-first for Supabase API calls (always need fresh data)
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Network-first for Google Fonts (needs fresh CSS)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Cache-first for everything else (JS, CSS, HTML, icons)
  if (event.request.method === 'GET') {
    event.respondWith(cacheFirst(event.request));
  }
});

// ===== STRATEGIES =====

// Cache-first: serve from cache, fall back to network and cache response
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Return offline fallback if available
    const fallback = await caches.match('/index.html');
    return fallback || new Response('Offline — please reconnect to use Milkly.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Network-first: try network, fall back to cache
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Stale-while-revalidate: serve cache immediately, update in background
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// ===== BACKGROUND SYNC (future-proof) =====
self.addEventListener('sync', event => {
  if (event.tag === 'sync-logs') {
    console.log('[Milkly SW] Background sync triggered');
    // Future: sync offline logs when connection restores
  }
});

// ===== PUSH NOTIFICATIONS (future-proof) =====
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'Milkly', {
    body: data.body || "Don't forget your milk today! 🥛",
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-96.png',
    tag: 'milkly-reminder',
    renotify: true,
    vibrate: [200, 100, 200]
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      if (clientList.length > 0) return clientList[0].focus();
      return clients.openWindow('/');
    })
  );
});