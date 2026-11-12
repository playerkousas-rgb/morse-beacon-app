/* Scout Morse Service Worker — v5.3.0 · COPYRIGHT © 2026 SCOUT SYSTEM
   策略（PLAYBOOK I1–I8 / UP1–UP5）：
     · install 只喺「首次安裝」（未有 active SW）才 skipWaiting()；之後嘅更新留在 waiting，
       等用戶喺畫面上按「立即更新」才接手（唔准玩到一半偷換版）。
     · activate 清舊快取 + clients.claim()。
     · 導覽（HTML）network-first，靜態資源 stale-while-revalidate。
     · 版本號＝快取名；每次改版必須同步 index.html（meta app-version）／manifest／本檔。 */
const APP_VERSION = 'v5.3.0';
const CACHE = 'scout-morse-' + APP_VERSION;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.ico',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
  './assets/css/tailwind.min.css',
  './assets/fontawesome/css/all.min.css',
  './assets/fontawesome/webfonts/fa-brands-400.woff2',
  './assets/fontawesome/webfonts/fa-regular-400.woff2',
  './assets/fontawesome/webfonts/fa-solid-900.woff2',
  './assets/fontawesome/webfonts/fa-v4compatibility.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache:'reload' 繞過 HTTP 快取，確保新 SW 拿到新檔案
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .catch(() => {})
      // 首次安裝（未有 active SW）即刻接手；更新則留在 waiting 等用戶批准
      .then(() => (self.registration.active ? undefined : self.skipWaiting()))
  );
});

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'SKIP_WAITING') return;
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // 跨源（Vercel insights）交返瀏覽器處理
  if (url.pathname.startsWith('/_vercel/')) return;

  // 導覽請求：network-first，離線回退快取嘅 App Shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 同源靜態資源：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
