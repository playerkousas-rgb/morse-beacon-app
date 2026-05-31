/* SKW Morse Service Worker
   策略：App Shell 與本地 CSS / 字型資源預快取 + 線上優先回退快取。
   每次改版請更新 CACHE 版本字串。 */
const CACHE = 'skw-morse-v3.1.1-local-assets';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './assets/css/tailwind.min.css',
  './assets/fontawesome/css/all.min.css',
  './assets/fontawesome/webfonts/fa-brands-400.woff2',
  './assets/fontawesome/webfonts/fa-brands-400.ttf',
  './assets/fontawesome/webfonts/fa-regular-400.woff2',
  './assets/fontawesome/webfonts/fa-regular-400.ttf',
  './assets/fontawesome/webfonts/fa-solid-900.woff2',
  './assets/fontawesome/webfonts/fa-solid-900.ttf',
  './assets/fontawesome/webfonts/fa-v4compatibility.woff2',
  './assets/fontawesome/webfonts/fa-v4compatibility.ttf'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 同源資源：網路優先，失敗回退快取（適合常更新的單頁）
  if (new URL(req.url).origin === location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
  }
  // 跨源資源：快取優先（目前 App Shell 已改用本地資源，通常不會走到這裡）
  else {
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached))
    );
  }
});
