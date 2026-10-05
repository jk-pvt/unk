import React from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { fmt, Src } from './kit.jsx';
import { derivePower } from '../../shared/power.js';
import modelParts from './payload-parts.json';

export function PayloadTelemetry({ ctx, selected, onClear }) {
  const {power,sensors,current,demo,playback,connected}=ctx;
  const p=derivePower(power),health=current?.health||{},value=(n,d,u)=>`${fmt(n,d)}${u?' '+u:''}`;
  const status=key=>health[key]||'Unavailable';
  const part=modelParts.find(p=>p.id===selected),title=part?.label||'Payload';
  const details={
    battery:{name:ctx.powerScenario?'Scenario charge':'State of charge',metric:value(p.soc===null?null:p.soc*100,1,'%'),rows:[['Visible assembly','Two violet cylindrical cells'],['Source',ctx.powerScenario?'Battery scenario':'Reported telemetry'],['Voltage',value(power.voltage,2,'V')],['Current',value(power.current,3,'A')],['Pack status',p.status]],page:'Power'},
    stm32:{name:'NUCLEO-F446RE',metric:'STM32F446RE',rows:[...['STM32','ADC','DAC','DMA','TIMER','I2C'].map(k=>[k==='I2C'?'I²C':k,status(k)]),['Placement','Estimated from obscured central tray']],page:'Hardware'},
    display:{name:'Local interface',metric:'ST7735 TFT',rows:[['Module','1.8-inch SPI display'],['Screen artwork','Photo-based static illustration'],['Display',status('TFT')]],page:'Hardware'},
    ds18b20:{name:'Water temperature',metric:value(sensors.temperature,1,'°C'),rows:[['Interface','1-Wire · PC1/A4'],['Geometry','Stainless probe on right plate'],['Status',status('DS18B20')]],page:'Sensors'},
    tds:{name:'Conductivity proxy',metric:value(sensors.conductivity,2,'mS/cm'),rows:[['Input','PA0/A0'],['Geometry','White probe on right plate'],['Status',status('TDS')]],page:'Sensors'},
    turbidity:{name:'Optical turbidity',metric:value(sensors.turbidity,1,'NTU'),rows:[['Input','PB0/A3'],['Geometry','Translucent probe housing'],['Status',status('TURBIDITY')]],page:'Sensors'},
    pressure:{name:'Water pressure / depth',metric:value(sensors.pressure,3,'bar'),rows:[['Depth',value(sensors.depth,2,'m')],['Input','PA1/A1'],['Geometry','Threaded stainless body'],['Status',status('PRESSURE')]],page:'Sensors'},
    'hc-sr04':{name:'End-plate ultrasonic module',metric:'Twin metal cans',rows:[['Geometry','Visible in the probe-end photograph'],['Use','Air-distance module form'],['Status',status('HC-SR04')]],page:'Sensors'},
  };
  const material=selected==='housing'?'Clear acrylic tube':['front-cap','rear-cap','frame'].includes(selected)?'Clear acrylic plates and trays':selected==='rods'?'Pale support rods':'Photo-based component geometry';
  const d=details[selected]||{name:'Prototype assembly',metric:title,rows:[['Source','Seven physical prototype photographs'],['Construction',material],['Tube proportions','≈760 × Ø180 mm, estimated'],['Reconstruction',part?.note||'Photo-relative dimensions; not measured CAD']],page:'Hardware'};
  return <section className="panel payload-telemetry" aria-label={`${title} component telemetry`}>
    <header><span>{title}</span><button className="ibtn" aria-label="Clear component selection" onClick={onClear}><X size={14}/></button></header>
    <Src kind={!connected?'unavailable':demo?'simulated':playback?'playback':current?'live':'unavailable'}/>
    <div className="payload-focus-metric"><span>{d.name}</span><strong>{d.metric}</strong></div>
    <dl>{d.rows.map(([label,val])=><div key={label}><dt>{label}</dt><dd>{val}</dd></div>)}</dl>
    <footer><span>Select a part to inspect its subsystem.</span><button onClick={()=>ctx.setPage(d.page)}>Open {d.page.toLowerCase()} <ArrowUpRight size={13}/></button></footer>
  </section>;
}
