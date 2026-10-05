#!/usr/bin/env python3
"""Slide 3 right-hand cards: ADAPT (policy table) + GENERATE & OUTPUT (synthesise, stream, condition, self-check).
Numbers are the firmware policy and recorded evidence. Waveform icons show shape only (cycles reduced for legibility).
The analog stage is drawn dashed: designed and simulated, not built. Writes balance_cards.png (transparent)."""
import numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from PIL import Image
plt.rcParams["font.family"] = ["Arial", "Helvetica", "DejaVu Sans"]
NAVY, TEAL, GRAY, RULE, CARD, BLUE, LAV = "#183153", "#3B8C7A", "#667085", "#D0D5DD", "#F6F8FA", "#2F6BD8", "#8A7BAF"
W, H = 6.6, 4.0
fig = plt.figure(figsize=(W, H), dpi=300)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, W); ax.set_ylim(0, H); ax.axis("off")
def t(x, y, s, size, color=NAVY, weight="normal", ha="left", va="center"):
    ax.text(x, y, s, fontsize=size, color=color, fontweight=weight, ha=ha, va=va)
def rbox(x, y, w, h, fc=CARD, ec=RULE, lw=0.8, ls="-", r=0.07):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}", fc=fc, ec=ec, lw=lw, ls=ls))
def arrow(x1, y1, x2, y2, color=NAVY):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1), arrowprops=dict(arrowstyle="-|>", color=color, lw=0.9, mutation_scale=7))
def inset(x, y, w, h):
    a = fig.add_axes([x / W, y / H, w / W, h / H]); a.axis("off"); return a

# ================= ADAPT =================
AX, AW = 0.02, 2.45
rbox(AX, 0.02, AW, H - 0.04)
t(AX + 0.15, H - 0.22, "ADAPT", 12, weight="bold")
t(AX + 0.15, H - 0.45, "next ping for each water condition", 7.6, GRAY)
cols = ["Centre", "Band", "Pulse", "Amp"]; cx = [AX + 0.55, AX + 1.07, AX + 1.55, AX + 2.05]
for c, x in zip(cols, cx): t(x, H - 0.78, c, 7.4, NAVY, "bold", "center")
ax.plot([AX + 0.15, AX + AW - 0.12], [H - 0.92] * 2, color=NAVY, lw=0.7)
rows = [("#4C9BD6", ["42 kHz", "4 kHz", "2 ms", "35 %"]), ("#7FBFB0", ["40 kHz", "2 kHz", "4 ms", "50 %"]), ("#B89E7C", ["38 kHz", "1 kHz", "8 ms", "62 %"])]
RH = 0.6
for i, (col, vals) in enumerate(rows):
    y = H - 0.92 - (i + 0.5) * RH
    ax.add_patch(FancyBboxPatch((AX + 0.15, y - 0.24), 0.07, 0.48, boxstyle="round,pad=0,rounding_size=0.03", fc=col, ec="none"))
    for v, x in zip(vals, cx): t(x, y, v, 9.4, NAVY, "bold", "center")
    if i < 2: ax.plot([AX + 0.15, AX + AW - 0.12], [y - RH / 2] * 2, color=RULE, lw=0.6)
yb = H - 0.92 - 3 * RH
ax.plot([AX + 0.15, AX + AW - 0.12], [yb] * 2, color=NAVY, lw=0.7)
t(AX + 0.15, yb - 0.25, "Murkier water →", 7.8, NAVY, "bold")
t(AX + 0.15, yb - 0.46, "lower band · longer pulse · more power", 7.4, GRAY)
t(AX + 0.15, yb - 0.80, "Clearer water →", 7.8, NAVY, "bold")
t(AX + 0.15, yb - 1.01, "wider band · short, sharp ping", 7.4, GRAY)

# ================= GENERATE & OUTPUT =================
GX, GW = 2.62, W - 2.64
rbox(GX, 0.02, GW, H - 0.04)
t(GX + 0.15, H - 0.22, "GENERATE & OUTPUT", 12, weight="bold")
t(GX + 0.15, H - 0.45, "waveform engine → timer + DMA → analog stage", 7.6, GRAY)
# synthesise: three waveform classes (shape only)
tt = np.linspace(0, 1, 1400); hann = np.sin(np.pi * tt) ** 2
lfm = hann * np.sin(2 * np.pi * (7 * tt + 9 * tt ** 2))
geo = hann * np.sin(2 * np.pi * 1.2 * (np.exp(3.2 * tt) - 1))
code = np.array([1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1]); chip = code[np.minimum((tt * 13).astype(int), 12)]
bark = chip * np.sin(2 * np.pi * 19.5 * tt)
TW, TY = 1.17, H - 1.42
for k, (name, sig) in enumerate((("LFM chirp", lfm), ("Geometric sweep", geo), ("Barker-13 code", bark))):
    x = GX + 0.15 + k * (TW + 0.08)
    rbox(x, TY, TW, 0.82, fc="white", r=0.05)
    t(x + 0.08, TY + 0.68, name, 7.2, NAVY, "bold")
    a = inset(x + 0.07, TY + 0.06, TW - 0.14, 0.5); a.set_ylim(-1.15, 1.15)
    if k == 2: a.plot(tt, sig * 0.8, color=BLUE, lw=0.4, alpha=0.35); a.step(tt, chip * 0.8, color=NAVY, lw=0.9, where="post")
    else: a.plot(tt, sig, color=BLUE, lw=0.55)
t(GX + 0.15, TY - 0.17, "Windows: Hann · Hamming · Blackman", 7.4, GRAY)
# stream chain
SY = TY - 0.72
chain = ["Buffer", "TIM6", "DMA", "DAC · PA4"]; bw = [0.62, 0.55, 0.55, 0.85]
x = GX + 0.15
for k, (lab, w) in enumerate(zip(chain, bw)):
    rbox(x, SY, w, 0.34, fc="white", ec=NAVY, lw=0.8, r=0.05)
    t(x + w / 2, SY + 0.17, lab, 7.6, NAVY, "bold", "center")
    if k < 3: arrow(x + w + 0.02, SY + 0.17, x + w + 0.17, SY + 0.17)
    x += w + 0.19
t(GX + 0.15, SY - 0.15, "1 MS/s · CPU stays free while DMA streams", 7.0, GRAY)
# condition (designed, not built)
CY = SY - 0.98
rbox(GX + 0.15, CY, GW - 0.3, 0.58, fc="none", ec=LAV, lw=0.9, ls=(0, (4, 2.5)), r=0.05)
t(GX + 0.25, CY + 0.46, "analog stage · designed, build next", 6.6, LAV)
stage = ["Low-pass filter\n70.7 kHz", "Op-amp\nTLV9062 ×1.5", "Transducer"]; sw = [1.05, 1.05, 0.85]
x = GX + 0.25
for k, (lab, w) in enumerate(zip(stage, sw)):
    t(x + w / 2, CY + 0.2, lab, 7.0, NAVY, "bold" if k < 2 else "normal", "center")
    if k < 2: arrow(x + w + 0.0, CY + 0.2, x + w + 0.18, CY + 0.2, LAV)
    x += w + 0.22
arrow(GX + 0.15 + 0.62 + 0.19 + 0.55 + 0.19 + 0.55 + 0.19 + 0.42, SY, GX + 0.15 + 0.62 + 0.19 + 0.55 + 0.19 + 0.55 + 0.19 + 0.42, CY + 0.58)
# self-check (recorded evidence)
KY = 0.12
rbox(GX + 0.15, KY, GW - 0.3, 0.42, fc="#E8F3F0", ec=TEAL, lw=0.8, r=0.05)
t(GX + 0.28, KY + 0.21, "✓", 10, TEAL, "bold")
t(GX + 0.5, KY + 0.21, "Self-check: board re-captures its own output → 42.00 kHz on target", 7.2, NAVY, "bold")

fig.savefig("balance_cards.png", transparent=True)
im = Image.open("balance_cards.png"); im = im.crop(im.getbbox())
out = Image.new("RGBA", (im.width + 24, im.height + 24), (0, 0, 0, 0)); out.paste(im, (12, 12)); out.save("balance_cards.png")
