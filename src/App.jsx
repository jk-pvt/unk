import React, { useEffect, useMemo, useRef, useState } from "react";
import logo from "./assets/aquasdr-logo.png";
import { Bell, Check, ChevronDown, CircleHelp, Settings2, X } from "lucide-react";
import { WaveScope } from "./Charts.jsx";
import { DEFAULT_CONFIG, WINDOWS, soundSpeed } from "../shared/signal.js";
import { Dot, clock, stamp } from "./ui/kit.jsx";
import { StatusStrip, WaveformModes } from "./pages/blocks.jsx";
import { Adaptation, Hardware, Logs, Mapping, Mission, Power, Sensors, Sonar, Validation } from "./pages/pages.jsx";
import { Welcome } from "./ui/Welcome.jsx";
import { operationalState, signalState } from "../shared/operational-state.js";
import { estimateOperatingPower } from "../shared/power.js";
import {displayReference} from '../shared/reference-selection.js';

const NAV = ["Mission", "Sonar", "Adaptation", "Validation", "Sensors", "Power", "Mapping", "Hardware", "Logs"];
const ENTRY_KEY = "aquasdr.console.entered.v1";
const WORKSPACE_KEY = "aquasdr.console.workspace.v1";
function tabValue(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function rememberTab(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* Storage may be disabled. */ }
}
const WORKSPACE_NOTES = {
  Sonar: 'Echo history and transmit waveform',
  Adaptation: 'From water conditions to waveform decisions',
  Validation: 'Waveform reference analysis and instrument results',
  Sensors: 'Environmental readings over the last 60 seconds',
  Power: 'Battery health and energy consumption',
  Mapping: 'Survey coverage and spatial measurements',
  Hardware: 'Payload components and connection',
  Logs: 'Events from the current session',
};
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
  playback: null,
};

function findPeaks(echo, rangeMax) {
  if (!echo?.length) return [];
  const n = echo.length,
    floor = [...echo].sort((a, b) => a - b)[Math.floor(n * 0.5)];
  const found = [];
  for (let i = 2; i < n - 2; i++) {
    const r = (i / (n - 1)) * rangeMax;
    if (r < rangeMax * 0.06) continue;
    const v = echo[i];
    if (v > floor + 0.15 && v >= echo[i - 1] && v >= echo[i + 1] && v >= echo[i - 2] && v >= echo[i + 2]) found.push({ range: r, value: v });
  }
  found.sort((a, b) => b.value - a.value);
  const keep = [];
  for (const p of found) {
    if (keep.every((k) => Math.abs(k.range - p.range) > rangeMax * 0.08)) keep.push(p);
    if (keep.length === 3) break;
  }
  return keep.sort((a, b) => a.range - b.range);
}

function App() {
  const [welcome, setWelcome] = useState(() => tabValue(ENTRY_KEY) !== "true");
  const [clientId] = useState(() => crypto.randomUUID());
  const [state, setState] = useState(initial),
    [connected, setConnected] = useState(false),
    [page, setPage] = useState(() => {
      const saved = tabValue(WORKSPACE_KEY);
      return tabValue(ENTRY_KEY) === "true" && NAV.includes(saved) ? saved : "Mission";
    }),
    [toast, setToast] = useState(""),
    [dialog, setDialog] = useState(null),
    [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState(false),
    [gain, setGain] = useState(1),
    [range, setRange] = useState(3),
    [sonarView, setSonarView] = useState("echogram"),
    [waveView, setWaveView] = useState("time");
  const [draft, setDraft] = useState(DEFAULT_CONFIG),
    [dirty, setDirty] = useState(false),
    [ports, setPorts] = useState([]),
    [selectedPort, setSelectedPort] = useState(""),
    [logFilter, setLogFilter] = useState("all"),
    [jury, setJury] = useState(false);
  const [sessions, setSessions] = useState([]),
    [sessionsError, setSessionsError] = useState("");
  const socketRef = useRef(null),
    lastSeen = useRef(0);
  const prevRef = useRef({ key: "", session: "", cfg: null, cur: null, at: null });

  useEffect(() => {
    if (!welcome) rememberTab(WORKSPACE_KEY, page);
  }, [page, welcome]);

  /* ---------- telemetry socket (unchanged contract) ---------- */
  useEffect(() => {
    let disposed = false,
      retry;
    const connect = () => {
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/telemetry`);
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
    const heartbeat = setInterval(() => {
      if(document.visibilityState === "visible" && socketRef.current?.readyState === WebSocket.OPEN)
        socketRef.current.send(JSON.stringify({type:"controlHeartbeat",client:clientId}));
    }, 500);
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
      clearInterval(heartbeat);
      socketRef.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!dirty) setDraft(state.config);
  }, [state.config.mode, state.config.frequency, state.config.bandwidth, state.config.pulse, state.config.amplitude, dirty]);
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
        const nodes = [...el.querySelectorAll('button,input,select,[tabindex="0"]')].filter((n) => !n.disabled);
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
  // Keyboard: 1–9 switch workspace (outside inputs and dialogs)
  useEffect(() => {
    const onKey = (e) => {
      if (welcome || dialog || document.querySelector("dialog[open]") || e.metaKey || e.ctrlKey || e.altKey || /input|select|textarea/i.test(e.target.tagName)) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < NAV.length) setPage(NAV[i]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, welcome]);

  // Remember the previous waveform within a session → before/after in the adaptation engine.
  const cfgKey = JSON.stringify(state.config) + state.sessionId;
  if (prevRef.current.key !== cfgKey) {
    const p = prevRef.current;
    const same = p.cur && p.session === state.sessionId;
    prevRef.current = { key: cfgKey, session: state.sessionId, cfg: same ? p.cur : null, cur: state.config, at: same ? Date.now() : null };
  }

  const api = async (path, body) => {
    setBusy(true);
    try {
      const r = await fetch("/api/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({...(body || {}), client:clientId}) });
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
  const control = (action, extra) => api("control", { action, ...extra });
  const source = !connected ? "UNAVAILABLE" : state.mode === "demo" ? "DEMO" : state.mode === "playback" ? "PLAYBACK" : state.current ? "LIVE" : "UNAVAILABLE";
  const current = connected ? state.current : null,
    demo = state.mode === "demo",
    playback = state.mode === "playback";
  const signal = signalState(current);
  const preview=connected?displayReference(signal,state.referencePreview,state.config):null;
  const operation = connected ? state.operational || operationalState({...state,current})
    : {connection:'BRIDGE OFFLINE',target:state.operational?.target,commandReady:false,adcAvailable:false};
  const rawSensors = current?.sensors || {};
  const turbiditySpoofed = false;
  const sensors = rawSensors;
  const history = state.history || [];
  const measuredPower = current?.power || {};
  const hasMeasuredPower = [measuredPower.voltage, measuredPower.current, measuredPower.watts,measuredPower.soc].some(Number.isFinite);
  const powerEstimate=current?.powerEstimate || (playback ? {} : estimateOperatingPower(signal?.waveform,signal?.control?.outputEnabled));
  const power = hasMeasuredPower ? measuredPower : current?.batteryScenario || powerEstimate;
  const powerScenario=!hasMeasuredPower && power.source==='scenario';
  const acousticModel = !current?.samples && !current?.echo && !!preview?.rx;
  const maxRange = current?.samples || current?.echo ? current?.rangeMax || 3 : preview?.rx?.rangeMax || 3;
  useEffect(() => {
    setRange(maxRange);
  }, [maxRange, state.mode]);
  const peaks = useMemo(
    () => current?.samples || current?.echo ? (current?.detections?.length ? current.detections : findPeaks(current?.echo, maxRange)) : preview?.rx?.detections || [],
    [preview?.rx, current?.samples, current?.detections, current?.echo, maxRange],
  );
  const c = preview?.rx?.acoustic?.soundSpeed || soundSpeed(sensors.temperature, sensors.conductivity, sensors.depth);
  const setMode = async (mode, extra) => {
    const result = await api("mode", { mode, ...extra });
    if (result) {
      setDirty(false);
      setFrozen(false);
    }
    return result;
  };
  const openHardware = async () => {
    setPage("Hardware");
    try {
      const r = await fetch("/api/ports");
      const list = await r.json();
      if (!r.ok) throw new Error(list.error);
      setPorts(list);
      setSelectedPort(list.some((p) => p.path === selectedPort) ? selectedPort : "");
    } catch (e) {
      setToast(e.message);
    }
  };
  const openPlayback = async () => {
    setDialog("playback");
    setSessionsError("");
    try {
      const r = await fetch("/api/sessions");
      const list = await r.json();
      if (!r.ok) throw new Error(list.error);
      setSessions(list);
    } catch (e) {
      setSessionsError(e.message || "Could not load saved sessions");
    }
  };
  const loadPlayback = async (id) => {
    if (await setMode("playback", { sessionId: id })) {
      setDialog(null);
      setToast("Playback loaded · press START to replay");
    }
  };
  const scrub = (index) => api("control", { action: "scrub", index });
  const apply = async () => {
    if (await api("waveform", draft)) {
      setDirty(false);
      setToast("Digital waveform applied · manual control");
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
  const openWaveform = () => setPage("Adaptation");
  const go = (p) => (p === "Hardware" ? openHardware() : setPage(p));

  const ctx = {
    state, connected, current, signal, preview, operation, demo, playback, source, history, sensors, turbiditySpoofed, power,
    powerModeled: !hasMeasuredPower, powerScenario, acousticModel, cfg: preview?.config || signal?.waveform || signal?.requestedWaveform || state.config,
    prev: prevRef.current, c, peaks, busy, control, api, save, exportSession, openWaveform, setPage: go,
    frozen, setFrozen, gain, setGain, range, setRange, maxRange, sonarView, setSonarView, waveView, setWaveView,
    ports, selectedPort, setSelectedPort, setMode, openHardware, openPlayback, scrub, logFilter, setLogFilter,
  };
  const View = { Mission, Sonar, Adaptation, Validation, Sensors, Power, Mapping, Hardware, Logs }[page];
  const srcTone = source === "DEMO" ? "amber" : source === "PLAYBACK" ? "accent" : source === "LIVE" ? "ok" : "red";
  const warnings = state.events.some((e) => e.kind === "warning");
  async function welcomeRequest(path, body) {
    const response = await fetch('/api/' + path, {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...body,client:clientId}),signal:AbortSignal.timeout(10000)});
    let data;
    try { data = await response.json(); } catch { throw new Error('The AquaSDR backend is unavailable. Please try again.'); }
    if (!response.ok) throw new Error(data.error || 'Unable to open the console.');
    if (data.type !== 'state') throw new Error('The console returned an unexpected response.');
    setState(data);
    return data;
  }
  function enterConsole(nextPage) {
    rememberTab(ENTRY_KEY, "true");
    setDirty(false); setFrozen(false); setPage(nextPage); setWelcome(false);
  }

  return (
    <div className={"app" + (jury ? " jury" : "")}>
      <header className="top">
        <div className="top-in">
          <button className="brand" onClick={() => setPage("Mission")} aria-label="AQUASDR mission">
            <img className="brand-logo" src={logo} width="28" height="28" alt="" aria-hidden="true" />
            <span className="bn">AQUASDR</span>
          </button>
          <nav className="tnav" aria-label="Workspaces">
            {NAV.map((n, i) => (
              <button key={n} className={page === n ? "on" : ""} aria-current={page === n ? "page" : undefined} onClick={() => go(n)} title={`${n} (${i + 1})`}>
                {n}
              </button>
            ))}
          </nav>
          <label className="tnav-compact">
            <span className="tnav-current">{page}</span>
            <ChevronDown size={14} strokeWidth={1.6} aria-hidden="true" />
            <select aria-label="Workspace" value={page} onChange={(e) => go(e.target.value)}>
              {NAV.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="tstat">
            {!connected && (
              <span className="ts offline">
                <b className="red"><Dot tone="red" /> OFFLINE</b>
              </span>
            )}
            <label className={"ts data " + srcTone} title="Data source — click to switch">
              <b>
                <Dot tone={srcTone} />
                {source === "DEMO" ? "REFERENCE ENGINE" : source === "PLAYBACK" ? "PLAYBACK · RECORDED" : source === "LIVE" ? "LIVE · STM32" : "NO DATA"}
              </b>
              <select
                aria-label="Data source"
                value={state.mode}
                onChange={(e) => (e.target.value === "playback" ? openPlayback() : setMode(e.target.value))}
                disabled={busy}
              >
                <option value="demo">Reference workspace — C engine</option>
                <option value="hardware">Hardware — STM32</option>
                <option value="playback">Playback — recorded session</option>
              </select>
            </label>
            <span className="ts clock" title="Mission elapsed time">
              <b className="mono">{clock(state.elapsed)}</b>
            </span>
            {state.recording && (
              <span className="ts rec on">
                <b><Dot tone="red" pulse /> REC</b>
              </span>
            )}
            <span className="tdiv" aria-hidden="true" />
            <div className="ticons">
              <button className="ibtn" aria-label="Alerts" title="Alerts" onClick={() => { setLogFilter("warning"); setPage("Logs"); }}>
                <Bell size={15} strokeWidth={1.6} />
                {warnings && <i className="badge" />}
              </button>
              <button className="ibtn" aria-label="Console settings" title="Console settings" onClick={() => setDialog("settings")}>
                <Settings2 size={15} strokeWidth={1.6} />
              </button>
              <button className="ibtn" aria-label="Operator guide" title="Operator guide" onClick={() => setDialog("guide")}>
                <CircleHelp size={15} strokeWidth={1.6} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {jury && (
        <div className="jury-path">
          <span>DEMONSTRATION PATH</span>
          {[
            ["01 Environment", () => setPage("Mission")],
            ["02 Turbidity rise", () => control("scenario")],
            ["03 Adaptation", () => setPage("Adaptation")],
            ["04 Waveform", () => setPage("Sonar")],
            ["05 Validation", () => setPage("Validation")],
            ["06 Power", () => setPage("Power")],
          ].map(([l, f]) => (
            <button key={l} onClick={f}>
              {l}
            </button>
          ))}
        </div>
      )}

      <main key={page} className={"view v-" + page.toLowerCase()}>
        {page !== "Mission" && <header className="workspace-heading"><div><h1>{page}</h1><p>{WORKSPACE_NOTES[page]}</p></div><span>AQUASDR / 01</span></header>}
        {welcome ? <div className="welcome-waiting" aria-hidden="true"><span>AQUASDR</span><p>Your mission starts here.</p></div> : <View ctx={ctx} />}
      </main>

      <StatusStrip ctx={ctx} />

      {welcome && <Welcome connected={connected} hardware={state.hardware}
        onDemo={async () => {
          const result = await welcomeRequest('mode',{mode:'demo'});
          if (result.transmitter?.error) throw new Error(result.transmitter.error);
          enterConsole('Mission');
        }}
        onConnect={async (path) => {
          await welcomeRequest('mode',{mode:'hardware'});
          await welcomeRequest('connect',{path});
          enterConsole('Hardware');
        }}
        onExisting={() => enterConsole('Hardware')}/>}

      {toast && (
        <div role="status" className="toast">
          <Check size={14} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast("")}>
            <X size={13} />
          </button>
        </div>
      )}
      {dialog && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <div className="modal-h">
              <h2 id="dialog-title">
                {dialog === "waveform" ? "Transmit waveform" : dialog === "settings" ? "Console settings" : dialog === "session" ? "New session" : dialog === "playback" ? "Load a recorded session" : "Operator guide"}
              </h2>
              <button className="ibtn" onClick={() => setDialog(null)} aria-label="Close dialog">
                <X size={16} />
              </button>
            </div>
            {dialog === "waveform" && (
              <>
                <p className="fine">
                  {current?.adaptation ? "This firmware is controlled by its physical ADC input and board button. The console cannot command the DAC; these controls are a reference preview only." : "Updates the active digital waveform and switches adaptation to MANUAL. This does not command the physical DAC or piezo driver."}
                </p>
                <label className="field">
                  <span>TYPE</span>
                  <select value={draft.mode} onChange={(e) => { setDraft({ ...draft, mode: e.target.value }); setDirty(true); }}>
                    {["LFM CHIRP", "GEOMETRIC SWEEP", "PHASE-CODED PULSE"].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>WINDOW</span>
                  <select value={draft.window || "HANN"} onChange={(e) => { setDraft({ ...draft, window: e.target.value }); setDirty(true); }}>
                    {Object.entries(WINDOWS).map(([w, { sidelobe }]) => (
                      <option key={w} value={w}>{w} · sidelobes {sidelobe} dB</option>
                    ))}
                  </select>
                </label>
                <WaveformModes active={draft.mode} />
                {[
                  ["frequency", "CENTER", "kHz", 20, 350, 0.5],
                  ["bandwidth", "BANDWIDTH", "kHz", 0.5, 100, 0.1],
                  ["pulse", "PULSE", "ms", 1, 20, 0.5],
                  ["amplitude", "AMPLITUDE", "%", 0, 100, 1],
                ].map(([key, label, unit, min, max, step]) => {
                  const off = key === "bandwidth" && draft.mode === "PHASE-CODED PULSE";
                  return (
                    <div className="param" key={key}>
                      <label htmlFor={"in-" + key}>{label}</label>
                      <input aria-label={label + " slider"} disabled={off} type="range" min={min} max={max} step={step} value={draft[key]} onChange={(e) => { setDraft({ ...draft, [key]: +e.target.value }); setDirty(true); }} />
                      <span className="pv">
                        <input id={"in-" + key} type="number" disabled={off} min={min} max={max} step={step} value={draft[key]} onChange={(e) => { setDraft({ ...draft, [key]: Number(e.target.value) }); setDirty(true); }} />
                        <u>{unit}</u>
                      </span>
                    </div>
                  );
                })}
                {draft.mode === "PHASE-CODED PULSE" && <p className="fine">Barker-13 chip rate follows pulse duration; sweep bandwidth is not used.</p>}
                <div className="modal-plot">
                  <WaveScope config={draft} view="time" running={false} />
                </div>
                <div className="modal-f">
                  <button className="tbtn" onClick={() => { setDraft(DEFAULT_CONFIG); setDirty(true); }}>
                    Reset defaults
                  </button>
                  <button className="tbtn primary" disabled={busy || playback || !!current?.adaptation} onClick={apply}>
                    Apply waveform
                  </button>
                </div>
              </>
            )}
            {dialog === "settings" && (
              <>
                <div className="setting">
                  <div>
                    <b>Jury presentation path</b>
                    <p className="fine">Shows a one-line walkthrough: environment → turbidity rise → adaptation → waveform → validation → power.</p>
                  </div>
                  <button role="switch" aria-checked={jury} aria-label="Jury presentation path" className={"switch" + (jury ? " on" : "")} onClick={() => setJury(!jury)}>
                    <span />
                  </button>
                </div>
                <div className="setting">
                  <div>
                    <b>Echogram display gain</b>
                    <p className="fine">Colour mapping only — does not change transmit amplitude.</p>
                  </div>
                  <select aria-label="Display gain" value={gain} onChange={(e) => setGain(+e.target.value)}>
                    {[0.5, 1, 1.5, 2].map((n) => (
                      <option key={n} value={n}>
                        {n}×
                      </option>
                    ))}
                  </select>
                </div>
                <div className="setting">
                  <div>
                    <b>New session</b>
                    <p className="fine">Saves the current session to AquaSDR/data, then starts paused with the default waveform.</p>
                  </div>
                  <button className="tbtn" onClick={() => setDialog("session")}>
                    New session…
                  </button>
                </div>
                <p className="fine mono">Bridge 127.0.0.1:4318 · sessions in AquaSDR/data · console never commands hardware</p>
              </>
            )}
            {dialog === "session" && (
              <>
                <p className="fine">The current session is saved locally first. The new session starts paused with the default waveform.</p>
                <div className="modal-f">
                  <button className="tbtn" onClick={() => setDialog(null)}>
                    Cancel
                  </button>
                  <button
                    className="tbtn primary"
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
                    Save & start new
                  </button>
                </div>
              </>
            )}
            {dialog === "playback" && (
              <>
                <p className="fine">Replays a session recorded earlier — every value is exactly what that session captured, in whichever mode (demo or hardware) it was recorded. Nothing is regenerated or reinterpreted.</p>
                {sessionsError && <p className="err">{sessionsError}</p>}
                {!sessionsError && !sessions.length && <p className="fine">No saved sessions yet. Sessions are written to AquaSDR/data when you SAVE, switch data source, or start a new session.</p>}
                {sessions.map((s) => (
                  <div className="setting" key={s.id}>
                    <div>
                      <b className="mono">{s.id.slice(0, 8)}</b>
                      <p className="fine">
                        {s.savedAt ? stamp(s.savedAt) : "unknown time"} · recorded {s.mode} · {s.samples} samples · {clock(s.elapsed || 0)}
                      </p>
                    </div>
                    <button className="tbtn primary" disabled={busy || !s.samples} onClick={() => loadPlayback(s.id)}>
                      Load
                    </button>
                  </div>
                ))}
              </>
            )}
            {dialog === "guide" && (
              <div className="guide">
                <ol>
                  <li><b>Read the mission.</b> The sonar scene is the large surface; the payload and its environment float over the oldest echo history; the adaptation engine is on the right; power, transmit waveform and the mission log sit underneath; payload health and controls run along the bottom.</li>
                  <li><b>Show adaptation.</b> Press <em>Simulate turbidity rise</em>. Turbidity ramps over ~6 s; above 30 NTU the policy lengthens the pulse and narrows the sweep, the output table animates old → new, WHY explains it, and the echogram visibly loses range resolution. Clearing the scenario releases the policy below 27 NTU.</li>
                  <li><b>Check the data source.</b> TX references come from the shared waveform engine. Acoustic previews are synthetic returns; instrument captures and sensor readings remain separate. Playback replays a saved session — pick one from the data-source menu.</li>
                  <li><b>Record.</b> REC, then SAVE or EXPORT in the bottom strip. Keys 1–9 switch workspaces.</li>
                </ol>
                <p className="fine">Hardware mode is read-only: the bridge monitors telemetry and never energises the transducer. Protocol: README.md.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
export default App;
