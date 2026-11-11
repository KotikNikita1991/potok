// Работа без сети: все файлы приложения кладутся в кэш целиком, версия меняется при публикации.
// Версию и список файлов обновляет scripts/stamp-sw.mjs.

const VERSION = 'cfc77961accb';
const FILES = [
  './',
  './apps-script/potok.gs',
  './assets/fonts/onest-cyrillic.woff2',
  './assets/fonts/onest-latin.woff2',
  './assets/icons/favicon.svg',
  './assets/icons/icon-180.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './css/app.css',
  './index.html',
  './js/core/calendar.js',
  './js/core/doc.js',
  './js/core/format.js',
  './js/core/holidays.js',
  './js/core/ops.js',
  './js/core/plan.js',
  './js/core/sample.js',
  './js/core/table.js',
  './js/core/time.js',
  './js/core/whatif.js',
  './js/main.js',
  './js/sync/gist.js',
  './js/sync/table.js',
  './js/ui/actions.js',
  './js/ui/board.js',
  './js/ui/day-sheet.js',
  './js/ui/dom.js',
  './js/ui/nowbar.js',
  './js/ui/overlays.js',
  './js/ui/settings-sheet.js',
  './js/ui/sheet.js',
  './js/ui/store.js',
  './js/ui/table-sheet.js',
  './js/ui/task-sheet.js',
  './js/ui/timeline.js',
  './manifest.webmanifest',
];
const CACHE = `potok-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('potok-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: request.mode === 'navigate' }).then((cached) => {
      if (cached) return cached;
      if (request.mode === 'navigate') {
        return caches.match('./').then((shell) => shell ?? fetch(request));
      }
      return fetch(request);
    }),
  );
});
