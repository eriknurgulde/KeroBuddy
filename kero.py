#!/usr/bin/env python3
"""KeroBuddy: a little pixel frog in a small always-on-top window.

    python kero.py                    start server + window in the screen corner
    python kero.py --no-window        only the server (open http://127.0.0.1:8797)
    python kero.py --sensors          print what the PC sensors read, then exit
    python kero.py --install-startup  start automatically when you log in (Windows)
    python kero.py --uninstall-startup

The page draws the frog; this script serves it, reads a few PC signals
(idle time, CPU, RAM, battery, microphone in use) and keeps the window on top.
Nothing is recorded or sent anywhere: the page only asks this script on
127.0.0.1, and the weather comes straight from Open-Meteo.
Standard library only.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE / "web"
PORT = int(os.environ.get("KEROBUDDY_PORT", "8797"))
TITLE = "KeroBuddy"
APP_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "KeroBuddy"
STATIC = {"/": "index.html", "/index.html": "index.html", "/kero.js": "kero.js", "/font.js": "font.js"}
DEFAULT_CONFIG = {
    "latitude": 43.2295, "longitude": 76.8374,   # weather + air quality location
    "night_start": 23, "night_end": 7,
    "color": True,              # False = single color, like a real OLED
    "focus_minutes": 25, "break_minutes": 5,
    "break_every": 50,          # minutes of screen time before Kero asks you to stretch
    "away_minutes": 5,          # no mouse/keyboard this long = you're away, Kero naps
    "hour_chime": True,         # croak on the hour
    "scale": 3,                 # window size = 128x64 pixels * scale
    "corner": "bottom-right",   # bottom-right | bottom-left | top-right | top-left
    "margin": 12,
    "margin_top": None,
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    try:
        cfg.update(json.loads((HERE / "config.json").read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    return cfg


def log(*args):
    try:
        APP_DIR.mkdir(parents=True, exist_ok=True)
        with open(APP_DIR / "kero.log", "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(map(str, args)) + "\n")
    except OSError:
        pass


# ---------------------------------------------------------------- sensors
class WinSensors:
    def __init__(self):
        import ctypes
        from ctypes import wintypes
        self.ct, self.wt = ctypes, wintypes
        self.k32, self.u32 = ctypes.windll.kernel32, ctypes.windll.user32
        self.k32.GetTickCount.restype = wintypes.DWORD
        self._prev_cpu = None

    def idle_seconds(self):
        ct, wt = self.ct, self.wt

        class LASTINPUTINFO(ct.Structure):
            _fields_ = [("cbSize", wt.UINT), ("dwTime", wt.DWORD)]

        lii = LASTINPUTINFO(cbSize=ct.sizeof(LASTINPUTINFO))
        if not self.u32.GetLastInputInfo(ct.byref(lii)):
            return 0
        return ((self.k32.GetTickCount() - lii.dwTime) & 0xFFFFFFFF) / 1000

    def cpu_percent(self):
        ct, wt = self.ct, self.wt
        idle, kern, user = wt.FILETIME(), wt.FILETIME(), wt.FILETIME()
        if not self.k32.GetSystemTimes(ct.byref(idle), ct.byref(kern), ct.byref(user)):
            return -1
        v = lambda ft: (ft.dwHighDateTime << 32) | ft.dwLowDateTime
        cur = (v(idle), v(kern) + v(user))          # kernel time includes idle time
        prev, self._prev_cpu = self._prev_cpu, cur
        if not prev or cur[1] <= prev[1]:
            return -1
        busy = 1 - (cur[0] - prev[0]) / (cur[1] - prev[1])
        return round(max(0.0, min(1.0, busy)) * 100, 1)

    def mem_percent(self):
        ct, wt = self.ct, self.wt

        class MEMORYSTATUSEX(ct.Structure):
            _fields_ = [("dwLength", wt.DWORD), ("dwMemoryLoad", wt.DWORD)] + \
                       [(n, ct.c_ulonglong) for n in ("tp", "ap", "tpf", "apf", "tv", "av", "aev")]

        m = MEMORYSTATUSEX(dwLength=ct.sizeof(MEMORYSTATUSEX))
        return m.dwMemoryLoad if self.k32.GlobalMemoryStatusEx(ct.byref(m)) else -1

    def battery(self):
        ct, wt = self.ct, self.wt

        class SYSTEM_POWER_STATUS(ct.Structure):
            _fields_ = [("ac", ct.c_ubyte), ("flag", ct.c_ubyte), ("pct", ct.c_ubyte), ("saver", ct.c_ubyte),
                        ("life", wt.DWORD), ("full", wt.DWORD)]

        s = SYSTEM_POWER_STATUS()
        if not self.k32.GetSystemPowerStatus(ct.byref(s)) or s.flag & 128 or s.pct == 255:
            return None                               # desktop PC / unknown
        return {"pct": s.pct, "plugged": s.ac == 1}

    def mic_in_use(self):
        """Windows notes when each app starts/stops using the microphone.
        A 'stop' time of 0 means some app is using it right now (e.g. a call)."""
        import winreg
        base = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone"

        def scan(path):
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as k:
                    i = 0
                    while True:
                        try:
                            name = winreg.EnumKey(k, i)
                        except OSError:
                            return False
                        i += 1
                        sub = path + "\\" + name
                        if name == "NonPackaged":
                            if scan(sub):
                                return True
                            continue
                        try:
                            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, sub) as a:
                                stop = winreg.QueryValueEx(a, "LastUsedTimeStop")[0]
                                start = winreg.QueryValueEx(a, "LastUsedTimeStart")[0]
                                if stop == 0 and start > 0:
                                    return True
                        except OSError:
                            pass
            except OSError:
                return False

        return scan(base)


class MacSensors:
    def _run(self, *cmd):
        try:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=3).stdout
        except (OSError, subprocess.SubprocessError):
            return ""

    def idle_seconds(self):
        m = re.search(r'"HIDIdleTime" = (\d+)', self._run("ioreg", "-c", "IOHIDSystem"))
        return int(m.group(1)) / 1e9 if m else 0

    def cpu_percent(self):
        try:
            return round(min(100.0, os.getloadavg()[0] / (os.cpu_count() or 1) * 100), 1)
        except OSError:
            return -1

    def mem_percent(self):
        return -1

    def battery(self):
        out = self._run("pmset", "-g", "batt")
        m = re.search(r"(\d+)%;\s*([a-zA-Z ]+)", out)
        if not m:
            return None
        return {"pct": int(m.group(1)), "plugged": "discharging" not in m.group(2)}

    def mic_in_use(self):
        return False


class Sensors:
    """Reads the PC every 2 s in the background; the page asks for the latest values."""

    def __init__(self):
        self.impl = WinSensors() if os.name == "nt" else MacSensors() if sys.platform == "darwin" else None
        self.data = {"ok": False}
        self.lock = threading.Lock()

    def read_once(self):
        s = self.impl
        if not s:
            return {"ok": False}
        out = {"ok": True}
        for key, fn in (("idle", s.idle_seconds), ("cpu", s.cpu_percent), ("mem", s.mem_percent),
                        ("battery", s.battery), ("on_call", s.mic_in_use)):
            try:
                out[key] = fn()
            except Exception as e:            # one broken sensor must not stop the others
                log(f"sensor {key} failed: {e!r}")
                out[key] = None
        return out

    def loop(self):
        while True:
            d = self.read_once()
            with self.lock:
                self.data = d
            time.sleep(2)

    def start(self):
        threading.Thread(target=self.loop, daemon=True).start()

    def get(self):
        with self.lock:
            return dict(self.data)


SENSORS = Sensors()
VIEWPORT = {"event": threading.Event(), "data": None}


# ---------------------------------------------------------------- server
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in STATIC:
            name = STATIC[path]
            ctype = "text/html; charset=utf-8" if name.endswith(".html") else "text/javascript"
            self._send(200, (WEB / name).read_bytes(), ctype)
        elif path == "/config":
            self._send(200, json.dumps(load_config()))
        elif path == "/sys":
            self._send(200, json.dumps(SENSORS.get()))
        else:
            self._send(404, '{"error":"not found"}')

    def do_POST(self):
        if self.path.split("?")[0] != "/viewport":
            self._send(404, '{"error":"not found"}')
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(data, dict):
                raise ValueError
        except ValueError:
            self._send(400, '{"error":"bad json"}')
            return
        VIEWPORT["data"] = data
        VIEWPORT["event"].set()
        self._send(200, '{"ok":true}')


class Server(ThreadingHTTPServer):
    # On Windows SO_REUSEADDR lets a second copy bind the same port; claim it exclusively.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        import socket
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def start_server():
    srv = Server(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ---------------------------------------------------------------- window
def find_browser():
    candidates = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return shutil.which("msedge") or shutil.which("chrome") or shutil.which("google-chrome")


def reserve_autohide_taskbar(work):
    """Keep an auto-hiding taskbar's space free so it doesn't slide over the window."""
    import ctypes
    from ctypes import wintypes

    class APPBARDATA(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("hWnd", wintypes.HWND), ("uCallbackMessage", wintypes.UINT),
                    ("uEdge", wintypes.UINT), ("rc", wintypes.RECT), ("lParam", wintypes.LPARAM)]

    abd = APPBARDATA(cbSize=ctypes.sizeof(APPBARDATA))
    shell32 = ctypes.windll.shell32
    if not shell32.SHAppBarMessage(4, ctypes.byref(abd)) & 1:       # ABM_GETSTATE, ABS_AUTOHIDE
        return
    if not shell32.SHAppBarMessage(5, ctypes.byref(abd)):           # ABM_GETTASKBARPOS
        return
    r = abd.rc
    size_v, size_h = r.bottom - r.top, r.right - r.left
    edge = abd.uEdge
    if edge == 3: work.bottom -= size_v
    elif edge == 1: work.top += size_v
    elif edge == 0: work.left += size_h
    elif edge == 2: work.right -= size_h


def run_window_windows(cfg):
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (AttributeError, OSError):
        pass

    browser = find_browser()
    if not browser:
        import webbrowser
        log("no Edge/Chrome found, opening default browser")
        webbrowser.open(f"http://127.0.0.1:{PORT}/")
        while True:
            time.sleep(3600)

    EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def find_windows():
        found = []

        def cb(hwnd, _):
            if user32.IsWindowVisible(hwnd):
                buf = ctypes.create_unicode_buffer(256)
                user32.GetWindowTextW(hwnd, buf, 256)
                if buf.value == TITLE:
                    found.append(hwnd)
            return True

        user32.EnumWindows(EnumProc(cb), 0)
        return found

    existing = find_windows()
    for extra in existing[1:]:
        user32.PostMessageW(extra, 0x0010, 0, 0)          # WM_CLOSE
    if existing:
        hwnd = existing[0]
        log("adopted existing window")
    else:
        subprocess.Popen([browser, f"--app=http://127.0.0.1:{PORT}/", "--window-size=420,250"])
        hwnd = None
        for _ in range(150):
            found = find_windows()
            if found:
                hwnd = found[0]
                break
            time.sleep(0.1)
    if not hwnd:
        log("window never appeared")
        return

    HWND_TOPMOST = wintypes.HWND(-1)
    SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE, SWP_SHOWWINDOW = 0x1, 0x2, 0x10, 0x40
    work = wintypes.RECT()
    user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(work), 0)   # SPI_GETWORKAREA
    reserve_autohide_taskbar(work)

    def place():
        dpi = user32.GetDpiForWindow(hwnd) or 96
        want_w = round(128 * cfg["scale"] * dpi / 96)
        want_h = round(64 * cfg["scale"] * dpi / 96)
        wr = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(wr))
        cur_w, cur_h = wr.right - wr.left, wr.bottom - wr.top
        vp = VIEWPORT["data"]
        if vp:
            inner_w, inner_h = round(vp["w"] * vp["dpr"]), round(vp["h"] * vp["dpr"])
        else:
            cr = wintypes.RECT()
            user32.GetClientRect(hwnd, ctypes.byref(cr))
            inner_w, inner_h = cr.right - cr.left, cr.bottom - cr.top
        w = want_w + cur_w - inner_w
        h = want_h + cur_h - inner_h
        m = round(cfg["margin"] * dpi / 96)
        mt = m if cfg.get("margin_top") is None else round(cfg["margin_top"] * dpi / 96)
        corner = cfg["corner"]
        x = work.left + m if "left" in corner else work.right - w - m
        y = work.top + mt if "top" in corner else work.bottom - h - m
        user32.SetWindowPos(hwnd, HWND_TOPMOST, x, y, w, h, SWP_SHOWWINDOW | SWP_NOACTIVATE)
        log(f"window placed at {x},{y} size {w}x{h} (dpi {dpi}, page {inner_w}x{inner_h})")

    VIEWPORT["event"].wait(10)
    VIEWPORT["event"].clear()
    place()
    if VIEWPORT["event"].wait(3):
        VIEWPORT["event"].clear()
        place()

    # stay on top (some apps steal it); exit when the user closes the window
    while user32.IsWindow(hwnd):
        user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
        time.sleep(2)
    log("window closed, exiting")


def run_window_mac(cfg):
    """macOS: open a small Chrome/Edge app window. (Pinning it on top needs a
    native helper; for now use a window-pinning tool if you want that.)"""
    url = f"http://127.0.0.1:{PORT}/"
    size = f"--window-size={128 * cfg['scale']},{64 * cfg['scale'] + 28}"
    for app in ("Google Chrome", "Microsoft Edge"):
        if Path(f"/Applications/{app}.app").exists():
            subprocess.Popen(["open", "-na", app, "--args", f"--app={url}", size])
            break
    else:
        import webbrowser
        webbrowser.open(url)
    print(f"KeroBuddy running at {url}  (Ctrl+C to stop)")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


# ---------------------------------------------------------------- autostart (Windows)
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def startup(install):
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if install:
            pyw = Path(sys.executable).with_name("pythonw.exe")
            exe = pyw if pyw.exists() else Path(sys.executable)
            winreg.SetValueEx(k, TITLE, 0, winreg.REG_SZ, f'"{exe}" "{Path(__file__).resolve()}"')
            print("KeroBuddy will start when you log in.")
        else:
            try:
                winreg.DeleteValue(k, TITLE)
            except FileNotFoundError:
                pass
            print("KeroBuddy removed from startup.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-window", action="store_true")
    ap.add_argument("--sensors", action="store_true", help="print sensor readings and exit")
    ap.add_argument("--install-startup", action="store_true")
    ap.add_argument("--uninstall-startup", action="store_true")
    a = ap.parse_args()

    if a.install_startup or a.uninstall_startup:
        if os.name != "nt":
            sys.exit("Autostart is Windows-only for now.")
        startup(a.install_startup)
        return
    if a.sensors:
        SENSORS.read_once()           # first CPU reading only primes the counter
        time.sleep(1)
        print(json.dumps(SENSORS.read_once(), indent=2))
        return

    try:
        start_server()
    except OSError:
        log(f"port {PORT} busy - is KeroBuddy already running?")
        sys.exit(f"Port {PORT} is busy - KeroBuddy is probably already running.")
    SENSORS.start()
    log(f"server on http://127.0.0.1:{PORT}")

    cfg = load_config()
    if a.no_window:
        print(f"KeroBuddy running at http://127.0.0.1:{PORT}/  (Ctrl+C to stop)")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return
    elif os.name == "nt":
        run_window_windows(cfg)
    elif sys.platform == "darwin":
        run_window_mac(cfg)
    else:
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:{PORT}/")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
