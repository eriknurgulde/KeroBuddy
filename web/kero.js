// KeroBuddy - a little pixel frog that lives on top of your screen.
// 128x64 1-bit frame buffer (same as an SSD1306 OLED), so it can run on an ESP32 later.
// Mouse: click = hop, double click = next card, hold = pet, right click = focus timer.
// The OLED/GFX renderer below is taken from ClawdBuddy (Adafruit GFX port).
"use strict";

const W = 128, H = 64, WHITE = 1, BLACK = 0;

// =====================================================================
//                     Adafruit GFX / SSD1306 port
// =====================================================================
class OLED {
  constructor() {
    this.buf = new Uint8Array(W * H);
    this.ink = new Uint8Array(W * H);         // color index per lit pixel (color mode)
    this.color_ = 0;                          // current ink
    this.cx = 0; this.cy = 0; this.size = 1; this.color = WHITE;
    this.inverted = false;
  }
  clear() { this.buf.fill(0); this.ink.fill(0); }
  px(x, y, c) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    this.buf[i] = c;
    if (c) this.ink[i] = this.color_;
  }
  hline(x, y, w, c) { for (let i = 0; i < w; i++) this.px(x + i, y, c); }
  vline(x, y, h, c) { for (let i = 0; i < h; i++) this.px(x, y + i, c); }
  fillRect(x, y, w, h, c) { for (let i = x; i < x + w; i++) this.vline(i, y, h, c); }
  drawRect(x, y, w, h, c) {
    this.hline(x, y, w, c); this.hline(x, y + h - 1, w, c);
    this.vline(x, y, h, c); this.vline(x + w - 1, y, h, c);
  }
  drawLine(x0, y0, x1, y1, c) {
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (steep) { [x0, y0] = [y0, x0]; [x1, y1] = [y1, x1]; }
    if (x0 > x1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
    const dx = x1 - x0, dy = Math.abs(y1 - y0);
    let err = Math.trunc(dx / 2);
    const ystep = y0 < y1 ? 1 : -1;
    for (; x0 <= x1; x0++) {
      if (steep) this.px(y0, x0, c); else this.px(x0, y0, c);
      err -= dy;
      if (err < 0) { y0 += ystep; err += dx; }
    }
  }
  drawCircle(x0, y0, r, c) {
    let f = 1 - r, ddx = 1, ddy = -2 * r, x = 0, y = r;
    this.px(x0, y0 + r, c); this.px(x0, y0 - r, c); this.px(x0 + r, y0, c); this.px(x0 - r, y0, c);
    while (x < y) {
      if (f >= 0) { y--; ddy += 2; f += ddy; }
      x++; ddx += 2; f += ddx;
      this.px(x0 + x, y0 + y, c); this.px(x0 - x, y0 + y, c);
      this.px(x0 + x, y0 - y, c); this.px(x0 - x, y0 - y, c);
      this.px(x0 + y, y0 + x, c); this.px(x0 - y, y0 + x, c);
      this.px(x0 + y, y0 - x, c); this.px(x0 - y, y0 - x, c);
    }
  }
  circleHelper(x0, y0, r, corner, c) {
    let f = 1 - r, ddx = 1, ddy = -2 * r, x = 0, y = r;
    while (x < y) {
      if (f >= 0) { y--; ddy += 2; f += ddy; }
      x++; ddx += 2; f += ddx;
      if (corner & 4) { this.px(x0 + x, y0 + y, c); this.px(x0 + y, y0 + x, c); }
      if (corner & 2) { this.px(x0 + x, y0 - y, c); this.px(x0 + y, y0 - x, c); }
      if (corner & 8) { this.px(x0 - y, y0 + x, c); this.px(x0 - x, y0 + y, c); }
      if (corner & 1) { this.px(x0 - y, y0 - x, c); this.px(x0 - x, y0 - y, c); }
    }
  }
  fillCircle(x0, y0, r, c) { this.vline(x0, y0 - r, 2 * r + 1, c); this.fillCircleHelper(x0, y0, r, 3, 0, c); }
  fillCircleHelper(x0, y0, r, corners, delta, c) {
    let f = 1 - r, ddx = 1, ddy = -2 * r, x = 0, y = r, px = x, py = y;
    delta++;
    while (x < y) {
      if (f >= 0) { y--; ddy += 2; f += ddy; }
      x++; ddx += 2; f += ddx;
      if (x < y + 1) {
        if (corners & 1) this.vline(x0 + x, y0 - y, 2 * y + delta, c);
        if (corners & 2) this.vline(x0 - x, y0 - y, 2 * y + delta, c);
      }
      if (y !== py) {
        if (corners & 1) this.vline(x0 + py, y0 - px, 2 * px + delta, c);
        if (corners & 2) this.vline(x0 - py, y0 - px, 2 * px + delta, c);
        py = y;
      }
      px = x;
    }
  }
  drawRoundRect(x, y, w, h, r, c) {
    const m = Math.trunc(Math.min(w, h) / 2); if (r > m) r = m;
    this.hline(x + r, y, w - 2 * r, c); this.hline(x + r, y + h - 1, w - 2 * r, c);
    this.vline(x, y + r, h - 2 * r, c); this.vline(x + w - 1, y + r, h - 2 * r, c);
    this.circleHelper(x + r, y + r, r, 1, c);
    this.circleHelper(x + w - r - 1, y + r, r, 2, c);
    this.circleHelper(x + w - r - 1, y + h - r - 1, r, 4, c);
    this.circleHelper(x + r, y + h - r - 1, r, 8, c);
  }
  fillRoundRect(x, y, w, h, r, c) {
    const m = Math.trunc(Math.min(w, h) / 2); if (r > m) r = m;
    this.fillRect(x + r, y, w - 2 * r, h, c);
    this.fillCircleHelper(x + w - r - 1, y + r, r, 1, h - 2 * r - 1, c);
    this.fillCircleHelper(x + r, y + r, r, 2, h - 2 * r - 1, c);
  }
  fillTriangle(x0, y0, x1, y1, x2, y2, c) {
    if (y0 > y1) { [y0, y1] = [y1, y0]; [x0, x1] = [x1, x0]; }
    if (y1 > y2) { [y2, y1] = [y1, y2]; [x2, x1] = [x1, x2]; }
    if (y0 > y1) { [y0, y1] = [y1, y0]; [x0, x1] = [x1, x0]; }
    let a, b, y, last;
    if (y0 === y2) {
      a = b = x0;
      if (x1 < a) a = x1; else if (x1 > b) b = x1;
      if (x2 < a) a = x2; else if (x2 > b) b = x2;
      this.hline(a, y0, b - a + 1, c); return;
    }
    const dx01 = x1 - x0, dy01 = y1 - y0, dx02 = x2 - x0, dy02 = y2 - y0, dx12 = x2 - x1, dy12 = y2 - y1;
    let sa = 0, sb = 0;
    last = y1 === y2 ? y1 : y1 - 1;
    for (y = y0; y <= last; y++) {
      a = x0 + Math.trunc(sa / dy01); b = x0 + Math.trunc(sb / dy02);
      sa += dx01; sb += dx02;
      if (a > b) [a, b] = [b, a];
      this.hline(a, y, b - a + 1, c);
    }
    sa = dx12 * (y - y1); sb = dx02 * (y - y0);
    for (; y <= y2; y++) {
      a = x1 + Math.trunc(sa / dy12); b = x0 + Math.trunc(sb / dy02);
      sa += dx12; sb += dx02;
      if (a > b) [a, b] = [b, a];
      this.hline(a, y, b - a + 1, c);
    }
  }
  drawChar(x, y, ch, c, s) {
    if (x >= W || y >= H || x + 6 * s - 1 < 0 || y + 8 * s - 1 < 0) return;
    if (ch >= 176) ch++;                       // classic (non-cp437) charset
    for (let i = 0; i < 5; i++) {
      let line = FONT[ch * 5 + i];
      for (let j = 0; j < 8; j++, line >>= 1) {
        if (line & 1) {
          if (s === 1) this.px(x + i, y + j, c);
          else this.fillRect(x + i * s, y + j * s, s, s, c);
        }
      }
    }
  }
  setTextSize(s) { this.size = s; }
  setCursor(x, y) { this.cx = x; this.cy = y; }
  print(str) {
    str = String(str);
    for (let k = 0; k < str.length; k++) {
      let code = str.charCodeAt(k);
      if (code > 255) code = 63;               // '?'
      this.drawChar(this.cx, this.cy, code, this.color, this.size);
      this.cx += 6 * this.size;
    }
  }
}

const display = new OLED();

// Color mode (screen only). Kero himself is always one flat green.
const INK_WHITE = 0, INK_GREEN = 1, INK_GRAY = 2, INK_YELLOW = 3, INK_RED = 4,
      INK_BLUE = 5, INK_PINK = 6, INK_CYAN = 7, INK_AMBER = 8;
const PALETTE = [
  [228, 240, 255], [120, 215, 110], [125, 135, 148], [240, 205, 80], [240, 90, 80],
  [120, 180, 255], [255, 120, 175], [110, 220, 230], [245, 165, 60],
];
const ink = c => { display.color_ = c; };
const AIR_INK = [INK_GREEN, INK_GREEN, INK_YELLOW, INK_AMBER, INK_RED, INK_RED];
const tempInk = t => (t < 5 ? INK_BLUE : t < 25 ? INK_WHITE : t < 32 ? INK_YELLOW : INK_RED);
const cpuInk = c => (c < 40 ? INK_GREEN : c < 80 ? INK_YELLOW : INK_RED);

// =====================================================================
//                               CONFIG / STATE
// =====================================================================
let CFG = {
  latitude: 43.2295, longitude: 76.8374, night_start: 23, night_end: 7, color: true,
  focus_minutes: 25, break_minutes: 5, break_every: 50, away_minutes: 5, hour_chime: true,
};

let nowTm = new Date();
let outdoorTemp = NaN, weatherCode = -1, usAqi = -1;
let sys = { ok: false, idle: 0, cpu: -1, mem: -1, battery: null, on_call: false };
let cpuSmooth = -1;

const BAND_H = 30, SLIDE_MS = 260, GROUND_Y = 61;
const KW = 30, KH = 21, X_MIN = 3, X_MAX = W - KW - 3;

const C_TIME = 0, C_AIR = 1, C_PC = 2, C_SCREEN = 3, C_FOCUS = 4;
const IDLE_ROT = [[C_TIME, 8000], [C_AIR, 5000], [C_PC, 5000], [C_SCREEN, 5000], [C_FOCUS, 4000]];
const FOCUS_ROT = [[C_FOCUS, 9000], [C_TIME, 4000]];
let rotIdx = 0, curCard = C_TIME, prevCard = C_TIME, cardSince = 0, holdUntil = 0;
let flashUntil = 0;

const DOUBLE_TAP_MS = 350, LONG_PRESS_MS = 600;
let buttonDown = false, isTouching = false, isLongPressing = false;
let touchStart = 0, lastTapTime = 0, lastInteraction = 0, tapCount = 0;

// Kero
let kx = Math.round((X_MIN + X_MAX) / 2), jumpY = 0;
let hopS = { phase: "none", t0: 0, x0: 0, x1: 0, h: 0 };
let lookX = 0, lookUntil = 0, nextAction = 0, nextBlink = 0, blinkUntil = 0;
let happyUntil = 0, croakAt = -1e9, gulpUntil = 0, petting = false, sleeping = false;
let fly = { on: false, t0: 0, catchAt: 0, cx: 0, cy: 0 }, nextFlyAt = 0;
let bubble = { text: "", until: 0 };
let alert = null;                       // { kind: "break" | "focus", text, since }
let focus = { mode: "off", endsAt: 0, total: 0 };
let activeSince = Date.now(), snoozeUntil = 0, lastHourChimed = -1;

// =====================================================================
//                               HELPERS
// =====================================================================
const millis = () => Math.floor(performance.now());
const random = (a, b) => (b === undefined ? Math.floor(Math.random() * a) : a + Math.floor(Math.random() * (b - a)));
const constrain = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const lround = v => Math.sign(v) * Math.round(Math.abs(v));
const pad2 = n => String(n).padStart(2, "0");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isNight = () => nowTm.getHours() >= CFG.night_start || nowTm.getHours() < CFG.night_end;
const quiet = () => sys.on_call;

function airLevel(aqi) {
  if (aqi < 0) return -1;
  if (aqi <= 50) return 0; if (aqi <= 100) return 1; if (aqi <= 150) return 2;
  if (aqi <= 200) return 3; if (aqi <= 300) return 4; return 5;
}
const AIR_WORD = ["Clean", "Fine", "Hazy", "Smog", "Bad!", "Toxic"];
const AIR_ADVICE = ["Open the windows", "OK to air out", "Air out briefly", "Windows shut!", "Mask up outside", "Stay indoors!"];

function weatherWord(c) {
  if (c < 0) return "";
  if (c === 0) return "Clear";
  if (c <= 2) return "Cloudy";
  if (c === 3) return "Overcast";
  if (c === 45 || c === 48) return "Fog";
  if (c >= 51 && c <= 57) return "Drizzle";
  if (c >= 61 && c <= 67) return "Rain";
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "Snow";
  if (c >= 80 && c <= 82) return "Showers";
  if (c >= 95) return "Storm";
  return "";
}
const isRaining = () => ["Drizzle", "Rain", "Showers", "Storm"].includes(weatherWord(weatherCode));
const isSnowing = () => weatherWord(weatherCode) === "Snow";

function textAt(x, y, size, s) { display.setTextSize(size); display.setCursor(x, y); display.print(s); }
function textRight(rx, y, size, s) { textAt(rx - s.length * 6 * size, y, size, s); }
function fmtMins(m) { return m < 60 ? m + "m" : Math.floor(m / 60) + "h" + pad2(m % 60); }

function say(text, ms) { bubble = { text, until: millis() + ms }; }

// =====================================================================
//                           KERO ACTIONS
// =====================================================================
function startHop(dx, h) {
  if (hopS.phase !== "none") return;
  hopS = { phase: "crouch", t0: millis(), x0: kx, x1: constrain(kx + dx, X_MIN, X_MAX), h };
}
function croak() { croakAt = millis(); }
function startFly(catchDelay) {
  const now = millis();
  fly = { on: true, t0: now, catchAt: now + catchDelay, cx: 0, cy: 0, caught: false };
}
function flyPos(t) {
  return [constrain(kx + 15 + Math.round(24 * Math.cos(t / 500)), 1, W - 2),
          BAND_H + 4 + Math.round(2 * Math.sin(t / 230))];
}

function startFocus() {
  focus = { mode: "focus", total: CFG.focus_minutes * 60000, endsAt: Date.now() + CFG.focus_minutes * 60000 };
  if (alert && alert.kind === "break") alert = null;
  rotIdx = 0; switchCard(C_FOCUS, millis());
  say("Focus!", 1500); startHop(0, 6);
}
function stopFocus() { focus = { mode: "off", endsAt: 0, total: 0 }; say("Stopped", 1500); }
function toggleFocus() { if (focus.mode === "off") startFocus(); else stopFocus(); }

function dismissAlert(now) {
  if (!alert) return false;
  if (alert.kind === "break") snoozeUntil = Date.now() + 10 * 60000;
  alert = null; happyUntil = now + 1000;
  return true;
}

// =====================================================================
//                                INPUT
// =====================================================================
function onSingleTap(now) {
  if (dismissAlert(now)) return;
  if (sleeping) { sleeping = false; }
  happyUntil = now + 1500; startHop(0, 7);
}
function onDoubleTap(now) {
  dismissAlert(now);
  const rot = focus.mode === "off" ? IDLE_ROT : FOCUS_ROT;
  rotIdx = (rotIdx + 1) % rot.length;
  if (rot[rotIdx][0] === curCard) rotIdx = (rotIdx + 1) % rot.length;
  switchCard(rot[rotIdx][0], now);
  holdUntil = now + 12000;
}
function onLongPress(now) { dismissAlert(now); petting = true; sleeping = false; }
function onLongRelease(now) { petting = false; happyUntil = now + 800; }

function handleInput(now) {
  const touch = buttonDown;
  if (touch && !isTouching) { isTouching = true; touchStart = now; lastInteraction = now; }
  if (touch && isTouching && !isLongPressing && now - touchStart > LONG_PRESS_MS) {
    isLongPressing = true; tapCount = 0; onLongPress(now);
  }
  if (!touch && isTouching) {
    isTouching = false;
    if (isLongPressing) { isLongPressing = false; onLongRelease(now); }
    else { tapCount++; lastTapTime = now; }
  }
  if (!touch && tapCount > 0 && now - lastTapTime > DOUBLE_TAP_MS) {
    if (tapCount === 1) onSingleTap(now); else onDoubleTap(now);
    tapCount = 0;
  }
}

// =====================================================================
//                     TIMERS: focus, breaks, hour chime
// =====================================================================
function updateTimers(now) {
  const t = Date.now();
  if (focus.mode === "focus" && t >= focus.endsAt) {
    focus = { mode: "break", total: CFG.break_minutes * 60000, endsAt: t + CFG.break_minutes * 60000 };
    alert = { kind: "focus", text: "Done!", since: now };
    flashUntil = now + 1200;
    startFly(1800);
  } else if (focus.mode === "break" && t >= focus.endsAt) {
    focus = { mode: "off", endsAt: 0, total: 0 };
    croak(); say("Back to it?", 5000);
  }
  if (alert && alert.kind === "focus" && now - alert.since > 8000) alert = null;

  // screen time: a pause of break_minutes counts as a break
  if (sys.ok && sys.idle >= CFG.break_minutes * 60) {
    activeSince = t;
    if (alert && alert.kind === "break") alert = null;
  }
  if (sys.ok && !alert && focus.mode === "off" && !quiet() && t > snoozeUntil &&
      t - activeSince >= CFG.break_every * 60000) {
    alert = { kind: "break", text: "Stretch!", since: now };
    flashUntil = now + 1200;
    switchCard(C_SCREEN, now); holdUntil = now + 20000;
  }

  const h = nowTm.getHours();
  if (CFG.hour_chime && nowTm.getMinutes() === 0 && lastHourChimed !== h && !isNight() && !quiet() && !sleeping) {
    croak(); setTimeout(croak, 1100);
    lastHourChimed = h;
  }
}

// =====================================================================
//                              INFO CARDS
// =====================================================================
function switchCard(c, now) { if (c === curCard) return; prevCard = curCard; curCard = c; cardSince = now; }

function updateCards(now) {
  if (alert) { switchCard(alert.kind === "break" ? C_SCREEN : C_FOCUS, now); return; }
  const rot = focus.mode === "off" ? IDLE_ROT : FOCUS_ROT;
  rotIdx %= rot.length;
  if (curCard !== rot[rotIdx][0] && now > holdUntil) { switchCard(rot[rotIdx][0], now); return; }
  if (now > holdUntil && now - cardSince > rot[rotIdx][1]) {
    rotIdx = (rotIdx + 1) % rot.length;
    switchCard(rot[rotIdx][0], now);
  }
}

const drawDegree = (x, y, r) => display.drawCircle(x + r, y + r, r, WHITE);

function drawTimeCard(yo) {
  textAt(0, 1 + yo, 2, pad2(nowTm.getHours()) + ":" + pad2(nowTm.getMinutes()));
  if (!isNaN(outdoorTemp)) {
    ink(tempInk(outdoorTemp));
    const t = String(lround(outdoorTemp));
    const w = t.length * 12 + 7 + 12, x = W - w;
    textAt(x, 1 + yo, 2, t);
    drawDegree(x + t.length * 12 + 1, 1 + yo, 2);
    textAt(x + t.length * 12 + 7, 1 + yo, 2, "C");
  }
  ink(INK_GRAY);
  textAt(0, 21 + yo, 1, `${DAYS[nowTm.getDay()].slice(0, 3)}, ${pad2(nowTm.getDate())} ${MONTHS[nowTm.getMonth()]}`);
  const ww = weatherWord(weatherCode);
  if (ww) { ink(isRaining() ? INK_BLUE : INK_WHITE); textRight(W, 21 + yo, 1, ww); }
}

function drawAirCard(yo) {
  const lvl = airLevel(usAqi);
  textAt(0, 1 + yo, 2, "Air: ");
  if (lvl >= 0) ink(AIR_INK[lvl]);
  textAt(60, 1 + yo, 2, lvl < 0 ? "..." : AIR_WORD[lvl]);
  ink(INK_WHITE);
  textAt(0, 21 + yo, 1, lvl < 0 ? "checking the sky" : AIR_ADVICE[lvl]);
  for (let i = 0; i < 6; i++) {
    const h = 2 + i, x = 105 + i * 4, y = 28 + yo - h;
    ink(lvl >= 0 && i <= lvl ? AIR_INK[i] : INK_GRAY);
    if (lvl >= 0 && i <= lvl) display.fillRect(x, y, 3, h, WHITE);
    else display.hline(x, 28 + yo, 3, WHITE);
  }
}

function drawBar(y, frac, inkFill) {
  const bw = 66, bh = 7;
  ink(INK_GRAY);
  display.drawRect(0, y, bw, bh, WHITE);
  const fill = Math.trunc((bw - 4) * constrain(frac, 0, 1) + 0.5);
  ink(inkFill);
  if (fill > 0) display.fillRect(2, y + 2, fill, bh - 4, WHITE);
}

function drawPcCard(yo) {
  const c = cpuSmooth;
  textAt(0, 1 + yo, 2, "PC: ");
  if (c >= 0) ink(cpuInk(c));
  textAt(48, 1 + yo, 2, c < 0 ? "..." : c < 40 ? "Chill" : c < 80 ? "Busy" : "Hot!");
  ink(INK_GRAY);
  if (c < 0) { textAt(0, 21 + yo, 1, "reading sensors"); return; }
  let s = `CPU ${Math.round(c)}%`;
  if (sys.mem >= 0) s += ` RAM ${Math.round(sys.mem)}%`;
  textAt(0, 21 + yo, 1, s);
  const b = sys.battery;
  if (b && b.pct >= 0) {
    ink(b.plugged ? INK_GREEN : b.pct < 20 ? INK_RED : INK_GRAY);
    textRight(W, 21 + yo, 1, Math.round(b.pct) + "%" + (b.plugged ? "+" : ""));
  }
}

function drawScreenCard(yo) {
  const mins = Math.floor((Date.now() - activeSince) / 60000);
  if (alert && alert.kind === "break") ink(INK_YELLOW);
  textAt(0, 1 + yo, 2, sys.ok ? fmtMins(mins) : "--");
  ink(INK_GRAY);
  textRight(W, 1 + yo, 1, "screen");
  textRight(W, 10 + yo, 1, "time");
  let line;
  if (!sys.ok) line = "no sensor data";
  else if (alert && alert.kind === "break") { ink(INK_YELLOW); line = "Time to stretch!"; }
  else if (quiet()) line = "on a call - shh";
  else line = `break in ${Math.max(0, CFG.break_every - mins)}m`;
  textAt(0, 21 + yo, 1, line);
}

function drawFocusCard(yo) {
  if (focus.mode === "off") {
    textAt(0, 1 + yo, 2, "Focus");
    ink(INK_GRAY);
    textRight(W, 1 + yo, 1, CFG.focus_minutes + " min");
    textAt(0, 21 + yo, 1, "right-click: start");
    return;
  }
  const rem = Math.max(0, focus.endsAt - Date.now()), s = Math.ceil(rem / 1000);
  const isFocus = focus.mode === "focus";
  ink(alert && alert.kind === "focus" ? INK_GREEN : INK_WHITE);
  textAt(0, 1 + yo, 2, alert && alert.kind === "focus" ? "Done!" : pad2(Math.floor(s / 60)) + ":" + pad2(s % 60));
  ink(isFocus ? INK_GREEN : INK_CYAN);
  textRight(W, 1 + yo, 1, isFocus ? "focus" : "break");
  drawBar(21 + yo, 1 - rem / focus.total, isFocus ? INK_GREEN : INK_CYAN);
  ink(INK_GRAY);
  textRight(W, 21 + yo, 1, "of " + Math.round(focus.total / 60000) + "m");
}

function drawCard(c, yo) {
  ink(INK_WHITE);
  if (c === C_TIME) drawTimeCard(yo);
  else if (c === C_AIR) drawAirCard(yo);
  else if (c === C_PC) drawPcCard(yo);
  else if (c === C_SCREEN) drawScreenCard(yo);
  else drawFocusCard(yo);
}

function drawInfoBand(now) {
  const t = now - cardSince;
  if (t < SLIDE_MS) {
    let p = t / SLIDE_MS;
    p = 1 - (1 - p) * (1 - p);
    const off = Math.trunc(p * (BAND_H + 2));
    drawCard(prevCard, -off);
    drawCard(curCard, BAND_H + 2 - off);
  } else drawCard(curCard, 0);
  display.fillRect(0, BAND_H, W, H - BAND_H, BLACK);
}

// =====================================================================
//                            KERO DRAWING
// =====================================================================
// Rectangles only, one color. 30x21 px standing: two eye bumps, body, two legs.
function drawKero(ox, oy, s) {
  const f = (x, y, w, h) => display.fillRect(ox + x, oy + y, w, h, WHITE);
  const k = (x, y, w, h) => display.fillRect(ox + x, oy + y, w, h, BLACK);
  const b = s.b + s.crouch, w = s.swell;
  ink(INK_GREEN);
  f(-w, b, 9, 6); f(21 + w, b, 9, 6); f(-w, 6 + b, 30 + 2 * w, 12);
  if (s.air) { f(2, 18 + b, 3, 4); f(0, 22 + b, 3, 3); f(25, 18 + b, 3, 4); f(27, 22 + b, 3, 3); }
  else if (s.crouch > 1) { f(3, 18 + b, 3, 3 - b); f(24, 18 + b, 3, 3 - b); f(-3, 20, 6, 1); f(27, 20, 6, 1); }
  else if (3 - b > 0) { f(3, 18 + b, 3, 3 - b); f(24, 18 + b, 3, 3 - b); }
  for (const ex of [3 - w + s.lx, 24 + w + s.lx]) {
    const ey = 1 + b;
    switch (s.eyes) {
      case "open": k(ex, ey, 3, 6); break;
      case "blink": k(ex, ey + 4, 3, 1); break;
      case "closed": k(ex - 1, ey + 4, 5, 1); break;
      case "tired": k(ex, ey + 3, 3, 3); break;
      case "happy":
        for (let t = 0; t < 2; t++) [[-1, 4], [0, 3], [1, 2], [2, 3], [3, 4]].forEach(([dx, dy]) => k(ex + dx, ey + dy + t, 1, 1));
        break;
    }
  }
  if (s.tongue) {
    const mx = ox + 15, my = oy + 11 + b, [tx, ty] = s.tongue;
    k(13, 10 + b, 4, 3);
    ink(INK_GREEN);
    display.drawLine(mx, my, tx, ty, WHITE);
    display.fillRect(tx - 1, ty - 1, 2, 2, WHITE);
  }
}

function drawSideBubble(ox, oy, txt) {
  ink(INK_WHITE);
  const w = txt.length * 6 + 7, h = 11;
  const y = Math.max(BAND_H + 2, oy - 4);
  let x = ox + KW + 4;
  if (x + w > W) x = ox - w - 4;
  x = Math.max(0, x);
  display.fillRoundRect(x, y, w, h, 3, BLACK);
  display.drawRoundRect(x, y, w, h, 3, WHITE);
  textAt(x + 4, y + 2, 1, txt);
}
function drawHeart(x, y) {
  ink(INK_PINK);
  display.fillCircle(x - 2, y, 2, WHITE);
  display.fillCircle(x + 2, y, 2, WHITE);
  display.fillTriangle(x - 4, y + 1, x + 4, y + 1, x, y + 5, WHITE);
}
function drawZz(ox, oy, now) {
  ink(INK_CYAN);
  const p = Math.trunc(now / 140) % 16;
  textAt(Math.min(ox + KW + 2 + Math.trunc(p / 4), W - 6), oy + 4 - Math.trunc(p / 3), 1, "z");
  const q = (p + 8) % 16;
  textAt(Math.min(ox + KW + 6 + Math.trunc(q / 4), W - 6), oy + 1 - Math.trunc(q / 3), 1, "Z");
}
function drawNote(x, y) {
  ink(INK_CYAN);
  display.fillRect(x + 2, y, 1, 5, WHITE); display.fillRect(x, y + 4, 3, 2, WHITE);
  display.fillRect(x + 3, y, 2, 1, WHITE); display.px(x + 4, y + 1, WHITE);
}
function drawSweat(ox, oy, now) {
  ink(INK_BLUE);
  const x = ox + KW + 2, y = oy + 1 + Math.trunc(now / 90) % 8;
  display.fillCircle(x, y, 1, WHITE);
  display.px(x, y - 2, WHITE);
}
function drawFly(x, y, now) {
  ink(INK_GRAY);
  display.px(x, y, WHITE);
  if (Math.trunc(now / 60) % 2) { display.px(x - 1, y - 1, WHITE); display.px(x + 1, y - 1, WHITE); }
}
function drawWeather(now) {
  const span = GROUND_Y - BAND_H;
  if (isRaining()) {
    ink(INK_BLUE);
    for (let i = 0; i < 14; i++) {
      const x = (i * 37 + 11) % W;
      const y = BAND_H + 1 + Math.trunc(now / 14 * (1 + (i % 3) * 0.35) + i * 29) % span;
      display.vline(x, y, 2, WHITE);
    }
  } else if (isSnowing()) {
    ink(INK_WHITE);
    for (let i = 0; i < 12; i++) {
      const v = 6 + (i * 7) % 9;
      const y = BAND_H + 1 + (Math.trunc(Math.trunc(now / 50) * v / 20) + i * 17) % span;
      const x = (i * 37 + 11 + Math.trunc(2 * Math.sin(now / 900 + i))) % W;
      display.px(x, y, WHITE);
    }
  }
}

// =====================================================================
//                         KERO BEHAVIOR (per frame)
// =====================================================================
function updateAndDrawMascot(now) {
  // --- sleep / wake
  const away = sys.ok && sys.idle >= CFG.away_minutes * 60;
  const nightIdle = isNight() && (sys.ok ? sys.idle >= 120 : now - lastInteraction > 5 * 60000);
  const shouldSleep = (away || nightIdle) && !alert && !petting;
  if (sleeping && !shouldSleep) {
    sleeping = false; happyUntil = now + 1500; startHop(0, 6);
    if (!isNight()) say("Hi again!", 2000);
  }
  if (!sleeping && shouldSleep && hopS.phase === "none" && !fly.on) sleeping = true;

  const sweaty = cpuSmooth >= 85;
  const tired = sys.battery && !sys.battery.plugged && sys.battery.pct >= 0 && sys.battery.pct < 20;

  // --- idle choices
  if (!sleeping && !alert && !petting && !fly.on && hopS.phase === "none" && now > nextAction) {
    const r = random(100);
    if (focus.mode === "focus") {                       // calm while you focus
      if (r < 30) { lookX = random(2) ? -2 : 2; lookUntil = now + 900; }
    } else if (r < 33 && !tired) startHop((random(2) ? 1 : -1) * random(10, 28), random(5, 9));
    else if (r < 50) { lookX = random(2) ? -2 : 2; lookUntil = now + 900; }
    else if (r < 58 && !quiet()) croak();
    else if (r < 65 && !tired && isRaining()) startHop(0, 5);   // rain dance
    nextAction = now + (tired ? random(5000, 9000) : random(2500, 6000));
  }
  if (isRaining() && !sleeping && !alert && hopS.phase === "none" && random(400) === 0) { happyUntil = now + 900; startHop(0, 5); }

  // --- ambient fly, every few minutes
  if (!fly.on && !sleeping && !alert && !quiet() && focus.mode !== "focus" && now > nextFlyAt) {
    startFly(random(4000, 8000)); nextFlyAt = now + random(180000, 420000);
  }

  // --- alert: jump with "!"
  if (alert) {
    const t = now - alert.since;
    if (alert.kind === "break" && (t < 15000 || Math.trunc(now / 4000) % 4 === 0) && hopS.phase === "none") startHop(0, 6);
  }

  // --- hop physics
  let air = false, crouch = 0;
  jumpY = 0;
  if (hopS.phase === "crouch") { crouch = 2; if (now - hopS.t0 >= 150) hopS = { ...hopS, phase: "air", t0: now }; }
  if (hopS.phase === "air") {
    const q = (now - hopS.t0) / 450;
    if (q >= 1) { kx = hopS.x1; hopS = { ...hopS, phase: "land", t0: now }; }
    else { air = true; kx = hopS.x0 + (hopS.x1 - hopS.x0) * q; jumpY = hopS.h * Math.sin(Math.PI * q); }
  }
  if (hopS.phase === "land") { crouch = 2; if (now - hopS.t0 >= 120) hopS = { ...hopS, phase: "none" }; }
  if (hopS.phase !== "none" && hopS.x1 !== hopS.x0) lookX = Math.sign(hopS.x1 - hopS.x0) * 2;
  else if (now > lookUntil && !fly.on) lookX = 0;

  // --- fly + tongue
  let tongue = null;
  if (fly.on) {
    const [fx, fy] = flyPos(now - fly.t0);
    if (now < fly.catchAt || hopS.phase !== "none") {
      if (now >= fly.catchAt) fly.catchAt = now + 200;        // wait until landed
      lookX = constrain(Math.round((fx - (kx + 15)) / 8), -2, 2);
      drawFly(fx, fy, now);
      [fly.cx, fly.cy] = [fx, fy];
    } else {
      const p = now - fly.catchAt;
      const ox = Math.round(kx), oy = GROUND_Y - KH;
      if (p < 300) {
        const r = p < 150 ? p / 150 : 1 - (p - 150) / 150;
        const mx = ox + 15, my = oy + 11;
        const tx = Math.round(mx + (fly.cx - mx) * r), ty = Math.round(my + (fly.cy - my) * r);
        tongue = [tx, ty];
        if (p >= 150) drawFly(tx, ty, now);
      } else { fly.on = false; gulpUntil = now + 300; happyUntil = now + 1000; }
    }
  }

  // --- face
  let eyes = "open", swell = 0;
  if (tired) eyes = "tired";
  const croakP = (now - croakAt) / 900;
  if (croakP >= 0 && croakP < 1) { swell = Math.round(2 * Math.sin(Math.PI * croakP)); eyes = "closed"; }
  if (now < gulpUntil) swell = 1;
  if (now < happyUntil || (alert && alert.kind === "focus")) eyes = "happy";
  if (petting) { eyes = "happy"; swell = Math.trunc(now / 350) % 2; }
  if (sleeping) { eyes = "closed"; crouch = Math.max(crouch, 1); }
  if (now > nextBlink) { blinkUntil = now + 120; nextBlink = now + random(1500, 5000); }
  if (now < blinkUntil && (eyes === "open" || eyes === "tired")) eyes = "blink";

  const b = (hopS.phase === "none" && !petting) ? (Math.trunc(now / (sleeping ? 1400 : 700)) % 2) : 0;
  const ox = Math.round(kx), oy = GROUND_Y - KH - Math.trunc(jumpY);

  // --- scene
  drawWeather(now);
  ink(INK_GRAY);
  for (let x = 0; x < W; x += 4) display.px(x, GROUND_Y + 1, WHITE);
  const shadow = Math.max(12, 30 - Math.trunc(jumpY) * 3);
  display.hline(ox + KW / 2 - Math.trunc(shadow / 2), GROUND_Y + 2, shadow, WHITE);

  drawKero(ox, oy, { b, crouch, swell, eyes, lx: sleeping ? 0 : lookX, air, tongue });

  if (croakP >= 0.2 && croakP < 1.6) drawNote(ox + KW + 3 + Math.round(croakP * 4), oy + 2 - Math.round(croakP * 8));
  if (sweaty && !sleeping) drawSweat(ox, oy, now);
  if (sleeping) drawZz(ox, oy, now);
  if (petting) drawHeart(ox + KW / 2, Math.max(BAND_H + 4, oy - 6 - Math.trunc(now / 150) % 3));
  else if (alert && (now - alert.since < 20000 || Math.trunc(now / 500) % 2)) drawSideBubble(ox, oy, alert.text);
  else if (now < bubble.until) drawSideBubble(ox, oy, bubble.text);
}

// =====================================================================
//                         RENDER TO <canvas>
// =====================================================================
const canvas = document.getElementById("oled");
const ctx = canvas.getContext("2d");
const img = ctx.createImageData(W, H);
const ON = [228, 240, 255];

function present() {
  for (let i = 0; i < W * H; i++) {
    const lit = display.buf[i] ^ (display.inverted ? 1 : 0);
    const c = !lit ? null : (CFG.color && display.buf[i]) ? PALETTE[display.ink[i]] : ON;
    const o = i * 4;
    img.data[o] = c ? c[0] : 0;
    img.data[o + 1] = c ? c[1] : 0;
    img.data[o + 2] = c ? c[2] : 0;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function frame() {
  const now = millis();
  handleInput(now);
  nowTm = new Date();
  display.clear();
  ink(INK_WHITE);
  updateTimers(now);
  updateCards(now);
  drawInfoBand(now);
  updateAndDrawMascot(now);
  display.inverted = now < flashUntil && Math.trunc(now / 200) % 2 === 0;
  present();
}

// =====================================================================
//                      DATA: PC sensors + weather
// =====================================================================
const DEMO = { sys: {}, weather: null };   // only used by #demo=... previews
async function pollSys() {
  try {
    const s = await (await fetch("/sys")).json();
    sys = Object.assign({ ok: false, idle: 0, cpu: -1, mem: -1, battery: null, on_call: false }, s);
    Object.assign(sys, DEMO.sys);
    if (sys.cpu >= 0) cpuSmooth = cpuSmooth < 0 ? sys.cpu : cpuSmooth * 0.7 + sys.cpu * 0.3;
  } catch (e) { sys.ok = false; }
}

async function fetchEnv() {
  const loc = `latitude=${CFG.latitude}&longitude=${CFG.longitude}`;
  try {
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?${loc}&current=temperature_2m,weather_code`)).json();
    if (w.current && w.current.temperature_2m != null) outdoorTemp = w.current.temperature_2m;
    if (w.current && w.current.weather_code != null) weatherCode = DEMO.weather ?? w.current.weather_code;
    const a = await (await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${loc}&current=us_aqi`)).json();
    if (a.current && a.current.us_aqi != null) usAqi = a.current.us_aqi;
    return true;
  } catch (e) { return false; }
}
async function envLoop() {
  const ok = await fetchEnv();
  setTimeout(envLoop, ok ? 10 * 60 * 1000 : 30 * 1000);
}

// mouse: left button = the critter-style button, right click = focus timer
canvas.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  buttonDown = true; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", e => { if (e.button === 0) buttonDown = false; });
canvas.addEventListener("pointercancel", () => { buttonDown = false; });
canvas.addEventListener("contextmenu", e => { e.preventDefault(); lastInteraction = millis(); toggleFocus(); });

function reportViewport() {
  fetch("/viewport", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }),
  }).catch(() => {});
}
addEventListener("resize", reportViewport);

(async function start() {
  reportViewport();
  try { CFG = Object.assign(CFG, await (await fetch("/config")).json()); } catch (e) { /* defaults */ }
  const now = millis();
  lastInteraction = now;
  lastHourChimed = new Date().getHours();      // no chime right at startup
  nextFlyAt = now + 60000;
  nextAction = now + 2000;
  say("Ribbit!", 2500); croak();
  pollSys(); setInterval(pollSys, 2000);
  envLoop();
  applyDemo(location.hash.slice(1));
  setInterval(frame, 33);
})();

// Preview a state without waiting for it: open http://127.0.0.1:8797/#demo=<name>
// names: focus, done, stretch, sleep, rain, snow, hot, pet, fly, croak, card=<0-4>
function applyDemo(h) {
  const m = /demo=(\w+)(?:=(\d))?/.exec(h);
  if (!m) return;
  const now = millis(), d = m[1];
  const fakeSys = extra => { DEMO.sys = extra; Object.assign(sys, extra); if (extra.cpu) cpuSmooth = extra.cpu; };
  bubble.until = 0; croakAt = -1e9;
  if (d === "focus") { startFocus(); focus.endsAt = Date.now() + 18 * 60000 + 42000; bubble.until = 0; }
  if (d === "done") { startFocus(); focus.endsAt = Date.now() + 1500; }
  if (d === "stretch") { fakeSys({ ok: true, idle: 1 }); activeSince = Date.now() - 52 * 60000; }
  if (d === "sleep") { fakeSys({ ok: true, idle: 9999 }); sleeping = true; }
  if (d === "rain") DEMO.weather = weatherCode = 63;
  if (d === "snow") DEMO.weather = weatherCode = 73;
  if (d === "hot") { fakeSys({ ok: true, cpu: 93 }); switchCard(C_PC, now); holdUntil = now + 1e9; }
  if (d === "pet") { petting = true; }
  if (d === "fly") { startFly(2500); }
  if (d === "croak") { nextAction = now + 1e9; setInterval(croak, 2000); croak(); }
  if (d === "card") { switchCard(+m[2] || 0, now); holdUntil = now + 1e9; }
}
