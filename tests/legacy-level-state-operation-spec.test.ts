import test from 'node:test';import assert from 'node:assert/strict';
import {legacyLevelStateOperationSpec as spec} from '../src/legacy-level-state-operation-spec.ts';
const before={game_id:42,version:'legacy-observed:level-index-v1:x',level_state_complete:true,levels:[{level_id:9,level_number:1,level_name:'One'},{level_id:17,level_number:2,level_name:'Two'}],not_dismissed_level_ids:[9,17],dismissed_level_ids:[]};
test('native state review preserves every identity and sibling state, requires persistent scope',()=>{
 const args=spec.validate({action:'dismiss',levelId:17}),after={...before,not_dismissed_level_ids:[9],dismissed_level_ids:[17]};spec.checkBefore!(before,args);assert.equal(spec.verify(before,after,args),true);
 assert.equal(spec.verify(before,{...after,levels:before.levels.slice(0,1)},args),false);assert.equal(spec.verify(before,{...after,not_dismissed_level_ids:[],dismissed_level_ids:[9,17]},args),false);assert.equal(spec.verify(before,{...after,level_state_complete:false},args),false);
 assert.equal(spec.verify(after,before,spec.validate({action:'restore',levelId:17})),true);assert.throws(()=>spec.checkBefore!(before,spec.validate({action:'restore',levelId:17})));assert.throws(()=>spec.validate({action:'dismiss',levelId:17,players:'all'}));assert.throws(()=>spec.validate({action:'dismiss',levelId:0}));
});
test('native state request passes exact scope and observed manager revision',async()=>{
 let captured:unknown;const api={metadata:{binding:{gameId:42}},request:async(path:string,init:RequestInit)=>{captured={path,init};return Response.json({});}};
 await spec.request(api as never,{action:'dismiss',levelId:17},before);assert.deepEqual(captured,{path:'/admin/games/42/levels/17/dismiss',init:{method:'POST',headers:{'X-Authoring-Expected-Revision':before.version}}});
 assert.match(spec.definition.function.description,/refunds/);assert.match(spec.definition.function.description,/annuls/);
});
