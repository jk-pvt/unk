#pragma once
// Adaptive transmitter for the mounted payload. The same C engine as the bare-metal image (src/engine, copied by
// scripts/sync-arduino-engine.mjs) runs inside the sensor sketch, so every sensor, the TFT and the HC-SR04 keep
// their existing pins. The transmitter uses only what the sensor sketch already used for its DAC loopback:
//   TIM6 -> DMA1 Stream 5 (channel 7) -> DAC1 -> PA4 (A2). Sync output moves to the unused D2 / PA10.
// Environment source: WEB (serial command) or A0 (the mounted TDS board, 0-2.3 V), through ONE policy.
#include <Arduino.h>

extern "C" {
#include "src/engine/config.h"
#include "src/engine/waveform.h"
#include "src/engine/adaptation.h"
#include "src/engine/control.h"
#include "src/engine/telemetry.h"
}

namespace adaptive {

constexpr uint8_t SYNC_PIN = D2;  // PA10, unused by every mounted module: high while a pulse streams
constexpr size_t OUT_SIZE = 4096;

static uint16_t pulseBuf[2][WF_MAX_SAMPLES] __attribute__((aligned(4)));
static control_t controller;
static command_line commandInput;

static volatile uint8_t pulseActive = 0;
static volatile uint8_t faultLatched = 0;
static volatile uint32_t pulses = 0, dmaErrors = 0;
static uint32_t underruns = 0;

static uint8_t active = 0;
static size_t activeN = 0, pendingN = 0;
static wf_config activeCfg, pendingCfg;
static uint8_t pending = 0;
static uint32_t seq = 0;
static uint32_t timerHz = 0, sampleRate = 0;
// Physical self-check taken during a pulse: A2/PA4 is jumpered to A5/PC0, so the ADC sees the DAC output.
static bool loopbackSeen = false, loopbackDetected = false;
static float loopbackVpp = NAN, loopbackMean = NAN;
static uint16_t dacCodeMin = 4095, dacCodeMax = 0;

// ---- UART: core interrupt RX, DMA TX (USART2 = ST-LINK virtual COM port, 115200 8N1) -------------------
// Build 1 sent telemetry through the core's interrupt-driven Serial and lost 27-42 % of long commands.
// Build 2 tried DMA for both directions and received nothing: USART2_RX is DMA1 Stream 5 channel 4, the
// same stream the DAC needs (DAC1 is DMA1 Stream 5 channel 7), so RX cannot use DMA in this image.
// Build 3: the core's Serial handles RX only; TX is one DMA transfer per packet on Stream 6 channel 4
// (USART2_TX), so the core never starts an interrupt transmit while commands are arriving.
static uint32_t rxBytes = 0, cmdLines = 0, cmdInvalid = 0;

inline void uartBegin() {
  Serial.begin(115200);                 // pins, baud and the 512-byte interrupt RX ring come from the core
  __HAL_RCC_DMA1_CLK_ENABLE();
  USART2->CR3 |= USART_CR3_DMAT;        // TX requests go to DMA; the core never transmits
}

inline int rxAvailable() { return Serial.available(); }
inline int rxRead() {
  int b = Serial.read();
  if (b >= 0) rxBytes++;
  return b;
}

// Non-blocking output: telemetry and ACKs are built in memory and handed to the TX DMA in one transfer.
struct Out {
  char buf[OUT_SIZE];
  size_t len = 0;
  bool sending = false;
  bool overflow = false;
  size_t pos = 0;  // kept for the ACK copy path; unused by DMA
  bool idle() const { return len == 0 && !sending; }
  void reset() { len = pos = 0; sending = false; overflow = false; }
  void pump() {
    if (len == 0) return;
    if (!sending) {
      DMA1->HIFCR = 0x3Du << 16;
      DMA1_Stream6->CR = 0;
      while (DMA1_Stream6->CR & DMA_SxCR_EN) {}
      DMA1_Stream6->PAR = (uint32_t)&USART2->DR;
      DMA1_Stream6->M0AR = (uint32_t)buf;
      DMA1_Stream6->NDTR = (uint32_t)len;
      DMA1_Stream6->FCR = 0;
      DMA1_Stream6->CR = (4u << 25) | (1u << 16) | (1u << 10) | (1u << 6);  // ch4, medium priority, memory increment, M2P
      USART2->SR = ~USART_SR_TC;
      DMA1_Stream6->CR |= DMA_SxCR_EN;
      sending = true;
      return;
    }
    if (DMA1_Stream6->CR & DMA_SxCR_EN) return;  // still streaming
    DMA1->HIFCR = 0x3Du << 16;
    reset();
  }
};
static Out out;
static char ackBuf[256];
static size_t ackLen = 0;

class BufPrint : public Print {
 public:
  size_t write(uint8_t c) override {
    if (out.len >= OUT_SIZE) { out.overflow = true; return 0; }
    out.buf[out.len++] = (char)c;
    return 1;
  }
};
static BufPrint printer;

inline uint32_t timerClock() {
  uint32_t clock = HAL_RCC_GetPCLK1Freq();
  if ((RCC->CFGR & RCC_CFGR_PPRE1) != RCC_CFGR_PPRE1_DIV1) clock *= 2;  // APB1 timers run at 2x PCLK1
  return clock;
}

#define ADAPT_SYNC_HIGH() (GPIOA->BSRR = 1u << 10)
#define ADAPT_SYNC_LOW() (GPIOA->BSRR = 1u << (10 + 16))

constexpr uint32_t DMA_S5_SHIFT = 6;  // HISR/HIFCR bit offset of stream 5
constexpr uint32_t DMA_S5_FLAGS = 0x3Du << DMA_S5_SHIFT;
constexpr uint32_t DMA_S5_TC = 1u << (DMA_S5_SHIFT + 5);
constexpr uint32_t DMA_S5_TE = 1u << (DMA_S5_SHIFT + 3);
constexpr uint32_t DMA_S5_DME = 1u << (DMA_S5_SHIFT + 2);

// Stops the sample clock and parks the DAC at mid-scale (about 1.65 V) with no DMA attached.
inline void endStream() {
  DAC->CR &= ~DAC_CR_DMAEN1;
  TIM6->CR1 &= ~TIM_CR1_CEN;
  DMA1_Stream5->CR &= ~DMA_SxCR_EN;
  while (DMA1_Stream5->CR & DMA_SxCR_EN) {}
  DMA1->HIFCR = DMA_S5_FLAGS;
  DAC->DHR12R1 = 2048;
  TIM6->EGR = TIM_EGR_UG;  // one trigger so the output takes the mid-scale value
  ADAPT_SYNC_LOW();
  pulseActive = 0;
}

inline void startStream(const uint16_t *samples, size_t n) {
  DMA1->HIFCR = DMA_S5_FLAGS;
  DMA1_Stream5->CR = (7u << 25) | (2u << 16) | (1u << 13) | (1u << 11) | (1u << 10) | (1u << 6) |  // ch7, high, 16/16 bit, minc, M2P
                     (1u << 4) | (1u << 2) | (1u << 1);                                          // TC, TE, DME interrupts
  DMA1_Stream5->M0AR = (uint32_t)samples;
  DMA1_Stream5->NDTR = (uint32_t)n;
  DMA1_Stream5->CR |= DMA_SxCR_EN;
  DAC->CR |= DAC_CR_DMAEN1;
  TIM6->CNT = 0;
  TIM6->CR1 |= TIM_CR1_CEN;
}

}  // namespace adaptive

// Pulse finished (or DMA error): stop the clock at once so the DAC never sees a trigger without data.
extern "C" void DMA1_Stream5_IRQHandler(void) {
  uint32_t hisr = DMA1->HISR;
  if (hisr & (adaptive::DMA_S5_TE | adaptive::DMA_S5_DME)) {
    adaptive::dmaErrors++;
    adaptive::faultLatched = 1;
  } else if (hisr & adaptive::DMA_S5_TC) {
    adaptive::pulses++;
  }
  adaptive::endStream();
}

namespace adaptive {

inline void begin() {
  uartBegin();
  pinMode(A2, INPUT_ANALOG);  // PA4 analog for DAC1
  pinMode(A5, INPUT_ANALOG);  // PC0 analog: the A2-A5 jumper brings PA4 here
  pinMode(SYNC_PIN, OUTPUT);
  digitalWrite(SYNC_PIN, LOW);
  __HAL_RCC_DMA1_CLK_ENABLE();
  __HAL_RCC_DAC_CLK_ENABLE();
  __HAL_RCC_TIM6_CLK_ENABLE();
  wf_init();
  control_init(&controller);

  timerHz = timerClock();
  uint32_t divisor = timerHz / SAMPLE_RATE_HZ;
  sampleRate = timerHz / divisor;
  DAC->CR = 0;
  DAC->DHR12R1 = 2048;
  DAC->CR = DAC_CR_TEN1 | DAC_CR_EN1;  // trigger = TIM6 TRGO (TSEL 000); no DMA yet
  DMA1_Stream5->CR = 0;
  DMA1_Stream5->PAR = (uint32_t)&DAC->DHR12R1;
  DMA1_Stream5->FCR = 0;
  TIM6->PSC = 0;
  TIM6->ARR = divisor - 1;
  TIM6->CR2 = 2u << 4;  // update event is TRGO
  TIM6->EGR = TIM_EGR_UG;
  NVIC_SetPriority(DMA1_Stream5_IRQn, 2);
  NVIC_EnableIRQ(DMA1_Stream5_IRQn);
}

inline void prepare(const wf_config *c) {
  // Only the main context writes the spare buffer; the interrupt only stops DMA.
  uint8_t spare = active ^ 1u;
  pendingN = wf_synthesize(c, SAMPLE_RATE_HZ, pulseBuf[spare], WF_MAX_SAMPLES);
  pendingCfg = wf_clamp(*c, SAMPLE_RATE_HZ);
  pending = pendingN != 0;
}

inline bool captureActive();  // defined with the capture code below

inline void pollEnvironment(uint32_t now) {
  static uint32_t lastSample = 0;
  if (now - lastSample >= 20 && !captureActive()) {
    lastSample = now;
    // A0 carries the mounted TDS board. control_adc ignores it while the source is WEB.
    uint16_t raw = (uint16_t)analogRead(A0);
    control_adc(&controller, raw, 1, now);
  }
  controller.fault = faultLatched;
  control_tick(&controller, now);
  if (!control_allowed(&controller, now) && pulseActive) endStream();
  if (controller.pending && !controller.prepared) {
    prepare(&controller.requested);
    controller.prepared = pending;
  }
  if (!controller.pending) pending = 0;
}

#ifdef AQUASDR_CAPTURE
// ---- MCU ADC CAPTURE ------------------------------------------------------------------------------------------------
// The board samples its own DAC pin: PA4 is jumpered to A5/PC0 (ADC input 10). ADC3 does the sampling because the Arduino core only uses
// ADC1, and TIM8's TRGO paces it (TIM6, which paces the DAC, cannot trigger an ADC on this chip). DMA2 Stream 0 channel 2 moves the samples,
// so TIM6 -> DMA1 Stream 5 -> DAC1 is untouched. The result is an MCU ADC CAPTURE, never an oscilloscope measurement.
// One capture = one controlled run: the CAPTURE_DAC command enables output, the capture begins with the next pulse, and the output is
// stopped again by the firmware the moment the buffer is full (or on any failure).
static uint16_t capBuf[CAPTURE_MAX_SAMPLES] __attribute__((aligned(4)));
static capture_status_t capStatus = {CAPTURE_IDLE, 0, 0, 0, 0, 0, 0, 0, 0, ""};
static uint32_t capSeq = 0, capRequestedMs = 0, capStartMs = 0;
static uint8_t capMode = 0;

inline bool captureActive() { return capStatus.state == CAPTURE_REQUESTED || capStatus.state == CAPTURE_RUNNING; }
inline bool captureSendPending() { return capStatus.state == CAPTURE_SENDING; }

inline uint32_t timer8Clock() {
  uint32_t clock = HAL_RCC_GetPCLK2Freq();
  if ((RCC->CFGR & RCC_CFGR_PPRE2) != RCC_CFGR_PPRE2_DIV1) clock *= 2;  // APB2 timers run at 2x PCLK2
  return clock;
}
inline void capHardwareStop() {
  TIM8->CR1 &= ~TIM_CR1_CEN;
  ADC3->CR2 = 0;                                  // ADON, trigger and DMA off
  DMA2_Stream0->CR &= ~DMA_SxCR_EN;
  while (DMA2_Stream0->CR & DMA_SxCR_EN) {}
  DMA2->LIFCR = 0x3Du;                            // clear every stream 0 flag
}
inline void capHardwareStart(uint8_t mode) {
  const uint32_t rate = capture_rate_for_mode(mode), n = capture_samples_for_mode(mode);
  __HAL_RCC_ADC3_CLK_ENABLE();
  __HAL_RCC_TIM8_CLK_ENABLE();
  __HAL_RCC_DMA2_CLK_ENABLE();
  ADC->CCR = (ADC->CCR & ~ADC_CCR_ADCPRE) | ADC_CCR_ADCPRE_0;   // PCLK2 / 4 = 22.5 MHz, below the 36 MHz limit
  ADC3->CR1 = 0;                                                // 12 bit, no scan
  ADC3->SMPR1 = (ADC3->SMPR1 & ~ADC_SMPR1_SMP10) | ADC_SMPR1_SMP10_0;   // 15 cycles + 12 = 27 cycles = 1.2 us, inside the 2 us period at 500 kS/s
  ADC3->SQR1 = 0;                                               // one conversion per trigger
  ADC3->SQR3 = 10;                                              // channel 10 = PC0 = A5
  ADC3->SR = 0;
  DMA2_Stream0->CR = 0;
  while (DMA2_Stream0->CR & DMA_SxCR_EN) {}
  DMA2->LIFCR = 0x3Du;
  DMA2_Stream0->PAR = (uint32_t)&ADC3->DR;
  DMA2_Stream0->M0AR = (uint32_t)capBuf;
  DMA2_Stream0->NDTR = n;
  DMA2_Stream0->FCR = 0;
  DMA2_Stream0->CR = (2u << 25) | (3u << 16) | (1u << 13) | (1u << 11) | (1u << 10);   // ch2 = ADC3, very high priority, 16/16 bit, memory increment, P2M
  DMA2_Stream0->CR |= DMA_SxCR_EN;
  ADC3->CR2 = ADC_CR2_ADON;
  delayMicroseconds(5);                                         // ADC stabilisation
  TIM8->CR1 = 0;
  TIM8->PSC = 0;
  TIM8->ARR = timer8Clock() / rate - 1;
  TIM8->CNT = 0;
  TIM8->CR2 = 2u << 4;                                          // update event is TRGO
  TIM8->EGR = TIM_EGR_UG;                                       // fired before the ADC is armed, so it does not start a conversion
  TIM8->SR = 0;
  ADC3->CR2 = ADC_CR2_ADON | ADC_CR2_DMA | ADC_CR2_DDS | (14u << 24) | (1u << 28);   // external trigger: TIM8 TRGO, rising edge
  TIM8->CR1 |= TIM_CR1_CEN;
}
inline void captureFail(const char *reason) {
  capHardwareStop();
  capStatus.state = CAPTURE_FAILED;
  capStatus.reason = reason;
  controller.capture_request = 0;
  controller.capture_busy = 0;
  control_stop(&controller);
  if (pulseActive) endStream();
}
inline void captureFinish() {
  capHardwareStop();
  capture_stats(capBuf, capStatus.samples, &capStatus.min_counts, &capStatus.max_counts, &capStatus.mean_counts_x10);
  capStatus.state = CAPTURE_SENDING;
  capStatus.sent = 0;
  control_stop(&controller);                                    // one capture, then the output is off again
  if (pulseActive) endStream();
}
// Takes a CAPTURE_DAC request, and follows a running capture to completion. Never blocks.
inline void captureService(uint32_t now) {
  if (controller.capture_request && !captureActive() && capStatus.state != CAPTURE_SENDING) {
    capMode = controller.capture_request - 1;
    controller.capture_request = 0;
    controller.capture_busy = 1;
    capStatus = {CAPTURE_REQUESTED, ++capSeq, capMode, capture_rate_for_mode(capMode), capture_samples_for_mode(capMode), 0, 0, 0, 0, ""};
    capRequestedMs = now;
  }
  if (capStatus.state == CAPTURE_REQUESTED) {
    if (now - capRequestedMs > 2000) captureFail("NO_PULSE");
  } else if (capStatus.state == CAPTURE_RUNNING) {
    uint32_t flags = DMA2->LISR;
    if (flags & (DMA_LISR_TEIF0 | DMA_LISR_DMEIF0)) captureFail("DMA_ERROR");
    else if (flags & DMA_LISR_TCIF0) captureFinish();
    else if (now - capStartMs > 400) captureFail("TIMEOUT");
  }
}
// Queues the next chunk line when the transmit buffer is idle. The last chunk returns the status to IDLE and frees the next request.
inline void captureSendNext() {
  if (!captureSendPending() || !out.idle() || ackLen) return;
  const uint32_t remaining = capStatus.samples - capStatus.sent, n = remaining < CAPTURE_CHUNK_SAMPLES ? remaining : CAPTURE_CHUNK_SAMPLES;
  size_t len = capture_chunk_line(out.buf, OUT_SIZE, capStatus.id, capStatus.mode, capStatus.rate_hz, capStatus.samples, capStatus.sent, capBuf + capStatus.sent, n);
  if (!len) { captureFail("CHUNK_TOO_LARGE"); return; }
  out.len = len;
  capStatus.sent += n;
  if (capStatus.sent >= capStatus.samples) { capStatus.state = CAPTURE_IDLE; controller.capture_busy = 0; }
}
#else
inline bool captureActive() { return false; }
inline bool captureSendPending() { return false; }
inline void captureSendNext() {}
#endif

// ~1 ms of ADC samples on A5 and DAC output-register reads while a pulse streams. Intervals vary so the
// sampler cannot phase-lock to the carrier. This is a measurement of the live DAC pin, not a calculation.
inline void measureLoopback() {
  uint16_t lo = 4095, hi = 0, dlo = 4095, dhi = 0;
  uint32_t sum = 0;
  constexpr uint16_t COUNT = 48;
  for (uint16_t i = 0; i < COUNT; ++i) {
    uint16_t sample = analogRead(A5);
    uint16_t code = DAC->DOR1 & 0x0FFFu;
    if (sample < lo) lo = sample;
    if (sample > hi) hi = sample;
    if (code < dlo) dlo = code;
    if (code > dhi) dhi = code;
    sum += sample;
    delayMicroseconds(1u + ((uint32_t)i * 7u) % 11u);
  }
  loopbackVpp = (hi - lo) * 3.3f / 4095.0f;
  loopbackMean = (sum / (float)COUNT) * 3.3f / 4095.0f;
  dacCodeMin = dlo;
  dacCodeMax = dhi;
  loopbackSeen = true;
  loopbackDetected = loopbackVpp > 0.30f && loopbackMean > 0.70f && loopbackMean < 2.60f;
}

inline void schedulePing(uint32_t now) {
  if (faultLatched) return;
  if (!control_ping(&controller, now, pulseActive)) return;
  if (pending) {
    active ^= 1u;
    activeN = pendingN;
    activeCfg = pendingCfg;
    pending = 0;
  }
  if (!activeN) return;
#ifdef AQUASDR_CAPTURE
  if (capStatus.state == CAPTURE_REQUESTED) {   // arm the capture first so the baseline before the pulse is recorded too
    capHardwareStart(capMode);
    delayMicroseconds(300);
    capStatus.state = CAPTURE_RUNNING;
    capStartMs = millis();
  }
#endif
  pulseActive = 1;
  ADAPT_SYNC_HIGH();
  startStream(pulseBuf[active], activeN);
  if (pulseActive && !captureActive()) measureLoopback();  // the interrupt may already have ended a very short pulse; not during a capture
}

// DAC underrun is polled (the core owns the TIM6/DAC vector); it can only occur if DMA misses a sample.
inline void pollDacFault() {
  if (DAC->SR & DAC_SR_DMAUDR1) {
    DAC->SR = DAC_SR_DMAUDR1;
    underruns++;
    faultLatched = 1;
    if (pulseActive) endStream();
  }
}

// Commands: JSON lines from the console. Returns true if the byte was consumed by a legacy single-key command.
inline void pollCommands(uint32_t now, void (*legacyKey)(char)) {
  if (ackLen && out.idle()) {
    memcpy(out.buf, ackBuf, ackLen);
    out.len = ackLen;
    ackLen = 0;
  }
  if (ackLen) return;  // previous ACK still waiting for the UART
  int budget = COMMAND_MAX + 1;
  while (budget-- > 0 && rxAvailable() > 0) {
    int b = rxRead();
    if (b < 0) break;
    if (commandInput.length == 0 && !commandInput.dropping && b == 'z' && legacyKey) {  // old sensor-zero key
      legacyKey('z');
      continue;
    }
    int complete = command_feed(&commandInput, (unsigned char)b);
    if (!complete) continue;
    cmdLines++;
    command_t cmd = {0};
    const char *error = "INVALID_COMMAND";
    if (complete == 1 && command_parse(commandInput.data, &cmd)) error = control_command(&controller, &cmd, now);
    else cmd = (command_t){0};
    if (error && !strcmp(error, "INVALID_COMMAND")) cmdInvalid++;
    if (!controller.enabled && pulseActive) endStream();
    if (!controller.pending) pending = 0;
    ackLen = command_ack(&cmd, error, ackBuf, sizeof ackBuf);
    break;  // one command per pass; its ACK goes out before the next is read
  }
}

// Call every loop pass, and between slow operations. Never blocks.
inline void service(uint32_t now, void (*legacyKey)(char) = nullptr) {
#ifdef AQUASDR_CAPTURE
  captureService(now);
#endif
  pollDacFault();
  pollCommands(now, legacyKey);
  pollEnvironment(now);
  schedulePing(now);
  out.pump();
}

inline bool outputBusy() { return !out.idle() || ackLen > 0 || rxAvailable() > 0; }
inline bool statusRequested() { return controller.status_requested; }
inline void clearStatusRequest() { controller.status_requested = 0; }
inline bool outputEnabled() { return controller.enabled && control_allowed(&controller, millis()); }
inline bool hasApplied() { return controller.has_applied; }
inline const wf_config &appliedConfig() { return activeCfg; }
inline const char *profileName() { return adaptation_profile_name(controller.policy.profile); }
inline bool webSource() { return controller.input.web; }

// The adaptive packet fields, comma-prefixed, into a caller buffer.
inline size_t adaptiveFields(uint32_t now, char *dest, size_t cap) {
  telemetry_t t = {};
  t.control = &controller;
  t.seq = ++seq;
  t.uptime_ms = now;
  t.waveform = activeN ? &activeCfg : nullptr;
  t.sample_rate_hz = SAMPLE_RATE_HZ;
  t.dma_buffer = (uint32_t)activeN;
  t.dma_faults = dmaErrors + underruns;
  t.underruns = underruns;
  t.step = (unsigned)controller.mode + 1u;
  t.step_count = 3;
  t.step_label = "environment control";
  t.inhibited = !control_allowed(&controller, now);
  t.pending = controller.pending;
#ifdef AQUASDR_CAPTURE
  t.capture = &capStatus;
#endif
  return telemetry_adaptive_fields(&t, dest, cap);
}

}  // namespace adaptive
