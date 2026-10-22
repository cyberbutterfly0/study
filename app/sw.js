/**
 * sw.js —— Service Worker
 *
 * 策略：
 *   页面导航  → 网络优先，断网回退缓存的 index.html（离线打开 app）
 *   代码/数据 → 网络优先 + 缓存兜底（这样电脑上重新构建，手机连网刷新就能拿到新版本）
 *   其余资源  → stale-while-revalidate（先用缓存秒开，后台悄悄更新）
 *
 * 改了这个文件里的 CACHE 版本号，旧缓存会在下次激活时清掉。
 */

const VERSION = 'v3';
const CACHE = `study-app-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/style.css',
  './assets/app.js',
  './assets/store.js',
  './assets/ai.js',
  './assets/markdown.js',
  './data/library.json',
  './data/questions.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())   // 单个文件 404 不要卡住整个安装
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 只接管本站资源；DeepSeek API 等跨域请求直接放行
  if (url.origin !== self.location.origin) return;

  // 页面导航
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // 只缓存正常的 HTML；把 404/500 当成 app 外壳存下去，会让人一开就卡在错误页
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
            return res;
          }
          const cached = await caches.match('./index.html');
          if (cached) return cached;
          return res;
        } catch {
          const cached = (await caches.match('./index.html')) || (await caches.match('./'));
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // 代码和数据：网络优先（改了代码要立刻生效，不能等下一次打开）
  if (
    url.pathname.includes('/data/') ||
    url.pathname.includes('/assets/') ||
    url.pathname.endsWith('manifest.webmanifest')
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 其余静态资源：先给缓存，同时后台更新
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
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

// 允许页面主动要求跳过等待，用于题库更新后提示
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
