import React, { useCallback, useEffect, useState } from "react";
import { Label } from "../ui/kit.jsx";
import { Plot } from "./BenchEvidence.jsx";
import { Spectrogram } from "../Charts.jsx";

// MCU ADC CAPTURE: the board sampling its own DAC pin with ADC3 (PA4 is jumpered to A5). It is deliberately NOT presented as
// MEASURED PA4, an oscilloscope, or an instrument measurement. Those labels belong to an imported external capture.
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
const TAPS = [
  { id: "RAW_DAC", label: "Raw DAC pin PA4 (A2 to A5 jumper)", name: "raw DAC" },
  { id: "AFE_FILTER", label: "Filter output TP2 (before the TLV9062 stage)", name: "filter output" },
  { id: "AFE_OUTPUT", label: "Filtered output (filter + TLV9062 stage, biased tap)", name: "filtered output" },
];
const tapName = (id) => (TAPS.find((t) => t.id === (id || "RAW_DAC")) || TAPS[0]).name;
const MODES = [{ id: 0, label: "Pulse · 500 kS/s · 12 ms" }, { id: 1, label: "Train · 100 kS/s · 160 ms" }];

function Zoom({ zoom }) {
  const v = zoom?.volts; if (!v?.length) return null;
  const W = 600, H = 150, pad = 30, lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((y, i) => `${i ? "L" : "M"}${pad + (i / (v.length - 1)) * (W - pad - 6)},${H - 20 - ((y - lo) / span) * (H - 34)}`).join(" ");
  return <figure className="bench-plot">
    <figcaption className="fine">Captured samples, {v.length} consecutive points ({fmt(v.length * zoom.stepMs, 2)} ms), volts</figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Captured ADC samples around the middle of the pulse">
      <rect x={pad} y="6" width={W - pad - 6} height={H - 26} fill="none" stroke="var(--line2)" />
      <path d={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <text x="4" y="14" fontSize="10" fill="var(--ink3)" fontFamily="var(--mono)">{hi.toFixed(2)}</text>
      <text x="4" y={H - 22} fontSize="10" fill="var(--ink3)" fontFamily="var(--mono)">{lo.toFixed(2)}</text>
      <text x={pad} y={H - 4} fontSize="10" fill="var(--ink3)" fontFamily="var(--mono)">{fmt(zoom.fromMs, 2)} ms</text>
      <text x={W - 6} y={H - 4} fontSize="10" fill="var(--ink3)" textAnchor="end" fontFamily="var(--mono)">{fmt(zoom.fromMs + v.length * zoom.stepMs, 2)} ms</text>
    </svg>
  </figure>;
}
function Train({ mm }) {
  if (!mm?.minMax?.length) return null;
  const W = 600, H = 120, pad = 30, n = mm.minMax.length, y = (c) => H - 16 - (c / 4095) * (H - 28);
  const top = mm.minMax.map(([, hi], i) => `${i ? "L" : "M"}${pad + (i / (n - 1)) * (W - pad - 6)},${y(hi)}`).join(" ");
  const bot = mm.minMax.map(([lo], i) => `${i ? "L" : "M"}${pad + (i / (n - 1)) * (W - pad - 6)},${y(lo)}`).join(" ");
  return <figure className="bench-plot"><figcaption className="fine">Capture envelope, ADC counts (min and max per step), whole 160 ms</figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Two pulses in the train capture"><rect x={pad} y="6" width={W - pad - 6} height={H - 22} fill="none" stroke="var(--line2)" />
      <path d={top} fill="none" stroke="var(--accent)" strokeWidth="1.4" /><path d={bot} fill="none" stroke="var(--accent)" strokeWidth="1.4" /></svg></figure>;
}

export function McuCapture({ ctx }) {
  const [data, setData] = useState(null), [traces, setTraces] = useState(null), [mode, setMode] = useState(0), [tap, setTap] = useState("RAW_DAC"), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/bench/mcu"); if (!r.ok) throw new Error(); const d = await r.json(); setData(d);
      if (d.latest) { const t = await fetch("/api/bench/mcu/traces"); setTraces(t.ok ? await t.json() : null); } else setTraces(null);
    } catch { setMessage("Capture store unavailable (bridge offline)"); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // The burst of the newest pulse capture, for the captured spectrogram (volts about the DC level). Read from the stored CSV, not synthesised.
  const [burst, setBurst] = useState(null);
  const latestName = data?.latest && data.latest.mode === "pulse" ? `mcu-${data.latest.capturedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${data.latest.captureId}-pulse` : null;
  useEffect(() => {
    let live = true; setBurst(null);
    if (!latestName || !data?.latest?.measured?.burst) return undefined;
    (async () => {
      try {
        const text = await (await fetch(`/api/bench/mcu/${latestName}.csv`)).text(), rate = data.latest.source.sampleRate;
        const v = text.split("\n").filter((l) => /^[0-9]/.test(l)).map((l) => Number(l.split(",")[1]));
        const b = data.latest.measured.burst, lo = Math.max(0, Math.round((b.startMs - 0.2) / 1000 * rate)), hi = Math.min(v.length, Math.round((b.startMs + b.durationMs + 0.2) / 1000 * rate));
        const seg = v.slice(lo, hi), mean = seg.reduce((a, x) => a + x, 0) / (seg.length || 1);
        if (live && seg.length > 64) setBurst({ samples: seg.map((x) => x - mean), rate });
      } catch { /* the table above still shows the analysis */ }
    })();
    return () => { live = false; };
  }, [latestName, data]);

  const current = ctx?.current, cap = current?.capture, supported = !!current?.identity?.capabilities?.includes("DAC_CAPTURE");
  const live = cap && cap.state !== "IDLE" ? `${cap.state}${cap.state === "SENDING" ? ` ${cap.sent}/${cap.samples}` : ""}${cap.reason ? ` · ${cap.reason}` : ""}` : "";
  async function run() {
    if (!ctx?.api) return; setBusy(true); setMessage("Capturing: output is enabled for one pulse and stops by itself");
    try { const r = await ctx.api("bench/mcu-capture", { mode, tap }); setMessage(r ? `Stored ${r.mode} capture of the ${tapName(r.tap)} · ${r.allPass ? "within tolerance of the calculation" : "differs from the calculation"}` : "Capture failed (see the notice above)"); await load(); }
    finally { setBusy(false); }
  }
  const rec = data?.latest, rows = rec?.comparison?.rows || [], name = rec ? `mcu-${rec.capturedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${rec.captureId}-${rec.mode}` : null;
  return <section className="panel bench-evidence mcu-capture" aria-label="MCU ADC capture">
    <Label>MCU ADC CAPTURE · THE BOARD SAMPLING ITS OWN DAC PIN</Label>
    <p className="fine">ADC3 samples PA4 through the A2 to A5 jumper while one pulse plays, then the board stops the output itself. This is <b>not an oscilloscope or instrument measurement</b>: it uses an assumed 3.3 V reference, 12-bit samples and the same chip that makes the signal. No distortion figure is derived from it. An external instrument capture is still required for that.{message ? ` ${message}.` : ""}</p>
    <div className="bench-form">
      <label className="bench-field"><span>Capture mode</span><select value={mode} onChange={(e) => setMode(Number(e.target.value))}>{MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      <label className="bench-field"><span>ADC input is wired to</span><select value={tap} onChange={(e) => setTap(e.target.value)}>{TAPS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
      <button type="button" className="bench-btn" disabled={busy || !supported || !ctx?.api} onClick={run}>Capture DAC now</button>
      <span className="fine">{!current ? "Connect the payload to capture" : !supported ? "This firmware does not advertise DAC capture" : live ? `Board: ${live}` : "Board: idle, output off"}</span>
    </div>
    {tap !== "RAW_DAC" && <p className="fine">Declare only what is physically wired to A5. The firmware cannot see the wiring: a wrong choice shows up as a failed comparison. Capture the raw DAC with the same waveform and window first, so the two can be compared.</p>}
    {!rec ? <p className="fine bench-await"><b className="mono">AWAITING MCU CAPTURE</b></p> : <>
      <h4 className="bench-h">LATEST · {tapName(rec.tap).toUpperCase()} · {String(rec.expected?.mode || "LFM CHIRP")} · {rec.mode.toUpperCase()} · {rec.window} · {rec.profile || "custom"} · {new Date(rec.capturedAt).toLocaleString()}</h4>
      <table className="vt bench-table"><thead><tr><th>Parameter</th><th>Requested</th><th>{rec.tap && rec.tap !== "RAW_DAC" ? "Calculated through the designed stage" : "Calculated"}</th><th>MCU ADC capture · {tapName(rec.tap)}</th><th>Error</th><th>Tolerance</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.name}><td>{r.name}</td>
          <td className="mono">{Number.isFinite(r.nominal) ? `${fmt(r.nominal)} ${r.unit}` : "n/a"}</td><td className="mono">{fmt(r.computed)} {r.unit}</td>
          <td className="mono"><b>{fmt(r.measured)} {r.unit}</b></td>
          <td className="mono">{Number.isFinite(r.error) ? `${r.error >= 0 ? "+" : ""}${fmt(r.error)} ${r.unit}` : "n/a"}</td>
          <td className="mono">{r.pass === null ? "n/a" : <span className={r.pass ? "bench-pass" : "bench-fail"}>{r.pass ? "WITHIN" : "OUTSIDE"} ±{fmt(r.tolerance)}</span>}</td></tr>)}
      </tbody></table>
      <p className="fine">{rec.source.samples} samples at {fmt(rec.source.sampleRate / 1000, 0)} kS/s over {fmt(rec.source.durationMs, 1)} ms · ADC counts {rec.counts.minCounts} to {rec.counts.maxCounts} · volts use an assumed {rec.source.vref} V reference · device min/max {rec.deviceStatsAgree === null ? "not reported" : rec.deviceStatsAgree ? "agrees with the host" : "DISAGREES with the host"} · file SHA-256 {rec.source.sha256.slice(0, 12)}… {name && <a href={`/api/bench/mcu/${name}.csv`}>Download CSV</a>}</p>
      {rec.train && <p className="fine">{rec.train.note}</p>}
      {rec.compression?.classMatch && (() => { const c = rec.compression.classMatch; return <p className="fine mcu-class">Waveform class check (correlation of the capture with the calculated pulse of each class): {Object.entries(c.scores).map(([k, v]) => `${k} ${fmt(v, 3)}`).join(", ")}. Requested {c.requested}, best match {c.best}.{c.ambiguousWith?.length ? ` ${c.requested} and ${c.ambiguousWith.join(", ")} cannot be told apart at this sweep width: their calculated waveforms correlate at 0.998 or better, so no capture of either could separate them.` : ""}</p>; })()}
      {burst && <div className="bench-plots"><figure className="bench-plot"><figcaption className="fine">Spectrogram of the captured burst (MCU ADC capture), compare with the calculated TX reference spectrogram above</figcaption>
        <div className="chart-h"><Spectrogram config={rec.expected} samples={burst.samples} sampleRate={burst.rate} signalLabel="MCU ADC capture" showRidge /></div></figure></div>}
      {traces?.traces && <div className="bench-plots">
        {traces.traces.zoom && <Zoom zoom={traces.traces.zoom} />}
        {traces.traces.measuredSpectrum && <Plot label="Spectrum of the capture, dB re peak" unit="kHz" from={traces.traces.measuredSpectrum.fromKHz} step={traces.traces.measuredSpectrum.stepKHz} computed={traces.traces.computedSpectrum.db} measured={traces.traces.measuredSpectrum.db} />}
        {traces.traces.measuredEnvelope && <Plot label="Envelope, normalised" unit="ms" from={traces.traces.measuredEnvelope.fromMs} step={traces.traces.measuredEnvelope.stepMs} computed={traces.traces.computedEnvelope.env} measured={traces.traces.measuredEnvelope.env} />}
        {traces.traces.trainMinMax && <Train mm={traces.traces.trainMinMax} />}
      </div>}
      {(data?.comparisons || []).map((c) => <div key={`${c.tap}-${c.window}`} className="mcu-compare">
        <h4 className="bench-h">RAW DAC VS {tapName(c.tap).toUpperCase()} · {c.window} · both are MCU ADC captures</h4>
        <table className="vt bench-table"><thead><tr><th>Parameter</th><th>Raw DAC</th><th>{tapName(c.tap)}</th><th>Change</th><th>Designed stage predicts</th><th>Agreement</th></tr></thead><tbody>
          {c.rows.map((r) => <tr key={r.name}><td>{r.name}{r.informational ? " (informational)" : ""}</td><td className="mono">{fmt(r.raw)} {r.unit}</td><td className="mono"><b>{fmt(r.tapped)} {r.unit}</b></td>
            <td className="mono">{r.measuredChange === null ? "n/a" : `${fmt(r.measuredChange, 3)}${r.kind === "ratio" ? " x" : ` ${r.unit}`}`}</td><td className="mono">{r.modelChange === null ? "n/a" : `${fmt(r.modelChange, 3)}${r.kind === "ratio" ? " x" : ` ${r.unit}`}`}</td>
            <td className="mono">{r.pass === null ? "n/a" : <span className={r.pass ? "bench-pass" : "bench-fail"}>{r.pass ? "WITHIN" : "OUTSIDE"} ±{fmt(r.tolerance, 3)}</span>}</td></tr>)}
        </tbody></table>
        <p className="fine">Gain through the stage: {fmt(c.gainDb)} dB read by the ADC, {fmt(c.modelGainDb)} dB from the designed values. {c.note}</p>
      </div>)}
      <ul className="fine mcu-limits">{rec.limits.map((l) => <li key={l}>{l}</li>)}</ul>
    </>}
  </section>;
}
