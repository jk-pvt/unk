import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
let bin;
function harness() {
  if (bin) return bin;
  bin = join(mkdtempSync(join(tmpdir(), "aquasdr-adaptation-")), "host_adaptation");
  execFileSync("cc", ["-O2", "-std=c11", "-Wall", "-Wextra", "-Werror", "-I", join(root, "firmware/src"),
    join(root, "firmware/test/host_adaptation.c"), join(root, "firmware/src/adaptation.c"),
    join(root, "firmware/src/waveform.c"), "-lm", "-o", bin]);
  return bin;
}
for (const scenario of ["startup", "profiles", "hysteresis", "invalid", "stale", "wrap", "waveforms"]) {
  test(`embedded adaptation: ${scenario}`, () => {
    assert.equal(execFileSync(harness(), [scenario]).toString().trim(), "ok");
  });
}
