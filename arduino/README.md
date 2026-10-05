# AquaSDR — complete wiring and bench firmware

This is the wire-by-wire reference for the **NUCLEO-F446RE**, its sensors, the **ST7735 TFT** that replaced the 1602 LCD, and the planned power/acoustic stages. The pin assignments match [04_all_sensors.ino](04_all_sensors/04_all_sensors.ino) and [SonarLoopback.h](04_all_sensors/SonarLoopback.h). Follow connector labels, not wire colours or board orientation in a photo.

**Build record:** temperature, TDS, TFT, USB telemetry and DAC electrical loopback were demonstrated in the previous bench session. Pressure/turbidity still need dividers and calibration; I²C modules and HC-SR04 need further verification. This documentation update is not a new hardware test. A power LED or I²C ACK does not establish a valid measurement.

## Contents

- [Firmware and pin conflicts](#firmware-and-pin-conflicts)
- [Complete Nucleo pin allocation](#complete-nucleo-pin-allocation)
- [Bench power and whole circuit](#bench-power-and-whole-circuit)
- [ST7735 TFT](#st7735-tft)
- [DS18B20 and adapter](#ds18b20-and-adapter)
- [TDS meter](#tds-meter)
- [Water pressure](#water-pressure)
- [Turbidity](#turbidity)
- [Shared I²C bus](#shared-i2c-bus)
- [INA219 ×2](#ina219-monitors)
- [BMP390](#bmp390)
- [ISM330DHCX and MMC5983MA](#ism330dhcx-and-mmc5983ma)
- [HC-SR04](#hc-sr04)
- [DAC loopback](#dac-loopback)
- [Battery and MP1584 — planned](#planned-battery-power)
- [TLV9062 and acoustic chain — planned](#planned-acoustic-chain)
- [Retired and excluded modules](#retired-and-excluded-modules)
- [Arduino setup and test sketches](#arduino-setup-and-test-sketches)
- [Checks before uploading](#checks-before-uploading)

## Firmware and pin conflicts

| Program | Implemented functions | Pin implications |
| --- | --- | --- |
| `arduino/04_all_sensors` | STM32duino sensor bridge, software-SPI TFT, HC-SR04 and continuous 40 kHz DAC loopback; uses Arduino libraries/HAL support | D7 = TRIG; D13 = TFT SCK |
| [`firmware/`](../firmware/README.md) | Separate bare-metal C transmit-engine milestone, no HAL; waveform bursts and serial telemetry | D7 = scope sync; D13 = LD2 indicator; sensor/TFT integration not implemented |

Only one program is flashed at a time. The combined Arduino sketch is not the bare-metal program with all sensors already merged.

- **D3/D6 now belong to the TFT.** Disconnect the old LCD and its 5 V pull-ups before connecting TFT RESET/DC. Never connect both displays to those pins.
- **D7 changes role.** Disconnect HC-SR04 TRIG before using the bare-metal scope-sync output.
- **D13/PA5** clocks the TFT in the Arduino build and drives LD2 in the bare-metal build. DAC1 output is **A2/PA4**.
- **A5** receives temporary DAC loopback now, conditioned RX later. Remove the A2–A5 jumper before attaching an RX amplifier.
- **D14/D15** are I²C SDA/SCL. A4/A5 are PC1/PC0 in this build; do not use the Arduino Uno A4/A5 I²C convention.
- The legacy `00_i2c_scan` drives D3/D6 as a second I²C bus. Disconnect TFT signal leads before running it, or use the bus-1-only sensor sketch.

## Complete Nucleo pin allocation

Mappings follow the NUCLEO-F446RE STM32duino variant. TIM6 and DMA are internal peripherals, with no external wires.

| Board label | MCU pin | Combined Arduino build connection |
| --- | --- | --- |
| A0 | PA0 | TDS board analog signal |
| A1 | PA1 | Pressure divider midpoint |
| A2 | PA4 / DAC1 | Temporary jumper to A5; later TX filter input |
| A3 | PB0 | Turbidity divider midpoint |
| A4 | PC1 | DS18B20 adapter signal |
| A5 | PC0 / ADC1 IN10 | A2 loopback; later protected RX output |
| D0 | PA3 | USART2 RX / ST-LINK serial; no added module |
| D1 | PA2 | USART2 TX / ST-LINK serial; no added module |
| D2 | PA10 | Unused |
| D3 | PB3 | TFT RESET |
| D4 | PB5 | Unused |
| D5 | PB4 | Unused; no sensor interrupt needed |
| D6 | PB10 | TFT A0 / DC |
| D7 | PA8 | HC-SR04 TRIG |
| D8 | PA9 | HC-SR04 ECHO through level reduction below |
| D9 | PC7 | Unused |
| D10 | PB6 | TFT CS |
| D11 | PA7 | TFT SDA / MOSI |
| D12 | PA6 | Unused; microSD disconnected |
| D13 | PA5 | TFT SCK; also on-board LD2 |
| D14 | PB9 | Shared 3.3 V I²C SDA |
| D15 | PB8 | Shared 3.3 V I²C SCL |
| 5V | Power header | Bench distribution source when USB-powered |
| 3V3 | Power header | Logic distribution |
| GND | Any GND header | Common return |
| E5V | CN7 pin 6 | Future regulated external 5 V input |
| VIN | Power header | Unused; do not attach the raw pack in this plan |
| IOREF / AREF / NRST | Header pins | No added module wires |

## Bench power and whole circuit

Use USB at **CN1 / ST-LINK** for programming, serial and bench power. Keep battery and buck output disconnected during USB-only tests.

No breadboard is required: use insulated multiway terminals or a soldered, insulated distribution harness. Give every module a separate power/ground branch. Do not jam multiple loose wires into one female connector. Keep 5 V, 3.3 V and ground as separate nets; power off before rewiring.

| Net | Branch destinations |
| --- | --- |
| `+5V_BENCH` | TDS VCC, pressure VCC, turbidity `+`, HC-SR04 VCC, compatible TFT VCC (see its note) |
| `+3V3_LOGIC` | DS18B20 adapter `+`, both INA219 VCC pins, BMP390 supply, IMU/magnetometer supply, I²C pull-ups, compatible TFT LED supply |
| `GND_COMMON` | Nucleo GND, every module GND/`−`, every divider's lower end |

ST specifies 300 mA total in the normal USB enumeration configuration, including the board. Check total load before energizing all modules together. If the budget is exceeded, use a correctly configured external supply. The 3V3 output does not provide an independent extra USB power budget. See [ST UM1724 §7.5](https://www.st.com/resource/en/user_manual/dm00105823.pdf).

In the drawing, `NC` means disconnected. Each divider uses its own two resistors. These are the required corrected connections, not a claim the resistors are already installed.

```text
HOST USB ========================================= NUCLEO CN1 / ST-LINK
  serial 115200 -> local bridge -> dashboard           |
                                                     5V -> +5V_BENCH
                                                   3V3 -> +3V3_LOGIC
                                                   GND -> GND_COMMON

TDS board S --------------------------------------------- A0 / PA0
Pressure S -- 10k --+------------------------------------- A1 / PA1
                   +-- 20k -- GND
Turbidity A/S -- 10k --+---------------------------------- A3 / PB0
                      +-- 20k -- GND
DS18B20 adapter S ---------------------------------------- A4 / PC1
                  +-- adapter pull-up -- 3V3

A2 / PA4 / DAC1 ============ temporary jumper ============ A5 / PC0

D14 / PB9 SDA --+-- INA #1 SDA
               +-- INA #2 SDA
               +-- BMP390 SDA
               +-- IMU/magnetometer SDA
D15 / PB8 SCL --+-- INA #1 SCL
               +-- INA #2 SCL
               +-- BMP390 SCL
               +-- IMU/magnetometer SCL
  SDA and SCL pull-ups connect to 3V3, never 5V on this bus.

D10 / PB6 ----------------------------------------------- TFT CS
D3  / PB3 ----------------------------------------------- TFT RESET
D6  / PB10 ---------------------------------------------- TFT A0 / DC
D11 / PA7 ----------------------------------------------- TFT SDA / MOSI
D13 / PA5 ----------------------------------------------- TFT SCK
  TFT microSD: NC

D7 / PA8 ------------------------------------------------ HC-SR04 TRIG
HC-SR04 ECHO -- 10k --+----------------------------------- D8 / PA9
                     +-- 15k -- GND

Every module also needs supply and GND branches listed below.
Battery, buck output, driver and loose TX/RX piezos: disconnected for this test.
```

## ST7735 TFT

Active display: red **1.8-inch 128 × 160 SPI breakout**. Printed `SDA` means SPI MOSI here, not I²C. Printed `A0` means DC, not Nucleo analog A0.

| TFT pin | Destination | Note |
| --- | --- | --- |
| VCC | Recorded bench plan: 5 V | Only for a regulator-equipped, 5 V-compatible breakout; verify exact board rating |
| GND | Common GND | Supply return |
| CS | D10 / PB6 | Chip select |
| RESET / RST | D3 / PB3 | Reset |
| A0 / DC | D6 / PB10 | Data/command |
| SDA / MOSI | D11 / PA7 | SPI data |
| SCK / SCL | D13 / PA5 | SPI clock |
| LED / BL | Recorded bench plan: 3.3 V | Confirm on-board current limiting; a bare backlight LED requires a suitable resistor/driver |
| SD_CS, SD_MOSI, SD_MISO, SD_SCK | NC | microSD unused |

All GPIO signals are 3.3 V. The exact breakout manufacturer/schematic is not recorded, so the VCC/LED entries are board-specific, not universal ST7735 instructions. A bare controller/panel must not be assumed 5 V-tolerant. The sketch uses software SPI, `INITR_BLACKTAB` and landscape rotation. It sets TFT health after initialization without a display acknowledgement; visually confirm the screen.

## DS18B20 and adapter

| From | To |
| --- | --- |
| Probe VDD conductor | Adapter VDD / `+` probe terminal |
| Probe DQ conductor | Adapter DATA / DQ probe terminal |
| Probe GND conductor | Adapter GND / `−` probe terminal |
| Adapter host VCC / `+` | 3.3 V |
| Adapter host GND / `−` | Common GND |
| Adapter host S / DATA | A4 / PC1 |
| PULL jumper | Installed when it enables the adapter's on-board pull-up |

```text
3V3 -------- adapter VCC ---------------- probe VDD
  +-- pull-up resistor --+
A4 ---------------------+--------------- probe DQ
GND -------- adapter GND ---------------- probe GND
```

Identify probe conductors from its documentation; colours are not guaranteed. This is three-wire powered mode. If the adapter has no pull-up, fit one (typically 4.7 kΩ from DQ to 3.3 V); a jumper cannot substitute for a missing resistor. See [Analog Devices DS18B20](https://www.analog.com/media/en/technical-documentation/data-sheets/ds18b20.pdf).

## TDS meter

| Connection | Destination |
| --- | --- |
| Probe plug | TDS board's matching two-pin probe socket |
| VCC / `+` | 5 V |
| GND / `−` | Common GND |
| S / A / analog output | A0 / PA0 directly |

Direct input assumes the Gravity SEN0244-style board's 0–2.3 V output; verify the actual module before copying it. No probe electrode connects directly to a GPIO. The result is a freshwater TDS/conductivity proxy, not seawater salinity. See [DFRobot SEN0244 specifications](https://wiki.dfrobot.com/sen0244).

## Water pressure

The code assumes **0.5–4.5 V = 0–1.6 MPa gauge pressure**. Confirm the actual sensor's range; different models need different conversion constants.

| Sensor / resistor connection | Destination |
| --- | --- |
| VCC / `+` | 5 V |
| GND / `−` | Common GND |
| Signal / S | First end of 10 kΩ |
| Second end of 10 kΩ | A1 / PA1 and top of 20 kΩ |
| Bottom of 20 kΩ | Common GND |

```text
Pressure S --[10 kΩ]--+-- A1 / PA1
                     |
                  [20 kΩ]
                     |
                    GND
```

The divider multiplies voltage by 2/3: 0.5 V becomes about 0.333 V; 4.5 V becomes 3.0 V. **Without the divider, leave the signal disconnected.** Software cannot protect an overvolted ADC. See [DFRobot SEN0257](https://wiki.dfrobot.com/sen0257/) for the assumed model's specifications.

After fitting the divider, set `PRESSURE_DIVIDER_INSTALLED = true` in `04_all_sensors.ino` and rebuild/upload. It is currently `false`. `SensorMath.h` uses `DIVIDER_GAIN = 1.5` to reconstruct sensor voltage. The historical `PUBLISH_UNSAFE_DIRECT_ANALOG = true` setting is not approval to omit protection. Zero the sensor at atmosphere; send `z` from Serial Monitor while the bridge is disconnected. Depth still requires calibration.

## Turbidity

| Connection | Destination |
| --- | --- |
| Optical probe plug | Matching interface-board socket |
| Board VCC / `+` | 5 V |
| Board GND / `−` | Common GND |
| Selector switch | **A**, analog mode |
| A / analog output (or shared S in A mode) | First end of a separate 10 kΩ |
| Second end of that 10 kΩ | A3 / PB0 and top of a separate 20 kΩ |
| Bottom of 20 kΩ | Common GND |
| Separate digital D output, if provided | NC |

```text
Turbidity A/S --[10 kΩ]--+-- A3 / PB0
                        |
                     [20 kΩ]
                        |
                       GND
```

Do not share the pressure divider. This ratio assumes a maximum 4.5 V output. Verify the actual module: 5.0 V through this divider becomes 3.33 V, so a different 0–5 V module needs another ratio and matching firmware gain.

After fitting the divider, set `TURBIDITY_DIVIDER_INSTALLED = true` and rebuild/upload; it is currently `false`. Leave the signal disconnected until protected. The existing conversion reports `null` / `OUT OF RANGE` below 2.5 V or above 4.5 V reconstructed sensor voltage. Air is not a water calibration reference. Keep the interface PCB and non-waterproof upper part of the probe dry. See [DFRobot SEN0189](https://wiki.dfrobot.com/sen0189).

<a id="shared-i2c-bus"></a>

## Shared I²C bus

```text
3V3 ------+-------------+------------+-----------+-----------+
          |             |            |           |           |
       pull-up       INA #1       INA #2       BMP390      IMU board
          |            VCC          VCC         supply      supply
D14 ------+----------- SDA --------- SDA -------- SDA ------- SDA

3V3 -- pull-up --+
D15 ------------+----- SCL --------- SCL -------- SCL ------- SCL

GND ------------------ GND --------- GND -------- GND ------- GND
```

Both devices on the combined IMU/magnetometer board share its four-wire cable. If supplied on separate breakouts, each needs VCC, GND, SDA and SCL branches.

Check existing pull-ups. If absent, add one from SDA to **3.3 V** and one from SCL to **3.3 V**; 4.7 kΩ is a starting value for a short bus. Multiple breakout pull-ups combine in parallel, so do not automatically add a pair at every board. STM32 internal pull-ups used in a diagnostic do not establish a reliable final bus.

<a id="ina219-monitors"></a>

## INA219 ×2

VCC/GND/SDA/SCL power and communicate with the chip. **VIN+/VIN− carry load current; VIN− is not GND.**

| Pin | INA219 #1 — battery | INA219 #2 — TX rail |
| --- | --- | --- |
| VCC | 3.3 V | 3.3 V |
| GND | Common GND | Common GND |
| SDA | D14 / PB9 | D14 / PB9 |
| SCL | D15 / PB8 | D15 / PB8 |
| Address | 0x40, default straps | 0x41, A0 high/A1 low; use the board's documented A0 bridge |
| VIN+ later | Switched/fused battery + | Selected TX supply + |
| VIN− later | MP1584 IN+ | Driver supply + |
| VIN+ and VIN− now, USB-only logic test | Both NC | Both NC |

```text
Battery + -> FUSE -> SWITCH -> INA #1 VIN+ -> shunt -> VIN- -> MP1584 IN+
Battery - -------------------------------------------------> MP1584 IN-
       +---------------------------------------------------> common GND

Selected TX supply + -> INA #2 VIN+ -> shunt -> VIN- -> driver supply +
Selected TX supply - ------------------------------- driver GND -- common GND
```

Do not connect VIN+ and VIN− across the battery: that places the low-resistance shunt across the source. Piezo output leads do not pass through the INA219. Check shunt, connector and current ratings before carrying load. See [TI INA219](https://www.ti.com/lit/ds/symlink/ina219.pdf).

The current firmware's `health.INA219` represents **#1 only**. It does not prove #2 works. `okTx`/`txMa` exist internally, but an independent TX-monitor health/readout is not currently published to the console.

## BMP390

| Pin | Destination / state |
| --- | --- |
| Supply input VCC / VIN / 3V3 | 3.3 V using the input appropriate to the actual breakout |
| GND | Common GND |
| SDA / SDI | D14 / PB9 |
| SCL / SCK | D15 / PB8 |
| CS / CSB, if exposed without an existing strap | High to 3.3 V for I²C |
| SDO / ADDR | High for 0x77 or low for 0x76, respecting existing straps |
| INT | NC; firmware polls |

The sketch tries 0x77 then 0x76. An INT connection on D5 is not needed or configured; do not connect INT to 5 V. Check the actual breakout schematic before changing mode/address straps. Cabin pressure is separate from the water sensor on A1. See [Bosch BMP390 documentation](https://www.bosch-sensortec.com/products/environmental-sensors/pressure-sensors/bmp390/).

## ISM330DHCX and MMC5983MA

| Board pin | Destination / state |
| --- | --- |
| VCC / 3V3 | 3.3 V |
| GND | Common GND |
| SDA | D14 / PB9 |
| SCL | D15 / PB8 |
| ISM330DHCX CS, if exposed without an I²C strap | High to 3.3 V |
| ISM330DHCX SDO / SA0, if exposed | High selects 0x6B; low selects 0x6A |
| MMC5983MA interface straps | Breakout's documented I²C mode, address 0x30 |
| INT1 / INT2 / DRDY and unused separate SPI pins | NC; program polls I²C |

The combined breakout revision is not recorded; its schematic determines existing straps and connector order. Do not guess a JST/Qwiic cable order from colours. The sketch tries ISM330DHCX at 0x6B then 0x6A; MMC5983MA is a separate device at 0x30. These provide attitude logging, not echo samples. References: [ST ISM330DHCX](https://www.st.com/resource/en/datasheet/ism330dhcx.pdf), [MEMSIC MMC5983MA](https://www.memsic.com/magnetometer-5).

## HC-SR04

This is the complete four-pin air-ranging board, separate from the loose TX/RX elements in the acoustic plan.

| HC-SR04 pin | Destination |
| --- | --- |
| VCC | 5 V |
| GND | Common GND |
| TRIG | D7 / PA8 |
| ECHO | 10 kΩ → D8 junction; junction → 15 kΩ → GND |

```text
HC-SR04 ECHO --[10 kΩ]--+-- D8 / PA9
                       |
                    [15 kΩ]
                       |
                      GND
```

This conservative level reduction makes a 5 V ECHO about 3.0 V. Its lower resistor is **15 kΩ**, not the water-sensor divider's 20 kΩ. No analog-gain setting is needed: the firmware measures pulse duration. Keep the board dry. It measures air distance and cannot supply sampled underwater echo bins for the echogram.

## DAC loopback

```text
Inside STM32: TIM6 -> DMA1 Stream 5 -> DAC1
                                       |
Nucleo A2 / PA4 ------------------------+---- one jumper ---- A5 / PC0
```

Both pins are on the same board, so no additional ground wire is needed between them. Leave external RX outputs and TX drivers disconnected. The Arduino loopback uses 25 samples per 40 kHz cycle at 1 MS/s and 62% amplitude. A prior bench reading was about 2.05 Vpp around mid-supply; this is an electrical check, not an acoustic measurement or calibrated ADC waveform capture.

Remove the jumper before attaching an RX amplifier. Never apply 5 V or battery voltage to A2/A5. A scope signal probe goes to A2 and its ground clip to common GND. The separate bare-metal firmware also offers scope sync on D7/PA8.

<a id="planned-battery-power"></a>

## Battery and MP1584 — planned

Pack: **3S2P Li-ion, 11.1 V nominal, 12.6 V full**. Confirm its actual protection/BMS, charger and cable ratings. The previously discussed 3 A fuse is a proposed value, not a verified protection design.

```text
PACK + -> fuse near pack -> switch -> INA #1 VIN+ -> VIN- -> MP1584 IN+
PACK - --------------------------------------------------> MP1584 IN-
   +-----------------------------------------------------> common GND

MP1584 OUT+ (adjust to 5.00 V with load disconnected)
   +---- external 5 V distribution -> compatible 5 V modules
   +---- Nucleo E5V / CN7 pin 6
MP1584 OUT- ------------------------ Nucleo GND and common GND
Nucleo 3V3 ------------------------- 3.3 V logic distribution

Future TX supply (voltage TBD) -> INA #2 -> future piezo driver
```

| Wire | From | To |
| --- | --- | --- |
| P1 | Pack + | Fuse input |
| P2 | Fuse output | Switch input |
| P3 | Switch output | INA #1 VIN+ |
| P4 | INA #1 VIN− | MP1584 IN+ |
| P5 | Pack − | MP1584 IN− / ground terminal |
| P6 | MP1584 OUT− | Ground distribution / Nucleo GND |
| P7 | MP1584 OUT+ | External 5 V distribution |
| P8 | External 5 V distribution | Nucleo E5V / CN7 pin 6 |
| P9 | Nucleo 3V3 | Logic distribution |

For the **MB1136 Nucleo-64**: power off, set JP5 to 2–3 and remove JP1 for E5V power; apply verified 5 V externally, confirm board power, then connect CN1 USB for serial/programming. USB-only mode uses JP5 U5V, pins 1–2. Verify the board revision. Do not parallel USB-derived 5 V and buck output. The E5V board input is rated 500 mA; feed other module branches from a suitably rated distribution point. See [ST UM1724 §7.5](https://www.st.com/resource/en/user_manual/dm00105823.pdf).

MP1584 IN−/OUT− share common ground in this non-isolated design. Do not use the raw pack as a 5 V rail or assume the Nucleo VIN input is appropriate for a fully charged 3S pack. TX supply voltage remains unassigned until the driver is selected.

<a id="planned-acoustic-chain"></a>

## TLV9062 and acoustic chain — planned

There are **four dual op-amp ICs (eight amplifier channels)** and SOIC adapters. Filter/gain values, protection components and the power driver are not yet designed or validated. A completed resistor-level TX/RX wiring diagram therefore does not exist yet; the following records intended endpoints and verified IC pin identities.

```text
A2 / PA4 DAC1
  -> TLV9062 TX reconstruction filter + buffer [values TBD]
  -> 40 kHz power driver [topology, supply, enable and parts TBD]
  -> TX piezo lead 1 / lead 2 [depends on output topology]
  -> acoustic path in air for bench experiments
  -> RX piezo lead 1 / lead 2
  -> input protection + coupling + mid-rail bias [TBD]
  -> TLV9062 band-pass / gain [TBD]
  -> bounded 0–3.3 V output -> A5 / PC0 ADC

Chosen analog supply -> each TLV9062 pin 8
Common GND ----------> each TLV9062 pin 4
Local decoupling required at each IC; values/layout enter final schematic.
```

**TLV9062 SOIC-8, top view**, notch/dot identifies pin 1:

```text
            +---U---+
OUT A     1 |       | 8  V+
IN A (-)  2 |       | 7  OUT B
IN A (+)  3 |       | 6  IN B (-)
V- / GND  4 |       | 5  IN B (+)
            +-------+
```

| Item | Defined information | Still pending |
| --- | --- | --- |
| TLV9062 U1 | Eight-pin map above | Channel assignment and feedback/filter network |
| TLV9062 U2 | Eight-pin map above | Channel assignment and feedback/filter network |
| TLV9062 U3 | Eight-pin map above | Channel assignment and feedback/filter network |
| TLV9062 U4 | Eight-pin map above | Channel assignment and feedback/filter network |
| SOIC adapters ×4 | Each labelled pad routes to its corresponding IC pin; verify continuity | Orientation/solder verification |
| Piezo driver | TX-buffer input; supply via INA #2; common supply ground | Parts, ratings, output topology and complete circuit |
| TX piezo | Two leads to the selected output network | Identify TX element; neither output is automatically GND |
| RX piezo | Two leads to receiver input/protection network | Input grounding, bias, gain and protection |

TLV9062 supports 1.8–5.5 V supply; never connect it to the 3S pack. Its output is not automatically a suitable piezo power driver. A 5 V-powered receive stage needs level/protection design before driving the 3.3 V ADC. Keep these stages unpowered until the circuit is defined, including unused-channel handling. See [TI TLV9062 pin configuration and ratings](https://www.ti.com/lit/ds/symlink/tlv9062.pdf).

HC-SR04 elements are dry-bench parts. Their position on the concept hull does not make them underwater-rated transducers. Waterproof transducers, penetrators and pressure-qualified mounting remain separate work.

## Retired and excluded modules

| Item | Current connection |
| --- | --- |
| 1602 LCD + PCF8574 | **Disconnected.** Historical standalone wiring: VCC→5 V, GND→GND, SDA→D3/PB3, SCL→D6/PB10. Never retain it with the TFT. |
| AD9850 DDS | **All pins NC.** STM32 DAC is active; a separate experiment needs its own verified interface plan. |
| 5-inch HDMI screen | **No Nucleo connection.** Needs a suitable HDMI host and its specified supply. |
| BTS7960 ×2 | **All pins NC.** Not selected as the piezo driver. |
| 9 V battery | **Disconnected.** Not used in this power plan. |
| Old PAM8403 / level-shifter placeholders | Removed from the active design; no assigned wires. |
| Housing, frame, caps, mounts | Mechanical parts; no assigned signal connections. |

Archived LCD sketches are historical diagnostics. Do not copy their old 5 V bus instructions onto TFT wiring.

## Arduino setup and test sketches

1. Install **STM32 MCU based boards**, using `https://github.com/stm32duino/BoardManagerFiles/raw/main/package_stmicroelectronics_index.json`.
2. Install `OneWire`, `DallasTemperature`, `Adafruit INA219`, `Adafruit BMP3XX Library`, `SparkFun 6DoF ISM330DHCX`, `SparkFun MMC5983MA Magnetometer Arduino Library`, **Adafruit GFX Library**, and **Adafruit ST7735 and ST7789 Library**, with dependencies.
3. Select **Nucleo-64 → Nucleo F446RE**, generic `Serial` U(S)ART support, **Mass Storage** upload. Connect CN1 USB; Serial Monitor uses **115200 baud**.
4. Use one serial reader: close Serial Monitor before connecting the web bridge. Run `npm run dev` from the repository root, open Hardware, select the port and connect.

| Sketch | Purpose / restrictions |
| --- | --- |
| `00_i2c_scan` | Legacy two-bus scanner; disconnect TFT signals because it drives D3/D6 |
| `00b_soft_i2c_bmp390` | D14/D15 diagnostic; internal pull-ups are diagnostic only |
| `01_analog_and_temp` | Raw analog/temperature tests; protected ADC wiring required |
| `01b_tds_test` | TDS on A0 |
| `01c_ds18b20_diag` | Temperature ROM/electrical check on A4 |
| `02_i2c_sensors` | Both INAs, BMP390, IMU and magnetometer on shared bus |
| `03_lcd_test`, `03b_lcd_automap` | Retired LCD tests; disconnect TFT |
| `05_tft_test` | ST7735 colour/display test |
| `04_all_sensors` | Current sensor/TFT/air-distance/loopback build; JSON roughly once a second |

If upload fails, export the compiled binary and copy the correct `.bin` to `NOD_F446RE`. Test sketches differ in scaling/reporting; their human-readable serial text is not necessarily dashboard telemetry.

## Checks before uploading

1. With power off, verify labelled supply/GND branches, shorts and secure terminals.
2. Fit dividers before connecting pressure/turbidity to A1/A3. Match firmware divider flags to resistors. A displayed value does not establish safe voltage.
3. Confirm TFT owns D3/D6; remove old LCD pull-ups. Leave unused SD and sensor INT pins disconnected.
4. Verify I²C modules individually: 0x40, 0x41, 0x77/0x76, 0x6B/0x6A and 0x30. An ACK only establishes an addressed device responded.
5. For loopback, only A2 feeds A5. Remove that jumper before final RX wiring.
6. Check total current against the selected supply. Keep the battery disconnected until external-power configuration and protection are complete.
7. Check measurements and individual health fields. Power LEDs, backlight and model visibility are not functional tests.

The 3D model is generated by [scripts/build-payload-model.mjs](../scripts/build-payload-model.mjs); the compiled GLB is not its only source. Dimensions and placement are illustrative, not a manufacturing drawing or wiring reference.
