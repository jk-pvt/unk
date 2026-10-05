# AquaSDR firmware — transmit engine and adaptive bench candidate

`make adaptive` builds the **environment-controlled candidate**: web serial commands
and a physical A0 dial share one C policy. It boots with output disabled and supports
source selection, Start/Stop, all three modulation families and four windows.
The same C code also runs in the console's native host simulation.
Read [ADAPTIVE_BENCH.md](ADAPTIVE_BENCH.md) for the protocol, workflow and pending
physical checks. The ordinary `make` build retains the bring-up sequence below.

Bare-metal C for the NUCLEO-F446RE. No HAL or CubeMX: every register it
touches is in `src/regs.h`, with its RM0390 name.

What this milestone does:

- **TIM6 → DMA1 Stream 5 → DAC1 (PA4)** at exactly 1 MS/s. The CPU does no
  per-sample work while a pulse streams, and TIM6 only runs during a pulse.
- **Pulse synthesis** by 32-bit phase-accumulator DDS from a sine table built
  once at boot: LFM chirp, geometric sweep, Barker-13 phase-coded pulse, CW.
- **Digital windows**: rectangular (off), Hann, Hamming, Blackman.
- **Double buffering**: the next pulse is synthesised into the spare buffer
  and swapped in between pings, so a pulse never changes mid-flight.
- **10 pings/s**, with a sync output for triggering the scope.
- **JSON telemetry** over the ST-LINK USB serial port, in the format the
  dashboard already reads (see the top-level `README.md`). The dashboard's
  Sonar, Hardware and Power pages then show the real waveform, TIMER/DMA/DAC
  state, buffer size and measured CPU load.

Not in the ordinary bring-up build: sensors or adaptation. The opt-in adaptive
build reads a dedicated voltage input or browser-commanded environment (neither is a calibrated environmental measurement).
Neither bare-metal build includes INA219 power readings or the ST7735 TFT. Telemetry
reports those as `null` / `NOT CONNECTED` rather than inventing values.

The separate [Arduino combined bench sketch](../arduino/04_all_sensors/04_all_sensors.ino)
already implements the sensor/TFT bridge and continuous DAC loopback. These are
different firmware images. See the [complete wire-by-wire reference](../arduino/README.md)
before changing images: D7 is HC-SR04 TRIG in that sketch but scope sync here;
D13 clocks the TFT there but drives the ping indicator here. Disconnect those
module signals before the bare-metal scope test.

## Why DAC1 on PA4 and not DAC2 on PA5

On the NUCLEO-F446RE, PA5 also drives the green user LED (LD2). The LED
would load the DAC output and distort the waveform. DAC1 on PA4 is free, uses
the same TIM6 trigger, and has its own DMA stream (DMA1 Stream 5), which
leaves Stream 6 free for sending telemetry. PA5 is used as a ping indicator.

## Pins

| Pin | Header | Use |
| --- | --- | --- |
| PA4 | CN8 A2 | DAC1 output → scope CH1 (later the TLV9062 input) |
| PA8 | CN9 D7 | Sync: high while a pulse streams → scope CH2 / trigger |
| GND | any GND | Scope ground |
| PA5 | LD2 | Toggles on every ping (solid on for CW) |
| PC13 | B1 (blue) | Next bring-up step |
| PA2/PA3 | ST-LINK VCP | 115200 baud telemetry over the USB cable |

### Planned integration from the Arduino bench build

| Pin | Header | Use |
| --- | --- | --- |
| PA0 | A0 | TDS module (0–2.3 V, direct) |
| PA1 | A1 | Pressure sensor, 0.5–4.5 V through a 10 kΩ / 20 kΩ divider |
| PB0 | A3 | Turbidity sensor (switch on A), 0–4.5 V through a 10 kΩ / 20 kΩ divider |
| PC1 | A4 | DS18B20 1-Wire, adapter powered from 3.3 V |
| PC0 | A5 | Receive signal from TLV9062 B |
| PB8 / PB9 | D15 / D14 | I²C1 at 3.3 V: INA219 ×2 (0x40, 0x41), IMU (0x6A/0x6B, 0x30), BMP390 (0x77) |
| PB6 / PB10 / PB3 | D10 / D6 / D3 | ST7735 CS / DC / RESET |
| PA7 / PA5 | D11 / D13 | ST7735 MOSI / SCK; resolve the PA5 indicator conflict before integration |
| PA8 / PA9 | D7 / D8 | HC-SR04 TRIG / protected ECHO; resolve the PA8 sync conflict before integration |

The 1602 LCD is retired. Remove its D3/D6 wiring and 5 V pull-ups before using
those pins for the ST7735. The current display uses 3.3 V SPI signals; I²C1
remains the separate 3.3 V sensor bus. The table above is a future integration
plan, not peripherals initialized by this bare-metal image.

Power: the pack is 3S2P Li-ion (11.1 V nominal, 12.6 V full, 9.0 V at
cut-off), feeding the MP1584 set to 5.00 V. Set the buck's output with a
multimeter before connecting anything.

## Build and flash

```bash
brew install --cask gcc-arm-embedded
```

```bash
make
```

```bash
make flash
```

`make flash` copies `build/aquasdr.bin` onto the NUCLEO's USB drive
(`/Volumes/NOD_F446RE`). Dragging the file there in Finder does the same.

To see it in the dashboard: `npm run dev` in the repository root, open
**Hardware**, pick the `/dev/cu.usbmodem…` port, and press **Connect**.

## Bring-up sequence (press the blue button to advance)

Starts at step 1. With a 3.3 V DAC reference, 62 % amplitude is about
2.05 V peak-to-peak around 1.65 V. Use AC coupling on the scope, or remove
the offset later in the TLV9062 stage.

| Step | Output | What to check on the scope |
| --- | --- | --- |
| 1 | 40 kHz CW, continuous | Period 25.0 µs, ~2.05 Vpp, clean sine. FFT: one line at 40 kHz |
| 2 | LFM 39–41 kHz, 2 ms, no window | 2 ms burst every 100 ms, square edges. FFT: 39–41 kHz band with high sidelobes |
| 3 | Same, Hann window | Bell-shaped envelope, no step at start/end. FFT: sidelobes clearly lower than step 2 |
| 4 | Hann, 8 ms pulse | Burst 4× longer |
| 5 | Hann, 8 ms, 30 % amplitude | Burst about half the height (~1.0 Vpp) |
| 6 | Geometric sweep | Like step 3; the sweep is exponential rather than linear |
| 7 | Barker-13 phase-coded | 40 kHz carrier with 13 chips of ~154 µs and visible phase flips |

Trigger on CH2 (PA8, rising edge) with 500 µs/div for the 2 ms pulses. For
the FFT, use a 30–50 kHz span with averaging on. Stepping 2 → 3 (window off →
on) is the sidelobe comparison for the judges.

## Things to watch in the first bench session

- **DAC settling.** The buffered DAC settles in a few µs, and at 1 MS/s each
  40 kHz cycle is only 25 samples. If the sine looks rounded or smaller than
  expected, that is the DAC's own low-pass. Note what you see; the TLV9062
  reconstruction filter comes after it anyway.
- **Headroom.** With the output buffer on, the DAC can't swing closer than
  about 0.2 V to either rail. Stay at or below about 85 % amplitude.
- **Underruns.** The `underruns` counter in telemetry (Hardware → Diagnostics,
  and the DMA state) must stay at 0. If it doesn't, the DMA is missing
  sample deadlines.
- **CPU load** is measured from the cycle counter as time spent outside
  sleep in the main loop; short interrupt handlers aren't counted. During a
  step change it briefly includes the time to synthesise the new pulse.

## How the synthesis is verified

`src/waveform.c` has no hardware code. `tests/firmware-twin.test.js` (part
of `npm test`) compiles it for the Mac and checks every mode and window
sample-by-sample against the dashboard's model in `shared/signal.js`. They
agree to within half a DAC step, which is pure 12-bit rounding.
