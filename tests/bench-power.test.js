import test from "node:test";
import assert from "node:assert/strict";
import { validatePowerEntry, derivePowerEvidence } from "../shared/bench-power.js";

// Numbers below are arithmetic fixtures for the function, not readings from the prototype.
const entry = (state, voltageV, currentMa, extra = {}) => validatePowerEntry({ state, voltageV, currentMa, instrument: "unit-test meter", measuredPoint: "fixture", ...extra });
test("derived power figures come only from supplied entries", () => {
  assert.deepEqual(derivePowerEvidence([]).missing, ["idle", "web_control", "waveform_active", "pulse_transmit"]);
  assert.equal(derivePowerEvidence([]).energyPerPingUj, null);
  const d = derivePowerEvidence([entry("idle", 5, 100), entry("waveform_active", 5, 110, { pingIntervalMs: 100, pulseMs: 8 })]);
  assert.equal(d.idleMw, 500); assert.equal(d.waveformActiveMw, 550);
  assert.equal(d.energyPerPingUj, 50 * 100); assert.equal(d.dutyCycle, 0.08);
  assert.equal(d.pulseEnergyUj, null, "no peak reading, so no pulse energy");
  assert.deepEqual(d.missing, ["web_control", "pulse_transmit"]);
});
test("pulse energy needs the peak reading and the pulse length", () => {
  const d = derivePowerEvidence([entry("idle", 5, 100), entry("pulse_transmit", 5, 130, { pulseMs: 8 })]);
  assert.equal(d.pulseEnergyUj, 150 * 8);
});
test("validation rejects unattributed or impossible readings", () => {
  assert.throws(() => validatePowerEntry({ state: "idle", voltageV: 5, currentMa: 100 }), /instrument/);
  assert.throws(() => entry("sleeping", 5, 1), /state/);
  assert.throws(() => entry("idle", 0, 1), /voltageV/);
  assert.throws(() => entry("idle", 5, -1), /currentMa/);
  assert.throws(() => validatePowerEntry({ state: "idle", voltageV: 5, currentMa: 1, instrument: "m" }), /measuredPoint/);
});
test("latest entry per state wins", () => {
  const a = entry("idle", 5, 100), b = { ...entry("idle", 5, 90), capturedAt: "2999-01-01T00:00:00.000Z" };
  assert.equal(derivePowerEvidence([b, a]).idleMw, 450);
});
