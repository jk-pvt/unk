import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  generateSignal,
  spectrum,
  simulation,
  estimateSignal,
  soundSpeed,
} from "../shared/signal.js";
import { configSchema, parsePacket, LineParser } from "../shared/protocol.js";
const sensor = {
  temperature: 26,
  turbidity: 12,
  pressure: 1.2,
  depth: 2,
  conductivity: null,
};
const packet = () => ({
  version: 1,
  type: "telemetry",
  source: "hardware",
  seq: 1,
  timestamp: new Date().toISOString(),
  payload: {
    sensors: sensor,
    power: { voltage: 24, current: 0.5, watts: 12, energy: null },
  },
});
test("waveform sample count and amplitude correspond to parameters", () => {
  const a = generateSignal(DEFAULT_CONFIG);
  assert.equal(a.length, 2000);
  assert.ok(Math.max(...a) <= 0.620001);
  const b = generateSignal({ ...DEFAULT_CONFIG, pulse: 4, amplitude: 30 });
  assert.equal(b.length, 4000);
  assert.ok(Math.max(...b) <= 0.300001);
});
test("FFT recovers a known tone at its bin and calibrated amplitude", () => {
  const n = 8192,
    rate = 1000000,
    f = (1024 * rate) / n;
  const a = Float64Array.from(
    { length: n },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / rate),
  );
  const bins = spectrum(a, rate);
  const peak = bins.reduce((a, b) => (a.db > b.db ? a : b));
  assert.equal(peak.frequency, f);
  assert.ok(Math.abs(peak.db - -6.0206) < 0.01);
});
test("LFM chirp energy lies in its requested band", () => {
  const bins = spectrum(generateSignal(DEFAULT_CONFIG));
  const peak = bins.reduce((a, b) => (a.db > b.db ? a : b));
  assert.ok(peak.frequency >= 38500 && peak.frequency <= 41500);
  assert.ok(bins.find((b) => b.frequency > 60000).db < peak.db - 40);
});
test("all supported modes produce different finite sampled signals", () => {
  const modes = ["LFM CHIRP", "GEOMETRIC SWEEP", "PHASE-CODED PULSE"].map(
    (mode) => generateSignal({ ...DEFAULT_CONFIG, mode }),
  );
  for (const data of modes) assert.ok(data.every(Number.isFinite));
  assert.notDeepEqual(modes[0], modes[1]);
  assert.notDeepEqual(modes[0], modes[2]);
});
test("signal estimators report normalized RMS and peak", () => {
  const a = Float64Array.from(
    { length: 8192 },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 8192),
  );
  const e = estimateSignal(a, 8192);
  assert.ok(Math.abs(e.rms - Math.sqrt(0.125)) < 0.00001);
  assert.ok(Math.abs(e.peakAmplitude - 0.5) < 0.00001);
});
test("simulator is deterministic and power responds to amplitude", () => {
  assert.deepEqual(
    simulation(12, DEFAULT_CONFIG),
    simulation(12, DEFAULT_CONFIG),
  );
  assert.ok(
    simulation(12, { ...DEFAULT_CONFIG, amplitude: 90 }).power.watts >
      simulation(12, DEFAULT_CONFIG).power.watts,
  );
  assert.ok(
    Math.abs(
      simulation(12, DEFAULT_CONFIG, true).sensors.turbidity -
        simulation(12, DEFAULT_CONFIG).sensors.turbidity -
        24,
    ) < 1e-10,
  );
});
test("waveform configuration rejects unsafe and non-finite values", () => {
  assert.equal(
    configSchema.safeParse({ ...DEFAULT_CONFIG, frequency: 1 }).success,
    false,
  );
  assert.equal(
    configSchema.safeParse({ ...DEFAULT_CONFIG, amplitude: Infinity }).success,
    false,
  );
  assert.equal(
    configSchema.safeParse({ ...DEFAULT_CONFIG, pulse: NaN }).success,
    false,
  );
});
test("hardware parser requires source provenance and version", () => {
  assert.equal(parsePacket(JSON.stringify(packet())).source, "hardware");
  assert.throws(() =>
    parsePacket(JSON.stringify({ ...packet(), source: "demo" })),
  );
  assert.throws(() => parsePacket(JSON.stringify({ ...packet(), version: 2 })));
});
test("serial parser handles fragmented packets, malformed frames, and recovery", () => {
  const received = [],
    errors = [];
  const parser = new LineParser(
    (p) => received.push(p),
    (e) => errors.push(e),
  );
  const line = JSON.stringify(packet());
  parser.feed(line.slice(0, 35));
  parser.feed(line.slice(35) + "\nnot json\n" + line + "\n");
  assert.equal(received.length, 2);
  assert.equal(errors.length, 1);
});
test("serial parser bounds an oversized frame and resumes at next newline", () => {
  let count = 0,
    errors = 0;
  const parser = new LineParser(
    () => count++,
    () => errors++,
  );
  parser.feed("x".repeat(1048577));
  parser.feed("\n" + JSON.stringify(packet()) + "\n");
  assert.equal(count, 1);
  assert.equal(errors, 1);
  assert.equal(parser.buffer.length, 0);
});
test("raw samples require a sample rate", () => {
  const p = packet();
  p.payload.samples = Array(32).fill(0.2);
  assert.throws(() => parsePacket(JSON.stringify(p)));
  p.payload.sampleRate = 1000000;
  assert.equal(parsePacket(JSON.stringify(p)).payload.samples.length, 32);
});
test("echo range metadata is required to avoid inventing physical distances", () => {
  const p = packet();
  p.payload.echo = [0.1, 0.5, 0.2];
  assert.throws(() => parsePacket(JSON.stringify(p)));
  p.payload.rangeMax = 80;
  assert.equal(parsePacket(JSON.stringify(p)).payload.rangeMax, 80);
});
test("temporary invalid numeric edits cannot crash waveform preview", () => {
  for (const pulse of [-5, NaN, Infinity, 0])
    assert.ok(
      generateSignal({ ...DEFAULT_CONFIG, pulse }).every(Number.isFinite),
    );
});
test("demo defaults match the 40 kHz bench transducers and the 11.1 V pack", () => {
  assert.equal(DEFAULT_CONFIG.frequency, 40);
  assert.ok(configSchema.safeParse(DEFAULT_CONFIG).success);
  const v = simulation(5, DEFAULT_CONFIG).power.voltage;
  assert.ok(v > 9 && v < 12.6);
});
test("sound speed estimate is plausible for fresh and sea water", () => {
  const fresh = soundSpeed(25, 0.05, 0);
  const sea = soundSpeed(15, 54.7, 0);
  assert.ok(fresh > 1490 && fresh < 1505);
  assert.ok(sea > 1500 && sea < 1515);
  assert.equal(soundSpeed(null, 1, 1), null);
});
test("demo turbidity scenario ramps between 0 and +24 NTU", () => {
  const base = simulation(20, DEFAULT_CONFIG).sensors.turbidity;
  const half = simulation(20, DEFAULT_CONFIG, 0.5).sensors.turbidity;
  assert.ok(Math.abs(half - base - 12) < 1e-9);
  assert.ok(simulation(20, DEFAULT_CONFIG).health.I2C);
});
test("pulse is shaped by the selected digital window", () => {
  for (const window of ["HANN", "HAMMING", "BLACKMAN"]) {
    const a = generateSignal({ ...DEFAULT_CONFIG, window });
    const edge = Math.max(...a.slice(0, 20).map(Math.abs));
    const mid = Math.max(...a.slice(990, 1010).map(Math.abs));
    assert.ok(edge < (window === "HAMMING" ? 0.06 : 0.01), window);
    assert.ok(mid > 0.6, window);
  }
  assert.equal(configSchema.parse({ ...DEFAULT_CONFIG, window: undefined }).window, "HANN");
  assert.equal(configSchema.safeParse({ ...DEFAULT_CONFIG, window: "KAISER" }).success, false);
});
test("firmware may report waveform engine runtime, bounded", () => {
  const p = packet();
  p.payload.engine = { timerHz: 1000000, dmaBuffer: 2000, cpuLoad: 3.4, underruns: 0 };
  assert.equal(parsePacket(JSON.stringify(p)).payload.engine.cpuLoad, 3.4);
  p.payload.engine.cpuLoad = 140;
  assert.throws(() => parsePacket(JSON.stringify(p)));
});
