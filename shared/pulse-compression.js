// Pulse-compression evidence: correlate a captured pulse with the calculated waveform of each class and report how well it matches.
// It answers "did the board play the waveform class that was requested?" with a number that separates LFM, geometric sweep and Barker-13
// even where their spectra look alike (a 4 kHz geometric sweep is within ~50 Hz of a linear one: the spectrum cannot tell them apart, the phase can).
// Works on any sampled voltage record (MCU ADC capture today; an imported scope CSV later). The reference is always CALCULATED.
import { fft, pow2, envelope, referenceFor } from "./bench-capture.js";

export const CLASS_MODES = Object.freeze({ LFM: "LFM CHIRP", GEOMETRIC: "GEOMETRIC SWEEP", BARKER: "PHASE-CODED PULSE" });
export const classOf = (mode) => Object.keys(CLASS_MODES).find((k) => CLASS_MODES[k] === mode) || null;

// Calculated waveform of one class, same settings, without the quiet padding referenceFor() adds.
export function templateFor(expected, cls, rate) {
  const ref = referenceFor({ ...expected, mode: CLASS_MODES[cls] }, 1, rate).samples, pad = Math.round(rate * 0.0005);
  return ref.slice(pad, ref.length - pad);
}

// c[k] = sum_n x[k+n] t[n] for k = 0..N-M (FFT, zero padded so nothing wraps)
function xcorr(x, t) {
  const size = pow2(x.length + t.length), xr = new Float64Array(size), xi = new Float64Array(size), tr = new Float64Array(size), ti = new Float64Array(size);
  xr.set(x); tr.set(t); fft(xr, xi); fft(tr, ti);
  for (let k = 0; k < size; k++) { const a = xr[k], b = xi[k], c = tr[k], d = -ti[k]; xr[k] = a * c - b * d; xi[k] = a * d + b * c; }
  fft(xr, xi, true);
  return xr.slice(0, x.length - t.length + 1);
}
const median = (a) => { const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };

export function compress(samples, rate, template) {
  const tm = template.reduce((a, b) => a + b, 0) / template.length; template = Float64Array.from(template, (v) => v - tm);
  const dc = median(samples), x = Float64Array.from(samples, (v) => v - dc);
  if (x.length < template.length + 8) return { ok: false, error: "capture shorter than the pulse" };
  const c = xcorr(x, template), env = envelope(c);
  let k0 = 0; for (let k = 1; k < env.length; k++) if (env[k] > env[k0]) k0 = k;
  const peak = env[k0];
  let ex = 0, et = 0; for (let n = 0; n < template.length; n++) { ex += x[k0 + n] * x[k0 + n]; et += template[n] * template[n]; }
  const rho = peak / Math.sqrt(Math.max(ex * et, 1e-30));
  let a = k0, b = k0; while (a > 0 && env[a - 1] >= peak / 2) a--; while (b < env.length - 1 && env[b + 1] >= peak / 2) b++;
  const width6Ms = (b - a + 1) / rate * 1000, excl = Math.max(2, Math.round(2 * (b - a + 1)));
  let side = 0; for (let k = 0; k < env.length; k++) if (Math.abs(k - k0) > excl && env[k] > side) side = env[k];
  return { ok: true, rho, startMs: k0 / rate * 1000, width6Ms, pslDb: side > 0 ? 20 * Math.log10(side / peak) : null, _env: env, _k0: k0 };
}

// Scores the capture against all three classes with the same settings; the requested class should win clearly.
// Two classes whose CALCULATED waveforms already correlate at 0.998 or better cannot be told apart by any capture of that waveform (at the
// policy's 4 kHz sweep a geometric sweep is within about 50 Hz of a linear one). They are reported as ambiguous instead of claiming a winner.
export const AMBIGUOUS_RHO = 0.998;
export function classMatch(samples, rate, expected, shape = (t) => t) {
  const want = classOf(expected.mode || CLASS_MODES.LFM), scores = {}, templates = {};
  for (const cls of Object.keys(CLASS_MODES)) { templates[cls] = demean(shape(templateFor(expected, cls, rate))); const r = compress(samples, rate, templates[cls]); scores[cls] = r.ok ? r.rho : null; }
  const ranked = Object.entries(scores).filter(([, v]) => v !== null).sort((p, q) => q[1] - p[1]);
  const best = ranked[0]?.[0] ?? null, margin = ranked.length > 1 ? ranked[0][1] - ranked[1][1] : null;
  const mutual = (a, b) => { const r = compress(Float64Array.from({ length: 6000 }, (_, i) => (i >= 150 && i < 150 + templates[a].length ? templates[a][i - 150] : 0)), rate, templates[b]); return r.ok ? r.rho : null; };
  const ambiguousWith = Object.keys(CLASS_MODES).filter((c) => c !== want && want && (mutual(want, c) ?? 0) >= AMBIGUOUS_RHO);
  const pass = best !== null && (best === want || ambiguousWith.includes(best));
  return { requested: want, best, scores, margin, ambiguousWith, pass };
}

// Rows for the MCU comparison table. The calculated side is the same function applied to the calculated waveform laid into a record of the same length.
export function compressionEvidence(samples, rate, expected, shape = (t) => t) {
  const cls = classOf(expected.mode || CLASS_MODES.LFM), template = demean(shape(templateFor(expected, cls, rate))), m = compress(samples, rate, template);
  if (!m.ok) return { ok: false, rows: [], error: m.error };
  const start = Math.round(m.startMs / 1000 * rate), calc = new Float64Array(samples.length); template.forEach((v, i) => { if (start + i < calc.length) calc[start + i] = v; });
  const c = compress(calc, rate, template), match = classMatch(samples, rate, expected, shape);
  const row = (name, measured, computed, unit, tol, judged = true, nominal = null) => ({ name, measured, computed, nominal, unit, error: Number.isFinite(measured) && Number.isFinite(computed) ? measured - computed : null, tolerance: tol,
    pass: judged && Number.isFinite(measured) && Number.isFinite(computed) ? Math.abs(measured - computed) <= tol : null, ...(judged ? {} : { informational: true }) });
  // The sidelobe level is only judged where the calculated value sits well above the capture's own noise (about -50 dB after compression).
  const pslJudged = Number.isFinite(c.pslDb) && c.pslDb > -40;
  const rows = [
    row("Template match (correlation with the calculated pulse)", Math.min(m.rho, 1), 1, "", 0.05, true, 1),
    row("Compressed-pulse width (-6 dB)", m.width6Ms, c.width6Ms, "ms", Math.max(0.03, c.width6Ms * 0.2)),
    row(pslJudged ? "Peak sidelobe after compression" : "Peak sidelobe after compression (informational, near the capture noise floor)", m.pslDb, c.pslDb, "dB", 6, pslJudged),
  ];
  return { ok: true, rows, classMatch: match, measured: stripCompression(m), calculated: stripCompression(c) };
}
const demean = (t) => { const m = t.reduce((a, b) => a + b, 0) / t.length; return Float64Array.from(t, (v) => v - m); };
export const stripCompression = ({ _env, _k0, ...rest }) => rest;
