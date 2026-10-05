import React, { useCallback, useEffect, useState } from "react";
import { Label } from "../ui/kit.jsx";
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");

// Bench evidence: separates CALCULATED (firmware C reference) from MEASURED (oscilloscope captures and meter
// readings typed in by the operator). Nothing here is estimated; an empty slot says AWAITING MEASUREMENT.
const WINDOWS = ["RECT", "HANN", "HAMMING", "BLACKMAN"];
const POINTS = { PA4: "PA4 (DAC pin)", FILTER_OUT: "Filter output (TP2)", OPAMP_OUT: "Op-amp output (TP3)" };
const POWER_STATES = { idle: "Idle (output off)", web_control: "Web control (output off)", waveform_active: "Waveform active (pings on)", pulse_transmit: "Pulse transmit (peak)" };
const PROFILES = ["CLEAR", "TRANSITION", "MURKY"];

function Awaiting({ what }) {
  return <p className="fine bench-await"><b className="mono">AWAITING MEASUREMENT</b> · {what}</p>;
}

export function Plot({ computed, measured, unit, from, step, label }) {
  const W = 600, H = 150, pad = 28;
  if (!computed?.length && !measured?.length) return null;
  const all = [...(computed || []), ...(measured || [])];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const path = (a) => a.map((v, i) => `${i ? "L" : "M"}${pad + (i / (a.length - 1)) * (W - pad - 6)},${H - 18 - ((v - lo) / span) * (H - 30)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => from + t * step * ((computed || measured).length - 1));
  return <figure className="bench-plot">
    <figcaption className="fine">{label}</figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <rect x={pad} y="6" width={W - pad - 6} height={H - 24} fill="none" stroke="var(--line2)" />
      {computed?.length > 1 && <path d={path(computed)} fill="none" stroke="var(--ink3)" strokeWidth="1.6" strokeDasharray="5 4" />}
      {measured?.length > 1 && <path d={path(measured)} fill="none" stroke="var(--accent)" strokeWidth="1.8" />}
      {ticks.map((t, i) => <text key={i} x={pad + (i / 4) * (W - pad - 6)} y={H - 4} fontSize="10" fill="var(--ink3)" textAnchor="middle" fontFamily="var(--mono)">{t.toFixed(unit === "kHz" ? 1 : 2)}</text>)}
      <text x="4" y="14" fontSize="10" fill="var(--ink3)" fontFamily="var(--mono)">{hi.toFixed(unit === "kHz" ? 0 : 2)}</text>
      <text x="4" y={H - 20} fontSize="10" fill="var(--ink3)" fontFamily="var(--mono)">{lo.toFixed(unit === "kHz" ? 0 : 2)}</text>
    </svg>
    <div className="fine bench-legend"><span className="calc">╌ CALCULATED</span> <span className="meas">━ MEASURED</span> · x: {unit}</div>
  </figure>;
}

function ComparisonTable({ record }) {
  const cmp = record.comparison;
  return <table className="vt bench-table"><thead><tr><th>Parameter</th><th>Requested</th><th>Calculated</th><th>Measured</th><th>Error</th><th>Tolerance</th></tr></thead><tbody>
    {cmp.rows.map((r) => <tr key={r.name}><td>{r.name}</td>
      <td className="mono">{Number.isFinite(r.nominal) ? `${fmt(r.nominal, 2)} ${r.unit}` : "n/a"}</td>
      <td className="mono">{fmt(r.computed, 2)} {r.unit}</td>
      <td className="mono"><b>{fmt(r.measured, 2)} {r.unit}</b></td>
      <td className="mono">{Number.isFinite(r.error) ? `${r.error >= 0 ? "+" : ""}${fmt(r.error, 2)} ${r.unit}` : "n/a"}</td>
      <td className="mono">{r.pass === null ? "n/a" : <span className={r.pass ? "bench-pass" : "bench-fail"}>{r.pass ? "WITHIN" : "OUTSIDE"} ±{fmt(r.tolerance, 2)}</span>}</td></tr>)}
  </tbody></table>;
}

export function BenchEvidence({ checks, configured }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [point, setPoint] = useState("PA4"), [window, setWindow] = useState("HANN"), [profile, setProfile] = useState("MURKY");
  const [power, setPower] = useState({ state: "idle", volts: "", ma: "", instrument: "", at: "USB 5 V into Nucleo", afe: false, pingMs: "100", pulseMs: "" });
  const load = useCallback(async () => {
    try { const r = await fetch("/api/bench"); if (!r.ok) throw new Error(); setData(await r.json()); setError(""); } catch { setError("Bench evidence unavailable (bridge offline)"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function upload(file) {
    if (!file) return;
    setBusy(true); setMessage("");
    try {
      const q = new URLSearchParams({ point, profile, window, file: file.name, label: file.name });
      const r = await fetch(`/api/bench/capture?${q}`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: await file.text() });
      const body = await r.json();
      setMessage(r.ok ? `Stored measured capture · ${body.allPass ? "within tolerance" : "outside tolerance"}` : body.error || "Rejected");
      await load();
    } catch { setMessage("Upload failed"); } finally { setBusy(false); }
  }
  async function submitPower(e) {
    e.preventDefault(); setBusy(true); setMessage("");
    try {
      const body = { state: power.state, voltageV: Number(power.volts), currentMa: Number(power.ma), instrument: power.instrument, measuredPoint: power.at, afeConnected: power.afe,
        pingIntervalMs: power.pingMs ? Number(power.pingMs) : undefined, pulseMs: power.pulseMs ? Number(power.pulseMs) : undefined };
      const r = await fetch("/api/bench/power", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await r.json(); setMessage(r.ok ? "Stored power reading" : out.error || "Rejected"); await load();
    } catch { setMessage("Could not store reading"); } finally { setBusy(false); }
  }

  const latest = data?.latestByPoint || {};
  const pa4 = latest.PA4 || null;
  const filt = latest.OPAMP_OUT || latest.FILTER_OUT || null;
  const shown = pa4 || filt;
  const key = shown ? `${shown.point}|${shown.profile || "CUSTOM"}` : `PA4|${profile}`;
  const windows = data?.windows?.[key] || {};
  const d = data?.power?.derived;
  const field = (v, k) => <label className="bench-field"><span>{k}</span>{v}</label>;
  return <section className="panel bench-evidence" aria-label="Bench evidence">
    <Label>BENCH EVIDENCE · CALCULATED vs MEASURED</Label>
    <p className="fine">Calculated values come from the firmware's C waveform reference. Measured values come only from uploaded oscilloscope captures and typed meter readings. Nothing is filled in automatically.{error ? ` ${error}.` : ""}</p>

    <div className="bench-cards">
      <div className="bench-card"><h4>CALCULATED TX</h4>
        {checks ? <dl>
          <div><dt>Center</dt><dd className="mono">{fmt(checks.centerKHz, 2)} kHz</dd></div>
          <div><dt>Duration</dt><dd className="mono">{fmt(checks.durationMs, 2)} ms</dd></div>
          <div><dt>Amplitude</dt><dd className="mono">{fmt(checks.peakAmplitudePercent, 1)} % FS</dd></div>
          <div><dt>Window</dt><dd className="mono">{checks.window}</dd></div>
        </dl> : <p className="fine">Reference not ready.</p>}
        {configured && <p className="fine">Requested {fmt(configured.frequency, 1)} kHz · {fmt(configured.pulse, 1)} ms · {fmt(configured.amplitude, 0)} %</p>}
      </div>
      <div className="bench-card"><h4>MEASURED PA4</h4>
        {pa4 ? <dl>
          <div><dt>FFT peak</dt><dd className="mono">{fmt(pa4.measured.peakKHz, 2)} kHz</dd></div>
          <div><dt>Duration</dt><dd className="mono">{fmt(pa4.measured.burst.durationMs, 2)} ms</dd></div>
          <div><dt>Vpp</dt><dd className="mono">{fmt(pa4.measured.vpp, 3)} V</dd></div>
          <div><dt>Window</dt><dd className="mono">{pa4.window}</dd></div>
        </dl> : <p className="fine bench-await"><b className="mono">AWAITING SCOPE</b></p>}
      </div>
      <div className="bench-card"><h4>MEASURED {filt ? (filt.point === "FILTER_OUT" ? "FILTER OUTPUT" : "OP-AMP OUTPUT") : "FILTER OUTPUT"}</h4>
        {filt ? <dl>
          <div><dt>FFT peak</dt><dd className="mono">{fmt(filt.measured.peakKHz, 2)} kHz</dd></div>
          <div><dt>Duration</dt><dd className="mono">{fmt(filt.measured.burst.durationMs, 2)} ms</dd></div>
          <div><dt>Vpp</dt><dd className="mono">{fmt(filt.measured.vpp, 3)} V</dd></div>
          <div><dt>Gain used</dt><dd className="mono">×{fmt(filt.pointGain, 3)} designed</dd></div>
        </dl> : <p className="fine bench-await"><b className="mono">AWAITING SCOPE</b></p>}
      </div>
    </div>

    {shown ? <>
      <h4 className="bench-h">{POINTS[shown.point]} · {shown.window} · {shown.profile || "custom"} · captured {new Date(shown.capturedAt).toLocaleString()}</h4>
      <ComparisonTable record={shown} />
      <p className="fine">Measured on {shown.instrument?.name || "an unnamed instrument"} · {shown.source.samples} samples at {fmt(shown.source.sampleRate / 1e6, 2)} MS/s · file SHA-256 {shown.source.sha256.slice(0, 12)}…. Tolerances are suggested bench criteria, not PS limits. Calculated values are analysed with the same method as the capture.</p>
      <ShownPlots point={shown.point} id={shown.capturedAt} />
    </> : <Awaiting what="no scope capture has been imported, so there is nothing to compare against the calculation" />}

    <h4 className="bench-h">WINDOW COMPARISON · {key.replace("|", " · ")}</h4>
    <table className="vt bench-table"><thead><tr><th>Window</th><th>Measured leakage</th><th>Calculated leakage</th><th>Measured FFT peak</th><th>Status</th></tr></thead><tbody>
      {WINDOWS.map((w) => { const r = windows[w]; return <tr key={w}><td>{w}</td>
        {r ? <><td className="mono"><b>{fmt(r.leakageDb, 1)} dB</b></td><td className="mono">{fmt(r.computedLeakageDb, 1)} dB</td><td className="mono">{fmt(r.peakKHz, 2)} kHz</td>
          <td className="mono">{r.allPass ? <span className="bench-pass">WITHIN</span> : <span className="bench-fail">OUTSIDE</span>}</td></>
          : <td colSpan="4" className="na">AWAITING MEASUREMENT</td>}</tr>; })}
    </tbody></table>
    <p className="fine">Leakage is the highest spectral level outside the pulse band (± guard), relative to the in-band peak. A stronger window should read lower.</p>

    <h4 className="bench-h">IMPORT OSCILLOSCOPE CAPTURE</h4>
    <div className="bench-form">
      {field(<select value={point} onChange={(e) => setPoint(e.target.value)}>{Object.entries(POINTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>, "Probe point")}
      {field(<select value={profile} onChange={(e) => setProfile(e.target.value)}>{PROFILES.map((p) => <option key={p}>{p}</option>)}</select>, "Policy profile")}
      {field(<select value={window} onChange={(e) => setWindow(e.target.value)}>{WINDOWS.map((w) => <option key={w}>{w}</option>)}</select>, "Window on board")}
      {field(<input type="file" accept=".csv,.txt,text/csv" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />, "Scope CSV (time, volts)")}
    </div>
    <p className="fine">The profile and window must match what the board was actually running when you captured. Export CSV from the scope with time and volts columns.</p>

    <h4 className="bench-h">POWER · MEASURED</h4>
    {d && d.missing.length < 4 ? <table className="vt bench-table"><thead><tr><th>State</th><th>Voltage</th><th>Current</th><th>Power</th><th>Measured with</th></tr></thead><tbody>
      {Object.entries(POWER_STATES).map(([s, name]) => { const e = d.latest[s]; return <tr key={s}><td>{name}</td>
        {e ? <><td className="mono">{fmt(e.voltageV, 2)} V</td><td className="mono">{fmt(e.currentMa, 1)} mA</td><td className="mono"><b>{fmt(e.powerMw, 0)} mW</b></td><td className="fine">{e.instrument} · {e.measuredPoint}{e.afeConnected ? " · AFE connected" : ""}</td></>
          : <td colSpan="4" className="na">AWAITING MEASUREMENT</td>}</tr>; })}
    </tbody></table> : <Awaiting what="no meter readings recorded yet" />}
    <dl className="bench-derived">
      <div><dt>Active over idle</dt><dd className="mono">{d && Number.isFinite(d.activeOverIdleMw) ? `${fmt(d.activeOverIdleMw, 0)} mW` : "n/a"}</dd></div>
      <div><dt>Energy per ping</dt><dd className="mono">{d && Number.isFinite(d.energyPerPingUj) ? `${fmt(d.energyPerPingUj / 1000, 2)} mJ` : "n/a"}</dd></div>
      <div><dt>Pulse energy</dt><dd className="mono">{d && Number.isFinite(d.pulseEnergyUj) ? `${fmt(d.pulseEnergyUj / 1000, 3)} mJ` : "n/a"}</dd></div>
      <div><dt>Duty cycle</dt><dd className="mono">{d && Number.isFinite(d.dutyCycle) ? `${fmt(d.dutyCycle * 100, 1)} %` : "n/a"}</dd></div>
    </dl>
    <p className="fine">Record only readings taken with a physical meter under the stated condition. Anything entered here is stored as MEASURED.</p>
    <form className="bench-form" onSubmit={submitPower}>
      {field(<select value={power.state} onChange={(e) => setPower({ ...power, state: e.target.value })}>{Object.entries(POWER_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>, "State")}
      {field(<input type="number" step="0.001" required value={power.volts} onChange={(e) => setPower({ ...power, volts: e.target.value })} />, "Volts (V)")}
      {field(<input type="number" step="0.1" required value={power.ma} onChange={(e) => setPower({ ...power, ma: e.target.value })} />, "Current (mA)")}
      {field(<input type="text" required placeholder="meter model" value={power.instrument} onChange={(e) => setPower({ ...power, instrument: e.target.value })} />, "Instrument")}
      {field(<input type="text" required value={power.at} onChange={(e) => setPower({ ...power, at: e.target.value })} />, "Measured at")}
      {field(<input type="number" value={power.pingMs} onChange={(e) => setPower({ ...power, pingMs: e.target.value })} />, "Ping interval (ms)")}
      {field(<input type="number" step="0.1" value={power.pulseMs} onChange={(e) => setPower({ ...power, pulseMs: e.target.value })} />, "Pulse (ms)")}
      {field(<input type="checkbox" checked={power.afe} onChange={(e) => setPower({ ...power, afe: e.target.checked })} />, "Analog stage connected")}
      <button type="submit" className="bench-btn" disabled={busy}>Record reading</button>
    </form>
    {message && <p className="fine" role="status">{message}</p>}
  </section>;
}

// Heavy traces are fetched only for the record on screen.
function ShownPlots({ point, id }) {
  const [rec, setRec] = useState(null);
  useEffect(() => { let live = true; fetch(`/api/bench/traces?point=${point}`).then((r) => (r.ok ? r.json() : null)).then((j) => live && setRec(j)).catch(() => {}); return () => { live = false; }; }, [point, id]);
  if (!rec?.traces) return null;
  const t = rec.traces;
  return <div className="bench-plots">
    <Plot label="Spectrum, dB re peak" unit="kHz" from={t.measuredSpectrum.fromKHz} step={t.measuredSpectrum.stepKHz} computed={t.computedSpectrum.db} measured={t.measuredSpectrum.db} />
    <Plot label="Envelope, normalised" unit="ms" from={t.measuredEnvelope.fromMs} step={t.measuredEnvelope.stepMs} computed={t.computedEnvelope.env} measured={t.measuredEnvelope.env} />
  </div>;
}
