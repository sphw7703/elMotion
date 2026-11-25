/* elMotion · 가로 화면 소개 영상 (mp4) — 주인만 (2026-11-25 사용자 확정)
   2560×1190, 60프레임. 간단히의 게이지 3개 → 약 2.5초 뒤 자세히로 넘어가며 AI 평가 클로즈업 →
   줌아웃되며 수치 카드 9개와 그래프 4개(가감속도·저크·상하·좌우, 2×2)가 한 화면에 차례로 등장.
   화면을 캡처하지 않고 프레임마다 캔버스에 직접 그린 뒤 WebCodecs(H.264)로 압축하고 MP4로 묶는다. */
"use strict";
const OWNER_HASH = "9b4a0577bbb556fc2ac9bc0d0514d4b410d9ffcc010d69b6e63785c7973b23a2";
const owner = {
  get on() { return prefs.get("owner", "") === OWNER_HASH; },
  async check(code) {
    if (!(window.crypto && crypto.subtle)) return false;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(code).trim()));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("") === OWNER_HASH;
  },
  /** 설정의 버전 글자를 누르면: 비밀 코드 입력 (켜져 있으면 끄기) */
  dialog() {
    if (this.on) {
      confirmDlg("영상 만들기를 끌까요?", "이 기기에서 영상 만들기 버튼을 숨겨요.", "끄기", "취소").then(y => { if (y) { prefs.set("owner", ""); toast("영상 만들기를 껐어요."); if (detail.rec && nav.overlay === "record") detail.render(); } });
      return;
    }
    dialog(`<h3>코드</h3><input id="ownI" type="password" autocomplete="off" maxlength="40">
      <div class="acts"><button id="dC">취소</button><button class="solid" id="dS">확인</button></div>`, (b, close) => {
      const go = async () => {
        const ok = await this.check(b.querySelector("#ownI").value); close();
        if (ok) { prefs.set("owner", OWNER_HASH); toast("이 기기에서 영상 만들기를 켰어요. 기록 화면 위쪽의 영상 버튼으로 만들 수 있어요.", 4200); }
        else toast("코드가 맞지 않아요.");
      };
      b.querySelector("#dC").onclick = close; b.querySelector("#dS").onclick = go;
      b.querySelector("#ownI").onkeydown = e => { if (e.key === "Enter") go(); };
    });
  },
};

const videoMaker = (() => {
  // 출력 2560×1190 (2026-11-25 사용자 확정). 그리기는 높이 1080 기준의 가상 좌표(폭 ≈ 2323)에서 하고 U배로 키워 담는다
  const OW = 2560, OH = 1190, U = OH / 1080, W = OW / U, H = 1080, FPS = 60, DUR = 9.6;   // 그래프가 다 그려진 뒤 약 2.1초 머물고 끝
  const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const out = t => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));
  // 쫀득한 움직임 (2026-11-25 사용자 요청): 살짝 넘쳤다가 착 붙는 용수철
  const spring = t => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(9.5 * t) * (1 - t));   // 넘침 약 9%
  const glide = t => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.exp(-7 * t) * Math.cos(6.4 * t) * (1 - t * t));                         // 큰 이동: 넘침 약 3%
  // 배경: 크로마키 대신 투명으로 그리고, 색 영상 + 흑백 마스크 영상 두 개로 내보낸다 (2026-11-25, 초록 글자가 회색으로 빠지던 문제)
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const lerp = (a, b, k) => a + (b - a) * k;

  /* ───── MP4 묶기 (H.264 한 트랙) ───── */
  const enc = new TextEncoder();
  function cat(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }
  const u8 = v => Uint8Array.of(v & 255);
  const u16 = v => Uint8Array.of((v >> 8) & 255, v & 255);
  const u32 = v => Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const box = (type, ...parts) => { const body = cat(parts); return cat([u32(body.length + 8), enc.encode(type), body]); };
  const full = (type, ver, flags, ...parts) => box(type, u8(ver), Uint8Array.of((flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts);
  const zeros = n => new Uint8Array(n);
  const MATRIX = cat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);
  function mux(samples, avcC, w, h, fps) {
    const n = samples.length, durMs = Math.round(n / fps * 1000);
    const ftyp = box("ftyp", enc.encode("isom"), u32(512), enc.encode("isomiso2avc1mp41"));
    const mdatHead = cat([u32(8 + samples.reduce((a, s) => a + s.data.length, 0)), enc.encode("mdat")]);
    const keys = []; samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
    const avc1 = box("avc1", zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(w), u16(h), u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), box("avcC", avcC));
    const stbl = box("stbl",
      full("stsd", 0, 0, u32(1), avc1),
      full("stts", 0, 0, u32(1), u32(n), u32(1)),
      full("stss", 0, 0, u32(keys.length), ...keys.map(u32)),
      full("stsc", 0, 0, u32(1), u32(1), u32(n), u32(1)),
      full("stsz", 0, 0, u32(0), u32(n), ...samples.map(s => u32(s.data.length))),
      full("stco", 0, 0, u32(1), u32(ftyp.length + 8)));
    const minf = box("minf", full("vmhd", 0, 1, zeros(8)), box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))), stbl);
    const mdia = box("mdia", full("mdhd", 0, 0, u32(0), u32(0), u32(fps), u32(n), u16(0x55c4), u16(0)),
      full("hdlr", 0, 0, u32(0), enc.encode("vide"), zeros(12), enc.encode("elMotion\0")), minf);
    const trak = box("trak", full("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durMs), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(w << 16), u32(h << 16)), mdia);
    const moov = box("moov", full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(durMs), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)), trak);
    return new Blob([ftyp, mdatHead, ...samples.map(s => s.data), moov], { type: "video/mp4" });
  }

  /* ───── 그리기 도구 ───── */
  const KIND = { acc: ["#6E80D4", "#2C46BE", "#17289A"], lat: ["#BBA3B8", "#94657F", "#8A3A5A"], spd: ["#A6A3C8", "#65518E", "#452F74"] };
  const LV = { light: ["#1E8C5C", "#2E8B3E", "#A87800", "#C9580E", "#C53030"], dark: ["#5FD3A2", "#8CD99A", "#F2C94C", "#F5A15A", "#F08484"] };
  const F = (w, px) => `${w} ${px}px NanumSquareNeo, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  function rrPath(g, x, y, w, h, r) { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function wrap(g, text, maxW) {
    const words = String(text).split(" "), lines = []; let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines;
  }
  function loadImg(src) { return new Promise(ok => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; }); }

  function background(g, P) {
    if (P.key) { g.clearRect(0, 0, W, H); return; }
    if (P.dark) {
      const lg = g.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, "#0E1325"); lg.addColorStop(1, "#090C16"); g.fillStyle = lg; g.fillRect(0, 0, W, H);
      const glow = (cx, cy, rx, ry, col) => { g.save(); g.translate(cx, cy); g.scale(1, ry / rx); const r = g.createRadialGradient(0, 0, 0, 0, 0, rx); r.addColorStop(0, col); r.addColorStop(.7, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(-rx, -rx, 2 * rx, 2 * rx); g.restore(); };
      glow(0, 0, W * .7, H * .4, "rgba(63,95,203,.35)"); glow(W, H * .7, W * .6, H * .35, "rgba(79,130,235,.18)");
    } else {
      const lg = g.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, "#F2F4F9"); lg.addColorStop(1, "#E2E7F0"); g.fillStyle = lg; g.fillRect(0, 0, W, H);
      const glow = (cx, cy, rx, ry, col, col0) => { g.save(); g.translate(cx, cy); g.scale(1, ry / rx); const r = g.createRadialGradient(0, 0, 0, 0, 0, rx); r.addColorStop(0, col); r.addColorStop(.65, col0); g.fillStyle = r; g.fillRect(-rx, -rx, 2 * rx, 2 * rx); g.restore(); };
      glow(W * .15, 0, W * 1.2, H * .6, "#FFFFFF", "rgba(255,255,255,0)"); glow(W, H, W * .9, H * .5, "#D3DBEA", "rgba(211,219,234,0)");
    }
  }
  /** 글래스모피즘 판 (2026-11-25 사용자 요청): 반투명 서리 유리 + 빛 받는 테두리 + 윗면 광택 + 부드러운 그림자
   *  영상은 배경 없이(투명) 뽑으므로 판도 반투명으로 남아, 프리미어에서 아래 배경이 비친다 */
  function glassPanel(g, x, y, w, h, r) {
    const M = g.getTransform(), sc = Math.hypot(M.a, M.b);
    g.save(); rr(g, x, y, w, h, r);
    g.shadowColor = "rgba(27,42,99,.14)"; g.shadowBlur = 34 * sc; g.shadowOffsetY = 12 * sc;
    const fg = g.createLinearGradient(x, y, x + w * .6, y + h);       // 왼쪽 위가 더 하얗고 오른쪽 아래로 옅어짐
    fg.addColorStop(0, "rgba(255,255,255,.62)"); fg.addColorStop(1, "rgba(255,255,255,.34)");
    g.fillStyle = fg; g.fill(); g.shadowColor = "transparent";
    g.clip();
    const hl = g.createLinearGradient(0, y, 0, y + Math.min(h, 120));  // 윗면 광택
    hl.addColorStop(0, "rgba(255,255,255,.45)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = hl; g.fillRect(x, y, w, Math.min(h, 120));
    g.restore();
    g.save(); rr(g, x + .75, y + .75, w - 1.5, h - 1.5, r - .75);      // 빛 받는 테두리: 왼쪽 위 밝게 → 오른쪽 아래 옅게
    const bg = g.createLinearGradient(x, y, x + w, y + h);
    bg.addColorStop(0, "rgba(255,255,255,.95)"); bg.addColorStop(.5, "rgba(255,255,255,.45)"); bg.addColorStop(1, "rgba(255,255,255,.75)");
    g.strokeStyle = bg; g.lineWidth = 1.5; g.stroke(); g.restore();
  }
  function panel(g, P, x, y, w, h, r) {
    if (P.glassCard) return glassPanel(g, x, y, w, h, r);
    g.save(); rr(g, x, y, w, h, r);
    if (!P.dark) { const sc = Math.hypot(g.getTransform().a, g.getTransform().b); g.shadowColor = "rgba(27,42,99,.16)"; g.shadowBlur = 40 * sc; g.shadowOffsetY = 16 * sc; }
    // 영상: 다크 판은 다크 모드 배경색, 라이트 판은 앱 라이트 카드 색(흰 68%를 라이트 배경 위에 얹은 색) — 투명 배경 위라 불투명하게
    g.fillStyle = P.key ? (P.dark ? "#0F131B" : "#F8F9FB") : P.dark ? "rgba(255,255,255,.055)" : "rgba(255,255,255,.72)"; g.fill(); g.shadowColor = "transparent";
    g.strokeStyle = P.dark ? "rgba(255,255,255,.10)" : "rgba(255,255,255,.95)"; g.lineWidth = 1.5; g.stroke(); g.restore();
  }
  /** 유리 구슬 게이지 */
  function sphere(g, P, cx, cy, d, kind, level, main, sub, unit, t) {
    const x = cx - d / 2, y = cy - d / 2, a0 = g.globalAlpha;   // 바깥에서 준 투명도(등장·퇴장)를 모든 층이 따르게 (2026-11-25)
    if (P.glass) g.drawImage(P.glass, x, y, d, d);
    g.save(); g.beginPath(); g.ellipse(cx, cy - d * .002, d * .4775, d * .46, 0, 0, Math.PI * 2); g.clip();
    const top = cy + d * .46 - Math.max(level > 0 ? .045 : 0, level) * d * .92;
    if (level > 0) {
      const c = KIND[kind], rg = g.createRadialGradient(x + d * .3, y + d * .34, 0, x + d * .3, y + d * .34, d * .82);
      rg.addColorStop(0, c[0]); rg.addColorStop(.55, c[1]); rg.addColorStop(1, c[2]);
      g.globalCompositeOperation = P.dark ? "source-over" : "multiply"; g.globalAlpha = a0 * (P.dark ? .88 : 1);
      g.beginPath(); g.moveTo(x, y + d);
      for (let k = 0; k <= 40; k++) { const px = x + d * k / 40; g.lineTo(px, top + Math.sin(k / 40 * Math.PI * 4 + t * 1.8) * d * .012); }
      g.lineTo(x + d, y + d); g.closePath(); g.fillStyle = rg; g.fill();
      g.globalAlpha = a0; g.globalCompositeOperation = "source-over";
    }
    const vg = g.createRadialGradient(x + d * .42, y + d * .38, 0, x + d * .42, y + d * .38, d * .62); vg.addColorStop(.58, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.4)");
    g.fillStyle = vg; g.fillRect(x, y, d, d); g.restore();
    if (P.glass) { g.save(); g.globalCompositeOperation = "screen"; g.globalAlpha = a0 * (P.dark ? .75 : .38); g.drawImage(P.glass, x, y, d, d); g.restore(); }
    // 숫자: 오른쪽 정렬 묶음, 단위는 아래
    const two = sub != null, ns = d * (two ? .2 : .25), us = d * .15;
    g.save(); g.fillStyle = "#fff"; g.textBaseline = "alphabetic"; g.shadowColor = "rgba(14,20,62,.38)"; g.shadowBlur = d * .03; g.shadowOffsetX = d * .008; g.shadowOffsetY = d * .012;
    g.font = F(800, ns); const wMain = Math.max(g.measureText(main).width, two ? g.measureText(sub).width : 0);
    g.font = F(200, us); const wU = g.measureText(unit).width;
    const right = cx + Math.max(wMain, wU) / 2, lh = ns * (two ? .98 : .92), hTot = lh * (two ? 2 : 1) + us;
    let yy = cy - hTot / 2 + d * .05 + lh * .85;
    g.textAlign = "right"; g.font = F(800, ns);
    g.fillText(main, right - (two ? d * .05 : 0), yy); if (two) { yy += lh; g.fillText(sub, right - d * .05, yy); }
    g.font = F(200, us); g.fillStyle = "rgba(255,255,255,.88)"; g.fillText(unit, right + (two ? d * .05 : 0), yy + us * .95);
    g.restore();
  }
  function star(g, cx, cy, s) {
    g.save(); g.translate(cx - s / 2, cy - s / 2); g.scale(s / 15, s / 15.1); g.translate(-4.5, -2.5);
    g.fill(new Path2D("M12 2.5c.6 4.6 2.9 6.9 7.5 7.5v.1c-4.6.6-6.9 2.9-7.5 7.5h-.1c-.6-4.6-2.9-6.9-7.5-7.5V10c4.6-.6 6.9-2.9 7.5-7.5z")); g.restore();
  }
  /* AI 평가 상자 — 앱 다크 모드의 .ai-box.glass를 그대로 옮김 (2026-11-25 사용자 지정 시안)
     앱(가로 화면)보다 약 1.7배 큼: 테두리 1.5px → 2.6, 번지는 빛 띠 4px → 7, 흐림 9px → 15, 둥근 모서리 22px → 34 */
  const AS = 1.7;
  const conicOf = (g, C, cx, cy, t) => {            // 앱의 conic-gradient(from --ai-a …), 6초에 한 바퀴
    const cg = g.createConicGradient((t / 6) * Math.PI * 2 - Math.PI / 2, cx, cy);
    [...C, C[0]].forEach((c, i) => cg.addColorStop(i / C.length, c)); return cg;
  };
  const ringPath = (g, x, y, w, h, r, out, band) => {   // 상자 둘레의 띠 (바깥 out만큼 나가고 안으로 band 두께)
    g.beginPath(); rrPath(g, x - out, y - out, w + 2 * out, h + 2 * out, r + out);
    rrPath(g, x - out + band, y - out + band, w + 2 * out - 2 * band, h + 2 * out - 2 * band, Math.max(1, r + out - band));
  };
  // 라이트 AI 평가용 진한 무지개 (2026-11-25 사용자 요청 '진하게'): 앱 라이트 파스텔의 채도를 올리고 조금 어둡게
  const vivid = c => {
    let r = parseInt(c.slice(1, 3), 16) / 255, gg = parseInt(c.slice(3, 5), 16) / 255, b = parseInt(c.slice(5, 7), 16) / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); let h = 0, sat = 0, l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; sat = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (gg - b) / d + (gg < b ? 6 : 0) : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4; h /= 6; }
    sat = Math.min(1, sat * 1.4 + .08); l = l * .92;   // 중간 진하기 (2026-11-25)
    const q = l < .5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
    const f = tt => { tt = (tt + 1) % 1; return tt < 1 / 6 ? p + (q - p) * 6 * tt : tt < .5 ? q : tt < 2 / 3 ? p + (q - p) * (2 / 3 - tt) * 6 : p; };
    return "#" + [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  };
  const rgba = (c, a) => { const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  function aiFrame(g, P, x, y, w, h, t) {
    const r = 34, C = P.colors, a0 = g.globalAlpha, M = g.getTransform(), sc = Math.hypot(M.a, M.b);
    const cx = x + w / 2, cy = y + h / 2;
    const L = !P.dark;   // 라이트: 앱 라이트 모드의 .ai-box.glass (2026-11-25 사용자 요청)
    // 1) 판: 다크 = 다크 모드 배경색 / 라이트 = 라이트 배경색 + 카드처럼 부드러운 그림자
    const GL = L && P.glassCard;   // 글래스모피즘 (2026-11-25): 판이 반투명으로 남아 아래 배경이 비친다
    g.save(); rr(g, x, y, w, h, r);
    if (L) { g.shadowColor = GL ? "rgba(27,42,99,.14)" : "rgba(27,42,99,.16)"; g.shadowBlur = (GL ? 34 : 40) * sc; g.shadowOffsetY = (GL ? 12 : 16) * sc; }
    if (GL) { const fg = g.createLinearGradient(x, y, x + w * .6, y + h); fg.addColorStop(0, "rgba(255,255,255,.62)"); fg.addColorStop(1, "rgba(255,255,255,.34)"); g.fillStyle = fg; }
    else g.fillStyle = L ? "#E9EDF5" : "#0F131B";
    g.fill(); g.restore();
    // 2) 번지는 빛 (.ai-glow): 무지개 띠를 흐려 테두리 안쪽으로 은은하게 — 상자 밖으로는 내보내지 않는다
    //    (앱 다크 화면에서도 바깥 빛은 거의 안 보이고, 영상 합성 때 바깥 반투명 빛이 배경과 섞여 띠가 생겨서, 2026-11-25)
    g.save(); rr(g, x, y, w, h, r); g.clip(); g.filter = `blur(${((L ? 8 : 9) * AS * sc).toFixed(1)}px)`; g.globalAlpha = a0 * (L ? 1 : .75);
    ringPath(g, x, y, w, h, r, 1 * AS, (L ? 5 : 4) * AS + 1 * AS); g.fillStyle = conicOf(g, C, cx, cy, t); g.fill("evenodd");
    g.restore();
    // 3) 유리 판(surface) + 모서리에 고인 색
    //    다크: 흰 5.5% · 오른쪽 아래 c3 14% · 왼쪽 위 c1 10% / 라이트: 흰 68% · 오른쪽 아래 c5 16% · 왼쪽 위 흰 50%
    g.save(); rr(g, x, y, w, h, r); g.clip();
    if (GL) { const hl = g.createLinearGradient(0, y, 0, y + Math.min(h, 120)); hl.addColorStop(0, "rgba(255,255,255,.45)"); hl.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = hl; g.fillRect(x, y, w, Math.min(h, 120)); }   // 윗면 광택
    else { g.fillStyle = L ? "rgba(255,255,255,.58)" : "rgba(255,255,255,.055)"; g.fillRect(x, y, w, h); }
    const tint = (ex, ey, rx, ry, c, al) => { g.save(); g.translate(ex, ey); g.scale(1, ry / rx); const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      rg.addColorStop(0, rgba(c, al)); rg.addColorStop(.6, rgba(c, 0)); g.fillStyle = rg; g.fillRect(-rx, -rx, 2 * rx, 2 * rx); g.restore(); };
    if (L) { tint(x + w, y + h, w * .9, h * 1.2, C[4], .19); tint(x, y, w * .7, h * .9, "#FFFFFF", GL ? .3 : .48); }
    else { tint(x + w, y + h, w * .9, h * 1.2, C[2], .14); tint(x, y, w * .7, h * .9, C[0], .10); }
    g.restore();
    // 4) 또렷한 무지개 테두리 (.ai-box.glass::before): 바깥 1px, 두께 1.5px
    g.save(); ringPath(g, x, y, w, h, r, 1 * AS, (L ? 1.9 : 1.5) * AS); g.fillStyle = conicOf(g, C, cx, cy, t); g.fill("evenodd"); g.restore();
  }
  /** AI 평가 내용 (유리 칩 + 글). (x, y): 상자 왼쪽 위, k: 배율 */
  function aiContent(g, P, x, y, t, L, k) {
    const C = P.colors;
    g.save(); g.translate(x, y); g.scale(k, k);
    const chipH = 52, cx0 = 30, cy0 = 26; g.font = F(800, 22); const tw = g.measureText("AI 평가").width, chipW = 22 + 24 + 9 + tw + 22;
    const a0 = g.globalAlpha, M = g.getTransform(), sc = Math.hypot(M.a, M.b), R = chipH / 2, ccx = cx0 + chipW / 2, ccy = cy0 + chipH / 2;
    // 칩 = 앱의 유리 구슬 칩 (2026-11-25 사용자 지정 시안), 앱 30px 칩의 약 1.7배. P.dark면 다크, 아니면 라이트
    const D = P.dark;
    // 바깥 빛 — 다크: -6px 0 16px -5px c1 75% · 6px 2px 16px -5px c4 80% / 라이트: -6px 2px 14px -6px c1 90% · 6px 3px 14px -6px c5 90%
    const glow = (dx, dy, c, al, bl, sp0) => { g.save(); g.filter = `blur(${(bl / 2 * AS * sc).toFixed(1)}px)`; g.globalAlpha = a0;
      const sp = sp0 * AS; rr(g, cx0 + sp + dx, cy0 + sp + dy, chipW - 2 * sp, chipH - 2 * sp, R - sp); g.fillStyle = rgba(c, al); g.fill(); g.restore(); };
    if (D) { glow(-6 * AS, 0, C[0], .75, 16, 5); glow(6 * AS, 2 * AS, C[3], .8, 16, 5); }
    else { glow(-6 * AS, 2 * AS, C[0], .9, 14, 6); glow(6 * AS, 3 * AS, C[4], .9, 14, 6); }
    g.save(); rr(g, cx0, cy0, chipW, chipH, R); g.clip();
    g.fillStyle = D ? "#191428" : "#F4F2FB"; g.fillRect(cx0, cy0, chipW, chipH);
    // 안에서 번진 색 덩어리 6개가 천천히 소용돌이 (9초에 한 바퀴) — 다크: blur 6px · saturate 120% · 85% / 라이트: blur 7px · 115% · 95%
    g.save(); g.filter = `blur(${((D ? 6 : 7) * AS * sc).toFixed(1)}px) saturate(${D ? 120 : 115}%)`; g.globalAlpha = a0 * (D ? .85 : .95);
    g.translate(ccx, ccy); g.rotate((t / 9) * Math.PI * 2);
    const B = 150 * AS, blobs = [[.28, .32, 0, .12, .34], [.72, .30, 1, .10, .32], [.70, .70, 4, .12, .34], [.30, .72, 3, .10, .32], [.5, .5, 5, .14, .40], [.5, .12, 2, .08, .28]];
    blobs.forEach(([px, py, ci, s0, s1]) => {
      const bx = (px - .5) * B, by = (py - .5) * B, far = Math.hypot(Math.max(px, 1 - px), Math.max(py, 1 - py)) * B;
      const rg = g.createRadialGradient(bx, by, 0, bx, by, far * s1); rg.addColorStop(0, C[ci]); rg.addColorStop(s0 / s1, C[ci]); rg.addColorStop(1, rgba(C[ci], 0));
      g.fillStyle = rg; g.fillRect(-B / 2, -B / 2, B, B);
    });
    g.restore();
    // 윗면 광택 — 다크: .28 → 0 (45%) · 0 (70%) → .12 / 라이트: .62 → .12 (48%) → 0 (60%) → .25
    const gl = g.createLinearGradient(0, cy0, 0, cy0 + chipH);
    if (D) { gl.addColorStop(0, "rgba(255,255,255,.28)"); gl.addColorStop(.45, "rgba(255,255,255,0)"); gl.addColorStop(.7, "rgba(255,255,255,0)"); gl.addColorStop(1, "rgba(255,255,255,.12)"); }
    else { gl.addColorStop(0, "rgba(255,255,255,.62)"); gl.addColorStop(.48, "rgba(255,255,255,.12)"); gl.addColorStop(.6, "rgba(255,255,255,0)"); gl.addColorStop(1, "rgba(255,255,255,.25)"); }
    g.fillStyle = gl; g.fillRect(cx0, cy0, chipW, chipH);
    // 안쪽 빛 (다크만): inset 0 0 8px rgba(255,210,240,.35)
    if (D) { g.save(); g.filter = `blur(${(4 * AS * sc).toFixed(1)}px)`; rr(g, cx0, cy0, chipW, chipH, R); g.lineWidth = 8 * AS; g.strokeStyle = "rgba(255,210,240,.35)"; g.stroke(); g.restore(); }
    g.restore();
    // 가는 빛 테두리 — 다크: rgba(255,225,245,.55) / 라이트: 흰 75% + 바깥 c6 70% 0.5px
    if (!D) { rr(g, cx0 - AS / 4, cy0 - AS / 4, chipW + AS / 2, chipH + AS / 2, R + AS / 4); g.lineWidth = AS / 2; g.strokeStyle = rgba(C[5], .7); g.stroke(); }
    rr(g, cx0 + AS / 2, cy0 + AS / 2, chipW - AS, chipH - AS, R - AS / 2); g.lineWidth = AS; g.strokeStyle = D ? "rgba(255,225,245,.55)" : "rgba(255,255,255,.75)"; g.stroke();
    // 별 + 글: 흰색, 0 0 6px rgba(255,220,245,.55) 빛
    g.save(); if (D) { g.shadowColor = "rgba(255,220,245,.55)"; g.shadowBlur = 6 * AS * sc; } g.fillStyle = D ? "#fff" : "#141C38";
    star(g, cx0 + 22 + 12, ccy, 24);
    g.textBaseline = "middle"; g.textAlign = "left"; g.font = F(800, 22); g.fillText("AI 평가", cx0 + 22 + 24 + 9, ccy + 1);
    g.restore();
    g.fillStyle = P.ink; g.font = F(800, L.fs); g.textBaseline = "alphabetic";
    L.lines.forEach((l, i) => g.fillText(l, cx0 + chipW + 26, 26 + L.fs * .9 + 6 + i * L.lh));
    g.restore();
  }
  /** 칩 옆에 글을 맞춰 놓을 때 필요한 상자 크기 (배율 1 기준) */
  function aiLayout(g, text, w, fs, lh) {
    g.font = F(800, 22); const chipW = 22 + 24 + 9 + g.measureText("AI 평가").width + 22;
    g.font = F(800, fs); const lines = wrap(g, text, w - 30 - chipW - 26 - 36);
    return { lines, fs, lh, w, h: Math.max(104, 26 + 10 + lines.length * lh + 26) };
  }
  function card(g, P, c, x, y, w, h) {
    panel(g, P, x, y, w, h, 28);
    g.save(); g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillStyle = P.ink2; g.font = F(800, 21); g.fillText(c.l, x + 20, y + 40);
    if (c.v2) {
      c.v2.forEach(([k, v], i) => { g.fillStyle = P.ink3; g.font = F(700, 17); g.fillText(k, x + 20, y + 84 + i * 38); g.fillStyle = P.ink; g.font = F(800, 32); g.fillText(v, x + 64, y + 86 + i * 38); });
      g.fillStyle = P.ink3; g.font = F(400, 17); g.fillText(c.u, x + 20, y + 152);
    } else {
      g.fillStyle = P.ink; g.font = F(800, 42); g.fillText(c.v, x + 20, y + 98);
      g.fillStyle = P.ink3; g.font = F(400, 18); g.fillText(c.u, x + 20, y + 126);
    }
    const lines = c.e2 || [c.e]; g.font = F(800, c.e2 ? 15 : 18);
    g.fillStyle = c.lv >= 0 ? (P.dark ? LV.dark : LV.light)[c.lv] : P.ink2;
    const all = []; lines.forEach(l => wrap(g, l, w - 36).forEach(z => all.push(z)));
    all.forEach((l, i) => g.fillText(l, x + 20, y + h - 22 - (all.length - 1 - i) * (c.e2 ? 21 : 24)));
    g.restore();
  }

  /** 기록 하나 → 영상 */
  /** 영상 = 색 영상 + 흑백 마스크 영상 두 개 (2026-11-25 사용자 확정: 프리미어 '트랙 매트 키' · '매트 루마') */
  async function make(rec, onProgress, isCancelled, stillAt) {
    if (stillAt == null && typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") throw new Error("이 브라우저는 영상 만들기를 지원하지 않아요. 크롬 최신 버전에서 해 주세요.");
    // 2560×1190은 H.264 레벨 5.1 이상이 필요하다
    const cfgs = ["avc1.640033", "avc1.640034", "avc1.4D4033", "avc1.420033", "avc1.640032"].map(codec => ({ codec, width: OW, height: OH, bitrate: 22e6, framerate: FPS, avc: { format: "avc" }, latencyMode: "quality" }));
    let cfg = null; if (stillAt == null) for (const c of cfgs) { try { if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; } } catch (e) { /* 다음 */ } }
    if (!cfg && stillAt == null) throw new Error("이 기기에서는 2560×1190 영상을 만들 수 없어요.");

    const A = analysisOf(rec), m = A.m, ev = m.eval, S = A.series, dark = false;   // 앱이 다크 모드여도 게이지 장면은 항상 라이트 디자인(확정 시안) (2026-11-25)
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const pal = (dark ? RAINBOW.dark : RAINBOW.light).slice(); for (let i = pal.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pal[i], pal[j]] = [pal[j], pal[i]]; }
    try { await document.fonts.load(F(800, 40)); await document.fonts.load(F(200, 40)); await document.fonts.load(F(400, 20)); } catch (e) { /* 기본 글꼴 */ }
    const P = { key: true, dark, ink: "#131A2B", ink2: "#48526A", ink3: "#8691A7", colors: pal, glass: await loadImg(dark ? "assets/glass-dark.webp" : "assets/glass.webp") };
    // 게이지가 사라진 뒤의 장면은 모두 다크 모드 디자인 (2026-11-25 사용자 확정). 무지개 순서는 같게
    const order = pal.map(c => (dark ? RAINBOW.dark : RAINBOW.light).indexOf(c));
    const P2 = { key: true, dark: true, ink: "#EEF2FF", ink2: "#A6B0CC", ink3: "#6B7594", colors: order.map(i => RAINBOW.dark[i]), glass: P.glass };
    const P3 = Object.assign({}, P2, { dark: false, ink: "#141C38", ink2: "#4E5876", ink3: "#8D96AE", colors: order.map(i => RAINBOW.light[i]), glassCard: true });   // AI 평가 무지개: 앱 라이트 파스텔 그대로 (2026-11-25 사용자 확정)   // AI 평가·수치 카드·그래프: 라이트 (2026-11-25)
    const DARK_CSS = { "--ink": "#EEF2FF", "--ink-2": "#A6B0CC", "--ink-3": "#6B7594", "--line": "rgba(255, 255, 255, .08)" };
    // 수치 카드·그래프는 라이트 모드 디자인 (2026-11-25 사용자 요청). AI 평가 상자는 다크 그대로
    const LIGHT_CSS = { "--ink": "#141C38", "--ink-2": "#4E5876", "--ink-3": "#8D96AE", "--line": "rgba(20, 28, 56, .08)", "--bg": "#E9EDF5" };

    const cv = document.createElement("canvas"); cv.width = OW; cv.height = OH; const g = cv.getContext("2d");
    // 장면 1: 간단히 게이지 3개
    const gauges = [
      { k: "acc", lbl: "가감속도", lv: m.accPeak / LEGEND.acc, a: m.accMax.toFixed(2), bv: m.decMax.toFixed(2), u: "m/s²" },
      { k: "lat", lbl: "좌우 흔들림", lv: m.vibL && m.vibL.n ? m.vibL.a95 / LEGEND.latA : 0, a: m.vibL && m.vibL.n ? m.vibL.a95.toFixed(1) : "—", bv: null, u: "gal" },
      { k: "spd", lbl: "속력", lv: m.speedMax / LEGEND.spd, a: m.speedMax.toFixed(1), bv: null, u: "m/min" },
    ];
    // 게이지 아래 글 (간단히 화면과 같은 내용): 위 라벨은 앱의 3배, 아래 글은 2배 (1920 폭 기준 76 · 64 · 44px)
    const sent = x => (/[.!?요]$/.test(x) ? (/[요]$/.test(x) ? x + "." : x) : x + ".");
    const accB = /^가속은 .+ 감속은 /.test(ev.acc.t) ? ev.acc.t.replace(/ 감속은 /, ",\n감속은 ").split("\n").map((l, i) => (i ? sent(l) : l)) : [sent(ev.acc.t)];
    gauges[0].b = accB; gauges[0].bl = -1; gauges[0].p = "";                                     // '가속 최대 ~' 줄은 뺌 (사용자 확정)
    if (m.vibL && m.vibL.n) { gauges[1].b = [ev.vibL.s]; gauges[1].bl = ev.vibL.lv; gauges[1].bScale = 1.3; /* '좋음' 같은 등급 글자는 130% */ gauges[1].p = ev.vibL.line.replace(/ · 약 [\d.]+ Hz$/, ""); /* '약 7.5 Hz'는 뺌 */ }
    else { gauges[1].b = ["기록이 없어요."]; gauges[1].bl = -1; gauges[1].p = ""; }
    gauges[2].b = [ev.speed.t.replace(/요$/, "요.")]; gauges[2].bl = 0; gauges[2].p = "";
    // 게이지: 크기는 예전(400)의 125% → 500, 사이 빈틈은 예전(가운데 간격 W/3 ≈ 774 − 400 = 374)의 1/2 → 187 (2026-11-25 사용자 확정)
    const G1 = { lbl: 76, lblF: 114, drop: 50, b: 64, bLh: 80, p: 44, pLh: 56, d: 500, gap: 500 + (W / 3 - 400) / 2 };
    G1.colW = G1.gap - 30;   // lbl: 자리 계산용, lblF: 실제 글자(1.5배)
    G1.sp = (G1.lbl * .15 + 30 + G1.drop) * .8;   // 제목 글 ↔ 게이지 간격: 원래의 80% (2026-11-25)
    // 숫자와 단위, '약 7.5 Hz' 같은 묶음은 줄이 바뀌어도 떨어지지 않게 붙여 둔다
    const glue = x => x.replace(/(최대|약) ([\d.]+)/g, "$1\u00a0$2").replace(/([\d.]+) (m\/s²|gal|m\/min|Hz)/g, "$1\u00a0$2").replace(/ · /g, "\u00a0· ");
    // 큰 글은 정해 둔 줄 그대로 (가속 줄·감속 줄), 작은 글만 옆 게이지 글과 겹치지 않을 폭에서 줄바꿈
    g.font = F(400, G1.p); gauges.forEach(q => { q.pl = q.p ? wrap(g, glue(q.p), G1.colW - 60) : []; });
    g.font = F(800, G1.b); gauges.forEach(q => { q.bl2 = q.b.slice(); });
    const colH = q => G1.lbl + G1.sp + G1.d + 40 + q.bl2.length * G1.bLh * (q.bScale || 1) + (q.pl.length ? 12 + q.pl.length * G1.pLh : 0);
    const G1top = Math.max(40, (H - Math.max(...gauges.map(colH))) / 2);
    // 자세히 배치 (1920 폭의 긴 쪽 위 좌표)
    const MX = 120, CW = W - 2 * MX;
    // AI 평가: 클로즈업 때는 글자를 크게 한 상자(배율 KH)로 화면 가운데에, 줌아웃되며 자세히의 자리로 옮겨 간다
    const LP = aiLayout(g, ev.overall, CW, 34, 50);
    const ai = { x: MX, y: 80, w: CW, h: LP.h };
    const KH = 1.5, LH = aiLayout(g, ev.overall, (W - 260) / KH, 34, 50);
    const hero = { w: LH.w * KH, h: LH.h * KH }; hero.x = (W - hero.w) / 2; hero.y = (H - hero.h) / 2;
    const NO = "기록이 없어요.";
    const gal = (v, gr) => (v == null ? { v: "—", u: "", e: NO, lv: -1 } : { v: v.toFixed(0), u: "gal", e: gr.s, lv: gr.lv });
    const cards = [
      m.jerk == null ? { l: "저크", v: "—", u: "", e: NO, lv: -1 } : { l: "저크", v: m.jerk.toFixed(2), u: "m/s³", e: ev.jerk.s, lv: ev.jerk.lv },
      { l: "가감속도", v2: [["가속", m.accMax.toFixed(2)], ["감속", m.decMax.toFixed(2)]], u: "m/s²", e2: [`가속 ${ev.acc.a}`, `감속 ${ev.acc.d}`], lv: -1 },
      { l: "속력", v: m.speedMax.toFixed(1), u: "m/min", e: ev.speed.card || (m.speedMax <= 500 ? `${ev.speed.s} 승강기` : ev.speed.s), lv: -1 },
      { l: "운행 거리", v: m.distance.toFixed(1), u: "m", e: Math.round(m.distance / 3) >= 1 ? `건물 약 ${Math.round(m.distance / 3)}층 높이` : "거의 움직이지 않았어요", lv: -1 },
      { l: "상하 흔들림", ...(m.vibV && m.vibV.n ? { v: m.vibV.a95.toFixed(1), u: "gal", e: ev.vibV.s, lv: ev.vibV.lv } : { v: "—", u: "", e: NO, lv: -1 }) },
      { l: "좌우 흔들림", ...(m.vibL && m.vibL.n ? { v: m.vibL.a95.toFixed(1), u: "gal", e: ev.vibL.s, lv: ev.vibL.lv } : { v: "—", u: "", e: NO, lv: -1 }) },
      { l: "출발 거칠기", ...gal(m.start, ev.start) }, { l: "가감속 울렁임", ...gal(m.wave, ev.wave) }, { l: "도착 거칠기", ...gal(m.arrive, ev.arrive) },
    ];
    const CG = 14, cw = (CW - CG * 8) / 9, ch = 214, cy0 = ai.y + ai.h + 34;
    // 그래프 4개 (속력 제외, 사용자 확정): 그래프 그리기는 앱의 Chart를 그대로 쓴다 (화면 밖 캔버스)
    const keys = ["acc", "jerk", "vibV", "vibL"].filter(k => k !== "vibL" || (m.vibL && m.vibL.n));
    const GG = 26, gw = (CW - GG) / 2, gy0 = cy0 + ch + 30, gh = Math.floor((H - 36 - gy0 - GG) / 2);
    // 2026-11-25: 스크롤 없이 카드 아래 한 화면에. 폭은 카드 줄에 맞춰 좌우로 길게, 높이만 남은 자리에 맞춘다
    const GK = 1, gx0 = MX;
    const host = document.createElement("div"); host.style.cssText = `position:fixed;left:-99999px;top:0;width:${gw - 20}px;`; document.body.appendChild(host);
    const charts4 = keys.map(k => {
      const s = SERIES.find(x => x.key === k), c = document.createElement("canvas");
      c.style.cssText = `display:block;width:${gw - 20}px;height:${gh - 74}px`; host.appendChild(c);
      const comment = { acc: ev.acc.s, jerk: ev.jerk.s, vibV: ev.vibV.s, vibL: ev.vibL ? ev.vibL.s : "" }[k];
      const chObj = new Chart(c, { values: S[k], rate: rec.rate, color: s.color, half: s.half, dec: s.dec, unit: s.unit, animate: false, marks: true, spans: (k === "vibV" || k === "vibL") && m.cruise.length ? m.cruise : null, pauses: m.pauses });
      return { s, c, ch: chObj, comment };
    });

    // 시간표 (초)
    // 2026-11-25: 게이지·AI 평가는 움직임이 멎은 뒤 1초만 보여 주고, 그래프는 카드와 함께 한 화면에 차례로 등장
    //  게이지는 약 1.8초, AI 평가 상자는 등장 후 약 0.6초에 멎는다
    const T = { gIn: 0, gOut: 2.8, aiIn: 3.1, zoom: 4.7, zoomEnd: 5.9, cardsIn: 5.3, cardGap: .07, chartGap: .1 };
    T.chartsIn = T.cardsIn + cards.length * T.cardGap;                // 카드 9개에 이어 그래프 4개가 차례로 (한 물결)
    const drawFrame = t => {
      g.setTransform(U, 0, 0, U, 0, 0); g.globalAlpha = 1; g.filter = "none";
      background(g, P);
      // ── 장면 1: 게이지
      const kOut = ease(seg(t, T.gOut, T.gOut + .55));
      if (kOut < 1) {
        g.save(); g.globalAlpha = 1 - kOut; g.translate(W / 2, H / 2); g.scale(1 + kOut * .06, 1 + kOut * .06); g.translate(-W / 2, -H / 2 - kOut * 40);
        const d = G1.d, gap = G1.gap;
        gauges.forEach((q, i) => {
          const t0 = .15 + i * .12, kIn = spring(seg(t, t0, t0 + .9)), kA = out(seg(t, t0, t0 + .35)), x = W / 2 + (i - 1) * gap;
          const yL = G1top + G1.lbl, y = G1top + G1.lbl + G1.sp + d / 2;
          g.save(); g.globalAlpha *= kA; g.translate(x, y); g.scale(.7 + .3 * kIn, .7 + .3 * kIn); g.translate(-x, -y);
          g.fillStyle = P.ink2; g.font = F(800, G1.lblF); g.textAlign = "center"; g.textBaseline = "alphabetic"; g.fillText(q.lbl, x, yL);
          const lv = clamp(q.lv, q.a === "—" ? 0 : .03, 1) * glide(seg(t, .5 + i * .15, 2.1 + i * .15));
          sphere(g, P, x, y, d, q.k, lv, q.a, q.bv, q.u, t);
          g.restore();
          // 아래 글: 게이지보다 살짝 늦게 통 올라옴
          const kT = spring(seg(t, t0 + .25, t0 + 1.15)), kTA = out(seg(t, t0 + .25, t0 + .6));
          g.save(); g.globalAlpha *= kTA; g.translate(0, (1 - kT) * 46); g.textAlign = "center";
          const bs = q.bScale || 1;
          let yy = y + d / 2 + 40 + G1.b * bs * .82;
          g.font = F(800, G1.b * bs); g.fillStyle = q.bl >= 0 ? (P.dark ? LV.dark : LV.light)[q.bl] : P.ink;
          q.bl2.forEach(l => { g.fillText(l, x, yy); yy += G1.bLh * bs; });
          g.font = F(400, G1.p); g.fillStyle = P.ink2; yy += 12 - G1.bLh * bs + G1.pLh;
          q.pl.forEach(l => { g.fillText(l, x, yy); yy += G1.pLh; });
          g.restore();
        });
        g.restore();
      }
      // ── 장면 2~4: 자세히 (카메라: 클로즈업 → 줌아웃 → 스크롤)
      if (t >= T.gOut + .2) {
        const fade = out(seg(t, T.gOut + .2, T.aiIn + .5));
        const z = glide(seg(t, T.zoom, T.zoomEnd + .3));
        // 줌아웃: 카드·그래프는 크게 다가와 있던 데서 제자리로 (가운데 기준 1.25 → 1)
        const s = lerp(1.25, 1, z), fy = H / 2;
        g.save(); g.globalAlpha = fade; g.translate(W / 2, H / 2); g.scale(s, s); g.translate(-W / 2, -fy);
        // AI 평가: 클로즈업 상자 → 자세히 자리 (테두리는 하나로 옮겨 가고, 글은 큰 글 → 보통 글로 겹쳐 바뀜)
        {
          const aiK = out(seg(t, T.aiIn, T.aiIn + .45)), aiS = spring(seg(t, T.aiIn, T.aiIn + 1.0));
          g.save(); g.setTransform(U, 0, 0, U, 0, 0); g.globalAlpha = fade * aiK;
          if (aiS < 1 && z === 0) { g.translate(W / 2, H / 2); g.scale(.82 + .18 * aiS, .82 + .18 * aiS); g.translate(-W / 2, -H / 2); }
          const R = { x: lerp(hero.x, ai.x, z), y: lerp(hero.y, ai.y, z), w: lerp(hero.w, ai.w, z), h: lerp(hero.h, ai.h, z) };
          aiFrame(g, P3, R.x, R.y, R.w, R.h, t);
          g.save(); rr(g, R.x, R.y, R.w, R.h, 34); g.clip();
          const kz = lerp(KH, 1, z), zc = clamp(z, 0, 1);
          const zh = clamp(1 - 2 * zc, 0, 1), zp = clamp(2 * zc - 1, 0, 1);          // 앞 절반은 큰 글이 사라지고, 뒤 절반에 보통 글이 나타남
          if (zh > 0) { g.globalAlpha = fade * aiK * zh; aiContent(g, P3, R.x, R.y, t, LH, kz); }
          if (zp > 0) { g.globalAlpha = fade * aiK * zp; aiContent(g, P3, R.x, R.y, t, LP, kz); }
          g.restore(); g.restore();
        }
        cards.forEach((c, i) => {
          const t0 = T.cardsIn + i * T.cardGap, k = out(seg(t, t0, t0 + .3)), kS = spring(seg(t, t0, t0 + .85)); if (k <= 0) return;
          const x = MX + i * (cw + CG) + cw / 2, y = cy0 + ch / 2;
          g.save(); g.globalAlpha *= k; g.translate(x, y + (1 - kS) * 60); g.scale(.85 + .15 * kS, .85 + .15 * kS); g.translate(-x, -y);
          card(g, P3, c, MX + i * (cw + CG), cy0, cw, ch); g.restore();
        });
        charts4.forEach((q, i) => {
          const t0 = T.chartsIn + i * T.chartGap, k = out(seg(t, t0, t0 + .3)), kS = spring(seg(t, t0, t0 + .9)); if (k <= 0) return;
          const x = (i % 2) * (gw + GG), y = Math.floor(i / 2) * (gh + GG);
          g.save(); g.translate(gx0, gy0); g.scale(GK, GK); g.globalAlpha *= k; g.translate(x + gw / 2, y + gh / 2 + (1 - kS) * 70); g.scale(.9 + .1 * kS, .9 + .1 * kS); g.translate(-x - gw / 2, -y - gh / 2);
          panel(g, P3, x, y, gw, gh, 30);
          g.textBaseline = "alphabetic"; g.textAlign = "left"; g.fillStyle = P3.ink; g.font = F(800, 26); g.fillText(q.s.title, x + 24, y + 48);
          const tw = g.measureText(q.s.title).width; g.fillStyle = P3.ink3; g.font = F(400, 19); g.fillText(q.s.unit, x + 24 + tw + 10, y + 48);
          g.textAlign = "right"; g.font = F(700, 19); g.fillText(q.comment || "", x + gw - 24, y + 48);
          q.ch.prog = ease(seg(t, t0 + .1, t0 + 1.2)); q.ch.cursor = -1; window.__cssOverride = LIGHT_CSS; try { q.ch.draw(); } finally { window.__cssOverride = null; }
          g.drawImage(q.c, x + 10, y + 64, gw - 20, gh - 74);
          g.restore();
        });
        g.restore();
      }
    };

    // 모션 블러 (2026-11-25 사용자 요청): 움직이는 구간은 프레임 반 동안(셔터 180°) 4번 그려 평균, 멈춘 구간은 한 번
    const fcv = document.createElement("canvas"); fcv.width = OW; fcv.height = OH; const fg = fcv.getContext("2d", { willReadFrequently: true });
    const MOVING = [[.1, 2.4], [T.gOut - .05, T.aiIn + 1.1], [T.zoom - .05, Math.max(T.zoomEnd + .9, T.chartsIn + 3 * T.chartGap + 1.3)]];
    const renderFrame = t => {
      const K = MOVING.some(([a, b]) => t >= a && t <= b) ? 4 : 1;
      fg.globalCompositeOperation = "copy"; fg.globalAlpha = 1;
      if (K === 1) { drawFrame(t); fg.drawImage(cv, 0, 0); fg.globalCompositeOperation = "source-over"; return; }
      fg.clearRect(0, 0, OW, OH); fg.globalCompositeOperation = "lighter"; fg.globalAlpha = 1 / K;   // 투명도까지 함께 평균 (곱해진 색끼리 더하기)
      for (let j = 0; j < K; j++) { drawFrame(t + (j / (K - 1) - .5) * (.5 / FPS)); fg.drawImage(cv, 0, 0); }
      fg.globalCompositeOperation = "source-over"; fg.globalAlpha = 1;
    };
    if (stillAt != null) {            // 한 장면만 그림으로
      try { renderFrame(stillAt); return await new Promise(ok => fcv.toBlob(ok, "image/png")); }
      finally { charts4.forEach(q => q.ch.destroy()); host.remove(); }
    }
    // 한 프레임을 색 영상 · 마스크 영상으로 나눈다
    //  색: 투명도를 뺀 원래 색(반투명한 곳도 제 색 그대로). 완전히 투명한 곳은 둘레 2px까지 옆 색을 번져 채워
    //      색 압축(4:2:0)이 가장자리에 검은 테를 만들지 않게 하고, 나머지는 검정
    //  마스크: 흰색 = 보임, 검정 = 투명, 그 사이 회색 = 반투명 (프리미어 '트랙 매트 키'의 '매트 루마')
    const PX = OW * OH, colBuf = new Uint8ClampedArray(PX * 4), matBuf = new Uint8ClampedArray(PX * 4), has = new Uint8Array(PX);
    const split = () => {
      const d = fg.getImageData(0, 0, OW, OH).data;
      for (let i = 0, j = 0; i < PX; i++, j += 4) {
        const a = d[j + 3]; matBuf[j] = matBuf[j + 1] = matBuf[j + 2] = a; matBuf[j + 3] = 255;
        if (a) { colBuf[j] = d[j]; colBuf[j + 1] = d[j + 1]; colBuf[j + 2] = d[j + 2]; has[i] = 2; } else { colBuf[j] = colBuf[j + 1] = colBuf[j + 2] = 0; has[i] = 0; }
        colBuf[j + 3] = 255;
      }
      const copy = (to, from) => { const a = to * 4, b = from * 4; colBuf[a] = colBuf[b]; colBuf[a + 1] = colBuf[b + 1]; colBuf[a + 2] = colBuf[b + 2]; has[to] = 1; };
      for (let y = 0; y < OH; y++) {                       // 가로로 2px
        const r = y * OW;
        for (let x = 1; x < OW; x++) if (!has[r + x] && has[r + x - 1] === 2) { copy(r + x, r + x - 1); if (x + 1 < OW && !has[r + x + 1]) { copy(r + x + 1, r + x); x++; } }
        for (let x = OW - 2; x >= 0; x--) if (!has[r + x] && has[r + x + 1] === 2) { copy(r + x, r + x + 1); if (x > 0 && !has[r + x - 1]) { copy(r + x - 1, r + x); x--; } }
      }
      for (let i = 0; i < PX; i++) if (has[i]) has[i] = 2;
      for (let x = 0; x < OW; x++) {                       // 세로로 2px
        for (let y = 1; y < OH; y++) { const i = y * OW + x; if (!has[i] && has[i - OW] === 2) { copy(i, i - OW); if (y + 1 < OH && !has[i + OW]) { copy(i + OW, i); y++; } } }
        for (let y = OH - 2; y >= 0; y--) { const i = y * OW + x; if (!has[i] && has[i + OW] === 2) { copy(i, i + OW); if (y > 0 && !has[i - OW]) { copy(i - OW, i); y--; } } }
      }
    };
    const mkEnc = () => {
      const o = { samples: [], avcC: null, err: null };
      o.enc = new VideoEncoder({
        output: (chunk, meta) => { const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); o.samples.push({ data: d, key: chunk.type === "key" });
          if (!o.avcC && meta && meta.decoderConfig && meta.decoderConfig.description) o.avcC = new Uint8Array(meta.decoderConfig.description.buffer ? meta.decoderConfig.description.buffer.slice(0) : meta.decoderConfig.description); },
        error: e => { o.err = e; },
      });
      o.enc.configure(cfg); return o;
    };
    const E1 = mkEnc(), E2 = mkEnc();
    const N = Math.round(DUR * FPS);
    try {
      for (let i = 0; i < N; i++) {
        if (E1.err || E2.err) throw E1.err || E2.err;
        if (isCancelled && isCancelled()) throw new Error("취소");
        renderFrame(i / FPS);
        const ts = { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) }, key = { keyFrame: i % (FPS * 2) === 0 };
        split();
        const f1 = new VideoFrame(colBuf, Object.assign({ format: "RGBX", codedWidth: OW, codedHeight: OH }, ts)); E1.enc.encode(f1, key); f1.close();
        const f2 = new VideoFrame(matBuf, Object.assign({ format: "RGBX", codedWidth: OW, codedHeight: OH }, ts)); E2.enc.encode(f2, key); f2.close();
        while (E1.enc.encodeQueueSize > 4 || E2.enc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 4));
        if (i % 6 === 0) { onProgress && onProgress(i / N); await new Promise(r => setTimeout(r, 0)); }
      }
      await E1.enc.flush(); await E2.enc.flush();
    } finally {
      for (const o of [E1, E2]) { try { o.enc.close(); } catch (e) { /* 무시 */ } }
      charts4.forEach(q => q.ch.destroy()); host.remove();
    }
    if (E1.err || E2.err) throw E1.err || E2.err;
    if (!E1.avcC || !E2.avcC) throw new Error("영상 정보를 만들지 못했어요.");
    onProgress && onProgress(1);
    return { color: mux(E1.samples, E1.avcC, OW, OH, FPS), matte: mux(E2.samples, E2.avcC, OW, OH, FPS) };
  }

  /** 상세 화면의 영상 버튼 */
  async function run(rec) {
    window.__vidBusy = true;
    let cancelled = false, close = null;
    dialog(`<h3>영상 만드는 중</h3><p id="vidP">0%</p><div class="vid-bar"><i id="vidB"></i></div>
      <div class="acts"><button id="dC">취소</button></div>`, (b, c) => { close = c; b.querySelector("#dC").onclick = () => { cancelled = true; }; });
    $("#dlgBack").onclick = null;
    try {
      const out = await make(rec, p => { const t = Math.round(p * 100); const a = $("#vidP"), bb = $("#vidB"); if (a) a.textContent = `${t}% · 2560×1190 60프레임 · 색 + 마스크`; if (bb) bb.style.width = t + "%"; }, () => cancelled);
      close && close();
      const base = ((rec.name || "").trim() || "elMotion").replace(/[\\/:*?"<>|]/g, "_") + "_elMotion";
      const save = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); };
      const mb = bl => (bl.size / 1048576).toFixed(1);
      save(out.color, base + "_색.mp4");
      await new Promise(r => setTimeout(r, 900));                   // 두 번째 저장이 막히지 않게 잠깐 쉬었다가
      save(out.matte, base + "_마스크.mp4");
      toast(`영상 두 개를 저장했어요: 색 ${mb(out.color)} MB · 마스크 ${mb(out.matte)} MB`, 5200);
    } catch (e) {
      close && close();
      toast(cancelled ? "영상 만들기를 취소했어요." : (e && e.message) || "영상을 만들지 못했어요.", 4500);
    } finally {
      setTimeout(() => { window.__vidBusy = false; }, 10000);   // 저장이 끝날 틈을 두고 나서야 새 버전으로 바꿀 수 있게
    }
  }
  return { make, run, mux };
})();
