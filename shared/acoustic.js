import { generateSignal, soundSpeed } from "./signal.js";

export const ACOUSTIC_RANGE_MAX = 3;
export const ECHO_BINS = 320;

const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const median = (values) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
};

// A deterministic, bounded pseudo-noise source. Repeating a frame with the
// same inputs produces the same RX buffer, which keeps recordings testable.
function noiseAt(index, frame) {
  const x = Math.sin((index + 1) * 12.9898 + (frame + 1) * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function sampleRateFor(config) {
  const high = ((config.frequency || 40) + (config.bandwidth || 2) / 2) * 1000;
  return Math.min(1_000_000, Math.max(100_000, Math.ceil((high * 2.5) / 1000) * 1000));
}

export function acousticTargets(elapsed = 0) {
  return [
    { id: "T1", range: 1.2 + 0.014 * Math.sin(elapsed / 4.1), reflection: 0.95, phase: 1 },
    { id: "T2", range: 2.4 + 0.022 * Math.sin(elapsed / 6.7 + 0.8), reflection: 0.95, phase: 1 },
    { id: "T3", range: 2.8 + 0.012 * Math.sin(elapsed / 5.3 + 2.1), reflection: 0.55, phase: -1 },
  ];
}

/**
 * Deterministic acoustic showcase model.
 *
 * The generated RX samples are the authoritative source. The A-scan/echogram
 * envelope and all detection metrics below are derived by correlating this RX
 * buffer with the exact TX reference used to create it.
 */
export function modelAcousticFrame({
  config,
  sensors = {},
  elapsed = 0,
  frame = 0,
  rangeMax = ACOUSTIC_RANGE_MAX,
  txReference,
  referenceRate,
} = {}) {
  const sampleRate = referenceRate || sampleRateFor(config || {});
  const tx = txReference || generateSignal(config || {}, sampleRate);
  const c = soundSpeed(sensors.temperature, sensors.conductivity, sensors.depth) || 1500;
  const maxDelay = Math.ceil((2 * rangeMax * sampleRate) / c);
  const rx = new Float64Array(tx.length + maxDelay + 8);
  const turbidity = Number.isFinite(sensors.turbidity) ? sensors.turbidity : 12;
  const noiseAmplitude = 0.0055 + clamp(turbidity / 300, 0, 0.08);

  for (let i = 0; i < rx.length; i++) {
    // Two deterministic components produce a natural-looking, repeatable floor.
    rx[i] = noiseAmplitude * (0.72 * noiseAt(i, frame) + 0.28 * noiseAt(i * 3 + 17, frame + 11));
  }

  // Low-level direct-path coupling keeps the beginning of the A-scan realistic.
  for (let i = 0; i < tx.length && i < rx.length; i++) rx[i] += tx[i] * 0.055;

  const targets = acousticTargets(elapsed).filter((target) => target.range <= rangeMax);
  for (const target of targets) {
    const delay = Math.round((2 * target.range * sampleRate) / c);
    const spreading = 1 / (1 + 0.2 * target.range * target.range);
    const depth = Number.isFinite(sensors.depth) ? Math.max(0,sensors.depth) : 0;
    const waterLoss = Math.exp(-target.range * (0.045 + turbidity * 0.0007 + depth*.0015));
    const amplitude = target.reflection * (target.phase || 1) * spreading * waterLoss;
    const scatter=clamp(turbidity/100)*.22;
    const scatterDelay=Math.max(2,Math.round(sampleRate*(.00001+scatter*.0003)));
    for (let i = 0; i < tx.length && delay + i < rx.length; i++) {
      rx[delay + i] += tx[i] * amplitude;
      // A short delayed scatter component gives strong returns a small tail.
      if (delay + i + 2 < rx.length) rx[delay + i + 2] += tx[i] * amplitude * 0.08;
      if(delay+i+scatterDelay<rx.length) rx[delay+i+scatterDelay]+=tx[i]*amplitude*scatter;
    }
  }

  let energy = 0;
  for (const value of tx) energy += value * value;
  energy = Math.max(energy, 1e-12);
  const correlation = new Float64Array(maxDelay + 1);
  for (let lag = 0; lag <= maxDelay; lag++) {
    let sum = 0;
    for (let i = 0; i < tx.length && lag + i < rx.length; i++) sum += rx[lag + i] * tx[i];
    correlation[lag] = Math.abs(sum / energy);
  }

  const correlationFloor = median(Array.from(correlation).slice(Math.ceil(maxDelay * 0.08)));
  let correlationPeak = 0;
  for (let i = Math.ceil(maxDelay * 0.08); i < correlation.length; i++) correlationPeak = Math.max(correlationPeak, correlation[i]);
  const scale = Math.max(1e-9, correlationPeak - correlationFloor);
  const echo = Array.from({ length: ECHO_BINS }, (_, bin) => {
    const range = (bin / (ECHO_BINS - 1)) * rangeMax;
    const lag = (2 * range * sampleRate) / c;
    const left = Math.floor(lag);
    const mix = lag - left;
    const value = (correlation[left] || 0) * (1 - mix) + (correlation[left + 1] || 0) * mix;
    return clamp(0.025 + (value - correlationFloor) / scale * 0.94);
  });

  const rangeResolution = config?.mode === "PHASE-CODED PULSE"
    ? (c * ((config.pulse || 2) / 1000 / 13)) / 2
    : c / (2 * Math.max(500, (config?.bandwidth || 2) * 1000));
  const candidates = [];
  for (let lag = Math.ceil((2 * 0.15 * sampleRate) / c); lag < correlation.length - 1; lag++) {
    const value = correlation[lag];
    if (value > correlationFloor + scale * 0.14 && value >= correlation[lag - 1] && value >= correlation[lag + 1]) {
      candidates.push({
        range: (lag * c) / (2 * sampleRate),
        value: clamp((value - correlationFloor) / scale),
        amplitude: value,
      });
    }
  }
  candidates.sort((a, b) => b.amplitude - a.amplitude);
  const detections = [];
  // Keep pulse-compression sidelobes out of the detection list while allowing
  // resolvable neighboring targets through.
  const separation = Math.max(0.12, rangeResolution * 1.5);
  for (const candidate of candidates) {
    if (detections.every((item) => Math.abs(item.range - candidate.range) > separation)) detections.push(candidate);
    if (detections.length === 3) break;
  }
  detections.sort((a, b) => a.range - b.range);

  const strongest = detections.reduce((best, item) => !best || item.amplitude > best.amplitude ? item : best, null);
  const exclusion = Math.max(3, Math.ceil((2 * rangeResolution * sampleRate) / c));
  const strongestLag = strongest ? Math.round((2 * strongest.range * sampleRate) / c) : -1000;
  let sidelobe = correlationFloor;
  for (let i = Math.ceil(maxDelay * 0.08); i < correlation.length; i++) {
    if (Math.abs(i - strongestLag) > exclusion) sidelobe = Math.max(sidelobe, correlation[i]);
  }
  const peakAmplitude = strongest?.amplitude || 0;
  const snr = 20 * Math.log10(Math.max(1e-9, peakAmplitude) / Math.max(1e-9, correlationFloor));
  const sidelobeLevel = 20 * Math.log10(Math.max(1e-9, sidelobe) / Math.max(1e-9, peakAmplitude));

  return {
    samples: Array.from(rx),
    sampleRate,
    echo,
    rangeMax,
    detections,
    acoustic: {
      source: "model",
      status: "ACTIVE",
      txSamples: tx.length,
      rxSamples: rx.length,
      soundSpeed: c,
      peakRange: strongest?.range ?? null,
      peakAmplitude: strongest?.value ?? null,
      noiseFloor: correlationFloor,
      snr: Number.isFinite(snr) ? snr : null,
      sidelobe: Number.isFinite(sidelobeLevel) ? sidelobeLevel : null,
      rangeResolution,
      targets,
    },
  };
}
