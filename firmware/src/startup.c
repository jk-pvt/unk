// Reset handler and vector table for the STM32F446RE.
#include <stdint.h>

#include "regs.h"

extern uint32_t _sidata, _sdata, _edata, _sbss, _ebss, _estack;
int main(void);

void Reset_Handler(void) {
  // Enable the FPU (CP10/CP11 full access) before any float code runs.
  SCB_CPACR |= 0xFu << 20;
  __asm volatile("dsb\n isb");
  for (uint32_t *src = &_sidata, *dst = &_sdata; dst < &_edata;) *dst++ = *src++;
  for (uint32_t *dst = &_sbss; dst < &_ebss;) *dst++ = 0;
  main();
  for (;;) {
  }
}

void Default_Handler(void) {
  for (;;) {
  }
}

#define WEAK_ALIAS __attribute__((weak, alias("Default_Handler")))
void NMI_Handler(void) WEAK_ALIAS;
void HardFault_Handler(void) WEAK_ALIAS;
void MemManage_Handler(void) WEAK_ALIAS;
void BusFault_Handler(void) WEAK_ALIAS;
void UsageFault_Handler(void) WEAK_ALIAS;
void SVC_Handler(void) WEAK_ALIAS;
void DebugMon_Handler(void) WEAK_ALIAS;
void PendSV_Handler(void) WEAK_ALIAS;
void SysTick_Handler(void) WEAK_ALIAS;
void DMA1_Stream5_IRQHandler(void) WEAK_ALIAS;
void TIM6_DAC_IRQHandler(void) WEAK_ALIAS;
void USART2_IRQHandler(void) WEAK_ALIAS;

typedef void (*vector_t)(void);

// 16 core exceptions + 97 peripheral interrupts on the F446.
__attribute__((section(".isr_vector"), used)) const vector_t vector_table[16 + 97] = {
    [0] = (vector_t)&_estack,
    [1] = Reset_Handler,
    [2] = NMI_Handler,
    [3] = HardFault_Handler,
    [4] = MemManage_Handler,
    [5] = BusFault_Handler,
    [6] = UsageFault_Handler,
    [11] = SVC_Handler,
    [12] = DebugMon_Handler,
    [14] = PendSV_Handler,
    [15] = SysTick_Handler,
    [16 ... 16 + 96] = Default_Handler,
    [16 + IRQ_DMA1_STREAM5] = DMA1_Stream5_IRQHandler,
    [16 + IRQ_USART2] = USART2_IRQHandler,
    [16 + IRQ_TIM6_DAC] = TIM6_DAC_IRQHandler,
};
