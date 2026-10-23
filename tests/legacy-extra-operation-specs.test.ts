import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyExtraOperationSpecs} from '../src/legacy-extra-operation-specs.ts';
import type {AuthoringApiPort} from '../src/recalculation-browser.ts';
import {authoringBinding,authoringMetadata} from '../src/recalculation-browser.ts';
const settings=legacyExtraOperationSpecs.find(spec=>spec.definition.function.name==='encounter_propose_level_settings')!;
const messages=legacyExtraOperationSpecs.find(spec=>spec.definition.function.name==='encounter_propose_message_change')!;
test('settings, message and hint proposal reads reject a foreign DTO scope',async()=>{
 for(const spec of legacyExtraOperationSpecs)for(const scope of [{game_id:43,level_id:154},{game_id:42,level_id:155}]){
  const api:AuthoringApiPort={metadata:authoringMetadata(authoringBinding('tech.en.cx',42,'test'),['message-update']),invalidate(){},request:async()=>Response.json({...scope,version:'legacy-observed:fixture',messages:[]})};
  await assert.rejects(spec.read(api,{levelId:154,kind:'meta'}),spec===messages?/Incomplete message inventory/:/scoped/);
 }
});
test('read-only reconciliation of a setting requires every mapped sibling and unknown-control fingerprint',()=>{
 const fields={timeout_hours:0,timeout_minutes:15,timeout_seconds:0,penalty_enabled:false,penalty_hours:0,penalty_minutes:3,penalty_seconds:7},before={fields,preservation_version:'opaque'},args={levelId:154,kind:'autopass',fields:{timeout_minutes:16}};
 assert.equal(settings.verify(before,{fields:{...fields,timeout_minutes:16,penalty_hours:0,penalty_minutes:0,penalty_seconds:0},preservation_version:'opaque'},args),true);
 assert.equal(settings.verify(before,{fields:{...fields,timeout_minutes:16,penalty_enabled:true},preservation_version:'opaque'},args),false);
 assert.equal(settings.verify(before,{fields:{...fields,timeout_minutes:16},preservation_version:'changed'},args),false);
 const sector={fields:{all_sectors:false,required_sectors_count:2},preservation_version:'same'};
 assert.equal(settings.verify(sector,{fields:{all_sectors:true,required_sectors_count:null},preservation_version:'same'},{levelId:154,kind:'sectors',fields:{all_sectors:true}}),true);
});
test('autopass disable reconciliation expects the native zero reset and prepare rejects nonzero disabled values',()=>{
 const before={fields:{timeout_hours:0,timeout_minutes:1,timeout_seconds:7,penalty_enabled:true,penalty_hours:0,penalty_minutes:0,penalty_seconds:53},preservation_version:'opaque'},args={levelId:154,kind:'autopass',fields:{penalty_enabled:false}},fields={...before.fields,penalty_enabled:false,penalty_seconds:0};
 assert.equal(settings.verify(before,{fields,preservation_version:'opaque'},args),true);assert.equal(settings.verify(before,{fields:{...fields,penalty_seconds:53},preservation_version:'opaque'},args),false);
 assert.throws(()=>settings.checkBefore?.(before,{...args,fields:{penalty_enabled:false,penalty_seconds:53}}),/clears/);
 assert.match(settings.definition.function.description,/reset.*zero/);
});
test('text-only message reconciliation preserves exact original targets, newline flag and unknown controls',()=>{
 const row={message_id:91,message_text:'before',all_levels:false,level_ids:[154,155],replace_nl_to_br:false,_authoring_preservation:'opaque',_authoring_revision:'before'},before={messages:[row]},args={levelId:154,action:'update',messageId:91,fields:{message_text:'after'}},updated={...row,message_text:'after',_authoring_revision:'after'};
 assert.equal(messages.verify(before,{messages:[updated]},args),true);
 assert.equal(messages.verify(before,{messages:[{...updated,level_ids:[154]}]},args),false);
 assert.equal(messages.verify(before,{messages:[{...updated,replace_nl_to_br:true}]},args),false);
 assert.equal(messages.verify(before,{messages:[{...updated,_authoring_preservation:'changed'}]},args),false);
});
test('message prepare accepts either explicit display mode and preserves an existing checked mode on text update',()=>{
 const fields={message_text:'literal\n<br>source',all_levels:true,level_ids:[154,155]};assert.throws(()=>messages.validate({levelId:154,action:'create',fields}));
 for(const replace_nl_to_br of [false,true])assert.doesNotThrow(()=>messages.validate({levelId:154,action:'create',fields:{...fields,replace_nl_to_br}}));
 assert.throws(()=>messages.validate({levelId:154,action:'create',fields:{...fields,replace_nl_to_br:'true'}}));
 const row={message_id:91,message_text:'before',all_levels:true,level_ids:[154,155],replace_nl_to_br:true,_authoring_preservation:'opaque'},before={messages:[row]},args={levelId:154,action:'update',messageId:91,fields:{message_text:fields.message_text}};
 assert.doesNotThrow(()=>messages.checkBefore?.(before,args));
 const updated={...row,message_text:fields.message_text};assert.equal(messages.verify(before,{messages:[updated]},args),true);
 assert.equal(messages.verify(before,{messages:[{...updated,replace_nl_to_br:false}]},args),false);
 assert.equal(messages.verify(before,{messages:[{...updated,level_ids:[154]}]},args),false);
 assert.equal(messages.verify(before,{messages:[{...updated,replace_nl_to_br:false}]},{...args,fields:{...args.fields,replace_nl_to_br:false}}),true);
 const create={levelId:154,action:'create',fields:{...fields,replace_nl_to_br:true}};assert.equal(messages.verify({messages:[]},{messages:[{...updated,message_text:fields.message_text}]},create),true);
});
