// Persistent bench evidence: MEASURED scope-capture analyses and external-meter power readings.
// Files live under <data>/bench and are written only from real uploaded captures / typed readings.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecord, PROFILES, summarize } from "../shared/bench-capture.js";
import { buildMcuRecord, mcuCsv, compareTaps, sameSetup, DEFAULT_TAP } from "../shared/mcu-capture.js";
import { validatePowerEntry, derivePowerEvidence } from "../shared/bench-power.js";

const here = dirname(fileURLToPath(import.meta.url));
const designPath = resolve(here, "../hardware/analog/design_results.json");
let design = null;
// Voltage gain the analog front end is *designed* to have at a frequency (computed by hardware/analog/design_afe.py).
export async function designGain(point, centerKHz) {
  if (point === "PA4") return 1;
  design ||= JSON.parse(await readFile(designPath, "utf8"));
  const key = String(Math.round(centerKHz));
  const row = design.gain_by_khz?.[key];
  if (!row) throw new Error(`No designed gain at ${centerKHz} kHz; pass gain explicitly`);
  return point === "FILTER_OUT" ? row.filter_out : row.opamp_out;
}

export class BenchStore {
  constructor(dataRoot) { this.dir = resolve(dataRoot, "bench"); }
  async #read(prefix) {
    await mkdir(this.dir, { recursive: true });
    const names = (await readdir(this.dir)).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
    const out = [];
    for (const f of names) { try { out.push(JSON.parse(await readFile(resolve(this.dir, f), "utf8"))); } catch { /* ignore a damaged file */ } }
    return out.sort((a, b) => (b.capturedAt || "").localeCompare(a.capturedAt || ""));
  }
  async captures() { return this.#read("capture-"); }
  async powerEntries() { return this.#read("power-"); }
  async addCapture({ csv, point, profile, window, mode, config, label, instrument, sourceName, notes, rate, channel, gain }) {
    const base = profile ? PROFILES[profile] : config;
    const g = Number.isFinite(gain) ? gain : base ? await designGain(point, base.frequency) : 1;
    const record = buildRecord({ csv, rate, channel, point, profile, window, mode, config, gain: g, label, instrument, sourceName, notes });
    const stamp = record.capturedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
    await mkdir(this.dir, { recursive: true });
    const name = `capture-${stamp}-${point}-${window}-${record.source.sha256.slice(0, 8)}.json`;
    await writeFile(resolve(this.dir, name), JSON.stringify(record));
    return { name, record };
  }
  async latestTraces(point) {
    const r = (await this.captures()).find((c) => c.point === point);
    return r ? { point: r.point, capturedAt: r.capturedAt, traces: r.traces } : null;
  }
  // MCU ADC CAPTURE records are stored apart from oscilloscope captures: different file prefix, different provenance, never MEASURED.
  async addMcu({ id, mode, rate, counts, expected, profile, window, deviceStats, firmware, label, tap }) {
    const record = buildMcuRecord({ id, mode, rate, counts, expected, profile, window, deviceStats, firmware, label, tap });
    const base = `mcu-${record.capturedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${id}-${record.mode}`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(resolve(this.dir, base + ".csv"), mcuCsv(record, counts));
    await writeFile(resolve(this.dir, base + ".json"), JSON.stringify(record));
    return { name: base, record };
  }
  async mcuCaptures() { return this.#read("mcu-"); }
  async mcuEvidence() {
    const all = await this.mcuCaptures();
    // For each analog-stage tap, the newest capture is paired with the newest raw-DAC capture of the same waveform and window.
    const comparisons = [];
    for (const t of all.filter((r) => (r.tap || DEFAULT_TAP) !== DEFAULT_TAP)) {
      if (comparisons.some((c) => c.tap === t.tap && c.window === t.window)) continue;
      const raw = all.find((r) => (r.tap || DEFAULT_TAP) === DEFAULT_TAP && sameSetup(r, t));
      const c = compareTaps(raw, t); if (c.ok) comparisons.push(c);
    }
    return { captures: all.map((r) => ({ ...r, traces: undefined })), latest: all[0] ? { ...all[0], traces: undefined } : null, comparisons };
  }
  async mcuTraces(id) {
    const all = await this.mcuCaptures();
    const r = id ? all.find((c) => `mcu-${c.capturedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${c.captureId}-${c.mode}` === id) : all[0];
    return r ? { name: id || null, capturedAt: r.capturedAt, traces: r.traces, mode: r.mode } : null;
  }
  csvPath(name) { return /^mcu-\d{14}-\d+-(pulse|train)$/.test(name) ? resolve(this.dir, name + ".csv") : null; }
  async addPower(entry) {
    const record = validatePowerEntry(entry);
    await mkdir(this.dir, { recursive: true });
    const name = `power-${record.capturedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${record.state}.json`;
    await writeFile(resolve(this.dir, name), JSON.stringify(record));
    return { name, record };
  }
  async evidence() {
    const captures = await this.captures(), power = await this.powerEntries();
    const s = summarize(captures);
    // the list view omits the heavy traces for older captures
    const light = (r) => (r ? { ...r, traces: undefined } : null);
    return { captures: captures.map((r) => ({ ...r, traces: undefined })), latestByPoint: Object.fromEntries(Object.entries(s.latestByPoint).map(([k, v]) => [k, light(v)])),
      windows: Object.fromEntries(Object.entries(s.windows).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([w, r]) => [w, { capturedAt: r.capturedAt, label: r.label, leakageDb: r.measured.leakageDb, computedLeakageDb: r.computed.leakageDb, peakKHz: r.measured.peakKHz, vpp: r.measured.vpp, allPass: r.comparison.allPass }]))])),
      power: { entries: power, derived: derivePowerEvidence(power) } };
  }
}
