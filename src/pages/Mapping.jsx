import React, { useMemo, useRef, useState } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { SeabedScene } from '../ui/SeabedScene.jsx';
import { demoSeabed, parseSurveyCsv, surveyStats } from '../../shared/seabed.js';
import { Src } from '../ui/kit.jsx';

const demo=demoSeabed();
// Keep a locally loaded survey available when switching workspaces.
let sessionSurvey=null;
export function Mapping(){
  const [survey,setSurvey]=useState(()=>sessionSurvey||demo),[mode,setMode]=useState(sessionSurvey?'points':'surface');
  const [exaggeration,setExaggeration]=useState(1.5),[resetKey,setResetKey]=useState(0),[error,setError]=useState('');
  const file=useRef(null),request=useRef(0);
  const stats=useMemo(()=>surveyStats(survey.points),[survey]);
  const isDemo=survey.source==='demo';
  async function load(event){
    const selected=event.target.files?.[0];event.target.value='';if(!selected)return;
    const id=++request.current;
    try{
      if(selected.size>2*1024*1024)throw new Error('Choose a CSV smaller than 2 MB.');
      const next=parseSurveyCsv(await selected.text(),selected.name);
      if(id!==request.current)return;
      sessionSurvey=next;setSurvey(next);setMode('points');setError('');
    }catch(e){if(id===request.current)setError(e.message);}
  }
  function resetDemo(){request.current++;sessionSurvey=null;setSurvey(demo);setMode('surface');setError('');}
  function template(){
    const csv='x_m,y_m,depth_m\n0,0,24\n10,0,23\n20,0,25\n0,10,22\n10,10,21\n20,10,24\n0,20,23\n10,20,24\n20,20,26\n';
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='synthetic-survey-example.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="ws ws-map seabed-workspace">
    <section className="panel seabed-card">
      <header className="seabed-toolbar">
        <div className="seabed-title"><span>Supporting / future survey view</span><Src kind={isDemo?'unavailable':'measured'}>{isDemo?'NO SURVEY DATA':'IMPORTED CSV'}</Src></div>
        <div className="seabed-tools">
          <div className="seg" role="group" aria-label="Seabed display">
            {['surface','wireframe','points'].map(value=><button key={value} disabled={!isDemo&&value!=='points'} aria-pressed={mode===value} className={mode===value?'on':''} onClick={()=>setMode(value)}>{value==='points'?'Points':value==='surface'?'Surface':'Wireframe'}</button>)}
          </div>
          <label className="seabed-relief">Relief <select aria-label="Vertical exaggeration" value={exaggeration} onChange={e=>setExaggeration(Number(e.target.value))}><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={3}>3×</option></select></label>
          <button className="ibtn" aria-label="Reset seabed camera" onClick={()=>setResetKey(k=>k+1)}><RotateCcw size={15}/></button>
          <button className="tbtn" onClick={()=>file.current.click()}><Upload size={13}/> Import survey</button>
          <input ref={file} hidden type="file" accept=".csv,text/csv" aria-label="Import survey CSV" onChange={load}/>
        </div>
      </header>
      <div className="seabed-stage">
        <SeabedScene survey={survey} mode={mode} exaggeration={exaggeration} resetKey={resetKey}/>
        <div className="seabed-caption"><h2>{survey.name}</h2><p>{isDemo?'NO SURVEY DATA · synthetic interface preview only':'Local survey points · file values shown as supplied'}</p><span>{isDemo?'Supporting view · not live sonar output':'No surface interpolation'} · {exaggeration}× vertical scale</span></div>
        <div className="seabed-axis" aria-hidden="true"><svg viewBox="0 0 80 70"><path d="M25 43 L25 12 M25 43 L64 51 M25 43 L6 60"/><text x="21" y="9">Z</text><text x="67" y="55">X</text><text x="1" y="69">Y</text></svg><span>LOCAL METRES</span></div>
        <div className="seabed-legend"><span>Depth · m</span><div/><small>{stats.minDepth.toFixed(1)}<span>{stats.maxDepth.toFixed(1)}</span></small></div>
        <span className="seabed-gestures">Drag to orbit <i/> Scroll to zoom <i/> Right-drag to pan</span>
      </div>
      <footer className="seabed-metrics">
        <div><span>{isDemo?'Sample points':'Imported points'}</span><strong>{stats.count.toLocaleString()}</strong></div>
        <div><span>Survey extent · X / Y</span><strong>{stats.width.toFixed(0)} × {stats.length.toFixed(0)} <small>m</small></strong></div>
        <div><span>Shallowest point</span><strong>{stats.minDepth.toFixed(1)} <small>m</small></strong></div>
        <div><span>Deepest point</span><strong>{stats.maxDepth.toFixed(1)} <small>m</small></strong></div>
      </footer>
    </section>
    <div className="seabed-footnote"><p>{error?<span role="alert" className="amber">{error}</span>:isDemo?'NO SURVEY DATA. This supporting/future view is independent of live sonar; import a survey CSV to inspect measurements.':'Imported locally in this browser. Depth is positive down from your survey datum; positioning and calibration are not verified.'}</p><details className="survey-format"><summary>CSV format</summary><div><b>Local survey coordinates</b><code>x_m,y_m,depth_m</code><p>Use metre coordinates and positive-down depth. 3–20,000 points, up to 2 MB. No latitude/longitude conversion is applied.</p><button className="tbtn" onClick={template}><Download size={12}/> Synthetic example</button></div></details>{!isDemo&&<button className="tbtn" onClick={resetDemo}>Demo seabed</button>}</div>
  </div>;
}
