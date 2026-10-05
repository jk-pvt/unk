import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngine } from '../server/native-engine.js';
import { ControlLink } from '../server/control-link.js';
import { parsePacket } from '../shared/protocol.js';
import { PreviewEngine } from '../server/preview.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,ms=4000){const start=Date.now();while(!check()){if(Date.now()-start>ms)throw new Error('Timed out');await pause(20);}}
test('native firmware loop applies environment, synthesizes C reference, and isolates modeled RX',async()=>{
 const native=new NativeEngine();const link=new ControlLink(c=>native.write(c));let data,preview,errors=[];
 native.on('packet',raw=>{try{const p=parsePacket(JSON.stringify(raw));link.receive(p);if(p.type==='telemetry')data=p.payload;}catch(e){errors.push(e)}});
 const engine=new PreviewEngine(native,p=>preview=p);
 try{
  await native.start();await until(()=>link.ready);
  await link.send('SET_INPUT_SOURCE',{source:'WEB'});
  const ack=await link.send('SET_ENV',{profile:'CLEAR_SHALLOW_REEF'});assert.equal(ack.status,'ACCEPTED');await until(()=>data?.control.qualified);
  assert.equal(data.waveform,undefined);
  assert.equal(data.applicationAck,undefined);
  await link.send('START_OUTPUT');await until(()=>data?.waveform?.frequency===42);
  assert.equal(data.applicationAck.id,ack.id);assert.equal(data.applicationAck.session,ack.session);
  assert.equal(data.environment.profile,'CLEAR_SHALLOW_REEF');assert.equal(data.firmwareMode,'ADAPTIVE_TRANSMITTER');
  const seq=data.control.lastRequestId;const status=await link.send('GET_STATUS');
  await until(()=>data.control.lastRequestId===status.id);assert(status.id>seq);assert(data.control.outputEnabled);
  const samples=await native.render(data.waveform);assert.equal(samples.samples.length,2000);assert.equal(samples.sampleRate,1e6);
  engine.request(data,0);await until(()=>preview?.rx);assert.equal(preview.provenance,'MODEL');assert.deepEqual(preview.tx.samples,samples.samples);
  assert.equal(preview.digitalChecks.durationMs,2);assert.equal(preview.digitalChecks.window,'HANN');
  assert.equal(preview.digitalChecks.provenance,'COMPUTED');
  assert.equal(data.samples,undefined);assert.equal(data.sensors.turbidity,null);assert.equal(data.validation,undefined);assert.equal(data.power.watts,null);
  const before=preview.rx.samples;
  await link.send('SET_ENV_VALUES',{turbidity:120,depth:30,temperature:100});await until(()=>data.environment.temperature===10);
  await until(()=>{engine.request(data,0);return preview.environment.temperature===10;});assert.notDeepEqual(preview.rx.samples,before);
  await link.send('environment',{turbidity:100,depth:800,temperature:100});await until(()=>data?.waveform?.frequency===38);
  assert.equal(data.waveform.pulse,8);
  await link.send('waveform',{mode:2,window:3});await until(()=>data?.waveform?.mode==='PHASE-CODED PULSE');assert.equal(data.waveform.window,'BLACKMAN');
  await until(()=>data.control.reason==='WEB_LEASE_EXPIRED',3500);assert.equal(data.control.outputEnabled,false);
  await link.send('STOP_OUTPUT');assert.equal(data.applicationAck.id,data.control.appliedRequestId);
  assert.equal(errors.length,0);
 }finally{engine.close();native.close();}
});
test('missing host compiler reports unavailable without a JavaScript fallback',async()=>{
 const old=process.env.CC;process.env.CC='/nonexistent/aquasdr-test-compiler';
 const native=new NativeEngine();let reason;
 native.on('unavailable',s=>reason=s);
 try{await native.start();assert.match(reason,/Host C engine unavailable/);assert.equal(native.child,undefined);await assert.rejects(native.render({}),/unavailable/);}
 finally{if(old===undefined)delete process.env.CC;else process.env.CC=old;native.close();}
});
