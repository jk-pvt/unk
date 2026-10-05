import React, { useEffect, useRef, useState } from 'react';
import { Expand, RotateCcw, X } from 'lucide-react';
import { Dot, Num } from './kit.jsx';
import { PayloadViewport } from './PayloadViewport.jsx';
import modelParts from './payload-parts.json';
// The GLB build generates this inventory; controls cannot name absent geometry.
export const PAYLOAD_PARTS = modelParts.filter(p=>p.tabLabel).map(({id,tabLabel})=>[id,tabLabel]);

export function PayloadScene({ ctx, selected, onSelect }) {
  const { current,connected,demo,playback,sensors,power,cfg,state }=ctx;
  const [explode,setExplode]=useState(0),[housing,setHousing]=useState(true),[internal,setInternal]=useState(false),[autoRotate,setAutoRotate]=useState(true),[resetKey,setResetKey]=useState(0),[expanded,setExpanded]=useState(false);
  const dialog=useRef(null),stage=useRef(null),slot=useRef(null),largeSlot=useRef(null);
  // Move the same viewport into the native modal: no second WebGL context or lost camera state.
  useEffect(()=>{if(expanded){dialog.current.showModal();largeSlot.current.appendChild(stage.current);}else{slot.current.appendChild(stage.current);dialog.current.close();}},[expanded]);
  const status=!connected?'Bridge offline':demo?'Reference workspace':playback?`Playback${state.playback?' · session '+state.playback.sessionId?.slice(0,8):''}`:current?'Payload connected':'Awaiting payload telemetry';
  const choose=id=>{onSelect(id);if(id==='housing'){setHousing(true);setInternal(false);}if(id&&['controller-board','stm32','compute-module','sensor-modules','power-module','heatsink'].includes(id))setInternal(true);};
  const reset=()=>{onSelect(null);setInternal(false);setHousing(true);setResetKey(k=>k+1);};
  const readings=[['Depth',sensors.depth,2,'m'],['Temperature',sensors.temperature,1,'°C'],['TX reference',ctx.operation?.waveformActive?cfg.frequency:null,1,'kHz'],[ctx.powerModeled?'Load estimate':'Power draw',power.watts,2,'W']];
  return <section className="payload-scene" aria-label="Payload overview">
    <header className="payload-heading"><div><span className="payload-eyebrow">AQUASDR / PAYLOAD 01</span><h1>Mission overview</h1><p><Dot tone={demo?'amber':playback?'accent':current?'ok':'muted'}/>{status}<span className="payload-status-divider">/</span>{state.running?'Acquisition running':'Acquisition idle'}</p></div><button className="payload-open" onClick={()=>setExpanded(true)}><Expand size={15}/> Inspect payload</button></header>
    <div className="payload-live-slot" ref={slot}><div className="payload-engineering" ref={stage} onKeyDown={e=>e.stopPropagation()}>
      <div className="payload-model-area"><PayloadViewport explode={explode} housing={housing} internal={internal} autoRotate={autoRotate} selected={selected} resetKey={resetKey} onSelect={choose}/><div className="payload-model-caption">AQUASDR / INTERACTIVE ASSEMBLY</div><span className="payload-model-hint">Drag to orbit · Alt + scroll to zoom · right-drag to pan</span></div>
      <div className="payload-engineering-controls"><label className="assembly-slider">Assembly <span>Sealed</span><input aria-label="Exploded assembly" type="range" min="0" max="100" value={explode} onChange={e=>setExplode(+e.target.value)}/><span>Exploded</span><output>{explode}%</output></label><div className="payload-view-options"><button aria-pressed={housing} onClick={()=>{setHousing(v=>!v);setInternal(false);}}>Housing</button><button aria-pressed={internal} onClick={()=>setInternal(v=>!v)}>Internal</button><button aria-pressed={autoRotate} onClick={()=>setAutoRotate(v=>!v)}>Auto rotate</button><button aria-label="Reset payload view" title="Reset view" onClick={reset}><RotateCcw size={13}/></button></div></div>
      <div className="payload-components" role="group" aria-label="Focus payload component"><button aria-pressed={!selected} onClick={reset}>Overview</button>{PAYLOAD_PARTS.map(([id,label])=><button key={id} aria-pressed={selected===id} onClick={()=>choose(id)}>{label}</button>)}</div>
    </div></div>
    <footer className="payload-footer"><dl className="payload-readings">{readings.filter(([,value])=>Number.isFinite(value)).map(([label,value,digits,unit])=><div key={label}><dt>{label}</dt><dd><Num value={value} digits={digits}/><u>{unit}</u></dd></div>)}</dl></footer>
    <dialog className="payload-interactive-dialog" aria-label="Payload assembly inspector" ref={dialog} onCancel={()=>setExpanded(false)}><header><span>Payload assembly <small>Photo-based prototype</small></span><button className="ibtn" aria-label="Close payload viewer" onClick={()=>setExpanded(false)}><X size={18}/></button></header><div ref={largeSlot} className="payload-large-slot"/></dialog>
  </section>;
}
