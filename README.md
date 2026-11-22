<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#101319">
<title>엘리베이터 승차감 측정</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
/* 계기판 느낌의 단일 다크 테마: 흑연색 바탕 + 항목별 신호색, 상단 요약 → 하단 상세 */
:root {
  --bg: #101319;
  --panel: #181C24;
  --panel-2: #222733;
  --line: #333A48;
  --ink: #ECEFF4;
  --ink-2: #A5ADBB;
  --ink-3: #6C7483;
  --primary: #8FB3FF;
  --max: #FF6B6B;
  --min: #5AA9FF;
  --danger: #E5484D;
  --m0: #FFB547; --m1: #4FD1E8; --m2: #C792EA; --m3: #5BE0A0;
  --font-body: "IBM Plex Sans KR", -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
  --font-num: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg); color: var(--ink); font-family: var(--font-body);
  -webkit-tap-highlight-color: transparent; font-size: 15px; line-height: 1.45;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);
}
button { font: inherit; color: inherit; }
button:focus-visible, input:focus-visible, .card:focus-visible, .item:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.app { max-width: 560px; margin: 0 auto; min-height: 100%; display: flex; flex-direction: column; }
header { display: flex; align-items: center; gap: 8px; padding: 12px 16px 8px; }
header .t { flex: 1; min-width: 0; }
header h1 { font-size: 19px; margin: 0; font-weight: 600; text-wrap: balance; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
header .sub { font-size: 12px; color: var(--ink-3); }
.btn-ghost { background: transparent; border: 1px solid var(--line); border-radius: 10px; padding: 7px 12px; font-size: 14px; cursor: pointer; color: var(--ink-2); display: inline-flex; align-items: center; gap: 6px; }
.btn-ghost:disabled { opacity: .4; cursor: default; }
.icon-btn { background: transparent; border: 0; width: 40px; height: 40px; border-radius: 10px; cursor: pointer; color: var(--ink-2); display: grid; place-items: center; }
.icon-btn:hover { background: var(--panel); }
main { flex: 1; padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; }
.status { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ink-3); flex: none; }
.dot.live { animation: blink 1.2s ease-in-out infinite; }
@keyframes blink { 50% { opacity: .25; } }
.status .txt { flex: 1; font-variant-numeric: tabular-nums; }
.status .rate { font-size: 11px; color: var(--ink-3); font-family: var(--font-num); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 12px 14px; cursor: pointer; text-align: left; transition: opacity .2s; }
.card.sel { border-color: var(--c); box-shadow: inset 0 0 0 .5px var(--c); }
.card.dim { opacity: .55; }
.card .h { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink-2); }
.sw { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none; }
.card .v { display: flex; align-items: baseline; gap: 4px; margin-top: 4px; }
.card .num { font-family: var(--font-num); font-size: 27px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.5px; white-space: nowrap; }
.card .u { font-size: 12px; color: var(--ink-3); }
.card .hint { font-size: 11px; color: var(--ink-3); min-height: 16px; }
.card .hint.on { color: var(--c); }
.chart-panel { padding: 12px 0 6px; }
.chart-head { padding: 0 14px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.chart-head .name { font-weight: 600; font-size: 15px; }
.chart-head .unit { color: var(--ink-3); font-size: 12px; flex: 1; }
.chart-cap { color: var(--ink-2); font-size: 12px; padding: 0 14px; }
canvas.chart { display: block; width: 100%; height: 210px; touch-action: pan-y; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 14px 0; }
.chip { display: inline-flex; gap: 5px; align-items: baseline; border-radius: 8px; padding: 3px 8px; font-size: 11px; background: color-mix(in srgb, var(--c) 13%, transparent); color: var(--c); }
.chip b { color: var(--ink); font-family: var(--font-num); font-size: 12px; font-weight: 600; }
.guide { padding: 16px; display: flex; flex-direction: column; gap: 9px; }
.guide h2, .calib h2 { font-size: 15px; margin: 0; font-weight: 600; }
.guide ol { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; counter-reset: g; }
.guide li { display: flex; gap: 10px; color: var(--ink-2); font-size: 13.5px; counter-increment: g; }
.guide li::before { content: counter(g); flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: var(--primary); background: color-mix(in srgb, var(--primary) 15%, transparent); margin-top: 1px; }
.note { color: var(--ink-3); font-size: 12px; margin: 0; }
.warn { color: var(--max); font-size: 12px; margin: 0; }
.calib { padding: 16px; display: flex; flex-direction: column; gap: 6px; color: var(--ink-2); font-size: 13.5px; }
.footer { position: sticky; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: linear-gradient(transparent, var(--bg) 30%); display: flex; flex-direction: column; gap: 8px; }
.btn-main { width: 100%; height: 58px; border: 0; border-radius: 16px; font-size: 18px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; background: var(--primary); color: #0B1530; }
.btn-main.stop { background: var(--danger); color: #fff; }
.btn-main .ic { width: 14px; height: 14px; border-radius: 50%; background: currentColor; }
.btn-main.stop .ic { border-radius: 2px; }
.btn-link { background: none; border: 0; color: var(--ink-2); font-size: 13px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; padding: 4px; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.btn-sec { height: 50px; border-radius: 14px; border: 1px solid var(--line); background: var(--panel); font-weight: 600; cursor: pointer; }
.btn-pri { height: 50px; border-radius: 14px; border: 0; background: var(--primary); color: #0B1530; font-weight: 700; cursor: pointer; }
.summary { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.info .l { font-size: 11px; color: var(--ink-3); }
.info .val { font-family: var(--font-num); font-weight: 600; font-size: 15px; }
table.stats { width: 100%; border-collapse: collapse; font-size: 13px; border-top: 1px solid var(--line); }
table.stats th { font-weight: 500; font-size: 12px; text-align: right; padding: 8px 0 2px; }
table.stats th:first-child { text-align: left; color: var(--ink-3); }
table.stats td { padding: 7px 0 0; text-align: right; font-family: var(--font-num); font-weight: 600; font-variant-numeric: tabular-nums; }
table.stats td:first-child { text-align: left; font-family: var(--font-body); font-weight: 400; }
table.stats td .u { color: var(--ink-3); font-size: 11px; }
.legend { font-size: 11px; color: var(--ink-3); margin: 0; }
.list { display: flex; flex-direction: column; gap: 10px; }
.item { padding: 10px 4px 12px 14px; cursor: pointer; }
.item .top { display: flex; align-items: center; gap: 6px; }
.item .top .t { flex: 1; min-width: 0; }
.item .nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .dt { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 6px; background: var(--panel-2); color: var(--ink-2); margin-left: 6px; vertical-align: 2px; }
.mini { display: grid; grid-template-columns: 1.3fr 1fr 1fr 1fr; gap: 6px; padding-right: 10px; margin-top: 8px; }
.mini .l { font-size: 10px; color: var(--c); white-space: nowrap; }
.mini .val { font-family: var(--font-num); font-size: 13px; font-weight: 600; white-space: nowrap; }
.mini .u { font-size: 10px; color: var(--ink-3); }
.empty { text-align: center; color: var(--ink-2); padding: 48px 24px; }
.toast { position: fixed; left: 50%; bottom: calc(96px + env(safe-area-inset-bottom)); transform: translateX(-50%); background: var(--panel-2); border: 1px solid var(--line); color: var(--ink); padding: 10px 16px; border-radius: 12px; font-size: 14px; max-width: calc(100% - 32px); z-index: 30; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
.toast[hidden] { display: none; }
.dlg-back { position: fixed; inset: 0; background: rgba(5,7,10,.65); display: grid; place-items: center; padding: 24px; z-index: 40; }
.dlg-back[hidden] { display: none; }
.dlg { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 20px; width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 12px; }
.dlg h3 { margin: 0; font-size: 17px; }
.dlg p { margin: 0; color: var(--ink-2); font-size: 14px; }
.dlg input { width: 100%; height: 46px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); padding: 0 12px; font: inherit; }
.dlg .acts { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.dlg .acts button { border: 0; background: transparent; color: var(--primary); font-weight: 600; padding: 8px 12px; border-radius: 8px; cursor: pointer; }
.dlg .acts button.danger { color: var(--danger); }
.dlg .acts button.solid { background: var(--primary); color: #0B1530; }
@media (prefers-reduced-motion: reduce) { .dot.live { animation: none; } .card { transition: none; } }
</style>
</head>
<body>
<div class="app" id="app"></div>
<div class="toast" id="toast" role="status" hidden></div>
<div class="dlg-back" id="dlgBack" hidden><div class="dlg" id="dlg" role="dialog" aria-modal="true"></div></div>

<script>
"use strict";
/* ================================================================
   신호처리 (안드로이드 앱의 RideProcessor 와 같은 알고리즘)
   ================================================================ */
const FS = 60;
const METRICS = [
  { key: "accel", title: "가감속도", unit: "m/s²", dec: 2, color: "var(--m0)", hex: "#FFB547", hint: "+ 위쪽 방향", minHalf: 0.3 },
  { key: "vert",  title: "상하 흔들림", unit: "gal", dec: 1, color: "var(--m1)", hex: "#4FD1E8", hint: "2 Hz 이상 진동", minHalf: 5 },
  { key: "lat",   title: "좌우 흔들림", unit: "gal", dec: 1, color: "var(--m2)", hex: "#C792EA", hint: "0.5 Hz 이상 진동", minHalf: 5 },
  { key: "speed", title: "속력", unit: "m/min", dec: 1, color: "var(--m3)", hex: "#5BE0A0", hint: "", minHalf: 20 },
];

class Biquad {
  constructor(b0, b1, b2, a1, a2) { Object.assign(this, { b0, b1, b2, a1, a2, x1: 0, x2: 0, y1: 0, y2: 0 }); }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  static make(fc, fs, high) {
    const w = 2 * Math.PI * fc / fs, c = Math.cos(w), al = Math.sin(w) / (2 / Math.SQRT2), a0 = 1 + al;
    return high
      ? new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0)
      : new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0);
  }
}

const P = {
  CAL_SEC: 1.5, CAL_TIMEOUT: 6, CAL_STD: 0.06,
  ACC_LP: 2.0, VERT_HP: 2.0, LAT_HP: 0.5,
  DEAD: 0.02, MOVE: 0.05, QUIET_SEC: 0.5, STOP_ABS: 0.15, STOP_RATIO: 0.25, BIAS_GAIN: 0.002,
};

class RideProcessor {
  constructor(fs = FS) {
    this.fs = fs; this.dt = 1 / fs;
    this.phase = "cal"; this.noisy = false; this.g = 0;
    this.calN = Math.round(P.CAL_SEC * fs);
    this.bx = new Float64Array(this.calN); this.by = new Float64Array(this.calN); this.bz = new Float64Array(this.calN);
    this.pos = 0; this.filled = 0; this.total = 0;
    this.gx = 0; this.gy = 0; this.gz = 1; this.lx = 1; this.ly = 0; this.lz = 0;
    this.lp = Biquad.make(P.ACC_LP, fs, false);
    this.hpv = Biquad.make(P.VERT_HP, fs, true);
    this.hpl = Biquad.make(P.LAT_HP, fs, true);
    this.v = 0; this.bias = 0; this.moving = false; this.peak = 0; this.quiet = 0;
    this.quietN = Math.round(P.QUIET_SEC * fs);
  }
  /** out = [가감속도 m/s², 상하 gal, 좌우 gal, 속력 m/min]. 측정 샘플이면 true */
  push(ax, ay, az, out) {
    if (this.phase === "cal") { this.calibrate(ax, ay, az); return false; }
    const vert = ax * this.gx + ay * this.gy + az * this.gz - this.g - this.bias;
    const lat = ax * this.lx + ay * this.ly + az * this.lz;
    const acc = this.lp.process(vert), vibV = this.hpv.process(vert), vibL = this.hpl.process(lat);
    const quiet = Math.abs(acc) < P.DEAD;
    this.quiet = quiet ? Math.min(this.quiet + 1, 1e9) : 0;
    if (!quiet) this.v += vert * this.dt;
    if (Math.abs(acc) > P.MOVE) this.moving = true;
    if (this.moving) this.peak = Math.max(this.peak, Math.abs(this.v));
    if (this.moving && this.quiet >= this.quietN && Math.abs(this.v) < Math.max(P.STOP_ABS, P.STOP_RATIO * this.peak)) {
      this.v = 0; this.moving = false; this.peak = 0;
    }
    if (!this.moving && this.quiet >= this.quietN) { this.bias += P.BIAS_GAIN * vert; this.v = 0; }
    out[0] = acc; out[1] = vibV * 100; out[2] = vibL * 100; out[3] = this.v * 60;
    return true;
  }
  calibrate(ax, ay, az) {
    const n = this.calN;
    this.bx[this.pos] = ax; this.by[this.pos] = ay; this.bz[this.pos] = az;
    this.pos = (this.pos + 1) % n; if (this.filled < n) this.filled++; this.total++;
    if (this.filled < n) return;
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += this.bx[i]; my += this.by[i]; mz += this.bz[i]; }
    mx /= n; my /= n; mz /= n;
    let vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < n; i++) { vx += (this.bx[i] - mx) ** 2; vy += (this.by[i] - my) ** 2; vz += (this.bz[i] - mz) ** 2; }
    const sd = Math.sqrt(Math.max(vx, vy, vz) / n);
    const timedOut = this.total >= P.CAL_TIMEOUT * this.fs;
    if (sd > P.CAL_STD && !timedOut) return;
    const mag = Math.hypot(mx, my, mz);
    if (mag < 1e-3) return;
    this.noisy = sd > P.CAL_STD; this.g = mag;
    this.gx = mx / mag; this.gy = my / mag; this.gz = mz / mag;
    // 좌우축 = 기기 X축의 수평 투영 (X축이 거의 연직이면 Y축)
    let px = 1 - this.gx * this.gx, py = -this.gx * this.gy, pz = -this.gx * this.gz, pn = Math.hypot(px, py, pz);
    if (pn < 0.5) { px = -this.gy * this.gx; py = 1 - this.gy * this.gy; pz = -this.gy * this.gz; pn = Math.hypot(px, py, pz); }
    this.lx = px / pn; this.ly = py / pn; this.lz = pz / pn;
    this.phase = "measure";
  }
}

/** 센서 이벤트(기기마다 다른 속도) → 정확히 60 Hz. 구간 평균, 느리면 직전 값 유지 */
class Resampler {
  constructor(rate, cb) { this.period = 1000 / rate; this.cb = cb; this.reset(); }
  reset() { this.next = 0; this.sx = this.sy = this.sz = 0; this.n = 0; this.has = false; this.l = [0, 0, 0]; }
  onEvent(t, x, y, z) {
    if (this.next === 0) this.next = t + this.period;
    let k = 0;
    while (t >= this.next && k < 30) { this.emit(); this.next += this.period; k++; }
    if (t >= this.next) this.next = t + this.period;
    this.sx += x; this.sy += y; this.sz += z; this.n++;
  }
  emit() {
    if (this.n > 0) { this.l = [this.sx / this.n, this.sy / this.n, this.sz / this.n]; this.has = true; this.sx = this.sy = this.sz = 0; this.n = 0; }
    if (this.has) this.cb(this.l[0], this.l[1], this.l[2]);
  }
}

class Series {
  constructor() { this.a = new Float32Array(FS * 120); this.n = 0; }
  add(v) { if (this.n === this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  tail(k) { return this.a.subarray(Math.max(0, this.n - k), this.n); }
  toArray() { return this.a.slice(0, this.n); }
}

function statsOf(arr) {
  if (!arr.length) return { max: 0, maxI: -1, min: 0, minI: -1 };
  let maxI = 0, minI = 0;
  for (let i = 1; i < arr.length; i++) { if (arr[i] > arr[maxI]) maxI = i; if (arr[i] < arr[minI]) minI = i; }
  return { max: arr[maxI], maxI, min: arr[minI], minI };
}

/* ================================================================
   데모 데이터: 저크 제한 운행 + 주행 진동 + 센서 잡음
   ================================================================ */
function makeDemoProfile(rate) {
  const out = [];
  const still = s => { for (let i = 0; i < s * rate; i++) out.push(0); };
  const trip = (vmax, amax, jerk, cruise, sign) => {
    const tj = amax / jerk, ta = (vmax - amax * tj) / amax, nj = Math.round(tj * rate), up = [];
    for (let i = 0; i < nj; i++) up.push(amax * i / nj);
    for (let i = 0; i < Math.round(ta * rate); i++) up.push(amax);
    for (let i = 0; i < nj; i++) up.push(amax * (nj - i) / nj);
    up.forEach(a => out.push(sign * a));
    for (let i = 0; i < cruise * rate; i++) out.push(0);
    up.forEach(a => out.push(-sign * a));
  };
  const v1 = 2.0 + Math.random() * 0.5, v2 = 1.5 + Math.random() * 0.3;
  still(3); trip(v1, 0.7, 0.9, 5, 1); still(3); trip(v2, 0.6, 0.8, 3, -1);
  return out;
}

class DemoSource {
  constructor(onEvent) {
    this.rate = 100; this.onEvent = onEvent; this.profile = makeDemoProfile(this.rate);
    const g = [0.05, 0.99, 0.12], m = Math.hypot(...g); this.gd = g.map(c => c / m);
    const lx = [1 - this.gd[0] * this.gd[0], -this.gd[0] * this.gd[1], -this.gd[0] * this.gd[2]], lm = Math.hypot(...lx);
    this.ld = lx.map(c => c / lm);
    this.i = 0; this.v = 0; this.bump = 0; this.bumpT = 0;
  }
  gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  start() {
    this.t0 = performance.now();
    this.timer = setInterval(() => this.tick(), 20);
  }
  stop() { clearInterval(this.timer); }
  tick() {
    const target = Math.floor((performance.now() - this.t0) / 1000 * this.rate);
    while (this.i < target) {
      const t = this.i / this.rate;
      const a = this.i < this.profile.length ? this.profile[this.i] : 0;
      this.v += a / this.rate;
      const moving = Math.abs(this.v) > 0.2;
      // 주행 중 레일 이음부 충격(감쇠 진동)
      if (moving && Math.random() < 0.004) { this.bump = 0.12 + Math.random() * 0.12; this.bumpT = 0; this.bumpLat = (Math.random() - 0.5) * 0.15; }
      let bv = 0, bl = 0;
      if (this.bump > 0) {
        const env = Math.exp(-this.bumpT * 9);
        bv = this.bump * env * Math.sin(2 * Math.PI * 11 * this.bumpT);
        bl = this.bumpLat * env * Math.sin(2 * Math.PI * 5 * this.bumpT);
        this.bumpT += 1 / this.rate; if (env < 0.01) this.bump = 0;
      }
      const run = moving ? 1 : 0.25;
      const vib = run * (0.025 * Math.sin(2 * Math.PI * 7.3 * t) + 0.01 * Math.sin(2 * Math.PI * 13.1 * t)) + bv;
      const latv = run * 0.018 * Math.sin(2 * Math.PI * 2.7 * t + 1) + bl;
      const up = 9.80665 + a + vib, n = 0.02;
      const x = up * this.gd[0] + latv * this.ld[0] + 0.01 + this.gauss() * n;
      const y = up * this.gd[1] + latv * this.ld[1] - 0.008 + this.gauss() * n;
      const z = up * this.gd[2] + latv * this.ld[2] + 0.005 + this.gauss() * n;
      this.onEvent(this.t0 + this.i * 1000 / this.rate, x, y, z);
      this.i++;
    }
  }
  get done() { return this.i >= this.profile.length + 2 * this.rate; }
}

/* ================================================================
   측정 엔진
   ================================================================ */
const engine = {
  status: "idle", demo: false, live: null, dirty: false, tick: 0,
  async start(demo) {
    this.demo = demo;
    this.proc = new RideProcessor(FS);
    this.out = new Float64Array(4);
    this.bufs = METRICS.map(() => new Series());
    this.res = new Resampler(FS, (x, y, z) => this.onSample(x, y, z));
    this.since = 0; this.pv = 0; this.pl = 0; this.raw = 0; this.firstEvt = 0; this.got = false;
    this.startedAt = Date.now();
    this.live = { status: "cal" }; this.status = "cal"; this.dirty = true;
    if (demo) {
      this.src = new DemoSource((t, x, y, z) => this.onRaw(t, x, y, z));
      this.src.start();
    } else {
      if (typeof DeviceMotionEvent === "undefined") throw new Error("nosupport");
      if (!window.isSecureContext) throw new Error("insecure");
      if (typeof DeviceMotionEvent.requestPermission === "function") {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== "granted") throw new Error("denied");
      }
      this.handler = e => {
        const a = e.accelerationIncludingGravity;
        if (!a || a.x == null || a.y == null || a.z == null) return;
        this.got = true;
        this.onRaw(e.timeStamp || performance.now(), a.x, a.y, a.z);
      };
      window.addEventListener("devicemotion", this.handler);
      this.watchdog = setTimeout(() => { if (!this.got && this.status !== "idle") { this.abort(); offerDemo("nosignal"); } }, 2000);
    }
    this.lockScreen();
  },
  onRaw(t, x, y, z) {
    if (!this.firstEvt) this.firstEvt = performance.now();
    this.raw++;
    this.res.onEvent(t, x, y, z);
  },
  onSample(x, y, z) {
    if (!this.proc.push(x, y, z, this.out)) {
      if (++this.since >= 4) { this.since = 0; this.live = { status: "cal", rate: this.rate() }; this.dirty = true; }
      return;
    }
    if (this.status === "cal") { this.startedAt = Date.now(); this.since = 0; this.status = "measure"; this.dirty = true; }
    const o = this.out;
    for (let i = 0; i < 4; i++) this.bufs[i].add(o[i]);
    if (Math.abs(o[1]) >= Math.abs(this.pv)) this.pv = o[1];
    if (Math.abs(o[2]) >= Math.abs(this.pl)) this.pl = o[2];
    if (++this.since >= 4) {
      this.since = 0;
      const n = this.bufs[0].n;
      this.live = { status: "measure", v: [o[0], this.pv, this.pl, o[3]], moving: this.proc.moving, n, sec: n / FS, rate: this.rate(), noisy: this.proc.noisy };
      this.pv = 0; this.pl = 0; this.tick++; this.dirty = true;
    }
  },
  rate() { const s = (performance.now() - this.firstEvt) / 1000; return s > 0.5 ? this.raw / s : 0; },
  detach() {
    if (this.src) { this.src.stop(); this.src = null; }
    if (this.handler) { window.removeEventListener("devicemotion", this.handler); this.handler = null; }
    clearTimeout(this.watchdog);
    this.unlockScreen();
  },
  abort() { this.detach(); this.status = "idle"; this.live = null; this.dirty = true; },
  stop() {
    this.detach();
    this.status = "idle"; this.dirty = true;
    const series = this.bufs.map(b => b.toArray());
    return { startedAt: this.startedAt, series, demo: this.demo };
  },
  async lockScreen() { try { if ("wakeLock" in navigator) this.wake = await navigator.wakeLock.request("screen"); } catch (e) { this.wake = null; } },
  unlockScreen() { try { this.wake && this.wake.release(); } catch (e) { /* 무시 */ } this.wake = null; },
};

/* ================================================================
   기록 저장소 (IndexedDB, 실패 시 메모리)
   ================================================================ */
const store = {
  db: null, mem: new Map(), persistent: false,
  async open() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open("elevator-ride-meter", 1);
        r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("meta", { keyPath: "id" }); d.createObjectStore("data", { keyPath: "id" }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      this.persistent = true;
    } catch (e) { this.db = null; this.persistent = false; }
  },
  req(storeName, mode, fn) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(storeName, mode); const r = fn(tx.objectStore(storeName));
      tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error);
    });
  },
  metaOf(rec) {
    const st = rec.series.map(statsOf);
    return { id: rec.id, startedAt: rec.startedAt, name: rec.name, demo: rec.demo, n: rec.series[0].length, rate: rec.rate,
      max: st.map(s => s.max), min: st.map(s => s.min) };
  },
  async save(rec) {
    const meta = this.metaOf(rec);
    if (!this.db) { this.mem.set(rec.id, { meta, rec }); return; }
    await this.req("data", "readwrite", s => s.put({ id: rec.id, series: rec.series }));
    await this.req("meta", "readwrite", s => s.put(meta));
  },
  async list() {
    const all = this.db ? await this.req("meta", "readonly", s => s.getAll()) : [...this.mem.values()].map(v => v.meta);
    return (all || []).sort((a, b) => b.startedAt - a.startedAt);
  },
  async load(id) {
    if (!this.db) { const m = this.mem.get(id); return m && m.rec; }
    const meta = await this.req("meta", "readonly", s => s.get(id));
    const data = await this.req("data", "readonly", s => s.get(id));
    if (!meta || !data) return null;
    return { id, startedAt: meta.startedAt, name: meta.name, demo: meta.demo, rate: meta.rate, series: data.series.map(a => a instanceof Float32Array ? a : Float32Array.from(a)) };
  },
  async remove(id) {
    if (!this.db) { this.mem.delete(id); return; }
    await this.req("meta", "readwrite", s => s.delete(id));
    await this.req("data", "readwrite", s => s.delete(id));
  },
  async rename(id, name) {
    if (!this.db) { const m = this.mem.get(id); if (m) { m.rec.name = name; m.meta.name = name; } return; }
    const meta = await this.req("meta", "readonly", s => s.get(id));
    if (meta) { meta.name = name; await this.req("meta", "readwrite", s => s.put(meta)); }
  },
};

/* ================================================================
   그래프 (캔버스): 최고/최저 표시, 두 손가락 확대, 끌어서 이동, 두 번 탭 전체 보기
   ================================================================ */
const PAD = { l: 46, r: 10, t: 26, b: 20 };
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function niceStep(range, target) {
  if (!(range > 0)) return 1;
  const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}
function ticks(lo, hi, target) {
  const st = niceStep(hi - lo, target), out = [];
  for (let v = Math.ceil(lo / st - 1e-9) * st, g = 0; v <= hi + st * 1e-9 && g < 50; v += st, g++) out.push(Math.abs(v) < st * 1e-9 ? 0 : v);
  return { list: out, dec: st >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(st) - 1e-9)) };
}
function signed(v, d) { const s = Math.abs(v).toFixed(d); return parseFloat(s) === 0 ? s : (v > 0 ? "+" : "−") + s; }

class Chart {
  constructor(canvas, opts) {
    this.c = canvas; this.o = opts; this.ctx = canvas.getContext("2d");
    this.reset();
    if (opts.interactive) this.bindGestures();
    this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(canvas);
  }
  get full() { return Math.max(this.o.values.length - 1, (this.o.window || 0) - 1, 1); }
  reset() { this.vs = 0; this.ve = this.full; }
  setValues(values, timeOffset) { this.o.values = values; this.o.timeOffset = timeOffset; if (!this.o.interactive) this.reset(); this.draw(); }
  transform(zoom, panPx, frac, plotW) {
    const full = this.full, minSpan = Math.min(full, 30), span = this.ve - this.vs, anchor = this.vs + frac * span;
    const ns = Math.min(full, Math.max(minSpan, span / zoom));
    let s = anchor - frac * ns - panPx / plotW * ns;
    s = Math.max(0, Math.min(full - ns, s));
    this.vs = s; this.ve = s + ns; this.draw();
  }
  get zoomed() { return this.ve - this.vs < this.full - 0.5; }
  bindGestures() {
    const c = this.c, pts = new Map();
    let lastDist = 0, lastCx = 0, lastX = 0, moved = false, lastTap = 0;
    const plotW = () => Math.max(1, c.clientWidth - PAD.l - PAD.r);
    const local = e => e.clientX - c.getBoundingClientRect().left;
    const pair = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2 }; };
    c.addEventListener("pointerdown", e => {
      pts.set(e.pointerId, { x: local(e), y: e.clientY }); moved = false;
      if (pts.size === 2) { const p = pair(); lastDist = p.d; lastCx = p.cx; }
      lastX = local(e);
    });
    c.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId)) return;
      const x = local(e); pts.set(e.pointerId, { x, y: e.clientY });
      if (pts.size >= 2) {
        const p = pair();
        if (lastDist > 0) this.transform(p.d / lastDist, p.cx - lastCx, Math.min(1, Math.max(0, (p.cx - PAD.l) / plotW())), plotW());
        lastDist = p.d; lastCx = p.cx; moved = true; e.preventDefault();
      } else if (this.zoomed && Math.abs(x - lastX) > 0) {
        this.transform(1, x - lastX, 0.5, plotW()); lastX = x; moved = true;
      }
    });
    const end = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 1) { lastX = [...pts.values()][0].x; lastDist = 0; }
      if (e.type === "pointerup" && pts.size === 0 && !moved) {
        const now = performance.now();
        if (now - lastTap < 320) { this.reset(); this.draw(); lastTap = 0; } else lastTap = now;
      }
    };
    c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end); c.addEventListener("pointerleave", end);
    c.addEventListener("wheel", e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.transform(Math.exp(-e.deltaY * 0.01), 0, Math.min(1, Math.max(0, (local(e) - PAD.l) / plotW())), plotW());
    }, { passive: false });
    c.addEventListener("dblclick", () => { this.reset(); this.draw(); });
  }
  draw() {
    const c = this.c, dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = this.ctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const { values: v, rate, color, dec, minHalf, stats } = this.o, off = this.o.timeOffset || 0, n = v.length;
    const L = PAD.l, R = W - PAD.r, T = PAD.t, B = H - PAD.b, pw = R - L, ph = B - T, vs = this.vs, ve = this.ve;
    if (pw <= 0 || ph <= 0 || ve <= vs) return;
    const i0 = Math.max(0, Math.floor(vs)), i1 = Math.min(n - 1, Math.ceil(ve));
    let lo = 0, hi = 0;
    for (let i = i0; i <= i1; i++) { if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i]; }
    const pad = Math.max((hi - lo) * 0.12, 1e-6); lo -= pad; hi += pad;
    hi = Math.max(hi, minHalf); lo = Math.min(lo, -minHalf);
    const y = val => B - (val - lo) / (hi - lo) * ph, x = i => L + (i - vs) / (ve - vs) * pw;
    const line = css("--line"), ink3 = css("--ink-3");
    g.font = `10px ${css("--font-num")}`; g.textBaseline = "middle";
    // Y 눈금
    const yt = ticks(lo, hi, 4);
    for (const t of yt.list) {
      const py = Math.round(y(t)) + 0.5;
      g.strokeStyle = line; g.globalAlpha = t === 0 ? 0.95 : 0.55; g.lineWidth = t === 0 ? 1.2 : 1;
      g.setLineDash(t === 0 ? [] : [4, 4]); g.beginPath(); g.moveTo(L, py); g.lineTo(R, py); g.stroke();
      g.globalAlpha = 1; g.fillStyle = ink3; g.textAlign = "right"; g.fillText(t.toFixed(yt.dec), L - 6, py);
    }
    // X 눈금 (초)
    const t0 = off + vs / rate, t1 = off + ve / rate, xt = ticks(t0, t1, 4);
    g.textAlign = "center"; g.textBaseline = "top";
    for (const t of xt.list) {
      const px = Math.round(L + (t - t0) / (t1 - t0) * pw) + 0.5;
      g.strokeStyle = line; g.globalAlpha = 0.35; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(px, T); g.lineTo(px, B); g.stroke();
      g.globalAlpha = 1; g.fillStyle = ink3;
      const lab = t.toFixed(xt.dec) + "s", w = g.measureText(lab).width;
      g.fillText(lab, Math.min(W - w / 2 - 1, Math.max(L - 6, px)), B + 5);
    }
    g.setLineDash([]);
    // 데이터 (픽셀보다 점이 많으면 열마다 최소/최대)
    if (n >= 2 && i1 > i0) {
      g.save(); g.beginPath(); g.rect(L, T - 1, pw, ph + 2); g.clip();
      g.beginPath(); g.strokeStyle = color; g.lineWidth = 1.6; g.lineJoin = "round";
      if (i1 - i0 + 1 <= pw * 1.5) {
        g.moveTo(x(i0), y(v[i0])); for (let i = i0 + 1; i <= i1; i++) g.lineTo(x(i), y(v[i]));
      } else {
        const cols = Math.max(1, Math.floor(pw)), span = ve - vs;
        for (let col = 0; col < cols; col++) {
          const a = Math.min(i1, Math.max(i0, Math.floor(vs + span * col / cols)));
          const b = Math.min(i1, Math.max(a, Math.floor(vs + span * (col + 1) / cols)));
          let mn = v[a], mx = v[a];
          for (let k = a; k <= b; k++) { if (v[k] < mn) mn = v[k]; if (v[k] > mx) mx = v[k]; }
          const px = L + col + 0.5;
          if (col === 0) g.moveTo(px, y(mx)); else g.lineTo(px, y(mx));
          g.lineTo(px, y(mn));
        }
      }
      g.stroke();
      // 옅은 면 채우기 (0선 기준)
      if (this.o.interactive) {
        g.lineTo(x(i1), y(0)); g.lineTo(x(i0), y(0)); g.closePath();
        g.globalAlpha = 0.08; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
      }
      g.restore();
    }
    // 최고 / 최저
    if (stats && n > 0) {
      const mark = (idx, val, col, label, above) => {
        if (idx < i0 || idx > i1) return;
        const px = x(idx), py = y(val);
        g.strokeStyle = col; g.globalAlpha = 0.35; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(px, T); g.lineTo(px, B); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
        g.fillStyle = col; g.beginPath(); g.arc(px, py, 4.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = css("--bg"); g.beginPath(); g.arc(px, py, 2, 0, Math.PI * 2); g.fill();
        g.font = `600 11px ${css("--font-body")}`; g.textAlign = "left"; g.textBaseline = "middle";
        const tw = g.measureText(label).width, bw = tw + 10, bh = 18, gap = 7;
        let bx = Math.min(Math.max(px - bw / 2, L), R - bw); if (R - bw < L) bx = L;
        let by = above ? py - gap - bh : py + gap;
        if (by < 0) by = py + gap; if (by + bh > B) by = py - gap - bh; by = Math.max(0, by);
        g.fillStyle = css("--panel-2"); g.globalAlpha = 0.94; roundRect(g, bx, by, bw, bh, 4); g.fill(); g.globalAlpha = 1;
        g.strokeStyle = col; g.globalAlpha = 0.6; g.lineWidth = 1; roundRect(g, bx + 0.5, by + 0.5, bw - 1, bh - 1, 4); g.stroke(); g.globalAlpha = 1;
        g.fillStyle = col; g.fillText(label, bx + 5, by + bh / 2 + 0.5);
      };
      const tt = i => (off + i / rate).toFixed(2) + "s";
      mark(stats.maxI, stats.max, css("--max"), `최고 ${signed(stats.max, dec)} · ${tt(stats.maxI)}`, true);
      mark(stats.minI, stats.min, css("--min"), `최저 ${signed(stats.min, dec)} · ${tt(stats.minI)}`, false);
    }
  }
  destroy() { this.ro.disconnect(); }
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

/* ================================================================
   화면
   ================================================================ */
const app = document.getElementById("app");
const ui = { view: "measure", sel: 0, record: null, fromHistory: false, charts: [], liveChart: null };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = ms => { const d = new Date(ms), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} (${"일월화수목금토"[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const fmtDur = s => s >= 60 ? `${Math.floor(s / 60)}분 ${String(Math.floor(s % 60)).padStart(2, "0")}초` : `${s.toFixed(1)}초`;
const fmtVal = (m, v) => m.key === "speed" ? Math.abs(v).toFixed(m.dec) : signed(v, m.dec);
const dir = v => v > 1.5 ? "▲ 상승" : v < -1.5 ? "▼ 하강" : "정지";
const ICON = {
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  list: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  edit: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  csv: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  del: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
};

function clearCharts() { ui.charts.forEach(c => c.destroy()); ui.charts = []; if (ui.liveChart) { ui.liveChart.destroy(); ui.liveChart = null; } }

function toast(msg) {
  const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3200);
}

function dialog(html, bind) {
  const back = document.getElementById("dlgBack"), box = document.getElementById("dlg");
  box.innerHTML = html; back.hidden = false;
  const close = () => { back.hidden = true; box.innerHTML = ""; };
  back.onclick = e => { if (e.target === back) close(); };
  bind(box, close);
  const f = box.querySelector("input, .acts button.solid, .acts button"); if (f) f.focus();
}

/* ---------- 측정 화면 ---------- */
function renderMeasure() {
  clearCharts();
  app.innerHTML = `
  <header>
    <div class="t"><h1>엘리베이터 승차감 측정</h1><div class="sub">가속도 센서 · 초당 60회</div></div>
    <button class="btn-ghost" id="goHist">${ICON.list}지난 기록</button>
  </header>
  <main>
    <div class="panel status"><span class="dot" id="dot"></span><span class="txt" id="stTxt">대기 중</span><span class="rate" id="stRate"></span></div>
    <p class="warn" id="noisy" hidden>보정하는 동안 흔들림이 있었습니다. 휴대폰을 고정한 뒤 다시 측정하면 더 정확합니다.</p>
    <div class="grid" id="cards">
      ${METRICS.map((m, i) => `
      <button class="card dim" data-i="${i}" style="--c:${m.color}" aria-label="${m.title}">
        <div class="h"><span class="sw"></span>${m.title}</div>
        <div class="v"><span class="num" id="v${i}">${m.key === "speed" ? "0.0" : signed(0, m.dec)}</span><span class="u">${m.unit}</span></div>
        <div class="hint" id="h${i}">${m.key === "speed" ? "정지" : m.hint}</div>
      </button>`).join("")}
    </div>
    <div id="lower"></div>
  </main>
  <div class="footer" id="footer"></div>`;
  document.getElementById("goHist").onclick = () => { if (engine.status === "idle") openHistory(); };
  document.querySelectorAll(".card").forEach(c => c.onclick = () => { ui.sel = +c.dataset.i; ui.lowerKey = null; engine.dirty = true; });
  ui.lowerKey = null; ui.footKey = null;
  engine.dirty = true;
}

function lowerGuide() {
  return `<div class="panel guide">
    <h2>측정 방법</h2>
    <ol>
      <li>휴대폰을 바닥에 화면이 위로 오게 놓거나(휴대폰 위쪽이 문을 향하게), 문 맞은편 벽에 세로로 고정하세요.</li>
      <li>엘리베이터가 서 있을 때 [측정 시작]을 누르고 손을 떼세요. 1.5초 동안 자동 보정한 뒤 측정이 시작됩니다.</li>
      <li>운행이 끝나면 [측정 정지]를 누르세요. 그래프와 최고·최저값이 나오고 기록이 저장됩니다.</li>
    </ol>
    <p class="note">좌우 흔들림은 휴대폰의 가로 방향 기준입니다. 측정 중 휴대폰을 만지면 값이 튑니다. ${store.persistent ? "기록은 이 브라우저에 저장됩니다." : "이 브라우저에서는 기록을 저장할 수 없어, 페이지를 닫으면 기록이 사라집니다."}</p>
  </div>`;
}

function updateMeasure() {
  const L = engine.live, st = engine.status;
  const dot = document.getElementById("dot"); if (!dot) return;
  const active = st !== "idle";
  dot.className = "dot" + (active ? " live" : "");
  dot.style.background = st === "measure" ? "var(--m3)" : st === "cal" ? "var(--max)" : "var(--ink-3)";
  const stTxt = document.getElementById("stTxt"), stRate = document.getElementById("stRate");
  if (st === "measure" && L && L.status === "measure") {
    const mm = Math.floor(L.sec / 60), ss = (L.sec % 60).toFixed(1).padStart(4, "0");
    stTxt.textContent = `${engine.demo ? "데모 " : ""}측정 중 · ${String(mm).padStart(2, "0")}:${ss} · ${L.moving ? "운행 중" : "정지 상태"}`;
  } else if (st === "cal") stTxt.textContent = "보정 중 · 휴대폰을 움직이지 마세요";
  else stTxt.textContent = "대기 중";
  stRate.textContent = active && L && L.rate ? `${engine.demo ? "가상 " : ""}센서 ${L.rate.toFixed(0)} Hz` : "";
  document.getElementById("noisy").hidden = !(st === "measure" && L && L.noisy);
  document.getElementById("goHist").disabled = active;

  METRICS.forEach((m, i) => {
    const card = document.querySelector(`.card[data-i="${i}"]`);
    card.classList.toggle("dim", st !== "measure");
    card.classList.toggle("sel", active && i === ui.sel);
    const val = st === "measure" && L && L.v ? L.v[i] : 0;
    document.getElementById("v" + i).textContent = fmtVal(m, val);
    if (m.key === "speed") { const h = document.getElementById("h" + i); h.textContent = dir(val); h.classList.toggle("on", Math.abs(val) > 1.5); }
  });

  // 아래 영역: 대기=안내, 보정=보정 안내, 측정=실시간 그래프
  const key = st + ":" + ui.sel;
  const lower = document.getElementById("lower");
  if (ui.lowerKey !== key) {
    ui.lowerKey = key;
    if (ui.liveChart) { ui.liveChart.destroy(); ui.liveChart = null; }
    if (st === "measure") {
      const m = METRICS[ui.sel];
      lower.innerHTML = `<div class="panel chart-panel"><div class="chart-cap">${m.title} 실시간 (최근 10초) · 위 카드를 눌러 항목 변경</div><canvas class="chart" id="liveC" style="height:190px"></canvas></div>`;
      ui.liveChart = new Chart(document.getElementById("liveC"), { values: new Float32Array(0), rate: FS, color: m.hex, dec: m.dec, minHalf: m.minHalf, window: FS * 10 });
    } else if (st === "cal") {
      lower.innerHTML = `<div class="panel calib"><h2 style="color:var(--ink)">중력 방향을 맞추고 있습니다</h2>휴대폰에서 손을 떼고 1.5초 동안 움직이지 않으면 측정이 자동으로 시작됩니다.</div>`;
    } else lower.innerHTML = lowerGuide();
  }
  if (ui.liveChart && L && L.status === "measure") {
    const data = engine.bufs[ui.sel].tail(FS * 10);
    ui.liveChart.setValues(data, Math.max(0, L.n - data.length) / FS);
  }

  const fk = active ? "on" : "off";
  if (ui.footKey !== fk) {
    ui.footKey = fk;
    const f = document.getElementById("footer");
    f.innerHTML = active
      ? `<button class="btn-main stop" id="stopB"><span class="ic"></span>측정 정지</button>`
      : `<button class="btn-main" id="startB"><span class="ic"></span>측정 시작</button><button class="btn-link" id="demoB">센서 없이 데모 측정으로 체험하기</button>`;
    if (active) document.getElementById("stopB").onclick = stopMeasure;
    else { document.getElementById("startB").onclick = () => startMeasure(false); document.getElementById("demoB").onclick = () => startMeasure(true); }
  }
}

async function startMeasure(demo) {
  try { await engine.start(demo); }
  catch (e) { engine.abort(); offerDemo(e.message); }
}

function offerDemo(reason) {
  const why = {
    insecure: "동작 센서는 HTTPS 주소에서만 쓸 수 있습니다.",
    nosupport: "이 브라우저는 동작 센서를 지원하지 않습니다.",
    denied: "동작 센서 접근이 허용되지 않았습니다. 브라우저 설정에서 '동작 및 방향' 접근을 허용해 주세요.",
    nosignal: "센서 신호가 들어오지 않습니다. 이 화면(미리보기 창, PC 브라우저 등)에서는 휴대폰 동작 센서에 접근할 수 없습니다.",
  }[reason] || "동작 센서에 접근할 수 없습니다.";
  dialog(`<h3>센서를 사용할 수 없습니다</h3><p>${esc(why)}</p><p>휴대폰 브라우저에서 이 페이지를 HTTPS 주소로 열면 실제 측정이 됩니다. 지금은 가상 운행 데이터로 데모 측정을 해 볼 수 있습니다.</p>
    <div class="acts"><button id="dC">닫기</button><button class="solid" id="dD">데모 측정</button></div>`, (b, close) => {
    b.querySelector("#dC").onclick = close;
    b.querySelector("#dD").onclick = () => { close(); startMeasure(true); };
  });
}

async function stopMeasure() {
  const cap = engine.stop();
  if (cap.series[0].length < 30) { toast("측정된 데이터가 너무 짧아 저장하지 않았습니다 (보정 중에 정지됨)."); engine.dirty = true; return; }
  const rec = { id: "ride_" + cap.startedAt, startedAt: cap.startedAt, name: cap.demo ? "데모 측정" : "", demo: cap.demo, rate: FS, series: cap.series };
  try { await store.save(rec); } catch (e) { toast("기록 저장에 실패했습니다."); }
  ui.record = rec; ui.fromHistory = false; ui.view = "result"; renderResult();
}

/* ---------- 결과 화면 ---------- */
function renderResult() {
  clearCharts(); window.scrollTo(0, 0);
  const r = ui.record, st = r.series.map(statsOf), n = r.series[0].length, dur = n / r.rate;
  app.innerHTML = `
  <header>
    <button class="icon-btn" id="back" aria-label="뒤로">${ICON.back}</button>
    <div class="t"><h1>${esc(r.name || "측정 결과")}${r.demo ? '<span class="tag">데모</span>' : ""}</h1><div class="sub">${fmtDate(r.startedAt)}</div></div>
    <button class="icon-btn" id="ren" aria-label="이름 변경">${ICON.edit}</button>
    <button class="icon-btn" id="csv" aria-label="CSV 내보내기">${ICON.csv}</button>
    <button class="icon-btn" id="del" aria-label="삭제">${ICON.del}</button>
  </header>
  <main>
    <div class="panel summary">
      <div class="info">
        <div><div class="l">측정 시간</div><div class="val">${fmtDur(dur)}</div></div>
        <div><div class="l">샘플 수</div><div class="val">${n.toLocaleString("ko-KR")}</div></div>
        <div><div class="l">샘플링</div><div class="val">${r.rate} Hz</div></div>
      </div>
      <table class="stats">
        <thead><tr><th>항목</th><th style="color:var(--max)">최고</th><th style="color:var(--min)">최저</th></tr></thead>
        <tbody>${METRICS.map((m, i) => `<tr><td><span class="sw" style="--c:${m.color};display:inline-block;margin-right:6px"></span>${m.title} <span class="u">${m.unit}</span></td><td>${signed(st[i].max, m.dec)}</td><td>${signed(st[i].min, m.dec)}</td></tr>`).join("")}</tbody>
      </table>
      <p class="legend">속력: + 상승 / − 하강 · 가감속도: + 위쪽 방향 · 1 gal = 1 cm/s²</p>
    </div>
    <p class="note">그래프: 두 손가락으로 확대 · 확대한 뒤 좌우로 밀어 이동 · 두 번 탭하면 전체 보기</p>
    ${METRICS.map((m, i) => `
    <div class="panel chart-panel" style="--c:${m.color}">
      <div class="chart-head"><span class="sw"></span><span class="name">${m.title}</span><span class="unit">(${m.unit})</span></div>
      <div class="chips">
        <span class="chip" style="--c:var(--max)">최고 <b>${signed(st[i].max, m.dec)}</b></span>
        <span class="chip" style="--c:var(--min)">최저 <b>${signed(st[i].min, m.dec)}</b></span>
        <span class="chip" style="--c:var(--ink-2)">폭 <b>${(st[i].max - st[i].min).toFixed(m.dec)}</b></span>
      </div>
      <canvas class="chart" id="rc${i}"></canvas>
    </div>`).join("")}
    ${ui.fromHistory ? "" : `<div class="row2"><button class="btn-sec" id="toHist">지난 기록 보기</button><button class="btn-pri" id="again">새로 측정</button></div>`}
  </main>`;
  METRICS.forEach((m, i) => ui.charts.push(new Chart(document.getElementById("rc" + i),
    { values: r.series[i], rate: r.rate, color: m.hex, dec: m.dec, minHalf: m.minHalf * 0.3, stats: st[i], interactive: true })));
  document.getElementById("back").onclick = () => ui.fromHistory ? openHistory() : goMeasure();
  document.getElementById("ren").onclick = () => renameDialog(r);
  document.getElementById("csv").onclick = () => csvDialog(r);
  document.getElementById("del").onclick = () => deleteDialog(r, () => openHistory());
  if (!ui.fromHistory) {
    document.getElementById("toHist").onclick = openHistory;
    document.getElementById("again").onclick = goMeasure;
  }
}

function renameDialog(r) {
  dialog(`<h3>기록 이름</h3><label for="nmI" class="note">엘리베이터 위치나 호기를 적어 두면 찾기 쉽습니다.</label><input id="nmI" maxlength="40" placeholder="예: 본관 3호기 상행" value="${esc(r.name || "")}">
    <div class="acts"><button id="dC">취소</button><button class="solid" id="dS">저장</button></div>`, (b, close) => {
    const save = async () => { r.name = b.querySelector("#nmI").value.trim(); await store.rename(r.id, r.name); close(); renderResult(); };
    b.querySelector("#dC").onclick = close; b.querySelector("#dS").onclick = save;
    b.querySelector("#nmI").onkeydown = e => { if (e.key === "Enter") save(); };
  });
}

function deleteDialog(r, after) {
  dialog(`<h3>기록 삭제</h3><p>${esc(r.name || fmtDate(r.startedAt))} 기록을 삭제할까요? 되돌릴 수 없습니다.</p>
    <div class="acts"><button id="dC">취소</button><button class="danger" id="dX">삭제</button></div>`, (b, close) => {
    b.querySelector("#dC").onclick = close;
    b.querySelector("#dX").onclick = async () => { await store.remove(r.id); close(); toast("기록을 삭제했습니다."); after(); };
  });
}

function buildCsv(r) {
  const lines = [`# name,${(r.name || "").replace(/,/g, " ")}`, `# started_at,${fmtDate(r.startedAt)}`, `# sample_rate_hz,${r.rate}`,
    "time_s,accel_m_s2,vertical_vib_gal,lateral_vib_gal,speed_m_min"];
  const n = r.series[0].length;
  for (let i = 0; i < n; i++) lines.push([(i / r.rate).toFixed(4), ...r.series.map(s => s[i].toFixed(4))].join(","));
  return lines.join("\n") + "\n";
}

function csvDialog(r) {
  const csv = buildCsv(r);
  dialog(`<h3>CSV 내보내기</h3><p>${r.series[0].length.toLocaleString("ko-KR")}행 · 시간(초)과 4개 항목. 엑셀이나 구글 시트에 붙여 넣을 수 있습니다.</p>
    <div class="acts"><button id="dC">닫기</button><button id="dCopy">복사</button><button class="solid" id="dDl">파일 저장</button></div>`, (b, close) => {
    b.querySelector("#dC").onclick = close;
    b.querySelector("#dCopy").onclick = async () => {
      try { await navigator.clipboard.writeText(csv); toast("CSV를 복사했습니다."); close(); }
      catch (e) { toast("복사할 수 없는 환경입니다."); }
    };
    const dlBtn = b.querySelector("#dDl");
    const inHost = !!(window.claude && window.claude.use);
    if (inHost && !downloads) dlBtn.hidden = true;
    dlBtn.onclick = async () => {
      const d = new Date(r.startedAt), p = x => String(x).padStart(2, "0");
      const filename = `elevator_ride_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.csv`;
      if (downloads) {
        try { await downloads.save({ filename, data: "\uFEFF" + csv }); toast("CSV 파일을 저장했습니다."); close(); }
        catch (e) { if (e && e.code !== "declined") toast("파일을 저장하지 못했습니다. [복사]를 이용하세요."); }
        return;
      }
      try {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" }));
        a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast("파일 저장을 시작했습니다.");
      } catch (e) { toast("이 환경에서는 파일 저장이 막혀 있습니다. [복사]를 이용하세요."); }
    };
  });
}

/* ---------- 기록 화면 ---------- */
async function openHistory() {
  ui.view = "history"; clearCharts(); window.scrollTo(0, 0);
  app.innerHTML = `<header><button class="icon-btn" id="back" aria-label="뒤로">${ICON.back}</button>
    <div class="t"><h1>지난 측정 기록</h1><div class="sub" id="cnt">불러오는 중…</div></div></header><main id="hl"></main>`;
  document.getElementById("back").onclick = goMeasure;
  let items = [];
  try { items = await store.list(); } catch (e) { toast("기록을 불러오지 못했습니다."); }
  if (ui.view !== "history") return;
  document.getElementById("cnt").textContent = `${items.length}건${store.persistent ? "" : " · 이 페이지를 닫으면 사라집니다"}`;
  const hl = document.getElementById("hl");
  if (!items.length) { hl.innerHTML = `<div class="empty">저장된 측정 기록이 없습니다.<br>측정을 마치면 자동으로 저장됩니다.</div>`; return; }
  const pk = (it, i) => Math.max(Math.abs(it.max[i]), Math.abs(it.min[i]));
  hl.innerHTML = `<div class="list">${items.map(it => `
    <div class="panel item" tabindex="0" data-id="${esc(it.id)}">
      <div class="top"><div class="t"><div class="nm">${esc(it.name || "측정 기록")}${it.demo ? '<span class="tag">데모</span>' : ""}</div>
        <div class="dt">${fmtDate(it.startedAt)} · ${fmtDur(it.n / it.rate)}</div></div>
        <button class="icon-btn" data-del="${esc(it.id)}" aria-label="삭제">${ICON.del}</button></div>
      <div class="mini">
        <div style="--c:var(--m3)"><div class="l">최고 속력</div><div class="val">▲${Math.max(0, it.max[3]).toFixed(0)} ▼${Math.max(0, -it.min[3]).toFixed(0)}</div><div class="u">m/min</div></div>
        <div style="--c:var(--m0)"><div class="l">가감속 최대</div><div class="val">${pk(it, 0).toFixed(2)}</div><div class="u">m/s²</div></div>
        <div style="--c:var(--m1)"><div class="l">상하 최대</div><div class="val">${pk(it, 1).toFixed(1)}</div><div class="u">gal</div></div>
        <div style="--c:var(--m2)"><div class="l">좌우 최대</div><div class="val">${pk(it, 2).toFixed(1)}</div><div class="u">gal</div></div>
      </div>
    </div>`).join("")}</div>`;
  hl.querySelectorAll(".item").forEach(el => {
    const open = async () => {
      const rec = await store.load(el.dataset.id);
      if (!rec) { toast("기록을 열 수 없습니다."); return; }
      ui.record = rec; ui.fromHistory = true; ui.view = "result"; renderResult();
    };
    el.onclick = e => { if (!e.target.closest("[data-del]")) open(); };
    el.onkeydown = e => { if (e.key === "Enter") open(); };
  });
  hl.querySelectorAll("[data-del]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    const it = items.find(x => x.id === b.dataset.del);
    deleteDialog({ id: it.id, name: it.name, startedAt: it.startedAt }, openHistory);
  });
}

function goMeasure() { ui.view = "measure"; renderMeasure(); }

/* ---------- 화면 갱신 루프 (약 15 Hz) ---------- */
function loop() {
  if (engine.demo && engine.src && engine.src.done && engine.status === "measure") stopMeasure();
  if (ui.view === "measure" && engine.dirty) { engine.dirty = false; updateMeasure(); }
  requestAnimationFrame(loop);
}

let downloads = null;
if (window.claude && window.claude.use) {
  window.claude.use("downloads").then(d => { downloads = d; }).catch(() => { downloads = null; });
}

(async () => {
  await store.open();
  renderMeasure();
  requestAnimationFrame(loop);
})();
</script>
</body>
</html>
