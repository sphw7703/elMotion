#!/usr/bin/env python3
"""elMotion 기압 중계기 (안드로이드 Termux에서 실행하는 시험 도구)

웹 브라우저는 휴대폰 기압계를 읽을 수 없어서, Termux가 대신 읽어 브라우저에 넘겨 준다.
  1) 이 파일이 있는 elMotion 폴더를 http://localhost:8080 으로 열어 준다 (휴대폰 안에서만).
  2) termux-sensor 로 기압계를 읽어 /baro 주소로 실시간 전달한다 (Server-Sent Events).

배터리 절약 (자동 켜기·끄기):
  · 기압계는 elMotion이 열려 연결돼 있을 때만 읽는다. 연결이 끊기면 5초 뒤 기압계를 끈다.
  · elMotion이 2분 동안 연결되지 않으면 중계기도 스스로 끝난다. (--stay 를 붙이면 계속 켜 둠)
  · 홈 화면 버튼으로 켜기: tools/install_shortcut.sh 참고 (Termux:Widget)

필요한 것: F-Droid의 Termux + Termux:API 앱, 그리고 Termux에서
    pkg install python termux-api
실행:
    python elMotion/tools/baro_bridge.py              # 기압계를 자동으로 찾음
    python elMotion/tools/baro_bridge.py "센서 이름"    # 자동으로 못 찾으면 termux-sensor -l 로 이름 확인 후 직접 지정
    python elMotion/tools/baro_bridge.py --port 8090  # 8080번을 다른 앱이 쓰고 있을 때
    python elMotion/tools/baro_bridge.py --fake       # 기압계 없이 가짜 값으로 시험 (PC에서도 가능)
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
SENSOR_OFF_AFTER = float(os.environ.get("BRIDGE_SENSOR_OFF", 5))     # 연결이 끊긴 뒤 기압계를 끄기까지 (초)
EXIT_AFTER = float(os.environ.get("BRIDGE_EXIT", 120))               # 연결이 없을 때 중계기를 끝내기까지 (초)

latest = {"p": None, "n": 0}
cond = threading.Condition()
state = {"clients": 0, "last": time.time(), "proc": None, "seen": False}
lock = threading.Lock()


def log(msg):
    print(time.strftime("[%H:%M:%S] ") + msg, flush=True)


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
    sys.exit('기압 센서 이름을 직접 넣어 실행해 주세요: python elMotion/tools/baro_bridge.py "센서 이름"')


def pump(proc):
    """termux-sensor 출력(여러 줄 JSON 덩어리)을 읽어 기압(hPa)만 꺼낸다."""
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


def sensor_on(name):
    proc = subprocess.Popen(["termux-sensor", "-s", name, "-d", "100"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
    threading.Thread(target=pump, args=(proc,), daemon=True).start()
    return proc


def sensor_off(proc):
    try:
        proc.terminate()
        proc.wait(timeout=3)
    except Exception:
        pass
    subprocess.run(["termux-sensor", "-c"], capture_output=True)      # 센서 놓아주기


def manager(name, stay):
    """연결된 화면이 있을 때만 기압계를 켜고, 오래 연결이 없으면 중계기를 끝낸다."""
    while True:
        time.sleep(1)
        with lock:
            clients, idle = state["clients"], time.time() - state["last"]
            proc = state["proc"]
        want = clients > 0 or (state["seen"] and idle < SENSOR_OFF_AFTER)
        if name:
            if want and (proc is None or proc.poll() is not None):
                with lock:
                    state["proc"] = sensor_on(name)
                log("elMotion이 연결돼 기압계를 켰어요.")
            elif not want and proc is not None:
                sensor_off(proc)
                with lock:
                    state["proc"] = None
                log("elMotion 연결이 끊겨 기압계를 껐어요.")
        if not stay and clients == 0 and idle >= EXIT_AFTER:
            log(f"elMotion이 {int(EXIT_AFTER)}초 동안 열리지 않아 중계기를 끝낼게요.")
            if name and state["proc"] is not None:
                sensor_off(state["proc"])
            os._exit(0)


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
        with lock:
            state["clients"] += 1
            state["last"] = time.time()
            state["seen"] = True
        seen = latest["n"]
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
        finally:
            with lock:
                state["clients"] -= 1
                state["last"] = time.time()

    def log_message(self, *a):
        pass


def main():
    global PORT
    args = sys.argv[1:]
    if "--port" in args:
        k = args.index("--port")
        PORT = int(args[k + 1])
        del args[k:k + 2]
    stay = "--stay" in args
    fake = "--fake" in args
    args = [a for a in args if a not in ("--stay", "--fake")]

    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        # 이미 켜져 있는 게 우리 중계기인지 확인
        mine = False
        try:
            import urllib.request
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/baro", timeout=4) as r:
                mine = "event-stream" in r.headers.get("Content-Type", "")
        except Exception:
            pass
        if mine:
            print(f"중계기가 이미 켜져 있어요. 크롬에서 http://localhost:{PORT} 을 그대로 쓰면 돼요.")
            print("새로 켜고 싶으면:  pkill -f baro_bridge.py  를 입력한 뒤 다시 실행해 주세요.")
        else:
            print(f"{PORT}번 주소를 다른 앱이 쓰고 있어요. 다른 번호로 켜 주세요:")
            print("    python elMotion/tools/baro_bridge.py --port 8090")
            print("(주소가 바뀌면 크롬에서도 http://localhost:8090 으로 열어야 하고, 기록은 주소마다 따로 저장돼요)")
        os._exit(1)

    if fake:
        threading.Thread(target=fake_sensor, daemon=True).start()
        name = None
        log("기압 센서: 가짜 기압 (시험용)")
    else:
        name = args[0] if args else find_sensor()
        log(f"기압 센서: {name}")
    threading.Thread(target=manager, args=(name, stay), daemon=True).start()
    print(f"크롬에서 http://localhost:{PORT} 을 열어 주세요. (끝내려면 Ctrl+C)")
    if not stay:
        print(f"elMotion을 닫고 {int(EXIT_AFTER)}초가 지나면 중계기도 저절로 꺼져요.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        with lock:
            proc = state["proc"]
        if proc is not None:
            sensor_off(proc)


if __name__ == "__main__":
    main()
