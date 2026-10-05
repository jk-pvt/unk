# Analog front end: PA4 → filter → TLV9062 → scope

Computed design, **not built and not measured**. Regenerate every file here with `npm run afe:design` (needs `python3` and `numpy`).

| File | What it is |
|---|---|
| `design_afe.py` | Picks E-series values, emits the netlists and BOM, solves the netlist for the response, writes `design_results.json` |
| `aquasdr_afe.cir` | SPICE netlist (editable, simulatable in ngspice/LTspice; op-amp is a one-pole VCVS) |
| `aquasdr_afe.net` | KiCad legacy netlist. Import with PCB Editor → File → Import Netlist. A `.kicad_sch` was **not** produced: no KiCad was available to validate one, and an unvalidated schematic file is worse than none |
| `aquasdr_afe_schematic.svg` | Human-readable drawing with the net names `DAC_PA4`, `FILTER_OUT`, `OPAMP_OUT`, `VCC`, `GND` and test points TP1–TP4 |
| `aquasdr_afe_bom.csv` | Bill of materials |
| `design_results.json` | Computed response, gains by kHz (used by the capture importer) and expected output amplitudes per profile |

Design summary (all computed): 2nd-order unity-gain Sallen-Key Butterworth, R = 4.75 kΩ, C1 = 680 pF, C2 = 330 pF, fc 70.7 kHz, Q 0.718; AC-coupled gain stage ×1.5 biased at 2.5 V; 5 V single supply. Passband 36–44 kHz droop −0.20 to −0.50 dB through the filter; −9.7 dB at 120 kHz; −45 dB at 956 kHz. Full procedure and DC checkpoints: [docs/HARDWARE_COMMISSIONING.md](../../docs/HARDWARE_COMMISSIONING.md#9-analog-front-end-filter--tlv9062).

The simulation caught one error in an earlier draft (a decoupling capacitor on the amplifier input shunted the signal, giving 2.7 dB instead of 3.5 dB). It was fixed with an isolating resistor (R9). The model assumes a 0 Ω DAC source, ideal passives and no board parasitics.

**MCU ADC tap (added):** `SCOPE_OUT → R10 1 kΩ → ADC_IN → Nucleo A5`, re-centred on 1.65 V (R11/R12 from the Nucleo 3V3 pin, C9, jumper JP1 position 2-3) and clamped by D1 BAT54S, so the board's own ADC can sample the stage without a scope. Computed pin range 0.16 to 3.14 V for every policy profile; the bridge refuses a capture predicted outside 0.10 to 3.20 V. Procedure: [§9A](../../docs/HARDWARE_COMMISSIONING.md#9a-capture-the-analog-stage-with-the-mcu-adc-no-oscilloscope). `shared/afe-model.js` is an independent JavaScript model of the same stage, checked against the netlist solution in `tests/afe-tap.test.js`. Still **not built and not measured**.

Test points: TP1 `DAC_PA4`, TP2 `FILTER_OUT`, TP3 `OPAMP_OUT`, TP4 `GND`. Connectors: J1 (DAC + GND in), J2 (5 V + GND), J3 (scope out).
