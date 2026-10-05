import React, { useEffect, useRef, useState } from 'react';

import modelInfo from './payload-model-info.json';
const MODEL_URL=`/models/aquasdr-payload.glb?v=${modelInfo.hash}`;

export function PayloadViewport({ explode, housing, internal, autoRotate, selected, resetKey, onSelect, presentation=false }) {
  const host=useRef(null),latest=useRef({explode,housing,internal,autoRotate,selected,resetKey,onSelect});
  latest.current={explode,housing,internal,autoRotate,selected,resetKey,onSelect};
  const [status,setStatus]=useState('loading');
  useEffect(()=>{
    let disposed=false,cleanup=()=>{};
    Promise.all([import('three'),import('three/addons/controls/OrbitControls.js'),import('three/addons/loaders/GLTFLoader.js'),import('three/addons/environments/RoomEnvironment.js')]).then(async([T,{OrbitControls},{GLTFLoader},{RoomEnvironment}])=>{
      const {scene:model}=await new GLTFLoader().loadAsync(MODEL_URL);
      const releaseModel=()=>{
        const materials=new Set(),textures=new Set(),geometries=new Set();
        model.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])materials.add(m);});
        materials.forEach(m=>{for(const value of Object.values(m))if(value?.isTexture)textures.add(value);m.dispose();});
        textures.forEach(t=>{t.source?.data?.close?.();t.dispose();});geometries.forEach(g=>g.dispose());
      };
      if(disposed){releaseModel();return;}
      const root=host.current,renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
      renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;root.appendChild(renderer.domElement);
      const scene=new T.Scene(),camera=new T.PerspectiveCamera(32,1,.05,200);scene.add(model);
      const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.65;pmrem.dispose();room.dispose();
      scene.add(new T.HemisphereLight(0xffffff,0x383c42,1.1));
      const key=new T.DirectionalLight(0xfffaf1,1.8);key.position.set(-5,10,12);scene.add(key);
      const rim=new T.DirectionalLight(0xe6ebef,1.1);rim.position.set(2,6,-8);scene.add(rim);
      const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=1.5;controls.maxDistance=85;controls.maxPolarAngle=Math.PI*.88;controls.autoRotateSpeed=3.2;controls.mouseButtons.MIDDLE=T.MOUSE.PAN;
      controls.enableZoom=false;
      const wheelZoom=e=>{controls.enableZoom=!presentation&&(e.altKey||!!root.closest('dialog[open]'));};
      renderer.domElement.addEventListener('wheel',wheelZoom,{capture:true,passive:true});
      if(presentation){controls.enablePan=false;controls.enableRotate=false;}
      // Only clone once per material per assembly; keep small static geometry merged.
      const parts=new Map(),links=[],originalMaterials=new Set(),partBounds=new Map(),partSamples=new Map();
      model.traverse(o=>{if(o.userData.component)parts.set(o.userData.component,o);if(o.userData.cableLink)links.push(o);});
      parts.forEach(part=>{
        const copies=new Map(),materials=[];
        part.traverse(o=>{if(!o.isMesh)return;const original=o.material;if(original.transparent)original.depthWrite=false;originalMaterials.add(original);if(!copies.has(original)){const m=original.clone();copies.set(original,m);materials.push({m,emissive:m.emissive?.clone(),intensity:m.emissiveIntensity,opacity:m.opacity});}o.material=copies.get(original);});
        part.userData.materials=materials;
      });
      // Original cable materials still belong to the model.
      const inUse=new Set();model.traverse(o=>{if(o.material)inUse.add(o.material);});originalMaterials.forEach(m=>{if(!inUse.has(m))m.dispose();});
      model.updateMatrixWorld(true);
      parts.forEach((part,id)=>{const box=new T.Box3().setFromObject(part);box.translate(part.position.clone().negate());partBounds.set(id,box);
        const samples=[],point=new T.Vector3();part.traverse(o=>{if(!o.isMesh)return;const positions=o.geometry.attributes.position,step=Math.max(1,Math.floor(positions.count/160));for(let i=0;i<positions.count;i+=step){point.fromBufferAttribute(positions,i).applyMatrix4(o.matrixWorld).sub(part.position);samples.push(point.x,point.y,point.z);}});partSamples.set(id,samples);
      });
      const linkState=links.map(group=>({group,...group.userData.cableLink,mesh:group.children.find(o=>o.isMesh)}));
      let frame,last=performance.now(),lastInteraction=last,dragging=false,down=null,focus=null,previousSelected,previousReset=-1,previousExplode=-1,previousAppearance='',visible=true;
      const reduced=matchMedia('(prefers-reduced-motion: reduce)');
      const homeDirection=new T.Vector3(.20,.38,1).normalize();
      const desiredBounds=()=>{
        const box=new T.Box3();parts.forEach((part,id)=>{const delta=new T.Vector3(...part.userData.base).addScaledVector(new T.Vector3(...part.userData.explode),latest.current.explode/100);box.union(partBounds.get(id).clone().translate(delta));});return box;
      };
      function fittedPosition(box,direction=homeDirection,padding=1.08){
        const center=box.getCenter(new T.Vector3()),right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),direction).normalize(),up=new T.Vector3().crossVectors(direction,right).normalize();
        const tanV=Math.tan(T.MathUtils.degToRad(camera.fov/2)),tanH=tanV*camera.aspect;let distance=0;
        for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z]){
          const v=new T.Vector3(x,y,z).sub(center),depth=v.dot(direction);distance=Math.max(distance,Math.abs(v.dot(right))*padding/tanH+depth,Math.abs(v.dot(up))*padding/tanV+depth);
        }
        return {center,position:center.clone().addScaledVector(direction,Math.max(2.5,distance))};
      }
      // Fit the actual component surfaces, avoiding the empty corners of a long cylinder's box.
      function fitOverview(direction=homeDirection){
        const center=desiredBounds().getCenter(new T.Vector3()),right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),direction).normalize(),up=new T.Vector3().crossVectors(direction,right).normalize();
        const tanV=Math.tan(T.MathUtils.degToRad(camera.fov/2)),tanH=tanV*camera.aspect;let distance=0;
        parts.forEach((part,id)=>{const b=part.userData.base,d=part.userData.explode,t=latest.current.explode/100,points=partSamples.get(id);for(let i=0;i<points.length;i+=3){const x=points[i]+b[0]+d[0]*t-center.x,y=points[i+1]+b[1]-center.y,z=points[i+2]+b[2]-center.z,depth=x*direction.x+y*direction.y+z*direction.z;distance=Math.max(distance,Math.abs(x*right.x+y*right.y+z*right.z)*1.08/tanH+depth,Math.abs(x*up.x+y*up.y+z*up.z)*1.08/tanV+depth);}});
        return {center,position:center.clone().addScaledVector(direction,Math.max(2.5,distance))};
      }
      function moveTo(target,position){focus={fromTarget:controls.target.clone(),toTarget:target,fromPosition:camera.position.clone(),toPosition:position,start:performance.now()};}
      const reset=()=>{const fitted=fitOverview();moveTo(fitted.center,fitted.position);};
      function focusPart(id){const part=parts.get(id);if(!part){reset();return;}const direction=camera.position.clone().sub(controls.target).normalize();const fit=fittedPosition(new T.Box3().setFromObject(part),direction,1.35);moveTo(fit.center,fit.position);}
      const resize=()=>{const {width,height}=root.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();if(latest.current.selected)focusPart(latest.current.selected);else reset();};
      const observer=new ResizeObserver(resize);observer.observe(root);resize();const first=fitOverview();camera.position.copy(first.position);controls.target.copy(first.center);controls.update();
      const intersection=new IntersectionObserver(([e])=>{visible=e.isIntersecting;});intersection.observe(root);
      const ray=new T.Raycaster(),pointer=new T.Vector2();
      const selectAt=e=>{
        if(!down||e.button!==0||presentation)return;const travel=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;if(travel>5)return;
        const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
        for(const hit of ray.intersectObject(model,true)){let part=hit.object;while(part&&!part.userData.component)part=part.parent;if(!part||!part.visible||['housing','front-cap','rear-cap','frame'].includes(part.name))continue;latest.current.onSelect?.(part.userData.component);break;}
      };
      const pointerDown=e=>{if(e.button===0)down={x:e.clientX,y:e.clientY};};
      const start=()=>{dragging=true;focus=null;lastInteraction=performance.now();};const end=()=>{dragging=false;lastInteraction=performance.now();};
      controls.addEventListener('start',start);controls.addEventListener('end',end);renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',selectAt);
      const work=new T.Vector3(),startDelta=new T.Vector3(),endDelta=new T.Vector3();
      function updateLinks(){
        for(const link of linkState){const from=parts.get(link.from),to=parts.get(link.to);if(!from||!to)continue;
          startDelta.copy(from.position).sub(work.fromArray(from.userData.base));endDelta.copy(to.position).sub(work.fromArray(to.userData.base));
          const points=link.points.map((p,i)=>new T.Vector3(...p).add(startDelta.clone().lerp(endDelta,i/(link.points.length-1))));
          const geometry=new T.TubeGeometry(new T.CatmullRomCurve3(points),56,link.radius,6,false);link.mesh.geometry.dispose();link.mesh.geometry=geometry;
        }
      }
      function draw(now){
        frame=requestAnimationFrame(draw);const dt=Math.min(.05,(now-last)/1000);last=now;if(!visible||document.hidden)return;
        const s=latest.current,blend=reduced.matches?1:1-Math.exp(-dt*9);let moved=false;
        parts.forEach(part=>{const target=work.fromArray(part.userData.explode).multiplyScalar(s.explode/100).add(new T.Vector3(...part.userData.base));if(part.position.distanceToSquared(target)>1e-10){part.position.lerp(target,blend);moved=true;}});
        if(moved)updateLinks();
        const appearance=`${s.selected}:${s.housing}:${s.internal}:${s.explode}`;
        if(appearance!==previousAppearance){previousAppearance=appearance;parts.forEach((part,id)=>{
          part.visible=id!=='housing'||(s.housing&&!s.internal);
          part.userData.materials.forEach(({m,emissive,intensity,opacity})=>{if(m.emissive){m.emissive.copy(emissive);m.emissiveIntensity=intensity;if(id===s.selected){m.emissive.setHex(0x555b5c);m.emissiveIntensity=.2;}}if(id==='housing')m.opacity=opacity*(1-s.explode/100*.55);if(s.internal&&['front-cap','rear-cap','frame'].includes(id)&&m.transparent)m.opacity=opacity*.4;else if(id!=='housing')m.opacity=opacity;});
        });}
        if(previousSelected!==s.selected){previousSelected=s.selected;focusPart(s.selected);lastInteraction=now;}
        if(previousReset!==s.resetKey){previousReset=s.resetKey;reset();lastInteraction=now;}
        if(previousExplode!==s.explode){previousExplode=s.explode;if(!s.selected)reset();lastInteraction=now;}
        controls.autoRotate=s.autoRotate&&!s.selected&&!dragging&&!focus&&!reduced.matches&&(presentation||now-lastInteraction>5000);
        if(focus){const t=reduced.matches?1:Math.min(1,(now-focus.start)/650),ease=1-Math.pow(1-t,3);camera.position.lerpVectors(focus.fromPosition,focus.toPosition,ease);controls.target.lerpVectors(focus.fromTarget,focus.toTarget,ease);if(t===1)focus=null;}
        controls.update(dt);
        if(controls.autoRotate){
          const direction=camera.position.clone().sub(controls.target).normalize();
          const fit=fitOverview(direction);
          camera.position.lerp(fit.position,1-Math.exp(-dt*5));controls.target.lerp(fit.center,1-Math.exp(-dt*5));
        }
        renderer.render(scene,camera);
      }
      const lost=e=>{e.preventDefault();setStatus('error');};renderer.domElement.addEventListener('webglcontextlost',lost);
      frame=requestAnimationFrame(draw);setStatus('ready');
      cleanup=()=>{cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();controls.dispose();renderer.domElement.removeEventListener('wheel',wheelZoom,true);renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',selectAt);renderer.domElement.removeEventListener('webglcontextlost',lost);releaseModel();env.dispose();renderer.dispose();renderer.domElement.remove();};
    }).catch(()=>{if(!disposed)setStatus('error');});
    return()=>{disposed=true;cleanup();};
  },[presentation]);
  return <div className="payload-webgl" ref={host} data-model-status={status} aria-label={presentation?'Rotating 3D AquaSDR prototype':'Interactive AquaSDR prototype. Drag to rotate, Alt and scroll to zoom, right or middle drag to pan. Use component buttons to inspect.'} role="img">
    {status==='loading'&&<span className="payload-render-status" role="status">Loading prototype assembly…</span>}
    {status==='error'&&<span className="payload-render-status" role="status">3D model unavailable. Reload to retry.</span>}
  </div>;
}
