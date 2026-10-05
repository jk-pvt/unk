#include "control.h"
#include <stdio.h>
#include <string.h>

static const struct { const char *name; float turbidity,depth,temperature; } presets[]={
  {"CLEAR_SHALLOW_REEF",12,3,26}, {"MUDDY_ESTUARY",85,18,24.8f},
  {"DEEP_OPEN_WATER",10,80,10}, {"SEDIMENT_PLUME",95,12,22}
};
int environment_preset(const char *name, environment_input *out) {
  for(unsigned i=0;i<sizeof presets/sizeof *presets;i++) if(!strcmp(name,presets[i].name)) {
    *out=(environment_input){.web=1,.valid=1,.turbidity=presets[i].turbidity,.depth=presets[i].depth,.temperature=presets[i].temperature}; return 1;
  }
  return 0;
}
const char *environment_profile_name(const environment_input *input) {
  if(!input->web) return "ADC_DIAL";
  for(unsigned i=0;i<sizeof presets/sizeof *presets;i++)
    if((unsigned)(input->turbidity*10+.5f)==(unsigned)(presets[i].turbidity*10+.5f) &&
       (unsigned)(input->depth*10+.5f)==(unsigned)(presets[i].depth*10+.5f) &&
       (unsigned)(input->temperature*10+.5f)==(unsigned)(presets[i].temperature*10+.5f)) return presets[i].name;
  return "CUSTOM";
}

void control_init(control_t *c) {
  *c=(control_t){.window=WF_WIN_HANN}; adaptation_init(&c->policy);
  c->input.temperature=25;
}
void control_stop(control_t *c) { c->enabled=0; c->pending=c->prepared=0; c->force=1; }
const char *control_reason(const control_t *c, uint32_t now) {
  if(c->fault) return "DMA_DAC_FAULT";
  if(c->expired) return "WEB_LEASE_EXPIRED";
  if(!c->enabled) return "OUTPUT_DISABLED";
  if(!adaptation_allowed(&c->policy,now)) return "INPUT_UNQUALIFIED";
  return "";
}
int control_allowed(const control_t *c, uint32_t now) { return !*control_reason(c,now); }
const char *control_command(control_t *c, const command_t *x, uint32_t now) {
  if(!strcmp(x->op,"hello")) {
    if(c->session != x->session) { if(c->input.web) control_stop(c); c->session=x->session; c->last_id=0; }
  } else if(x->session != c->session) return "SESSION_MISMATCH";
  if(x->id <= c->last_id) return "DUPLICATE_ID";
  c->last_id=x->id;
  if(!strcmp(x->op,"hello")) return 0;
  if(!strcmp(x->op,"status")) { c->status_requested=1; return 0; }
  if(!strcmp(x->op,"stop")) { control_stop(c); return 0; }
  if(!strcmp(x->op,"source")) {
    control_stop(c); adaptation_init(&c->policy);
    c->input=(environment_input){.web=!strcmp(x->source,"WEB_COMMAND"),.temperature=25};
    c->expired=0; c->lease_ms=now; c->request_id=x->id; c->request_session=x->session; return 0;
  }
  if(!strcmp(x->op,"keepalive")) { c->lease_ms=now; return 0; }
  if(!strcmp(x->op,"environment") || !strcmp(x->op,"preset")) {
    if(!c->input.web) return "SOURCE_NOT_WEB";
    if(!strcmp(x->op,"preset")) { environment_input preset; if(!environment_preset(x->profile,&preset)) return "INVALID_PROFILE"; c->input=preset; }
    else { c->input.turbidity=(float)x->turbidity/10; c->input.depth=(float)x->depth/10; c->input.temperature=(float)x->temperature/10; }
    c->input.valid=1; c->input.sampled_ms=now; c->lease_ms=now; c->expired=0;
    c->request_id=x->id; c->request_session=x->session; c->force=1; return 0;
  }
  if(!strcmp(x->op,"waveform")) { c->mode=(wf_mode)x->mode; c->window=(wf_window)x->window; c->request_id=x->id; c->request_session=x->session; c->force=1; return 0; }
  if(!strcmp(x->op,"capture")) {
#ifdef AQUASDR_CAPTURE
    // One controlled capture: enable output for the next pulse. The sketch stops the output again as soon as the capture is done.
    if(c->fault) return "DMA_DAC_FAULT";
    if(c->expired || !adaptation_allowed(&c->policy,now)) return "INPUT_UNQUALIFIED";
    if(c->capture_busy || c->capture_request) return "CAPTURE_BUSY";
    c->capture_request=(uint8_t)(1+x->mode); c->enabled=1; c->force=1; return 0;
#else
    return "CAPTURE_UNSUPPORTED";
#endif
  }
  if(!strcmp(x->op,"start")) {
    if(c->fault) return "DMA_DAC_FAULT";
    if(c->expired || !adaptation_allowed(&c->policy,now)) return "INPUT_UNQUALIFIED";
    c->enabled=1; c->force=1; return 0;
  }
  return "UNKNOWN_COMMAND";
}
void control_adc(control_t *c, uint16_t raw, int ok, uint32_t now) {
  if(c->input.web) return;
  float level=(float)raw*100.0f/(float)ADC_FULLSCALE_COUNTS; if(level>100.0f) level=100.0f;
  c->input=(environment_input){.raw=raw,.turbidity=level,.temperature=25,
    .sampled_ms=now,.valid=ok && raw>12 && raw<4083};
}
void control_tick(control_t *c, uint32_t now) {
  if(c->input.web && now-c->lease_ms>=WEB_LEASE_MS) {
    control_stop(c); c->expired=1; c->input.valid=0;
  }
  if(now-c->tick_ms>=20) {
    c->tick_ms=now;
    int valid=c->input.valid && (c->input.web || now-c->input.sampled_ms<=ADAPT_STALE_MS);
    c->policy.raw=c->input.raw;
    float severity=c->input.turbidity>c->input.depth ? c->input.turbidity:c->input.depth;
    int changed=adaptation_update_level(&c->policy,severity,valid,now);
    if(adaptation_allowed(&c->policy,now) && (changed || c->force)) {
      c->requested=adaptation_waveform(&c->policy,c->mode); c->requested.window=c->window;
      c->pending_input=c->input; c->pending_request=c->request_id;
      c->pending_session=c->request_session;
      c->decision++; c->decision_ms=now; c->pending=1; c->prepared=0; c->force=0;
    }
  }
  if(!adaptation_allowed(&c->policy,now) || c->fault) { c->pending=c->prepared=0; c->force=1; }
}
int control_ping(control_t *c, uint32_t now, int active) {
  if(active || !control_allowed(c,now) || now-c->ping_ms<PING_INTERVAL_MS) return 0;
  if(c->pending) {
    if(!c->prepared) return 0;
    c->applied=c->requested; c->applied_input=c->pending_input;
    c->applied_decision=c->decision; c->applied_request=c->pending_request;
    c->applied_session=c->pending_session;
    c->latency_ms=now-c->decision_ms; c->has_applied=1; c->pending=0;
  }
  if(!c->has_applied) return 0;
  c->ping_ms=now; return 1;
}
// Append-only payload extension; fixed-size fields and integer formatting keep
// the embedded formatter independent of printf floating-point support.
size_t control_json(const control_t *c, uint32_t now, char *out, size_t cap) {
  int n=snprintf(out,cap,
    ",\"capabilities\":{\"controlVersion\":1},\"environment\":{\"source\":\"%s\",\"profile\":\"%s\",\"turbidityIndex\":%lu.%lu,\"depth\":%lu.%lu,\"temperature\":%lu.%lu,\"valid\":%s,\"sampledMs\":%lu},"
    "\"control\":{\"session\":%lu,\"lastRequestId\":%lu,\"requestedId\":%lu,\"appliedRequestId\":%lu,\"decisionId\":%lu,\"appliedDecisionId\":%lu,\"outputEnabled\":%s,\"qualified\":%s,\"state\":\"%s\",\"reason\":\"%s\",\"profile\":\"%s\",\"decisionToOutputMs\":%lu,\"hasApplied\":%s,\"mode\":%u,\"window\":%u,\"uptimeMs\":%lu}",
    c->input.web?"WEB_COMMAND":"ADC_DIAL",environment_profile_name(&c->input),
    (unsigned long)(c->input.turbidity*10+.5f)/10,(unsigned long)(c->input.turbidity*10+.5f)%10,
    (unsigned long)(c->input.depth*10+.5f)/10,(unsigned long)(c->input.depth*10+.5f)%10,
    (unsigned long)(c->input.temperature*10+.5f)/10,(unsigned long)(c->input.temperature*10+.5f)%10,
    c->policy.valid?"true":"false",(unsigned long)c->input.sampled_ms,
    (unsigned long)c->session,(unsigned long)c->last_id,(unsigned long)c->request_id,(unsigned long)c->applied_request,
    (unsigned long)c->decision,(unsigned long)c->applied_decision,c->enabled?"true":"false",adaptation_allowed(&c->policy,now)?"true":"false",
    !control_allowed(c,now)?"INHIBITED":c->pending?"PENDING":c->has_applied?"APPLIED":"PENDING",
    control_reason(c,now),adaptation_profile_name(c->policy.profile),(unsigned long)c->latency_ms,c->has_applied?"true":"false",
    (unsigned)c->mode,(unsigned)c->window,(unsigned long)now);
  if(n<=0 || (size_t)n>=cap) return 0;
  if(!c->input.web) {
    // Physical A0 chain, step by step: raw count, pin voltage (mV), the
    // 0.25 EMA level the policy actually decides on (tenths of a percent),
    // and whether the conversion is accepted. Integers only.
    unsigned long lv=c->policy.valid?(unsigned long)(c->policy.level*10+.5f):0;
    int added=snprintf(out+n,cap-(size_t)n,
      ",\"adc\":{\"pin\":\"PA0/A0\",\"sensor\":\"" ADC_SENSOR_LABEL "\",\"fullScaleCounts\":%u,\"raw\":%u,\"millivolts\":%lu,\"filteredLevel\":%lu.%lu,\"valid\":%s,\"candidate\":%u}",
      (unsigned)ADC_FULLSCALE_COUNTS,(unsigned)c->input.raw,(unsigned long)c->input.raw*3300ul/4095ul,lv/10,lv%10,
      c->policy.valid?"true":"false",(unsigned)c->policy.candidate);
    if(added<=0 || (size_t)added>=cap-(size_t)n) return 0;
    n+=added;
  }
  if(c->has_applied) {
    int added=snprintf(out+n,cap-(size_t)n,
      ",\"applicationAck\":{\"session\":%lu,\"id\":%lu,\"decisionId\":%lu,\"status\":\"APPLIED\",\"profile\":\"%s\",\"policy\":\"%s\"}",
      (unsigned long)c->applied_session,(unsigned long)c->applied_request,(unsigned long)c->applied_decision,
      environment_profile_name(&c->applied_input),c->applied.center_khz==42?"CLEAR":c->applied.center_khz==40?"TRANSITION":"MURKY");
    if(added<=0 || (size_t)added>=cap-(size_t)n) return 0;
    n+=added;
  }
  return (size_t)n;
}
