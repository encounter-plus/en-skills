import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCodes,type CodeCandidate} from '../src/code-check.ts';

test('local comparison preserves literal input, recipients and separate answer identities',()=>{
 const candidates:CodeCandidate[]=[
  {kind:'answer',id:90,text:'  КоД 001 ',sectorId:7,recipient:{kind:'team',id:8},negative:null},
  {kind:'bonus',id:8,text:' БОНУС ',sectorId:null,recipient:{kind:'all'},negative:true},
 ];
 const original=structuredClone(candidates);
 const result=compareCodes(['код 001','Бонус','код001','001','  КоД 001 '],candidates);
 assert.deepEqual(result[0].matches,[{kind:'answer',id:90,sectorId:7,recipient:{kind:'team',id:8},negative:null}]);
 assert.equal(result[1].matches[0].negative,true);
 assert.deepEqual(result[2].matches,[]);assert.deepEqual(result[3].matches,[]);
 assert.equal(result[4].code,'  КоД 001 ');
 assert.deepEqual(candidates,original);
 assert.equal(compareCodes(['код 001'],[...candidates,{...candidates[0],id:91}])[0].matches.length,2);
});
test('invalid input and excess comparison size are rejected',()=>{
 for(const codes of [[],[' '],['x'.repeat(201)],Array(101).fill('x')])assert.throws(()=>compareCodes(codes,[]));
 assert.equal(compareCodes(['0'.repeat(200)],[])[0].code.length,200);
});
