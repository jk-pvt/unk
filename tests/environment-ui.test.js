import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Bundle the real JSX view in memory; no browser or replacement component.
const bundle = await build({entryPoints:['src/pages/EnvironmentControl.jsx'], bundle:true,
  write:false, platform:'node', format:'cjs', external:['react']});
const module = {exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(() => React,module,module.exports);
const {EnvironmentControl} = module.exports;
const current = {
  environment:{source:'WEB_COMMAND',turbidityIndex:12,depth:3,temperature:26},
  control:{state:'DISABLED',qualified:true,outputEnabled:false,reason:'OUTPUT_DISABLED',
    profile:'CLEAR',mode:0,window:1,decisionId:2,appliedDecisionId:0,hasApplied:false},
  waveform:{mode:'LFM CHIRP',frequency:42,bandwidth:4,pulse:2,amplitude:35},
};
function render(overrides={}) {
  return renderToStaticMarkup(React.createElement(EnvironmentControl,{ctx:{
    current,connected:true,demo:true,playback:false,state:{mode:'demo',transmitter:{ready:true}},
    api:()=>{throw Error('Rendering must never transmit');},...overrides,
  }}));
}
function disabled(html,label) {
  const tag=html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
  assert.ok(tag,`missing ${label}`);return tag.includes('disabled');
}
test('Environment view gates offline, legacy, pending, unknown and playback commands',()=>{
  for(const overrides of [{connected:false},{current:{}},{playback:true},
    {state:{transmitter:{ready:true,pending:{id:2}}}},
    {state:{transmitter:{ready:true,unknown:true}}}]) {
    const html=render(overrides);
    for(const button of ['Apply environment','Start reference','Apply modulation / window'])
      assert.equal(disabled(html,button),true);
  }
  assert.match(render({current:{}}),/Controls unavailable/);
  assert.match(render({playback:true}),/Playback/);
  assert.match(render({connected:false}),/Bridge offline/);
});
test('Environment view distinguishes simulated, applied, inhibited, faulted and unavailable states',()=>{
  const initial=render();assert.match(initial,/C policy → TX reference/);assert.match(initial,/Not yet applied/);
  assert.equal(disabled(initial,'Start reference'),false);
  const applied=render({current:{...current,control:{...current.control,hasApplied:true,
    appliedDecisionId:2,decisionToOutputMs:80,state:'RUNNING',outputEnabled:true,reason:''}}});
  assert.match(applied,/42 kHz/);assert.match(applied,/80 ms · C engine clock/);
  assert.match(applied,/Running reference pulses/);assert.equal(disabled(applied,'Start reference'),true);
  for(const reason of ['WEB_LEASE_EXPIRED','DMA_FAULT']) {
    const html=render({current:{...current,control:{...current.control,state:'INHIBITED',reason}}});
    assert.match(html,new RegExp(reason));
    assert.equal(disabled(html,'Start reference'),true);
  }
  const missing=render({current:null,state:{transmitter:{ready:false,error:'Native engine unavailable'}}});
  assert.match(missing,/Native engine unavailable/);assert.equal(disabled(missing,'Start reference'),true);
});
test('stopped scheduler does not make computed reference or modeled RX inactive',()=>{
  const waveform={...current.waveform,window:'HANN'};
  const html=render({state:{mode:'demo',transmitter:{ready:true}},current:{...current,waveform,
    control:{...current.control,hasApplied:true,appliedDecisionId:2,reason:'WEB_LEASE_EXPIRED',qualified:false},
    preview:{config:waveform,tx:{samples:[.1,.2]},rx:{samples:[.01,.02]}}}});
  assert.match(html,/Acoustic preview/);
  assert.doesNotMatch(html,/signal-path-status/);
  assert.doesNotMatch(html,/COMPUTED|MODELED RX|PHYSICAL DAC · TELEMETRY/);
  assert.match(html,/Stopped · web lease expired/);
  assert.match(html,/<details[^>]*><summary>Output diagnostics<\/summary>/);
  assert.doesNotMatch(html,/AWAITING SCOPE/);
  assert.equal(disabled(html,'Start reference'),true);
});
test('live legacy payload exposes computed controls without enabling hardware DAC or A0',()=>{
  const html=render({demo:false,current:{firmware:'AquaSDR Arduino sensor bridge 1.7 demo-TFT',sensors:{temperature:30}},
    signal:current,operation:{target:'COMPUTED',connection:'LIVE MCU',commandReady:true},
    state:{mode:'hardware',transmitter:{ready:false},digitalTransmitter:{ready:true}}});
  assert.equal(disabled(html,'Apply environment'),false);assert.equal(disabled(html,'Start reference'),false);
  assert.doesNotMatch(html,/Device details|Conditions in\. Waveform out\./);
  assert.match(html,/shared C policy/);
  assert.match(html,/A0 dial · Requires adaptive image/);assert.doesNotMatch(html,/>Start output</);
});
test('connected sensor firmware retains command gating with the notices removed',()=>{
  const html=render({demo:false,current:{firmware:'AquaSDR Arduino sensor bridge 1.7 demo-TFT'},
    state:{mode:'hardware',hardware:{connected:true,fresh:true},transmitter:{ready:false}}});
  assert.doesNotMatch(html,/Arduino sensor bridge|Device details|Conditions in\. Waveform out\./);
  assert.match(html,/Controls unavailable/);
  assert.equal(disabled(html,'Apply environment'),true);
  assert.equal(disabled(html,'Start output'),true);
});
test('command-capable firmware exposes both input paths and truthful policy state',()=>{
  const html=render({demo:false,current:{...current,environment:{...current.environment,valid:true}}});
  assert.match(html,/Web control · Active/);assert.match(html,/A0 dial · Available/);
  assert.match(html,/USB \/ USART2 → STM32 policy/);assert.match(html,/RECEIVED · Clear shallow reef/);
  assert.match(html,/Depth input/);assert.match(html,/Temperature input/);
  const adc=render({demo:false,current:{...current,environment:{...current.environment,source:'ADC_DIAL'}}});
  assert.match(adc,/A0 dial → ADC1 → STM32 policy/);
  assert.equal(disabled(adc,'Apply environment'),true);
});
