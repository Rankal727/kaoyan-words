/* Service Worker：离线缓存（应用壳 + 词库分片）
 * 关键约束：
 *   1. 安装阶段只预缓存小体积应用壳，绝不在这里拉 1MB+ 的详情数据——
 *      否则弱网下 addAll 很容易整体失败，导致整个站点失去离线缓存。
 *   2. 词库文件名带版本号（core.v1.txt / detail.v1.json），内容不可变，
 *      因此可以放心 cache-first，不再每次打开都重新下载。
 *   3. 改前端代码时同步改 CACHE 版本号，旧缓存才会被清掉。
 */
const CACHE = "gwc-v14";
const INSTALL_TIMEOUT = 15000;   // 单个文件安装超时：弱网下绝不能把安装挂死
const SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "js/db.js",
  "vendor/dexie.min.js",
  "vendor/ts-fsrs.umd.js",
  "data/core.v1.txt",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 每个文件独立超时 + 独立失败：任何一个卡住或 404 都不会让整个安装停在 installing
    await Promise.allSettled(SHELL.map((url) => putWithTimeout(cache, url)));
    await self.skipWaiting();
  })());
});

async function putWithTimeout(cache, url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), INSTALL_TIMEOUT);
  try {
    const resp = await fetch(url, { cache: "reload", signal: ctl.signal });
    if (resp.ok) await cache.put(url, resp);
  } catch (e) {
    // 失败不阻塞安装：该资源在首次实际请求时仍会被运行时缓存
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putInCache(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 发音 API：网络优先，离线回退缓存
  if (url.hostname === "api.dictionaryapi.dev") {
    e.respondWith(
      fetch(req).then((resp) => putInCache(req, resp)).catch(() => caches.match(req))
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // 词库数据：文件名带版本号，内容不可变 → 缓存优先
  if (url.pathname.includes("/data/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((resp) => putInCache(req, resp)))
    );
    return;
  }

  // 应用壳：缓存优先 + 后台更新（下次打开即为新版本）
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((resp) => putInCache(req, resp))
        .catch(() => hit);
      return hit || net;
    })
  );
});
