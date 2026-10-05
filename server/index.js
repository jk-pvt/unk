import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { SerialPort } from "serialport";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DEFAULT_CONFIG } from "../shared/signal.js";
import { environmentSchema, parsePacket, LineParser } from "../shared/protocol.js";
import { adaptationEvent, controlApplicationEvent } from "../shared/hardware-evidence.js";
import { NativeEngine } from "./native-engine.js";
import { ControlLink } from "./control-link.js";
import { PreviewEngine } from "./preview.js";
import { MODES, WINDOW_NAMES } from "../shared/environment.js";
import { operationalState, signalState, attachCompanion } from "../shared/operational-state.js";
import { estimateOperatingPower, batteryScenario } from "../shared/power.js";
import { referenceSelection, referenceMatches } from "../shared/reference-selection.js";
import { BenchStore } from "./bench-store.js";
import { McuCaptureCoordinator } from "./mcu-coordinator.js";
import { DEFAULT_TAP, checkTap, predictedAdcRange } from "../shared/mcu-capture.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = process.env.AQUASDR_DATA_DIR || resolve(root, "data");
const bridgePort = Number(process.env.PORT || 6002);
const host = process.env.HOST || "0.0.0.0";
const allowedHosts = process.env.ALLOWED_HOSTS
  ? process.env.ALLOWED_HOSTS.split(",").map((s) => s.trim())
  : null;
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:6002",
      "http://127.0.0.1:6002",
      `http://localhost:${bridgePort}`,
      `http://127.0.0.1:${bridgePort}`,
    ];
const wsPath = process.env.WS_PATH || "/ws/telemetry";
const maxPayload = Number(process.env.WS_MAX_PAYLOAD || 1048576);

const app = express(),
  server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: wsPath,
  maxPayload: maxPayload,
});
app.use(express.json({ limit: process.env.JSON_LIMIT || "1mb" }));

// Security & CORS validation middleware
app.use((req, res, next) => {
  const reqHost = (req.headers.host || "").split(":")[0];
  if (allowedHosts && !allowedHosts.includes(reqHost) && !allowedHosts.includes("*")) {
    return res.status(403).json({ error: "Host denied" });
  }
  if (
    req.method !== "GET" &&
    req.headers.origin &&
    !allowedOrigins.includes("*") &&
    !allowedOrigins.includes(req.headers.origin)
  ) {
    return res.status(403).json({ error: "Origin denied" });
  }
  next();
});
let config = { ...DEFAULT_CONFIG },
  mode = "demo",
  running = true,
  recording = false,
  adaptive = true,
  scenario = false,
  scenarioLevel = 0,
  scenarioStartedAt = null;
let elapsed = 0,
  seq = 0,
  energy = 0,
  sessionId = randomUUID(),
  started = new Date().toISOString();
let recordedBytes = 0;
let history = [],
  recorded = [],
  events = [],
  current = null,
  live = null,
  port = null,
  portPath = null,
  lastPacket = 0,
  received = 0,
  dropped = 0,
  lastSeq = -1,
  lastError = null,
  reconnectAt = 0,
  retries = 0,
  wasStale = false;
// Playback replays a previously saved session's recorded samples. It is a
// distinct data source from demo (synthetic, generated live) and hardware
// (live STM32 telemetry): every value it reports actually occurred during
// that earlier session, in the mode ("demo" or "hardware") it was recorded in.
let playback = null; // { sessionId, meta, samples, index }
const SESSION_ID_RE = /^[a-f0-9-]{36}$/i;
function event(message, kind = "info", details = {}) {
  events.unshift({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    elapsed,
    message,
    kind,
    source: mode,
    ...details,
  });
  events = events.slice(0, 500);
}
event("Demo session initialized · deterministic test bench");
event(
  `LFM chirp loaded · ${DEFAULT_CONFIG.frequency} kHz / ${DEFAULT_CONFIG.bandwidth} kHz bandwidth`,
);
const clients = new Set();
const native = new NativeEngine();
const nativeLink = new ControlLink(command => native.write(command));
const mcu = new McuCaptureCoordinator();
const hardwareLink = new ControlLink(command => {
  if (!port?.isOpen) throw new Error("Serial port disconnected");
  port.write(JSON.stringify(command) + "\n", error => { if(error) { lastError=error.message; hardwareLink.reset(); } });
});
let nativeData = null, nativeError = null;
function companionAvailable() {
  return mode === 'hardware' && !!port?.isOpen && Date.now()-lastPacket < 3000 &&
    !!live && !live.capabilities?.controlVersion;
}
function displayLive() {
  return companionAvailable() ? attachCompanion(live,nativeData) : live;
}
function withEstimate(data) {
  if(!data) return data;
  const signal=signalState(data);
  return {...data,powerEstimate:estimateOperatingPower(signal?.waveform,signal?.control?.outputEnabled),
    batteryScenario:batteryScenario(referenceSelection(signal,config),elapsed,!!signal?.control?.outputEnabled)};
}
const previewEngine = new PreviewEngine(native, preview => {
  const data = mode === "demo" ? current : companionAvailable() ? nativeData : mode === "hardware" ? live : null;
  if (data?.control) data.preview = preview;
});
let referencePreview=null;
const inspectionEngine = new PreviewEngine(native, preview => { referencePreview={...preview,purpose:'CONFIGURATION_INSPECTION'}; });
native.on("packet", raw => {
  try {
    const packet = parsePacket(JSON.stringify(raw));
    if(mode !== "playback" || packet.type === "ack") nativeLink.receive(packet);
    if(packet.type !== "telemetry") { broadcast(); return; }
    const data = packet.payload;
    data.provenance = "COMPUTED_C_ENGINE";
    data.health = Object.fromEntries(Object.keys(data.health || {}).map(k => [k,"COMPUTED"]));
    data.engine.cpuLoad = null;
    if(nativeData?.preview && JSON.stringify(nativeData.waveform) === JSON.stringify(data.waveform)) data.preview=nativeData.preview;
    if(mode === 'hardware' && companionAvailable()) {
      const appliedEvent=controlApplicationEvent(nativeData,data,'Computed C engine');
      if(appliedEvent) event(appliedEvent,'adaptation',{target:'COMPUTED',inputSource:data.environment?.source,
        environment:data.environment,previous:nativeData?.waveform,applied:data.waveform,decisionId:data.control.appliedDecisionId,requestId:data.control.appliedRequestId});
      if(data.waveform) config=data.waveform;
    }
    nativeData = data;
    if(mode === "demo") {
      const appliedEvent = controlApplicationEvent(current, data, 'Computed C engine');
      if (appliedEvent) event(appliedEvent, 'adaptation',{target:'COMPUTED',inputSource:data.environment?.source,
        environment:data.environment,previous:current?.waveform,applied:data.waveform,decisionId:data.control.appliedDecisionId,requestId:data.control.appliedRequestId});
      current=data; if(data.waveform) config=data.waveform;
    }
  } catch(e) { nativeError=e.message; }
});
native.on("unavailable", error => { nativeError=error; nativeLink.reset(); nativeData=null; if(mode === "demo") current=null; });
void native.start();
for(const signal of ["SIGTERM","SIGINT"]) process.once(signal, () => { native.close(); previewEngine.close(); inspectionEngine.close(); server.close(); process.exit(0); });

function frame() {
  const fresh =
    mode === "hardware" &&
    lastPacket &&
    Date.now() - lastPacket < 3000 &&
    port?.isOpen;
  const pb = mode === "playback" ? playback : null;
  const pbSample = pb ? pb.samples[pb.index] || null : null;
  const pbHistory = pb
    ? pb.samples
        .slice(Math.max(0, pb.index - 239), pb.index + 1)
        .map((s) => ({ elapsed: s.elapsed, sensors: s.sensors, power: s.power, powerEstimate:s.powerEstimate,batteryScenario:s.batteryScenario,
          environment:signalState(s)?.environment,turbidityStatus:s.health?.TURBIDITY }))
    : null;
  const pbEvents = pb
    ? (pb.meta.events || []).filter((e) => e.elapsed <= (pbSample?.elapsed ?? Infinity))
    : null;
  const displayed=mode === 'playback' ? pbSample : withEstimate(mode === "demo" ? current : fresh ? displayLive() : null);
  const transmitter={ ...(mode === "demo" ? nativeLink : hardwareLink).snapshot(),
    error:mode === "demo" ? nativeError : lastError,
    backend:mode === "demo" ? "COMPUTED" : mode === "hardware" ? "STM32" : "PLAYBACK" };
  const digitalTransmitter={...nativeLink.snapshot(), error:nativeError, backend:'COMPUTED'};
  const hardware={connected:!!port?.isOpen, fresh:!!fresh};
  return {
    type: "state",
    transmitter, digitalTransmitter,
    operational:operationalState({mode,hardware,transmitter,digitalTransmitter,current:displayed}),
    mode,
    running,
    recording,
    adaptive,
    scenario,
    scenarioLevel,
    elapsed,
    config: pb ? pbSample?.config || DEFAULT_CONFIG : config,
    sessionId,
    started,
    seq,
    current: displayed,
    referencePreview: pb ? pbSample?.referencePreview || null : referenceMatches(referencePreview,referenceSelection(signalState(displayed),config)) || referencePreview?.error ? referencePreview : null,
    events: (pb ? pbEvents : events).slice(0, 30),
    hardware: {
      connected: !!port?.isOpen,
      fresh: !!fresh,
      path: portPath,
      received,
      dropped,
      lastPacket: lastPacket || null,
      firmware: fresh ? live?.firmware || null : null,
      lastError,
      retries,
    },
    playback: pb
      ? {
          sessionId: pb.sessionId,
          index: pb.index,
          length: pb.samples.length,
          recordedStarted: pb.meta.started || null,
          recordedMode: pb.meta.mode || null,
        }
      : null,
    history: pb ? pbHistory : history,
  };
}
function broadcast() {
  const json = JSON.stringify(frame());
  for (const c of wss.clients)
    if (c.readyState === 1 && c.bufferedAmount < 2e6) c.send(json);
}
wss.on("connection", (socket, req) => {
  if (
    req.headers.origin &&
    ![
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      `http://localhost:${bridgePort}`,
      `http://127.0.0.1:${bridgePort}`,
    ].includes(req.headers.origin)
  )
    return socket.close(1008, "Origin denied");
  socket.on("message", message => {
    try {
      const p = JSON.parse(String(message));
      if(p.type !== "controlHeartbeat" || typeof p.client !== "string" || !/^[a-f0-9-]{36}$/.test(p.client)) return;
      socket.client = p.client; clients.add(p.client);
      if(mode === "demo" || companionAvailable()) nativeLink.heartbeat(p.client);
      if(mode === "hardware") hardwareLink.heartbeat(p.client);
    } catch {}
  });
  socket.on("close", () => {
    clients.delete(socket.client);
    for(const link of [nativeLink,hardwareLink]) if(link.owner === socket.client) {
      link.ownerSeen=0; link.owner=null;
      const data=link===nativeLink?nativeData:live;
      if(data?.environment?.source==='WEB_COMMAND' && data.control?.outputEnabled)
        link.halt().then(()=>event(`${link===nativeLink?'Computed':'STM32'} output stopped · browser disconnected`,'control')).catch(()=>{});
    }
  });
  socket.alive = true;
  socket.on("pong", () => (socket.alive = true));
  socket.send(JSON.stringify(frame()));
});
setInterval(() => {
  for (const c of wss.clients) {
    if (!c.alive) c.terminate();
    else {
      c.alive = false;
      c.ping();
    }
  }
}, 15000).unref();
function remember(data) {
  data=withEstimate(data);
  const row = {
    timestamp: new Date().toISOString(),
    elapsed,
    source: mode === "demo" ? "demo" : "hardware",
    config: { ...config },
    scenario,
    adaptive,
    ...data,
    referencePreview:referenceMatches(referencePreview,referenceSelection(signalState(data),config))?referencePreview:null,
  };
  history.push({ elapsed, sensors: data.sensors, power: data.power, powerEstimate:data.powerEstimate,batteryScenario:data.batteryScenario,
    environment:signalState(data)?.environment,turbidityStatus:data.health?.TURBIDITY });
  history = history.slice(-240);
  if (recording) {
    const bytes = Buffer.byteLength(JSON.stringify(row));
    if (recordedBytes + bytes > 64 * 1024 * 1024) {
      recording = false;
      event("Recording reached 64 MiB · save this session", "warning");
      return;
    }
    recorded.push(row);
    recordedBytes += bytes;
    if (recorded.length >= 7200) {
      recording = false;
      event("Recording buffer full · save this session", "warning");
    }
  }
}

function withAcousticModel(data) { return data; }
setInterval(() => {
  if (running && mode === "playback" && playback) {
    seq++;
    if (playback.index + 1 >= playback.samples.length) {
      running = false;
      event(`Playback finished · ${playback.samples.length} samples`, "info");
    } else {
      playback.index++;
      elapsed = playback.samples[playback.index]?.elapsed ?? elapsed;
    }
  }
  if (running && mode !== "playback") {
    elapsed += 0.25;
    seq++;
    if (mode === "demo" && current) remember(current);
  }
  const activeData = mode === "demo" ? current : companionAvailable() ? nativeData : mode === "hardware" ? live : null;
  if (activeData?.control && (mode === "demo" || Date.now()-lastPacket<3000)) {
    const link = mode === "demo" || companionAvailable() ? nativeLink : hardwareLink;
    link.maintain(activeData.environment?.source === "WEB_COMMAND");
    previewEngine.request(activeData, elapsed);
    if(!activeData.control.hasApplied) inspectionEngine.request({
      waveform:referenceSelection(activeData,config),
      environment:activeData.environment || {turbidityIndex:0,depth:0,temperature:25},
    },elapsed,{inspection:true});
  }

  if (
    mode === "hardware" &&
    lastPacket &&
    Date.now() - lastPacket >= 3000 &&
    !wasStale
  ) {
    event("Telemetry stale · no valid packet for 3 seconds", "warning");
    wasStale = true;
  }
  if (mode === "hardware" && portPath && !port && Date.now() > reconnectAt)
    connectSerial(portPath).catch(() => {});
  broadcast();
}, 250);
function reset() {
  elapsed = 0;
  seq = 0;
  energy = 0;
  history = [];
  recorded = [];
  recordedBytes = 0;
  events = [];
  adaptive = true;
  current = null;
  sessionId = randomUUID();
  started = new Date().toISOString();
  config = { ...DEFAULT_CONFIG };
  scenario = false;
  scenarioLevel = 0;
  scenarioStartedAt = null;
  recording = false;
  running = false;
  event("New session ready · press Start");
}
async function connectSerial(path) {
  const available = await SerialPort.list();
  if (!available.some((p) => p.path === path)) {
    lastError = "Selected serial device is unavailable";
    retries++;
    reconnectAt =
      Date.now() + Math.min(30000, 1000 * 2 ** Math.min(retries, 5));
    throw new Error(lastError);
  }
  const device = new SerialPort({ path, baudRate: 115200, autoOpen: false });
  port = device;
  portPath = path;
  lastSeq = -1;
  hardwareLink.reset();
  const parser = new LineParser(
    (packet) => {
      if (packet.type === "capture") { mcu.ingest(packet); return; }
      const rebooted = packet.type === "telemetry" && packet.payload.control && hardwareLink.lastUptime != null && (packet.payload.control.uptimeMs < hardwareLink.lastUptime || (hardwareLink.ready && packet.payload.control.session !== hardwareLink.session));
      hardwareLink.receive(packet);
      if(packet.type === "ack") { broadcast(); return; }
      if(rebooted) { lastSeq=-1; previewEngine.invalidate(); event("STM32 restarted · pending commands cleared", "warning"); }
      if (packet.seq <= lastSeq) {
        dropped++;
        return;
      }
      if (lastSeq >= 0) dropped += Math.max(0, packet.seq - lastSeq - 1);
      lastSeq = packet.seq;
      lastPacket = Date.now();
      received++;
      wasStale = false;
      lastError = null;
      if (packet.payload.waveform) config = packet.payload.waveform;
      const priorLive = live;
      live = withAcousticModel(
        { ...packet.payload, timestamp: packet.timestamp },
        packet.payload.waveform || config,
      );
      if(priorLive?.preview && JSON.stringify(priorLive.waveform) === JSON.stringify(live.waveform)) live.preview=priorLive.preview;
      const appliedEvent = controlApplicationEvent(priorLive, live);
      if (appliedEvent) event(appliedEvent, 'adaptation');
      const decisionEvent = adaptationEvent(priorLive, live);
      if (decisionEvent) event(decisionEvent, "adaptation");
      if (running) remember(displayLive());
    },
    (message) => {
      dropped++;
      lastError = message;
    },
  );
  device.on("data", (data) => parser.feed(data));
  device.on("error", (e) => {
    lastError = e.message;
  });
  device.on("close", () => {
    if (port === device) {
      hardwareLink.reset(); previewEngine.invalidate();
      port = null;
      live = null;
      event("Serial connection closed", "warning");
      reconnectAt = Date.now() + 2000;
    }
  });
  await new Promise((yes, no) =>
    device.open((error) => {
      if (error) {
        port = null;
        retries++;
        reconnectAt = Date.now() + 5000;
        lastError = error.message;
        no(error);
      } else {
        retries = 0;
        event("Serial connected · awaiting valid telemetry");
        yes();
      }
    }),
  );
}
app.get("/api/system", (req, res) => res.json(frame()));
for (const key of ["sensors", "power", "waveform", "hardware", "logs", "events"])
  app.get("/api/" + key, (req, res) => {
    const state = frame();
    res.json(
      key === "waveform"
        ? config
        : key === "logs" || key === "events"
          ? events
          : key === "hardware"
            ? state.hardware
            : state.current?.[key] || null,
    );
  });
app.get("/api/ports", async (req, res) => {
  try {
    res.json(await SerialPort.list());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post("/api/mode", async (req, res) => {
  const nextMode = req.body.mode;
  if (!["demo", "hardware", "playback"].includes(nextMode))
    return res.status(400).json({ error: "Invalid mode" });
  if (nextMode === "playback") {
    const id = String(req.body.sessionId || "");
    if (!SESSION_ID_RE.test(id))
      return res.status(400).json({ error: "Select a saved session to play back" });
    let raw;
    try {
      raw = JSON.parse(await readFile(resolve(dataRoot, id + ".json"), "utf8"));
    } catch {
      return res.status(404).json({ error: "Saved session not found" });
    }
    if (!Array.isArray(raw.samples) || !raw.samples.length)
      return res
        .status(400)
        .json({ error: "That session has no recorded samples to play back" });
    if (mode !== "playback") await save();
    nativeLink.owner=null; hardwareLink.owner=null; previewEngine.invalidate();
    mode = "playback";
    portPath=null;
    const previousPort=port; port=null; hardwareLink.reset();
    if(previousPort?.isOpen) previousPort.close();
    reset();
    playback = { sessionId: id, meta: raw, samples: raw.samples, index: 0 };
    sessionId = "playback-" + id;
    started = raw.started || started;
    elapsed = raw.samples[0]?.elapsed ?? 0;
    running = false;
    live = null;
    lastPacket = 0;
    event(
      `Playback loaded · session ${id.slice(0, 8)} (recorded ${raw.mode || "unknown"}) · ${raw.samples.length} samples`,
    );
    return res.json(frame());
  }
  if (mode !== "playback") await save();
  nativeLink.owner=null; hardwareLink.owner=null; previewEngine.invalidate();
  mode = nextMode;
  reset();
  playback = null;
  running = true;
  if(mode === "demo") { current=nativeData; if(current?.waveform) config=current.waveform; }
  live = null;
  lastPacket = 0;
  if (mode === "demo") {
    portPath = null;
    const p = port;
    port = null;
    if (p?.isOpen) p.close();
  }
  event(
    mode === "demo"
      ? "Computed workspace · shared firmware C engine"
      : "Hardware mode · awaiting connection",
  );
  res.json(frame());
});
app.post("/api/waveform", (req, res) => res.status(409).json({error:"Use Environment controls. Waveform parameters are selected by the C policy; legacy devices are read-only."}));
function commandLink(req) {
  if(mode === "playback") throw new Error("Playback cannot transmit commands");
  const computed=req.body.target==='COMPUTED';
  if(mode==='demo' && req.body.target==='STM32') throw new Error('No STM32 command target in computed mode');
  if(req.body.target && !['COMPUTED','STM32'].includes(req.body.target)) throw new Error('Invalid command target');
  if(computed && mode !== 'demo' && !companionAvailable()) throw new Error('Computed companion requires a live telemetry-only payload');
  const link = mode === "demo" || computed ? nativeLink : hardwareLink;
  if(!clients.has(req.body.client)) throw new Error("Connect this browser before controlling the transmitter");
  if(!link.ready) throw new Error("Device unavailable or read-only");
  return link;
}
app.post("/api/environment", async (req,res) => {
  const {client,target,profile, ...values} = req.body;
  const parsed=environmentSchema.safeParse(values);
  if(profile ? typeof profile!=='string' || Object.keys(values).length || !['CLEAR_SHALLOW_REEF','MUDDY_ESTUARY','DEEP_OPEN_WATER','SEDIMENT_PLUME'].includes(profile) : !parsed.success)
    return res.status(400).json({error:"Invalid environmental input"});
  try {
    const link=commandLink(req); link.claim(client);
    const e=parsed.data, destination=link===nativeLink?'COMPUTED':'STM32';
    event(`${destination} request sent · ${profile?'SET_ENV '+profile:'SET_ENV_VALUES'}`,'control');
    const ack=await (profile?link.send('SET_ENV',{profile}):link.send('SET_ENV_VALUES',{turbidity:Math.round(e.turbidityIndex*10),depth:Math.round(e.depth*10),temperature:Math.round(e.temperature*10)}));
    event(`${destination} ACK #${ack.id} · ${ack.roundTripMs} ms · ${profile || `index ${e.turbidityIndex}, depth ${e.depth} m, ${e.temperature} °C`}`,"adaptation",{target:destination,requestId:ack.id,session:ack.session,ackMs:ack.roundTripMs,profile,environment:e});
    res.json({...ack,target:destination});
  } catch(e) { res.status(409).json({error:e.message}); }
});
app.post("/api/transmitter", async(req,res) => {
  try {
    const link=commandLink(req), {op,source,mode:waveMode,window,client}=req.body;
    if(!["source","waveform","start","stop","status","get_waveform","ping"].includes(op)) return res.status(400).json({error:"Invalid transmitter action"});
    const fields={};
    if(op === "source") {
      if(!["WEB_COMMAND","ADC_DIAL"].includes(source)) return res.status(400).json({error:"Input source unavailable"});
      fields.source=source;
      if(link===nativeLink && mode==='hardware' && source==='ADC_DIAL') return res.status(409).json({error:'A0 bench control requires adaptive firmware; the mounted A0 sensor remains unchanged'});
    }
    if(op === "waveform") {
      if(!MODES.includes(waveMode)||!WINDOW_NAMES.includes(window)) return res.status(400).json({error:"Invalid modulation or window"});
      fields.mode=MODES.indexOf(waveMode); fields.window=WINDOW_NAMES.indexOf(window);
    }
    if(!['stop','status','get_waveform','ping'].includes(op)) link.claim(client);
    const named={source:'SET_INPUT_SOURCE',start:'START_OUTPUT',stop:'STOP_OUTPUT',status:'GET_STATUS',get_waveform:'GET_WAVEFORM',ping:'PING'}[op] || op;
    const destination=link===nativeLink?'COMPUTED':'STM32';
    event(`${destination} request sent · ${named}${source?' '+source:''}`,'control');
    const ack=await link.send(named,fields);
    if(op === "source" && source === "ADC_DIAL") link.owner=null;
    event(`${destination} ACK #${ack.id} · ${named} · ${ack.roundTripMs} ms`,"control",{target:destination,requestId:ack.id,session:ack.session,ackMs:ack.roundTripMs,command:named,mode:waveMode,window});
    res.json({...ack,target:destination});
  } catch(e) { res.status(409).json({error:e.message}); }
});
app.post("/api/control", async (req, res) => {
  const { action } = req.body;
  if (action === "start") {
    running = true;
    event("Session started");
  } else if (action === "pause") {
    running = false;
    event("Session paused");
  } else if (action === "stop") {
    running = false;
    recording = false;
    if (mode === "playback" && playback) {
      playback.index = 0;
      elapsed = playback.samples[0]?.elapsed ?? 0;
    }
    event("Session stopped");
  } else if (action === "scrub") {
    if (mode !== "playback" || !playback)
      return res.status(409).json({ error: "Scrub requires playback mode" });
    playback.index = Math.max(
      0,
      Math.min(playback.samples.length - 1, Math.round(Number(req.body.index) || 0)),
    );
    elapsed = playback.samples[playback.index]?.elapsed ?? elapsed;
  } else if (action === "record") {
    if (mode === "playback")
      return res.status(409).json({ error: "Recording is not available during playback" });
    recording = !recording;
    event(recording ? "Recording started" : "Recording stopped");
  } else if (["adaptive", "scenario", "scenarioReset"].includes(action)) {
    return res.status(409).json({error:"Use Environment presets to control the shared C adaptation engine"});
  } else if (action === "calibrate") {
    if(mode === 'playback') return res.status(409).json({error:'Playback is read-only'});
    const signal=signalState(mode==='demo'?current:displayLive());
    const echo=signal?.preview?.rx?.echo || [];
    const floor = echo.length
      ? [...echo].sort((a, b) => a - b)[Math.floor(echo.length / 2)]
      : null;
    event(
      floor == null
        ? "Calibration skipped · no echo data"
        : `MODELED RX floor check · median ${floor.toFixed(3)} normalized envelope`,
      "calibration",
    );
  } else if (action === "new") {
    if (mode !== "playback") await save();
    reset();
  } else return res.status(400).json({ error: "Unknown action" });
  res.json(frame());
});
app.post("/api/connect", async (req, res) => {
  if (mode !== "hardware")
    return res.status(409).json({ error: "Switch to hardware mode first" });
  if (port)
    return res.status(409).json({ error: "Already connected or connecting" });
  try {
    await connectSerial(req.body.path);
    res.json(frame());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/disconnect", (req, res) => {
  hardwareLink.reset(); previewEngine.invalidate();
  portPath = null;
  const p = port;
  port = null;
  live = null;
  lastPacket = 0;
  if (p?.isOpen) p.close();
  event("Hardware disconnected");
  res.json(frame());
});
function session() {
  return {
    version: 1,
    sessionId,
    started,
    savedAt: new Date().toISOString(),
    mode,
    elapsed,
    config,
    adaptive,
    scenario,
    seed: "aquasdr-deterministic-v1",
    events,
    samples: recorded,
    sampleLimit: 7200,
    byteLimit: 64 * 1024 * 1024,
  };
}
async function save() {
  await mkdir(dataRoot, { recursive: true });
  await writeFile(
    resolve(dataRoot, sessionId + ".json"),
    JSON.stringify(session(), null, 2),
  );
}
app.post("/api/save", async (req, res) => {
  await save();
  event("Session saved to local storage");
  res.json({ sessionId, samples: recorded.length });
});
app.get("/api/export", (req, res) => {
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="aquasdr-${sessionId.slice(0, 8)}.json"`,
  );
  res.json(session());
});
app.get("/api/sessions", async (req, res) => {
  await mkdir(dataRoot, { recursive: true });
  const files = (await readdir(dataRoot)).filter((f) => f.endsWith(".json"));
  const items = await Promise.all(
    files.map(async (f) => {
      try {
        const raw = JSON.parse(await readFile(resolve(dataRoot, f), "utf8"));
        return {
          id: f.replace(/\.json$/, ""),
          started: raw.started || null,
          savedAt: raw.savedAt || null,
          mode: raw.mode || "unknown",
          elapsed: Number.isFinite(raw.elapsed) ? raw.elapsed : null,
          samples: Array.isArray(raw.samples) ? raw.samples.length : 0,
          events: Array.isArray(raw.events) ? raw.events.length : 0,
        };
      } catch {
        return null;
      }
    }),
  );
  res.json(
    items.filter((s) => s && s.samples > 0).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt)),
  );
});
// One saved session's full record, for playback. Filename is a random UUID
// we generated ourselves (session()'s sessionId), never user input at write
// time — still validated here since it arrives as a URL param.
app.get("/api/sessions/:id", async (req, res) => {
  if (!SESSION_ID_RE.test(req.params.id))
    return res.status(400).json({ error: "Invalid session id" });
  try {
    const raw = JSON.parse(await readFile(resolve(dataRoot, req.params.id + ".json"), "utf8"));
    res.json(raw);
  } catch {
    res.status(404).json({ error: "Saved session not found" });
  }
});
// ---- Bench evidence (MEASURED scope captures and meter readings; never fabricated) ----
const bench = new BenchStore(dataRoot);
app.get("/api/bench", async (req, res) => {
  try { res.json(await bench.evidence()); } catch { res.status(500).json({ error: "Bench evidence unavailable" }); }
});
app.get("/api/bench/traces", async (req, res) => {
  const point = String(req.query.point || "");
  const t = ["PA4", "FILTER_OUT", "OPAMP_OUT"].includes(point) ? await bench.latestTraces(point) : null;
  t ? res.json(t) : res.status(404).json({ error: "No measured capture for that point" });
});
// Body is the raw oscilloscope CSV (text/csv). Parameters travel in the query string.
app.post("/api/bench/capture", express.text({ type: ["text/csv", "text/plain"], limit: "40mb" }), async (req, res) => {
  try {
    const q = req.query, csv = typeof req.body === "string" ? req.body : "";
    if (!csv) return res.status(400).json({ error: "Send the scope CSV as the request body (Content-Type: text/csv)" });
    const num = (k) => (q[k] === undefined || q[k] === "" ? undefined : Number(q[k]));
    const custom = q.profile ? undefined : { frequency: num("frequency"), bandwidth: num("bandwidth"), pulse: num("pulse"), amplitude: num("amplitude") };
    const { name, record } = await bench.addCapture({ csv, point: String(q.point || ""), profile: q.profile ? String(q.profile) : null,
      window: String(q.window || ""), mode: q.mode ? String(q.mode) : "LFM CHIRP", config: custom, label: String(q.label || "").slice(0, 80),
      instrument: { name: q.instrument ? String(q.instrument).slice(0, 80) : null, probe: q.probe ? String(q.probe).slice(0, 20) : null, coupling: q.coupling ? String(q.coupling).slice(0, 10) : null },
      sourceName: String(q.file || "").slice(0, 120), notes: String(q.notes || "").slice(0, 400), rate: num("rate"), channel: num("channel"), gain: num("gain") });
    event(`Measured capture stored · ${record.point} · ${record.window} · ${record.comparison.allPass ? "within tolerance" : "outside tolerance"}`);
    res.status(201).json({ name, point: record.point, allPass: record.comparison.allPass, comparison: record.comparison.rows });
  } catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 200) }); }
});
app.post("/api/bench/power", async (req, res) => {
  try { const { name, record } = await bench.addPower(req.body); res.status(201).json({ name, record }); }
  catch (error) { res.status(400).json({ error: String(error.message || error).slice(0, 200) }); }
});
// ---- MCU ADC CAPTURE: the board samples its own DAC pin. Stored and labelled apart from oscilloscope evidence. ----
app.get("/api/bench/mcu", async (req, res) => { try { res.json(await bench.mcuEvidence()); } catch { res.status(500).json({ error: "MCU captures unavailable" }); } });
app.get("/api/bench/mcu/traces", async (req, res) => { const t = await bench.mcuTraces(req.query.name ? String(req.query.name) : null); t ? res.json(t) : res.status(404).json({ error: "No MCU capture stored" }); });
app.get("/api/bench/mcu/:name.csv", (req, res) => {
  const path = bench.csvPath(req.params.name);
  if (!path) return res.status(400).json({ error: "Invalid capture name" });
  res.download(path, `${req.params.name}.csv`, (e) => { if (e && !res.headersSent) res.status(404).json({ error: "Capture file not found" }); });
});
// CAPTURE_DAC: one controlled capture. The firmware enables output for one pulse (or two in train mode), samples PA4, stops the output
// again by itself, then streams the samples. This route never leaves output running.
app.post("/api/bench/mcu-capture", async (req, res) => {
  try {
    const link = commandLink(req);
    if (link === nativeLink) return res.status(409).json({ error: "MCU capture needs the STM32 in hardware mode" });
    if (!live?.identity?.capabilities?.includes("DAC_CAPTURE")) return res.status(409).json({ error: "This firmware does not advertise DAC_CAPTURE" });
    const mode = req.body.mode === 1 || req.body.mode === "train" ? 1 : 0;
    const wf = live.requestedWaveform;
    if (!wf) return res.status(409).json({ error: "No qualified environment: apply an environment first" });
    const expected = { mode: wf.mode, frequency: wf.frequency, bandwidth: wf.bandwidth, pulse: wf.pulse, amplitude: wf.amplitude };
    // Which circuit node the ADC input is wired to. The firmware cannot tell, so the operator declares it; a wrong declaration shows up as a failed comparison.
    const tap = req.body.tap === undefined ? DEFAULT_TAP : String(req.body.tap);
    checkTap(tap);
    if (tap !== DEFAULT_TAP) {
      const range = predictedAdcRange({ ...expected, window: wf.window }, tap);
      if (!range.safe) return res.status(409).json({ error: `Refused: this waveform would put the ADC pin at ${range.min.toFixed(2)} to ${range.max.toFixed(2)} V on ${tap}; the safe range is 0.10 to 3.20 V. Lower the amplitude first.` });
    }
    const window = wf.window, profile = live.control?.profile || null, firmware = { id: live.identity.id, version: live.identity.version, build: live.identity.build, platform: live.identity.platform };
    link.claim(req.body.client);
    const waiting = mcu.waitForNext(20000); waiting.catch(() => {});
    event(`STM32 request sent · CAPTURE_DAC ${mode ? "train" : "pulse"}`, "control");
    const ack = await link.send("CAPTURE_DAC", { mode });
    event(`STM32 ACK #${ack.id} · CAPTURE_DAC · ${ack.roundTripMs} ms`, "control", { target: "STM32", requestId: ack.id });
    const cap = await waiting;
    const c = live?.capture, deviceStats = c && c.id === cap.id ? { minCounts: c.minCounts, maxCounts: c.maxCounts, meanCounts: c.meanCounts } : null;
    const { name, record } = await bench.addMcu({ id: cap.id, mode: cap.mode, rate: cap.rate, counts: cap.counts, expected, profile, window, deviceStats, firmware, tap, label: String(req.body.label || "").slice(0, 80) });
    event(`MCU ADC CAPTURE stored · ${record.mode} · ${record.tap} · ${record.comparison.allPass ? "within tolerance of the calculation" : "differs from the calculation"}`, "info");
    res.status(201).json({ name, tap: record.tap, mode: record.mode, allPass: record.comparison.allPass, rows: record.comparison.rows, deviceStatsAgree: record.deviceStatsAgree, provenance: record.provenance });
  } catch (error) { res.status(409).json({ error: String(error.message || error).slice(0, 200) }); }
});
app.use(express.static(resolve(root, "dist")));
app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(500).json({ error: "Request could not be completed" });
});
server.listen(bridgePort, host, () =>
  console.log(`AquaSDR bridge · http://${host}:${bridgePort}`),
);
