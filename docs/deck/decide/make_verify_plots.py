#!/usr/bin/env python3
"""VERIFY card plots from a real MCU ADC capture: data/bench capture 7 (CLEAR LFM, Hann, raw DAC tap, 500 kS/s, 6000 samples).
This is the board sampling its own DAC pin (PA4 -> A5/PC0, ADC3 IN10), not an oscilloscope. Writes verify_plots.png."""
import numpy as np, matplotlib, pathlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image
plt.rcParams["font.family"] = ["Arial", "Helvetica", "DejaVu Sans"]
NAVY, GRAY, RULE, BLUE, TEAL = "#183153", "#667085", "#D0D5DD", "#2F6BD8", "#3B8C7A"
csv = pathlib.Path(__file__).parents[3] / "data/bench/mcu-20261002064939-7-pulse.csv"
d = np.genfromtxt([l for l in open(csv) if not l.startswith("#")], delimiter=",", names=True)
fs = 500e3; t = d["time_s"] * 1e3; v = d["volts"] - d["volts"].mean()

fig = plt.figure(figsize=(6.8, 3.9), dpi=300)
def style(a, title, note=""):
    a.set_title(title, loc="left", fontsize=8, color=NAVY, fontweight="bold", pad=4)
    if note: a.text(1, 1.02, note, transform=a.transAxes, ha="right", va="bottom", fontsize=6, color=GRAY)
    for s in a.spines.values(): s.set_color(RULE)
    a.tick_params(labelsize=6, colors=GRAY, length=2); a.xaxis.label.set(size=6.5, color=GRAY); a.yaxis.label.set(size=6.5, color=GRAY)
# time domain (first 3 ms: burst starts 0.49 ms)
a = fig.add_axes([0.07, 0.60, 0.91, 0.31]); m = t <= 3
a.plot(t[m], v[m], color=BLUE, lw=0.35); a.set_xlim(0, 3); a.set_ylabel("V (AC)"); a.set_xlabel("Time (ms)", labelpad=1)
style(a, "Time domain · CLEAR LFM, Hann", "500 kS/s · 6000 samples · 12 ms record (first 3 ms shown)")
# spectrum of the record
n = 1 << 16; S = np.abs(np.fft.rfft(v, n)); f = np.fft.rfftfreq(n, 1 / fs) / 1e3
db = 20 * np.log10(S / S.max() + 1e-12)
a = fig.add_axes([0.07, 0.09, 0.40, 0.36]); k = (f >= 30) & (f <= 54)
a.axvspan(40, 44, color=TEAL, alpha=0.12, lw=0); a.plot(f[k], db[k], color=NAVY, lw=0.8)
import json; pk = json.load(open(str(csv)[:-4] + ".json"))["measured"]["peakKHz"]  # recorded analysis value
a.annotate(f"{pk:.2f} kHz", (pk, 0), xytext=(pk + 2.2, -6), fontsize=6.5, color=NAVY, fontweight="bold", va="center")
a.set_xlim(30, 54); a.set_ylim(-70, 5); a.set_xlabel("Frequency (kHz)", labelpad=1); a.set_ylabel("dB")
style(a, "Spectrum (FFT)", "shaded: planned 40–44 kHz")
# spectrogram (0–3 ms)
a = fig.add_axes([0.56, 0.09, 0.42, 0.36])
seg, hop, nfft = 400, 4, 4096; w = np.hanning(seg); idx = range(0, int(3e-3 * fs) - seg, hop)
Z = np.array([np.abs(np.fft.rfft(v[i:i + seg] * w, nfft)) for i in idx]).T
ff = np.fft.rfftfreq(nfft, 1 / fs) / 1e3; tt = (np.array(list(idx)) + seg / 2) / fs * 1e3
Zd = 20 * np.log10(Z / Z.max() + 1e-12); kk = (ff >= 37) & (ff <= 47)
a.pcolormesh(tt, ff[kk], Zd[kk], shading="auto", cmap="Blues", vmin=-40, vmax=0, rasterized=True)
a.set_xlim(0, 3); a.set_xlabel("Time (ms)", labelpad=1); a.set_ylabel("kHz")
style(a, "Spectrogram", "40 → 44 kHz sweep")
fig.savefig("verify_plots.png", transparent=True)
im = Image.open("verify_plots.png"); im = im.crop(im.getbbox()); out = Image.new("RGBA", (im.width + 24, im.height + 24), (0, 0, 0, 0)); out.paste(im, (12, 12)); out.save("verify_plots.png")
print("peak", round(pk, 2))
