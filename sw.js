'use strict';
/* まいにちジグソー Service Worker
 * 方針:
 *  - HTML (ナビゲーション) は NetworkFirst: 手動再デプロイの運用でも更新が即届く
 *  - 同一オリジンの静的アセットは StaleWhileRevalidate: キャッシュで即表示し、裏で更新
 *  - BGM の mp3 (合計 約85MB) はプリキャッシュしない。実際に再生されたものだけ
 *    Audio キャッシュに貯める (CacheFirst のランタイムキャッシュ)
 *  - 対象は同一オリジンの GET のみ。写真プール等の外部オリジンは素通しする
 * キャッシュを丸ごと入れ替えたいときは VERSION を上げる。 */

var VERSION = 'v12';
var STATIC_CACHE = 'daily-jigsaw-static-' + VERSION;
var AUDIO_CACHE = 'daily-jigsaw-audio-' + VERSION;
var KNOWN_CACHES = [STATIC_CACHE, AUDIO_CACHE];

/* プリキャッシュは最小限 (mp3 は含めない) */
var PRECACHE_URLS = [
  './',
  'index.html',
  'app.js',
  'style.css',
  'manifest.webmanifest',
  'data/images.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function (cache) { return cache.addAll(PRECACHE_URLS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          return KNOWN_CACHES.indexOf(key) === -1 ? caches.delete(key) : Promise.resolve(false);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function isAudioRequest(url) {
  return url.pathname.indexOf('/audio/') !== -1 || /\.mp3$/i.test(url.pathname);
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // 外部オリジンは素通し

  /* HTML: NetworkFirst。失敗したらキャッシュ済みの index.html を返す */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          if (response.ok) {
            var copy = response.clone();
            caches.open(STATIC_CACHE)
              .then(function (cache) { return cache.put('index.html', copy); })
              .catch(function () { /* 保存に失敗しても応答は返す */ });
          }
          return response;
        })
        .catch(function () {
          return caches.match('index.html', { ignoreSearch: true })
            .then(function (cached) { return cached || caches.match('./', { ignoreSearch: true }); });
        })
    );
    return;
  }

  /* BGM: CacheFirst のランタイムキャッシュ */
  if (isAudioRequest(url)) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
          if (cached) return cached;
          return fetch(request).then(function (response) {
            /* Range リクエストの部分応答 (206) はキャッシュに入れない */
            if (response.status === 200 && !request.headers.has('range')) {
              cache.put(request, response.clone()).catch(function () { /* ignore */ });
            }
            return response;
          });
        });
      })
    );
    return;
  }

  /* コードとスタイルは NetworkFirst: HTML だけ新しくて app.js が古い、という
   * 版の混在 (新UIのボタンが無反応になる等) を防ぐ。失敗時はキャッシュへ */
  if (url.pathname.endsWith('/app.js') || url.pathname.endsWith('/style.css')) {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          if (response.status === 200) {
            var copy = response.clone();
            caches.open(STATIC_CACHE)
              .then(function (cache) { return cache.put(request, copy); })
              .catch(function () { /* ignore */ });
          }
          return response;
        })
        .catch(function () { return caches.match(request, { ignoreSearch: true }); })
    );
    return;
  }

  /* 静的アセット (data / wall-items 画像など): StaleWhileRevalidate */
  event.respondWith(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.match(request, { ignoreSearch: true }).then(function (cached) {
        var network = fetch(request)
          .then(function (response) {
            if (response.status === 200) {
              cache.put(request, response.clone()).catch(function () { /* ignore */ });
            }
            return response;
          })
          .catch(function () { return cached; });
        return cached || network;
      });
    })
  );
});
