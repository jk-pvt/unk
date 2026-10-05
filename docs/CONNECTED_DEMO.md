# Connected AquaSDR console — implementation report

2026-10-01. Software implemented and verified; adaptive firmware **not flashed**. The installed `AquaSDR Arduino sensor bridge 1.7 demo-TFT` and mounted wiring remain unchanged. The physical acoustic transmitter/receiver are absent. The user's latest choice preserves the tested three waveform classes.

## What works now

The console has two explicit command targets. A command-capable adaptive STM32 receives physical controls through USB/USART2 after its capability/session handshake. A fresh telemetry-only sensor/TFT payload instead offers a **COMPUTED companion**, running the same C control, policy and waveform sources on the host. Its Apply/Start reference/Stop reference controls do not reach the legacy board. No automatic fallback redirects a physical command to that helper.

Live board sensors, power, samples, validation and health stay authoritative. The companion lives in `current.digital`; model products live under `preview`; planned power lives under `powerEstimate`. Actual adaptive telemetry takes precedence over any companion. Playback preserves these namespaces and cannot send commands.

The central operational state covers connection, command readiness, pending/unknown outcomes, environment application, waveform, reference output and modeled RX. Mission, Sonar, Adaptation, Validation, Sensors, Power, Hardware and Logs share it. Missing transducers or instruments do not disable computed controls. A0 remains disabled for the mounted legacy image because it is a sensor channel, not the adaptive dial.

## Exact demo sequence with the current mounted payload

1. From `/Users/sudharsan/Downloads/AquaSDR`, run `npm run dev`. Open `http://127.0.0.1:5173/`. Host Node and `cc` must be available.
2. Choose **Connect AquaSDR payload**, select `/dev/tty.usbmodem114203` (or its current USB port), then open the payload console. Confirm fresh **LIVE MCU** telemetry and the actual sensor/TFT firmware identity.
3. Open Adaptation. Confirm **COMPUTED · COMMAND CHANNEL READY** and the compact legacy compatibility message. Close other controlling tabs first; a second browser cannot take an active owner's web lease.
4. Select **Web control**, **Clear shallow reef**, then **Apply environment**. The acknowledgement indicates acceptance. Wait for qualification; requested values become 42 kHz / 4 kHz / 2 ms / 35%. Applied fields remain unavailable until the first reference pulse.
5. Press **Start reference** explicitly. Confirm pulse application and populated applied values, the C reference, modeled RX and history. This starts the host C scheduler; it does not change the legacy DAC.
6. Select **Muddy estuary**, then Apply. Observe the filtered transition through the tested classes to 38 kHz / 1 kHz / 8 ms / 62%. Before/requested/applied and timing are separate. The model's RX buffer changes with the environment.
7. Select **Deep open water** and **Sediment plume** and Apply each. Both select the same murky waveform class while their inputs and modeled returns differ. Edit any slider to create Custom; severity is `max(index, depth metres)`. Temperature changes propagation preview, not policy selection.
8. Select geometric or phase-coded modulation and any supported window, then **Apply modulation / window**. Compare Waveform, FFT and Spectrogram. Barker-13 bandwidth is coding-dependent.
9. Inspect Sonar's modeled A-scan, echogram, spectrum, spectrogram and detections; Validation's sample-derived FFT centroid, occupied bandwidth, duration, envelope amplitude and DAC codes; Sensors' actual live channels; Power's measured values when present or separate nominal/load estimate. Scope results remain unavailable.
10. Use REC/SAVE/EXPORT and inspect Logs/history. Replay cannot transmit. **RX CHECK** checks the modeled envelope; it is not instrument calibration.
11. Press **Stop reference**. Reload restores the workspace without replaying Start or environment commands. Closing the controlling browser queues Stop for WEB output; missing heartbeat also expires the C/MCU lease. Starting again requires valid qualified input and an explicit Start.

For a future compatible adaptive bench, this sequence uses **Start output / Stop output** and actually commands TIM6 → DMA → DAC PA4. Select A0 only after its specified bench wiring is prepared. A source change stops output and resets qualification; A0 uses index / 0 m / 25 °C and operates autonomously after Start. **Those physical steps have not been performed.**

## Exact serial and API protocol

USART2/ST-LINK VCP: 115200 baud, 8N1; one flat JSON object per newline, maximum 512 bytes. Every command carries `version:1`, a nonzero session and increasing request ID. Plain text illustrative commands are not accepted. No browser-specified final frequency/bandwidth/duration/amplitude is admitted.

```json
{"version":1,"session":77,"id":1,"op":"PING"}
{"version":1,"session":77,"id":2,"op":"GET_STATUS"}
{"version":1,"session":77,"id":3,"op":"SET_INPUT_SOURCE","source":"WEB"}
{"version":1,"session":77,"id":4,"op":"SET_ENV","profile":"CLEAR_SHALLOW_REEF"}
{"version":1,"session":77,"id":5,"op":"START_OUTPUT"}
{"version":1,"session":77,"id":6,"op":"keepalive"}
{"version":1,"session":77,"id":7,"op":"SET_ENV_VALUES","turbidity":850,"depth":180,"temperature":248}
{"version":1,"session":77,"id":8,"op":"waveform","mode":2,"window":3}
{"version":1,"session":77,"id":9,"op":"GET_WAVEFORM"}
{"version":1,"session":77,"id":10,"op":"STOP_OUTPUT"}
{"version":1,"session":77,"id":11,"op":"SET_INPUT_SOURCE","source":"A0"}
```

Wait for qualified input before Start. Renew WEB every 500 ms with increasing IDs; expiry is 2 s. Numeric environment values above are integer **tenths**. Modulation: 0 LFM, 1 geometric, 2 Barker-13. Window: 0 RECT, 1 HANN, 2 HAMMING, 3 BLACKMAN. GET_STATUS/GET_WAVEFORM acknowledge then request fresh telemetry; GET_WAVEFORM returns applied configuration, not captured DAC data. PING establishes the session. The bridge detects advertised capability before sending it to a board.

Acceptance: `{"version":1,"type":"ack","session":77,"id":4,"status":"ACCEPTED","reason":""}`. Pulse application is a separate telemetry `applicationAck`, with original session/request ID, decision ID, profile and policy; applied numeric values come from `waveform`. Rejected, malformed, duplicate and oversized commands never silently execute. Two-second ACK timeout reports unknown outcome pending fresh telemetry. Reconnect/restart clears tracking without replaying commands.

HTTP requires a browser client UUID registered by the telemetry WebSocket heartbeat. `POST /api/environment` accepts either `{profile:"MUDDY_ESTUARY"}` or `{turbidityIndex:85,depth:18,temperature:24.8}`, plus client and explicit target. In connected legacy mode use `target:"COMPUTED"`; `STM32` remains read-only. `POST /api/transmitter` accepts `source`, `waveform`, `start`, `stop`, `status`, `get_waveform`, `ping`; additional source or mode/window fields apply as appropriate. Requests are serialized, and conflicting submissions are rejected.

## Coherent data and verification

The shared C waveform generator produces the digital reference from applied settings. TX time/FFT/STFT use that buffer. A worker low-pass filters and decimates it, propagates it through a deterministic environment and target scene (~1.2/2.4/2.8 m), and derives RX products from one RX buffer. Attenuation/scattering depend on input index/depth; temperature affects sound speed. Updates are capped at 4 Hz, and obsolete work is discarded outside serial processing. An 80 m input does not demonstrate 80 m detection.

Digital validation uses the raw C reference: FFT power centroid/peak, 99% occupied bandwidth, sample-count duration, RMS and actual DAC code range. It does not replace missing oscilloscope data. Power estimates assume nominal 11.1 V / 5.2 Ah, 105 mA electronics and a hypothetical driver load at 10 pings/s; SOC and measured energy stay unavailable without telemetry.

- **74 automated tests passed**, 0 failed/skipped. Coverage includes C policy equivalence, hysteresis/qualification/staleness, presets/bounds, parser recovery/UART errors, pulse scheduling, accepted/applied IDs, ownership, timeout/reconnect, lease/close stop, namespace isolation, recording/replay and digital validation.
- Dashboard production build passed. Both ordinary and adaptive ARM builds passed. Existing Three.js chunk-size and newlib nosys warnings remain; there were no build errors.
- Browser checks verified Clear → Muddy, before/requested/applied, geometric/Blackman and Barker-13, TX/FFT/STFT, useful Validation/Sonar/Mission/Sensors/Power/Hardware/Logs, reload persistence, Stop and no page errors. Live legacy telemetry/companion separation and a second-browser ownership rejection were inspected separately.
- No flash, physical A0 sweep, scope capture, analog latency, physical acoustic return or underwater test was performed. Fixed mounted wiring prevents the adaptive bench pin changes in this session.

## Changed implementation files

- Firmware: `src/command.c`, `control.c/.h`, `config.h`, `main.c`, `telemetry.c`, `host/engine.c`, `test/host_control.c`, `Makefile` and `ADAPTIVE_BENCH.md`. Named commands, profiles, fresh status, original-session application ACK and build handoff; Arduino sketch unchanged.
- Server/shared: `server/index.js`, `control-link.js`, `preview-worker.js`; `shared/environment.js`, `operational-state.js`, `digital-validation.js`, `acoustic.js`, `power.js`, `protocol.js`, `hardware-evidence.js`. Explicit companion target, deterministic RX, digital checks, safe power separation, telemetry and recording.
- UI: `src/App.jsx`, `pages/EnvironmentControl.jsx`, `pages/blocks.jsx`, `pages/pages.jsx`, `ui/OperationalStatus.jsx`, `ui/PayloadScene.jsx`, `ui/PowerCard.jsx`, `ui/kit.jsx`, `minimal-theme.css`. Shared state, compact provenance, active computed controls and consistent cards.
- Verification/documentation: control, native-engine, API, environment-UI, hardware-evidence, operational-state and digital-validation tests; this guide, `ADAPTIVE_FIRMWARE_HANDOFF.md`, `HOSTINGER_DEPLOYMENT.md`.

Exact binary: `/Users/sudharsan/Downloads/AquaSDR/firmware/build-adaptive/aquasdr.bin` (33,160 bytes). SHA-256 `9061976fad7422796c35212df0a2326c24c075645fcbbeb568d538edc673e71d`. Exact build and **later** flashing commands are in [the installation handoff](ADAPTIVE_FIRMWARE_HANDOFF.md). Flashing remains on hold under the user's instruction. Hardware acceptance and PS 26058 physical completion remain separate.


The subsequent [screenshot review fixes](SCREENSHOT_REVIEW_FIXES.md) improve narrow-chirp spectrograms and separate computed TX, modeled RX, the pulse scheduler and physical DAC telemetry. The tested firmware settings remain unchanged.
