import React from "react";
import { EnvironmentControl, EnvironmentEntry } from "./EnvironmentControl.jsx";
import {sensorDisplay} from '../../shared/sensor-display.js';
import { ArrowUpRight, Cable, Download, Map, Plus, RotateCcw } from "lucide-react";
import { SpectrumCompare, TimeSeries, WaveScope, Spectrogram } from "../Charts.jsx";
import {referenceSelection,referenceMatches,displayReference} from '../../shared/reference-selection.js';
import { estimateSignal, WINDOWS } from "../../shared/signal.js";
import { Dot, Empty, Label, Num, Src, clock, fmt, healthTone, stamp } from "../ui/kit.jsx";
import { BenchEvidence } from "./BenchEvidence.jsx";
import { McuCapture } from "./McuCapture.jsx";
import {
  EnvPanel,
  HEALTH,
  KIND_LABEL,
  AdaptationPipeline,
  PowerPanel,
  PulseFacts,
  SENSORS,
  SonarHero,
  TURBIDITY_LIMIT,
  WaveformPanel,
  WaveformEngine,
  connectionState,
  connectionTone,
  powerDerived,
  simSource,
  srcKind,
} from "./blocks.jsx";
import { PAYLOAD_PARTS, PayloadScene } from "../ui/PayloadScene.jsx";
import { PayloadTelemetry } from "../ui/PayloadTelemetry.jsx";
import { PayloadViewport } from "../ui/PayloadViewport.jsx";

function PageControls({ page, count, size, onChange, label }) {
  const pages = Math.max(1, Math.ceil(count / size));
  if (pages === 1) return null;
  return <nav className="page-controls" aria-label={label}>
    <span>{page * size + 1}–{Math.min((page + 1) * size, count)} of {count}</span>
    <button className="tbtn" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous</button>
    <button className="tbtn" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>;
}

export function Mission({ ctx }) {
  const [selected,setSelected]=React.useState(null);
  return (
    <div className="mission mission-payload mission-minimal">
      <PayloadScene ctx={ctx} selected={selected} onSelect={setSelected} />
      <div className={"st-sonar"+(selected==='transducer'?' payload-sonar-selected':'')}>
        <SonarHero ctx={ctx} bare clear={0} />
      </div>
      <aside className="mission-sidebar" aria-label="Mission monitoring">
        <EnvironmentEntry ctx={ctx}/>
        {selected?<PayloadTelemetry ctx={ctx} selected={selected} onClear={()=>setSelected(null)}/>:<EnvPanel ctx={ctx} floating={false} compact />}
      </aside>
      <div className="mission-power"><PowerPanel ctx={ctx} /></div>
    </div>
  );
}

/* ============================ SONAR ============================ */
function SonarPathStatus({ ctx }) {
  const preview = ctx.preview || displayReference(ctx.signal || ctx.current,ctx.state.referencePreview,ctx.cfg), available = !!preview?.rx;
  const acoustic = preview?.rx?.acoustic;
  const groups = [
    ["TX REFERENCE", [["C waveform", available ? `${preview.config.frequency} kHz` : "UNAVAILABLE"],
      ["Reference", available ? `${preview.tx.samples.length} samples` : "WAITING"],
      ["Model sound speed", available ? `${fmt(acoustic.soundSpeed, 0)} m/s` : "WAITING"]]],
    ["ACOUSTIC PREVIEW + DSP", [["RX buffer", available ? `${preview.rx.samples.length} samples` : "WAITING"],
      ["Matched filter", available ? "READY" : "WAITING"],
      ["Detections", available ? `${preview.rx.detections.length} targets` : "WAITING"]]],
  ];
  return <section className="sonar-paths" aria-label="Calculated sonar preview">
    {groups.map(([title,rows]) => <div className="sonar-path" key={title}>
      <header><span>{title}</span></header>
      <ol>{rows.map(([name,value])=><li key={name}><span>{name}</span><small><Dot tone={available ? "ok" : "muted"}/>{value}</small></li>)}</ol>
    </div>)}
  </section>;
}

export function Sonar({ ctx }) {
  return (
    <div className="ws ws-sonar">
      <div className="ws-hero">
        <SonarHero ctx={ctx} expanded bare />
      </div>
      <SonarPathStatus ctx={ctx} />
      <div className="ws-row">
        <WaveformPanel ctx={ctx} className="grow" />
        <WaveformEngine ctx={ctx} />
        <PulseFacts ctx={ctx} />
      </div>
    </div>
  );
}

/* ============================ ADAPTATION ============================ */
export function Adaptation({ ctx }) {
  const { state } = ctx;
  const [historyPage, setHistoryPage] = React.useState(0);
  const evs = state.events.filter((e) => ["adaptation", "scenario", "waveform"].includes(e.kind));
  const page = Math.min(historyPage, Math.max(0, Math.ceil(evs.length / 2) - 1));
  return (
    <div className="ws ws-adapt">
      <EnvironmentControl ctx={ctx} />
      <section className="stream">
        <Label right={<PageControls page={page} count={evs.length} size={2} onChange={setHistoryPage} label="Decision history pages"/>}>DECISION HISTORY</Label>
        <ol>
          {evs.slice(page * 2, page * 2 + 2).map((e) => (
            <li key={e.id} className={"k-" + e.kind}>
              <time className="mono">{stamp(e.timestamp)}</time>
              <span className="kd mono">{KIND_LABEL[e.kind] || "SYS"}</span>
              <span className="msg">{e.message.replace(/Computed C engine/g,"Reference engine").replace(/COMPUTED/g,"REFERENCE")}</span>
            </li>
          ))}
          {!evs.length && <li className="fine">No adaptation decisions this session.</li>}
        </ol>
      </section>
    </div>
  );
}

/* ============================ VALIDATION ============================ */
export function Validation({ ctx }) {
  const {cfg,current}=ctx,signal=ctx.signal || current;
  const inspection=ctx.state?.referencePreview;
  const selection=referenceSelection(signal,cfg);
  const applied=signal?.preview?.tx ? signal.preview : null;
  const preview=applied || (referenceMatches(inspection,selection)?inspection:null),checks=preview?.digitalChecks;
  const configured=preview?.config || signal?.waveform || selection;
  const measured=current?.validation || {};
  const rxSamples=current?.samples || null;
  const acoustic=rxSamples ? current?.acoustic : preview?.rx?.acoustic;
  const code=configured.mode==='PHASE-CODED PULSE';
  const rows=[
    ['Center frequency',configured.frequency,checks?.centerKHz,'kHz',2],
    ['Sweep / occupied bandwidth',code?null:configured.bandwidth,checks?.occupiedBandwidthKHz,'kHz',2],
    ['Pulse duration',configured.pulse,checks?.durationMs,'ms',2],
    ['Amplitude',configured.amplitude,checks?.peakAmplitudePercent,'% FS',2],
    ['FFT peak',configured.frequency,checks?.peakKHz,'kHz',2],
  ].filter(([,target,value])=>Number.isFinite(value));
  const instruments=[['Center frequency',measured.frequency,'kHz'],['Bandwidth',measured.bandwidth,'kHz'],
    ['Pulse duration',measured.pulse,'ms'],['Amplitude',measured.amplitude,'% FS'],
    ['FFT peak',measured.peakFrequency,'kHz'],['Noise floor',measured.noiseFloor,'dBFS'],
    ['Sidelobe level',measured.sidelobe,'dB'],['THD',measured.thd,'%']].filter(([,value])=>Number.isFinite(value));
  return <div className="ws ws-val">
    <section className="panel vtable" aria-label="Digital waveform check">
      <Label>WAVEFORM REFERENCE ANALYSIS</Label>
      <p className="fine">Results from the TX reference sample buffer. Instrument captures are separate.{!applied && preview?' Selected configuration · no output start required.':''}</p>
      {checks && rows.length ? <>
        <table className="vt"><thead><tr><th>Parameter</th><th>Configured</th><th>Result</th><th>Difference</th></tr></thead><tbody>
          {rows.map(([name,target,value,unit,digits])=><tr key={name}><td>{name}</td>
            <td className="mono">{Number.isFinite(target)?`${fmt(target,digits)} ${unit}`:'Coding-dependent'}</td>
            <td className="mono">{fmt(value,digits)} {unit}</td>
            <td className="mono">{Number.isFinite(target)?`${value-target>=0?'+':''}${fmt(value-target,digits)} ${unit}`:'Chip spectrum'}</td>
          </tr>)}
        </tbody></table>
        <dl className="reference-metrics">
          <div><dt>DAC code range</dt><dd>{checks.dacCodeMin}–{checks.dacCodeMax}</dd></div>
          <div><dt>Sample rate</dt><dd>{fmt(checks.sampleRate,0)} Hz</dd></div>
          <div><dt>Sample count</dt><dd>{checks.samples}</dd></div>
          <div><dt>RMS amplitude</dt><dd>{fmt(checks.rms,4)} FS</dd></div>
          <div><dt>Window</dt><dd>{checks.window}</dd></div>
          <div><dt>Window nominal sidelobe</dt><dd>{WINDOWS[checks.window || 'HANN'].sidelobe} dB</dd></div>
        </dl>
        <p className="fine">Occupied bandwidth contains 99% of spectral power; its difference from sweep width is expected. Phase-coded pulses use the chip spectrum.</p>
      </> : <p className="fine">{inspection?.error || 'Preparing the selected waveform with the C engine.'}</p>}
    </section>
    {preview?.tx && <section className="panel chart-card">
      <Label>TX REFERENCE · TIME DOMAIN</Label>
      <div className="chart-h"><WaveScope config={configured} samples={preview.tx.samples} sampleRate={preview.tx.sampleRate} running={false}/></div>
    </section>}
    {preview?.tx && <section className="panel chart-card">
      <Label>TX REFERENCE / {rxSamples?'RECEIVE CAPTURE':'ACOUSTIC PREVIEW'} SPECTRUM</Label>
      <div className="chart-h tall"><SpectrumCompare targetSamples={preview.tx.samples} targetRate={preview.tx.sampleRate}
        config={configured} measured={rxSamples || preview.rx?.samples} measuredRate={rxSamples?current.sampleRate:preview.rx?.sampleRate} resultLabel={rxSamples?'receive capture':'acoustic preview'}/></div>
    </section>}
    {preview?.tx && <section className="panel chart-card">
      <Label>TX REFERENCE · SPECTROGRAM</Label>
      <div className="chart-h"><Spectrogram config={configured} samples={preview.tx.samples} sampleRate={preview.tx.sampleRate} signalLabel="TX reference" showRidge/></div>
    </section>}
    {acoustic && <section className="panel digital">
      <Label>{rxSamples?'RECEIVE CAPTURE':'ACOUSTIC PREVIEW'} · MATCHED FILTER</Label>
      {!rxSamples && <p className="fine">Synthetic return from the TX reference and environment inputs.</p>}
      <dl>{[['Peak range',acoustic.peakRange,3,'m'],['Peak amplitude',acoustic.peakAmplitude,3,'FS'],
        ['Correlation floor',acoustic.noiseFloor,4,'corr'],['SNR',acoustic.snr,2,'dB'],['Sidelobe level',acoustic.sidelobe,2,'dB']]
        .filter(([,value])=>Number.isFinite(value)).map(([name,value,digits,unit])=><div key={name}><dt>{name}</dt><dd className="mono">{fmt(value,digits)} <u>{unit}</u></dd></div>)}</dl>
    </section>}
    <details className="panel instrument-results"><summary>Instrument measurements{instruments.length?` · ${instruments.length} results`:''}</summary>
      {instruments.length ? <table className="vt"><thead><tr><th>Parameter</th><th>Instrument result</th></tr></thead><tbody>
        {instruments.map(([name,value,unit])=><tr key={name}><td>{name}</td><td className="mono">{fmt(value,2)} {unit}</td></tr>)}
      </tbody></table> : <p className="fine">Connect an instrument or supply a recorded capture to populate this section.</p>}
    </details>
    <McuCapture ctx={ctx}/>
    <BenchEvidence checks={checks} configured={configured}/>
  </div>;
}

/* ============================ SENSORS ============================ */
export function Sensors({ ctx }) {
  const { sensors, history, demo } = ctx;
  return (
    <div className="ws ws-sensors">
      <section className="panel diag"><Label right={<Src kind="computed">{(ctx.signal || ctx.current)?.environment?.source || 'NO INPUT'}</Src>}>ENVIRONMENT CONTROL INPUT</Label><p>{(ctx.signal || ctx.current)?.environment ? `${(ctx.signal || ctx.current).environment.turbidityIndex} index · ${(ctx.signal || ctx.current).environment.depth} m · ${(ctx.signal || ctx.current).environment.temperature} °C` : 'Choose Web input in Adaptation'}</p></section>
      <section className="panel acq">
        <Label>CHANNEL HISTORY · LAST 60 s</Label>
        {SENSORS.map(([key, name, unit, d, hw, role]) => {
          const channel=sensorDisplay(ctx,key,name,unit,d);
          if(!Number.isFinite(channel.value)) return null;
          const vals = channel.values.filter(Number.isFinite);
          const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
          return (
            <div className="acq-row" key={key}>
              <div className="acq-id">
                <span className="en">{channel.name}</span>
                <span className="fine mono">{channel.source==='Sensor'?hw:channel.source}{ctx.playback ? " · RECORDED" : ""}</span>
                <b className="mono">
                  <><Num value={channel.value} digits={channel.digits} /><u>{channel.unit}</u></>
                </b>
                <span className="stats mono">
                  {vals.length ? `min ${fmt(Math.min(...vals),channel.digits)} · mean ${fmt(mean,channel.digits)} · max ${fmt(Math.max(...vals),channel.digits)}` : 'History begins with the next acquired sample'}
                </span>
              </div>
              <div className="acq-plot">
                <TimeSeries values={channel.values} unit={channel.unit} digits={channel.digits} limit={key === "turbidity" && channel.unit==='NTU' ? TURBIDITY_LIMIT : undefined} area color="#b7d3cb" />
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/* ============================ POWER ============================ */
function powerTrend(history, key, estimated, scenario) {
  return history.map((entry, index) => {
    return (scenario?entry.batteryScenario:estimated?entry.powerEstimate:entry.power)?.[key];
  });
}

export function Power({ ctx }) {
  const { history, cfg, power, openWaveform } = ctx;
  const { status } = powerDerived(power);
  const addLoadTexture = ctx.powerModeled;
  const watts = React.useMemo(() => powerTrend(history, "watts", addLoadTexture,ctx.powerScenario), [history, addLoadTexture,ctx.powerScenario]);
  const current = React.useMemo(() => powerTrend(history, "current", addLoadTexture,ctx.powerScenario), [history, addLoadTexture,ctx.powerScenario]);
  return (
    <div className="ws ws-power">
      <PowerPanel ctx={ctx} large />
      <div className="ws-col">
        <section className="panel chart-card">
          <Label>SYSTEM POWER · W</Label>
          <div className="chart-h">
            <TimeSeries values={watts} unit="W" digits={2} />
          </div>
        </section>
        <section className="panel chart-card">
          <Label>PACK CURRENT · A</Label>
          <div className="chart-h">
            <TimeSeries values={current} unit="A" digits={3} />
          </div>
        </section>
        <section className="panel note-card">
          <Label>WAVEFORM → POWER</Label>
          <p>
            <b className="mono">
              {cfg.amplitude}% · {cfg.pulse} ms
            </b>{" "}
            {ctx.powerModeled
              ? `Planned load estimate · ${power.assumptions || 'Not recorded'}`
              : "Values come from the INA219 on the pack side. Conversion efficiency needs calibrated input and output measurements."}
          </p>
          <div className="note-foot">
            {Number.isFinite(power.efficiency) && <span>
              System efficiency <b className="mono">{fmt(power.efficiency,1)} %</b>
            </span>}
            <span>
              Status <b className="mono">{status}</b>
            </span>
            {Number.isFinite(ctx.current?.engine?.cpuLoad) && <span title="Timer-paced DMA streams the pulse to the DAC; this is the firmware's own measurement of CPU time spent on generation.">
              Generation CPU{" "}
              <b className="mono">{Number.isFinite(ctx.current?.engine?.cpuLoad) ? `${fmt(ctx.current.engine.cpuLoad, 1)} %` : "—"}</b>{" "}
              {!Number.isFinite(ctx.current?.engine?.cpuLoad) && <Src kind="unavailable">NOT REPORTED</Src>}
            </span>}
            <button className="tbtn" onClick={openWaveform}>
              Configure waveform
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ============================ MAPPING ============================ */
export { Mapping } from './Mapping.jsx';

/* ============================ HARDWARE ============================ */
function SystemDiagram({ ctx }) {
  const h = ctx.current?.health || {};
  const t = (k) => (k === "BRIDGE" ? (ctx.connected ? "ok" : "red") : healthTone(h[k], ctx.demo));
  const B = ({ x, y, w = 150, hgt = 46, title, sub, k, tag, g, alt }) => (
    <g className={"sd-b" + (alt ? " sd-alt" : "")} transform={`translate(${x},${y})`}>
      <rect width={w} height={hgt} rx="4" />
      <text x="12" y="19" className="sd-t">{title}</text>
      <text x="12" y="34" className="sd-s">{sub}</text>
      {tag && <text x="12" y="50" className={"sd-g g-" + g}>{tag}</text>}
      {k && <circle cx={w - 12} cy="12" r="3.5" className={"sd-d d-" + t(k)} />}
    </g>
  );
  const A = ({ d }) => <path className="sd-l" d={d} markerEnd="url(#sdArrow)" />;
  const P = ({ d }) => <path className="sd-plan" d={d} markerEnd="url(#sdArrowPlan)" />;
  return (
    <svg className="sysdiag" viewBox="0 0 1040 350" role="img" aria-label="AquaSDR build state: the STM32 timer, DMA, DAC and electrical loopback are verified; power, transmit and receive analog stages are explicitly shown as future work">
      <defs>
        <marker id="sdArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="#5c6a6d" />
        </marker>
        <marker id="sdArrowPlan" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="#9c7b41" />
        </marker>
      </defs>
      <text className="sd-h" x="0" y="12">POWER</text>
      <text className="sd-h" x="650" y="12">SOLID = VERIFIED NOW · DASHED AMBER = TO BUILD</text>
      <B x={0} y={22} w={150} hgt={58} title="USB / ST-LINK" sub="current bench power" k="USB" tag="ACTIVE NOW" g="primary" />
      <A d="M150 51 H170 V88" />
      <B x={192} y={22} w={190} hgt={58} title="3S2P + fuse + switch" sub="final power · disconnected" tag="TO ASSEMBLE" g="pending" />
      <P d="M382 51 H408" />
      <B x={410} y={22} w={165} hgt={58} title="MP1584" sub="set 5.00 V before use" tag="FINAL RAIL PLAN" g="pending" />
      <P d="M575 51 H600 V88" />
      <text className="sd-h" x="0" y="88">TRANSMIT · NUCLEO-F446RE DIGITAL ENGINE</text>
      <B x={0} y={98} w={140} hgt={58} title="AD9850 DDS" sub="excluded from build" tag="NOT USED" g="alt" alt />
      <rect className="sd-mcu" x="150" y="90" width="450" height="74" rx="6" />
      <B x={160} y={98} w={130} hgt={58} title="TIM6" sub="1.000 MHz trigger" k="TIMER" tag="BENCH VERIFIED" g="primary" />
      <A d="M290 127 H304" />
      <B x={306} y={98} w={130} hgt={58} title="DMA1 Stream 5" sub="25 samples · circular" k="DMA" tag="BENCH VERIFIED" g="primary" />
      <A d="M436 127 H450" />
      <B x={452} y={98} w={140} hgt={58} title="DAC1 · 12-bit" sub="PA4 / A2 · 40 kHz" k="DAC" tag="BENCH VERIFIED" g="primary" />
      <P d="M592 127 H616" />
      <B x={618} y={98} w={126} hgt={58} title="TLV9062 TX" sub="filter · buffer" tag="TO BUILD" g="pending" />
      <P d="M744 127 H780" />
      <B x={782} y={98} w={118} hgt={58} title="Piezo driver" sub="power stage · TBD" k="TX" tag="DESIGN REQUIRED" g="pending" />
      <P d="M900 127 H936" />
      <B x={938} y={98} w={102} hgt={58} title="TX piezo" sub="40 kHz · dry bench" k="TX" tag="TO COMMISSION" g="off" />
      <path className="sd-w" d="M989 156 C 989 177, 989 177, 989 198" />
      <text className="sd-s" x="996" y="178">medium</text>
      <text className="sd-h" x="0" y="194">RECEIVE</text>
      <B x={938} y={202} w={102} hgt={58} title="RX piezo" sub="40 kHz · dry bench" k="RX" tag="TO COMMISSION" g="off" />
      <P d="M938 231 H916" />
      <B x={760} y={202} w={154} hgt={58} title="Protection + TLV9062" sub="bias · band-pass · gain" k="RX" tag="TO BUILD" g="pending" />
      <P d="M760 231 H548 V166" />
      <text className="sd-s" x="565" y="222">FINAL RX → ADC PC0/A5</text>
      <B x={0} y={202} w={180} hgt={58} title="Environment sensors" sub="temp/TDS live · analog partial" k="SENSORS" tag="PARTIAL / SEE HEALTH" g="pending" />
      <A d="M180 231 H370 V166" />
      <text className="sd-s" x="202" y="222">ADC · 1-Wire · I²C</text>
      <text className="sd-h" x="0" y="278">DATA & VERIFIED ELECTRICAL TEST</text>
      <B x={0} y={286} w={145} title="ST7735 TFT" sub="SPI local status UI" k="TFT" />
      <B x={170} y={286} w={120} title="USB serial" sub="115200 · JSON lines" k="USB" />
      <path className="sd-l" d="M230 286 V166" />
      <A d="M290 309 H320" />
      <B x={322} y={286} w={145} title="Local bridge" sub="127.0.0.1:4318" k="BRIDGE" />
      <A d="M467 309 H497" />
      <B x={499} y={286} w={130} title="Web console" sub="WebSocket /ws" />
      <B x={680} y={286} w={210} hgt={58} title="A2 → A5 jumper" sub={h.LOOPBACK || "DAC-to-ADC electrical test"} k="LOOPBACK" tag="TEMPORARY · REMOVE FOR RX" g="primary" />
    </svg>
  );
}
function TxPathStatus({ ctx }) {
  const h = ctx.current?.health || {};
  const engineVerified = /ACTIVE/i.test(h.TIMER || "") && /ACTIVE/i.test(h.DMA || "") && /ACTIVE/i.test(h.DAC || "");
  const loopVerified = /ONLINE/i.test(h.LOOPBACK || "");
  const rows = [
    ["Digital waveform engine", "TIM6 → DMA1 Stream 5 → DAC1 PA4", engineVerified ? "LIVE TELEMETRY" : "CHECK TELEMETRY", engineVerified ? "primary" : "off"],
    ["DAC electrical loopback", "PA4/A2 output → temporary jumper → PC0/A5 ADC", h.LOOPBACK || "NO SIGNAL", loopVerified ? "primary" : "off"],
    ["TX analog conditioning", "reconstruction filter and buffer", "AWAITING CHARACTERIZATION", "pending"],
    ["Piezo power driver", "40 kHz voltage/current stage", "AWAITING CHARACTERIZATION", "pending"],
    ["Acoustic pair", "physical TX and RX transducers", "ABSENT", "off"],
    ["RX analog chain", "protection + bias + band-pass/gain → ADC", "AWAITING CHARACTERIZATION", "pending"],
  ];
  return (
    <dl className="txpath">
      {rows.map(([name, detail, status, g]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd className="fine">{detail}</dd>
          <dd>
            <span className={"bstat tx-" + g}>{status}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
const STATUS_LABEL = { demo: "REFERENCE ENGINE", playback: "RECORDED", live: "LIVE MCU", unavailable: "NO TELEMETRY" };
export function Hardware({ ctx }) {
  const { state, connected, busy, api, demo, openHardware, ports, selectedPort, setSelectedPort, setMode } = ctx;
  const hw = state.hardware;
  const payloadKind = srcKind(ctx);
  const conn = connectionState(ctx);
  const h = ctx.current?.health || {};
  const [tab, setTab] = React.useState("Payload");
  const [selected, setSelected] = React.useState(null);
  const [explode, setExplode] = React.useState(0);
  const [housing, setHousing] = React.useState(true);
  const [internal, setInternal] = React.useState(false);
  const [autoRotate, setAutoRotate] = React.useState(true);
  const [resetKey, setResetKey] = React.useState(0);
  const choosePayloadPart = (id) => {
    setSelected(id);
    if (id === "housing") {
      setHousing(true);
      setInternal(false);
    }
    if (id && ["battery", "stm32", "analog", "power", "nav", "display"].includes(id)) setInternal(true);
  };
  const resetPayloadView = () => {
    setSelected(null);
    setInternal(false);
    setHousing(true);
    setResetKey((key) => key + 1);
  };
  return (
    <div className="ws ws-hw">
      <div className="hardware-overview">
        <div className="hardware-tabs seg" role="group" aria-label="Hardware views">
          {["Payload", "Signal chain"].map(name => <button key={name} className={tab === name ? "on" : ""} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}
        </div>
      </div>
      <div className="hw-top">
        <section className="panel hw-object" hidden={tab !== "Payload"}>
          <Label right={<Src kind={payloadKind}>{STATUS_LABEL[payloadKind]}</Src>}>AQUASDR PAYLOAD</Label>
          <div className="payload-engineering hardware-payload-viewer">
            <div className="payload-model-area">
              <PayloadViewport explode={explode} housing={housing} internal={internal} autoRotate={autoRotate} selected={selected} resetKey={resetKey} onSelect={choosePayloadPart}/>
              <div className="payload-model-caption">AQUASDR / INTERACTIVE ASSEMBLY</div>
              <span className="payload-model-hint">Drag to orbit · Alt + scroll to zoom · right-drag to pan</span>
            </div>
            <div className="payload-engineering-controls">
              <label className="assembly-slider">Assembly <span>Sealed</span><input aria-label="Exploded assembly" type="range" min="0" max="100" value={explode} onChange={(event) => setExplode(+event.target.value)}/><span>Exploded</span><output>{explode}%</output></label>
              <div className="payload-view-options">
                <button aria-pressed={housing} onClick={() => { setHousing((visible) => !visible); setInternal(false); }}>Housing</button>
                <button aria-pressed={internal} onClick={() => setInternal((visible) => !visible)}>Internal</button>
                <button aria-pressed={autoRotate} onClick={() => setAutoRotate((active) => !active)}>Auto rotate</button>
                <button aria-label="Reset payload view" title="Reset view" onClick={resetPayloadView}><RotateCcw size={13}/></button>
              </div>
            </div>
            <div className="payload-components" role="group" aria-label="Focus payload component">
              <button aria-pressed={!selected} onClick={resetPayloadView}>Overview</button>
              {PAYLOAD_PARTS.map(([id, label]) => <button key={id} aria-pressed={selected === id} onClick={() => choosePayloadPart(id)}>{label}</button>)}
            </div>
          </div>
          <p className="fine">Mounted assembly · firmware and channel status below come from live telemetry. Physical acoustic TX / RX are absent; the reference signal path is shown separately.</p>
        </section>
        <div className="hw-side">
          <section className="panel conn">
            <Label right={<b className={connectionTone(conn) === "red" ? "red" : connectionTone(conn) === "amber" ? "amber" : ""}><Dot tone={connectionTone(conn)} /> {conn}</b>}>STM32 SERIAL LINK</Label>
            <div className="conn-body">
              <Cable size={22} strokeWidth={1.2} />
              <div>
                <b>{hw.connected ? "Serial port open" : "Connect the payload"}</b>
                <p className="fine mono">USB CDC · 115200 baud · JSON lines · {state.transmitter?.ready && !demo ? 'web commands available' : 'telemetry / read-only'}</p>
              </div>
            </div>
            <div className="conn-ctl">
              <select aria-label="Serial device" value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}>
                <option value="">Select a device</option>
                {ports.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.path}
                    {p.manufacturer ? " · " + p.manufacturer : ""}
                  </option>
                ))}
              </select>
              <button className="tbtn" onClick={openHardware}>
                <RotateCcw size={12} /> Refresh
              </button>
              <button
                className="tbtn primary"
                disabled={busy || (!selectedPort && !hw.connected)}
                onClick={async () => {
                  if (hw.connected) await api("disconnect");
                  else {
                    if (demo) await setMode("hardware");
                    await api("connect", { path: selectedPort });
                  }
                }}
              >
                {hw.connected ? "Disconnect" : "Connect"}
              </button>
            </div>
            {hw.lastError && <p className="err">{hw.lastError}</p>}
            {hw.connected && !demo && !ctx.current?.control && <p className="fine">Sensor/TFT firmware · live telemetry + reference controls. Hardware DAC commands require the adaptive image and compatible wiring.</p>}
          </section>
          <section className="panel diag">
            <Label right={<b className={connectionTone(conn) === "red" ? "red" : connectionTone(conn) === "amber" ? "amber" : ""}><Dot tone={connectionTone(conn)} /> {conn}</b>}>DIAGNOSTICS</Label>
            <dl className="diag-meta">
              {[
                ["Firmware", hw.firmware || "unavailable"],
                ["Packets received", hw.received || 0],
                ["Dropped / invalid", hw.dropped || 0],
                ["Last valid packet", hw.lastPacket ? stamp(hw.lastPacket) : "never"],
                ["Reconnect attempts", hw.retries || 0],
                ["Bridge transport", connected ? "WebSocket connected" : "disconnected"],
                ["Telemetry", hw.fresh ? "fresh" : "unavailable / stale"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd className="mono">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="fine">Runtime status below is only ever what the payload's own packet reports (its <code>health</code> field) — nothing here is inferred or filled in.</p>
            <dl className="diag-health">
              {HEALTH.filter((k) => k !== "TX" && k !== "RX").map((k) => (
                <div key={k}>
                  <dt><Dot tone={healthTone(h[k], demo)} /> {k === "I2C" ? "I²C" : k}</dt>
                  <dd className="mono">{h[k] || "UNAVAILABLE"}</dd>
                </div>
              ))}
              <div><dt><Dot tone={ctx.operation?.waveformActive ? "ok" : "muted"}/> TX DIGITAL PIPELINE</dt><dd className="mono">{ctx.operation?.waveformActive ? 'ACTIVE' : 'APPLY / START REQUIRED'}</dd></div>
              <div><dt><Dot tone={ctx.operation?.modeledRxActive ? "ok" : "muted"}/> ACOUSTIC PREVIEW PIPELINE</dt><dd className="mono">{ctx.operation?.modeledRxActive ? 'ACTIVE' : 'APPLY / START REQUIRED'}</dd></div>
            </dl>
          </section>
        </div>
      </div>
      <section className="panel diag-card" hidden={tab !== "Signal chain"}>
        <Label right={<Src kind={payloadKind}>{STATUS_LABEL[payloadKind]}</Src>}>SIGNAL CHAIN & DATA PATH</Label>
          <SystemDiagram ctx={ctx} />
          <TxPathStatus ctx={ctx} />
      </section>
    </div>
  );
}

/* ============================ LOGS ============================ */
export function Logs({ ctx }) {
  const { state, logFilter, setLogFilter, exportSession } = ctx;
  const [logPage, setLogPage] = React.useState(0);
  const now = new Date().toISOString();
  const h = ctx.current?.health || {};
  const signal=ctx.signal || ctx.current;
  const environment=signal?.environment;
  const engineering = ctx.current ? [
    { id: "trace-sensor", timestamp: new Date().toISOString(), elapsed: state.elapsed, kind: "sensor", source: state.mode, message: `Live sensor channels · ${Object.values(ctx.sensors).filter(Number.isFinite).length} reported · ${srcKind(ctx).toUpperCase()}` },
    { id: "trace-threshold", timestamp: new Date().toISOString(), elapsed: state.elapsed, kind: "threshold", source: state.mode, message: `C policy · ${signal?.control?.profile || 'UNQUALIFIED'} · ${environment?.source || 'NO INPUT'} · severity ${environment?Math.max(environment.turbidityIndex,environment.depth):'—'}` },
    { id: "trace-waveform", timestamp: now, elapsed: state.elapsed, kind: "waveform", source: state.mode, message: `Waveform parameters · ${ctx.cfg.mode} · ${fmt(ctx.cfg.frequency, 1)} kHz · ${fmt(ctx.cfg.bandwidth, 1)} kHz BW · ${fmt(ctx.cfg.pulse, 1)} ms` },
    { id: "trace-dac", timestamp: now, elapsed: state.elapsed, kind: "engine", source: state.mode, message: `DAC armed state · ${h.DAC || (ctx.demo ? "SIMULATED" : "UNAVAILABLE")}` },
    { id: "trace-timer", timestamp: now, elapsed: state.elapsed, kind: "engine", source: state.mode, message: `Timer pulse engine · ${h.TIMER || (ctx.demo ? "SIMULATED" : "UNAVAILABLE")}` },
  ] : [];
  const kinds = ["all", "sensor", "threshold", "adaptation", "waveform", "engine", "scenario", "calibration", "warning", "info"];
  const allRows = [...engineering, ...state.events];
  const rows = allRows.filter((e) => logFilter === "all" || e.kind === logFilter);
  const page = Math.min(logPage, Math.max(0, Math.ceil(rows.length / 6) - 1));
  return (
    <div className="ws ws-logs">
      <section className="panel logs">
        <Label
          right={
            <>
              <div className="seg">
                {kinds.map((k) => (
                  <button key={k} className={logFilter === k ? "on" : ""} onClick={() => { setLogFilter(k); setLogPage(0); }}>
                    {k.toUpperCase()}
                  </button>
                ))}
              </div>
              <button className="tbtn" onClick={exportSession}>
                <Download size={12} /> EXPORT SESSION
              </button>
            </>
          }
        >
          MISSION LOG
        </Label>
        <ol className="stream-list">
          {rows.slice(page * 6, page * 6 + 6).map((e) => (
            <li key={e.id} className={"k-" + e.kind}>
              <time className="mono">{stamp(e.timestamp)}</time>
              <span className="mono dim">T+{clock(e.elapsed)}</span>
              <span className="kd mono">{KIND_LABEL[e.kind] || "SYS"}</span>
              <span className="msg">{e.message.replace(/Computed C engine/g,"Reference engine").replace(/COMPUTED/g,"REFERENCE")}</span>
              <span className="mono src-t">{e.target==='COMPUTED' || e.source==='demo' ? 'REFERENCE' : e.target || e.source.toUpperCase()}</span>
            </li>
          ))}
          {!rows.length && <li className="fine">No events for this filter.</li>}
        </ol>
        <div className="logs-footer"><p className="fine">Live engineering trace plus the latest 30 recorded session events; export keeps up to 500 recorded events.</p><PageControls page={page} count={rows.length} size={6} onChange={setLogPage} label="Mission log pages"/></div>
      </section>
    </div>
  );
}
