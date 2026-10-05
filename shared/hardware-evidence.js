// A transmitter bench packet must stay evidence-only: no invented RX frames,
// power consumption, calibrated NTU, or physical measurements.
export function isAdaptiveBench(data) {
  return data?.adaptation?.source === "ADC_DIAL" || data?.capabilities?.controlVersion === 1;
}

export function adaptationEvent(previous, next) {
  if (next?.control) return null;
  const a = next?.adaptation;
  if (!a) return null;
  const before = previous?.adaptation;
  if (before?.state === a.state && before?.appliedDecisionId === a.appliedDecisionId &&
      before?.decisionId === a.decisionId) return null;
  if (a.state === "INHIBITED") return "STM32 adaptive output inhibited · check ADC input and hardware fault counters";
  if (a.state === "PENDING") return `STM32 decision ${a.decisionId} · ${a.profile} · waiting for the next pulse boundary`;
  return `STM32 applied decision ${a.appliedDecisionId} · ${a.profile} · decision-to-output ${a.decisionToOutputMs ?? "unreported"} ms`;
}

export function controlApplicationEvent(previous, next, origin = 'STM32') {
  const c = next?.control;
  if (!c?.hasApplied || previous?.control?.session === c.session && previous.control.appliedDecisionId === c.appliedDecisionId) return null;
  const sameSession = previous?.control?.session === c.session && previous.control.hasApplied;
  const before = sameSession ? previous.waveform : null, after = next.waveform;
  if (!after) return null;
  // control.profile is the current policy candidate; it can advance while the
  // previous pulse is still applied. Name history from applied settings only.
  const profile = w => [[42,4,2,35,'CLEAR'],[40,2,4,50,'TRANSITION'],[38,1,8,62,'MURKY']]
    .find(([fc,bw,pulse,amp]) => w && w.frequency === fc && w.bandwidth === bw && w.pulse === pulse && w.amplitude === amp)?.[4] || 'APPLIED';
  const value = (w, key) => w ? key === 'bandwidth' && w.mode === 'PHASE-CODED PULSE' ? 'coding-dependent' : w[key] : '—';
  const changes = [['frequency','center','kHz'],['bandwidth','bandwidth','kHz'],['pulse','duration','ms'],['amplitude','amplitude','% DAC']]
    .map(([key,label,unit]) => `${label} ${value(before,key)} → ${value(after,key)} ${unit}`).join(' · ');
  return `${origin} applied decision ${c.appliedDecisionId} · request #${c.appliedRequestId} · ${sameSession ? profile(before) + ' → ' : ''}${profile(after)} · ${changes} · decision-to-output ${c.decisionToOutputMs} ms`;
}

// Which program is on the board? Decided from the self-describing identity
// block first; the legacy firmware strings are only a fallback so older
// adaptive images and the Arduino sensor bridge are still recognised.
export function classifyFirmware(payload) {
  if (!payload) return { kind: 'UNKNOWN FIRMWARE', commandable: false };
  if (payload.identity?.id === 'AQUASDR_ADAPTIVE') {
    return { kind: 'AQUASDR_ADAPTIVE', version: payload.identity.version, build: payload.identity.build,
      capabilities: payload.identity.capabilities, commandable: payload.capabilities?.controlVersion === 1 };
  }
  if (payload.firmwareMode === 'ADAPTIVE_TRANSMITTER') return { kind: 'AQUASDR_ADAPTIVE', version: null, build: null, capabilities: [], commandable: payload.capabilities?.controlVersion === 1, legacyIdentity: true };
  if (/Arduino sensor bridge/i.test(payload.firmware || '')) return { kind: 'ARDUINO_SENSOR_BRIDGE', commandable: false };
  return { kind: 'UNKNOWN FIRMWARE', commandable: false };
}
