import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { buildLadder, stageCaptureCount } from "../shared/evidence-ladder.js";

const rec = (mode, window, over = {}) => ({ mode: "pulse", window, expected: { mode }, tap: "RAW_DAC", capturedAt: `2026-10-02T07:${String(10 + WINDOW_IDX[window]).padStart(2, "0")}:00Z`, profile: "CLEAR",
  comparison: { allPass: true, rows: [{ pass: true }, { pass: true }, { pass: null }] }, ...over });
const WINDOW_IDX = { RECT: 0, HANN: 1, HAMMING: 2, BLACKMAN: 3 };

test("ladder reports each layer separately: nothing captured means NONE and external PENDING", () => {
  const l = buildLadder({ mcu: [], external: [], modeledRxAvailable: true });
  assert.equal(l.length, 3);
  for (const r of l) { assert.equal(r.mcu.state, "NONE"); assert.equal(r.external.state, "PENDING"); assert.equal(r.calculated.state, "AVAILABLE"); assert.equal(r.modeledRx.state, "MODEL ONLY"); }
  assert.equal(buildLadder({ modeledRxAvailable: false })[0].modeledRx.state, "NOT PREPARED");
});

test("ladder counts captures per class and window, flags windows outside tolerance, and ignores stage taps and train captures", () => {
  const mcu = [rec("LFM CHIRP", "RECT"), rec("LFM CHIRP", "HANN"), rec("LFM CHIRP", "HAMMING"), rec("LFM CHIRP", "BLACKMAN"),
    rec("PHASE-CODED PULSE", "HANN"), rec("PHASE-CODED PULSE", "RECT", { comparison: { allPass: false, rows: [{ pass: false }, { pass: true }] } }),
    rec("GEOMETRIC SWEEP", "HANN", { tap: "AFE_OUTPUT" }), { ...rec("GEOMETRIC SWEEP", "HANN"), mode: "train" }];
  const [lfm, geo, barker] = buildLadder({ mcu, external: [], modeledRxAvailable: false });
  assert.equal(lfm.mcu.state, "COMPLETE"); assert.equal(lfm.mcu.rowsTotal, 8); assert.equal(lfm.mcu.rowsWithin, 8);
  assert.equal(geo.mcu.state, "NONE", "stage-tap and train captures must not count as raw pulse coverage");
  assert.equal(barker.mcu.state, "PARTIAL"); assert.deepEqual(barker.mcu.windows, ["RECT", "HANN"]); assert.deepEqual(barker.mcu.windowsOutside, ["RECT"]);
  assert.equal(stageCaptureCount(mcu), 1);
});

test("a newer capture of the same window replaces the older one in the tally", () => {
  const old = rec("LFM CHIRP", "HANN", { capturedAt: "2026-10-02T06:00:00Z", comparison: { allPass: false, rows: [{ pass: false }] } });
  const [lfm] = buildLadder({ mcu: [old, rec("LFM CHIRP", "HANN")] });
  assert.equal(lfm.mcu.windowsOutside.length, 0); assert.equal(lfm.mcu.rowsTotal, 2);
});

test("external instrument layer flips to IMPORTED only when an external capture of that class exists", () => {
  const [lfm, geo] = buildLadder({ external: [{ mode: "LFM CHIRP", provenance: "MEASURED" }] });
  assert.equal(lfm.external.state, "IMPORTED"); assert.equal(geo.external.state, "PENDING");
});

