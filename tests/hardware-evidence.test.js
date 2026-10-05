import test from "node:test";
import assert from "node:assert/strict";
import { isAdaptiveBench, adaptationEvent, controlApplicationEvent } from "../shared/hardware-evidence.js";
import { parsePacket } from "../shared/protocol.js";

const a = { source: "ADC_DIAL", inputPin: "PA0/A0", raw: 1000, inputVolts: 0.806,
  levelPercent: 24.42, inputValid: true, profile: "CLEAR", state: "APPLIED",
  decisionId: 1, appliedDecisionId: 1, decisionToOutputMs: 20 };
const packet = (adaptation) => JSON.stringify({ version: 1, type: "telemetry", source: "hardware", seq: 1,
  timestamp: "1970-01-01T00:00:01.000Z", payload: {
    sensors: { temperature: null, turbidity: null, pressure: null, depth: null, conductivity: null },
    power: { voltage: null, current: null, watts: null, energy: null }, adaptation } });

test("ADC adaptation survives parsing without inventing sensor or power measurements", () => {
  const data = parsePacket(packet(a)).payload;
  assert.deepEqual(data.adaptation, a);
  assert.equal(isAdaptiveBench(data), true);
  assert.equal(isAdaptiveBench({}), false);
  assert.equal(data.sensors.turbidity, null);
  assert.equal(data.power.watts, null);
});
test("ADC protocol rejects malformed provenance, states and physical input bounds", () => {
  for (const bad of [{ source: "sensor" }, { raw: 4096 }, { inputVolts: 5 }, { levelPercent: 101 },
    { state: "SUCCESS" }, { decisionToOutputMs: -1 }]) {
    assert.throws(() => parsePacket(packet({ ...a, ...bad })));
  }
});
test("firmware decision events deduplicate repeated packets, not new decisions or inhibition", () => {
  const data = { adaptation: a };
  assert.match(adaptationEvent(null, data), /applied decision 1/);
  assert.equal(adaptationEvent(data, data), null);
  assert.match(adaptationEvent(data, { adaptation: { ...a, state: "INHIBITED" } }), /inhibited/);
  assert.match(adaptationEvent(data, { adaptation: { ...a, state: "PENDING", decisionId: 2 } }), /next pulse boundary/);
});
test('control history records applied configuration changes, not ACKs or pending decisions', () => {
  const before={control:{session:77,hasApplied:true,appliedDecisionId:1,profile:'CLEAR'},
    waveform:{frequency:42,bandwidth:4,pulse:2,amplitude:35}};
  const next={control:{session:77,hasApplied:true,appliedDecisionId:2,appliedRequestId:9,profile:'MURKY',decisionToOutputMs:80},
    waveform:{frequency:38,bandwidth:1,pulse:8,amplitude:62}};
  assert.equal(controlApplicationEvent(null,{control:{hasApplied:false}}),null);
  assert.equal(controlApplicationEvent(before,before),null);
  const message=controlApplicationEvent(before,next);
  assert.match(message,/request #9/);assert.match(message,/CLEAR → MURKY/);
  assert.match(message,/center 42 → 38 kHz/);assert.match(message,/duration 2 → 8 ms/);
  assert.match(message,/amplitude 35 → 62 % DAC/);
  const intermediate={...next,waveform:{frequency:40,bandwidth:2,pulse:4,amplitude:50}};
  assert.match(controlApplicationEvent(before,intermediate),/CLEAR → TRANSITION/);
  const restarted={...next,control:{...next.control,session:78,appliedDecisionId:1}};
  assert.match(controlApplicationEvent(before,restarted),/center — → 38/);
  assert.equal(adaptationEvent(before,{...next,adaptation:a}),null);
});

import { classifyFirmware } from "../shared/hardware-evidence.js";
test("firmware identity distinguishes adaptive, Arduino bridge and unknown images", () => {
  const a = classifyFirmware({ identity: { id: 'AQUASDR_ADAPTIVE', version: '0.3.3', build: 'abc1234', capabilities: ['ADC_A0'] }, capabilities: { controlVersion: 1 } });
  assert.equal(a.kind, 'AQUASDR_ADAPTIVE'); assert.equal(a.commandable, true); assert.equal(a.build, 'abc1234');
  assert.equal(classifyFirmware({ firmware: 'AquaSDR Arduino sensor bridge 1.7 demo-TFT' }).kind, 'ARDUINO_SENSOR_BRIDGE');
  assert.equal(classifyFirmware({ firmware: 'something else' }).kind, 'UNKNOWN FIRMWARE');
  assert.equal(classifyFirmware(null).kind, 'UNKNOWN FIRMWARE');
  assert.equal(classifyFirmware({ firmwareMode: 'ADAPTIVE_TRANSMITTER' }).legacyIdentity, true);
});
