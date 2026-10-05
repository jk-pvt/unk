#!/usr/bin/env python3
"""AquaSDR hardware architecture with real component pictures and logical links (no wiring), for slide 3.
Component graphics: Fritzing parts (STM32 Nucleo, HC-SR04) and the Adafruit Fritzing Library (BMP390, INA219, 1.8" TFT,
DS18B20 probe), CC BY-SA 3.0; downloaded to docs/deck/img/parts/raw. TDS board, TDS probe, turbidity and pressure sensor
are crops of the team's own photos (no open graphic exists). The analog stage is drawn from the team's own schematic.
Pins and buses are those in arduino/05_sensors_adaptive_tx. Writes docs/deck/AquaSDR_hardware_architecture.png.
"""
import pathlib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Rectangle
from PIL import Image

HERE = pathlib.Path(__file__).parent
P = HERE / "img" / "parts"
plt.rcParams["font.family"] = ["Arial", "Helvetica", "DejaVu Sans"]
NAVY, TEAL, LAV, CHAR, GRAY, RULE = "#183153", "#3B8C7A", "#8A7BAF", "#263238", "#667085", "#D0D5DD"

W, H = 16.0, 7.0
fig = plt.figure(figsize=(W, H), dpi=250)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, W); ax.set_ylim(0, H); ax.axis("off")

def place(path, x, y, w, h, border=None, rotate=0, align="center"):
    """Fit an image inside box (x, y, w, h), keeping its aspect ratio. Returns the drawn extent."""
    im = Image.open(path).convert("RGBA")
    if rotate: im = im.rotate(rotate, expand=True, fillcolor=(255, 255, 255, 0))
    a = im.width / im.height
    dw, dh = (w, w / a) if w / a <= h else (h * a, h)
    dx = x + (w - dw) / 2 if align == "center" else x
    dy = y + (h - dh) / 2
    ax.imshow(im, extent=(dx, dx + dw, dy, dy + dh), zorder=3, interpolation="lanczos")
    if border: ax.add_patch(Rectangle((dx, dy), dw, dh, fill=False, ec=border, lw=0.9, zorder=4))
    return dx, dy, dw, dh

def txt(x, y, s, size=9, color=CHAR, weight="normal", ha="left", va="center", style="normal"):
    ax.text(x, y, s, fontsize=size, color=color, fontweight=weight, ha=ha, va=va, style=style, zorder=8)

def line(pts, color=NAVY, lw=1.6, ls="-", arrow=False):
    xs, ys = zip(*pts)
    ax.plot(xs, ys, color=color, lw=lw, ls=ls, zorder=5, solid_capstyle="round", solid_joinstyle="round")
    if arrow:
        (x1, y1), (x2, y2) = pts[-2], pts[-1]
        ax.annotate("", xy=(x2, y2), xytext=(x1 + (x2 - x1) * 0.6, y1 + (y2 - y1) * 0.6),
                    arrowprops=dict(arrowstyle="-|>", color=color, lw=lw, mutation_scale=12), zorder=6)

def pill(x, y, s, color=NAVY, size=7.4):
    ax.text(x, y, s, fontsize=size, color=color, fontweight="bold", ha="center", va="center", zorder=9,
            bbox=dict(boxstyle="round,pad=0.28,rounding_size=0.5", fc="white", ec=color, lw=0.9))

def box(x, y, w, h, color=NAVY, ls="-", fill="white", lw=1.0):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.06", fc=fill, ec=color, lw=lw, ls=ls, zorder=2))

# ======================= STM32 (centre) =======================
NX, NY, NW = 6.0, 2.42, 3.6
nx, ny, nw, nh = place(P / "nucleo.png", NX, NY, NW, 3.2)
txt(nx + nw / 2, ny - 0.17, "STM32 NUCLEO-F446RE", 11, NAVY, "bold", "center")
txt(nx + nw / 2, ny - 0.42, "C/C++ firmware · adaptation policy · waveform engine", 8.2, GRAY, ha="center")

# ======================= TFT (top) =======================
tx, ty, tw, th = place(P / "tft18.png", 7.05, 5.95, 1.6, 0.98)
line([(tx + tw / 2, ty), (tx + tw / 2, ny + nh)], NAVY)
pill(tx + tw / 2, (ty + ny + nh) / 2, "SPI · D10 / D11 / D13")
txt(tx + tw + 0.12, ty + th / 2 + 0.12, "1.8″ TFT status display", 8.6, NAVY, "bold")
txt(tx + tw + 0.12, ty + th / 2 - 0.12, "live telemetry pages", 7.8, GRAY)

# ======================= SENSORS (left) =======================
rows = [  # (images, name, note, bus, row y, entry y into the board, trunk x, color)
    ([("turbidity.jpg", 0.0, 1.0)], "Turbidity sensor", "water clarity", "ANALOG · PB0", 6.25, nY := ny + nh * 0.86, 5.62, TEAL),
    ([("tds_board.jpg", 0.0, 0.62), ("tds_probe.jpg", 0.64, 0.36)], "TDS / salinity proxy", "TDS meter board + probe", "ANALOG · A0 → policy", 5.15, ny + nh * 0.70, 5.42, TEAL),
    ([("pressure.jpg", 0.0, 1.0)], "Pressure / depth", "pressure transducer", "ANALOG · PA1", 4.05, ny + nh * 0.52, 5.22, TEAL),
    ([("ds18b20.png", 0.0, 1.0)], "DS18B20", "water temperature", "1-WIRE · PC1", 2.95, None, None, NAVY),
    ([("hcsr04.png", 0.0, 1.0)], "HC-SR04", "air range", "GPIO · D7 / D8", 1.85, ny + nh * 0.12, 5.02, NAVY),
]
IX, IW, IH = 0.25, 1.40, 0.82
for imgs, name, note, bus, ry, entry, trunk, col in rows:
    for f, off, frac in imgs:
        rot = 90 if f == "ds18b20.png" else 0
        photo = f.endswith(".jpg")
        place(P / f, IX + off * IW, ry - IH / 2, IW * frac - (0.02 if len(imgs) > 1 else 0), IH, border=NAVY if photo else None, rotate=rot)
    txt(1.78, ry + 0.11, name, 9, NAVY, "bold")
    txt(1.78, ry - 0.13, note, 7.8, GRAY)
    x0 = 3.45
    if entry is None:                      # straight into the board
        line([(x0, ry), (NX + 0.12, ry)], col); pill(4.35, ry, bus, col)
    else:
        line([(x0, ry), (trunk, ry), (trunk, entry), (NX + 0.12, entry)], col); pill(4.35, ry, bus, col)
txt(0.25, 6.86, "SENSE", 10, TEAL, "bold"); txt(0.92, 6.86, "real water-condition inputs", 8.4, GRAY)

# ======================= I²C bus (bottom) =======================
BY = 0.28
bx1 = place(P / "bmp390.png", 5.75, BY, 1.25, 0.8)
box(7.25, BY + 0.05, 1.25, 0.72, NAVY)
txt(7.875, BY + 0.53, "IMU", 9, NAVY, "bold", "center")
txt(7.875, BY + 0.30, "ISM330DHCX", 7.4, GRAY, ha="center"); txt(7.875, BY + 0.14, "+ MMC5983MA", 7.4, GRAY, ha="center")
bx3 = place(P / "ina219.png", 8.75, BY, 1.2, 0.86)
BUSY = 1.42
line([(6.37, BUSY), (9.85, BUSY)], NAVY)
for cx in (6.37, 7.875, 9.35): line([(cx, BUSY), (cx, BY + 0.82)], NAVY)
line([(9.85, BUSY), (9.85, ny + 0.25), (nx + nw - 0.05, ny + 0.25)], NAVY)
pill(8.6, BUSY, "I²C · PB8 / PB9")
txt(6.37, BY - 0.12, "BMP390 cabin pressure", 7.4, GRAY, ha="center")
txt(9.35, BY - 0.12, "INA219 ×2 power monitor", 7.4, GRAY, ha="center")

# ======================= OUTPUT (right) =======================
DY_ = ny + nh * 0.62
box(10.55, DY_ - 0.68, 3.05, 1.42, LAV, ls=(0, (4, 2.5)))
place(P.parent / "afe_chain.png", 10.62, DY_ - 0.34, 2.05, 0.75)
txt(12.72, DY_ + 0.38, "Analog front end", 8.8, NAVY, "bold")
txt(12.72, DY_ + 0.14, "Sallen-Key LPF", 7.6, GRAY); txt(12.72, DY_ - 0.06, "70.7 kHz", 7.6, GRAY); txt(12.72, DY_ - 0.26, "TLV9062 ×1.5", 7.6, GRAY)
txt(10.62, DY_ + 0.6, "designed stage", 7.0, LAV, style="italic")
line([(nx + nw - 0.08, DY_), (10.55, DY_)], NAVY, lw=2.2, arrow=True)
pill(10.07, DY_ + 0.36, "TIM6 + DMA\nDAC1 · PA4", NAVY, 7.0)
box(13.95, DY_ - 0.42, 1.85, 0.9, LAV, ls=(0, (4, 2.5)))
txt(14.875, DY_ + 0.18, "Output", 8.8, NAVY, "bold", "center")
txt(14.875, DY_ - 0.05, "transducer ·", 7.6, GRAY, ha="center"); txt(14.875, DY_ - 0.24, "oscilloscope", 7.6, GRAY, ha="center")
line([(13.6, DY_), (13.95, DY_)], NAVY, lw=2.2, arrow=True)
# self-validation capture loop
CY = DY_ - 0.95
line([(10.25, DY_), (10.25, CY), (nx + nw - 0.08, CY)], NAVY, lw=1.3, ls=(0, (3, 2)), arrow=True)
pill(11.75, CY, "PA4 → A5 · ADC3 + DMA capture", NAVY, 7.0)

# console over USB
UY = ny + nh * 0.13
cx_, cy_, cw_, ch_ = place(HERE.parent / "assets" / "prototype-mission.png", 10.95, 0.55, 2.9, 1.7, border=NAVY)
line([(nx + nw - 0.08, UY), (10.62, UY), (10.62, cy_ + ch_ / 2), (10.95, cy_ + ch_ / 2)], "#7A8494", lw=1.6, arrow=True)
pill(10.05, UY + 0.24, "USB · UART JSON", "#4D5869", 7.0)
txt(cx_ + cw_ + 0.12, cy_ + ch_ - 0.2, "Mission console", 8.8, NAVY, "bold")
txt(cx_ + cw_ + 0.12, cy_ + ch_ - 0.45, "React + Node.js", 7.6, GRAY)
txt(cx_ + cw_ + 0.12, cy_ + ch_ - 0.67, "FFT · spectrogram", 7.6, GRAY)
txt(cx_ + cw_ + 0.12, cy_ + ch_ - 0.89, "evidence · control", 7.6, GRAY)

# payload (top right)
px, py, pw, ph = place(HERE / "img" / "payload.jpg", 10.55, 5.5, 5.25, 1.25, border=NAVY)
txt(px, py + ph + 0.14, "AQUASDR PAYLOAD", 9, NAVY, "bold"); txt(px + 1.42, py + ph + 0.14, "everything above is housed in this acrylic hull", 8, GRAY)

txt(15.8, 0.08, "Board graphics: Fritzing parts and Adafruit Fritzing Library (CC BY-SA 3.0) · photos: our AquaSDR hardware", 6.4, "#98A2B3", ha="right", va="bottom")
fig.savefig(HERE / "AquaSDR_hardware_architecture.png", dpi=250, facecolor="white")
print("wrote", HERE / "AquaSDR_hardware_architecture.png")
