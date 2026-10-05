#!/usr/bin/env python3
"""SIH 2026 deck, slide 4 (FEASIBILITY AND VIABILITY) v2: risk-to-strategy split cards.
Left: ANALYSIS OF FEASIBILITY: a readiness matrix (subsystem x maturity stage) plus six proof numbers, all from the
repository's recorded evidence (data/bench MCU ADC captures, docs/evidence). Right: CHALLENGES & RISKS -> STRATEGIES.
Bottom: VIABILITY line. Honest maturity lives here (slide 3 shows the architecture only).
    python3 docs/deck/build_feasibility_slide.py                 -> full slide on the SIH template
    FIGURE_ONLY=1 python3 docs/deck/build_feasibility_slide.py   -> figure only (for pasting into Canva)
"""
import os, pathlib
import os, pathlib
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn

HERE = pathlib.Path(__file__).parent
FIGURE_ONLY = os.environ.get("FIGURE_ONLY") == "1"
OUT = HERE / ("AquaSDR_slide4_v2_figure.pptx" if FIGURE_ONLY else "AquaSDR_slide4_v2.pptx")
rgb = RGBColor.from_string
NAVY, TEAL, BG, CHAR, GRAY, WHITE, RULE, MIST, SOFT = rgb("183153"), rgb("3B8C7A"), rgb("F3F6F9"), rgb("263238"), rgb("667085"), rgb("FFFFFF"), rgb("D0D5DD"), rgb("AFC0D6"), rgb("E8F3F0")
FONT = "Arial"

prs = Presentation(HERE / "template" / "SIH2026-IDEA-template.pptx")
ids = prs.slides._sldIdLst
for i, sid in reversed(list(enumerate(list(ids)))):
    if i != 3: prs.part.drop_rel(sid.rId); ids.remove(sid)
s = prs.slides[0]
for sh in list(s.shapes):
    if sh.has_text_frame and "Analysis of the feasibility" in sh.text_frame.text:
        sh._element.getparent().remove(sh._element)
if FIGURE_ONLY:
    for sh in list(s.shapes): sh._element.getparent().remove(sh._element)

I = Inches
def flat(shape):
    el = shape._element
    st = el.find(qn("p:style"))
    if st is not None: el.remove(st)
    return shape

def text(x, y, w, h, paras, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, size=9, color=CHAR, bold=False):
    tb = s.shapes.add_textbox(I(x), I(y), I(w), I(h)); tf = tb.text_frame
    tf.word_wrap = True; tf.vertical_anchor = anchor
    for side in ("margin_left", "margin_right", "margin_top", "margin_bottom"): setattr(tf, side, 0)
    for k, para in enumerate(paras):
        p = tf.paragraphs[0] if k == 0 else tf.add_paragraph(); p.alignment = align
        for t, st in para:
            r = p.add_run(); r.text = t; f = r.font; f.name = FONT
            f.size = Pt(st.get("size", size)); f.bold = st.get("bold", bold); f.color.rgb = st.get("color", color)
    return tb

def shape(kind, x, y, w, h, fill=None, line=None, lw=0.75, adj=None, rot=0):
    b = s.shapes.add_shape(kind, I(x), I(y), I(w), I(h))
    if fill is None: b.fill.background()
    else: b.fill.solid(); b.fill.fore_color.rgb = fill
    if line is None: b.line.fill.background()
    else: b.line.color.rgb = line; b.line.width = Pt(lw)
    if adj is not None: b.adjustments[0] = adj
    if rot: b.rotation = rot
    return flat(b)

def seg(x1, y1, x2, y2, color=RULE, lw=0.75):
    c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, I(x1), I(y1), I(x2), I(y2))
    c.line.color.rgb = color; c.line.width = Pt(lw); return flat(c)

# ============ 1 · FEASIBLE TODAY: proof strip ============
FY, FH = 1.30, 1.02
shape(MSO_SHAPE.ROUNDED_RECTANGLE, 0.30, FY, 11.25, FH, fill=BG, adj=0.12)
text(0.50, FY + 0.16, 2.3, 0.3, [[("FEASIBLE TODAY", {"bold": True, "size": 13, "color": NAVY})]])
text(0.50, FY + 0.50, 2.3, 0.4, [[("Already running on our STM32", {"size": 9, "color": GRAY})], [("payload, built from shelf parts", {"size": 9, "color": GRAY})]])
proofs = [("42.00 kHz", "chirp lands exactly on target"), ("−35 dB", "leakage with Hann, from −14.6"),
          ("< 100 ms", "water change → new ping"), ("0", "DMA dropouts in every capture")]
PX, PW = 2.78, 2.17
for k, (big, small) in enumerate(proofs):
    x = PX + k * (PW + 0.07)
    if k: seg(x - 0.04, FY + 0.2, x - 0.04, FY + FH - 0.2)
    text(x + 0.18, FY + 0.14, PW - 0.25, 0.42, [[(big, {"bold": True, "size": 21, "color": TEAL})]])
    text(x + 0.18, FY + 0.62, PW - 0.25, 0.3, [[(small, {"size": 8.6, "color": CHAR})]])

# ============ 2 · RISK → STRATEGY split cards ============
text(0.30, 2.52, 8, 0.28, [[("CHALLENGES ", {"bold": True, "size": 12, "color": NAVY}), ("and how we beat them", {"size": 12, "color": GRAY})]])
cards = [("01", "Signal integrity", "Stepped DAC output and sidelobes blur the echo",
          "Hann / Hamming / Blackman windows + 70.7 kHz low-pass filter and op-amp stage", "WINDOWS PROVEN · FILTER NEXT"),
         ("02", "Frequency & transducer", "PS band is 100–500 kHz; our bench runs at 40 kHz",
          "Same timer + DMA engine drives an external high-speed DAC and a matched driver stage", "SCALE PATH READY"),
         ("03", "Bad sensor data", "One noisy reading could flip the ping",
          "Smoothing, hysteresis and out-of-range rejection before any change", "IN PLACE"),
         ("04", "Power & safety", "Long missions drain the battery; a ping must never run away",
          "DMA streams the pulse so the CPU stays free; 2 s auto-stop lease", "IN PLACE")]
CY, CW, GAP, TOP, BOT = 2.92, 3.04, 0.197, 1.42, 1.70
for k, (num, risk, detail, fix, status) in enumerate(cards):
    x = 0.30 + k * (CW + GAP)
    shape(MSO_SHAPE.ROUND_2_SAME_RECTANGLE, x, CY, CW, TOP, fill=NAVY, adj=0.12)
    shape(MSO_SHAPE.ROUND_2_SAME_RECTANGLE, x, CY + TOP, CW, BOT, fill=WHITE, line=RULE, adj=0.10, rot=180)
    text(x + CW - 0.95, CY + 0.08, 0.8, 0.5, [[(num, {"bold": True, "size": 28, "color": rgb("2E4A70")})]], align=PP_ALIGN.RIGHT)
    text(x + 0.22, CY + 0.20, CW - 0.4, 0.2, [[("RISK", {"bold": True, "size": 8, "color": MIST})]])
    text(x + 0.22, CY + 0.44, CW - 0.4, 0.3, [[(risk, {"bold": True, "size": 14.5, "color": WHITE})]])
    text(x + 0.22, CY + 0.82, CW - 0.4, 0.5, [[(detail, {"size": 9.5, "color": rgb("D6DEEA")})]])
    # seam badge
    shape(MSO_SHAPE.OVAL, x + 0.22, CY + TOP - 0.2, 0.4, 0.4, fill=TEAL, line=WHITE, lw=1.5)
    text(x + 0.22, CY + TOP - 0.2, 0.4, 0.4, [[("↓", {"bold": True, "size": 14, "color": WHITE})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    text(x + 0.74, CY + TOP + 0.04, 1.5, 0.2, [[("STRATEGY", {"bold": True, "size": 8, "color": TEAL})]])
    text(x + 0.22, CY + TOP + 0.34, CW - 0.4, 0.85, [[(fix, {"bold": True, "size": 11, "color": NAVY})]])
    done = status == "IN PLACE"
    shape(MSO_SHAPE.ROUNDED_RECTANGLE, x + 0.22, CY + TOP + BOT - 0.42, CW - 0.44, 0.26, fill=SOFT if done else WHITE, line=TEAL, lw=0.75, adj=0.5)
    text(x + 0.22, CY + TOP + BOT - 0.42, CW - 0.44, 0.26, [[(("✓  " if done else "→  ") + status, {"bold": True, "size": 7.6, "color": TEAL})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

# ============ 3 · VIABLE strip ============
VY = 6.17
text(0.30, VY, 1.3, 0.5, [[("VIABLE", {"bold": True, "size": 13, "color": NAVY})]], anchor=MSO_ANCHOR.MIDDLE)
pts = [("Low cost", "off-the-shelf STM32 + op-amp"), ("Software-defined", "new ping = firmware update"),
       ("Scalable", "same design → 100–500 kHz"), ("Reliable", "161 automated tests")]
for k, (a, b) in enumerate(pts):
    x = 1.55 + k * 2.88
    shape(MSO_SHAPE.OVAL, x, VY + 0.19, 0.12, 0.12, fill=TEAL)
    text(x + 0.22, VY + 0.04, 2.6, 0.45, [[(a, {"bold": True, "size": 10, "color": NAVY})], [(b, {"size": 8.8, "color": GRAY})]])

prs.save(OUT)
print("wrote", OUT)
