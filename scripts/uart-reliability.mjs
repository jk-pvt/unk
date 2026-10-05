#!/usr/bin/env node
// UART command-reliability test through the REAL bridge path (browser -> bridge -> UART -> STM32 -> ACK).
// It never sends START and never changes wiring. It only issues environment/source/status/ping/stop commands.
//   node scripts/uart-reliability.mjs [--quick] [--out docs/evidence/uart-reliability.json]
// Device-side truth comes from the firmware's own counters in telemetry (health.UART = "RX n B l LINES i INVALID"),
// so lost, merged and malformed lines are counted on the board, not inferred from the host.
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { WebSocket } from "ws";

const BASE = process.env.BRIDGE || "http://127.0.0.1:4318";
const quick = process.argv.includes("--quick");
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : null;
const client = randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(BASE.replace("http", "ws") + "/ws/telemetry", { headers: { Origin: BASE } });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
const beat = () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "controlHeartbeat", client }));
beat(); const hb = setInterval(beat, 250);

async function system() { return (await fetch(BASE + "/api/system")).json(); }
const uartOf = (d) => { const m = /RX (\d+) B (\d+) LINES (\d+) INVALID/.exec(d?.current?.health?.UART || ""); return m ? { bytes: +m[1], lines: +m[2], invalid: +m[3] } : null; };
async function snapshot() { await sleep(1100); const d = await system(); return { uart: uartOf(d), uptime: d.current?.control?.uptimeMs, firmware: d.current?.firmware, outputEnabled: d.current?.control?.outputEnabled, health: d.current?.health, requested: d.current?.requestedWaveform, applied: d.current?.waveform, env: d.current?.environment, adc: d.current?.adc, control: d.current?.control, link: d.transmitter }; }

async function post(path, body) {
  const t0 = performance.now();
  try {
    const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, client }) });
    const j = await r.json().catch(() => ({}));
    const wall = performance.now() - t0;
    if (r.ok) return { kind: "ACK", status: j.status, ms: j.roundTripMs ?? wall, wall };
    const err = String(j.error || "");
    if (/timed out/i.test(err)) return { kind: "LOST", error: err, wall };
    if (/outcome unknown|awaiting fresh telemetry|Another command|Device unavailable|read-only/i.test(err)) return { kind: "BLOCKED", error: err, wall };
    return { kind: "ACK", status: "REJECTED", error: err, ms: wall, wall };  // device answered with a rejection (bridge turns it into an error)
  } catch (e) { return { kind: "HTTPFAIL", error: String(e.message), wall: performance.now() - t0 }; }
}

const CYCLE = [
  ["source WEB_COMMAND", () => post("/api/transmitter", { op: "source", source: "WEB_COMMAND" }), "short"],
  ["SET_ENV CLEAR", () => post("/api/environment", { profile: "CLEAR_SHALLOW_REEF" }), "long"],
  ["GET_STATUS", () => post("/api/transmitter", { op: "status" }), "short"],
  ["SET_ENV MUDDY", () => post("/api/environment", { profile: "MUDDY_ESTUARY" }), "long"],
  ["PING", () => post("/api/transmitter", { op: "ping" }), "short"],
  ["SET_ENV_VALUES", () => post("/api/environment", { turbidityIndex: 12, depth: 3, temperature: 26 }), "long"],
  ["STOP", () => post("/api/transmitter", { op: "stop" }), "short"],
  ["SET_ENV SEDIMENT", () => post("/api/environment", { profile: "SEDIMENT_PLUME" }), "long"],
  ["SET_ENV DEEP", () => post("/api/environment", { profile: "DEEP_OPEN_WATER" }), "long"],
  ["source ADC_DIAL", () => post("/api/transmitter", { op: "source", source: "ADC_DIAL" }), "short"],
];

const percentile = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };
const results = [];
async function phase(name, gapMs, count) {
  const before = await snapshot();
  const rows = []; let i = 0;
  while (rows.length < count) {
    const [label, fn, size] = CYCLE[i++ % CYCLE.length];
    const r = await fn(); rows.push({ label, size, ...r });
    if (r.kind === "LOST" || r.kind === "BLOCKED") await sleep(1500);  // let the bridge reconcile before continuing
    else if (gapMs) await sleep(gapMs);
  }
  const after = await snapshot();
  const lat = rows.filter((r) => r.kind === "ACK").map((r) => r.ms);
  const accepted = rows.filter((r) => r.kind === "ACK" && r.status === "ACCEPTED").length;
  const rejected = rows.filter((r) => r.kind === "ACK" && r.status === "REJECTED");
  const lost = rows.filter((r) => r.kind === "LOST");
  const blocked = rows.filter((r) => r.kind === "BLOCKED");
  const dev = before.uart && after.uart ? { bytes: after.uart.bytes - before.uart.bytes, lines: after.uart.lines - before.uart.lines, invalid: after.uart.invalid - before.uart.invalid } : null;
  const res = { phase: name, gapMs, sent: rows.length, accepted, rejected: rejected.length, rejectedWhy: [...new Set(rejected.map((r) => r.error))], lost: lost.length, blocked: blocked.length,
    deviceDelta: dev, bridgeKeepalivesAndHandshakeLines: dev ? dev.lines - (rows.length - blocked.length) : null,
    latencyMs: { median: percentile(lat, 50), p95: percentile(lat, 95), max: lat.length ? Math.max(...lat) : null, n: lat.length },
    uptimeBefore: before.uptime, uptimeAfter: after.uptime, deviceReset: after.uptime != null && before.uptime != null && after.uptime < before.uptime, lostDetail: lost.map((r) => r.label) };
  results.push(res); console.log(JSON.stringify(res)); return rows;
}

const start = await snapshot();
console.log("START", JSON.stringify({ firmware: start.firmware, uart: start.uart, outputEnabled: start.outputEnabled, link: start.link }));
if (start.outputEnabled) { console.error("Output is enabled; refusing to run."); process.exit(2); }
if (!start.link?.ready) { console.error("Bridge link not ready:", JSON.stringify(start.link)); }

const N = quick ? 0.2 : 1;
await phase("back-to-back", 0, Math.round(120 * N));
await phase("100 ms spacing", 100, Math.round(80 * N));
await phase("500 ms spacing", 500, Math.round(60 * N));
await phase("1 s idle gaps", 1000, Math.round(40 * N));
await phase("2 s idle gaps", 2000, Math.round(30 * N));

const end = await snapshot();
const all = results.reduce((a, r) => ({ sent: a.sent + r.sent, accepted: a.accepted + r.accepted, rejected: a.rejected + r.rejected, lost: a.lost + r.lost, blocked: a.blocked + r.blocked }), { sent: 0, accepted: 0, rejected: 0, lost: 0, blocked: 0 });
const summary = { when: new Date().toISOString(), firmware: end.firmware, start: start.uart, end: end.uart, outputEverEnabled: end.outputEnabled, totals: all,
  deviceTotals: start.uart && end.uart ? { bytes: end.uart.bytes - start.uart.bytes, lines: end.uart.lines - start.uart.lines, invalid: end.uart.invalid - start.uart.invalid } : null,
  phases: results, healthAfter: { UART: end.health?.UART, DAC: end.health?.DAC, DMA: end.health?.DMA, TIMER: end.health?.TIMER, underruns: end.control && undefined } };
console.log("TOTAL", JSON.stringify(summary.totals), "device", JSON.stringify(summary.deviceTotals));
if (OUT) await writeFile(OUT, JSON.stringify(summary, null, 1));
clearInterval(hb); ws.close();
