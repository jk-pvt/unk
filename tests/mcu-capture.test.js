import test from "node:test";
import assert from "node:assert/strict";
import { referenceFor, PROFILES, parseScopeCsv } from "../shared/bench-capture.js";
import { CaptureAssembler, decodeChunk, countsToVolts, analyzeMcu, buildMcuRecord, mcuCsv, MCU_PROVENANCE, LIMITS, burstStartsMs } from "../shared/mcu-capture.js";

// SYNTHETIC inputs built inside the tests (a model of what the ADC would return). They are never stored as evidence.
let seed = 99; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
const hex3 = (a) => Array.from(a, (v) => v.toString(16).toUpperCase().padStart(3, "0")).join("");
function adcCounts({ profile = "CLEAR", window = "HANN", rate = 500000, n = 6000, preRollMs = 0.3, gain = 1, noiseCounts = 1.5, trainGapMs = null, freqShift = 0 }) {
  const p = PROFILES[profile], ref = referenceFor({ ...p, frequency: p.frequency + freqShift, window }, gain, rate);
  const out = new Uint16Array(n), off = Math.round(preRollMs / 1000 * rate);
  const put = (at) => ref.samples.forEach((v, i) => { const k = at + i; if (k < n) out[k] = Math.max(0, Math.min(4095, Math.round(((1.65 + v) / 3.3) * 4095 + noiseCounts * rnd() * 2))); });
  out.fill(Math.round(1.65 / 3.3 * 4095)); put(off); if (trainGapMs) put(off + Math.round(trainGapMs / 1000 * rate));
  return out;
}
const packets = (counts, { id = 1, mode = 0, rate = 500000, chunk = 600 } = {}) => {
  const out = []; for (let o = 0; o < counts.length; o += chunk) { const s = counts.subarray(o, o + chunk); out.push({ version: 1, type: "capture", id, mode, rate, total: counts.length, offset: o, n: s.length, d: hex3(s) }); } return out;
};

test("buffer sizing: pulse mode covers pre-roll + the longest policy pulse, train mode covers two pulses 100 ms apart", () => {
  const pulse = 6000 / 500000 * 1000, train = 16000 / 100000 * 1000;
  assert.ok(pulse >= 0.3 + 8 + 2, `${pulse} ms must hold 0.3 ms pre-roll, an 8 ms pulse and margin`);
  assert.ok(train >= 100 + 8 + 20, `${train} ms must hold two pulses 100 ms apart`);
  assert.ok(500000 / 44000 >= 11, "at least 11 samples per cycle at the top of the sweep");
});

test("assembler: in-order chunks reassemble exactly, in sample order", () => {
  const counts = Uint16Array.from({ length: 6000 }, (_, i) => (i * 37 + (i >> 3)) & 0xfff), a = new CaptureAssembler(); let done;
  for (const p of packets(counts)) { const r = a.add(p); if (r.complete) done = r.complete; }
  assert.ok(done); assert.deepEqual(Array.from(done.counts), Array.from(counts)); assert.equal(done.rate, 500000); assert.equal(done.mode, 0);
  assert.deepEqual(Array.from(decodeChunk(packets(counts)[3])), Array.from(counts.subarray(1800, 2400)));
});
test("assembler: a gap, a reorder or a changed header invalidates the capture; a duplicate is ignored", () => {
  const counts = Uint16Array.from({ length: 6000 }, (_, i) => i & 0xfff), ps = packets(counts);
  let a = new CaptureAssembler(); a.add(ps[0]); assert.match(a.add(ps[2]).error, /gap/); assert.ok(a.add(ps[1]).error, "stays failed");
  a = new CaptureAssembler(); a.add(ps[0]); assert.equal(a.add(ps[0]).duplicate, true); a.add(ps[1]); assert.equal(a.current.next, 1200);
  a = new CaptureAssembler(); a.add(ps[0]); assert.match(a.add({ ...ps[1], rate: 100000 }).error, /header changed/);
  a = new CaptureAssembler(); a.add(ps[0]); a.add({ ...ps[0], id: 2 }); assert.match(a.failed.get(1), /superseded/);
});

test("counts to volts is ratiometric: mid-scale is half of the assumed reference, full scale is the reference", () => {
  const v = countsToVolts([0, 2048, 4095]); assert.equal(v[0], 0); assert.ok(Math.abs(v[1] - 1.6504) < 1e-3); assert.ok(Math.abs(v[2] - 3.3) < 1e-9);
});

test("pulse analysis: frequency, duration, Vpp, envelope and FFT peak are recovered from a noisy 12-bit capture and match the reference", () => {
  const counts = adcCounts({}), a = analyzeMcu({ counts, rate: 500000, mode: 0, expected: { ...PROFILES.CLEAR, window: "HANN" } });
  assert.ok(a.ok); assert.ok(Math.abs(a.measured.peakKHz - 42) < 2.1, `fft peak ${a.measured.peakKHz}`);   // peak sits anywhere inside the 4 kHz sweep
  assert.ok(Math.abs(a.measured.centroidKHz - 42) < 0.5, `centroid ${a.measured.centroidKHz}`);
  assert.ok(a.measured.burst.durationMs > 1.0 && a.measured.burst.durationMs < 2.1, `duration ${a.measured.burst.durationMs}`);
  const expectVpp = 0.35 * 3.3 * (2047 / 4095) * 2;
  assert.ok(Math.abs(a.measured.vpp - expectVpp) / expectVpp < 0.06, `vpp ${a.measured.vpp} vs ${expectVpp}`);
  assert.equal(a.allPass, true, JSON.stringify(a.rows.filter((r) => r.pass === false)));
  assert.equal(a.measured.burst.bursts, 1);
});
test("pulse detection works for the longest policy pulse (MURKY, 8 ms) inside the 12 ms window", () => {
  const counts = adcCounts({ profile: "MURKY" }), a = analyzeMcu({ counts, rate: 500000, mode: 0, expected: { ...PROFILES.MURKY, window: "HANN" } });
  assert.ok(a.ok && a.measured.burst.durationMs > 5 && a.measured.burst.durationMs < 8.2); assert.equal(a.allPass, true, JSON.stringify(a.rows.filter((r) => r.pass === false)));
});
test("a wrong amplitude, a wrong frequency and a wrong window are all caught by the calculated-vs-captured comparison", () => {
  const exp = { ...PROFILES.CLEAR, window: "HANN" };
  assert.equal(analyzeMcu({ counts: adcCounts({ gain: 0.5 }), rate: 500000, mode: 0, expected: exp }).rows.find((r) => r.name === "Peak-to-peak").pass, false);
  assert.equal(analyzeMcu({ counts: adcCounts({ freqShift: 3 }), rate: 500000, mode: 0, expected: exp }).rows.find((r) => r.name === "Spectral centroid").pass, false);
  const rect = analyzeMcu({ counts: adcCounts({ window: "RECT" }), rate: 500000, mode: 0, expected: { ...PROFILES.CLEAR, window: "RECT" } });
  const hann = analyzeMcu({ counts: adcCounts({ window: "HANN" }), rate: 500000, mode: 0, expected: exp });
  assert.ok(rect.measured.leakageDb > hann.measured.leakageDb + 5, `RECT ${rect.measured.leakageDb} vs HANN ${hann.measured.leakageDb}`);
});
test("window comparison across RECT, HANN, HAMMING and BLACKMAN: every window analyses and the unwindowed pulse leaks most", () => {
  const leak = {};
  for (const window of ["RECT", "HANN", "HAMMING", "BLACKMAN"]) { const a = analyzeMcu({ counts: adcCounts({ window }), rate: 500000, mode: 0, expected: { ...PROFILES.CLEAR, window } }); assert.ok(a.ok, window); leak[window] = a.measured.leakageDb; }
  assert.ok(leak.RECT > leak.HANN && leak.RECT > leak.HAMMING && leak.RECT > leak.BLACKMAN, JSON.stringify(leak));
});

test("train mode: two pulses 100 ms apart give a repetition interval near 100 ms; amplitude and frequency are explicitly not claimed", () => {
  const counts = adcCounts({ rate: 100000, n: 16000, trainGapMs: 100, preRollMs: 0.5 });
  const a = analyzeMcu({ counts, rate: 100000, mode: 1, expected: { ...PROFILES.CLEAR, window: "HANN" } });
  const interval = a.rows.find((r) => r.name === "Pulse repetition interval");
  assert.ok(Math.abs(interval.measured - 100) < 3, `interval ${interval.measured}`); assert.equal(a.rows.find((r) => r.name === "Pulses in capture").measured, 2);
  assert.equal(a.allPass, true, JSON.stringify(a.rows)); assert.match(a.note, /not reliable/i);
  assert.equal(burstStartsMs(adcCounts({ rate: 100000, n: 16000 }).map((c) => c), 100000).starts.length >= 1, true);
  const single = analyzeMcu({ counts: adcCounts({ rate: 100000, n: 16000 }), rate: 100000, mode: 1, expected: { ...PROFILES.CLEAR, window: "HANN" } });
  assert.equal(single.rows.find((r) => r.name === "Pulses in capture").pass, false, "one pulse where two are expected must fail");
});

test("record: provenance is MCU_ADC_CAPTURE (never MEASURED), limits are attached, no distortion figure exists, device stats are cross-checked", () => {
  const counts = adcCounts({}), s = (() => { let lo = 4095, hi = 0, sum = 0; for (const c of counts) { lo = Math.min(lo, c); hi = Math.max(hi, c); sum += c; } return { minCounts: lo, maxCounts: hi, meanCounts: sum / counts.length }; })();
  const r = buildMcuRecord({ id: 5, mode: 0, rate: 500000, counts, expected: PROFILES.CLEAR, profile: "CLEAR", window: "HANN", deviceStats: s });
  assert.equal(r.provenance, MCU_PROVENANCE); assert.notEqual(r.provenance, "MEASURED"); assert.equal(r.computed.provenance, "COMPUTED");
  assert.deepEqual(r.limits, LIMITS); assert.ok(r.limits.some((l) => /not an oscilloscope/i.test(l))); assert.equal(r.source.vrefIsAssumed, true);
  assert.equal(r.deviceStatsAgree, true);
  assert.equal(buildMcuRecord({ id: 5, mode: 0, rate: 500000, counts, expected: PROFILES.CLEAR, window: "HANN", deviceStats: { ...s, maxCounts: s.maxCounts + 10 } }).deviceStatsAgree, false);
  assert.ok(!JSON.stringify(r).match(/thd|distortion":\s*\d/i), "no distortion metric");
  assert.ok(r.traces.zoom.volts.length === 200 && r.traces.measuredSpectrum.db.length > 100);
  assert.throws(() => buildMcuRecord({ id: 1, mode: 0, rate: 500000, counts, expected: PROFILES.CLEAR, window: "TRIANGLE" }), /window/);
});
test("CSV: header marks it as not an oscilloscope, and the existing bench importer reads it back (rate, volts, sample count)", () => {
  const counts = adcCounts({}), r = buildMcuRecord({ id: 5, mode: 0, rate: 500000, counts, expected: PROFILES.CLEAR, window: "HANN" }), csv = mcuCsv(r, counts);
  assert.match(csv, /NOT an oscilloscope measurement/); assert.match(csv, /time_s,volts,adc_counts/);
  const back = parseScopeCsv(csv); assert.equal(back.sampleRate, 500000); assert.equal(back.samples.length, 6000);
  const v = countsToVolts(counts); for (const i of [0, 1234, 5999]) assert.ok(Math.abs(back.samples[i] - v[i]) < 1e-4, `sample ${i}`);
  assert.equal(csv.trim().split("\n").at(-1).split(",")[2], String(counts[5999]));
});

test("Hamming (8 % edge pedestal) with realistic ADC noise: the 10 % width is informational, the 20 % width is judged and agrees", () => {
  // noise of about 7 counts RMS is what the real capture showed; the pedestal sits on the 10 % threshold, so the 10 % width is unstable
  const counts = adcCounts({ window: "HAMMING", noiseCounts: 12 }), exp = { ...PROFILES.CLEAR, window: "HAMMING" };
  const a = analyzeMcu({ counts, rate: 500000, mode: 0, expected: exp });
  const r10 = a.rows.find((r) => /10 % envelope/.test(r.name)), r20 = a.rows.find((r) => /20 % envelope/.test(r.name));
  assert.equal(r10.pass, null); assert.equal(r10.informational, true);
  assert.equal(r20.pass, true, JSON.stringify(r20)); assert.ok(Math.abs(r20.measured - r20.computed) < 0.06);
  assert.ok(Math.abs(a.reference.burst.duration20Ms - 1.53) < 0.08, `reference 20 % width ${a.reference.burst.duration20Ms}`);
  // the judged row still catches a real duration error: a pulse built for 3 ms checked against a 2 ms expectation
  const long = adcCounts({ window: "HANN" }), p3 = { ...PROFILES.CLEAR, pulse: 3 };
  const bad = analyzeMcu({ counts: long, rate: 500000, mode: 0, expected: { ...p3, window: "HANN" } });
  assert.equal(bad.rows.find((r) => /20 % envelope/.test(r.name)).pass, false);
});

test("train mode: an isolated single-sample spike is reported as a glitch, not counted as a pulse, and does not hide the real pulses", () => {
  const counts = adcCounts({ rate: 100000, n: 16000, trainGapMs: 100, preRollMs: 0.5 });
  counts[1443] = 2369; counts[1755] = 2200;          // the kind of one-sample excursions seen on the real board
  const a = analyzeMcu({ counts, rate: 100000, mode: 1, expected: { ...PROFILES.CLEAR, window: "HANN" } });
  assert.equal(a.rows.find((r) => r.name === "Pulses in capture").measured, 2);
  assert.ok(Math.abs(a.rows.find((r) => r.name === "Pulse repetition interval").measured - 100) < 3);
  assert.ok(a.burst.glitches.length >= 1 && a.burst.glitches.every((g) => g.widthMs < 0.2), JSON.stringify(a.burst.glitches));
  const rec = buildMcuRecord({ id: 9, mode: 1, rate: 100000, counts, expected: PROFILES.CLEAR, window: "HANN" });
  assert.match(rec.train.note, /spike/i); assert.ok(rec.train.glitches.length >= 1);
  // a real pulse is never dropped by the width rule
  assert.equal(analyzeMcu({ counts: adcCounts({ rate: 100000, n: 16000, trainGapMs: 100, preRollMs: 0.5 }), rate: 100000, mode: 1, expected: { ...PROFILES.CLEAR, window: "HANN" } }).rows.find((r) => r.name === "Pulses in capture").measured, 2);
});
