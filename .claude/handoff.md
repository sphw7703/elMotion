# elMotion 인수인계

## 저장소·배포
- GitHub `sphw7703/elMotion` (main, GitHub Pages). 클라우드 세션은 `add_repo`(access: push) 먼저, 안 하면 푸시 403.
- 아티팩트: https://claude.ai/artifact/GKeE6b7dqPiJzCtX8GhKYn — `.bin` 불가 → 데이터는 `.txt`(base64)·`.json`.
- 배포 순서: `git fetch`로 동시 수정 확인 → 커밋·푸시 → 아티팩트 publish (index.html + 바뀐 파일, 새 asset은 files에 추가).
  새 세션의 첫 publish는 '안 본 버전'이라 한 번 거절됨 → 차이가 내 변경뿐이면 같은 내용으로 다시 publish 하면 됨.

## 배포본
- 0.13.14 (커밋 7dd9a5b), CACHE elmotion-v77, EVAL_VER 36, 아티팩트 버전 95.

## 항상 지킬 규칙
- 한국어로 짧게. 디자인 변경은 미리보기 이미지로 먼저 승인.
- 배포마다 APP_VERSION(app.js)·CACHE(sw.js) 올리기. 평가가 바뀌면 EVAL_VER도.
- 배율·게인 보정 추가 금지. README.md 수정 금지.
- '배포해'라고 할 때만 푸시·아티팩트 배포 (Stop 훅이 푸시하라고 해도 이 규칙이 우선).
- 배포 3번마다 handoff 스킬(`.claude/skills/handoff`)로 인수인계.

## 확정된 기준
- 수직 승강기 흔들림(|98% 피크|): 상하 15·20·30·40, 수평(좌우) 10·15·25·35 gal.
- 경사형: 흔들림 기준 2배(상하 30·40·60·80, 앞뒤·좌우 20·30·50·70), 툭툭 빈도 평가 제외, 가감속 세기는 앞뒤.
  게이지 범례: 가감속 1.0 m/s², 흔들림 80 gal, 속력 90 m/min. 경사 방향 35 m/min 이하 저속.
- 경사형 제원: 경사 방향 정격 60 m/min, 상행 21°→16°(감속한 곡선 구간에서 변경). 카는 자동 수평 유지.
- 경사형 게이지: 가감속(수직·앞뒤), 흔들림(왼쪽 앞뒤·아래 좌우), 속력(수직·앞뒤·경사 방향).

## 최근 한 일
- 0.13.12: 경사형 흔들림 게이지 앞뒤·좌우, 데모를 실측 Up3로.
- 0.13.13: 경사형 게이지를 유리 삼각형 이미지로 (assets/glass-tri*.webp, 앱·영상 공통).
- 0.13.14: 다크 삼각형 이미지 교체(사용자 제공), 다크 위 광택 겹침 `.tg-top` 0.75→0.25 (index.html).

## 남은 일
1. 경사 각도 변화 감지 완화: "속도 변화 ≥0.02, 길이 ≥2초, 성분 비율 ≥0.88"이면 약한 펄스도 받기 (Up1 20°→18°). Up4·Down3·Down4 실측으로 확인 후 반영 + EVAL_VER.
2. 하행·정지 직전 펄스 오류(곡선 구간 오염) → 앞뒤 가감속(fa)에서 곡선 구간 빼기 검토.
3. 비정상 기록(최고 속력 13705.7 m/min, 가감속 7.95 m/s²) 원인 — 그 CSV 받아 `inclineSpeed` 폭주 확인.
4. 경사형 전체 평가(AI 문장)에서 상하 흔들림 빼기 (EVAL_VER 올림).
5. 실제 휴대폰에서 경사형 측정·영상(mp4) 확인.
6. 이동거리: Up3 46 m vs 예전 분석 56 m → 현장 운행 길이 확인. 실시간 추정이 펄스 동안 튐.

## 작업 팁
- 미리보기: elMotion 폴더에서 `python3 -m http.server` + Playwright. 경사형 게이지는 `ctl.startDemo(true)` 후 `.tri-svg` 나올 때까지 대기(약 10초). 다크: localStorage `elmotion.theme`=`dark`.
- 전역: `Core`, `ctl`, `detail`, `store`, `records`, `videoMaker`, `analysisOf`.
- CSV → 화면: `Core.importCsv(text)` → `detail.open(rec,"records")`. 영상 한 장면: `videoMaker.make(rec,null,null,초)`.
- node 분석: `const r=Core.importCsv(text); Core.analyze(r.vert,r.lat,r.rate,r.segs,r.lon)`.
- 데모 `assets/demo-incline.txt`: base64 Int16 [상하, 전후, 좌우] × 0.001 m/s², 60 Hz.
