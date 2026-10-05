import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { referenceFor, PROFILES, parseScopeCsv } from "../shared/bench-capture.js";
import { McuCaptureCoordinator } from "../server/mcu-coordinator.js";
import { BenchStore } from "../server/bench-store.js";

// SYNTHETIC ADC counts built in the test; the store/coordinator are exercised, nothing here is evidence.
const counts = (() => { const ref = referenceFor({ ...PROFILES.CLEAR, window: "HANN" }, 1, 500000), n = 6000, o = new Uint16Array(n).fill(2048); ref.samples.forEach((v, i) => { if (150 + i < n) o[150 + i] = Math.round(((1.65 + v) / 3.3) * 4095); }); return o; })();
const hex3 = (a) => Array.from(a, (v) => v.toString(16).toUpperCase().padStart(3, "0")).join("");
const chunks = (id = 1) => { const out = []; for (let o = 0; o < 6000; o += 600) out.push({ version: 1, type: "capture", id, mode: 0, rate: 500000, total: 6000, offset: o, n: 600, d: hex3(counts.subarray(o, o + 600)) }); return out; };

test("coordinator resolves the next completed capture and rejects on a gap or a timeout", async () => {
  const c = new McuCaptureCoordinator(); const w = c.waitForNext(2000); chunks().forEach((p) => c.ingest(p));
  const done = await w; assert.equal(done.id, 1); assert.deepEqual(Array.from(done.counts), Array.from(counts));
  const w2 = c.waitForNext(2000); const ps = chunks(2); c.ingest(ps[0]); c.ingest(ps[2]); await assert.rejects(w2, /gap/);
  await assert.rejects(new McuCaptureCoordinator().waitForNext(30), /Timed out/);
});

test("store keeps MCU captures apart from oscilloscope evidence, writes a CSV the importer can read, and validates file names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aquasdr-mcu-")), store = new BenchStore(dir);
  const { name, record } = await store.addMcu({ id: 4, mode: 0, rate: 500000, counts, expected: PROFILES.CLEAR, profile: "CLEAR", window: "HANN", deviceStats: null, firmware: { id: "AQUASDR_ADAPTIVE" }, label: "unit" });
  assert.match(name, /^mcu-\d{14}-4-pulse$/); assert.equal(record.provenance, "MCU_ADC_CAPTURE");
  const files = await readdir(join(dir, "bench")); assert.ok(files.includes(name + ".json") && files.includes(name + ".csv"));
  assert.equal((await store.evidence()).captures.length, 0, "must not appear among oscilloscope captures");
  assert.equal((await store.captures()).length, 0);
  const ev = await store.mcuEvidence(); assert.equal(ev.captures.length, 1); assert.equal(ev.latest.traces, undefined);
  const t = await store.mcuTraces(name); assert.ok(t.traces.zoom.volts.length === 200);
  const back = parseScopeCsv(await readFile(store.csvPath(name), "utf8")); assert.equal(back.sampleRate, 500000);
  assert.equal(store.csvPath("../../etc/passwd"), null); assert.equal(store.csvPath("mcu-1-2-pulse"), null);
});

test("HTTP: empty MCU state, refusal without hardware, and file-name validation", async () => {
  const probe = createServer(); await new Promise((r) => probe.listen(0, "127.0.0.1", r)); const port = probe.address().port; await new Promise((r) => probe.close(r));
  const child = spawn(process.execPath, ["server/index.js"], { env: { ...process.env, PORT: String(port), AQUASDR_DATA_DIR: await mkdtemp(join(tmpdir(), "aquasdr-mcuapi-")) }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; child.stdout.on("data", (s) => (logs += s)); child.stderr.on("data", (s) => (logs += s));
  try {
    for (let i = 0; i < 200 && !logs.includes("AquaSDR bridge"); i++) await new Promise((r) => setTimeout(r, 25));
    const u = (p) => `http://127.0.0.1:${port}/api/${p}`;
    const e = await (await fetch(u("bench/mcu"))).json(); assert.deepEqual(e.captures, []); assert.equal(e.latest, null);
    assert.equal((await fetch(u("bench/mcu/traces"))).status, 404);
    assert.equal((await fetch(u("bench/mcu/..%2F..%2Fsecret.csv"))).status, 400);
    const post = await fetch(u("bench/mcu-capture"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: 0, client: "x" }) });
    assert.equal(post.status, 409, "demo mode has no STM32 to capture from");
  } finally { child.kill(); }
});
