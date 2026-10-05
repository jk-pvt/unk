import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const buffer=await readFile(new URL('../public/models/aquasdr-payload.glb',import.meta.url));
const jsonLength=buffer.readUInt32LE(12),gltf=JSON.parse(buffer.subarray(20,20+jsonLength));
const parts=JSON.parse(await readFile(new URL('../src/ui/payload-parts.json',import.meta.url)));
const info=JSON.parse(await readFile(new URL('../src/ui/payload-model-info.json',import.meta.url)));
const components=new Map(gltf.nodes.filter(n=>n.extras?.component).map(n=>[n.extras.component,n]));
test('prototype GLB is self-contained and component controls match real selectable assemblies',()=>{
 assert.equal(buffer.readUInt32LE(0),0x46546c67);assert.equal(buffer.readUInt32LE(4),2);assert.equal(buffer.readUInt32LE(8),buffer.length);
 assert.equal(info.hash,createHash('sha256').update(buffer).digest('hex').slice(0,16));
 assert.deepEqual([...components.keys()].sort(),parts.map(p=>p.id).sort());
 assert.ok(parts.every(p=>p.base.every(Number.isFinite)&&p.explode.every(Number.isFinite)));
 assert.ok(gltf.buffers.every(b=>!b.uri));assert.ok(gltf.images.length>=5);
 for(const image of gltf.images){assert.equal(image.mimeType,'image/png');assert.ok(Number.isInteger(image.bufferView));}
 for(const id of ['large-display','aux-battery','battery','stm32','display','rods','pressure','wiring'])assert.ok(components.has(id),id);
 for(const id of ['tx-piezo','rx-piezo','piezo-driver','tlv9062'])assert.ok(!components.has(id),`unphotographed concept assembly ${id}`);
});
test('caps are transparent acrylic, explosion remains coaxial and bridges have existing anchors',()=>{
 for(const id of ['front-cap','rear-cap']){
  const node=components.get(id);const meshes=node.children.map(i=>gltf.nodes[i]).filter(n=>Number.isInteger(n.mesh));
  const materials=meshes.flatMap(n=>gltf.meshes[n.mesh].primitives.map(p=>gltf.materials[p.material]));
  assert.ok(materials.some(m=>m.alphaMode==='BLEND'&&m.pbrMetallicRoughness.baseColorFactor[3]<.25));
 }
 for(const p of parts){assert.equal(p.explode[1],0);assert.equal(p.explode[2],0);}
 assert.ok(components.get('front-cap').extras.explode[0]<components.get('battery').extras.explode[0]);
 assert.ok(components.get('rear-cap').extras.explode[0]>components.get('large-display').extras.explode[0]);
 for(const n of gltf.nodes.filter(n=>n.extras?.cableLink)){
  const link=n.extras.cableLink;assert.ok(components.has(link.from));assert.ok(components.has(link.to));assert.ok(link.points.length>=4);assert.ok(link.radius>0);
 }
});
test('model has finite geometry within the browser asset budget',()=>{
 let triangles=0;
 for(const mesh of gltf.meshes)for(const p of mesh.primitives){const pos=gltf.accessors[p.attributes.POSITION];assert.ok(pos.min.every(Number.isFinite));assert.ok(pos.max.every(Number.isFinite));triangles+=gltf.accessors[p.indices].count/3;}
 assert.ok(triangles>30000&&triangles<150000,`${triangles} triangles`);assert.ok(buffer.length<5*1024*1024);
 for(const view of gltf.bufferViews)assert.ok((view.byteOffset||0)+view.byteLength<=gltf.buffers[0].byteLength);
});
