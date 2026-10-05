#!/usr/bin/env node
// CAPTURE_DAC from the command line: the board samples its own DAC pin (MCU ADC CAPTURE). NOT an oscilloscope measurement.
//   BRIDGE=http://127.0.0.1:4318 node scripts/mcu-capture.mjs [--mode pulse|train] [--preset CLEAR_SHALLOW_REEF] [--window HANN] [--all-windows] [--tap RAW_DAC|AFE_FILTER|AFE_OUTPUT] [--wave LFM|GEOMETRIC|BARKER] [--all-classes] [--all-profiles] [--repeat N] [--out file.json]
// Each capture enables the output for one pulse (two in train mode) and the firmware stops it again by itself. No START is needed or sent.
// --tap says which circuit node the ADC input (A5) is wired to. RAW_DAC = the A2-A5 jumper (default). AFE_FILTER = filter output TP2. AFE_OUTPUT = the biased,
// clamped ADC tap after the TLV9062 stage. The firmware cannot see the wiring, so the declaration is yours; the comparison with the model shows when it is wrong.
// Records and CSV files are written by the bridge to <data>/bench/mcu-*.json|csv (the CSV path is printed).
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { WebSocket } from "ws";

const BASE = process.env.BRIDGE || "http://127.0.0.1:4318";
const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const MODE = arg("--mode", "pulse") === "train" ? 1 : 0, PRESET = arg("--preset"), WINDOW = arg("--window"), ALL = process.argv.includes("--all-windows"), OUT = arg("--out");
const TAP = arg("--tap", "RAW_DAC");
if (!["RAW_DAC", "AFE_FILTER", "AFE_OUTPUT"].includes(TAP)) { console.error("--tap must be RAW_DAC, AFE_FILTER or AFE_OUTPUT"); process.exit(2); }
const CLASSES = { LFM: "LFM CHIRP", GEOMETRIC: "GEOMETRIC SWEEP", BARKER: "PHASE-CODED PULSE" };
const REPEAT = Math.max(1, Number(arg("--repeat", "1")) || 1);
const WAVE = arg("--wave"), ALL_CLASSES = process.argv.includes("--all-classes"), ALL_PROFILES = process.argv.includes("--all-profiles");
if (WAVE && !CLASSES[WAVE]) { console.error("--wave must be LFM, GEOMETRIC or BARKER"); process.exit(2); }
const PRESETS = ["CLEAR_SHALLOW_REEF", "MUDDY_ESTUARY", "DEEP_OPEN_WATER", "SEDIMENT_PLUME"];
const WINDOWS = ["RECT", "HANN", "HAMMING", "BLACKMAN"];
const client = randomUUID(), sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(BASE.replace("http", "ws") + "/ws/telemetry", { headers: { Origin: BASE } });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
const beat = () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "controlHeartbeat", client })); beat(); const hb = setInterval(beat, 250); await sleep(600);
const post = async (p, b) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...b, client }) }); return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }; };
const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.status} ${r.body.error || ""}`); return r; };
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
const results = [];

async function captureOnce(label) {
  const r = must(await post("/api/bench/mcu-capture", { mode: MODE, label, tap: TAP }), "CAPTURE_DAC");
  console.log(`\n${label || (MODE ? "train" : "pulse")} [${TAP}]: MCU ADC CAPTURE stored as ${r.body.name}  (${r.body.allPass ? "within tolerance of the calculation" : "differs from the calculation"}; device min/max ${r.body.deviceStatsAgree === null ? "not reported" : r.body.deviceStatsAgree ? "agrees" : "DISAGREES"})`);
  for (const x of r.body.rows) console.log(`  ${x.name.padEnd(32)} calculated ${fmt(x.computed).padStart(8)}  capture ${fmt(x.measured).padStart(8)} ${x.unit.padEnd(3)} error ${fmt(x.error).padStart(7)}  ${x.pass === null ? "n/a" : x.pass ? "WITHIN" : "OUTSIDE"} ±${fmt(x.tolerance)}`);
  console.log(`  CSV: ${BASE}/api/bench/mcu/${r.body.name}.csv`);
  results.push({ label, name: r.body.name, allPass: r.body.allPass, rows: r.body.rows }); return r.body;
}
try {
  const sys = await (await fetch(BASE + "/api/system")).json();
  if (sys.current?.control?.outputEnabled) throw new Error("Output is already enabled; stop it first so the capture is the only thing running");
  if (!sys.current?.identity?.capabilities?.includes("DAC_CAPTURE")) throw new Error("The connected firmware does not advertise DAC_CAPTURE");
  if (PRESET) { must(await post("/api/transmitter", { op: "source", source: "WEB_COMMAND" }), "source WEB"); must(await post("/api/environment", { profile: PRESET }), "SET_ENV " + PRESET); await sleep(1500); }
  if (ALL_PROFILES) {
    // The waveform each preset makes the policy request, captured as the board plays it (no override of mode or window).
    for (const pr of PRESETS) { must(await post("/api/transmitter", { op: "source", source: "WEB_COMMAND" }), "source WEB"); must(await post("/api/environment", { profile: pr }), "SET_ENV " + pr); await sleep(1800); await captureOnce(`preset ${pr}`); await sleep(500); }
  } else if (ALL_CLASSES) {
    for (const [k, name] of Object.entries(CLASSES)) { must(await post("/api/transmitter", { op: "waveform", mode: name, window: "HANN" }), "waveform " + name); await sleep(1500); await captureOnce(`class ${k} HANN`); await sleep(500); }
  } else if (ALL) {
    for (const w of WINDOWS) { must(await post("/api/transmitter", { op: "waveform", mode: CLASSES[WAVE || "LFM"], window: w }), "waveform " + w); await sleep(1500); await captureOnce(`window ${w}`); await sleep(500); }
    console.log("\nWindow comparison (MCU ADC CAPTURE, out-of-band leakage, lower is better):");
    const stored = await (await fetch(BASE + "/api/bench/mcu")).json();
    for (const w of WINDOWS) { const rec = stored.captures.find((c) => c.window === w && c.mode === "pulse" && (c.tap || "RAW_DAC") === TAP && c.expected?.mode === CLASSES[WAVE || "LFM"]); console.log(`  ${w.padEnd(9)} captured ${fmt(rec?.measured?.leakageDb, 1)} dB   calculated ${fmt(rec?.computed?.leakageDb, 1)} dB`); }
  } else {
    if (WINDOW || WAVE) { const name = CLASSES[WAVE || "LFM"]; must(await post("/api/transmitter", { op: "waveform", mode: name, window: WINDOW || "HANN" }), `waveform ${name} ${WINDOW || "HANN"}`); await sleep(1500); }
    for (let i = 0; i < REPEAT; i++) { await captureOnce(REPEAT > 1 ? `repeat ${i + 1} of ${REPEAT}` : null); if (i + 1 < REPEAT) await sleep(1200); }
  }
  if (TAP !== "RAW_DAC" && !MODE) {
    const cmp = (await (await fetch(BASE + "/api/bench/mcu")).json()).comparisons?.find((c) => c.tap === TAP);
    if (!cmp) console.log("\nNo raw DAC capture of the same waveform and window is stored yet, so there is nothing to compare. Capture it with --tap RAW_DAC (A5 on the A2 jumper) first.");
    else {
      console.log(`\nRAW DAC vs ${cmp.tapLabel} (window ${cmp.window}); both are MCU ADC captures, the model column is calculated:`);
      for (const r of cmp.rows) console.log(`  ${r.name.padEnd(42)} raw ${fmt(r.raw).padStart(8)}  stage ${fmt(r.tapped).padStart(8)} ${r.unit.padEnd(10)}` + (r.measuredChange === null ? "" : `  change ${fmt(r.measuredChange, 3)} (model ${fmt(r.modelChange, 3)})  ${r.pass === null ? "" : r.pass ? "WITHIN" : "OUTSIDE"}`));
      console.log(`  Gain ${fmt(cmp.gainDb)} dB measured by the ADC, ${fmt(cmp.modelGainDb)} dB from the designed stage`);
    }
  }
  const after = (await (await fetch(BASE + "/api/system")).json()).current;
  console.log(`\nAfter capture: output ${after?.control?.outputEnabled ? "STILL ENABLED (unexpected)" : "off"}, DAC ${after?.health?.DAC}, DMA ${after?.health?.DMA}, underruns ${after?.engine?.underruns}`);
  if (OUT) await writeFile(OUT, JSON.stringify({ when: new Date().toISOString(), note: "MCU ADC CAPTURE, not oscilloscope measurements", results }, null, 1));
} catch (e) { console.error("ERROR:", e.message); process.exitCode = 1; }
finally { clearInterval(hb); ws.close(); }
