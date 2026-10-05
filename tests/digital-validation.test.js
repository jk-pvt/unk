import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReference} from '../shared/digital-validation.js';
import {NativeEngine} from '../server/native-engine.js';
import {modelAcousticFrame} from '../shared/acoustic.js';
const config={mode:'LFM CHIRP',frequency:42,bandwidth:4,pulse:2,amplitude:35,window:'HANN'};
test('digital checks use the actual C reference sample buffer and DAC codes',async()=>{
 const native=new NativeEngine();let ready=false;
 native.on('packet',packet=>{if(packet.type==='telemetry') ready=true;});
 try {
  await native.start();
  const deadline=Date.now()+4000;
  while(!ready) {assert(Date.now()<deadline,'Native loop did not become ready');await new Promise(r=>setTimeout(r,20));}
  const reference=await native.render(config),checks=validateReference(reference,config);
  assert.equal(checks.samples,2000);assert.equal(checks.durationMs,2);assert.equal(checks.sampleRate,1e6);
  assert(Math.abs(checks.centerKHz-42)<.15);assert(Math.abs(checks.peakAmplitudePercent-35)<.2);
  assert(checks.occupiedBandwidthKHz>0);assert(checks.dacCodeMin>0 && checks.dacCodeMax<4095);
  const codes=reference.samples.map(s=>Math.round(2048+s*2047));assert.equal(checks.dacCodeMin,Math.min(...codes));assert.equal(checks.dacCodeMax,Math.max(...codes));
 }finally{native.close();}
});
test('silence does not produce fabricated frequency or bandwidth estimates',()=>{
 const result=validateReference({samples:Array(100).fill(0),sampleRate:1e6},config);
 assert.equal(result.centerKHz,null);assert.equal(result.peakKHz,null);assert.equal(result.occupiedBandwidthKHz,null);
 assert.equal(result.dacCodeMin,2048);assert.equal(result.dacCodeMax,2048);
});
test('each environmental preset changes modeled RX even when policy classes coincide',()=>{
 const inputs=[{turbidity:12,depth:3,temperature:26},{turbidity:85,depth:18,temperature:24.8},
  {turbidity:10,depth:80,temperature:10},{turbidity:95,depth:12,temperature:22}];
 const frames=inputs.map(sensors=>modelAcousticFrame({config,sensors,elapsed:0,frame:0}));
 for(let i=0;i<frames.length;i++)for(let j=i+1;j<frames.length;j++) {
   assert.notDeepEqual(frames[i].samples,frames[j].samples);assert.notDeepEqual(frames[i].echo,frames[j].echo);
 }
});
