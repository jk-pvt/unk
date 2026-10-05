#!/usr/bin/env node
// Bench evidence CLI. Writes to <data>/bench exactly like the server API, no server needed.
//   node scripts/bench.mjs capture scope.csv --point PA4 --profile MURKY --window HANN [--label "..."] [--rate 5e6] [--channel 1] [--gain 1.49]
//   node scripts/bench.mjs power --state idle --volts 5.0 --ma 112 --instrument "USB meter X" --at "USB 5 V into Nucleo" [--afe] [--ping-ms 100] [--pulse-ms 8]
//   node scripts/bench.mjs status
import { readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { BenchStore } from "../server/bench-store.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const store = new BenchStore(process.env.AQUASDR_DATA_DIR || resolve(root, "data"));
const [cmd, ...rest] = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) { const k = rest[i].slice(2); const next = rest[i + 1]; if (next === undefined || next.startsWith("--")) flags[k] = true; else { flags[k] = next; i++; } }
  else pos.push(rest[i]);
}
const num = (v) => (v === undefined ? undefined : Number(v));
const fmt = (v, d = 2, u = "") => (Number.isFinite(v) ? `${v.toFixed(d)}${u}` : "—");
try {
  if (cmd === "capture") {
    if (!pos[0]) throw new Error("capture needs the scope CSV path");
    const csv = await readFile(resolve(pos[0]), "utf8");
    const custom = flags.profile ? undefined : { frequency: num(flags.frequency), bandwidth: num(flags.bandwidth), pulse: num(flags.pulse), amplitude: num(flags.amplitude) };
    const { name, record } = await store.addCapture({ csv, point: flags.point, profile: flags.profile || null, window: flags.window, mode: flags.mode || "LFM CHIRP",
      config: custom, label: flags.label || "", instrument: { name: flags.instrument, probe: flags.probe, coupling: flags.coupling }, sourceName: basename(pos[0]), notes: flags.notes || "",
      rate: num(flags.rate), channel: num(flags.channel), gain: num(flags.gain) });
    console.log(`stored ${name}\n${record.point} · ${record.window} · ${record.profile || "custom"} · gain x${record.pointGain.toFixed(3)} · ${record.source.samples} samples @ ${record.source.sampleRate / 1e6} MS/s`);
    for (const r of record.comparison.rows) console.log(`${r.name.padEnd(32)} measured ${fmt(r.measured)} ${r.unit}  computed ${fmt(r.computed)}  error ${fmt(r.error)}  tol ±${fmt(r.tolerance)}  ${r.pass === null ? "n/a" : r.pass ? "PASS" : "FAIL"}`);
    console.log(record.comparison.allPass ? "ALL WITHIN SUGGESTED TOLERANCE" : "OUTSIDE TOLERANCE: see rows marked FAIL");
  } else if (cmd === "power") {
    const { name, record } = await store.addPower({ state: flags.state, voltageV: num(flags.volts), currentMa: num(flags.ma), instrument: flags.instrument, measuredPoint: flags.at,
      conditions: flags.conditions, afeConnected: flags.afe === true, pingIntervalMs: num(flags["ping-ms"]), pulseMs: num(flags["pulse-ms"]) });
    console.log(`stored ${name}: ${record.state} ${record.voltageV} V × ${record.currentMa} mA = ${fmt(record.powerMw, 1)} mW`);
  } else if (cmd === "status") {
    const e = await store.evidence();
    console.log(`captures: ${e.captures.length}`);
    for (const [p, r] of Object.entries(e.latestByPoint)) console.log(`  ${p}: ${r.window} ${r.profile || ""} ${r.comparison.allPass ? "within tolerance" : "OUTSIDE tolerance"} (${r.capturedAt})`);
    const d = e.power.derived;
    console.log(`power: idle ${fmt(d.idleMw, 1, " mW")} · web ${fmt(d.webControlMw, 1, " mW")} · active ${fmt(d.waveformActiveMw, 1, " mW")} · energy/ping ${fmt(d.energyPerPingUj, 0, " µJ")} · missing: ${d.missing.join(", ") || "none"}`);
  } else throw new Error("usage: bench.mjs capture|power|status (see file header)");
} catch (error) { console.error("ERROR:", error.message); process.exit(1); }
