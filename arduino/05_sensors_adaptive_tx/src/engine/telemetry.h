#ifndef AQUASDR_TELEMETRY_H
#define AQUASDR_TELEMETRY_H

#include <stddef.h>
#include <stdint.h>

#include "config.h"
#include "waveform.h"
#include "adaptation.h"
#include "control.h"
#include "capture.h"

// Longest packet this formatter can produce is well under this; the host
// test checks the worst case.
#define TELEMETRY_MAX 3072

typedef struct {
  const control_t *control;
  uint32_t seq;
  uint32_t uptime_ms;
  const wf_config *waveform; // NULL when the output has no dashboard mode (CW)
  uint32_t sample_rate_hz;
  uint8_t cw;
  float cw_khz;
  uint32_t dma_buffer; // samples per pulse (or per CW loop)
  uint32_t dma_faults; // DMA errors + DAC underruns
  uint32_t underruns;
  float cpu_load; // percent
  unsigned step, step_count;
  const char *step_label; // max ~40 characters so "firmware" stays under 80
  const adaptation_t *adaptation; // NULL in the original bring-up build
  const capture_status_t *capture; // NULL unless the image supports DAC capture
  uint32_t applied_decision, decision_to_output_ms;
  uint8_t has_applied, inhibited, pending;
} telemetry_t;

// Comma-prefixed adaptive fields (waveform, requestedWaveform, identity, environment, control, adc, applicationAck).
// Used by telemetry_format and by the combined sensor image, which writes its own sensor and health blocks.
size_t telemetry_adaptive_fields(const telemetry_t *t, char *out, size_t cap);

// Writes one newline-terminated JSON packet; out must hold TELEMETRY_MAX bytes.
size_t telemetry_format(const telemetry_t *t, char *out);

#endif
