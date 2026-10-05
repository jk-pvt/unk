import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { SerialPort } from "serialport";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DEFAULT_CONFIG, simulation } from "../shared/signal.js";
import { configSchema, LineParser } from "../shared/protocol.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = express(),
  server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: "/ws/telemetry",
  maxPayload: 1048576,
});
app.use(express.json({ limit: "1mb" }));
// Loopback only. Reject cross-origin mutations (including DNS rebinding).
app.use((req, res, next) => {
  const host = (req.headers.host || "").split(":")[0];
  if (!["localhost", "127.0.0.1"].includes(host))
    return res.status(403).json({ error: "Local access only" });
  if (
    req.method !== "GET" &&
    req.headers.origin &&
    ![
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4318",
      "http://127.0.0.1:4318",
    ].includes(req.headers.origin)
  )
    return res.status(403).json({ error: "Origin denied" });
  next();
});
let config = { ...DEFAULT_CONFIG },
  mode = "demo",
  running = true,
  recording = false,
  adaptive = true,
  scenario = false;
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
function event(message, kind = "info") {
  events.unshift({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    elapsed,
    message,
    kind,
    source: mode,
  });
  events = events.slice(0, 500);
}
event("Demo session initialized · deterministic test bench");
event("LFM chirp loaded · 200 kHz / 40 kHz bandwidth");
function frame() {
  const fresh =
    mode === "hardware" &&
    lastPacket &&
    Date.now() - lastPacket < 3000 &&
    port?.isOpen;
  return {
    type: "state",
    mode,
    running,
    recording,
    adaptive,
    scenario,
    elapsed,
    config,
    sessionId,
    started,
    seq,
    current: mode === "demo" ? current : fresh ? live : null,
    events: events.slice(0, 30),
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
    history,
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
      "http://localhost:4318",
      "http://127.0.0.1:4318",
    ].includes(req.headers.origin)
  )
    return socket.close(1008, "Origin denied");
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
  const row = {
    timestamp: new Date().toISOString(),
    elapsed,
    source: mode === "demo" ? "demo" : "hardware",
    config: { ...config },
    scenario,
    adaptive,
    ...data,
  };
  history.push({ elapsed, sensors: data.sensors, power: data.power });
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
setInterval(() => {
  if (running) {
    elapsed += 0.25;
    seq++;
    if (mode === "demo") {
      const data = simulation(elapsed, config, scenario);
      if (
        adaptive &&
        data.sensors.turbidity > 30 &&
        (config.mode !== "LFM CHIRP" ||
          config.bandwidth !== 25 ||
          config.pulse !== 10)
      ) {
        config = { ...config, mode: "LFM CHIRP", bandwidth: 25, pulse: 10 };
        event(
          "Turbidity > 30 NTU · demo policy set LFM chirp, bandwidth 25 kHz, pulse 10 ms",
          "adaptation",
        );
      }
      current = simulation(elapsed, config, scenario);
      energy += (current.power.watts * 0.25) / 3600;
      current.power.energy = energy;
      remember(current);
    }
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
  const parser = new LineParser(
    (packet) => {
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
      live = { ...packet.payload, timestamp: packet.timestamp };
      if (packet.payload.waveform) config = packet.payload.waveform;
      if (running) remember(live);
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
for (const key of ["sensors", "power", "waveform", "hardware", "logs"])
  app.get("/api/" + key, (req, res) => {
    const state = frame();
    res.json(
      key === "waveform"
        ? config
        : key === "logs"
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
  if (!["demo", "hardware"].includes(req.body.mode))
    return res.status(400).json({ error: "Invalid mode" });
  await save();
  mode = req.body.mode;
  reset();
  running = true;
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
      ? "Demo mode · all telemetry simulated"
      : "Hardware mode · awaiting connection",
  );
  res.json(frame());
});
app.post("/api/waveform", async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "Waveform parameters are out of range" });
  if (mode === "hardware")
    return res.status(409).json({
      error:
        "Hardware transmit control is not commissioned. Telemetry monitoring only.",
    });
  config = parsed.data;
  adaptive = false;
  event(
    `Operator set ${config.mode} · ${config.frequency} kHz, ${config.bandwidth} kHz BW`,
    "waveform",
  );
  res.json(frame());
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
    event("Session stopped");
  } else if (action === "record") {
    recording = !recording;
    event(recording ? "Recording started" : "Recording stopped");
  } else if (action === "adaptive") {
    if (mode !== "demo")
      return res
        .status(409)
        .json({ error: "Demo policy is available in demo mode only" });
    adaptive = !adaptive;
    event(
      adaptive
        ? "Demo adaptation policy enabled"
        : "Manual waveform control enabled",
    );
  } else if (action === "scenario") {
    if (mode !== "demo")
      return res.status(409).json({ error: "Scenario requires demo mode" });
    scenario = !scenario;
    event(
      scenario
        ? "Test scenario · turbidity increased by 24 NTU"
        : "Test scenario cleared",
      "adaptation",
    );
  } else if (action === "new") {
    await save();
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
  await mkdir(resolve(root, "data"), { recursive: true });
  await writeFile(
    resolve(root, "data", sessionId + ".json"),
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
  await mkdir(resolve(root, "data"), { recursive: true });
  const files = await readdir(resolve(root, "data"));
  res.json(files.filter((f) => f.endsWith(".json")));
});
app.use(express.static(resolve(root, "dist")));
app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(500).json({ error: "Request could not be completed" });
});
server.listen(4318, "127.0.0.1", () =>
  console.log("AquaSDR bridge · http://127.0.0.1:4318"),
);
