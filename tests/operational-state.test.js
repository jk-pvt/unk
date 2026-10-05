import test from 'node:test';
import assert from 'node:assert/strict';
import {attachCompanion,signalState,operationalState,signalPaths,pulseScheduler} from '../shared/operational-state.js';
import {estimateOperatingPower} from '../shared/power.js';
const digital={provenance:'COMPUTED_C_ENGINE',control:{hasApplied:true,outputEnabled:true},waveform:{frequency:42},preview:{rx:{samples:[.1]}}};
test('computed companion preserves measured fields and uses a separate command channel',()=>{
 const live={sensors:{temperature:30},power:{voltage:11.5,current:.15,watts:1.725},samples:[.02],sampleRate:1e6,health:{DAC:'LOOPBACK'}};
 const combined=attachCompanion(live,digital);
 for(const key of ['sensors','power','samples','health']) assert.strictEqual(combined[key],live[key]);
 assert.equal(live.digital,undefined);assert.strictEqual(signalState(combined),digital);
 const o=operationalState({mode:'hardware',hardware:{connected:true,fresh:true},current:combined,
   transmitter:{ready:false},digitalTransmitter:{ready:true}});
 assert.equal(o.target,'COMPUTED');assert.equal(o.connection,'LIVE MCU');assert.equal(o.commandReady,true);
 assert.equal(o.adcAvailable,false);assert.equal(o.modeledRxActive,true);
});
test('adaptive firmware remains authoritative even when a host companion exists',()=>{
 const live={capabilities:{controlVersion:1},control:{hasApplied:true,outputEnabled:false},waveform:{frequency:38}};
 assert.strictEqual(attachCompanion(live,digital),live);assert.strictEqual(signalState(live),live);
 const o=operationalState({mode:'hardware',hardware:{connected:true,fresh:true},current:live,
   transmitter:{ready:true},digitalTransmitter:{ready:true}});
 assert.equal(o.target,'STM32');assert.equal(o.adcAvailable,true);assert.equal(o.outputActive,false);
});
test('stale, offline, playback and compiler failure cannot enable commands',()=>{
 const base={mode:'hardware',current:attachCompanion({},digital),hardware:{connected:true,fresh:true},digitalTransmitter:{ready:true}};
 assert.equal(operationalState({...base,hardware:{connected:true,fresh:false}}).commandReady,false);
 assert.equal(operationalState({...base,hardware:{connected:false,fresh:false}}).commandReady,false);
 assert.equal(operationalState({...base,mode:'playback'}).commandReady,false);
 const failed=operationalState({...base,current:{sensors:{}},digitalTransmitter:{ready:false,error:'Compiler unavailable'}});
 assert.equal(failed.commandReady,false);assert.equal(failed.error,'Compiler unavailable');
});
test('system power estimate has no invented battery state or measured provenance',()=>{
 const idle=estimateOperatingPower({pulse:8,amplitude:62},false),active=estimateOperatingPower({pulse:8,amplitude:62},true);
 assert.equal(active.source,'estimate');assert.equal(active.voltage,11.1);assert.equal(active.soc,null);assert.equal(active.energy,null);
 assert(active.watts>idle.watts);assert.match(active.assumptions,/hypothetical/);
});
test('computed buffers, pulse scheduler and fresh physical DAC are independent',()=>{
 const waveform={mode:'LFM CHIRP',frequency:38,bandwidth:1,pulse:8,amplitude:62,window:'HANN'};
 const digital={control:{outputEnabled:false,hasApplied:true,qualified:false,reason:'WEB_LEASE_EXPIRED'},waveform,
   preview:{config:waveform,tx:{samples:[.1]},rx:{samples:[.02]}}};
 const current=attachCompanion({health:{DAC:'ACTIVE DAC1 PA4 LOOPBACK'}},digital);
 const params={mode:'hardware',hardware:{connected:true,fresh:true},current};
 const p=signalPaths(params);assert.equal(p.computedTx,'ACTIVE');assert.equal(p.modeledRx,'ACTIVE');
 assert.equal(p.physicalDac,'ACTIVE');assert.equal(p.physicalDacLoopback,true);
 assert.equal(pulseScheduler(digital.control,true),'Stopped · web lease expired');
 assert.equal(signalPaths({...params,hardware:{connected:true,fresh:false}}).physicalDac,'UNAVAILABLE');
 assert.equal(signalPaths({...params,mode:'demo'}).physicalDac,'UNAVAILABLE');
 assert.equal(signalPaths({...params,mode:'playback'}).physicalDac,'RECORDED');
 assert.equal(signalPaths({...params,current:{...current,health:{DAC:'INACTIVE'}}}).physicalDac,'IDLE');
 assert.equal(signalPaths({...params,current:{...current,health:{DAC:'FAULT'}}}).physicalDac,'FAULT');
 const stale=attachCompanion({}, {...digital,preview:{...digital.preview,config:{...waveform,frequency:42}}});
 assert.equal(signalPaths({...params,current:stale}).computedTx,'AWAITING REFERENCE');
 assert.equal(signalPaths({...params,current:stale}).modeledRx,'AWAITING REFERENCE');
});
