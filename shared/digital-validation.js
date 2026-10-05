import { spectrum } from './signal.js';
export function validateReference(reference, config) {
  const samples=reference.samples, sampleRate=reference.sampleRate;
  if(!samples?.length || !Number.isFinite(sampleRate)) return null;
  if(samples.every(value=>value===0)) return {provenance:'COMPUTED',sampleRate,samples:samples.length,
    durationMs:samples.length/sampleRate*1000,centerKHz:null,peakKHz:null,occupiedBandwidthKHz:null,
    peakAmplitudePercent:0,rms:0,dacCodeMin:2048,dacCodeMax:2048,window:config.window};
  const bins=spectrum(samples,sampleRate), power=bins.map(b=>10**(b.db/10));
  const total=power.reduce((a,b)=>a+b,0);
  let cumulative=0, low=null, high=null, weighted=0, peak=bins[0];
  for(let i=0;i<bins.length;i++) {
    cumulative+=power[i]; weighted+=bins[i].frequency*power[i];
    if(low===null && cumulative>=total*.005) low=bins[i].frequency;
    if(high===null && cumulative>=total*.995) high=bins[i].frequency;
    if(bins[i].db>peak.db) peak=bins[i];
  }
  let minimum=4095,maximum=0,energy=0;
  for(const value of samples) {
    const code=Math.round(2048+value*2047);
    minimum=Math.min(minimum,code);maximum=Math.max(maximum,code);energy+=value*value;
  }
  return {provenance:'COMPUTED',sampleRate,samples:samples.length,durationMs:samples.length/sampleRate*1000,
    centerKHz:weighted/total/1000,peakKHz:peak.frequency/1000,occupiedBandwidthKHz:(high-low)/1000,
    peakAmplitudePercent:Math.max(maximum-2048,2048-minimum)/2047*100,
    rms:Math.sqrt(energy/samples.length),dacCodeMin:minimum,dacCodeMax:maximum,window:config.window};
}
