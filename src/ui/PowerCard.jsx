import React, { useEffect, useState } from 'react';
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import { BatteryModule } from './BatteryModule.jsx';
import { Dot, Label, Num } from './kit.jsx';
import { derivePower, batteryPreview } from '../../shared/power.js';
import { PACK } from '../../shared/signal.js';

export function PowerCard({ctx,large=false}) {
  const [preview,setPreview]=useState(null);
  useEffect(()=>{if(!ctx.demo)setPreview(null);},[ctx.demo]);
  useEffect(()=>{
    if(!preview?.moving)return;
    let previous=performance.now();
    const timer=setInterval(()=>{
      const now=performance.now(), dt=(now-previous)/1000;previous=now;
      setPreview(p=>{if(!p)return p;const soc=p.charging?Math.min(.98,p.soc+dt*.018):Math.max(.52,p.soc-dt*.019);return {...p,soc,moving:p.charging?soc<.98:soc>.52};});
    },100);
    return ()=>clearInterval(timer);
  },[preview?.moving]);
  const testing=ctx.demo&&preview;
  const power=testing?batteryPreview(preview.soc,preview.charging):ctx.power;
  const scenario=power.source==='scenario';
  const p=derivePower(power);
  const realTelemetry=ctx.source==='LIVE'&&!ctx.powerModeled&&[power.voltage,power.current,power.watts,power.soc].some(Number.isFinite);
  const operationalPower=realTelemetry||testing||ctx.demo||ctx.powerModeled||ctx.playback;
  const metricSource=realTelemetry?'MEASURED':operationalPower?(ctx.playback?'RECORDED':'CALCULATED'):'UNAVAILABLE';
  const duration=p.endurance===null?'—':`${Math.floor(p.endurance)}h ${String(Math.floor(p.endurance%1*60)).padStart(2,'0')}m`;
  const tone=p.status==='NOMINAL'||p.charging?'ok':['UNAVAILABLE','ESTIMATE'].includes(p.status)?'muted':'amber';
  const begin=(kind)=>setPreview({soc:kind==='low'?.15:kind==='critical'?.05:.824,charging:kind==='charging',moving:kind==='drain'||kind==='charging'});
  return <section className={`power panel physical-power${large?' power-lg':''}${p.low?' low':''}`}>
    <Label right={!large&&<button className="ibtn" aria-label="Open power workspace" onClick={()=>ctx.setPage('Power')}><ArrowUpRight size={14}/></button>}>{scenario?'Battery scenario':'Power system'}</Label>
    <div className="power-inner">
      <div className="power-object-area">
        <div className="power-charge"><span>BATTERY LEVEL</span><div className="charge-dial">{large && <svg className="charge-ring" viewBox="0 0 100 100" aria-hidden="true"><circle className="charge-track" cx="50" cy="50" r="44"/><circle className="charge-fill" cx="50" cy="50" r="44" pathLength="100" strokeDasharray={`${p.soc === null ? 0 : Math.max(0, Math.min(100, p.soc * 100))} 100`}/></svg>}<strong className={p.low?'amber':''}>{p.soc===null?'—':<Num value={p.soc*100} digits={1}/>}<small>%</small></strong></div></div>
        <div className="power-physical"><BatteryModule active={operationalPower} soc={operationalPower?p.soc:null} current={operationalPower?power.current:null} charging={operationalPower&&p.charging} critical={operationalPower&&p.critical} low={operationalPower&&p.low}/>{!operationalPower&&<span className="power-waiting">WAITING FOR TELEMETRY</span>}</div>
        <div className="power-estimates"><div><span>REMAINING ENERGY <i>CALCULATED</i></span><b><Num value={p.remaining} digits={2}/><u>Wh</u></b><em>Estimated from SOC · {PACK.capacityWh} Wh pack</em></div><div><span>ENDURANCE <i>ESTIMATED</i></span><b>{duration}</b><em>{p.charging?'Charging · no discharge estimate':realTelemetry?'At present measured load':'At present calculated load'}</em></div></div>
        <div className="power-object-caption">3S2P Li-ion <span>{PACK.nominal} V / {PACK.capacityAh} Ah</span></div>
      </div>
      <dl className="power-telemetry">
        {[["VOLTAGE",power.voltage,2,"V"],["CURRENT",power.current,3,"A"],["POWER",power.watts,2,"W"]].map(([k,v,d,u])=><div key={k}><dt>{k} <i>{ctx.powerModeled&&!scenario&&k==='VOLTAGE'?'NOMINAL':metricSource}</i></dt><dd><Num value={v} digits={d}/><u>{u}</u></dd></div>)}
        <div><dt>BATTERY STATUS</dt><dd className="power-state"><Dot tone={tone}/>{p.status}</dd></div>
      </dl>
    </div>
    {large&&<div className="power-detail-foot"><span>Energy used · CALCULATED <b><Num value={testing?null:ctx.power.energy} digits={3}/> Wh</b></span><span>Source <b>{realTelemetry?'LIVE MEASURED TELEMETRY':ctx.playback?'RECORDED SESSION':scenario?'BATTERY SCENARIO':operationalPower?'SYSTEM ESTIMATE':'WAITING FOR TELEMETRY'}</b></span></div>}
    {large&&ctx.demo&&<details className="battery-demo"><summary>Test battery states</summary><div className="battery-demo-content"><div className="battery-demo-title"><span>{testing?'BATTERY SCENARIO PREVIEW':'TEST BATTERY STATES'}</span>{testing&&<button onClick={()=>setPreview(null)}><RotateCcw size={12}/> Return to telemetry</button>}</div><div className="battery-demo-actions">{[['drain','Drain 82 → 52%'],['charging','Charging'],['low','Low'],['critical','Critical']].map(([k,l])=><button key={k} onClick={()=>begin(k)}>{l}</button>)}</div><p>{testing?'Scenario preview only. Live telemetry and recordings stay unchanged.':'Preview the physical module’s response to discharge, charging and low energy.'}</p></div></details>}
  </section>;
}
