// MCU ADC CAPTURE: the STM32 samples its own DAC pin (PA4, jumpered to A5/PC0) with ADC3, triggered by TIM8 and moved by DMA2.
//
// This is NOT an oscilloscope measurement and is never labelled as one. Its limits are stated in LIMITS and travel with every record:
//  * It is ratiometric. The DAC and the ADC share the same reference (VDDA), so counts are compared with the DAC code, and volts are
//    counts / 4095 x VREF where VREF is an assumption (3.3 V by default), not a measurement.
//  * 500 kS/s gives about 12 samples per 42 kHz cycle, so peak-to-peak can read up to about 3.4 % low even when nothing is wrong.
//  * It sees the pin only through a jumper and the ADC's own input network, with the ADC clocked by the same chip that makes the signal.
//  * Train mode (100 kS/s) puts the carrier near Nyquist: only envelope and timing mean anything, not amplitude or frequency.
// No distortion or THD figure is derived from it, because 12-bit sampling of the board's own output cannot support one.
import { createHash } from "node:crypto";
import { analyzeCapture, referenceFor, compare, TOLERANCE, spectrumTrace, envelopeTrace, stripInternals, PROFILES, WINDOW_NAMES } from "./bench-capture.js";
import { TAPS, TAP_IDS, applyTap, transfer, adcPinRange } from "./afe-model.js";
import { compressionEvidence } from "./pulse-compression.js";

export const MCU_PROVENANCE = "MCU_ADC_CAPTURE";
export const DEFAULT_VREF = 3.3;
export const MODE_NAMES = ["pulse", "train"];
export const LIMITS = [
  "MCU ADC CAPTURE: the board sampling its own DAC pin; not an oscilloscope or spectrum-analyzer measurement",
  `Volts are counts / 4095 x ${DEFAULT_VREF} V (assumed reference, not measured on this board)`,
  "At 500 kS/s a 42 kHz carrier has about 12 samples per cycle: peak-to-peak can read up to about 3.4 % low",
  "No distortion figure is derived; it cannot be supported by 12-bit sampling of the board's own output",
];

export const DEFAULT_TAP = "RAW_DAC";
// Extra statements that travel with a record whose ADC input was not the raw DAC pin.
export const tapLimits = (tap) => tap === DEFAULT_TAP ? [] : [
  `Tap ${TAPS[tap].point}: the expected values come from a linear model of the DESIGNED stage (hardware/analog), not from the parts actually built`,
  "The stage sits between the DAC and the ADC: any gain, offset or ripple difference is real analog behaviour OR a wiring/part error, and one capture cannot say which",
  "The ADC reads the stage through a 1 k series resistor and a 1.65 V bias network: it is a bench tap, not the transmitter output connector",
];
const tapGain = (tap, f0) => { const h = transfer(tap, f0 * 1e3); return Math.hypot(h.re, h.im); };
export function checkTap(tap) { if (!TAP_IDS.includes(tap)) throw new Error(`tap must be one of ${TAP_IDS.join(", ")}`); return tap; }
// What the ADC pin should see for the requested waveform on this tap; the bridge refuses a capture whose prediction leaves the safe ADC range.
export function predictedAdcRange(expected, tap, rate = CAPTURE_RATE_PULSE) { return adcPinRange(referenceFor(expected, 1, rate).samples, rate, tap); }
export const CAPTURE_RATE_PULSE = 500000;

export const countsToVolts = (counts, vref = DEFAULT_VREF) => Float64Array.from(counts, (c) => (c / 4095) * vref);

/* ---------------- chunk reassembly ---------------- */
export function decodeChunk(packet) {
  const out = new Uint16Array(packet.n);
  for (let i = 0; i < packet.n; i++) out[i] = parseInt(packet.d.slice(i * 3, i * 3 + 3), 16);
  return out;
}

// Strict: chunks must arrive contiguously and in order for one id. Anything else invalidates that capture instead of guessing.
export class CaptureAssembler {
  constructor() { this.current = null; this.failed = new Map(); }
  add(packet) {
    let cur = this.current;
    if (!cur || cur.id !== packet.id) {
      if (cur && cur.next < cur.total) this.failed.set(cur.id, `superseded by capture ${packet.id} before ${cur.next}/${cur.total} samples arrived`);
      cur = this.current = { id: packet.id, mode: packet.mode, rate: packet.rate, total: packet.total, counts: new Uint16Array(packet.total), next: 0 };
    }
    if (this.failed.has(cur.id)) return { error: this.failed.get(cur.id) };
    if (packet.mode !== cur.mode || packet.rate !== cur.rate || packet.total !== cur.total) { this.failed.set(cur.id, "chunk header changed mid-capture"); return { error: this.failed.get(cur.id) }; }
    if (packet.offset < cur.next) return { duplicate: true };                       // a repeated chunk is ignored, never merged
    if (packet.offset > cur.next) { this.failed.set(cur.id, `gap: expected offset ${cur.next}, got ${packet.offset}`); return { error: this.failed.get(cur.id) }; }
    cur.counts.set(decodeChunk(packet), packet.offset); cur.next += packet.n;
    if (cur.next === cur.total) { this.current = null; return { complete: { id: cur.id, mode: cur.mode, rate: cur.rate, counts: cur.counts } }; }
    return { progress: cur.next / cur.total };
  }
}

/* ---------------- analysis ---------------- */
// Burst runs above 10 % of the envelope peak (same rule as the oscilloscope analysis), for repetition timing.
// A real pulse lasts at least about a millisecond. Runs shorter than MIN_BURST_MS (a single-sample spike is 10 us at 100 kS/s) are not pulses:
// they are returned separately as glitches so the data-quality finding stays visible instead of being counted as a pulse or silently dropped.
export const MIN_BURST_MS = 0.2;
export function burstStartsMs(volts, rate) {
  const a = analyzeCapture(volts, rate, {});
  if (!a.ok) return { starts: [], durations: [], glitches: [] };
  const env = a._envelope, peak = Math.max(...env), level = 0.1 * peak, gap = Math.round(50e-6 * rate);
  const runs = []; let start = -1, last = -1;
  for (let i = 0; i < env.length; i++) {
    if (env[i] >= level) { if (start < 0) start = i; else if (i - last > gap) { runs.push([start, last]); start = i; } last = i; }
  }
  if (start >= 0) runs.push([start, last]);
  const toMs = ([s, e]) => ({ atMs: s / rate * 1000, widthMs: (e - s + 1) / rate * 1000 });
  const pulses = runs.map(toMs).filter((r) => r.widthMs >= MIN_BURST_MS), glitches = runs.map(toMs).filter((r) => r.widthMs < MIN_BURST_MS);
  return { starts: pulses.map((r) => r.atMs), durations: pulses.map((r) => r.widthMs), glitches };
}

function trainRows(volts, rate, expected, refVolts) {
  const m = burstStartsMs(volts, rate), r = burstStartsMs(refVolts, rate);
  const intervals = m.starts.slice(1).map((s, i) => s - m.starts[i]);
  const row = (name, measured, computed, unit, tol, nominal) => ({ name, measured, computed, nominal: nominal ?? null, unit, error: Number.isFinite(measured) && Number.isFinite(computed) ? measured - computed : null, tolerance: tol,
    pass: Number.isFinite(measured) && Number.isFinite(computed) ? Math.abs(measured - computed) <= tol : null });
  const interval = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
  return { burstStartsMs: m.starts, burstDurationsMs: m.durations, intervalsMs: intervals, glitches: m.glitches, rows: [
    row("Pulses in capture", m.starts.length, 2, "", 0, 2),
    row("Pulse repetition interval", interval, expected.pingIntervalMs ?? 100, "ms", 10, expected.pingIntervalMs ?? 100),
    row("Pulse duration (10 % envelope)", m.durations[0], r.durations[0], "ms", Math.max(0.5, (r.durations[0] || 0) * 0.15), expected.pulse),
  ] };
}

export function analyzeMcu({ counts, rate, mode, expected, vref = DEFAULT_VREF, tap = DEFAULT_TAP }) {
  checkTap(tap);
  const volts = countsToVolts(counts, vref);
  if (mode === 1) {
    const ref = referenceFor(expected, 1, rate);
    // reference train: two pulses 100 ms apart, built the same way and analysed by the same function
    const gapN = Math.round(0.1 * rate), one = ref.samples, len = Math.min(counts.length, gapN + one.length);
    const refTrain = new Float64Array(counts.length); refTrain.set(one.subarray(0, Math.min(one.length, len)), 0);
    for (let i = 0; i < one.length && gapN + i < refTrain.length; i++) refTrain[gapN + i] = one[i];
    const t = trainRows(volts, rate, expected, applyTap(refTrain, rate, tap));
    return { mode: "train", rows: t.rows, allPass: t.rows.every((r) => r.pass !== false), burst: t, note: "Train mode: envelope and timing only. Amplitude and frequency are not reliable at 100 kS/s." };
  }
  const measured = analyzeCapture(volts, rate, expected);
  if (!measured.ok) return { mode: "pulse", ok: false, error: measured.error };
  const ref = referenceFor(expected, 1, rate), reference = analyzeCapture(applyTap(ref.samples, rate, tap), rate, expected);
  const cmp = compare(measured, reference, expected, tapGain(tap, expected.frequency));
  // Pulse compression: the capture against the calculated waveform of the requested class (and of the other two classes).
  const comp = compressionEvidence(volts, rate, expected, (t) => applyTap(t, rate, tap));
  const rows = [...cmp.rows, ...comp.rows];
  return { mode: "pulse", ok: true, measured, reference, rows, allPass: rows.every((r) => r.pass !== false) && comp.classMatch?.pass !== false, relativeVppErrorPct: cmp.relativeVppErrorPct, compression: comp.ok ? { measured: comp.measured, calculated: comp.calculated, classMatch: comp.classMatch } : null };
}

/* ---------------- record + CSV ---------------- */
export function buildMcuRecord({ id, mode, rate, counts, expected, profile = null, window, deviceStats = null, vref = DEFAULT_VREF, firmware = null, label = "", tap = DEFAULT_TAP }) {
  checkTap(tap);
  if (!WINDOW_NAMES.includes(window)) throw new Error(`window must be one of ${WINDOW_NAMES.join(", ")}`);
  if (![0, 1].includes(mode)) throw new Error("mode must be 0 (pulse) or 1 (train)");
  const exp = { ...expected, window };
  const a = analyzeMcu({ counts, rate, mode, expected: exp, vref, tap });
  const volts = countsToVolts(counts, vref);
  let traces = null;
  if (a.ok !== false && mode === 0) {
    const m = a.measured, r = a.reference;
    const mid = Math.round((m.burst.startMs + m.burst.durationMs / 2) / 1000 * rate), half = 100;
    const lo = Math.max(0, Math.min(counts.length - 2 * half, mid - half));
    traces = { measuredSpectrum: spectrumTrace(m), computedSpectrum: spectrumTrace(r), measuredEnvelope: envelopeTrace(m), computedEnvelope: envelopeTrace(r),
      zoom: { fromMs: lo / rate * 1000, stepMs: 1000 / rate, volts: Array.from(volts.subarray(lo, lo + 2 * half), (v) => Math.round(v * 1e4) / 1e4) } };
  } else if (mode === 1) {
    const step = Math.max(1, Math.floor(counts.length / 800)), env = [];
    for (let i = 0; i < counts.length; i += step) { let lo = 9999, hi = 0; for (let j = i; j < Math.min(counts.length, i + step); j++) { lo = Math.min(lo, counts[j]); hi = Math.max(hi, counts[j]); } env.push([lo, hi]); }
    traces = { trainMinMax: { stepMs: step / rate * 1000, minMax: env } };
  }
  const stats = (() => { let lo = 4095, hi = 0, sum = 0; for (const c of counts) { if (c < lo) lo = c; if (c > hi) hi = c; sum += c; } return { minCounts: lo, maxCounts: hi, meanCounts: sum / counts.length }; })();
  const sha256 = createHash("sha256").update(Buffer.from(counts.buffer, counts.byteOffset, counts.byteLength)).digest("hex");
  const { measured, reference, ...analysis } = a;
  return {
    version: 1, provenance: MCU_PROVENANCE, label, captureId: id, mode: MODE_NAMES[mode], modeIndex: mode, capturedAt: new Date().toISOString(),
    tap, tapLabel: TAPS[tap].label,
    source: { description: tap === DEFAULT_TAP ? "ADC3 sampling PA4 through the A2-A5 jumper, TIM8-triggered, DMA2" : `ADC3 (A5) sampling the ${TAPS[tap].label}, TIM8-triggered, DMA2`, sampleRate: rate, samples: counts.length, durationMs: counts.length / rate * 1000, vref, vrefIsAssumed: true, sha256 },
    firmware, profile, window, expected: exp, limits: [...LIMITS, ...tapLimits(tap)], counts: stats, deviceStats,
    deviceStatsAgree: deviceStats ? deviceStats.minCounts === stats.minCounts && deviceStats.maxCounts === stats.maxCounts : null,
    measured: measured ? stripInternals(measured) : null, computed: reference ? { provenance: "COMPUTED", model: tap === DEFAULT_TAP ? "C reference" : "C reference through the designed analog stage", ...stripInternals(reference) } : null,
    comparison: { rows: a.rows ?? [], allPass: a.allPass ?? null, relativeVppErrorPct: a.relativeVppErrorPct ?? null, error: a.error ?? null },
    compression: analysis.compression ?? null,
    train: mode === 1 ? { burstStartsMs: analysis.burst.burstStartsMs, burstDurationsMs: analysis.burst.burstDurationsMs, intervalsMs: analysis.burst.intervalsMs, glitches: analysis.burst.glitches,
      note: analysis.note + (analysis.burst.glitches.length ? ` ${analysis.burst.glitches.length} isolated spike(s) shorter than ${MIN_BURST_MS} ms were not counted as pulses (data-quality finding, source not established).` : "") } : null,
    tolerances: TOLERANCE, traces,
  };
}

// CSV the existing bench importer reads: time, volts (channel 1), counts. Non-numeric header lines are skipped by parseScopeCsv.
export function mcuCsv(record, counts) {
  const rate = record.source.sampleRate, vref = record.source.vref;
  const head = [`# ${MCU_PROVENANCE}: ${record.source.description}`, `# capture ${record.captureId} mode ${record.mode} rate ${rate} Hz, vref ${vref} V ASSUMED, window ${record.window}, tap ${record.tap || DEFAULT_TAP}`, "# NOT an oscilloscope measurement", "time_s,volts,adc_counts"];
  const rows = Array.from(counts, (c, i) => `${(i / rate).toExponential(6)},${((c / 4095) * vref).toFixed(5)},${c}`);
  return head.concat(rows).join("\n") + "\n";
}

export const expectedFromProfile = (profile) => ({ ...PROFILES[profile] });

/* ---------------- raw DAC vs analog-stage comparison ---------------- */
const SAME = ["frequency", "bandwidth", "pulse", "amplitude", "mode"];
export const sameSetup = (a, b) => a.mode === "pulse" && b.mode === "pulse" && a.window === b.window && SAME.every((k) => a.expected?.[k] === b.expected?.[k]);
// Pairs a capture of a tap with the raw-DAC capture of the same waveform. Everything compared is MCU ADC capture against MCU ADC capture
// (plus the model); none of it is an oscilloscope measurement.
export function compareTaps(raw, tapped) {
  if (!raw || !tapped) return { ok: false, reason: "needs a raw DAC capture and a capture of the analog stage" };
  if ((raw.tap || DEFAULT_TAP) !== DEFAULT_TAP) return { ok: false, reason: "the first record must be a raw DAC capture" };
  if ((tapped.tap || DEFAULT_TAP) === DEFAULT_TAP) return { ok: false, reason: "the second record must be a capture of the analog stage" };
  if (!sameSetup(raw, tapped)) return { ok: false, reason: "the two captures used different waveform settings or windows" };
  const rm = raw.measured, tm = tapped.measured, rc = raw.computed, tc = tapped.computed;
  if (!rm || !tm || !rc || !tc) return { ok: false, reason: "a capture has no analysis" };
  const row = (name, rawV, tapV, modelRaw, modelTap, unit, tol, kind = "level") => {
    const measuredDelta = Number.isFinite(rawV) && Number.isFinite(tapV) ? (kind === "ratio" ? tapV / rawV : tapV - rawV) : null;
    const modelDelta = Number.isFinite(modelRaw) && Number.isFinite(modelTap) ? (kind === "ratio" ? modelTap / modelRaw : modelTap - modelRaw) : null;
    return { name, raw: rawV, tapped: tapV, measuredChange: measuredDelta, modelChange: modelDelta, unit, tolerance: tol, kind,
      pass: tol === null || measuredDelta === null || modelDelta === null ? null : Math.abs(measuredDelta - modelDelta) <= tol };
  };
  const rows = [
    row("Peak-to-peak ratio (stage / raw)", rm.vpp, tm.vpp, rc.vpp, tc.vpp, "x", Math.max(0.05, tc.vpp / rc.vpp * TOLERANCE.vppPct / 100), "ratio"),
    row("FFT peak", rm.peakKHz, tm.peakKHz, rc.peakKHz, tc.peakKHz, "kHz", Math.max(TOLERANCE.frequencyKHz, raw.expected.bandwidth || 0)),
    row("Spectral centroid", rm.centroidKHz, tm.centroidKHz, rc.centroidKHz, tc.centroidKHz, "kHz", TOLERANCE.frequencyKHz),
    row("Occupied bandwidth (99 %)", rm.occupiedBandwidthKHz, tm.occupiedBandwidthKHz, rc.occupiedBandwidthKHz, tc.occupiedBandwidthKHz, "kHz", Math.max(0.5, rc.occupiedBandwidthKHz * 0.25)),
    row("Pulse duration (20 % envelope)", rm.burst.duration20Ms, tm.burst.duration20Ms, rc.burst.duration20Ms, tc.burst.duration20Ms, "ms", Math.max(0.05, rc.burst.duration20Ms * TOLERANCE.durationPct / 100)),
    row("Out-of-band leakage", rm.leakageDb, tm.leakageDb, rc.leakageDb, tc.leakageDb, "dB", TOLERANCE.leakageDb),
    // Informational: the quiet-part noise of the ADC reading is limited by the ADC itself (one count = 0.8 mV), so no limit is judged.
    { name: "Noise floor, quiet part of the capture", raw: Number.isFinite(rm.noiseRmsV) ? rm.noiseRmsV * 1000 : null, tapped: Number.isFinite(tm.noiseRmsV) ? tm.noiseRmsV * 1000 : null, measuredChange: null, modelChange: null, unit: "mV RMS", tolerance: null, kind: "level", pass: null, informational: true },
    { name: "Spectral floor, median far from the band", raw: rm.spectralFloorDb, tapped: tm.spectralFloorDb, measuredChange: null, modelChange: null, unit: "dB re peak", tolerance: null, kind: "level", pass: null, informational: true },
  ];
  const ratio = rows[0].measuredChange;
  return { ok: true, tap: tapped.tap, tapLabel: tapped.tapLabel, window: raw.window, rawName: raw.captureId, tappedName: tapped.captureId, rows, allPass: rows.every((r) => r.pass !== false),
    gainDb: Number.isFinite(ratio) ? 20 * Math.log10(ratio) : null, modelGainDb: Number.isFinite(rows[0].modelChange) ? 20 * Math.log10(rows[0].modelChange) : null,
    note: "Both sides are MCU ADC captures. Differences from the model can mean a real analog difference or a wiring or part error." };
}
