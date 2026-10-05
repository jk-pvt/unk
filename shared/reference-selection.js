// Selection previews do not represent an applied decision or physical output.
export function referenceSelection(signal, fallback) {
  return signal?.requestedWaveform || signal?.waveform || fallback;
}
export function referenceMatches(preview, config) {
  return !!preview?.config && !!config && ['mode','frequency','bandwidth','pulse','amplitude','window']
    .every(key=>preview.config[key]===config[key]);
}
export function displayReference(signal, inspection, fallback) {
  if(signal?.preview?.tx && referenceMatches(signal.preview,signal.waveform)) return signal.preview;
  return referenceMatches(inspection,referenceSelection(signal,fallback))?inspection:null;
}
