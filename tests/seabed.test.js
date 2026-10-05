import test from 'node:test';
import assert from 'node:assert/strict';
import { demoSeabed, parseSurveyCsv, surveyStats } from '../shared/seabed.js';
test('demo seabed is a finite deterministic grid with simulated provenance',()=>{
 const a=demoSeabed(),b=demoSeabed();assert.deepEqual(a,b);assert.equal(a.source,'demo');assert.equal(a.points.length,a.rows*a.columns);
 assert.ok(a.points.every(p=>Number.isFinite(p.depth)&&p.depth>=0));
 const s=surveyStats(a.points);assert.equal(s.width,120);assert.equal(s.length,90);assert.ok(s.maxDepth>s.minDepth);
});
test('CSV accepts reordered headers and preserves measurements without interpolation',()=>{
 const a=parseSurveyCsv('\uFEFFdepth_m, y_m, x_m\r\n12.5,2,10\r\n20,8,4\r\n15,4,7','survey.csv');
 assert.equal(a.source,'imported');assert.equal(a.columns,undefined);assert.deepEqual(a.points[0],{x:10,y:2,depth:12.5});
 assert.deepEqual(surveyStats(a.points),{minX:4,maxX:10,minY:2,maxY:8,minDepth:12.5,maxDepth:20,width:6,length:6,count:3});
});
test('CSV rejects ambiguous units, missing values, invalid depths and degenerate positions',()=>{
 for(const text of ['x,y,z\n0,0,1\n1,1,2\n2,2,3','x_m,y_m,depth_m\n0,0,1\n1,,2\n2,2,3','x_m,y_m,depth_m\n0,0,-1\n1,1,2\n2,2,3','x_m,y_m,depth_m\n0,0,1\n0,0,2\n0,0,3','x_m,y_m,depth_m\n0,0,Infinity\n1,1,2\n2,2,3']) assert.throws(()=>parseSurveyCsv(text));
});
