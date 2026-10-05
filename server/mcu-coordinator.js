// Collects capture chunks from the serial stream and hands finished captures to whoever asked for one.
import { CaptureAssembler } from "../shared/mcu-capture.js";

export class McuCaptureCoordinator {
  constructor() { this.asm = new CaptureAssembler(); this.waiters = []; this.last = null; this.lastError = null; }
  ingest(packet) {
    const r = this.asm.add(packet);
    if (r.error) { this.lastError = { id: packet.id, error: r.error, at: Date.now() }; for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.reject(new Error(`Capture ${packet.id} failed: ${r.error}`)); } return r; }
    if (r.complete) {
      this.last = { ...r.complete, at: Date.now() };
      for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.resolve(this.last); }
    }
    return r;
  }
  // Resolves with the next capture that completes, rejects on a chunk error or timeout. Create it BEFORE sending the command.
  waitForNext(timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const w = { resolve, reject, timer: setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); reject(new Error("Timed out waiting for capture data")); }, timeoutMs) };
      this.waiters.push(w);
    });
  }
}
