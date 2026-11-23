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
    STABLE_STD: 0.06,     // m/s², 축별 표준편차 한계 (잡음이 큰 기기도 통과하도록 완화. 손에 들면 0.1 이상)
    STABLE_JUMP: 0.3,     // m/s², 평균에서 이만큼 벗어나면 안정 구간 처음부터
    STABLE_SPIKES: 2,     // 1초 안에 이만큼까지의 순간 튐은 무시 (센서 잡음 한두 번에 처음부터 다시 세지 않게)
    // 필터 (이전보다 완화)
    ACC_LP: 2.5,          // 가감속도 표시용 저역통과
    MOTION_LP: 2.0,       // 운행 판정용 (속력 알고리즘은 그대로)
    JERK_LP: 1.3,         // 저크 산출용
    VERT_HP: 1.2,         // 상하 흔들림 고역통과
    LAT_HP: 0.4,          // 좌우 흔들림 고역통과
    VIB_LP: 8.0,         // 흔들림 대역 상한. 휴대폰 센서 잡음이 A95를 부풀리지 않게 (ISO 가중 곡선처럼 고주파 감쇠)
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
    reset() { this.buf = []; this.sum = [0, 0, 0]; this.spikes = []; }
    /** @returns {{progress:number, cal?:Calibration}} */
    push(x, y, z) {
      const b = this.buf, s = this.sum;
      if (b.length) {
        const k = b.length;
        const off = Math.max(Math.abs(x - s[0] / k), Math.abs(y - s[1] / k), Math.abs(z - s[2] / k));
        if (off > P.STABLE_JUMP) {
          // 한두 번 튀는 잡음은 건너뛰고, 1초 안에 여러 번이거나 크게 움직이면 처음부터
          this.spikes = this.spikes.filter(t => this.t - t < this.n); this.spikes.push(this.t);
          if (off > P.STABLE_JUMP * 3 || this.spikes.length > P.STABLE_SPIKES) { this.reset(); this.jumps++; }
          else { this.t = (this.t || 0) + 1; return { progress: this.buf.length / this.n }; }
        }
      }
      this.t = (this.t || 0) + 1;
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
    m.ride = rideShape(vert, trips, fs);
    m.eval = evaluate(m);
    return { series: S, m };
  }

  /* ───────── 가감속 모양 분석 (가감속도 + 저크 + 가가가속도) ─────────
     2026-11-23 예시 10개 파일(배곧·광운대·월계·월곡·금호·장교·인창1·인창4·Cv60·부평)로 맞춘 판정.
     점수는 내부 계산용이고 화면에는 등급과 한마디 평만 나간다. */
  function zp(x, fc, fs) {            // 0위상 2차 저역통과 (앞뒤로 한 번씩)
    const n = x.length, pad = Math.min(n - 1, Math.round(fs * 1.5));
    const ext = new Float64Array(n + 2 * pad);
    for (let i = 0; i < pad; i++) { ext[i] = 2 * x[0] - x[pad - i]; ext[n + pad + i] = 2 * x[n - 1] - x[n - 2 - i]; }
    for (let i = 0; i < n; i++) ext[pad + i] = x[i];
    const run = (arr) => { const f = Biquad.make(fc, fs, false); const y0 = arr[0]; f.x1 = f.x2 = f.y1 = f.y2 = y0; for (let i = 0; i < arr.length; i++) arr[i] = f.process(arr[i]); };
    run(ext); ext.reverse(); run(ext); ext.reverse();
    return ext.subarray(pad, pad + n);
  }
  function grad(x, fs) {
    const n = x.length, y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = i === 0 ? (x[1] - x[0]) * fs : i === n - 1 ? (x[n - 1] - x[n - 2]) * fs : (x[i + 1] - x[i - 1]) * fs / 2;
    return y;
  }
  /** 봉우리 개수 (높이 h 이상, 돌출도 pr 이상) */
  function peaks(x, lo, hi, h, pr, sign = 1) {
    let c = 0;
    for (let i = lo + 1; i < hi - 1; i++) {
      const v = sign * x[i];
      if (v < h || !(v > sign * x[i - 1] && v >= sign * x[i + 1])) continue;
      let lm = v, k = i - 1; while (k >= lo && sign * x[k] <= v) { lm = Math.min(lm, sign * x[k]); k--; }
      let rm = v; k = i + 1; while (k < hi && sign * x[k] <= v) { rm = Math.min(rm, sign * x[k]); k++; }
      if (v - Math.max(lm, rm) >= pr) c++;
    }
    return c;
  }
  const ramp = (v, lo, hi) => clamp01((v - lo) / (hi - lo));

  /** 운행 하나 (가속 → 감속) 분석. a: 수직 가속도(중력·바이어스 제거) */
  function shapeOne(a, fs) {
    const n = a.length; if (n < fs * 3) return null;
    const a2 = zp(a, 2, fs), a5 = zp(a, 5, fs), j = grad(zp(a, 1.3, fs), fs), j5 = grad(a5, fs), s = grad(grad(a2, fs), fs);
    // 0.5초 창에서 거의 전부 |a| > 0.15 이면 '가감속 중'
    const W = Math.round(0.5 * fs), half = W >> 1, big = new Uint8Array(n), cs = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + (Math.abs(a2[i]) > 0.15 ? 1 : 0);
    for (let i = 0; i < n; i++) { const L = Math.max(0, i - half), R = Math.min(n, i - half + W); big[i] = cs[R] - cs[L] >= W - 1 ? 1 : 0; }
    let i0 = big.indexOf(1), i1 = big.lastIndexOf(1);
    if (i0 < 0 || i1 - i0 < fs * 1.5) return null;
    const mid = (i0 + i1) >> 1;
    let on = i0; while (on > 0 && Math.abs(a5[on]) > 0.05) on--;
    let off = i1; while (off < n - 1 && Math.abs(a5[off]) > 0.05) off++;
    let v = 0; for (let i = 0; i <= mid; i++) v += a2[i];
    const sg = v >= 0 ? 1 : -1;
    const x = Float64Array.from(a2, q => q * sg), J = Float64Array.from(j, q => q * sg), S = Float64Array.from(s, q => q * sg);
    const A0 = Math.max(0, on - Math.round(0.5 * fs)), D1 = Math.min(n, off + Math.round(0.5 * fs));
    const pA = Float64Array.from(x.subarray(A0, mid), q => Math.max(0, q));
    const pD = Float64Array.from(x.subarray(mid, D1), q => Math.max(0, -q));
    const max = arr => { let m = 0; for (const q of arr) if (q > m) m = q; return m; };
    const acc = max(pA), dec = max(pD);
    if (acc < 0.15 || dec < 0.15) return null;
    const first = (p, th) => { for (let i = 0; i < p.length; i++) if (p[i] >= th) return i; return -1; };
    const last = (p, th) => { for (let i = p.length - 1; i >= 0; i--) if (p[i] >= th) return i; return -1; };
    const tm = p => { const pk = max(p), lo = first(p, .1 * pk), hi = first(p, .9 * pk), hiL = last(p, .9 * pk), loL = last(p, .1 * pk);
      return { rise: (hi - lo) / fs, plat: (hiL - hi) / fs, rel: (loL - hiL) / fs }; };
    const trend = p => { const pk = max(p), a = first(p, .5 * pk), b = last(p, .5 * pk), k = b - a + 1;
      return (p[a + Math.floor(.75 * k)] - p[a + Math.floor(.25 * k)]) / pk; };
    // 힘을 거는 시간(10→90%) 대비 푸는 시간(마지막 85% → 5%)
    const engRel = p => { const pk = max(p), a10 = first(p, .1 * pk), a90 = first(p, .9 * pk), e85 = last(p, .85 * pk);
      let k = e85; while (k < p.length - 1 && p[k] > .05 * pk) k++;
      return (k - e85) / Math.max(1, a90 - a10); };
    const tA = tm(pA), tD = tm(pD);
    let jerk = 0, stop = -1e9, kick = 0;
    for (let i = A0; i < D1; i++) jerk = Math.max(jerk, Math.abs(J[i]));
    for (let i = mid; i < D1; i++) stop = Math.max(stop, J[i]);
    let jerkA = 0; for (let i = A0; i < mid; i++) jerkA = Math.max(jerkA, Math.abs(J[i]));
    for (let i = Math.max(0, on - Math.round(.3 * fs)); i < Math.min(n, on + Math.round(.4 * fs)); i++) kick = Math.max(kick, Math.abs(j5[i] * sg));
    const hump = (lo, hi) => peaks(J, lo, hi, .15, HUMP_PR, 1) + peaks(J, lo, hi, .15, HUMP_PR, -1);
    const extra = hump(A0, mid) + hump(mid, D1) - 4;
    let hs = 0, hn = 0, hm = 0;
    for (let i = 0; i < pA.length; i++) if (pA[i] >= .3 * acc) { const q = a5[A0 + i] - a2[A0 + i]; hs += q * q; hm += q; hn++; }
    const hf = hn ? Math.sqrt(Math.max(0, hs / hn - (hm / hn) ** 2)) : 0;
    const lobA = peaks(pA, 0, pA.length, .2, .12), lobD = peaks(pD, 0, pD.length, .2, .12);
    const sAbs = (lo, hi) => { let m = 0; for (let i = Math.max(0, lo); i < Math.min(n, hi); i++) m = Math.max(m, Math.abs(S[i])); return m; };
    const F = Math.round(fs);
    const snap = [sAbs(i0 - F, i0 + F), sAbs(i0 + F / 2, mid), sAbs(mid, i1 - F / 2), sAbs(i1 - F, i1 + 1.5 * F)];
    const startCut = pA[0] > .1 * acc, endCut = pD[pD.length - 1] > .1 * dec;
    return { dir: sg, acc, dec, jerk, jerkA, stop, kick, tA, tD, trA: trend(pA), trD: trend(pD), extra, hf, lobA, lobD, snap,
      relA: startCut ? null : engRel(pA), relD: endCut ? null : engRel(pD) };
  }

  /** 운행 하나 판정 → 내부 점수, 문제 태그, 성격 태그 */
  const HUMP_PR = 0.12;   // 저크 봉우리 돌출도 (월계삼창 "살짝 울렁" 기준)
  function judgeOne(r) {
    const a = Math.max(r.acc, r.dec), j = r.jerk, bad = [], ch = [];
    let p = a <= .7 ? 0 : a <= 1.3 ? 15 * (a - .7) / .6 : 15 + 25 * ramp(a, 1.3, 1.8);
    const jolt = r.kick >= 2.2;                          // 덜컥: 출발 직전 저크가 크게 흔들림
    const rough = jolt || r.stop >= 1.3 || r.lobA >= 2 || r.kick >= 3 || r.extra >= 4 || r.hf >= .035;
    const j0 = rough ? .8 : 1.2;                          // 깔끔하게 당기는 저크는 1.2까지 감점 없음
    p += j <= j0 ? 0 : j <= 1.6 ? 25 * (j - j0) / .8 : 25 * (1.6 - j0) / .8 + 15 * ramp(j, 1.6, 2.4);
    if (r.stop >= 1.3) { bad.push("thud"); p += 8; }
    if (r.lobA >= 2 || r.kick >= 3) { bad.push("bounce"); p += 8; }
    if (r.extra >= 4 || r.hf >= .035) { bad.push("wave"); p += 8; }
    else if (r.extra >= 2 && !bad.includes("thud")) { bad.push("wobble"); p += 3; }
    if (r.lobD >= 2 && !bad.includes("thud")) { bad.push("twice"); p += 5; }
    for (const v of r.snap) p += 3 * ramp(v, 5, 10) + 5 * ramp(v, 10, 20);      // 가가가속도: 모서리가 각질수록
    const slowA = r.relA == null ? 0 : 25 * ramp(r.relA, 1.5, 2.1);               // 꽉 잡았다가 스르르 (가속)
    const slowD = r.relD == null ? 0 : 25 * ramp(r.relD, 1.5, 2.1);               // 스르르 멈춤 (감속)
    p += slowA + slowD;
    if (slowD >= 8) bad.push("slowStop");
    if (slowA >= 8) ch.push("grabRelease");
    if (r.tA.rise / Math.max(r.tA.rel, .05) >= 1.4 && r.trA >= .1) ch.push("easeSnap");
    if (r.tD.rel >= 1.8 && !bad.includes("slowStop")) ch.push("fadeBrake");
    if (a >= .8 && !bad.includes("bounce") && !bad.includes("wave")) ch.push(r.tA.plat >= 2 ? "pull" : "firm");
    if (a >= .55 && a < .8 && j <= .8 && !bad.length && r.tA.plat >= 1.2 && !ch.length) ch.push("softFirm");
    return { score: Math.max(0, Math.round(100 - p)), bad, ch, jolt };
  }

  function rideShape(vert, trips, fs) {
    if (!trips.length) return null;
    const med = percentile(Array.from(vert), .5);
    let worst = null;
    for (const [a, b] of trips) {
      const lo = Math.max(0, a - Math.round(1.5 * fs)), hi = Math.min(vert.length, b + Math.round(1.5 * fs));
      const seg = Float64Array.from(vert.subarray ? vert.subarray(lo, hi) : vert.slice(lo, hi), q => q - med);
      const r = shapeOne(seg, fs); if (!r) continue;
      const jd = judgeOne(r); jd.dir = r.dir;
      if (!worst || jd.score < worst.score) worst = jd;
    }
    return worst;
  }

  /* ───────── 평가 · 한줄평 ───────── */
  /* 평가 기준 (2026-11-23 사용자 지정)
     가감속도: ~0.7 부드러움, ~1.3 강함, 그 이상 불편
     저크: ~0.8 m/s³ 부드러움, 그 이상 불편
     흔들림(A95): ~8 아주 훌륭, ~10 좋음, ~20 일반적, ~30 좋지 않음, 그 이상 불쾌
     가감속 모양(가감속도+저크+가가가속도): 내부 점수 → 등급(훌륭/좋아요/무난/아쉬워요/점검) + 한마디 평
     속력: ~70 저속, ~130 중속, ~250 고속, ~500 초고속, 그 이상 '초고속의 초월' */
  const EVAL_VER = 8;
  function accGrade(a) {
    if (a <= 0.4) return { lv: 0, t: "거의 느껴지지 않을 만큼 순해요", s: "순해요" };
    if (a <= 0.7) return { lv: 1, t: "부드러워요", s: "부드러워요" };
    if (a <= 1.3) return { lv: 3, t: "강하게 느껴져요", s: "강해요" };
    return { lv: 4, t: "불편하게 느껴질 수 있어요", s: "불편해요" };
  }
  function jerkGrade(j, R) {
    const way = R && R.dir < 0 ? "내려가요" : "올라가요";
    if (R && R.bad.includes("thud")) return { lv: 4, t: "멈추기 직전에 덜컹해요", s: "덜컹해요" };
    if (R && R.bad.includes("bounce")) return { lv: 4, t: "출발이 쿵 하고 튀어요", s: "쿵 하고 튀어요" };
    if (R ? R.jolt : j > .8) return { lv: 3, t: "출발할 때 덜컥여요", s: "덜컥여요" };
    if (j <= 0.5) return { lv: 0, t: "출발과 정지가 아주 매끄러워요", s: "아주 좋아요" };
    if (j <= 0.8) return { lv: 1, t: "출발과 정지가 매끄러워요", s: "좋아요" };
    if (j <= 1.6) return { lv: 1, t: `쑤욱 빨려 ${way}`, s: `쑤욱 빨려 ${way}` };
    return { lv: 3, t: "세게 잡아당겨요", s: "세게 당겨요" };
  }
  function vibGrade(a95) {
    if (a95 <= 8) return { lv: 0, t: "아주 훌륭해요", s: "훌륭해요" };
    if (a95 <= 10) return { lv: 1, t: "좋은 편이에요", s: "좋아요" };
    if (a95 <= 20) return { lv: 2, t: "일반적인 수준이에요", s: "무난해요" };
    if (a95 <= 30) return { lv: 3, t: "좋지 않아요", s: "아쉬워요" };
    return { lv: 4, t: "놀이기구인가요?", s: "놀이기구?" };
  }
  function vibCharacter(st, vertical) {
    if (!st || !st.n) return "";
    const f = st.freq, parts = [];
    const swaying = vertical && f >= 0.8 && f <= 4 && st.a95 >= 8 && st.max < 2 * st.a95;
    if (st.a95 > 30) parts.push(vertical ? "위아래로 신나게 흔들려요. 컵에 담긴 물은 장담 못 해요" : "좌우로 크게 흔들려요. 손잡이를 꼭 잡으세요");
    else if (swaying) parts.push(`출렁출렁, 위아래로 천천히 출렁여요(약 ${f.toFixed(1)} Hz)`);
    else if (st.a95 > 8) {
      const feel = f < 2.5 ? "느리게 흔들려요" : f > 8 ? "잘게 떨려요" : "흔들림이 느껴져요";
      parts.push(`${vertical ? "위아래로" : "좌우로"} ${feel}(약 ${f.toFixed(1)} Hz)`);
    } else parts.push(vertical ? "위아래 떨림이 거의 없어요" : "좌우 떨림이 거의 없어요");
    if (st.spikes > 0) parts.push(`툭 튀는 순간이 ${st.spikes}번 있었어요(최대 ${st.max.toFixed(1)} gal)`);
    return parts.join(". ") + ".";
  }
  function speedGrade(v) {
    if (v < 3) return { t: "운행이 감지되지 않았어요", s: "정지" };
    if (v <= 70) return { t: "저속 승강기예요", s: "저속" };
    if (v <= 130) return { t: "중속 승강기예요", s: "중속" };
    if (v <= 250) return { t: "고속 승강기예요", s: "고속" };
    if (v <= 500) return { t: "초고속 승강기예요", s: "초고속" };
    return { t: "초고속의 초월. 기술진들의 고뇌의 정도를 감잡을 수 없어요", s: "초고속의 초월" };
  }
  /* 가감속 모양 → 등급 · 한마디 평 (점수는 화면에 내보내지 않는다) */
  function rideGrade(sc) {
    return sc >= 95 ? "훌륭해요" : sc >= 85 ? "좋아요" : sc >= 70 ? "무난해요" : sc >= 55 ? "아쉬워요" : "점검이 필요해요";
  }
  const RIDE_TXT = {
    thud: ["멈추기 직전에 덜컹해요", "마지막에 쿵 하고 내려앉아요"],
    bounce: ["출발이 쿵 하고 튀어요", "출발하자마자 한 번 튀어 올라요"],
    wave: ["출렁출렁, 가감속이 물결쳐요", "출렁이며 달려요"],
    wobble: ["가감속 중에 살짝 울렁여요", "살짝 울렁이는 구간이 있어요"],
    twice: ["감속을 2번 하네요", "브레이크를 두 번에 나눠 밟아요"],
    slowStop: ["감속을 스르르 풀며 뜸 들이다 멈춰요", "멈출 듯 말 듯 스르르 멈춰요"],
    grabRelease: ["쑤욱 빨려 올라갔다가 스르르 놓아줘요"], grabReleaseDown: ["쑤욱 빨려 내려갔다가 스르르 놓아줘요"],
    easeSnap: ["슬며시 잡았다가 팍 놓아요"],
    fadeBrake: ["브레이크를 점점 풀며 멈춰요"],
    pull: ["쭉 빨려 올라가요"], pullDown: ["쭉 빨려 내려가요"],
    firm: ["강하고 단단하게 치고 나가요"],
    softFirm: ["부드러우면서도 단단해요"],
    great: ["군더더기 없는 가감속이에요", "물 위를 미끄러지듯 움직여요"],
  };
  function rideLine(R, m, vV, vL) {
    const seed = Math.floor((m.jerkMax + m.accPeak + m.distance) * 997);
    const pick = (k, i) => { const arr = RIDE_TXT[(k === "pull" || k === "grabRelease") && R.dir < 0 ? k + "Down" : k]; return arr[(seed + i) % arr.length]; };
    const ORDER = ["bounce", "pull", "firm", "softFirm", "grabRelease", "easeSnap", "wave", "wobble", "twice", "fadeBrake", "slowStop", "thud"];
    const keys = [...R.bad.slice(0, 2), ...R.ch.slice(0, Math.max(0, 2 - R.bad.length))].sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
    if (!keys.length && R.score >= 95) keys.push("great");
    const parts = keys.map((k, i) => pick(k, i));
    const grade = rideGrade(R.score);
    let line = (R.bad.length >= 3 || R.score < 55 ? "우당탕탕! " : "") + grade + "." + (parts.length ? " " + parts.join(". ") + "." : "");
    const vib = [];
    if (vV.lv >= 2) vib.push("위아래"); if (vL && vL.lv >= 2) vib.push("좌우");
    if (vib.length) line += ` ${vib.join("·")} 흔들림도 조금 느껴져요.`;
    return line;
  }
  function evaluate(m) {
    const acc = accGrade(m.accPeak);
    const jerk = jerkGrade(m.jerkMax, m.ride);
    const vV = vibGrade(m.vibV.a95);
    const vL = m.vibL ? vibGrade(m.vibL.a95) : null;
    const dirs = m.speedUp > 3 && m.speedDown > 3 ? "상승·하강" : m.speedUp > 3 ? "상승" : m.speedDown > 3 ? "하강" : "";
    const sg = speedGrade(m.speedMax);
    const speed = { lv: 0, t: sg.t + (dirs && m.speedMax >= 3 && m.speedMax <= 500 ? ` · ${dirs}` : ""), s: sg.s };
    const accS = a => (a <= 0.4 ? "순하고" : a <= 0.7 ? "부드럽고" : a <= 1.3 ? "강하고" : "거칠고");
    const gA = accGrade(m.accMax).s, gD = accGrade(m.decMax).s;
    acc.detail = `가속은 ${accS(m.accMax)} 감속${gA === gD ? "도" : "은"} ${gD}`;

    const issues = [];
    if (acc.lv >= 3) issues.push({ lv: acc.lv, name: "가감속" });
    if (jerk.lv >= 3) issues.push({ lv: jerk.lv, name: "출발·정지 충격" });
    if (vV.lv >= 2) issues.push({ lv: vV.lv + (vV.lv >= 3 ? 1 : 0), name: "상하 흔들림" });
    if (vL && vL.lv >= 2) issues.push({ lv: vL.lv + (vL.lv >= 3 ? 1 : 0), name: "좌우 흔들림" });
    let overall;
    const R = m.ride;
    if (m.speedMax < 3) overall = "엘리베이터가 움직인 구간을 찾지 못했어요.";
    else if (vV.lv >= 4 || (vL && vL.lv >= 4)) overall = `놀이기구인가요? ${vV.lv >= 4 ? "위아래" : "좌우"} 흔들림이 ${(vV.lv >= 4 ? m.vibV.a95 : m.vibL.a95).toFixed(0)} gal이나 돼요. 점검을 권해요.`;
    else if (R) overall = rideLine(R, m, vV, vL);
    else if (!issues.length) overall = "아주 안정적인 승차감이에요.";
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
      ver: EVAL_VER, overall, acc, jerk, speed, ride: R ? { grade: rideGrade(R.score), tags: [...R.bad, ...R.ch] } : null,
      vibV: { ...vV, line: vibCharacter(m.vibV, true) },
      vibL: vL ? { ...vL, line: vibCharacter(m.vibL, false) } : null,
    };
  }

  /* ───────── 기압계 보정 (속력·주행 거리에만 적용) ─────────
     기압 → 고도(국제표준대기), 0.5 Hz로 부드럽게 한 뒤 미분해 '기압 속력'을 구한다.
     가속도 적분 속력의 빠른 변화(고역)와 기압 속력의 느린 흐름(저역)을 합치는 상보 필터.
     baro: [{t: 측정 시작 후 초, p: hPa}] */
  function fuseBaro(speed, fs, baro) {
    const n = speed.length;
    if (!baro || baro.length < 5 || n < fs) return null;
    const alt = baro.map(b => ({ t: b.t, h: 44330 * (1 - Math.pow(b.p / baro[0].p, 1 / 5.255)) }));
    // 60 Hz로 보간
    const h = new Float64Array(n); let j = 0;
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      while (j < alt.length - 2 && alt[j + 1].t < t) j++;
      const a = alt[j], b = alt[Math.min(j + 1, alt.length - 1)];
      h[i] = b.t > a.t ? a.h + (b.h - a.h) * clamp01((t - a.t) / (b.t - a.t)) : a.h;
    }
    // 오차 추정 방식: 가속도 속력과 기압 속력을 '똑같은' 저역통과에 통과시켜 시간 지연을 맞춘 뒤
    // 둘의 차이(= 가속도 적분의 누적 오차)만 천천히 추정해서 빼 준다. 움직임 자체는 가속도 쪽을 그대로 쓴다.
    const fA1 = Biquad.make(0.4, fs, false), fA2 = Biquad.make(0.4, fs, false);
    const fB1 = Biquad.make(0.4, fs, false), fB2 = Biquad.make(0.4, fs, false);
    const TAU = 3, k = 1 / (TAU * fs);
    const out = new Float32Array(n), dist = new Float32Array(n);
    let prevH = null, err = 0, d = 0;
    for (let i = 0; i < n; i++) {
      const hs = fB2.process(fB1.process(h[i]));
      const vb = prevH === null ? 0 : (hs - prevH) * fs * 60; prevH = hs;          // m/min, 지연 포함
      const va = fA2.process(fA1.process(speed[i]));                                // 같은 지연
      if (i > fs) err += k * ((va - vb) - err);
      if (speed[i] === 0) err *= 0.98;                                             // 정지하면 오차 추정을 서서히 비움
      out[i] = speed[i] === 0 ? 0 : speed[i] - err;
      d += Math.abs(out[i]) / 60 / fs; dist[i] = d;
    }
    return { speed: out, dist };
  }
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

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
    analyze, evaluate, rideShape, _dbg: { zp, grad, peaks }, fuseBaro, EVAL_VER, ppStats, percentile, parseCsv, importCsv, exportCsv, DemoSignal,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== "undefined" ? window : globalThis);
