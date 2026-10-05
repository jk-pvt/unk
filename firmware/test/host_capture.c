// Prints capture wire-format lines so tests/capture-firmware.test.js can parse them with the bridge's own parser.
#include "capture.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
  assert(argc >= 2);
  static uint16_t s[CAPTURE_MAX_SAMPLES];
  for (size_t i = 0; i < CAPTURE_MAX_SAMPLES; i++) s[i] = (uint16_t)((i * 37u + (i >> 3)) & 0x0FFFu);   // deterministic, spans the 12-bit range
  if (!strcmp(argv[1], "sizes")) {
    printf("%lu %lu %lu %lu %lu %lu\n", (unsigned long)capture_rate_for_mode(0), (unsigned long)capture_samples_for_mode(0),
           (unsigned long)capture_rate_for_mode(1), (unsigned long)capture_samples_for_mode(1), (unsigned long)CAPTURE_CHUNK_SAMPLES, (unsigned long)CAPTURE_MAX_SAMPLES);
  } else if (!strcmp(argv[1], "chunks")) {   // the whole pulse-mode capture, chunked exactly as the sketch does
    char line[4096]; uint32_t total = capture_samples_for_mode(0), rate = capture_rate_for_mode(0);
    for (uint32_t off = 0; off < total; off += CAPTURE_CHUNK_SAMPLES) {
      uint32_t n = total - off < CAPTURE_CHUNK_SAMPLES ? total - off : CAPTURE_CHUNK_SAMPLES;
      size_t len = capture_chunk_line(line, sizeof line, 7, 0, rate, total, off, s + off, n); assert(len);
      fwrite(line, 1, len, stdout);
    }
  } else if (!strcmp(argv[1], "toosmall")) {
    char line[100]; assert(capture_chunk_line(line, sizeof line, 1, 0, 500000, 6000, 0, s, CAPTURE_CHUNK_SAMPLES) == 0); puts("ok");
  } else if (!strcmp(argv[1], "stats")) {
    uint16_t a[5] = {100, 4095, 0, 2000, 0x1FFF}; uint16_t lo, hi; uint32_t m;   // 0x1FFF must be masked to 12 bits (4095)
    capture_stats(a, 5, &lo, &hi, &m); printf("%u %u %lu\n", lo, hi, (unsigned long)m);
    capture_stats(a, 0, &lo, &hi, &m); printf("%u %u %lu\n", lo, hi, (unsigned long)m);
  } else if (!strcmp(argv[1], "status")) {
    capture_status_t c = {.state = CAPTURE_SENDING, .id = 3, .mode = 1, .rate_hz = 100000, .samples = 16000, .sent = 1200, .min_counts = 5, .max_counts = 4090, .mean_counts_x10 = 20487, .reason = ""};
    char out[400]; size_t n = capture_status_json(&c, out, sizeof out); assert(n); printf("{%s}\n", out + 1);
  }
  return 0;
}
