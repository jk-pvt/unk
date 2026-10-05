// Bench evidence: turns an oscilloscope capture (CSV of volts) into measured metrics and
// compares them with the firmware's computed reference.
//
// Rules this module enforces:
//  * Only a real capture file ever produces provenance "MEASURED". The reference is always
//    "COMPUTED" and is analysed with the *same* function, so analysis bias cancels.
//  * Nothing is estimated from the reference and presented as a measurement.
import { createHash } from 'node:crypto';
import { generateSignal } from './signal.js';

export const PROFILES = {
  CLEAR: { frequency: 42, bandwidth: 4, pulse: 2, amplitude: 35 },
  TRANSITION: { frequency: 40, bandwidth: 2, pulse: 4, amplitude: 50 },
  MURKY: { frequency: 38, bandwidth: 1, pulse: 8, amplitude: 62 },
};
export const POINTS = ['PA4', 'FILTER_OUT', 'OPAMP_OUT'];
export const WINDOW_NAMES = ['RECT', 'HANN', 'HAMMING', 'BLACKMAN'];
export const MODES = { LFM: 'LFM CHIRP', GEOMETRIC: 'GEOMETRIC SWEEP', BARKER: 'PHASE-CODED PULSE' };
// Firmware DAC: 12 bit, 3.3 V reference, amplitude is a percentage of half scale around mid-scale.
const DAC_VREF = 3.3, DAC_HALF = 2047, DAC_FULL = 4095;
// Suggested acceptance criteria for the bench demonstration (engineering choices, not PS numbers).
export const TOLERANCE = { frequencyKHz: 0.5, durationPct: 5, vppPct: 10, leakageDb: 6 };

/* ---------------- CSV ---------------- */
export function parseScopeCsv(text, { rate, channel = 1 } = {}) {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const cells = raw.trim().split(/[,;\t]+/).map((c) => c.trim());
    if (!cells.length || cells.some((c) => c === '' && cells.length === 1)) continue;
    const nums = cells.map((c) => (c === '' ? NaN : Number(c)));
    if (nums.filter(Number.isFinite).length >= 1 && nums.filter((v) => !Number.isFinite(v)).length === 0) rows.push(nums);
  }
  if (rows.length < 64) throw new Error('Capture needs at least 64 numeric rows');
  const width = rows[0].length;
  if (rows.some((r) => r.length !== width)) throw new Error('Rows have inconsistent column counts');
  let samples, sampleRate;
  if (width === 1) {
    if (!(rate > 0)) throw new Error('Single-column capture needs the sample rate (Hz)');
    samples = Float64Array.from(rows, (r) => r[0]); sampleRate = rate;
  } else {
    if (channel >= width) throw new Error(`Channel column ${channel} does not exist (${width} columns)`);
    const t = rows.map((r) => r[0]);
    const dts = []; for (let i = 1; i < t.length; i++) dts.push(t[i] - t[i - 1]);
    const dt = [...dts].sort((a, b) => a - b)[dts.length >> 1];
    if (!(dt > 0)) throw new Error('Time column must increase');
    if (dts.some((d) => Math.abs(d - dt) > dt * 0.01 + 1e-15)) throw new Error('Time column is not uniformly spaced');
    samples = Float64Array.from(rows, (r) => r[channel]); sampleRate = Math.round(1 / dt);
    if (rate > 0 && Math.abs(rate - sampleRate) > sampleRate * 0.01) throw new Error(`--rate ${rate} disagrees with the time column (${sampleRate} Hz)`);
  }
  if (samples.some((v) => !Number.isFinite(v))) throw new Error('Non-finite sample');
  return { samples, sampleRate };
}

/* ---------------- FFT ---------------- */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const p = i + j, q = p + len / 2;
        const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
export const pow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };
const median = (a) => { const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };

export function envelope(x) {
  const n = pow2(x.length), re = new Float64Array(n), im = new Float64Array(n);
  re.set(x); fft(re, im);
  // analytic signal: keep DC and Nyquist, double positive, zero negative frequencies
  for (let k = 1; k < n / 2; k++) { re[k] *= 2; im[k] *= 2; }
  for (let k = n / 2 + 1; k < n; k++) { re[k] = 0; im[k] = 0; }
  fft(re, im, true);
  return Float64Array.from({ length: x.length }, (_, i) => Math.hypot(re[i], im[i]));
}

/* ---------------- analysis ---------------- */
export function analyzeCapture(samples, sampleRate, expected = {}) {
  const dc = median(samples);
  const x = Float64Array.from(samples, (v) => v - dc);
  const env = envelope(x);
  let peakEnv = 0; for (const v of env) peakEnv = Math.max(peakEnv, v);
  if (!(peakEnv > 0)) return { ok: false, error: 'No signal in capture' };
  const level = 0.1 * peakEnv;
  // Bursts: runs above 10 % of the peak; gaps shorter than 50 us do not split a burst.
  // Phase reversals in a phase-coded pulse make the envelope dip; runs closer than one chip belong to the same pulse, so the pulse is one run, not its longest piece.
  const maxGap = Math.round((expected.mode === 'PHASE-CODED PULSE' && expected.pulse > 0 ? Math.max(50e-6, expected.pulse / 1000 / 13) : 50e-6) * sampleRate);
  const runs = []; let start = -1, last = -1;
  for (let i = 0; i < env.length; i++) {
    if (env[i] >= level) { if (start < 0) start = i; else if (i - last > maxGap) { runs.push([start, last]); start = i; } last = i; }
  }
  if (start >= 0) runs.push([start, last]);
  const [i0, i1] = runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  // Width at a second, higher envelope level. A window with an edge pedestal (Hamming: 8 %) puts the 10 % crossing on a cliff where noise alone
  // moves the width by hundreds of microseconds, so the pass/fail duration is taken at 20 %.
  const widthAt = (frac) => {
    let a = -1, b = -1, best = 0, runStart = -1;
    for (let i = 0; i < env.length; i++) {
      if (env[i] >= frac * peakEnv) { if (runStart < 0) runStart = i; else if (i - b > maxGap) { best = Math.max(best, b - runStart + 1); runStart = i; } b = i; a = a < 0 ? i : a; }
    }
    if (runStart >= 0) best = Math.max(best, b - runStart + 1);
    return best / sampleRate * 1000;
  };
  // Time holding the central 90 % of the pulse energy (5 % to 95 % of the cumulative sum). Unlike an envelope threshold it does not depend on dips in the
  // envelope, so it is stable for phase-coded pulses, whose phase reversals make the envelope non-monotonic.
  const energyMs = (() => { let tot = 0; for (const v of x) tot += v * v; let c = 0, a = -1, z = -1;
    for (let i = 0; i < x.length; i++) { c += x[i] * x[i]; if (a < 0 && c >= 0.05 * tot) a = i; if (z < 0 && c >= 0.95 * tot) { z = i; break; } }
    return a >= 0 && z >= a ? (z - a) / sampleRate * 1000 : null; })();
  const seg = x.subarray(i0, i1 + 1);
  let vmax = -Infinity, vmin = Infinity; for (const v of seg) { vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); }
  const durationMs = (seg.length / sampleRate) * 1000;
  const noiseRms = (() => { // quiet part outside the burst, if the capture has any
    const pre = x.subarray(0, Math.max(0, i0 - maxGap)), post = x.subarray(Math.min(x.length, i1 + maxGap));
    const q = pre.length > post.length ? pre : post;
    if (q.length < 32) return null; let s = 0; for (const v of q) s += v * v; return Math.sqrt(s / q.length);
  })();
  // Spectrum of the gated burst, zero-padded for ~10 Hz bins. The pulse is already shaped by the firmware.
  const n = Math.max(pow2(Math.ceil(sampleRate / 10)), pow2(seg.length * 2)), re = new Float64Array(n), im = new Float64Array(n);
  re.set(seg); fft(re, im);
  const bins = n / 2, df = sampleRate / n, mag = new Float64Array(bins);
  let pk = 1; for (let k = 1; k < bins; k++) { mag[k] = Math.hypot(re[k], im[k]); if (mag[k] > mag[pk]) pk = k; }
  const db = Float64Array.from(mag, (m) => 20 * Math.log10(Math.max(m, 1e-12) / mag[pk]));
  const peakHz = pk * df;
  const span = 40e3, lo = Math.max(1, Math.floor((peakHz - span) / df)), hi = Math.min(bins - 1, Math.ceil((peakHz + span) / df));
  let total = 0, wsum = 0; for (let k = lo; k <= hi; k++) { const p = mag[k] * mag[k]; total += p; wsum += p * k * df; }
  let cum = 0, bLo = lo, bHi = hi, gotLo = false;
  for (let k = lo; k <= hi; k++) { cum += mag[k] * mag[k]; if (!gotLo && cum >= 0.005 * total) { bLo = k; gotLo = true; } if (cum >= 0.995 * total) { bHi = k; break; } }
  let l20 = pk, h20 = pk; while (l20 > lo && db[l20 - 1] > -20) l20--; while (h20 < hi && db[h20 + 1] > -20) h20++;
  const fc = Number.isFinite(expected.frequency) ? expected.frequency * 1e3 : wsum / total;
  const halfBw = (Number.isFinite(expected.bandwidth) ? expected.bandwidth : (bHi - bLo) * df / 1e3) * 500;
  const guard = Math.max(1e3, 2 / (seg.length / sampleRate));
  let leak = -Infinity; const nyq = sampleRate / 2;
  for (let k = lo; k <= hi; k++) { const f = k * df; if (Math.abs(f - fc) > halfBw + guard) leak = Math.max(leak, db[k]); }
  const far = []; for (let k = 1; k < bins; k++) { const f = k * df; if (Math.abs(f - fc) > span && f < Math.min(nyq, 300e3)) far.push(db[k]); }
  return {
    ok: true, sampleRate, samples: samples.length, dcOffsetV: dc,
    burst: { startMs: (i0 / sampleRate) * 1000, durationMs, duration20Ms: widthAt(0.2), duration90EnergyMs: energyMs, samples: seg.length, bursts: runs.length },
    vpp: vmax - vmin, vpeak: Math.max(vmax, -vmin),
    peakKHz: peakHz / 1e3, centroidKHz: wsum / total / 1e3, occupiedBandwidthKHz: (bHi - bLo) * df / 1e3,
    bandwidth20dBKHz: (h20 - l20) * df / 1e3,
    leakageDb: Number.isFinite(leak) ? leak : null,           // highest level outside band +- guard, vs in-band peak
    spectralFloorDb: far.length ? median(far) : null,
    noiseRmsV: noiseRms,
    _spectrum: { db, df, fc, lo, hi }, _envelope: env, _x: x,
  };
}

export function referenceFor(expected, pointGain = 1, rate = 1e6) {
  const config = { mode: expected.mode || 'LFM CHIRP', frequency: expected.frequency, bandwidth: expected.bandwidth,
    pulse: expected.pulse, amplitude: expected.amplitude, window: expected.window || 'HANN' };
  const unit = generateSignal(config, rate); // -1..1 about mid-scale
  const volts = Float64Array.from(unit, (v) => Math.round(v * DAC_HALF) / DAC_FULL * DAC_VREF * pointGain);
  // pad with quiet either side so the burst detector behaves like it does for a scope record
  const pad = Math.round(rate * 0.0005), out = new Float64Array(volts.length + 2 * pad); out.set(volts, pad);
  return { samples: out, sampleRate: rate, config };
}

export function compare(measured, reference, expected, pointGain = 1) {
  const expectedVpp = (expected.amplitude / 100) * DAC_VREF * (DAC_HALF / DAC_FULL) * 2 * pointGain / 1; // pk-pk of +-amp*half-scale
  const e = (name, m, r, unit, tol, nominal) => ({ name, measured: m, computed: r, nominal: nominal ?? null, unit,
    error: Number.isFinite(m) && Number.isFinite(r) ? m - r : null, tolerance: tol,
    pass: Number.isFinite(m) && Number.isFinite(r) ? Math.abs(m - r) <= tol : null });
  const pct = (m, r) => (r ? ((m - r) / r) * 100 : NaN);
  const rows = [
    // An unshaped sweep has a ripple-topped spectrum, so its single largest bin may sit anywhere inside the swept band (tolerance = one sweep width).
    e('FFT peak', measured.peakKHz, reference.peakKHz, 'kHz', Math.max(TOLERANCE.frequencyKHz, (expected.bandwidth || 0)), expected.frequency),
    e('Spectral centroid', measured.centroidKHz, reference.centroidKHz, 'kHz', TOLERANCE.frequencyKHz, expected.frequency),
    e('Occupied bandwidth (99 %)', measured.occupiedBandwidthKHz, reference.occupiedBandwidthKHz, 'kHz', Math.max(0.5, reference.occupiedBandwidthKHz * 0.25), null),
    // Informational: the 10 % crossing is unstable for windows with an edge pedestal (Hamming), so it is shown but not judged.
    { ...e('Pulse duration (10 % envelope, informational)', measured.burst.durationMs, reference.burst.durationMs, 'ms', reference.burst.durationMs * TOLERANCE.durationPct / 100, expected.pulse), pass: null, informational: true },
    // For a phase-coded pulse the envelope threshold is also informational: reversals put dips in the envelope and move the crossing by about 5 %.
    expected.mode === 'PHASE-CODED PULSE'
      ? { ...e('Pulse duration (20 % envelope, informational)', measured.burst.duration20Ms, reference.burst.duration20Ms, 'ms', reference.burst.duration20Ms * TOLERANCE.durationPct / 100, expected.pulse), pass: null, informational: true }
      : e('Pulse duration (20 % envelope)', measured.burst.duration20Ms, reference.burst.duration20Ms, 'ms', Math.max(0.05, reference.burst.duration20Ms * TOLERANCE.durationPct / 100), expected.pulse),
    e('Pulse duration (central 90 % of energy)', measured.burst.duration90EnergyMs, reference.burst.duration90EnergyMs, 'ms', Math.max(0.03, reference.burst.duration90EnergyMs * TOLERANCE.durationPct / 100), null),
    e('Peak-to-peak', measured.vpp, reference.vpp, 'V', reference.vpp * TOLERANCE.vppPct / 100, expectedVpp),
  ];
  if (Number.isFinite(measured.leakageDb) && Number.isFinite(reference.leakageDb)) rows.push(e('Out-of-band leakage', measured.leakageDb, reference.leakageDb, 'dB', TOLERANCE.leakageDb, null));
  return { rows, relativeVppErrorPct: pct(measured.vpp, reference.vpp), allPass: rows.every((r) => r.pass !== false) };
}

// Decimated traces for the UI (max-hold so narrow peaks survive).
export function decimate(arr, from, to, points) {
  const out = []; const step = Math.max(1, Math.floor((to - from) / points));
  for (let i = from; i < to; i += step) { let m = -Infinity; for (let j = i; j < Math.min(to, i + step); j++) m = Math.max(m, arr[j]); out.push(m); }
  return out;
}
export function spectrumTrace(a) {
  const s = a._spectrum, c = s.fc, f0 = Math.max(s.lo * s.df, c - 12e3), f1 = c + 12e3, lo = Math.round(f0 / s.df), hi = Math.round(f1 / s.df);
  return { fromKHz: lo * s.df / 1e3, stepKHz: (hi - lo) / 400 * s.df / 1e3, db: decimate(s.db, lo, hi, 400).map((v) => Math.round(Math.max(-100, v) * 10) / 10) };
}
export function envelopeTrace(a) {
  const pad = Math.round(0.0004 * a.sampleRate), i0 = Math.max(0, Math.round(a.burst.startMs / 1000 * a.sampleRate) - pad);
  const i1 = Math.min(a._envelope.length, Math.round((a.burst.startMs + a.burst.durationMs) / 1000 * a.sampleRate) + pad);
  const peak = Math.max(...a._envelope);
  return { fromMs: i0 / a.sampleRate * 1000, stepMs: (i1 - i0) / 300 / a.sampleRate * 1000, env: decimate(a._envelope, i0, i1, 300).map((v) => Math.round(v / peak * 1000) / 1000) };
}
export const stripInternals = ({ _spectrum, _envelope, _x, ...rest }) => rest;

export function buildRecord({ csv, rate, channel, point = 'PA4', profile = null, window, mode = 'LFM CHIRP', config, gain = 1,
  label = '', instrument = {}, sourceName = '', notes = '' }) {
  if (!POINTS.includes(point)) throw new Error(`point must be one of ${POINTS.join(', ')}`);
  if (!WINDOW_NAMES.includes(window)) throw new Error(`window must be one of ${WINDOW_NAMES.join(', ')}`);
  const base = profile ? PROFILES[profile] : config;
  if (!base || ![base.frequency, base.bandwidth, base.pulse, base.amplitude].every(Number.isFinite)) throw new Error('Unknown profile or incomplete config');
  const expected = { ...base, window, mode };
  const { samples, sampleRate } = parseScopeCsv(csv, { rate, channel });
  const m = analyzeCapture(samples, sampleRate, expected);
  if (!m.ok) throw new Error(m.error);
  const ref = referenceFor(expected, gain);
  const r = analyzeCapture(ref.samples, ref.sampleRate, expected);
  const cmp = compare(m, r, expected, gain);
  const win = spectrumTrace, trace = envelopeTrace, strip = stripInternals;
  const sha256 = createHash('sha256').update(csv).digest('hex');
  return {
    version: 1, provenance: 'MEASURED', point, label, window, mode, profile, expected,
    capturedAt: new Date().toISOString(), source: { name: sourceName, sha256, sampleRate, samples: samples.length },
    instrument: { name: instrument.name || null, probe: instrument.probe || null, coupling: instrument.coupling || null, note: instrument.note || null },
    notes, pointGain: gain,
    measured: strip(m), computed: { provenance: 'COMPUTED', ...strip(r) }, comparison: cmp,
    traces: { measuredSpectrum: win(m), computedSpectrum: win(r), measuredEnvelope: trace(m), computedEnvelope: trace(r) },
  };
}

/* Latest record per point, plus the four-window comparison for a point/profile. */
export function summarize(records) {
  const byPoint = {};
  for (const r of records) if (!byPoint[r.point] || r.capturedAt > byPoint[r.point].capturedAt) byPoint[r.point] = r;
  const windows = {};
  for (const r of records) { const key = `${r.point}|${r.profile || 'CUSTOM'}`; (windows[key] ||= {}); const w = windows[key][r.window]; if (!w || r.capturedAt > w.capturedAt) windows[key][r.window] = r; }
  return { latestByPoint: byPoint, windows };
}
