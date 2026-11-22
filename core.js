/* 엘모션 · 승차감 신호처리 코어
 * 브라우저에서는 window.Core, node에서는 module.exports 로 노출된다.
 * 입력: 가속도 센서 원시값(중력 포함, m/s², 기기 좌표계) → 60 Hz 리샘플
 * 출력: 가감속도, 저크, 상하/좌우 흔들림, 속력, 주행 거리 + ISO 18738 A95 peak-to-peak
 */
(function (root) {
  "use strict";

  const FS = 60;
  const G0 = 9.80665;

  const P = {
    // 자동 시작: 1초 동안 안정
    STABLE_SEC: 1.0,
    STABLE_STD: 0.04,     // m/s², 축별 표준편차 한계
    STABLE_JUMP: 0.15,    // m/s², 평균에서 이만큼 벗어나면 안정 구간 처음부터
    // 필터 (이전보다 완화)
    ACC_LP: 3.0,          // 가감속도 표시용 저역통과 (이전 2 Hz)
    MOTION_LP: 2.0,       // 운행 판정용 (속력 알고리즘은 그대로)
    JERK_LP: 1.5,         // 저크 산출용
    VERT_HP: 1.0,         // 상하 흔들림 고역통과 (이전 2 Hz)
    LAT_HP: 0.3,          // 좌우 흔들림 고역통과 (이전 0.5 Hz)
    VIB_LP: 10.0,         // 흔들림 대역 상한. 휴대폰 센서 잡음이 A95를 부풀리지 않게 (ISO 가중 곡선처럼 고주파 감쇠)
    // 속력 적분 + 드리프트 억제 (사용자 확인 완료 알고리즘)
    DEAD: 0.02, MOVE: 0.05, QUIET_SEC: 0.5, STOP_ABS: 0.15, STOP_RATIO: 0.25, BIAS_GAIN: 0.002,
    // 비정상 흔들림 (자동 종료)
    ABN_DEV: 2.5,         // m/s², 보정된 중력 벡터와의 차이
    ABN_TILT_DEG: 10,     // 휴대폰이 기울어진 각도
    ABN_TILT_TAU: 0.15,   // s
    CUT_SEC: 0.2,         // 감지 0.2초 전까지만 기록
    LIVE_PP_SEC: 1.0,     // 실시간 p-p 창
  };

  /* ───────── 필터 ───────── */
  class Biquad {
    constructor(b0, b1, b2, a1, a2) {
      this.b0 = b0; this.b1 = b1; this.b2 = b2; this.a1 = a1; this.a2 = a2;
      this.x1 = this.x2 = this.y1 = this.y2 = 0;
    }
    process(x) {
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
      return y;
    }
    static make(fc, fs, high) {
      const w = 2 * Math.PI * fc / fs, c = Math.cos(w), al = Math.sin(w) / Math.SQRT2, a0 = 1 + al;
      return high
        ? new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0)
        : new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0);
    }
  }

  /* ───────── 리샘플러: 어떤 센서 속도든 정확히 60 Hz ───────── */
  class Resampler {
    constructor(rate, cb) { this.period = 1000 / rate; this.cb = cb; this.reset(); }
    reset() { this.next = 0; this.sx = this.sy = this.sz = 0; this.n = 0; this.has = false; this.l = [0, 0, 0]; }
    onEvent(tMs, x, y, z) {
      if (this.next === 0) this.next = tMs + this.period;
      let k = 0;
      while (tMs >= this.next && k < 30) { this.emit(); this.next += this.period; k++; }
      if (tMs >= this.next) this.next = tMs + this.period;
      this.sx += x; this.sy += y; this.sz += z; this.n++;
    }
    emit() {
      if (this.n > 0) {
        this.l = [this.sx / this.n, this.sy / this.n, this.sz / this.n];
        this.has = true; this.sx = this.sy = this.sz = 0; this.n = 0;
      }
      if (this.has) this.cb(this.l[0], this.l[1], this.l[2]);
    }
  }

  /* ───────── 1초 안정 감지 + 중력 보정 ───────── */
  class StabilityDetector {
    constructor(fs = FS) { this.n = Math.round(P.STABLE_SEC * fs); this.jumps = 0; this.reset(); }
    reset() { this.buf = []; this.sum = [0, 0, 0]; }
    /** @returns {{progress:number, cal?:Calibration}} */
    push(x, y, z) {
      const b = this.buf, s = this.sum;
      if (b.length) {
        const k = b.length;
        if (Math.abs(x - s[0] / k) > P.STABLE_JUMP || Math.abs(y - s[1] / k) > P.STABLE_JUMP || Math.abs(z - s[2] / k) > P.STABLE_JUMP) { this.reset(); this.jumps++; }
      }
      this.buf.push([x, y, z]); this.sum[0] += x; this.sum[1] += y; this.sum[2] += z;
      if (this.buf.length > this.n) { const o = this.buf.shift(); this.sum[0] -= o[0]; this.sum[1] -= o[1]; this.sum[2] -= o[2]; }
      if (this.buf.length < this.n) return { progress: this.buf.length / this.n };
      const k = this.buf.length, m = [this.sum[0] / k, this.sum[1] / k, this.sum[2] / k];
      const v = [0, 0, 0];
      for (const p of this.buf) for (let i = 0; i < 3; i++) v[i] += (p[i] - m[i]) ** 2;
      const sd = Math.sqrt(Math.max(v[0], v[1], v[2]) / k);
      if (sd > P.STABLE_STD) {
        // 조금 흔들림 → 앞쪽 절반을 버려 다시 채우게 한다
        const drop = this.buf.splice(0, Math.floor(k / 2));
        for (const o of drop) { this.sum[0] -= o[0]; this.sum[1] -= o[1]; this.sum[2] -= o[2]; }
        return { progress: this.buf.length / this.n };
      }
      return { progress: 1, cal: new Calibration(m[0], m[1], m[2]) };
    }
  }

  class Calibration {
    constructor(mx, my, mz) {
      const g = Math.hypot(mx, my, mz) || 1;
      this.g = g; this.gx = mx / g; this.gy = my / g; this.gz = mz / g;
      this.vec = [mx, my, mz];
      // 좌우축 = 기기 X축의 수평 투영 (X축이 거의 연직이면 Y축)
      let px = 1 - this.gx * this.gx, py = -this.gx * this.gy, pz = -this.gx * this.gz, pn = Math.hypot(px, py, pz);
      if (pn < 0.5) { px = -this.gy * this.gx; py = 1 - this.gy * this.gy; pz = -this.gy * this.gz; pn = Math.hypot(px, py, pz); }
      this.lx = px / pn; this.ly = py / pn; this.lz = pz / pn;
    }
    /** [연직 (위 +, 중력 제거), 좌우] m/s² */
    project(x, y, z) {
      return [x * this.gx + y * this.gy + z * this.gz - this.g, x * this.lx + y * this.ly + z * this.lz];
    }
  }

  /* ───────── 비정상 흔들림 (휴대폰을 집거나 떨어뜨림) ───────── */
  class AbnormalDetector {
    constructor(cal, fs = FS) {
      this.cal = cal; this.alpha = 1 - Math.exp(-1 / (P.ABN_TILT_TAU * fs));
      this.f = cal.vec.slice(); this.cosLim = Math.cos(P.ABN_TILT_DEG * Math.PI / 180);
    }
    /** @returns {string|null} 감지 사유 */
    push(x, y, z) {
      const c = this.cal.vec;
      const dev = Math.hypot(x - c[0], y - c[1], z - c[2]);
      const f = this.f, a = this.alpha;
      f[0] += a * (x - f[0]); f[1] += a * (y - f[1]); f[2] += a * (z - f[2]);
      const fn = Math.hypot(f[0], f[1], f[2]) || 1;
      const cos = (f[0] * this.cal.gx + f[1] * this.cal.gy + f[2] * this.cal.gz) / fn;
      if (dev > P.ABN_DEV) return "shock";
      if (cos < this.cosLim) return "tilt";
      return null;
    }
  }

  /* ───────── 인접 peak-to-peak (ISO 18738): 부호가 반대인 인접 극값의 차 ───────── */
  class PeakToPeak {
    constructor(fs = FS) { this.fs = fs; this.reset(); }
    reset() { this.sign = 0; this.ext = 0; this.prevPeak = null; this.list = []; this.i = 0; }
    push(v) {
      const s = v > 0 ? 1 : v < 0 ? -1 : 0;
      if (this.sign === 0) { this.sign = s; this.ext = v; }
      else if (s !== 0 && s !== this.sign) {
        if (this.prevPeak !== null) this.list.push({ i: this.i, pp: Math.abs(this.ext - this.prevPeak) });
        this.prevPeak = this.ext; this.sign = s; this.ext = v;
      } else if (Math.abs(v) > Math.abs(this.ext)) this.ext = v;
      this.i++;
      const lim = this.i - P.LIVE_PP_SEC * this.fs;
      while (this.list.length && this.list[0].i < lim) this.list.shift();
    }
    /** 최근 1초 최대 p-p (진행 중인 반주기 포함) */
    live() {
      let m = this.prevPeak !== null ? Math.abs(this.ext - this.prevPeak) : 0;
      for (const e of this.list) if (e.pp > m) m = e.pp;
      return m;
    }
  }

  /* ───────── 스트리밍 분석기 ───────── */
  class RideAnalyzer {
    constructor(fs = FS) {
      this.fs = fs; this.dt = 1 / fs;
      this.lpAcc = Biquad.make(P.ACC_LP, fs, false);
      this.lpMot = Biquad.make(P.MOTION_LP, fs, false);
      this.lpJ1 = Biquad.make(P.JERK_LP, fs, false);
      this.lpJ2 = Biquad.make(P.JERK_LP, fs, false);
      this.hpV = Biquad.make(P.VERT_HP, fs, true);
      this.hpL = Biquad.make(P.LAT_HP, fs, true);
      this.lpV = Biquad.make(P.VIB_LP, fs, false);
      this.lpL = Biquad.make(P.VIB_LP, fs, false);
      this.ppV = new PeakToPeak(fs); this.ppL = new PeakToPeak(fs);
      this.v = 0; this.bias = 0; this.moving = false; this.peak = 0; this.quiet = 0; this.dist = 0;
      this.prevJ = 0; this.first = true;
      this.quietN = Math.round(P.QUIET_SEC * fs);
      this.out = { acc: 0, mot: 0, jerk: 0, vibV: 0, vibL: 0, speed: 0, dist: 0, moving: false, ppV: 0, ppL: 0 };
    }
    /** vert/lat: m/s² (중력 제거). lat 이 NaN 이면 좌우 없음 */
    push(vertIn, lat) {
      const vert = vertIn - this.bias;
      const acc = this.lpAcc.process(vert);
      const mot = this.lpMot.process(vert);
      const aj = this.lpJ1.process(vert);
      const jRaw = this.first ? 0 : (aj - this.prevJ) * this.fs;
      this.prevJ = aj; this.first = false;
      const jerk = this.lpJ2.process(jRaw);
      const vibV = this.lpV.process(this.hpV.process(vert)) * 100;
      const vibL = Number.isNaN(lat) ? NaN : this.lpL.process(this.hpL.process(lat)) * 100;
      this.ppV.push(vibV); if (!Number.isNaN(vibL)) this.ppL.push(vibL);

      // 속력: 가감속 없을 땐 적분 중지, 정지 판단 시 0, 정지 중 바이어스 학습
      const quiet = Math.abs(mot) < P.DEAD;
      this.quiet = quiet ? Math.min(this.quiet + 1, 1e9) : 0;
      if (!quiet) this.v += vert * this.dt;
      if (Math.abs(mot) > P.MOVE) this.moving = true;
      if (this.moving) this.peak = Math.max(this.peak, Math.abs(this.v));
      if (this.moving && this.quiet >= this.quietN && Math.abs(this.v) < Math.max(P.STOP_ABS, P.STOP_RATIO * this.peak)) {
        this.v = 0; this.moving = false; this.peak = 0;
      }
      if (!this.moving && this.quiet >= this.quietN) { this.bias += P.BIAS_GAIN * vert; this.v = 0; }
      this.dist += Math.abs(this.v) * this.dt;

      const o = this.out;
      o.acc = acc; o.mot = mot; o.jerk = jerk; o.vibV = vibV; o.vibL = vibL;
      o.speed = this.v * 60; o.dist = this.dist; o.moving = this.moving;
      o.ppV = this.ppV.live(); o.ppL = Number.isNaN(vibL) ? NaN : this.ppL.live();
      return o;
    }
  }

  /* ───────── 통계 ───────── */
  function percentile(arr, p) {
    if (!arr.length) return 0;
    const s = Float64Array.from(arr).sort();
    return s[Math.max(0, Math.ceil(p * s.length) - 1)];
  }

  /** 마스크 구간들에서 인접 p-p 목록과 통계 */
  function ppStats(sig, mask, fs) {
    const pps = [];
    let crossings = 0, count = 0, i = 0;
    const n = sig.length;
    while (i < n) {
      if (!mask[i] || Number.isNaN(sig[i])) { i++; continue; }
      let sign = 0, ext = 0, prev = null;
      while (i < n && mask[i]) {
        const v = sig[i], s = v > 0 ? 1 : v < 0 ? -1 : 0;
        if (sign === 0) { sign = s; ext = v; }
        else if (s !== 0 && s !== sign) {
          crossings++;
          if (prev !== null) pps.push(Math.abs(ext - prev));
          prev = ext; sign = s; ext = v;
        } else if (Math.abs(v) > Math.abs(ext)) ext = v;
        i++; count++;
      }
    }
    if (!pps.length) return { a95: 0, max: 0, spikes: 0, freq: 0, seconds: count / fs, n: 0 };
    const a95 = percentile(pps, 0.95);
    let max = 0; for (const v of pps) if (v > max) max = v;
    const thr = Math.max(2.5 * a95, a95 + 8);
    // 연속으로 큰 값은 한 번의 튐으로 센다
    let spikes = 0, inSpike = false;
    for (const v of pps) { if (v > thr) { if (!inSpike) spikes++; inSpike = true; } else inSpike = false; }
    const seconds = count / fs;
    return { a95, max, spikes, freq: seconds > 0 ? crossings / 2 / seconds : 0, seconds, n: pps.length };
  }

  /* ───────── 전체 분석 (저장된 원시 데이터 → 모든 지표) ───────── */
  function analyze(vert, lat, fs = FS) {
    const n = vert.length, hasLat = !!lat;
    const S = {
      acc: new Float32Array(n), jerk: new Float32Array(n), vibV: new Float32Array(n),
      vibL: new Float32Array(n), speed: new Float32Array(n), dist: new Float32Array(n),
    };
    const mot = new Float32Array(n), moving = new Uint8Array(n);
    const an = new RideAnalyzer(fs);
    for (let i = 0; i < n; i++) {
      const o = an.push(vert[i], hasLat ? lat[i] : NaN);
      S.acc[i] = o.acc; S.jerk[i] = o.jerk; S.vibV[i] = o.vibV; S.vibL[i] = hasLat ? o.vibL : NaN;
      S.speed[i] = o.speed; S.dist[i] = o.dist; mot[i] = o.mot; moving[i] = o.moving ? 1 : 0;
    }

    // 운행 구간 (경계 0~3 근사): moving 구간 + 앞뒤 0.5초
    const pad = Math.round(0.5 * fs);
    const trips = [];
    for (let i = 0; i < n;) {
      if (!moving[i]) { i++; continue; }
      let j = i; while (j < n && moving[j]) j++;
      trips.push([Math.max(0, i - pad), Math.min(n - 1, j - 1 + pad)]);
      i = j;
    }
    const tripMask = new Uint8Array(n);
    for (const [a, b] of trips) for (let k = a; k <= b; k++) tripMask[k] = 1;
    // 정속 구간 (수직 진동 평가): 운행 중 가감속 거의 없음 + 속력이 그 운행 최고의 70% 이상
    const constMask = new Uint8Array(n);
    let constCount = 0;
    for (const [a, b] of trips) {
      let pk = 0; for (let k = a; k <= b; k++) pk = Math.max(pk, Math.abs(S.speed[k]));
      for (let k = a; k <= b; k++) {
        if (Math.abs(mot[k]) < P.MOVE && Math.abs(S.speed[k]) > 0.7 * pk && pk > 6) { constMask[k] = 1; constCount++; }
      }
    }
    const all = new Uint8Array(n).fill(1);
    const vMask = constCount >= fs ? constMask : (trips.length ? tripMask : all);
    const lMask = trips.length ? tripMask : all;

    const vibV = ppStats(S.vibV, vMask, fs);
    const vibL = hasLat ? ppStats(S.vibL, lMask, fs) : null;

    // 가속/감속: 움직임 방향 기준
    let accMax = 0, decMax = 0, jerkMax = 0, up = 0, down = 0;
    for (let i = 0; i < n; i++) {
      const a = S.acc[i], v = S.speed[i];
      if (Math.abs(v) > 1.5 || moving[i]) {
        const dirSign = Math.abs(v) > 1.5 ? Math.sign(v) : Math.sign(a);
        if (a * dirSign > 0) accMax = Math.max(accMax, Math.abs(a)); else decMax = Math.max(decMax, Math.abs(a));
      }
      jerkMax = Math.max(jerkMax, Math.abs(S.jerk[i]));
      if (v > up) up = v; if (-v > down) down = -v;
    }
    const m = {
      duration: n / fs, trips: trips.length,
      accMax, decMax, accPeak: Math.max(accMax, decMax),
      jerkMax, vibV, vibL, speedUp: up, speedDown: down, speedMax: Math.max(up, down),
      distance: n ? S.dist[n - 1] : 0,
    };
    m.eval = evaluate(m);
    return { series: S, m };
  }

  /* ───────── 평가 · 한줄평 ───────── */
  function vibGrade(a95) {
    if (a95 <= 6) return { lv: 0, t: "아주 훌륭해요" };
    if (a95 <= 10) return { lv: 1, t: "좋은 편이에요" };
    if (a95 <= 20) return { lv: 2, t: "일반적인 수준이에요" };
    if (a95 <= 30) return { lv: 3, t: "좋지 않아요" };
    return { lv: 4, t: "불쾌하게 느껴질 수 있어요" };
  }
  function vibCharacter(st, vertical) {
    if (!st || !st.n) return "";
    const f = st.freq, parts = [];
    const swaying = vertical && f >= 0.8 && f <= 4 && st.a95 >= 6 && st.max < 2 * st.a95;
    if (swaying) parts.push(`위아래로 천천히 출렁여요(약 ${f.toFixed(1)} Hz)`);
    else if (st.a95 > 6) {
      const feel = f < 2.5 ? "느리게 흔들려요" : f > 8 ? "잘게 떨려요" : "흔들림이 느껴져요";
      parts.push(`${vertical ? "위아래로" : "좌우로"} ${feel}(약 ${f.toFixed(1)} Hz)`);
    } else parts.push(vertical ? "위아래 떨림이 거의 없어요" : "좌우 떨림이 거의 없어요");
    if (st.spikes > 0) parts.push(`툭 튀는 순간이 ${st.spikes}번 있었어요(최대 ${st.max.toFixed(1)} gal)`);
    return parts.join(". ") + ".";
  }
  function speedClass(v) {
    if (v < 3) return "운행이 감지되지 않았어요";
    if (v <= 60) return "저속 승강기예요";
    if (v <= 105) return "중속 승강기예요";
    if (v <= 300) return "고속 승강기예요";
    return "초고속 승강기예요";
  }
  function evaluate(m) {
    const a = m.accPeak;
    const acc = a <= 0.3 ? { lv: 0, t: "거의 느껴지지 않아요" }
      : a <= 0.6 ? { lv: 1, t: "부드러워요" }
      : a <= 1.0 ? { lv: 3, t: "강하게 느껴져요" }
      : { lv: 4, t: "불편하게 느껴질 수 있어요" };
    const jerk = m.jerkMax <= 0.8 ? { lv: 0, t: "출발과 정지가 매끄러워요" } : { lv: 3, t: "출발·정지 때 덜컥임이 느껴질 수 있어요" };
    const vV = vibGrade(m.vibV.a95);
    const vL = m.vibL ? vibGrade(m.vibL.a95) : null;
    const dirs = m.speedUp > 3 && m.speedDown > 3 ? "상승·하강" : m.speedUp > 3 ? "상승" : m.speedDown > 3 ? "하강" : "";
    const speed = { lv: 0, t: speedClass(m.speedMax) + (dirs ? ` · ${dirs}` : "") };

    const issues = [];
    if (acc.lv >= 3) issues.push({ lv: acc.lv, name: "가감속" });
    if (jerk.lv >= 3) issues.push({ lv: jerk.lv, name: "출발·정지 충격" });
    if (vV.lv >= 2) issues.push({ lv: vV.lv + (vV.lv >= 3 ? 1 : 0), name: "상하 흔들림" });
    if (vL && vL.lv >= 2) issues.push({ lv: vL.lv + (vL.lv >= 3 ? 1 : 0), name: "좌우 흔들림" });
    let overall;
    if (m.speedMax < 3) overall = "엘리베이터가 움직인 구간을 찾지 못했어요.";
    else if (!issues.length) overall = "전반적으로 부드럽고 안정적인 승차감이에요.";
    else {
      issues.sort((x, y) => y.lv - x.lv);
      const names = issues.map(i => i.name);
      const josa = w => (/[가-힣]$/.test(w) && (w.charCodeAt(w.length - 1) - 0xac00) % 28 ? "이" : "가");
      const first = names[0];
      overall = issues[0].lv >= 4
        ? `${first}${josa(first)} 커서 불편할 수 있어요. 점검을 권해요.`
        : names.length > 1
          ? `대체로 무난하지만 ${names.slice(0, 2).join("과 ")}${josa(names[Math.min(1, names.length - 1)])} 조금 아쉬워요.`
          : `대체로 무난하지만 ${first}${josa(first)} 조금 아쉬워요.`;
    }
    return {
      overall, acc, jerk, speed,
      vibV: { ...vV, line: vibCharacter(m.vibV, true) },
      vibL: vL ? { ...vL, line: vibCharacter(m.vibL, false) } : null,
    };
  }

  /* ───────── CSV ───────── */
  function parseCsv(text) {
    text = text.replace(/^﻿/, "");
    const firstLine = text.slice(0, text.indexOf("\n") >>> 0 || text.length);
    const delim = [",", ";", "\t"].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); rows.push(row); row = []; cur = "";
      } else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  const num = s => { if (s == null) return NaN; const t = String(s).trim(); return t === "" ? NaN : Number(t); };
  function median(a) { const s = Float64Array.from(a).sort(); return s.length ? s[s.length >> 1] : 0; }

  /** 외부 파일 값은 모두 m/s². 중력이 포함된 열(정지 시 약 9.8)만 처음 0.5초의 중앙값을 빼서 중력을 제거한다 */
  function normalizeColumn(vals, fs) {
    const head = vals.slice(0, Math.max(1, Math.min(vals.length, Math.round(0.5 * fs))));
    const med = median(head);
    if (Math.abs(med) > 5) return { data: Float32Array.from(vals, v => v - med), unit: "m/s²(중력 포함 → 제거)" };
    return { data: Float32Array.from(vals), unit: "m/s²" };
  }

  /** CSV → {vert, lat|null, rate, startedAt?, info}. A4~: 시간, B4~: 수직, E4~: 수평 */
  function importCsv(text) {
    const rows = parseCsv(text);
    const t = [], b = [], e = [];
    let hasE = false;
    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      const tv = num(row[0]), bv = num(row[1]);
      if (Number.isNaN(tv) || Number.isNaN(bv)) continue;
      const ev = num(row[4]);
      t.push(tv); b.push(bv); e.push(ev);
      if (!Number.isNaN(ev)) hasE = true;
    }
    if (b.length < 10) throw new Error("A4·B4 아래에 숫자 데이터가 부족해요");
    // 시간 단위 (초 / 밀리초)
    const dts = []; for (let i = 1; i < Math.min(t.length, 400); i++) dts.push(t[i] - t[i - 1]);
    let dt = median(dts);
    let ts = t.slice();
    if (!(dt > 0)) { ts = t.map((_, i) => i / FS); dt = 1 / FS; }
    else if (dt > 0.5) { ts = t.map(v => v / 1000); dt /= 1000; }
    const t0 = ts[0];
    for (let i = 0; i < ts.length; i++) ts[i] -= t0;
    const srcRate = 1 / dt;
    // 60 Hz 선형 보간
    const dur = ts[ts.length - 1];
    const n = Math.max(2, Math.floor(dur * FS) + 1);
    const interp = src => {
      const out = new Float64Array(n); let j = 0;
      for (let i = 0; i < n; i++) {
        const tt = i / FS;
        while (j < ts.length - 2 && ts[j + 1] < tt) j++;
        const a = ts[j], c = ts[j + 1];
        const va = src[j], vc = Number.isNaN(src[j + 1]) ? va : src[j + 1];
        out[i] = c > a ? va + (vc - va) * Math.min(1, Math.max(0, (tt - a) / (c - a))) : va;
      }
      return out;
    };
    const vN = normalizeColumn(Array.from(interp(b)), FS);
    let lN = null;
    if (hasE) { const ef = e.map(v => (Number.isNaN(v) ? 0 : v)); lN = normalizeColumn(Array.from(interp(ef)), FS); }
    // 엘모션에서 내보낸 파일이면 측정 시각 복원
    let startedAt = null;
    const r2 = rows[1] || [];
    if (String(r2[0] || "").startsWith("# started_at")) { const d = Date.parse(String(r2[1]).replace(" ", "T")); if (!Number.isNaN(d)) startedAt = d; }
    return { vert: vN.data, lat: lN ? lN.data : null, rate: FS, startedAt, info: { srcRate, vertUnit: vN.unit, latUnit: lN ? lN.unit : null } };
  }

  function exportCsv(rec, A) {
    const S = A.series, n = rec.vert.length, f = (v, d = 4) => (Number.isNaN(v) ? "" : v.toFixed(d));
    const d = new Date(rec.startedAt), p = x => String(x).padStart(2, "0");
    const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const lines = [
      `# name,"${(rec.name || "").replace(/"/g, '""')}"`,
      `# started_at,${when},sample_rate_hz,${rec.rate}`,
      "time_s,vertical_accel_m_s2,accel_m_s2,jerk_m_s3,lateral_accel_m_s2,vertical_vib_gal,lateral_vib_gal,speed_m_min,distance_m",
    ];
    for (let i = 0; i < n; i++) {
      lines.push([(i / rec.rate).toFixed(4), f(rec.vert[i]), f(S.acc[i]), f(S.jerk[i]),
        rec.lat ? f(rec.lat[i]) : "", f(S.vibV[i], 2), rec.lat ? f(S.vibL[i], 2) : "", f(S.speed[i], 2), f(S.dist[i], 3)].join(","));
    }
    return lines.join("\n") + "\n";
  }

  /* ───────── 데모 원시 신호 (센서가 없는 화면용) ───────── */
  class DemoSignal {
    constructor() {
      this.rate = 100; this.i = 0; this.v = 0; this.bump = 0; this.bumpT = 0; this.bumpLat = 0;
      const g = [0.05, 0.99, 0.12], m = Math.hypot(...g); this.gd = g.map(c => c / m);
      const lx = [1 - this.gd[0] ** 2, -this.gd[0] * this.gd[1], -this.gd[0] * this.gd[2]], lm = Math.hypot(...lx);
      this.ld = lx.map(c => c / lm);
      // 타임라인 (초): 손에 들고 있음 → 내려놓음 → 대기 → 상승 → 정차 → 하강 → 대기 → 집어 듦
      const prof = [];
      const still = s => { for (let i = 0; i < s * this.rate; i++) prof.push(0); };
      const trip = (vmax, amax, jerk, cruise, sign) => {
        const tj = amax / jerk, ta = (vmax - amax * tj) / amax, nj = Math.round(tj * this.rate), up = [];
        for (let i = 0; i < nj; i++) up.push(amax * (1 - Math.cos(Math.PI * i / nj)) / 2);
        for (let i = 0; i < Math.round(ta * this.rate); i++) up.push(amax);
        for (let i = 0; i < nj; i++) up.push(amax * (1 + Math.cos(Math.PI * i / nj)) / 2);
        up.forEach(a => prof.push(sign * a));
        for (let i = 0; i < cruise * this.rate; i++) prof.push(0);
        up.forEach(a => prof.push(-sign * a));
      };
      this.handUntil = 1.6 * this.rate;           // 손에 든 상태
      still(1.6 + 1.0 + 1.5);                       // 들고 있음 + 안정(1초) + 대기
      trip(2.5, 0.55, 0.45, 5, 1); still(2.5); trip(1.75, 0.5, 0.45, 3, -1); still(1.5);
      this.prof = prof;
      this.pickAt = prof.length;                    // 이 시점부터 집어 듦
    }
    gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    /** 다음 원시 샘플 [x,y,z] */
    next() {
      const i = this.i++, t = i / this.rate;
      const inHand = i < this.handUntil || i >= this.pickAt;
      const a = i < this.prof.length ? this.prof[i] : 0;
      this.v += a / this.rate;
      const moving = Math.abs(this.v) > 0.2;
      if (moving && Math.random() < 0.004) { this.bump = 0.1 + Math.random() * 0.12; this.bumpT = 0; this.bumpLat = (Math.random() - 0.5) * 0.15; }
      let bv = 0, bl = 0;
      if (this.bump > 0) {
        const env = Math.exp(-this.bumpT * 9);
        bv = this.bump * env * Math.sin(2 * Math.PI * 11 * this.bumpT);
        bl = this.bumpLat * env * Math.sin(2 * Math.PI * 5 * this.bumpT);
        this.bumpT += 1 / this.rate; if (env < 0.01) this.bump = 0;
      }
      const run = moving ? 1 : 0.2;
      const vib = run * (0.02 * Math.sin(2 * Math.PI * 7.3 * t) + 0.008 * Math.sin(2 * Math.PI * 13.1 * t)) + bv;
      const latv = run * 0.016 * Math.sin(2 * Math.PI * 2.7 * t + 1) + bl;
      let gd = this.gd, noise = 0.018, extra = [0, 0, 0];
      if (inHand) {
        // 손 떨림 + (집어 들 때) 기울어짐과 충격
        const k = i >= this.pickAt ? Math.min(1, (i - this.pickAt) / (0.4 * this.rate)) : 0.15;
        const ang = 0.9 * k + 0.05 * Math.sin(t * 2.1);
        gd = [Math.sin(ang) * 0.3 + this.gd[0], Math.cos(ang) * this.gd[1], Math.sin(ang) + this.gd[2]];
        const gm = Math.hypot(...gd); gd = gd.map(c => c / gm);
        noise = 0.12;
        if (i >= this.pickAt && i < this.pickAt + 0.25 * this.rate) extra = [this.gauss() * 1.5, 2.2 + this.gauss(), this.gauss() * 1.5];
      }
      const up = G0 + a + vib;
      return [0, 1, 2].map(c => up * gd[c] + latv * this.ld[c] + extra[c] + this.gauss() * noise);
    }
  }

  const Core = {
    FS, P, Biquad, Resampler, StabilityDetector, Calibration, AbnormalDetector, PeakToPeak, RideAnalyzer,
    analyze, evaluate, ppStats, percentile, parseCsv, importCsv, exportCsv, DemoSignal,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== "undefined" ? window : globalThis);
