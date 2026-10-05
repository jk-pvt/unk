#include "waveform.h"

#include <math.h>

#define LUT_BITS 10u
#define LUT_SIZE (1u << LUT_BITS)
#define FRAC_BITS (32u - LUT_BITS)
#define QUARTER_TURN 0x40000000u
#define HALF_TURN 0x80000000u

// One full sine cycle plus a guard entry for interpolation.
static float sine_lut[LUT_SIZE + 1];

static const int8_t BARKER13[13] = {1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1};

void wf_init(void) {
  for (uint32_t i = 0; i <= LUT_SIZE; i++)
    sine_lut[i] = (float)sin(6.283185307179586 * (double)i / (double)LUT_SIZE);
}

static inline float wf_sin(uint32_t phase) {
  uint32_t i = phase >> FRAC_BITS;
  float f = (float)(phase & ((1u << FRAC_BITS) - 1u)) * (1.0f / (float)(1u << FRAC_BITS));
  return sine_lut[i] + (sine_lut[i + 1] - sine_lut[i]) * f;
}

static inline float wf_cos(uint32_t phase) { return wf_sin(phase + QUARTER_TURN); }

static uint32_t tuning_word(double hz, uint32_t fs) {
  return (uint32_t)(hz / (double)fs * 4294967296.0 + 0.5);
}

static float clampf(float v, float lo, float hi, float fallback) {
  if (v != v) return fallback; // NaN
  return v < lo ? lo : v > hi ? hi : v;
}

wf_config wf_clamp(wf_config c, uint32_t fs) {
  c.pulse_ms = clampf(c.pulse_ms, 0.1f, 20.0f, 8.0f);
  c.center_khz = clampf(c.center_khz, 20.0f, 350.0f, 40.0f);
  c.bandwidth_khz = clampf(c.bandwidth_khz, 0.5f, 99.0f, 2.0f);
  c.amplitude_pct = clampf(c.amplitude_pct, 0.0f, 100.0f, 62.0f);
  float top = (float)fs / 4000.0f;
  if (c.center_khz + c.bandwidth_khz / 2.0f > top) c.center_khz = top - c.bandwidth_khz / 2.0f;
  if (c.center_khz - c.bandwidth_khz / 2.0f < 1.0f) c.bandwidth_khz = 2.0f * (c.center_khz - 1.0f);
  return c;
}

size_t wf_samples_for(const wf_config *c, uint32_t fs) {
  return (size_t)((double)c->pulse_ms / 1000.0 * (double)fs + 0.5);
}

static float window_at(wf_window w, uint32_t ph) {
  switch (w) {
    case WF_WIN_HANN: return 0.5f - 0.5f * wf_cos(ph);
    case WF_WIN_HAMMING: return 0.54f - 0.46f * wf_cos(ph);
    case WF_WIN_BLACKMAN: return 0.42f - 0.5f * wf_cos(ph) + 0.08f * wf_cos(ph * 2u);
    default: return 1.0f;
  }
}

static inline uint16_t to_code(float v, float gain) {
  float x = v * gain;
  int32_t code = WF_DAC_MID + (int32_t)(x >= 0.0f ? x + 0.5f : x - 0.5f);
  return (uint16_t)code;
}

size_t wf_synthesize(const wf_config *in, uint32_t fs, uint16_t *out, size_t max) {
  wf_config c = wf_clamp(*in, fs);
  size_t n = wf_samples_for(&c, fs);
  if (n > max) n = max;
  if (n < 2) return 0;

  const double f0 = ((double)c.center_khz - (double)c.bandwidth_khz / 2.0) * 1000.0;
  const double f1 = ((double)c.center_khz + (double)c.bandwidth_khz / 2.0) * 1000.0;
  const float gain = c.amplitude_pct / 100.0f * (float)WF_DAC_HALF;
  // Window phase runs 0 → one full turn across the pulse, i.e. x = i / (n - 1).
  const uint32_t wstep = (uint32_t)((((uint64_t)1) << 32) / (uint64_t)(n - 1));
  uint32_t wphase = 0, phase = 0;

  if (c.mode == WF_LFM) {
    // Instantaneous tuning word ramps linearly; sampling it at k + 0.5 makes
    // the accumulated phase equal the closed-form chirp 2π(f0·t + Δf·t²/2T).
    const int64_t tw0 = tuning_word(f0, fs), tw1 = tuning_word(f1, fs);
    const int64_t step = ((tw1 - tw0) * 65536) / (int64_t)n;
    int64_t acc = tw0 * 65536 + step / 2;
    for (size_t i = 0; i < n; i++, wphase += wstep) {
      out[i] = to_code(wf_sin(phase) * window_at(c.window, wphase), gain);
      phase += (uint32_t)(acc >> 16);
      acc += step;
    }
  } else if (c.mode == WF_GEOMETRIC) {
    // Frequency grows by a constant ratio per sample. Scaling the start by
    // (r − 1)/ln r makes the summed phase equal the closed form
    // 2π·f0·(e^{kt} − 1)/k used by the dashboard.
    const double r = pow(f1 / f0, 1.0 / (double)n);
    double tw = f0 * (r - 1.0) / log(r) / (double)fs * 4294967296.0;
    for (size_t i = 0; i < n; i++, wphase += wstep) {
      out[i] = to_code(wf_sin(phase) * window_at(c.window, wphase), gain);
      phase += (uint32_t)(tw + 0.5);
      tw *= r;
    }
  } else {
    // Phase-coded: Barker-13 flips the carrier by π per chip. CW: no flips.
    const uint32_t tw = tuning_word((double)c.center_khz * 1000.0, fs);
    for (size_t i = 0; i < n; i++, wphase += wstep) {
      uint32_t flip = 0;
      if (c.mode == WF_PHASE_CODED) {
        size_t chip = i * 13u / n;
        if (BARKER13[chip > 12 ? 12 : chip] < 0) flip = HALF_TURN;
      }
      out[i] = to_code(wf_sin(phase + flip) * window_at(c.window, wphase), gain);
      phase += tw;
    }
  }
  return n;
}

size_t wf_cw_cycle(float freq_khz, float amplitude_pct, uint32_t fs, uint16_t *out, size_t max,
                   float *actual_khz) {
  const double per = (double)fs / ((double)freq_khz * 1000.0); // samples per cycle
  uint32_t cycles = 1;
  size_t n = (size_t)(per + 0.5);
  // Prefer the fewest cycles that land on a whole number of samples.
  for (uint32_t k = 1; k <= 64; k++) {
    double exact = per * k;
    size_t m = (size_t)(exact + 0.5);
    if (m > max) break;
    if (fabs(exact - (double)m) < 1e-6 * exact) {
      cycles = k;
      n = m;
      break;
    }
  }
  if (n > max) n = max;
  if (n < 2) return 0;
  const float gain = clampf(amplitude_pct, 0.0f, 100.0f, 62.0f) / 100.0f * (float)WF_DAC_HALF;
  for (size_t i = 0; i < n; i++) {
    uint32_t phase = (uint32_t)((((uint64_t)i * cycles) << 32) / n);
    out[i] = to_code(wf_sin(phase), gain);
  }
  if (actual_khz) *actual_khz = (float)((double)cycles * fs / (double)n / 1000.0);
  return n;
}

const char *wf_mode_name(wf_mode m) {
  switch (m) {
    case WF_LFM: return "LFM CHIRP";
    case WF_GEOMETRIC: return "GEOMETRIC SWEEP";
    case WF_PHASE_CODED: return "PHASE-CODED PULSE";
    default: return "CW";
  }
}

const char *wf_window_name(wf_window w) {
  switch (w) {
    case WF_WIN_HANN: return "HANN";
    case WF_WIN_HAMMING: return "HAMMING";
    case WF_WIN_BLACKMAN: return "BLACKMAN";
    default: return "RECT";
  }
}
