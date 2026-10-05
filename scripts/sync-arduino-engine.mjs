#!/usr/bin/env node
// Copies the shared C engine (the same sources the bare-metal image and the host simulation use) into the
// combined Arduino sketch, and writes its build_opt.h. One adaptation policy, not two.
//   node scripts/sync-arduino-engine.mjs          # write
//   node scripts/sync-arduino-engine.mjs --check  # exit 1 if the copies drifted
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FILES = ["adaptation.c", "adaptation.h", "command.c", "config.h", "control.c", "control.h", "telemetry.c", "telemetry.h", "waveform.c", "waveform.h", "capture.c", "capture.h"];
export const SENSOR_FILES = ["SensorMath.h", "AquaSdrLogo.h"];  // copied unchanged from 04_all_sensors
export const SKETCH = resolve(root, "arduino/05_sensors_adaptive_tx");
export const OPTIONS = ["-DAQUASDR_COMBINED=1", "-DAQUASDR_CAPTURE=1", '-DFW_PLATFORM=\\"ARDUINO_COMBINED\\"', '-DADC_SENSOR_LABEL=\\"TDS_PROXY\\"',
  "-DADC_FULLSCALE_COUNTS=2854",  // 2.3 V TDS board full scale on a 3.3 V, 12-bit ADC
  "-DADAPT_STALE_MS=1500u",       // the combined loop blocks for display and sensor work
  "-DMAX_PULSE_MS=10u",           // largest policy pulse is 8 ms; keeps both pulse buffers at 40 KB total
  "-DSERIAL_RX_BUFFER_SIZE=512"]; // commands arrive through the core Serial ring; 512 B holds a full command

const build = () => { try { return execFileSync("git", ["describe", "--always", "--dirty", "--abbrev=7"], { cwd: root }).toString().trim(); } catch { return "dev"; } };
const optionsText = () => [...OPTIONS, `-DFW_BUILD=\\"${build()}\\"`].join("\n") + "\n";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let drift = 0;
  for (const f of FILES) {
    const src = resolve(root, "firmware/src", f), dst = resolve(SKETCH, "src/engine", f);
    if (check) {
      const [a, b] = await Promise.all([readFile(src, "utf8"), readFile(dst, "utf8").catch(() => null)]);
      if (a !== b) { console.error(`DRIFT ${f}`); drift++; }
    } else { await mkdir(dirname(dst), { recursive: true }); await copyFile(src, dst); }
  }
  for (const f of SENSOR_FILES) {
    const src = resolve(root, "arduino/04_all_sensors", f), dst = resolve(SKETCH, f);
    if (check) { const [a, b] = await Promise.all([readFile(src, "utf8"), readFile(dst, "utf8").catch(() => null)]); if (a !== b) { console.error(`DRIFT ${f}`); drift++; } }
    else await copyFile(src, dst);
  }
  if (!check) { await writeFile(resolve(SKETCH, "build_opt.h"), optionsText()); console.log(`synced ${FILES.length} files, build ${build()}`); }
  else process.exit(drift ? 1 : 0);
}
