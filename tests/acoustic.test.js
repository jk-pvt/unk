import test from "node:test";
import assert from "node:assert/strict";
import { modelAcousticFrame } from "../shared/acoustic.js";
import { modelOperatingPower } from "../shared/power.js";
import { DEFAULT_CONFIG } from "../shared/signal.js";

const sensors = {
  temperature: 26.8,
  turbidity: 12.4,
  conductivity: 0.66,
  depth: 0.42,
};

test("acoustic pipeline is deterministic and derives all products from one RX frame", () => {
  const input = { config: DEFAULT_CONFIG, sensors, elapsed: 10, frame: 40 };
  const a = modelAcousticFrame(input);
  const b = modelAcousticFrame(input);
  assert.deepEqual(a, b);
  assert.equal(a.echo.length, 320);
  assert.ok(a.samples.length > a.acoustic.txSamples);
  assert.equal(a.acoustic.rxSamples, a.samples.length);
  assert.ok(a.detections.length >= 2);
  assert.ok(a.detections.some((item) => Math.abs(item.range - 1.2) < a.acoustic.rangeResolution));
  assert.ok(a.detections.some((item) => Math.abs(item.range - 2.4) < a.acoustic.rangeResolution));
  assert.ok(Number.isFinite(a.acoustic.snr));
  assert.ok(Number.isFinite(a.acoustic.sidelobe));
});

test("waveform changes alter TX, modeled RX and pulse-compression resolution", () => {
  const normal = modelAcousticFrame({ config: DEFAULT_CONFIG, sensors, elapsed: 10, frame: 40 });
  const adapted = modelAcousticFrame({
    config: { ...DEFAULT_CONFIG, bandwidth: 1.2, pulse: 8 },
    sensors: { ...sensors, turbidity: 38 },
    elapsed: 14,
    frame: 56,
  });
  assert.notEqual(normal.acoustic.txSamples, adapted.acoustic.txSamples);
  assert.notDeepEqual(normal.samples, adapted.samples);
  assert.notDeepEqual(normal.echo, adapted.echo);
  assert.ok(adapted.acoustic.rangeResolution > normal.acoustic.rangeResolution);
});

test("operating power model follows waveform load and remains explicitly modeled", () => {
  const low = modelOperatingPower({ ...DEFAULT_CONFIG, amplitude: 30 }, 10);
  const high = modelOperatingPower({ ...DEFAULT_CONFIG, amplitude: 90 }, 10);
  assert.equal(low.source, "model");
  assert.ok(high.watts > low.watts);
  assert.ok(low.soc > 0 && low.soc <= 1);
});
