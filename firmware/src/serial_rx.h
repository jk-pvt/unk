#ifndef AQUASDR_SERIAL_RX_H
#define AQUASDR_SERIAL_RX_H
#include <stdint.h>
#define RX_CAPACITY 1024u
typedef struct {
  volatile uint32_t head, tail;
  volatile uint8_t corrupt, dropping;
  uint8_t bytes[RX_CAPACITY];
} serial_rx;
// Single ISR producer. An error poisons the partial command through newline.
static inline void serial_rx_push(serial_rx *r, uint8_t byte, int error) {
  if(error) { r->corrupt=r->dropping=1; return; }
  if(r->dropping && byte!='\n') return;
  if(byte=='\n') r->dropping=0;
  uint32_t next=(r->head+1u)%RX_CAPACITY;
  if(next==r->tail) { r->corrupt=r->dropping=1; return; }
  r->bytes[r->head]=byte; r->head=next;
}
// Called with the RX interrupt masked when corrupt is set.
static inline void serial_rx_discard(serial_rx *r) { r->tail=r->head; r->corrupt=0; }
static inline int serial_rx_pop(serial_rx *r, uint8_t *byte) {
  if(r->tail==r->head)return 0;
  *byte=r->bytes[r->tail]; r->tail=(r->tail+1u)%RX_CAPACITY;return 1;
}
#endif
