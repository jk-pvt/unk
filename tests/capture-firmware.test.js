import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePacket } from "../shared/protocol.js";

const dir = mkdtempSync(join(tmpdir(), "aquasdr-cap-"));
const cap = join(dir, "host_capture");
execFileSync("cc", ["-std=c11", "-O1", "-g", "-Wall", "-Wextra", "-Werror", "-fsanitize=address,undefined", "-Ifirmware/src", "firmware/test/host_capture.c", "firmware/src/capture.c", "-o", cap]);
const run = (...a) => execFileSync(cap, a).toString();
const expectedSample = (i) => (i * 37 + (i >> 3)) & 0x0fff;

test("capture sizing: pulse mode is 500 kS/s x 6000, train mode 100 kS/s x 16000, chunks of 600", () => {
  assert.equal(run("sizes").trim(), "500000 6000 100000 16000 600 16000");
  assert.equal(6000 / 500000, 0.012); assert.equal(16000 / 100000, 0.16);
});
test("chunked pulse capture parses with the bridge parser, is contiguous, in order and decodes to the original samples", () => {
  const lines = run("chunks").split("\n").filter(Boolean);
  assert.equal(lines.length, 10);
  let next = 0; const samples = [];
  for (const l of lines) {
    const p = parsePacket(l); assert.equal(p.type, "capture"); assert.equal(p.offset, next); assert.equal(p.id, 7); assert.equal(p.rate, 500000); assert.equal(p.total, 6000);
    for (let i = 0; i < p.n; i++) samples.push(parseInt(p.d.slice(i * 3, i * 3 + 3), 16));
    next += p.n; assert.ok(l.length < 2100, "one chunk line must fit the 4 KB transmit buffer with room to spare");
  }
  assert.equal(next, 6000); assert.equal(samples.length, 6000);
  samples.forEach((v, i) => assert.equal(v, expectedSample(i), `sample ${i}`));
});
test("a buffer that is too small yields no line rather than a truncated one", () => assert.equal(run("toosmall").trim(), "ok"));
test("capture statistics mask to 12 bits and handle an empty buffer", () => {
  // samples 100, 4095, 0, 2000 and 0x1FFF (masked to 4095): min 0, max 4095, mean (100+4095+0+2000+4095)/5 = 2058.0 -> x10 = 20580
  const [a, b] = run("stats").trim().split("\n");
  assert.equal(a, "0 4095 20580");
  assert.equal(b, "0 0 0");
});
test("telemetry capture block matches the bridge schema", () => {
  const status = JSON.parse(run("status"));
  assert.deepEqual(status.capture, { state: "SENDING", id: 3, mode: 1, rateHz: 100000, samples: 16000, sent: 1200, minCounts: 5, maxCounts: 4090, meanCounts: 2048.7, reason: "" });
});
