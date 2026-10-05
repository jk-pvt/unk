// Runs the firmware's pulse synthesis on the host and prints the samples,
// normalised to ±1 of full scale, so the dashboard model can be compared
// against it. Usage: host_twin MODE WINDOW CENTER_KHZ BW_KHZ PULSE_MS AMP_PCT
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "waveform.h"

#define FS 1000000u
static uint16_t buf[20000];

static int parse_mode(const char *s) {
  for (int m = WF_LFM; m <= WF_CW; m++)
    if (!strcmp(s, wf_mode_name((wf_mode)m))) return m;
  return -1;
}

static int parse_window(const char *s) {
  for (int w = WF_WIN_RECT; w <= WF_WIN_BLACKMAN; w++)
    if (!strcmp(s, wf_window_name((wf_window)w))) return w;
  return -1;
}

int main(int argc, char **argv) {
  if (argc != 7) {
    fprintf(stderr, "usage: %s MODE WINDOW CENTER_KHZ BW_KHZ PULSE_MS AMP_PCT\n", argv[0]);
    return 2;
  }
  int mode = parse_mode(argv[1]), window = parse_window(argv[2]);
  if (mode < 0 || window < 0) {
    fprintf(stderr, "unknown mode or window\n");
    return 2;
  }
  wf_config c = {(wf_mode)mode, strtof(argv[3], 0), strtof(argv[4], 0), strtof(argv[5], 0),
                 strtof(argv[6], 0), (wf_window)window};
  wf_init();
  size_t n = wf_synthesize(&c, FS, buf, sizeof buf / sizeof buf[0]);
  printf("%zu\n", n);
  for (size_t i = 0; i < n; i++) printf("%.6f\n", ((int)buf[i] - WF_DAC_MID) / (double)WF_DAC_HALF);
  return 0;
}
