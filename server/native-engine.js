import { spawn, execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { MODES, WINDOW_NAMES } from "../shared/environment.js";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
export class NativeEngine extends EventEmitter {
  constructor() { super(); this.error = null; this.references = new Map(); this.next = 0; }
  async start() {
    try {
      const directory = `${root}firmware/build-host`;
      await mkdir(directory, { recursive: true });
      const output = await mkdtemp(`${directory}/run-`);
      await exec(process.env.CC || "cc", ["-O2", "-std=c11", "-Wall", "-Wextra", "-Werror", "-I", `${root}firmware/src`,
        ...["host/engine.c", "src/control.c", "src/command.c", "src/adaptation.c", "src/waveform.c", "src/telemetry.c", "src/capture.c"].map(p => `${root}firmware/${p}`),
        "-lm", "-o", `${output}/engine`]);
      this.child = spawn(`${output}/engine`, [], { stdio: ["pipe", "pipe", "pipe"] });
      let buffer = "";
      this.child.stdout.on("data", chunk => {
        buffer += chunk;
        if (buffer.length > 2e6) return this.fail(new Error("Native frame exceeds limit"));
        let at;
        while ((at = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
          try {
            const p = JSON.parse(line);
            if (p.type === "reference") {
              const task = this.references.get(p.id);
              if (task) { clearTimeout(task.timer); this.references.delete(p.id); task.resolve({ samples: p.codes.map(v => (v - 2048) / 2047), sampleRate: p.sampleRate }); }
            } else this.emit("packet", p);
          } catch (e) { this.fail(e); }
        }
      });
      this.child.stdin.on("error", e => this.fail(e));
      this.child.on("error", e => this.fail(e));
      this.child.on("exit", () => this.fail(new Error("Native C engine stopped")));
      this.child.stderr.on("data", chunk => { this.diagnostic = String(chunk); });
      return this;
    } catch (e) { this.fail(new Error(`Host C engine unavailable: ${e.message}`)); return this; }
  }
  fail(error) {
    this.error = error.message;
    for (const task of this.references.values()) { clearTimeout(task.timer); task.reject(error); }
    this.references.clear(); this.emit("unavailable", this.error);
  }
  write(command) {
    if (this.error || !this.child?.stdin.writable) throw new Error(this.error || "Native engine starting");
    this.child.stdin.write(JSON.stringify(command) + "\n");
  }
  render(config) {
    if (this.error || !this.child?.stdin.writable) return Promise.reject(new Error(this.error || "Native engine starting"));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.references.delete(id); reject(new Error("C reference timed out")); }, 2000);
      this.references.set(id, { resolve, reject, timer });
      this.child.stdin.write(`!render ${id} ${MODES.indexOf(config.mode)} ${WINDOW_NAMES.indexOf(config.window)} ${config.frequency} ${config.bandwidth} ${config.pulse} ${config.amplitude}\n`);
    });
  }
  close() { this.child?.kill(); }
}
