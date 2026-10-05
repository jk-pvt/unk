import React, { useEffect, useRef, useState } from "react";
import { ENVIRONMENTS, MODES, WINDOW_NAMES } from "../../shared/environment.js";
import { WaveScope, Spectrogram, AScan } from "../Charts.jsx";
import {pulseScheduler} from '../../shared/operational-state.js';

function Trace({ preview, view }) {
  if (!preview?.tx) return <p className="fine">Waiting for an applied waveform and C reference.</p>;
  const { config, tx } = preview;
  return <div className="environment-trace">{view === "stft"
    ? <Spectrogram config={config} samples={tx.samples} sampleRate={tx.sampleRate} signalLabel="Calculated TX reference" showRidge/>
    : <WaveScope config={config} samples={tx.samples} sampleRate={tx.sampleRate} view={view} running={false}/>}</div>;
}
function inputName(environment) {
  return ENVIRONMENTS.find(p => ['turbidityIndex','depth','temperature'].every(k => Math.abs(p[k] - environment[k]) < .06))?.name || 'Custom';
}
export function EnvironmentEntry({ ctx }) {
  const signal=ctx.signal || ctx.current, c=signal?.control;
  return <section className="environment-entry">
    <span>ENVIRONMENT → ADAPTATION</span>
    <small>{ctx.operation?.target==='COMPUTED' ? 'TX reference controls' : c ? `${signal.environment.source==='WEB_COMMAND'?'Web input':'A0 dial'} controls` : 'Sensor telemetry'}</small>
    <button className="tbtn primary" onClick={() => ctx.setPage("Adaptation")}>Open Environment controls →</button>
  </section>;
}
export function EnvironmentControl({ ctx }) {
  const { state, connected, playback, demo } = ctx;
  const current=ctx.signal || ctx.current;
  const computed=ctx.operation ? ctx.operation.target==='COMPUTED' : demo;
  const c = current?.control, environment = current?.environment;
  const [draft, setDraft] = useState(() => ({...ENVIRONMENTS[0]}));
  const [mode, setMode] = useState(MODES[0]), [window, setWindow] = useState("HANN");
  const [sending, setSending] = useState(false), [ack, setAck] = useState(null), [view, setView] = useState("time");
  const [before, setBefore] = useState(null), last = useRef(null);
  const preview = current?.preview;
  useEffect(() => {
    if (!preview?.tx) return;
    const key = JSON.stringify(preview.config);
    if(last.current && last.current.key !== key) setBefore(last.current.preview);
    last.current = {key, preview};
  }, [preview]);
  useEffect(() => { setBefore(null); last.current=null; setAck(null); }, [state.mode,state.sessionId]);
  useEffect(() => { if(c) { setMode(MODES[c.mode]); setWindow(WINDOW_NAMES[c.window]); } }, [c?.mode,c?.window]);
  const operation=ctx.operation || {commandReady:state.transmitter?.ready,pending:state.transmitter?.pending,unknown:state.transmitter?.unknown,error:state.transmitter?.error};
  const available = connected && !playback && operation.commandReady && !!c;
  const blocked = !available || sending || operation.pending || operation.unknown;
  const web = environment?.source === "WEB_COMMAND";
  async function send(path, body) {
    setSending(true);
    const started = performance.now();
    const result = await ctx.api(path, {...body,target:computed?'COMPUTED':'STM32'});
    setAck(result ? {...result, browserRoundTripMs: Math.round(performance.now() - started), label: body.op || "environment"} : {status:"FAILED",label:body.op || "environment"});
    setSending(false);
  }
  const command = (op, fields={}) => send("transmitter", {op,...fields});
  const edit = (key, value) => setDraft(d => ({...d,id:null,name:"Custom",[key]:value}));
  const applied = c?.hasApplied ? current.waveform : null;
  const requested = current?.requestedWaveform;
  const previous = before?.config;
  const path = !environment ? 'Awaiting a command-capable transmitter' : web
    ? computed ? 'Browser → shared C policy → TX reference' : 'Browser → USB / USART2 → STM32 policy → TIM6 / DMA → DAC PA4'
    : computed ? 'Choose Web input for reference controls' : 'A0 dial → ADC1 → STM32 policy → TIM6 / DMA → DAC PA4';
  const response = !c ? 'UNAVAILABLE' : c.hasApplied && c.decisionId===c.appliedDecisionId ? 'APPLIED'
    : !c.qualified ? 'INPUT REQUIRED' : c.decisionId !== c.appliedDecisionId
    ? c.outputEnabled ? 'PENDING PULSE BOUNDARY' : 'QUALIFIED · START REQUIRED' : 'QUALIFIED';
  const ackProgress = !ack || ack.status !== 'ACCEPTED' ? null : ack.session !== c?.session ? 'Session changed; use fresh firmware state.'
    : ack.label === 'environment' || ack.label === 'waveform' ? (current.applicationAck
      ? current.applicationAck.session === ack.session && current.applicationAck.id === ack.id
      : c?.appliedRequestId === ack.id) ? 'Applied to a pulse.' : 'Accepted; awaiting pulse application.'
    : ack.label === 'start' ? c?.outputEnabled ? computed ? 'Reference pulses started.' : 'Output enabled by firmware.' : 'Awaiting enabled state.'
    : ack.label === 'stop' ? !c?.outputEnabled ? computed ? 'Reference pulses stopped.' : 'Output disabled by firmware.' : 'Awaiting disabled state.' : 'Source selected; input must qualify again.';
  return <div className="environment-control">
    {(!connected || !available || playback) && <p role="status">{playback?'Playback':!connected?'Bridge offline':'Controls unavailable'}</p>}
    {operation.error && <p className="environment-error" role="alert">{operation.error}</p>}
    <div className="environment-grid">
      <section className="panel environment-editor">
        <h3>01 · Environment input</h3>
        <div className="environment-sources" role="group" aria-label="Input source">
          <button className="tbtn" aria-pressed={web} disabled={blocked || web} onClick={() => command("source",{source:"WEB_COMMAND"})}>Web control · {available ? web ? 'Active' : 'Available' : 'Unavailable'}</button>
          <button className="tbtn" aria-pressed={!computed && environment?.source === "ADC_DIAL"} disabled={blocked || computed || environment?.source === "ADC_DIAL"} onClick={() => command("source",{source:"ADC_DIAL"})}>A0 dial · {available && !computed ? environment?.source === 'ADC_DIAL' ? 'Active' : 'Available' : 'Requires adaptive image'}</button>
          <button className="tbtn" disabled>Physical sensors · later</button>
        </div>
        <p className="environment-input-path" aria-label="Active input path">{path}</p>
        <p className="fine">Source changes stop output. A0 maps to index / 0 m / 25 °C.</p>
        <div className="environment-presets" role="group" aria-label="Water presets">{ENVIRONMENTS.map(p => <button key={p.name} className="tbtn" aria-pressed={draft.name === p.name} onClick={() => setDraft({...p})}>{p.name}</button>)}</div>
        <strong>{draft.name} · edited input</strong>
        {[["turbidityIndex","Turbidity index",100,"/ 100"],["depth","Depth input",100,"m"],["temperature","Temperature input",40,"°C"]].map(([key,label,max,unit]) => <label className="environment-slider" key={key}>
          <span>{label}<output>{draft[key].toFixed(1)} {unit}</output></span>
          <input aria-label={label} type="range" min="0" max={max} step="0.1" value={draft[key]} onChange={e => edit(key,Number(e.target.value))}/>
        </label>)}
        <button className="tbtn primary" disabled={blocked || !web} onClick={() => send("environment",draft.id ? {profile:draft.id} : {turbidityIndex:draft.turbidityIndex,depth:draft.depth,temperature:draft.temperature})}>Apply environment</button>
        <p className="fine">Bench inputs · index, metres, °C · temperature affects the acoustic model.</p>
        <div className="environment-modulation">
          <label>Modulation<select aria-label="Modulation" value={mode} onChange={e => setMode(e.target.value)}>{MODES.map(m=><option key={m}>{m}</option>)}</select></label>
          <label>Window<select aria-label="Window" value={window} onChange={e => setWindow(e.target.value)}>{WINDOW_NAMES.map(w=><option key={w}>{w}</option>)}</select></label>
        </div>
        <button className="tbtn" disabled={blocked} onClick={() => command("waveform",{mode,window})}>Apply modulation / window</button>
      </section>
      <section className="panel environment-result">
        <h3>02 · {computed?'C policy → TX reference':'Embedded policy → applied output'}</h3>
        <p>Severity = max(turbidity index, depth in metres). Filtered at 20 ms intervals with hysteresis and 60 ms qualification.</p>
        <dl className="environment-state">
          <div><dt>{computed?'C engine input':'Firmware input'}</dt><dd>{environment ? `${environment.valid ? 'RECEIVED' : 'INVALID / UNQUALIFIED'} · ${inputName(environment)} · ${environment.turbidityIndex} index · ${environment.depth} m · ${environment.temperature} °C` : "Unavailable"}</dd></div>
          <div><dt>Policy response</dt><dd>{c?.profile || "UNQUALIFIED"} · {response}</dd></div>
          <div><dt>Decision</dt><dd>{c ? `${c.decisionId} requested → ${c.appliedDecisionId} applied` : "—"}</dd></div>
          <div><dt>{computed?'Reference pulse scheduler':'Embedded output'}</dt><dd>{pulseScheduler(c,computed)}</dd></div>
          <div><dt>Decision → output</dt><dd>{c?.hasApplied ? `${c.decisionToOutputMs} ms · ${computed?'C engine clock':'firmware clock'}` : "Not yet applied"}</dd></div>
          <div><dt>Command acknowledgement</dt><dd>{ack ? `${ack.label}: ${ack.status}${ack.id != null ? ` · ACK #${ack.id}` : ''}${ack.browserRoundTripMs != null ? ` · ${ack.browserRoundTripMs} ms browser round trip` : ""}` : "No command sent"}{ackProgress && <small className="environment-ack-progress" role="status">{ackProgress}</small>}</dd></div>
        </dl>
        <table className="environment-table"><thead><tr><th>Parameter</th><th>Before</th><th>Requested</th><th>Last applied</th></tr></thead><tbody>
          {[["frequency","Center","kHz"],["bandwidth","Sweep bandwidth","kHz"],["pulse","Duration","ms"],["amplitude","DAC amplitude","% half-scale"]].map(([key,label,unit]) => <tr key={key}><td>{label}</td>{[previous,requested,applied].map((v,i)=><td key={i}>{key === "bandwidth" && v?.mode === "PHASE-CODED PULSE" ? "Coding-dependent" : v ? `${v[key]} ${unit}` : "—"}</td>)}</tr>)}
        </tbody></table>
        <div className="environment-output">
          <button className="tbtn primary" disabled={blocked || !c?.qualified || c?.outputEnabled || !!c?.reason && !["OUTPUT_DISABLED"].includes(c.reason)} onClick={() => command("start")}>{computed?'Start reference':'Start output'}</button>
          <button className="tbtn environment-stop" disabled={blocked} onClick={() => command("stop")}>{computed?'Stop reference':'Stop output'}</button>
          <strong>{pulseScheduler(c,computed)}</strong>
        </div>
        <details className="environment-output-details"><summary>Output diagnostics</summary>
          <p className="fine">{c?.reason || c?.state || 'Unavailable'} · Prototype bench policy · web lease 2 s</p>
        </details>
      </section>
    </div>
    <section className="panel environment-plots">
      <div className="environment-plot-heading"><h3>03 · Calculated TX reference</h3><div role="group" aria-label="Reference view">{[["time","Waveform"],["fft","FFT"],["stft","Spectrogram"]].map(([value,label])=><button className="tbtn" aria-pressed={view === value} key={value} onClick={()=>setView(value)}>{label}</button>)}</div></div>
      <p className="fine">TX reference · shared C waveform generator · applied settings</p>
      {preview?.error && <p role="alert">Reference unavailable: {preview.error}</p>}
      <div className="environment-grid"><div><b>Before</b><Trace preview={before} view={view}/></div><div><b>Last applied reference</b><Trace preview={preview} view={view}/></div></div>
      {preview?.rx && <><h3>Acoustic preview</h3><p className="fine">Synthetic return · 0–3 m target scene · TX reference through propagation and target model</p><div className="environment-trace"><AScan echo={preview.rx.echo} range={3} rangeMax={3} peaks={preview.rx.detections}/></div></>}
    </section>
  </div>;
}
