import {signalState} from './operational-state.js';

export function turbidityVoltage(status) {
  const match=String(status || '').match(/(?:^|\s)(\d+(?:\.\d+)?)\s*V\b/i);
  return match ? Number(match[1]) : null;
}
// Presentation adapters never fill in or overwrite the sensor telemetry.
export function sensorDisplay(ctx,key,name,unit,digits) {
  const measured=ctx.sensors?.[key],history=ctx.history || [];
  if(Number.isFinite(measured)) return {name,unit,digits,value:measured,source:'Sensor',
    values:history.map(h=>h.sensors?.[key]),input:false};
  if(key==='turbidity') {
    const environment=(ctx.signal || signalState(ctx.current))?.environment;
    if(Number.isFinite(environment?.turbidityIndex) && (environment.valid || environment.sampledMs>0)) return {
      name:'Turbidity input',unit:'index',digits:1,value:environment.turbidityIndex,
      source:environment.source==='ADC_DIAL'?'A0 dial · 0–100':'Operator input · 0–100',input:true,
      values:history.map(h=>h.environment?.turbidityIndex),
    };
    const voltage=turbidityVoltage(ctx.current?.health?.TURBIDITY);
    if(Number.isFinite(voltage)) return {name:'Turbidity signal',unit:'V',digits:2,value:voltage,
      source:'Sensor voltage · outside NTU calibration',input:false,
      values:history.map(h=>turbidityVoltage(h.turbidityStatus))};
  }
  return {name,unit,digits,value:null,source:'Connect channel',values:[],input:false};
}
