#!/usr/bin/env node
// Bounded PA4 scope session through the bridge. START is sent at most ONCE, only with --start, and STOP is always sent.
//   BRIDGE=http://127.0.0.1:4330 node scripts/pa4-scope-session.mjs            # dry run: checks + environment, NO START
//   BRIDGE=http://127.0.0.1:4330 node scripts/pa4-scope-session.mjs --start --hold 60 --out docs/evidence/pa4-scope-session.json
// What it records is what the FIRMWARE reports (requested/applied settings, state, the MCU's own A5 loopback sample, underruns).
// Nothing in the output is a scope measurement; scope numbers come from the instrument and are imported separately.
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { WebSocket } from "ws";

const BASE = process.env.BRIDGE || "http://127.0.0.1:4330";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const START = process.argv.includes("--start");
const HOLD_S = Number(arg("--hold", "60"));
const OUT = arg("--out", null);
const PRESET = "CLEAR_SHALLOW_REEF";
const EXPECT = { mode: "LFM CHIRP", frequency: 42, bandwidth: 4, pulse: 2, amplitude: 35, window: "HANN" };
const client = randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (m) => { const l = `${new Date().toISOString().slice(11, 23)} ${m}`; log.push(l); console.log(l); };

const ws = new WebSocket(BASE.replace("http", "ws") + "/ws/telemetry", { headers: { Origin: BASE } });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
const beat = () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "controlHeartbeat", client }));
beat(); const hb = setInterval(beat, 250); await sleep(600);

const system = async () => (await fetch(BASE + "/api/system")).json();
async function post(path, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, client }) });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}
const wf = (w) => (w ? { mode: w.mode, frequency: w.frequency, bandwidth: w.bandwidth, pulse: w.pulse, amplitude: w.amplitude, window: w.window } : null);
const same = (a, b) => a && Object.keys(b).every((k) => a[k] === b[k]);
const snap = (d) => { const c = d.current || {}; return { t: new Date().toISOString(), uptimeMs: c.control?.uptimeMs, outputEnabled: c.control?.outputEnabled, state: c.control?.state, reason: c.control?.reason, source: c.environment?.source,
  requested: wf(c.requestedWaveform), applied: wf(c.waveform), appliedDecisionId: c.control?.appliedDecisionId, decisionToOutputMs: c.control?.decisionToOutputMs,
  TIMER: c.health?.TIMER, DMA: c.health?.DMA, DAC: c.health?.DAC, DAC_REGISTER: c.health?.DAC_REGISTER, LOOPBACK: c.health?.LOOPBACK, UART: c.health?.UART, dmaBuffer: c.engine?.dmaBuffer, underruns: c.engine?.underruns }; };

let stopped = false, started = false;
async function stopOutput(why) {
  if (stopped) return; stopped = true;
  for (let i = 0; i < 3; i++) { const r = await post("/api/transmitter", { op: "stop" }); note(`STOP (${why}) attempt ${i + 1}: ${r.status} ${r.body.status || r.body.error || ""}`); if (r.ok) break; await sleep(300); }
}
process.on("SIGINT", async () => { await stopOutput("SIGINT"); process.exit(130); });

const result = { when: new Date().toISOString(), preset: PRESET, expectedRequested: EXPECT, startSent: false, samples: [], log };
try {
  const pre = await system(); const p = pre.current;
  const checks = [["firmware identity AQUASDR_ADAPTIVE", p?.identity?.id === "AQUASDR_ADAPTIVE"], ["platform ARDUINO_COMBINED", p?.identity?.platform === "ARDUINO_COMBINED"],
    ["output OFF", p?.control?.outputEnabled === false], ["TIM6 inhibited", /INHIBITED/.test(p?.health?.TIMER || "")], ["DMA inhibited", /INHIBITED/.test(p?.health?.DMA || "")],
    ["DAC parked mid-scale", /MID SCALE/.test(p?.health?.DAC || "")], ["no underruns", p?.engine?.underruns === 0], ["bridge link ready", pre.transmitter?.ready === true]];
  for (const [n, ok] of checks) note(`${ok ? "PASS" : "FAIL"} pre-check: ${n}`);
  result.preChecks = Object.fromEntries(checks);
  if (checks.some(([, ok]) => !ok)) throw new Error("pre-check failed; nothing was started");

  let r = await post("/api/transmitter", { op: "source", source: "WEB_COMMAND" }); note(`source WEB_COMMAND: ${r.status} ${r.body.status || r.body.error}`); if (!r.ok) throw new Error("source");
  r = await post("/api/environment", { profile: PRESET }); note(`SET_ENV ${PRESET}: ${r.status} ${r.body.status || r.body.error} (${r.body.roundTripMs} ms)`); if (!r.ok) throw new Error("environment");
  let ready = false;
  for (let i = 0; i < 12 && !ready; i++) { await sleep(500); const c = (await system()).current; ready = c.control.qualified && same(wf(c.requestedWaveform), EXPECT) && c.control.outputEnabled === false; }
  result.requestedBeforeStart = snap(await system());
  note(`requested configuration ${ready ? "matches" : "DOES NOT MATCH"} expected: ${JSON.stringify(result.requestedBeforeStart.requested)}`);
  if (!ready) throw new Error("requested configuration not as expected; nothing was started");

  if (!START) { note("DRY RUN: ready. START was NOT sent."); }
  else {
    note(`SENDING START ONCE; output will be held for ${HOLD_S} s, then STOP`);
    started = true; result.startSent = true;
    r = await post("/api/transmitter", { op: "start" }); note(`START: ${r.status} ${r.body.status || r.body.error} (${r.body.roundTripMs} ms)`);
    if (!r.ok) throw new Error("start rejected: " + (r.body.error || r.status));
    const t0 = Date.now(); let n = 0;
    while (Date.now() - t0 < HOLD_S * 1000) {
      await sleep(1000); const s = snap(await system()); result.samples.push(s); n++;
      if (n % 5 === 1 || s.underruns > 0 || /FAULT/.test(s.DMA || "")) note(`t+${Math.round((Date.now() - t0) / 1000)}s ${s.state} out=${s.outputEnabled} applied=${JSON.stringify(s.applied)} DAC=${s.DAC} DMA=${s.DMA} loopback=${s.LOOPBACK} reg=${s.DAC_REGISTER} underruns=${s.underruns}`);
      if (s.underruns > 0 || /FAULT/.test(s.DMA || "")) { note("FAULT reported by firmware: stopping early"); break; }
    }
  }
} catch (e) { note("ABORT: " + e.message); result.error = e.message; }
finally {
  if (started) await stopOutput("end of window");
  await sleep(2500);
  const f = snap(await system()); result.afterStop = f;
  note(`after STOP: out=${f.outputEnabled} state=${f.state} TIMER=${f.TIMER} DMA=${f.DMA} DAC=${f.DAC} underruns=${f.underruns}`);
  result.returnedToIdle = f.outputEnabled === false && /MID SCALE/.test(f.DAC || "") && /INHIBITED/.test(f.DMA || "");
  note(`DAC back to safe idle: ${result.returnedToIdle}`);
  if (OUT) await writeFile(OUT, JSON.stringify(result, null, 1));
  clearInterval(hb); ws.close();
}
