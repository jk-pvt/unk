import { randomInt } from "node:crypto";
export class ControlLink {
  constructor(write, { timeout = 2000 } = {}) { this.write = write; this.timeout = timeout; this.reset(); }
  reset() {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error("Connection reset; command outcome unknown")); }
    this.pending = null; this.ready = false; this.session = randomInt(1, 0x7fffffff); this.id = 0;
    this.owner = null; this.ownerSeen = 0; this.lastHeartbeat = 0; this.telemetryAt = 0;
    this.unknown = false; this.status = "READ_ONLY"; this.lastUptime = null;
    this.halting=false;
  }
  receive(packet) {
    if (packet.type === "ack") {
      const p = this.pending;
      if (!p || packet.session !== this.session || packet.id !== p.id) return;
      clearTimeout(p.timer); this.pending = null;
      if(p.op !== "keepalive") this.status = packet.status;
      if (packet.status === "ACCEPTED") { if (p.op === "hello" || p.op === "PING") { this.ready = true; this.unknown = false; } p.resolve({ ...packet, roundTripMs: Date.now() - p.started }); }
      else p.reject(new Error(packet.reason));
      return;
    }
    const c = packet.payload?.control;
    if (packet.payload?.capabilities?.controlVersion !== 1 || !c) return;
    if (this.lastUptime != null && (c.uptimeMs < this.lastUptime || (this.ready && c.session !== this.session))) this.reset();
    this.lastUptime = c.uptimeMs; this.telemetryAt = Date.now();
    if(c.outputEnabled===false && !this.pending) this.halting=false;
    if (this.unknown && c.session === this.session) { this.unknown = false; this.status = "RECONCILED"; }
    if (!this.ready && !this.pending) this.send("PING", {}, true).catch(() => {});
  }
  async send(op, fields = {}, handshake = false) {
    if (!handshake && (!this.ready || Date.now() - this.telemetryAt > 3000)) throw new Error("Device unavailable or read-only");
    if(this.pending?.op === "keepalive" && op !== "keepalive") await this.pending.promise;
    // A handshake is allowed while the outcome of an earlier command is unknown: PING/hello establishes a fresh session, which is the only
    // thing that can end that state when the device never answered (it reports session 0, so telemetry alone never reconciles it).
    if (this.pending || (this.unknown && !handshake)) throw new Error(this.unknown ? "Command outcome unknown; awaiting fresh telemetry" : "Another command is awaiting acknowledgement");
    const id = ++this.id;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null; this.unknown = true; this.status = "UNKNOWN";
        reject(new Error("Acknowledgement timed out; command outcome unknown"));
      }, this.timeout);
      this.pending = { id, op, timer, resolve, reject, started: Date.now() };
      if(op !== "keepalive") this.status = "SENDING";
      try { this.write({ version: 1, session: this.session, id, op, ...fields }); }
      catch (e) { clearTimeout(timer); this.pending = null; this.status = "WRITE_FAILED"; reject(e); }
    });
    if(this.pending) this.pending.promise = promise;
    return promise;
  }
  claim(client) {
    if(this.halting) throw new Error('Output stop is awaiting reconciliation');
    if (this.owner && this.owner !== client && Date.now() - this.ownerSeen < 2000) throw new Error("Another browser holds web control");
    this.owner = client; this.ownerSeen = Date.now();
  }
  heartbeat(client) { if (client === this.owner) this.ownerSeen = Date.now(); }
  async halt() {
    this.owner=null;this.ownerSeen=0;this.halting=true;
    try {
      if(this.pending?.promise) await this.pending.promise;
      await this.send('stop');this.halting=false;
    } catch(e) {
      // Do not renew output during uncertainty. Firmware lease is the backup;
      // a fresh disabled-state packet reconciles the stop before another owner.
      throw e;
    }
  }
  maintain(web) {
    const now = Date.now();
    if (!web || this.halting || !this.owner || now - this.ownerSeen >= 1500 || now - this.lastHeartbeat < 500 || this.pending || this.unknown || !this.ready) return;
    this.lastHeartbeat = now;
    this.send("keepalive").catch(() => {});
  }
  snapshot() { return { ready: this.ready, status: this.status, pending: this.halting || !!this.pending && this.pending.op !== "keepalive", unknown: this.unknown }; }
}
