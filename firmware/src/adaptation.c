#include "adaptation.h"

void adaptation_init(adaptation_t *s) {
  *s = (adaptation_t){.profile = -1, .candidate = 255};
}

int adaptation_allowed(const adaptation_t *s, uint32_t now) {
  return s->valid && s->qualified && (uint32_t)(now - s->sampled_ms) <= ADAPT_STALE_MS;
}

int adaptation_update(adaptation_t *s, uint16_t raw, int conversion_ok, uint32_t now) {
  s->raw = raw;
  return adaptation_update_level(s, (float)raw * 100.0f / 4095.0f,
                                 conversion_ok && raw > 12 && raw < 4083, now);
}

int adaptation_update_level(adaptation_t *s, float level, int valid, uint32_t now) {
  int continuous = s->valid && (uint32_t)(now - s->sampled_ms) <= ADAPT_STALE_MS;
  s->sampled_ms = now;
  // Rail values are not trusted. This does NOT detect all disconnected inputs;
  // the bench input must be wired and its voltage independently checked.
  if (!valid || !(level >= 0 && level <= 100)) {
    s->valid = s->qualified = 0;
    s->candidate = 255;
    return 0;
  }
  s->level = continuous ? s->level + (level - s->level) * 0.25f : level;
  if (!continuous) {
    s->qualified = 0;
    s->candidate = 255;
  }
  s->valid = 1;
  int next;
  if (s->profile < 0 || !s->qualified) next = s->level < 35 ? 0 : s->level < 70 ? 1 : 2;
  else if (s->profile == 0) next = s->level >= 75 ? 2 : s->level >= 40 ? 1 : 0;
  else if (s->profile == 1) next = s->level < 30 ? 0 : s->level >= 75 ? 2 : 1;
  else next = s->level < 30 ? 0 : s->level < 65 ? 1 : 2;
  if (next != s->candidate) {
    s->candidate = (uint8_t)next;
    s->candidate_ms = now;
  }
  if ((!s->qualified || next != s->profile) &&
      (uint32_t)(now - s->candidate_ms) >= ADAPT_SETTLE_MS) {
    s->profile = (int8_t)next;
    s->qualified = 1;
    s->decision_ms = now;
    s->decisions++;
    return 1;
  }
  return 0;
}

wf_config adaptation_waveform(const adaptation_t *s, wf_mode mode) {
  static const wf_config profiles[] = {
    {WF_LFM, 42, 4, 2, 35, WF_WIN_HANN},
    {WF_LFM, 40, 2, 4, 50, WF_WIN_HANN},
    {WF_LFM, 38, 1, 8, 62, WF_WIN_HANN},
  };
  wf_config c = profiles[s->profile >= 0 && s->profile <= 2 ? s->profile : 0];
  c.mode = (unsigned)mode <= (unsigned)WF_PHASE_CODED ? mode : WF_LFM;
  return c;
}

const char *adaptation_profile_name(int profile) {
  return profile == 0 ? "CLEAR" : profile == 1 ? "TRANSITION" : profile == 2 ? "MURKY" : "UNQUALIFIED";
}
