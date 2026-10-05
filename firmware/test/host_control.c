#include "control.h"
#include "telemetry.h"
#include "serial_rx.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned id;
static command_t cmd(const char *op) { command_t x={.version=1,.session=77,.id=++id}; strcpy(x.op,op); return x; }
static void web(control_t *c, unsigned turb, unsigned depth, unsigned temp, unsigned now) {
  command_t x=cmd("hello"); assert(!control_command(c,&x,now));
  x=cmd("source");strcpy(x.source,"WEB_COMMAND");assert(!control_command(c,&x,now));
  x=cmd("environment");x.turbidity=turb;x.depth=depth;x.temperature=temp;assert(!control_command(c,&x,now));
}
static void ticks(control_t *c,unsigned from,unsigned to) { for(unsigned t=from;t<=to;t+=20)control_tick(c,t); }
static command_t named(const char *op,const char *fields) {
  char line[COMMAND_MAX+1]; command_t x;
  snprintf(line,sizeof line,"{\"version\":1,\"session\":77,\"id\":%u,\"op\":\"%s\"%s}",++id,op,fields);
  assert(command_parse(line,&x)); return x;
}
int main(int argc,char **argv) {
  assert(argc>=2); wf_init(); control_t c;control_init(&c);
  if(!strcmp(argv[1],"policy")) {
    const unsigned presets[][3]={{120,30,260},{850,180,248},{100,800,100},{950,120,220}};
    for(unsigned i=0;i<4;i++){control_init(&c);web(&c,presets[i][0],presets[i][1],presets[i][2],0);ticks(&c,20,200);assert(c.policy.profile==(i?2:0));assert(!c.enabled);}
    control_init(&c);web(&c,0,0,0,0);ticks(&c,20,200);assert(c.policy.profile==0);
    control_init(&c);web(&c,1000,1000,400,0);ticks(&c,20,200);assert(c.policy.profile==2);
    control_t a;control_init(&a);control_init(&c);web(&c,500,0,250,0);
    for(unsigned t=20;t<=400;t+=20){control_adc(&a,2048,1,t);control_tick(&a,t);control_tick(&c,t);}
    assert(a.policy.profile==c.policy.profile && a.requested.center_khz==c.requested.center_khz);
    command_t x=cmd("environment");x.turbidity=500;x.temperature=400;assert(!control_command(&c,&x,400));ticks(&c,420,600);assert(c.requested.center_khz==40);
  } else if(!strcmp(argv[1],"named_commands")) {
    const char *names[]={"CLEAR_SHALLOW_REEF","MUDDY_ESTUARY","DEEP_OPEN_WATER","SEDIMENT_PLUME"};
    for(unsigned i=0;i<4;i++) {
      control_init(&c); command_t x=named("PING","");assert(!control_command(&c,&x,0));
      x=named("SET_INPUT_SOURCE",",\"source\":\"WEB\"");assert(!control_command(&c,&x,0));
      char fields[80];snprintf(fields,sizeof fields,",\"profile\":\"%s\"",names[i]);
      x=named("SET_ENV",fields);assert(!control_command(&c,&x,0));ticks(&c,20,200);
      assert(!strcmp(environment_profile_name(&c.input),names[i]));
      assert(c.requested.center_khz==(i?38:42) && c.requested.bandwidth_khz==(i?1:4));
      assert(c.requested.pulse_ms==(i?8:2) && c.requested.amplitude_pct==(i?62:35));
      char out[TELEMETRY_MAX];control_json(&c,200,out,sizeof out);assert(!strstr(out,"applicationAck"));
      char ack[200];command_ack(&x,0,ack,sizeof ack);assert(strstr(ack,"ACCEPTED"));
      unsigned request=x.id;
      x=named("GET_STATUS","");assert(!control_command(&c,&x,200));assert(c.status_requested && !c.enabled && c.lease_ms==0);
      c.status_requested=0;x=named("GET_WAVEFORM","");assert(!control_command(&c,&x,200));assert(c.status_requested && !c.enabled);
      x=named("START_OUTPUT","");assert(!control_command(&c,&x,200));control_tick(&c,220);
      c.prepared=1;assert(control_ping(&c,220,0));assert(c.applied_request==request && c.applied_session==77);
      control_json(&c,220,out,sizeof out);assert(strstr(out,"applicationAck") && strstr(out,"\"status\":\"APPLIED\""));
      x=named("STOP_OUTPUT","");assert(!control_command(&c,&x,221));assert(!c.enabled);
      x=named("hello","");x.session=78;assert(!control_command(&c,&x,222));
      assert(c.applied_session==77);control_json(&c,222,out,sizeof out);
      assert(strstr(out,"\"applicationAck\":{\"session\":77"));
    }
    control_init(&c);web(&c,500,0,250,0);ticks(&c,20,200);
    command_t x=named("SET_ENV_VALUES",",\"turbidity\":500,\"depth\":0,\"temperature\":400");
    assert(!control_command(&c,&x,200));ticks(&c,220,400);assert(c.requested.center_khz==40);
    assert(!strcmp(environment_profile_name(&c.input),"CUSTOM"));
    x=named("SET_INPUT_SOURCE",",\"source\":\"A0\"");assert(!control_command(&c,&x,400));
    assert(!c.input.web && !c.enabled && !c.policy.qualified);
    x=named("SET_ENV",",\"profile\":\"MUDDY_ESTUARY\"");assert(!strcmp(control_command(&c,&x,400),"SOURCE_NOT_WEB"));
    const char *bad[]={
      "{\"version\":1,\"session\":77,\"id\":1,\"op\":\"SET_ENV\",\"profile\":\"UNKNOWN\"}",
      "{\"version\":1,\"session\":77,\"id\":1,\"op\":\"SET_ENV\",\"profile\":\"MUDDY_ESTUARY\",\"profile\":\"MUDDY_ESTUARY\"}",
      "{\"version\":1,\"session\":77,\"id\":1,\"op\":\"SET_INPUT_SOURCE\",\"source\":\"SENSOR\"}",
      "{\"version\":1,\"session\":77,\"id\":1,\"op\":\"GET_STATUS\",\"depth\":0}",
      "{\"version\":1,\"session\":77,\"id\":1,\"op\":\"SET_ENV_VALUES\",\"turbidity\":500,\"depth\":1001,\"temperature\":250}",
      "{\"version\":1,\"session\":77,\"id\":1,\"op\":\"SET_ENV_VALUES\",\"turbidity\":500,\"depth\":10,\"temperature\":401}"};
    for(unsigned i=0;i<sizeof bad/sizeof *bad;i++)assert(!command_parse(bad[i],&x));
  } else if(!strcmp(argv[1],"scheduler")) {
    web(&c,120,30,260,0);ticks(&c,20,100);assert(!control_ping(&c,100,0));
    command_t x=cmd("start");assert(!control_command(&c,&x,100));control_tick(&c,120);
    assert(!control_ping(&c,120,0));c.prepared=1;assert(!control_ping(&c,120,1));assert(control_ping(&c,120,0));
    assert(c.applied.center_khz==42 && c.has_applied);unsigned applied=c.applied_decision;
    x=cmd("environment");x.turbidity=950;x.depth=120;x.temperature=220;assert(!control_command(&c,&x,130));ticks(&c,140,500);
    assert(c.requested.center_khz==38);c.prepared=1;assert(!control_ping(&c,500,1));assert(c.applied_decision==applied);
    assert(control_ping(&c,500,0));assert(c.applied.center_khz==38 && c.applied_decision>applied);
    x=cmd("stop");assert(!control_command(&c,&x,501));assert(!control_ping(&c,600,0));
    x=cmd("source");strcpy(x.source,"ADC_DIAL");assert(!control_command(&c,&x,601));assert(!c.enabled && !c.pending && !c.policy.qualified);
    for(unsigned t=620;t<=720;t+=20){control_adc(&c,1900,1,t);control_tick(&c,t);}x=cmd("start");assert(!control_command(&c,&x,720));
    control_adc(&c,4095,1,740);control_tick(&c,740);assert(!control_allowed(&c,740));
    control_adc(&c,1000,1,760);control_tick(&c,760);assert(!control_allowed(&c,760));
    for(unsigned t=780;t<=860;t+=20){control_adc(&c,1000,1,t);control_tick(&c,t);}assert(control_allowed(&c,860));
    control_tick(&c,980);assert(!control_allowed(&c,980));
    c.fault=1;x=cmd("start");assert(control_command(&c,&x,980));
  } else if(!strcmp(argv[1],"lease")) {
    web(&c,850,0,250,0);ticks(&c,20,100);command_t x=cmd("start");assert(!control_command(&c,&x,100));
    ticks(&c,120,1980);assert(c.enabled);control_tick(&c,2000);assert(!c.enabled && c.expired && !c.pending);
    x=cmd("keepalive");assert(!control_command(&c,&x,2020));assert(c.expired && !c.enabled);
    x=cmd("start");assert(control_command(&c,&x,2020));
    x=cmd("environment");x.turbidity=100;x.temperature=250;assert(!control_command(&c,&x,2040));ticks(&c,2040,2140);assert(!c.enabled);
    x=cmd("start");assert(!control_command(&c,&x,2140));assert(c.enabled);
    assert(!strcmp(control_command(&c,&x,2140),"DUPLICATE_ID"));
    x=cmd("stop");x.session=78;assert(!strcmp(control_command(&c,&x,2140),"SESSION_MISMATCH"));assert(c.enabled);
    x=cmd("hello");x.session=78;assert(!control_command(&c,&x,2150));assert(!c.enabled);
    control_init(&c);web(&c,500,0,250,UINT32_MAX-100);ticks(&c,20,100);assert(!c.expired);control_tick(&c,2000);assert(c.expired);
  } else if(!strcmp(argv[1],"parser")) {
    command_t x; const char *good="{\"version\":1,\"session\":77,\"id\":1,\"op\":\"hello\"}";
    assert(command_parse(good,&x));
    const char *bad[]={"{}","{\"version\":1,\"version\":1,\"session\":1,\"id\":1,\"op\":\"hello\"}",
      "{\"version\":1,\"session\":1,\"id\":4294967296,\"op\":\"hello\"}",
      "{\"version\":1,\"session\":1,\"id\":01,\"op\":\"hello\"}",
      "{\"version\":1,\"session\":1,\"id\":1,\"op\":\"environment\",\"turbidity\":1001,\"depth\":0,\"temperature\":250}",
      "{\"version\":1,\"session\":1,\"id\":1,\"op\":\"waveform\",\"mode\":3,\"window\":1}",
      "{\"version\":1,\"session\":1,\"id\":1,\"op\":\"start\",}",
      "{\"version\":1,\"session\":1,\"id\":1,\"op\":\"start\"}junk"};
    for(unsigned i=0;i<sizeof bad/sizeof *bad;i++)assert(!command_parse(bad[i],&x));
    command_line line={0};for(const char *p=good;*p;p++)assert(!command_feed(&line,*p));assert(command_feed(&line,'\n')==1);assert(command_parse(line.data,&x));
    for(unsigned i=0;i<513;i++)command_feed(&line,'x');assert(command_feed(&line,'\n')==-1);
    command_corrupt(&line);for(const char *p=good;*p;p++)command_feed(&line,*p);assert(command_feed(&line,'\n')==-1);
    for(const char *p=good;*p;p++)command_feed(&line,*p);assert(command_feed(&line,'\n')==1);assert(command_parse(line.data,&x));
  } else if(!strcmp(argv[1],"uart")) {
    serial_rx r={0}; uint8_t byte;
    for(unsigned i=0;i<RX_CAPACITY+10;i++)serial_rx_push(&r,'x',0);
    assert(r.corrupt && r.dropping);serial_rx_discard(&r);assert(!serial_rx_pop(&r,&byte));
    serial_rx_push(&r,'x',0);assert(!serial_rx_pop(&r,&byte));serial_rx_push(&r,'\n',0);assert(serial_rx_pop(&r,&byte) && byte=='\n');
    serial_rx_push(&r,'{',0);serial_rx_push(&r,'?',1);assert(r.corrupt);serial_rx_discard(&r);
    serial_rx_push(&r,'x',0);assert(!serial_rx_pop(&r,&byte));serial_rx_push(&r,'\n',0);assert(serial_rx_pop(&r,&byte));
    for(unsigned i=0;i<RX_CAPACITY*3;i++){serial_rx_push(&r,'a',0);assert(serial_rx_pop(&r,&byte) && byte=='a');}
  } else if(!strcmp(argv[1],"telemetry")) {
    web(&c,850,180,248,0);ticks(&c,20,100);command_t x=cmd("start");assert(!control_command(&c,&x,100));control_tick(&c,120);c.prepared=1;control_ping(&c,120,0);
    char out[TELEMETRY_MAX];telemetry_t t={.control=&c,.waveform=&c.applied,.seq=1,.uptime_ms=120,.sample_rate_hz=SAMPLE_RATE_HZ,.step=1,.step_count=3,.step_label="control test"};
    size_t n=telemetry_format(&t,out);assert(n<sizeof out);fwrite(out,1,n,stdout);return 0;
  } else if(!strcmp(argv[1],"telemetry_adc")) {
    // Physical-dial source: the packet must expose raw count, pin voltage and the filtered level.
    for(unsigned t=20;t<=200;t+=20){control_adc(&c,3000,1,t);control_tick(&c,t);}
    char out[TELEMETRY_MAX];telemetry_t t={.control=&c,.seq=1,.uptime_ms=200,.sample_rate_hz=SAMPLE_RATE_HZ,.step=1,.step_count=3,.step_label="control test"};
    size_t n=telemetry_format(&t,out);assert(n<sizeof out);fwrite(out,1,n,stdout);return 0;
  } else if(!strcmp(argv[1],"boot_quiet")) {
    // Nothing may be scheduled, enabled or streamed until an explicit start, whatever the input does.
    for(unsigned t=0;t<=3000;t+=20){control_tick(&c,t);assert(!control_ping(&c,t,0));assert(!control_allowed(&c,t));assert(!c.enabled&&!c.pending);}
    for(unsigned t=3020;t<=4000;t+=20){control_adc(&c,2000,1,t);control_tick(&c,t);assert(!control_ping(&c,t,0));assert(!c.enabled);}  // qualified A0 input alone does not start output
    assert(c.policy.qualified);
    web(&c,850,180,248,4100);ticks(&c,4120,4400);assert(c.policy.qualified&&!c.enabled);
    for(unsigned t=4420;t<=5000;t+=20){control_tick(&c,t);assert(!control_ping(&c,t,0));}   // qualified web input alone does not start output either
    command_t x=cmd("source");strcpy(x.source,"ADC_DIAL");assert(!control_command(&c,&x,5000));assert(!c.enabled);
  } else if(!strcmp(argv[1],"capture_op")) {
    // The capture op: unsupported images say so; supporting images require a qualified input, one capture at a time, and never run unprompted.
    web(&c,120,30,260,0);ticks(&c,20,200);assert(c.policy.qualified);
    command_t x=named("CAPTURE_DAC",",\"mode\":0");
    const char *e=control_command(&c,&x,200);
#ifdef AQUASDR_CAPTURE
    assert(!e && c.capture_request==1 && c.enabled);
    x=named("CAPTURE_DAC",",\"mode\":1");assert(!strcmp(control_command(&c,&x,210),"CAPTURE_BUSY"));
    c.capture_request=0;c.capture_busy=1;x=named("CAPTURE_DAC",",\"mode\":1");assert(!strcmp(control_command(&c,&x,220),"CAPTURE_BUSY"));
    c.capture_busy=0;control_stop(&c);
    x=named("CAPTURE_DAC",",\"mode\":1");assert(!control_command(&c,&x,230)&&c.capture_request==2);   // mode 1 = train
    control_init(&c);{command_t h=cmd("hello");assert(!control_command(&c,&h,0));}      // handshake done, but the input was never qualified
    x=named("CAPTURE_DAC",",\"mode\":0");assert(!strcmp(control_command(&c,&x,0),"INPUT_UNQUALIFIED")&&!c.enabled&&!c.capture_request);
    control_init(&c);web(&c,120,30,260,0);ticks(&c,20,200);c.fault=1;
    x=named("CAPTURE_DAC",",\"mode\":0");assert(!strcmp(control_command(&c,&x,300),"DMA_DAC_FAULT")&&!c.capture_request);
#else
    assert(e && !strcmp(e,"CAPTURE_UNSUPPORTED") && !c.enabled && !c.capture_request);
#endif
    command_t bad;
    char line[COMMAND_MAX+1];
    snprintf(line,sizeof line,"{\"version\":1,\"session\":77,\"id\":%u,\"op\":\"CAPTURE_DAC\",\"mode\":2}",++id);assert(!command_parse(line,&bad));   // mode must be 0 or 1
    snprintf(line,sizeof line,"{\"version\":1,\"session\":77,\"id\":%u,\"op\":\"CAPTURE_DAC\"}",++id);assert(!command_parse(line,&bad));          // mode is required
  } else if(!strcmp(argv[1],"telemetry_tds")) {
    // Combined image: A0 is the mounted TDS board, 2.3 V full scale. Half the counts is 50 %, full counts is 100 %.
    unsigned raw=argc>2?(unsigned)atoi(argv[2]):1427;
    for(unsigned t=20;t<=400;t+=20){control_adc(&c,(uint16_t)raw,1,t);control_tick(&c,t);}
    char out[TELEMETRY_MAX];telemetry_t t={.control=&c,.seq=1,.uptime_ms=400,.sample_rate_hz=SAMPLE_RATE_HZ,.step=1,.step_count=3,.step_label="control test"};
    size_t n=telemetry_format(&t,out);assert(n<sizeof out);fwrite(out,1,n,stdout);return 0;
  } else assert(0);
  puts("ok");
}
