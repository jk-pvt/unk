#!/usr/bin/env node
// Exercises the WHOLE adaptation policy range through the web path, without needing salty water: SET_ENV_VALUES with a turbidity-index sweep (up, then down) so the
// board's C policy walks CLEAR -> TRANSITION -> MURKY and back through its hysteresis. Output is never started by this script. With --capture it also takes one
// MCU ADC CAPTURE of the raw DAC pin the first time each profile is reached (CAPTURE_DAC enables one pulse and the firmware stops it itself).
//   BRIDGE=http://127.0.0.1:4330 node scripts/policy-range.mjs [--capture] [--out docs/evidence/policy-range.json]
// This is the web path. It proves the policy and its waveform selection; it does NOT prove the A0/TDS input reaches the higher bands (that needs the probe in salty water, see a0-session.mjs).
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { WebSocket } from "ws";

const BASE = process.env.BRIDGE || "http://127.0.0.1:4330", CAPTURE = process.argv.includes("--capture");
const o = process.argv.indexOf("--out"), OUT = o > 0 ? process.argv[o + 1] : null;
const client = randomUUID(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), NAMES = ["CLEAR", "TRANSITION", "MURKY"];
const LEVELS = [5, 30, 38, 42, 60, 74, 77, 95, 70, 66, 63, 40, 31, 28, 5];       // each at least 1 away from a threshold (40 / 75 rising, 65 / 30 falling)
// Same rules as firmware/src/adaptation.c, written out here only to compare the board's answer with an independent statement of the policy.
const expectNext = (p, l) => (p < 0 ? (l < 35 ? 0 : l < 70 ? 1 : 2) : p === 0 ? (l >= 75 ? 2 : l >= 40 ? 1 : 0) : p === 1 ? (l < 30 ? 0 : l >= 75 ? 2 : 1) : (l < 30 ? 0 : l < 65 ? 1 : 2));

const ws = new WebSocket(BASE.replace("http", "ws") + "/ws/telemetry", { headers: { Origin: BASE } });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
const beat = () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "controlHeartbeat", client })); beat(); const hb = setInterval(beat, 250); await sleep(600);
const post = async (p, b) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...b, client }) }); return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }; };
const state = async () => (await (await fetch(BASE + "/api/system")).json()).current;
const wf = (w) => (w ? `${w.mode} ${w.frequency} kHz / ${w.bandwidth} kHz / ${w.pulse} ms / ${w.amplitude} % / ${w.window}` : null);
const steps = [], captured = new Set(); let prev = -1, mismatches = 0;
try {
  const pre = await state(); if (pre?.control?.outputEnabled) throw new Error("Output is enabled; stop it first");
  if (!pre?.identity?.capabilities?.includes("WEB_CONTROL")) throw new Error("firmware does not advertise WEB_CONTROL");
  let r = await post("/api/transmitter", { op: "source", source: "WEB_COMMAND" }); if (!r.ok) throw new Error("source WEB_COMMAND: " + (r.body.error || r.status));
  for (const lv of LEVELS) {
    r = await post("/api/environment", { turbidityIndex: lv, depth: 0, temperature: 25 });
    if (!r.ok) throw new Error(`SET_ENV_VALUES ${lv}: ${r.status} ${r.body.error || ""}`);
    await sleep(1200);
    const c = await state(), got = NAMES.indexOf(c.control?.profile), want = expectNext(prev, lv);
    const ok = got === want && c.control?.outputEnabled === false; if (!ok) mismatches++;
    steps.push({ turbidityIndex: lv, ackMs: r.body.roundTripMs, policy: c.control?.profile, expected: NAMES[want], match: ok, qualified: c.control?.qualified, requested: wf(c.requestedWaveform), outputEnabled: c.control?.outputEnabled });
    console.log(`index ${String(lv).padStart(3)}  policy ${String(c.control?.profile).padEnd(10)} expected ${NAMES[want].padEnd(10)} ${ok ? "OK" : "MISMATCH"}  requested ${wf(c.requestedWaveform)}`);
    if (got >= 0) prev = got;
    if (CAPTURE && ok && got >= 0 && !captured.has(got)) {
      captured.add(got); const cr = await post("/api/bench/mcu-capture", { mode: 0, tap: "RAW_DAC", label: `policy ${NAMES[got]}` });
      console.log(`   MCU ADC CAPTURE ${NAMES[got]}: ${cr.ok ? `${cr.body.name} ${cr.body.allPass ? "within tolerance" : "differs"}` : "failed " + (cr.body.error || cr.status)}`); steps[steps.length - 1].capture = cr.ok ? cr.body.name : null;
    }
  }
} catch (e) { console.error("ABORT:", e.message); process.exitCode = 1; }
finally {
  const f = await state().catch(() => null);
  console.log(`\n${steps.length} steps, ${mismatches} mismatches; output ${f?.control?.outputEnabled ? "ENABLED (unexpected)" : "off"}`);
  if (OUT) await writeFile(OUT, JSON.stringify({ when: new Date().toISOString(), path: "web SET_ENV_VALUES; no START sent", steps, mismatches }, null, 1));
  clearInterval(hb); ws.close();
}
