import {spectrum} from './signal.js';

// The window scales with pulse length and sweep width. A fixed 256 samples at
// 1 MHz cannot resolve a 1 kHz sweep. Zero padding interpolates the display;
// the reported resolution remains sampleRate / windowSize.
export function timeFrequency(samples, sampleRate, config, columns = 64) {
  if(!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  const duration=samples.length/sampleRate;
  const pulse=Math.min(duration,Math.max(.0001,(config.pulse || 2)/1000));
  const coded=config.mode==='PHASE-CODED PULSE';
  const width=coded ? 13/pulse : Math.max(500,(config.bandwidth || 2)*1000);
  const desired=Math.min(pulse/3,Math.sqrt(pulse/width))*sampleRate;
  const windowSize=Math.max(32,Math.min(2048,2**Math.round(Math.log2(Math.max(32,desired)))));
  const fftSize=windowSize*4, resolutionHz=sampleRate/windowSize;
  const center=(config.frequency || 40)*1000;
  const half=Math.max(width*(coded ? .85 : .65),resolutionHz*.8);
  const low=Math.max(0,center-half), high=Math.min(sampleRate/2,center+half);
  const first=Math.max(0,Math.floor(low*fftSize/sampleRate));
  const last=Math.min(fftSize/2-1,Math.ceil(high*fftSize/sampleRate));
  let maximum=-100;
  const frames=Array.from({length:columns},(_,index)=>{
    const at=Math.round(index*(samples.length-1)/Math.max(1,columns-1));
    const start=at-Math.floor(windowSize/2);
    const segment=Float64Array.from({length:windowSize},(_,k)=>samples[start+k] || 0);
    const bins=spectrum(segment,sampleRate,fftSize).slice(first,last+1);
    let sum=0,weighted=0,peak=-100;
    for(const b of bins) {
      const power=10**(b.db/10);sum+=power;weighted+=power*b.frequency;
      peak=Math.max(peak,b.db);
    }
    maximum=Math.max(maximum,peak);
    return {timeMs:at/sampleRate*1000,bins,peakDb:peak,centroidHz:sum>1e-9?weighted/sum:null};
  });
  // Hide low-energy edge/noise centroids; no ridge is fabricated for silence.
  for(const frame of frames) if(frame.peakDb < maximum-28 || frame.peakDb <= -95) frame.centroidHz=null;
  return {frames,lowHz:low,highHz:high,durationMs:duration*1000,windowSize,resolutionHz,
    maximumDb:maximum,coded};
}
