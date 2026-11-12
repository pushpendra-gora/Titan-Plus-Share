// Titan Plus Share Service Worker for Web Share Target & Offline Resilience
const CACHE_NAME = 'titan-share-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // If this is a share-target POST, let the server handle it
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    return;
  }

  // Pass-through standard requests to network
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
