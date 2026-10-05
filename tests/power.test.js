import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePower, batteryPreview, packVoltage, batteryScenario } from '../shared/power.js';
import { PACK } from '../shared/signal.js';
test('power estimates use the actual pack capacity and decline with state of charge',()=>{
 const a=derivePower(batteryPreview(.824)), b=derivePower(batteryPreview(.52));
 assert.equal(a.remaining,.824*PACK.capacityWh);assert.ok(a.remaining>b.remaining);assert.ok(a.endurance>b.endurance);assert.equal(a.status,'NOMINAL');
});
test('charging reverses current and suppresses discharge endurance',()=>{
 const p=derivePower(batteryPreview(.5,true));assert.equal(p.status,'CHARGING');assert.equal(p.charging,true);assert.equal(p.endurance,null);
});
test('low and critical states respect their boundaries',()=>{
 assert.equal(derivePower(batteryPreview(.15)).status,'LOW POWER');assert.equal(derivePower(batteryPreview(.05)).status,'CRITICAL');assert.equal(derivePower(batteryPreview(.2)).status,'NOMINAL');
});
test('unavailable hardware does not invent state of charge or endurance',()=>{
 const p=derivePower({voltage:11.8,current:.1,watts:1.3});assert.equal(p.soc,null);assert.equal(p.remaining,null);assert.equal(p.endurance,null);assert.equal(derivePower({}).status,'UNAVAILABLE');
});
test('explicit charging and overvoltage are reflected in state',()=>{
 assert.equal(derivePower({voltage:11.3,soc:.5,current:0,charging:true}).status,'CHARGING');assert.equal(derivePower({voltage:13.2,soc:.8}).status,'OVERVOLTAGE');
});
test('3S Li-ion pack voltage spans 9.0 V empty to 12.6 V full',()=>{
 assert.ok(Math.abs(packVoltage(0)-9)<1e-9);assert.ok(Math.abs(packVoltage(1)-12.6)<1e-9);assert.ok(packVoltage(.5)>packVoltage(.2));assert.equal(PACK.capacityWh,PACK.nominal*PACK.capacityAh);
});
test('battery scenario varies load, integrates charge, and remains separate from telemetry',()=>{
 const config={pulse:2,amplitude:35},initial=batteryScenario(config,0),later=batteryScenario(config,120);
 assert.equal(initial.source,'scenario');assert.equal(initial.soc,.824);
 assert(later.soc<initial.soc);assert(later.energy>0);
 assert.notEqual(later.current,initial.current);assert.notEqual(later.voltage,initial.voltage);
 assert.equal(later.watts,later.voltage*later.current);
 assert(Math.abs(later.soc*PACK.capacityWh+later.energy-.824*PACK.capacityWh)<1e-8);
 assert(derivePower(later).endurance>0);
 assert(batteryScenario(config,120,true).current>later.current);
 for(let t=0;t<600;t++) {
  const p=batteryScenario(config,t);
  assert(p.current>=.097 && p.current<=.113);assert(p.soc>=0 && p.soc<=1);
 }
 assert.deepEqual(later,batteryScenario(config,120));
 assert.equal(derivePower({voltage:11.8,current:.1}).soc,null);
});
