import test from "node:test";
import assert from "node:assert/strict";
import { generateSignal } from "../shared/signal.js";
import { parseScopeCsv, analyzeCapture, buildRecord, referenceFor, PROFILES } from "../shared/bench-capture.js";

// These captures are SYNTHETIC test inputs made inside the test; they are never written to data/bench.
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
function synthCapture({ profile = "MURKY", window = "HANN", rate = 5e6, gain = 1, noise = 0.002, dc = 1.65, freqShift = 0, windowMs = 20 }) {
  const p = PROFILES[profile];
  const ref = referenceFor({ ...p, frequency: p.frequency + freqShift, window }, gain, rate);
  const n = Math.round(rate * windowMs / 1000), out = new Float64Array(n), off = Math.round(rate * 0.003);
  ref.samples.forEach((v, i) => { if (off + i < n) out[off + i] = v; });
  return Float64Array.from(out, (v) => v + dc + noise * rnd());
}
const toCsv = (samples, rate, header = true) => (header ? "Time (s),CH1 (V)\n" : "") + Array.from(samples, (v, i) => `${(i / rate).toExponential(6)},${v.toFixed(5)}`).join("\n");

test("scope CSV: header skipped, rate inferred from the time column, bad inputs rejected", () => {
  const s = synthCapture({}); const { samples, sampleRate } = parseScopeCsv(toCsv(s, 5e6));
  assert.equal(sampleRate, 5e6); assert.equal(samples.length, s.length);
  assert.throws(() => parseScopeCsv("1\n2\n3"), /at least 64/);
  const one = Array.from({ length: 100 }, (_, i) => Math.sin(i)).join("\n");
  assert.throws(() => parseScopeCsv(one), /sample rate/);
  assert.equal(parseScopeCsv(one, { rate: 1e6 }).sampleRate, 1e6);
  assert.throws(() => parseScopeCsv(toCsv(s, 5e6).replace(/\n.*\n/, "\n0.5,1\n")), /uniformly/);
});

test("analysis recovers frequency, duration and Vpp from a noisy offset capture", () => {
  const rate = 5e6, p = PROFILES.MURKY, s = synthCapture({ rate, gain: 1 });
  const m = analyzeCapture(s, rate, { ...p, window: "HANN" });
  assert.ok(Math.abs(m.peakKHz - 38) < 0.6, `peak ${m.peakKHz}`);
  assert.ok(Math.abs(m.dcOffsetV - 1.65) < 0.01);
  assert.ok(m.burst.durationMs > 4 && m.burst.durationMs < 8.1, `duration ${m.burst.durationMs}`);
  const expectedVpp = 0.62 * 3.3 * (2047 / 4095) * 2;
  assert.ok(Math.abs(m.vpp - expectedVpp) / expectedVpp < 0.03, `vpp ${m.vpp} vs ${expectedVpp}`);
  assert.equal(m.burst.bursts, 1);
});

test("a measured capture that matches the reference passes; a 2 kHz error and a halved amplitude fail", () => {
  const rate = 5e6, p = PROFILES.MURKY;
  const good = buildRecord({ csv: toCsv(synthCapture({ rate }), rate), point: "PA4", profile: "MURKY", window: "HANN" });
  assert.equal(good.provenance, "MEASURED"); assert.equal(good.computed.provenance, "COMPUTED");
  assert.equal(good.comparison.allPass, true, JSON.stringify(good.comparison.rows.filter((r) => r.pass === false)));
  const shifted = buildRecord({ csv: toCsv(synthCapture({ rate, freqShift: 2 }), rate), point: "PA4", profile: "MURKY", window: "HANN" });
  assert.equal(shifted.comparison.rows.find((r) => r.name === "FFT peak").pass, false);
  const weak = buildRecord({ csv: toCsv(synthCapture({ rate, gain: 0.5 }), rate), point: "PA4", profile: "MURKY", window: "HANN" });
  assert.equal(weak.comparison.rows.find((r) => r.name === "Peak-to-peak").pass, false);
  assert.equal(p.frequency, 38);
});

test("filter-stage gain is part of the expectation, not an error", () => {
  const rate = 5e6, gain = 1.4;
  const r = buildRecord({ csv: toCsv(synthCapture({ rate, gain, profile: "CLEAR", window: "BLACKMAN" }), rate), point: "OPAMP_OUT", profile: "CLEAR", window: "BLACKMAN", gain });
  assert.equal(r.comparison.allPass, true, JSON.stringify(r.comparison.rows));
  assert.ok(Math.abs(r.measured.vpp / (0.35 * 3.3 * (2047 / 4095) * 2) - gain) < 0.05);
});

test("window comparison: the unwindowed pulse leaks more than a windowed one, and the same method sees it", () => {
  const rate = 5e6, leak = {};
  for (const window of ["RECT", "HANN", "HAMMING", "BLACKMAN"]) {
    leak[window] = buildRecord({ csv: toCsv(synthCapture({ rate, profile: "CLEAR", window }), rate), point: "PA4", profile: "CLEAR", window }).measured.leakageDb;
  }
  assert.ok(leak.RECT > leak.HANN + 5, JSON.stringify(leak));
  assert.ok(leak.RECT > leak.BLACKMAN + 5, JSON.stringify(leak));
});

test("input validation", () => {
  const csv = toCsv(synthCapture({}), 5e6);
  assert.throws(() => buildRecord({ csv, point: "TP9", profile: "MURKY", window: "HANN" }), /point/);
  assert.throws(() => buildRecord({ csv, point: "PA4", profile: "NOPE", window: "HANN" }), /profile|config/);
  assert.throws(() => buildRecord({ csv, point: "PA4", profile: "MURKY", window: "TRIANGLE" }), /window/);
  assert.throws(() => buildRecord({ csv: toCsv(new Float64Array(500), 5e6), point: "PA4", profile: "MURKY", window: "HANN" }), /No signal/);
});
