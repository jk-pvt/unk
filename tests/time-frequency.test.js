import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeEngine} from '../server/native-engine.js';
import {timeFrequency} from '../shared/time-frequency.js';

test('spectrogram resolves narrow C chirps using a sample-derived frequency trajectory',async()=>{
 const native=new NativeEngine();let ready=false;
 native.on('packet',p=>{if(p.type==='telemetry') ready=true;});
 try {
  await native.start();const deadline=Date.now()+4000;
  while(!ready) {assert(Date.now()<deadline,'Native loop did not become ready');await new Promise(r=>setTimeout(r,20));}
  for(const [mode,frequency,bandwidth,pulse] of [['LFM CHIRP',38,1,8],['GEOMETRIC SWEEP',38,1,8],['LFM CHIRP',42,4,2]]) {
   const config={mode,frequency,bandwidth,pulse,amplitude:62,window:'HANN'};
   const reference=await native.render(config);
   const view=timeFrequency(reference.samples,reference.sampleRate,config);
   assert.equal(view.durationMs,pulse);assert.equal(view.coded,false);
   assert(view.windowSize>256);assert(view.resolutionHz<=bandwidth*1000);
   const earlier=view.frames[16].centroidHz,later=view.frames[47].centroidHz;
   assert(earlier<frequency*1000 && later>frequency*1000);
   assert(later-earlier>bandwidth*1000*.3);
   // The trajectory follows samples, not the nominal positive sweep metadata.
   const reversed=timeFrequency([...reference.samples].reverse(),reference.sampleRate,config);
   assert(reversed.frames[16].centroidHz>reversed.frames[47].centroidHz);
  }
  const code={mode:'PHASE-CODED PULSE',frequency:38,bandwidth:1,pulse:8,amplitude:62,window:'BLACKMAN'};
  const ref=await native.render(code);assert.equal(timeFrequency(ref.samples,ref.sampleRate,code).coded,true);
 } finally {native.close();}
});
test('spectrogram silence and missing samples never create a chirp ridge',()=>{
 const config={frequency:38,bandwidth:1,pulse:8};
 assert.equal(timeFrequency([],1e6,config),null);
 const view=timeFrequency(Array(8000).fill(0),1e6,config);
 assert(view.frames.every(f=>f.centroidHz===null));
});
