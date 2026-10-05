import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {parsePacket} from "../shared/protocol.js";
const bin=join(mkdtempSync(join(tmpdir(),"aquasdr-control-")),"test");
execFileSync("cc",["-std=c11","-O1","-g","-Wall","-Wextra","-Werror","-Wno-misleading-indentation","-fsanitize=address,undefined","-Ifirmware/src",
  "firmware/test/host_control.c",...['control','command','adaptation','waveform','telemetry','capture'].map(n=>`firmware/src/${n}.c`),"-lm","-o",bin]);
for(const scenario of ['policy','named_commands','scheduler','lease','parser','uart','boot_quiet'])test(`shared C controller: ${scenario}`,()=>assert.equal(execFileSync(bin,[scenario]).toString().trim(),'ok'));
test('extended firmware telemetry retains source, applied and requested state',()=>{
 const p=parsePacket(execFileSync(bin,['telemetry']).toString());
 assert.equal(p.payload.environment.source,'WEB_COMMAND');assert.equal(p.payload.environment.turbidityIndex,85);
 assert.equal(p.payload.control.state,'APPLIED');assert.equal(p.payload.waveform.frequency,38);
 assert.equal(p.payload.requestedWaveform.frequency,38);assert.equal(p.payload.sensors.turbidity,null);assert.equal(p.payload.power.watts,null);
 assert.equal(p.payload.firmwareMode,'ADAPTIVE_TRANSMITTER');assert.equal(p.payload.environment.profile,'MUDDY_ESTUARY');
 assert.equal(p.payload.applicationAck.status,'APPLIED');assert.equal(p.payload.applicationAck.session,77);
 assert.equal(p.payload.applicationAck.id,p.payload.control.appliedRequestId);
 assert.equal(p.payload.applicationAck.decisionId,p.payload.control.appliedDecisionId);
 assert.equal(p.payload.applicationAck.profile,'MUDDY_ESTUARY');assert.equal(p.payload.applicationAck.policy,'MURKY');
 assert.equal(p.payload.firmware,'aquasdr-fw 0.3.3 adaptive environment control');
});

test('ADC-dial telemetry reports raw count, pin voltage and filtered level; firmware identifies itself',()=>{
 const p=parsePacket(execFileSync(bin,['telemetry_adc']).toString()).payload;
 assert.equal(p.environment.source,'ADC_DIAL');
 assert.deepEqual({pin:p.adc.pin,raw:p.adc.raw,millivolts:p.adc.millivolts,valid:p.adc.valid},{pin:'PA0/A0',raw:3000,millivolts:2417,valid:true});
 assert.ok(Math.abs(p.adc.filteredLevel-3000*100/4095)<0.1,'filtered level converges on 73.3 %');
 assert.equal(p.identity.id,'AQUASDR_ADAPTIVE');assert.ok(p.identity.capabilities.includes('TIM6_DMA_DAC1_PA4'));
 assert.equal(p.control.profile,'MURKY');
});
test('web-source telemetry omits the ADC block',()=>{
 assert.equal(parsePacket(execFileSync(bin,['telemetry']).toString()).payload.adc,undefined);
});

// ---- Combined sensor image: the mounted TDS board on A0 (2.3 V full scale), same policy as the web path ----
const tdsBin=join(mkdtempSync(join(tmpdir(),"aquasdr-tds-")),"test");
execFileSync("cc",["-std=c11","-O1","-g","-Wall","-Wextra","-Werror","-Wno-misleading-indentation","-Ifirmware/src",
  "-DADC_FULLSCALE_COUNTS=2854",'-DADC_SENSOR_LABEL="TDS_PROXY"','-DFW_PLATFORM="ARDUINO_COMBINED"',
  "firmware/test/host_control.c",...['control','command','adaptation','waveform','telemetry','capture'].map(n=>`firmware/src/${n}.c`),"-lm","-o",tdsBin]);
test("TDS proxy: half the 2.3 V full scale is 50 % and decides TRANSITION; labels say TDS_PROXY on the combined platform",()=>{
 const p=parsePacket(execFileSync(tdsBin,["telemetry_tds","1427"]).toString()).payload;
 assert.equal(p.adc.sensor,"TDS_PROXY");assert.equal(p.adc.fullScaleCounts,2854);assert.equal(p.identity.platform,"ARDUINO_COMBINED");
 assert.ok(Math.abs(p.adc.filteredLevel-50)<0.1,`level ${p.adc.filteredLevel}`);assert.equal(p.control.profile,"TRANSITION");
});
test("TDS proxy: full scale reaches 100 % (MURKY) and clamps above it; the same counts on a dial image would only read 69.7 %",()=>{
 const full=parsePacket(execFileSync(tdsBin,["telemetry_tds","2854"]).toString()).payload;
 assert.ok(Math.abs(full.adc.filteredLevel-100)<0.1);assert.equal(full.control.profile,"MURKY");
 const over=parsePacket(execFileSync(tdsBin,["telemetry_tds","3500"]).toString()).payload;
 assert.ok(over.adc.filteredLevel<=100);
 const dial=parsePacket(execFileSync(bin,["telemetry_tds","2854"]).toString()).payload;
 assert.ok(Math.abs(dial.adc.filteredLevel-69.7)<0.2);assert.equal(dial.adc.sensor,"DIAL");assert.equal(dial.identity.platform,"BARE_METAL");
});
test("TDS proxy: dry probe (about 0 V) is rejected as a rail fault, so output stays inhibited",()=>{
 const p=parsePacket(execFileSync(tdsBin,["telemetry_tds","3"]).toString()).payload;
 assert.equal(p.adc.valid,false);assert.equal(p.control.qualified,false);
});

// ---- capture op: unsupported images refuse it; supporting images gate it ----
const capSupported=join(mkdtempSync(join(tmpdir(),"aquasdr-capop-")),"test");
execFileSync("cc",["-std=c11","-O1","-g","-Wall","-Wextra","-Werror","-Wno-misleading-indentation","-fsanitize=address,undefined","-DAQUASDR_CAPTURE=1","-Ifirmware/src",
  "firmware/test/host_control.c",...['control','command','adaptation','waveform','telemetry','capture'].map(n=>`firmware/src/${n}.c`),"-lm","-o",capSupported]);
test("capture op: refused when the image does not support it, and never starts output",()=>assert.equal(execFileSync(bin,['capture_op']).toString().trim(),'ok'));
test("capture op: supporting image needs a qualified input, allows one capture at a time and validates its mode",()=>assert.equal(execFileSync(capSupported,['capture_op']).toString().trim(),'ok'));
test("capture-capable telemetry advertises DAC_CAPTURE; plain images do not",()=>{
 const withCap=parsePacket(execFileSync(capSupported,['telemetry']).toString()).payload,without=parsePacket(execFileSync(bin,['telemetry']).toString()).payload;
 assert.ok(withCap.identity.capabilities.includes('DAC_CAPTURE'));assert.ok(!without.identity.capabilities.includes('DAC_CAPTURE'));
});
