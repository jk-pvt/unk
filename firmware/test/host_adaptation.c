#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "adaptation.h"

static uint16_t codes[20000];
static void feed(adaptation_t *s, unsigned raw, uint32_t *now, unsigned count) {
  for (unsigned i = 0; i < count; i++, *now += 20) adaptation_update(s, raw, 1, *now);
}

int main(int argc, char **argv) {
  assert(argc == 2);
  adaptation_t s;
  adaptation_init(&s);
  uint32_t now = 0;
  if (!strcmp(argv[1], "startup")) {
    assert(!adaptation_allowed(&s, now));
    feed(&s, 500, &now, 3);
    assert(!adaptation_allowed(&s, now));
    feed(&s, 500, &now, 1);
    assert(s.profile == 0 && s.decisions == 1 && adaptation_allowed(&s, now));
  } else if (!strcmp(argv[1], "profiles")) {
    feed(&s, 500, &now, 20);
    assert(s.profile == 0);
    wf_config clear = adaptation_waveform(&s, WF_LFM);
    feed(&s, 2200, &now, 20);
    assert(s.profile == 1);
    feed(&s, 3700, &now, 20);
    assert(s.profile == 2 && s.decisions == 3);
    wf_config murky = adaptation_waveform(&s, WF_LFM);
    assert(clear.center_khz != murky.center_khz && clear.bandwidth_khz != murky.bandwidth_khz);
    assert(clear.pulse_ms != murky.pulse_ms && clear.amplitude_pct != murky.amplitude_pct);
    feed(&s, 500, &now, 30);
    // The filtered downward ramp qualifies TRANSITION before CLEAR.
    assert(s.profile == 0 && s.decisions == 5);
  } else if (!strcmp(argv[1], "hysteresis")) {
    feed(&s, 500, &now, 20);
    for (unsigned i = 0; i < 200; i++) feed(&s, i % 2 ? 1515 : 1433, &now, 1);
    assert(s.profile == 0 && s.decisions == 1);
    feed(&s, 2200, &now, 20);
    for (unsigned i = 0; i < 200; i++) feed(&s, i % 2 ? 1351 : 1433, &now, 1);
    assert(s.profile == 1 && s.decisions == 2);
  } else if (!strcmp(argv[1], "invalid")) {
    feed(&s, 500, &now, 10);
    const unsigned bad[] = {0, 12, 4083, 4095};
    for (unsigned i = 0; i < 4; i++) {
      adaptation_update(&s, bad[i], 1, now);
      assert(!adaptation_allowed(&s, now));
      now += 20;
      feed(&s, 500, &now, 3);
      assert(!adaptation_allowed(&s, now));
      feed(&s, 500, &now, 1);
      assert(adaptation_allowed(&s, now));
    }
    adaptation_update(&s, 500, 0, now);
    assert(!adaptation_allowed(&s, now));
  } else if (!strcmp(argv[1], "stale")) {
    feed(&s, 2200, &now, 10);
    assert(!adaptation_allowed(&s, now + 101));
    now += 200;
    feed(&s, 2200, &now, 3);
    assert(!adaptation_allowed(&s, now));
    feed(&s, 2200, &now, 1);
    assert(adaptation_allowed(&s, now));
  } else if (!strcmp(argv[1], "wrap")) {
    now = UINT32_MAX - 40;
    feed(&s, 500, &now, 5);
    assert(s.decisions == 1 && adaptation_allowed(&s, now));
    assert(!adaptation_allowed(&s, now + 101));
  } else if (!strcmp(argv[1], "waveforms")) {
    wf_init();
    for (int p = 0; p < 3; p++) {
      s.profile = p;
      for (int m = 0; m < 3; m++) {
        wf_config c = adaptation_waveform(&s, (wf_mode)m);
        assert(c.mode == (wf_mode)m);
        size_t n = wf_synthesize(&c, 1000000, codes, 20000);
        assert(n == (size_t)(c.pulse_ms * 1000));
        unsigned lo = 4095, hi = 0;
        for (size_t i = 0; i < n; i++) {
          assert(codes[i] <= 4095);
          if (codes[i] < lo) lo = codes[i];
          if (codes[i] > hi) hi = codes[i];
        }
        assert(hi > 2048 && lo < 2048);
        assert(abs((int)codes[0] - 2048) <= 1 && abs((int)codes[n-1] - 2048) <= 1);
      }
    }
    assert(adaptation_waveform(&s, WF_CW).mode == WF_LFM);
  } else return 2;
  puts("ok");
  return 0;
}
