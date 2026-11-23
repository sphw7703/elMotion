/* elMotion · 화면과 동작 */
"use strict";

/* ───────── 상수 ───────── */
const FS = Core.FS;
const LEGEND = { acc: 1.5, lat: 30, spd: 600 };        // 물 높이 범례 (화면에 표시하지 않음)
const CUT = Math.round(Core.P.CUT_SEC * FS);
const LIVE_WIN = FS * 10;

/* ───────── 공통 도구 ───────── */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const p2 = n => String(n).padStart(2, "0");
const fmtDate = ms => { const d = new Date(ms); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]}) ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const fmtDur = s => s >= 60 ? `${Math.floor(s / 60)}분 ${p2(Math.floor(s % 60))}초` : `${s.toFixed(1)}초`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ICON = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.6L19.5 9l-5.7 1.6L12 16l-1.8-5.4L4.5 9l5.7-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" opacity=".6"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5v.1c-4.6.6-6.9 2.9-7.5 7.5h-.1c-.6-4.6-2.9-6.9-7.5-7.5V10c4.6-.6 6.9-2.9 7.5-7.5z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 001.5.9l10.4-6.5a1 1 0 000-1.8L9.5 4.6A1 1 0 008 5.5z"/></svg>',
};

const prefs = {
  get(k, d) { try { const v = localStorage.getItem("elmotion." + k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("elmotion." + k, v); } catch (e) { /* 저장 불가 환경 */ } },
};

function toast(msg, ms = 3200) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), ms);
}

function dialog(html, bind) {
  const back = $("#dlgBack"), box = $("#dlg");
  box.innerHTML = html; back.hidden = false;
  const close = () => { back.hidden = true; box.innerHTML = ""; };
  back.onclick = e => { if (e.target === back) close(); };
  bind(box, close);
  const f = box.querySelector("input") || box.querySelector(".acts .solid") || box.querySelector(".acts button");
  if (f) setTimeout(() => f.focus(), 30);
  return close;
}
function confirmDlg(title, text, yes = "예", no = "아니요", warn = false) {
  return new Promise(res => {
    dialog(`<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}<div class="acts"><button id="dN">${esc(no)}</button><button class="${warn ? "warn" : "solid"}" id="dY">${esc(yes)}</button></div>`,
      (b, close) => { b.querySelector("#dN").onclick = () => { close(); res(false); }; b.querySelector("#dY").onclick = () => { close(); res(true); }; });
  });
}

/** 아이콘 등장: 0.1초 간격 */
function stagger(root, max = 14) {
  const els = [...root.querySelectorAll(".pop")];
  els.forEach((el, i) => {
    el.classList.remove("in"); void el.offsetWidth;
    el.style.setProperty("--delay", `${Math.min(i, max) * 0.1}s`);
    el.classList.add("in");
  });
}

/* ───────── 테마 ───────── */
const theme = {
  mq: window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null,
  get pref() { return prefs.get("theme", "system"); },
  resolved() { const p = this.pref; return p === "system" ? (this.mq && this.mq.matches ? "dark" : "light") : p; },
  apply() {
    const r = this.resolved();
    document.documentElement.dataset.ui = r;
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = r === "dark" ? "#080D1D" : "#E9EDF5";
    document.querySelectorAll("#themeOpts .theme-opt").forEach(b => b.classList.toggle("on", b.dataset.theme === this.pref));
    charts.redrawAll();
  },
  set(p) { prefs.set("theme", p); this.apply(); },
};
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ───────── 유리 구슬 + 물 ───────── */
let SPH = 0;
// 수면: 파장이 긴 완만한 곡선 (레퍼런스처럼 잔잔하게)
const WAVE = "M0 6 Q50 0 100 6 T200 6 T300 6 T400 6 V240 H0 Z";
const WAVE_LINE = "M0 6 Q50 0 100 6 T200 6 T300 6 T400 6";
class Sphere {
  constructor(kind, size) {
    const id = ++SPH;
    this.el = document.createElement("div");
    this.el.className = `sphere k-${kind}`;
    this.el.style.cssText = `--d:${size}px`;
    this.el.innerHTML = `<div class="glass-base"></div>
      <svg class="water-svg" viewBox="0 0 200 200" aria-hidden="true"><defs>
      <clipPath id="sc${id}"><ellipse cx="100" cy="99.6" rx="95.5" ry="92"/></clipPath>
      <radialGradient id="sg${id}" cx="30%" cy="34%" r="82%"><stop offset="0" style="stop-color:var(--wl)"/><stop offset=".55" style="stop-color:var(--wm)"/><stop offset="1" style="stop-color:var(--wd)"/></radialGradient>
      <radialGradient id="sv${id}" cx="42%" cy="38%" r="62%"><stop offset=".58" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".4"/></radialGradient></defs>
      <g clip-path="url(#sc${id})">
        <rect x="0" y="0" width="200" height="200" fill="url(#sg${id})" mask="url(#sm${id})"/>
        <mask id="sm${id}"><rect width="200" height="200" fill="#000"/><g class="water" style="transform:translateY(191px)"><path class="w1" d="${WAVE}" fill="#fff"/></g></mask>
        <g class="water wsurf" style="transform:translateY(191px)"><path class="wl" d="${WAVE_LINE}" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.4"/></g>
        <ellipse cx="100" cy="99.6" rx="95.5" ry="92" fill="url(#sv${id})"/>
      </g></svg>
      <div class="glass-top"></div><div class="nums"></div>`;
    this.waters = [...this.el.querySelectorAll(".water")];
    this.nums = this.el.querySelector(".nums");
    this.lv = -1;
  }
  /** 0~1, 아래에서 위로 */
  level(v) {
    v = clamp(v, 0, 1); if (Math.abs(v - this.lv) < 0.002) return this;
    this.lv = v;
    // 수면(물결 기준선 +6)이 타원 바닥(191.6)에서 꼭대기(7.6)까지 움직이게. 0보다 크면 바닥에 얇게라도 보이게 한다
    const shown = v <= 0 ? -0.03 : Math.max(v, 0.045);
    const t = `translateY(${191.6 - shown * 184 - 6}px)`;
    this.waters.forEach(w => { w.style.transform = t; }); return this;
  }
  text(main, sub, unit) {
    const key = `${main}|${sub}|${unit}`; if (key === this.key) return this; this.key = key;
    // 자릿수가 많으면(예: 1046.5) 원 밖으로 나가지 않게 글자 크기를 줄인다
    const len = Math.max(String(main).length, sub != null ? String(sub).length : 0);
    this.nums.style.setProperty("--k", len > 5 ? (5 / len).toFixed(3) : 1);
    this.nums.innerHTML = main === "" ? "" : `<div class="stack${sub != null ? " two" : ""}"><span class="n">${esc(main)}</span>${sub != null ? `<span class="n">${esc(sub)}</span>` : ""}<span class="u">${esc(unit)}</span></div>`;
    return this;
  }
  quick(on) { this.el.classList.toggle("quick", on); return this; }
}

/* ───────── 그래프 ───────── */
const charts = {
  set: new Set(),
  redrawAll() { this.set.forEach(c => c.draw()); },
  clear(root) { this.set.forEach(c => { if (!root || root.contains(c.c)) { c.destroy(); } }); },
};
class Chart {
  /** o: {values, rate, color, half, dec, unit, animate, tap, window, offset} */
  constructor(canvas, o) {
    this.c = canvas; this.o = o; this.g = canvas.getContext("2d");
    this.prog = o.animate ? 0 : 1; this.cursor = -1;
    charts.set.add(this);
    this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(canvas);
    if (o.animate) {
      this.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { this.io.disconnect(); this.play(); } }, { threshold: 0.3 });
      this.io.observe(canvas);
    }
    if (o.tap) this.bindTap();
  }
  play() {
    const t0 = performance.now(), dur = 1100;
    const step = now => { this.prog = clamp((now - t0) / dur, 0, 1); this.draw(); if (this.prog < 1 && this.c.isConnected) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  setValues(v, offset) { this.o.values = v; this.o.offset = offset; this.draw(); }
  /** 그래프 위를 누르거나 밀면 그 위치의 시간·값을 계속 보여 준다 */
  bindTap() {
    let active = false;
    const pick = e => {
      const r = this.c.getBoundingClientRect(), x = e.clientX - r.left, L = 44, R = r.width - 12;
      const n = this.o.values.length; if (n < 2) return;
      const i = clamp(Math.round((x - L) / (R - L) * (n - 1)), 0, n - 1);
      if (i !== this.cursor) { this.cursor = i; this.draw(); }
    };
    this.c.addEventListener("pointerdown", e => { active = true; pick(e); });
    this.c.addEventListener("pointermove", e => { if (active || e.pointerType === "mouse") pick(e); });
    const end = () => { active = false; };
    this.c.addEventListener("pointerup", end); this.c.addEventListener("pointercancel", end);
  }
  draw() {
    const c = this.c, W = c.clientWidth, H = c.clientHeight; if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const o = this.o, v = o.values || [], n = v.length, rate = o.rate || FS;
    const L = 44, R = W - 12, T = 12, B = H - 22, pw = R - L, ph = B - T;
    const span = o.window ? Math.max(o.window - 1, 1) : Math.max(n - 1, 1);
    let mx = 0; for (let i = 0; i < n; i++) { const a = Math.abs(v[i]); if (a > mx && !Number.isNaN(a)) mx = a; }
    const half = Math.max(o.half, mx * 1.12);
    const y = val => T + (1 - (val + half) / (2 * half)) * ph, x = i => L + i / span * pw;
    const ink3 = cssVar("--ink-3"), line = cssVar("--line");
    g.font = `600 10px ${cssVar("--font-num") || "sans-serif"}`;
    // 축: 위·0·아래 (스케치처럼 세 값) + 옅은 격자
    g.textAlign = "right"; g.textBaseline = "middle";
    for (const t of [half, half / 2, 0, -half / 2, -half]) {
      const py = Math.round(y(t)) + .5;
      g.strokeStyle = line; g.lineWidth = 1; g.setLineDash(t === 0 ? [] : [3, 4]);
      g.globalAlpha = t === 0 ? 1 : (Math.abs(t) === half ? .9 : .6);
      g.beginPath(); g.moveTo(L, py); g.lineTo(R, py); g.stroke(); g.globalAlpha = 1;
      if (t === 0 || Math.abs(t) === half) { g.fillStyle = ink3; g.fillText(fmtAxis(t, half), L - 7, py); }
    }
    g.setLineDash([]);
    // 시간 눈금
    const off = o.offset || 0, t0 = off, t1 = off + span / rate, st = niceStep(t1 - t0);
    g.textAlign = "center"; g.textBaseline = "top"; g.fillStyle = ink3;
    for (let t = Math.ceil(t0 / st) * st; t <= t1 + 1e-6; t += st) {
      const px = L + (t - t0) / (t1 - t0) * pw;
      g.fillText(`${+t.toFixed(1)}s`, clamp(px, L + 8, R - 8), B + 6);
    }
    if (n < 2) return;
    // 평가 구간(정속 주행) 옅게 표시
    const inSpan = i => !o.spans || o.spans.some(([a, b]) => i >= a * rate && i <= b * rate);
    if (o.spans) {
      g.fillStyle = hexA(o.color, .09);
      for (const [a, b] of o.spans) { const xa = x(Math.round(a * rate)), xb = x(Math.round(b * rate)); g.fillRect(xa, T, Math.max(1, xb - xa), ph); }
    }
    // 선 (점이 많으면 픽셀 열마다 최소/최대)
    const upto = Math.floor((n - 1) * this.prog);
    g.save(); g.beginPath(); g.rect(L, T - 2, pw * (o.window ? 1 : this.prog) + 1, ph + 4); g.clip();
    const path = new Path2D();
    const step = Math.max(1, Math.floor(n / (pw * 1.2)));
    let first = true, lastX = L;
    if (step <= 1) {
      for (let i = 0; i <= (o.window ? n - 1 : upto); i++) { if (Number.isNaN(v[i])) continue; const px = x(i), py = y(v[i]); if (first) { path.moveTo(px, py); first = false; } else path.lineTo(px, py); lastX = px; }
    } else {
      for (let i = 0; i <= upto; i += step) {
        let lo = Infinity, hi = -Infinity;
        for (let k = i; k < Math.min(n, i + step); k++) { if (v[k] < lo) lo = v[k]; if (v[k] > hi) hi = v[k]; }
        if (!isFinite(lo)) continue;
        const px = x(i); if (first) { path.moveTo(px, y(hi)); first = false; } else path.lineTo(px, y(hi)); path.lineTo(px, y(lo)); lastX = px;
      }
    }
    // 면 채우기
    const area = new Path2D(path); area.lineTo(lastX, y(0)); area.lineTo(L, y(0)); area.closePath();
    const grad = g.createLinearGradient(0, T, 0, B); grad.addColorStop(0, hexA(o.color, .28)); grad.addColorStop(.5, hexA(o.color, .04)); grad.addColorStop(1, hexA(o.color, .28));
    g.fillStyle = grad; g.fill(area);
    g.strokeStyle = o.color; g.lineWidth = 1.8; g.lineJoin = "round"; g.stroke(path);
    g.restore();
    // 끝점 강조 (실시간)
    if (o.window && n) { const px = x(n - 1), py = y(v[n - 1]); g.fillStyle = o.color; g.beginPath(); g.arc(px, py, 3.5, 0, 7); g.fill(); }
    // 최고·최저 표시 (기록 그래프): 점 + 세로 지시선 + 값
    if (o.marks && n > 1 && this.prog >= 1) {
      let hi = 0, lo = 0;
      hi = lo = -1;
      for (let i = 0; i < n; i++) { if (!inSpan(i) || Number.isNaN(v[i])) continue; if (hi < 0 || v[i] > v[hi]) hi = i; if (lo < 0 || v[i] < v[lo]) lo = i; }
      if (hi < 0) hi = lo = 0;
      g.font = `800 11px ${cssVar("--font-num")}`; g.textAlign = "center";
      const mark = (i, above) => {
        const val = v[i]; if (Number.isNaN(val) || Math.abs(val) < Math.pow(10, -o.dec)) return;
        const px = x(i), py = y(val), label = `${Math.abs(val).toFixed(o.dec)} ${o.unit}`;
        const tw = g.measureText(label).width;
        const ty = above ? Math.max(T + 12, py - 14) : Math.min(B - 2, py + 14);
        g.strokeStyle = cssVar("--ink-2"); g.globalAlpha = .6; g.lineWidth = 1;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px, above ? ty - 2 : ty - 10); g.stroke(); g.globalAlpha = 1;
        g.fillStyle = o.color; g.beginPath(); g.arc(px, py, 3.5, 0, 7); g.fill();
        g.fillStyle = cssVar("--ink"); g.textBaseline = above ? "bottom" : "top";
        g.fillText(label, clamp(px, L + tw / 2 + 2, R - tw / 2 - 2), above ? ty - 3 : ty - 9);
      };
      if (o.marks === "peak") {          // 속력: 방향별 최고 속력만 (3 m/min 미만은 표시 안 함)
        if (v[hi] >= 3) mark(hi, true);
        if (v[lo] <= -3) mark(lo, false);
      } else { mark(hi, true); mark(lo, false); }
    }
    // 탭한 지점
    if (this.cursor >= 0 && this.cursor < n && this.prog >= 1) {
      const i = this.cursor, px = x(i), val = v[i];
      g.strokeStyle = cssVar("--ink-2"); g.globalAlpha = .5; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(px, T); g.lineTo(px, B); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      if (!Number.isNaN(val)) {
        const py = y(val);
        g.fillStyle = "#fff"; g.beginPath(); g.arc(px, py, 5.5, 0, 7); g.fill();
        g.fillStyle = o.color; g.beginPath(); g.arc(px, py, 3.5, 0, 7); g.fill();
        const label = `${(off + i / rate).toFixed(2)}초 · ${signed(val, o.dec)} ${o.unit}`;
        g.font = `700 11.5px ${cssVar("--font-num")}`;
        const tw = g.measureText(label).width + 16, th = 24;
        let bx = clamp(px - tw / 2, L, R - tw), by = py - th - 10; if (by < 0) by = py + 10;
        g.fillStyle = cssVar("--ink"); g.globalAlpha = .92; roundRect(g, bx, by, tw, th, 12); g.fill(); g.globalAlpha = 1;
        g.fillStyle = cssVar("--bg"); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, bx + tw / 2, by + th / 2 + .5);
      }
    }
  }
  destroy() { this.ro.disconnect(); if (this.io) this.io.disconnect(); charts.set.delete(this); }
}
function niceStep(range) { const raw = range / 4, mag = Math.pow(10, Math.floor(Math.log10(raw || 1))), r = raw / mag; return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag; }
function fmtAxis(t, half) { const d = half < 3 ? 1 : 0; return t === 0 ? "0" : (t > 0 ? "" : "−") + Math.abs(t).toFixed(d); }
function signed(v, d) { const s = Math.abs(v).toFixed(d); return parseFloat(s) === 0 ? s : (v > 0 ? "+" : "−") + s; }
function hexA(hex, a) { const h = hex.replace("#", ""); const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

const SERIES = [
  { key: "acc", title: "가감속도", unit: "m/s²", dec: 2, half: 1.5, color: "#2C46BE" },
  { key: "jerk", title: "저크", unit: "m/s³", dec: 2, half: 1.0, color: "#D07A1F" },
  { key: "vibV", title: "상하 흔들림", unit: "gal", dec: 1, half: 30, color: "#1C8FA3" },
  { key: "vibL", title: "좌우 흔들림", unit: "gal", dec: 1, half: 30, color: "#94416A" },
  { key: "speed", title: "속력", unit: "m/min", dec: 1, half: 150, color: "#5D4A92" },
];

/* ───────── 기록 저장소 (IndexedDB) ───────── */
const cache = new Map();
/* 기압계: 웹 브라우저에는 아직 기압 센서 API가 없어(크롬 포함) 대부분 '사용 불가'로 자동 비활성화된다.
   앞으로 PressureSensor가 생기거나 안드로이드 앱으로 옮기면 같은 코드로 바로 동작한다. */
const baro = {
  get supported() { return typeof window.PressureSensor === "function"; },
  get on() { return this.supported && prefs.get("baro", "on") === "on"; },
  start(t0) {
    this.samples = []; this.t0 = t0;
    if (!this.on) return;
    try {
      this.sensor = new window.PressureSensor({ frequency: 25 });
      this.sensor.onreading = () => this.samples.push({ t: (performance.now() - this.t0) / 1000, p: this.sensor.pressure });
      this.sensor.start();
    } catch (e) { this.sensor = null; }
  },
  stop() { try { this.sensor && this.sensor.stop(); } catch (e) { /* 무시 */ } this.sensor = null; return this.samples && this.samples.length > 4 ? this.samples : null; },
};
function analysisOf(rec) {
  const useBaro = !!(rec.baro && rec.baro.length > 4 && prefs.get("baro", "on") === "on");
  const k = rec.id + ":" + rec.vert.length + ":" + (useBaro ? 1 : 0);
  if (!cache.has(k)) {
    const A = Core.analyze(rec.vert, rec.lat, rec.rate);
    if (useBaro) {
      // 기압계 보정은 속력과 주행 거리에만
      const f = Core.fuseBaro(A.series.speed, rec.rate, rec.baro);
      if (f) {
        A.series.speed = f.speed; A.series.dist = f.dist;
        let up = 0, down = 0; for (const v of f.speed) { if (v > up) up = v; if (-v > down) down = -v; }
        Object.assign(A.m, { speedUp: up, speedDown: down, speedMax: Math.max(up, down), distance: f.dist[f.dist.length - 1], baro: true });
        A.m.eval = Core.evaluate(A.m);
      }
    }
    cache.set(k, A);
  }
  return cache.get(k);
}
/** 목록 한줄평: 맨 앞 한 문장만 ("우당탕탕!"은 다음 문장과 함께) */
function firstSentence(t) {
  const m = String(t || "").match(/^(우당탕탕!\s*)?[^.!?]*[.!?]/);
  return m ? m[0].trim() : String(t || "");
}
function metaOf(rec) {
  const m = analysisOf(rec).m;
  return {
    id: rec.id, name: rec.name || "", startedAt: rec.startedAt, duration: m.duration, demo: !!rec.demo, imported: !!rec.imported, hasLat: !!rec.lat,
    accPeak: m.accPeak, accMax: m.accMax, decMax: m.decMax, latA95: m.vibL ? m.vibL.a95 : null, speedMax: m.speedMax, overall: m.eval.overall, updatedAt: rec.updatedAt || Date.now(), evalVer: Core.EVAL_VER,
  };
}
const store = {
  db: null, mem: new Map(), persistent: false,
  async open() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open("elmotion", 1);
        r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("rides", { keyPath: "id" }); d.createObjectStore("meta", { keyPath: "id" }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      this.persistent = true;
    } catch (e) { this.db = null; }
  },
  req(name, mode, fn) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(name, mode); const r = fn(tx.objectStore(name));
      tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error);
    });
  },
  async put(rec) {
    rec.updatedAt = rec.updatedAt || Date.now();
    const meta = metaOf(rec);
    if (!this.db) { this.mem.set(rec.id, { rec, meta }); return; }
    await this.req("rides", "readwrite", s => s.put(rec));
    await this.req("meta", "readwrite", s => s.put(meta));
  },
  async list() {
    let a = this.db ? await this.req("meta", "readonly", s => s.getAll()) : [...this.mem.values()].map(v => v.meta);
    a = a || [];
    // 평가 기준이 바뀌었으면 저장된 요약을 새 기준으로 다시 만든다
    for (let i = 0; i < a.length; i++) {
      if (a[i].evalVer === Core.EVAL_VER) continue;
      const rec = await this.get(a[i].id);
      if (rec) { await this.put(rec); a[i] = metaOf(rec); }
    }
    return a.sort((x, y) => y.startedAt - x.startedAt);
  },
  async get(id) {
    if (!this.db) { const m = this.mem.get(id); return m ? m.rec : null; }
    return (await this.req("rides", "readonly", s => s.get(id))) || null;
  },
  async del(id) {
    if (!this.db) { this.mem.delete(id); return; }
    await this.req("rides", "readwrite", s => s.delete(id));
    await this.req("meta", "readwrite", s => s.delete(id));
  },
  async rename(id, name) {
    const rec = await this.get(id); if (!rec) return null;
    rec.name = name; rec.updatedAt = Date.now(); await this.put(rec); return rec;
  },
};

const inPreview = () => !!(window.claude && window.claude.use);

/* ════════════════════════════════════════════════════════════════
   측정 컨트롤러: 센서/데모 → 60 Hz → 안정 감지 → 측정 → 비정상 흔들림 자동 종료
   ════════════════════════════════════════════════════════════════ */
const ctl = {
  state: "idle",          // idle | wait(수동: 안정 기다림) | measure
  sensorOk: null, needPermission: false, gotEvent: false, demo: null,
  progress: 0, needDisturb: false, dirty: true, wake: null,
  get mode() { return prefs.get("mode", "auto"); },
  init() {
    this.stab = new Core.StabilityDetector(FS);
    this.res = new Core.Resampler(FS, (x, y, z) => this.on60(x, y, z));
    if (typeof DeviceMotionEvent === "undefined" || !window.isSecureContext) { this.sensorOk = false; return; }
    this.attach();
    // iOS 등 권한이 필요한 브라우저: 신호가 없으면 '동작 센서 켜기'를 보여 준다
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      this.needPermission = true;
      const ask = () => { document.removeEventListener("click", ask, true); if (!this.gotEvent) this.requestPermission(); };
      document.addEventListener("click", ask, true);
    }
  },
  async requestPermission() {
    this.needPermission = false;
    try {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== "granted") this.sensorOk = false;
      else setTimeout(() => { if (!this.gotEvent) { this.sensorOk = false; home.render(); } }, 2500);
    } catch (e) { this.sensorOk = false; }
    home.render();
  },
  attach() {
    window.addEventListener("devicemotion", e => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      if (!this.gotEvent) { this.gotEvent = true; this.sensorOk = true; home.render(); }
      if (this.demo) return;
      this.res.onEvent(e.timeStamp || performance.now(), a.x, a.y, a.z);
    });
    setTimeout(() => { if (!this.gotEvent && (!this.needPermission || inPreview())) { this.sensorOk = false; home.render(); } }, 2500);
  },
  startDemo() {
    this.res.reset(); this.stab.reset(); this.needDisturb = false;
    const sig = new Core.DemoSignal(), t0 = performance.now();
    let i = 0;
    this.demo = setInterval(() => {
      const target = Math.floor((performance.now() - t0) / 10);
      while (i < target) { const [x, y, z] = sig.next(); this.res.onEvent(t0 + i * 10, x, y, z); i++; }
      if (i > (sig.pickAt + 400) && this.state !== "measure") this.stopDemo();
    }, 20);
    if (this.mode === "manual") this.state = "wait";
    home.render();
  },
  stopDemo() { if (this.demo) { clearInterval(this.demo); this.demo = null; this.progress = 0; home.render(); } },
  get armed() {
    if (this.state === "wait") return true;
    return this.mode === "auto" && this.state === "idle" && !this.needDisturb && nav.page === 1 && !nav.overlay;
  },
  on60(x, y, z) {
    if (this.state === "measure") return this.onMeasure(x, y, z);
    const jumps = this.stab.jumps;
    const r = this.stab.push(x, y, z);
    if (this.stab.jumps !== jumps) this.needDisturb = false;     // 한 번 움직였으면 다시 자동 시작 가능
    const p = this.armed ? r.progress : 0;
    if (Math.abs(p - this.progress) > 0.01) { this.progress = p; this.dirty = true; }
    if (this.armed && r.cal) this.begin(r.cal);
  },
  begin(cal) {
    this.state = "measure"; this.cal = cal; this.progress = 0;
    this.abn = this.mode === "auto" ? new Core.AbnormalDetector(cal, FS) : null;
    this.an = new Core.RideAnalyzer(FS);
    this.vert = []; this.lat = [];
    this.live = { acc: [], jerk: [], vibV: [], vibL: [], speed: [] };
    this.o = null; this.startedAt = Date.now();
    baro.start(performance.now());
    this.lockScreen();
    home.render();
  },
  onMeasure(x, y, z) {
    if (this.abn) { const why = this.abn.push(x, y, z); if (why) return this.stop("abnormal"); }
    const [v, l] = this.cal.project(x, y, z);
    this.vert.push(v); this.lat.push(l);
    const o = this.an.push(v, l);
    const L = this.live;
    L.acc.push(o.acc); L.jerk.push(o.jerk); L.vibV.push(o.vibV); L.vibL.push(o.vibL); L.speed.push(o.speed);
    if (L.acc.length > LIVE_WIN * 2) for (const k in L) L[k].splice(0, LIVE_WIN);
    this.o = o;
    if (this.vert.length % 4 === 0) this.dirty = true;
  },
  async stop(reason) {
    if (this.state !== "measure") { this.state = "idle"; this.progress = 0; home.render(); return; }
    this.state = "idle"; this.needDisturb = true; this.progress = 0;
    this.unlockScreen();
    const baroSamples = baro.stop();
    const demo = !!this.demo; this.stopDemo();
    const n = reason === "abnormal" ? Math.max(0, this.vert.length - CUT) : this.vert.length;
    home.render();
    if (n < FS) { toast("측정 시간이 너무 짧아 저장하지 않았어요."); return; }
    if (reason === "abnormal") { toast("비정상적인 흔들림이 감지되어 측정을 종료했어요.", 4200); try { navigator.vibrate && navigator.vibrate(60); } catch (e) { /* 무시 */ } }
    const rec = { id: "ride_" + this.startedAt, name: demo ? "데모 측정" : "", startedAt: this.startedAt, rate: FS, demo,
      vert: Float32Array.from(this.vert.slice(0, n)), lat: Float32Array.from(this.lat.slice(0, n)), updatedAt: Date.now(),
      baro: baroSamples ? baroSamples.filter(b => b.t <= n / FS) : null };
    try { await store.put(rec); } catch (e) { toast("기록을 저장하지 못했어요."); }
    records.render();
    detail.open(rec, "home");
  },
  async lockScreen() { try { if ("wakeLock" in navigator) this.wake = await navigator.wakeLock.request("screen"); } catch (e) { this.wake = null; } },
  unlockScreen() { try { this.wake && this.wake.release(); } catch (e) { /* 무시 */ } this.wake = null; },
};

/* ════════════════════════════════════════════════════════════════
   홈
   ════════════════════════════════════════════════════════════════ */
const home = {
  detail: false, layout: "",
  render() {
    const st = ctl.state, measuring = st === "measure";
    const want = measuring ? (this.detail ? "live-detail" : "live-simple") : "single";
    $("#livePill").hidden = !measuring;
    if (want !== this.layout) { this.layout = want; this.build(want); }
    this.updateSingle();
    this.renderActions();
    ctl.dirty = true;
  },
  build(kind) {
    const body = $("#homeBody"); charts.clear(body); body.innerHTML = "";
    this.big = this.trip = null; this.liveCharts = [];
    if (kind === "single") {
      const size = Math.round(clamp(Math.min(innerWidth * 0.68, innerHeight * 0.36), 200, 290));
      body.innerHTML = `<div class="single fade-in"><div id="bigSlot"></div><div class="caption" id="cap"></div><div class="sub" id="capSub"></div><div id="capBtns" class="home-actions"></div></div>`;
      this.big = new Sphere("acc", size); $("#bigSlot").appendChild(this.big.el); this.big.quick(true).level(0);
    } else if (kind === "live-simple") {
      const avail = innerHeight - 60 - 70 - 110 - 3 * 30;
      const size = Math.round(clamp(avail / 3, 104, 176));
      body.innerHTML = `<div class="triple">${[["acc", "가감속도"], ["lat", "좌우 흔들림"], ["spd", "현재 속력"]].map(([k, t], i) =>
        `<div class="item fade-in" style="animation-delay:${i * 0.1}s"><div class="lbl">${t}</div><div id="tr-${k}"></div></div>`).join("")}</div>`;
      this.trip = {};
      for (const k of ["acc", "lat", "spd"]) { const s = new Sphere(k, size); $(`#tr-${k}`).appendChild(s.el); s.level(0); this.trip[k] = s; }
    } else {
      body.innerHTML = `<div class="stat-row fade-in">
          <div class="stat glass"><div class="l">저크</div><div class="v" id="lvJ">0.00<small>m/s³</small></div></div>
          <div class="stat glass"><div class="l">상하 흔들림</div><div class="v" id="lvV">0.0<small>gal</small></div></div>
          <div class="stat glass"><div class="l">주행 거리</div><div class="v" id="lvD">0.0<small>m</small></div></div></div>
        <div class="charts">${SERIES.map((s, i) => `<div class="chart-card glass fade-in" style="animation-delay:${0.1 + i * 0.08}s"><div class="h"><b>${s.title}</b><span>${s.unit}</span><em id="lv-${s.key}"></em></div><canvas class="chart" id="lc-${s.key}"></canvas></div>`).join("")}</div>`;
      this.liveCharts = SERIES.map(s => new Chart($(`#lc-${s.key}`), { values: [], rate: FS, color: s.color, half: s.half, dec: s.dec, unit: s.unit, window: LIVE_WIN }));
    }
  },
  updateSingle() {
    if (!this.big) return;
    const cap = $("#cap"), sub = $("#capSub"), btns = $("#capBtns");
    const settling = ctl.progress > 0.04;
    cap.textContent = settling ? "이제 측정을 시작할게요" : "측정 대기 중이에요";
    let subT = "", bt = "";
    if (ctl.sensorOk === false && !ctl.demo) { subT = "이 화면에서는 휴대폰 동작 센서를 쓸 수 없어요."; bt = `<button class="pill-btn" id="bDemo">${ICON.play}데모로 보기</button>`; }
    else if (ctl.mode === "manual" && ctl.state === "idle") { bt = `<button class="pill-btn primary" id="bStart">${ICON.play}측정 시작</button>`; }
    else if (ctl.mode === "manual" && ctl.state === "wait" && !settling) subT = "휴대폰이 1초 동안 안정되면 측정을 시작해요.";
    else if (ctl.needDisturb && ctl.mode === "auto") subT = "휴대폰을 다시 내려놓으면 새 측정을 시작해요.";
    if (this.detail && !subT) subT = "측정이 시작되면 그래프로 자세히 보여 드려요.";
    if (sub.textContent !== subT) sub.textContent = subT;
    if (btns.dataset.k !== bt) {
      btns.dataset.k = bt; btns.innerHTML = bt;
      const bd = $("#bDemo"); if (bd) bd.onclick = () => ctl.startDemo();
      const bs = $("#bStart"); if (bs) bs.onclick = () => { if (ctl.sensorOk === false && !ctl.demo) return; ctl.state = "wait"; ctl.stab.reset(); home.render(); };
    }
  },
  renderActions() {
    const measuring = ctl.state === "measure";
    const k = `${measuring}|${this.detail}|${ctl.mode}`;
    const box = $("#homeActions"); if (box.dataset.k === k) return; box.dataset.k = k;
    const tog = `<button class="pill-btn ${this.detail ? "up" : ""}" id="bTog">${ICON.chev}${this.detail ? "접을래요" : "자세히 볼래요"}</button>`;
    const stop = measuring ? `<button class="pill-btn danger" id="bStop">${ICON.stop}${ctl.mode === "auto" ? "즉시 정지" : "측정 종료"}</button>` : "";
    const cancel = !measuring && ctl.state === "wait" ? `<button class="pill-btn" id="bCancel">취소</button>` : "";
    box.innerHTML = `<div class="toggle-wrap" style="margin:0;gap:10px;display:flex">${tog}${stop}${cancel}</div>`;
    $("#bTog").onclick = () => { this.detail = !this.detail; this.render(); };
    if ($("#bStop")) $("#bStop").onclick = () => ctl.stop("manual");
    if ($("#bCancel")) $("#bCancel").onclick = () => { ctl.state = "idle"; ctl.progress = 0; ctl.stopDemo(); home.render(); };
  },
  tick() {
    if (!ctl.dirty) return; ctl.dirty = false;
    if (ctl.state !== "measure") { if (this.big) { this.big.level(ctl.progress); this.updateSingle(); } return; }
    const o = ctl.o, sec = ctl.vert.length / FS;
    $("#liveTime").textContent = `측정 중 ${Math.floor(sec / 60)}:${p2(Math.floor(sec % 60))}`;
    if (!o) return;
    if (this.trip) {
      this.trip.acc.level(Math.abs(o.acc) / LEGEND.acc).text(Math.abs(o.acc).toFixed(2), null, "m/s²");
      this.trip.lat.level(o.ppL / LEGEND.lat).text(o.ppL.toFixed(1), null, "gal");
      this.trip.spd.level(Math.abs(o.speed) / LEGEND.spd).text(Math.abs(o.speed).toFixed(1), null, "m/min");
    } else if (this.liveCharts.length) {
      $("#lvJ").innerHTML = `${Math.abs(o.jerk).toFixed(2)}<small>m/s³</small>`;
      $("#lvV").innerHTML = `${o.ppV.toFixed(1)}<small>gal</small>`;
      $("#lvD").innerHTML = `${o.dist.toFixed(1)}<small>m</small>`;
      const n = ctl.live.acc.length, take = Math.min(n, LIVE_WIN), off = Math.max(0, ctl.vert.length - take) / FS;
      SERIES.forEach((s, i) => {
        const arr = ctl.live[s.key]; this.liveCharts[i].setValues(arr.slice(arr.length - take), off);
        const cur = arr[arr.length - 1]; $(`#lv-${s.key}`).textContent = cur == null ? "" : signed(s.key === "speed" ? cur : cur, s.dec);
      });
    }
  },
};

/* ════════════════════════════════════════════════════════════════
   기록 관리
   ════════════════════════════════════════════════════════════════ */
const records = {
  selecting: null, sel: new Set(), items: [], anchor: null,   // selecting: null | "export" | "delete"
  async render() {
    const list = $("#recList");
    try { this.items = await store.list(); } catch (e) { this.items = []; }
    if (!this.items.length) {
      list.innerHTML = `<div class="empty">아직 측정 기록이 없어요.<br>홈에서 휴대폰을 내려놓으면 측정이 시작돼요.</div>`;
      return;
    }
    list.classList.toggle("selecting", !!this.selecting);
    list.innerHTML = this.items.map((m, k) => {
      const lv = (v, key) => (v > 0 ? clamp(v / LEGEND[key], 0.06, 1) : 0) * 100;
      const lat = m.latA95 == null ? "—" : m.latA95.toFixed(1);
      const fitMini = t => (t.length >= 6 ? ' style="font-size:10.5px"' : t.length === 5 ? ' style="font-size:12px"' : "");   // 239.6처럼 긴 숫자는 원 안에 들어가게 줄임
      return `<article class="rec-card glass ${this.sel.has(m.id) ? "sel" : ""} ${this.anchor === k ? "anchor" : ""}" data-id="${esc(m.id)}" data-k="${k}" tabindex="0">
        <div class="rc-head"><span class="check"></span>
          <div class="t"><div class="rc-name">${esc(m.name || fmtDate(m.startedAt))}${m.demo ? '<span class="tag">데모</span>' : ""}${m.imported ? '<span class="tag">가져옴</span>' : ""}</div>
          <div class="rc-date">${m.name ? fmtDate(m.startedAt) + " · " : ""}${fmtDur(m.duration)}</div></div>
          <button class="ic-btn pop" data-act="edit" aria-label="이름 변경">${ICON.edit}</button></div>
        <div class="rc-body"><div class="minis">
          <div class="mini k-acc" style="--lv:${lv(m.accPeak, "acc")}%"><span class="ms two"><b>${(m.accMax ?? m.accPeak).toFixed(2)}</b><b>${(m.decMax ?? m.accPeak).toFixed(2)}</b><i>m/s²</i></span></div>
          <div class="mini k-lat" style="--lv:${m.latA95 == null ? 0 : lv(m.latA95, "lat")}%"><span class="ms"><b${fitMini(lat)}>${lat}</b><i>${m.latA95 == null ? "" : "gal"}</i></span></div>
          <div class="mini k-spd" style="--lv:${lv(m.speedMax, "spd")}%"><span class="ms"><b${fitMini(m.speedMax.toFixed(1))}>${m.speedMax.toFixed(1)}</b><i>m/min</i></span></div></div>
          <div class="rc-line">${esc(firstSentence(m.overall))}</div></div></article>`;
    }).join("");
    stagger(list, 12);
    list.querySelectorAll(".rec-card").forEach(card => {
      const id = card.dataset.id, k = +card.dataset.k;
      card.onclick = async e => {
        if (this.selecting) { this.pick(k); return; }
        const act = e.target.closest("[data-act]");
        if (act && act.dataset.act === "edit") return this.renameDlg(id, (this.items.find(x => x.id === id) || {}).name);
        const rec = await store.get(id); if (rec) detail.open(rec, "records");
      };
      card.onkeydown = e => { if (e.key === "Enter") card.click(); };
    });
  },
  /** 범위 선택: 시작 기록과 끝 기록을 차례로 누르면 그 사이가 모두 선택(이미 모두 선택돼 있으면 해제) */
  pick(k) {
    if (this.anchor === null) { this.anchor = k; this.paint(); this.renderBar(); return; }
    const a = Math.min(this.anchor, k), b = Math.max(this.anchor, k);
    const ids = this.items.slice(a, b + 1).map(m => m.id);
    const allOn = ids.every(id => this.sel.has(id));
    ids.forEach(id => (allOn ? this.sel.delete(id) : this.sel.add(id)));
    this.anchor = null; this.paint(); this.renderBar();
  },
  paint() {
    $("#recList").querySelectorAll(".rec-card").forEach(c => {
      c.classList.toggle("sel", this.sel.has(c.dataset.id));
      c.classList.toggle("anchor", this.anchor === +c.dataset.k);
    });
  },
  renderBar() {
    let bar = $("#selBar");
    document.body.classList.toggle("selecting", !!this.selecting);
    if (!this.selecting) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement("div"); bar.id = "selBar"; bar.className = "select-bar"; document.body.appendChild(bar); }
    const all = this.items.length && this.sel.size === this.items.length;
    const del = this.selecting === "delete";
    const hint = this.anchor === null ? "시작할 기록과 끝 기록을 차례로 눌러 고르세요" : "끝 기록을 눌러 주세요";
    bar.innerHTML = `<div class="sb-hint">${hint}</div><div class="sb-row">
      <button class="pill-btn" id="sbCancel">취소</button>
      <button class="pill-btn" id="sbAll">${all ? "선택 해제" : "모두 선택"}</button>
      <button class="pill-btn ${del ? "danger" : "primary"}" id="sbGo" ${this.sel.size ? "" : "disabled"}>${this.sel.size}개 ${del ? "삭제" : "내보내기"}</button></div>`;
    $("#sbCancel").onclick = () => nav.back();
    $("#sbAll").onclick = () => { if (all) this.sel.clear(); else this.items.forEach(m => this.sel.add(m.id)); this.anchor = null; this.paint(); this.renderBar(); };
    $("#sbGo").onclick = () => (del ? this.deleteSelected() : this.exportSelected());
  },
  startSelect(kind) {
    if (!this.items.length) { toast(kind === "delete" ? "삭제할 기록이 없어요." : "내보낼 기록이 없어요."); return; }
    this.setSelecting(kind);
    nav.push("select");
  },
  /** 화면만 바꾼다 (뒤로 가기 기록은 nav가 관리) */
  setSelecting(kind) {
    this.selecting = kind; this.sel.clear(); this.anchor = null;
    $("#recList").classList.toggle("selecting", !!kind);
    document.body.classList.toggle("rec-selecting", !!kind);
    this.paint(); this.renderBar();
  },
  async exportSelected() {
    const ids = this.items.filter(m => this.sel.has(m.id)).map(m => m.id); let ok = 0;
    for (const id of ids) {
      const rec = await store.get(id); if (!rec) continue;
      const csv = Core.exportCsv(rec, analysisOf(rec));
      if (await saveFile(fileNameOf(rec), csv)) ok++;
      await sleep(350);
    }
    nav.back();
    if (ok) toast(`${ok}개 파일을 내보냈어요.`);
  },
  async deleteSelected() {
    const ids = [...this.sel];
    if (!(await confirmDlg(`${ids.length}개 기록을 삭제할까요?`, "삭제한 기록은 되돌릴 수 없어요.", "삭제", "취소", true))) return;
    for (const id of ids) await store.del(id);
    nav.back();
    await this.render();
    toast(`${ids.length}개 기록을 삭제했어요.`);
  },
  renameDlg(id, current) {
    dialog(`<h3>기록 이름</h3><p>내보내는 파일 이름으로도 쓰여요.</p><input id="nmI" maxlength="40" placeholder="예: 본관 3호기 상행" value="${esc(current || "")}">
      <div class="acts"><button id="dC">취소</button><button class="solid" id="dS">저장</button></div>`, (b, close) => {
      const save = async () => {
        const name = b.querySelector("#nmI").value.trim(); close();
        await store.rename(id, name);
        if (detail.rec && detail.rec.id === id) { detail.rec.name = name; detail.renderHead(); }
        this.render();
      };
      b.querySelector("#dC").onclick = close; b.querySelector("#dS").onclick = save;
      b.querySelector("#nmI").onkeydown = e => { if (e.key === "Enter") save(); };
    });
  },
  async importFiles(files) {
    if (!files.length) return;
    if (!(await confirmDlg(`${files.length}개 파일을 가져올까요?`, ""))) return;
    let ok = 0; const bad = [];
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer();
        let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder("euc-kr").decode(buf); }
        const imp = Core.importCsv(text);
        const name = f.name.replace(/\.csv$/i, "");
        const startedAt = imp.startedAt || f.lastModified || Date.now();
        const rec = { id: `ride_${startedAt}_${Math.random().toString(36).slice(2, 7)}`, name, startedAt, rate: imp.rate, imported: true,
          vert: imp.vert, lat: imp.lat, updatedAt: Date.now() };
        await store.put(rec); ok++;
      } catch (e) { bad.push(f.name); }
    }
    await this.render();
    toast(bad.length ? `${ok}개를 가져왔어요. ${bad.length}개는 형식이 맞지 않았어요: ${bad.slice(0, 2).join(", ")}${bad.length > 2 ? " 외" : ""}` : `${ok}개 파일을 가져왔어요.`, 4500);
  },
};

function fileNameOf(rec) {
  const d = new Date(rec.startedAt);
  const base = (rec.name || "").trim() || `elMotion_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  return base.replace(/[\\/:*?"<>|]/g, "_") + ".csv";
}
let downloads = null;
if (inPreview()) window.claude.use("downloads").then(d => { downloads = d; }).catch(() => {});
async function saveFile(filename, text) {
  const data = "﻿" + text;
  if (inPreview()) {
    if (!downloads) { toast("이 미리보기에서는 파일을 저장할 수 없어요."); return false; }
    try { await downloads.save({ filename, data }); return true; }
    catch (e) { if (e && e.code === "declined") return false; toast("파일을 저장하지 못했어요."); return false; }
  }
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "text/csv" })); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return true;
  } catch (e) { toast("파일을 저장하지 못했어요."); return false; }
}

/* ════════════════════════════════════════════════════════════════
   기록 상세
   ════════════════════════════════════════════════════════════════ */
const detail = {
  rec: null, from: "records", detail: false,
  open(rec, from) {
    this.rec = rec; this.from = from; this.detail = false;
    this.render();
    nav.openSheet("record");
  },
  renderHead() {
    const h = $("#dHead"); if (!h || !this.rec) return;
    const r = this.rec, A = analysisOf(r);
    h.querySelector("h2").textContent = r.name || "측정 기록";
    h.querySelector(".tt div").textContent = `${fmtDate(r.startedAt)} · ${fmtDur(A.m.duration)}`;
  },
  render() {
    const r = this.rec, A = analysisOf(r), ev = A.m.eval, box = $("#detailIn");
    charts.clear(box);
    box.innerHTML = `<div class="top" id="dHead"><button class="round-btn pop" id="dBack" aria-label="뒤로">${ICON.back}</button>
        <div class="tt"><h2></h2><div></div></div><button class="round-btn pop" id="dEdit" aria-label="이름 변경">${ICON.edit}</button></div>
      <div class="ai-box glass fade-in"><span class="ai-chip">${ICON.star}AI 평가</span><p>${esc(ev.overall)}</p></div>
      <div id="dBody"></div>
      <div class="toggle-wrap"><button class="pill-btn ${this.detail ? "up" : ""}" id="dTog">${ICON.chev}${this.detail ? "접을래요" : "자세히 볼래요"}</button></div>`;
    this.renderHead();
    $("#dBack").onclick = () => nav.back();
    $("#dEdit").onclick = () => records.renameDlg(r.id, r.name);
    $("#dTog").onclick = () => { this.detail = !this.detail; this.render(); $("#detailIn").scrollTop = 0; };
    stagger(box);
    if (!this.detail) this.simple(A); else this.full(A);
  },
  simple(A) {
    const m = A.m, ev = m.eval, body = $("#dBody");
    const rows = [
      { k: "acc", lbl: "가감속도", lv: m.accPeak / LEGEND.acc, n1: m.accMax.toFixed(2), n2: m.decMax.toFixed(2), u: "m/s²",
        b: ev.acc, p: `가속 최대 ${m.accMax.toFixed(2)} · 감속 최대 ${m.decMax.toFixed(2)} m/s²` },
      m.vibL
        ? { k: "lat", lbl: "좌우 흔들림", lv: m.vibL.a95 / LEGEND.lat, n1: m.vibL.a95.toFixed(1), u: "gal", b: ev.vibL, p: ev.vibL.line }
        : { k: "lat", lbl: "좌우 흔들림", lv: 0, n1: "—", u: "gal", b: { lv: 2, t: "수평 데이터가 없어요" }, p: "가져온 파일에 수평 방향 값이 없어요." },
      { k: "spd", lbl: "속력", lv: m.speedMax / LEGEND.spd, n1: m.speedMax.toFixed(1), u: "m/min", b: ev.speed,
        p: `상승 최고 ${m.speedUp.toFixed(1)} · 하강 최고 ${m.speedDown.toFixed(1)} m/min` },
    ];
    const size = Math.round(clamp(innerWidth * 0.36, 120, 160));
    body.innerHTML = `<div class="d-rows">${rows.map((r, i) => `<div class="d-row fade-in" style="animation-delay:${0.1 + i * 0.1}s">
        <div><div class="lbl">${r.lbl}</div><div id="ds-${r.k}"></div></div>
        <div class="ev"><b class="lv${r.b.lv}">${esc(r.b.t)}</b><p>${esc(r.p)}</p></div></div>`).join("")}</div>`;
    rows.forEach((r, i) => {
      const s = new Sphere(r.k, size); $(`#ds-${r.k}`).appendChild(s.el);
      s.text(r.n1, r.n2 != null ? r.n2 : null, r.u).level(0);
      setTimeout(() => s.level(Math.max(r.lv, r.n1 === "—" ? 0 : 0.03)), 250 + i * 150);
    });
  },
  /** 자세히: AI 평가 + 6가지 지표 + 그래프 (레이아웃 스케치 기준) */
  full(A) {
    const m = A.m, ev = m.eval, body = $("#dBody"), S = A.series, r = this.rec;
    const floors = Math.round(m.distance / 3);
    const cards = [
      { l: "저크", v: m.jerkMax.toFixed(2), u: "m/s³", e: ev.jerk.s, lv: ev.jerk.lv },
      { l: "가감속도", v2: [["가속", m.accMax.toFixed(2)], ["감속", m.decMax.toFixed(2)]], u: "m/s²", e: ev.acc.detail, e2: ev.acc.detail.split(/(?<=고) /), lv: ev.acc.lv },
      { l: "속력", v: m.speedMax.toFixed(1), u: "m/min", e: m.speedMax <= 500 ? `${ev.speed.s} 승강기` : ev.speed.s, lv: 0 },
      { l: "운행 거리", v: m.distance.toFixed(1), u: "m", e: floors >= 1 ? `건물 약 ${floors}층 높이` : "거의 움직이지 않았어요", lv: -1 },
      { l: "상하 흔들림", v: m.vibV.a95.toFixed(1), u: "gal", e: ev.vibV.s, lv: ev.vibV.lv },
      m.vibL ? { l: "좌우 흔들림", v: m.vibL.a95.toFixed(1), u: "gal", e: ev.vibL.s, lv: ev.vibL.lv } : { l: "좌우 흔들림", v: "—", u: "", e: "데이터 없음", lv: -1 },
    ];
    const series = SERIES.filter(s => s.key !== "vibL" || r.lat);
    const comment = { acc: ev.acc.s, jerk: ev.jerk.s, vibV: ev.vibV.s, vibL: ev.vibL ? ev.vibL.s : "", speed: ev.speed.s };
    body.innerHTML = `<div class="m6">${cards.map((c, i) => `<div class="m6-card glass fade-in" style="animation-delay:${0.05 + i * 0.05}s">
        <div class="l">${c.l}</div>
        ${c.v2 ? `<div class="v2">${c.v2.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div><div class="u">${c.u}</div>`
               : `<div class="v">${c.v}<small>${c.u}</small></div>`}
        <div class="e ${c.e2 ? "two" : ""} ${c.lv >= 0 ? "lv" + c.lv : ""}">${c.e2 ? c.e2.map(x => `<span>${esc(x)}</span>`).join("") : esc(c.e)}</div></div>`).join("")}</div>
      <div class="charts">${series.map((s, i) => `<div class="chart-card glass fade-in" style="animation-delay:${0.1 + i * 0.08}s">
        <div class="h"><b>${s.title}</b><span>${s.unit}</span><em>${esc(comment[s.key] || "")}</em></div><canvas class="chart" id="dc-${s.key}" style="height:180px"></canvas></div>`).join("")}</div>`;
    series.forEach(s => new Chart($(`#dc-${s.key}`), { values: S[s.key], rate: r.rate, color: s.color, half: s.half, dec: s.dec, unit: s.unit, animate: true, tap: true, marks: s.key === "speed" ? "peak" : true, spans: (s.key === "vibV" || s.key === "vibL") && A.m.cruise.length ? A.m.cruise : null }));
  },
};

/* ════════════════════════════════════════════════════════════════
   설정
   ════════════════════════════════════════════════════════════════ */
const settings = {
  init() {
    document.querySelectorAll("#themeOpts .theme-opt").forEach(b => b.onclick = () => theme.set(b.dataset.theme));
    document.querySelectorAll("#modeSeg button").forEach(b => b.onclick = () => {
      if (ctl.state === "measure") { toast("측정 중에는 측정 방식을 바꿀 수 없어요."); return; }
      prefs.set("mode", b.dataset.mode); ctl.state = "idle"; ctl.progress = 0; this.renderMode(); home.layout = ""; home.render(); });
    $("#btnTerms").onclick = () => dialog(`<h3>약관 및 데이터 안내</h3>
      <p>측정 기록은 이 기기의 브라우저 저장소에 보관돼요. 브라우저 데이터를 지우면 함께 지워져요.</p>
      <p>측정값은 휴대폰 센서로 구한 참고값이에요. 공식 승차감 검사를 대신하지 않아요.</p>
      <div class="acts"><button class="solid" id="dOk">확인</button></div>`, (b, close) => { b.querySelector("#dOk").onclick = close; });
    this.renderMode();
    this.renderBaro();
    $("#baroSw").onclick = () => {
      if (!baro.supported) return;
      prefs.set("baro", baro.on ? "off" : "on"); cache.clear(); this.renderBaro(); records.render();
    };
  },
  renderBaro() {
    const sw = $("#baroSw"), ok = baro.supported;
    sw.disabled = !ok; sw.setAttribute("aria-checked", ok && baro.on ? "true" : "false");
    $("#baroDesc").textContent = ok ? (baro.on ? "속력과 운행 거리를 기압 변화로 보정해요" : "가속도 센서만으로 계산해요")
      : "이 기기(브라우저)에서는 기압계를 쓸 수 없어 꺼져 있어요";
  },
  renderMode() {
    const mode = ctl.mode, seg = $("#modeSeg"), btns = [...seg.querySelectorAll("button")];
    btns.forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
    const on = btns.find(b => b.dataset.mode === mode), th = seg.querySelector(".thumb");
    requestAnimationFrame(() => { th.style.width = on.offsetWidth + "px"; th.style.transform = `translateX(${on.offsetLeft - 4}px)`; });
    $("#modeDesc").textContent = mode === "auto" ? "내려놓으면 시작, 가져가면 끝나요" : "버튼으로 시작하고 끝내요";
  },
};

/* ════════════════════════════════════════════════════════════════
   도움말
   ════════════════════════════════════════════════════════════════ */
const help = {
  i: 0,
  build() {
    const phone = (x, y, w, h, extra = "") => `<g ${extra}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * .18}" fill="var(--ink)"/><rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="${w * .14}" fill="url(#hscr)"/><circle cx="${x + w / 2}" cy="${y + h * .42}" r="${w * .22}" fill="rgba(255,255,255,.5)" stroke="#fff" stroke-width="1.2"/><path d="M${x + w * .28} ${y + h * .46} q${w * .11} -4 ${w * .22} 0 t${w * .22} 0 v${w * .12} h-${w * .44} z" fill="#2C46BE" opacity=".85"/></g>`;
    const defs = `<defs><linearGradient id="hscr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E3E9F2"/><stop offset="1" stop-color="#D8E0EC"/></linearGradient>
      <linearGradient id="hwall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--surface)"/><stop offset="1" style="stop-color:var(--surface-2)"/></linearGradient>
      <linearGradient id="hrail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8EBF5"/><stop offset=".5" stop-color="#9AA3BD"/><stop offset="1" stop-color="#C9CFE0"/></linearGradient>
      <linearGradient id="hw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6E80D4"/><stop offset="1" stop-color="#17289A"/></linearGradient>
      <clipPath id="hcl"><circle cx="150" cy="128" r="46"/></clipPath>
      <clipPath id="hcar"><rect x="40" y="24" width="220" height="252" rx="22"/></clipPath></defs>`;
    const car = `<rect x="40" y="24" width="220" height="252" rx="22" fill="url(#hwall)"/>
      <path d="M40 228 L260 228" stroke="var(--line)" stroke-width="2"/>
      <rect x="66" y="182" width="10" height="20" rx="3" fill="#A9B0C6"/><rect x="224" y="182" width="10" height="20" rx="3" fill="#A9B0C6"/>
      <rect x="58" y="172" width="184" height="14" rx="7" fill="url(#hrail)"/>`;
    const s1 = `<svg viewBox="0 0 300 300" class="ill">${defs}${car}
      <g class="h1-phone">${phone(132, 96, 36, 76)}</g>
      <circle class="h1-ring" cx="150" cy="172" r="10" fill="none" stroke="var(--accent)" stroke-width="2"/></svg>`;
    const s2 = `<svg viewBox="0 0 300 300" class="ill">${defs}
      <rect x="86" y="20" width="128" height="260" rx="28" fill="var(--ink)"/><rect x="92" y="26" width="116" height="248" rx="23" fill="url(#hscr)"/>
      <rect x="132" y="34" width="36" height="8" rx="4" fill="var(--ink)"/>
      <circle cx="150" cy="128" r="46" fill="rgba(255,255,255,.55)"/>
      <g clip-path="url(#hcl)"><g class="h2-water"><path d="M60 0 q15 -6 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 v120 h-180 z" fill="url(#hw)" class="h2-wave"/></g></g>
      <circle cx="150" cy="128" r="46" fill="none" stroke="#fff" stroke-width="2"/><ellipse cx="136" cy="108" rx="16" ry="9" fill="rgba(255,255,255,.7)"/>
      <rect class="h2-txt" x="112" y="190" width="76" height="10" rx="5" fill="#9AA0B8"/><rect x="122" y="208" width="56" height="8" rx="4" fill="#C9CDDB"/>
      <rect x="112" y="240" width="76" height="20" rx="10" fill="#fff" stroke="#E1E4EF"/></svg>`;
    const skin = `fill="#F4CDB4" stroke="#D49C7A" stroke-width="1.6" stroke-linejoin="round"`;
    const s3 = `<svg viewBox="0 0 300 300" class="ill">${defs}${car}
      <g clip-path="url(#hcar)"><g class="h3-lift">
        <g class="h3-hand"><path ${skin} d="M262 300 L214 300 C206 262 194 226 184 196 C178 178 176 160 182 146 C188 134 204 134 210 148 C216 166 220 190 230 214 C240 240 252 268 266 290 Z"/></g>
        ${phone(132, 96, 36, 76)}
        <g class="h3-front">
          <rect ${skin} x="123" y="117" width="17" height="11" rx="5.5"/><rect ${skin} x="121" y="130" width="19" height="11" rx="5.5"/>
          <rect ${skin} x="121" y="143" width="19" height="11" rx="5.5"/><rect ${skin} x="123" y="156" width="17" height="10" rx="5"/>
          <path ${skin} d="M190 166 C184 154 176 146 166 142 C158 139 153 145 158 151 C164 157 172 164 176 174 Z"/></g>
      </g></g>
      <g class="h3-badge"><rect x="98" y="34" width="104" height="30" rx="9" fill="#D23F47"/><rect x="113" y="44" width="10" height="10" rx="2" fill="#fff"/><text x="160" y="54" font-size="12" font-weight="800" fill="#fff" text-anchor="middle" font-family="NanumSquareNeo, sans-serif">측정 종료</text></g></svg>`;
    $("#helpIn").innerHTML = `<style>
      .h1-phone { animation: h1 3.4s cubic-bezier(.3,.7,.3,1) infinite; }
      @keyframes h1 { 0% { transform: translateY(-80px) rotate(-8deg); opacity: 0; transform-origin: 150px 170px; } 15% { opacity: 1; } 50%, 85% { transform: translateY(0) rotate(0); opacity: 1; } 100% { transform: translateY(0); opacity: 0; } }
      .h1-ring { transform-origin: 150px 172px; animation: h1r 3.4s ease-out infinite; opacity: 0; }
      @keyframes h1r { 0%, 50% { transform: scale(.4); opacity: 0; } 55% { opacity: .9; } 85% { transform: scale(4); opacity: 0; } 100% { opacity: 0; } }
      .h2-water { animation: h2 3.6s cubic-bezier(.3,.8,.3,1) infinite; }
      @keyframes h2 { 0% { transform: translateY(178px); } 55%, 85% { transform: translateY(98px); } 100% { transform: translateY(178px); } }
      .h2-wave { animation: h2w 1.8s linear infinite; }
      @keyframes h2w { to { transform: translateX(-60px); } }
      .h2-txt { animation: h2t 3.6s ease infinite; }
      @keyframes h2t { 0%, 20% { opacity: .3; } 40%, 60% { opacity: 1; } 75%, 100% { opacity: 0; } }
      .h3-hand { animation: h3h 4s cubic-bezier(.3,.7,.3,1) infinite; }
      @keyframes h3h { 0% { transform: translate(80px, 110px); opacity: 0; } 12% { opacity: 1; } 36%, 100% { transform: none; opacity: 1; } }
      .h3-front { animation: h3f 4s linear infinite; }
      @keyframes h3f { 0%, 30% { opacity: 0; } 37%, 100% { opacity: 1; } }
      .h3-lift { animation: h3 4s cubic-bezier(.5,0,.3,1) infinite; }
      @keyframes h3 { 0%, 44% { transform: none; opacity: 1; } 82% { transform: translate(60px, -190px) rotate(8deg); opacity: 1; } 90%, 100% { transform: translate(60px, -190px) rotate(8deg); opacity: 0; } }
      .h3-badge { animation: h3b 4s ease infinite; transform-origin: 150px 49px; }
      @keyframes h3b { 0%, 60% { opacity: 0; transform: scale(.6); } 68%, 94% { opacity: 1; transform: scale(1); } 100% { opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .h1-phone, .h1-ring, .h2-water, .h2-wave, .h2-txt, .h3-lift, .h3-hand, .h3-front, .h3-badge { animation: none; opacity: 1; } }
    </style>
    <div class="top"><span class="help-sec">측정 방법</span><span style="flex:1"></span><button class="round-btn" id="hClose" aria-label="닫기">${ICON.close}</button></div>
    <div class="help-track" id="hTrack">
      <div class="help-slide">${s1}<h1>두세요.</h1><p>휴대폰을 바닥에 내려놓거나 벽에 거치하세요.</p></div>
      <div class="help-slide">${s2}<h1>보세요.</h1><p>1초 동안 안정되어 있는 환경에서 자동으로 측정을 시작합니다.</p></div>
      <div class="help-slide">${s3}<h1>가져가세요.</h1><p>휴대폰을 가져가면 자동으로 측정이 끝나요.</p><p>혹은 측정 중에 <span class="inline-stop"><i></i>즉시 정지</span> 를 누르면 즉시 정지돼요.</p></div>
    </div>
    <div class="dots" id="hDots"><i></i><i></i><i></i></div>`;
    $("#hClose").onclick = () => nav.back();
    $("#hDots").querySelectorAll("i").forEach((d, i) => d.onclick = () => this.go(i));
    swipe($("#hTrack"), dir => this.go(clamp(this.i + dir, 0, 2)), dx => { $("#hTrack").style.transform = `translateX(calc(${-this.i * 33.3334}% + ${dx}px))`; }, () => this.go(this.i));
  },
  open() { this.build(); this.go(0); nav.openSheet("help"); },
  go(i) {
    this.i = i; const t = $("#hTrack"); if (!t) return;
    t.style.transition = ""; t.style.transform = `translateX(${-i * 33.3334}%)`;
    $("#hDots").querySelectorAll("i").forEach((d, k) => d.classList.toggle("on", k === i));
  },
};

/* ───────── 가로 스와이프 공통 ───────── */
function swipe(el, onCommit, onMove, onCancel, canStart = () => true) {
  let sx = 0, sy = 0, dx = 0, active = false, dragging = false, id = null, t0 = 0;
  el.addEventListener("pointerdown", e => {
    if (!canStart(e)) return;
    active = true; dragging = false; sx = e.clientX; sy = e.clientY; dx = 0; id = e.pointerId; t0 = performance.now();
  });
  el.addEventListener("pointermove", e => {
    if (!active || e.pointerId !== id) return;
    dx = e.clientX - sx; const dy = e.clientY - sy;
    if (!dragging) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { active = false; return; }
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) { dragging = true; el.style.transition = "none"; el.classList.add("dragging"); try { el.setPointerCapture(id); } catch (er) { /* 무시 */ } }
    }
    if (dragging) onMove(dx);
  });
  const end = e => {
    if (!active || (e && e.pointerId !== id)) return;
    active = false;
    if (!dragging) return;
    dragging = false; el.style.transition = ""; el.classList.remove("dragging");
    const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
    if (Math.abs(dx) > el.parentElement.clientWidth * 0.2 || v > 0.5) onCommit(dx < 0 ? 1 : -1); else onCancel();
    // 끌기 후 클릭 막기
    const stop = ev => { ev.stopPropagation(); ev.preventDefault(); window.removeEventListener("click", stop, true); };
    window.addEventListener("click", stop, true); setTimeout(() => window.removeEventListener("click", stop, true), 50);
  };
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
}

/* ════════════════════════════════════════════════════════════════
   화면 이동: [기록 관리] ← [홈] → [설정]
   뒤로 가기는 한 단계 위로: 기록 상세 → 기록 관리, 선택 모드 → 기록 관리, 기록 관리·설정·도움말 → 홈
   브라우저 기록(#해시)과 같은 순서의 스택을 따로 들고 있어서 휴대폰의 뒤로 가기와 화면의 뒤로 버튼이 똑같이 움직인다.
   ════════════════════════════════════════════════════════════════ */
const nav = {
  page: 1, overlay: null, stack: [""],
  init() {
    const pager = $("#pager");
    swipe(pager, dir => this.go(clamp(this.page + dir, 0, 2)),
      dx => { const W = pager.parentElement.clientWidth; const edge = (this.page === 0 && dx > 0) || (this.page === 2 && dx < 0); pager.style.transform = `translateX(${-this.page * W + (edge ? dx * 0.3 : dx)}px)`; },
      () => this.go(this.page),
      e => !this.overlay && !records.selecting && !e.target.closest("input, .seg, .switch"));
    $("#navRecords").onclick = () => this.go(0);
    $("#navHome").onclick = () => this.go(1);
    $("#navSettings").onclick = () => this.go(2);
    $("#btnHelp").onclick = () => help.open();
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);   // 항상 홈에서 시작
    window.addEventListener("hashchange", () => this.onHash());
    window.addEventListener("resize", () => this.place());
    this.showPage(1);
  },
  get top() { return this.stack[this.stack.length - 1]; },
  push(h) { this.stack.push(h); location.hash = h; },
  replace(h) { this.stack[this.stack.length - 1] = h; if (h) location.replace("#" + h); else history.replaceState(null, "", location.pathname + location.search); this.apply(h); },
  back() { if (this.stack.length > 1) history.back(); else this.apply(""); },
  onHash() {
    const h = location.hash.slice(1), st = this.stack;
    if (st.length > 1 && st[st.length - 2] === h) st.pop();
    else if (h !== this.top) st.push(h);
    this.apply(h);
  },
  /** 해시 상태를 화면에 반영 (기록 스택은 건드리지 않는다) */
  apply(h) {
    if (h !== "select" && records.selecting) records.setSelecting(null);
    if (h !== "record" && h !== "help" && this.overlay) this.hideSheet();
    if (h === "" ) return this.showPage(1);
    if (h === "records") return this.showPage(0);
    if (h === "settings") return this.showPage(2);
    if (h === "select") { if (!records.selecting) this.replace("records"); return; }
    if (h === "record") { if (detail.rec) this.showSheet("record"); else this.replace(this.page === 0 ? "records" : ""); return; }
    if (h === "help") { if (this.overlay !== "help") { help.build(); help.go(0); this.showSheet("help"); } }
  },
  /** 탭·스와이프로 쪽 이동: 홈 ↔ 한 단계(기록 관리/설정) */
  go(i) {
    const target = i === 0 ? "records" : i === 2 ? "settings" : "";
    if (target === this.top) return this.showPage(i);
    if (!target) return this.stack.length > 1 ? this.back() : this.replace("");
    if (this.top === "") this.push(target); else this.replace(target);
    this.showPage(i);
  },
  /** 하단 탭의 원: 선택한 탭 아래로 미끄러져 이동 */
  moveOrb() {
    const orb = $("#navOrb"), b = $(["#navRecords", "#navHome", "#navSettings"][this.page]);
    if (!orb || !b) return;
    orb.style.transform = `translateX(${b.offsetLeft + b.offsetWidth / 2 - orb.offsetWidth / 2}px)`;
  },
  place() { $("#pager").style.transform = `translateX(${-this.page * 33.3334}%)`; },
  showPage(i) {
    const changed = i !== this.page;
    this.page = i; this.place();
    ["#navRecords", "#navHome", "#navSettings"].forEach((s, k) => $(s).classList.toggle("on", k === i));
    this.moveOrb();
    if (changed) {
      stagger($(["#pRecords", "#pHome", "#pSettings"][i]));
      if (i === 0) records.render();
      if (i === 2) settings.renderMode();
      if (i === 1) ctl.needDisturb = false;
    }
    ctl.dirty = true; home.updateSingle();
  },
  openSheet(kind) { this.showSheet(kind); this.push(kind); },
  closeSheet() { this.back(); },
  showSheet(kind) {
    this.overlay = kind;
    const el = kind === "help" ? $("#sHelp") : $("#sDetail");
    el.classList.add("open"); el.setAttribute("aria-hidden", "false");
  },
  hideSheet() {
    const kind = this.overlay; if (!kind) return;
    this.overlay = null;
    const el = kind === "help" ? $("#sHelp") : $("#sDetail");
    el.classList.remove("open"); el.setAttribute("aria-hidden", "true");
    if (kind === "record" && detail.from === "home") ctl.needDisturb = false;
  },
};

/* ───────── 앱 설치 (홈 화면에 추가) ───────── */
const installer = {
  evt: null,
  get installed() { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; },
  get ios() { return /iPhone|iPad|iPod/.test(navigator.userAgent); },
  init() {
    if (!inPreview() && "serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch(() => {});
    window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); this.evt = e; this.render(); });
    window.addEventListener("appinstalled", () => { this.evt = null; this.render(); toast("elMotion을 설치했어요. 홈 화면에서 열 수 있어요."); });
    $("#btnInstall").onclick = () => this.run();
    this.render();
  },
  render() { $("#btnInstall").hidden = this.installed || inPreview(); },
  async run() {
    if (this.evt) { this.evt.prompt(); const r = await this.evt.userChoice; if (r.outcome === "accepted") this.evt = null; this.render(); return; }
    const how = this.ios
      ? "사파리나 크롬에서 공유 버튼(네모에 위쪽 화살표)을 누른 뒤 '홈 화면에 추가'를 고르세요."
      : "크롬 오른쪽 위 ⋮ 메뉴에서 '앱 설치' 또는 '홈 화면에 추가'를 고르세요. 컴퓨터에서는 주소창 오른쪽의 설치 아이콘을 눌러도 돼요.";
    dialog(`<h3>앱으로 설치하기</h3><p>${esc(how)}</p><div class="acts"><button class="solid" id="dOk">확인</button></div>`, (b, close) => { b.querySelector("#dOk").onclick = close; });
  },
};

/* ════════════════════════════════════════════════════════════════
   시작
   ════════════════════════════════════════════════════════════════ */
(async () => {
  theme.apply();
  if (document.fonts) document.fonts.ready.then(() => charts.redrawAll());
  if (theme.mq) theme.mq.addEventListener("change", () => { if (theme.pref === "system") theme.apply(); });
  await store.open();
  settings.init();
  ctl.init();
  nav.init();
  home.render();
  records.render();
  stagger($(".nav")); stagger($("#pHome"));
  installer.init();
  $("#btnImport").onclick = () => $("#fileIn").click();
  addEventListener("resize", () => nav.moveOrb());
  requestAnimationFrame(() => { $("#navOrb").classList.add("ready"); nav.moveOrb(); });
  $("#fileIn").onchange = e => { const f = [...e.target.files]; e.target.value = ""; records.importFiles(f); };
  $("#btnExport").onclick = () => (records.selecting ? nav.back() : records.startSelect("export"));
  $("#btnDelete").onclick = () => (records.selecting ? nav.back() : records.startSelect("delete"));
  const loop = () => { home.tick(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
