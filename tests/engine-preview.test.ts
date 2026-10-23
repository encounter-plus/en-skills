import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePreviewUrl,validatePreviewScenario,runPreviewScenario} from '../harness/engine-preview/contract.mjs';
test('native preview identity is an exact HTTPS game/level route including zero',()=>{
 assert.equal(parsePreviewUrl('https://demo.en.cx/admin/games/900001/levels/preview/1').levelNumber,1);
 assert.equal(parsePreviewUrl('https://demo.en.cx/admin/games/42/levels/preview/0').levelNumber,0);
 for(const url of ['http://demo.en.cx/admin/games/42/levels/preview/1','https://demo.en.cx.evil.test/admin/games/42/levels/preview/1','https://user:secret@demo.en.cx/admin/games/42/levels/preview/1','https://demo.en.cx/admin/games/42/levels/preview/1?token=secret','https://demo.en.cx/admin/games/0/levels/preview/1','https://demo.en.cx/admin/games/42/levels/preview/1#x','https://demo.en.cx/admin/games/42/levels/preview/9007199254740992'])assert.throws(()=>parsePreviewUrl(url));
});
test('native scenarios reject mocks, JS source, multiple actions and missing assertions before any execution',async()=>{
 for(const scenario of [{state:{},responses:[],steps:[]},{steps:[{js:'alert(1)'}]},{steps:[{answer:'001'}]},{steps:[{answer:'001',bonus:'001',expectOk:true}]},{steps:[{expectState:{pointer:'/constructor',value:1}}]},{steps:[{click:'#x',expectOk:true}]},{steps:[{expectVisible:'#x',settleMs:5001}]}])assert.throws(()=>validatePreviewScenario(scenario));
 let calls=0;await assert.rejects(runPreviewScenario(async()=>{calls++;},{steps:[{answer:'001 конь6 ',expectOk:true}]}),/grant/);assert.equal(calls,0);
});
test('the same scenario preserves literal codes and distinguishes runtime detection from verified assertions',async()=>{
 const calls:any[]=[],state={game:{id:42},level:{number:1,sectorsLeft:0}};
 const transport=async(command:any)=>{calls.push(command);return {runtimeDetected:true,state,errors:[],verdict:{ok:true}};};
 const detect=await runPreviewScenario(transport,{steps:[]});assert.equal(detect.passed,true);assert.equal(detect.runtimeVerified,false);
 calls.length=0;const report=await runPreviewScenario(transport,{steps:[{answer:'001 конь6 ',expectOk:true,expectState:{pointer:'/level/sectorsLeft',value:0}}]},{allowActions:true});
 assert.equal(report.runtimeVerified,true);assert.equal(report.backend,'encounter-live-preview');assert.equal(calls.filter(row=>row.kind==='answer').length,1);assert.equal(calls.find(row=>row.kind==='answer').value,'001 конь6 ');assert.equal(calls.at(-1).kind,'stop');
});
test('lost document and verdict failures never retry an action or fall back to an emulator',async()=>{
 const calls:string[]=[];
 const report=await runPreviewScenario(async(command:any)=>{calls.push(command.kind);if(command.kind==='answer')throw new Error('Document reloaded; outcome unknown');return {runtimeDetected:true,errors:[]};},{steps:[{answer:'001',expectOk:true},{answer:'002',expectOk:true}]},{allowActions:true});
 assert.equal(report.passed,false);assert.equal(report.runtimeVerified,false);assert.deepEqual(calls,['start','answer','stop']);assert.match(report.failure,/unknown/);
 const missing=await runPreviewScenario(async()=>({runtimeDetected:false,errors:[]}),{steps:[]});assert.equal(missing.passed,false);assert.equal(missing.runtimeVerified,false);
});
test('late errors in cleanup invalidate a successful scenario',async()=>{
 const report=await runPreviewScenario(async(command:any)=>({runtimeDetected:true,state:{level:{number:1}},errors:command.kind==='stop'?['late error']:[]}),{steps:[{expectState:{pointer:'/level/number',value:1}}]});
 assert.equal(report.passed,false);assert.equal(report.runtimeVerified,false);
});
