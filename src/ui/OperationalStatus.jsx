import React from 'react';
import {SignalPathStatus} from './SignalPathStatus.jsx';
export function OperationalStatus({ctx}) {
  const o=ctx.operation || {}, signal=ctx.signal || ctx.current;
  return <section className="panel operational-status" aria-label="Operational state">
    <b>{o.connection || 'AWAITING TELEMETRY'}</b>
    <span>{o.commandReady ? 'COMMAND CHANNEL READY' : 'AWAITING COMMAND ENGINE'} · {o.target || 'STM32'}</span>
    <span>{signal?.control?.profile || 'UNQUALIFIED'} · {signal?.environment?.source || 'NO INPUT'}</span>
    <span>{signal?.waveform ? `${signal.waveform.frequency} kHz · ${signal.waveform.bandwidth} kHz · ${signal.waveform.pulse} ms · ${signal.waveform.amplitude}%` : 'Apply environment, then Start'}</span>
    <small>{ctx.current?.firmware || 'Shared firmware C engine'}</small>
    {ctx.state?.mode==='hardware' && <small>LIVE MCU · TIM6 {ctx.current?.health?.TIMER || '—'} · DMA {ctx.current?.health?.DMA || '—'} · DAC {ctx.current?.health?.DAC || '—'}</small>}
    <SignalPathStatus ctx={ctx}/>
  </section>;
}
