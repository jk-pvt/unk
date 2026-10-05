#define _POSIX_C_SOURCE 200809L
#include "control.h"
#include "telemetry.h"
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>
#include <sys/select.h>

static uint32_t millis(void) { struct timespec ts; clock_gettime(CLOCK_MONOTONIC,&ts); return (uint32_t)((uint64_t)ts.tv_sec*1000+ts.tv_nsec/1000000); }
static void reference(unsigned id, wf_config *cfg) {
  uint16_t samples[WF_MAX_SAMPLES];
  size_t n=wf_synthesize(cfg,SAMPLE_RATE_HZ,samples,WF_MAX_SAMPLES);
  printf("{\"type\":\"reference\",\"id\":%u,\"sampleRate\":%u,\"codes\":[",id,SAMPLE_RATE_HZ);
  for(size_t i=0;i<n;i++) printf("%s%u",i?",":"",samples[i]);
  puts("]}"); fflush(stdout);
}
int main(void) {
  control_t c; control_init(&c); wf_init();
  command_line line={0}; uint32_t boot=millis(), last=0, seq=0;
  char output[TELEMETRY_MAX];
  for(;;) {
    fd_set input; FD_ZERO(&input); FD_SET(STDIN_FILENO,&input);
    struct timeval timeout={0,5000};
    int ready=select(STDIN_FILENO+1,&input,0,0,&timeout);
    uint32_t now=millis()-boot;
    if(ready<0) return 1;
    if(ready>0) {
      unsigned char buf[512]; ssize_t n=read(STDIN_FILENO,buf,sizeof buf); if(n<=0) return 0;
      for(ssize_t i=0;i<n;i++) {
        int complete=command_feed(&line,buf[i]); if(!complete) continue;
        if(complete==1 && line.data[0]=='!') {
          unsigned id,mode,window; wf_config cfg; char extra;
          if(sscanf(line.data,"!render %u %u %u %f %f %f %f %c",&id,&mode,&window,&cfg.center_khz,&cfg.bandwidth_khz,&cfg.pulse_ms,&cfg.amplitude_pct,&extra)==7 && mode<3 && window<4) {
            cfg.mode=(wf_mode)mode; cfg.window=(wf_window)window; reference(id,&cfg);
          }
          continue;
        }
        command_t cmd={0}; const char *error="INVALID_COMMAND";
        if(complete==1 && command_parse(line.data,&cmd)) error=control_command(&c,&cmd,now);
        else cmd=(command_t){0};
        size_t bytes=command_ack(&cmd,error,output,sizeof output); fwrite(output,1,bytes,stdout); fflush(stdout);
      }
    }
    control_tick(&c,now);
    if(c.pending && !c.prepared) {
      uint16_t pulse[WF_MAX_SAMPLES]; c.prepared=wf_synthesize(&c.requested,SAMPLE_RATE_HZ,pulse,WF_MAX_SAMPLES)>0;
    }
    control_ping(&c,now,0);
    if(now-last>=250 || c.status_requested) {
      c.status_requested=0;
      last=now;
      telemetry_t t={.control=&c,.seq=++seq,.uptime_ms=now,.waveform=c.has_applied?&c.applied:0,
        .sample_rate_hz=SAMPLE_RATE_HZ,.dma_buffer=c.has_applied?(uint32_t)wf_samples_for(&c.applied,SAMPLE_RATE_HZ):0,
        .step=1,.step_count=3,.step_label="host C simulation",.inhibited=!control_allowed(&c,now)};
      size_t bytes=telemetry_format(&t,output); fwrite(output,1,bytes,stdout); fflush(stdout);
    }
  }
}
