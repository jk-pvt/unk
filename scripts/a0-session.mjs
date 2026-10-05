#!/usr/bin/env node
// Guided A0 / TDS_PROXY session. Switches the board to its A0 input and logs what it reads and which profile the policy picks, while YOU change what the TDS
// probe is sitting in (tap water, then a little salt at a time). It sends no START: output stays off the whole time. It labels the input TDS_PROXY, never turbidity.
//   BRIDGE=http://127.0.0.1:4330 node scripts/a0-session.mjs [--seconds 300] [--out docs/evidence/a0-session.json]
// Dip only the probe end that is already outside the payload. Do not open the payload and do not disconnect anything. The table of switching points is
//   node scripts/a0-policy-table.mjs     (rising 926 mV CLEAR to TRANSITION, 1731 mV TRANSITION to MURKY; falling 1489 mV and 684 mV)
// The script reports which of those the board actually crossed; any it did not cross stay PENDING.
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { WebSocket } from "ws";

const BASE = process.env.BRIDGE || "http://127.0.0.1:4330";
const a = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const SECONDS = Number(a("--seconds", "300")), OUT = a("--out", null);
const client = randomUUID(), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = new WebSocket(BASE.replace("http", "ws") + "/ws/telemetry", { headers: { Origin: BASE } });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
const beat = () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "controlHeartbeat", client })); beat(); const hb = setInterval(beat, 250); await sleep(600);
const post = async (p, b) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...b, client }) }); return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }; };
const state = async () => (await (await fetch(BASE + "/api/system")).json()).current;
const log = [], transitions = []; let lastProfile = null, maxOut = false;
try {
  let c = await state(); if (c?.control?.outputEnabled) throw new Error("Output is enabled; stop it first");
  const r = await post("/api/transmitter", { op: "source", source: "ADC_DIAL" }); if (!r.ok) throw new Error("source ADC_DIAL: " + (r.body.error || r.status));
  console.log(`Logging for ${SECONDS} s. Change what the TDS probe is in; watch the profile follow. Ctrl+C ends early and still saves.`);
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) {
    await sleep(1000); c = await state(); const adc = c?.adc, prof = c?.control?.profile;
    if (c?.control?.outputEnabled) maxOut = true;
    const row = { t: Math.round((Date.now() - t0) / 1000), source: c?.environment?.source, sensor: adc?.sensor, raw: adc?.raw, millivolts: adc?.millivolts, filteredLevelPct: adc?.filteredLevel, valid: adc?.valid, profile: prof, qualified: c?.control?.qualified, requested: c?.requestedWaveform ? `${c.requestedWaveform.frequency} kHz / ${c.requestedWaveform.bandwidth} kHz / ${c.requestedWaveform.pulse} ms` : null };
    log.push(row);
    if (prof !== lastProfile) { if (lastProfile !== null) transitions.push({ t: row.t, from: lastProfile, to: prof, raw: row.raw, millivolts: row.millivolts, filteredLevelPct: row.filteredLevelPct }); lastProfile = prof; }
    if (row.t % 5 === 0 || transitions.at(-1)?.t === row.t) console.log(`t+${String(row.t).padStart(3)} s  ${row.sensor || "?"} raw ${row.raw ?? "?"} (${row.millivolts ?? "?"} mV)  level ${row.filteredLevelPct ?? "?"} %  policy ${prof}  ${row.requested || ""}`);
  }
} catch (e) { console.error("ABORT:", e.message); process.exitCode = 1; }
finally {
  const seen = new Set(log.map((l) => l.profile)), crossed = transitions.map((t) => `${t.from} to ${t.to} at ${t.millivolts} mV`);
  console.log(`\nProfiles seen on A0: ${[...seen].join(", ") || "none"}. Transitions: ${crossed.join("; ") || "none"}. Output ${maxOut ? "WAS ENABLED (unexpected)" : "stayed off"}.`);
  for (const p of ["CLEAR", "TRANSITION", "MURKY"]) if (!seen.has(p)) console.log(`  ${p}: PENDING (not reached from A0 in this session)`);
  if (OUT) await writeFile(OUT, JSON.stringify({ when: new Date().toISOString(), label: "A0 input, TDS_PROXY (not turbidity)", startSent: false, profilesSeen: [...seen], transitions, log }, null, 1));
  clearInterval(hb); ws.close();
}
