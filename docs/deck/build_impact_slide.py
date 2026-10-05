#!/usr/bin/env python3
"""SIH 2026 deck, slide 5 (IMPACT AND BENEFITS). Was based on slide 4 (FEASIBILITY AND VIABILITY) v2: risk-to-strategy split cards.
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
OUT = HERE / ("AquaSDR_slide5_figure.pptx" if FIGURE_ONLY else "AquaSDR_slide5_impact.pptx")
rgb = RGBColor.from_string
NAVY, TEAL, BG, CHAR, GRAY, WHITE, RULE, MIST, SOFT = rgb("183153"), rgb("3B8C7A"), rgb("F3F6F9"), rgb("263238"), rgb("667085"), rgb("FFFFFF"), rgb("D0D5DD"), rgb("AFC0D6"), rgb("E8F3F0")
FONT = "Arial"

prs = Presentation(HERE / "template" / "SIH2026-IDEA-template.pptx")
ids = prs.slides._sldIdLst
for i, sid in reversed(list(enumerate(list(ids)))):
    if i != 4: prs.part.drop_rel(sid.rId); ids.remove(sid)
s = prs.slides[0]
for sh in list(s.shapes):
    if sh.has_text_frame and "Potential impact on the target" in sh.text_frame.text:
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


# ============ 1 · IMPACT ON THE TARGET AUDIENCE ============
def section(y, label, sub):
    text(0.30, y, 9, 0.28, [[(label, {"bold": True, "size": 12, "color": NAVY}), ("   " + sub, {"size": 11, "color": GRAY})]])
section(1.45, "IMPACT", "on the target audience")
aud = [("NIOT · MoES · DEEP OCEAN MISSION", "One payload for every water", "Adapts to clear, coastal and murky water with no hardware change.", "3 profiles · 4 parameters · switched in < 100 ms"),
       ("AUV & SURVEY OPERATORS", "Sharper seabed data", "Every ping is re-tuned to the water instead of one fixed setting.", "Windowed pulses: leakage −14.6 → −35 dB"),
       ("RESEARCHERS & STUDENTS", "An open sonar test bed", "A new waveform or policy is a firmware update, checked on-board.", "LFM · Geometric · Barker-13 · 161 tests")]
AY, AH, AW, AG = 1.95, 1.85, 4.12, 0.20
for k, (who, head_, body_, proof) in enumerate(aud):
    x = 0.30 + k * (AW + AG)
    shape(MSO_SHAPE.RECTANGLE, x, AY, AW, AH, fill=WHITE, line=RULE)
    shape(MSO_SHAPE.RECTANGLE, x, AY, AW, 0.40, fill=NAVY)
    text(x + 0.2, AY, AW - 0.3, 0.40, [[(who, {"bold": True, "size": 9, "color": WHITE})]], anchor=MSO_ANCHOR.MIDDLE)
    text(x + 0.2, AY + 0.55, AW - 0.4, 0.35, [[(head_, {"bold": True, "size": 16, "color": NAVY})]])
    text(x + 0.2, AY + 0.95, AW - 0.4, 0.45, [[(body_, {"size": 10.5, "color": CHAR})]])
    seg(x + 0.2, AY + 1.45, x + AW - 0.2, AY + 1.45, color=RULE)
    text(x + 0.2, AY + 1.50, AW - 0.4, 0.3, [[(proof, {"bold": True, "size": 9, "color": TEAL})]], anchor=MSO_ANCHOR.MIDDLE)

# ============ 2 · BENEFITS ============
section(4.02, "BENEFITS", "economic · environmental · strategic")
ben = [("ECONOMIC", TEAL, "Low cost, off the shelf", "STM32, a standard op-amp and common sensors. No imported custom sonar electronics."),
       ("ENVIRONMENTAL", rgb("5E8C61"), "Only the power the water needs", "Clear water pings at 35 % amplitude, not a fixed maximum: less acoustic noise for marine life."),
       ("STRATEGIC", NAVY, "Sonar built in India", "Indigenous technology for port security, cable and pipeline inspection, and coastal monitoring.")]
BY, BH, BL = 4.45, 1.45, 0.34
for k, (cat, col, head_, body_) in enumerate(ben):
    x = 0.30 + k * (AW + AG)
    shape(MSO_SHAPE.RECTANGLE, x, BY, AW, BH, fill=BG)
    shape(MSO_SHAPE.RECTANGLE, x, BY, 0.08, BH, fill=col)
    text(x + 0.28, BY + 0.14, AW - 0.4, 0.22, [[(cat, {"bold": True, "size": 8.5, "color": col})]])
    text(x + 0.28, BY + 0.40, AW - 0.4, 0.32, [[(head_, {"bold": True, "size": 14, "color": NAVY})]])
    text(x + 0.28, BY + 0.78, AW - 0.45, 0.6, [[(body_, {"size": 10, "color": CHAR})]])

# ============ 3 · TAGLINE ============
TY = 6.12
seg(0.30, TY, 13.04, TY, color=NAVY, lw=1.0)
text(0.30, TY + 0.08, 12.74, 0.42, [[("One adaptive ping, any water", {"bold": True, "size": 15, "color": NAVY}),
                                     ("   —   better data, less power, built in India.", {"size": 14, "color": GRAY})]], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

prs.save(OUT)
print("wrote", OUT)
