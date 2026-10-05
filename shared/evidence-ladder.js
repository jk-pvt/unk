// The four layers of evidence, kept apart, per waveform class. Pure function over stored records so the UI and the tests agree.
//   CALCULATED          the C engine's reference waveform (always available, deterministic)
//   MCU ADC CAPTURE     the board sampling its own DAC pin (raw DAC tap only here; analog-stage taps are listed separately)
//   MODELED RX          a synthetic return built from the reference and the environment inputs; never a receive measurement
//   EXTERNAL INSTRUMENT an imported oscilloscope / spectrum-analyzer capture; PENDING until one exists
export const CLASSES = [
  { id: "LFM", label: "LFM chirp", mode: "LFM CHIRP" },
  { id: "GEOMETRIC", label: "Geometric sweep", mode: "GEOMETRIC SWEEP" },
  { id: "BARKER", label: "Barker-13 phase-coded", mode: "PHASE-CODED PULSE" },
];
export const WINDOWS = ["RECT", "HANN", "HAMMING", "BLACKMAN"];
const modeOf = (r) => r?.expected?.mode || r?.mode || "LFM CHIRP";
const isRaw = (r) => (r.tap || "RAW_DAC") === "RAW_DAC";

function judged(rec) { const rows = rec.comparison?.rows || []; const j = rows.filter((x) => x.pass !== null && x.pass !== undefined); return { total: j.length, within: j.filter((x) => x.pass).length }; }

export function buildLadder({ mcu = [], external = [], modeledRxAvailable = false } = {}) {
  const pulses = mcu.filter((r) => r.mode === "pulse");
  return CLASSES.map((c) => {
    const mine = pulses.filter((r) => modeOf(r) === c.mode && isRaw(r));
    const latest = new Map(); for (const r of mine.slice().sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)))) latest.set(r.window, r);
    const windows = WINDOWS.filter((w) => latest.has(w)), sums = windows.map((w) => judged(latest.get(w)));
    const rowsTotal = sums.reduce((a, s) => a + s.total, 0), rowsWithin = sums.reduce((a, s) => a + s.within, 0);
    const outside = windows.filter((w) => latest.get(w).comparison?.allPass === false);
    const profiles = [...new Set(mine.map((r) => r.profile).filter(Boolean))];
    const ext = external.filter((r) => modeOf(r) === c.mode);
    return {
      id: c.id, label: c.label,
      calculated: { state: "AVAILABLE", note: "C engine reference, deterministic" },
      mcu: { state: windows.length === 0 ? "NONE" : windows.length === WINDOWS.length && outside.length === 0 ? "COMPLETE" : "PARTIAL", windows, windowsOutside: outside, rowsTotal, rowsWithin, profiles, captures: mine.length,
        latestAt: mine.map((r) => r.capturedAt).sort().pop() || null },
      modeledRx: { state: modeledRxAvailable ? "MODEL ONLY" : "NOT PREPARED", note: "synthetic return from the reference and environment; not a receive measurement" },
      external: { state: ext.length ? "IMPORTED" : "PENDING", captures: ext.length },
    };
  });
}

// Captures of the analog stage (filter / op-amp) taps, counted apart so they never inflate the raw-DAC row.
export const stageCaptureCount = (mcu = []) => mcu.filter((r) => !isRaw(r)).length;
