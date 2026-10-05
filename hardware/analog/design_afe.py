#!/usr/bin/env python3
"""AquaSDR analog front end (PA4 -> filter -> TLV9062 -> scope): design, netlist, simulation.

One source of truth: component values are chosen here, a SPICE netlist and a KiCad
netlist are emitted from them, and the response claimed in docs/HARDWARE_COMMISSIONING.md
is computed by solving *that netlist* (modified nodal analysis, op-amp as a one-pole
VCVS with the datasheet's 10 MHz unity-gain bandwidth). Nothing here is a measurement.

    python3 hardware/analog/design_afe.py          # regenerate everything in this folder
Requires only numpy.
"""
import json, math, pathlib, sys
import numpy as np

OUT = pathlib.Path(__file__).parent

# ---- Design targets -------------------------------------------------------------
FS = 1_000_000            # DAC sample rate (firmware: TIM6 84 MHz / 84)
BAND_LO, BAND_HI = 36e3, 44e3   # bench envelope: MURKY 38 +-0.5 ... CLEAR 42 +-2 kHz
FC_TARGET = 70e3          # chosen below, see rationale
VCC = 5.0                 # Nucleo CN6 "5V" pin (USB powered); TLV9062 allows 1.8-5.5 V, abs max 6 V
GAIN_STAGE2 = 1.5         # (1 + Rf/Rg)
GBW = 10e6                # TLV9062 datasheet unity-gain bandwidth
R_MIN_DAC = 4.7e3         # STM32F446 DAC buffer wants RL >= 5 kOhm; SK input is R1 + caps

E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]
E96 = [round(10 ** (i / 96), 2) for i in range(96)]
E96 = [float(f"{v:.2f}") for v in E96]


def series(vals, lo, hi):
    out = []
    d = 10 ** math.floor(math.log10(lo))
    while d <= hi:
        out += [v * d for v in vals if lo <= v * d <= hi]
        d *= 10
    return sorted(set(round(x, 12) for x in out))


# ---- Pick Sallen-Key (unity gain, equal R) values ---------------------------------
# fc = 1 / (2 pi R sqrt(Ca Cb)), Q = 0.5 sqrt(Ca / Cb); Butterworth wants Q = 0.7071.
best = None
for R in series(E96, R_MIN_DAC, 12e3):
    for Cb in series(E12, 150e-12, 1.5e-9):
        for Ca in series(E12, 150e-12, 3.3e-9):
            fc = 1 / (2 * math.pi * R * math.sqrt(Ca * Cb))
            q = 0.5 * math.sqrt(Ca / Cb)
            score = abs(math.log(fc / FC_TARGET)) * 4 + abs(math.log(q / 0.70711)) * 6
            if best is None or score < best[0]:
                best = (score, R, Ca, Cb, fc, q)
_, R_SK, C_A, C_B, FC, Q = best

PARTS = {  # ref -> (value, kind, description)
    "R1": (R_SK, "R", "SK input resistor"),
    "R2": (R_SK, "R", "SK second resistor"),
    "C1": (C_A, "C", "SK feedback capacitor (node A to FILTER_OUT) C0G"),
    "C2": (C_B, "C", "SK shunt capacitor (+ input to GND) C0G"),
    "C3": (1e-6, "C", "Stage-2 input DC block, film or X7R"),
    "R3": (100e3, "R", "Stage-2 bias divider, top (VCC)"),
    "R4": (100e3, "R", "Stage-2 bias divider, bottom (GND)"),
    "C4": (100e-9, "C", "VMID decoupling (on the divider node, isolated from the signal by R9)"),
    "R9": (100e3, "R", "Bias isolation: VMID to the U1B + input"),
    "R5": (10e3, "R", "Stage-2 feedback Rf"),
    "R6": (20e3, "R", "Stage-2 gain-set Rg"),
    "C5": (10e-6, "C", "Rg DC-block (DC gain 1), + toward U1 pin 6"),
    "R7": (100.0, "R", "Output series resistor / cable isolation"),
    "C6": (1e-6, "C", "Output DC block, film or X7R"),
    "R8": (100e3, "R", "Output bleed to SCOPE_REF (JP1: GND for a scope, VBIAS for the MCU ADC tap)"),
    "R10": (1e3, "R", "MCU ADC tap: series resistor into the ADC pin (with D1 limits fault current)"),
    "R11": (10e3, "R", "MCU ADC tap: VBIAS divider, top (Nucleo 3V3)"),
    "R12": (10e3, "R", "MCU ADC tap: VBIAS divider, bottom (GND)"),
    "C9": (100e-9, "C", "MCU ADC tap: VBIAS decoupling"),
    "C7": (100e-9, "C", "U1 supply decoupling at pins 8/4"),
    "C8": (10e-6, "C", "U1 bulk supply decoupling"),
}
VMID = VCC / 2
V3V3 = 3.3                # Nucleo 3V3 pin: VBIAS source for the MCU ADC tap (same supply as the ADC reference)
ADC_BIAS = V3V3 / 2        # VBIAS: R11/R12 midpoint
ADC_SAFE_LO, ADC_SAFE_HI = 0.10, 3.20   # keep the ADC pin well inside 0..3.3 V (D1 clamps anything beyond)
C_ADC = 8e-12             # STM32F4 ADC sample capacitor + pin, model only (not a part)


# ---- Netlist (the single description everything else is generated from) ---------
# node names are the SPICE nets used in the schematic and KiCad netlist.
NETLIST = [
    # ref, kind, node+, node-, value
    ("R1", "R", "DAC_PA4", "SK_A", "R1"),
    ("R2", "R", "SK_A", "SK_P", "R2"),
    ("C1", "C", "SK_A", "FILTER_OUT", "C1"),
    ("C2", "C", "SK_P", "GND", "C2"),
    # U1A: unity-gain follower, + = SK_P, - = out = FILTER_OUT
    ("U1A", "OPAMP", "SK_P", "FILTER_OUT", "FILTER_OUT"),
    ("C3", "C", "FILTER_OUT", "B_IN", "C3"),
    ("R3", "R", "VCC", "VMID", "R3"),
    ("R4", "R", "VMID", "GND", "R4"),
    ("C4", "C", "VMID", "GND", "C4"),
    ("R9", "R", "VMID", "B_IN", "R9"),
    # U1B: non-inverting, + = B_IN, - = FB, out = OPAMP_OUT
    ("U1B", "OPAMP", "B_IN", "FB", "OPAMP_OUT"),
    ("R5", "R", "OPAMP_OUT", "FB", "R5"),
    ("R6", "R", "FB", "RG", "R6"),
    ("C5", "C", "RG", "GND", "C5"),
    ("R7", "R", "OPAMP_OUT", "SCOPE_AC", "R7"),
    ("C6", "C", "SCOPE_AC", "SCOPE_OUT", "C6"),
    ("R8", "R", "SCOPE_OUT", "VBIAS", "R8"),
    # MCU ADC tap: JP1 in the VBIAS position puts R8 on VBIAS (in the schematic and KiCad netlist R8 returns via JP1 pin 2). ADC_IN is the node wired to Nucleo A5.
    ("R11", "R", "V3V3", "VBIAS", "R11"),
    ("R12", "R", "VBIAS", "GND", "R12"),
    ("C9", "C", "VBIAS", "GND", "C9"),
    ("R10", "R", "SCOPE_OUT", "ADC_IN", "R10"),
]


def value_of(ref):
    return PARTS[ref][0]


def solve(freqs, load_ohm=1e6, gbw=GBW, a0=1e5):
    """AC solution of NETLIST for a 1 V source at DAC_PA4 (ideal, 0 ohm source). Returns node->complex array.
    Bias network is DC-only for AC purposes: VCC and GND are both AC ground."""
    nodes = sorted({n for _, _, a, b, *_ in [(e[0], e[1], e[2], e[3]) for e in NETLIST] for n in (a, b)} |
                   {e[4] for e in NETLIST if e[1] == "OPAMP"} | {"SCOPE_OUT", "DAC_PA4", "ADC_IN"})
    nodes = [n for n in nodes if n not in ("GND", "VCC", "V3V3")]
    idx = {n: i for i, n in enumerate(nodes)}
    opamps = [e for e in NETLIST if e[1] == "OPAMP"]
    n = len(nodes)
    m = n + len(opamps) + 1  # + one branch for the source
    res = {k: np.zeros(len(freqs), complex) for k in nodes}
    wp = 2 * math.pi * gbw / a0
    for fi, f in enumerate(freqs):
        s = 2j * math.pi * f
        Y = np.zeros((m, m), complex)
        rhs = np.zeros(m, complex)

        def stamp(a, b, y):
            ia = idx.get(a); ib = idx.get(b)
            if ia is not None: Y[ia, ia] += y
            if ib is not None: Y[ib, ib] += y
            if ia is not None and ib is not None: Y[ia, ib] -= y; Y[ib, ia] -= y
        for ref, kind, a, b, *_ in NETLIST:
            if kind == "R": stamp(a, b, 1 / value_of(ref))
            elif kind == "C": stamp(a, b, s * value_of(ref))
        stamp("SCOPE_OUT", "GND", 1 / load_ohm)
        stamp("ADC_IN", "GND", s * C_ADC)
        for k, (ref, _, plus, minus, out) in enumerate(opamps):
            row = n + k
            io, ip, im = idx[out], idx.get(plus), idx.get(minus)
            Y[io, row] += 1  # output current injected by the op-amp branch
            Y[row, io] = 1
            A = a0 / (1 + s / wp)
            if ip is not None: Y[row, ip] -= A
            if im is not None: Y[row, im] += A
        src = n + len(opamps)
        Y[idx["DAC_PA4"], src] += 1
        Y[src, idx["DAC_PA4"]] = 1
        rhs[src] = 1
        x = np.linalg.solve(Y, rhs)
        for k, nn in enumerate(nodes):
            res[nn][fi] = x[k]
    return res


def db(x): return 20 * np.log10(np.maximum(np.abs(x), 1e-12))


def spice():
    lines = ["* AquaSDR analog front end: PA4 -> 2nd-order Sallen-Key LPF -> gain stage -> scope",
             "* Generated by design_afe.py. Op-amp: one-pole VCVS, A0=1e5, GBW=10 MHz (TLV9062 datasheet).",
             f"VCC VCC 0 {VCC}", f"V3V3 V3V3 0 {V3V3}", "VIN DAC_PA4 0 DC 1.65 AC 1 SIN(1.65 0.7 40k)"]
    for ref, kind, a, b, *rest in NETLIST:
        a = "0" if a == "GND" else a; b = "0" if b == "GND" else b
        if kind in ("R", "C"):
            lines.append(f"{ref} {a} {b} {value_of(ref):.6g}")
        else:
            lines.append(f"E{ref} {rest[0]}_I 0 {a} {b} 1e5  ; ideal VCVS")
            lines.append(f"R{ref}P {rest[0]}_I {rest[0]} {1/(2*math.pi*GBW*1e-9):.6g}  ; GBW pole with 1 nF")
            lines.append(f"C{ref}P {rest[0]} 0 1n")
    lines += ["RLOAD SCOPE_OUT 0 1Meg", f"CADC ADC_IN 0 {C_ADC:.3g}  ; model only", ".ac dec 200 100 2Meg", ".tran 1u 12m", ".end"]
    return "\n".join(lines) + "\n"


FOOT = {"R": "Resistor_SMD:R_0805_2012Metric", "C": "Capacitor_SMD:C_0805_2012Metric"}


def kicad_net():
    """Legacy KiCad netlist (importable by PCB Editor: File > Import > Netlist)."""
    pin_map = {  # TLV9062 dual op-amp, SOIC-8 / VSSOP-8 (non-shutdown part)
        "U1": {"1": "FILTER_OUT", "2": "FILTER_OUT", "3": "SK_P", "4": "GND", "5": "B_IN", "6": "FB",
               "7": "OPAMP_OUT", "8": "VCC"}}
    comps, nets = [], {}
    for ref, (val, kind, desc) in PARTS.items():
        comps.append((ref, f"{val:.4g}", FOOT[kind], kind))
    for ref, kind, a, b, *_ in NETLIST:
        if kind in ("R", "C"):
            b = "R8_RET" if (ref == "R8" and b == "VBIAS") else b   # R8 returns through jumper JP1
            nets.setdefault(a, []).append((ref, "1")); nets.setdefault(b, []).append((ref, "2"))
    for pin, net in pin_map["U1"].items():
        nets.setdefault(net, []).append(("U1", pin))
    # connectors
    conn = {"J1": ["DAC_PA4", "GND"], "J2": ["VCC", "GND"], "J3": ["SCOPE_OUT", "GND"], "J4": ["ADC_IN", "GND"], "J5": ["V3V3", "GND"]}
    for ref, ns in conn.items():
        for i, net in enumerate(ns, 1):
            nets.setdefault(net, []).append((ref, str(i)))
    tps = {"TP1": "DAC_PA4", "TP2": "FILTER_OUT", "TP3": "OPAMP_OUT", "TP4": "GND"}
    for ref, net in tps.items():
        nets.setdefault(net, []).append((ref, "1"))
    # D1 BAT54S dual Schottky clamp on ADC_IN (pin 3 common, pin 1 to GND, pin 2 to V3V3); JP1 selects where R8 returns
    for pin, net in (("3", "ADC_IN"), ("1", "GND"), ("2", "V3V3")):
        nets.setdefault(net, []).append(("D1", pin))
    for pin, net in (("1", "GND"), ("2", "R8_RET"), ("3", "VBIAS")):
        nets.setdefault(net, []).append(("JP1", pin))
    s = ['(export (version D)', '  (design (source "aquasdr_afe") (tool "design_afe.py"))', '  (components']
    for ref, val, fp, kind in comps:
        s.append(f'    (comp (ref {ref}) (value {val}) (footprint {fp}) (libsource (lib Device) (part {kind})))')
    s.append('    (comp (ref U1) (value TLV9062) (footprint Package_SO:SOIC-8_3.9x4.9mm_P1.27mm) (libsource (lib Amplifier_Operational) (part TLV9062)))')
    s.append('    (comp (ref D1) (value BAT54S) (footprint Package_TO_SOT_SMD:SOT-23) (libsource (lib Diode) (part BAT54S)))')
    s.append('    (comp (ref JP1) (value Jumper_3pin) (footprint Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical) (libsource (lib Connector_Generic) (part Conn_01x03)))')
    for ref in conn:
        s.append(f'    (comp (ref {ref}) (value Conn_01x02) (footprint Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical) (libsource (lib Connector_Generic) (part Conn_01x02)))')
    for ref in tps:
        s.append(f'    (comp (ref {ref}) (value TestPoint) (footprint TestPoint:TestPoint_Pad_D1.5mm) (libsource (lib Connector) (part TestPoint)))')
    s.append('  )\n  (nets')
    for code, (net, nodes) in enumerate(sorted(nets.items()), 1):
        s.append(f'    (net (code {code}) (name "{net}")')
        for ref, pin in nodes:
            s.append(f'      (node (ref {ref}) (pin {pin}))')
        s.append('    )')
    s.append('  )\n)')
    return "\n".join(s) + "\n", nets


def fmt_val(v, kind):
    if kind == "R":
        return f"{v/1e6:g}M" if v >= 1e6 else f"{v/1e3:g}k" if v >= 1e3 else f"{v:g}"
    return f"{v*1e6:g}u" if v >= 1e-6 else f"{v*1e9:g}n" if v >= 1e-9 else f"{v*1e12:g}p"


def bom():
    rows = ["ref,value,qty_note,type,notes"]
    for ref, (v, kind, desc) in PARTS.items():
        rows.append(f"{ref},{fmt_val(v, kind)}{'ohm' if kind=='R' else 'F'},1,{'resistor' if kind=='R' else 'capacitor'},{desc}")
    rows += ["U1,TLV9062 (dual op-amp; non-shutdown),1,IC,On SOIC-8 adapter. Pins: 1 OUTA 2 -INA 3 +INA 4 V- 5 +INB 6 -INB 7 OUTB 8 V+",
             "J1,Header 1x02,1,connector,DAC_PA4 + GND from Nucleo A2 and GND",
             "J2,Header 1x02,1,connector,+5V (Nucleo CN6 pin 5V) + GND",
             "J3,BNC or header 1x02,1,connector,SCOPE_OUT + GND to oscilloscope probe",
             "J4,Header 1x02,1,connector,ADC_IN to Nucleo A5 (PC0) + GND: MCU ADC tap",
             "J5,Header 1x02,1,connector,Nucleo 3V3 + GND: VBIAS source for the MCU ADC tap",
             "D1,BAT54S dual Schottky (SOT-23),1,diode,Clamps ADC_IN to GND / 3V3 (catches any excursion outside the ADC range)",
             "JP1,Header 1x03 + jumper,1,jumper,SCOPE_REF: pin 1-2 = GND (oscilloscope use); pin 2-3 = VBIAS (MCU ADC tap)",
             "TP1-TP4,Test point,4,test point,DAC_PA4 / FILTER_OUT / OPAMP_OUT / GND"]
    return "\n".join(rows) + "\n"


def dac_ref(mode, f0, bw, ms, amp, window):
    """LFM (+ windows) DAC samples in volts around 1.65 V, mirroring firmware/src/waveform.c closely enough for design checks."""
    n = int(round(ms * 1e-3 * FS)); t = np.arange(n) / FS
    f1, f2 = f0 - bw / 2, f0 + bw / 2; T = n / FS
    phase = 2 * np.pi * (f1 * t + (f2 - f1) * t ** 2 / (2 * T))
    x = np.arange(n) / max(1, n - 1)
    w = {"RECT": np.ones(n), "HANN": 0.5 - 0.5 * np.cos(2 * np.pi * x),
         "HAMMING": 0.54 - 0.46 * np.cos(2 * np.pi * x),
         "BLACKMAN": 0.42 - 0.5 * np.cos(2 * np.pi * x) + 0.08 * np.cos(4 * np.pi * x)}[window]
    code = np.round(2048 + np.sin(phase) * w * amp / 100 * 2047)
    return (code / 4095) * 3.3


def run():
    freqs = np.logspace(3, 6.3, 800)
    H = solve(freqs)
    h_sk = H["FILTER_OUT"]; h_out = H["OPAMP_OUT"]; h_conn = H["SCOPE_OUT"]; h_adc = H["ADC_IN"]
    at = lambda arr, f: complex(np.interp(f, freqs, arr.real), np.interp(f, freqs, arr.imag))
    probe = [100, 1e3, 10e3, 36e3, 38e3, 40e3, 42e3, 44e3, FC, 2 * FC, 3 * 40e3, 5 * 40e3, FS - 44e3, FS - 36e3]
    table = []
    for f in probe:
        table.append({"hz": f, "filter_out_db": float(db(np.array([at(h_sk, f)]))[0]),
                      "opamp_out_db": float(db(np.array([at(h_out, f)]))[0]),
                      "connector_db": float(db(np.array([at(h_conn, f)]))[0]),
                      "adc_in_db": float(db(np.array([at(h_adc, f)]))[0])})
    mag = np.abs(h_sk)
    f3 = float(freqs[np.argmax(mag < mag[np.searchsorted(freqs, 10e3)] / math.sqrt(2))])
    ripple = db(h_out[(freqs >= BAND_LO) & (freqs <= BAND_HI)])
    # Expected scope amplitudes through the real linear chain for each policy profile (computed, not measured)
    prof = {"CLEAR": (42, 4, 2, 35), "TRANSITION": (40, 2, 4, 50), "MURKY": (38, 1, 8, 62)}
    exp = {}
    for name, (f0, bw, ms, amp) in prof.items():
        for win in ("RECT", "HANN", "HAMMING", "BLACKMAN"):
            v = dac_ref("LFM", f0 * 1e3, bw * 1e3, ms, amp, win)
            ac = v - 1.65
            N = 1 << int(math.ceil(math.log2(len(ac) * 4)))
            spec = np.fft.rfft(ac, N); fr = np.fft.rfftfreq(N, 1 / FS)
            Hs = np.interp(fr, freqs, h_out.real) + 1j * np.interp(fr, freqs, h_out.imag)
            y = np.fft.irfft(spec * Hs, N)[: len(ac)]
            peak = float(np.max(np.abs(y)))
            ya = np.fft.irfft(spec * (np.interp(fr, freqs, h_adc.real) + 1j * np.interp(fr, freqs, h_adc.imag)), N)[: len(ac)]
            yf = np.fft.irfft(spec * (np.interp(fr, freqs, h_sk.real) + 1j * np.interp(fr, freqs, h_sk.imag)), N)[: len(ac)]
            adc_hi, adc_lo = ADC_BIAS + float(ya.max()), ADC_BIAS + float(ya.min())
            tp2_hi, tp2_lo = ADC_BIAS + float(yf.max()), ADC_BIAS + float(yf.min())
            adc_swing = max(float(ya.max()), -float(ya.min()))
            exp[f"{name}/{win}"] = {"dac_vpp": float(ac.max() - ac.min()), "opamp_vpp": float(2 * peak),
                                    "headroom_v": float(VMID - peak),
                                    "clips": bool(VMID + peak > VCC - 0.02 or VMID - peak < 0.02),
                                    # what the MCU ADC pin would see through the tap (VBIAS 1.65 V + the AC output), and the filter-only tap
                                    "adc_tap_min_v": adc_lo, "adc_tap_max_v": adc_hi,
                                    "adc_tap_safe": bool(ADC_SAFE_LO <= adc_lo and adc_hi <= ADC_SAFE_HI),
                                    "adc_tap_max_amplitude_pct": float(amp * (ADC_SAFE_HI - ADC_BIAS) / adc_swing),
                                    "filter_tap_min_v": tp2_lo, "filter_tap_max_v": tp2_hi}
    fine = np.arange(30e3, 50.1e3, 1e3)
    gain_by_khz = {f"{f/1e3:g}": {"filter_out": float(np.interp(f, freqs, np.abs(h_sk))), "opamp_out": float(np.interp(f, freqs, np.abs(h_out))), "adc_in": float(np.interp(f, freqs, np.abs(h_adc)))} for f in fine}
    clip_all = {amp: 2 * 1.45 * amp / 100 * GAIN_STAGE2 / 2 for amp in (62, 85, 100)}
    summary = {
        "design": {"topology": "DAC -> 2nd-order unity-gain Sallen-Key Butterworth LPF (U1A) -> AC couple -> x%.2f non-inverting stage (U1B) -> 100 ohm + DC block -> scope, or (JP1 on VBIAS) 1 k + 1.65 V bias + clamp -> Nucleo A5 MCU ADC tap" % GAIN_STAGE2,
                   "adc_tap": {"vbias_v": ADC_BIAS, "r10_ohm": 1000.0, "safe_range_v": [ADC_SAFE_LO, ADC_SAFE_HI], "clamp": "BAT54S to GND and 3V3"},
                   "vcc_v": VCC, "vmid_v": VMID, "stage2_gain": GAIN_STAGE2, "stage2_gain_db": 20 * math.log10(GAIN_STAGE2),
                   "R_sk_ohm": R_SK, "C1_farad": C_A, "C2_farad": C_B,
                   "fc_hz": FC, "q": Q, "f_minus3db_sim_hz": f3,
                   "passband_36_44k_gain_db_min": float(ripple.min()), "passband_36_44k_gain_db_max": float(ripple.max()),
                   "iq_ma_estimate": 2 * 0.538, "datasheet_gbw_hz": GBW, "datasheet_slew_v_per_us": 6.5},
        "response": table, "expected_profiles": exp, "gain_by_khz": gain_by_khz,
        "fc_rationale": "FC is chosen, not assumed: <1 dB droop through the 44 kHz top of the CLEAR sweep, >=9 dB at the 3rd harmonic (120 kHz) and >=45 dB at the 1 MS/s DAC image (956 kHz).",
    }
    return summary, freqs, h_sk, h_out


def main():
    summary, freqs, h_sk, h_out = run()
    (OUT / "aquasdr_afe.cir").write_text(spice())
    net, nets = kicad_net()
    (OUT / "aquasdr_afe.net").write_text(net)
    (OUT / "aquasdr_afe_bom.csv").write_text(bom())
    (OUT / "design_results.json").write_text(json.dumps(summary, indent=2))
    # connectivity sanity: every named net has >= 2 nodes, test points on the right nets
    for name, nodes in nets.items():
        assert len(nodes) >= 2, f"floating net {name}: {nodes}"
    d = summary["design"]
    print(f"R={d['R_sk_ohm']:.4g} C1={d['C1_farad']*1e12:.0f}p C2={d['C2_farad']*1e12:.0f}p fc={d['fc_hz']/1e3:.2f} kHz Q={d['q']:.3f} "
          f"sim -3 dB={d['f_minus3db_sim_hz']/1e3:.1f} kHz passband {d['passband_36_44k_gain_db_min']:.2f}..{d['passband_36_44k_gain_db_max']:.2f} dB")
    for r in summary["response"]:
        print(f"{r['hz']/1e3:9.1f} kHz  FILTER {r['filter_out_db']:7.2f} dB  OUT {r['opamp_out_db']:7.2f} dB")
    for k, v in summary["expected_profiles"].items():
        print(k, f"DAC {v['dac_vpp']:.2f} Vpp -> OUT {v['opamp_vpp']:.2f} Vpp clip={v['clips']}  ADC pin {v['adc_tap_min_v']:.2f}..{v['adc_tap_max_v']:.2f} V safe={v['adc_tap_safe']} (max amplitude for the tap {v['adc_tap_max_amplitude_pct']:.0f} %)")


if __name__ == "__main__":
    main()
