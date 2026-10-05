#!/usr/bin/env python3
"""Slide 3 centre block: DECIDE (STM32). Real photo crop (IMG_9630), real policy numbers.
Hysteresis thresholds and ping profiles are the firmware's (CLEAR 2 ms/35 %, MURKY 8 ms/62 %, up 40/75 %, down 30/65 %).
The raw -> smoothed trace is an illustration (labelled so), not recorded data. Writes decide_block.png (transparent)."""
import numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from PIL import Image, ImageOps
plt.rcParams["font.family"] = ["Arial", "Helvetica", "DejaVu Sans"]
NAVY, TEAL, GRAY, RULE, CARD, BLUE = "#183153", "#3B8C7A", "#667085", "#D0D5DD", "#F6F8FA", "#2F6BD8"

W, H = 4.0, 7.3
fig = plt.figure(figsize=(W, H), dpi=300)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, W); ax.set_ylim(0, H); ax.axis("off")
def t(x, y, s, size, color=NAVY, weight="normal", ha="left"):
    ax.text(x, y, s, fontsize=size, color=color, fontweight=weight, ha=ha, va="center")
def card(y, h):
    ax.add_patch(FancyBboxPatch((0.05, y), W - 0.1, h, boxstyle="round,pad=0,rounding_size=0.08", fc=CARD, ec=RULE, lw=0.8))
def down(y): ax.annotate("", xy=(W / 2, y - 0.16), xytext=(W / 2, y), arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.1, mutation_scale=9))
def inset(x, y, w, h):
    a = fig.add_axes([x / W, y / H, w / W, h / H]); a.axis("off"); return a

# header
t(0.08, H - 0.17, "DECIDE", 17, weight="bold"); t(0.08, H - 0.42, "STM32F446RE · embedded control", 8.6, GRAY)
# real photo
im = ImageOps.exif_transpose(Image.open("../img/src/IMG_9630.jpg")).convert("RGB")
k = im.width / 500
im = im.crop((int(82 * k), int(58 * k), int(262 * k), int(150 * k)))
pw = W - 0.1; ph = pw * im.height / im.width
pa = inset(0.05, H - 0.62 - ph, pw, ph); pa.imshow(im, interpolation="lanczos")
for s in pa.spines.values(): s.set_visible(True); s.set_color(NAVY); s.set_linewidth(0.8)
pa.axis("on"); pa.set_xticks([]); pa.set_yticks([])
py = H - 0.62 - ph
t(W / 2, py - 0.13, "STM32 NUCLEO-F446RE", 7.6, NAVY, "bold", "center")
down(py - 0.26)

def section(top, title, b1, b2):
    h = 1.24; card(top - h, h)
    t(0.2, top - 0.17, title, 9.6, weight="bold")
    t(0.2, top - 0.37, "•  " + b1, 7.3, GRAY); t(0.2, top - 0.53, "•  " + b2, 7.3, GRAY)
    return top - h

# 1 acquire & filter (illustration)
y1 = py - 0.45
b = section(y1, "ACQUIRE & FILTER", "Read sensors over ADC · 1-Wire · I²C", "Reject stale and out-of-range readings")
rng = np.random.default_rng(3); x = np.linspace(0, 1, 160)
base = 0.5 + 0.18 * np.sin(2 * np.pi * 1.3 * x); raw = base + rng.normal(0, 0.09, x.size)
sm = np.convolve(raw, np.ones(15) / 15, mode="same"); sm[:7] = sm[7]; sm[-7:] = sm[-8]
for xx, sig, col, lab in ((0.2, raw, "#98A2B3", "raw"), (2.15, sm, BLUE, "smoothed")):
    a = inset(xx, b + 0.1, 1.65, 0.34); a.plot(x, sig, color=col, lw=0.8); a.set_ylim(0, 1); a.axis("off")
    t(xx + 1.65, b + 0.52, lab, 6.4, GRAY, ha="right")
ax.annotate("", xy=(2.08, b + 0.27), xytext=(1.9, b + 0.27), arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=0.9, mutation_scale=7))
down(b - 0.03)

# 2 classify (real hysteresis thresholds)
y2 = b - 0.22
b = section(y2, "CLASSIFY CONDITION", "Smoothing + hysteresis", "Separate up / down thresholds: no flicker")
a = inset(0.32, b + 0.1, W - 0.6, 0.42)
up = [(0, 0), (40, 0), (40, 1), (75, 1), (75, 2), (100, 2)]; dn = [(100, 2), (65, 2), (65, 1), (30, 1), (30, 0), (0, 0)]
a.plot(*zip(*up), color=BLUE, lw=1.2); a.plot(*zip(*dn), color=TEAL, lw=1.2, ls=(0, (3, 1.6)))
for v in (30, 40, 65, 75): a.text(v, -0.62, f"{v}%", fontsize=5.6, color=GRAY, ha="center", va="center")
a.text(103, 2, "rising", fontsize=5.8, color=BLUE, va="center"); a.text(103, 1.25, "falling", fontsize=5.8, color=TEAL, va="center")
a.set_xlim(-2, 118); a.set_ylim(-0.9, 2.3); a.axis("off")
down(b - 0.03)

# 3 select next ping (real policy profiles, Hann-windowed envelopes)
y3 = b - 0.22
b = section(y3, "SELECT NEXT PING", "Centre freq · bandwidth · pulse length · amplitude", "Hand off to the DMA waveform engine")
def env(a, ms, amp, col):
    tt = np.linspace(0, 8, 1600); e = np.where(tt < ms, amp * np.sin(np.pi * tt / ms) ** 2, 0)
    a.fill_between(tt, -e, e, color=col, alpha=0.18, lw=0); a.plot(tt, e, color=col, lw=0.8); a.plot(tt, -e, color=col, lw=0.8)
    a.set_xlim(-0.2, 8.2); a.set_ylim(-0.7, 0.7); a.axis("off")
env(inset(0.2, b + 0.1, 1.65, 0.34), 2, 0.35, BLUE); t(0.2, b + 0.52, "2 ms · 35 %", 6.4, GRAY)
env(inset(2.15, b + 0.1, 1.65, 0.34), 8, 0.62, NAVY); t(2.15, b + 0.52, "8 ms · 62 %", 6.4, GRAY)
ax.annotate("", xy=(2.08, b + 0.27), xytext=(1.9, b + 0.27), arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=0.9, mutation_scale=7))
fig.savefig("decide_block.png", transparent=True)
im = Image.open("decide_block.png"); im = im.crop(im.getbbox())
out = Image.new("RGBA", (im.width + 24, im.height + 24), (0, 0, 0, 0)); out.paste(im, (12, 12)); out.save("decide_block.png")
print("bottom", round(b, 2))
