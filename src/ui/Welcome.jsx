import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Cable, Pause, Play, RefreshCw } from 'lucide-react';
import { PayloadViewport } from './PayloadViewport.jsx';

export function Welcome({ connected, hardware, onDemo, onConnect, onExisting }) {
  const dialog = useRef(null);
  const [step, setStep] = useState('choose');
  const [rotating, setRotating] = useState(true);
  const [ports, setPorts] = useState([]), [port, setPort] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    node.querySelector('.welcome-primary')?.focus();
    return () => node.close();
  }, []);
  async function run(action) {
    setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(e.message || 'Connection unsuccessful. Please try again.'); }
    finally { setBusy(false); }
  }
  async function scan() {
    const response = await fetch('/api/ports', {signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('The local bridge is unavailable. Start AquaSDR on this computer and try again.');
    const list = await response.json();
    if (!Array.isArray(list)) throw new Error('The local bridge did not return a port list.');
    setPorts(list); setPort(previous => list.some(p => p.path === previous) ? previous : '');
  }
  function chooseHardware() {
    setStep('connect'); setError('');
    if (local && !hardware?.connected) run(scan);
  }
  return <dialog ref={dialog} className="welcome" aria-labelledby="welcome-title" aria-describedby="welcome-description" onCancel={e => e.preventDefault()}>
    <div className="welcome-top"><span>AQUASDR <i/> MISSION CONTROL</span><span className="welcome-status">{connected ? 'Console available' : 'Connecting to console…'}</span></div>
    <div className="welcome-model">
      <PayloadViewport explode={0} housing internal={false} autoRotate={rotating} selected={null} resetKey={0} presentation />
      <span className="welcome-model-label">SOFTWARE-DEFINED SONAR PAYLOAD</span>
      <button className="ibtn welcome-rotate" aria-label={rotating ? 'Pause payload rotation' : 'Resume payload rotation'} aria-pressed={!rotating} onClick={() => setRotating(v => !v)}>{rotating ? <Pause size={14}/> : <Play size={14}/>}</button>
    </div>
    <div className="welcome-body">
      {step === 'choose' ? <>
        <span className="welcome-eyebrow">READY WHEN YOU ARE</span>
        <h1 id="welcome-title">Connect your AquaSDR payload.</h1>
        <p id="welcome-description">Bring your underwater instruments online, or explore the console in demo mode.</p>
        <button autoFocus className="welcome-primary" disabled={busy} onClick={chooseHardware}><Cable size={17}/> Connect AquaSDR payload <ArrowRight size={16}/></button>
      </> : <>
        <button className="welcome-back" disabled={busy} onClick={() => {setStep('choose');setError('');}}><ArrowLeft size={13}/> Back</button>
        <h1 id="welcome-title">{local ? 'Connect over USB.' : 'Use your local console.'}</h1>
        <p id="welcome-description">{local ? 'Plug the payload into this computer, then select its serial port.' : 'This hosted console cannot access your USB payload yet. Start the AquaSDR bridge on your computer and connect through its local console.'}</p>
        {local ? hardware?.connected ? <>
          <div className="welcome-link-state" role="status">{hardware.fresh ? 'Payload telemetry received' : 'Serial port open · waiting for telemetry'}</div>
          <button className="welcome-primary" disabled={busy} onClick={onExisting}>Open payload console <ArrowRight size={16}/></button>
        </> : <>
          <div className="welcome-port">
            <label htmlFor="welcome-port">Payload serial port</label>
            <div><select id="welcome-port" value={port} disabled={busy} onChange={e => setPort(e.target.value)}><option value="">{busy ? 'Looking for ports…' : ports.length ? 'Select a port' : 'No ports found'}</option>{ports.map(p => <option key={p.path} value={p.path}>{p.path}{p.manufacturer ? ` · ${p.manufacturer}` : ''}</option>)}</select><button className="ibtn" aria-label="Refresh serial ports" disabled={busy} onClick={() => run(scan)}><RefreshCw size={16}/></button></div>
          </div>
          <button className="welcome-primary" disabled={busy || !port || !connected} onClick={() => run(() => onConnect(port))}><Cable size={17}/>{busy ? 'Connecting…' : 'Connect selected payload'}<ArrowRight size={16}/></button>
        </> : <a className="welcome-primary" href="http://127.0.0.1:4318/" target="_blank" rel="noopener noreferrer">Open local AquaSDR console <ArrowRight size={16}/></a>}
      </>}
      <button className="welcome-demo" disabled={busy || !connected} onClick={() => run(onDemo)}>{busy ? 'Please wait…' : 'Continue with demo mode'} <ArrowRight size={14}/></button>
      {error && <p className="welcome-error" role="alert">{error}</p>}
      {!connected && <p className="welcome-notice" role="status">The console service is unavailable. Demo mode needs the AquaSDR backend; retry when it is online.</p>}
      <p className="welcome-footnote">Demo data is simulated. Output starts only from the Environment controls.</p>
    </div>
  </dialog>;
}
