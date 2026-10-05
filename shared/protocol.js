import { z } from "zod";
import { WINDOWS } from "./signal.js";
export const configSchema = z
  .object({
    mode: z.enum(["LFM CHIRP", "GEOMETRIC SWEEP", "PHASE-CODED PULSE"]),
    frequency: z.number().min(20).max(350),
    bandwidth: z.number().min(0.5).max(100),
    pulse: z.number().min(1).max(20),
    amplitude: z.number().min(0).max(100),
    window: z.enum(Object.keys(WINDOWS)).default("HANN"),
  })
  .refine(
    (c) => c.frequency - c.bandwidth / 2 > 0,
    "Lower frequency must be positive",
  );
export const environmentSchema = z.object({
  turbidityIndex: z.number().finite().min(0).max(100),
  depth: z.number().finite().min(0).max(100),
  temperature: z.number().finite().min(0).max(40),
}).strict();
const controlSchema = z.object({
  session: z.number().int().nonnegative(), lastRequestId: z.number().int().nonnegative(),
  requestedId: z.number().int().nonnegative(), appliedRequestId: z.number().int().nonnegative(),
  decisionId: z.number().int().nonnegative(), appliedDecisionId: z.number().int().nonnegative(),
  outputEnabled: z.boolean(), qualified: z.boolean(), state: z.enum(["INHIBITED", "PENDING", "APPLIED"]),
  reason: z.string().max(40), profile: z.enum(["UNQUALIFIED", "CLEAR", "TRANSITION", "MURKY"]),
  decisionToOutputMs: z.number().int().nonnegative(), hasApplied: z.boolean(),
  mode: z.number().int().min(0).max(2), window: z.number().int().min(0).max(3), uptimeMs: z.number().int().nonnegative(),
});
const ackSchema = z.object({version: z.literal(1), type: z.literal("ack"), session: z.number().int().nonnegative(),
  id: z.number().int().nonnegative(), status: z.enum(["ACCEPTED", "REJECTED"]), reason: z.string().max(80)});
// On-board DAC capture (MCU ADC CAPTURE, never an oscilloscope measurement). Samples travel as 3 hex digits per 12-bit ADC count.
export const captureSchema = z.object({
  version: z.literal(1), type: z.literal("capture"),
  id: z.number().int().positive(), mode: z.number().int().min(0).max(1),
  rate: z.number().int().positive().max(2400000), total: z.number().int().positive().max(32768),
  offset: z.number().int().nonnegative(), n: z.number().int().positive().max(1000),
  d: z.string().regex(/^[0-9A-F]+$/),
}).refine((c) => c.d.length === c.n * 3, "d must hold 3 hex digits per sample").refine((c) => c.offset + c.n <= c.total, "chunk runs past the capture");
const captureStatusSchema = z.object({
  state: z.enum(["IDLE", "REQUESTED", "RUNNING", "SENDING", "FAILED"]), id: z.number().int().nonnegative(), mode: z.number().int().min(0).max(1),
  rateHz: z.number().int().nonnegative(), samples: z.number().int().nonnegative(), sent: z.number().int().nonnegative(),
  minCounts: z.number().int().min(0).max(4095), maxCounts: z.number().int().min(0).max(4095), meanCounts: z.number().min(0).max(4095), reason: z.string().max(40),
});
const nullable = z.number().finite().nullable();
const environmentProfile = z.enum(["CLEAR_SHALLOW_REEF", "MUDDY_ESTUARY", "DEEP_OPEN_WATER", "SEDIMENT_PLUME", "CUSTOM", "ADC_DIAL"]);
export const packetSchema = z.object({
  version: z.literal(1),
  type: z.literal("telemetry"),
  source: z.literal("hardware"),
  seq: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  payload: z
    .object({
      capabilities: z.object({controlVersion: z.literal(1)}).optional(),
      firmwareMode: z.enum(["ADAPTIVE_TRANSMITTER", "BRINGUP"]).optional(),
      // Adaptive firmware self-description; hosts must not infer identity from the free-text firmware string.
      identity: z.object({id: z.literal("AQUASDR_ADAPTIVE"), version: z.string().max(16), build: z.string().max(16), platform: z.string().max(24).optional(),
        capabilities: z.array(z.string().max(24)).max(16)}).optional(),
      // Physical A0 chain, reported only while the ADC dial (not web input) is the source.
      capture: captureStatusSchema.optional(),
      adc: z.object({pin: z.literal("PA0/A0"), sensor: z.string().max(16).optional(), fullScaleCounts: z.number().int().min(1).max(4095).optional(), raw: z.number().int().min(0).max(4095), millivolts: z.number().int().min(0).max(3300),
        filteredLevel: z.number().min(0).max(100), valid: z.boolean(), candidate: z.number().int().min(0).max(255)}).optional(),
      environment: environmentSchema.extend({ source: z.enum(["WEB_COMMAND", "ADC_DIAL"]), profile: environmentProfile.optional(), valid: z.boolean(), sampledMs: z.number().int().nonnegative() }).optional(),
      control: controlSchema.optional(),
      applicationAck: z.object({session: z.number().int().nonnegative(), id: z.number().int().nonnegative(),
        decisionId: z.number().int().nonnegative(), status: z.literal("APPLIED"), profile: environmentProfile,
        policy: z.enum(["CLEAR", "TRANSITION", "MURKY"])}).optional(),
      sensors: z.object({
        temperature: nullable,
        turbidity: nullable,
        pressure: nullable,
        depth: nullable,
        conductivity: nullable,
        distance: nullable.optional(),
      }),
      power: z.object({
        voltage: nullable,
        current: nullable,
        watts: nullable,
        energy: nullable,
        soc: z.number().min(0).max(1).nullable().optional(),
        charging: z.boolean().optional(),
      }),
      waveform: configSchema.optional(),
      requestedWaveform: configSchema.optional(),
      // Physical ADC bench input is NOT a turbidity measurement. Retain its
      // provenance, the requested decision and the last applied decision.
      adaptation: z.object({
        source: z.literal("ADC_DIAL"),
        inputPin: z.literal("PA0/A0"),
        raw: z.number().int().min(0).max(4095),
        inputVolts: z.number().min(0).max(3.3).nullable(),
        levelPercent: z.number().min(0).max(100).nullable(),
        inputValid: z.boolean(),
        profile: z.enum(["UNQUALIFIED", "CLEAR", "TRANSITION", "MURKY"]),
        state: z.enum(["INHIBITED", "PENDING", "APPLIED"]),
        decisionId: z.number().int().nonnegative(),
        appliedDecisionId: z.number().int().nonnegative(),
        decisionToOutputMs: z.number().int().nonnegative().nullable(),
      }).optional(),
      echo: z.array(z.number().min(0).max(1)).min(2).max(2048).optional(),
      rangeMax: z.number().positive().max(100000).optional(),
      samples: z.array(z.number().min(-1).max(1)).min(32).max(32768).optional(),
      sampleRate: z.number().positive().max(10000000).optional(),
      health: z.record(z.string().max(40)).optional(),
      // Waveform engine runtime, as the firmware measures it. All optional:
      // the console shows NOT REPORTED rather than a guess when absent.
      engine: z
        .object({
          timerHz: nullable.optional(),
          dmaBuffer: z.number().int().nonnegative().nullable().optional(),
          cpuLoad: z.number().min(0).max(100).nullable().optional(),
          underruns: z.number().int().nonnegative().nullable().optional(),
        })
        .optional(),
      firmware: z.string().max(80).optional(),
      validation: z
        .object({
          frequency: nullable,
          bandwidth: nullable,
          pulse: nullable,
          amplitude: nullable,
          noiseFloor: nullable,
          sidelobe: nullable,
          thd: nullable,
        })
        .optional(),
    })
    .refine((p) => !p.samples || !!p.sampleRate, "Samples require sampleRate")
    .refine(
      (p) => !p.echo || !!p.rangeMax,
      "Echo data requires rangeMax in meters",
    ),
});
export function parsePacket(line) {
  const packet = JSON.parse(line);
  return packet.type === "ack" ? ackSchema.parse(packet) : packet.type === "capture" ? captureSchema.parse(packet) : packetSchema.parse(packet);
}
export class LineParser {
  constructor(onPacket, onError) {
    this.buffer = "";
    this.dropping = false;
    this.onPacket = onPacket;
    this.onError = onError;
  }
  feed(chunk) {
    for (const char of chunk.toString()) {
      if (char === "\n") {
        if (!this.dropping && this.buffer.trim()) {
          try {
            this.onPacket(parsePacket(this.buffer));
          } catch {
            this.onError("Invalid telemetry packet");
          }
        }
        this.buffer = "";
        this.dropping = false;
      } else if (!this.dropping) {
        this.buffer += char;
        if (this.buffer.length > 1048576) {
          this.buffer = "";
          this.dropping = true;
          this.onError("Packet exceeds 1 MiB");
        }
      }
    }
  }
}
