// دفتر الديون الصوتي — Service Worker
// يخزّن كل ملفات التطبيق محلياً بحيث يعمل التطبيق بالكامل بدون إنترنت بعد أول زيارة
const CACHE_NAME = 'daftar-sawti-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './parser.js',
  './app.js',
  './manifest.json',
  './favicon.ico',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './icons/icon-96.png',
  './icons/icon-120.png',
  './icons/icon-152.png',
  './icons/icon-384.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// استراتيجية: الشبكة أولاً للملفات الأساسية، والرجوع للكاش عند انقطاع الإنترنت
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});
