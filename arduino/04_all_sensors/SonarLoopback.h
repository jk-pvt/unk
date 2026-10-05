#pragma once

#include <Arduino.h>
#include <math.h>

// Safe electrical loopback for commissioning the STM32 waveform engine.
// Connect A2/PA4 (DAC1) directly to A5/PC0 (ADC). Do not connect a driver or
// transducer while this continuous bench waveform is enabled.
namespace sonarloop {

constexpr uint32_t SAMPLE_RATE_HZ = 1000000UL;
constexpr float CARRIER_HZ = 40000.0f;
constexpr float AMPLITUDE_PERCENT = 62.0f;
constexpr size_t WAVE_SAMPLES = 25;  // exactly one 40 kHz cycle at 1 MS/s

static uint16_t wave[WAVE_SAMPLES] __attribute__((aligned(4)));
static uint32_t actualSampleRate = 0;
static uint32_t dmaFaults = 0;
static uint32_t underruns = 0;
static float loopbackVpp = NAN;
static float loopbackMean = NAN;
static bool loopbackDetected = false;
static uint16_t dacCodeMin = 4095;
static uint16_t dacCodeMax = 0;

inline uint32_t timerClockHz() {
  uint32_t clock = HAL_RCC_GetPCLK1Freq();
  // STM32 timers receive 2x PCLK when the APB prescaler is not 1.
  if ((RCC->CFGR & RCC_CFGR_PPRE1) != RCC_CFGR_PPRE1_DIV1) clock *= 2;
  return clock;
}

inline void stop() {
  TIM6->CR1 &= ~TIM_CR1_CEN;
  DAC->CR &= ~DAC_CR_DMAEN1;
  DMA1_Stream5->CR &= ~DMA_SxCR_EN;
  while (DMA1_Stream5->CR & DMA_SxCR_EN) {}
  DAC->DHR12R1 = 2048;
}

inline void begin() {
  for (size_t i = 0; i < WAVE_SAMPLES; ++i) {
    float phase = 2.0f * PI * (float)i / (float)WAVE_SAMPLES;
    float code = 2048.0f + sinf(phase) * (2047.0f * AMPLITUDE_PERCENT / 100.0f);
    wave[i] = (uint16_t)(code + 0.5f);
  }

  pinMode(A2, INPUT_ANALOG);
  pinMode(A5, INPUT_ANALOG);
  __HAL_RCC_DMA1_CLK_ENABLE();
  __HAL_RCC_DAC_CLK_ENABLE();
  __HAL_RCC_TIM6_CLK_ENABLE();

  stop();
  DMA1->HIFCR = 0x3Du << 6;  // clear all Stream 5 flags
  DMA1_Stream5->PAR = (uint32_t)&DAC->DHR12R1;
  DMA1_Stream5->M0AR = (uint32_t)wave;
  DMA1_Stream5->NDTR = WAVE_SAMPLES;
  DMA1_Stream5->FCR = 0;
  DMA1_Stream5->CR =
      (7u << 25) |  // channel 7: DAC1
      (2u << 16) |  // high priority
      (1u << 13) |  // memory width 16 bit
      (1u << 11) |  // peripheral width 16 bit
      (1u << 10) |  // increment memory
      (1u << 8) |   // circular mode
      (1u << 6);    // memory-to-peripheral

  uint32_t timerHz = timerClockHz();
  uint32_t divisor = timerHz / SAMPLE_RATE_HZ;
  TIM6->PSC = 0;
  TIM6->ARR = divisor - 1;
  TIM6->CNT = 0;
  TIM6->CR2 = 2u << 4;  // update event is TRGO
  TIM6->EGR = TIM_EGR_UG;
  actualSampleRate = timerHz / divisor;

  DAC->CR = 0;
  DAC->DHR12R1 = 2048;
  DAC->CR = DAC_CR_TEN1 | DAC_CR_DMAEN1 | DAC_CR_EN1;  // TIM6 TRGO is TSEL=000
  DMA1_Stream5->CR |= DMA_SxCR_EN;
  TIM6->CR1 |= TIM_CR1_CEN;
}

inline void pollFaults() {
  constexpr uint32_t DMA_ERROR_FLAGS = (1u << 6) | (1u << 8) | (1u << 9);
  uint32_t flags = DMA1->HISR;
  if (flags & DMA_ERROR_FLAGS) {
    ++dmaFaults;
    DMA1->HIFCR = 0x3Du << 6;
  }
  if (DAC->SR & DAC_SR_DMAUDR1) {
    ++underruns;
    DAC->SR = DAC_SR_DMAUDR1;
  }
}

inline void measure() {
  uint16_t lo = 4095, hi = 0;
  uint16_t dacLo = 4095, dacHi = 0;
  uint32_t sum = 0;
  constexpr uint16_t COUNT = 256;
  for (uint16_t i = 0; i < COUNT; ++i) {
    uint16_t sample = analogRead(A5);
    uint16_t dacSample = DAC->DOR1 & 0x0FFFu;
    if (sample < lo) lo = sample;
    if (sample > hi) hi = sample;
    if (dacSample < dacLo) dacLo = dacSample;
    if (dacSample > dacHi) dacHi = dacSample;
    sum += sample;
    // Deliberately vary the interval so analogRead cannot phase-lock to the
    // 25 us carrier period and mistake a live sine wave for a DC level.
    delayMicroseconds(1u + ((uint32_t)i * 7u) % 17u);
  }
  loopbackVpp = (hi - lo) * 3.3f / 4095.0f;
  loopbackMean = (sum / (float)COUNT) * 3.3f / 4095.0f;
  dacCodeMin = dacLo;
  dacCodeMax = dacHi;
  loopbackDetected = loopbackVpp > 0.50f && loopbackMean > 0.70f && loopbackMean < 2.60f;
}

}  // namespace sonarloop
