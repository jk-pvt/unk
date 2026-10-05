#!/usr/bin/env node
// Re-runs the MCU ADC CAPTURE analysis on the RAW counts already stored in a capture's CSV, keeping its original metadata and timestamp.
// Use after the analysis code changes. It never creates data: the samples come from the stored CSV, nothing is re-captured.
//   node scripts/reanalyze-mcu.mjs data/bench/mcu-20261002064939-7-pulse.csv [...more]
import { readFile, writeFile } from "node:fs/promises";
import { buildMcuRecord } from "../shared/mcu-capture.js";

for (const csv of process.argv.slice(2)) {
  const jsonPath = csv.replace(/\.csv$/, ".json"), old = JSON.parse(await readFile(jsonPath, "utf8"));
  const counts = Uint16Array.from((await readFile(csv, "utf8")).split("\n").filter((l) => /^[0-9]/.test(l)).map((l) => Number(l.split(",")[2])));
  if (counts.length !== old.source.samples) throw new Error(`${csv}: ${counts.length} samples in the CSV but the record says ${old.source.samples}`);
  const rec = buildMcuRecord({ id: old.captureId, mode: old.modeIndex, rate: old.source.sampleRate, counts, expected: old.expected, profile: old.profile, window: old.window, deviceStats: old.deviceStats, firmware: old.firmware, label: old.label, tap: old.tap || "RAW_DAC" });
  if (rec.source.sha256 !== old.source.sha256) throw new Error(`${csv}: sample hash differs from the stored record; refusing to overwrite`);
  rec.capturedAt = old.capturedAt;
  await writeFile(jsonPath, JSON.stringify(rec));
  console.log(`${csv}: ${rec.mode} ${rec.window} re-analysed, ${rec.comparison.allPass ? "within tolerance" : "outside tolerance"}${rec.train ? `, pulses ${rec.train.burstStartsMs.length}, glitches ${rec.train.glitches.length}` : ""}`);
}
