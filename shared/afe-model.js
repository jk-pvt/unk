// Linear model of the designed analog stage (hardware/analog/design_afe.py): PA4 -> Sallen-Key LPF (TP2) -> x1.5 TLV9062 stage (TP3) -> ADC tap.
// It is a CALCULATION of what the stage should do, used as the expected value when the MCU ADC samples a tap. It is never a measurement,
// and it describes the designed values, not whatever parts were actually soldered.
import { fft, pow2 } from "./bench-capture.js";

export const AFE = Object.freeze({
  R: 4750, C1: 680e-12, C2: 330e-12,          // Sallen-Key (unity gain, equal R)
  C3: 1e-6, R9: 100e3,                        // stage-2 input coupling into the bias network
  R5: 10e3, R6: 20e3, C5: 10e-6,              // stage-2 gain 1 + R5 / (R6 + 1/sC5) = 1.5 in band
  C6: 1e-6, R8: 100e3, R7: 100, R10: 1e3,     // output coupling into the ADC-tap bias network
  gbw: 10e6, a0: 1e5,                         // TLV9062 datasheet unity-gain bandwidth
  cAdc: 8e-12,                                // STM32 ADC sample capacitor + pin (model only)
  vbias: 1.65,                                // R11/R12 from the Nucleo 3V3 pin
});
export const TAPS = Object.freeze({
  RAW_DAC: { id: "RAW_DAC", label: "raw DAC pin PA4", short: "raw DAC", point: "PA4" },
  AFE_FILTER: { id: "AFE_FILTER", label: "filter output (TP2, before the TLV9062 gain stage)", short: "filter output", point: "FILTER_OUT" },
  AFE_OUTPUT: { id: "AFE_OUTPUT", label: "filtered output (filter + TLV9062 gain stage, level-shifted to the ADC)", short: "filtered output", point: "ADC_IN" },
});
export const TAP_IDS = Object.keys(TAPS);

const cx = (re, im) => ({ re, im }), mul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re), add = (a, b) => cx(a.re + b.re, a.im + b.im);
const div = (a, b) => { const d = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const highpass = (w, r, c) => { const x = cx(0, w * r * c); return div(x, add(cx(1, 0), x)); };

export function sallenKey(f, p = AFE) {                       // FILTER_OUT / PA4
  const w = 2 * Math.PI * f;
  return div(cx(1, 0), cx(1 - w * w * p.R * p.R * p.C1 * p.C2, w * p.C2 * 2 * p.R));
}
export function gainStage(f, p = AFE) {                       // OPAMP_OUT / B_IN, one-pole op-amp
  const w = 2 * Math.PI * f, zg = add(cx(p.R6, 0), div(cx(1, 0), cx(0, w * p.C5)));
  const beta = div(zg, add(zg, cx(p.R5, 0)));
  const A = div(cx(p.a0, 0), cx(1, w * p.a0 / (2 * Math.PI * p.gbw)));
  return div(A, add(cx(1, 0), mul(A, beta)));
}
// OPAMP_OUT -> R7 -> C6 -> (R8 to VBIAS in parallel with R10 into the ADC sample capacitor) -> ADC_IN
export function outputNetwork(f, p = AFE) {
  const w = 2 * Math.PI * f, zc = cx(0, -1 / (w * p.cAdc)), zadc = add(cx(p.R10, 0), zc);
  const zp = div(mul(cx(p.R8, 0), zadc), add(cx(p.R8, 0), zadc));
  const series = add(cx(p.R7, 0), div(cx(1, 0), cx(0, w * p.C6)));
  return mul(div(zp, add(series, zp)), div(zc, zadc));
}
export function transfer(tap, f, p = AFE) {
  if (tap === "RAW_DAC") return cx(1, 0);
  const h1 = sallenKey(f, p);
  if (tap === "AFE_FILTER") return h1;
  if (tap === "AFE_OUTPUT") return mul(mul(mul(h1, highpass(2 * Math.PI * f, p.R9, p.C3)), gainStage(f, p)), outputNetwork(f, p));
  throw new Error(`unknown tap ${tap}`);
}
export const gainDb = (tap, f) => { const h = transfer(tap, f); return 20 * Math.log10(Math.hypot(h.re, h.im)); };

// Passes a calculated waveform (volts at the DAC pin, about a mid-scale offset) through the stage. The offset is removed first because the
// designed stage is AC-coupled after the filter; the tap then adds its own DC level: the filter keeps the DAC offset, the level-shifted
// output sits on VBIAS. Zero padding keeps the filter's ringing from wrapping around.
export function applyTap(volts, rate, tap, p = AFE) {
  if (tap === "RAW_DAC") return Float64Array.from(volts);
  const n = volts.length; let dc = 0; for (const v of volts) dc += v; dc /= n;
  const m = pow2(n * 2), re = new Float64Array(m), im = new Float64Array(m);
  for (let i = 0; i < n; i++) re[i] = volts[i] - dc;
  fft(re, im);
  for (let k = 0; k <= m / 2; k++) {
    const h = transfer(tap, Math.max(k * rate / m, 1e-3), p);
    const a = mul(cx(re[k], im[k]), h); re[k] = a.re; im[k] = a.im;
    if (k > 0 && k < m / 2) { re[m - k] = a.re; im[m - k] = -a.im; }   // keep the spectrum conjugate-symmetric (real output)
  }
  fft(re, im, true);
  const offset = tap === "AFE_FILTER" ? dc : p.vbias;
  return Float64Array.from({ length: n }, (_, i) => re[i] + offset);
}

// Where a calculated waveform lands on the ADC pin: used to refuse a capture that could push the pin outside its range.
export const ADC_SAFE_V = Object.freeze({ lo: 0.10, hi: 3.20 });
export function adcPinRange(volts, rate, tap) {
  // referenceFor() gives volts about mid-scale; the DAC pin sits at 1.65 V when idle, so put that offset back before looking at absolute levels
  const y = applyTap(Float64Array.from(volts, (v) => v + 1.65), rate, tap); let lo = Infinity, hi = -Infinity; for (const v of y) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return { min: lo, max: hi, safe: lo >= ADC_SAFE_V.lo && hi <= ADC_SAFE_V.hi };
}
