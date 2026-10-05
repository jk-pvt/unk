import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {batteryScenario} from '../shared/power.js';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:['src/pages/pages.jsx'],bundle:true,write:false,platform:'node',format:'cjs',
  loader:{'.png':'dataurl'},external:['react','react-dom','lucide-react']});
const module={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
const {Validation,Sensors,Sonar,Power}=module.exports;
const config={mode:'LFM CHIRP',frequency:42,bandwidth:4,pulse:2,amplitude:35,window:'HANN'};
const checks={centerKHz:41.999,occupiedBandwidthKHz:3.05,durationMs:2,peakAmplitudePercent:34.978,
  peakKHz:41.992,sampleRate:1e6,samples:2000,rms:.1515,dacCodeMin:1332,dacCodeMax:2764,window:'HANN'};
const reference={config,tx:{samples:[0,.1,0],sampleRate:1e6},digitalChecks:checks};
const signal={waveform:config,preview:reference};
const render=(Component,ctx)=>renderToStaticMarkup(React.createElement(Component,{ctx}));
test('validation displays actual reference results without invented scope rows or repeated badges',()=>{
 const html=render(Validation,{cfg:config,current:{validation:{}},signal});
 assert.match(html,/41\.999|42\.00/);assert.match(html,/3\.05 kHz/);assert.match(html,/34\.98 % FS/);
 assert.match(html,/1332–2764/);assert.match(html,/0\.1515 FS/);
 assert.doesNotMatch(html,/NOT MEASURED|COMPUTED|MODELED RX|COMMAND CHANNEL READY|—/);
 assert.match(html,/Results from the TX reference sample buffer/);
 assert.doesNotMatch(html,/<td>THD/);
 const measured=render(Validation,{cfg:config,current:{validation:{frequency:41.8,thd:.12}},signal});
 assert.match(measured,/41\.80 kHz/);assert.match(measured,/0\.12 %/);assert.match(measured,/Instrument result/);
});
test('validation retains table and all TX plots before output is applied',()=>{
 const control={hasApplied:false,outputEnabled:false,qualified:false};
 const html=render(Validation,{cfg:config,current:{validation:{}},signal:{control},state:{referencePreview:reference}});
 assert.match(html,/42\.00 kHz/);assert.match(html,/3\.05 kHz/);
 assert.match(html,/no output start required/);assert.match(html,/TIME DOMAIN/);
 assert.match(html,/SPECTRUM/);assert.match(html,/SPECTROGRAM/);
 assert.doesNotMatch(html,/start reference pulses|NOT MEASURED/);
 assert.deepEqual(control,{hasApplied:false,outputEnabled:false,qualified:false});
 const stale=render(Validation,{cfg:{...config,frequency:38},current:{},signal:{control},state:{referencePreview:reference}});
 assert.doesNotMatch(stale,/3\.05 kHz/);
});
test('sensor view substitutes only named operator input, never fake measured NTU',()=>{
 const current={sensors:{temperature:32.4,turbidity:null}};
 const html=render(Sensors,{sensors:current.sensors,current,signal:{environment:{source:'WEB_COMMAND',valid:true,turbidityIndex:12}},
   history:[{sensors:{temperature:32.4,turbidity:null},environment:{turbidityIndex:12}}],state:{mode:'hardware'}});
 assert.match(html,/Turbidity input/);assert.match(html,/12\.0/);assert.match(html,/index/);assert.match(html,/Operator input/);
 assert.match(html,/32\.4/);assert.doesNotMatch(html,/>NTU<|COMMAND CHANNEL READY|COMPUTED|MODELED RX/);
 assert.equal(current.sensors.turbidity,null);
});
test('sonar uses inspection RX before output start and hides commissioning chips',()=>{
 const oldWindow=globalThis.window;
 globalThis.window={innerWidth:1920,innerHeight:1080};
 try {
  const current={health:{TX:'NOT COMMISSIONED',RX:'NOT COMMISSIONED'}};
  const preview={...reference,rx:{samples:[0,.1,0],sampleRate:250000,echo:[0,.8,0],rangeMax:3,
    detections:[],acoustic:{soundSpeed:1500}}};
  const ctx={cfg:config,current,signal:{control:{hasApplied:false,outputEnabled:false}},
    state:{mode:'hardware',running:true,sessionId:'test',referencePreview:preview},operation:{target:'COMPUTED'},
    connected:true,sonarView:'echogram',waveView:'time',range:3,maxRange:3,gain:1,peaks:[],c:1500};
  const html=render(Sonar,ctx);
  assert.match(html,/ACOUSTIC PREVIEW A-SCAN/);assert.match(html,/1500 m\/s/);
  assert.doesNotMatch(html,/TX NOT COMMISSIONED|RX NOT COMMISSIONED|ECHO UNAVAILABLE|Apply environment, then Start/);
  assert.equal(current.echo,undefined);assert.equal(current.samples,undefined);
  const captured=render(Sonar,{...ctx,current:{...current,samples:[0,.2,0],echo:[0,.5,0],sampleRate:1e6}});
  assert.doesNotMatch(captured,/ACOUSTIC PREVIEW A-SCAN/);
 }finally{if(oldWindow===undefined) delete globalThis.window;else globalThis.window=oldWindow;}
});
test('power scenario supplies charge, energy and endurance without claiming measured data',()=>{
 const power=batteryScenario(config,10),measured={soc:null,voltage:null,current:null,watts:null};
 const html=render(Power,{cfg:config,power,powerModeled:true,powerScenario:true,source:'LIVE',current:{power:measured},
  state:{mode:'hardware'},history:[{power:measured,batteryScenario:power}],setPage:()=>{}});
 assert.match(html,/Battery scenario/);assert.match(html,/82\.4/);assert.match(html,/47\.56/);
 assert.match(html,/BATTERY SCENARIO/);assert.doesNotMatch(html,/LIVE MEASURED TELEMETRY|NOT REPORTED|—/);
 assert.equal(measured.soc,null);assert.equal(measured.watts,null);
});
