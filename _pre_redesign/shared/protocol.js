import { z } from "zod";
export const configSchema = z
  .object({
    mode: z.enum(["LFM CHIRP", "GEOMETRIC SWEEP", "PHASE-CODED PULSE"]),
    frequency: z.number().min(50).max(350),
    bandwidth: z.number().min(5).max(100),
    pulse: z.number().min(1).max(20),
    amplitude: z.number().min(0).max(100),
  })
  .refine(
    (c) => c.frequency - c.bandwidth / 2 > 0,
    "Lower frequency must be positive",
  );
const nullable = z.number().finite().nullable();
export const packetSchema = z.object({
  version: z.literal(1),
  type: z.literal("telemetry"),
  source: z.literal("hardware"),
  seq: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  payload: z
    .object({
      sensors: z.object({
        temperature: nullable,
        turbidity: nullable,
        pressure: nullable,
        depth: nullable,
        conductivity: nullable,
      }),
      power: z.object({
        voltage: nullable,
        current: nullable,
        watts: nullable,
        energy: nullable,
      }),
      waveform: configSchema.optional(),
      echo: z.array(z.number().min(0).max(1)).min(2).max(2048).optional(),
      rangeMax: z.number().positive().max(100000).optional(),
      samples: z.array(z.number().min(-1).max(1)).min(32).max(32768).optional(),
      sampleRate: z.number().positive().max(10000000).optional(),
      health: z.record(z.string().max(40)).optional(),
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
  return packetSchema.parse(JSON.parse(line));
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
