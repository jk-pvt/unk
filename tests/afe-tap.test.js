import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { referenceFor, PROFILES } from "../shared/bench-capture.js";
import { gainDb, applyTap, adcPinRange, TAP_IDS, ADC_SAFE_V } from "../shared/afe-model.js";
import { analyzeMcu, buildMcuRecord, mcuCsv, compareTaps, predictedAdcRange, checkTap, MCU_PROVENANCE } from "../shared/mcu-capture.js";
import { BenchStore } from "../server/bench-store.js";

// Everything here is SYNTHETIC: ADC counts are generated from the calculated waveform through the model, with a little noise. It tests the
// plumbing and the labelling. It is not evidence about any built circuit.
const design = JSON.parse(readFileSync(new URL("../hardware/analog/design_results.json", import.meta.url), "utf8"));
const RATE = 500000, N = 6000;
function synth(tap, expected, window, { noise = 0.8, seed = 1 } = {}) {
  const ref = referenceFor({ ...expected, window }, 1, RATE), counts = new Uint16Array(N).fill(2048);
  const abs = Float64Array.from(ref.samples, (v) => v + 1.65);
  const y = applyTap(abs, RATE, tap);
  let r = seed; const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 2;
  for (let i = 0; i < N; i++) counts[i] = Math.max(0, Math.min(4095, Math.round(2048 + noise * rnd())));
  y.forEach((v, i) => { if (150 + i < N) counts[150 + i] = Math.max(0, Math.min(4095, Math.round((v / 3.3) * 4095 + noise * rnd()))); });
  return counts;
}
const rec = (tap, window = "HANN", id = 1) => buildMcuRecord({ id, mode: 0, rate: RATE, counts: synth(tap, PROFILES.CLEAR, window), expected: PROFILES.CLEAR, profile: "CLEAR", window, tap });

test("the JavaScript stage model agrees with the Python netlist solution (two independent implementations)", () => {
  for (const r of design.response) {
    const inBand = r.hz >= 36e3 && r.hz <= 44e3, tol = inBand ? 0.05 : 0.2;
    assert.ok(Math.abs(gainDb("AFE_FILTER", r.hz) - r.filter_out_db) <= tol, `filter at ${r.hz}`);
    assert.ok(Math.abs(gainDb("AFE_OUTPUT", r.hz) - r.adc_in_db) <= tol, `ADC tap at ${r.hz}`);
  }
  assert.ok(Math.abs(gainDb("AFE_OUTPUT", 42e3) - 3.1) < 0.1, "about +3.1 dB at 42 kHz");
  assert.equal(gainDb("RAW_DAC", 42e3), 0);
  assert.throws(() => checkTap("SCOPE"), /tap must be one of/);
});

test("a stage capture is judged against the model: correct declaration passes, a mislabelled one is caught", () => {
  const counts = synth("AFE_OUTPUT", PROFILES.CLEAR, "HANN");
  const right = analyzeMcu({ counts, rate: RATE, mode: 0, expected: { ...PROFILES.CLEAR, window: "HANN" }, tap: "AFE_OUTPUT" });
  assert.equal(right.allPass, true, JSON.stringify(right.rows.filter((r) => r.pass === false)));
  const wrong = analyzeMcu({ counts, rate: RATE, mode: 0, expected: { ...PROFILES.CLEAR, window: "HANN" }, tap: "RAW_DAC" });
  assert.equal(wrong.rows.find((r) => r.name === "Peak-to-peak").pass, false, "stage output declared as raw must fail the amplitude row");
  const raw = analyzeMcu({ counts: synth("RAW_DAC", PROFILES.CLEAR, "HANN"), rate: RATE, mode: 0, expected: { ...PROFILES.CLEAR, window: "HANN" } });
  assert.equal(raw.allPass, true, "default tap is unchanged behaviour");
});

test("records name the tap, keep the MCU ADC CAPTURE provenance and never say oscilloscope or measured", () => {
  const r = rec("AFE_OUTPUT");
  assert.equal(r.provenance, MCU_PROVENANCE); assert.equal(r.tap, "AFE_OUTPUT"); assert.match(r.tapLabel, /filtered output/);
  assert.ok(r.limits.some((l) => /DESIGNED stage/.test(l)) && r.limits.some((l) => /not the transmitter output connector/.test(l)));
  assert.equal(r.computed.provenance, "COMPUTED"); assert.match(r.computed.model, /through the designed analog stage/);
  assert.match(mcuCsv(r, synth("AFE_OUTPUT", PROFILES.CLEAR, "HANN")), /tap AFE_OUTPUT[\s\S]*NOT an oscilloscope measurement/);
  assert.equal(rec("RAW_DAC").limits.length, 4, "raw records keep exactly the original limits");
  assert.doesNotMatch(JSON.stringify(r.limits) + r.source.description, /MEASURED/);
});

test("raw vs stage comparison reports the gain the ADC read against the designed gain, and refuses mismatched setups", () => {
  const c = compareTaps(rec("RAW_DAC", "HANN", 1), rec("AFE_OUTPUT", "HANN", 2));
  assert.equal(c.ok, true); assert.equal(c.allPass, true, JSON.stringify(c.rows.filter((r) => r.pass === false)));
  assert.ok(Math.abs(c.gainDb - 3.1) < 0.35, `gain ${c.gainDb}`); assert.ok(Math.abs(c.gainDb - c.modelGainDb) < 0.35);
  assert.ok(c.rows.some((r) => r.informational && /Noise floor/.test(r.name)));
  assert.match(c.note, /Both sides are MCU ADC captures/);
  assert.equal(compareTaps(rec("RAW_DAC", "HANN"), rec("AFE_OUTPUT", "RECT")).ok, false);
  assert.equal(compareTaps(rec("AFE_OUTPUT"), rec("AFE_OUTPUT")).ok, false);
  assert.equal(compareTaps(rec("RAW_DAC"), rec("RAW_DAC")).ok, false);
  assert.equal(compareTaps(null, rec("AFE_OUTPUT")).ok, false);
  // a stage that is actually broken (output 30 % low, e.g. wrong feedback resistor) must be flagged, not smoothed over
  const bad = rec("AFE_OUTPUT", "HANN", 3), counts = synth("AFE_OUTPUT", PROFILES.CLEAR, "HANN").map((v) => Math.round(2048 + (v - 2048) * 0.7));
  const lowRec = buildMcuRecord({ id: 4, mode: 0, rate: RATE, counts: Uint16Array.from(counts), expected: PROFILES.CLEAR, window: "HANN", tap: "AFE_OUTPUT" });
  assert.equal(compareTaps(rec("RAW_DAC", "HANN", 1), lowRec).rows[0].pass, false); assert.ok(bad);
});

test("safe-range guard: policy waveforms fit the ADC tap, an over-driven one is refused before anything is enabled", () => {
  for (const p of ["CLEAR", "TRANSITION", "MURKY"]) for (const w of ["RECT", "HANN", "HAMMING", "BLACKMAN"]) for (const t of ["AFE_FILTER", "AFE_OUTPUT"]) {
    const r = predictedAdcRange({ ...PROFILES[p], window: w }, t); assert.ok(r.safe, `${p}/${w}/${t}: ${r.min.toFixed(2)}..${r.max.toFixed(2)}`);
  }
  const hot = predictedAdcRange({ ...PROFILES.CLEAR, amplitude: 100, window: "RECT" }, "AFE_OUTPUT");
  assert.equal(hot.safe, false); assert.ok(hot.max > ADC_SAFE_V.hi || hot.min < ADC_SAFE_V.lo);
  // the Python design reports the same verdict for the three policy profiles
  for (const [k, v] of Object.entries(design.expected_profiles)) assert.equal(v.adc_tap_safe, true, k);
  assert.deepEqual(TAP_IDS, ["RAW_DAC", "AFE_FILTER", "AFE_OUTPUT"]);
});

test("store pairs the newest stage capture with the raw capture of the same waveform", async () => {
  const store = new BenchStore(await mkdtemp(join(tmpdir(), "aquasdr-tap-")));
  const add = (tap, window, id) => store.addMcu({ id, mode: 0, rate: RATE, counts: synth(tap, PROFILES.CLEAR, window), expected: PROFILES.CLEAR, profile: "CLEAR", window, deviceStats: null, firmware: null, label: "", tap });
  await add("RAW_DAC", "HANN", 1); assert.deepEqual((await store.mcuEvidence()).comparisons, []);
  await add("AFE_OUTPUT", "HANN", 2); await add("AFE_OUTPUT", "RECT", 3);
  const ev = await store.mcuEvidence();
  assert.equal(ev.comparisons.length, 1, "RECT stage capture has no raw RECT partner yet"); assert.equal(ev.comparisons[0].window, "HANN");
  assert.equal(ev.captures.find((c) => c.captureId === 2).tap, "AFE_OUTPUT");
});
