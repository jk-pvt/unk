import test from 'node:test';
import assert from 'node:assert/strict';
import {sensorDisplay,turbidityVoltage} from '../shared/sensor-display.js';

test('valid turbidity is authoritative NTU and cannot be overwritten by operator inputs',()=>{
 const ctx={sensors:{turbidity:24},signal:{environment:{turbidityIndex:85,valid:true}},history:[{sensors:{turbidity:20}}]};
 const result=sensorDisplay(ctx,'turbidity','Turbidity','NTU',1);
 assert.equal(result.value,24);assert.equal(result.unit,'NTU');assert.equal(result.source,'Sensor');
 assert.deepEqual(result.values,[20]);assert.deepEqual(ctx.sensors,{turbidity:24});
});
test('missing NTU can display operator index with its own units and history',()=>{
 const ctx={sensors:{turbidity:null},signal:{environment:{turbidityIndex:12,source:'WEB_COMMAND',valid:true}},
   history:[{sensors:{turbidity:50},environment:{turbidityIndex:10}},{sensors:{turbidity:51},environment:{turbidityIndex:12}}]};
 const result=sensorDisplay(ctx,'turbidity','Turbidity','NTU',1);
 assert.equal(result.value,12);assert.equal(result.unit,'index');assert.equal(result.name,'Turbidity input');
 assert.match(result.source,/Operator input/);assert.deepEqual(result.values,[10,12]);
 assert.equal(ctx.sensors.turbidity,null);
});
test('without acquired input show only the actual diagnostic sensor voltage',()=>{
 const ctx={sensors:{turbidity:null},signal:{environment:{turbidityIndex:0,valid:false,sampledMs:0}},
   current:{health:{TURBIDITY:'OUT OF RANGE 0.92V'}},history:[{turbidityStatus:'OUT OF RANGE 0.91V'}]};
 const result=sensorDisplay(ctx,'turbidity','Turbidity','NTU',1);
 assert.equal(result.value,.92);assert.equal(result.unit,'V');assert.deepEqual(result.values,[.91]);
 assert.equal(turbidityVoltage('ONLINE'),null);assert.equal(turbidityVoltage('OFFLINE'),null);
 const absent=sensorDisplay({sensors:{turbidity:null}},'turbidity','Turbidity','NTU',1);
 assert.equal(absent.value,null);assert.deepEqual(absent.values,[]);
});
