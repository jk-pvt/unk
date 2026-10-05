#!/usr/bin/env python3
"""Slide 3 technical approach as one left-to-right engineering flow: SENSE -> DECIDE/ADAPT -> GENERATE/VERIFY.
Real assets only: sensors.jpg and IMG_9630 (team photos), val_spectrum.png / val_spectrogram.png (MCU ADC capture of the
CLEAR LFM, raw DAC tap). Waveform figures are shape sketches. Analog stage and transducer are dashed: designed / next.
The three underwater photos live in Canva; their frames here are left empty to be filled there.
Writes docs/deck/AquaSDR_slide3_flow.png (transparent)."""
import numpy as np, matplotlib, pathlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Circle, Polygon
from PIL import Image, ImageOps
HERE = pathlib.Path(__file__).parent; IMG = HERE / "img"
plt.rcParams["font.family"] = ["Arial", "Helvetica", "DejaVu Sans"]
NAVY, INK, GRAY, RULE, LIGHT = "#183153", "#344054", "#667085", "#D0D5DD", "#EEF1F5"
C_CLEAR, C_TRANS, C_MURKY = "#4C86B8", "#4F9A8C", "#A88B66"
W, H = 13.0, 5.6
fig = plt.figure(figsize=(W, H), dpi=300)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, W); ax.set_ylim(0, H); ax.axis("off")

def t(x, y, s, size=8.5, color=INK, weight="normal", ha="left", va="center"):
    ax.text(x, y, s, fontsize=size, color=color, fontweight=weight, ha=ha, va=va, linespacing=1.25, zorder=8)
def ln(xs, ys, color=NAVY, lw=0.8, ls="-", z=5): ax.plot(xs, ys, color=color, lw=lw, ls=ls, zorder=z, solid_capstyle="butt")
def arr(x1, y1, x2, y2, color=NAVY, lw=0.8):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1), arrowprops=dict(arrowstyle="-|>", color=color, lw=lw, mutation_scale=7, shrinkA=0, shrinkB=0), zorder=7)
def rect(x, y, w, h, ec=NAVY, lw=0.8, ls="-", fc="none"): ax.add_patch(Rectangle((x, y), w, h, fc=fc, ec=ec, lw=lw, ls=ls, zorder=4))
def place(im, x, y, w, h, border=True):
    if not isinstance(im, Image.Image): im = Image.open(im)
    im = im.convert("RGBA"); a = im.width / im.height
    dw, dh = (w, w / a) if w / a <= h else (h * a, h); dx, dy = x + (w - dw) / 2, y + (h - dh) / 2
    ax.imshow(im, extent=(dx, dx + dw, dy, dy + dh), zorder=3, interpolation="lanczos")
    if border: rect(dx, dy, dw, dh, lw=0.6)
    return dx, dy, dw, dh
def header(x, w, title, sub):
    t(x, 5.42, title, 11, NAVY, "bold"); t(x + 0.012 * len(title) * 11 / 1.0 * 0.075 + 0.02, 5.42, "", 1)
    t(x, 5.17, sub, 8, GRAY); ln([x, x + w], [5.0, 5.0], NAVY, 0.9)

# ============================ SENSE ============================
SX, SW = 0.05, 3.15
header(SX, SW, "SENSE", "on-board environmental inputs")
PX, PY, PW = SX, 2.55, 1.95; PH = PW / 0.909
place(IMG / "sensors.jpg", PX, PY, PW, PH)
P = lambda u, v: (PX + u / 1400 * PW, PY + PH - v / 1541 * PH)
calls = [("TDS / salinity proxy", "A0 · ADC", (514, 424)), ("HC-SR04 · air range", "D7 / D8 · GPIO", (719, 617)),
         ("Turbidity", "PB0 · ADC", (540, 822)), ("DS18B20 temperature", "PC1 · 1-Wire", (1079, 796)), ("Pressure / depth", "PA1 · ADC", (1028, 1130))]
LX = PX + PW + 0.18
for i, (name, bus, (u, v)) in enumerate(calls):
    by = 4.68 - i * 0.44; px, py = P(u, v)
    ax.plot([px, PX + PW + 0.06, LX - 0.04], [py, by, by], color="white", lw=1.6, zorder=5)
    ax.plot([px, PX + PW + 0.06, LX - 0.04], [py, by, by], color=NAVY, lw=0.6, zorder=6)
    ax.add_patch(Circle((px, py), 0.03, fc="white", ec=NAVY, lw=0.7, zorder=7))
    t(LX, by + 0.08, name, 7.8, NAVY, "bold"); t(LX, by - 0.1, bus, 7.2, GRAY)
ln([SX, SX + SW], [2.3, 2.3], RULE, 0.6)
t(SX, 2.08, "Also on I²C", 8, NAVY, "bold")
for i, (a, b) in enumerate([("BMP390", "cabin pressure"), ("IMU", "ISM330DHCX + MMC5983MA"), ("INA219 ×2", "power monitor")]):
    t(SX, 1.80 - i * 0.25, a, 7.8, NAVY, "bold"); t(SX + 0.85, 1.80 - i * 0.25, b, 7.6, GRAY)

# ============================ DECIDE + ADAPT ============================
CX, CW = 3.55, 4.45
header(CX, CW, "DECIDE  ·  ADAPT", "STM32F446RE picks the next ping from the water")
im = ImageOps.exif_transpose(Image.open(IMG / "src" / "IMG_9630.jpg")).convert("RGB"); k = im.width / 500
im = im.crop((int(82 * k), int(58 * k), int(262 * k), int(150 * k))); im.thumbnail((1400, 1400))
bx, by_, bw, bh = place(im, CX, 3.42, 1.95, 1.42)
t(bx + bw / 2, 3.28, "STM32 NUCLEO-F446RE", 7.6, NAVY, "bold", "center")
steps = [("Acquire & filter", "read sensors · reject stale / invalid"), ("Classify condition", "smoothing + hysteresis"),
         ("Select next ping", "centre · bandwidth · pulse · amplitude")]
QX = CX + 2.2
ln([QX, QX], [4.66, 3.5], RULE, 1.0, z=3)
for i, (a, b) in enumerate(steps):
    y = 4.66 - i * 0.58
    ax.add_patch(Circle((QX, y), 0.045, fc=NAVY, ec="none", zorder=6))
    t(QX + 0.15, y + 0.05, a, 8.6, NAVY, "bold"); t(QX + 0.15, y - 0.15, b, 7.6, GRAY)
# adapt spec table
cols = [("CLEAR", C_CLEAR), ("TRANSITION", C_TRANS), ("MURKY", C_MURKY)]
VX = [CX + 1.75, CX + 2.85, CX + 3.95]; FW = 1.0
for (name, c), x in zip(cols, VX):
    rect(x - FW / 2, 2.35, FW, 0.66, ec=RULE, lw=0.6, fc=LIGHT)                         # underwater photo frame (filled in Canva)
    t(x, 2.18, name, 7.8, c, "bold", "center"); ln([x - FW / 2, x + FW / 2], [2.06, 2.06], c, 1.6)
t(CX, 2.18, "Next ping", 7.8, NAVY, "bold")
rows = [("Centre frequency", ["42 kHz", "40 kHz", "38 kHz"]), ("Bandwidth", ["4 kHz", "2 kHz", "1 kHz"]),
        ("Pulse duration", ["2 ms", "4 ms", "8 ms"]), ("Amplitude", ["35 %", "50 %", "62 %"])]
for i, (lab, vals) in enumerate(rows):
    y = 1.86 - i * 0.29
    t(CX, y, lab, 7.8, GRAY)
    for v, x in zip(vals, VX): t(x, y, v, 8.6, NAVY, "bold", "center")
    ln([CX, CX + CW], [y - 0.145] * 2, RULE, 0.5)
t(CX, 0.48, "Clearer water", 7.8, NAVY, "bold"); t(CX + 0.95, 0.48, "wider band · short, sharp ping", 7.6, GRAY)
t(CX, 0.24, "Murkier water", 7.8, NAVY, "bold"); t(CX + 0.95, 0.24, "lower band · longer pulse · more power", 7.6, GRAY)

# ============================ GENERATE + VERIFY ============================
RX, RW = 8.40, 4.55
header(RX, RW, "GENERATE  ·  VERIFY", "waveform engine → DAC → analog stage · self-check")
tt = np.linspace(0, 1, 1200); hann = np.sin(np.pi * tt) ** 2
code = np.array([1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1]); chip = code[np.minimum((tt * 13).astype(int), 12)]
waves = [("LFM chirp", hann * np.sin(2 * np.pi * (6 * tt + 8 * tt ** 2)), None),
         ("Geometric sweep", hann * np.sin(2 * np.pi * 1.1 * (np.exp(3.1 * tt) - 1)), None), ("Barker-13 code", None, chip)]
for i, (name, sig, cd) in enumerate(waves):
    x = RX + i * 1.55
    t(x, 4.80, name, 7.8, NAVY, "bold")
    a = fig.add_axes([x / W, 4.25 / H, 1.38 / W, 0.42 / H]); a.axis("off"); a.set_ylim(-1.2, 1.2)
    a.axhline(0, color=RULE, lw=0.4)
    if cd is None: a.plot(tt, sig, color=NAVY, lw=0.5)
    else: a.step(tt, cd * 0.85, color=NAVY, lw=0.7, where="post")
t(RX, 4.10, "Windows: Hann · Hamming · Blackman", 7.6, GRAY)
# output chain (physical order)
CY, BH = 3.36, 0.46
blocks = [("STM32F446RE", "TIM6 + DMA", "-", 0.88), ("DAC · PA4", "on-chip · 1 MS/s", "-", 0.86),
          ("Low-pass filter", "70.7 kHz", "--", 0.84), ("TLV9062", "op-amp ×1.5", "--", 0.72), ("Transducer", "next", "--", 0.66)]
x = RX; pos = []
for i, (a, b, ls, w) in enumerate(blocks):
    rect(x, CY, w, BH, ec=NAVY if ls == "-" else GRAY, lw=0.8, ls=(0, (3, 2)) if ls == "--" else "-")
    t(x + w / 2, CY + 0.31, a, 7.4, NAVY, "bold", "center"); t(x + w / 2, CY + 0.13, b, 6.9, GRAY, ha="center")
    pos.append((x, w))
    if i < 4: arr(x + w + 0.02, CY + BH / 2, x + w + 0.12, CY + BH / 2)
    x += w + 0.14
fx, fw = pos[2][0], pos[3][0] + pos[3][1] - pos[2][0]
ln([fx, fx, fx + fw, fx + fw], [CY - 0.05, CY - 0.1, CY - 0.1, CY - 0.05], GRAY, 0.6)
t(fx + fw / 2, CY - 0.21, "analog stage · designed, not yet built", 6.9, GRAY, ha="center")
# verify: loopback from the raw DAC pin
ln([RX, RX + RW], [2.88, 2.88], RULE, 0.6)
t(RX, 2.70, "VERIFY", 9, NAVY, "bold"); t(RX + 0.68, 2.70, "on-board output validation · MCU ADC capture, not an oscilloscope", 7.4, GRAY)
lx = RX; LY = 2.42
for i, s in enumerate(["DAC (PA4)", "PA4 → A5 jumper", "ADC3 · A5", "FFT · spectrogram"]):
    t(lx, LY, s, 7.6, NAVY, "bold"); w = 0.065 * len(s)
    if i < 3: arr(lx + w + 0.02, LY, lx + w + 0.2, LY)
    lx += w + 0.28
t(RX, 2.20, "500 kS/s · 6000 samples · 12 ms record · raw DAC output (before the analog stage)", 7.0, GRAY)
place(IMG / "val_spectrum.png", RX, 0.98, 2.22, 1.08, border=False)
place(IMG / "val_spectrogram.png", RX + 2.33, 0.98, 2.22, 1.08, border=False)
ln([RX, RX + RW], [0.86, 0.86], RULE, 0.6)
t(RX, 0.58, "42.00 kHz", 12, NAVY, "bold"); t(RX + 1.02, 0.66, "centre frequency captured on-board", 7.6, INK); t(RX + 1.02, 0.47, "MCU ADC capture · FFT peak", 7.2, GRAY)
ln([RX + 3.12, RX + 3.12], [0.32, 0.8], RULE, 0.6)
t(RX + 3.25, 0.58, "0", 12, NAVY, "bold"); t(RX + 3.45, 0.66, "DMA underruns", 7.6, INK); t(RX + 3.45, 0.47, "DAC streaming · 1 MS/s", 7.2, GRAY)

# main flow between the three zones
for x1, x2 in ((SX + SW + 0.05, CX - 0.08), (CX + CW + 0.05, RX - 0.08)):
    arr(x1, 5.42, x2, 5.42, NAVY, 0.9)
fig.savefig(HERE / "AquaSDR_slide3_flow.png", transparent=True)
im = Image.open(HERE / "AquaSDR_slide3_flow.png"); im = im.crop(im.getbbox())
out = Image.new("RGBA", (im.width + 30, im.height + 30), (0, 0, 0, 0)); out.paste(im, (15, 15)); out.save(HERE / "AquaSDR_slide3_flow.png")
bg = Image.new("RGBA", out.size, "white"); bg.alpha_composite(out); bg.convert("RGB").save("/private/tmp/claude-501/-Users-sudharsan-Downloads-AquaSDR/974881d6-97cd-49b8-a6c0-c2de9a3acebd/scratchpad/flow_preview.png")
