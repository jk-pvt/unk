# PS 26058 requirement matrix

Prepared 2026-10-02 from the repository state, the automated suite (**138 of 139 tests pass, 1 opt-in build test skipped by default and passing when enabled**; production build passes; both bare-metal ARM images and the combined Arduino sketch build) and the documents it references. Statuses:

- **PASS**: there is evidence of the stated kind. For software items that is a test or a build; for physical items it is a retained measurement.
- **PARTIAL**: something real exists, but it does not yet meet the requirement as the problem statement words it.
- **PENDING**: no evidence yet. This includes anything that needs the board, an oscilloscope, a meter or a printer.

"Physical evidence" is blank where none has been captured. Nothing is marked PASS on the strength of a computed value.

## A. Physical hardware prototype

| Requirement | Implementation | Physical evidence | Software evidence | Measurement | Status |
|---|---|---|---|---|---|
| Existing hardware keeps working with the adaptive engine | Engine runs inside the sensor sketch: TFT, HC-SR04, DS18B20, pressure, turbidity, INA219, IMU unchanged; two conflicts resolved in firmware (sync moved to D2, PA5 not driven) | Not flashed | Sketch compiles; engine copies verified identical to `firmware/src` | none | **PARTIAL** (software only) |
| Embedded platform (STM32, ESP32, TI DSP or FPGA) | NUCLEO-F446RE, bare-metal C, no HAL (`firmware/src/`) | Board is in use on the bench with the sensor/TFT image | Both ARM images link (adaptive 34,216 bytes) | n/a | **PASS** |
| Physical, self-contained prototype | Nucleo + sensors + TFT on the mounted assembly (`docs/PROTOTYPE_MODEL.md` photos) | Photos show the rig; the adaptive transmitter image has **not** been flashed | n/a | none | **PARTIAL** |
| Low power / hardware-level optimisation | Timer-paced DMA streaming, `wfi` sleep, pulse-only TIM6, spare-buffer synthesis | none | Architecture in `firmware/src/main.c`; `engine.cpuLoad` reported | no current measured | **PARTIAL** |

## B. Embedded firmware engine

| Requirement | Implementation | Physical evidence | Software evidence | Measurement | Status |
|---|---|---|---|---|---|
| Firmware in C/C++ | `firmware/src/*.c` | n/a | Builds with `-Wall -Wextra`; host builds run under ASan/UBSan in `tests/control.test.js` | n/a | **PASS** |
| Hardware timer | TIM6 at 84 MHz, ARR 83 → 1 MS/s trigger | Not run on the adaptive image | `_Static_assert` on clock division; register map review | none | **PENDING** |
| DMA to DAC without CPU per-sample work | DMA1 Stream 5 channel 7 → DAC1 DHR12R1, PA4; double buffer; error and underrun latch | Not run on the adaptive image | Same | no scope capture, no 10-minute fault-free run | **PENDING** |
| LFM chirp | `waveform.c`, 32-bit phase accumulator | Running on the board; real DAC output captured by the board's own ADC (not a scope) | Sample-by-sample agreement with `shared/signal.js` (`tests/firmware-twin.test.js`) | MCU ADC capture: centre 42.00 kHz, 4 kHz sweep, 2 ms, 1.15 Vpp as calculated | software **PASS**; board **PARTIAL** (MCU capture only; no external instrument) |
| Geometric sweep | same | Build 6: one HANN and one RECT pulse played and sampled by the board's own ADC | same, plus matched-filter analysis | MCU ADC CAPTURE agrees with the calculation (centroid, bandwidth, width, Vpp, leakage, template match 1.000). **At the policy's 4 kHz sweep a geometric sweep is within about 50 Hz of a linear one (calculated correlation 0.9994), so no capture can tell them apart**; only the 0.33 correlation with Barker separates the classes. HAMMING and BLACKMAN not yet captured | software **PASS**; board **PARTIAL** |
| Phase-coded pulse | Barker-13 | Build 6: four windows played and sampled by the board's own ADC | same, plus matched-filter analysis | MCU ADC CAPTURE: unwindowed peak sidelobe -21.4 dB captured against -21.7 dB calculated (13:1 is -22.3 dB); template match 0.995 to 0.996; class correlation 0.995 against Barker and 0.22 against the sweeps. Duration judged by the central 90 % of energy (the 20 % envelope threshold is unstable for phase-coded pulses, see the evidence record) | software **PASS**; board **PARTIAL** |
| Switchable on the fly | Serial `waveform` command, button B1, spare-buffer swap at pulse boundary | none | `host_control` scheduler and command tests | none | software **PASS**; board **PENDING** |
| Firmware identity | `identity` block `AQUASDR_ADAPTIVE` (new), `classifyFirmware()` | none | `tests/control.test.js`, `tests/hardware-evidence.test.js` | none | **PASS** (software) |

## C. Environmental input and adaptation

| Requirement | Implementation | Physical evidence | Software evidence | Measurement | Status |
|---|---|---|---|---|---|
| Sensors or potentiometers as inputs | **Mounted TDS board on A0 as the environment source, no rewiring** (`arduino/05_sensors_adaptive_tx`, [pin map](PIN_MAP_COEXISTENCE.md)); a pot remains an option for the bare-metal bench image only | Combined image not flashed; TDS still on A0 as mounted | Scaling, labels and dry-probe rejection tested (`tests/control.test.js`); sketch builds | none | **PENDING** |
| Read through the ADC | ADC1 channel 0, 12 bit, 20 ms sampling, TDS 0–2.3 V scaled to 0–100 %, rail rejection | Not run | New `adc` telemetry (raw, millivolts, filtered level) tested in `tests/control.test.js` | no raw-vs-multimeter record | **PENDING** |
| Adapt centre frequency / bandwidth | CLEAR 42/4, TRANSITION 40/2, MURKY 38/1 kHz | none | `adaptation` and `control` tests; web and A0 paths proved equivalent | none | software **PASS**; physical **PENDING** (web-path policy sweep script `scripts/policy-range.mjs` and A0 session `scripts/a0-session.mjs` ready; switching points from the C engine in `docs/evidence/a0-policy-table.json`) |
| Adapt pulse duration | 2 / 4 / 8 ms | none | same | none | software **PASS**; physical **PENDING** |
| Adapt amplitude | 35 / 50 / 62 % of half scale | none | same | none | software **PASS**; physical **PENDING** |
| "Instant" response | 0.25 EMA, 60 ms qualification, applied at next pulse boundary (≤ 100 ms) | none | scheduler tests | firmware-reported `decisionToOutputMs` only, not scope-measured | **PARTIAL** (by design not microsecond-instant; documented) |

## D. Analog conditioning

| Requirement | Implementation | Physical evidence | Software evidence | Measurement | Status |
|---|---|---|---|---|---|
| Digital window (Hamming / Hann / Blackman) | RECT, HANN, HAMMING, BLACKMAN in `waveform.c` | All four captured from the real DAC output by the board's own ADC | Window shapes match `shared/signal.js` in the twin test | MCU ADC capture: leakage -14.6 dB RECT, about -35 dB HANN, HAMMING and BLACKMAN, matching the calculation within noise; **no external instrument** | software **PASS**; board **PARTIAL** (MCU capture only) |
| Low-pass filter | 2nd-order Sallen-Key Butterworth, fc 70.7 kHz (`hardware/analog/`) | **Not built** | Netlist solved: −0.20 to −0.50 dB over 36–44 kHz, −45 dB at 956 kHz; independent JS model agrees (`tests/afe-tap.test.js`); biased, clamped MCU ADC tap designed and its capture/compare pipeline tested on synthetic data | none yet; capture procedure ready in commissioning §9A | **PARTIAL** (design only) |
| Operational amplifier | TLV9062 dual, gain ×1.5, 5 V supply, datasheet limits checked | **Not built** | Simulated; one topology error found and fixed; stage output re-centred and clamped for the ADC tap (pin range 0.16 to 3.14 V on all policy profiles) | none yet; capture procedure ready in commissioning §9A | **PARTIAL** (design only) |
| Schematic | `aquasdr_afe_schematic.svg`, `aquasdr_afe.cir`, `aquasdr_afe.net`, BOM | n/a | Netlist connectivity asserted by the generator | n/a | **PARTIAL** (no `.kicad_sch`; netlist imports into KiCad PCB Editor) |
| Breadboard or PCB build | — | none | — | no DC checks, no response | **PENDING** |

## E. Output validation

| Requirement | Implementation | Physical evidence | Software evidence | Measurement | Status |
|---|---|---|---|---|---|
| Output on an oscilloscope / spectrum analyser | Capture importer, calculated-vs-measured comparison, four-window table, Validation panel (`shared/bench-capture.js`, `src/pages/BenchEvidence.jsx`) | **No capture imported** | 11 tests incl. API: synthetic captures recover frequency, duration, Vpp; mismatches are rejected; empty state reads AWAITING MEASUREMENT | none | tooling **PASS**; evidence **PENDING** |
| Clean, low-distortion FFT | Same analysis on the measured capture | none | n/a | none | **PENDING** |
| Window effect shown on hardware | RECT/HANN/HAMMING/BLACKMAN comparison procedure (§8) | none | analysis detects window ordering on synthetic inputs only | none | **PENDING** |
| MCU electrical capture (the board sampling its own DAC pin, no scope needed) | `CAPTURE_DAC`, ADC3 + TIM8 + DMA2, host analysis and Validation panel (`firmware/src/capture.c`, `arduino/05_sensors_adaptive_tx/AdaptiveTx.h`, `shared/mcu-capture.js`, `src/pages/McuCapture.jsx`) | Build 6 flashed; **thirteen MCU ADC captures** (twelve pulse, one train) on the real board, output off after each | Wire format, gating, analysis, comparison, CSV, store, routes and UI labelling covered by 28 tests | Pulse mode, four windows: centre frequency, sweep bandwidth, 20 %-envelope width, Vpp and leakage agree with the calculation (`docs/evidence/combined-image-first-bringup.md`). Train mode: two pulses 99 ms apart plus isolated spikes of unknown source. **Labelled MCU ADC CAPTURE, never oscilloscope** | pulse mode **PASS**; train mode **PARTIAL**; external instrument **PENDING** |
| Display separates calculated from measured | Three labelled origins; MEASURED only from uploaded files | n/a | `tests/bench-api.test.js` | n/a | **PASS** |

## F. Physical form factor

| Requirement | Implementation | Physical evidence | Software evidence | Measurement | Status |
|---|---|---|---|---|---|
| 3D-printed or fabricated enclosure | `hardware/enclosure/` (`params.json`, `pod.scad`) | **Not rendered, printed or assembled** | `check_fit.py` passes on the parameters; battery and analog-board sizes are placeholders | none | **PENDING** |
| AUV hull-slot form factor | 116 mm × 184 mm cylindrical cartridge, end caps with O-ring groove | none | fit-check only | none | **PARTIAL** (design intent) |

## G. Power evidence

| Requirement | Implementation | Physical evidence | Software evidence | Measurement | Status |
|---|---|---|---|---|---|
| Measured idle / active / pulse power | Meter-reading entry, derived energy per ping and pulse (`shared/bench-power.js`) | No readings | 4 unit tests plus API round trip | none | tooling **PASS**; evidence **PENDING** |
| INA219 path | Not available on the adaptive image (no I²C code). Arduino image has VIN± unconnected | none | n/a | none | **PENDING** (external meter planned) |

## Console and honesty

| Requirement | Status | Evidence |
|---|---|---|
| Console never presents modelled data as measured | **PASS** | `tests/bench-api.test.js`, existing provenance tests, AWAITING MEASUREMENT empty states |
| Existing verified software not broken | **PASS** | 109 of 110 tests pass with the 1 skipped being the opt-in Arduino compile, which passes when enabled (89 at the start of this milestone); production build passes |

## Tally

32 requirement rows (counted from the tables above) plus 2 console rows:

| Outcome | Rows |
|---|---|
| PASS outright (platform, C firmware, firmware identity, calculated-vs-measured separation) | 4 |
| Software PASS and board **PARTIAL** (LFM chirp, the digital windows, geometric sweep, Barker-13: real DAC output captured by the board's own ADC, no external instrument) | 4 |
| Mixed: tooling PASS, MCU capture PASS in pulse mode, train mode PARTIAL, external instrument PENDING (the MCU capture row) | 1 |
| Software PASS, **physical PENDING** (timer/DMA/adaptation on the board, tooling awaiting captures or readings) | 6 |
| PENDING (no evidence of any kind: timer, DMA, pot wiring, ADC, build, FFT, enclosure, INA219) | 9 |
| PARTIAL (prototype, coexistence with mounted hardware, low power, filter design, op-amp design, schematic, "instant" response, hull-slot form) | 8 |
| Console rows, both PASS | 2 |

The MCU ADC capture is real data from the board's real DAC pin, which moves LFM and the windows from "software only" to "running and captured on the board". It can only ever read "MCU ADC CAPTURE": it cannot close the external oscilloscope / spectrum-analyzer requirement, which stays PENDING, and it supports no distortion claim. This matrix must not be read as "PS 26058 complete".

## How a PENDING row becomes PASS

Follow `docs/HARDWARE_COMMISSIONING.md`: flash, check identity, wire the pot and log raw vs multimeter, capture PA4, import captures for the four windows, build and check the analog board and import TP2/TP3, read the power meter, print and fit-check the pod. Each step stores a file or a record; update the row and cite it.
