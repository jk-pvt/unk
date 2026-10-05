import { parentPort } from "node:worker_threads";
import { modelAcousticFrame } from "../shared/acoustic.js";
import { validateReference } from "../shared/digital-validation.js";
parentPort.on("message", ({ id, config, reference, environment, elapsed }) => {
  try {
    // Decimate the authoritative C buffer by four with a 63-tap Hann low-pass,
    // 80 kHz cutoff, unity DC gain, and compensated 31-sample group delay.
    const input = reference.samples, taps = 63, half = 31, cutoff = 80000 / reference.sampleRate;
    const kernel = Array.from({length: taps}, (_, i) => {
      const x = i - half;
      return (x ? Math.sin(2*Math.PI*cutoff*x)/(Math.PI*x) : 2*cutoff) * (0.5-0.5*Math.cos(2*Math.PI*i/(taps-1)));
    });
    const sum = kernel.reduce((a,b)=>a+b,0);
    const tx = Float64Array.from({length: Math.ceil(input.length/4)}, (_, i) => {
      let value = 0;
      for (let k=0;k<taps;k++) value += (input[i*4+k-half] || 0)*kernel[k]/sum;
      return value;
    });
    const model = modelAcousticFrame({ config, txReference: tx, referenceRate: reference.sampleRate/4, elapsed,
      sensors: { turbidity: environment.turbidityIndex, depth: environment.depth, temperature: environment.temperature } });
    parentPort.postMessage({id, preview: { provenance: "MODEL", config, environment,
      digitalChecks:validateReference(reference,config),
      tx: { ...reference, provenance: "CALCULATED_C_REFERENCE" }, rx: { ...model, provenance: "MODELED_RX" } }});
  } catch(e) { parentPort.postMessage({id,error:e.message}); }
});
