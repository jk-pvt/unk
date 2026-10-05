// Prints representative firmware telemetry packets, one per line, so
// tests/firmware-telemetry.test.js can feed them to the bridge's parser.
#include <stdio.h>
#include <string.h>

#include "telemetry.h"

static char out[TELEMETRY_MAX];

static void emit(const telemetry_t *t) {
  size_t n = telemetry_format(t, out);
  if (n >= TELEMETRY_MAX) {
    fprintf(stderr, "packet overflow: %zu bytes\n", n);
    return;
  }
  fwrite(out, 1, n, stdout);
}

int main(void) {
  wf_config lfm = {WF_LFM, 40.0f, 2.0f, 2.0f, 62.0f, WF_WIN_HANN};
  wf_config bark = {WF_PHASE_CODED, 40.0f, 2.0f, 8.0f, 30.0f, WF_WIN_BLACKMAN};
  telemetry_t pulsed = {.seq = 1, .uptime_ms = 1234, .waveform = &lfm, .sample_rate_hz = 1000000u,
                        .dma_buffer = 2000, .cpu_load = 0.37f, .step = 3, .step_count = 7,
                        .step_label = "LFM + Hann window"};
  emit(&pulsed);
  telemetry_t cw = {.seq = 2, .uptime_ms = 59999, .sample_rate_hz = 1000000u, .cw = 1, .cw_khz = 40.0f,
                    .dma_buffer = 25, .cpu_load = 0.0f, .step = 1, .step_count = 7,
                    .step_label = "CW 40 kHz continuous"};
  emit(&cw);
  // Worst case for length: every field at its widest.
  telemetry_t worst = {.seq = 4294967295u, .uptime_ms = 2591999999u, .waveform = &bark,
                       .sample_rate_hz = 1000000u, .dma_buffer = 20000, .dma_faults = 4294967295u,
                       .underruns = 4294967295u, .cpu_load = 100.0f, .step = 7, .step_count = 7,
                       .step_label = "Barker-13 phase-coded + Hann"};
  emit(&worst);
  adaptation_t a;
  adaptation_init(&a);
  telemetry_t adaptive = pulsed;
  adaptive.adaptation = &a;
  adaptive.inhibited = 1;
  adaptive.uptime_ms = 0;
  adaptive.step_label = "ADC adaptive bench";
  adaptive.waveform = 0;
  emit(&adaptive);
  for (uint32_t now = 1; now <= 61; now += 20) adaptation_update(&a, 3500, 1, now);
  wf_config selected = adaptation_waveform(&a, WF_LFM);
  adaptive.waveform = &selected;
  adaptive.inhibited = 0;
  adaptive.uptime_ms = 100;
  adaptive.has_applied = 1;
  adaptive.applied_decision = a.decisions;
  adaptive.decision_to_output_ms = 39;
  emit(&adaptive);
  adaptation_update(&a, 4095, 1, 110);
  adaptive.inhibited = 1;
  adaptive.uptime_ms = 110;
  emit(&adaptive);
  return 0;
}
