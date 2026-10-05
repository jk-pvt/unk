import test from 'node:test';
import assert from 'node:assert/strict';
import {seedReferenceEcho} from '../shared/echo-display.js';
test('preview startup fills columns using the first RX envelope without changing it',()=>{
 const echo=[0,.2,.8,.1],seed=seedReferenceEcho(echo);
 assert.equal(seed.length,239);assert(seed.every(row=>JSON.stringify(row)===JSON.stringify(echo)));
 seed[0][1]=.9;assert.equal(echo[1],.2);assert.equal(seed[1][1],.2);
 assert.deepEqual(seedReferenceEcho(null),[]);assert.deepEqual(seedReferenceEcho([NaN]),[]);
 assert.equal(seedReferenceEcho(echo,1000).length,239);
});
