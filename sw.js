const CACHE_NAME = 'pintracker-v8';
const ASSETS = [
  '/PintrackerPro/',
  '/PintrackerPro/index.html',
  '/PintrackerPro/style.css',
  '/PintrackerPro/app.js',
  '/PintrackerPro/firebase-setup.js',
  '/PintrackerPro/manifest.json',
  '/PintrackerPro/icon-192.png',
  '/PintrackerPro/icon-512.jpg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});