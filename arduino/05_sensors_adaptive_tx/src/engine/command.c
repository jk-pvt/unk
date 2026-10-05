#include "control.h"
#include <ctype.h>
#include <stdio.h>
#include <string.h>

void command_corrupt(command_line *p) { p->dropping = 1; p->length = 0; }
int command_feed(command_line *p, unsigned char b) {
  if (b == '\n') {
    int result = p->dropping ? -1 : p->length ? 1 : 0;
    p->data[p->length] = 0; p->length = 0; p->dropping = 0; return result;
  }
  if (p->dropping) return 0;
  if (p->length == COMMAND_MAX || b == 0) { command_corrupt(p); return 0; }
  p->data[p->length++] = (char)b; return 0;
}
static void ws(const char **p) { while (**p == ' ' || **p == '\t' || **p == '\r') ++*p; }
static int string(const char **p, char *out, size_t cap) {
  if (*(*p)++ != '"') return 0;
  size_t n = 0;
  while (**p && **p != '"') {
    // Protocol identifiers are deliberately plain ASCII, without escapes.
    if ((unsigned char)**p < 32 || **p == '\\' || n + 1 >= cap) return 0;
    out[n++] = *(*p)++;
  }
  if (**p != '"') return 0;
  ++*p; out[n] = 0; return 1;
}
int command_parse(const char *p, command_t *o) {
  if (strlen(p) > COMMAND_MAX) return 0;
  *o = (command_t){0}; unsigned seen = 0;
  const char *names[] = {"version","session","id","op","source","turbidity","depth","temperature","mode","window","profile"};
  ws(&p); if (*p++ != '{') return 0;
  for (;;) {
    char key[20]; ws(&p); if (!string(&p,key,sizeof key)) return 0;
    unsigned k; for (k=0;k<11 && strcmp(key,names[k]);k++) {}
    if (k == 11 || (seen & (1u<<k))) return 0;
    seen |= 1u<<k; ws(&p); if (*p++ != ':') return 0; ws(&p);
    if (k == 3 || k == 4 || k == 10) {
      char *target=k==3?o->op:k==4?o->source:o->profile;
      size_t cap=k==3?sizeof o->op:k==4?sizeof o->source:sizeof o->profile;
      if (!string(&p,target,cap)) return 0;
    }
    else {
      if (!isdigit((unsigned char)*p)) return 0;
      if (*p == '0' && isdigit((unsigned char)p[1])) return 0;
      uint32_t v=0;
      while (isdigit((unsigned char)*p)) { unsigned d=(unsigned)(*p++-'0'); if (v > (UINT32_MAX-d)/10u) return 0; v=v*10+d; }
      uint32_t *fields[] = {&o->version,&o->session,&o->id,0,0,&o->turbidity,&o->depth,&o->temperature,&o->mode,&o->window};
      *fields[k]=v;
    }
    ws(&p); if (*p == '}') { p++; break; } if (*p++ != ',') return 0;
  }
  ws(&p); if (*p || o->version != 1 || !o->session || !o->id) return 0;
  // Named bench commands use the same version/session/ID envelope and engine.
  // Never admit unversioned lines that could bypass session or duplicate checks.
  if(!strcmp(o->op,"SET_ENV")) strcpy(o->op,"preset");
  else if(!strcmp(o->op,"SET_ENV_VALUES")) strcpy(o->op,"environment");
  else if(!strcmp(o->op,"SET_INPUT_SOURCE")) {
    strcpy(o->op,"source");
    if(!strcmp(o->source,"WEB")) strcpy(o->source,"WEB_COMMAND");
    else if(!strcmp(o->source,"A0")) strcpy(o->source,"ADC_DIAL");
  }
  else if(!strcmp(o->op,"START_OUTPUT")) strcpy(o->op,"start");
  else if(!strcmp(o->op,"STOP_OUTPUT")) strcpy(o->op,"stop");
  else if(!strcmp(o->op,"GET_STATUS")) strcpy(o->op,"status");
  else if(!strcmp(o->op,"GET_WAVEFORM")) strcpy(o->op,"status");
  else if(!strcmp(o->op,"CAPTURE_DAC")) strcpy(o->op,"capture");
  else if(!strcmp(o->op,"PING")) strcpy(o->op,"hello");
  unsigned required=15;
  if (!strcmp(o->op,"source")) { required |= 1u<<4; if (strcmp(o->source,"WEB_COMMAND") && strcmp(o->source,"ADC_DIAL")) return 0; }
  else if (!strcmp(o->op,"environment")) { required |= 7u<<5; if (o->turbidity>1000 || o->depth>1000 || o->temperature>400) return 0; }
  else if (!strcmp(o->op,"waveform")) { required |= 3u<<8; if(o->mode>2 || o->window>3) return 0; }
  else if (!strcmp(o->op,"capture")) { required |= 1u<<8; if(o->mode>1) return 0; }  // mode 0 pulse, 1 train
  else if (!strcmp(o->op,"preset")) { environment_input input; required |= 1u<<10; if(!environment_preset(o->profile,&input)) return 0; }
  else if (strcmp(o->op,"hello") && strcmp(o->op,"start") && strcmp(o->op,"stop") && strcmp(o->op,"keepalive") && strcmp(o->op,"status")) return 0;
  return seen == required;
}
size_t command_ack(const command_t *cmd, const char *error, char *out, size_t cap) {
  int n=snprintf(out,cap,"{\"version\":1,\"type\":\"ack\",\"session\":%lu,\"id\":%lu,\"status\":\"%s\",\"reason\":\"%s\"}\n",
    (unsigned long)cmd->session,(unsigned long)cmd->id,error ? "REJECTED":"ACCEPTED",error ? error:"");
  return n>0 && (size_t)n<cap ? (size_t)n:0;
}
