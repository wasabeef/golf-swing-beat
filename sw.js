// オフラインでも使えるよう、アプリのファイルをキャッシュする Service Worker。
// 通信できるときは常に最新を取りに行き（network first）、取れなければキャッシュを使う。
// キャッシュの持ち方を変えたときだけ CACHE_NAME を変える。

const CACHE_NAME = 'golf-swing-beat-v1';

// 最初に開いたときにまとめてキャッシュするファイル（test/sw.test.ts で実在と漏れを確認する）
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'dist/audio.js',
  'dist/config.js',
  'dist/main.js',
  'dist/meter.js',
  'dist/metronome.js',
  'dist/service-worker.js',
  'dist/settings.js',
  'dist/timeline.js',
  'dist/wake-lock.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => (await caches.match(request, { ignoreSearch: true })) ?? Response.error()),
  );
});
