# AQUASDR · Mission Control

A local engineering console for an adaptive sonar payload. React/Vite frontend, Node/Express serial bridge, WebSocket telemetry, and a deterministic test bench.

## Run

Requires Node.js 22+.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The serial bridge listens on **127.0.0.1:4318**.

Production:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:4318**. Keep the bridge on the computer connected to the payload. This application is intentionally local: it needs USB/serial access, and is not a hosted hardware-control service.

## What is implemented

- Mission, Sonar, Adaptation, Validation, Sensors, Power, Mapping, Hardware, and Logs views.
- Deterministic environmental and acoustic echo simulation, explicitly labelled DEMO.
- Sampled LFM chirp, geometric sweep, and Barker-13 phase-coded pulse generation.
- Radix-2 FFT, Hann window, digital RMS/peak analysis, and actual STFT pulse spectrogram.
- Waveform controls update the generated signal and the demonstrator power model.
- A demonstrator adaptation rule, visible decision chain, and event timeline.
- Serial JSON-lines parsing, schema validation, sequence-gap detection, WebSocket stream, heartbeat, reconnect, and stale-data masking.
- New/start/pause/stop, recording, local session save, and JSON export.
- Keyboard controls, labelled forms, modal focus trapping, responsive layouts, and reduced-motion support.
- Jury presentation path through environment → adaptation → waveform → validation → power.

## What is not validated or implemented

No physical device, oscilloscope capture, firmware source, project logo, or calibration files were provided. Hardware compatibility and physical analog/acoustic output have **not** been validated. Sensor hardware names are deliberately generic. The header uses a text wordmark, not a fabricated project logo.

The bridge **reads telemetry only**. It does not transmit hardware configuration commands or energize a transducer. Commissioning commands requires the actual firmware contract and instrument validation. The waveform editor controls the test bench; it is disabled in hardware mode.

Mapping is a clearly marked future capability. No seabed reconstruction, object recognition, efficiency measurement, or fabricated oscilloscope measurement is provided. The unvalidated turbidity rule is a demonstration of the decision pipeline, not a scientific claim about optimal sonar operation.

## Demonstrate

1. Leave **DEMO MODE** selected. The echogram shows normalized synthetic acoustic returns.
2. Open **Configure waveform**. Change center frequency, bandwidth, pulse duration, amplitude, or waveform type. Apply the change; the generator, FFT, and power model update. Manual changes disable the automatic demo policy.
3. Open **Adaptation**, enable the policy, then **Simulate turbidity increase**. Above 30 NTU, the waveform becomes LFM CHIRP, bandwidth becomes 25 kHz, and pulse duration becomes 10 ms. The event log explains why. Clearing the scenario returns environmental input to baseline; the waveform remains at its last setting until manually changed or a new session starts.
4. Open **Validation**. Target values and digital analysis are available; physical measurements stay unavailable without reported instrument data.
5. Press **Record**. **Save** writes a JSON file under `data/`; **Export** downloads the same session structure. **New session** saves the previous session before clearing it. Switching data source also saves the previous session and starts a separate session.
6. Enable **Jury presentation mode** in Console settings for a direct demonstration path.

## Signal conventions

- Generator sample rate: 1 MHz. Frequency and bandwidth settings: kHz. Pulse duration: ms. Amplitude: percent of normalized full scale.
- LFM integrates instantaneous linear frequency; geometric sweep integrates exponential instantaneous frequency. Phase-coded mode modulates a center-frequency carrier with Barker-13 chips; its chip rate is 13 / pulse duration, so the sweep bandwidth control is disabled for this mode. The waveform summary displays chip rate instead.
- Pulses use a 3.5% edge ramp. The time preview shows the first 0.23 ms (0.60 ms expanded), not the whole pulse. The STFT shows the full pulse with a 256-sample Hann window and 100 columns.
- FFT uses up to the first 8192 samples, zero pads shorter pulses, applies a Hann window and coherent-gain normalization. For chirps, the FFT peak is not the same as center frequency. dBFS uses normalized sample amplitude; there is no voltage calibration.
- The synthetic echogram is a deterministic reference model with two reflectors and a decaying tail. It is **not** a measured or reconstructed seafloor. The demo initializes its display with a synthetic 60-second history; this prefill is never stored as recorded telemetry.
- Display gain changes color mapping only. It does not alter signal samples or transmitted amplitude.
- Demo power responds to amplitude squared, pulse length, and configured bandwidth. It is illustrative, not a calibrated battery or conversion-efficiency model.

## Hardware protocol (version 1)

Connect a serial device at **115200 baud** using Hardware → Refresh ports → Connect device. The device must appear in the OS serial-device enumeration. The connection can automatically retry after the selected device disconnects. Explicit Disconnect cancels reconnect.

Each line is a complete UTF-8 JSON object terminated with `\n`:

```json
{
  "version": 1,
  "type": "telemetry",
  "source": "hardware",
  "seq": 1,
  "timestamp": "2026-09-27T12:00:00.000Z",
  "payload": {
    "sensors": {
      "temperature": 26.4,
      "turbidity": 12.4,
      "pressure": 1.28,
      "depth": 2.76,
      "conductivity": null
    },
    "power": {
      "voltage": 24.1,
      "current": 0.81,
      "watts": 19.521,
      "energy": null
    },
    "waveform": {
      "mode": "LFM CHIRP",
      "frequency": 200,
      "bandwidth": 40,
      "pulse": 8,
      "amplitude": 62
    },
    "health": { "STM32": "ONLINE", "ADC": "READY", "DAC": "ACTIVE" },
    "firmware": "your-firmware-version"
  }
}
```

Example values are documentation only and are never injected in hardware mode.

Required sensor and power fields use **null for unavailable**. Units: temperature °C, turbidity NTU, pressure bar, depth m, conductivity mS/cm, voltage V, current A, watts W, energy Wh. The producer is responsible for calibration and provenance.

Optional payload fields:

| Field        | Contract                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `echo`       | 2–2048 normalized intensity bins in [0,1], uniformly spaced from zero to `rangeMax`                                                                             |
| `rangeMax`   | Required with `echo`; maximum measured range in meters                                                                                                          |
| `samples`    | 32–32768 normalized ADC samples in [-1,1]                                                                                                                       |
| `sampleRate` | Required with `samples`; samples per second, up to 10 MHz                                                                                                       |
| `waveform`   | Actual reported waveform configuration; same units as the editor                                                                                                |
| `health`     | Status strings, e.g. ONLINE, READY, ACTIVE, OK, ERROR, FAULT, OFFLINE                                                                                           |
| `firmware`   | Version string                                                                                                                                                  |
| `validation` | Instrument-reported values: `frequency` kHz, `bandwidth` kHz, `pulse` ms, `amplitude` % FS, `noiseFloor` dBFS, `sidelobe` dB, `thd` %. Every field is nullable. |

A measurement should only be populated from a real measurement source. `validation` is never derived from target settings. The dashboard cannot independently prove that firmware supplied honest/calibrated measurements.

- Sequence must increase within a connection; duplicates/out-of-order frames are rejected and gaps counted. Reconnect resets sequence tracking.
- Invalid JSON/schema/non-finite values are rejected; maximum serial line is 1 MiB. Recovery starts at the next newline.
- Live data is masked after **3 seconds without a valid packet**. Device timestamp is preserved, while freshness uses bridge receipt time.
- WebSocket heartbeat every 15 seconds; frontend reconnect every 1.5 seconds and stale bridge detection after 5 seconds.
- Pausing freezes demo generation/session time. On hardware it pauses session capture, while telemetry monitoring continues. Display Freeze freezes the echogram independently.
- No Raspberry Pi process metrics are invented. A Pi can run this bridge, but additional processing/storage telemetry requires an explicit contract.

## APIs

`GET /api/system`, `/api/sensors`, `/api/waveform`, `/api/power`, `/api/hardware`, `/api/logs`, `/api/ports`, `/api/sessions`, `/api/export`.

`POST /api/mode` with `{ "mode": "demo" | "hardware" }`.

`POST /api/waveform` with a validated configuration, demo only.

`POST /api/control` with `{ "action": "new" | "start" | "pause" | "stop" | "record" | "adaptive" | "scenario" }`.

`POST /api/connect` with `{ "path": "/dev/your-serial-device" }`; `POST /api/disconnect`; `POST /api/save`.

WebSocket: `/ws/telemetry`. Frames carry mode/source, configuration, telemetry, hardware state, recent events, and a 240-point history. Local mutations reject cross-origin requests. This is a trusted, single-operator local tool, not a multi-tenant service.

## Storage and reproducibility

Session JSON contains schema version, session ID, start/save times, mode, deterministic model identifier, parameters, elapsed time, decision events, and recorded telemetry snapshots. Recording has a **7200-sample or 64 MiB** limit and stops visibly at the limit. The display retains 240 telemetry points and the event log retains 500 events. Recordings exist in memory until Save, Export, New session, or a source change. Saved JSON files survive bridge restarts. There is no in-app historical session replay yet; exports retain the inputs needed to reproduce the deterministic model.

## Checks

```sh
npm test
npm run build
```

Tests cover waveform sample count/amplitude, a calibrated known FFT tone, chirp band energy, distinct waveform modes, digital amplitude estimators, deterministic simulation, parameter validation, hardware source validation, fragmented/malformed/oversized serial frames, and required sample metadata.
