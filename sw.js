// __BUILD_ID__ is substituted by the Pages deploy workflow, so every deploy
// gets its own cache and the activate handler drops the previous one. Without
// this a stale cached copy can survive a deploy and make it look like the
// deploy never landed.
const CACHE_NAME = 'image-editor-__BUILD_ID__';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon.svg'
];
// Third-party asset: must match the CDN URL loaded by index.html. Cached
// opportunistically because addAll() rejects as a whole if any single
// request fails, which would abort the entire service worker install.
const OPTIONAL_ASSETS = [
  'https://unpkg.com/heic2any@0.0.4/dist/heic2any.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c =>
      c.addAll(ASSETS).then(() =>
        Promise.all(OPTIONAL_ASSETS.map(url => c.add(url).catch(() => {})))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
