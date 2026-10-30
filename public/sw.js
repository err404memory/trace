// Trace service worker: offline app shell + Android "Share to Trace".
const SHELL = 'trace-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('trace-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // A file shared from another app arrives as a POST to share-target.
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      const form = await event.request.formData();
      const file = form.get('file');
      if (file && typeof file !== 'string') {
        const cache = await caches.open('trace-share');
        await cache.put('shared-file', new Response(file, { headers: { 'x-file-name': encodeURIComponent(file.name) } }));
      }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Pages: network first, so updates arrive; cached copy when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put('./index.html', copy));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  // Built assets have content hashes in their names: cache first.
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(event.request, copy)); }
    return res;
  })));
});
