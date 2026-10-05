# AquaSDR hardware commissioning — PS 26058 bench milestone

**Status of this document: procedure and expected results, prepared 2026-10-02. No step in it has been performed on the board.** Every "expected" value below is computed from the firmware source or the analog design; none is a measurement. Measured results go into the console (Validation → Bench evidence) or `data/bench/`, and only there.

Scope of the milestone: `STM32 → DAC1 (PA4) → filter + TLV9062 → oscilloscope`, with an environment source driving the adaptation. No transducer, no power driver, no wet test.

> **Route A (recommended, no rewiring): the combined image.** The payload is mounted and cannot be opened. `arduino/05_sensors_adaptive_tx` runs the adaptive engine inside the existing sensor sketch, so TDS stays on A0, TFT on D13, HC-SR04 on D7 and every other sensor keeps working. A0 (the mounted TDS board) or a web command feeds one policy. The full current-versus-required pin map and every resolution is in [PIN_MAP_COEXISTENCE.md](PIN_MAP_COEXISTENCE.md). **Sections 3 (wiring) and 6 (potentiometer) below describe Route B, the bare-metal bench image, which needs rewiring and does not apply to the mounted payload.** Sections 1, 4 (flashing method), 5, 7–13 apply to both routes. Anywhere a section says "pot", Route A uses the TDS board instead.

Contents: [1 Safety](#1-safety) · [2 Firmware image](#2-firmware-image) · [3 Wiring and pin map](#3-wiring-and-pin-map) · [4 Flashing](#4-flashing) · [5 Boot and identity check](#5-boot-and-identity-check) · [6 A0 potentiometer](#6-a0-potentiometer-and-adc-check) · [7 PA4 scope check](#7-pa4-scope-check) · [8 Window comparison](#8-window-comparison) · [9 Analog front end](#9-analog-front-end-filter--tlv9062) · [10 Scope capture and FFT](#10-scope-capture-and-fft-validation) · [11 Power](#11-power-measurement) · [12 Enclosure](#12-enclosure) · [13 Demo run order](#13-judging-demo-run-order) · [14 Troubleshooting](#14-troubleshooting)

## 1. Safety

- Bench power only: USB into the Nucleo. No battery, no motor/H-bridge module, no transducer connected during this milestone.
- **Never drive a piezo or transducer from PA4 or from the TLV9062 stage.** The DAC buffer wants a load of 5 kΩ or more; the op-amp output is a signal stage, not a power driver. The H-bridge module from the earlier plan has not been characterised at 40 kHz.
- The TLV9062 absolute maximum supply is 6 V (datasheet, checked 2026-10-02). Power it from the Nucleo **5V pin only**, never from the 11.1 V pack or the MP1584 before it is set and measured.
- `OPAMP_OUT` and `SCOPE_OUT` swing up to about 4.5 V and sit at 2.5 V DC. **Do not connect them to any Nucleo pin directly** (the MCU is 3.3 V logic). The only allowed connection is `ADC_IN` from the biased, clamped ADC tap in §9A.
- Check polarity and 5 V to GND resistance with a multimeter (it must not read near 0 Ω) before powering the analog board.
- Scope ground clip goes to the board ground at one point. Do not clip it to any other net.
- Start at the lowest profile amplitude (CLEAR, 35 %). Keep DAC amplitude at or below 85 %.
- AGENTS.md rule still applies: the mounted sensor/TFT firmware and wiring stay intact unless you decide, for this milestone, to flash the adaptive image. That is your call and is not made by any script here.

## 1A. Route A: combined image on the mounted payload

| Item | Value |
|---|---|
| Sketch | `arduino/05_sensors_adaptive_tx/` (`npm run arduino:sync` copies the shared C engine in) |
| Firmware string | `AquaSDR sensors + adaptive TX 0.4.0`; `identity.id = AQUASDR_ADAPTIVE`, `identity.platform = ARDUINO_COMBINED`, `adc.sensor = TDS_PROXY` |
| Build | `npm run arduino:build` (needs the Arduino IDE's `arduino-cli`; compile only, never uploads). Always compile with a fresh `--build-cache-path`, or the core may be reused without `build_opt.h` |
| Build 1 (flashed, then replaced) | `releases/build1-flashed-2026-10-02-a1af7e76.bin`, SHA-256 `a1af7e769775a4ffa9beef013673903a6f8e01b2d0f13005fbcd6218620d2e45`. Telemetry correct; **lost 27–42 % of long UART commands** |
| Build 2 (**on the board now**) | `releases/build2-flashed-2026-10-02-8a48fd35-RX-BROKEN.bin`, SHA-256 `8a48fd3594d57aac86f1cbebc6238a5ac32b8e8c1ffdd43aa2e05553a9c4ae12`. Flashed and verified. Telemetry and sensors fine, output off, DAC quiet. **Receives no commands: telemetry shows `UART: DMA RX 0 B 27 ERR`.** Cause: RX was put on DMA1 Stream 7 ch 6, but USART2_RX is Stream 5 ch 4, the DAC's stream |
| Build 3 (flashed, then replaced) | `releases/build3-flashed-2026-10-02-e4161222.bin`, SHA-256 `e4161222fb874db7e4249cf924bab07e27b7020dad7b7d41fb4d5ec90e6b8fed`. Core RX + DMA TX. **64-byte RX ring by mistake** (stale core cache): lost 23 % of 300 bridge commands |
| Build 4 (**on the board now**) | `releases/build4-flashed-2026-10-02-5b9ebd13.bin`, SHA-256 `5b9ebd13c015b775b6761051d2c43ab1ee3daa87417d26bf26b8bdeaf7933e94`, 100,996 bytes. Adds the AquaSDR logo (boot splash and the TX STATUS page), reports telemetry every 1 s. Same 64-byte ring defect |
| Build 5 (flashed, then replaced) | `arduino/05_sensors_adaptive_tx/build5/05_sensors_adaptive_tx.ino.bin`, SHA-256 `482ebd4c7f665e61235cc11f2189a58c8a26d988d0c19651645515b3164319c9`, 100,996 bytes. Build 4 with the 512-byte RX ring actually compiled in. Flashed, verified, **330 of 330 bridge commands acknowledged, 0 lost, 0 invalid** (`docs/evidence/uart-reliability-build5.json`). After any SWD flash or reset the Mac-to-board UART direction has repeatedly been dead until the USB cable is replugged: replug after flashing |
| Build 6 (**on the board now**) | `arduino/05_sensors_adaptive_tx/build6/05_sensors_adaptive_tx.ino.bin`, SHA-256 `7210091b1d73427e5fc7bd4f030e7f2cacd793a847947a767b32284f389deca5`, 103,468 bytes. Build 5 plus `CAPTURE_DAC` (the MCU ADC CAPTURE path). Flashed, verified, ten captures taken (see §10A and the evidence file) |
| Rollback | `arduino/04_all_sensors/rollback/`: the installed flash read back over ST-LINK (SHA-256 `bfa57601…fcd`, 128 KB) plus a source build of `04_all_sensors` that is byte-identical to it (70,708 bytes, SHA-256 `7bfdfce0…4be0`) and the pre-flash telemetry baseline. Restore with `openocd … program <file> 0x08000000 verify reset exit`, or re-upload `04_all_sensors` |
| Memory | 91,192 bytes flash (17 %), 53,680 bytes RAM (40 %) |
| Flashing | Same way the sensor sketch was installed: Arduino IDE (board NUCLEO-F446RE, upload) or drop the `.bin` on the `NOD_F446RE` drive. **Do this only when you decide to; nothing here flashes.** `04_all_sensors` remains in the repo, unmodified, as the way back |

Wiring: **none changed.** Optional later, from outside: scope probe on A2/PA4 and GND; D2/PA10 is the spare sync output.

Environment sources, one policy (check which is active on the console, Adaptation page):

1. **Web**: pick a preset, Apply, wait for qualification, Start. Works with no sensor input at all.
2. **A0 / TDS**: switch the source to the A0 input. The mounted TDS board's 0–2.3 V maps to 0–100 %: CLEAR below 35 % (0.81 V), TRANSITION 35–70 %, MURKY from 70 % (1.61 V); hysteresis 40/75 up, 30/65 down. Measured: a dry probe in air reads 21–30 mV (about 1.1 %), which is valid and selects CLEAR; only ≤ 12 counts (about 10 mV) is rejected. This is a TDS proxy, **not turbidity**.

Check list for Route A first run (nothing here has been done):

| Check | Expected |
|---|---|
| Identity | `AQUASDR_ADAPTIVE`, platform `ARDUINO_COMBINED`, build matches |
| Sensors unaffected | TFT animates, temperature/pressure/turbidity/power fields still report as in the sensor image |
| Output at boot | Disabled; PA4 about 1.65 V; no pulses |
| ADC chain | `adc.raw`, `millivolts`, `filteredLevel` track a multimeter on the TDS output; `fullScaleCounts` 2854 |
| Web preset | CLEAR → MURKY changes frequency, bandwidth, duration, amplitude in telemetry and on the scope |
| A0 | Wet probe, salt added: level rises, policy changes at the thresholds, with hysteresis |
| Self-check | `health.LOOPBACK` reads `ONLINE … VPP` after the first pulse (A2 jumpered to A5) and `DAC_REGISTER` shows a code span |
| Faults | `engine.underruns` 0, `health.DMA` not FAULT after ten minutes |
| Pulse gaps | Telemetry timing shows about a 130 ms stall at a TFT page change. Confirm on the scope (sync on D2 or PA4) that pings pause no longer than that |

## 2. Firmware image

| Item | Value |
|---|---|
| Source | `firmware/src/*` (adaptive build: `-DAQUASDR_ADAPTIVE_INPUT=1`) |
| Firmware string | `aquasdr-fw 0.3.3 adaptive environment control` |
| Identity block | `identity.id = AQUASDR_ADAPTIVE`, `version`, `build`, `capabilities` |
| Build id | git `describe --always --dirty` at build time. The binary below was built from uncommitted source, so its id is `8760478-dirty` |
| Image | `firmware/build-adaptive/aquasdr.bin`, 34,216 bytes (text 34,120, data 84, bss 93,760) |
| SHA-256 (this build) | `bb81a95fa185be023798a05c1bbf1a8d114981d514ea1fdd195ec491eeaef65a` |
| Ordinary bring-up image | `firmware/build/aquasdr.bin`, SHA-256 `682ce67e…`, a different program |

**Commit first, then rebuild**, so the build id is a real revision and the hash is the one you flash:

```bash
make -C firmware adaptive -B PREFIX=/Users/sudharsan/Library/Arduino15/packages/STMicroelectronics/tools/xpack-arm-none-eabi-gcc/14.2.1-1.1/bin/arm-none-eabi-
shasum -a 256 firmware/build-adaptive/aquasdr.bin
```

Record the printed hash and the `build` value you later see in telemetry in the results log (section 13).

What changed in this milestone's firmware, and why:

- `identity` block in every adaptive packet so the console can tell `AQUASDR_ADAPTIVE` from the Arduino sensor bridge and from unknown firmware (`classifyFirmware()` in `shared/hardware-evidence.js`).
- `adc` block while the A0 dial is the source: `raw`, `millivolts` (integer-truncated), `filteredLevel` (the 0.25 EMA the policy actually decides on, in %), `valid`, `candidate`. Before this, the board never reported the raw count or the filtered level, so the ADC chain could not be verified from the console.
- Packet size grew from about 1.3 KB to about 1.6 KB. At 115200 baud that is about 143 ms of a 250 ms telemetry interval; commands and ACKs still interleave (checked by the existing control tests).
- Waveform engine, adaptation policy and DMA/DAC code are **unchanged**.

Existing health fields already report `TIMER`, `DMA`, `DAC`, `ADC` state (`ACTIVE TIM6 1.000 MHz`, `ACTIVE BURST`, `ACTIVE DAC1 PA4`, `READY PA0 BENCH INPUT`).

## 3. Wiring and pin map (Route B, bare-metal bench image only)

**Not needed for the mounted payload; see Route A.**

Power the Nucleo from USB. Disconnect everything not listed.

| Signal | Nucleo pin | Header | Goes to |
|---|---|---|---|
| DAC output | PA4 | CN8 A2 | `J1.1` / `TP1 DAC_PA4` on the analog board, and scope CH1 probe |
| Pulse sync | PA8 | CN9 D7 | scope CH2 (trigger, rising edge). Disconnect HC-SR04 TRIG |
| Environment dial | PA0 | CN8 A0 | potentiometer wiper (section 6). **Disconnect the TDS signal** |
| Ping LED | PA5 | LD2 (on board) | nothing external. Disconnect TFT D13 (SCK) |
| Telemetry | PA2/PA3 | ST-LINK VCP | USB cable to the Mac, 115200 8N1 |
| Analog supply | 5V | CN6 | `J2.1` (VCC) on the analog board |
| Ground | GND | any | `J2.2`, `J1.2`, scope ground clip, pot ground |
| Output mode button | PC13 | B1 | short press cycles modulation, hold 1 s toggles output |

Unchanged, but **not used** by this image: TFT, HC-SR04, sensors, INA219. They stay physically present; disconnect only the three signals named above (A0 TDS, D7 TRIG, D13 SCK). `arduino/README.md` has the full wire-by-wire table to restore the sensor image afterwards.

## 4. Flashing

Do this only after the wiring above is done and you have decided to replace the sensor/TFT image. Close the console's serial connection first.

```bash
make -C firmware flash-adaptive PREFIX=/Users/sudharsan/Library/Arduino15/packages/STMicroelectronics/tools/xpack-arm-none-eabi-gcc/14.2.1-1.1/bin/arm-none-eabi-
```

That copies the image onto the mounted `/Volumes/NOD_F446RE` drive. If the drive is not mounted, use OpenOCD to program and verify the ELF:

```bash
/Users/sudharsan/Library/Arduino15/packages/STMicroelectronics/tools/xpack-openocd/0.12.0-6/bin/openocd \
  -s /Users/sudharsan/Library/Arduino15/packages/STMicroelectronics/tools/xpack-openocd/0.12.0-6/openocd/scripts \
  -f interface/stlink.cfg -f target/stm32f4x.cfg \
  -c "program /Users/sudharsan/Downloads/AquaSDR/firmware/build-adaptive/aquasdr.elf verify reset exit"
```

To restore the sensor/TFT image afterwards, re-upload `arduino/04_all_sensors` and restore the three disconnected wires.

## 5. Boot and identity check

`npm start`, open http://127.0.0.1:4318, Hardware → pick `/dev/cu.usbmodem…` → Connect.

| Check | Expected | Where |
|---|---|---|
| Firmware | `aquasdr-fw 0.3.3 adaptive environment control`; `identity.id = AQUASDR_ADAPTIVE`; `build` matches what you built | Hardware page / raw telemetry |
| Output at boot | Disabled; DAC parked at mid-scale (about 1.65 V on PA4, **no** pulses on the scope) | scope CH1 |
| Health | `TIMER`, `DMA`, `DAC` read INHIBITED while disabled, `ADC` reads READY PA0 BENCH INPUT | Hardware |
| Faults | `engine.underruns = 0`, no `FAULT` text | Hardware |
| Sensor-bridge guard | The console must not offer DAC commands for the Arduino bridge or unknown firmware | Hardware |

If the identity block is missing you are looking at a different image (the Arduino bridge string is `AquaSDR Arduino sensor bridge`).

## 6. A0 potentiometer and ADC check (Route B only; Route A uses the TDS board)

**Wire the pot with end resistors.** The firmware rejects raw counts ≤ 12 or ≥ 4083 as rail faults, so a bare pot at its end stops will *inhibit output*. Use:

```text
3V3 ──[ 1 kΩ ]──┬── pot end 1
                 │
            10 kΩ pot  (wiper → A0 / PA0)
                 │
GND ──[ 1 kΩ ]──┴── pot end 2
```

Wiper range is 0.275–3.025 V (8.3 %–91.7 % of full scale). Use 3V3, never 5V on A0.

Expected for the policy (initial thresholds 35/70 %, then hysteresis 40/75 up and 30/65 down, 60 ms qualification; 0.25 EMA):

| Pot travel | Wiper V | Expected raw | Expected `filteredLevel` | Expected policy |
|---|---|---|---|---|
| 0 % | 0.275 | about 341 | 8.3 % | CLEAR (42 kHz, 4 kHz, 2 ms, 35 %) |
| 25 % | 0.963 | about 1194 | 29.2 % | CLEAR (moving down from TRANSITION needs < 30 %, so this is borderline; record the direction) |
| 50 % | 1.650 | about 2048 | 50.0 % | TRANSITION (40 kHz, 2 kHz, 4 ms, 50 %) |
| 75 % | 2.338 | about 2901 | 70.8 % | MURKY on first qualification, but **TRANSITION if you arrived from below**: moving up needs ≥ 75 % level (hysteresis). Record the direction |
| 100 % | 3.025 | about 3754 | 91.7 % | MURKY |

Real pots and resistors have tolerance, so expect a few percent of scatter. Compare against the console's `adc.raw`, `adc.millivolts` and a multimeter on the wiper. **Record all three at each of the five positions.** If raw and the multimeter disagree by more than about 1 %, you have a wiring or reference problem, not a firmware one.

In the console: Adaptation → source **A0 dial**. Selecting a source stops output and resets qualification; wait for `qualified`, then Start (or hold B1 for 1 s). Sweep the pot slowly and watch the decision change; the telemetry `decisionToOutputMs` is firmware time from decision to pulse start, **not** a scope measurement.

Note on "instant" adaptation: the tested policy filters (0.25 EMA, every 20 ms), qualifies a change for 60 ms and applies at the next pulse boundary (≤ 100 ms ping interval). Typical total response is therefore a few hundred milliseconds. That is deliberate (hysteresis stops chatter near thresholds). Do not describe it as microsecond-instant.

## 7. PA4 scope check

Scope setup:

| Setting | Value |
|---|---|
| CH1 | PA4 / TP1, 1× or 10× probe (note which), **DC coupling**, 500 mV/div |
| CH2 | PA8 / D7 sync |
| Trigger | CH2 rising edge, 100 ms ping interval, normal mode |
| Timebase | 1 ms/div for 8 ms pulses (500 µs/div for 2 ms). Record length ≥ 20 ms |
| Sample rate | at least 5 MS/s (the DAC runs at 1 MS/s) |
| Export | CSV with time and volts, CH1 |

Expected at PA4 with output enabled (computed from firmware: DAC mid-scale 1.65 V, amplitude is a percentage of half scale, code range ±2047, 12 bit, 3.3 V reference):

| Profile | Pulse | Peak-to-peak | Carrier / sweep | Envelope |
|---|---|---|---|---|
| CLEAR | 2 ms | 1.15 V | 40–44 kHz up-chirp | Hann bell, no edge step |
| TRANSITION | 4 ms | 1.65 V | 39–41 kHz | same |
| MURKY | 8 ms | 2.05 V | 37.5–38.5 kHz | same |

Between pulses PA4 rests at about 1.65 V. Sync (PA8) is high for exactly the pulse length. Pulses repeat every 100 ms. Stop output: PA4 returns to 1.65 V and `underruns` stays 0.

Pass criteria for "physical DAC output": a pulse of the right length, amplitude within ±10 %, a recognisable windowed chirp, correct stop, **zero DMA/underrun faults after a ten-minute run**. This is *DAC output*, not transducer output; do not claim acoustic power.

## 8. Window comparison

The window is chosen by the web path (Adaptation → Web control → window select → Apply), or by serial `waveform` command. For a clean comparison hold everything else fixed: use the **MURKY** preset (8 ms) and the LFM mode. For each of RECT, HANN, HAMMING, BLACKMAN:

1. Select the window, Apply, Start. Confirm `waveform.window` in telemetry.
2. Capture CH1 (PA4) as in section 7. Save as `pa4-<window>.csv`.
3. Import:

```bash
npm run bench -- capture pa4-HANN.csv --point PA4 --profile MURKY --window HANN --instrument "<scope model>" --probe 10x
```

or use Validation → Bench evidence → Import oscilloscope capture. The tool runs the same analysis on your capture and on the firmware's calculated pulse, then lists frequency, bandwidth, duration, Vpp and out-of-band leakage side by side.

What to expect: edges of RECT show a hard start/stop and visibly higher spectral skirts; HANN, HAMMING and BLACKMAN round the envelope and lower the leakage. Hann/Hamming/Blackman nominal sidelobes are −31.5/−42.7/−58.1 dB and RECT −13.3 dB for a plain tone; the chirp's skirts differ, which is why the table compares *your measured* leakage with the *calculated* leakage rather than quoting those. **The ordering you capture is the evidence.** The software test only proves the analysis detects the ordering on synthetic inputs.

Suggested acceptance tolerances (engineering choices in `shared/bench-capture.js`, not PS limits): centroid and FFT peak within 0.5 kHz (peak within one sweep width), duration within 5 %, Vpp within 10 %, leakage within 6 dB of calculated.

## 9. Analog front end (filter + TLV9062)

Design files in `hardware/analog/`: `design_afe.py` (design, simulation, outputs), `aquasdr_afe.cir` (SPICE netlist), `aquasdr_afe.net` (KiCad legacy netlist for PCB Editor import), `aquasdr_afe_schematic.svg`, `aquasdr_afe_bom.csv`, `design_results.json`. Regenerate everything with `npm run afe:design`.

**What it is:** `PA4 → R1, R2, C1, C2 + U1A (2nd-order unity-gain Sallen-Key Butterworth) → C3 DC block → U1B (non-inverting, gain 1.5, biased at 2.5 V) → 100 Ω + C6 → scope`.

| Part | Value | Part | Value |
|---|---|---|---|
| R1, R2 | 4.75 kΩ | R5 (Rf) | 10 kΩ |
| C1 (feedback) | 680 pF C0G | R6 (Rg) | 20 kΩ |
| C2 (shunt) | 330 pF C0G | C5 | 10 µF, + toward U1 pin 6 |
| C3 | 1 µF film or X7R | R7 | 100 Ω |
| R3, R4, R9 | 100 kΩ | C6 | 1 µF film or X7R |
| C4 | 100 nF | R8 | 100 kΩ |
| C7, C8 | 100 nF, 10 µF at U1 pins 8/4 | U1 | TLV9062 (non-shutdown) on SOIC-8 adapter |

**Why these values** (the 60 kHz proposal in the earlier README was not assumed): the cutoff is chosen from three requirements and checked by solving the emitted netlist, with the op-amp as a one-pole VCVS at the datasheet's 10 MHz unity-gain bandwidth.

| Requirement | Result (computed, not measured) |
|---|---|
| < 1 dB droop across the 36–44 kHz bench band (CLEAR sweep tops out at 44 kHz) | −0.20 dB at 36 kHz to −0.50 dB at 44 kHz through the filter |
| Some attenuation of the 3rd harmonic (120 kHz) | −9.7 dB |
| Strong rejection of the 1 MS/s DAC image (956 kHz) | −45.4 dB |
| fc and Q from E96/E12 values | fc 70.7 kHz (simulated −3 dB 72.2 kHz), Q 0.718 |
| Whole chain gain across 36–44 kHz | +3.04 to +3.32 dB (×1.42 to ×1.46) |
| DAC load seen | ≥ 4.75 kΩ (STM32F446 buffered DAC wants ≥ 5 kΩ at DC; at 40 kHz R1 plus the capacitor network is above that. Fit a 10 kΩ R1/R2 variant if the DAC output looks loaded) |
| Supply | 5 V, 2 × 0.538 mA typical quiescent ≈ 1.1 mA |
| Largest expected output | MURKY at 2.05 V DAC Vpp → 2.98 Vpp, 1.0 V of headroom; even a full-range DAC swing stays inside the 0–5 V rails |

TLV9062 facts used (from TI's datasheet text, checked 2026-10-02): supply 1.8–5.5 V, absolute maximum 6 V, rail-to-rail input and output, unity-gain stable, 10 MHz unity-gain bandwidth, 6.5 V/µs slew (VS = 5 V, G = +1), 538 µA quiescent, 100 Ω open-loop output impedance.

Expected scope amplitudes by profile (computed through the linear model of the whole chain): CLEAR/HANN 1.65 Vpp, TRANSITION/HANN 2.38 Vpp, MURKY/HANN 2.98 Vpp at `OPAMP_OUT`; `design_results.json → expected_profiles` has all 12 combinations.

**Build and check, in this order, with the Nucleo unpowered between steps:**

1. Build on breadboard or perfboard, short leads, ground plane or one star ground. Fit C7/C8 right at U1 pins 8/4.
2. Multimeter: no short between VCC and GND. U1 pin 8 = VCC, pin 4 = GND, pins 1/2/3 = U1A (OUT/−/+), pins 5/6/7 = U1B (+/−/OUT).
3. Apply 5 V (Nucleo 5V pin, USB powered), **output disabled**. Expect: VCC 5.00 V; VMID 2.50 V; U1 pin 3 (SK_P) ≈ 1.65 V (DAC parked at mid-scale); FILTER_OUT (TP2) ≈ 1.65 V; OPAMP_OUT (TP3) ≈ 2.50 V; SCOPE_OUT 0 V DC with JP1 on GND (1.65 V with JP1 on VBIAS, see §9A). Supply current about 1–2 mA.
4. Optional function generator at TP1 (0.5 Vpp sine around 1.65 V): expect the gain table above, ×1.5 flat to 10 kHz and ≈ −3 dB (ref. flat) near 72 kHz at TP2.
5. Enable output, MURKY, HANN. Probe TP1, TP2, TP3 in turn: same envelope, amplitudes about 2.05 / 2.0 / 2.98 Vpp. No sustained oscillation, no flat-topping.
6. Capture and import TP2 or TP3 (`--point FILTER_OUT` or `--point OPAMP_OUT`). The importer applies the designed gain at the profile's centre frequency, so a correct build reads within tolerance.

Do not connect a transducer to `SCOPE_OUT` in this milestone.

## 9A. Capture the analog stage with the MCU ADC (no oscilloscope)

**Goal:** turn the chain from `DAC → ADC` into `DAC → filter → TLV9062 → ADC` and compare the board's own readings of the raw DAC with its readings of the stage output. Every number from this is an **MCU ADC capture of the named tap**. It is not an oscilloscope measurement, gives no distortion figure, and does not close the external-instrument requirement. Nothing in this section has been built or captured yet; the numbers below are the designed values.

**Why a tap is needed.** `OPAMP_OUT` sits at 2.5 V DC and `SCOPE_OUT` is AC-coupled around 0 V, so neither may touch the ADC pin (3.3 V maximum). The design now carries a small tap: `SCOPE_OUT → R10 1 kΩ → ADC_IN → Nucleo A5`, with the AC output re-centred on a **1.65 V bias** (R11/R12 10 kΩ from the Nucleo 3V3 pin, C9 100 nF; R8 returns to it through jumper JP1 position 2-3) and **D1 BAT54S** clamping `ADC_IN` to GND and 3V3. The ADC then sees 1.65 V ± the AC swing. Computed pin range with the tap: CLEAR 0.83 to 2.47 V, TRANSITION 0.46 to 2.84 V, MURKY 0.16 to 3.14 V, all inside 0.10 to 3.20 V. The bridge repeats that calculation for the requested waveform and **refuses the capture** if the prediction leaves that range (for example at 100 % amplitude). Start with CLEAR.

**Extra parts beyond §9:** R10 1 kΩ, R11 and R12 10 kΩ, C9 100 nF, D1 BAT54S (SOT-23 on an adapter, or two small Schottky diodes such as BAT43), JP1 (1×3 header and a jumper), J4 (ADC_IN and GND), J5 (3V3 and GND). They are in `hardware/analog/aquasdr_afe_bom.csv` and the netlists.

**Nucleo connections (only these; nothing on the sensor/TFT/HC-SR04 wiring changes, A0, D13 and D7 are not touched):**

| From | To | Note |
|---|---|---|
| A2 (PA4, the DAC) | J1 pin 1 (`DAC_PA4`, R1 input) | **Remove the A2 to A5 jumper** for stage captures; put it back for raw captures |
| A5 (PC0, ADC3 ch10) | J4 pin 1 (`ADC_IN`) | A5 can carry only one source at a time |
| 5V (CN6) | J2 pin 1 | USB powered, about 1.1 mA |
| 3V3 (CN6) | J5 pin 1 | bias source, also the ADC reference supply, so the comparison stays ratiometric |
| GND | J1/J2/J4/J5 pin 2 | one star ground |

**DC checks before A5 is connected (J4 left unconnected, output disabled, DAC parked at mid-scale). Stop and tell me if any is off by more than 5 %:**

| Point | Expect |
|---|---|
| VCC | 5.0 V |
| VMID | 2.50 V |
| VBIAS (R11/R12 junction, also JP1 pin 3) | 1.65 V |
| FILTER_OUT (TP2) | 1.65 V |
| OPAMP_OUT (TP3) | 2.50 V |
| ADC_IN (J4 pin 1) | 1.65 V (C6 blocks the 2.5 V, R8 pulls to VBIAS) |
| Supply current | 1 to 2 mA |

**Capture order.** Each capture enables the output for one pulse and the firmware stops it by itself. The console has to be connected to the bridge (`npm run dev`, `BRIDGE=http://127.0.0.1:4318`).

| Step | Wiring | Command |
|---|---|---|
| 1. Raw baseline, same waveform | A2 to A5 jumper | `npm run mcu:capture -- --preset CLEAR_SHALLOW_REEF --window HANN --tap RAW_DAC` (the stored raw HANN captures from build 6 use the same CLEAR/HANN settings and are paired automatically; retake if the board has been reset or replugged since) |
| 2. Filter only (safest first stage) | A5 to TP2 **through a spare 1 kΩ** | `npm run mcu:capture -- --preset CLEAR_SHALLOW_REEF --window HANN --tap AFE_FILTER` |
| 3. Filter + TLV9062 | A5 to J4 (jumper JP1 on 2-3) | `npm run mcu:capture -- --preset CLEAR_SHALLOW_REEF --window HANN --tap AFE_OUTPUT` |
| 4. All windows through the stage | same as step 3 | `npm run mcu:capture -- --preset CLEAR_SHALLOW_REEF --all-windows --tap AFE_OUTPUT` (needs the raw captures for the same four windows; step 1 with `--all-windows` makes them) |
| 5. Pulse train through the stage | same as step 3 | add `--mode train` (envelope and timing only) |

In the console: Validation → **MCU ADC CAPTURE** → *ADC input is wired to* → **Capture DAC now**. The tap you pick must match the wire; the firmware cannot see it.

**What gets compared (raw DAC against the stage, both MCU ADC captures, with the designed stage's prediction beside them):** peak-to-peak ratio and gain in dB (designed +3.1 dB at 42 kHz, ×1.43), FFT peak, spectral centroid, 99 % occupied bandwidth, 20 % envelope pulse duration, out-of-band leakage, and for information only the quiet-part noise floor in mV RMS and the median spectral floor. The noise floor is limited by the ADC itself (one count is 0.8 mV), so a small difference there means nothing. A stage that is wired wrong, or built with a wrong value, shows up as an OUTSIDE row; one capture cannot say which.

**What this still cannot show:** distortion, absolute volts (assumed 3.3 V reference), the behaviour above half the sample rate (the 956 kHz DAC image the filter is meant to remove is far above what a 500 kS/s ADC can resolve), or the transmitter output connector itself. Those need the external scope and spectrum analyzer.

## 9B. Minimum parts for the analog stage milestone

Not bought, not built. The TLV9062 is the one part already in hand (confirm whether it is a bare SOIC-8 chip, which needs an adapter board, or a breakout). All values below are standard E12/E24 values: with 4.7 kΩ instead of the designed 4.75 kΩ the filter is within 0.03 dB over 36 to 44 kHz (fc 71.5 kHz, Q 0.718, computed with `shared/afe-model.js`), and 20 kΩ is two 10 kΩ in series.

| For the scope milestone (filter and gain stage only) | Qty |
|---|---|
| Resistor 4.7 kΩ (R1, R2) | 2 |
| Resistor 100 kΩ (R3, R4, R8, R9) | 4 |
| Resistor 10 kΩ (R5, and R6 as two in series) | 3 |
| Resistor 100 Ω (R7) | 1 |
| Capacitor 680 pF C0G/NP0 (C1), 5 % is fine | 1 |
| Capacitor 330 pF C0G/NP0 (C2) | 1 |
| Capacitor 1 µF film or X7R, 10 V or more (C3, C6) | 2 |
| Capacitor 100 nF ceramic (C4, C7) | 2 |
| Capacitor 10 µF, 10 V or more (C5: plus side toward U1 pin 6; C8) | 2 |
| TLV9062 on a SOIC-8 adapter or breakout | 1 (in hand) |
| Solderless breadboard or perfboard, jumper wires, 2.54 mm header pins for test points and Nucleo leads | 1 set |
| Multimeter for the DC checks in §9 | 1 (not assumed owned) |
| Borrowed oscilloscope with a ×10 probe (the only way to close the external-instrument requirement) | 1 (loan) |

| Extra, only if you also want the MCU ADC tap of §9A | Qty |
|---|---|
| Resistor 1 kΩ (R10) | 1 |
| Resistor 10 kΩ (R11, R12; counted separately from the three above) | 2 |
| Capacitor 100 nF (C9) | 1 |
| BAT54S dual Schottky on an adapter, or two small Schottky diodes (BAT43, 1N5819) | 1 |
| 1×3 header and a jumper (JP1) | 1 |

No transducer, no high-power driver and no enclosure parts are needed for this milestone. A transducer is a later decision, after the electrical chain is working.

## 10. Scope capture and FFT validation

The console shows three separate things and never mixes them:

| Label | Origin |
|---|---|
| CALCULATED TX | firmware C waveform reference, regenerated on the host |
| MEASURED PA4 | an imported oscilloscope CSV of the DAC pin |
| MEASURED FILTER OUTPUT | an imported CSV of TP2 or TP3 |

An empty slot shows `AWAITING MEASUREMENT`. A record becomes MEASURED only through `POST /api/bench/capture` or `npm run bench -- capture …` with a real file. Each record keeps the file's SHA-256, instrument, probe, point, window, and the calculated reference analysed by the same method. Files are written to `data/bench/` (committed, unlike the rest of `data/`).

FFT: use the scope's own FFT for the live demo, and the imported CSV for the numbers. The importer gates the burst (10 % envelope), zero-pads to about 10 Hz bins, and reports FFT peak, spectral centroid, 99 % occupied bandwidth, −20 dB bandwidth, out-of-band leakage and spectral floor.


## 10A. MCU ADC capture (no oscilloscope needed)

**What it is.** The board samples its own DAC pin. PA4 is jumpered to A5/PC0, which is also ADC input 10, so ADC3 can read the real DAC output. It replaces the old 48-point min/max sampler, which could not resolve a 40 kHz carrier. **It is an MCU ADC CAPTURE, never an oscilloscope or instrument measurement**, and the console labels it that way everywhere. The external-instrument requirement stays PENDING until a real scope or analyzer capture is imported.

**Hardware path (new, separate from the transmit path).** `TIM8 TRGO → ADC3 (channel 10, PC0) → DMA2 Stream 0 → RAM`. The transmit path `TIM6 → DMA1 Stream 5 → DAC1 PA4` and the ADC1 the sensors use are not touched. Pulse mode: 500 kS/s, 6000 samples (12 ms: 0.3 ms pre-roll plus the longest policy pulse). Train mode: 100 kS/s, 16,000 samples (160 ms: two pulses 100 ms apart; only envelope and timing are meaningful because the carrier is near Nyquist).

**Proven on the first run (2026-10-02).** The ADC3 → DMA2 Stream 0 channel 2 mapping and the TIM8 trigger worked: ten captures completed with 6000 or 16,000 samples, correct sample spacing and the board's own min/max agreeing with the host. Results are in `docs/evidence/combined-image-first-bringup.md`.

**Safety.** `CAPTURE_DAC` enables the output for one pulse (two in train mode) and the firmware turns it off the instant the buffer is full or on any failure (`NO_PULSE` after 2 s, `TIMEOUT` after 400 ms, `DMA_ERROR`). It needs a qualified environment, refuses a second capture while one is running (`CAPTURE_BUSY`), refuses on a DMA/DAC fault, and keeps the web lease. No START is sent or needed. The capture never leaves output running.

| Item | Value |
|---|---|
| Image | `arduino/05_sensors_adaptive_tx/build6/05_sensors_adaptive_tx.ino.bin`, 103,468 bytes, SHA-256 `7210091b1d73427e5fc7bd4f030e7f2cacd793a847947a767b32284f389deca5`. Identity advertises `DAC_CAPTURE`. RAM 86,192 bytes (65 %) |
| Build | `node scripts/sync-arduino-engine.mjs` then `"/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" compile --fqbn STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F446RE --build-cache-path "$(mktemp -d)" --output-dir arduino/05_sensors_adaptive_tx/build6 arduino/05_sensors_adaptive_tx` (always a fresh cache; `npm run arduino:build` also checks the UART ring size) |
| Flash | **Flashed 2026-10-02 (build 6, verified).** The link survived this flash without a replug, but replug if commands stop answering. `openocd ... -c "program arduino/05_sensors_adaptive_tx/build6/05_sensors_adaptive_tx.ino.bin 0x08000000 verify reset exit"` (same OpenOCD command as §4), then **replug USB** |
| Capture, one pulse | `BRIDGE=http://127.0.0.1:4318 npm run mcu:capture -- --preset CLEAR_SHALLOW_REEF --window HANN` |
| Capture, two pulses | add `--mode train` |
| Window comparison | `npm run mcu:capture -- --preset CLEAR_SHALLOW_REEF --all-windows --out docs/evidence/mcu-window-comparison.json` (RECT, HANN, HAMMING, BLACKMAN, one pulse each) |
| UI | Validation → **MCU ADC CAPTURE** → mode → **Capture DAC now** |
| Files | `data/bench/mcu-<timestamp>-<id>-pulse.csv` (columns `time_s,volts,adc_counts`, readable by the existing importer) and the matching `.json` with analysis, traces and limits. Download link in the panel |

**What to expect for CLEAR / Hann (calculated, not measured):** ADC counts about 1332 to 2764 around mid-scale, which is about 1.15 V peak-to-peak at the assumed 3.3 V reference; a 2 ms pulse; spectral centroid near 42 kHz; the capture should read within 10 % of the calculation (it can read up to about 3.4 % low from sampling alone). The panel shows requested, calculated, captured, error and tolerance side by side.

**Limitations, stated so they are not forgotten:**
- Volts are `counts / 4095 × 3.3 V`. The reference is assumed, not measured on this board (the ST-LINK reported about 3.24 V once). Ratiometric comparison with the DAC code is the sound one.
- 12-bit samples of the board's own output through a jumper, ADC clocked by the same chip. It cannot show whether the analog path is clean, and **no distortion or THD figure is derived**.
- Train mode: do not read amplitude or frequency from it.
- It does not satisfy the oscilloscope / spectrum-analyzer requirement. Once the analog stage is built it can also sample the stage through the safe tap in §9A; those captures are labelled by tap and are still not oscilloscope measurements.
- The capture is checked against the board's own min/max of the same buffer (`deviceStatsAgree`) to catch transfer errors, which is a consistency check, not an accuracy check.

## 10B. All three waveform classes, policy range and the A0 session (build 6 stays frozen)

**Waveform classes on the real DAC, sampled by the board's own ADC.** One pulse per capture, CLEAR preset (42 kHz, 4 kHz, 2 ms, 35 %), raw DAC through the A2 to A5 jumper:

```bash
BRIDGE=http://127.0.0.1:4318 npm run mcu:capture -- --preset CLEAR_SHALLOW_REEF --all-classes             # LFM, geometric, Barker-13, Hann
BRIDGE=http://127.0.0.1:4318 npm run mcu:capture -- --preset CLEAR_SHALLOW_REEF --all-windows --wave BARKER     # four windows (also GEOMETRIC, LFM)
BRIDGE=http://127.0.0.1:4318 npm run mcu:capture -- --all-profiles                                              # the waveform each of the four presets selects
```

Beyond the spectrum rows, each capture is correlated with the calculated pulse (matched filter): template match, compressed-pulse width, peak sidelobe, and a class check against all three classes. Results, the metric change for phase-coded pulses and the geometric-versus-LFM limit are in `docs/evidence/combined-image-first-bringup.md`.

**Whole policy range without salty water (web path, no output started).** `BRIDGE=… node scripts/policy-range.mjs [--capture] --out docs/evidence/policy-range.json` sends a turbidity-index sweep up and down (`SET_ENV_VALUES`), compares the board's CLEAR, TRANSITION or MURKY answer with an independent statement of the policy at every step, and with `--capture` takes one MCU ADC capture the first time each profile is reached. It proves the policy and the waveform selection; it does **not** prove the A0 input reaches the upper bands.

**A0 / TDS_PROXY, as far as the installed probe goes.** `node scripts/a0-policy-table.mjs` prints where the real C policy switches, in meter units (rising CLEAR to TRANSITION at 926 mV, TRANSITION to MURKY at 1731 mV; falling MURKY to TRANSITION at 1489 mV and TRANSITION to CLEAR at 684 mV at the A0 pin; first decision below 35 % is CLEAR, 35 to 70 % TRANSITION, 70 % and above MURKY). `BRIDGE=… node scripts/a0-session.mjs --seconds 300 --out docs/evidence/a0-session.json` switches to the A0 input, sends no START, logs raw, millivolts and the policy's answer every second while you dip the **outside end of the probe** into tap water and then salt water a little at a time, and prints which of CLEAR, TRANSITION and MURKY were reached from A0 (the rest stay PENDING). Do not open the payload or disconnect anything. The reading is a **TDS proxy**, never turbidity, and the relation between salt and volts is that of the installed board, which is not characterised here.

## 10C. Train-mode spikes (investigation, source not established)

`node scripts/spike-analysis.mjs data/bench --json docs/evidence/spike-analysis.json` counts isolated spikes in the quiet parts of every stored raw-DAC capture. Findings from the thirteen captures so far: three captures contain spikes and ten contain none, so the spikes are **bursty**, not a steady rate. One capture (a geometric RECT pulse, spike count 50) has about 50 positive spikes of roughly +60 counts from 5 ms to the end of the window, lying on a regular grid of about 76.5 µs (13 kHz; 0 of 1000 shuffled sets of random times were as regular). Another (Barker HANN) has seven negative spikes of up to -350 counts, irregular. The train capture had three, one of +315 counts. Facts that bear on a cause, none of which establishes one: the sketch bit-bangs the TFT over software SPI and polls the DS18B20 (1-Wire on PC1, next to the A5 ADC input PC0) without gating either during a capture (it does gate the A0 read and the HC-SR04), and a 1-Wire scratchpad read is a burst of about 72 bit slots of roughly 70 to 80 µs. **That is a hypothesis, not a result.** The cleanest next test needs a new image that skips `pollTemperature()` while a capture runs (a one-line gate, build 7), which is **not** being flashed without your authorization. Without it: `npm run mcu:capture -- --preset CLEAR_SHALLOW_REEF --repeat 60` followed by the spike analysis gives how often a burst lands in a 12 ms window and what each looks like.

## 11. Power measurement

**Why not the INA219.** The adaptive bare-metal image contains no I²C code, so it can never report `power`. In the Arduino sensor image both INA219 VIN+/VIN− pins are left NC for the USB-only logic test (`arduino/README.md`), so even there it measures no load. Neither path can see the Nucleo's USB current. Commissioning the INA219 needs it wired in series with a supply and read by the Arduino image; that is separate work and is **not** claimed.

**Use an inline USB power meter** (or a bench supply with a current display) between the Mac and the Nucleo, reading volts and current. Record the meter model.

| State | How | Record |
|---|---|---|
| Idle | Flashed, output disabled, console disconnected | V, mA after 30 s settling |
| Web control | Console connected and polling, output disabled | V, mA |
| Waveform active | Output enabled on MURKY/HANN, pings at 100 ms, averaged by the meter | V, mA; ping interval 100, pulse 8 |
| Pulse transmit | Peak current during a pulse, only if the meter or a shunt+scope resolves milliseconds | V, mA; pulse ms |

Run twice: analog board disconnected, then connected. Enter each reading in Validation → Bench evidence → Power, or:

```bash
npm run bench -- power --state idle --volts 5.02 --ma 87 --instrument "<meter>" --at "USB 5 V into Nucleo" --conditions "AFE disconnected"
```

(The numbers above are placeholders for the syntax, not results.) The console then derives *energy per ping* = (P active − P idle) × ping interval, *pulse energy* = (P peak − P idle) × pulse length, and duty cycle = pulse/ping. Anything missing stays `n/a`. The USB figure includes the ST-LINK and the on-board regulator; say so when you quote it.

**Power architecture, as far as it is documented (no measurement implied).** Known: the Nucleo is powered from the Mac over USB during every bench session recorded here; the repository describes a 3S2P 18650 pack (11.1 V nominal, 5.2 Ah, `shared/signal.js` `PACK`) and the photographs show a green power module, a finned module and cells in the payload (`docs/PROTOTYPE_MODEL.md`, identities unverified). **Not known and not to be assumed:** which converter, if any, feeds the Nucleo from the pack, its efficiency, the pack's real capacity, and whether the pack and the USB feed are ever connected together. The console's battery figures are a labelled scenario (`batteryScenario`), not readings. The measurement points are therefore: (1) USB 5 V into the Nucleo (inline meter) for the electronics, and (2) pack side current only if a meter or the INA219 is physically placed in series, which has not been done. Until a reading is entered through the form or `npm run bench -- power`, every power field in the console reads `n/a` and the endurance claim stays a calculation from the stated pack.

Low-power evidence from the architecture (true by construction, **not** a measurement): TIM6 runs only while a pulse streams; DMA1 Stream 5 moves samples to DAC1 without the CPU; the main loop sleeps on `wfi`; the next pulse is synthesised in the spare buffer between pings, not during output; the firmware reports its own CPU workload in `engine.cpuLoad`. Quote the measured current next to this, never instead of it.

## 12. Enclosure

`hardware/enclosure/` holds `params.json` (single source of dimensions), `check_fit.py` (fit and printability checks, writes `params.scad`) and `pod.scad` (parametric parts: tube, two caps, deck). See `hardware/enclosure/README.md`. **Not yet printed or fitted.** The battery pack and analog board dimensions in `params.json` are placeholders marked `confirmed: false`; measure the real parts, update the file, run `python3 hardware/enclosure/check_fit.py`, then render and print. Do not call it field-deployable until the assembled unit has been checked against the list in that README.

## 13. Judging demo run order

1. Power on; console shows `AQUASDR_ADAPTIVE` with the expected build id.
2. Health: TIM6 / DMA / DAC PA4 states; ADC READY.
3. Start output; scope shows the pulse on PA4 and sync on PA8.
4. Turn the A0 pot; `adc.raw` and `filteredLevel` move; the policy changes at the thresholds.
5. Console shows centre frequency, bandwidth, duration, amplitude change; scope pulse length and amplitude change.
6. Validation: calculated vs measured FFT and the four-window table.
7. Show the analog board with probes on TP1/TP2/TP3.
8. Show the power readings and the enclosure.

### Results log (fill in; leave blank what you have not done)

| Item | Result | Date | By |
|---|---|---|---|
| Image SHA-256 flashed | | | |
| Build id seen in telemetry | | | |
| Pot raw vs multimeter at 0/25/50/75/100 % | | | |
| PA4 scope captured (file names) | | | |
| 10 min run, underruns | | | |
| Window captures imported (RECT/HANN/HAMMING/BLACKMAN) | | | |
| Analog board DC checks | | | |
| TP2 / TP3 captures imported | | | |
| Power readings (idle / active / peak) | | | |
| Enclosure assembled and fit-checked | | | |

## 14. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Console says Arduino sensor bridge or unknown firmware | Wrong image on the board, or serial port is the other device | Re-flash adaptive image; check port |
| Cannot Start: INPUT_UNQUALIFIED | A0 invalid (raw ≤ 12 or ≥ 4083), stale, or not yet qualified | Add the 1 kΩ end resistors; check 3V3 on the pot; wait 100 ms |
| `adc.raw` constant ~0 or 4095 | A0 floating or pot on the wrong rail | A floating input can *look* valid; check wiper voltage with a multimeter |
| `adc.millivolts` far from multimeter | 5 V on the pot, or TDS still on A0 | Remove TDS; pot to 3V3 only |
| No pulses on PA4 | Output disabled; session mismatch; lease expired (web) | Start again; for the web path keepalive must run |
| PA4 pulse is rounded or small | DAC buffer settling or loading by the analog board | Probe PA4 with the board disconnected; raise R1/R2 to 10 kΩ and scale C1/C2 down by 2 |
| DMA fault / underrun counter > 0 | Latched fault; needs MCU reset | Reset; if it recurs, record when and tell me |
| OPAMP_OUT flat-topped | Clipping against 5 V rails or VMID wrong | Check VMID 2.50 V and amplitude ≤ 85 % |
| High-frequency oscillation | Long leads, no decoupling at U1 | C7/C8 at the pins; shorten the feedback loop |
| Imported capture rejected | Not a time/volts CSV, non-uniform time, or no burst | Single-column files need `--rate`; pick the channel with `--channel` |
| Capture marked OUTSIDE tolerance | Profile or window entered does not match the board; wrong probe ×10 scaling | Re-import with the right settings; export volts at the probe tip |
