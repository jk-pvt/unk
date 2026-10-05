#include "capture.h"
#include <stdio.h>

uint32_t capture_rate_for_mode(unsigned mode) { return mode ? CAPTURE_TRAIN_RATE_HZ : CAPTURE_PULSE_RATE_HZ; }
uint32_t capture_samples_for_mode(unsigned mode) { return mode ? CAPTURE_TRAIN_SAMPLES : CAPTURE_PULSE_SAMPLES; }
const char *capture_state_name(capture_state s) {
  switch (s) {
    case CAPTURE_REQUESTED: return "REQUESTED";
    case CAPTURE_RUNNING: return "RUNNING";
    case CAPTURE_SENDING: return "SENDING";
    case CAPTURE_FAILED: return "FAILED";
    default: return "IDLE";
  }
}
void capture_stats(const uint16_t *s, size_t n, uint16_t *mn, uint16_t *mx, uint32_t *mean_x10) {
  uint16_t lo = 4095, hi = 0; uint64_t sum = 0;
  for (size_t i = 0; i < n; i++) { uint16_t v = (uint16_t)(s[i] & 0x0FFFu); if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
  if (!n) { lo = 0; }
  *mn = lo; *mx = hi; *mean_x10 = n ? (uint32_t)((sum * 10u + n / 2u) / n) : 0;
}
size_t capture_chunk_line(char *out, size_t cap, uint32_t id, unsigned mode, uint32_t rate, uint32_t total, uint32_t offset, const uint16_t *s, size_t n) {
  int h = snprintf(out, cap, "{\"version\":1,\"type\":\"capture\",\"id\":%lu,\"mode\":%u,\"rate\":%lu,\"total\":%lu,\"offset\":%lu,\"n\":%lu,\"d\":\"",
                   (unsigned long)id, mode, (unsigned long)rate, (unsigned long)total, (unsigned long)offset, (unsigned long)n);
  if (h <= 0 || (size_t)h + n * 3u + 4u > cap) return 0;
  static const char hex[] = "0123456789ABCDEF";
  char *p = out + h;
  for (size_t i = 0; i < n; i++) { uint16_t v = (uint16_t)(s[i] & 0x0FFFu); *p++ = hex[v >> 8]; *p++ = hex[(v >> 4) & 15u]; *p++ = hex[v & 15u]; }
  *p++ = '"'; *p++ = '}'; *p++ = '\n'; *p = 0;
  return (size_t)(p - out);
}
size_t capture_status_json(const capture_status_t *c, char *out, size_t cap) {
  int n = snprintf(out, cap, ",\"capture\":{\"state\":\"%s\",\"id\":%lu,\"mode\":%u,\"rateHz\":%lu,\"samples\":%lu,\"sent\":%lu,\"minCounts\":%u,\"maxCounts\":%u,\"meanCounts\":%lu.%lu,\"reason\":\"%s\"}",
                   capture_state_name(c->state), (unsigned long)c->id, c->mode, (unsigned long)c->rate_hz, (unsigned long)c->samples, (unsigned long)c->sent,
                   c->min_counts, c->max_counts, (unsigned long)(c->mean_counts_x10 / 10u), (unsigned long)(c->mean_counts_x10 % 10u), c->reason ? c->reason : "");
  return n > 0 && (size_t)n < cap ? (size_t)n : 0;
}
