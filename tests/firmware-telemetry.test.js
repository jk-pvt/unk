import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePacket } from "../shared/protocol.js";

// Every packet the firmware can emit must pass the bridge's own parser;
// one bad field would make the dashboard drop the whole packet.
const root = fileURLToPath(new URL("..", import.meta.url));
// Same rules as healthTone() in src/ui/kit.jsx (hardware mode).
const healthTone = (v) => (!v ? "muted" : /fault|error|offline/i.test(v) ? "red" : /ready|active|ok|online|live/i.test(v) ? "ok" : "muted");
const hasCc = spawnSync("cc", ["--version"]).status === 0;

test("firmware telemetry packets pass the bridge parser", { skip: !hasCc && "no host C compiler" }, () => {
  const bin = join(mkdtempSync(join(tmpdir(), "aquasdr-tel-")), "host_telemetry");
  execFileSync("cc", ["-O2", "-std=c11", "-Wall", "-Wextra", "-Werror", "-I", join(root, "firmware/src"),
    join(root, "firmware/test/host_telemetry.c"), join(root, "firmware/src/telemetry.c"), join(root, "firmware/src/capture.c"),
    join(root, "firmware/src/waveform.c"), join(root, "firmware/src/adaptation.c"), join(root, "firmware/src/control.c"), "-lm", "-o", bin]);
  const lines = execFileSync(bin).toString().split("\n").filter(Boolean);
  assert.equal(lines.length, 6);
  const [pulsed, cw, worst, waiting, applied, invalid] = lines.map(parsePacket);

  assert.equal(pulsed.timestamp, "1970-01-01T00:00:01.234Z");
  assert.deepEqual(pulsed.payload.waveform, { mode: "LFM CHIRP", frequency: 40, bandwidth: 2, pulse: 2, amplitude: 62, window: "HANN" });
  assert.deepEqual(pulsed.payload.engine, { timerHz: 1000000, dmaBuffer: 2000, cpuLoad: 0.37, underruns: 0 });
  assert.equal(pulsed.payload.sensors.temperature, null);
  for (const k of ["STM32", "TIMER", "DMA", "DAC"]) assert.equal(healthTone(pulsed.payload.health[k]), "ok", k);
  assert.equal(healthTone(pulsed.payload.health.TX), "muted");

  assert.equal(cw.payload.waveform, undefined, "CW has no dashboard waveform mode");
  assert.equal(cw.timestamp, "1970-01-01T00:00:59.999Z");
  assert.match(cw.payload.firmware, /40\.000 kHz/);

  assert.equal(healthTone(worst.payload.health.DMA), "red");
  assert.equal(worst.payload.waveform.window, "BLACKMAN");
  assert.ok(lines[2].length < 1024);
  assert.equal(waiting.payload.adaptation.state, "INHIBITED");
  assert.equal(waiting.payload.adaptation.decisionToOutputMs, null);
  assert.equal(applied.payload.adaptation.state, "APPLIED");
  assert.equal(applied.payload.adaptation.profile, "MURKY");
  assert.equal(applied.payload.adaptation.appliedDecisionId, 1);
  assert.equal(applied.payload.adaptation.decisionToOutputMs, 39);
  assert.equal(applied.payload.waveform.frequency, 38);
  assert.equal(applied.payload.sensors.turbidity, null, "dial must not masquerade as measured NTU");
  assert.equal(invalid.payload.adaptation.inputValid, false);
  assert.equal(invalid.payload.adaptation.inputVolts, null);
  assert.match(invalid.payload.health.DAC, /INHIBITED/);
  for (const line of lines) assert.ok(Buffer.byteLength(line) < 1536);
});
