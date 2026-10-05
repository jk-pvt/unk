// JSON telemetry in the packet format the dashboard bridge accepts
// (packetSchema in shared/protocol.js). No hardware access, so
// tests/firmware-telemetry.test.js can run it on a PC and parse the output
// with the bridge's own parser.
#include "telemetry.h"

static char *put_str(char *p, const char *s) {
  while (*s) *p++ = *s++;
  return p;
}

static char *put_u32(char *p, uint32_t v) {
  char tmp[10];
  int n = 0;
  do tmp[n++] = (char)('0' + v % 10u);
  while ((v /= 10u) != 0);
  while (n) *p++ = tmp[--n];
  return p;
}

static char *put_2(char *p, uint32_t v) {
  *p++ = (char)('0' + v / 10u % 10u);
  *p++ = (char)('0' + v % 10u);
  return p;
}

static char *put_fixed(char *p, float v, unsigned decimals) {
  uint32_t scale = 1;
  for (unsigned i = 0; i < decimals; i++) scale *= 10u;
  if (v < 0) {
    *p++ = '-';
    v = -v;
  }
  uint32_t x = (uint32_t)(v * (float)scale + 0.5f);
  p = put_u32(p, x / scale);
  if (decimals) {
    *p++ = '.';
    for (uint32_t d = scale / 10u; d; d /= 10u) *p++ = (char)('0' + (x % scale) / d % 10u);
  }
  return p;
}

// The board has no real-time clock, so the timestamp is time since boot on
// a repeating 28-day month on the 1970 epoch. This stays valid JSON/ISO after
// January 31; the bridge judges freshness by receive time, not this timestamp.
static char *put_uptime(char *p, uint32_t t) {
  p = put_str(p, "\"1970-01-");
  p = put_2(p, 1u + (t / 86400000u) % 28u);
  *p++ = 'T';
  p = put_2(p, t / 3600000u % 24u);
  *p++ = ':';
  p = put_2(p, t / 60000u % 60u);
  *p++ = ':';
  p = put_2(p, t / 1000u % 60u);
  *p++ = '.';
  p = put_2(p, t % 1000u / 10u);
  *p++ = (char)('0' + t % 10u);
  return put_str(p, "Z\"");
}

// Adaptive-transmitter fields shared by the bare-metal packet and the combined sensor image: the applied and
// requested waveform, the self-describing identity and the control/ADC blocks. Each field starts with a comma.
size_t telemetry_adaptive_fields(const telemetry_t *t, char *out, size_t cap) {
  char *p = out;
  if (t->waveform) {
    const wf_config *w = t->waveform;
    p = put_str(p, ",\"waveform\":{\"mode\":\"");
    p = put_str(p, wf_mode_name(w->mode));
    p = put_str(p, "\",\"frequency\":");
    p = put_fixed(p, w->center_khz, 2);
    p = put_str(p, ",\"bandwidth\":");
    p = put_fixed(p, w->bandwidth_khz, 2);
    p = put_str(p, ",\"pulse\":");
    p = put_fixed(p, w->pulse_ms, 2);
    p = put_str(p, ",\"amplitude\":");
    p = put_fixed(p, w->amplitude_pct, 1);
    p = put_str(p, ",\"window\":\"");
    p = put_str(p, wf_window_name(w->window));
    p = put_str(p, "\"}");
  }
  if (t->control && t->control->policy.qualified) {
    const wf_config *w = &t->control->requested;
    p = put_str(p, ",\"requestedWaveform\":{\"mode\":\"");
    p = put_str(p, wf_mode_name(w->mode));
    p = put_str(p, "\",\"frequency\":");
    p = put_fixed(p, w->center_khz, 2);
    p = put_str(p, ",\"bandwidth\":");
    p = put_fixed(p, w->bandwidth_khz, 2);
    p = put_str(p, ",\"pulse\":");
    p = put_fixed(p, w->pulse_ms, 2);
    p = put_str(p, ",\"amplitude\":");
    p = put_fixed(p, w->amplitude_pct, 1);
    p = put_str(p, ",\"window\":\"");
    p = put_str(p, wf_window_name(w->window));
    p = put_str(p, "\"}");
  }
  if (t->control)
    p = put_str(p, ",\"identity\":{\"id\":\"AQUASDR_ADAPTIVE\",\"version\":\"" FW_SEMVER "\",\"build\":\"" FW_BUILD
                   "\",\"platform\":\"" FW_PLATFORM "\",\"capabilities\":[\"TIM6_DMA_DAC1_PA4\",\"ADC_A0\",\"WEB_CONTROL\",\"LFM\",\"GEOMETRIC\",\"PHASE_CODED\",\"WINDOWS\""
#ifdef AQUASDR_CAPTURE
                   ",\"DAC_CAPTURE\""
#endif
                   "]}");
  if (t->control) p += control_json(t->control, t->uptime_ms, p, cap - (size_t)(p-out));
  if (t->capture) p += capture_status_json(t->capture, p, cap - (size_t)(p - out));
  return (size_t)(p - out);
}

size_t telemetry_format(const telemetry_t *t, char *out) {
  char *p = out;
  p = put_str(p, "{\"version\":1,\"type\":\"telemetry\",\"source\":\"hardware\",\"seq\":");
  p = put_u32(p, t->seq);
  p = put_str(p, ",\"timestamp\":");
  p = put_uptime(p, t->uptime_ms);
  p = put_str(p, ",\"payload\":{\"firmwareMode\":\"");
  p = put_str(p, t->control ? "ADAPTIVE_TRANSMITTER" : "BRINGUP");
  p = put_str(p,
              "\",\"sensors\":{\"temperature\":null,\"turbidity\":null,\"pressure\":null,"
              "\"depth\":null,\"conductivity\":null},"
              "\"power\":{\"voltage\":null,\"current\":null,\"watts\":null,\"energy\":null}");
  p += telemetry_adaptive_fields(t, p, TELEMETRY_MAX - (size_t)(p - out));
  if (t->adaptation) {
    const adaptation_t *a = t->adaptation;
    p = put_str(p, ",\"adaptation\":{\"source\":\"ADC_DIAL\",\"inputPin\":\"PA0/A0\",\"raw\":");
    p = put_u32(p, a->raw);
    p = put_str(p, ",\"inputVolts\":");
    p = a->valid ? put_fixed(p, (float)a->raw * 3.3f / 4095.0f, 3) : put_str(p, "null");
    p = put_str(p, ",\"levelPercent\":");
    p = a->valid ? put_fixed(p, a->level, 2) : put_str(p, "null");
    p = put_str(p, ",\"inputValid\":");
    p = put_str(p, a->valid && (uint32_t)(t->uptime_ms - a->sampled_ms) <= ADAPT_STALE_MS ? "true" : "false");
    p = put_str(p, ",\"profile\":\"");
    p = put_str(p, adaptation_profile_name(a->profile));
    p = put_str(p, "\",\"state\":\"");
    p = put_str(p, t->inhibited ? "INHIBITED" : t->pending ? "PENDING" : "APPLIED");
    p = put_str(p, "\",\"decisionId\":");
    p = put_u32(p, a->decisions);
    p = put_str(p, ",\"appliedDecisionId\":");
    p = put_u32(p, t->applied_decision);
    p = put_str(p, ",\"decisionToOutputMs\":");
    p = t->has_applied ? put_u32(p, t->decision_to_output_ms) : put_str(p, "null");
    p = put_str(p, "}");
  }
  p = put_str(p, ",\"health\":{\"STM32\":\"ONLINE 168 MHz\",\"TIMER\":\"");
  p = put_str(p, t->inhibited ? "INHIBITED TIM6 " : "ACTIVE TIM6 ");
  p = put_fixed(p, (float)t->sample_rate_hz / 1e6f, 3);
  p = put_str(p, " MHz\",\"DMA\":\"");
  if (t->dma_faults) {
    p = put_str(p, "FAULT ");
    p = put_u32(p, t->dma_faults);
  } else {
    p = put_str(p, t->inhibited ? "INHIBITED" : t->cw ? "ACTIVE CIRCULAR" : "ACTIVE BURST");
  }
  p = put_str(p, "\",\"DAC\":\"");
  p = put_str(p, t->inhibited ? "INHIBITED MID SCALE" : "ACTIVE DAC1 PA4");
  p = put_str(p, "\",\"ADC\":\"");
  p = put_str(p, (t->adaptation || t->control) ? "READY PA0 BENCH INPUT" : "NOT CONFIGURED");
  p = put_str(p, "\",\"SENSORS\":\"NOT CONNECTED\",\"TX\":\"NOT COMMISSIONED\",\"RX\":\"NOT COMMISSIONED\"},");
  p = put_str(p, "\"engine\":{\"timerHz\":");
  p = put_u32(p, t->sample_rate_hz);
  p = put_str(p, ",\"dmaBuffer\":");
  p = put_u32(p, t->dma_buffer);
  p = put_str(p, ",\"cpuLoad\":");
  p = put_fixed(p, t->cpu_load, 2);
  p = put_str(p, ",\"underruns\":");
  p = put_u32(p, t->underruns);
  p = put_str(p, "},\"firmware\":\"" FW_VERSION);
  if (t->control) p = put_str(p, " adaptive environment control");
  else {
    p = put_str(p, " bring-up ");
    p = put_u32(p, t->step);
    *p++ = '/';
    p = put_u32(p, t->step_count);
    *p++ = ' ';
    p = put_str(p, t->step_label);
  }
  if (t->cw) {
    p = put_str(p, " (");
    p = put_fixed(p, t->cw_khz, 3);
    p = put_str(p, " kHz)");
  }
  p = put_str(p, "\"}}\n");
  return (size_t)(p - out);
}
