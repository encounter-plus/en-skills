import test from 'node:test';import assert from 'node:assert/strict';
import {legacyTaskOperationSpec as spec} from '../src/legacy-task-operation-specs.ts';
test('task review supports both explicit creation modes and optional display edits without forcing a mode',async()=>{
 for(const replaceNlToBr of [false,true])assert.equal(spec.validate({action:'create',levelId:9,taskText:'literal\r001',replaceNlToBr}).replaceNlToBr,replaceNlToBr);
 assert.throws(()=>spec.validate({action:'create',levelId:9,taskText:'literal'}));
 for(const fields of [{taskText:'new literal'},{forMemberId:900077},{replaceNlToBr:true},{replaceNlToBr:false}])assert.equal(spec.validate({action:'update',levelId:9,taskId:77,...fields}).action,'update');
 const before={tasks:[{task_id:77,task_text:'original',for_member_id:0,_authoring_revision:'r',_authoring_replace_newlines:true,_authoring_literal_preservation:'p'}]},calls:RequestInit[]=[],api={metadata:{binding:{gameId:42}},request:async(_path:string,init:RequestInit)=>{calls.push(init);return new Response();}};
 await spec.request(api as never,{action:'update',levelId:9,taskId:77,taskText:'updated'},before);assert.deepEqual(JSON.parse(String(calls[0].body)),{task_text:'updated'});
 await spec.request(api as never,{action:'update',levelId:9,taskId:77,replaceNlToBr:false},before);assert.deepEqual(JSON.parse(String(calls[1].body)),{replace_nl_to_br:false});
 assert.equal(spec.verify(before,{tasks:[{...before.tasks[0],task_text:'updated'}]},{action:'update',levelId:9,taskId:77,taskText:'updated'}),true);
 assert.equal(spec.verify(before,{tasks:[{...before.tasks[0],_authoring_replace_newlines:false}]},{action:'update',levelId:9,taskId:77,replaceNlToBr:false}),true);
});
