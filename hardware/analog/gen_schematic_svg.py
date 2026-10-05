#!/usr/bin/env python3
"""Draws aquasdr_afe_schematic.svg from the component values in design_afe.py.
The editable electrical source of truth is aquasdr_afe.cir / aquasdr_afe.net; this is the human-readable drawing."""
import pathlib
from design_afe import PARTS, fmt_val, FC, Q, VCC

OUT = pathlib.Path(__file__).parent
el = []
INK = "#1b2230"; NET = "#0b6e4f"; TPC = "#b45309"


def add(s): el.append(s)
def wire(*pts):
    add('<polyline fill="none" stroke="%s" stroke-width="2" points="%s"/>' % (INK, " ".join(f"{x},{y}" for x, y in pts)))
def dot(x, y): add(f'<circle cx="{x}" cy="{y}" r="3.5" fill="{INK}"/>')
def text(x, y, s, size=13, color=INK, anchor="middle", weight="400"):
    add(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" text-anchor="{anchor}" font-weight="{weight}" font-family="IBM Plex Mono, Menlo, monospace">{s}</text>')
def val(ref):
    v, kind, _ = PARTS[ref]; return fmt_val(v, kind) + ("Ω" if kind == "R" else "F")

def res_h(x, y, ref):  # body spans x-30..x+30
    wire((x - 40, y), (x - 30, y)); wire((x + 30, y), (x + 40, y))
    add(f'<rect x="{x-30}" y="{y-9}" width="60" height="18" fill="none" stroke="{INK}" stroke-width="2"/>')
    text(x, y - 15, f"{ref} {val(ref)}")
def res_v(x, y, ref, side="r"):
    wire((x, y - 40), (x, y - 30)); wire((x, y + 30), (x, y + 40))
    add(f'<rect x="{x-9}" y="{y-30}" width="18" height="60" fill="none" stroke="{INK}" stroke-width="2"/>')
    text(x + (16 if side == "r" else -16), y + 4, f"{ref} {val(ref)}", anchor="start" if side == "r" else "end")
def cap_h(x, y, ref):
    wire((x - 40, y), (x - 6, y)); wire((x + 6, y), (x + 40, y))
    add(f'<line x1="{x-6}" y1="{y-16}" x2="{x-6}" y2="{y+16}" stroke="{INK}" stroke-width="3"/><line x1="{x+6}" y1="{y-16}" x2="{x+6}" y2="{y+16}" stroke="{INK}" stroke-width="3"/>')
    text(x, y - 24, f"{ref} {val(ref)}")
def cap_v(x, y, ref, side="r"):
    wire((x, y - 40), (x, y - 6)); wire((x, y + 6), (x, y + 40))
    add(f'<line x1="{x-16}" y1="{y-6}" x2="{x+16}" y2="{y-6}" stroke="{INK}" stroke-width="3"/><line x1="{x-16}" y1="{y+6}" x2="{x+16}" y2="{y+6}" stroke="{INK}" stroke-width="3"/>')
    text(x + (24 if side == "r" else -24), y + 4, f"{ref} {val(ref)}", anchor="start" if side == "r" else "end")
def gnd(x, y):
    wire((x, y), (x, y + 6))
    for i, w in enumerate((14, 9, 4)):
        add(f'<line x1="{x-w}" y1="{y+6+i*5}" x2="{x+w}" y2="{y+6+i*5}" stroke="{INK}" stroke-width="2"/>')
def label(x, y, name, anchor="middle"): text(x, y, name, 12, NET, anchor, "600")
def tp(x, y, name):
    add(f'<circle cx="{x}" cy="{y}" r="6" fill="#fff7ed" stroke="{TPC}" stroke-width="2"/>')
    text(x, y - 12, name, 12, TPC, "middle", "700")
def opamp(x0, y, ref, plus_top=True, pins=""):
    add(f'<polygon points="{x0},{y-38} {x0},{y+38} {x0+100},{y}" fill="#f8fafc" stroke="{INK}" stroke-width="2"/>')
    up, dn = ("+", "−") if plus_top else ("−", "+")
    text(x0 + 11, y - 11, up, 16, INK, "middle", "700"); text(x0 + 11, y + 21, dn, 16, INK, "middle", "700")
    text(x0 + 40, y + 4, ref, 13, INK, "middle", "700")
    if pins: text(x0 + 40, y + 20, pins, 10, "#64748b")

W, H = 1760, 580
add(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')
text(24, 30, "AquaSDR analog front end · PA4 → 2nd-order Sallen-Key LPF → gain ×1.5 → scope", 17, INK, "start", "700")
text(24, 50, f"Butterworth fc ≈ {FC/1e3:.1f} kHz (Q {Q:.2f}) · supply {VCC:g} V single · TLV9062 dual (U1A filter, U1B gain) · COMPUTED DESIGN, NOT A MEASUREMENT", 12, "#475569", "start")

HEAD = len(el)
# --- input and Sallen-Key
tp(70, 170, "TP1"); text(70, 148, "", 1)
wire((40, 170), (170 - 40, 170)); text(24, 190, "J1.1", 11, NET, "start"); label(100, 195, "DAC_PA4")
dot(70, 170)
res_h(170, 170, "R1"); wire((210, 170), (300, 170)); dot(300, 170); label(300, 195, "SK_A")
res_h(345, 170, "R2"); wire((385, 170), (440, 170)); dot(440, 170); label(430, 195, "SK_P", "end")
cap_v(440, 220, "C2", "l"); wire((440, 170), (440, 180)); gnd(440, 260)
wire((440, 170), (500, 170))
opamp(500, 185, "U1A", True, "1,2,3")
wire((600, 185), (620, 185)); dot(620, 185); wire((620, 185), (620, 240), (480, 240), (480, 200), (500, 200))
wire((300, 170), (300, 105)); cap_h(460, 105, "C1"); wire((300, 105), (420, 105)); wire((500, 105), (620, 105), (620, 185))
label(632, 212, "FILTER_OUT", "start"); tp(620, 185, "TP2"); 

# --- stage 2 coupling and bias
wire((620, 185), (640, 185)); cap_h(680, 185, "C3"); wire((720, 185), (780, 185)); dot(780, 185)
wire((780, 185), (780, 200), (840, 200)); label(765, 175, "B_IN", "end")
res_v(780, 250, "R9", "l"); wire((780, 280), (780, 292)); label(780, 308, "VMID")
# U1B: − on top (feedback), + on bottom (signal)
opamp(840, 185, "U1B", False, "5,6,7")
wire((940, 185), (975, 185)); dot(960, 185); tp(960, 185, "TP3"); label(968, 212, "OPAMP_OUT", "start")
wire((960, 185), (960, 95), (830, 95), (830, 170), (840, 170))
res_h(895, 95, "R5"); dot(830, 135); label(852, 135, "FB", "start")
wire((830, 135), (800, 135)); res_h(760, 135, "R6"); wire((720, 135), (710, 135), (710, 100)); cap_v(710, 70, "C5", "l"); gnd(710, 30 - 20 + 8)
# --- output
res_h(1010, 185, "R7"); wire((1050, 185), (1080, 185)); cap_h(1120, 185, "C6"); wire((1160, 185), (1230, 185)); dot(1190, 185)
label(1075, 165, "SCOPE_AC"); label(1198, 170, "SCOPE_OUT", "start"); text(1260, 190, "J3.1 → scope", 11, NET, "start"); text(1260, 206, "(AC-coupled)", 11, "#475569", "start")
wire((1190, 185), (1190, 220)); res_v(1190, 260, "R8", "r"); wire((1190, 300), (1190, 318)); label(1190, 336, "R8_RET", "middle")
text(1205, 352, "JP1: 1-2 GND (scope) · 2-3 VBIAS (MCU ADC tap)", 11, "#475569", "start")
# --- MCU ADC tap: SCOPE_OUT -> R10 -> ADC_IN (A5), VBIAS from the Nucleo 3V3 divider, D1 clamps
wire((1190, 185), (1190, 120), (1300, 120)); res_h(1340, 120, "R10"); wire((1380, 120), (1470, 120)); dot(1440, 120); label(1440, 98, "ADC_IN", "middle")
text(1480, 124, "J4.1 → Nucleo A5 (PC0)", 11, NET, "start")
text(1300, 70, "MCU ADC tap (A5 = ADC3 ch10)", 12, NET, "start", "700")
text(1300, 150, "D1 BAT54S: ADC_IN to GND and to 3V3", 11, "#475569", "start")
text(1300, 166, "VBIAS = R11/R12 from Nucleo 3V3 = 1.65 V, C9 100 nF", 11, "#475569", "start")

# --- bias divider & decoupling
wire((500, 300), (500, 320)); label(500, 292, "VCC"); res_v(500, 360, "R3", "l"); wire((500, 400), (500, 410)); dot(500, 410)
res_v(500, 450, "R4", "l"); wire((500, 490), (500, 498)); gnd(500, 496 - 0)
wire((500, 410), (560, 410)); cap_v(560, 450, "C4", "r"); gnd(560, 498 - 8); label(530, 405, "VMID", "middle")
wire((500, 410), (500, 410))
# supply decoupling
label(800, 392, "VCC"); wire((800, 400), (800, 410)); cap_v(800, 450, "C7", "r"); gnd(800, 490); wire((800, 410), (930, 410)); cap_v(930, 450, "C8", "r"); gnd(930, 490)
text(1030, 380, "U1 pin 8 = VCC, pin 4 = GND (TLV9062 SOIC-8)", 12, INK, "start")
text(1030, 398, "VCC: Nucleo CN6 5V pin, USB powered. Abs max 6 V.", 12, "#475569", "start")
text(1030, 416, "VMID = VCC/2 = 2.5 V sets stage-2 bias.", 12, "#475569", "start")
text(1030, 440, "Test points: TP1 DAC_PA4 · TP2 FILTER_OUT · TP3 OPAMP_OUT · TP4 GND", 12, TPC, "start", "700")
text(1030, 458, "Keep J1 ground and scope ground on one star point.", 12, "#475569", "start")
text(1030, 476, "Only ADC_IN (after R10 + D1, JP1 on VBIAS) may go to a Nucleo pin.", 12, "#b91c1c", "start", "700")
text(1030, 494, "Never OPAMP_OUT or an un-biased SCOPE_OUT.", 12, "#b91c1c", "start", "700")

el.insert(HEAD, '<g transform="translate(0,60)">'); el.append('</g>')
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n' + "\n".join(el) + "\n</svg>\n"
(OUT / "aquasdr_afe_schematic.svg").write_text(svg)
print("wrote", OUT / "aquasdr_afe_schematic.svg")
