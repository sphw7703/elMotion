/* elMotion · 기기 연동 (2026-11-25 사용자 확정)
   태블릿·휴대폰의 기록(직접 잰 것 + 가져온 파일)을 사용자의 구글 드라이브 '앱 전용 공간'(appDataFolder)에 모아 서로 맞춘다.
   - 앱 전용 공간: 이 앱만 읽고 쓰는 숨은 폴더. 드라이브의 다른 파일은 볼 수 없다 (drive.appdata, 구글 심사가 필요 없는 범위).
   - 기록 하나 = 파일 하나 (<기록 id>.json). 목록만 받아도 비교할 수 있게 appProperties에 요약을 단다.
       rid 기록 id · upd 마지막 수정 시각 · del 지운 시각(0 = 살아 있음) · key 가져온 파일의 '이름+용량' 지문 · nm 이름 앞부분 · st 측정 시각
   - 같은 파일: 가져온 파일의 이름과 용량이 모두 같으면 같은 기록으로 보고 하나만 남긴다 (id가 작은 쪽).
   - 지우기: 어느 기기에서 지우든 모든 기기에서 지운다. 드라이브에는 30일 동안 남겨 '지운 기록'에서 되살릴 수 있다.
   - 고친 기록(이름 바꾸기 등): 나중에 고친 쪽이 이긴다.
   - 신호가 없을 때(엘리베이터 안)는 그대로 쓰고, 신호가 돌아오면 맞춘다. */
const GSYNC_CLIENT_ID = "644111210876-nurq623vl9hj7dfoofniqsojbcsl1tk5.apps.googleusercontent.com";   // 구글 클라우드의 OAuth 클라이언트 ID (웹 애플리케이션, 승인된 출처 https://sphw7703.github.io)

const gsync = {
  clientId: GSYNC_CLIENT_ID,
  SCOPE: "https://www.googleapis.com/auth/drive.appdata",
  KEEP: 30 * 864e5,                 // 지운 기록을 드라이브에 남겨 두는 기간
  token: null, exp: 0, client: null, gis: null, busy: false, again: false, timer: 0, state: "", _res: null,

  get ready() { return !!this.clientId; },
  get on() { return prefs.get("sync.on", "0") === "1"; },
  set on(v) { prefs.set("sync.on", v ? "1" : "0"); },
  get dead() { try { return JSON.parse(prefs.get("sync.dead", "{}")) || {}; } catch (e) { return {}; } },
  set dead(o) { prefs.set("sync.dead", JSON.stringify(o)); },
  get last() { return +prefs.get("sync.last", "0") || 0; },

  init() {
    try { const t = JSON.parse(prefs.get("sync.tok", "null")); if (t && t.exp > Date.now() + 60e3) { this.token = t.v; this.exp = t.exp; } } catch (e) { /* 무시 */ }
    if (this.on) this.preload();
    this.render();
    if (this.on && this.tokenOk()) this.soon(800);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && this.on && this.tokenOk()) this.soon(400); });
    window.addEventListener("online", () => { if (this.on && this.tokenOk()) this.soon(400); });
  },
  tokenOk() { return !!this.token && this.exp > Date.now() + 60e3; },

  /** 구글 로그인 도구를 미리 불러 둔다 (로그인 창은 버튼을 누른 그 순간에 열어야 막히지 않아서) */
  preload() {
    if (!this.ready || this.gis) return this.gis;
    this.gis = new Promise(res => {
      if (window.google && google.accounts && google.accounts.oauth2) return res(true);
      const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      s.onload = () => res(true); s.onerror = () => { this.gis = null; res(false); };
      document.head.appendChild(s);
    });
    return this.gis;
  },
  /** 버튼을 누른 순간에만 부른다: 구글 계정 창 → 토큰 */
  askToken(prompt) {
    return new Promise(res => {
      if (!(window.google && google.accounts && google.accounts.oauth2)) { this.preload(); toast("구글 연결을 준비하고 있어요. 잠시 뒤 다시 눌러 주세요."); return res(false); }
      if (!this.client) this.client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId, scope: this.SCOPE,
        callback: r => this._got(r), error_callback: () => this._got(null),
      });
      this._res = res;
      const hint = prefs.get("sync.email", "");
      this.client.requestAccessToken(hint ? { prompt: prompt || "", hint } : { prompt: prompt || "" });
    });
  },
  _got(r) {
    const ok = !!(r && r.access_token && google.accounts.oauth2.hasGrantedAllScopes(r, this.SCOPE));
    if (ok) { this.token = r.access_token; this.exp = Date.now() + (r.expires_in || 3600) * 1000; prefs.set("sync.tok", JSON.stringify({ v: this.token, exp: this.exp })); }
    const f = this._res; this._res = null; if (f) f(ok);
  },

  /* ───── 연결 · 끊기 ───── */
  async connect() {
    if (!(await this.askToken(""))) { toast("구글 드라이브에 연결하지 못했어요."); return; }
    try { const a = await (await this.api("drive/v3/about?fields=user(emailAddress)")).json(); if (a.user && a.user.emailAddress) prefs.set("sync.email", a.user.emailAddress); } catch (e) { /* 계정 표시만 못 함 */ }
    this.on = true; this.render(); toast("구글 드라이브에 연결했어요. 동기화할게요.");
    this.run();
  },
  async disconnect() {
    if (!(await confirmDlg("기기 연동을 끌까요?", "이 기기의 기록은 그대로 남고, 드라이브의 기록도 지워지지 않아요."))) return;
    try { if (this.token && window.google) google.accounts.oauth2.revoke(this.token, () => {}); } catch (e) { /* 무시 */ }
    this.token = null; this.exp = 0; prefs.set("sync.tok", "null"); this.on = false; this.state = ""; this.render(); toast("기기 연동을 껐어요.");
  },
  /** 기록 줄의 상태 글자를 누르거나 '지금 맞추기': 토큰이 끝났으면 다시 받고 맞춘다 */
  async now() {
    if (!this.on) return;
    if (!this.tokenOk() && !(await this.askToken(""))) { this.setState("need"); return; }
    this.run();
  },

  /* ───── 기록 저장소에서 부르는 곳 ───── */
  touched(id, deleted) {
    if (deleted) { const d = this.dead; d[id] = Date.now(); this.dead = d; }
    if (this.on) this.soon(1500);
  },
  soon(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms); },

  /* ───── 드라이브 ───── */
  async api(path, opt) {
    opt = opt || {};
    const r = await fetch("https://www.googleapis.com/" + path, Object.assign({}, opt, { headers: Object.assign({}, opt.headers || {}, { Authorization: "Bearer " + this.token }) }));
    if (r.status === 401) { this.token = null; prefs.set("sync.tok", "null"); const e = new Error("auth"); e.auth = true; throw e; }
    if (!r.ok && r.status !== 404) throw new Error("drive " + r.status);
    return r;
  },
  async listRemote() {
    const files = []; let pt = "";
    do {
      const q = `drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,appProperties)${pt ? "&pageToken=" + encodeURIComponent(pt) : ""}`;
      const r = await (await this.api(q)).json(); files.push(...(r.files || [])); pt = r.nextPageToken || "";
    } while (pt);
    return files;
  },
  props(rec, del) {
    return { rid: rec.id, upd: String(rec.updatedAt || 0), del: String(del || 0), key: rec.srcKey || "",
      nm: (rec.name || "").slice(0, 30), st: String(rec.startedAt || 0) };
  },
  async upload(rec, fileId) {
    const meta = { name: rec.id + ".json", mimeType: "application/json", appProperties: this.props(rec) };
    if (!fileId) meta.parents = ["appDataFolder"];
    const b = "elm" + Math.random().toString(36).slice(2);
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${packRec(rec)}\r\n--${b}--`;
    const r = await this.api(`upload/drive/v3/files${fileId ? "/" + fileId : ""}?uploadType=multipart&fields=id`,
      { method: fileId ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body });
    return (await r.json()).id;
  },
  async pull(fileId) {
    const rec = unpackRec(await (await this.api(`drive/v3/files/${fileId}?alt=media`)).text());
    await store.put(rec, { quiet: true });
    return rec;
  },
  patchMeta(fileId, p) {
    return this.api(`drive/v3/files/${fileId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appProperties: p }) });
  },
  drop(fileId) { return this.api(`drive/v3/files/${fileId}`, { method: "DELETE" }); },

  /* ───── 맞추기 ───── */
  async run() {
    if (!this.on || !this.ready) return;
    if (this.busy) { this.again = true; return; }
    if (!navigator.onLine) { this.setState("offline"); return; }
    if (!this.tokenOk()) { this.setState("need"); return; }
    this.busy = true; this.setState("busy");
    let changed = false;
    try {
      const now = Date.now(), dead = this.dead;
      const R = new Map();
      for (const f of await this.listRemote()) {
        const p = f.appProperties || {};
        if (p.rid) R.set(p.rid, { id: f.id, upd: +p.upd || 0, del: +p.del || 0, key: p.key || "" });
      }
      const metas = await store.list();
      const L = new Map(metas.map(m => [m.id, m]));
      // 같은 파일(이름+용량)이면 id가 가장 작은 기록만 남긴다 — 두 기기가 같은 답을 내도록
      const owner = new Map();
      const vote = (key, rid) => { if (key && (!owner.has(key) || rid < owner.get(key))) owner.set(key, rid); };
      for (const [rid, f] of R) if (!f.del && !dead[rid]) vote(f.key, rid);
      for (const m of metas) if (!dead[m.id]) vote(m.srcKey, m.id);
      const dupe = (key, rid) => !!key && owner.get(key) !== rid;

      for (const [rid, f] of R) {
        const m = L.get(rid);
        if (f.del) {                                            // 지운 기록 (어느 기기에서든)
          delete dead[rid];                                     // 드라이브에 이미 반영됨
          if (now - f.del > this.KEEP) await this.drop(f.id);
          else if (m) { await store.del(rid, { quiet: true }); changed = true; }
          continue;
        }
        if (dead[rid]) {                                        // 이 기기에서 지움
          const when = dead[rid]; delete dead[rid];
          if (f.upd > when) { await this.pull(f.id); changed = true; continue; }   // 그 뒤 다른 기기에서 되살림·고침 → 살린다
          await this.patchMeta(f.id, { del: String(when) }); continue;
        }
        if (dupe(f.key, rid)) { await this.drop(f.id); if (m) { await store.del(rid, { quiet: true }); changed = true; } continue; }
        if (!m) { await this.pull(f.id); changed = true; continue; }                          // 다른 기기의 새 기록
        const lu = m.updatedAt || 0;
        if (f.upd > lu) { await this.pull(f.id); changed = true; }
        else if (lu > f.upd) { const rec = await store.get(rid); if (rec) await this.upload(rec, f.id); }
      }
      for (const m of metas) {                                  // 이 기기에만 있는 기록
        if (R.has(m.id) || dead[m.id]) continue;
        if (dupe(m.srcKey, m.id)) { await store.del(m.id, { quiet: true }); changed = true; continue; }
        const rec = await store.get(m.id); if (rec) await this.upload(rec);
      }
      for (const k of Object.keys(dead)) if (now - dead[k] > this.KEEP) delete dead[k];
      this.dead = dead;
      prefs.set("sync.last", String(Date.now()));
      this.setState("ok");
    } catch (e) {
      this.setState(e && e.auth ? "need" : navigator.onLine ? "err" : "offline");
    } finally {
      this.busy = false;
      if (changed) { try { await records.render(); } catch (e) { /* 무시 */ } }
      if (this.again) { this.again = false; this.soon(500); }
    }
  },

  /* ───── 지운 기록 (30일) ───── */
  async trash() {
    if (!this.tokenOk() && !(await this.askToken(""))) { toast("구글 드라이브에 연결하지 못했어요."); return; }
    let list = [];
    try {
      const now = Date.now();
      list = (await this.listRemote()).map(f => ({ id: f.id, p: f.appProperties || {} }))
        .filter(x => +x.p.del && now - +x.p.del <= this.KEEP).sort((a, b) => +b.p.del - +a.p.del);
    } catch (e) { toast("지운 기록을 불러오지 못했어요."); return; }
    const row = x => {
      const left = Math.max(1, Math.ceil((this.KEEP - (Date.now() - +x.p.del)) / 864e5));
      const nm = x.p.nm || fmtDate(+x.p.st || 0);
      return `<div class="trash-row"><div class="t"><b>${esc(nm)}</b><span>${left}일 뒤 완전히 지워져요</span></div><button class="pill-btn" data-fid="${x.id}">되살리기</button></div>`;
    };
    dialog(`<h3>지운 기록</h3><p>지운 기록은 30일 동안 드라이브에 남아 있어요.</p>
      <div class="trash-list">${list.length ? list.map(row).join("") : `<p class="empty">지운 기록이 없어요.</p>`}</div>
      <div class="acts"><button class="solid" id="tOk">닫기</button></div>`, (b, close) => {
      b.querySelector("#tOk").onclick = close;
      b.querySelectorAll("[data-fid]").forEach(btn => btn.onclick = async () => {
        btn.disabled = true;
        try {
          const rec = await this.pull(btn.dataset.fid);
          rec.updatedAt = Date.now(); await store.put(rec, { quiet: true });
          await this.upload(rec, btn.dataset.fid);                // del 0 + 새 수정 시각
          const d = this.dead; delete d[rec.id]; this.dead = d;
          btn.closest(".trash-row").remove(); await records.render(); toast("기록을 되살렸어요.");
        } catch (e) { btn.disabled = false; toast("되살리지 못했어요."); }
      });
    });
  },

  /* ───── 화면 ───── */
  setState(s) { this.state = s; this.render(); },
  render() {
    const card = $("#syncCard"); if (!card) return;
    const desc = $("#syncDesc"), btn = $("#syncBtn"), acts = $("#syncActs"), icons = $("#syncIcons");   // 동기화 상태는 설정에서만 보여 준다 (2026-11-25)
    icons.hidden = !(this.ready && this.on);
    $("#syncNow").classList.toggle("spin", this.state === "busy");      // 동기화 중: 새로 고침 아이콘이 돈다
    const t = this.last ? fmtClock(this.last) : "";
    if (!this.ready) { desc.textContent = "준비 중이에요. 구글 앱 키를 넣으면 쓸 수 있어요."; btn.hidden = true; acts.hidden = true; }
    else if (!this.on) { desc.textContent = "태블릿과 휴대폰의 기록을 구글 드라이브로 동기화해요."; btn.hidden = false; btn.textContent = "구글로 연결"; acts.hidden = true; }
    else {
      const who = prefs.get("sync.email", "");
      const st = this.state === "busy" ? "동기화 중..."
        : this.state === "err" ? "동기화하지 못했어요. 새로 고침을 눌러 주세요"
        : this.state === "offline" ? "신호가 돌아오면 동기화해요"
        : this.state === "need" || (!this.tokenOk() && this.state !== "ok") ? (t ? `${t}에 동기화됨 · 새로 고침을 눌러 다시 동기화` : "새로 고침을 눌러 동기화해요")
        : t ? `${t}에 동기화됨` : "연결됨";
      desc.textContent = `${who ? who + " · " : ""}${st}`;
      btn.hidden = true; acts.hidden = false;
    }
  },
};

/* 기록 ↔ 글자: 숫자 배열(Float32Array 등)은 base64로 담아 크기와 정밀도를 지킨다 */
function packRec(rec) {
  const o = {};
  for (const k of Object.keys(rec)) {
    const v = rec[k];
    if (ArrayBuffer.isView(v)) {
      const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); let s = "";
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      o[k] = { $t: v.constructor.name, b64: btoa(s) };
    } else o[k] = v;
  }
  return JSON.stringify(o);
}
function unpackRec(text) {
  const o = JSON.parse(text);
  const T = { Float32Array, Float64Array, Int16Array, Int32Array, Uint8Array, Uint16Array };
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === "object" && v.$t && typeof v.b64 === "string" && T[v.$t]) {
      const s = atob(v.b64), u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      o[k] = new T[v.$t](u.buffer);
    }
  }
  return o;
}
/** 가져온 파일의 지문: 이름 + 용량 (둘 다 같아야 같은 파일) */
async function fileKey(name, size) {
  const s = `${name}|${size}`;
  try {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
    return [...h.slice(0, 10)].map(x => x.toString(16).padStart(2, "0")).join("");
  } catch (e) { return encodeURIComponent(s).slice(0, 100); }
}
function fmtClock(t) {   // 오늘이면 "16:50", 아니면 "11/24 16:50"
  const d = new Date(t), n = new Date(), p = x => String(x).padStart(2, "0"), hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.toDateString() === n.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
