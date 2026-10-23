import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyBonusOperationSpecs} from '../src/legacy-bonus-operation-specs.ts';
import type {AuthoringApiPort} from '../src/recalculation-browser.ts';
const update=legacyBonusOperationSpecs[1],row={bonus_id:5,bonus_name:'Before',bonus_text:'T',help_text:'H',reward_seconds:65,is_negative:false,delay_enabled:false,delay_seconds:120,relative_enabled:false,relative_seconds:180,absolute_enabled:false,absolute_from:'10/24/2027 8:05:00 AM',absolute_to:'10/25/2027 8:05:00 AM',all_levels:false,level_ids:[154],recipient_member_id:0,answers:[{answer_id:71,answer_text:'001'}],_authoring_preservation:'opaque',_authoring_revision:'before'};
test('bonus reconciliation compares every inactive sibling, target, recipient and preserved-control fingerprint',()=>{
 const args={levelId:154,bonusId:5,fields:{bonus_name:'After'}},before={bonuses:[row]},after={bonuses:[{...row,bonus_name:'After',_authoring_revision:'after'}]};
 assert.equal(update.verify(before,after,args),true);
 for(const changed of [{delay_seconds:0},{recipient_member_id:3},{level_ids:[155]},{_authoring_preservation:'changed'}])assert.equal(update.verify(before,{bonuses:[{...after.bonuses[0],...changed}]},args),false);
});
test('deleting and creating an equal code requires a new answer ID, never the retained deleted ID',()=>{
 const before={bonuses:[row]},args={levelId:154,bonusId:5,fields:{delete_answer_ids:[71],new_answers:['001']}};
 assert.equal(update.verify(before,{bonuses:[row]},args),false);
 assert.equal(update.verify(before,{bonuses:[{...row,answers:[{answer_id:72,answer_text:'001'}]}]},args),true);
});
test('proposal validates explicit answer deletion and complete scope, without implicit blank deletion',()=>{
 assert.throws(()=>update.validate({levelId:154,bonusId:5,fields:{answers:[{answer_id:71,answer_text:''}]}}));
 assert.throws(()=>update.validate({levelId:154,bonusId:5,fields:{all_levels:true}}));
 assert.throws(()=>legacyBonusOperationSpecs[0].validate({levelId:154,fields:{bonus_name:'Missing fields'}}));
 assert.throws(()=>update.checkBefore?.({bonuses:[row],available_level_ids:[154]},{levelId:154,bonusId:5,fields:{delete_answer_ids:[999]}}));
 assert.throws(()=>update.checkBefore?.({bonuses:[row],available_level_ids:[154]},{levelId:154,bonusId:5,fields:{all_levels:false,level_ids:[999]}}));
 assert.equal((update.validate({levelId:154,bonusId:5,fields:{bonus_text:'A\r\nB'}}).fields as Record<string,unknown>).bonus_text,'A\nB');
});
test('bonus read rejects a foreign DTO game or persistent level despite a successful HTTP status',async()=>{
 for(const scope of [{game_id:43,level_id:154},{game_id:42,level_id:155}]){
  const api={metadata:{binding:{gameId:42}},request:async()=>Response.json({...scope,version:'legacy-observed:test',bonuses:[]})}as unknown as AuthoringApiPort;
  await assert.rejects(update.read(api,{levelId:154}),/scoped/);
 }
});
test('timing reconciliation adjusts enabled topology only for explicitly patched proven checkbox groups',()=>{
 const topology={txtDelayHours:true,txtDelayMinutes:true,txtDelaySeconds:true,txtValidHours:true},base={...row,_authoring_timing_disabled:topology},args={levelId:154,bonusId:5,fields:{delay_enabled:true,delay_seconds:53}},actual={...base,delay_enabled:true,delay_seconds:53,_authoring_timing_disabled:{...topology,txtDelayHours:false,txtDelayMinutes:false,txtDelaySeconds:false}};
 assert.equal(update.verify({bonuses:[base]},{bonuses:[actual]},args),true);
 assert.equal(update.verify({bonuses:[base]},{bonuses:[{...actual,_authoring_timing_disabled:{...actual._authoring_timing_disabled,txtValidHours:false}}]},args),false);
 assert.throws(()=>update.checkBefore?.({bonuses:[base]},{levelId:154,bonusId:5,fields:{delay_seconds:53}}),/Enable/);
});
