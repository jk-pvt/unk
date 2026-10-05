import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  Bell,
  Cable,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Download,
  Expand,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  List,
  Map,
  Pause,
  Play,
  Plus,
  Radio,
  ScanLine,
  Settings2,
  SlidersHorizontal,
  Square,
  Thermometer,
  Waves,
  X,
  Zap,
  ArrowUpRight,
  Check,
  RotateCcw,
  Save,
  Circle,
  Focus,
  WifiOff,
} from "lucide-react";
import {
  CanvasPlot,
  SignalChart,
  SonarCanvas,
  Spectrogram,
  Trend,
} from "./Charts.jsx";
import {
  DEFAULT_CONFIG,
  generateSignal,
  estimateSignal,
} from "../shared/signal.js";
const NAV = [
  ["Mission", LayoutDashboard],
  ["Sonar", ScanLine],
  ["Adaptation", Activity],
  ["Validation", FlaskConical],
  ["Sensors", Thermometer],
  ["Power", Zap],
  ["Mapping", Map],
  ["Hardware", Cable],
  ["Logs", List],
];
const SENSORS = [
  ["temperature", "Temperature", "°C", "Temperature sensor"],
  ["turbidity", "Turbidity", "NTU", "Optical sensor"],
  ["pressure", "Pressure", "bar", "Pressure sensor"],
  ["depth", "Depth", "m", "Depth estimate"],
  ["conductivity", "Conductivity", "mS/cm", "Conductivity sensor"],
];
const initial = {
  mode: "demo",
  running: false,
  recording: false,
  adaptive: true,
  scenario: false,
  elapsed: 0,
  config: DEFAULT_CONFIG,
  sessionId: "",
  seq: 0,
  current: null,
  history: [],
  events: [],
  hardware: {},
};
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const time = (s) =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), Math.floor(s % 60)]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
const stamp = (s) => new Date(s).toLocaleTimeString("en-GB", { hour12: false });
function Tag({ children, tone = "" }) {
  return <span className={"tag " + tone}>{children}</span>;
}
function PanelHead({ icon: Icon, title, children }) {
  return (
    <div className="panel-head">
      <h2>
        {Icon && <Icon size={15} />} {title}
      </h2>
      <div className="head-actions">{children}</div>
    </div>
  );
}
function Empty({
  icon: Icon = WifiOff,
  title = "Signal not available",
  text = "Connect hardware to receive measurements.",
}) {
  return (
    <div className="empty">
      <Icon size={32} strokeWidth={1} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function App() {
  const [state, setState] = useState(initial),
    [connected, setConnected] = useState(false),
    [page, setPage] = useState("Mission"),
    [toast, setToast] = useState(""),
    [dialog, setDialog] = useState(null),
    [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState(false),
    [gain, setGain] = useState(1),
    [range, setRange] = useState(80),
    [view, setView] = useState("Echogram"),
    [signalTab, setSignalTab] = useState("Time domain");
  const [draft, setDraft] = useState(DEFAULT_CONFIG),
    [dirty, setDirty] = useState(false),
    [ports, setPorts] = useState([]),
    [selectedPort, setSelectedPort] = useState(""),
    [logFilter, setLogFilter] = useState("All events"),
    [jury, setJury] = useState(false);
  const socketRef = useRef(null),
    lastSeen = useRef(0);
  useEffect(() => {
    let disposed = false,
      retry;
    const connect = () => {
      const socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/telemetry`,
      );
      socketRef.current = socket;
      socket.onopen = () => {
        setConnected(true);
        lastSeen.current = Date.now();
      };
      socket.onmessage = (e) => {
        lastSeen.current = Date.now();
        try {
          const data = JSON.parse(e.data);
          if (data.type === "state") setState(data);
        } catch {
          setToast("Invalid bridge message");
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!disposed) retry = setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();
    };
    connect();
    const timer = setInterval(() => {
      if (lastSeen.current && Date.now() - lastSeen.current > 5000) {
        setConnected(false);
        socketRef.current?.close();
      }
    }, 1000);
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(timer);
      socketRef.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!dirty) setDraft(state.config);
  }, [
    state.config.mode,
    state.config.frequency,
    state.config.bandwidth,
    state.config.pulse,
    state.config.amplitude,
    dirty,
  ]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement;
    const el = document.querySelector(".modal");
    el?.querySelector("button,input,select")?.focus();
    const key = (e) => {
      if (e.key === "Escape") setDialog(null);
      if (e.key === "Tab") {
        const nodes = [
          ...el.querySelectorAll('button,input,select,[tabindex="0"]'),
        ].filter((n) => !n.disabled);
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [dialog]);
  const api = async (path, body) => {
    setBusy(true);
    try {
      const r = await fetch("/api/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (data.type === "state") setState(data);
      return data;
    } catch (e) {
      setToast(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const control = (action) => api("control", { action });
  const source = !connected
    ? "UNAVAILABLE"
    : state.mode === "demo"
      ? "DEMO"
      : state.current
        ? "LIVE"
        : "UNAVAILABLE";
  const current = connected ? state.current : null,
    demo = state.mode === "demo";
  const history = state.history || [];
  const sensors = current?.sensors || {},
    power = current?.power || {};
  const maxRange = current?.rangeMax || 80;
  useEffect(() => {
    setRange(maxRange);
  }, [maxRange, state.mode]);
  const peakIndex =
    current?.echo?.reduce((best, v, i, a) => (v > a[best] ? i : best), 0) || 0;
  const peakRange = current?.echo
    ? (peakIndex / (current.echo.length - 1)) * maxRange
    : 0;
  const setMode = async (mode) => {
    const result = await api("mode", { mode });
    if (result) {
      setDirty(false);
      setFrozen(false);
    }
  };
  const openHardware = async () => {
    setPage("Hardware");
    try {
      const r = await fetch("/api/ports");
      const list = await r.json();
      if (!r.ok) throw new Error(list.error);
      setPorts(list);
      setSelectedPort(
        list.some((p) => p.path === selectedPort) ? selectedPort : "",
      );
    } catch (e) {
      setToast(e.message);
    }
  };
  const apply = async () => {
    if (await api("waveform", draft)) {
      setDirty(false);
      setToast("Waveform applied · manual control");
      setDialog(null);
    }
  };
  const save = async () => {
    const result = await api("save");
    if (result) setToast(`Session saved · ${result.samples} recorded samples`);
  };
  const exportSession = () => {
    const a = document.createElement("a");
    a.href = "/api/export";
    a.download = "aquasdr-session.json";
    a.click();
  };
  const metric = (key, label, unit, value, subtitle, extra) => (
    <div className="metric" key={key}>
      <div className="metric-top">
        <span>{label}</span>
        {extra || <span className="source-label">{source}</span>}
      </div>
      <div className="metric-value">
        {fmt(value, key === "pressure" ? 2 : 1)}
        <span>{unit}</span>
      </div>
      {subtitle && <div className="metric-sub">{subtitle}</div>}
    </div>
  );
  const environment = (full = false) => (
    <section
      className={"panel environment " + (full ? "full-environment" : "")}
    >
      <PanelHead icon={Thermometer} title="Environment">
        <Tag tone={demo ? "amber" : ""}>{source}</Tag>
      </PanelHead>
      <div className="env-metrics">
        {SENSORS.map(([key, label, unit, sensor]) => (
          <div className="env-row" key={key}>
            <div>
              <span>{label}</span>
              <small>{demo ? "Test bench" : sensor}</small>
            </div>
            <div className="env-reading">
              <strong>{fmt(sensors[key], key === "pressure" ? 2 : 1)}</strong>
              <span>{unit}</span>
            </div>
            {full && <Trend values={history.map((h) => h.sensors?.[key])} />}
          </div>
        ))}
      </div>
      <div className="panel-foot">
        <span className={"status-dot " + (current ? "" : "muted")} />
        {demo
          ? "Simulated environmental inputs"
          : current
            ? "Receiving sensor telemetry"
            : "Awaiting sensor telemetry"}
        <span className="push">
          {demo && current ? "4 Hz" : current ? "LIVE" : "—"}
        </span>
      </div>
    </section>
  );
  const adaptation = () => (
    <section className="panel adaptation">
      <PanelHead icon={Activity} title="Adaptation engine">
        <Tag tone="teal">{demo && state.adaptive ? "AUTO" : "MANUAL"}</Tag>
      </PanelHead>
      <div className="adaptation-body">
        <div className="policy-label">
          <span className="status-dot" />{" "}
          {!demo
            ? "Hardware policy not commissioned"
            : state.scenario
              ? "Turbidity threshold exceeded"
              : "Monitoring environment"}
        </div>
        <h3>
          {!demo
            ? "Awaiting physical validation"
            : state.scenario
              ? "Longer pulse · narrower bandwidth"
              : "Current waveform held steady"}
        </h3>
        <p>
          {!demo
            ? "Demo rules never command physical hardware."
            : state.scenario
              ? "Demonstrator rule applied. Acoustic validation pending."
              : "Demo threshold: turbidity above 30 NTU."}
        </p>
        <div className="decision-flow">
          <span>Environment</span>
          <ChevronRight size={13} />
          <span>Policy</span>
          <ChevronRight size={13} />
          <span className="accent">Waveform</span>
        </div>
        <div className="policy-output">
          <div>
            <span>BANDWIDTH</span>
            <strong>
              {state.config.bandwidth}
              <small> kHz</small>
            </strong>
          </div>
          <ChevronRight size={16} />
          <div>
            <span>PULSE LENGTH</span>
            <strong>
              {state.config.pulse}
              <small> ms</small>
            </strong>
          </div>
        </div>
        <button className="text-button" onClick={() => setPage("Adaptation")}>
          Inspect decision policy <ArrowUpRight size={14} />
        </button>
      </div>
    </section>
  );
  const powerPanel = () => (
    <section className="panel power-panel">
      <PanelHead icon={Zap} title="Power & efficiency">
        <Tag tone={demo ? "amber" : ""}>{source}</Tag>
      </PanelHead>
      <div className="power-main">
        <div>
          <span className="eyebrow">INSTANTANEOUS POWER</span>
          <div className="big-reading">
            {fmt(power.watts, 2)} <span>W</span>
          </div>
        </div>
        <div className="power-trend">
          <Trend values={history.map((h) => h.power?.watts)} />
          <small>Last 60 s</small>
        </div>
      </div>
      <div className="power-stats">
        <div>
          <span>Voltage</span>
          <strong>
            {fmt(power.voltage, 2)} <small>V</small>
          </strong>
        </div>
        <div>
          <span>Current</span>
          <strong>
            {fmt(power.current, 2)} <small>A</small>
          </strong>
        </div>
        <div>
          <span>Energy</span>
          <strong>
            {fmt(power.energy, 3)} <small>Wh</small>
          </strong>
        </div>
      </div>
      <div className="power-caption">
        <span className="status-dot" />{" "}
        {demo
          ? "Power model responds to waveform settings"
          : "Power monitor telemetry"}
        <button
          aria-label="Open power details"
          onClick={() => setPage("Power")}
        >
          <ArrowUpRight size={15} />
        </button>
      </div>
    </section>
  );
  const eventPanel = (full = false) => (
    <section className={"panel event-panel " + (full ? "full-events" : "")}>
      <PanelHead icon={List} title="Event timeline">
        {full ? (
          <select
            aria-label="Filter events"
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
          >
            {["All events", "adaptation", "waveform", "warning"].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        ) : (
          <button className="text-button" onClick={() => setPage("Logs")}>
            View all <ChevronRight size={13} />
          </button>
        )}
      </PanelHead>
      <div className="events">
        {state.events
          .filter(
            (e) => !full || logFilter === "All events" || e.kind === logFilter,
          )
          .slice(0, full ? 30 : 4)
          .map((e) => (
            <div className={"event " + e.kind} key={e.id}>
              <time>{stamp(e.timestamp)}</time>
              <span className="event-mark" />
              <div>
                {e.message}
                {full && (
                  <small>
                    {e.source.toUpperCase()} · T+{time(e.elapsed)}
                  </small>
                )}
              </div>
            </div>
          ))}
        {!state.events.length && (
          <p className="muted-copy">No session events yet.</p>
        )}
      </div>
      {full && (
        <div className="panel-foot">
          Showing the latest 30 events. Session export includes up to 500.
          <button className="text-button push" onClick={exportSession}>
            Export session <Download size={14} />
          </button>
        </div>
      )}
    </section>
  );
  const waveformPanel = (full = false) => (
    <section
      className={"panel waveform-panel " + (full ? "expanded-waveform" : "")}
    >
      <PanelHead icon={AudioLines} title="Transmit waveform">
        <Tag>TARGET</Tag>
        <button
          className="icon-button"
          aria-label="Configure waveform"
          onClick={() => {
            setDraft(state.config);
            setDirty(false);
            setDialog("waveform");
          }}
        >
          <SlidersHorizontal size={15} />
        </button>
      </PanelHead>
      <div className="waveform-top">
        <strong>{state.config.mode}</strong>
        <div className="mini-tabs">
          {["Time domain", "FFT"].map((t) => (
            <button
              key={t}
              className={signalTab === t ? "active" : ""}
              onClick={() => setSignalTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <SignalChart
        config={state.config}
        type={signalTab === "FFT" ? "frequency" : "time"}
        large={full}
      />
      <div className="chart-axis">
        <span>{signalTab === "FFT" ? "0 kHz" : "0 ms"}</span>
        <span>{signalTab === "FFT" ? "200 kHz" : "NORMALIZED AMPLITUDE"}</span>
        <span>
          {signalTab === "FFT" ? "400 kHz" : full ? "0.60 ms" : "0.23 ms"}
        </span>
      </div>
      <div className="waveform-values">
        <div>
          <span>FREQUENCY</span>
          <strong>
            {state.config.frequency}
            <small> kHz</small>
          </strong>
        </div>
        <div>
          <span>
            {state.config.mode === "PHASE-CODED PULSE"
              ? "CHIP RATE"
              : "BANDWIDTH"}
          </span>
          <strong>
            {state.config.mode === "PHASE-CODED PULSE"
              ? fmt(13 / state.config.pulse, 2)
              : state.config.bandwidth}
            <small>
              {state.config.mode === "PHASE-CODED PULSE" ? " kchip/s" : " kHz"}
            </small>
          </strong>
        </div>
        <div>
          <span>PULSE</span>
          <strong>
            {state.config.pulse}
            <small> ms</small>
          </strong>
        </div>
        <div>
          <span>AMPLITUDE</span>
          <strong>
            {state.config.amplitude}
            <small> %</small>
          </strong>
        </div>
      </div>
    </section>
  );
  const sonarPanel = () => (
    <section
      className={
        "panel sonar-panel " + (page === "Sonar" ? "sonar-expanded" : "")
      }
    >
      <PanelHead icon={ScanLine} title="Sonar monitor">
        <span className="stream-status">
          <span
            className={
              "status-dot " + (!state.running || frozen ? "muted" : "")
            }
          />
          {!current
            ? "NO SIGNAL"
            : frozen
              ? "FROZEN"
              : !state.running
                ? "PAUSED"
                : "STREAMING"}
        </span>
        <Tag tone={demo ? "amber" : ""}>
          {view === "Spectrogram" ? "TARGET" : source}
        </Tag>
        <button
          className="icon-button"
          aria-label={page === "Sonar" ? "Return to mission" : "Expand sonar"}
          onClick={() => setPage(page === "Sonar" ? "Mission" : "Sonar")}
        >
          <Expand size={15} />
        </button>
      </PanelHead>
      <div className="sonar-toolbar">
        <div className="segmented">
          {["Echogram", "Spectrum", "Spectrogram"].map((t) => (
            <button
              key={t}
              className={view === t ? "selected" : ""}
              onClick={() => setView(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="sonar-tools">
          <label>
            Range{" "}
            <select
              aria-label="Sonar range"
              value={range}
              onChange={(e) => setRange(+e.target.value)}
            >
              {[maxRange, maxRange * 0.75, maxRange * 0.5].map((r) => (
                <option key={r} value={r}>
                  {r} m
                </option>
              ))}
            </select>
          </label>
          <button
            className={"icon-button " + (frozen ? "active" : "")}
            onClick={() => setFrozen(!frozen)}
            aria-label={
              frozen ? "Resume sonar display" : "Freeze sonar display"
            }
          >
            {frozen ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </div>
      </div>
      <div className="sonar-stage">
        <div className="vertical-axis">
          {(view === "Echogram"
            ? [0, 0.25, 0.5, 0.75, 1]
            : view === "Spectrum"
              ? [0, -25, -50, -75, -100]
              : [500, 375, 250, 125, 0]
          ).map((v, i) => (
            <span key={i}>
              {view === "Echogram" ? Math.round(v * range) : v}
            </span>
          ))}
          <small>
            {view === "Echogram"
              ? "RANGE / m"
              : view === "Spectrum"
                ? "LEVEL / dBFS"
                : "FREQ / kHz"}
          </small>
        </div>
        <div className="sonar-image">
          {view === "Echogram" ? (
            <SonarCanvas
              state={{ ...state, current }}
              frozen={frozen}
              gain={gain}
              range={range}
            />
          ) : view === "Spectrum" ? (
            <SignalChart
              config={state.config}
              type="frequency"
              samples={!demo ? current?.samples : undefined}
              sampleRate={current?.sampleRate}
              large
            />
          ) : (
            <Spectrogram config={state.config} />
          )}
          <div className="sonar-overlay-top">
            <span>
              {view === "Echogram"
                ? "ECHO INTENSITY"
                : view === "Spectrum"
                  ? "HANN-WINDOWED FFT"
                  : "SHORT-TIME FOURIER TRANSFORM"}
            </span>
            <span>
              {demo
                ? "SYNTHETIC TEST FIXTURE"
                : view === "Spectrogram"
                  ? "TARGET SIGNAL"
                  : "RX CHANNEL 01"}
            </span>
          </div>
          {view === "Echogram" && current && (
            <>
              <div
                className="echo-label"
                style={{
                  top:
                    Math.min(88, Math.max(10, (peakRange / range) * 100)) + "%",
                  visibility: peakRange > range ? "hidden" : "visible",
                }}
              >
                {" "}
                <span className="crosshair">+</span>
                <div>
                  {demo ? "SIMULATED RETURN" : "RECEIVE INTENSITY"}
                  <small>
                    {demo
                      ? "Reference reflector · variable range"
                      : "Unclassified acoustic return"}
                  </small>
                </div>
              </div>
              <div className="sonar-overlay-bottom">
                <span>
                  {state.config.mode} · {state.config.frequency} kHz
                </span>
                <span>DISPLAY GAIN {gain.toFixed(1)}×</span>
              </div>
            </>
          )}
          {view !== "Spectrogram" &&
            (!current ||
              (!demo &&
                !(view === "Echogram" ? current.echo : current.samples))) && (
              <div className="no-signal">
                <Empty
                  title={
                    connected ? "Signal not available" : "Bridge disconnected"
                  }
                  text={
                    demo
                      ? "Waiting for the demo stream."
                      : "Awaiting raw acoustic measurements from hardware."
                  }
                />
              </div>
            )}
        </div>
        <div className="intensity-scale">
          <span>1.0</span>
          <div />
          <span>0.0</span>
        </div>
      </div>
      <div className="sonar-time-axis">
        <span>{view === "Echogram" ? (demo ? "−60 s" : "OLDER") : "0"}</span>
        <span>
          {view === "Echogram"
            ? demo
              ? "−45 s"
              : "PACKET HISTORY"
            : view === "Spectrum"
              ? "FREQUENCY"
              : "TIME"}
        </span>
        <span>{view === "Echogram" && demo ? "−30 s" : ""}</span>
        <span>{view === "Echogram" && demo ? "−15 s" : ""}</span>
        <span>
          {view === "Echogram"
            ? "NOW"
            : view === "Spectrum"
              ? "400 kHz"
              : `${state.config.pulse} ms`}
        </span>
      </div>
      <div className="sonar-summary">
        <div>
          <span className="status-dot" />
          {view === "Spectrogram"
            ? "TARGET WAVEFORM"
            : demo
              ? "SIMULATED ACOUSTIC RETURNS"
              : "HARDWARE RECEIVE STREAM"}
        </div>
        <label>
          Gain
          <input
            aria-label="Display gain"
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={gain}
            onChange={(e) => setGain(+e.target.value)}
          />
        </label>
        <span>
          {view === "Echogram"
            ? "NORMALIZED INTENSITY"
            : !demo && view === "Spectrum"
              ? "RECEIVED SIGNAL ANALYSIS"
              : "GENERATED SIGNAL ANALYSIS"}
        </span>
      </div>
    </section>
  );
  const validation = () => (
    <>
      <div className="validation-banner">
        <FlaskConical size={22} />
        <div>
          <h3>Physical output validation</h3>
          <p>Compare commanded parameters with instrument measurements.</p>
        </div>
        <Tag tone="amber">
          {Object.values(current?.validation || {}).some(Number.isFinite)
            ? "MEASUREMENTS RECEIVED"
            : "OSCILLOSCOPE NOT CONNECTED"}
        </Tag>
      </div>
      <section className="panel">
        <PanelHead title="Target → measured output">
          <Tag>ANALOG OUTPUT</Tag>
        </PanelHead>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PARAMETER</th>
                <th>TARGET</th>
                <th>MEASURED</th>
                <th>SOURCE</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Center frequency", "frequency", "kHz"],
                ["Bandwidth", "bandwidth", "kHz"],
                ["Pulse duration", "pulse", "ms"],
                ["Amplitude", "amplitude", "%"],
                ["Noise floor", "noiseFloor", "dBFS"],
                ["Sidelobe level", "sidelobe", "dB"],
                ["THD", "thd", "%"],
              ].map(([name, key, unit]) => (
                <tr key={key}>
                  <td>{name}</td>
                  <td>
                    {state.config[key] !== undefined &&
                    !(
                      key === "bandwidth" &&
                      state.config.mode === "PHASE-CODED PULSE"
                    )
                      ? `${state.config[key]} ${unit}`
                      : "—"}
                  </td>
                  <td>
                    {current?.validation?.[key] != null
                      ? `${current.validation[key]} ${unit}`
                      : "—"}
                  </td>
                  <td>
                    <Tag>
                      {current?.validation?.[key] != null
                        ? "MEASURED"
                        : "UNAVAILABLE"}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="two-columns">
        {waveformPanel(true)}
        <section className="panel">
          <PanelHead title="Digital signal analysis">
            <Tag>{demo ? "TARGET" : "MEASURED"}</Tag>
          </PanelHead>
          <DigitalAnalysis
            config={state.config}
            samples={!demo ? current?.samples : undefined}
            available={demo || !!current?.samples}
            sampleRate={current?.sampleRate}
          />
          <p className="panel-note">
            Digital analysis does not verify the DAC, amplifier, transducer, or
            acoustic output.
          </p>
        </section>
      </div>
    </>
  );
  return (
    <div className={"app " + (jury ? "jury-mode" : "")}>
      <aside className="sidebar">
        <button
          className="wordmark"
          onClick={() => setPage("Mission")}
          aria-label="AquaSDR mission home"
        >
          AQUA<span>SDR</span>
        </button>
        <div className="sidebar-label">MISSION CONTROL</div>
        <nav aria-label="Main navigation">
          {NAV.map(([name, Icon]) => (
            <button
              title={name}
              key={name}
              className={page === name ? "active" : ""}
              onClick={() =>
                name === "Hardware" ? openHardware() : setPage(name)
              }
            >
              <Icon size={18} strokeWidth={1.6} />
              <span>{name}</span>
              {page === name && <span className="nav-active" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="payload">
            <span className="eyebrow">ACTIVE PAYLOAD</span>
            <strong>AQUASDR–01</strong>
            <span>
              <span className={"status-dot " + (demo ? "amber" : "muted")} />
              {demo
                ? "Demo environment"
                : state.hardware.fresh
                  ? "Hardware connected"
                  : "No device connected"}
            </span>
          </div>
          <button onClick={() => setDialog("guide")}>
            <CircleHelp size={17} />
            <span>Operator guide</span>
          </button>
          <div className="version">
            PROTOTYPE CONSOLE <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} /> <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <span className="bridge-status">
              <span className={"status-dot " + (!connected ? "red" : "")} />
              {connected ? "Bridge connected" : "Bridge offline"}
            </span>
            <button
              className="icon-button"
              aria-label="View alerts"
              onClick={() => {
                setPage("Logs");
                setLogFilter("warning");
              }}
            >
              <Bell size={17} />
              {state.events.some((e) => e.kind === "warning") && <i />}
            </button>
            <button
              className="icon-button"
              aria-label="Console settings"
              onClick={() => setDialog("settings")}
            >
              <Settings2 size={18} />
            </button>
            <span className="operator-avatar">OP</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                AQUASDR–01 <span className="slash">/</span> UNDERWATER SENSING
              </div>
              <h1>
                {page === "Mission"
                  ? "Mission overview"
                  : page === "Sonar"
                    ? "Acoustic signal workspace"
                    : page === "Mapping"
                      ? "Seabed mapping"
                      : page === "Hardware"
                        ? "Hardware connection"
                        : page === "Logs"
                          ? "Mission event log"
                          : page === "Sensors"
                            ? "Environmental telemetry"
                            : page === "Power"
                              ? "Power & efficiency"
                              : page === "Adaptation"
                                ? "Adaptive waveform policy"
                                : "Physical validation"}
                <span className="heading-dot" />
              </h1>
            </div>
            <div className="heading-actions">
              <button
                className="secondary"
                onClick={() => setDialog("session")}
              >
                <Plus size={15} />
                New session
              </button>
              <button className="secondary" onClick={exportSession}>
                <Download size={15} />
                <span>Export</span>
              </button>
            </div>
          </div>
          <div className="mission-bar">
            <div className="mode-switch">
              <span className={"status-dot " + (demo ? "amber" : "muted")} />
              <select
                aria-label="Data source"
                value={state.mode}
                onChange={(e) => setMode(e.target.value)}
                disabled={busy}
              >
                <option value="demo">DEMO MODE</option>
                <option value="hardware">HARDWARE MODE</option>
              </select>
            </div>
            <span className="mission-source">
              {demo ? "Simulated telemetry" : "Physical telemetry only"}
            </span>
            <div className="mission-time">
              <span>MISSION ELAPSED</span>
              <strong>{time(state.elapsed)}</strong>
            </div>
            <div className="mission-operation">
              <span className="status-dot" />
              {demo && state.adaptive ? "Adaptive policy" : "Manual mode"}
            </div>
            <div className="mission-buttons">
              <button
                className={state.recording ? "recording" : ""}
                onClick={() => control("record")}
                disabled={busy || !connected}
                title="Record session telemetry"
              >
                <Circle
                  size={11}
                  fill={state.recording ? "currentColor" : "none"}
                />
                {state.recording ? "Recording" : "Record"}
              </button>
              <button
                aria-label="Save session"
                title="Save session"
                onClick={save}
                disabled={!connected}
              >
                <Save size={15} />
              </button>
              <button
                className="run-control"
                onClick={() => control(state.running ? "pause" : "start")}
                disabled={busy || !connected}
              >
                {state.running ? <Pause size={13} /> : <Play size={13} />}
                <span>{state.running ? "Pause" : "Start"}</span>
              </button>
              <button
                aria-label="Stop session"
                title="Stop session"
                onClick={() => control("stop")}
                disabled={!connected}
              >
                <Square size={13} />
              </button>
            </div>
          </div>
          {jury && (
            <div className="jury-strip">
              DEMONSTRATION PATH <span>01 Environment</span>
              <ChevronRight size={13} />
              <button onClick={() => setPage("Adaptation")}>
                02 Adaptation
              </button>
              <ChevronRight size={13} />
              <button
                onClick={() => {
                  setDraft(state.config);
                  setDirty(false);
                  setDialog("waveform");
                }}
              >
                03 Waveform
              </button>
              <ChevronRight size={13} />
              <button onClick={() => setPage("Validation")}>
                04 Validation
              </button>
              <ChevronRight size={13} />
              <button onClick={() => setPage("Power")}>05 Power</button>
            </div>
          )}
          {page === "Mission" && (
            <>
              <div className="mission-grid">
                {sonarPanel()}
                <div className="right-stack">
                  {environment()}
                  {adaptation()}
                </div>
              </div>
              <div className="bottom-grid">
                {waveformPanel()}
                {powerPanel()}
                {eventPanel()}
              </div>
            </>
          )}
          {page === "Sonar" && (
            <>
              {sonarPanel()}
              <div className="two-columns">
                {waveformPanel(true)}
                <section className="panel">
                  <PanelHead title="Pulse spectrogram">
                    <Tag>TARGET</Tag>
                  </PanelHead>
                  <Spectrogram config={state.config} />
                  <div className="chart-axis">
                    <span>0 ms</span>
                    <span>0–500 kHz · Hann / 256 samples</span>
                    <span>{state.config.pulse} ms</span>
                  </div>
                </section>
              </div>
            </>
          )}
          {page === "Sensors" && (
            <>
              {environment(true)}
              <div className="sensor-cards">
                {SENSORS.map(([key, label, unit, sensor]) => (
                  <section className="panel sensor-card" key={key}>
                    {metric(
                      key,
                      label,
                      unit,
                      sensors[key],
                      demo ? "Deterministic test bench" : sensor,
                    )}
                    <Trend values={history.map((h) => h.sensors?.[key])} />
                    <div className="panel-foot">
                      {current
                        ? "Current session · last 60 s"
                        : "No measurements received"}
                    </div>
                  </section>
                ))}
              </div>
              <p className="page-note">
                Depth is an estimate in the demo. Sensor models and calibration
                must be supplied by the physical payload.
              </p>
            </>
          )}
          {page === "Power" && (
            <>
              <div className="two-columns">
                {powerPanel()}
                {waveformPanel()}
              </div>
              <section className="panel power-detail">
                <PanelHead title="Power history">
                  <Tag tone={demo ? "amber" : ""}>{source}</Tag>
                </PanelHead>
                <div className="power-history">
                  <Trend values={history.map((h) => h.power?.watts)} />
                </div>
                <div className="chart-axis">
                  <span>−60 s</span>
                  <span>
                    POWER / W ·{" "}
                    {fmt(
                      Math.min(
                        ...history
                          .map((h) => h.power?.watts)
                          .filter(Number.isFinite),
                      ),
                      2,
                    )}
                    –
                    {fmt(
                      Math.max(
                        ...history
                          .map((h) => h.power?.watts)
                          .filter(Number.isFinite),
                      ),
                      2,
                    )}{" "}
                    W
                  </span>
                  <span>NOW</span>
                </div>
                <div className="power-explanation">
                  <div>
                    <span className="eyebrow">WAVEFORM → POWER</span>
                    <h3>
                      {state.config.amplitude}% amplitude · {state.config.pulse}{" "}
                      ms pulse
                    </h3>
                    <p>
                      {demo
                        ? "The test model increases consumption with amplitude squared and pulse length. It is not a physical efficiency measurement."
                        : "Power values come from the connected monitor. Conversion efficiency requires calibrated input and output measurements."}
                    </p>
                    <button
                      className="secondary"
                      onClick={() => {
                        setDraft(state.config);
                        setDirty(false);
                        setDialog("waveform");
                      }}
                    >
                      Configure waveform <SlidersHorizontal size={14} />
                    </button>
                  </div>
                  <div className="efficiency">
                    <span>System efficiency</span>
                    <strong>—</strong>
                    <Tag>UNAVAILABLE</Tag>
                  </div>
                </div>
              </section>
            </>
          )}
          {page === "Adaptation" && (
            <>
              <section className="panel policy-workspace">
                <PanelHead title="Environment → decision → waveform">
                  <Tag tone="amber">DEMO POLICY · UNVALIDATED</Tag>
                </PanelHead>
                <div className="policy-columns">
                  <div>
                    <span className="step-number">01 / INPUT</span>
                    <h3>Environmental conditions</h3>
                    {SENSORS.slice(0, 3).map(([key, label, unit]) => (
                      <div className="policy-line" key={key}>
                        <span>{label}</span>
                        <strong>
                          {fmt(sensors[key])} {unit}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <div>
                    <span className="step-number">02 / DECISION</span>
                    <h3>Turbidity threshold</h3>
                    <div className="rule-code">
                      IF turbidity &gt; 30 NTU
                      <br />
                      THEN waveform = LFM CHIRP
                      <br />
                      bandwidth = 25 kHz
                      <br />
                      AND pulse = 10 ms
                    </div>
                    <p>
                      This is a demonstrator rule, pending acoustic testing and
                      calibration.
                    </p>
                  </div>
                  <div>
                    <span className="step-number">03 / OUTPUT</span>
                    <h3>Waveform configuration</h3>
                    <div className="policy-line">
                      <span>Bandwidth</span>
                      <strong>{state.config.bandwidth} kHz</strong>
                    </div>
                    <div className="policy-line">
                      <span>Pulse length</span>
                      <strong>{state.config.pulse} ms</strong>
                    </div>
                    <div className="policy-line">
                      <span>Controller</span>
                      <Tag>{state.adaptive ? "AUTOMATIC" : "MANUAL"}</Tag>
                    </div>
                  </div>
                </div>
                <div className="policy-controls">
                  <button
                    className="secondary"
                    disabled={!demo || busy}
                    onClick={() => control("adaptive")}
                  >
                    {state.adaptive
                      ? "Use manual control"
                      : "Enable demo policy"}
                  </button>
                  <button
                    className="primary"
                    disabled={!demo || busy}
                    onClick={() => control("scenario")}
                  >
                    {state.scenario ? (
                      <RotateCcw size={15} />
                    ) : (
                      <Plus size={15} />
                    )}{" "}
                    {state.scenario
                      ? "Clear turbidity scenario"
                      : "Simulate turbidity increase"}
                  </button>
                  <span>Changes are logged in the event timeline.</span>
                </div>
              </section>
              <div className="two-columns">
                {waveformPanel(true)}
                {eventPanel(true)}
              </div>
            </>
          )}
          {page === "Validation" && validation()}
          {page === "Mapping" && (
            <section className="panel mapping-panel">
              <PanelHead title="Spatial survey workspace">
                <Tag>FUTURE CAPABILITY</Tag>
              </PanelHead>
              <div className="mapping-empty">
                <Empty
                  icon={Map}
                  title="No survey data"
                  text="Awaiting spatial sonar measurements"
                />
                <div className="mapping-requirements">
                  <span>
                    <Circle size={12} /> Georeferenced acoustic returns
                  </span>
                  <span>
                    <Circle size={12} /> Position and attitude telemetry
                  </span>
                  <span>
                    <Circle size={12} /> Calibrated sound-speed profile
                  </span>
                </div>
              </div>
              <div className="panel-foot">
                Seabed reconstruction is not implemented. No spatial
                measurements are being synthesized.
              </div>
            </section>
          )}
          {page === "Hardware" && (
            <>
              <div className="two-columns">
                <section className="panel hardware-panel">
                  <PanelHead title="STM32 serial bridge">
                    <Tag>
                      {state.hardware.fresh
                        ? "LIVE"
                        : state.hardware.connected
                          ? "AWAITING DATA"
                          : "DISCONNECTED"}
                    </Tag>
                  </PanelHead>
                  <div className="hardware-body">
                    <Cable size={34} strokeWidth={1} />
                    <h3>
                      {state.hardware.connected
                        ? "Serial port open"
                        : "Connect your sonar payload"}
                    </h3>
                    <p>USB serial · 115200 baud · newline-delimited JSON</p>
                    <label>
                      Serial device
                      <select
                        aria-label="Serial device"
                        value={selectedPort}
                        onChange={(e) => setSelectedPort(e.target.value)}
                      >
                        <option value="">Select a device</option>
                        {ports.map((p) => (
                          <option key={p.path} value={p.path}>
                            {p.path}
                            {p.manufacturer ? " · " + p.manufacturer : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="button-row">
                      <button className="secondary" onClick={openHardware}>
                        <RotateCcw size={14} />
                        Refresh ports
                      </button>
                      <button
                        className="primary"
                        disabled={
                          busy || (!selectedPort && !state.hardware.connected)
                        }
                        onClick={async () => {
                          if (state.hardware.connected) await api("disconnect");
                          else {
                            if (demo) await setMode("hardware");
                            await api("connect", { path: selectedPort });
                          }
                        }}
                      >
                        {state.hardware.connected
                          ? "Disconnect"
                          : "Connect device"}
                      </button>
                    </div>
                    {state.hardware.lastError && (
                      <p className="error-copy">{state.hardware.lastError}</p>
                    )}
                  </div>
                </section>
                <section className="panel">
                  <PanelHead title="Connection diagnostics" />
                  <div className="diagnostics">
                    {[
                      ["Firmware", state.hardware.firmware || "Unavailable"],
                      ["Packets received", state.hardware.received || 0],
                      [
                        "Packets dropped / invalid",
                        state.hardware.dropped || 0,
                      ],
                      [
                        "Last valid packet",
                        state.hardware.lastPacket
                          ? stamp(state.hardware.lastPacket)
                          : "Never",
                      ],
                      ["Reconnect attempts", state.hardware.retries || 0],
                      [
                        "Bridge transport",
                        connected ? "WebSocket connected" : "Disconnected",
                      ],
                      [
                        "Telemetry state",
                        state.hardware.fresh ? "Fresh" : "Unavailable / stale",
                      ],
                      ["Raspberry Pi", "Not connected"],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <span>{k}</span>
                        <strong>{v}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              <section className="panel">
                <PanelHead title="Integration readiness" />
                <div className="integration-list">
                  <div>
                    <Tag tone="teal">IMPLEMENTED</Tag>
                    <p>
                      Serial parser, packet validation, WebSocket stream,
                      reconnect, stale-data detection, session storage, and
                      signal analysis.
                    </p>
                  </div>
                  <div>
                    <Tag tone="amber">UNVERIFIED</Tag>
                    <p>
                      STM32 firmware compatibility, sensor calibration, and
                      physical analog output. No hardware has been connected to
                      this build.
                    </p>
                  </div>
                  <div>
                    <Tag>PLANNED</Tag>
                    <p>
                      Hardware transmit commands and calibrated adaptation. This
                      bridge monitors telemetry; hardware configuration remains
                      read-only until commissioned.
                    </p>
                  </div>
                </div>
              </section>
            </>
          )}
          {page === "Logs" && eventPanel(true)}
          <footer className="health-strip">
            <span className="health-title">PAYLOAD HEALTH</span>
            {[
              "STM32",
              "ADC",
              "DAC",
              "DMA",
              "TIMER",
              "SENSORS",
              "USB",
              "TX",
              "RX",
            ].map((key) => (
              <div
                key={key}
                title={key + ": " + (current?.health?.[key] || "Unavailable")}
              >
                <span
                  className={
                    "status-dot " +
                    (demo
                      ? "muted"
                      : /fault|error|offline/i.test(
                            current?.health?.[key] || "",
                          )
                        ? "red"
                        : /ready|active|ok|online/i.test(
                              current?.health?.[key] || "",
                            )
                          ? ""
                          : "muted")
                  }
                />
                <span>{key}</span>
                <strong>{current?.health?.[key] || "—"}</strong>
              </div>
            ))}
            <span className="health-source">
              {demo ? "SIMULATED" : "HARDWARE"}
            </span>
          </footer>
          <div className="bottom-caption">
            <span>AQUASDR / ADAPTIVE SONAR PAYLOAD</span>
            <span>
              {demo
                ? "Demo data is not a physical measurement."
                : "Measurements are supplied by the connected payload."}
            </span>
          </div>
        </main>
      </div>
      {toast && (
        <div role="status" className="toast">
          <Check size={16} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDialog(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <div className="modal-header">
              <h2 id="dialog-title">
                {dialog === "waveform"
                  ? "Configure transmit waveform"
                  : dialog === "settings"
                    ? "Console settings"
                    : dialog === "session"
                      ? "Start a new session"
                      : "Operator guide"}
              </h2>
              <button
                className="icon-button"
                onClick={() => setDialog(null)}
                aria-label="Close dialog"
              >
                <X size={19} />
              </button>
            </div>
            {dialog === "waveform" && (
              <>
                <p className="muted-copy">
                  {demo
                    ? "Apply changes to the demo signal generator. This switches adaptation to manual control."
                    : "Target preview only. Hardware transmit control is not commissioned."}
                </p>
                <label className="form-label">
                  Waveform type
                  <select
                    value={draft.mode}
                    onChange={(e) => {
                      setDraft({ ...draft, mode: e.target.value });
                      setDirty(true);
                    }}
                  >
                    {["LFM CHIRP", "GEOMETRIC SWEEP", "PHASE-CODED PULSE"].map(
                      (m) => (
                        <option key={m}>{m}</option>
                      ),
                    )}
                  </select>
                </label>
                {[
                  ["frequency", "Center frequency", "kHz", 50, 350, 1],
                  ["bandwidth", "Bandwidth", "kHz", 5, 100, 1],
                  ["pulse", "Pulse duration", "ms", 1, 20, 0.5],
                  ["amplitude", "Amplitude", "%", 0, 100, 1],
                ].map(([key, label, unit, min, max, step]) => (
                  <div className="parameter-control" key={key}>
                    <label htmlFor={"input-" + key}>
                      {label}
                      <span>
                        <input
                          id={"input-" + key}
                          aria-label={label}
                          type="number"
                          disabled={
                            key === "bandwidth" &&
                            draft.mode === "PHASE-CODED PULSE"
                          }
                          min={min}
                          max={max}
                          step={step}
                          value={draft[key]}
                          onChange={(e) => {
                            setDraft({
                              ...draft,
                              [key]: Number(e.target.value),
                            });
                            setDirty(true);
                          }}
                        />{" "}
                        {unit}
                      </span>
                    </label>
                    <input
                      aria-label={label + " slider"}
                      disabled={
                        key === "bandwidth" &&
                        draft.mode === "PHASE-CODED PULSE"
                      }
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={draft[key]}
                      onChange={(e) => {
                        setDraft({ ...draft, [key]: +e.target.value });
                        setDirty(true);
                      }}
                    />
                  </div>
                ))}
                {draft.mode === "PHASE-CODED PULSE" && (
                  <p>
                    Barker-13 chip rate follows pulse duration. Sweep bandwidth
                    is not used in this mode.
                  </p>
                )}
                <SignalChart config={draft} />
                <div className="modal-footer">
                  <button
                    className="secondary"
                    onClick={() => {
                      setDraft(DEFAULT_CONFIG);
                      setDirty(true);
                    }}
                  >
                    Reset defaults
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !demo}
                    onClick={apply}
                  >
                    Apply waveform <Check size={15} />
                  </button>
                </div>
              </>
            )}
            {dialog === "settings" && (
              <>
                <div className="setting-row">
                  <div>
                    <strong>Jury presentation mode</strong>
                    <p>Show the environment-to-power demonstration path.</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={jury}
                    aria-label="Jury presentation mode"
                    className={"toggle " + (jury ? "on" : "")}
                    onClick={() => setJury(!jury)}
                  >
                    <span />
                  </button>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Acoustic display gain</strong>
                    <p>
                      Display contrast only. Does not change transmit amplitude.
                    </p>
                  </div>
                  <select
                    aria-label="Default gain"
                    value={gain}
                    onChange={(e) => setGain(+e.target.value)}
                  >
                    {[0.5, 1, 1.5, 2].map((n) => (
                      <option key={n} value={n}>
                        {n}×
                      </option>
                    ))}
                  </select>
                </div>
                <p className="panel-note">
                  Local bridge: 127.0.0.1:4318
                  <br />
                  Session files: AquaSDR/data
                  <br />
                  No physical hardware is controlled by this console.
                </p>
              </>
            )}
            {dialog === "session" && (
              <>
                <p>
                  The current session will be saved locally before a new session
                  is created. New sessions start paused with the default
                  waveform.
                </p>
                <div className="modal-footer">
                  <button className="secondary" onClick={() => setDialog(null)}>
                    Cancel
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={async () => {
                      if (await control("new")) {
                        setDirty(false);
                        setFrozen(false);
                        setDialog(null);
                        setToast("Previous session saved · new session ready");
                      }
                    }}
                  >
                    Save & create session <Plus size={15} />
                  </button>
                </div>
              </>
            )}
            {dialog === "guide" && (
              <div className="guide">
                <p>
                  AQUASDR is an adaptive sonar payload console. This build
                  includes a simulated test bench and a hardware telemetry
                  bridge.
                </p>
                <ol>
                  <li>
                    <strong>Explore the mission.</strong> Echogram intensity is
                    simulated in demo mode. Range and gain affect the display.
                  </li>
                  <li>
                    <strong>Change the signal.</strong> Configure the waveform
                    to update the sampled signal, FFT, and power model.
                  </li>
                  <li>
                    <strong>Show adaptation.</strong> Enable the demo policy and
                    increase turbidity in Adaptation. The timeline explains each
                    change.
                  </li>
                  <li>
                    <strong>Validate the output.</strong> Physical measurements
                    remain unavailable until an instrument reports them.
                  </li>
                  <li>
                    <strong>Capture a session.</strong> Press Record, then Save
                    or Export. New session saves your previous work.
                  </li>
                </ol>
                <p>
                  Mapping and hardware transmit control are future capabilities.
                  The supplied protocol is documented in README.md.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function DigitalAnalysis({ config, samples, available, sampleRate }) {
  const analysis = useMemo(
    () =>
      available
        ? estimateSignal(samples || generateSignal(config), sampleRate)
        : null,
    [
      available,
      samples,
      config.frequency,
      config.bandwidth,
      config.pulse,
      config.amplitude,
      config.mode,
      sampleRate,
    ],
  );
  return (
    <div className="analysis-readings">
      {[
        [
          "FFT peak",
          analysis?.peakFrequency ? analysis.peakFrequency / 1000 : null,
          "kHz",
        ],
        ["Peak magnitude", analysis?.peakDb, "dBFS"],
        ["RMS amplitude", analysis?.rms, "FS"],
        ["Peak amplitude", analysis?.peakAmplitude, "FS"],
      ].map(([label, value, unit]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>
            {fmt(value, 3)} <small>{unit}</small>
          </strong>
        </div>
      ))}
    </div>
  );
}
export default App;
