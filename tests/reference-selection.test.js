import test from 'node:test';
import assert from 'node:assert/strict';
import {displayReference} from '../shared/reference-selection.js';
const config={mode:'LFM CHIRP',frequency:42,bandwidth:4,pulse:2,amplitude:35,window:'HANN'};
const inspection={config,tx:{samples:[0,.1,0]},rx:{echo:[0,.2,0]}};
test('the shared sonar display can inspect a selection without enabling output',()=>{
 const signal={requestedWaveform:config,control:{hasApplied:false,outputEnabled:false}};
 assert.equal(displayReference(signal,inspection,config),inspection);
 assert.equal(signal.preview,undefined);
 assert.equal(signal.control.hasApplied,false);assert.equal(signal.control.outputEnabled,false);
 assert.equal(displayReference(signal,{...inspection,config:{...config,frequency:38}},config),null);
});
test('applied references take precedence and recordings need no regenerated preview',()=>{
 const applied={...inspection,purpose:'APPLIED'};
 assert.equal(displayReference({waveform:config,preview:applied},inspection,config),applied);
 assert.equal(displayReference(null,inspection,config),inspection);
 assert.equal(displayReference(null,null,config),null);
});
