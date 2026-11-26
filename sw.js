/* elMotion 서비스 워커: 온라인이면 항상 최신 파일, 신호가 끊기면(엘리베이터 안 등) 저장해 둔 파일로 실행 */
const CACHE = "elmotion-v69";
const FILES = ["./", "index.html", "app.js", "core.js", "render.js", "sync.js", "manifest.webmanifest",
  "assets/glass.webp", "assets/glass-dark.webp", "assets/fonts/NanumSquareNeo-Variable.woff",
  "assets/ic-measure.png", "assets/ic-records.png", "assets/ic-settings.png",
  "assets/lift-frame.webp", "assets/lift-leafL.webp", "assets/lift-leafR.webp",
  "assets/app-icon-180.png", "assets/app-icon-192.png", "assets/app-icon-512.png"];
// 파일 하나가 없어도 설치가 멈추지 않게 하나씩 담는다
// 새로 받지 못한 파일은 이전 버전 저장소에서 옮겨 담는다 (업데이트 순간 신호가 약해도 유리 이미지 등이 사라지지 않게)
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f =>
    c.add(new Request(f, { cache: "reload" })).catch(() => caches.match(f, { ignoreSearch: true }).then(old => old ? c.put(f, old) : null))
  ))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req, { cache: "no-cache" }).then(res => {   // 브라우저 HTTP 캐시(깃허브 10분)를 건너뛰고 서버에 확인
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r =>
    r || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))));   // 이미지 자리에 index.html을 주지 않음
});
