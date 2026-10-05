#ifndef AQUASDR_CAPTURE_H
#define AQUASDR_CAPTURE_H
// On-board capture of the DAC pin: the portable parts (sizing, statistics, wire format).
// The hardware part (ADC3 + TIM8 + DMA2, sampling PA4 through the A2-A5 jumper) lives in the Arduino sketch.
// The result is an MCU ADC CAPTURE. It is NOT an oscilloscope measurement and must never be labelled as one.
#include <stddef.h>
#include <stdint.h>

// Pulse mode: 500 kS/s, 12 ms, enough for pre-roll plus the longest policy pulse (8 ms) with a 42 kHz carrier at ~12 samples per cycle.
// Train mode: 100 kS/s, 160 ms, enough to see two pulses 100 ms apart. At this rate the carrier is close to Nyquist, so only the envelope
// and timing are meaningful, not amplitude or frequency.
#define CAPTURE_PULSE_RATE_HZ 500000u
#define CAPTURE_PULSE_SAMPLES 6000u
#define CAPTURE_TRAIN_RATE_HZ 100000u
#define CAPTURE_TRAIN_SAMPLES 16000u
#define CAPTURE_MAX_SAMPLES CAPTURE_TRAIN_SAMPLES
#define CAPTURE_CHUNK_SAMPLES 600u   // 600 samples = 1800 hex characters per line

typedef enum { CAPTURE_IDLE = 0, CAPTURE_REQUESTED, CAPTURE_RUNNING, CAPTURE_SENDING, CAPTURE_FAILED } capture_state;

typedef struct {
  capture_state state;
  uint32_t id;
  uint8_t mode;               // 0 pulse, 1 train
  uint32_t rate_hz, samples, sent;
  uint16_t min_counts, max_counts;
  uint32_t mean_counts_x10;   // mean ADC counts times ten
  const char *reason;         // empty unless FAILED
} capture_status_t;

uint32_t capture_rate_for_mode(unsigned mode);
uint32_t capture_samples_for_mode(unsigned mode);
const char *capture_state_name(capture_state s);
void capture_stats(const uint16_t *s, size_t n, uint16_t *min_counts, uint16_t *max_counts, uint32_t *mean_x10);
// One newline-terminated JSON line carrying samples [offset, offset+n) as 3 hex digits per 12-bit sample. Returns 0 if cap is too small.
size_t capture_chunk_line(char *out, size_t cap, uint32_t id, unsigned mode, uint32_t rate, uint32_t total, uint32_t offset, const uint16_t *s, size_t n);
// ,"capture":{...} fragment (leading comma) for telemetry.
size_t capture_status_json(const capture_status_t *c, char *out, size_t cap);

#endif
