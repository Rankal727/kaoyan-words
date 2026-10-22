/* Service Worker：离线缓存（应用壳 + 词库） */
const CACHE = "gwc-v9";
const CORE = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "js/db.js",
  "vendor/dexie.min.js",
  "vendor/ts-fsrs.umd.js",
  "data/words.json",
  "data/provenance.json",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // 词库数据：网络优先（保证更新），离线回退缓存
  if (url.origin === location.origin && url.pathname.includes("/data/")) {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // 发音 API/音频：网络优先，失败回退缓存
  if (url.hostname === "api.dictionaryapi.dev") {
    e.respondWith(
      fetch(e.request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // 本地资源：缓存优先
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return resp;
      }))
    );
  }
});
