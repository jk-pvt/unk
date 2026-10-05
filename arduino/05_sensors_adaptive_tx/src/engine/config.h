#ifndef AQUASDR_CONFIG_H
#define AQUASDR_CONFIG_H

#define FW_VERSION "aquasdr-fw 0.3.3"
#define FW_SEMVER "0.3.3"
// Which program the shared engine is running inside, and what physical thing feeds A0.
#ifndef FW_PLATFORM
#define FW_PLATFORM "BARE_METAL"
#endif
#ifndef ADC_SENSOR_LABEL
#define ADC_SENSOR_LABEL "DIAL"
#endif
// Short source revision; the Makefile passes the git hash so the same source
// always produces the same image.
#ifndef FW_BUILD
#define FW_BUILD "dev"
#endif

// Opt-in bench build: PA0/A0 is a dedicated 0–3.3 V environment dial.
// Do not enable on existing sensor wiring without following ADAPTIVE_BENCH.md.
#ifndef AQUASDR_ADAPTIVE_INPUT
#define AQUASDR_ADAPTIVE_INPUT 0
#endif

// Clocks: HSI 16 MHz → PLL → 168 MHz (no over-drive needed).
// APB1 = 42 MHz, so APB1 timers (TIM6) run at 84 MHz.
#define SYSCLK_HZ 168000000u
#define PCLK1_HZ 42000000u
#define TIM6_CLK_HZ 84000000u

// DAC sample clock. 84 MHz / 84 = exactly 1 MS/s, which is also the rate
// the dashboard model assumes (SAMPLE_RATE in shared/signal.js).
#define SAMPLE_RATE_HZ 1000000u
#ifndef MAX_PULSE_MS
#define MAX_PULSE_MS 20u
#endif
#define WF_MAX_SAMPLES (SAMPLE_RATE_HZ / 1000u * MAX_PULSE_MS)

// 10 pings per second, the duty cycle the demo power model assumes.
#define PING_INTERVAL_MS 100u
#define TELEMETRY_INTERVAL_MS 250u
#define UART_BAUD 115200u

// Pins (NUCLEO-F446RE Arduino header names in brackets)
//   PA4 [A2]  DAC1 output → scope CH1 / TLV9062 input
//   PA8 [D7]  pulse sync, high while a pulse streams → scope CH2 trigger
//   PA5 [D13] on-board LED LD2, toggles every ping
//   PC13      on-board blue button B1, steps through the bring-up sequence
//   PA2/PA3   USART2 → ST-LINK virtual COM port (USB), JSON telemetry
#define START_STEP 0u

#endif
