#!/usr/bin/env python3
"""Compact 'Technologies used' table (one row per layer) sized for the gap left of the payload photo on slide 3
(about 5 : 1). Same verified stack as make_tech_table.py. Writes docs/deck/AquaSDR_tech_table_compact.png (transparent)."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from PIL import Image
plt.rcParams["font.family"] = ["Arial", "Helvetica", "DejaVu Sans"]
NAVY, INK, RULE, HEAD = "#183153", "#263238", "#C3CAD5", "#EEF1F5"
rows = [("Firmware", "STM32F446RE (Cortex-M4F) · Arduino C++ (.ino) on STM32duino · portable C engine"),
        ("Peripherals", "TIM6 + DMA1 → 12-bit DAC (PA4) · TIM8 + ADC3 + DMA2 capture · I²C · 1-Wire · SPI · UART"),
        ("Signal processing", "LFM · Geometric · Barker-13 · Hann / Hamming / Blackman · FFT · spectrogram"),
        ("Analog design", "Sallen-Key low-pass 70.7 kHz · TLV9062 op-amp ×1.5 · NumPy model · SPICE netlist"),
        ("Console & bridge", "React 19 · Vite · Three.js · Node.js · Express · WebSocket · USB serial"),
        ("Tools & testing", "Node test runner (160 tests) · Python · NumPy · Matplotlib · OpenSCAD")]
W, TH, RH, C1 = 7.2, 0.30, 0.205, 1.45
H = TH + len(rows) * RH
fig = plt.figure(figsize=(W, H + 0.02), dpi=400)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, W); ax.set_ylim(0, H + 0.02); ax.axis("off")
ax.text(0, H - TH / 2 + 0.01, "TECHNOLOGIES USED", fontsize=10, color=NAVY, fontweight="bold", va="center")
top = H - TH; b = 0.01
ax.add_patch(Rectangle((0, b), C1, top - b, fc=HEAD, ec="none"))
for i, (k, v) in enumerate(rows):
    y = top - (i + 0.5) * RH
    ax.text(0.09, y, k, fontsize=7.6, color=NAVY, fontweight="bold", va="center")
    ax.text(C1 + 0.1, y, v, fontsize=7.6, color=INK, va="center")
    if i: ax.plot([0, W], [top - i * RH] * 2, color=RULE, lw=0.5)
ax.plot([C1, C1], [b, top], color=RULE, lw=0.6)
ax.add_patch(Rectangle((0.004, b), W - 0.008, top - b, fc="none", ec=NAVY, lw=1.0))
out = "AquaSDR_tech_table_compact.png"
fig.savefig(out, transparent=True)
im = Image.open(out); im = im.crop(im.getbbox()); o = Image.new("RGBA", (im.width + 20, im.height + 20), (0, 0, 0, 0)); o.paste(im, (10, 10)); o.save(out)
print(o.size, round(o.width / o.height, 2))
