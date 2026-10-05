#!/usr/bin/env python3
"""AquaSDR architecture v2 for the SIH deck: real hardware -> system logic -> real hardware.
Photos are crops of the team's own prototype photographs (docs/reference/prototype); the analog stage is the
team's own schematic (hardware/analog), shown dashed because it is designed, not built. No stock imagery.
Writes architecture_v2.png (3200x1800) next to this file."""
import pathlib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Circle
from PIL import Image

HERE = pathlib.Path(__file__).parent
IMG = HERE / "img"
plt.rcParams["font.family"] = ["Arial", "Helvetica", "DejaVu Sans"]
INK, SUB = "#14213D", "#4A5568"
GREEN, BLUE, PURPLE, TEAL, RED = "#2E8B6E", "#2A4D8F", "#7B5EA7", "#1F7A8C", "#C0392B"

fig = plt.figure(figsize=(16, 9), dpi=200)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, 160); ax.set_ylim(0, 90); ax.axis("off")
fig.patch.set_facecolor("white")

def photo(path, x, y, w, h, edge, dashed=False, r=1.6):
    im = Image.open(path).convert("RGB")
    a = ax.imshow(im, extent=(x, x + w, y, y + h), aspect="auto", zorder=2, interpolation="lanczos")
    frame = FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}", fc="none", ec=edge, lw=2.4,
                           ls=(0, (5, 3)) if dashed else "-", zorder=3)
    clip = FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}", transform=ax.transData)
    a.set_clip_path(clip); ax.add_patch(frame)
    return im.size

def label(x, y, s, size=9, color=SUB, weight="normal", ha="left", va="center", **kw):
    ax.text(x, y, s, fontsize=size, color=color, fontweight=weight, ha=ha, va=va, zorder=6, **kw)

def arrow(p, q, color=INK, lw=2.2, rad=0.0, both=False):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle="<|-|>" if both else "-|>", mutation_scale=15, lw=lw, color=color,
                                 connectionstyle=f"arc3,rad={rad}", zorder=5, shrinkA=0, shrinkB=0))

def section(x, y, num, text, color):
    ax.add_patch(Circle((x + 1.6, y), 1.6 if num else 0.9, fc=color, ec="none", zorder=6))
    if num: label(x + 1.6, y, num, size=10, color="white", weight="bold", ha="center")
    label(x + 4.0, y, text, size=11.5, color=color, weight="bold")

# ---------- header ----------
label(3, 86.3, "AquaSDR · SYSTEM ARCHITECTURE", size=21, color=INK, weight="bold")
label(157, 86.3, "real sensors  →  on-chip logic  →  real payload", size=11, color=SUB, ha="right")
ax.plot([3, 157], [83.2, 83.2], color="#D5DAE3", lw=1.2, zorder=1)

# ---------- LEFT: real sensor end plate ----------
section(3, 79.5, "", "SENSE · live water sensors", GREEN)
px, py, pw, ph = 3, 33.5, 32.5, 42.5          # probe photo (crop 520 x 680)
photo(IMG / "crop_probes.png", px, py, pw, ph, GREEN)
P = lambda u, v: (px + u / 520 * pw, py + ph - v / 680 * ph)   # crop pixel -> axes
callouts = [((240, 150), 72.5, "HC-SR04 ultrasonic"), ((140, 185), 66.5, "TDS / salinity probe"),
            ((430, 330), 60.5, "DS18B20 temperature"), ((165, 465), 53.5, "Turbidity sensor"),
            ((350, 525), 46.5, "Pressure / depth sensor")]
for (u, v), ly, text in callouts:
    sx, sy = P(u, v)
    ax.plot([sx, 37.2], [sy, ly], color=GREEN, lw=1.3, zorder=7)
    ax.add_patch(Circle((sx, sy), 0.55, fc="white", ec=GREEN, lw=1.6, zorder=8))
    label(37.6, ly, text, size=9.2, color=INK, weight="bold")
label(px, 31.2, "Real sensor end plate of the AquaSDR payload", size=8.4, color=SUB, style="italic")
chips = [("Turbidity", "PB0 · ADC"), ("TDS / salinity", "A0 · ADC1"), ("Pressure / depth", "PA1 · ADC"), ("DS18B20", "PC1 · 1-Wire"),
         ("IMU + magnetometer", "I²C"), ("BMP390 cabin pressure", "I²C"), ("HC-SR04", "D7 / D8"), ("INA219 ×2", "I²C · not commissioned")]
for i, (n, s) in enumerate(chips):
    cx, cy = 3 + (i % 2) * 23.5, 26.2 - (i // 2) * 4.6
    ax.add_patch(FancyBboxPatch((cx, cy - 1.75), 22.5, 3.5, boxstyle="round,pad=0,rounding_size=0.9", fc="#EEF7F2", ec=GREEN,
                                lw=1.1, ls=(0, (3, 2)) if "not" in s else "-", zorder=3))
    label(cx + 1.0, cy + 0.55, n, size=8.2, color=INK, weight="bold", va="center")
    label(cx + 1.0, cy - 0.85, s, size=7.4, color=SUB, va="center")

# ---------- CENTER: STM32 ----------
section(53, 79.5, "", "DECIDE · SYNTHESISE · STREAM  (STM32 NUCLEO-F446RE)", BLUE)
bx, by, bw, bh = 53, 52.5, 56, 24.0                     # electronics bay photo (crop 770 x 330)
photo(IMG / "crop_bay.png", bx, by, bw, bh, BLUE)
label(bx, 50.6, "Electronics bay: STM32 + TFT showing the live TX spectrum (real)", size=8.4, color=SUB, style="italic")
ax.add_patch(FancyBboxPatch((53, 3.5), 56, 44.0, boxstyle="round,pad=0,rounding_size=1.6", fc="#F2F5FB", ec=BLUE, lw=2.0, zorder=1))
steps = [("①", "Acquire", "ADC1 every 20 ms · rejects stale / out-of-range readings"),
         ("②", "Adapt", "smoothing + hysteresis → CLEAR / TRANSITION / MURKY"),
         ("③", "Synthesise", "LFM · geometric · Barker-13  ×  Hann / Hamming / Blackman"),
         ("④", "Stream", "TIM6 1 MS/s → DMA1 → DAC1 (PA4) · 0 underruns · CPU sleeps"),
         ("⑥", "Self-validate", "TIM8 → ADC3 → DMA2 captures the real DAC output"),
         ("", "Telemetry", "USART2 + DMA → USB → console · TFT status pages")]
sy0, dy = 43.6, 7.1
ax.plot([57.0, 57.0], [sy0, sy0 - dy * (len(steps) - 1)], color=BLUE, lw=2.2, zorder=2)
for i, (n, t, d) in enumerate(steps):
    y = sy0 - i * dy
    col = RED if t == "Self-validate" else BLUE
    ax.add_patch(Circle((57.0, y), 1.9, fc=col if n else TEAL, ec=col if n else TEAL, lw=2.2, zorder=4))
    if not n: label(57.0, y - 0.05, "⇄", size=11, color="white", weight="bold", ha="center")
    if n: label(57.0, y - 0.05, n.replace("①", "1").replace("②", "2").replace("③", "3").replace("④", "4").replace("⑥", "6"), size=10.5, color="white", weight="bold", ha="center")
    label(60.4, y + 1.0, t, size=11, color=INK, weight="bold")
    label(60.4, y - 1.35, d, size=8.6, color=SUB)
arrow((36.5, 40.5), (55.0, sy0), color=GREEN, lw=2.4, rad=-0.18)            # sensors -> acquire
# self-validation loop: DAC pin back into ADC3
ax.plot([107.0, 107.0], [sy0 - 3 * dy, sy0 - 4 * dy], color=RED, lw=2.2, zorder=3)
arrow((107.0, sy0 - 4 * dy), (104.0, sy0 - 4 * dy), color=RED, lw=2.2)
label(107.7, sy0 - 3.5 * dy, "PA4 → A5", size=8, color=RED, weight="bold", rotation=90, ha="left")

# ---------- RIGHT: adapted parameters, analog stage, payload ----------
section(113, 79.5, "", "ADAPTED NEXT PING", PURPLE)
cols = [("CLEAR", "#3A7BD5"), ("TRANSITION", "#7B5EA7"), ("MURKY", "#8D5A2B")]
rows = [("Centre", ["42 kHz", "40 kHz", "38 kHz"]), ("Bandwidth", ["4 kHz", "2 kHz", "1 kHz"]),
        ("Pulse", ["2 ms", "4 ms", "8 ms"]), ("Amplitude", ["35 %", "50 %", "62 %"])]
tx, cw = 126, 10.6
for j, (c, colr) in enumerate(cols):
    ax.add_patch(FancyBboxPatch((tx + j * cw + 0.3, 73.6), cw - 0.6, 3.3, boxstyle="round,pad=0,rounding_size=0.8", fc=colr, ec="none", zorder=3))
    label(tx + j * cw + cw / 2, 75.25, c, size=8.6, color="white", weight="bold", ha="center")
for i, (n, vals) in enumerate(rows):
    y = 70.9 - i * 2.75
    label(114, y, n, size=9, color=INK, weight="bold")
    for j, v in enumerate(vals): label(tx + j * cw + cw / 2, y, v, size=9.2, color=SUB, ha="center")
label(114, 60.6, "clear water: sharp image  →  murky water: penetration and energy", size=8.2, color=SUB, style="italic")
arrow((109.3, 47.0), (113.3, 64.5), color=PURPLE, lw=2.0, rad=-0.2)    # policy -> parameters

section(113, 56.6, "5", "CONDITION · analog front end", PURPLE)
ax.add_patch(FancyBboxPatch((113, 40.2), 44, 13.6, boxstyle="round,pad=0,rounding_size=1.4", fc="white", ec=PURPLE, lw=2.2,
                            ls=(0, (5, 3)), zorder=2))
ax.imshow(Image.open(IMG / "afe_chain.png"), extent=(114.2, 155.8, 41.4, 52.8), aspect="auto", zorder=3, interpolation="lanczos")
label(113, 38.4, "70.7 kHz Sallen-Key + TLV9062 ×1.5 · designed, build next", size=8.2, color=PURPLE, weight="bold")
arrow((109.0, sy0 - 3 * dy), (113.0, 46.5), color=PURPLE, lw=2.4)          # DAC -> AFE

section(113, 34.4, "★", "AquaSDR PAYLOAD · built", INK)
photo(IMG / "crop_hero.png", 113, 13.0, 44, 18.6, INK)
arrow((151, 40.0), (151, 31.8), color=INK, lw=2.2)
label(113, 10.8, "Output → oscilloscope / spectrum analyzer at the judging table · transducer next", size=8.2, color=SUB)

# ---------- footer ----------
ax.add_patch(FancyBboxPatch((3, 1.3), 46, 4.2, boxstyle="round,pad=0,rounding_size=1.0", fc="#F7F7F9", ec="#C3CAD6", lw=1.1, zorder=1))
label(4.6, 3.4, "Photos: our own AquaSDR hardware, no stock images", size=8.2, color=SUB)
ax.add_patch(FancyBboxPatch((113, 2.1), 4.2, 2.4, boxstyle="round,pad=0,rounding_size=0.5", fc="white", ec=INK, lw=1.8, ls=(0, (4, 2.5)), zorder=3))
label(118.0, 3.3, "dashed = designed, next build", size=8.4, color=INK)

fig.savefig(HERE / "architecture_v2.png", dpi=200, facecolor="white")
print("wrote", HERE / "architecture_v2.png")
