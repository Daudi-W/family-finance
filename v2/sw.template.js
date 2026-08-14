/*
 * App 本體的離線快取。檔名清單與快取代號由 vite.config.ts 在建置時填入。
 * 策略：
 * - 開啟頁面（navigate）走「先連網、失敗才用快取」，有網路一定拿到最新版本，不會卡在舊版。
 * - 內容雜湊過的 assets 走「先快取」，因為檔名變了就是新檔案。
 * - 跨網域請求（Firebase、Google 登入、匯率）完全不攔截，交給瀏覽器與 Firestore 自己處理。
 */
const CACHE_NAME = '__CACHE_NAME__'
const PRECACHE = __PRECACHE__
const scoped = (path) => new URL(path, self.location).href

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE.map(scoped)))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put(scoped('index.html'), copy))
          return response
        })
        .catch(() => caches.match(scoped('index.html')).then((cached) => cached ?? Response.error())),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok && url.pathname.includes('/assets/')) {
        const copy = response.clone()
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
      }
      return response
    })),
  )
})
