// Photo-based mesh reconstruction. See docs/PROTOTYPE_MODEL.md for evidence and uncertainties.
// Dimensions are approximate mm; no photogrammetry or fabrication accuracy is claimed.
import * as T from 'three';
import { createHash } from 'node:crypto';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFile, mkdir } from 'node:fs/promises';
globalThis.FileReader ??= class { readAsArrayBuffer(b) { b.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();}); } };
const S=1/32, R=90, RI=87, HL=380;
const scene=new T.Scene(); scene.name='AquaSDR photographed prototype';
scene.userData={source:'Seven prototype photographs supplied 2026-10-01',dimensions:'Estimated 760 × 180 mm; not measured CAD',revision:'photo-reconstruction-v1'};
const standard=(color,metalness=0,roughness=.58,extra={})=>new T.MeshStandardMaterial({color,metalness,roughness,...extra});
const mat={
  black:standard('#16191b'), rubber:standard('#111315',0,.85), chip:standard('#202225',.08,.65),
  steel:standard('#bfc4c4',.72,.36), aluminium:standard('#aeb8ba',.6,.5), darkMetal:standard('#4a5055',.65,.5),
  gold:standard('#c5a76a',.7,.45), copper:standard('#b97941',.55,.6), white:standard('#e6e4dc'),
  pcbWhite:standard('#c4d4c7',.06,.7), pcbBlue:standard('#183c64',.05,.65), pcbGreen:standard('#205b44',.05,.7),
  pcbRed:standard('#a3272e',.05,.6), pcbBlack:standard('#252a2a',.05,.7), orange:standard('#e74a24',.02,.42),
  violet:standard('#9995d2',.04,.4), blueWrap:standard('#205593',.02,.68), wood:standard('#c6ac72',0,.8),
  red:standard('#b83b36'), blue:standard('#3766aa'), yellow:standard('#d5c252'), green:standard('#509574'),
  grey:standard('#919496'), purple:standard('#9b79b1'), redLed:standard('#db2020',0,.4,{emissive:'#9c0804',emissiveIntensity:.7}),
  blueLed:standard('#5278e1',0,.4,{emissive:'#122e9b',emissiveIntensity:.65}),
  glass:new T.MeshPhysicalMaterial({color:'#e2e7df',roughness:.15,metalness:0,ior:1.49,clearcoat:.45,transparent:true,opacity:.025,depthWrite:false,side:T.DoubleSide}),
  plate:new T.MeshPhysicalMaterial({color:'#e2e6d9',roughness:.23,metalness:0,ior:1.49,clearcoat:.25,transparent:true,opacity:.085,depthWrite:false,side:T.DoubleSide}),
  edge:standard('#d1d7c6',.1,.35,{transparent:true,opacity:.35,depthWrite:false}),
  tape:standard('#e5e7e0',0,.65,{transparent:true,opacity:.25,depthWrite:false}),
  glue:standard('#d3c597',0,.55,{transparent:true,opacity:.5,depthWrite:false}),
  screen:standard('#263139',.1,.26), mesh:standard('#303437',.15,.8),
};
const parts=[];
class Part{
  constructor(id,title,center=[0,0,0],dx=0,note=''){
    this.c=new T.Vector3(...center);this.g=new T.Group();this.g.name=id;this.g.position.copy(this.c).multiplyScalar(S);
    this.g.userData={component:id,title,note,base:this.g.position.toArray(),explode:[dx*S,0,0]};this.buckets=new Map();scene.add(this.g);parts.push(this);
  }
  add(g,m,pos=[0,0,0],rot=[0,0,0]){
    g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(...rot)));
    g.translate(pos[0]-this.c.x,pos[1]-this.c.y,pos[2]-this.c.z);g.scale(S,S,S);
    if(!this.buckets.has(m))this.buckets.set(m,[]);this.buckets.get(m).push(g);
  }
  box(w,h,d,m,p,rot){this.add(new T.BoxGeometry(w,h,d),m,p,rot);}
  cyl(r,l,m,p,axis='y',n=24){this.add(new T.CylinderGeometry(r,r,l,n),m,p,axis==='x'?[0,0,Math.PI/2]:axis==='z'?[Math.PI/2,0,0]:[0,0,0]);}
  ring(r,t,m,p,axis='x'){this.add(new T.TorusGeometry(r,t,6,64),m,p,axis==='x'?[0,Math.PI/2,0]:axis==='y'?[Math.PI/2,0,0]:[0,0,0]);}
  wire(points,r,m){const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));this.add(new T.TubeGeometry(curve,Math.max(16,points.length*7),r,6,false),m);}
  finish(){for(const[m,gs]of this.buckets){const normalized=gs.map(g=>g.index?g.toNonIndexed():g);const combined=mergeGeometries(normalized,false);const g=mergeVertices(combined);combined.dispose();normalized.forEach(g=>g.dispose());const mesh=new T.Mesh(g,m);mesh.name=this.g.name+'-'+(m.name||m.color.getHexString());this.g.add(mesh);gs.forEach(x=>x.dispose());}}
}
function screw(p,x,y,z,axis='y'){
  p.cyl(1.6,1.1,mat.steel,[x,y,z],axis,12);
  p.box(axis==='x'?.2:2,axis==='y'?.2:2,axis==='z'?.2:.35,mat.darkMetal,[x+(axis==='x'?.6:0),y+(axis==='y'?.6:0),z+(axis==='z'?.6:0)]);
}
function board(p,x,y,z,w,d,m){p.box(w,1.6,d,m,[x,y,z]);for(const a of[-1,1])for(const b of[-1,1]){p.cyl(2,.18,mat.gold,[x+a*(w/2-3),y+.85,z+b*(d/2-3)],'y',12);screw(p,x+a*(w/2-3),y+1,z+b*(d/2-3));}}
function header(p,x,y,z,n,axis='x',female=false){
  p.box(axis==='x'?n*2.54:2.54,female?7:3,axis==='x'?2.54:n*2.54,mat.black,[x,y+(female?3.5:1.5),z]);
  for(let i=0;i<n;i++){const d=(i-(n-1)/2)*2.54;p.box(.6,female?.3:5,.6,female?mat.darkMetal:mat.gold,[x+(axis==='x'?d:0),y+(female?7.15:5),z+(axis==='z'?d:0)]);}
}
function chip(p,x,y,z,w=8,d=8){p.box(w,1.5,d,mat.chip,[x,y+.8,z]);for(let i=0;i<8;i++)for(const s of[-1,1])p.box(.4,.3,1.2,mat.steel,[x-w/2+.7+i*(w-1.4)/7,y+.3,z+s*(d/2+.4)]);}
function smd(p,x,y,z,count=12){for(let i=0;i<count;i++){const a=i%4,b=Math.floor(i/4);p.box(1.8,.7,.9,i%3?mat.chip:mat.white,[x+a*3.1,y+.4,z+b*3.4]);p.box(.35,.75,1,mat.steel,[x+a*3.1-.8,y+.4,z+b*3.4]);}}
function terminals(p,x,y,z,n=3){p.box(n*5,6,7,mat.pcbGreen,[x,y+3,z]);for(let i=0;i<n;i++){p.cyl(1.4,.2,mat.steel,[x+(i-(n-1)/2)*5,y+6.2,z]);p.box(2.7,2.5,.2,mat.black,[x+(i-(n-1)/2)*5,y+2,z+3.6]);}}
function usb(p,x,y,z){p.box(9,4,8,mat.steel,[x,y+2,z]);p.box(7,2,.2,mat.black,[x,y+2,z+4.1]);}
function posts(p,x,y,z,w,d,h=12){for(const a of[-1,1])for(const b of[-1,1])p.cyl(2,h,mat.steel,[x+a*(w/2-4),y-h/2,z+b*(d/2-4)],'y',8);}
function disc(p,x,r,holes=[]){const sh=new T.Shape();sh.absarc(0,0,r,0,Math.PI*2,false);for(const [y,z,hr]of holes){const hole=new T.Path();hole.absarc(-z,y,hr,0,Math.PI*2,true);sh.holes.push(hole);}const g=new T.ExtrudeGeometry(sh,{depth:3,bevelEnabled:false,curveSegments:64});g.translate(0,0,-1.5);p.add(g,mat.plate,[x,0,0],[0,Math.PI/2,0]);p.ring(r-.5,.6,mat.edge,[x,0,0]);}

// Embedded label textures: actual geometry carries every decal; these are not photo billboards.
const textures=new Map();
async function decal(name,w,h,paint){const c=createCanvas(w,h),ctx=c.getContext('2d');await paint(ctx,w,h);textures.set(name,c.toBuffer('image/png'));const m=standard('#ffffff',0,.7);m.name='decal-'+name;m.userData.decal=name;return m;}
const flag=await decal('flag',384,240,(c,w,h)=>{c.fillStyle='#d96c39';c.fillRect(0,0,w,h/3);c.fillStyle='#eeefea';c.fillRect(0,h/3,w,h/3);c.fillStyle='#2b6f45';c.fillRect(0,2*h/3,w,h/3);c.strokeStyle='#224887';c.lineWidth=3;c.beginPath();c.arc(w/2,h/2,32,0,Math.PI*2);c.stroke();for(let i=0;i<24;i++){const a=i*Math.PI/12;c.beginPath();c.moveTo(w/2,h/2);c.lineTo(w/2+32*Math.cos(a),h/2+32*Math.sin(a));c.stroke();}});
const logo=await decal('identity',1024,300,async(c,w,h)=>{c.fillStyle='#292f35';c.fillRect(0,0,w,h);const img=await loadImage(new URL('../docs/assets/aquasdr-wordmark.png',import.meta.url).pathname);c.drawImage(img,25,7,w-50,h-14);});
const packLabel=await decal('battery-label',384,400,(c,w,h)=>{c.fillStyle='#17191a';c.fillRect(0,0,w,h);c.strokeStyle='#555';c.lineWidth=4;c.strokeRect(8,8,w-16,h-16);c.fillStyle='#bcb6a1';c.font='28px sans-serif';c.fillText('Li-ion Battery Pack',22,68);c.fillStyle='#e3e1dc';c.font='italic bold 94px sans-serif';c.fillText('2000',18,202);c.font='18px sans-serif';c.fillText('mAh',300,220);c.fillStyle='#777b78';c.font='16px sans-serif';c.fillText('RECHARGEABLE',24,328);});
const tft=await decal('local-tft',320,256,(c,w,h)=>{c.fillStyle='#071d70';c.fillRect(0,0,w,h);c.strokeStyle='#284ece';c.lineWidth=2;c.strokeRect(3,3,w-6,h-6);c.fillStyle='#67d4d0';c.font='bold 16px monospace';c.fillText('AQUASDR',12,23);c.fillStyle='#d5da85';c.fillText('TX SPECTRUM',12,47);c.fillStyle='#85c2e0';c.font='12px monospace';c.fillText('FFT',12,64);c.strokeStyle='#5a7abd';c.beginPath();c.moveTo(24,72);c.lineTo(24,165);c.lineTo(300,165);c.stroke();c.strokeStyle='#5ae8b8';c.beginPath();for(let i=0;i<275;i++){const y=i===138?78:118+Math.sin(i*1.3)*1.6;c.lineTo(24+i,y);}c.stroke();c.strokeStyle='#78cbb9';c.beginPath();for(let i=0;i<275;i++)c.lineTo(24+i,210+Math.sin(i*.18)*9*Math.sin(i/275*Math.PI));c.stroke();c.fillStyle='#56d8b1';c.fillText('ACTIVE DMA BUFFER FFT',12,242);});
const nucLabel=await decal('nucleo-mark',256,100,(c,w,h)=>{c.fillStyle='#c4d4c7';c.fillRect(0,0,w,h);c.fillStyle='#275148';c.font='bold 30px sans-serif';c.fillText('NUCLEO',9,38);c.font='22px monospace';c.fillText('F446RE',9,76);});
function face(p,w,h,m,pos,rot=[0,0,0]){const g=new T.PlaneGeometry(w,h);const uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setY(i,1-uv.getY(i));p.add(g,m,pos,rot);}

// Clear straight cylinder, thin cut edges, no metal pressure flanges.
const housing=new Part('housing','Acrylic tube');
for(const radius of[R,RI])housing.add(new T.CylinderGeometry(radius,radius,HL*2,96,1,true),mat.glass,[0,0,0],[0,0,Math.PI/2]);
for(const x of[-HL,HL]){housing.add(new T.RingGeometry(RI,R,96),mat.edge,[x,0,0],[0,Math.PI/2,0]);housing.ring(R-.3,.45,mat.edge,[x,0,0]);}
const front=new Part('front-cap','Left acrylic end plate',[-380,0,0],-175);disc(front,-380,89,[[56,-32,4]]);
const rear=new Part('rear-cap','Probe end plate',[380,0,0],200);disc(rear,380,89,[[22,4,6],[0,4,4],[-44,30,13],[-62,-18,13],[42,-30,14],[18,-31,17],[-17,-31,17]]);
// Small fasteners only at the visible support-rod seats.
for(const[y,z]of[[62,48],[-61,47],[60,-48],[-59,-48]])screw(rear,382,y,z,'x');
const frame=new Part('frame','Acrylic bulkheads and trays',[0,0,0],0);
disc(frame,-65,86,[[45,0,26],[-46,0,22],[20,-48,13]]);disc(frame,180,86,[[32,-24,28],[-40,0,24],[35,45,9]]);
const leftTray=new Part('power-tray','Left power tray',[-216,-61,0],-100);leftTray.box(292,3,124,mat.plate,[-216,-61,0]);frame.box(237,3,130,mat.plate,[58,-7,0]);
// Tray edges give thickness without filling the clear plates with white.
for(const z of[-62,62])leftTray.box(292,.7,.7,mat.edge,[-216,-59.4,z]);
for(const z of[-65,65])frame.box(237,.7,.7,mat.edge,[58,-5.3,z]);
for(const x of[-57,169])for(const z of[-50,50]){frame.cyl(2.5,40,mat.steel,[x,-29,z]);screw(frame,x,-4,z);}
const rods=new Part('rods','Display support rods',[278,0,0],105);
for(const[y,z]of[[62,48],[-61,47],[60,-48],[-59,-48]])rods.cyl(2.1,198,mat.wood,[280,y,z],'x',12);

// Left power bay: visible violet cells, orange commercial pack, UNO-like board and converter.
const battery=new Part('battery','Visible Li-ion cells',[-110,-43,49],-100);
for(const y of[-47,-27]){battery.cyl(9,65,mat.violet,[-107,y,49],'x',32);for(const x of[-139.8,-74.2]){battery.cyl(8.2,.5,mat.darkMetal,[x,y,49],'x');battery.cyl(5.8,.65,mat.steel,[x,y,49],'x');}battery.box(12,1,16,mat.white,[-107,-59,49]);}
battery.box(18,40,19,mat.tape,[-110,-37,49]);
battery.wire([[-75,-27,48],[-73,-36,51],[-85,-49,58],[-136,-58,54]],1.1,mat.red);
battery.wire([[-75,-47,48],[-83,-55,50],[-139,-57,49]],1.1,mat.black);
const orange=new Part('aux-battery','Orange battery pack',[-168,-17,-6],-100);
orange.box(78,84,40,mat.orange,[-168,-17,-6]);orange.box(71,73,1.4,mat.black,[-168,-18,14.7]);face(orange,69,71,packLabel,[-168,-18,15.5]);
for(const x of[-195,-143]){orange.cyl(3.3,5,mat.steel,[x,27,-6]);orange.cyl(4.5,3,mat.orange,[x,29,-6]);}
orange.wire([[-195,31,-6],[-201,55,-10],[-178,63,-12],[-148,53,-9],[-143,32,-6]],1.4,mat.red);
orange.wire([[-194,30,-1],[-210,47,0],[-183,59,7],[-153,46,-4],[-143,31,-5]],1.4,mat.green);
const uno=new Part('controller-board','Left controller board',[-255,-28,25],-100,'UNO-style form visible in photos; exact identity unverified');
uno.box(83,2,64,mat.plate,[-255,-36,25]);for(const x of[-291,-219])for(const z of[0,51])uno.box(2,26,3,mat.plate,[x,-49,z]);
board(uno,-255,-32,25,69,54,mat.pcbBlue);posts(uno,-255,-32,25,69,54,5);
for(const z of[3,47]){header(uno,-245,-30,z,10,'x',true);header(uno,-279,-30,z,6,'x',true);}
uno.box(31,5,8,mat.chip,[-248,-28,33]);for(let i=0;i<14;i++)for(const z of[28,38])uno.box(.55,2,1.2,mat.steel,[-262+i*2,-29,z]);
usb(uno,-284,-30,19);uno.cyl(4.2,10,mat.black,[-282,-26,42],'x');chip(uno,-268,-30,17,7,7);smd(uno,-255,-30,9,12);
const power=new Part('power-module','Terminal power board',[-300,-22,-37],-100);
board(power,-300,-30,-37,65,38,mat.pcbGreen);terminals(power,-309,-29,-19,4);chip(power,-284,-29,-36,12,12);
for(const x of[-322,-307]){power.cyl(4.5,12,mat.darkMetal,[x,-23,-44]);power.cyl(4.3,.3,mat.steel,[x,-16.8,-44]);}
power.box(27,10,11,mat.black,[-300,-23,-48]);for(let i=0;i<3;i++)power.box(5,.3,6,mat.darkMetal,[-309+i*8,-17.8,-48]);
const heat=new Part('heatsink','Finned power module',[-324,-49,49],-100);
board(heat,-324,-57,45,55,42,mat.pcbBlack);heat.box(45,3,34,mat.darkMetal,[-325,-53,45]);for(let i=0;i<12;i++)heat.box(2,20,34,mat.black,[-346+i*3.8,-41,45]);
const identity=new Part('identity','Flag and AquaSDR label',[-260,24,56],-100);
face(identity,65,42,flag,[-331,25,54]);face(identity,110,33,logo,[-238,23,60]);
for(const x of[-358,-183])identity.box(.8,43,.8,mat.wood,[x,0,53]);

// Central white Nucleo board, visibly populated headers and ST-LINK section.
const nuc=new Part('stm32','NUCLEO-F446RE',[68,4,-20],0,'Board outline from inventory; photo-obscured placement estimated');
board(nuc,68,0,-20,82.5,70,mat.pcbWhite);posts(nuc,68,0,-20,82.5,70,7);
for(const z of[-52,12]){header(nuc,62,1,z,19);header(nuc,62,1,z+2.54,19);}
for(const z of[-42,3])header(nuc,58,1,z,10,'x',true);
chip(nuc,57,1,-19,10,10);chip(nuc,97,1,-30,7,7);usb(nuc,104,1,-9);
nuc.cyl(3.2,2.2,mat.blue,[77,3,-35]);nuc.cyl(3.2,2.2,mat.black,[77,3,-3]);
face(nuc,25,9,nucLabel,[91,1.9,-40],[-Math.PI/2,0,0]);smd(nuc,40,1,-34,16);
nuc.box(1.6,1,.8,mat.redLed,[96,2,1]);nuc.box(1.6,1,.8,mat.blueLed,[81,2,-12]);
const computer=new Part('compute-module','Cooled electronics board',[-26,2,-13],0,'Fan/cooled board visible; processor identity not asserted');
board(computer,-23,0,-16,69,62,mat.pcbBlack);posts(computer,-23,0,-16,69,62,7);
computer.box(47,3,44,mat.aluminium,[-29,5,-20]);for(let i=0;i<13;i++)computer.box(1.5,11,44,mat.aluminium,[-50+i*3.5,11,-20]);
computer.box(34,6,34,mat.darkMetal,[-20,19,-17]);computer.cyl(13.5,.7,mat.black,[-20,22.5,-17]);computer.cyl(4,1,mat.darkMetal,[-20,23,-17]);
for(let i=0;i<7;i++){const a=i*Math.PI*2/7;computer.box(4,.5,9,mat.darkMetal,[-20+8*Math.sin(a),23,-17+8*Math.cos(a)],[0,a+.35,0]);}
header(computer,-14,1,-43,18);usb(computer,5,1,-16);computer.box(2,2,2,mat.redLed,[-53,7,5]);
// Local red TFT faces the photo side, immediately in front of the central tray.
const display=new Part('display','ST7735 TFT',[-9,15,57],0);
display.box(58,38,1.6,mat.pcbRed,[-9,15,57]);display.box(48,34,3,mat.black,[-9,15,59]);face(display,43,29,tft,[-9,15,60.6]);
for(const x of[-34,16])for(const y of[0,30])screw(display,x,y,58.2,'z');
display.box(15,20,1.5,mat.steel,[-16,14,55]);display.box(20,4,4,mat.black,[-9,-5,54]);
const sensors=new Part('sensor-modules','Sensor interface boards',[96,-2,44],0,'Visible breakout form factors; individual IC identity obscured');
board(sensors,37,-2,49,23,28,mat.pcbBlue);chip(sensors,36,-1,47,5,5);header(sensors,37,-1,60,7);smd(sensors,29,-1,40,8);sensors.box(1.5,1,1.5,mat.redLed,[40,0,53]);
board(sensors,87,-2,43,49,28,mat.pcbBlack);chip(sensors,88,-1,43,8,8);header(sensors,86,-1,31,12);sensors.box(8,8,8,mat.blue,[71,3,41]);sensors.box(8,5,8,mat.white,[108,2,43]);sensors.box(2,2,2,mat.blueLed,[76,0,53]);
board(sensors,147,-2,38,32,37,mat.pcbBlack);terminals(sensors,148,-1,49,3);sensors.box(8,6,10,mat.white,[136,2,26]);sensors.box(7,5,9,mat.white,[156,2,26]);chip(sensors,150,-1,36,7,7);
// Visible hanging narrow daughterboard under the left edge of the middle bay.
const hanging=new Part('daughterboard','Hanging daughterboard',[-31,-50,51],0);
hanging.box(16,40,1.5,mat.pcbBlack,[-31,-50,51],[0,0,.42]);hanging.box(10,16,2,mat.steel,[-31,-50,52],[0,0,.42]);
for(let i=0;i<4;i++)hanging.box(.6,5,.6,mat.gold,[-39+i*2,-71,51]);
hanging.wire([[-29,-31,51],[-35,-17,53],[-40,-9,56],[-33,-4,55]],.55,mat.grey);
// Dark rectangular enclosure visibly below the central tray; contents are obscured.
const rearBox=new Part('instrument-case','Lower electronics enclosure',[57,-38,-3],0);
rearBox.box(196,52,94,mat.black,[57,-38,-3]);rearBox.box(194,1.5,93,mat.darkMetal,[57,-11.2,-3]);

// Right bay: tilted large blank display, wood rods, blue wrapping and cable coil.
const large=new Part('large-display','Large display',[275,20,42],105);
large.box(168,101,4,mat.aluminium,[275,20,42]);large.box(163,96,1.2,mat.white,[275,20,44.6]);large.box(157,89,1,mat.screen,[275,20,45.4]);
for(const x of[193,357])large.box(1,99,.7,mat.steel,[x,20,45.8]);for(const y of[-28,68])large.box(166,.9,.6,mat.steel,[275,y,45.8]);
large.box(158,94,1.6,mat.pcbBlue,[275,20,38.7]);large.box(17,8,.6,mat.gold,[276,-27,46]);
large.g.rotation.x=-.16; // top leans toward the rear of the tube, as photographed.
large.wire([[279,70,40],[278,78,32],[277,68,20],[279,59,21]],2.8,mat.black);
const wrapped=new Part('wrapped-module','Blue wrapped module',[296,-43,27],105,'Shape visible below screen; contents unknown');
const wrappedGeometry=new T.BoxGeometry(70,46,42,6,4,3),wrappedPositions=wrappedGeometry.attributes.position;
for(let i=0;i<wrappedPositions.count;i++){const x=wrappedPositions.getX(i),y=wrappedPositions.getY(i),z=wrappedPositions.getZ(i);wrappedPositions.setXYZ(i,x+1.7*Math.sin(y*.19+z*.24),y+1.3*Math.sin(x*.22-z*.14),z+1.6*Math.sin(x*.25+y*.21));}wrappedGeometry.computeVertexNormals();wrapped.add(wrappedGeometry,mat.blueWrap,[296,-43,27],[.12,.06,-.13]);
const coil=new Part('cable-coil','Cable coil',[252,-45,-16],105);
for(let i=0;i<7;i++){const pts=[];for(let k=0;k<=28;k++){const a=k/28*Math.PI*2;pts.push([252+26*Math.cos(a),-43+19*Math.sin(a),-28+i*5]);}coil.wire(pts,1.7,mat.black);}

// Probe plate: actual visible arrangement, no invented under-body transducers.
const ultrasonic=new Part('hc-sr04','End-plate ultrasonic module',[373,1,-31],200);
ultrasonic.box(1.6,53,23,mat.pcbBlue,[370,1,-31]);
for(const y of[18,-17]){ultrasonic.cyl(8,13,mat.steel,[380,y,-31],'x',32);ultrasonic.cyl(7,.3,mat.mesh,[386.6,y,-31],'x',32);ultrasonic.ring(7.5,.5,mat.steel,[387,y,-31]);}
const tds=new Part('tds','White conductivity probe',[389,22,4],200);
tds.cyl(5.5,39,mat.white,[389,22,4],'x');tds.ring(7,1.2,mat.glue,[381,22,4]);for(const z of[2.5,5.5])tds.cyl(.65,10,mat.steel,[413,22,z],'x',8);
const temp=new Part('ds18b20','Stainless temperature probe',[399,0,4],200);
temp.cyl(3,51,mat.steel,[401,0,4],'x');temp.cyl(3.6,12,mat.black,[373,0,4],'x');temp.ring(4,1,mat.glue,[381,0,4]);
const turbidity=new Part('turbidity','Translucent optical probe',[389,-44,30],200);
turbidity.cyl(12,24,mat.plate,[389,-44,30],'x',32);turbidity.cyl(10,4,mat.plate,[403,-44,30],'x',32);turbidity.ring(11.5,.6,mat.edge,[401,-44,30]);turbidity.cyl(7,10,mat.black,[375,-44,30],'x');turbidity.ring(12.8,1.2,mat.glue,[381,-44,30]);
const pressure=new Part('pressure','Threaded water-pressure sensor',[392,-62,-18],200);
pressure.cyl(12,25,mat.steel,[391,-62,-18],'x',32);pressure.cyl(14,8,mat.steel,[405,-62,-18],'x',6);pressure.cyl(10,17,mat.steel,[417,-62,-18],'x',32);
for(let x=411;x<425;x+=1.7)pressure.ring(10,.38,mat.darkMetal,[x,-62,-18]);pressure.cyl(6,.5,mat.darkMetal,[425.8,-62,-18],'x');
const rocker=new Part('switch','Power rocker switch',[385,43,-30],200);
rocker.cyl(14,9,mat.black,[383,43,-30],'x');rocker.box(4,24,19,mat.black,[390,43,-30],[0,.12,.08]);rocker.ring(2.4,.4,mat.white,[392.1,48,-30]);rocker.box(.2,3,.6,mat.white,[392.3,36,-30]);
const tether=new Part('tether','USB tether and plate port',[385,-25,-48],200);
tether.cyl(6,8,mat.white,[383,-25,-48],'x');tether.wire([[387,-25,-48],[410,-26,-50],[433,-33,-46],[448,-36,-28]],2.4,mat.white);

// Central harness: bounded loose loops with intentional connectors and ties.
const wiring=new Part('wiring','Central wiring harness',[30,20,0],0);
const colors=[mat.yellow,mat.green,mat.blue,mat.red,mat.black,mat.grey,mat.purple];
for(let i=0;i<27;i++){
  const start=[35+(i%9)*5,10,-49+(i%2)*5];
  const end=i%3===0?[31+(i%6)*2,7,57]:i%3===1?[134+(i%5)*4,7,25]:[-39+(i%8)*4,8,-36];
  const lift=28+(i%7)*4;
  const route=i<13?[start,[12+i*1.8,33,-24],[4+i*1.2,54+(i%3)*2,-13],[22+i*1.3,58-(i%4)*2,-6],[32+i,44,4],[14+i*1.4,30,14],[end[0]-10,19,end[2]-9],end]:[start,[start[0]-8,lift,-30],[8+(i%8)*10,lift+11,3-(i%5)*6],[end[0]-10,19,end[2]-9],end];
  wiring.wire(route,.8,colors[i%colors.length]);
  wiring.box(2.2,4,2.2,mat.black,[end[0],end[1]-1,end[2]]);
}
for(const x of[22,73])wiring.box(3,6,18,mat.black,[x,47,-20],[0,0,.25]);
// End-bay wires travel with the probe bay. Middle-to-bay bridges below flex during explosion.
const endWires=new Part('probe-wiring','Probe wiring',[300,0,-35],105);
for(let i=0;i<9;i++)endWires.wire([[186,12,-24+i*2],[223,29,-35+i],[293,22,-48+i*3],[350,-15+i*5,-30]],.75,colors[i%7]);
// Left-side colored leads are all anchored within their moving bay.
const leftWires=new Part('power-wiring','Power wiring',[-245,-22,0],-100);
for(let i=0;i<7;i++)leftWires.wire([[-319+i*2,-20,-19],[-297,-1,10+i*3],[-253,1,8+i*3],[-226,-23,43-i*2]],.75,colors[i]);

// Cable bridges have stable anchors in the named assemblies; viewer adjusts their control points.
const cableLinks=[
 {id:'left-exit',from:'power-module',to:'front-cap',radius:2.4,color:'#16191b',points:[[-331,-22,-48],[-347,32,-55],[-366,56,-36],[-381,56,-32],[-398,72,-27]]},
 {id:'usb-bridge',from:'aux-battery',to:'compute-module',radius:1.8,color:'#264b8e',points:[[-134,-18,-14],[-114,-6,5],[-113,26,8],[-100,28,-4],[-100,-25,-8],[-80,-29,-13],[-69,4,-17],[-57,4,-17]]},
 {id:'power-bridge',from:'aux-battery',to:'stm32',radius:.9,color:'#b74135',points:[[-143,31,-6],[-127,46,-17],[-83,37,-26],[-55,20,-35],[28,8,-38]]},
 {id:'screen-bridge',from:'sensor-modules',to:'large-display',radius:1.3,color:'#202225',points:[[154,8,26],[170,13,29],[193,9,22],[226,8,24]]},
 {id:'probe-bridge',from:'probe-wiring',to:'tds',radius:.9,color:'#678963',points:[[350,20,-28],[363,34,-10],[371,25,2],[374,22,4]]},
];
for(const link of cableLinks){const p=new Part(link.id,link.id,[0,0,0],0);delete p.g.userData.component;p.g.userData.cableLink={...link,radius:link.radius*S,points:link.points.map(v=>v.map(x=>x*S))};p.wire(link.points,link.radius,standard(link.color));}
for(const p of parts)p.finish();

// Export geometry first, then insert PNG bufferViews into the GLB. This keeps the build
// independent of browser DOM/image shims while producing a self-contained standard GLB.
const raw=Buffer.from(await new GLTFExporter().parseAsync(scene,{binary:true}));
const jsonSize=raw.readUInt32LE(12),gltf=JSON.parse(raw.subarray(20,20+jsonSize).toString());
const binaryStart=20+jsonSize+8;let binary=raw.subarray(binaryStart);gltf.images=[];gltf.textures=[];gltf.samplers=[{magFilter:9729,minFilter:9987,wrapS:33071,wrapT:33071}];
for(const material of gltf.materials){const key=material.extras?.decal;if(!key)continue;const png=textures.get(key),offset=binary.length;binary=Buffer.concat([binary,png,Buffer.alloc((4-png.length%4)%4)]);const view=gltf.bufferViews.length;gltf.bufferViews.push({buffer:0,byteOffset:offset,byteLength:png.length});const img=gltf.images.length;gltf.images.push({bufferView:view,mimeType:'image/png',name:key});const tex=gltf.textures.length;gltf.textures.push({sampler:0,source:img});material.pbrMetallicRoughness.baseColorTexture={index:tex};}
gltf.buffers[0].byteLength=binary.length;let json=Buffer.from(JSON.stringify(gltf));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
const glbHeader=Buffer.alloc(20);glbHeader.writeUInt32LE(0x46546c67,0);glbHeader.writeUInt32LE(2,4);glbHeader.writeUInt32LE(28+json.length+binary.length,8);glbHeader.writeUInt32LE(json.length,12);glbHeader.writeUInt32LE(0x4e4f534a,16);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binary.length,0);binHeader.writeUInt32LE(0x004e4942,4);
const glb=Buffer.concat([glbHeader,json,binHeader,binary]);
const output=new URL('../public/models/aquasdr-payload.glb',import.meta.url);await mkdir(new URL('.',output),{recursive:true});await writeFile(output,glb);
const tabLabels={'housing':'Housing','front-cap':'Left cap','rear-cap':'Probe cap','frame':'Frame','rods':'Rods','controller-board':'Controller','power-module':'Power board','heatsink':'Heatsink','aux-battery':'Orange pack','battery':'Li-ion cells','stm32':'Nucleo','compute-module':'Cooled board','display':'ST7735 TFT','sensor-modules':'Sensor boards','large-display':'Large display','wrapped-module':'Wrapped module','hc-sr04':'Ultrasonic','tds':'TDS','ds18b20':'DS18B20','turbidity':'Turbidity','pressure':'Water pressure','switch':'Switch','wiring':'Wiring'};
const manifest=parts.filter(p=>p.g.userData.component).map(p=>({id:p.g.userData.component,label:p.g.userData.title,tabLabel:tabLabels[p.g.userData.component]||null,base:p.g.userData.base,explode:p.g.userData.explode,note:p.g.userData.note}));
await writeFile(new URL('../src/ui/payload-parts.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
await writeFile(new URL('../src/ui/payload-model-info.json',import.meta.url),JSON.stringify({hash:createHash('sha256').update(glb).digest('hex').slice(0,16),source:'Prototype photos, October 2026'},null,2)+'\n');
let triangles=0;scene.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});
console.log(`Photo prototype: ${manifest.length} selectable assemblies, ${Math.round(triangles)} triangles, ${(glb.length/1024/1024).toFixed(2)} MB GLB, ${textures.size} embedded textures.`);
