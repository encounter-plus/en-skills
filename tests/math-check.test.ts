import test from 'node:test';import assert from 'node:assert/strict';
import {checkRecalculationMath} from '../src/math-check.ts';
test('independent arithmetic preserves exact rational mean, deltas and no-write contract',()=>{
 const result=checkRecalculationMath({timesSeconds:[0,10,21],targets:[{key:'team:1',currentSeconds:20,targetSeconds:10},{key:'team:2',currentSeconds:10,targetSeconds:20}]});
 assert.equal(result.exactMean,'31/3');assert.equal(result.roundingRequired,true);assert.equal(result.rows[0].bonusSeconds,10);assert.equal(result.rows[1].penaltySeconds,10);assert.equal(result.applied,false);
 assert.equal(checkRecalculationMath({timesSeconds:[0,0]}).exactMean,'0');
 for(const input of [{timesSeconds:[]},{timesSeconds:[true]},{timesSeconds:[1.5]},{timesSeconds:[-1]},{timesSeconds:[Number.MAX_SAFE_INTEGER,1]}])assert.throws(()=>checkRecalculationMath(input));
});
