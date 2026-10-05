// Minimal STM32F446RE register map — only the peripherals this firmware
// touches. Addresses and bit positions are from RM0390 (STM32F446xx
// reference manual) and PM0214 (Cortex-M4 programming manual).
#ifndef AQUASDR_REGS_H
#define AQUASDR_REGS_H

#include <stdint.h>

#define IO volatile uint32_t

/* ---------------- RCC · 0x4002 3800 ---------------- */
typedef struct {
  IO CR, PLLCFGR, CFGR, CIR, AHB1RSTR, AHB2RSTR, AHB3RSTR, _r0, APB1RSTR, APB2RSTR, _r1[2];
  IO AHB1ENR, AHB2ENR, AHB3ENR, _r2, APB1ENR, APB2ENR;
} RCC_t;
#define RCC ((RCC_t *)0x40023800u)
#define RCC_CR_PLLON (1u << 24)
#define RCC_CR_PLLRDY (1u << 25)
#define RCC_AHB1ENR_GPIOAEN (1u << 0)
#define RCC_AHB1ENR_GPIOCEN (1u << 2)
#define RCC_AHB1ENR_DMA1EN (1u << 21)
#define RCC_APB1ENR_TIM6EN (1u << 4)
#define RCC_APB1ENR_USART2EN (1u << 17)
#define RCC_APB1ENR_PWREN (1u << 28)
#define RCC_APB1ENR_DACEN (1u << 29)
#define RCC_APB2ENR_ADC1EN (1u << 8)

/* ADC1 / common registers, RM0390 section 13.13 */
typedef struct {
  IO SR, CR1, CR2, SMPR1, SMPR2, JOFR[4], HTR, LTR, SQR1, SQR2, SQR3, JSQR;
  IO JDR[4], DR;
} ADC_t;
#define ADC1 ((ADC_t *)0x40012000u)
#define ADC_COMMON_CCR (*(IO *)0x40012304u)
#define ADC_SR_EOC (1u << 1)
#define ADC_CR2_ADON (1u << 0)
#define ADC_CR2_SWSTART (1u << 30)

/* ---------------- FLASH / PWR ---------------- */
#define FLASH_ACR (*(IO *)0x40023C00u)
#define FLASH_ACR_PRFTEN (1u << 8)
#define FLASH_ACR_ICEN (1u << 9)
#define FLASH_ACR_DCEN (1u << 10)
#define PWR_CR (*(IO *)0x40007000u)

/* ---------------- GPIO ---------------- */
typedef struct {
  IO MODER, OTYPER, OSPEEDR, PUPDR, IDR, ODR, BSRR, LCKR, AFR[2];
} GPIO_t;
#define GPIOA ((GPIO_t *)0x40020000u)
#define GPIOC ((GPIO_t *)0x40020800u)

/* ---------------- TIM6 (basic timer) · 0x4000 1000 ---------------- */
typedef struct {
  IO CR1, CR2, _r0, DIER, SR, EGR, _r1[3], CNT, PSC, ARR;
} TIM_basic_t;
#define TIM6 ((TIM_basic_t *)0x40001000u)
#define TIM_CR1_CEN (1u << 0)
#define TIM_CR2_MMS_UPDATE (2u << 4) // TRGO on update event
#define TIM_EGR_UG (1u << 0)

/* ---------------- DAC · 0x4000 7400 ---------------- */
typedef struct {
  IO CR, SWTRIGR, DHR12R1, DHR12L1, DHR8R1, DHR12R2, DHR12L2, DHR8R2, DHR12RD, DHR12LD, DHR8RD,
      DOR1, DOR2, SR;
} DAC_t;
#define DAC ((DAC_t *)0x40007400u)
#define DAC_CR_EN1 (1u << 0)
#define DAC_CR_TEN1 (1u << 2)
#define DAC_CR_TSEL1_TIM6 (0u << 3)
#define DAC_CR_DMAEN1 (1u << 12)
#define DAC_CR_DMAUDRIE1 (1u << 13)
#define DAC_SR_DMAUDR1 (1u << 13)

/* ---------------- DMA1 · 0x4002 6000 ---------------- */
typedef struct {
  IO LISR, HISR, LIFCR, HIFCR;
} DMA_t;
typedef struct {
  IO CR, NDTR, PAR, M0AR, M1AR, FCR;
} DMA_stream_t;
#define DMA1 ((DMA_t *)0x40026000u)
#define DMA1_STREAM(n) ((DMA_stream_t *)(0x40026010u + 0x18u * (n)))
#define DMA_SxCR_EN (1u << 0)
#define DMA_SxCR_DMEIE (1u << 1)
#define DMA_SxCR_TEIE (1u << 2)
#define DMA_SxCR_TCIE (1u << 4)
#define DMA_SxCR_DIR_M2P (1u << 6)
#define DMA_SxCR_CIRC (1u << 8)
#define DMA_SxCR_MINC (1u << 10)
#define DMA_SxCR_PSIZE_16 (1u << 11)
#define DMA_SxCR_MSIZE_16 (1u << 13)
#define DMA_SxCR_PL_HIGH (2u << 16)
#define DMA_SxCR_CHSEL(c) ((uint32_t)(c) << 25)
// Stream 5 and 6 flags live in HISR/HIFCR: FEIF +0, DMEIF +2, TEIF +3, HTIF +4, TCIF +5
#define DMA_S5_SHIFT 6u
#define DMA_S6_SHIFT 16u
#define DMA_FLAG_DME 2u
#define DMA_FLAG_TE 3u
#define DMA_FLAG_TC 5u
#define DMA_ALL_FLAGS(shift) (0x3Du << (shift))

/* ---------------- USART2 · 0x4000 4400 ---------------- */
typedef struct {
  IO SR, DR, BRR, CR1, CR2, CR3, GTPR;
} USART_t;
#define USART2 ((USART_t *)0x40004400u)
#define USART_CR1_RE (1u << 2)
#define USART_CR1_RXNEIE (1u << 5)
#define USART_SR_RXNE (1u << 5)
#define IRQ_USART2 38u
#define USART_CR1_TE (1u << 3)
#define USART_CR1_UE (1u << 13)
#define USART_CR3_DMAT (1u << 7)

/* ---------------- Cortex-M4 core ---------------- */
#define SYST_CSR (*(IO *)0xE000E010u)
#define SYST_RVR (*(IO *)0xE000E014u)
#define SYST_CVR (*(IO *)0xE000E018u)
#define NVIC_ISER ((IO *)0xE000E100u)
#define SCB_CPACR (*(IO *)0xE000ED88u)
#define DEMCR (*(IO *)0xE000EDFCu)
#define DWT_CTRL (*(IO *)0xE0001000u)
#define DWT_CYCCNT (*(IO *)0xE0001004u)

/* IRQ numbers (RM0390 table 38) */
#define IRQ_DMA1_STREAM5 16u
#define IRQ_TIM6_DAC 54u

static inline void nvic_enable(uint32_t irq) { NVIC_ISER[irq >> 5] = 1u << (irq & 31u); }

#endif
