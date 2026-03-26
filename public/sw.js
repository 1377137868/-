const CACHE_NAME = 'focus-app-cache-v1';

// 基础需要预先缓存的文件（确保离线时页面骨架能立刻加载）
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// 安装时缓存核心文件
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

// 激活时清理旧版本缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// 拦截网络请求：优先使用网络数据，断网时自动降级使用本地缓存 (Network First, fallback to Cache)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 请求成功时，将最新的资源动态存入缓存
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // 断网失败时，尝试从缓存返回
        return caches.match(event.request);
      })
  );
});