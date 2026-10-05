// Isolated visual fixture: no serial port, WebSocket, or mutation of the real session.
import React from "react";
import { createRoot } from "react-dom/client";
import { AdaptationPipeline } from "../../src/pages/blocks.jsx";
import { DEFAULT_CONFIG } from "../../shared/signal.js";
import "../../src/styles.css";
import "../../src/black-theme.css";
import "../../src/minimal-theme.css";

function Fixture() {
  const [status, setStatus] = React.useState("APPLIED");
  const waveform = { ...DEFAULT_CONFIG, pulse: 4, amplitude: 50 };
  const current = {
    waveform,
    engine: { underruns: 0 },
    adaptation: { source: "ADC_DIAL", inputPin: "PA0/A0", inputVolts: status === "INHIBITED" ? null : 1.6,
      levelPercent: 48.5, inputValid: status !== "INHIBITED", profile: "TRANSITION", state: status,
      decisionId: status === "PENDING" ? 3 : 2, appliedDecisionId: 2, decisionToOutputMs: 39 },
  };
  return <main style={{ padding: 24 }}>
    <h1>SYNTHETIC UI TEST · not connected to hardware</h1>
    <label>Fixture state <select value={status} onChange={e => setStatus(e.target.value)}>
      {["APPLIED", "PENDING", "INHIBITED"].map(s => <option key={s}>{s}</option>)}
    </select></label>
    <AdaptationPipeline ctx={{ current, state: { mode: "hardware", events: [] }, demo: false,
      sensors: {}, history: [], cfg: waveform, c: 1500, power: {} }} />
  </main>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
