import React from "react";
import {
  ArrowUpRight,
  Circle,
  Download,
  Expand,
  Minimize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Snowflake,
  Square,
  Crosshair,
} from "lucide-react";
import { AScan, Echogram, Spark, Spectrogram, SpectrumCompare, TimeSeries, WaveScope, demoPrefill } from "../Charts.jsx";
import { Battery } from "../ui/Battery.jsx";
import { Payload } from "../ui/Payload.jsx";
import { Dot, Label, Num, Src, clock, fmt, healthTone, stamp } from "../ui/kit.jsx";
import { PACK, SAMPLE_RATE, WINDOWS, windowFn } from "../../shared/signal.js";
import {sensorDisplay} from '../../shared/sensor-display.js';
import {displayReference} from '../../shared/reference-selection.js';
import {seedReferenceEcho} from '../../shared/echo-display.js';

export const TURBIDITY_LIMIT = 30;
export const SENSORS = [
  ["temperature", "Temperature", "°C", 1, "DS18B20 · PC1", "MONITORING ONLY"],
  ["turbidity", "Turbidity", "NTU", 1, "SEN0189 optical · PB0", ""],
  ["pressure", "Pressure", "bar", 3, "Water-pressure transducer · PA1", "MONITORING ONLY"],
  ["depth", "Depth", "m", 2, "Calculated from water pressure", "MONITORING ONLY"],
  ["conductivity", "Conductivity", "mS/cm", 2, "TDS probe (EC) · PA0", "MONITORING ONLY"],
];
export const HEALTH = ["STM32", "ADC", "DAC", "DMA", "TIMER", "I2C", "SENSORS", "USB", "TX", "RX"];
export const rangeRes = (cfg, c = 1500) =>
  cfg.mode === "PHASE-CODED PULSE" ? (c * (cfg.pulse / 1000 / 13)) / 2 : c / (2 * cfg.bandwidth * 1000);
const isCode = (cfg) => cfg.mode === "PHASE-CODED PULSE";
export const srcKind = (ctx) =>
  ctx.source === "DEMO" ? "demo" : ctx.source === "PLAYBACK" ? "playback" : ctx.source === "LIVE" ? "live" : "unavailable";

/** True when what's on screen is fundamentally simulated — live demo, or a replayed recording of a demo session. Text that describes *why a number looks the way it does* (e.g. "the demo model adds transmit energy…") should key off this, not off the live/playback split, which is about provenance rather than realism. */
export const simSource = (ctx) => ctx.demo || (ctx.playback && ctx.state?.playback?.recordedMode === "demo");

/** CONNECTED · TELEMETRY ACTIVE | CONNECTED · STALE | DISCONNECTED | SIMULATION | PLAYBACK */
export function connectionState(ctx) {
  const { state, connected } = ctx;
  if (!connected) return "DISCONNECTED";
  if (state.mode === "demo") return "REFERENCE ENGINE";
  if (state.mode === "playback") return "PLAYBACK";
  const hw = state.hardware || {};
  if (!hw.connected) return "DISCONNECTED";
  return hw.fresh ? "CONNECTED · TELEMETRY ACTIVE" : "CONNECTED · STALE";
}
export const connectionTone = (label) =>
  label === "CONNECTED · TELEMETRY ACTIVE" ? "ok" : label === "DISCONNECTED" ? "red" : label === "CONNECTED · STALE" ? "amber" : "muted";

/* ============================ SONAR SCENE ============================ */
function useClearLeft() {
  const pick = () => (window.innerWidth > 1600 ? 354 : window.innerWidth > 1400 && window.innerHeight > 820 ? 320 : 280);
  const [v, setV] = React.useState(pick);
  React.useEffect(() => {
    const on = () => setV(pick());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return v;
}
export function SonarHero({ ctx, expanded = false, children, bare = false, clear }) {
  const { state, current, demo, playback, cfg, c, frozen, setFrozen, gain, setGain, range, setRange, maxRange, peaks, sonarView, setSonarView } = ctx;
  const view = expanded ? sonarView : "echogram";
  const signal=ctx.signal || current;
  const preview=ctx.preview || displayReference(signal,state.referencePreview,cfg);
  const previewRx = current?.samples || current?.echo ? null : preview?.rx;
  const displayData = previewRx || current;
  const modelActive = !!previewRx;
  const clearLeft = useClearLeft();
  return (
    <section className={"scene" + (expanded ? " scene-x" : "") + (bare ? " bare" : "")} style={clear ? { "--clear": clear + "px" } : undefined}>
      <header className="scene-top">
        <div className="chips">
          <span className="chip k">
            Sonar {expanded && <Src kind={srcKind(ctx)} />}
          </span>
          <span className="chip on">
            <Num value={preview?.config.frequency || cfg.frequency} digits={1} /> kHz
          </span>
          {expanded && <span className="chip">{cfg.mode}</span>}
          {modelActive && <span className="fine" title="The chart starts with the first reference return; new generated returns replace those initial columns.">Acoustic preview</span>}
          {expanded && Number.isFinite(c) && (
            <span className="chip hide-sm" title="Sound speed estimate · Coppens (1981)">
              c <Num value={c} digits={0} /> m/s
            </span>
          )}
          {expanded && view === "echogram" && (
            <span className="chip hide-sm" aria-hidden="true">
              <span className="scale">
                <em>low</em>
                <i />
                <em>high</em>
              </span>
            </span>
          )}
        </div>
        <div className="chips">
          {expanded && (
            <span className="chip" style={{ padding: "0 3px" }}>
              <span className="seg" role="tablist" aria-label="Sonar view" style={{ border: 0, background: "none" }}>
                {[
                  ["echogram", "ECHOGRAM"],
                  ["spectrum", "SPECTRUM"],
                  ["stft", "SPECTROGRAM"],
                ].map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setSonarView(k)}>
                    {l}
                  </button>
                ))}
              </span>
            </span>
          )}
          {view === "echogram" && (
            <>
              <span className="chip">
                <label>
                  RANGE
                  <select aria-label="Displayed range" value={range} onChange={(e) => setRange(+e.target.value)}>
                    {[maxRange, maxRange * 0.75, maxRange * 0.5].map((r) => (
                      <option key={r} value={r}>
                        {+r.toFixed(2)} m
                      </option>
                    ))}
                  </select>
                </label>
              </span>
              {expanded && <span className="chip hide-md">
                <label>
                  GAIN
                  <input aria-label="Display gain (colour only)" type="range" min="0.5" max="2" step="0.1" value={gain} onChange={(e) => setGain(+e.target.value)} />
                </label>
              </span>}
              <button className={"chip btn" + (frozen ? " hold" : "")} onClick={() => setFrozen(!frozen)} aria-pressed={frozen}>
                <Snowflake size={12} /> {frozen ? "FROZEN" : "FREEZE"}
              </button>
            </>
          )}
          <button className="chip btn sq" aria-label={expanded ? "Back to mission" : "Open sonar workspace"} onClick={() => ctx.setPage(expanded ? "Mission" : "Sonar")}>
            {expanded ? <Minimize2 size={14} /> : <Expand size={14} />}
          </button>
        </div>
      </header>
      <div className="scene-body">
        {view === "echogram" ? (
          <>
            <Echogram
              echo={displayData?.echo}
              packetKey={previewRx ? preview : demo ? state.seq : current?.timestamp}
              sessionKey={state.sessionId + state.mode + (previewRx?':reference':':reported')}
              rangeMax={maxRange}
              range={range}
              gain={gain}
              frozen={frozen}
              running={state.running}
              demo={demo}
              reference={!!previewRx}
              prefill={previewRx ? ()=>seedReferenceEcho(previewRx.echo) : demoPrefill(state, current)}
              peaks={previewRx?.detections || peaks}
              clearLeft={clear ?? (expanded || !children ? 0 : clearLeft)}
            />
            <div className="ascan-col">
              <span className="cap">{previewRx ? "ACOUSTIC PREVIEW A-SCAN" : "A-SCAN"}</span>
              <AScan echo={displayData?.echo} range={range} rangeMax={maxRange} peaks={previewRx?.detections || peaks} />
            </div>
          </>
        ) : view === "spectrum" ? (
          <div className="hero-plot">
            {signal?.control && !preview?.tx ? <p className="fine">Preparing the TX reference.</p> : <SpectrumCompare targetSamples={preview?.tx?.samples} targetRate={preview?.tx?.sampleRate} config={cfg} measured={displayData?.samples} measuredRate={displayData?.sampleRate} resultLabel={previewRx?'acoustic preview':'receive capture'}/>}
            <div className="plot-key">
              <span><i className="k-dash" /> TX · calculated C reference</span>
              <span><i className="k-line" /> {previewRx ? "ACOUSTIC PREVIEW" : displayData?.samples ? 'MEASURED RX' : "RX BUFFER · unavailable"}</span>
            </div>
          </div>
        ) : (
          <div className="hero-plot">
            {displayData?.samples ? <Spectrogram config={cfg} samples={displayData.samples} sampleRate={displayData.sampleRate} signalLabel={modelActive?'Modeled RX':'Reported RX'}/> : <p className="fine">RX samples unavailable</p>}
          </div>
        )}
        {!current && view !== "stft" && (
          <div className="no-signal">
            <b>{ctx.connected ? "NO SIGNAL" : "BRIDGE OFFLINE"}</b>
            <span>{demo ? "Waiting for the demo stream." : playback ? "Select a saved session to play back." : "Awaiting acoustic data from the payload."}</span>
          </div>
        )}
        {current && !demo && view === "echogram" && !displayData?.echo && (
          <div className="no-signal">
            <b>ECHO UNAVAILABLE</b>
            <span>The payload is connected but is not reporting echo bins.</span>
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/* ============================ PAYLOAD OBJECT ============================ */
export function PayloadCard({ ctx }) {
  const { current, demo, state, connected, sensors, power, cfg } = ctx;
  const h = current?.health || {};
  const tx = !!current && state.running && (demo || /active|ok|ready/i.test(h.TX || ""));
  const rx = !!current && state.running && (demo || /active|ok|ready/i.test(h.RX || ""));
  const led = !connected ? "red" : demo ? "amber" : current ? "ok" : "muted";
  const cells = [
    ["DEPTH", <><Num value={sensors.depth} digits={2} /><u>m</u></>],
    ["TEMP", <><Num value={sensors.temperature} digits={1} /><u>°C</u></>],
    ["TX", tx ? <><Num value={cfg.frequency} digits={0} /><u>kHz</u></> : "IDLE"],
    ["RX", rx ? "ACTIVE" : current ? "IDLE" : "—"],
    ["POWER", <><Num value={power.watts} digits={2} /><u>W</u></>],
  ];
  return (
    <aside className="float pcard">
      <Label right={<Src kind={srcKind(ctx)}>{!connected ? "OFFLINE" : undefined}</Src>}>AQUASDR-01</Label>
      <div className="pcard-render">
        <Payload tx={tx} led={led} soc={power.soc} />
      </div>
      <dl className="ptel">
        {cells.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/* ============================ PAYLOAD IN THE SCENE ============================ */
export function PayloadObject({ ctx }) {
  const { current, demo, state, connected, sensors, power, cfg } = ctx;
  const h = current?.health || {};
  const tx = !!current && state.running && (demo || /active|ok|ready/i.test(h.TX || ""));
  const rx = !!current && state.running && (demo || /active|ok|ready/i.test(h.RX || ""));
  const led = !connected ? "red" : demo ? "amber" : current ? "ok" : "muted";
  const line = !connected
    ? "Bridge offline"
    : demo
      ? "Demo simulation · payload not connected"
      : current
        ? "Payload online · STM32 telemetry"
        : "Awaiting payload telemetry";
  const read = [
    ["Depth", <><Num value={sensors.depth} digits={2} /><u>m</u></>],
    ["Temp", <><Num value={sensors.temperature} digits={1} /><u>°C</u></>],
    ["TX", tx ? <><Num value={cfg.frequency} digits={1} /><u>kHz</u></> : <span className="idle">IDLE</span>],
    ["RX", rx ? "Active" : <span className="idle">{current ? "Idle" : "—"}</span>],
    ["Power", <><Num value={power.watts} digits={2} /><u>W</u></>],
  ];
  return (
    <section className="st-object" aria-label="AQUASDR payload">
      <div className="obj-title">
        <span className="obj-k">MISSION STATUS</span>
        <h1>AQUASDR-01</h1>
        <p>
          <Dot tone={led === "muted" ? "muted" : led} /> {line}
        </p>
      </div>
      <div className="obj-render">
        <Payload tx={tx} led={led} soc={power.soc} beam />
      </div>
      <dl className="obj-read">
        {read.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div className="obj-src">
          <Src kind={demo ? "simulated" : current ? "live" : "unavailable"} />
        </div>
      </dl>
    </section>
  );
}

/* ============================ ENVIRONMENT ============================ */
export function EnvPanel({ ctx, floating = true, compact = false }) {
  const { sensors, history, demo } = ctx;
  return (
    <aside className={floating ? "env float" : "env panel"}>
      <Label right={compact ? <button className="ibtn" aria-label="Open sensors workspace" onClick={() => ctx.setPage("Sensors")}><ArrowUpRight size={16}/></button> : <Src kind={srcKind(ctx)} />}>Environment</Label>
      <div className="env-grid">
        {SENSORS.map(([key, name, unit, d], i) => {
          const channel=sensorDisplay(ctx,key,name,unit,d),v=channel.value;
          const alert = key === "turbidity" && channel.unit==='NTU' && v > TURBIDITY_LIMIT;
          if(!Number.isFinite(v)) return null;
          return (
            <div className={"env-cell" + (i === 4 ? " env-cell-wide" : "") + (alert ? " alert" : "")} key={key}>
              <span className="ec-label">
                <Dot tone={!Number.isFinite(v) ? "muted" : alert ? "amber" : "ok"} />
                {channel.name}
              </span>
              <span className="ec-value">
                <><Num value={v} digits={channel.digits} /><u>{channel.unit}</u></>
              </span>
              <Spark values={channel.values} alert={alert} />
            </div>
          );
        })}
      </div>
      {!floating && !compact && <p className="fine">Coppens (1981) with salinity ≈ 0.64 × conductivity. {simSource(ctx) ? "Inputs simulated." : ""}</p>}
    </aside>
  );
}

/* ============================ ADAPTATION ============================ */
function decisionRows(cfg, prev, c) {
  const code = isCode(cfg);
  return [
    ["Center", prev?.frequency, cfg.frequency, "kHz", 1],
    [code ? "Chip rate" : "Bandwidth", prev ? (isCode(prev) ? 13 / prev.pulse : prev.bandwidth) : undefined, code ? 13 / cfg.pulse : cfg.bandwidth, code ? "kchip/s" : "kHz", code ? 2 : 1],
    ["Pulse", prev?.pulse, cfg.pulse, "ms", 1],
    ["Amplitude", prev?.amplitude, cfg.amplitude, "%", 0],
    ["Range res.", prev ? rangeRes(prev, c) * 100 : undefined, rangeRes(cfg, c) * 100, "cm", 0],
  ];
}
// Plain-language verbs for what the last decision did to the waveform, derived
// only from the before/after configs — never from the policy's intent.
export function adaptActions(cfg, before) {
  if (!before) return ["NO CHANGE · VALUES HELD"];
  const out = [];
  const dir = (a, b, up, down) => (b > a + 1e-9 ? up : b < a - 1e-9 ? down : null);
  if (before.mode !== cfg.mode) out.push(`SWITCH TO ${cfg.mode}`);
  out.push(
    ...[
      dir(before.frequency, cfg.frequency, "RAISE CENTRE", "LOWER CENTRE"),
      !isCode(cfg) && !isCode(before) && dir(before.bandwidth, cfg.bandwidth, "WIDEN BANDWIDTH", "NARROW BANDWIDTH"),
      dir(before.pulse, cfg.pulse, "LENGTHEN PULSE", "SHORTEN PULSE"),
      dir(before.amplitude, cfg.amplitude, "RAISE AMPLITUDE", "LOWER AMPLITUDE"),
    ].filter(Boolean),
  );
  return out.length ? out : ["NO CHANGE · VALUES HELD"];
}
function BeforeAfter({ rows, prevMode, mode }) {
  const beforeMode = prevMode || mode;
  return (
    <table className="out ba mono">
      <thead>
        <tr>
          <th />
          <th>BEFORE</th>
          <th>AFTER</th>
          <th>Δ</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr className={beforeMode !== mode ? "changed" : ""}>
          <td className="p">Mode</td>
          <td className="a0">{beforeMode}</td>
          <td className="b">{mode}</td>
          <td className="dl">{beforeMode === mode ? "NO CHANGE" : "CHANGED"}</td>
          <td className="u" />
        </tr>
        {rows.map(([name, a, b, unit, d]) => {
          const before = a === undefined ? b : a;
          const delta = b - before;
          const changed = Math.abs(delta) > 1e-9;
          return (
            <tr key={name + (changed ? String(b) : "")} className={changed ? "changed" : ""}>
              <td className="p">{name}</td>
              <td className="a0">{fmt(before, d)}</td>
              <td className="b">
                <Num value={b} digits={d} />
              </td>
              <td className="dl">{changed ? `${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta), d)}` : "NO CHANGE"}</td>
              <td className="u">{unit}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
export function whyChain(ctx) {
  const { state, prev, cfg, c } = ctx;
  const ev = state.events.find((e) => e.kind === "adaptation" || e.kind === "waveform");
  if (!ev) return null;
  const lines = [];
  const m = ev.message.match(/Turbidity ([\d.]+) NTU ([<>]) (\d+) NTU/);
  if (ev.kind === "waveform") lines.push(["Operator", "applied a waveform manually"]);
  else if (m) {
    lines.push(["Condition", `turbidity ${m[1]} NTU ${m[2]} ${m[3]} NTU`]);
    lines.push(["Policy", m[2] === ">" ? "triggered" : "released (hysteresis)"]);
  } else lines.push(["Policy", ev.message]);
  if (prev?.cfg) {
    for (const [name, a, b, unit, d] of decisionRows(cfg, prev.cfg, c))
      if (a !== undefined && Math.abs(a - b) > 1e-9) lines.push(["Output", `${name.toLowerCase()} ${fmt(a, d)} → ${fmt(b, d)} ${unit}`]);
  } else {
    // Console joined after the change: report the resulting waveform, not an invented "before".
    lines.push(["Output", `now ${cfg.mode} · ${fmt(cfg.bandwidth, 1)} kHz · ${fmt(cfg.pulse, 1)} ms`]);
  }
  return { lines, at: ev.timestamp };
}
export function AdaptationPanel({ ctx, wide = false }) {
  const { state, demo, sensors, history, cfg, prev, c, busy, control, connected } = ctx;
  const turb = sensors.turbidity;
  const hot = Number.isFinite(turb) && turb > TURBIDITY_LIMIT;
  const policyOn = cfg.mode === "LFM CHIRP" && cfg.bandwidth === 1.2 && cfg.pulse === 8;
  const status = !simSource(ctx) ? "FIRMWARE" : !state.adaptive ? "BYPASSED" : policyOn ? "TRIGGERED" : "ARMED";
  const why = whyChain(ctx);
  const rows = decisionRows(cfg, prev?.cfg, c || 1500);
  // one travelling mark down the decision chain when a NEW decision arrives (not on mount)
  const seen = React.useRef(null);
  const [pulse, setPulse] = React.useState(null);
  React.useEffect(() => {
    if (!why) return;
    if (seen.current && seen.current !== why.at) setPulse(why.at);
    seen.current = why.at;
  }, [why?.at]);
  return (
    <section className={"adapt panel" + (wide ? " adapt-wide" : "")}>
      <Label
        right={
          <div className="seg" role="group" aria-label="Adaptation control">
            <button className={demo && state.adaptive ? "on" : ""} disabled={!demo || busy || state.adaptive} onClick={() => control("adaptive")}>
              AUTO
            </button>
            <button className={!(demo && state.adaptive) ? "on" : ""} disabled={!demo || busy || !state.adaptive} onClick={() => control("adaptive")}>
              MANUAL
            </button>
          </div>
        }
      >
        ADAPTATION ENGINE
      </Label>
      <p className="fine">
        {simSource(ctx) ? "Showcase policy · driven by the current environment state" : "Firmware policy · reported by the live payload"}
      </p>
      <div className="flow">
        {pulse && <span key={pulse} className="pulse" aria-hidden="true" />}
        <div className="stage">
          <span className="node">1</span>
          <div className="stage-h">
            CONDITION <span>turbidity · 60 s</span>
          </div>
          <div className="big">
            <Num value={turb} digits={1} className={hot ? "amber" : ""} />
            <u>NTU</u>
            <span className="lim mono">limit {TURBIDITY_LIMIT}</span>
          </div>
          <div className="stage-plot">
            <TimeSeries values={history.map((h) => h.sensors?.turbidity)} unit="NTU" limit={TURBIDITY_LIMIT} color="#8c9a9d" />
          </div>
        </div>
        <div className={"stage" + (status === "TRIGGERED" ? " hot" : "")}>
          <span className="node">2</span>
          <div className="stage-h">
            POLICY <b className={"pstate p-" + status.toLowerCase()}>{status}</b>
          </div>
          <div className="rule mono">
            <span>IF turbidity &gt; {TURBIDITY_LIMIT} NTU</span>
            <span>THEN LFM · 1.2 kHz · 8 ms</span>
            <span className="dim">ELSE BELOW 27 NTU → default</span>
          </div>
        </div>
        <div className="stage out">
          <span className="node">3</span>
          <div className="stage-h">
            OUTPUT <span>{cfg.mode}</span>
          </div>
          <table className="out mono">
            <tbody>
              {rows.map(([name, a, b, unit, d]) => {
                const changed = a !== undefined && Math.abs(a - b) > 1e-9;
                return (
                  <tr key={name + (changed ? String(b) : "")} className={changed ? "changed" : ""}>
                    <td className="p">{name}</td>
                    <td className="a">{changed ? fmt(a, d) : ""}</td>
                    <td className="ar">{changed ? "→" : ""}</td>
                    <td className="b">
                      <Num value={b} digits={d} />
                    </td>
                    <td className="u">{unit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="why">
        <Label right={why ? <span className="mono">{stamp(why.at)}</span> : null}>WHY</Label>
        {why ? (
          <ol>
            {why.lines.map(([k, t], i) => (
              <li key={i}>
                <span>{k}</span>
                {t}
              </li>
            ))}
          </ol>
        ) : (
          <p className="fine">
            {demo && state.adaptive ? `No change this session. The policy fires above ${TURBIDITY_LIMIT} NTU.` : demo ? "Manual control — the operator's waveform is held." : "Waveform changes are reported by the payload firmware."}
          </p>
        )}
      </div>
      {demo && (
        <div className="scenario-controls">
          <button className={"scenario" + (state.scenario ? " on" : "")} disabled={busy || !connected || state.scenario} onClick={() => control("scenario")}><Plus size={13} />START SCENARIO</button>
          <button className="scenario" disabled={busy || !connected || !state.running} onClick={() => control("pause")}><Pause size={13}/>PAUSE</button>
          <button className="scenario" disabled={busy || !connected} onClick={() => control("scenarioReset")}><RotateCcw size={13}/>RESET</button>
        </div>
      )}
    </section>
  );
}

/* ============================ ADAPTATION PIPELINE (workspace) ============================ */
function FirmwareAdaptation({ current }) {
  const a = current.adaptation;
  const waveform = current.waveform;
  return <section className="panel firmware-adaptation">
    <Label right={<Src kind="measured">STM32 TELEMETRY</Src>}>ON-BOARD ADAPTATION · ELECTRICAL BENCH</Label>
    <p className="fine">The STM32 reads PA0/A0 and selects the waveform itself. This input represents an environment dial, not measured turbidity. The console is read-only.</p>
    <div className="firmware-adaptation-grid">
      <section><h3>ADC input</h3><dl>
        <div><dt>Input voltage</dt><dd><Num value={a.inputVolts} digits={3} /> V</dd></div>
        <div><dt>Filtered level</dt><dd><Num value={a.levelPercent} digits={1} /> %</dd></div>
        <div><dt>Input status</dt><dd>{a.inputValid ? "VALID RANGE" : "INVALID / STALE"}</dd></div>
      </dl></section>
      <section><h3>Firmware decision</h3><dl>
        <div><dt>Requested profile</dt><dd>{a.profile}</dd></div>
        <div><dt>Output state</dt><dd>{a.state}</dd></div>
        <div><dt>Requested / applied ID</dt><dd>{a.decisionId} / {a.appliedDecisionId}</dd></div>
      </dl></section>
      <section><h3>Last applied output</h3><dl>
        <div><dt>Waveform</dt><dd>{waveform?.mode || "NONE YET"}</dd></div>
        <div><dt>Decision → output</dt><dd><Num value={a.decisionToOutputMs} digits={0} /> ms</dd></div>
        <div><dt>DAC underruns</dt><dd>{current.engine?.underruns ?? "—"}</dd></div>
      </dl></section>
    </div>
    <div className="firmware-adaptation-table"><table>
      <thead><tr><th>Last applied settings</th><th>Center</th><th>Bandwidth</th><th>Pulse</th><th>Amplitude</th></tr></thead>
      <tbody><tr><td>{waveform?.window || "—"}</td><td><Num value={waveform?.frequency} digits={1} /> kHz</td><td><Num value={waveform?.bandwidth} digits={1} /> kHz</td><td><Num value={waveform?.pulse} digits={1} /> ms</td><td><Num value={waveform?.amplitude} digits={0} /> % FS</td></tr></tbody>
    </table></div>
    <p className="fine">Profiles use filtered input with hysteresis and 60 ms qualification. Invalid/stale input inhibits pulses; DMA/DAC faults require a board reset. Reported latency is the firmware decision-to-pulse-start interval, not sensor response time or oscilloscope validation. Displayed settings are historical while inhibited.</p>
    <p className="fine">Bench policy only: CLEAR 42 kHz / 4 kHz / 2 ms / 35%; TRANSITION 40 / 2 / 4 / 50%; MURKY 38 / 1 / 8 / 62%. Acoustic optimisation and analog output quality remain unvalidated.</p>
  </section>;
}

export function AdaptationPipeline({ ctx }) {
  const { state, demo, sensors, history, cfg, prev, c, busy, control, connected, power } = ctx;
  const turb = sensors.turbidity;
  const hot = Number.isFinite(turb) && turb > TURBIDITY_LIMIT;
  const policyOn = cfg.mode === "LFM CHIRP" && cfg.bandwidth === 1.2 && cfg.pulse === 8;
  const status = !simSource(ctx) ? "FIRMWARE" : !state.adaptive ? "BYPASSED" : policyOn ? "TRIGGERED" : "ARMED";
  const before = prev?.cfg || cfg;
  const rows = decisionRows(cfg, before, c || 1500);
  const why = whyChain(ctx);
  const cc = c || 1500;
  const B = isCode(cfg) ? 13 / (cfg.pulse / 1000) : cfg.bandwidth * 1000;
  const res = rows.find((r) => r[0] === "Range res.");
  if (ctx.current?.adaptation) return <FirmwareAdaptation current={ctx.current} />;
  return (
    <div className="adaptation-evidence">
      <div className="pipe">
      <section className="pipe-st">
        <header>
          <span className="pipe-n">01</span>ENVIRONMENT <Src kind={ctx.turbiditySpoofed ? "model" : srcKind(ctx)}>{ctx.turbiditySpoofed ? "CALCULATED" : undefined}</Src>
        </header>
        <div className="pipe-big">
          <span>Turbidity</span>
          <b className={hot ? "amber" : ""}>
            <><Num value={turb} digits={1} /><u>NTU</u></>
          </b>
        </div>
        <div className="pipe-plot">
          <TimeSeries values={history.map((h) => h.sensors?.turbidity)} unit="NTU" limit={TURBIDITY_LIMIT} color="#8e9ca0" />
        </div>
        <dl className="pipe-mini">
          {[
            ["Temperature", sensors.temperature, 1, "°C"],
            ["Depth", sensors.depth, 2, "m"],
            ["Conductivity", sensors.conductivity, 2, "mS/cm"],
          ].map(([k, v, d, u]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="mono">
                <Num value={v} digits={d} />
                <u>{u}</u>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <span className="pipe-arrow" aria-hidden="true" />
      <section className={"pipe-st" + (status === "TRIGGERED" ? " hot" : "")}>
        <header>
          <span className="pipe-n">02</span>DECISION <b className={"pstate p-" + status.toLowerCase()}>{status}</b>
        </header>
        <div className="pipe-big">
          <span>Threshold</span>
          <b>
            {TURBIDITY_LIMIT}
            <u>NTU</u>
          </b>
        </div>
        <div className="rule mono">
          <span>IF turbidity &gt; {TURBIDITY_LIMIT} NTU</span>
          <span>THEN LFM · 1.2 kHz · 8 ms</span>
          <span className="dim">RELEASE below 27 NTU (hysteresis)</span>
        </div>
        <div className="action">
          <span>ACTION</span>
          {adaptActions(cfg, before).map((a) => <b key={a}>{a}</b>)}
        </div>
        <div className="pipe-ctl">
          <div className="seg" role="group" aria-label="Adaptation control">
            <button className={demo && state.adaptive ? "on" : ""} disabled={!demo || busy || state.adaptive} onClick={() => control("adaptive")}>
              AUTO
            </button>
            <button className={!(demo && state.adaptive) ? "on" : ""} disabled={!demo || busy || !state.adaptive} onClick={() => control("adaptive")}>
              MANUAL
            </button>
          </div>
          {demo && (
            <div className="scenario-controls">
              <button className={"scenario" + (state.scenario ? " on" : "")} disabled={busy || !connected || state.scenario} onClick={() => control("scenario")}><Plus size={13}/>START</button>
              <button className="scenario" disabled={busy || !connected || !state.running} onClick={() => control("pause")}><Pause size={13}/>PAUSE</button>
              <button className="scenario" disabled={busy || !connected} onClick={() => control("scenarioReset")}><RotateCcw size={13}/>RESET</button>
            </div>
          )}
        </div>
        <p className="fine">{simSource(ctx) ? "Showcase policy · driven by the current environment state" : "Firmware policy · reported by the live payload"}</p>
      </section>
      <span className="pipe-arrow" aria-hidden="true" />
      <section className="pipe-st">
        <header>
          <span className="pipe-n">03</span>WAVEFORM <Src kind="target" />
        </header>
        <div className="pipe-big">
          <span>{cfg.mode}</span>
          <b>
            <Num value={cfg.frequency} digits={1} />
            <u>kHz</u>
          </b>
        </div>
        <BeforeAfter rows={rows.filter((r) => r[0] !== "Range res.")} prevMode={before.mode} mode={cfg.mode} />
      </section>
      <span className="pipe-arrow" aria-hidden="true" />
      <section className="pipe-st">
        <header>
          <span className="pipe-n">04</span>RESULT <Src kind="computed" />
        </header>
        <div className="pipe-big">
          <span>Range resolution</span>
          <b>
            {res && res[1] !== undefined && Math.abs(res[1] - res[2]) > 1e-9 && <em className="was">{fmt(res[1], 0)}</em>}
            <Num value={rangeRes(cfg, cc) * 100} digits={0} />
            <u>cm</u>
          </b>
        </div>
        <dl className="pipe-mini">
          <div>
            <dt>Pulse length in water</dt>
            <dd className="mono">
              {(cc * cfg.pulse / 1000).toFixed(2)}
              <u>m</u>
            </dd>
          </div>
          <div>
            <dt>Time–bandwidth</dt>
            <dd className="mono">
              {((B * cfg.pulse) / 1000).toFixed(1)}
              <u>B·T</u>
            </dd>
          </div>
          <div>
            <dt>System power</dt>
            <dd className="mono">
              <Num value={power.watts} digits={2} />
              <u>W</u>
            </dd>
          </div>
        </dl>
        <div className="why">
          <Label right={why ? <span className="mono">{stamp(why.at)}</span> : null}>WHY</Label>
          {why ? (
            <ol>
              {why.lines.map(([k, t], i) => (
                <li key={i}>
                  <span>{k}</span>
                  {t}
                </li>
              ))}
            </ol>
          ) : (
            <p className="fine">NO CHANGE · VALUES HELD. No new firmware decision has been reported this session.</p>
          )}
        </div>
      </section>
      </div>
    </div>
  );
}

/* ============================ WAVEFORM MODES ============================ */
// Three modes are selectable in the transmit waveform dialog; none has a
// commissioned hardware transmit path yet, and none has an acoustic
// measurement behind it. Keep this in sync with that reality — don't mark a
// mode HARDWARE READY or VALIDATED until the bridge actually reports it.
export const WAVEFORM_MODES = [
  ["LFM CHIRP", "Linear frequency sweep"],
  ["GEOMETRIC SWEEP", "Exponential (geometric) frequency sweep"],
  ["PHASE-CODED PULSE", "Barker-13 biphase-coded pulse"],
];
export function WaveformModes({ active }) {
  return (
    <div className="modes">
      <Label right={<Src kind="unavailable">HARDWARE TX NOT COMMISSIONED</Src>}>WAVEFORM MODES</Label>
      <table className="it">
        <thead>
          <tr>
            <th>MODE</th>
            <th>GENERATION</th>
            <th>HARDWARE</th>
            <th>VALIDATION</th>
          </tr>
        </thead>
        <tbody>
          {WAVEFORM_MODES.map(([name, desc]) => (
            <tr key={name} title={desc}>
              <td>
                {name === active ? <Dot tone="ok" /> : <Dot tone="muted" />} {name}
              </td>
              <td>
                <span className="bstat b-ok">BUFFER GENERATED</span>
              </td>
              <td>
                <span className="bstat b-muted">NOT COMMISSIONED</span>
              </td>
              <td>
                <span className="bstat b-muted">NOT VALIDATED</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine">All three modes generate a digital sample buffer today (software, COMPUTED). None has a commissioned transmit path or an acoustic measurement behind it yet — that only changes when the bridge reports it, never by claim.</p>
    </div>
  );
}

/* ============================ WAVEFORM ENGINE ============================ */
// Envelope of the selected window against an unshaped (rectangular) pulse.
function WindowEnvelope({ name }) {
  const fn = windowFn(name);
  const pts = Array.from({ length: 41 }, (_, i) => `${(i / 40) * 100},${28 - fn(i / 40) * 24}`).join(" ");
  return (
    <svg className="win-env" viewBox="0 0 100 30" preserveAspectRatio="none" aria-label={`${name} window envelope vs rectangular pulse`}>
      <polyline className="raw" points="0,28 0,4 100,4 100,28" />
      <polyline className="win" points={pts} />
    </svg>
  );
}
// The PS asks for timer-paced, DMA-fed DAC streaming so generation never
// occupies the CPU. Stage states are whatever the payload's health field
// says; buffer size is computed from the commanded pulse; CPU load is only
// ever the firmware's own figure.
export function WaveformEngine({ ctx }) {
  const { cfg, current, demo } = ctx;
  const signal=ctx.signal || current, computed=ctx.operation?.target==='COMPUTED' || demo;
  const h = current?.health || {};
  const eng = signal?.engine || {};
  const preview=ctx.preview || displayReference(signal,ctx.state.referencePreview,cfg);
  const rate = computed && preview?.tx ? preview.tx.sampleRate : eng.timerHz || current?.sampleRate || SAMPLE_RATE;
  const samples = computed && preview?.tx ? preview.tx.samples.length : eng.dmaBuffer ?? Math.round((cfg.pulse / 1000) * rate);
  const win = cfg.window || "HANN";
  return (
    <section className="engine panel">
      <Label right={<Src kind={computed?'computed':srcKind(ctx)} />}>WAVEFORM ENGINE</Label>
      <div className="eng-modes" role="list" aria-label="Waveform families">
        {WAVEFORM_MODES.map(([m, desc]) => (
          <span key={m} role="listitem" title={desc} className={m === cfg.mode ? "on" : ""}>
            {m === cfg.mode ? <Dot tone="ok" /> : <Dot tone="muted" />}
            {m.replace(" PULSE", "")}
          </span>
        ))}
      </div>
      <ol className="eng-chain" aria-label="Generation path">
        {[
          ["TIMER", "TIM6 · sample clock"],
          ["DMA", "burst per ping · no CPU copy"],
          ["DAC", "DAC1 · PA4 · 12-bit"],
        ].map(([k, sub]) => (
          <li key={k} title={sub}>
            <b>
              <Dot tone={healthTone(h[k], demo)} /> {k}
            </b>
            <span className="mono">{computed ? !demo && h[k] ? `${h[k]} · telemetry only` : 'HARDWARE NOT COMMANDED' : h[k] || "UNAVAILABLE"}</span>
          </li>
        ))}
      </ol>
      <dl>
        <div>
          <dt>{computed?'Reference rate':'Sample clock'}</dt>
          <dd className="mono">
            {fmt(rate / 1e6, 2)} <u>MS/s</u>
          </dd>
        </div>
        <div>
          <dt>{computed?'Reference buffer':'Pulse buffer'}</dt>
          <dd className="mono">
            {samples} <u>samples · {fmt((samples * 2) / 1024, 1)} KB</u>
          </dd>
        </div>
        <div>
          <dt>Generation CPU load</dt>
          <dd className="mono">{Number.isFinite(eng.cpuLoad) ? <>{fmt(eng.cpuLoad, 1)} <u>%</u></> : <span className="dim">NOT REPORTED</span>}</dd>
        </div>
        <div className="eng-win">
          <dt>
            Window <b className="mono">{win}</b> <u className="mono">{WINDOWS[win]?.sidelobe} dB</u>
          </dt>
          <dd>
            <WindowEnvelope name={win} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

/* ============================ WAVEFORM ============================ */
export function WaveformPanel({ ctx, className = "" }) {
  const { cfg, waveView, setWaveView, openWaveform, state } = ctx;
  const signal=ctx.signal || ctx.current;
  const preview=ctx.preview || displayReference(signal,state.referencePreview,cfg);
  const code = isCode(cfg);
  return (
    <section className={"wave panel " + className}>
      <Label
        right={
          <>
            <div className="seg" role="tablist" aria-label="Waveform view">
              {[
                ["time", "TIME"],
                ["fft", "FFT"],
                ["stft", "SPECTROGRAM", "STFT"],
              ].map(([k, l, sh]) => (
                <button key={k} role="tab" aria-selected={waveView === k} aria-label={l} className={waveView === k ? "on" : ""} onClick={() => setWaveView(k)}>
                  {sh ? (
                    <>
                      <span className="l-long">{l}</span>
                      <span className="l-short">{sh}</span>
                    </>
                  ) : (
                    l
                  )}
                </button>
              ))}
            </div>
            <button className="ibtn" aria-label="Configure waveform" onClick={openWaveform}>
              <SlidersHorizontal size={14} />
            </button>
          </>
        }
      >
        TX REFERENCE <Src kind="computed">COMPUTED</Src>{" "}
        <span><Src kind="computed">BENCH · 38–42 kHz</Src></span>
      </Label>
      <div className="wave-id">
        <b>{cfg.mode}</b>
        {[
          ["CENTER", cfg.frequency, 1, "kHz"],
          code ? ["CHIP RATE", 13 / cfg.pulse, 2, "kchip/s"] : ["BANDWIDTH", cfg.bandwidth, 1, "kHz"],
          ["PULSE", cfg.pulse, 1, "ms"],
          ["AMPLITUDE", cfg.amplitude, 0, "%"],
        ].map(([k, v, d, u]) => (
          <span className="wv" key={k}>
            <i>{k}</i>
            <span>
              <Num value={v} digits={d} />
              <u>{u}</u>
            </span>
          </span>
        ))}
        <span className="wv">
          <i>WINDOW</i>
          <span>{cfg.window || "HANN"}</span>
        </span>
      </div>
      <div className="wave-plot">
        {preview?.tx ? (waveView === "stft" ? <Spectrogram config={cfg} samples={preview.tx.samples} sampleRate={preview.tx.sampleRate} signalLabel="TX reference" showRidge/> : <WaveScope config={cfg} samples={preview.tx.samples} sampleRate={preview.tx.sampleRate} view={waveView} running={state.running} />) : <p className="fine">Preparing the TX reference.</p>}
      </div>
    </section>
  );
}

/* ============================ POWER ============================ */
export { derivePower as powerDerived } from "../../shared/power.js";
export { PowerCard as PowerPanel } from "../ui/PowerCard.jsx";

/* ============================ MISSION LOG ============================ */
export const KIND_LABEL = { sensor: "SENSOR", threshold: "LIMIT", engine: "ENGINE", adaptation: "ADAPT", waveform: "WAVE", warning: "WARN", scenario: "SCEN", calibration: "CAL", info: "SYS" };
export function MissionLog({ ctx, count = 7 }) {
  const { state, setPage } = ctx;
  return (
    <section className="log panel quiet">
      <Label right={<button className="lbtn" onClick={() => setPage("Logs")}>{state.events.length} →</button>}>MISSION LOG</Label>
      <ol>
        {state.events.slice(0, count).map((e) => (
          <li key={e.id} className={"k-" + e.kind}>
            <time className="mono">{stamp(e.timestamp)}</time>
            <span>{e.message}</span>
          </li>
        ))}
        {!state.events.length && <li className="fine">No events this session.</li>}
      </ol>
    </section>
  );
}

/* ============================ STATUS STRIP ============================ */
export function StatusStrip({ ctx }) {
  const { current, demo, playback, state, busy, connected, control, save, exportSession, scrub } = ctx;
  const h = current?.health || {};
  const pb = state.playback;
  return (
    <footer className="strip">
      <details className="strip-health-menu"><summary><Dot tone={!connected ? "red" : demo ? "amber" : playback ? "accent" : current ? "ok" : "muted"}/> Payload status</summary><div className="strip-health">
        <span className="sk">PAYLOAD</span>
        {HEALTH.map((k) => (
          <span key={k} className="hs" title={`${k}: ${h[k] || "unavailable"}`}>
            <Dot tone={healthTone(h[k], demo)} />
            {k === "I2C" ? "I²C" : k}
          </span>
        ))}
        <Src kind={srcKind(ctx)} />
      </div></details>
      {playback && pb && (
        <div className="strip-scrub">
          <span className="fine mono">PLAYBACK {pb.length ? pb.index + 1 : 0}/{pb.length} · session {pb.sessionId?.slice(0, 8)} · recorded {pb.recordedMode || "unknown"}</span>
          <input
            aria-label="Playback position"
            type="range"
            min={0}
            max={Math.max(0, pb.length - 1)}
            value={pb.index}
            onChange={(e) => scrub(+e.target.value)}
          />
        </div>
      )}
      <div className="strip-ctrl">
        <button className={"cb" + (state.running ? " run" : " go")} onClick={() => control(state.running ? "pause" : "start")} disabled={busy || !connected || (playback && !pb)}>
          {state.running ? <Pause size={12} /> : <Play size={12} />} {state.running ? "PAUSE" : "START"}
        </button>
        <button className="cb" onClick={() => control("stop")} disabled={!connected}>
          <Square size={11} /> STOP
        </button>
        <button className={"cb" + (state.recording ? " rec" : "")} onClick={() => control("record")} disabled={busy || !connected || playback} aria-pressed={state.recording} title={playback ? "Recording is not available during playback" : undefined}>
          <Circle size={10} fill={state.recording ? "currentColor" : "none"} /> REC
        </button>
        <button className="cb" onClick={() => control("calibrate")} disabled={busy || !connected || playback || !ctx.operation?.modeledRxActive} title="Check the current modeled RX envelope floor">
          <Crosshair size={12} /> RX CHECK
        </button>
        <span className="cdiv" />
        <button className="cb" onClick={save} disabled={!connected || playback} title={playback ? "Nothing new to save during playback" : "Save session to AquaSDR/data"}>
          <Save size={12} /> SAVE
        </button>
        <button className="cb" onClick={exportSession} disabled={playback} title={playback ? "Nothing new to export during playback" : "Download session JSON"}>
          <Download size={12} /> EXPORT
        </button>
      </div>
    </footer>
  );
}

export function PulseFacts({ ctx }) {
  const { cfg, c, current } = ctx;
  const cc = c || 1500;
  const B = isCode(cfg) ? 13 / (cfg.pulse / 1000) : cfg.bandwidth * 1000;
  const T = cfg.pulse / 1000;
  const facts = [
    ["Time–bandwidth product", (B * T).toFixed(1), "B·T"],
    ["Range resolution", (rangeRes(cfg, cc) * 100).toFixed(1), "cm · c/2B"],
    ["Pulse length in water", (cc * T).toFixed(2), "m · c·T"],
    ["Carrier cycles", Math.round(T * cfg.frequency * 1000), "cycles"],
    [`Samples at ${fmt((current?.sampleRate || SAMPLE_RATE) / 1000, 0)} kS/s`, current?.acoustic?.txSamples || Math.round(T * (current?.sampleRate || SAMPLE_RATE)), "samples"],
    ["Sound speed used", cc.toFixed(0), c ? "m/s · estimate" : "m/s · nominal"],
  ];
  return (
    <section className="facts panel">
      <Label right={<Src kind="computed" />}>PULSE GEOMETRY</Label>
      <dl>
        {facts.map(([k, v, u]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">
              {v} <u>{u}</u>
            </dd>
          </div>
        ))}
      </dl>
      <p className="fine">Derived from the commanded waveform — theory, not a measurement.</p>
    </section>
  );
}
