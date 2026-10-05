#!/usr/bin/env node
// Where the A0 / TDS_PROXY input switches the transmit profile, taken from the REAL C adaptation engine (firmware/src/adaptation.c) by sweeping the
// level up and then down with the engine's own smoothing, settle time and hysteresis. Nothing here is measured: it is the policy the board runs, expressed
// in the units you can read with a meter (ADC counts and millivolts at the A0 pin). The TDS board is a TDS PROXY, never turbidity.
//   node scripts/a0-policy-table.mjs [--out docs/evidence/a0-policy-table.json]
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const FULL = 2854;                                    // ADC_FULLSCALE_COUNTS in build_opt.h (TDS board 0 to 2.3 V); the engine takes level = raw * 100 / FULL
const dir = mkdtempSync(join(tmpdir(), "a0-policy-")), src = join(dir, "sweep.c"), bin = join(dir, "sweep");
writeFileSync(src, `#include <stdio.h>
#include "adaptation.h"
int main(void){
  adaptation_t s; uint32_t now = 1000; int last;
  for (int pass = 0; pass < 2; pass++) {
    adaptation_init(&s);
    float start = pass == 0 ? 0.0f : 100.0f, end = pass == 0 ? 100.0f : 0.0f, step = pass == 0 ? 0.25f : -0.25f;
    // qualify at the start level first, then move slowly so every transition is the hysteresis path, not the first-decision path
    for (int i = 0; i < 80; i++) { now += 20; adaptation_update_level(&s, start, 1, now); }
    last = s.profile; printf("%d start %.2f profile %d\\n", pass, start, last);
    for (float lv = start; pass == 0 ? lv <= end : lv >= end; lv += step) {
      for (int i = 0; i < 80; i++) { now += 20; adaptation_update_level(&s, lv, 1, now); }
      if (s.profile != last) { printf("%d change %.2f %d %d\\n", pass, lv, last, s.profile); last = s.profile; }
    }
  }
  return 0;
}
`);
execFileSync("cc", ["-O1", "-I", resolve("firmware/src"), "-DADAPT_STALE_MS=1500u", src, resolve("firmware/src/adaptation.c"), "-o", bin]);
const out = execFileSync(bin, { encoding: "utf8" }).trim().split("\n");
const names = ["CLEAR", "TRANSITION", "MURKY"], changes = [];
for (const l of out) { const m = l.match(/^(\d) change ([\d.]+) (\d) (\d)$/); if (m) changes.push({ direction: m[1] === "0" ? "rising" : "falling", atLevelPct: Number(m[2]), from: names[+m[3]], to: names[+m[4]] }); }
const counts = (lv) => Math.round(lv / 100 * FULL), mv = (c) => Math.round(c * 3300 / 4095);
const table = changes.map((c) => ({ ...c, adcCounts: counts(c.atLevelPct), millivoltsAtPin: mv(counts(c.atLevelPct)) }));
const first = { note: "First decision after the input becomes valid has no hysteresis: below 35 % is CLEAR, 35 to 70 % TRANSITION, 70 % and above MURKY", clearBelowPct: 35, murkyFromPct: 70 };
const result = { source: "firmware/src/adaptation.c swept with its own smoothing, settle and hysteresis", fullScaleCounts: FULL, levelDefinition: "level % = raw counts * 100 / 2854 (TDS board 0 to 2.3 V assumed full scale)", firstDecision: first, transitions: table,
  caveats: ["TDS_PROXY: a conductivity-type reading, not turbidity", "millivolts assume the 3.3 V ADC reference", "the actual relation between salt concentration and A0 voltage is that of the installed TDS board and is not characterised here"] };
console.log(JSON.stringify(result, null, 1));
const o = process.argv.indexOf("--out"); if (o > 0) writeFileSync(process.argv[o + 1], JSON.stringify(result, null, 1));
