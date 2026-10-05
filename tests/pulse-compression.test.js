import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { referenceFor, PROFILES } from "../shared/bench-capture.js";
import { classMatch, compress, templateFor, compressionEvidence, CLASS_MODES } from "../shared/pulse-compression.js";
import { analyzeMcu } from "../shared/mcu-capture.js";

// SYNTHETIC captures: the calculated waveform with 12-bit rounding and a little noise. They test the analysis, not the board.
const RATE = 500000, N = 6000;
function synth(mode, window, { noise = 0.8, seed = 3 } = {}) {
  const ref = referenceFor({ ...PROFILES.CLEAR, mode, window }, 1, RATE).samples; let r = seed; const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 2;
  const counts = new Uint16Array(N); for (let i = 0; i < N; i++) counts[i] = Math.round(2048 + noise * rnd());
  ref.forEach((v, i) => { if (150 + i < N) counts[150 + i] = Math.round(((1.65 + v) / 3.3) * 4095 + noise * rnd()); });
  return counts;
}
const volts = (c) => Float64Array.from(c, (x) => (x / 4095) * 3.3);
const exp = (mode, window = "HANN") => ({ ...PROFILES.CLEAR, mode, window });

test("class check: Barker is separated from the sweeps by a wide margin", () => {
  const m = classMatch(volts(synth(CLASS_MODES.BARKER, "HANN")), RATE, exp(CLASS_MODES.BARKER));
  assert.equal(m.best, "BARKER"); assert.ok(m.scores.BARKER > 0.98 && m.scores.LFM < 0.4 && m.scores.GEOMETRIC < 0.4, JSON.stringify(m.scores)); assert.equal(m.pass, true); assert.deepEqual(m.ambiguousWith, []);
});

test("class check: at the 4 kHz policy sweep LFM and geometric are reported as indistinguishable, never as a win", () => {
  for (const mode of [CLASS_MODES.LFM, CLASS_MODES.GEOMETRIC]) {
    const m = classMatch(volts(synth(mode, "HANN")), RATE, exp(mode));
    assert.equal(m.pass, true); assert.equal(m.ambiguousWith.length, 1, `${mode}: ${JSON.stringify(m.scores)}`);
    assert.ok(m.margin < 0.01, "the two sweeps must score within 0.01 of each other");
  }
  assert.ok(classMatch(volts(synth(CLASS_MODES.LFM, "HANN")), RATE, exp(CLASS_MODES.LFM)).scores.BARKER < 0.4);
});

test("a wide sweep would separate the classes: the model says what bandwidth is needed", () => {
  const wide = { ...PROFILES.CLEAR, bandwidth: 30, mode: CLASS_MODES.LFM, window: "HANN" };
  const a = templateFor(wide, "LFM", RATE), b = templateFor(wide, "GEOMETRIC", RATE), pad = new Float64Array(N); a.forEach((v, i) => (pad[150 + i] = v));
  const rho = compress(pad, RATE, b).rho; assert.ok(rho < 0.95, `LFM vs geometric at 30 kHz sweep correlate at ${rho}`);
});

test("unwindowed Barker-13 has the textbook 13:1 peak sidelobe (about -22 dB) in the calculation and in a noisy capture", () => {
  const ev = compressionEvidence(volts(synth(CLASS_MODES.BARKER, "RECT")), RATE, exp(CLASS_MODES.BARKER, "RECT"));
  assert.ok(Math.abs(ev.calculated.pslDb - -22.3) < 1.5, `calculated ${ev.calculated.pslDb}`); assert.ok(Math.abs(ev.measured.pslDb - ev.calculated.pslDb) < 3);
  assert.ok(ev.rows.find((r) => /Peak sidelobe/.test(r.name)).pass === true, "sidelobe above the noise floor is judged");
});

test("phase-coded rows: 20 % envelope width is informational, the energy width is judged; LFM still judges the 20 % width", () => {
  const bark = analyzeMcu({ counts: synth(CLASS_MODES.BARKER, "HANN"), rate: RATE, mode: 0, expected: exp(CLASS_MODES.BARKER) });
  assert.equal(bark.allPass, true, JSON.stringify(bark.rows.filter((r) => r.pass === false)));
  const r20 = bark.rows.find((r) => /20 % envelope/.test(r.name)); assert.equal(r20.pass, null); assert.match(r20.name, /informational/);
  assert.equal(bark.rows.find((r) => /central 90 %/.test(r.name)).pass, true);
  const lfm = analyzeMcu({ counts: synth(CLASS_MODES.LFM, "HANN"), rate: RATE, mode: 0, expected: exp(CLASS_MODES.LFM) });
  assert.equal(lfm.rows.find((r) => /20 % envelope/.test(r.name)).pass, true);
  assert.ok(lfm.compression.classMatch.pass);
});

test("a capture of the wrong class fails the class check and the template match", () => {
  const counts = synth(CLASS_MODES.BARKER, "HANN");
  const a = analyzeMcu({ counts, rate: RATE, mode: 0, expected: exp(CLASS_MODES.LFM) });
  assert.equal(a.allPass, false); assert.equal(a.compression.classMatch.pass, false); assert.equal(a.compression.classMatch.best, "BARKER");
  assert.equal(a.rows.find((r) => /Template match/.test(r.name)).pass, false);
});

test("A0 policy table comes from the C engine and shows the hysteresis (skipped without a C compiler)", (t) => {
  let out; try { out = JSON.parse(execFileSync(process.execPath, ["scripts/a0-policy-table.mjs"], { encoding: "utf8" })); } catch (e) { t.skip("no C compiler: " + String(e.message).slice(0, 60)); return; }
  const at = (d, from) => out.transitions.find((x) => x.direction === d && x.from === from);
  assert.ok(Math.abs(at("rising", "CLEAR").atLevelPct - 40) <= 0.5 && Math.abs(at("rising", "TRANSITION").atLevelPct - 75) <= 0.5);
  assert.ok(Math.abs(at("falling", "MURKY").atLevelPct - 65) <= 0.5 && Math.abs(at("falling", "TRANSITION").atLevelPct - 30) <= 0.5);
  assert.ok(at("falling", "TRANSITION").adcCounts < at("rising", "CLEAR").adcCounts, "hysteresis: the way back is lower than the way up");
  assert.match(out.caveats.join(" "), /TDS_PROXY.*not turbidity/);
});
