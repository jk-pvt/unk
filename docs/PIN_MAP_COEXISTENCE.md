# Pin map: mounted payload vs adaptive transmitter

**Constraint:** the payload is assembled and mounted. Nothing in this plan requires opening it, disconnecting a wire or moving a module. Conflicts are resolved in firmware.

Sources: `arduino/README.md` (wire-by-wire reference), `arduino/04_all_sensors/04_all_sensors.ino` (what is flashed today), `firmware/src/main.c` (bare-metal adaptive image), `arduino/05_sensors_adaptive_tx/` (the combined image that resolves them). Where a document and the source disagreed, the source was used.

## 1. Current mounted map (what the installed sensor image uses)

| Header | MCU pin | Mounted device | Used by `04_all_sensors` |
|---|---|---|---|
| A0 | PA0 | TDS board analog out (0–2.3 V, direct) | ADC read |
| A1 | PA1 | Pressure divider midpoint | ADC read |
| A2 | PA4 (DAC1) | **Jumper to A5** (later: filter input) | DAC output, 40 kHz CW loopback tone |
| A3 | PB0 | Turbidity divider midpoint | ADC read |
| A4 | PC1 | DS18B20 1-Wire | 1-Wire |
| A5 | PC0 | A2 loopback (later: RX) | ADC read |
| D0/D1 | PA3/PA2 | ST-LINK USB serial | USART2, 115200 |
| D2 | PA10 | **unused** | |
| D3 | PB3 | TFT RESET | GPIO |
| D4, D5 | PB5, PB4 | unused | |
| D6 | PB10 | TFT DC | GPIO |
| D7 | PA8 | HC-SR04 TRIG | GPIO |
| D8 | PA9 | HC-SR04 ECHO | GPIO |
| D9 | PC7 | unused | |
| D10 | PB6 | TFT CS | GPIO |
| D11 | PA7 | TFT MOSI | software SPI |
| D12 | PA6 | unused | |
| D13 | PA5 | TFT SCK (also LD2) | software SPI |
| D14/D15 | PB9/PB8 | I²C: INA219 ×2, BMP390, IMU, magnetometer | I²C1 |
| internal | TIM6, DMA1 Stream 5 ch 7, DAC1 | no external wire | **already** used for the DAC loopback tone (`SonarLoopback.h`) |

## 2. What the bare-metal adaptive image needs, and the conflicts

| Need | Pin / resource | Conflict with the mounted payload | Resolution |
|---|---|---|---|
| Environment input | A0 / PA0 as a 0–3.3 V dial | **TDS board is on A0** | Use the TDS signal as the A0 input (below). No pot, no disconnect |
| Scope sync, high during a pulse | D7 / PA8 | **HC-SR04 TRIG is on D7**; a 2–8 ms high would trigger the ranger | Moved to **D2 / PA10**, unused by every mounted module. Optional: nothing needs to be connected to it |
| Ping LED | D13 / PA5 | **TFT SCK is on D13** | Dropped. PA5 is never driven by the transmitter |
| TFT, HC-SR04, sensors, INA219 | n/a | The bare-metal image has **no drivers** for them, so they would go dark | Not acceptable, so the engine runs **inside the sensor sketch** (below) instead of replacing it |
| TIM6 → DMA1 S5 → DAC1 → PA4 | internal + PA4 | none: the sensor sketch already uses exactly this path | Reused unchanged in role; PA4's A5 jumper only adds a high-impedance ADC load |
| UART RX for commands | USART2 | the sensor sketch has no command receiver; the core's interrupt-driven `Serial` **dropped 27–42 % of 72-byte commands** under telemetry load (measured on the board, build 1) | Command parser added. Build 2 tried DMA for RX on Stream 7 and received nothing (USART2_RX is Stream 5 ch 4, the DAC's stream), so it is broken. Build 3 (on the board): core interrupt RX plus DMA TX (Stream 6 ch 4). Builds 3 and 4 shipped with a **64-byte** RX ring (stale core cache) that dropped command lines over 63 bytes; build 5 fixes it (330 of 330 commands acknowledged, 0 lost) |

Peripheral sharing inside the combined image:

| Resource | Owner | Note |
|---|---|---|
| TIM6, DMA1 Stream 5, DAC1 | Adaptive transmitter | The core does not use them (`DMA1_Stream5_IRQHandler` is not defined by the core; verified in the linked ELF) |
| TIM6/DAC interrupt | Not enabled | The core defines that vector for its own timer library; DAC underrun is polled instead |
| ADC1 | Main loop only | A0 (every 20 ms), A1, A3, A5. No interrupt touches the ADC, so there is no re-entrancy |
| USART2 | RX: core `Serial`; TX: DMA1 Stream 6 | Build 1 transmitted through `Serial` and lost commands; build 2 put RX on a wrong DMA stream. Build 3 splits them. RX cannot use DMA: USART2_RX shares Stream 5 with DAC1 |
| SysTick | Arduino `millis()` | Used for all scheduling |
| I²C1, 1-Wire, software SPI | Existing drivers, unchanged | Same pins, same libraries, same code |

## 3. Resulting map: combined image `05_sensors_adaptive_tx`

Identical to section 1, with two changes, **neither of which needs a wire**:

| Pin | Before | After |
|---|---|---|
| PA10 / D2 | unused | scope sync output, high during a pulse |
| PA4 / A2 | continuous 40 kHz tone | adaptive burst pulses (parked at about 1.65 V when output is off) |

`SonarLoopback.h`'s continuous tone is not in the new image. Because A2 stays jumpered to A5, the new image measures the live DAC pin during each pulse (about 48 ADC samples on A5 plus DAC register reads) and reports it as `health.LOOPBACK` / `DAC_REGISTER`. That is a real measurement of the DAC pin, but it is a coarse min/max sampler, not a scope.

## 4. A0 and the TDS board

One adaptation engine, two sources:

```text
WEB command ─────────────────────────┐
                                     ├─► EnvironmentState ─► same C policy ─► waveform ─► TIM6+DMA ─► DAC PA4
A0 (mounted TDS board) ► ADC ► level ┘
```

- **Scaling.** The board outputs 0–2.3 V. `ADC_FULLSCALE_COUNTS = 2854` (2.3 V on a 3.3 V, 12-bit ADC) maps that to 0–100 %, clamped. Without it the same signal could reach only 69.7 % and could never select MURKY.
- **Policy thresholds on that scale.** First qualification: CLEAR below 35 % (0.81 V), TRANSITION 35–70 % (0.81–1.61 V), MURKY from 70 % (1.61 V). Afterwards, hysteresis: up at 40 % / 75 %, down at 30 % / 65 %. Filtering: 0.25 EMA every 20 ms, 60 ms qualification.
- **What it is not.** TDS is dissolved-solids / conductivity, not turbidity. The telemetry field is still called `turbidityIndex` for the shared protocol; the `adc` block carries `sensor: "TDS_PROXY"` and `fullScaleCounts` so the origin is explicit. No calibrated NTU is claimed.
- **Dry probe.** Measured on the board (probe in air): raw 27–38 counts, 21–30 mV, level about 1.1 %, `valid: true`, policy CLEAR. The firmware rejects only raw counts ≤ 12 (about 9.7 mV) as a rail fault, so this probe in air is **accepted** and the output can be enabled without wetting it. (An earlier version of this document predicted a dry probe would be rejected; the board showed otherwise.)
- **How to move the reading with no rewiring:** put the probe in tap water, then in a cup with progressively more table salt. Read `adc.millivolts` in the console first: the TDS board's volts-per-ppm are uncalibrated here, so find out which water lands in which band rather than assuming.

## 5. What changes for you physically

| Item | Change |
|---|---|
| Opening the payload | none |
| Disconnecting TDS, TFT SCK, HC-SR04 TRIG | **none** |
| Adding a potentiometer | **none** |
| Flashing | One image replaces `04_all_sensors`. To go back, upload `04_all_sensors` again; nothing else differs |
| External scope | Probe A2 (PA4) and GND on the board headers when you choose to. D2 is available for the sync probe |

## 6. What the combined image does differently from bare-metal (be honest about it)

| Aspect | Bare-metal adaptive | Combined image |
|---|---|---|
| Sensors, TFT, HC-SR04, INA219 | dark | working as before |
| Main loop | fast, interrupt-driven RX/TX | blocks for display, 30 ms HC-SR04 wait, I²C |
| Ping timing | 100 ms nominal, tight | 100 ms nominal; **gaps while the TFT redraws**. Measured from telemetry timing in a 10 s sample: steady 500 ms packet spacing with one 633 ms gap at the 8 s page change, so about **130 ms** of extra stall. Pulses themselves are untested; the pulse gap has not been seen on a scope |
| A0 stale window | 100 ms | 1500 ms (`ADAPT_STALE_MS`), so a redraw does not inhibit output |
| Command ACK latency | immediate | Measured, build 1, 62 keepalives: min 12 ms, median 32 ms, 90th percentile 228 ms, max 624 ms (waits for telemetry to drain). The bridge allows 2 s |
| Telemetry rate | 4 Hz | 2 Hz (about 3 KB packets) |
| B1 button | cycles modulation / toggles output | not used. Use the console |
| Burst timing | DMA, CPU-free | DMA, CPU-free. **Pulse shape is unaffected by loop blocking**; only the schedule between pulses is |

The waveform itself comes from the same DMA-streamed buffer either way, so loop blocking changes *when* a pulse starts, not what it looks like.

## 7. Verification status

- The shared C engine is the one the 100+ tests exercise; `tests/arduino-combined.test.js` asserts the sketch's copies are byte-identical to `firmware/src/` and its build options are present.
- The combined sketch **compiles** for the NUCLEO-F446RE (`npm run arduino:build`): 91,192 bytes flash, 53,680 bytes RAM (of 131,072).
- **Build 1 (flashed 2026-10-02)** ran on the board. Its hand-built JSON packet **parses with the console's own parser** (19 consecutive packets, seq 1–19, 2005 characters each). Sensors, TFT status, DS18B20, pressure, turbidity and TDS match the pre-flash baseline; `BMP390`, `IMU`, `MAGNETOMETER` and `INA219` read OFFLINE both before and after.
- **Build 1 defect found:** the core's `Serial` lost commands (42 % of 72-byte commands with plain framing, 27 % with a leading newline; short 50-byte commands were not lost in 190 tries). Build 2 (DMA RX) received nothing (wrong DMA mapping). Build 3 (core RX + DMA TX) still lost 23 % of 300 bridge commands, and the board's UART hardware read healthy while the Mac-to-board path was dead: the cause was the 64-byte core RX ring (`build_opt.h` ignored by a stale core cache), fixed in build 5. See `docs/evidence/combined-image-first-bringup.md`.
- Never run on the board so far: any pulse, the DMA/DAC burst path on PA4, the scope.
