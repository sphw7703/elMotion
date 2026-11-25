/* elMotion · 승차감 신호처리 코어
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
      this.prevJ = 0; this.first = true; this.hold = 0;
      this.quietN = Math.round(P.QUIET_SEC * fs);
      this.out = { acc: 0, mot: 0, jerk: 0, vibV: 0, vibL: 0, speed: 0, dist: 0, moving: false, ppV: 0, ppL: 0 };
    }
    /** 움직이는 중에 시작했을 때: 처음 속력(m/s)을 정해 준다 */
    seed(v) { this.v = v; this.moving = true; this.peak = Math.abs(v); }
    /** 지금 상태 그대로 복사 (분석 중 되돌아가 다시 계산할 때) */
    clone() {
      const c = Object.assign(Object.create(RideAnalyzer.prototype), this);
      for (const k of ["lpAcc", "lpMot", "lpJ1", "lpJ2", "hpV", "hpL", "lpV", "lpL"]) c[k] = Object.assign(Object.create(Biquad.prototype), this[k]);
      for (const k of ["ppV", "ppL"]) c[k] = Object.assign(Object.create(PeakToPeak.prototype), this[k], { list: this[k].list.slice() });
      c.out = Object.assign({}, this.out);
      return c;
    }
    /** 다음 push에서 정지(속력 0)로 판정될 상황인가 */
    get stopNext() {
      return this.moving && this.hold <= 0 && this.quiet >= this.quietN - 1 && Math.abs(this.v) < Math.max(P.STOP_ABS, P.STOP_RATIO * this.peak);
    }
    /** 지금 서 있는가 (정지 판정 직전, 0.3초 이상 조용하고 속력이 거의 0인 경우 포함) */
    get still() {
      return !this.moving || (this.quiet >= 0.3 * this.fs && Math.abs(this.v) < Math.max(P.STOP_ABS, P.STOP_RATIO * this.peak));
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
      if (this.hold > 0) this.hold--;
      else if (this.moving && this.quiet >= this.quietN && Math.abs(this.v) < Math.max(P.STOP_ABS, P.STOP_RATIO * this.peak)) {
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
  /** segs: 일시정지로 나뉜 구간의 시작 인덱스들 ([0, i1, i2 …]). 구간마다 따로 분석해서 잇는다. */
  function segBounds(n, segs) {
    const st = [0];
    if (segs) for (const s of segs) if (s > st[st.length - 1] && s < n) st.push(s);
    return st.map((s, k) => [s, k + 1 < st.length ? st[k + 1] : n]);
  }
  /** 한 구간을 따로 돌려 본 결과 (판단용) */
  function trialRun(vert, s, e, fs, seed) {
    const an = new RideAnalyzer(fs); if (seed) an.seed(seed);
    const mot = new Float32Array(e - s), v = new Float32Array(e - s), mv = new Uint8Array(e - s);
    let firstMove = -1, firstReset = -1;
    for (let i = s; i < e; i++) {
      const was = an.moving, o = an.push(vert[i], NaN), k = i - s;
      mot[k] = o.mot; v[k] = an.v; mv[k] = o.moving ? 1 : 0;
      if (firstMove < 0 && o.moving) firstMove = k;
      if (firstReset < 0 && was && !o.moving) firstReset = k;
    }
    return { an, mot, v, mv, firstMove, firstReset, still: an.still };
  }
  /** 움직임 덩어리(같은 부호의 가속·감속): [시작, 끝, 부호, 끝난 뒤 0.5초 이상 조용한가] */
  function lobesOf(mot, from, fs) {
    const out = [], n = mot.length, qn = Math.round(P.QUIET_SEC * fs);
    for (let i = from; i < n;) {
      if (Math.abs(mot[i]) <= P.MOVE) { i++; continue; }
      const sg = Math.sign(mot[i]); let j = i;
      while (j < n && Math.sign(mot[j]) === sg && Math.abs(mot[j]) > P.DEAD) j++;
      const last = out[out.length - 1];
      if (last && last[2] === sg && i - last[1] < qn) last[1] = j; else out.push([i, j, sg]);   // 잠깐 끊긴 같은 방향은 하나로
      i = j;
    }
    for (const l of out) { let q = 0; for (let k = l[1]; k < n && Math.abs(mot[k]) < P.DEAD; k++) q++; l[3] = q >= qn; }
    return out;
  }
  /** 일시정지 경계 처리 (2026-11-24 사용자 확정)
      · 멈출 때와 재개할 때 모두 서 있었으면 → 한 줄로 매끄럽게 이어서 분석
      · 어느 쪽이든 움직이는 중이었으면 → 구간을 나누고, 잘린 운행은 가감속 모양 평가에서 뺀다
      · 움직이는 중에 재개했다고 판단되면 → 첫 감속이 끝날 때 속력이 0이 되도록 처음 속력을 정한다 */
  function planSegs(vert, n, segs, fs) {
    const raw = segBounds(n, segs);
    const info = [];
    for (let k = 0; k < raw.length; k++) {
      const [s, e] = raw[k];
      let startMoving = false, seed = 0;
      if (k > 0) {
        const t = trialRun(vert, s, e, fs, 0);
        if (t.firstMove >= 0 && t.firstReset < 0) {
          // 처음 운행이 끝내 정지로 돌아오지 않음 → 서 있다가 출발한 것과 맞지 않을 수 있다
          const lb = lobesOf(t.mot, t.firstMove, fs), done = lb.filter(l => l[3]);
          startMoving = done.length >= 2 || !info[k - 1].endStill;
          if (startMoving && lb.length && lb[0][3]) seed = -t.v[Math.min(e - s - 1, lb[0][1] + Math.round(P.QUIET_SEC * fs))];
        }
      }
      const fin = trialRun(vert, s, e, fs, seed);
      info.push({ s, e, startMoving, seed, endStill: fin.still });
    }
    // 서 있을 때 멈추고 서 있을 때 재개한 경계는 잇는다
    const groups = [];
    for (let k = 0; k < info.length; k++) {
      const I = info[k], g = groups[groups.length - 1];
      if (g && info[k - 1].endStill && !I.startMoving) { g.e = I.e; g.endStill = I.endStill; g.last = k; }
      else groups.push({ s: I.s, e: I.e, startMoving: I.startMoving, seed: I.seed, endStill: I.endStill, last: k });
    }
    for (const g of groups) g.endCut = g.last < info.length - 1 && !g.endStill;   // 움직이는 중에 일시정지
    return { raw, groups };
  }
  /** 너무 이른 정지 판정 찾기: 정지 직전 속력(vres)이 남아 있었고, 곧바로(6초 안) 같은 방향으로 더 감속해
      그 감속량이 남은 속력으로 설명되면 → 사실은 저속으로 계속 움직이던 것 */
  function prematureStop(speed, mot, moving, snaps, from, s, e, fs) {
    const GAP = Math.round(6 * fs), qn = Math.round(P.QUIET_SEC * fs);
    for (let r = Math.max(from, s + 1); r < e; r++) {
      if (!(moving[r - 1] && !moving[r]) || !snaps.has(r)) continue;
      const vres = snaps.get(r).v, d = Math.sign(vres);
      if (Math.abs(vres) < 0.03) continue;
      // 이번 운행의 방향 (최고 속력의 부호)
      let pk = 0; for (let k = r - 1; k >= s && moving[k]; k--) if (Math.abs(speed[k]) > Math.abs(pk)) pk = speed[k];
      if (Math.sign(pk) !== d) continue;
      let k = r; while (k < Math.min(e, r + GAP) && Math.abs(mot[k]) <= P.MOVE) k++;
      if (k >= Math.min(e, r + GAP) || Math.sign(mot[k]) !== -d) continue;
      let j = k, I = 0;
      for (;;) {
        while (j < e && Math.sign(mot[j]) === -d && Math.abs(mot[j]) > P.DEAD) { I += mot[j] / fs; j++; }
        let q = j; while (q < e && Math.abs(mot[q]) <= P.DEAD) q++;          // 잠깐 끊긴 같은 방향 감속은 이어서
        if (q < e && q - j < qn && Math.sign(mot[q]) === -d) j = q; else break;
      }
      if (Math.abs(I) <= Math.max(1.6 * Math.abs(vres), Math.abs(vres) + 0.1)) return { r, hold: j - r + 2 };
    }
    return null;
  }
  /** 운행마다 감속 구간과 착상 구간 나누기 (2026-11-24 사용자 확정)
      감속: 속력이 10 m/min보다 빠를 때 시작한 감속(2단 감속이면 둘 다). 착상: 마지막 감속이 풀린 뒤 저속 접근 ~ 꿀렁하며 멈출 때까지.
      착상 구간은 기록·그래프에는 남기고 분석(최고 가감속도·저크·가감속 모양)에서는 뺀다. */
  const LEV_V = 10;
  function levelings(vert, speed, trips, fs) {
    const out = [];
    for (const [a, b] of trips) {
      let pk = 0; for (let k = a; k <= b; k++) if (Math.abs(speed[k]) > Math.abs(pk)) pk = speed[k];
      const d = Math.sign(pk);
      if (!d || Math.abs(pk) <= LEV_V) { out.push(null); continue; }
      const seg = Float64Array.from(vert.subarray ? vert.subarray(a, b + 1) : vert.slice(a, b + 1));
      const med = percentile(Array.from(seg.subarray(0, Math.max(1, Math.round(0.5 * fs)))), .5);
      const z = zp(Float64Array.from(seg, q => (q - med) * -d), 2, fs);      // 감속이 + 가 되도록
      const regs = [];
      for (let i = 0; i < z.length;) {
        if (z[i] <= P.DEAD) { i++; continue; }
        let j = i, m = 0; while (j < z.length && z[j] > P.DEAD) { m = Math.max(m, z[j]); j++; }
        regs.push([i, j, m]); i = j;
      }
      let mx = 0; for (const r of regs) mx = Math.max(mx, r[2]);
      const main = regs.filter(([i, , m]) => m >= Math.max(0.1, 0.25 * mx) && Math.abs(speed[a + i]) > LEV_V);
      if (!main.length) { out.push(null); continue; }
      const L = a + main[main.length - 1][1];
      out.push(L < b ? [L, b] : null);
      (out.dec || (out.dec = [])).push([a + main[0][0], L]);
    }
    return out;
  }

  function analyze(vert, lat, fs = FS, segs) {
    const n = vert.length;
    // 좌우 값이 없거나 대부분 0이면(예: 상하만 기록하는 측정기에서 옮긴 파일) 좌우 흔들림은 '기록 없음'.
    // 실제 휴대폰 센서 값은 잡음 때문에 정확히 0이 거의 나오지 않는다
    let hasLat = false;
    if (lat && lat.length) { let z = 0; for (let i = 0; i < lat.length; i++) if (Math.abs(lat[i]) <= 1e-6) z++; hasLat = z < 0.5 * lat.length; }
    const plan = planSegs(vert, n, segs, fs);
    const bounds = plan.groups.map(g => [g.s, g.e]);
    const S = {
      acc: new Float32Array(n), jerk: new Float32Array(n), vibV: new Float32Array(n),
      vibL: new Float32Array(n), speed: new Float32Array(n), dist: new Float32Array(n),
    };
    const mot = new Float32Array(n), moving = new Uint8Array(n);
    /* 실제 정지 순간 (착상 포함, 2026-11-24 사용자 확정)
       감속이 끝난 뒤 최대 10초까지는 착상(저속 접근·꿀렁임)이 이어질 수 있다고 보고, 그 안의 마지막 움직임이 끝난 뒤 0.5초를 정지 순간으로 한다.
       새 운행처럼 큰 움직임(본 감속의 절반 이상)이 나오면 거기서 착상 찾기를 멈춘다.
       a: 운행 시작, dEnd: 감속을 찾을 끝(정지 판정 순간), limit: 더 볼 수 있는 끝 */
    const LEVEL_MAX = Math.round(10 * fs);
    function stopAt(a, dEnd, limit) {
      let pk = 0; for (let i = a; i < dEnd; i++) if (Math.abs(S.speed[i]) > Math.abs(pk)) pk = S.speed[i];
      const dir = Math.sign(pk) || 1;
      let mx = 0; for (let i = a; i < dEnd; i++) mx = Math.max(mx, -dir * mot[i]);
      if (mx < 0.05) return null;
      let kd = dEnd - 1; while (kd > a && -dir * mot[kd] < 0.5 * mx) kd--;
      let Ld = kd; while (Ld < limit - 1 && -dir * mot[Ld] > 0.05) Ld++;
      const big = Math.max(0.1, 0.5 * mx), wEnd = Math.min(limit, Ld + LEVEL_MAX);
      // 다음 운행이 시작되면(큰 움직임) 그 움직임이 커지기 시작한 부분까지 착상에서 빼야 하므로, 움직임 덩어리 단위로 본다
      let last = Ld, runLast = Ld, inRun = false, k = Ld;
      for (; k < wEnd; k++) {
        const m = Math.abs(mot[k]);
        if (m > big) { last = runLast; break; }
        if (m > P.MOVE) { if (!inRun) { runLast = last; inRun = true; } last = k; }
        else if (inRun && m <= P.DEAD) inRun = false;
      }
      return { rs: Math.min(limit, last + Math.round(P.QUIET_SEC * fs)), Ld, quiet: Math.min(k, limit) - last };
    }
    let distOff = 0;
    const zupt = [];     // [운행 시작, 정지 판정 순간, 그때 남아 있던 속력(m/s)]
    for (const g of plan.groups) {
      const s = g.s, e = g.e;
      let an = new RideAnalyzer(fs);          // 나뉜 구간마다 필터·속력 적분을 새로 시작
      if (g.seed) an.seed(g.seed);
      // 1차로 돌린 뒤, 너무 일찍 '정지'로 판정한 곳(2단 감속의 중간 저속, 착상 직전 저속 접근)을 찾아
      // 그 지점부터 속력을 버리지 않고 다시 계산한다. 느린 속도로 다가가다 감속하며 멈추는 착상 원리에 따른 것.
      const snaps = new Map();
      let from = s;
      for (let guard = 0; guard < 40; guard++) {
        for (let i = from; i < e; i++) {
          if (an.stopNext) snaps.set(i, an.clone());
          const o = an.push(vert[i], hasLat ? lat[i] : NaN);
          S.acc[i] = o.acc; S.jerk[i] = o.jerk; S.vibV[i] = o.vibV; S.vibL[i] = hasLat ? o.vibL : NaN;
          S.speed[i] = o.speed; S.dist[i] = distOff + o.dist; mot[i] = o.mot; moving[i] = o.moving ? 1 : 0;
        }
        const fix = prematureStop(S.speed, mot, moving, snaps, from, s, e, fs);
        if (!fix) break;
        an = snaps.get(fix.r).clone(); an.hold = fix.hold; from = fix.r;
        for (const k of [...snaps.keys()]) if (k >= fix.r) snaps.delete(k);
      }
      // 정지 판정 순간에 남아 있던 속력 = 그 운행 동안 쌓인 가속도 센서 오차
      const found = [];
      for (let r = s + 1; r < e; r++) {
        if (!(moving[r - 1] && !moving[r]) || !snaps.has(r)) continue;
        let a = r - 1; while (a > s && moving[a - 1]) a--;
        while (a > s && S.speed[a - 1] !== 0) a--;            // 움직이기 시작한 첫 순간까지
        found.push([a, r, snaps.get(r).v]);
      }
      // 측정이 끝날 때까지 '정지'로 판정되지 못한 마지막 운행 (센서 오차가 커서 남은 속력이 정지 기준보다 큰 경우, 2026-11-24 삼창아파트):
      // 감속을 마치고 착상까지 끝나 조용해졌다면 정지로 본다. 정속 중에 측정을 끝낸 경우와 구별하려고, 최고 속력 뒤 감속으로 속력이 절반 아래로 내려왔을 때만.
      if (e - s > 2 && moving[e - 1]) {
        let a = e - 1; while (a > s && moving[a - 1]) a--;
        while (a > s && S.speed[a - 1] !== 0) a--;
        const st = stopAt(a, e, e);
        if (st && st.quiet >= Math.round(0.3 * fs)) {
          const z0 = Math.max(s, a - Math.round(fs));
          let b0 = 0; for (let i = z0; i < a; i++) b0 += vert[i]; b0 = a > z0 ? b0 / (a - z0) : 0;
          let v = 0, pk = 0; for (let i = a; i < st.Ld; i++) { v += (vert[i] - b0) / fs; pk = Math.max(pk, Math.abs(v)); }
          if (pk > 0.1 && Math.abs(v) < 0.5 * pk) found.push([a, e, S.speed[Math.max(a, st.rs - 1)] / 60]);
        }
      }
      // 실제 정지 순간(착상 포함)을 정하고, 그 안에 들어온 착상 꿈틀거림(작은 '운행')은 앞 운행에 합친다
      let until = -1;
      for (const [a, r, vres] of found) {
        if (a < until) {                                       // 앞 운행의 착상에 속한 꿈틀거림: 정지 순간 뒤로 남은 부분은 멈춘 것으로
          for (let k = until; k < r; k++) { S.speed[k] = 0; moving[k] = 0; }
          continue;
        }
        const st = stopAt(a, r, e), rs = st ? Math.max(a + 2, st.rs) : r;
        zupt.push([a, rs, vres, s]);
        for (let k = a; k < rs; k++) moving[k] = 1;
        for (let k = rs; k < r; k++) { S.speed[k] = 0; moving[k] = 0; }
        until = rs;
      }
      if (e > s) distOff = S.dist[e - 1];
    }
    /* 운행 속력 다시 계산 (2026-11-24 실측 검증 후 사용자 확정): 출발 직전 영점 + 운행 전체 적분 + 정지 시점 되짚기
       · 출발 직전 1초(멈춰 있던 때)의 평균을 영점으로 다시 잡는다
       · 정속 주행 중에도 적분을 멈추지 않는다 (멈추면 속력을 조금씩 잃어 거리가 약 1.6% 짧게 나왔다)
       · 도착해 멈춘 순간 남은 속력을 운행 시간에 비례해 거꾸로 나눠 뺀다 (엘리베이터는 출발 전·도착 후 반드시 속력 0)
       월계삼창 1→10층(정격 60 m/min) 실측: 편도 거리 오차 평균 0.8%, 정속 속력 60.0±0.7 m/min.
       정지로 끝나지 않은 운행(일시정지·측정 종료로 잘림)은 기존 계산을 그대로 쓴다. */
    /* 정속 속력: 가속·감속 따로 재서 평균 (2026-11-25 사용자 확정, 정격 속력을 아는 엘리베이터 20대 검증: 평균 오차 3.3% → 2.0%)
       운행 중에는 가속도 센서 영점이 멈춰 있을 때와 달라져(위쪽으로 밀림) 위로 가속하는 구간은 크게, 아래로 가속하는 구간은 작게 잡힌다.
       그래서 출발 구간은 출발 직전 영점으로, 도착 구간은 멈춘 직후 영점으로 따로 적분해 정속 속력 두 개를 얻고 평균한다(오차가 서로 반대라 상쇄).
       속력 곡선: 출발 구간은 앞에서, 도착 구간은 뒤에서 적분하고 각각 평균 속력에 닿도록 고르게 맞춘다. 정속 구간은 적분 모양을 두고 양 끝을 평균 속력에 맞춘다.
       정속 구간이 없는 짧은 운행(정격 속력 미도달)이나 2단 감속처럼 두 값이 크게 다르면 예전 방식(전체 적분 + 정지 시점 되짚기). */
    const tripV = [];       // {v: 정속 속력(m/min, 부호=방향), ref: 참고값(기록이 잘림), short: 정속 구간 없음}
    const smooth = (a, b, b0) => {                       // 0.3초 이동평균 (가감속 구간 찾기용)
      const w = Math.max(1, Math.round(0.15 * fs)), out = new Float64Array(b - a);
      for (let k = a; k < b; k++) { let t = 0, c = 0; for (let j = Math.max(a, k - w); j <= Math.min(b - 1, k + w); j++) { t += vert[j] - b0; c++; } out[k - a] = t / c; }
      return out;
    };
    /** 가속 구간 끝 p1, 감속 구간 시작 p2 (없으면 null) */
    const phases = (a, rs, b0) => {
      const x = smooth(a, rs, b0), L = x.length, big = 0.1, qt = 0.03, hold = Math.round(0.4 * fs);
      let i = 0; while (i < L && Math.abs(x[i]) < big) i++;
      if (i >= L) return null;
      const sgn = Math.sign(x[i]);
      let q = 0; for (; i < L; i++) { if (Math.abs(x[i]) < qt) { if (++q >= hold) break; } else q = 0; }
      const p1 = a + i - q + 1;
      let j = L - 1; while (j > 0 && Math.abs(x[j]) < big) j--;
      if (Math.sign(x[j]) === sgn) return null;
      // 움직임이 끝난 순간 em: 마지막 감속(착상 포함)이 끝나고 조용해진 곳. 멈춘 뒤 오래 서 있던 시간까지 적분하지 않게
      let k = j; q = 0; for (; k < L; k++) { if (Math.abs(x[k]) < qt) { if (++q >= hold) break; } else q = 0; }
      const em = k >= L ? a + L : a + k - q + 1;
      q = 0; for (; j > 0; j--) { if (Math.abs(x[j]) < qt) { if (++q >= hold) break; } else q = 0; }
      const p2 = a + j + q - 1;
      return p2 - p1 >= Math.round(fs) ? { p1, p2, em, sgn } : null;
    };
    // 영점은 평균이 아니라 중앙값: 출발 직전 문 닫힘·발소리 같은 짧은 흔들림에 끌려가지 않게 (평균이면 정속 속력이 3 m/min 넘게 틀어졌다)
    const med = (i0, i1) => { const t = Array.from(vert.subarray(i0, i1)).sort((p, q) => p - q); return t.length ? t[t.length >> 1] : 0; };
    /** 가속 구간 끝 (감속을 못 찾았을 때용) */
    const accelEnd = (a, r, b0) => {
      const x = smooth(a, r, b0), hold = Math.round(0.4 * fs);
      let i = 0; while (i < x.length && Math.abs(x[i]) < 0.1) i++;
      if (i >= x.length) return -1;
      let q = 0; for (; i < x.length; i++) { if (Math.abs(x[i]) < 0.03) { if (++q >= hold) break; } else q = 0; }
      return i >= x.length ? -1 : a + i - q + 1;
    };
    /** 운행 하나 [a, r): 정속 속력을 재고 속력 곡선을 다시 그린다.
        z0: 출발 전 멈춰 있던 구간의 시작, post: 멈춘 뒤 볼 수 있는 끝, endCut: 기록이 정지 전에 끝남, vres: 정지 판정 때 남은 속력(m/s) */
    const measure = (a, r, z0, post, endCut, vres) => {
      if (r - a < 2) return;
      let hasPre = a - z0 >= Math.round(0.3 * fs);
      let b0 = hasPre ? med(z0, a) : 0;          // 출발 전 기록이 없으면 영점 0 (출발 중에 기록을 시작한 경우)
      if (!hasPre && r - a > 2 * fs) {           // 기록 첫 1초가 조용하면(멈춰 있었음) 그 값을 영점으로: 센서 영점이 0에서 꽤 벗어난 기기 대비
        const x = smooth(a, a + fs, 0); let lo = Infinity, hi = -Infinity; for (const v of x) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        if (hi - lo < 0.05) b0 = med(a, a + fs);
      }
      // 실제 출발 순간: 휴대폰을 내려놓을 때의 흔들림 등으로 '움직임'이 일찍 잡혔으면, 실제 가속이 시작되기 전까지는 멈춰 있던 구간(영점)으로 쓴다
      {
        const x = smooth(a, r, b0);
        let i = 0; while (i < x.length && Math.abs(x[i]) < 0.1) i++;
        if (i < x.length) {
          let k = i; while (k > 0 && Math.abs(x[k]) > 0.02) k--;
          if (k >= Math.round(0.3 * fs)) {
            const a2 = a + k; b0 = med(Math.max(a, a2 - Math.round(fs)), a2); hasPre = true;
            for (let j = a; j < a2; j++) S.speed[j] = 0;
            a = a2;
          }
        }
      }
      const L = r - a;
      const ph = phases(a, r, b0);
      const fw = new Float64Array(L); { let v = 0; for (let k = a; k < r; k++) { v += (vert[k] - b0) / fs; fw[k - a] = v * 60; } }
      if (ph) {
        const em = Math.min(r, ph.em), z1End = Math.min(post, em + Math.round(fs));
        const hasPost = z1End - em >= Math.round(0.3 * fs);
        const b1 = hasPost ? med(em, z1End) : b0;                 // 멈춘 직후 기록이 없으면 도착 구간도 출발 직전 영점으로
        // 뒤에서 적분: 움직임이 끝난 순간(em) 속력 0
        const bw = new Float64Array(L); { let v = 0; for (let k = r - 1; k >= a; k--) { bw[k - a] = v * 60; if (k < em) v -= (vert[k] - b1) / fs; } }
        const i1 = ph.p1 - a, i2 = ph.p2 - a, ie = em - a;
        const Va = fw[i1], Vd = bw[i2];
        // 기록이 정지 무렵에 끝났으면: 감속으로 줄어든 속력이 출발 때 붙은 속력의 80%에 못 미치면 감속 도중에 끝난 것 → 도착 구간은 못 쓴다
        const decOk = !endCut || (hasPre && Math.abs(Vd) >= 0.8 * Math.abs(Va));
        const both = hasPre && decOk;
        const ok = both ? Math.abs(Va - Vd) <= 0.25 * Math.max(Math.abs(Va), Math.abs(Vd)) : true;
        const V = both ? (Va + Vd) / 2 : hasPre ? Va : Vd;
        if (ok && (hasPre || decOk) && Math.sign(V) === ph.sgn) {
          for (let k = 0; k <= i1; k++) S.speed[a + k] = hasPre ? fw[k] + (V - Va) * (k + 1) / (i1 + 1) : bw[k] + (V - Vd);
          for (let k = i1 + 1; k < i2; k++) S.speed[a + k] = V + (fw[k] - fw[i1]) - (fw[i2] - fw[i1]) * (k - i1) / (i2 - i1);
          for (let k = i2; k < L; k++) S.speed[a + k] = decOk ? (k < ie ? bw[k] + (V - Vd) * (ie - k) / Math.max(1, ie - i2) : 0) : V + (fw[k] - fw[i2]);
          tripV.push({ v: V, ref: !both, short: false });
          return;
        }
      }
      let pk = 0; for (let k = 0; k < L; k++) if (Math.abs(fw[k]) > Math.abs(pk)) pk = fw[k];
      // 기록이 정지 무렵에 끝났지만 속력이 거의 0으로 돌아왔으면: 정속 구간 없는 짧은 운행으로 본다
      if (endCut && !ph && hasPre && Math.abs(fw[L - 1]) < 0.3 * Math.abs(pk)) endCut = false;
      if (endCut) {
        if (hasPre && !ph) {                                      // 감속 전에 기록이 끝남: 가속 구간만으로 (가속 끝을 못 찾으면 속력 최고값)
          const p1 = accelEnd(a, r, b0), v = p1 > 0 ? fw[p1 - a] : pk;
          if (Math.abs(v) > 6) { tripV.push({ v, ref: true, short: false }); return; }
        }
        tripV.push({ v: null, ref: true, short: false }); return;
      }
      // 정속 구간이 없는 짧은 운행이나 2단 감속 등: 예전 방식 (전체 적분 + 정지 시점 되짚기)
      tripV.push({ v: null, ref: !hasPre, short: !ph });
      if (!hasPre) { for (let k = a; k < r; k++) S.speed[k] -= vres * 60 * (k - a + 1) / L; return; }
      const res = fw[L - 1];
      for (let k = a; k < r; k++) S.speed[k] = fw[k - a] - res * (k - a + 1) / L;
    };
    let prevEnd = -1;
    for (let zi = 0; zi < zupt.length; zi++) {
      const [a, r, vres, gs] = zupt[zi];
      const z0 = Math.max(gs, prevEnd, a - Math.round(fs));
      prevEnd = r;
      const g = plan.groups.find(G => a >= G.s && a < G.e), gEnd = g ? g.e : n;
      const nextA = zi + 1 < zupt.length && zupt[zi + 1][0] < gEnd ? zupt[zi + 1][0] : gEnd;
      measure(a, r, z0, nextA, false, vres);
    }
    // 측정이 끝날 때까지 '정지'로 판정되지 못한 마지막 운행 (기록이 정지 전후에 끝남)
    {
      const lastG = plan.groups[plan.groups.length - 1];
      // 마지막으로 움직인 곳이 어느 정지 판정에도 들어가지 않았으면 (기록이 정지 무렵에 끝나 정지 판정을 못 받은 운행)
      let lm = -1; if (lastG) for (let k = lastG.e - 1; k >= lastG.s; k--) if (moving[k] || Math.abs(S.speed[k]) > 1) { lm = k; break; }
      if (lm > lastG.s && !zupt.some(z => z[0] <= lm && z[1] >= lm)) {
        let a = lm; while (a > lastG.s && (moving[a - 1] || Math.abs(S.speed[a - 1]) > 1)) a--;
        while (a > lastG.s && S.speed[a - 1] !== 0) a--;
        measure(a, lastG.e, Math.max(lastG.s, prevEnd, a - Math.round(fs)), lastG.e, true, 0);
      }
    }
    if (zupt.length || tripV.length) { let d = 0; for (let i = 0; i < n; i++) { d += Math.abs(S.speed[i]) / 60 / fs; S.dist[i] = d; } }

    // 운행 구간 (경계 0~3 근사): moving 구간 + 앞뒤 0.5초 (일시정지 경계는 넘지 않음)
    const pad = Math.round(0.5 * fs);
    const trips = [], cutTrips = new Set();
    for (const g of plan.groups) {
      const s = g.s, e = g.e, first = trips.length;
      for (let i = s; i < e;) {
        if (!moving[i]) { i++; continue; }
        let j = i; while (j < e && moving[j]) j++;
        trips.push([Math.max(s, i - pad), Math.min(e - 1, j - 1 + pad)]);
        i = j;
      }
      if (trips.length > first) {
        if (g.startMoving) cutTrips.add(first);
        if (g.endCut) cutTrips.add(trips.length - 1);
      }
    }
    const tripMask = new Uint8Array(n);
    for (const [a, b] of trips) for (let k = a; k <= b; k++) tripMask[k] = 1;
    // 정속 구간 (상하·좌우 흔들림 평가, 2026-11-25 사용자 확정): 가속이 끝난 뒤부터 다음 감속이 시작되기 전까지, 운행마다 모두
    // 속력 기준(최고 속력의 90%)이 아니라 가감속 덩어리로 찾는다 — 센서 영점이 흔들려 앞 운행의 속력이 낮게 계산돼도 빠지지 않게.
    // 가속 덩어리 뒤의 조용한 구간만 정속으로 본다: 일시정지 뒤 움직이는 중에 재개했거나 2단 감속 사이의 저속 구간은 들어가지 않는다.
    const cruise = [], cruiseMask = new Uint8Array(n);
    const constMask = new Uint8Array(n);
    let constCount = 0;
    {
      const m = Math.round(0.8 * fs);   // 가감속 직후·직전의 여파는 빼고
      const add = (a, b) => {
        a += m; b -= m; if (b - a < fs) return;
        for (let k = a; k <= b; k++) if (Math.abs(S.speed[k]) < 6) return;     // 실제로 움직이는 중이어야
        cruise.push([a, b]); for (let k = a; k <= b; k++) cruiseMask[k] = 1;
      };
      for (const [gs, ge] of bounds) {
        let prevAccel = false, prevEnd = -1;
        for (let k = gs; k < ge;) {
          if (Math.abs(mot[k]) <= 0.1) { k++; continue; }
          let ls = k; while (ls > gs && Math.abs(mot[ls - 1]) > P.MOVE) ls--;
          let le = k; while (le < ge - 1 && Math.abs(mot[le]) > P.MOVE) le++;
          const dv = Math.abs(S.speed[le]) - Math.abs(S.speed[ls]);
          if (Math.abs(dv) < 3) { k = le + 1; continue; }        // 속력이 거의 안 바뀐 꿈틀거림은 정속 중의 흔들림으로 둔다
          if (prevAccel && prevEnd >= 0) add(prevEnd, ls);
          prevAccel = dv > 0; prevEnd = le; k = le + 1;
        }
      }
      for (let k = 0; k < n; k++) if (moving[k] && Math.abs(mot[k]) < P.MOVE && Math.abs(S.speed[k]) > 6) { constMask[k] = 1; constCount++; }
    }
    const all = new Uint8Array(n).fill(1);
    const vMask = Uint8Array.from(cruise.length ? cruiseMask : constCount >= fs ? constMask : (trips.length ? tripMask : all));
    for (const [s] of bounds) if (s > 0) vMask[s] = 0;   // 일시정지 경계에서 p-p를 끊는다
    const lMask = vMask;

    // 상하·좌우 흔들림: 정속 구간의 절댓값 98% 피크 (2026-11-26 사용자 확정, 예전 A95)
    const none = { a95: 0, p98: 0, max: 0, freq: 0, bumps: 0, spikes: 0, seconds: 0, n: 0 };
    const vibV = texture(S.vibV, vMask, fs) || none;
    const vibL = hasLat ? (texture(S.vibL, lMask, fs) || none) : null;

    // 가속/감속: 움직임 방향 기준
    const lev = levelings(vert, S.speed, trips, fs), levMask = new Uint8Array(n);
    for (const L of lev) if (L) for (let k = L[0]; k <= L[1]; k++) levMask[k] = 1;
    let accMax = 0, decMax = 0, jerkMax = 0, up = 0, down = 0;
    for (let i = 0; i < n; i++) {
      const a = S.acc[i], v = S.speed[i];
      if (v > up) up = v; if (-v > down) down = -v;
      if (levMask[i]) continue;                 // 착상 구간은 가감속도·저크 분석에서 뺀다
      if (Math.abs(v) > 1.5 || moving[i]) {
        const dirSign = Math.abs(v) > 1.5 ? Math.sign(v) : Math.sign(a);
        if (a * dirSign > 0) accMax = Math.max(accMax, Math.abs(a)); else decMax = Math.max(decMax, Math.abs(a));
      }
      jerkMax = Math.max(jerkMax, Math.abs(S.jerk[i]));
    }
    const q = rideQuality(S, mot, bounds, levMask, zupt, vMask, fs);
    const m = {
      duration: n / fs, trips: trips.length,
      accMax, decMax, accPeak: Math.max(accMax, decMax),
      jerkMax, jerk: q.jerk, start: q.start, arrive: q.arrive, wave: q.wave, waveFreq: q.waveFreq, riseA: q.riseA, relD: q.relD, tripQ: q.trips,
      vibV, vibL, speedUp: up, speedDown: down, speedMax: Math.max(up, down),
      speedPeak: Math.max(up, down), speedRef: false, speedShort: false,
      distance: n ? S.dist[n - 1] : 0, cruise: cruise.map(([a, b]) => [a / fs, b / fs]),
      pauses: plan.raw.slice(1).map(([s]) => s / fs),
      level: lev.filter(Boolean).map(([a, b]) => [a / fs, b / fs]),          // 착상 구간 (분석 제외, 초)
      decel: (lev.dec || []).map(([a, b]) => [a / fs, b / fs]),               // 감속 구간 (초)
    };
    m.tripV = tripV;
    // 정속 속력 (가속·감속 평균, 위 참고): 정속 구간이 있는 운행이 하나라도 있으면 그 값으로 위/아래 최고 속력을 정한다
    {
      const full = tripV.filter(t => t.v != null);
      if (full.length) {
        const ups = full.filter(t => t.v > 0).map(t => t.v), dns = full.filter(t => t.v < 0).map(t => -t.v);
        m.speedUp = ups.length ? Math.max(...ups) : 0; m.speedDown = dns.length ? Math.max(...dns) : 0;
        m.speedMax = Math.max(m.speedUp, m.speedDown);
        const best = full.reduce((p, t) => (Math.abs(t.v) > Math.abs(p.v) ? t : p));
        m.speedRef = !!best.ref;                         // 기록이 잘린 운행으로 잰 값
      } else {
        m.speedRef = tripV.some(t => t.ref);
        m.speedShort = tripV.length > 0 && tripV.every(t => t.short || t.v == null) && tripV.some(t => t.short);   // 정격 속력에 닿기 전에 감속
      }
    }
    m.eval = evaluate(m);
    return { series: S, m, spans: zupt.map(([a, r]) => [a, r]) };
  }

  /* ───────── 승차감 평가 지표 (2026-11-25 사용자 확정) ─────────
     가속·감속 덩어리(속력이 3 m/min 넘게 바뀐 움직임)로 운행을 나누고, 운행마다
       · 출발 거칠기: 가속이 최고의 10%에 이르는 순간 앞 0.6초 ~ 뒤 0.8초의 상하 흔들림 p-p
       · 도착 거칠기: 마지막 감속이 풀리는 순간 앞 0.5초 ~ 뒤 1.0초의 상하 흔들림 p-p
       · 가감속 중 울렁임: 가감속도가 최고의 30% 이상인 동안의 상하 흔들림 최댓값 + |최솟값| (출발·도착 창과 착상은 뺀다)
       · 저크: 가감속 덩어리 앞뒤 0.3초까지의 |저크| 99% 피크 (착상 제외)
       · 성격: 힘을 주는 시간(가속 10→90%), 힘을 빼는 시간(감속 마지막 90→10%)
     여러 운행이면 가장 나쁜 운행의 값으로 평가한다. */
  function ppIn(sig, a, b, skip) {
    let mx = -Infinity, mn = Infinity;
    for (let i = Math.max(0, a); i < Math.min(sig.length, b); i++) {
      if (skip && skip[i]) continue;
      const v = sig[i]; if (Number.isNaN(v)) continue;
      if (v > mx) mx = v; if (v < mn) mn = v;
    }
    return mx > mn ? mx - mn : null;
  }
  function rideQuality(S, mot, bounds, levMask, zupt, vMask, fs) {
    const n = S.acc.length, sec = t => Math.round(t * fs);
    const lobes = [];
    for (const [gs, ge] of bounds) {
      for (let k = gs; k < ge;) {
        if (Math.abs(mot[k]) <= 0.1) { k++; continue; }
        let ls = k; while (ls > gs && Math.abs(mot[ls - 1]) > P.MOVE) ls--;
        let le = k; while (le < ge - 1 && Math.abs(mot[le]) > P.MOVE) le++;
        const dv = Math.abs(S.speed[le]) - Math.abs(S.speed[ls]);
        if (Math.abs(dv) >= 3) {
          let pk = 0, pa = 0;
          for (let i = ls; i <= le; i++) { pk = Math.max(pk, Math.abs(mot[i])); pa = Math.max(pa, Math.abs(S.acc[i])); }
          lobes.push({ ls, le, acc: dv > 0, pk, pa, gs, ge });
        }
        k = le + 1;
      }
    }
    // 운행 = 이어진 가속 덩어리들 + 이어진 감속 덩어리들 (계단식 가속·2단 감속도 한 운행)
    const groups = [];
    for (let i = 0; i < lobes.length;) {
      const g = { accs: [], decs: [] }, seg = lobes[i].gs;
      while (i < lobes.length && lobes[i].acc && lobes[i].gs === seg) g.accs.push(lobes[i++]);
      while (i < lobes.length && !lobes[i].acc && lobes[i].gs === seg) g.decs.push(lobes[i++]);
      groups.push(g);
    }
    const jMask = new Uint8Array(n), wMask = new Uint8Array(n), out = [];
    for (const g of groups) {
      const t = { start: null, arrive: null, wave: null, riseA: null, relD: null, at: null };
      let on = -1, landing = -1, off = -1;
      if (g.accs.length) {
        const A = g.accs[0];
        on = A.ls; while (on < A.le && Math.abs(mot[on]) < 0.1 * A.pk) on++;
        t.at = on / fs;
        if (on - A.gs >= sec(0.3)) t.start = ppIn(S.vibV, Math.max(A.gs, on - sec(0.6)), Math.min(A.ge, on + sec(0.8)));
        // 힘을 주는 시간: 가감속도가 최고의 10% → 90%
        let i10 = A.ls; while (i10 < A.le && Math.abs(S.acc[i10]) < 0.1 * A.pa) i10++;
        let i90 = i10; while (i90 < A.le && Math.abs(S.acc[i90]) < 0.9 * A.pa) i90++;
        if (A.ls > A.gs) t.riseA = (i90 - i10) / fs;
      }
      if (g.decs.length) {
        const D = g.decs[g.decs.length - 1];
        off = D.le; while (off > D.ls && Math.abs(mot[off]) < 0.1 * D.pk) off--;
        // 착상까지 기다리면 문 열림·사람 움직임이 섞이므로, 마지막 감속이 풀리는 순간을 기준으로 본다
        landing = off;
        if (D.ge - landing >= sec(0.3)) t.arrive = ppIn(S.vibV, Math.max(D.gs, landing - sec(0.5)), Math.min(D.ge, landing + sec(1.0)));
        // 힘을 빼는 시간: 가장 큰 감속 덩어리에서 마지막으로 90% → 10%
        let M = g.decs[0]; for (const d of g.decs) if (d.pa > M.pa) M = d;
        if (M.le < M.ge - 1) {
          let hi = M.le; while (hi > M.ls && Math.abs(S.acc[hi]) < 0.9 * M.pa) hi--;
          let lo = M.le; while (lo > hi && Math.abs(S.acc[lo]) < 0.1 * M.pa) lo--;
          t.relD = (lo - hi) / fs;
        }
      }
      // 가감속 중 울렁임
      for (const L of [...g.accs, ...g.decs]) {
        let a = L.ls; while (a < L.le && Math.abs(S.acc[a]) < 0.3 * L.pa) a++;
        let b = L.le; while (b > a && Math.abs(S.acc[b]) < 0.3 * L.pa) b--;
        if (L === g.accs[0] && on >= 0) a = Math.max(a, on + sec(0.8));
        if (L === g.decs[g.decs.length - 1] && off >= 0) b = Math.min(b, off - sec(0.3));
        if (b - a >= sec(0.5)) {
          const w = ppIn(S.vibV, a, b + 1, levMask);
          if (w != null && (t.wave == null || w > t.wave)) t.wave = w;
          for (let i = a; i <= b; i++) if (!levMask[i]) wMask[i] = 1;
        }
        for (let i = Math.max(L.gs, L.ls - sec(0.3)); i <= Math.min(L.ge - 1, L.le + sec(0.3)); i++) if (!levMask[i]) jMask[i] = 1;
      }
      out.push(t);
    }
    const js = []; for (let i = 0; i < n; i++) if (jMask[i]) js.push(Math.abs(S.jerk[i]));
    const worst = k => { let v = null; for (const t of out) if (t[k] != null && (v == null || t[k] > v)) v = t[k]; return v; };
    const med = k => { const a = out.map(t => t[k]).filter(v => v != null).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
    const wt = texture(S.vibV, wMask, fs);
    return {
      waveFreq: wt ? wt.freq : null,          // 가감속 중 흔들림의 빠르기: 4.5 Hz 이하면 '울렁', 그 위는 '떨림'
      jerk: js.length >= sec(0.5) ? percentile(js, 0.99) : null,      // 99% 피크 (2026-11-25 사용자 확정)
      start: worst("start"), arrive: worst("arrive"), wave: worst("wave"),
      riseA: med("riseA"), relD: med("relD"), trips: out,
    };
  }
  /** 흔들림의 세기(절댓값 98% 피크)와 결(주파수·튀는 횟수) */
  function texture(sig, mask, fs) {
    const vals = []; let zc = 0, prev = 0;
    for (let i = 0; i < sig.length; i++) {
      if (!mask[i] || Number.isNaN(sig[i])) { prev = 0; continue; }
      const v = sig[i], s = v > 0 ? 1 : v < 0 ? -1 : 0;
      vals.push(Math.abs(v));
      if (s && prev && s !== prev) zc++;
      if (s) prev = s;
    }
    if (vals.length < fs) return null;
    const a95 = percentile(vals, 0.95);
    const p98 = percentile(vals, 0.98);       // 세기: 절댓값 98% 피크 (2026-11-26 사용자 확정, 예전 A95). A95는 결(툭 튀는 순간) 판정에만
    let max = 0; for (const v of vals) if (v > max) max = v;
    // 툭 튀는 순간: 평소(A95)보다 크게 튀는 봉우리, 0.3초 안의 것은 한 번으로
    const thr = Math.max(2.2 * a95, a95 + 5);
    let bumps = 0, last = -1e9;
    for (let i = 1; i < sig.length - 1; i++) {
      if (!mask[i]) continue;
      const q = Math.abs(sig[i]);
      if (q > thr && q >= Math.abs(sig[i - 1]) && q >= Math.abs(sig[i + 1]) && i - last > 0.3 * fs) { bumps++; last = i; }
    }
    // 툭툭 빈도 (2026-11-25 사용자 확정): 8 gal 넘게 튀는 봉우리 (0.25초 안의 것은 한 번으로), 10초당 횟수
    let hits = 0, lastH = -1e9;
    for (let i = 1; i < sig.length - 1; i++) {
      if (!mask[i]) continue;
      const q = Math.abs(sig[i]);
      if (q >= HIT_GAL && q >= Math.abs(sig[i - 1]) && q >= Math.abs(sig[i + 1]) && i - lastH > 0.25 * fs) { hits++; lastH = i; }
    }
    const seconds = vals.length / fs;
    return { a95, p98, max, freq: zc / 2 / seconds, bumps, spikes: bumps, hits, hitRate: hits / seconds * 10, seconds, n: vals.length };
  }
  const HIT_GAL = 8;
  /** 흔들림의 결: none(거의 없음) · single(한 번 툭) · sway(출렁, 3 Hz 이하) · tap(툭툭) */
  function vibKind(t) {
    if (!t || !t.n) return "none";
    if (t.bumps >= 1 && t.bumps <= 2 && t.max >= 10 && t.max >= 2.5 * t.a95) return "single";
    if (t.a95 < 3) return "none";
    return t.freq <= 3 ? "sway" : "tap";
  }
  const zp = (x, fc, fs) => {            // 0위상 2차 저역통과 (앞뒤로 한 번씩)
    const n = x.length, pad = Math.min(n - 1, Math.round(fs * 1.5));
    const ext = new Float64Array(n + 2 * pad);
    for (let i = 0; i < pad; i++) { ext[i] = 2 * x[0] - x[pad - i]; ext[n + pad + i] = 2 * x[n - 1] - x[n - 2 - i]; }
    for (let i = 0; i < n; i++) ext[pad + i] = x[i];
    const run = (arr) => { const f = Biquad.make(fc, fs, false); const y0 = arr[0]; f.x1 = f.x2 = f.y1 = f.y2 = y0; for (let i = 0; i < arr.length; i++) arr[i] = f.process(arr[i]); };
    run(ext); ext.reverse(); run(ext); ext.reverse();
    return ext.subarray(pad, pad + n);
  };

  /* ───────── 평가 · AI 평가 (2026-11-25 사용자 확정) ─────────
     평가에 영향을 주는 지표 (5단계: 아주 좋음 · 좋음 · 보통 · 나쁨 · 매우 나쁨)
       저크 |99% 피크|: ~0.8 · ~1.0 · ~1.4 · ~1.8 · 초과 (m/s³)       — 사용자 지정 (2026-11-25 A95 → 99% 피크)
       상하·좌우 흔들림 |98% 피크|: ~8 · ~10 · ~15 · ~20 · 초과 (gal)   — 사용자 지정 (2026-11-26 A95 → 98% 피크, 기준값은 그대로)
       가감속 중 울렁임 (최댓값 + |최솟값|): ~15 · ~30 · ~45 · ~60 · 초과 — 사용자 지정
       출발·도착 거칠기 (p-p): ~20 · ~40 · ~60 · ~90 · 초과 (gal)       — 견본 12개로 정함 (매끄러운 출발 6~15, 덜컹 36~50, 요동 77, 우당탕 147~169)
       상하 툭툭 빈도 (정속 중 8 gal 넘게 튀는 횟수, 10초당): ~1 · ~2 · ~4 · ~8 · 초과 — 상하 흔들림 등급은 세기와 빈도 중 나쁜 쪽 (사용자 확정: 빈도는 평가에만, 문장에는 드러내지 않음)
         견본: 송암·간석·장은·광명 0, 월계 0.2, 삼보 0.3, 세양 4.5, LH2 4.9, 노원 10.1, 형진 16.1 (정속 5초 이상일 때만)
     종합: 가장 나쁜 두 지표 단계의 평균(내림). 하나만 튀는 경우는 한 단계 덜 나쁘게 본다.
     성격 (평가에 영향 없음)
       가감속 세기: 1.3 이상 아주 강함 · 0.7 이상 조금 강함(2026-11-25, 0.73→0.7) · 0.4 이상 부드러움 · 0.3 이상 조금 약함 · 그 미만 느끼기 힘들 만큼 약함 — 사용자 지정
       힘을 주는 시간 1.4초 이상 '슬며시', 0.55초 이하 '엣지 있게' / 힘을 빼는 시간 1.5초 이상 '슬며시', 0.5초 이하 '딱 끊어'
       흔들림의 결: 3 Hz 이하 출렁, 그 위 툭툭, 평소의 2.5배 넘게 한두 번만 튀면 '한 번 툭'
     속력: ~70 저속, ~130 중속, ~250 고속, ~500 초고속, 그 이상 '초고속의 초월' */
  const EVAL_VER = 30;
  const GRADE = ["아주 좋음", "좋음", "보통", "나쁨", "매우 나쁨"];
  const TH = { jerk: [0.8, 1.0, 1.4, 1.8], vib: [8, 10, 15, 20], wave: [15, 30, 45, 60], start: [20, 40, 60, 90], arrive: [20, 40, 60, 90], hit: [1, 2, 4, 8] };
  const DEC = { jerk: 2, vib: 1, wave: 0, start: 0, arrive: 0, hit: 1 };
  function levelOf(v, key) {
    if (v == null) return null;
    const r = +v.toFixed(DEC[key]), t = TH[key];   // 화면에 보이는 자릿수로 판정해 숫자와 평이 어긋나지 않게
    return r <= t[0] ? 0 : r <= t[1] ? 1 : r <= t[2] ? 2 : r <= t[3] ? 3 : 4;
  }
  // 가감속 세기 [하한, 이름, 꾸밈(~한), 이음(~하고), 서술(~해요)]
  const ACC_LV = [
    [1.3, "아주 강함", "아주 강한", "아주 강하고", "아주 강해요"],
    [0.7, "조금 강함", "조금 강한", "조금 강하고", "조금 강해요"],
    [0.4, "부드러움", "부드러운", "부드럽고", "부드러워요"],
    [0.3, "조금 약함", "조금 약한", "조금 약하고", "조금 약해요"],
    [-Infinity, "느끼기 힘들 만큼 약함", "느끼기 힘들 만큼 약한", "느끼기 힘들 만큼 약하고", "느끼기 힘들 만큼 약해요"],
  ];
  function accLv(a) { const r = Math.round(a * 100) / 100; return ACC_LV.find(x => r >= x[0]); }
  function speedGrade(v) {
    if (v < 3) return { t: "운행이 감지되지 않았어요", s: "정지" };
    if (v <= 70) return { t: "저속 승강기예요", s: "저속" };
    if (v <= 130) return { t: "중속 승강기예요", s: "중속" };
    if (v <= 250) return { t: "고속 승강기예요", s: "고속" };
    if (v <= 500) return { t: "초고속 승강기예요", s: "초고속" };
    return { t: "초고속의 초월", s: "초고속의 초월" };
  }

  /* AI 평가 말뭉치: 지표마다·단계마다 5개씩 (같은 기록은 늘 같은 문장이 나오도록 기록 값으로 고른다) */
  const WORDS = {
    open: [
      ["아주 좋아요.", "아주 편안해요.", "훌륭해요.", "아주 쾌적해요.", "흠잡기 어려워요."],
      ["좋아요.", "편안해요.", "꽤 괜찮아요.", "만족스러워요.", "기분 좋게 타요."],
      ["나쁘지 않아요.", "무난해요.", "보통이에요.", "그럭저럭 괜찮아요.", "평범해요."],
      ["아쉬워요.", "별로예요.", "참을 만해요.", "조금 불편해요.", "아쉬운 점이 많아요."],
      ["불편해요.", "많이 거칠어요.", "끔찍해요.", "그냥 놀이기구예요.", "점검이 필요해 보여요."],
    ],
    perfect: ["완벽해요, 나무랄 데 없어요.", "흠잡을 데가 없어요.", "더할 나위 없이 훌륭해요.", "티 하나 없이 완벽해요.", "이보다 좋을 순 없어요."],
    // 출발 (꾸밈말 + '출발에')
    start: [
      ["깔끔한", "매끄러운", "충격 없는", "사뿐한", "조용한"],
      ["살짝 들썩이는", "살짝 울컥하는", "가볍게 톡 치는", "살짝 덜컥하는", "조금 들뜨는"],
      ["덜컹거리는", "울컥하는", "툭 치는", "덜컥하는", "들썩이는"],
      ["퉁 하고 튀는", "요동치는", "쿵 하는", "크게 덜컹이는", "거칠게 튀는"],
      ["우당탕하는", "쾅 하고 치는", "심하게 요동치는", "내동댕이치는 듯한", "놀이기구 같은"],
    ],
    // 도착 (꾸밈말 + '도착')
    arrive: [
      ["깔끔한", "사뿐한", "부드러운", "매끄러운", "조용한"],
      ["살짝 출렁이는", "살짝 울컥하는", "가볍게 톡 하는", "살짝 들썩이는", "살짝 덜컥하는"],
      ["덜컹하는", "툭 내려앉는", "울컥하는", "덜컥하는", "들썩이는"],
      ["퉁 하고 내려앉는", "쿵 하는", "크게 덜컹이는", "요동치는", "털썩 내려앉는"],
      ["쾅 하고 내려앉는", "우당탕하는", "심하게 요동치는", "내동댕이치는 듯한", "쿵쾅거리는"],
    ],
    // 가감속 중 울렁임: 0단계는 어찌씨(~없이), 나머지는 꾸밈말
    wave: [
      ["울렁임 없이", "출렁임 없이", "흔들림 없이", "매끈하게 이어지는", "고르게 이어지는"],
      ["살짝 울렁이는", "살짝 출렁이는", "가볍게 일렁이는", "살짝 물결치는", "조금 일렁이는"],
      ["울렁대는", "출렁이는", "일렁이는", "물결치는", "울렁울렁하는"],
      ["크게 울렁대는", "출렁출렁 요동치는", "심하게 일렁이는", "크게 물결치는", "울렁거림이 심한"],
      ["놀이기구처럼 출렁이는", "심하게 요동치는", "멀미 나는", "크게 휘청이는", "거세게 출렁이는"],
    ],
    // 가감속 중 흔들림이 빠르면(4.5 Hz 넘게) '울렁' 대신 '떨림'
    shake: [
      ["떨림 없이", "흔들림 없이", "매끈하게 이어지는", "고르게 이어지는", "잔떨림 없이"],
      ["살짝 떨리는", "가볍게 떨리는", "잘게 떨리는", "살짝 파르르한", "조금 떨리는"],
      ["덜덜 떨리는", "파르르 떨리는", "진동하는", "부르르 떨리는", "잘게 흔들리는"],
      ["크게 떨리는", "덜덜거리는", "부르르 크게 떨리는", "요란하게 떨리는", "거세게 진동하는"],
      ["심하게 덜덜거리는", "요란하게 진동하는", "거세게 떨리는", "드르륵 떨리는", "덜컹덜컹 떨리는"],
    ],
    // 저크: 속력을 부드럽게 바꾸는가, 치듯이 바꾸는가
    jerk: [
      ["부드러운", "매끄러운", "미끄러지는 듯한", "사뿐한", "물 흐르는 듯한"],
      ["무난한", "차분한", "자연스러운", "깔끔한", "단정한"],
      ["각진", "살짝 급한", "서두르는", "다부진", "딱딱한"],
      ["치고 나가는", "급한", "거친", "덜컥이는", "잡아끄는 듯한"],
      ["잡아채는 듯한", "몹시 거친", "몹시 급한", "내동댕이치는 듯한", "거칠기 짝이 없는"],
    ],
    // 흔들림 (방향 + 말): 결과 단계마다
    // 톡톡·툭툭은 단계마다 한 개만 (2026-11-25 사용자 요청: 너무 자주 나옴)
    tap: [["살짝 사르르", "잔물결처럼 살짝", "미세하게 자글자글", "아주 가볍게 톡톡", "잔잔하게 사르르"],
          ["가볍게 자글자글", "잘게 드르르", "가끔 툭툭", "살짝 덜덜", "조금씩 들썩"],
          ["덜덜", "자꾸 툭툭", "들썩들썩", "투둑투둑", "드르르 잘게"],
          ["툭툭 거칠게", "쿵쿵", "덜컹덜컹", "투둑투둑 거칠게", "자꾸 덜컹"],
          ["쿵쿵 세게", "덜컹덜컹 세게", "쾅쾅", "요란하게 덜컹", "쉴 새 없이 쿵쿵"]],
    sway: [["살짝 일렁", "잔잔하게 일렁", "가볍게 출렁", "살며시 일렁", "은은하게 출렁"],
           ["살짝 출렁", "출렁", "일렁일렁", "살짝 울렁", "느긋하게 출렁"],
           ["울렁울렁", "출렁출렁", "일렁일렁 크게", "넘실넘실", "물결치듯 출렁"],
           ["크게 울렁울렁", "크게 출렁출렁", "휘청휘청", "멀미 나게 울렁", "크게 넘실"],
           ["놀이기구처럼 출렁", "심하게 휘청", "배처럼 울렁", "크게 휘청휘청", "거세게 출렁"]],
    single: [["한 번 살짝 들썩", "딱 한 번 톡", "한두 번 살짝", "가끔 한 번 들썩", "한 번 살짝 덜컥"],
             ["한 번 툭", "딱 한 번 덜컥", "한두 번 들썩", "가끔 한 번 덜컥", "한 번 크게 들썩"],
             ["한 번 쿵", "한 번 덜컹", "한두 번 쿵", "한 번 크게 툭", "한 번 덜컥"],
             ["한 번 크게 쿵", "한 번 크게 덜컹", "한두 번 쿵", "한 번 쾅", "크게 한 번 툭"],
             ["한 번 쾅", "크게 한 번 쾅", "한두 번 쾅", "한 번 크게 쾅", "한 번 요란하게 쿵"]],
    calm: ["위아래도 좌우도 잔잔해요.", "어느 쪽으로도 흔들림 없이 잔잔해요.", "위아래도 좌우도 고요하고 잔잔해요.", "흔들림 없이 잔잔하고 차분해요.", "물컵을 올려 둬도 될 만큼 잔잔해요."],
    // 상하 흔들림 '아주 좋음'이면 '잔잔하다' 문구 (2026-11-25 사용자 확정)
    calmV: ["위아래로 잔잔해요.", "위아래 흔들림 없이 잔잔해요.", "위아래로 고요하고 잔잔해요.", "위아래로 물결 없이 잔잔해요.", "위아래로 차분하게 잔잔해요."],
    // 성격: 힘을 주는 방식·빼는 방식
    riseSoft: ["슬며시 힘을 주며 출발해요.", "천천히 힘을 실으며 나아가요.", "스르르 힘을 더해 가요.", "조심스럽게 속력을 올려요.", "살며시 밀어 주듯 출발해요."],
    riseEdge: ["망설임 없이 힘을 실어요.", "단번에 힘을 주며 나아가요.", "엣지 있게 치고 나가요.", "시원시원하게 속력을 올려요.", "또렷하게 힘을 줘요."],
    relSoft: ["멈출 땐 슬며시 힘을 빼요.", "스르르 힘을 풀며 멈춰요.", "천천히 브레이크를 풀며 서요.", "여유 있게 힘을 빼며 도착해요.", "살며시 내려놓듯 멈춰요."],
    relEdge: ["멈출 땐 딱 끊어 서요.", "단호하게 멈춰 서요.", "망설임 없이 딱 멈춰요.", "칼같이 멈춰요.", "깔끔하게 끊어 멈춰요."],
  };
  // 성격: 가감속 세기 (간단히 화면의 한 줄 평)
  WORDS.strength = {
    "아주 강함": ["몸이 확 쏠릴 만큼 강해요", "힘껏 밀어붙이듯 움직여요", "롤러코스터처럼 박력 있어요", "무릎이 움찔할 만큼 강해요", "아주 힘차게 달려 나가요"],
    "조금 강함": ["힘 있게 쭉 나아가요", "또렷하게 밀어 주는 느낌이에요", "조금 강하지만 시원시원해요", "든든하게 힘을 실어요", "몸이 살짝 쏠릴 만큼 힘 있어요"],
    "부드러움": ["부드럽게 미끄러지듯 움직여요", "알맞게 부드러워요", "몸이 편안하게 따라가요", "포근하게 밀어 줘요", "부담 없이 부드러워요"],
    "조금 약함": ["살살 조심스럽게 움직여요", "조금 약하게 힘을 줘요", "느긋하게 속력을 바꿔요", "천천히 여유 있게 움직여요", "힘을 아끼듯 조금 약해요"],
    "느끼기 힘들 만큼 약함": ["움직이는지 모를 만큼 약해요", "가감속을 거의 느낄 수 없어요", "출발했는지도 모르게 스르르 움직여요", "아주 살며시 움직여요", "숨죽인 듯 조용히 움직여요"],
  };
  // 성격: 흔들림의 결 (간단히 화면의 한 줄 평, 앞에 '위아래로'·'좌우로')
  WORDS.feel = {
    none: ["잔잔해요", "고요하게 잔잔해요", "흔들림 없이 잔잔해요", "물컵도 잔잔할 만큼 조용해요", "잔잔하고 차분해요"],
    sway: ["천천히 출렁여요", "물결치듯 넘실거려요", "배를 탄 듯 일렁여요", "느릿하게 울렁거려요", "그네처럼 출렁여요"],
    tap: ["자글자글 떨려요", "잔걸음처럼 톡톡 튀어요", "잘게 덜덜 떨려요", "자갈길처럼 투둑거려요", "잘게 들썩여요"],
    single: ["한 번씩 들썩여요", "가끔 한 번 툭 쳐요", "딱 한 번 덜컥해요", "잔잔하다가 한 번 들썩해요", "이음매를 지나듯 한 번 튀어요"],
  };
  const RISE_SOFT = 1.4, RISE_EDGE = 0.55, REL_SOFT = 1.5, REL_EDGE = 0.5;
  const seedOf = m => Math.floor(((m.distance || 0) * 7.3 + (m.accPeak || 0) * 131 + (m.duration || 0) * 3.1 + (m.vibV ? m.vibV.p98 : 0) * 17) * 97) >>> 0;
  const pickBy = (arr, seed, k = 0) => arr[((seed >>> 4) + k * 7) % arr.length];

  /** AI 평가 문장 만들기 */
  function aiText(m, L, overall, perfect) {
    let seed = seedOf(m);
    // 같은 말(앞 두 글자)이 한 평 안에 겹치지 않게 고른다
    const used = new Set();
    const stems = w => w.split(/\s+/).filter(t => t.length >= 2).map(t => t.slice(0, 2));
    const mark = w => { stems(w).forEach(x => used.add(x)); return w; };
    const pick = arr => {
      const ok = arr.filter(w => !stems(w).some(x => used.has(x))), from = ok.length ? ok : arr;
      seed = (seed * 1103515245 + 12345) >>> 0;
      return mark(from[(seed >>> 8) % from.length]);
    };
    const fast = m.waveFreq != null && m.waveFreq > 4.5;
    // 평가엔 들지 않을 만큼 작아도, 가감속에 비해 큰 울렁임(예: 아주 약한 가감속의 잔물결)은 말로는 짚어 준다
    const mild = L.wave === 0 && !fast && m.wave != null && m.accPeak > 0.05 && m.wave / (m.accPeak * 100) >= 0.3;
    const out = [perfect && !mild ? pick(WORDS.perfect) : pick(WORDS.open[overall])];
    // 1) 출발 · 가감속 · 도착
    if (m.accMax > 0.05 || m.decMax > 0.05) {
      const xA = accLv(m.accMax), xD = accLv(m.decMax);
      const style = m.riseA == null ? null : m.riseA >= RISE_SOFT ? "soft" : m.riseA <= RISE_EDGE ? "edge" : null;
      const W = mild ? 1 : L.wave, wav = fast ? WORDS.shake : WORDS.wave;
      const startW = L.start != null ? pick(WORDS.start[L.start]) : null;
      mark(xA[3]); mark(xD[3]);
      let d2 = null, usedStyle = false;
      if (W != null && W >= 2) d2 = pick(wav[W]);
      else if (L.jerk != null && L.jerk >= 2) d2 = pick(WORDS.jerk[L.jerk]);
      else if (W === 1) d2 = pick(wav[1]);
      else if (style) { d2 = pick(style === "soft" ? ["슬며시 힘 주는", "천천히 힘을 싣는", "스르르 밀어 주는", "살며시 힘 주는", "느긋하게 힘 주는"] : ["엣지 있는", "또렷한", "시원시원한", "단단한", "망설임 없는"]); usedStyle = true; }
      const calm = W === 0 ? pick(wav[0]) + " " : "";
      const body = xA === xD
        ? (d2 ? `${xA[3]} ${d2} 가감속` : `${calm}${xA[2]} 가감속`)
        : `${d2 ? d2 + " " : calm}${xA[2]} 가속과 ${xD[2]} 감속`;
      let s1 = startW ? `${startW} 출발에 ${body}` : body;
      if (L.arrive != null && (L.arrive >= 2 || (L.arrive === 0 && L.start != null && L.start >= 2))) s1 += `, ${pick(WORDS.arrive[L.arrive])} 도착`;
      out.push(s1 + ".");
      // 성격: 힘을 주고 빼는 방식 (거친 출발·저크가 앞서면 말하지 않는다)
      const relS = m.relD == null ? null : m.relD >= REL_SOFT ? "soft" : m.relD <= REL_EDGE ? "edge" : null;
      const plain = (L.start == null || L.start < 3) && (L.jerk == null || L.jerk < 2);
      if (plain && style && !usedStyle) out.push(pick(style === "soft" ? WORDS.riseSoft : WORDS.riseEdge));
      else if (plain && relS && (L.arrive == null || L.arrive < 2)) out.push(pick(relS === "soft" ? WORDS.relSoft : WORDS.relEdge));
    }
    // 2) 흔들림
    const dirWord = (t, lv) => { const k = vibKind(t); return k === "none" ? null : pick(WORDS[k][lv]); };
    // 상하 흔들림 등급이 '아주 좋음'이면 위아래는 잔잔한 것으로 말한다 (결이 톡톡이어도)
    const kV = m.vibV && m.vibV.n && L.vibVg !== 0 ? vibKind(m.vibV) : "none", kL = m.vibL && m.vibL.n ? vibKind(m.vibL) : "none";
    if (kV !== "none" && kL !== "none" && kV === kL && L.vibV === L.vibL) out.push(`위아래, 좌우로도 ${dirWord(m.vibV, L.vibV)}.`);
    else {
      const wV = kV !== "none" ? dirWord(m.vibV, L.vibV) : null, wL = kL !== "none" ? dirWord(m.vibL, L.vibL) : null;
      if (!wV && !wL) out.push(pick(m.vibL ? WORDS.calm : WORDS.calmV));
      else if (wV && wL) out.push(`위아래로 ${wV}, 좌우로는 ${wL}.`);
      else if (wV) out.push(m.vibL ? `좌우는 잔잔하고 위아래로 ${wV}.` : `위아래로 ${wV}.`);
      else out.push(`위아래는 잔잔하고 좌우로 ${wL}.`);
    }
    return out.join(" ");
  }
  /** 흔들림 한 줄 (간단히 화면) */
  function vibLine(t, vertical, seed, calm) {
    if (!t || !t.n) return "";
    const k = calm ? "none" : vibKind(t), dir = vertical ? "위아래로" : "좌우로";
    const f = k === "single" ? ` · 최대 ${t.max.toFixed(0)} gal` : k === "none" || !t.freq ? "" : ` · 약 ${t.freq.toFixed(1)} Hz`;
    return `${dir} ${pickBy(WORDS.feel[k], seed, vertical ? 1 : 2)}${f}`;
  }
  function evaluate(m) {
    // 상하 흔들림: 세기(|98% 피크|)와 툭툭 빈도 중 나쁜 쪽. 문장은 세기만으로 고른다 (빈도는 드러내지 않음)
    const vibVa = m.vibV && m.vibV.n ? levelOf(m.vibV.p98, "vib") : null;
    const vibVh = m.vibV && m.vibV.seconds >= 5 ? levelOf(m.vibV.hitRate, "hit") : null;
    const L = {
      jerk: levelOf(m.jerk, "jerk"),
      vibV: vibVa == null ? null : Math.max(vibVa, vibVh || 0),
      vibL: m.vibL && m.vibL.n ? levelOf(m.vibL.p98, "vib") : null,
      wave: levelOf(m.wave, "wave"), start: levelOf(m.start, "start"), arrive: levelOf(m.arrive, "arrive"),
    };
    const lv = Object.values(L).filter(v => v != null).sort((a, b) => b - a);
    const overall = !lv.length ? null : lv.length === 1 ? lv[0] : Math.floor((lv[0] + lv[1]) / 2);
    const perfect = lv.length >= 3 && lv[0] === 0;
    const g = k => (L[k] == null ? { lv: -1, s: "기록이 없어요." } : { lv: L[k], s: GRADE[L[k]] });
    const xA = accLv(m.accMax), xD = accLv(m.decMax), seed = seedOf(m);
    const sg = speedGrade(m.speedMax);
    const text = m.speedMax < 3 || overall == null ? "엘리베이터가 움직인 구간을 찾지 못했어요." : aiText(m, { ...L, vibV: vibVa, vibVg: L.vibV }, overall, perfect);
    return {
      ver: EVAL_VER, overall: text, level: overall, levels: L,
      acc: { s: xA === xD ? xA[1] : `${xA[1]}·${xD[1]}`, t: xA === xD ? pickBy(WORDS.strength[xA[1]], seed) : `가속은 ${xA[3]} 감속은 ${xD[4]}`,
        detail: `가속은 ${xA[3]} 감속${xA === xD ? "도" : "은"} ${xD[4]}`, a: xA[1], d: xD[1] },
      jerk: g("jerk"), wave: g("wave"), start: g("start"), arrive: g("arrive"),
      vibV: { ...g("vibV"), line: vibLine(m.vibV, true, seed, L.vibV === 0) },
      vibL: m.vibL ? { ...g("vibL"), line: vibLine(m.vibL, false, seed) } : null,
      // 정격 속력에 닿기 전에 감속한 짧은 운행 / 기록이 잘려 일부 구간으로만 잰 값 (2026-11-25 사용자 확정)
      speed: m.speedShort ? { lv: 0, t: "정격 속력에 닿기 전에 멈췄어요", s: sg.s, card: "정격 속력 미도달" }
        : m.speedRef ? { lv: 0, t: `${sg.t} (참고값)`, s: sg.s, card: `${m.speedMax <= 500 ? sg.s + " 승강기" : sg.s} · 참고값` }
        : { lv: 0, t: sg.t, s: sg.s },
    };
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
    const t = [], b = [], e = [], sg = [];
    let hasE = false;
    // elMotion에서 내보낸 파일의 일시정지 구간 번호 (segment 열)
    const segCol = (rows[2] || []).findIndex(c => String(c).trim() === "segment");
    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      const tv = num(row[0]), bv = num(row[1]);
      if (Number.isNaN(tv) || Number.isNaN(bv)) continue;
      const ev = num(row[4]);
      t.push(tv); b.push(bv); e.push(ev); if (segCol >= 0) sg.push(num(row[segCol]));
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
    // elMotion에서 내보낸 파일이면 측정 시각 복원
    let startedAt = null;
    const r2 = rows[1] || [];
    if (String(r2[0] || "").startsWith("# started_at")) { const d = Date.parse(String(r2[1]).replace(" ", "T")); if (!Number.isNaN(d)) startedAt = d; }
    let segs = null;
    if (sg.length) {
      const st = [0];
      for (let k = 1; k < sg.length; k++) if (sg[k] !== sg[k - 1] && !Number.isNaN(sg[k])) st.push(Math.round(ts[k] * FS));
      if (st.length > 1) segs = st;
    }
    return { vert: vN.data, lat: lN ? lN.data : null, rate: FS, startedAt, segs, info: { srcRate, vertUnit: vN.unit, latUnit: lN ? lN.unit : null } };
  }

  /** 상하 가속도만 있는 .txt (LiftTest 형식: 첫 줄 'Time  Acceleration', 그 아래 '초  m/s²' 두 열, 중력 제거됨).
      형식이 다르면 TXT_BAD 오류를 던진다 → 화면에서 '승차감 기록이 아닌 것 같아요.' */
  const TXT_BAD = "TXT_BAD";
  function importTxt(text) {
    const bad = () => { const e = new Error("승차감 기록이 아닌 것 같아요."); e.code = TXT_BAD; return e; };
    const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).map(l => l.trim()).filter(l => l !== "");
    if (lines.length < 12 || !/^time\s*[\t,; ]\s*acceleration$/i.test(lines[0].replace(/\s+/g, " ").replace(/ ?([\t,;]) ?/g, "$1"))) throw bad();
    const t = [], a = [];
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(/[\t,; ]+/);
      if (c.length !== 2) throw bad();
      const tv = Number(c[0]), av = Number(c[1]);
      if (!Number.isFinite(tv) || !Number.isFinite(av)) throw bad();
      if (t.length && !(tv > t[t.length - 1])) throw bad();       // 시간은 늘어나기만
      t.push(tv); a.push(av);
    }
    const dt = (t[t.length - 1] - t[0]) / (t.length - 1);
    if (!(dt > 0.001 && dt < 0.2)) throw bad();                  // 5~1000 Hz 사이
    const t0 = t[0], dur = t[t.length - 1] - t0, n = Math.max(2, Math.floor(dur * FS) + 1);
    const out = new Float64Array(n); let j = 0;
    for (let i = 0; i < n; i++) {
      const tt = t0 + i / FS;
      while (j < t.length - 2 && t[j + 1] < tt) j++;
      const x0 = t[j], x1 = t[j + 1];
      out[i] = a[j] + (a[j + 1] - a[j]) * Math.min(1, Math.max(0, (tt - x0) / (x1 - x0)));
    }
    const vN = normalizeColumn(Array.from(out), FS);
    return { vert: vN.data, lat: null, rate: FS, startedAt: null, segs: null, zOnly: true, info: { srcRate: 1 / dt, vertUnit: vN.unit, latUnit: null } };
  }

  function exportCsv(rec, A) {
    const S = A.series, n = rec.vert.length, f = (v, d = 4) => (Number.isNaN(v) ? "" : v.toFixed(d));
    const d = new Date(rec.startedAt), p = x => String(x).padStart(2, "0");
    const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const lines = [
      `# name,"${(rec.name || "").replace(/"/g, '""')}"`,
      `# started_at,${when},sample_rate_hz,${rec.rate}`,
      "time_s,vertical_accel_m_s2,accel_m_s2,jerk_m_s3,lateral_accel_m_s2,vertical_vib_gal,lateral_vib_gal,speed_m_min,distance_m,segment",
    ];
    const bd = segBounds(n, rec.segs);
    for (let k = 0; k < bd.length; k++) for (let i = bd[k][0]; i < bd[k][1]; i++) {
      lines.push([(i / rec.rate).toFixed(4), f(rec.vert[i]), f(S.acc[i]), f(S.jerk[i]),
        rec.lat ? f(rec.lat[i]) : "", f(S.vibV[i], 2), rec.lat ? f(S.vibL[i], 2) : "", f(S.speed[i], 2), f(S.dist[i], 3), k + 1].join(","));
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
    analyze, segBounds, accLv, evaluate, aiText, vibKind, GRADE, TH, WORDS, _dbg: { zp, texture, rideQuality }, EVAL_VER, ppStats, percentile, parseCsv, importCsv, importTxt, TXT_BAD, exportCsv, DemoSignal,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== "undefined" ? window : globalThis);
