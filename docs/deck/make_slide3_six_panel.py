#!/usr/bin/env python3
"""Slide 3 six-panel architecture, corrected after the PS / evidence audit.
Real assets only: team photos (sensors.jpg, IMG_9630), MCU ADC capture 7 (CLEAR LFM, Hann, raw DAC tap, 500 kS/s).
Water-condition thumbnails are cropped from the team's existing slide image (illustrative, labelled by profile only).
Analog stage and transducer drawn dashed (designed / next). No oscilloscope claim. Writes AquaSDR_slide3_six_panel.png."""
import json, pathlib, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyBboxPatch, Polygon
from PIL import Image, ImageOps
HERE = pathlib.Path(__file__).parent; IMG = HERE / "img"; ROOT = HERE.parents[1]
plt.rcParams["font.family"] = ["Arial", "Helvetica", "DejaVu Sans"]
NAVY, INK, GRAY, RULE, CARD, BLUE, TEAL, LAV = "#183153", "#263238", "#5B6474", "#C9D0DA", "#F7F9FB", "#2F6BD8", "#3B8C7A", "#7A6BA8"
W, H = 18.09, 5.43
fig = plt.figure(figsize=(W, H), dpi=240)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, W); ax.set_ylim(0, H); ax.axis("off")
def t(x, y, s, size=9, color=INK, weight="normal", ha="left", va="center", style="normal"):
    ax.text(x, y, s, fontsize=size, color=color, fontweight=weight, ha=ha, va=va, style=style, linespacing=1.2, zorder=8)
def box(x, y, w, h, ec=RULE, fc="white", ls="-", lw=0.8, r=0.05):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}", fc=fc, ec=ec, lw=lw, ls=ls, zorder=3))
def arr(x1, y1, x2, y2, c=NAVY, lw=0.9):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1), arrowprops=dict(arrowstyle="-|>", color=c, lw=lw, mutation_scale=8, shrinkA=0, shrinkB=0), zorder=9)
def place(im, x, y, w, h, border=True):
    if not isinstance(im, Image.Image): im = Image.open(im)
    im = im.convert("RGBA"); a = im.width / im.height
    dw, dh = (w, w / a) if w / a <= h else (h * a, h); dx, dy = x + (w - dw) / 2, y + (h - dh) / 2
    ax.imshow(im, extent=(dx, dx + dw, dy, dy + dh), zorder=4, interpolation="lanczos")
    if border: ax.add_patch(Rectangle((dx, dy), dw, dh, fill=False, ec=NAVY, lw=0.6, zorder=5))
    return dx, dy, dw, dh
def inset(x, y, w, h):
    a = fig.add_axes([x / W, y / H, w / W, h / H]); return a

TOP, BOT = H - 0.04, 0.04
widths = [2.25, 2.72, 2.33, 2.76, 2.59, 5.0]; GAP = 0.08
xs = [0.02]
for w in widths[:-1]: xs.append(xs[-1] + w + GAP)
heads = [("1  Water conditions", "three transmit profiles"), ("2  Environmental sensing", "real sensors on the payload"),
         ("3  Adaptation", "runs on the STM32"), ("4  Waveform generation", "C firmware · timer + DMA"),
         ("5  DAC and analog stage", "digital samples → analog"), ("6  On-board validation", "the board sampling its own DAC output · not a simulation")]
for (x, w), (a, b) in zip(zip(xs, widths), heads):
    box(x, BOT, w, TOP - BOT, ec=RULE, fc=CARD, r=0.06)
    t(x + 0.14, TOP - 0.22, a, 11.5, NAVY, "bold"); t(x + 0.14, TOP - 0.47, b, 9, GRAY)
    ax.plot([x + 0.14, x + w - 0.14], [TOP - 0.66] * 2, color=RULE, lw=0.7, zorder=4)
for i in range(5):
    xa = xs[i] + widths[i]; arr(xa - 0.02, 2.75, xa + GAP + 0.02, 2.75)

# ---- 1 water conditions (thumbnails cropped from the team's slide image) ----
src = Image.open(pathlib.Path("/private/tmp/claude-501/-Users-sudharsan-Downloads-AquaSDR/974881d6-97cd-49b8-a6c0-c2de9a3acebd/scratchpad/deck/s3_Freeform18.png")).convert("RGB")
crops = [(30, 90, 163, 212), (30, 236, 163, 358), (30, 381, 163, 503)]
prof = [("CLEAR", "#4C86B8", "42 kHz · 4 kHz", "2 ms · 35 %"), ("TRANSITION", "#4F9A8C", "40 kHz · 2 kHz", "4 ms · 50 %"), ("MURKY", "#A88B66", "38 kHz · 1 kHz", "8 ms · 62 %")]
x0 = xs[0]
for i, (c, (name, col, l1, l2)) in enumerate(zip(crops, prof)):
    y = 3.62 - i * 1.30
    place(src.crop(c), x0 + 0.14, y, 1.0, 0.95)
    t(x0 + 1.25, y + 0.72, name, 9.5, col, "bold"); t(x0 + 1.25, y + 0.45, l1, 8.6, INK); t(x0 + 1.25, y + 0.22, l2, 8.6, INK)
t(x0 + 0.14, 0.22, "centre · bandwidth · pulse · amplitude", 7.6, GRAY)

# ---- 2 sensing (real photo) ----
x0, w0 = xs[1], widths[1]
place(IMG / "sensors.jpg", x0 + 0.12, 2.55, 1.22, 2.1)
rows = [("TDS / salinity proxy", "A0 · ADC · drives policy", True), ("Turbidity", "PB0 · ADC", False), ("Pressure / depth", "PA1 · ADC", False),
        ("DS18B20 temperature", "PC1 · 1-Wire", False), ("HC-SR04 · air range", "D7 / D8 · GPIO", False)]
for i, (a, b, hot) in enumerate(rows):
    y = 4.52 - i * 0.43
    t(x0 + 1.42, y + 0.08, a, 8.4, TEAL if hot else NAVY, "bold"); t(x0 + 1.42, y - 0.11, b, 7.6, TEAL if hot else GRAY)
ax.plot([x0 + 0.14, x0 + w0 - 0.14], [2.25] * 2, color=RULE, lw=0.6, zorder=4)
t(x0 + 0.14, 2.02, "Also on I²C", 8.6, NAVY, "bold")
t(x0 + 0.14, 1.80, "BMP390 cabin pressure", 8, INK); t(x0 + 0.14, 1.61, "IMU ISM330DHCX + MMC5983MA", 8, INK); t(x0 + 0.14, 1.42, "INA219 ×2 power monitor", 8, INK)
ax.plot([x0 + 0.14, x0 + w0 - 0.14], [1.24] * 2, color=RULE, lw=0.6, zorder=4)
t(x0 + 0.14, 1.02, "Current adaptive path: A0 TDS proxy.", 8.4, NAVY, "bold")
t(x0 + 0.14, 0.78, "Other sensors are read and logged;", 8.2, GRAY); t(x0 + 0.14, 0.58, "multi-sensor fusion is future work.", 8.2, GRAY)

# ---- 3 adaptation ----
x0, w0 = xs[2], widths[2]
steps = [("Read A0", "TDS / salinity proxy"), ("Validate", "reject stale / out-of-range"), ("Smooth", "EMA α = 0.25 + hysteresis"),
         ("Select profile", "Clear · Transition · Murky"), ("Set next ping", "centre · BW · pulse · amplitude")]
for i, (a, b) in enumerate(steps):
    y = 4.08 - i * 0.80; bw = w0 - 0.36
    box(x0 + 0.18, y - 0.30, bw, 0.62, ec=NAVY if i == 4 else RULE, lw=0.9 if i == 4 else 0.8)
    t(x0 + 0.18 + bw / 2, y + 0.10, a, 9.6, NAVY, "bold", "center"); t(x0 + 0.18 + bw / 2, y - 0.14, b, 8.2, GRAY, ha="center")
    if i < 4: arr(x0 + w0 / 2, y - 0.31, x0 + w0 / 2, y - 0.48)
t(x0 + w0 / 2, 0.40, "qualified change → applied", 7.9, NAVY, "bold", "center"); t(x0 + w0 / 2, 0.22, "at the next pulse boundary", 7.9, NAVY, "bold", "center")

# ---- 4 waveform generation ----
x0, w0 = xs[3], widths[3]
tt = np.linspace(0, 1, 1000); hann = np.sin(np.pi * tt) ** 2
code = np.array([1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1]); chip = code[np.minimum((tt * 13).astype(int), 12)]
waves = [("LFM chirp", hann * np.sin(2 * np.pi * (5 * tt + 7 * tt ** 2)), None), ("Geometric", hann * np.sin(2 * np.pi * 1.0 * (np.exp(3.0 * tt) - 1)), None), ("Barker-13", None, chip)]
ww = (w0 - 0.36) / 3
for i, (name, sig, cd) in enumerate(waves):
    xx = x0 + 0.14 + i * (ww + 0.04)
    box(xx, 3.62, ww, 1.02)
    t(xx + ww / 2, 4.47, name, 8.6, NAVY, "bold", "center")
    a = inset(xx + 0.06, 3.70, ww - 0.12, 0.62); a.axis("off"); a.set_ylim(-1.2, 1.2)
    if cd is None: a.plot(tt, sig, color=BLUE, lw=0.6)
    else: a.step(tt, cd * 0.85, color=BLUE, lw=0.9, where="post")
t(x0 + 0.14, 3.38, "Windows: Hann · Hamming · Blackman", 8.6, INK)
box(x0 + 0.14, 0.18, w0 - 0.28, 2.95, ec=NAVY, lw=0.9)
t(x0 + 0.28, 2.88, "Buffer → TIM6 + DMA → DAC", 9.8, NAVY, "bold")
lines = ["Precomputed waveform buffer", "DDS-based synthesis between pings", "Two-buffer pulse scheduling", "next pulse built in the spare buffer",
         "TIM6 → DMA1 → 12-bit DAC1", "1 MS/s configured sample rate", "No per-sample CPU work during DMA", "bare-metal build sleeps with WFI"]
for i, s in enumerate(lines):
    t(x0 + 0.28, 2.55 - i * 0.285, s, 8.4, INK if i % 2 == 0 else GRAY, "bold" if i % 2 == 0 else "normal")

# ---- 5 DAC and analog stage ----
x0, w0 = xs[4], widths[4]
im = ImageOps.exif_transpose(Image.open(IMG / "src" / "IMG_9630.jpg")).convert("RGB"); k = im.width / 500
im = im.crop((int(82 * k), int(58 * k), int(262 * k), int(150 * k))); im.thumbnail((1200, 1200))
place(im, x0 + 0.14, 3.60, w0 - 0.28, 1.08)
t(x0 + w0 / 2, 3.45, "STM32 NUCLEO-F446RE (our payload)", 8.2, NAVY, "bold", "center")
chain = [("DAC output · PA4", "12-bit · 1 MS/s · on-chip", "-", "BUILT"), ("Low-pass filter", "2nd-order Sallen-Key · 70.7 kHz", "--", "DESIGNED"),
         ("TLV9062 op-amp", "gain ×1.5", "--", "DESIGNED"), ("Transducer", "sonar output", "--", "NEXT")]
for i, (a, b, ls, st) in enumerate(chain):
    y = 2.88 - i * 0.74; bw = w0 - 0.28
    box(x0 + 0.14, y - 0.30, bw, 0.58, ec=NAVY if ls == "-" else LAV, ls=(0, (3, 2)) if ls == "--" else "-", lw=0.9)
    t(x0 + 0.26, y + 0.08, a, 9.2, NAVY, "bold"); t(x0 + 0.26, y - 0.14, b, 7.9, GRAY)
    t(x0 + 0.14 + bw - 0.1, y + 0.08, st, 7.2, NAVY if st == "BUILT" else LAV, "bold", "right")
    if i < 3: arr(x0 + w0 / 2, y - 0.31, x0 + w0 / 2, y - 0.44)

# ---- 6 validation: real capture 7 ----
x0, w0 = xs[5], widths[5]
csv = ROOT / "data/bench/mcu-20261002064939-7-pulse.csv"
d = np.genfromtxt([l for l in open(csv) if not l.startswith("#")], delimiter=",", names=True)
fs = 500e3; tm = d["time_s"] * 1e3; v = d["volts"] - d["volts"].mean()
rec = json.load(open(str(csv)[:-4] + ".json"))["measured"]
def sty(a, title):
    a.set_title(title, loc="left", fontsize=10, color=NAVY, fontweight="bold", pad=3)
    for sp in a.spines.values(): sp.set_color(RULE)
    a.tick_params(labelsize=8, colors=GRAY, length=2, pad=1.5); a.set_facecolor("white")
a = inset(x0 + 0.48, 3.30, w0 - 0.66, 1.05); m = tm <= 3
a.plot(tm[m], v[m], color=BLUE, lw=0.35); a.set_xlim(0, 3); a.set_yticks([]); a.set_xlabel("time (ms)", fontsize=8, color=GRAY, labelpad=0)
sty(a, "Time domain · CLEAR LFM, Hann · 2 ms pulse")
n = 1 << 16; S = np.abs(np.fft.rfft(v, n)); f = np.fft.rfftfreq(n, 1 / fs) / 1e3; db = 20 * np.log10(S / S.max() + 1e-12); kk = (f >= 34) & (f <= 50)
pw = (w0 - 1.25) / 2
a = inset(x0 + 0.55, 1.60, pw, 1.22)
a.axvspan(40, 44, color=TEAL, alpha=0.15, lw=0); a.plot(f[kk], db[kk], color=NAVY, lw=0.9); a.set_xlim(34, 50); a.set_ylim(-50, 5)
a.set_xticks([36, 40, 44, 48]); a.set_xlabel("kHz", fontsize=8, color=GRAY, labelpad=0); a.set_ylabel("dB", fontsize=8, color=GRAY, labelpad=0); sty(a, "FFT")
a.text(0.03, 0.88, f'peak\n{rec["peakKHz"]:.2f} kHz', transform=a.transAxes, ha="left", va="top", fontsize=8.5, color=NAVY, fontweight="bold")
a.text(42, -46, "40–44", ha="center", fontsize=7.5, color=TEAL, fontweight="bold")
# instantaneous frequency of the captured chirp (analytic signal, band-limited 30-55 kHz), shown where the envelope > 30 %
nn = v.size; V = np.fft.fft(v); fq = np.fft.fftfreq(nn, 1 / fs); V[(np.abs(fq) < 30e3) | (np.abs(fq) > 55e3)] = 0
hh = np.zeros(nn); hh[0] = 1; hh[1:nn // 2] = 2; hh[nn // 2] = 1
z = np.fft.ifft(V * hh); env = np.abs(z); inst = np.diff(np.unwrap(np.angle(z))) * fs / (2 * np.pi) / 1e3
inst = np.convolve(inst, np.ones(50) / 50, mode="same"); ti = np.arange(nn - 1) / fs * 1e3; keep = env[:-1] > 0.3 * env.max()
slope = np.polyfit(ti[keep], inst[keep], 1)[0]
# real STFT of the capture, each time column normalised to its own peak so the sweep ridge is visible
seg, hop, nfft = 256, 4, 8192; win = np.hanning(seg); idx = list(range(0, int(3e-3 * fs) - seg, hop))
Z = np.array([np.abs(np.fft.rfft(v[i:i + seg] * win, nfft)) for i in idx]).T; ff = np.fft.rfftfreq(nfft, 1 / fs) / 1e3; tc = (np.array(idx) + seg / 2) / fs * 1e3
colmax = Z.max(axis=0); live = colmax > 0.25 * colmax.max()
Zn = np.where(live, Z / np.maximum(colmax, 1e-12), 0); sel = (ff >= 36) & (ff <= 48)
a = inset(x0 + 0.55 + pw + 0.55, 1.60, pw, 1.22)
a.pcolormesh(tc, ff[sel], 20 * np.log10(Zn[sel] + 1e-6), shading="auto", cmap="Blues", vmin=-12, vmax=0, rasterized=True)
a.set_xlim(0, 2.6); a.set_ylim(36, 48); a.set_yticks([38, 40, 42, 44, 46])
a.set_xlabel("time (ms)", fontsize=8, color=GRAY, labelpad=0); a.set_ylabel("kHz", fontsize=8, color=GRAY, labelpad=0)
a.text(0.97, 0.06, f"slope {slope:.2f} kHz/ms · calc. 2.00", transform=a.transAxes, fontsize=7.4, color=NAVY, fontweight="bold", ha="right")
a.text(0.03, 0.93, "per-column normalised", transform=a.transAxes, fontsize=6.6, color=GRAY, va="top")
sty(a, "Spectrogram (captured)")
t(x0 + 0.14, 1.12, "PA4 → A5 jumper → ADC3 + DMA2 · 500 kS/s · 6000 samples · 12 ms", 8.2, GRAY)
ax.plot([x0 + 0.14, x0 + w0 - 0.14], [0.96] * 2, color=RULE, lw=0.6, zorder=4)
t(x0 + 0.14, 0.70, f'{rec["peakKHz"]:.2f} kHz', 15, NAVY, "bold"); t(x0 + 1.45, 0.80, "centre captured, matches calculated", 9, INK); t(x0 + 1.45, 0.59, f"sweep slope {slope:.2f} kHz/ms vs 2.00 calculated", 8.6, GRAY)
t(x0 + 0.14, 0.25, "External oscilloscope validation: pending", 8.6, LAV, "bold")

out = HERE / "AquaSDR_slide3_six_panel.png"
fig.savefig(out, facecolor="white"); print("wrote", out)
