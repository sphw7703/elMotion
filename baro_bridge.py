#!/usr/bin/env python3
"""elMotion 기압 중계기 (안드로이드 Termux에서 실행하는 시험 도구)

웹 브라우저는 휴대폰 기압계를 읽을 수 없어서, Termux가 대신 읽어 브라우저에 넘겨 준다.
  1) 이 파일이 있는 elMotion 폴더를 http://localhost:8080 으로 열어 준다 (휴대폰 안에서만).
  2) termux-sensor 로 기압계를 읽어 /baro 주소로 실시간 전달한다 (Server-Sent Events).
elMotion은 localhost 로 열렸을 때만 /baro 에 연결하고, 설정의 '기압계 오차 보정'이 켜진다.

필요한 것: F-Droid의 Termux + Termux:API 앱, 그리고 Termux에서
    pkg install python termux-api
실행:
    python tools/baro_bridge.py            # 기압계를 자동으로 찾음
    python tools/baro_bridge.py "센서 이름"  # 자동으로 못 찾으면 termux-sensor -l 로 이름 확인 후 직접 지정
    python tools/baro_bridge.py --fake     # 기압계 없이 가짜 값으로 시험 (PC에서도 가능)
"""
import json
import math
import os
import random
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8080
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # tools/ 의 위 = elMotion 폴더
KEYS = ("pressure", "baro", "bmp", "lps", "press")

latest = {"p": None, "n": 0}
cond = threading.Condition()


def publish(p):
    with cond:
        latest["p"] = p
        latest["n"] += 1
        cond.notify_all()


def find_sensor():
    try:
        out = subprocess.run(["termux-sensor", "-l"], capture_output=True, text=True, timeout=30).stdout
    except FileNotFoundError:
        sys.exit("termux-sensor 가 없어요. Termux에서 'pkg install termux-api' 를 하고, Termux:API 앱도 설치해 주세요.")
    except subprocess.TimeoutExpired:
        sys.exit("termux-sensor 가 응답하지 않아요. Termux:API 앱이 설치되어 있는지 확인해 주세요.")
    try:
        names = json.loads(out).get("sensors", [])
    except ValueError:
        names = [line.strip() for line in out.splitlines() if line.strip()]
    for name in names:
        if any(k in name.lower() for k in KEYS):
            return name
    print("기압계를 찾지 못했어요. 이 휴대폰의 센서 목록:")
    for name in names:
        print("  -", name)
    sys.exit('기압 센서 이름을 직접 넣어 실행해 주세요: python tools/baro_bridge.py "센서 이름"')


def read_sensor(name):
    """termux-sensor 출력(여러 줄 JSON 덩어리)을 읽어 기압(hPa)만 꺼낸다."""
    while True:
        proc = subprocess.Popen(["termux-sensor", "-s", name, "-d", "100"],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        buf, depth = [], 0
        for line in proc.stdout:
            for ch in line:
                if ch == "{":
                    depth += 1
                if depth > 0:
                    buf.append(ch)
                if ch == "}":
                    depth -= 1
                    if depth == 0 and buf:
                        try:
                            obj = json.loads("".join(buf))
                            for v in obj.values():
                                vals = v.get("values") if isinstance(v, dict) else None
                                if vals:
                                    publish(float(vals[0]))
                                    break
                        except ValueError:
                            pass
                        buf = []
        proc.wait()
        print("센서 읽기가 끊겨 다시 시작해요…")
        time.sleep(1)


def fake_sensor():
    """기압계 없이 시험: 1013 hPa 근처에서 엘리베이터가 오르내리는 것처럼 (1 m ≈ 0.12 hPa)."""
    t0 = time.time()
    while True:
        t = time.time() - t0
        h = 30 * (1 - math.cos(2 * math.pi * t / 60)) / 2          # 60초 주기로 0~30 m
        publish(1013.25 - 0.12 * h + random.gauss(0, 0.01))
        time.sleep(0.1)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".webp": "image/webp"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        if self.path.split("?")[0].rstrip("/").endswith("/baro"):
            return self.stream()
        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        seen = -1
        try:
            while True:
                with cond:
                    cond.wait(timeout=2)
                    p, n = latest["p"], latest["n"]
                if p is not None and n != seen:
                    self.wfile.write(f"data: {p:.4f}\n\n".encode())
                    seen = n
                else:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def log_message(self, *a):
        pass


def main():
    args = sys.argv[1:]
    if "--fake" in args:
        threading.Thread(target=fake_sensor, daemon=True).start()
        src = "가짜 기압 (시험용)"
    else:
        name = args[0] if args else find_sensor()
        threading.Thread(target=read_sensor, args=(name,), daemon=True).start()
        src = name
    print(f"기압 센서: {src}")
    print(f"크롬에서 http://localhost:{PORT} 을 열어 주세요. (끝내려면 Ctrl+C)")

    def show():
        while True:
            time.sleep(5)
            if latest["p"] is not None:
                print(f"  지금 기압 {latest['p']:.2f} hPa")
            else:
                print("  아직 기압 값을 받지 못했어요…")
    threading.Thread(target=show, daemon=True).start()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print(f"\n{PORT}번 주소를 이미 다른 중계기가 쓰고 있어요. 앞서 켠 중계기가 아직 돌고 있는 거예요.")
        print("아래를 입력해 끈 뒤 다시 실행해 주세요:\n    pkill -f baro_bridge.py")
        if "--fake" not in args:
            subprocess.run(["termux-sensor", "-c"], capture_output=True)
        os._exit(1)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if "--fake" not in args:
            subprocess.run(["termux-sensor", "-c"], capture_output=True)


if __name__ == "__main__":
    main()
