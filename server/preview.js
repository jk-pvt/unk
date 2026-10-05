import { Worker } from "node:worker_threads";
export class PreviewEngine {
  constructor(native, accept) {
    this.native = native; this.accept = accept; this.generation = 0; this.busy = false;
    this.worker = new Worker(new URL("./preview-worker.js", import.meta.url));
    this.worker.on("message", ({id, preview, error}) => {
      this.busy = false;
      if (id === this.generation) this.accept(preview || { error, provenance: "UNAVAILABLE" });
    });
    this.worker.on("error", e => { this.failed = true; this.busy = false; this.accept({error:e.message,provenance:"UNAVAILABLE"}); });
  }
  invalidate() { this.generation++; this.latest = null; }
  request(data, elapsed, {inspection=false}={}) {
    const signature = JSON.stringify([data.waveform, data.environment]);
    // sampledMs is acquisition metadata, not a model input.
    const key = JSON.stringify([data.waveform, data.environment?.source, data.environment?.turbidityIndex, data.environment?.depth, data.environment?.temperature]);
    if (key !== this.key) { this.generation++; this.key = key; }
    this.latest = { data, elapsed, signature };
    if (!data.waveform || !inspection && !data.control?.hasApplied || this.failed || this.busy || Date.now() - (this.last || 0) < 250) return;
    this.last = Date.now(); this.busy = true;
    const id = this.generation, config = data.waveform, environment = data.environment;
    const configKey = JSON.stringify(config);
    Promise.resolve(configKey === this.referenceKey ? this.reference : this.native.render(config)).then(reference => {
      this.referenceKey = configKey; this.reference = reference;
      if (id !== this.generation) { this.busy = false; return; }
      this.worker.postMessage({id, config, reference, environment, elapsed});
    }).catch(e => { this.busy = false; if(id === this.generation) this.accept({error:e.message,provenance:"UNAVAILABLE"}); });
  }
  close() { this.worker.terminate(); }
}
