import React, { useEffect, useRef, useState } from 'react';
import { surveyStats } from '../../shared/seabed.js';

export function SeabedScene({ survey, mode, exaggeration, resetKey }) {
  const host=useRef(null), sceneApi=useRef(null), settings=useRef({mode,exaggeration});
  settings.current={mode,exaggeration};
  const [status,setStatus]=useState('loading');
  useEffect(()=>{
    let cancelled=false,cleanup=()=>{};
    setStatus('loading');
    Promise.all([import('three'),import('three/addons/controls/OrbitControls.js')]).then(([T,{OrbitControls}])=>{
      if(cancelled)return;
      const renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
      renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
      renderer.setClearColor(0x000000,0);
      const root=host.current;root.appendChild(renderer.domElement);
      const scene=new T.Scene(), camera=new T.PerspectiveCamera(38,1,.1,2000);
      const controls=new OrbitControls(camera,renderer.domElement);
      controls.enableDamping=false;controls.minDistance=45;controls.maxDistance=380;controls.maxPolarAngle=Math.PI*.48;
      controls.enablePan=true;
      const stats=surveyStats(survey.points),scale=110/Math.max(stats.width,stats.length,(stats.maxDepth-stats.minDepth)*3);
      const middle=(stats.minDepth+stats.maxDepth)/2;
      const terrain=new T.Group();scene.add(terrain);
      const positions=[],colors=[],color=new T.Color();
      const stops=[new T.Color('#c8c8c8'),new T.Color('#898989'),new T.Color('#454545'),new T.Color('#222222')];
      const position=p=>new T.Vector3((p.x-(stats.minX+stats.maxX)/2)*scale,(middle-p.depth)*scale,(p.y-(stats.minY+stats.maxY)/2)*scale);
      for(const p of survey.points){
        const v=position(p);positions.push(v.x,v.y,v.z);
        const t=Math.min(.9999,Math.max(0,(p.depth-stats.minDepth)/(stats.maxDepth-stats.minDepth||1)))*3;
        color.copy(stops[Math.floor(t)]).lerp(stops[Math.min(3,Math.floor(t)+1)],t%1);colors.push(color.r,color.g,color.b);
      }
      const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
      let surface,wire,contours;
      if(survey.columns){
        const indices=[];
        for(let j=0;j<survey.rows-1;j++)for(let i=0;i<survey.columns-1;i++){
          const a=j*survey.columns+i,b=a+1,c=a+survey.columns,d=c+1;indices.push(a,c,b,b,c,d);
        }
        geometry.setIndex(indices);geometry.computeVertexNormals();
        surface=new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:.83,metalness:.08,side:T.DoubleSide}));terrain.add(surface);
        wire=new T.LineSegments(new T.WireframeGeometry(geometry),new T.LineBasicMaterial({color:0xbdbdbd,transparent:true,opacity:.17}));terrain.add(wire);
        // Contours follow the demo surface at 2 m depth intervals.
        const segments=[];
        for(let depth=Math.ceil(stats.minDepth/2)*2;depth<stats.maxDepth;depth+=2){
          for(let k=0;k<indices.length;k+=3){
            const hits=[];
            for(let e=0;e<3;e++){
              const a=survey.points[indices[k+e]],b=survey.points[indices[k+(e+1)%3]];
              if((a.depth<depth)===(b.depth<depth))continue;
              const t=(depth-a.depth)/(b.depth-a.depth),v=position({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,depth});v.y+=.06;hits.push(v);
            }
            if(hits.length===2)for(const v of hits)segments.push(v.x,v.y,v.z);
          }
        }
        const cg=new T.BufferGeometry();cg.setAttribute('position',new T.Float32BufferAttribute(segments,3));
        contours=new T.LineSegments(cg,new T.LineBasicMaterial({color:0xd2d2d2,transparent:true,opacity:.35}));terrain.add(contours);
      }
      // A separate non-indexed point geometry avoids repeating indexed vertices.
      const pg=new T.BufferGeometry();pg.setAttribute('position',geometry.attributes.position.clone());pg.setAttribute('color',geometry.attributes.color.clone());
      const cloud=new T.Points(pg,new T.PointsMaterial({vertexColors:true,size:survey.source==='demo'?1.8:4,sizeAttenuation:false}));terrain.add(cloud);
      scene.add(new T.HemisphereLight(0xe8e8e8,0x181818,2));
      const light=new T.DirectionalLight(0xffffff,2.5);light.position.set(-35,80,20);scene.add(light);
      const grid=new T.GridHelper(160,16,0x303030,0x1b1b1b);grid.material.transparent=true;grid.material.opacity=.65;scene.add(grid);
      const render=()=>renderer.render(scene,camera);
      const reset=()=>{const relief=(stats.maxDepth-stats.minDepth)*scale*terrain.scale.y;controls.target.set(0,0,0);camera.position.set(118,Math.max(83,relief*.9),135).multiplyScalar(.82*Math.max(1,relief/100));controls.update();render();};
      const update=(display,vertical)=>{
        terrain.scale.y=vertical;grid.position.y=(middle-stats.maxDepth)*scale*vertical-2;
        if(surface)surface.visible=display==='surface';if(wire){wire.visible=display==='wireframe';}if(contours)contours.visible=display==='surface';
        cloud.visible=display==='points'||!surface;render();
      };
      const resize=()=>{const {width,height}=root.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();render();};
      const observer=new ResizeObserver(resize);observer.observe(root);
      controls.addEventListener('change',render);
      sceneApi.current={update,reset};update(settings.current.mode,settings.current.exaggeration);reset();resize();setStatus('ready');
      cleanup=()=>{sceneApi.current=null;observer.disconnect();controls.dispose();scene.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});if(!surface)geometry.dispose();renderer.dispose();renderer.domElement.remove();};
    }).catch(()=>{if(!cancelled)setStatus('error');});
    return ()=>{cancelled=true;cleanup();};
  },[survey]);
  useEffect(()=>{sceneApi.current?.update(mode,exaggeration);},[mode,exaggeration]);
  useEffect(()=>{sceneApi.current?.reset();},[resetKey]);
  return <div className="seabed-canvas" ref={host} role="img" aria-label={`${survey.source==='demo'?'Simulated seabed':'Imported survey point cloud'}. Drag to orbit, scroll to zoom.`}>
    {status!=='ready'&&<div className="seabed-loading" role="status">{status==='error'?'3D rendering is unavailable in this browser. Try a browser with WebGL enabled.':'Preparing seabed…'}</div>}
  </div>;
}
