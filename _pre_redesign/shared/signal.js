export const DEFAULT_CONFIG = {
  mode: "LFM CHIRP",
  frequency: 200,
  bandwidth: 40,
  pulse: 8,
  amplitude: 62,
};
export const SAMPLE_RATE = 1000000;
export function generateSignal(config, sampleRate = SAMPLE_RATE) {
  const safe = (value, fallback, min, max) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  config = {
    ...config,
    pulse: safe(config.pulse, 8, 0.1, 20),
    frequency: safe(config.frequency, 200, 50, 350),
    bandwidth: safe(config.bandwidth, 40, 1, 99),
    amplitude: safe(config.amplitude, 62, 0, 100),
  };
  const n = Math.round((config.pulse / 1000) * sampleRate);
  const samples = new Float64Array(n);
  const duration = n / sampleRate;
  const f0 = (config.frequency - config.bandwidth / 2) * 1000;
  const f1 = (config.frequency + config.bandwidth / 2) * 1000;
  const barker = [1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1];
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let phase;
    if (config.mode === "GEOMETRIC SWEEP") {
      const k = Math.log(f1 / f0) / duration;
      phase = (2 * Math.PI * f0 * Math.expm1(k * t)) / k;
    } else if (config.mode === "PHASE-CODED PULSE") {
      phase =
        2 * Math.PI * config.frequency * 1000 * t +
        (barker[Math.min(12, Math.floor((t / duration) * 13))] < 0
          ? Math.PI
          : 0);
    } else
      phase = 2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * duration));
    const ramp = Math.min(1, i / (n * 0.035), (n - 1 - i) / (n * 0.035));
    samples[i] =
      ((Math.sin(phase) * config.amplitude) / 100) * Math.max(0, ramp);
  }
  return samples;
}
export function spectrum(samples, sampleRate = SAMPLE_RATE, size = 8192) {
  const re = new Float64Array(size),
    im = new Float64Array(size);
  const count = Math.min(samples.length, size);
  let windowSum = 0;
  for (let i = 0; i < count; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, count - 1)));
    re[i] = samples[i] * w;
    windowSum += w;
  }
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= size; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < size; i += len) {
      for (let j = 0; j < len / 2; j++) {
        const c = Math.cos(a * j),
          s = Math.sin(a * j),
          p = i + j,
          q = p + len / 2;
        const tr = re[q] * c - im[q] * s,
          ti = re[q] * s + im[q] * c;
        re[q] = re[p] - tr;
        im[q] = im[p] - ti;
        re[p] += tr;
        im[p] += ti;
      }
    }
  }
  return Array.from({ length: size / 2 }, (_, i) => ({
    frequency: (i * sampleRate) / size,
    db: Math.max(
      -100,
      20 *
        Math.log10(Math.max(1e-10, (2 * Math.hypot(re[i], im[i])) / windowSum)),
    ),
  }));
}
export function estimateSignal(samples, sampleRate = SAMPLE_RATE) {
  const bins = spectrum(samples, sampleRate);
  const peak = bins.reduce((a, b) => (a.db > b.db ? a : b));
  const rms = Math.sqrt(
    samples.reduce((s, x) => s + x * x, 0) / samples.length,
  );
  return {
    peakFrequency: peak.frequency,
    peakDb: peak.db,
    rms,
    peakAmplitude: Math.max(...samples.map(Math.abs)),
  };
}
export function echoProfile(t, config, count = 320) {
  const bottom = 47 + 4 * Math.sin(t / 29) + 1.5 * Math.sin(t / 9);
  const spread = 0.6 + 35 / config.bandwidth;
  return Array.from({ length: count }, (_, i) => {
    const range = (i / (count - 1)) * 80;
    const noise =
      (Math.sin(i * 127.1 + Math.floor(t * 4) * 311.7) * 43758.5453) % 1;
    const surface = 0.3 * Math.exp(-range / 3);
    const primary = 0.8 * Math.exp(-Math.pow((range - bottom) / spread, 2));
    const secondary =
      0.32 *
      Math.exp(-Math.pow((range - (23 + 3 * Math.sin(t / 18))) / 1.1, 2));
    const tail = range > bottom ? 0.16 * Math.exp(-(range - bottom) / 10) : 0;
    return Math.max(
      0,
      Math.min(
        1,
        ((surface + primary + secondary + tail) * config.amplitude) / 70 +
          Math.abs(noise) * 0.1,
      ),
    );
  });
}
export function simulation(t, config, scenario = false) {
  const turbidity = 12.4 + 3 * Math.sin(t / 35) + (scenario ? 24 : 0);
  const voltage = 24.1 - t * 0.000015;
  const current =
    0.42 +
    (config.amplitude / 100) ** 2 * config.pulse * 0.11 +
    config.bandwidth * 0.001;
  return {
    sensors: {
      temperature: 26.4 + 0.2 * Math.sin(t / 50),
      turbidity,
      pressure: 1.28 + 0.006 * Math.sin(t / 40),
      depth: 2.76 + 0.06 * Math.sin(t / 40),
      conductivity: 48.2 + 0.15 * Math.sin(t / 60),
    },
    power: {
      voltage,
      current: current + 0.008 * Math.sin(t * 2),
      watts: voltage * current,
      energy: null,
    },
    echo: echoProfile(t, config),
    rangeMax: 80,
    sampleRate: SAMPLE_RATE,
    health: {
      STM32: "SIMULATED",
      ADC: "SIMULATED",
      DAC: "SIMULATED",
      DMA: "SIMULATED",
      TIMER: "SIMULATED",
      SENSORS: "5/5 DEMO",
      USB: "NO DEVICE",
      TX: "SIMULATED",
      RX: "SIMULATED",
    },
  };
}
