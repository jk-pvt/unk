# Adaptive firmware build and installation handoff

2026-10-01: built and verified locally. **Not flashed**, at the user's request; bench rewiring is not ready. The separate Arduino sensor/TFT image remains installed. This document is an installation procedure for later, not evidence of physical acceptance.

## Exact build commands on this Mac

```sh
cd /Users/sudharsan/Downloads/AquaSDR
make -C firmware -B PREFIX=/Users/sudharsan/Library/Arduino15/packages/STMicroelectronics/tools/xpack-arm-none-eabi-gcc/14.2.1-1.1/bin/arm-none-eabi-
make -C firmware adaptive -B PREFIX=/Users/sudharsan/Library/Arduino15/packages/STMicroelectronics/tools/xpack-arm-none-eabi-gcc/14.2.1-1.1/bin/arm-none-eabi-
npm test
npm run build
```

`cc` is also required for host policy tests and the persistent native C policy/reference helper. The ARM compiler above does not replace the host compiler. These commands do not access the programmer.

Adaptive outputs:

- `/Users/sudharsan/Downloads/AquaSDR/firmware/build-adaptive/aquasdr.bin`
- `/Users/sudharsan/Downloads/AquaSDR/firmware/build-adaptive/aquasdr.elf`
- `/Users/sudharsan/Downloads/AquaSDR/firmware/build-adaptive/aquasdr.map`

Binary size: 33,160 bytes. ELF sections: text 33,064 bytes, initialized data 84 bytes, BSS 93,752 bytes. The build fits the STM32F446RE linker memory regions. GCC/newlib emits existing nosys stub warnings for unused filesystem syscalls; no compilation errors. Vite reports the existing large Three.js chunk warning.

SHA-256 of this adaptive `.bin`:

```text
9061976fad7422796c35212df0a2326c24c075645fcbbeb568d538edc673e71d
```

Ordinary bring-up outputs are under `firmware/build/`; they are a different program. Use the adaptive paths for this milestone.

## Installation procedure — on hold

Complete the [bench wiring steps](../firmware/ADAPTIVE_BENCH.md#wiring-before-physical-commissioning) first: driver/transducers disconnected, TFT D13 and HC-SR04 D7 signals removed, TDS removed from A0; pot wiper on PA0/A0, scope on PA4/A2 and ground, optional sync PA8/D7. Close the console serial connection before programming.

If NUCLEO mass storage is mounted at `/Volumes/NOD_F446RE`:

```sh
cd /Users/sudharsan/Downloads/AquaSDR
make -C firmware flash-adaptive PREFIX=/Users/sudharsan/Library/Arduino15/packages/STMicroelectronics/tools/xpack-arm-none-eabi-gcc/14.2.1-1.1/bin/arm-none-eabi-
```

That volume is not presently mounted. The installed ST-LINK/OpenOCD alternative programs and verifies the **adaptive ELF** at the addresses in the linker script:

```sh
/Users/sudharsan/Library/Arduino15/packages/STMicroelectronics/tools/xpack-openocd/0.12.0-6/bin/openocd \
  -s /Users/sudharsan/Library/Arduino15/packages/STMicroelectronics/tools/xpack-openocd/0.12.0-6/openocd/scripts \
  -f interface/stlink.cfg \
  -f target/stm32f4x.cfg \
  -c "program /Users/sudharsan/Downloads/AquaSDR/firmware/build-adaptive/aquasdr.elf verify reset exit"
```

Neither installation command was executed. For a programmer using the raw `.bin`, set flash base to `0x08000000`.

## Expected serial handshake and UI

USART2/ST-LINK VCP: **115200 baud, 8N1**, newline-delimited JSON, commands limited to 512 bytes. On boot telemetry includes:

```json
{"firmware":"aquasdr-fw 0.3.2 adaptive environment control","firmwareMode":"ADAPTIVE_TRANSMITTER","capabilities":{"controlVersion":1}}
```

This is an excerpt of `payload`, not a complete serial packet. Full telemetry has the existing `version:1`, `type:telemetry`, `source:hardware`, sequence, timestamp and payload. The bridge sends `PING` using its own fresh random session; manual examples below use session 77. Do not share the port with the running bridge.

```json
{"version":1,"session":77,"id":1,"op":"PING"}
{"version":1,"session":77,"id":2,"op":"SET_INPUT_SOURCE","source":"WEB"}
{"version":1,"session":77,"id":3,"op":"SET_ENV","profile":"MUDDY_ESTUARY"}
```

Each valid request receives an acceptance ACK, for example:

```json
{"version":1,"type":"ack","session":77,"id":3,"status":"ACCEPTED","reason":""}
```

Wait until telemetry reports `control.qualified:true`, then explicitly start:

```json
{"version":1,"session":77,"id":4,"op":"START_OUTPUT"}
```

After a prepared decision reaches a pulse, telemetry contains this separate application acknowledgment:

```json
{"applicationAck":{"session":77,"id":3,"decisionId":2,"status":"APPLIED","profile":"MUDDY_ESTUARY","policy":"MURKY"}}
```

Decision IDs are examples; use the IDs actually reported. Applied `waveform` reports LFM/HANN, frequency 38 kHz, bandwidth 1 kHz, pulse 8 ms and amplitude 62%. Keepalive commands must continue every 500 ms for WEB; output expires after 2 seconds without one. For manual serial testing, use increasing IDs for each keepalive. The bridge handles this only for the controlling browser.

```json
{"version":1,"session":77,"id":5,"op":"GET_STATUS"}
{"version":1,"session":77,"id":6,"op":"STOP_OUTPUT"}
{"version":1,"session":77,"id":7,"op":"SET_INPUT_SOURCE","source":"A0"}
```

`GET_WAVEFORM` is also accepted and returns the applied configuration in fresh telemetry; the server generates its C reference separately. It does not stream captured DAC samples. `GET_STATUS` ACK is followed by fresh telemetry after UART availability. It neither starts output nor renews the web lease. `SET_ENV_VALUES` requires all three values in integer tenths, for example `turbidity:850,depth:180,temperature:248`; it uses the same C policy as presets and A0. `SET_INPUT_SOURCE A0` stops output and resets qualification; wait for valid dial input before another explicit Start.

On reconnect the console enables Web and A0 controls after the capability/session handshake. Boot still shows **output disabled** until valid qualified input and Start. Apply updates accepted/requested state first; numeric applied values and the calculated C TX reference appear after pulse application. Waveform/FFT/spectrogram are calculated references, not scope captures. Arduino or unknown telemetry without advertised command capability remains read-only for physical commands. With a fresh legacy payload, an explicit COMPUTED companion provides controls in a separate digital namespace; it does not command the board.

## Verification boundaries

Host checks cover named and canonical commands, all presets/bounds, web/A0 equivalence, temperature independence of policy, parser/UART recovery, pulse scheduling, ACK versus application, session changes, stale input/lease/fault behavior, legacy telemetry, modeled-data isolation, recording and playback rejection. Both ARM images and the dashboard are built separately.

Final result: **74 tests passed**, zero failed or skipped; dashboard build and both ARM builds passed. Browser checks on an isolated local bridge verified Clear → Muddy (42/4/2/35 → 38/1/8/62), acceptance versus pulse application, geometric/Blackman and Barker-13 selection, TX/FFT/spectrogram controls, digital validation and page navigation without page errors. Live legacy telemetry and its separately namespaced companion were inspected on the connected console; a second browser correctly received an ownership conflict instead of taking control. See [connected demo and change report](CONNECTED_DEMO.md).

Physical PA4 output, ADC wiring, real interrupt timing, scopes, power, analog filtering/amplification and underwater performance remain **pending**. Complete and record the [physical acceptance checklist](../firmware/ADAPTIVE_BENCH.md#physical-acceptance--all-pending) after installation.


The subsequent [screenshot review fixes](SCREENSHOT_REVIEW_FIXES.md) improve narrow-chirp spectrograms and separate computed TX, modeled RX, the pulse scheduler and physical DAC telemetry. The tested firmware settings remain unchanged.


## Addendum 2026-10-02: milestone build 0.3.3 (still not flashed)

The adaptive image was rebuilt as **0.3.3** with a self-describing `identity` block (`AQUASDR_ADAPTIVE`, version, build id, capabilities) and, while the A0 dial is the source, an `adc` block (`raw`, `millivolts`, `filteredLevel`, `valid`, `candidate`). Waveform, policy and DMA/DAC code are unchanged. This build: 33,728 bytes, SHA-256 `7761438f848a0e2d70334ff5ac3129182f9bef59ac12da4f4bb767bbbe20f9cb`, build id `8760478-dirty` (built from uncommitted source; commit and rebuild, then record the new hash). The hash and size in the sections above describe 0.3.2.

Nothing was flashed and no wiring changed. Hardware procedure, analog front end, scope-capture import and power measurement: [HARDWARE_COMMISSIONING.md](HARDWARE_COMMISSIONING.md). Status per requirement: [PS26058_REQUIREMENT_MATRIX.md](PS26058_REQUIREMENT_MATRIX.md).
