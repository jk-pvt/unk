#!/usr/bin/env python3
"""Slide 3 (TECHNICAL APPROACH) as six numbered panels, a technologies band and a flow line, in one consistent style.
Everything shown is real or computed from the repository:
  photos           docs/deck/img/sensors.jpg, bay.jpg, payload_panel.jpg (the team's own hardware)
  board graphics   Adafruit Fritzing Library (BMP390, INA219), CC BY-SA 3.0
  schematic        hardware/analog (designed stage, values from design_results.json)
  plots            data/bench/mcu-20261002071313-11-pulse (MCU ADC capture, LFM, Hann)
Writes docs/deck/AquaSDR_slide3_panels.png (figure only, for pasting under the slide title).
"""
import math, os, pathlib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Rectangle, Circle, Polygon, Arc
from PIL import Image

HERE = pathlib.Path(__file__).parent
IMG = HERE / "img"
plt.rcParams["font.family"] = ["Arial", "Helvetica", "DejaVu Sans"]
NAVY, TEAL, LAV, CHAR, GRAY, RULE, BG = "#183153", "#3B8C7A", "#8A7BAF", "#263238", "#667085", "#D0D5DD", "#F5F7FA"

CONTENT_ONLY = os.environ.get("CONTENT_ONLY") == "1"   # contents only, transparent, no frames/headers/arrows (for Canva boxes)
W, H = 16.0, 7.25
fig = plt.figure(figsize=(W, H), dpi=250)
if CONTENT_ONLY: fig.patch.set_alpha(0)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, W); ax.set_ylim(0, H); ax.axis("off")

def t(x, y, s, size=8, color=CHAR, weight="normal", ha="left", va="center", style="normal", z=8):
    ax.text(x, y, s, fontsize=size, color=color, fontweight=weight, ha=ha, va=va, style=style, zorder=z)

def panel(x, y, w, h, num, title, sub):
    if CONTENT_ONLY: return
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.08", fc="white", ec=RULE, lw=0.9, zorder=1))
    ax.add_patch(Circle((x + 0.27, y + h - 0.27), 0.15, fc=NAVY, ec="none", zorder=3))
    t(x + 0.27, y + h - 0.272, str(num), 9, "white", "bold", "center")
    t(x + 0.52, y + h - 0.21, title, 10, NAVY, "bold")
    t(x + 0.52, y + h - 0.43, sub, 7.6, GRAY)

def place(path, x, y, w, h, border=NAVY, lw=0.8):
    im = Image.open(path).convert("RGBA"); a = im.width / im.height
    dw, dh = (w, w / a) if w / a <= h else (h * a, h)
    dx, dy = x + (w - dw) / 2, y + (h - dh) / 2
    ax.imshow(im, extent=(dx, dx + dw, dy, dy + dh), zorder=3, interpolation="lanczos")
    if border: ax.add_patch(Rectangle((dx, dy), dw, dh, fill=False, ec=border, lw=lw, zorder=4))
    return dx, dy, dw, dh

def arrow(p, q, color=NAVY, lw=1.4, force=False):
    if CONTENT_ONLY and not force: return
    ax.annotate("", xy=q, xytext=p, arrowprops=dict(arrowstyle="-|>", color=color, lw=lw, mutation_scale=11, shrinkA=0, shrinkB=0), zorder=9)

def pillbox(x, y, s, size=6.6):
    ax.text(x, y, s, fontsize=size, color=NAVY, fontweight="bold", ha="left", va="center", zorder=9,
            bbox=dict(boxstyle="round,pad=0.25,rounding_size=0.3", fc="white", ec=NAVY, lw=0.6))

# ---------- simple monochrome line icons (one stroke weight) ----------
LW_I = 1.3
def icon(kind, cx, cy, s=0.26, c=NAVY):
    k = dict(color=c, lw=LW_I, zorder=9, solid_capstyle="round")
    if kind == "drop":
        th = [math.radians(a) for a in range(-30, 211, 10)]
        xs = [cx + 0.42 * s * math.cos(a) for a in th]; ys = [cy - 0.12 * s + 0.42 * s * math.sin(-a) * -1 for a in th]
        ax.plot([cx + 0.42 * s * math.cos(a) for a in th], [cy - 0.1 * s - 0.42 * s * math.sin(a) for a in th], **k)
        ax.plot([cx - 0.364 * s, cx, cx + 0.364 * s], [cy - 0.1 * s + 0.21 * s, cy + 0.55 * s, cy - 0.1 * s + 0.21 * s], **k)
    elif kind == "gear":
        ax.add_patch(Circle((cx, cy), 0.28 * s, fill=False, ec=c, lw=LW_I, zorder=9)); ax.add_patch(Circle((cx, cy), 0.1 * s, fill=False, ec=c, lw=LW_I, zorder=9))
        for i in range(8):
            a = i * math.pi / 4; ax.plot([cx + 0.28 * s * math.cos(a), cx + 0.46 * s * math.cos(a)], [cy + 0.28 * s * math.sin(a), cy + 0.46 * s * math.sin(a)], **k)
    elif kind == "wave":
        xs = [cx - 0.5 * s + i * s / 40 for i in range(41)]
        ax.plot(xs, [cy + 0.32 * s * math.sin((xx - cx + 0.5 * s) / s * 2 * math.pi * (1 + (xx - cx + 0.5 * s) / s)) for xx in xs], **k)
    elif kind == "stream":
        for i in range(3): ax.plot([cx - 0.45 * s + i * 0.18 * s] * 2, [cy - 0.3 * s, cy + 0.3 * s], **k)
        ax.plot([cx + 0.1 * s, cx + 0.5 * s, cx + 0.1 * s], [cy + 0.3 * s, cy, cy - 0.3 * s], **k)
    elif kind == "filter":
        ax.add_patch(Polygon([(cx - 0.45 * s, cy + 0.38 * s), (cx + 0.45 * s, cy + 0.38 * s), (cx + 0.08 * s, cy - 0.05 * s),
                              (cx + 0.08 * s, cy - 0.42 * s), (cx - 0.08 * s, cy - 0.32 * s), (cx - 0.08 * s, cy - 0.05 * s)], closed=True, fill=False, ec=c, lw=LW_I, zorder=9))
    elif kind == "verify":
        ax.add_patch(Circle((cx - 0.08 * s, cy + 0.08 * s), 0.3 * s, fill=False, ec=c, lw=LW_I, zorder=9))
        ax.plot([cx + 0.13 * s, cx + 0.45 * s], [cy - 0.13 * s, cy - 0.45 * s], **k)
    elif kind == "payload":
        ax.add_patch(FancyBboxPatch((cx - 0.5 * s, cy - 0.2 * s), s, 0.4 * s, boxstyle=f"round,pad=0,rounding_size={0.19 * s}", fill=False, ec=c, lw=LW_I, zorder=9))
        ax.plot([cx - 0.1 * s, cx - 0.1 * s], [cy - 0.2 * s, cy + 0.2 * s], **k)
    elif kind == "chip":
        ax.add_patch(Rectangle((cx - 0.28 * s, cy - 0.28 * s), 0.56 * s, 0.56 * s, fill=False, ec=c, lw=LW_I, zorder=9))
        for i in range(3):
            o = -0.16 * s + i * 0.16 * s
            for (x1, y1, x2, y2) in [(cx + o, cy + 0.28 * s, cx + o, cy + 0.44 * s), (cx + o, cy - 0.28 * s, cx + o, cy - 0.44 * s),
                                     (cx + 0.28 * s, cy + o, cx + 0.44 * s, cy + o), (cx - 0.28 * s, cy + o, cx - 0.44 * s, cy + o)]:
                ax.plot([x1, x2], [y1, y2], **k)
    elif kind == "opamp":
        ax.add_patch(Polygon([(cx - 0.35 * s, cy + 0.4 * s), (cx - 0.35 * s, cy - 0.4 * s), (cx + 0.42 * s, cy)], closed=True, fill=False, ec=c, lw=LW_I, zorder=9))
    elif kind == "screen":
        ax.add_patch(Rectangle((cx - 0.45 * s, cy - 0.18 * s), 0.9 * s, 0.56 * s, fill=False, ec=c, lw=LW_I, zorder=9))
        ax.plot([cx, cx], [cy - 0.18 * s, cy - 0.36 * s], **k); ax.plot([cx - 0.22 * s, cx + 0.22 * s], [cy - 0.38 * s, cy - 0.38 * s], **k)

# ===================== PANEL 1 · SENSE =====================
X1, Y0, Wd, Ht = 0.05, 1.32, 4.10, 5.88
panel(X1, Y0, Wd, Ht, 1, "SENSE · REAL ENVIRONMENT", "On-board environmental sensors")
PX, PY, PW = 0.20, 4.20, 2.10
PH = PW / 0.909
place(IMG / "sensors.jpg", PX, PY, PW, PH)
P = lambda u, v: (PX + u / 1400 * PW, PY + PH - v / 1541 * PH)
calls = [("TDS / salinity proxy", "A0 · ADC", (514, 424), 6.25), ("HC-SR04 · air range", "D7 / D8 · GPIO", (719, 617), 5.80),
         ("Turbidity", "PB0 · ADC", (540, 822), 5.35), ("DS18B20 temperature", "PC1 · 1-Wire", (1079, 796), 4.90),
         ("Pressure / depth", "PA1 · ADC", (1028, 1130), 4.45)]
for name, bus, (u, v), by in calls:
    px, py = P(u, v)
    ax.add_patch(FancyBboxPatch((2.45, by - 0.19), 1.58, 0.38, boxstyle="round,pad=0,rounding_size=0.04", fc="white", ec=RULE, lw=0.8, zorder=3))
    t(2.53, by + 0.07, name, 7.4, NAVY, "bold"); t(2.53, by - 0.1, bus, 6.8, GRAY)
    ax.plot([px, PX + PW], [py, py + (by - py) * (PX + PW - px) / (2.45 - px)], color="white", lw=1.3, zorder=5)
    ax.plot([PX + PW, 2.45], [py + (by - py) * (PX + PW - px) / (2.45 - px), by], color=NAVY, lw=0.8, zorder=5)
    ax.add_patch(Circle((px, py), 0.035, fc="white", ec=NAVY, lw=0.9, zorder=6))
t(X1 + Wd / 2, 3.95, "ADC  ·  1-Wire  ·  I²C  ·  GPIO", 8.6, TEAL, "bold", "center")
ax.plot([0.2, 4.0], [3.74, 3.74], color=RULE, lw=0.7, zorder=2)
t(0.22, 3.55, "Additional sensors (I²C)", 8.2, NAVY, "bold")
tiles = [("bmp390", "BMP390", "cabin pressure"), (None, "IMU", "ISM330DHCX\n+ MMC5983MA"), ("ina219", "INA219 ×2", "power monitor")]
for k, (img, name, sub) in enumerate(tiles):
    tx = 0.20 + k * 1.30
    ax.add_patch(FancyBboxPatch((tx, 1.50), 1.22, 1.88, boxstyle="round,pad=0,rounding_size=0.05", fc=BG, ec=RULE, lw=0.8, zorder=2))
    if img: place(IMG / "parts" / f"{img}.png", tx + 0.1, 2.25, 1.02, 0.98, border=None)
    else: icon("chip", tx + 0.61, 2.74, 0.62)
    t(tx + 0.61, 2.06, name, 8.2, NAVY, "bold", "center"); t(tx + 0.61, 1.76, sub, 6.8, GRAY, ha="center")
t(4.10, 1.40, "board graphics: Adafruit Fritzing Library, CC BY-SA 3.0", 5.2, "#98A2B3", ha="right")

# ===================== PANEL 2 · STM32 =====================
X2 = 4.35; W2 = 4.20
panel(X2, Y0, W2, Ht, 2, "STM32F446RE · EMBEDDED CONTROL", "Acquire → Decide → Adapt → Synthesise → Stream → Validate")
BW = 3.90; BH = BW / 2.7027; BX = X2 + 0.15; BY = 6.52 - BH
place(IMG / "bay.jpg", BX, BY, BW, BH)
for label, (fx, fy), (lx, ly) in [("STM32 NUCLEO-F446RE", (0.278, 0.114), (0.03, 0.10)), ("Sensor interface boards", (0.683, 0.82), (0.53, 0.82))]:
    tx_, ty_ = BX + fx * BW, BY + (1 - fy) * BH; lx_, ly_ = BX + lx * BW, BY + (1 - ly) * BH
    ax.plot([lx_ + 0.6, tx_], [ly_, ty_], color="white", lw=1.1, zorder=5)
    ax.add_patch(Circle((tx_, ty_), 0.035, fc="white", ec=NAVY, lw=0.9, zorder=6))
    pillbox(lx_, ly_, label)
t(BX, BY - 0.13, "Real electronics bay · NUCLEO-F446RE with the sensor interface boards", 6.8, GRAY, style="italic")
steps = [("2.1", "Acquire sensor data", "ADC · 1-Wire · I²C  |  reject stale / invalid readings"),
         ("2.2", "Decide water condition", "smoothing + hysteresis → CLEAR / TRANSITION / MURKY"),
         ("2.3", "Adapt waveform parameters", "centre frequency · bandwidth · pulse duration · amplitude"),
         ("2.4", "Synthesise digital waveform", "LFM · geometric · Barker-13  ×  Hann / Hamming / Blackman"),
         ("2.5", "Stream to DAC", "TIM6 + DMA → 12-bit DAC1 / PA4  |  1 MS/s · 0 underruns"),
         ("2.6", "Self-validate output", "ADC + DMA capture → FFT · spectrogram · matched filter")]
SY, SD = 4.50, 0.535
ax.plot([X2 + 0.36, X2 + 0.36], [SY, SY - 5 * SD], color=RULE, lw=1.2, zorder=2)
for k, (n, a, b) in enumerate(steps):
    y = SY - k * SD
    ax.add_patch(Circle((X2 + 0.36, y), 0.17, fc=NAVY, ec="none", zorder=4)); t(X2 + 0.36, y - 0.003, n, 6.8, "white", "bold", "center")
    t(X2 + 0.64, y + 0.09, a, 8.4, NAVY, "bold"); t(X2 + 0.64, y - 0.12, b, 6.9, GRAY)
    if k < 5: ax.plot([X2 + 0.62, X2 + W2 - 0.15], [y - 0.27, y - 0.27], color="#EEF0F3", lw=0.7, zorder=2)

# ===================== PANEL 3 · NEXT PING =====================
X3, W3, Y3, H3 = 8.75, 3.25, 4.28, 2.92
panel(X3, Y3, W3, H3, 3, "ADAPTIVE NEXT PING", "Waveform parameters per water condition")
TX, TW_, LW_, CW_ = X3 + 0.15, W3 - 0.30, 0.95, (W3 - 0.30 - 0.95) / 3
TT = 6.50; RH = 0.31
ax.add_patch(Rectangle((TX, TT - 5 * RH), TW_, 5 * RH, fc="white", ec=NAVY, lw=0.8, zorder=2))
ax.add_patch(Rectangle((TX, TT - RH), TW_, RH, fc=BG, ec="none", zorder=2))
ax.plot([TX, TX + TW_], [TT - RH, TT - RH], color=NAVY, lw=0.7, zorder=3)
ax.plot([TX + LW_, TX + LW_], [TT, TT - 5 * RH], color=NAVY, lw=0.6, zorder=3)
for j in (1, 2): ax.plot([TX + LW_ + j * CW_] * 2, [TT, TT - 5 * RH], color=RULE, lw=0.6, zorder=3)
t(TX + 0.07, TT - RH / 2, "Parameter", 7.2, GRAY, "bold")
for j, c in enumerate(["CLEAR", "TRANSITION", "MURKY"]): t(TX + LW_ + (j + 0.5) * CW_, TT - RH / 2, c, 7.0, NAVY, "bold", "center")
for i, (n, vals) in enumerate([("Centre", ["42 kHz", "40 kHz", "38 kHz"]), ("Bandwidth", ["4 kHz", "2 kHz", "1 kHz"]),
                               ("Pulse", ["2 ms", "4 ms", "8 ms"]), ("Amplitude", ["35 %", "50 %", "62 %"])]):
    yy = TT - (i + 1.5) * RH
    t(TX + 0.07, yy, n, 7.6, NAVY, "bold")
    for j, v in enumerate(vals): t(TX + LW_ + (j + 0.5) * CW_, yy, v, 7.8, CHAR, ha="center")
    if i < 3: ax.plot([TX, TX + TW_], [yy - RH / 2, yy - RH / 2], color=RULE, lw=0.5, zorder=3)
t(TX, 4.70, "CLEAR → shorter, sharper ping", 7.2, CHAR)
t(TX, 4.48, "MURKY → lower band, longer and stronger ping", 7.2, CHAR)

# ===================== PANEL 4 · ANALOG =====================
Y4, H4 = 1.32, 2.78
panel(X3, Y4, W3, H4, 4, "ANALOG SIGNAL CONDITIONING", "DAC → low-pass filter → op-amp → output")
place(IMG / "afe_chain.png", X3 + 0.12, 2.78, W3 - 0.24, 0.86, border=None)
for k, (a, b) in enumerate([("2nd-order Sallen-Key LPF", "70.7 kHz design target"), ("TLV9062 op-amp", "gain ×1.5, rail-to-rail"),
                            ("36–44 kHz band", "−0.2 to −0.5 dB (simulated)"), ("956 kHz DAC image", "−45 dB (simulated)")]):
    yy = 2.42 - k * 0.24
    t(X3 + 0.18, yy, a, 7.2, NAVY, "bold"); t(X3 + 1.72, yy, b, 7.0, GRAY)

# ===================== PANEL 5 · PAYLOAD =====================
X5, W5 = 12.20, 3.75
panel(X5, Y3, W5, H3, 5, "AQUASDR PAYLOAD", "Physical prototype for AUV integration")
place(IMG / "payload_panel.jpg", X5 + 0.12, 4.70, W5 - 0.24, 1.82)
t(X5 + W5 / 2, 4.50, "Acrylic payload hull · complete prototype", 7.2, GRAY, ha="center", style="italic")

# ===================== PANEL 6 · VALIDATION =====================
panel(X5, Y4, W5, H4, 6, "OUTPUT & VALIDATION", "MCU ADC capture of the real DAC output")
place(IMG / "val_spectrum.png", X5 + 0.10, 2.50, 1.74, 0.98, border=None)
place(IMG / "val_spectrogram.png", X5 + 1.90, 2.50, 1.74, 0.98, border=None)
t(X5 + 0.16, 2.36, "•  LFM 40 → 44 kHz sweep captured on the board", 7.0, CHAR)
t(X5 + 0.16, 2.17, "•  FFT · spectrogram · matched filter per test ping", 7.0, CHAR)
ax.add_patch(FancyBboxPatch((X5 + 0.12, 1.42), W5 - 0.24, 0.62, boxstyle="round,pad=0,rounding_size=0.05", fc="white", ec=LAV, lw=0.9, ls=(0, (4, 2.5)), zorder=2))
t(X5 + 0.22, 1.90, "External validation path", 7.6, NAVY, "bold")
t(X5 + 0.22, 1.71, "oscilloscope / spectrum analyzer", 7.0, GRAY)
t(X5 + 0.22, 1.53, "acoustic transducer in the AUV hull-slot pod", 7.0, GRAY)

# ---------- panel-to-panel flow ----------
arrow((4.17, 5.10), (4.33, 5.10)); arrow((8.57, 5.70), (8.73, 5.70)); arrow((8.57, 2.94), (8.73, 2.94))
arrow((10.375, 4.26), (10.375, 4.12)); arrow((12.02, 2.70), (12.18, 2.70)); arrow((14.075, 4.26), (14.075, 4.12))

# ===================== TECHNOLOGIES =====================
(lambda p: None if CONTENT_ONLY else ax.add_patch(p))(FancyBboxPatch((0.05, 0.70), 15.9, 0.52, boxstyle="round,pad=0,rounding_size=0.06", fc="white", ec=RULE, lw=0.9, zorder=1))
t(0.22, 1.04, "TECHNOLOGIES", 8.4, NAVY, "bold"); t(0.22, 0.86, "TO BE USED", 8.4, NAVY, "bold")
groups = [("chip", "Embedded", "STM32F446RE · C/C++ · ADC · TIM6 · DMA · 12-bit DAC"), ("wave", "Signal processing", "LFM · geometric sweep · Barker-13 · FFT · windowing"),
          ("opamp", "Analog", "Sallen-Key LPF · TLV9062"), ("screen", "Software", "React · Node.js · Python · OpenSCAD")]
gx = [1.75, 5.65, 9.75, 12.35]
for (ic, a, b), x in zip(groups, gx):
    icon(ic, x, 0.96, 0.3); t(x + 0.25, 1.05, a, 7.8, NAVY, "bold"); t(x + 0.25, 0.86, b, 7.2, CHAR)

# ===================== FLOW =====================
(lambda p: None if CONTENT_ONLY else ax.add_patch(p))(FancyBboxPatch((0.05, 0.04), 15.9, 0.56, boxstyle="round,pad=0,rounding_size=0.06", fc="white", ec=RULE, lw=0.9, zorder=1))
flow = [("drop", "SENSE", "real environment"), ("gear", "DECIDE", "adaptation policy"), ("wave", "SYNTHESISE", "digital waveform"),
        ("stream", "STREAM", "TIM6 + DMA + DAC"), ("filter", "CONDITION", "analog front end"), ("verify", "VERIFY", "output validation"),
        ("payload", "AQUASDR PAYLOAD", "physical prototype")]
fx0, fstep = 0.35, 2.28
for k, (ic, a, b) in enumerate(flow):
    x = fx0 + k * fstep
    icon(ic, x + 0.15, 0.32, 0.32)
    t(x + 0.42, 0.41, a, 7.8, NAVY, "bold"); t(x + 0.42, 0.22, b, 6.8, GRAY)
    if k < len(flow) - 1: arrow((x + 1.72, 0.32), (x + 2.06, 0.32), lw=1.1, force=True)

if CONTENT_ONLY:
    out = HERE / "slide3_parts"; out.mkdir(exist_ok=True)
    fig.savefig(out / "_all.png", dpi=300, transparent=True)
    full = Image.open(out / "_all.png"); sx, sy = full.width / W, full.height / H
    regions = {"panel1_sense": (0.05, 1.32, 4.15, 6.66), "panel2_stm32": (4.35, 1.32, 8.55, 6.66), "panel3_next_ping": (8.75, 4.28, 12.0, 6.66),
               "panel4_analog": (8.75, 1.32, 12.0, 3.68), "panel5_payload": (12.2, 4.28, 15.95, 6.66), "panel6_validation": (12.2, 1.32, 15.95, 3.68),
               "band_technologies": (0.05, 0.70, 15.95, 1.22), "band_flow": (0.05, 0.04, 15.95, 0.60)}
    for name, (x0, y0, x1, y1) in regions.items():
        c = full.crop((round(x0 * sx), round((H - y1) * sy), round(x1 * sx), round((H - y0) * sy)))
        bb = c.getchannel("A").getbbox(); pad = 18
        if bb: c = c.crop((max(0, bb[0] - pad), max(0, bb[1] - pad), min(c.width, bb[2] + pad), min(c.height, bb[3] + pad)))
        c.save(out / f"{name}.png"); print(name, c.size)
    (out / "_all.png").unlink()
else:
    fig.savefig(HERE / "AquaSDR_slide3_panels.png", dpi=250, facecolor="white")
    print("wrote", HERE / "AquaSDR_slide3_panels.png")
