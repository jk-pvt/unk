// Pulse synthesis for the AquaSDR transmit engine.
//
// Portable C with no hardware access: the firmware calls it to fill DAC
// buffers, and firmware/test/host_twin.c runs the same code on a PC so
// tests/firmware-twin.test.js can check it sample-for-sample against the
// dashboard model in shared/signal.js.
//
// Synthesis is a 32-bit phase-accumulator DDS reading a sine table built
// once at boot, so no trigonometric function runs per sample.
#ifndef AQUASDR_WAVEFORM_H
#define AQUASDR_WAVEFORM_H

#include <stddef.h>
#include <stdint.h>

typedef enum { WF_LFM = 0, WF_GEOMETRIC, WF_PHASE_CODED, WF_CW } wf_mode;
typedef enum { WF_WIN_RECT = 0, WF_WIN_HANN, WF_WIN_HAMMING, WF_WIN_BLACKMAN } wf_window;

// Units match the dashboard's waveform editor.
typedef struct {
  wf_mode mode;
  float center_khz;
  float bandwidth_khz; // sweep width; unused by phase-coded and CW
  float pulse_ms;
  float amplitude_pct; // of DAC half-scale
  wf_window window;
} wf_config;

// 12-bit DAC, mid-scale is "zero" (1.65 V with a 3.3 V reference).
#define WF_DAC_MID 2048
#define WF_DAC_HALF 2047

void wf_init(void);

// Same limits as generateSignal() in shared/signal.js, plus one
// firmware-only guard: the sweep stays between 1 kHz and fs/4.
wf_config wf_clamp(wf_config c, uint32_t sample_rate);

size_t wf_samples_for(const wf_config *c, uint32_t sample_rate);

// Fills out[] with DAC codes for one pulse. Returns the sample count.
size_t wf_synthesize(const wf_config *c, uint32_t sample_rate, uint16_t *out, size_t max);

// Fills out[] with a whole number of carrier cycles for a circular
// (continuous) CW stream. Returns the sample count and reports the exact
// frequency those samples produce.
size_t wf_cw_cycle(float freq_khz, float amplitude_pct, uint32_t sample_rate, uint16_t *out,
                   size_t max, float *actual_khz);

const char *wf_mode_name(wf_mode m);
const char *wf_window_name(wf_window w);

#endif
