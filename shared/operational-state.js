// Separate the command path from measurement availability. A computed companion
// never turns a telemetry-only board into a command-capable DAC transmitter.
export function signalState(current) {
  return current?.control ? current : current?.digital || null;
}
export function attachCompanion(telemetry, digital) {
  if(!telemetry || telemetry.capabilities?.controlVersion || !digital) return telemetry;
  return {...telemetry,digital};
}
export function signalPaths({mode,hardware={},current}) {
  const signal=signalState(current), preview=signal?.preview;
  const matches=preview?.config && signal?.waveform &&
    ['mode','frequency','bandwidth','pulse','amplitude','window'].every(k=>preview.config[k]===signal.waveform[k]);
  const tx=!!matches && !!preview.tx?.samples?.length && !preview.error;
  const rx=!!matches && !!preview.rx?.samples?.length && !preview.error;
  const live=mode==='hardware' && hardware.connected && hardware.fresh;
  const health=current?.health?.DAC || '';
  const fault=/FAULT|ERROR|UNDERRUN/i.test(health) || /FAULT/.test(current?.control?.reason || '');
  const physical=mode==='playback' ? 'RECORDED' : !live ? 'UNAVAILABLE' : fault ? 'FAULT'
    : current?.control && !current.control.outputEnabled ? 'DISABLED'
    : /\bACTIVE\b/i.test(health) ? 'ACTIVE' : health ? 'IDLE' : 'UNREPORTED';
  return {computedTx:tx?'ACTIVE':preview?.error?'UNAVAILABLE':'AWAITING REFERENCE',
    modeledRx:rx?'ACTIVE':preview?.error?'UNAVAILABLE':'AWAITING REFERENCE',
    physicalDac:physical,physicalDacDetail:live?health:'',
    physicalDacLoopback:live && /LOOPBACK/i.test(health)};
}
export function pulseScheduler(control, computed=false) {
  if(!control) return 'Unavailable';
  if(/FAULT/.test(control.reason || '')) return 'Faulted';
  if(control.outputEnabled && control.state!=='INHIBITED') return computed?'Running reference pulses':'Output enabled';
  if(control.reason==='WEB_LEASE_EXPIRED') return 'Stopped · web lease expired';
  if(control.reason==='OUTPUT_DISABLED') return computed?'Reference pulses stopped':'Output disabled';
  if(!control.qualified) return 'Stopped · valid input required';
  return 'Stopped · input inhibited';
}
export function operationalState({mode, hardware = {}, transmitter = {}, digitalTransmitter = {}, current}) {
  const signal = signalState(current);
  const computed = mode === 'demo' || mode === 'hardware' && !!current && !current.control && !current.capabilities?.controlVersion || !!current?.digital && !current?.control;
  const channel = computed ? digitalTransmitter : transmitter;
  const live = mode === 'hardware' && hardware.connected && hardware.fresh;
  return {
    connection: mode === 'playback' ? 'RECORDED' : live ? 'LIVE MCU' : mode === 'demo' ? 'COMPUTED' : hardware.connected ? 'STALE MCU' : 'DISCONNECTED',
    target: computed ? 'COMPUTED' : 'STM32',
    commandReady: mode !== 'playback' && !!channel.ready && (mode === 'demo' || live),
    pending: !!channel.pending, unknown: !!channel.unknown,
    outputActive: !!signal?.control?.outputEnabled,
    environmentApplied: !!signal?.control?.hasApplied,
    waveformActive: !!signal?.control?.hasApplied && !!signal?.waveform,
    modeledRxActive: !!signal?.preview?.rx,
    adcAvailable: !computed && !!transmitter.ready && live,
    error: channel.error || null,
    paths:signalPaths({mode,hardware,current}),
  };
}
