#!/usr/bin/env python3
"""'Technologies used' table (full stack, from package.json, firmware includes, Makefile, scripts) as a table for slide 3. Writes docs/deck/AquaSDR_tech_table.png (transparent)."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from PIL import Image
plt.rcParams["font.family"] = ["Arial", "Helvetica", "DejaVu Sans"]
NAVY, INK, RULE, HEAD = "#183153", "#263238", "#C3CAD5", "#EEF1F5"
cols = [("FIRMWARE", ["STM32F446RE · Cortex-M4F", "Arduino C++ (.ino) · STM32duino", "Portable C engine: adapt · waveform"]),
        ("PERIPHERALS & DRIVERS", ["TIM6 · DMA1 · 12-bit DAC (PA4)", "TIM8 · ADC3 · DMA2 self-capture", "I²C · 1-Wire · SPI TFT · UART"]),
        ("SIGNAL PROCESSING", ["LFM · Geometric · Barker-13", "Hann · Hamming · Blackman", "FFT · spectrogram · matched filter"]),
        ("ANALOG DESIGN", ["Sallen-Key low-pass · 70.7 kHz", "TLV9062 op-amp ×1.5", "Python / NumPy model · SPICE netlist"]),
        ("CONSOLE & BRIDGE", ["React 19 · Vite", "Three.js 3D payload model", "Node.js · Express · WebSocket"]),
        ("TOOLS & TESTING", ["Node test runner · 161 tests", "Python · NumPy · Matplotlib", "OpenSCAD enclosure"])]
W, TH, HH, RH = 13.0, 0.36, 0.32, 0.27
NR = 3
H = TH + HH + NR * RH
fig = plt.figure(figsize=(W, H + 0.02), dpi=300)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, W); ax.set_ylim(0, H + 0.02); ax.axis("off")
ax.text(0.0, H - TH / 2, "TECHNOLOGIES USED", fontsize=11.5, color=NAVY, fontweight="bold", va="center")
top = H - TH; cw = W / len(cols)
ax.add_patch(Rectangle((0, top - HH), W, HH, fc=HEAD, ec="none"))
for i, (h, items) in enumerate(cols):
    x = i * cw
    ax.text(x + 0.14, top - HH / 2, h, fontsize=7.8, color=NAVY, fontweight="bold", va="center")
    for r, s in enumerate(items):
        ax.text(x + 0.12, top - HH - (r + 0.5) * RH, s, fontsize=8.2, color="#667085" if s.startswith("Designed") else INK, va="center", style="italic" if s.startswith("Designed") else "normal")
    ax.plot([x, x], [0.01, top], color=NAVY if i == 0 else RULE, lw=1.1 if i == 0 else 0.7)
ax.plot([W - 0.005, W - 0.005], [0.01, top], color=NAVY, lw=1.1)
for y, c, lw in [(top, NAVY, 1.1), (top - HH, NAVY, 0.7), (0.01, NAVY, 1.1)] + [(top - HH - k * RH, RULE, 0.5) for k in range(1, NR)]:
    ax.plot([0, W], [y, y], color=c, lw=lw)
out = "AquaSDR_tech_table.png"
fig.savefig(out, transparent=True)
im = Image.open(out); im = im.crop(im.getbbox()); o = Image.new("RGBA", (im.width + 24, im.height + 24), (0, 0, 0, 0)); o.paste(im, (12, 12)); o.save(out)
