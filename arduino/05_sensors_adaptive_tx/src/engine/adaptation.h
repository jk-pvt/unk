#ifndef AQUASDR_ADAPTATION_H
#define AQUASDR_ADAPTATION_H

#include "waveform.h"

// Electrical bench policy, NOT a calibrated NTU or validated ocean policy.
// Call update only for a newly acquired sample (nominally every 20 ms).
// The combined sensor image blocks its main loop for display and sensor work, so it widens this window.
#ifndef ADAPT_STALE_MS
#define ADAPT_STALE_MS 100u
#endif
#define ADAPT_SETTLE_MS 60u
typedef struct {
  uint16_t raw;
  float level;
  uint8_t valid, qualified, candidate;
  int8_t profile; // -1 until the first qualified decision
  uint32_t sampled_ms, candidate_ms, decision_ms, decisions;
} adaptation_t;

int adaptation_update_level(adaptation_t *s, float level, int valid, uint32_t now);
void adaptation_init(adaptation_t *s);
int adaptation_update(adaptation_t *s, uint16_t raw, int conversion_ok, uint32_t now);
int adaptation_allowed(const adaptation_t *s, uint32_t now);
wf_config adaptation_waveform(const adaptation_t *s, wf_mode mode);
const char *adaptation_profile_name(int profile);

#endif
