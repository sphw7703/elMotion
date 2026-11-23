/* elMotion 서비스 워커: 온라인이면 항상 최신 파일, 신호가 끊기면(엘리베이터 안 등) 저장해 둔 파일로 실행 */
const CACHE = "elmotion-v18";
const FILES = ["./", "index.html", "app.js", "core.js", "manifest.webmanifest",
  "assets/glass.webp", "assets/glass-dark.webp", "assets/fonts/NanumSquareNeo-Variable.woff",
  "assets/ic-measure.png", "assets/ic-records.png", "assets/ic-settings.png",
  "assets/app-icon-180.png", "assets/app-icon-192.png", "assets/app-icon-512.png"];
// 파일 하나가 없어도 설치가 멈추지 않게 하나씩 담는다
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});
