/* elMotion · 화면과 동작 */
"use strict";

/* ───────── 상수 ───────── */
const FS = Core.FS;
/* 앱 버전 (2026-11-25 사용자 확정): 0.큰 기능 묶음.고친 횟수 — 웹 앱 확정 때 1.0.0, 안드로이드 앱 때 2.0.0 */
const APP_VERSION = "0.13.17";
const LEGEND = { acc: 1.5, lat: 30, latA: 20, spd: 600 };
const LEGEND_INC = { acc: 1.0, lat: 80, spd: 90 };   // 경사형 게이지 범례 (2026-11-26 사용자 확정): 가감속 1.0 m/s², 흔들림 80 gal, 속력 90 m/min   // 물 높이 범례 (화면에 표시하지 않음). lat: 실시간 p-p, latA: 기록의 |98% 피크|
const CUT = Math.round(Core.P.CUT_SEC * FS);
const CUT_MANUAL = Math.round(0.3 * FS);   // 수동 모드 종료 시 버려지는 마지막 0.3초
const HOLD_MS = 300;                       // 측정 재개: 이만큼 길게 눌러야 한다
const RECAL_N = Math.round(1.0 * FS);      // 재개 전 센서 보정 1초 (2026-11-26)
const LIVE_WIN = FS * 10;

/* ───────── 공통 도구 ───────── */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const p2 = n => String(n).padStart(2, "0");
const fmtDate = ms => { const d = new Date(ms); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]}) ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const fmtDur = s => s >= 60 ? `${Math.floor(s / 60)}분 ${p2(Math.floor(s % 60))}초` : `${s.toFixed(1)}초`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/* 가로 화면 (태블릿 등): 가로가 세로보다 길고 충분히 넓으면 가로 전용 배치 */
const WIDE_MQ = window.matchMedia ? matchMedia("(orientation: landscape) and (min-width: 820px) and (min-height: 400px)") : null;
const isWide = () => !!(WIDE_MQ && WIDE_MQ.matches);
document.documentElement.classList.toggle("wide", isWide());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ICON = {
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="13" height="14" rx="2.5"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.6L19.5 9l-5.7 1.6L12 16l-1.8-5.4L4.5 9l5.7-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" opacity=".6"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5v.1c-4.6.6-6.9 2.9-7.5 7.5h-.1c-.6-4.6-2.9-6.9-7.5-7.5V10c4.6-.6 6.9-2.9 7.5-7.5z"/></svg>',
  // AI 평가 칩의 별: 별 모양에 꼭 맞춘 틀 (틀의 가운데 = 별의 가운데 → 옆 글자 가운데와 맞춘다)
  aiStar: '<svg class="ai-star" viewBox="4.5 2.5 15 15.1" fill="currentColor"><path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5v.1c-4.6.6-6.9 2.9-7.5 7.5h-.1c-.6-4.6-2.9-6.9-7.5-7.5V10c4.6-.6 6.9-2.9 7.5-7.5z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 001.5.9l10.4-6.5a1 1 0 000-1.8L9.5 4.6A1 1 0 008 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.4"/><rect x="13.5" y="5" width="4" height="14" rx="1.4"/></svg>',
  reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 11-2.34-5.66"/><path d="M20 4v5h-5"/></svg>',
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
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = r === "dark" ? "#0A0E1B" : "#E9EDF5";
    document.querySelectorAll("#themeOpts .theme-opt").forEach(b => b.classList.toggle("on", b.dataset.theme === this.pref));
    charts.redrawAll();
  },
  set(p) { prefs.set("theme", p); this.apply(); },
};
const cssVar = n => (window.__cssOverride && window.__cssOverride[n]) || getComputedStyle(document.documentElement).getPropertyValue(n).trim();   // 영상 만들기 때 다크 색을 빌려 씀

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
    deco.watch(this.el);
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
/* ───────── 경사형 게이지: 꼭짓점이 둥근 직각삼각형 유리 (직각 = 왼쪽 아래)
   2026-11-26 사용자 확정: 처음 시안의 디자인(반투명 유리 + 흰 테두리)으로, 꼭짓점은 더 둥글게.
   왼쪽 변 = 수직, 아래 변 = 앞뒤, (속력만) 빗변 = 경사 방향. 단위는 오른쪽 아래에 작게. 물은 원형 게이지와 같은 색 */
/* 성능 ③ (2026-11-26): 장식 애니메이션은 화면에 보일 때만, 스크롤 중에는 멈춘다 */
const deco = {
  io: typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(es => es.forEach(e => { if (!e.target.isConnected) { deco.io.unobserve(e.target); return; } e.target.classList.toggle("off", !e.isIntersecting); })) : null,
  watch(el) { if (this.io && el) this.io.observe(el); return el; },
  init() {
    let t = 0; const root = document.documentElement;
    document.addEventListener("scroll", () => { if (!t) root.classList.add("scrolling"); clearTimeout(t); t = setTimeout(() => { t = 0; root.classList.remove("scrolling"); }, 180); }, { capture: true, passive: true });
  },
};
deco.init();
let TRI = 0;
class TriGauge {
  static path(r = 24) {
    const P = [[14, 14], [14, 186], [186, 186]];
    const pt = (a, b, d) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); return [a[0] + dx / L * d, a[1] + dy / L * d]; };
    let d = "";
    for (let i = 0; i < 3; i++) {
      const p = P[i], R = r * (i === 1 ? 1 : 1.35), a = pt(p, P[(i + 2) % 3], R), b = pt(p, P[(i + 1) % 3], R);
      d += `${i ? "L" : "M"}${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${p[0]} ${p[1]} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    }
    return d + "Z";
  }
  /** 유리 삼각형 SVG (실시간 게이지·기록 목록 공용) */
  static svg(id, d) {
    const G = c => `<image class="${c}" href="assets/glass-tri${c.endsWith("d") ? "-dark" : ""}.webp" x="14" y="14" width="172" height="172"/>`;
    return `<svg viewBox="0 0 200 200" class="tri-svg" aria-hidden="true"><defs>
      <radialGradient id="gw${id}" cx="25%" cy="70%" r="95%"><stop offset="0" style="stop-color:var(--wl)"/><stop offset=".55" style="stop-color:var(--wm)"/><stop offset="1" style="stop-color:var(--wd)"/></radialGradient>
      <mask id="s${id}"><image href="assets/glass-tri-sil.webp" x="14" y="14" width="172" height="172"/></mask>
      <mask id="m${id}"><rect width="200" height="200" fill="#000"/><g class="water" style="transform:translateY(200px)"><path class="w1" d="${WAVE}" fill="#fff"/></g></mask></defs>
      ${G("tg-l")}${G("tg-d")}
      <g mask="url(#s${id})"><g class="tg-w"><rect width="200" height="200" fill="url(#gw${id})" mask="url(#m${id})"/></g>
        <g class="water" style="transform:translateY(200px)"><path class="wl" d="${WAVE_LINE}" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1.4"/></g></g>
      ${G("tg-l tg-top")}${G("tg-d tg-top")}</svg>`;
  }
  constructor(kind, size, unit) {
    const id = "tg" + ++TRI, d = TriGauge.path();
    this.el = document.createElement("div"); this.el.className = `tri k-${kind}`; this.el.style.cssText = `--d:${size}px`;
    this.el.innerHTML = TriGauge.svg(id, d) + `
      <div class="tri-v"><b></b><i>${kind === "lat" ? "앞뒤" : "수직"}</i></div><div class="tri-h"><b></b><i>${kind === "lat" ? "좌우" : "앞뒤"}</i></div>${kind === "spd" ? `<div class="tri-s"><b></b><i>경사 방향</i></div>` : ""}<div class="tri-u">${unit || ""}</div>`;
    this.waters = [...this.el.querySelectorAll(".water")];
    this.vb = this.el.querySelector(".tri-v b"); this.hb = this.el.querySelector(".tri-h b"); this.sb = this.el.querySelector(".tri-s b");
    deco.watch(this.el);
    this.lv = -1;
  }
  /** 0~1: 바닥(186)에서 꼭대기(14)까지 */
  level(v) {
    v = clamp(v, 0, 1); if (Math.abs(v - this.lv) < 0.002) return this;
    this.lv = v;
    const shown = v <= 0 ? -0.05 : Math.max(v, 0.045);
    const t = `translateY(${186 - shown * 172 - 6}px)`;
    this.waters.forEach(w => { w.style.transform = t; }); return this;
  }
  /** 수직 · 앞뒤 · (속력) 경사 방향 */
  vals(vert, fore, along) {
    if (vert != null) this.vb.textContent = vert; if (fore != null) this.hb.textContent = fore;
    if (along != null && this.sb) this.sb.textContent = along; return this;
  }
}

/** 기록 목록용 작은 삼각형 게이지: 물 높이는 고정 (2026-11-26) */
function triMini(kind, v, inner) {
  const id = "tm" + ++TRI, lv = clamp(v, 0, 1), y = 186 - (lv <= 0 ? -0.05 : Math.max(lv, 0.045)) * 172 - 6;
  return `<div class="mini-tri tri k-${kind}" style="--d:70px">${TriGauge.svg(id, TriGauge.path()).replace(/translateY\(200px\)/g, `translateY(${y.toFixed(1)}px)`)}${inner}</div>`;
}

const charts = {
  set: new Set(),
  redrawAll() { this.set.forEach(c => { if (c.c.isConnected) c.draw(); else c.destroy(); }); },
  clear(root) { this.set.forEach(c => { if (!root || root.contains(c.c) || !c.c.isConnected) { c.destroy(); } }); },
};
class Chart {
  /** o: {values, rate, color, half, dec, unit, animate, tap, window, offset} */
  constructor(canvas, o) {
    this.c = canvas; this.o = o; this.g = canvas.getContext("2d");
    this.prog = o.animate ? 0 : 1; this.cursor = -1;
    charts.set.add(this);
    this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(canvas);
    // 오래 두거나 백그라운드에 다녀오면 브라우저가 캔버스를 비울 수 있다 → 되살아나면 다시 그린다
    canvas.addEventListener("contextrestored", () => this.draw());
    // 화면 근처에 올 때까지 그리지 않는다 (2026-11-27): 기록 상세를 열 때 그래프 10여 개를 한꺼번에 그리느라 멈칫하던 것을 줄임
    if (o.lazy && typeof IntersectionObserver !== "undefined") {
      this.lazy = true;
      const lz = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { lz.disconnect(); Chart.enqueue(this); } }, { rootMargin: "700px 0px" });
      lz.observe(canvas);
    }
    if (o.animate) {
      this.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { this.io.disconnect(); this.play(); } }, { threshold: 0.3 });
      this.io.observe(canvas);
    }
    if (o.tap) this.bindTap();
  }
  /** 늦게 그리는 그래프는 한 프레임에 하나씩 그린다 (한꺼번에 그리면 그 순간 화면이 멈칫한다) */
  static enqueue(ch) {
    (Chart.q = Chart.q || []).push(ch);
    if (Chart.pumping) return; Chart.pumping = true;
    const pump = () => {
      const c = Chart.q.shift();
      if (c) { c.lazy = false; if (c.c.isConnected) c.draw(); }
      if (Chart.q.length) requestAnimationFrame(pump); else Chart.pumping = false;
    };
    requestAnimationFrame(pump);
  }
  /** 그리는 범위 [처음, 끝] (표본 번호) */
  range() { const n = (this.o.values || []).length; return [0, Math.max(n - 1, 1)]; }
  /** 등장 애니메이션 (2026-11-26 최적화): 매 프레임 그래프 전체를 다시 그리지 않는다.
      바탕(축·격자)과 완성 그래프를 한 번씩 그려 두고, 완성본을 왼쪽부터 잘라 붙이기만 한다 */
  play() {
    const c = this.c, W = c.clientWidth; if (!W) { this.prog = 1; return; }
    const snap = () => { const k = document.createElement("canvas"); k.width = c.width; k.height = c.height; k.getContext("2d").drawImage(c, 0, 0); return k; };
    this.prog = 0; this.draw(); const bg = snap();
    this.prog = 1; this.noMarks = true; this.draw(); this.noMarks = false; const full = snap();
    const t0 = performance.now(), dur = 1100, sx = c.width / W, L = 44, pw = W - 12 - L;
    this.prog = 0;
    const step = now => {
      if (!c.isConnected) return;
      const p = clamp((now - t0) / dur, 0, 1);
      if (p >= 1 || c.width !== full.width || c.height !== full.height) { this.prog = 1; this.draw(); return; }
      const g = this.g, cut = Math.round((L + pw * p + 1) * sx);
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
      g.drawImage(bg, 0, 0); g.drawImage(full, 0, 0, cut, c.height, 0, 0, cut, c.height);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  setValues(v, offset) { this.o.values = v; this.o.offset = offset; this.draw(); }
  /** 그래프 위를 누르거나 밀면 그 위치의 시간·값을 계속 보여 준다 */
  bindTap() {
    let active = false;
    const pick = e => {
      const r = this.c.getBoundingClientRect(), x = e.clientX - r.left, L = 44, R = r.width - 12;
      const n = this.o.values.length; if (n < 2) return;
      const [a, b] = this.range();
      const i = clamp(Math.round(a + (x - L) / (R - L) * (b - a)), 0, n - 1);
      if (i !== this.cursor) { this.cursor = i; this.draw(); }
    };
    this.c.addEventListener("pointerdown", e => { active = true; pick(e); });
    this.c.addEventListener("pointermove", e => { if (active || e.pointerType === "mouse") pick(e); });
    const end = () => { active = false; };
    this.c.addEventListener("pointerup", end); this.c.addEventListener("pointercancel", end);
  }
  draw() {
    if (this.lazy) return;
    const c = this.c, W = c.clientWidth, H = c.clientHeight; if (!W || !H) return;
    // 화면 그래프는 2배 해상도까지만 (3배면 그리는 데 두 배 가까이 걸린다). 영상용(hiRes)은 기기 해상도 그대로
    const dpr = this.o.hiRes ? (window.devicePixelRatio || 1) : Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const o = this.o, v = o.values || [], n = v.length, rate = o.rate || FS;
    const L = 44, R = W - 12, T = 12, B = H - 22, pw = R - L, ph = B - T;
    const [va, vb] = o.window ? [0, Math.max(o.window - 1, 1)] : this.range();
    const span = Math.max(vb - va, 1), ia = Math.max(0, Math.floor(va)), ib = Math.min(n - 1, Math.ceil(vb));
    let mx = 0; for (let i = ia; i <= ib; i++) { const a = Math.abs(v[i]); if (a > mx && !Number.isNaN(a)) mx = a; }
    const half = Math.max(o.half, mx * 1.12);
    const y = val => T + (1 - (val + half) / (2 * half)) * ph, x = i => L + (i - va) / span * pw;
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
    const off = o.offset || 0, t0 = off + (o.window ? 0 : va / rate), t1 = t0 + span / rate, st = niceStep(t1 - t0);
    g.textAlign = "center"; g.textBaseline = "top"; g.fillStyle = ink3;
    for (let t = Math.ceil(t0 / st) * st; t <= t1 + 1e-6; t += st) {
      const px = L + (t - t0) / (t1 - t0) * pw;
      g.fillText(`${+t.toFixed(st < 0.1 ? 2 : 1)}s`, clamp(px, L + 8, R - 8), B + 6);
    }
    if (n < 2) return;
    // 평가 구간(정속 주행) 옅게 표시
    const inSpan = i => !o.spans || o.spans.some(([a, b]) => i >= a * rate && i <= b * rate);
    if (o.spans) {
      g.fillStyle = hexA(o.color, .09);
      for (const [a, b] of o.spans) {
        const xa = Math.max(L, x(Math.round(a * rate))), xb = Math.min(R, x(Math.round(b * rate)));
        if (xb > xa) g.fillRect(xa, T, Math.max(1, xb - xa), ph);
      }
    }
    // 선 (점이 많으면 픽셀 열마다 최소/최대)
    const upto = o.window ? n - 1 : Math.min(ib, Math.floor(ia + (ib - ia) * this.prog));
    g.save(); g.beginPath(); g.rect(L, T - 2, pw * (o.window ? 1 : this.prog) + 1, ph + 4); g.clip();
    const path = new Path2D();
    const step = Math.max(1, Math.floor((ib - ia + 1) / (pw * 1.2)));
    let first = true, lastX = L;
    const from = o.window ? 0 : Math.max(0, ia - 1);
    if (step <= 1) {
      for (let i = from; i <= Math.min(n - 1, upto + 1); i++) { if (Number.isNaN(v[i])) continue; const px = x(i), py = y(v[i]); if (first) { path.moveTo(px, py); first = false; } else path.lineTo(px, py); lastX = px; }
    } else {
      for (let i = from; i <= upto; i += step) {
        let lo = Infinity, hi = -Infinity;
        for (let k = i; k < Math.min(n, i + step); k++) { if (v[k] < lo) lo = v[k]; if (v[k] > hi) hi = v[k]; }
        if (!isFinite(lo)) continue;
        const px = x(i); if (first) { path.moveTo(px, y(hi)); first = false; } else path.lineTo(px, y(hi)); path.lineTo(px, y(lo)); lastX = px;
      }
    }
    // 면 채우기
    const area = new Path2D(path); area.lineTo(lastX, y(0)); area.lineTo(Math.max(L, x(from)), y(0)); area.closePath();
    const grad = g.createLinearGradient(0, T, 0, B); grad.addColorStop(0, hexA(o.color, .28)); grad.addColorStop(.5, hexA(o.color, .04)); grad.addColorStop(1, hexA(o.color, .28));
    g.fillStyle = grad; g.fill(area);
    g.strokeStyle = o.color; g.lineWidth = 1.8; g.lineJoin = "round"; g.stroke(path);
    g.restore();
    // 일시정지 지점: 점선 + 작은 일시정지 표시
    if (o.pauses && o.pauses.length) {
      const c3 = cssVar("--ink-3");
      for (const t of o.pauses) {
        const i = Math.round((t - off) * rate); if (i < va || i > vb) continue;
        const px = Math.round(x(i)) + .5;
        g.strokeStyle = c3; g.lineWidth = 1; g.globalAlpha = .9; g.setLineDash([2, 3]);
        g.beginPath(); g.moveTo(px, T + 12); g.lineTo(px, B); g.stroke(); g.setLineDash([]);
        g.fillStyle = c3; g.fillRect(px - 4, T, 3, 9); g.fillRect(px + 1, T, 3, 9); g.globalAlpha = 1;
      }
    }
    // 끝점 강조 (실시간)
    if (o.window && n) { const px = x(n - 1), py = y(v[n - 1]); g.fillStyle = o.color; g.beginPath(); g.arc(px, py, 3.5, 0, 7); g.fill(); }
    // 최고·최저 표시 (기록 그래프): 점 + 세로 지시선 + 값
    if (o.marks && n > 1 && this.prog >= 1 && !this.noMarks) {
      let hi = 0, lo = 0;
      hi = lo = -1;
      for (let i = ia; i <= ib; i++) { if (!inSpan(i) || Number.isNaN(v[i])) continue; if (hi < 0 || v[i] > v[hi]) hi = i; if (lo < 0 || v[i] < v[lo]) lo = i; }
      if (hi < 0) hi = lo = -1;            // 확대한 범위에 평가 구간이 없으면 표시하지 않음
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
      if (hi < 0) { /* 표시할 값 없음 */ }
      else if (o.marks === "peak") {     // 속력: 방향별 최고 속력만 (3 m/min 미만은 표시 안 함)
        if (v[hi] >= 3) mark(hi, true);
        if (v[lo] <= -3) mark(lo, false);
      } else { mark(hi, true); mark(lo, false); }
    }
    // 탭한 지점
    if (this.cursor >= ia && this.cursor <= ib && this.cursor < n && this.prog >= 1) {
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

const LIVE_MS = { chart: 1000 / 30, acc: 1000 / 15, spd: 1000 / 30, lat: 2000, dacc: 1000 / 15, dspd: 1000 / 30, dlat: 2000 };
const SERIES = [
  { key: "acc", title: "가감속도", unit: "m/s²", dec: 2, half: 1.5, color: "#2C46BE" },
  { key: "jerk", title: "저크", unit: "m/s³", dec: 2, half: 1.0, color: "#D07A1F" },
  { key: "vibV", title: "상하 흔들림", unit: "gal", dec: 1, half: 30, color: "#1C8FA3" },
  { key: "vibL", title: "좌우 흔들림", unit: "gal", dec: 1, half: 30, color: "#94416A" },
  { key: "speed", title: "속력", unit: "m/min", dec: 1, half: 150, color: "#5D4A92" },
];
/* 경사형 기록의 앞뒤 그래프 (2026-11-26) */
const SERIES_INC = [
  { key: "fa", title: "앞뒤 가감속도", unit: "m/s²", dec: 2, half: 1.5, color: "#3B5BDB" },
  { key: "vibF", title: "앞뒤 흔들림", unit: "gal", dec: 1, half: 30, color: "#B05C86" },
  { key: "speedF", title: "앞뒤 속력", unit: "m/min", dec: 1, half: 150, color: "#6A4FB0" },
];

/* ───────── 기록 저장소 (IndexedDB) ───────── */
const cache = new Map();
/** 경사형: 글 한 문장을 무조건 한 줄로 — 칸에 안 들어가면 글자를 줄인다 */
function fitLines(root) {
  root.querySelectorAll(".incl-rows .ev b, .incl-rows .ev p").forEach(el => {
    el.style.whiteSpace = el.tagName === "P" ? "pre" : "nowrap"; el.style.fontSize = "";
    const box = el.parentElement, base = parseFloat(getComputedStyle(el).fontSize);
    let f = base; while (el.scrollWidth > box.clientWidth + 0.5 && f > base * 0.5) { f -= 0.5; el.style.fontSize = f + "px"; }
  });
}
function analysisOf(rec) {
  // 가속도 센서만으로 계산 (출발 직전 영점 + 전체 적분 + 정지 시점 되짚기)
  const k = rec.id + ":" + rec.vert.length + ":" + (rec.segs ? rec.segs.join(".") : "");
  if (!cache.has(k)) {
    const A = Core.analyze(rec.vert, rec.lat, rec.rate, rec.segs, rec.lon);
    cache.set(k, A);
  }
  return cache.get(k);
}
/** 유리 이미지 지킴이: 못 불러오면 CSS로 그린 유리로 바꿔 두고, 다시 불러와지면 원래 이미지로 되돌린다 */
const glassGuard = {
  n: 0, keep: [], timer: null,
  check() {
    clearTimeout(this.timer);
    const files = { "--glass-light": "assets/glass.webp", "--glass-dark": "assets/glass-dark.webp" };
    const q = this.n ? "?r=" + this.n : "";
    const jobs = Object.entries(files).map(([v, f]) => new Promise(ok => {
      const im = new Image(); im.onload = () => ok([v, f + q, true]); im.onerror = () => ok([v, f + q, false]); im.src = f + q;
    }));
    Promise.all(jobs).then(rs => {
      const root = document.documentElement;
      if (rs.every(r => r[2])) {
        if (this.n) for (const [v, u] of rs) root.style.setProperty(v, `url("${u}")`);   // 실패를 기억한 주소 대신 새 주소로
        root.classList.remove("no-glass");
        this.keep = rs;
      } else {
        root.classList.add("no-glass");
        this.n++;
        this.timer = setTimeout(() => this.check(), 8000);
      }
    });
  },
};
addEventListener("online", () => document.documentElement.classList.contains("no-glass") && glassGuard.check());

/** 목록 한줄평: 맨 앞 한 문장만 ("우당탕탕!"은 다음 문장과 함께) */
function firstSentence(t) {
  const m = String(t || "").match(/^(우당탕탕!\s*)?[^.!?]*[.!?]/);
  return m ? m[0].trim() : String(t || "");
}
function metaOf(rec) {
  const m = analysisOf(rec).m;
  return {
    id: rec.id, name: rec.name || "", startedAt: rec.startedAt, duration: m.duration, demo: !!rec.demo, imported: !!rec.imported, hasLat: !!rec.lat,
    accPeak: m.accPeak, accMax: m.accMax, decMax: m.decMax, latP98: m.vibL ? m.vibL.p98 : null, speedMax: m.speedMax, overall: m.eval.overall, updatedAt: rec.updatedAt || Date.now(), evalVer: Core.EVAL_VER, srcKey: rec.srcKey || null,
    // 경사형: 목록의 삼각형 게이지용 앞뒤 방향 값 (2026-11-26)
    incl: m.incl ? { accMax: m.incl.accMax, decMax: m.incl.decMax, lat: m.incl.vibF && m.incl.vibF.n ? m.incl.vibF.p98 : null, speedMax: m.incl.speedMax } : null,
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
  async put(rec, opt) {
    rec.updatedAt = rec.updatedAt || Date.now();
    const meta = metaOf(rec);
    if (!this.db) this.mem.set(rec.id, { rec, meta });
    else {
      await this.req("rides", "readwrite", s => s.put(rec));
      await this.req("meta", "readwrite", s => s.put(meta));
    }
    if (!(opt && opt.quiet) && typeof gsync !== "undefined") gsync.touched(rec.id, false);   // 기기 연동 (2026-11-25)
  },
  async list() {
    let a = this.db ? await this.req("meta", "readonly", s => s.getAll()) : [...this.mem.values()].map(v => v.meta);
    a = a || [];
    // 평가 기준이 바뀌었으면 저장된 요약을 새 기준으로 다시 만든다
    for (let i = 0; i < a.length; i++) {
      if (a[i].evalVer === Core.EVAL_VER) continue;
      const rec = await this.get(a[i].id);
      if (rec) { await this.put(rec, { quiet: true }); a[i] = metaOf(rec); }
    }
    return a.sort((x, y) => y.startedAt - x.startedAt);
  },
  async get(id) {
    if (!this.db) { const m = this.mem.get(id); return m ? m.rec : null; }
    return (await this.req("rides", "readonly", s => s.get(id))) || null;
  },
  async del(id, opt) {
    if (!this.db) this.mem.delete(id);
    else {
      await this.req("rides", "readwrite", s => s.delete(id));
      await this.req("meta", "readwrite", s => s.delete(id));
    }
    if (!(opt && opt.quiet) && typeof gsync !== "undefined") gsync.touched(id, true);        // 다른 기기에서도 지움
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
  phase: "run",           // measure 안에서: run | pause(일시정지) | calib(재개 전 0.5초 보정)
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
  /** incline: 경사형 엘리베이터 데모 (설정 → 데모 측정, 2026-11-26) */
  async startDemo(incline) {
    if (this.state === "measure") { toast("측정 중에는 데모를 시작할 수 없어요."); return; }
    // 경사형 데모는 실측 기록(경사형 상행 Up2, 2026-11-26)을 재생. 못 읽으면 합성 신호로
    let rec = null;
    if (incline) {
      try { rec = await (this.inclRec || (this.inclRec = fetch("assets/demo-incline.txt").then(r => (r.ok ? r.text() : Promise.reject())).then(t => { const s = atob(t.trim()), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Int16Array(u.buffer); }))); }
      catch (e) { this.inclRec = null; }
      if (this.state === "measure") return;
    }
    this.stopDemo();
    this.res.reset(); this.stab.reset(); this.needDisturb = false;
    const sig = new Core.DemoSignal({ incline, rec }), t0 = performance.now();
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
    if (this.state === "measure") {
      if (this.phase === "run") return this.onMeasure(x, y, z);
      if (this.phase === "calib") return this.onRecal(x, y, z);
      return;                                    // 일시정지 중에는 기록하지 않음
    }
    const jumps = this.stab.jumps;
    const r = this.stab.push(x, y, z);
    if (this.stab.jumps !== jumps) this.needDisturb = false;     // 한 번 움직였으면 다시 자동 시작 가능
    const p = this.armed ? r.progress : 0;
    if (Math.abs(p - this.progress) > 0.01) { this.progress = p; this.dirty = true; }
    if (this.armed && r.cal) this.begin(r.cal);
  },
  begin(cal) {
    this.state = "measure"; this.phase = "run"; this.cal = cal; this.progress = 0;
    this.segs = [0]; this.distOff = 0;
    this.abn = this.mode === "auto" ? new Core.AbnormalDetector(cal, FS) : null;
    this.an = new Core.RideAnalyzer(FS);
    this.vert = []; this.lat = []; this.lon = [];
    this.live = { acc: [], jerk: [], vibV: [], vibL: [], speed: [] };
    this.o = null; this.startedAt = Date.now();
    this.inclReset(true);
    this.lockScreen();
    home.render();
  },
  onMeasure(x, y, z) {
    if (this.abn) { const why = this.abn.push(x, y, z); if (why) return this.stop("abnormal"); }
    const [v, l, h] = this.cal.project(x, y, z);
    this.vert.push(v); this.lat.push(l); this.lon.push(h);
    const o = this.an.push(v, l);
    // 경사형 엘리베이터: 가감속마다 3축 방향을 보고 감지·경사각 변화 판단, 감지 뒤에는 앞뒤 축을 따로 잰다
    const ev = this.idet.push(v, l, h, this.an.v);
    if (ev) this.onIncl(ev);
    // 추정 경사각은 1초에 한 번 알약·게이지에 (2026-11-26 사용자 확정)
    if (this.incl && this.idet.est != null && this.vert.length % FS === 0) {
      const d = Math.round(this.idet.est);
      if (d !== this.incl.deg) { this.incl.theta = this.idet.est; this.incl.deg = d; const ip = $("#inclPill"); if (ip) ip.textContent = `경사 ${d}°`; }
    }
    if (this.incl && this.idet.u) { const b = this.idet.b, u = this.idet.u; this.of = this.cF.push((l - b[1]) * u[0] + (h - b[2]) * u[1]); this.ol = this.cL.push(-(l - b[1]) * u[1] + (h - b[2]) * u[0]); }
    const L = this.live;
    L.acc.push(o.acc); L.jerk.push(o.jerk); L.vibV.push(o.vibV); L.vibL.push(o.vibL); L.speed.push(o.speed);
    if (L.acc.length > LIVE_WIN * 2) for (const k in L) L[k].splice(0, LIVE_WIN);
    this.o = o;
    if (this.vert.length % 4 === 0) this.dirty = true;
  },
  /** 일시정지: 0.3초 이상 눌렀다 떼면 멈추고, 버튼을 누르기 시작한 때(at)의 0.2초 전까지만 남긴다 */
  pause(at) {
    if (this.state !== "measure" || this.phase !== "run") return;
    const s0 = this.segs[this.segs.length - 1];
    const from = at == null ? this.vert.length : Math.min(at, this.vert.length);
    const n = Math.max(s0, from - CUT), drop = this.vert.length - n;
    this.vert.length = n; this.lat.length = n; this.lon.length = n;
    for (const k in this.live) this.live[k].splice(Math.max(0, this.live[k].length - drop), drop);
    if (n === s0 && this.segs.length > 1) this.segs.pop();     // 재개하자마자 멈췄으면 빈 구간은 없앤다
    this.phase = "pause";
    this.unlockScreen();
    try { navigator.vibrate && navigator.vibrate(30); } catch (e) { /* 무시 */ }
    home.render();
  },
  /** 리셋 (2026-11-25, 2026-11-26 언제나): 0.3초 이상 눌렀다 떼면, 지금까지 잰 것을 버리고 1초 보정 뒤 처음부터 다시 잰다 (경사형 판정도 처음부터) */
  reset() {
    if (this.state !== "measure" || this.phase !== "run") return;
    this.vert = []; this.lat = []; this.lon = []; this.segs = [0]; this.distOff = 0; this.inclReset(true);
    this.live = { acc: [], jerk: [], vibV: [], vibL: [], speed: [] };
    this.o = null; this.startedAt = Date.now();
    this.phase = "calib"; this.rb = []; this.recalP = 0;     // 재개와 같은 0.5초 보정 → 새 분석기로 시작
    try { navigator.vibrate && navigator.vibrate(30); } catch (e) { /* 무시 */ }
    home.render();
    toast("처음부터 다시 측정해요.");
  },
  /** 측정 재개 버튼을 0.3초 이상 눌렀다 떼면: 0.5초 센서 보정 → 바로 재개 */
  recalibrate() {
    if (this.state !== "measure" || this.phase !== "pause") return;
    this.phase = "calib"; this.rb = []; this.recalP = 0;
    this.lockScreen();
    home.render();
  },
  onRecal(x, y, z) {
    const b = this.rb; b.push([x, y, z]);
    if (b.length >= 3) {     // 크게 움직이면(손에 든 상태) 보정을 처음부터
      const m0 = b[0], d = Math.hypot(x - m0[0], y - m0[1], z - m0[2]);
      if (d > Core.P.STABLE_JUMP * 3) { this.rb = [[x, y, z]]; }
    }
    this.recalP = this.rb.length / RECAL_N; this.dirty = true;
    if (this.rb.length < RECAL_N) return;
    const m = [0, 0, 0]; for (const p of this.rb) for (let i = 0; i < 3; i++) m[i] += p[i] / this.rb.length;
    this.cal = new Core.Calibration(m[0], m[1], m[2]);
    this.abn = this.mode === "auto" ? new Core.AbnormalDetector(this.cal, FS) : null;
    this.distOff += this.o ? this.o.dist : 0;
    this.an = new Core.RideAnalyzer(FS); this.o = null;
    this.inclReset(false);                       // 새 보정 = 새 수평 축: 앞뒤 방향은 다시 찾고, 경사각은 이어서 비교
    if (this.vert.length > this.segs[this.segs.length - 1]) this.segs.push(this.vert.length);
    this.phase = "run"; this.rb = null;
    home.render();
  },
  async stop(reason) {
    if (this.state !== "measure") { this.state = "idle"; this.progress = 0; home.render(); return; }
    const wasRun = this.phase === "run";
    this.state = "idle"; this.phase = "run"; this.needDisturb = true; this.progress = 0;
    this.unlockScreen();
    const demo = !!this.demo; this.stopDemo();
    // 비정상 흔들림: 감지 0.2초 전까지 / 수동 모드에서 버튼으로 끝낼 때: 버튼을 누르며 생긴 흔들림을 빼려고 0.3초 전까지
    // 일시정지 중에 끝내면 이미 잘라 두었으니 더 자르지 않는다
    const cut = !wasRun ? 0 : reason === "abnormal" ? CUT : this.mode === "manual" ? CUT_MANUAL : 0;
    const n = Math.max(0, this.vert.length - cut);
    const segs = this.segs.filter(s => s < n);
    home.render();
    if (n < FS) { toast("측정 시간이 너무 짧아 저장하지 않았어요."); return; }
    if (reason === "abnormal") { toast("비정상적인 흔들림이 감지되어 측정을 종료했어요.", 4200); try { navigator.vibrate && navigator.vibrate(60); } catch (e) { /* 무시 */ } }
    const rec = { id: `ride_${this.startedAt}_${Math.random().toString(36).slice(2, 6)}`, name: demo ? "데모 측정" : "", startedAt: this.startedAt, rate: FS, demo,
      vert: Float32Array.from(this.vert.slice(0, n)), lat: Float32Array.from(this.lat.slice(0, n)), lon: Float32Array.from(this.lon.slice(0, n)), updatedAt: Date.now() };
    if (segs.length > 1) rec.segs = segs;
    try { await store.put(rec); } catch (e) { toast("기록을 저장하지 못했어요."); }
    records.render();
    detail.open(rec, "home");
  },
  async lockScreen() { try { if ("wakeLock" in navigator) this.wake = await navigator.wakeLock.request("screen"); } catch (e) { this.wake = null; } },
  unlockScreen() { try { this.wake && this.wake.release(); } catch (e) { /* 무시 */ } this.wake = null; },
  /** all: 새 측정(경사형 여부부터 다시) / 아니면 재개(경사각은 유지, 앞뒤 방향만 다시 찾기) */
  inclReset(all) {
    if (all) this.incl = null;
    this.idet = new Core.InclineDetector(FS, this.incl ? this.incl.theta : null);
    this.cF = new Core.AxisChannel(FS); this.cL = new Core.AxisChannel(FS, Core.P.LAT_HP); this.of = null; this.ol = null;
  },
  /** 경사형 감지 / 경사각 변화 (2026-11-26 사용자 확정): 반올림한 각도로 2도 이상 달라지면 변화 */
  onIncl(ev) {
    const t = Math.round(ev.theta);
    if (!this.incl) { this.incl = { theta: ev.theta, deg: t, msg: { kind: "detect", at: performance.now() } }; home.render(); }
    else if (ev.type === "change") {
      this.incl.msg = { kind: "change", from: Math.round(ev.from), to: t, at: performance.now() };
      this.incl.theta = ev.theta; this.incl.deg = t; home.inclMsg();
    }
    try { navigator.vibrate && navigator.vibrate(20); } catch (e) { /* 무시 */ }
  },
};

/* ════════════════════════════════════════════════════════════════
   홈
   ════════════════════════════════════════════════════════════════ */
const home = {
  detail: false, layout: "",
  render() {
    const st = ctl.state, measuring = st === "measure";
    const want = measuring ? (this.detail ? "live-detail" : ctl.incl ? "live-incl" : "live-simple") : "single";
    $("#livePill").hidden = !measuring;
    const ip = $("#inclPill"); ip.hidden = !(measuring && ctl.incl); if (!ip.hidden) ip.textContent = `경사 ${ctl.incl.deg}°`;
    const held = measuring && ctl.phase !== "run";
    $("#livePill").classList.toggle("paused", held);
    if (want !== this.layout) {
      // 보정이 끝나 측정이 시작되면: 엘리베이터 문이 닫히고 사라진 뒤 게이지로 바꾼다
      if (this.layout === "single" && want !== "single" && this.lift && !this.leaving) {
        this.leaving = true;
        const sg = $("#homeBody .single"), lf = this.lift;
        if (sg) sg.classList.add("leaving");
        lf.style.setProperty("--o", 0);                                  // 보정 끝: 문이 다 닫힘
        setTimeout(() => lf.classList.add("gone"), 260);
        setTimeout(() => { this.leaving = false; this.lift = null; this.render(); }, 660);
        return;
      }
      if (this.leaving) return;
      this.layout = want; this.build(want);
    }
    $("#homeBody").classList.toggle("paused", held);
    this.updateSingle();
    this.renderActions();
    ctl.dirty = true;
  },
  build(kind) {
    const body = $("#homeBody"); charts.clear(body); body.innerHTML = "";
    this.big = this.trip = this.lift = this.tris = null; this.liftOpen = false; clearTimeout(this.msgT); this.liveCharts = []; this.liveAt = {};
    if (kind === "single") {
      // 측정 대기·안정화: 원형 게이지 없이 글자만 화면 한가운데에 (2026-11-25 사용자 요청)
      body.innerHTML = `<div class="single fade-in"><div class="cap-wrap" id="capWrap"><div class="lift" id="lift"><img src="assets/lift-frame.webp" alt=""><div class="clip"><img class="dl" src="assets/lift-leafL.webp" alt=""><img class="dr" src="assets/lift-leafR.webp" alt=""></div></div><div class="caption" id="cap"></div><div class="sub" id="capSub"></div><div id="capBtns" class="home-actions"></div></div></div>`;
      this.big = true; this.capDy = 0; this.lift = $("#lift");
      // 들어오면 문이 천천히 열리고, 그 뒤로는 보정 진행률만큼 닫힌다 (2026-11-26)
      this.lift.classList.add("slow");
      setTimeout(() => { if (this.lift) { this.liftOpen = true; this.updateSingle(); } }, 260);
      setTimeout(() => this.lift && this.lift.classList.remove("slow"), 900);
      requestAnimationFrame(() => this.centerCaption());
    } else if (kind === "live-incl") {
      // 경사형 (2026-11-26 사용자 확정): 게이지를 모두 지우고 직각삼각형 게이지 3개. 세로 화면은 위아래로, 가로 화면은 옆으로 나란히
      const wide = isWide();
      // 2026-11-26: 경사형 게이지는 예전보다 1.3배 (화면에 다 들어가는 만큼까지)
      //  세로: 제목을 게이지 오른쪽 위 빈자리에 얹어 세로 공간을 아낀다 / 가로: 왼쪽 숫자를 앞 게이지의 빗변 옆 빈자리에 겹쳐 놓는다
      const old = wide ? clamp(Math.min(innerHeight - 300, (innerWidth - 220) / 3.9), 130, 300) : clamp((innerHeight - 60 - 70 - 110 - 3 * 76) / 3, 96, 170);
      const fit = wide ? Math.min((innerWidth - 60) / 3.97, innerHeight - 380) : Math.min((innerHeight - 250 - 3 * 34) / 3, innerWidth - 24 - 112 - 46);
      const size = Math.round(Math.max(90, Math.min(old * 1.3, fit)));
      body.innerHTML = `<div class="incl ${wide ? "row" : ""}" style="--d:${size}px"><div class="incl-msg" id="inclMsg"><div class="glass"><h3></h3><p></p><span class="pill"></span></div></div>
        <div class="tris">${[["acc", "가감속도", "m/s²"], ["lat", "흔들림", "gal"], ["spd", "속력", "m/min"]].map(([k, t, u], i) =>
          `<div class="item fade-in" style="animation-delay:${0.1 + i * 0.1}s"><div class="lbl">${t}</div><div class="g" id="tg-${k}"></div></div>`).join("")}</div></div>`;
      this.tris = {}; this.liveAt = {};
      const U = { acc: "m/s²", lat: "gal", spd: "m/min" };
      for (const k of ["acc", "lat", "spd"]) { const g = new TriGauge(k, size, U[k]); $(`#tg-${k}`).appendChild(g.el); g.vals("0.00", "0.00").level(0); this.tris[k] = g; }
      this.tris.lat.vals("0.0", "0.0"); this.tris.spd.vals("0.0", "0.0", "0.0");
      this.inclMsg();
    } else if (kind === "live-simple") {
      const avail = innerHeight - 60 - 70 - 110 - 3 * 44;
      // 가로 화면: 세 게이지를 옆으로 나란히, 화면 높이에 맞춰 크게
      const size = isWide() ? Math.round(clamp(Math.min((innerHeight - 260) * 0.95, (innerWidth - 160) / 3.6), 150, 340)) : Math.round(clamp(avail / 3, 104, 176));
      body.innerHTML = `<div class="triple">${[["acc", "가감속도"], ["lat", "좌우 흔들림"], ["spd", "현재 속력"]].map(([k, t], i) =>
        `<div class="item fade-in" style="animation-delay:${i * 0.1}s"><div class="lbl">${t}</div><div id="tr-${k}"></div></div>`).join("")}</div>`;
      this.trip = {}; this.liveAt = {};
      for (const k of ["acc", "lat", "spd"]) { const s = new Sphere(k, size); $(`#tr-${k}`).appendChild(s.el); s.level(0); this.trip[k] = s; }
    } else {
      body.innerHTML = `<div class="stat-row fade-in">
          <div class="stat glass"><div class="l">저크</div><div class="v" id="lvJ">0.00<small>m/s³</small></div></div>
          <div class="stat glass"><div class="l">상하 흔들림</div><div class="v" id="lvV">0.0<small>gal</small></div></div>
          <div class="stat glass"><div class="l">주행 거리</div><div class="v" id="lvD">0.0<small>m</small></div></div></div>
        <div class="charts">${SERIES.map((s, i) => `<div class="chart-card glass fade-in"><div class="h"><b>${s.title}</b><span>${s.unit}</span><em id="lv-${s.key}"></em></div><canvas class="chart" id="lc-${s.key}"></canvas></div>`).join("")}</div>`;
      this.liveCharts = SERIES.map(s => new Chart($(`#lc-${s.key}`), { values: [], rate: FS, color: s.color, half: s.half, dec: s.dec, unit: s.unit, window: LIVE_WIN }));
      // 화면 밖 그래프는 그리지 않는다
      if (this.liveIO) this.liveIO.disconnect();
      this.liveIO = new IntersectionObserver(es => es.forEach(e => { const ch = this.liveCharts.find(c => c.c === e.target); if (ch) ch.visible = e.isIntersecting; }));
      this.liveCharts.forEach(ch => this.liveIO.observe(ch.c));
    }
  },
  /** 경사형 알림: '경사형 엘리베이터네요.' 또는 '경사각이 변화했어요.' + 알약. 1초 뒤 사라진다 (2026-11-26 사용자 확정) */
  inclMsg() {
    const box = $("#inclMsg"), I = ctl.incl; if (!box || !I || !I.msg) return;
    $("#inclPill").textContent = `경사 ${I.deg}°`;                              // '측정 중' 옆 경사 알약은 계속 보인다 (2026-11-26)
    const left = 1000 - (performance.now() - I.msg.at);                          // 알림은 1초 (2026-11-26 사용자 확정)
    clearTimeout(this.msgT);
    if (left <= 0) { box.classList.add("hide"); return; }
    const ch = I.msg.kind === "change";
    box.querySelector("h3").textContent = ch ? "경사각이 변화했어요." : "경사형 엘리베이터네요.";
    box.querySelector("p").textContent = ch ? "" : "위아래와 함께 앞뒤로도 움직이고 있어요.";
    box.querySelector("p").hidden = ch;
    box.querySelector(".pill").textContent = ch ? `${I.msg.from}° → ${I.msg.to}°` : `경사 ${I.msg.to != null ? I.msg.to : I.deg}°`;
    box.classList.remove("hide");
    this.msgT = setTimeout(() => box.classList.add("hide"), left);
  },
  /** 대기 문구의 가운데를 화면 정가운데에 맞춘다 (위쪽 머리 높이만큼 내려가 있는 것을 끌어올림) */
  centerCaption() {
    const w = $("#capWrap"), c = $("#cap"); if (!w || !c || !w.offsetParent) return;
    const prev = this.capDy || 0, r = c.getBoundingClientRect();
    const dy = Math.round(innerHeight / 2 - (r.top + r.height / 2 - prev));
    if (dy !== prev) { this.capDy = dy; w.style.transform = `translateY(${dy}px)`; }
  },
  updateSingle() {
    if (!this.big) return;
    const cap = $("#cap"), sub = $("#capSub"), btns = $("#capBtns");
    const settling = ctl.progress > 0.04;
    if (this.lift && this.liftOpen) this.lift.style.setProperty("--o", (1 - clamp(ctl.progress, 0, 1)).toFixed(3));
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
    this.centerCaption();
  },
  renderActions() {
    const measuring = ctl.state === "measure", ph = measuring ? ctl.phase : "";
    const k = `${measuring}|${this.detail}|${ctl.mode}|${ph}`;
    const box = $("#homeActions"); if (box.dataset.k === k) return; box.dataset.k = k;
    const tog = `<button class="tog-text ${this.detail ? "up" : ""}" id="bTog">${ICON.chev}${this.detail ? "접을래요" : "자세히 볼래요"}</button>`;   // 화살표 + 글자만 (2026-11-25)
    const stop = measuring ? `<button class="pill-btn danger" id="bStop">${ICON.stop}${ctl.mode === "auto" ? "즉시 정지" : "측정 종료"}</button>` : "";
    const cancel = !measuring && ctl.state === "wait" ? `<button class="pill-btn" id="bCancel">취소</button>` : "";
    if (measuring && ph !== "run") {
      // 일시정지 → 측정 재개 (0.3초 이상 길게 눌렀다 떼기)
      const calib = ph === "calib";
      box.innerHTML = `<div class="pause-note glass" id="pNote">${calib ? "센서를 보정하고 있어요.<br>휴대폰을 그대로 두세요."
          : "측정 재개 버튼을 <b>0.3초 이상</b> 길게 눌렀다 떼면<br>1초간 센서를 보정하고 바로 이어서 측정해요."}</div>
        <div class="toggle-wrap act-row"><button class="pill-btn primary hold ${calib ? "calib" : ""}" id="bResume" ${calib ? "disabled" : ""}><i class="fill"></i>${ICON.play}<span>${calib ? "보정 중" : "측정 재개"}</span></button>${stop}</div>`;
      if (!calib) this.bindHold($("#bResume"), () => ctl.recalibrate(), () => {
        const n = $("#pNote"); n.classList.remove("nudge"); void n.offsetWidth; n.classList.add("nudge"); });
    } else {
      const pause = measuring ? `<button class="pill-btn round hold" id="bPause" aria-label="일시정지 (0.3초 이상 길게 누르기)" title="0.3초 이상 길게 눌렀다 떼면 일시정지"><i class="fill"></i>${ICON.pause}</button>` : "";
      const reset = measuring ? `<button class="pill-btn round hold" id="bReset" aria-label="리셋 (0.3초 이상 누르고 떼기)" title="0.3초 이상 누르고 떼면 리셋"><i class="fill"></i>${ICON.reset}</button>` : "";
      box.innerHTML = `<div class="toggle-wrap act-row">${tog}${reset}${pause}${stop}${cancel}</div>`;
    }
    if ($("#bTog")) $("#bTog").onclick = () => { this.detail = !this.detail; this.render(); };
    if ($("#bPause")) {
      // 누르기 시작한 순간의 위치를 기억해 두었다가, 그 0.2초 전까지만 남긴다
      let at = null;
      this.bindHold($("#bPause"), () => ctl.pause(at), () => toast("0.3초 이상 길게 눌렀다 떼 주세요."),
        () => { at = ctl.vert ? ctl.vert.length : null; });
    }
    if ($("#bReset")) this.bindHold($("#bReset"),
      () => ctl.reset(),   // 2026-11-26: 리셋은 언제나 (예전: 엘리베이터가 서 있을 때만). 경사형 게이지도 일반 게이지로 돌아간다
      () => toast("0.3초 이상 누르고 떼면 리셋돼요."));
    if ($("#bStop")) $("#bStop").onclick = () => ctl.stop("manual");
    if ($("#bCancel")) $("#bCancel").onclick = () => { ctl.state = "idle"; ctl.progress = 0; ctl.stopDemo(); home.render(); };
  },
  /** 길게 누르기: 0.3초가 차오르는 동안 버튼이 채워지고, 다 차면 손을 뗄 때 보정 시작 */
  bindHold(b, onDone, onShort, onDown) {
    let t0 = 0, tm = null;
    const reset = () => { t0 = 0; clearTimeout(tm); b.classList.remove("holding", "ready"); };
    b.addEventListener("pointerdown", e => {
      e.preventDefault(); t0 = performance.now(); b.classList.add("holding"); if (onDown) onDown();
      tm = setTimeout(() => { b.classList.add("ready"); try { navigator.vibrate && navigator.vibrate(15); } catch (er) { /* 무시 */ } }, HOLD_MS);
      try { b.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
    });
    b.addEventListener("pointerup", () => {
      if (!t0) return; const dt = performance.now() - t0; reset();
      if (dt >= HOLD_MS) onDone(); else if (onShort) onShort();
    });
    b.addEventListener("pointercancel", reset);
    b.addEventListener("contextmenu", e => e.preventDefault());
  },
  tick() {
    if (!ctl.dirty) return; ctl.dirty = false;
    if (ctl.state !== "measure") { if (this.big) this.updateSingle(); return; }
    const o = ctl.o, sec = ctl.vert.length / FS;
    const lbl = ctl.phase === "pause" ? "일시정지" : ctl.phase === "calib" ? "보정 중" : "측정 중";
    $("#liveTime").textContent = `${lbl} ${Math.floor(sec / 60)}:${p2(Math.floor(sec % 60))}`;
    if (ctl.phase === "calib") { const b = $("#bResume"); if (b) b.style.setProperty("--p", clamp(ctl.recalP || 0, 0, 1)); }
    if (!o) return;
    // 실시간 숫자 표시 주기 (2026-11-25 사용자 확정): 가감속 1초에 15번, 속력 1초에 30번, 좌우 흔들림 2초에 1번
    const now = performance.now(), due = k => { const lt = this.liveAt || (this.liveAt = {}); if (lt[k] != null && now - lt[k] < LIVE_MS[k]) return false; lt[k] = now; return true; };
    if (this.tris) {
      // 경사형: 왼쪽 변 = 수직, 아래 변 = 앞뒤 (흔들림만: 왼쪽 = 앞뒤, 아래 = 좌우). 물 높이 = 경사 방향(합친) 값 / 범례 (가감속 0.6 m/s², 흔들림 20 gal, 속력 90 m/min)
      const I = ctl.incl, rad = I.theta * Math.PI / 180, cot = 1 / Math.tan(rad), sn = Math.sin(rad), f = ctl.of, T = this.tris;
      if (due("acc")) { const av = Math.abs(o.acc), af = f ? Math.abs(f.acc) : av * cot; T.acc.vals(av.toFixed(2), af.toFixed(2)).level(Math.hypot(av, af) / LEGEND_INC.acc); }
      if (due("lat")) { const pf = f ? f.pp : 0, pl = ctl.ol ? ctl.ol.pp : 0; T.lat.vals(f ? pf.toFixed(1) : "—", ctl.ol ? pl.toFixed(1) : "—").level(Math.max(pf, pl) / LEGEND_INC.lat); }
      if (due("spd")) { const sv = Math.abs(o.speed); T.spd.vals(sv.toFixed(1), (sv * cot).toFixed(1), (sv / sn).toFixed(1)).level(sv / sn / LEGEND_INC.spd); }
    } else if (this.trip) {
      if (due("acc")) this.trip.acc.level(Math.abs(o.acc) / LEGEND.acc).text(Math.abs(o.acc).toFixed(2), null, "m/s²");
      if (due("lat")) this.trip.lat.level(o.ppL / LEGEND.lat).text(o.ppL.toFixed(1), null, "gal");
      if (due("spd")) this.trip.spd.level(Math.abs(o.speed) / LEGEND.spd).text(Math.abs(o.speed).toFixed(1), null, "m/min");
    } else if (this.liveCharts.length) {
      $("#lvJ").innerHTML = `${Math.abs(o.jerk).toFixed(2)}<small>m/s³</small>`;
      $("#lvV").innerHTML = `${o.ppV.toFixed(1)}<small>gal</small>`;
      $("#lvD").innerHTML = `${(ctl.distOff + o.dist).toFixed(1)}<small>m</small>`;
      const n = ctl.live.acc.length, take = Math.min(n, LIVE_WIN), off = Math.max(0, ctl.vert.length - take) / FS;
      // 실시간 그래프 (2026-11-26 최적화): 1초에 30번까지만, 화면에 보이는 그래프만 다시 그린다 (예전: 5개 모두 매 프레임 → 느린 폰에서 21프레임)
      const redraw = due("chart");
      SERIES.forEach((s, i) => {
        const arr = ctl.live[s.key], ch = this.liveCharts[i];
        if (redraw && ch.visible !== false) ch.setValues(arr.slice(arr.length - take), off);
        const k = s.key === "acc" ? "acc" : s.key === "speed" ? "spd" : s.key === "vibL" ? "lat" : null;
        if (k && !due("d" + k)) return;
        const cur = arr[arr.length - 1]; $(`#lv-${s.key}`).textContent = cur == null ? "" : signed(s.key === "speed" ? cur : cur, s.dec);
      });
    }
  },
};

/* ════════════════════════════════════════════════════════════════
   기록 관리
   ════════════════════════════════════════════════════════════════ */
/* ───────── 기록 검색 (2026-11-25) ─────────
   한 글자(숫자)만 넣어도 바로 찾는다. 대소문자 무시, 한글 초성(ㅂㄱ → 본관), 입력 중인 글자(보 → 본, 간 → 가나)도 맞춘다.
   찾는 곳: 기록 이름, 측정 날짜, 내보낼 파일 이름, 가져온 원래 파일 이름 */
const finder = {
  CHO: "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ",
  JONG2CHO: ["", "ㄱ", "ㄲ", "", "ㄴ", "", "", "ㄷ", "ㄹ", "", "", "", "", "", "", "", "ㅁ", "ㅂ", "", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"],
  syl(c) { const k = c.charCodeAt(0) - 0xAC00; return k >= 0 && k < 11172 ? { cho: (k / 588) | 0, jung: ((k % 588) / 28) | 0, jong: k % 28 } : null; },
  /** 글자 하나 비교. last: 검색어의 마지막 글자(아직 입력 중일 수 있음), next: 대상의 다음 글자 */
  same(q, t, last, next) {
    if (q === t) return true;
    const qi = this.CHO.indexOf(q), ts = this.syl(t);
    if (qi >= 0) return !!ts && ts.cho === qi;                     // 초성만: ㅂ → 본
    if (!last) return false;
    const qs = this.syl(q);
    if (!qs || !ts || qs.cho !== ts.cho || qs.jung !== ts.jung) return false;
    if (!qs.jong) return true;                                     // 보 → 본
    const nx = next && this.syl(next);                             // 간 → 가나 (받침이 다음 글자 초성으로 넘어가는 중)
    return !ts.jong && !!nx && this.CHO[nx.cho] === this.JONG2CHO[qs.jong];
  },
  /** 맞는 곳의 [시작, 끝] 또는 null */
  find(q, text) {
    const t = String(text || "").toLowerCase(), n = q.length;
    for (let i = 0; i + n <= t.length; i++) {
      let ok = true;
      for (let j = 0; j < n && ok; j++) ok = this.same(q[j], t[i + j], j === n - 1, t[i + j + 1]);
      if (ok) return [i, i + n];
    }
    return null;
  },
  mark(text, hit) { return hit ? esc(text.slice(0, hit[0])) + "<mark>" + esc(text.slice(hit[0], hit[1])) + "</mark>" + esc(text.slice(hit[1])) : esc(text); },
};

const records = {
  selecting: null, sel: new Set(), items: [], all: [], anchor: null,   // selecting: null | "export" | "delete"
  searching: false, q: "",
  /** 저장소에서 다시 읽고 그린다 */
  async render() {
    try { this.all = await store.list(); } catch (e) { this.all = []; }
    this.draw(true);
  },
  hayOf(m) { return [m.name || fmtDate(m.startedAt), m.name ? fmtDate(m.startedAt) : "", fileNameOf(m), m.src && m.src.name].filter(Boolean); },
  /** 검색어로 거른 목록을 그린다 (anim: 카드가 차례로 나타나는 효과) */
  draw(anim) {
    const list = $("#recList"), q = this.searching ? this.q.trim().toLowerCase() : "";
    this.items = q ? this.all.filter(m => this.hayOf(m).some(h => finder.find(q, h))) : this.all;
    if (!this.all.length) {
      list.innerHTML = `<div class="empty">아직 측정 기록이 없어요.<br>홈에서 휴대폰을 내려놓으면 측정이 시작돼요.</div>`;
      return;
    }
    if (!this.items.length) {
      list.innerHTML = `<div class="empty">‘${esc(this.q.trim())}’ 검색 결과가 없어요.</div>`;
      return;
    }
    list.classList.toggle("selecting", !!this.selecting);
    list.innerHTML = this.items.map((m, k) => {
      const lv = (v, key) => (v > 0 ? clamp(v / LEGEND[key], 0.06, 1) : 0) * 100;
      const lat = m.latP98 == null ? "—" : m.latP98.toFixed(1);
      const fitMini = t => (t.length >= 6 ? ' style="font-size:10.5px"' : t.length === 5 ? ' style="font-size:12px"' : "");   // 239.6처럼 긴 숫자는 원 안에 들어가게 줄임
      return `<article class="rec-card glass ${this.sel.has(m.id) ? "sel" : ""} ${this.anchor === k ? "anchor" : ""}" data-id="${esc(m.id)}" data-k="${k}" tabindex="0">
        <div class="rc-head"><span class="check"></span>
          <div class="t"><div class="rc-name"><span class="nm">${q ? finder.mark(m.name || fmtDate(m.startedAt), finder.find(q, m.name || fmtDate(m.startedAt))) : esc(m.name || fmtDate(m.startedAt))}</span>${m.demo ? '<span class="tag">데모</span>' : ""}${m.imported ? '<span class="tag">가져옴</span>' : ""}</div>
          <div class="rc-date">${m.name ? (q ? finder.mark(fmtDate(m.startedAt), finder.find(q, fmtDate(m.startedAt))) : fmtDate(m.startedAt)) + " · " : ""}${fmtDur(m.duration)}</div></div>
          <button class="ic-btn pop" data-act="edit" aria-label="이름 변경">${ICON.edit}</button></div>
        <div class="rc-body"><div class="minis">${m.incl ? (() => {
          const I = m.incl, fl = I.lat, ft = fl == null ? "—" : fl.toFixed(1), st = I.speedMax.toFixed(1);
          return triMini("acc", Math.max(I.accMax, I.decMax) / LEGEND_INC.acc, `<span class="ms two"><b>${I.accMax.toFixed(2)}</b><b>${I.decMax.toFixed(2)}</b><i>m/s²</i></span>`)
            + triMini("lat", fl == null ? 0 : fl / LEGEND_INC.lat, `<span class="ms"><b${fitMini(ft)}>${ft}</b><i>${fl == null ? "" : "gal"}</i></span>`)
            + triMini("spd", I.speedMax / LEGEND_INC.spd, `<span class="ms"><b${fitMini(st)}>${st}</b><i>m/min</i></span>`);
        })() : `
          <div class="mini k-acc" style="--lv:${lv(m.accPeak, "acc")}%"><span class="ms two"><b>${(m.accMax ?? m.accPeak).toFixed(2)}</b><b>${(m.decMax ?? m.accPeak).toFixed(2)}</b><i>m/s²</i></span></div>
          <div class="mini k-lat" style="--lv:${m.latP98 == null ? 0 : lv(m.latP98, "latA")}%"><span class="ms"><b${fitMini(lat)}>${lat}</b><i>${m.latP98 == null ? "" : "gal"}</i></span></div>
          <div class="mini k-spd" style="--lv:${lv(m.speedMax, "spd")}%"><span class="ms"><b${fitMini(m.speedMax.toFixed(1))}>${m.speedMax.toFixed(1)}</b><i>m/min</i></span></div>`}</div>
          <div class="rc-line">${esc(firstSentence(m.overall))}</div></div></article>`;
    }).join("");
    if (anim) stagger(list, 12);
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
  /** 검색 열기: 제목줄이 검색창으로 바뀐다 (뒤로 가기로 닫힘) */
  openSearch() {
    if (this.searching) { $("#recQ").focus(); return; }
    this.searching = true; this.q = "";
    $("#recQ").value = ""; $("#recTop").classList.add("searching"); $("#recQClear").hidden = true;
    $("#recQ").focus();
    nav.push("search");
    this.draw(false);
  },
  closeSearch() {
    if (!this.searching) return;
    this.searching = false; this.q = "";
    $("#recTop").classList.remove("searching"); $("#recQ").blur();
    this.draw(false);
  },
  onQuery(v) {
    this.q = v; $("#recQClear").hidden = !v;
    this.sel.clear(); this.anchor = null;
    this.draw(false);
    if (this.selecting) this.renderBar();
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
    let ok = 0, same = 0; const bad = [], notRide = [];
    const have = new Set((await store.list()).map(m => m.srcKey).filter(Boolean));
    for (const f of files) {
      try {
        const srcKey = await fileKey(f.name, f.size);               // 이름과 용량이 모두 같으면 같은 파일 (2026-11-25)
        if (have.has(srcKey)) { same++; continue; }
        const buf = await f.arrayBuffer();
        let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder("euc-kr").decode(buf); }
        const isTxt = /\.txt$/i.test(f.name);
        const imp = isTxt ? Core.importTxt(text) : Core.importCsv(text);
        const name = f.name.replace(/\.(csv|txt)$/i, "");
        const startedAt = imp.startedAt || f.lastModified || Date.now();
        const rec = { id: `ride_${startedAt}_${Math.random().toString(36).slice(2, 7)}`, name, startedAt, rate: imp.rate, imported: true,
          vert: imp.vert, lat: imp.lat, ...(imp.lon ? { lon: imp.lon } : {}), updatedAt: Date.now(), src: { name: f.name, size: f.size }, srcKey };
        if (imp.segs) rec.segs = imp.segs;
        if (imp.zOnly) rec.zOnly = true;
        await store.put(rec); have.add(srcKey); ok++;
      } catch (e) { (e && e.code === Core.TXT_BAD ? notRide : bad).push(f.name); }
    }
    await this.render();
    if (notRide.length) {
      // 형식이 다른 .txt: 팝업으로 알린다
      dialog(`<h3>승차감 기록이 아닌 것 같아요.</h3><p>${esc(notRide.slice(0, 3).join(", "))}${notRide.length > 3 ? ` 외 ${notRide.length - 3}개` : ""}</p>
        <div class="acts"><button class="solid" id="dOk">확인</button></div>`, (b, close) => { b.querySelector("#dOk").onclick = close; });
    }
    if (same && !ok && !bad.length) toast(`이미 있는 파일이에요 (${same}개).`, 3600);
    else if (same) toast(`${ok}개를 가져왔어요. ${same}개는 이미 있는 파일이라 건너뛰었어요.`, 4200);
    else if (ok || bad.length) toast(bad.length ? `${ok}개를 가져왔어요. ${bad.length}개는 형식이 맞지 않았어요: ${bad.slice(0, 2).join(", ")}${bad.length > 2 ? " 외" : ""}` : `${ok}개 파일을 가져왔어요.`, 4500);
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
/** AI 평가 무지개: 모드별 레퍼런스 6색을 무작위 순서로 (처음 색을 끝에 한 번 더 → 흐르고 돌 때 이음매가 없다)
    라이트: 서리 유리 구슬의 파스텔 테두리 / 다크: 어둠 속에 빛나는 장밋빛·보랏빛·얼음빛 */
const RAINBOW = {
  light: ["#F4C6D7", "#F7D2B0", "#EEE9A6", "#A9E8C4", "#86D6E2", "#C9C6F2"],
  dark: ["#F2A7BE", "#F0A6E6", "#B39AF0", "#7684E6", "#A9DDF3", "#FFD6E5"],
};
function rainbowColors(el) {
  const order = [0, 1, 2, 3, 4, 5];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  order.forEach((k, i) => { el.style.setProperty(`--l${i + 1}`, RAINBOW.light[k]); el.style.setProperty(`--d${i + 1}`, RAINBOW.dark[k]); });
}
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
  /** 간단히 ↔ 자세히: 자세히는 뒤로 가기 한 단계로 쌓아서, 뒤로 가면 간단히로 돌아온다 */
  setDetail(on) {
    if (on === this.detail) return;
    this.detail = on; this.render(); $("#detailIn").scrollTop = 0;
  },
  render() {
    const r = this.rec, A = analysisOf(r), ev = A.m.eval, box = $("#detailIn");
    charts.clear(box);
    box.innerHTML = `<div class="top" id="dHead"><button class="round-btn pop" id="dBack" aria-label="뒤로">${ICON.back}</button>
        <div class="tt"><h2></h2><div></div></div>
        ${owner.on ? `<button class="round-btn pop" id="dVid" aria-label="영상 만들기" title="영상 만들기 (2560×1190 · 60프레임)">${ICON.film}</button>` : ""}
        <button class="round-btn pop" id="dEdit" aria-label="이름 변경">${ICON.edit}</button>
        <button class="round-btn pop del" id="dDel" aria-label="기록 삭제">${ICON.del}</button></div>
      <div class="ai-box glass fade-in"><span class="ai-glow" aria-hidden="true"><i></i></span><span class="ai-chip">${ICON.aiStar}<span class="ai-t">AI 평가</span></span><p>${esc(ev.overall)}</p></div>
      <div id="dBody"></div>
      <div class="toggle-wrap"><button class="tog-text ${this.detail ? "up" : ""}" id="dTog">${ICON.chev}${this.detail ? "접을래요" : "자세히 볼래요"}</button></div>`;
    this.renderHead();
    const ai = box.querySelector(".ai-box"); if (ai) { rainbowColors(ai); deco.watch(ai); }
    $("#dBack").onclick = () => nav.back();
    $("#dEdit").onclick = () => records.renameDlg(r.id, r.name);
    $("#dDel").onclick = () => this.remove();
    if ($("#dVid")) $("#dVid").onclick = () => videoMaker.run(r);
    $("#dTog").onclick = () => { if (this.detail) nav.back(); else { this.setDetail(true); nav.push("recordfull"); } };
    stagger(box);
    if (!this.detail) this.simple(A); else this.full(A);
  },
  async remove() {
    const r = this.rec; if (!r) return;
    if (!(await confirmDlg("이 기록을 삭제할까요?", "삭제한 기록은 되돌릴 수 없어요.", "삭제", "취소", true))) return;
    await store.del(r.id);
    for (const k of [...cache.keys()]) if (k.startsWith(r.id + ":")) cache.delete(k);
    nav.closeRecord();
    await records.render();
    toast("기록을 삭제했어요.");
  },
  /** 경사형 머리글: 경사각(바뀌었으면 처음 → 끝) · 수직/앞뒤 이동거리 */
  inclHead(I) {
    const ang = I.changes.length ? `경사 ${[I.theta, ...I.changes.map(c => c.to)].map(v => v + "°").join(" → ")}` : `경사 ${I.theta}°`;
    return `<div class="incl-sec fade-in"><span class="tag">경사형 엘리베이터</span><span class="s">${ang} · 수직 ${I.distV.toFixed(1)} m · 앞뒤 ${I.distF.toFixed(1)} m</span></div>`;
  },
  /** 경사형 간단히: 직각삼각형 게이지 3개 (왼쪽 변 수직, 아래 변 앞뒤) */
  simpleIncl(A) {
    const m = A.m, ev = m.eval, I = m.incl, body = $("#dBody"), sn = Math.sin(I.theta * Math.PI / 180);
    const worse = [ev.vibF, ev.vibL].filter(x => x && x.lv >= 0).sort((a, b) => b.lv - a.lv)[0] || { lv: -1, s: "기록이 없어요." };
    const along = I.speedAlong != null ? I.speedAlong : m.speedMax / sn;
    const br = ev.brief;
    const rows = [
      { k: "acc", lbl: "가감속도", u: "m/s²", v: Math.max(m.accMax, m.decMax).toFixed(2), f: Math.max(I.accMax, I.decMax).toFixed(2), lv: m.accPeak / sn / LEGEND_INC.acc,
        b: { lv: "n", t: br.acc }, p: "" },   // 경사형 UI (2026-11-27 사용자 피드백): 앞뒤 가감속 기준 한 줄, '가속 최대 ~' 줄 뺌
      { k: "lat", lbl: "흔들림", u: "gal", v: I.vibF.n ? I.vibF.p98.toFixed(1) : "—", f: m.vibL && m.vibL.n ? m.vibL.p98.toFixed(1) : "—",
        lv: Math.max(m.vibL ? m.vibL.p98 : 0, I.vibF.p98) / LEGEND_INC.lat, b: { lv: worse.lv, t: worse.s }, p: br.vib.join("\n") },   // Hz·'여요' 뺌   // 위아래 줄 · 앞뒤 줄을 나눠서 (2026-11-26)
      { k: "spd", lbl: "속력", u: "m/min", v: m.speedMax.toFixed(1), f: I.speedMax.toFixed(1), lv: along / LEGEND_INC.spd,
        b: { lv: "n", t: br.spd }, p: "" },   // '예요 (참고값)'·경사 변화 안내 뺌
    ];
    const size = isWide() ? Math.round(clamp(Math.min(innerHeight * 0.36, innerWidth / 5.6), 140, 250)) : Math.round(clamp(innerWidth * 0.33, 110, 140));
    body.innerHTML = this.inclHead(I) + `<div class="d-rows incl-rows">${rows.map((r, i) => `<div class="d-row fade-in" style="animation-delay:${0.1 + i * 0.1}s">
        <div><div class="lbl">${r.lbl}</div><div class="g" id="ds-${r.k}"></div></div>
        <div class="ev"><b class="lv${r.b.lv}">${esc(r.b.t)}</b>${r.p ? `<p>${esc(r.p)}</p>` : ""}</div></div>`).join("")}</div>`;
    rows.forEach((r, i) => {
      const g = new TriGauge(r.k, size, r.u); $(`#ds-${r.k}`).appendChild(g.el);
      g.vals(r.v, r.f, r.k === "spd" ? along.toFixed(1) : null).level(0);
      setTimeout(() => g.level(Math.max(r.lv, r.v === "—" ? 0 : 0.03)), 250 + i * 150);
    });
    fitLines(body);   // 게이지가 들어간 뒤의 칸 폭 기준으로 한 줄에 맞춤
  },
  simple(A) {
    if (A.m.incl) return this.simpleIncl(A);
    const m = A.m, ev = m.eval, body = $("#dBody");
    const rows = [
      { k: "acc", lbl: "가감속도", lv: m.accPeak / LEGEND.acc, n1: m.accMax.toFixed(2), n2: m.decMax.toFixed(2), u: "m/s²",
        b: { lv: "n", t: ev.acc.t }, p: `가속 최대 ${m.accMax.toFixed(2)} · 감속 최대 ${m.decMax.toFixed(2)} m/s²` },
      m.vibL && m.vibL.n
        ? { k: "lat", lbl: "좌우 흔들림", lv: m.vibL.p98 / LEGEND.latA, n1: m.vibL.p98.toFixed(1), u: "gal", b: { lv: ev.vibL.lv, t: ev.vibL.s }, p: ev.vibL.line }
        : { k: "lat", lbl: "좌우 흔들림", lv: 0, n1: "—", u: "gal", b: { lv: "n", t: "기록이 없어요." }, p: "" },
      { k: "spd", lbl: "속력", lv: m.speedMax / LEGEND.spd, n1: m.speedMax.toFixed(1), u: "m/min", b: ev.speed, p: "" },
    ];
    const size = isWide() ? Math.round(clamp(Math.min(innerHeight * 0.4, innerWidth / 5.2), 160, 280)) : Math.round(clamp(innerWidth * 0.36, 120, 160));
    body.innerHTML = `<div class="d-rows">${rows.map((r, i) => `<div class="d-row fade-in" style="animation-delay:${0.1 + i * 0.1}s">
        <div><div class="lbl">${r.lbl}</div><div id="ds-${r.k}"></div></div>
        <div class="ev"><b class="lv${r.b.lv}">${esc(r.b.t)}</b>${r.p ? `<p>${esc(r.p)}</p>` : ""}</div></div>`).join("")}</div>`;
    rows.forEach((r, i) => {
      const s = new Sphere(r.k, size); $(`#ds-${r.k}`).appendChild(s.el);
      s.text(r.n1, r.n2 != null ? r.n2 : null, r.u).level(0);
      setTimeout(() => s.level(Math.max(r.lv, r.n1 === "—" ? 0 : 0.03)), 250 + i * 150);
    });
  },
  /** 자세히: AI 평가 + 9가지 지표 + 그래프 */
  full(A) {
    const m = A.m, ev = m.eval, body = $("#dBody"), S = A.series, r = this.rec;
    const floors = Math.round(m.distance / 3);
    const NO = "기록이 없어요.";
    const gal = (v, g, d = 0) => (v == null ? { v: "—", u: "", e: NO, lv: -1 } : { v: v.toFixed(d), u: "gal", e: g.s, lv: g.lv });
    const cards = [
      m.jerk == null ? { l: "저크", v: "—", u: "", e: NO, lv: -1 } : { l: "저크", v: m.jerk.toFixed(2), u: "m/s³", e: ev.jerk.s, lv: ev.jerk.lv },
      { l: "가감속도", v2: [["가속", m.accMax.toFixed(2)], ["감속", m.decMax.toFixed(2)]], u: "m/s²", e2: [`가속 ${ev.acc.a}`, `감속 ${ev.acc.d}`], lv: -1 },
      { l: "속력", v: m.speedMax.toFixed(1), u: "m/min", e: ev.speed.card || (m.speedMax <= 500 ? `${ev.speed.s} 승강기` : ev.speed.s), lv: -1 },
      { l: "운행 거리", v: m.distance.toFixed(1), u: "m", e: floors >= 1 ? `건물 약 ${floors}층 높이` : "거의 움직이지 않았어요", lv: -1 },
      { l: "상하 흔들림", ...(m.vibV && m.vibV.n ? { v: m.vibV.p98.toFixed(1), u: "gal", e: ev.vibV.s, lv: ev.vibV.lv } : { v: "—", u: "", e: NO, lv: -1 }) },
      { l: "좌우 흔들림", ...(m.vibL && m.vibL.n ? { v: m.vibL.p98.toFixed(1), u: "gal", e: ev.vibL.s, lv: ev.vibL.lv } : { v: "—", u: "", e: NO, lv: -1 }) },
      { l: "출발 거칠기", ...gal(m.start, ev.start) },
      { l: "가감속 울렁임", ...gal(m.wave, ev.wave) },
      { l: "도착 거칠기", ...gal(m.arrive, ev.arrive) },
    ];
    const I = m.incl;
    const series = SERIES.filter(s => s.key !== "vibL" || m.vibL).concat(I ? SERIES_INC : []);
    const comment = { acc: ev.acc.s, jerk: ev.jerk.s, vibV: ev.vibV.s, vibL: ev.vibL ? ev.vibL.s : "", speed: ev.speed.s,
      fa: I ? (ev.fa.a === ev.fa.d ? ev.fa.a : `${ev.fa.a}·${ev.fa.d}`) : "", vibF: ev.vibF ? ev.vibF.s : "", speedF: I && I.changes.length ? "경사 변화 있음" : "" };
    const card = (c, i) => `<div class="m6-card glass fade-in">
        <div class="l">${c.l}</div>
        ${c.v2 ? `<div class="v2">${c.v2.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div><div class="u">${c.u}</div>`
               : `<div class="v">${c.v}<small>${c.u}</small></div>`}
        <div class="e ${c.e2 ? "two" : ""} ${c.lv >= 0 ? "lv" + c.lv : ""}">${c.e2 ? c.e2.map(x => `<span>${esc(x)}</span>`).join("") : esc(c.e)}</div></div>`;
    let inclHtml = "";
    if (I) {
      // 경사형 지표 (2026-11-26 사용자 확정): 경사도, 앞뒤 가감속도·속력·흔들림, 수직·앞뒤 이동거리
      const sn = Math.sin(I.theta * Math.PI / 180), along = I.speedAlong != null ? I.speedAlong : m.speedMax / sn;
      const slope = t => (t < 25 ? "완만한 편이에요" : t < 40 ? "보통 기울기예요" : "가파른 편이에요");
      const ic = [
        { l: "경사도", v: I.changes.length ? `<span class="shrink">${[I.theta, ...I.changes.map(c => c.to)].map(v => v + "°").join("→")}</span>` : `${I.theta}°`, u: "", e: I.changes.length ? `운행 중 ${I.changes.length}번 바뀌었어요` : slope(I.theta), lv: -1 },
        { l: "앞뒤 가감속도", v2: [["가속", I.accMax.toFixed(2)], ["감속", I.decMax.toFixed(2)]], u: "m/s²", e2: [`가속 ${ev.fa.a}`, `감속 ${ev.fa.d}`], lv: -1 },
        { l: "앞뒤 속력", v: I.speedMax.toFixed(1), u: "m/min", e: `경사 방향 ${along.toFixed(1)} m/min`, lv: -1 },
        { l: "앞뒤 흔들림", ...(I.vibF.n ? { v: I.vibF.p98.toFixed(1), u: "gal", e: ev.vibF.s, lv: ev.vibF.lv } : { v: "—", u: "", e: NO, lv: -1 }) },
        { l: "수직 이동거리", v: I.distV.toFixed(1), u: "m", e: floors >= 1 ? `건물 약 ${floors}층 높이` : "거의 움직이지 않았어요", lv: -1 },
        { l: "앞뒤 이동거리", v: I.distF.toFixed(1), u: "m", e: `경사 방향 ${I.distAlong.toFixed(1)} m`, lv: -1 },
      ];
      inclHtml = this.inclHead(I) + `<div class="m6">${ic.map(card).join("")}</div><div class="incl-sec fade-in"><span class="tag">기본 지표</span><span class="s">수직 방향</span></div>`;
    }
    body.innerHTML = `${inclHtml}<div class="m6">${cards.map((c, i) => card(c, i + (I ? 6 : 0))).join("")}</div>
      <div class="charts">${series.map((s, i) => `<div class="chart-card glass fade-in" style="animation-delay:${0.1 + i * 0.08}s">
        <div class="h"><b>${s.title}</b><span>${s.unit}</span><em>${esc(comment[s.key] || "")}</em></div>
        <canvas class="chart" id="dc-${s.key}" style="height:180px"></canvas></div>`).join("")}</div>`;
    series.forEach(s => new Chart($(`#dc-${s.key}`), { values: S[s.key], rate: r.rate, color: s.color, half: s.half, dec: s.dec, unit: s.unit, animate: !I, lazy: true, tap: true, marks: s.key === "speed" || s.key === "speedF" ? "peak" : true, spans: (s.key === "vibV" || s.key === "vibL" || s.key === "vibF") && A.m.cruise.length ? A.m.cruise : null, pauses: A.m.pauses }));
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
    // 데모 측정: 홈으로 가서 데모 신호로 측정 (일반 / 경사형)
    document.querySelectorAll("#demoBtns button").forEach(b => b.onclick = () => {
      if (ctl.state === "measure") { toast("측정 중에는 데모를 시작할 수 없어요."); return; }
      nav.go(1); setTimeout(() => ctl.startDemo(b.dataset.demo === "incl"), 350);
    });
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
      <g clip-path="url(#hcl)"><g class="h2-water"><path d="M60 0 q15 -6 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 v120 h-270 z" fill="url(#hw)" class="h2-wave"/></g></g>
      <circle cx="150" cy="128" r="46" fill="none" stroke="#fff" stroke-width="2"/><ellipse cx="136" cy="108" rx="16" ry="9" fill="rgba(255,255,255,.7)"/>
      <rect class="h2-txt" x="112" y="190" width="76" height="10" rx="5" fill="#9AA0B8"/><rect x="122" y="208" width="56" height="8" rx="4" fill="#C9CDDB"/>
      <rect x="112" y="240" width="76" height="20" rx="10" fill="#fff" stroke="#E1E4EF"/></svg>`;
    const s3 = `<svg viewBox="0 0 300 300" class="ill">${defs}${car}
      <g clip-path="url(#hcar)"><g class="h3-lift">${phone(132, 96, 36, 76)}</g></g>
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
      .h3-lift { animation: h3 4s cubic-bezier(.5,0,.3,1) infinite; }
      @keyframes h3 { 0%, 30% { transform: none; opacity: 1; } 75% { transform: translateY(-190px); opacity: 1; } 84%, 100% { transform: translateY(-190px); opacity: 0; } }
      .h3-badge { animation: h3b 4s ease infinite; transform-origin: 150px 49px; }
      @keyframes h3b { 0%, 55% { opacity: 0; transform: scale(.6); } 63%, 94% { opacity: 1; transform: scale(1); } 100% { opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .h1-phone, .h1-ring, .h2-water, .h2-wave, .h2-txt, .h3-lift, .h3-badge { animation: none; opacity: 1; } }
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
/** 세로로 쓸어 넘기기 (2026-11-25 사용자 확정): 간단히·자세히 모두 아래에서 위로 쓸면 서로 바뀐다
 *  (아래로 쓸기는 브라우저 '당겨서 새로 고침'과 겹쳐서 쓰지 않는다)
 *  간단히 → 자세히: 어디서든 한 번 위로 쓸면 바로 (2026-11-25 사용자 요청)
 *  자세히 → 간단히: 내용이 길어 읽으며 스크롤하므로 맨 아래에 있을 때만 받는다 (스크롤하다 갑자기 접히지 않게).
 *  터치 이벤트로 받는다: 화면이 스크롤되기 시작해도 끝까지 따라가려고 */
function vswipe(el, onToggle, canStart = () => true, isDetail = () => false) {
  let sx = 0, sy = 0, t0 = 0, on = false, atTop = false, atBottom = false;
  el.addEventListener("touchstart", e => {
    if (e.touches.length !== 1 || !canStart(e)) { on = false; return; }
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY; t0 = performance.now(); on = true;
    atTop = el.scrollTop <= 2; atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  }, { passive: true });
  el.addEventListener("touchend", e => {
    if (!on) return; on = false;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy, dt = performance.now() - t0;
    if (dt > 700 || Math.abs(dy) < 70 || Math.abs(dy) < Math.abs(dx) * 1.5) return;
    if (dy < 0 && (atBottom || !isDetail())) onToggle();
  }, { passive: true });
  el.addEventListener("touchcancel", () => { on = false; }, { passive: true });
}
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
      e => !this.overlay && !records.selecting && !records.searching && !e.target.closest("input, .seg, .switch"));
    $("#navRecords").onclick = () => this.go(0);
    $("#navHome").onclick = () => this.go(1);
    $("#navSettings").onclick = () => this.go(2);
    $("#btnHelp").onclick = () => help.open();
    // 홈(측정): 아래에서 위로 쓸면 간단히 ↔ 자세히
    const okHome = e => this.page === 1 && !this.overlay && !e.target.closest("input, .seg, .switch, .hold");
    vswipe($("#pHome"), () => { home.detail = !home.detail; home.render(); }, okHome, () => home.detail);
    // 기록 보기: 같은 방식 (자세히는 뒤로 가기 기록과 함께)
    vswipe($("#detailIn"), () => { if (!detail.rec) return; if (detail.detail) nav.back(); else { detail.setDetail(true); nav.push("recordfull"); } },
      e => !e.target.closest("input, button"), () => detail.detail);
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
    const k = st.lastIndexOf(h, st.length - 2);        // 뒤로 (여러 단계 한꺼번에 돌아온 경우 포함)
    if (k >= 0 && h !== this.top) st.length = k + 1;
    else if (h !== this.top) st.push(h);
    this.apply(h);
  },
  /** 기록 상세를 통째로 닫기 (자세히 단계까지 함께) */
  closeRecord() {
    let n = 0; for (let i = this.stack.length - 1; i > 0 && (this.stack[i] === "record" || this.stack[i] === "recordfull"); i--) n++;
    if (n) history.go(-n); else this.apply(this.top);
  },
  /** 해시 상태를 화면에 반영 (기록 스택은 건드리지 않는다) */
  apply(h) {
    if (h !== "select" && records.selecting) records.setSelecting(null);
    if (records.searching && (h === "" || h === "records" || h === "settings")) records.closeSearch();
    if (h !== "record" && h !== "recordfull" && h !== "help" && this.overlay) this.hideSheet();
    if (h === "" ) return this.showPage(1);
    if (h === "records") return this.showPage(0);
    if (h === "settings") return this.showPage(2);
    if (h === "select") { if (!records.selecting) this.replace(records.searching ? "search" : "records"); return; }
    if (h === "search") { if (!records.searching) this.replace("records"); else this.showPage(0); return; }
    if (h === "record" || h === "recordfull") {
      if (!detail.rec) { this.replace(this.page === 0 ? "records" : ""); return; }
      if (this.overlay !== "record") this.showSheet("record");
      detail.setDetail(h === "recordfull");      // 자세히에서 뒤로 가면 간단히로
      return;
    }
    if (h === "help") { if (this.overlay !== "help") { help.build(); help.go(0); this.showSheet("help"); } }
  },
  /** 탭·스와이프로 쪽 이동: 홈 ↔ 한 단계(기록 관리/설정) */
  go(i) {
    const target = i === 0 ? "records" : i === 2 ? "settings" : "";
    if (target === this.top) return this.showPage(i);
    if (!target) { const n = this.stack.length - 1; return n > 0 ? history.go(-n) : this.replace(""); }   // 검색·선택 중이어도 한 번에 홈으로
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
    ["#pRecords", "#pHome", "#pSettings"].forEach((s, k) => { const el = $(s); if (el) el.classList.toggle("cur", k === i); });
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
    document.body.classList.add("sheet-open");
  },
  hideSheet() {
    const kind = this.overlay; if (!kind) return;
    this.overlay = null;
    const el = kind === "help" ? $("#sHelp") : $("#sDetail");
    el.classList.remove("open"); el.setAttribute("aria-hidden", "true");
    document.body.classList.remove("sheet-open");
    if (kind === "record" && detail.from === "home") ctl.needDisturb = false;
  },
};

/* ───────── 오래 켜 둔 화면 되살리기 (2026-11-25) ─────────
   휴대폰에서 같은 화면을 오래 두면(화면 꺼짐·백그라운드·주소창 높이 변화) 브라우저가 캔버스를 비우거나 크기가 바뀐 채로 남아
   구슬 크기·쪽 위치·그래프가 어긋날 수 있다. 화면이 다시 보일 때, 크기가 바뀔 때, 그리고 1분마다 배치를 다시 맞춘다. */
const heal = {
  w: 0, h: 0, hiddenAt: 0, t: null,
  init() {
    this.w = innerWidth; this.h = innerHeight;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { this.hiddenAt = performance.now(); return; }
      this.run(performance.now() - this.hiddenAt > 30000);
    });
    addEventListener("pageshow", e => { if (e.persisted) this.run(true); });
    addEventListener("resize", () => { clearTimeout(this.t); this.t = setTimeout(() => this.run(false), 250); });
    if (WIDE_MQ && WIDE_MQ.addEventListener) WIDE_MQ.addEventListener("change", () => this.run(true));
    setInterval(() => { if (!document.hidden) this.run(false); }, 60000);
  },
  run(force) {
    const wide = isWide(), flip = wide !== document.documentElement.classList.contains("wide");
    if (flip) {
      document.documentElement.classList.toggle("wide", wide);
      home.layout = ""; home.render();                                   // 측정 중이어도 배치를 다시 (실시간 값은 다음 틱에 다시 채워짐)
      if (nav.overlay === "record" && detail.rec) detail.render();
    }
    const resized = Math.abs(innerWidth - this.w) > 40 || Math.abs(innerHeight - this.h) > 80;
    this.w = innerWidth; this.h = innerHeight;
    nav.place(); nav.moveOrb(); home.centerCaption();
    if ((force || resized) && ctl.state !== "measure") { home.layout = ""; home.render(); }
    charts.redrawAll();
    ctl.dirty = true;
  },
};

/* ───────── 앱 설치 (홈 화면에 추가) ───────── */
const installer = {
  evt: null,
  get installed() { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; },
  get ios() { return /iPhone|iPad|iPod/.test(navigator.userAgent); },
  init() {
    this.orient();
    if (!inPreview() && "serviceWorker" in navigator && window.isSecureContext) this.sw();
    window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); this.evt = e; this.render(); });
    window.addEventListener("appinstalled", () => { this.evt = null; this.render(); toast("elMotion을 설치했어요. 홈 화면에서 열 수 있어요."); });
    $("#btnInstall").onclick = () => this.run();
    this.render();
  },
  render() { $("#btnInstall").hidden = this.installed || inPreview(); },
  /** 설치한 앱의 화면 방향 (2026-11-25): 앱 설정은 '자유'로 두고, 폰처럼 짧은 변이 600px 미만인 기기만 세로로 묶는다.
   *  태블릿은 기기를 돌리면 가로 화면 배치로 바뀐다. 묶기를 못 하는 브라우저면 그냥 자유. */
  orient() {
    if (!this.installed || !screen.orientation || !screen.orientation.lock) return;
    const lock = () => { if (Math.min(screen.width, screen.height) < 600) screen.orientation.lock("portrait").catch(() => {}); };
    lock(); document.addEventListener("visibilitychange", () => { if (!document.hidden) lock(); });
  },
  /** 새 버전 자동 적용 (2026-11-25): 앱이 켜진 채 백그라운드에 있다 돌아와도 새 파일로 바뀌게.
   *  측정·영상 만들기·대화상자 중에는 기다렸다가, 한가해지면 한 번 새로 고친다. */
  sw() {
    const S = navigator.serviceWorker, had = !!S.controller;
    S.register("sw.js", { updateViaCache: "none" }).then(reg => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
      setInterval(check, 30 * 60 * 1000);
    }).catch(() => {});
    let pending = false, timer = 0;
    const idle = () => ctl.state === "idle" && !window.__vidBusy && $("#dlgBack").hidden;
    const apply = () => {
      if (idle()) { location.reload(); return; }
      pending = true; clearTimeout(timer); timer = setTimeout(apply, 3000);
    };
    S.addEventListener("controllerchange", () => { if (had && !pending) apply(); });
  },
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
  if (document.fonts) document.fonts.ready.then(() => { charts.redrawAll(); home.centerCaption(); });
  if (theme.mq) theme.mq.addEventListener("change", () => { if (theme.pref === "system") theme.apply(); });
  await store.open();
  settings.init();
  { const v = $("#appVer"); if (v) { v.textContent = APP_VERSION; v.onclick = () => owner.dialog(); } }   // 버전 글자: 주인 코드 입력
  ctl.init();
  glassGuard.check();
  nav.init();
  home.render();
  records.render();
  stagger($(".nav")); stagger($("#pHome"));
  installer.init();
  heal.init();
  gsync.init();                                                   // 기기 연동 (구글 드라이브)
  $("#syncBtn").onclick = () => gsync.connect();
  $("#syncNow").onclick = () => gsync.now();
  $("#syncTrash").onclick = () => gsync.trash();
  $("#syncOff").onclick = () => gsync.disconnect();
  $("#navSettings").addEventListener("click", () => gsync.preload());
  $("#navRecords").addEventListener("click", () => { if (gsync.on && gsync.tokenOk() && Date.now() - gsync.last > 60e3) gsync.soon(200); });
  $("#btnImport").onclick = () => $("#fileIn").click();
  $("#btnSearch").onclick = () => records.openSearch();
  $("#recQ").addEventListener("input", e => records.onQuery(e.target.value));
  $("#recQ").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") nav.back(); });
  $("#recQClear").onclick = () => { $("#recQ").value = ""; records.onQuery(""); $("#recQ").focus(); };
  $("#recQClose").onclick = () => nav.back();
  addEventListener("resize", () => nav.moveOrb());
  requestAnimationFrame(() => { $("#navOrb").classList.add("ready"); nav.moveOrb(); });
  $("#fileIn").onchange = e => { const f = [...e.target.files]; e.target.value = ""; records.importFiles(f); };
  $("#btnExport").onclick = () => (records.selecting ? nav.back() : records.startSelect("export"));
  $("#btnDelete").onclick = () => (records.selecting ? nav.back() : records.startSelect("delete"));
  const loop = () => { home.tick(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
