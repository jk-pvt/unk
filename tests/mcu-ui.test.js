import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
async function load(entry){const b=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',loader:{'.png':'dataurl'},external:['react','react-dom','lucide-react']});
 const m={exports:{}};new Function('require','module','exports',b.outputFiles[0].text)(require,m,m.exports);return m.exports;}
const {McuCapture}=await load('src/pages/McuCapture.jsx');
const {Validation}=await load('src/pages/pages.jsx');
const html=(ctx)=>renderToStaticMarkup(React.createElement(McuCapture,{ctx}));
const withCap={current:{identity:{capabilities:['DAC_CAPTURE']},capture:{state:'IDLE'}},api:async()=>null};

test('MCU capture panel says plainly that it is not an oscilloscope measurement, and shows AWAITING with no capture',()=>{
 const h=html(withCap);
 assert.match(h,/MCU ADC CAPTURE/);assert.match(h,/not an oscilloscope or instrument measurement/);assert.match(h,/AWAITING MCU CAPTURE/);
 assert.match(h,/assumed 3\.3 V reference/);assert.match(h,/No distortion figure/);
 assert.doesNotMatch(h,/MEASURED PA4|MEASURED FILTER|INSTRUMENT MEASUREMENT/);
});
test('capture button is disabled without a connected payload, without the DAC_CAPTURE capability, or without an API',()=>{
 assert.match(html({}),/disabled/);assert.match(html({}),/Connect the payload to capture/);
 const noCap=html({current:{identity:{capabilities:['ADC_A0']}},api:async()=>null});assert.match(noCap,/disabled/);assert.match(noCap,/does not advertise DAC capture/);
 assert.doesNotMatch(html(withCap).replace(/<select[\s\S]*?<\/select>/,''),/<button[^>]*disabled/);
});
test('live capture progress from the board is shown',()=>{
 const h=html({current:{identity:{capabilities:['DAC_CAPTURE']},capture:{state:'SENDING',sent:1200,samples:6000,reason:''}},api:async()=>null});
 assert.match(h,/SENDING 1200\/6000/);
 assert.match(html({current:{identity:{capabilities:['DAC_CAPTURE']},capture:{state:'FAILED',sent:0,samples:6000,reason:'NO_PULSE'}},api:async()=>null}),/FAILED · NO_PULSE/);
});
test('Validation keeps MCU ADC CAPTURE and external-instrument evidence as separate sections',()=>{
 const v=renderToStaticMarkup(React.createElement(Validation,{ctx:{cfg:{mode:'LFM CHIRP',frequency:42,bandwidth:4,pulse:2,amplitude:35,window:'HANN'},current:{validation:{}},signal:{}}}));
 assert.ok(v.indexOf('MCU ADC CAPTURE')>=0&&v.indexOf('BENCH EVIDENCE')>=0&&v.indexOf('MCU ADC CAPTURE')<v.indexOf('BENCH EVIDENCE'));
 assert.match(v,/MEASURED PA4/);assert.match(v,/AWAITING SCOPE/);   // the external-instrument slots are still empty and say so
});
test('the panel lets the operator declare what the ADC is wired to and warns that the firmware cannot see it',()=>{
 const h=html(withCap);
 assert.match(h,/ADC input is wired to/);assert.match(h,/Raw DAC pin PA4/);assert.match(h,/Filtered output \(filter \+ TLV9062 stage/);
 assert.doesNotMatch(h,/MEASURED|OSCILLOSCOPE CAPTURE/);
});
