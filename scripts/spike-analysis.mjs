#!/usr/bin/env node
// Counts isolated spikes in the QUIET parts of stored MCU ADC captures (outside the pulse, with a margin) and reports their rate with an honest
// uncertainty. It reports what the data shows; it does not name a cause. Usage:
//   node scripts/spike-analysis.mjs [data/bench] [--json out.json]
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "data/bench");
const outIdx = process.argv.indexOf("--json"), OUT = outIdx > 0 ? process.argv[outIdx + 1] : null;
const MARGIN_MS = 0.6, SIGMA = 6, MIN_COUNTS = 20;
const median = (a) => { const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };

function quietMask(counts, rate, dc) {
  // pulse regions: samples whose short-window deviation is large; grown by a margin. Isolated spikes are shorter than 3 samples, so a 3-sample-wide test ignores them.
  const dev = counts.map((c) => Math.abs(c - dc)), n = counts.length, big = new Uint8Array(n), thr = 60;
  for (let i = 1; i < n - 1; i++) if (dev[i - 1] > thr && dev[i] > thr && dev[i + 1] > thr) big[i] = 1;
  const marg = Math.round(MARGIN_MS / 1000 * rate), out = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i++) if (big[i]) for (let j = Math.max(0, i - marg); j <= Math.min(n - 1, i + marg); j++) out[j] = 0;
  return out;
}
const files = (await readdir(dir)).filter((f) => /^mcu-.*\.csv$/.test(f)).sort(), per = [];
for (const f of files) {
  const meta = JSON.parse(await readFile(resolve(dir, f.replace(/\.csv$/, ".json")), "utf8"));
  if ((meta.tap || "RAW_DAC") !== "RAW_DAC") continue;                      // the raw DAC pin only; stage captures are a different circuit
  const counts = Uint16Array.from((await readFile(resolve(dir, f), "utf8")).split("\n").filter((l) => /^[0-9]/.test(l)).map((l) => Number(l.split(",")[2])));
  const rate = meta.source.sampleRate, dc = median(counts), quiet = quietMask(counts, rate, dc);
  const q = []; for (let i = 0; i < counts.length; i++) if (quiet[i]) q.push(counts[i] - dc);
  const mad = median(q.map(Math.abs)) || 1, sigma = 1.4826 * mad, thr = Math.max(SIGMA * sigma, MIN_COUNTS);
  const spikes = []; for (let i = 0; i < counts.length; i++) if (quiet[i] && Math.abs(counts[i] - dc) > thr) {
    let j = i; while (j + 1 < counts.length && quiet[j + 1] && Math.abs(counts[j + 1] - dc) > thr) j++;
    spikes.push({ atMs: +(i / rate * 1000).toFixed(3), widthSamples: j - i + 1, counts: Math.round(counts[i] - dc), peak: Math.round(Math.max(...Array.from(counts.subarray(i, j + 1), (c) => Math.abs(c - dc))) * Math.sign(counts[i] - dc)) }); i = j;
  }
  per.push({ file: f.replace(/\.csv$/, ""), mode: meta.mode, rate, window: meta.window, cls: meta.expected?.mode, samples: counts.length, quietSamples: q.length, quietMs: q.length / rate * 1000, baselineCounts: dc, sigmaCounts: +sigma.toFixed(2), thresholdCounts: +thr.toFixed(1), spikes });
}
const sum = (a, k) => a.reduce((s, x) => s + k(x), 0);
const agg = (list) => { const quietS = sum(list, (r) => r.quietMs) / 1000, n = sum(list, (r) => r.spikes.length), rate = quietS ? n / quietS : null;
  // exact Poisson interval would need a quantile table; for small n use the Garwood bounds via the chi-square approximation of Wilson-Hilferty
  const z = 1.96, lo = n === 0 ? 0 : n * Math.pow(1 - 1 / (9 * n) - z / (3 * Math.sqrt(n)), 3), hi = (n + 1) * Math.pow(1 - 1 / (9 * (n + 1)) + z / (3 * Math.sqrt(n + 1)), 3);
  return { captures: list.length, quietSeconds: +quietS.toFixed(4), spikes: n, perSecond: rate === null ? null : +rate.toFixed(1), perSecond95: quietS ? [+(lo / quietS).toFixed(1), +(hi / quietS).toFixed(1)] : null }; };
// Is a cluster of spikes on a regular time grid? Phase-coherence scan over periods 20 us to 400 us, compared with the same statistic for uniformly random times
// over the same quiet span (1000 shuffles). Reported as a measured property only; it names no source.
function gridScan(spikes, quietStartMs, quietEndMs) {
  const t = spikes.map((x) => x.atMs * 1000);                                         // microseconds
  const coh = (P) => { let c = 0, s = 0; for (const x of t) { c += Math.cos(2 * Math.PI * x / P); s += Math.sin(2 * Math.PI * x / P); } return Math.hypot(c, s) / t.length; };
  let best = { P: 0, R: 0 }; for (let P = 20; P <= 400; P += 0.05) { const R = coh(P); if (R > best.R) best = { P, R }; }
  let rng = 12345; const rnd = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296);
  let ge = 0; const trials = 1000;
  for (let k = 0; k < trials; k++) { const u = t.map(() => (quietStartMs + rnd() * (quietEndMs - quietStartMs)) * 1000); const c2 = (P) => { let c = 0, s = 0; for (const x of u) { c += Math.cos(2 * Math.PI * x / P); s += Math.sin(2 * Math.PI * x / P); } return Math.hypot(c, s) / u.length; };
    let m = 0; for (let P = 20; P <= 400; P += 0.5) m = Math.max(m, c2(P)); if (m >= best.R) ge++; }
  return { bestPeriodUs: +best.P.toFixed(2), bestFrequencyKHz: +(1000 / best.P).toFixed(3), coherence: +best.R.toFixed(3), shuffledNullAtLeastAsGood: `${ge} of ${trials}`, spikes: t.length };
}
for (const r of per) if (r.spikes.length >= 8) {
  const ts = r.spikes.map((x) => x.atMs); r.gridScan = gridScan(r.spikes, Math.min(...ts) - 0.5, Math.max(...ts) + 0.5);
  r.signs = { positive: r.spikes.filter((x) => x.peak > 0).length, negative: r.spikes.filter((x) => x.peak < 0).length };
}
const clustering = { capturesWithAnySpike: per.filter((r) => r.spikes.length).length, of: per.length, spikesPerCapture: per.map((r) => r.spikes.length) };
const result = { clustering, interpretation: "Spikes are bursty: most captures have none and a few have many, so a single spikes-per-second rate would be misleading and is reported only as a ratio of captures. No source is established.", when: new Date().toISOString(), note: "Spikes in the quiet parts of MCU ADC captures of the raw DAC pin. Source not established by this analysis.", rule: `|x - median| > max(${SIGMA} sigma, ${MIN_COUNTS} counts), pulse regions plus ${MARGIN_MS} ms excluded`,
  pulseMode500kSps: agg(per.filter((r) => r.mode === "pulse")), trainMode100kSps: agg(per.filter((r) => r.mode === "train")), captures: per };
console.log(JSON.stringify({ ...result, captures: per.filter((r) => r.gridScan).map(({ file, mode, cls, spikes, gridScan, signs }) => ({ file, mode, cls, spikes: spikes.length, signs, gridScan })), pulseMode500kSps: undefined, trainMode100kSps: undefined }, null, 1));
for (const r of per.filter((r) => r.spikes.length && r.spikes.length < 10)) console.log(`${r.file} ${r.mode} ${r.cls || ""}: ` + r.spikes.map((s) => `${s.peak > 0 ? "+" : ""}${s.peak} counts @ ${s.atMs} ms (${s.widthSamples} sample${s.widthSamples > 1 ? "s" : ""})`).join(", "));
if (OUT) await writeFile(OUT, JSON.stringify(result, null, 1));
