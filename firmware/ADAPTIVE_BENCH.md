# AquaSDR environment-controlled transmitter — PS 26058

**Status: software implementation and automated verification; not flashed or physically commissioned by this change.** The ordinary bare-metal bring-up image and Arduino sensor/TFT sketch remain separate programs. This adaptive image boots with output disabled.

## Build and run without a board

```sh
npm test
npm run build
npm start
make -C firmware
make -C firmware adaptive
```

The bridge requires Node 22+ and a host C compiler (`cc`, or an executable path in `CC`). On macOS, the Xcode Command Line Tools supply `cc`. It compiles a persistent native process from the same adaptation, control, command, telemetry and waveform C sources used by the board. Generated files go to ignored `firmware/build-host/`. Compilation/process failure produces an unavailable state; there is no alternate JavaScript policy.

If the ARM compiler is not on PATH, pass `PREFIX=/absolute/path/to/bin/arm-none-eabi-`. `firmware/build/aquasdr.bin` is the ordinary button-driven bring-up image; `firmware/build-adaptive/aquasdr.bin` is the new control image. Building does not flash. The ordinary `make flash` target installs the ordinary image, not the adaptive one.

After preparing the wiring below, `make -C firmware flash-adaptive` explicitly installs the adaptive image through the mounted NUCLEO drive. If ST-LINK mass storage is unavailable, use your board programmer to install `firmware/build-adaptive/aquasdr.bin` at `0x08000000`. The console reports the running firmware: `AquaSDR Arduino sensor bridge 1.7 demo-TFT` has no command receiver; `aquasdr-fw 0.3.2 adaptive environment control` advertises control support. With the sensor image, hardware commands stay read-only but an explicitly targeted COMPUTED companion enables the shared C controls alongside live sensors. Sensor/TFT operation requires its separate sketch. The [build and installation handoff](../docs/ADAPTIVE_FIRMWARE_HANDOFF.md) has exact commands for the installed Mac toolchain. Installation remains on hold; the mounted wiring is unchanged.

For an isolated local instance, use `PORT=4320 npm start`; tests can set `AQUASDR_DATA_DIR` to keep session files separate. The default port remains 4318.

Open Adaptation, select **Web control**, select a preset and **Apply environment**. Wait for qualification, then **Start output** for adaptive hardware or **Start reference** for the computed engine. Hardware commands are sent only after advertised capability and session handshake. The legacy image retains its live telemetry; computed commands never reach its DAC or A0. Source changes stop output and require another Start. See the [connected demo guide](../docs/CONNECTED_DEMO.md).

## One policy, two input adapters

```text
Browser environment command -> USART2 RX ring -> bounded parser --+
                                                               +-> environment -> C policy
A0 voltage -> ADC1, nominally every 20 ms ------------------------+        |
                                                     spare buffer synthesis
                                                               |
                                                     pulse-boundary swap
                                                               |
                                                    TIM6 -> DMA1 S5 -> DAC1 PA4
```

Severity is `max(turbidity index, depth in metres)`, with both inputs bounded to 0–100. Mapping 100 m to maximum severity is an experimental bench choice, not an ocean calibration. Temperature is bounded to 0–40 °C and affects the acoustic preview only. A0 maps to turbidity index using `raw * 100 / 4095`, with depth 0 m and temperature 25 °C. No calibrated NTU measurement is claimed.

Every 20 ms, the policy applies a 0.25 exponential filter, then a 60 ms stable-candidate qualification. Initial thresholds are 35/70; qualified upward thresholds are 40/75 and downward thresholds 30/65.

| Policy | Center | Sweep bandwidth | Duration | DAC amplitude |
| --- | --- | --- | --- | --- |
| CLEAR | 42 kHz | 4 kHz | 2 ms | 35% half-scale |
| TRANSITION | 40 kHz | 2 kHz | 4 ms | 50% half-scale |
| MURKY | 38 kHz | 1 kHz | 8 ms | 62% half-scale |

| Preset | Turbidity index | Simulated depth | Simulated temperature |
| --- | --- | --- | --- |
| Clear shallow reef | 12 | 3 m | 26 °C |
| Muddy estuary | 85 | 18 m | 24.8 °C |
| Deep open water | 10 | 80 m | 10 °C |
| Sediment plume | 95 | 12 m | 22 °C |

Presets may select the same waveform class. Editing a preset creates Custom. All three waveform families support RECT, HANN, HAMMING and BLACKMAN; LFM/HANN is the default. Phase-coded pulses use Barker-13; duration controls chip rate and the sweep bandwidth field does not describe their spectrum. CW remains in the ordinary bring-up image.

## Serial command protocol

115200 baud, newline-delimited ASCII JSON, at most 512 bytes excluding newline. Flat objects only; protocol numbers are unsigned integers. Unknown/duplicate fields, malformed JSON, unsupported enums and out-of-range values are rejected. Parser/UART errors discard through a newline, allowing later frames to recover. ISR work only reads status/data and queues bytes; parsing and synthesis run in the main loop.

Every command has `version:1`, a nonzero 32-bit `session`, a strictly increasing nonzero `id`, and `op`. A `hello` establishes a bridge-generated session. Changing sessions stops web-controlled output; it does not interrupt autonomous ADC operation. Repeated IDs are rejected, never executed again.

| op | Additional fields |
| --- | --- |
| hello | none |
| source | `source`: `WEB_COMMAND` or `ADC_DIAL` |
| environment | `turbidity`: 0–1000, `depth`: 0–1000, `temperature`: 0–400; **all in tenths** |
| waveform | `mode`: 0 LFM / 1 geometric / 2 Barker-13; `window`: 0 RECT / 1 HANN / 2 HAMMING / 3 BLACKMAN |
| start | none; requires qualified input and no latched fault |
| stop | none |
| keepalive | none |
| status | none; ACK followed by fresh telemetry when the UART becomes available; does not renew the web lease |
| preset | `profile`: `CLEAR_SHALLOW_REEF`, `MUDDY_ESTUARY`, `DEEP_OPEN_WATER` or `SEDIMENT_PLUME` |

Named bench aliases use that same JSON envelope: `PING` → `hello`, `SET_ENV` → `preset`, `SET_ENV_VALUES` → `environment`, `SET_INPUT_SOURCE` → `source` (accepting `WEB` / `A0`), `START_OUTPUT` → `start`, `STOP_OUTPUT` → `stop`, and `GET_STATUS` / `GET_WAVEFORM` → `status`. GET_WAVEFORM reports applied configuration in fresh telemetry, not captured PA4 samples. Custom numeric values remain unsigned integer **tenths**, including with aliases. Plain text commands and the illustrative unversioned `cmd` example are not accepted. Preset values and waveform settings remain those in the tables above; a preset command does not accept overriding numeric fields.

Example after a session handshake and WEB_COMMAND source selection:

```json
{"version":1,"session":77,"id":3,"op":"environment","turbidity":850,"depth":180,"temperature":248}
```

A response is `{"version":1,"type":"ack","session":77,"id":3,"status":"ACCEPTED","reason":""}`. Rejection uses `REJECTED` and a bounded reason. An ACK means command acceptance, not waveform application. Malformed/unidentifiable commands receive a rejection with session/id zero.

Version-1 telemetry remains readable by the bridge. Optional extensions are `firmwareMode`, `capabilities.controlVersion`, `environment`, `control`, `applicationAck`, and `requestedWaveform`. Adaptive mode is `ADAPTIVE_TRANSMITTER`; ordinary bring-up is `BRINGUP`. Legacy telemetry without these fields remains supported and command capability gates the controls. `environment.profile` identifies a named preset, `CUSTOM`, or `ADC_DIAL` independently of the policy class.

Existing `waveform` remains the last applied configuration. `control` contains accepted/requested/applied IDs, decision IDs, enabled/qualified state, inhibition reason, modulation/window, uptime and last decision-to-output time. `hasApplied:false` means that timing has no applied decision yet. Historical ADC-only `adaptation` packets remain supported. `health.TIMER`, `health.DMA`, `health.DAC` report logical operating/inhibition/fault status; `engine` reports TIM6 sample rate, buffer length, CPU workload and underruns. Active burst operation includes idle intervals between pulses; these fields do not claim a captured voltage trace.

After a prepared decision is committed at a pulse boundary, subsequent telemetry includes `applicationAck` with `status:APPLIED`, original request/session, applied decision ID, environmental preset and policy class. It is a persistent record of the last applied pulse, retained after Stop or a session change; it does not mean output remains enabled. The browser distinguishes this from command acceptance and takes applied numeric settings from `waveform`. Recordings retain the new fields. New sessions cannot claim an earlier session's application acknowledgment.

`decisionToOutputMs` measures qualified decision to scheduled pulse start using the firmware clock. It includes synthesis/scheduling, excludes input/filter qualification, and is not an oscilloscope measurement. Browser command round-trip time is displayed separately.

## Output and connection behavior

- Output starts disabled; source selection disables it and reinitializes qualification. There is no automatic source fallback.
- A short B1 press cycles modulation. Holding B1 for one second toggles output; releasing a held press does not cycle modulation.
- The controlling browser sends a heartbeat every 500 ms while visible. The bridge renews the web lease only for its owner; the MCU expires it after 2 seconds without keepalive. Expiry disables output and invalidates the web input. Apply a new environment, wait for qualification and explicitly Start again.
- Browser close queues Stop behind an in-flight command for enabled WEB output. Lost serial connection, a hidden tab or bridge shutdown ends lease renewal; the 2-second MCU expiry backs up Stop. Detection/bridge scheduling can add delay before the last keepalive; the 2-second MCU interval begins at that keepalive.
- ADC operation, once started, does not depend on the browser. ADC rails (`raw <= 12` or `>= 4083`), conversion timeout and stale samples inhibit output. A floating input may still look valid; this is not disconnected-wire detection.
- DMA/DAC faults latch until MCU reset. Stop, source changes, invalid input and faults can truncate an active pulse. The parked DAC is midscale, approximately 1.65 V, not electrical isolation.
- Reconnect/restart clears pending command tracking and never replays Start or environment commands. An ACK timeout reports unknown outcome until fresh telemetry reconciles state.

## Data provenance

The host regenerates the digital TX reference using the C waveform generator and firmware-applied settings. It does not sample PA4. TX time, FFT and spectrogram plots consume that reference. One worker computes illustrative RX using a 63-tap Hann low-pass (80 kHz cutoff), 4× decimation and compensated group delay, then derives RX products from that single modeled buffer. Processing is capped at four updates/s with obsolete results discarded, outside the serial/control event loop.

All of this remains under `preview`, labelled calculated/modelled. The legacy companion is nested under `digital`; physical `samples`, sensors, power and validation fields are not replaced. Power planning uses a separate `powerEstimate` with nominal pack voltage, explicit load assumptions and no invented SOC. The modeled scene is 0–3 m; an 80 m environmental input does not demonstrate 80 m detection. Recording preserves these namespaces; playback cannot issue transmitter commands. Session Pause/Stop governs recording/playback activity; **Stop output** or **Stop reference** is the transmitter control.

## Wiring before physical commissioning

1. Power off before rewiring. Use USB bench power with driver/transducers disconnected.
2. Disconnect the TDS signal from A0. For ADC testing, connect a 10 kΩ pot between 3.3 V and GND, wiper to A0/PA0. Never apply 5 V or raw 0.5–4.5 V sensor output.
3. Scope CH1 goes to A2/PA4 and common GND; optional sync is D7/PA8. Disconnect HC-SR04 D7 and TFT D13: this image uses those pins for sync and LED. It does not operate the TFT or A5 loopback.
4. Retain the Arduino sketch to restore that separate application. Review the complete [wiring reference](../arduino/README.md).
5. Install the adaptive binary only as a deliberate bench action. No build/test command in this implementation flashes a board.

## Physical acceptance — all pending

- [ ] Verify boot-disabled output and parked DAC level.
- [ ] Web presets change actual PA4 center/bandwidth/duration/amplitude.
- [ ] All three waveform families and four windows work without buffer corruption.
- [ ] Repeat equivalent profile changes with A0; verify hysteresis and invalid-input behavior.
- [ ] Check Start/Stop, source switching, B1 short/long press, disconnect/lease expiry and restart behavior.
- [ ] Compare input changes, firmware timestamps and scope output timing.
- [ ] Retain time, FFT and spectrogram captures; measure distortion and windowing effects.
- [ ] Run an extended session with zero DMA/DAC errors; measure real idle/average/transmit power and energy per ping.
- [ ] Repeat after analog filter/amplifier integration; separately commission acoustic hardware and enclosure.

Host tests, browser checks and ARM builds do not establish these physical results. The filter/amplifier, calibrated sensors, underwater transducers/RX and fabricated enclosure remain separate work; PS 26058 is not yet physically complete.
