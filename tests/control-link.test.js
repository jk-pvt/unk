import test from 'node:test';
import assert from 'node:assert/strict';
import {ControlLink} from '../server/control-link.js';
function setup(options){let commands=[];const link=new ControlLink(c=>commands.push(c),options);return {link,commands};}
const telemetry=(session=0,uptime=100,lastRequestId=0)=>({type:'telemetry',payload:{capabilities:{controlVersion:1},control:{session,uptimeMs:uptime,lastRequestId}}});
function accept(link,c,status='ACCEPTED'){link.receive({type:'ack',session:c.session,id:c.id,status,reason:status==='REJECTED'?'INPUT_UNQUALIFIED':''});}
async function ready(link,commands){link.receive(telemetry());accept(link,commands.at(-1));await Promise.resolve();}
test('legacy packets cannot enable serial control; handshake and ACK are separate from application',async()=>{
 const {link,commands}=setup();link.receive({type:'telemetry',payload:{}});assert.equal(link.ready,false);assert.equal(commands.length,0);
 await ready(link,commands);assert.equal(link.ready,true);
 const p=link.send('start');await assert.rejects(link.send('stop'),/awaiting/);accept(link,commands.at(-1));assert.equal((await p).status,'ACCEPTED');assert.equal(link.snapshot().status,'ACCEPTED');
});
test('unknown outcome waits for telemetry and reconnect never replays commands',async()=>{
 const {link,commands}=setup({timeout:15});await ready(link,commands);
 await assert.rejects(link.send('start'),/outcome unknown/);assert.equal(link.unknown,true);
 await assert.rejects(link.send('start'),/fresh telemetry/);
 link.receive(telemetry(link.session,200,commands.at(-1).id));assert.equal(link.unknown,false);
 const count=commands.length;link.reset();assert.equal(commands.length,count);assert.equal(link.ready,false);
 await assert.rejects(link.send('start'),/read-only/);
});
test('restart rejects pending commands and stale acknowledgements',async()=>{
 const {link,commands}=setup();await ready(link,commands);link.receive(telemetry(link.session,1000));
 const p=link.send('start'), old=commands.at(-1);link.receive(telemetry(0,1));await assert.rejects(p,/reset/);
 accept(link,old);assert.equal(link.ready,false);accept(link,commands.at(-1));assert.equal(link.ready,true);
});
test('only owner heartbeat renews lease; ADC does not require browser',async()=>{
 const {link,commands}=setup();await ready(link,commands);link.claim('one');assert.throws(()=>link.claim('two'),/another browser/i);
 link.ownerSeen=0;link.heartbeat('two');link.maintain(true);assert.equal(commands.length,1);
 link.heartbeat('one');link.maintain(false);assert.equal(commands.length,1);
 link.maintain(true);assert.equal(commands.at(-1).op,'keepalive');accept(link,commands.at(-1));
});
test('browser closure serializes stop behind an in-flight command and blocks another owner',async()=>{
 const {link,commands}=setup();await ready(link,commands);link.claim('one');
 const pending=link.send('environment'), before=commands.at(-1), stopped=link.halt();
 assert.throws(()=>link.claim('two'),/stop.*reconciliation/);assert.equal(link.owner,null);
 accept(link,before);await pending;await Promise.resolve();
 assert.equal(commands.at(-1).op,'stop');accept(link,commands.at(-1));await stopped;
 link.claim('two');assert.equal(link.owner,'two');assert.equal(link.snapshot().pending,false);
});

test('a handshake that times out is retried on the next telemetry packet instead of leaving the link unknown forever',async()=>{
 const {link,commands}=setup({timeout:15});
 link.receive(telemetry());                       // first PING is sent, the device never answers
 await new Promise(r=>setTimeout(r,40));
 assert.equal(link.ready,false);assert.equal(link.unknown,true);
 const before=commands.length;
 link.receive(telemetry(0,200));                  // next packet: handshake must be tried again
 assert.equal(commands.length,before+1);assert.equal(commands.at(-1).op,'PING');
 accept(link,commands.at(-1));await Promise.resolve();await Promise.resolve();
 assert.equal(link.ready,true);assert.equal(link.unknown,false);assert.equal(link.snapshot().status,'ACCEPTED');
 await assert.rejects(link.send('keepalive').then(()=>{throw new Error('should wait for ack')}),/timed out|should wait/); // normal commands still need an ACK
});
