// Bench power evidence from an external meter (or INA219 once wired in series).
// Every entry is typed in from a real reading; this module only does arithmetic on them.
// Nothing here is estimated: missing states stay null.
export const POWER_STATES = {
  idle: 'Output disabled, no browser connected',
  web_control: 'Output disabled, browser connected (telemetry stream and keepalive)',
  waveform_active: 'Output enabled, pings at the firmware interval, averaged by the meter',
  pulse_transmit: 'Peak current while a pulse streams (needs a meter or shunt scope that resolves ms)',
};
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export function validatePowerEntry(e) {
  if (!Object.hasOwn(POWER_STATES, e?.state)) throw new Error(`state must be one of ${Object.keys(POWER_STATES).join(', ')}`);
  if (!finite(e.voltageV) || e.voltageV <= 0 || e.voltageV > 30) throw new Error('voltageV must be 0-30');
  if (!finite(e.currentMa) || e.currentMa < 0 || e.currentMa > 5000) throw new Error('currentMa must be 0-5000');
  if (typeof e.instrument !== 'string' || !e.instrument.trim()) throw new Error('instrument (meter model/method) is required');
  if (typeof e.measuredPoint !== 'string' || !e.measuredPoint.trim()) throw new Error('measuredPoint is required, e.g. "USB 5 V into Nucleo, AFE on 5V pin"');
  return { version: 1, provenance: 'MEASURED', state: e.state, voltageV: e.voltageV, currentMa: e.currentMa,
    powerMw: e.voltageV * e.currentMa, instrument: e.instrument.trim().slice(0, 120), measuredPoint: e.measuredPoint.trim().slice(0, 160),
    conditions: String(e.conditions || '').slice(0, 400), afeConnected: e.afeConnected === true,
    pingIntervalMs: finite(e.pingIntervalMs) ? e.pingIntervalMs : null, pulseMs: finite(e.pulseMs) ? e.pulseMs : null,
    capturedAt: new Date().toISOString() };
}

// latest entry per state (and per AFE condition), then derived figures
export function derivePowerEvidence(entries) {
  const latest = {};
  for (const e of entries) { const k = e.state; if (!latest[k] || e.capturedAt > latest[k].capturedAt) latest[k] = e; }
  const p = (s) => (latest[s] ? latest[s].powerMw : null);
  const idle = p('idle'), active = p('waveform_active'), web = p('web_control'), pulse = p('pulse_transmit');
  const ping = latest.waveform_active?.pingIntervalMs ?? null;
  const pulseMs = latest.pulse_transmit?.pulseMs ?? latest.waveform_active?.pulseMs ?? null;
  // Energy per ping above the idle floor: (P_active - P_idle) x ping interval. mW x ms = uJ.
  const pingEnergyUj = finite(active) && finite(idle) && finite(ping) ? Math.max(0, active - idle) * ping : null;
  // Pulse energy above idle: needs the peak reading and the pulse length.
  const pulseEnergyUj = finite(pulse) && finite(idle) && finite(pulseMs) ? Math.max(0, pulse - idle) * pulseMs : null;
  const duty = finite(pulseMs) && finite(ping) && ping > 0 ? pulseMs / ping : null;
  return { latest, idleMw: idle, webControlMw: web, waveformActiveMw: active, pulsePeakMw: pulse,
    pingIntervalMs: ping, pulseMs, dutyCycle: duty, energyPerPingUj: pingEnergyUj, pulseEnergyUj,
    activeOverIdleMw: finite(active) && finite(idle) ? active - idle : null,
    missing: Object.keys(POWER_STATES).filter((s) => !latest[s]) };
}
