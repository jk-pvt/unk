// AquaSDR transmit engine: ordinary bring-up or environment-control build.
//
// TIM6 ticks at the sample rate and triggers DAC1; DMA1 Stream 5 feeds the
// DAC one sample per trigger from a pulse table in SRAM, so the CPU does no
// per-sample work while a pulse streams. Pulses are synthesised ahead of
// time into the spare half of a double buffer and swapped in between pings.
//
// The blue button steps through a fixed bring-up sequence (CW → LFM →
// window → pulse length → amplitude → other modes) so each stage can be
// checked on the oscilloscope. The opt-in adaptive build reads a dedicated
// PA0 environment dial or USART2 web commands through the shared C controller.
#include <stddef.h>
#include <stdint.h>

#include "config.h"
#include "regs.h"
#include "telemetry.h"
#include "waveform.h"
#include "adaptation.h"
#include "serial_rx.h"

_Static_assert(TIM6_CLK_HZ % SAMPLE_RATE_HZ == 0, "sample rate must divide the TIM6 clock");
_Static_assert(offsetof(ADC_t, SQR3) == 0x34, "ADC sequence register offset");
_Static_assert(offsetof(ADC_t, DR) == 0x4c, "ADC data register offset");

typedef struct {
  const char *label;
  wf_config cfg;
} step_t;

static const step_t STEPS[] = {
    {"CW 40 kHz continuous", {WF_CW, 40.0f, 2.0f, 2.0f, 62.0f, WF_WIN_RECT}},
    {"LFM 39-41 kHz, no window", {WF_LFM, 40.0f, 2.0f, 2.0f, 62.0f, WF_WIN_RECT}},
    {"LFM + Hann window", {WF_LFM, 40.0f, 2.0f, 2.0f, 62.0f, WF_WIN_HANN}},
    {"LFM + Hann, 8 ms pulse", {WF_LFM, 40.0f, 2.0f, 8.0f, 62.0f, WF_WIN_HANN}},
    {"LFM + Hann, 8 ms, 30% amplitude", {WF_LFM, 40.0f, 2.0f, 8.0f, 30.0f, WF_WIN_HANN}},
    {"Geometric sweep + Hann", {WF_GEOMETRIC, 40.0f, 2.0f, 2.0f, 62.0f, WF_WIN_HANN}},
    {"Barker-13 phase-coded + Hann", {WF_PHASE_CODED, 40.0f, 2.0f, 2.0f, 62.0f, WF_WIN_HANN}},
};
#define STEP_COUNT (sizeof STEPS / sizeof STEPS[0])

/* ---------------- state ---------------- */
static uint16_t pulse_buf[2][WF_MAX_SAMPLES] __attribute__((aligned(4)));
static char tx_buf[TELEMETRY_MAX];

static volatile uint32_t ms;
static volatile uint8_t pulse_active;
static volatile uint32_t pulses, underruns, dma_errors;
static volatile uint8_t fault_latched;

#if AQUASDR_ADAPTIVE_INPUT
static control_t controller;
static serial_rx rx;
static command_line command_input;
static char ack_buf[256];
static size_t ack_length;
#endif

static unsigned step;
static uint8_t cw;           // continuous (circular) CW stream running
static uint8_t active;       // buffer the DMA reads
static size_t active_n;      // samples per pulse in the active buffer
static wf_config active_cfg; // what the active buffer actually holds
static uint8_t pending;      // spare buffer holds a newer pulse
static size_t pending_n;
static wf_config pending_cfg;
static float cw_khz;
static size_t cw_n;

static uint32_t seq;
static uint64_t busy_cycles;

/* ---------------- clocks ---------------- */
static void clock_init(void) {
  RCC->APB1ENR |= RCC_APB1ENR_PWREN;
  (void)RCC->APB1ENR;
  PWR_CR |= 3u << 14; // voltage scale 1
  FLASH_ACR = 5u | FLASH_ACR_PRFTEN | FLASH_ACR_ICEN | FLASH_ACR_DCEN; // 5 wait states
  while ((FLASH_ACR & 0xFu) != 5u) {
  }
  // HSI 16 MHz / M 8 = 2 MHz · N 168 = 336 MHz VCO · /P 2 = 168 MHz (Q 7, R 2 unused)
  RCC->PLLCFGR = 8u | (168u << 6) | (0u << 16) | (0u << 22) | (7u << 24) | (2u << 28);
  RCC->CR |= RCC_CR_PLLON;
  while (!(RCC->CR & RCC_CR_PLLRDY)) {
  }
  // AHB /1, APB1 /4 (42 MHz), APB2 /2 (84 MHz), then switch to the PLL.
  RCC->CFGR = (RCC->CFGR & ~0xFCF3u) | (5u << 10) | (4u << 13);
  RCC->CFGR = (RCC->CFGR & ~3u) | 2u;
  while (((RCC->CFGR >> 2) & 3u) != 2u) {
  }
  SYST_RVR = SYSCLK_HZ / 1000u - 1u;
  SYST_CVR = 0;
  SYST_CSR = 7u; // core clock, interrupt, enable
  DEMCR |= 1u << 24;
  DWT_CYCCNT = 0;
  DWT_CTRL |= 1u;
}

void SysTick_Handler(void) { ms++; }

/* ---------------- GPIO ---------------- */
static void gpio_mode(GPIO_t *port, unsigned pin, unsigned mode) {
  port->MODER = (port->MODER & ~(3u << (pin * 2))) | (mode << (pin * 2));
}

static void gpio_init(void) {
  RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN | RCC_AHB1ENR_GPIOCEN | RCC_AHB1ENR_DMA1EN;
  (void)RCC->AHB1ENR;
  gpio_mode(GPIOA, 4, 3); // PA4 analog: DAC1 out
  gpio_mode(GPIOA, 5, 1); // PA5 LED
  gpio_mode(GPIOA, 8, 1); // PA8 pulse sync
  GPIOA->OSPEEDR |= 3u << (8 * 2);
  gpio_mode(GPIOA, 2, 2); // PA2 USART2 TX (AF7)
  gpio_mode(GPIOA, 3, 2); // PA3 USART2 RX (AF7)
  GPIOA->AFR[0] = (GPIOA->AFR[0] & ~(0xFFu << 8)) | (7u << 8) | (7u << 12);
  gpio_mode(GPIOC, 13, 0); // PC13 button, external pull-up on the NUCLEO
#if AQUASDR_ADAPTIVE_INPUT
  gpio_mode(GPIOA, 0, 3); // PA0/A0, dedicated voltage dial, not the TDS input
  GPIOA->PUPDR &= ~3u;
#endif
}

#define SYNC_HIGH() (GPIOA->BSRR = 1u << 8)
#define SYNC_LOW() (GPIOA->BSRR = 1u << (8 + 16))
#define LED_ON() (GPIOA->BSRR = 1u << 5)
#define LED_TOGGLE() (GPIOA->BSRR = (GPIOA->ODR & (1u << 5)) ? 1u << (5 + 16) : 1u << 5)

/* ---------------- TIM6 → DAC1 ← DMA1 Stream 5 (channel 7) ---------------- */
#define DAC_STREAM DMA1_STREAM(5)
#define DAC_STREAM_CR \
  (DMA_SxCR_CHSEL(7) | DMA_SxCR_PL_HIGH | DMA_SxCR_MSIZE_16 | DMA_SxCR_PSIZE_16 | DMA_SxCR_MINC | DMA_SxCR_DIR_M2P)

static void tx_engine_init(void) {
  RCC->APB1ENR |= RCC_APB1ENR_TIM6EN | RCC_APB1ENR_DACEN;
  (void)RCC->APB1ENR;
  DAC->CR = DAC_CR_TEN1 | DAC_CR_TSEL1_TIM6 | DAC_CR_DMAUDRIE1; // output buffer on
  DAC->DHR12R1 = WF_DAC_MID;
  DAC->CR |= DAC_CR_EN1;
  DAC_STREAM->CR = 0;
  DAC_STREAM->PAR = (uint32_t)&DAC->DHR12R1;
  TIM6->PSC = 0;
  TIM6->ARR = TIM6_CLK_HZ / SAMPLE_RATE_HZ - 1u;
  TIM6->CR2 = TIM_CR2_MMS_UPDATE;
  TIM6->EGR = TIM_EGR_UG;
  // TIM6 only runs while a pulse streams (or while CW is on), so between
  // pings nothing is clocking the DAC or waking the DMA.
  nvic_enable(IRQ_DMA1_STREAM5);
  nvic_enable(IRQ_TIM6_DAC);
}

// Stops the sample clock and parks the DAC at mid-scale with no DMA attached.
static void end_stream(void) {
  DAC->CR &= ~DAC_CR_DMAEN1;
  TIM6->CR1 &= ~TIM_CR1_CEN;
  DAC_STREAM->CR &= ~DMA_SxCR_EN;
  while (DAC_STREAM->CR & DMA_SxCR_EN) {
  }
  DMA1->HIFCR = DMA_ALL_FLAGS(DMA_S5_SHIFT);
  DAC->DHR12R1 = WF_DAC_MID;
  TIM6->EGR = TIM_EGR_UG; // one trigger so the DAC output takes the mid-scale value
  SYNC_LOW();
  pulse_active = 0;
}

static void start_stream(const uint16_t *samples, size_t n, int circular) {
  DMA1->HIFCR = DMA_ALL_FLAGS(DMA_S5_SHIFT);
  DAC_STREAM->CR = DAC_STREAM_CR | (circular ? DMA_SxCR_CIRC : DMA_SxCR_TCIE | DMA_SxCR_TEIE | DMA_SxCR_DMEIE);
  DAC_STREAM->M0AR = (uint32_t)samples;
  DAC_STREAM->NDTR = (uint32_t)n;
  DAC_STREAM->CR |= DMA_SxCR_EN;
  DAC->CR |= DAC_CR_DMAEN1;
  TIM6->CNT = 0;
  TIM6->CR1 |= TIM_CR1_CEN;
}

void DMA1_Stream5_IRQHandler(void) {
  uint32_t hisr = DMA1->HISR;
  uint32_t err = (1u << (DMA_S5_SHIFT + DMA_FLAG_TE)) | (1u << (DMA_S5_SHIFT + DMA_FLAG_DME));
  if (hisr & err) { dma_errors++; fault_latched = 1; }
  else if (hisr & (1u << (DMA_S5_SHIFT + DMA_FLAG_TC))) pulses++;
  end_stream();
}

void TIM6_DAC_IRQHandler(void) {
  if (DAC->SR & DAC_SR_DMAUDR1) {
    DAC->SR = DAC_SR_DMAUDR1;
    underruns++;
    fault_latched = 1;
    end_stream();
  }
}

/* ---------------- bring-up sequence ---------------- */
static void prepare_waveform(const wf_config *c) {
  // Only main context writes the spare buffer. The interrupt only stops DMA;
  // ownership swaps in schedule_ping after pulse_active becomes false.
  uint8_t spare = active ^ 1u;
  pending_n = wf_synthesize(c, SAMPLE_RATE_HZ, pulse_buf[spare], WF_MAX_SAMPLES);
  pending_cfg = wf_clamp(*c, SAMPLE_RATE_HZ);
  pending = pending_n != 0;
}

#if AQUASDR_ADAPTIVE_INPUT
static void adc_init(void) {
  RCC->APB2ENR |= RCC_APB2ENR_ADC1EN;
  (void)RCC->APB2ENR;
  // PCLK2=84 MHz, /4=21 MHz. Single channel, 12-bit, 480-cycle sampling.
  ADC_COMMON_CCR = (ADC_COMMON_CCR & ~(3u << 16)) | (1u << 16);
  ADC1->CR1 = 0;
  ADC1->SMPR2 = 7u;
  ADC1->SQR1 = ADC1->SQR2 = ADC1->SQR3 = 0;
  ADC1->SR = 0;
  ADC1->CR2 = ADC_CR2_ADON;
}

static void poll_environment(uint32_t now) {
  static uint32_t started;
  static uint8_t converting;
  if (converting && ((ADC1->SR & ADC_SR_EOC) || now - started >= 5u)) {
    int ok = (ADC1->SR & ADC_SR_EOC) != 0;
    uint16_t raw = ok ? (uint16_t)(ADC1->DR & 4095u) : 0;
    if (!ok) { ADC1->CR2 = 0; ADC1->SR = 0; ADC1->CR2 = ADC_CR2_ADON; }
    converting = 0;
    control_adc(&controller, raw, ok, now);
  }
  if (!converting && now - started >= 20u) {
    started = now;
    ADC1->SR = 0;
    ADC1->CR2 |= ADC_CR2_SWSTART;
    converting = 1;
  }
  controller.fault = fault_latched;
  control_tick(&controller, now);
  if (!control_allowed(&controller, now) && pulse_active) end_stream();
  if (controller.pending && !controller.prepared) {
    prepare_waveform(&controller.requested);
    controller.prepared = pending;
  }
  if (!controller.pending) pending = 0;
}
#else
static void select_step(unsigned k) {
  if (fault_latched) return;
  step = k;
  const wf_config *c = &STEPS[k].cfg;
  if (c->mode == WF_CW) {
    end_stream();
    cw_n = wf_cw_cycle(c->center_khz, c->amplitude_pct, SAMPLE_RATE_HZ, pulse_buf[0], WF_MAX_SAMPLES, &cw_khz);
    active = 0;
    pending = 0;
    cw = 1;
    start_stream(pulse_buf[0], cw_n, 1);
    LED_ON();
    return;
  }
  if (cw) {
    end_stream();
    cw = 0;
  }
  // Synthesise into the buffer the DMA is not reading; the scheduler swaps
  // it in between pings, so a pulse is never changed mid-flight.
  prepare_waveform(c);
}
#endif

static void poll_button(uint32_t now) {
  static uint8_t stable = 1, last = 1;
  static uint32_t since;
#if AQUASDR_ADAPTIVE_INPUT
  static uint32_t pressed;
  static uint8_t held;
#endif
  uint8_t level = (GPIOC->IDR >> 13) & 1u;
  if (level != last) { last = level; since = now; }
  else if (level != stable && now - since >= 30u) {
    stable = level;
#if AQUASDR_ADAPTIVE_INPUT
    if (!level) { pressed = now; held = 0; }
    else if (!held) { controller.mode = (wf_mode)((controller.mode + 1) % 3); controller.force = 1; controller.request_id = 0; }
#else
    if (!level) select_step((step + 1u) % STEP_COUNT);
#endif
  }
#if AQUASDR_ADAPTIVE_INPUT
  if (!stable && !held && now - pressed >= 1000u) {
    held = 1;
    if (controller.enabled) { control_stop(&controller); end_stream(); }
    else if (!controller.fault && !controller.expired && adaptation_allowed(&controller.policy, now)) {
      controller.enabled = 1; controller.force = 1;
    }
  }
#endif
}

static void schedule_ping(uint32_t now) {
  if (fault_latched) return;
#if AQUASDR_ADAPTIVE_INPUT
  if (!control_ping(&controller, now, pulse_active)) return;
#else
  static uint32_t last_ping;
  if (cw || pulse_active || now - last_ping < PING_INTERVAL_MS) return;
  last_ping = now;
#endif
  if (pending) {
    active ^= 1u; active_n = pending_n; active_cfg = pending_cfg; pending = 0;
  }
  if (!active_n) return;
  pulse_active = 1; SYNC_HIGH(); LED_TOGGLE();
  start_stream(pulse_buf[active], active_n, 0);
}

/* ---------------- telemetry (USART2 TX via DMA1 Stream 6, channel 4) ---------------- */
#define UART_STREAM DMA1_STREAM(6)

static void uart_init(void) {
  RCC->APB1ENR |= RCC_APB1ENR_USART2EN;
  (void)RCC->APB1ENR;
  USART2->BRR = (PCLK1_HZ + UART_BAUD / 2u) / UART_BAUD;
  USART2->CR3 = USART_CR3_DMAT;
  USART2->CR1 = USART_CR1_UE | USART_CR1_TE;
#if AQUASDR_ADAPTIVE_INPUT
  USART2->CR1 |= USART_CR1_RE | USART_CR1_RXNEIE;
  USART2->CR3 |= 1u; // error interrupt (ORE/FE/NE), cleared by SR then DR
  nvic_enable(IRQ_USART2);
#endif
  UART_STREAM->CR = DMA_SxCR_CHSEL(4) | DMA_SxCR_MINC | DMA_SxCR_DIR_M2P;
  UART_STREAM->PAR = (uint32_t)&USART2->DR;
}

static int uart_busy(void) { return (UART_STREAM->CR & DMA_SxCR_EN) != 0; }

static void uart_send(const char *s, size_t n) {
  DMA1->HIFCR = DMA_ALL_FLAGS(DMA_S6_SHIFT);
  UART_STREAM->M0AR = (uint32_t)s;
  UART_STREAM->NDTR = (uint32_t)n;
  UART_STREAM->CR |= DMA_SxCR_EN;
}

#if AQUASDR_ADAPTIVE_INPUT
void USART2_IRQHandler(void) {
  uint32_t status = USART2->SR;
  if (!(status & (USART_SR_RXNE | 15u))) return;
  unsigned char b = (unsigned char)USART2->DR;
  serial_rx_push(&rx, b, status & 15u);
}
static void poll_commands(uint32_t now) {
  if (rx.corrupt) {
    __asm volatile("cpsid i" ::: "memory");
    serial_rx_discard(&rx);
    __asm volatile("cpsie i" ::: "memory");
    command_corrupt(&command_input);
  }
  if (ack_length) {
    if (!uart_busy()) { uart_send(ack_buf, ack_length); ack_length = 0; }
    return;
  }
  // Do not overwrite ack_buf until DMA has finished reading it.
  if (uart_busy()) return;
  unsigned budget = COMMAND_MAX + 1;
  uint8_t b;
  while (budget-- && serial_rx_pop(&rx, &b)) {
    int complete = command_feed(&command_input, b);
    if (complete) {
      command_t cmd = {0};
      const char *error = "INVALID_COMMAND";
      if (complete == 1 && command_parse(command_input.data, &cmd)) error = control_command(&controller, &cmd, now);
      else cmd = (command_t){0};
      if (!controller.enabled && pulse_active) end_stream();
      if (!controller.pending) pending = 0;
      ack_length = command_ack(&cmd, error, ack_buf, sizeof ack_buf);
      break;
    }
  }
}
#endif

static void send_telemetry(uint32_t now) {
  static uint32_t last, last_busy_ms;
  if (uart_busy()) return;
#if AQUASDR_ADAPTIVE_INPUT
  if (now - last < TELEMETRY_INTERVAL_MS && !controller.status_requested) return;
  if (ack_length || rx.tail != rx.head) return;
  controller.status_requested = 0;
#else
  if (now - last < TELEMETRY_INTERVAL_MS) return;
#endif
  last = now;
  uint32_t window_ms = now - last_busy_ms;
  float cpu = window_ms ? (float)busy_cycles * 100.0f / ((float)window_ms * (float)(SYSCLK_HZ / 1000u)) : 0.0f;
  busy_cycles = 0;
  last_busy_ms = now;
  telemetry_t t = {
      .seq = ++seq,
      .uptime_ms = now,
      // Only what the active buffer really holds; CW has no dashboard mode.
      .waveform = !cw && active_n ? &active_cfg : 0,
      .sample_rate_hz = SAMPLE_RATE_HZ,
      .cw = cw,
      .cw_khz = cw_khz,
      .dma_buffer = (uint32_t)(cw ? cw_n : active_n),
      .dma_faults = dma_errors + underruns,
      .underruns = underruns,
      .cpu_load = cpu > 100.0f ? 100.0f : cpu,
      .step = step + 1u,
      .step_count = STEP_COUNT,
      .step_label = STEPS[step].label,
      .inhibited = fault_latched,
  };
#if AQUASDR_ADAPTIVE_INPUT
  t.control = &controller;
  t.inhibited = !control_allowed(&controller, now);
  t.pending = controller.pending;
  t.step = (unsigned)controller.mode + 1u;
  t.step_count = 3;
  t.step_label = "environment control";
#endif
  uart_send(tx_buf, telemetry_format(&t, tx_buf));
}

/* ---------------- main ---------------- */
int main(void) {
  clock_init();
  gpio_init();
  wf_init();
  tx_engine_init();
  uart_init();
#if AQUASDR_ADAPTIVE_INPUT
  control_init(&controller);
  adc_init();
#else
  select_step(START_STEP);
#endif

  uint32_t last_tick = ms;
  for (;;) {
    uint32_t t0 = DWT_CYCCNT;
    uint32_t now = ms;
    if (now != last_tick) {
      last_tick = now;
      poll_button(now);
#if AQUASDR_ADAPTIVE_INPUT
      poll_commands(now);
      poll_environment(now);
#endif
      schedule_ping(ms); // include synthesis time in decision-to-output latency
      send_telemetry(ms);
    }
    // CPU load = time spent working here, excluding sleep; interrupt
    // handlers are a few instructions each and are not counted.
    busy_cycles += (uint32_t)(DWT_CYCCNT - t0);
    __asm volatile("wfi");
  }
}
