# Combined image: first bring-up record (2026-10-02)

Facts only. Raw data: `first-telemetry-combined-raw.txt` (10 s capture; line 1 is the tail of seq 0, which was mid-transmission when the port was opened, the last line is cut by the end of the capture), `combined-command-path-no-output.json`. Pre-flash baseline and rollback images: `arduino/04_all_sensors/rollback/`.

Flashed: build 1, `a1af7e76…2e45`, by ST-LINK with verify. Output was never enabled; no `start` command was sent at any point.

| Stage | Result | Evidence |
|---|---|---|
| 1 Identity | PASS: `AQUASDR_ADAPTIVE`, version 0.3.3, build `8760478-dirty`, platform `ARDUINO_COMBINED`, firmware `AquaSDR sensors + adaptive TX 0.4.0` | First complete packet, seq 1 |
| 2 TFT alive | **UNCONFIRMED.** Telemetry says `TFT: ONLINE ST7735`, but that is set after initialisation without a display acknowledgement. Someone must look at the screen | needs a human |
| 3 DS18B20 | PASS: `ONLINE A4 1-WIRE`, 31.00 °C in all 19 packets | telemetry |
| 4 Pressure | PASS as reporting: 2.67–2.74 bar, `DIRECT UNSAFE UNCALIBRATED`, same as before the flash | telemetry vs baseline |
| 5 Turbidity | Unchanged: `OUT OF RANGE 0.88–0.90 V`, no NTU (baseline 0.89 V) | telemetry vs baseline |
| 6 TDS / A0 ADC | PASS: raw 27–38, 21–30 mV, filtered level about 1.1 %, `valid: true`, policy CLEAR, labelled `TDS_PROXY`, full scale 2854. **Not yet compared with a multimeter** | telemetry |
| 7 INA219 / IMU | OFFLINE, **identical to before the flash** (also BMP390 and magnetometer). Not a regression. Cause is outside this change (INA219 VIN± unconnected; I²C parts not responding) | baseline vs after |
| 8 TIM6 / DMA / DAC status | Consistent with output off: `INHIBITED TIM6 1.000 MHz`, `DMA INHIBITED`, `DAC INHIBITED MID SCALE`, 0 underruns | telemetry |
| 9 PA4 quiet, output stopped | Registers, read over ST-LINK without halting: `DAC_CR 0x5` (enabled, **DMA off**), `DAC_DOR1 0x800` (mid-scale), `TIM6_CR1 0` (stopped), `DMA1_S5_CR 0`, sync pin low. **Scope not yet used**, so the analog level is not measured | openocd register reads |
| 10 Start lowest-risk waveform | **NOT DONE.** Waiting for an explicit START from the owner and for the scope | |
| 11 Scope on PA4 | **NOT DONE** | |

## Command path (output disabled throughout)

- Web preset CLEAR_SHALLOW_REEF produced requested 42 kHz / 4 kHz / 2 ms / 35 % / Hann, **identical** to what the A0/TDS input produced for CLEAR.
- Build 1 ACK latency, 62 keepalives: min 12 ms, median 32 ms, p90 228 ms, max 624 ms.
- **Defect:** with plain framing 50 of 120 long commands (42 %) got no ACK, with `INVALID_COMMAND` acks and failures in adjacent pairs; with a leading newline 33 of 120 (27 %). Short commands (keepalive, status: 50–55 bytes) were not lost in about 190 attempts. Probable cause: the Arduino core's per-byte HAL interrupt receive, which masks the UART interrupt on every transmit arm while telemetry is streaming. Build 2 moves the UART to DMA. **Not yet flashed or tested.**

## Timing facts measured from telemetry (build 1, 10 s)

Packets arrive every 500 ms; one 633 ms gap at the 8 s TFT page change (about 130 ms stall). Pulses were not running, so pulse gaps are not measured.

## Build 2 (flashed 2026-10-02, `8a48fd35…ae12`): result, **receive path broken**

Flashed with ST-LINK verify. Registers read afterwards: `DAC_CR 0x5` (DMA off), `DAC_DOR1 0x800`, `TIM6_CR1 0`, `DMA1_S5_CR 0`, sync pin low: output still quiet. Telemetry and sensors reported through the console's bridge as before.

The console was connected and held the serial port, so no command-reliability test could be run directly. The bridge's own view shows the defect: `UART: "DMA RX 0 B 27 ERR"` after 40 s of uptime, and the bridge handshake never completed (`transmitter ready: false, status UNKNOWN`). Zero bytes received, 27 receive errors.

Cause: build 2 put USART2 RX on DMA1 Stream 7 channel 6. USART2_RX is DMA1 Stream 5 channel 4, the stream the DAC uses (channel 7), so the receiver was never serviced and overran. USART2 TX on Stream 6 channel 4 was correct and works. The counters added for this build are what exposed the fault. Build 2 therefore did **not** fix or disprove the original loss; that remains unmeasured.

Build 3 (not flashed): core Serial for RX, DMA for TX only.

## Build 3 (flashed 2026-10-02, `e4161222…8fed`): UART test result and revised diagnosis

Flashed with ST-LINK verify. Registers afterwards: DAC enabled with DMA off, `DAC_DOR1 0x800`, TIM6 stopped, DMA stream 5 off. Output was never enabled and no START was sent. Peripherals identical to the pre-flash baseline (same OFFLINE set: INA219, IMU, BMP390, magnetometer). The bridge handshake worked at first (`UART: RX 54 B 1 LINES 0 INVALID`, link ready). Uptime ran past 768 s with no reset.

**Reliability test through the real bridge path** (`scripts/uart-reliability.mjs`, results in `uart-reliability-build3.json`), 4 of 5 patterns, 300 commands:

| Pattern | Sent | Lost | Lost % | Rejected (follow-on) | Median / p95 / max ACK ms |
|---|---|---|---|---|---|
| back-to-back | 120 | 17 | 14.2 | 7 | 16 / 160 / 401 |
| 100 ms spacing | 80 | 18 | 22.5 | 0 | 17 / 145 / 153 |
| 500 ms spacing | 60 | 24 | 40.0 | 4 | 17 / 193 / 321 |
| 1 s idle gaps | 40 | 10 | 25.0 | 0 | 16 / 147 / 194 |
| 2 s idle gaps | not run | | | | |
| **Total** | **300** | **69** | **23.0** | 12 | |

Device-side counters over the same run: 31,971 bytes, 408 lines, **35 INVALID** lines, no reset. **Acceptance (0 lost, 0 malformed, no UART error growth) was NOT met.** The UART error counter the acceptance asked for does not exist in build 3 (the core clears hardware error flags itself).

**Follow-up diagnostics, board in its failed state:**

1. The device's receive counter froze (`RX 39738 B 536 LINES 37 INVALID`, unchanged for 100+ s) while telemetry kept flowing: the board stopped receiving entirely.
2. USART2 registers read over ST-LINK were healthy: `CR1 0x202C` (UE, TE, RE, RXNEIE on), `SR 0xD0` (no overrun, no framing error), `CR3 0x81` (DMAT, EIE), NVIC USART2 enabled.
3. Writes of any size or pacing from the Mac, including one byte at a time, produced no ACK and no counter change.
4. A clean MCU reset (uptime back to 14 s, `RX 0 B`) did **not** restore reception.
5. Earlier, with the link still partly alive, commands of 55, 56 and 63 bytes were never lost (30 of 30 each), while a 64-byte write blocked the host's serial port (`EAGAIN`) and the link then jammed.

**Revised conclusion:** the fault is between the Mac and the board's UART pin, in the ST-LINK USB-to-serial bridge (firmware `V2J33M25`) or the macOS driver, and it is sensitive to message size around the 64-byte USB packet. It is **not** in the firmware's UART code. Builds 2 and 3 were built on the earlier hypothesis (core Serial contention) and did not address this. Build 1's loss pattern (long commands lost, short commands fine) fits the same cause. This is a diagnosis from the evidence above, **not a proven root cause**: it is not yet known whether ST-LINK firmware, the macOS CDC driver or the cable is responsible.

**To restore the link:** re-enumerate USB (unplug and replug the board's USB cable; no payload wiring involved). Then test host-side chunking (small writes with short gaps) against plain writes to see whether the loss goes away, and if so put the chunking in the bridge.

## After the USB replug (same session)

The USB cable was replugged. The link came up (board uptime 25 s, telemetry flowing, `UART: RX 0 B`). A test of 16-byte chunked writes (3 ms gaps) of 85-byte commands was started; it never completed. Checked afterwards, the board had received a single line (`RX 66 B 1 LINES 0 INVALID`) and nothing since: the Mac-to-board direction died again within the first command or two, and writes of short commands (50 to 54 bytes, no stalls) produced no ACKs and no counter change. Telemetry from the board kept flowing throughout.

So: a replug gives a short working window only, and chunked writes did not prevent the stall in that one attempt. The chunking idea is **not confirmed**. The ST-LINK (`V2J33M25`) USB-to-serial path remains the prime suspect; the macOS driver, the cable or the USB port have not been ruled out.

Not yet tried, in order of cost: another USB port or cable (no hub); lowering the board's telemetry rate to see whether the stall depends on the board's own transmit load (build 4 does this at 1 Hz); updating the ST-LINK firmware (needs ST's tool and the owner's approval).

## Correction: the command loss is a 64-byte receive ring, not the ST-LINK (found 2026-10-02)

**Build 4** (logo, 1 Hz telemetry; flashed, `5b9ebd13…3e94`) was flashed after the cable was moved to a different USB port. The command link worked (handshake ACCEPTED, telemetry at exact 1 s spacing) but a 66-command bridge run still lost 15 (23 %), the same rate as before. Neither the other USB port nor halving the board's transmit load helped.

A controlled test on the live link then varied only the command length (keepalive padded with spaces, 40 sends each, 300 ms apart, whole write):

| Line length | Sent | Lost |
|---|---|---|
| 56 B | 40 | 0 |
| 63 B | 40 | 0 |
| 72 B | 40 | 10 |
| 90 B | 40 | 14 |
| 90 B as 40 B + rest, 5 ms apart | 40 | 21 |

Loss starts above 63 bytes and splitting the write made it worse, so it is not USB packetization. Disassembling the flashed ELF showed why: `Uart::available()` masks with `0x3f`, i.e. the Arduino core's UART receive ring is **64 bytes**, and `Serial2` is 280 bytes instead of 728. `build_opt.h` sets `-DSERIAL_RX_BUFFER_SIZE=512`, but `arduino-cli` caches the compiled core by build properties, not by `build_opt.h`, so builds 3 and 4 reused a core compiled without it. A command line longer than 63 bytes overflows the ring whenever the main loop is busy (TFT redraw, 30 ms ultrasonic wait, sensors) for more than a few milliseconds; the tail of the line is dropped, the line is invalid, and the next command is often swallowed with it. Every command the bridge sends is 54 to 95 bytes, so most are exposed.

What this corrects in the earlier text:
- The "ST-LINK USB-to-serial link" diagnosis above is **wrong as an explanation of the command loss**. The size-dependent loss is the ring.
- Build 1 (fresh core, 728-byte `Serial2`, 512-byte ring) also lost long commands in the raw test. Its cause is **not explained** by the ring; interrupt transmit contention (the original hypothesis) remains possible but unproven.
- The episodes where the board's receive counter froze and a reset did not revive it, but a USB replug did, are **not explained** by the ring either. They remain unexplained. They may still involve the host side or the ST-LINK.

**Build 5** (fix candidate, not flashed): same source as build 4, compiled with a fresh core cache. `Serial2` is 728 bytes, `available()` masks 9 bits (512). SHA-256 `482ebd4c7f665e61235cc11f2189a58c8a26d988d0c19651645515b3164319c9`. `tests/arduino-combined.test.js` now builds with a fresh cache and fails if `Serial2` is below 600 bytes.

## Build 5 (flashed 2026-10-02, `482ebd4c…19c9`)

Flashed with ST-LINK verify; registers quiet afterwards (`DAC_DOR1 0x800`, TIM6 stopped, DMA stream 5 off, output disabled). Peripherals identical to the pre-flash baseline (same OFFLINE set).

**Command link dead after the flash:** `UART: RX 0 B 0 LINES` at 67 s uptime, with the raw port and the bridge both unable to get a single byte to the board. Board side read healthy over ST-LINK: RX pin idle high (`GPIOA_IDR` bit 3), `USART2_CR1 0x202C`, `CR3 0x81`, PA2/PA3 on AF7. This is the third time the Mac-to-board direction has been dead after an SWD reset or flash (the first two were cleared by re-enumerating USB); it is not explained. The reliability test of build 5 is therefore **not yet run**.

**Bridge bug found and fixed:** after one timed-out handshake, `ControlLink` set `unknown` and then refused every later handshake as well, so the link stayed unavailable even if the board started answering (a device that never handshook reports session 0, so telemetry alone never reconciled it). A handshake is now allowed in that state and clears it (`server/control-link.js`, with a regression test). A bridge process started before this change keeps the old behaviour until restarted.

## Build 5 after USB replug: UART reliability PASSED (2026-10-02)

Link restored by replugging USB. Tested through a bridge instance running the handshake fix (port 4330), real bridge path: HTTP API plus WebSocket heartbeat. Output was disabled throughout; no START was sent. Results in `uart-reliability-build5.json`.

| Pattern | Sent | ACKed | Lost | Invalid lines on device | ACK ms median / p95 / max |
|---|---|---|---|---|---|
| back-to-back | 120 | 120 | 0 | 0 | 16 / 161 / 398 |
| 100 ms spacing | 80 | 80 | 0 | 0 | 16 / 157 / 389 |
| 500 ms spacing | 60 | 60 | 0 | 0 | 17 / 170 / 335 |
| 1 s idle gaps | 40 | 40 | 0 | 0 | 17 / 148 / 158 |
| 2 s idle gaps | 30 | 30 | 0 | 0 | 17 / 159 / 182 |
| **Total** | **330** | **330** | **0** | **0** | |

Device counters across the run: 41,317 bytes and 566 lines received (the lines include the bridge's own keepalives and handshake), **0 INVALID**, no device reset (uptime continuous), underruns 0. The mix covered `source`, `SET_ENV` presets, `SET_ENV_VALUES`, `PING`, `GET_STATUS`, `STOP`. Commands were 54 to 95 bytes. This confirms the cause: the 64-byte core RX ring (fixed in build 5, `Serial2` = 728 bytes).

Not covered: a deliberately malformed command (the bridge validates what it sends, so invalid input cannot be injected through it); UART hardware error counters (the core clears them, build 5 has none); START/STOP framing with START (not sent by instruction).

## Web control loop and A0/TDS path (build 5, no START), `web-vs-a0-policy-build5.json`

Web path: `web command -> bridge -> UART -> STM32 -> C policy -> requested waveform -> ACK -> telemetry`.

| Command | Policy | Requested waveform | Matches policy table |
|---|---|---|---|
| SET_ENV CLEAR_SHALLOW_REEF (12 / 3 m / 26 °C) | CLEAR | LFM 42 kHz / 4 kHz / 2 ms / 35 % / Hann | yes |
| SET_ENV MUDDY_ESTUARY (85 / 18 m / 24.8 °C) | MURKY | LFM 38 kHz / 1 kHz / 8 ms / 62 % / Hann | yes |
| SET_ENV DEEP_OPEN_WATER (10 / 80 m / 10 °C) | MURKY | same | yes |
| SET_ENV SEDIMENT_PLUME (95 / 12 m / 22 °C) | MURKY | same | yes |
| SET_ENV CLEAR_SHALLOW_REEF again | CLEAR | same as first | yes |

ACKs came back in 16 to 41 ms. `applied` stayed empty throughout, as expected with output disabled: these are requested parameters, not applied pulses.

A0/TDS path: raw 24, 19 mV, `filteredLevel` 1 %, valid, `TDS_PROXY`, policy CLEAR, requested LFM 42 / 4 / 2 / 35 / Hann. A web `SET_ENV_VALUES` with the same index the A0 produced (0.8, depth 0, 25 °C) gave an **identical** requested waveform and policy. **Limit:** only CLEAR is demonstrated on the A0 path; MURKY through A0 needs the TDS probe in salty water, which has not been done. The 40 kHz TRANSITION band was not exercised.

## First START: PA4 session, build 5 (2026-10-02), firmware-side evidence only

One START (CLEAR_SHALLOW_REEF, web source), held 30 s, then STOP (`scripts/pa4-scope-session.mjs`, raw record in `pa4-scope-session.json`). Scope probe was on A2/PA4 and GND with the driver and transducer disconnected, per the operator.

**Reported by the firmware (not scope measurements):** START accepted; applied settings equal to requested (LFM 42 kHz, 4 kHz sweep, 2 ms, 35 %, Hann) in 30 of 30 samples; DAC `ACTIVE DAC1 PA4`; DMA `ACTIVE BURST`; 0 underruns, no faults; decision-to-output 97 ms (firmware clock). STOP accepted; telemetry back to `INHIBITED MID SCALE`.

**Read over ST-LINK after STOP:** `TIM6_CR1 = 0`, DMA stream 5 `EN` clear with `NDTR = 0`, `DAC_DOR1 = 0x800` (mid-scale).

**Not a measurement and not to be quoted as one:** the MCU's own A5 sampler read 0.86 to 1.09 Vpp during pulses. It takes 48 min/max samples with irregular spacing, which cannot resolve a 40 kHz carrier, so it under-reads. The oscilloscope is the authority for frequency, duration and amplitude.

**Status:** digital chain (TIM6 to DMA to DAC1 PA4) running on the board with no faults; the physical electrical waveform on PA4, the FFT, the window effect and the pulse timing are **awaiting scope data** from the operator. Nothing from this session is stored as MEASURED.

## Build 6 (flashed 2026-10-02, `7210091b…eca5`): MCU ADC CAPTURE on the real board

Flashed with ST-LINK verify; the command link survived this flash (no replug needed). The board advertised `DAC_CAPTURE`, capture state IDLE, output off. Captures were taken with `scripts/mcu-capture.mjs` through a bridge on port 4330. The records and CSV files are in `data/bench/mcu-*`. Every capture left the output off, DAC at mid-scale, DMA inhibited, 0 underruns. **These are MCU ADC CAPTURES: the board sampling its own DAC pin through the A2-A5 jumper. They are not oscilloscope or instrument measurements.** The first run (a single HANN pulse) agreed with the calculation on every row; it was repeated below with the final analysis.

**Raw-data sanity check (first capture):** 6000 samples at exactly 500 kS/s; baseline 2055.7 counts (about 1.656 V) with 6.97 counts RMS noise; capture span 1340 to 2763 counts (1423 counts, 1.147 V at the assumed 3.3 V reference) against a calculated 1433; pulse starts 0.49 ms into the window; the board's own min and max of the buffer agree with the host's.

**Pulse mode, CLEAR_SHALLOW_REEF (LFM, 42 kHz centre, 4 kHz sweep, 2 ms, 35 %), one pulse per window; calculated / captured:**

| Window | FFT peak calc / capture (kHz) | Centroid (kHz) | 99 % BW (kHz) | Duration, 20 % envelope (ms) | Vpp (V) | Leakage (dB) | All judged rows |
|---|---|---|---|---|---|---|---|
| RECT | 41.00 / 41.00 | 41.94 / 41.95 | 11.54 / 11.52 | 2.00 / 2.01 | 1.15 / 1.17 | -14.6 / -14.6 | WITHIN |
| HANN | 42.00 / 42.00 | 42.00 / 42.00 | 3.51 / 3.49 | 1.41 / 1.42 | 1.15 / 1.15 | -34.7 / -35.0 | WITHIN |
| HAMMING | 41.99 / 42.06 | 42.00 / 42.00 | 3.54 / 3.49 | 1.53 / 1.54 | 1.15 / 1.15 | -32.7 / -35.1 | WITHIN |
| BLACKMAN | 42.00 / 42.00 | 42.00 / 42.00 | 3.23 / 3.20 | 1.20 / 1.20 | 1.15 / 1.14 | -36.5 / -37.5 | WITHIN |

Reading it: the four windows reproduce their calculated ordering on real output: the unwindowed pulse leaks about 20 dB more than any windowed one (-14.6 dB against about -35 dB), and the centre frequency, bandwidth and amplitude match the calculation. The leakage figure varies by about 2 dB from run to run (Hamming read -37.2 dB on the first run and -35.1 dB on the repeat), so differences of that size between captured and calculated are noise, not a defect.

**An analysis error found and fixed along the way.** On the first Hamming capture the pulse duration at the 10 % envelope read 1.96 ms against 1.81 calculated and was flagged OUTSIDE. The waveform was not wrong: Hamming has an 8 % pedestal at its edges, which sits almost exactly on the 10 % threshold, so there noise alone moves the width between 1.65 ms (15 %) and 2.00 ms (5 %). At 15, 20 and 30 % the capture and the calculation agree to within 0.02 ms. The judged row is now the 20 % width; the 10 % width stays on screen as informational. This is a change of metric with its reason, not a loosened tolerance, and a regression test covers it.

**Train mode (100 kS/s, 160 ms):** two real pulses at 0.52 ms and 99.51 ms, an interval of 99.0 ms against the 100 ms ping interval, each 1.59 ms wide at the 10 % envelope. Amplitude and frequency are not read from train mode.

**Data-quality finding, source not established.** The train capture contains isolated single-sample spikes between pulses (+315, +62 and +53 counts at 14.4, 17.6 and 29.0 ms; 10 µs wide), against a baseline of about 8 counts RMS. The first made the analysis count a third pulse until the detector learned that a run shorter than 0.2 ms is not a pulse; spikes are now listed as glitches in the record. The 24,500 quiet samples in the five pulse captures contain none, but they only cover the first 12 ms. Plausible sources are coupling from the board's own digital activity (display, 1-wire probe, UART) into the analog input, or ADC behaviour. **None of these has been tested.** The same finding is a reason not to trust single samples from this path for fine detail.

**What this does and does not establish.** It shows the real DAC output, sampled by the same chip, follows the calculated waveform: centre frequency, sweep bandwidth, pulse length, amplitude and the effect of each window. It does **not** show how clean the analog path is, does **not** derive any distortion figure, depends on an assumed 3.3 V reference (ratiometric comparison is sound, absolute volts are not), and does **not** satisfy the oscilloscope / spectrum-analyzer requirement. Geometric sweep and Barker-13 were not captured.

## Build 6, same flash: all three waveform classes (2026-10-02, no re-flash)

Raw DAC through the A2 to A5 jumper, CLEAR preset (42 kHz centre, 4 kHz, 2 ms, 35 %), one pulse per capture, output off afterwards, 0 underruns. **MCU ADC CAPTURES, not oscilloscope or instrument measurements.** Calculated / captured, from `data/bench/mcu-*`:

| Class | Window | Centroid (kHz) | 99 % BW (kHz) | Central-90 % energy width (ms) | Vpp (V) | Leakage (dB) | Template match | Peak sidelobe (dB) | Judged rows |
|---|---|---|---|---|---|---|---|---|---|
| LFM | RECT | 41.94 / 41.95 | 11.54 / 11.52 | 1.80 / 1.80 | 1.15 / 1.17 | -14.6 / -14.6 | 1.000 | -20.0 / -20.1 | WITHIN |
| LFM | HANN | 42.00 / 42.00 | 3.51 / 3.49 | 0.93 / 0.94 | 1.15 / 1.15 | -34.7 / -35.0 | 1.000 | -57.1 / -58.7 (info) | WITHIN |
| LFM | HAMMING | 42.00 / 42.00 | 3.54 / 3.49 | 1.00 / 1.01 | 1.15 / 1.15 | -32.7 / -35.1 | 1.000 | -45.3 / -44.8 (info) | WITHIN |
| LFM | BLACKMAN | 42.00 / 42.00 | 3.23 / 3.20 | 0.78 / 0.79 | 1.15 / 1.14 | -36.5 / -37.5 | 1.000 | -64.4 / -61.3 (info) | WITHIN |
| Geometric | HANN | 41.95 / 41.95 | 3.50 / 3.49 | 0.93 / 0.94 | 1.14 / 1.16 | -34.6 / -34.4 | 1.000 | -57.1 / -55.9 (info) | WITHIN |
| Geometric | RECT | 41.93 / 41.93 | 11.25 / 11.38 | 1.80 / 1.80 | 1.15 / 1.17 | -14.8 / -14.8 | 1.000 | -20.1 / -19.8 | WITHIN |
| Barker-13 | RECT | 42.08 / 41.86 | 53.99 / 52.75 | 1.80 / 1.80 | 1.15 / 1.17 | -3.8 / -3.8 | 0.996 | -21.7 / -21.4 | WITHIN |
| Barker-13 | HANN | 42.52 / 42.28 | 48.59 / 50.15 | 0.94 / 0.94 | 1.15 / 1.14 | -7.9 / -8.0 | 0.995 | -4.8 / -5.1 | WITHIN |
| Barker-13 | HAMMING | 42.49 / 42.27 | 48.77 / 50.57 | 1.01 / 1.01 | 1.15 / 1.15 | -7.8 / -8.4 | 0.995 | -5.8 / -6.1 | WITHIN |
| Barker-13 | BLACKMAN | 42.57 / 42.35 | 48.51 / 49.78 | 0.78 / 0.80 | 1.15 / 1.14 | -9.0 / -8.8 | 0.995 | -3.8 / -3.8 | WITHIN |

(Twelve pulse captures exist; the table lists ten because the LFM HANN and Barker HANN captures were each taken twice and agree. The first four LFM rows are the earlier build-6 window captures re-analysed with the new rows.) Reading it: the unwindowed Barker-13 pulse has a captured peak sidelobe of -21.4 dB against -21.7 dB calculated, and 13:1 is -22.3 dB, so the phase-coded pulse the board plays has the correct code. Windowing a phase-coded pulse raises its sidelobes to about -5 dB, as calculated. Barker's captured centroid sits 0.2 kHz below the calculated one in all four windows (inside the 0.5 kHz tolerance, a consistent offset whose cause is not established). The LFM/geometric/Barker class check correlates each capture with the calculated pulse of all three classes: Barker captures score 0.995 against Barker and 0.22 against the sweeps; LFM and geometric captures score 0.33 against Barker.

**Two limits found, stated rather than worked around.**

1. **Geometric and LFM cannot be told apart at the policy's sweep width.** The tested policy only ever requests 4, 2 and 1 kHz sweeps. At 4 kHz around 42 kHz a geometric sweep is within about 50 Hz of a linear one: the calculated waveforms correlate at 0.9994, and a capture of either scores 1.000 against both. So the capture shows the board plays a sweep with the right centre, bandwidth, length, amplitude and window leakage, but no measurement at this bandwidth (this one or a scope's) can show that the sweep is exponential rather than linear. That needs a sweep of 20 kHz or more, which the frozen policy does not request; it is reported in the console as "cannot be told apart", not as a pass for the geometric shape.
2. **A metric I chose was wrong for phase-coded pulses, and I changed it with its reason.** On the first Barker captures the 20 % envelope width read 1.420 against 1.348 ms calculated (HANN, tolerance 0.067), 1.514 against 1.444 (HAMMING, 0.072) and 1.204 against 1.132 (BLACKMAN, 0.057, OUTSIDE): a steady +0.07 ms bias in all three windowed captures, not noise, while the same row agreed to 0.01 ms for LFM. Phase reversals put dips in the envelope, so an envelope threshold is unstable for this class. The judged duration is now the time holding the central 90 % of the pulse energy, which agrees within 0.006 to 0.018 ms for every Barker capture; the 20 % width is still shown, as informational, for phase-coded pulses only. This is a change of metric (with a regression test), not a loosened tolerance, and the +0.07 ms offset in the 20 % width is left unexplained.

**Spike analysis (`docs/evidence/spike-analysis.json`).** Across the thirteen stored raw-DAC captures, three contain isolated spikes and ten contain none. One capture has about 50 positive spikes near +60 counts from 5 ms to the end of the window on a regular grid of about 76.5 µs; one has seven negative spikes up to -350 counts; the train capture has three. Spikes are bursty, so no steady rate is claimed. The source is **not established**. The sketch software-SPIs the TFT and polls the DS18B20 on PC1 (next to the PC0 ADC input) during captures; a 1-Wire read is a burst of about 72 slots of 70 to 80 µs, which would match the 76.5 µs grid and the roughly 7 ms burst length. That is a hypothesis; the decisive test needs a new image and is not being flashed.

**Link event during this session (no flash involved).** After 18 captures and about 32 minutes of uptime the Mac to board direction stopped: the board's received-byte counter froze at 14,965 B while its telemetry kept flowing, commands timed out (`Acknowledgement timed out; command outcome unknown`), and closing and reopening the serial port from software did not restore it. The board itself stayed healthy (no reset, output off, DAC mid-scale, DMA inhibited, 0 underruns). This is the same one-way death previously seen after SWD flashes, now without a flash, and the USB replug is the only known recovery. Cause unexplained. The capture that was running when it happened (geometric RECT, capture 18) completed and is among the spike-bearing captures, which may or may not be related.

**Not yet captured on the board (blocked on the link above):** geometric HAMMING and BLACKMAN; the waveform each of the four presets selects (`--all-profiles`); the web-path policy sweep (`scripts/policy-range.mjs`); an A0 session (`scripts/a0-session.mjs`); repeated captures for the spike survey. None of these needs new firmware.
