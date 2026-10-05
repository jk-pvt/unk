import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PROFILES, referenceFor} from '../shared/bench-capture.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
// Synthetic scope CSV made in the test (never evidence). 5 MS/s, MURKY/HANN at PA4.
function csv(){const rate=5e6,ref=referenceFor({...PROFILES.MURKY,window:'HANN'},1,rate),n=rate*0.02,o=new Float64Array(n);ref.samples.forEach((v,i)=>{o[15000+i]=v});
 return 'Time (s),CH1 (V)\n'+Array.from(o,(v,i)=>`${(i/rate).toExponential(6)},${(v+1.65).toFixed(5)}`).join('\n');}
test('bench API: empty means awaiting measurement; uploads become MEASURED records; bad input is rejected',async()=>{
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const directory=await mkdtemp(join(tmpdir(),'aquasdr-bench-'));
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port),AQUASDR_DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
 let started=false,logs='';child.stdout.on('data',s=>{logs+=s;started=logs.includes('AquaSDR bridge')});child.stderr.on('data',s=>logs+=s);
 const url=p=>`http://127.0.0.1:${port}/api/${p}`;
 try{
  for(let i=0;i<200&&!started;i++)await pause(25);assert(started,logs);
  let e=await (await fetch(url('bench'))).json();
  assert.deepEqual(e.latestByPoint,{});assert.equal(e.captures.length,0);assert.equal(e.power.derived.idleMw,null);assert.equal(e.power.derived.energyPerPingUj,null);
  let r=await fetch(url('bench/capture?point=PA4&profile=MURKY&window=HANN&label=unit'),{method:'POST',headers:{'Content-Type':'text/csv'},body:csv()});
  assert.equal(r.status,201);const body=await r.json();assert.equal(body.point,'PA4');assert.equal(body.allPass,true,JSON.stringify(body.comparison));
  e=await (await fetch(url('bench'))).json();
  assert.equal(e.latestByPoint.PA4.provenance,'MEASURED');assert.equal(e.latestByPoint.PA4.computed.provenance,'COMPUTED');
  assert.equal(e.latestByPoint.FILTER_OUT,undefined,'no measurement for a point nobody captured');
  assert.equal(e.windows['PA4|MURKY'].HANN.allPass,true);
  assert((await readdir(join(directory,'bench'))).some(f=>f.startsWith('capture-')));
  assert.equal((await fetch(url('bench/capture?point=PA4&profile=MURKY&window=HANN'),{method:'POST',headers:{'Content-Type':'text/csv'},body:''})).status,400);
  assert.equal((await fetch(url('bench/capture?point=NOPE&profile=MURKY&window=HANN'),{method:'POST',headers:{'Content-Type':'text/csv'},body:csv()})).status,400);
  r=await fetch(url('bench/power'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:'idle',voltageV:5,currentMa:100,instrument:'unit meter',measuredPoint:'fixture'})});
  assert.equal(r.status,201);
  assert.equal((await fetch(url('bench/power'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:'idle',voltageV:5,currentMa:100})})).status,400);
  e=await (await fetch(url('bench'))).json();assert.equal(e.power.derived.idleMw,500);
 }finally{child.kill();}
});
