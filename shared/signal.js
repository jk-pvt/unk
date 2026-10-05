// Defaults match the bench transducers: 40 kHz piezo discs (harvested HC-SR04),
// whose usable band is roughly ±1 kHz. Bandwidth is in kHz.
export const DEFAULT_CONFIG = {
  mode: "LFM CHIRP",
  frequency: 40,
  bandwidth: 2,
  pulse: 2,
  amplitude: 62,
  window: "HANN",
};
// Digital pulse-shaping windows applied across the whole pulse to smooth its
// edges and suppress spectral / range sidelobes. x runs 0…1 over the pulse.
export const WINDOWS = {
  HANN: { sidelobe: -31.5, fn: (x) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x) },
  HAMMING: { sidelobe: -42.7, fn: (x) => 0.54 - 0.46 * Math.cos(2 * Math.PI * x) },
  BLACKMAN: {
    sidelobe: -58.1,
    fn: (x) => 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x),
  },
  // Unshaped pulse, kept so the sidelobe benefit of windowing can be shown.
  RECT: { sidelobe: -13.3, fn: () => 1 },
};
export const windowFn = (name) => (WINDOWS[name] || WINDOWS.HANN).fn;
// Pack fitted to AQUASDR-01: six 18650 Li-ion cells in 3S2P with a protection
// board. 11.1 V nominal, 5.2 Ah; 12.6 V full, 9.0 V at protection cut-off.
export const PACK = { nominal: 11.1, capacityAh: 5.2, capacityWh: 57.72, full: 12.6, empty: 9.0, label: "3S2P Li-ion · 11.1 V · 5.2 Ah" };
export const SAMPLE_RATE = 1000000;
export function generateSignal(config, sampleRate = SAMPLE_RATE) {
  const safe = (value, fallback, min, max) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  config = {
    ...config,
    pulse: safe(config.pulse, 8, 0.1, 20),
    frequency: safe(config.frequency, 40, 20, 350),
    bandwidth: safe(config.bandwidth, 2, 0.5, 99),
    amplitude: safe(config.amplitude, 62, 0, 100),
  };
  const n = Math.round((config.pulse / 1000) * sampleRate);
  const samples = new Float64Array(n);
  const duration = n / sampleRate;
  const f0 = (config.frequency - config.bandwidth / 2) * 1000;
  const f1 = (config.frequency + config.bandwidth / 2) * 1000;
  const barker = [1, 1, 1, 1, 1, -1, -1, 1, 1, -1, 1, -1, 1];
  const w = windowFn(config.window);
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
    samples[i] =
      ((Math.sin(phase) * config.amplitude) / 100) * w(i / Math.max(1, n - 1));
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
// Deterministic reference model for a small test tank (0–3 m): direct-path TX
// bleed near 0 m, a suspended reflector near 1.1 m and the far wall near 2.35 m.
// Mainlobe width follows c / 2B, so narrowing the sweep visibly blurs returns.
export const DEMO_RANGE = 3;
export function echoProfile(t, config, count = 320, rangeMax = DEMO_RANGE) {
  const bw = Math.max(0.5, config.bandwidth || 2);
  const res = 1500 / (2 * bw * 1000); // m
  const spread = Math.max(0.03, res * 0.6);
  const wall = 2.35 + 0.02 * Math.sin(t / 29);
  const target = 1.1 + 0.07 * Math.sin(t / 7);
  const energy = Math.sqrt(Math.max(0.5, config.pulse || 2) / 2);
  return Array.from({ length: count }, (_, i) => {
    const range = (i / (count - 1)) * rangeMax;
    const noise =
      (Math.sin(i * 127.1 + Math.floor(t * 4) * 311.7) * 43758.5453) % 1;
    const bleed = 0.55 * Math.exp(-range / 0.06);
    const primary = 0.75 * Math.exp(-Math.pow((range - wall) / spread, 2));
    const secondary =
      0.34 * energy * Math.exp(-Math.pow((range - target) / spread, 2));
    const tail = range > wall ? 0.12 * Math.exp(-(range - wall) / 0.25) : 0;
    return Math.max(
      0,
      Math.min(
        1,
        ((bleed + primary + secondary + tail) * config.amplitude) / 70 +
          Math.abs(noise) * 0.08,
      ),
    );
  });
}
// `scenario` is the demo turbidity-rise level: false/true, or a ramp value 0…1.
export function simulation(t, config, scenario = false) {
  const level =
    scenario === true ? 1 : Math.max(0, Math.min(1, Number(scenario) || 0));
  const turbidity = 12.4 + 3 * Math.sin(t / 35) + 24 * level;
  // Pack voltage for a 3S Li-ion pack near 82 % charge (~3.96 V/cell); load = 5 V rail (MCU, DDS, sensors)
  // plus transmit burst energy scaling with amplitude² × duty (10 pings/s).
  const voltage = 11.88 - t * 0.000004;
  const duty = (config.pulse / 1000) * 10;
  const current =
    0.105 +
    (config.amplitude / 100) ** 2 * duty * 0.9 +
    config.bandwidth * 0.0004;
  return {
    sensors: {
      temperature: 26.8 + 0.2 * Math.sin(t / 50),
      turbidity,
      pressure: 1.0546 + 0.0004 * Math.sin(t / 40),
      depth: 0.42 + 0.004 * Math.sin(t / 40),
      conductivity: 0.66 + 0.01 * Math.sin(t / 60),
      distance: null,
    },
    power: {
      voltage,
      current: current + 0.002 * Math.sin(t * 2),
      watts: voltage * current,
      energy: null,
      soc: null,
    },
    echo: echoProfile(t, config),
    rangeMax: DEMO_RANGE,
    sampleRate: SAMPLE_RATE,
    health: {
      STM32: "SIMULATED",
      ADC: "SIMULATED",
      DAC: "SIMULATED",
      DMA: "SIMULATED",
      TIMER: "SIMULATED",
      I2C: "SIMULATED",
      SENSORS: "5/5 DEMO",
      USB: "NO DEVICE",
      TX: "SIMULATED",
      RX: "SIMULATED",
    },
  };
}
// Coppens (1981) sound speed, valid 0–35 °C, 0–45 ppt, 0–4 km. Salinity is
// approximated from conductivity (S ≈ 0.64 × EC in mS/cm) — an estimate only.
export function soundSpeed(temperature, conductivity, depth) {
  if (![temperature].every(Number.isFinite)) return null;
  const S = Number.isFinite(conductivity) ? 0.64 * conductivity : 0;
  const D = (Number.isFinite(depth) ? depth : 0) / 1000;
  const t = temperature / 10;
  const c0 =
    1449.05 + 45.7 * t - 5.21 * t * t + 0.23 * t ** 3 +
    (1.333 - 0.126 * t + 0.009 * t * t) * (S - 35);
  return (
    c0 + (16.23 + 0.253 * t) * D + (0.213 - 0.1 * t) * D * D +
    (0.016 + 0.0002 * (S - 35)) * (S - 35) * t * D
  );
}
