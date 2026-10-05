import React from 'react';
import {signalPaths} from '../../shared/operational-state.js';

export function SignalPathStatus({ctx}) {
  const hardware=ctx.connected===false ? {...ctx.state?.hardware,fresh:false} : ctx.state?.hardware;
  const paths=ctx.connected!==false && ctx.operation?.paths || signalPaths({mode:ctx.state?.mode,hardware,current:ctx.current});
  return <div className="signal-path-status" role="group" aria-label="Signal path status">
    <span><small>COMPUTED TX</small><b>{paths.computedTx}</b></span>
    <span><small>MODELED RX</small><b>{paths.modeledRx}</b></span>
    <span title={paths.physicalDacDetail || 'Physical DAC state requires fresh firmware telemetry'}>
      <small>PHYSICAL DAC · TELEMETRY</small><b>{paths.physicalDac}{paths.physicalDacLoopback?' · LOOPBACK':''}</b>
    </span>
  </div>;
}
