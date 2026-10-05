#!/usr/bin/env python3
"""AquaSDR system architecture diagram for the SIH deck. Every block and pin comes from the repository
(arduino/05_sensors_adaptive_tx, firmware/src, hardware/analog). Solid outline = built and running on the payload;
dashed outline = designed / next build. Writes architecture.png (3200x1800) and architecture.svg next to this file."""
import pathlib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

OUT = pathlib.Path(__file__).parent
plt.rcParams["font.family"] = ["Arial", "Helvetica", "DejaVu Sans"]
C = {  # slide palette
    "sens": ("#E4F3EC", "#2E8B6E"), "mcu": ("#E8EEF8", "#2A4D8F"), "mcu_in": ("#FFFFFF", "#2A4D8F"),
    "afe": ("#F1EBF8", "#7B5EA7"), "host": ("#E6F4F6", "#1F7A8C"), "pwr": ("#FFF4E3", "#C27A00"), "ink": "#14213D", "sub": "#4A5568"}
fig = plt.figure(figsize=(16, 9), dpi=200)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, 160); ax.set_ylim(0, 90); ax.axis("off")

def box(x, y, w, h, title, lines=(), kind="sens", dashed=False, tsize=11.5, lsize=8.6, fill=None, bold_title=True, r=1.2):
    face, edge = C[kind]
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}", fc=fill or face, ec=edge,
                                lw=2.2 if not dashed else 2.0, ls=(0, (5, 3)) if dashed else "-", zorder=2))
    ty = y + h - 1.9
    ax.text(x + w / 2, ty, title, ha="center", va="center", fontsize=tsize, color=C["ink"], fontweight="bold" if bold_title else "normal", zorder=3)
    for i, l in enumerate(lines):
        ax.text(x + w / 2, ty - 2.35 - i * 1.95, l, ha="center", va="center", fontsize=lsize, color=C["sub"], zorder=3)

def arrow(p, q, color="#14213D", lw=1.8, both=False, rad=0.0, label=None, lx=0, ly=0, ls="-", lsize=7.8):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle="<|-|>" if both else "-|>", mutation_scale=13, lw=lw, color=color,
                                 connectionstyle=f"arc3,rad={rad}", zorder=4, ls=ls, shrinkA=0, shrinkB=0))
    if label: ax.text((p[0] + q[0]) / 2 + lx, (p[1] + q[1]) / 2 + ly, label, ha="center", va="center", fontsize=lsize, color=C["sub"], zorder=5,
                      bbox=dict(fc="white", ec="none", pad=0.6))

def line(pts, color="#14213D", lw=1.8, ls="-"):
    xs, ys = zip(*pts); ax.plot(xs, ys, color=color, lw=lw, ls=ls, zorder=4, solid_capstyle="round")

# ---- title ----
ax.text(80, 86.6, "AquaSDR · SYSTEM ARCHITECTURE", ha="center", va="center", fontsize=20, fontweight="bold", color=C["ink"])
ax.text(80, 83.4, "Sense  →  Decide  →  Synthesise  →  Stream  →  Condition  →  Validate", ha="center", va="center", fontsize=11, color=C["sub"])

# ---- sensors (left) ----
ax.text(18, 79.6, "ENVIRONMENT & PAYLOAD SENSORS", ha="center", fontsize=10.5, fontweight="bold", color=C["sens"][1])
sensors = [
    ("Turbidity sensor", "analog · PB0 (ADC)", False),
    ("TDS / salinity sensor", "analog · PA0 / A0 (ADC1)", False),
    ("Pressure / depth sensor", "analog · PA1 (ADC)", False),
    ("DS18B20 temperature", "1-Wire · PC1", False),
    ("IMU ISM330DHCX + MMC5983MA", "I²C · PB9 SDA / PB8 SCL", False),
    ("BMP390 cabin pressure", "I²C bus", False),
    ("INA219 ×2 current monitors", "I²C · mounted, not commissioned", True),
    ("HC-SR04 ultrasonic", "D7 trig / D8 echo · air range", False),
]
y = 71.0
for name, sub, dashed in sensors:
    box(3, y, 30, 7.0, name, [sub], "sens", dashed=dashed, tsize=10, lsize=8.2)
    line([(33, y + 3.5), (36.5, y + 3.5)], color=C["sens"][1], lw=1.6)
    y -= 8.6
line([(36.5, 71 + 3.5), (36.5, y + 8.6 + 3.5)], color=C["sens"][1], lw=2.2)          # sensor bus
arrow((36.5, 74.5), (43, 74.5), color=C["sens"][1], lw=2.0)

# ---- STM32 ----
ax.add_patch(FancyBboxPatch((39.5, 8.5), 59, 73, boxstyle="round,pad=0,rounding_size=1.8", fc=C["mcu"][0], ec=C["mcu"][1], lw=2.6, zorder=1))
ax.text(69, 79.4, "STM32 NUCLEO-F446RE · Cortex-M4F 180 MHz · bare-metal C", ha="center", fontsize=10.5, fontweight="bold", color=C["mcu"][1])
box(43, 70.5, 52, 7.2, "① Sensor acquisition", ["ADC1 (20 ms) · 1-Wire · I²C · stale / out-of-range rejection"], "mcu_in", fill="#FFFFFF")
box(43, 59.5, 52, 8.6, "② Adaptation policy", ["smoothing · hysteresis · 60 ms settle → CLEAR / TRANSITION / MURKY",
                                                 "sets centre freq · bandwidth · pulse length · amplitude"], "mcu_in", fill="#FFFFFF")
box(43, 48.0, 52, 8.8, "③ Waveform engine (C)", ["LFM chirp · geometric sweep · Barker-13 phase code",
                                                    "× Hann / Hamming / Blackman / Rect window → spare DMA buffer"], "mcu_in", fill="#FFFFFF")
box(43, 36.8, 52, 8.4, "④ Hardware streaming", ["TIM6 1 MS/s → DMA1 Stream 5 → DAC1 12-bit (PA4)",
                                                   "double buffer · 0 underruns · CPU sleeps (WFI)"], "mcu_in", fill="#FFFFFF")
box(43, 25.0, 52, 8.6, "⑥ Self-validation capture", ["TIM8 → ADC3 (PC0 / A5) → DMA2 · 500 kS/s",
                                                       "board samples its own DAC output"], "mcu_in", fill="#FFFFFF")
box(70, 11.5, 25, 10.4, "USART2 + DMA", ["JSON commands,", "telemetry, captures", "(USB via ST-LINK)"], "mcu_in", fill="#FFFFFF", tsize=10, lsize=8)
box(43, 11.5, 25, 10.4, "ST7735 1.8″ TFT", ["live status pages", "(software SPI)"], "mcu_in", fill="#FFFFFF", tsize=10, lsize=8)
for a, b in [(70.5, 68.1), (59.5, 56.8), (48.0, 45.2)]:
    arrow((69, a), (69, b), color=C["mcu"][1], lw=2.0)
arrow((82.5, 25.0), (82.5, 21.9), color=C["mcu"][1], lw=1.8)

# ---- analog front end + outputs ----
ax.text(124, 49.4, "ANALOG FRONT END", ha="center", fontsize=10.5, fontweight="bold", color=C["afe"][1])
box(103, 36.8, 19, 10.6, "⑤ Low-pass filter", ["2nd-order Sallen-Key", "Butterworth · 70.7 kHz", "removes DAC steps"], "afe", dashed=True, tsize=10, lsize=8)
box(125, 36.8, 15, 10.6, "TLV9062", ["op-amp gain ×1.5", "rail-to-rail · 5 V", "drives output"], "afe", dashed=True, tsize=10, lsize=8)
box(143, 42.6, 15, 6.8, "Transducer", ["40 kHz piezo · future"], "afe", dashed=True, tsize=9.5, lsize=7.8)
box(143, 33.4, 15, 7.6, "Oscilloscope /", ["spectrum analyzer", "judging-table FFT"], "afe", dashed=True, tsize=9.5, lsize=7.8)
arrow((95, 41.0), (103, 41.0), color=C["afe"][1], lw=2.4)
arrow((122, 42.1), (125, 42.1), color=C["afe"][1], lw=2.2)
arrow((140, 43.5), (143, 46.0), color=C["afe"][1], lw=1.8)
arrow((140, 40.0), (143, 37.2), color=C["afe"][1], lw=1.8)
# self-validation loop from the DAC pin
line([(99.5, 41.0), (99.5, 29.3)], color="#C0392B", lw=2.0)
arrow((99.5, 29.3), (95, 29.3), color="#C0392B", lw=2.0)
ax.text(100.6, 35.3, "PA4 → A5", rotation=90, ha="left", va="center", fontsize=7.6, color="#C0392B", fontweight="bold")

# ---- adaptation results panel ----
box(103, 53.5, 55, 13.5, "Adapted next-ping parameters", [], "mcu", tsize=10.5)
rows = [("CLEAR", "42 kHz", "4 kHz", "2 ms", "35 %"), ("TRANSITION", "40 kHz", "2 kHz", "4 ms", "50 %"), ("MURKY", "38 kHz", "1 kHz", "8 ms", "62 %")]
hdr = ("Profile", "Centre", "Bandwidth", "Pulse", "Amplitude"); xs = [111, 123.5, 134.5, 144.5, 153]
for i, h in enumerate(hdr): ax.text(xs[i], 62.6, h, ha="center", fontsize=8.2, fontweight="bold", color=C["ink"])
for r_, row in enumerate(rows):
    for i, v in enumerate(row): ax.text(xs[i], 60.0 - r_ * 2.15, v, ha="center", fontsize=8.4, color=C["sub"] if i else C["ink"], fontweight="bold" if i == 0 else "normal")
arrow((95, 63.8), (103, 63.8), color=C["mcu"][1], lw=1.8)

# ---- power ----
box(103, 70.5, 55, 9.5, "Power", ["Bench: USB 5 V via ST-LINK (all recorded tests)",
                                  "Field: 3S2P 18650 Li-ion pack, 11.1 V / 5.2 Ah + power module"], "pwr", tsize=10.5, lsize=8.2)

# ---- host ----
box(103, 11.5, 26, 14.5, "Node.js bridge", ["serialport · Express", "WebSocket · JSON schema", "capture store · CSV"], "host", tsize=10.5, lsize=8.2)
box(132, 11.5, 26, 14.5, "React mission console", ["live FFT · spectrogram", "matched filter · evidence", "ladder · 3D payload model"], "host", tsize=10.5, lsize=8.2)
arrow((95, 16.7), (103, 16.7), both=True, color=C["host"][1], lw=2.0)
arrow((129, 18.7), (132, 18.7), both=True, color=C["host"][1], lw=2.0)
ax.text(116, 28.0, "commands  ·  telemetry  ·  captures", ha="center", fontsize=8, color=C["host"][1], fontweight="bold")

# ---- enclosure + legend footer ----
ax.add_patch(FancyBboxPatch((3, 1.6), 155, 4.6, boxstyle="round,pad=0,rounding_size=1.2", fc="#F7F7F9", ec="#9AA3B2", lw=1.4, zorder=1))
ax.text(5, 3.9, "Housing:", fontsize=9, fontweight="bold", color=C["ink"], va="center")
ax.text(15.5, 3.9, "acrylic payload hull (built)  ·  3D-printed PETG pod for an AUV hull slot (OpenSCAD, compiled and mesh-checked)", fontsize=8.8, color=C["sub"], va="center")
ax.add_patch(FancyBboxPatch((112.5, 2.8), 5, 2.2, boxstyle="round,pad=0,rounding_size=0.4", fc="white", ec=C["ink"], lw=1.8, zorder=3))
ax.text(118.6, 3.9, "built & running", fontsize=8.6, va="center", color=C["ink"])
ax.add_patch(FancyBboxPatch((134, 2.8), 5, 2.2, boxstyle="round,pad=0,rounding_size=0.4", fc="white", ec=C["ink"], lw=1.8, ls=(0, (4, 2.5)), zorder=3))
ax.text(140.1, 3.9, "designed / next build", fontsize=8.6, va="center", color=C["ink"])

fig.savefig(OUT / "architecture.png", dpi=200)
fig.savefig(OUT / "architecture.svg")
print("wrote", OUT / "architecture.png")
