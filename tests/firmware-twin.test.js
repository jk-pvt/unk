import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, generateSignal } from "../shared/signal.js";

// Digital twin check: the firmware's DDS synthesis (firmware/src/waveform.c),
// compiled for the host, must reproduce the dashboard's closed-form model to
// within 12-bit DAC quantisation for every mode and window.
const root = fileURLToPath(new URL("..", import.meta.url));
const hasCc = spawnSync("cc", ["--version"]).status === 0;

test("firmware pulse synthesis matches the dashboard model", { skip: !hasCc && "no host C compiler" }, () => {
  const bin = join(mkdtempSync(join(tmpdir(), "aquasdr-twin-")), "host_twin");
  execFileSync("cc", ["-O2", "-std=c11", "-Wall", "-Wextra", "-Werror", "-I", join(root, "firmware/src"),
    join(root, "firmware/test/host_twin.c"), join(root, "firmware/src/waveform.c"), "-lm", "-o", bin]);
  const cases = [];
  for (const mode of ["LFM CHIRP", "GEOMETRIC SWEEP", "PHASE-CODED PULSE"])
    for (const window of ["RECT", "HANN", "HAMMING", "BLACKMAN"]) cases.push({ ...DEFAULT_CONFIG, mode, window });
  cases.push({ ...DEFAULT_CONFIG, bandwidth: 1.2, pulse: 8 }, { ...DEFAULT_CONFIG, frequency: 120, bandwidth: 30, pulse: 5, amplitude: 90 });
  for (const cfg of cases) {
    const lines = execFileSync(bin, [cfg.mode, cfg.window, cfg.frequency, cfg.bandwidth, cfg.pulse, cfg.amplitude].map(String), {
      maxBuffer: 1 << 24,
    }).toString().trim().split("\n").map(Number);
    const n = lines.shift();
    const ref = generateSignal(cfg);
    assert.equal(n, ref.length, `${cfg.mode} ${cfg.window}: sample count`);
    let worst = 0;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(lines[i] - ref[i]));
    // Rounding to a 12-bit code costs at most half a DAC step (0.5/2047).
    assert.ok(worst < 0.75 / 2047, `${cfg.mode} ${cfg.window} ${cfg.frequency} kHz: max error ${worst.toFixed(5)}`);
  }
});
