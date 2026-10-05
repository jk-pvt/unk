#ifndef AQUASDR_CONTROL_H
#define AQUASDR_CONTROL_H
#include "adaptation.h"
#include "config.h"
#define COMMAND_MAX 512
// ADC count that maps to 100 % on the A0 input. 4095 for the 0-3.3 V bench dial; the combined image
// reads the mounted TDS board (0-2.3 V full scale), so it overrides this.
#ifndef ADC_FULLSCALE_COUNTS
#define ADC_FULLSCALE_COUNTS 4095
#endif
#define WEB_LEASE_MS 2000u
// Wire environmental numbers use tenths; measured ADC retains full resolution.
typedef struct { uint8_t web, valid; uint16_t raw; float turbidity, depth, temperature; uint32_t sampled_ms; } environment_input;
typedef struct {
  adaptation_t policy;
  environment_input input, pending_input, applied_input;
  wf_mode mode;
  wf_window window;
  wf_config requested, applied;
  uint32_t session, last_id, request_id, pending_request, applied_request;
  uint32_t request_session, pending_session, applied_session;
  uint32_t decision, applied_decision, decision_ms, latency_ms, lease_ms, tick_ms, ping_ms;
  uint8_t enabled, fault, expired, force, pending, prepared, has_applied;
  uint8_t status_requested;
  uint8_t capture_request; // 0 none, else 1 + mode. Set by the capture op, consumed by the sketch.
  uint8_t capture_busy;    // owned by the sketch: a capture is requested, running or being sent
} control_t;
typedef struct { uint32_t version, session, id, turbidity, depth, temperature, mode, window; char op[24], source[16], profile[24]; } command_t;
typedef struct { char data[COMMAND_MAX + 1]; unsigned length; uint8_t dropping; } command_line;
int command_feed(command_line *p, unsigned char byte); // 1 complete, -1 discarded
void command_corrupt(command_line *p);
int command_parse(const char *line, command_t *out);
int environment_preset(const char *name, environment_input *out);
const char *environment_profile_name(const environment_input *input);
void control_init(control_t *c);
const char *control_command(control_t *c, const command_t *cmd, uint32_t now);
void control_adc(control_t *c, uint16_t raw, int valid, uint32_t now);
void control_tick(control_t *c, uint32_t now);
int control_allowed(const control_t *c, uint32_t now);
int control_ping(control_t *c, uint32_t now, int pulse_active);
void control_stop(control_t *c);
const char *control_reason(const control_t *c, uint32_t now);
size_t control_json(const control_t *c, uint32_t now, char *out, size_t cap);
size_t command_ack(const command_t *cmd, const char *error, char *out, size_t cap);
#endif
